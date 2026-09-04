import { Router } from 'express';
import twilio from 'twilio';
import { z } from 'zod';
import { env } from '../env';
import { issueCallToken, isReceptionistEngineAttached, simulateReceptionistTurn } from '../ai/receptionistCall';
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
    conversationRelay: isReceptionistEngineAttached(),
  }});
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
    if (!env.OPENAI_API_KEY) missing.push('AI engine (OpenAI key)');
    if (!env.APP_URL.startsWith('https://')) missing.push('public HTTPS address');
    if (!isReceptionistEngineAttached()) missing.push('conversation engine');
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
}).strict();

// Text-mode preview of the exact engine a phone call uses. Owner/admin/manager
// only; never sends anything and never touches the phone network.
router.post('/simulate', requireRole('owner', 'admin', 'manager'), validateBody(simulateSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const result = await simulateReceptionistTurn(req.workspaceId!, req.body.message, req.body.history);
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
