import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { env } from '../env';

const router = Router();
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

  // Resolve the invitee's auth user, sending them a real invite email if
  // they are brand new. inviteUserByEmail both creates the user and emails a
  // setup link, so the invitee sets their own password — unlike creating the
  // auth user directly with auto-confirmation, which silently produced a
  // passwordless, unnotified account nobody could sign in to.
  const invite = await supabaseAdmin.auth.admin.inviteUserByEmail(req.body.email, {
    data: { display_name: req.body.display_name || req.body.email.split('@')[0] },
    redirectTo: new URL('/set-password', env.APP_URL).toString(),
  });
  if (invite.error) {
    if (/already been registered/i.test(invite.error.message)) {
      return res.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED', message: 'That email already has a Jobrin.ai login. Ask them to sign in, then add them from this page once account linking is available.' });
    }
    return res.status(502).json({ error: 'INVITE_SEND_FAILED' });
  }
  const userId = invite.data?.user?.id ?? null;
  if (!userId) return res.status(502).json({ error: 'INVITE_SEND_FAILED' });

  // inviteUserByEmail only succeeds for an email with no existing login (an
  // existing one returns "already been registered" above), so this auth user
  // was created by this request. If the workspace membership cannot be
  // recorded, remove it again: an orphaned invitee would otherwise hold a
  // live setup link to no workspace, and every retry would be refused as
  // EMAIL_ALREADY_REGISTERED.
  const rollbackInvitedUser = async () => {
    const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (rollbackError) {
      console.error(JSON.stringify({ level: 'error', component: 'team_invite', message: 'Invite rollback failed; orphaned auth user', requestId: req.requestId, userId }));
    }
  };

  if (req.body.display_name) {
    await supabaseAdmin.from('profiles').upsert({ id: userId, display_name: req.body.display_name });
  }
  const { data: member, error: insertError } = await supabaseAdmin
    .from('workspace_members')
    .insert({ workspace_id: req.workspaceId!, user_id: userId, role: req.body.role, status: 'active' })
    .select('user_id,role,status,created_at').single();
  if (insertError) {
    await rollbackInvitedUser();
    return res.status(500).json({ error: 'TEAM_MEMBER_CREATE_FAILED' });
  }

  await writeAudit(req, 'team.member_invited', 'workspace_member', userId, { role: req.body.role }, 'warning');
  res.status(201).json({ member, invited: true });
}));

export default router;
