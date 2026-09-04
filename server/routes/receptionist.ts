import { Router } from 'express';
import twilio from 'twilio';
import { z } from 'zod';
import { env } from '../env';
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
    conversationRelay: false,
  }});
}));

router.put('/', requireRole('owner','admin'), requireSensitiveAuth, validateBody(profileSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (req.body.enabled) {
    return res.status(409).json({ error: 'RECEPTIONIST_NOT_READY', message: 'Live answering remains locked until the signed Conversation Relay WebSocket is deployed and passes a test call.' });
  }
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('receptionist_profiles').upsert({ ...req.body, workspace_id: req.workspaceId!, updated_at: new Date().toISOString() }).select('*').single();
  if (error) return res.status(400).json({ error: 'RECEPTIONIST_PROFILE_SAVE_FAILED' });
  await writeAudit(req, 'receptionist.profile_updated', 'receptionist_profile', req.workspaceId!, { enabled: data.enabled, voice: data.voice_id });
  res.json({ profile: data });
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
  const connect = response.connect({ action: `${env.APP_URL.replace(/\/$/,'')}/api/twilio/voice/complete` });
  const relay = connect.conversationRelay({ url: websocketUrl(), welcomeGreeting: profile.greeting, language: profile.language, ttsProvider: profile.voice_provider, voice: profile.voice_id, interruptible: 'any' });
  relay.parameter({ name: 'workspaceId', value: integration.workspace_id });
  relay.parameter({ name: 'callSid', value: callSid });
  res.type('text/xml').send(response.toString());
}));

webhookRouter.post('/voice/complete', twilioSignatureGuard('/api/twilio/voice/complete'), asyncRoute(async (req, res) => {
  const callSid = String(req.body.CallSid ?? '');
  if (callSid) await supabaseAdmin.from('calls').update({ status: String(req.body.SessionStatus ?? req.body.CallStatus ?? 'completed'), ended_at: new Date().toISOString(), duration_seconds: Number(req.body.SessionDuration || 0) }).eq('provider','twilio').eq('provider_call_id',callSid);
  res.type('text/xml').send(new twilio.twiml.VoiceResponse().toString());
}));

export { webhookRouter as receptionistWebhookRouter };
export default router;
