import type {QuotaWindow,ProviderView} from './types.js';
export function isExpired(w:QuotaWindow,now=Date.now()):boolean {return w.resetsAt!==null&&w.resetsAt*1000<=now;}
export function formatWindow(w:QuotaWindow,now=Date.now()):string {
 if(isExpired(w,now)) return w.label+' 새 확인 필요';
 const reset=w.resetsAt==null?'초기화 시각 미확인':new Date(w.resetsAt*1000).toLocaleString();
 return w.label+' 잔여 '+Math.round(100-w.usedPercent)+'% · '+reset;
}
export function panelText(view:ProviderView,now=Date.now()):string {
 if(view.status==='disabled') return '꺼짐';
 if(!view.snapshot) return view.status==='auth-required'?'로그인':'—';
 const windows=view.snapshot.windows.filter(w=>!isExpired(w,now));
 if(!windows.length) return '확인 필요';
 const historical=view.status!=='ready'||now-view.snapshot.receivedAt>360000;
 return (historical?'~':'')+windows.slice(0,2).map(w=>w.label+' '+Math.round(100-w.usedPercent)+'%').join(' / ');
}
