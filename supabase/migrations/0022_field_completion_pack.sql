-- Field Completion Pack: checklists, signatures, and job photo attachments.
-- Photos use the existing private vantory-assets bucket via the server.

-- Checklist templates: reusable per service type or workspace-wide
create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  items jsonb not null default '[]'::jsonb,
  is_critical boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-job checklist results: captures the actual completion state
create table if not exists public.job_checklists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  template_id uuid references public.checklist_templates(id) on delete set null,
  title text not null,
  results jsonb not null default '[]'::jsonb,
  all_critical_done boolean not null default false,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Customer signatures: proof of acceptance for jobs and quotes
create table if not exists public.job_signatures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  quote_id uuid references public.quotes(id) on delete set null,
  customer_name text not null,
  signature_data text not null,
  signed_at timestamptz not null default now(),
  ip_address inet,
  created_at timestamptz not null default now()
);

alter table public.checklist_templates enable row level security;
alter table public.job_checklists enable row level security;
alter table public.job_signatures enable row level security;

do $$ declare t text; begin foreach t in array array['checklist_templates','job_checklists','job_signatures'] loop
execute format('drop policy if exists %I on public.%I', t||'_member_all', t);
execute format('create policy %I on public.%I for all to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id))', t||'_member_all', t);
end loop; end $$;

grant select,insert,update,delete on public.checklist_templates, public.job_checklists, public.job_signatures to authenticated;