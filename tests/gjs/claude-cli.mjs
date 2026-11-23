import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {readClaudeCliUsage,ClaudeCliController} from '../../build/claude/cli.js';
const assert=(v,m)=>{if(!v)throw Error(m);};
const pause=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const root=GLib.dir_make_tmp('usagescope-claude-cli-XXXXXX');
const exe=GLib.build_filenamev([GLib.get_current_dir(),'tests/fixtures/fake-claude-usage.mjs']);
const file=path=>Gio.File.new_for_path(path);
const read=path=>new TextDecoder().decode(file(path).load_contents(null)[1]);
const run=async()=>{
 GLib.setenv('USAGESCOPE_CLAUDE_TEST_TRACE',root+'/trace',true);
 GLib.setenv('USAGESCOPE_CLAUDE_TEST_PID',root+'/pid',true);
 const snapshot=await readClaudeCliUsage(exe,new Gio.Cancellable(),1000);
 assert(snapshot.planType==='team'&&snapshot.windows.length===2,'real pipes normalize Team quota');
 assert(snapshot.windows[0].usedPercent===0&&snapshot.windows[1].usedPercent===38,'zero and weekly values preserved');
 assert(snapshot.windows[0].resetsAt===1893456000,'microsecond offset reset parsed by GJS');
 assert(!JSON.stringify(snapshot).includes('fixture@example'),'raw account metadata never retained');
 assert(/^[a-f0-9]{64}$/.test(snapshot.accountId),'identity is an opaque digest');
 const messages=read(root+'/trace').trim().split('\n').map(JSON.parse);
 assert(messages.length===2&&messages.every(m=>m.type==='control_request'),'only two control requests');
 assert(messages[0].request.subtype==='initialize'&&messages[1].request.subtype==='get_usage'&&messages[1].request.skip_behaviors===true,'no turns, no transcript scan');
 assert(!file('/proc/'+read(root+'/pid')).query_exists(null),'completed query reaps its child');
 file(root+'/trace').delete(null);
 for(const mode of ['hang','malformed','permission','refused']){
  GLib.setenv('USAGESCOPE_CLAUDE_TEST_MODE',mode,true);let rejected=false;
  try{await readClaudeCliUsage(exe,new Gio.Cancellable(),250);}catch{rejected=true;}
  assert(rejected,'reject '+mode);await pause(40);
  assert(!file('/proc/'+read(root+'/pid')).query_exists(null),'failure reaps owned child '+mode);
 }
 for(const [mode,reason]of [['oversize','CLI frame limit'],['flood','CLI message limit'],['total','CLI input limit']]){
  GLib.setenv('USAGESCOPE_CLAUDE_TEST_MODE',mode,true);let error=null;
  try{await readClaudeCliUsage(exe,new Gio.Cancellable(),5000);}catch(e){error=e;}
  assert(error?.message===reason,'specific budget rejects valid frames: '+mode+' got '+error?.message);
  assert(!file('/proc/'+read(root+'/pid')).query_exists(null),'budget failure reaps child '+mode);
 }
 GLib.setenv('USAGESCOPE_CLAUDE_TEST_MODE','unavailable',true);
 assert((await readClaudeCliUsage(exe,new Gio.Cancellable(),1000)).windows.length===0,'missing quota stays missing');
 GLib.setenv('USAGESCOPE_CLAUDE_TEST_MODE','unknown-account',true);
 const a=await readClaudeCliUsage(exe,new Gio.Cancellable(),1000),b=await readClaudeCliUsage(exe,new Gio.Cancellable(),1000);
 assert(a.sourceId!==b.sourceId,'unknown identity starts a fresh alert baseline');
 GLib.setenv('USAGESCOPE_CLAUDE_TEST_MODE','hang',true);
 const cancelled=new Gio.Cancellable();const pending=readClaudeCliUsage(exe,cancelled,3000).then(()=>false,()=>true);
 await pause(100);cancelled.cancel();assert(await pending,'external cancellation rejects');
 GLib.unsetenv('USAGESCOPE_CLAUDE_TEST_MODE');
 let latest=null;
 const controller=new ClaudeCliController({executable:exe,pollSeconds:60,publish:view=>{latest=view;}});
 controller.start();await controller.refresh();assert(latest.status==='ready'&&latest.snapshot.planType==='team','controller publishes usage');
 controller.stop();assert(latest.status==='disabled','stop clears view');
 await controller.refresh();assert(latest.status==='disabled','stopped controller cannot revive');
 for(const key of ['USAGESCOPE_CLAUDE_TEST_TRACE','USAGESCOPE_CLAUDE_TEST_PID'])GLib.unsetenv(key);
 for(const name of ['trace','pid'])try{file(root+'/'+name).delete(null);}catch{}
 file(root).delete(null);
 print('Claude CLI GJS checks passed: Team, control-only protocol, budgets, cancellation, identity and lifecycle');
};
const loop=new GLib.MainLoop(null,false);let failed=null;
run().catch(e=>{failed=e;}).finally(()=>loop.quit());loop.run();if(failed)throw failed;
