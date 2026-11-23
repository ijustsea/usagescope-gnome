import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {trustedExecutable} from '../runtime/executable.js';
import {parseClaudeCliUsage} from '../core/normalize.js';
import {ProviderState} from '../core/state.js';
import {normalPollSeconds} from '../core/polling.js';
import type {Publish,UsageSnapshot} from '../core/types.js';

function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid CLI response');
 return value as Record<string,unknown>;
}
function identity(value:unknown):string|null{
 const account=record(value??{});
 if(typeof account.email!=='string'||!account.email||account.email.length>320||
  (account.organization!=null&&(typeof account.organization!=='string'||account.organization.length>512)))return null;
 const checksum=new GLib.Checksum(GLib.ChecksumType.SHA256);
 checksum.update(new TextEncoder().encode(JSON.stringify([
  GLib.getenv('CLAUDE_CONFIG_DIR')??GLib.get_home_dir()+'/.claude',account.email,account.organization??null])));
 return checksum.get_string();
}

/** A signed-out CLI still answers initialize, reporting tokenSource "none" (observed on Claude Code 2.1.323). */
export class ClaudeSignedOut extends Error{constructor(){super('Claude CLI is not signed in');}}
function signedOut(account:unknown):boolean{
 return !!account&&typeof account==='object'&&!Array.isArray(account)&&(account as Record<string,unknown>).tokenSource==='none';
}

/** Official SDK control interface (vendor-labelled experimental). Never sends a user message or /usage prompt. */
export async function readClaudeCliUsage(executable:string,cancel:Gio.Cancellable,timeoutMs=15000):Promise<UsageSnapshot>{
 if(cancel.is_cancelled())throw new Error('CLI query cancelled');
 const launcher=new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.STDIN_PIPE|Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_SILENCE});
 launcher.set_cwd('/');launcher.setenv('DISABLE_AUTOUPDATER','1',true);
 // Skip telemetry, error reporting and other non-essential CLI traffic on every poll.
 launcher.setenv('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC','1',true);
 const child=launcher.spawnv([trustedExecutable(executable),'-p','--input-format','stream-json','--output-format','stream-json','--verbose',
  '--no-session-persistence','--setting-sources','','--settings','{"disableAllHooks":true}',
  '--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--tools','','--disable-slash-commands','--no-chrome']);
 const input=child.get_stdin_pipe()!,output=child.get_stdout_pipe()!,ioCancel=new Gio.Cancellable();
 let ended=false,exitTimer=0;
 const exited=new Promise<void>(resolve=>child.wait_async(null,(_p,r)=>{try{child.wait_finish(r);}catch{}ended=true;resolve();}));
 const terminate=()=>{ioCancel.cancel();if(!ended)try{child.force_exit();}catch{}};
 const signal=cancel.connect(terminate);
 let timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,Math.max(50,Math.min(30000,timeoutMs)),()=>{timer=0;terminate();return GLib.SOURCE_REMOVE;});
 const chunks:Uint8Array[]=[];let frameBytes=0,totalBytes=0,messageCount=0;
 const messages:Record<string,unknown>[]=[];
 const append=(bytes:Uint8Array)=>{
  frameBytes+=bytes.length;if(frameBytes>1024*1024)throw new Error('CLI frame limit');
  if(bytes.length)chunks.push(bytes);
 };
 const deliver=()=>{
  if(++messageCount>256)throw new Error('CLI message limit');
  const bytes=new Uint8Array(frameBytes);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  chunks.length=0;frameBytes=0;
  if(bytes.length)messages.push(record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))));
 };
 const send=(id:string,request:{subtype:'initialize'|'get_usage';hooks?:Record<string,never>;skip_behaviors?:boolean})=>new Promise<void>((resolve,reject)=>{
  const bytes=new TextEncoder().encode(JSON.stringify({type:'control_request',request_id:id,request})+'\n');
  input.write_all_async(bytes,GLib.PRIORITY_DEFAULT,ioCancel,(_s,r)=>{try{input.write_all_finish(r);resolve();}catch(e){reject(e);}});
 });
 const reply=async(id:string):Promise<Record<string,unknown>>=>{
  for(;;){
   while(messages.length){
    const m=messages.shift()!;
    if(m.type==='system'||m.type==='auth_status'||m.type==='rate_limit_event')continue;
    if(m.type!=='control_response')throw new Error('Unexpected CLI interaction');
    const response=record(m.response);
    if(response.request_id!==id||response.subtype!=='success')throw new Error('CLI control request unavailable');
    return record(response.response);
   }
   const bytes=await new Promise<Uint8Array>((resolve,reject)=>output.read_bytes_async(4096,GLib.PRIORITY_DEFAULT,ioCancel,(_s,r)=>{
    try{resolve(output.read_bytes_finish(r).toArray());}catch(e){reject(e);}
   }));
   if(!bytes.length)throw new Error('CLI stream closed');
   totalBytes+=bytes.length;if(totalBytes>4*1024*1024)throw new Error('CLI input limit');
   let start=0;
   for(let i=0;i<bytes.length;i++)if(bytes[i]===10){append(bytes.slice(start,i));deliver();start=i+1;}
   append(bytes.slice(start));
  }
 };
 try{
  await send('usagescope-init',{subtype:'initialize',hooks:{}});
  const init=await reply('usagescope-init');
  // Without sign-in get_usage only reports "no limits", so stop before asking for it.
  if(signedOut(init.account))throw new ClaudeSignedOut();
  const accountId=identity(init.account);
  await send('usagescope-usage',{subtype:'get_usage',skip_behaviors:true});
  const payload=await reply('usagescope-usage');
  const source='claude-cli-'+(accountId??GLib.uuid_string_random());
  const snapshot=parseClaudeCliUsage(payload,source,Date.now());snapshot.accountId=accountId;
  input.close(null);
  exitTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,2000,()=>{exitTimer=0;terminate();return GLib.SOURCE_REMOVE;});
  await exited;
  if(cancel.is_cancelled())throw new Error('CLI query cancelled');
  return snapshot;
 }finally{
  if(timer)GLib.Source.remove(timer);if(exitTimer)GLib.Source.remove(exitTimer);
  terminate();await exited;cancel.disconnect(signal);
  try{input.close(null);}catch{}try{output.close(null);}catch{}
 }
}

interface Options{executable:string;pollSeconds:number;publish:Publish;}
export class ClaudeCliController{
 private state=new ProviderState();private active=false;private generation=0;private timer=0;private failures=0;
 private pending:Promise<void>|null=null;private cancel:Gio.Cancellable|null=null;private paused=false;
 constructor(private options:Options){}
 private publish():void{try{this.options.publish(this.state.view());}catch{}}
 start():void{if(this.active)return;this.active=true;this.generation++;if(!this.paused)void this.refresh();}
 refresh():Promise<void>{
  if(!this.active)return Promise.resolve();if(this.pending)return this.pending;
  if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}
  const generation=this.generation,cancel=new Gio.Cancellable();this.cancel=cancel;
  this.state.loading();this.publish();
  this.pending=readClaudeCliUsage(this.options.executable,cancel).then(snapshot=>{
   if(!this.active||generation!==this.generation)return;
   this.state.accept(snapshot);this.failures=0;this.publish();
  }).catch(error=>{
   if(!this.active||generation!==this.generation)return;
   this.failures++;
   if(error instanceof ClaudeSignedOut)this.state.fail('터미널에서 claude auth login을 실행하세요.','auth-required');
   else this.state.fail('Claude CLI 조회 실패: 로그인·지원 버전을 확인하세요.');
   this.publish();
  }).finally(()=>{
   if(generation!==this.generation)return;
   this.pending=null;this.cancel=null;
   if(!this.active||this.paused)return;
   const seconds=this.failures?Math.min(900,30*2**Math.min(5,this.failures-1)):normalPollSeconds(this.options.pollSeconds);
   this.timer=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,seconds,()=>{this.timer=0;void this.refresh();return GLib.SOURCE_REMOVE;});
  });
  return this.pending;
 }
 /** While the user is away nobody reads the panel: keep the last view and stop scheduling reads. */
 pause():void{this.paused=true;if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}}
 resume():void{if(!this.paused)return;this.paused=false;void this.refresh();}
 stop():void{
  this.active=false;this.generation++;if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}
  this.cancel?.cancel();this.cancel=null;this.pending=null;this.state.clear('disabled');this.publish();
 }
}
