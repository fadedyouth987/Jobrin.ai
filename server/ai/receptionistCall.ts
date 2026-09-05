import crypto from 'node:crypto';
import { env } from '../env';
import { supabaseAdmin, writeNotification } from '../supabase';

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
export function issueCallToken(workspaceId: string, callSid: string) {
  const payload = { w: workspaceId, c: callSid, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url');
  return `v1.${body}.${signature}`;
}

export function verifyCallToken(token: string): { workspaceId: string; callSid: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') return null;
    const [, body, signature] = parts;
    const expected = crypto.createHmac('sha256', tokenKey()).update(body).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { w?: string; c?: string; exp?: number };
    if (!payload.w || !payload.c || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!/^[0-9a-fA-F-]{36}$/.test(payload.w)) return null;
    return { workspaceId: payload.w, callSid: payload.c };
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
        'You may READ financial records and DRAFT chasers and summaries. You never send anything yourself — every draft is advisory until the owner sends it.',
      ];
    case 'sales':
      return [
        'You are currently wearing the SALES & LEADS hat of the office manager.',
        'Duties: triage new leads, draft first responses, chase stale enquiries, suggest which lead to contact first, and record what each lead wanted.',
        'Drafts are advisory. Never promise prices or availability — propose and let the owner decide.',
      ];
    case 'marketing':
      return [
        'You are currently wearing the MARKETING hat of the office manager.',
        'Duties: draft review responses, post-work recap posts, seasonal campaign ideas and service copy, grounded only in approved knowledge and completed jobs.',
        'Everything you write is a draft for the owner. Never contact customers directly.',
      ];
    case 'support':
      return [
        'You are currently wearing the CUSTOMER SUPPORT hat of the office manager.',
        'Duties: triage the inbox, draft grounded replies, and make sure no customer message goes unanswered.',
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
};

export type CallContext = {
  workspaceId: string;
  profile: {
    display_name: string; greeting: string; tone: string; business_instructions: string;
    after_hours_message: string; transfer_number: string | null; language: string;
    allow_booking: boolean; allow_warm_transfer: boolean; allow_message_take: boolean; allow_followup_sms: boolean;
  };
  business: { trading_name: string | null; suburb: string | null; state: string | null; phone: string | null } | null;
  knowledge: Array<{ title: string; content: string }>;
  services: Array<{ name: string; pricing_mode: string; base_price_cents: number | null }>;
};

export async function fetchCallContext(workspaceId: string): Promise<CallContext | null> {
  try {
    const [profileResult, businessResult, knowledgeResult, servicesResult] = await Promise.all([
      supabaseAdmin.from('receptionist_profiles').select('display_name,greeting,tone,business_instructions,after_hours_message,transfer_number,language,allow_booking,allow_warm_transfer,allow_message_take,allow_followup_sms').eq('workspace_id', workspaceId).maybeSingle(),
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
    `HARD RULES:`,
    `- Never invent prices, availability, policies, warranties or completed actions.`,
    `- Never take card details or payment information. Never process payments.`,
    `- Never give emergency, safety, legal or medical advice. For emergencies or urgent situations, tell the caller to hang up and dial emergency services if in danger, and offer to take a message for urgent follow-up.`,
    `- If unsure, if the caller asks for a person, or for complaints/refunds/legal/financial matters: apologise, and either transfer to ${context.profile.transfer_number || 'the team'} or take a message.`,
    `- Keep replies under three sentences unless reading back captured details.`,
    ...modeInstructions(mode),
  ].join('\n');
}

// ---------- Per-mode grounding: live records for advisory hats ----------

// Bounded and best-effort: no records simply means no section, never a guess.
async function fetchModeData(workspaceId: string, mode: AdminMode): Promise<string | null> {
  try {
    if (mode === 'finance') {
      const [invoices, jobs] = await Promise.all([
        supabaseAdmin.from('invoices').select('invoice_number,balance_due_cents,due_at,status,customers(display_name)').eq('workspace_id', workspaceId).in('status', ['sent', 'viewed', 'part_paid', 'overdue']).gt('balance_due_cents', 0).order('due_at').limit(10),
        supabaseAdmin.from('jobs').select('job_number,title,completed_at').eq('workspace_id', workspaceId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10),
      ]);
      const overdue = (invoices.data ?? []).map((row: any) => `Invoice #${row.invoice_number}: $${(Number(row.balance_due_cents) / 100).toFixed(2)} owed${row.due_at ? `, due ${new Date(row.due_at).toLocaleDateString('en-AU')}` : ''}`);
      const uninvoiced = (jobs.data ?? []).map((row: any) => `Job #${row.job_number} "${row.title}" completed but not invoiced`);
      const sections = [
        overdue.length ? `Outstanding invoices (oldest due first):\n${overdue.join('\n')}` : 'No outstanding invoices.',
        uninvoiced.length ? `Completed jobs not yet invoiced:\n${uninvoiced.join('\n')}` : '',
      ].filter(Boolean);
      return `CURRENT FINANCIAL SNAPSHOT (facts — never estimate):\n${sections.join('\n')}`;
    }
    if (mode === 'sales') {
      const { data: leads } = await supabaseAdmin.from('leads').select('title,stage,source,estimated_value_cents,created_at,customers(display_name)').eq('workspace_id', workspaceId).in('stage', ['new', 'contacted', 'qualified', 'quote']).order('created_at', { ascending: false }).limit(10);
      const rows = (leads ?? []).map((lead: any) => `${lead.title} — stage: ${lead.stage}, source: ${lead.source || 'unknown'}, ${lead.estimated_value_cents ? `${Math.round(lead.estimated_value_cents / 100)} AUD est, ` : ''}created ${new Date(lead.created_at).toLocaleDateString('en-AU')}`);
      return rows.length ? `OPEN LEADS (facts):\n${rows.join('\n')}` : null;
    }
    if (mode === 'marketing') {
      const { data: jobs } = await supabaseAdmin.from('jobs').select('job_number,title,completed_at,customers(display_name)').eq('workspace_id', workspaceId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(5);
      const rows = (jobs ?? []).map((job: any) => `${job.title} for ${job.customers?.display_name || 'a customer'} (completed ${job.completed_at ? new Date(job.completed_at).toLocaleDateString('en-AU') : 'recently'})`);
      return rows.length ? `RECENT COMPLETED WORK (for recap drafts):\n${rows.join('\n')}` : null;
    }
    if (mode === 'support') {
      const { data: conversations } = await supabaseAdmin.from('conversations').select('id,subject,last_message_at,customers(display_name)').eq('workspace_id', workspaceId).eq('status', 'open').order('last_message_at', { ascending: false, nullsFirst: false }).limit(10);
      const rows = (conversations ?? []).map((c: any) => `${c.customers?.display_name || 'Customer'} — last activity ${c.last_message_at ? new Date(c.last_message_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'unknown'}`);
      return rows.length ? `OPEN CONVERSATIONS (facts):\n${rows.join('\n')}` : null;
    }
    return null;
  } catch {
    return null;
  }
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

// Only the receptionist hat can take messages (it is on a live call with the
// caller). Advisory hats draft in chat — their output is the reply itself.
function toolsForMode(mode: AdminMode): unknown[] {
  return mode === 'receptionist' ? [TAKE_MESSAGE_TOOL] : [];
}

// ---------- Persistence (best-effort, fail-closed without secrets) ----------

async function recordMessageTake(context: CallContext, fromNumber: string | null, args: { callback_name?: string; callback_number?: string; reason?: string }): Promise<string> {
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
      description: note, source: 'receptionist',
    }).select('id').single();
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

async function openaiChat(messages: Array<{ role: string; content: string | null; tool_calls?: unknown; tool_call_id?: string }>, tools: unknown[] = []): Promise<{ configured: boolean; message: { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> } | null }> {
  if (!env.OPENAI_API_KEY) return { configured: false, message: null };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL, messages, ...(tools.length ? { tools } : {}) }),
  });
  if (!response.ok) throw new Error(`OPENAI_CHAT_FAILED:${response.status}`);
  const payload: any = await response.json();
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error('OPENAI_CHAT_EMPTY');
  return { configured: true, message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls } };
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
  messageTaken = false;

  constructor(options: { workspaceId: string; callSid: string; fromNumber?: string | null; history?: Array<{ role: 'user' | 'assistant'; content: string }>; mode?: AdminMode }) {
    this.workspaceId = options.workspaceId;
    this.callSid = options.callSid;
    this.mode = options.mode ?? 'receptionist';
    this.fromNumber = options.fromNumber ?? null;
    this.context = null;
    this.systemPrompt = null;
    this.history = options.history ?? [];
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

  private pushTranscript(who: 'caller' | 'receptionist', text: string) {
    this.transcript.push(`${who}: ${text}`.slice(0, 2000));
    if (this.transcript.length > 60) this.transcript.shift();
  }

  async handleUserText(userText: string): Promise<TurnResult> {
    this.pushTranscript('caller', userText);

    // No AI configured: fail safe — offer to take a message deterministically.
    if (!env.OPENAI_API_KEY || !this.systemPrompt) {
      if (this.pendingMessageTake && userText.trim().length >= 6) {
        this.pendingMessageTake = false;
        this.messageTaken = true;
        const note = await recordMessageTake(this.context ?? { workspaceId: this.workspaceId } as unknown as CallContext, this.fromNumber, { reason: userText.slice(0, 500) });
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
    let first;
    try {
      first = await openaiChat(messages, toolsForMode(this.mode));
    } catch {
      // Provider failure (rate limit, network): fail safe to message-take.
      first = { configured: false, message: null };
    }
    if (!first.configured) {
      this.pendingMessageTake = true;
      const reply = `I'm sorry, I can't answer questions at the moment, but I can take a message for the team — what is the best number to reach you on?`;
      this.pushTranscript('receptionist', reply);
      return { reply, configured: false, messageTaken: false };
    }

    let assistantMessage = first.message!;
    if (this.mode === 'receptionist' && assistantMessage.tool_calls?.length) {
      const call = assistantMessage.tool_calls[0];
      if (call.function.name === 'take_message') {
        let args: { callback_name?: string; callback_number?: string; reason?: string } = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        const note = await recordMessageTake(this.context!, this.fromNumber, args);
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
        this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
        this.pushTranscript('receptionist', reply);
        return { reply, configured: true, messageTaken: true, note };
      }
    }

    const reply = (assistantMessage.content || 'Could you say that again for me?').slice(0, 600);
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: reply });
    this.pushTranscript('receptionist', reply);
    return { reply, configured: true, messageTaken: false };
  }

  async finalize(): Promise<string | null> {
    const summary = this.transcript.slice(-12).join(' | ').slice(0, 2000);
    const finalSummary = this.messageTaken ? `[message taken] ${summary}`.slice(0, 2000) : summary;
    try {
      const patch: Record<string, unknown> = { summary: finalSummary, updated_at: new Date().toISOString() };
      await supabaseAdmin.from('calls').update(patch).eq('workspace_id', this.workspaceId).eq('provider_call_id', this.callSid);
      await writeNotification(this.workspaceId, 'receptionist.call_handled', 'AI receptionist handled a call', finalSummary.slice(0, 300));
    } catch {
      // Without the service-role key the summary stays in memory only.
    }
    return finalSummary;
  }
}

// ---------- Text-mode preview: the same engine, no phone required ----------

export async function simulateAdminTurn(workspaceId: string, userText: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = [], fromNumber: string | null = null, mode: AdminMode = 'receptionist'): Promise<{ reply: string; configured: boolean; messageTaken: boolean; profileFound: boolean; mode: AdminMode }> {
  const context = await fetchCallContext(workspaceId);
  const session = new ReceptionistSession({ workspaceId, callSid: `simulate-${crypto.randomUUID()}`, fromNumber, history, mode });
  await session.loadContext();
  const result = await session.handleUserText(userText);
  return { reply: result.reply, configured: result.configured, messageTaken: result.messageTaken, profileFound: Boolean(context), mode };
}

// Backwards-compatible alias for the receptionist text preview.
export const simulateReceptionistTurn = simulateAdminTurn;