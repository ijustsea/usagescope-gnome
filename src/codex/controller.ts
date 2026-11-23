import GLib from 'gi://GLib';
import {RpcClient,RpcError} from './rpc.js';
import {parseCodexUsage} from '../core/normalize.js';
import {validateAuthUrl} from '../core/policy.js';
import {ProviderState} from '../core/state.js';
import {normalPollSeconds} from '../core/polling.js';
import type {Publish} from '../core/types.js';
interface Options {executable:string;pollSeconds:number;publish:Publish;openUri:(uri:string)=>void;}
export class CodexController {
 private state=new ProviderState(); private rpc:RpcClient|null=null;private active=false;private generation=0;
 private timer=0;private pending:Promise<void>|null=null;private loginId:string|null=null;private failures=0;
 private loginAttempt=0;private loginPending=false;private loginTimer=0;
 private authEpoch=0;private accountChanged=false;
 constructor(private options:Options) {}
 private publish():void {try{this.options.publish(this.state.view());}catch{/* Isolate UI failures. */}}
 private client():RpcClient {
  if(!this.rpc) {
   this.rpc=new RpcClient(this.options.executable);
   this.rpc.onNotification=(method,params)=>{
    if(!this.active)return;
    if(method==='account/login/completed') {
     const p=params as Record<string,unknown>|null;
     if(p?.loginId!==this.loginId||!this.loginId)return;
     this.endLoginTimer();this.loginAttempt++;this.loginPending=false;
     this.loginId=null;
     if(p.success===true){this.state.clear();void this.refresh();}
     else{this.rpc?.stop();this.rpc=null;this.state.fail('로그인이 취소되었거나 완료되지 않았습니다.','auth-required');this.publish();}
    } else if(method==='account/updated') {
     this.authEpoch++;this.accountChanged=true;
     this.state.clear();this.publish();
     if(!this.pending){this.accountChanged=false;void this.refresh();}
    }
   };
  }
  return this.rpc;
 }
 start():void {if(this.active)return;this.active=true;this.generation++;void this.refresh();}
 refresh():Promise<void> {
  if(!this.active)return Promise.resolve();
  if(this.loginPending||this.loginId)return Promise.resolve();
  if(this.pending)return this.pending;
  if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}
  const generation=this.generation;
  this.pending=this.read(generation).finally(()=>{
   if(generation!==this.generation)return;
   this.pending=null;
   if(this.active&&this.accountChanged){this.accountChanged=false;void this.refresh();return;}
   if(this.active&&!this.loginPending&&!this.loginId&&this.state.view().status!=='auth-required')this.schedule();
  });
  return this.pending;
 }
 private async read(generation:number):Promise<void> {
  const authEpoch=this.authEpoch;
  this.state.loading();this.publish();
  try {
   const client=this.client();
   const payload=await client.request('account/rateLimits/read',{excludeResetCreditDetails:true});
   if(!this.active||generation!==this.generation||authEpoch!==this.authEpoch)return;
   this.state.accept(parseCodexUsage(payload,'codex-local',Date.now()));this.failures=0;this.publish();
   // Quota-only clients need no resident server between polls. Login keeps
   // its callback-owning process alive until completion/cancellation.
   if(!this.loginPending&&!this.loginId){await client.finish();if(this.rpc===client)this.rpc=null;}
  }catch(e) {
   if(!this.active||generation!==this.generation)return;
   this.rpc?.stop();this.rpc=null;this.failures++;
   const auth=e instanceof RpcError&&e.message==='Authentication required';
   this.state.fail(auth?'공식 Codex 로그인이 필요합니다.':'Codex 조회 실패: CLI 경로·네트워크·지원 버전을 확인하세요.',auth?'auth-required':'error');this.publish();
  }
 }
 private schedule():void {
  if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}
  const delay=this.failures?Math.min(900,30*2**Math.min(this.failures-1,5))+Math.floor(Math.random()*10):normalPollSeconds(this.options.pollSeconds);
  this.timer=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,delay,()=>{this.timer=0;void this.refresh();return GLib.SOURCE_REMOVE;});
 }
 async connect():Promise<void> {
  if(!this.active)this.start();
  const generation=this.generation;
  if(this.loginId||this.loginPending)return;
  if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}
  const attempt=++this.loginAttempt;this.loginPending=true;
  if(this.pending)await this.pending;
  if(!this.active||generation!==this.generation||attempt!==this.loginAttempt)return;
  this.state.loading();this.publish();
  try {
   const result=await this.client().request('account/login/start',{type:'chatgpt'});
   if(!this.active||generation!==this.generation)return;
   if(!result||typeof result!=='object')throw new Error('Invalid login response');
   const r=result as Record<string,unknown>;
   if(typeof r.loginId!=='string'||!r.loginId||r.loginId.length>128)throw new Error('Invalid login ID');
   if(attempt!==this.loginAttempt){
    try{await this.rpc?.request('account/login/cancel',{loginId:r.loginId});}catch{}
    if(!this.loginPending&&!this.loginId&&!this.pending){this.rpc?.stop();this.rpc=null;}
    return;
   }
   this.loginId=r.loginId;
   const uri=validateAuthUrl(r.authUrl);this.options.openUri(uri);
   this.endLoginTimer();this.loginTimer=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,300,()=>{
    this.loginTimer=0;void this.cancelLogin();return GLib.SOURCE_REMOVE;
   });
   this.state.fail('브라우저에서 공식 로그인을 완료하세요.','loading');this.publish();
  }catch{
   if(generation!==this.generation||attempt!==this.loginAttempt)return;
   await this.cancelLogin();this.state.fail('공식 로그인 페이지를 열 수 없습니다. CLI를 확인하세요.');this.publish();
  }finally{if(attempt===this.loginAttempt)this.loginPending=false;}
 }
 private endLoginTimer():void {if(this.loginTimer){GLib.Source.remove(this.loginTimer);this.loginTimer=0;}}
 async cancelLogin():Promise<void> {
  this.loginAttempt++;this.loginPending=false;this.endLoginTimer();
  const id=this.loginId;this.loginId=null;
  if(id&&this.rpc)try{await this.rpc.request('account/login/cancel',{loginId:id});}catch{}
  if(id&&!this.pending){this.rpc?.stop();this.rpc=null;}
  if(this.active){this.state.fail('로그인 대기가 취소되었습니다.','waiting');this.publish();if(!this.pending)this.schedule();}
 }
 stop():void {
  this.active=false;this.generation++;
  this.accountChanged=false;this.authEpoch++;
  this.loginAttempt++;this.loginPending=false;this.endLoginTimer();
  if(this.timer){GLib.Source.remove(this.timer);this.timer=0;}
  this.rpc?.stop();this.rpc=null;this.pending=null;this.loginId=null;
  this.state.clear('disabled');this.publish();
 }
}
