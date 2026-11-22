// Documentation-only renderer. Its optional PDF tools are NOT app dependencies.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {resolve,join} from 'node:path';
import {architecture,flow} from './study-diagrams.mjs';
import {studyContent} from './study-content.mjs';

const root=resolve(import.meta.dirname,'../..');
const tools=resolve(process.argv[2]??'/tmp/usagescope-doc-tools');
const output=resolve(process.argv[3]??'/home/safe/Documents');
const require=createRequire(join(tools,'package.json'));
const PDFDocument=require('pdfkit'), SVGtoPDF=require('svg-to-pdfkit');
const fonts={
 regular:'/home/safe/.local/share/fonts/NanumGothic-Regular.ttf',
 bold:'/home/safe/.local/share/fonts/NanumGothic-Bold.ttf',
 mono:'/home/safe/.local/share/fonts/NanumGothicCoding-Regular.ttf',
};
const name='UsageScope_설계와_기술선택_학습자료';
const resourceName='UsageScope_학습자료_리소스';
await mkdir(output,{recursive:true});
await mkdir(join(output,resourceName),{recursive:true});
await mkdir(join(root,'docs/learning/assets'),{recursive:true});
const diagrams={'usagescope-architecture':architecture(),'usagescope-flow':flow()};
for(const [id,value] of Object.entries(diagrams)){
 const src=join(root,'docs/learning/assets',id+'.svg');
 await writeFile(src,value);
 execFileSync('magick',['-background','white',src,join(root,'docs/learning/assets',id+'.png')]);
 for(const extension of ['svg','png'])await copyFile(join(root,'docs/learning/assets',id+'.'+extension),join(output,resourceName,id+'.'+extension));
}
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const verification=JSON.parse(await readFile(join(root,'docs/learning/verification.json'),'utf8'));
const sha=verification.sourceCommit, tests=verification.nodeTests;
if(!/^[a-f0-9]{40}$/.test(sha)||!Number.isInteger(tests)||tests<1||verification.version!==pkg.version)
 throw new Error('A matching recorded verification report is required');
execFileSync('git',['cat-file','-e',sha+'^{commit}'],{cwd:root});
const meta={date:verification.date,version:pkg.version,sha,tests};
const blocks=studyContent(meta);
const fence=String.fromCharCode(96).repeat(3);
function markdown(assetDir){
 const out=[];
 for(const b of blocks){
  if(b.kind==='cover')out.push('# '+b.title+' · '+b.subtitle,'',b.text,'',b.meta,'');
  else if(b.kind==='h1')out.push('## '+b.text,'');
  else if(b.kind==='h2')out.push('### '+b.text,'');
  else if(b.kind==='p')out.push(b.text,'');
  else if(b.kind==='note')out.push('> '+b.text,'');
  else if(b.kind==='list')out.push(...b.items.map((s,i)=>(i+1)+'. '+s),'');
  else if(b.kind==='code'||b.kind==='mermaid')out.push(fence+(b.kind==='code'?'bash':'mermaid'),b.text,fence,'');
  else if(b.kind==='diagram')out.push('!['+b.name+']('+assetDir+'/'+b.name+'.png)','',b.caption,'','[벡터 원본 SVG]('+assetDir+'/'+b.name+'.svg)','');
  else if(b.kind==='table'){
   const row=a=>'| '+a.map(s=>s.replaceAll('|','\\|').replaceAll('\n','<br>')).join(' | ')+' |';
   out.push(row(b.headers),row(b.headers.map(()=> '---')),...b.rows.map(row),'');
  }else if(b.kind==='source')out.push('- ['+b.id+'] ['+b.title+']('+b.url+') — '+b.basis);
 }
 return out.join('\n').trimEnd()+'\n';
}
await writeFile(join(output,name+'.md'),markdown(resourceName));
await writeFile(join(root,'docs/learning/'+name+'.md'),markdown('assets'));

const pdfPath=join(output,name+'.pdf');
const stream=createWriteStream(pdfPath);
const doc=new PDFDocument({autoFirstPage:false,bufferPages:true,info:{
 Title:'UsageScope 설계와 기술 선택 학습자료',Author:'ijustsea',Subject:'구현 동작·기술 선택·보안 검증 근거',
 Keywords:'UsageScope GNOME GJS TypeScript architecture security',
}});
doc.pipe(stream);
doc.registerFont('Nanum',fonts.regular);doc.registerFont('Nanum-Bold',fonts.bold);doc.registerFont('Mono',fonts.mono);
const ink='#172541',muted='#56647a',blue='#2864dc';
function portrait(){doc.addPage({size:'A4',layout:'portrait',margins:{top:48,bottom:46,left:46,right:46}});doc.font('Nanum').fontSize(10.5).fillColor(ink);}
portrait();
function width(){return doc.page.width-92;}
function ensurePortrait(){if(doc.page.width>doc.page.height)portrait();}
function space(height){ensurePortrait();if(doc.y+height>doc.page.height-46)portrait();}
function paragraph(value,size=10.5,color=ink){
 ensurePortrait();doc.font('Nanum').fontSize(size).fillColor(color);
 const height=doc.heightOfString(value,{width:width(),lineGap:4});
 space(Math.min(height,160));doc.font('Nanum').fontSize(size).fillColor(color).text(value,46,doc.y,{width:width(),lineGap:4});doc.moveDown(.65);
}
function heading(value,size){
 ensurePortrait();doc.font('Nanum-Bold').fontSize(size);
 const height=doc.heightOfString(value,{width:width()});
 space(height+(size>=16?110:75));doc.font('Nanum-Bold').fontSize(size).fillColor(ink).text(value,46,doc.y,{width:width()});doc.moveDown(.65);
}
function renderTable(b){
 ensurePortrait();
 const widths=(b.widths??b.headers.map(()=>1/b.headers.length)).map(f=>f*width());
 const rowHeight=(values,bold=false)=>{
  doc.font(bold?'Nanum-Bold':'Nanum').fontSize(9);
  return Math.max(...values.map((s,i)=>doc.heightOfString(s,{width:widths[i]-16,lineGap:3})))+18;
 };
 const draw=(values,bold,index)=>{
  const height=rowHeight(values,bold),y=doc.y;
  doc.save().rect(46,y,width(),height).fill(bold?'#eaf0fc':index%2?'#f7f9fc':'#ffffff').restore();
  let x=46;
  values.forEach((s,i)=>{
   doc.save().font(bold?'Nanum-Bold':'Nanum').fontSize(9).fillColor(ink).text(s,x+8,y+8,{width:widths[i]-16,lineGap:3});doc.restore();x+=widths[i];
  });
  doc.moveTo(46,y+height).lineTo(doc.page.width-46,y+height).lineWidth(.45).strokeColor('#d9e1ef').stroke();
  doc.y=y+height;
 };
 space(rowHeight(b.headers,true)+Math.min(rowHeight(b.rows[0]),150));draw(b.headers,true,0);
 for(const [i,row] of b.rows.entries()){
  const height=rowHeight(row);
  if(doc.y+height>doc.page.height-46){portrait();draw(b.headers,true,0);}
  draw(row,false,i);
 }
 doc.moveDown(.9);
}
let diagramHeading='';
for(const [blockIndex,b] of blocks.entries()){
 if(b.kind==='cover'){
  doc.font('Nanum-Bold').fontSize(30).fillColor(blue).text(b.title,46,58);
  doc.fontSize(22).fillColor(ink).text(b.subtitle,46,102);
  doc.y=150;paragraph(b.text,11.5);paragraph(b.meta,8.5,muted);
 }else if(b.kind==='h1'){
  if(blocks[blockIndex+1]?.kind==='diagram')diagramHeading=b.text;
  else heading(b.text,16);
 }
 else if(b.kind==='h2')heading(b.text,12);
 else if(b.kind==='p')paragraph(b.text);
 else if(b.kind==='list')for(const [i,item]of b.items.entries())paragraph((i+1)+'. '+item,10);
 else if(b.kind==='note'){
  ensurePortrait();doc.font('Nanum').fontSize(10);
  const height=doc.heightOfString(b.text,{width:width()-24,lineGap:4})+22;space(height+12);const y=doc.y;
  doc.save().roundedRect(46,y,width(),height,7).fill('#edf4ff').restore();
  doc.font('Nanum').fontSize(10).fillColor(ink).text(b.text,58,y+11,{width:width()-24,lineGap:4});doc.y=y+height+12;
 }else if(b.kind==='table')renderTable(b);
 else if(b.kind==='code'){
  ensurePortrait();doc.font('Mono').fontSize(8.2);const height=doc.heightOfString(b.text,{width:width()-24,lineGap:3})+22;space(height+10);const y=doc.y;
  doc.save().roundedRect(46,y,width(),height,5).fill('#f0f3f8').restore();
  doc.font('Mono').fontSize(8.2).fillColor(ink).text(b.text,58,y+11,{width:width()-24,lineGap:3});doc.y=y+height+12;
 }else if(b.kind==='mermaid'){
  paragraph('위 그림의 간결한 Mermaid 원본은 함께 제공된 Markdown에 포함했습니다. PDF는 같은 논리 흐름을 벡터 그림으로 보여줍니다.',9,muted);
 }else if(b.kind==='diagram'){
  doc.addPage({size:'A4',layout:'landscape',margins:{top:26,bottom:30,left:30,right:30}});
  if(diagramHeading){doc.font('Nanum').fontSize(8).fillColor(muted).text(diagramHeading,30,12,{lineBreak:false});diagramHeading='';}
  const viewport={width:doc.page.width-60,height:doc.page.height-88};
  SVGtoPDF(doc,diagrams[b.name],30,26,{...viewport,preserveAspectRatio:'xMidYMid meet',
   fontCallback:(_family,bold)=>bold?'Nanum-Bold':'Nanum',warningCallback:message=>{throw new Error('SVG warning: '+message);}});
  doc.font('Nanum').fontSize(8.2).fillColor(muted).text(b.caption,30,doc.page.height-57,{width:doc.page.width-60,lineGap:2});
 }else if(b.kind==='source'){
  space(70);doc.font('Nanum-Bold').fontSize(9.5).fillColor(ink).text('['+b.id+'] '+b.title,46,doc.y,{width:width()});
  doc.font('Nanum').fontSize(8.5).fillColor(muted).text(b.basis,{width:width(),lineGap:2});
  doc.fillColor(blue).text(b.url,{width:width(),link:b.url,underline:true,lineGap:2});doc.moveDown(.6);
 }
}
const pages=doc.bufferedPageRange();
for(let index=0;index<pages.count;index++){
 doc.switchToPage(index);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
 doc.font('Nanum').fontSize(8).fillColor(muted).text('UsageScope · 설계와 기술 선택 | '+meta.date+' | '+(index+1)+' / '+pages.count,40,doc.page.height-23,{width:doc.page.width-80,height:12,lineBreak:false,align:'right'});
 doc.page.margins.bottom=bottom;
}
doc.end();
await new Promise((resolve,reject)=>{stream.on('finish',resolve);stream.on('error',reject);});
console.log(JSON.stringify({markdown:join(output,name+'.md'),pdf:pdfPath,pages:pages.count,source:sha,tests},null,2));
