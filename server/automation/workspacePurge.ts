import { supabaseAdmin } from '../supabase';

// Scheduled hard-purge half of the account-deletion policy documented in
// server/routes/workspaces.ts: a workspace sits soft-deleted (access revoked,
// data retained) for 30 days after deletion_requested_at, then this job
// hard-deletes it once deletion_scheduled_for has passed -- unless a legal
// hold is active, in which case it stays soft-deleted indefinitely until the
// hold is lifted.
//
// The actual row deletion relies entirely on the existing "on delete cascade"
// foreign keys every tenant table already has back to workspaces.id (see
// supabase/migrations/0001_jobrin_core.sql onward -- every workspace_id
// column found there is `on delete cascade`). A single
// `delete from workspaces where id = ...` is therefore sufficient; this file
// does not hand-write per-table cleanup.

let running = false;

export type PurgeCandidate = {
  id: string;
  owner_user_id: string;
  legal_hold_active: boolean;
  deletion_scheduled_for: string | null;
};

// Pure predicate, kept separate from the Supabase query so it can be unit
// tested without a database: a workspace is purgeable once its scheduled
// time has passed and it is not under a legal hold.
export function isEligibleForPurge(row: { deletion_scheduled_for: string | null; legal_hold_active: boolean }, now: Date = new Date()): boolean {
  if (row.legal_hold_active) return false;
  if (!row.deletion_scheduled_for) return false;
  return new Date(row.deletion_scheduled_for).getTime() <= now.getTime();
}

// The owner's Supabase Auth account is only revoked once none of their
// *other* owned, active workspaces remain -- deleting one owned workspace
// must never cut off access to another one they still legitimately own.
export function shouldRevokeOwnerAccount(remainingOwnedWorkspaceCount: number): boolean {
  return remainingOwnedWorkspaceCount <= 0;
}

async function purgeWorkspace(workspace: PurgeCandidate): Promise<void> {
  // Audit rows cascade-delete with their workspace (audit_logs.workspace_id
  // is `on delete cascade`), so the purge record must be written *before*
  // the delete, not after.
  await supabaseAdmin.from('audit_logs').insert({
    workspace_id: workspace.id,
    actor_user_id: workspace.owner_user_id,
    action: 'workspace.purged',
    entity_type: 'workspace',
    entity_id: workspace.id,
    details: { deletionScheduledFor: workspace.deletion_scheduled_for, reason: 'scheduled_purge' },
    severity: 'critical',
  });

  const { error: deleteError } = await supabaseAdmin.from('workspaces').delete().eq('id', workspace.id);
  if (deleteError) {
    console.error(JSON.stringify({ level: 'error', component: 'workspace_purge', message: 'Workspace purge delete failed', workspaceId: workspace.id, error: deleteError.message.slice(0, 200) }));
    return;
  }

  // Cascade already removed this owner's workspace_members row for the
  // purged workspace, so counting their remaining active owner memberships
  // now tells us whether they own anything else.
  const { count, error: countError } = await supabaseAdmin.from('workspace_members')
    .select('workspace_id', { count: 'exact', head: true })
    .eq('user_id', workspace.owner_user_id)
    .eq('role', 'owner')
    .eq('status', 'active');
  if (countError) {
    console.error(JSON.stringify({ level: 'error', component: 'workspace_purge', message: 'Owner membership recount failed after purge', workspaceId: workspace.id, error: countError.message.slice(0, 200) }));
    return;
  }

  if (shouldRevokeOwnerAccount(count ?? 0)) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(workspace.owner_user_id);
    } catch (error: any) {
      // Best-effort: the workspace itself is already gone either way. A
      // failure here just leaves a now-workspace-less auth account behind
      // for support/ops to clean up manually.
      console.error(JSON.stringify({ level: 'error', component: 'workspace_purge', message: 'Owner account revocation failed', ownerUserId: workspace.owner_user_id, error: String(error?.message || error).slice(0, 200) }));
    }
  }
}

export async function purgeScheduledWorkspaceDeletions(limit = 20): Promise<{ purged: number }> {
  if (running) return { purged: 0 };
  running = true;
  try {
    const { data: candidates, error } = await supabaseAdmin.from('workspaces')
      .select('id,owner_user_id,legal_hold_active,deletion_scheduled_for')
      .eq('legal_hold_active', false)
      .not('deletion_scheduled_for', 'is', null)
      .lte('deletion_scheduled_for', new Date().toISOString())
      .limit(limit);
    if (error) throw new Error(`WORKSPACE_PURGE_QUERY_FAILED:${error.message}`);

    let purged = 0;
    for (const row of (candidates ?? []) as PurgeCandidate[]) {
      // Defensive re-check with the same pure predicate the query above is
      // meant to enforce, in case the query's own filters ever drift.
      if (!isEligibleForPurge(row)) continue;
      await purgeWorkspace(row);
      purged++;
    }
    return { purged };
  } finally {
    running = false;
  }
}
