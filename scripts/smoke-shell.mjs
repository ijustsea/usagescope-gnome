// Real GNOME smoke in a separate bus, configuration, runtime and headless compositor.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const repo=resolve(import.meta.dirname,'..');
if(process.argv[2]!=='--inner') {
 const r=spawnSync('dbus-run-session',['--',process.execPath,import.meta.filename,'--inner'],{encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
 if(r.error)throw r.error;
 if(r.status!==0)console.error(r.stderr.slice(-16000));
 console.log(r.stdout.trim());process.exit(r.status??1);
}
const meta=JSON.parse(await readFile(join(repo,'metadata.json'),'utf8'));
if(!/^[a-z0-9-]+@[a-z0-9.-]+$/.test(meta.uuid))throw new Error('Invalid UUID');
const scratch=await mkdtemp(join(tmpdir(),'usagescope-shell-'));
const env={...process.env,XDG_CONFIG_HOME:join(scratch,'config'),XDG_DATA_HOME:join(scratch,'data'),XDG_CACHE_HOME:join(scratch,'cache'),XDG_RUNTIME_DIR:join(scratch,'runtime'),GSETTINGS_BACKEND:'keyfile',LIBGL_ALWAYS_SOFTWARE:'1',NO_AT_BRIDGE:'1',GIO_USE_VFS:'local',GIO_USE_VOLUME_MONITOR:'unix',USAGESCOPE_TEST_TRACE:join(scratch,'rpc-trace')};
for(const key of ['XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR'])await mkdir(env[key],{recursive:true,mode:0o700});
const extension=join(env.XDG_DATA_HOME,'gnome-shell/extensions',meta.uuid);
await mkdir(extension,{recursive:true});
function run(bin,args){const r=spawnSync(bin,args,{env,encoding:'utf8',timeout:5000});if(r.status!==0)throw new Error(bin+': '+r.stderr);return r.stdout;}
run('unzip',['-q',join(repo,'dist',meta.uuid+'.shell-extension.zip'),'-d',extension]);
run('gsettings',['set','org.gnome.shell','enabled-extensions',"['"+meta.uuid+"']"]);
run('gsettings',['set','org.gnome.shell','disable-user-extensions','false']);
env.GSETTINGS_SCHEMA_DIR=join(extension,'schemas');
run('gsettings',['set','org.gnome.shell.extensions.usagescope','codex-path',join(repo,'tests/fixtures/fake-codex.mjs')]);
run('gsettings',['set','org.gnome.shell.extensions.usagescope','enable-codex','true']);
run('gsettings',['set','org.gnome.shell.extensions.usagescope','enable-claude','true']);
const bridge=spawnSync('gjs',['-m',join(extension,'claude/bridge.js')],{env,encoding:'utf8',input:JSON.stringify({session_id:'isolated-smoke',rate_limits:{five_hour:{used_percentage:55,resets_at:2000000000}}}),timeout:5000});
if(bridge.status!==0)throw new Error('Packaged Claude bridge failed: '+bridge.stderr);
let log='';const shell=spawn('gnome-shell',['--wayland','--headless','--no-x11','--virtual-monitor','1280x720','--wayland-display','usagescope-'+process.pid,'--debug-control'],{env,stdio:['ignore','pipe','pipe']});
shell.stdout.on('data',b=>{log=(log+b).slice(-16000);});shell.stderr.on('data',b=>{log=(log+b).slice(-16000);});
let exited=false;shell.on('exit',()=>{exited=true;});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,...args){return run('gdbus',['call','--session','--dest','org.gnome.Shell','--object-path','/org/gnome/Shell','--method',method,...args]);}
try {
 let info='';
 for(let i=0;i<80;i++){
  if(exited)throw new Error('Headless Shell exited');
  try{info=call('org.gnome.Shell.Extensions.GetExtensionInfo',meta.uuid);if(/['"]state['"]: <(?:uint32 )?1(?:\.0)?>/.test(info))break;}catch{}
  await sleep(250);
 }
 if(!/['"]state['"]: <(?:uint32 )?1(?:\.0)?>/.test(info))throw new Error('Extension not enabled: '+info);
 for(let i=0;i<40;i++) {
  try{if((await readFile(env.USAGESCOPE_TEST_TRACE,'utf8')).includes('account/rateLimits/read'))break;}catch{}
  await sleep(100);
 }
 const trace=await readFile(env.USAGESCOPE_TEST_TRACE,'utf8');
 if(!trace.includes('account/rateLimits/read')||/thread\/|turn\//.test(trace))throw new Error('Packaged extension did not query quota safely');
 const errors=call('org.gnome.Shell.Extensions.GetExtensionErrors',meta.uuid);
 if(!/\(\[\]|@as \[\]/.test(errors))throw new Error('Extension errors: '+errors);
 call('org.gnome.Shell.Extensions.DisableExtension',meta.uuid);
 call('org.gnome.Shell.Extensions.EnableExtension',meta.uuid);
 await sleep(300);
 const after=call('org.gnome.Shell.Extensions.GetExtensionErrors',meta.uuid);
 if(!/\(\[\]|@as \[\]/.test(after))throw new Error('Re-enable errors: '+after);
 console.log('Isolated GNOME Shell smoke passed: packaged Claude input, Codex quota RPC, enable/disable/re-enable, no reported extension errors.');
} catch(e){console.error(log);throw e;}
finally {
 shell.kill('SIGTERM');await Promise.race([new Promise(r=>shell.once('exit',r)),sleep(3000)]);
 if(!exited)shell.kill('SIGKILL');
 await rm(scratch,{recursive:true,force:true});
}
