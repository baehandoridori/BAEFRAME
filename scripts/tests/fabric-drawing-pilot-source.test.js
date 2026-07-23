const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const fabricRuntimeSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-overlay-runtime.js'),
  'utf8'
));

test('Fabric pilot controller is initialized with live mpv video and canvas context', () => {
  assert.match(appSource, /import \{ createFabricDrawingPilotController \} from '\.\/modules\/fabric-drawing-pilot-controller\.js';/);
  assert.match(appSource, /const mpvOverlayLifecycle = createMpvOverlayLifecycle\([\s\S]+const fabricDrawingPilotController = createFabricDrawingPilotController\(\{/);
  assert.match(appSource, /getContext: getFabricDrawingPilotContext/);
  assert.match(
    appSource,
    /matchesDrawingToggleShortcut:\s*event\s*=>\s*userSettings\.matchShortcut\('drawMode', event\)/
  );
  assert.match(
    appSource,
    /matchesSelectionShortcut:\s*event\s*=>\s*userSettings\.matchShortcut\('drawingToolSelect', event\)/
  );
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
  const loadVideo = appSource.match(
    /async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 피드백 36/
  )?.[1] || '';
  const saveDecisionIndex = loadVideo.indexOf("confirm('현재 파일 저장에 실패했습니다. 저장하지 않고 전환할까요?')");
  const beforeChangeIndex = loadVideo.indexOf(
    'await fabricDrawingPilotController.beforeVideoChange(loadToken)'
  );
  const destructiveChangeIndex = loadVideo.indexOf(
    'beginDestructiveMpvReviewMediaChange(loadToken)'
  );
  const finalFlushIndex = loadVideo.indexOf(
    'const finalFabricPersistenceReadyToLeave'
  );
  const finalSaveIndex = loadVideo.indexOf(
    'const finalSavedBeforeVideoChange = await reviewDataManager.save()'
  );
  const collaborationStopIndex = loadVideo.indexOf(
    'await liveblocksManager.stop()'
  );
  assert.ok(saveDecisionIndex >= 0, 'the previous review save decision must exist');
  assert.ok(
    saveDecisionIndex < beforeChangeIndex,
    'a cancelled save decision must leave the current Fabric video lifecycle intact'
  );
  assert.ok(
    beforeChangeIndex < destructiveChangeIndex,
    'Fabric input must be fenced immediately before destructive media replacement'
  );
  assert.ok(
    beforeChangeIndex < finalFlushIndex &&
      finalFlushIndex < finalSaveIndex &&
      finalSaveIndex < destructiveChangeIndex &&
      destructiveChangeIndex < collaborationStopIndex,
    'the fenced final pull and save must complete before the destructive boundary, which must own collaboration teardown'
  );
  assert.match(
    loadVideo,
    /await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);\n\s+if \(!fabricReadyForVideoChange \|\| !canContinueVideoLoad\(\)\) return false;[\s\S]+Boolean\(beginDestructiveMpvReviewMediaChange\(loadToken\)\);\n\s+if \(!destructiveMpvReviewMediaChangeStarted\) return false;/
  );
  assert.match(
    loadVideo,
    /fabricVideoChangeStarted = true;\n\s+const fabricReadyForVideoChange =\s*await fabricDrawingPilotController\.beforeVideoChange\(loadToken\);/
  );
  assert.match(
    loadVideo,
    /if \(!engineSwap && !videoLoadCompleted && fabricVideoChangeStarted\) \{\n\s+await fabricDrawingPilotController\.cancelVideoChange\(loadToken, \{\n\s+restorePreviousVideo: !destructiveMpvReviewMediaChangeStarted/
  );
  const unconditionalCancelIndex = loadVideo.indexOf(
    'if (!engineSwap && !videoLoadCompleted && fabricVideoChangeStarted)'
  );
  const activeCleanupIndex = loadVideo.indexOf('if (activeVideoLoadToken === loadToken)');
  assert.ok(
    unconditionalCancelIndex >= 0 && unconditionalCancelIndex < activeCleanupIndex,
    'a superseded load must token-cancel its own pending Fabric transition'
  );
  assert.match(appSource, /if \(!engineSwap && canContinueVideoLoad\(\)\) \{[\s\S]+await fabricDrawingPilotController\.afterVideoReady\(\{[\s\S]+\.\.\.getFabricDrawingPilotContext\(\),[\s\S]+loadToken[\s\S]+\}\);/);
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
  assert.match(mainCss, /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode #drawingTools[\s\S]+display:\s*none;[\s\S]+pointer-events:\s*none;/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-overlay[\s\S]+visibility:\s*hidden;[\s\S]+pointer-events:\s*none(?:\s*!important)?;/);
  assert.match(
    mainCss,
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header,[\s\S]+body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-track-row[\s\S]+display:\s*none;[\s\S]+pointer-events:\s*none;/
  );
  assert.match(appSource, /function shouldSuppressLegacyDrawingForFabricPilot\(\) \{[\s\S]+fabricDrawingPilotController\.shouldOwnDrawingShortcut\(\)[\s\S]+isMpvPilotPlaybackActive\(\)[\s\S]+\}/);
  assert.match(appSource, /const suppressLegacyDrawing = shouldSuppressLegacyDrawingForFabricPilot\(\);[\s\S]+drawingDataUrl: suppressLegacyDrawing \? '' : getCompositedDrawingOverlayDataUrl\(\),[\s\S]+onionDataUrl: !suppressLegacyDrawing && drawingManager\.onionSkin\?\.enabled/);
  assert.match(appSource, /function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(appSource, /if \(!engaged && !wasEngaged\) \{\n\s+if \(nextState === 'failed'\) notifyFabricDrawingPilotFailure\(\);\n\s+else fabricDrawingPilotFailureToastShown = false;\n\s+return;\n\s+\}/);
  assert.match(appSource, /fabricViewport:\s*getFabricDrawingPilotViewport\(\)/);
});

test('Fabric persistence is pulled after root refresh and before save and video leave', () => {
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
  const finalFlushIndex = loadVideo.indexOf(
    'const finalFabricPersistenceReadyToLeave'
  );
  const finalDirtyCheckIndex = loadVideo.indexOf(
    'if (reviewDataManager.hasUnsavedChanges())',
    dirtyCheckIndex + 1
  );
  const finalSaveIndex = loadVideo.indexOf(
    'const finalSavedBeforeVideoChange = await reviewDataManager.save()'
  );
  assert.ok(flushIndex >= 0, 'video leave must pull the current overlay');
  assert.ok(flushIndex < beforeChangeIndex, 'pull must happen before Fabric input is disabled');
  assert.ok(flushIndex < dirtyCheckIndex, 'pull must happen before the dirty check');
  assert.ok(
    dirtyCheckIndex < beforeChangeIndex,
    'Fabric input must stay usable until the previous review save decision is complete'
  );
  assert.ok(
    beforeChangeIndex < finalFlushIndex &&
      finalFlushIndex < finalDirtyCheckIndex &&
      finalDirtyCheckIndex < finalSaveIndex,
    'a fenced second pull and save must catch strokes made during the first save decision'
  );
  assert.match(
    loadVideo,
    /const fabricPersistenceReadyToLeave =\s*await fabricDrawingPilotController\.flushPersistenceBeforeLeave\(\);[\s\S]+if \(!fabricPersistenceReadyToLeave\) \{[\s\S]+showToast\('새 드로잉을 저장할 수 없어 영상 전환을 취소했습니다\.', 'error'\);[\s\S]+return false;[\s\S]+\}/
  );
});

test('quit transaction disables Fabric before dirty/save decisions and resumes every cancelled quit path', () => {
  const quitHandler = appSource.match(
    /window\.electronAPI\.onRequestSaveBeforeQuit\(async \(\) => \{([\s\S]*?)\n  \}\);/
  )?.[1] || '';
  const prepareIndex = quitHandler.indexOf(
    'await fabricDrawingPilotController.preparePersistenceForQuit()'
  );
  const dirtyIndex = quitHandler.indexOf(
    'if (!reviewDataManager.hasUnsavedChanges())'
  );
  const saveIndex = quitHandler.indexOf(
    'await reviewDataManager.save()'
  );

  assert.ok(prepareIndex >= 0, 'quit must first disable Fabric input and pull its final snapshot');
  assert.ok(prepareIndex < dirtyIndex, 'quit preparation must finish before the dirty check');
  assert.ok(dirtyIndex < saveIndex, 'dirty state must be checked before a quit save');
  assert.match(
    quitHandler,
    /await fabricDrawingPilotController\.preparePersistenceForQuit\(\)[\s\S]+if \(!reviewDataManager\.hasUnsavedChanges\(\)\) \{[\s\S]+await window\.electronAPI\.confirmQuit\(\);/
  );
  assert.match(
    quitHandler,
    /await reviewDataManager\.save\(\);[\s\S]+if \(saved\) \{[\s\S]+await window\.electronAPI\.confirmQuit\(\);/
  );
  assert.match(
    quitHandler,
    /commentSync\.stop\(\);[\s\S]+drawingSync\.stop\(\);[\s\S]+try \{[\s\S]+await liveblocksManager\.stop\(\);[\s\S]+\} catch \(error\) \{[\s\S]+log\.warn\('종료 전 협업 세션 정리 실패, 로컬 저장 계속 진행'/
  );

  const cancelCalls = [
    ...quitHandler.matchAll(/await window\.electronAPI\.cancelQuit\(\);/g)
  ];
  assert.ok(cancelCalls.length > 0, 'quit handler must expose at least one cancellation path');
  for (const cancelCall of cancelCalls) {
    const cancellationPath = quitHandler.slice(
      cancelCall.index,
      cancelCall.index + 240
    );
    assert.match(
      cancellationPath,
      /await fabricDrawingPilotController\.resumeAfterQuitCancelled\(\);/,
      'every cancelQuit branch must await Fabric input restoration'
    );
  }
});

test('video teardown drains any late autosave after pausing it and before clearing review managers', () => {
  const loadVideo = appSource.match(
    /async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 피드백 36/
  )?.[1] || '';
  const pauseIndex = loadVideo.indexOf('reviewDataManager.pauseAutoSave()');
  const finalSaveDrainIndex = loadVideo.indexOf(
    'await reviewDataManager.waitForPendingSave()',
    pauseIndex
  );
  const commentClearIndex = loadVideo.indexOf('commentManager.clear()', pauseIndex);
  const drawingResetIndex = loadVideo.indexOf('drawingManager.reset()', pauseIndex);

  assert.ok(pauseIndex >= 0, 'destructive video teardown must pause autosave');
  assert.ok(
    finalSaveDrainIndex > pauseIndex,
    'a save can start during earlier async cleanup, so teardown must drain it after autosave is paused'
  );
  assert.ok(
    finalSaveDrainIndex < commentClearIndex,
    'comment data must not be cleared while an old-video save is still running'
  );
  assert.ok(
    finalSaveDrainIndex < drawingResetIndex,
    'drawing data must not be reset while an old-video save is still running'
  );
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

test('Fabric toolbar reports review persistence as active without the old session-only warning', () => {
  assert.doesNotMatch(fabricRuntimeSource, /저장 안 됨/);
  assert.doesNotMatch(fabricRuntimeSource, /시험판|시험 프레임/);
  assert.match(
    fabricRuntimeSource,
    /const FABRIC_PERSISTENCE_BADGE_PREFIX = '새 드로잉 · 리뷰 자동 저장';/
  );
  assert.match(
    fabricRuntimeSource,
    /function formatFabricPersistenceBadge\(targetFrame = null\) \{[\s\S]+FABRIC_PERSISTENCE_BADGE_PREFIX[\s\S]+프레임/
  );
});

test('stable Fabric UI does not create or poll the old manual verification HUD', () => {
  assert.doesNotMatch(appSource, /FABRIC TEST|FABRIC_PILOT_STATUS_SYNC_INTERVAL_MS/);
  assert.doesNotMatch(appSource, /fabricPilotStatusText|scheduleFabricPilotStatusRefresh/);
  assert.doesNotMatch(appSource, /createFabricPilotStatusRefreshCoordinator/);
  assert.doesNotMatch(appSource, /fabricDrawingPilotController\.(?:getStatusSnapshot|diagnostics)\(\)/);
});
