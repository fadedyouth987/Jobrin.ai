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

router.patch('/:id', requireRole('owner','admin','manager'), validateBody(serviceSchema.partial()), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('services')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id)
    .select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'SERVICE_UPDATE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });
  await writeAudit(req, 'service.updated', 'service', data.id);
  res.json({ service: data });
}));

router.post('/:id/archive', requireRole('owner','admin','manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('services')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id)
    .select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'SERVICE_ARCHIVE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });
  await writeAudit(req, 'service.archived', 'service', data.id);
  res.json({ service: data });
}));

router.post('/:id/restore', requireRole('owner','admin','manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('services')
    .update({ active: true, updated_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id)
    .select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'SERVICE_RESTORE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });
  await writeAudit(req, 'service.restored', 'service', data.id);
  res.json({ service: data });
}));

const hourSchema = z.object({
  schedule_type: z.enum(['business','booking','phone','emergency']).default('business'),
  weekday: z.number().int().min(0).max(6),
  opens_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  closes_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(),
  closed: z.boolean().default(false),
});

router.get('/hours', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const scheduleType = z.enum(['business','booking','phone','emergency']).default('business').parse(req.query.scheduleType ?? 'business');
  const { data, error } = await db.from('business_hours').select('*')
    .eq('workspace_id', req.workspaceId!).eq('schedule_type', scheduleType).order('weekday');
  if (error) return res.status(500).json({ error: 'BUSINESS_HOURS_READ_FAILED' });
  res.json({ hours: data ?? [] });
}));

router.put('/hours', requireRole('owner','admin','manager'), validateBody(z.object({
  scheduleType: z.enum(['business','booking','phone','emergency']).default('business'),
  days: z.array(hourSchema.omit({ schedule_type: true })).length(7),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const now = new Date().toISOString();
  const rows = req.body.days.map((day: any) => ({
    ...day, workspace_id: req.workspaceId!, schedule_type: req.body.scheduleType, updated_at: now,
  }));
  const { data, error } = await db.from('business_hours')
    .upsert(rows, { onConflict: 'workspace_id,schedule_type,weekday' })
    .select('*').order('weekday');
  if (error) return res.status(400).json({ error: 'BUSINESS_HOURS_SAVE_FAILED', message: error.message });
  await writeAudit(req, 'business_hours.updated', 'workspace', req.workspaceId, { scheduleType: req.body.scheduleType });
  res.json({ hours: data ?? [] });
}));

const areaSchema = z.object({
  kind: z.enum(['postcode','suburb','radius','exclude']),
  value: z.string().trim().min(1).max(120),
  surcharge_cents: z.number().int().min(0).max(100_000_000).default(0),
});

router.get('/areas', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('service_areas').select('*')
    .eq('workspace_id', req.workspaceId!).order('created_at');
  if (error) return res.status(500).json({ error: 'SERVICE_AREAS_READ_FAILED' });
  res.json({ areas: data ?? [] });
}));

router.post('/areas', requireRole('owner','admin','manager'), validateBody(areaSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('service_areas').insert({ ...req.body, workspace_id: req.workspaceId! }).select('*').single();
  if (error) return res.status(400).json({ error: 'SERVICE_AREA_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'service_area.created', 'service_area', data.id);
  res.status(201).json({ area: data });
}));

router.patch('/areas/:id', requireRole('owner','admin','manager'), validateBody(areaSchema.partial()), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('service_areas')
    .update(req.body)
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id)
    .select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'SERVICE_AREA_UPDATE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'SERVICE_AREA_NOT_FOUND' });
  await writeAudit(req, 'service_area.updated', 'service_area', data.id);
  res.json({ area: data });
}));

router.post('/areas/:id/archive', requireRole('owner','admin','manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('service_areas')
    .update({ active: false })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id)
    .select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'SERVICE_AREA_ARCHIVE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'SERVICE_AREA_NOT_FOUND' });
  await writeAudit(req, 'service_area.archived', 'service_area', data.id);
  res.json({ area: data });
}));

export default router;
