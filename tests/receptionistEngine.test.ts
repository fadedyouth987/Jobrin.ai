import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildApprovedContextSnapshot, buildSystemPrompt, issueCallToken, signApprovedContextSnapshot, verifyApprovedContextSnapshot, verifyCallToken, ReceptionistSession, type CallContext } from '../server/ai/receptionistCall';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

test('call tokens are signed, bound to one call, and reject tampering', () => {
  const token = issueCallToken('11111111-1111-1111-1111-111111111111', 'CA123', '+61800000000', 'snapshot-hash');
  const verified = verifyCallToken(token);
  assert.ok(verified);
  assert.equal(verified.workspaceId, '11111111-1111-1111-1111-111111111111');
  assert.equal(verified.callSid, 'CA123');
  assert.equal(verified.toNumber, '+61800000000');
  assert.equal(verified.snapshotHash, 'snapshot-hash');
  // Tampered signature or payload must be rejected outright.
  assert.equal(verifyCallToken(token.slice(0, -2) + 'xx'), null);
  assert.equal(verifyCallToken('v1.not-json.zz'), null);
  assert.equal(verifyCallToken('garbage'), null);
});

const context: CallContext = {
  workspaceId: '11111111-1111-1111-1111-111111111111',
  profile: {
    display_name: 'Skye', greeting: 'Thanks for calling Fix It Plumbing.',
    tone: 'warm and calm', business_instructions: 'Never quote a binding price.',
    after_hours_message: 'The team is unavailable right now.', transfer_number: '+61400000000',
    language: 'en-AU', allow_booking: true, allow_warm_transfer: true, allow_message_take: true,
    allow_followup_sms: false,
    approved_pricing_language: 'Quotes are free and confirmed by the team.', custom_escalation_rules: ['Escalate gas smells.'], callback_window: 'one business day', after_hours_rule: 'Take a callback request.',
  },
  business: { trading_name: 'Fix It Plumbing', suburb: 'Salisbury', state: 'SA', phone: '0400000000' },
  knowledge: [{ title: 'Opening hours', content: 'Open 7am to 5pm Monday to Friday.' }],
  services: [{ name: 'Emergency callout', pricing_mode: 'callout_hourly', base_price_cents: 18000 }],
};

test('the system prompt always carries the safety guardrails and only approved facts', () => {
  const prompt = buildSystemPrompt(context);
  assert.match(prompt, /virtual receptionist/);
  assert.match(prompt, /Never fabricate business facts, prices/);
  assert.match(prompt, /Never ask for or accept card numbers/);
  assert.match(prompt, /Opening hours/); // approved knowledge is included
  assert.match(prompt, /Emergency callout/); // services are listed
  assert.match(prompt, /Quotes are free and confirmed by the team/);
  assert.doesNotMatch(prompt, /appointment\.book|availability\.check|message\.send_template/);
});

test('signed snapshots reject modified workspace facts', () => {
  const snapshot = buildApprovedContextSnapshot(context);
  const signed = signApprovedContextSnapshot(snapshot);
  assert.equal(verifyApprovedContextSnapshot(snapshot, signed.hash, signed.signature), true);
  assert.equal(verifyApprovedContextSnapshot({ ...snapshot, businessName: 'Attacker Business' }, signed.hash, signed.signature), false);
});

test('without an AI key the session fails closed without claiming a save', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = ''; // simulate the key being absent
  try {
    const session = new ReceptionistSession({ workspaceId: context.workspaceId, callSid: 'CA-test' });
    session.context = context;
    session.snapshot = buildApprovedContextSnapshot(context);
    session.systemPrompt = buildSystemPrompt(context);
    const first = await session.handleUserText('Do you fix burst pipes in Adelaide?');
    assert.equal(first.configured, false);
    assert.match(first.reply, /trouble accessing/i);
    assert.equal(first.messageTaken, false);
    const second = await session.handleUserText('Yes please, call me on 0412 345 678 about the leak');
    assert.equal(second.messageTaken, false);
    assert.doesNotMatch(second.reply, /saved|passed.*team/i);
  } finally {
    env.OPENAI_API_KEY = originalKey;
  }
});

test('the engine is attached in both runtimes and the voice webhook signs call tokens', () => {
  const nodeAdapter = source('server/ws/receptionistSocket.ts');
  assert.match(nodeAdapter, /verifyCallToken/);
  assert.match(nodeAdapter, /markReceptionistEngineAttached/);
  const workerSource = source('worker.ts');
  assert.match(workerSource, /handleConversationUpgrade/);
  assert.match(workerSource, /verifyCallToken/);
  assert.match(workerSource, /markReceptionistEngineAttached/);
  const routeSource = source('server/routes/receptionist.ts');
  assert.match(routeSource, /issueCallToken\(/);
  assert.match(routeSource, /isReceptionistEngineAttached\(\)/);
  assert.match(routeSource, /RECEPTIONIST_NOT_READY/);
  assert.match(routeSource, /twilioSignatureGuard\('\/api\/twilio\/voice'\)/);
});
