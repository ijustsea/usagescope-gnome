#!/usr/bin/env node
import readline from 'node:readline';
import {appendFileSync,writeFileSync} from 'node:fs';
if(process.env.USAGESCOPE_TEST_PID)writeFileSync(process.env.USAGESCOPE_TEST_PID,String(process.pid),{mode:0o600});
const mode=process.env.USAGESCOPE_TEST_MODE ?? 'normal';
const input=readline.createInterface({input:process.stdin});
let quotaReads=0;
input.on('line',line=>{
 const r=JSON.parse(line);
 if(process.env.USAGESCOPE_TEST_TRACE)appendFileSync(process.env.USAGESCOPE_TEST_TRACE,r.method+'\n',{mode:0o600});
 if(r.method==='initialized') return;
 if(mode==='hang' && r.method!=='initialize') return;
 if(mode==='oversize' && r.method!=='initialize') {process.stdout.write('x'.repeat(1048577)); return;}
 if(mode==='malformed' && r.method!=='initialize') {console.log('{oops');return;}
 if(['turn/start','thread/start'].includes(r.method)) process.exit(90);
 let result={};
 if(r.method==='initialize') result={userAgent:'test'};
 if(r.method==='account/read') result={account:{type:'chatgpt',id:'fake-account'}};
 if(r.method==='account/rateLimits/read') result={accountId:'fake-account',rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:2000000000}},ordinaryUsageAllowed:true};
 if(r.method==='account/rateLimits/read' && mode==='compact-ui')result.rateLimits={planType:'plus',primary:{usedPercent:97,windowDurationMins:300,resetsAt:2000000000},secondary:{usedPercent:21,windowDurationMins:10080,resetsAt:2000000000}};
 if(r.method==='account/rateLimits/read' && mode==='switch-account') {
  quotaReads++;
  if(quotaReads===1)console.log(JSON.stringify({method:'account/updated',params:{authMode:'chatgpt'}}));
  else result.accountId='new-account';
 }
 if(r.method==='account/login/start') result={type:'chatgpt',loginId:'test-login',authUrl:mode==='evil-url'?'https://evil.invalid/':'https://auth.openai.com/authorize?state=test'};
 const reply=()=>{
  console.log(JSON.stringify({id:r.id,result}));
  if(mode==='failed-login'&&r.method==='account/login/start')setTimeout(()=>console.log(JSON.stringify({method:'account/login/completed',params:{loginId:'test-login',success:false}})),30);
 };
 if(mode==='delayed-login' && r.method==='account/login/start')setTimeout(reply,150);else reply();
});
