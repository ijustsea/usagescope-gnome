import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {RpcClient} from '../../build/codex/rpc.js';
import {CodexController} from '../../build/codex/controller.js';
function assert(v,m){if(!v)throw new Error(m);}
const exe=GLib.build_filenamev([GLib.get_current_dir(),'tests/fixtures/fake-codex.mjs']);
const run=async()=>{
 const client=new RpcClient(exe,500);
 const result=await client.request('account/rateLimits/read',{excludeResetCreditDetails:true});
 assert(result.rateLimits.primary.usedPercent===25,'real pipe response');
 let denied=false;try{await client.request('turn/start',{});}catch{denied=true;}
 assert(denied,'model method denied');
 const pid=client.pid; client.stop();
 await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 assert(!Gio.File.new_for_path('/proc/'+pid).query_exists(null),'owned child exits');
 const eofDir=GLib.dir_make_tmp('usagescope-eof-XXXXXX');
 GLib.setenv('USAGESCOPE_TEST_EOF',eofDir+'/marker',true);
 const polite=new RpcClient(exe,500);await polite.request('account/read',{});const politePid=polite.pid;
 await polite.finish();
 const [,eofBytes]=Gio.File.new_for_path(eofDir+'/marker').load_contents(null);
 assert(new TextDecoder().decode(eofBytes)==='eof','normal close delivers EOF before process exit');
 assert(!Gio.File.new_for_path('/proc/'+politePid).query_exists(null),'graceful completion reaps child');
 Gio.File.new_for_path(eofDir+'/marker').delete(null);
 GLib.setenv('USAGESCOPE_TEST_MODE','stubborn-eof',true);
 const stubborn=new RpcClient(exe,250);await stubborn.request('account/read',{});const stubbornPid=stubborn.pid;
 await stubborn.finish();await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 assert(!Gio.File.new_for_path('/proc/'+stubbornPid).query_exists(null),'non-exiting child is force-closed after deadline');
 Gio.File.new_for_path(eofDir+'/marker').delete(null);Gio.File.new_for_path(eofDir).delete(null);
 GLib.unsetenv('USAGESCOPE_TEST_MODE');GLib.unsetenv('USAGESCOPE_TEST_EOF');
 const scratch=GLib.dir_make_tmp('usagescope-executable-XXXXXX');
 const unsafe=Gio.File.new_for_path(scratch).get_child('writable');unsafe.make_directory(null);
 unsafe.set_attribute_uint32('unix::mode',0o777,Gio.FileQueryInfoFlags.NONE,null);
 const link=unsafe.get_child('codex');link.make_symbolic_link(exe,null);
 let unsafeAccepted=false;
 try{const p=new RpcClient(link.get_path(),300);unsafeAccepted=true;p.stop();}catch{}
 link.delete(null);unsafe.delete(null);Gio.File.new_for_path(scratch).delete(null);
 assert(!unsafeAccepted,'reject executable through writable ancestor even if target is safe');
 for(const mode of ['hang','oversize','malformed']) {
  GLib.setenv('USAGESCOPE_TEST_MODE',mode,true);
  const rpc=new RpcClient(exe,150);let failed=false;
  try{await rpc.request('account/read',{});}catch{failed=true;}finally{rpc.stop();}
  assert(failed,'reject '+mode);
 }
 GLib.unsetenv('USAGESCOPE_TEST_MODE');
 for(const mode of ['notifications-flood','connection-oversize']) {
  GLib.setenv('USAGESCOPE_TEST_MODE',mode,true);
  const bounded=new RpcClient(exe,5000);let rejected=false;
  try{await bounded.request('account/read',{});}catch{rejected=true;}finally{bounded.stop();}
  assert(rejected,'connection-wide resource limit rejects '+mode);
 }
 GLib.unsetenv('USAGESCOPE_TEST_MODE');
 let latest=null;
 const pidDir=GLib.dir_make_tmp('usagescope-idle-XXXXXX');
 GLib.setenv('USAGESCOPE_TEST_PID',pidDir+'/pid',true);
 const c=new CodexController({executable:exe,pollSeconds:180,publish:v=>latest=v});
 c.start();await c.refresh();assert(latest?.snapshot?.windows[0]?.usedPercent===25,'controller publishes normalized usage');
 const [,pidBytes]=Gio.File.new_for_path(pidDir+'/pid').load_contents(null);
 const idlePid=new TextDecoder().decode(pidBytes);
 await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 assert(!Gio.File.new_for_path('/proc/'+idlePid).query_exists(null),'quota-only controller releases its process between polls');
 await c.refresh();assert(latest.status==='ready','next explicit read reconnects after idle release');
 GLib.unsetenv('USAGESCOPE_TEST_PID');Gio.File.new_for_path(pidDir+'/pid').delete(null);Gio.File.new_for_path(pidDir).delete(null);
 c.pause();assert(c.timer===0,'pause cancels the next scheduled read');
 await c.refresh();assert(c.timer===0,'a read while paused schedules nothing further');
 const beforeResume=latest.snapshot.receivedAt;c.resume();
 assert(c.pending!==null,'resume starts a read at once');await c.pending;
 assert(latest.status==='ready'&&latest.snapshot.receivedAt>beforeResume&&c.timer!==0,'resume reads at once and restores the interval');
 const idleStart=new CodexController({executable:exe,pollSeconds:180,publish:()=>{}});
 idleStart.pause();idleStart.start();
 assert(idleStart.pending===null&&idleStart.timer===0,'a provider started while paused does not read');
 idleStart.resume();assert(idleStart.pending!==null,'its first read waits for resume');await idleStart.pending;idleStart.stop();
 const received=latest.snapshot.receivedAt;
 c.stop();assert(latest.status==='disabled','disabled published');
 await c.refresh();assert(latest.status==='disabled','stopped controller never revives');
 GLib.setenv('USAGESCOPE_TEST_MODE','switch-account',true);
 const seen=[];
 const switched=new CodexController({executable:exe,pollSeconds:180,publish:v=>{if(v.snapshot)seen.push(v.snapshot.accountId);}});
 switched.start();await switched.refresh();
 await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,100,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 switched.stop();
 assert(!seen.includes('fake-account'),'account change invalidates outstanding old response');
 assert(seen.includes('new-account'),'account change schedules one new read');
 GLib.unsetenv('USAGESCOPE_TEST_MODE');
 // Real Codex often emits account/updated during an ordinary read. The visible quota must stay
 // (no flicker, no reset of the low-quota alert baseline) while the read is redone.
 const views=[];
 const steady=new CodexController({executable:exe,pollSeconds:180,publish:v=>views.push(v)});
 steady.start();await steady.refresh();
 assert(views.at(-1).snapshot?.accountId==='fake-account','first read shows the account');
 const shown=views.length;
 GLib.setenv('USAGESCOPE_TEST_MODE','switch-account',true);
 await steady.refresh();
 for(let i=0;i<40&&views.at(-1).snapshot?.accountId!=='new-account';i++)await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,25,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 steady.stop();GLib.unsetenv('USAGESCOPE_TEST_MODE');
 const during=views.slice(shown,-1);
 assert(during.every(v=>v.snapshot!==null),'account/updated never blanks the visible quota: '+during.map(v=>v.status).join(','));
 assert(views.at(-2).snapshot?.accountId==='new-account'&&!views.slice(shown).some(v=>v.status==='ready'&&v.snapshot.accountId==='fake-account'),'the redone read replaces the discarded response');
 GLib.setenv('USAGESCOPE_TEST_MODE','signed-out',true);
 const signedDir=GLib.dir_make_tmp('usagescope-signed-out-XXXXXX');GLib.setenv('USAGESCOPE_TEST_PID',signedDir+'/pid',true);
 const signedOut=new CodexController({executable:exe,pollSeconds:180,publish:v=>latest=v});
 signedOut.start();await signedOut.refresh();
 assert(latest.status==='auth-required','signed-out CLI reports sign-in requirement');
 const retry=signedOut.timer;
 const retrySource=retry?GLib.MainContext.default().find_source_by_id(retry):null;
 await new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,50,()=>{resolve();return GLib.SOURCE_REMOVE;}));
 const [,signedBytes]=Gio.File.new_for_path(signedDir+'/pid').load_contents(null);
 const signedPid=new TextDecoder().decode(signedBytes);
 const signedLeaked=Gio.File.new_for_path('/proc/'+signedPid).query_exists(null);
 const retryAlive=retry!==0&&!!retrySource&&!retrySource.is_destroyed();
 signedOut.stop();Gio.File.new_for_path(signedDir+'/pid').delete(null);Gio.File.new_for_path(signedDir).delete(null);
 GLib.unsetenv('USAGESCOPE_TEST_PID');GLib.unsetenv('USAGESCOPE_TEST_MODE');
 assert(retryAlive,'signed-out state keeps a backoff retry so a terminal codex login is picked up');
 assert(!signedLeaked,'signed-out read releases its process');
 print('Codex GJS integration passed: pipes, model deny, timeout, bounds, malformed, shutdown, account switch, signed-out retry');
};
const loop=new GLib.MainLoop(null,false);let error=null;
run().catch(e=>{error=e;printerr(e.stack??e.message);}).finally(()=>loop.quit());
loop.run();if(error)throw error;
