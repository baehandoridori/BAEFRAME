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
const timelineSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'renderer/scripts/modules/timeline.js'),
  'utf8'
));
const fabricPaletteSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-toolbar.js'),
  'utf8'
));
const overlayHostSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'main/mpv-overlay-host.js'),
  'utf8'
));
const pilotControllerSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'renderer/scripts/modules/fabric-drawing-pilot-controller.js'),
  'utf8'
));
const userSettingsSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'renderer/scripts/modules/user-settings.js'),
  'utf8'
));
const {
  FABRIC_DRAWING_TOOLS
} = require(path.join(rootDir, 'shared/fabric-drawing-tools.js'));
const preloadSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'preload/preload.js'),
  'utf8'
));
const ipcHandlersSource = normalizeNewlines(fs.readFileSync(
  path.join(rootDir, 'main/ipc-handlers.js'),
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
    'let finalFabricPersistenceReadyToLeave'
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
  assert.match(toggle, /if \(isMpvPilotPlaybackActive\(\) && fabricDrawingPilotController\.isEnabled\(\)\) \{/);
  assert.match(toggle, /void fabricDrawingPilotController\.toggle\(\);\n\s+return;/);
  // 가드는 상태(getState) 축으로 세운다 — shouldOwnDrawingShortcut() 단독 가드는
  // 작업 1 이후 isEnabled()와 항등이 되어 죽은 코드가 된다.
  assert.match(toggle, /const pilotState = fabricDrawingPilotController\.getState\(\);/);
  // 'failed'는 사유를 알린 뒤에도 재시도를 위해 toggle()을 이어서 호출한다
  assert.match(
    toggle,
    /if \(pilotState === 'failed'\) \{[\s\S]*?showToast\('드로잉 화면을 시작하지 못했습니다\.', 'error'\);\n\s+void fabricDrawingPilotController\.toggle\(\);\n\s+return;/
  );
  // 준비 중(소유권 미확보)은 안내만 하고 종료한다 — 레거시로 새지 않는다
  assert.match(
    toggle,
    /if \(pilotState === 'disabled' \|\|\n\s+!fabricDrawingPilotController\.shouldOwnDrawingShortcut\(\)\) \{\n\s+showToast\('드로잉 준비 중입니다\. 잠시 후 다시 시도해 주세요\.', 'warn', null, true\);\n\s+return;/
  );
  const pilotBranch = toggle.match(/if \(isMpvPilotPlaybackActive\(\) && fabricDrawingPilotController\.isEnabled\(\)\) \{([\s\S]*?)\n    \}\n/)?.[1] || '';
  assert.ok(pilotBranch.length > 0, 'mpv 파일럿 분기를 추출할 수 있어야 한다');
  assert.doesNotMatch(pilotBranch, /videoPlayer\.pause|loadVideo|enterHybridReviewEngineIfPossible|showMpvReviewFreezeFrame|drawingManager|reviewDataManager|applyDrawModeState/);
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
  assert.match(appSource, /if \(shouldIgnoreGlobalShortcutTarget\(shortcutTarget, e\)\) return;\n\n\s+if \(fabricDrawingPilotController\.routeKeydown\(e\)\) return;\n\s+if \(shouldBlockFabricDrawingLegacyShortcut\(e\)\) \{/);
  assert.match(appSource, /const FABRIC_DRAWING_LEGACY_SHORTCUTS = new Set\(\[[\s\S]+drawingLayerAdd[\s\S]+keyframeAddWithCopy[\s\S]+frameCopy[\s\S]+onionSkinToggle[\s\S]+drawingToolSelect[\s\S]+\]\);/);
  assert.match(appSource, /document\.addEventListener\('click', handleFabricDrawingPilotLegacyClick, true\);/);
  assert.match(appSource, /function handleFabricDrawingPilotLegacyClick\(event\) \{[\s\S]+event\.preventDefault\(\);[\s\S]+event\.stopImmediatePropagation\(\);[\s\S]+\}/);
  assert.match(appSource, /if \(shouldBlockFabricDrawingLegacyShortcut\(e\)\) \{\n\s+e\.preventDefault\(\);\n\s+e\.stopImmediatePropagation\(\);\n\s+return;\n\s+\}/);
  assert.match(appSource, /#drawingTools[\s\S]+#btnUndo[\s\S]+#btnClearDrawing[\s\S]+#btnAddLayer[\s\S]+#btnDeleteLayer[\s\S]+\.layer-settings-popup[\s\S]+\.drawing-layer-header[\s\S]+\.drawing-track-row/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode #drawingTools[\s\S]+display:\s*none;[\s\S]+pointer-events:\s*none;/);
  assert.match(mainCss, /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-overlay[\s\S]+visibility:\s*hidden;[\s\S]+pointer-events:\s*none(?:\s*!important)?;/);
  assert.match(
    mainCss,
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header:not\(\[data-layer-id="fabric-pilot-drawing-layer"\]\):not\(\[data-pilot-projected="true"\]\),[\s\S]+body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-track-row:not\(\[data-layer-id="fabric-pilot-drawing-layer"\]\):not\(\[data-pilot-projected="true"\]\)[\s\S]+display:\s*none;[\s\S]+pointer-events:\s*none;/
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
    'let finalFabricPersistenceReadyToLeave'
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
    /let fabricPersistenceReadyToLeave =\s*await fabricDrawingPilotController\.flushPersistenceBeforeLeave\(\);[\s\S]+if \(!fabricPersistenceReadyToLeave\) \{[\s\S]+showToast\('새 드로잉을 저장할 수 없어 영상 전환을 취소했습니다\.', 'error'\);[\s\S]+return false;[\s\S]+\}/
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

test('persistence gate abandon stays manual, load-local, and clears overlay preservation', () => {
  const loadVideo = appSource.match(
    /async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 피드백 36/
  )?.[1] || '';
  assert.match(loadVideo, /let fabricPersistenceAbandonedForThisLoad = false;/);
  assert.match(
    loadVideo,
    /if \(!fabricPersistenceReadyToLeave && !preserveContinuousSession\) \{[\s\S]+confirm\('드로잉을 저장하지 못했습니다\. 드로잉 저장을 포기하고 영상을 전환할까요\?'\)[\s\S]+abandonPersistenceForVideoChange\(\);\n\s+fabricPersistenceAbandonedForThisLoad = true;\n\s+fabricPersistenceReadyToLeave = true;/
  );
  assert.match(
    loadVideo,
    /let finalFabricPersistenceReadyToLeave = fabricPersistenceAbandonedForThisLoad;\n\s+if \(!finalFabricPersistenceReadyToLeave\) \{\n\s+finalFabricPersistenceReadyToLeave =\n\s+await fabricDrawingPilotController\.flushPersistenceBeforeLeave\(\);/
  );
  assert.match(
    loadVideo,
    /if \(!finalFabricPersistenceReadyToLeave && !preserveContinuousSession\) \{[\s\S]+confirm\('드로잉을 저장하지 못했습니다\. 드로잉 저장을 포기하고 영상을 전환할까요\?'\)[\s\S]+abandonPersistenceForVideoChange\(\);\n\s+fabricPersistenceAbandonedForThisLoad = true;\n\s+preserveAuthoritativeFabricOverlayOnCancel = false;\n\s+finalFabricPersistenceReadyToLeave = true;/
  );
  assert.doesNotMatch(loadVideo, /rearmedAfterAbandon/);
});

test('Fabric 툴바 표시는 페이드 없이 한 프레임에 완성된다', () => {
  // 툴바 opacity 트랜지션은 오버레이 창이 연속 프레임을 만들지 못해 표시를 무한 지연시킨다
  assert.doesNotMatch(fabricRuntimeSource, /transition:\s*'opacity/);
  const iifeSource = normalizeNewlines(fs.readFileSync(
    path.join(rootDir, 'renderer/scripts/lib/mpv-fabric-overlay.iife.js'),
    'utf8'
  ));
  assert.equal(iifeSource.includes('opacity 100ms ease'), false);
});

test('파일럿 드로잉은 타임라인에 이동 가능한 합성 행으로 투영된다', () => {
  assert.match(appSource, /function getFabricPilotTimelineLayers\(\)/);
  assert.match(appSource, /function renderActiveDrawingLayers\(\)/);
  assert.match(appSource, /fabricDrawingPersistenceStore\.subscribe\(\(\) => \{/);
  // 헬퍼 외부에 직접 렌더 호출이 남지 않았다 (헬퍼 내부 폴백 1건만 허용)
  const directCalls = appSource.match(
    /timeline\.renderDrawingLayers\(drawingManager\.layers, drawingManager\.activeLayerId\);/g
  ) || [];
  assert.equal(directCalls.length, 1);
  // 상태 변화 훅이 조기 반환보다 앞에서 투영을 갱신한다
  assert.match(
    appSource,
    /scheduleMpvOverlayStateSync\(\{ force: true \}\);\n\s+renderActiveDrawingLayers\(\);\n\s+if \(!engaged && !wasEngaged\) \{/
  );
  // 투영 레이어 드래그는 Fabric store 경로로 보내고, 삭제 보호는 유지한다.
  assert.match(appSource, /async function moveFabricPilotKeyframes\(/);
  assert.match(appSource, /async function handleTimelineKeyframesMove\(/);
  assert.match(
    appSource,
    /function deleteSelectedOrCurrentKeyframes\(\) \{[\s\S]{0,400}?if \(getFabricPilotTimelineLayers\(\)\) return false;/
  );
});

test('HTML5 fallback은 합성 키프레임 선택을 지운 뒤 레거시 레이어를 렌더한다', () => {
  const renderSource = appSource.match(
    /function renderActiveDrawingLayers\(\) \{[\s\S]*?\n  \}\n\n  function requiresMpvReviewFreeze/
  )?.[0]?.replace(/\n\n  function requiresMpvReviewFreeze$/, '');
  assert.ok(renderSource, 'renderActiveDrawingLayers source should be extractable');

  const legacyLayers = [{ id: 'legacy-layer' }];
  const calls = [];
  const timelineHarness = {
    selectedKeyframes: [{ layerId: 'fabric-pilot-drawing-layer', frame: 0 }],
    clearSelection() {
      calls.push('clear');
      this.selectedKeyframes = [];
    },
    renderDrawingLayers(layers, activeLayerId) {
      calls.push({ type: 'render', layers, activeLayerId });
    }
  };
  const renderActiveDrawingLayers = new Function(
    'getFabricPilotTimelineLayers',
    'timeline',
    'drawingManager',
    'fabricDrawingPersistenceStore',
    'lastFabricPilotTimelineSourceEpoch',
    'fabricDrawingPilotStatusSnapshot',
    'lastFabricPilotTimelineVideoGeneration',
    'lastFabricPilotTimelineStableVideoIdentity',
    'videoPlayer',
    'state',
    'normalizeComparableFilePath',
    `${renderSource}\nreturn renderActiveDrawingLayers;`
  )(
    () => null,
    timelineHarness,
    { layers: legacyLayers, activeLayerId: 'legacy-layer' },
    { getSourceEpoch: () => 1 },
    null,
    { videoGeneration: 1 },
    null,
    null,
    { filePath: 'C:\\videos\\a.mp4' },
    { currentFile: 'C:\\videos\\a.mp4' },
    value => String(value || '').replace(/\//g, '\\').toLowerCase()
  );

  renderActiveDrawingLayers();

  assert.deepEqual(calls, [
    'clear',
    { type: 'render', layers: legacyLayers, activeLayerId: 'legacy-layer' }
  ]);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'legacy-layer', frame: 12 }];

  renderActiveDrawingLayers();

  assert.deepEqual(calls, [
    { type: 'render', layers: legacyLayers, activeLayerId: 'legacy-layer' }
  ]);
});

test('동일 mpv 원본 복구는 선택을 유지하고 실제 소스 교체만 선택을 지운다', () => {
  const renderSource = appSource.match(
    /function renderActiveDrawingLayers\(\) \{[\s\S]*?\n  \}\n\n  function requiresMpvReviewFreeze/
  )?.[0]?.replace(/\n\n  function requiresMpvReviewFreeze$/, '');
  assert.ok(renderSource, 'renderActiveDrawingLayers source should be extractable');

  let sourceEpoch = 1;
  const statusSnapshot = { videoGeneration: 1 };
  const videoPlayerHarness = { filePath: 'C:\\videos\\a.mp4' };
  const calls = [];
  const timelineHarness = {
    selectedKeyframes: [{ layerId: 'fabric-pilot-drawing-layer', frame: 12 }],
    clearSelection() {
      calls.push('clear');
      this.selectedKeyframes = [];
    },
    renderDrawingLayers() {
      calls.push('render');
    }
  };
  const renderActiveDrawingLayers = new Function(
    'getFabricPilotTimelineLayers',
    'timeline',
    'drawingManager',
    'fabricDrawingPersistenceStore',
    'lastFabricPilotTimelineSourceEpoch',
    'fabricDrawingPilotStatusSnapshot',
    'lastFabricPilotTimelineVideoGeneration',
    'lastFabricPilotTimelineStableVideoIdentity',
    'videoPlayer',
    'state',
    'normalizeComparableFilePath',
    `${renderSource}\nreturn renderActiveDrawingLayers;`
  )(
    () => [{ id: 'fabric-pilot-drawing-layer' }],
    timelineHarness,
    { layers: [], activeLayerId: null },
    { getSourceEpoch: () => sourceEpoch },
    null,
    statusSnapshot,
    null,
    null,
    videoPlayerHarness,
    { currentFile: videoPlayerHarness.filePath },
    value => String(value || '').replace(/\//g, '\\').toLowerCase()
  );

  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);

  calls.length = 0;
  sourceEpoch = 2;
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-drawing-layer', frame: 24 }];
  videoPlayerHarness.filePath = 'C:\\videos\\b.mp4';
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['clear', 'render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-drawing-layer', frame: 36 }];
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-drawing-layer', frame: 48 }];
  statusSnapshot.videoGeneration = 2;
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['clear', 'render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-drawing-layer', frame: 60 }];
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);
  assert.match(appSource, /let lastFabricPilotTimelineVideoGeneration = null;/);
  assert.match(appSource, /let lastFabricPilotTimelineStableVideoIdentity = null;/);
});

test('읽기 전용 합성 행과 투영 행의 가시성·잠금 버튼은 숨긴다', () => {
  assert.match(
    mainCss,
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-layer-id="fabric-pilot-drawing-layer"\] \.layer-visibility,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-layer-id="fabric-pilot-drawing-layer"\] \.layer-lock,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-pilot-projected="true"\] \.layer-visibility,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-pilot-projected="true"\] \.layer-lock \{\n\s+display:\s*none;\n\s+pointer-events:\s*none;\n\}/
  );
});

test('passive 파일럿 투영은 레거시 드로잉 변이 단축키만 차단한다', () => {
  const guardSource = appSource.match(
    /function shouldBlockFabricDrawingLegacyShortcut\(event\) \{[\s\S]*?\n  \}\n\n  function handleFabricDrawingPilotLegacyClick/
  )?.[0]?.replace(/\n\n  function handleFabricDrawingPilotLegacyClick$/, '');
  assert.ok(guardSource, 'legacy shortcut guard source should be extractable');

  const actionListSource = appSource.match(
    /const FABRIC_DRAWING_LEGACY_SHORTCUTS = new Set\(\[([\s\S]*?)\n  \]\);/
  )?.[1] || '';
  const actions = [...actionListSource.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const actionSet = new Set(actions);
  let engaged = false;
  let projectionOwned = true;
  const shouldBlock = new Function(
    'FABRIC_DRAWING_LEGACY_SHORTCUTS',
    'userSettings',
    'isFabricDrawingPilotEngaged',
    'shouldSuppressLegacyDrawingForFabricPilot',
    `${guardSource}\nreturn shouldBlockFabricDrawingLegacyShortcut;`
  )(
    actionSet,
    { matchShortcut: (action, event) => action === event.action },
    () => engaged,
    () => projectionOwned
  );

  const passiveExceptions = new Set(['undo', 'redo', 'drawMode']);
  for (const action of actions) {
    assert.equal(
      shouldBlock({ action, key: '', code: '' }),
      !passiveExceptions.has(action),
      `passive projection shortcut boundary: ${action}`
    );
  }
  assert.equal(shouldBlock({ action: 'prevKeyframe', key: '', code: '' }), false);
  assert.equal(shouldBlock({ key: 'e', code: 'KeyE' }), false);

  projectionOwned = false;
  assert.equal(shouldBlock({ action: 'insertFrame', key: '', code: '' }), false);

  engaged = true;
  assert.equal(shouldBlock({ key: 'z', code: 'KeyZ', ctrlKey: true }), true);
  // engaged 상태에서도 drawMode는 통과시켜야 한다 — routeKeydown이 IME 이벤트를
  // 소비하지 못한 B가 레거시 toggleDrawMode(→ 파일럿 toggle)로 흘러가야 하기 때문.
  assert.equal(shouldBlock({ action: 'drawMode', key: '', code: '' }), false);
  // drawMode를 E로 재지정한 경우에도 KeyE 차단보다 먼저 판정돼야 한다(엣지 10 참조).
  assert.equal(shouldBlock({ action: 'drawMode', key: 'e', code: 'KeyE' }), false);
  assert.equal(shouldBlock({ action: 'insertFrame', key: '', code: '' }), true);
  assert.equal(shouldBlock({ action: 'drawingToolSelect', key: '', code: '' }), true);
});

test('집계 타임라인에서는 현재 영상의 로컬 드로잉 투영을 숨긴다', () => {
  const projectionSource = appSource.match(
    /function getFabricPilotTimelineLayers\(\) \{[\s\S]*?\n  \}\n\n  let lastFabricPilotTimeline/
  )?.[0]?.replace(/\n\n  let lastFabricPilotTimeline$/, '');
  assert.ok(projectionSource, 'timeline projection source should be extractable');

  let mpvActive = true;
  let hydrationReads = 0;
  let cutlistManagerActive = false;
  const playlistState = { mode: 'review' };
  const timelineState = {
    playlistDuration: 0,
    playlistSegments: [],
    cutlistDuration: 0,
    cutlistSegments: []
  };
  const cutlistState = { active: false };
  const getProjection = new Function(
    'fabricDrawingPilotController',
    'isMpvPilotPlaybackActive',
    'fabricDrawingPersistenceStore',
    'playlistUIState',
    'timeline',
    'cutlistUIState',
    'getCutlistManager',
    'drawingManager',
    `${projectionSource}\nreturn getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => mpvActive,
    {
      getHydrationDocument: () => {
        hydrationReads += 1;
        return { keyframes: [{ frame: 12, objects: [{}] }] };
      }
    },
    playlistState,
    timelineState,
    cutlistState,
    () => ({ isActive: () => cutlistManagerActive }),
    { layers: [] }
  );

  assert.equal(getProjection().length, 1);
  assert.equal(hydrationReads, 1);

  playlistState.mode = 'continuous';
  assert.equal(getProjection().length, 1);
  assert.equal(hydrationReads, 2);

  timelineState.playlistDuration = 30;
  timelineState.playlistSegments = [{}];
  const playlistProjection = getProjection();
  assert.deepEqual(playlistProjection, []);
  assert.equal(Boolean(playlistProjection), true);
  assert.equal(hydrationReads, 2);

  playlistState.mode = 'review';
  timelineState.playlistDuration = 0;
  timelineState.playlistSegments = [];
  cutlistState.active = true;
  assert.equal(getProjection().length, 1);
  assert.equal(hydrationReads, 3);

  cutlistManagerActive = true;
  assert.equal(getProjection().length, 1);
  assert.equal(hydrationReads, 4);

  timelineState.cutlistDuration = 30;
  timelineState.cutlistSegments = [{}];
  const cutlistProjection = getProjection();
  assert.deepEqual(cutlistProjection, []);
  assert.equal(Boolean(cutlistProjection), true);
  assert.equal(hydrationReads, 4);

  cutlistState.active = false;
  timelineState.cutlistDuration = 0;
  timelineState.cutlistSegments = [];
  mpvActive = false;
  assert.equal(getProjection(), null);
});

test('파일럿 투영 범위는 다음 exact 키프레임 직전과 영상 꼬리까지 hold한다', () => {
  const projectionSource = appSource.match(
    /function getFabricPilotTimelineLayers\(\) \{[\s\S]*?\n  \}\n\n  let lastFabricPilotTimeline/
  )?.[0]?.replace(/\n\n  let lastFabricPilotTimeline$/, '');
  assert.ok(projectionSource, 'timeline projection source should be extractable');

  const getProjection = new Function(
    'fabricDrawingPilotController',
    'isMpvPilotPlaybackActive',
    'fabricDrawingPersistenceStore',
    'playlistUIState',
    'timeline',
    'cutlistUIState',
    'getCutlistManager',
    'drawingManager',
    `${projectionSource}\nreturn getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => true,
    {
      getHydrationDocument: () => ({
        keyframes: [
          { frame: 10, objects: [{}] },
          { frame: 20, objects: [] }
        ]
      })
    },
    { mode: 'review' },
    {
      playlistDuration: 0,
      playlistSegments: [],
      cutlistDuration: 0,
      cutlistSegments: []
    },
    { active: false },
    () => ({ isActive: () => false }),
    { layers: [] }
  );

  const [layer] = getProjection();
  assert.deepEqual(
    layer.getKeyframeRanges(100).map(range => ({ start: range.start, end: range.end })),
    [
      { start: 10, end: 19 },
      { start: 20, end: 99 }
    ]
  );
  assert.equal(layer.keyframes[0].isEmpty, false);
  assert.equal(layer.keyframes[1].isEmpty, true);
  assert.equal(layer.locked, true);
  assert.equal(layer.timelineKeyframesMovable, true);
});

test('Fabric 키프레임 이동은 controller refresh 안에서 store만 바꾸고 선택과 전역 undo를 갱신한다', async () => {
  const moveSource = appSource.match(
    /async function moveFabricPilotKeyframes\(keyframes, frameDelta, anchor\) \{[\s\S]*?\n  \}\n\n  async function handleTimelineKeyframesMove/
  )?.[0]?.replace(/\n\n  async function handleTimelineKeyframesMove$/, '');
  assert.ok(moveSource, 'Fabric keyframe move source should be extractable');

  const edit = {
    schema: 'baeframe-fabric-keyframe-edit',
    kind: 'move-keyframes',
    documentId: 'app-move-document',
    before: [{ frame: 10, keyframe: { frame: 10 } }, { frame: 20, keyframe: null }],
    after: [{ frame: 10, keyframe: null }, { frame: 20, keyframe: { frame: 20 } }]
  };
  let holdRefresh = true;
  let failRefreshTail = false;
  let releaseRefresh;
  const heldRefresh = new Promise(resolve => {
    releaseRefresh = resolve;
  });
  const storeCalls = [];
  let applyAccepted = true;
  let currentDocumentId = edit.documentId;
  const store = {
    moveKeyframes(moves) {
      storeCalls.push(['move', moves]);
      return { applied: true, revision: 5, edit };
    },
    applyKeyframeEdit(receivedEdit, direction) {
      storeCalls.push(['history', receivedEdit, direction]);
      return applyAccepted
        ? { applied: true, revision: direction === 'undo' ? 6 : 7 }
        : { applied: false, reason: 'edit-state-mismatch' };
    },
    getHydrationDocument: () => currentDocumentId
      ? { documentId: currentDocumentId }
      : null
  };
  const controller = {
    async refreshPersistenceSource(installSource) {
      if (holdRefresh) {
        await heldRefresh;
        return false;
      }
      const installed = (await installSource()) !== false;
      return failRefreshTail ? false : installed;
    }
  };
  const selections = [];
  const timelineHarness = {
    setKeyframeSelection(selection, options) {
      selections.push({ selection, options });
    }
  };
  const toasts = [];
  const warnings = [];
  const displaySyncs = [];
  const actions = [];
  let renders = 0;
  const moveFabricPilotKeyframes = new Function(
    'fabricDrawingPilotController',
    'fabricDrawingPersistenceStore',
    'timeline',
    'renderActiveDrawingLayers',
    'showToast',
    'pushUndo',
    'fabricPilotKeyframeMoveInProgress',
    '_isProcessingUndo',
    'beginGlobalHistoryMutation',
    'syncCurrentFabricDrawingDisplayFrame',
    'log',
    `${moveSource}\nreturn moveFabricPilotKeyframes;`
  )(
    controller,
    store,
    timelineHarness,
    () => { renders += 1; },
    (message, level) => toasts.push([message, level]),
    action => actions.push(action),
    false,
    false,
    () => ({
      commit: action => {
        actions.push(action);
        return true;
      },
      release() {}
    }),
    options => displaySyncs.push(options),
    { warn: (...args) => warnings.push(args) }
  );
  const keyframes = [{
    layerId: 'fabric-pilot-drawing-layer',
    fromFrame: 10,
    toFrame: 20
  }];
  const anchor = { layerId: 'fabric-pilot-drawing-layer', frame: 20 };

  const heldMove = moveFabricPilotKeyframes(keyframes, 10, anchor);
  assert.equal(await moveFabricPilotKeyframes(keyframes, 10, anchor), false);
  holdRefresh = false;
  releaseRefresh();
  assert.equal(await heldMove, false);

  // installSource/store commit 이후 host re-enable tail만 실패해도 canonical move는 성공이다.
  failRefreshTail = true;
  assert.equal(await moveFabricPilotKeyframes(keyframes, 10, anchor), true);
  assert.deepEqual(storeCalls[0], ['move', [{ fromFrame: 10, toFrame: 20 }]]);
  assert.deepEqual(selections[0], {
    selection: [{ layerId: 'fabric-pilot-drawing-layer', frame: 20 }],
    options: { anchor }
  });
  assert.equal(renders, 1);
  assert.deepEqual(toasts, [['키프레임 +10 프레임 이동', 'info']]);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'FABRIC_KEYFRAME_MOVE');
  assert.equal(warnings.length, 1);
  assert.deepEqual(displaySyncs, [{ force: true }]);

  // undo도 store commit 이후 refresh tail 실패 때문에 global history가 되감기면 안 된다.
  await actions[0].undo();
  assert.equal(warnings.length, 2);
  assert.deepEqual(displaySyncs, [{ force: true }, { force: true }]);
  failRefreshTail = false;
  await actions[0].redo();
  assert.deepEqual(storeCalls.slice(1).map(call => call[2]), ['undo', 'redo']);

  applyAccepted = false;
  await assert.rejects(actions[0].undo(), /Fabric keyframe move undo failed/);

  currentDocumentId = null;
  const actionCountBeforeOwnerLoss = actions.length;
  assert.equal(await moveFabricPilotKeyframes(keyframes, 10, anchor), false);
  assert.equal(actions.length, actionCountBeforeOwnerLoss);

  // history edit가 old owner에 적용된 직후 source가 바뀌면 stack 이동은 성공하되
  // old selection/render를 새 문서에 덮어쓰지 않는다.
  applyAccepted = true;
  const selectionCountBeforeHistoryOwnerLoss = selections.length;
  const renderCountBeforeHistoryOwnerLoss = renders;
  assert.equal(await actions[0].undo(), true);
  assert.equal(selections.length, selectionCountBeforeHistoryOwnerLoss);
  assert.equal(renders, renderCountBeforeHistoryOwnerLoss);
});

test('Fabric 이동 tail 중 추가된 후속 action은 이동 뒤에 순서대로 Undo된다', async () => {
  const historyBlock = appSource.match(
    /  \/\/ ====== 글로벌 Undo\/Redo 시스템 ======\n([\s\S]*?)\n  \/\/ 마커 컨테이너 생성/
  )?.[1];
  const moveSource = appSource.match(
    /async function moveFabricPilotKeyframes\(keyframes, frameDelta, anchor\) \{[\s\S]*?\n  \}\n\n  async function handleTimelineKeyframesMove/
  )?.[0]?.replace(/\n\n  async function handleTimelineKeyframesMove$/, '');
  assert.ok(historyBlock, 'global history block should be extractable');
  assert.ok(moveSource, 'Fabric keyframe move source should be extractable');

  const deferred = () => {
    let resolve;
    const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
  };
  const committed = deferred();
  const refreshTail = deferred();
  const ownerLossCommitted = deferred();
  const ownerLossRefreshTail = deferred();
  let refreshCount = 0;
  const edit = {
    schema: 'baeframe-fabric-keyframe-edit',
    kind: 'move-keyframes',
    documentId: 'atomic-move-document'
  };
  const storeCalls = [];
  let currentDocumentId = edit.documentId;
  const store = {
    moveKeyframes(moves) {
      storeCalls.push(['move', moves]);
      return { applied: true, edit };
    },
    applyKeyframeEdit(receivedEdit, direction) {
      storeCalls.push(['history', receivedEdit, direction]);
      return { applied: true };
    },
    getHydrationDocument: () => currentDocumentId
      ? { documentId: currentDocumentId }
      : null
  };
  const controller = {
    async refreshPersistenceSource(installSource) {
      refreshCount += 1;
      const installed = (await installSource()) !== false;
      if (refreshCount === 1) {
        committed.resolve();
        await refreshTail.promise;
      } else if (refreshCount === 3) {
        ownerLossCommitted.resolve();
        await ownerLossRefreshTail.promise;
      }
      return installed;
    }
  };
  const createHarness = new Function(
    'drawingManager',
    'log',
    'showToast',
    'fabricDrawingPilotController',
    'fabricDrawingPersistenceStore',
    'timeline',
    'renderActiveDrawingLayers',
    'fabricPilotKeyframeMoveInProgress',
    'syncCurrentFabricDrawingDisplayFrame',
    `${historyBlock}\n${moveSource}\nreturn {
      pushUndo,
      globalUndo,
      moveFabricPilotKeyframes,
      getUndoStack: () => [...undoStack],
      getRedoStack: () => [...redoStack]
    };`
  );
  const harness = createHarness(
    { _createSnapshot() {}, _restoreSnapshot() {}, _emit() {} },
    { error() {}, warn() {} },
    () => {},
    controller,
    store,
    { setKeyframeSelection() {} },
    () => {},
    false,
    () => {}
  );
  let previousUndoCount = 0;
  const previousAction = {
    type: 'PREVIOUS_ACTION',
    undo: async () => { previousUndoCount += 1; },
    redo: async () => {}
  };
  harness.pushUndo(previousAction);

  const keyframes = [{
    layerId: 'fabric-pilot-drawing-layer',
    fromFrame: 10,
    toFrame: 20
  }];
  const move = harness.moveFabricPilotKeyframes(
    keyframes,
    10,
    { layerId: 'fabric-pilot-drawing-layer', frame: 20 }
  );
  await committed.promise;

  let laterUndoCount = 0;
  const laterAction = {
    type: 'LATER_EXTERNAL_ACTION',
    undo: async () => { laterUndoCount += 1; },
    redo: async () => {}
  };
  harness.pushUndo(laterAction);

  let undoSettled = false;
  const undoDuringRefreshTail = harness.globalUndo().then(result => {
    undoSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(undoSettled, false, 'Undo must wait until the committed move owns a history action');
  assert.equal(previousUndoCount, 0, 'the prior action must stay untouched during the move tail');

  refreshTail.resolve();
  assert.equal(await move, true);
  assert.equal(await undoDuringRefreshTail, true);
  assert.equal(previousUndoCount, 0);
  assert.equal(laterUndoCount, 1, 'the later external action must be undone before the move');
  assert.deepEqual(storeCalls.map(call => [call[0], call[2]]), [
    ['move', undefined]
  ]);

  assert.equal(await harness.globalUndo(), true);
  assert.deepEqual(storeCalls.map(call => [call[0], call[2]]), [
    ['move', undefined],
    ['history', 'undo']
  ]);
  assert.deepEqual(harness.getUndoStack(), [previousAction]);
  assert.deepEqual(
    harness.getRedoStack().map(action => action.type),
    ['LATER_EXTERNAL_ACTION', 'FABRIC_KEYFRAME_MOVE']
  );

  currentDocumentId = null;
  let ownerLossExternalUndoCount = 0;
  const ownerLossMove = harness.moveFabricPilotKeyframes(
    keyframes,
    10,
    { layerId: 'fabric-pilot-drawing-layer', frame: 20 }
  );
  await ownerLossCommitted.promise;
  const ownerLossExternalAction = {
    type: 'OWNER_LOSS_EXTERNAL_ACTION',
    undo: async () => { ownerLossExternalUndoCount += 1; },
    redo: async () => {}
  };
  harness.pushUndo(ownerLossExternalAction);
  const undoAfterOwnerLoss = harness.globalUndo();
  ownerLossRefreshTail.resolve();

  assert.equal(await ownerLossMove, false);
  assert.equal(await undoAfterOwnerLoss, true);
  assert.equal(ownerLossExternalUndoCount, 1);
  assert.deepEqual(harness.getUndoStack(), [previousAction]);
  assert.deepEqual(
    harness.getRedoStack().map(action => action.type),
    ['OWNER_LOSS_EXTERNAL_ACTION']
  );
});

test('전역 Undo가 진행 중이면 Fabric 이동은 store를 commit하지 않고 기존 action을 보존한다', async () => {
  const historyBlock = appSource.match(
    /  \/\/ ====== 글로벌 Undo\/Redo 시스템 ======\n([\s\S]*?)\n  \/\/ 마커 컨테이너 생성/
  )?.[1];
  const moveSource = appSource.match(
    /async function moveFabricPilotKeyframes\(keyframes, frameDelta, anchor\) \{[\s\S]*?\n  \}\n\n  async function handleTimelineKeyframesMove/
  )?.[0]?.replace(/\n\n  async function handleTimelineKeyframesMove$/, '');
  assert.ok(historyBlock, 'global history block should be extractable');
  assert.ok(moveSource, 'Fabric keyframe move source should be extractable');

  let rejectUndo;
  let notifyUndoStarted;
  const undoStarted = new Promise(resolve => { notifyUndoStarted = resolve; });
  const heldUndo = new Promise((_resolve, reject) => { rejectUndo = reject; });
  const edit = {
    schema: 'baeframe-fabric-keyframe-edit',
    kind: 'move-keyframes',
    documentId: 'inverse-race-document'
  };
  const storeCalls = [];
  const store = {
    moveKeyframes(moves) {
      storeCalls.push(['move', moves]);
      return { applied: true, edit };
    },
    applyKeyframeEdit() {
      storeCalls.push(['history']);
      return { applied: true };
    },
    getHydrationDocument: () => ({ documentId: edit.documentId })
  };
  const createHarness = new Function(
    'drawingManager',
    'log',
    'showToast',
    'fabricDrawingPilotController',
    'fabricDrawingPersistenceStore',
    'timeline',
    'renderActiveDrawingLayers',
    'fabricPilotKeyframeMoveInProgress',
    'syncCurrentFabricDrawingDisplayFrame',
    `${historyBlock}\n${moveSource}\nreturn {
      pushUndo,
      globalUndo,
      moveFabricPilotKeyframes,
      getUndoStack: () => [...undoStack],
      getRedoStack: () => [...redoStack]
    };`
  );
  const harness = createHarness(
    { _createSnapshot() {}, _restoreSnapshot() {}, _emit() {} },
    { error() {}, warn() {} },
    () => {},
    { refreshPersistenceSource: async installSource => (await installSource()) !== false },
    store,
    { setKeyframeSelection() {} },
    () => {},
    false,
    () => {}
  );
  const previousAction = {
    type: 'PREVIOUS_ACTION',
    undo: () => {
      notifyUndoStarted();
      return heldUndo;
    },
    redo: async () => {}
  };
  harness.pushUndo(previousAction);

  const inFlightUndo = harness.globalUndo();
  await undoStarted;
  const moveResult = await harness.moveFabricPilotKeyframes(
    [{
      layerId: 'fabric-pilot-drawing-layer',
      fromFrame: 10,
      toFrame: 20
    }],
    10,
    { layerId: 'fabric-pilot-drawing-layer', frame: 20 }
  );
  rejectUndo(new Error('expected in-flight undo failure'));

  assert.equal(await inFlightUndo, false);
  assert.equal(moveResult, false);
  assert.deepEqual(storeCalls, []);
  assert.deepEqual(harness.getUndoStack(), [previousAction]);
  assert.deepEqual(harness.getRedoStack(), []);
});

test('timeline move router sends only the synthetic layer to Fabric and preserves the legacy route', async () => {
  const handlerSource = appSource.match(
    /async function handleTimelineKeyframesMove\(detail = \{\}\) \{[\s\S]*?\n  \}\n\n  \/\/ 키프레임 이동\n  timeline\.addEventListener\('keyframesMove'/
  )?.[0]?.replace(/\n\n  \/\/ 키프레임 이동\n  timeline\.addEventListener\('keyframesMove'$/, '');
  assert.ok(handlerSource, 'timeline keyframe move handler should be extractable');

  const routes = [];
  const selections = [];
  const warnings = [];
  const handler = new Function(
    'classifyFabricPilotKeyframeMove',
    'moveFabricPilotKeyframes',
    'drawingManager',
    'timeline',
    'renderActiveDrawingLayers',
    'showToast',
    'log',
    `${handlerSource}\nreturn handleTimelineKeyframesMove;`
  )(
    keyframes => {
      const fabricCount = keyframes.filter(
        keyframe => keyframe.layerId === 'fabric-pilot-drawing-layer'
      ).length;
      if (fabricCount === 0) return 'legacy';
      return fabricCount === keyframes.length ? 'fabric' : 'mixed';
    },
    async (...args) => {
      routes.push(['fabric', ...args]);
      return true;
    },
    {
      moveKeyframes(keyframes) {
        routes.push(['legacy', keyframes]);
        return true;
      }
    },
    {
      setKeyframeSelection(selection, options) {
        selections.push({ selection, options });
      }
    },
    () => routes.push(['render']),
    (message, level) => routes.push(['toast', message, level]),
    { warn: (...args) => warnings.push(args) }
  );

  const fabricMove = [{
    layerId: 'fabric-pilot-drawing-layer',
    fromFrame: 10,
    toFrame: 20
  }];
  assert.equal(await handler({ keyframes: fabricMove, frameDelta: 10, anchor: null }), true);
  assert.equal(routes.some(([route]) => route === 'legacy'), false);

  routes.length = 0;
  const mixedMove = [
    fabricMove[0],
    { layerId: 'legacy-layer', fromFrame: 30, toFrame: 40 }
  ];
  assert.equal(await handler({ keyframes: mixedMove, frameDelta: 10, anchor: null }), false);
  assert.deepEqual(routes, []);
  assert.equal(warnings.length, 1);

  routes.length = 0;
  const legacyMove = [{ layerId: 'legacy-layer', fromFrame: 2, toFrame: 4 }];
  const legacyAnchor = { layerId: 'legacy-layer', frame: 4 };
  assert.equal(await handler({
    keyframes: legacyMove,
    frameDelta: 2,
    anchor: legacyAnchor
  }), true);
  assert.deepEqual(routes[0], ['legacy', legacyMove]);
  assert.deepEqual(selections.at(-1), {
    selection: [{ layerId: 'legacy-layer', frame: 4 }],
    options: { anchor: legacyAnchor }
  });
});

test('primary play handler force-syncs the current Fabric display frame exactly once at start', () => {
  const playHandlerSource = appSource.match(
    /\/\/ 비디오 재생 상태 변경\n  videoPlayer\.addEventListener\('play', \(\) => \{([\s\S]*?)\n  \}\);\n\n  videoPlayer\.addEventListener\('pause'/
  )?.[1] || '';
  assert.ok(playHandlerSource, 'primary video play handler source should be extractable');

  const displaySyncCalls = playHandlerSource.match(
    /syncCurrentFabricDrawingDisplayFrame\([^;]*\);/g
  ) || [];
  assert.equal(displaySyncCalls.length, 1);
  assert.match(
    playHandlerSource,
    /^\s*syncCurrentFabricDrawingDisplayFrame\(\{ force: true \}\);/
  );
});

test('playback frame consumers and passive landings request the current Fabric display frame', () => {
  const playbackSyncSource = appSource.match(
    /function syncPlaybackPositionUI\(currentTime, currentFrame, options = \{\}\) \{[\s\S]*?\n  \}\n\n  function syncCompositionLayerPlaybackState/
  )?.[0] || '';
  assert.match(
    playbackSyncSource,
    /if \(shouldSyncFrameConsumers\) \{[\s\S]*?fabricDrawingPilotController\.syncDisplayFrame\(currentFrame\)/
  );
  assert.match(
    appSource,
    /fabricDrawingPersistenceStore\.subscribe\(\(\) => \{[\s\S]*?syncCurrentFabricDrawingDisplayFrame\(\)/
  );
  assert.match(
    appSource,
    /function handleFabricDrawingPilotStateChange\(nextState, snapshot\) \{[\s\S]*?if \(nextState === 'passive'\)[\s\S]*?syncCurrentFabricDrawingDisplayFrame\(\)/
  );
});

test('집계 모드 전환은 드로잉 투영 캐시를 즉시 다시 그린다', () => {
  const resetPlaylistSource = appSource.match(
    /function resetPlaylistContinuousTimelineState\(\) \{[\s\S]*?\n  \}\n\n  function beginPlaylistReplacement/
  )?.[0] || '';
  assert.match(
    resetPlaylistSource,
    /timeline\.clearPlaylistTimeline\(\);[\s\S]*renderActiveDrawingLayers\(\);/
  );

  const updatePlaylistSource = appSource.match(
    /async function updatePlaylistContinuousTimeline\(\) \{[\s\S]*?\n  \}\n\n  async function quickCheckPlaylistForContinuous/
  )?.[0] || '';
  assert.match(
    updatePlaylistSource,
    /timeline\.setPlaylistTimeline\(segments, totalDuration\);[\s\S]*renderActiveDrawingLayers\(\);/
  );

  const playlistModeSource = appSource.match(
    /function setPlaylistMode\(mode\) \{[\s\S]*?\n  \}\n\n  function exitPlaylistContinuousModeForCutlist/
  )?.[0] || '';
  assert.match(
    playlistModeSource,
    /playlistUIState\.mode = nextMode;[\s\S]*renderActiveDrawingLayers\(\);/
  );

  const showCutlistSource = appSource.match(
    /function showCutlistSidebar\(\) \{[\s\S]*?\n  \}\n\n  function hideCutlistSidebar/
  )?.[0] || '';
  assert.match(
    showCutlistSource,
    /cutlistUIState\.active = true;[\s\S]*renderActiveDrawingLayers\(\);/
  );

  const hideCutlistSource = appSource.match(
    /function hideCutlistSidebar\(\) \{[\s\S]*?\n  \}\n\n  function updateCutlistUI/
  )?.[0] || '';
  assert.match(
    hideCutlistSource,
    /cutlistUIState\.active = false;[\s\S]*renderActiveDrawingLayers\(\);/
  );

  const updateCutlistSource = appSource.match(
    /function updateCutlistTimeline\(\) \{[\s\S]*?\n  \}\n\n  async function updateCutlistAggregateComments/
  )?.[0] || '';
  assert.equal(
    (updateCutlistSource.match(/renderActiveDrawingLayers\(\);/g) || []).length,
    2
  );
});

test('레거시 드로잉은 파일럿 소유 중에도 읽기 전용 행으로 투영된다', () => {
  const projectionSource = appSource.match(
    /function getFabricPilotTimelineLayers\(\) \{[\s\S]*?\n  \}\n\n  let lastFabricPilotTimeline/
  )?.[0]?.replace(/\n\n  let lastFabricPilotTimeline$/, '');
  assert.ok(projectionSource, 'timeline projection source should be extractable');

  const legacyRanges = [{ start: 4, end: 9, keyframe: { frame: 4, isEmpty: false } }];
  const legacyLayers = [
    {
      id: 'layer-legacy-1',
      name: '레이어 1',
      color: '#ff8a00',
      visible: true,
      locked: false,
      opacity: 0.5,
      keyframes: [{ frame: 4, isEmpty: false }],
      getKeyframeRanges: () => legacyRanges
    },
    {
      id: 'layer-empty',
      name: '레이어 2',
      color: '#00ff00',
      visible: true,
      locked: false,
      opacity: 1,
      keyframes: [{ frame: 7, isEmpty: true }],
      getKeyframeRanges: () => []
    }
  ];
  let hydrationDocument = { keyframes: [{ frame: 12, objects: [{}] }] };
  const getProjection = new Function(
    'fabricDrawingPilotController',
    'isMpvPilotPlaybackActive',
    'fabricDrawingPersistenceStore',
    'playlistUIState',
    'timeline',
    'cutlistUIState',
    'getCutlistManager',
    'drawingManager',
    `${projectionSource}\nreturn getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => true,
    { getHydrationDocument: () => hydrationDocument },
    { mode: 'review' },
    {
      playlistDuration: 0,
      playlistSegments: [],
      cutlistDuration: 0,
      cutlistSegments: []
    },
    { active: false },
    () => ({ isActive: () => false }),
    { layers: legacyLayers }
  );

  const layers = getProjection();
  assert.equal(layers.length, 2);
  assert.equal(layers[0].id, 'fabric-pilot-drawing-layer');

  const projected = layers[1];
  assert.equal(projected.id, 'layer-legacy-1');
  assert.equal(projected.name, '레이어 1');
  assert.equal(projected.color, '#ff8a00');
  assert.equal(projected.opacity, 0.5);
  assert.equal(projected.visible, true);
  assert.equal(projected.locked, true);
  assert.equal(projected.pilotProjected, true);
  assert.equal(projected.timelineKeyframesMovable, false);
  assert.deepEqual(projected.keyframes, [{ frame: 4, isEmpty: false }]);
  assert.equal(projected.getKeyframeRanges(100), legacyRanges);

  // 빈 키프레임만 가진 레거시 레이어는 행을 만들지 않는다
  assert.equal(layers.some(layer => layer.id === 'layer-empty'), false);

  // store가 아직 hydrate되지 않아도 소유를 놓지 않고 레거시 행만 투영한다
  hydrationDocument = null;
  const withoutStore = getProjection();
  assert.equal(Array.isArray(withoutStore), true);
  assert.equal(withoutStore.length, 1);
  assert.equal(withoutStore[0].id, 'layer-legacy-1');
});

test('mpv 재생 중 B는 소유 실패에도 레거시 그리기로 폴백하지 않는다', () => {
  const toggleSource = appSource.match(
    /function toggleDrawMode\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/
  )?.[1] || '';
  assert.ok(toggleSource, 'toggleDrawMode source should be extractable');

  const pilotGateIndex = toggleSource.indexOf(
    'if (isMpvPilotPlaybackActive() && fabricDrawingPilotController.isEnabled()) {'
  );
  const legacyEnableIndex = toggleSource.indexOf('applyDrawModeState(true)');
  assert.ok(pilotGateIndex >= 0, 'mpv 재생 중 파일럿 게이트가 존재해야 한다');
  assert.ok(
    pilotGateIndex < legacyEnableIndex,
    '레거시 진입은 mpv 파일럿 게이트를 통과한 뒤에만 도달해야 한다'
  );
  assert.match(
    toggleSource,
    /const pilotState = fabricDrawingPilotController\.getState\(\);\n\s+if \(pilotState === 'failed'\) \{/
  );
});

test('투영된 레거시 행은 읽기 전용 표식을 달고 편집 핸들러를 붙이지 않는다', () => {
  assert.match(
    timelineSource,
    /if \(layer\.pilotProjected === true\) \{\n\s+header\.dataset\.pilotProjected = 'true';\n\s+this\.layerHeaders\.appendChild\(header\);\n\s+return;\n\s+\}/
  );
  assert.match(
    timelineSource,
    /if \(layer\.pilotProjected === true\) trackRow\.dataset\.pilotProjected = 'true';/
  );

  const headerSource = timelineSource.match(
    /_renderLayerHeader\(layer, isActive\) \{[\s\S]*?\n  \}\n\n  \/\*\*/
  )?.[0] || '';
  assert.ok(headerSource, 'layer header renderer should be extractable');
  const projectedGuardIndex = headerSource.indexOf('if (layer.pilotProjected === true) {');
  const selectIndex = headerSource.indexOf("this._emit('layerSelect'");
  const contextMenuIndex = headerSource.indexOf("addEventListener('contextmenu'");
  assert.ok(projectedGuardIndex > 0, '읽기 전용 가드가 존재해야 한다');
  assert.ok(
    projectedGuardIndex < selectIndex && projectedGuardIndex < contextMenuIndex,
    '읽기 전용 투영 행은 선택·우클릭 핸들러 등록 전에 반환되어야 한다'
  );

  // 잠긴 투영 행의 키프레임은 기존 이동 판정에서 계속 차단된다
  assert.match(
    timelineSource,
    /return layer\.locked !== true \|\| layer\.timelineKeyframesMovable === true;/
  );
});

test('B 토글 상태기계는 정착 지점마다 예약을 소비하고 창 순서를 대칭으로 복원한다', () => {
  const controllerSource = normalizeNewlines(fs.readFileSync(
    path.join(rootDir, 'renderer/scripts/modules/fabric-drawing-pilot-controller.js'),
    'utf8'
  ));
  const overlayHostSource = normalizeNewlines(fs.readFileSync(
    path.join(rootDir, 'main/mpv-overlay-host.js'),
    'utf8'
  ));

  // 예약 소비는 단일 함수로만 존재한다
  assert.match(controllerSource, /function consumePendingResumeRequest\(/);
  assert.match(
    controllerSource,
    /if \(canResume\) return startEnable\(enableContext, isStillCurrent, onInputFailure\);/
  );
  assert.match(controllerSource, /resumeRequested = false;\n\s+syncExplicitResumeIntent\(\);/);

  // 정착 지점 1: reconcileCurrentVideo — 수화 실패 취소와 재개 소비 둘 다
  const reconcileSource = controllerSource.match(
    /\n  async function reconcileCurrentVideo\([\s\S]*?\n  \}\n/
  )?.[0] || '';
  assert.notEqual(reconcileSource, '');
  assert.match(reconcileSource, /consumePendingResumeRequest\(\s*enableContext/);
  // allowResume:false 호출은 settleState를 넘기지 않고, 정착은 뒤따르는 setState가 맡는다
  assert.match(reconcileSource, /allowResume: false\n\s+\}\);\n\s+setState\('passive'\);/);
  assert.doesNotMatch(
    reconcileSource,
    /if \(shouldResume \|\| resumeRequested\) \{\n\s+return startEnable\(/
  );

  // 정착 지점 2: runPersistenceSourceRefresh finally (quit 유예는 제외)
  const refreshSource = controllerSource.match(
    /\n  async function runPersistenceSourceRefresh\([\s\S]*?\n  \}\n/
  )?.[0] || '';
  assert.notEqual(refreshSource, '');
  assert.match(
    refreshSource,
    /persistenceSourceRefreshInProgress = false;[\s\S]*?persistenceQuitSuspension === null &&[\s\S]*?consumePendingResumeRequest\(/
  );

  // 정착 지점 3: cancelVideoChange 롤백 복구
  const cancelSource = controllerSource.match(
    /\n  async function cancelVideoChange\([\s\S]*?\n  \}\n/
  )?.[0] || '';
  assert.notEqual(cancelSource, '');
  assert.match(cancelSource, /consumePendingResumeRequest\(rollback\.context, isStillCurrent/);
  assert.doesNotMatch(cancelSource, /return startEnable\(rollback\.context, isStillCurrent\);/);

  // preparing 고착 해소
  const startEnableSource = controllerSource.match(
    /\n  async function startEnable\([\s\S]*?\n  \}\n/
  )?.[0] || '';
  assert.notEqual(startEnableSource, '');
  assert.match(
    startEnableSource,
    /if \(!stillCurrent\) \{[\s\S]*?state === 'preparing' && currentSession\?\.sessionId === session\.sessionId[\s\S]*?setState\('passive'\);/
  );

  // B 키 경로는 toggle 이전에 상태를 선발행하지 않는다
  const routeKeydownSource = controllerSource.match(
    /\n  function routeKeydown\(event = \{\}\) \{[\s\S]*?\n  \}\n/
  )?.[0] || '';
  assert.notEqual(routeKeydownSource, '');
  assert.match(
    routeKeydownSource,
    /bInputAttempted \+= 1;\n(?:\s*\/\/[^\n]*\n)*\s+runDetached\(Promise\.resolve\(toggle\(\)\)/
  );

  // 오버레이 호스트: 모든 disable 요청이 창 순서를 복원한다
  const setDrawingInputSource = overlayHostSource.match(
    /\n  async setDrawingInput\(\) \{[\s\S]*?\n  \}\n/
  )?.[0] || '';
  assert.notEqual(setDrawingInputSource, '');
  assert.match(
    setDrawingInputSource,
    /if \(!request\.enabled && this\.fabricReadyGeneration !== this\.hostGeneration\) \{[\s\S]*?hostWindow\.moveTop\?\.\(\);[\s\S]*?return \{ success: true, accepted: true, enabled: false, fabricReady: false \};/
  );
  // runtime 준비 실패 disable도 창 순서를 복원한다 (h-2)
  assert.match(
    setDrawingInputSource,
    /if \(!prepared\.success\) \{\n\s+if \(!request\.enabled\) \{[\s\S]*?hostWindow\.moveTop\?\.\(\);[\s\S]*?return \{ success: true, accepted: true, enabled: false, fabricReady: false \};/
  );
  assert.match(setDrawingInputSource, /if \(!request\.enabled && stillCurrent\) \{/);
  assert.doesNotMatch(
    setDrawingInputSource,
    /if \(!request\.enabled && runtimeResult\?\.accepted === true && stillCurrent\) \{/
  );
  // restack 지점은 정확히 세 곳이다
  assert.equal(
    (setDrawingInputSource.match(/hostWindow\.moveTop\?\.\(\);/g) || []).length,
    3
  );

  // 실패 안내 래치는 활성 진입에서 해제된다
  assert.match(
    appSource,
    /const active = nextState === 'active';\n\s+\/\/[^\n]*\n\s+if \(active\) fabricDrawingPilotFailureToastShown = false;/
  );
});

test('오버레이 드로잉 UI는 상단 탭이 아니라 드래그형 팔레트로 조립된다', () => {
  // 프로토타입 상단 탭 조립부가 남아 있지 않다
  assert.doesNotMatch(fabricRuntimeSource, /createButton\('Brush', 'brush'\)/);
  assert.doesNotMatch(fabricRuntimeSource, /createButton\('V', 'select'\)/);
  assert.doesNotMatch(fabricRuntimeSource, /toolbar\.appendChild\(/);

  assert.match(
    fabricRuntimeSource,
    /const \{\n  createFabricDrawingPalette\n\} = require\('\.\/mpv-fabric-toolbar\.js'\);/
  );
  assert.match(fabricRuntimeSource, /toolbar\.className = 'mpv-fabric-pilot-toolbar';/);
  assert.match(
    fabricRuntimeSource,
    /paletteShell = createFabricDrawingPalette\(\{\n\s+documentRef,\n\s+windowRef,\n\s+element: toolbar,\n\s+setStyles,\n\s+addDomListener,\n\s+sections: \[/
  );
  // 도구가 8종으로 늘어 한 줄 리터럴이 아니게 됐다. 섹션이 존재하고 도구 버튼을
  // 모두 담는다는 계약은 그대로다.
  assert.match(
    fabricRuntimeSource,
    /id: 'tools',\n\s+label: '도구',\n\s+items: \[\n\s+brushButton, penButton, eraserButton, lineButton,\n\s+rectButton, circleButton, arrowButton, selectButton\n\s+\]/
  );
  assert.match(
    fabricRuntimeSource,
    /\{ id: 'selection', items: \[selectionControls\.group\] \}/
  );
  assert.match(
    fabricRuntimeSource,
    /id: 'brush',\n\s+label: '브러시 설정',\n\s+items: \[brushControls\.settingsButton\],\n\s+appended: \[brushControls\.panel\]/
  );
  assert.match(
    fabricRuntimeSource,
    /id: 'actions',\n\s+label: '편집',\n\s+items: \[undoButton, redoButton, deleteButton, clearButton\]/
  );
  assert.match(fabricRuntimeSource, /\{ id: 'status', items: \[badge\] \}/);
  assert.match(fabricRuntimeSource, /root\.appendChild\(container\);\n\s+paletteShell\.restore\(\);/);
  assert.match(fabricRuntimeSource, /^\s+let paletteShell = null;$/m);
  assert.match(fabricRuntimeSource, /toolbar = null;\n\s+paletteShell = null;/);

  // 도구 라벨은 한글이고 기존 접근성 라벨은 그대로 유지된다
  assert.match(fabricRuntimeSource, /createButton\('브러시', 'brush'\), '브러시 도구 \(B\)'/);
  assert.match(fabricRuntimeSource, /createButton\('선택', 'select'\), '선택 도구 \(V\)'/);
  assert.match(fabricRuntimeSource, /createButton\('실행 취소', 'undo'\), '실행 취소 \(Ctrl\+Z\)'/);
  assert.match(fabricRuntimeSource, /createButton\('다시 실행', 'redo'\), '다시 실행 \(Ctrl\+Y\)'/);
  assert.match(fabricRuntimeSource, /createButton\('선택 삭제', 'delete-selection'\)/);
  assert.match(fabricRuntimeSource, /createButton\('전체 지우기', 'clear-session'\)/);

  // setSurfaceInput 계약은 그대로다
  assert.match(
    fabricRuntimeSource,
    /function setSurfaceInput\(enabled\) \{[\s\S]+setStyles\(toolbar, \{\n\s+pointerEvents,\n\s+visibility: enabled \? 'visible' : 'hidden',\n\s+opacity: enabled \? '1' : '0'\n\s+\}\);/
  );

  // 브러시 설정 패널은 드롭다운이 아니라 팔레트 인라인이다
  assert.doesNotMatch(fabricRuntimeSource, /top: 'calc\(100% \+ 6px\)'/);
  assert.match(
    fabricRuntimeSource,
    /panel\.dataset\.fabricPilotPanel = 'brush-settings';[\s\S]+position: 'static',\n\s+width: '100%',\n\s+maxHeight: '210px',\n\s+overflowY: 'auto',\n\s+overscrollBehavior: 'contain',/
  );
});

test('팔레트 모듈은 레거시 헤더·접기·경계 클램프·안전한 저장을 갖춘다', () => {
  assert.match(fabricPaletteSource, /^'use strict';$/m);
  assert.match(
    fabricPaletteSource,
    /const PALETTE_STORAGE_KEY = 'baeframe\.mpvFabricPalette\.v1';/
  );
  assert.match(fabricPaletteSource, /const PALETTE_MARGIN = 12;/);
  assert.match(
    fabricPaletteSource,
    /header\.className = 'mpv-fabric-pilot-toolbar-header';/
  );
  assert.match(fabricPaletteSource, /title\.textContent = '그리기 도구';/);
  assert.match(
    fabricPaletteSource,
    /collapseButton\.dataset\.fabricPilotAction = 'toggle-collapse';/
  );
  assert.match(
    fabricPaletteSource,
    /content\.className = 'mpv-fabric-pilot-toolbar-content';/
  );
  assert.match(
    fabricPaletteSource,
    /element\.dataset\.collapsed = String\(state\.collapsed\);/
  );
  assert.match(
    fabricPaletteSource,
    /function clampPalettePosition\(position, viewport, size\) \{[\s\S]+Math\.min\(Math\.max\(PALETTE_MARGIN, position\.left\), maxLeft\)/
  );
  // 저장 실패가 팔레트 조작을 막아서는 안 된다
  assert.match(
    fabricPaletteSource,
    /function readStoredPaletteState\(windowRef\) \{[\s\S]+try \{[\s\S]+localStorage\?\.getItem\?\.\(PALETTE_STORAGE_KEY\)[\s\S]+\} catch \(_error\) \{/
  );
  assert.match(
    fabricPaletteSource,
    /function writeStoredPaletteState\(windowRef, state\) \{[\s\S]+try \{[\s\S]+localStorage\?\.setItem\?\.\([\s\S]+\} catch \(_error\) \{/
  );
  assert.match(fabricPaletteSource, /try \{\n\s+header\.setPointerCapture\?\.\(event\.pointerId\);\n\s+\} catch \(_error\) \{/);
  assert.match(
    fabricPaletteSource,
    /module\.exports = \{\n\s+createFabricDrawingPalette,\n\s+clampPalettePosition,\n\s+normalizePaletteState,\n\s+PALETTE_STORAGE_KEY,\n\s+PALETTE_MARGIN\n\};/
  );
});

test('키프레임 이동 단축키는 소유자에 맞는 데이터 출처를 고른다', () => {
  const source = appSource.match(
    /function getAdjacentDrawingKeyframeFrame\(direction\) \{[\s\S]*?\n  \}\n\n  function shouldSuppressLegacyDrawingForFabricPilot/
  )?.[0]?.replace(/\n\n  function shouldSuppressLegacyDrawingForFabricPilot$/, '');
  assert.ok(source, '키프레임 이동 헬퍼를 추출할 수 있어야 한다');

  const build = (currentFrame, pilotLayers, legacy) => new Function(
    'videoPlayer',
    'getFabricPilotTimelineLayers',
    'drawingManager',
    `${source}\nreturn getAdjacentDrawingKeyframeFrame;`
  )({ currentFrame }, () => pilotLayers, legacy);

  // 파일럿 소유 중에는 투영된 키프레임을 본다 (파일럿 행 + 읽기 전용 레거시 행 합집합)
  const pilotLayers = [
    { keyframes: [{ frame: 10 }, { frame: 40 }, { frame: 90 }] },
    { keyframes: [{ frame: 25 }, { frame: 40 }] }
  ];
  const legacyStub = {
    getPrevKeyframeFrame: () => 999,
    getNextKeyframeFrame: () => 999
  };
  assert.equal(build(40, pilotLayers, legacyStub)('prev'), 25);
  assert.equal(build(40, pilotLayers, legacyStub)('next'), 90);
  assert.equal(build(0, pilotLayers, legacyStub)('prev'), null, '앞이 없으면 null');
  assert.equal(build(90, pilotLayers, legacyStub)('next'), null, '뒤가 없으면 null');
  assert.equal(build(26, pilotLayers, legacyStub)('prev'), 25, '키프레임 사이에서도 동작한다');

  // 집계 타임라인 등으로 투영이 비면 이동 대상이 없다
  assert.equal(build(40, [], legacyStub)('prev'), null);

  // 파일럿이 소유하지 않으면(html5 폴백) 레거시 매니저를 그대로 쓴다
  assert.equal(build(40, null, legacyStub)('prev'), 999);
  assert.equal(build(40, null, legacyStub)('next'), 999);

  // 단축키 핸들러가 이 헬퍼를 쓰는지 — 레거시 직접 조회로 되돌아가지 않았는지 고정
  assert.match(
    appSource,
    /matchShortcut\('prevKeyframe', e\)\) \{\n\s+e\.preventDefault\(\);\n\s+const prevKf = getAdjacentDrawingKeyframeFrame\('prev'\);/
  );
  assert.match(
    appSource,
    /matchShortcut\('nextKeyframe', e\)\) \{\n\s+e\.preventDefault\(\);\n\s+const nextKf = getAdjacentDrawingKeyframeFrame\('next'\);/
  );
});

test('drawing tool set lives in one shared module that both process layers require', () => {
  assert.match(
    fabricRuntimeSource,
    /require\('\.\.\/\.\.\/\.\.\/shared\/fabric-drawing-tools\.js'\)/,
    '런타임이 공용 도구 집합을 들여와야 한다'
  );
  assert.match(
    overlayHostSource,
    /require\('\.\.\/shared\/fabric-drawing-tools\.js'\)/,
    '호스트가 공용 도구 집합을 들여와야 한다'
  );
  // 2종 가정 관용구가 한 곳이라도 남으면 새 도구가 그 지점에서 brush 로 접힌다.
  for (const [label, source] of [
    ['runtime', fabricRuntimeSource],
    ['host', overlayHostSource],
    ['controller', pilotControllerSource]
  ]) {
    assert.doesNotMatch(
      source,
      /=== 'select' \? 'select' : 'brush'/,
      `${label} 에 2종 가정 정규화가 남아 있다`
    );
    assert.doesNotMatch(
      source,
      /=== 'brush' \|\| [^\n]*=== 'select'/,
      `${label} 에 2종 가정 화이트리스트가 남아 있다`
    );
  }
});

test('controller drawing tool literal matches the shared tool set', () => {
  // 컨트롤러는 브라우저 네이티브 ES 모듈이라 CommonJS 를 import 할 수 없어 리터럴을 둔다.
  // 두 목록이 어긋나면 도구 복원이 조용히 실패하므로 여기서 대조한다.
  const match = pilotControllerSource.match(
    /const CONTROLLER_DRAWING_TOOLS = new Set\(\[([\s\S]*?)\]\);/
  );
  assert.ok(match, '컨트롤러에 CONTROLLER_DRAWING_TOOLS 리터럴이 있어야 한다');
  const literalTools = match[1]
    .split(',')
    .map(entry => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual([...literalTools].sort(), [...FABRIC_DRAWING_TOOLS].sort());
});

test('shape and pen tools are registered as assignable shortcut actions without default keys', () => {
  const toolActions = [
    'drawingToolBrush',
    'drawingToolPen',
    'drawingToolEraser',
    'drawingToolLine',
    'drawingToolRect',
    'drawingToolCircle',
    'drawingToolArrow'
  ];
  for (const action of toolActions) {
    // 결정 3 — 기본 키를 두지 않는다. 빈 문자열이면 합성 이벤트에 오작동한다.
    assert.match(
      userSettingsSource,
      new RegExp(`${action}: \\{ key: null,`),
      `${action} 의 기본 키가 null 이 아니다`
    );
    // 화이트리스트에 없으면 설정 UI 에 아예 나타나지 않아 배정이 불가능하다.
    assert.match(
      appSource,
      new RegExp(`'그리기 보조': \\[[^\\]]*'${action}'`),
      `${action} 이 SHORTCUT_CATEGORIES 에 등록되지 않았다`
    );
  }
  // key 가 null 인 액션을 표시할 때 죽지 않아야 한다.
  assert.equal(
    (appSource.match(/if \(!(?:code|keyCode)\) return '미지정';/g) || []).length,
    3,
    '키 표시 함수 3곳 모두에 미지정 가드가 있어야 한다'
  );
});

test('brush size shortcuts are routed by action id, not by a hard-coded key code', () => {
  // app.js 가 액션 id 로 판정해야 사용자가 [ / ] 를 재지정해도 따라간다.
  assert.match(appSource, /matchesBrushSizeShortcut: event => \{/);
  assert.match(appSource, /if \(userSettings\.matchShortcut\('brushSizeUp', event\)\) return 1;/);
  assert.match(appSource, /if \(userSettings\.matchShortcut\('brushSizeDown', event\)\) return -1;/);
  // 배선은 방화벽 술어가 아니라 컨트롤러의 routeKeydown 이어야 한다.
  // 술어에 넣으면 falsy 를 돌려줘 레거시 브러시 크기까지 함께 바뀐다.
  assert.match(pilotControllerSource, /const brushSizeStep = matchBrushSizeShortcut\(event\);/);
  assert.match(
    pilotControllerSource,
    /if \(brushSizeStep !== 0\) \{\n\s+if \(state !== 'active'\) return false;\n\s+consumeKeyEvent\(event\);/
  );
  // modifier 가드 허용 목록에 들어가야 chord 재지정이 먹는다.
  assert.match(
    pilotControllerSource,
    /if \(!isDrawingToggleShortcut && !isSelectionShortcut && brushSizeStep === 0 && \(/
  );
  // IPC 채널 4계층이 모두 이어져야 한다.
  assert.match(
    preloadSource,
    /mpvUpdateOverlayDrawingBrush: \(request\) => ipcRenderer\.invoke\('mpv:update-overlay-drawing-brush', request\)/
  );
  assert.match(ipcHandlersSource, /ipcMain\.handle\('mpv:update-overlay-drawing-brush'/);
  assert.match(overlayHostSource, /async updateDrawingBrush\(request = \{\}\) \{/);
  assert.match(fabricRuntimeSource, /function updateDrawingBrush\(command = \{\}\) \{/);
});
