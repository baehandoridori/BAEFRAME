const fs = require('fs');
const assert = require('assert/strict');
const app = fs.readFileSync('renderer/scripts/app.js','utf8').replace(/\r\n/g,'\n');
function extract(name) {
  const at = app.indexOf(`async function ${name}(`);
  const body = app.indexOf(') {',at)+2;
  let depth=0;
  for(let i=body;i<app.length;i++) {
    if(app[i]==='{') depth++;
    if(app[i]==='}' && --depth===0) return app.slice(at,i+1);
  }
  throw Error('extract '+name);
}
function compile(name, env) { return Function(...Object.keys(env), 'return ('+extract(name)+');')(...Object.values(env)); }
(async()=>{
  let resolveProbe;
  const probed=[]; const loads=[];
  const state={currentFile:'A.mp4',isAudioMode:false,isCommentMode:true};
  const hybrid=compile('enterHybridReviewEngineIfPossible',{
    hybridReviewSwapInFlight:false, hybridReviewResumeMpvFile:null,
    userSettings:{getHybridReviewEngine:()=>true}, isMpvPilotPlaybackActive:()=>true,
    state, videoPlayer:{currentFrame:42},
    isHtml5DirectPlayableForReview:path=>{probed.push(path);return new Promise(r=>resolveProbe=r);},
    loadVideoWithHtml5Fallback:async(path,options)=>{loads.push({path,options});return true;},
    log:{warn:()=>{}}
  });
  const pending=hybrid();
  state.currentFile='B.mov'; state.isCommentMode=false;
  resolveProbe(true);
  await pending;
  assert.equal(probed[0],'A.mp4'); assert.equal(loads[0].path,'B.mov');
  console.log('HYBRID_STALE_PROBE_REPRODUCED',JSON.stringify({probed,loads,commentMode:state.isCommentMode}));

  let active=true; let waits=0; const mutations=[]; const toasts=[];
  const player={isPlaying:true,pause(){this.isPlaying=false;},async play(){this.isPlaying=true;return true;}};
  const watchdog=compile('playContinuousItemWithWatchdog',{
    isContinuousSessionActive:()=>active, videoPlayer:player,
    waitForContinuousMediaReady:async()=>true,
    waitForContinuousPlaybackAdvance:async()=>{if(++waits===2)active=false;return false;},
    waitForContinuousDelay:async()=>{},
    markPlaylistItemStatus:(...args)=>mutations.push(args),
    CONTINUOUS_STATUS:{ERROR:'error'},continuousPlaybackState:{skippedBatch:[]},
    showToast:(...args)=>toasts.push(args), log:{warn:()=>{}}
  });
  await watchdog({id:'B',fileName:'B.mp4'},10);
  assert.equal(active,false); assert.equal(mutations.length,1); assert.equal(mutations[0][1],'error');
  console.log('WATCHDOG_CANCEL_MARKS_ERROR_REPRODUCED',JSON.stringify({waits,active,mutations,toasts}));
})().catch(e=>{console.error(e);process.exitCode=1;});
