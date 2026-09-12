import crypto from 'node:crypto';
import { supabaseAdmin } from '../supabase';
import { toolByName, requiresApproval, canExecute, operatorTools } from '../ai/toolRegistry';
import { generateBookingSlots, type BusinessHourRule } from '../routes/public';

// Automation executor: processes the automation_runs queue that the Business
// Brain worker alone previously left untouched. Runs are claimed atomically,
// retried with exponential backoff and dead-lettered once attempts are
// exhausted. "Safe autopilot" policy is enforced here, not in the UI:
// - automatic tools execute directly (draft, read, queue review request)
// - policy_controlled / approval_required tools stop for a human approval
// - prohibited or unknown tools are never executed

let running = false;

// A run claimed into 'running' that never reports back (crash, process kill)
// would otherwise sit stuck forever. There is no separate lease/claim column,
// so we reuse `started_at` (set at claim time) as the lease timestamp and
// requeue anything older than this at the top of every sweep.
const LEASE_TIMEOUT_MS = 10 * 60 * 1000;

export type StepClass = 'execute' | 'approval' | 'denied';

export type AutomationTriggerKey = 'lead.created' | 'appointment.completed' | 'job.completed' | 'invoice.overdue' | 'schedule.cron';

export type RunState = {
  source?: string;
  requestedBy?: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  started_at?: string;
  exhausted?: boolean;
  stepIndex?: number;
  results?: Array<Record<string, unknown>>;
  pendingApproval?: { stepIndex: number; approvalId: string; aiActionId: string | null };
};

export function classifyAutomationStep(toolName: string): { stepClass: StepClass; risk: string } {
  const tool = toolByName(toolName);
  if (!tool || tool.risk === 'prohibited') return { stepClass: 'denied', risk: 'prohibited' };
  if (tool.risk === 'automatic') return { stepClass: 'execute', risk: 'low' };
  // review.request only stages an internal queued record — nothing contacts a
  // customer until delivery providers are configured and the owner sends it.
  if (toolName === 'review.request') return { stepClass: 'execute', risk: 'low' };
  if (requiresApproval(toolName)) return { stepClass: 'approval', risk: 'high' };
  if (canExecute(toolName)) return { stepClass: 'approval', risk: 'medium' };
  return { stepClass: 'denied', risk: 'prohibited' };
}

// -----------------------------------------------------------------------------
// A08: turning a business event into a queued run with real inputs
// -----------------------------------------------------------------------------

// Documented, deliberately narrow subset of trigger conditions this dispatcher
// can evaluate safely: { field, op, value } where `field` is looked up on the
// event payload. Any condition that doesn't match this shape is unsupported —
// we log and skip queueing that automation rather than guess its intent.
type SimpleCondition = { field: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: unknown };

function isSimpleCondition(value: unknown): value is SimpleCondition {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.field === 'string' && typeof record.op === 'string' &&
    ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(record.op as string) && 'value' in record;
}

export function evaluateConditions(conditions: unknown, payload: Record<string, unknown>): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  for (const condition of conditions) {
    if (!isSimpleCondition(condition)) {
      console.warn(`[automation] skipping automation with unsupported trigger condition shape: ${JSON.stringify(condition)}`);
      return false;
    }
    const actual = payload[condition.field];
    const expected = condition.value;
    let pass: boolean;
    switch (condition.op) {
      case 'eq': pass = actual === expected; break;
      case 'neq': pass = actual !== expected; break;
      case 'gt': pass = Number(actual) > Number(expected); break;
      case 'gte': pass = Number(actual) >= Number(expected); break;
      case 'lt': pass = Number(actual) < Number(expected); break;
      case 'lte': pass = Number(actual) <= Number(expected); break;
      default: pass = false;
    }
    if (!pass) return false;
  }
  return true;
}

// Maps well-known event payload fields onto a step's declared input needs.
// This is a documented subset, not a generic mapper: only the fields these
// specific tools are known to need are copied across.
export function mapEventPayloadToStepInput(toolName: string, payload: Record<string, unknown>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const serviceIds = Array.isArray(payload.serviceIds) ? payload.serviceIds : (payload.serviceId ? [payload.serviceId] : undefined);
  switch (toolName) {
    case 'review.request':
      if (payload.jobId) mapped.jobId = payload.jobId;
      break;
    case 'quote.draft':
      if (payload.customerId) mapped.customerId = payload.customerId;
      if (payload.jobId) mapped.jobId = payload.jobId;
      if (serviceIds) mapped.serviceIds = serviceIds;
      break;
    case 'customer.lookup':
      if (payload.customerId) mapped.query = String(payload.customerId);
      break;
    case 'availability.check':
      if (serviceIds?.[0]) mapped.serviceId = serviceIds[0];
      mapped.from = new Date().toISOString();
      mapped.to = new Date(Date.now() + 7 * 86_400_000).toISOString();
      break;
    case 'appointment.book':
    case 'message.send_template':
      if (payload.customerId) mapped.customerId = payload.customerId;
      break;
    default:
      break;
  }
  return mapped;
}

// Queues an automation_runs row for every active automation in `workspaceId`
// whose trigger matches `eventType`, with concrete per-step inputs built from
// the event payload. Best-effort by design: dispatch must never break the
// business operation (job completion, lead creation, ...) that produced it.
export async function queueAutomationRun(workspaceId: string, eventType: AutomationTriggerKey, payload: Record<string, unknown>): Promise<void> {
  try {
    // Mirrors requireActiveSubscription('ai.basic') on the manual-run route:
    // an event must not queue automation work a workspace's plan doesn't include.
    const { data: entitlement } = await supabaseAdmin.from('subscription_entitlements')
      .select('enabled').eq('workspace_id', workspaceId).eq('feature_key', 'ai.basic').maybeSingle();
    if (!entitlement?.enabled) return;

    const { data: automations, error } = await supabaseAdmin.from('automations')
      .select('id,definition,retry_policy')
      .eq('workspace_id', workspaceId).eq('status', 'active').eq('trigger_key', eventType);
    if (error || !automations?.length) return;

    for (const automation of automations) {
      const definition = automation.definition as { conditions?: unknown; steps?: Array<{ tool: string; input?: Record<string, unknown> }> } | null;
      if (!evaluateConditions(definition?.conditions, payload)) continue;
      const steps = definition?.steps ?? [];
      if (!steps.length) continue;
      const invalidTool = steps.find((step) => !operatorTools.some((tool) => tool.name === step.tool) || operatorTools.find((tool) => tool.name === step.tool)?.risk === 'prohibited');
      if (invalidTool) { console.warn(`[automation] skipping run for automation ${automation.id}: tool ${invalidTool.tool} is not in the allowed tool set`); continue; }

      const maxAttempts = Number((automation.retry_policy as any)?.maxAttempts || 5);
      const dedupeKey = String(payload.jobId ?? payload.leadId ?? payload.appointmentId ?? payload.invoiceId ?? crypto.randomUUID());
      const idempotencyKey = `event:${eventType}:${automation.id}:${dedupeKey}`;
      await supabaseAdmin.from('automation_runs').insert({
        workspace_id: workspaceId,
        automation_id: automation.id,
        idempotency_key: idempotencyKey,
        max_attempts: maxAttempts,
        state: { source: 'event', eventType, payload } satisfies RunState,
      });
    }
  } catch (err) {
    console.warn('[automation] queueAutomationRun failed (best-effort, ignored):', err);
  }
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
    case 'availability.check': {
      const serviceId = step.input.serviceId ? String(step.input.serviceId) : undefined;
      const from = step.input.from ? new Date(String(step.input.from)) : new Date();
      if (Number.isNaN(from.getTime())) throw new Error('AVAILABILITY_CHECK_INPUT_INVALID');
      const to = step.input.to ? new Date(String(step.input.to)) : null;

      let durationMinutes = 60;
      if (serviceId) {
        const { data: service } = await supabaseAdmin.from('services').select('default_duration_minutes').eq('workspace_id', workspaceId).eq('id', serviceId).maybeSingle();
        if (service?.default_duration_minutes) durationMinutes = Number(service.default_duration_minutes);
      }
      const [rulesResult, busyAppointments, busyJobs] = await Promise.all([
        supabaseAdmin.from('business_hours').select('weekday,opens_at,closes_at,closed').eq('workspace_id', workspaceId).in('schedule_type', ['booking', 'business']),
        supabaseAdmin.from('appointments').select('starts_at,ends_at').eq('workspace_id', workspaceId).in('status', ['hold', 'scheduled', 'confirmed']).gte('starts_at', new Date(Date.now() - 86_400_000).toISOString()),
        supabaseAdmin.from('jobs').select('scheduled_start,scheduled_end').eq('workspace_id', workspaceId).not('scheduled_start', 'is', null).in('status', ['new', 'scheduled', 'on_the_way', 'in_progress']),
      ]);
      const busyRanges = [
        ...(busyAppointments.data ?? []).map((row: any) => ({ start: row.starts_at, end: row.ends_at })),
        ...(busyJobs.data ?? []).filter((row: any) => row.scheduled_end).map((row: any) => ({ start: row.scheduled_start, end: row.scheduled_end })),
      ];
      const slots = generateBookingSlots((rulesResult.data ?? []) as BusinessHourRule[], durationMinutes, from, busyRanges);
      const filtered = to && !Number.isNaN(to.getTime()) ? slots.filter((slot) => new Date(slot.start) <= to) : slots;
      return { output: { slots: filtered } };
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

// Requeues runs claimed into 'running' whose lease has expired (the process
// that claimed them died or hung mid-step) so they are picked up again by the
// normal queued/failed selection below. Their checkpoint (state.stepIndex /
// state.results) is left untouched, so the retry resumes rather than restarts.
async function reapExpiredLeases(): Promise<void> {
  const staleBefore = new Date(Date.now() - LEASE_TIMEOUT_MS).toISOString();
  await supabaseAdmin.from('automation_runs')
    .update({ status: 'queued' })
    .eq('status', 'running')
    .lt('started_at', staleBefore);
}

export async function processAutomationRuns(limit = 5) {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    await reapExpiredLeases();

    // NOTE on the exhausted filter: `state` is a freeform jsonb column and a
    // freshly-queued run's state only has {source, requester} — no `exhausted`
    // key. `state->>exhausted <> 'true'` is NULL (not true) for such rows in
    // Postgres, so a plain .neq() silently drops them. The .or() below treats
    // "key absent" and "key present and not true" as the same "retryable" case.
    const { data: runs, error } = await supabaseAdmin.from('automation_runs')
      .select('id,workspace_id,automation_id,attempt_count,max_attempts,state')
      .in('status', ['queued', 'failed'])
      .lte('next_attempt_at', new Date().toISOString())
      .or('state->>exhausted.is.null,state->>exhausted.neq.true')
      .order('created_at')
      .limit(limit);
    if (error) throw new Error('AUTOMATION_RUN_QUEUE_READ_FAILED');

    for (const run of runs ?? []) {
      const attempt = Number(run.attempt_count || 0) + 1;
      const { data: claimed } = await supabaseAdmin.from('automation_runs')
        .update({ status: 'running', attempt_count: attempt, started_at: new Date().toISOString() })
        .eq('id', run.id).in('status', ['queued', 'failed'])
        .select('id').maybeSingle();
      if (!claimed) continue;

      const state = (run.state ?? {}) as RunState;
      let stepIndex = Number(state.stepIndex ?? 0);
      const results: Array<Record<string, unknown>> = Array.isArray(state.results) ? [...state.results] : [];
      let waitingForApproval = false;
      let pendingApproval = state.pendingApproval;

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

        const steps = (automation.definition?.steps ?? []) as Array<{ tool: string; input: Record<string, unknown> }>;

        try {
          for (; stepIndex < steps.length; stepIndex++) {
            const step = steps[stepIndex];
            const classified = classifyAutomationStep(step.tool);
            if (classified.stepClass === 'denied') {
              throw new Error(`TOOL_NOT_ALLOWED:${step.tool}`);
            }
            if (classified.stepClass === 'approval') {
              // Resuming past a step whose approval was already decided (the
              // approvals endpoint only flips a run back to 'queued' once it
              // has): treat it as resolved instead of staging a duplicate.
              if (pendingApproval && pendingApproval.stepIndex === stepIndex) {
                const { data: approval } = await supabaseAdmin.from('approvals').select('status').eq('id', pendingApproval.approvalId).maybeSingle();
                if (approval?.status === 'approved') {
                  results.push({ tool: step.tool, status: 'completed', output: { approvedBy: 'human', approvalId: pendingApproval.approvalId } });
                  pendingApproval = undefined;
                  continue;
                }
              }
              const { data: action } = await supabaseAdmin.from('ai_actions').insert({
                workspace_id: run.workspace_id, requested_by: 'automation', actor_type: 'automation_worker',
                tool_name: step.tool, risk_level: classified.risk, input: step.input,
                approval_required: true, status: 'awaiting_approval',
              }).select('id').single();
              const { data: approvalRow } = await supabaseAdmin.from('approvals').insert({
                workspace_id: run.workspace_id, ai_action_id: action?.id ?? null,
                resource_type: 'automation_step', resource_id: run.id,
                reason: `Automation step "${step.tool}" needs human approval before it runs.`,
              }).select('id').single();
              results.push({ tool: step.tool, status: 'awaiting_approval', aiActionId: action?.id ?? null });
              waitingForApproval = true;
              pendingApproval = approvalRow ? { stepIndex, approvalId: approvalRow.id, aiActionId: action?.id ?? null } : undefined;
              break;
            }
            // Event-sourced runs (state.payload set by queueAutomationRun) have
            // their declared-but-empty step.input filled from the event payload
            // at execution time; manual runs simply keep whatever input.
            const input = { ...step.input, ...(state.source === 'event' ? mapEventPayloadToStepInput(step.tool, state.payload ?? {}) : {}) };
            const { output } = await executeAutomaticStep(run.workspace_id, { tool: step.tool, input });
            results.push({ tool: step.tool, status: 'completed', output });
          }
        } catch (stepError) {
          // Checkpoint what actually completed before this step failed, so a
          // retry resumes here instead of repeating already-succeeded,
          // side-effecting steps (e.g. re-sending a review request).
          await supabaseAdmin.from('automation_runs').update({
            state: { ...state, stepIndex, results, pendingApproval } satisfies RunState,
          }).eq('id', run.id);
          throw stepError;
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
          state: { ...state, stepIndex, results, pendingApproval } satisfies RunState,
        }).eq('id', run.id);
        processed++;
      } catch (error: any) {
        const message = String(error?.message || 'AUTOMATION_STEP_FAILED');
        const exhausted = attempt >= Number(run.max_attempts || 5);
        const backoffSeconds = Math.min(3600, 30 * 2 ** attempt);
        const failedAt = new Date().toISOString();
        await supabaseAdmin.from('automation_attempts').insert({
          workspace_id: run.workspace_id, run_id: run.id, attempt_number: attempt, status: 'failed',
          error_code: message.split(':')[0].slice(0, 120), error_message: message.slice(0, 1000),
          started_at: failedAt, completed_at: failedAt,
        }).then(() => undefined, () => undefined);
        await supabaseAdmin.from('automation_runs').update({
          status: 'failed',
          last_error: message.slice(0, 1000),
          next_attempt_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
          state: { ...state, stepIndex, results, pendingApproval, ...(exhausted ? { exhausted: true } : {}) } satisfies RunState,
        }).eq('id', run.id);
      }
    }
    return { processed };
  } finally {
    running = false;
  }
}

export function startAutomationRunner() {
  const timer = setInterval(() => { void processAutomationRuns(); }, 30_000);
  timer.unref();
  void processAutomationRuns();
  return timer;
}
