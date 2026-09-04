-- Atomic workspace usage metering for subscription limits.

create table if not exists public.usage_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  metric_key text not null,
  period_start date not null,
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, metric_key, period_start)
);
alter table public.usage_counters enable row level security;
revoke all on public.usage_counters from anon, authenticated;

create or replace function public.consume_workspace_usage(
  target_workspace uuid,
  target_metric text,
  target_quantity bigint,
  target_limit bigint,
  target_idempotency_key text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  p_start date := date_trunc('month', now() at time zone 'UTC')::date;
  current_quantity bigint;
  existing boolean;
begin
  if target_quantity <= 0 then raise exception 'Usage quantity must be positive'; end if;
  if target_limit < 0 then raise exception 'Usage limit must not be negative'; end if;
  if char_length(target_idempotency_key) < 8 or char_length(target_idempotency_key) > 240 then
    raise exception 'Invalid usage idempotency key';
  end if;

  select exists(
    select 1 from public.usage_events
    where workspace_id = target_workspace
      and idempotency_key = target_idempotency_key
  ) into existing;
  if existing then
    select quantity into current_quantity from public.usage_counters
      where workspace_id = target_workspace and metric_key = target_metric and period_start = p_start;
    return coalesce(current_quantity, 0);
  end if;

  insert into public.usage_counters(workspace_id, metric_key, period_start, quantity)
  values (target_workspace, target_metric, p_start, 0)
  on conflict (workspace_id, metric_key, period_start) do nothing;

  select quantity into current_quantity
  from public.usage_counters
  where workspace_id = target_workspace and metric_key = target_metric and period_start = p_start
  for update;

  if current_quantity + target_quantity > target_limit then
    raise exception 'USAGE_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.usage_events(workspace_id, metric_key, quantity, idempotency_key)
  values (target_workspace, target_metric, target_quantity, target_idempotency_key);

  current_quantity := current_quantity + target_quantity;
  update public.usage_counters
    set quantity = current_quantity, updated_at = now()
    where workspace_id = target_workspace and metric_key = target_metric and period_start = p_start;

  return current_quantity;
end;
$$;
revoke all on function public.consume_workspace_usage(uuid,text,bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.consume_workspace_usage(uuid,text,bigint,bigint,text) to service_role;
