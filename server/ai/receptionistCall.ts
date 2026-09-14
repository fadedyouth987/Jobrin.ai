import crypto from 'node:crypto';
import { env } from '../env';
import { openaiConfigured } from '../providers/openai';
import { consumeWorkspaceUsageForWorkspace, supabaseAdmin, writeNotification } from '../supabase';

// The signed real-time conversation layer for the AI receptionist — and the
// unified office-admin brain: one session engine, worn as different hats
// (receptionist / finance / sales / marketing / support) with per-mode
// grounding data and per-mode tool scoping. Runtime-portable: the same
// session logic runs over the local WebSocket server (node-server) and over
// a Workers WebSocketPair (worker.ts).
//
// Safety model (AI_RECEPTIONIST_ARCHITECTURE.md):
// - always identifies itself as a virtual receptionist / office assistant
// - answers only from approved knowledge and business facts; never invents
//   prices, availability, policies or completed actions
// - hands off to a human whenever unsure, on request, or for safety,
//   financial, legal or urgent matters
// - never takes card details or makes binding commitments
// - advisory hats only draft: nothing is ever sent without the owner

const TOKEN_TTL_SECONDS = 180;

function tokenKey() {
  return crypto.createHash('sha256')
    .update(`${env.TWILIO_AUTH_TOKEN || 'missing-twilio'}|${env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role'}|receptionist-call-v1`)
    .digest();
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

// Short-lived signed capability for one call: the voice webhook issues it the
// moment a call is mapped to a workspace, and the WebSocket endpoint accepts
// only connections presenting a valid, unexpired token for that call.
export function issueCallToken(workspaceId: string, callSid: string, toNumber: string) {
  const payload = { w: workspaceId, c: callSid, t: toNumber, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url');
  return `v1.${body}.${signature}`;
}

export function verifyCallToken(token: string): { workspaceId: string; callSid: string; toNumber: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, body, signature] = parts;
    const expected = crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w?: string; c?: string; t?: string; exp?: number };
    if (!payload.w || !payload.c || !payload.t || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!/^[0-9a-fA-F-]{36}$/.test(payload.w)) return null;
    if (!/^\+[1-9]\d{7,14}$/.test(payload.t)) return null;
    return { workspaceId: payload.w, callSid: payload.c, toNumber: payload.t };
  } catch {
    return null;
  }
}

let engineAttached = false;

export function markReceptionistEngineAttached() {
  engineAttached = true;
}

export function isReceptionistEngineAttached() {
  return engineAttached;
}

// ---------- Department modes (the Office Manager's hats) ----------

export type AdminMode = 'receptionist' | 'finance' | 'sales' | 'marketing' | 'support';

export const ADMIN_MODES: AdminMode[] = ['receptionist', 'finance', 'sales', 'marketing', 'support'];

export const JOBRIN_ADMIN_SCOPE = [
  'Jobrin.ai is a workspace-isolated operations platform for Australian trade and service businesses.',
  'Its record flow is lead or enquiry → customer → job → quote → accepted quote → invoice → payment → review and reporting.',
  'Business profiles, approved knowledge, published services and live workspace records are the source of truth.',
  'Never claim a record was created, sent, booked, paid, refunded or changed unless a Jobrin.ai tool result confirms that exact outcome.',
  'Money is stored as integer cents in AUD. GST summaries are factual calculations from stored records, not accounting or tax advice.',
  'Customer contact, financial commitments, refunds, permissions and other consequential actions require the applicable policy check or human approval.',
].join('\n');

export function isAdminMode(value: unknown): value is AdminMode {
  return typeof value === 'string' && ADMIN_MODES.includes(value as AdminMode);
}

// Per-hat behavioural instructions. The hard safety rules live in the shared
// block; these only change WHAT the office manager is focusing on.
function modeInstructions(mode: AdminMode): string[] {
  switch (mode) {
    case 'finance':
      return [
        'You are currently wearing the FINANCE hat of the office manager.',
        'Duties: watch overdue invoices, flag completed jobs that have not been invoiced yet, draft polite payment chasers, and summarise cash flow.',
        'In this preview, use only figures the signed-in user deliberately supplies. Direct them to the deterministic Command Centre for exact workspace totals.',
        'You may DRAFT chasers and summaries. You never send anything yourself, and you do not provide accounting or tax advice.',
      ];
    case 'sales':
      return [
        'You are currently wearing the SALES & LEADS hat of the office manager.',
        'Duties: triage new leads, draft first responses, chase stale enquiries, suggest which lead to contact first, and record what each lead wanted.',
        'Use only enquiry details the signed-in user deliberately supplies. Drafts are advisory. Never promise prices or availability — propose and let the owner decide.',
      ];
    case 'marketing':
      return [
        'You are currently wearing the MARKETING hat of the office manager.',
        'Duties: draft review responses, post-work recap posts, seasonal campaign ideas and service copy, grounded only in approved knowledge and details the signed-in user deliberately supplies.',
        'Everything you write is a draft for the owner. Never contact customers directly.',
      ];
    case 'support':
      return [
        'You are currently wearing the CUSTOMER SUPPORT hat of the office manager.',
        'Duties: help triage a message the signed-in user deliberately supplies and draft a grounded reply.',
        'Never invent facts — if the approved knowledge does not cover it, say so and flag it for the team.',
      ];
    default:
      return [
        'You are currently wearing the RECEPTIONIST hat: answer the call, take messages, make booking suggestions, and keep the caller comfortable. Do not discuss invoicing, marketing or anything outside a phone receptionist\'s duties.',
      ];
  }
}

// ---------- Shared call context ----------

export type TurnResult = {
  reply: string;
  configured: boolean;
  messageTaken: boolean;
  note?: string;
  handoff?: { reason: string };
  // Set once a hard max_call_minutes / max_call_turns limit is reached — the
  // transport (Twilio ConversationRelay adapter or Node WS) must end the call
  // after delivering this reply.
  endCall?: boolean;
};

// Fallbacks used whenever an owner has not yet set a phase-1 runtime control.
// Never invent wording live on a call — fall back to safe, non-committal defaults.
export const DEFAULT_APPROVED_PRICING_LANGUAGE = 'A team member will confirm pricing after reviewing the request.';
export const DEFAULT_CALLBACK_WINDOW = 'within one business day';
export const DEFAULT_MAX_CALL_MINUTES = 15;
export const DEFAULT_MAX_CALL_TURNS = 40;
export const DEFAULT_MAX_CONCURRENT_CALLS = 5;
export const DEFAULT_MAX_CALLS_PER_CALLER_HOUR = 6;

// Abuse/spend guardrails enforced by the /voice webhook before a call is ever
// connected to the AI engine (issueCallToken + ConversationRelay). Pure
// decision functions so the counting/query logic in the webhook stays
// unit-testable without a live database.
export function isOverConcurrentCallLimit(currentInProgressCalls: number, maxConcurrentCalls?: number | null): boolean {
  const max = maxConcurrentCalls ?? DEFAULT_MAX_CONCURRENT_CALLS;
  return currentInProgressCalls >= max;
}

export function isOverCallerHourlyLimit(callsFromCallerLastHour: number, maxCallsPerCallerHour?: number | null): boolean {
  const max = maxCallsPerCallerHour ?? DEFAULT_MAX_CALLS_PER_CALLER_HOUR;
  return callsFromCallerLastHour >= max;
}

export type CallContext = {
  workspaceId: string;
  profile: {
    display_name: string; greeting: string; tone: string; business_instructions: string;
    after_hours_message: string; transfer_number: string | null; language: string;
    allow_booking: boolean; allow_warm_transfer: boolean; allow_message_take: boolean; allow_followup_sms: boolean;
    recording_enabled: boolean; recording_consent_prompt: string;
    approved_pricing_language?: string | null; custom_escalation_rules?: unknown; callback_window?: string | null;
    after_hours_rule?: string | null; max_concurrent_calls?: number | null; max_calls_per_caller_hour?: number | null;
    max_call_minutes?: number | null; max_call_turns?: number | null;
  };
  business: { trading_name: string | null; suburb: string | null; state: string | null; phone: string | null } | null;
  knowledge: Array<{ title: string; content: string }>;
  services: Array<{ name: string; pricing_mode: string; base_price_cents: number | null }>;
};

// custom_escalation_rules is stored as a jsonb array (see migration 0027);
// tolerate anything else the column might legitimately hold and never throw.
function escalationRulesList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

export async function fetchCallContext(workspaceId: string): Promise<CallContext | null> {
  try {
    const [profileResult, businessResult, knowledgeResult, servicesResult] = await Promise.all([
      supabaseAdmin.from('receptionist_profiles').select('display_name,greeting,tone,business_instructions,after_hours_message,transfer_number,language,allow_booking,allow_warm_transfer,allow_message_take,allow_followup_sms,recording_enabled,recording_consent_prompt,approved_pricing_language,custom_escalation_rules,callback_window,after_hours_rule,max_concurrent_calls,max_calls_per_caller_hour,max_call_minutes,max_call_turns').eq('workspace_id', workspaceId).maybeSingle(),
      supabaseAdmin.from('business_profiles').select('trading_name,suburb,state,phone').eq('workspace_id', workspaceId).maybeSingle(),
      supabaseAdmin.from('knowledge_documents').select('title,content').eq('workspace_id', workspaceId).eq('approved', true).order('updated_at', { ascending: false }).limit(6),
      supabaseAdmin.from('services').select('name,pricing_mode,base_price_cents').eq('workspace_id', workspaceId).order('name').limit(12),
    ]);
    const profile = profileResult.data as CallContext['profile'] | null;
    if (!profile) return null;
    return {
      workspaceId,
      profile,
      business: (businessResult.data as CallContext['business']) ?? null,
      knowledge: ((knowledgeResult.data ?? []) as Array<{ title: string; content: string }>).map((doc) => ({ title: doc.title, content: String(doc.content || '').slice(0, 800) })),
      services: (servicesResult.data ?? []) as CallContext['services'],
    };
  } catch {
    return null;
  }
}

export function buildSystemPrompt(context: CallContext, mode: AdminMode = 'receptionist'): string {
  const business = context.business;
  const services = context.services.length
    ? context.services.map((service) => `- ${service.name} (${service.pricing_mode}${service.base_price_cents != null ? `, from $${(service.base_price_cents / 100).toFixed(2)}` : ''})`).join('\n')
    : '- (none published yet)';
  const knowledge = context.knowledge.length
    ? context.knowledge.map((doc) => `## ${doc.title}\n${doc.content}`).join('\n\n')
    : '(No approved knowledge yet — do not guess. Take a message instead.)';
  const approvedPricingLanguage = context.profile.approved_pricing_language?.trim() || DEFAULT_APPROVED_PRICING_LANGUAGE;
  const callbackWindow = context.profile.callback_window?.trim() || DEFAULT_CALLBACK_WINDOW;
  const escalationRules = escalationRulesList(context.profile.custom_escalation_rules);
  const afterHoursRule = context.profile.after_hours_rule?.trim();
  return [
    `You are ${context.profile.display_name}, the virtual receptionist and office assistant for ${business?.trading_name || 'this business'}${business?.suburb ? ` in ${business.suburb}` : ''}${business?.state ? `, ${business.state}` : ''}.`,
    `You are NOT a human employee. If anyone asks, clearly say you are the business's virtual receptionist.`,
    ``,
    `Speaking style: ${context.profile.tone}. Speak in short, natural sentences suitable for a phone call. One idea per turn. Ask one question at a time.`,
    ``,
    `Owner instructions (highest priority after the safety rules):`,
    context.profile.business_instructions,
    ``,
    `Approved business knowledge — the ONLY facts you may share:`,
    knowledge,
    ``,
    `Published services (you may describe these; never state a binding price or quote a total):`,
    services,
    ``,
    `JOBRIN.AI ADMINISTRATION MODEL:`,
    JOBRIN_ADMIN_SCOPE,
    ``,
    `HARD RULES:`,
    `- Never invent prices, availability, policies, warranties or completed actions.`,
    `- Never take card details or payment information. Never process payments.`,
    `- Never give emergency, safety, legal or medical advice. For emergencies or urgent situations, tell the caller to hang up and dial emergency services if in danger, and offer to take a message for urgent follow-up.`,
    `- In receptionist mode, if unsure, if the caller asks for a person, or for complaints/refunds/legal/financial matters: apologise, and either transfer to ${context.profile.transfer_number || 'the team'} or take a message. In signed-in admin modes, keep output advisory and escalate consequential decisions.`,
    `- Keep replies under three sentences unless reading back captured details.`,
    ``,
    `PRICING LANGUAGE (mandatory): the ONLY thing you may say about price is: "${approvedPricingLanguage}". Never state a dollar figure, discount, quote or total beyond this approved wording and the published services above, even if the caller insists.`,
    `CALLBACK WORDING (mandatory): whenever you promise the team will call the caller back, use exactly this timeframe: "${callbackWindow}". Never invent a different callback time.`,
    escalationRules.length
      ? `CUSTOM ESCALATION RULES: before replying, check the caller's request against every rule below. If any rule applies, apologise and either transfer to ${context.profile.transfer_number || 'the team'} or take a message immediately, per the hard rules above.\n${escalationRules.map((rule) => `- ${rule}`).join('\n')}`
      : `CUSTOM ESCALATION RULES: none configured — use the hard rules above.`,
    ...(afterHoursRule ? [`AFTER-HOURS RULE: ${afterHoursRule}`] : []),
    ...modeInstructions(mode),
  ].join('\n');
}

// ---------- Per-mode grounding: live records for advisory hats ----------

// Bounded and best-effort: no records simply means no section, never a guess.
async function fetchModeData(workspaceId: string, mode: AdminMode): Promise<string | null> {
  void workspaceId;
  if (mode === 'receptionist') return null;
  return `PRIVACY BOUNDARY: No private workspace records are included in this model prompt. Use only approved business knowledge and details the signed-in user deliberately supplies in this conversation. For exact Jobrin.ai financial and operational figures, direct the user to the deterministic Command Centre report.`;
}

// ---------- Tools: side effects are scoped per hat ----------

const TAKE_MESSAGE_TOOL = {
  type: 'function',
  function: {
    name: 'take_message',
    description: 'Record a callback request or message from the caller for the team. Use whenever the caller wants follow-up, leaves details, or the receptionist cannot answer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['reason'],
      properties: {
        callback_number: { type: 'string', description: 'Best contact number, in international format if possible.' },
        reason: { description: 'What the caller needs and any agreed time.', type: 'string' },
        caller_name: { description: 'Caller name if known.', type: 'string' },
      },
    },
  },
};

const HANDOFF_TOOL = {
  type: 'function',
  function: {
    name: 'request_handoff',
    description: 'Transfer the caller to the configured person. Use only when the caller asks for a person or an escalation rule applies.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['reason'],
      properties: { reason: { type: 'string', minLength: 3, maxLength: 300 } },
    },
  },
};

// Only the receptionist hat can take messages (it is on a live call with the
// caller). Advisory hats draft in chat — their output is the reply itself.
function toolsForMode(mode: AdminMode): unknown[] {
  return mode === 'receptionist' ? [TAKE_MESSAGE_TOOL, HANDOFF_TOOL] : [];
}

function providerUnavailableReply(mode: AdminMode): string {
  if (mode === 'receptionist') {
    return `I'm sorry, I can't answer questions at the moment, but I can take a message for the team — what is the best number to reach you on?`;
  }
  const department = mode === 'sales' ? 'Sales & leads' : mode[0].toUpperCase() + mode.slice(1);
  return `${department} AI is unavailable because the OpenAI provider is not ready. No draft was produced and no action was taken. Use Jobrin.ai's deterministic screens for exact records, or configure OpenAI under Integrations and try again.`;
}

// ---------- Persistence (best-effort, fail-closed without secrets) ----------

async function recordMessageTake(context: CallContext, fromNumber: string | null, args: { callback_name?: string; callback_number?: string; reason?: string }, idempotencyKey: string): Promise<string> {
  const note = `Receptionist message take — caller ${fromNumber || 'unknown'}: ${args.reason || 'no reason captured'} (callback: ${args.callback_number || fromNumber || 'not provided'})`.slice(0, 1000);
  try {
    let customerId: string | null = null;
    if (fromNumber) {
      const { data: existing } = await supabaseAdmin.from('customers').select('id').eq('workspace_id', context.workspaceId).eq('normalized_phone', fromNumber).is('deleted_at', null).maybeSingle();
      customerId = existing?.id ?? null;
      if (!customerId) {
        const created = await supabaseAdmin.from('customers').insert({ workspace_id: context.workspaceId, display_name: args.callback_name || fromNumber, phone: fromNumber, normalized_phone: fromNumber, source: 'receptionist' }).select('id').single();
        customerId = created.data?.id ?? null;
      }
    }
    const lead = await supabaseAdmin.from('leads').insert({
      workspace_id: context.workspaceId, customer_id: customerId,
      title: 'Callback request — AI receptionist',
      description: note, source: 'receptionist', source_detail: { receptionist_idempotency_key: idempotencyKey },
    }).select('id').single();
    if (lead.error) {
      const existing = await supabaseAdmin.from('leads').select('id')
        .eq('workspace_id', context.workspaceId).eq('source', 'receptionist')
        .contains('source_detail', { receptionist_idempotency_key: idempotencyKey }).maybeSingle();
      if (!existing.data) throw lead.error;
      return 'Callback task already exists for this call.';
    }
    await supabaseAdmin.from('ai_actions').insert({
      workspace_id: context.workspaceId, requested_by: 'receptionist', actor_type: 'receptionist_voice',
      tool_name: 'message.take', risk_level: 'low', input: {},
      approval_required: false, status: 'completed', output: { leadId: lead.data?.id ?? null },
    });
    await writeNotification(context.workspaceId, 'receptionist.message_taken', 'AI receptionist took a callback request', note, 'lead', lead.data?.id ?? null);
    return `Callback task created (lead ${lead.data?.id ? 'saved' : 'pending'}).`;
  } catch {
    return 'Callback task recorded locally.';
  }
}

type ProviderUsage = { promptTokens: number; completionTokens: number; totalTokens: number };
type OpenAiTurn = { configured: boolean; message: { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> } | null; usage?: ProviderUsage };

async function openaiChat(messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }>, tools: unknown[] = []): Promise<OpenAiTurn> {
  if (!openaiConfigured()) return { configured: false, message: null };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL, messages, ...(tools.length ? { tools } : {}) }),
  });
  if (!response.ok) throw new Error(`OPENAI_CHAT_FAILED:${response.status}`);
  const payload: any = await response.json();
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error('OPENAI_CHAT_EMPTY');
  return {
    configured: true,
    message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls },
    usage: {
      promptTokens: Number(payload.usage?.prompt_tokens || 0),
      completionTokens: Number(payload.usage?.completion_tokens || 0),
      totalTokens: Number(payload.usage?.total_tokens || 0),
    },
  };
}

// ---------- The session ----------

export class ReceptionistSession {
  readonly workspaceId: string;
  readonly callSid: string;
  readonly mode: AdminMode;
  fromNumber: string | null;
  context: CallContext | null;
  systemPrompt: string | null;
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  readonly transcript: string[] = [];
  private pendingMessageTake = false;
  private turnNumber = 0;
  private readonly startedAtMs: number;
  private callEnded = false;
  messageTaken = false;

  constructor(options: { workspaceId: string; callSid: string; fromNumber?: string | null; history?: Array<{ role: 'user' | 'assistant'; content: string }>; mode?: AdminMode; startedAtMs?: number }) {
    this.workspaceId = options.workspaceId;
    this.callSid = options.callSid;
    this.mode = options.mode ?? 'receptionist';
    this.fromNumber = options.fromNumber ?? null;
    this.context = null;
    this.systemPrompt = null;
    this.history = options.history ?? [];
    this.startedAtMs = options.startedAtMs ?? Date.now();
  }

  // Hard call-duration / turn-count limits (server/ai/receptionistCall.ts
  // owns enforcement so it applies identically over the Node WS and Workers
  // DO transports). Configured per workspace on receptionist_profiles;
  // DEFAULT_* fallbacks apply until an owner sets their own values.
  private limitReached(): { reply: string } | null {
    if (this.mode !== 'receptionist') return null;
    const maxTurns = this.context?.profile.max_call_turns ?? DEFAULT_MAX_CALL_TURNS;
    const maxMinutes = this.context?.profile.max_call_minutes ?? DEFAULT_MAX_CALL_MINUTES;
    const elapsedMinutes = (Date.now() - this.startedAtMs) / 60_000;
    if (this.turnNumber > maxTurns || elapsedMinutes > maxMinutes) {
      const reply = `I need to wrap up this call now. I've noted everything so far, and the team will follow up ${this.context?.profile.callback_window?.trim() || DEFAULT_CALLBACK_WINDOW}. Thanks for calling.`;
      return { reply };
    }
    return null;
  }

  async loadContext() {
    this.context = await fetchCallContext(this.workspaceId);
    if (!this.context) {
      this.systemPrompt = null;
      return;
    }
    const base = buildSystemPrompt(this.context, this.mode);
    const modeData = await fetchModeData(this.workspaceId, this.mode);
    this.systemPrompt = modeData ? `${base}\n\n${modeData}` : base;
  }

  greeting(): string {
    return this.context?.profile.greeting || 'Thanks for calling.';
  }

  snapshotForCall() {
    return {
      history: this.history.slice(-16),
      transcript: this.transcript.slice(-60),
      turnNumber: this.turnNumber,
      messageTaken: this.messageTaken,
    };
  }

  restoreForCall(transcript: string[], turnNumber: number, messageTaken: boolean) {
    this.transcript.splice(0, this.transcript.length, ...transcript.slice(-60));
    this.turnNumber = Math.max(0, turnNumber);
    this.messageTaken = messageTaken;
  }

  private pushTranscript(who: 'caller' | 'receptionist', text: string) {
    this.transcript.push(`${who}: ${text}`.slice(0, 2000));
    if (this.transcript.length > 60) this.transcript.shift();
  }

  private async recordModelTurn(status: 'completed' | 'failed' | 'denied', usage?: ProviderUsage, errorCode?: string) {
    try {
      await supabaseAdmin.from('ai_actions').insert({
        workspace_id: this.workspaceId,
        requested_by: this.mode === 'receptionist' ? 'receptionist' : 'signed_in_user',
        actor_type: this.mode === 'receptionist' ? 'receptionist_voice' : 'admin_preview',
        tool_name: `admin.${this.mode}.respond`,
        risk_level: 'low',
        input: { mode: this.mode },
        output: usage ? { providerUsage: usage } : null,
        approval_required: false,
        status,
        error_code: errorCode || null,
        model: openaiConfigured() ? env.OPENAI_MODEL : null,
        prompt_version: 'jobrin-admin-v2',
        completed_at: new Date().toISOString(),
      });
    } catch {
      // Usage enforcement remains authoritative if audit storage is unavailable.
    }
  }

  async handleUserText(userText: string): Promise<TurnResult> {
    if (this.callEnded) {
      const reply = `This call has already wrapped up — the team has your details and will follow up.`;
      return { reply, configured: false, messageTaken: this.messageTaken, endCall: true };
    }
    this.turnNumber += 1;
    this.pushTranscript('caller', userText);

    const limit = this.limitReached();
    if (limit) {
      this.callEnded = true;
      await this.recordModelTurn('completed', undefined, 'CALL_LIMIT_REACHED');
      this.pushTranscript('receptionist', limit.reply);
      return { reply: limit.reply, configured: openaiConfigured(), messageTaken: this.messageTaken, endCall: true };
    }

    // No AI configured: live calls offer a deterministic message-take. Signed-in
    // admin hats report the unavailable provider and never pretend they acted.
    if (!openaiConfigured() || !this.systemPrompt) {
      if (this.mode !== 'receptionist') {
        const reply = providerUnavailableReply(this.mode);
        this.pushTranscript('receptionist', reply);
        return { reply, configured: false, messageTaken: false };
      }
      if (this.pendingMessageTake && userText.trim().length >= 6) {
        this.pendingMessageTake = false;
        this.messageTaken = true;
        const note = await recordMessageTake(this.context ?? { workspaceId: this.workspaceId } as unknown as CallContext, this.fromNumber, { reason: userText.slice(0, 500) }, `receptionist:${this.callSid}:message:${this.turnNumber}`);
        const reply = `Thank you — I have passed that to the team. They will be in touch.`;
        this.pushTranscript('receptionist', reply);
        return { reply, configured: false, messageTaken: true, note };
      }
      this.pendingMessageTake = true;
      const reply = `I'm sorry, I can't answer questions at the moment, but I can take a message for the team — what is the best number to reach you on?`;
      this.pushTranscript('receptionist', reply);
      return { reply, configured: false, messageTaken: false };
    }

    const messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }> = [
      { role: 'system', content: this.systemPrompt },
      ...this.history.slice(-16).map((entry) => ({ role: entry.role, content: entry.content })),
      { role: 'user', content: userText },
    ];
    const allowance = await consumeWorkspaceUsageForWorkspace(
      this.workspaceId,
      'usage.ai_actions',
      1,
      `usage.ai_actions:${this.callSid}:${this.turnNumber}`,
    ).catch(() => ({ allowed: false }));
    if (!allowance.allowed) {
      const reply = `The monthly AI Admin action limit has been reached. Exact reports and manual Jobrin.ai workflows are still available.`;
      await this.recordModelTurn('denied', undefined, 'AI_ACTION_LIMIT_REACHED');
      this.pushTranscript('receptionist', reply);
      return { reply, configured: false, messageTaken: false };
    }
    let first;
    try {
      first = await openaiChat(messages, toolsForMode(this.mode));
    } catch {
      // Provider failure (rate limit, network): fail safe to message-take.
      first = { configured: false, message: null };
    }
    if (!first.configured) {
      await this.recordModelTurn('failed', undefined, 'OPENAI_UNAVAILABLE');
      if (this.mode === 'receptionist') this.pendingMessageTake = true;
      const reply = providerUnavailableReply(this.mode);
      this.pushTranscript('receptionist', reply);
      return { reply, configured: false, messageTaken: false };
    }

    let assistantMessage = first.message!;
    if (this.mode === 'receptionist' && assistantMessage.tool_calls?.length) {
      const call = assistantMessage.tool_calls[0];
      if (call.function.name === 'request_handoff') {
        let args: { reason?: string } = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        if (this.context?.profile.allow_warm_transfer && this.context.profile.transfer_number) {
          const reason = String(args.reason || 'Caller requested a person.').slice(0, 300);
          const reply = 'I will transfer you to the team now.';
          await this.recordModelTurn('completed', first.usage);
          this.pushTranscript('receptionist', reply);
          return { reply, configured: true, messageTaken: false, handoff: { reason } };
        }
      }
      if (call.function.name === 'take_message') {
        let args: { callback_name?: string; callback_number?: string; reason?: string } = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        const note = await recordMessageTake(this.context!, this.fromNumber, args, `receptionist:${this.callSid}:message:${this.turnNumber}`);
        this.messageTaken = true;
        messages.push(assistantMessage as never);
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Message recorded for the team. Confirm to the caller in one short sentence.` });
        let second;
        try {
          second = await openaiChat(messages, toolsForMode(this.mode));
        } catch {
          second = { configured: false, message: null };
        }
        const reply = second.configured && second.message?.content ? second.message.content : `Thank you — I've passed your message to the team and they'll be in touch.`;
        const combinedUsage = {
          promptTokens: Number(first.usage?.promptTokens || 0) + Number(second.usage?.promptTokens || 0),
          completionTokens: Number(first.usage?.completionTokens || 0) + Number(second.usage?.completionTokens || 0),
          totalTokens: Number(first.usage?.totalTokens || 0) + Number(second.usage?.totalTokens || 0),
        };
        await this.recordModelTurn('completed', combinedUsage);
        this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
        this.pushTranscript('receptionist', reply);
        return { reply, configured: true, messageTaken: true, note };
      }
    }

    const reply = (assistantMessage.content || 'Could you say that again for me?').slice(0, 600);
    await this.recordModelTurn('completed', first.usage);
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    this.pushTranscript('receptionist', reply);
    return { reply, configured: true, messageTaken: false };
  }

  async finalize(retainSummary = false): Promise<string | null> {
    const summary = this.transcript.slice(-12).join(' | ').slice(0, 2000);
    const finalSummary = this.messageTaken ? `[message taken] ${summary}`.slice(0, 2000) : summary;
    try {
      const outcome = this.callEnded ? 'call_limit_reached' : this.messageTaken ? 'message_taken' : 'completed';
      const patch: Record<string, unknown> = { summary: retainSummary ? finalSummary : null, updated_at: new Date().toISOString(), outcome, turn_count: this.turnNumber };
      await supabaseAdmin.from('calls').update(patch).eq('workspace_id', this.workspaceId).eq('provider_call_id', this.callSid);
      await writeNotification(this.workspaceId, 'receptionist.call_handled', 'AI receptionist handled a call', this.messageTaken ? 'A callback request was captured for the team.' : 'The call ended without a retained transcript.');
    } catch {
      // Without the service-role key the summary stays in memory only.
    }
    return finalSummary;
  }
}

// ---------- Text-mode preview: the same engine, no phone required ----------

export async function simulateAdminTurn(workspaceId: string, userText: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = [], fromNumber: string | null = null, mode: AdminMode = 'receptionist', callId?: string): Promise<{ reply: string; configured: boolean; messageTaken: boolean; profileFound: boolean; mode: AdminMode }> {
  const context = await fetchCallContext(workspaceId);
  const session = new ReceptionistSession({ workspaceId, callSid: callId || `simulate-${crypto.randomUUID()}`, fromNumber, history, mode });
  await session.loadContext();
  const result = await session.handleUserText(userText);
  return { reply: result.reply, configured: result.configured, messageTaken: result.messageTaken, profileFound: Boolean(context), mode };
}

// Backwards-compatible alias for the receptionist text preview.
export const simulateReceptionistTurn = simulateAdminTurn;
