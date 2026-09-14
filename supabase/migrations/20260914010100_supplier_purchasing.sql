-- Supplier purchasing: suppliers, their price books, and purchase orders that
-- can be linked to a job so cost tracking feeds job profitability alongside
-- the existing job_materials ledger (server/routes/operations.ts). This
-- migration is additive and must be applied through the normal reviewed
-- migration process — it is NOT applied automatically.

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  contact_email text,
  contact_phone text,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists suppliers_workspace_idx on public.suppliers(workspace_id);

create table if not exists public.supplier_price_book_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  sku text,
  description text not null,
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists price_book_items_workspace_supplier_idx on public.supplier_price_book_items(workspace_id, supplier_id);
-- Supports idempotent bulk import (upsert by supplier + sku) when a sku is provided.
create unique index if not exists price_book_items_supplier_sku_idx on public.supplier_price_book_items(supplier_id, sku) where sku is not null;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  created_at timestamptz not null default now(),
  ordered_at timestamptz,
  received_at timestamptz
);
create index if not exists purchase_orders_workspace_job_idx on public.purchase_orders(workspace_id, job_id);
create index if not exists purchase_orders_workspace_supplier_idx on public.purchase_orders(workspace_id, supplier_id);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  -- Denormalized workspace_id (same pattern as quote_items/invoice_items in
  -- 0003_revenue_os_core.sql) so RLS and the tenant-reference trigger can
  -- enforce tenant isolation directly on this table.
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  price_book_item_id uuid references public.supplier_price_book_items(id) on delete set null,
  description text not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0)
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items(purchase_order_id);

alter table public.suppliers enable row level security;
alter table public.supplier_price_book_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

-- Members may read; existing private membership helper enforces tenant isolation.
do $$ declare t text; begin foreach t in array array['suppliers','supplier_price_book_items','purchase_orders','purchase_order_items'] loop
  execute format('create policy %I on public.%I for select to authenticated using (private.is_workspace_member(workspace_id))', t || '_member_select', t);
end loop; end $$;

-- Day-to-day purchasing operations: staff and above (matches jobs/appointments in 0005).
do $$ declare t text; begin foreach t in array array['suppliers','purchase_orders','purchase_order_items'] loop
  execute format(
    'create policy %I on public.%I for all to authenticated using (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[])) with check (private.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''staff'']::public.workspace_role[]))',
    t || '_staff_write', t
  );
end loop; end $$;

-- Price books feed quote pricing directly, so they follow the same
-- manager-and-above boundary as services/business configuration (0005).
create policy supplier_price_book_items_manager_write on public.supplier_price_book_items for all to authenticated
  using (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]))
  with check (private.has_workspace_role(workspace_id, array['owner','admin','manager']::public.workspace_role[]));

revoke all on public.suppliers, public.supplier_price_book_items, public.purchase_orders, public.purchase_order_items from anon, authenticated;
grant select, insert, update on public.suppliers, public.supplier_price_book_items, public.purchase_orders, public.purchase_order_items to authenticated;
-- No delete grant: purchase orders are cancelled via status, not removed; supplier/price-book
-- corrections go through the trusted server (supabaseAdmin), matching job_materials delete.

-- Cross-tenant reference guards (same private.assert_same_workspace_reference trigger installed in 0004).
do $$
declare
  spec text;
  parts text[];
  trigger_name text;
  specs text[] := array[
    'supplier_price_book_items:supplier_id:suppliers',
    'purchase_orders:supplier_id:suppliers',
    'purchase_orders:job_id:jobs',
    'purchase_order_items:purchase_order_id:purchase_orders',
    'purchase_order_items:price_book_item_id:supplier_price_book_items'
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
