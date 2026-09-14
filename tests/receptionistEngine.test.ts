import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ADMIN_MODES, JOBRIN_ADMIN_SCOPE, buildSystemPrompt, issueCallToken, verifyCallToken, ReceptionistSession, DEFAULT_APPROVED_PRICING_LANGUAGE, DEFAULT_CALLBACK_WINDOW, DEFAULT_MAX_CONCURRENT_CALLS, DEFAULT_MAX_CALLS_PER_CALLER_HOUR, isOverConcurrentCallLimit, isOverCallerHourlyLimit, type CallContext } from '../server/ai/receptionistCall';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

test('call tokens are signed, bound to one call and receiving number, and reject tampering', () => {
  const token = issueCallToken('11111111-1111-1111-1111-111111111111', 'CA123', '+61400000000');
  const verified = verifyCallToken(token);
  assert.ok(verified);
  assert.equal(verified.workspaceId, '11111111-1111-1111-1111-111111111111');
  assert.equal(verified.callSid, 'CA123');
  assert.equal(verified.toNumber, '+61400000000');
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
    allow_followup_sms: false, recording_enabled: false, recording_consent_prompt: 'This call may be processed by an AI assistant.',
  },
  business: { trading_name: 'Fix It Plumbing', suburb: 'Salisbury', state: 'SA', phone: '0400000000' },
  knowledge: [{ title: 'Opening hours', content: 'Open 7am to 5pm Monday to Friday.' }],
  services: [{ name: 'Emergency callout', pricing_mode: 'callout_hourly', base_price_cents: 18000 }],
};

test('the system prompt always carries the safety guardrails and only approved facts', () => {
  const prompt = buildSystemPrompt(context);
  assert.match(prompt, /virtual receptionist/);
  assert.match(prompt, /Never invent prices/);
  assert.match(prompt, /Never take card details/);
  assert.match(prompt, /Opening hours/); // approved knowledge is included
  assert.match(prompt, /Emergency callout/); // services are listed
  assert.match(prompt, /Never quote a binding price/); // owner instructions included
});

test('without an AI key the session fails safe to a message-take flow', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = ''; // simulate the key being absent
  try {
    const session = new ReceptionistSession({ workspaceId: context.workspaceId, callSid: 'CA-test' });
    session.context = context;
    session.systemPrompt = buildSystemPrompt(context);
    const first = await session.handleUserText('Do you fix burst pipes in Adelaide?');
    assert.equal(first.configured, false);
    assert.match(first.reply, /take a message/i);
    assert.equal(first.messageTaken, false);
    const second = await session.handleUserText('Yes please, call me on 0412 345 678 about the leak');
    assert.equal(second.messageTaken, true);
    assert.match(second.reply, /passed that to the team|passed your message/i);
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
  assert.match(source('worker.ts'), /validateTwilioWebSocket/);
  assert.match(source('server/ai/receptionistDO.ts'), /webSocketMessage/);
  assert.match(source('server/ai/receptionistDO.ts'), /serializeAttachment/);
  assert.match(source('server/ai/receptionistDO.ts'), /call_state/);
});

test('signed-in AI Admin departments fail closed without asking for caller details', async () => {
  const { env } = await import('../server/env');
  const originalKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = '';
  try {
    for (const mode of ADMIN_MODES.filter((item) => item !== 'receptionist')) {
      const session = new ReceptionistSession({ workspaceId: context.workspaceId, callSid: `preview-${mode}`, mode });
      session.context = context;
      session.systemPrompt = buildSystemPrompt(context, mode);
      const result = await session.handleUserText('Complete this administrative task.');
      assert.equal(result.configured, false);
      assert.equal(result.messageTaken, false);
      assert.match(result.reply, /OpenAI provider is not ready/);
      assert.match(result.reply, /No draft was produced and no action was taken/);
      assert.doesNotMatch(result.reply, /best number to reach you/i);
    }
  } finally {
    env.OPENAI_API_KEY = originalKey;
  }
});

test('every AI Admin department understands Jobrin and keeps consequential work controlled', () => {
  assert.match(JOBRIN_ADMIN_SCOPE, /lead or enquiry.*customer.*job.*quote.*invoice.*payment.*review/s);
  assert.match(JOBRIN_ADMIN_SCOPE, /integer cents in AUD/);
  assert.match(JOBRIN_ADMIN_SCOPE, /Never claim a record was created, sent, booked, paid, refunded or changed/);
  const expectedHat = {
    receptionist: /RECEPTIONIST hat/,
    finance: /FINANCE hat/,
    sales: /SALES & LEADS hat/,
    marketing: /MARKETING hat/,
    support: /CUSTOMER SUPPORT hat/,
  } as const;
  for (const mode of ADMIN_MODES) {
    const prompt = buildSystemPrompt(context, mode);
    assert.match(prompt, expectedHat[mode]);
    assert.match(prompt, /Jobrin\.ai is a workspace-isolated operations platform/);
    assert.match(prompt, /human approval/);
    assert.match(prompt, /Never invent prices/);
  }
  assert.match(buildSystemPrompt(context, 'finance'), /do not provide accounting or tax advice/);
  assert.match(buildSystemPrompt(context, 'sales'), /Never promise prices or availability/);
  assert.match(buildSystemPrompt(context, 'marketing'), /Never contact customers directly/);
  assert.match(buildSystemPrompt(context, 'support'), /if the approved knowledge does not cover it, say so/);
});

test('phase-1 runtime controls fall back to safe defaults when unset', () => {
  const prompt = buildSystemPrompt(context);
  assert.match(prompt, new RegExp(DEFAULT_APPROVED_PRICING_LANGUAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, new RegExp(DEFAULT_CALLBACK_WINDOW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(prompt, /CUSTOM ESCALATION RULES: none configured/);
});

test('the pricing-language guardrail constrains what the receptionist may say about price', () => {
  const priced: CallContext = { ...context, profile: { ...context.profile, approved_pricing_language: 'We charge a flat call-out fee, confirmed after inspection.' } };
  const prompt = buildSystemPrompt(priced);
  assert.match(prompt, /PRICING LANGUAGE \(mandatory\)/);
  assert.match(prompt, /We charge a flat call-out fee, confirmed after inspection\./);
  assert.match(prompt, /Never state a dollar figure/);
});

test('custom escalation rules are listed for the model to check against', () => {
  const escalating: CallContext = { ...context, profile: { ...context.profile, custom_escalation_rules: ['If the caller mentions a gas leak, transfer immediately', 'If the caller asks for a refund, take a message'] } };
  const prompt = buildSystemPrompt(escalating);
  assert.match(prompt, /CUSTOM ESCALATION RULES:/);
  assert.match(prompt, /If the caller mentions a gas leak, transfer immediately/);
  assert.match(prompt, /If the caller asks for a refund, take a message/);
});

test('the callback window is the only wording used when promising a callback', () => {
  const custom: CallContext = { ...context, profile: { ...context.profile, callback_window: 'by close of business today' } };
  const prompt = buildSystemPrompt(custom);
  assert.match(prompt, /CALLBACK WORDING \(mandatory\).*by close of business today/);
});

test('a call ends once it hits the configured turn limit', async () => {
  const session = new ReceptionistSession({ workspaceId: context.workspaceId, callSid: 'CA-turn-limit' });
  session.context = { ...context, profile: { ...context.profile, max_call_turns: 2, max_call_minutes: 30 } };
  session.systemPrompt = buildSystemPrompt(session.context);
  const first = await session.handleUserText('Do you fix burst pipes?');
  assert.equal(first.endCall, undefined);
  const second = await session.handleUserText('Great, can someone come today?');
  assert.equal(second.endCall, undefined);
  const third = await session.handleUserText('One more question please');
  assert.equal(third.endCall, true);
  assert.match(third.reply, /wrap up this call/i);
  // Once ended, the session must not keep taking prompts.
  const fourth = await session.handleUserText('Hello?');
  assert.equal(fourth.endCall, true);
});

test('a call ends once it hits the configured minute limit', async () => {
  const session = new ReceptionistSession({ workspaceId: context.workspaceId, callSid: 'CA-minute-limit', startedAtMs: Date.now() - 20 * 60_000 });
  session.context = { ...context, profile: { ...context.profile, max_call_turns: 40, max_call_minutes: 15 } };
  session.systemPrompt = buildSystemPrompt(session.context);
  const result = await session.handleUserText('Are you still there?');
  assert.equal(result.endCall, true);
  assert.match(result.reply, /wrap up this call/i);
});

test('the concurrent-call limit rejects the Nth call once the workspace is at capacity', () => {
  // Owner set max_concurrent_calls = 3: the 3rd already-in-progress call means
  // a 4th (the N+1th) inbound call must be rejected.
  assert.equal(isOverConcurrentCallLimit(0, 3), false);
  assert.equal(isOverConcurrentCallLimit(2, 3), false);
  assert.equal(isOverConcurrentCallLimit(3, 3), true);
  assert.equal(isOverConcurrentCallLimit(4, 3), true);
  // No owner-configured limit falls back to a sane default rather than
  // accepting unlimited concurrent calls.
  assert.equal(isOverConcurrentCallLimit(DEFAULT_MAX_CONCURRENT_CALLS - 1, null), false);
  assert.equal(isOverConcurrentCallLimit(DEFAULT_MAX_CONCURRENT_CALLS, null), true);
  assert.equal(isOverConcurrentCallLimit(DEFAULT_MAX_CONCURRENT_CALLS, undefined), true);
});

test('the per-caller hourly limit rejects the Nth call from the same number within the hour', () => {
  // Owner set max_calls_per_caller_hour = 2: a 3rd call from the same number
  // inside the trailing hour must be rejected.
  assert.equal(isOverCallerHourlyLimit(0, 2), false);
  assert.equal(isOverCallerHourlyLimit(1, 2), false);
  assert.equal(isOverCallerHourlyLimit(2, 2), true);
  assert.equal(isOverCallerHourlyLimit(3, 2), true);
  assert.equal(isOverCallerHourlyLimit(DEFAULT_MAX_CALLS_PER_CALLER_HOUR - 1, null), false);
  assert.equal(isOverCallerHourlyLimit(DEFAULT_MAX_CALLS_PER_CALLER_HOUR, null), true);
});

test('the /voice webhook counts in-progress and recent-caller calls and rejects fail-closed, but proceeds fail-open on a query error', () => {
  const routeSource = source('server/routes/receptionist.ts');
  // Concurrency: exact 'calls' status value used for an active call, scoped
  // to this workspace.
  assert.match(routeSource, /\.eq\('workspace_id', integration\.workspace_id\)\.eq\('status', 'in_progress'\)/);
  // Per-caller hourly window: scoped to this workspace and this caller's
  // number, over the trailing hour.
  assert.match(routeSource, /\.eq\('workspace_id', integration\.workspace_id\)\.eq\('from_number', from\)/);
  assert.match(routeSource, /\.gte\('created_at', new Date\(Date\.now\(\) - 60 \* 60_000\)\.toISOString\(\)\)/);
  // Both pure decision functions from the engine are actually consulted
  // before the call is connected, and a genuine breach responds with TwiML
  // instead of connecting to ConversationRelay.
  assert.match(routeSource, /isOverConcurrentCallLimit\(concurrentResult\.count/);
  assert.match(routeSource, /isOverCallerHourlyLimit\(callerResult\.count/);
  // The limit checks happen strictly before the call token is issued and the
  // call is connected.
  const limitCheckAt = routeSource.indexOf('isOverConcurrentCallLimit(');
  const tokenAt = routeSource.indexOf('issueCallToken(');
  assert.ok(limitCheckAt >= 0 && tokenAt >= 0 && limitCheckAt < tokenAt);
  // A query error is caught and logged, not thrown — the call proceeds.
  assert.match(routeSource, /catch \(error\) \{\s*\n\s*console\.error/);
});

test('model-assisted AI Admin work is metered idempotently and logged with provider usage', () => {
  const engine = source('server/ai/receptionistCall.ts');
  assert.match(engine, /usage\.ai_actions/);
  assert.match(engine, /recordModelTurn/);
  assert.match(engine, /providerUsage/);
  assert.match(engine, /callSid.*turnNumber/s);
  const brain = source('server/ai/businessBrainWorker.ts');
  assert.ok(brain.indexOf('openaiConfigured()') < brain.indexOf("'usage.ai_actions'"));
  assert.match(brain, /providerUsage:extraction\.usage/);
});
