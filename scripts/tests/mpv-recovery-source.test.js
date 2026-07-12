const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const readSource = (relPath) =>
  normalizeNewlines(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));

const videoPlayerSource = readSource('renderer/scripts/modules/video-player.js');
const appSource = readSource('renderer/scripts/app.js');
const windowSource = readSource('main/window.js');
const preloadSource = readSource('preload/preload.js');
const ipcSource = readSource('main/ipc-handlers.js');
const mainStyles = readSource('renderer/styles/main.css');
const mpvManagerSource = readSource('main/mpv-manager.js');
const userSettingsSource = readSource('renderer/scripts/modules/user-settings.js');

function extractNamedFunction(source, functionName) {
  const functionKeywordStart = source.indexOf(`function ${functionName}`);
  assert.ok(functionKeywordStart >= 0, `${functionName} should exist`);
  const start = source.slice(Math.max(0, functionKeywordStart - 6), functionKeywordStart) === 'async '
    ? functionKeywordStart - 6
    : functionKeywordStart;
  const signatureEndMatch = /\)\s*\{/.exec(source.slice(functionKeywordStart));
  const bodyStart = signatureEndMatch
    ? functionKeywordStart + signatureEndMatch.index + signatureEndMatch[0].lastIndexOf('{')
    : -1;
  assert.ok(bodyStart > start, `${functionName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`${functionName} body should be balanced`);
}

function loadNamedFunction(source, functionName) {
  const functionSource = extractNamedFunction(source, functionName);
  return Function(`"use strict"; return (${functionSource});`)();
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test('external status polling escalates repeated failures to a stop event', () => {
  assert.match(videoPlayerSource, /this\._externalStatusFailureCount = 0;/);
  const watchdogMatch = videoPlayerSource.match(/async _registerExternalStatusFailure\(pollingControls\) \{([\s\S]*?)\n  \}/);
  assert.ok(watchdogMatch, 'watchdog method should exist');
  assert.match(watchdogMatch[1], /this\._externalStatusFailureCount \+= 1;/);
  assert.match(watchdogMatch[1], /reason: 'unresponsive'/);
  assert.match(watchdogMatch[1], /await Promise\.resolve\(pollingControls\?\.stop\?\.\(\)\)/);
  assert.match(watchdogMatch[1], /_emit\('externalstopped', detail\);/);
  assert.match(videoPlayerSource, /await this\._registerExternalStatusFailure\(pollingControls\);/);
});

test('externalstopped carries recovery context', () => {
  assert.match(videoPlayerSource, /_emit\('externalstopped', \{[\s\S]*?engine: stoppedEngine,[\s\S]*?filePath:[\s\S]*?lastFrame:[\s\S]*?reason: 'stopped'/);
});

test('unexpected mpv stop triggers reload with retry policy', () => {
  const handlerMatch = appSource.match(/videoPlayer\.addEventListener\('externalstopped', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(handlerMatch, 'externalstopped handler should exist');
  const handlerSource = handlerMatch[1];
  assert.match(handlerSource, /if \(isAppShuttingDown\) return;/);
  assert.match(handlerSource, /if \(mpvPilotHostPreparing\) return;/);
  assert.match(handlerSource, /if \(hasActiveVideoLoadForDifferentFile\(stoppedFilePath\)\) return;/);
  assert.match(handlerSource, /allowMpvPilot: retryMpv/);
  assert.match(handlerSource, /initialFrame: resumeFrame/);
  assert.match(handlerSource, /showToast\(/);
  assert.match(appSource, /let mpvUnexpectedStopRecovery = \{ filePath: null, attempted: false \};/);
  assert.match(appSource, /isAppShuttingDown = true;/);
});

test('renderer crash and reload clean up mpv processes and hosts', () => {
  assert.match(windowSource, /async function cleanupMpvAfterRendererGone\(reason\)/);
  assert.match(windowSource, /webContents\.on\('render-process-gone'[\s\S]*?cleanupMpvAfterRendererGone/);
  assert.match(windowSource, /webContents\.on\('did-navigate'[\s\S]*?cleanupMpvAfterRendererGone/);
  assert.match(windowSource, /rendererCrashRecoveryCount/);
  assert.match(windowSource, /webContents\.reload\(\)/);
});

test('mpv screenshot ipc channel is wired end to end', () => {
  assert.match(ipcSource, /ipcMain\.handle\('mpv:screenshot'/);
  assert.match(ipcSource, /mpv-frames/);
  assert.match(preloadSource, /mpvScreenshot: \(\) => ipcRenderer\.invoke\('mpv:screenshot'\),/);
});

test('comment and draw modes share a decoded mpv review freeze frame', () => {
  assert.match(appSource, /function isMpvReviewInteractionActive\(\)/);
  assert.match(appSource, /async function showMpvReviewFreezeFrame\(\)/);
  assert.match(appSource, /async function releaseMpvReviewFreezeFrame\(\)/);
  assert.match(appSource, /function scheduleMpvReviewFreezeRefresh\(\)/);
  const applyMatch = appSource.match(/function applyDrawModeState\(enabled\) \{([\s\S]*?)\n  \}/);
  assert.ok(applyMatch, 'applyDrawModeState should exist');
  assert.match(applyMatch[1], /videoPlayer\.pause\(\);/);
  assert.match(applyMatch[1], /showMpvReviewFreezeFrame\(\)/);
  assert.match(applyMatch[1], /releaseMpvReviewFreezeFrame\(\)/);
  assert.match(appSource, /videoPlayer\.addEventListener\('frameUpdate'[\s\S]*?isMpvReviewInteractionActive\(\)[\s\S]*?scheduleMpvReviewFreezeRefresh\(\);/);
  assert.match(videoPlayerSource, /isSeeking\(\) \{/);
  assert.match(mainStyles, /\.mpv-review-freeze-frame \{[\s\S]+z-index:\s*1;[\s\S]+pointer-events:\s*none;[\s\S]+object-fit:\s*fill;/);
  const freezeStyles = mainStyles.match(/\.mpv-review-freeze-frame \{([\s\S]*?)\}/)?.[1] || '';
  assert.doesNotMatch(freezeStyles, /background:/);
});

test('mpv review freeze frame is cleared and refreshed across media changes', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  assert.match(loadVideoMatch[1], /releaseMpvReviewFreezeFrame\(\)/);

  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  assert.match(loadMpvMatch[1], /if \(isMpvReviewInteractionActive\(\)\) \{[\s\S]*?await showMpvReviewFreezeFrame\(\);[\s\S]*?\}/);
});

test('mpv review freeze decodes before hiding native video and releases in the reverse order', () => {
  const showStart = appSource.indexOf('  async function showMpvReviewFreezeFrame()');
  const releaseStart = appSource.indexOf('  async function releaseMpvReviewFreezeFrame()', showStart);
  const releaseEnd = appSource.indexOf('  function scheduleMpvReviewFreezeRefresh()', releaseStart);
  assert.ok(showStart >= 0 && releaseStart > showStart && releaseEnd > releaseStart, 'shared freeze functions should be bounded');
  const showSource = appSource.slice(showStart, releaseStart);
  const releaseSource = appSource.slice(releaseStart, releaseEnd);
  const captureSource = extractNamedFunction(appSource, 'runMpvReviewFreezeCapture');

  const decodeIndex = captureSource.indexOf('await decodeCandidate(candidate);');
  const commitIndex = captureSource.indexOf('commitCandidate(candidate);', decodeIndex);
  const hideIndex = captureSource.indexOf('hideResult = await hideNativeHost();');
  const readyIndex = captureSource.indexOf('markCandidateReady(candidate);');
  assert.ok(decodeIndex >= 0 && decodeIndex < commitIndex && commitIndex < hideIndex && hideIndex < readyIndex, 'candidate must decode and host hide must settle before the blocker becomes ready');
  assert.match(showSource, /candidate\.src = dataUrl;/);
  assert.match(showSource, /classList\.add\('mpv-review-freeze-ready'\)/);
  assert.match(showSource, /const hadValidFrame = Boolean\(/);
  assert.match(showSource, /if \(!hadValidFrame\) \{[\s\S]+disableMpvReviewInteractionAfterFreezeFailure\(\);/);

  const removeReadyIndex = releaseSource.indexOf("classList.remove('mpv-review-freeze-ready')");
  const restoreIndex = releaseSource.indexOf('await window.electronAPI.mpvSetHostVisible(true)');
  const removeFrameIndex = releaseSource.indexOf('freezeElement.remove()');
  assert.ok(removeReadyIndex >= 0 && removeReadyIndex < restoreIndex && restoreIndex < removeFrameIndex, 'release must restore native video before removing its fallback frame');
  assert.match(releaseSource, /if \(token !== mpvReviewFreezeToken\) return;/);
  assert.match(releaseSource, /if \(!result\?\.success\) \{[\s\S]+return;/);
});

test('mpv review freeze refresh is throttled instead of perpetually debounced', () => {
  const scheduleStart = appSource.indexOf('  function scheduleMpvReviewFreezeRefresh()');
  const nextFunction = appSource.indexOf('\n  function ', scheduleStart + 1);
  assert.ok(scheduleStart >= 0 && nextFunction > scheduleStart, 'review freeze refresh scheduler should exist');
  const scheduleSource = appSource.slice(scheduleStart, nextFunction);
  assert.match(scheduleSource, /mpvReviewFreezeRefreshScheduler\.schedule\(\);/);
  const coalescerSource = extractNamedFunction(appSource, 'createCoalescedAsyncScheduler');
  assert.match(coalescerSource, /if \(inFlight\) \{[\s\S]+trailing = true;/);
  assert.match(coalescerSource, /if \(!trailing\) return;[\s\S]+schedule\(\);/);
});

test('mpv review refresh coalescer keeps one slow capture and schedules one trailing refresh', async () => {
  const createCoalescedAsyncScheduler = loadNamedFunction(appSource, 'createCoalescedAsyncScheduler');
  const timers = [];
  const captures = [createDeferred(), createDeferred()];
  let captureCount = 0;
  let active = true;
  const scheduler = createCoalescedAsyncScheduler({
    delayMs: 160,
    run: () => captures[captureCount++].promise,
    shouldRun: () => active,
    setTimer: callback => {
      timers.push(callback);
      return callback;
    },
    clearTimer: callback => {
      const index = timers.indexOf(callback);
      if (index >= 0) timers.splice(index, 1);
    }
  });

  scheduler.schedule();
  scheduler.schedule();
  assert.equal(timers.length, 1, 'pending ticks should share one timer');
  timers.shift()();
  assert.equal(captureCount, 1, 'the first timer should start one capture');

  scheduler.schedule();
  scheduler.schedule();
  assert.equal(captureCount, 1, 'ticks must not start another capture while one is in flight');
  assert.equal(timers.length, 0, 'in-flight ticks should coalesce without an extra active timer');

  captures[0].resolve(true);
  await flushPromises();
  assert.equal(timers.length, 1, 'settlement should schedule exactly one trailing refresh');
  timers.shift()();
  assert.equal(captureCount, 2, 'the trailing timer should start the queued refresh');

  active = false;
  scheduler.cancel();
  captures[1].resolve(true);
  await flushPromises();
  assert.equal(timers.length, 0, 'cancelled generations must not resurrect after stale settlement');
});

test('comment readiness waits for screenshot, decode, and native host hide', async () => {
  const runMpvReviewFreezeCapture = loadNamedFunction(appSource, 'runMpvReviewFreezeCapture');
  const prepareMpvCommentReadiness = loadNamedFunction(appSource, 'prepareMpvCommentReadiness');
  const screenshot = createDeferred();
  const decode = createDeferred();
  const hide = createDeferred();
  let candidateCommitted = false;
  let readyUi = false;
  let pointerEvents = 'none';
  let guidanceCount = 0;

  const readiness = prepareMpvCommentReadiness({
    prepareFreeze: () => runMpvReviewFreezeCapture({
      captureFrame: () => screenshot.promise,
      createCandidate: dataUrl => ({ dataUrl }),
      decodeCandidate: () => decode.promise,
      isCurrent: () => true,
      hasValidFrame: false,
      beginInitialHide: () => {},
      commitCandidate: () => { candidateCommitted = true; },
      hideNativeHost: () => hide.promise,
      didHideApply: result => result?.success === true,
      markCandidateReady: () => {},
      endInitialHide: () => {},
      rollbackCandidate: () => {},
      restoreNativeHost: async () => {},
      resyncAfterStale: async () => {}
    }),
    isStillActive: () => true,
    setReady: ready => {
      readyUi = ready;
      pointerEvents = ready ? 'auto' : 'none';
    },
    showGuidance: () => { guidanceCount += 1; }
  });

  assert.equal(readyUi, false);
  assert.equal(pointerEvents, 'none');
  screenshot.resolve({ success: true, dataUrl: 'data:image/png;base64,test' });
  await flushPromises();
  assert.equal(candidateCommitted, false, 'candidate must wait for image decode');
  assert.equal(readyUi, false, 'screenshot alone must not enable comment input');

  decode.resolve();
  await flushPromises();
  assert.equal(candidateCommitted, true, 'decoded candidate should be committed behind native mpv');
  assert.equal(readyUi, false, 'native host hide acknowledgement is still required');
  assert.equal(pointerEvents, 'none');

  hide.resolve({ success: true });
  assert.equal(await readiness, true);
  assert.equal(readyUi, true);
  assert.equal(pointerEvents, 'auto');
  assert.equal(guidanceCount, 1);
});

test('initial host hide failure rolls back the freeze and keeps comment input disabled', async () => {
  const runMpvReviewFreezeCapture = loadNamedFunction(appSource, 'runMpvReviewFreezeCapture');
  const prepareMpvCommentReadiness = loadNamedFunction(appSource, 'prepareMpvCommentReadiness');
  let rollbackCount = 0;
  let restoreCount = 0;
  let failureCount = 0;
  let readyUi = false;

  const readiness = prepareMpvCommentReadiness({
    prepareFreeze: () => runMpvReviewFreezeCapture({
      captureFrame: async () => ({ success: true, dataUrl: 'data:image/png;base64,test' }),
      createCandidate: dataUrl => ({ dataUrl }),
      decodeCandidate: async () => {},
      isCurrent: () => true,
      hasValidFrame: false,
      beginInitialHide: () => {},
      commitCandidate: () => {},
      hideNativeHost: async () => ({ success: false, error: 'hide failed' }),
      didHideApply: result => result?.success === true,
      markCandidateReady: () => {},
      endInitialHide: () => {},
      rollbackCandidate: () => { rollbackCount += 1; },
      restoreNativeHost: async () => { restoreCount += 1; },
      resyncAfterStale: async () => {}
    }).catch(() => {
      failureCount += 1;
      return false;
    }),
    isStillActive: () => true,
    setReady: ready => { readyUi = ready; },
    showGuidance: () => assert.fail('failed preparation must not show guidance')
  });

  assert.equal(await readiness, false);
  assert.equal(rollbackCount, 1);
  assert.equal(restoreCount, 1);
  assert.equal(failureCount, 1);
  assert.equal(readyUi, false);
  assert.match(appSource, /disableMpvReviewInteractionAfterFreezeFailure\(\)/);
  assert.match(appSource, /댓글·그리기 모드를 종료했습니다/);
});

test('late stale host hide completion resynchronizes current native host visibility', async () => {
  const runMpvReviewFreezeCapture = loadNamedFunction(appSource, 'runMpvReviewFreezeCapture');
  const hide = createDeferred();
  let current = true;
  let readyCount = 0;
  let resyncCount = 0;

  const capture = runMpvReviewFreezeCapture({
    captureFrame: async () => ({ success: true, dataUrl: 'data:image/png;base64,test' }),
    createCandidate: dataUrl => ({ dataUrl }),
    decodeCandidate: async () => {},
    isCurrent: () => current,
    hasValidFrame: false,
    beginInitialHide: () => {},
    commitCandidate: () => {},
    hideNativeHost: () => hide.promise,
    didHideApply: result => result?.success === true,
    markCandidateReady: () => { readyCount += 1; },
    endInitialHide: () => {},
    rollbackCandidate: () => {},
    restoreNativeHost: async () => {},
    resyncAfterStale: async () => { resyncCount += 1; }
  });

  await flushPromises();
  current = false;
  hide.resolve({ success: true });
  const result = await capture;
  assert.equal(result, false);
  assert.equal(readyCount, 0);
  assert.equal(resyncCount, 1, 'stale hide must be followed by current-state visibility sync');
});

test('shared mpv freeze releases only after the final review mode turns off', () => {
  const commentHandlerStart = appSource.indexOf("  commentManager.addEventListener('commentModeChanged'");
  const commentHandlerEnd = appSource.indexOf("  commentManager.addEventListener('markerCreationStarted'", commentHandlerStart);
  const commentHandler = appSource.slice(commentHandlerStart, commentHandlerEnd);
  const drawMatch = appSource.match(/function applyDrawModeState\(enabled\) \{([\s\S]*?)\n  \}/);
  assert.ok(drawMatch, 'draw mode state handler should exist');

  assert.match(commentHandler, /state\.isCommentMode = isCommentMode;[\s\S]+if \(!isMpvReviewInteractionActive\(\)\) \{[\s\S]+releaseMpvReviewFreezeFrame\(\)/);
  assert.match(drawMatch[1], /state\.isDrawMode = enabled;[\s\S]+if \(!isMpvReviewInteractionActive\(\)\) \{[\s\S]+releaseMpvReviewFreezeFrame\(\)/);
});

test('mpv playback is enabled by default with legacy pilot key migration', () => {
  assert.match(userSettingsSource, /mpvPlaybackEnabled: true,/);
  assert.doesNotMatch(userSettingsSource, /mpvPilotEnabled: false,/);
  assert.match(userSettingsSource, /getMpvPlaybackEnabled\(\) \{[\s\S]+?return this\.settings\.mpvPlaybackEnabled !== false;/);
  assert.match(userSettingsSource, /setMpvPlaybackEnabled\(enabled\) \{[\s\S]+?this\.settings\.mpvPlaybackEnabled = enabled === true;[\s\S]+?this\._save\(\);/);
  const migrateMatch = userSettingsSource.match(/_migrateLegacySettings\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(migrateMatch, 'legacy settings migration should exist');
  assert.match(migrateMatch[1], /delete this\.settings\.mpvPilotEnabled;/);

  const loadFromStorageMatch = userSettingsSource.match(/_loadFromStorage\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadFromStorageMatch, '_loadFromStorage should exist');
  assert.match(loadFromStorageMatch[1], /this\._migrateLegacySettings\(\);/);
  const loadFromFileMatch = userSettingsSource.match(/async _loadFromFile\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadFromFileMatch, '_loadFromFile should exist');
  assert.match(loadFromFileMatch[1], /this\._migrateLegacySettings\(\);/);
});

test('mpv can be disabled per machine via env for troubleshooting', () => {
  assert.match(mpvManagerSource, /function isMpvPlaybackDisabledByEnv\(env = process\.env\)/);
  assert.match(mpvManagerSource, /BAEFRAME_DISABLE_MPV/);
  const availableMatch = mpvManagerSource.match(/isAvailable\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(availableMatch, 'isAvailable should exist');
  assert.match(availableMatch[1], /isMpvPlaybackDisabledByEnv\(this\.env\)/);
});
