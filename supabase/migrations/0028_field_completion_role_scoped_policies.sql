-- Fixes an RLS gap found in a full engineering audit: checklist_templates,
-- job_checklists and job_signatures each had a single "_member_all" policy
-- (private.is_workspace_member only) covering SELECT/INSERT/UPDATE/DELETE.
-- Every other work-record table (customers, jobs, invoices, ...) splits this
-- into a member-scoped SELECT policy plus a role-scoped write policy
-- (0005_least_privilege_rbac.sql's "_staff_write" pattern) so a workspace
-- member with a read-only role (e.g. 'viewer') cannot write via a direct
-- PostgREST/Supabase-client call even though the Express API would have
-- rejected that role. These three tables never received the split.

do $$ declare t text; begin foreach t in array array['checklist_templates','job_checklists','job_signatures'] loop
execute format('drop policy if exists %I on public.%I', t||'_member_all', t);
execute format('drop policy if exists %I on public.%I', t||'_member_select', t);
execute format('create policy %I on public.%I for select to authenticated using (private.is_workspace_member(workspace_id))', t||'_member_select', t);
execute format('drop policy if exists %I on public.%I', t||'_staff_write', t);
execute format('create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[]))', t||'_staff_write', t);
end loop; end $$;
