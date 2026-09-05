// Assets & Service History: per-customer asset register with service tracking.
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

const assetSchema = z.object({
  customer_id: z.string().uuid(),
  name: z.string().trim().min(2).max(200),
  asset_type: z.string().trim().min(1).max(100),
  make: z.string().trim().max(160).nullable().optional(),
  model: z.string().trim().max(160).nullable().optional(),
  serial_number: z.string().trim().max(160).nullable().optional(),
  installed_at: z.string().date().nullable().optional(),
  warranty_expires_at: z.string().date().nullable().optional(),
});

router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const customerId = String(req.query.customer_id || '');
  let query = db.from('customer_assets').select('id,customer_id,name,asset_type,make,model,serial_number,installed_at,warranty_expires_at,created_at,updated_at,customers(display_name)').eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(200);
  if (customerId && /^[0-9a-f-]{36}$/i.test(customerId)) query = query.eq('customer_id', customerId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'ASSET_LIST_FAILED' });
  res.json({ assets: data ?? [] });
}));

router.post('/', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(assetSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: customer } = await db.from('customers').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.body.customer_id).is('deleted_at', null).maybeSingle();
  if (!customer) return res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
  const { data, error } = await db.from('customer_assets').insert({ ...req.body, workspace_id: req.workspaceId! }).select('*').single();
  if (error) return res.status(400).json({ error: 'ASSET_CREATE_FAILED', message: error.message });
  res.status(201).json({ asset: data });
}));

router.patch('/:id', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(assetSchema.partial()), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('customer_assets').update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'ASSET_UPDATE_FAILED', message: error.message });
  if (!data) return res.status(404).json({ error: 'ASSET_NOT_FOUND' });
  res.json({ asset: data });
}));

export default router;