-- Workspace deletion lifecycle: soft-delete with a 30-day grace window,
-- then a scheduled hard purge. This intentionally does NOT reuse the bare
-- `deleted_at` pattern used on customers/leads (see 0003_revenue_os_core.sql)
-- because a workspace mid-grace-period is not simply "gone": its owner must
-- still be able to read it in full and cancel the request, something a
-- single deleted_at IS NULL filter cannot express. Two explicit timestamps
-- keep "requested" and "when it becomes irreversible" separate.

alter table public.workspaces
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references auth.users(id) on delete set null,
  add column deletion_scheduled_for timestamptz;

comment on column public.workspaces.deletion_requested_at is
  'Set by POST /workspaces/deletion/request. Access is revoked immediately at the application layer (requireWorkspace rejects any workspace with this set, except the deletion-management routes themselves).';
comment on column public.workspaces.deletion_requested_by is
  'Owner who requested deletion, retained for audit/support even if their account is later purged.';
comment on column public.workspaces.deletion_scheduled_for is
  'deletion_requested_at + 30 days. The scheduled purge job (server/automation/workspacePurge.ts) hard-deletes the workspace row -- and, via existing "on delete cascade" foreign keys, all dependent tenant data -- once now() passes this timestamp, unless legal_hold_active is true.';

-- Only one workspace can be "the" pending deletion sweep target at a time in
-- practice, but this index is what makes the purge job's query
-- (deletion_scheduled_for <= now()) cheap regardless of table size.
create index workspaces_pending_deletion_idx on public.workspaces (deletion_scheduled_for)
  where deletion_scheduled_for is not null;

-- A workspace that already has a deletion request in flight cannot be asked
-- again (the request route checks this in the app layer too, but this keeps
-- the invariant true even against a direct write).
alter table public.workspaces
  add constraint workspaces_deletion_pair_check
  check (
    (deletion_requested_at is null and deletion_scheduled_for is null)
    or (deletion_requested_at is not null and deletion_scheduled_for is not null)
  );
