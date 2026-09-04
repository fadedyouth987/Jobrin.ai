-- Jobryn SaaS hardening: trial enforcement, booking concurrency and same-tenant references.

create extension if not exists btree_gist;

alter table public.subscriptions add column if not exists trial_ends_at timestamptz;
alter table public.subscriptions add column if not exists grace_period_ends_at timestamptz;

-- Existing starter workspaces receive a finite local trial if they have never attached Stripe.
update public.subscriptions
set status = 'trialing',
    trial_ends_at = coalesce(trial_ends_at, now() + interval '14 days'),
    updated_at = now()
where stripe_subscription_id is null
  and status = 'incomplete';

-- Seed a deterministic entitlement snapshot for workspaces created before this migration.
insert into public.subscription_entitlements(workspace_id, feature_key, enabled, limit_value)
select s.workspace_id, v.feature_key,
  case
    when v.feature_key = 'automations.advanced' then s.plan in ('growth','operator')
    when v.feature_key = 'campaigns.revenue' then s.plan in ('growth','operator')
    when v.feature_key = 'operator.full' then s.plan = 'operator'
    else true
  end as enabled,
  case v.feature_key
    when 'usage.users' then case s.plan when 'operator' then 25 when 'growth' then 8 else 2 end
    when 'usage.sms' then case s.plan when 'operator' then 4000 when 'growth' then 1000 else 250 end
    when 'usage.ai_actions' then case s.plan when 'operator' then 10000 when 'growth' then 1500 else 250 end
    else null
  end as limit_value
from public.subscriptions s
cross join (values
  ('crm.core'),('lead.capture'),('ai.basic'),('booking.core'),
  ('automations.advanced'),('campaigns.revenue'),('operator.full'),
  ('usage.users'),('usage.sms'),('usage.ai_actions')
) as v(feature_key)
on conflict (workspace_id, feature_key) do nothing;

-- Prevent concurrent double-booking at the database boundary, not just in HTTP code.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_no_staff_overlap'
  ) then
    alter table public.appointments
      add constraint appointments_no_staff_overlap
      exclude using gist (
        workspace_id with =,
        assigned_user_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      )
      where (assigned_user_id is not null and status in ('hold','scheduled','confirmed'));
  end if;
end $$;

-- A child row may only reference a parent from the same workspace. This prevents
-- cross-tenant foreign-key attachment even if a UUID becomes known.
create or replace function private.assert_same_workspace_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ref_id uuid;
  ref_workspace uuid;
  ref_column text := tg_argv[0];
  ref_table text := tg_argv[1];
begin
  ref_id := nullif(to_jsonb(new)->>ref_column, '')::uuid;
  if ref_id is null then return new; end if;

  execute format('select workspace_id from public.%I where id = $1', ref_table)
    into ref_workspace using ref_id;

  if ref_workspace is null or ref_workspace <> new.workspace_id then
    raise exception 'Cross-workspace reference rejected: %.%', ref_table, ref_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_same_workspace_reference() from public, anon, authenticated;

create or replace function private.assert_workspace_member_reference()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ref_user uuid;
  ref_column text := tg_argv[0];
begin
  ref_user := nullif(to_jsonb(new)->>ref_column, '')::uuid;
  if ref_user is null then return new; end if;

  if not exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = ref_user
      and wm.status = 'active'
  ) then
    raise exception 'Assigned user is not an active workspace member'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_workspace_member_reference() from public, anon, authenticated;

-- Tenant reference guards.
do $$
declare
  spec text;
  parts text[];
  trigger_name text;
  specs text[] := array[
    'customer_addresses:customer_id:customers',
    'customer_consents:customer_id:customers',
    'suppression_entries:customer_id:customers',
    'leads:customer_id:customers','leads:service_id:services',
    'conversations:customer_id:customers','conversations:lead_id:leads',
    'messages:conversation_id:conversations','messages:customer_id:customers',
    'calls:conversation_id:conversations','calls:customer_id:customers',
    'appointments:customer_id:customers','appointments:lead_id:leads','appointments:service_id:services',
    'jobs:customer_id:customers','jobs:lead_id:leads','jobs:appointment_id:appointments','jobs:service_id:services',
    'quotes:customer_id:customers','quotes:lead_id:leads','quotes:job_id:jobs',
    'quote_items:quote_id:quotes',
    'invoices:customer_id:customers','invoices:job_id:jobs','invoices:quote_id:quotes',
    'invoice_items:invoice_id:invoices',
    'payments:customer_id:customers','payments:invoice_id:invoices',
    'knowledge_chunks:document_id:knowledge_documents',
    'ai_actions:conversation_id:conversations','ai_actions:customer_id:customers',
    'approvals:ai_action_id:ai_actions',
    'automation_runs:automation_id:automations',
    'review_requests:customer_id:customers','review_requests:job_id:jobs',
    'revenue_attributions:customer_id:customers','revenue_attributions:lead_id:leads',
    'revenue_attributions:conversation_id:conversations','revenue_attributions:job_id:jobs',
    'revenue_attributions:payment_id:payments','revenue_attributions:campaign_id:campaigns'
  ];
begin
  foreach spec in array specs loop
    parts := string_to_array(spec, ':');
    trigger_name := 'tenant_ref_' || parts[1] || '_' || parts[2];
    execute format('drop trigger if exists %I on public.%I', trigger_name, parts[1]);
    execute format(
      'create trigger %I before insert or update of %I, workspace_id on public.%I for each row execute function private.assert_same_workspace_reference(%L,%L)',
      trigger_name, parts[2], parts[1], parts[2], parts[3]
    );
  end loop;
end $$;

-- Workspace-member assignment guards.
do $$
declare
  spec text;
  parts text[];
  trigger_name text;
  specs text[] := array[
    'leads:owner_user_id',
    'conversations:locked_by','conversations:assigned_user_id',
    'appointments:assigned_user_id','jobs:assigned_user_id',
    'notifications:user_id'
  ];
begin
  foreach spec in array specs loop
    parts := string_to_array(spec, ':');
    trigger_name := 'member_ref_' || parts[1] || '_' || parts[2];
    execute format('drop trigger if exists %I on public.%I', trigger_name, parts[1]);
    execute format(
      'create trigger %I before insert or update of %I, workspace_id on public.%I for each row execute function private.assert_workspace_member_reference(%L)',
      trigger_name, parts[2], parts[1], parts[2]
    );
  end loop;
end $$;

-- Workspace creation includes a real finite starter trial and starter entitlements.
create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_workspace uuid;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(trim(workspace_name)) < 2 or char_length(trim(workspace_name)) > 100 then
    raise exception 'Invalid workspace name';
  end if;
  if workspace_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception 'Invalid workspace slug';
  end if;

  insert into public.workspaces(name, slug, owner_user_id, plan)
  values (trim(workspace_name), workspace_slug, uid, 'starter')
  returning id into new_workspace;

  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (new_workspace, uid, 'owner', 'active');

  insert into public.credit_wallets(workspace_id, balance, lifetime_purchased, lifetime_consumed)
  values (new_workspace, 0, 0, 0);

  insert into public.subscriptions(workspace_id, plan, status, trial_ends_at)
  values (new_workspace, 'starter', 'trialing', now() + interval '14 days');

  insert into public.subscription_entitlements(workspace_id, feature_key, enabled, limit_value)
  values
    (new_workspace,'crm.core',true,null),
    (new_workspace,'lead.capture',true,null),
    (new_workspace,'ai.basic',true,null),
    (new_workspace,'booking.core',true,null),
    (new_workspace,'automations.advanced',false,null),
    (new_workspace,'campaigns.revenue',false,null),
    (new_workspace,'operator.full',false,null),
    (new_workspace,'usage.users',true,2),
    (new_workspace,'usage.sms',true,250),
    (new_workspace,'usage.ai_actions',true,250);

  insert into public.business_profiles(workspace_id, trading_name)
  values (new_workspace, trim(workspace_name));

  insert into public.onboarding_progress(workspace_id, step_key, status)
  values (new_workspace, 'business', 'in_progress');

  return new_workspace;
end;
$$;
revoke all on function public.create_workspace(text,text) from public, anon;
grant execute on function public.create_workspace(text,text) to authenticated;

-- Extend Stripe state application with trial/grace cleanup.
create or replace function public.apply_subscription_state(
  target_workspace uuid,
  target_customer_id text,
  target_subscription_id text,
  target_price_id text,
  target_plan text,
  target_status public.subscription_status,
  target_period_end timestamptz,
  target_cancel_at_period_end boolean,
  target_entitlements jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kv record;
  enabled_value boolean;
  limit_value bigint;
begin
  if target_plan not in ('starter','growth','operator') then raise exception 'Invalid plan'; end if;

  update public.workspaces set plan = target_plan, updated_at = now() where id = target_workspace;
  if not found then raise exception 'Workspace not found'; end if;

  insert into public.subscriptions(
    workspace_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    plan, status, current_period_end, cancel_at_period_end, trial_ends_at,
    grace_period_ends_at, updated_at
  ) values (
    target_workspace, target_customer_id, target_subscription_id, target_price_id,
    target_plan, target_status, target_period_end, target_cancel_at_period_end, null,
    case when target_status = 'past_due' then now() + interval '3 days' else null end,
    now()
  ) on conflict (workspace_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    plan = excluded.plan,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    trial_ends_at = null,
    grace_period_ends_at = excluded.grace_period_ends_at,
    updated_at = now();

  -- Disable stale feature rows before applying the canonical plan snapshot.
  update public.subscription_entitlements
    set enabled = false, limit_value = null, updated_at = now()
    where workspace_id = target_workspace;

  for kv in select key, value from jsonb_each(target_entitlements)
  loop
    if jsonb_typeof(kv.value) = 'boolean' then
      enabled_value := (kv.value #>> '{}')::boolean;
      limit_value := null;
    elsif jsonb_typeof(kv.value) = 'number' then
      enabled_value := true;
      limit_value := (kv.value #>> '{}')::bigint;
    else
      raise exception 'Invalid entitlement value for %', kv.key;
    end if;

    insert into public.subscription_entitlements(workspace_id, feature_key, enabled, limit_value, updated_at)
    values (target_workspace, kv.key, enabled_value, limit_value, now())
    on conflict (workspace_id, feature_key) do update set
      enabled = excluded.enabled,
      limit_value = excluded.limit_value,
      updated_at = now();
  end loop;
end;
$$;
revoke all on function public.apply_subscription_state(uuid,text,text,text,text,public.subscription_status,timestamptz,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.apply_subscription_state(uuid,text,text,text,text,public.subscription_status,timestamptz,boolean,jsonb) to service_role;
