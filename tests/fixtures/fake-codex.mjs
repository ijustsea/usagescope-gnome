#!/usr/bin/env node
import readline from 'node:readline';
import {appendFileSync,writeFileSync} from 'node:fs';
if(process.env.USAGESCOPE_TEST_PID)writeFileSync(process.env.USAGESCOPE_TEST_PID,String(process.pid),{mode:0o600});
const mode=process.env.USAGESCOPE_TEST_MODE ?? 'normal';
const input=readline.createInterface({input:process.stdin});
input.on('close',()=>{
 if(process.env.USAGESCOPE_TEST_EOF)writeFileSync(process.env.USAGESCOPE_TEST_EOF,'eof',{mode:0o600});
 if(mode==='stubborn-eof')setInterval(()=>{},1000);
});
let quotaReads=0;
input.on('line',line=>{
 const r=JSON.parse(line);
 if(process.env.USAGESCOPE_TEST_TRACE)appendFileSync(process.env.USAGESCOPE_TEST_TRACE,r.method+'\n',{mode:0o600});
 if(r.method==='initialized') return;
 if(mode==='hang' && r.method!=='initialize') return;
 if(mode==='oversize' && r.method!=='initialize') {process.stdout.write('x'.repeat(1048577)); return;}
 if(mode==='malformed' && r.method!=='initialize') {console.log('{oops');return;}
 if(mode==='notifications-flood' && r.method!=='initialize')for(let i=0;i<1000;i++)console.log(JSON.stringify({method:'test/noop',params:{}}));
 if(mode==='connection-oversize' && r.method!=='initialize')for(let i=0;i<8;i++)console.log(JSON.stringify({method:'test/noop',params:{padding:'x'.repeat(600000)}}));
 if(['turn/start','thread/start'].includes(r.method)) process.exit(90);
 let result={};
 if(r.method==='initialize') result={userAgent:'test'};
 if(r.method==='account/read') result={account:{type:'chatgpt',id:'fake-account'}};
 if(r.method==='account/rateLimits/read') result={accountId:'fake-account',rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:2000000000}},ordinaryUsageAllowed:true};
 if(r.method==='account/rateLimits/read' && mode==='compact-ui'){
  // Realistic resets relative to now, including the widest countdown (6d 23h).
  const now=Math.floor(Date.now()/1000);
  result.rateLimits={planType:'plus',primary:{usedPercent:97,windowDurationMins:300,resetsAt:now+4*3600+30*60+50},secondary:{usedPercent:21,windowDurationMins:10080,resetsAt:now+6*86400+23*3600+50*60}};
 }
 if(r.method==='account/rateLimits/read' && mode==='switch-account') {
  quotaReads++;
  if(quotaReads===1)console.log(JSON.stringify({method:'account/updated',params:{authMode:'chatgpt'}}));
  else result.accountId='new-account';
 }
 if(r.method==='account/rateLimits/read' && mode==='signed-out'){console.log(JSON.stringify({id:r.id,error:{code:-32600,message:'Not logged in. Run codex login.'}}));return;}
 console.log(JSON.stringify({id:r.id,result}));
});
