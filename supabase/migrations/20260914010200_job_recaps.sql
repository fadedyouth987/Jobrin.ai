-- AI post-work recaps: after a job is marked completed, the AI drafts a
-- plain-English work summary the owner reviews before it is kept on the
-- record or sent to the customer. One recap draft per job; edits/approval
-- replace the same row rather than accumulating duplicates.

create table if not exists public.job_recaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  draft_text text not null default '',
  status text not null default 'drafted' check (status in ('drafted','approved','sent','discarded')),
  model text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, job_id)
);

alter table public.job_recaps enable row level security;

-- Same split as 0028_field_completion_role_scoped_policies.sql: every
-- workspace member can read, but only staff-and-above can write, matching
-- the jobs/customers "_staff_write" pattern.
drop policy if exists job_recaps_member_select on public.job_recaps;
create policy job_recaps_member_select on public.job_recaps for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists job_recaps_staff_write on public.job_recaps;
create policy job_recaps_staff_write on public.job_recaps for all to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager','staff']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','manager','staff']::public.workspace_role[]));

grant select, insert, update, delete on public.job_recaps to authenticated;

-- Tenant/member reference guards, same pattern as 0024_field_service_completion.sql.
drop trigger if exists tenant_ref_job_recaps_job_id on public.job_recaps;
create trigger tenant_ref_job_recaps_job_id before insert or update of job_id, workspace_id on public.job_recaps
  for each row execute function private.assert_same_workspace_reference('job_id','jobs');

drop trigger if exists member_ref_job_recaps_approved_by on public.job_recaps;
create trigger member_ref_job_recaps_approved_by before insert or update of approved_by, workspace_id on public.job_recaps
  for each row execute function private.assert_workspace_member_reference('approved_by');
