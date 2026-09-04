-- Jobryn least-privilege RBAC.
-- Supabase's authenticated REST API is a real security boundary, so RLS/grants must
-- independently match the API permission model rather than relying on Express alone.

-- -----------------------------------------------------------------------------
-- Protect subscription/ownership fields from direct browser mutation.
-- -----------------------------------------------------------------------------
revoke update on public.workspaces from authenticated;
grant update (name, slug, retention_days) on public.workspaces to authenticated;

-- Team membership changes must flow through audited server actions/invitation flows.
revoke insert, update, delete on public.workspace_members from authenticated;

-- Paid state is provider-owned. Owners/admins may read it but cannot self-enable features.
revoke insert, update, delete on public.subscription_entitlements from authenticated;
revoke insert, update, delete on public.usage_events from authenticated;

-- These records are produced by verified providers/workers, not by the browser.
revoke insert, update, delete on public.payments from authenticated;
revoke insert, update, delete on public.ai_actions from authenticated;
revoke insert, update, delete on public.automation_runs from authenticated;
revoke insert, update, delete on public.integrations from authenticated;
revoke insert, update, delete on public.domain_events from authenticated;
revoke insert, update, delete on public.outbox_events from authenticated;
revoke insert, update, delete on public.revenue_attributions from authenticated;

-- -----------------------------------------------------------------------------
-- Replace broad operator-write policies with domain-specific role policies.
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
    execute format('drop policy if exists %I on public.%I', t || '_operator_write', t);
  end loop;
end $$;

-- Business configuration: managers and above.
do $$
declare
  t text;
  tables text[] := array[
    'business_profiles','onboarding_progress','services','service_areas','business_hours',
    'knowledge_documents','knowledge_chunks','automations'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_manager_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']::public.workspace_role[]))',
      t || '_manager_write', t
    );
  end loop;
end $$;

-- Day-to-day customer/work operations: staff and above.
do $$
declare
  t text;
  tables text[] := array[
    'customers','customer_addresses','customer_consents','suppression_entries','leads',
    'conversations','messages','calls','appointments','jobs','quotes','quote_items','review_requests'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[]))',
      t || '_staff_write', t
    );
  end loop;
end $$;

-- Financial documents and approvals: manager and above.
do $$
declare
  t text;
  tables text[] := array['invoices','invoice_items','approvals'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_manager_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']::public.workspace_role[]))',
      t || '_manager_write', t
    );
  end loop;
end $$;

-- Notification privacy: a user sees their own notifications plus workspace-wide notices.
drop policy if exists notifications_member_select on public.notifications;
create policy notifications_recipient_select on public.notifications for select to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (user_id is null or user_id = (select auth.uid()))
  );

drop policy if exists notifications_self_update on public.notifications;
create policy notifications_self_update on public.notifications for update to authenticated
  using (private.is_workspace_member(workspace_id) and user_id = (select auth.uid()))
  with check (private.is_workspace_member(workspace_id) and user_id = (select auth.uid()));
revoke insert, delete on public.notifications from authenticated;

-- Internal tables are read-only (where needed) and have no authenticated write policy.
do $$
declare
  t text;
  tables text[] := array[
    'payments','ai_actions','automation_runs','integrations','domain_events','outbox_events',
    'revenue_attributions','subscription_entitlements','usage_events'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_manager_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
  end loop;
end $$;

-- Integrations contain identifiers/scopes; serve sanitized health through the backend only.
revoke select on public.integrations from authenticated;

-- Internal event payloads can contain operational data and should not be browsable directly.
revoke select on public.domain_events, public.outbox_events from authenticated;

-- Usage events are visible only to manager/owner roles, never writable from browser.
drop policy if exists usage_events_member_select on public.usage_events;
create policy usage_events_manager_select on public.usage_events for select to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]));

-- Entitlement state can be inspected by workspace members but only service_role can mutate it.
drop policy if exists subscription_entitlements_admin_write on public.subscription_entitlements;

-- Audit logs expose security/IP information only to management.
drop policy if exists audits_member_select on public.audit_logs;
create policy audits_manager_select on public.audit_logs for select to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]));

-- Legacy Campaign OS roles brought into the canonical Owner/Admin/Manager model.
drop policy if exists campaigns_creator_insert on public.campaigns;
drop policy if exists campaigns_creator_update on public.campaigns;
create policy campaigns_manager_insert on public.campaigns for insert to authenticated
  with check (
    private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[])
    and created_by = (select auth.uid())
  );
create policy campaigns_manager_update on public.campaigns for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]));

drop policy if exists assets_creator_insert on public.campaign_assets;
drop policy if exists assets_creator_update on public.campaign_assets;
create policy assets_manager_insert on public.campaign_assets for insert to authenticated
  with check (
    private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[])
    and created_by = (select auth.uid())
  );
create policy assets_manager_update on public.campaign_assets for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]));

drop policy if exists module_state_creator_insert on public.workspace_module_state;
drop policy if exists module_state_creator_update on public.workspace_module_state;
create policy module_state_manager_insert on public.workspace_module_state for insert to authenticated
  with check (
    private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[])
    and updated_by = (select auth.uid())
  );
create policy module_state_manager_update on public.workspace_module_state for update to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]))
  with check (
    private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[])
    and updated_by = (select auth.uid())
  );

-- Asset storage writes follow the same management boundary.
drop policy if exists asset_objects_creator_insert on storage.objects;
drop policy if exists asset_objects_creator_update on storage.objects;
create policy asset_objects_manager_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'vantory-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager']::public.workspace_role[])
);
create policy asset_objects_manager_update on storage.objects for update to authenticated
using (
  bucket_id = 'vantory-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager']::public.workspace_role[])
)
with check (
  bucket_id = 'vantory-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager']::public.workspace_role[])
);

-- Destructive operations are API-controlled/soft-delete workflows. Direct browser
-- table access does not receive DELETE on operational records.
do $$
declare
  t text;
  tables text[] := array[
    'business_profiles','onboarding_progress','services','service_areas','business_hours',
    'customers','customer_addresses','customer_consents','suppression_entries','leads',
    'conversations','messages','calls','appointments','jobs','quotes','quote_items',
    'invoices','invoice_items','knowledge_documents','knowledge_chunks','approvals',
    'automations','review_requests','notifications'
  ];
begin
  foreach t in array tables loop
    execute format('revoke delete on public.%I from authenticated', t);
  end loop;
end $$;

-- Consent history and delivered message/provider records are append-oriented.
revoke update on public.customer_consents from authenticated;
revoke update on public.messages from authenticated;
revoke insert, update on public.calls from authenticated;

-- Notification users may only mark their own notifications read/unread.
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Audit integrity: only trusted backend/service-role code may append audit records.
revoke insert on public.audit_logs from authenticated;
drop policy if exists audits_member_insert on public.audit_logs;
