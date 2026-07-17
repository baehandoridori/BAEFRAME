const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const drawingCanvasSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-canvas.js'), 'utf8'));
const drawingManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-manager.js'), 'utf8'));
const drawingStrokeRecordsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-stroke-records.js'), 'utf8'));
const drawingSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-sync.js'), 'utf8'));
const reviewDataManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/review-data-manager.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('drawing tools expose a persisted eraser mode segmented control', () => {
  assert.match(indexSource, /id="eraserModeSection"/);
  assert.match(indexSource, /data-eraser-mode="pixel"/);
  assert.match(indexSource, /data-eraser-mode="stroke"/);
  assert.match(mainCss, /\.eraser-mode-toggle/);
  assert.match(userSettingsSource, /eraserMode:\s*'pixel'/);
  assert.match(userSettingsSource, /getEraserMode\(\)/);
  assert.match(userSettingsSource, /setEraserMode\(mode\)/);
  assert.match(appSource, /userSettings\.getEraserMode\(\)/);
  assert.match(appSource, /drawingManager\.setEraserMode\(mode\)/);
});

test('eraser tool hides color-only controls and uses a neutral size preview', () => {
  assert.match(indexSource, /id="colorSection"/);
  assert.match(appSource, /const colorSection = document\.getElementById\('colorSection'\);/);
  assert.match(appSource, /const strokeSection = document\.getElementById\('strokeSection'\);/);
  assert.match(appSource, /colorSection\.style\.display = 'none';/);
  assert.match(appSource, /colorSection\.style\.display = 'block';/);
  assert.match(appSource, /strokeSection\.style\.display = 'none';/);
  assert.match(appSource, /strokeSection\.style\.display = 'block';/);
  assert.match(appSource, /sizePreview\.classList\.toggle\('eraser-preview', currentToolType === 'eraser'\);/);
  assert.match(mainCss, /\.size-preview\.eraser-preview::after/);
});

test('drawing canvas resolves Ctrl pen and brush strokes as eraser at stroke start', () => {
  assert.match(drawingCanvasSource, /setEraserMode\(mode\)/);
  assert.match(drawingCanvasSource, /_resolveEffectiveTool\(e\)/);
  assert.match(drawingCanvasSource, /this\._modifierCtrlDown = false;/);
  assert.match(drawingCanvasSource, /_isCtrlActive\(e\)/);
  assert.match(drawingCanvasSource, /e\?\.ctrlKey === true \|\| this\._modifierCtrlDown === true/);
  assert.match(drawingCanvasSource, /this\.activeTool = this\._resolveEffectiveTool\(e\);/);
  assert.match(drawingCanvasSource, /effectiveTool: this\.activeTool/);
  assert.match(drawingCanvasSource, /eraserMode: this\.activeEraserMode/);
  // 피드백 34: 도형 도구에서도 Ctrl 임시 지우개
  assert.match(drawingCanvasSource, /const ctrlEraserTools = \[[\s\S]*?DrawingTool\.LINE,[\s\S]*?DrawingTool\.CIRCLE[\s\S]*?\];/);
  assert.match(drawingCanvasSource, /ctrlEraserTools\.includes\(this\.tool\) && this\._isCtrlActive\(e\)/);
});

test('drawing input is blocked before stroke events when the active layer is locked or hidden', () => {
  const mouseDownBody = drawingCanvasSource.match(/_onMouseDown\(e\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(drawingCanvasSource, /this\.canDraw = null;/);
  assert.match(mouseDownBody, /typeof this\.canDraw === 'function' && !this\.canDraw\(\)/);
  assert.match(mouseDownBody, /this\._emit\('drawblocked'/);
  assert.ok(
    mouseDownBody.indexOf("this._emit('drawblocked'") < mouseDownBody.indexOf('this.isDrawing = true'),
    'blocked input must return before isDrawing enables drawstart/drawmove/drawend'
  );

  assert.match(drawingManagerSource, /this\.drawingCanvas\.canDraw = \(\) => \{/);
  assert.match(drawingManagerSource, /layer\.locked !== true && layer\.visible !== false/);
  assert.match(drawingManagerSource, /this\.drawingCanvas\.addEventListener\('drawblocked'/);
  assert.match(drawingManagerSource, /reason: layer\?\.locked \? 'locked' : 'hidden'/);
  assert.match(drawingManagerSource, /if \(!layer \|\| layer\.locked \|\| layer\.visible === false\) return;/);
  assert.match(drawingManagerSource, /if \(!layer \|\| layer\.locked \|\| layer\.visible === false\) \{/);

  assert.match(appSource, /drawingManager\.addEventListener\('drawblocked'/);
  assert.match(appSource, /잠긴 레이어에는 그릴 수 없습니다/);
  assert.match(appSource, /숨긴 레이어에는 그릴 수 없습니다/);
});

test('drawing mode makes video comment overlays click-through for uninterrupted strokes', () => {
  const singleMarkerMatch = appSource.match(/function renderSingleMarker\(marker\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/);
  assert.ok(singleMarkerMatch, 'single marker renderer should exist');

  assert.match(appSource, /function setCommentOverlaysDrawingPassthrough\(enabled\) \{/);
  assert.match(appSource, /markerContainer\.classList\.toggle\('drawing-active', enabled\);/);
  assert.match(appSource, /document\.body\.classList\.toggle\('drawing-mode-active', enabled\);/);
  assert.match(appSource, /document\.querySelectorAll\('\.comment-marker-tooltip'\)\.forEach\(tooltip => \{/);
  assert.match(appSource, /tooltip\.classList\.remove\('visible', 'pinned'\);/);
  assert.match(appSource, /function applyDrawModeState\(enabled\) \{/);
  assert.match(appSource, /function setDrawModeReadyState\(ready\) \{[\s\S]+setCommentOverlaysDrawingPassthrough\(ready\);/);
  assert.match(appSource, /function toggleDrawMode\(\) \{[\s\S]+applyDrawModeState\(true\);[\s\S]+applyDrawModeState\(false\);/);

  assert.doesNotMatch(singleMarkerMatch[1], /pointer-events:\s*auto;/);
  assert.match(mainCss, /\.comment-marker\s*\{[\s\S]*?pointer-events:\s*auto;/);
  assert.match(mainCss, /\.comment-markers-container\.drawing-active \.comment-marker\s*\{[\s\S]*?pointer-events:\s*none\s*!important;/);
  assert.match(mainCss, /body\.drawing-mode-active \.comment-marker-tooltip\.visible\s*\{[\s\S]*?pointer-events:\s*none\s*!important;/);
});

test('non-toggle draw-mode shutdown paths clear drawing overlay state', () => {
  const audioModeMatch = appSource.match(/\/\/ 그리기 모드 비활성화 \(오디오에서는 의미 없음\)([\s\S]*?)\/\/ 비디오 줌 컨트롤 숨기기/);
  assert.ok(audioModeMatch, 'audio loading path should explicitly disable drawing mode');

  assert.match(appSource, /function applyDrawModeState\(enabled\) \{/);
  assert.match(appSource, /function setDrawModeReadyState\(ready\) \{[\s\S]+setCommentOverlaysDrawingPassthrough\(ready\);/);
  assert.match(appSource, /function toggleDrawMode\(\) \{[\s\S]+applyDrawModeState\(true\);[\s\S]+applyDrawModeState\(false\);/);
  assert.match(audioModeMatch[1], /if \(state\.isDrawMode \|\| isFabricDrawingPilotControllerEngaged\(\)\) \{[\s\S]+exitDrawModeForSystemPath\(\);/);
  assert.match(appSource, /function exitDrawModeForSystemPath\(\) \{[\s\S]+fabricDrawingPilotController\.disable\(\)[\s\S]+applyDrawModeState\(false\);/);
  assert.doesNotMatch(audioModeMatch[1], /state\.isDrawMode = false;/);
});

test('clearing the current drawing frame respects locked and hidden layers', () => {
  assert.match(appSource, /elements\.btnClearDrawing\?\.addEventListener\('click'/);
  assert.match(appSource, /if \(layer\.locked \|\| layer\.visible === false\) \{/);
  assert.match(appSource, /잠긴 레이어는 지울 수 없습니다/);
  assert.match(appSource, /숨긴 레이어는 지울 수 없습니다/);
  assert.match(appSource, /const hasClearableSelection = !!\([\s\S]*?drawingManager\.drawingCanvas\?\.floatingImage[\s\S]*?drawingManager\.drawingCanvas\?\.selection[\s\S]*?\);/);
  assert.match(appSource, /if \(\(keyframe && !keyframe\.isEmpty\) \|\| hasClearableSelection\) \{[\s\S]*?drawingManager\.drawingCanvas\?\.clearSelection\?\.\(\);[\s\S]*?if \(keyframe && !keyframe\.isEmpty\) \{[\s\S]*?keyframe\.setCanvasData\(null\);/);
});

test('drawing manager skips stroke record persistence when a save is blocked', () => {
  const drawEndBody = drawingManagerSource.match(/async _onDrawEnd\(detail\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(drawEndBody, /const keyframe = this\._saveCurrentFrameData\(/);
  assert.match(drawEndBody, /if \(!keyframe\) \{/);
  assert.ok(
    drawEndBody.indexOf('if (!keyframe) {') < drawEndBody.indexOf('this._saveRecordableStroke(detail);'),
    'blocked saves must return before strokeRecords can be appended'
  );
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
  assert.match(appSource, /drawingDataUrl: suppressLegacyDrawing \? '' : getCompositedDrawingOverlayDataUrl\(\)/);

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
  assert.match(drawingCanvasSource, /setSelectionImageOpacity\(opacity\)/);
  assert.match(drawingCanvasSource, /ctx\.globalAlpha = this\.selectionImageOpacity;/);
  assert.match(drawingManagerSource, /_drawImageToContext\(ctx, img, opacity\)/);
  assert.match(drawingManagerSource, /this\.renderFrame\(this\.currentFrame\);/);
  assert.match(appSource, /drawCanvas\(baseCanvas, activeCanvasOpacity\);[\s\S]*?drawCanvas\(elements\.selectionOverlayCanvas\);[\s\S]*?drawCanvas\(elements\.layersAboveCanvas\);/);
  assert.match(appSource, /drawCanvas\(baseCanvas, activeCanvasOpacity\);/);

  assert.match(drawingSyncSource, /skipActivate: true/);
  assert.match(drawingSyncSource, /insertIndex: Number\.isInteger\(insertIndex\) \? insertIndex : undefined/);
});

test('drawing manager records freehand strokes and erases intersecting stroke records', () => {
  assert.match(drawingManagerSource, /createStrokeRecord/);
  assert.match(drawingManagerSource, /removeIntersectingStrokes/);
  assert.match(drawingManagerSource, /_onDrawMove\(detail\)/);
  assert.match(drawingManagerSource, /_saveRecordableStroke\(detail\)/);
  assert.match(drawingManagerSource, /_eraseStrokeRecords\(detail\)/);
  assert.match(drawingManagerSource, /_freezeStrokeRecords/);
  assert.match(drawingManagerSource, /keyframe\.baseCanvasData/);
  assert.match(drawingManagerSource, /keyframe\.strokeRecords/);
});

test('stroke eraser edits the held source keyframe instead of creating a new frame', () => {
  assert.match(drawingManagerSource, /_getEditableKeyframeForCurrentFrame\(options = \{\}\)/);
  assert.match(drawingManagerSource, /options\.editHeldSourceKeyframe === true/);
  assert.match(drawingManagerSource, /const sourceKeyframe = layer\.getKeyframeAtFrame\(this\.currentFrame\);/);
  assert.match(drawingManagerSource, /if \(sourceKeyframe && options\.editHeldSourceKeyframe === true\) \{[\s\S]*?return sourceKeyframe;/);
});

test('stroke eraser gestures do not stream as live pixel eraser strokes to collaborators', () => {
  assert.match(drawingSyncSource, /eraserMode === 'stroke'/);
  assert.match(drawingSyncSource, /return;/);
  assert.match(drawingSyncSource, /strokeRecords: keyframe\.strokeRecords/);
  assert.match(drawingSyncSource, /baseCanvasData: keyframe\.baseCanvasData/);
});

test('stroke eraser explains unavailable bitmap-only frames instead of silently doing nothing', () => {
  assert.match(drawingManagerSource, /_strokeEraseUnavailableNotified = false;/);
  assert.match(drawingManagerSource, /_notifyStrokeEraseUnavailable\(keyframe\)/);
  assert.match(drawingManagerSource, /this\._emit\('strokeeraserunavailable'/);
  assert.match(drawingManagerSource, /reason: 'bitmap-only'/);
  assert.match(appSource, /drawingManager\.addEventListener\('strokeeraserunavailable'/);
  assert.match(appSource, /픽셀 지우개로 편집된 그림은 획 단위로 지울 수 없습니다/);
});

test('stroke eraser redraw loads base image before clearing the visible canvas', () => {
  const redrawBody = drawingManagerSource.match(/async _redrawKeyframeFromRecords\(keyframe\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(drawingManagerSource, /_loadBaseCanvasImage\(keyframe\)/);
  assert.match(redrawBody, /const baseImage = keyframe\.baseCanvasData[\s\S]+await this\._loadBaseCanvasImage\(keyframe\)/);
  assert.ok(
    redrawBody.indexOf('await this._loadBaseCanvasImage(keyframe)') < redrawBody.indexOf('this.drawingCanvas.clear({ silent: true })'),
    'base image must be decoded before visible canvas clear to avoid flicker'
  );
  assert.match(redrawBody, /this\.drawingCanvas\.ctx\.drawImage\(baseImage, 0, 0\);/);
});

test('drawing playback avoids noisy per-frame canvas clears and preload churn', () => {
  const renderFrameBody = drawingManagerSource.match(/async renderFrame\(frame\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const syncRenderBody = drawingManagerSource.match(/_renderFrameSync\(frame\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(drawingCanvasSource, /clear\(options = \{\}\)/);
  assert.match(drawingCanvasSource, /options\.silent/);
  assert.match(renderFrameBody, /this\._schedulePlaybackPreload\(frame\)/);
  assert.doesNotMatch(renderFrameBody, /this\._preloadFrames\(frame\);/);
  assert.match(syncRenderBody, /this\._playbackCanvasCleared/);
  assert.match(syncRenderBody, /this\.drawingCanvas\.clear\(\{ silent: true \}\)/);
  assert.match(drawingManagerSource, /_schedulePlaybackPreload\(centerFrame, options = \{\}\)/);
  assert.match(drawingManagerSource, /this\._preloadInFlight/);
  assert.match(drawingManagerSource, /this\._lastPlaybackPreloadCenterFrame/);
});

test('pen and brush strokes use bundled perfect-freehand smoothing without changing record storage', () => {
  assert.equal(packageJson.dependencies['perfect-freehand'], '1.2.3');
  assert.match(packageJson.scripts['bundle:perfect-freehand'], /perfect-freehand[\s\S]+renderer\/scripts\/lib\/perfect-freehand\.js/);
  assert.match(packageJson.scripts.postinstall, /bundle:perfect-freehand/);

  assert.match(drawingCanvasSource, /import \{ drawFreehandStroke \} from '\.\/freehand-stroke-renderer\.js';/);
  assert.match(drawingCanvasSource, /_drawSmoothedFreehandStroke\(points, options = \{\}\)/);
  assert.match(drawingCanvasSource, /this\._drawSmoothedFreehandStroke\(this\.currentStrokePath, \{[\s\S]*?tool[\s\S]*?\}\);/);
  assert.match(drawingCanvasSource, /this\._drawSmoothedFreehandStroke\(points, \{[\s\S]*?strokeEnabled[\s\S]*?\}\);/);
  assert.match(drawingCanvasSource, /drawFreehandStroke\(this\.ctx, points, \{/);

  assert.match(drawingStrokeRecordsSource, /points: record\.points\.map\(point => \(\{/);
  assert.doesNotMatch(drawingStrokeRecordsSource, /smoothVersion|freehandVersion|renderMode/);
});

test('drawing select tool supports marquee selection, move, copy and paste', () => {
  assert.match(drawingCanvasSource, /SELECT: 'select'/);
  assert.match(drawingCanvasSource, /_onSelectPointerDown\(e\)/);
  assert.match(drawingCanvasSource, /commitSelection\(\)/);
  assert.match(drawingCanvasSource, /clearSelection\(\)/);
  assert.match(drawingCanvasSource, /copySelection\(\)/);
  assert.match(drawingCanvasSource, /pasteSelection\(\)/);
  assert.match(drawingManagerSource, /commitActiveSelection\(\)/);
  assert.match(drawingManagerSource, /selectioncommitted/);
  assert.match(drawingManagerSource, /exportData\(\) \{[\s\S]*?this\.drawingCanvas\?\.floatingImage[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?layers: this\.layers\.map/);
  assert.match(indexSource, /data-tool="select"/);
  assert.match(indexSource, /id="selectionOverlayCanvas"/);
  assert.match(userSettingsSource, /'select', 'pen', 'brush', 'eraser', 'line', 'arrow', 'rect', 'circle'/);
  // 피드백 35: 클릭 획 선택 (래스터 리프트)
  assert.match(drawingCanvasSource, /_emit\('strokeselectrequest'/);
  assert.match(drawingCanvasSource, /beginStrokeFloating\(record\)/);
  assert.match(drawingManagerSource, /_onStrokeSelectRequest\(detail\)/);
  assert.match(drawingManagerSource, /findStrokeAtPoint\(readRecords, point\)/);
  assert.match(drawingStrokeRecordsSource, /export function findStrokeAtPoint\(strokes, point, extraTolerance = 6\)/);
});

test('floating drawing selections are resolved before context changes, not during render', () => {
  const renderStart = drawingManagerSource.indexOf('async renderFrame(frame) {');
  const renderEnd = drawingManagerSource.indexOf('\n  _renderFrameSync', renderStart);
  const renderFrameBody = drawingManagerSource.slice(renderStart, renderEnd);
  const syncOverlayStart = appSource.indexOf('function syncCanvasOverlay() {');
  const syncOverlayEnd = appSource.indexOf('\n  // 윈도우 리사이즈', syncOverlayStart);
  const syncOverlayBody = appSource.slice(syncOverlayStart, syncOverlayEnd);

  assert.doesNotMatch(renderFrameBody, /commitSelection|commitActiveSelection/);
  assert.doesNotMatch(syncOverlayBody, /layerCanvas\.width = renderArea\.videoWidth;[\s\S]*?layerCanvas\.height = renderArea\.videoHeight;/);
  assert.doesNotMatch(syncOverlayBody, /onionCanvas\.width = renderArea\.videoWidth;[\s\S]*?onionCanvas\.height = renderArea\.videoHeight;/);
  assert.match(drawingCanvasSource, /syncSize\(width, height\) \{[\s\S]*?if \(this\.canvas\.width === width && this\.canvas\.height === height\) \{[\s\S]*?return false;[\s\S]*?\}/);
  assert.match(drawingManagerSource, /setCanvasSize\(width, height\) \{[\s\S]*?const canvasSizeChanged = this\.drawingCanvas\?\.canvas &&[\s\S]*?this\.drawingCanvas\.canvas\.width !== width[\s\S]*?this\.drawingCanvas\.canvas\.height !== height[\s\S]*?if \(canvasSizeChanged && \(this\.drawingCanvas\.floatingImage \|\| this\.drawingCanvas\.selection\)\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?\}/);
  assert.match(drawingManagerSource, /_setCanvasElementSize\(canvas, width, height\) \{[\s\S]*?if \(canvas\.width === width && canvas\.height === height\) return false;[\s\S]*?canvas\.width = width;[\s\S]*?canvas\.height = height;/);
  assert.match(drawingManagerSource, /createLayer\(options = \{\}, saveHistory = true\) \{[\s\S]*?const shouldActivate = options\.skipActivate !== true;[\s\S]*?if \(shouldActivate\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?\}/);
  assert.match(drawingSyncSource, /this\._dm\.createLayer\(\{[\s\S]*?skipActivate: true,[\s\S]*?\}, false\);/);
  assert.match(drawingManagerSource, /setActiveLayer\(layerId\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?this\.activeLayerId = layerId;/);
  assert.match(drawingManagerSource, /moveActiveLayerByOffset\(offset\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?this\._saveToHistory\(\);/);
  assert.match(drawingManagerSource, /toggleLayerVisibility\(layerId\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?layer\.visible = !layer\.visible;/);
  assert.match(drawingManagerSource, /toggleLayerLock\(layerId\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?layer\.locked = !layer\.locked;/);
  assert.match(drawingManagerSource, /addBlankKeyframe\(\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?const layer = this\.getActiveLayer\(\);/);
  assert.match(drawingManagerSource, /removeKeyframe\(\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?const layer = this\.getActiveLayer\(\);/);
  assert.match(drawingManagerSource, /insertFrame\(\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?const layer = this\.getActiveLayer\(\);/);
  assert.match(drawingManagerSource, /deleteFrame\(\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?const layer = this\.getActiveLayer\(\);/);
  assert.match(drawingManagerSource, /copyFrames\(targets = null\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?const resolved = \[\];/);
  assert.match(drawingManagerSource, /pasteFrames\(targetFrame = this\.currentFrame\) \{[\s\S]*?this\.commitActiveSelection\(\);[\s\S]*?this\._saveToHistory\(\);/);
  assert.match(drawingManagerSource, /_restoreSnapshot\(snapshot, context = \{\}\) \{[\s\S]*?this\.drawingCanvas\.clearSelection\?\.\(\);/);
  assert.match(drawingManagerSource, /currentLayers\.forEach\(\(layer, currentIndex\) => \{[\s\S]*?restoredLayers\.splice/);
  assert.match(drawingManagerSource, /layerData\.id === targetLayerId && targetShouldExist/);
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
  assert.match(drawingSyncSource, /if \(!keyframe\?\.canvasData && keyframe\?\.isEmpty !== true\) return;/);
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

test('피드백 35 v2: 획 선택 벡터 커밋·다중 선택·hover가 배선되어 있다', () => {
  // 벡터 커밋: 리프트가 이전과 동일하게 beginStrokeFloating을 폴백으로 보존
  assert.match(drawingCanvasSource, /this\._floatingRecords = list;/);
  assert.match(drawingCanvasSource, /addStrokeToFloating\(record\)/);
  assert.match(drawingCanvasSource, /_emit\('strokemarqueeselect'/);
  assert.match(drawingCanvasSource, /_emit\('strokehoverprobe'/);
  assert.match(drawingCanvasSource, /setHoverStroke\(record\)/);
  assert.match(drawingManagerSource, /_onSelectionCommitted\(detail = \{\}\)/);
  assert.match(drawingManagerSource, /createStrokeRecord\(\{\s*\n\s*\.\.\.record,/);
  assert.match(drawingManagerSource, /_onStrokeMarqueeSelect\(detail\)/);
  assert.match(drawingManagerSource, /strokesInRect\(readRecords, rect\)/);
  assert.match(drawingStrokeRecordsSource, /export function strokesInRect\(strokes, rect\)/);
});
