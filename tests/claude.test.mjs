import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync, symlinkSync, existsSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'usagescope-claude-tests-'));
const build = join(scratch, 'build');
const cli = (name, args=[], input='', env={}) => spawnSync('/usr/bin/gjs', ['-m', join(build, 'claude', `${name}.js`), ...args], {input, encoding:'utf8', timeout:10000, env:{...process.env, PATH:'/usr/bin:/bin', ...env}});
const payload = (session='session-A', used=23) => JSON.stringify({session_id:session, rate_limits:{five_hour:{used_percentage:used,resets_at:1795248000},seven_day:{used_percentage:0,resets_at:null}}, transcript_path:'SECRET_TRANSCRIPT', api_key:'SECRET_TOKEN', workspace:{current_dir:'SECRET_DIRECTORY'}});
const runtime = () => mkdtempSync(join(scratch, 'runtime-'));
const snapshots = dir => readdirSync(join(dir,'usagescope-gnome')).filter(n=>/^s-.*\.json$/.test(n));
const readSnapshot = (dir,name) => JSON.parse(readFileSync(join(dir,'usagescope-gnome',name),'utf8'));
const config = settings => {const dir=mkdtempSync(join(scratch,'config-')); if(settings!==undefined)writeFileSync(join(dir,'settings.json'),settings,{mode:0o600});return dir;};
const renderer = (dir, source='process.stdout.write(Buffer.from([65,0,66,10]));') => {const file=join(dir,'renderer');writeFileSync(file,`#!${process.execPath}\n${source}\n`,{mode:0o700});return file;};
const fakeClaude = () => {
 const dir=config();const file=join(dir,'claude');const calls=join(dir,'calls');
 writeFileSync(file,`#!${process.execPath}\nconst fs=require('node:fs');
 if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['auth','status','--json']))process.exit(9);
 fs.appendFileSync(${JSON.stringify(calls)},'call\\n');
 if(process.env.USAGESCOPE_FAKE_EXPECT_PROFILE!==process.env.CLAUDE_CONFIG_DIR)process.exit(8);
 process.stderr.write('SECRET_AUTH_STDERR');
 const output=()=>{process.stdout.write(process.env.USAGESCOPE_FAKE_OUTPUT??'{"subscriptionType":"max","email":"SECRET_EMAIL","orgId":"SECRET_ORG","token":"SECRET_TOKEN"}');process.exit(Number(process.env.USAGESCOPE_FAKE_EXIT??0));};
 if(process.env.USAGESCOPE_FAKE_HANG)setTimeout(output,10000);else if(process.env.USAGESCOPE_FAKE_DELAY_MS)setTimeout(output,Number(process.env.USAGESCOPE_FAKE_DELAY_MS));else output();\n`,{mode:0o700});
 const profile=config();return {file,calls,env:{CLAUDE_CONFIG_DIR:profile,USAGESCOPE_FAKE_EXPECT_PROFILE:profile},count:()=>existsSync(calls)?readFileSync(calls,'utf8').trim().split('\n').length:0};
};
const planCaches = dir => readdirSync(join(dir,'usagescope-gnome')).filter(n=>/^p-[a-f0-9]{64}\.json$/.test(n));
const newest = dir => snapshots(dir).map(n=>readSnapshot(dir,n)).sort((a,b)=>b.order-a.order)[0];
before(()=>{
 const compiled=spawnSync(join(root,'node_modules/.bin/tsc'),['-p',join(root,'tsconfig.json'),'--outDir',build],{encoding:'utf8'});
 assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
});
after(()=>rmSync(scratch,{recursive:true,force:true}));

test('bridge projects quotas, hashes session, and publishes private immutable snapshots',()=>{
 const dir=runtime();const result=cli('bridge',[],payload(),{XDG_RUNTIME_DIR:dir});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
 const files=snapshots(dir);assert.equal(files.length,1);
 const value=readSnapshot(dir,files[0]);
 assert.deepEqual(Object.keys(value).sort(),['order','payload','receivedAt','sourceId','version']);
 assert.equal(value.sourceId,createHash('sha256').update('session-A').digest('hex'));
 assert.deepEqual(value.payload,{rate_limits:{five_hour:{used_percentage:23,resets_at:1795248000},seven_day:{used_percentage:0,resets_at:null}}});
 assert.ok(Number.isSafeInteger(value.order)&&value.order>0);assert.ok(Math.abs(Date.now()-value.receivedAt)<10000);
 assert.equal(statSync(join(dir,'usagescope-gnome')).mode&0o777,0o700);
 assert.equal(statSync(join(dir,'usagescope-gnome',files[0])).mode&0o777,0o600);
 assert.ok(!JSON.stringify(value).includes('SECRET'));assert.ok(!JSON.stringify(value).includes('session-A'));
 const previous=readFileSync(join(dir,'usagescope-gnome',files[0]),'utf8');
 assert.equal(cli('bridge',[],payload(),{XDG_RUNTIME_DIR:dir}).status,0);
 assert.equal(snapshots(dir).length,2);assert.equal(readFileSync(join(dir,'usagescope-gnome',files[0]),'utf8'),previous);
});

test('bridge rejects malformed, oversized and missing-source input without exposing payload',()=>{
 for(const input of ['SECRET_BAD_JSON',payload('',23),payload('a',101),JSON.stringify({session_id:'a',rate_limits:{five_hour:{used_percentage:null}}}),'x'.repeat(256*1024+1)]){
  const dir=runtime();const result=cli('bridge',[],input,{XDG_RUNTIME_DIR:dir});
  assert.notEqual(result.status,0);assert.ok(!result.stderr.includes('SECRET_BAD_JSON'));assert.equal(result.stdout,'');
  if(existsSync(join(dir,'usagescope-gnome')))assert.equal(snapshots(dir).length,0);
 }
 const dir=runtime();assert.equal(cli('bridge',[],payload('a',0)+' '.repeat(256*1024-Buffer.byteLength(payload('a',0))),{XDG_RUNTIME_DIR:dir}).status,0);
});

test('bridge refuses missing runtime directory, symlinks, and permissive storage',()=>{
 for(const xdg of ['',join(scratch,'missing-runtime')])assert.notEqual(cli('bridge',[],payload(),{XDG_RUNTIME_DIR:xdg}).status,0);
 const dir=runtime();const target=runtime();symlinkSync(target,join(dir,'usagescope-gnome'));
 assert.notEqual(cli('bridge',[],payload(),{XDG_RUNTIME_DIR:dir}).status,0);assert.deepEqual(readdirSync(target),[]);
 const loose=runtime();mkdirSync(join(loose,'usagescope-gnome'),{mode:0o755});
 assert.notEqual(cli('bridge',[],payload(),{XDG_RUNTIME_DIR:loose}).status,0);
 const alias=join(scratch,'runtime-alias');symlinkSync(target,alias);
 assert.notEqual(cli('bridge',[],payload(),{XDG_RUNTIME_DIR:alias}).status,0);
});

test('bridge retains two per source and refuses a seventeenth source',()=>{
 const dir=runtime();for(let i=0;i<5;i++)assert.equal(cli('bridge',[],payload('a',i),{XDG_RUNTIME_DIR:dir}).status,0);
 assert.equal(snapshots(dir).length,2);
 assert.deepEqual(snapshots(dir).map(n=>readSnapshot(dir,n).payload.rate_limits.five_hour.used_percentage).sort(),[3,4]);
 for(let i=1;i<16;i++)assert.equal(cli('bridge',[],payload(`source-${i}`),{XDG_RUNTIME_DIR:dir}).status,0);
 assert.notEqual(cli('bridge',[],payload('source-17'),{XDG_RUNTIME_DIR:dir}).status,0);
 assert.equal(new Set(snapshots(dir).map(n=>readSnapshot(dir,n).sourceId)).size,16);
});

test('invocation order is captured before stdin, so a slow older invocation cannot supersede a newer one',async()=>{
 const dir=runtime();const env={...process.env,XDG_RUNTIME_DIR:dir};
 const older=spawn('/usr/bin/gjs',['-m',join(build,'claude/bridge.js')],{env,stdio:['pipe','pipe','pipe']});
 const finished=new Promise(resolve=>older.once('close',resolve));older.stdin.write(payload('a',10).slice(0,10));
 await new Promise(resolve=>setTimeout(resolve,200));
 assert.equal(cli('bridge',[],payload('a',80),{XDG_RUNTIME_DIR:dir}).status,0);
 older.stdin.end(payload('a',10).slice(10));assert.equal(await finished,0);
 const entries=snapshots(dir).map(n=>readSnapshot(dir,n)).sort((a,b)=>a.order-b.order);
 assert.deepEqual(entries.map(x=>x.payload.rate_limits.five_hour.used_percentage),[10,80]);
});

test('concurrent writers respect retention and directory bounds',async()=>{
 const dir=runtime();const children=Array.from({length:8},(_,i)=>new Promise(resolve=>{
  const child=spawn('/usr/bin/gjs',['-m',join(build,'claude/bridge.js')],{env:{...process.env,XDG_RUNTIME_DIR:dir},stdio:['pipe','ignore','pipe']});
  child.on('close',resolve);child.stdin.end(payload('same',i));
 }));
 assert.deepEqual(await Promise.all(children),Array(8).fill(0));assert.equal(snapshots(dir).length,2);
});

test('renderer receives original stdin and keeps exact stdout when export fails',()=>{
 const dir=config();const input=payload();const exe=renderer(dir,'let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>process.stdout.write(b));');
 const result=cli('bridge',['--renderer',exe],input,{XDG_RUNTIME_DIR:''});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);assert.equal(result.stderr,'');
 const binary=renderer(dir);const result2=cli('bridge',['--renderer',binary],'SECRET_BAD_JSON',{XDG_RUNTIME_DIR:''});
 assert.equal(result2.status,0);assert.equal(result2.stdout,'A\0B\n');assert.equal(result2.stderr,'');
 const noisy=renderer(dir,'process.stdout.write("x".repeat(300000));');
 assert.notEqual(cli('bridge',['--renderer',noisy],input,{XDG_RUNTIME_DIR:''}).status,0);
});

test('bridge --help is read-only and exposes setup guidance',()=>{
 const result=cli('bridge',['--help'],'',{XDG_RUNTIME_DIR:''});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/256.*KiB/);assert.match(result.stdout,/renderer/);
});

test('setup preview has no writes, apply backs up exact bytes, restore recovers exact settings',()=>{
 const original='{\n  "theme": "dark", "permissions": {"allow": []}\n}\n';const dir=config(original);const env={CLAUDE_CONFIG_DIR:dir};
 let result=cli('setup',['--preview'],'',env);assert.equal(result.status,0,result.stderr);assert.deepEqual(readdirSync(dir),['settings.json']);
 result=cli('setup',['--apply'],'',env);assert.equal(result.status,0,result.stderr);
 const installed=JSON.parse(readFileSync(join(dir,'settings.json'),'utf8'));assert.equal(installed.theme,'dark');assert.equal(installed.statusLine.type,'command');
 const wrapper=installed.statusLine.command;const rendered=spawnSync('/bin/sh',['-c',wrapper],{input:payload(),encoding:'utf8',env:{...process.env,XDG_RUNTIME_DIR:runtime()},timeout:10000});assert.equal(rendered.status,0,rendered.stderr);
 result=cli('setup',['--restore'],'',env);assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(join(dir,'settings.json'),'utf8'),original);
});

test('setup preserves an exact executable renderer and refuses shell syntax without writes',()=>{
 const dir=config();const exe=renderer(dir);writeFileSync(join(dir,'settings.json'),JSON.stringify({statusLine:{type:'command',command:exe,padding:2},other:42}),{mode:0o600});
 let result=cli('setup',['--apply','--renderer',exe],'',{CLAUDE_CONFIG_DIR:dir});assert.equal(result.status,0,result.stderr);
 const settings=JSON.parse(readFileSync(join(dir,'settings.json'),'utf8'));assert.equal(settings.statusLine.padding,2);
 const rendered=spawnSync('/bin/sh',['-c',settings.statusLine.command],{input:payload(),encoding:'utf8',env:{...process.env,XDG_RUNTIME_DIR:''},timeout:10000});assert.equal(rendered.status,0,rendered.stderr);assert.equal(rendered.stdout,'A\0B\n');
 for(const command of [`${exe} --arg`,`${exe}; touch BAD`,'echo SECRET_RENDERER',`"${exe}"`]){
  const unsafe=config(JSON.stringify({statusLine:{type:'command',command}}));const before=readFileSync(join(unsafe,'settings.json'),'utf8');
  result=cli('setup',['--apply'],'',{CLAUDE_CONFIG_DIR:unsafe});assert.notEqual(result.status,0);assert.match(result.stderr,/manual/i);assert.ok(!result.stderr.includes('SECRET_RENDERER'));assert.equal(readFileSync(join(unsafe,'settings.json'),'utf8'),before);assert.deepEqual(readdirSync(unsafe),['settings.json']);
 }
});

test('setup refuses conflicting restore, symlink settings and stale backup transaction',()=>{
 const dir=config('{}');const env={CLAUDE_CONFIG_DIR:dir};assert.equal(cli('setup',['--apply'],'',env).status,0);
 const files=readdirSync(dir);for(const name of files.filter(n=>n!=='settings.json'))assert.equal(statSync(join(dir,name)).mode&0o077,0);
 assert.notEqual(cli('setup',['--apply'],'',env).status,0);
 writeFileSync(join(dir,'settings.json'),'{"changed":true}',{mode:0o600});assert.notEqual(cli('setup',['--restore'],'',env).status,0);assert.equal(readFileSync(join(dir,'settings.json'),'utf8'),'{"changed":true}');
 const target=config('{}');const link=config();symlinkSync(join(target,'settings.json'),join(link,'settings.json'));
 assert.notEqual(cli('setup',['--apply'],'',{CLAUDE_CONFIG_DIR:link}).status,0);assert.equal(readFileSync(join(target,'settings.json'),'utf8'),'{}');
});

test('real GJS controller monitors immutable files, retains last good, isolates sources and stops',()=>{
 const result=spawnSync('/usr/bin/gjs',['-m',join(root,'tests/gjs/claude.mjs')],{encoding:'utf8',timeout:15000,env:{...process.env,USAGESCOPE_TEST_BUILD:build,XDG_RUNTIME_DIR:runtime(),G_DEBUG:'fatal-criticals'}});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stdout,/Claude GJS checks passed/);
});


test('omitted rate_limits exports a full empty snapshot, retiring prior windows',()=>{
 const dir=runtime();assert.equal(cli('bridge',[],payload('retire',80),{XDG_RUNTIME_DIR:dir}).status,0);
 const result=cli('bridge',[],JSON.stringify({session_id:'retire'}),{XDG_RUNTIME_DIR:dir});assert.equal(result.status,0,result.stderr);
 const newest=snapshots(dir).map(n=>readSnapshot(dir,n)).sort((a,b)=>b.order-a.order)[0];assert.deepEqual(newest.payload,{rate_limits:{}});
});

test('SIGKILL of a bridge invocation cannot leave a persistent exporter lock',async()=>{
 const dir=runtime();const child=spawn('/usr/bin/gjs',['-m',join(build,'claude/bridge.js')],{env:{...process.env,XDG_RUNTIME_DIR:dir},stdio:['pipe','ignore','ignore']});
 const exited=new Promise(resolve=>child.once('close',resolve));child.stdin.write('{');await new Promise(resolve=>setTimeout(resolve,100));child.kill('SIGKILL');await exited;
 const result=cli('bridge',[],payload('after-cancel',70),{XDG_RUNTIME_DIR:dir});assert.equal(result.status,0,result.stderr);assert.equal(snapshots(dir).length,1);
 assert.ok(!readdirSync(join(dir,'usagescope-gnome')).some(name=>name.includes('lock')));
});

test('setup restores initially absent settings and refuses changed wrapper artifacts',()=>{
 const dir=config();const env={CLAUDE_CONFIG_DIR:dir};assert.equal(cli('setup',['--apply'],'',env).status,0);assert.equal(cli('setup',['--restore'],'',env).status,0);assert.deepEqual(readdirSync(dir),[]);
 const modified=config('{}');const changedEnv={CLAUDE_CONFIG_DIR:modified};assert.equal(cli('setup',['--apply'],'',changedEnv).status,0);
 const wrapper=join(modified,'.usagescope-setup','statusline');writeFileSync(wrapper,'# manually changed\n',{mode:0o700});
 assert.notEqual(cli('setup',['--restore'],'',changedEnv).status,0);assert.ok(existsSync(wrapper));
});

test('setup refuses insecure config directories and preserves original settings mode',()=>{
 const insecure=config('{}');chmodSync(insecure,0o777);assert.notEqual(cli('setup',['--apply'],'',{CLAUDE_CONFIG_DIR:insecure}).status,0);assert.deepEqual(readdirSync(insecure),['settings.json']);
 const dir=config('{"safe":true}\n');const file=join(dir,'settings.json');chmodSync(file,0o644);const env={CLAUDE_CONFIG_DIR:dir};
 assert.equal(cli('setup',['--apply'],'',env).status,0);assert.equal(statSync(file).mode&0o777,0o600);assert.equal(cli('setup',['--restore'],'',env).status,0);assert.equal(statSync(file).mode&0o777,0o644);
});

test('setup refuses PATH gjs under a writable parent even when its symlink target is trusted',()=>{
 const unsafe=mkdtempSync(join(scratch,'unsafe-bin-'));chmodSync(unsafe,0o777);symlinkSync('/usr/bin/gjs',join(unsafe,'gjs'));
 const original='{"safe":true}\n';const dir=config(original);
 const result=cli('setup',['--apply'],'',{CLAUDE_CONFIG_DIR:dir,PATH:`${unsafe}:/usr/bin:/bin`});
 assert.notEqual(result.status,0);assert.equal(readFileSync(join(dir,'settings.json'),'utf8'),original);assert.deepEqual(readdirSync(dir),['settings.json']);
});

test('setup persists the canonical interpreter path for a safe PATH symlink',()=>{
 const safe=mkdtempSync(join(scratch,'safe-bin-'));symlinkSync('/usr/bin/gjs',join(safe,'gjs'));
 const dir=config('{}');const result=cli('setup',['--apply'],'',{CLAUDE_CONFIG_DIR:dir,PATH:`${safe}:/usr/bin:/bin`});assert.equal(result.status,0,result.stderr);
 const wrapper=readFileSync(join(dir,'.usagescope-setup','statusline'),'utf8');assert.equal(wrapper.split('\n')[0],`#!${realpathSync('/usr/bin/gjs')} -m`);
});

test('bridge refuses renderers reached through writable parents or a symlink to those parents',()=>{
 const unsafe=mkdtempSync(join(scratch,'unsafe-renderer-'));const exe=renderer(unsafe);chmodSync(unsafe,0o777);
 const safe=mkdtempSync(join(scratch,'safe-renderer-link-'));const alias=join(safe,'renderer');symlinkSync(exe,alias);
 for(const path of [exe,alias]){
  const result=cli('bridge',['--renderer',path],payload(),{XDG_RUNTIME_DIR:runtime()});assert.notEqual(result.status,0);assert.equal(result.stdout,'');
 }
});

test('bridge probes only an explicit CLI and caches a private minimal plan for 300 seconds',()=>{
 const fake=fakeClaude(),dir=runtime();const env={...fake.env,XDG_RUNTIME_DIR:dir,PATH:`${resolve(fake.file,'..')}:/usr/bin:/bin`};
 const untrusted=JSON.stringify({...JSON.parse(payload()),subscription_type:'pro',model:{id:'pro',display_name:'Pro'}});
 let result=cli('bridge',[],untrusted,env);assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),0);assert.equal(newest(dir).payload.subscription_type,undefined);
 result=cli('bridge',['--claude',fake.file],untrusted,env);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');assert.equal(result.stderr,'');assert.equal(fake.count(),1);assert.equal(newest(dir).payload.subscription_type,'max');
 result=cli('bridge',['--claude',fake.file],payload(),{...env,USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"pro"}'});assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),1);assert.equal(newest(dir).payload.subscription_type,'max');
 const files=planCaches(dir);assert.equal(files.length,1);const file=join(dir,'usagescope-gnome',files[0]);assert.equal(statSync(file).mode&0o777,0o600);
 let cache=JSON.parse(readFileSync(file,'utf8'));assert.equal(cache.planType,'max');assert.ok(!JSON.stringify(cache).includes('SECRET'));assert.ok(!JSON.stringify(cache).includes(fake.env.CLAUDE_CONFIG_DIR));assert.ok(!JSON.stringify(cache).includes(fake.file));
 cache.checkedAt=Date.now()-300001;writeFileSync(file,JSON.stringify(cache));
 result=cli('bridge',['--claude',fake.file],payload(),{...env,USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"pro"}'});assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),2);assert.equal(newest(dir).payload.subscription_type,'pro');
});

test('subscription cache isolates profiles sharing runtime and never stores raw auth output',()=>{
 const fake=fakeClaude(),dir=runtime(),other=config();const env={...fake.env,XDG_RUNTIME_DIR:dir};
 assert.equal(cli('bridge',['--claude',fake.file],payload('profile-a'),env).status,0);
 const result=cli('bridge',['--claude',fake.file],payload('profile-b'),{...env,CLAUDE_CONFIG_DIR:other,USAGESCOPE_FAKE_EXPECT_PROFILE:other,USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"pro","email":"SECRET_OTHER_EMAIL"}'});
 assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),2);assert.equal(newest(dir).payload.subscription_type,'pro');assert.equal(planCaches(dir).length,2);
 for(const file of readdirSync(join(dir,'usagescope-gnome'))){const text=readFileSync(join(dir,'usagescope-gnome',file),'utf8');assert.ok(!text.includes('SECRET'));assert.ok(!text.includes(fake.env.CLAUDE_CONFIG_DIR));assert.ok(!text.includes(other));}
});

test('malformed, oversized, failed and timed out subscription probes keep quotas and cache unknown',()=>{
 for(const extra of [
  {USAGESCOPE_FAKE_OUTPUT:'SECRET_MALFORMED'},
  {USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"pro","extra":"'+'x'.repeat(65536)+'"}'},
  {USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"new-plan","model":{"id":"max"}}'},
  {USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"pro"}',USAGESCOPE_FAKE_EXIT:'1'},
  {USAGESCOPE_FAKE_HANG:'1'},
 ]){
  const fake=fakeClaude(),dir=runtime(),env={...fake.env,...extra,XDG_RUNTIME_DIR:dir};const start=Date.now();
  const result=cli('bridge',['--claude',fake.file],payload(),env);assert.equal(result.status,0,result.stderr);assert.ok(Date.now()-start<4500,'probe deadline must remain bounded');assert.equal(result.stderr,'');assert.equal(result.stdout,'');
  assert.equal(newest(dir).payload.subscription_type,undefined);assert.equal(newest(dir).payload.rate_limits.five_hour.used_percentage,23);assert.equal(fake.count(),1);
  assert.equal(cli('bridge',['--claude',fake.file],payload(),env).status,0);assert.equal(fake.count(),1,'unknown results also cache');
 }
});

test('subscription cache rejects symlinks and revalidates CLI trust even on cache hits',()=>{
 const fake=fakeClaude(),dir=runtime(),env={...fake.env,XDG_RUNTIME_DIR:dir};assert.equal(cli('bridge',['--claude',fake.file],payload(),env).status,0);
 chmodSync(fake.file,0o777);let result=cli('bridge',['--claude',fake.file],payload(),env);assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),1);assert.equal(newest(dir).payload.subscription_type,undefined);
 chmodSync(fake.file,0o700);const file=join(dir,'usagescope-gnome',planCaches(dir)[0]);const target=join(config(),'keep');writeFileSync(target,'SECRET_UNTOUCHED',{mode:0o600});rmSync(file);symlinkSync(target,file);
 result=cli('bridge',['--claude',fake.file],payload(),env);assert.equal(result.status,0,result.stderr);assert.equal(newest(dir).payload.subscription_type,undefined);assert.equal(readFileSync(target,'utf8'),'SECRET_UNTOUCHED');assert.equal(fake.count(),1);
});

test('setup embeds a discovered canonical Claude path without probing and supports explicit --claude with renderer',()=>{
 const fake=fakeClaude(),bin=config();const alias=join(bin,'claude');symlinkSync(fake.file,alias);const dir=config('{}');const env={...fake.env,CLAUDE_CONFIG_DIR:dir,USAGESCOPE_FAKE_EXPECT_PROFILE:dir,PATH:`${bin}:/usr/bin:/bin`};
 let result=cli('setup',['--preview'],'',env);assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),0);assert.deepEqual(readdirSync(dir),['settings.json']);
 result=cli('setup',['--apply'],'',env);assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),0);
 const settings=JSON.parse(readFileSync(join(dir,'settings.json'),'utf8'));const run=spawnSync('/bin/sh',['-c',settings.statusLine.command],{input:payload(),encoding:'utf8',timeout:10000,env:{...process.env,...env,XDG_RUNTIME_DIR:runtime()}});assert.equal(run.status,0,run.stderr);assert.equal(fake.count(),1);
 const wrapper=readFileSync(join(dir,'.usagescope-setup','statusline'),'utf8');assert.ok(wrapper.includes(JSON.stringify(realpathSync(fake.file))));assert.ok(!wrapper.includes(JSON.stringify(alias)));
 const other=config();const exe=renderer(other);writeFileSync(join(other,'settings.json'),JSON.stringify({statusLine:{type:'command',command:exe}}),{mode:0o600});
 result=cli('setup',['--apply','--renderer',exe,'--claude',fake.file],'',{CLAUDE_CONFIG_DIR:other});assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),1);
 chmodSync(fake.file,0o777);const bad=config('{}');result=cli('setup',['--apply','--claude',fake.file],'',{CLAUDE_CONFIG_DIR:bad});assert.notEqual(result.status,0);assert.deepEqual(readdirSync(bad),['settings.json']);
});

test('cache corruption, future timestamps and CLI changes are misses while quotas and renderer remain usable',()=>{
 const fake=fakeClaude(),dir=runtime(),env={...fake.env,XDG_RUNTIME_DIR:dir};
 assert.equal(cli('bridge',['--claude',fake.file],payload(),env).status,0);
 const file=join(dir,'usagescope-gnome',planCaches(dir)[0]);
 for(const corrupt of [()=>'{"planType":"pro"',cache=>JSON.stringify({...cache,checkedAt:Date.now()+600000}),cache=>JSON.stringify({...cache,planType:'SECRET_BAD_CACHE'})]){
  const cache=JSON.parse(readFileSync(file,'utf8'));writeFileSync(file,corrupt(cache));const before=fake.count();
  const result=cli('bridge',['--claude',fake.file],payload(),env);assert.equal(result.status,0,result.stderr);assert.equal(fake.count(),before+1);assert.equal(newest(dir).payload.subscription_type,'max');
 }
 const other=fakeClaude();const result=cli('bridge',['--claude',other.file,'--renderer',renderer(config())],payload(),{...other.env,CLAUDE_CONFIG_DIR:fake.env.CLAUDE_CONFIG_DIR,USAGESCOPE_FAKE_EXPECT_PROFILE:fake.env.CLAUDE_CONFIG_DIR,XDG_RUNTIME_DIR:dir,USAGESCOPE_FAKE_OUTPUT:'{"subscriptionType":"pro"}'});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'A\0B\n');assert.equal(result.stderr,'');assert.equal(other.count(),1);assert.equal(newest(dir).payload.subscription_type,'pro');
});

test('CLI path tampering through writable directories stays unknown without running the CLI',()=>{
 const fake=fakeClaude(),dir=runtime(),env={...fake.env,XDG_RUNTIME_DIR:dir};assert.equal(cli('bridge',['--claude',fake.file],payload(),env).status,0);
 const parent=resolve(fake.file,'..');chmodSync(parent,0o777);const alias=join(config(),'claude');symlinkSync(fake.file,alias);
 for(const file of [fake.file,alias]){const result=cli('bridge',['--claude',file],payload(),env);assert.equal(result.status,0,result.stderr);assert.equal(newest(dir).payload.subscription_type,undefined);assert.equal(fake.count(),1);}
 const setup=config('{}');const result=cli('setup',['--apply'],'',{CLAUDE_CONFIG_DIR:setup,PATH:`${parent}:/usr/bin:/bin`});assert.notEqual(result.status,0);assert.deepEqual(readdirSync(setup),['settings.json']);
});

test('profile hashing never merges paths whose dot segments traverse a symlink',()=>{
 const fake=fakeClaude(),dir=runtime(),base=config(),far=config();mkdirSync(join(far,'inner'));mkdirSync(join(far,'profile'));mkdirSync(join(base,'profile'));symlinkSync(join(far,'inner'),join(base,'link'));
 const first=join(base,'profile'),second=`${base}/link/../profile`;
 const invoke=(profile,plan)=>cli('bridge',['--claude',fake.file],payload(),{...fake.env,CLAUDE_CONFIG_DIR:profile,USAGESCOPE_FAKE_EXPECT_PROFILE:profile,USAGESCOPE_FAKE_OUTPUT:JSON.stringify({subscriptionType:plan}),XDG_RUNTIME_DIR:dir});
 assert.equal(invoke(first,'max').status,0);const result=invoke(second,'pro');assert.equal(result.status,0,result.stderr);assert.equal(newest(dir).payload.subscription_type,'pro');assert.equal(fake.count(),2);assert.equal(planCaches(dir).length,2);
});

test('concurrent profile cache publication keeps the private runtime inventory bounded',async()=>{
 const fake=fakeClaude(),dir=runtime();const profiles=Array.from({length:20},()=>config());
 const directory=join(dir,'usagescope-gnome');mkdirSync(directory,{mode:0o700});
 for(let i=0;i<16;i++){
  const sourceId=createHash('sha256').update(i===0?'cache-bound':`seed-source-${i}`).digest('hex');
  for(let j=1;j<=2;j++){const order=i*2+j;writeFileSync(join(directory,`s-${sourceId}-${String(order).padStart(16,'0')}-00000000-0000-4000-8000-000000000000.json`),JSON.stringify({version:1,sourceId,order,receivedAt:Date.now(),payload:{rate_limits:{five_hour:{used_percentage:40}}}}),{mode:0o600});}
 }
 for(let i=0;i<15;i++)writeFileSync(join(directory,`p-${createHash('sha256').update(`seed-profile-${i}`).digest('hex')}.json`),JSON.stringify({version:1,checkedAt:Date.now(),planType:null,executableId:'0'.repeat(64)}),{mode:0o600});
 const results=await Promise.all(profiles.map(profile=>new Promise(resolve=>{
  const child=spawn('/usr/bin/gjs',['-m',join(build,'claude/bridge.js'),'--claude',fake.file],{env:{...process.env,...fake.env,CLAUDE_CONFIG_DIR:profile,USAGESCOPE_FAKE_EXPECT_PROFILE:profile,USAGESCOPE_FAKE_DELAY_MS:'1000',XDG_RUNTIME_DIR:dir},stdio:['pipe','ignore','ignore']});child.on('close',resolve);child.stdin.end(payload('cache-bound'));
 })));
 assert.deepEqual(results,Array(20).fill(0));assert.ok(planCaches(dir).length<=16,'concurrent profiles must not grow past cache capacity');assert.ok(!readdirSync(directory).some(name=>name.includes('lock')||name.startsWith('.pending-')));
 const result=cli('bridge',[],payload('cache-bound',42),{XDG_RUNTIME_DIR:dir});assert.equal(result.status,0,result.stderr);assert.equal(newest(dir).payload.rate_limits.five_hour.used_percentage,42);assert.equal(snapshots(dir).length,32);assert.ok(readdirSync(directory).length<=48);
});
