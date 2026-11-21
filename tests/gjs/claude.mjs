import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const base=GLib.getenv('USAGESCOPE_TEST_BUILD')??GLib.build_filenamev([GLib.get_current_dir(),'build']);
const {ClaudeController}=await import(`file://${base}/claude/controller.js`);
const {storeSnapshot,projectPayload}=await import(`file://${base}/claude/storage.js`);
const {runSetup}=await import(`file://${base}/claude/setup.js`);
const ownRuntime=GLib.dir_make_tmp('usagescope-claude-gjs-XXXXXX');
GLib.setenv('XDG_RUNTIME_DIR',ownRuntime,true);
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const pause=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const input=(session,value)=>({session_id:session,rate_limits:{five_hour:{used_percentage:value,resets_at:1795248000}}});
const store=async(session,value,order=GLib.get_monotonic_time(),plan=null)=>storeSnapshot(projectPayload(input(session,value),plan),order,Date.now());
const views=[];const controller=new ClaudeController({publish:view=>views.push(view)});
try {
 const raw={...input('a',10),subscription_type:'max',model:{id:'max',display_name:'Max'}};
 assert(projectPayload(raw).payload.subscription_type===undefined,'raw subscription/model must not supply plan');
 assert(projectPayload(raw,'pro').payload.subscription_type==='pro','only explicit probe metadata supplies plan');
 controller.start();await controller.refresh();assert(views.at(-1).status==='waiting','empty storage must wait');
 await store('a',0);for(let i=0;i<30&&views.at(-1).status!=='ready';i++)await pause(20);
 assert(views.at(-1).status==='ready','monitor must see snapshot without refresh');assert(views.at(-1).snapshot.windows[0].usedPercent===0,'zero valid');
 const first=views.at(-1).snapshot;const [source]=controller.listSources();
 // A malformed later immutable entry must preserve historical data, never turn missing into 100.
 const dir=GLib.build_filenamev([ownRuntime,'usagescope-gnome']);
 const bad=Gio.File.new_for_path(GLib.build_filenamev([dir,`s-${source}-${String(GLib.get_monotonic_time()).padStart(16,'0')}-${GLib.uuid_string_random()}.json`]));
 const out=bad.create(Gio.FileCreateFlags.PRIVATE,null);out.write_all(new TextEncoder().encode('{"SECRET_BAD":'),null);out.close(null);
 await controller.refresh();assert(views.at(-1).snapshot?.windows[0].usedPercent===0,'invalid must keep last good');assert(!views.at(-1).message.includes('SECRET'),'no raw error');
 bad.delete(null);
 await store('a',80,GLib.get_monotonic_time()+100);await store('a',10,GLib.get_monotonic_time()-1000000);await controller.refresh();
 assert(views.at(-1).snapshot.windows[0].usedPercent===80,'older late writer must not win');
 await store('b',45,GLib.get_monotonic_time(),'max');await controller.refresh();assert(controller.listSources().length===2,'source list');assert(views.at(-1).snapshot===null,'multiple sources must clear automatic selection');assert(views.at(-1).status==='waiting','explicit source required');
 await controller.selectSource(source);assert(views.at(-1).snapshot.sourceId===source,'explicit source honored');assert(views.at(-1).snapshot.windows[0].usedPercent===80,'no blending');
 const other=controller.listSources().find(id=>id!==source);await controller.selectSource(other);assert(views.at(-1).snapshot.windows[0].usedPercent===45,'switch clears other account');assert(views.at(-1).snapshot.planType==='max','projected plan reaches selected source');
 await controller.connect();assert(/setup/i.test(views.at(-1).message),'connect gives guidance');
 const pending=controller.refresh();controller.stop();await pending;const count=views.length;await store('b',90);await pause(100);assert(views.length===count,'no publication after stop');
 const restart=[];const stopped=new ClaudeController({publish:view=>restart.push(view)});stopped.start();stopped.stop();await pause(100);assert(restart.length===0,'stop cancels initial scan');
 // A scheduler fixture edits after readOriginal's last metadata query. This
 // models a same-user editor interleaving, not a foreign-UID exploit.
 for(const existing of [false,true]){
  const config=Gio.File.new_for_path(ownRuntime).get_child(`restore-${existing}`);config.make_directory(null);
  GLib.setenv('CLAUDE_CONFIG_DIR',config.get_path(),true);GLib.setenv('PATH','/usr/bin:/bin',true);
  const settings=config.get_child('settings.json');
  if(existing)GLib.file_set_contents(settings.get_path(),'{"original":true}\n');
  assert(await runSetup(['--apply'])===0,'fixture apply');
  const installed=JSON.parse(new TextDecoder().decode(settings.load_contents(null)[1]));
  const concurrent=JSON.stringify({...installed,theme:'edited-theme',permissions:{allow:['fixture-preserved']}});
  const query=Gio.File.prototype.query_info;let queries=0,injected=false;
  Gio.File.prototype.query_info=function(attributes,...args){
   const info=query.call(this,attributes,...args);
   if(this.get_path()===settings.get_path()&&attributes.includes('etag::value')&&++queries===2){
    injected=true;GLib.file_set_contents(settings.get_path(),concurrent);
   }
   return info;
  };
  let result;try{result=await runSetup(['--restore']);}finally{Gio.File.prototype.query_info=query;}
  assert(injected,'scheduler fixture must run');assert(result===1,'concurrent capture must refuse restore');
  const it=config.enumerate_children('standard::name',Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null);const archives=[];let item;
  while((item=it.next_file(null)))if(item.get_name().startsWith('.usagescope-recovery-'))archives.push(config.get_child(item.get_name()));it.close(null);
  assert(archives.length===1,'conflict retains a private recovery archive');
  const captured=archives[0].get_child('settings.json');assert(new TextDecoder().decode(captured.load_contents(null)[1])===concurrent,'captured concurrent bytes retained');
  assert(new TextDecoder().decode(settings.load_contents(null)[1])===concurrent,'restore back without replacing edits');
  assert(JSON.parse(concurrent).statusLine.command===installed.statusLine.command,'fixture retains installed command');
  assert(config.get_child('.usagescope-setup/manifest.json').query_exists(null),'conflict retains original transaction');
  assert(config.get_child('.usagescope-setup/statusline').query_exists(null),'edited settings keep their referenced wrapper');
 }
 print('Claude GJS checks passed');
} finally {
 controller.stop();const walk=file=>{if(file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null)===Gio.FileType.DIRECTORY){const it=file.enumerate_children('standard::name',Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null);let child;while((child=it.next_file(null)))walk(file.get_child(child.get_name()));it.close(null);}file.delete(null);};walk(Gio.File.new_for_path(ownRuntime));
}
