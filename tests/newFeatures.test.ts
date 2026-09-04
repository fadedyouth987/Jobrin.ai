import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canDecideQuote, hashShareToken } from '../server/routes/public';
import { canVoidQuote } from '../server/routes/operations';
import { classifyAutomationStep } from '../server/automation/runner';

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
});

test('automation steps are classified before anything executes', () => {
  assert.deepEqual(classifyAutomationStep('quote.draft'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('customer.lookup'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('review.request'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('business.report'), { stepClass: 'execute', risk: 'low' });
  assert.deepEqual(classifyAutomationStep('appointment.book'), { stepClass: 'approval', risk: 'medium' });
  assert.deepEqual(classifyAutomationStep('message.send_template'), { stepClass: 'approval', risk: 'medium' });
  assert.deepEqual(classifyAutomationStep('quote.send'), { stepClass: 'approval', risk: 'high' });
  assert.deepEqual(classifyAutomationStep('payment.refund'), { stepClass: 'approval', risk: 'high' });
  assert.deepEqual(classifyAutomationStep('workspace.permissions.change'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('secret.read'), { stepClass: 'denied', risk: 'prohibited' });
  assert.deepEqual(classifyAutomationStep('not.a.real.tool'), { stepClass: 'denied', risk: 'prohibited' });
});

test('the automation runner claims atomically, retries and dead-letters', () => {
  const runnerSource = source('server/automation/runner.ts');
  assert.match(runnerSource, /in\('status', \['queued', 'failed'\]\)/);
  assert.match(runnerSource, /exhausted/);
  assert.match(runnerSource, /automation_attempts/);
  assert.match(runnerSource, /TOOL_NOT_ALLOWED/);
  assert.match(runnerSource, /waiting/);
  assert.match(runnerSource, /approvals'\)\.insert/);
  // Denied tools must be rejected before the executor is reached.
  const deniedAt = runnerSource.indexOf("classified.stepClass === 'denied'");
  const executeAt = runnerSource.indexOf('executeAutomaticStep(run.workspace_id, step)');
  assert.ok(deniedAt >= 0);
  assert.ok(executeAt > deniedAt);
});