// Supplier purchasing: suppliers, their price books, and purchase orders that
// can be linked to a job. Cost tracking here is separate from — and feeds
// into — the existing job_materials ledger (server/routes/operations.ts):
// a received purchase order's line items are the source of truth for what a
// job actually cost to supply, while job_materials remains the place a
// technician logs materials against a specific job on site.
import { Router } from 'express';
import { z } from 'zod';
import { applyKeysetCursor, asyncRoute, buildPage, dbErrorMessage, parseCursor, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

// ---------- Suppliers ----------

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(200),
  contact_email: z.string().trim().email().max(200).nullable().optional(),
  contact_phone: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(4000).default(''),
});

router.get('/suppliers', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('suppliers').select('id,name,contact_email,contact_phone,notes,created_at')
    .eq('workspace_id', req.workspaceId!).order('name');
  if (error) return res.status(500).json({ error: 'SUPPLIER_LIST_FAILED' });
  res.json({ suppliers: data ?? [] });
}));

router.post('/suppliers', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(supplierSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('suppliers').insert({
    workspace_id: req.workspaceId!, name: req.body.name,
    contact_email: req.body.contact_email || null, contact_phone: req.body.contact_phone || null, notes: req.body.notes,
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'SUPPLIER_CREATE_FAILED', message: dbErrorMessage(error) });
  await writeAudit(req, 'supplier.created', 'supplier', data.id);
  res.status(201).json({ supplier: data });
}));

router.patch('/suppliers/:id', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(supplierSchema.partial()), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const patch: Record<string, unknown> = { ...req.body };
  if ('contact_email' in patch) patch.contact_email = patch.contact_email || null;
  if ('contact_phone' in patch) patch.contact_phone = patch.contact_phone || null;
  const { data, error } = await db.from('suppliers').update(patch)
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'SUPPLIER_UPDATE_FAILED', message: dbErrorMessage(error) });
  if (!data) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
  await writeAudit(req, 'supplier.updated', 'supplier', data.id);
  res.json({ supplier: data });
}));

// ---------- Supplier price book items ----------

const priceBookItemSchema = z.object({
  supplier_id: z.string().uuid(),
  sku: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(2).max(300),
  unit_cost_cents: z.number().int().min(0).max(100_000_000),
});

router.get('/price-book', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const supplierId = String(req.query.supplier_id || '');
  const limit = 300;
  const cursor = parseCursor(req.query.cursor);
  let query = db.from('supplier_price_book_items').select('id,supplier_id,sku,description,unit_cost_cents,updated_at,suppliers(name)').eq('workspace_id', req.workspaceId!);
  if (supplierId && /^[0-9a-f-]{36}$/i.test(supplierId)) query = query.eq('supplier_id', supplierId);
  query = applyKeysetCursor(query, cursor);
  const { data, error } = await query.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) return res.status(500).json({ error: 'PRICE_BOOK_LIST_FAILED' });
  const { page, nextCursor, hasMore } = buildPage(data ?? [], limit);
  res.json({ items: page, nextCursor, hasMore });
}));

router.post('/price-book', requireRole('owner', 'admin', 'manager'), validateBody(priceBookItemSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: supplier } = await db.from('suppliers').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.body.supplier_id).maybeSingle();
  if (!supplier) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
  const { data, error } = await db.from('supplier_price_book_items').insert({
    workspace_id: req.workspaceId!, supplier_id: req.body.supplier_id, sku: req.body.sku || null,
    description: req.body.description, unit_cost_cents: req.body.unit_cost_cents,
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'PRICE_BOOK_ITEM_CREATE_FAILED', message: dbErrorMessage(error) });
  await writeAudit(req, 'supplier_price_book_item.created', 'supplier_price_book_item', data.id);
  res.status(201).json({ item: data });
}));

router.patch('/price-book/:id', requireRole('owner', 'admin', 'manager'), validateBody(priceBookItemSchema.partial().omit({ supplier_id: true })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const patch: Record<string, unknown> = { ...req.body, updated_at: new Date().toISOString() };
  if ('sku' in patch) patch.sku = patch.sku || null;
  const { data, error } = await db.from('supplier_price_book_items').update(patch)
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'PRICE_BOOK_ITEM_UPDATE_FAILED', message: dbErrorMessage(error) });
  if (!data) return res.status(404).json({ error: 'PRICE_BOOK_ITEM_NOT_FOUND' });
  await writeAudit(req, 'supplier_price_book_item.updated', 'supplier_price_book_item', data.id);
  res.json({ item: data });
}));

// Bulk import: a simple array-of-rows JSON body (not a CSV parser). Rows with
// a sku upsert onto the existing (supplier_id, sku) row per the unique index
// in the migration; rows without a sku always insert as new lines, since
// there is nothing to key an upsert on.
const importRowSchema = z.object({
  sku: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().min(2).max(300),
  unit_cost_cents: z.number().int().min(0).max(100_000_000),
});

router.post('/price-book/import', requireRole('owner', 'admin', 'manager'), validateBody(z.object({
  supplier_id: z.string().uuid(),
  rows: z.array(importRowSchema).min(1).max(2000),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: supplier } = await db.from('suppliers').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.body.supplier_id).maybeSingle();
  if (!supplier) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
  const now = new Date().toISOString();
  const withSku = req.body.rows.filter((row: any) => row.sku).map((row: any) => ({
    workspace_id: req.workspaceId!, supplier_id: req.body.supplier_id, sku: row.sku,
    description: row.description, unit_cost_cents: row.unit_cost_cents, updated_at: now,
  }));
  const withoutSku = req.body.rows.filter((row: any) => !row.sku).map((row: any) => ({
    workspace_id: req.workspaceId!, supplier_id: req.body.supplier_id, sku: null,
    description: row.description, unit_cost_cents: row.unit_cost_cents, updated_at: now,
  }));
  const results: any[] = [];
  if (withSku.length) {
    const { data, error } = await db.from('supplier_price_book_items')
      .upsert(withSku, { onConflict: 'supplier_id,sku' }).select('*');
    if (error) return res.status(400).json({ error: 'PRICE_BOOK_IMPORT_FAILED', message: dbErrorMessage(error) });
    results.push(...(data ?? []));
  }
  if (withoutSku.length) {
    const { data, error } = await db.from('supplier_price_book_items').insert(withoutSku).select('*');
    if (error) return res.status(400).json({ error: 'PRICE_BOOK_IMPORT_FAILED', message: dbErrorMessage(error) });
    results.push(...(data ?? []));
  }
  await writeAudit(req, 'supplier_price_book.imported', 'supplier', req.body.supplier_id, { count: results.length });
  res.status(201).json({ items: results, imported: results.length });
}));

// ---------- Purchase orders ----------

const poSchema = z.object({
  supplier_id: z.string().uuid(),
  job_id: z.string().uuid().nullable().optional(),
});

router.get('/purchase-orders', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const jobId = String(req.query.job_id || '');
  const limit = 300;
  const cursor = parseCursor(req.query.cursor);
  let query = db.from('purchase_orders').select('id,supplier_id,job_id,status,created_at,ordered_at,received_at,suppliers(name),jobs(job_number,title)').eq('workspace_id', req.workspaceId!);
  if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) query = query.eq('job_id', jobId);
  query = applyKeysetCursor(query, cursor);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) return res.status(500).json({ error: 'PURCHASE_ORDER_LIST_FAILED' });
  const { page, nextCursor, hasMore } = buildPage(data ?? [], limit);
  res.json({ purchaseOrders: page, nextCursor, hasMore });
}));

router.get('/purchase-orders/:id', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const workspaceId = req.workspaceId!;
  const { data: po, error } = await db.from('purchase_orders')
    .select('id,supplier_id,job_id,status,created_at,ordered_at,received_at,suppliers(name),jobs(job_number,title)')
    .eq('workspace_id', workspaceId).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'PURCHASE_ORDER_READ_FAILED' });
  if (!po) return res.status(404).json({ error: 'PURCHASE_ORDER_NOT_FOUND' });
  const { data: items, error: itemsError } = await db.from('purchase_order_items')
    .select('id,description,quantity,unit_cost_cents,price_book_item_id').eq('workspace_id', workspaceId).eq('purchase_order_id', po.id).order('id');
  if (itemsError) return res.status(500).json({ error: 'PURCHASE_ORDER_ITEMS_READ_FAILED' });
  res.json({ purchaseOrder: po, items: items ?? [] });
}));

router.post('/purchase-orders', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(poSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: supplier } = await db.from('suppliers').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.body.supplier_id).maybeSingle();
  if (!supplier) return res.status(404).json({ error: 'SUPPLIER_NOT_FOUND' });
  if (req.body.job_id) {
    const { data: job } = await db.from('jobs').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.body.job_id).maybeSingle();
    if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  }
  const { data, error } = await db.from('purchase_orders').insert({
    workspace_id: req.workspaceId!, supplier_id: req.body.supplier_id, job_id: req.body.job_id || null, status: 'draft',
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'PURCHASE_ORDER_CREATE_FAILED', message: dbErrorMessage(error) });
  await writeAudit(req, 'purchase_order.created', 'purchase_order', data.id, { job_id: data.job_id });
  res.status(201).json({ purchaseOrder: data });
}));

const poItemSchema = z.object({
  description: z.string().trim().min(2).max(300),
  quantity: z.number().positive().max(100_000),
  unit_cost_cents: z.number().int().min(0).max(100_000_000),
  price_book_item_id: z.string().uuid().nullable().optional(),
});

router.post('/purchase-orders/:id/items', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(poItemSchema), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const workspaceId = req.workspaceId!;
  const { data: po, error: poError } = await db.from('purchase_orders').select('id,status').eq('workspace_id', workspaceId).eq('id', req.params.id).maybeSingle();
  if (poError) return res.status(500).json({ error: 'PURCHASE_ORDER_READ_FAILED' });
  if (!po) return res.status(404).json({ error: 'PURCHASE_ORDER_NOT_FOUND' });
  if (po.status !== 'draft') return res.status(409).json({ error: 'PURCHASE_ORDER_NOT_EDITABLE', status: po.status });
  if (req.body.price_book_item_id) {
    const { data: priceBookItem } = await db.from('supplier_price_book_items').select('id').eq('workspace_id', workspaceId).eq('id', req.body.price_book_item_id).maybeSingle();
    if (!priceBookItem) return res.status(404).json({ error: 'PRICE_BOOK_ITEM_NOT_FOUND' });
  }
  const { data: item, error } = await db.from('purchase_order_items').insert({
    workspace_id: workspaceId, purchase_order_id: po.id, description: req.body.description,
    quantity: req.body.quantity, unit_cost_cents: req.body.unit_cost_cents, price_book_item_id: req.body.price_book_item_id || null,
  }).select('*').single();
  if (error) return res.status(400).json({ error: 'PURCHASE_ORDER_ITEM_CREATE_FAILED', message: dbErrorMessage(error) });
  await writeAudit(req, 'purchase_order.item_added', 'purchase_order', po.id, { description: req.body.description });
  res.status(201).json({ item });
}));

const PO_TRANSITIONS: Record<string, string[]> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['received', 'cancelled'],
  received: [],
  cancelled: [],
};

router.patch('/purchase-orders/:id/status', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(z.object({
  status: z.enum(['ordered', 'received', 'cancelled']),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const workspaceId = req.workspaceId!;
  const { data: po, error: poError } = await db.from('purchase_orders').select('id,status').eq('workspace_id', workspaceId).eq('id', req.params.id).maybeSingle();
  if (poError) return res.status(500).json({ error: 'PURCHASE_ORDER_READ_FAILED' });
  if (!po) return res.status(404).json({ error: 'PURCHASE_ORDER_NOT_FOUND' });
  if (!PO_TRANSITIONS[po.status]?.includes(req.body.status)) {
    return res.status(409).json({ error: 'PURCHASE_ORDER_INVALID_TRANSITION', from: po.status, to: req.body.status });
  }
  const patch: Record<string, unknown> = { status: req.body.status };
  if (req.body.status === 'ordered') patch.ordered_at = new Date().toISOString();
  if (req.body.status === 'received') patch.received_at = new Date().toISOString();
  const { data, error } = await db.from('purchase_orders').update(patch)
    .eq('workspace_id', workspaceId).eq('id', po.id).select('*').single();
  if (error) return res.status(400).json({ error: 'PURCHASE_ORDER_STATUS_UPDATE_FAILED', message: dbErrorMessage(error) });
  await writeAudit(req, `purchase_order.${req.body.status}`, 'purchase_order', data.id);
  res.json({ purchaseOrder: data });
}));

export default router;
