-- Atomic public booking creation (fixes A05 from the internal audit).
--
-- The public booking route previously created the customer, appointment and
-- job as independent inserts with no transaction: a partial failure could
-- leave an orphan appointment or job, concurrent requests for the same slot
-- could both succeed, and the appointment/job were never explicitly linked.
-- The DB's overlap-exclusion constraint (appointments_no_staff_overlap, added
-- in 0004) only guards rows that already have assigned_user_id set, so public
-- bookings -- which never assign staff -- were not protected at the DB layer.
--
-- This function performs the whole booking in one plpgsql transaction, takes
-- an idempotency key so retries are safe, and re-checks for overlapping
-- appointments workspace-wide (not just per-assignee) under an advisory lock
-- keyed on the exact slot before inserting, so a losing concurrent request
-- gets a clean SLOT_TAKEN exception instead of a double-booked row.

alter table public.appointments
  add column if not exists public_booking_key text;
create unique index if not exists appointments_public_booking_key_idx
  on public.appointments(workspace_id, public_booking_key)
  where public_booking_key is not null;

create or replace function public.create_public_booking(
  p_workspace_id uuid,
  p_service_id uuid,
  p_customer_name text,
  p_phone text,
  p_normalized_phone text,
  p_email text,
  p_address_text text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text
) returns table (
  appointment_id uuid,
  job_id uuid,
  customer_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_customer_id uuid;
  v_appointment_id uuid;
  v_job_id uuid;
  v_existing record;
  v_conflict boolean;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_workspace_id is null or p_service_id is null then
    raise exception 'Workspace and service are required';
  end if;
  if char_length(trim(coalesce(p_customer_name, ''))) < 2 then
    raise exception 'Customer name is required';
  end if;
  if p_normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid phone number';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'Invalid slot range';
  end if;
  if char_length(coalesce(p_idempotency_key, '')) < 8 or char_length(p_idempotency_key) > 200 then
    raise exception 'Invalid idempotency key';
  end if;

  -- Idempotent replay: a retried request with the same key (e.g. a doubled
  -- click, or a client retry after a timed-out response) returns the
  -- original booking instead of creating a duplicate.
  select a.id as appointment_id, a.customer_id, a.starts_at, a.ends_at, j.id as job_id
  into v_existing
  from public.appointments a
  left join public.jobs j on j.appointment_id = a.id
  where a.workspace_id = p_workspace_id and a.public_booking_key = p_idempotency_key
  limit 1;
  if found then
    return query select v_existing.appointment_id, v_existing.job_id, v_existing.customer_id, v_existing.starts_at, v_existing.ends_at;
    return;
  end if;

  select * into v_service
  from public.services
  where id = p_service_id and workspace_id = p_workspace_id and booking_type = 'bookable';
  if not found then
    raise exception 'SERVICE_NOT_FOUND';
  end if;

  -- Serialize on the exact workspace/slot so two concurrent requests for the
  -- same time cannot both pass the overlap check below. Public bookings have
  -- no assigned_user_id, so this is the only thing standing between two
  -- customers both getting confirmed for the same appointment.
  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace_id::text || ':' || p_starts_at::text || ':' || p_ends_at::text, 0)
  );

  select exists(
    select 1 from public.appointments
    where workspace_id = p_workspace_id
      and status in ('hold', 'scheduled', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) or exists(
    select 1 from public.jobs
    where workspace_id = p_workspace_id
      and status in ('new', 'scheduled', 'on_the_way', 'in_progress')
      and scheduled_start is not null and scheduled_end is not null
      and tstzrange(scheduled_start, scheduled_end, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) into v_conflict;
  if v_conflict then
    raise exception 'SLOT_TAKEN';
  end if;

  insert into public.customers (workspace_id, display_name, phone, normalized_phone, email, source)
  values (p_workspace_id, trim(p_customer_name), p_phone, p_normalized_phone, p_email, 'public_booking')
  on conflict (workspace_id, normalized_phone) where normalized_phone is not null and deleted_at is null
  do update set
    display_name = case when trim(coalesce(public.customers.display_name, '')) = '' then excluded.display_name else public.customers.display_name end,
    email = coalesce(public.customers.email, excluded.email),
    updated_at = now()
  returning id into v_customer_id;

  insert into public.appointments (
    workspace_id, customer_id, service_id, title, starts_at, ends_at,
    address_text, status, source, public_booking_key
  ) values (
    p_workspace_id, v_customer_id, p_service_id, v_service.name, p_starts_at, p_ends_at,
    p_address_text, 'scheduled', 'public_booking', p_idempotency_key
  ) returning id into v_appointment_id;

  insert into public.jobs (
    workspace_id, customer_id, appointment_id, service_id, title,
    address_text, scheduled_start, scheduled_end, status
  ) values (
    p_workspace_id, v_customer_id, v_appointment_id, p_service_id, v_service.name,
    p_address_text, p_starts_at, p_ends_at, 'new'
  ) returning id into v_job_id;

  return query select v_appointment_id, v_job_id, v_customer_id, p_starts_at, p_ends_at;
end;
$$;

revoke all on function public.create_public_booking(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.create_public_booking(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,text) to service_role;
