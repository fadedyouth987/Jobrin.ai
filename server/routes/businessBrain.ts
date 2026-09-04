import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, validateBody } from '../security';
import { createUserClient, requireActiveSubscription, requireAuth, requireRole, requireWorkspace, supabaseAdmin, type AuthenticatedRequest, writeAudit } from '../supabase';
import { decideMemoryStatus, MEMORY_RULE_VERSION } from '../ai/memoryPolicy';

const router=Router();router.use(requireAuth,requireWorkspace,requireActiveSubscription('ai.basic'));
const statuses=['candidate','active','challenged','stale','archived'] as const;

router.get('/memories',asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const status=z.enum(statuses).safeParse(req.query.status);const search=String(req.query.search||'').trim().slice(0,100);
  let query=db.from('business_memories').select('id,scope_type,scope_id,category,memory_key,summary,status,confidence,sample_count,sensitivity,source_type,first_observed_at,last_observed_at,review_due_at,expires_at,confirmed_at,updated_at').eq('workspace_id',req.workspaceId!).order('updated_at',{ascending:false}).limit(300);
  if(status.success)query=query.eq('status',status.data);if(search)query=query.ilike('summary',`%${search.replace(/[%_]/g,'')}%`);const {data,error}=await query;if(error)return res.status(500).json({error:'MEMORY_LIST_FAILED'});res.json({memories:data??[]});
}));

router.get('/memories/:id',asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const [{data:memory,error},{data:evidence},{data:usage},{data:decisions}]=await Promise.all([
    db.from('business_memories').select('*').eq('workspace_id',req.workspaceId!).eq('id',req.params.id).maybeSingle(),
    db.from('memory_evidence').select('*').eq('workspace_id',req.workspaceId!).eq('memory_id',req.params.id).order('event_at',{ascending:false}),
    db.from('memory_usage_events').select('*').eq('workspace_id',req.workspaceId!).eq('memory_id',req.params.id).order('created_at',{ascending:false}),
    db.from('memory_promotion_decisions').select('*').eq('workspace_id',req.workspaceId!).eq('memory_id',req.params.id).order('created_at',{ascending:false}),
  ]);if(error)return res.status(500).json({error:'MEMORY_LOAD_FAILED'});if(!memory)return res.status(404).json({error:'MEMORY_NOT_FOUND'});res.json({memory,evidence:evidence??[],usage:usage??[],decisions:decisions??[]});
}));

router.get('/settings',asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const {data,error}=await db.from('memory_learning_settings').select('*').eq('workspace_id',req.workspaceId!).maybeSingle();if(error)return res.status(500).json({error:'MEMORY_SETTINGS_FAILED'});
  res.json({settings:data??{workspace_id:req.workspaceId,communication_style:true,duration_estimates:true,quote_adjustments:true,pricing_optimisation:false,technician_comparisons:false,payment_predictions:false,travel_calibration:false,supplier_forecasting:false,sensitive_property_memory:false}});
}));

const settingsSchema=z.object({communication_style:z.boolean(),duration_estimates:z.boolean(),quote_adjustments:z.boolean(),pricing_optimisation:z.literal(false),technician_comparisons:z.literal(false),payment_predictions:z.literal(false),travel_calibration:z.literal(false),supplier_forecasting:z.literal(false),sensitive_property_memory:z.literal(false)}).strict();
router.put('/settings',requireRole('owner','admin'),validateBody(settingsSchema),asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const {data,error}=await supabaseAdmin.from('memory_learning_settings').upsert({...req.body,workspace_id:req.workspaceId!,updated_by:req.auth!.userId,updated_at:new Date().toISOString()}).select('*').single();if(error)return res.status(500).json({error:'MEMORY_SETTINGS_SAVE_FAILED'});await writeAudit(req,'memory.settings_updated','workspace',req.workspaceId!,req.body);res.json({settings:data});
}));

const feedbackSchema=z.object({event_key:z.enum(['message.corrected','duration.measured','quote.corrected']),idempotency_key:z.string().min(8).max(200),resource_type:z.enum(['message','job','quote']),resource_id:z.string().uuid(),customer_id:z.string().uuid().nullable().optional(),job_id:z.string().uuid().nullable().optional(),quote_id:z.string().uuid().nullable().optional(),message_id:z.string().uuid().nullable().optional(),proposal:z.record(z.string(),z.unknown()),final_value:z.record(z.string(),z.unknown()).nullable(),edit_type:z.enum(['accepted','edited','rejected','measured']),rejection_reason:z.string().max(1000).nullable().optional(),learning_intent:z.enum(['ask','learn','one_off','do_not_learn']),model:z.string().max(100).nullable().optional(),prompt_version:z.string().max(100).nullable().optional()}).strict();
router.post('/feedback',requireRole('owner','admin','manager','staff'),validateBody(feedbackSchema),asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const {data,error}=await supabaseAdmin.from('ai_feedback_events').upsert({...req.body,workspace_id:req.workspaceId!,actor_user_id:req.auth!.userId},{onConflict:'workspace_id,idempotency_key',ignoreDuplicates:true}).select('id,event_key,learning_intent,created_at').maybeSingle();
  if(error)return res.status(500).json({error:'FEEDBACK_CAPTURE_FAILED'});if(!data)return res.status(200).json({duplicate:true});
  if(req.body.learning_intent!=='do_not_learn'&&req.body.learning_intent!=='one_off')await supabaseAdmin.from('outbox_events').insert({workspace_id:req.workspaceId!,event_key:'memory.extract_requested',payload:{feedbackEventId:data.id},idempotency_key:`memory:${data.id}`});
  await writeAudit(req,'memory.feedback_captured','ai_feedback_event',data.id,{eventKey:data.event_key,learningIntent:data.learning_intent});res.status(201).json({feedback:data,queued:req.body.learning_intent==='learn'||req.body.learning_intent==='ask'});
}));

const decisionSchema=z.object({decision:z.enum(['confirm','challenge','archive','delete']),reason:z.string().trim().min(2).max(1000)}).strict();
router.post('/memories/:id/decision',requireRole('owner','admin','manager'),validateBody(decisionSchema),asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const {data:memory}=await supabaseAdmin.from('business_memories').select('*').eq('workspace_id',req.workspaceId!).eq('id',req.params.id).maybeSingle();if(!memory)return res.status(404).json({error:'MEMORY_NOT_FOUND'});
  if(req.body.decision==='delete'){await supabaseAdmin.from('business_memories').delete().eq('workspace_id',req.workspaceId!).eq('id',memory.id);await writeAudit(req,'memory.deleted','business_memory',memory.id,{reason:req.body.reason},'warning');return res.json({deleted:true});}
  const next=req.body.decision==='confirm'?'active':req.body.decision==='challenge'?'challenged':'archived';const now=new Date().toISOString();const changes:any={status:next,updated_at:now};if(next==='active')Object.assign(changes,{confirmed_by:req.auth!.userId,confirmed_at:now});if(next==='archived')changes.archived_at=now;
  const {data,error}=await supabaseAdmin.from('business_memories').update(changes).eq('workspace_id',req.workspaceId!).eq('id',memory.id).select('*').single();if(error)return res.status(500).json({error:'MEMORY_DECISION_FAILED'});
  await supabaseAdmin.from('memory_promotion_decisions').insert({workspace_id:req.workspaceId!,memory_id:memory.id,from_status:memory.status,to_status:next,rule_key:`human_${req.body.decision}`,rule_version:MEMORY_RULE_VERSION,inputs:{reason:req.body.reason},reason:req.body.reason,actor_type:'user',actor_user_id:req.auth!.userId});await writeAudit(req,`memory.${next}`,'business_memory',memory.id,{reason:req.body.reason});res.json({memory:data});
}));

router.get('/metrics',asyncRoute(async(req:AuthenticatedRequest,res)=>{
  const db=createUserClient(req.auth!.accessToken);const [{data:memories},{data:usage},{data:feedback}]=await Promise.all([db.from('business_memories').select('status,category').eq('workspace_id',req.workspaceId!),db.from('memory_usage_events').select('outcome').eq('workspace_id',req.workspaceId!),db.from('ai_feedback_events').select('edit_type').eq('workspace_id',req.workspaceId!)]);const counts=(items:any[],key:string)=>items.reduce((a:any,row:any)=>(a[row[key]]=(a[row[key]]||0)+1,a),{});res.json({memories:counts(memories??[],'status'),usage:counts(usage??[],'outcome'),feedback:counts(feedback??[],'edit_type')});
}));

export default router;
