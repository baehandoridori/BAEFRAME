const fs = require('fs');
const path = require('path');
const { performance }=require('perf_hooks');
const { readReviewSnapshot }=require(path.join(process.cwd(),'main/review-file-store.js'));
(async()=>{
 const parent=path.join(process.env.TEMP,'baeframe-ux-20260906');
 const absent=path.join(parent,'playback-audit-absent-'+Date.now()+'.bframe');
 const present=path.join(parent,'playback-audit-present-'+Date.now()+'.bframe');
 fs.writeFileSync(present,'{}');
 const measurements=[];
 for(let i=0;i<3;i++) {
  for(const [kind,p] of [['absent',absent],['present',present]]) {
   const start=performance.now(); const result=await readReviewSnapshot(p);
   measurements.push({kind,ms:Number((performance.now()-start).toFixed(3)),dataNull:result.data===null});
  }
 }
 const evidence=JSON.parse(fs.readFileSync('docs/reports/2026-09-06-ux-audit/evidence/native-playback-autoplay.json','utf8').replace(/^\uFEFF/,''));
 const switches=[];
 for(let i=1;i<evidence.length;i++) if(evidence[i].file!==evidence[i-1].file) switches.push({at:evidence[i].at,from:evidence[i-1].file,to:evidence[i].file,controls:evidence[i].controls.split('\n').slice(0,2).join(' / ')});
 const intervals=switches.slice(1).map((s,i)=>({from:switches[i].to,to:s.to,intervalMs:s.at-switches[i].at}));
 const stdout=fs.readFileSync(path.join(parent,'app-stdout.log'),'utf8');
 function stats(label) {
 const relevant=stdout.split(/\r?\n/).filter(l=>l.includes(`← ${label}() 완료`) && /review-[ABC]-3s/.test(l));
 const ms=relevant.map(l=>Number(l.match(/완료 \((\d+)ms\)/)?.[1])).filter(Number.isFinite).sort((a,b)=>a-b);
 return {count:ms.length,min:ms[0],max:ms.at(-1),median:ms.length?ms[Math.floor(ms.length/2)]:null};
 }
 console.log(JSON.stringify({measuredAt:new Date().toISOString(),measurements,switches,intervals,reviewLog:stats('file:load-review'),mpvLog:stats('mpv:load'),absent,present},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
