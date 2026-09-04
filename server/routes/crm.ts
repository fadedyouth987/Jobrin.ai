import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, type AuthenticatedRequest, writeAudit } from '../supabase';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('crm.core'));

function normalizePhone(value?: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('61')) return `+${digits}`;
  if (digits.startsWith('0')) return `+61${digits.slice(1)}`;
  return digits ? `+${digits}` : null;
}

const customerInput = z.object({
  first_name: z.string().trim().max(100).default(''),
  last_name: z.string().trim().max(100).default(''),
  display_name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  source: z.string().trim().max(100).nullable().optional(),
  notes: z.string().trim().max(5000).default(''),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
});

router.get('/customers', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const search = String(req.query.search || '').trim().slice(0, 120);
  let query = db.from('customers')
    .select('id,first_name,last_name,display_name,phone,email,source,tags,lifetime_value_cents,last_activity_at,created_at')
    .eq('workspace_id', req.workspaceId!)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (search) query = query.or(`display_name.ilike.%${search.replace(/[%_,]/g, '')}%,email.ilike.%${search.replace(/[%_,]/g, '')}%,phone.ilike.%${search.replace(/[%_,]/g, '')}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'CUSTOMER_LIST_FAILED' });
  res.json({ customers: data ?? [] });
}));

router.get('/customers/:id', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const workspaceId = req.workspaceId!;
  const { data: customer, error: customerError } = await db.from('customers').select('*').eq('workspace_id', workspaceId).eq('id', req.params.id).is('deleted_at', null).maybeSingle();
  if (customerError) return res.status(500).json({ error: 'CUSTOMER_READ_FAILED' });
  if (!customer) return res.status(404).json({ error: 'CUSTOMER_NOT_FOUND' });
  const [addresses, leads, jobs, quotes, invoices, payments, calls] = await Promise.all([
    db.from('customer_addresses').select('*').eq('workspace_id', workspaceId).eq('customer_id', customer.id).order('created_at'),
    db.from('leads').select('id,title,stage,source,estimated_value_cents,created_at').eq('workspace_id', workspaceId).eq('customer_id', customer.id).is('deleted_at', null).order('created_at', { ascending: false }),
    db.from('jobs').select('id,job_number,title,status,scheduled_start,completed_at,created_at').eq('workspace_id', workspaceId).eq('customer_id', customer.id).order('created_at', { ascending: false }),
    db.from('quotes').select('id,quote_number,status,total_cents,created_at').eq('workspace_id', workspaceId).eq('customer_id', customer.id).order('created_at', { ascending: false }),
    db.from('invoices').select('id,invoice_number,status,total_cents,balance_due_cents,due_at,created_at').eq('workspace_id', workspaceId).eq('customer_id', customer.id).order('created_at', { ascending: false }),
    db.from('payments').select('id,status,amount_cents,paid_at,created_at').eq('workspace_id', workspaceId).eq('customer_id', customer.id).order('created_at', { ascending: false }),
    db.from('calls').select('id,direction,status,from_number,to_number,started_at,ended_at,summary').eq('workspace_id', workspaceId).eq('customer_id', customer.id).order('started_at', { ascending: false }).limit(50),
  ]);
  const relatedError = [addresses.error, leads.error, jobs.error, quotes.error, invoices.error, payments.error, calls.error].find(Boolean);
  if (relatedError) return res.status(500).json({ error: 'CUSTOMER_RELATED_READ_FAILED' });
  res.json({ customer, addresses: (addresses.data ?? []).map((address: any) => ({ ...address, street: [address.line1, address.line2].filter(Boolean).join(', ') })), leads: leads.data ?? [], jobs: jobs.data ?? [], quotes: quotes.data ?? [], invoices: invoices.data ?? [], payments: payments.data ?? [], calls: calls.data ?? [] });
}));

router.post('/customers', requireRole('owner','admin','manager','staff'), validateBody(customerInput), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const displayName = req.body.display_name || `${req.body.first_name} ${req.body.last_name}`.trim() || req.body.email || req.body.phone || 'Customer';
  const payload = {
    ...req.body,
    workspace_id: req.workspaceId!,
    display_name: displayName,
    normalized_phone: normalizePhone(req.body.phone),
    normalized_email: req.body.email?.trim().toLowerCase() || null,
  };
  const { data, error } = await db.from('customers').insert(payload).select('*').single();
  if (error) {
    if (/duplicate/i.test(error.message)) return res.status(409).json({ error: 'CUSTOMER_DUPLICATE' });
    return res.status(400).json({ error: 'CUSTOMER_CREATE_FAILED', message: error.message });
  }
  await writeAudit(req, 'customer.created', 'customer', data.id);
  res.status(201).json({ customer: data });
}));

const leadInput = z.object({
  customer_id: z.string().uuid().nullable().optional(),
  service_id: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).default(''),
  source: z.string().trim().max(100).nullable().optional(),
  estimated_value_cents: z.number().int().min(0).max(100_000_000).nullable().optional(),
});

router.get('/leads', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const stage = String(req.query.stage || '').trim();
  let query = db.from('leads')
    .select('id,title,description,stage,source,estimated_value_cents,owner_user_id,created_at,updated_at,customer_id,customers(display_name,phone,email),service_id,services(name)')
    .eq('workspace_id', req.workspaceId!)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (stage) query = query.eq('stage', stage);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'LEAD_LIST_FAILED' });
  res.json({ leads: data ?? [] });
}));

router.post('/leads', requireRole('owner','admin','manager','staff'), validateBody(leadInput), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('leads').insert({ ...req.body, workspace_id: req.workspaceId!, created_by: req.auth!.userId }).select('*').single();
  if (error) return res.status(400).json({ error: 'LEAD_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'lead.created', 'lead', data.id);
  res.status(201).json({ lead: data });
}));

const allowedTransitions: Record<string, string[]> = {
  new: ['contacted','qualified','lost','spam','cancelled'],
  contacted: ['qualified','quote','lost','cancelled'],
  qualified: ['quote','booked','lost','cancelled'],
  quote: ['booked','won','lost','cancelled'],
  booked: ['won','completed','cancelled'],
  won: ['completed','cancelled'],
  completed: [], lost: ['new'], cancelled: ['new'], spam: [],
};

router.patch('/leads/:id/stage', requireRole('owner','admin','manager','staff'), validateBody(z.object({ stage: z.enum(['new','contacted','qualified','quote','booked','won','completed','lost','cancelled','spam']) })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data: current, error: readError } = await db.from('leads').select('id,stage').eq('workspace_id', req.workspaceId!).eq('id', req.params.id).maybeSingle();
  if (readError) return res.status(500).json({ error: 'LEAD_READ_FAILED' });
  if (!current) return res.status(404).json({ error: 'LEAD_NOT_FOUND' });
  if (!(allowedTransitions[current.stage] || []).includes(req.body.stage)) return res.status(409).json({ error: 'INVALID_LEAD_TRANSITION', from: current.stage, to: req.body.stage });
  const { data, error } = await db.from('leads').update({ stage: req.body.stage, updated_at: new Date().toISOString() }).eq('workspace_id', req.workspaceId!).eq('id', req.params.id).select('*').single();
  if (error) return res.status(400).json({ error: 'LEAD_UPDATE_FAILED' });
  await writeAudit(req, 'lead.stage.changed', 'lead', data.id, { from: current.stage, to: req.body.stage });
  res.json({ lead: data });
}));

export default router;
