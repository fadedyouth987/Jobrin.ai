import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { env } from '../env';
import { sendEmail, emailConfigured } from '../providers/email';
import { hashShareToken, canDecideQuote } from './public';
import { stripe } from './billing';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireSensitiveAuth, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('booking.core'));

router.get('/appointments', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const from = String(req.query.from || new Date(Date.now() - 86_400_000).toISOString());
  const to = String(req.query.to || new Date(Date.now() + 30 * 86_400_000).toISOString());
  const { data, error } = await db.from('appointments')
    .select('id,title,starts_at,ends_at,status,address_text,customer_id,customers(display_name),service_id,services(name),assigned_user_id,sync_status')
    .eq('workspace_id', req.workspaceId!).gte('starts_at', from).lte('starts_at', to).order('starts_at').limit(500);
  if (error) return res.status(500).json({ error: 'APPOINTMENT_LIST_FAILED' });
  res.json({ appointments: data ?? [] });
}));

router.post('/appointments', requireRole('owner','admin','manager','staff'), validateBody(z.object({
  customer_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  address_text: z.string().trim().max(500).nullable().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  timezone: z.string().trim().min(3).max(80).default('Australia/Adelaide'),
  notes: z.string().trim().max(4000).default(''),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (new Date(req.body.ends_at) <= new Date(req.body.starts_at)) return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  const db = createUserClient(req.auth!.accessToken);
  if (req.body.assigned_user_id) {
    const { data: conflict, error: conflictError } = await db.from('appointments').select('id').eq('workspace_id', req.workspaceId!)
      .eq('assigned_user_id', req.body.assigned_user_id).in('status', ['hold','scheduled','confirmed'])
      .lt('starts_at', req.body.ends_at).gt('ends_at', req.body.starts_at).limit(1);
    if (conflictError) return res.status(500).json({ error: 'AVAILABILITY_CHECK_FAILED' });
    if (conflict?.length) return res.status(409).json({ error: 'BOOKING_CONFLICT' });
  }
  const { data, error } = await db.from('appointments').insert({ ...req.body, workspace_id: req.workspaceId!, status: 'scheduled', source: 'jobryn' }).select('*').single();
  if (error) return res.status(400).json({ error: 'APPOINTMENT_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'appointment.created', 'appointment', data.id);
  res.status(201).json({ appointment: data });
}));

router.get('/jobs', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('jobs')
    .select('id,job_number,title,status,address_text,scheduled_start,scheduled_end,completed_at,customer_id,customers(display_name),service_id,services(name),assigned_user_id')
    .eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: 'JOB_LIST_FAILED' });
  res.json({ jobs: data ?? [] });
}));

router.get('/jobs/:id', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const workspaceId = req.workspaceId!;
  const { data: job, error: jobError } = await db.from('jobs')
    .select('id,job_number,title,description,status,address_text,scheduled_start,scheduled_end,completed_at,created_at,updated_at,customer_id,customers(id,display_name,phone,email),service_id,services(name),assigned_user_id')
    .eq('workspace_id', workspaceId).eq('id', req.params.id).maybeSingle();
  if (jobError) return res.status(500).json({ error: 'JOB_READ_FAILED' });
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  const [appointments, quotes, invoices, timeEntries, materials] = await Promise.all([
    db.from('appointments').select('id,title,status,starts_at,ends_at,address_text,assigned_user_id').eq('workspace_id', workspaceId).eq('job_id', job.id).order('starts_at'),
    db.from('job_time_entries').select('id,user_id,started_at,ended_at,break_minutes,notes').eq('workspace_id', workspaceId).eq('job_id', job.id).order('started_at'),
    db.from('job_materials').select('id,description,supplier,quantity,unit_cost_cents,unit_price_cents,supplier_reference,created_at').eq('workspace_id', workspaceId).eq('job_id', job.id).order('created_at'),
    db.from('quotes').select('id,quote_number,status,total_cents,expires_at,created_at').eq('workspace_id', workspaceId).eq('job_id', job.id).order('created_at', { ascending: false }),
    db.from('invoices').select('id,invoice_number,status,total_cents,balance_due_cents,due_at,created_at').eq('workspace_id', workspaceId).eq('job_id', job.id).order('created_at', { ascending: false }),
  ]);
  const relatedError = [appointments.error, quotes.error, invoices.error, timeEntries.error, materials.error].find(Boolean);
  if (relatedError) return res.status(500).json({ error: 'JOB_RELATED_READ_FAILED' });
  const invoiceIds = (invoices.data ?? []).map((invoice: any) => invoice.id);
  const payments = invoiceIds.length
    ? await db.from('payments').select('id,status,amount_cents,paid_at,invoice_id,created_at').eq('workspace_id', workspaceId).in('invoice_id', invoiceIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (payments.error) return res.status(500).json({ error: 'JOB_PAYMENT_READ_FAILED' });
  res.json({ job, appointments: appointments.data ?? [], quotes: quotes.data ?? [], invoices: invoices.data ?? [], payments: payments.data ?? [], time_entries: timeEntries.data ?? [], materials: materials.data ?? [] });
}));

router.post('/jobs', requireRole('owner','admin','manager','staff'), validateBody(z.object({
  customer_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
  appointment_id: z.string().uuid().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).default(''),
  address_text: z.string().trim().max(500).nullable().optional(),
  assigned_user_id: z.string().uuid().nullable().optional(),
  scheduled_start: z.string().datetime().nullable().optional(),
  scheduled_end: z.string().datetime().nullable().optional(),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('jobs').insert({ ...req.body, workspace_id: req.workspaceId! }).select('*').single();
  if (error) return res.status(400).json({ error: 'JOB_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'job.created', 'job', data.id);
  res.status(201).json({ job: data });
}));

router.patch('/jobs/:id/schedule', requireRole('owner','admin','manager','staff'), validateBody(z.object({
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  assigned_user_id: z.string().uuid().nullable().optional(),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (new Date(req.body.scheduled_end) <= new Date(req.body.scheduled_start)) return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  const db = createUserClient(req.auth!.accessToken);
  const workspaceId = req.workspaceId!;
  const { data: current, error: readError } = await db.from('jobs').select('id,status').eq('workspace_id', workspaceId).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'JOB_READ_FAILED' });
  if (!current) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  if (['completed','invoiced','paid','cancelled'].includes(current.status)) return res.status(409).json({ error: 'JOB_CANNOT_BE_SCHEDULED', status: current.status });
  if (req.body.assigned_user_id) {
    const { data: conflict, error: conflictError } = await db.from('jobs').select('id').eq('workspace_id', workspaceId)
      .eq('assigned_user_id', req.body.assigned_user_id).neq('id', current.id).in('status', ['scheduled','on_the_way','in_progress'])
      .lt('scheduled_start', req.body.scheduled_end).gt('scheduled_end', req.body.scheduled_start).limit(1);
    if (conflictError) return res.status(500).json({ error: 'AVAILABILITY_CHECK_FAILED' });
    if (conflict?.length) return res.status(409).json({ error: 'SCHEDULING_CONFLICT' });
  }
  const patch = { scheduled_start: req.body.scheduled_start, scheduled_end: req.body.scheduled_end, assigned_user_id: req.body.assigned_user_id ?? null, status: current.status === 'new' ? 'scheduled' : current.status, updated_at: new Date().toISOString() };
  const { data, error } = await db.from('jobs').update(patch).eq('workspace_id', workspaceId).eq('id', current.id).select('*').single();
  if (error) return res.status(400).json({ error: 'JOB_SCHEDULE_FAILED' });
  await writeAudit(req, 'job.scheduled', 'job', data.id, { scheduled_start: data.scheduled_start, scheduled_end: data.scheduled_end, assigned_user_id: data.assigned_user_id });
  res.json({ job: data });
}));

// Time tracking: technicians log their own hours; a running entry has no
// ended_at. Only the entry owner (or managers+) may stop it.
router.post('/jobs/:id/time', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(z.object({
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().nullable().optional(),
  break_minutes: z.number().int().min(0).max(480).default(0),
  notes: z.string().trim().max(1000).default(''),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: job, error: jobError } = await db.from('jobs').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (jobError) return res.status(500).json({ error: 'JOB_READ_FAILED' });
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  const startedAt = new Date(req.body.started_at);
  if (Number.isNaN(startedAt.getTime())) return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  let endedAt: Date | null = req.body.ended_at ? new Date(req.body.ended_at) : null;
  if (endedAt !== null && (Number.isNaN(endedAt.getTime()) || endedAt.getTime() <= startedAt.getTime())) return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  const { data: entry, error } = await db.from('job_time_entries').insert({
    workspace_id: req.workspaceId!, job_id: job.id, user_id: req.auth!.userId,
    started_at: startedAt.toISOString(), ended_at: endedAt ? endedAt.toISOString() : null,
    break_minutes: req.body.break_minutes, notes: req.body.notes,
  }).select('id,user_id,started_at,ended_at,break_minutes,notes').single();
  if (error) return res.status(400).json({ error: 'TIME_ENTRY_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'job.time.logged', 'job_time_entry', entry.id);
  res.status(201).json({ entry });
}));

router.patch('/jobs/:id/time/:entryId', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(z.object({
  ended_at: z.string().datetime(),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: entry, error: readError } = await db.from('job_time_entries').select('id,user_id,started_at').eq('workspace_id', req.workspaceId!).eq('id', req.params.entryId).maybeSingle();
  if (readError) return res.status(500).json({ error: 'TIME_ENTRY_READ_FAILED' });
  if (!entry) return res.status(404).json({ error: 'TIME_ENTRY_NOT_FOUND' });
  const isElevated = ['owner', 'admin', 'manager'].includes(req.workspaceRole || '');
  if (!isElevated && entry.user_id !== req.auth!.userId) return res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
  const endedAt = new Date(req.body.ended_at);
  if (Number.isNaN(endedAt.getTime()) || endedAt.getTime() <= new Date(entry.started_at).getTime()) return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  const { data, error } = await db.from('job_time_entries').update({ ended_at: endedAt.toISOString() })
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.entryId).select('id,started_at,ended_at,break_minutes,notes').single();
  if (error || !data) return res.status(400).json({ error: 'TIME_ENTRY_UPDATE_FAILED' });
  await writeAudit(req, 'job.time.stopped', 'job_time_entry', data.id);
  res.json({ entry: data });
}));

router.post('/jobs/:id/materials', requireRole('owner', 'admin', 'manager', 'staff'), validateBody(z.object({
  description: z.string().trim().min(2).max(300),
  supplier: z.string().trim().max(160).nullable().optional(),
  quantity: z.number().positive().max(100_000),
  unit_cost_cents: z.number().int().min(0).max(100_000_000).default(0),
  unit_price_cents: z.number().int().min(0).max(100_000_000).default(0),
  supplier_reference: z.string().trim().max(160).nullable().optional(),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: job, error: jobError } = await db.from('jobs').select('id').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (jobError) return res.status(500).json({ error: 'JOB_READ_FAILED' });
  if (!job) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  const { data: material, error } = await db.from('job_materials').insert({
    workspace_id: req.workspaceId!, job_id: job.id, description: req.body.description,
    supplier: req.body.supplier || null, quantity: req.body.quantity,
    unit_cost_cents: req.body.unit_cost_cents, unit_price_cents: req.body.unit_price_cents,
    supplier_reference: req.body.supplier_reference || null,
  }).select('id,description,quantity,unit_cost_cents,unit_price_cents,supplier').single();
  if (error) return res.status(400).json({ error: 'MATERIAL_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'job.materials.added', 'job_material', material.id, { description: req.body.description });
  res.status(201).json({ material });
}));

router.delete('/jobs/:id/materials/:materialId', requireRole('owner', 'admin', 'manager'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  // No delete grant for browser clients - trusted server-side correction only.
  const { data, error } = await supabaseAdmin.from('job_materials').delete()
    .eq('workspace_id', req.workspaceId!).eq('job_id', req.params.id).eq('id', req.params.materialId).select('id').maybeSingle();
  if (error) return res.status(500).json({ error: 'MATERIAL_DELETE_FAILED' });
  if (!data) return res.status(404).json({ error: 'MATERIAL_NOT_FOUND' });
  await writeAudit(req, 'job.materials.removed', 'job_material', String(req.params.materialId), {}, 'warning');
  res.json({ ok: true });
}));

export const jobStatusTransitions: Record<string, string[]> = {
  new: ['scheduled', 'in_progress', 'cancelled'],
  scheduled: ['on_the_way', 'in_progress', 'cancelled'],
  on_the_way: ['in_progress', 'scheduled', 'cancelled'],
  in_progress: ['completed', 'scheduled', 'cancelled'],
  completed: ['invoiced'],
  invoiced: ['paid'],
  paid: [],
  cancelled: ['new'],
};

export function canTransitionJob(from: string, to: string) {
  return (jobStatusTransitions[from] ?? []).includes(to);
}

router.patch('/jobs/:id/status', requireRole('owner','admin','manager','staff'), validateBody(z.object({ status: z.enum(['new','scheduled','on_the_way','in_progress','completed','invoiced','paid','cancelled']) })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: current, error: readError } = await db.from('jobs').select('id,status,scheduled_start,scheduled_end').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'JOB_READ_FAILED' });
  if (!current) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  if (!canTransitionJob(current.status, req.body.status)) return res.status(409).json({ error: 'INVALID_JOB_TRANSITION', from: current.status, to: req.body.status });
  if (req.body.status === 'scheduled' && (!current.scheduled_start || !current.scheduled_end)) return res.status(409).json({ error: 'JOB_SCHEDULE_REQUIRED' });
  if (req.body.status === 'invoiced') {
    const { data: invoice, error: invoiceError } = await db.from('invoices').select('id').eq('workspace_id', req.workspaceId!).eq('job_id', current.id).neq('status', 'void').limit(1).maybeSingle();
    if (invoiceError) return res.status(500).json({ error: 'JOB_INVOICE_CHECK_FAILED' });
    if (!invoice) return res.status(409).json({ error: 'JOB_INVOICE_REQUIRED' });
  }
  if (req.body.status === 'paid') {
    const { data: invoices, error: invoiceError } = await db.from('invoices').select('id,balance_due_cents,status').eq('workspace_id', req.workspaceId!).eq('job_id', current.id).neq('status', 'void');
    if (invoiceError) return res.status(500).json({ error: 'JOB_PAYMENT_CHECK_FAILED' });
    if (!invoices?.length || invoices.some((invoice: any) => Number(invoice.balance_due_cents) > 0 || !['paid','refunded'].includes(invoice.status))) return res.status(409).json({ error: 'JOB_PAYMENT_REQUIRED' });
  }
  const patch: Record<string, unknown> = { status: req.body.status, updated_at: new Date().toISOString() };
  if (req.body.status === 'completed') patch.completed_at = new Date().toISOString();
  const { data, error } = await db.from('jobs').update(patch).eq('workspace_id', req.workspaceId!).eq('id', req.params.id).select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'JOB_UPDATE_FAILED' });
  if (!data) return res.status(404).json({ error: 'JOB_NOT_FOUND' });
  await writeAudit(req, 'job.status.changed', 'job', data.id, { from: current.status, to: req.body.status });
  res.json({ job: data });
}));

router.get('/quotes', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('quotes').select('id,quote_number,status,total_cents,expires_at,created_at,customer_id,customers(display_name),job_id').eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: 'QUOTE_LIST_FAILED' });
  res.json({ quotes: data ?? [] });
}));

export const documentItems = z.array(z.object({
  description: z.string().trim().min(2).max(500),
  quantity: z.number().positive().max(100_000),
  unit_price_cents: z.number().int().min(0).max(100_000_000),
  gst_rate: z.union([z.literal(0), z.literal(0.1)]).default(0.1),
})).min(1).max(50);

export function calculateDocument(items: z.infer<typeof documentItems>) {
  return items.reduce((total, item) => {
    const lineSubtotal = Math.round(item.quantity * item.unit_price_cents);
    return { subtotal: total.subtotal + lineSubtotal, gst: total.gst + Math.round(lineSubtotal * item.gst_rate) };
  }, { subtotal: 0, gst: 0 });
}

async function verifyDocumentParents(db: ReturnType<typeof createUserClient>, workspaceId: string, customerId: string, jobId?: string | null) {
  const { data: customer, error: customerError } = await db.from('customers').select('id').eq('workspace_id', workspaceId).eq('id', customerId).is('deleted_at', null).maybeSingle();
  if (customerError || !customer) return 'CUSTOMER_NOT_FOUND';
  if (!jobId) return null;
  const { data: job, error: jobError } = await db.from('jobs').select('id,customer_id').eq('workspace_id', workspaceId).eq('id', jobId).maybeSingle();
  if (jobError || !job || (job.customer_id && job.customer_id !== customerId)) return 'JOB_NOT_FOUND';
  return null;
}

router.post('/quotes', requireRole('owner','admin','manager','staff'), validateBody(z.object({
  customer_id: z.string().uuid(),
  job_id: z.string().uuid().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  terms: z.string().trim().max(5000).default(''),
  notes: z.string().trim().max(5000).default(''),
  deposit_cents: z.number().int().min(0).max(100_000_000).default(0),
  items: documentItems,
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const parentError = await verifyDocumentParents(db, req.workspaceId!, req.body.customer_id, req.body.job_id);
  if (parentError) return res.status(404).json({ error: parentError });
  const totals = calculateDocument(req.body.items);
  const totalCents = totals.subtotal + totals.gst;
  if (req.body.deposit_cents > totalCents) return res.status(400).json({ error: 'DEPOSIT_EXCEEDS_TOTAL' });
  const { data: quote, error } = await db.from('quotes').insert({ workspace_id:req.workspaceId!, customer_id:req.body.customer_id, job_id:req.body.job_id||null, expires_at:req.body.expires_at||null, terms:req.body.terms, notes:req.body.notes, deposit_cents:req.body.deposit_cents, subtotal_cents:totals.subtotal, gst_cents:totals.gst, total_cents:totalCents, status:'draft' }).select('*').single();
  if (error) return res.status(400).json({ error:'QUOTE_CREATE_FAILED', message:error.message });
  const rows=req.body.items.map((item:any,index:number)=>({ ...item, workspace_id:req.workspaceId!, quote_id:quote.id, version:1, sort_order:index }));
  const { error:itemError }=await db.from('quote_items').insert(rows);
  if(itemError){await db.from('quotes').delete().eq('workspace_id',req.workspaceId!).eq('id',quote.id);return res.status(400).json({error:'QUOTE_ITEMS_CREATE_FAILED'});}
  await writeAudit(req,'quote.created','quote',quote.id,{total_cents:totalCents,item_count:rows.length});
  res.status(201).json({quote});
}));

// Quote lifecycle: sending issues a single-use-capability public link (the raw
// token exists only in the URL; the database stores its SHA-256 hash).
export const quoteOwnerTransitions: Record<string, string[]> = {
  draft: ['void'],
  sent: ['void'],
  viewed: ['void'],
  awaiting_approval: ['void'],
  accepted: [],
  declined: [],
};

export function canVoidQuote(from: string) {
  return (quoteOwnerTransitions[from] ?? []).includes('void');
}

async function buildQuoteShareLink(quote: { id: string; workspace_id: string; quote_number: number }) {
  const token = crypto.randomBytes(24).toString('base64url');
  const { error } = await supabaseAdmin.from('quotes').update({ public_token_hash: hashShareToken(token), updated_at: new Date().toISOString() })
    .eq('id', quote.id).eq('workspace_id', quote.workspace_id);
  if (error) return null;
  return `${env.APP_URL.replace(/\/$/, '')}/quote/${token}`;
}

router.patch('/quotes/:id/send', requireRole('owner','admin','manager','staff'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: quote, error: readError } = await db.from('quotes').select('id,quote_number,status,total_cents,workspace_id,customer_id,customers(display_name,email)')
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'QUOTE_READ_FAILED' });
  if (!quote) return res.status(404).json({ error: 'QUOTE_NOT_FOUND' });
  if (quote.status !== 'draft') return res.status(409).json({ error: 'QUOTE_NOT_SENDABLE', status: quote.status });

  const shareUrl = await buildQuoteShareLink(quote);
  if (!shareUrl) return res.status(500).json({ error: 'QUOTE_LINK_ISSUE_FAILED' });
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await db.from('quotes').update({ status: 'sent', sent_at: now, updated_at: now })
    .eq('id', quote.id).eq('workspace_id', req.workspaceId!).eq('status', 'draft').select('id,quote_number,status,sent_at').single();
  if (updateError || !updated) return res.status(409).json({ error: 'QUOTE_SEND_CONFLICT' });

  let delivery: 'sent' | 'not_configured' | 'no_customer_email' | 'failed' = 'not_configured';
  const customer = Array.isArray(quote.customers) ? quote.customers[0] : quote.customers;
  if (emailConfigured()) {
    if (customer?.email) {
      const result = await sendEmail({
        to: customer.email,
        subject: `Your quote #${quote.quote_number}`,
        text: `Hi ${customer?.display_name || 'there'},\n\nYour quote is ready to review here:\n${shareUrl}\n\nThe link shows the full price breakdown including GST. Reply to this email or call us with any questions.`,
      });
      delivery = result.delivered ? 'sent' : 'failed';
    } else {
      delivery = 'no_customer_email';
    }
  }

  await writeAudit(req, 'quote.sent', 'quote', quote.id, { delivery });
  res.json({ quote: updated, shareUrl, delivery });
}));

// Re-issues the public link: a fresh token invalidates the previous link.
router.post('/quotes/:id/link', requireRole('owner','admin','manager','staff'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: quote, error } = await db.from('quotes').select('id,quote_number,status,workspace_id')
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: 'QUOTE_READ_FAILED' });
  if (!quote) return res.status(404).json({ error: 'QUOTE_NOT_FOUND' });
  if (!['sent', 'viewed', 'accepted', 'declined'].includes(quote.status)) return res.status(409).json({ error: 'QUOTE_LINK_NOT_AVAILABLE', status: quote.status });
  const shareUrl = await buildQuoteShareLink(quote);
  if (!shareUrl) return res.status(500).json({ error: 'QUOTE_LINK_ISSUE_FAILED' });
  await writeAudit(req, 'quote.link_reissued', 'quote', quote.id);
  res.json({ shareUrl });
}));

router.patch('/quotes/:id/void', requireRole('owner','admin','manager'), validateBody(z.object({ reason: z.string().trim().max(500).default('') })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: quote, error: readError } = await db.from('quotes').select('id,status,workspace_id').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'QUOTE_READ_FAILED' });
  if (!quote) return res.status(404).json({ error: 'QUOTE_NOT_FOUND' });
  if (!canVoidQuote(quote.status)) return res.status(409).json({ error: 'QUOTE_CANNOT_BE_VOIDED', status: quote.status });
  const { data: updated, error } = await db.from('quotes').update({ status: 'void', public_token_hash: null, updated_at: new Date().toISOString() })
    .eq('id', quote.id).eq('workspace_id', req.workspaceId!).select('id,status').single();
  if (error || !updated) return res.status(400).json({ error: 'QUOTE_VOID_FAILED' });
  await writeAudit(req, 'quote.voided', 'quote', quote.id, { reason: req.body.reason }, 'warning');
  res.json({ quote: updated });
}));

router.post('/quotes/:id/convert', requireRole('owner','admin','manager','staff'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: quote, error: quoteError } = await db.from('quotes').select('id,quote_number,status,workspace_id,customer_id,job_id,subtotal_cents,gst_cents,total_cents')
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (quoteError) return res.status(500).json({ error: 'QUOTE_READ_FAILED' });
  if (!quote) return res.status(404).json({ error: 'QUOTE_NOT_FOUND' });
  if (quote.status !== 'accepted') return res.status(409).json({ error: 'QUOTE_NOT_ACCEPTED', status: quote.status, message: 'The customer must accept the quote before it can be invoiced.' });
  const { data: items, error: itemsError } = await db.from('quote_items').select('description,quantity,unit_price_cents,gst_rate,sort_order').eq('workspace_id', req.workspaceId!).eq('quote_id', quote.id).order('sort_order');
  if (itemsError) return res.status(500).json({ error: 'QUOTE_ITEMS_READ_FAILED' });
  if (!items?.length) return res.status(409).json({ error: 'QUOTE_ITEMS_REQUIRED' });

  const existing = await db.from('invoices').select('id').eq('workspace_id', req.workspaceId!).eq('quote_id', quote.id).neq('status', 'void').limit(1).maybeSingle();
  if (existing.error) return res.status(500).json({ error: 'INVOICE_LOOKUP_FAILED' });
  if (existing.data) return res.status(409).json({ error: 'QUOTE_ALREADY_INVOICED', invoiceId: existing.data.id });

  const parsedItems = documentItems.parse(items.map((item: any) => ({ description: item.description, quantity: Number(item.quantity), unit_price_cents: Number(item.unit_price_cents), gst_rate: item.gst_rate === 0 ? 0 : 0.1 })));
  const totals = calculateDocument(parsedItems);
  const { data: invoice, error: invoiceError } = await db.from('invoices').insert({
    workspace_id: req.workspaceId!, customer_id: quote.customer_id, job_id: quote.job_id, quote_id: quote.id,
    subtotal_cents: totals.subtotal, gst_cents: totals.gst, total_cents: totals.subtotal + totals.gst,
    balance_due_cents: totals.subtotal + totals.gst, status: 'draft',
  }).select('*').single();
  if (invoiceError) return res.status(400).json({ error: 'INVOICE_CREATE_FAILED', message: invoiceError.message });
  const rows = parsedItems.map((item, index) => ({ ...item, workspace_id: req.workspaceId!, invoice_id: invoice.id, sort_order: index }));
  const { error: itemError } = await db.from('invoice_items').insert(rows);
  if (itemError) {
    await db.from('invoices').delete().eq('workspace_id', req.workspaceId!).eq('id', invoice.id);
    return res.status(400).json({ error: 'INVOICE_ITEMS_CREATE_FAILED' });
  }
  await writeAudit(req, 'quote.converted_to_invoice', 'invoice', invoice.id, { quote_id: quote.id, quote_number: quote.quote_number });
  res.status(201).json({ invoice });
}));

router.get('/invoices', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('invoices').select('id,invoice_number,status,total_cents,amount_paid_cents,balance_due_cents,due_at,created_at,customer_id,customers(display_name),job_id').eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: 'INVOICE_LIST_FAILED' });
  res.json({ invoices: data ?? [] });
}));

router.post('/invoices', requireRole('owner','admin','manager','staff'), validateBody(z.object({
  customer_id: z.string().uuid(),
  job_id: z.string().uuid().nullable().optional(),
  quote_id: z.string().uuid().nullable().optional(),
  due_at: z.string().datetime().nullable().optional(),
  items: documentItems,
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const parentError = await verifyDocumentParents(db, req.workspaceId!, req.body.customer_id, req.body.job_id);
  if (parentError) return res.status(404).json({ error: parentError });
  if(req.body.quote_id){const {data:quote}=await db.from('quotes').select('id,customer_id').eq('workspace_id',req.workspaceId!).eq('id',req.body.quote_id).maybeSingle();if(!quote||quote.customer_id!==req.body.customer_id)return res.status(404).json({error:'QUOTE_NOT_FOUND'});}
  const totals = calculateDocument(req.body.items);
  const totalCents = totals.subtotal + totals.gst;
  const { data:invoice,error }=await db.from('invoices').insert({workspace_id:req.workspaceId!,customer_id:req.body.customer_id,job_id:req.body.job_id||null,quote_id:req.body.quote_id||null,due_at:req.body.due_at||null,subtotal_cents:totals.subtotal,gst_cents:totals.gst,total_cents:totalCents,balance_due_cents:totalCents,status:'draft'}).select('*').single();
  if(error)return res.status(400).json({error:'INVOICE_CREATE_FAILED',message:error.message});
  const rows=req.body.items.map((item:any,index:number)=>({...item,workspace_id:req.workspaceId!,invoice_id:invoice.id,sort_order:index}));
  const {error:itemError}=await db.from('invoice_items').insert(rows);
  if(itemError){await db.from('invoices').delete().eq('workspace_id',req.workspaceId!).eq('id',invoice.id);return res.status(400).json({error:'INVOICE_ITEMS_CREATE_FAILED'});}
  await writeAudit(req,'invoice.created','invoice',invoice.id,{total_cents:totalCents,item_count:rows.length});
  res.status(201).json({invoice});
}));

router.patch('/invoices/:id/send', requireRole('owner','admin','manager','staff'), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: invoice, error: readError } = await db.from('invoices').select('id,invoice_number,status,balance_due_cents,due_at,total_cents,customer_id,customers(display_name,email)')
    .eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'INVOICE_READ_FAILED' });
  if (!invoice) return res.status(404).json({ error: 'INVOICE_NOT_FOUND' });
  if (invoice.status !== 'draft') return res.status(409).json({ error: 'INVOICE_NOT_SENDABLE', status: invoice.status });
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await db.from('invoices').update({ status: 'sent', sent_at: now, updated_at: now })
    .eq('id', invoice.id).eq('workspace_id', req.workspaceId!).eq('status', 'draft').select('id,invoice_number,status,sent_at').single();
  if (updateError || !updated) return res.status(409).json({ error: 'INVOICE_SEND_CONFLICT' });

  let delivery: 'sent' | 'not_configured' | 'no_customer_email' | 'failed' = 'not_configured';
  let paymentUrl: string | null = null;
  const customer = Array.isArray(invoice.customers) ? invoice.customers[0] : invoice.customers;
  if (emailConfigured() && customer?.email) {
    const dueText = invoice.due_at ? ` Payment is due by ${new Date(invoice.due_at).toLocaleDateString('en-AU')}.` : '';
    if (stripe && Number(invoice.balance_due_cents) > 0) {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price_data: { currency: 'aud', product_data: { name: `Invoice #${invoice.invoice_number}` }, unit_amount: Number(invoice.balance_due_cents) }, quantity: 1 }],
        customer_email: customer.email || undefined,
        client_reference_id: invoice.id,
        metadata: { workspace_id: req.workspaceId!, invoice_id: invoice.id, customer_id: invoice.customer_id, amount_cents: String(invoice.balance_due_cents) },
        payment_intent_data: { metadata: { workspace_id: req.workspaceId!, invoice_id: invoice.id, customer_id: invoice.customer_id } },
        success_url: `${env.APP_URL}/payment-complete?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.APP_URL}/payment-cancelled`,
      }, { idempotencyKey: `invoice-send:${req.workspaceId}:${invoice.id}:${invoice.balance_due_cents}` });
      paymentUrl = session.url ?? null;
    }
    const result = await sendEmail({
      to: customer.email,
      subject: `Invoice #${invoice.invoice_number}`,
      text: `Hi ${customer?.display_name || 'there'},\n\nInvoice #${invoice.invoice_number} for $${(Number(invoice.total_cents) / 100).toFixed(2)} is ready.${dueText}${paymentUrl ? `\n\nPay securely online here:\n${paymentUrl}` : ''}\n\nThank you for your business.`,
    });
    delivery = result.delivered ? 'sent' : 'failed';
  } else if (emailConfigured()) {
    delivery = 'no_customer_email';
  }

  await writeAudit(req, 'invoice.sent', 'invoice', invoice.id, { delivery });
  res.json({ invoice: updated, delivery, paymentUrl });
}));

router.get('/payments', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('payments').select('id,amount_cents,currency,status,paid_at,created_at,customer_id,customers(display_name),invoice_id').eq('workspace_id', req.workspaceId!).order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: 'PAYMENT_LIST_FAILED' });
  res.json({ payments: data ?? [] });
}));

router.post('/invoices/:id/checkout', requireRole('owner','admin','manager'), requireSensitiveAuth, asyncRoute(async (req: AuthenticatedRequest, res) => {
  if (!stripe) return res.status(503).json({ error:'STRIPE_NOT_CONFIGURED' });
  const providedKey=String(req.header('idempotency-key')||'');
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(providedKey))return res.status(400).json({error:'VALID_IDEMPOTENCY_KEY_REQUIRED'});
  const db=createUserClient(req.auth!.accessToken);
  const {data:invoice,error}=await db.from('invoices').select('id,invoice_number,status,balance_due_cents,customer_id,customers(display_name,email)').eq('workspace_id',req.workspaceId!).eq('id',req.params.id).maybeSingle();
  if(error||!invoice)return res.status(404).json({error:'INVOICE_NOT_FOUND'});
  if(!invoice.customer_id)return res.status(409).json({error:'INVOICE_CUSTOMER_REQUIRED'});
  if(!['draft','sent','viewed','part_paid','overdue'].includes(invoice.status)||Number(invoice.balance_due_cents)<=0)return res.status(409).json({error:'INVOICE_NOT_PAYABLE'});
  const customer=Array.isArray(invoice.customers)?invoice.customers[0]:invoice.customers;
  const amount=Number(invoice.balance_due_cents);
  if(!Number.isSafeInteger(amount)||amount<=0)return res.status(409).json({error:'INVALID_INVOICE_BALANCE'});
  const session=await stripe.checkout.sessions.create({
    mode:'payment',
    line_items:[{price_data:{currency:'aud',product_data:{name:`Jobryn invoice #${invoice.invoice_number}`,description:'Secure invoice payment'},unit_amount:amount},quantity:1}],
    customer_email:customer?.email||undefined,
    client_reference_id:invoice.id,
    metadata:{workspace_id:req.workspaceId!,invoice_id:invoice.id,customer_id:invoice.customer_id,amount_cents:String(amount)},
    payment_intent_data:{metadata:{workspace_id:req.workspaceId!,invoice_id:invoice.id,customer_id:invoice.customer_id}},
    success_url:`${env.APP_URL}/payment-complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:`${env.APP_URL}/payment-cancelled`,
    integration_identifier:'jobryn_pay_fhwktzpn',
  // A deterministic Stripe key returns the same live session for this invoice
  // balance, preventing two payment links from charging the same balance.
  },{idempotencyKey:`invoice-checkout:${req.workspaceId}:${invoice.id}:${amount}`});
  if(!session.url)return res.status(502).json({error:'STRIPE_CHECKOUT_URL_MISSING'});
  await writeAudit(req,'invoice.checkout.created','invoice',invoice.id,{amount_cents:amount});
  res.json({checkoutUrl:session.url,expiresAt:session.expires_at?new Date(session.expires_at*1000).toISOString():null});
}));

export default router;
