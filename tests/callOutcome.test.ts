// Orchestration of completeReceptionistCall against an in-memory fake of the
// database client and SMS provider. The database-side guarantees themselves
// (one lead per call, single-use alert claims, concurrency) are tested against
// real PostgreSQL in tests/db/receptionist-call-outcomes.test.sql.
import assert from 'node:assert/strict';
import test from 'node:test';
import { completeReceptionistCall, type CallOutcomeDeps } from '../server/receptionist/callOutcome';

const WS = '11111111-1111-4111-8111-111111111111';
const SID = 'CA0123456789abcdef0123456789abcdef';

type Rows = { leads?: unknown; calls?: unknown; receptionist_profiles?: unknown };

function harness(rows: Rows, options: { serviceRole?: boolean; sms?: boolean; sendError?: unknown } = {}) {
  const state = { claimed: false, rpc: [] as Array<[string, any]>, updates: [] as Array<[string, any]>, sent: [] as any[] };
  const db = {
    rpc: async (name: string, args: any) => {
      state.rpc.push([name, args]);
      if (name === 'record_receptionist_call_lead') return { data: 'lead-1', error: null };
      if (name === 'claim_alert_delivery') {
        if (state.claimed) return { data: null, error: null };
        state.claimed = true;
        return { data: 'delivery-1', error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: keyof Rows | 'alert_deliveries') => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        update: (patch: unknown) => { state.updates.push([table, patch]); return builder; },
        maybeSingle: async () => ({ data: (rows as any)[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ error: null }),
      };
      return builder;
    },
  };
  const deps: CallOutcomeDeps = {
    db: db as unknown as CallOutcomeDeps['db'],
    sendSms: (async (input: any) => {
      state.sent.push(input);
      if (options.sendError) throw options.sendError;
      return { sid: 'SM123' };
    }) as unknown as CallOutcomeDeps['sendSms'],
    smsConfigured: () => options.sms ?? true,
    serviceRoleConfigured: () => options.serviceRole ?? true,
  };
  return { state, deps };
}

const lead = { title: 'Burst pipe - Parramatta', description: 'Water everywhere', suburb: 'Parramatta', job_type: 'Burst pipe', urgency: 'emergency', source_detail: { caller_name: 'Sam Lee' }, customers: { display_name: 'Sam Lee', normalized_phone: '+61412345678' } };
const call = { from_number: '+61412345678', to_number: '+61290000001' };

test('a completed call texts the owner once, from the business line, and records it as sent', async () => {
  const { state, deps } = harness({ leads: lead, calls: call, receptionist_profiles: { owner_alert_number: '+61400000001', transfer_number: '+61400000002' } });
  const result = await completeReceptionistCall(WS, SID, deps);
  assert.deepEqual(result, { leadId: 'lead-1', alert: 'sent' });
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].to, '+61400000001', 'the dedicated alert number wins over the transfer number');
  assert.equal(state.sent[0].from, '+61290000001', 'sent from the number the caller rang');
  assert.match(state.sent[0].body, /^Jobrin: EMERGENCY - New job: Burst pipe, Parramatta\. Sam Lee, 0412 345 678\./);
  assert.deepEqual(state.rpc.map(([name]) => name), ['record_receptionist_call_lead', 'claim_alert_delivery']);
  const [table, patch] = state.updates.at(-1)!;
  assert.equal(table, 'alert_deliveries');
  assert.equal(patch.status, 'sent');
  assert.equal(patch.provider_message_id, 'SM123');
  assert.ok(patch.sent_at);
});

test('running the call-end again (other path, retry) never sends a second text', async () => {
  const { state, deps } = harness({ leads: lead, calls: call, receptionist_profiles: { owner_alert_number: '+61400000001' } });
  await completeReceptionistCall(WS, SID, deps);
  const again = await completeReceptionistCall(WS, SID, deps);
  const third = await completeReceptionistCall(WS, SID, deps);
  assert.equal(again.alert, 'already_handled');
  assert.equal(third.alert, 'already_handled');
  assert.equal(state.sent.length, 1);
});

test('without a dedicated alert number the transfer number is used', async () => {
  const { state, deps } = harness({ leads: lead, calls: call, receptionist_profiles: { owner_alert_number: null, transfer_number: '+61400000002' } });
  await completeReceptionistCall(WS, SID, deps);
  assert.equal(state.sent[0].to, '+61400000002');
});

test('no number to text: the lead still exists and the delivery is recorded as skipped, with the reason', async () => {
  const { state, deps } = harness({ leads: lead, calls: call, receptionist_profiles: null });
  const result = await completeReceptionistCall(WS, SID, deps);
  assert.deepEqual(result, { leadId: 'lead-1', alert: 'skipped' });
  assert.equal(state.sent.length, 0);
  assert.equal(state.updates.at(-1)![1].status, 'skipped');
  assert.match(state.updates.at(-1)![1].detail, /No owner alert number/);
});

test('SMS provider not configured: skipped, never attempted', async () => {
  const { state, deps } = harness({ leads: lead, calls: call, receptionist_profiles: { owner_alert_number: '+61400000001' } }, { sms: false });
  const result = await completeReceptionistCall(WS, SID, deps);
  assert.equal(result.alert, 'skipped');
  assert.equal(state.sent.length, 0);
  assert.match(state.updates.at(-1)![1].detail, /SMS provider is not configured/);
});

test('a provider failure is recorded (with the Twilio code, not the error text) and does not throw', async () => {
  const { state, deps } = harness({ leads: lead, calls: call, receptionist_profiles: { owner_alert_number: '+61400000001' } }, { sendError: Object.assign(new Error('The message From/To pair violates a blacklist rule. secret-ish detail'), { code: 21610 }) });
  const result = await completeReceptionistCall(WS, SID, deps);
  assert.equal(result.alert, 'failed');
  const patch = state.updates.at(-1)![1];
  assert.equal(patch.status, 'failed');
  assert.equal(patch.detail, 'SMS send failed (Twilio 21610).');
  // A failed claim stays claimed: a retry must not double-text if the provider
  // actually accepted the message before erroring.
  assert.equal((await completeReceptionistCall(WS, SID, deps)).alert, 'already_handled');
});

test('without the service-role key nothing is recorded or sent', async () => {
  const { state, deps } = harness({ leads: lead, calls: call }, { serviceRole: false });
  assert.deepEqual(await completeReceptionistCall(WS, SID, deps), { leadId: null, alert: null });
  assert.equal(state.rpc.length, 0);
  assert.equal(state.sent.length, 0);
});

test('a simulator session id never reaches the database', async () => {
  const { state, deps } = harness({ leads: lead, calls: call });
  assert.deepEqual(await completeReceptionistCall(WS, 'simulate-abc', deps), { leadId: null, alert: null });
  assert.equal(state.rpc.length, 0);
});
