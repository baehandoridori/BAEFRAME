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

test('stale unresponsive cleanup cannot replace a newer playback engine', async () => {
  const watchdogMatch = videoPlayerSource.match(/async _registerExternalStatusFailure\(pollingControls\) \{([\s\S]*?)\n  \}/);
  assert.ok(watchdogMatch, 'watchdog method should exist');
  const registerExternalStatusFailure = Function(
    'log',
    `"use strict"; return ({${watchdogMatch[0]}})._registerExternalStatusFailure;`
  )({ warn() {} });
  const staleStop = createDeferred();
  const staleControls = { stop: () => staleStop.promise };
  const currentControls = {};
  const emittedEvents = [];
  const player = {
    _externalStatusFailureCount: 2,
    engine: 'mpv-embedded',
    externalControls: staleControls,
    filePath: 'C:\\shots\\old.mov',
    currentTime: 1,
    currentFrame: 24,
    isLoaded: true,
    useHtml5Engine() {
      this.engine = 'html5';
      this.externalControls = null;
    },
    _emit(eventName, detail) {
      emittedEvents.push([eventName, detail]);
    }
  };

  const staleCleanup = registerExternalStatusFailure.call(player, staleControls);
  player.engine = 'mpv-embedded';
  player.externalControls = currentControls;
  player.filePath = 'C:\\shots\\new.mov';
  staleStop.resolve();
  await staleCleanup;

  assert.equal(player.engine, 'mpv-embedded');
  assert.equal(player.externalControls, currentControls);
  assert.equal(player.isLoaded, true);
  assert.deepEqual(emittedEvents, []);
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
  assert.match(applyMatch[1], /prepareMpvDrawMode\(preparationToken\)/);
  assert.match(extractNamedFunction(appSource, 'prepareMpvDrawMode'), /prepareFreeze: \(\) => showMpvReviewFreezeFrame\(\)/);
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
  assert.match(loadMpvMatch[1], /if \(isMpvReviewInteractionActive\(\)\) \{[\s\S]*?await prepareMpvDrawMode\(preparationToken\);[\s\S]*?if \(!reviewReady\)/);
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
  assert.match(showSource, /return mpvReviewFreezeCaptureOwner\.capture\(async \(\) => \{[\s\S]+const token = \+\+mpvReviewFreezeToken;/);
  assert.match(showSource, /classList\.add\('mpv-review-freeze-ready'\)/);
  assert.match(showSource, /const hadValidFrame = Boolean\(/);
  assert.match(showSource, /if \(!hadValidFrame\) \{[\s\S]+disableMpvReviewInteractionAfterFreezeFailure\(\);/);

  const removeReadyIndex = releaseSource.indexOf("classList.remove('mpv-review-freeze-ready')");
  const restoreIndex = releaseSource.indexOf('await window.electronAPI.mpvSetHostVisible(true)');
  const removeFrameIndex = releaseSource.indexOf('freezeElement.remove()');
  assert.ok(removeReadyIndex >= 0 && removeReadyIndex < restoreIndex && restoreIndex < removeFrameIndex, 'release must restore native video before removing its fallback frame');
  assert.match(releaseSource, /const token = \+\+mpvReviewFreezeToken;[\s\S]+mpvReviewFreezeCaptureOwner\.cancel\(\);/);
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

test('direct comment readiness and scheduled refreshes share one freeze capture owner', async () => {
  const createSharedAsyncCaptureOwner = loadNamedFunction(appSource, 'createSharedAsyncCaptureOwner');
  const createCoalescedAsyncScheduler = loadNamedFunction(appSource, 'createCoalescedAsyncScheduler');
  const prepareMpvCommentReadiness = loadNamedFunction(appSource, 'prepareMpvCommentReadiness');
  const owner = createSharedAsyncCaptureOwner();
  const timers = [];
  const screenshots = [createDeferred(), createDeferred()];
  const decodes = [createDeferred(), createDeferred()];
  let captureCount = 0;
  let decodeCount = 0;
  let captureToken = 0;
  let pointerReady = false;

  const showFreeze = () => owner.capture(async () => {
    const token = ++captureToken;
    const captureIndex = captureCount++;
    await screenshots[captureIndex].promise;
    decodeCount += 1;
    await decodes[captureIndex].promise;
    return token === captureToken;
  });
  const scheduler = createCoalescedAsyncScheduler({
    delayMs: 160,
    run: showFreeze,
    shouldRun: () => true,
    setTimer: callback => {
      timers.push(callback);
      return callback;
    },
    clearTimer: callback => {
      const index = timers.indexOf(callback);
      if (index >= 0) timers.splice(index, 1);
    }
  });
  const readiness = prepareMpvCommentReadiness({
    prepareFreeze: showFreeze,
    isStillActive: () => true,
    setReady: ready => { pointerReady = ready; },
    showGuidance: () => {}
  });

  scheduler.schedule();
  scheduler.schedule();
  assert.equal(timers.length, 1, 'frame ticks should share one pending scheduler timer');
  timers.shift()();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(captureCount, 1, 'scheduler must join the direct comment capture');
  assert.equal(captureToken, 1, 'joining callers must not supersede the direct capture token');
  assert.equal(decodeCount, 0, 'a second screenshot/decode pipeline must not start');
  assert.equal(pointerReady, false);

  screenshots[0].resolve({ success: true });
  await flushPromises();
  assert.equal(decodeCount, 1);
  assert.equal(captureCount, 1);
  decodes[0].resolve();
  assert.equal(await readiness, true);
  assert.equal(pointerReady, true, 'the original readiness continuation should enable pointer input');
  await flushPromises();
  assert.equal(timers.length, 1, 'joined scheduler ticks should coalesce to one trailing refresh');

  timers.shift()();
  assert.equal(captureCount, 2, 'the one trailing refresh may start after initial readiness settles');
  assert.equal(captureToken, 2);
  scheduler.cancel();
  owner.cancel();
  screenshots[1].resolve({ success: true });
  decodes[1].resolve();
  await flushPromises();
});

test('active review refresh queues one trailing capture when its shared capture settles stale', async () => {
  const createSharedAsyncCaptureOwner = loadNamedFunction(appSource, 'createSharedAsyncCaptureOwner');
  const createCoalescedAsyncScheduler = loadNamedFunction(appSource, 'createCoalescedAsyncScheduler');
  const runMpvReviewFreezeRefresh = loadNamedFunction(appSource, 'runMpvReviewFreezeRefresh');
  const owner = createSharedAsyncCaptureOwner();
  const timers = [];
  const captures = [createDeferred(), createDeferred()];
  let captureCount = 0;
  let readyCount = 0;
  let active = true;

  const showFreeze = () => owner.capture(() => {
    const capture = captures[captureCount++];
    return capture.promise;
  });
  const scheduler = createCoalescedAsyncScheduler({
    delayMs: 160,
    run: () => runMpvReviewFreezeRefresh({
      prepareFreeze: showFreeze,
      isStillActive: () => active,
      setReady: () => { readyCount += 1; },
      scheduleRetry: () => scheduler.schedule()
    }),
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

  const directPreparation = showFreeze();
  scheduler.schedule();
  timers.shift()();
  assert.equal(captureCount, 1, 'the scheduled refresh should initially join direct preparation');

  captures[0].resolve(false);
  assert.equal(await directPreparation, false);
  await flushPromises();
  await flushPromises();
  assert.equal(timers.length, 1, 'stale settlement must guarantee exactly one trailing refresh');

  timers.shift()();
  assert.equal(captureCount, 2, 'the trailing refresh must capture the current frame');
  captures[1].resolve(true);
  await flushPromises();
  await flushPromises();
  assert.equal(readyCount, 1, 'only the current capture may restore review input');
  assert.equal(timers.length, 0, 'a successful current capture must not keep retrying');

  active = false;
  scheduler.cancel();
  owner.cancel();
});

test('cancelling a shared freeze capture detaches stale ownership from a fresh interaction', async () => {
  const createSharedAsyncCaptureOwner = loadNamedFunction(appSource, 'createSharedAsyncCaptureOwner');
  const owner = createSharedAsyncCaptureOwner();
  const staleDeferred = createDeferred();
  const freshDeferred = createDeferred();
  let starts = 0;
  let captureToken = 0;

  const staleCapture = owner.capture(async () => {
    const token = ++captureToken;
    starts += 1;
    await staleDeferred.promise;
    return token === captureToken;
  });
  captureToken += 1;
  owner.cancel();
  const freshCapture = owner.capture(async () => {
    const token = ++captureToken;
    starts += 1;
    await freshDeferred.promise;
    return token === captureToken;
  });

  assert.equal(starts, 2, 'a fresh interaction must not wait for the detached stale capture');
  staleDeferred.resolve();
  assert.equal(await staleCapture, false, 'release token invalidation should stale the old capture');
  await flushPromises();
  assert.strictEqual(
    owner.capture(() => assert.fail('stale completion must not clear the fresh owner')),
    freshCapture
  );

  freshDeferred.resolve();
  assert.equal(await freshCapture, true);
  await flushPromises();
  owner.capture(async () => {
    starts += 1;
    return true;
  });
  assert.equal(starts, 3, 'the fresh owner should clear itself after its own settlement');
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

test('initial host hide failure keeps the safety frame until native host restore succeeds', async () => {
  const runMpvReviewFreezeCapture = loadNamedFunction(appSource, 'runMpvReviewFreezeCapture');
  const prepareMpvCommentReadiness = loadNamedFunction(appSource, 'prepareMpvCommentReadiness');
  const restore = createDeferred();
  let rollbackCount = 0;
  let restoreCount = 0;
  let failureCount = 0;
  let readyUi = false;
  let candidatePresent = false;
  const events = [];

  const readiness = prepareMpvCommentReadiness({
    prepareFreeze: () => runMpvReviewFreezeCapture({
      captureFrame: async () => ({ success: true, dataUrl: 'data:image/png;base64,test' }),
      createCandidate: dataUrl => ({ dataUrl }),
      decodeCandidate: async () => {},
      isCurrent: () => true,
      hasValidFrame: false,
      beginInitialHide: () => {},
      commitCandidate: () => { candidatePresent = true; },
      hideNativeHost: async () => ({ success: false, error: 'hide failed' }),
      didHideApply: result => result?.success === true,
      markCandidateReady: () => {},
      endInitialHide: () => {},
      rollbackCandidate: () => {
        events.push('rollback');
        candidatePresent = false;
        rollbackCount += 1;
      },
      restoreNativeHost: async () => {
        events.push('restore:start');
        restoreCount += 1;
        const restored = await restore.promise;
        events.push('restore:end');
        return restored;
      },
      resyncAfterStale: async () => {}
    }).catch(() => {
      failureCount += 1;
      return false;
    }),
    isStillActive: () => true,
    setReady: ready => { readyUi = ready; },
    showGuidance: () => assert.fail('failed preparation must not show guidance')
  });

  await flushPromises();
  assert.equal(candidatePresent, true, 'candidate must cover a partially hidden host while restore is pending');
  assert.equal(rollbackCount, 0, 'candidate rollback must wait for host restore acknowledgement');
  assert.deepEqual(events, ['restore:start']);

  restore.resolve(true);
  assert.equal(await readiness, false);
  assert.equal(rollbackCount, 1);
  assert.equal(restoreCount, 1);
  assert.equal(failureCount, 1);
  assert.equal(readyUi, false);
  assert.equal(candidatePresent, false);
  assert.deepEqual(events, ['restore:start', 'restore:end', 'rollback']);
  assert.match(appSource, /disableMpvReviewInteractionAfterFreezeFailure\(\)/);
  assert.match(appSource, /댓글·그리기 모드를 종료했습니다/);
});

test('failed native host restore retains the decoded safety frame and propagates the hide failure', async () => {
  const runMpvReviewFreezeCapture = loadNamedFunction(appSource, 'runMpvReviewFreezeCapture');

  for (const restoreMode of ['failure-result', 'throw']) {
    const restore = createDeferred();
    let candidatePresent = false;
    let rollbackCount = 0;
    const capture = runMpvReviewFreezeCapture({
      captureFrame: async () => ({ success: true, dataUrl: 'data:image/png;base64,test' }),
      createCandidate: dataUrl => ({ dataUrl }),
      decodeCandidate: async () => {},
      isCurrent: () => true,
      hasValidFrame: false,
      beginInitialHide: () => {},
      commitCandidate: () => { candidatePresent = true; },
      hideNativeHost: async () => {
        if (restoreMode === 'throw') throw new Error('original hide exception');
        return { success: false, error: 'original hide failed' };
      },
      didHideApply: result => result?.success === true,
      markCandidateReady: () => {},
      endInitialHide: () => {},
      rollbackCandidate: () => {
        candidatePresent = false;
        rollbackCount += 1;
      },
      restoreNativeHost: async () => {
        await restore.promise;
        if (restoreMode === 'throw') throw new Error('restore failed');
        return false;
      },
      resyncAfterStale: async () => {}
    });

    await flushPromises();
    assert.equal(candidatePresent, true, `${restoreMode}: candidate must remain during restore await`);
    restore.resolve();
    await assert.rejects(capture, /original hide/);
    assert.equal(rollbackCount, 0, `${restoreMode}: failed restore must not remove the last safety frame`);
    assert.equal(candidatePresent, true, `${restoreMode}: release now owns eventual safety-frame removal`);
  }
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

  assert.match(commentHandler, /state\.isCommentMode = isCommentMode;[\s\S]+if \(!isMpvReviewInteractionActive\(\) && !suppressReviewFreezeReleaseForMediaChange\) \{[\s\S]+releaseMpvReviewFreezeFrame\(\)/);
  assert.match(drawMatch[1], /state\.isDrawMode = enabled;[\s\S]+if \(!isMpvReviewInteractionActive\(\)\) \{[\s\S]+releaseMpvReviewFreezeFrame\(\)/);
});

test('comment and draw handoffs acquire the next mode before releasing the previous mode', () => {
  const toggleDrawSource = extractNamedFunction(appSource, 'toggleDrawMode');
  const toggleCommentSource = extractNamedFunction(appSource, 'toggleCommentMode');

  const drawAcquireIndex = toggleDrawSource.indexOf('applyDrawModeState(true)');
  const commentReleaseIndex = toggleDrawSource.indexOf('commentManager.setCommentMode(false)');
  assert.ok(drawAcquireIndex >= 0, 'draw handoff should acquire draw mode explicitly');
  assert.ok(commentReleaseIndex > drawAcquireIndex, 'draw must own the shared freeze before comment mode turns off');

  const commentAcquireIndex = toggleCommentSource.indexOf('commentManager.setCommentMode(true)');
  const drawReleaseIndex = toggleCommentSource.indexOf('applyDrawModeState(false)');
  assert.ok(commentAcquireIndex >= 0, 'comment handoff should acquire comment mode explicitly');
  assert.ok(drawReleaseIndex > commentAcquireIndex, 'comment must own the shared freeze before draw mode turns off');
});

test('every comment and draw entry path enforces mutual exclusion in the central state handlers', () => {
  const commentHandlerStart = appSource.indexOf("  commentManager.addEventListener('commentModeChanged'");
  const commentHandlerEnd = appSource.indexOf("  commentManager.addEventListener('markerCreationStarted'", commentHandlerStart);
  const commentHandler = appSource.slice(commentHandlerStart, commentHandlerEnd);
  const drawStateSource = extractNamedFunction(appSource, 'applyDrawModeState');

  assert.match(commentHandler, /state\.isCommentMode = isCommentMode;[\s\S]+if \(isCommentMode && state\.isDrawMode\) \{[\s\S]+applyDrawModeState\(false\);/);
  assert.match(drawStateSource, /state\.isDrawMode = enabled;[\s\S]+if \(enabled && state\.isCommentMode\) \{[\s\S]+commentManager\.setCommentMode\(false\);/);
  const sidebarSubmitSource = extractNamedFunction(appSource, 'submitSidebarCommentDraft');
  assert.match(sidebarSubmitSource, /commentManager\.setPendingText\(text \|\| '\(이미지\)'\)/);
});

test('review freeze frame tracker rejects stale file, frame, and epoch captures', () => {
  const createMpvReviewFrameTracker = loadNamedFunction(appSource, 'createMpvReviewFrameTracker');
  const tracker = createMpvReviewFrameTracker();
  const frameA = tracker.capture('C:\\shots\\a.mov', 10);

  assert.equal(tracker.isCurrent(frameA, 'c:\\shots\\A.mov', 10), true);
  assert.equal(tracker.isCurrent(frameA, 'C:\\shots\\a.mov', 11), false);
  assert.equal(tracker.isCurrent(frameA, 'C:\\shots\\b.mov', 10), false);
  assert.equal(tracker.isSamePosition(frameA, 'c:\\shots\\A.mov', 10), true);

  tracker.invalidate();
  assert.equal(tracker.isCurrent(frameA, 'C:\\shots\\a.mov', 10), false);
});

test('frame changes suspend mpv review input until a current trailing capture restores readiness', () => {
  const timeHandlerMatch = appSource.match(/videoPlayer\.addEventListener\('timeupdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(timeHandlerMatch, 'timeupdate handler should exist');
  assert.match(timeHandlerMatch[1], /invalidateMpvReviewFreezeForFrameChange\(\)[\s\S]+scheduleMpvReviewFreezeRefresh\(\);/);

  const frameHandlerMatch = appSource.match(/videoPlayer\.addEventListener\('frameUpdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(frameHandlerMatch, 'frameUpdate handler should exist');
  assert.match(frameHandlerMatch[1], /invalidateMpvReviewFreezeForFrameChange\(\);[\s\S]+scheduleMpvReviewFreezeRefresh\(\);/);

  const invalidateSource = extractNamedFunction(appSource, 'invalidateMpvReviewFreezeForFrameChange');
  assert.match(invalidateSource, /mpvReviewFrameTracker\.invalidate\(\)/);
  assert.match(invalidateSource, /setDrawModeReadyState\(false\)[\s\S]+setDrawModePreparingState\(true\)/);
  assert.match(invalidateSource, /setCommentModeReadyState\(false\)[\s\S]+setCommentModePreparingState\(true\)/);

  const refreshSource = extractNamedFunction(appSource, 'refreshMpvReviewFreezeFrameForCurrentFrame');
  assert.match(refreshSource, /runMpvReviewFreezeRefresh\(\{[\s\S]+prepareFreeze: \(\) => showMpvReviewFreezeFrame\(\)/);
  assert.match(refreshSource, /scheduleRetry: scheduleMpvReviewFreezeRefresh/);
  assert.match(refreshSource, /drawPreparationToken === drawModePreparationToken[\s\S]+setDrawModeReadyState\(true\)/);
  assert.match(refreshSource, /commentPreparationToken === commentModePreparationToken[\s\S]+setCommentModeReadyState\(true\)/);
});

test('media replacement invalidates the old freeze and requires draw readiness for the new mpv frame', () => {
  const preserveSource = extractNamedFunction(appSource, 'preserveMpvReviewFreezeFrameForMediaChange');
  assert.match(preserveSource, /mpvReviewFrameTracker\.invalidate\(\)/);
  assert.match(preserveSource, /setDrawModeReadyState\(false\)[\s\S]+setDrawModePreparingState\(true\)/);

  const showSource = extractNamedFunction(appSource, 'showMpvReviewFreezeFrame');
  assert.match(showSource, /const captureFrameSnapshot = captureCurrentMpvReviewFrameTarget\(\)/);
  assert.match(showSource, /mpvReviewFrameTracker\.isCurrent\(\s*mpvReviewFreezeFrameSnapshot/);
  assert.match(showSource, /mpvReviewFrameTracker\.isCurrent\(\s*captureFrameSnapshot/);
  assert.match(showSource, /return hadValidFrame;/);

  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  assert.match(loadMpvMatch[1], /if \(state\.isDrawMode\) \{[\s\S]+prepareMpvDrawMode\([\s\S]+if \(!reviewReady\) \{[\s\S]+cleanupPendingMpvPilot\(\)[\s\S]+throw new Error/);
});

test('failed superseding video load safely tears down a destructive review transition', () => {
  const preserveSource = extractNamedFunction(appSource, 'preserveMpvReviewFreezeFrameForMediaChange');
  assert.doesNotMatch(preserveSource, /pendingMpvReviewFreezeMediaChange/);

  const beginTransitionSource = extractNamedFunction(appSource, 'beginDestructiveMpvReviewMediaChange');
  assert.match(beginTransitionSource, /if \(activeVideoLoadToken !== loadToken\) return null;/);
  assert.match(beginTransitionSource, /pendingMpvReviewFreezeMediaChange = Object\.freeze\(\{/);
  assert.match(beginTransitionSource, /loadToken,/);
  assert.match(beginTransitionSource, /filePath: videoPlayer\.filePath \|\| state\.currentFile/);
  assert.match(beginTransitionSource, /frame: videoPlayer\.currentFrame/);

  const settleSource = extractNamedFunction(appSource, 'settlePendingMpvReviewFreezeMediaChange');
  assert.match(settleSource, /applyDrawModeState\(false\);/);
  assert.match(settleSource, /commentManager\.setCommentMode\(false\);/);
  assert.match(settleSource, /forceRemoveMpvReviewFreezeFrame\(\);/);
  assert.match(settleSource, /await stopMpvPilotEngine\(\);/);
  assert.doesNotMatch(settleSource, /setDrawModeReadyState\(true\)|mpvReviewFreezeFrameSnapshot\s*=/);

  const loadVideoSource = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function handleImportFeedbackFromVersion/);
  assert.ok(loadVideoSource, 'loadVideo should exist');
  assert.match(loadVideoSource[1], /let videoLoadCompleted = false;/);
  assert.match(loadVideoSource[1], /if \(!canContinueVideoLoad\(\)\) return false;\s+if \(!beginDestructiveMpvReviewMediaChange\(loadToken\)\) return false;\s+reviewDataManager\.pauseAutoSave\(\);/);
  assert.match(loadVideoSource[1], /videoLoadCompleted = true;[\s\S]+return true;/);
  assert.match(loadVideoSource[1], /if \(activeVideoLoadToken === loadToken\) \{[\s\S]+await settlePendingMpvReviewFreezeMediaChange\(\{ loaded: videoLoadCompleted \}\);/);
});

test('leaving draw mode forces a final mpv overlay sync so saved drawings stay visible', () => {
  const drawStateSource = extractNamedFunction(appSource, 'applyDrawModeState');
  assert.match(drawStateSource, /if \(!enabled\) \{[\s\S]+drawingManager\.commitActiveSelection\(\);[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
});

test('media change preserves an active draw freeze across mpv to mpv replacement', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];
  const preserveSource = extractNamedFunction(appSource, 'preserveMpvReviewFreezeFrameForMediaChange');

  assert.match(preserveSource, /mpvReviewFreezeElement[\s\S]+classList\.contains\('mpv-review-freeze-ready'\)/);
  assert.match(preserveSource, /mpvReviewFreezeToken \+= 1;[\s\S]+mpvReviewFreezeCaptureOwner\.cancel\(\);[\s\S]+mpvReviewFreezeRefreshScheduler\.cancel\(\);/);
  assert.match(loadVideoSource, /const shouldKeepMpvReviewFreeze = isMpvPilotPlaybackActive\(\) &&[\s\S]+state\.isDrawMode &&[\s\S]+useMpvPilot &&[\s\S]+!fileIsAudio &&[\s\S]+preserveMpvReviewFreezeFrameForMediaChange\(\);/);
  assert.match(loadVideoSource, /if \(isMpvPilotPlaybackActive\(\) && !shouldKeepMpvReviewFreeze\) \{[\s\S]+await releaseMpvReviewFreezeFrame\(\);/);
});

test('mpv review mode readiness exposes preparing state and ignores stale completion', async () => {
  const prepareMpvCommentReadiness = loadNamedFunction(appSource, 'prepareMpvCommentReadiness');
  const freeze = createDeferred();
  const readyStates = [];
  const preparingStates = [];
  let active = true;

  const readiness = prepareMpvCommentReadiness({
    prepareFreeze: () => freeze.promise,
    isStillActive: () => active,
    setReady: ready => readyStates.push(ready),
    setPreparing: preparing => preparingStates.push(preparing),
    showGuidance: () => assert.fail('stale preparation must not show guidance')
  });

  assert.deepEqual(readyStates, [false], 'input must remain disabled while mpv prepares');
  assert.deepEqual(preparingStates, [true], 'the control must visibly expose preparation');
  active = false;
  freeze.resolve(true);

  assert.equal(await readiness, false);
  assert.deepEqual(readyStates, [false], 'stale completion must not reactivate input');
  assert.deepEqual(preparingStates, [true], 'stale completion must not clear a newer mode preparation state');
});

test('comment and draw mpv controls become active only after readiness succeeds', () => {
  const commentReadySource = extractNamedFunction(appSource, 'setCommentModeReadyState');
  const commentPreparingSource = extractNamedFunction(appSource, 'setCommentModePreparingState');
  const drawReadySource = extractNamedFunction(appSource, 'setDrawModeReadyState');
  const drawPreparingSource = extractNamedFunction(appSource, 'setDrawModePreparingState');
  const drawStateSource = extractNamedFunction(appSource, 'applyDrawModeState');

  assert.match(commentReadySource, /btnAddComment\?\.classList\.toggle\('active', ready\)/);
  assert.match(commentPreparingSource, /btnAddComment\?\.classList\.toggle\('preparing', preparing\)/);
  assert.match(commentPreparingSource, /setAttribute\('aria-busy', String\(preparing\)\)/);
  assert.match(drawReadySource, /btnDrawMode\?\.classList\.toggle\('active', ready\)/);
  assert.match(drawReadySource, /drawingCanvas\?\.classList\.toggle\('active', ready\)/);
  assert.match(drawPreparingSource, /btnDrawMode\?\.classList\.toggle\('preparing', preparing\)/);
  assert.match(drawPreparingSource, /setAttribute\('aria-busy', String\(preparing\)\)/);
  assert.match(drawStateSource, /prepareMpvDrawMode\(/);
  assert.doesNotMatch(drawStateSource, /btnDrawMode\?\.classList\.toggle\('active', enabled\)/);
  assert.match(mainStyles, /\.action-btn\.preparing::after\s*\{[\s\S]+animation:\s*review-mode-preparing-spin/);
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

test('draw mode playback uses the shared review freeze only after playback stops', () => {
  assert.match(mainStyles, /\.drawing-tools\.visible\.playback-hidden \{[\s\S]*?visibility: hidden;[\s\S]*?transition: none;/);
  const timeUpdateHandler = appSource.match(/videoPlayer\.addEventListener\('timeupdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(timeUpdateHandler, 'timeupdate handler should exist');
  assert.match(
    timeUpdateHandler[1],
    /isMpvReviewInteractionActive\(\)[\s\S]*?!elements\.drawingTools\?\.classList\.contains\('playback-hidden'\)[\s\S]*?scheduleMpvReviewFreezeRefresh\(\);/
  );
  assert.match(
    appSource,
    /addEventListener\('frameUpdate'[\s\S]*?isMpvReviewInteractionActive\(\)[\s\S]*?!elements\.drawingTools\?\.classList\.contains\('playback-hidden'\)[\s\S]*?scheduleMpvReviewFreezeRefresh\(\);/
  );
  assert.match(
    appSource,
    /addEventListener\('play'[\s\S]*?mpvDrawPlaybackTransitionToken \+= 1;[\s\S]*?classList\.add\('playback-hidden'\);[\s\S]*?scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]*?releaseMpvReviewFreezeFrame\(\);/
  );
  assert.match(
    appSource,
    /addEventListener\('pause'[\s\S]*?elements\.drawingTools\?\.classList\.contains\('playback-hidden'\)[\s\S]*?restoreMpvDrawFreezeAfterPlayback\(\);/
  );
  const endedHandler = appSource.match(/videoPlayer\.addEventListener\('ended', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(endedHandler, 'ended handler should exist');
  assert.match(endedHandler[1], /elements\.drawingTools\?\.classList\.contains\('playback-hidden'\)[\s\S]*?restoreMpvDrawFreezeAfterPlayback\(\);/);
  assert.ok(
    endedHandler[1].indexOf('restoreMpvDrawFreezeAfterPlayback()') < endedHandler[1].indexOf('if (cutlistUIState.active'),
    'ended restore must precede cutlist navigation'
  );
});

test('latest draw playback transition alone may reveal the restored drawing panel', () => {
  const restoreSource = extractNamedFunction(appSource, 'restoreMpvDrawFreezeAfterPlayback');

  assert.match(restoreSource, /const restoreToken = \+\+mpvDrawPlaybackTransitionToken;/);
  assert.match(restoreSource, /const freezePrepared = await showMpvReviewFreezeFrame\(\);/);
  assert.match(restoreSource, /if \([\s\S]*?restoreToken !== mpvDrawPlaybackTransitionToken[\s\S]*?!state\.isDrawMode \|\|[\s\S]*?videoPlayer\.isPlaying[\s\S]*?\) return;/);
  assert.match(
    restoreSource,
    /if \(!freezePrepared\) \{[\s\S]*?classList\.remove\('playback-hidden'\);[\s\S]*?scheduleMpvReviewFreezeRefresh\(\);[\s\S]*?forceMpvHostVisibilitySync\(\);[\s\S]*?return false;/
  );
  assert.match(restoreSource, /classList\.remove\('playback-hidden'\);[\s\S]*?forceMpvHostVisibilitySync\(\);/);
});

test('draw playback state is cancelled before mode exit or media replacement', () => {
  const drawStateSource = extractNamedFunction(appSource, 'applyDrawModeState');
  assert.match(
    drawStateSource,
    /if \(!enabled\) \{[\s\S]*?mpvDrawPlaybackTransitionToken \+= 1;[\s\S]*?classList\.remove\('playback-hidden'\);[\s\S]*?releaseMpvReviewFreezeFrame\(\);/
  );

  const loadVideoSource = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function handleImportFeedbackFromVersion/);
  assert.ok(loadVideoSource, 'loadVideo should exist');
  assert.match(
    loadVideoSource[1],
    /activeVideoLoadPath = filePath;[\s\S]*?mpvDrawPlaybackTransitionToken \+= 1;[\s\S]*?classList\.remove\('playback-hidden'\);[\s\S]*?let videoLoadCompleted = false;/
  );
});
