import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {MAX_FRAME_BYTES, MAX_CONNECTION_BYTES, MAX_CONNECTION_MESSAGES, rpcAllowed} from '../core/policy.js';
import {trustedExecutable} from '../runtime/executable.js';
type Pending={resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:number};
export class RpcError extends Error {constructor(public code:number,message='Codex request failed'){super(message);}}
export class RpcClient {
 private process:Gio.Subprocess; private cancel=new Gio.Cancellable(); private pending=new Map<number,Pending>();
 private nextId=1; private closed=false; private ready:Promise<void>|null=null; private writes:Promise<void>=Promise.resolve();
 private chunks:Uint8Array[]=[]; private frameSize=0; private stderrSize=0;
 private connectionBytes=0;private messageCount=0;
 private finishing=false;private finishTimer=0;private finishPromise:Promise<void>|null=null;private finishResolve:(()=>void)|null=null;
 onNotification:((method:string,params:unknown)=>void)|null=null;
 get pid():string|null {return this.process.get_identifier();}
 constructor(executable:string,private timeoutMs=15000) {
  const path=trustedExecutable(executable);
  const launcher=new Gio.SubprocessLauncher({flags:Gio.SubprocessFlags.STDIN_PIPE|Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE});
  launcher.set_cwd('/');
  this.process=launcher.spawnv([path,'app-server','--listen','stdio://']);
  void this.read(this.process.get_stdout_pipe()!,false);
  void this.read(this.process.get_stderr_pipe()!,true);
  this.process.wait_async(null,(_source,result)=>{
   try{this.process.wait_finish(result);}catch{}
   this.abort(new Error('Codex process exited'),true);
  });
 }
 private async read(stream:Gio.InputStream,stderr:boolean):Promise<void> {
  try {
   while(!this.closed) {
    const bytes=await new Promise<Uint8Array>((resolve,reject)=>stream.read_bytes_async(4096,GLib.PRIORITY_DEFAULT,this.cancel,(_s,r)=>{
     try{resolve(stream.read_bytes_finish(r).toArray());}catch(e){reject(e);}
    }));
    if(!bytes.length){if(!stderr&&!this.finishing)this.abort(new Error('Codex stream closed'));return;}
    if(stderr){this.stderrSize+=bytes.length;if(this.stderrSize>MAX_FRAME_BYTES)throw new Error('Codex diagnostic limit exceeded');continue;}
    this.connectionBytes+=bytes.length;
    if(this.connectionBytes>MAX_CONNECTION_BYTES)throw new Error('Codex connection input limit exceeded');
    let start=0;
    for(let i=0;i<bytes.length;i++) if(bytes[i]===10) {
     this.append(bytes.slice(start,i));this.deliver();start=i+1;
    }
    this.append(bytes.slice(start));
   }
  }catch{this.abort(new Error('Codex transport unavailable'));}
  finally{try{stream.close(null);}catch{}}
 }
 private append(bytes:Uint8Array):void {
  if(this.closed)return;
  this.frameSize+=bytes.length;
  if(this.frameSize>MAX_FRAME_BYTES)throw new Error('Codex response exceeds limit');
  if(bytes.length)this.chunks.push(bytes);
 }
 private deliver():void {
  if(this.closed)return;
  if(++this.messageCount>MAX_CONNECTION_MESSAGES)throw new Error('Codex message limit exceeded');
  const bytes=new Uint8Array(this.frameSize);let offset=0;
  for(const chunk of this.chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  this.chunks=[];this.frameSize=0;
  if(!bytes.length)return;
  const message:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!message||typeof message!=='object'||Array.isArray(message))throw new Error('Malformed Codex response');
  const m=message as Record<string,unknown>;
  if(typeof m.id==='number') {
   const p=this.pending.get(m.id);if(!p)return;
   this.pending.delete(m.id);GLib.Source.remove(p.timer);
   if(m.error) {
    const e=m.error as Record<string,unknown>;
    const reason=typeof e.message==='string'&&/auth|login|sign.?in/i.test(e.message)?'Authentication required':'Codex request failed';
    p.reject(new RpcError(typeof e.code==='number'?e.code:0,reason));
   } else p.resolve(m.result);
  } else if(typeof m.method==='string'&&m.method.length<128) {
   try{this.onNotification?.(m.method,m.params);}catch{/* UI callbacks cannot poison transport. */}
  }
 }
 async request(method:string,params:unknown={}):Promise<unknown> {
  if(!rpcAllowed(method))throw new Error('RPC method is not permitted');
  if(this.closed||this.finishing)throw new Error('Codex connection is closed');
  if(!this.ready) this.ready=this.initialize();
  await this.ready;
  return this.raw(method,params);
 }
 private async initialize():Promise<void> {
  await this.raw('initialize',{clientInfo:{name:'usagescope_gnome',title:'UsageScope',version:'0.4.0'}});
  await this.send({method:'initialized',params:{}});
 }
 private raw(method:string,params:unknown):Promise<unknown> {
  if(this.closed||this.pending.size>=8)return Promise.reject(new Error('Codex connection unavailable'));
  const id=this.nextId++;
  return new Promise((resolve,reject)=>{
   const timer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,this.timeoutMs,()=>{
    this.abort(new Error('Codex request timed out'));return GLib.SOURCE_REMOVE;
   });
   this.pending.set(id,{resolve,reject,timer});
   void this.send({id,method,params}).catch(()=>this.abort(new Error('Codex write failed')));
  });
 }
 private send(message:unknown):Promise<void> {
  const data=new TextEncoder().encode(JSON.stringify(message)+'\n');
  this.writes=this.writes.then(()=>new Promise<void>((resolve,reject)=>{
   if(this.closed){reject(new Error('Codex connection closed'));return;}
   const input=this.process.get_stdin_pipe()!;
   input.write_all_async(data,GLib.PRIORITY_DEFAULT,this.cancel,(_s,r)=>{
    try{input.write_all_finish(r);resolve();}catch(e){reject(e);}
   });
  }));
  return this.writes;
 }
 private abort(error:Error,exited=false):void {
  if(this.closed)return;this.closed=true;
  if(this.finishTimer){GLib.Source.remove(this.finishTimer);this.finishTimer=0;}
  for(const p of this.pending.values()){GLib.Source.remove(p.timer);p.reject(error);}this.pending.clear();
  this.onNotification=null;this.cancel.cancel();this.chunks=[];this.frameSize=0;
  try{this.process.get_stdin_pipe()?.close(null);}catch{}
  if(!exited)try{this.process.force_exit();}catch{}
  this.finishResolve?.();this.finishResolve=null;
 }
 /** Complete successful quota-only work with EOF, then bounded exit waiting.
  * stop() remains immediate for disable, cancellation and protocol failures.
  */
 finish():Promise<void> {
  if(this.closed)return Promise.resolve();
  if(this.finishPromise)return this.finishPromise;
  if(this.pending.size){this.stop();return Promise.resolve();}
  this.finishing=true;this.onNotification=null;
  this.finishPromise=new Promise(resolve=>{this.finishResolve=resolve;});
  this.finishTimer=GLib.timeout_add(GLib.PRIORITY_DEFAULT,Math.min(2000,this.timeoutMs),()=>{
   this.finishTimer=0;this.abort(new Error('Codex exit deadline exceeded'));return GLib.SOURCE_REMOVE;
  });
  void this.writes.then(()=>{if(!this.closed)this.process.get_stdin_pipe()?.close(null);})
   .catch(()=>this.abort(new Error('Codex close failed')));
  return this.finishPromise;
 }
 stop():void {this.abort(new Error('Codex connection stopped'));}
}
