import { supabaseAdmin } from '../supabase';

export async function getBusinessContext(input:{workspaceId:string;scopeIds?:string[];categories?:string[];limit?:number}){
  const limit=Math.min(Math.max(input.limit??10,1),12);const now=new Date().toISOString();
  let query=supabaseAdmin.from('business_memories').select('id,scope_type,scope_id,category,memory_key,structured_value,summary,confidence,sensitivity,last_observed_at,expires_at').eq('workspace_id',input.workspaceId).eq('status','active').or(`expires_at.is.null,expires_at.gt.${now}`).order('confidence',{ascending:false}).order('last_observed_at',{ascending:false}).limit(limit*3);
  if(input.categories?.length)query=query.in('category',input.categories);const {data,error}=await query;if(error)throw new Error('MEMORY_CONTEXT_FAILED');
  const scope=new Set(input.scopeIds??[]);return(data??[]).filter((row:any)=>row.scope_type==='workspace'||!row.scope_id||scope.has(row.scope_id)).sort((a:any,b:any)=>Number(Boolean(b.scope_id))-Number(Boolean(a.scope_id))||Number(b.confidence)-Number(a.confidence)).slice(0,limit);
}
