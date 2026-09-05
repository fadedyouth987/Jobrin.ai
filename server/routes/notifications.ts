import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const [{ data: notifications, error }, { count: unreadCount, error: unreadError }] = await Promise.all([
    db.from('notifications').select('id,type,title,body,resource_type,resource_id,read_at,created_at').eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(50),
    db.from('notifications').select('id', { count: 'exact', head: true }).eq('workspace_id', req.workspaceId!).is('read_at', null),
  ]);
  if (error || unreadError) return res.status(500).json({ error: 'NOTIFICATION_LIST_FAILED' });
  res.json({ notifications: notifications ?? [], unreadCount: unreadCount ?? 0 });
}));

router.post('/read-all', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { error } = await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('workspace_id', req.workspaceId!).is('read_at', null);
  if (error) return res.status(500).json({ error: 'NOTIFICATION_UPDATE_FAILED' });
  res.json({ ok: true });
}));

router.post('/:id/read', validateBody(z.object({}).strict()), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('notifications').update({ read_at: new Date().toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).is('read_at', null).select('id').maybeSingle();
  if (error) return res.status(500).json({ error: 'NOTIFICATION_UPDATE_FAILED' });
  if (!data) return res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
  res.json({ ok: true });
}));

export default router;