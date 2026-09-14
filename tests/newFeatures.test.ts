import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canDecideQuote, hashShareToken } from '../server/routes/public';
import { canVoidQuote } from '../server/routes/operations';
import { classifyAutomationStep, evaluateConditions, buildStepInput } from '../server/automation/runner';

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string) => readFileSync(join(here, '..', relative), 'utf8');

test('customers can only decide quotes that have been sent', () => {
  assert.equal(canDecideQuote('sent', 'accepted'), true);
  assert.equal(canDecideQuote('viewed', 'declined'), true);
  assert.equal(canDecideQuote('draft', 'accepted'), false);
  assert.equal(canDecideQuote('accepted', 'declined'), false);
  assert.equal(canDecideQuote('void', 'accepted'), false);
});

test('voiding stays an owner decision and never applies to decided quotes', () => {
  assert.equal(canVoidQuote('draft'), true);
  assert.equal(canVoidQuote('sent'), true);
  assert.equal(canVoidQuote('viewed'), true);
  assert.equal(canVoidQuote('accepted'), false);
  assert.equal(canVoidQuote('declined'), false);
});

test('share links are hashed with SHA-256 and never stored in recoverable form', () => {
  assert.equal(hashShareToken('token-a'), hashShareToken('token-a'));
  assert.notEqual(hashShareToken('token-a'), hashShareToken('token-b'));
  assert.match(hashShareToken('token-a'), /^[0-9a-f]{64}$/);
  const publicSource = source('server/routes/public.ts');
  assert.match(publicSource, /createHash\('sha256'\)/);
  assert.doesNotMatch(publicSource, /randomBytes/);
});

test('public quote links are unauthenticated, rate limited and hash-addressed', () => {
  const publicSource = source('server/routes/public.ts');
  assert.match(publicSource, /public_token_hash/);
  assert.match(publicSource, /publicRateLimit/);
  assert.match(publicSource, /LINK_NOT_FOUND/);
  assert.doesNotMatch(publicSource, /requireAuth/);
  assert.match(publicSource, /quote\.customer_viewed/);
  assert.match(publicSource, /quote\.customer_\$\{parsed\.data\.decision\}/);
});

test('sending a quote issues a token link and never leaks internal notes to customers', () => {
  const operationsSource = source('server/routes/operations.ts');
  assert.match(operationsSource, /quotes\/:id\/send/);
  assert.match(operationsSource, /buildQuoteShareLink/);
  assert.match(operationsSource, /base64url/);
  assert.match(operationsSource, /QUOTE_NOT_SENDABLE/);
  // The public payload builder in public.ts must not select internal notes.
  const publicSource = source('server/routes/public.ts');
  // The public payload must never select the internal notes column.
  assert.doesNotMatch(publicSource, /select\('[^']*notes/);
});

test('quote conversion requires an accepted quote and blocks duplicates', () => {
  const operationsSource = source('server/routes/operations.ts');
  assert.match(operationsSource, /QUOTE_NOT_ACCEPTED/);
  assert.match(operationsSource, /QUOTE_ALREADY_INVOICED/);
  assert.match(operationsSource, /quote\.converted_to_invoice/);
});

test('invoice send marks sent and emails only when delivery is configured', () => {
  const operationsSource = source('server/routes/operations.ts');
  assert.match(operationsSource, /invoices\/:id\/send/);
  assert.match(operationsSource, /INVOICE_NOT_SENDABLE/);
  assert.match(operationsSource, /emailConfigured\(\)/);
});

test('email delivery fails closed before any provider call', () => {
  const emailSource = source('server/providers/email.ts');
  const configuredAt = emailSource.indexOf('if (!emailConfigured())');
  const providerCallAt = emailSource.indexOf('api.resend.com');
  assert.ok(configuredAt >= 0);
  assert.ok(providerCallAt > configuredAt);
  assert.match(emailSource, /EMAIL_NOT_CONFIGURED/);
});

test('team invitations need owner or admin, sensitive auth and the service role', () => {
  const teamSource = source('server/routes/team.ts');
  assert.match(teamSource, /requireRole\('owner', 'admin'\)/);
  assert.match(teamSource, /requireSensitiveAuth/);
  assert.match(teamSource, /INVITES_REQUIRE_SERVICE_ROLE/);
  assert.match(teamSource, /ONLY_OWNER_CAN_INVITE_ADMINS/);
  assert.match(teamSource, /inviteUserByEmail/);
  assert.match(teamSource, /team\.member_invited/);
  // The invite must go through the real invite flow — an email with a setup
  // link the invitee acts on — never createUser with email_confirm, which
  // silently created a passwordless, unnotified account. And the user id must
  // be read from the documented AuthResponse shape: a wrong read returned 502
  // on every successful invite while leaving the auth user created.
  assert.doesNotMatch(teamSource, /createUser\(/);
  assert.doesNotMatch(teamSource, /email_confirm/);
  assert.match(teamSource, /invite\.data\?\.user\?\.id \?\? null/);
});

test('automation steps are classified before anything executes', () => {
  assert.deepEqual(classifyAutomationStep('quote.draft'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('customer.lookup'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('review.request'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('business.report'), { stepClass: 'execute', risk: 'low' });
  // Registry entries are not automatically runnable until a complete
  // provider-backed executor exists. availability.check has one (it reuses
  // the public-booking slot generator), so it is executable; the others
  // below still have no executor and must be rejected.
  assert.deepEqual(classifyAutomationStep('availability.check'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('appointment.book'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('message.send_template'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('quote.send'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('payment.refund'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('workspace.permissions.change'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('secret.read'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('not.a.real.tool'), { stepClass: 'denied', risk: 'prohibited' });
});

test('the automation runner claims atomically, retries and dead-letters', () => {
  const runnerSource = source('server/automation/runner.ts');
  assert.match(runnerSource, /in\('status', \['queued', 'failed'\]\)/);
  assert.match(runnerSource, /exhausted/);
  assert.doesNotMatch(runnerSource, /\.neq\('state->>exhausted'/);
  assert.match(runnerSource, /status: exhausted \? 'cancelled' : 'failed'/);
  assert.match(runnerSource, /automation_attempts/);
  assert.match(runnerSource, /TOOL_NOT_ALLOWED/);
  assert.match(runnerSource, /AUTOMATION_EXECUTABLE_TOOLS/);
  // Denied tools must be rejected before the executor is reached.
  const deniedAt = runnerSource.indexOf("classified.stepClass === 'denied'");
  const executeAt = runnerSource.indexOf('executeAutomaticStep(run.workspace_id, step)');
  assert.ok(deniedAt >= 0);
  assert.ok(executeAt > deniedAt);
});

test('business events hydrate step input from well-known payload fields without overwriting configured values', () => {
  // This is the gap fix: the automation builder saves steps with input: {},
  // and previously nothing ever filled that in for an event-triggered run.
  const step = { tool: 'review.request', input: {} };
  const hydrated = buildStepInput(step, { jobId: 'job-1', customerId: 'cust-1', unrelatedField: 'ignored' });
  assert.deepEqual(hydrated, { jobId: 'job-1', customerId: 'cust-1' });

  // A value already configured on the step is never clobbered by the event payload.
  const preConfigured = buildStepInput({ tool: 'review.request', input: { jobId: 'pinned-job' } }, { jobId: 'job-1' });
  assert.deepEqual(preConfigured, { jobId: 'pinned-job' });
});

test('trigger conditions support a documented {field,operator,value} subset and skip anything else', () => {
  assert.equal(evaluateConditions([], {}), true);
  assert.equal(evaluateConditions([{ field: 'estimatedValueCents', operator: 'gte', value: 10000 }], { estimatedValueCents: 15000 }), true);
  assert.equal(evaluateConditions([{ field: 'estimatedValueCents', operator: 'gte', value: 10000 }], { estimatedValueCents: 5000 }), false);
  assert.equal(evaluateConditions([{ field: 'source', operator: 'eq', value: 'website' }], { source: 'referral' }), false);
  // An unsupported/undocumented condition shape is skipped (treated as
  // non-blocking) rather than guessed at or thrown on.
  assert.equal(evaluateConditions([{ any: 'shape' } as any], {}), true);
  assert.equal(evaluateConditions(['not-an-object' as any], {}), true);
});

test('event dispatch is wired from lead creation, job completion, and has an availability.check executor', () => {
  const runnerSource = source('server/automation/runner.ts');
  assert.match(runnerSource, /export async function queueAutomationRun/);
  assert.match(runnerSource, /case 'availability\.check'/);
  assert.match(runnerSource, /generateBookingSlots/);
  // availability.check must be advertised as automation-ready now that it has an executor.
  assert.match(runnerSource, /'availability\.check',\r?\n\]\);/);

  const crmSource = source('server/routes/crm.ts');
  assert.match(crmSource, /queueAutomationRun\(req\.workspaceId!, 'lead\.created'/);

  const operationsSource = source('server/routes/operations.ts');
  assert.match(operationsSource, /queueAutomationRun\(req\.workspaceId!, 'job\.completed'/);
});

test('approving an automation-step approval requeues its run; rejecting cancels it', () => {
  const intelligenceSource = source('server/routes/intelligence.ts');
  const decisionRouteAt = intelligenceSource.indexOf("router.post('/approvals/:id/decision'");
  assert.ok(decisionRouteAt >= 0);
  const decisionRouteBody = intelligenceSource.slice(decisionRouteAt);
  assert.match(decisionRouteBody, /resource_type === 'automation_step'/);
  assert.match(decisionRouteBody, /status: 'queued'/);
  assert.match(decisionRouteBody, /status: 'cancelled'/);
  assert.match(decisionRouteBody, /'APPROVAL_REJECTED'/);
  // The requeue must only touch a run that is actually still waiting, and
  // must use the service-role client (browser clients cannot write
  // automation_runs directly per the manual-run route's own comment).
  assert.match(decisionRouteBody, /eq\('status', 'waiting'\)/);
  assert.match(decisionRouteBody, /supabaseAdmin\.from\('automation_runs'\)/);

  // The runner must not re-run a step already recorded as completed, and
  // must stop the loop (not just `continue`) once a step is awaiting approval
  // so later steps never run ahead of a pending human decision.
  const runnerSource = source('server/automation/runner.ts');
  assert.match(runnerSource, /prior\?\.status === 'completed'/);
  assert.match(runnerSource, /prior\?\.status === 'awaiting_approval'/);
  assert.match(runnerSource, /APPROVAL_REJECTED/);
});
