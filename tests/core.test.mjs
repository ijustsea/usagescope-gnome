import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCodexUsage} from '../build/core/normalize.js';
import {validateExecutable, rpcAllowed} from '../build/core/policy.js';
import {panelText, formatWindow} from '../build/core/format.js';
import {ProviderState} from '../build/core/state.js';

const now = 1800000000000;
const payload = {accountId: 'account-A', rateLimits: {primary: {usedPercent: 25, windowDurationMins: 300, resetsAt: 1800003600}, secondary: null}};
test('Codex reads actual duration and never manufactures missing weekly window', () => {
 const s = parseCodexUsage(payload, 'local', now);
 assert.equal(s.windows.length, 1); assert.equal(s.windows[0].durationSeconds, 18000);
 assert.equal(s.windows[0].usedPercent, 25); assert.equal(s.accountId, 'account-A');
});
test('multi bucket values are not summed and prototype keys are rejected', () => {
 const s = parseCodexUsage({rateLimitsByLimitId: {codex:{primary:{usedPercent: 10, windowDurationMins:15}}, other:{secondary:{usedPercent:80,windowDurationMins:10080}}}}, 'a', now);
 assert.equal(s.windows.length,2); assert.equal(s.windows[0].durationSeconds,900);
 assert.throws(()=>parseCodexUsage(JSON.parse('{"rateLimitsByLimitId":{"__proto__":{"primary":{"usedPercent":1}}}}'),'a',now));
});
test('null, strings, infinity and out of contract percentages never become 100% remaining', () => {
 for (const usedPercent of [null, '', '25', Infinity, -1, 101]) {
  assert.throws(()=>parseCodexUsage({rateLimits:{primary:{usedPercent}}},'a',now));
 }
});
test('null duration and reset stay unknown while zero usage is valid', () => {
 const s=parseCodexUsage({rateLimits:{primary:{usedPercent:0,windowDurationMins:null,resetsAt:null}}},'a',now);
 assert.equal(s.windows[0].usedPercent,0); assert.equal(s.windows[0].durationSeconds,null); assert.equal(s.windows[0].resetsAt,null);
});
test('schema rejects non objects and unbounded quota groups', () => {
 for (const data of [null, [], 'data']) assert.throws(()=>parseCodexUsage(data,'a',now));
 assert.throws(()=>parseCodexUsage({rateLimitsByLimitId:Object.fromEntries(Array.from({length:70},(_,i)=>['b'+i,{primary:{usedPercent:1}}]))},'a',now));
});
test('executable must be absolute and cannot be a shell command',()=>{
 assert.equal(validateExecutable('/home/test/.local/bin/codex'),'/home/test/.local/bin/codex');
 for(const p of ['codex','/tmp/codex --flag','/tmp/a\n','/tmp/a;echo x','']) assert.throws(()=>validateExecutable(p));
});
test('RPC allowlist cannot start turns, threads, sign-in, consume credits or request tokens',()=>{
 assert.equal(rpcAllowed('account/rateLimits/read'),true);
 for(const m of ['turn/start','thread/start','account/logout','account/login/start','account/login/cancel','getAuthStatus','account/rateLimitResetCredit/consume']) assert.equal(rpcAllowed(m),false);
});
test('failed refresh retains history and its original time',()=>{
 const st=new ProviderState(); st.accept(parseCodexUsage(payload,'a',now));
 st.fail('network unavailable'); const v=st.view();
 assert.equal(v.status,'error'); assert.equal(v.snapshot.receivedAt,now); assert.equal(v.snapshot.windows[0].usedPercent,25);
 st.clear(); assert.equal(st.view().snapshot,null);
});
test('expired data is never displayed as a live remaining number',()=>{
 const s=parseCodexUsage(payload,'a',now);
 const view={status:'ready',snapshot:s,message:''};
 assert.match(panelText(view,now),/75%/);
 assert.equal(panelText(view,1800003600001).includes('75%'),false);
 assert.match(formatWindow(s.windows[0],1800003600001),/확인|expired|refresh/i);
});

test('subscription names use a bounded provider-specific whitelist',async()=>{
 const {planName}=await import('../build/core/subscription.js');
 for(const [raw,want] of [['free','Free'],['go','Go'],['plus','Plus'],['pro','Pro'],['team','Team'],['business','Business'],['enterprise','Enterprise'],['edu','Edu']])assert.equal(planName('codex',raw),want);
 for(const [raw,want] of [['pro','Pro'],['max','Max'],['team','Team'],['enterprise','Enterprise'],['ultra','Ultra']])assert.equal(planName('claude',raw),want);
 assert.equal(planName('codex','PLUS'),'Plus');assert.equal(planName('claude','plus'),null);assert.equal(planName('codex','max'),null);
 for(const value of [null,undefined,{},1,'','unknown','<b>pro</b>','pro\n','x'.repeat(10000),'claude-opus-4-6'])assert.equal(planName('claude',value),null);
});

test('Codex subscription comes from reported buckets and ambiguous plans stay unknown',()=>{
 assert.equal(parseCodexUsage({...payload,rateLimits:{...payload.rateLimits,planType:'plus'}},'a',now).planType,'plus');
 assert.equal(parseCodexUsage({rateLimitsByLimitId:{codex:{planType:'pro'},other:{planType:'plus'}}},'a',now).planType,'pro');
 assert.equal(parseCodexUsage({rateLimitsByLimitId:{a:{planType:'team'},b:{planType:'team'}}},'a',now).planType,'team');
 assert.equal(parseCodexUsage({rateLimitsByLimitId:{a:{planType:'pro'},b:{planType:'plus'}}},'a',now).planType,null);
 assert.equal(parseCodexUsage({rateLimitsByLimitId:{codex:{planType:'new-tier'},other:{planType:'pro'}}},'a',now).planType,null);
 assert.equal(parseCodexUsage({...payload,planType:'pro',model:'pro'},'a',now).planType,null);
 assert.equal(parseCodexUsage({rateLimits:{planType:'untrusted'.repeat(1000)}},'a',now).planType,null);
});
