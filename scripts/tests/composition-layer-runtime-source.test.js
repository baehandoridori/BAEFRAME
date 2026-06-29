const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainStyles = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const reviewDataSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/review-data-manager.js'), 'utf8'));
const mpvOverlayHostSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/mpv-overlay-host.js'), 'utf8'));
const compositionManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/composition-layer-manager.js'), 'utf8'));
const drawingManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-manager.js'), 'utf8'));
const schemaDocs = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'docs/bframe-schema.md'), 'utf8'));

test('renderer exposes layer compositing controls and surfaces', () => {
  assert.match(indexSource, /id="btnLayerCompositing"/);
  assert.match(indexSource, /id="compositionLayerOverlay"/);
  assert.match(indexSource, /id="compositionLayerPanel"/);
  assert.match(indexSource, /id="compositionLayerList"/);
  assert.match(indexSource, /id="btnCompositionLayerAdd"/);

  assert.match(mainStyles, /\.composition-layer-overlay/);
  assert.match(mainStyles, /\.composition-layer-panel/);
  assert.match(mainStyles, /\.composition-layer-transform-handle/);
  assert.match(mainStyles, /--composition-layer-color/);
  assert.match(mainStyles, /\.composition-layer-context-menu/);
  assert.match(mainStyles, /\.composition-layer-media-status/);
  assert.match(mainStyles, /\.composition-layer-panel-resize/);
  assert.match(mainStyles, /\.composition-layer-snap-guide/);
  assert.match(mainStyles, /\.composition-layer-range/);
  assert.match(mainStyles, /\.composition-layer-overflow-badge/);
});

test('app wires composition manager into video, timeline, save, drop, and mpv overlay state', () => {
  assert.match(appSource, /import \{ CompositionLayerManager \} from '\.\/modules\/composition-layer-manager\.js';/);
  assert.match(appSource, /const compositionLayerManager = new CompositionLayerManager\(\{/);
  assert.match(appSource, /compositionLayerManager,\s*\n\s*autoSave: true/);
  assert.match(appSource, /btnLayerCompositing: document\.getElementById\('btnLayerCompositing'\)/);
  assert.match(appSource, /compositionLayerOverlay: document\.getElementById\('compositionLayerOverlay'\)/);
  assert.match(appSource, /compositionLayerPanel: document\.getElementById\('compositionLayerPanel'\)/);
  assert.match(appSource, /elements\.btnLayerCompositing\?\.addEventListener\('click'/);
  assert.match(appSource, /compositionLayerManager\.addLayerFromFile/);
  assert.match(appSource, /prepareMedia: prepareCompositionLayerMedia/);
  assert.match(appSource, /async function prepareCompositionLayerMedia\(filePath\)/);
  assert.match(appSource, /ffmpegProbeCodec\(filePath\)/);
  assert.match(appSource, /ffmpegCheckCache\(filePath\)/);
  assert.match(appSource, /timeline\.renderCompositionLayers\(compositionLayerManager\.toJSON\(\)/);
  assert.match(appSource, /timeline\.addEventListener\('compositionLayerRangeChange'/);
  assert.match(appSource, /compositionLayers: compositionLayerManager\.getMpvOverlayLayers\(/);
  assert.match(appSource, /scheduleMpvOverlayStateSync\(\{ force: true \}\)/);
});

test('review data manager saves and restores compositionLayers', () => {
  assert.match(reviewDataSource, /this\.compositionLayerManager = options\.compositionLayerManager;/);
  assert.match(reviewDataSource, /this\.compositionLayerManager\.addEventListener\('changed', this\._onDataChanged\)/);
  assert.match(reviewDataSource, /compositionLayers: this\.compositionLayerManager\?\.toJSON\(\) \|\| \[\]/);
  assert.match(reviewDataSource, /this\.compositionLayerManager\.fromJSON\(data\.compositionLayers \|\| \[\]\)/);
});

test('review data manager clears compositionLayers when a review has no bframe data', () => {
  const noDataLoadBranch = reviewDataSource.match(/if \(!data\) \{[\s\S]*?return false;\s*\}/)?.[0] || '';
  assert.match(noDataLoadBranch, /this\.compositionLayerManager\?\.fromJSON\?\.\(\[\]\);/);
});

test('timeline can render and drag composition layer ranges', () => {
  assert.match(timelineSource, /renderCompositionLayers\(layers, options = \{\}\) \{/);
  assert.match(timelineSource, /composition-layer-track-row/);
  assert.match(timelineSource, /composition-layer-range/);
  assert.match(timelineSource, /composition-layer-overflow-badge/);
  assert.match(timelineSource, /compositionLayerSelect/);
  assert.match(timelineSource, /compositionLayerVisibilityToggle/);
  assert.match(timelineSource, /compositionLayerRangeChange/);
  assert.match(timelineSource, /--composition-layer-color/);
  assert.match(timelineSource, /--composition-layer-selected-color/);
});

test('mpv overlay host accepts synchronized composition layer state', () => {
  assert.match(mpvOverlayHostSource, /compositionLayers/);
  assert.match(mpvOverlayHostSource, /function applyCompositionLayers/);
  assert.match(mpvOverlayHostSource, /function applyCompositionMirrorFrame\(root, canvas\)/);
  assert.match(mpvOverlayHostSource, /composition-layer-mirror/);
  assert.match(mpvOverlayHostSource, /element\.muted = true/);
  assert.match(mpvOverlayHostSource, /applyCompositionLayers\(nextState\.compositionLayers, nextState\.canvas\)/);
});

test('composition overlay keeps media elements stable during playback sync', () => {
  assert.doesNotMatch(compositionManagerSource, /overlay\.innerHTML\s*=\s*visibleLayers\.map/);
  const playbackMethod = compositionManagerSource.match(/setPlaybackState\([^]*?\n  }\n\n  getLayer/)?.[0] || '';
  assert.doesNotMatch(playbackMethod, /this\.renderOverlay\(\);/);
  assert.match(playbackMethod, /this\.renderOverlay\(\{ playbackOnly: true \}\);/);
  assert.match(compositionManagerSource, /_syncOverlayVideoPlayback\(/);
  assert.match(compositionManagerSource, /_getOrCreateOverlayLayerElement\(/);
});

test('composition playback changes force mpv overlay mirror sync', () => {
  assert.match(appSource, /function syncCompositionLayerPlaybackState\(currentTime, isPlaying\) \{/);
  assert.match(appSource, /compositionLayerManager\.toJSON\(\)\.length > 0/);
  assert.match(appSource, /scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(compositionManagerSource, /const seekThreshold = this\.isPlaying \? 0\.08 : 0\.001;/);
  assert.match(mpvOverlayHostSource, /const seekThreshold = layer\.isPlaying \? 0\.08 : 0\.001;/);
});

test('composition panel slider drag is isolated from layer reorder drag', () => {
  assert.doesNotMatch(compositionManagerSource, /<div class="composition-layer-item[^>]*draggable="true"/);
  assert.match(compositionManagerSource, /composition-layer-drag[^>]+draggable="true"/);
  assert.match(compositionManagerSource, /closest\?\.\('\.composition-layer-drag'\)/);
});

test('composition panel exposes second-pass editing controls', () => {
  assert.match(compositionManagerSource, /data-action="move-up"/);
  assert.match(compositionManagerSource, /data-action="move-down"/);
  assert.match(compositionManagerSource, /data-action="open-menu"/);
  assert.match(compositionManagerSource, /composition-layer-context-menu/);
  assert.match(compositionManagerSource, /data-action="menu-duplicate"/);
  assert.match(compositionManagerSource, /data-action="menu-delete"/);
  assert.match(compositionManagerSource, /data-action="menu-name"/);
  assert.match(compositionManagerSource, /data-action="menu-color"/);
  assert.match(compositionManagerSource, /composition-layer-source-path/);
  assert.match(compositionManagerSource, /data-action="aspect-lock"/);
  assert.match(compositionManagerSource, /data-action="relink"/);
  assert.doesNotMatch(compositionManagerSource, /data-action="layer-color"/);
  assert.doesNotMatch(compositionManagerSource, /data-action="selected-color"/);
  assert.match(compositionManagerSource, /composition-layer-media-status/);
  assert.match(compositionManagerSource, /duplicateLayer\(layerId/);
  assert.match(compositionManagerSource, /moveLayerByOffset\(layerId/);
  assert.match(compositionManagerSource, /relinkLayerFile\(layerId/);
});

test('composition overlay uses snap guides and aspect-aware resize helpers', () => {
  assert.match(compositionManagerSource, /resizeLayerRect\(/);
  assert.match(compositionManagerSource, /snapCompositionLayerRect\(/);
  assert.match(compositionManagerSource, /_renderSnapGuides/);
  assert.match(compositionManagerSource, /_clearSnapGuides/);
});

test('composition panel can collapse and move without blocking layer controls', () => {
  assert.match(indexSource, /id="btnCompositionLayerPanelCollapse"/);
  assert.match(mainStyles, /\.composition-layer-panel\.collapsed/);
  assert.match(compositionManagerSource, /_handlePanelResizePointerDown/);
  assert.match(compositionManagerSource, /_handlePanelHeaderPointerDown/);
  assert.match(compositionManagerSource, /_setPanelPosition/);
});

test('composition panel isolates wheel scrolling from viewer zoom', () => {
  assert.match(compositionManagerSource, /addEventListener\('wheel'/);
  assert.match(compositionManagerSource, /event\.stopPropagation\(\)/);
});

test('composition timeline headers expose layer controls and media type labels', () => {
  assert.match(timelineSource, /composition-layer-header-visibility/);
  assert.match(timelineSource, /data-action="composition-visibility"/);
  assert.match(timelineSource, /composition-layer-header-type/);
  assert.match(timelineSource, /_getCompositionLayerTypeIcon/);
  assert.doesNotMatch(timelineSource, />\$\{typeLabel\}<\/span>/);
});

test('composition timeline headers support drag reorder through the app bridge', () => {
  assert.match(timelineSource, /composition-layer-header-drag/);
  assert.match(timelineSource, /header\.draggable = true/);
  assert.match(timelineSource, /application\/x-baeframe-composition-layer/);
  assert.match(timelineSource, /compositionLayerReorder/);
  assert.match(timelineSource, /is-drop-before/);
  assert.match(timelineSource, /is-drop-after/);
  assert.match(appSource, /timeline\.addEventListener\('compositionLayerReorder'/);
  assert.match(appSource, /compositionLayerManager\.reorderLayerByDisplayTarget/);
});

test('composition panel reorder drag exposes live drop feedback classes', () => {
  assert.match(compositionManagerSource, /reorderLayerByDisplayTarget\(layerId, targetLayerId, placement = 'before'\)/);
  assert.match(compositionManagerSource, /_getReorderIndexFromDisplayTarget/);
  assert.match(compositionManagerSource, /is-dragging/);
  assert.match(compositionManagerSource, /is-drop-before/);
  assert.match(compositionManagerSource, /is-drop-after/);
  assert.match(compositionManagerSource, /_clearPanelDragFeedback/);
  assert.match(mainStyles, /\.composition-layer-item\s*\{[^}]*transition:/s);
  assert.match(mainStyles, /\.composition-layer-item\.is-dragging/);
  assert.match(mainStyles, /\.composition-layer-item\.is-drop-before/);
  assert.match(mainStyles, /\.composition-layer-header\.is-drop-before/);
});

test('composition layer panel uses svg media icons and reliable menu opening', () => {
  assert.match(compositionManagerSource, /function getCompositionLayerTypeIcon\(type\)/);
  assert.match(compositionManagerSource, /composition-layer-media-icon/);
  assert.doesNotMatch(compositionManagerSource, />\$\{typeLabel\}<\/span>/);
  assert.match(compositionManagerSource, /this\.contextMenuState = \{\s*layerId,/);
  assert.match(compositionManagerSource, /this\.selectLayer\(layerId, \{ renderPanel: false \}\)/);
  assert.match(mainStyles, /\.composition-layer-opacity\s*\{[^}]*max-width:\s*150px;/s);
  assert.match(mainStyles, /\.composition-layer-opacity input\[type="range"\]/);
});

test('composition file drop asks whether video should open or overlay', () => {
  assert.match(appSource, /async function chooseDroppedVideoAction\(filePath\)/);
  assert.match(appSource, /기준 영상으로 열기/);
  assert.match(appSource, /합성 레이어로 얹기/);
  assert.match(appSource, /chooseDroppedVideoAction\(file\.path\)/);
});

test('composition media preparation preserves alpha-capable web media originals', () => {
  assert.match(appSource, /function isAlphaPreservingCompositionMedia\(filePath\)/);
  assert.match(appSource, /ALPHA_PRESERVING_COMPOSITION_EXTENSIONS/);
  assert.match(appSource, /webm/);
  assert.match(appSource, /webp/);
  assert.match(appSource, /isAlphaPreservingCompositionMedia\(filePath\)/);
});

test('composition live edits avoid full panel and timeline churn until commit', () => {
  assert.match(compositionManagerSource, /this\.updateLayer\(layerId, snapped\.rect, \{\s*recordUndo: false,\s*renderPanel: false,\s*renderTimeline: false,\s*emitChange: false,\s*scheduleOverlaySync: false\s*\}\);/);
  assert.match(compositionManagerSource, /this\._changed\('layerTransformed'/);
  assert.match(compositionManagerSource, /renderPanel: !isLiveInput,\s*emitChange: !isLiveInput,\s*scheduleOverlaySync: !isLiveInput/);
});

test('draw mode lets the drawing canvas receive events above composition layers', () => {
  assert.match(appSource, /elements\.videoWrapper\?\.classList\.toggle\('drawing-mode', state\.isDrawMode\);/);
  assert.match(mainStyles, /\.video-wrapper\.drawing-mode \.composition-layer-preview\s*\{[^}]*pointer-events:\s*none;/s);
});

test('drawing preload cache cleanup does not spam renderer logs during playback', () => {
  assert.doesNotMatch(drawingManagerSource, /log\.debug\('캐시 정리'/);
});

test('bframe schema documentation includes compositionLayers', () => {
  assert.match(schemaDocs, /compositionLayers/);
  assert.match(schemaDocs, /레이어 합성/);
  assert.match(schemaDocs, /filePath/);
});
