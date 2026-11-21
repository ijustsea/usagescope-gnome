// Explicit, read-only live probe. Never starts a thread or a model turn.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {RpcClient} from '../build/codex/rpc.js';
if(ARGV.length!==1)throw new Error('Usage: gjs -m scripts/probe-codex.mjs /absolute/path/to/codex');
const loop=new GLib.MainLoop(null,false);
let rpc=null;let failed=false;
const start=GLib.get_monotonic_time();
(async()=>{
 try {
  rpc=new RpcClient(ARGV[0],15000);
  const result=await rpc.request('account/rateLimits/read',{excludeResetCreditDetails:true});
  if(!result||typeof result!=='object')throw new Error('Invalid quota result');
  let pssKiB=null;
  try {
   const [,bytes]=Gio.File.new_for_path('/proc/'+rpc.pid+'/smaps_rollup').load_contents(null);
   const match=/^Pss:\s+(\d+) kB/m.exec(new TextDecoder().decode(bytes));
   if(match)pssKiB=Number(match[1]);
  }catch{/* Process memory accounting may be unavailable. */}
  print(JSON.stringify({ok:true,hasQuota:!!result.rateLimits,hasBuckets:!!result.rateLimitsByLimitId,elapsedMs:Math.round((GLib.get_monotonic_time()-start)/1000),pssKiB}));
 }catch(e){failed=true;printerr('Live probe failed: '+(e.name==='RpcError'?'official CLI request rejected (authentication or eligibility required)':'transport/installation unavailable'));}
 finally{await rpc?.finish();loop.quit();}
})();
loop.run();
if(failed)throw new Error('Read-only live probe did not pass');
