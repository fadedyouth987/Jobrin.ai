import { env } from '../env';
import { openaiConfigured } from '../providers/openai';
import { openaiChat } from './receptionistCall';
import { consumeWorkspaceUsageForWorkspace, supabaseAdmin } from '../supabase';

// AI post-work recaps: once a job is marked completed, draft a plain-English
// work summary the owner can review, edit, keep on the record, and/or send
// to the customer. This is a single bounded OpenAI call per completed job —
// no retry loop, no chat history — and it is metered through the same
// usage.ai_actions cap every other AI action respects. It is intentionally
// draft-only: nothing here contacts the customer or requires the automation
// approval machinery, because the output is never final until a human
// reviews and explicitly approves/sends it (server/routes/operations.ts's
// /jobs/:id/recap/send route).

const MAX_CHECKLIST_ITEMS = 30;
const MAX_MATERIALS = 30;

type JobRecapContext = {
  job: { id: string; title: string; description: string | null; address_text: string | null; completed_at: string | null };
  customerName: string | null;
  serviceName: string | null;
  checklists: Array<{ title: string; results: Array<{ item: string; done: boolean; critical: boolean; notes?: string }> }>;
  timeEntries: Array<{ started_at: string; ended_at: string | null; break_minutes: number | null; notes: string | null }>;
  materials: Array<{ description: string; quantity: number; supplier?: string | null }>;
};

async function loadJobRecapContext(workspaceId: string, jobId: string): Promise<JobRecapContext | null> {
  const { data: job } = await supabaseAdmin.from('jobs')
    .select('id,title,description,address_text,completed_at,customer_id,customers(display_name),service_id,services(name)')
    .eq('workspace_id', workspaceId).eq('id', jobId).maybeSingle();
  if (!job) return null;
  const [checklistsResult, timeResult, materialsResult] = await Promise.all([
    supabaseAdmin.from('job_checklists').select('title,results').eq('workspace_id', workspaceId).eq('job_id', jobId).limit(20),
    supabaseAdmin.from('job_time_entries').select('started_at,ended_at,break_minutes,notes').eq('workspace_id', workspaceId).eq('job_id', jobId).order('started_at').limit(50),
    supabaseAdmin.from('job_materials').select('description,quantity,supplier').eq('workspace_id', workspaceId).eq('job_id', jobId).limit(MAX_MATERIALS),
  ]);
  const customer = Array.isArray((job as any).customers) ? (job as any).customers[0] : (job as any).customers;
  const service = Array.isArray((job as any).services) ? (job as any).services[0] : (job as any).services;
  return {
    job: { id: job.id, title: job.title, description: job.description ?? null, address_text: job.address_text ?? null, completed_at: job.completed_at ?? null },
    customerName: customer?.display_name ?? null,
    serviceName: service?.name ?? null,
    checklists: ((checklistsResult.data ?? []) as any[]).map((row) => ({ title: row.title, results: (Array.isArray(row.results) ? row.results : []).slice(0, MAX_CHECKLIST_ITEMS) })),
    timeEntries: (timeResult.data ?? []) as JobRecapContext['timeEntries'],
    materials: (materialsResult.data ?? []) as JobRecapContext['materials'],
  };
}

function summarizeLabourMinutes(timeEntries: JobRecapContext['timeEntries']): number {
  return timeEntries.reduce((sum, entry) => {
    const end = entry.ended_at ? new Date(entry.ended_at).getTime() : Date.now();
    const start = new Date(entry.started_at).getTime();
    return sum + Math.max(0, Math.round((end - start) / 60_000) - Number(entry.break_minutes || 0));
  }, 0);
}

export function buildJobRecapPrompt(context: JobRecapContext): { system: string; user: string } {
  const labourMinutes = summarizeLabourMinutes(context.timeEntries);
  const checklistLines = context.checklists.length
    ? context.checklists.map((cl) => `${cl.title}: ${cl.results.map((r) => `${r.done ? 'done' : 'not done'} — ${r.item}${r.critical ? ' (critical)' : ''}`).join('; ') || '(no items)'}`).join('\n')
    : '(no checklists recorded)';
  const materialLines = context.materials.length
    ? context.materials.map((m) => `${m.quantity} x ${m.description}${m.supplier ? ` (from ${m.supplier})` : ''}`).join('\n')
    : '(no materials logged)';
  const system = [
    'You write short, plain-English work summaries for a trade/service business, for the business owner to review before sending to a customer or keeping on file.',
    'Only describe what the job record actually says. Never invent details, prices, warranties, or promises that are not in the record.',
    'Write 3-6 sentences, friendly and professional, no headers or bullet points, addressed to the customer by name if given but not as a greeting/signature block.',
  ].join(' ');
  const user = [
    `Job: ${context.job.title}`,
    context.serviceName ? `Service: ${context.serviceName}` : null,
    context.job.description ? `Description: ${context.job.description}` : null,
    context.job.address_text ? `Location: ${context.job.address_text}` : null,
    context.customerName ? `Customer: ${context.customerName}` : null,
    `Labour time logged: ${Math.floor(labourMinutes / 60)}h ${labourMinutes % 60}m`,
    `Checklist results:\n${checklistLines}`,
    `Materials used:\n${materialLines}`,
    'Draft the plain-English work summary now.',
  ].filter(Boolean).join('\n');
  return { system, user };
}

// Best-effort: called fire-and-forget from the job status-update route. Any
// failure here (provider down, usage cap hit, DB error) must never surface
// to the caller — it is logged and the job update itself is unaffected.
export async function draftJobRecap(workspaceId: string, jobId: string): Promise<void> {
  if (!openaiConfigured()) return;
  // Never clobber a recap the owner has already approved or sent — a job
  // should not normally re-complete, but this keeps the write idempotent
  // and safe if it ever does.
  const { data: existing } = await supabaseAdmin.from('job_recaps').select('status').eq('workspace_id', workspaceId).eq('job_id', jobId).maybeSingle();
  if (existing && existing.status !== 'drafted' && existing.status !== 'discarded') return;
  const context = await loadJobRecapContext(workspaceId, jobId);
  if (!context) return;

  const allowance = await consumeWorkspaceUsageForWorkspace(workspaceId, 'usage.ai_actions', 1, `usage.ai_actions:job_recap:${jobId}`).catch(() => ({ allowed: false }));
  if (!allowance.allowed) {
    await supabaseAdmin.from('ai_actions').insert({
      workspace_id: workspaceId, requested_by: 'system', actor_type: 'job_recap_worker',
      tool_name: 'job.recap.draft', risk_level: 'low', input: { jobId },
      approval_required: false, status: 'denied', error_code: 'AI_ACTION_LIMIT_REACHED', completed_at: new Date().toISOString(),
    }).select('id').maybeSingle();
    return;
  }

  const { system, user } = buildJobRecapPrompt(context);
  let turn;
  try {
    turn = await openaiChat([{ role: 'system', content: system }, { role: 'user', content: user }]);
  } catch (error) {
    await supabaseAdmin.from('ai_actions').insert({
      workspace_id: workspaceId, requested_by: 'system', actor_type: 'job_recap_worker',
      tool_name: 'job.recap.draft', risk_level: 'low', input: { jobId },
      approval_required: false, status: 'failed', error_code: 'OPENAI_CALL_FAILED', completed_at: new Date().toISOString(),
    }).select('id').maybeSingle();
    console.error(JSON.stringify({ level: 'error', component: 'job_recap', message: 'Recap draft failed', workspaceId, jobId, error: String((error as Error)?.message || error).slice(0, 200) }));
    return;
  }
  if (!turn.configured || !turn.message?.content) {
    await supabaseAdmin.from('ai_actions').insert({
      workspace_id: workspaceId, requested_by: 'system', actor_type: 'job_recap_worker',
      tool_name: 'job.recap.draft', risk_level: 'low', input: { jobId },
      approval_required: false, status: 'failed', error_code: 'OPENAI_UNAVAILABLE', completed_at: new Date().toISOString(),
    }).select('id').maybeSingle();
    return;
  }

  const draftText = turn.message.content.slice(0, 4000);
  const { error: upsertError } = await supabaseAdmin.from('job_recaps')
    .upsert({ workspace_id: workspaceId, job_id: jobId, draft_text: draftText, status: 'drafted', model: env.OPENAI_MODEL, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,job_id' });
  if (upsertError) {
    console.error(JSON.stringify({ level: 'error', component: 'job_recap', message: 'Recap store failed', workspaceId, jobId, error: String(upsertError.message || '').slice(0, 200) }));
    return;
  }
  await supabaseAdmin.from('ai_actions').insert({
    workspace_id: workspaceId, requested_by: 'system', actor_type: 'job_recap_worker',
    tool_name: 'job.recap.draft', risk_level: 'low', input: { jobId },
    output: { providerUsage: turn.usage }, approval_required: false, status: 'completed', completed_at: new Date().toISOString(),
  }).select('id').maybeSingle();
}
