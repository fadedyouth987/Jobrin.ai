-- Evidence-driven Business Brain. Additive only; apply through the reviewed migration process.

create table if not exists public.ai_feedback_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_key text not null, idempotency_key text not null, resource_type text not null, resource_id uuid,
  customer_id uuid references public.customers(id) on delete set null, job_id uuid references public.jobs(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null, message_id uuid references public.messages(id) on delete set null,
  proposal jsonb not null, final_value jsonb, edit_type text not null check(edit_type in ('accepted','edited','rejected','measured')),
  rejection_reason text, learning_intent text not null default 'ask' check(learning_intent in ('ask','learn','one_off','do_not_learn')),
  model text, prompt_version text, actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(workspace_id,idempotency_key)
);
create index if not exists ai_feedback_workspace_idx on public.ai_feedback_events(workspace_id,created_at desc);

create table if not exists public.business_memories (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  scope_type text not null check(scope_type in ('workspace','customer','property','asset','service','job_type','technician','communication')),
  scope_id uuid, category text not null check(category in ('fact','preference','heuristic','aggregate','prediction')),
  memory_key text not null, structured_value jsonb not null, summary text not null,
  status text not null default 'candidate' check(status in ('candidate','active','challenged','stale','archived')),
  confidence numeric(5,4) not null default 0 check(confidence between 0 and 1), sample_count integer not null default 1 check(sample_count>=0),
  sensitivity text not null default 'normal' check(sensitivity in ('normal','restricted','sensitive')),
  source_type text not null, provenance jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(), last_observed_at timestamptz not null default now(),
  review_due_at timestamptz, expires_at timestamptz, created_by text not null default 'worker', confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz, algorithm_version text not null, prompt_version text, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id,scope_type,scope_id,memory_key,status)
);
create index if not exists business_memories_retrieval_idx on public.business_memories(workspace_id,status,scope_type,scope_id,category,last_observed_at desc);

create table if not exists public.memory_evidence (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_id uuid not null references public.business_memories(id) on delete cascade,
  feedback_event_id uuid references public.ai_feedback_events(id) on delete restrict, source_type text not null, source_id uuid,
  observed_value jsonb not null, weight numeric(7,4) not null default 1 check(weight>=0), explicitly_confirmed boolean not null default false,
  event_at timestamptz not null, created_at timestamptz not null default now(),
  unique(memory_id,feedback_event_id,source_type,source_id)
);
create index if not exists memory_evidence_memory_idx on public.memory_evidence(workspace_id,memory_id,event_at desc);

create table if not exists public.memory_usage_events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_id uuid not null references public.business_memories(id) on delete cascade, ai_action_id uuid references public.ai_actions(id) on delete set null,
  specialist text not null, influence text not null, outcome text check(outcome in ('pending','accepted','edited','rejected','inaccurate')),
  resource_type text, resource_id uuid, created_at timestamptz not null default now(), outcome_at timestamptz
);
create index if not exists memory_usage_workspace_idx on public.memory_usage_events(workspace_id,memory_id,created_at desc);

create table if not exists public.memory_learning_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  communication_style boolean not null default true, duration_estimates boolean not null default true,
  quote_adjustments boolean not null default true, pricing_optimisation boolean not null default false,
  technician_comparisons boolean not null default false, payment_predictions boolean not null default false,
  travel_calibration boolean not null default false, supplier_forecasting boolean not null default false,
  sensitive_property_memory boolean not null default false, updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_promotion_decisions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  memory_id uuid not null references public.business_memories(id) on delete cascade, from_status text not null, to_status text not null,
  rule_key text not null, rule_version text not null, inputs jsonb not null, reason text not null,
  actor_type text not null check(actor_type in ('deterministic_worker','user')), actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ai_feedback_events enable row level security;
alter table public.business_memories enable row level security;
alter table public.memory_evidence enable row level security;
alter table public.memory_usage_events enable row level security;
alter table public.memory_learning_settings enable row level security;
alter table public.memory_promotion_decisions enable row level security;

create policy ai_feedback_manager_select on public.ai_feedback_events for select to authenticated using (private.has_workspace_role(workspace_id,array['owner','admin','manager']::public.workspace_role[]));
create policy memories_permission_select on public.business_memories for select to authenticated using (
  private.is_workspace_member(workspace_id) and (sensitivity='normal' or private.has_workspace_role(workspace_id,array['owner','admin','manager']::public.workspace_role[]))
);
create policy memory_evidence_manager_select on public.memory_evidence for select to authenticated using (private.has_workspace_role(workspace_id,array['owner','admin','manager']::public.workspace_role[]));
create policy memory_usage_member_select on public.memory_usage_events for select to authenticated using (private.is_workspace_member(workspace_id));
create policy memory_settings_member_select on public.memory_learning_settings for select to authenticated using (private.is_workspace_member(workspace_id));
create policy memory_decisions_manager_select on public.memory_promotion_decisions for select to authenticated using (private.has_workspace_role(workspace_id,array['owner','admin','manager']::public.workspace_role[]));

revoke all on public.ai_feedback_events,public.business_memories,public.memory_evidence,public.memory_usage_events,public.memory_learning_settings,public.memory_promotion_decisions from anon,authenticated;
grant select on public.ai_feedback_events,public.business_memories,public.memory_evidence,public.memory_usage_events,public.memory_learning_settings,public.memory_promotion_decisions to authenticated;
