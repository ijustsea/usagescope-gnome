import {mkdtemp,readFile,readdir,copyFile,mkdir,lstat,utimes,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const metadata=JSON.parse(await readFile(join(root,'metadata.json'),'utf8'));
if(!/^[a-z0-9-]+@[a-z0-9.-]+$/.test(metadata.uuid))throw new Error('Invalid extension UUID');
const staging=await mkdtemp(join(tmpdir(),'usagescope-package-'));
const entries=[];
async function add(src,dest) {
 const st=await lstat(join(root,src));
 if(st.isSymbolicLink())throw new Error('Symlink in package input');
 if(st.isDirectory()) {
  for(const name of (await readdir(join(root,src))).sort())await add(join(src,name),join(dest,name));
 } else {
  await mkdir(join(staging,dest,'..'),{recursive:true});
  await copyFile(join(root,src),join(staging,dest)); entries.push(dest);
 }
}
try {
 await add('metadata.json','metadata.json');await add('stylesheet.css','stylesheet.css');await add('LICENSE','LICENSE');
 await add('schemas/org.gnome.shell.extensions.usagescope.gschema.xml','schemas/org.gnome.shell.extensions.usagescope.gschema.xml');
 // Source-derived manifest: stale or injected files in build/ cannot silently ship.
 async function runtimeSources(path) {
  for(const name of (await readdir(join(root,'src',path))).sort()) {
   const relative=join(path,name);const stat=await lstat(join(root,'src',relative));
   if(stat.isSymbolicLink())throw new Error('Symlink in source manifest');
   if(stat.isDirectory())await runtimeSources(relative);
   else if(name.endsWith('.ts')&&!name.endsWith('.d.ts')) {
    const output=relative.slice(0,-3)+'.js';await add('build/'+output,output);
   }
  }
 }
 for(const dir of ['core','runtime','codex','claude','ui'])await runtimeSources(dir);
 await add('build/extension.js','extension.js');
 const schemas=spawnSync('glib-compile-schemas',[join(staging,'schemas')],{encoding:'utf8'});
 if(schemas.status!==0)throw new Error(schemas.stderr||'Schema compilation failed');
 entries.push('schemas/gschemas.compiled');entries.sort();
 for(const path of entries)await utimes(join(staging,path),315532800,315532800);
 await mkdir(join(root,'dist'),{recursive:true});
 const output=join(root,'dist',metadata.uuid+'.shell-extension.zip');
 // zip updates an existing archive: remove only this known generated output first.
 await rm(output,{force:true});
 const zip=spawnSync('zip',['-X','-q',output,...entries],{cwd:staging,encoding:'utf8'});
 if(zip.status!==0)throw new Error(zip.stderr||'Archive build failed');
 const hash=createHash('sha256').update(await readFile(output)).digest('hex');
 await writeFile(output+'.sha256',hash+'  '+metadata.uuid+'.shell-extension.zip\n');
 console.log(output);console.log('SHA256 '+hash);
}finally{await rm(staging,{recursive:true,force:true});}
