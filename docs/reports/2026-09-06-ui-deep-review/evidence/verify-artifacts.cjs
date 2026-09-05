const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {JSDOM}=require('C:/BAEframe/BAEFRAME/node_modules/jsdom');
const sharp=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const root=path.resolve(__dirname,'..');
const repo=path.resolve(root,'../../..');
const prior='C:/Users/user/.codex/worktrees/baeframe-reel-editor/BAEFRAME';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
(async()=>{
 const doc=new JSDOM(fs.readFileSync(path.join(root,'report.html'),'utf8')).window.document;
 const imgs=[...doc.images];assert.equal(imgs.length,27);
 const categories={current:0,official:0,proposal:0};
 const images=[];
 for(const img of imgs){
  const src=img.getAttribute('src');const data=fs.readFileSync(path.join(root,src));const m=await sharp(data).metadata();
  assert.ok(m.width>0&&m.height>0&&img.alt.length>0);
  assert.equal(img.parentElement.tagName,'A');assert.equal(img.parentElement.getAttribute('href'),src);
  categories[src.startsWith('assets/')?'proposal':src.includes('/references/')?'official':'current']++;
  images.push({path:src,width:m.width,height:m.height,bytes:data.length,sha256:hash(data)});
 }
 assert.deepEqual(categories,{current:17,official:6,proposal:4});
 const ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'references/reference-ledger.json'),'utf8'));
 for(const img of ledger.images)assert.equal(hash(fs.readFileSync(path.join(__dirname,'references',img.file))),img.sha256);
 const urls=new Set([...doc.querySelectorAll('a[href]')].map(x=>x.getAttribute('href')));
 for(const s of ledger.sources)assert.ok(urls.has(s.url));
 const old=JSON.parse(fs.readFileSync(path.join(repo,'docs/reports/2026-09-06-ux-audit.sha256.json'),'utf8'));
 const mismatches=old.files.filter(f=>hash(fs.readFileSync(path.join(prior,f.path)))!==f.sha256).map(f=>f.path);
 assert.equal(mismatches.length,0);
 const rawMarkdown=(doc.querySelector('article').textContent.match(/\*\*/g)||[]).length;assert.equal(rawMarkdown,0);
 const result={status:'passed',issues:26,imageCategories:categories,officialDocuments:ledger.sources.length,officialImageHashes:'6 match',priorUX:{checkedLocation:prior,files:old.files.length,mismatches},rawMarkdownMarkers:rawMarkdown,images};
 fs.writeFileSync(path.join(__dirname,'artifact-verification.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,images:images.length},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
