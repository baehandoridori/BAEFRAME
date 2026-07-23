const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));

function loadFabricPilotStatusRefreshCoordinatorFactory() {
  const functionStart = appSource.indexOf('function createFabricPilotStatusRefreshCoordinator(');
  assert.notEqual(functionStart, -1, 'Fabric pilot status refresh coordinator should exist');

  const bodyStart = appSource.indexOf(') {', functionStart) + 2;
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}') depth -= 1;
    if (depth === 0) {
      const functionSource = appSource.slice(functionStart, index + 1);
      return new Function(`return (${functionSource});`)();
    }
  }

  assert.fail('Fabric pilot status refresh coordinator should have a complete body');
}

function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushCoordinator() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

test('Fabric pilot controller is initialized with live mpv video and canvas context', () => {
  assert.match(appSource, /import \{ createFabricDrawingPilotController \} from '\.\/modules\/fabric-drawing-pilot-controller\.js';/);
  assert.match(appSource, /const mpvOverlayLifecycle = createMpvOverlayLifecycle\([\s\S]+const fabricDrawingPilotController = createFabricDrawingPilotController\(\{/);
  assert.match(appSource, /getContext: getFabricDrawingPilotContext/);
  assert.match(appSource, /function getFabricDrawingPilotContext\(\) \{[\s\S]+const viewport = getFabricDrawingPilotViewport\(\);[\s\S]+isMpvActive: isMpvPilotPlaybackActive\(\),[\s\S]+isAudio: state\.isAudioMode,[\s\S]+stableVideoIdentity: videoPlayer\.filePath \|\| state\.currentFile \|\| '',[\s\S]+targetFrame: videoPlayer\.currentFrame,[\s\S]+sourceWidth: videoPlayer\.videoWidth,[\s\S]+sourceHeight: videoPlayer\.videoHeight,[\s\S]+fps: videoPlayer\.fps,[\s\S]+totalFrames: Math\.max\(1, Math\.round\(videoPlayer\.totalFrames\)\),[\s\S]+canvasRect: viewport\?\.canvasRect[\s\S]+viewportTransform:/);
  assert.match(appSource, /const fabricDrawingPilotInitialization = fabricDrawingPilotController\.initialize\(\)\.then\(enabled => \{[\s\S]+document\.body\.classList\.toggle\([\s\S]+fabric-drawing-pilot-enabled[\s\S]+enabled && fabricDrawingPilotController\.shouldOwnDrawingShortcut\(\)[\s\S]+return enabled;[\s\S]+\}\);/);
  assert.ok(
    appSource.indexOf('let fabricDrawingPilotUiEngaged = false;') <
      appSource.indexOf('const fabricDrawingPilotInitialization = fabricDrawingPilotController.initialize().then'),
    'pilot UI state must exist before asynchronous initialization can deliver state'
  );
});

test('overlay capability and real load tokens reconcile only confirmed normal video loads', () => {
  assert.match(appSource, /async function prepareMpvOverlayHost\(\) \{[\s\S]+await fabricDrawingPilotInitialization;[\s\S]+await fabricDrawingPilotController\.adoptOverlayCapability\(result\.drawingCapability\);/);
  assert.match(appSource, /activeVideoLoadToken = loadToken;\n\s+activeVideoLoadPath = filePath;\n\s+if \(!engineSwap\) \{\n\s+await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);/);
  assert.match(appSource, /await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);\n\s+if \(!canContinueVideoLoad\(\)\) \{\n\s+await fabricDrawingPilotController\.cancelVideoChange\(loadToken\);[\s\S]+activeVideoLoadToken = null;[\s\S]+activeVideoLoadPath = null;[\s\S]+return false;\n\s+\}/);
  assert.match(appSource, /if \(!engineSwap && canContinueVideoLoad\(\)\) \{[\s\S]+await fabricDrawingPilotController\.afterVideoReady\(\{[\s\S]+\.\.\.getFabricDrawingPilotContext\(\),[\s\S]+loadToken[\s\S]+\}\);/);
  assert.match(appSource, /if \(!engineSwap && !videoLoadCompleted\) \{\n\s+await fabricDrawingPilotController\.cancelVideoChange\(loadToken\);\n\s+\}/);
});

test('pilot state and B routing avoid every legacy playback and persistence mutation', () => {
  assert.match(appSource, /onStateChange: handleFabricDrawingPilotStateChange/);
  assert.match(appSource, /let fabricDrawingPilotUiEngaged = false;/);
  assert.match(appSource, /function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{/);
  const toggle = appSource.match(/function toggleDrawMode\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/)?.[1] || '';
  assert.match(toggle, /fabricDrawingPilotController\.shouldOwnDrawingShortcut\(\) &&\s+isMpvPilotPlaybackActive\(\)/);
  assert.match(toggle, /void fabricDrawingPilotController\.toggle\(\);\n\s+return;/);
  const pilotBranch = toggle.match(/if \(fabricDrawingPilotController\.shouldOwnDrawingShortcut\(\) &&\s+isMpvPilotPlaybackActive\(\)\) \{([\s\S]*?)\n\s+\}/)?.[1] || '';
  assert.doesNotMatch(pilotBranch, /videoPlayer\.pause|loadVideo|enterHybridReviewEngineIfPossible|showMpvReviewFreezeFrame|drawingManager|reviewDataManager/);
  const stateHandler = appSource.match(/function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(stateHandler, /const wasEngaged = fabricDrawingPilotUiEngaged;/);
  assert.match(stateHandler, /fabricDrawingPilotUiEngaged = engaged;/);
  assert.match(stateHandler, /state\.isDrawMode = nextState === 'active' \|\| nextState === 'preparing';/);
  assert.match(stateHandler, /setDrawModePreparingState\(/);
  assert.match(stateHandler, /setDrawModeReadyState\(false\);/);
  assert.doesNotMatch(stateHandler, /videoPlayer\.(?:play|pause|load)|loadVideo|enterHybridReviewEngineIfPossible|showMpvReviewFreezeFrame|drawingManager|reviewDataManager|\.save\(/);
});

test('capture keyboard and click firewalls stop legacy drawing mutations while keeping navigation separate', () => {
  assert.match(appSource, /if \(e\.code === 'Space' && state\.isDrawMode && !isFabricDrawingPilotEngaged\(\)\) \{/);
  assert.match(appSource, /if \(shouldIgnoreGlobalShortcutTarget\(shortcutTarget\)\) return;\n\n\s+if \(fabricDrawingPilotController\.routeKeydown\(e\)\) return;\n\s+if \(shouldBlockFabricDrawingLegacyShortcut\(e\)\) \{/);
  assert.match(appSource, /const FABRIC_DRAWING_LEGACY_SHORTCUTS = new Set\(\[[\s\S]+drawingLayerAdd[\s\S]+keyframeAddWithCopy[\s\S]+frameCopy[\s\S]+onionSkinToggle[\s\S]+drawingToolSelect[\s\S]+\]\);/);
  assert.match(appSource, /document\.addEventListener\('click', handleFabricDrawingPilotLegacyClick, true\);/);
  assert.match(appSource, /function handleFabricDrawingPilotLegacyClick\(event\) \{[\s\S]+event\.preventDefault\(\);[\s\S]+event\.stopImmediatePropagation\(\);[\s\S]+\}/);
  assert.match(appSource, /if \(shouldBlockFabricDrawingLegacyShortcut\(e\)\) \{\n\s+e\.preventDefault\(\);\n\s+e\.stopImmediatePropagation\(\);\n\s+return;\n\s+\}/);
  assert.match(appSource, /#drawingTools[\s\S]+#btnUndo[\s\S]+#btnClearDrawing[\s\S]+#btnAddLayer[\s\S]+#btnDeleteLayer[\s\S]+\.layer-settings-popup[\s\S]+\.drawing-layer-header[\s\S]+\.drawing-track-row/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode #drawingTools[\s\S]+visibility:\s*hidden;[\s\S]+pointer-events:\s*none;/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-overlay[\s\S]+visibility:\s*hidden;[\s\S]+pointer-events:\s*none(?:\s*!important)?;/);
  assert.match(appSource, /function shouldSuppressLegacyDrawingForFabricPilot\(\) \{[\s\S]+fabricDrawingPilotController\.shouldOwnDrawingShortcut\(\)[\s\S]+isMpvPilotPlaybackActive\(\)[\s\S]+\}/);
  assert.match(appSource, /const suppressLegacyDrawing = shouldSuppressLegacyDrawingForFabricPilot\(\);[\s\S]+drawingDataUrl: suppressLegacyDrawing \? '' : getCompositedDrawingOverlayDataUrl\(\),[\s\S]+onionDataUrl: !suppressLegacyDrawing && drawingManager\.onionSkin\?\.enabled/);
  assert.match(appSource, /function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(appSource, /if \(!engaged && !wasEngaged\) \{\n\s+if \(nextState === 'failed'\) notifyFabricDrawingPilotFailure\(\);\n\s+else fabricDrawingPilotFailureToastShown = false;\n\s+return;\n\s+\}/);
  assert.match(appSource, /fabricViewport:\s*getFabricDrawingPilotViewport\(\)/);
});

test('Fabric persistence is pulled after root refresh and before save, video leave, and quit dirty checks', () => {
  assert.match(
    appSource,
    /reviewDataManager\.setFinalFabricSnapshotHandler\(async \(\) => \{[\s\S]+await fabricDrawingPilotController\.preparePersistenceSnapshotForSave\(\)[\s\S]+throw new Error\('Fabric 드로잉 최신 상태를 가져오지 못했습니다\.'\);[\s\S]+\}\);/
  );

  const loadVideo = appSource.match(
    /async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 피드백 36/
  )?.[1] || '';
  const flushIndex = loadVideo.indexOf(
    'await fabricDrawingPilotController.flushPersistenceBeforeLeave()'
  );
  const beforeChangeIndex = loadVideo.indexOf(
    'await fabricDrawingPilotController.beforeVideoChange(loadToken)'
  );
  const dirtyCheckIndex = loadVideo.indexOf(
    'if (reviewDataManager.hasUnsavedChanges())'
  );
  assert.ok(flushIndex >= 0, 'video leave must pull the current overlay');
  assert.ok(flushIndex < beforeChangeIndex, 'pull must happen before Fabric input is disabled');
  assert.ok(flushIndex < dirtyCheckIndex, 'pull must happen before the dirty check');
  assert.match(
    loadVideo,
    /const fabricPersistenceReadyToLeave =\s*await fabricDrawingPilotController\.flushPersistenceBeforeLeave\(\);[\s\S]+if \(!fabricPersistenceReadyToLeave\) \{[\s\S]+showToast\('새 드로잉을 저장할 수 없어 영상 전환을 취소했습니다\.', 'error'\);[\s\S]+return false;[\s\S]+\}/
  );

  const quitHandler = appSource.match(
    /window\.electronAPI\.onRequestSaveBeforeQuit\(async \(\) => \{([\s\S]*?)\n  \}\);/
  )?.[1] || '';
  const quitFlushIndex = quitHandler.indexOf(
    'await fabricDrawingPilotController.flushPersistenceBeforeLeave()'
  );
  const quitDirtyIndex = quitHandler.indexOf(
    'if (!reviewDataManager.hasUnsavedChanges())'
  );
  assert.ok(quitFlushIndex >= 0, 'quit must pull the current overlay');
  assert.ok(quitFlushIndex < quitDirtyIndex, 'quit pull must happen before the dirty check');
  assert.match(quitHandler, /await window\.electronAPI\.cancelQuit\(\);/);
});

test('freeze and system shutdown paths are conditional on pilot ownership', () => {
  assert.match(appSource, /function requiresMpvReviewFreeze\(\) \{\n\s+return state\.isCommentMode \|\|\n\s+\(state\.isDrawMode && !fabricDrawingPilotController\.isActiveOrPreparing\(\)\);\n\s+\}/);
  assert.match(appSource, /function exitDrawModeForSystemPath\(\) \{[\s\S]+isFabricDrawingPilotControllerEngaged\(\)[\s\S]+fabricDrawingPilotController\.disable\(\)[\s\S]+applyDrawModeState\(false\);/);
  for (const eventName of ['play', 'pause', 'ended']) {
    const handler = appSource.match(new RegExp(`videoPlayer\\.addEventListener\\('${eventName}', \\(\\) => \\{([\\s\\S]*?)\\n  \\}\\);`))?.[1] || '';
    assert.match(handler, /!fabricDrawingPilotController\.isActiveOrPreparing\(\)/, `${eventName} must not enter the legacy MPV freeze path while Fabric owns drawing`);
  }
  assert.doesNotMatch(appSource, /mpv 엔진을 BAEFRAME 영상 영역에 연결했습니다|mpv 파일럿으로 원본 영상을 직접 열었습니다/);
  assert.doesNotMatch(appSource, /showToast\([^;]*(?:mpv|원본 영상)[^;]*['"]success['"]/i);
});

test('Fabric 수동 검증 HUD는 제한된 진단값을 조합하고 재생 중 250ms 안에 갱신한다', () => {
  assert.match(appSource, /const FABRIC_PILOT_STATUS_SYNC_INTERVAL_MS = 250;/);
  assert.match(appSource, /fabricDrawingPilotController\.getStatusSnapshot\(\)/);
  assert.match(appSource, /await fabricDrawingPilotController\.diagnostics\(\)/);
  assert.match(appSource, /mpvOverlayLifecycle\.captureReadyOwner\(\)/);

  const formatter = appSource.match(
    /function formatFabricPilotStatusText\(snapshot, diagnostics\) \{([\s\S]*?)\n  \}/
  )?.[1] || '';
  assert.match(formatter, /snapshot\?\.state/);
  assert.match(formatter, /bInput\?\.attempted/);
  assert.match(formatter, /bInput\?\.accepted/);
  assert.match(formatter, /snapshot\?\.inputRevision/);
  assert.match(formatter, /overlay\?\.inputRevision/);
  assert.match(formatter, /videoPlayer\.isPlaying \? 'PLAY' : 'PAUSE'/);
  assert.match(formatter, /videoPlayer\.currentFrame/);
  assert.match(formatter, /snapshot\?\.hostGeneration/);
  assert.match(formatter, /const mpvOwner = isMpvPilotPlaybackActive\(\) && videoPlayer\.isPlaying \? 1 : 0;/);
  assert.match(formatter, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(formatter, /media\.paused === false/);
  assert.match(formatter, /const playbackOwnerCount = mpvOwner \+ htmlOwner;/);
  assert.match(formatter, /owner \$\{playbackOwnerCount\}/);
  assert.match(formatter, /hostGen \$\{hostGeneration\}/);
  assert.doesNotMatch(formatter, /captureReadyOwner|owner\?\.generation|ownerGeneration|videoPlayer\.engine === 'html5'/);
  assert.match(formatter, /saveAttemptCount/);
  assert.match(formatter, /surfaceErrorCount/);
  assert.match(formatter, /\\n/);
  assert.doesNotMatch(
    formatter,
    /overlay\?\.success/,
    'an intentionally unprepared passive surface must not be counted as an error'
  );
  assert.doesNotMatch(
    formatter,
    /filePath|currentFile|comment|stroke|canvas|coordinate|sessionId|targetFrame/i,
    'HUD formatter must never include paths, comments, stroke coordinates, or session ids'
  );

  assert.match(appSource, /fabricPilotStatusText:\s*fabricDrawingPilotController\.isEnabled\(\)\s*\?\s*fabricPilotStatusText\s*:\s*''/);
  assert.match(appSource, /function scheduleFabricPilotStatusRefresh\(\{ force = false \} = \{\}\) \{[\s\S]*setTimeout\([\s\S]*FABRIC_PILOT_STATUS_SYNC_INTERVAL_MS - elapsed/s);
  assert.match(appSource, /const fabricPilotStatusRefreshCoordinator = createFabricPilotStatusRefreshCoordinator\(\{/);
  assert.match(appSource, /fabricPilotStatusRefreshCoordinator\.request\(\)/);
  assert.match(appSource, /fabricPilotStatusRefreshCoordinator\.cancel\(\)/);
  assert.doesNotMatch(appSource, /fabricPilotStatusRefreshSequence/);

  const timeUpdateHandler = appSource.match(
    /videoPlayer\.addEventListener\('timeupdate', \(e\) => \{([\s\S]*?)\n  \}\);/
  )?.[1] || '';
  const frameUpdateHandler = appSource.match(
    /videoPlayer\.addEventListener\('frameUpdate', \(e\) => \{([\s\S]*?)\n  \}\);/
  )?.[1] || '';
  assert.match(timeUpdateHandler, /scheduleFabricPilotStatusRefresh\(\);/);
  assert.match(frameUpdateHandler, /scheduleFabricPilotStatusRefresh\(\);/);

  for (const eventName of ['play', 'pause', 'ended']) {
    const handler = appSource.match(
      new RegExp(`videoPlayer\\.addEventListener\\('${eventName}', \\(\\) => \\{([\\s\\S]*?)\\n  \\}\\);`)
    )?.[1] || '';
    assert.match(
      handler,
      /scheduleFabricPilotStatusRefresh\(\{ force: true \}\);/,
      `${eventName} must refresh the HUD immediately`
    );
  }

  assert.match(appSource, /function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{[\s\S]*scheduleFabricPilotStatusRefresh\(\{ force: true \}\);/);
});

test('Fabric HUD refresh coordinator is single-flight, coalesces trailing work, and cancels stale pilot work', async () => {
  const createCoordinator = loadFabricPilotStatusRefreshCoordinatorFactory();
  const gates = [];
  const committed = [];
  let enabled = true;
  let active = 0;
  let maxConcurrency = 0;

  const coordinator = createCoordinator({
    shouldRun: () => enabled,
    run: async ({ isCurrent }) => {
      const id = gates.length + 1;
      const gate = createDeferred();
      gates.push(gate);
      active += 1;
      maxConcurrency = Math.max(maxConcurrency, active);
      await gate.promise;
      active -= 1;
      if (isCurrent()) committed.push(id);
    }
  });

  coordinator.request();
  await flushCoordinator();
  assert.equal(gates.length, 1);

  coordinator.request();
  coordinator.request();
  await flushCoordinator();
  assert.equal(gates.length, 1, 'pending requests must not overlap diagnostics');

  gates[0].resolve();
  await flushCoordinator();
  assert.equal(gates.length, 2, 'pending requests coalesce into one trailing refresh');
  assert.equal(maxConcurrency, 1);
  assert.deepEqual(committed, [], 'a newer pending request must invalidate the older HUD result');

  gates[1].resolve();
  await flushCoordinator();
  assert.deepEqual(committed, [2]);

  coordinator.request();
  await flushCoordinator();
  assert.equal(gates.length, 3);
  coordinator.request();
  enabled = false;
  coordinator.cancel();
  gates[2].resolve();
  await flushCoordinator();

  assert.equal(maxConcurrency, 1);
  assert.equal(gates.length, 3, 'cancellation must discard queued trailing work');
  assert.deepEqual(committed, [2], 'cancelled in-flight work must not commit');
  assert.equal(coordinator.request(), null, 'pilot OFF must reject new work');
});
