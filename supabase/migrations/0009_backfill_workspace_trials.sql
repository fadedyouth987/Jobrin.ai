-- Repair workspaces created before subscription and entitlement seeding was
-- added to create_workspace. Existing subscriptions and entitlement values are
-- never overwritten.
insert into public.subscriptions (workspace_id, plan, status, trial_ends_at)
select w.id, w.plan, 'trialing'::public.subscription_status, now() + interval '14 days'
from public.workspaces w
where not exists (
  select 1 from public.subscriptions s where s.workspace_id = w.id
);

insert into public.subscription_entitlements (workspace_id, feature_key, enabled, limit_value)
select w.id, defaults.feature_key, defaults.enabled, defaults.limit_value
from public.workspaces w
cross join (values
  ('crm.core', true, null::bigint),
  ('lead.capture', true, null::bigint),
  ('ai.basic', true, null::bigint),
  ('booking.core', true, null::bigint),
  ('automations.advanced', false, null::bigint),
  ('campaigns.revenue', false, null::bigint),
  ('operator.full', false, null::bigint),
  ('usage.users', true, 2::bigint),
  ('usage.sms', true, 250::bigint),
  ('usage.ai_actions', true, 250::bigint)
) as defaults(feature_key, enabled, limit_value)
where not exists (
  select 1
  from public.subscription_entitlements se
  where se.workspace_id = w.id and se.feature_key = defaults.feature_key
);
