import {supabaseAdmin} from '../supabase';
import {extractMemoryCandidates} from './openaiResponses';
import {decideMemoryStatus,MEMORY_RULE_VERSION} from './memoryPolicy';

let running=false;
export async function processBusinessBrainQueue(limit=5){
  if(running)return{processed:0};running=true;let processed=0;
  try{
    const{data:events,error}=await supabaseAdmin.from('outbox_events').select('id,workspace_id,payload,attempts').eq('event_key','memory.extract_requested').in('status',['pending','failed']).lte('next_attempt_at',new Date().toISOString()).order('created_at').limit(limit);
    if(error)throw new Error('MEMORY_QUEUE_READ_FAILED');
    for(const event of events??[]){
      const claim=await supabaseAdmin.from('outbox_events').update({status:'processing',attempts:Number(event.attempts||0)+1}).eq('id',event.id).in('status',['pending','failed']).select('id').maybeSingle();if(!claim.data)continue;
      try{
        const feedbackEventId=String((event.payload as any)?.feedbackEventId||'');const{data:feedback}=await supabaseAdmin.from('ai_feedback_events').select('*').eq('workspace_id',event.workspace_id).eq('id',feedbackEventId).maybeSingle();if(!feedback)throw new Error('FEEDBACK_EVENT_NOT_FOUND');
        if(['do_not_learn','one_off'].includes(feedback.learning_intent)){await complete(event.id);continue;}
        const{data:existing}=await supabaseAdmin.from('business_memories').select('id,summary').eq('workspace_id',event.workspace_id).in('status',['candidate','active','challenged']).limit(50);
        const extraction=await extractMemoryCandidates({eventKey:feedback.event_key,proposal:feedback.proposal,finalValue:feedback.final_value,learningIntent:feedback.learning_intent,existingSummaries:existing??[]});
        if(!extraction.configured)throw new Error('OPENAI_NOT_CONFIGURED');
        for(const candidate of extraction.candidates){
          const scopeId=candidate.scopeId??(candidate.scopeType==='workspace'?event.workspace_id:null);const decision=decideMemoryStatus({category:candidate.category,memoryKey:candidate.memoryKey,sampleCount:1,distinctRecords:1,explicitlyConfirmed:false,contradictionCount:candidate.conflictsWith.length,lastObservedAt:feedback.occurred_at});
          const{data:memory,error:memoryError}=await supabaseAdmin.from('business_memories').insert({workspace_id:event.workspace_id,scope_type:candidate.scopeType,scope_id:scopeId,category:candidate.category,memory_key:candidate.memoryKey,structured_value:candidate.structuredValue,summary:candidate.summary,status:decision.status,confidence:.2,sample_count:1,sensitivity:candidate.sensitivity,source_type:'ai_feedback',provenance:{feedbackEventId:feedback.id,reason:candidate.reason,responseId:extraction.responseId},first_observed_at:feedback.occurred_at,last_observed_at:feedback.occurred_at,algorithm_version:MEMORY_RULE_VERSION,prompt_version:feedback.prompt_version}).select('id').single();
          if(memoryError){if(memoryError.code==='23505')continue;throw new Error('MEMORY_CANDIDATE_STORE_FAILED');}
          await supabaseAdmin.from('memory_evidence').insert({workspace_id:event.workspace_id,memory_id:memory.id,feedback_event_id:feedback.id,source_type:feedback.resource_type,source_id:feedback.resource_id,observed_value:feedback.final_value??feedback.proposal,weight:1,explicitly_confirmed:false,event_at:feedback.occurred_at});
          await supabaseAdmin.from('memory_promotion_decisions').insert({workspace_id:event.workspace_id,memory_id:memory.id,from_status:'candidate',to_status:decision.status,rule_key:decision.ruleKey,rule_version:MEMORY_RULE_VERSION,inputs:{sampleCount:1,distinctRecords:1,contradictions:candidate.conflictsWith},reason:decision.reason,actor_type:'deterministic_worker'});
        }
        await complete(event.id);processed++;
      }catch(error:any){const attempts=Number(event.attempts||0)+1;const dead=attempts>=5;await supabaseAdmin.from('outbox_events').update({status:dead?'dead_letter':'failed',last_error:String(error?.message||'MEMORY_EXTRACTION_FAILED').slice(0,1000),next_attempt_at:new Date(Date.now()+Math.min(3600,30*2**attempts)*1000).toISOString()}).eq('id',event.id);}
    }
    return{processed};
  }finally{running=false;}
}

async function complete(id:string){await supabaseAdmin.from('outbox_events').update({status:'delivered',delivered_at:new Date().toISOString(),last_error:null}).eq('id',id)}

export function startBusinessBrainWorker(){const timer=setInterval(()=>{void processBusinessBrainQueue()},15_000);timer.unref();void processBusinessBrainQueue();return timer}
