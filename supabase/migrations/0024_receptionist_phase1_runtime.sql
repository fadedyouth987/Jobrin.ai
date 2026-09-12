-- Phase 1 AI receptionist: approved per-call context and idempotent call tools.

alter table public.receptionist_profiles
  add column if not exists approved_pricing_language text not null default 'Quotes are confirmed by the team after reviewing the job.',
  add column if not exists custom_escalation_rules jsonb not null default '[]'::jsonb,
  add column if not exists callback_window text not null default 'one business day',
  add column if not exists after_hours_rule text not null default 'Take a message and arrange a callback.',
  add column if not exists max_concurrent_calls integer not null default 5,
  add column if not exists max_calls_per_caller_hour integer not null default 6,
  add column if not exists max_call_minutes integer not null default 30,
  add column if not exists max_call_turns integer not null default 80;

alter table public.receptionist_profiles
  drop constraint if exists receptionist_profiles_custom_escalation_rules_check,
  add constraint receptionist_profiles_custom_escalation_rules_check
    check (jsonb_typeof(custom_escalation_rules) = 'array'),
  drop constraint if exists receptionist_profiles_phase1_limits_check,
  add constraint receptionist_profiles_phase1_limits_check check (
    max_concurrent_calls between 1 and 5 and
    max_calls_per_caller_hour between 1 and 6 and
    max_call_minutes between 5 and 30 and
    max_call_turns between 10 and 80
  );

alter table public.calls
  add column if not exists context_snapshot jsonb,
  add column if not exists context_snapshot_hash text,
  add column if not exists context_snapshot_signature text,
  add column if not exists outcome text,
  add column if not exists turn_count integer not null default 0;

alter table public.ai_actions
  add column if not exists call_id uuid references public.calls(id) on delete set null,
  add column if not exists turn_index integer,
  add column if not exists idempotency_key text;

create unique index if not exists ai_actions_receptionist_idempotency_idx
  on public.ai_actions(workspace_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists ai_actions_call_idx
  on public.ai_actions(workspace_id, call_id, turn_index)
  where call_id is not null;

-- Existing tables are reached through supabase-js, so keep Data API grants
-- explicit while RLS and server-side workspace checks remain authoritative.
grant select, insert, update on public.receptionist_profiles to authenticated;
grant select on public.calls, public.ai_actions to authenticated;
grant all on public.receptionist_profiles, public.calls, public.ai_actions to service_role;

