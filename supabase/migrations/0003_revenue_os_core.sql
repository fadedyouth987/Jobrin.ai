-- Jobryn Revenue Operating System v1.0
-- Canonical operational schema. Jobryn owns the record; providers synchronize into it.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- -----------------------------------------------------------------------------
-- Business configuration + onboarding
-- -----------------------------------------------------------------------------
create table if not exists public.business_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  trading_name text not null default '',
  legal_name text not null default '',
  abn text,
  industry text,
  phone text,
  email text,
  website text,
  timezone text not null default 'Australia/Adelaide',
  currency text not null default 'AUD',
  gst_registered boolean not null default false,
  description text not null default '',
  street_address text,
  suburb text,
  state text,
  postcode text,
  country text not null default 'AU',
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_progress (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  step_key text not null,
  status text not null default 'pending' check (status in ('pending','in_progress','complete','skipped')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, step_key)
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 160),
  description text not null default '',
  category text,
  active boolean not null default true,
  booking_type text not null default 'bookable' check (booking_type in ('bookable','quote','enquiry')),
  default_duration_minutes integer not null default 60 check (default_duration_minutes between 5 and 1440),
  pricing_mode text not null default 'quote' check (pricing_mode in ('fixed','starting_from','hourly','callout_hourly','range','quote')),
  base_price_cents bigint check (base_price_cents is null or base_price_cents >= 0),
  price_max_cents bigint check (price_max_cents is null or price_max_cents >= 0),
  requires_deposit boolean not null default false,
  deposit_cents bigint check (deposit_cents is null or deposit_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create index if not exists services_workspace_active_idx on public.services(workspace_id, active, name);

create table if not exists public.service_areas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('postcode','suburb','radius','exclude')),
  value text not null,
  surcharge_cents bigint not null default 0 check (surcharge_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists service_areas_workspace_idx on public.service_areas(workspace_id, active);

create table if not exists public.business_hours (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  schedule_type text not null default 'business' check (schedule_type in ('business','booking','phone','emergency')),
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, schedule_type, weekday)
);

-- -----------------------------------------------------------------------------
-- CRM
-- -----------------------------------------------------------------------------
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  phone text,
  normalized_phone text,
  email text,
  normalized_email text,
  source text,
  notes text not null default '',
  tags text[] not null default '{}',
  communication_preferences jsonb not null default '{}'::jsonb,
  lifetime_value_cents bigint not null default 0 check (lifetime_value_cents >= 0),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists customers_workspace_phone_unique on public.customers(workspace_id, normalized_phone)
  where normalized_phone is not null and deleted_at is null;
create unique index if not exists customers_workspace_email_unique on public.customers(workspace_id, normalized_email)
  where normalized_email is not null and deleted_at is null;
create index if not exists customers_workspace_name_idx on public.customers(workspace_id, display_name);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'Service address',
  line1 text not null,
  line2 text,
  suburb text,
  state text,
  postcode text,
  country text not null default 'AU',
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_addresses_customer_idx on public.customer_addresses(workspace_id, customer_id);

create table if not exists public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('email','sms','phone','push')),
  purpose text not null check (purpose in ('transactional','marketing','support','recording')),
  granted boolean not null,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists customer_consents_lookup_idx on public.customer_consents(workspace_id, customer_id, channel, purpose, recorded_at desc);

create table if not exists public.suppression_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  channel text not null check (channel in ('email','sms','phone')),
  value text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, channel, value)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  description text not null default '',
  stage text not null default 'new' check (stage in ('new','contacted','qualified','quote','booked','won','completed','lost','cancelled','spam')),
  source text,
  source_detail jsonb not null default '{}'::jsonb,
  estimated_value_cents bigint check (estimated_value_cents is null or estimated_value_cents >= 0),
  owner_user_id uuid references auth.users(id) on delete set null,
  next_action_at timestamptz,
  lost_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists leads_workspace_stage_idx on public.leads(workspace_id, stage, created_at desc);
create index if not exists leads_customer_idx on public.leads(workspace_id, customer_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Unified communications
-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  subject text,
  status text not null default 'open' check (status in ('open','waiting','closed','spam')),
  handling_mode text not null default 'ai_active' check (handling_mode in ('ai_active','human_requested','human_active','ai_paused')),
  locked_by uuid references auth.users(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_workspace_last_idx on public.conversations(workspace_id, last_message_at desc nulls last);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel text not null check (channel in ('webchat','sms','email','phone','whatsapp','facebook','instagram')),
  direction text not null check (direction in ('inbound','outbound')),
  purpose text not null default 'support' check (purpose in ('transactional','marketing','support')),
  sender_type text not null check (sender_type in ('customer','user','ai','system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  provider text,
  provider_message_id text,
  body text not null default '',
  status text not null default 'received' check (status in ('queued','sending','sent','delivered','read','received','failed','suppressed')),
  error_code text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_message_id)
);
create index if not exists messages_conversation_idx on public.messages(workspace_id, conversation_id, created_at);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  provider text,
  provider_call_id text,
  direction text not null check (direction in ('inbound','outbound')),
  from_number text,
  to_number text,
  status text not null default 'ringing',
  answered_by text,
  missed boolean not null default false,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  transcript text,
  summary text,
  recording_status text not null default 'off' check (recording_status in ('off','pending_consent','recording','complete','failed')),
  recording_url text,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_call_id)
);
create index if not exists calls_workspace_started_idx on public.calls(workspace_id, started_at desc);

-- -----------------------------------------------------------------------------
-- Scheduling + work
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  assigned_user_id uuid references auth.users(id) on delete set null,
  title text not null,
  address_text text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Australia/Adelaide',
  status text not null default 'scheduled' check (status in ('hold','scheduled','confirmed','completed','cancelled','no_show')),
  source text,
  external_calendar_event_id text,
  external_calendar_provider text,
  sync_status text not null default 'pending' check (sync_status in ('pending','synced','failed','needs_reconnect')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists appointments_workspace_time_idx on public.appointments(workspace_id, starts_at, ends_at);
create index if not exists appointments_staff_time_idx on public.appointments(workspace_id, assigned_user_id, starts_at, ends_at)
  where status in ('hold','scheduled','confirmed');

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  job_number bigint generated by default as identity,
  title text not null,
  description text not null default '',
  address_text text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new','scheduled','on_the_way','in_progress','completed','invoiced','paid','cancelled')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  completed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_workspace_status_idx on public.jobs(workspace_id, status, scheduled_start);

-- -----------------------------------------------------------------------------
-- Quotes, invoices, payments
-- -----------------------------------------------------------------------------
create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  quote_number bigint generated by default as identity,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','sent','viewed','accepted','declined','expired','void')),
  current_version integer not null default 1,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  gst_cents bigint not null default 0 check (gst_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  deposit_cents bigint not null default 0 check (deposit_cents >= 0),
  expires_at timestamptz,
  terms text not null default '',
  notes text not null default '',
  public_token_hash text,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quotes_workspace_status_idx on public.quotes(workspace_id, status, created_at desc);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version integer not null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  gst_rate numeric(5,4) not null default 0.10,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists quote_items_quote_idx on public.quote_items(workspace_id, quote_id, version, sort_order);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  quote_id uuid references public.quotes(id) on delete set null,
  invoice_number bigint generated by default as identity,
  status text not null default 'draft' check (status in ('draft','sent','viewed','part_paid','paid','overdue','void','refunded')),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  gst_cents bigint not null default 0 check (gst_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  balance_due_cents bigint not null default 0 check (balance_due_cents >= 0),
  due_at timestamptz,
  public_token_hash text,
  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_workspace_status_idx on public.invoices(workspace_id, status, due_at);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  gst_rate numeric(5,4) not null default 0.10,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  provider text not null default 'stripe',
  provider_payment_id text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'AUD',
  status text not null default 'pending' check (status in ('pending','succeeded','failed','refunding','refunded')),
  failure_code text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_payment_id)
);
create index if not exists payments_workspace_status_idx on public.payments(workspace_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- AI, knowledge, automations, reputation
-- -----------------------------------------------------------------------------
create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  source_type text not null check (source_type in ('manual','faq','policy','website','file','service','pricing')),
  source_url text,
  content text not null default '',
  approved boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(768),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index if not exists knowledge_chunks_workspace_idx on public.knowledge_chunks(workspace_id, document_id);

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  requested_by text not null default 'operator',
  tool_name text not null,
  risk_level text not null check (risk_level in ('low','medium','high')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  approval_required boolean not null default false,
  status text not null default 'requested' check (status in ('requested','awaiting_approval','running','completed','failed','denied','escalated')),
  error_code text,
  cost_microunits bigint not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists ai_actions_workspace_idx on public.ai_actions(workspace_id, created_at desc);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ai_action_id uuid references public.ai_actions(id) on delete cascade,
  resource_type text not null,
  resource_id uuid,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  requested_by uuid references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists approvals_workspace_status_idx on public.approvals(workspace_id, status, created_at desc);

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  trigger_key text not null,
  definition jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  automation_id uuid not null references public.automations(id) on delete cascade,
  trigger_event_id uuid,
  status text not null default 'queued' check (status in ('queued','running','waiting','completed','failed','cancelled')),
  state jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists public.review_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  channel text not null check (channel in ('sms','email')),
  status text not null default 'queued' check (status in ('queued','sent','clicked','completed','suppressed','failed')),
  rating smallint check (rating between 1 and 5),
  feedback text,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Integrations, notifications, events, attribution
-- -----------------------------------------------------------------------------
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  status text not null default 'disconnected' check (status in ('disconnected','connecting','connected','degraded','failed','needs_reauth')),
  external_account_id text,
  scopes text[] not null default '{}',
  encrypted_credentials bytea,
  last_success_at timestamptz,
  last_error_at timestamptz,
  error_code text,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_account_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(workspace_id, user_id, read_at, created_at desc);

create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_key text not null,
  aggregate_type text not null,
  aggregate_id uuid,
  payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now()
);
create index if not exists domain_events_workspace_key_idx on public.domain_events(workspace_id, event_key, occurred_at desc);

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending','processing','delivered','failed','dead_letter')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index if not exists outbox_pending_idx on public.outbox_events(status, next_attempt_at) where status in ('pending','failed');

create table if not exists public.revenue_attributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  source text not null,
  medium text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  touch_type text not null default 'last_touch' check (touch_type in ('first_touch','last_touch','assisted','vantory_generated')),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists attribution_workspace_source_idx on public.revenue_attributions(workspace_id, source, created_at desc);

-- -----------------------------------------------------------------------------
-- Stripe webhook state machine + SaaS entitlements
-- -----------------------------------------------------------------------------
alter table public.stripe_webhook_events add column if not exists status text not null default 'received';
alter table public.stripe_webhook_events add column if not exists attempt_count integer not null default 0;
alter table public.stripe_webhook_events add column if not exists processing_started_at timestamptz;

create table if not exists public.subscription_entitlements (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default false,
  limit_value bigint,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature_key)
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  metric_key text not null,
  quantity bigint not null check (quantity > 0),
  idempotency_key text not null,
  source_resource_type text,
  source_resource_id uuid,
  recorded_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index if not exists usage_workspace_metric_idx on public.usage_events(workspace_id, metric_key, recorded_at desc);

-- Atomic claim for Stripe events. Only service_role may execute this function.
create or replace function public.claim_stripe_webhook_event(
  target_event_id text,
  target_event_type text,
  target_payload jsonb
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_status text;
  existing_processed_at timestamptz;
  existing_started_at timestamptz;
begin
  -- First writer wins. ON CONFLICT blocks on an uncommitted competing insert,
  -- then safely falls through to inspect the committed row.
  insert into public.stripe_webhook_events(
    stripe_event_id, event_type, payload, status, attempt_count, processing_started_at
  ) values (
    target_event_id, target_event_type, target_payload, 'processing', 1, now()
  ) on conflict (stripe_event_id) do nothing;

  if found then
    return 'claimed';
  end if;

  select status, processed_at, processing_started_at
    into existing_status, existing_processed_at, existing_started_at
  from public.stripe_webhook_events
  where stripe_event_id = target_event_id
  for update;

  if existing_processed_at is not null or existing_status = 'processed' then
    return 'duplicate';
  end if;

  -- Do not let two live deliveries process the same event concurrently. A stale
  -- processing lease can be reclaimed if a worker died before recording failure.
  if existing_status = 'processing'
     and existing_started_at is not null
     and existing_started_at > now() - interval '5 minutes' then
    return 'in_progress';
  end if;

  update public.stripe_webhook_events
    set status = 'processing',
        attempt_count = attempt_count + 1,
        processing_started_at = now(),
        processing_error = null,
        payload = target_payload,
        event_type = target_event_type
    where stripe_event_id = target_event_id;
  return 'claimed';
end;
$$;
revoke all on function public.claim_stripe_webhook_event(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text,text,jsonb) to service_role;

-- Workspace creation is a single transaction and cannot assign ownership to another user.
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

  insert into public.subscriptions(workspace_id, plan, status)
  values (new_workspace, 'starter', 'incomplete');

  insert into public.business_profiles(workspace_id, trading_name)
  values (new_workspace, trim(workspace_name));

  insert into public.onboarding_progress(workspace_id, step_key, status)
  values (new_workspace, 'business', 'in_progress');

  return new_workspace;
end;
$$;
revoke all on function public.create_workspace(text,text) from public, anon;
grant execute on function public.create_workspace(text,text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS: every tenant-owned table is isolated at the database boundary.
-- API routes add role/object authorization on top of this.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tenant_tables text[] := array[
    'business_profiles','onboarding_progress','services','service_areas','business_hours',
    'customers','customer_addresses','customer_consents','suppression_entries','leads',
    'conversations','messages','calls','appointments','jobs','quotes','quote_items',
    'invoices','invoice_items','payments','knowledge_documents','knowledge_chunks',
    'ai_actions','approvals','automations','automation_runs','review_requests',
    'integrations','notifications','domain_events','outbox_events','revenue_attributions',
    'subscription_entitlements','usage_events'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_operator_write', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_workspace_member(workspace_id))',
      t || '_member_select', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[]))',
      t || '_operator_write', t
    );
  end loop;
end $$;

-- Tighten billing/admin-only tables.
drop policy if exists subscription_entitlements_operator_write on public.subscription_entitlements;
create policy subscription_entitlements_admin_write on public.subscription_entitlements for all to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin']::public.workspace_role[]));

drop policy if exists usage_events_operator_write on public.usage_events;
create policy usage_events_member_insert on public.usage_events for insert to authenticated
  with check (private.is_workspace_member(workspace_id));

-- Explicit grants: authenticated clients still pass RLS; anon receives no tenant data access.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'business_profiles','onboarding_progress','services','service_areas','business_hours',
    'customers','customer_addresses','customer_consents','suppression_entries','leads',
    'conversations','messages','calls','appointments','jobs','quotes','quote_items',
    'invoices','invoice_items','payments','knowledge_documents','knowledge_chunks',
    'ai_actions','approvals','automations','automation_runs','review_requests',
    'integrations','notifications','domain_events','outbox_events','revenue_attributions',
    'subscription_entitlements','usage_events'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Strengthen prototype workspace/member operations for the new role model.
drop policy if exists workspaces_admin_update on public.workspaces;
create policy workspaces_admin_update on public.workspaces for update to authenticated
  using (private.has_workspace_role(id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_workspace_role(id, array['owner','admin']::public.workspace_role[]));

-- Audit entries are insert-only for authenticated workspace members; users may read their workspace log.
grant insert on public.audit_logs to authenticated;
create policy audits_member_insert on public.audit_logs for insert to authenticated
  with check (private.is_workspace_member(workspace_id) and actor_user_id = (select auth.uid()));

-- Atomic subscription + entitlement application for verified Stripe events.
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
  if target_plan not in ('starter','growth','operator') then
    raise exception 'Invalid plan';
  end if;

  update public.workspaces
    set plan = target_plan, updated_at = now()
    where id = target_workspace;
  if not found then raise exception 'Workspace not found'; end if;

  insert into public.subscriptions(
    workspace_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
    plan, status, current_period_end, cancel_at_period_end, updated_at
  ) values (
    target_workspace, target_customer_id, target_subscription_id, target_price_id,
    target_plan, target_status, target_period_end, target_cancel_at_period_end, now()
  ) on conflict (workspace_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_price_id = excluded.stripe_price_id,
    plan = excluded.plan,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    updated_at = now();

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

-- Internal provider/event tables must never be directly writable through the browser API.
revoke all on public.stripe_webhook_events from anon, authenticated;
alter table public.stripe_webhook_events enable row level security;

revoke all on public.outbox_events from anon, authenticated;
revoke all on public.domain_events from anon, authenticated;
revoke all on public.ai_actions from anon, authenticated;
revoke all on public.integrations from anon, authenticated;
revoke all on public.payments from anon, authenticated;
revoke all on public.revenue_attributions from anon, authenticated;

-- Read-only access is restored only where the user interface legitimately needs it.
grant select on public.ai_actions to authenticated;
grant select on public.payments to authenticated;
grant select on public.revenue_attributions to authenticated;
