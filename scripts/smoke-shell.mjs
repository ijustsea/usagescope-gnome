// Real GNOME smoke in a separate bus, configuration, runtime and headless compositor.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const repo=resolve(import.meta.dirname,'..');
if(process.argv[2]!=='--inner') {
 // The private bus activates xdg-document-portal and gvfs with its own environment; under the host XDG_RUNTIME_DIR they unmount and replace the host's /run/user/$UID/doc and gvfs mounts.
 const runtime=await mkdtemp(join(tmpdir(),'usagescope-bus-'));
 const r=spawnSync('dbus-run-session',['--',process.execPath,import.meta.filename,'--inner'],{env:{...process.env,XDG_RUNTIME_DIR:runtime},encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
 await rm(runtime,{recursive:true,force:true});
 if(r.error)throw r.error;
 if(r.status!==0)console.error(r.stderr.slice(-16000));
 console.log(r.stdout.trim());process.exit(r.status??1);
}
const meta=JSON.parse(await readFile(join(repo,'metadata.json'),'utf8'));
if(!/^[a-z0-9-]+@[a-z0-9.-]+$/.test(meta.uuid))throw new Error('Invalid UUID');
const scratch=await mkdtemp(join(tmpdir(),'usagescope-shell-'));
const env={...process.env,XDG_CONFIG_HOME:join(scratch,'config'),XDG_DATA_HOME:join(scratch,'data'),XDG_CACHE_HOME:join(scratch,'cache'),XDG_RUNTIME_DIR:join(scratch,'runtime'),GSETTINGS_BACKEND:'keyfile',LIBGL_ALWAYS_SOFTWARE:'1',NO_AT_BRIDGE:'1',GIO_USE_VFS:'local',GIO_USE_VOLUME_MONITOR:'unix',USAGESCOPE_TEST_TRACE:join(scratch,'rpc-trace'),USAGESCOPE_CLAUDE_TEST_TRACE:join(scratch,'claude-trace'),USAGESCOPE_TEST_MODE:'compact-ui',USAGESCOPE_UI_REPORT:join(scratch,'ui-report.json'),CLAUDE_CONFIG_DIR:join(scratch,'claude-config')};
for(const key of ['XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_RUNTIME_DIR'])await mkdir(env[key],{recursive:true,mode:0o700});
const extension=join(env.XDG_DATA_HOME,'gnome-shell/extensions',meta.uuid);
await mkdir(extension,{recursive:true});
function run(bin,args){const r=spawnSync(bin,args,{env,encoding:'utf8',timeout:5000});if(r.status!==0)throw new Error(bin+': '+r.stderr);return r.stdout;}
run('unzip',['-q',join(repo,'dist',meta.uuid+'.shell-extension.zip'),'-d',extension]);
await appendFile(join(extension,'extension.js'),'\n'+await readFile(join(repo,'tests/fixtures/shell-ui-probe.js'),'utf8'));
run('gsettings',['set','org.gnome.shell','enabled-extensions',"['"+meta.uuid+"']"]);
run('gsettings',['set','org.gnome.shell','disable-user-extensions','false']);
env.GSETTINGS_SCHEMA_DIR=join(extension,'schemas');
run('gsettings',['set','org.gnome.shell.extensions.usagescope','codex-path',join(repo,'tests/fixtures/fake-codex.mjs')]);
run('gsettings',['set','org.gnome.shell.extensions.usagescope','claude-path',join(repo,'tests/fixtures/fake-claude-usage.mjs')]);
run('gsettings',['set','org.gnome.shell.extensions.usagescope','enable-codex','true']);
run('gsettings',['set','org.gnome.shell.extensions.usagescope','enable-claude','true']);
let log='';const shell=spawn('gnome-shell',['--wayland','--headless','--no-x11','--virtual-monitor',process.env.USAGESCOPE_TEST_MONITOR??'1280x720','--wayland-display','usagescope-'+process.pid,'--debug-control'],{env,stdio:['ignore','pipe','pipe']});
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
 let report=null;
 for(let i=0;i<80;i++) {
  try{report=JSON.parse(await readFile(env.USAGESCOPE_UI_REPORT,'utf8'));break;}catch{}
  await sleep(100);
 }
 if(!report)throw new Error('Real popup report not produced');
 if(report.height>480||report.y+report.height>report.stageHeight+2)throw new Error('Popup overflows the display: '+JSON.stringify(report));
 if(report.bars.length!==4||!report.bars.some(b=>b.style.includes('danger'))||!report.bars.some(b=>b.style.includes('codex'))||!report.bars.some(b=>b.style.includes('claude')))throw new Error('Real bars or colors missing: '+JSON.stringify(report));
 const danger=report.bars.find(b=>b.style.includes('danger'));
 if(!(danger.track>0&&danger.width>0&&danger.width/danger.track<0.05))throw new Error('Remaining fraction was not allocated: '+JSON.stringify(report.bars));
 if(!report.reopened||Math.abs(report.reopened[0].width/report.reopened[0].track-1)>0.01||Math.abs(report.reopened[1].width/report.reopened[1].track-0.62)>0.01)throw new Error('Closed-menu update lost the 100%/62% fills: '+JSON.stringify(report.reopened));
 if(report.bars.some(bar=>Math.abs(bar.x)>1))throw new Error('Quota fill is not left-aligned: '+JSON.stringify(report.bars));
 if(report.bars.some(bar=>bar.height<=0||bar.trackHeight<=0||bar.height>bar.trackHeight+1))throw new Error('Quota fill has no visible height: '+JSON.stringify(report.bars));
 for(const bar of [...report.bars,...report.reopened,...(report.cli?.bars??[])]){
  const expected=bar.style.includes('danger')?[237,51,59]:bar.style.includes('codex')?[53,132,228]:[233,149,80];
  if(bar.color.alpha!==255||expected.some((channel,i)=>channel!==[bar.color.red,bar.color.green,bar.color.blue][i]))throw new Error('Quota fill color differs from provider/threshold: '+JSON.stringify(bar));
  if(bar.height<=0||Math.abs(bar.x)>1)throw new Error('Updated fill is not visible/aligned: '+JSON.stringify(bar));
 }
 if(report.cli?.status!=='ready'||report.cli?.plan!=='team'||report.cli.windows!==2||!report.cli.independentSource)throw new Error('Packaged Claude CLI read did not publish its quota: '+JSON.stringify(report.cli));
 const claudeMessages=(await readFile(env.USAGESCOPE_CLAUDE_TEST_TRACE,'utf8')).trim().split('\n').map(JSON.parse);
 if(claudeMessages.length!==4||claudeMessages.some(m=>m.type!=='control_request'||!['initialize','get_usage'].includes(m.request.subtype)))throw new Error('Claude start/interval change sent more than the expected read-only control requests');
 if(!report.settings?.text.includes('Refresh')||!report.settings.text.includes('잔여 30% 이하 알림')||report.settings.pollSeconds!==60)throw new Error('Compact settings or default interval failed: '+JSON.stringify(report.settings));
 const retired=['CLI 연결 및 설정','Claude 상태줄 연결','Codex CLI 로그인 연결…','Claude CLI 조회 (실험)','Claude 세션 선택'];
 if(report.settings.text.some(t=>retired.some(r=>t.startsWith(r))))throw new Error('Retired connection/setup controls are still shown: '+JSON.stringify(report.settings.text));
 if(report.settings.y+report.settings.height>report.stageHeight+2||report.settings.text.some(t=>t.includes('gjs -m ')))throw new Error('Settings overflow or embedded long commands remain');
 if(report.settings.controls.length!==3||report.settings.controls.some(c=>c.y<report.settings.y||c.y+c.height>report.settings.y+report.settings.height+1))throw new Error('Primary settings controls are clipped: '+JSON.stringify({popupY:report.settings.y,popupHeight:report.settings.height,controls:report.settings.controls}));
 if(!report.fast?.expanded||report.fast.expanded.upper>report.fast.expanded.page+1)throw new Error('Settings need scrolling on this display: '+JSON.stringify(report.fast?.expanded));
 if(!report.fast?.visible||report.fast.pollSeconds!==15||JSON.stringify(report.fast.checked)!=='["15초"]'||!report.fast.defaultChecked||JSON.stringify(report.fast.choices)!=='["15초","1분","3분","5분","15분","1시간"]'||!report.fast.stillOpen||!report.fast.controllersReplaced)throw new Error('Interval choices are clipped, not persisted, not highlighted or not applied to both controllers: '+JSON.stringify(report.fast));
 if(!report.fast.focus.owned||report.fast.focus.alpha<=0)throw new Error('Interval keyboard focus is not visible: '+JSON.stringify(report.fast.focus));
 if(JSON.stringify(report.plans)!==JSON.stringify(['Plus','Team'])||JSON.stringify(report.fast.plans)!==JSON.stringify(['Plus','Team']))throw new Error('Subscription badges must be simple tier names: '+JSON.stringify([report.plans,report.fast.plans]));
 if(report.text.some(t=>/Source:|Last local receipt:|Snapshot available/.test(t)))throw new Error('Diagnostics leaked into compact card');
 console.log('Real popup geometry '+Math.round(report.width)+'x'+Math.round(report.height)+'; four allocated colored quota bars; subscription labels '+report.plans.join('/')+'; expanded settings '+report.fast.expanded.upper+'/'+report.fast.expanded.page+'px');
 call('org.gnome.Shell.Extensions.DisableExtension',meta.uuid);
 call('org.gnome.Shell.Extensions.EnableExtension',meta.uuid);
 await sleep(300);
 const after=call('org.gnome.Shell.Extensions.GetExtensionErrors',meta.uuid);
 if(!/\(\[\]|@as \[\]/.test(after))throw new Error('Re-enable errors: '+after);
 console.log('Isolated GNOME Shell smoke passed: Codex+Claude CLI reads, 60s default/15s choice, Plus/Team badges, compact settings without retired controls, closed-menu refresh and lifecycle.');
} catch(e){console.error(log);throw e;}
finally {
 shell.kill('SIGTERM');await Promise.race([new Promise(r=>shell.once('exit',r)),sleep(3000)]);
 if(!exited)shell.kill('SIGKILL');
 await rm(scratch,{recursive:true,force:true});
}
