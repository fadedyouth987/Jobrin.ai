import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assignableRolesFor, canManageMember, decideMemberChange } from '../shared/teamPolicy';

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const OWNER = 'owner-user';
const ADMIN = 'admin-user';
const OTHER = 'other-user';

const decide = (actorRole: string, actorUserId: string, targetRole: string, change: Parameters<typeof decideMemberChange>[0]['change'], targetUserId = OTHER) =>
  decideMemberChange({ actorUserId, actorRole, targetUserId, targetRole, change });

// --- The policy itself ---

test('the owner can change any non-owner member, including admins', () => {
  for (const targetRole of ['admin', 'manager', 'staff', 'viewer', 'approver', 'creator']) {
    assert.deepEqual(decide('owner', OWNER, targetRole, { status: 'disabled' }), { ok: true }, targetRole);
    assert.deepEqual(decide('owner', OWNER, targetRole, { role: 'admin' }), { ok: true }, targetRole);
  }
});

test('an admin manages non-admin members but never admins', () => {
  for (const targetRole of ['manager', 'staff', 'viewer']) {
    assert.deepEqual(decide('admin', ADMIN, targetRole, { role: 'viewer' }), { ok: true }, targetRole);
    assert.deepEqual(decide('admin', ADMIN, targetRole, { status: 'disabled' }), { ok: true }, targetRole);
  }
  assert.deepEqual(decide('admin', ADMIN, 'admin', { status: 'disabled' }), { ok: false, error: 'ONLY_OWNER_CAN_MANAGE_ADMINS' });
  assert.deepEqual(decide('admin', ADMIN, 'admin', { role: 'staff' }), { ok: false, error: 'ONLY_OWNER_CAN_MANAGE_ADMINS' });
  assert.deepEqual(decide('admin', ADMIN, 'staff', { role: 'admin' }), { ok: false, error: 'ONLY_OWNER_CAN_MANAGE_ADMINS' });
});

test('nobody can change the owner or themselves', () => {
  assert.deepEqual(decide('admin', ADMIN, 'owner', { status: 'disabled' }), { ok: false, error: 'CANNOT_CHANGE_OWNER' });
  assert.deepEqual(decide('owner', OWNER, 'owner', { role: 'staff' }, OWNER), { ok: false, error: 'CANNOT_CHANGE_SELF' });
  assert.deepEqual(decide('admin', ADMIN, 'admin', { status: 'disabled' }, ADMIN), { ok: false, error: 'CANNOT_CHANGE_SELF' });
  assert.deepEqual(decide('owner', OWNER, 'owner', { status: 'disabled' }, 'second-owner'), { ok: false, error: 'CANNOT_CHANGE_OWNER' });
});

test('managers, staff, viewers and unknown roles cannot change members', () => {
  for (const actorRole of ['manager', 'staff', 'viewer', 'approver', 'creator', '', 'superuser']) {
    assert.deepEqual(decide(actorRole, 'actor', 'viewer', { status: 'disabled' }), { ok: false, error: 'INSUFFICIENT_ROLE' }, actorRole);
  }
  assert.deepEqual(decideMemberChange({ actorUserId: 'a', actorRole: undefined, targetUserId: 'b', targetRole: 'staff', change: { status: 'disabled' } }), { ok: false, error: 'INSUFFICIENT_ROLE' });
});

test('an empty change is rejected', () => {
  assert.deepEqual(decide('owner', OWNER, 'staff', {}), { ok: false, error: 'NOTHING_TO_CHANGE' });
});

test('the Team page offers controls and roles exactly where the policy allows', () => {
  assert.equal(canManageMember(OWNER, 'owner', { user_id: OTHER, role: 'admin' }), true);
  assert.equal(canManageMember(ADMIN, 'admin', { user_id: OTHER, role: 'admin' }), false);
  assert.equal(canManageMember(ADMIN, 'admin', { user_id: OTHER, role: 'staff' }), true);
  assert.equal(canManageMember(ADMIN, 'admin', { user_id: ADMIN, role: 'admin' }), false);
  assert.equal(canManageMember(OWNER, 'owner', { user_id: OWNER, role: 'owner' }), false);
  assert.equal(canManageMember(null, 'owner', { user_id: OTHER, role: 'staff' }), false);
  assert.equal(canManageMember('m', 'manager', { user_id: OTHER, role: 'staff' }), false);
  assert.deepEqual(assignableRolesFor('owner'), ['admin', 'manager', 'staff', 'viewer']);
  assert.deepEqual(assignableRolesFor('admin'), ['manager', 'staff', 'viewer']);
  assert.deepEqual(assignableRolesFor('manager'), []);
});

// --- Contracts on the route (the API is the authority, not the page) ---

test('the member-change route is owner/admin only, step-up protected and validated', async () => {
  const route = await source('server/routes/team.ts');
  assert.match(route, /router\.patch\('\/members\/:userId', requireRole\('owner', 'admin'\), requireSensitiveAuth, validateBody\(memberChangeSchema\)/);
  // Only the roles and statuses a member may be given; never owner.
  assert.match(route, /role: z\.enum\(ASSIGNABLE_MEMBER_ROLES\)\.optional\(\)/);
  assert.match(route, /status: z\.enum\(\['active', 'disabled'\]\)\.optional\(\)/);
  assert.match(route, /\}\)\.strict\(\);/);
  assert.match(route, /decideMemberChange\(\{/);
});

test('the member-change route is scoped to the verified workspace and guards against races', async () => {
  const route = await source('server/routes/team.ts');
  const handler = route.slice(route.indexOf("router.patch('/members/:userId'"));
  // Both the read and the write are filtered by the workspace requireWorkspace
  // verified from the caller's JWT, never by anything in the request body.
  assert.equal((handler.match(/\.eq\('workspace_id', req\.workspaceId!\)/g) ?? []).length, 2);
  assert.doesNotMatch(handler, /req\.body\.workspace/);
  // The update only lands if the row is still what was checked, and never on an owner.
  assert.match(handler, /\.eq\('role', target\.role\)\s*\.eq\('status', target\.status\)\s*\.neq\('role', 'owner'\)/);
  assert.match(handler, /MEMBER_CHANGED_CONCURRENTLY/);
  assert.match(handler, /writeAudit\(req, action, 'workspace_member', targetUserId/);
});

test('disabling a member revokes access in the API, not just the page', async () => {
  // requireWorkspace admits only active memberships; the database probes in
  // tests/db/tenant-isolation.test.sql cover the RLS side.
  const supabaseSource = await source('server/supabase.ts');
  const guard = supabaseSource.slice(supabaseSource.indexOf('export async function requireWorkspace'));
  assert.match(guard.slice(0, 1500), /\.eq\('status', 'active'\)/);
});
