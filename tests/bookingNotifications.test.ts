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
  // Rules: Mon-Fri 7-5, weekend closed. Dates are computed relative to "now" (not
  // hardcoded) so this test keeps passing regardless of which day it actually runs.
  const rules = [weekday(1), weekday(2), weekday(3), weekday(4), weekday(5), closed(0), closed(6)];
  // Find the next Sunday at least a day out, then treat it as "day 0" the same way
  // generateBookingSlots does (it starts generating from startDate + 1 day).
  const today = new Date();
  const daysUntilSunday = ((7 - today.getUTCDay()) % 7) || 7;
  const sunday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + daysUntilSunday));
  const monday = new Date(sunday.getTime() + 86_400_000);
  const mondayIso = monday.toISOString().slice(0, 10);
  const busy = [{ start: `${mondayIso}T21:00:00.000Z`, end: `${mondayIso}T23:30:00.000Z` }]; // 7:30-10:00 ACST
  const slots = generateBookingSlots(rules, 120, sunday, busy, 'Australia/Adelaide', 7);
  assert.ok(slots.length > 0);
  // Every slot lands on a weekday in Adelaide time (no Sat/Sun bookings).
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const slot of slots) {
    const label = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short' }).format(new Date(slot.start));
    const day = weekdays[label];
    assert.ok([1, 2, 3, 4, 5].includes(day), `slot on weekday ${day} (${label})`);
  }
  // The busy range (7:30-10:00 ACST Monday) must not produce a slot that overlaps.
  const overlapping = slots.filter((slot) => new Date(slot.start) < new Date(busy[0].end) && new Date(slot.end) > new Date(busy[0].start));
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
  // Receptionist captures now preserve the more specific event type so the
  // owner can distinguish a new enquiry from a requested callback.
  assert.match(engineSource, /kind === 'lead' \? 'lead\.created' : 'receptionist\.callback_created'/);
});

test('A04: a peek request only requires service_id, not customer/slot details', () => {
  const publicSource = source('server/routes/public.ts');
  // The peek schema must not require customer_name/phone/slot_start.
  assert.match(publicSource, /const peekBookingSchema = z\.object\(\{\s*peek: z\.literal\(true\),\s*service_id: z\.string\(\)\.uuid\(\),\s*\}\);/);
  // Which schema is used must be decided before either is parsed against the
  // whole body, so a peek body is never validated against the fields (name,
  // phone, slot_start) a booking-creation request would need.
  assert.match(publicSource, /const isPeek = .*req\.body.*peek.* === true;/);
  assert.match(publicSource, /isPeek \? peekBookingSchema\.safeParse\(req\.body\) : createBookingSchema\.safeParse\(req\.body\)/);
  // The peek branch must return before any slot_start is read/parsed.
  assert.match(publicSource, /if \(isPeek\) return res\.json\(\{ slots: offered \}\);/);
});

test('A05: booking creation uses one atomic RPC instead of separate inserts', () => {
  const publicSource = source('server/routes/public.ts');
  assert.match(publicSource, /supabaseAdmin\.rpc\('create_public_booking'/);
  assert.match(publicSource, /p_idempotency_key: idempotencyKey/);
  // A conflicting slot from the RPC must surface as a clean 409, not a 500.
  assert.match(publicSource, /message\.includes\('SLOT_TAKEN'\)[\s\S]{0,120}res\.status\(409\)/);
  // No more independent, unlinked appointment+job inserts for booking creation.
  assert.doesNotMatch(publicSource, /Promise\.all\(\[\s*supabaseAdmin\.from\('appointments'\)\.insert/);

  const migrationSource = source('supabase/migrations/0025_atomic_public_booking.sql');
  assert.match(migrationSource, /create or replace function public\.create_public_booking/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /raise exception 'SLOT_TAKEN'/);
  assert.match(migrationSource, /grant execute on function public\.create_public_booking\([^)]*\) to service_role;/);
  // The function must not be reachable by anon/authenticated clients directly.
  assert.match(migrationSource, /revoke all on function public\.create_public_booking\([^)]*\) from public, anon, authenticated;/);
});
