create or replace function public.get_workspace_access_state(target_workspace uuid)
returns table(status public.subscription_status, trial_ends_at timestamptz, grace_period_ends_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_member(target_workspace) then
    raise exception 'Workspace access denied' using errcode = '42501';
  end if;
  return query
  select s.status, s.trial_ends_at, s.grace_period_ends_at
  from public.subscriptions s
  where s.workspace_id = target_workspace;
end;
$$;

revoke all on function public.get_workspace_access_state(uuid) from public, anon;
grant execute on function public.get_workspace_access_state(uuid) to authenticated, service_role;
