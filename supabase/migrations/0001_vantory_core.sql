-- Jobryn Core v0.1 (historical filename and database identifiers retained for compatibility)
-- Multi-tenant SaaS foundation: auth profiles, workspaces, RLS, campaigns, assets, credits, billing and audit.

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.workspace_role as enum ('owner','admin','approver','creator','viewer');
create type public.member_status as enum ('active','invited','disabled');
create type public.subscription_status as enum ('trialing','active','past_due','canceled','incomplete','unpaid','paused');
create type public.asset_status as enum ('draft','pending_review','approved','rejected','scheduled','published');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  plan text not null default 'starter' check (plan in ('starter','professional','enterprise')),
  legal_hold_active boolean not null default false,
  retention_days integer not null default 365 check (retention_days between 30 and 3650),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'viewer',
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id, status);

create or replace function private.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  );
$$;

create or replace function private.has_workspace_role(target_workspace uuid, allowed_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
      and wm.role = any(allowed_roles)
  );
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, public.workspace_role[]) to authenticated;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  brief text,
  status text not null default 'draft' check (status in ('draft','active','paused','completed','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_workspace_idx on public.campaigns(workspace_id, created_at desc);

create table public.campaign_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  title text not null,
  platform text not null check (platform in ('instagram','tiktok','linkedin','twitter','facebook')),
  status public.asset_status not null default 'draft',
  caption text not null default '',
  hashtags text[] not null default '{}',
  image_prompt text not null default '',
  visual_direction text not null default '',
  scheduled_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_assets_workspace_idx on public.campaign_assets(workspace_id, created_at desc);
create index campaign_assets_campaign_idx on public.campaign_assets(campaign_id, created_at desc);

create table public.credit_wallets (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  lifetime_purchased bigint not null default 0 check (lifetime_purchased >= 0),
  lifetime_consumed bigint not null default 0 check (lifetime_consumed >= 0),
  updated_at timestamptz not null default now()
);

create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('allocation','purchase','reservation','usage','refund','adjustment')),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null check (balance_after >= 0),
  description text not null,
  idempotency_key text,
  stripe_reference text,
  asset_id uuid references public.campaign_assets(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index credit_transactions_workspace_idx on public.credit_transactions(workspace_id, created_at desc);

create table public.subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text not null default 'starter' check (plan in ('starter','professional','enterprise')),
  status public.subscription_status not null default 'incomplete',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  received_at timestamptz not null default now(),
  processing_error text
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  ip_address inet,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  created_at timestamptz not null default now()
);
create index audit_logs_workspace_idx on public.audit_logs(workspace_id, created_at desc);

create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  insert into public.workspaces(name, slug, owner_user_id)
  values (trim(workspace_name), lower(trim(workspace_slug)), (select auth.uid()))
  returning id into new_id;
  insert into public.workspace_members(workspace_id, user_id, role, status)
  values (new_id, (select auth.uid()), 'owner', 'active');
  insert into public.credit_wallets(workspace_id, balance) values (new_id, 0);
  return new_id;
end;
$$;
grant execute on function public.create_workspace(text,text) to authenticated;

create or replace function public.reserve_credits(
  target_workspace uuid,
  amount_to_reserve bigint,
  txn_description text,
  txn_idempotency_key text default null,
  target_asset uuid default null
)
returns table(transaction_id uuid, new_balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance bigint;
  existing_tx public.credit_transactions%rowtype;
  tx_id uuid;
begin
  if not private.is_workspace_member(target_workspace) then raise exception 'Workspace access denied'; end if;
  if amount_to_reserve <= 0 then raise exception 'Amount must be positive'; end if;

  if txn_idempotency_key is not null then
    select * into existing_tx from public.credit_transactions
    where workspace_id = target_workspace and idempotency_key = txn_idempotency_key;
    if found then
      return query select existing_tx.id, existing_tx.balance_after;
      return;
    end if;
  end if;

  select balance into current_balance from public.credit_wallets
  where workspace_id = target_workspace for update;
  if current_balance is null then raise exception 'Credit wallet missing'; end if;
  if current_balance < amount_to_reserve then raise exception 'Insufficient credits'; end if;

  current_balance := current_balance - amount_to_reserve;
  update public.credit_wallets
  set balance = current_balance,
      lifetime_consumed = lifetime_consumed + amount_to_reserve,
      updated_at = now()
  where workspace_id = target_workspace;

  insert into public.credit_transactions(
    workspace_id, kind, amount, balance_after, description, idempotency_key, asset_id, created_by
  ) values (
    target_workspace, 'reservation', -amount_to_reserve, current_balance,
    txn_description, txn_idempotency_key, target_asset, (select auth.uid())
  ) returning id into tx_id;

  return query select tx_id, current_balance;
end;
$$;
grant execute on function public.reserve_credits(uuid,bigint,text,text,uuid) to authenticated;

-- RLS is mandatory on tenant-facing tables.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_assets enable row level security;
alter table public.credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_self_update on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy workspaces_member_select on public.workspaces for select to authenticated using (private.is_workspace_member(id));
create policy workspaces_admin_update on public.workspaces for update to authenticated
  using (private.has_workspace_role(id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_workspace_role(id, array['owner','admin']::public.workspace_role[]));

create policy members_workspace_select on public.workspace_members for select to authenticated using (private.is_workspace_member(workspace_id));
create policy members_admin_insert on public.workspace_members for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy members_admin_update on public.workspace_members for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy members_admin_delete on public.workspace_members for delete to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

create policy campaigns_member_select on public.campaigns for select to authenticated using (private.is_workspace_member(workspace_id));
create policy campaigns_creator_insert on public.campaigns for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]) and created_by = (select auth.uid()));
create policy campaigns_creator_update on public.campaigns for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]));

create policy assets_member_select on public.campaign_assets for select to authenticated using (private.is_workspace_member(workspace_id));
create policy assets_creator_insert on public.campaign_assets for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]) and created_by = (select auth.uid()));
create policy assets_creator_update on public.campaign_assets for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]));

create policy wallets_member_select on public.credit_wallets for select to authenticated using (private.is_workspace_member(workspace_id));
create policy transactions_member_select on public.credit_transactions for select to authenticated using (private.is_workspace_member(workspace_id));
create policy subscriptions_admin_select on public.subscriptions for select to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy audits_member_select on public.audit_logs for select to authenticated using (private.is_workspace_member(workspace_id));

-- Auth profile bootstrap.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name',''), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Private asset bucket. Object access policies will be scoped by workspace UUID as first path segment.
insert into storage.buckets(id, name, public) values ('vantory-assets','vantory-assets',false)
on conflict (id) do nothing;

create policy asset_objects_member_select on storage.objects for select to authenticated
using (
  bucket_id = 'vantory-assets'
  and private.is_workspace_member(((storage.foldername(name))[1])::uuid)
);
create policy asset_objects_creator_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'vantory-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','approver','creator']::public.workspace_role[])
);
create policy asset_objects_creator_update on storage.objects for update to authenticated
using (
  bucket_id = 'vantory-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','approver','creator']::public.workspace_role[])
)
with check (
  bucket_id = 'vantory-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','approver','creator']::public.workspace_role[])
);

-- Explicit least-privilege API grants. RLS still applies to every authenticated query.
revoke all on public.profiles, public.workspaces, public.workspace_members, public.campaigns, public.campaign_assets,
  public.credit_wallets, public.credit_transactions, public.subscriptions, public.audit_logs from anon;
grant select, update on public.profiles to authenticated;
grant select, update on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_assets to authenticated;
grant select on public.credit_wallets, public.credit_transactions, public.subscriptions, public.audit_logs to authenticated;

-- Transitional persistence for complex Campaign OS modules while they are normalized into dedicated tables.
-- This removes browser-only localStorage without pretending the module is fully normalized yet.
create table public.workspace_module_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  module_key text not null check (char_length(module_key) between 2 and 80),
  state jsonb not null default '{}'::jsonb,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, module_key)
);
alter table public.workspace_module_state enable row level security;
create policy module_state_member_select on public.workspace_module_state for select to authenticated using (private.is_workspace_member(workspace_id));
create policy module_state_creator_insert on public.workspace_module_state for insert to authenticated
  with check (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]) and updated_by = (select auth.uid()));
create policy module_state_creator_update on public.workspace_module_state for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','approver','creator']::public.workspace_role[]) and updated_by = (select auth.uid()));
grant select, insert, update on public.workspace_module_state to authenticated;
