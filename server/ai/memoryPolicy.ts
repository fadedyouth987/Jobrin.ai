export type MemoryCategory='fact'|'preference'|'heuristic'|'aggregate'|'prediction';
export type MemoryStatus='candidate'|'active'|'challenged'|'stale'|'archived';
export type PromotionInput={category:MemoryCategory;memoryKey:string;sampleCount:number;distinctRecords:number;explicitlyConfirmed:boolean;contradictionCount:number;lastObservedAt:string;expiresAt?:string|null};
export type PromotionDecision={status:MemoryStatus;ruleKey:string;reason:string};

export const MEMORY_RULE_VERSION='memory-rules-v1';
export function decideMemoryStatus(input:PromotionInput,now=new Date()):PromotionDecision{
  if(input.expiresAt&&new Date(input.expiresAt)<=now)return{status:'stale',ruleKey:'expired',reason:'The review or expiry date has passed.'};
  if(input.contradictionCount>0)return{status:'challenged',ruleKey:'conflicting_evidence',reason:'Contradictory evidence requires a person to review this memory.'};
  if(input.category==='preference')return input.explicitlyConfirmed?{status:'active',ruleKey:'explicit_preference',reason:'A permitted person explicitly confirmed this preference.'}:{status:'candidate',ruleKey:'confirmation_required',reason:'Preferences require explicit confirmation.'};
  if(input.memoryKey.startsWith('communication.'))return input.sampleCount>=5&&input.distinctRecords>=3?{status:'active',ruleKey:'communication_repetition',reason:'Five consistent corrections across at least three records.'}:{status:'candidate',ruleKey:'communication_threshold',reason:'More consistent corrections are required.'};
  if(input.memoryKey.startsWith('duration.'))return input.sampleCount>=5?{status:'active',ruleKey:'duration_robust_sample',reason:'At least five completed jobs support the deterministic duration baseline.'}:{status:'candidate',ruleKey:'duration_threshold',reason:'Five completed jobs are required.'};
  if(input.memoryKey.startsWith('quote.'))return input.sampleCount>=5&&input.distinctRecords>=5?{status:'active',ruleKey:'quote_repetition',reason:'Five comparable approved quotes support this advisory heuristic.'}:{status:'candidate',ruleKey:'quote_threshold',reason:'Five comparable approved quotes are required.'};
  if(input.memoryKey.startsWith('pricing.'))return input.sampleCount>=50?{status:'candidate',ruleKey:'pricing_advisory_only',reason:'Pricing optimisation remains advisory and approval-gated.'}:{status:'candidate',ruleKey:'pricing_disabled',reason:'Pricing optimisation requires at least fifty comparable outcomes.'};
  return{status:'candidate',ruleKey:'human_review',reason:'This memory category requires validation before activation.'};
}

export function robustMedian(values:number[]){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);const trim=sorted.length>=10?Math.floor(sorted.length*.1):0;const kept=sorted.slice(trim,sorted.length-trim);const mid=Math.floor(kept.length/2);return kept.length%2?kept[mid]:Math.round((kept[mid-1]+kept[mid])/2)}
