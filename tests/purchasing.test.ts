import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

test('supplier and purchase order writes require at least staff, matching jobs/appointments in operations.ts', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  assert.match(purchasingSource, /router\.post\('\/suppliers', requireRole\('owner', 'admin', 'manager', 'staff'\)/);
  assert.match(purchasingSource, /router\.patch\('\/suppliers\/:id', requireRole\('owner', 'admin', 'manager', 'staff'\)/);
  assert.match(purchasingSource, /router\.post\('\/purchase-orders', requireRole\('owner', 'admin', 'manager', 'staff'\)/);
  assert.match(purchasingSource, /router\.post\('\/purchase-orders\/:id\/items', requireRole\('owner', 'admin', 'manager', 'staff'\)/);
  assert.match(purchasingSource, /router\.patch\('\/purchase-orders\/:id\/status', requireRole\('owner', 'admin', 'manager', 'staff'\)/);
});

test('price book writes (including bulk import) require manager and above, since they feed quote pricing directly', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  assert.match(purchasingSource, /router\.post\('\/price-book', requireRole\('owner', 'admin', 'manager'\)/);
  assert.match(purchasingSource, /router\.patch\('\/price-book\/:id', requireRole\('owner', 'admin', 'manager'\)/);
  assert.match(purchasingSource, /router\.post\('\/price-book\/import', requireRole\('owner', 'admin', 'manager'\)/);
  // Must not accidentally allow staff to import/edit price books.
  const importAt = purchasingSource.indexOf("router.post('/price-book/import'");
  assert.ok(importAt >= 0);
  assert.doesNotMatch(purchasingSource.slice(importAt, importAt + 120), /'staff'/);
});

test('every route in the router sits behind requireAuth, requireWorkspace and an active subscription check', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  assert.match(purchasingSource, /router\.use\(requireAuth, requireWorkspace, requireActiveSubscription\('crm\.core'\)\)/);
});

test('all money fields are validated as integer cents, never floating-point dollars', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  // Every unit_cost_cents field must be validated with z.number().int(), not a float/decimal schema.
  const centsFieldMatches = purchasingSource.match(/unit_cost_cents: z\.number\(\)\.int\(\)/g) ?? [];
  assert.ok(centsFieldMatches.length >= 3, 'expected unit_cost_cents to be declared as an integer field in each schema that carries it');
  assert.doesNotMatch(purchasingSource, /unit_cost_cents: z\.number\(\)(?!\.int)/);
  // The migration backs this with a bigint column and a non-negative check, matching job_materials'
  // unit_cost_cents/unit_price_cents convention in 0013_field_service_and_safe_autopilot.sql.
  const migrationSource = source('supabase/migrations/20260914010100_supplier_purchasing.sql');
  assert.match(migrationSource, /unit_cost_cents bigint not null default 0 check \(unit_cost_cents >= 0\)/);
});

test('a purchase order may optionally link to a job, and a bogus job id is rejected rather than silently ignored', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  const routeAt = purchasingSource.indexOf("router.post('/purchase-orders',");
  const routeBody = purchasingSource.slice(routeAt, purchasingSource.indexOf("router.post('/purchase-orders/:id/items'", routeAt));
  assert.match(purchasingSource, /job_id: z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(routeBody, /if \(req\.body\.job_id\) \{/);
  assert.match(routeBody, /JOB_NOT_FOUND/);
  // The job lookup must be scoped to the caller's own workspace, never a bare id lookup.
  assert.match(routeBody, /db\.from\('jobs'\)\.select\('id'\)\.eq\('workspace_id', req\.workspaceId!\)\.eq\('id', req\.body\.job_id\)/);
});

test('purchase order status only moves forward through draft -> ordered -> received, with cancellation from draft or ordered', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  assert.match(purchasingSource, /draft: \['ordered', 'cancelled'\]/);
  assert.match(purchasingSource, /ordered: \['received', 'cancelled'\]/);
  assert.match(purchasingSource, /received: \[\]/);
  assert.match(purchasingSource, /cancelled: \[\]/);
  assert.match(purchasingSource, /PURCHASE_ORDER_INVALID_TRANSITION/);
  // Line items can only be added while still a draft — once ordered, the order is locked.
  const itemsRouteAt = purchasingSource.indexOf("router.post('/purchase-orders/:id/items'");
  const itemsRouteBody = purchasingSource.slice(itemsRouteAt, purchasingSource.indexOf("const PO_TRANSITIONS", itemsRouteAt));
  assert.match(itemsRouteBody, /PURCHASE_ORDER_NOT_EDITABLE/);
});

test('bulk price book import upserts rows that carry a sku and inserts rows that do not, keyed by the migration\'s unique index', () => {
  const purchasingSource = source('server/routes/purchasing.ts');
  const routeAt = purchasingSource.indexOf("router.post('/price-book/import'");
  const routeBody = purchasingSource.slice(routeAt, purchasingSource.indexOf('// ---------- Purchase orders', routeAt));
  assert.match(routeBody, /\.upsert\(withSku, \{ onConflict: 'supplier_id,sku' \}\)/);
  assert.match(routeBody, /\.from\('supplier_price_book_items'\)\.insert\(withoutSku\)/);
  const migrationSource = source('supabase/migrations/20260914010100_supplier_purchasing.sql');
  assert.match(migrationSource, /create unique index if not exists price_book_items_supplier_sku_idx on public\.supplier_price_book_items\(supplier_id, sku\) where sku is not null/);
});

test('the purchasing migration enforces tenant isolation the same way as 0004/0013: RLS on every table plus a cross-workspace reference guard on every foreign key', () => {
  const migrationSource = source('supabase/migrations/20260914010100_supplier_purchasing.sql');
  for (const table of ['suppliers', 'supplier_price_book_items', 'purchase_orders', 'purchase_order_items']) {
    assert.match(migrationSource, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  // Cross-tenant reference guards, matching the tenant_ref_ naming/trigger pattern from 0004_subscription_and_tenant_invariants.sql.
  for (const spec of [
    'supplier_price_book_items:supplier_id:suppliers',
    'purchase_orders:supplier_id:suppliers',
    'purchase_orders:job_id:jobs',
    'purchase_order_items:purchase_order_id:purchase_orders',
    'purchase_order_items:price_book_item_id:supplier_price_book_items',
  ]) assert.match(migrationSource, new RegExp(spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(migrationSource, /private\.assert_same_workspace_reference/);
  // No delete grant to authenticated: corrections/cancellation go through status transitions
  // or the trusted server, matching job_materials' delete-only-via-supabaseAdmin pattern.
  assert.doesNotMatch(migrationSource, /grant.*delete.*to authenticated/i);
});

test('purchase_order_items carries its own workspace_id column, matching the quote_items/invoice_items denormalization pattern', () => {
  // 0003_revenue_os_core.sql gives quote_items and invoice_items their own workspace_id
  // column (rather than joining through the parent) so RLS and the tenant-reference
  // trigger can enforce isolation directly on the child table.
  const migrationSource = source('supabase/migrations/20260914010100_supplier_purchasing.sql');
  const tableAt = migrationSource.indexOf('create table if not exists public.purchase_order_items');
  const tableBody = migrationSource.slice(tableAt, migrationSource.indexOf(');', tableAt));
  assert.match(tableBody, /workspace_id uuid not null references public\.workspaces\(id\) on delete cascade/);
});
