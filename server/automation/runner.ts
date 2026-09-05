import { supabaseAdmin } from '../supabase';
import { toolByName, requiresApproval, canExecute } from '../ai/toolRegistry';

// Automation executor: processes the automation_runs queue that the Business
// Brain worker alone previously left untouched. Runs are claimed atomically,
// retried with exponential backoff and dead-lettered once attempts are
// exhausted. "Safe autopilot" policy is enforced here, not in the UI:
// - automatic tools execute directly (draft, read, queue review request)
// - policy_controlled / approval_required tools stop for a human approval
// - prohibited or unknown tools are never executed

let running = false;

export type StepClass = 'execute' | 'approval' | 'denied';

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

export async function processAutomationRuns(limit = 5) {
  if (running) return { processed: 0 };
  running = true;
  let processed = 0;
  try {
    const { data: runs, error } = await supabaseAdmin.from('automation_runs')
      .select('id,workspace_id,automation_id,attempt_count,max_attempts,state')
      .in('status', ['queued', 'failed'])
      .lte('next_attempt_at', new Date().toISOString())
      .neq('state->>exhausted', 'true')
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

        const steps = (automation.definition?.steps ?? []) as Array<{ tool: string; input: Record<string, unknown> }>;
        const results: Array<Record<string, unknown>> = [];
        let waitingForApproval = false;

        for (const step of steps) {
          const classified = classifyAutomationStep(step.tool);
          if (classified.stepClass === 'denied') {
            throw new Error(`TOOL_NOT_ALLOWED:${step.tool}`);
          }
          if (classified.stepClass === 'approval') {
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
            results.push({ tool: step.tool, status: 'awaiting_approval', aiActionId: action?.id ?? null });
            waitingForApproval = true;
            continue;
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
  const timer = setInterval(() => { void processAutomationRuns(); }, 30_000);
  timer.unref();
  void processAutomationRuns();
  return timer;
}
