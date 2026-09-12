import { Router } from 'express';
import crypto from 'node:crypto';
import { normalizeE164 } from '../providers/twilio';
import { z } from 'zod';
import { asyncRoute } from '../security';
import { rateLimit } from 'express-rate-limit';
import { TimerFreeMemoryStore } from '../rateLimitStore';
import { supabaseAdmin } from '../supabase';

// Public customer-facing document links. Capability is the unguessable token in
// the URL; only its SHA-256 hash is stored, so a database leak cannot reveal
// live links. These routes never require a user session and return the minimum
// fields a customer needs to review the quote — never internal notes.

export function hashShareToken(token: string) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export const quoteDecisionTransitions: Record<string, string[]> = {
  sent: ['accepted', 'declined'],
  viewed: ['accepted', 'declined'],
};

export function canDecideQuote(from: string, to: string) {
  return (quoteDecisionTransitions[from] ?? []).includes(to);
}

export const publicRateLimit = rateLimit({
  store: new TimerFreeMemoryStore(),
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const router = Router();
router.use(publicRateLimit);

function linkNotFound(res: { status: (code: number) => { json: (body: unknown) => unknown } }) {
  return res.status(404).json({ error: 'LINK_NOT_FOUND' });
}

router.get('/quotes/:token', asyncRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return linkNotFound(res);

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select('id,workspace_id,quote_number,status,subtotal_cents,gst_cents,total_cents,deposit_cents,expires_at,terms,sent_at,accepted_at')
    .eq('public_token_hash', hashShareToken(token))
    .maybeSingle();
  if (error || !quote) return linkNotFound(res);

  const [itemsResult, profileResult] = await Promise.all([
    supabaseAdmin.from('quote_items').select('description,quantity,unit_price_cents,gst_rate,sort_order').eq('workspace_id', quote.workspace_id).eq('quote_id', quote.id).order('sort_order'),
    supabaseAdmin.from('business_profiles').select('trading_name,phone,email,website').eq('workspace_id', quote.workspace_id).maybeSingle(),
  ]);
  if (itemsResult.error || profileResult.error) return res.status(500).json({ error: 'QUOTE_LINK_READ_FAILED' });

  // Mark the quote as viewed exactly once, without blocking the customer view.
  if (quote.status === 'sent') {
    await supabaseAdmin.from('quotes').update({ status: 'viewed', viewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', quote.id).eq('workspace_id', quote.workspace_id).eq('status', 'sent');
    await supabaseAdmin.from('audit_logs').insert({
      workspace_id: quote.workspace_id, action: 'quote.customer_viewed', entity_type: 'quote', entity_id: quote.id, details: { via: 'public_link' },
    });
    quote.status = 'viewed';
  }

  res.json({
    quote: {
      quote_number: quote.quote_number,
      status: quote.status,
      subtotal_cents: quote.subtotal_cents,
      gst_cents: quote.gst_cents,
      total_cents: quote.total_cents,
      deposit_cents: quote.deposit_cents,
      expires_at: quote.expires_at,
      terms: quote.terms,
      sent_at: quote.sent_at,
      accepted_at: quote.accepted_at,
    },
    items: itemsResult.data ?? [],
    business: profileResult.data ?? {},
  });
}));

router.post('/quotes/:token/decision', asyncRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return linkNotFound(res);
  const parsed = z.object({ decision: z.enum(['accepted', 'declined']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_FAILED' });

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select('id,workspace_id,status,accepted_at,quote_number')
    .eq('public_token_hash', hashShareToken(token))
    .maybeSingle();
  if (error || !quote) return linkNotFound(res);

  // Idempotent: a repeated accept/decline returns the current state instead of
  // erroring or double-recording.
  if (['accepted', 'declined'].includes(quote.status)) {
    return res.json({ status: quote.status, acceptedAt: quote.accepted_at });
  }
  if (!canDecideQuote(quote.status, parsed.data.decision)) {
    return res.status(409).json({ error: 'QUOTE_NOT_DECIDABLE', status: quote.status });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('quotes')
    .update({ status: parsed.data.decision, accepted_at: parsed.data.decision === 'accepted' ? now : null, updated_at: now })
    .eq('id', quote.id).eq('workspace_id', quote.workspace_id)
    .in('status', ['sent', 'viewed'])
    .select('status,accepted_at').single();
  if (updateError || !updated) return res.status(409).json({ error: 'QUOTE_DECISION_CONFLICT' });

  await supabaseAdmin.from('audit_logs').insert({
    workspace_id: quote.workspace_id, action: `quote.customer_${parsed.data.decision}`, entity_type: 'quote',
    entity_id: quote.id, details: { via: 'public_link', quote_number: quote.quote_number },
  });

  res.json({ status: updated.status, acceptedAt: updated.accepted_at });
}));

// ---------- Public booking ----------

export type BusinessHourRule = { weekday: number; opens_at: string | null; closes_at: string | null; closed: boolean };

function tzOffsetMinutes(timeZone: string, instant: Date): number {
  try {
    const part = new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const match = part.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!match) return 0;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3]));
  } catch {
    return 0;
  }
}

function localWall(timeZone: string, instant: Date): { hours: number; minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' })
    .formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hours = Number(get('hour')) % 24;
  const minutes = Number(get('minute'));
  return { hours, minutes, weekday: weekdays[get('weekday')] ?? 0 };
}

// Deterministic slot generation: business hours by local weekday, service
// duration as the step, busy ranges excluded. DST is handled by comparing the
// actual local wall time of every candidate instant.
export function generateBookingSlots(
  rules: BusinessHourRule[],
  durationMinutes: number,
  startDate: Date,
  busyRanges: Array<{ start: string; end: string }>,
  timeZone = 'Australia/Adelaide',
  days = 14,
): Array<{ start: string; end: string }> {
  const slots: Array<{ start: string; end: string }> = [];
  const stepMinutes = Math.max(15, Math.min(240, Math.round(durationMinutes)));
  const now = Date.now();
  for (let day = 1; day <= days; day++) {
    const local = new Date(startDate.getTime() + day * 86_400_000);
    const y = local.getFullYear();
    const m = local.getMonth();
    const d = local.getDate();
    const noonOffset = tzOffsetMinutes(timeZone, new Date(Date.UTC(y, m, d, 12, 0)));
    for (let minute = 0; minute < 24 * 60; minute += stepMinutes) {
      // Candidate instant whose local wall time is (y, m, d) + minute.
      const instant = new Date(Date.UTC(y, m, d, Math.floor(minute / 60), minute % 60) - noonOffset * 60_000);
      if (instant.getTime() < now + 30 * 60_000) continue;
      const wall = localWall(timeZone, instant);
      const rule = rules.find((r) => r.weekday === wall.weekday && !r.closed);
      if (!rule || !rule.opens_at || !rule.closes_at) continue;
      const [oh, om] = rule.opens_at.split(':').map(Number);
      const [ch, cm] = rule.closes_at.split(':').map(Number);
      const wallMinutes = wall.hours * 60 + wall.minutes;
      const openMinutes = oh * 60 + om;
      const closeMinutes = ch * 60 + cm;
      if (wallMinutes < openMinutes || wallMinutes + stepMinutes > closeMinutes) continue;
      const end = new Date(instant.getTime() + durationMinutes * 60_000);
      const overlaps = busyRanges.some((range) => instant < new Date(range.end) && end > new Date(range.start));
      if (overlaps) continue;
      slots.push({ start: instant.toISOString(), end: end.toISOString() });
    }
  }
  return slots.slice(0, 120);
}

router.get('/book/:slug', asyncRoute(async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{3,63}$/.test(slug)) return res.status(404).json({ error: 'BUSINESS_NOT_FOUND' });
  const { data: workspace } = await supabaseAdmin.from('workspaces').select('id,name,slug').eq('slug', slug).maybeSingle();
  if (!workspace) return res.status(404).json({ error: 'BUSINESS_NOT_FOUND' });
  const [profileResult, servicesResult, rulesResult] = await Promise.all([
    supabaseAdmin.from('business_profiles').select('trading_name,phone,suburb,state').eq('workspace_id', workspace.id).maybeSingle(),
    supabaseAdmin.from('services').select('id,name,description,default_duration_minutes,requires_deposit,deposit_cents').eq('workspace_id', workspace.id).eq('booking_type', 'bookable').order('name'),
    supabaseAdmin.from('business_hours').select('weekday,opens_at,closes_at,closed').eq('workspace_id', workspace.id).in('schedule_type', ['booking', 'business']),
  ]);
  const services = (servicesResult.data ?? []).filter((service: any) => service.default_duration_minutes != null);
  res.json({
    business: { name: profileResult.data?.trading_name || workspace.name, phone: profileResult.data?.phone || null, suburb: profileResult.data?.suburb || null, state: profileResult.data?.state || null },
    services,
    hours: (rulesResult.data ?? []) as BusinessHourRule[],
  });
}));

// A peek request only checks available times for a service — no customer
// details or chosen time exist yet, so those fields must not be required.
// A real booking-creation request needs the customer's name, phone and the
// slot they picked. Using the `peek` flag to pick between two schemas (rather
// than one schema with universally-required fields) keeps each request kind
// validated against only the fields it actually sends.
const peekBookingSchema = z.object({
  peek: z.literal(true),
  service_id: z.string().uuid(),
});
const createBookingSchema = z.object({
  peek: z.literal(false).optional(),
  service_id: z.string().uuid(),
  customer_name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(40),
  email: z.string().trim().email().max(254).nullable().optional(),
  address_text: z.string().trim().max(500).nullable().optional(),
  slot_start: z.string().datetime(),
});

router.post('/book/:slug', asyncRoute(async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!/^[a-z0-9-]{3,63}$/.test(slug)) return res.status(404).json({ error: 'BUSINESS_NOT_FOUND' });
  const isPeek = !!req.body && typeof req.body === 'object' && (req.body as Record<string, unknown>).peek === true;
  const parsed = isPeek ? peekBookingSchema.safeParse(req.body) : createBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_FAILED' });

  const { data: workspace } = await supabaseAdmin.from('workspaces').select('id,name,slug').eq('slug', slug).maybeSingle();
  if (!workspace) return res.status(404).json({ error: 'BUSINESS_NOT_FOUND' });
  const { data: service } = await supabaseAdmin.from('services').select('id,name,default_duration_minutes,booking_type,requires_deposit,deposit_cents').eq('workspace_id', workspace.id).eq('id', parsed.data.service_id).maybeSingle();
  if (!service || service.booking_type !== 'bookable') return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });

  // Slot search always defaults to "starting now, next N days" — a peek
  // request has no slot_start to validate, and shouldn't need one just to
  // find out what times are available.
  const [rulesResult, busyAppointments, busyJobs] = await Promise.all([
    supabaseAdmin.from('business_hours').select('weekday,opens_at,closes_at,closed').eq('workspace_id', workspace.id).in('schedule_type', ['booking', 'business']),
    supabaseAdmin.from('appointments').select('starts_at,ends_at').eq('workspace_id', workspace.id).in('status', ['hold', 'scheduled', 'confirmed']).gte('starts_at', new Date(Date.now() - 86_400_000).toISOString()),
    supabaseAdmin.from('jobs').select('scheduled_start,scheduled_end').eq('workspace_id', workspace.id).not('scheduled_start', 'is', null).in('status', ['new', 'scheduled', 'on_the_way', 'in_progress']),
  ]);
  const busyRanges = [
    ...(busyAppointments.data ?? []).map((row: any) => ({ start: row.starts_at, end: row.ends_at })),
    ...(busyJobs.data ?? []).filter((row: any) => row.scheduled_end).map((row: any) => ({ start: row.scheduled_start, end: row.scheduled_end })),
  ];
  const offered = generateBookingSlots((rulesResult.data ?? []) as BusinessHourRule[], Number(service.default_duration_minutes || 60), new Date(), busyRanges);
  if (isPeek) return res.json({ slots: offered });

  const input = (parsed as z.SafeParseSuccess<z.infer<typeof createBookingSchema>>).data;
  const slotStart = new Date(input.slot_start);
  const slotEnd = new Date(slotStart.getTime() + Number(service.default_duration_minutes || 60) * 60_000);
  if (Number.isNaN(slotStart.getTime())) return res.status(400).json({ error: 'INVALID_SLOT' });
  if (!offered.some((slot) => slot.start === slotStart.toISOString())) {
    return res.status(409).json({ error: 'SLOT_TAKEN', message: 'That time was just booked. Please choose another time.' });
  }

  const phone = normalizeE164(input.phone);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return res.status(400).json({ error: 'VALIDATION_FAILED' });

  // The customer/appointment/job creation, plus the atomic slot-conflict
  // recheck, all happen inside one Postgres function so a partial failure
  // can't leave an orphan row and two concurrent requests for the same slot
  // can't both succeed (appointments_no_staff_overlap only guards rows with
  // assigned_user_id set, which public bookings never have).
  const idempotencyKey = crypto.createHash('sha256')
    .update(`${workspace.id}:${phone}:${slotStart.toISOString()}`, 'utf8')
    .digest('hex');
  const { data: booking, error: bookingError } = await supabaseAdmin.rpc('create_public_booking', {
    p_workspace_id: workspace.id,
    p_service_id: service.id,
    p_customer_name: input.customer_name,
    p_phone: input.phone,
    p_normalized_phone: phone,
    p_email: input.email || null,
    p_address_text: input.address_text || null,
    p_starts_at: slotStart.toISOString(),
    p_ends_at: slotEnd.toISOString(),
    p_idempotency_key: idempotencyKey,
  }).single() as { data: { appointment_id: string; job_id: string; customer_id: string } | null; error: { message: string } | null };

  if (bookingError || !booking) {
    const message = bookingError?.message || '';
    if (message.includes('SLOT_TAKEN')) {
      return res.status(409).json({ error: 'SLOT_TAKEN', message: 'That time was just booked. Please choose another time.' });
    }
    if (message.includes('SERVICE_NOT_FOUND')) return res.status(404).json({ error: 'SERVICE_NOT_FOUND' });
    return res.status(500).json({ error: 'BOOKING_CREATE_FAILED' });
  }

  await supabaseAdmin.from('audit_logs').insert({
    workspace_id: workspace.id, action: 'booking.public_created', entity_type: 'appointment', entity_id: booking.appointment_id ?? null,
    details: { via: 'public_booking', service: service.name }, ip_address: req.ip,
  });
  try {
    await supabaseAdmin.from('notifications').insert({
      workspace_id: workspace.id, type: 'booking.created',
      title: 'New online booking', body: `${input.customer_name} booked ${service.name} at ${slotStart.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`,
      resource_type: 'appointment', resource_id: booking.appointment_id ?? null,
    });
  } catch { /* best-effort */ }

  res.status(201).json({
    confirmed: true,
    serviceName: service.name,
    start: slotStart.toISOString(),
    end: slotEnd.toISOString(),
    business: { name: workspace.name },
    note: 'The business has your booking and will confirm any details by phone or SMS.',
  });
}));

export default router;