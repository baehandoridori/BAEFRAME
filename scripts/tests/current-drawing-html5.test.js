const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.resolve(__dirname, '../../renderer/scripts/app.js'), 'utf8');
const functions = new Map();
let commentModeChanged;
(function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'FunctionDeclaration') functions.set(node.id.name, source.slice(node.start, node.end));
  if (node.type === 'CallExpression' && node.callee.object?.name === 'commentManager' &&
      node.arguments[0]?.value === 'commentModeChanged') {
    commentModeChanged = source.slice(node.arguments[1].start, node.arguments[1].end);
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
})(acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
function install(context, ...names) {
  for (const name of names) vm.runInContext(functions.get(name), context);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(overrides = {}) {
  const calls = [];
  const classes = new Set();
  const context = vm.createContext({
    calls,
    state: { currentFile: 'original.mov', isAudioMode: false, isCommentMode: false },
    videoPlayer: { engine: 'html5', isLoaded: true, filePath: 'converted.mp4' },
    videoLoadIntentGeneration: 1, activeVideoLoadToken: null, latestVideoLoadToken: 3,
    drawingEntryRevision: 0, drawingEntryPromise: null,
    fabricDrawingPilotStatusSnapshot: {}, fabricDrawingPilotDegradedNoticeShown: false,
    document: { body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } } },
    window: { electronAPI: {
      mpvSetOverlayVisible: async visible => { calls.push(['visible', visible]); return { success: true, visible, ready: true }; },
      mpvUpdateOverlayState: async () => { calls.push(['state']); return { success: true }; }
    } },
    prepareMpvOverlayHost: async () => { calls.push(['prepare']); return { success: true }; },
    getMpvOverlayState: () => ({ drawingDataUrl: '', fabricViewport: {} }),
    initializeCurrentDrawing: async () => { calls.push(['initialize']); return true; },
    getFabricDrawingPilotContext: () => ({ stableVideoIdentity: 'original.mov' }),
    fabricDrawingPilotController: {
      beforeVideoChange: async () => { calls.push(['bind']); return true; },
      afterVideoReady: async () => { calls.push(['hydrate']); return true; },
      toggle: async () => { calls.push(['toggle']); return true; }
    },
    forceMpvHostVisibilitySync: () => calls.push(['show']),
    notifyFabricDrawingPilotFailure: () => calls.push(['failure']),
    commentManager: { setCommentMode() {} },
    setDrawModePreparingState() {}, setDrawModeReadyState() {}, resetViewportPanCycle() {},
    isFabricDrawingPilotControllerEngaged: () => false,
    hasBlockingOverlayForMpv: () => false,
    log: { warn() {}, debug() {} }, showToast() {},
    ...overrides
  });
  install(context, 'createMpvOverlayLifecycle', 'createMpvTeardownGate');
  vm.runInContext('var mpvOverlayLifecycle = createMpvOverlayLifecycle(); var mpvTeardownGate = createMpvTeardownGate();', context);
  install(context, 'isMpvPilotPlaybackActive', 'isHtml5DrawingSurfaceReady', 'isCurrentDrawingSurfaceReady', 'ensureHtml5DrawingSurface', 'shouldShowMpvHostForCurrentState', 'toggleDrawMode');
  install(context, 'exitDrawModeForSystemPath');
  return { context, calls, classes };
}

test('HTML5 entry hides, prepares, hydrates and toggles the current surface in order', async () => {
  const { context, calls } = fixture();
  assert.equal(await context.toggleDrawMode(), true);
  assert.deepEqual(calls.map(call => call[0]), ['initialize', 'bind', 'visible', 'prepare', 'state', 'hydrate', 'show', 'toggle']);
  assert.equal(calls[2][1], false);
  assert.equal(context.videoPlayer.engine, 'html5');
  assert.equal(context.isHtml5DrawingSurfaceReady(), true);
  assert.equal(context.shouldShowMpvHostForCurrentState(), true);
});

test('prepared surface stays hidden until hydration and during load; passive drawings remain visible for comments', async () => {
  const { context } = fixture();
  assert.equal(await context.ensureHtml5DrawingSurface(3), true);
  assert.equal(context.shouldShowMpvHostForCurrentState(), false);
  context.state.html5DrawingSurface.hydrated = true;
  assert.equal(context.shouldShowMpvHostForCurrentState(), true);
  context.state.isCommentMode = true;
  assert.equal(context.shouldShowMpvHostForCurrentState(), true);
  context.state.isCommentMode = false;
  context.activeVideoLoadToken = 4;
  assert.equal(context.shouldShowMpvHostForCurrentState(), false);
});

test('video change during prepare cannot adopt or show the previous surface', async () => {
  const wait = deferred();
  const { context, calls, classes } = fixture({ prepareMpvOverlayHost: () => wait.promise });
  const pending = context.toggleDrawMode();
  await new Promise(resolve => setImmediate(resolve));
  context.state.currentFile = 'next.mov';
  context.videoLoadIntentGeneration += 1;
  wait.resolve({ success: true });
  assert.equal(await pending, false);
  assert.equal(context.state.html5DrawingSurface, null);
  assert.equal(classes.has('drawing-surface-ready'), false);
  assert.equal(calls.some(call => ['hydrate', 'show', 'toggle', 'failure'].includes(call[0])), false);
});

test('repeated B while initializing has one entry and a failed initialization can retry', async () => {
  const wait = deferred();
  let attempts = 0;
  const { context, calls } = fixture({ initializeCurrentDrawing: () => { attempts++; return attempts === 1 ? wait.promise : Promise.resolve(true); } });
  const first = context.toggleDrawMode();
  const second = context.toggleDrawMode();
  wait.resolve(false);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(attempts, 1);
  assert.equal(calls.filter(call => call[0] === 'failure').length, 1);
  assert.equal(await context.toggleDrawMode(), true);
  assert.equal(attempts, 2);
  assert.equal(calls.filter(call => call[0] === 'toggle').length, 1);
});

test('failed hydration never exposes an empty or stale HTML5 surface', async () => {
  const { context, calls } = fixture();
  context.fabricDrawingPilotController.afterVideoReady = async () => false;
  assert.equal(await context.toggleDrawMode(), false);
  assert.equal(context.shouldShowMpvHostForCurrentState(), false);
  assert.equal(calls.some(call => ['show', 'toggle'].includes(call[0])), false);
  context.fabricDrawingPilotController.afterVideoReady = async () => true;
  assert.equal(await context.toggleDrawMode(), true);
  assert.equal(calls.filter(call => call[0] === 'bind').length, 2);
  assert.equal(context.shouldShowMpvHostForCurrentState(), true);
});

test('subsequent B uses the hydrated binding without resetting the document', async () => {
  const { context, calls } = fixture();
  assert.equal(await context.toggleDrawMode(), true);
  calls.length = 0;
  assert.equal(await context.toggleDrawMode(), true);
  assert.deepEqual(calls.map(call => call[0]), ['initialize', 'show', 'toggle']);
});

test('HTML5 visibility updates only the overlay and never the native video host', async () => {
  const { context, calls } = fixture();
  await context.toggleDrawMode();
  context.mpvHostVisibilityRequestRevision = 0;
  install(context, 'applyMpvHostVisibility');
  const result = await context.applyMpvHostVisibility(true);
  assert.equal(result.success, true);
  assert.equal(result.overlayOnly, true);
  assert.deepEqual(calls.at(-1), ['visible', true]);
});

test('native playback enters the same controller without creating an HTML5 surface', async () => {
  const { context, calls, classes } = fixture();
  context.videoPlayer.engine = 'mpv';
  classes.add('mpv-pilot-mode');
  assert.equal(await context.toggleDrawMode(), true);
  assert.deepEqual(calls.map(call => call[0]), ['initialize', 'bind', 'hydrate', 'toggle']);
});

test('B during controller preparing cancels the in-flight entry before its acknowledgement', async () => {
  const wait = deferred();
  const { context, calls } = fixture();
  let pilotState = 'passive';
  context.fabricDrawingPilotController.getState = () => pilotState;
  context.isFabricDrawingPilotControllerEngaged = () => pilotState === 'preparing';
  context.fabricDrawingPilotController.toggle = () => { pilotState = 'preparing'; return wait.promise; };
  context.fabricDrawingPilotController.disable = async () => { calls.push(['disable']); pilotState = 'passive'; return true; };
  const first = context.toggleDrawMode();
  await new Promise(resolve => setImmediate(resolve));
  const second = context.toggleDrawMode();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call[0] === 'disable').length, 1);
  wait.resolve(false);
  await Promise.all([first, second]);
  assert.equal(pilotState, 'passive');
});

test('C during initialization invalidates B and cannot be closed by its late result', async () => {
  const wait = deferred();
  const { context, calls } = fixture({ initializeCurrentDrawing: () => wait.promise });
  Object.assign(context, {
    commentModePreparationToken: 0, endVideoPan() {}, setCommentModePreparingState() {},
    setCommentModeReadyState() {}, showCommentModeGuidance() {}, scheduleMpvOverlayStateSync() {},
    syncCommentInteractionPolicy() {},
    elements: { videoWrapper: { classList: { toggle() {}, remove() {} } } }
  });
  const pending = context.toggleDrawMode();
  vm.runInContext(`(${commentModeChanged})({ detail: { isCommentMode: true } })`, context);
  wait.resolve(true);
  assert.equal(await pending, false);
  assert.equal(context.state.isCommentMode, true);
  assert.equal(calls.some(call => ['bind', 'hydrate', 'toggle'].includes(call[0])), false);
});

test('keyboard routing has no legacy authoring fallback after the current controller', () => {
  const keyboard = functions.get('handleKeydown');
  assert.doesNotMatch(keyboard, /drawingManager\.(?:addKeyframeWithContent|addBlankKeyframe|copyFrames|pasteFrames|convertKeyframeToFrame|convertFrameToKeyframe|insertFrame|deleteFrame|toggleLayerVisibility|toggleLayerLock)\(/);
  assert.match(keyboard, /fabricDrawingPilotController\.routeKeydown\(e\)/);
  assert.match(keyboard, /applyDrawingLayerStateChange\(/);
});

test('a rejected navigation intent preserves the loaded HTML5 drawing surface', async () => {
  const { context } = fixture();
  await context.toggleDrawMode();
  context.videoLoadIntentGeneration += 1;
  context.activeVideoLoadToken = 4;
  assert.equal(context.shouldShowMpvHostForCurrentState(), false);
  // A save/navigation guard rejects before the destructive media change.
  context.activeVideoLoadToken = null;
  assert.equal(context.isHtml5DrawingSurfaceReady(), true);
  assert.equal(context.shouldShowMpvHostForCurrentState(), true);
  context.state.currentFile = 'next.mov';
  assert.equal(context.isHtml5DrawingSurfaceReady(), false);
});

test('HTML5 host recreation preserves active drawing with the actual controller', async () => {
  const { createFabricDrawingPilotController } = await import('../../renderer/scripts/modules/fabric-drawing-pilot-controller.js');
  const { context } = fixture();
  const inputs = [];
  let requestedVisible = true;
  const preparedVisibility = [];
  Object.assign(context, {
    mpvOverlayRecoveryOwner: null, mpvOverlayRecoveryInFlightOwner: null, mpvOverlaySyncEpoch: 0,
    scheduleMpvOverlayStateSync() {}, scheduleMpvOverlayRemoteCursorStateSync() {},
    scheduleMpvOverlayCollaborationStateSync() {}, fallbackFromMpvOverlayRecoveryFailureOnce() {},
    getMpvEmbedBounds: () => ({ x: 0, y: 0, width: 640, height: 360 })
  });
  context.log.info = () => {};
  const api = context.window.electronAPI;
  Object.assign(api, {
    getFabricDrawingPilotState: async () => true,
    mpvDestroyOverlay: async () => { requestedVisible = true; return { success: true }; },
    mpvSetOverlayVisible: async visible => { requestedVisible = visible; return { success: true, visible }; },
    mpvPrepareOverlay: async () => {
      preparedVisibility.push(requestedVisible);
      return { success: true, drawingCapability: { passiveReady: true, hostGeneration: 2 } };
    },
    mpvSetOverlayDrawingInput: async request => { inputs.push(request.enabled); return { success: true, accepted: true, enabled: request.enabled }; },
    mpvUpdateOverlayDrawingTool: async request => ({ success: true, accepted: true, tool: request.tool })
  });
  const controller = createFabricDrawingPilotController({
    electronAPI: api,
    getContext: () => ({
      isDrawingSurfaceReady: context.isHtml5DrawingSurfaceReady(), isAudio: false,
      stableVideoIdentity: 'original.mov', targetFrame: 0, sourceWidth: 640, sourceHeight: 360,
      canvasRect: { x: 0, y: 0, width: 640, height: 360 }
    })
  });
  context.fabricDrawingPilotController = controller;
  context.initializeCurrentDrawing = () => controller.initialize();
  install(context, 'prepareMpvOverlayHost', 'recoverMpvOverlayHostOnce');
  const owner = context.mpvOverlayLifecycle.begin(3);
  context.state.html5DrawingSurface = { owner, ready: true, hydrated: true, filePath: 'original.mov', intent: 1 };
  context.mpvOverlayLifecycle.markReady(owner);
  await controller.initialize();
  await controller.adoptOverlayCapability({ passiveReady: true, hostGeneration: 1 });
  await controller.afterVideoReady({ loadToken: 3 });
  assert.equal(await controller.toggle(), true);
  assert.equal(controller.getState(), 'active');
  context.mpvOverlayLifecycle.markUnavailable(owner, 'failed update');
  assert.equal(context.recoverMpvOverlayHostOnce(owner, 'failed update'), true);
  await context.mpvTeardownGate.waitForIdle();
  assert.equal(controller.getState(), 'active');
  assert.equal(inputs.at(-1), true);
  assert.deepEqual(preparedVisibility, [false], 'destroy resets visibility, so replacement preparation must hide again');
  assert.equal(context.isHtml5DrawingSurfaceReady(), true);
});

test('a late host recreation cannot adopt over the next video owner', async () => {
  const wait = deferred();
  const { context, calls } = fixture({ prepareMpvOverlayHost: () => wait.promise });
  Object.assign(context, {
    mpvOverlayRecoveryOwner: null, mpvOverlayRecoveryInFlightOwner: null, mpvOverlaySyncEpoch: 0,
    fallbackFromMpvOverlayRecoveryFailureOnce() {}
  });
  context.window.electronAPI.mpvDestroyOverlay = async () => ({ success: true });
  context.fabricDrawingPilotController.adoptOverlayCapability = async () => { calls.push(['adopt']); return true; };
  install(context, 'recoverMpvOverlayHostOnce');
  const oldOwner = context.mpvOverlayLifecycle.begin(3);
  context.state.html5DrawingSurface = { owner: oldOwner, ready: true, hydrated: true, filePath: 'original.mov' };
  context.recoverMpvOverlayHostOnce(oldOwner, 'failed update');
  await new Promise(resolve => setImmediate(resolve));
  context.state.currentFile = 'next.mov';
  const nextOwner = context.mpvOverlayLifecycle.begin(4);
  context.state.html5DrawingSurface = { owner: nextOwner, ready: true, hydrated: true, filePath: 'next.mov' };
  context.mpvOverlayLifecycle.markReady(nextOwner);
  wait.resolve({ success: true, drawingCapability: { passiveReady: true, hostGeneration: 2 } });
  await context.mpvTeardownGate.waitForIdle();
  assert.equal(calls.some(call => call[0] === 'adopt'), false);
  assert.equal(context.isHtml5DrawingSurfaceReady(), true);
  assert.equal(context.state.html5DrawingSurface.owner, nextOwner);
});

function overlayStateFixture(engine) {
  let legacyCaptures = 0;
  const fabricViewport = { canvasRect: { left: 0, top: 0, width: 640, height: 360 }, scale: 2, panX: 20, panY: -10 };
  const compositionLayers = [{ id: 'composition-1' }];
  const context = vm.createContext({
    videoPlayer: { engine, currentTime: 0, isPlaying: false, isBuffering: false },
    state: { isDrawMode: false },
    elements: {
      videoWrapper: { getBoundingClientRect: () => ({ left: 100, top: 50 }) },
      drawingCanvas: { getBoundingClientRect: () => ({ left: -200, top: -140, width: 1280, height: 720 }) }
    },
    // A valid drawingsV3 document owns input while old raster drawings coexist.
    shouldSuppressLegacyDrawingForFabricPilot: () => true,
    isFabricDrawingPilotControllerEngaged: () => false,
    getCompositedDrawingOverlayDataUrl: () => { legacyCaptures++; return 'data:image/png;base64,bGVnYWN5'; },
    remoteStrokeOverlayForMpv: null,
    drawingManager: { onionSkin: { enabled: false } },
    getFabricDrawingPilotViewport: () => fabricViewport,
    serializeMpvOverlayMarkerHtml: () => '', serializeMpvOverlayTooltipHtml: () => '',
    serializeMpvOverlayHtml: () => '', serializeMpvOverlayToastHtml: () => '',
    compositionLayerManager: { getMpvOverlayLayers: () => compositionLayers },
    videoCommentPlayhead: null, markerContainer: null,
    getMpvVideoTransform: () => ({ zoom: 1, panX: 20, panY: -10 }),
    getMpvOverlayDrawModeShortcutDescriptor: () => null,
    userSettings: { getShortcut: () => null }
  });
  install(context, 'getMpvOverlayState');
  return { context, fabricViewport, compositionLayers, legacyCaptures: () => legacyCaptures };
}

test('native current drawings retain one legacy raster mirror and existing composition geometry', () => {
  const fixture = overlayStateFixture('mpv');
  const state = fixture.context.getMpvOverlayState();
  assert.equal(state.drawingDataUrl, 'data:image/png;base64,bGVnYWN5');
  assert.equal(fixture.legacyCaptures(), 1);
  assert.equal(state.fabricViewport, fixture.fabricViewport);
  assert.equal(state.compositionLayers, fixture.compositionLayers);
  assert.deepEqual({ ...state.canvas }, { left: -300, top: -190, width: 1280, height: 720 });
});

test('HTML5 keeps the legacy renderer canvas without creating a second raster or composition mirror', () => {
  const fixture = overlayStateFixture('html5');
  const state = fixture.context.getMpvOverlayState();
  assert.equal(state.drawingDataUrl, '');
  assert.equal(fixture.legacyCaptures(), 0);
  assert.equal(state.compositionLayers.length, 0);
  assert.equal(state.fabricViewport, fixture.fabricViewport);
});

function reviewFreezeFixture({ legacyLayers = [], currentObjects = [], screenshotSuccess = true } = {}) {
  const calls = [];
  const keyframe = { frame: 12, objects: currentObjects };
  const context = vm.createContext({
    state: { currentFile: 'original.mp4' },
    videoPlayer: { currentFrame: 12 },
    fabricDrawingPersistenceStore: { resolveKeyframeAtFrame: frame => { assert.equal(frame, 12); return keyframe; } },
    reviewDataManager: { getDrawingLayers: () => ({}) },
    window: { electronAPI: { mpvScreenshot: async () => ({ success: screenshotSuccess, dataUrl: 'video-frame' }) } },
    drawingManager: {
      layers: legacyLayers,
      renderFrame: async frame => { calls.push(['render', frame]); }
    },
    getCompositedDrawingOverlayDataUrl: () => { calls.push(['legacy']); return 'legacy-raster'; },
    loadReviewDrawingFreezeRenderer: async () => ({
      composite: async (...args) => { calls.push(['composite', ...args]); return 'combined-frame'; }
    })
  });
  install(context, 'captureMpvReviewFrameWithDrawings');
  return { context, calls };
}

function legacyLayer({ visible = true, opacity = 1, empty = false, data = 'saved-raster' } = {}) {
  return { visible, opacity, getKeyframeAtFrame: frame => {
    assert.equal(frame, 12);
    return { frame: 8, isEmpty: empty, canvasData: data };
  } };
}

test('native comment capture waits for the held legacy frame and includes legacy-only drawings', async () => {
  const f = reviewFreezeFixture({ legacyLayers: [legacyLayer()] });
  const rendered = deferred();
  f.context.drawingManager.renderFrame = frame => { f.calls.push(['render', frame]); return rendered.promise; };
  const capture = f.context.captureMpvReviewFrameWithDrawings();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(call => call[0]), ['render']);
  rendered.resolve();
  assert.equal((await capture).dataUrl, 'combined-frame');
  assert.deepEqual(f.calls.map(call => call[0]), ['render', 'legacy', 'composite']);
  assert.equal(f.calls.at(-1)[4], 'legacy-raster');
});

test('native comment capture sends coexisting current and old raster drawings exactly once', async () => {
  const f = reviewFreezeFixture({ legacyLayers: [legacyLayer()], currentObjects: [{ id: 'stroke' }] });
  await f.context.captureMpvReviewFrameWithDrawings();
  assert.equal(f.calls.at(-1)[2].objects.length, 1);
  assert.equal(f.calls.at(-1)[4], 'legacy-raster');
  assert.equal(f.calls.filter(call => call[0] === 'legacy').length, 1);
});

test('hidden, transparent, empty and missing legacy frames skip raster capture while current drawings remain', async () => {
  const f = reviewFreezeFixture({
    legacyLayers: [legacyLayer({ visible: false }), legacyLayer({ opacity: 0 }), legacyLayer({ empty: true }), legacyLayer({ data: null })],
    currentObjects: [{ id: 'stroke' }]
  });
  await f.context.captureMpvReviewFrameWithDrawings();
  assert.deepEqual(f.calls.map(call => call[0]), ['composite']);
  assert.equal(f.calls[0][4], '');
});

test('empty or failed native screenshots keep the fast path without legacy canvas work', async () => {
  const empty = reviewFreezeFixture();
  assert.equal((await empty.context.captureMpvReviewFrameWithDrawings()).dataUrl, 'video-frame');
  assert.deepEqual(empty.calls, []);
  const failed = reviewFreezeFixture({ legacyLayers: [legacyLayer()], screenshotSuccess: false });
  assert.equal((await failed.context.captureMpvReviewFrameWithDrawings()).success, false);
  assert.deepEqual(failed.calls, []);
});

for (const change of ['seek', 'video']) {
  test(`a ${change} during native screenshot capture cannot redraw or composite the stale legacy frame`, async () => {
    const f = reviewFreezeFixture({ legacyLayers: [legacyLayer()], currentObjects: [{ id: 'stroke' }] });
    const screenshot = deferred();
    f.context.window.electronAPI.mpvScreenshot = () => screenshot.promise;
    const capture = f.context.captureMpvReviewFrameWithDrawings();
    if (change === 'seek') f.context.videoPlayer.currentFrame = 30;
    else f.context.state.currentFile = 'next.mp4';
    const original = { success: true, dataUrl: 'old-frame' };
    screenshot.resolve(original);
    assert.equal(await capture, original);
    assert.deepEqual(f.calls, []);
  });
}

test('a seek while the old raster render settles cannot read back the next frame canvas', async () => {
  const f = reviewFreezeFixture({ legacyLayers: [legacyLayer()] });
  const rendered = deferred();
  f.context.drawingManager.renderFrame = frame => { f.calls.push(['render', frame]); return rendered.promise; };
  const capture = f.context.captureMpvReviewFrameWithDrawings();
  await new Promise(resolve => setImmediate(resolve));
  f.context.videoPlayer.currentFrame = 30;
  rendered.resolve();
  assert.equal((await capture).dataUrl, 'video-frame');
  assert.deepEqual(f.calls, [['render', 12]]);
});
