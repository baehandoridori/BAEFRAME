const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const shapes={
 folder:'<path d="M3 6h6l2 2h10v12H3z"/>',
 'chevron-down':'<path d="m6 9 6 6 6-6"/>', 'chevron-right':'<path d="m9 5 7 7-7 7"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 play:'<path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
 'skip-back':'<path d="M5 5v14M18 5 7 12l11 7z"/>','skip-forward':'<path d="M19 5v14M6 5l11 7-11 7z"/>',
 volume:'<path d="M4 9h4l5-4v14l-5-4H4zM17 8a7 7 0 0 1 0 8M20 5a11 11 0 0 1 0 14"/>',
 expand:'<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
 'zoom-in':'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
 'zoom-out':'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
 mouse:'<path d="m5 3 14 10-7 1-3 7z"/>',pen:'<path d="m4 20 1-6L16 3l5 5L10 19zM14 5l5 5M5 14l5 5"/>',
 eraser:'<path d="m3 14 10-11 8 8-10 10H8zM8 9l8 8M11 21h10"/>',
 hand:'<path d="M7 12V5a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v7-3a2 2 0 0 1 4 0v7c0 4-3 6-7 6h-1c-3 0-4-2-6-4l-3-4a2 2 0 0 1 3-2z" transform="translate(-2 -1)"/>',
 scissors:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m9 8 12 13M9 16l12-13"/>',
 eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
 check:'<path d="m5 12 4 4L20 5"/>',undo:'<path d="m7 4-5 5 5 5M2 9h12a7 7 0 0 1 0 14"/>',redo:'<path d="m17 4 5 5-5 5M22 9H10a7 7 0 0 0 0 14"/>',
 link:'<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 -1) scale(.9)"/>',
 send:'<path d="m3 3 19 9-19 9 4-9zM7 12h15"/>',filter:'<path d="M3 5h18M6 12h12M10 19h4"/>',
 settings:'<path d="m9 3-1 3-3 1v4l-2 1 2 2v4l3 1 1 3h5l1-3 3-1v-4l2-2-2-1V7l-3-1-1-3z"/><circle cx="11.5" cy="12.5" r="3"/>',
 file:'<path d="M5 3h9l5 5v13H5zM14 3v6h5M9 13h6M9 17h6"/>',grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 'arrow-left':'<path d="m10 5-7 7 7 7M3 12h18"/>','arrow-right':'<path d="m14 5 7 7-7 7M21 12H3"/>',
 download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
 pin:'<path d="M6 3h12l-3 7 4 4H5l4-4zM12 14v8"/>',message:'<path d="M3 3h18v14H9l-6 4zM7 8h10M7 12h6"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
 trash:'<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
 repeat:'<path d="m17 2 4 4-4 4M3 11V6h18M7 22l-4-4 4-4M21 13v5H3"/>',
 layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>'
};
function icon(name,size=16){if(!shapes[name])throw new Error('Unknown icon '+name);return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${shapes[name]}</svg>`;}
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function shell(v){return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(v.title)}</title><link rel="stylesheet" href="shared.css"><style>${v.styles||''}</style></head><body><div class="application"><div class="app-menu"><div class="app-wordmark"><span class="brand-symbol">B</span>${esc(v.mode)}</div><span>파일</span><span>편집</span><span>보기</span><span>재생</span><span>도구</span><span>도움말</span><span class="spacer"></span><span class="preview-label">디자인 시안 · 미구현</span><span class="window-actions">−　□　×</span></div><div class="document-header"><div class="product-id">${esc(v.mode)}<span class="mode-label">${v.mode==='BAEFRAME'?'리뷰':'제작'}</span></div><div><div class="document-title">${esc(v.documentName)}${v.dirty?'<span class="small-dot"></span>':''}<span class="tiny">${icon('chevron-down',13)}</span></div><div class="document-subtitle">${esc(v.subtitle)}</div></div><span class="spacer"></span><div class="document-meta">${icon('check',14)}이 기기에 저장됨</div><div class="document-actions"><button class="btn">${icon('file',14)}저장</button>${v.mode==='BAEFRAME'?'<button class="btn">'+icon('scissors',14)+'영상 편집</button>':''}<button class="btn primary">${icon(v.mode==='BAEFRAME'?'link':'download',14)}${esc(v.headerAction)}</button><button class="icon-button">${icon('settings',17)}</button></div></div><main class="workbench">${v.body}</main><div class="statusbar"><span class="status-dot"></span>${esc(v.status)}<span class="status-end"><span>${v.mode==='BAEFRAME'?'리뷰 파일 · 원본 보존':'편집 프로젝트 · 원본 보존'}</span><span>마지막 저장 14:32</span>${icon('check',12)}</span></div></div></body></html>`;}
(async()=>{
 const {review,reviewDrawing}=require('./review.cjs');const {editor,editorPortrait}=require('./editor.cjs');
 const entries=[['01-baeframe-review',review],['02-baeframe-drawing',reviewDrawing],['03-bediter-edit',editor],['04-bediter-portrait',editorPortrait]];
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const checks=[];
 for(const [name,fn]of entries){
  const v=typeof fn==='function'?fn({icon,shot:'animation-shot.png'}):fn;
  const html=shell(v);const file=path.join(__dirname,name+'.html');fs.writeFileSync(file,html);
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
  await page.goto(pathToFileURL(file).href);await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForTimeout(150);
  const result=await page.evaluate(()=>({size:{w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight},images:[...document.images].map(i=>({src:i.getAttribute('src'),loaded:i.complete&&i.naturalWidth>0})),overflow:[...document.querySelectorAll('.panel-header,.toolbar,.transport,.document-header,.composer')].filter(e=>e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2).map(e=>({class:e.className,sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight})),strayText:[...document.querySelectorAll('span,strong,p,label')].filter(e=>{const r=e.getBoundingClientRect();return r.right>1601||r.bottom>1001||r.left< -1||r.top< -1}).map(e=>({text:e.textContent.slice(0,50)}))}));
  await page.screenshot({path:path.join(__dirname,name+'.png')});await page.close();checks.push({name,...result});
 }
 await browser.close();fs.writeFileSync(path.join(__dirname,'render-checks.json'),JSON.stringify(checks,null,2));console.log(JSON.stringify(checks,null,2));
 if(checks.some(x=>x.size.w!==1600||x.size.h!==1000||x.images.some(i=>!i.loaded)))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
