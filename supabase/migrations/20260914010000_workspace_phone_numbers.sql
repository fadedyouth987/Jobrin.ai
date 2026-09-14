-- Multiple phone numbers per workspace.
--
-- Today `receptionist_profiles` is one row per workspace (primary key
-- workspace_id, see 0012_ai_receptionist_configuration.sql) and inbound
-- call/SMS routing resolves the *workspace* from a single connected Twilio
-- number recorded on `integrations` (provider='twilio', external_account_id
-- = the number). There is no support for more than one number per
-- workspace, and no way for a number to carry its own greeting/voice/hours.
--
-- This adds `workspace_phone_numbers`: one row per Twilio number, always
-- tied to exactly one workspace, with optional per-number overrides of the
-- caller-facing fields of the workspace's single receptionist_profiles row.
-- `receptionist_profiles` itself is left untouched (its primary key stays
-- workspace_id) — a number with no overrides simply falls back to that
-- workspace default profile. This keeps the change additive rather than
-- restructuring a live, primary-keyed table that phone/call traffic already
-- depends on.

create table if not exists public.workspace_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  phone_number text not null check (phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  label text not null default '' check (char_length(label) <= 80),
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  -- Per-number overrides of the workspace's default receptionist_profiles
  -- row. Null means "use the workspace default" for that field.
  display_name_override text check (display_name_override is null or char_length(display_name_override) between 2 and 80),
  greeting_override text check (greeting_override is null or char_length(greeting_override) between 10 and 500),
  voice_provider_override text check (voice_provider_override is null or voice_provider_override in ('Google', 'Amazon', 'ElevenLabs')),
  voice_id_override text check (voice_id_override is null or char_length(voice_id_override) between 2 and 120),
  language_override text check (language_override is null or char_length(language_override) between 2 and 20),
  after_hours_message_override text check (after_hours_message_override is null or char_length(after_hours_message_override) between 10 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A Twilio number can only ever route to one workspace. This is what
  -- inbound call/SMS routing keys off of, so it must be globally unique.
  unique (phone_number)
);

-- At most one primary number per workspace (the number management UI/API
-- keeps exactly one primary; this is the DB-level backstop).
create unique index if not exists workspace_phone_numbers_one_primary_idx
  on public.workspace_phone_numbers (workspace_id)
  where is_primary;

create index if not exists workspace_phone_numbers_workspace_idx
  on public.workspace_phone_numbers (workspace_id);

alter table public.workspace_phone_numbers enable row level security;
revoke all on public.workspace_phone_numbers from anon;
grant select, insert, update on public.workspace_phone_numbers to authenticated;

-- Any workspace member may see the numbers list (same visibility as the
-- receptionist profile they attach to); only owner/admin can add numbers or
-- change label/status/overrides. No delete policy is granted -- deactivation
-- is a status update, matching this codebase's "no direct browser delete on
-- operational records" convention (see 0005_least_privilege_rbac.sql).
create policy workspace_phone_numbers_member_select on public.workspace_phone_numbers
  for select to authenticated using (private.is_workspace_member(workspace_id));
create policy workspace_phone_numbers_admin_insert on public.workspace_phone_numbers
  for insert to authenticated with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy workspace_phone_numbers_admin_update on public.workspace_phone_numbers
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));
revoke delete on public.workspace_phone_numbers from authenticated;

-- Backfill: every workspace that has already activated a single Twilio
-- number (integrations row, provider='twilio', status='connected') gets a
-- matching primary, active workspace_phone_numbers row with no overrides
-- (falls back to that workspace's existing receptionist_profiles row
-- exactly as today). `on conflict (phone_number) do nothing` makes this
-- safe to re-run and safe if this has already been backfilled.
insert into public.workspace_phone_numbers (workspace_id, phone_number, label, is_primary, status)
select workspace_id, external_account_id, 'Primary line', true, 'active'
from public.integrations
where provider = 'twilio' and status = 'connected' and external_account_id is not null
on conflict (phone_number) do nothing;
