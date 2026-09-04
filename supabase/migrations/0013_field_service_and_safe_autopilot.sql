-- Jobryn field-service and durable safe-autopilot foundation.
-- This migration is additive and must be applied through the normal reviewed migration process.

alter table public.automations
  add column if not exists schedule_cron text,
  add column if not exists timezone text not null default 'Australia/Adelaide',
  add column if not exists approval_policy jsonb not null default '{"default":"safe_autopilot"}'::jsonb,
  add column if not exists retry_policy jsonb not null default '{"maxAttempts":5,"baseDelaySeconds":30}'::jsonb,
  add column if not exists next_run_at timestamptz,
  add column if not exists last_run_at timestamptz;

alter table public.automation_runs
  add column if not exists idempotency_key text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_error text,
  add column if not exists trace_id uuid not null default gen_random_uuid();
create unique index if not exists automation_runs_idempotency_idx on public.automation_runs(workspace_id,idempotency_key) where idempotency_key is not null;
create index if not exists automation_runs_worker_idx on public.automation_runs(status,next_attempt_at) where status in ('queued','failed');

alter table public.ai_actions
  add column if not exists actor_type text not null default 'operator',
  add column if not exists model text,
  add column if not exists model_version text,
  add column if not exists prompt_version text,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists preview jsonb,
  add column if not exists trace_id uuid not null default gen_random_uuid(),
  add column if not exists latency_ms integer,
  add column if not exists retry_count integer not null default 0;

create table if not exists public.automation_attempts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  run_id uuid not null references public.automation_runs(id) on delete cascade, attempt_number integer not null,
  status text not null check(status in ('running','completed','failed')), input jsonb not null default '{}'::jsonb,
  output jsonb, error_code text, error_message text, started_at timestamptz not null default now(), completed_at timestamptz,
  unique(run_id,attempt_number)
);

create table if not exists public.customer_assets (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade, address_id uuid references public.customer_addresses(id) on delete set null,
  name text not null, asset_type text not null, make text, model text, serial_number text, installed_at date,
  warranty_expires_at date, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists customer_assets_workspace_customer_idx on public.customer_assets(workspace_id,customer_id);

create table if not exists public.service_agreements (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade, service_id uuid references public.services(id) on delete set null,
  name text not null, status text not null default 'draft' check(status in ('draft','active','paused','cancelled','expired')),
  cadence text not null, next_service_at timestamptz, price_cents bigint not null default 0 check(price_cents>=0), starts_at date, ends_at date,
  terms jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.technician_profiles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
  skills text[] not null default '{}', certifications jsonb not null default '[]'::jsonb, service_area_postcodes text[] not null default '{}',
  working_hours jsonb not null default '{}'::jsonb, travel_radius_km integer check(travel_radius_km between 0 and 1000), active boolean not null default true,
  updated_at timestamptz not null default now(), primary key(workspace_id,user_id)
);

create table if not exists public.job_time_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade, user_id uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz not null, ended_at timestamptz, break_minutes integer not null default 0 check(break_minutes>=0), notes text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.job_materials (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade, description text not null, supplier text, quantity numeric(12,3) not null default 1 check(quantity>0),
  unit_cost_cents bigint not null default 0 check(unit_cost_cents>=0), unit_price_cents bigint not null default 0 check(unit_price_cents>=0), supplier_reference text, created_at timestamptz not null default now()
);

create table if not exists public.customer_portal_sessions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade, token_hash text not null unique, scopes text[] not null default '{}',
  expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists public.ai_evaluations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id) on delete cascade,
  suite text not null, case_name text not null, prompt_version text, model text, passed boolean not null,
  score numeric(5,4), result jsonb not null default '{}'::jsonb, trace_id uuid, created_at timestamptz not null default now()
);

alter table public.automation_attempts enable row level security;
alter table public.customer_assets enable row level security;
alter table public.service_agreements enable row level security;
alter table public.technician_profiles enable row level security;
alter table public.job_time_entries enable row level security;
alter table public.job_materials enable row level security;
alter table public.customer_portal_sessions enable row level security;
alter table public.ai_evaluations enable row level security;

-- Members may read operational records; existing private membership helpers enforce tenant isolation.
do $$ declare t text; begin foreach t in array array['automation_attempts','customer_assets','service_agreements','technician_profiles','job_time_entries','job_materials'] loop
  execute format('create policy %I on public.%I for select to authenticated using (private.is_workspace_member(workspace_id))',t||'_member_select',t);
end loop; end $$;

revoke all on public.automation_attempts, public.customer_portal_sessions, public.ai_evaluations from anon, authenticated;
grant select on public.automation_attempts to authenticated;
grant select,insert,update on public.customer_assets,public.service_agreements,public.technician_profiles,public.job_time_entries,public.job_materials to authenticated;
