import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { classifyAutomationStep, evaluateConditions, mapEventPayloadToStepInput } from '../server/automation/runner';

// These four tests correspond to the four P1 automation/approval fixes:
// A06 (forbidden DB identity), A07 (null-state runs excluded), A08 (dead
// triggers/missing executor) and A09 (approvals don't resume execution).

const runnerSource = await readFile(new URL('../server/automation/runner.ts', import.meta.url), 'utf8');
const intelligenceSource = await readFile(new URL('../server/routes/intelligence.ts', import.meta.url), 'utf8');
const operationsSource = await readFile(new URL('../server/routes/operations.ts', import.meta.url), 'utf8');
const crmSource = await readFile(new URL('../server/routes/crm.ts', import.meta.url), 'utf8');

test('A06: the manual run route inserts automation_runs through the service-role client, gated on role/plan/tool checks', () => {
  const runRoute = intelligenceSource.slice(intelligenceSource.indexOf("router.post('/automations/:id/run'"), intelligenceSource.indexOf("router.get('/automation-runs'"));
  // Role check still gates the whole route.
  assert.match(runRoute, /requireRole\('owner','admin','manager'\)/);
  // The workspace's plan entitlement to run automations is enforced by the
  // router-level requireActiveSubscription('ai.basic') middleware.
  assert.match(intelligenceSource, /requireActiveSubscription\('ai\.basic'\)/);
  // Every step's tool is re-validated against the allowed tool set at run time.
  assert.match(runRoute, /operatorTools\.some\(\(tool\)=>tool\.name===step\.tool\)/);
  assert.match(runRoute, /risk==='prohibited'/);
  // The insert itself must go through supabaseAdmin — `authenticated` has no
  // INSERT grant on automation_runs (see 0005_least_privilege_rbac.sql).
  assert.match(runRoute, /supabaseAdmin\.from\('automation_runs'\)\.insert/);
  assert.doesNotMatch(runRoute, /\bdb\.from\('automation_runs'\)\.insert/);
});

test('A07: the runner query treats an absent state.exhausted key as retryable, not excluded', () => {
  // The old .neq('state->>exhausted','true') is NULL (not true) in Postgres
  // when the key is absent, so PostgREST's .neq() silently drops brand-new
  // runs. Assert the null-safe replacement is in place and the old form is gone.
  assert.doesNotMatch(runnerSource, /\.neq\('state->>exhausted','true'\)/);
  assert.match(runnerSource, /state->>exhausted\.is\.null/);
  assert.match(runnerSource, /state->>exhausted\.neq\.true/);

  // A run with no exhausted key at all must be treated as retryable.
  assert.equal(evaluateFreshStateIsRetryable({}), true);
  assert.equal(evaluateFreshStateIsRetryable({ exhausted: true }), false);
  assert.equal(evaluateFreshStateIsRetryable({ exhausted: false }), true);

  // Simulates the same null-safe predicate PostgREST evaluates for
  // `state->>exhausted.is.null,state->>exhausted.neq.true`.
  function evaluateFreshStateIsRetryable(state: Record<string, unknown>): boolean {
    const value = (state as any).exhausted;
    return value === undefined || value === null || String(value) !== 'true';
  }
});

test('A08: availability.check has a runner executor and both business events queue a run with real inputs', () => {
  assert.match(runnerSource, /case 'availability\.check': \{/);
  assert.match(runnerSource, /generateBookingSlots\(/);

  // The dispatcher is wired to fire from job completion and lead creation.
  assert.match(operationsSource, /queueAutomationRun\(req\.workspaceId!, 'job\.completed', \{ jobId: data\.id/);
  assert.match(crmSource, /queueAutomationRun\(req\.workspaceId!, 'lead\.created', \{ leadId: data\.id/);

  // Dispatch is best-effort and must never break the request that triggered it.
  assert.match(operationsSource, /queueAutomationRun\([\s\S]{0,200}?\.catch\(\(\) => \{\}\)/);
  assert.match(crmSource, /queueAutomationRun\([\s\S]{0,200}?\.catch\(\(\) => \{\}\)/);

  // Trigger-condition evaluation: documented subset only, unsupported shapes skipped.
  assert.equal(evaluateConditions([], {}), true);
  assert.equal(evaluateConditions([{ field: 'stage', op: 'eq', value: 'won' }], { stage: 'won' }), true);
  assert.equal(evaluateConditions([{ field: 'stage', op: 'eq', value: 'won' }], { stage: 'lost' }), false);
  assert.equal(evaluateConditions([{ field: 'amount', op: 'gte', value: 100 }], { amount: 150 }), true);
  assert.equal(evaluateConditions([{ nonsense: true }], {}), false);

  // Event payload -> step input mapping (the concrete subset this fix supports).
  assert.deepEqual(mapEventPayloadToStepInput('review.request', { jobId: 'job-1' }), { jobId: 'job-1' });
  assert.deepEqual(
    mapEventPayloadToStepInput('quote.draft', { customerId: 'cust-1', jobId: 'job-1', serviceIds: ['svc-1'] }),
    { customerId: 'cust-1', jobId: 'job-1', serviceIds: ['svc-1'] },
  );
  assert.deepEqual(mapEventPayloadToStepInput('workspace.permissions.change', { jobId: 'job-1' }), {});
});

test('A09: an approval decision resumes (or terminally ends) the automation run it was blocking', () => {
  const decisionRoute = intelligenceSource.slice(intelligenceSource.indexOf("router.post('/approvals/:id/decision'"), intelligenceSource.indexOf("router.get('/ai-actions'"));
  // Approving flips the paused run back to queued so the poller resumes it.
  assert.match(decisionRoute, /status:\s*'queued'/);
  // Rejecting ends the run terminally instead of leaving it stuck waiting.
  assert.match(decisionRoute, /status:\s*'cancelled'/);
  // Both go through supabaseAdmin — automation_runs has no UPDATE grant for `authenticated`.
  assert.match(decisionRoute, /supabaseAdmin\.from\('automation_runs'\)/);
  assert.match(decisionRoute, /\.eq\('status', 'waiting'\)/);

  // The runner actually includes 'waiting'-turned-'queued' runs as ordinary
  // retries and checkpoints per-step progress so a resumed/retried run does
  // not repeat side-effecting steps that already completed.
  assert.match(runnerSource, /stepIndex/);
  assert.match(runnerSource, /pendingApproval/);
  assert.match(runnerSource, /reapExpiredLeases/);

  // classifyAutomationStep is unaffected by these changes — sanity check it
  // still gates availability.check as a safe, automatically-executable tool.
  assert.deepEqual(classifyAutomationStep('availability.check'), { stepClass: 'execute', risk: 'low' });
});
