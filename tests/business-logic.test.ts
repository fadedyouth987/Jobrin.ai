import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDocument, canTransitionJob, documentItems } from '../server/routes/operations';
import { readAal } from '../server/supabase';
import { canTransitionApplication } from '../server/routes/hiring';

function token(payload: Record<string, unknown>) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
}

test('document totals calculate integer cents and GST on each line', () => {
  const items = documentItems.parse([
    { description: 'Callout', quantity: 1, unit_price_cents: 10000, gst_rate: 0.1 },
    { description: 'Parts', quantity: 2.5, unit_price_cents: 1234, gst_rate: 0 },
  ]);
  assert.deepEqual(calculateDocument(items), { subtotal: 13085, gst: 1000 });
});

test('document item validation rejects negative prices and unsupported tax rates', () => {
  assert.equal(documentItems.safeParse([{ description: 'Bad', quantity: 1, unit_price_cents: -1, gst_rate: 0.1 }]).success, false);
  assert.equal(documentItems.safeParse([{ description: 'Bad', quantity: 1, unit_price_cents: 1, gst_rate: 0.2 }]).success, false);
});

test('job lifecycle permits real next steps and rejects false completion jumps', () => {
  assert.equal(canTransitionJob('new', 'scheduled'), true);
  assert.equal(canTransitionJob('scheduled', 'on_the_way'), true);
  assert.equal(canTransitionJob('in_progress', 'completed'), true);
  assert.equal(canTransitionJob('completed', 'paid'), false);
  assert.equal(canTransitionJob('new', 'paid'), false);
  assert.equal(canTransitionJob('paid', 'in_progress'), false);
});

test('AAL is read only from the signed-token payload shape', () => {
  assert.equal(readAal(token({ aal: 'aal1' })), 'aal1');
  assert.equal(readAal(token({ aal: 'aal2' })), 'aal2');
  assert.equal(readAal(token({ aal: 'admin' })), null);
  assert.equal(readAal('invalid'), null);
});

test('hiring pipeline only permits explicit human-reviewed next steps', () => {
  assert.equal(canTransitionApplication('applied', 'screening'), true);
  assert.equal(canTransitionApplication('screening', 'interview'), true);
  assert.equal(canTransitionApplication('offered', 'hired'), true);
  assert.equal(canTransitionApplication('interview', 'rejected'), true);
  assert.equal(canTransitionApplication('applied', 'hired'), false);
  assert.equal(canTransitionApplication('hired', 'screening'), false);
});
