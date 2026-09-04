-- Advisor-driven indexes and explicit server-only RLS posture for Jobryn's new structures.

create index if not exists automation_attempts_workspace_idx on public.automation_attempts(workspace_id);
create index if not exists customer_assets_customer_fk_idx on public.customer_assets(customer_id);
create index if not exists customer_assets_address_fk_idx on public.customer_assets(address_id) where address_id is not null;
create index if not exists service_agreements_customer_fk_idx on public.service_agreements(customer_id);
create index if not exists service_agreements_service_fk_idx on public.service_agreements(service_id) where service_id is not null;
create index if not exists technician_profiles_user_fk_idx on public.technician_profiles(user_id);
create index if not exists job_time_entries_job_fk_idx on public.job_time_entries(job_id);
create index if not exists job_time_entries_user_fk_idx on public.job_time_entries(user_id);
create index if not exists job_materials_job_fk_idx on public.job_materials(job_id);
create index if not exists customer_portal_sessions_customer_fk_idx on public.customer_portal_sessions(customer_id);
create index if not exists ai_evaluations_workspace_fk_idx on public.ai_evaluations(workspace_id) where workspace_id is not null;

create index if not exists ai_feedback_actor_fk_idx on public.ai_feedback_events(actor_user_id) where actor_user_id is not null;
create index if not exists ai_feedback_customer_fk_idx on public.ai_feedback_events(customer_id) where customer_id is not null;
create index if not exists ai_feedback_job_fk_idx on public.ai_feedback_events(job_id) where job_id is not null;
create index if not exists ai_feedback_quote_fk_idx on public.ai_feedback_events(quote_id) where quote_id is not null;
create index if not exists ai_feedback_message_fk_idx on public.ai_feedback_events(message_id) where message_id is not null;
create index if not exists business_memories_confirmed_by_fk_idx on public.business_memories(confirmed_by) where confirmed_by is not null;
create index if not exists memory_evidence_feedback_fk_idx on public.memory_evidence(feedback_event_id) where feedback_event_id is not null;
create index if not exists memory_usage_ai_action_fk_idx on public.memory_usage_events(ai_action_id) where ai_action_id is not null;
create index if not exists memory_settings_updated_by_fk_idx on public.memory_learning_settings(updated_by) where updated_by is not null;
create index if not exists memory_decisions_actor_fk_idx on public.memory_promotion_decisions(actor_user_id) where actor_user_id is not null;

create policy ai_evaluations_server_only on public.ai_evaluations for all to authenticated using (false) with check (false);
create policy customer_portal_sessions_server_only on public.customer_portal_sessions for all to authenticated using (false) with check (false);
