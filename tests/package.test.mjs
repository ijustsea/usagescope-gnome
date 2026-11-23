import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
test('archive is repeatable and ships runtime code without developer data or binaries',async()=>{
 const run=()=>{const r=spawnSync(process.execPath,['scripts/package.mjs'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
 run();
 const meta=JSON.parse(await readFile('metadata.json','utf8'));
 const path='dist/'+meta.uuid+'.shell-extension.zip';
 const first=createHash('sha256').update(await readFile(path)).digest('hex');
 run();assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),first);
 const list=spawnSync('unzip',['-Z1',path],{encoding:'utf8'});assert.equal(list.status,0);
 const files=list.stdout.trim().split('\n');
 assert(files.includes('extension.js'));assert(files.includes('claude/cli.js'));assert(files.includes('schemas/gschemas.compiled'));
 // Retired statusline bridge/setup and its runtime storage must not ship.
 assert.deepEqual(files.filter(p=>p.startsWith('claude/')),['claude/cli.js']);
 assert(!files.some(p=>p.startsWith('/')||p.split('/').includes('..')||/node_modules|\.git\/|auth\.json|credentials|\.ts$|\.mjs$/.test(p)));
 assert(files.every(p=>/\.js$|\.css$|\.xml$|\.json$|gschemas\.compiled$|^LICENSE$/.test(p)));
});
test('stale or injected build files cannot enter the distribution',async()=>{
 const extra=['build/core/test-unexpected.json','build/claude/test-stale.js'];
 try {
  for(const p of extra)await writeFile(p,'harmless unexpected build fixture');
  const run=spawnSync(process.execPath,['scripts/package.mjs'],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const meta=JSON.parse(await readFile('metadata.json','utf8'));
  const list=spawnSync('unzip',['-Z1','dist/'+meta.uuid+'.shell-extension.zip'],{encoding:'utf8'});
  assert.equal(list.stdout.includes('test-unexpected'),false);assert.equal(list.stdout.includes('test-stale'),false);
 }finally{for(const p of extra)await rm(p,{force:true});}
});
