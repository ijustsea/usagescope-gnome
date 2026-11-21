import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
const base=GLib.getenv('USAGESCOPE_TEST_BUILD')??GLib.build_filenamev([GLib.get_current_dir(),'build']);
const {ClaudeController}=await import(`file://${base}/claude/controller.js`);
const {storeSnapshot,projectPayload}=await import(`file://${base}/claude/storage.js`);
const ownRuntime=GLib.dir_make_tmp('usagescope-claude-gjs-XXXXXX');
GLib.setenv('XDG_RUNTIME_DIR',ownRuntime,true);
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const pause=ms=>new Promise(resolve=>GLib.timeout_add(GLib.PRIORITY_DEFAULT,ms,()=>{resolve();return GLib.SOURCE_REMOVE;}));
const input=(session,value)=>({session_id:session,rate_limits:{five_hour:{used_percentage:value,resets_at:1795248000}}});
const store=async(session,value,order=GLib.get_monotonic_time())=>storeSnapshot(projectPayload(input(session,value)),order,Date.now());
const views=[];const controller=new ClaudeController({publish:view=>views.push(view)});
try {
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
 await store('b',45);await controller.refresh();assert(controller.listSources().length===2,'source list');assert(views.at(-1).snapshot===null,'multiple sources must clear automatic selection');assert(views.at(-1).status==='waiting','explicit source required');
 await controller.selectSource(source);assert(views.at(-1).snapshot.sourceId===source,'explicit source honored');assert(views.at(-1).snapshot.windows[0].usedPercent===80,'no blending');
 const other=controller.listSources().find(id=>id!==source);await controller.selectSource(other);assert(views.at(-1).snapshot.windows[0].usedPercent===45,'switch clears other account');
 await controller.connect();assert(/setup/i.test(views.at(-1).message),'connect gives guidance');
 const pending=controller.refresh();controller.stop();await pending;const count=views.length;await store('b',90);await pause(100);assert(views.length===count,'no publication after stop');
 const restart=[];const stopped=new ClaudeController({publish:view=>restart.push(view)});stopped.start();stopped.stop();await pause(100);assert(restart.length===0,'stop cancels initial scan');
 print('Claude GJS checks passed');
} finally {
 controller.stop();const walk=file=>{if(file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null)===Gio.FileType.DIRECTORY){const it=file.enumerate_children('standard::name',Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null);let child;while((child=it.next_file(null)))walk(file.get_child(child.get_name()));it.close(null);}file.delete(null);};walk(Gio.File.new_for_path(ownRuntime));
}
