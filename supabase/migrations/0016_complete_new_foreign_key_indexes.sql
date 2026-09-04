-- Complete covering indexes reported by the Supabase performance advisor.
create index if not exists customer_portal_sessions_workspace_fk_idx on public.customer_portal_sessions(workspace_id);
create index if not exists job_materials_workspace_fk_idx on public.job_materials(workspace_id);
create index if not exists job_time_entries_workspace_fk_idx on public.job_time_entries(workspace_id);
create index if not exists service_agreements_workspace_fk_idx on public.service_agreements(workspace_id);
create index if not exists memory_decisions_workspace_fk_idx on public.memory_promotion_decisions(workspace_id);
create index if not exists memory_decisions_memory_fk_idx on public.memory_promotion_decisions(memory_id);
create index if not exists memory_usage_memory_fk_idx on public.memory_usage_events(memory_id);
