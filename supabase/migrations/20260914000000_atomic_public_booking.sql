-- Public booking must be atomic: customer creation, appointment insert and
-- job insert (with the job linked back to its appointment) all happen inside
-- one transaction, guarded by a workspace+slot advisory lock so two
-- concurrent public bookings for the same time cannot both succeed. Public
-- bookings never carry an assigned_user_id, so the existing
-- appointments_no_staff_overlap exclusion constraint (0004) does not protect
-- them; this function re-checks for conflicts workspace-wide instead.

alter table public.appointments add column if not exists public_booking_key text;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'appointments_public_booking_key_unique'
  ) then
    create unique index appointments_public_booking_key_unique
      on public.appointments (workspace_id, public_booking_key)
      where public_booking_key is not null;
  end if;
end $$;

create or replace function public.create_public_booking(
  target_workspace uuid,
  target_service uuid,
  target_service_name text,
  target_customer_name text,
  target_phone text,
  target_normalized_phone text,
  target_email text,
  target_address_text text,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_booking_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lock_key1 int;
  lock_key2 int;
  existing_appointment public.appointments%rowtype;
  existing_job public.jobs%rowtype;
  target_customer uuid;
  new_appointment_id uuid;
  new_job_id uuid;
  conflict_count int;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if target_ends_at <= target_starts_at then
    raise exception 'invalid slot range';
  end if;

  -- Idempotent replay: a client retry (e.g. after a network timeout) with the
  -- same deterministic key returns the original booking instead of creating a
  -- duplicate appointment/job pair.
  if target_booking_key is not null then
    select * into existing_appointment
    from public.appointments
    where workspace_id = target_workspace and public_booking_key = target_booking_key;
    if found then
      select * into existing_job from public.jobs
      where workspace_id = target_workspace and appointment_id = existing_appointment.id
      limit 1;
      return jsonb_build_object(
        'created', false,
        'appointment_id', existing_appointment.id,
        'job_id', existing_job.id,
        'customer_id', existing_appointment.customer_id
      );
    end if;
  end if;

  -- Serialize concurrent booking attempts for the same workspace+slot so the
  -- overlap check below cannot race with another request booking the same
  -- time. Held for the rest of the transaction.
  lock_key1 := hashtext(target_workspace::text);
  lock_key2 := hashtext(target_starts_at::text || '|' || target_ends_at::text);
  perform pg_advisory_xact_lock(lock_key1, lock_key2);

  -- Public bookings have no assigned_user_id, so check workspace-wide across
  -- both appointments and jobs (a job may be scheduled without a linked
  -- appointment row).
  select count(*) into conflict_count
  from public.appointments
  where workspace_id = target_workspace
    and status in ('hold', 'scheduled', 'confirmed')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(target_starts_at, target_ends_at, '[)');
  if conflict_count > 0 then
    raise exception 'SLOT_TAKEN';
  end if;

  select count(*) into conflict_count
  from public.jobs
  where workspace_id = target_workspace
    and scheduled_start is not null
    and scheduled_end is not null
    and status in ('new', 'scheduled', 'on_the_way', 'in_progress')
    and tstzrange(scheduled_start, scheduled_end, '[)') && tstzrange(target_starts_at, target_ends_at, '[)');
  if conflict_count > 0 then
    raise exception 'SLOT_TAKEN';
  end if;

  select id into target_customer
  from public.customers
  where workspace_id = target_workspace
    and normalized_phone = target_normalized_phone
    and deleted_at is null
  limit 1;

  if target_customer is null then
    insert into public.customers (workspace_id, display_name, phone, normalized_phone, email, source)
    values (target_workspace, target_customer_name, target_phone, target_normalized_phone, target_email, 'public_booking')
    returning id into target_customer;
  end if;

  insert into public.appointments (
    workspace_id, customer_id, service_id, title, address_text,
    starts_at, ends_at, status, source, public_booking_key
  ) values (
    target_workspace, target_customer, target_service, target_service_name, target_address_text,
    target_starts_at, target_ends_at, 'scheduled', 'public_booking', target_booking_key
  )
  returning id into new_appointment_id;

  insert into public.jobs (
    workspace_id, customer_id, appointment_id, service_id, title, address_text,
    scheduled_start, scheduled_end, status
  ) values (
    target_workspace, target_customer, new_appointment_id, target_service, target_service_name, target_address_text,
    target_starts_at, target_ends_at, 'new'
  )
  returning id into new_job_id;

  return jsonb_build_object(
    'created', true,
    'appointment_id', new_appointment_id,
    'job_id', new_job_id,
    'customer_id', target_customer
  );
end;
$$;

revoke all on function public.create_public_booking(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.create_public_booking(uuid,uuid,text,text,text,text,text,text,timestamptz,timestamptz,text) to service_role;
