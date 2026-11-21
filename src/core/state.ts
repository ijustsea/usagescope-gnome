import type {ProviderView,UsageSnapshot,Status} from './types.js';
export class ProviderState {
 private current:ProviderView={status:'waiting',snapshot:null,message:''};
 view():ProviderView {return {...this.current};}
 accept(snapshot:UsageSnapshot):ProviderView {
  this.current={status:snapshot.windows.length?'ready':'waiting',snapshot,message:snapshot.windows.length?'':'사용량이 아직 보고되지 않았습니다.'};
  return this.view();
 }
 fail(message:string,status:Status='error'):ProviderView {
  this.current={...this.current,status,message:message.slice(0,200)}; return this.view();
 }
 loading():ProviderView {this.current={...this.current,status:'loading',message:''};return this.view();}
 clear(status:Status='waiting'):ProviderView {this.current={status,snapshot:null,message:''};return this.view();}
}
