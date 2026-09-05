const fs = require('node:fs');
const path = require('node:path');
const r = JSON.parse(fs.readFileSync(path.join(__dirname,'measurements.json'),'utf8'));
const rgb = value => (value.match(/[\d.]+/g)||[]).slice(0,3).map(Number);
const luminance = color => color.map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
const contrast = (fg,bg) => {const a=luminance(rgb(fg)),b=luminance(rgb(bg));return Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2));};
const state = prefix => r.states.find(s=>s.image.startsWith(prefix));
const dense=state('08'),portrait=state('07'),landscape=state('02');
const measured = (s,k) => s.measured[k][0];
const sampleSelectors=['#timeDisplay','#timelineScale','#projectTitle','#outputInfo','#activeToolName','#addLayer','.video-clip','.drawing-key','#status'];
const result={
  baseline:r.baseline,runComplete:r.completed,consoleErrors:r.errors,
  methodology:'Actual getBoundingClientRect/getComputedStyle. Text contrast samples below use opaque nearest-ancestor backgrounds, opacity1 only; excludes disabled controls. This is a focused sampling, not full WCAG conformance certification. Marker size alone is not deemed a target-size failure.',
  geometry:{portrait1050:measured(portrait,'#stage').rect,landscape1440:measured(landscape,'#stage').rect,inspector1050:measured(dense,'.inspector').rect,timeline1050:measured(dense,'.timeline').rect,timelineScroll1050:measured(dense,'.timeline-scroll').rect,trackHeight:measured(dense,'.drawing-track').rect.height,keysFirstRow:dense.measured['.drawing-key'].slice(0,4).map(e=>({label:e.aria,x:e.rect.x,width:e.rect.width,height:e.rect.height,centerHit:e.centerHit})),clipWidth:dense.measured['.video-clip'][0].rect.width,layerCount:dense.project.layers},
  textSamples:sampleSelectors.map(selector=>{const e=measured(dense,selector);return {selector,text:e.text,fontPx:parseFloat(e.font),foreground:e.color,background:e.effectiveBackground,contrast:contrast(e.color,e.effectiveBackground)};}),
  controls:[...dense.buttons].filter(e=>!e.disabled&&e.centerHit).map(e=>({label:e.aria||e.title||e.text,width:e.rect.width,height:e.rect.height,font:e.font})),
  verifiedChecks:r.checks,
  viewStability:r.states.filter(s=>['03','04','05','06'].includes(s.image.slice(0,2))).map(s=>({image:s.image,rect:measured(s,'#stage').rect})),
  textScale:'11 screenshot doubles computed text size while leaving layout dimensions unchanged. It is a controlled text-only stress test, not native Windows accessibility-setting coverage.',
  media:'Two generated30s testsrc2 H264/AAC videos, landscape320x180 and portrait180x320, probed by the production media function. 12 appended landscape clips total360s. No user media read, modified, exported, or deleted.',
  limits:'Dialog/export IPC is simulated. Renderer, video decode, drawings, tool inputs, save snapshot generation, and overlay export prep are production modules. Export progress43% is injected, not measured encoding. Main review-window comparison is source-level only in this subtask.'
};
fs.writeFileSync(path.join(__dirname,'summary-metrics.json'),JSON.stringify(result,null,2));
process.stdout.write(JSON.stringify({textSamples:result.textSamples,geometry:result.geometry,checks:result.verifiedChecks}));
