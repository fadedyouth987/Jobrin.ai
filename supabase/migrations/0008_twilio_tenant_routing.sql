-- A receiving number may belong to only one tenant. This prevents ambiguous
-- inbound SMS/call routing across workspaces while allowing disconnected history.
create unique index if not exists integrations_active_twilio_number_unique
  on public.integrations (provider, external_account_id)
  where provider = 'twilio'
    and status in ('connecting', 'connected', 'degraded')
    and external_account_id is not null;
