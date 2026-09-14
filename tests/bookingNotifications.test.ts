import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateBookingSlots, type BusinessHourRule } from '../server/routes/public';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

const weekday = (name: number): BusinessHourRule => ({ weekday: name, opens_at: '07:00', closes_at: '17:00', closed: false });
const closed = (name: number): BusinessHourRule => ({ weekday: name, opens_at: null, closes_at: null, closed: true });

test('booking slots respect business hours, duration and exclusions', () => {
  // Anchor the window to the next Sunday, strictly in the future: the slot
  // generator filters out past instants, so a fixed historical date would make
  // this test a time bomb that fails every Friday evening.
  const now = new Date();
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  anchor.setUTCDate(anchor.getUTCDate() + (((7 - anchor.getUTCDay()) % 7) || 7));
  const rules = [weekday(1), weekday(2), weekday(3), weekday(4), weekday(5), closed(0), closed(6)];
  // A 2.5-hour busy block that starts inside the first business morning.
  const busy = [
    { start: new Date(anchor.getTime() + 21 * 3_600_000).toISOString(), end: new Date(anchor.getTime() + 23.5 * 3_600_000).toISOString() },
  ];
  const slots = generateBookingSlots(rules, 120, anchor, busy, 'Australia/Adelaide', 7);
  assert.ok(slots.length > 0);
  // Every slot lands on a weekday in Adelaide time (no Sat/Sun bookings).
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const slot of slots) {
    const label = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short' }).format(new Date(slot.start));
    const day = weekdays[label];
    assert.ok([1, 2, 3, 4, 5].includes(day), `slot on weekday ${day} (${label})`);
  }
  // The busy block must not produce a slot that overlaps it.
  const busyStart = new Date(busy[0].start);
  const busyEnd = new Date(busy[0].end);
  const overlapping = slots.filter((slot) => new Date(slot.start) < busyEnd && new Date(slot.end) > busyStart);
  assert.equal(overlapping.length, 0);
  // Slots are never shorter than the service duration.
  for (const slot of slots) {
    const minutes = (new Date(slot.end).getTime() - new Date(slot.start).getTime()) / 60_000;
    assert.equal(minutes, 120);
  }
});

test('booking endpoints are public, rate limited and validate input', () => {
  const publicSource = source('server/routes/public.ts');
  assert.match(publicSource, /router\.get\('\/book\/:slug'/);
  assert.match(publicSource, /router\.post\('\/book\/:slug'/);
  assert.match(publicSource, /SLOT_TAKEN/);
  assert.match(publicSource, /generateBookingSlots/);
  // Bookings create a notification for the owner.
  assert.match(publicSource, /New online booking/);
  const notificationsSource = source('server/routes/notifications.ts');
  assert.match(notificationsSource, /requireActiveSubscription\('crm\.core'\)/);
  assert.match(notificationsSource, /read-all/);
  // Writers exist where the events happen.
  const crmSource = source('server/routes/crm.ts');
  assert.match(crmSource, /writeNotification\(req\.workspaceId!, 'lead\.created'/);
  const engineSource = source('server/ai/receptionistCall.ts');
  assert.match(engineSource, /writeNotification\(context\.workspaceId, 'receptionist\.message_taken'/);
});

test('a peek request only requires service_id, never name/phone/slot_start', () => {
  const publicSource = source('server/routes/public.ts');
  // The peek schema must not require customer_name, phone or slot_start —
  // otherwise a bare {peek:true, service_id} preview request 400s before it
  // ever reaches the `if (isPeek) return res.json({ slots: offered })` branch.
  const peekSchemaMatch = publicSource.match(/const peekSchema = z\.object\(\{[\s\S]*?\}\);/);
  assert.ok(peekSchemaMatch, 'expected a peekSchema definition in the booking handler');
  const peekSchema = peekSchemaMatch![0];
  assert.match(peekSchema, /peek:\s*z\.literal\(true\)/);
  assert.match(peekSchema, /service_id:\s*z\.string\(\)\.uuid\(\)/);
  assert.doesNotMatch(peekSchema, /customer_name/);
  assert.doesNotMatch(peekSchema, /phone/);
  assert.doesNotMatch(peekSchema, /slot_start/);

  // The full booking schema (used for real creation requests) must still
  // require the customer + slot fields.
  const bookSchemaMatch = publicSource.match(/const bookSchema = z\.object\(\{[\s\S]*?\}\);/);
  assert.ok(bookSchemaMatch, 'expected a bookSchema definition in the booking handler');
  const bookSchema = bookSchemaMatch![0];
  assert.match(bookSchema, /customer_name:\s*z\.string\(\)\.trim\(\)\.min\(2\)/);
  assert.match(bookSchema, /phone:\s*z\.string\(\)\.trim\(\)\.min\(8\)/);
  assert.match(bookSchema, /slot_start:\s*z\.string\(\)\.datetime\(\)/);

  // Which schema is used must be decided from the raw request body, before
  // validation runs, so a peek request cannot be routed into the strict schema.
  assert.match(publicSource, /const isPeek = \(req\.body as \{ peek\?: unknown \} \| undefined\)\?\.peek === true;/);
});

test('booking creation is atomic via the create_public_booking RPC, not separate inserts', () => {
  const publicSource = source('server/routes/public.ts');
  // The old bug: appointment and job were created via two independent
  // Promise.all inserts, with no transaction and no appointment_id on the job.
  assert.doesNotMatch(publicSource, /Promise\.all\(\[\s*supabaseAdmin\.from\('appointments'\)\.insert/);
  // The fix: a single atomic RPC call that does customer+appointment+job
  // creation (with the job linked to the new appointment) inside one
  // Postgres transaction, guarded by an advisory lock and idempotency key.
  assert.match(publicSource, /supabaseAdmin\.rpc\('create_public_booking',/);
  assert.match(publicSource, /target_booking_key: idempotencyKey/);
  assert.match(publicSource, /idempotencyKey = crypto\.createHash\('sha256'\)/);
  // A SLOT_TAKEN exception from Postgres must map to 409, not a generic 500.
  assert.match(publicSource, /if \(\/SLOT_TAKEN\/\.test\(bookingError\.message \|\| ''\)\)/);
  assert.match(publicSource, /res\.status\(409\)\.json\(\{ error: 'SLOT_TAKEN'/);

  // The migration must define the atomic, service_role-only function with the
  // appointment_id linkage, an advisory lock and a SLOT_TAKEN guard.
  const migrationSource = source('supabase/migrations/20260914000000_atomic_public_booking.sql');
  assert.match(migrationSource, /create or replace function public\.create_public_booking/);
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /raise exception 'SLOT_TAKEN'/);
  assert.match(migrationSource, /appointment_id, service_id, title, address_text/);
  assert.match(migrationSource, /revoke all on function public\.create_public_booking/);
  assert.match(migrationSource, /grant execute on function public\.create_public_booking\([^)]*\) to service_role;/);
  assert.match(migrationSource, /public_booking_key/);
});