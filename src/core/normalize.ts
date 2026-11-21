import type {UsageSnapshot} from './types.js';
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
 return {provider,sourceId,receivedAt,accountId:null,windows:[],allowed:null};
}
export function parseCodexUsage(payload:unknown,sourceId:string,receivedAt:number):UsageSnapshot {
 const p=object(payload); const result=base('codex',sourceId,receivedAt);
 if(typeof p.accountId==='string'&&p.accountId.length<=256) result.accountId=p.accountId;
 if(typeof p.ordinaryUsageAllowed==='boolean') result.allowed=p.ordinaryUsageAllowed;
 const buckets=p.rateLimitsByLimitId==null ? [['codex',object(p.rateLimits)]] as [string,unknown][] : Object.entries(object(p.rateLimitsByLimitId));
 if(buckets.length>64) throw new Error('Too many quota buckets');
 for(const [key,value] of buckets) {
  safeId(key); const bucket=object(value);
  for(const slot of ['primary','secondary']) {
   if(bucket[slot]==null) continue;
   const w=object(bucket[slot]); const seconds=duration(w.windowDurationMins);
   const label=seconds==null?'기간 미확인':seconds%86400===0?seconds/86400+'d':seconds%3600===0?seconds/3600+'h':seconds/60+'m';
   result.windows.push({id:key+':'+slot,label: (key==='codex'?'':key+' ')+label,durationSeconds:seconds,usedPercent:percent(w.usedPercent),resetsAt:reset(w.resetsAt)});
  }
 }
 return result;
}
export function parseClaudeUsage(payload:unknown,sourceId:string,receivedAt:number):UsageSnapshot {
 const p=object(payload); const result=base('claude',sourceId,receivedAt);
 if(p.rate_limits==null) return result;
 const limits=object(p.rate_limits);
 for(const [key,seconds,label] of [['five_hour',18000,'5h'],['seven_day',604800,'7d']] as const) {
  if(limits[key]==null) continue;
  const w=object(limits[key]);
  result.windows.push({id:key,label,durationSeconds:seconds,usedPercent:percent(w.used_percentage),resetsAt:reset(w.resets_at)});
 }
 return result;
}
