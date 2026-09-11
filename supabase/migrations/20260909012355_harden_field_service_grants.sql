-- Make Data API exposure explicit for every field-service table introduced
-- after the original least-privilege migration. Supabase no longer guarantees
-- implicit grants for new public tables, and older projects may still carry
-- overly broad anon defaults, so normalize both cases here.

revoke all on table
  public.customer_assets,
  public.service_agreements,
  public.technician_profiles,
  public.job_time_entries,
  public.job_materials,
  public.checklist_templates,
  public.job_checklists,
  public.job_signatures
from anon, authenticated, service_role;

grant select, insert, update on table
  public.customer_assets,
  public.service_agreements,
  public.technician_profiles,
  public.job_time_entries,
  public.job_materials
to authenticated;

grant select, insert, update, delete on table
  public.checklist_templates
to authenticated;

grant select, insert on table
  public.job_checklists,
  public.job_signatures
to authenticated;

grant select, insert, update, delete on table
  public.customer_assets,
  public.service_agreements,
  public.technician_profiles,
  public.job_time_entries,
  public.job_materials,
  public.checklist_templates,
  public.job_checklists,
  public.job_signatures
to service_role;
