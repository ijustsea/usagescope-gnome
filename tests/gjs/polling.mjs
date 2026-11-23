import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {CodexController} from '../../build/codex/controller.js';
import {ClaudeCliController} from '../../build/claude/cli.js';
const assert=(v,m)=>{if(!v)throw Error(m);};
const pause=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const delay=controller=>{
 const source=GLib.MainContext.default().find_source_by_id(controller.timer);
 assert(source,'active controller owns a scheduled GLib timer');
 return (source.get_ready_time()-GLib.get_monotonic_time())/1000000;
};
const root=GLib.dir_make_tmp('usagescope-polling-XXXXXX');
const cwd=GLib.get_current_dir();
const samples={codex:0,claude:0};let wake=null;
const received=provider=>view=>{if(view.status==='ready'){samples[provider]++;wake?.();}};
const codex=new CodexController({executable:cwd+'/tests/fixtures/fake-codex.mjs',pollSeconds:15,publish:received('codex'),openUri:()=>{throw Error('polling must not sign in');}});
const claude=new ClaudeCliController({executable:cwd+'/tests/fixtures/fake-claude-usage.mjs',pollSeconds:15,publish:received('claude')});
const run=async()=>{
 GLib.setenv('USAGESCOPE_TEST_PID',root+'/codex',true);
 GLib.setenv('USAGESCOPE_CLAUDE_TEST_PID',root+'/claude',true);
 try{
  codex.start();claude.start();
  const c=codex.refresh(),a=claude.refresh();
  assert(c===codex.refresh()&&a===claude.refresh(),'overlapping manual refreshes share pending work');
  await Promise.all([c,a]);
  for(const [name,controller]of [['Codex',codex],['Claude',claude]]){
   const seconds=delay(controller);
   assert(seconds>=13&&seconds<=17,name+' schedules the selected 15 seconds, observed '+seconds);
  }
  let timeout=0;
  try{
   await new Promise((resolve,reject)=>{
    wake=()=>{if(samples.codex>=2&&samples.claude>=2)resolve();};
    timeout=GLib.timeout_add(GLib.PRIORITY_DEFAULT,19000,()=>{timeout=0;reject(Error('selected 15-second timers did not refresh both providers'));return GLib.SOURCE_REMOVE;});
   });
  }finally{wake=null;if(timeout)GLib.Source.remove(timeout);}
  assert(samples.codex===2&&samples.claude===2,'exactly one automatic refresh per provider');
  codex.stop();claude.stop();await pause(80);
  for(const name of ['codex','claude']){
   const [,bytes]=Gio.File.new_for_path(root+'/'+name).load_contents(null);
   assert(!Gio.File.new_for_path('/proc/'+new TextDecoder().decode(bytes)).query_exists(null),'stop reaps '+name+' child');
  }
  GLib.setenv('USAGESCOPE_TEST_MODE','malformed',true);
  GLib.setenv('USAGESCOPE_CLAUDE_TEST_MODE','refused',true);
  codex.start();claude.start();await Promise.all([codex.refresh(),claude.refresh()]);
  const cDelay=delay(codex),aDelay=delay(claude);
  assert(cDelay>=28&&cDelay<=42&&aDelay>=28&&aDelay<=32,'15-second option retains the longer first failure backoff');
  print('Real 15-second polling passed: both providers refreshed automatically, pending reads coalesced, backoff and stop preserved');
 }finally{
  codex.stop();claude.stop();
  for(const key of ['USAGESCOPE_TEST_MODE','USAGESCOPE_CLAUDE_TEST_MODE','USAGESCOPE_TEST_PID','USAGESCOPE_CLAUDE_TEST_PID'])GLib.unsetenv(key);
  for(const name of ['codex','claude'])try{Gio.File.new_for_path(root+'/'+name).delete(null);}catch{}
  Gio.File.new_for_path(root).delete(null);
 }
};
const loop=new GLib.MainLoop(null,false);let error=null;
run().catch(e=>{error=e;}).finally(()=>loop.quit());loop.run();if(error)throw error;
