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
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header:not\(\[data-layer-id="fabric-pilot-drawing-layer"\]\),[\s\S]+body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-track-row:not\(\[data-layer-id="fabric-pilot-drawing-layer"\]\)[\s\S]+display:\s*none;[\s\S]+pointer-events:\s*none;/
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

test('persistence gate abandon is load-local and does not rebuild transition ownership', () => {
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
    /if \(!finalFabricPersistenceReadyToLeave && !preserveContinuousSession\) \{[\s\S]+abandonPersistenceForVideoChange\(\);\n\s+fabricPersistenceAbandonedForThisLoad = true;\n\s+finalFabricPersistenceReadyToLeave = true;/
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

test('파일럿 드로잉은 타임라인에 읽기 전용으로 투영된다', () => {
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
  // 투영 레이어 드래그·삭제 차단
  assert.match(
    appSource,
    /keyframesMove', \(e\) => \{[\s\S]{0,400}?if \(getFabricPilotTimelineLayers\(\)\) return;/
  );
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

test('읽기 전용 합성 행의 가시성·잠금 버튼은 숨긴다', () => {
  assert.match(
    mainCss,
    /body\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-layer-id="fabric-pilot-drawing-layer"\] \.layer-visibility,\nbody\.fabric-drawing-pilot-enabled\.mpv-pilot-mode \.drawing-layer-header\[data-layer-id="fabric-pilot-drawing-layer"\] \.layer-lock \{\n\s+display:\s*none;\n\s+pointer-events:\s*none;\n\}/
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
    () => ({ isActive: () => cutlistManagerActive })
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

test('파일럿 투영 범위는 저장된 장면의 단일 프레임만 표시한다', () => {
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
    `${projectionSource}\nreturn getFabricPilotTimelineLayers;`
  )(
    { shouldOwnDrawingShortcut: () => true },
    () => true,
    {
      getHydrationDocument: () => ({
        keyframes: [
          { frame: 10, objects: [{}] },
          { frame: 20, objects: [{}] }
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
    () => ({ isActive: () => false })
  );

  const [layer] = getProjection();
  assert.deepEqual(
    layer.getKeyframeRanges(100).map(range => ({ start: range.start, end: range.end })),
    [
      { start: 10, end: 10 },
      { start: 20, end: 20 }
    ]
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
