import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../env';
import { asyncRoute, validateBody } from '../security';
import { consumeWorkspaceUsage, createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { emptyMessagingResponse, normalizeE164, sendSms, twilioConfigured, validateTwilioWebhook } from '../providers/twilio';

const router = Router();
const webhookRouter = Router();
const sendSchema = z.object({
  customer_id: z.string().uuid(),
  conversation_id: z.string().uuid().optional(),
  purpose: z.enum(['transactional', 'marketing', 'support']).default('support'),
  body: z.string().trim().min(1).max(1600),
});
const consentSchema = z.object({
  customer_id: z.string().uuid(),
  channel: z.enum(['email', 'sms', 'phone']),
  purpose: z.enum(['transactional', 'marketing', 'support', 'recording']),
  granted: z.boolean(),
  source: z.string().trim().min(2).max(80),
  evidence: z.record(z.string(), z.unknown()).default({}),
});
const internalNoteSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const campaignSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sender_name: z.string().trim().min(2).max(80),
  contact_details: z.string().trim().min(3).max(200),
  message_body: z.string().trim().min(1).max(1200),
});
const campaignApprovalSchema = z.object({ acknowledge_compliance: z.literal(true) });
const campaignSendSchema = z.object({ batch_size: z.number().int().min(1).max(100).default(25) });

function publicWebhookUrl(path: string) {
  return `${env.APP_URL.replace(/\/$/, '')}${path}`;
}

function campaignText(campaign: { sender_name: string; contact_details: string; message_body: string }) {
  const body = `${campaign.sender_name}: ${campaign.message_body}\nReply STOP to opt out. ${campaign.contact_details}`.trim();
  if (body.length > 1600) throw new Error('CAMPAIGN_SMS_TOO_LONG');
  return body;
}

function currentConsent(rows: Array<{ customer_id: string; granted: boolean; revoked_at: string | null }>) {
  const latest = new Map<string, { granted: boolean; revoked_at: string | null }>();
  for (const row of rows) if (!latest.has(row.customer_id)) latest.set(row.customer_id, row);
  return latest;
}

async function getOrCreateConversation(workspaceId: string, customerId: string) {
  const { data: existing, error: existingError } = await supabaseAdmin.from('conversations').select('id')
    .eq('workspace_id', workspaceId).eq('customer_id', customerId).eq('status', 'open')
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (existingError) throw new Error('CONVERSATION_LOOKUP_FAILED');
  if (existing) return existing.id as string;
  const { data, error } = await supabaseAdmin.from('conversations').insert({
    workspace_id: workspaceId, customer_id: customerId, subject: 'SMS conversation', handling_mode: 'human_active',
  }).select('id').single();
  if (error) throw new Error('CONVERSATION_CREATE_FAILED');
  return data.id as string;
}

async function latestMarketingPermission(workspaceId: string, customerId: string, destination: string) {
  const [{ data: consents, error: consentError }, { data: suppression, error: suppressionError }] = await Promise.all([
    supabaseAdmin.from('customer_consents').select('granted,revoked_at').eq('workspace_id', workspaceId).eq('customer_id', customerId)
      .eq('channel', 'sms').eq('purpose', 'marketing').order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('suppression_entries').select('id').eq('workspace_id', workspaceId).eq('channel', 'sms').eq('value', destination).maybeSingle(),
  ]);
  if (consentError || suppressionError) throw new Error('MARKETING_PERMISSION_CHECK_FAILED');
  if (suppression) return 'suppressed' as const;
  return consents?.granted && !consents.revoked_at ? 'eligible' as const : 'consent_missing' as const;
}

export function twilioSignatureGuard(path: string): RequestHandler {
  return (req, res, next) => {
    if (!twilioConfigured()) return res.status(503).json({ error: 'TWILIO_NOT_CONFIGURED' });
    const signature = req.header('x-twilio-signature') ?? '';
    const params = Object.fromEntries(Object.entries(req.body as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]));
    if (!signature || !validateTwilioWebhook(signature, publicWebhookUrl(path), params)) {
      return res.status(403).json({ error: 'INVALID_TWILIO_SIGNATURE' });
    }
    next();
  };
}

async function assignedWorkspace(to: string) {
  const { data, error } = await supabaseAdmin.from('integrations').select('workspace_id')
    .eq('provider', 'twilio').eq('external_account_id', normalizeE164(to)).eq('status', 'connected').limit(2);
  if (error) throw new Error('TWILIO_TENANT_LOOKUP_FAILED');
  if (data?.length !== 1) return null;
  return data[0].workspace_id as string;
}

webhookRouter.post('/incoming', twilioSignatureGuard('/api/twilio/incoming'), asyncRoute(async (req, res) => {
  const from = normalizeE164(String(req.body.From ?? ''));
  const to = normalizeE164(String(req.body.To ?? ''));
  const providerMessageId = String(req.body.MessageSid ?? '');
  const body = String(req.body.Body ?? '').trim().slice(0, 1600);
  const workspaceId = await assignedWorkspace(to);
  if (!workspaceId || !from || !providerMessageId) return res.status(404).type('text/xml').send(emptyMessagingResponse());

  let { data: customer, error: customerError } = await supabaseAdmin.from('customers').select('id')
    .eq('workspace_id', workspaceId).eq('normalized_phone', from).is('deleted_at', null).maybeSingle();
  if (customerError) throw new Error('TWILIO_CUSTOMER_LOOKUP_FAILED');
  if (!customer) {
    const created = await supabaseAdmin.from('customers').insert({
      workspace_id: workspaceId, display_name: from, phone: from, normalized_phone: from, source: 'sms',
    }).select('id').single();
    if (created.error) throw new Error('TWILIO_CUSTOMER_CREATE_FAILED');
    customer = created.data;
  }

  if (/^(stop|unsubscribe|cancel|end|quit)$/i.test(body)) {
    await supabaseAdmin.from('suppression_entries').upsert({
      workspace_id: workspaceId, customer_id: customer.id, channel: 'sms', value: from, reason: 'customer_opt_out',
    }, { onConflict: 'workspace_id,channel,value' });
  } else if (/^(start|unstop)$/i.test(body)) {
    await supabaseAdmin.from('suppression_entries').delete().eq('workspace_id', workspaceId).eq('channel', 'sms').eq('value', from);
  }

  let { data: conversation } = await supabaseAdmin.from('conversations').select('id')
    .eq('workspace_id', workspaceId).eq('customer_id', customer.id).eq('status', 'open')
    .order('last_message_at', { ascending: false }).limit(1).maybeSingle();
  if (!conversation) {
    const created = await supabaseAdmin.from('conversations').insert({
      workspace_id: workspaceId, customer_id: customer.id, subject: 'SMS conversation', handling_mode: 'human_requested',
    }).select('id').single();
    if (created.error) throw new Error('TWILIO_CONVERSATION_CREATE_FAILED');
    conversation = created.data;
  }

  const receivedAt = new Date().toISOString();
  const inserted = await supabaseAdmin.from('messages').upsert({
    workspace_id: workspaceId, conversation_id: conversation.id, customer_id: customer.id,
    channel: 'sms', direction: 'inbound', purpose: 'support', sender_type: 'customer',
    provider: 'twilio', provider_message_id: providerMessageId, body, status: 'received', sent_at: receivedAt,
  }, { onConflict: 'workspace_id,provider,provider_message_id', ignoreDuplicates: true });
  if (inserted.error) throw new Error('TWILIO_MESSAGE_STORE_FAILED');
  await supabaseAdmin.from('conversations').update({ last_message_at: receivedAt, updated_at: receivedAt })
    .eq('workspace_id', workspaceId).eq('id', conversation.id);
  res.type('text/xml').send(emptyMessagingResponse());
}));

webhookRouter.post('/status', twilioSignatureGuard('/api/twilio/status'), asyncRoute(async (req, res) => {
  const providerMessageId = String(req.body.MessageSid ?? '');
  const providerStatus = String(req.body.MessageStatus ?? '');
  const mapped = providerStatus === 'delivered' ? 'delivered'
    : ['failed', 'undelivered'].includes(providerStatus) ? 'failed'
      : providerStatus === 'sent' ? 'sent' : 'sending';
  if (providerMessageId) {
    const changes: Record<string, unknown> = { status: mapped, error_code: req.body.ErrorCode ? String(req.body.ErrorCode) : null };
    if (mapped === 'delivered') changes.delivered_at = new Date().toISOString();
    if (mapped === 'sent') changes.sent_at = new Date().toISOString();
    await supabaseAdmin.from('messages').update(changes).eq('provider', 'twilio').eq('provider_message_id', providerMessageId);
    const campaignChanges: Record<string, unknown> = { status: mapped, error_code: changes.error_code ?? null, updated_at: new Date().toISOString() };
    if (mapped === 'delivered') campaignChanges.delivered_at = new Date().toISOString();
    // Twilio message SIDs are provider-generated identifiers. Campaign recipients
    // retain the same SID so delivery callbacks update the exact stored recipient.
    await supabaseAdmin.from('sms_campaign_recipients').update(campaignChanges).eq('provider_message_id', providerMessageId);
    const attemptChanges: Record<string, unknown> = { state: mapped === 'delivered' ? 'delivered' : mapped === 'failed' ? 'failed' : 'accepted', error_code: changes.error_code ?? null, updated_at: new Date().toISOString() };
    if (mapped === 'delivered') attemptChanges.delivered_at = new Date().toISOString();
    await supabaseAdmin.from('sms_delivery_attempts').update(attemptChanges).eq('provider_message_id', providerMessageId);
  }
  res.sendStatus(204);
}));

router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

router.get('/conversations', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('conversations')
    .select('id,subject,status,handling_mode,last_message_at,assigned_user_id,customer_id,customers(display_name,phone,email)')
    .eq('workspace_id', req.workspaceId!).order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
  if (error) return res.status(500).json({ error: 'CONVERSATION_LIST_FAILED' });
  res.json({ conversations: data ?? [] });
}));

router.get('/conversations/:id', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const [conversation, messages, notes] = await Promise.all([
    db.from('conversations').select('id,subject,status,handling_mode,last_message_at,customer_id,customers(display_name,phone,email)').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle(),
    db.from('messages').select('id,channel,direction,purpose,sender_type,body,status,sent_at,delivered_at,created_at').eq('workspace_id', req.workspaceId!).eq('conversation_id', req.params.id).order('created_at').limit(500),
    db.from('conversation_notes').select('id,body,author_user_id,created_at').eq('workspace_id', req.workspaceId!).eq('conversation_id', req.params.id).order('created_at').limit(500),
  ]);
  if (conversation.error || messages.error || notes.error) return res.status(500).json({ error: 'CONVERSATION_LOAD_FAILED' });
  if (!conversation.data) return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  res.json({ conversation: conversation.data, messages: messages.data ?? [], notes: notes.data ?? [] });
}));

router.post('/conversations/:id/notes', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(internalNoteSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data: conversation } = await supabaseAdmin.from('conversations').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (!conversation) return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  const { data, error } = await supabaseAdmin.from('conversation_notes').insert({
    workspace_id: req.workspaceId!, conversation_id: conversation.id, author_user_id: req.auth!.userId, body: req.body.body,
  }).select('id,body,author_user_id,created_at').single();
  if (error) return res.status(500).json({ error: 'INTERNAL_NOTE_CREATE_FAILED' });
  await writeAudit(req, 'conversation.internal_note_created', 'conversation', conversation.id);
  res.status(201).json({ note: data });
}));

router.post('/consents', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(consentSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data: customer } = await supabaseAdmin.from('customers').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.body.customer_id).is('deleted_at', null).maybeSingle();
  if (!customer) return res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
  const { error } = await supabaseAdmin.from('customer_consents').insert({ ...req.body, workspace_id: req.workspaceId! });
  if (error) return res.status(500).json({ error: 'CONSENT_RECORD_FAILED' });
  await writeAudit(req, 'customer.consent_recorded', 'customer', customer.id, { channel: req.body.channel, purpose: req.body.purpose, granted: req.body.granted });
  res.status(201).json({ recorded: true });
}));

router.post('/sms', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(sendSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!twilioConfigured()) return res.status(503).json({ error: 'TWILIO_NOT_CONFIGURED' });
  const { data: customer } = await supabaseAdmin.from('customers').select('id,phone,normalized_phone')
    .eq('workspace_id', req.workspaceId!).eq('id', req.body.customer_id).is('deleted_at', null).maybeSingle();
  const destination = normalizeE164(customer?.normalized_phone || customer?.phone || '');
  if (!customer || !/^\+[1-9]\d{7,14}$/.test(destination)) return res.status(400).json({ error: 'CUSTOMER_SMS_NUMBER_REQUIRED' });

  const [{ data: latestConsent }, { data: suppression }] = await Promise.all([
    supabaseAdmin.from('customer_consents').select('granted,revoked_at').eq('workspace_id', req.workspaceId!).eq('customer_id', customer.id).eq('channel', 'sms').eq('purpose', req.body.purpose).order('recorded_at', { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from('suppression_entries').select('id').eq('workspace_id', req.workspaceId!).eq('channel', 'sms').eq('value', destination).maybeSingle(),
  ]);
  if (suppression || !latestConsent?.granted || latestConsent.revoked_at) return res.status(409).json({ error: 'SMS_CONSENT_REQUIRED_OR_SUPPRESSED' });

  let conversationId = req.body.conversation_id as string | undefined;
  if (conversationId) {
    const { data } = await supabaseAdmin.from('conversations').select('id').eq('workspace_id', req.workspaceId!).eq('customer_id', customer.id).eq('id', conversationId).maybeSingle();
    if (!data) return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND' });
  } else {
    const { data, error } = await supabaseAdmin.from('conversations').insert({ workspace_id: req.workspaceId!, customer_id: customer.id, subject: 'SMS conversation', handling_mode: 'human_active' }).select('id').single();
    if (error) return res.status(500).json({ error: 'CONVERSATION_CREATE_FAILED' });
    conversationId = data.id;
  }

  const usage = await consumeWorkspaceUsage(req, 'usage.sms');
  if (!usage.allowed) return res.status(429).json({ error: 'SMS_LIMIT_REACHED', limit: usage.limit });
  const message = await sendSms({ to: destination, body: req.body.body, statusCallback: publicWebhookUrl('/api/twilio/status') });
  const now = new Date().toISOString();
  const { data: stored, error } = await supabaseAdmin.from('messages').insert({
    workspace_id: req.workspaceId!, conversation_id: conversationId, customer_id: customer.id,
    channel: 'sms', direction: 'outbound', purpose: req.body.purpose, sender_type: 'user', sender_user_id: req.auth!.userId,
    provider: 'twilio', provider_message_id: message.sid, body: req.body.body, status: message.status === 'sent' ? 'sent' : 'queued', sent_at: now,
  }).select('id,status').single();
  if (error) return res.status(500).json({ error: 'SMS_SENT_BUT_STORE_FAILED', providerMessageId: message.sid });
  await supabaseAdmin.from('conversations').update({ last_message_at: now, updated_at: now }).eq('workspace_id', req.workspaceId!).eq('id', conversationId);
  await writeAudit(req, 'sms.sent', 'message', stored.id, { customerId: customer.id, purpose: req.body.purpose });
  res.status(202).json({ message: stored, usage });
}));

router.get('/campaigns', requireActiveSubscription('campaigns.revenue'), requireRole('owner', 'admin', 'manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('sms_campaigns').select('id,name,sender_name,contact_details,message_body,status,prepared_at,approved_at,created_at,updated_at,sms_campaign_recipients(status)')
    .eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: 'CAMPAIGN_LIST_FAILED' });
  const campaigns = (data ?? []).map((campaign: any) => ({ ...campaign, counts: (campaign.sms_campaign_recipients ?? []).reduce((counts: Record<string, number>, recipient: any) => {
    counts[recipient.status] = (counts[recipient.status] ?? 0) + 1; return counts;
  }, {}) }));
  res.json({ campaigns });
}));

router.post('/campaigns', requireActiveSubscription('campaigns.revenue'), requireRole('owner', 'admin', 'manager'), validateBody(campaignSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  try { campaignText(req.body); } catch { return res.status(400).json({ error: 'CAMPAIGN_SMS_TOO_LONG' }); }
  const { data, error } = await supabaseAdmin.from('sms_campaigns').insert({ ...req.body, workspace_id: req.workspaceId!, created_by: req.auth!.userId }).select('*').single();
  if (error) return res.status(500).json({ error: 'CAMPAIGN_CREATE_FAILED' });
  await writeAudit(req, 'sms_campaign.created', 'sms_campaign', data.id);
  res.status(201).json({ campaign: data });
}));

router.post('/campaigns/:id/prepare', requireActiveSubscription('campaigns.revenue'), requireRole('owner', 'admin', 'manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data: campaign, error: campaignError } = await supabaseAdmin.from('sms_campaigns').select('*').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (campaignError || !campaign) return res.status(404).json({ error: 'CAMPAIGN_NOT_FOUND' });
  if (!['draft', 'ready'].includes(campaign.status)) return res.status(409).json({ error: 'CAMPAIGN_CANNOT_BE_PREPARED', status: campaign.status });
  const { data: customers, error: customersError } = await supabaseAdmin.from('customers').select('id,phone,normalized_phone').eq('workspace_id', req.workspaceId!).is('deleted_at', null).limit(5000);
  if (customersError) return res.status(500).json({ error: 'CAMPAIGN_CUSTOMER_LOAD_FAILED' });
  const audience = (customers ?? []).map((customer: any) => ({ id: customer.id as string, destination: normalizeE164(customer.normalized_phone || customer.phone || '') })).filter((customer) => /^\+[1-9]\d{7,14}$/.test(customer.destination));
  const customerIds = audience.map((customer) => customer.id);
  const destinations = audience.map((customer) => customer.destination);
  const [{ data: consents, error: consentError }, { data: suppressions, error: suppressionError }] = await Promise.all([
    customerIds.length ? supabaseAdmin.from('customer_consents').select('customer_id,granted,revoked_at').eq('workspace_id', req.workspaceId!).eq('channel', 'sms').eq('purpose', 'marketing').in('customer_id', customerIds).order('recorded_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    destinations.length ? supabaseAdmin.from('suppression_entries').select('value').eq('workspace_id', req.workspaceId!).eq('channel', 'sms').in('value', destinations) : Promise.resolve({ data: [], error: null }),
  ]);
  if (consentError || suppressionError) return res.status(500).json({ error: 'CAMPAIGN_PERMISSION_LOAD_FAILED' });
  const consentByCustomer = currentConsent(consents ?? []);
  const suppressed = new Set((suppressions ?? []).map((entry: any) => entry.value));
  const recipients = audience.map((customer) => {
    const consent = consentByCustomer.get(customer.id);
    const status = suppressed.has(customer.destination) ? 'suppressed' : consent?.granted && !consent.revoked_at ? 'eligible' : 'consent_missing';
    return { workspace_id: req.workspaceId!, campaign_id: campaign.id, customer_id: customer.id, destination: customer.destination, status };
  });
  await supabaseAdmin.from('sms_campaign_recipients').delete().eq('workspace_id', req.workspaceId!).eq('campaign_id', campaign.id);
  if (recipients.length) {
    const { error } = await supabaseAdmin.from('sms_campaign_recipients').insert(recipients);
    if (error) return res.status(500).json({ error: 'CAMPAIGN_RECIPIENT_PREPARE_FAILED' });
  }
  const preparedAt = new Date().toISOString();
  await supabaseAdmin.from('sms_campaigns').update({ status: 'ready', prepared_at: preparedAt, updated_at: preparedAt }).eq('workspace_id', req.workspaceId!).eq('id', campaign.id);
  const counts = recipients.reduce((result: Record<string, number>, recipient) => { result[recipient.status] = (result[recipient.status] ?? 0) + 1; return result; }, {});
  await writeAudit(req, 'sms_campaign.prepared', 'sms_campaign', campaign.id, counts);
  res.json({ campaignId: campaign.id, counts });
}));

router.post('/campaigns/:id/approve', requireActiveSubscription('campaigns.revenue'), requireRole('owner', 'admin'), requireSensitiveAuth, validateBody(campaignApprovalSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const { data, error } = await supabaseAdmin.from('sms_campaigns').update({ status: 'approved', approved_by: req.auth!.userId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).eq('status', 'ready').select('*').maybeSingle();
  if (error) return res.status(500).json({ error: 'CAMPAIGN_APPROVE_FAILED' });
  if (!data) return res.status(409).json({ error: 'CAMPAIGN_NOT_READY_FOR_APPROVAL' });
  await writeAudit(req, 'sms_campaign.approved', 'sms_campaign', data.id, {}, 'warning');
  res.json({ campaign: data });
}));

router.post('/campaigns/:id/send', requireActiveSubscription('campaigns.revenue'), requireRole('owner', 'admin'), requireSensitiveAuth, validateBody(campaignSendSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!twilioConfigured()) return res.status(503).json({ error: 'TWILIO_NOT_CONFIGURED' });
  const { data: campaign, error: campaignError } = await supabaseAdmin.from('sms_campaigns').select('*').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (campaignError || !campaign) return res.status(404).json({ error: 'CAMPAIGN_NOT_FOUND' });
  if (!['approved', 'sending'].includes(campaign.status)) return res.status(409).json({ error: 'CAMPAIGN_NOT_APPROVED', status: campaign.status });
  let body: string;
  try { body = campaignText(campaign); } catch { return res.status(400).json({ error: 'CAMPAIGN_SMS_TOO_LONG' }); }
  await supabaseAdmin.from('sms_campaigns').update({ status: 'sending', updated_at: new Date().toISOString() }).eq('workspace_id', req.workspaceId!).eq('id', campaign.id);
  const { data: candidates, error: candidatesError } = await supabaseAdmin.from('sms_campaign_recipients').select('id,customer_id,destination')
    .eq('workspace_id', req.workspaceId!).eq('campaign_id', campaign.id).eq('status', 'eligible').order('created_at').limit(req.body.batch_size);
  if (candidatesError) return res.status(500).json({ error: 'CAMPAIGN_RECIPIENT_LOAD_FAILED' });
  const results = { sent: 0, skipped: 0, failed: 0, remaining: 0 };
  for (const recipient of candidates ?? []) {
    const { data: claimed } = await supabaseAdmin.from('sms_campaign_recipients').update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', recipient.id).eq('workspace_id', req.workspaceId!).eq('status', 'eligible').select('id').maybeSingle();
    if (!claimed) continue;
    const permission = await latestMarketingPermission(req.workspaceId!, recipient.customer_id, recipient.destination);
    if (permission !== 'eligible') {
      await supabaseAdmin.from('sms_campaign_recipients').update({ status: permission, updated_at: new Date().toISOString() }).eq('id', recipient.id);
      results.skipped += 1; continue;
    }
    const usage = await consumeWorkspaceUsage(req, 'usage.sms');
    if (!usage.allowed) {
      await supabaseAdmin.from('sms_campaign_recipients').update({ status: 'skipped', error_code: 'SMS_LIMIT_REACHED', updated_at: new Date().toISOString() }).eq('id', recipient.id);
      results.skipped += 1; continue;
    }
    const idempotencyKey = `campaign-recipient:${recipient.id}`;
    const { error: attemptError } = await supabaseAdmin.from('sms_delivery_attempts').insert({
      workspace_id: req.workspaceId!, campaign_id: campaign.id, campaign_recipient_id: recipient.id,
      customer_id: recipient.customer_id, destination: recipient.destination, purpose: 'marketing',
      idempotency_key: idempotencyKey, state: 'provider_pending', updated_at: new Date().toISOString(),
    });
    if (attemptError) {
      await supabaseAdmin.from('sms_campaign_recipients').update({ status: 'unknown', error_code: 'DELIVERY_ATTEMPT_ALREADY_EXISTS', updated_at: new Date().toISOString() }).eq('id', recipient.id);
      results.failed += 1; continue;
    }
    try {
      const providerMessage = await sendSms({ to: recipient.destination, body, statusCallback: publicWebhookUrl('/api/twilio/status') });
      const conversationId = await getOrCreateConversation(req.workspaceId!, recipient.customer_id);
      const now = new Date().toISOString();
      const { data: message, error: messageError } = await supabaseAdmin.from('messages').insert({
        workspace_id: req.workspaceId!, conversation_id: conversationId, customer_id: recipient.customer_id, channel: 'sms', direction: 'outbound', purpose: 'marketing', sender_type: 'user', sender_user_id: req.auth!.userId,
        provider: 'twilio', provider_message_id: providerMessage.sid, body, status: providerMessage.status === 'sent' ? 'sent' : 'queued', sent_at: now,
      }).select('id').single();
      if (messageError) throw new Error('MESSAGE_STORE_FAILED');
      await supabaseAdmin.from('sms_campaign_recipients').update({ status: 'sent', provider_message_id: providerMessage.sid, message_id: message.id, sent_at: now, updated_at: now }).eq('id', recipient.id);
      await supabaseAdmin.from('sms_delivery_attempts').update({ state: 'accepted', provider_message_id: providerMessage.sid, accepted_at: now, updated_at: now }).eq('campaign_recipient_id', recipient.id);
      await supabaseAdmin.from('conversations').update({ last_message_at: now, updated_at: now }).eq('workspace_id', req.workspaceId!).eq('id', conversationId);
      results.sent += 1;
    } catch {
      // A network failure after Twilio accepts a request is indistinguishable
      // from a failure before delivery. Hold it for a human instead of retrying
      // and possibly sending a prohibited duplicate marketing SMS.
      await supabaseAdmin.from('sms_campaign_recipients').update({ status: 'unknown', error_code: 'PROVIDER_RESULT_UNKNOWN', updated_at: new Date().toISOString() }).eq('id', recipient.id);
      await supabaseAdmin.from('sms_delivery_attempts').update({ state: 'unknown', error_code: 'PROVIDER_RESULT_UNKNOWN', updated_at: new Date().toISOString() }).eq('campaign_recipient_id', recipient.id);
      results.failed += 1;
    }
  }
  const { count } = await supabaseAdmin.from('sms_campaign_recipients').select('id', { count: 'exact', head: true }).eq('workspace_id', req.workspaceId!).eq('campaign_id', campaign.id).eq('status', 'eligible');
  results.remaining = count ?? 0;
  if (!results.remaining) await supabaseAdmin.from('sms_campaigns').update({ status: results.failed ? 'needs_review' : 'completed', updated_at: new Date().toISOString() }).eq('workspace_id', req.workspaceId!).eq('id', campaign.id);
  await writeAudit(req, 'sms_campaign.batch_sent', 'sms_campaign', campaign.id, results, 'warning');
  res.status(202).json({ results });
}));

export { webhookRouter as twilioWebhookRouter };
export default router;
