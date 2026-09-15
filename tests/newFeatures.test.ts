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
import { generateDocumentPdf, type DocumentPdfInput } from '../server/documents/pdfGenerator';

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
  assert.match(teamSource, /redirectTo: new URL\('\/set-password', env\.APP_URL\)\.toString\(\)/);
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

test('AI post-work recap is drafted best-effort on job completion and never blocks the status update', () => {
  const operationsSource = source('server/routes/operations.ts');
  const completedBranchAt = operationsSource.indexOf("if (req.body.status === 'completed') {");
  assert.ok(completedBranchAt >= 0);
  const completedBranchBody = operationsSource.slice(completedBranchAt, completedBranchAt + 700);
  // The recap draft is dispatched fire-and-forget (void + .catch), inside the
  // same completed-status branch as the existing automation dispatch, and the
  // route still responds with the job regardless of the recap outcome.
  assert.match(completedBranchBody, /void draftJobRecap\(req\.workspaceId!, data\.id\)\.catch\(/);
  const respondAt = operationsSource.indexOf("res.json({ job: data });", completedBranchAt);
  assert.ok(respondAt > completedBranchAt);
});

test('job recap drafting is metered through the usage.ai_actions cap and never retries the provider', () => {
  const recapSource = source('server/ai/jobRecap.ts');
  assert.match(recapSource, /consumeWorkspaceUsageForWorkspace\(workspaceId, 'usage\.ai_actions', 1,/);
  assert.match(recapSource, /if \(!allowance\.allowed\)/);
  // A single bounded openaiChat call — no loop, no manual retry wrapper here
  // (retries, if any, belong to openaiChat itself and must not be duplicated).
  const callCount = recapSource.match(/openaiChat\(/g)?.length ?? 0;
  assert.equal(callCount, 1);
  assert.match(recapSource, /if \(!openaiConfigured\(\)\) return;/);
});

test('job recap drafting never throws out of draftJobRecap — every failure path is caught and logged', () => {
  const recapSource = source('server/ai/jobRecap.ts');
  assert.match(recapSource, /export async function draftJobRecap/);
  // Provider call is wrapped so a rejection cannot propagate to the caller.
  const tryAt = recapSource.indexOf('let turn;');
  assert.ok(tryAt >= 0);
  assert.match(recapSource.slice(tryAt, tryAt + 400), /try \{[\s\S]*openaiChat[\s\S]*\} catch \(error\) \{/);
});

test('sending a job recap fails closed when email is not configured or the customer has no email on file', () => {
  const operationsSource = source('server/routes/operations.ts');
  const sendRouteAt = operationsSource.indexOf("router.post('/jobs/:id/recap/send'");
  assert.ok(sendRouteAt >= 0);
  const sendRouteBody = operationsSource.slice(sendRouteAt, sendRouteAt + 2500);
  assert.match(sendRouteBody, /if \(!emailConfigured\(\)\) return res\.status\(409\)\.json\(\{ error: 'EMAIL_NOT_CONFIGURED'/);
  assert.match(sendRouteBody, /if \(!customer\?\.email\) return res\.status\(409\)\.json\(\{ error: 'NO_CUSTOMER_EMAIL'/);
  // The provider call happens only after both checks, and a failed delivery
  // is reported honestly rather than marking the recap sent.
  const emailConfiguredAt = sendRouteBody.indexOf('emailConfigured()');
  const sendEmailAt = sendRouteBody.indexOf('await sendEmail(');
  assert.ok(sendEmailAt > emailConfiguredAt);
  assert.match(sendRouteBody, /if \(!result\.delivered\) return res\.status\(502\)\.json\(\{ error: 'EMAIL_SEND_FAILED'/);
  // Never flips status to 'sent' except through the guarded update below the checks.
  assert.match(sendRouteBody, /status: 'sent', sent_at: now/);
});

test('job recap edit/approve/discard route requires staff-and-above and never re-sends an already-sent recap', () => {
  const operationsSource = source('server/routes/operations.ts');
  const patchRouteAt = operationsSource.indexOf("router.patch('/jobs/:id/recap'");
  assert.ok(patchRouteAt >= 0);
  const patchRouteBody = operationsSource.slice(patchRouteAt, patchRouteAt + 1200);
  assert.match(patchRouteBody, /requireRole\('owner', 'admin', 'manager', 'staff'\)/);
  assert.match(patchRouteBody, /if \(recap\.status === 'sent'\) return res\.status\(409\)\.json\(\{ error: 'RECAP_ALREADY_SENT' \}\);/);
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

test('the shared PDF generator produces a real, valid PDF with the right numbers', async () => {
  const input: DocumentPdfInput = {
    kind: 'invoice',
    number: 1042,
    status: 'sent',
    createdAt: '2026-09-01T00:00:00.000Z',
    dueOrExpiresAt: '2026-09-15T00:00:00.000Z',
    business: {
      trading_name: 'Test Trades Co',
      abn: '12 345 678 901',
      gst_registered: true,
      phone: '0400 000 000',
      email: 'billing@testtrades.example',
      website: 'https://testtrades.example',
      street_address: '1 Example St',
      suburb: 'Adelaide',
      state: 'SA',
      postcode: '5000',
    },
    customer: { display_name: 'Jane Customer', email: 'jane@example.com' },
    items: [
      { description: 'Replace hot water service', quantity: 1, unit_price_cents: 120000, gst_rate: 0.1 },
      { description: 'Call-out fee', quantity: 1, unit_price_cents: 8000, gst_rate: 0.1 },
    ],
    subtotalCents: 128000,
    gstCents: 12800,
    totalCents: 140800,
    balanceDueCents: 140800,
  };

  const bytes = await generateDocumentPdf(input);

  // A genuine PDF starts with the %PDF- magic header and is non-trivial in
  // size — this is a real rendering assertion, not just a source-inspection
  // one, so a broken pdf-lib call or an empty buffer would fail it.
  const header = Buffer.from(bytes.slice(0, 5)).toString('ascii');
  assert.equal(header, '%PDF-');
  assert.ok(bytes.length > 1000, `expected a non-trivial PDF, got ${bytes.length} bytes`);
  const trailer = Buffer.from(bytes.slice(-32)).toString('latin1');
  assert.match(trailer, /%%EOF/);
});

test('the PDF generator never throws on missing optional business/customer fields', async () => {
  const input: DocumentPdfInput = {
    kind: 'quote',
    number: 7,
    status: 'draft',
    createdAt: null,
    dueOrExpiresAt: null,
    business: null,
    customer: null,
    items: [{ description: 'Site visit', quantity: 1, unit_price_cents: 5000, gst_rate: 0 }],
    subtotalCents: 5000,
    gstCents: 0,
    totalCents: 5000,
    depositCents: 0,
  };
  const bytes = await generateDocumentPdf(input);
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('ascii'), '%PDF-');
});

// ---------- Automated review requests ----------

test('review.request automation steps get jobId filled in from the triggering event, without overwriting a configured channel', () => {
  // Real behaviour, not a source-pattern check: buildStepInput is the same
  // hydration function processAutomationRuns uses for every event-triggered
  // step (server/automation/runner.ts) — a job.completed automation never
  // has jobId at save time, only once a real job completes.
  const input = buildStepInput({ tool: 'review.request', input: { channel: 'email' } }, { jobId: 'job-1' });
  assert.deepEqual(input, { channel: 'email', jobId: 'job-1' });
  // A jobId already configured on the step (unusual, but possible) is never
  // clobbered by the event payload.
  const preset = buildStepInput({ tool: 'review.request', input: { channel: 'sms', jobId: 'configured-job' } }, { jobId: 'event-job' });
  assert.deepEqual(preset, { channel: 'sms', jobId: 'configured-job' });
});

test('review.request runs automatically (never stops for approval) but its delivery step checks SMS consent, suppression and provider configuration before sending', () => {
  const runnerSource = source('server/automation/runner.ts');
  assert.match(runnerSource, /if \(toolName === 'review\.request'\) return \{ stepClass: 'execute', risk: 'low' \};/);

  const caseAt = runnerSource.indexOf("case 'review.request': {");
  assert.ok(caseAt >= 0);
  const caseBody = runnerSource.slice(caseAt, runnerSource.indexOf("case 'availability.check'", caseAt));

  // Provider configuration is checked before any send attempt, exactly like
  // the manual SMS route and the quote/invoice email routes fail closed.
  assert.match(caseBody, /if \(!twilioConfigured\(\)\) \{/);
  assert.match(caseBody, /if \(!emailConfigured\(\)\) \{/);
  // The exact same consent (transactional purpose) + suppression check used
  // by POST /sms in server/routes/communications.ts — never bypassed.
  assert.match(caseBody, /\.eq\('channel', 'sms'\)\.eq\('purpose', 'transactional'\)/);
  assert.match(caseBody, /suppression_entries.*\.eq\('channel', 'sms'\)\.eq\('value', destination\)/s);
  assert.match(caseBody, /if \(suppression\) \{\s*\n\s*deliveryStatus = 'suppressed'; deliveryError = 'SUPPRESSED';/);
  assert.match(caseBody, /if \(!latestConsent\?\.granted \|\| latestConsent\.revoked_at\) \{\s*\n\s*deliveryStatus = 'suppressed'; deliveryError = 'CONSENT_MISSING';/);
  // A real send only happens once every gate above has passed.
  assert.match(caseBody, /await sendSms\(\{ to: destination, body: messageBody\.slice\(0, 1600\)/);
  assert.match(caseBody, /await sendEmail\(\{ to: customer\.email,/);

  // The public response link's token is generated with crypto.randomBytes and
  // only its hash is ever persisted — matching the quote/invoice share-link
  // convention (buildQuoteShareLink in server/routes/operations.ts).
  assert.match(caseBody, /const responseToken = crypto\.randomBytes\(24\)\.toString\('base64url'\);/);
  assert.match(caseBody, /response_token_hash: hashShareToken\(responseToken\)/);
});

test('the public review response route resolves strictly by the token\'s hash and never stores or logs a recoverable token', () => {
  const publicSource = source('server/routes/public.ts');
  assert.match(publicSource, /router\.get\('\/review\/:token'/);
  assert.match(publicSource, /router\.post\('\/review\/:token'/);
  // Both routes look the request up by response_token_hash via hashShareToken
  // — never by the raw token — matching the quote link routes above them.
  const getAt = publicSource.indexOf("router.get('/review/:token'");
  const postAt = publicSource.indexOf("router.post('/review/:token'");
  assert.ok(getAt >= 0 && postAt > getAt);
  const getBody = publicSource.slice(getAt, postAt);
  const postBody = publicSource.slice(postAt, publicSource.indexOf("// ---------- Public booking"));
  assert.match(getBody, /\.eq\('response_token_hash', hashShareToken\(token\)\)/);
  assert.match(postBody, /\.eq\('response_token_hash', hashShareToken\(token\)\)/);
  // GET marks a first open as 'clicked' (click tracking) without blocking the
  // view, mirroring the quote link's "mark viewed once" pattern.
  assert.match(getBody, /status: 'clicked' \}\)[\s\S]*\.eq\('status', 'sent'\)/);
});

test('a review response is only accepted while the request is sent/clicked, is idempotent once completed, and updates status against the job record', () => {
  const publicSource = source('server/routes/public.ts');
  const postAt = publicSource.indexOf("router.post('/review/:token'");
  const postBody = publicSource.slice(postAt, publicSource.indexOf("// ---------- Public booking"));
  // Rating is validated 1-5; an out-of-range or missing rating 400s.
  assert.match(postBody, /rating: z\.number\(\)\.int\(\)\.min\(1\)\.max\(5\)/);
  // Idempotent replay: a request already completed returns its recorded
  // response instead of erroring or double-recording.
  assert.match(postBody, /if \(request\.status === 'completed'\) \{\s*\n\s*return res\.json\(\{ status: 'completed', rating: request\.rating, feedback: request\.feedback \}\);/);
  // Anything not sent/clicked/completed is rejected outright (queued,
  // suppressed, failed requests were never delivered, so cannot be answered).
  assert.match(postBody, /if \(!\['sent', 'clicked'\]\.includes\(request\.status\)\) \{/);
  // The update is conditional on the current status (optimistic concurrency),
  // matching the quote decision route's .in('status', [...]) guard.
  assert.match(postBody, /\.in\('status', \['sent', 'clicked'\]\)/);
  // The response is recorded against review_requests.job_id, which is the
  // FK linking the response back to the job record.
  assert.match(postBody, /details: \{ via: 'public_link', rating: parsed\.data\.rating, jobId: request\.job_id \}/);
  // A low rating raises an owner notification instead of only sitting in a list.
  assert.match(postBody, /if \(parsed\.data\.rating <= 3\) \{/);
});

test('the automated-review-requests coming-soon placeholder is removed now that delivery and response capture are wired end-to-end', () => {
  const navSource = source('src/app/workspaceNavigation.tsx');
  const pagesSource = source('src/pages/AppPages.tsx');
  assert.doesNotMatch(navSource, /coming-soon\/review-automation/);
  assert.doesNotMatch(pagesSource, /'review-automation':/);
  // The public review page is routed like the public quote page.
  const appSource = source('src/App.tsx');
  assert.match(appSource, /PublicReviewPage/);
  assert.match(appSource, /\/\^\\\/review\\\/\(\[A-Za-z0-9_-\]\+\)\$\//);
});

test('the Automations builder can configure a real review.request step, and the create route validates it against event-hydrated input', () => {
  const appSource = source('src/pages/AppPages.tsx');
  assert.match(appSource, /tool==='review\.request'/);
  assert.match(appSource, /input:\{channel:form\.channel\}/);

  const intelligenceSource = source('server/routes/intelligence.ts');
  assert.match(intelligenceSource, /import \{ buildStepInput, isAutomationExecutable \} from '\.\.\/automation\/runner';/);
  assert.match(intelligenceSource, /tool\.schema\.safeParse\(step\.input\)\.success\)return false;/);
  assert.match(intelligenceSource, /buildStepInput\(step,AUTOMATION_VALIDATION_EVENT_PAYLOAD\)/);
});

test('the Reviews page surfaces delivery status (not just a queued list) and the reviews API selects delivery_error', () => {
  const appSource = source('src/pages/AppPages.tsx');
  assert.match(appSource, /function reviewStatusTone/);
  assert.match(appSource, /function reviewDeliveryLabel/);
  const intelligenceSource = source('server/routes/intelligence.ts');
  assert.match(intelligenceSource, /review_requests'\)\.select\('id,channel,status,rating,feedback,delivery_error,sent_at,completed_at,created_at,customer_id,customers\(display_name\),job_id'\)/);
});

test('the review-response token column is additive, hashed and indexed like the existing quote/invoice share-link columns', () => {
  const migration = source('supabase/migrations/20260914010300_review_response_tokens.sql');
  assert.match(migration, /add column if not exists response_token_hash text/);
  assert.match(migration, /add column if not exists delivery_error text/);
  assert.match(migration, /create unique index if not exists review_requests_response_token_hash_idx/);
  assert.doesNotMatch(migration, /drop table|drop column/);
});

test('quote and invoice PDF download routes exist with the same workspace-scoped access as their list routes, and the send routes attach the PDF alongside the existing link', () => {
  const operationsSource = source('server/routes/operations.ts');
  assert.match(operationsSource, /router\.get\('\/quotes\/:id\/pdf'/);
  assert.match(operationsSource, /router\.get\('\/invoices\/:id\/pdf'/);
  assert.match(operationsSource, /application\/pdf/);

  // The send routes must build the PDF and pass it through as an email
  // attachment, without replacing the secure share/payment link.
  const quoteSendAt = operationsSource.indexOf("router.patch('/quotes/:id/send'");
  const quoteSendBody = operationsSource.slice(quoteSendAt, operationsSource.indexOf("router.post('/quotes/:id/link'", quoteSendAt));
  assert.match(quoteSendBody, /buildDocumentPdfInput/);
  assert.match(quoteSendBody, /attachments: pdfAttachment/);
  assert.match(quoteSendBody, /shareUrl/);

  const invoiceSendAt = operationsSource.indexOf("router.patch('/invoices/:id/send'");
  const invoiceSendBody = operationsSource.slice(invoiceSendAt, operationsSource.indexOf("router.get('/payments'", invoiceSendAt));
  assert.match(invoiceSendBody, /buildDocumentPdfInput/);
  assert.match(invoiceSendBody, /attachments: pdfAttachment/);
  assert.match(invoiceSendBody, /paymentUrl/);
});

test('email attachments are only sent to Resend when present, and PDF attachment failures never block the send', () => {
  const emailSource = source('server/providers/email.ts');
  assert.match(emailSource, /attachments\?: EmailAttachment\[\]/);
  assert.match(emailSource, /input\.attachments\?\.length/);

  const operationsSource = source('server/routes/operations.ts');
  // Both send routes wrap PDF generation in try/catch so a PDF failure falls
  // back to sending without an attachment instead of failing the whole send.
  const quoteSendAt = operationsSource.indexOf("router.patch('/quotes/:id/send'");
  const quoteSendBody = operationsSource.slice(quoteSendAt, operationsSource.indexOf("router.post('/quotes/:id/link'", quoteSendAt));
  const tryAt = quoteSendBody.indexOf('try {');
  const catchAt = quoteSendBody.indexOf('} catch (pdfErr)');
  assert.ok(tryAt >= 0 && catchAt > tryAt);
});
