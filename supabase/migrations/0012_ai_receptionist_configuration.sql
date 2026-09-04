-- Tenant-owned, non-secret configuration for the Jobryn AI receptionist.
-- Provider credentials remain server-side environment secrets.
create table if not exists public.receptionist_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  enabled boolean not null default false,
  display_name text not null default 'Jobryn Receptionist' check (char_length(display_name) between 2 and 80),
  greeting text not null default 'Thanks for calling. How can I help you today?' check (char_length(greeting) between 10 and 500),
  voice_provider text not null default 'Google' check (voice_provider in ('Google','Amazon','ElevenLabs')),
  voice_id text not null default 'en-AU-Chirp3-HD-Achernar' check (char_length(voice_id) between 2 and 120),
  language text not null default 'en-AU' check (char_length(language) between 2 and 20),
  tone text not null default 'warm, calm and professional' check (char_length(tone) between 3 and 200),
  business_instructions text not null default 'Answer questions using approved business knowledge. Ask one question at a time. Never invent prices, availability, policies or completed actions.' check (char_length(business_instructions) between 20 and 6000),
  qualification_questions jsonb not null default '[]'::jsonb,
  transfer_number text,
  after_hours_message text not null default 'The team is unavailable right now. I can take a message and arrange a callback.' check (char_length(after_hours_message) between 10 and 500),
  allow_booking boolean not null default false,
  allow_warm_transfer boolean not null default true,
  allow_message_take boolean not null default true,
  allow_followup_sms boolean not null default false,
  recording_enabled boolean not null default false,
  recording_consent_prompt text not null default 'This call may be recorded to help the business follow up. Is that okay?' check (char_length(recording_consent_prompt) between 10 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (transfer_number is null or transfer_number ~ '^\+[1-9][0-9]{7,14}$'),
  check (jsonb_typeof(qualification_questions) = 'array')
);

alter table public.receptionist_profiles enable row level security;
revoke all on public.receptionist_profiles from anon;
grant select, insert, update on public.receptionist_profiles to authenticated;

create policy receptionist_profiles_member_select on public.receptionist_profiles
  for select to authenticated using (private.is_workspace_member(workspace_id));
create policy receptionist_profiles_admin_insert on public.receptionist_profiles
  for insert to authenticated with check (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy receptionist_profiles_admin_update on public.receptionist_profiles
  for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

create index if not exists calls_workspace_provider_call_idx on public.calls(workspace_id, provider_call_id);
