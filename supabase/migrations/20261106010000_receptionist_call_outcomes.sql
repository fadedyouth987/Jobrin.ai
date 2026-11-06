-- Phase 1 (missed-call catcher): every answered call ends in exactly one lead
-- and at most one owner alert, however many times the call-end paths run
-- (WebSocket close in either runtime, Twilio's /voice/complete callback,
-- provider retries). The guarantees live in the database, not in workers.
--
-- Additive only: no existing column, row or policy is changed.

-- ---------------------------------------------------------------------------
-- Leads: the captured job, linked to the call that produced it.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists call_id uuid references public.calls(id) on delete set null,
  add column if not exists suburb text,
  add column if not exists job_type text,
  add column if not exists urgency text;

alter table public.leads drop constraint if exists leads_suburb_length;
alter table public.leads add constraint leads_suburb_length check (suburb is null or char_length(suburb) <= 120);
alter table public.leads drop constraint if exists leads_job_type_length;
alter table public.leads add constraint leads_job_type_length check (job_type is null or char_length(job_type) <= 160);
alter table public.leads drop constraint if exists leads_urgency_check;
alter table public.leads add constraint leads_urgency_check check (urgency is null or urgency in ('emergency', 'urgent', 'routine'));

-- One lead per call. NULLs are distinct, so leads without a call are unaffected.
alter table public.leads drop constraint if exists leads_one_per_call;
alter table public.leads add constraint leads_one_per_call unique (workspace_id, call_id);

-- Same cross-workspace guard as every other tenant reference (see 0004).
drop trigger if exists tenant_ref_leads_call_id on public.leads;
create trigger tenant_ref_leads_call_id
  before insert or update of call_id, workspace_id on public.leads
  for each row execute function private.assert_same_workspace_reference('call_id', 'calls');

-- ---------------------------------------------------------------------------
-- Where owner alerts go. NULL falls back to the warm-transfer number.
-- ---------------------------------------------------------------------------
alter table public.receptionist_profiles
  add column if not exists owner_alert_number text;
alter table public.receptionist_profiles drop constraint if exists receptionist_profiles_owner_alert_number_check;
alter table public.receptionist_profiles add constraint receptionist_profiles_owner_alert_number_check
  check (owner_alert_number is null or owner_alert_number ~ '^\+[1-9][0-9]{7,14}$');

-- ---------------------------------------------------------------------------
-- Alert deliveries: one row per (lead, kind), claimed before anything is sent.
-- ---------------------------------------------------------------------------
create table if not exists public.alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null check (kind in ('owner_new_lead')),
  channel text not null check (channel in ('sms')),
  recipient text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  detail text check (detail is null or char_length(detail) <= 300),
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (workspace_id, lead_id, kind)
);
create index if not exists alert_deliveries_workspace_created_idx on public.alert_deliveries(workspace_id, created_at desc);
create index if not exists alert_deliveries_lead_idx on public.alert_deliveries(lead_id);

drop trigger if exists tenant_ref_alert_deliveries_lead_id on public.alert_deliveries;
create trigger tenant_ref_alert_deliveries_lead_id
  before insert or update of lead_id, workspace_id on public.alert_deliveries
  for each row execute function private.assert_same_workspace_reference('lead_id', 'leads');

alter table public.alert_deliveries enable row level security;
revoke all on public.alert_deliveries from anon, authenticated;
grant select on public.alert_deliveries to authenticated;
grant all on public.alert_deliveries to service_role;
drop policy if exists alert_deliveries_member_select on public.alert_deliveries;
create policy alert_deliveries_member_select on public.alert_deliveries
  for select to authenticated using (private.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- record_receptionist_call_lead: create the call's lead, or merge newly
-- captured details into it. Safe to call any number of times, concurrently.
-- The call must already exist in p_workspace_id (created by the signed voice
-- webhook), so a caller cannot attach a lead to another tenant's call.
-- Never changes a lead's stage: the owner may already be working it.
-- ---------------------------------------------------------------------------
create or replace function public.record_receptionist_call_lead(
  p_workspace_id uuid,
  p_call_sid text,
  p_caller_name text default null,
  p_callback_number text default null,
  p_suburb text default null,
  p_job_type text default null,
  p_urgency text default null,
  p_note text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_phone text;
  v_customer uuid;
  v_lead uuid;
  v_name text := nullif(left(btrim(coalesce(p_caller_name, '')), 120), '');
  v_suburb text := nullif(left(btrim(coalesce(p_suburb, '')), 120), '');
  v_job text := nullif(left(btrim(coalesce(p_job_type, '')), 160), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_urgency text := case when lower(btrim(coalesce(p_urgency, ''))) in ('emergency', 'urgent', 'routine') then lower(btrim(p_urgency)) end;
begin
  select * into v_call from public.calls
  where workspace_id = p_workspace_id and provider = 'twilio' and provider_call_id = p_call_sid;
  if not found then
    raise exception 'Unknown call for this workspace' using errcode = 'P0002';
  end if;

  -- Serialise both call-end paths for this call.
  perform pg_advisory_xact_lock(hashtextextended('receptionist-call:' || v_call.id::text, 0));

  -- Prefer a valid number the caller gave; otherwise the caller ID (absent
  -- when withheld).
  v_phone := case
    when regexp_replace(coalesce(p_callback_number, ''), '[^0-9+]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$' then regexp_replace(p_callback_number, '[^0-9+]', '', 'g')
    when regexp_replace(coalesce(p_callback_number, ''), '[^0-9]', '', 'g') ~ '^0[2-478][0-9]{8}$' then '+61' || substr(regexp_replace(p_callback_number, '[^0-9]', '', 'g'), 2)
    when coalesce(v_call.from_number, '') ~ '^\+[1-9][0-9]{7,14}$' then v_call.from_number
  end;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended('customer-phone:' || p_workspace_id::text || ':' || v_phone, 0));
    select id into v_customer from public.customers
    where workspace_id = p_workspace_id and normalized_phone = v_phone and deleted_at is null;
    if v_customer is null then
      -- Other writers (e.g. inbound SMS) do not take this lock; the unique
      -- (workspace_id, normalized_phone) index from 0003 settles any race.
      insert into public.customers (workspace_id, display_name, phone, normalized_phone, source)
      values (p_workspace_id, coalesce(v_name, v_phone), v_phone, v_phone, 'receptionist')
      on conflict (workspace_id, normalized_phone) where normalized_phone is not null and deleted_at is null do nothing
      returning id into v_customer;
      if v_customer is null then
        select id into v_customer from public.customers
        where workspace_id = p_workspace_id and normalized_phone = v_phone and deleted_at is null;
      end if;
    end if;
  end if;

  insert into public.leads as l (workspace_id, customer_id, call_id, title, description, source, source_detail, suburb, job_type, urgency)
  values (
    p_workspace_id, v_customer, v_call.id,
    left(coalesce(v_job, 'Missed call') || coalesce(' - ' || v_suburb, ''), 200),
    coalesce(v_note, ''),
    'receptionist',
    jsonb_build_object('call_sid', p_call_sid, 'caller_name', v_name),
    v_suburb, v_job, v_urgency
  )
  on conflict (workspace_id, call_id) do update set
    customer_id = coalesce(l.customer_id, excluded.customer_id),
    suburb = coalesce(excluded.suburb, l.suburb),
    job_type = coalesce(excluded.job_type, l.job_type),
    urgency = coalesce(excluded.urgency, l.urgency),
    title = left(coalesce(excluded.job_type, l.job_type, 'Missed call') || coalesce(' - ' || coalesce(excluded.suburb, l.suburb), ''), 200),
    description = case
      when excluded.description = '' or position(excluded.description in l.description) > 0 then l.description
      when l.description = '' then excluded.description
      else left(l.description || E'\n' || excluded.description, 4000)
    end,
    source_detail = l.source_detail || jsonb_strip_nulls(jsonb_build_object('caller_name', v_name)),
    updated_at = now()
  returning l.id into v_lead;

  return v_lead;
end $$;

-- ---------------------------------------------------------------------------
-- claim_alert_delivery: returns a delivery id exactly once per (lead, kind);
-- NULL means it was already claimed and must not be sent again.
-- ---------------------------------------------------------------------------
create or replace function public.claim_alert_delivery(
  p_workspace_id uuid,
  p_lead_id uuid,
  p_kind text,
  p_recipient text
) returns uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.alert_deliveries (workspace_id, lead_id, kind, channel, recipient)
  values (p_workspace_id, p_lead_id, p_kind, 'sms', p_recipient)
  on conflict (workspace_id, lead_id, kind) do nothing
  returning id;
$$;

-- Server-only (service role). Supabase grants EXECUTE on new functions to
-- anon/authenticated by default, so revoke explicitly.
revoke all on function public.record_receptionist_call_lead(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_alert_delivery(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_receptionist_call_lead(uuid, text, text, text, text, text, text, text) to service_role;
grant execute on function public.claim_alert_delivery(uuid, uuid, text, text) to service_role;
