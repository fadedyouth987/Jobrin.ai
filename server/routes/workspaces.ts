import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import {
  allowPendingWorkspaceDeletion,
  createUserClient,
  requireAuth,
  requireRole,
  requireSensitiveAuth,
  requireWorkspace,
  supabaseAdmin,
  type AuthenticatedRequest,
  writeAudit,
} from '../supabase';
import { env } from '../env';

const router = Router();

const slugify = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);

// Soft-delete + scheduled hard-purge policy: a 30-day grace window between
// the owner's request and the point the scheduled purge job
// (server/automation/workspacePurge.ts) is allowed to hard-delete the
// workspace. Kept as a named constant so the route, the purge job and the
// tests all agree on the window.
export const WORKSPACE_DELETION_GRACE_DAYS = 30;

export function computeDeletionSchedule(now: Date = new Date()): { requestedAt: string; scheduledFor: string } {
  return {
    requestedAt: now.toISOString(),
    scheduledFor: new Date(now.getTime() + WORKSPACE_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Background/system audit write: the request-account route below acts across
// multiple workspaces the caller owns, so it cannot use writeAudit(req, ...)
// (that helper is scoped to req.workspaceId). Mirrors writeAudit's own
// fail-closed behaviour -- never write through anything but the service role,
// and never throw into the caller's request.
async function writeWorkspaceAudit(
  workspaceId: string,
  actorUserId: string,
  action: string,
  details: Record<string, unknown> = {},
  severity: 'info' | 'warning' | 'critical' = 'info',
) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  await supabaseAdmin.from('audit_logs').insert({
    workspace_id: workspaceId,
    actor_user_id: actorUserId,
    action,
    entity_type: 'workspace',
    entity_id: workspaceId,
    details,
    severity,
  });
}

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

router.post('/onboarding/:step', requireAuth, requireWorkspace, requireRole('owner','admin','manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const parsed = z.enum(['operator','billing','activation']).safeParse(req.params.step);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_ONBOARDING_STEP' });
  const db = createUserClient(req.auth!.accessToken);
  const now = new Date().toISOString();
  const { error } = await db.from('onboarding_progress').upsert({
    workspace_id: req.workspaceId!, step_key: parsed.data, status: 'complete',
    completed_at: now, updated_at: now,
  });
  if (error) return res.status(500).json({ error: 'ONBOARDING_PROGRESS_SAVE_FAILED' });
  await writeAudit(req, `onboarding.${parsed.data}_completed`, 'workspace', req.workspaceId!);
  res.json({ completed: parsed.data });
}));

// --- Account deletion: soft-delete + scheduled hard-purge -----------------
// Requesting deletion revokes normal access immediately (requireWorkspace
// rejects the workspace for every other route once deletion_requested_at is
// set) but retains the data for WORKSPACE_DELETION_GRACE_DAYS in case of
// recovery or a legal hold. The scheduled purge job
// (server/automation/workspacePurge.ts) hard-deletes it afterward.

router.get('/deletion/status', requireAuth, allowPendingWorkspaceDeletion, requireWorkspace, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('workspaces')
    .select('deletion_requested_at,deletion_scheduled_for')
    .eq('id', req.workspaceId!).single();
  if (error) return res.status(500).json({ error: 'WORKSPACE_READ_FAILED' });
  res.json({ deletionRequestedAt: data.deletion_requested_at, deletionScheduledFor: data.deletion_scheduled_for });
}));

router.post('/deletion/request', requireAuth, requireWorkspace, requireRole('owner'), requireSensitiveAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  // requireWorkspace already rejects (410) a workspace that has a deletion
  // request in flight, so reaching here means none is pending.
  const { requestedAt, scheduledFor } = computeDeletionSchedule();
  const db = createUserClient(req.auth!.accessToken);
  const { error } = await db.from('workspaces').update({
    deletion_requested_at: requestedAt,
    deletion_requested_by: req.auth!.userId,
    deletion_scheduled_for: scheduledFor,
    updated_at: requestedAt,
  }).eq('id', req.workspaceId!);
  if (error) return res.status(400).json({ error: 'WORKSPACE_DELETION_REQUEST_FAILED', message: error.message });

  await writeAudit(req, 'workspace.deletion_requested', 'workspace', req.workspaceId!, { scheduledFor }, 'critical');
  res.json({ deletionRequestedAt: requestedAt, deletionScheduledFor: scheduledFor });
}));

router.post('/deletion/cancel', requireAuth, allowPendingWorkspaceDeletion, requireWorkspace, requireRole('owner'), requireSensitiveAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: current, error: readError } = await db.from('workspaces')
    .select('deletion_requested_at').eq('id', req.workspaceId!).single();
  if (readError) return res.status(500).json({ error: 'WORKSPACE_READ_FAILED' });
  if (!current?.deletion_requested_at) return res.status(409).json({ error: 'NO_DELETION_PENDING' });

  const { error } = await db.from('workspaces').update({
    deletion_requested_at: null,
    deletion_requested_by: null,
    deletion_scheduled_for: null,
    updated_at: new Date().toISOString(),
  }).eq('id', req.workspaceId!);
  if (error) return res.status(400).json({ error: 'WORKSPACE_DELETION_CANCEL_FAILED', message: error.message });

  await writeAudit(req, 'workspace.deletion_cancelled', 'workspace', req.workspaceId!, {}, 'warning');
  res.json({ cancelled: true });
}));

// Self-service "delete my account" entry point. This never calls
// supabaseAdmin.auth.admin.deleteUser directly -- deleting the auth user
// while they still own live workspace data would orphan it ahead of the
// retention/legal-hold window everywhere else in this policy. Instead it
// requests deletion of every workspace the caller owns (each then follows
// the same 30-day grace window above); the scheduled purge job deletes the
// caller's auth account itself once none of their owned workspaces remain
// (see server/automation/workspacePurge.ts). Workspaces where the caller is
// only a member (not owner) are unaffected -- there is no "leave workspace"
// endpoint yet (server/routes/team.ts only supports inviting members), so
// those memberships are reported back rather than silently left in place.
router.post('/deletion/request-account', requireAuth, requireSensitiveAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: memberships, error } = await db.from('workspace_members')
    .select('workspace_id,role,workspaces(id,deletion_requested_at)')
    .eq('user_id', req.auth!.userId)
    .eq('status', 'active');
  if (error) return res.status(500).json({ error: 'MEMBERSHIP_READ_FAILED' });

  const owned = (memberships ?? []).filter((row: any) => row.role === 'owner');
  const nonOwned = (memberships ?? []).filter((row: any) => row.role !== 'owner');

  const { requestedAt, scheduledFor } = computeDeletionSchedule();
  const requestedWorkspaceIds: string[] = [];
  for (const row of owned as any[]) {
    const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    if (workspace?.deletion_requested_at) continue; // already pending
    const { error: updateError } = await db.from('workspaces').update({
      deletion_requested_at: requestedAt,
      deletion_requested_by: req.auth!.userId,
      deletion_scheduled_for: scheduledFor,
      updated_at: requestedAt,
    }).eq('id', row.workspace_id);
    if (!updateError) {
      requestedWorkspaceIds.push(row.workspace_id);
      await writeWorkspaceAudit(row.workspace_id, req.auth!.userId, 'workspace.deletion_requested', { scheduledFor, viaAccountDeletion: true }, 'critical');
    }
  }

  res.json({
    deletionScheduledFor: requestedWorkspaceIds.length ? scheduledFor : null,
    requestedWorkspaceIds,
    remainingMemberships: nonOwned.map((row: any) => row.workspace_id),
    message: nonOwned.length
      ? 'Your owned workspaces are scheduled for deletion. You are still a member of other workspaces you do not own -- ask their owner to remove you, or wait for a "leave workspace" option, to fully close your account.'
      : undefined,
  });
}));

export default router;
