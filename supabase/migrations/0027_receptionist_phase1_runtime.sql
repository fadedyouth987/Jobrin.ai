-- Receptionist phase-1 runtime controls: approved pricing wording, custom
-- escalation rules, a fixed callback-window phrase, an after-hours rule, and
-- hard concurrency/rate/duration/turn limits enforced by the live call
-- engine (server/ai/receptionistCall.ts). Written with "add column if not
-- exists" and re-appliable DDL throughout because these columns were already
-- applied directly to the connected Supabase project in an earlier session;
-- this migration exists to bring migration history back in sync with that
-- live schema, not to apply anything new to it.

alter table public.receptionist_profiles
  add column if not exists approved_pricing_language text,
  add column if not exists custom_escalation_rules jsonb not null default '[]'::jsonb,
  add column if not exists callback_window text,
  add column if not exists after_hours_rule text,
  add column if not exists max_concurrent_calls integer not null default 2,
  add column if not exists max_calls_per_caller_hour integer not null default 3,
  add column if not exists max_call_minutes integer not null default 15,
  add column if not exists max_call_turns integer not null default 40;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_approved_pricing_language_length
    check (approved_pricing_language is null or char_length(approved_pricing_language) between 10 and 500);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_custom_escalation_rules_is_array
    check (jsonb_typeof(custom_escalation_rules) = 'array');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_callback_window_length
    check (callback_window is null or char_length(callback_window) between 5 and 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_after_hours_rule_length
    check (after_hours_rule is null or char_length(after_hours_rule) between 5 and 500);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_max_concurrent_calls_range
    check (max_concurrent_calls between 1 and 5);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_max_calls_per_caller_hour_range
    check (max_calls_per_caller_hour between 1 and 6);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_max_call_minutes_range
    check (max_call_minutes between 5 and 30);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.receptionist_profiles
    add constraint receptionist_profiles_max_call_turns_range
    check (max_call_turns between 10 and 80);
exception when duplicate_object then null; end $$;

-- Data-API grants: table-level grants already cover new columns, restated
-- here to match this codebase's explicit least-privilege convention.
revoke all on public.receptionist_profiles from anon;
grant select, insert, update on public.receptionist_profiles to authenticated;

-- Signed context carried into (and verifiable against) each call turn, the
-- call's terminal outcome, and a running turn count for the hard call/turn
-- limits above.
alter table public.calls
  add column if not exists context_snapshot jsonb,
  add column if not exists context_snapshot_hash text,
  add column if not exists context_snapshot_signature text,
  add column if not exists outcome text,
  add column if not exists turn_count integer not null default 0;

do $$ begin
  alter table public.calls
    add constraint calls_outcome_check
    check (outcome is null or outcome in ('completed','message_taken','transferred','call_limit_reached','abandoned','failed'));
exception when duplicate_object then null; end $$;

-- calls stays select-only for authenticated (see 0005_least_privilege_rbac.sql);
-- these columns are populated by the service-role call engine only.
grant select on public.calls to authenticated;

-- Per-turn idempotency for AI-triggered actions, tied to the originating
-- call and turn so a retried webhook or reconnect cannot double-act.
alter table public.ai_actions
  add column if not exists call_id uuid references public.calls(id) on delete set null,
  add column if not exists turn_index integer,
  add column if not exists idempotency_key text;

create unique index if not exists ai_actions_workspace_idempotency_key_unique
  on public.ai_actions (workspace_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists ai_actions_workspace_call_turn_idx
  on public.ai_actions (workspace_id, call_id, turn_index);

-- ai_actions stays select-only for authenticated (see 0005_least_privilege_rbac.sql).
grant select on public.ai_actions to authenticated;
