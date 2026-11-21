import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const entries=(await readdir('tests/gjs')).filter(p=>p.endsWith('.mjs')).sort();
if(!entries.length)throw new Error('No real GJS checks found');
for(const name of entries) {
 const run=spawnSync('gjs',['-m','tests/gjs/'+name],{stdio:'inherit',timeout:60000,env:{...process.env,G_DEBUG:'fatal-criticals'}});
 if(run.error)throw run.error;
 if(run.status!==0)process.exit(run.status??1);
}
