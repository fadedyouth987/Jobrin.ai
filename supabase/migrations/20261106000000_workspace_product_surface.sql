-- Receptionist-first redesign: per-workspace product surface.
--
-- "Hide, don't delete": a workspace either sees the receptionist-first
-- surface (receptionist, job inbox, alerts, team, billing) or the full
-- product. Individual areas can be switched back on per workspace through
-- feature_overrides, e.g. {"quotes_invoices": true}. Area keys and their
-- defaults live in shared/features.ts.
--
-- This controls what the app SHOWS. It is not an access control: every API
-- route keeps its existing role and plan-entitlement checks.
--
-- Existing workspaces keep the full product (the column is added with
-- default 'full', which backfills every current row); only workspaces created
-- after this migration start on the receptionist surface.

alter table public.workspaces
  add column if not exists product_surface text not null default 'full',
  add column if not exists feature_overrides jsonb not null default '{}'::jsonb;

alter table public.workspaces
  alter column product_surface set default 'receptionist';

alter table public.workspaces drop constraint if exists workspaces_product_surface_check;
alter table public.workspaces
  add constraint workspaces_product_surface_check
  check (product_surface in ('receptionist', 'full'));

alter table public.workspaces drop constraint if exists workspaces_feature_overrides_object;
alter table public.workspaces
  add constraint workspaces_feature_overrides_object
  check (jsonb_typeof(feature_overrides) = 'object');

-- Server-controlled: the browser role keeps its existing column-level UPDATE
-- grant (name, slug, retention_days) from 0005 and gains nothing here. The
-- explicit revoke documents and enforces that.
revoke update (product_surface, feature_overrides) on public.workspaces from authenticated, anon;

comment on column public.workspaces.product_surface is
  'receptionist | full. Which product areas the app shows by default. Not an access control.';
comment on column public.workspaces.feature_overrides is
  'Per-area visibility overrides keyed by shared/features.ts area keys, e.g. {"quotes_invoices": true}.';
