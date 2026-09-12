import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { env } from '../env';

const router = Router();

// Invite acceptance deliberately sits outside requireWorkspace: an invited
// member does not have active workspace access until this endpoint succeeds.
// Identity still comes from the verified Supabase invite session, and the
// update is constrained to that user's own pending membership.
router.post('/invites/accept', requireAuth, validateBody(z.object({}).strict()), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'INVITES_REQUIRE_SERVICE_ROLE' });
  }

  const { data: pending, error: readError } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id,user_id,role,status')
    .eq('user_id', req.auth!.userId)
    .eq('status', 'invited');
  if (readError) return res.status(500).json({ error: 'INVITE_ACCEPT_FAILED' });
  if (!pending?.length) return res.status(404).json({ error: 'INVITE_NOT_FOUND', message: 'This invitation is no longer available.' });

  const { data: members, error: updateError } = await supabaseAdmin
    .from('workspace_members')
    .update({ status: 'active' })
    .eq('user_id', req.auth!.userId)
    .eq('status', 'invited')
    .select('workspace_id,user_id,role,status,created_at');
  if (updateError) return res.status(500).json({ error: 'INVITE_ACCEPT_FAILED' });

  for (const member of members ?? []) {
    req.workspaceId = member.workspace_id;
    await writeAudit(req, 'team.invite_accepted', 'workspace_member', req.auth!.userId, { role: member.role }, 'info');
  }
  res.json({ members, accepted: true });
}));

router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

router.get('/', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: members, error } = await db
    .from('workspace_members')
    .select('user_id,role,status,created_at')
    .eq('workspace_id', req.workspaceId!)
    .order('created_at');

  if (error) return res.status(500).json({ error: 'TEAM_LIST_FAILED' });

  const userIds = (members ?? []).map((member) => member.user_id);
  let profiles: Array<{ id: string; display_name: string | null; avatar_url: string | null }> = [];

  if (userIds.length) {
    const { data, error: profileError } = await db
      .from('profiles')
      .select('id,display_name,avatar_url')
      .in('id', userIds);
    if (profileError) return res.status(500).json({ error: 'TEAM_PROFILE_LIST_FAILED' });
    profiles = data ?? [];
  }

  const profileByUser = new Map(profiles.map((profile) => [profile.id, profile]));
  res.json({
    members: (members ?? []).map((member) => ({
      ...member,
      profile: profileByUser.get(member.user_id) ?? null,
    })),
  });
}));

// Inviting a member creates a real Supabase auth user, so it needs the
// service-role key. When it is absent the endpoint fails closed with a clear
// operator-facing code instead of pretending to invite anyone.
const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['admin', 'manager', 'staff', 'viewer']),
  display_name: z.string().trim().max(120).default(''),
});

router.post('/invites', requireRole('owner', 'admin'), requireSensitiveAuth, validateBody(inviteSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'INVITES_REQUIRE_SERVICE_ROLE', message: 'Add the Supabase service-role key to the server environment to invite members.' });
  }
  // Least privilege: only the workspace owner can create another admin.
  if (req.body.role === 'admin' && req.workspaceRole !== 'owner') {
    return res.status(403).json({ error: 'ONLY_OWNER_CAN_INVITE_ADMINS' });
  }

  // Membership check runs through the caller's client so RLS applies.
  const db = createUserClient(req.auth!.accessToken);
  const { data: existing, error: existingError } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', req.workspaceId!);
  if (existingError) return res.status(500).json({ error: 'TEAM_LIST_FAILED' });
  void existing;

  const acceptUrl = new URL('/accept-invite', env.APP_URL);

  // Generate an expiring Supabase invite credential without asking Supabase to
  // send email. This preserves the existing protection against SMTP/rate-limit
  // failures while giving the owner an explicit secure handoff to the member.
  const invite = await supabaseAdmin.auth.admin.generateLink({
    type: 'invite',
    email: req.body.email,
    options: {
      redirectTo: acceptUrl.toString(),
      data: { display_name: req.body.display_name || req.body.email.split('@')[0] },
    },
  });
  if (invite.error) {
    if (/already been registered/i.test(invite.error.message)) {
      return res.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED', message: 'That email already has a Jobrin.ai login. Ask them to sign in, then add them from this page once account linking is available.' });
    }
    return res.status(502).json({ error: 'INVITE_LINK_CREATE_FAILED', message: 'No invitation was created. Try again.' });
  }
  const userId = invite.data.user?.id ?? null;
  const setupUrl = invite.data.properties?.action_link ?? null;
  if (!userId || !setupUrl) {
    if (userId) await supabaseAdmin.auth.admin.deleteUser(userId);
    return res.status(502).json({ error: 'INVITE_LINK_CREATE_FAILED' });
  }

  if (req.body.display_name) {
    await supabaseAdmin.from('profiles').upsert({ id: userId, display_name: req.body.display_name });
  }
  const { data: member, error: insertError } = await supabaseAdmin
    .from('workspace_members')
    .insert({ workspace_id: req.workspaceId!, user_id: userId, role: req.body.role, status: 'invited' })
    .select('user_id,role,status,created_at').single();
  if (insertError) {
    // Do not strand a login without a membership when the second half fails.
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return res.status(400).json({ error: 'TEAM_MEMBER_CREATE_FAILED', message: insertError.message });
  }

  await writeAudit(req, 'team.member_invited', 'workspace_member', userId, { role: req.body.role, delivery: 'manual' }, 'warning');
  res.status(201).json({ member, invited: true, delivery: 'manual', setupUrl });
}));

export default router;
