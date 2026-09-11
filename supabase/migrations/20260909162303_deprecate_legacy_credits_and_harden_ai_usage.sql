-- Jobrin bills by subscription entitlements and atomic usage counters. The
-- original wallet tables are retained only for migration compatibility; they
-- are not a customer-facing balance and must not be readable from a browser.

drop policy if exists wallets_member_select on public.credit_wallets;
drop policy if exists transactions_member_select on public.credit_transactions;

revoke all on table public.credit_wallets from anon, authenticated;
revoke all on table public.credit_transactions from anon, authenticated;
revoke all on function public.reserve_credits(uuid,bigint,text,text,uuid) from public, anon, authenticated;

comment on table public.credit_wallets is
  'LEGACY: retained for migration compatibility only. Jobrin subscription enforcement uses subscription_entitlements, usage_counters and usage_events.';
comment on table public.credit_transactions is
  'LEGACY: retained for migration compatibility only. Not a billable credit or token ledger.';
comment on table public.usage_counters is
  'Authoritative current-period counters for plan limits such as usage.sms and usage.ai_actions.';
comment on table public.usage_events is
  'Idempotent usage ledger. One stable idempotency key may increment a workspace metric only once.';
