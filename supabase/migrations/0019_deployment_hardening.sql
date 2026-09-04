-- Deployment hardening: limit trial abuse, remove an unused public credit RPC,
-- and add the foreign-key indexes identified by the production adviser.

create or replace function public.create_workspace(workspace_name text, workspace_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_workspace uuid;
  workspace_count integer;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(trim(workspace_name)) < 2 or char_length(trim(workspace_name)) > 100 then
    raise exception 'Invalid workspace name';
  end if;
  if workspace_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' then
    raise exception 'Invalid workspace slug';
  end if;

  -- Serialize creation per user. This prevents concurrent direct RPC calls from
  -- bypassing the maximum number of trial workspaces.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select count(*) into workspace_count
  from public.workspace_members
  where user_id = uid and role = 'owner';
  if workspace_count >= 3 then
    raise exception 'Workspace limit reached';
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
  select new_workspace, defaults.feature_key, defaults.enabled, defaults.limit_value
  from (values
    ('crm.core', true, null::bigint),('lead.capture', true, null::bigint),('ai.basic', true, null::bigint),('booking.core', true, null::bigint),('hiring.core', true, null::bigint),
    ('automations.advanced', false, null::bigint),('campaigns.revenue', false, null::bigint),('operator.full', false, null::bigint),
    ('usage.users', true, 2::bigint),('usage.sms', true, 250::bigint),('usage.ai_actions', true, 250::bigint)
  ) as defaults(feature_key, enabled, limit_value);
  insert into public.business_profiles(workspace_id, trading_name)
  values (new_workspace, trim(workspace_name));
  insert into public.onboarding_progress(workspace_id, step_key, status)
  values (new_workspace, 'business', 'in_progress');
  return new_workspace;
end;
$$;
revoke all on function public.create_workspace(text,text) from public, anon;
grant execute on function public.create_workspace(text,text) to authenticated;

-- No active Jobryn route calls this legacy RPC. Keep it unavailable until a
-- dedicated owner/admin server workflow is implemented and tested.
revoke all on function public.reserve_credits(uuid,bigint,text,text,uuid) from public, anon, authenticated;

create index if not exists candidate_applications_candidate_fk_idx on public.candidate_applications(candidate_id);
create index if not exists candidate_applications_created_by_fk_idx on public.candidate_applications(created_by);
create index if not exists candidates_created_by_fk_idx on public.candidates(created_by);
create index if not exists conversation_notes_author_user_fk_idx on public.conversation_notes(author_user_id);
create index if not exists conversation_notes_conversation_fk_idx on public.conversation_notes(conversation_id);
create index if not exists job_openings_created_by_fk_idx on public.job_openings(created_by);
create index if not exists sms_campaign_recipients_customer_fk_idx on public.sms_campaign_recipients(customer_id);
create index if not exists sms_campaign_recipients_message_fk_idx on public.sms_campaign_recipients(message_id);
create index if not exists sms_campaigns_approved_by_fk_idx on public.sms_campaigns(approved_by);
create index if not exists sms_campaigns_created_by_fk_idx on public.sms_campaigns(created_by);
create index if not exists sms_delivery_attempts_campaign_fk_idx on public.sms_delivery_attempts(campaign_id);
create index if not exists sms_delivery_attempts_customer_fk_idx on public.sms_delivery_attempts(customer_id);
