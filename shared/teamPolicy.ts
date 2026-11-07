// Who may change another workspace member's role or access, and to what.
// Shared by the API (which enforces it) and the Team page (which only offers
// controls the API will accept). The API is the authority; the page merely
// mirrors it.
//
// Rules:
// - Only owners and admins manage members.
// - Nobody changes their own membership here. That prevents an admin from
//   locking themselves out or quietly re-granting themselves access.
// - The owner's membership is never changed here. Handing ownership over is a
//   separate, deliberate flow.
// - Admins are managed only by the owner, and only the owner can make
//   someone an admin (the same rule as invitations).
// - Disabling a member revokes access at once: the API and every RLS policy
//   admit only `active` memberships.

export const ASSIGNABLE_MEMBER_ROLES = ['admin', 'manager', 'staff', 'viewer'] as const;
export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];
export type MemberAccessStatus = 'active' | 'disabled';

export type MemberChange = { role?: AssignableMemberRole; status?: MemberAccessStatus };

export type MemberChangeDenial =
  | 'INSUFFICIENT_ROLE'
  | 'CANNOT_CHANGE_SELF'
  | 'CANNOT_CHANGE_OWNER'
  | 'ONLY_OWNER_CAN_MANAGE_ADMINS'
  | 'NOTHING_TO_CHANGE';

export function decideMemberChange(input: {
  actorUserId: string;
  actorRole: string | null | undefined;
  targetUserId: string;
  targetRole: string;
  change: MemberChange;
}): { ok: true } | { ok: false; error: MemberChangeDenial } {
  const { actorUserId, actorRole, targetUserId, targetRole, change } = input;
  if (actorRole !== 'owner' && actorRole !== 'admin') return { ok: false, error: 'INSUFFICIENT_ROLE' };
  if (change.role === undefined && change.status === undefined) return { ok: false, error: 'NOTHING_TO_CHANGE' };
  if (actorUserId === targetUserId) return { ok: false, error: 'CANNOT_CHANGE_SELF' };
  if (targetRole === 'owner') return { ok: false, error: 'CANNOT_CHANGE_OWNER' };
  if (actorRole !== 'owner' && (targetRole === 'admin' || change.role === 'admin')) {
    return { ok: false, error: 'ONLY_OWNER_CAN_MANAGE_ADMINS' };
  }
  return { ok: true };
}

// Whether the Team page should show management controls for a member at all.
export function canManageMember(actorUserId: string | null | undefined, actorRole: string | null | undefined, target: { user_id: string; role: string }) {
  if (!actorUserId) return false;
  return decideMemberChange({ actorUserId, actorRole, targetUserId: target.user_id, targetRole: target.role, change: { status: 'active' } }).ok;
}

// Roles the actor may assign. Admin appears only for the owner.
export function assignableRolesFor(actorRole: string | null | undefined): AssignableMemberRole[] {
  if (actorRole === 'owner') return [...ASSIGNABLE_MEMBER_ROLES];
  if (actorRole === 'admin') return ASSIGNABLE_MEMBER_ROLES.filter((role) => role !== 'admin');
  return [];
}
