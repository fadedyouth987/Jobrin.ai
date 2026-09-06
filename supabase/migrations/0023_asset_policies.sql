-- Assets: INSERT and UPDATE policies for customer_assets (SELECT existed from 0013)
do $$ declare t text; begin foreach t in array array['customer_assets'] loop
execute format('drop policy if exists %I on public.%I', t||'_member_insert', t);
execute format('create policy %I on public.%I for insert to authenticated with check (private.is_workspace_member(workspace_id))', t||'_member_insert', t);
execute format('drop policy if exists %I on public.%I', t||'_member_update', t);
execute format('create policy %I on public.%I for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id))', t||'_member_update', t);
end loop; end $$;