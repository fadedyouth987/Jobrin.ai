import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireAuth, requireRole, requireWorkspace, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

router.get('/', requireAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db
    .from('workspace_members')
    .select('role,status,workspaces(id,name,slug,plan,owner_user_id,created_at,updated_at)')
    .eq('user_id', req.auth!.userId)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: 'WORKSPACE_LIST_FAILED' });

  const workspaces = (data ?? []).flatMap((row: any) => {
    const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    return workspace ? [{ ...workspace, role: row.role }] : [];
  });
  res.json({ workspaces });
}));

router.post('/', requireAuth, validateBody(z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().min(3).max(63).optional(),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const base = slugify(req.body.slug || req.body.name);
  const slug = base.length >= 3 ? base : `${base || 'jobrin-ai'}-${Math.random().toString(36).slice(2, 7)}`;
  const { data, error } = await db.rpc('create_workspace', { workspace_name: req.body.name, workspace_slug: slug });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return res.status(409).json({ error: 'WORKSPACE_SLUG_TAKEN' });
    if (/workspace limit/i.test(error.message)) return res.status(429).json({ error: 'WORKSPACE_LIMIT_REACHED', message: 'You have reached the maximum number of trial workspaces for this account.' });
    return res.status(400).json({ error: 'WORKSPACE_CREATE_FAILED', message: error.message });
  }
  res.status(201).json({ workspaceId: data, slug });
}));

router.get('/current', requireAuth, requireWorkspace, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const [{ data: workspace, error: workspaceError }, { data: profile, error: profileError }] = await Promise.all([
    db.from('workspaces').select('id,name,slug,plan,created_at,updated_at').eq('id', req.workspaceId!).single(),
    db.from('business_profiles').select('*').eq('workspace_id', req.workspaceId!).maybeSingle(),
  ]);
  if (workspaceError) return res.status(500).json({ error: 'WORKSPACE_READ_FAILED' });
  if (profileError) return res.status(500).json({ error: 'BUSINESS_PROFILE_READ_FAILED' });
  res.json({ workspace: { ...workspace, role: req.workspaceRole }, businessProfile: profile });
}));

router.put('/business-profile', requireAuth, requireWorkspace, requireRole('owner','admin','manager'), validateBody(z.object({
  trading_name: z.string().trim().min(2).max(160),
  legal_name: z.string().trim().max(200).default(''),
  abn: z.string().trim().max(20).nullable().optional(),
  industry: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  website: z.string().url().max(500).nullable().optional(),
  timezone: z.string().trim().min(3).max(80).default('Australia/Adelaide'),
  gst_registered: z.boolean().default(false),
  description: z.string().trim().max(4000).default(''),
  street_address: z.string().trim().max(250).nullable().optional(),
  suburb: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(60).nullable().optional(),
  postcode: z.string().trim().max(20).nullable().optional(),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const payload = { ...req.body, workspace_id: req.workspaceId!, updated_at: new Date().toISOString() };
  const { data, error } = await db.from('business_profiles').upsert(payload).select('*').single();
  if (error) return res.status(400).json({ error: 'BUSINESS_PROFILE_SAVE_FAILED', message: error.message });
  await db.from('onboarding_progress').upsert({ workspace_id: req.workspaceId!, step_key: 'business', status: 'complete', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await writeAudit(req, 'business.profile.updated', 'workspace', req.workspaceId);
  res.json({ businessProfile: data });
}));

router.get('/onboarding', requireAuth, requireWorkspace, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('onboarding_progress').select('step_key,status,completed_at,updated_at').eq('workspace_id', req.workspaceId!);
  if (error) return res.status(500).json({ error: 'ONBOARDING_READ_FAILED' });
  res.json({ steps: data ?? [] });
}));

export default router;
