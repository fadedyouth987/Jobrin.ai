-- Customer communications: private internal notes and consent-first SMS campaigns.
-- Writes are performed by the authenticated Jobryn API; browser clients are read-only.

create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists conversation_notes_workspace_conversation_idx
  on public.conversation_notes(workspace_id, conversation_id, created_at);

create table if not exists public.sms_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  sender_name text not null check (char_length(trim(sender_name)) between 2 and 80),
  contact_details text not null check (char_length(trim(contact_details)) between 3 and 200),
  message_body text not null check (char_length(trim(message_body)) between 1 and 1200),
  status text not null default 'draft' check (status in ('draft','ready','approved','sending','completed','needs_review','cancelled','failed')),
  prepared_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sms_campaigns_workspace_created_idx
  on public.sms_campaigns(workspace_id, created_at desc);

create table if not exists public.sms_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.sms_campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  destination text not null,
  -- `unknown` means the provider request may have reached Twilio but Jobryn did
  -- not receive a conclusive result. It must never be automatically retried.
  status text not null check (status in ('eligible','consent_missing','suppressed','sending','sent','delivered','failed','skipped','unknown')),
  provider_message_id text,
  message_id uuid references public.messages(id) on delete set null,
  error_code text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, customer_id),
  unique (workspace_id, provider_message_id)
);
create index if not exists sms_campaign_recipients_campaign_status_idx
  on public.sms_campaign_recipients(campaign_id, status, created_at);

-- Persist the intent before calling an external SMS provider. This is an
-- outbox ledger, not a best-effort log: a recipient has one attempt, and an
-- inconclusive provider result is held for explicit human reconciliation
-- instead of risking a duplicate marketing message.
create table if not exists public.sms_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid references public.sms_campaigns(id) on delete cascade,
  campaign_recipient_id uuid unique references public.sms_campaign_recipients(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  destination text not null,
  purpose text not null check (purpose in ('marketing','support','transactional')),
  idempotency_key text not null unique,
  state text not null check (state in ('provider_pending','accepted','delivered','failed','unknown')),
  provider_message_id text unique,
  error_code text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists sms_delivery_attempts_workspace_state_idx
  on public.sms_delivery_attempts(workspace_id, state, created_at);

alter table public.conversation_notes enable row level security;
alter table public.sms_campaigns enable row level security;
alter table public.sms_campaign_recipients enable row level security;
alter table public.sms_delivery_attempts enable row level security;

revoke all on public.conversation_notes, public.sms_campaigns, public.sms_campaign_recipients, public.sms_delivery_attempts from anon;
revoke insert, update, delete on public.conversation_notes, public.sms_campaigns, public.sms_campaign_recipients, public.sms_delivery_attempts from authenticated;
grant select on public.conversation_notes, public.sms_campaigns, public.sms_campaign_recipients, public.sms_delivery_attempts to authenticated;

create policy conversation_notes_member_select on public.conversation_notes
  for select to authenticated using (private.is_workspace_member(workspace_id));
create policy sms_campaigns_member_select on public.sms_campaigns
  for select to authenticated using (private.is_workspace_member(workspace_id));
create policy sms_campaign_recipients_member_select on public.sms_campaign_recipients
  for select to authenticated using (private.is_workspace_member(workspace_id));
create policy sms_delivery_attempts_member_select on public.sms_delivery_attempts
  for select to authenticated using (private.is_workspace_member(workspace_id));
