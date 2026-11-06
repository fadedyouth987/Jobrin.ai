import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { OWNER_ALERT_MAX_LENGTH, buildOwnerAlertSms, formatAuPhone, normalizeUrgency, toGsm7 } from '../server/receptionist/ownerAlert';
import { isRealCallSid } from '../server/receptionist/callOutcome';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ch = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const isGsm = (text: string) => [...text].every((c) => GSM.includes(c));
const URL_ = 'https://jobrin.ai/app/leads';

test('Australian numbers are shown the way Australians write them', () => {
  assert.equal(formatAuPhone('+61412345678'), '0412 345 678');
  assert.equal(formatAuPhone('+61291234567'), '02 9123 4567');
  assert.equal(formatAuPhone('+61881234567'), '08 8123 4567');
  assert.equal(formatAuPhone('+6421123456'), '+6421123456'); // overseas: unchanged
  assert.equal(formatAuPhone(''), '');
  assert.equal(formatAuPhone(null), '');
});

test('urgency only accepts the three defined levels', () => {
  assert.equal(normalizeUrgency('Emergency'), 'emergency');
  assert.equal(normalizeUrgency(' urgent '), 'urgent');
  assert.equal(normalizeUrgency('routine'), 'routine');
  assert.equal(normalizeUrgency('asap'), null);
  assert.equal(normalizeUrgency(undefined), null);
});

test('alert text stays in the GSM-7 alphabet (typographic characters from speech/AI are replaced)', () => {
  const smart = `Tap ${ch(0x2014)} it${ch(0x2019)}s ${ch(0x201C)}leaking${ch(0x201D)}${ch(0x2026)} ${ch(0x1F6B0)}`;
  const cleaned = toGsm7(smart);
  assert.equal(cleaned, `Tap - it's "leaking"... `);
  assert.ok(isGsm(cleaned));
  assert.equal(toGsm7(`Caf${ch(0x0065, 0x0301)} on Smith${ch(0x00A0)}St`), 'Cafe on Smith St');
});

test('a fully captured job produces a clear, actionable owner text', () => {
  const sms = buildOwnerAlertSms({ callerName: 'Sam Lee', callerNumber: '+61412345678', suburb: 'Parramatta', jobType: 'Burst pipe', urgency: 'emergency', note: 'Water everywhere under the sink', leadsUrl: URL_ });
  assert.equal(sms, `Jobrin: EMERGENCY - New job: Burst pipe, Parramatta. Sam Lee, 0412 345 678. "Water everywhere under the sink" Call back on 0412 345 678. Jobs: ${URL_}`);
  assert.ok(isGsm(sms));
});

test('a hang-up with nothing captured still tells the owner who to call back', () => {
  assert.equal(buildOwnerAlertSms({ callerNumber: '+61412345678', leadsUrl: URL_ }), `Jobrin: Missed call. Caller 0412 345 678. Call back on 0412 345 678. Jobs: ${URL_}`);
  assert.equal(buildOwnerAlertSms({ leadsUrl: URL_ }), `Jobrin: Missed call. Number withheld. Jobs: ${URL_}`);
  assert.match(buildOwnerAlertSms({ jobType: 'Power out', urgency: 'urgent', leadsUrl: URL_ }), /^Jobrin: URGENT - New job: Power out\. Number withheld\./);
});

test('long notes are trimmed so the text never exceeds three segments', () => {
  const sms = buildOwnerAlertSms({ callerName: 'A'.repeat(200), callerNumber: '+61412345678', suburb: 'B'.repeat(200), jobType: 'C'.repeat(200), urgency: 'routine', note: `${ch(0x2014)}x`.repeat(600), leadsUrl: URL_ });
  assert.ok(sms.length <= OWNER_ALERT_MAX_LENGTH, `length ${sms.length}`);
  assert.ok(isGsm(sms));
  assert.ok(sms.endsWith(`Jobs: ${URL_}`), 'the link to the job inbox is never cut off');
  assert.ok(sms.includes('Call back on 0412 345 678.'), 'the callback number is never cut off');
});

test('only real Twilio call SIDs create leads through the call path (the simulator never does)', () => {
  assert.equal(isRealCallSid('CA0123456789abcdef0123456789abcdef'), true);
  assert.equal(isRealCallSid('simulate-1b2c3d4e'), false);
  assert.equal(isRealCallSid('CA-test'), false);
  assert.equal(isRealCallSid(''), false);
});

test('every call-end path completes the call, and both are idempotent via the database', () => {
  const engine = source('server/ai/receptionistCall.ts');
  const webhook = source('server/routes/receptionist.ts');
  const outcome = source('server/receptionist/callOutcome.ts');
  assert.match(engine, /async finalize[\s\S]*await completeReceptionistCall\(this\.workspaceId, this\.callSid\)/);
  assert.match(webhook, /'\/voice\/complete'[\s\S]*await completeReceptionistCall\(call\.workspace_id, callSid\)/);
  // Lead first, then a single-use claim, then the send.
  const recordAt = outcome.indexOf("rpc('record_receptionist_call_lead'");
  const claimAt = outcome.indexOf("rpc('claim_alert_delivery'");
  const sendAt = outcome.indexOf('await deps.sendSms(');
  assert.ok(recordAt > 0 && claimAt > recordAt && sendAt > claimAt, 'record -> claim -> send');
  assert.match(outcome, /if \(!claim\) return \{ leadId, alert: 'already_handled' \}/);
  // The alert comes from the number the caller rang.
  assert.match(outcome, /from: \(callResult\.data as any\)\?\.to_number/);
});

test('the message-take tool captures the job details and the name is actually saved', () => {
  const engine = source('server/ai/receptionistCall.ts');
  for (const field of ['suburb', 'job_type', 'urgency', 'caller_name', 'callback_number']) assert.match(engine, new RegExp(`${field}: \\{`));
  assert.match(engine, /enum: \['emergency', 'urgent', 'routine'\]/);
  // The tool has always named it caller_name; reading callback_name only
  // meant names were never stored.
  assert.match(engine, /const callerName = args\.caller_name \|\| args\.callback_name \|\| null;/);
});

test('the database functions are server-only', () => {
  const migration = source('supabase/migrations/20261106010000_receptionist_call_outcomes.sql');
  assert.match(migration, /revoke all on function public\.record_receptionist_call_lead\([^)]*\) from public, anon, authenticated;/);
  assert.match(migration, /revoke all on function public\.claim_alert_delivery\([^)]*\) from public, anon, authenticated;/);
  assert.match(migration, /revoke all on public\.alert_deliveries from anon, authenticated;\ngrant select on public\.alert_deliveries to authenticated;/);
});
