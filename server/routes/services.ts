import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

const serviceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(3000).default(''),
  category: z.string().trim().max(100).nullable().optional(),
  booking_type: z.enum(['bookable','quote','enquiry']).default('bookable'),
  default_duration_minutes: z.number().int().min(5).max(1440).default(60),
  pricing_mode: z.enum(['fixed','starting_from','hourly','callout_hourly','range','quote']).default('quote'),
  base_price_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  price_max_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
  requires_deposit: z.boolean().default(false),
  deposit_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('services').select('*').eq('workspace_id', req.workspaceId!).order('name');
  if (error) return res.status(500).json({ error: 'SERVICE_LIST_FAILED' });
  res.json({ services: data ?? [] });
}));

router.post('/', requireRole('owner','admin','manager'), validateBody(serviceSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('services').insert({ ...req.body, workspace_id: req.workspaceId! }).select('*').single();
  if (error) return res.status(400).json({ error: 'SERVICE_CREATE_FAILED', message: error.message });
  await db.from('onboarding_progress').upsert({ workspace_id: req.workspaceId!, step_key: 'services', status: 'complete', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await writeAudit(req, 'service.created', 'service', data.id);
  res.status(201).json({ service: data });
}));

export default router;
