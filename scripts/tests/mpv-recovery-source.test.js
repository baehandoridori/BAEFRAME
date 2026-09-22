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

test('only comment mode requires a decoded mpv freeze while Fabric owns drawing', () => {
  assert.match(appSource, /function isMpvReviewInteractionActive\(\)/);
  assert.match(appSource, /async function showMpvReviewFreezeFrame\(\)/);
  assert.match(appSource, /async function releaseMpvReviewFreezeFrame\(\)/);
  assert.match(appSource, /function scheduleMpvReviewFreezeRefresh\(\)/);
  const requiresFreezeSource = extractNamedFunction(appSource, 'requiresMpvReviewFreeze');
  for (const isCommentMode of [true, false]) {
    for (const isDrawMode of [true, false]) {
      const requiresFreeze = Function('state', `return (${requiresFreezeSource});`)({ isCommentMode, isDrawMode });
      assert.equal(requiresFreeze(), isCommentMode);
    }
  }
  assert.match(extractNamedFunction(appSource, 'prepareMpvCommentMode'), /prepareFreeze: async \(\) => \{[\s\S]+await videoPlayer\.pauseAndSync\(\);[\s\S]+if \(!isStillActive\(\)\) return false;[\s\S]+return showMpvReviewFreezeFrame\(\);/);
  assert.doesNotMatch(appSource, /function (?:applyDrawModeState|prepareMpvDrawMode|restoreMpvDrawFreezeAfterPlayback)\(/);
  assert.doesNotMatch(extractNamedFunction(appSource, 'toggleDrawMode'), /showMpvReviewFreezeFrame|enterHybridReviewEngine/);
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
  assert.match(loadMpvMatch[1], /if \(isMpvReviewInteractionActive\(\)\) \{[\s\S]*?await prepareMpvCommentMode\(preparationToken\);[\s\S]*?if \(!reviewReady\)/);
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
  const restoreIndex = releaseSource.indexOf('await applyMpvHostVisibility(true)');
  const removeFrameIndex = releaseSource.indexOf('freezeElement.remove()');
  assert.ok(removeReadyIndex >= 0 && removeReadyIndex < restoreIndex && restoreIndex < removeFrameIndex, 'release must restore native video before removing its fallback frame');
  assert.match(releaseSource, /const token = \+\+mpvReviewFreezeToken;[\s\S]+mpvReviewFreezeCaptureOwner\.cancel\(\);/);
  assert.match(releaseSource, /if \(token !== mpvReviewFreezeToken\) return;/);
  assert.match(releaseSource, /if \(!didMpvHostVisibilityApply\(result, true\)\) \{[\s\S]+return;/);
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

test('comment exit releases its mpv freeze without a legacy drawing freeze owner', () => {
  const commentHandlerStart = appSource.indexOf("  commentManager.addEventListener('commentModeChanged'");
  const commentHandlerEnd = appSource.indexOf("  commentManager.addEventListener('markerCreationStarted'", commentHandlerStart);
  const commentHandler = appSource.slice(commentHandlerStart, commentHandlerEnd);
  assert.match(commentHandler, /state\.isCommentMode = isCommentMode;[\s\S]+if \(!isMpvReviewInteractionActive\(\) && !suppressReviewFreezeReleaseForMediaChange\) \{[\s\S]+releaseMpvReviewFreezeFrame\(\)/);
  assert.match(extractNamedFunction(appSource, 'requiresMpvReviewFreeze'), /return state\.isCommentMode;/);
  assert.doesNotMatch(extractNamedFunction(appSource, 'exitDrawModeForSystemPath'), /ReviewFreeze/);
});

test('comment and draw handoffs acquire the next mode before releasing the previous mode', () => {
  const toggleDrawSource = extractNamedFunction(appSource, 'toggleDrawMode');
  const toggleCommentSource = extractNamedFunction(appSource, 'toggleCommentMode');
  const systemDrawExitSource = extractNamedFunction(appSource, 'exitDrawModeForSystemPath');

  assert.match(toggleDrawSource, /fabricDrawingPilotController\.toggle\(\)/);
  assert.doesNotMatch(toggleDrawSource, /applyDrawModeState\(true\)/);

  const commentAcquireIndex = toggleCommentSource.indexOf('commentManager.setCommentMode(true)');
  const drawReleaseIndex = toggleCommentSource.indexOf('exitDrawModeForSystemPath()');
  assert.ok(commentAcquireIndex >= 0, 'comment handoff should acquire comment mode explicitly');
  assert.ok(drawReleaseIndex > commentAcquireIndex, 'comment must own the shared freeze before draw mode turns off');
  assert.match(systemDrawExitSource, /drawingEntryRevision \+= 1;[\s\S]+state\.isDrawMode = false;/);
  assert.match(systemDrawExitSource, /if \(isFabricDrawingPilotControllerEngaged\(\)\) void fabricDrawingPilotController\.disable\(\);/);
  assert.doesNotMatch(systemDrawExitSource, /applyDrawModeState|drawingManager\./);
});

test('every comment and draw entry path enforces mutual exclusion in the central state handlers', () => {
  const commentHandlerStart = appSource.indexOf("  commentManager.addEventListener('commentModeChanged'");
  const commentHandlerEnd = appSource.indexOf("  commentManager.addEventListener('markerCreationStarted'", commentHandlerStart);
  const commentHandler = appSource.slice(commentHandlerStart, commentHandlerEnd);
  const drawStateSource = extractNamedFunction(appSource, 'toggleDrawMode');

  assert.match(commentHandler, /state\.isCommentMode = isCommentMode;[\s\S]+if \(isCommentMode\) \{[\s\S]+exitDrawModeForSystemPath\(\);/);
  assert.match(drawStateSource, /if \(state\.isCommentMode\) commentManager\.setCommentMode\(false\);/);
  assert.ok(drawStateSource.indexOf('commentManager.setCommentMode(false)') <
    drawStateSource.indexOf('fabricDrawingPilotController.toggle()'));
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
  assert.doesNotMatch(invalidateSource, /setDrawModeReadyState|setDrawModePreparingState/);
  assert.match(invalidateSource, /setCommentModeReadyState\(false\)[\s\S]+setCommentModePreparingState\(true\)/);

  const refreshSource = extractNamedFunction(appSource, 'refreshMpvReviewFreezeFrameForCurrentFrame');
  assert.match(refreshSource, /runMpvReviewFreezeRefresh\(\{[\s\S]+prepareFreeze: \(\) => showMpvReviewFreezeFrame\(\)/);
  assert.match(refreshSource, /scheduleRetry: scheduleMpvReviewFreezeRefresh/);
  assert.doesNotMatch(refreshSource, /drawPreparationToken|setDrawModeReadyState/);
  assert.match(refreshSource, /commentPreparationToken === commentModePreparationToken[\s\S]+setCommentModeReadyState\(true\)/);
});

test('media replacement invalidates the old freeze and requires comment readiness for the new mpv frame', () => {
  const releaseSource = extractNamedFunction(appSource, 'releaseMpvReviewFreezeFrame');
  assert.match(releaseSource, /\+\+mpvReviewFreezeToken;[\s\S]+mpvReviewFreezeCaptureOwner\.cancel\(\);/);
  assert.match(releaseSource, /mpvReviewFreezeFrameSnapshot = null;[\s\S]+mpvReviewTargetFrameSnapshot = null;/);

  const showSource = extractNamedFunction(appSource, 'showMpvReviewFreezeFrame');
  assert.match(showSource, /const captureFrameSnapshot = captureCurrentMpvReviewFrameTarget\(\)/);
  assert.match(showSource, /mpvReviewFrameTracker\.isCurrent\(\s*mpvReviewFreezeFrameSnapshot/);
  assert.match(showSource, /mpvReviewFrameTracker\.isCurrent\(\s*captureFrameSnapshot/);
  assert.match(showSource, /return hadValidFrame;/);

  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  assert.match(loadMpvMatch[1], /if \(state\.isCommentMode\) \{[\s\S]+prepareMpvCommentMode\([\s\S]+if \(!reviewReady\) \{[\s\S]+cleanupPendingMpvPilot\(\)[\s\S]+throw new Error/);
});

test('failed superseding video load safely tears down a destructive review transition', () => {
  assert.doesNotMatch(appSource, /function preserveMpvReviewFreezeFrameForMediaChange/);

  const beginTransitionSource = extractNamedFunction(appSource, 'beginDestructiveMpvReviewMediaChange');
  assert.match(beginTransitionSource, /if \(activeVideoLoadToken !== loadToken\) return null;/);
  assert.match(beginTransitionSource, /pendingMpvReviewFreezeMediaChange = Object\.freeze\(\{/);
  assert.match(beginTransitionSource, /loadToken,/);
  assert.match(beginTransitionSource, /filePath: videoPlayer\.filePath \|\| state\.currentFile/);
  assert.match(beginTransitionSource, /frame: videoPlayer\.currentFrame/);

  const settleSource = extractNamedFunction(appSource, 'settlePendingMpvReviewFreezeMediaChange');
  assert.match(settleSource, /if \(state\.isDrawMode \|\| isFabricDrawingPilotControllerEngaged\(\)\) \{[\s\S]+exitDrawModeForSystemPath\(\);/);
  assert.match(settleSource, /commentManager\.setCommentMode\(false\);/);
  assert.match(settleSource, /forceRemoveMpvReviewFreezeFrame\(\);/);
  assert.match(settleSource, /await stopMpvPilotEngine\(\);/);
  assert.doesNotMatch(settleSource, /setDrawModeReadyState\(true\)|mpvReviewFreezeFrameSnapshot\s*=/);

  const loadVideoSource = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function handleImportFeedbackFromVersion/);
  assert.ok(loadVideoSource, 'loadVideo should exist');
  const source = loadVideoSource[1];
  assert.match(source, /let videoLoadCompleted = false;/);
  assert.match(source, /fabricVideoChangeStarted = true;\s+const fabricReadyForVideoChange =\s+await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);\s+if \(!fabricReadyForVideoChange \|\| !canContinueVideoLoad\(\)\) return false;/);
  const destructiveIndex = source.indexOf('beginDestructiveMpvReviewMediaChange(loadToken)');
  const watchStopIndex = source.indexOf('await window.electronAPI.watchFileStop(');
  const collaborationStopIndex = source.indexOf('await liveblocksManager.stop()');
  const pauseAutoSaveIndex = source.indexOf('reviewDataManager.pauseAutoSave()');
  assert.ok(
    destructiveIndex >= 0 &&
      destructiveIndex < watchStopIndex &&
      watchStopIndex < collaborationStopIndex &&
      collaborationStopIndex < pauseAutoSaveIndex,
    'watch and collaboration teardown must run inside the destructive transition boundary'
  );
  assert.match(source, /videoLoadCompleted = true;[\s\S]+return true;/);
  assert.match(source, /const ownsActiveLoad = activeVideoLoadToken === loadToken;[\s\S]+await settlePendingMpvReviewFreezeMediaChange\(\{\s+expectedLoadToken: loadToken,\s+loaded: videoLoadCompleted \|\| \(!videoLoadCompletion\.hardInvalidated && loadIntent !== videoLoadIntentGeneration\)\s+\}\);/);
});

test('Fabric state transitions force an overlay sync and timeline refresh without committing legacy pixels', () => {
  const drawStateSource = extractNamedFunction(appSource, 'handleFabricDrawingPilotStateChange');
  assert.match(drawStateSource, /scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+renderActiveDrawingLayers\(\);/);
  assert.doesNotMatch(drawStateSource, /drawingManager\.commitActiveSelection/);
});

test('media change closes comments and releases the old freeze before clearing the review', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];
  assert.doesNotMatch(loadVideoSource, /shouldKeepMpvReviewFreeze|preserveMpvReviewFreezeFrameForMediaChange/);
  assert.match(loadVideoSource, /suppressReviewFreezeReleaseForMediaChange = true;[\s\S]+commentManager\.setCommentMode\(false\);[\s\S]+if \(isMpvPilotPlaybackActive\(\)\) \{[\s\S]+await releaseMpvReviewFreezeFrame\(\);[\s\S]+if \(!canContinueVideoLoad\(\)\) return false;[\s\S]+finally \{[\s\S]+suppressReviewFreezeReleaseForMediaChange = false;[\s\S]+commentManager\.clear\(\);/);
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
  const drawStateSource = extractNamedFunction(appSource, 'handleFabricDrawingPilotStateChange');

  assert.match(commentReadySource, /btnAddComment\?\.classList\.toggle\('active', ready\)/);
  assert.match(commentPreparingSource, /btnAddComment\?\.classList\.toggle\('preparing', preparing\)/);
  assert.match(commentPreparingSource, /setAttribute\('aria-busy', String\(preparing\)\)/);
  assert.match(drawReadySource, /btnDrawMode\?\.classList\.toggle\('active', ready\)/);
  assert.match(drawReadySource, /ready = false;/);
  assert.match(drawReadySource, /ready = false;[\s\S]+drawingCanvas\?\.classList\.toggle\('active', ready\)/);
  assert.match(drawPreparingSource, /btnDrawMode\?\.classList\.toggle\('preparing', preparing\)/);
  assert.match(drawPreparingSource, /setAttribute\('aria-busy', String\(preparing\)\)/);
  assert.match(drawStateSource, /const active = nextState === 'active';/);
  assert.match(drawStateSource, /setDrawModePreparingState\(preparing \|\| recoveringForResume\);[\s\S]+setDrawModeReadyState\(false\);[\s\S]+btnDrawMode\?\.classList\.toggle\('active', active\)/);
  assert.doesNotMatch(drawStateSource, /btnDrawMode\?\.classList\.toggle\('active', enabled\)/);
  assert.match(mainStyles, /\.action-btn\.preparing::after\s*\{[\s\S]+animation:\s*review-mode-preparing-spin/);
});

test('mpv playback is enabled by default with legacy pilot key migration', () => {
  assert.match(userSettingsSource, /mpvPlaybackEnabled: true,/);
  assert.doesNotMatch(userSettingsSource, /mpvPilotEnabled: false,/);
  assert.match(userSettingsSource, /getMpvPlaybackEnabled\(\) \{\s*return true;/);
  assert.match(userSettingsSource, /setMpvPlaybackEnabled\(_enabled\) \{[\s\S]+?this\.settings\.mpvPlaybackEnabled = true;[\s\S]+?this\._save\(\);/);
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

test('Fabric playback updates its own display without the retired drawing freeze panel', () => {
  assert.doesNotMatch(appSource, /mpvDrawPlaybackTransitionToken|restoreMpvDrawFreezeAfterPlayback|elements\.drawingTools/);
  assert.doesNotMatch(mainStyles, /\.drawing-tools\.visible\.playback-hidden/);
  const playHandler = appSource.match(/videoPlayer\.addEventListener\('play', \(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
  assert.ok(playHandler);
  assert.match(playHandler, /syncCurrentFabricDrawingDisplayFrame\(\{ force: true \}\)/);
  assert.doesNotMatch(playHandler, /showMpvReviewFreezeFrame|prepareMpvDrawMode/);
  const syncSource = extractNamedFunction(appSource, 'syncCurrentFabricDrawingDisplayFrame');
  assert.match(syncSource, /fabricDrawingPilotController\.syncDisplayFrame\(currentFrame, options\)/);
  assert.doesNotMatch(syncSource, /engine|isMpvPilotPlaybackActive/);
});

test('only the latest drawing entry may activate the current Fabric surface', () => {
  const entrySource = extractNamedFunction(appSource, 'toggleDrawMode');
  assert.match(entrySource, /const revision = \+\+drawingEntryRevision;/);
  assert.match(entrySource, /revision === drawingEntryRevision[\s\S]+filePath === state\.currentFile && intent === videoLoadIntentGeneration/);
  assert.match(entrySource, /await initializeCurrentDrawing\(\)[\s\S]+!isCurrent\(\)/);
  assert.match(entrySource, /await ensureHtml5DrawingSurface\(latestVideoLoadToken, isCurrent\)[\s\S]+!isCurrent\(\)/);
  assert.match(entrySource, /if \(!isCurrent\(\) \|\| !isCurrentDrawingSurfaceReady\(\)\) return false;/);
  assert.match(entrySource, /return await fabricDrawingPilotController\.toggle\(\);/);
});

test('drawing entry and persistence ownership are fenced before exit or media replacement', () => {
  const exitSource = extractNamedFunction(appSource, 'exitDrawModeForSystemPath');
  assert.match(exitSource, /drawingEntryRevision \+= 1;[\s\S]+state\.isDrawMode = false;[\s\S]+fabricDrawingPilotController\.disable\(\);/);
  const loadSource = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function handleImportFeedbackFromVersion/)?.[1] || '';
  assert.match(loadSource, /await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);[\s\S]+if \(!fabricReadyForVideoChange \|\| !canContinueVideoLoad\(\)\) return false;/);
  assert.match(loadSource, /await fabricDrawingPilotController\.afterVideoReady\(/);
  assert.doesNotMatch(loadSource, /mpvDrawPlaybackTransitionToken|restoreMpvDrawFreezeAfterPlayback/);
});

test('failed video loads clear the drive loading overlay in the finally block', () => {
  assert.match(
    appSource,
    /const ownsActiveLoad = activeVideoLoadToken === loadToken;[\s\S]+if \(!videoLoadCompleted && driveLoadingFeedbackShown\) \{[\s\S]+hideVideoLoadingOverlay\('drive'\);[\s\S]+\}[\s\S]+await settlePendingMpvReviewFreezeMediaChange\(\{\s+expectedLoadToken: loadToken,\s+loaded: videoLoadCompleted \|\| \(!videoLoadCompletion\.hardInvalidated && loadIntent !== videoLoadIntentGeneration\)\s+\}\);/
  );
});

test('a newer non-drive load clears stale drive loading feedback before tracing', () => {
  const loadSetupMatch = appSource.match(
    /activeVideoLoadToken = loadToken;([\s\S]*?)const trace = log\.trace\('loadVideo'\);/
  );
  assert.ok(loadSetupMatch, 'loadVideo setup before trace should exist');
  const loadSetupSource = loadSetupMatch[0];
  const tokenIndex = loadSetupSource.indexOf('activeVideoLoadToken = loadToken;');
  const showIndex = loadSetupSource.indexOf('showDriveVideoLoadingFeedback(filePath, { preparedVideoPath })');
  const overlayIndex = loadSetupSource.indexOf("const driveLoadingOverlay = document.getElementById('videoLoadingOverlay');");
  const staleDriveGuardIndex = loadSetupSource.indexOf(
    "if (!driveLoadingFeedbackShown && driveLoadingOverlay?.dataset.loadingKind === 'drive')"
  );
  const hideIndex = loadSetupSource.indexOf("hideVideoLoadingOverlay('drive');", staleDriveGuardIndex);

  assert.ok(
    tokenIndex >= 0 &&
      tokenIndex < showIndex &&
      showIndex < overlayIndex &&
      overlayIndex < staleDriveGuardIndex &&
      staleDriveGuardIndex < hideIndex,
    'the newest load should clear inherited drive feedback only after checking the live drive overlay'
  );
});
