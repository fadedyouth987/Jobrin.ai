-- Jobryn SaaS v1.0 - role and plan compatibility migration.
-- Keep this migration separate because PostgreSQL enum values should be committed
-- before they are referenced by later policies/functions.

alter type public.workspace_role add value if not exists 'manager';
alter type public.workspace_role add value if not exists 'staff';

-- Move the prototype plan names to the canonical SaaS names.
alter table public.workspaces drop constraint if exists workspaces_plan_check;
alter table public.subscriptions drop constraint if exists subscriptions_plan_check;

update public.workspaces set plan = 'growth' where plan = 'professional';
update public.workspaces set plan = 'operator' where plan = 'enterprise';
update public.subscriptions set plan = 'growth' where plan = 'professional';
update public.subscriptions set plan = 'operator' where plan = 'enterprise';

alter table public.workspaces
  add constraint workspaces_plan_check check (plan in ('starter','growth','operator'));
alter table public.subscriptions
  add constraint subscriptions_plan_check check (plan in ('starter','growth','operator'));

alter type public.subscription_status add value if not exists 'incomplete_expired';
