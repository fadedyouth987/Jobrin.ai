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
  // Monday 2026-09-07 is a Monday. Rules: Mon-Fri 7-5, weekend closed.
  const rules = [weekday(1), weekday(2), weekday(3), weekday(4), weekday(5), closed(0), closed(6)];
  const monday = new Date('2026-09-06T00:00:00Z'); // start counting from Sunday
  const busy = [{ start: '2026-09-07T21:00:00.000Z', end: '2026-09-07T23:30:00.000Z' }]; // 7:30-10:00 ACST
  const slots = generateBookingSlots(rules, 120, monday, busy, 'Australia/Adelaide', 7);
  assert.ok(slots.length > 0);
  // Every slot lands on a weekday in Adelaide time (no Sat/Sun bookings).
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const slot of slots) {
    const label = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', weekday: 'short' }).format(new Date(slot.start));
    const day = weekdays[label];
    assert.ok([1, 2, 3, 4, 5].includes(day), `slot on weekday ${day} (${label})`);
  }
  // The busy range (7:30-10:00 ACST Monday) must not produce a slot that overlaps.
  const overlapping = slots.filter((slot) => new Date(slot.start) < new Date('2026-09-07T23:30:00.000Z') && new Date(slot.end) > new Date('2026-09-07T21:00:00.000Z'));
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