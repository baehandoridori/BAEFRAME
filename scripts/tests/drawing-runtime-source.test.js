const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const displaySource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/legacy-drawing-display.js'), 'utf8'));
const drawingLayerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-layer.js'), 'utf8'));
const drawingManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-manager.js'), 'utf8'));
const drawingStrokeRecordsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-stroke-records.js'), 'utf8'));
const drawingSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-sync.js'), 'utf8'));
const reviewDataManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/review-data-manager.js'), 'utf8'));

test('legacy drawing authoring module is removed and only a passive display is constructed', () => {
  for (const removedModule of [
    'renderer/scripts/modules/drawing-canvas.js',
    'renderer/scripts/modules/freehand-stroke-renderer.js',
    'renderer/scripts/lib/perfect-freehand.js'
  ]) {
    assert.equal(fs.existsSync(path.join(rootDir, removedModule)), false, removedModule);
  }
  assert.match(drawingManagerSource, /new LegacyDrawingDisplay\(this\.canvas\)/);
  assert.doesNotMatch(drawingManagerSource, /drawing-canvas\.js|DrawingTool|_onDrawStart|_onDrawEnd|_onSelectionCommitted/);
  assert.doesNotMatch(displaySource, /addEventListener|pointerdown|keydown|drawStrokeRecord|commitSelection/);
  assert.doesNotMatch(appSource, /drawingManager\.(?:setTool|setColor|setEraserMode|setLineWidth|setStrokeEnabled)\(/);
});

test('legacy imports and exports retain the original raster and stroke record schema', () => {
  assert.match(drawingManagerSource, /layers: this\.layers\.map\(l => l\.toJSON\(\)\)/);
  assert.match(drawingManagerSource, /data\.layers\.map\(l => DrawingLayer\.fromJSON\(l\)\)/);
  assert.match(drawingLayerSource, /canvasData: this\.canvasData/);
  assert.match(drawingLayerSource, /baseCanvasData: this\.baseCanvasData/);
  assert.match(drawingLayerSource, /strokeRecords: this\.strokeRecords/);
  assert.match(drawingStrokeRecordsSource, /points: record\.points\.map\(point => \(\{/);
  assert.doesNotMatch(drawingStrokeRecordsSource, /smoothVersion|freehandVersion|renderMode/);
  assert.doesNotMatch(displaySource, /drawingsV3|strokeRecords|keyframes/);
});

test('legacy collaboration keeps old remote stroke display without local authoring subscriptions', () => {
  assert.doesNotMatch(drawingSyncSource, /_onDrawStart|_onDrawMove|_onDrawEnd|_strokeFlushTimer/);
  assert.match(drawingSyncSource, /case 'STROKE_START':/);
  assert.match(drawingSyncSource, /case 'STROKE_MOVE':/);
  assert.match(drawingSyncSource, /case 'STROKE_END':/);
  assert.match(drawingSyncSource, /strokeRecords: keyframe\.strokeRecords/);
  assert.match(drawingSyncSource, /baseCanvasData: keyframe\.baseCanvasData/);
});

test('display resizing skips unchanged dimensions and cannot commit authoring data', () => {
  assert.match(displaySource, /if \(this\.canvas\.width === width && this\.canvas\.height === height\) return false;/);
  assert.match(drawingManagerSource, /_setCanvasElementSize\(canvas, width, height\) \{[\s\S]*?if \(canvas\.width === width && canvas\.height === height\) return false;/);
  assert.doesNotMatch(drawingManagerSource, /commitSelection|commitActiveSelection|floatingImage|isDrawing/);
});

test('drawing mode makes video comment overlays click-through for uninterrupted strokes', () => {
  const singleMarkerMatch = appSource.match(/function renderSingleMarker\(marker\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/);
  assert.ok(singleMarkerMatch, 'single marker renderer should exist');

  assert.match(appSource, /function setCommentOverlaysDrawingPassthrough\(enabled\) \{/);
  assert.match(appSource, /markerContainer\.classList\.toggle\('drawing-active', enabled\);/);
  assert.match(appSource, /document\.body\.classList\.toggle\('drawing-mode-active', enabled\);/);
  assert.match(appSource, /document\.querySelectorAll\('\.comment-marker-tooltip'\)\.forEach\(tooltip => \{/);
  assert.match(appSource, /tooltip\.classList\.remove\('visible', 'pinned'\);/);
  assert.doesNotMatch(appSource, /function applyDrawModeState\(/);
  assert.match(appSource, /function setDrawModeReadyState\(ready\) \{[\s\S]+syncCommentInteractionPolicy\(\);/);
  assert.match(appSource, /function toggleDrawMode\(\) \{[\s\S]+fabricDrawingPilotController\.toggle\(\);/);

  assert.doesNotMatch(singleMarkerMatch[1], /pointer-events:\s*auto;/);
  assert.match(mainCss, /\.comment-marker\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(mainCss, /\.comment-markers-container\.drawing-active \.comment-marker\s*\{[\s\S]*?pointer-events:\s*none\s*!important;/);
  assert.match(mainCss, /body\.drawing-mode-active \.comment-marker-tooltip\.visible\s*\{[\s\S]*?pointer-events:\s*none\s*!important;/);
});

test('non-toggle draw-mode shutdown paths clear drawing overlay state', () => {
  const audioModeMatch = appSource.match(/\/\/ 그리기 모드 비활성화 \(오디오에서는 의미 없음\)([\s\S]*?)\/\/ 비디오 줌 컨트롤 숨기기/);
  assert.ok(audioModeMatch, 'audio loading path should explicitly disable drawing mode');

  assert.doesNotMatch(appSource, /function applyDrawModeState\(/);
  assert.match(appSource, /function setDrawModeReadyState\(ready\) \{[\s\S]+syncCommentInteractionPolicy\(\);/);
  assert.match(appSource, /function toggleDrawMode\(\) \{[\s\S]+fabricDrawingPilotController\.toggle\(\);/);
  assert.match(audioModeMatch[1], /if \(state\.isDrawMode \|\| isFabricDrawingPilotControllerEngaged\(\)\) \{[\s\S]+exitDrawModeForSystemPath\(\);/);
  assert.match(appSource, /function exitDrawModeForSystemPath\(\) \{[\s\S]+setDrawModeReadyState\(false\);[\s\S]+fabricDrawingPilotController\.disable\(\)[\s\S]+resetViewportPanCycle\(\);/);
  assert.doesNotMatch(audioModeMatch[1], /state\.isDrawMode = false;/);
});

test('drawing layer rendering uses static below and above canvases around the active layer', () => {
  assert.match(indexSource, /id="layersBelowCanvas"/);
  assert.match(indexSource, /id="layersAboveCanvas"/);
  assert.match(mainCss, /\.layers-below-layer/);
  assert.match(mainCss, /\.layers-above-layer/);
  assert.match(mainCss, /\.layers-above-layer \{[\s\S]*?z-index: 4;[\s\S]*?\}/);
  assert.match(mainCss, /\.selection-overlay \{[\s\S]*?z-index: 3;[\s\S]*?\}/);

  assert.match(appSource, /layersBelowCanvas: document\.getElementById\('layersBelowCanvas'\)/);
  assert.match(appSource, /layersAboveCanvas: document\.getElementById\('layersAboveCanvas'\)/);
  assert.match(appSource, /layersBelowCanvas: elements\.layersBelowCanvas/);
  assert.match(appSource, /layersAboveCanvas: elements\.layersAboveCanvas/);
  assert.match(appSource, /getCompositedDrawingOverlayDataUrl\(\)/);
  assert.match(appSource, /drawingDataUrl: overlayOnly \? '' : getCompositedDrawingOverlayDataUrl\(\)/);

  assert.match(drawingManagerSource, /partitionDrawingLayersForActive\(layers = \[\], activeLayerId\)/);
  assert.match(drawingManagerSource, /this\.layersBelowCanvas = options\.layersBelowCanvas/);
  assert.match(drawingManagerSource, /this\.layersAboveCanvas = options\.layersAboveCanvas/);
  assert.match(drawingManagerSource, /this\.layersBelowCtx = this\.layersBelowCanvas\?\.getContext\('2d'\)/);
  assert.match(drawingManagerSource, /this\.layersAboveCtx = this\.layersAboveCanvas\?\.getContext\('2d'\)/);
  assert.match(drawingManagerSource, /_clearStaticLayerCanvases\(\)/);
  assert.match(drawingManagerSource, /_getLayerRenderBuckets\(\)/);
  assert.match(drawingManagerSource, /applyLayerOpacity: false/);
  assert.match(drawingManagerSource, /const opacity = bucket\.applyLayerOpacity === false \? 1 : layer\.opacity;/);
  assert.match(drawingManagerSource, /_syncActiveLayerCanvasOpacity\(\)/);
  assert.match(drawingManagerSource, /_drawImageToContext\(ctx, img, opacity\)/);
  assert.match(drawingManagerSource, /this\.renderFrame\(this\.currentFrame\);/);
  assert.match(appSource, /drawCanvas\(baseCanvas, activeCanvasOpacity\);[\s\S]*?drawCanvas\(elements\.selectionOverlayCanvas\);[\s\S]*?drawCanvas\(elements\.layersAboveCanvas\);/);
  assert.match(appSource, /drawCanvas\(baseCanvas, activeCanvasOpacity\);/);

  assert.match(drawingSyncSource, /skipActivate: true/);
  assert.match(drawingSyncSource, /insertIndex: Number\.isInteger\(insertIndex\) \? insertIndex : undefined/);
});

test('drawing playback avoids noisy per-frame canvas clears and preload churn', () => {
  const renderFrameBody = drawingManagerSource.match(/async renderFrame\(frame\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const syncRenderBody = drawingManagerSource.match(/_renderFrameSync\(frame\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(renderFrameBody, /this\._schedulePlaybackPreload\(frame\)/);
  assert.doesNotMatch(renderFrameBody, /this\._preloadFrames\(frame\);/);
  assert.match(syncRenderBody, /this\._playbackCanvasCleared/);
  assert.match(syncRenderBody, /this\.drawingCanvas\.clear\(\{ silent: true \}\)/);
  assert.match(drawingManagerSource, /_schedulePlaybackPreload\(centerFrame, options = \{\}\)/);
  assert.match(drawingManagerSource, /this\._preloadInFlight/);
  assert.match(drawingManagerSource, /this\._lastPlaybackPreloadCenterFrame/);
});

test('pasted drawing frames are published to sync and save listeners', () => {
  assert.match(drawingManagerSource, /const updatedKeyframes = \[\];/);
  assert.match(drawingManagerSource, /updatedKeyframes\.push\(\{ layer, frame, keyframe \}\);/);
  assert.match(drawingManagerSource, /this\._emit\('keyframeUpdated', \{ layer, frame, keyframe \}\);/);
  assert.match(reviewDataManagerSource, /addEventListener\('keyframeUpdated', this\._onDataChanged\)/);
  assert.match(reviewDataManagerSource, /removeEventListener\('keyframeUpdated', this\._onDataChanged\)/);
  assert.match(drawingSyncSource, /addEventListener\('keyframeUpdated', this\._onKeyframeUpdated\)/);
  assert.match(drawingSyncSource, /_onKeyframeUpdated\(e\)/);
  assert.match(drawingSyncSource, /isEmpty: keyframe\.isEmpty === true/);
  assert.match(drawingSyncSource, /if \(!originalCanvasData && keyframe\.isEmpty !== true\) return;/);
  assert.match(drawingSyncSource, /const \{ layerId, frame, canvasData, baseCanvasData, strokeRecords, isEmpty \} = event;/);
  assert.match(drawingSyncSource, /!canvasData && isEmpty !== true/);
  assert.match(drawingSyncSource, /_notifyRemoteKeyframeApplied\(layer, frame, keyframe\) \{[\s\S]*?this\._dm\._emit\?\.\('keyframeUpdated', \{ layer, frame, keyframe \}\);[\s\S]*?this\._dm\._emit\?\.\('layersChanged'\);[\s\S]*?\}/);
  assert.match(drawingSyncSource, /_applyRemoteKeyframe\(event\) \{[\s\S]*?this\._notifyRemoteKeyframeApplied\(layer, frame, keyframe\);/);
});

test('global drawing redo forwards action-scoped lifecycle metadata', () => {
  assert.match(appSource, /drawingManager\._restoreSnapshot\(action\._redoSnapshot, \{/);
  assert.match(appSource, /actionMetadata: action\.drawingAction/);
  assert.match(appSource, /direction: 'redo'/);
  assert.match(drawingManagerSource, /drawingAction: actionMetadata/);
  assert.match(drawingManagerSource, /this\._emit\('historyRestored', \{ actionMetadata, direction, delta \}\);/);
  assert.match(drawingSyncSource, /addEventListener\('historyRestored', this\._onHistoryRestored\)/);
  assert.doesNotMatch(drawingSyncSource, /_localLifecycleLayerIds/);
  assert.match(drawingSyncSource, /type: 'DRAWING_LAYER_ORDER_CHANGED',[\s\S]*?version/);
  assert.match(drawingSyncSource, /compareOrderVersions\(version, this\._lastAppliedOrderVersion\) <= 0/);
  assert.match(drawingSyncSource, /type: 'DRAWING_LAYER_CREATED',[\s\S]*?restore: true/);
  assert.match(drawingSyncSource, /_broadcastRestoredLayer\(layer, insertIndex, generation\)/);
  assert.match(drawingSyncSource, /await this\._broadcastKeyframeUpdate\(layer, keyframe, \{ generation \}\)/);
  assert.match(drawingSyncSource, /_isBroadcastGenerationCurrent\(generation\)/);
  assert.match(drawingSyncSource, /waitForPendingBroadcasts\(\)/);
  assert.match(drawingSyncSource, /type: 'DRAWING_KEYFRAME_CHUNK'/);
  assert.match(drawingSyncSource, /serializedByteSize\(event\) >= MAX_BROADCAST_SIZE/);
  assert.match(drawingSyncSource, /_pruneExpiredKeyframeChunks/);
  assert.match(drawingSyncSource, /_clearKeyframeChunkTransfers\(\)/);
  assert.match(drawingSyncSource, /MAX_ACTIVE_KEYFRAME_TRANSFERS = 8/);
  assert.match(drawingSyncSource, /MAX_KEYFRAME_TRANSFER_BYTES = 32 \* 1024 \* 1024/);
  assert.match(drawingSyncSource, /MAX_TOTAL_KEYFRAME_BUFFERED_BYTES = 64 \* 1024 \* 1024/);
  assert.match(drawingSyncSource, /this\._keyframeChunkBufferedBytes = Math\.max/);
});

test('드로잉 매니저가 실제 페인트 변화에서만 paintStamp를 올린다 (피드백 32)', () => {
  assert.match(drawingManagerSource, /this\.paintStamp = 0;/);
  assert.match(drawingManagerSource, /_notePlaybackRenderKey\(renderKey\)/);
  assert.match(drawingManagerSource, /this\.paintStamp \+= 1;/);
  assert.match(drawingManagerSource, /renderKeyParts\.push\(`\$\{layer\.id\}:\$\{keyframe\.frame\}/);
});

test('하이라이트 undo/redo 콜백은 getter 전용 colorInfo에 대입하지 않는다', () => {
  assert.doesNotMatch(appSource, /restored\.colorInfo\s*=/);
  assert.match(appSource, /restored\.colorKey = highlight\.colorKey;/);
});

test('fabric 히스토리 폴백은 renderer 단일 경로에서 처리한다', async () => {
  const controllerSource = fs.readFileSync(
    path.join(rootDir, 'renderer/scripts/modules/fabric-drawing-pilot-controller.js'), 'utf8'
  );
  assert.match(controllerSource, /onHistoryFallback\(historyAction\)/);
  assert.match(controllerSource, /reason === 'history-empty'/);
  assert.match(controllerSource, /getHistoryRevision/);
  assert.match(controllerSource, /historyRevision === readHistoryRevision\(\)/);
  assert.match(appSource, /let globalHistoryRevision = 0;/);
  assert.match(appSource, /getHistoryRevision: \(\) => globalHistoryRevision/);
  assert.match(appSource, /advanceGlobalHistoryRevision\(\);/);
  assert.match(appSource, /async function globalUndo\(\{ fromFabricFallback = false \} = \{\}\)/);
  assert.match(appSource, /async function globalRedo\(\{ fromFabricFallback = false \} = \{\}\)/);
  assert.match(appSource, /if \(!fromFabricFallback\) advanceGlobalHistoryRevision\(\);/);
  assert.match(appSource, /return globalUndo\(\{ fromFabricFallback: true \}\)\.then/);
  assert.match(appSource, /return globalRedo\(\{ fromFabricFallback: true \}\)\.then/);
  assert.equal(
    (appSource.match(/const historyMutationRevision = globalHistoryRevision;/g) || []).length,
    2
  );
  assert.equal(
    (appSource.match(/historyMutationRevision !== globalHistoryRevision/g) || []).length,
    2
  );
  assert.equal(
    (appSource.match(/historyMutationRevision === globalHistoryRevision/g) || []).length,
    2
  );

  const historyBlock = appSource.match(
    /  \/\/ ====== 글로벌 Undo\/Redo 시스템 ======\n([\s\S]*?)\n  \/\/ 마커 컨테이너 생성/
  )?.[1];
  assert.ok(historyBlock, 'global history block should be extractable for behavior checks');
  const createHistoryHarness = new Function(
    'drawingManager',
    'log',
    'showToast',
    `${historyBlock}\nreturn {
      pushUndo,
      globalUndo,
      globalRedo,
      getUndoStack: () => [...undoStack],
      getRedoStack: () => [...redoStack],
      getHistoryRevision: () => globalHistoryRevision,
      resetForFile: () => {
        undoStack.length = 0;
        redoStack.length = 0;
        advanceGlobalHistoryRevision();
      }
    };`
  );
  const newHarness = (toasts = []) => createHistoryHarness(
    { _createSnapshot() {}, _restoreSnapshot() {}, _emit() {} },
    { error() {} },
    (message, type) => toasts.push({ message, type })
  );
  const makeDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };

  const normal = newHarness();
  const normalAction = {
    type: 'TEST',
    undo: async () => {},
    redo: async () => {}
  };
  normal.pushUndo(normalAction);
  assert.equal(await normal.globalUndo({ fromFabricFallback: true }), true);
  assert.deepEqual(normal.getUndoStack(), []);
  assert.deepEqual(normal.getRedoStack(), [normalAction]);
  assert.equal(await normal.globalRedo({ fromFabricFallback: true }), true);
  assert.deepEqual(normal.getUndoStack(), [normalAction]);
  assert.deepEqual(normal.getRedoStack(), []);

  const failedUndoToasts = [];
  const failedUndo = newHarness(failedUndoToasts);
  const failedUndoAction = {
    type: 'TEST',
    undo: async () => { throw new Error('expected undo failure'); },
    redo: async () => {}
  };
  failedUndo.pushUndo(failedUndoAction);
  const failedUndoRevision = failedUndo.getHistoryRevision();
  assert.equal(await failedUndo.globalUndo({ fromFabricFallback: true }), false);
  assert.equal(failedUndo.getHistoryRevision(), failedUndoRevision + 1);
  assert.deepEqual(failedUndo.getUndoStack(), [failedUndoAction]);
  assert.deepEqual(failedUndo.getRedoStack(), []);
  assert.deepEqual(failedUndoToasts, [{ message: '실행 취소에 실패했습니다', type: 'error' }]);

  const failedRedoToasts = [];
  const failedRedo = newHarness(failedRedoToasts);
  const failedRedoAction = {
    type: 'TEST',
    undo: async () => {},
    redo: async () => { throw new Error('expected redo failure'); }
  };
  failedRedo.pushUndo(failedRedoAction);
  assert.equal(await failedRedo.globalUndo({ fromFabricFallback: true }), true);
  const failedRedoRevision = failedRedo.getHistoryRevision();
  assert.equal(await failedRedo.globalRedo({ fromFabricFallback: true }), false);
  assert.equal(failedRedo.getHistoryRevision(), failedRedoRevision + 1);
  assert.deepEqual(failedRedo.getUndoStack(), []);
  assert.deepEqual(failedRedo.getRedoStack(), [failedRedoAction]);
  assert.deepEqual(failedRedoToasts, [{ message: '다시 실행에 실패했습니다', type: 'error' }]);

  for (const direction of ['undo', 'redo']) {
    for (const outcome of ['resolve', 'reject']) {
      for (const interference of ['push', 'reset']) {
        const harness = newHarness();
        const gate = makeDeferred();
        const oldAction = {
          type: 'TEST',
          undo: async () => {},
          redo: async () => {}
        };
        harness.pushUndo(oldAction);
        if (direction === 'redo') {
          assert.equal(await harness.globalUndo({ fromFabricFallback: true }), true);
        }
        oldAction[direction] = () => gate.promise;

        const operation = direction === 'undo'
          ? harness.globalUndo({ fromFabricFallback: true })
          : harness.globalRedo({ fromFabricFallback: true });
        const newAction = { type: 'TEST', undo: async () => {}, redo: async () => {} };
        if (interference === 'push') harness.pushUndo(newAction);
        else harness.resetForFile();
        if (outcome === 'resolve') gate.resolve();
        else gate.reject(new Error('expected history failure'));
        await operation;

        assert.deepEqual(
          harness.getUndoStack(),
          interference === 'push' ? [newAction] : [],
          `${direction} ${outcome} must not restore an old action after ${interference}`
        );
        assert.deepEqual(
          harness.getRedoStack(),
          [],
          `${direction} ${outcome} must not commit an old action after ${interference}`
        );
      }
    }
  }
  const hostSource = fs.readFileSync(
    path.join(rootDir, 'main/mpv-overlay-host.js'), 'utf8'
  );
  assert.match(hostSource, /const historyAction = overlayHistoryActionFromInput\(input\);/);
  assert.match(hostSource, /mainWindow\.webContents\.send\(FORWARDED_KEYBOARD_CHANNEL, forwardedInput\);/);
  assert.doesNotMatch(hostSource, /this\.applyDrawingAction\(request\)\.then/);
});

test('저장 상태 칩은 재시도 소진 후에만 저장 실패를 알린다', () => {
  assert.match(
    indexSource,
    /<div class="save-status-chip is-hidden" id="saveStatusChip" role="status" aria-live="polite">/
  );
  assert.match(
    indexSource,
    /<span class="save-status-chip-label" id="saveStatusChipLabel"><\/span>/
  );
  assert.match(mainCss, /\.save-status-chip \{\n  display: flex;/);
  assert.match(mainCss, /\.save-status-chip\.is-hidden \{\n  display: none;\n\}/);
  assert.match(mainCss, /\.save-status-chip\.is-retrying \{\n  color: var\(--warning\);/);
  assert.match(appSource, /saveStatusChip: document\.getElementById\('saveStatusChip'\),/);
  assert.match(appSource, /reviewDataManager\.addEventListener\('saveStateChanged', \(e\) => \{/);
  assert.match(
    appSource,
    /if \(status === 'save-failed'\) \{\n\s+showToast\('리뷰 데이터 저장 실패', 'error'\);/
  );
  assert.doesNotMatch(
    appSource,
    /addEventListener\('saveError', \(e\) => \{\n\s+log\.error\('\.bframe 저장 실패', e\.detail\.error\);\n\s+showToast\(/
  );
  assert.match(
    reviewDataManagerSource,
    /const SAVE_RETRY_DELAYS_MS = Object\.freeze\(\[2000, 5000, 10000\]\);/
  );
  assert.match(
    reviewDataManagerSource,
    /const TRANSIENT_SAVE_FAILURE_REASONS = new Set\(\[\n  'review-file-write-failed',\n  'fabric-snapshot-unavailable'\n\]\);/
  );
  assert.match(reviewDataManagerSource, /this\._emitSaveState\('retrying', failure\.reason\);/);
  assert.match(
    reviewDataManagerSource,
    /writeError\.saveFailureReason = saveResult\?\.fatal === true\n\s+\? 'review-file-write-fatal'\n\s+: 'review-file-write-failed';/
  );
  // §7 C-9: 지연 사유는 _classifySaveFailure를 거치지 않고 지연 분기에서 직접 표시된다
  assert.match(
    reviewDataManagerSource,
    /this\._saveStateSettled = true;\n\s+this\._emitSaveState\(\n\s+this\.autoSaveEnabled \? 'retrying' : 'save-failed',\n\s+deferredReason\n\s+\);/
  );
});

test('저장 차단 래치는 일시 실패로 분류되지 않는다', () => {
  // 최종 Fabric 스냅샷 훅이 차단 상태를 별도 사유로 태깅해야 재시도 루프에 들어가지 않는다.
  assert.match(
    appSource,
    /if \(fabricDrawingPilotStatusSnapshot\?\.persistenceBlocked === true\) \{\n\s+const blocked = new Error\('Fabric 드로잉 저장이 차단된 상태입니다\.'\);\n\s+blocked\.saveFailureReason = 'fabric-drawing-blocked';\n\s+throw blocked;/
  );
  assert.match(
    reviewDataManagerSource,
    /const BLOCKING_SAVE_FAILURE_REASONS = new Set\(\[\n  'fabric-drawing-blocked',/
  );
  // 차단 사유는 재시도 대상 목록에 들어가면 안 된다
  const transient = reviewDataManagerSource.match(
    /const TRANSIENT_SAVE_FAILURE_REASONS = new Set\(\[([\s\S]*?)\]\);/
  )?.[1] || '';
  assert.doesNotMatch(transient, /fabric-drawing-blocked/);
  // 차단 안내는 복구 방법을 알려준다
  assert.match(
    appSource,
    /e\.detail\?\.reason === 'fabric-drawing-blocked'\n\s+\? '드로잉 저장이 중단되었습니다\. 영상을 다시 열면 복구됩니다\.'/
  );
});
