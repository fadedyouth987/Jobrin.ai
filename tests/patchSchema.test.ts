import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import { patchSchema } from '../server/security';

const create = z.object({
  name: z.string().trim().min(2),
  notes: z.string().trim().max(10).default(''),
  booking_type: z.enum(['bookable', 'quote']).default('bookable'),
  requires_deposit: z.boolean().default(false),
  price_cents: z.number().int().nullable().optional(),
}).strict();

test('patchSchema never fills create-time defaults into a partial update', () => {
  assert.deepEqual(patchSchema(create).parse({ name: 'Gutter clean' }), { name: 'Gutter clean' });
  assert.deepEqual(patchSchema(create).parse({ requires_deposit: true }), { requires_deposit: true });
  assert.deepEqual(patchSchema(create).parse({}), {});
});

test('patchSchema keeps field validation and strict unknown-key rejection', () => {
  const patch = patchSchema(create);
  assert.equal(patch.safeParse({ name: 'x' }).success, false);
  assert.equal(patch.safeParse({ notes: 'far too long for ten' }).success, false);
  assert.equal(patch.safeParse({ booking_type: 'nope' }).success, false);
  assert.equal(patch.safeParse({ workspace_id: 'other-tenant' }).success, false);
  assert.deepEqual(patch.parse({ name: '  Trimmed  ' }), { name: 'Trimmed' });
});

test('create schemas still apply their defaults', () => {
  assert.deepEqual(create.parse({ name: 'Gutter clean' }), { name: 'Gutter clean', notes: '', booking_type: 'bookable', requires_deposit: false });
});

test('PATCH routes use patchSchema rather than .partial() so stored columns are not reset', async () => {
  for (const route of ['services', 'assets', 'purchasing']) {
    const source = await readFile(new URL(`../server/routes/${route}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /validateBody\([^)]*\.partial\(\)/, `${route}.ts must not validate PATCH bodies with .partial()`);
    assert.match(source, /validateBody\(patchSchema\(/);
  }
});
