import { Router } from 'express';
import { asyncRoute } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { requireTwilioConfig, twilioConfigured } from '../providers/twilio';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('integrations').select('id,provider,status,external_account_id,scopes,last_success_at,last_error_at,error_code,connected_at,updated_at').eq('workspace_id', req.workspaceId!).order('provider');
  if (error) return res.status(500).json({ error: 'INTEGRATION_LIST_FAILED' });
  res.json({ integrations: data ?? [] });
}));

router.post('/twilio/activate', requireRole('owner', 'admin'), requireSensitiveAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!twilioConfigured()) return res.status(503).json({ error: 'TWILIO_NOT_CONFIGURED' });
  const { phoneNumber } = requireTwilioConfig();
  const { data: owner, error: ownerError } = await supabaseAdmin.from('integrations').select('workspace_id')
    .eq('provider', 'twilio').eq('external_account_id', phoneNumber)
    .in('status', ['connecting', 'connected', 'degraded']).neq('workspace_id', req.workspaceId!).maybeSingle();
  if (ownerError) return res.status(500).json({ error: 'TWILIO_NUMBER_CHECK_FAILED' });
  if (owner) return res.status(409).json({ error: 'TWILIO_NUMBER_ALREADY_ASSIGNED' });

  const { data, error } = await supabaseAdmin.from('integrations').upsert({
    workspace_id: req.workspaceId!, provider: 'twilio', status: 'connected', external_account_id: phoneNumber,
    scopes: ['messaging'], encrypted_credentials: null, connected_by: req.auth!.userId,
    connected_at: new Date().toISOString(), last_success_at: new Date().toISOString(), error_code: null,
  }, { onConflict: 'workspace_id,provider,external_account_id' }).select('id,provider,status,external_account_id,scopes,connected_at').single();
  if (error) return res.status(500).json({ error: 'TWILIO_ACTIVATION_FAILED' });
  await writeAudit(req, 'integration.twilio_activated', 'integration', data.id, { phoneNumber: data.external_account_id });
  res.status(201).json({ integration: data });
}));

export default router;
