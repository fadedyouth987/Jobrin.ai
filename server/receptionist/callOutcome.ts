// What a receptionist call leaves behind: exactly one lead and at most one
// owner alert per call.
//
// Both guarantees are enforced in the database (migration
// 20261106010000_receptionist_call_outcomes.sql): record_receptionist_call_lead
// upserts the call's single lead, and claim_alert_delivery hands out the right
// to send an alert exactly once. That makes completeReceptionistCall safe to
// run from every call-end path - the Durable Object / Node WebSocket close and
// Twilio's /voice/complete callback - any number of times, concurrently.
import { env } from '../env';
import { sendSms, twilioConfigured } from '../providers/twilio';
import { supabaseAdmin } from '../supabase';
import { buildOwnerAlertSms, normalizeUrgency } from './ownerAlert';

export type CapturedCallDetails = {
  callerName?: string | null;
  callbackNumber?: string | null;
  suburb?: string | null;
  jobType?: string | null;
  urgency?: string | null;
  note?: string | null;
};

export type AlertOutcome = 'sent' | 'skipped' | 'failed' | 'already_handled';

// Injectable for tests; production always uses the defaults.
export type CallOutcomeDeps = {
  db: Pick<typeof supabaseAdmin, 'rpc' | 'from'>;
  sendSms: typeof sendSms;
  smsConfigured: () => boolean;
  serviceRoleConfigured: () => boolean;
};
const defaultDeps: CallOutcomeDeps = {
  db: supabaseAdmin,
  sendSms,
  smsConfigured: twilioConfigured,
  serviceRoleConfigured: () => Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
};

// Simulator sessions use a synthetic id and have no calls row; they never
// produce real leads or alerts through this path.
export function isRealCallSid(callSid: string): boolean {
  return /^CA[0-9a-zA-Z]{8,64}$/.test(callSid);
}

function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}) {
  // Operational log only: ids and outcome codes, never caller content.
  console[level === 'info' ? 'log' : level](JSON.stringify({ level, component: 'receptionist_call_outcome', message, ...fields }));
}

export async function recordCallLead(workspaceId: string, callSid: string, details: CapturedCallDetails = {}, deps: CallOutcomeDeps = defaultDeps): Promise<string | null> {
  if (!deps.serviceRoleConfigured() || !isRealCallSid(callSid)) return null;
  const { data, error } = await deps.db.rpc('record_receptionist_call_lead', {
    p_workspace_id: workspaceId,
    p_call_sid: callSid,
    p_caller_name: details.callerName ?? null,
    p_callback_number: details.callbackNumber ?? null,
    p_suburb: details.suburb ?? null,
    p_job_type: details.jobType ?? null,
    p_urgency: normalizeUrgency(details.urgency),
    p_note: details.note ?? null,
  });
  if (error) {
    log('error', 'Lead upsert failed', { workspaceId, callSid, code: error.code ?? null });
    return null;
  }
  return (data as string | null) ?? null;
}

async function settleDelivery(deps: CallOutcomeDeps, deliveryId: string, patch: { status: 'sent' | 'failed' | 'skipped'; detail?: string | null; provider_message_id?: string | null }) {
  const now = new Date().toISOString();
  await deps.db.from('alert_deliveries').update({
    ...patch,
    detail: patch.detail ? patch.detail.slice(0, 300) : null,
    updated_at: now,
    ...(patch.status === 'sent' ? { sent_at: now } : {}),
  }).eq('id', deliveryId);
}

// Ensures the call's lead exists, then sends the owner one "new job" SMS.
export async function completeReceptionistCall(workspaceId: string, callSid: string, deps: CallOutcomeDeps = defaultDeps): Promise<{ leadId: string | null; alert: AlertOutcome | null }> {
  const leadId = await recordCallLead(workspaceId, callSid, {}, deps);
  if (!leadId) return { leadId: null, alert: null };

  const [leadResult, callResult, profileResult] = await Promise.all([
    deps.db.from('leads').select('title,description,suburb,job_type,urgency,source_detail,customers(display_name,normalized_phone)').eq('id', leadId).eq('workspace_id', workspaceId).maybeSingle(),
    deps.db.from('calls').select('from_number,to_number').eq('workspace_id', workspaceId).eq('provider', 'twilio').eq('provider_call_id', callSid).maybeSingle(),
    deps.db.from('receptionist_profiles').select('owner_alert_number,transfer_number').eq('workspace_id', workspaceId).maybeSingle(),
  ]);
  const lead = leadResult.data as any;
  if (!lead) {
    log('error', 'Lead not readable after upsert', { workspaceId, callSid, leadId });
    return { leadId, alert: null };
  }
  const profile = profileResult.data as { owner_alert_number?: string | null; transfer_number?: string | null } | null;
  const recipient = profile?.owner_alert_number || profile?.transfer_number || null;

  const { data: claim, error: claimError } = await deps.db.rpc('claim_alert_delivery', {
    p_workspace_id: workspaceId, p_lead_id: leadId, p_kind: 'owner_new_lead', p_recipient: recipient,
  });
  if (claimError) {
    log('error', 'Alert claim failed', { workspaceId, leadId, code: claimError.code ?? null });
    return { leadId, alert: null };
  }
  if (!claim) return { leadId, alert: 'already_handled' };
  const deliveryId = claim as string;

  if (!recipient) {
    await settleDelivery(deps, deliveryId, { status: 'skipped', detail: 'No owner alert number or transfer number is set.' });
    return { leadId, alert: 'skipped' };
  }
  if (!deps.smsConfigured()) {
    await settleDelivery(deps, deliveryId, { status: 'skipped', detail: 'SMS provider is not configured.' });
    return { leadId, alert: 'skipped' };
  }

  const customer = Array.isArray(lead.customers) ? lead.customers[0] : lead.customers;
  const body = buildOwnerAlertSms({
    callerName: (lead.source_detail?.caller_name as string | undefined) ?? (customer?.display_name !== customer?.normalized_phone ? customer?.display_name : null),
    callerNumber: customer?.normalized_phone ?? null,
    suburb: lead.suburb,
    jobType: lead.job_type,
    urgency: normalizeUrgency(lead.urgency),
    note: lead.description,
    leadsUrl: new URL('/app/leads', env.APP_URL).toString(),
  });
  try {
    // From the number the caller rang, so the owner recognises the business line.
    const message = await deps.sendSms({ to: recipient, body, from: (callResult.data as any)?.to_number ?? null });
    await settleDelivery(deps, deliveryId, { status: 'sent', provider_message_id: message.sid });
    return { leadId, alert: 'sent' };
  } catch (error) {
    const code = (error as { code?: number | string })?.code;
    await settleDelivery(deps, deliveryId, { status: 'failed', detail: `SMS send failed${code ? ` (Twilio ${code})` : ''}.` });
    log('warn', 'Owner alert SMS failed', { workspaceId, leadId, code: code ?? null });
    return { leadId, alert: 'failed' };
  }
}
