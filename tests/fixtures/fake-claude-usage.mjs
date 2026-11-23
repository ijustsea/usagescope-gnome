#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {appendFileSync,writeFileSync} from 'node:fs';
const mode=process.env.USAGESCOPE_CLAUDE_TEST_MODE??'';
const args=process.argv.slice(2);
for(const flag of ['--no-session-persistence','--strict-mcp-config','--disable-slash-commands','--no-chrome'])if(!args.includes(flag))throw Error('unsafe fixture flags');
for(const [flag,value]of [['--input-format','stream-json'],['--output-format','stream-json'],['--setting-sources',''],['--tools','']])if(args[args.indexOf(flag)+1]!==value)throw Error('unsafe fixture argument');
if(JSON.parse(args[args.indexOf('--settings')+1]).disableAllHooks!==true)throw Error('hooks must be disabled');
if(process.cwd()!=='/')throw Error('neutral working directory required');
if(process.env.USAGESCOPE_CLAUDE_TEST_PID)writeFileSync(process.env.USAGESCOPE_CLAUDE_TEST_PID,String(process.pid));
const input=createInterface({input:process.stdin});
input.on('close',()=>{if(mode==='stubborn')setInterval(()=>{},1000);});
let initialized=false;
input.on('line',line=>{
 const m=JSON.parse(line);
 if(process.env.USAGESCOPE_CLAUDE_TEST_TRACE)appendFileSync(process.env.USAGESCOPE_CLAUDE_TEST_TRACE,JSON.stringify(m)+'\n');
 if(m.type!=='control_request'||!['initialize','get_usage'].includes(m.request?.subtype))throw Error('model or unrelated request denied');
 if(mode==='hang')return;
 if(mode==='malformed'){console.log('{broken');return;}
 // Valid ignored frames followed by valid replies: removing a budget must
 // succeed, so a parser error or timeout cannot impersonate the budget check.
 if(mode==='oversize')console.log(JSON.stringify({type:'system',padding:'x'.repeat(1024*1024+1)}));
 if(mode==='flood')for(let i=0;i<300;i++)console.log('{"type":"system"}');
 if(mode==='total')for(let i=0;i<8;i++)console.log(JSON.stringify({type:'system',padding:'x'.repeat(600000)}));
 if(mode==='permission'){console.log(JSON.stringify({type:'control_request',request_id:'foreign',request:{subtype:'can_use_tool'}}));return;}
 let value;
 if(m.request.subtype==='initialize'){
  initialized=true;value={account:mode==='unknown-account'?{}:{email:'fixture@example.test',organization:'fixture-org',subscriptionType:'team'}};
 }else{
  if(!initialized||m.request.skip_behaviors!==true)throw Error('usage must skip transcript scanning');
  value={subscription_type:'team',session:{model_usage:{}},rate_limits_available:mode!=='unavailable',rate_limits:mode==='unavailable'?null:{five_hour:{utilization:0,resets_at:'2030-01-01T00:00:00Z'},seven_day:{utilization:38,resets_at:null}}};
 }
 console.log(JSON.stringify({type:'control_response',response:{subtype:mode==='refused'?'error':'success',request_id:m.request_id,response:value}}));
});
