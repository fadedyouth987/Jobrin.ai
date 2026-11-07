import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { env } from '../env';
import { ASSIGNABLE_MEMBER_ROLES, decideMemberChange, type MemberChangeDenial } from '../../shared/teamPolicy';

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

// Change a member's role, or disable/re-enable their access. Disabling takes
// effect on the member's next request: requireWorkspace and every RLS policy
// admit only `active` memberships. The membership row is kept (not deleted)
// so the audit history stays attached and access can be restored.
const MEMBER_CHANGE_MESSAGES: Record<MemberChangeDenial, string> = {
  INSUFFICIENT_ROLE: 'Only the workspace owner or an admin can change members.',
  CANNOT_CHANGE_SELF: 'You cannot change your own role or access.',
  CANNOT_CHANGE_OWNER: "The workspace owner's access cannot be changed here.",
  ONLY_OWNER_CAN_MANAGE_ADMINS: 'Only the workspace owner can manage admins.',
  NOTHING_TO_CHANGE: 'Choose a role or an access change.',
};

const memberChangeSchema = z.object({
  role: z.enum(ASSIGNABLE_MEMBER_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).strict();

router.patch('/members/:userId', requireRole('owner', 'admin'), requireSensitiveAuth, validateBody(memberChangeSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'MEMBER_CHANGES_REQUIRE_SERVICE_ROLE', message: 'Add the Supabase service-role key to the server environment to manage members.' });
  }
  const targetUserId = String(req.params.userId || '');
  if (!/^[0-9a-fA-F-]{36}$/.test(targetUserId)) return res.status(400).json({ error: 'VALIDATION_FAILED' });

  // Read the target through the workspace the caller was verified against,
  // never a workspace supplied in the body.
  const { data: target, error: readError } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id,role,status')
    .eq('workspace_id', req.workspaceId!)
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (readError) return res.status(500).json({ error: 'TEAM_MEMBER_READ_FAILED' });
  if (!target) return res.status(404).json({ error: 'MEMBER_NOT_FOUND', message: 'That person is not a member of this workspace.' });

  const decision = decideMemberChange({
    actorUserId: req.auth!.userId,
    actorRole: req.workspaceRole,
    targetUserId,
    targetRole: target.role,
    change: req.body,
  });
  if ('error' in decision) {
    return res.status(decision.error === 'NOTHING_TO_CHANGE' ? 400 : 403).json({ error: decision.error, message: MEMBER_CHANGE_MESSAGES[decision.error] });
  }

  const changes: { role?: string; status?: string } = {};
  if (req.body.role && req.body.role !== target.role) changes.role = req.body.role;
  if (req.body.status && req.body.status !== target.status) changes.status = req.body.status;
  if (!Object.keys(changes).length) return res.json({ member: target, changed: false });

  // Conditional on the role and status just read, so a concurrent change (for
  // example the target being promoted to owner) cannot be overwritten.
  const { data: member, error: updateError } = await supabaseAdmin
    .from('workspace_members')
    .update(changes)
    .eq('workspace_id', req.workspaceId!)
    .eq('user_id', targetUserId)
    .eq('role', target.role)
    .eq('status', target.status)
    .neq('role', 'owner')
    .select('user_id,role,status,created_at')
    .maybeSingle();
  if (updateError) return res.status(500).json({ error: 'TEAM_MEMBER_UPDATE_FAILED' });
  if (!member) return res.status(409).json({ error: 'MEMBER_CHANGED_CONCURRENTLY', message: 'This member was changed by someone else just now. Refresh and try again.' });

  const action = changes.status === 'disabled' ? 'team.member_disabled'
    : changes.status === 'active' ? 'team.member_enabled'
      : 'team.member_role_changed';
  await writeAudit(req, action, 'workspace_member', targetUserId, {
    from: { role: target.role, status: target.status },
    to: { role: member.role, status: member.status },
  }, 'warning');
  res.json({ member, changed: true });
}));

export default router;
