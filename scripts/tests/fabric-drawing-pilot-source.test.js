const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

// 투영 테스트가 쓰는 기본 레이어 상태. shared/drawing-layers.js 의 기본값과 같은 모양이다.
const projectionLayerState = {
  version: 1,
  layers: [{ id: 'drawing-layer-1', name: '드로잉 1', visible: true, locked: false, color: '#4f8ef7' }],
  activeLayerId: 'drawing-layer-1',
  baseLayerId: 'drawing-layer-1',
  assignments: {}
};
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
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header:not\(\[data-layer-id\^="fabric-pilot-layer-"\]\):not\(\[data-pilot-projected="true"\]\),[\s\S]+body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-track-row:not\(\[data-layer-id\^="fabric-pilot-layer-"\]\):not\(\[data-pilot-projected="true"\]\)[\s\S]+display:\s*none;[\s\S]+pointer-events:\s*none;/
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
    selectedKeyframes: [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 0 }],
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
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
    'reviewDataManager',
    'activeFabricPilotLayerRowId',
    'resetFabricDrawingLayerAssignmentTracking',
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
    value => String(value || '').replace(/\//g, '\\').toLowerCase(),
    'fabric-pilot-layer-',
    { getDrawingLayers: () => projectionLayerState },
    () => 'fabric-pilot-layer-drawing-layer-1',
    () => {}
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
    selectedKeyframes: [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 12 }],
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
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
    'reviewDataManager',
    'activeFabricPilotLayerRowId',
    'resetFabricDrawingLayerAssignmentTracking',
    `${renderSource}\nreturn renderActiveDrawingLayers;`
  )(
    () => [{ id: 'fabric-pilot-layer-drawing-layer-1' }],
    timelineHarness,
    { layers: [], activeLayerId: null },
    { getSourceEpoch: () => sourceEpoch },
    null,
    statusSnapshot,
    null,
    null,
    videoPlayerHarness,
    { currentFile: videoPlayerHarness.filePath },
    value => String(value || '').replace(/\//g, '\\').toLowerCase(),
    'fabric-pilot-layer-',
    { getDrawingLayers: () => projectionLayerState },
    () => 'fabric-pilot-layer-drawing-layer-1',
    () => {}
  );

  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);

  calls.length = 0;
  sourceEpoch = 2;
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 24 }];
  videoPlayerHarness.filePath = 'C:\\videos\\b.mp4';
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['clear', 'render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 36 }];
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 48 }];
  statusSnapshot.videoGeneration = 2;
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['clear', 'render']);

  calls.length = 0;
  timelineHarness.selectedKeyframes = [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 60 }];
  renderActiveDrawingLayers();
  assert.deepEqual(calls, ['render']);
  assert.match(appSource, /let lastFabricPilotTimelineVideoGeneration = null;/);
  assert.match(appSource, /let lastFabricPilotTimelineStableVideoIdentity = null;/);
});

test('읽기 전용 합성 행과 투영 행의 가시성·잠금 버튼은 숨긴다', () => {
  assert.match(
    mainCss,
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-layer-id\^="fabric-pilot-layer-"\] \.layer-visibility,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-layer-id\^="fabric-pilot-layer-"\] \.layer-lock,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-pilot-projected="true"\] \.layer-visibility,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-pilot-projected="true"\] \.layer-lock \{\n\s+display:\s*none;\n\s+pointer-events:\s*none;\n\}/
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
  // 프레임 조작 예외 목록도 app.js 원문에서 뽑아 주입한다. 손으로 베끼면
  // 실제 배선과 어긋난 채 통과할 수 있다.
  // 프레임 조작 예외 목록도 app.js 원문에서 뽑아 주입한다. 손으로 베끼면
  // 실제 배선과 어긋난 채 통과할 수 있다.
  const frameMapStart = appSource.indexOf('const FABRIC_PILOT_FRAME_OPERATIONS = {');
  assert.ok(frameMapStart > 0, '프레임 조작 매핑을 찾지 못했다');
  const frameMapSource = appSource.slice(
    frameMapStart,
    appSource.indexOf('};', frameMapStart)
  );
  const frameOperationActions = [...frameMapSource.matchAll(/^\s+(\w+):/gm)]
    .map(match => match[1]);
  assert.equal(frameOperationActions.length, 7, '프레임 조작 액션 7종');
  const frameOperations = Object.fromEntries(
    frameOperationActions.map(action => [action, 'op'])
  );
  // 레이어 액션 목록도 app.js 원문에서 뽑는다.
  const layerSetStart = appSource.indexOf('const FABRIC_PILOT_LAYER_ACTIONS = new Set([');
  assert.ok(layerSetStart > 0, '레이어 액션 목록을 찾지 못했다');
  const layerActionNames = [...appSource
    .slice(layerSetStart, appSource.indexOf(']);', layerSetStart))
    .matchAll(/'([^']+)'/g)].map(match => match[1]);
  // 이동은 오버레이가 오브젝트 순서를 바꿔야 의미가 있어 여기 없다 —
  // 메타데이터만 바꾸면 타임라인 행만 움직이고 화면의 겹침 순서는 그대로다.
  assert.equal(layerActionNames.length, 3, '오버레이 없이 완결되는 레이어 액션 3종');
  assert.equal(
    layerActionNames.some(action => action.startsWith('drawingLayerMove')),
    false,
    '레이어 이동은 오버레이 배선 없이 넣지 않는다'
  );
  const layerActions = new Set(layerActionNames);
  let engaged = false;
  let projectionOwned = true;
  const shouldBlock = new Function(
    'FABRIC_DRAWING_LEGACY_SHORTCUTS',
    'FABRIC_PILOT_FRAME_OPERATIONS',
    'FABRIC_PILOT_LAYER_ACTIONS',
    'userSettings',
    'isFabricDrawingPilotEngaged',
    'shouldSuppressLegacyDrawingForFabricPilot',
    `${guardSource}\nreturn shouldBlockFabricDrawingLegacyShortcut;`
  )(
    actionSet,
    frameOperations,
    layerActions,
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
  // 프레임·키프레임 조작은 파일럿이 직접 처리하므로 engaged 상태에서도 통과한다.
  for (const action of frameOperationActions) {
    assert.equal(
      shouldBlock({ action, key: '', code: '' }),
      false,
      `프레임 조작은 파일럿이 처리한다: ${action}`
    );
  }
  // Ctrl+Alt+C·V 는 chord 차단에 먼저 걸린다 — 예외가 그보다 앞에 있어야 통과한다.
  assert.equal(
    shouldBlock({ action: 'frameCopy', key: 'c', code: 'KeyC', ctrlKey: true, altKey: true }),
    false,
    'Ctrl+Alt+C 는 chord 차단보다 먼저 통과해야 한다'
  );
  assert.equal(
    shouldBlock({ action: 'framePaste', key: 'v', code: 'KeyV', ctrlKey: true, altKey: true }),
    false
  );
  // 레이어 조작 5종도 파일럿이 처리하므로 통과한다. Ctrl+Shift+X·C 는 chord
  // 차단에 먼저 걸리므로 예외가 그보다 앞에 있어야 한다.
  for (const action of layerActionNames) {
    assert.equal(shouldBlock({ action, key: '', code: '' }), false, `레이어 조작: ${action}`);
  }
  // 남은 3종은 Ctrl 조합이 아니라 chord 차단에 걸리지 않는다. 이동(Ctrl+Shift+X·C)이
  // 들어오는 PR 에서는 그 순서를 다시 확인해야 한다.
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
    'reviewDataManager',
    'drawingLayerIdForObject',
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
    `${projectionSource}\nreturn getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => mpvActive,
    {
      getHydrationDocument: () => {
        hydrationReads += 1;
        return { keyframes: [{ frame: 12, objects: [{ id: 'projection-object-1' }] }] };
      }
    },
    playlistState,
    timelineState,
    cutlistState,
    () => ({ isActive: () => cutlistManagerActive }),
    { layers: [] },
    // 레이어 모델은 기본 한 장이다 — 투영이 레이어마다 행을 만드는지 확인한다.
    { getDrawingLayers: () => projectionLayerState },
    (state, objectId) => state.layers[0].id,
    'fabric-pilot-layer-'
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
    'reviewDataManager',
    'drawingLayerIdForObject',
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
    `${projectionSource}\nreturn getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => true,
    {
      getHydrationDocument: () => ({
        keyframes: [
          { frame: 10, objects: [{ id: 'projection-object-1' }] },
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
    { layers: [] },
    { getDrawingLayers: () => projectionLayerState },
    (state, objectId) => state.layers[0].id,
    'fabric-pilot-layer-'
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
    layerId: 'fabric-pilot-layer-drawing-layer-1',
    fromFrame: 10,
    toFrame: 20
  }];
  const anchor = { layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 20 };

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
    selection: [{ layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 20 }],
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
    layerId: 'fabric-pilot-layer-drawing-layer-1',
    fromFrame: 10,
    toFrame: 20
  }];
  const move = harness.moveFabricPilotKeyframes(
    keyframes,
    10,
    { layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 20 }
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
    { layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 20 }
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
      layerId: 'fabric-pilot-layer-drawing-layer-1',
      fromFrame: 10,
      toFrame: 20
    }],
    10,
    { layerId: 'fabric-pilot-layer-drawing-layer-1', frame: 20 }
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
        keyframe => keyframe.layerId === 'fabric-pilot-layer-drawing-layer-1'
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
    layerId: 'fabric-pilot-layer-drawing-layer-1',
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
  let hydrationDocument = { keyframes: [{ frame: 12, objects: [{ id: 'projection-object-1' }] }] };
  const getProjection = new Function(
    'fabricDrawingPilotController',
    'isMpvPilotPlaybackActive',
    'fabricDrawingPersistenceStore',
    'playlistUIState',
    'timeline',
    'cutlistUIState',
    'getCutlistManager',
    'drawingManager',
    'reviewDataManager',
    'drawingLayerIdForObject',
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
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
    { layers: legacyLayers },
    { getDrawingLayers: () => projectionLayerState },
    (state, objectId) => state.layers[0].id,
    'fabric-pilot-layer-'
  );

  const layers = getProjection();
  assert.equal(layers.length, 2);
  assert.equal(layers[0].id, 'fabric-pilot-layer-drawing-layer-1');

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
    /paletteShell = createFabricDrawingPalette\(\{\n\s+documentRef,\n\s+windowRef,\n\s+element: toolbar,\n\s+setStyles,\n\s+addDomListener,\n[\s\S]{0,400}?\n\s+sections: \[/
  );
  // 도구 줄은 아이콘 5개 한 줄이고 도형 4종은 드롭다운으로 접힌다(목업 확정).
  // 섹션이 존재하고 도구 버튼을 담는다는 계약은 그대로다.
  assert.match(
    fabricRuntimeSource,
    /id: 'tools',\n\s+label: '도구',\n\s+layout: 'grid',\n\s+columns: 5,\n\s+gap: '3px',\n\s+items: \[\n\s+brushButton, penButton, eraserButton, shapeMenuControls\.button, selectButton\n\s+\],\n\s+appended: \[shapeMenuControls\.flyout\]/
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

  // 도구 버튼은 아이콘 전용이 됐지만(190px 팔레트에서 한글 라벨이 잘린다)
  // 접근성 라벨은 한글 그대로 유지된다 — 이름이 title/aria-label 로 옮겨갔을 뿐이다.
  assert.match(fabricRuntimeSource, /createButton\('', 'brush'\), '브러시 도구 \(B\)', TOOL_ICON_SVG\.brush/);
  assert.match(fabricRuntimeSource, /createButton\('', 'select'\), '선택 도구 \(V\)', TOOL_ICON_SVG\.select/);
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
    /panel\.dataset\.fabricPilotPanel = 'brush-settings';[\s\S]+position: 'static',\n\s+width: '100%',\n\s+flexDirection: 'column',/
  );
  // 패널은 스스로 스크롤하지 않는다 — 잘라 두면 팔레트 스크롤 안에 스크롤이
  // 또 생겨 맨 아래 외곽선 설정에 닿으려면 안쪽 막대를 따로 내려야 한다.
  assert.doesNotMatch(fabricRuntimeSource, /maxHeight: '210px'/);
});

test('오버레이 슬라이더를 탭 순서에 넣지 않는다 — 키가 도달하지 못한다', () => {
  // 코덱스가 "-/+ 버튼을 지웠으니 슬라이더를 탭 순서에 넣으라"고 지적했다.
  // 그 전제가 이 창에서는 성립하지 않는다.
  //
  // 그리기 입력이 켜져 있는 동안 호스트의 before-input-event 가 Tab·Enter·Space·
  // 방향키를 **메인 창으로 릴레이하고 preventDefault() 한다.** 오버레이 문서는
  // 그 키를 아예 받지 못한다. 그래서
  //   - Tab 으로는 오버레이 안 어떤 컨트롤에도 갈 수 없고(지운 -/+ 버튼도 마찬가지였다),
  //   - 설령 슬라이더가 포커스를 얻어도 방향키가 소모돼 값이 바뀌지 않는다.
  // tabindex 를 달면 조작할 수 있다는 **거짓 표시**만 남는다.
  //
  // 실제로 열어 주려면 오버레이→호스트 포커스 상태 채널이 먼저 필요하다.
  // 그 전에는 tabIndex = -1 이 정직한 표시다.
  const relayStart = overlayHostSource.indexOf('FORWARDED_NAMED_KEY_CODES = new Set([');
  assert.ok(relayStart > 0, '릴레이 키 목록을 찾지 못했다');
  const relayList = overlayHostSource.slice(relayStart, overlayHostSource.indexOf(']);', relayStart));
  for (const code of ['Tab', 'Enter', 'Space', 'ArrowLeft', 'ArrowRight']) {
    assert.ok(
      relayList.includes("'" + code + "'"),
      code + ' 가 릴레이 대상이 아니면 이 판단을 다시 해야 한다'
    );
  }
  // 릴레이한 키는 오버레이 문서에 남기지 않는다.
  assert.ok(overlayHostSource.includes('this.keyboardRelayCount += 1;'));
  assert.ok(overlayHostSource.includes('createForwardedKeyboardInput(input, drawModeShortcut)'));

  // 슬라이더는 모두 탭 순서 밖이다.
  const marker = "input.type = 'range';";
  let at = fabricRuntimeSource.indexOf(marker);
  let seen = 0;
  while (at !== -1) {
    const near = fabricRuntimeSource.slice(at, at + 200);
    assert.ok(near.includes('input.tabIndex = -1;'), '슬라이더는 탭 순서 밖이어야 한다');
    seen += 1;
    at = fabricRuntimeSource.indexOf(marker, at + marker.length);
  }
  assert.ok(seen >= 1, 'range 입력 생성부를 찾지 못했다');
});

test('오버레이 스크롤바는 본체 테마와 같은 값을 쓴다', () => {
  // 오버레이는 별도 BrowserWindow 라 renderer/styles/main.css 를 불러오지 않는다.
  // 스크롤바를 안 적으면 윈도우 기본 막대(밝은 회색 + 화살표 버튼)가 그려져
  // 어두운 팔레트 위에 홀로 튄다.
  //
  // 값을 손으로 베껴 둔 것이므로 본체 테마가 바뀌면 소리 없이 어긋난다.
  // 그래서 main.css 에서 **실제 값을 뽑아** 대조한다.
  // 선택자를 **줄 처음**에 앵커한다. 그러지 않으면 `.playback-controls-scroll::`
  // 같은 한정 규칙이 먼저 잡혀 엉뚱한 값과 대조하게 된다.
  const thumb = /^[ \t]*::-webkit-scrollbar-thumb \{\s*background: (rgba\([^)]+\));\s*border-radius: (\d+px);/m;
  const mainThumb = mainCss.match(thumb);
  assert.ok(mainThumb, 'main.css 에서 스크롤바 thumb 규칙을 찾지 못했다');
  const overlayThumb = overlayHostSource.match(thumb);
  assert.ok(overlayThumb, '오버레이에 스크롤바 thumb 규칙이 없다 — 윈도우 기본 막대가 나온다');
  assert.equal(overlayThumb[1], mainThumb[1], '스크롤바 thumb 색이 본체와 다르다');
  assert.equal(overlayThumb[2], mainThumb[2], '스크롤바 thumb 모서리가 본체와 다르다');

  const width = /^[ \t]*::-webkit-scrollbar \{\s*width: (\d+px);\s*height: (\d+px);/m;
  const mainWidth = mainCss.match(width);
  const overlayWidth = overlayHostSource.match(width);
  assert.ok(overlayWidth, '오버레이에 스크롤바 폭 규칙이 없다');
  assert.equal(overlayWidth[1], mainWidth[1], '스크롤바 폭이 본체와 다르다');
  assert.equal(overlayWidth[2], mainWidth[2], '스크롤바 높이가 본체와 다르다');

  // 트랙은 비워 둬야 팔레트 배경이 그대로 비친다.
  assert.match(overlayHostSource, /^[ \t]*::-webkit-scrollbar-track \{\s*background: transparent;/m);
});

test('팔레트가 붙이는 모든 클래스는 스타일 출처를 갖는다', () => {
  // 이 라운드에서 UI 가 깨진 근본 원인이다. `mpv-fabric-pilot-brush-status` 와
  // `-eraser-mode` 는 JS 가 클래스를 붙이지만 **어디에도 CSS 규칙이 없었다.**
  // 그래서 상태 줄은 display:block·16px 로 떨어져 팔레트에서 가장 큰 글자가 됐고,
  // 지우개 방식 버튼은 간격 없이 서로 맞붙었다. 런타임 테스트는 클래스 이름만
  // 확인하므로 이걸 잡지 못한다 — 이름은 제대로 붙어 있었기 때문이다.
  //
  // 규칙: 클래스를 붙였으면 호스트 CSS 에 규칙이 있거나, 인라인 setStyles 로
  // 스스로 배치를 지정해야 한다. 둘 다 아니면 브라우저 기본값에 맡긴 것이고
  // 그건 의도가 아니라 누락이다.
  const inlineStyled = new Set([
    // 아래는 생성 직후 setStyles 로 배치를 직접 지정한다. 새 클래스를 이 목록에
    // 넣기 전에 정말 인라인으로 배치하는지 코드에서 확인할 것.
    'mpv-fabric-pilot-outline',
    'mpv-fabric-pilot-shape-menu',
    'mpv-fabric-pilot-size-hud',
    'mpv-fabric-pilot-size-hud-label',
    'mpv-fabric-pilot-viewport',
    // 라벨·행 자식이 각자 CSS 를 갖는 단순 세로 래퍼다.
    'mpv-fabric-pilot-section'
  ]);
  const used = new Set();
  for (const source of [fabricRuntimeSource, fabricPaletteSource]) {
    for (const match of source.matchAll(/className = '(mpv-fabric-pilot-[a-z-]+)'/g)) {
      used.add(match[1]);
    }
  }
  assert.ok(used.size >= 8, `팔레트 클래스를 ${used.size}개만 찾았다 — 추출 정규식을 확인할 것`);
  const unstyled = [...used].filter(name =>
    !inlineStyled.has(name) &&
    !overlayHostSource.includes(`.${name} `) &&
    !overlayHostSource.includes(`.${name},`) &&
    !overlayHostSource.includes(`.${name} {`)
  );
  assert.deepEqual(
    unstyled,
    [],
    `CSS 규칙도 인라인 배치도 없는 클래스: ${unstyled.join(', ')}`
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

test('타임라인은 레이어마다 한 행을 만들고 그 레이어의 획만 채운다', () => {
  // drawingsV3 의 키프레임은 문서 단위다. 프레임 목록은 모든 행이 같고, 그
  // 프레임에 **그 레이어의 획이 있는지**만 행마다 다르다(isEmpty).
  const projectionStart = appSource.indexOf('function getFabricPilotTimelineLayers() {');
  assert.ok(projectionStart > 0, '투영 소스를 찾지 못했다');
  const projectionSource = appSource.slice(
    projectionStart,
    appSource.indexOf('let lastFabricPilotTimeline', projectionStart)
  );

  const twoLayers = {
    version: 1,
    layers: [
      { id: 'top', name: '윗장', visible: true, locked: false, color: '#ff4757' },
      { id: 'bottom', name: '아랫장', visible: true, locked: false, color: '#4f8ef7' }
    ],
    activeLayerId: 'top',
    baseLayerId: 'bottom',
    assignments: { 'obj-top': 'top' }
  };
  const getProjection = new Function(
    'fabricDrawingPilotController',
    'isMpvPilotPlaybackActive',
    'fabricDrawingPersistenceStore',
    'playlistUIState',
    'timeline',
    'cutlistUIState',
    'getCutlistManager',
    'drawingManager',
    'reviewDataManager',
    'drawingLayerIdForObject',
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
    `${projectionSource}
return getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => true,
    {
      getHydrationDocument: () => ({
        keyframes: [
          { frame: 5, objects: [{ id: 'obj-top' }] },
          { frame: 9, objects: [{ id: 'obj-bottom' }] }
        ]
      })
    },
    { mode: 'review' },
    { playlistDuration: 0, playlistSegments: [], cutlistDuration: 0, cutlistSegments: [] },
    { active: false },
    () => ({ isActive: () => false }),
    { layers: [] },
    { getDrawingLayers: () => twoLayers },
    (state, objectId) => state.assignments[objectId] || state.baseLayerId,
    'fabric-pilot-layer-'
  );

  const rows = getProjection();
  assert.equal(rows.length, 2, '레이어마다 한 행');
  assert.deepEqual(rows.map(row => row.name), ['윗장', '아랫장']);
  assert.deepEqual(rows.map(row => row.color), ['#ff4757', '#4f8ef7']);
  assert.equal(rows[0].active, true, '활성 레이어를 표시한다');
  assert.equal(rows[1].active, false);

  // 프레임 목록은 같고 채워짐만 다르다.
  assert.deepEqual(rows[0].keyframes.map(kf => kf.frame), [5, 9]);
  assert.deepEqual(rows[1].keyframes.map(kf => kf.frame), [5, 9]);
  assert.deepEqual(rows[0].keyframes.map(kf => kf.isEmpty), [false, true], '윗장은 5 에만 있다');
  assert.deepEqual(rows[1].keyframes.map(kf => kf.isEmpty), [true, false], '아랫장은 9 에만 있다');
});

test('새로 그린 획은 활성 레이어에 붙고 처음 로드는 배정을 덮지 않는다', () => {
  // 저장 레코드에는 레이어 정보가 없다(스키마 불가침). 새로 나타난 오브젝트 id 를
  // 보고 그때의 활성 레이어에 붙인다. 처음 문서를 읽을 때는 전부 "새로" 보이므로
  // 그때 붙이면 파일에 저장된 배정이 활성 레이어로 통째로 덮인다.
  const syncStart = appSource.indexOf('function syncFabricDrawingLayerAssignments() {');
  assert.ok(syncStart > 0, '동기화 소스를 찾지 못했다');
  const syncSource = appSource.slice(syncStart, syncStart + 1600);
  assert.ok(syncSource.includes('if (!drawingObjectIdsSeeded) {'), '첫 로드는 seed 만 한다');
  assert.ok(
    syncSource.includes('assignDrawingObjectLayer(next, id, next.activeLayerId)'),
    '새 오브젝트는 활성 레이어에 붙는다'
  );
  assert.ok(
    appSource.slice(syncStart, syncStart + 1600).includes('pruneDrawingLayerAssignments'),
    '사라진 오브젝트의 배정을 걷는다'
  );
  // 영상이 바뀌면 추적을 처음부터 다시 한다.
  assert.ok(appSource.includes('function resetFabricDrawingLayerAssignmentTracking() {'));
});

test('키프레임 이동 라우터는 레이어별 행 id 를 알아본다', () => {
  // 행 id 는 레이어마다 다르다. 접두어로 판정하지 않으면 새 행의 마커 드래그가
  // legacy 로 분류돼 레거시 drawingManager 로 가고 아무 일도 일어나지 않는다.
  const start = appSource.indexOf('function classifyFabricPilotKeyframeMove(keyframes) {');
  assert.ok(start > 0, '분류 함수를 찾지 못했다');
  const tail = "return fabricCount === keyframes.length ? 'fabric' : 'mixed';";
  const end = appSource.indexOf(tail, start);
  assert.ok(end > start, '분류 함수의 끝을 찾지 못했다');
  const source = `${appSource.slice(start, end + tail.length)} }`;
  const classify = new Function(
    'FABRIC_PILOT_LAYER_ROW_PREFIX',
    `${source}
return classifyFabricPilotKeyframeMove;`
  )('fabric-pilot-layer-');

  assert.equal(classify([{ layerId: 'fabric-pilot-layer-drawing-layer-1' }]), 'fabric');
  assert.equal(classify([{ layerId: 'fabric-pilot-layer-custom-2' }]), 'fabric', '새 레이어 행도 파일럿이다');
  assert.equal(classify([{ layerId: 'layer-legacy-1' }]), 'legacy');
  assert.equal(
    classify([{ layerId: 'fabric-pilot-layer-a' }, { layerId: 'layer-legacy-1' }]),
    'mixed'
  );
});

test('오브젝트 추적은 세션이 살아나는 순간 심는다', () => {
  // 첫 변이 알림을 기다리면 늦다 — importRootValue·reset 은 구독자를 부르지
  // 않으므로, 사용자가 새 레이어를 고르고 그은 첫 획의 알림이 첫 seed 가 되어
  // 그 획이 배정을 받지 못하고 기준 레이어로 떨어진다.
  const start = appSource.indexOf('function handleFabricDrawingPilotStateChange(');
  assert.ok(start > 0, '상태 변경 핸들러를 찾지 못했다');
  const head = appSource.slice(start, start + 900);
  assert.ok(
    head.includes("if (nextState === 'active') seedFabricDrawingLayerAssignmentTracking();"),
    '세션이 active 가 되는 순간 추적을 심어야 한다'
  );
  // 영상이 바뀌면 처음부터 다시 센다.
  const renderStart = appSource.indexOf('function renderActiveDrawingLayers() {');
  assert.ok(
    appSource.slice(renderStart, renderStart + 1400)
      .includes('if (sourceChanged) resetFabricDrawingLayerAssignmentTracking();'),
    '소스가 바뀌면 추적을 초기화해야 한다'
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
  // 수식키 가드의 허용 목록. 새 단축키를 넣으면 여기에도 넣어야 판정 전에 빠져나가지 않는다.
  const guardStart = pilotControllerSource.indexOf('if (!isDrawingToggleShortcut && !isSelectionShortcut &&');
  assert.ok(guardStart > 0, '수식키 가드를 찾지 못했다');
  const guardLine = pilotControllerSource.slice(guardStart, pilotControllerSource.indexOf('{', guardStart));
  for (const allowed of ['brushSizeStep === 0', 'shortcutTool === null', 'frameOperation === null']) {
    assert.ok(guardLine.includes(allowed), `수식키 가드 허용 목록에 ${allowed} 이 없다`);
  }
});

test('drawing shortcuts bypass the remembered-editor relay while the overlay owns the keyboard', () => {
  // 오버레이가 키보드를 갖고 있어도 메인 렌더러의 기억된 activeElement 가
  // 에디터면 릴레이된 키가 그쪽으로 가고 컨트롤러가 editable-target 으로 버린다.
  // 도구·크기 단축키가 우회 목록에 없으면 그 상태에서 조용히 아무 일도 안 한다.
  const block = appSource.match(
    /const MPV_OVERLAY_RELAY_DRAWING_ACTIONS = Object\.freeze\(\[([\s\S]*?)\]\);/
  );
  assert.ok(block, '릴레이 우회 목록이 있어야 한다');
  const listed = [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(listed.sort(), [
    'brushSizeDown', 'brushSizeUp',
    'drawingToolArrow', 'drawingToolBrush', 'drawingToolCircle', 'drawingToolEraser',
    'drawingToolLine', 'drawingToolPen', 'drawingToolRect', 'drawingToolSelect'
  ]);
  // 프레임·키프레임 조작 7종도 우회해야 한다. 목록을 손으로 베끼면 배선과 어긋나므로
  // 매핑을 통째로 펼쳐 넣고, 그 펼침이 실제로 있는지 확인한다. 빼면 에디터 포커스가
  // 남아 있을 때 수식키 없는 2·3·4 가 에디터에 글자로 들어간다.
  assert.ok(
    block[1].includes('...Object.keys(FABRIC_PILOT_FRAME_OPERATIONS)'),
    '프레임 조작 매핑이 릴레이 우회 목록에 펼쳐져 있어야 한다'
  );
  // 레이어 조작도 그리기 중에만 쓴다. 빼면 에디터 포커스가 남아 있을 때 릴레이가
  // 이 키를 에디터로 보내고 handleKeydown 이 먼저 돌아간다.
  assert.ok(
    block[1].includes('...FABRIC_PILOT_LAYER_ACTIONS'),
    '레이어 조작도 릴레이 우회 목록에 펼쳐져 있어야 한다'
  );
  assert.match(
    appSource,
    /for \(const actionId of MPV_OVERLAY_RELAY_DRAWING_ACTIONS\) add\(describe\(actionId\)\);/
  );
  // 수식키가 붙은 배정도 그대로 넘긴다 — 릴레이가 chord 전체를 대조하므로
  // Shift+E 를 우회 목록에 넣어도 평문 E 는 텍스트 입력에 남는다.
  assert.match(appSource, /ctrl: shortcut\.ctrl === true,/);
  assert.match(appSource, /shift: shortcut\.shift === true,/);
  assert.match(appSource, /alt: shortcut\.alt === true/);
  assert.doesNotMatch(appSource, /addUnmodified/);
});

test('palette height changes reclamp the position so revealed controls stay on screen', () => {
  // 섹션을 여닫거나 도구에 따라 숨겼다 보이면 팔레트 높이가 달라진다.
  // 위치를 다시 잡지 않으면 화면 아래쪽에 놓인 팔레트에서 새로 드러난 컨트롤이
  // 화면 밖으로 밀린다. jsdom 에는 레이아웃이 없어 높이가 상수라 동작으로는
  // 확인할 수 없으므로 배선 자체를 고정한다.
  assert.match(fabricPaletteSource, /if \(!collapsed\) onSectionToggle\?\.\(sectionId, false\);/);
  assert.match(
    fabricPaletteSource,
    /const toggleSection = \(\) => \{[\s\S]*?applyPosition\(state\);\n\s+\};/
  );
  assert.match(
    fabricPaletteSource,
    /function setSectionVisible\(id, visible\) \{[\s\S]*?if \(wasHidden !== !visible\) applyPosition\(state\);/
  );
});

test('section labels do not advertise keyboard activation the overlay cannot deliver', () => {
  // 그리기 입력이 켜져 있는 동안 오버레이 호스트가 모든 키를 메인 렌더러로 넘기며
  // preventDefault() 한다. Enter·Space 가 오버레이 문서에 도달하지 못하고 Tab 으로
  // 포커스를 옮길 수도 없으므로, 라벨에 role="button" 과 tabindex 를 달면
  // 도달할 수 없는 컨트롤을 도달할 수 있는 것처럼 알리게 된다.
  const labelBlock = fabricPaletteSource.match(
    /label\.className = 'mpv-fabric-pilot-section-label';[\s\S]*?listen\(label, 'click', toggleSection\);/
  );
  assert.ok(labelBlock, '섹션 라벨 조립부가 있어야 한다');
  assert.doesNotMatch(labelBlock[0], /setAttribute\?\.\('role', 'button'\)/);
  assert.doesNotMatch(labelBlock[0], /setAttribute\?\.\('tabindex'/);
  assert.doesNotMatch(labelBlock[0], /listen\(label, 'keydown'/);
  // 마우스로 무엇을 하는지는 툴팁으로 알린다.
  assert.match(fabricPaletteSource, /label\.setAttribute\?\.\('title', `\$\{section\.label\} 접기\/펴기`\);/);
});

test('the outline section sits under the colour palette in the brush panel', () => {
  // 목업이 "색상 아래 자리를 비워 둔다"고 한 그 자리다.
  assert.match(
    fabricRuntimeSource,
    /panel\.appendChild\(previewRow\);\n\s+panel\.appendChild\(palette\);\n\s+panel\.appendChild\(recentColors\.row\);\n\s+panel\.appendChild\(outlineGroup\);/
  );
  // 외곽선은 본체에서 파생된 짝 레코드다 — id 규약으로 관계를 표현해 스키마를 지킨다.
  assert.match(fabricRuntimeSource, /const OUTLINE_ID_SUFFIX = '~outline';/);
  assert.match(fabricRuntimeSource, /function deriveOutlineRecord\(record, outline, geometryOptions = null\) \{/);
  // 짝은 한 커맨드로 들어가야 실행취소가 1건이다.
  assert.match(fabricRuntimeSource, /function addStroke\(stroke, outlineRecord = null\) \{/);
  // 분할에서 외곽선은 **같은 폴리곤으로 잘라** 조각마다 다시 만든다.
  assert.match(
    fabricRuntimeSource,
    /function buildClippedOutlineRenderGeometry\(plan, record, spec, sourceSelection, geometryOptions, budget\) \{/
  );
  // 조각마다 새 예산을 주면 512조각에서 설정 한도의 수백 배를 동기로 돌아 멈춘다.
  assert.match(fabricRuntimeSource, /const outlineGeometryBudget = createGeometryBudget\(maxSelectionGeometryOperations\);/);

  assert.match(
    fabricRuntimeSource,
    /function makeOutlineFragmentRecord\(fragment, spec, outlineGeometry, sourceOutlineObject\) \{/
  );
  // 조각 외곽선도 본체와 똑같이 자기 경로에서 자연 위치를 뽑아야 어긋나지 않는다.
  assert.match(
    fabricRuntimeSource,
    /if \(!applySourceTransformToFragment\(path, sourceOutlineObject\)\) return null;\n\s+derived\.transform = captureTransform\(path\);/
  );
  // style 에 필드를 늘리면 구버전 앱이 문서를 통째로 거부한다.
  assert.doesNotMatch(fabricRuntimeSource, /outlineWidth:/);
});

test('같은 문서 프레임을 여러 행에서 골라도 이동이 무산되지 않는다', () => {
  // 레이어마다 행이 있으므로 같은 프레임을 두 행에서 고를 수 있다. 그대로 넘기면
  // moveKeyframes 가 중복 출발 프레임을 거절해 드래그가 통째로 무산된다.
  const start = appSource.indexOf('async function moveFabricPilotKeyframes(');
  assert.ok(start > 0, '이동 함수를 찾지 못했다');
  const head = appSource.slice(start, start + 900);
  assert.ok(head.includes('const seenFromFrames = new Set();'), '문서 프레임 기준으로 접는다');
  assert.ok(
    head.includes('if (seenFromFrames.has(keyframe.fromFrame)) continue;'),
    '중복 출발 프레임을 건너뛴다'
  );
});

test('삭제된 획의 레이어 배정은 실행취소가 되살릴 때까지 남는다', () => {
  // 즉시 걷어내면 되살아난 획이 "새 오브젝트" 로 보여 그때의 활성 레이어로
  // 옮겨간다. 지우고 → 레이어를 바꾸고 → 되돌리면 그림이 다른 레이어로 이동한
  // 채 저장된다.
  const syncStart = appSource.indexOf('function syncFabricDrawingLayerAssignments() {');
  const syncEnd = appSource.indexOf('function seedFabricDrawingLayerAssignmentTracking', syncStart);
  const syncSource = appSource.slice(syncStart, syncEnd);
  assert.equal(
    syncSource.includes('pruneDrawingLayerAssignments'),
    false,
    '변이 알림에서는 걷지 않는다'
  );
  const seedStart = appSource.indexOf('function seedFabricDrawingLayerAssignmentTracking() {');
  assert.ok(
    appSource.slice(seedStart, seedStart + 800).includes('pruneDrawingLayerAssignments'),
    '문서를 새로 심을 때만 걷는다'
  );
});

test('실행취소로 되살아난 획은 원래 레이어에 남는다', () => {
  // 배정을 지우지 않는 것만으로는 모자란다 — 되살아난 id 를 "새 것" 으로 보고
  // 활성 레이어로 덮으면 똑같이 옮겨간다. 배정 유무로는 가릴 수 없다(기준
  // 레이어의 오브젝트는 원래 배정이 없다). 세션 동안 본 id 를 따로 기억한다.
  const syncStart = appSource.indexOf('function syncFabricDrawingLayerAssignments() {');
  const syncEnd = appSource.indexOf('function seedFabricDrawingLayerAssignmentTracking', syncStart);
  const syncSource = appSource.slice(syncStart, syncEnd);
  assert.ok(
    syncSource.includes('if (everSeenDrawingObjectIds.has(id)) continue;'),
    '되살아난 오브젝트는 배정을 덮지 않는다'
  );
  assert.ok(
    syncSource.includes('everSeenDrawingObjectIds.add(id);'),
    '새 오브젝트는 본 목록에 넣는다'
  );
  // seed·reset 이 두 목록을 함께 다룬다.
  const seedStart = appSource.indexOf('function seedFabricDrawingLayerAssignmentTracking() {');
  assert.ok(
    appSource.slice(seedStart, seedStart + 700)
      .includes('everSeenDrawingObjectIds = new Set(knownDrawingObjectIds);'),
    'seed 는 본 목록도 함께 심는다'
  );
});

test('레이어 헤더 클릭은 레이어 모델의 활성 레이어를 바꾼다', () => {
  // 파일럿 행은 drawingManager 가 소유하지 않는다. 접두어를 벗겨 모델로 보내지
  // 않으면 헤더가 눌리는데 아무 일도 일어나지 않는다.
  const start = appSource.indexOf("timeline.addEventListener('layerSelect'");
  assert.ok(start > 0, 'layerSelect 핸들러를 찾지 못했다');
  const handler = appSource.slice(start, start + 900);
  assert.ok(
    handler.includes('layerId.startsWith(FABRIC_PILOT_LAYER_ROW_PREFIX)'),
    '파일럿 행을 알아본다'
  );
  assert.ok(
    handler.includes('layerId.slice(FABRIC_PILOT_LAYER_ROW_PREFIX.length)'),
    '접두어를 벗겨 레이어 id 를 얻는다'
  );
  assert.ok(handler.includes('applyDrawingLayerStateChange'), '모델을 갱신한다');
});
