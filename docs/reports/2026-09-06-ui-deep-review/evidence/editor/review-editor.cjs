const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/user/.codex/skills/develop-web-game/node_modules/playwright-core');
let root = __dirname;
while (!require('node:fs').existsSync(path.join(root, 'shared/edit-project.js'))) root = path.dirname(root);
const old = 'C:/Users/user/.codex/worktrees/baeframe-reel-editor/BAEFRAME';
const core = require(path.join(root, 'shared/edit-project'));
const { probeMedia, runProcess } = require(path.join(root, 'main/editor-media'));
const runtime = { ffmpegPath: path.join(old, 'ffmpeg/win32/ffmpeg.exe'), ffprobePath: path.join(old, 'ffmpeg/win32/ffprobe.exe') };
const record = { baseline: '5d1cb89afcae21429c1e076a6964bc11cd990228', mode: 'production renderer in isolated headless Chrome; IPC is fixture-controlled', states: [], checks: {}, errors: [] };
let page;
async function ready() { await page.waitForFunction(() => !window.editorController.state.busy && !document.body.classList.contains('editor-seeking')); }
async function capture(name, note) {
  await page.screenshot({path: path.join(__dirname, name + '.png')});
  const data = await page.evaluate(() => {
    const selectors = ['body','.workspace','.viewer','.inspector','.inspector-body','.stage-area','#stage','.timeline','.timeline-toolbar','.timeline-scroll','.track','.drawing-track','.video-clip','.drawing-key','.drawing-span','#timelineOverview','#overviewViewport','#projectTitle','#selectedClipName','#timeDisplay','#sourceTime','#outputInfo','#timelineScale','#activeToolName','#status','#exportProgress','footer','button[data-editor-tool="select"]','#drawMode','#timelineZoomIn','#timelineZoomRange','#addLayer'];
    const measure = element => {
      const r = element.getBoundingClientRect(),s = getComputedStyle(element);
      let parent=element,background=s.backgroundColor;while(parent&&background==='rgba(0, 0, 0, 0)'){parent=parent.parentElement;if(parent)background=getComputedStyle(parent).backgroundColor;}
      const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      return {text: element.innerText?.slice(0,180),title:element.title,aria:element.getAttribute('aria-label'),pressed:element.getAttribute('aria-pressed'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},font:s.fontSize,fontFamily:s.fontFamily,color:s.color,background:s.backgroundColor,effectiveBackground:background,opacity:s.opacity,border:s.borderColor,lineHeight:s.lineHeight,overflow:s.overflow,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,disabled:element.disabled,display:s.display,centerHit:hit===element||element.contains(hit)};
    };
    const measured = Object.fromEntries(selectors.map(selector => [selector,[...document.querySelectorAll(selector)].slice(0,15).map(measure)]));
    const buttons = [...document.querySelectorAll('button')].filter(e => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden').map(measure);
    const state = window.editorController.state;
    return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},measured,buttons,activeElement:{id:document.activeElement.id,tag:document.activeElement.tagName},project:{name:state.project.name,path:state.path,clipCount:state.project.clips.length,frame:state.frame,selectedId:state.selectedId,duration:state.project.clips.reduce((n,c)=>n+c.durationFrames,0),layers:document.querySelectorAll('.drawing-track').length},timelineZoom:document.getElementById('timelineZoom').value,drawingMode:document.getElementById('drawMode').getAttribute('aria-pressed'),tool:document.body.dataset.editorTool};
  });
  record.states.push({image: name + '.png', note, ...data});
  await fs.writeFile(path.join(__dirname, 'measurements.json'),JSON.stringify(record,null,2));
}
async function open(project) { await page.evaluate(p => {window.fixture=p;window.openError=null;},project);await page.locator('#openProject').click();await ready(); }
async function stroke(y=.4) {
  await page.locator('button[data-tool="brush"]').click();await ready();
  const r = await page.locator('canvas.upper-canvas').boundingBox();
  await page.mouse.move(r.x+r.width*.25,r.y+r.height*y);await page.mouse.down();await page.mouse.move(r.x+r.width*.65,r.y+r.height*(y+.07),{steps:12});await page.mouse.up();await ready();
}
(async()=>{
  await fs.mkdir(path.join(__dirname,'fixtures'),{recursive:true});
  const longFile=path.join(__dirname,'fixtures','SC012_SH034_anim_layout_camera_character_final_review_2026-09-06_v008_approved_take_03.mp4');
  const portraitFile=path.join(__dirname,'fixtures','portrait.mp4');
  for(const [file,size] of [[longFile,'320x180'],[portraitFile,'180x320']]) {
    try {await fs.stat(file);} catch {
      await runProcess(runtime.ffmpegPath,['-v','error','-f','lavfi','-i',`testsrc2=size=${size}:rate=24`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','30','-c:v','libopenh264','-b:v','180k','-c:a','aac','-b:a','48k','-pix_fmt','yuv420p','-y',file]);
    }
  }
  const source=(await probeMedia(longFile,runtime)).source,portrait=(await probeMedia(portraitFile,runtime)).source;
  const single=core.appendSource(core.createProject(),source);
  single.name='제작팀_에피소드_12_클라이맥스_액션_수정사항_최종검토_감독피드백_반영본_2026년_9월_6일';
  let multiple=single;
  for(let i=0;i<11;i++) multiple=core.appendSource(multiple,source);
  let portraitProject=core.appendSource(core.createProject(),portrait);portraitProject.width=1080;portraitProject.height=1920;portraitProject.name='세로 영상 · 캐릭터 동작 확인';
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--allow-file-access-from-files','--autoplay-policy=no-user-gesture-required']});
  try {
    page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>record.errors.push(e.message));
    await page.addInitScript(()=>{
      let module;
      Object.defineProperty(window,'BAEEditorController',{configurable:true,get:()=>module,set(value){module=value;const create=value.createEditorController;value.createEditorController=options=>{window.editorController=create(options);return window.editorController;};}});
      window.calls={open:0,save:0,pick:0,export:0};
      window.editorAPI={setDirty:()=>{},onExportProgress:fn=>{window.progressHandler=fn;return()=>{};},confirmDiscard:async()=>true,
        openProject:async()=>{window.calls.open++;if(window.openError)throw Error(window.openError);return{project:window.fixture,path:'review-fixture.bedit'};},
        saveProject:async project=>{window.calls.save++;window.saved=project;return{path:'review-fixture.bedit'};},
        pickMedia:async()=>{window.calls.pick++;return{sources:[]};},
        exportVideo:async()=>{window.calls.export++;return new Promise(resolve=>window.finishExport=resolve);},cancelExport:async()=>{window.finishExport?.({cancelled:true});}};
    });
    await page.goto(pathToFileURL(path.join(root,'renderer/editor.html')).href);await ready();
    await capture('01-empty-1440','Empty production editor; initial V active and drawing input off.');
    await open(single);await capture('02-landscape-longname-1440','30s landscape fixture, long project and source names, initial state.');
    await page.locator('#projectName').fill('입력 중 저장 동작 확인');await page.keyboard.press('Control+s');await page.waitForTimeout(120);
    record.checks.nameShortcut=await page.evaluate(()=>({calls:window.calls.save,projectName:window.editorController.state.project.name,input:document.getElementById('projectName').value}));
    await capture('14-name-save-focus-1440','Project-name input still focused after Ctrl+S: save calls0, input pending, original project name unchanged.');
    await page.locator('#saveProject').click();await ready();
    record.checks.nameFirstSave=await page.evaluate(()=>({calls:window.calls.save,projectName:window.editorController.state.project.name,dirty:window.editorController.state.dirty}));
    await page.locator('#saveProject').click();await ready();record.checks.nameSecondSave=await page.evaluate(()=>({calls:window.calls.save,dirty:window.editorController.state.dirty}));await open(single);
    await stroke();await page.locator('#saveProject').click();await ready();
    const saved=await page.evaluate(()=>window.saved);await fs.writeFile(path.join(__dirname,'fixtures','drawing-project.bedit'),JSON.stringify(saved,null,2));
    await page.reload();await ready();await open(saved);
    const passive=await page.locator('#stage').boundingBox();await page.mouse.move(passive.x+passive.width*.18,passive.y+passive.height*.25);await page.mouse.down();await page.mouse.move(passive.x+passive.width*.73,passive.y+passive.height*.6,{steps:12});await page.mouse.up();
    record.checks.initialSelect=await page.evaluate(()=>({tool:document.body.dataset.editorTool,pressed:document.querySelector('button[data-editor-tool="select"]').getAttribute('aria-pressed'),drawingMode:document.getElementById('drawMode').getAttribute('aria-pressed'),canvasPointerEvents:getComputedStyle(document.querySelector('canvas.upper-canvas')).pointerEvents,overlayPointerEvents:getComputedStyle(document.querySelector('.editor-drawing-overlay')).pointerEvents}));
    await capture('03-reopened-drawing-selection-1440','Fresh editor reopens saved drawing; V is active, but marquee on visible stroke has no effect until V is explicitly selected.');
    await page.keyboard.press('v');await ready();
    const r=await page.locator('canvas.upper-canvas').boundingBox();
    await page.mouse.move(r.x+r.width*.18,r.y+r.height*.25);await page.mouse.down();await page.mouse.move(r.x+r.width*.73,r.y+r.height*.60,{steps:12});await page.mouse.up();
    await capture('04-v-selection-1440','Actual mouse marquee after V; strokes and selection overlay.');
    await page.keyboard.press('c');await ready();await capture('05-razor-1440','C tool and timeline split affordance before click.');
    await page.keyboard.press('h');await ready();
    const beforePan=await page.evaluate(()=>JSON.stringify(window.editorController.state.project.clips[0].drawingsV3));const panRect=await page.locator('#stageViewport').boundingBox();
    await page.mouse.move(panRect.x+panRect.width*.5,panRect.y+panRect.height*.5);await page.mouse.down();await page.mouse.move(panRect.x+panRect.width*.5+45,panRect.y+panRect.height*.5+15,{steps:6});await page.mouse.up();
    await page.mouse.down({button:'middle'});await page.mouse.move(panRect.x+panRect.width*.5+25,panRect.y+panRect.height*.5+5,{steps:5});await page.mouse.up({button:'middle'});
    record.checks.panPreservesDrawing=await page.evaluate(before=>JSON.stringify(window.editorController.state.project.clips[0].drawingsV3)===before,beforePan);
    await capture('06-hand-1440','Actual H and middle-button stage pan, no drawing-document mutation. Stage size remains stable.');await page.locator('#resetPreview').click();await ready();
    await open(portraitProject);await page.setViewportSize({width:1050,height:720});await ready();await capture('07-portrait-1050','Portrait fit at 1050x720; real desktop density.');
    await open(multiple);await page.locator('button[data-editor-tool="select"]').click();await ready();
    for(let i=0;i<8;i++) {await page.locator('#addLayer').click();await ready();if(i<3) {await stroke(.25+i*.17);await page.locator('#scrub').fill(String((i+1)*12));await ready();await page.locator('[data-draw-action="keyframe"]').click();await ready();}}
    await page.locator('#saveProject').click();await ready();
    await capture('08-dense-layers-1050','12 cuts / 6min, 9 layers, three drawn layers and four keys, fit timeline at 1050x720.');
    record.checks.timelineZoomBefore=await page.locator('#timelineZoom').inputValue();
    await page.locator('#timelineZoomIn').click();await ready();
    record.checks.timelineZoomAfter=await page.locator('#timelineZoom').inputValue();
    await page.locator('#timelineFit').click();await ready();
    await page.locator('.inspector-body').evaluate(e=>e.scrollTop=e.scrollHeight);await capture('09-lower-inspector-1050','Inspector scrolled to trim/hold/music; footer and timeline density visible.');
    await page.locator('#importVideo').focus();
    const before=await page.evaluate(()=>({...window.calls,playing:!document.getElementById('videoPreview').paused}));
    await page.keyboard.press('Space');await page.waitForTimeout(250);
    const after=await page.evaluate(()=>({...window.calls,playing:!document.getElementById('videoPreview').paused}));
    record.checks.focusSpace={before,after};
    await page.keyboard.press('Space');await ready();await capture('10-keyboard-focus-1050','Keyboard focus on Import Video; Space handled globally as playback, Enter remains available.');
    await page.setViewportSize({width:1440,height:900});await open(single);
    await page.evaluate(()=>{for(const e of document.querySelectorAll('body *')) {if(['SCRIPT','STYLE','svg','path','use'].includes(e.tagName))continue;const s=getComputedStyle(e);e.dataset.reviewFont=s.fontSize;}for(const e of document.querySelectorAll('[data-review-font]'))e.style.fontSize=`${parseFloat(e.dataset.reviewFont)*2}px`;});
    await capture('11-text200-stress-1440','Text-only 200% stress: computed font sizes doubled by test harness, not native OS zoom; production dimensions unchanged.');
    await page.evaluate(()=>{for(const e of document.querySelectorAll('[data-review-font]'))e.style.removeProperty('font-size');});
    await page.locator('#exportVideo').click();await page.waitForFunction(()=>window.calls.export>0);await page.evaluate(()=>window.progressHandler({progress:.43,message:'영상 출력 중…'}));await capture('12-export-progress-1440','Real renderer/overlay prep, controlled IPC export progress43%, no real encode claimed.');
    await page.locator('#cancelExport').click();await ready();
    let missing='';try{await probeMedia(path.join(__dirname,'fixtures','missing-original.mp4'),runtime);}catch(e){missing=e.message;}
    await page.evaluate(message=>window.openError=message,missing);await page.locator('#openProject').click();await page.waitForFunction(()=>!window.editorController.state.busy && document.getElementById('status').classList.contains('error'));await capture('13-missing-media-1440','Real probeMedia error for safe nonexistent fixture replayed through IPC; project open fails, existing project stays.');
    record.checks.afterError=await page.evaluate(()=>({seeking:document.body.classList.contains('editor-seeking'),busy:window.editorController.state.busy,still:document.getElementById('previewStill').dataset.ready,drawModeDisabled:document.getElementById('drawMode').disabled}));
    record.checks.missingMediaError=missing;
    record.checks.sourceFile=source.path;
    record.completed=true;
  }finally{await fs.writeFile(path.join(__dirname,'measurements.json'),JSON.stringify(record,null,2));await browser.close();}
  process.stdout.write(JSON.stringify({images:record.states.length,errors:record.errors,checks:record.checks}));
})().catch(e=>{console.error(e);process.exitCode=1;});
