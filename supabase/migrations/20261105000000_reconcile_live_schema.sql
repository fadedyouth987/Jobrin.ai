-- Reconcile the repository with the live Jobryn.AI project
-- (pmqtkcenovlwshurglkp), compared object by object on 2026-11-06 (see
-- RECEPTIONIST_REDESIGN_PLAN.md, section 6f).
--
-- The live project was built partly from hand-applied SQL, so it and these
-- migrations had drifted in both directions. Every statement below is
-- idempotent and additive: on the live project it fills the gaps the repo
-- expects; on a fresh database it reproduces what live already has.
-- No data is changed.

-- ---------------------------------------------------------------------------
-- 1. Live has these foreign-key indexes (recorded live as migration
--    "index_uncovered_foreign_keys") but they were never committed here.
-- ---------------------------------------------------------------------------
create index if not exists idx_ai_actions_conversation_id on public.ai_actions using btree (conversation_id);
create index if not exists idx_ai_actions_customer_id on public.ai_actions using btree (customer_id);
create index if not exists idx_appointments_assigned_user_id on public.appointments using btree (assigned_user_id);
create index if not exists idx_appointments_customer_id on public.appointments using btree (customer_id);
create index if not exists idx_appointments_lead_id on public.appointments using btree (lead_id);
create index if not exists idx_appointments_service_id on public.appointments using btree (service_id);
create index if not exists idx_approvals_ai_action_id on public.approvals using btree (ai_action_id);
create index if not exists idx_approvals_decided_by on public.approvals using btree (decided_by);
create index if not exists idx_approvals_requested_by on public.approvals using btree (requested_by);
create index if not exists idx_audit_logs_actor_user_id on public.audit_logs using btree (actor_user_id);
create index if not exists idx_automation_runs_automation_id on public.automation_runs using btree (automation_id);
create index if not exists idx_automation_runs_workspace_id on public.automation_runs using btree (workspace_id);
create index if not exists idx_automations_created_by on public.automations using btree (created_by);
create index if not exists idx_automations_workspace_id on public.automations using btree (workspace_id);
create index if not exists idx_calls_conversation_id on public.calls using btree (conversation_id);
create index if not exists idx_calls_customer_id on public.calls using btree (customer_id);
create index if not exists idx_campaign_assets_created_by on public.campaign_assets using btree (created_by);
create index if not exists idx_campaigns_created_by on public.campaigns using btree (created_by);
create index if not exists idx_conversations_assigned_user_id on public.conversations using btree (assigned_user_id);
create index if not exists idx_conversations_customer_id on public.conversations using btree (customer_id);
create index if not exists idx_conversations_lead_id on public.conversations using btree (lead_id);
create index if not exists idx_conversations_locked_by on public.conversations using btree (locked_by);
create index if not exists idx_credit_transactions_asset_id on public.credit_transactions using btree (asset_id);
create index if not exists idx_credit_transactions_created_by on public.credit_transactions using btree (created_by);
create index if not exists idx_customer_addresses_customer_id on public.customer_addresses using btree (customer_id);
create index if not exists idx_customer_consents_customer_id on public.customer_consents using btree (customer_id);
create index if not exists idx_domain_events_actor_user_id on public.domain_events using btree (actor_user_id);
create index if not exists idx_integrations_connected_by on public.integrations using btree (connected_by);
create index if not exists idx_invoice_items_invoice_id on public.invoice_items using btree (invoice_id);
create index if not exists idx_invoice_items_workspace_id on public.invoice_items using btree (workspace_id);
create index if not exists idx_invoices_customer_id on public.invoices using btree (customer_id);
create index if not exists idx_invoices_job_id on public.invoices using btree (job_id);
create index if not exists idx_invoices_quote_id on public.invoices using btree (quote_id);
create index if not exists idx_jobs_appointment_id on public.jobs using btree (appointment_id);
create index if not exists idx_jobs_assigned_user_id on public.jobs using btree (assigned_user_id);
create index if not exists idx_jobs_customer_id on public.jobs using btree (customer_id);
create index if not exists idx_jobs_lead_id on public.jobs using btree (lead_id);
create index if not exists idx_jobs_service_id on public.jobs using btree (service_id);
create index if not exists idx_knowledge_documents_created_by on public.knowledge_documents using btree (created_by);
create index if not exists idx_knowledge_documents_workspace_id on public.knowledge_documents using btree (workspace_id);
create index if not exists idx_leads_created_by on public.leads using btree (created_by);
create index if not exists idx_leads_customer_id on public.leads using btree (customer_id);
create index if not exists idx_leads_owner_user_id on public.leads using btree (owner_user_id);
create index if not exists idx_leads_service_id on public.leads using btree (service_id);
create index if not exists idx_messages_conversation_id on public.messages using btree (conversation_id);
create index if not exists idx_messages_customer_id on public.messages using btree (customer_id);
create index if not exists idx_messages_sender_user_id on public.messages using btree (sender_user_id);
create index if not exists idx_notifications_user_id on public.notifications using btree (user_id);
create index if not exists idx_payments_customer_id on public.payments using btree (customer_id);
create index if not exists idx_payments_invoice_id on public.payments using btree (invoice_id);
create index if not exists idx_quote_items_quote_id on public.quote_items using btree (quote_id);
create index if not exists idx_quotes_customer_id on public.quotes using btree (customer_id);
create index if not exists idx_quotes_job_id on public.quotes using btree (job_id);
create index if not exists idx_quotes_lead_id on public.quotes using btree (lead_id);
create index if not exists idx_revenue_attributions_campaign_id on public.revenue_attributions using btree (campaign_id);
create index if not exists idx_revenue_attributions_conversation_id on public.revenue_attributions using btree (conversation_id);
create index if not exists idx_revenue_attributions_customer_id on public.revenue_attributions using btree (customer_id);
create index if not exists idx_revenue_attributions_job_id on public.revenue_attributions using btree (job_id);
create index if not exists idx_revenue_attributions_lead_id on public.revenue_attributions using btree (lead_id);
create index if not exists idx_revenue_attributions_payment_id on public.revenue_attributions using btree (payment_id);
create index if not exists idx_review_requests_customer_id on public.review_requests using btree (customer_id);
create index if not exists idx_review_requests_job_id on public.review_requests using btree (job_id);
create index if not exists idx_review_requests_workspace_id on public.review_requests using btree (workspace_id);
create index if not exists idx_suppression_entries_customer_id on public.suppression_entries using btree (customer_id);
create index if not exists idx_workspace_module_state_updated_by on public.workspace_module_state using btree (updated_by);
create index if not exists idx_workspaces_owner_user_id on public.workspaces using btree (owner_user_id);

-- ---------------------------------------------------------------------------
-- 2. Hardening live already has (recorded live as
--    "jobryn_function_execute_hardening"): the signup trigger function is not
--    callable from the browser. Triggers still fire; EXECUTE is not checked
--    when a trigger runs.
-- ---------------------------------------------------------------------------
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Security gap on live: an ad-hoc change ("grant_authenticated_select_
--    integrations", 2026-08-28) re-granted table-wide SELECT on integrations,
--    including encrypted_credentials, to every workspace member. 0005 made it
--    server-only on purpose and the app reads it through the service role
--    (server/routes/integrations.ts). No-op where the grant is absent.
-- ---------------------------------------------------------------------------
revoke select on public.integrations from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Checks from 0027 that live is missing (live ran an earlier draft of it).
--    NOT VALID: enforced for every new write without failing on existing rows.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.calls'::regclass and conname = 'calls_outcome_check') then
    alter table public.calls add constraint calls_outcome_check
      check (outcome is null or outcome in ('completed','message_taken','transferred','call_limit_reached','abandoned','failed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.receptionist_profiles'::regclass and conname = 'receptionist_profiles_approved_pricing_language_length') then
    alter table public.receptionist_profiles add constraint receptionist_profiles_approved_pricing_language_length
      check (approved_pricing_language is null or char_length(approved_pricing_language) between 10 and 500) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.receptionist_profiles'::regclass and conname = 'receptionist_profiles_callback_window_length') then
    alter table public.receptionist_profiles add constraint receptionist_profiles_callback_window_length
      check (callback_window is null or char_length(callback_window) between 5 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.receptionist_profiles'::regclass and conname = 'receptionist_profiles_after_hours_rule_length') then
    alter table public.receptionist_profiles add constraint receptionist_profiles_after_hours_rule_length
      check (after_hours_rule is null or char_length(after_hours_rule) between 5 and 500) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. From 20260913000000_receptionist_call_hardening, never applied live:
--    one simulator/legacy message-take lead per idempotency key.
-- ---------------------------------------------------------------------------
create unique index if not exists leads_receptionist_idempotency_unique
  on public.leads (workspace_id, (source_detail ->> 'receptionist_idempotency_key'))
  where source = 'receptionist'
    and source_detail ? 'receptionist_idempotency_key';

-- Not handled here (needs files copied, see the plan): live still uses the
-- 'vantory-assets' storage bucket while the code and 0026 use 'jobrin-assets'.
