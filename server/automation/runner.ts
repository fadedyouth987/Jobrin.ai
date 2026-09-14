import { supabaseAdmin, writeNotification } from '../supabase';
import { toolByName, requiresApproval, canExecute } from '../ai/toolRegistry';
import { generateBookingSlots, type BusinessHourRule } from '../routes/public';
import { purgeScheduledWorkspaceDeletions } from './workspacePurge';

// Automation executor: processes the automation_runs queue that the Business
// Brain worker alone previously left untouched. Runs are claimed atomically,
// retried with exponential backoff and dead-lettered once attempts are
// exhausted. "Safe autopilot" policy is enforced here, not in the UI:
// - automatic tools execute directly (draft, read, queue review request)
// - policy_controlled / approval_required tools stop for a human approval
// - prohibited or unknown tools are never executed

let running = false;

export type StepClass = 'execute' | 'approval' | 'denied';

// Only tools with a complete, tested executor belong in an automation. The
// wider registry also describes preview and approval-gated product direction;
// advertising those as runnable would create jobs that can never finish.
export const AUTOMATION_EXECUTABLE_TOOLS = new Set([
  'customer.lookup',
  'quote.draft',
  'review.request',
  'business.report',
  'availability.check',
]);

export function isAutomationExecutable(toolName: string) {
  return AUTOMATION_EXECUTABLE_TOOLS.has(toolName);
}

export function classifyAutomationStep(toolName: string): { stepClass: StepClass; risk: string } {
  const tool = toolByName(toolName);
  if (!tool || tool.risk === 'prohibited' || !isAutomationExecutable(toolName)) return { stepClass: 'denied', risk: 'prohibited' };
  if (tool.risk === 'automatic') return { stepClass: 'execute', risk: 'low' };
  // review.request only stages an internal queued record — nothing contacts a
  // customer until delivery providers are configured and the owner sends it.
  if (toolName === 'review.request') return { stepClass: 'execute', risk: 'low' };
  if (requiresApproval(toolName)) return { stepClass: 'approval', risk: 'high' };
  if (canExecute(toolName)) return { stepClass: 'approval', risk: 'medium' };
  return { stepClass: 'denied', risk: 'prohibited' };
}

async function executeAutomaticStep(workspaceId: string, step: { tool: string; input: Record<string, unknown> }): Promise<{ output: Record<string, unknown> }> {
  switch (step.tool) {
    case 'customer.lookup': {
      const query = String(step.input.query || '').slice(0, 120);
      const { data, error } = await supabaseAdmin.from('customers')
        .select('id,display_name,phone,email,source')
        .eq('workspace_id', workspaceId).is('deleted_at', null)
        .or(`display_name.ilike.%${query.replace(/[%_,]/g, '')}%,email.ilike.%${query.replace(/[%_,]/g, '')}%`)
        .limit(5);
      if (error) throw new Error('CUSTOMER_LOOKUP_FAILED');
      return { output: { customers: data ?? [] } };
    }
    case 'quote.draft': {
      const serviceIds = Array.isArray(step.input.serviceIds) ? (step.input.serviceIds as string[]) : [];
      const customerId = String(step.input.customerId || '');
      if (!customerId || !serviceIds.length) throw new Error('QUOTE_DRAFT_INPUT_INVALID');
      const { data: services, error } = await supabaseAdmin.from('services')
        .select('id,name,base_price_cents,pricing_mode')
        .eq('workspace_id', workspaceId).in('id', serviceIds).limit(50);
      if (error || !services?.length) throw new Error('QUOTE_DRAFT_SERVICES_NOT_FOUND');
      const items = services.map((service: any, index: number) => ({
        description: service.name, quantity: 1, unit_price_cents: Number(service.base_price_cents || 0), gst_rate: 0.1, sort_order: index,
      }));
      const totals = items.reduce((acc: { subtotal: number; gst: number }, item) => {
        const lineSubtotal = Math.round(item.quantity * item.unit_price_cents);
        return { subtotal: acc.subtotal + lineSubtotal, gst: acc.gst + Math.round(lineSubtotal * item.gst_rate) };
      }, { subtotal: 0, gst: 0 });
      const { data: quote, error: quoteError } = await supabaseAdmin.from('quotes').insert({
        workspace_id: workspaceId, customer_id: customerId, subtotal_cents: totals.subtotal, gst_cents: totals.gst,
        total_cents: totals.subtotal + totals.gst, status: 'draft', notes: 'Drafted by a Jobrin.ai automation. Review before sending.',
      }).select('id,quote_number').single();
      if (quoteError) throw new Error('QUOTE_DRAFT_FAILED');
      const { error: itemError } = await supabaseAdmin.from('quote_items').insert(items.map((item) => ({ ...item, workspace_id: workspaceId, quote_id: quote.id })));
      if (itemError) {
        await supabaseAdmin.from('quotes').delete().eq('workspace_id', workspaceId).eq('id', quote.id);
        throw new Error('QUOTE_DRAFT_FAILED');
      }
      return { output: { quoteId: quote.id, quoteNumber: quote.quote_number } };
    }
    case 'review.request': {
      const jobId = String(step.input.jobId || '');
      const channel = step.input.channel === 'email' ? 'email' : 'sms';
      if (!jobId) throw new Error('REVIEW_REQUEST_INPUT_INVALID');
      const { data: job, error: jobError } = await supabaseAdmin.from('jobs').select('id,customer_id').eq('workspace_id', workspaceId).eq('id', jobId).maybeSingle();
      if (jobError || !job?.customer_id) throw new Error('REVIEW_REQUEST_JOB_NOT_FOUND');
      const { data: request, error } = await supabaseAdmin.from('review_requests').insert({
        workspace_id: workspaceId, customer_id: job.customer_id, job_id: job.id, channel, status: 'queued',
      }).select('id,status').single();
      if (error) throw new Error('REVIEW_REQUEST_CREATE_FAILED');
      return { output: { reviewRequestId: request.id, status: request.status, note: 'Delivery starts once the messaging provider is configured.' } };
    }
    case 'availability.check': {
      const serviceId = step.input.serviceId ? String(step.input.serviceId) : null;
      const from = new Date(String(step.input.from || ''));
      const to = new Date(String(step.input.to || ''));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new Error('AVAILABILITY_CHECK_INPUT_INVALID');
      let durationMinutes = 60;
      if (serviceId) {
        const { data: service } = await supabaseAdmin.from('services').select('default_duration_minutes').eq('workspace_id', workspaceId).eq('id', serviceId).maybeSingle();
        if (service?.default_duration_minutes) durationMinutes = Number(service.default_duration_minutes);
      }
      // Reuses the same slot-generation logic and busy-range sources as public
      // booking availability (server/routes/public.ts) so an automation's view
      // of "free" matches what a customer is offered — including the
      // workspace's own configured timezone rather than a hardcoded default.
      const [profileResult, rulesResult, busyAppointments, busyJobs] = await Promise.all([
        supabaseAdmin.from('business_profiles').select('timezone').eq('workspace_id', workspaceId).maybeSingle(),
        supabaseAdmin.from('business_hours').select('weekday,opens_at,closes_at,closed').eq('workspace_id', workspaceId).in('schedule_type', ['booking', 'business']),
        supabaseAdmin.from('appointments').select('starts_at,ends_at').eq('workspace_id', workspaceId).in('status', ['hold', 'scheduled', 'confirmed']).gte('starts_at', new Date(Date.now() - 86_400_000).toISOString()),
        supabaseAdmin.from('jobs').select('scheduled_start,scheduled_end').eq('workspace_id', workspaceId).not('scheduled_start', 'is', null).in('status', ['new', 'scheduled', 'on_the_way', 'in_progress']),
      ]);
      const timeZone = profileResult.data?.timezone || 'Australia/Adelaide';
      const busyRanges = [
        ...(busyAppointments.data ?? []).map((row: any) => ({ start: row.starts_at, end: row.ends_at })),
        ...(busyJobs.data ?? []).filter((row: any) => row.scheduled_end).map((row: any) => ({ start: row.scheduled_start, end: row.scheduled_end })),
      ];
      const days = Math.max(1, Math.min(30, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)));
      const slots = generateBookingSlots((rulesResult.data ?? []) as BusinessHourRule[], durationMinutes, from, busyRanges, timeZone, days)
        .filter((slot) => new Date(slot.start) <= to);
      return { output: { slots } };
    }
    case 'business.report': {
      const [{ data: payments, error: paymentsError }, { data: invoices, error: invoicesError }] = await Promise.all([
        supabaseAdmin.from('payments').select('amount_cents').eq('workspace_id', workspaceId).eq('status', 'succeeded'),
        supabaseAdmin.from('invoices').select('balance_due_cents').eq('workspace_id', workspaceId).in('status', ['sent', 'viewed', 'part_paid', 'overdue']),
      ]);
      if (paymentsError || invoicesError) throw new Error('BUSINESS_REPORT_FAILED');
      const revenueCents = (payments ?? []).reduce((sum: number, row: any) => sum + Number(row.amount_cents || 0), 0);
      const outstandingCents = (invoices ?? []).reduce((sum: number, row: any) => sum + Number(row.balance_due_cents || 0), 0);
      return { output: { revenueCents, outstandingCents, question: String(step.input.question || '').slice(0, 500) } };
    }
    default:
      throw new Error('TOOL_NOT_EXECUTABLE');
  }
}

// --- Event-driven triggering -------------------------------------------
// Turns a business event (a job completed, a lead created, ...) into a
// queued automation_runs row with real inputs, instead of the empty
// `input: {}` the automation builder saves. Scoped like the manual "Run"
// route above: no generic rule engine, just a documented, narrow mapping.

// Fields a business event may carry that a step's saved input is allowed to
// be hydrated with when the step didn't already have that field configured.
// This is a deliberately small, documented allowlist — not a generic merge
// of arbitrary event payload keys into step input.
const EVENT_INPUT_FIELDS = ['jobId', 'customerId', 'leadId', 'appointmentId', 'invoiceId'] as const;

type SimpleCondition = { field: string; operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: unknown };

// The `automations.definition.conditions` column is a free-form
// `Record<string, unknown>[]` at the schema level (see the zod schema in
// server/routes/intelligence.ts) — there is no documented generic condition
// language. We support exactly one shape here: { field, operator, value }.
// Anything else is logged and skipped rather than guessed at, so an
// automation with an unsupported condition degrades to "always runs" for
// that clause instead of silently misbehaving.
function isSimpleCondition(raw: unknown): raw is SimpleCondition {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as Record<string, unknown>;
  return typeof c.field === 'string' && typeof c.operator === 'string' &&
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(c.operator) && 'value' in c;
}

export function evaluateConditions(conditions: unknown[], payload: Record<string, unknown>): boolean {
  for (const raw of conditions) {
    if (!isSimpleCondition(raw)) {
      console.warn(JSON.stringify({ level: 'warn', component: 'automation_trigger', message: 'Unsupported trigger condition shape skipped', condition: raw }));
      continue;
    }
    const actual = payload[raw.field];
    switch (raw.operator) {
      case 'eq': if (actual !== raw.value) return false; break;
      case 'neq': if (actual === raw.value) return false; break;
      case 'gt': if (!(Number(actual) > Number(raw.value))) return false; break;
      case 'gte': if (!(Number(actual) >= Number(raw.value))) return false; break;
      case 'lt': if (!(Number(actual) < Number(raw.value))) return false; break;
      case 'lte': if (!(Number(actual) <= Number(raw.value))) return false; break;
    }
  }
  return true;
}

export function buildStepInput(step: { tool?: string; input?: Record<string, unknown> }, payload: Record<string, unknown>) {
  const input: Record<string, unknown> = { ...(step.input ?? {}) };
  for (const field of EVENT_INPUT_FIELDS) {
    if (input[field] === undefined && payload[field] !== undefined) input[field] = payload[field];
  }
  return input;
}

export type AutomationEventType = 'lead.created' | 'appointment.completed' | 'job.completed' | 'invoice.overdue';

// Looks up active automations in `workspaceId` whose trigger_key matches
// `eventType`, evaluates each automation's saved conditions against
// `payload`, and — for the ones that pass — queues an automation_runs row
// whose step inputs are hydrated from the event payload. Cron/schedule
// triggers (`trigger_key = 'schedule.cron'`) are intentionally out of scope
// here; nothing dispatches those.
//
// Callers must treat this as best-effort: it never throws, so a dispatch
// failure never breaks the request that produced the business event.
export async function queueAutomationRun(
  workspaceId: string,
  eventType: AutomationEventType,
  payload: Record<string, unknown>,
): Promise<{ queued: number }> {
  try {
    if (!workspaceId) return { queued: 0 };
    // Matches the plan gate the manual-run route enforces via
    // requireActiveSubscription('ai.basic') — this path runs outside a
    // request context, so it checks the same entitlement directly.
    const { data: entitlement } = await supabaseAdmin.from('subscription_entitlements')
      .select('enabled').eq('workspace_id', workspaceId).eq('feature_key', 'ai.basic').maybeSingle();
    if (!entitlement?.enabled) return { queued: 0 };

    const { data: automations, error } = await supabaseAdmin.from('automations')
      .select('id,definition,retry_policy')
      .eq('workspace_id', workspaceId).eq('status', 'active').eq('trigger_key', eventType);
    if (error || !automations?.length) return { queued: 0 };

    let queued = 0;
    for (const automation of automations) {
      const definition = (automation.definition ?? {}) as { conditions?: unknown[]; steps?: Array<{ tool: string; input?: Record<string, unknown> }> };
      const conditions = Array.isArray(definition.conditions) ? definition.conditions : [];
      if (!evaluateConditions(conditions, payload)) continue;

      const steps = Array.isArray(definition.steps) ? definition.steps : [];
      const hydratedSteps = steps.map((step) => ({ tool: step.tool, input: buildStepInput(step, payload) }));
      const maxAttempts = Number((automation.retry_policy as any)?.maxAttempts || 5);
      const dedupeKey = String(payload.jobId ?? payload.leadId ?? payload.appointmentId ?? payload.invoiceId ?? '');
      const idempotencyKey = dedupeKey ? `event:${eventType}:${automation.id}:${dedupeKey}` : null;

      const { error: insertError } = await supabaseAdmin.from('automation_runs').insert({
        workspace_id: workspaceId, automation_id: automation.id, max_attempts: maxAttempts,
        idempotency_key: idempotencyKey,
        state: { source: 'event', eventType, hydratedSteps },
      });
      if (!insertError) queued++;
      else if (!/duplicate key|unique constraint/i.test(insertError.message || '')) {
        console.error(JSON.stringify({ level: 'error', component: 'automation_trigger', message: 'Failed to queue automation run', automationId: automation.id, error: insertError.message.slice(0, 200) }));
      }
    }
    return { queued };
  } catch (error: any) {
    console.error(JSON.stringify({ level: 'error', component: 'automation_trigger', message: 'Event dispatch failed', eventType, error: String(error?.message || error).slice(0, 200) }));
    return { queued: 0 };
  }
}

export async function processAutomationRuns(limit = 5) {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    const { data: runs, error } = await supabaseAdmin.from('automation_runs')
      .select('id,workspace_id,automation_id,attempt_count,max_attempts,state')
      .in('status', ['queued', 'failed'])
      .lte('next_attempt_at', new Date().toISOString())
      .order('created_at')
      .limit(limit);
    if (error) throw new Error('AUTOMATION_RUN_QUEUE_READ_FAILED');

    for (const run of runs ?? []) {
      const attempt = Number(run.attempt_count || 0) + 1;
      const { data: claimed } = await supabaseAdmin.from('automation_runs')
        .update({ status: 'running', attempt_count: attempt, started_at: run.state?.started_at ?? new Date().toISOString() })
        .eq('id', run.id).in('status', ['queued', 'failed'])
        .select('id').maybeSingle();
      if (!claimed) continue;

      try {
        const { data: automation, error: automationError } = await supabaseAdmin.from('automations')
          .select('id,status,definition,approval_policy,retry_policy')
          .eq('workspace_id', run.workspace_id).eq('id', run.automation_id).maybeSingle();
        if (automationError || !automation) throw new Error('AUTOMATION_NOT_FOUND');
        if (automation.status !== 'active') {
          await supabaseAdmin.from('automation_runs').update({ status: 'cancelled', completed_at: new Date().toISOString(), last_error: 'AUTOMATION_NOT_ACTIVE' }).eq('id', run.id);
          processed++;
          continue;
        }

        // Entitlement is checked when a run is queued (queueAutomationRun) or
        // manually requested (requireActiveSubscription('ai.basic') in
        // server/routes/intelligence.ts) — but a run can sit in 'waiting' for
        // an arbitrarily long time on approval, and the workspace's plan can
        // change in the meantime. Re-check the same entitlement here, right
        // before any step actually executes, so a downgraded/lapsed
        // workspace's queued or approved work does not silently run anyway.
        const { data: entitlement } = await supabaseAdmin.from('subscription_entitlements')
          .select('enabled').eq('workspace_id', run.workspace_id).eq('feature_key', 'ai.basic').maybeSingle();
        if (!entitlement?.enabled) {
          await supabaseAdmin.from('automation_runs').update({ status: 'cancelled', completed_at: new Date().toISOString(), last_error: 'ENTITLEMENT_REVOKED' }).eq('id', run.id);
          processed++;
          continue;
        }

        // A run that was previously blocked on approval comes back through
        // this same queue once it is decided (see the /approvals/:id/decision
        // route), still carrying its prior state. Steps already recorded as
        // 'completed' must not be repeated (their side effects — e.g. an SMS
        // — already happened); a step recorded as 'awaiting_approval' is
        // re-checked against the real approval decision before it runs.
        const definitionSteps = (automation.definition?.steps ?? []) as Array<{ tool: string; input: Record<string, unknown> }>;
        const hydratedSteps = Array.isArray((run.state as any)?.hydratedSteps)
          ? ((run.state as any).hydratedSteps as Array<{ tool: string; input: Record<string, unknown> }>)
          : null;
        // Event-triggered runs carry per-run inputs built from the triggering
        // payload (see queueAutomationRun); manual runs fall back to the
        // automation's saved (often still-empty) step input.
        const steps = definitionSteps.map((step, index) => ({
          tool: step.tool,
          input: hydratedSteps?.[index]?.tool === step.tool ? hydratedSteps[index].input : step.input,
        }));
        const previousSteps = Array.isArray((run.state as any)?.steps) ? ((run.state as any).steps as Array<Record<string, unknown>>) : [];
        const results: Array<Record<string, unknown>> = [];
        let waitingForApproval = false;

        for (let index = 0; index < steps.length; index++) {
          const step = steps[index];
          const prior = previousSteps[index];

          if (prior?.status === 'completed') {
            // Already executed on an earlier attempt (e.g. before a later
            // step paused for approval) — reuse the recorded result.
            results.push(prior);
            continue;
          }

          if (prior?.status === 'awaiting_approval') {
            const { data: approval } = await supabaseAdmin.from('approvals')
              .select('status').eq('workspace_id', run.workspace_id).eq('resource_type', 'automation_step')
              .eq('resource_id', run.id).eq('ai_action_id', String(prior.aiActionId ?? '')).maybeSingle();
            if (approval?.status === 'rejected') throw new Error('APPROVAL_REJECTED');
            if (approval?.status !== 'approved') {
              // Not decided yet — this run should not have been requeued, but
              // stay parked rather than re-running or erroring.
              results.push(prior);
              waitingForApproval = true;
              break;
            }
            // Approved: fall through and execute the step now.
          }

          const classified = classifyAutomationStep(step.tool);
          if (classified.stepClass === 'denied') {
            throw new Error(`TOOL_NOT_ALLOWED:${step.tool}`);
          }
          if (classified.stepClass === 'approval' && prior?.status !== 'awaiting_approval') {
            const { data: action } = await supabaseAdmin.from('ai_actions').insert({
              workspace_id: run.workspace_id, requested_by: 'automation', actor_type: 'automation_worker',
              tool_name: step.tool, risk_level: classified.risk, input: step.input,
              approval_required: true, status: 'awaiting_approval',
            }).select('id').single();
            await supabaseAdmin.from('approvals').insert({
              workspace_id: run.workspace_id, ai_action_id: action?.id ?? null,
              resource_type: 'automation_step', resource_id: run.id,
              reason: `Automation step "${step.tool}" needs human approval before it runs.`,
            });
            void writeNotification(
              run.workspace_id, 'automation.approval_needed',
              'An automation is waiting for your approval',
              `Automation step "${step.tool}" needs a human decision before it runs.`,
              'automation_step', run.id,
            );
            results.push({ tool: step.tool, status: 'awaiting_approval', aiActionId: action?.id ?? null });
            waitingForApproval = true;
            // Stop here: later steps must not run ahead of one still waiting
            // on a human decision.
            break;
          }
          const { output } = await executeAutomaticStep(run.workspace_id, step);
          results.push({ tool: step.tool, status: 'completed', output });
        }

        const now = new Date().toISOString();
        await supabaseAdmin.from('automation_attempts').insert({
          workspace_id: run.workspace_id, run_id: run.id, attempt_number: attempt, status: 'completed',
          input: {}, output: { waitingForApproval, steps: results }, started_at: now, completed_at: now,
        });
        await supabaseAdmin.from('automation_runs').update({
          status: waitingForApproval ? 'waiting' : 'completed',
          completed_at: waitingForApproval ? null : now,
          last_error: null,
          state: { ...(run.state ?? {}), steps: results },
        }).eq('id', run.id);
        processed++;
      } catch (error: any) {
        const message = String(error?.message || 'AUTOMATION_STEP_FAILED');
        // A rejected approval is a terminal outcome, not a transient failure —
        // never retry it. (In practice the approval decision route already
        // moves a rejected run straight to 'cancelled' without requeueing it,
        // so this is a safety net for a run that reaches here some other way.)
        const exhausted = message === 'APPROVAL_REJECTED' || attempt >= Number(run.max_attempts || 5);
        const backoffSeconds = Math.min(3600, 30 * 2 ** attempt);
        const failedAt = new Date().toISOString();
        await supabaseAdmin.from('automation_attempts').insert({
          workspace_id: run.workspace_id, run_id: run.id, attempt_number: attempt, status: 'failed',
          error_code: message.split(':')[0].slice(0, 120), error_message: message.slice(0, 1000),
          started_at: failedAt, completed_at: failedAt,
        }).then(() => undefined, () => undefined);
        await supabaseAdmin.from('automation_runs').update({
          // Cancelled is terminal and excluded from future queue scans. The
          // exhausted flag and last_error preserve the dead-letter reason.
          status: exhausted ? 'cancelled' : 'failed',
          last_error: message.slice(0, 1000),
          next_attempt_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
          state: exhausted ? { ...(run.state ?? {}), exhausted: true } : (run.state ?? {}),
        }).eq('id', run.id);
      }
    }
    return { processed };
  } finally {
    running = false;
  }
}

export function startAutomationRunner() {
  // A failed tick (database down, transient Supabase error) must never
  // become an unhandled rejection that kills the HTTP server: log it and
  // let the next interval retry. The error still propagates from
  // processAutomationRuns itself, so the Cloudflare cron path (waitUntil)
  // keeps its failure visibility.
  const runSafely = () => {
    void processAutomationRuns().catch((error) => {
      console.error(JSON.stringify({ level: 'error', component: 'automation_runner', message: 'Automation tick failed; retrying next interval', error: String((error as Error)?.message || error).slice(0, 200) }));
    });
    // Reuses this same tick rather than a second interval timer -- the
    // workspace deletion purge has no tighter latency requirement than the
    // automation queue does, and failures here must stay isolated from the
    // automation queue's own failures (hence the separate catch).
    void purgeScheduledWorkspaceDeletions().catch((error) => {
      console.error(JSON.stringify({ level: 'error', component: 'workspace_purge', message: 'Workspace purge tick failed; retrying next interval', error: String((error as Error)?.message || error).slice(0, 200) }));
    });
  };
  const timer = setInterval(runSafely, 30_000);
  timer.unref();
  runSafely();
  return timer;
}
