-- Jobryn employer-side hiring pipeline. This is intentionally not a labour-hire
-- model: Jobryn stores a business's own candidate records and never employs,
-- pays, supplies or automatically selects workers.

create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 160),
  trade text not null default '' check (char_length(trade) <= 100),
  location text not null default '' check (char_length(location) <= 160),
  employment_type text not null check (employment_type in ('full_time','part_time','casual','apprenticeship','subcontractor')),
  summary text not null default '' check (char_length(summary) <= 5000),
  requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(requirements) = 'array'),
  status text not null default 'draft' check (status in ('draft','open','paused','filled','archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_openings_workspace_status_idx on public.job_openings(workspace_id,status,created_at desc);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  email text check (email is null or char_length(email) <= 254),
  phone text check (phone is null or char_length(phone) <= 40),
  suburb text not null default '' check (char_length(suburb) <= 100),
  experience_summary text not null default '' check (char_length(experience_summary) <= 5000),
  licences jsonb not null default '[]'::jsonb check (jsonb_typeof(licences) = 'array'),
  availability text not null default '' check (char_length(availability) <= 500),
  source text not null default 'direct' check (char_length(source) <= 100),
  -- The employer records the candidate's permission before storing their details.
  privacy_notice_version text not null check (char_length(trim(privacy_notice_version)) between 1 and 80),
  consent_captured_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists candidates_workspace_name_idx on public.candidates(workspace_id,full_name,created_at desc);
create unique index if not exists candidates_workspace_email_unique on public.candidates(workspace_id,lower(email)) where email is not null;

create table if not exists public.candidate_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_opening_id uuid not null references public.job_openings(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  stage text not null default 'applied' check (stage in ('applied','screening','interview','trial','offered','hired','rejected','withdrawn')),
  notes text not null default '' check (char_length(notes) <= 5000),
  stage_changed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_opening_id,candidate_id)
);
create index if not exists candidate_applications_pipeline_idx on public.candidate_applications(workspace_id,job_opening_id,stage,created_at desc);
create index if not exists candidate_applications_candidate_idx on public.candidate_applications(workspace_id,candidate_id,created_at desc);

-- A candidate and an opening must always belong to the application workspace.
create or replace function private.enforce_candidate_application_workspace()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  opening_workspace uuid;
  candidate_workspace uuid;
begin
  select workspace_id into opening_workspace from public.job_openings where id = new.job_opening_id;
  select workspace_id into candidate_workspace from public.candidates where id = new.candidate_id;
  if opening_workspace is null or candidate_workspace is null
     or opening_workspace <> new.workspace_id or candidate_workspace <> new.workspace_id then
    raise exception 'Candidate application references a different workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists candidate_applications_workspace_guard on public.candidate_applications;
create trigger candidate_applications_workspace_guard
  before insert or update of workspace_id,job_opening_id,candidate_id on public.candidate_applications
  for each row execute function private.enforce_candidate_application_workspace();

alter table public.job_openings enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_applications enable row level security;

revoke all on public.job_openings,public.candidates,public.candidate_applications from anon;
grant select,insert,update on public.job_openings,public.candidates,public.candidate_applications to authenticated;
revoke delete on public.job_openings,public.candidates,public.candidate_applications from authenticated;

-- Candidate records are employment-related personal information. Only management
-- roles can read or change them; staff cannot browse the hiring pipeline.
do $$
declare
  t text;
begin
  foreach t in array array['job_openings','candidates','candidate_applications'] loop
    execute format('drop policy if exists %I on public.%I', t || '_hiring_manager_access', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']::public.workspace_role[]))',
      t || '_hiring_manager_access', t
    );
  end loop;
end $$;

-- Existing workspaces receive the hiring feature on their current plan. Plan
-- changes remain server/provider owned through subscription_entitlements.
insert into public.subscription_entitlements(workspace_id,feature_key,enabled,limit_value,updated_at)
select workspace_id,'hiring.core',true,null,now()
from public.subscriptions
on conflict (workspace_id,feature_key) do nothing;

-- New workspaces must receive the same trial and entitlement seed as existing
-- workspaces. The previous migration repaired historical workspaces but the
-- current workspace factory did not yet carry those defaults forward.
create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_workspace uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(trim(workspace_name)) < 2 or char_length(trim(workspace_name)) > 100 then
    raise exception 'Invalid workspace name';
  end if;
  if workspace_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception 'Invalid workspace slug';
  end if;

  insert into public.workspaces(name, slug, owner_user_id, plan)
  values (trim(workspace_name), workspace_slug, uid, 'starter')
  returning id into new_workspace;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (new_workspace, uid, 'owner', 'active');

  insert into public.credit_wallets(workspace_id, balance, lifetime_purchased, lifetime_consumed)
  values (new_workspace, 0, 0, 0);

  insert into public.subscriptions(workspace_id, plan, status, trial_ends_at)
  values (new_workspace, 'starter', 'trialing', now() + interval '14 days');

  insert into public.subscription_entitlements(workspace_id, feature_key, enabled, limit_value)
  select new_workspace, defaults.feature_key, defaults.enabled, defaults.limit_value
  from (values
    ('crm.core', true, null::bigint),
    ('lead.capture', true, null::bigint),
    ('ai.basic', true, null::bigint),
    ('booking.core', true, null::bigint),
    ('hiring.core', true, null::bigint),
    ('automations.advanced', false, null::bigint),
    ('campaigns.revenue', false, null::bigint),
    ('operator.full', false, null::bigint),
    ('usage.users', true, 2::bigint),
    ('usage.sms', true, 250::bigint),
    ('usage.ai_actions', true, 250::bigint)
  ) as defaults(feature_key, enabled, limit_value);

  insert into public.business_profiles(workspace_id, trading_name)
  values (new_workspace, trim(workspace_name));

  insert into public.onboarding_progress(workspace_id, step_key, status)
  values (new_workspace, 'business', 'in_progress');

  return new_workspace;
end;
$$;
revoke all on function public.create_workspace(text,text) from public, anon;
grant execute on function public.create_workspace(text,text) to authenticated;
