-- Job costing: technicians and managers log time and materials on jobs.
-- 0013 enabled RLS and created member SELECT policies for these tables; this
-- migration adds the matching INSERT and UPDATE policies so authenticated
-- workspace members can record time and materials through the API.
-- DELETE stays unavailable to browser clients (trusted server corrections only).

do $$ declare t text; begin foreach t in array array['job_time_entries','job_materials'] loop
execute format('drop policy if exists %I on public.%I', t||'_member_insert', t);
execute format('create policy %I on public.%I for insert to authenticated with check (private.is_workspace_member(workspace_id))', t||'_member_insert', t);
execute format('drop policy if exists %I on public.%I', t||'_member_update', t);
execute format('create policy %I on public.%I for update to authenticated using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id))', t||'_member_update', t);
end loop; end $$;