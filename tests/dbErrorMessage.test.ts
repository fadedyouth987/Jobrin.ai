import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { dbErrorMessage } from '../server/security';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');
const securitySource = source('server/security.ts');
const operationsSource = source('server/routes/operations.ts');
const crmSource = source('server/routes/crm.ts');

test('dbErrorMessage maps common Postgres error codes to safe, generic messages', () => {
  assert.equal(dbErrorMessage({ code: '23505' }), 'A matching record already exists.');
  assert.equal(dbErrorMessage({ code: '23503' }), 'A referenced record was not found.');
});

test('dbErrorMessage never leaks the raw Postgres error string for an unmapped code', () => {
  const raw = 'column "totally_internal_column" of relation "secret_table" does not exist';
  const message = dbErrorMessage({ code: '42703', message: raw });
  assert.notEqual(message, raw);
  assert.doesNotMatch(message, /secret_table|totally_internal_column/);
});

test('dbErrorMessage falls back to a fixed generic string, never error.message, when there is no error object', () => {
  assert.equal(dbErrorMessage(null), 'The request could not be completed.');
  assert.equal(dbErrorMessage(undefined, 'Custom fallback.'), 'Custom fallback.');
});

test('operations.ts and crm.ts route the raw Postgres error through dbErrorMessage instead of forwarding error.message to the client', () => {
  assert.match(operationsSource, /import \{[^}]*dbErrorMessage[^}]*\} from '\.\.\/security'/);
  assert.match(crmSource, /import \{[^}]*dbErrorMessage[^}]*\} from '\.\.\/security'/);
  // No remaining client-facing `message: error.message` pass-throughs in
  // either file (a `/duplicate/i.test(error.message)` control-flow check is
  // fine — it never reaches the client).
  assert.doesNotMatch(operationsSource, /message:\s*error\.message/);
  assert.doesNotMatch(crmSource, /message:\s*error\.message/);
  assert.match(operationsSource, /message:\s*dbErrorMessage\(error\)/);
  assert.match(crmSource, /message:\s*dbErrorMessage\(error\)/);
});

test('authRateLimit was removed as genuinely dead code (no server login/password route ever existed for it to protect)', () => {
  assert.doesNotMatch(securitySource, /authRateLimit/);
  const routesDir = fileURLToPath(new URL('../server/routes', import.meta.url));
  // Confirm nothing else in the routes tree still imports it.
  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.ts')) continue;
    const content = readFileSync(join(routesDir, file), 'utf8');
    assert.doesNotMatch(content, /authRateLimit/);
  }
});
