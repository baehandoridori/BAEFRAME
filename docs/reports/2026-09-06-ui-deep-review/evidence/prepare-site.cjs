const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const dest='C:/Users/user/Documents/Codex/Sites/baeframe-ui-review-20260906/source';
const html=fs.readFileSync(path.join(root,'report.html'),'utf8');
fs.mkdirSync(dest,{recursive:true});
fs.writeFileSync(path.join(dest,'index.html'),html);
const files=new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(x=>x[1]));
files.add('report-source.md');
const manifest=[];
for(const file of files){
 if(!/^(assets\/proposals\/[^/]+\.svg|evidence\/(review|editor|references)\/[^/]+\.(png|jpg)|report-source\.md)$/.test(file))throw new Error('Unexpected file '+file);
 const input=path.join(root,file),target=path.join(dest,file),data=fs.readFileSync(input);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,data);
 manifest.push({path:file,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});
}
fs.writeFileSync(path.join(dest,'asset-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({copied:manifest.length,images:files.size-1,totalBytes:manifest.reduce((s,x)=>s+x.bytes,0)},null,2));
