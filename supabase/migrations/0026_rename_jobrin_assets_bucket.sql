-- Rename the historical asset bucket to the Jobrin.ai name and keep storage
-- policies aligned for existing Supabase projects.

do $$
begin
  if exists (select 1 from storage.buckets where id = 'vantory-assets')
     and not exists (select 1 from storage.buckets where id = 'jobrin-assets') then
    update storage.buckets
    set id = 'jobrin-assets',
        name = 'jobrin-assets'
    where id = 'vantory-assets';
  end if;
end $$;

update storage.objects
set bucket_id = 'jobrin-assets'
where bucket_id = 'vantory-assets'
  and exists (select 1 from storage.buckets where id = 'jobrin-assets');

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'jobrin-assets',
  'jobrin-assets',
  false,
  26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'text/csv',
    'audio/mpeg', 'audio/wav', 'video/mp4'
  ]
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists asset_objects_member_select on storage.objects;
drop policy if exists asset_objects_creator_insert on storage.objects;
drop policy if exists asset_objects_creator_update on storage.objects;
drop policy if exists asset_objects_manager_insert on storage.objects;
drop policy if exists asset_objects_manager_update on storage.objects;

create policy asset_objects_member_select on storage.objects for select to authenticated
using (
  bucket_id = 'jobrin-assets'
  and private.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy asset_objects_manager_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'jobrin-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager','staff']::public.workspace_role[])
);

create policy asset_objects_manager_update on storage.objects for update to authenticated
using (
  bucket_id = 'jobrin-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager']::public.workspace_role[])
)
with check (
  bucket_id = 'jobrin-assets'
  and private.has_workspace_role(((storage.foldername(name))[1])::uuid, array['owner','admin','manager']::public.workspace_role[])
);

alter table public.revenue_attributions drop constraint if exists revenue_attributions_touch_type_check;
update public.revenue_attributions set touch_type = 'jobrin_generated' where touch_type = 'vantory_generated';
alter table public.revenue_attributions
  add constraint revenue_attributions_touch_type_check
  check (touch_type in ('first_touch','last_touch','assisted','jobrin_generated'));

alter table public.receptionist_configs
  alter column display_name set default 'Jobrin.ai Receptionist';

update public.receptionist_configs
set display_name = 'Jobrin.ai Receptionist'
where display_name = 'Jobryn Receptionist';
