import { Router } from 'express';
import twilio from 'twilio';
import { z } from 'zod';
import { env } from '../env';
import { buildApprovedContextSnapshot, fetchCallContext, issueCallToken, isReceptionistEngineAttached, signApprovedContextSnapshot, simulateAdminTurn, verifyApprovedContextSnapshot, type ApprovedContextSnapshot } from '../ai/receptionistCall';
import { normalizeE164, twilioConfigured } from '../providers/twilio';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { twilioSignatureGuard } from './communications';

const router = Router();
const webhookRouter = Router();

const profileSchema = z.object({
  enabled: z.boolean(), display_name: z.string().trim().min(2).max(80), greeting: z.string().trim().min(10).max(500),
  voice_provider: z.enum(['Google','Amazon','ElevenLabs']), voice_id: z.string().trim().min(2).max(120),
  language: z.string().trim().min(2).max(20), tone: z.string().trim().min(3).max(200),
  business_instructions: z.string().trim().min(20).max(6000), qualification_questions: z.array(z.string().trim().min(2).max(300)).max(20),
  transfer_number: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).nullable(), after_hours_message: z.string().trim().min(10).max(500),
  allow_booking: z.boolean(), allow_warm_transfer: z.boolean(), allow_message_take: z.boolean(), allow_followup_sms: z.boolean(),
  recording_enabled: z.boolean(), recording_consent_prompt: z.string().trim().min(10).max(500),
  approved_pricing_language: z.string().trim().min(3).max(500).refine((value) => !(/[$£€]\s*\d|\b\d+(?:\.\d{1,2})?\s*(?:aud|dollars?|pounds?|euros?)\b/i.test(value)), 'Use general pricing language without a dollar figure.'),
  custom_escalation_rules: z.array(z.string().trim().min(3).max(300)).max(20),
  callback_window: z.string().trim().min(3).max(160), after_hours_rule: z.string().trim().min(3).max(500),
  max_concurrent_calls: z.number().int().min(1).max(5), max_calls_per_caller_hour: z.number().int().min(1).max(6),
  max_call_minutes: z.number().int().min(5).max(30), max_call_turns: z.number().int().min(10).max(80),
});

function websocketUrl() {
  const url = new URL(env.APP_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/receptionist/conversation';
  url.search = '';
  return url.toString();
}

router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));
router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('receptionist_profiles').select('*').eq('workspace_id', req.workspaceId!).maybeSingle();
  if (error) return res.status(500).json({ error: 'RECEPTIONIST_PROFILE_LOAD_FAILED' });
  res.json({ profile: data, readiness: {
    twilio: twilioConfigured(), ai: Boolean(env.OPENAI_API_KEY), securePublicUrl: env.APP_URL.startsWith('https://'),
    conversationRelay: isReceptionistEngineAttached(), signedContext: Boolean(env.RECEPTIONIST_SIGNING_SECRET.length >= 32 || !env.isProduction),
  }});
}));

router.get('/calls', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('calls')
    .select('id,direction,status,from_number,to_number,started_at,ended_at,duration_seconds,summary,answered_by,outcome,turn_count')
    .eq('workspace_id', req.workspaceId!).order('started_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: 'CALL_LIST_FAILED' });
  res.json({ calls: data ?? [] });
}));

router.get('/calls/:id', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const callId = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(callId)) return res.status(404).json({ error: 'CALL_NOT_FOUND' });
  const db = createUserClient(req.auth!.accessToken);
  const [{ data: call, error }, { data: actions }] = await Promise.all([
    db.from('calls').select('id,direction,status,from_number,to_number,started_at,ended_at,duration_seconds,summary,transcript,answered_by,outcome,turn_count').eq('workspace_id', req.workspaceId!).eq('id', callId).maybeSingle(),
    db.from('ai_actions').select('id,tool_name,status,error_code,created_at,completed_at').eq('workspace_id', req.workspaceId!).eq('call_id', callId).order('created_at'),
  ]);
  if (error || !call) return res.status(404).json({ error: 'CALL_NOT_FOUND' });
  res.json({ call, actions: actions ?? [] });
}));

router.put('/', requireRole('owner','admin'), requireSensitiveAuth, validateBody(profileSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (req.body.allow_booking || req.body.allow_followup_sms || req.body.recording_enabled) {
    return res.status(409).json({ error: 'RECEPTIONIST_PHASE_NOT_ENABLED', message: 'Booking, outbound SMS, and continuous recording are not available in Phase 1.' });
  }
  if (req.body.enabled) {
    // Fail closed: live answering unlocks only when every dependency is real.
    const missing: string[] = [];
    if (!twilioConfigured()) missing.push('Twilio number');
    if (!env.OPENAI_API_KEY) missing.push('AI engine (OpenAI key)');
    if (!env.APP_URL.startsWith('https://')) missing.push('public HTTPS address');
    if (!isReceptionistEngineAttached()) missing.push('conversation engine');
    if (env.RECEPTIONIST_SIGNING_SECRET.length < 32 && env.isProduction) missing.push('receptionist signing secret');
    if (missing.length) {
      return res.status(409).json({ error: 'RECEPTIONIST_NOT_READY', message: `Live answering stays locked until: ${missing.join(', ')}.` });
    }
  }
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('receptionist_profiles').upsert({ ...req.body, workspace_id: req.workspaceId!, updated_at: new Date().toISOString() }).select('*').single();
  if (error) return res.status(400).json({ error: 'RECEPTIONIST_PROFILE_SAVE_FAILED' });
  await writeAudit(req, 'receptionist.profile_updated', 'receptionist_profile', req.workspaceId!, { enabled: data.enabled, voice: data.voice_id });
  res.json({ profile: data });
}));

const simulateSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(1000) })).max(16).default([]),
  mode: z.enum(['receptionist', 'finance', 'sales', 'marketing', 'support']).default('receptionist'),
}).strict();

// Text-mode preview of the exact engine a phone call uses. Owner/admin/manager
// only; never sends anything and never touches the phone network.
router.post('/simulate', requireRole('owner', 'admin', 'manager'), validateBody(simulateSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const result = await simulateAdminTurn(req.workspaceId!, req.body.message, req.body.history, null, req.body.mode);
  await writeAudit(req, 'receptionist.simulated', 'receptionist_profile', req.workspaceId!, { configured: result.configured, messageTaken: result.messageTaken });
  res.json(result);
}));

webhookRouter.post('/voice', twilioSignatureGuard('/api/twilio/voice'), asyncRoute(async (req, res) => {
  const to = normalizeE164(String(req.body.To ?? ''));
  const from = normalizeE164(String(req.body.From ?? ''));
  const callSid = String(req.body.CallSid ?? '');
  const { data: integration } = await supabaseAdmin.from('integrations').select('workspace_id').eq('provider','twilio').eq('external_account_id',to).eq('status','connected').maybeSingle();
  if (!integration || !callSid) return res.status(404).type('text/xml').send(new twilio.twiml.VoiceResponse().toString());
  const { data: profile } = await supabaseAdmin.from('receptionist_profiles').select('*').eq('workspace_id', integration.workspace_id).maybeSingle();
  const response = new twilio.twiml.VoiceResponse();
  if (!profile?.enabled || !env.OPENAI_API_KEY || !env.APP_URL.startsWith('https://')) {
    response.say({ language: 'en-AU' }, profile?.after_hours_message || 'Thanks for calling. The team is unavailable right now. Please try again later.');
    return res.type('text/xml').send(response.toString());
  }
  const context = await fetchCallContext(integration.workspace_id);
  if (!context) {
    response.say({ language: 'en-AU' }, 'Thanks for calling. The team is unavailable right now. Please try again later.');
    return res.type('text/xml').send(response.toString());
  }
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: activeCalls }, { count: callerCalls }] = await Promise.all([
    supabaseAdmin.from('calls').select('id', { count: 'exact', head: true }).eq('workspace_id', integration.workspace_id).eq('status', 'in_progress'),
    supabaseAdmin.from('calls').select('id', { count: 'exact', head: true }).eq('workspace_id', integration.workspace_id).eq('from_number', from).gte('started_at', since),
  ]);
  if ((activeCalls || 0) >= (profile.max_concurrent_calls || 5) || (callerCalls || 0) >= (profile.max_calls_per_caller_hour || 6)) {
    response.say({ language: 'en-AU' }, profile.after_hours_message || 'The team cannot take this call right now. Please try again later.');
    return res.type('text/xml').send(response.toString());
  }
  const snapshot = buildApprovedContextSnapshot(context);
  const signedSnapshot = signApprovedContextSnapshot(snapshot);
  const { error: callStartError } = await supabaseAdmin.from('calls').upsert({ workspace_id: integration.workspace_id, provider: 'twilio', provider_call_id: callSid, direction: 'inbound', from_number: from, to_number: to, status: 'in_progress', answered_by: 'ai_receptionist', started_at: new Date().toISOString(), recording_status: 'off', context_snapshot: snapshot, context_snapshot_hash: signedSnapshot.hash, context_snapshot_signature: signedSnapshot.signature }, { onConflict: 'workspace_id,provider,provider_call_id' });
  if (callStartError) {
    response.say({ language: 'en-AU' }, 'The team cannot take this call right now. Please try again later.');
    return res.type('text/xml').send(response.toString());
  }
  const callToken = issueCallToken(integration.workspace_id, callSid, to, signedSnapshot.hash);
  const greeting = /\b(ai|virtual|automated)\b/i.test(snapshot.greeting) ? snapshot.greeting : `${snapshot.greeting} I'm the virtual receptionist.`;
  const connect = response.connect({ action: `${env.APP_URL.replace(/\/$/,'')}/api/twilio/voice/complete` });
  const relay = connect.conversationRelay({ url: `${websocketUrl()}?token=${encodeURIComponent(callToken)}`, welcomeGreeting: greeting, language: profile.language, ttsProvider: profile.voice_provider, voice: profile.voice_id, interruptible: 'any', dtmfDetection: true } as never);
  relay.parameter({ name: 'callSid', value: callSid });
  relay.parameter({ name: 'fromNumber', value: from });
  relay.parameter({ name: 'toNumber', value: to });
  res.type('text/xml').send(response.toString());
}));

webhookRouter.post('/voice/complete', twilioSignatureGuard('/api/twilio/voice/complete'), asyncRoute(async (req, res) => {
  const callSid = String(req.body.CallSid ?? '');
  const response = new twilio.twiml.VoiceResponse();
  let handoff = false;
  try {
    const data = JSON.parse(String(req.body.HandoffData || '{}')) as { reasonCode?: string };
    handoff = data.reasonCode === 'live-agent-handoff';
  } catch { handoff = false; }
  if (callSid) {
    const { data: call } = await supabaseAdmin.from('calls').select('workspace_id,context_snapshot,context_snapshot_hash,context_snapshot_signature').eq('provider','twilio').eq('provider_call_id',callSid).maybeSingle();
    await supabaseAdmin.from('calls').update({ status: handoff ? 'transferring' : String(req.body.SessionStatus ?? req.body.CallStatus ?? 'completed'), ended_at: handoff ? null : new Date().toISOString(), duration_seconds: Number(req.body.SessionDuration || 0), outcome: handoff ? 'warm_transfer' : undefined }).eq('provider','twilio').eq('provider_call_id',callSid);
    if (handoff && call?.workspace_id) {
      const callSnapshot = call.context_snapshot as ApprovedContextSnapshot | null;
      const snapshotValid = Boolean(callSnapshot && verifyApprovedContextSnapshot(callSnapshot, String(call.context_snapshot_hash || ''), String(call.context_snapshot_signature || '')));
      const transferNumber = snapshotValid ? callSnapshot?.transferNumber : null;
      if (transferNumber) {
        response.say({ language: 'en-AU' }, 'Connecting you now.');
        response.dial({ answerOnBridge: true, action: `${env.APP_URL.replace(/\/$/,'')}/api/twilio/voice/transfer-complete`, method: 'POST' }, transferNumber);
      }
    }
  }
  res.type('text/xml').send(response.toString());
}));

webhookRouter.post('/voice/transfer-complete', twilioSignatureGuard('/api/twilio/voice/transfer-complete'), asyncRoute(async (req, res) => {
  const callSid = String(req.body.CallSid ?? '');
  const dialStatus = String(req.body.DialCallStatus || 'unknown');
  if (callSid) await supabaseAdmin.from('calls').update({ status: 'completed', ended_at: new Date().toISOString(), outcome: dialStatus === 'completed' ? 'warm_transfer_completed' : `warm_transfer_${dialStatus}`.slice(0, 80) }).eq('provider', 'twilio').eq('provider_call_id', callSid);
  const response = new twilio.twiml.VoiceResponse();
  if (dialStatus !== 'completed') response.say({ language: 'en-AU' }, 'I could not connect the call. Please call the business again shortly.');
  res.type('text/xml').send(response.toString());
}));

export { webhookRouter as receptionistWebhookRouter };
export default router;
