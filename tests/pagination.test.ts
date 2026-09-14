import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyKeysetCursor, buildPage, encodeCursor, parseCursor } from '../server/security';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

test('cursor encoding round-trips created_at + id and rejects garbage', () => {
  const cursor = encodeCursor('2026-01-02T03:04:05.000Z', 'abc-123');
  const parsed = parseCursor(cursor);
  assert.deepEqual(parsed, { createdAt: '2026-01-02T03:04:05.000Z', id: 'abc-123' });

  // Missing, empty, or non-string input is never treated as a cursor.
  assert.equal(parseCursor(undefined), null);
  assert.equal(parseCursor(''), null);
  assert.equal(parseCursor(123 as unknown as string), null);
  // Not valid base64url / no separator / not a real date all fail closed.
  assert.equal(parseCursor('not-base64!!'), null);
  assert.equal(parseCursor(Buffer.from('no-separator-here').toString('base64url')), null);
  assert.equal(parseCursor(Buffer.from('not-a-date|some-id').toString('base64url')), null);
});

test('applyKeysetCursor builds a keyset OR condition, not an OFFSET', () => {
  const calls: string[] = [];
  const fakeQuery = { or: (filter: string) => { calls.push(filter); return fakeQuery; } };
  const cursor = parseCursor(encodeCursor('2026-01-01T00:00:00.000Z', 'row-1'));
  applyKeysetCursor(fakeQuery, cursor);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /created_at\.lt\.2026-01-01T00:00:00\.000Z/);
  assert.match(calls[0], /and\(created_at\.eq\.2026-01-01T00:00:00\.000Z,id\.lt\.row-1\)/);

  // A null cursor (first page) must not touch the query at all.
  const untouched = { or: () => { throw new Error('should not be called'); } };
  assert.equal(applyKeysetCursor(untouched, null), untouched);

  // A custom column pair (e.g. updated_at) is honoured.
  const customCalls: string[] = [];
  const customQuery = { or: (filter: string) => { customCalls.push(filter); return customQuery; } };
  applyKeysetCursor(customQuery, cursor, { createdAt: 'updated_at', id: 'id' });
  assert.match(customCalls[0], /updated_at\.lt\./);
});

test('buildPage trims the limit+1 fetch and only issues a cursor when more rows exist', () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `id-${i}`, created_at: `2026-01-0${4 - i}T00:00:00.000Z` }));
  // Fetched limit(3+1) and got exactly 4 back -> there is a next page.
  const withMore = buildPage(rows, 3);
  assert.equal(withMore.page.length, 3);
  assert.equal(withMore.hasMore, true);
  assert.ok(withMore.nextCursor);
  assert.deepEqual(parseCursor(withMore.nextCursor), { createdAt: rows[2].created_at, id: rows[2].id });

  // Fewer rows than limit+1 -> this was the last page.
  const noMore = buildPage(rows.slice(0, 2), 3);
  assert.equal(noMore.page.length, 2);
  assert.equal(noMore.hasMore, false);
  assert.equal(noMore.nextCursor, null);

  // A non-default key field (updated_at) is used to build the cursor.
  const updatedRows = [{ id: 'm-1', updated_at: '2026-02-01T00:00:00.000Z' }, { id: 'm-2', updated_at: '2026-01-01T00:00:00.000Z' }];
  const paged = buildPage(updatedRows, 1, 'updated_at');
  assert.equal(paged.hasMore, true);
  assert.deepEqual(parseCursor(paged.nextCursor!), { createdAt: '2026-02-01T00:00:00.000Z', id: 'm-1' });
});

test('operations.ts list endpoints accept a cursor, apply the keyset filter, and return nextCursor', () => {
  const operationsSource = source('server/routes/operations.ts');
  for (const routeStart of ["router.get('/jobs'", "router.get('/quotes'", "router.get('/invoices'", "router.get('/payments'"]) {
    const routeAt = operationsSource.indexOf(routeStart);
    assert.ok(routeAt >= 0, `expected to find ${routeStart}`);
    const routeBody = operationsSource.slice(routeAt, routeAt + 800);
    assert.match(routeBody, /parseCursor\(req\.query\.cursor\)/);
    assert.match(routeBody, /applyKeysetCursor\(query, cursor\)/);
    assert.match(routeBody, /order\('id', \{ ?ascending: ?false ?\}\)/);
    assert.match(routeBody, /buildPage\(data \?\? \[\], limit\)/);
    assert.match(routeBody, /nextCursor/);
  }
  // The response's top-level array field name is unchanged from before this
  // change (backward compatible for existing clients ignoring nextCursor).
  assert.match(operationsSource, /res\.json\(\{ jobs: page, nextCursor, hasMore \}\)/);
  assert.match(operationsSource, /res\.json\(\{ invoices: page, nextCursor, hasMore \}\)/);
});

test('crm.ts customers and leads are cursor-paginated and keep their existing response field names', () => {
  const crmSource = source('server/routes/crm.ts');
  const customersAt = crmSource.indexOf("router.get('/customers',");
  const customersBody = crmSource.slice(customersAt, crmSource.indexOf("router.get('/customers/:id'", customersAt));
  assert.match(customersBody, /parseCursor\(req\.query\.cursor\)/);
  assert.match(customersBody, /applyKeysetCursor\(query, cursor\)/);
  assert.match(customersBody, /res\.json\(\{ customers: page, nextCursor, hasMore \}\)/);
  // Search filtering (an .or() call) and cursor keyset (another .or() call)
  // must both survive — the cursor helper must not replace the search filter.
  assert.match(customersBody, /query\.or\(`display_name\.ilike/);

  const leadsAt = crmSource.indexOf("router.get('/leads',");
  const leadsBody = crmSource.slice(leadsAt, crmSource.indexOf("router.post('/leads'", leadsAt));
  assert.match(leadsBody, /parseCursor\(req\.query\.cursor\)/);
  assert.match(leadsBody, /applyKeysetCursor\(query, cursor\)/);
  assert.match(leadsBody, /res\.json\(\{ leads: page, nextCursor, hasMore \}\)/);
});

test('intelligence.ts ai-actions, reviews, automation-runs and approvals are cursor-paginated', () => {
  const intelligenceSource = source('server/routes/intelligence.ts');
  for (const [routeStart, field] of [
    ["router.get('/ai-actions'", 'actions'],
    ["router.get('/reviews'", 'reviews: page'],
    ["router.get('/automation-runs'", 'runs:page'],
    ["router.get('/approvals'", 'approvals: page'],
  ] as const) {
    const routeAt = intelligenceSource.indexOf(routeStart);
    assert.ok(routeAt >= 0, `expected to find ${routeStart}`);
    const routeBody = intelligenceSource.slice(routeAt, routeAt + 900);
    assert.match(routeBody, /parseCursor\(req\.query\.cursor\)/);
    assert.match(routeBody, /applyKeysetCursor\(query,\s?cursor\)/);
    assert.match(routeBody, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // ai-actions maps the page before responding (to tag each row's specialist),
  // but the page itself — not the raw fetched rows — must feed that map.
  const aiActionsAt = intelligenceSource.indexOf("router.get('/ai-actions'");
  const aiActionsBody = intelligenceSource.slice(aiActionsAt, aiActionsAt + 1200);
  assert.match(aiActionsBody, /const actions = page\.map/);
  assert.match(aiActionsBody, /res\.json\(\{ actions, nextCursor, hasMore \}\)/);
  // Endpoints deliberately left unpaginated must say why, right above the route.
  const conversationsAt = intelligenceSource.indexOf("router.get('/conversations'");
  const attributionAt = intelligenceSource.indexOf("router.get('/attribution'");
  assert.match(intelligenceSource.slice(conversationsAt - 700, conversationsAt), /nullable and mutated by every new message/);
  assert.match(intelligenceSource.slice(attributionAt - 700, attributionAt), /NOT cursor-paginated/);
});

test('assets, business-brain memories, and hiring applications are cursor-paginated', () => {
  const assetsSource = source('server/routes/assets.ts');
  assert.match(assetsSource, /parseCursor\(req\.query\.cursor\)/);
  assert.match(assetsSource, /applyKeysetCursor\(query, cursor\)/);
  assert.match(assetsSource, /res\.json\(\{ assets: page, nextCursor, hasMore \}\)/);

  const businessBrainSource = source('server/routes/businessBrain.ts');
  assert.match(businessBrainSource, /parseCursor\(req\.query\.cursor\)/);
  // Memories sort on updated_at (mutated by status changes), not created_at,
  // so the keyset must be told to use that column pair explicitly.
  assert.match(businessBrainSource, /applyKeysetCursor\(query,cursor,\{createdAt:'updated_at',id:'id'\}\)/);
  assert.match(businessBrainSource, /buildPage\(data\?\?\[\],limit,'updated_at'\)/);

  const hiringSource = source('server/routes/hiring.ts');
  const applicationsAt = hiringSource.indexOf("router.get('/applications'");
  const applicationsBody = hiringSource.slice(applicationsAt, hiringSource.indexOf("router.post('/candidates'", applicationsAt));
  assert.match(applicationsBody, /parseCursor\(req\.query\.cursor\)/);
  assert.match(applicationsBody, /applyKeysetCursor\(query, cursor\)/);
  assert.match(applicationsBody, /res\.json\(\{ applications: page, nextCursor, hasMore \}\)/);
});

test('the time-materials endpoint paginates its two independent lists with separate cursors', () => {
  const operationsSource = source('server/routes/operations.ts');
  const routeAt = operationsSource.indexOf("router.get('/time-materials'");
  const routeBody = operationsSource.slice(routeAt, operationsSource.indexOf("// ---------- Recurring jobs", routeAt));
  assert.match(routeBody, /parseCursor\(req\.query\.timeCursor\)/);
  assert.match(routeBody, /parseCursor\(req\.query\.materialsCursor\)/);
  assert.match(routeBody, /nextTimeCursor/);
  assert.match(routeBody, /nextMaterialsCursor/);
});

test('receptionist calls and communications conversations stay on a fixed limit with a documented reason (nullable sort column)', () => {
  const receptionistSource = source('server/routes/receptionist.ts');
  const callsAt = receptionistSource.indexOf("router.get('/calls'");
  assert.match(receptionistSource.slice(callsAt - 700, callsAt), /NOT cursor-paginated/);
  assert.doesNotMatch(receptionistSource.slice(callsAt, callsAt + 400), /parseCursor/);

  const communicationsSource = source('server/routes/communications.ts');
  const conversationsAt = communicationsSource.indexOf("router.get('/conversations'");
  assert.match(communicationsSource.slice(conversationsAt - 700, conversationsAt), /NOT cursor-paginated/);
});
