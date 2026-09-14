import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canDecideQuote, hashShareToken } from '../server/routes/public';
import { canVoidQuote } from '../server/routes/operations';
import { classifyAutomationStep, evaluateConditions, buildStepInput } from '../server/automation/runner';
import { computeDeletionSchedule, WORKSPACE_DELETION_GRACE_DAYS } from '../server/routes/workspaces';
import { isEligibleForPurge, shouldRevokeOwnerAccount } from '../server/automation/workspacePurge';

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

test('job photo storage keys derive their extension from the validated mime_type, never the client file_name', () => {
  const operationsSource = source('server/routes/operations.ts');
  const routeAt = operationsSource.indexOf("router.post('/jobs/:id/photos'");
  const routeBody = operationsSource.slice(routeAt, operationsSource.indexOf("router.get('/jobs/:id/photos'", routeAt));
  // A crafted file_name like "x.xyz/../../../evil" must never reach the
  // storage path — only the mime_type-derived extension may.
  assert.doesNotMatch(routeBody, /file_name\.split\('\.'\)/);
  assert.match(routeBody, /MIME_TYPE_EXTENSIONS\[req\.body\.mime_type\]/);
  assert.match(operationsSource, /const MIME_TYPE_EXTENSIONS = \{[^}]*'image\/jpeg':\s*'jpg'[^}]*\}/);
});

test('quote send fails closed before marking sent, matching the invoice send route', () => {
  const operationsSource = source('server/routes/operations.ts');
  const routeAt = operationsSource.indexOf("router.patch('/quotes/:id/send'");
  const routeBody = operationsSource.slice(routeAt, operationsSource.indexOf("router.post('/quotes/:id/link'", routeAt));
  assert.match(routeBody, /EMAIL_SEND_FAILED/);
  // The email attempt (and its failure return) must run before the status
  // update to 'sent' — never after, or a failed send would still be marked sent.
  const emailFailAt = routeBody.indexOf('EMAIL_SEND_FAILED');
  const statusFlipAt = routeBody.indexOf("status: 'sent'");
  assert.ok(emailFailAt >= 0);
  assert.ok(statusFlipAt > emailFailAt);
  // A customer with no email on file is still a deliberate manual-delivery
  // path, not a failure — it still ends up marked sent.
  assert.match(routeBody, /no_customer_email/);
});

test('quote-to-invoice conversion relies on a unique index instead of a check-then-act race', () => {
  const operationsSource = source('server/routes/operations.ts');
  const routeAt = operationsSource.indexOf("router.post('/quotes/:id/convert'");
  const routeBody = operationsSource.slice(routeAt, operationsSource.indexOf("router.get('/invoices'", routeAt));
  assert.match(routeBody, /23505/);
  assert.match(routeBody, /QUOTE_ALREADY_INVOICED/);
  // No separate select-then-insert lookup ahead of the insert attempt.
  assert.doesNotMatch(routeBody.slice(0, routeBody.indexOf('.insert({')), /neq\('status', 'void'\)\.limit\(1\)/);
  const migrationSource = source('supabase/migrations/0029_invoices_quote_id_unique_active.sql');
  assert.match(migrationSource, /create unique index if not exists invoices_quote_id_active_idx/);
  assert.match(migrationSource, /where quote_id is not null and status != 'void'/);
});

test('service agreement job generation compare-and-swaps next_service_at before inserting the job', () => {
  const operationsSource = source('server/routes/operations.ts');
  const routeAt = operationsSource.indexOf("router.post('/service-agreements/:id/generate'");
  const routeBody = operationsSource.slice(routeAt, operationsSource.indexOf('// ---------- Field Completion Pack', routeAt));
  assert.match(routeBody, /eq\('next_service_at', originalNextServiceAt\)/);
  assert.match(routeBody, /AGREEMENT_ALREADY_GENERATED/);
  // The CAS update must happen before the job insert, so a losing request
  // never creates a duplicate job for the same cycle.
  const casAt = routeBody.indexOf("eq('next_service_at', originalNextServiceAt)");
  const jobInsertAt = routeBody.indexOf(".from('jobs').insert({");
  assert.ok(casAt >= 0);
  assert.ok(jobInsertAt > casAt);
});

test('a claimed automation run is re-checked against the workspace entitlement before any step executes', () => {
  // Entitlement is checked when a run is queued (queueAutomationRun) and when
  // a manual run is requested (requireActiveSubscription('ai.basic') in
  // server/routes/intelligence.ts) — but a run can sit in 'waiting' for an
  // arbitrarily long time on approval, and the workspace can downgrade or
  // lapse in the meantime. processAutomationRuns must re-check the same
  // entitlement right after claiming a run and before executing any step.
  const runnerSource = source('server/automation/runner.ts');
  const claimAt = runnerSource.indexOf("status: 'running'");
  const entitlementQueryAt = runnerSource.indexOf("eq('workspace_id', run.workspace_id).eq('feature_key', 'ai.basic')");
  const executeAt = runnerSource.indexOf('executeAutomaticStep(run.workspace_id, step)');
  assert.ok(claimAt >= 0, 'expected the run to be claimed via status: running');
  assert.ok(entitlementQueryAt >= 0, 'expected a subscription_entitlements re-check keyed on run.workspace_id');
  assert.ok(executeAt >= 0, 'expected the executeAutomaticStep call site');
  assert.ok(claimAt < entitlementQueryAt, 'entitlement must be re-checked after the run is claimed');
  assert.ok(entitlementQueryAt < executeAt, 'entitlement must be re-checked before any step executes');
  // A revoked/disabled entitlement must cancel the run with a clear reason,
  // not silently execute it.
  assert.match(runnerSource, /if \(!entitlement\?\.enabled\) \{\s*\n\s*await supabaseAdmin\.from\('automation_runs'\)\.update\(\{ status: 'cancelled', completed_at: new Date\(\)\.toISOString\(\), last_error: 'ENTITLEMENT_REVOKED' \}\)/);
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

test('workspace deletion is scheduled exactly 30 days out and the schedule pairing is always both-or-neither', () => {
  const before = Date.now();
  const { requestedAt, scheduledFor } = computeDeletionSchedule(new Date(before));
  assert.equal(WORKSPACE_DELETION_GRACE_DAYS, 30);
  const deltaDays = (new Date(scheduledFor).getTime() - new Date(requestedAt).getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(deltaDays, 30);
  assert.equal(new Date(requestedAt).getTime(), before);
});

test('a workspace is only purge-eligible once its scheduled date has passed and it carries no legal hold', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');
  const past = new Date('2026-09-01T00:00:00.000Z').toISOString();
  const future = new Date('2026-11-01T00:00:00.000Z').toISOString();

  assert.equal(isEligibleForPurge({ deletion_scheduled_for: past, legal_hold_active: false }, now), true);
  // Not due yet.
  assert.equal(isEligibleForPurge({ deletion_scheduled_for: future, legal_hold_active: false }, now), false);
  // Due, but a legal hold blocks the purge regardless of the date.
  assert.equal(isEligibleForPurge({ deletion_scheduled_for: past, legal_hold_active: true }, now), false);
  // No deletion requested at all.
  assert.equal(isEligibleForPurge({ deletion_scheduled_for: null, legal_hold_active: false }, now), false);
});

test('the purged owner\'s auth account is only revoked once no other owned, active workspace remains', () => {
  assert.equal(shouldRevokeOwnerAccount(0), true);
  assert.equal(shouldRevokeOwnerAccount(1), false);
  assert.equal(shouldRevokeOwnerAccount(3), false);
});

test('requesting account-level deletion never calls deleteUser directly and only touches owned workspaces', () => {
  const workspacesSource = source('server/routes/workspaces.ts');
  const routeAt = workspacesSource.indexOf("router.post('/deletion/request-account'");
  assert.ok(routeAt >= 0);
  const routeBody = workspacesSource.slice(routeAt);
  assert.doesNotMatch(routeBody, /auth\.admin\.deleteUser/);
  assert.match(routeBody, /role === 'owner'/);
  assert.match(routeBody, /remainingMemberships/);
});
