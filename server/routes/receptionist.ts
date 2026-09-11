import { Router } from 'express';
import twilio from 'twilio';
import { z } from 'zod';
import { env } from '../env';
import { issueCallToken, isReceptionistEngineAttached, simulateAdminTurn } from '../ai/receptionistCall';
import { evaluateGoLiveChecklist } from '../ai/receptionistReadiness';
import { normalizeE164, twilioConfigured } from '../providers/twilio';
import { openaiConfigured } from '../providers/openai';
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
});

function websocketUrl() {
  const url = new URL(env.APP_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/receptionist/conversation';
  url.search = '';
  return url.toString();
}

router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

// Technical provider readiness + the architecture's go-live checklist (profile,
// approved knowledge, transfer number, recording consent, owner sign-off).
router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const [profileResult, businessResult, knowledgeCount, signoffResult] = await Promise.all([
    db.from('receptionist_profiles').select('*').eq('workspace_id', req.workspaceId!).maybeSingle(),
    db.from('business_profiles').select('trading_name,phone,suburb,state').eq('workspace_id', req.workspaceId!).maybeSingle(),
    db.from('knowledge_documents').select('id', { count: 'exact', head: true }).eq('workspace_id', req.workspaceId!).eq('approved', true),
    db.from('approvals').select('decision_note,decided_by,decided_at')
      .eq('workspace_id', req.workspaceId!).eq('resource_type', 'receptionist.go_live').eq('status', 'approved')
      .order('decided_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (profileResult.error) return res.status(500).json({ error: 'RECEPTIONIST_PROFILE_LOAD_FAILED' });
  const technical = {
    twilio: twilioConfigured(), ai: openaiConfigured(), securePublicUrl: env.APP_URL.startsWith('https://'),
    conversationRelay: isReceptionistEngineAttached(),
  };
  const goLive = evaluateGoLiveChecklist({
    profile: profileResult.data, businessProfile: businessResult.data ?? null,
    approvedKnowledgeCount: knowledgeCount.count ?? 0, technical,
    signoff: signoffResult.data ?? null,
  });
  res.json({ profile: profileResult.data, readiness: technical, goLive });
}));

router.get('/calls', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('calls')
    .select('id,direction,status,from_number,to_number,started_at,ended_at,duration_seconds,summary,answered_by')
    .eq('workspace_id', req.workspaceId!).order('started_at', { ascending: false }).limit(50);
  if (error) return res.status(500).json({ error: 'CALL_LIST_FAILED' });
  res.json({ calls: data ?? [] });
}));

router.put('/', requireRole('owner','admin'), requireSensitiveAuth, validateBody(profileSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (req.body.enabled) {
    // Fail closed: live answering unlocks only when every dependency is real.
    const missing: string[] = [];
    if (!twilioConfigured()) missing.push('Twilio number');
    if (!openaiConfigured()) missing.push('AI engine (OpenAI key)');
    if (!env.APP_URL.startsWith('https://')) missing.push('public HTTPS address');
    if (!isReceptionistEngineAttached()) missing.push('conversation engine');
    if (missing.length) {
      return res.status(409).json({ error: 'RECEPTIONIST_NOT_READY', message: `Live answering stays locked until: ${missing.join(', ')}.` });
    }
    // Architecture go-live checklist: the owner must have recorded sign-off
    // after reviewing the setup and phase-1 behaviour. Technical readiness
    // alone never unlocks live answering.
    const { data: signoffRow, error: signoffError } = await supabaseAdmin.from('approvals')
      .select('id')
      .eq('workspace_id', req.workspaceId!).eq('resource_type', 'receptionist.go_live').eq('status', 'approved')
      .limit(1).maybeSingle();
    if (signoffError) return res.status(500).json({ error: 'RECEPTIONIST_SIGNOFF_CHECK_FAILED' });
    if (!signoffRow) {
      return res.status(409).json({ error: 'RECEPTIONIST_SIGNOFF_REQUIRED', message: 'Live answering unlocks only after the workspace owner reviews the go-live checklist and records sign-off.' });
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

// Auditable owner sign-off for live answering. Records who approved, when and
// with what review note — an approvals row, not a hidden flag. Blocked until
// every other go-live checklist item is green.
const signoffSchema = z.object({ note: z.string().trim().min(20).max(2000) }).strict();

router.post('/go-live-signoff', requireRole('owner'), requireSensitiveAuth, validateBody(signoffSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const [profileResult, businessResult, knowledgeCount] = await Promise.all([
    db.from('receptionist_profiles').select('transfer_number,recording_enabled,recording_consent_prompt').eq('workspace_id', req.workspaceId!).maybeSingle(),
    db.from('business_profiles').select('trading_name,phone,suburb,state').eq('workspace_id', req.workspaceId!).maybeSingle(),
    db.from('knowledge_documents').select('id', { count: 'exact', head: true }).eq('workspace_id', req.workspaceId!).eq('approved', true),
  ]);
  if (profileResult.error) return res.status(500).json({ error: 'RECEPTIONIST_PROFILE_LOAD_FAILED' });
  const checklist = evaluateGoLiveChecklist({
    profile: profileResult.data,
    businessProfile: businessResult.data ?? null,
    approvedKnowledgeCount: knowledgeCount.count ?? 0,
    technical: {
      twilio: twilioConfigured(), ai: openaiConfigured(),
      securePublicUrl: env.APP_URL.startsWith('https://'), conversationRelay: isReceptionistEngineAttached(),
    },
  });
  const blocking = checklist.missing.filter((label) => label !== 'Owner sign-off recorded');
  if (blocking.length) {
    return res.status(409).json({ error: 'RECEPTIONIST_SIGNOFF_BLOCKED', message: `Sign-off is blocked until: ${blocking.join(', ')}.`, checklist: checklist.items });
  }
  const now = new Date().toISOString();
  const { data: record, error } = await supabaseAdmin.from('approvals').insert({
    workspace_id: req.workspaceId!, resource_type: 'receptionist.go_live', resource_id: req.workspaceId!,
    reason: req.body.note, status: 'approved', decided_by: req.auth!.userId, decided_at: now,
  }).select('id,resource_type,reason,status,decided_by,decided_at').single();
  if (error) return res.status(500).json({ error: 'RECEPTIONIST_SIGNOFF_FAILED' });
  await writeAudit(req, 'receptionist.go_live_signed', 'receptionist_profile', req.workspaceId!, { review_note: 'Owner recorded go-live sign-off.' });
  res.status(201).json({ signoff: { decided_at: now, decided_by: req.auth!.userId, decision_note: req.body.note }, record });
}));

// Text-mode preview of the exact engine a phone call uses. Owner/admin/manager
// only; never sends anything and never touches the phone network.
router.post('/simulate', requireRole('owner', 'admin', 'manager'), validateBody(simulateSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const result = await simulateAdminTurn(req.workspaceId!, req.body.message, req.body.history, null, req.body.mode, `simulate-${req.requestId}`);
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
  await supabaseAdmin.from('calls').upsert({ workspace_id: integration.workspace_id, provider: 'twilio', provider_call_id: callSid, direction: 'inbound', from_number: from, to_number: to, status: 'in_progress', answered_by: 'ai_receptionist', started_at: new Date().toISOString(), recording_status: profile.recording_enabled ? 'pending_consent' : 'off' }, { onConflict: 'workspace_id,provider,provider_call_id' });
  const callToken = issueCallToken(integration.workspace_id, callSid);
  const connect = response.connect({ action: `${env.APP_URL.replace(/\/$/,'')}/api/twilio/voice/complete` });
  const relay = connect.conversationRelay({ url: `${websocketUrl()}?token=${encodeURIComponent(callToken)}`, welcomeGreeting: profile.greeting, language: profile.language, ttsProvider: profile.voice_provider, voice: profile.voice_id, interruptible: 'any' });
  relay.parameter({ name: 'workspaceId', value: integration.workspace_id });
  relay.parameter({ name: 'callSid', value: callSid });
  relay.parameter({ name: 'fromNumber', value: from });
  res.type('text/xml').send(response.toString());
}));

webhookRouter.post('/voice/complete', twilioSignatureGuard('/api/twilio/voice/complete'), asyncRoute(async (req, res) => {
  const callSid = String(req.body.CallSid ?? '');
  if (callSid) await supabaseAdmin.from('calls').update({ status: String(req.body.SessionStatus ?? req.body.CallStatus ?? 'completed'), ended_at: new Date().toISOString(), duration_seconds: Number(req.body.SessionDuration || 0) }).eq('provider','twilio').eq('provider_call_id',callSid);
  res.type('text/xml').send(new twilio.twiml.VoiceResponse().toString());
}));

export { webhookRouter as receptionistWebhookRouter };
export default router;
