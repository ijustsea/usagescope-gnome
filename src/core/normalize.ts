import type {UsageSnapshot} from './types.js';
import {planName} from './subscription.js';
function object(value:unknown):Record<string,unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid usage object');
 return value as Record<string,unknown>;
}
function percent(v:unknown):number {
 if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>100) throw new Error('Invalid usage percentage');
 return v;
}
function reset(v:unknown):number|null {
 if(v==null) return null;
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0||v>4102444800) throw new Error('Invalid reset timestamp');
 return v;
}
function duration(v:unknown):number|null {
 if(v==null) return null;
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<=0||v>5256000) throw new Error('Invalid quota duration');
 return v*60;
}
function safeId(v:string):string {
 if(!/^[a-zA-Z0-9_.:-]{1,128}$/.test(v)||['__proto__','constructor','prototype'].includes(v)) throw new Error('Invalid quota identifier');
 return v;
}
function base(provider:'codex'|'claude',sourceId:string,receivedAt:number):UsageSnapshot {
 if(typeof sourceId!=='string'||sourceId.length<1||sourceId.length>256||!Number.isFinite(receivedAt)) throw new Error('Invalid usage source');
 return {provider,sourceId,receivedAt,accountId:null,planType:null,windows:[],allowed:null};
}
export function parseCodexUsage(payload:unknown,sourceId:string,receivedAt:number):UsageSnapshot {
 const p=object(payload); const result=base('codex',sourceId,receivedAt);
 if(typeof p.accountId==='string'&&p.accountId.length<=256) result.accountId=p.accountId;
 if(typeof p.ordinaryUsageAllowed==='boolean') result.allowed=p.ordinaryUsageAllowed;
 const buckets=p.rateLimitsByLimitId==null ? [['codex',object(p.rateLimits)]] as [string,unknown][] : Object.entries(object(p.rateLimitsByLimitId));
 if(buckets.length>64) throw new Error('Too many quota buckets');
 const plans:string[]=[];let unknownPlan=false;
 for(const [key,value] of buckets) {
  safeId(key); const bucket=object(value);
  if(key==='codex') result.planType=planName('codex',bucket.planType)?.toLowerCase()??null;
  if(bucket.planType!=null){const name=planName('codex',bucket.planType);if(name)plans.push(name.toLowerCase());else unknownPlan=true;}
  for(const slot of ['primary','secondary']) {
   if(bucket[slot]==null) continue;
   const w=object(bucket[slot]); const seconds=duration(w.windowDurationMins);
   const label=seconds==null?'기간 미확인':seconds%86400===0?seconds/86400+'d':seconds%3600===0?seconds/3600+'h':seconds/60+'m';
   result.windows.push({id:key+':'+slot,label: (key==='codex'?'':key+' ')+label,durationSeconds:seconds,usedPercent:percent(w.usedPercent),resetsAt:reset(w.resetsAt)});
  }
 }
 if(!buckets.some(([key])=>key==='codex')&&!unknownPlan&&new Set(plans).size===1)result.planType=plans[0]!;
 return result;
}
export function parseClaudeUsage(payload:unknown,sourceId:string,receivedAt:number):UsageSnapshot {
 const p=object(payload); const result=base('claude',sourceId,receivedAt);
 // This is our stored projection, not the raw Claude statusline input contract.
 result.planType=planName('claude',p.subscription_type)?.toLowerCase()??null;
 if(p.rate_limits==null) return result;
 const limits=object(p.rate_limits);
 for(const [key,seconds,label] of [['five_hour',18000,'5h'],['seven_day',604800,'7d']] as const) {
  if(limits[key]==null) continue;
  const w=object(limits[key]);
  result.windows.push({id:key,label,durationSeconds:seconds,usedPercent:percent(w.used_percentage),resetsAt:reset(w.resets_at)});
 }
 return result;
}

/** Official SDK get_usage response; experimental and separate from statusline JSON. */
export function parseClaudeCliUsage(payload:unknown,sourceId:string,receivedAt:number):UsageSnapshot {
 const p=object(payload);const result=base('claude',sourceId,receivedAt);
 result.planType=planName('claude',p.subscription_type)?.toLowerCase()??null;
 if(typeof p.rate_limits_available!=='boolean')throw new Error('Unknown Claude CLI usage contract');
 if(p.rate_limits==null)return result;
 if(!p.rate_limits_available)throw new Error('Contradictory Claude CLI availability');
 const limits=object(p.rate_limits);
 const isoReset=(value:unknown):number|null=>{
  if(value==null)return null;
  if(typeof value!=='string'||value.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))throw new Error('Invalid CLI reset');
  return reset(Math.floor(Date.parse(value)/1000));
 };
 for(const [key,seconds,label] of [['five_hour',18000,'5h'],['seven_day',604800,'7d']] as const){
  if(limits[key]==null)continue;
  const w=object(limits[key]);if(w.utilization===null)continue;
  result.windows.push({id:'claude-cli:'+key,label,durationSeconds:seconds,usedPercent:percent(w.utilization),resetsAt:isoReset(w.resets_at)});
 }
 if(limits.limits!=null){
  if(!Array.isArray(limits.limits)||limits.limits.length>64)throw new Error('Too many CLI usage meters');
  if(!result.windows.length){
   const seen=new Set<string>();
   for(const value of limits.limits){
    const w=object(value);if(w.kind!=='session'&&w.kind!=='weekly_all')continue;
    if(seen.has(w.kind))throw new Error('Ambiguous CLI usage meter');seen.add(w.kind);
    result.windows.push({id:'claude-cli:'+w.kind,label:w.kind==='session'?'세션':'주간',durationSeconds:null,usedPercent:percent(w.percent),resetsAt:isoReset(w.resets_at)});
   }
  }
 }
 return result;
}
