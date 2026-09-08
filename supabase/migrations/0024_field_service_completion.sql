-- Field-service completion: closes the two remaining 0013 policy gaps and the
-- tenant-reference trigger gap for every user-writable table created after
-- 0004's trigger matrix. Without member INSERT/UPDATE policies, any future
-- write to these tables fails with 42501; without reference triggers, a known
-- UUID can attach a row to another workspace's job/customer/template.

-- 0013 granted insert,update to authenticated on service_agreements and
-- technician_profiles with SELECT-only policies; 0021 fixed job_time_entries
-- and job_materials, 0023 fixed customer_assets. These are the last two.
do $$ declare t text; begin foreach t in array array['service_agreements','technician_profiles'] loop
execute format('drop policy if exists %I on public.%I', t||'_member_insert', t);
execute format('create policy %I on public.%I for insert to authenticated with check (private.is_workspace_member(workspace_id))', t||'_member_insert', t);
execute format('drop policy if exists %I on public.%I', t||'_member_update', t);
execute format('create policy %I on public.%I for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id))', t||'_member_update', t);
end loop; end $$;

-- Tenant reference guards for tables created after 0004 (same pattern, same
-- helper). customer_assets PATCH proved the row-level workspace policy alone
-- does not validate the *referenced* row's tenant.
do $$
declare
  spec text;
  parts text[];
  trigger_name text;
  specs text[] := array[
    'customer_assets:customer_id:customers','customer_assets:address_id:customer_addresses',
    'service_agreements:customer_id:customers','service_agreements:service_id:services',
    'job_time_entries:job_id:jobs',
    'job_materials:job_id:jobs',
    'checklist_templates:service_id:services',
    'job_checklists:job_id:jobs','job_checklists:template_id:checklist_templates',
    'job_signatures:job_id:jobs','job_signatures:quote_id:quotes'
  ];
begin
  foreach spec in array specs loop
    parts := string_to_array(spec, ':');
    trigger_name := 'tenant_ref_' || parts[1] || '_' || parts[2];
    execute format('drop trigger if exists %I on public.%I', trigger_name, parts[1]);
    execute format(
      'create trigger %I before insert or update of %I, workspace_id on public.%I for each row execute function private.assert_same_workspace_reference(%L,%L)',
      trigger_name, parts[2], parts[1], parts[2], parts[3]
    );
  end loop;
end $$;

-- Workspace-member assignment guards for the same tables.
do $$
declare
  spec text;
  parts text[];
  trigger_name text;
  specs text[] := array[
    'technician_profiles:user_id',
    'job_time_entries:user_id',
    'checklist_templates:created_by',
    'job_checklists:completed_by'
  ];
begin
  foreach spec in array specs loop
    parts := string_to_array(spec, ':');
    trigger_name := 'member_ref_' || parts[1] || '_' || parts[2];
    execute format('drop trigger if exists %I on public.%I', trigger_name, parts[1]);
    execute format(
      'create trigger %I before insert or update of %I, workspace_id on public.%I for each row execute function private.assert_workspace_member_reference(%L)',
      trigger_name, parts[2], parts[1], parts[2]
    );
  end loop;
end $$;