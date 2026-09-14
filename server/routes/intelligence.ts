import { Router } from 'express';
import { z } from 'zod';
import { applyKeysetCursor, asyncRoute, buildPage, parseCursor, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { operatorTools, toolByName } from '../ai/toolRegistry';
import { isAutomationExecutable } from '../automation/runner';

const router = Router();
router.use(requireAuth, requireWorkspace, requireActiveSubscription('ai.basic'));

// NOTE: ordered by last_message_at (not created_at) — that column is
// nullable and mutated by every new message, so it cannot support a stable
// keyset cursor the way the other list endpoints do without changing this
// endpoint's semantics (a paginated "sorted by last activity" list would
// have to be reordered relative to earlier pages every time a message
// arrives). Left as a fixed-limit list; revisit if this becomes truncation
// in practice.
router.get('/conversations', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('conversations')
    .select('id,subject,status,handling_mode,last_message_at,assigned_user_id,customer_id,customers(display_name,phone,email),lead_id')
    .eq('workspace_id', req.workspaceId!).order('last_message_at', { ascending: false, nullsFirst: false }).limit(200);
  if (error) return res.status(500).json({ error: 'CONVERSATION_LIST_FAILED' });
  res.json({ conversations: data ?? [] });
}));

router.get('/conversations/:id/messages', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('messages')
    .select('id,channel,direction,purpose,sender_type,body,status,sent_at,delivered_at,read_at,created_at')
    .eq('workspace_id', req.workspaceId!).eq('conversation_id', req.params.id).order('created_at').limit(500);
  if (error) return res.status(500).json({ error: 'MESSAGE_LIST_FAILED' });
  res.json({ messages: data ?? [] });
}));

router.get('/knowledge', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('knowledge_documents').select('id,title,source_type,source_url,approved,created_at,updated_at').eq('workspace_id', req.workspaceId!).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'KNOWLEDGE_LIST_FAILED' });
  res.json({ documents: data ?? [] });
}));

router.post('/knowledge', requireRole('owner','admin','manager'), validateBody(z.object({
  title: z.string().trim().min(2).max(200),
  source_type: z.enum(['manual','faq','policy','website','file','service','pricing']),
  source_url: z.string().url().max(1000).nullable().optional(),
  content: z.string().trim().min(1).max(100_000),
  approved: z.boolean().default(false),
})), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('knowledge_documents').insert({ ...req.body, workspace_id: req.workspaceId!, created_by: req.auth!.userId }).select('id,title,source_type,approved,created_at').single();
  if (error) return res.status(400).json({ error: 'KNOWLEDGE_CREATE_FAILED', message: error.message });
  await writeAudit(req, 'knowledge.created', 'knowledge_document', data.id, { approved: data.approved });
  res.status(201).json({ document: data });
}));

router.get('/approvals', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const limit = 200;
  const cursor = parseCursor(req.query.cursor);
  let query = db.from('approvals').select('id,resource_type,resource_id,reason,status,requested_by,decided_by,decision_note,created_at,decided_at,ai_action_id').eq('workspace_id', req.workspaceId!);
  query = applyKeysetCursor(query, cursor);
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (error) return res.status(500).json({ error: 'APPROVAL_LIST_FAILED' });
  const { page, nextCursor, hasMore } = buildPage(data ?? [], limit);
  res.json({ approvals: page, nextCursor, hasMore });
}));

router.post('/approvals/:id/decision', requireRole('owner','admin','manager'), validateBody(z.object({ decision: z.enum(['approved','rejected']), note: z.string().trim().max(2000).default('') })), asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('approvals').update({ status: req.body.decision, decision_note: req.body.note, decided_by: req.auth!.userId, decided_at: new Date().toISOString() }).eq('workspace_id', req.workspaceId!).eq('id', req.params.id).eq('status','pending').select('*').maybeSingle();
  if (error) return res.status(400).json({ error: 'APPROVAL_DECISION_FAILED' });
  if (!data) return res.status(409).json({ error: 'APPROVAL_ALREADY_DECIDED_OR_MISSING' });
  await writeAudit(req, `approval.${req.body.decision}`, 'approval', data.id);
  // An approval on an automation step is the only thing that can move its
  // linked automation_runs row out of 'waiting'. Approving requeues the run
  // so the runner picks it back up (it resumes rather than restarts — see
  // the checkpointing in server/automation/runner.ts); rejecting is terminal.
  // Browser clients cannot write automation_runs directly, so this uses the
  // service-role client the same way the manual-run route does.
  if (data.resource_type === 'automation_step' && data.resource_id) {
    if (req.body.decision === 'approved') {
      await supabaseAdmin.from('automation_runs')
        .update({ status: 'queued', next_attempt_at: new Date().toISOString(), last_error: null })
        .eq('workspace_id', req.workspaceId!).eq('id', data.resource_id).eq('status', 'waiting');
    } else {
      await supabaseAdmin.from('automation_runs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString(), last_error: 'APPROVAL_REJECTED' })
        .eq('workspace_id', req.workspaceId!).eq('id', data.resource_id).eq('status', 'waiting');
    }
  }
  res.json({ approval: data });
}));

router.get('/ai-actions', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const limit = 300;
  const cursor = parseCursor(req.query.cursor);
  let query = db.from('ai_actions').select('id,tool_name,risk_level,status,approval_required,error_code,cost_microunits,created_at,completed_at,customer_id,conversation_id').eq('workspace_id', req.workspaceId!);
  query = applyKeysetCursor(query, cursor);
  const { data, error } = await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit + 1);
  if (error) return res.status(500).json({ error: 'AI_ACTION_LIST_FAILED' });
  const { page, nextCursor, hasMore } = buildPage(data ?? [], limit);
  // Tag each action with the department (specialist) that owns its tool.
  const actions = page.map((row: any) => ({
    ...row,
    specialist: toolByName(row.tool_name)?.specialist ?? (/^admin\.(receptionist|finance|sales|marketing|support|business_brain)\./.exec(row.tool_name)?.[1] ?? null),
  }));
  res.json({ actions, nextCursor, hasMore });
}));

router.get('/capabilities', asyncRoute(async (_req: AuthenticatedRequest, res) => {
  res.json({
    policy: 'safe_autopilot',
    tools: operatorTools.map(({ name, description, risk, specialist }) => ({ name, description, risk, specialist, automationReady: isAutomationExecutable(name) })),
    specialists: [
      {key:'receptionist',label:'AI receptionist',status:'setup_required'},
      {key:'triage',label:'Enquiry triage',status:'preview'},
      {key:'scheduler',label:'Scheduling assistant',status:'preview'},
      {key:'quotes',label:'Quote assistant',status:'preview'},
      {key:'job_prep',label:'Job preparation',status:'planned'},
      {key:'field_scribe',label:'Field-note scribe',status:'planned'},
      {key:'collections',label:'Invoice follow-up',status:'preview'},
      {key:'reviews',label:'Review requests',status:'setup_required'},
      {key:'insights',label:'Owner insights',status:'preview'},
    ],
  });
}));

router.get('/automations', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('automations').select('id,name,description,status,trigger_key,definition,version,schedule_cron,timezone,approval_policy,retry_policy,next_run_at,last_run_at,created_at,updated_at').eq('workspace_id', req.workspaceId!).order('updated_at',{ascending:false});
  if (error) return res.status(500).json({ error: 'AUTOMATION_LIST_FAILED' });
  res.json({ automations: data ?? [] });
}));

const automationSchema=z.object({
  name:z.string().trim().min(2).max(120), description:z.string().trim().max(1000).default(''),
  trigger_key:z.enum(['lead.created','appointment.completed','job.completed','invoice.overdue','schedule.cron']),
  definition:z.object({conditions:z.array(z.record(z.string(),z.unknown())).max(20).default([]),steps:z.array(z.object({tool:z.string().min(2).max(120),input:z.record(z.string(),z.unknown()).default({})}).strict()).min(1).max(20)}).strict(),
  schedule_cron:z.string().trim().max(120).nullable().default(null), timezone:z.string().trim().min(3).max(80).default('Australia/Adelaide'),
}).strict();

router.post('/automations',requireRole('owner','admin','manager'),validateBody(automationSchema),asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const invalid=req.body.definition.steps.find((step:{tool:string,input:Record<string,unknown>})=>{
    const tool=toolByName(step.tool);
    return !tool||!isAutomationExecutable(step.tool)||!tool.schema.safeParse(step.input).success;
  });
  if(invalid)return res.status(400).json({error:'AUTOMATION_TOOL_NOT_READY_OR_INPUT_INVALID',tool:invalid.tool});
  const db=createUserClient(req.auth!.accessToken);
  const {data,error}=await db.from('automations').insert({...req.body,workspace_id:req.workspaceId!,created_by:req.auth!.userId,status:'draft'}).select('*').single();
  if(error)return res.status(400).json({error:'AUTOMATION_CREATE_FAILED',message:error.message});
  await writeAudit(req,'automation.created','automation',data.id,{trigger:data.trigger_key});res.status(201).json({automation:data});
}));

router.post('/automations/:id/status',requireRole('owner','admin','manager'),validateBody(z.object({status:z.enum(['active','paused','archived'])}).strict()),asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const {data,error}=await db.from('automations').update({status:req.body.status,updated_at:new Date().toISOString()}).eq('workspace_id',req.workspaceId!).eq('id',req.params.id).select('*').maybeSingle();
  if(error)return res.status(400).json({error:'AUTOMATION_STATUS_FAILED'});if(!data)return res.status(404).json({error:'AUTOMATION_NOT_FOUND'});
  await writeAudit(req,`automation.${req.body.status}`,'automation',data.id);res.json({automation:data});
}));

router.post('/automations/:id/run',requireRole('owner','admin','manager'),asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const {data:automation}=await db.from('automations').select('id,status,retry_policy').eq('workspace_id',req.workspaceId!).eq('id',req.params.id).maybeSingle();
  if(!automation)return res.status(404).json({error:'AUTOMATION_NOT_FOUND'});if(automation.status!=='active')return res.status(409).json({error:'AUTOMATION_NOT_ACTIVE'});
  const key=`manual:${automation.id}:${req.requestId}`;const maxAttempts=Number((automation.retry_policy as any)?.maxAttempts||5);
  // Browser clients are intentionally read-only for worker-owned run records.
  // This authenticated, role-checked route performs the internal queue write.
  const {data,error}=await supabaseAdmin.from('automation_runs').insert({workspace_id:req.workspaceId!,automation_id:automation.id,idempotency_key:key,max_attempts:maxAttempts,state:{source:'manual',requestedBy:req.auth!.userId}}).select('*').single();
  if(error)return res.status(400).json({error:'AUTOMATION_QUEUE_FAILED',message:error.message});await writeAudit(req,'automation.run_queued','automation_run',data.id);res.status(202).json({run:data});
}));

router.get('/automation-runs',asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const limit=100;const cursor=parseCursor(req.query.cursor);
  let query=db.from('automation_runs').select('id,automation_id,status,attempt_count,max_attempts,next_attempt_at,last_error,started_at,completed_at,created_at,automations(name)').eq('workspace_id',req.workspaceId!);
  query=applyKeysetCursor(query,cursor);
  const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit+1);
  if(error)return res.status(500).json({error:'AUTOMATION_RUN_LIST_FAILED'});
  const {page,nextCursor,hasMore}=buildPage(data??[],limit);res.json({runs:page,nextCursor,hasMore});
}));

router.get('/reviews', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const limit = 300;
  const cursor = parseCursor(req.query.cursor);
  let query = db.from('review_requests').select('id,channel,status,rating,feedback,sent_at,completed_at,created_at,customer_id,customers(display_name),job_id').eq('workspace_id', req.workspaceId!);
  query = applyKeysetCursor(query, cursor);
  const { data, error } = await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(limit + 1);
  if (error) return res.status(500).json({ error: 'REVIEW_LIST_FAILED' });
  const { page, nextCursor, hasMore } = buildPage(data ?? [], limit);
  res.json({ reviews: page, nextCursor, hasMore });
}));

// NOT cursor-paginated: `sources` is a rollup computed from every matching
// row (revenue by source), not a page of independent records — paginating
// the underlying query would silently understate older sources' totals
// rather than truncate a list. `events` is the raw feed behind it and
// inherits the same constraint. Left on its existing fixed limit(1000);
// a real fix here is a database-side aggregate (e.g. a materialized view or
// GROUP BY query), not a cursor.
router.get('/attribution', asyncRoute(async (req: AuthenticatedRequest, res) => {
  const db = createUserClient(req.auth!.accessToken);
  const { data, error } = await db.from('revenue_attributions').select('source,medium,touch_type,revenue_cents,created_at,campaign_id,lead_id,job_id,payment_id').eq('workspace_id', req.workspaceId!).order('created_at',{ascending:false}).limit(1000);
  if (error) return res.status(500).json({ error: 'ATTRIBUTION_LIST_FAILED' });
  const groups = new Map<string,{source:string,revenueCents:number,conversions:number}>();
  for (const row of data ?? []) { const key=row.source||'Unknown'; const current=groups.get(key)||{source:key,revenueCents:0,conversions:0}; current.revenueCents+=Number(row.revenue_cents||0); current.conversions+=1; groups.set(key,current); }
  res.json({ sources:[...groups.values()].sort((a,b)=>b.revenueCents-a.revenueCents), events:data??[] });
}));

export default router;
