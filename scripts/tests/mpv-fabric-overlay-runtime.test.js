const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const runtimePath = path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-overlay-runtime.js');
const drawingV3AdapterPath = path.join(
  rootDir,
  'renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js'
);
const {
  createFabricOverlayRuntime,
  createSessionSceneStore,
  createStrokePathData,
  resolveEffectiveCanvasRect,
  resolveSelectionHitTolerance,
  mapClientPointToSource,
  splitStrokePointsByPolygon
} = require(runtimePath);
const {
  polygonHasArea
} = require(path.join(rootDir, 'renderer/scripts/modules/drawing-v3/lasso-geometry.js'));
const {
  createDrawingEngineAdapter
} = require(drawingV3AdapterPath);

function runAutoSingletonProbe(source) {
  const result = spawnSync(process.execPath, ['-e', [
    "'use strict';",
    `const runtimePath = ${JSON.stringify(runtimePath)};`,
    "const emit = value => console.log('__BAEFRAME_PROBE__' + JSON.stringify(value));",
    source
  ].join('\n')], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, [
    'isolated runtime probe failed',
    result.stdout,
    result.stderr
  ].filter(Boolean).join('\n'));
  const outputLine = result.stdout
    .split(/\r?\n/)
    .find(line => line.startsWith('__BAEFRAME_PROBE__'));
  assert.ok(outputLine, `isolated runtime probe returned no result:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(outputLine.slice('__BAEFRAME_PROBE__'.length));
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
    this.className = '';
    this.textContent = '';
    this.listeners = new Map();
    this.capturedPointerIds = new Set();
    this.pointerCaptureRequests = [];
    this.pointerReleaseRequests = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter(candidate => candidate !== child);
    child.parentNode = null;
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  setPointerCapture(pointerId) {
    this.pointerCaptureRequests.push(pointerId);
    this.capturedPointerIds.add(pointerId);
  }

  releasePointerCapture(pointerId) {
    this.pointerReleaseRequests.push(pointerId);
    this.capturedPointerIds.delete(pointerId);
  }

  hasPointerCapture(pointerId) {
    return this.capturedPointerIds.has(pointerId);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  dispatch(type, event = {}) {
    const payload = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      setPointerCapture() {},
      releasePointerCapture() {},
      ...event
    };
    for (const listener of this.listeners.get(type) || []) listener(payload);
  }

  querySelectorAllByClass(className) {
    const matches = this.className.split(/\s+/).includes(className) ? [this] : [];
    return matches.concat(this.children.flatMap(child => child.querySelectorAllByClass(className)));
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

class FakePath {
  constructor(pathData, options = {}) {
    this.pathData = pathData;
    this.left = 0;
    this.top = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.angle = 0;
    this.skewX = 0;
    this.skewY = 0;
    this.flipX = false;
    this.flipY = false;
    Object.assign(this, options);
  }

  set(values) {
    Object.assign(this, values);
    return this;
  }

  setCoords() {}
}

class FakeCanvas {
  static instances = [];

  constructor(element, options) {
    this.lowerCanvasEl = element;
    this.upperCanvasEl = element;
    this.wrapperEl = new FakeElement('div', element.ownerDocument);
    this.options = options;
    this.defaultCursor = options.defaultCursor;
    this.hoverCursor = options.hoverCursor;
    this.moveCursor = options.moveCursor;
    this.freeDrawingCursor = options.freeDrawingCursor;
    this.targetFindTolerance = 0;
    this.cursorHistory = [];
    this.selection = options.selection;
    this.isDrawingMode = false;
    this.objects = [];
    this.activeObjects = [];
    this.activeObject = null;
    this.listeners = new Map();
    this.dimensionCalls = [];
    this.calcOffsetCalls = 0;
    this.disposed = false;
    FakeCanvas.instances.push(this);
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  add(object) {
    this.objects.push(object);
    return object;
  }

  remove(object) {
    this.objects = this.objects.filter(candidate => candidate !== object);
    this.activeObjects = this.activeObjects.filter(candidate => candidate !== object);
  }

  clear() {
    this.objects = [];
    this.activeObjects = [];
  }

  getObjects() {
    return [...this.objects];
  }

  getActiveObjects() {
    return [...this.activeObjects];
  }

  getActiveObject() {
    return this.activeObject || this.activeObjects[0] || null;
  }

  discardActiveObject() {
    this.activeObjects = [];
    this.activeObject = null;
  }

  setTargetFindTolerance(value) {
    this.targetFindTolerance = Math.round(value);
  }

  setCursor(value) {
    this.upperCanvasEl.style.cursor = value;
    this.cursorHistory.push(value);
  }

  setDimensions(dimensions, options = {}) {
    this.dimensionCalls.push({ dimensions: { ...dimensions }, options: { ...options } });
    if (options.backstoreOnly) {
      this.lowerCanvasEl.width = dimensions.width;
      this.lowerCanvasEl.height = dimensions.height;
      this.upperCanvasEl.width = dimensions.width;
      this.upperCanvasEl.height = dimensions.height;
    }
    if (options.cssOnly) {
      for (const element of [this.lowerCanvasEl, this.upperCanvasEl, this.wrapperEl]) {
        element.style.width = `${dimensions.width}px`;
        element.style.height = `${dimensions.height}px`;
      }
    }
  }

  calcOffset() {
    this.calcOffsetCalls += 1;
  }

  requestRenderAll() {}

  dispose() {
    this.disposed = true;
  }
}

const makeInput = (overrides = {}) => ({
  hostGeneration: 1,
  videoGeneration: 1,
  inputRevision: 1,
  enabled: true,
  session: {
    sessionId: 'runtime-session',
    stableVideoIdentity: 'runtime-video',
    targetFrame: 24,
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { left: 0, top: 0, width: 960, height: 540 },
    tool: 'brush'
  },
  ...overrides
});

const drawStroke = (element, pointerId = 1) => {
  element.dispatch('pointerdown', {
    pointerId,
    pointerType: 'pen',
    button: 0,
    clientX: 10,
    clientY: 20,
    pressure: 0.2,
    timeStamp: 1
  });
  element.dispatch('pointermove', {
    pointerId,
    pointerType: 'pen',
    clientX: 30,
    clientY: 40,
    pressure: 0.8,
    timeStamp: 2
  });
  element.dispatch('pointerup', {
    pointerId,
    pointerType: 'pen',
    clientX: 50,
    clientY: 60,
    pressure: 0.6,
    timeStamp: 3
  });
};

function findAll(root, predicate) {
  if (!root) return [];
  const matches = predicate(root) ? [root] : [];
  return matches.concat(Array.from(root.children || []).flatMap(child => findAll(child, predicate)));
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function getBrushControls(root) {
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  return {
    toolbar,
    undoButton: findOne(toolbar, node => node.dataset.fabricPilotAction === 'undo'),
    redoButton: findOne(toolbar, node => node.dataset.fabricPilotAction === 'redo'),
    settingsButton: findOne(toolbar, node => node.dataset.fabricPilotAction === 'brush-settings'),
    panel: findOne(toolbar, node => node.dataset.fabricPilotPanel === 'brush-settings'),
    colorButtons: findAll(toolbar, node => typeof node.dataset.fabricPilotColor === 'string'),
    sizeInput: findOne(toolbar, node => node.dataset.fabricPilotSetting === 'size'),
    opacityInput: findOne(toolbar, node => node.dataset.fabricPilotSetting === 'opacity'),
    sizeOutput: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'size'),
    opacityOutput: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'opacity'),
    summary: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'summary'),
    colorPreview: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'color-preview'),
    sizePreview: findOne(toolbar, node => node.dataset.fabricPilotOutput === 'size-preview'),
    sizeDecrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'size-decrease'),
    sizeIncrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'size-increase'),
    opacityDecrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'opacity-decrease'),
    opacityIncrease: findOne(toolbar, node => node.dataset.fabricPilotAction === 'opacity-increase')
  };
}

function makeHistoryStroke(id, overrides = {}) {
  const base = {
    id,
    type: 'stroke',
    pathData: `M 0 0 L ${id.length + 1} ${id.length + 2} Z`,
    sourcePoints: [
      { x: 0, y: 0, pressure: 0.5, pointerType: 'pen', time: 0 },
      { x: id.length + 1, y: id.length + 2, pressure: 0.5, pointerType: 'pen', time: 1 }
    ],
    style: { color: '#ff4757', size: 3, opacity: 1 },
    transform: {
      left: 0,
      top: 0,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      skewX: 0,
      skewY: 0,
      flipX: false,
      flipY: false
    }
  };
  return {
    ...base,
    ...overrides,
    style: { ...base.style, ...(overrides.style || {}) },
    transform: { ...base.transform, ...(overrides.transform || {}) }
  };
}

function makePersistenceHydration(overrides = {}) {
  return {
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'runtime-persistence-session',
    stableVideoIdentity: 'runtime-video',
    fps: 24,
    totalFrames: 240,
    keyframes: [],
    ...overrides
  };
}

function makePersistenceExport(overrides = {}) {
  const request = makePersistenceHydration(overrides);
  delete request.keyframes;
  return request;
}

function createHistoryHarness(storeOptions = {}) {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sceneStore = createSessionSceneStore(storeOptions);
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    sceneStore
  });
  assert.equal(runtime.prepare(root).prepared, true);
  assert.equal(runtime.setDrawingInput(makeInput()).accepted, true);
  return { document, root, sceneStore, runtime, canvas: FakeCanvas.instances[0] };
}

function assertHistoryDiagnostics(harness, expected) {
  const diagnostics = harness.runtime.getDiagnostics();
  assert.equal(diagnostics.mutationCount, expected.mutationCount);
  assert.equal(diagnostics.undoDepth, expected.undoDepth);
  assert.equal(diagnostics.redoDepth, expected.redoDepth);
  assert.equal(diagnostics.metrics.saveAttemptCount, 0);
  if (expected.historyBytes !== undefined) {
    assert.equal(diagnostics.historyBytes, expected.historyBytes);
  }
  return diagnostics;
}

test('runtime hydrate and export round-trip one video atomically while drawing input is off', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  assert.equal(runtime.prepare(root).prepared, true);

  const persisted = makeHistoryStroke('persisted-runtime-stroke', {
    transform: {
      left: 12,
      top: -4,
      scaleX: 1,
      scaleY: 1,
      angle: 0,
      skewX: 0,
      skewY: 0,
      flipX: false,
      flipY: false
    }
  });
  assert.equal(runtime.hydrateDrawingVideo(makePersistenceHydration({
    keyframes: [{
      id: 'disk-keyframe-a',
      frame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 6,
      objects: [persisted]
    }]
  })).accepted, true);
  assert.equal(runtime.hydrateDrawingVideo(makePersistenceHydration({
    persistenceSessionId: 'runtime-persistence-session-b',
    stableVideoIdentity: 'runtime-video-b',
    keyframes: [{
      id: 'disk-keyframe-b',
      frame: 5,
      sourceWidth: 1280,
      sourceHeight: 720,
      mutationSequence: 2,
      objects: [makeHistoryStroke('video-b-stroke')]
    }]
  })).accepted, true);

  const firstExport = runtime.exportDrawingVideo(makePersistenceExport());
  assert.equal(firstExport.accepted, true);
  assert.deepEqual(firstExport.snapshot, {
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'runtime-persistence-session',
    stableVideoIdentity: 'runtime-video',
    fps: 24,
    totalFrames: 240,
    scenes: [{
      sceneInstanceId: firstExport.snapshot.scenes[0].sceneInstanceId,
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 6,
      objects: [persisted]
    }]
  });
  assert.equal(typeof firstExport.snapshot.scenes[0].sceneInstanceId, 'string');
  assert.notEqual(firstExport.snapshot.scenes[0].sceneInstanceId, 'disk-keyframe-a');
  assert.equal(Object.hasOwn(firstExport.snapshot.scenes[0], 'id'), false);
  assert.equal(runtime.getDiagnostics().inputEnabled, false);

  const beforeRejectedHydrate = structuredClone(firstExport.snapshot);
  assert.equal(runtime.hydrateDrawingVideo(makePersistenceHydration({
    keyframes: [
      {
        id: 'duplicate-frame-a',
        frame: 24,
        sourceWidth: 1920,
        sourceHeight: 1080,
        mutationSequence: 6,
        objects: [persisted]
      },
      {
        id: 'duplicate-frame-b',
        frame: 24,
        sourceWidth: 1920,
        sourceHeight: 1080,
        mutationSequence: 7,
        objects: []
      }
    ]
  })).accepted, false);
  assert.deepEqual(
    runtime.exportDrawingVideo(makePersistenceExport()).snapshot,
    beforeRejectedHydrate,
    'rejected hydrate leaves the previous video snapshot untouched'
  );
  assert.equal(
    runtime.exportDrawingVideo(makePersistenceExport({
      persistenceSessionId: 'runtime-persistence-session-b',
      stableVideoIdentity: 'runtime-video-b'
    })).accepted,
    true,
    'hydrating video A does not replace video B'
  );

  assert.deepEqual(
    runtime.exportDrawingVideo(makePersistenceExport({ fps: 23.976 })),
    { accepted: false, reason: 'timeline-mismatch' }
  );
  assert.deepEqual(
    runtime.exportDrawingVideo(makePersistenceExport({ hostGeneration: 2 })),
    { accepted: false, reason: 'stale-fence' }
  );

  assert.deepEqual(runtime.setDrawingInput(makeInput({
    hostGeneration: 4,
    videoGeneration: 7,
    inputRevision: 1,
    session: {
      ...makeInput().session,
      sessionId: 'stale-host-session',
      targetFrame: 24
    }
  })), {
    accepted: false,
    reason: 'stale-persistence-session'
  });

  const input = makeInput({
    hostGeneration: 3,
    videoGeneration: 7,
    inputRevision: 2,
    session: {
      ...makeInput().session,
      sessionId: 'hydrated-runtime-session',
      targetFrame: 24
    }
  });
  assert.deepEqual(runtime.setDrawingInput(input), {
    accepted: true,
    enabled: true,
    restored: true
  });
  const diagnostics = runtime.getDiagnostics();
  assert.equal(diagnostics.objectCount, 1);
  assert.equal(diagnostics.mutationCount, 0);
  assert.equal(diagnostics.dirty, false);
  assert.equal(diagnostics.selectionCount, 0);
  assert.equal(diagnostics.undoDepth, 0);
  assert.equal(diagnostics.redoDepth, 0);

  assert.equal(runtime.setDrawingInput({
    hostGeneration: 3,
    videoGeneration: 7,
    inputRevision: 3,
    enabled: false
  }).accepted, true);
  const disabledExport = runtime.exportDrawingVideo(makePersistenceExport());
  assert.equal(disabledExport.accepted, true);
  disabledExport.snapshot.scenes[0].objects[0].style.color = '#000000';
  assert.equal(
    runtime.exportDrawingVideo(makePersistenceExport()).snapshot.scenes[0].objects[0].style.color,
    '#ff4757',
    'exported payload cannot mutate the authoritative scene'
  );
  runtime.destroy();
});

test('runtime persistence bridge ignores hover and cannot roll back a committed stroke', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const persistenceTransitions = [];
  let throwFromBridge = false;
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    persistenceCommitObserver(event) {
      persistenceTransitions.push(event);
      if (throwFromBridge) throw new Error('persistence-bridge-injected');
    }
  });
  runtime.prepare(root);
  assert.equal(runtime.hydrateDrawingVideo(makePersistenceHydration()).accepted, true);
  assert.equal(runtime.setDrawingInput(makeInput({
    hostGeneration: 3,
    videoGeneration: 7,
    session: {
      ...makeInput().session,
      targetFrame: 24
    }
  })).accepted, true);

  const canvasElement = FakeCanvas.instances[0].upperCanvasEl;
  canvasElement.dispatch('pointermove', {
    pointerId: 0,
    pointerType: 'mouse',
    buttons: 0,
    clientX: 30,
    clientY: 40,
    pressure: 0,
    timeStamp: 1
  });
  assert.equal(persistenceTransitions.length, 0);

  throwFromBridge = true;
  drawStroke(canvasElement, 601);
  assert.equal(runtime.getDiagnostics().objectCount, 1);
  assert.equal(persistenceTransitions.length, 1);
  assert.equal(persistenceTransitions[0].hostGeneration, 3);
  assert.equal(persistenceTransitions[0].videoGeneration, 7);
  assert.equal(
    runtime.getDiagnostics().drawingPersistence.observerFailureCount,
    1
  );
  assert.equal(runtime.getDiagnostics().lastError, null);
  runtime.destroy();
});

function createObservedDrawingV3Adapter(overrides = {}) {
  const scheduled = [];
  const sceneInstanceIds = [];
  let idSequence = 0;
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-${++idSequence}`,
    nowIso: () => '2026-07-23T01:02:03.456Z',
    latencyNow: () => 0,
    scheduleWork: overrides.scheduleWork || (callback => scheduled.push(callback)),
    fallbackScheduleWork: overrides.fallbackScheduleWork || (callback => scheduled.push(callback))
  });
  const observer = {
    activateScene(scene, objects) {
      sceneInstanceIds.push(scene.sceneInstanceId);
      return adapter.activateScene(scene, objects);
    },
    enqueueTransition: overrides.enqueueTransition || adapter.enqueueTransition,
    quarantineScene: adapter.quarantineScene,
    dropScenes: adapter.dropScenes,
    destroy: adapter.destroy,
    getDiagnostics: adapter.getDiagnostics,
    getSceneProjection: adapter.getSceneProjection
  };
  return {
    adapter,
    observer,
    scheduled,
    sceneInstanceIds,
    flushAll() {
      while (scheduled.length > 0) scheduled.shift()();
    }
  };
}

function getObservedProjection(observed, sceneIndex = 0) {
  const sceneInstanceId = observed.sceneInstanceIds[sceneIndex];
  const projection = observed.adapter.getSceneProjection(sceneInstanceId);
  assert.ok(projection, 'expected an active Drawing V3 shadow projection');
  return projection;
}

function createRealFabricHarness(runtimeOptions = {}) {
  const realFabric = require('fabric/node');
  const environment = realFabric.getEnv();
  const canvases = [];
  const useRuntimeSceneStore = runtimeOptions.useRuntimeSceneStore === true;
  const sceneStore = useRuntimeSceneStore
    ? null
    : runtimeOptions.sceneStore || createSessionSceneStore(runtimeOptions.sceneStoreOptions);
  const overlayOptions = { ...runtimeOptions };
  const fabricOverrides = overlayOptions.fabric || {};
  delete overlayOptions.useRuntimeSceneStore;
  delete overlayOptions.sceneStore;
  if (!useRuntimeSceneStore) delete overlayOptions.sceneStoreOptions;
  delete overlayOptions.fabric;
  class CaptureCanvas extends realFabric.Canvas {
    constructor(...args) {
      super(...args);
      this.__disposePromise = Promise.resolve();
      canvases.push(this);
    }

    dispose() {
      const result = super.dispose();
      this.__disposePromise = Promise.resolve(result);
      return result;
    }
  }
  const root = environment.document.createElement('div');
  environment.document.body.appendChild(root);
  const runtime = createFabricOverlayRuntime({
    ...overlayOptions,
    fabric: { ...realFabric, ...fabricOverrides, Canvas: CaptureCanvas },
    document: environment.document,
    window: environment.window,
    ...(sceneStore ? { sceneStore } : {})
  });
  runtime.prepare(root);
  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 1,
    enabled: true,
    session: {
      sessionId: 'real-fabric-session',
      stableVideoIdentity: 'real-fabric-video',
      targetFrame: 0,
      sourceWidth: 200,
      sourceHeight: 200,
      canvasRect: { left: 0, top: 0, width: 200, height: 200 },
      viewportTransform: { scale: 1, panX: 0, panY: 0 },
      tool: 'brush'
    }
  });

  const canvas = canvases[0];
  const element = canvas.upperCanvasEl;
  const pointerCapture = {
    capturedPointerIds: new Set(),
    captureRequests: [],
    releaseRequests: [],
    lostEvents: [],
    retargets: []
  };
  const dispatchLostPointerCapture = pointerId => {
    const event = new environment.window.Event('lostpointercapture', { bubbles: true });
    Object.defineProperty(event, 'pointerId', { value: pointerId });
    pointerCapture.capturedPointerIds.delete(pointerId);
    pointerCapture.lostEvents.push(pointerId);
    element.dispatchEvent(event);
  };
  element.setPointerCapture = pointerId => {
    pointerCapture.captureRequests.push(pointerId);
    pointerCapture.capturedPointerIds.add(pointerId);
  };
  element.releasePointerCapture = pointerId => {
    pointerCapture.releaseRequests.push(pointerId);
    pointerCapture.capturedPointerIds.delete(pointerId);
    queueMicrotask(() => dispatchLostPointerCapture(pointerId));
  };
  element.hasPointerCapture = pointerId => pointerCapture.capturedPointerIds.has(pointerId);
  const rect = {
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    toJSON() { return this; }
  };
  for (const node of [canvas.upperCanvasEl, canvas.lowerCanvasEl, canvas.wrapperEl]) {
    node.getBoundingClientRect = () => rect;
  }
  canvas.calcOffset();
  const pointerDispatches = [];

  function dispatchPointer(target, type, x, y, pointerId, buttons) {
    const event = new environment.window.Event(type, { bubbles: true, cancelable: true });
    for (const [name, value] of Object.entries({
      clientX: x,
      clientY: y,
      pointerId,
      pointerType: 'mouse',
      button: 0,
      buttons,
      pressure: buttons === 0 ? 0 : 0.5
    })) {
      Object.defineProperty(event, name, { value });
    }
    pointerDispatches.push({
      target: target === element ? 'upperCanvasEl' : 'document',
      type,
      pointerId
    });
    target.dispatchEvent(event);
    return event;
  }

  function drawStroke(points, pointerId) {
    const [first, ...rest] = points;
    dispatchPointer(element, 'pointerdown', first.x, first.y, pointerId, 1);
    for (const point of rest) {
      dispatchPointer(element, 'pointermove', point.x, point.y, pointerId, 1);
    }
    const last = rest.at(-1) || first;
    dispatchPointer(element, 'pointerup', last.x, last.y, pointerId, 0);
  }

  function drawStrokeAt(y, pointerId) {
    drawStroke([{ x: 20, y }, { x: 60, y }], pointerId);
  }

  function dispatchCapturedPointerUp(x, y, pointerId) {
    const captured = element.hasPointerCapture(pointerId);
    const target = captured ? element : environment.document;
    pointerCapture.retargets.push({
      pointerId,
      from: 'document',
      to: captured ? 'upperCanvasEl' : 'document'
    });
    dispatchPointer(target, 'pointerup', x, y, pointerId, 0);
  }

  function dragMarquee(from, to, pointerId = 101) {
    dispatchPointer(element, 'pointerdown', from.x, from.y, pointerId, 1);
    dispatchPointer(environment.document, 'pointermove', to.x, to.y, pointerId, 1);
    dispatchCapturedPointerUp(to.x, to.y, pointerId);
  }

  function dragLasso(points, pointerId = 104) {
    const [first, ...rest] = points;
    dispatchPointer(element, 'pointerdown', first.x, first.y, pointerId, 1);
    for (const point of rest) {
      dispatchPointer(element, 'pointermove', point.x, point.y, pointerId, 1);
    }
    const last = rest.at(-1) || first;
    dispatchCapturedPointerUp(last.x, last.y, pointerId);
  }

  function dragActiveSelectionBy(dx, dy, pointerId = 102) {
    const center = canvas.getActiveObject().getCenterPoint();
    dispatchPointer(element, 'pointerdown', center.x, center.y, pointerId, 1);
    dispatchPointer(environment.document, 'pointermove', center.x + dx, center.y + dy, pointerId, 1);
    dispatchCapturedPointerUp(center.x + dx, center.y + dy, pointerId);
  }

  function dragStrokeBy(index, dx, dy, onMove, pointerId = 103) {
    const center = canvas.getObjects()[index].getCenterPoint();
    dragFrom(center, dx, dy, onMove, pointerId);
  }

  function dragFrom(point, dx, dy, onMove, pointerId = 103) {
    dispatchPointer(element, 'pointerdown', point.x, point.y, pointerId, 1);
    dispatchPointer(environment.document, 'pointermove', point.x + dx, point.y + dy, pointerId, 1);
    onMove?.();
    dispatchCapturedPointerUp(point.x + dx, point.y + dy, pointerId);
  }

  function clickStroke(index, pointerId, onPointerDown) {
    const center = canvas.getObjects()[index].getCenterPoint();
    dispatchPointer(element, 'pointerdown', center.x, center.y, pointerId, 1);
    onPointerDown?.();
    dispatchCapturedPointerUp(center.x, center.y, pointerId);
  }

  function hoverAt(x, y) {
    return dispatchPointer(element, 'pointermove', x, y, 0, 0);
  }

  function sceneTransforms() {
    if (sceneStore) {
      return sceneStore.getActiveSceneSnapshot().objects.map(object => ({
        left: Number(object.transform?.left) || 0,
        top: Number(object.transform?.top) || 0
      }));
    }
    return canvas.getObjects().map(object => ({
      left: Number(object.left) || 0,
      top: Number(object.top) || 0
    }));
  }

  return {
    runtime,
    root,
    sceneStore,
    canvas,
    environment,
    element,
    pointerCapture,
    dispatchLostPointerCapture,
    pointerDispatches,
    dispatchPointer,
    dispatchCapturedPointerUp,
    drawStroke,
    drawStrokeAt,
    dragMarquee,
    dragLasso,
    dragActiveSelectionBy,
    dragStrokeBy,
    dragFrom,
    clickStroke,
    hoverAt,
    sceneTransforms,
    async destroy() {
      assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
      runtime.destroy();
      await canvas.__disposePromise;
      root.remove();
    }
  };
}

test('auto singleton enables Drawing V3 shadow only for a strict true bootstrap field and consumes it', () => {
  const result = runAutoSingletonProbe(`
    global.document = null;
    global.window = {};
    Object.defineProperty(window, '__mpvFabricOverlayBootstrap', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: Object.freeze({ drawingV3ShadowEnabled: true })
    });
    require(runtimePath);
    const diagnostics = window.__mpvFabricOverlay.getDiagnostics();
    emit({
      bootstrapPresent: Object.prototype.hasOwnProperty.call(
        window,
        '__mpvFabricOverlayBootstrap'
      ),
      enabled: diagnostics.drawingV3Shadow.enabled,
      status: diagnostics.drawingV3Shadow.status
    });
  `);

  assert.deepEqual(result, {
    bootstrapPresent: false,
    enabled: true,
    status: 'idle'
  });
});

test('auto singleton ignores non-configurable bootstrap accessors and stays safely off', () => {
  const cases = [
    {
      name: 'getter returns enabled and setter ignores writes',
      accessors: `
        get() {
          getterCalls += 1;
          return { drawingV3ShadowEnabled: true };
        },
        set() { setterCalls += 1; }
      `
    },
    {
      name: 'getter and setter throw',
      accessors: `
        get() {
          getterCalls += 1;
          throw new Error('hostile bootstrap getter');
        },
        set() {
          setterCalls += 1;
          throw new Error('hostile bootstrap setter');
        }
      `
    }
  ];

  for (const probe of cases) {
    const result = runAutoSingletonProbe(`
      global.document = null;
      let getterCalls = 0;
      let setterCalls = 0;
      global.window = {};
      Object.defineProperty(window, '__mpvFabricOverlayBootstrap', {
        configurable: false,
        ${probe.accessors}
      });
      require(runtimePath);
      const diagnostics = window.__mpvFabricOverlay.getDiagnostics();
      emit({
        bootstrapPresent: Object.prototype.hasOwnProperty.call(
          window,
          '__mpvFabricOverlayBootstrap'
        ),
        getterCalls,
        setterCalls,
        singletonPresent: !!window.__mpvFabricOverlay,
        enabled: diagnostics.drawingV3Shadow.enabled,
        status: diagnostics.drawingV3Shadow.status
      });
    `);

    assert.deepEqual(result, {
      bootstrapPresent: true,
      getterCalls: 0,
      setterCalls: 0,
      singletonPresent: true,
      enabled: false,
      status: 'disabled'
    }, probe.name);
  }
});

test('auto singleton stays off and initializes when bootstrap descriptor inspection throws', () => {
  const result = runAutoSingletonProbe(`
    global.document = null;
    let descriptorCalls = 0;
    global.window = new Proxy({}, {
      getOwnPropertyDescriptor(target, property) {
        if (property === '__mpvFabricOverlayBootstrap') {
          descriptorCalls += 1;
          throw new Error('hostile bootstrap descriptor');
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
    });
    require(runtimePath);
    const diagnostics = window.__mpvFabricOverlay.getDiagnostics();
    emit({
      descriptorCalls,
      singletonPresent: !!window.__mpvFabricOverlay,
      enabled: diagnostics.drawingV3Shadow.enabled,
      status: diagnostics.drawingV3Shadow.status
    });
  `);

  assert.deepEqual(result, {
    descriptorCalls: 1,
    singletonPresent: true,
    enabled: false,
    status: 'disabled'
  });
});

test('auto singleton keeps Drawing V3 shadow off for missing or non-boolean bootstrap values', () => {
  const cases = [
    {
      name: 'missing bootstrap',
      setup: 'global.window = {};'
    },
    {
      name: 'missing field',
      setup: 'global.window = { __mpvFabricOverlayBootstrap: {} };'
    },
    {
      name: 'string true field',
      setup: `global.window = {
        __mpvFabricOverlayBootstrap: { drawingV3ShadowEnabled: 'true' }
      };`
    },
    {
      name: 'bare true bootstrap',
      setup: 'global.window = { __mpvFabricOverlayBootstrap: true };'
    }
  ];

  for (const probe of cases) {
    const result = runAutoSingletonProbe(`
      global.document = null;
      ${probe.setup}
      require(runtimePath);
      const diagnostics = window.__mpvFabricOverlay.getDiagnostics();
      emit({
        bootstrapPresent: Object.prototype.hasOwnProperty.call(
          window,
          '__mpvFabricOverlayBootstrap'
        ),
        enabled: diagnostics.drawingV3Shadow.enabled,
        status: diagnostics.drawingV3Shadow.status
      });
    `);

    assert.deepEqual(result, {
      bootstrapPresent: false,
      enabled: false,
      status: 'disabled'
    }, probe.name);
  }
});

test('late bootstrap is consumed without replacing or mutating an existing singleton', () => {
  const result = runAutoSingletonProbe(`
    global.document = null;
    const state = { phase: 'active', revision: 17 };
    const existing = { state };
    global.window = {
      __mpvFabricOverlay: existing,
      __mpvFabricOverlayBootstrap: { drawingV3ShadowEnabled: true }
    };
    require(runtimePath);
    emit({
      bootstrapPresent: Object.prototype.hasOwnProperty.call(
        window,
        '__mpvFabricOverlayBootstrap'
      ),
      sameIdentity: window.__mpvFabricOverlay === existing,
      sameStateIdentity: window.__mpvFabricOverlay.state === state,
      state: window.__mpvFabricOverlay.state
    });
  `);

  assert.deepEqual(result, {
    bootstrapPresent: false,
    sameIdentity: true,
    sameStateIdentity: true,
    state: { phase: 'active', revision: 17 }
  });
});

test('module cache re-evaluation consumes late bootstrap without replacing the auto singleton', () => {
  const result = runAutoSingletonProbe(`
    global.document = null;
    global.window = {};
    require(runtimePath);
    const existing = window.__mpvFabricOverlay;
    existing.destroy();
    const before = existing.getDiagnostics();

    window.__mpvFabricOverlayBootstrap = { drawingV3ShadowEnabled: true };
    delete require.cache[require.resolve(runtimePath)];
    require(runtimePath);
    const after = window.__mpvFabricOverlay.getDiagnostics();
    emit({
      bootstrapPresent: Object.prototype.hasOwnProperty.call(
        window,
        '__mpvFabricOverlayBootstrap'
      ),
      sameIdentity: window.__mpvFabricOverlay === existing,
      stateBefore: before.state,
      stateAfter: after.state,
      shadowBefore: before.drawingV3Shadow.enabled,
      shadowAfter: after.drawingV3Shadow.enabled
    });
  `);

  assert.deepEqual(result, {
    bootstrapPresent: false,
    sameIdentity: true,
    stateBefore: 'destroyed',
    stateAfter: 'destroyed',
    shadowBefore: false,
    shadowAfter: false
  });
});

test('Drawing V3 runtime shadow is disabled by default and never constructs an adapter', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  let factoryCalls = 0;
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3AdapterFactory() {
      factoryCalls += 1;
      return createObservedDrawingV3Adapter().observer;
    }
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 501);

  assert.equal(factoryCalls, 0);
  assert.equal(runtime.getDiagnostics().drawingV3Shadow.enabled, false);
  assert.equal(runtime.getDiagnostics().drawingV3Shadow.status, 'disabled');
  assert.equal(runtime.getDiagnostics().mutationCount, 1);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  runtime.destroy();
});

test('enabled runtime-owned store wires one adapter and exposes only bounded shadow diagnostics', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const observed = createObservedDrawingV3Adapter();
  let factoryCalls = 0;
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory() {
      factoryCalls += 1;
      return observed.observer;
    }
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 502);
  observed.flushAll();

  const sceneInstanceId = observed.sceneInstanceIds[0];
  const projection = observed.adapter.getSceneProjection(sceneInstanceId);
  assert.equal(factoryCalls, 1);
  assert.ok(projection);
  assert.equal(projection.headSequence, 1);
  assert.equal(projection.document.layers[0].keyframes[0].objects.length, 1);
  assert.deepEqual(runtime.getDiagnostics().drawingV3Shadow, observed.adapter.getDiagnostics());
  assert.equal(runtime.getDiagnostics().lastError, null);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  runtime.destroy();
});

test('enabled runtime never monkey-patches a caller-supplied scene store', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sceneStore = createSessionSceneStore();
  let factoryCalls = 0;
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    sceneStore,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory() {
      factoryCalls += 1;
      return createObservedDrawingV3Adapter().observer;
    }
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 503);

  assert.equal(factoryCalls, 0);
  assert.equal(sceneStore.getDiagnostics().mutationCount, 1);
  assert.equal(runtime.getDiagnostics().drawingV3Shadow.enabled, false);
  assert.equal(runtime.getDiagnostics().drawingV3Shadow.status, 'not-connected');
  runtime.destroy();
});

test('shadow adapter startup failure leaves the Fabric primary fully usable', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory() {
      throw new Error('shadow-startup-injected');
    }
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 507);

  const diagnostics = runtime.getDiagnostics();
  assert.equal(diagnostics.objectCount, 1);
  assert.equal(diagnostics.mutationCount, 1);
  assert.equal(diagnostics.lastError, null);
  assert.equal(diagnostics.metrics.saveAttemptCount, 0);
  assert.equal(diagnostics.drawingV3Shadow.enabled, false);
  assert.equal(diagnostics.drawingV3Shadow.status, 'degraded');
  assert.equal(diagnostics.drawingV3Shadow.failureCount, 1);
  assert.equal(diagnostics.drawingV3Shadow.lastReason, 'adapter-failed');
  runtime.destroy();
});

test('runtime exposes a fixed sanitized Drawing V3 diagnostic schema only', () => {
  const document = new FakeDocument();
  const root = document.createElement('div');
  const observer = {
    activateScene() {},
    enqueueTransition() {},
    quarantineScene() {},
    dropScenes() {},
    destroy() {},
    getDiagnostics() {
      return {
        enabled: true,
        status: 'C:\\private\\status',
        sceneCount: '3',
        bootstrapCount: -1,
        commitCount: 2.9,
        failureCount: Number.MAX_SAFE_INTEGER + 1,
        divergenceCount: 4,
        resyncCount: 5,
        staleCount: 6,
        gapCount: 7,
        headSequence: 8,
        objectCount: 9,
        estimatedBytes: 10,
        latencyP50Ms: Number.POSITIVE_INFINITY,
        latencyP95Ms: 120_000,
        lastReason: 'C:\\private\\reason',
        privateProjection: { points: ['must-not-leak'] }
      };
    }
  };
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory: () => observer
  });
  runtime.prepare(root);

  const diagnostics = runtime.getDiagnostics().drawingV3Shadow;
  assert.deepEqual(Object.keys(diagnostics), [
    'enabled', 'status', 'sceneCount', 'bootstrapCount', 'commitCount',
    'failureCount', 'divergenceCount', 'resyncCount', 'staleCount', 'gapCount',
    'headSequence', 'objectCount', 'estimatedBytes', 'latencyP50Ms',
    'latencyP95Ms', 'lastReason'
  ]);
  assert.deepEqual(diagnostics, {
    enabled: true,
    status: 'degraded',
    sceneCount: 3,
    bootstrapCount: 0,
    commitCount: 2,
    failureCount: 0,
    divergenceCount: 4,
    resyncCount: 5,
    staleCount: 6,
    gapCount: 7,
    headSequence: 8,
    objectCount: 9,
    estimatedBytes: 10,
    latencyP50Ms: 0,
    latencyP95Ms: 60_000,
    lastReason: null
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|points|must-not-leak/);
  runtime.destroy();
});

test('runtime shadow teardown drops scenes before one idempotent adapter destroy', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const lifecycle = [];
  const observer = {
    activateScene(scene) {
      lifecycle.push(['activate', scene.sceneInstanceId]);
    },
    enqueueTransition() {},
    quarantineScene() {},
    dropScenes(sceneInstanceIds) {
      lifecycle.push(['drop', ...sceneInstanceIds]);
    },
    destroy() {
      lifecycle.push(['destroy']);
    },
    getDiagnostics() {
      return {
        enabled: true,
        status: 'active',
        sceneCount: 1,
        bootstrapCount: 1,
        commitCount: 0,
        failureCount: 0,
        divergenceCount: 0,
        resyncCount: 0,
        staleCount: 0,
        gapCount: 0,
        headSequence: 0,
        objectCount: 0,
        estimatedBytes: 0,
        latencyP50Ms: 0,
        latencyP95Ms: 0,
        lastReason: null
      };
    }
  };
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory: () => observer
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const sceneInstanceId = lifecycle[0][1];

  assert.deepEqual(runtime.destroy(), { destroyed: true, reused: false });
  assert.deepEqual(runtime.destroy(), { destroyed: true, reused: true });
  assert.deepEqual(lifecycle, [
    ['activate', sceneInstanceId],
    ['drop', sceneInstanceId],
    ['destroy']
  ]);
});

test('runtime shadow keeps video and frame documents isolated across warm restoration', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const observed = createObservedDrawingV3Adapter();
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory: () => observed.observer
  });
  runtime.prepare(root);

  const activate = ({ inputRevision, videoGeneration, stableVideoIdentity, targetFrame }) => {
    const base = makeInput();
    return runtime.setDrawingInput({
      ...base,
      inputRevision,
      videoGeneration,
      session: {
        ...base.session,
        sessionId: `session-${inputRevision}`,
        stableVideoIdentity,
        targetFrame
      }
    });
  };
  assert.equal(activate({
    inputRevision: 1, videoGeneration: 1,
    stableVideoIdentity: 'video-a', targetFrame: 24
  }).accepted, true);
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 508);
  assert.equal(activate({
    inputRevision: 2, videoGeneration: 1,
    stableVideoIdentity: 'video-a', targetFrame: 25
  }).accepted, true);
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 509);
  assert.equal(activate({
    inputRevision: 2, videoGeneration: 1,
    stableVideoIdentity: 'video-a', targetFrame: 25
  }).accepted, false, 'duplicate input revisions remain stale');
  assert.equal(runtime.setDrawingInput({
    hostGeneration: 1, videoGeneration: 2, inputRevision: 3, enabled: false
  }).accepted, true);
  assert.equal(activate({
    inputRevision: 4, videoGeneration: 2,
    stableVideoIdentity: 'video-b', targetFrame: 0
  }).accepted, true);
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 510);
  const firstSceneInstanceId = observed.sceneInstanceIds[0];
  assert.equal(runtime.setDrawingInput({
    hostGeneration: 1, videoGeneration: 3, inputRevision: 5, enabled: false
  }).accepted, true);
  assert.equal(activate({
    inputRevision: 6, videoGeneration: 3,
    stableVideoIdentity: 'video-a', targetFrame: 24
  }).accepted, true);
  observed.flushAll();

  const uniqueSceneInstanceIds = [...new Set(observed.sceneInstanceIds)];
  assert.equal(observed.sceneInstanceIds.at(-1), firstSceneInstanceId);
  assert.equal(uniqueSceneInstanceIds.length, 3);
  for (const sceneInstanceId of uniqueSceneInstanceIds) {
    const projection = observed.adapter.getSceneProjection(sceneInstanceId);
    assert.ok(projection);
    assert.equal(projection.headSequence, 1);
    assert.equal(projection.document.layers[0].keyframes[0].objects.length, 1);
  }
  const aggregate = observed.adapter.getDiagnostics();
  assert.equal(aggregate.sceneCount, 3);
  assert.equal(aggregate.bootstrapCount, 3);
  assert.equal(aggregate.commitCount, 3);
  assert.equal(aggregate.divergenceCount, 0);
  assert.equal(aggregate.headSequence, 1);
  assert.equal(aggregate.objectCount, 3);
  assert.equal(runtime.getDiagnostics().objectCount, 1);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  runtime.destroy();
});

test('shadow enqueue failure stays out of Fabric errors saves and the next gesture', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const observed = createObservedDrawingV3Adapter({
    enqueueTransition() {
      throw new Error('shadow-enqueue-injected');
    }
  });
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory: () => observed.observer
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 504);
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 505);

  assert.equal(runtime.getDiagnostics().objectCount, 2);
  assert.equal(runtime.getDiagnostics().mutationCount, 2);
  assert.equal(runtime.getDiagnostics().lastError, null);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  assert.equal(runtime.getDiagnostics().drawingV3Shadow.status, 'degraded');
  assert.equal(runtime.getDiagnostics().drawingV3Shadow.lastReason, 'observer-failed');
  runtime.destroy();
});

test('one hundred B-style warm reentries never duplicate the shadow document or revision', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const observed = createObservedDrawingV3Adapter();
  let factoryCalls = 0;
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory() {
      factoryCalls += 1;
      return observed.observer;
    }
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  drawStroke(FakeCanvas.instances[0].upperCanvasEl, 506);
  observed.flushAll();
  const before = observed.adapter.getDiagnostics();
  assert.equal(factoryCalls, 1);
  assert.equal(before.bootstrapCount, 1);

  let inputRevision = 1;
  for (let index = 0; index < 100; index += 1) {
    inputRevision += 1;
    assert.equal(runtime.setDrawingInput({
      hostGeneration: 1,
      videoGeneration: 1,
      inputRevision,
      enabled: false
    }).accepted, true);
    inputRevision += 1;
    assert.equal(runtime.setDrawingInput({
      ...makeInput(),
      inputRevision,
      session: { ...makeInput().session, sessionId: `runtime-session-${index}` }
    }).accepted, true);
  }
  observed.flushAll();
  const after = observed.adapter.getDiagnostics();

  assert.equal(after.bootstrapCount, before.bootstrapCount);
  assert.equal(after.sceneCount, before.sceneCount);
  assert.equal(after.headSequence, before.headSequence);
  assert.equal(after.objectCount, before.objectCount);
  assert.equal(after.estimatedBytes, before.estimatedBytes);
  assert.equal(after.divergenceCount, 0);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  runtime.destroy();
});

const crossingStrokePoints = (y = 100) => [
  { x: 20, y },
  { x: 50, y },
  { x: 80, y },
  { x: 110, y },
  { x: 140, y },
  { x: 180, y }
];

const middleLassoPoints = (top = 75, bottom = 125) => [
  { x: 70, y: top },
  { x: 130, y: top },
  { x: 130, y: bottom },
  { x: 70, y: bottom },
  { x: 70, y: top }
];

function enableRealFabricLasso(harness, toolRevision = 1) {
  harness.runtime.updateDrawingTool({
    sessionId: 'real-fabric-session',
    toolRevision,
    tool: 'select'
  });
  findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
}

function lassoHistoryState(runtime) {
  const diagnostics = runtime.getDiagnostics();
  return {
    mutationCount: diagnostics.mutationCount,
    dirty: diagnostics.dirty,
    undoDepth: diagnostics.undoDepth,
    redoDepth: diagnostics.redoDepth,
    historyBytes: diagnostics.historyBytes
  };
}

function pendingLassoObjects(canvas) {
  return canvas.getObjects().filter(object => object.__baeframePendingLasso);
}

test('real Fabric brush mutations stay in exact runtime-owned V3 shadow parity', async () => {
  const observed = createObservedDrawingV3Adapter();
  const harness = createRealFabricHarness({
    useRuntimeSceneStore: true,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory: () => observed.observer
  });
  const readParity = () => {
    observed.flushAll();
    const projection = getObservedProjection(observed);
    const canvasIds = harness.canvas.getObjects().map(object => object.__baeframeObjectId);
    const projectionObjects = projection.document.layers[0].keyframes[0].objects;
    assert.deepEqual(projectionObjects.map(object => object.id), canvasIds);
    assert.equal(projection.headSequence, harness.runtime.getDiagnostics().mutationCount);
    assert.equal(projectionObjects.length, harness.runtime.getDiagnostics().objectCount);
    assert.equal(harness.runtime.getDiagnostics().drawingV3Shadow.divergenceCount, 0);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
    assert.equal(harness.runtime.getDiagnostics().lastError, null);
    return { projection, objects: projectionObjects };
  };

  try {
    harness.drawStrokeAt(40, 700);
    harness.drawStrokeAt(80, 701);
    let state = readParity();
    assert.equal(state.projection.headSequence, 2);

    assert.equal(harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session', toolRevision: 1, tool: 'select'
    }).accepted, true);
    const movedId = harness.canvas.getObjects()[0].__baeframeObjectId;
    harness.dragStrokeBy(0, 12, -8, undefined, 702);
    await Promise.resolve();
    state = readParity();
    assert.deepEqual(
      state.objects.find(object => object.id === movedId).transform,
      [1, 0, 0, 1, 12, -8]
    );

    harness.clickStroke(1, 703);
    await Promise.resolve();
    assert.equal(harness.runtime.getDiagnostics().selectionCount, 1);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-real-delete', action: 'delete-selection'
    }).applied, true);
    state = readParity();
    assert.deepEqual(state.objects.map(object => object.id), [movedId]);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-real-delete-undo', action: 'undo'
    }).applied, true);
    assert.equal(readParity().objects.length, 2);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-real-delete-redo', action: 'redo'
    }).applied, true);
    assert.deepEqual(readParity().objects.map(object => object.id), [movedId]);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-real-clear', action: 'clear-session'
    }).applied, true);
    assert.deepEqual(readParity().objects, []);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-real-clear-undo', action: 'undo'
    }).applied, true);
    assert.deepEqual(readParity().objects.map(object => object.id), [movedId]);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-real-clear-redo', action: 'redo'
    }).applied, true);
    assert.deepEqual(readParity().objects, []);
  } finally {
    await harness.destroy();
  }
});

test('real Fabric primary mutation history and selection are identical with shadow off and on', async () => {
  const runSequence = async enabled => {
    const observed = enabled ? createObservedDrawingV3Adapter() : null;
    const harness = createRealFabricHarness({
      useRuntimeSceneStore: true,
      ...(enabled ? {
        drawingV3ShadowEnabled: true,
        drawingV3AdapterFactory: () => observed.observer
      } : {})
    });
    try {
      harness.drawStrokeAt(45, enabled ? 720 : 730);
      harness.drawStrokeAt(85, enabled ? 721 : 731);
      assert.equal(harness.runtime.updateDrawingTool({
        sessionId: 'real-fabric-session', toolRevision: 1, tool: 'select'
      }).accepted, true);
      harness.dragStrokeBy(0, 9, -4, undefined, enabled ? 722 : 732);
      await Promise.resolve();
      harness.clickStroke(1, enabled ? 723 : 733);
      await Promise.resolve();
      assert.equal(harness.runtime.applyDrawingAction({
        sessionId: 'real-fabric-session',
        actionId: `shadow-${enabled ? 'on' : 'off'}-delete`,
        action: 'delete-selection'
      }).applied, true);
      assert.equal(harness.runtime.applyDrawingAction({
        sessionId: 'real-fabric-session',
        actionId: `shadow-${enabled ? 'on' : 'off'}-undo`,
        action: 'undo'
      }).applied, true);
      assert.equal(harness.runtime.applyDrawingAction({
        sessionId: 'real-fabric-session',
        actionId: `shadow-${enabled ? 'on' : 'off'}-redo`,
        action: 'redo'
      }).applied, true);
      observed?.flushAll();
      const diagnostics = harness.runtime.getDiagnostics();
      return {
        state: {
          objectCount: diagnostics.objectCount,
          selectionCount: diagnostics.selectionCount,
          mutationCount: diagnostics.mutationCount,
          dirty: diagnostics.dirty,
          undoDepth: diagnostics.undoDepth,
          redoDepth: diagnostics.redoDepth,
          historyBytes: diagnostics.historyBytes,
          saveAttemptCount: diagnostics.metrics.saveAttemptCount
        },
        transforms: harness.canvas.getObjects().map(object => ({
          left: object.left,
          top: object.top,
          scaleX: object.scaleX,
          scaleY: object.scaleY,
          angle: object.angle,
          skewX: object.skewX,
          skewY: object.skewY,
          flipX: object.flipX,
          flipY: object.flipY
        })),
        shadow: diagnostics.drawingV3Shadow
      };
    } finally {
      await harness.destroy();
    }
  };

  const off = await runSequence(false);
  const on = await runSequence(true);
  assert.deepEqual(on.state, off.state);
  assert.deepEqual(on.transforms, off.transforms);
  assert.equal(off.shadow.status, 'disabled');
  assert.equal(on.shadow.failureCount, 0);
  assert.equal(on.shadow.divergenceCount, 0);
});

test('real Fabric lasso split caps order translation undo and redo stay in V3 shadow parity', async () => {
  const observed = createObservedDrawingV3Adapter();
  const harness = createRealFabricHarness({
    useRuntimeSceneStore: true,
    drawingV3ShadowEnabled: true,
    drawingV3AdapterFactory: () => observed.observer
  });
  try {
    harness.drawStroke(crossingStrokePoints(), 710);
    observed.flushAll();
    const originalId = harness.canvas.getObjects()[0].__baeframeObjectId;
    enableRealFabricLasso(harness);
    harness.dragLasso(middleLassoPoints(), 711);
    observed.flushAll();
    assert.equal(getObservedProjection(observed).headSequence, 1,
      'staging the lasso must remain non-destructive');

    harness.dragActiveSelectionBy(20, -30, 712);
    await Promise.resolve();
    observed.flushAll();
    const splitProjection = getObservedProjection(observed);
    const splitObjects = splitProjection.document.layers[0].keyframes[0].objects;
    assert.equal(splitProjection.headSequence, 2);
    assert.deepEqual(
      splitObjects.map(object => object.id),
      harness.canvas.getObjects().map(object => object.__baeframeObjectId)
    );
    assert.deepEqual(splitObjects.map(object => object.caps), [
      { start: true, end: false },
      { start: false, end: false },
      { start: false, end: true }
    ]);
    assert.deepEqual(splitObjects.map(object => object.transform), [
      [1, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 20, -30],
      [1, 0, 0, 1, 0, 0]
    ]);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-lasso-undo', action: 'undo'
    }).applied, true);
    observed.flushAll();
    const undone = getObservedProjection(observed);
    assert.equal(undone.headSequence, 3);
    assert.deepEqual(undone.document.layers[0].keyframes[0].objects.map(object => ({
      id: object.id, caps: object.caps, transform: object.transform
    })), [{
      id: originalId,
      caps: { start: true, end: true },
      transform: [1, 0, 0, 1, 0, 0]
    }]);
    assert.deepEqual(
      harness.canvas.getObjects().map(object => object.__baeframeObjectId),
      [originalId]
    );

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'shadow-lasso-redo', action: 'redo'
    }).applied, true);
    observed.flushAll();
    const redone = getObservedProjection(observed);
    assert.equal(redone.headSequence, 4);
    assert.deepEqual(redone.document.layers[0].keyframes[0].objects, splitObjects);
    assert.deepEqual(
      redone.document.layers[0].keyframes[0].objects.map(object => object.id),
      harness.canvas.getObjects().map(object => object.__baeframeObjectId)
    );
    const diagnostics = harness.runtime.getDiagnostics();
    assert.equal(diagnostics.drawingV3Shadow.failureCount, 0);
    assert.equal(diagnostics.drawingV3Shadow.divergenceCount, 0);
    assert.equal(diagnostics.metrics.saveAttemptCount, 0);
    assert.equal(diagnostics.lastError, null);
  } finally {
    await harness.destroy();
  }
});

function stageCrossingLasso(harness, pointerBase = 800) {
  harness.drawStroke(crossingStrokePoints(), pointerBase);
  const before = harness.sceneStore.getActiveSceneSnapshot();
  enableRealFabricLasso(harness);
  harness.dragLasso(middleLassoPoints(), pointerBase + 1);
  return before;
}

test('lasso pointerup keeps scene objects mutation dirty undo and redo unchanged', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke(crossingStrokePoints(), 60);
    harness.drawStroke(crossingStrokePoints(175), 600);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'lasso-pointerup-create-redo',
      action: 'undo'
    }).applied, true);
    enableRealFabricLasso(harness);
    const before = harness.sceneStore.getActiveSceneSnapshot();
    const beforeHistory = lassoHistoryState(harness.runtime);

    harness.dragLasso(middleLassoPoints(), 61);

    const after = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(after.objects, before.objects);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(after.objects.length, 1);
    assert.equal(pendingLassoObjects(harness.canvas).length, 1);
    assert.equal(pendingLassoObjects(harness.canvas)[0].opacity, 0);
    assert.equal(harness.canvas.getActiveObject().__baeframePendingLasso, true);
    assert.equal(harness.canvas.getObjects().filter(object => !object.__baeframePendingLasso).length, 1);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('partial lasso Delete commits one command and round-trips exact ID path and z-order', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke(crossingStrokePoints(), 610);
    harness.drawStroke(crossingStrokePoints(170), 611);
    const original = harness.sceneStore.getActiveSceneSnapshot();
    enableRealFabricLasso(harness);
    harness.dragLasso(middleLassoPoints(), 612);
    const beforeDelete = lassoHistoryState(harness.runtime);

    const deleted = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'partial-lasso-delete',
      action: 'delete-selection'
    });

    const holed = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(deleted.applied, true);
    assert.equal(holed.objects.length, 3);
    assert.equal(holed.objects.some(object => object.id === original.objects[0].id), false);
    assert.equal(holed.objects[2].id, original.objects[1].id);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, beforeDelete.undoDepth + 1);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'undo-partial-delete', action: 'undo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, original.objects);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'redo-partial-delete', action: 'redo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, holed.objects);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('partial fragments plus a fully enclosed stroke Delete round-trip as one command', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke(crossingStrokePoints(80), 613);
    harness.drawStroke([{ x: 85, y: 120 }, { x: 105, y: 120 }, { x: 125, y: 120 }], 614);
    harness.drawStroke(crossingStrokePoints(175), 615);
    const original = harness.sceneStore.getActiveSceneSnapshot();
    enableRealFabricLasso(harness);
    harness.dragLasso([
      { x: 70, y: 55 }, { x: 135, y: 55 }, { x: 135, y: 140 },
      { x: 70, y: 140 }, { x: 70, y: 55 }
    ], 616);
    const beforeDelete = lassoHistoryState(harness.runtime);
    assert.equal(harness.canvas.getActiveObjects().length, 2);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'delete-mixed-partial', action: 'delete-selection'
    }).applied, true);
    const deleted = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(deleted.objects.length, 3);
    assert.equal(deleted.objects.some(object => object.id === original.objects[0].id), false);
    assert.equal(deleted.objects.some(object => object.id === original.objects[1].id), false);
    assert.equal(deleted.objects.at(-1).id, original.objects[2].id);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, beforeDelete.undoDepth + 1);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'undo-mixed-partial-delete', action: 'undo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, original.objects);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'redo-mixed-partial-delete', action: 'redo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, deleted.objects);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('lasso selection preserves the rendered stroke until a fragment actually moves', async () => {
  const harness = createRealFabricHarness();
  const renderedPixels = () => {
    harness.canvas.renderAll();
    const element = harness.canvas.toCanvasElement();
    return element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
  };
  const alphaAt = (pixels, x, y) => pixels[(y * 200 + x) * 4 + 3];
  try {
    const sizeInput = findOne(harness.root, node => node.dataset.fabricPilotSetting === 'size');
    const opacityInput = findOne(harness.root, node => node.dataset.fabricPilotSetting === 'opacity');
    sizeInput.value = '20';
    sizeInput.dispatchEvent(new harness.environment.window.Event('input', { bubbles: true }));
    opacityInput.value = '50';
    opacityInput.dispatchEvent(new harness.environment.window.Event('input', { bubbles: true }));
    harness.drawStroke(Array.from({ length: 81 }, (_value, index) => ({
      x: 20 + index * 2,
      y: 100 + Math.sin(index / 8) * 12
    })), 601);
    const beforeSelection = renderedPixels();

    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 65 },
      { x: 130, y: 65 },
      { x: 130, y: 135 },
      { x: 70, y: 135 },
      { x: 70, y: 65 }
    ], 602);

    const afterSelection = renderedPixels();
    assert.deepEqual(afterSelection, beforeSelection);

    const clickCenter = harness.canvas.getActiveObject().getCenterPoint();
    harness.dispatchPointer(harness.element, 'pointerdown', clickCenter.x, clickCenter.y, 607, 1);
    harness.dispatchCapturedPointerUp(clickCenter.x, clickCenter.y, 607);
    await Promise.resolve();
    assert.deepEqual(renderedPixels(), beforeSelection);

    let duringMove = null;
    const selectionCenter = harness.canvas.getActiveObject().getCenterPoint();
    harness.dragFrom(selectionCenter, 0, 45, () => {
      duringMove = renderedPixels();
    }, 603);
    await Promise.resolve();
    const afterMove = renderedPixels();
    const maximumAlpha = afterMove.reduce((maximum, value, index) => (
      index % 4 === 3 ? Math.max(maximum, value) : maximum
    ), 0);

    assert.equal(alphaAt(duringMove, 100, 100) < 16, true);
    assert.equal(alphaAt(duringMove, 100, 134) > 64, true);
    assert.equal(alphaAt(afterMove, 100, 100) < 16, true);
    assert.equal(alphaAt(afterMove, 100, 134) > 64, true);
    assert.equal(maximumAlpha <= 132, true);
  } finally {
    await harness.destroy();
  }
});

test('dragging a lasso-selected fragment moves only that fragment', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
      { x: 110, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 62);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 75 },
      { x: 130, y: 75 },
      { x: 130, y: 125 },
      { x: 70, y: 125 },
      { x: 70, y: 75 }
    ], 63);

    const before = harness.sceneStore.getActiveSceneSnapshot();
    const beforeHistory = lassoHistoryState(harness.runtime);
    const selectedObject = harness.canvas.getActiveObjects()[0];
    const selectedId = selectedObject.__baeframeObjectId;
    const selectedStart = { left: selectedObject.left, top: selectedObject.top };
    harness.dragActiveSelectionBy(20, -30, 64);
    await Promise.resolve();

    const after = harness.sceneStore.getActiveSceneSnapshot();
    const afterById = new Map(after.objects.map(object => [object.id, object]));
    assert.equal(after.objects.length, 3);
    assert.deepEqual(after.selectedObjectIds, [selectedId]);
    assert.equal(afterById.get(selectedId).transform.left, selectedStart.left + 20);
    assert.equal(afterById.get(selectedId).transform.top, selectedStart.top - 30);
    assert.equal(after.objects.filter(object => object.id !== selectedId).every(
      object => object.transform.top === 100
    ), true);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, beforeHistory.undoDepth + 1);
    assert.deepEqual(before.objects.length, 1);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('moving the same lasso fragment twice records two separate commands', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke(crossingStrokePoints(), 617);
    enableRealFabricLasso(harness);
    harness.dragLasso(middleLassoPoints(), 618);
    const depthBeforeMove = harness.runtime.getDiagnostics().undoDepth;

    harness.dragActiveSelectionBy(20, -10, 619);
    await Promise.resolve();
    const firstMove = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(harness.runtime.getDiagnostics().undoDepth, depthBeforeMove + 1);

    harness.dragActiveSelectionBy(5, 15, 620);
    await Promise.resolve();
    const secondMove = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(harness.runtime.getDiagnostics().undoDepth, depthBeforeMove + 2);
    assert.notDeepEqual(secondMove.objects, firstMove.objects);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'undo-second-fragment-move', action: 'undo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, firstMove.objects);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'redo-second-fragment-move', action: 'redo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, secondMove.objects);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('one undo restores the original stroke after lasso split and fragment move', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
      { x: 110, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 65);
    const original = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 75 },
      { x: 130, y: 75 },
      { x: 130, y: 125 },
      { x: 70, y: 125 },
      { x: 70, y: 75 }
    ], 66);
    harness.dragActiveSelectionBy(20, -30, 67);
    await Promise.resolve();
    const moved = harness.sceneStore.getActiveSceneSnapshot();

    const undo = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'undo-lasso-split-1',
      action: 'undo'
    });
    const restored = harness.sceneStore.getActiveSceneSnapshot();

    assert.equal(undo.applied, true);
    assert.equal(restored.objects.length, 1);
    assert.deepEqual(restored.objects[0], original);
    assert.deepEqual(restored.selectedObjectIds, []);
    assert.equal(harness.canvas.getObjects().length, 1);
    assert.equal(harness.canvas.getActiveObject(), undefined);
    const redo = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'redo-lasso-split-1',
      action: 'redo'
    });
    assert.equal(redo.applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, moved.objects);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('one undo restores both a split fragment move and a fully enclosed stroke move', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 80 },
      { x: 80, y: 80 },
      { x: 140, y: 80 },
      { x: 180, y: 80 }
    ], 716);
    harness.drawStroke([
      { x: 85, y: 120 },
      { x: 105, y: 120 },
      { x: 125, y: 120 }
    ], 717);
    const originals = harness.sceneStore.getActiveSceneSnapshot().objects;
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 55 },
      { x: 135, y: 55 },
      { x: 135, y: 140 },
      { x: 70, y: 140 },
      { x: 70, y: 55 }
    ], 718);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, originals);
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    harness.dragActiveSelectionBy(15, 10, 719);
    await Promise.resolve();
    const moved = harness.sceneStore.getActiveSceneSnapshot();

    const undo = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'undo-mixed-lasso-move',
      action: 'undo'
    });

    assert.equal(undo.applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, originals);
    const redo = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'redo-mixed-lasso-move',
      action: 'redo'
    });
    assert.equal(redo.applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, moved.objects);
    assert.deepEqual(moved.objects.map(object => object.id), harness.sceneStore.getActiveSceneSnapshot().objects.map(object => object.id));
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('later drawing mutations keep ordered undo redo history without skipping newer work', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 80 },
      { x: 80, y: 80 },
      { x: 140, y: 80 },
      { x: 180, y: 80 }
    ], 713);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 60 },
      { x: 130, y: 60 },
      { x: 130, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 60 }
    ], 714);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'clear-after-split',
      action: 'clear-session'
    });
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 2,
      tool: 'brush'
    });
    harness.drawStroke([
      { x: 30, y: 140 },
      { x: 100, y: 140 },
      { x: 170, y: 140 }
    ], 715);
    const newer = harness.sceneStore.getActiveSceneSnapshot().objects[0];

    const undo = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'undo-newer-stroke-first',
      action: 'undo'
    });

    assert.equal(undo.applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, []);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 2);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 1);

    const redo = harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session',
      actionId: 'redo-newer-stroke-first',
      action: 'redo'
    });
    assert.equal(redo.applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, [newer]);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 3);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('a failed fragment build aborts the whole lasso split without losing stroke data', async () => {
  let failFragmentBuild = false;
  let fragmentBuildCount = 0;
  const harness = createRealFabricHarness({
    strokePathFactory(points, options) {
      if (failFragmentBuild && fragmentBuildCount++ === 0) throw new Error('synthetic fragment failure');
      return createStrokePathData(points, options);
    }
  });
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
      { x: 110, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 709);
    const original = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    failFragmentBuild = true;
    harness.dragLasso([
      { x: 70, y: 75 },
      { x: 130, y: 75 },
      { x: 130, y: 125 },
      { x: 70, y: 125 },
      { x: 70, y: 75 }
    ], 710);

    const snapshot = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(snapshot.objects, [original]);
    assert.deepEqual(snapshot.selectedObjectIds, []);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
  } finally {
    await harness.destroy();
  }
});

test('lasso fragment limits abort before replacing a complex stroke', async () => {
  const harness = createRealFabricHarness({ maxLassoFragments: 2 });
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 80, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 720);
    const original = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 75 },
      { x: 130, y: 75 },
      { x: 130, y: 125 },
      { x: 70, y: 125 },
      { x: 70, y: 75 }
    ], 721);

    const snapshot = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(snapshot.objects, [original]);
    assert.deepEqual(snapshot.selectedObjectIds, []);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
  } finally {
    await harness.destroy();
  }
});

test('cancelling an in-progress lasso leaves the original stroke untouched', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 80, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 68);
    const before = harness.sceneStore.getActiveSceneSnapshot();
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();

    harness.dispatchPointer(harness.element, 'pointerdown', 70, 75, 69, 1);
    harness.dispatchPointer(harness.element, 'pointermove', 130, 75, 69, 1);
    harness.dispatchPointer(harness.element, 'pointermove', 130, 125, 69, 1);
    harness.dispatchPointer(harness.element, 'pointercancel', 130, 125, 69, 0);

    const after = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(after, before);
    assert.equal(harness.canvas.getObjects().filter(object => !object.__baeframeTransient).length, 1);
    assert.equal(harness.canvas.getObjects().some(object => object.__baeframeTransient), false);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('cancelling a no-move pending fragment selection rolls back to the original stroke', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 60, y: 100 },
      { x: 100, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 604);
    const original = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 75 },
      { x: 130, y: 75 },
      { x: 130, y: 125 },
      { x: 70, y: 125 },
      { x: 70, y: 75 }
    ], 605);
    const center = harness.canvas.getActiveObject().getCenterPoint();
    harness.dispatchPointer(harness.element, 'pointerdown', center.x, center.y, 606, 1);
    harness.dispatchPointer(harness.element, 'pointercancel', center.x, center.y, 606, 0);

    const restored = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(restored.objects, [original]);
    assert.deepEqual(restored.selectedObjectIds, []);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
    assert.equal(harness.canvas.getObjects().filter(object => !object.__baeframeTransient).length, 1);
  } finally {
    await harness.destroy();
  }
});

test('pending lasso cancellation paths leave no proxy mutation or history', async t => {
  const scenarios = [
    ['blur', harness => {
      harness.environment.window.dispatchEvent(new harness.environment.window.Event('blur'));
    }],
    ['pointercancel', harness => {
      const center = harness.canvas.getActiveObject().getCenterPoint();
      harness.dispatchPointer(harness.element, 'pointerdown', center.x, center.y, 830, 1);
      harness.dispatchPointer(harness.element, 'pointercancel', center.x, center.y, 830, 0);
    }],
    ['pointercancel after materialize', harness => {
      const center = harness.canvas.getActiveObject().getCenterPoint();
      harness.dispatchPointer(harness.element, 'pointerdown', center.x, center.y, 832, 1);
      harness.dispatchPointer(harness.environment.document, 'pointermove', center.x + 20, center.y + 10, 832, 1);
      assert.equal(harness.canvas.getObjects().filter(object => object.__baeframeObjectId).length, 3);
      harness.dispatchPointer(harness.element, 'pointercancel', center.x + 20, center.y + 10, 832, 0);
    }],
    ['B disable', harness => {
      assert.equal(harness.runtime.setDrawingInput({
        hostGeneration: 1,
        videoGeneration: 1,
        inputRevision: 2,
        enabled: false
      }).accepted, true);
      assert.equal(harness.runtime.setDrawingInput({
        hostGeneration: 1,
        videoGeneration: 1,
        inputRevision: 3,
        enabled: true,
        session: {
          sessionId: 'real-fabric-session',
          stableVideoIdentity: 'real-fabric-video',
          targetFrame: 0,
          sourceWidth: 200,
          sourceHeight: 200,
          canvasRect: { left: 0, top: 0, width: 200, height: 200 },
          viewportTransform: { scale: 1, panX: 0, panY: 0 },
          tool: 'brush'
        }
      }).accepted, true);
    }],
    ['tool mode change', harness => {
      assert.equal(harness.runtime.updateDrawingTool({
        sessionId: 'real-fabric-session', toolRevision: 2, tool: 'brush'
      }).accepted, true);
    }],
    ['selection preset change', harness => {
      findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-stroke').click();
    }],
    ['new lasso', harness => {
      harness.dispatchPointer(harness.element, 'pointerdown', 10, 10, 831, 1);
      harness.dispatchPointer(harness.element, 'pointercancel', 10, 10, 831, 0);
    }]
  ];

  for (let index = 0; index < scenarios.length; index += 1) {
    const [name, cancel] = scenarios[index];
    await t.test(name, async () => {
      const harness = createRealFabricHarness();
      try {
        const before = stageCrossingLasso(harness, 840 + index * 10);
        const beforeHistory = {
          mutationCount: before.mutationCount,
          dirty: before.dirty,
          undoDepth: 1,
          redoDepth: 0
        };
        assert.equal(pendingLassoObjects(harness.canvas).length, 1);
        cancel(harness);
        await Promise.resolve();

        const after = harness.sceneStore.getActiveSceneSnapshot();
        assert.deepEqual(after.objects, before.objects);
        assert.equal(pendingLassoObjects(harness.canvas).length, 0);
        const diagnostics = harness.runtime.getDiagnostics();
        assert.equal(diagnostics.mutationCount, beforeHistory.mutationCount);
        assert.equal(diagnostics.dirty, beforeHistory.dirty);
        assert.equal(diagnostics.undoDepth, beforeHistory.undoDepth);
        assert.equal(diagnostics.redoDepth, beforeHistory.redoDepth);
        assert.equal(diagnostics.metrics.saveAttemptCount, 0);
      } finally {
        await harness.destroy();
      }
    });
  }
});

test('pending lasso Undo and Redo abort selection before applying committed history', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke(crossingStrokePoints(), 900);
    const first = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.drawStroke(crossingStrokePoints(175), 901);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'prepare-pending-redo', action: 'undo'
    }).applied, true);
    enableRealFabricLasso(harness);
    harness.dragLasso(middleLassoPoints(), 902);
    assert.equal(pendingLassoObjects(harness.canvas).length, 1);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'redo-with-pending-lasso', action: 'redo'
    }).applied, true);
    assert.equal(harness.sceneStore.getActiveSceneSnapshot().objects.length, 2);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);

    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'remove-second-before-pending-undo', action: 'undo'
    }).applied, true);
    enableRealFabricLasso(harness, 2);
    harness.dragLasso(middleLassoPoints(), 903);
    assert.equal(harness.runtime.applyDrawingAction({
      sessionId: 'real-fabric-session', actionId: 'undo-with-pending-lasso', action: 'undo'
    }).applied, true);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, []);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.equal(first.type, 'stroke');
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('zero-distance pending lasso move restores original visual and remains a no-op', async () => {
  const harness = createRealFabricHarness();
  try {
    const before = stageCrossingLasso(harness, 910);
    const beforeHistory = lassoHistoryState(harness.runtime);
    const target = harness.canvas.getActiveObject();
    harness.canvas.fire('before:transform', { transform: { target } });
    harness.canvas.fire('object:moving', { target });
    assert.equal(harness.canvas.getObjects().length, 3);
    harness.canvas.fire('object:modified', { target });

    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot(), before);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.equal(harness.canvas.getObjects().filter(object => object.__baeframeObjectId).length, 1);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('stale pending lasso session revision and source mutation never commit a split', async t => {
  await t.test('input revision', async () => {
    const harness = createRealFabricHarness();
    try {
      const before = stageCrossingLasso(harness, 920);
      assert.equal(harness.runtime.setDrawingInput({
        hostGeneration: 1,
        videoGeneration: 1,
        inputRevision: 2,
        enabled: true,
        session: {
          sessionId: 'real-fabric-session', stableVideoIdentity: 'real-fabric-video', targetFrame: 0,
          sourceWidth: 200, sourceHeight: 200,
          canvasRect: { left: 0, top: 0, width: 200, height: 200 },
          viewportTransform: { scale: 1, panX: 0, panY: 0 }, tool: 'select'
        }
      }).accepted, true);
      assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, before.objects);
      assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    } finally {
      await harness.destroy();
    }
  });

  await t.test('session', async () => {
    const harness = createRealFabricHarness();
    try {
      stageCrossingLasso(harness, 930);
      assert.equal(harness.runtime.setDrawingInput({
        hostGeneration: 1,
        videoGeneration: 1,
        inputRevision: 2,
        enabled: true,
        session: {
          sessionId: 'next-real-fabric-session', stableVideoIdentity: 'real-fabric-video', targetFrame: 1,
          sourceWidth: 200, sourceHeight: 200,
          canvasRect: { left: 0, top: 0, width: 200, height: 200 },
          viewportTransform: { scale: 1, panX: 0, panY: 0 }, tool: 'select'
        }
      }).accepted, true);
      assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, []);
      assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    } finally {
      await harness.destroy();
    }
  });

  await t.test('source mutation count', async () => {
    const harness = createRealFabricHarness();
    try {
      const before = stageCrossingLasso(harness, 940);
      const target = harness.canvas.getActiveObject();
      const external = makeHistoryStroke('external-after-lasso', {
        sourcePoints: [{ x: 10, y: 180 }, { x: 30, y: 180 }]
      });
      assert.equal(harness.sceneStore.addStroke(external).applied, true);
      harness.canvas.fire('before:transform', { transform: { target } });
      target.set({ left: target.left + 20 });
      harness.canvas.fire('object:moving', { target });
      harness.canvas.fire('object:modified', { target });

      const after = harness.sceneStore.getActiveSceneSnapshot();
      assert.deepEqual(after.objects.map(object => object.id), [before.objects[0].id, external.id]);
      assert.equal(pendingLassoObjects(harness.canvas).length, 0);
      assert.deepEqual(harness.canvas.getObjects().map(object => object.__baeframeObjectId), [before.objects[0].id, external.id]);
      assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
    } finally {
      await harness.destroy();
    }
  });
});

test('pending lasso commit failure restores the original scene and Fabric paths', async () => {
  const sceneStore = createSessionSceneStore();
  const realReplaceObjects = sceneStore.replaceObjects;
  let replaceAttempts = 0;
  sceneStore.replaceObjects = change => {
    replaceAttempts += 1;
    if (change?.kind === 'split-stroke') return { applied: false, reason: 'history-capacity-exceeded' };
    return realReplaceObjects(change);
  };
  const harness = createRealFabricHarness({ sceneStore });
  try {
    const before = stageCrossingLasso(harness, 950);
    const beforeHistory = lassoHistoryState(harness.runtime);
    harness.dragActiveSelectionBy(20, 10, 952);
    await Promise.resolve();

    assert.equal(replaceAttempts, 1);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, before.objects);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.deepEqual(harness.canvas.getObjects().map(object => object.__baeframeObjectId), [before.objects[0].id]);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('pending lasso history capacity rejection preserves the original scene atomically', async () => {
  const harness = createRealFabricHarness({ sceneStoreOptions: { maxHistoryBytes: 10000 } });
  try {
    const before = stageCrossingLasso(harness, 960);
    const beforeHistory = lassoHistoryState(harness.runtime);
    harness.dragActiveSelectionBy(20, 10, 962);
    await Promise.resolve();

    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, before.objects);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.deepEqual(harness.canvas.getObjects().map(object => object.__baeframeObjectId), [before.objects[0].id]);
  } finally {
    await harness.destroy();
  }
});

test('pending multi-lasso aborts if Fabric transforms only a subset of its selection', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke(crossingStrokePoints(90), 970);
    harness.drawStroke(crossingStrokePoints(110), 971);
    const before = harness.sceneStore.getActiveSceneSnapshot();
    const beforeHistory = lassoHistoryState(harness.runtime);
    enableRealFabricLasso(harness);
    harness.dragLasso(middleLassoPoints(70, 130), 972);

    const activeSelection = harness.canvas.getActiveObject();
    const [subset] = activeSelection.getObjects();
    assert.equal(activeSelection.getObjects().length, 2);
    harness.canvas.fire('before:transform', { transform: { target: subset } });
    subset.set({ left: subset.left + 20, top: subset.top + 10 });
    harness.canvas.fire('object:moving', { target: subset });
    harness.canvas.fire('object:modified', { target: subset });

    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, before.objects);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.deepEqual(
      harness.canvas.getObjects().map(object => object.__baeframeObjectId),
      before.objects.map(object => object.id)
    );
  } finally {
    await harness.destroy();
  }
});

test('pending lasso proxy construction failure restores the untouched original', async () => {
  const realFabric = require('fabric/node');
  let armed = false;
  let repeatedStrokePathCount = 0;
  const constructionCountsByPath = new Map();
  class ThrowingPendingPath extends realFabric.Path {
    constructor(...args) {
      if (armed) {
        const pathData = String(args[0] || '');
        const constructionCount = (constructionCountsByPath.get(pathData) || 0) + 1;
        constructionCountsByPath.set(pathData, constructionCount);
        if (constructionCount === 2 && pathData.includes(' Q ')) {
          repeatedStrokePathCount += 1;
          if (repeatedStrokePathCount === 2) {
            throw new Error('synthetic pending proxy construction failure');
          }
        }
      }
      super(...args);
    }
  }
  const harness = createRealFabricHarness({ fabric: { Path: ThrowingPendingPath } });
  try {
    harness.drawStroke(crossingStrokePoints(90), 980);
    harness.drawStroke(crossingStrokePoints(110), 981);
    const before = harness.sceneStore.getActiveSceneSnapshot();
    const beforeHistory = lassoHistoryState(harness.runtime);
    enableRealFabricLasso(harness);
    armed = true;

    assert.doesNotThrow(() => harness.dragLasso(middleLassoPoints(70, 130), 982));
    assert.equal(repeatedStrokePathCount, 2);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot(), before);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.deepEqual(
      harness.canvas.getObjects().map(object => object.__baeframeObjectId),
      before.objects.map(object => object.id)
    );
  } finally {
    await harness.destroy();
  }
});

test('pending lasso materialization failure restores the untouched original', async () => {
  const harness = createRealFabricHarness();
  try {
    const before = stageCrossingLasso(harness, 990);
    const beforeHistory = lassoHistoryState(harness.runtime);
    const originalAdd = harness.canvas.add.bind(harness.canvas);
    let rejectNextMaterializedFragment = true;
    harness.canvas.add = (...objects) => {
      if (rejectNextMaterializedFragment && objects.some(object => (
        object.__baeframePendingLasso && object.opacity !== 0
      ))) {
        rejectNextMaterializedFragment = false;
        throw new Error('synthetic pending fragment add failure');
      }
      return originalAdd(...objects);
    };
    const target = harness.canvas.getActiveObject();

    assert.doesNotThrow(() => {
      harness.canvas.fire('before:transform', { transform: { target } });
      target.set({ left: target.left + 20, top: target.top + 10 });
      harness.canvas.fire('object:moving', { target });
      harness.canvas.fire('object:modified', { target });
    });

    assert.equal(rejectNextMaterializedFragment, false);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot(), before);
    assert.deepEqual(lassoHistoryState(harness.runtime), beforeHistory);
    assert.equal(pendingLassoObjects(harness.canvas).length, 0);
    assert.deepEqual(
      harness.canvas.getObjects().map(object => object.__baeframeObjectId),
      before.objects.map(object => object.id)
    );
  } finally {
    await harness.destroy();
  }
});

test('the newest viewport update applies as soon as a lasso gesture settles', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dispatchPointer(harness.element, 'pointerdown', 30, 30, 708, 1);
    harness.dispatchPointer(harness.element, 'pointermove', 60, 30, 708, 1);
    assert.deepEqual(harness.runtime.updateViewport({
      revision: 2,
      canvasRect: { left: 5, top: 7, width: 180, height: 160 },
      scale: 1.1,
      panX: 2,
      panY: -3
    }), { accepted: true, deferred: true, revision: 2 });
    assert.equal(harness.runtime.getDiagnostics().viewportRevision, 0);

    harness.dispatchCapturedPointerUp(60, 60, 708);

    assert.equal(harness.runtime.getDiagnostics().viewportRevision, 2);
  } finally {
    await harness.destroy();
  }
});

test('a zero-area lasso line never cuts a nearby thick stroke', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 80, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 711);
    const original = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 99 },
      { x: 100, y: 99 },
      { x: 130, y: 99 }
    ], 712);

    const snapshot = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(snapshot.objects, [original]);
    assert.deepEqual(snapshot.selectedObjectIds, []);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
  } finally {
    await harness.destroy();
  }
});

test('empty and fully enclosing lassos select non-destructively', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 40, y: 100 },
      { x: 70, y: 100 },
      { x: 100, y: 100 }
    ], 70);
    const original = harness.sceneStore.getActiveSceneSnapshot().objects[0];
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();

    harness.dragLasso([
      { x: 140, y: 140 },
      { x: 180, y: 140 },
      { x: 180, y: 180 },
      { x: 140, y: 180 },
      { x: 140, y: 140 }
    ], 701);
    let snapshot = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(snapshot.objects, [original]);
    assert.deepEqual(snapshot.selectedObjectIds, []);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);

    harness.dragLasso([
      { x: 20, y: 70 },
      { x: 120, y: 70 },
      { x: 120, y: 130 },
      { x: 20, y: 130 },
      { x: 20, y: 70 }
    ], 702);
    snapshot = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(snapshot.objects, [original]);
    assert.deepEqual(snapshot.selectedObjectIds, [original.id]);
    assert.equal(harness.runtime.getDiagnostics().undoDepth, 1);
    assert.equal(harness.runtime.getDiagnostics().redoDepth, 0);
  } finally {
    await harness.destroy();
  }
});

test('switching a selected stroke into lasso mode keeps it immediately movable', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 30, y: 100 },
      { x: 80, y: 100 },
      { x: 130, y: 100 }
    ], 703);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    harness.clickStroke(0, 704);
    const before = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(before.selectedObjectIds.length, 1);

    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragActiveSelectionBy(20, 10, 705);
    await Promise.resolve();

    const after = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(after.selectedObjectIds, before.selectedObjectIds);
    assert.equal(after.objects[0].transform.left, before.objects[0].transform.left + 20);
    assert.equal(after.objects[0].transform.top, before.objects[0].transform.top + 10);
  } finally {
    await harness.destroy();
  }
});

test('lasso commits an already moved stroke at its visible position without jumping', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
      { x: 110, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 71);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    harness.dragStrokeBy(0, 20, 30, undefined, 72);
    await Promise.resolve();
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();

    harness.dragLasso([
      { x: 90, y: 105 },
      { x: 150, y: 105 },
      { x: 150, y: 155 },
      { x: 90, y: 155 },
      { x: 90, y: 105 }
    ], 73);
    assert.equal(harness.sceneStore.getActiveSceneSnapshot().objects.length, 1);
    harness.dragActiveSelectionBy(10, 0, 731);
    await Promise.resolve();

    const snapshot = harness.sceneStore.getActiveSceneSnapshot();
    const fragments = snapshot.objects
      .map(object => ({
        id: object.id,
        minX: Math.min(...object.sourcePoints.map(point => point.x)),
        maxX: Math.max(...object.sourcePoints.map(point => point.x)),
        ys: object.sourcePoints.map(point => point.y)
      }))
      .sort((left, right) => left.minX - right.minX);

    assert.deepEqual(fragments.map(fragment => [
      Number(fragment.minX.toFixed(1)),
      Number(fragment.maxX.toFixed(1))
    ]), [
      [40, 88.5],
      [88.5, 151.5],
      [151.5, 200]
    ]);
    assert.equal(fragments.every(fragment => fragment.ys.every(y => y === 130)), true);
    assert.deepEqual(snapshot.selectedObjectIds, [fragments[1].id]);
  } finally {
    await harness.destroy();
  }
});

test('lasso stages the visible edge of a thick stroke without mutating the scene', async () => {
  const harness = createRealFabricHarness();
  try {
    const sizeInput = findOne(harness.root, node => node.dataset.fabricPilotSetting === 'size');
    sizeInput.value = '30';
    sizeInput.dispatchEvent(new harness.environment.window.Event('input', { bubbles: true }));
    harness.drawStroke([
      { x: 20, y: 100 },
      { x: 50, y: 100 },
      { x: 80, y: 100 },
      { x: 110, y: 100 },
      { x: 140, y: 100 },
      { x: 180, y: 100 }
    ], 706);
    const originalId = harness.sceneStore.getActiveSceneSnapshot().objects[0].id;
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 84 },
      { x: 130, y: 84 },
      { x: 130, y: 94 },
      { x: 70, y: 94 },
      { x: 70, y: 84 }
    ], 707);

    const snapshot = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(snapshot.objects.some(object => object.id === originalId), true);
    assert.equal(snapshot.objects.length, 1);
    assert.equal(pendingLassoObjects(harness.canvas).length > 0, true);
    assert.equal(harness.canvas.getActiveObjects().length > 0, true);
  } finally {
    await harness.destroy();
  }
});

test('one lasso moves matching segments from two strokes and releases the group box', async () => {
  const harness = createRealFabricHarness();
  try {
    const pointsAt = y => [
      { x: 20, y },
      { x: 50, y },
      { x: 80, y },
      { x: 110, y },
      { x: 140, y },
      { x: 180, y }
    ];
    harness.drawStroke(pointsAt(80), 74);
    harness.drawStroke(pointsAt(120), 75);
    const originals = harness.sceneStore.getActiveSceneSnapshot().objects;
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 50 },
      { x: 130, y: 50 },
      { x: 130, y: 150 },
      { x: 70, y: 150 },
      { x: 70, y: 50 }
    ], 76);

    const staged = harness.sceneStore.getActiveSceneSnapshot();
    assert.deepEqual(staged.objects, originals);
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    const selectedIds = new Set(harness.canvas.getActiveObjects().map(object => object.__baeframeObjectId));

    harness.dragActiveSelectionBy(15, -10, 77);
    await Promise.resolve();

    const after = harness.sceneStore.getActiveSceneSnapshot();
    assert.equal(after.objects.length, 6);
    assert.deepEqual(after.selectedObjectIds, []);
    assert.equal(harness.canvas.getActiveObject(), undefined);
    const formerlySelected = harness.canvas.getObjects().filter(
      object => selectedIds.has(object.__baeframeObjectId)
    );
    assert.equal(formerlySelected.every(object => object.selectable === false && object.evented === false), true);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'crosshair');
    for (const id of selectedIds) {
      const moved = after.objects.find(object => object.id === id);
      const xs = moved.sourcePoints.map(point => point.x);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      assert.equal(Math.round(moved.transform.left), Math.round(centerX + 15));
      assert.equal(Math.round(moved.transform.top), Math.round(moved.sourcePoints[0].y - 10));
    }
    const nextLassoStart = formerlySelected[0].getCenterPoint();
    harness.dispatchPointer(harness.element, 'pointerdown', nextLassoStart.x, nextLassoStart.y, 771, 1);
    assert.equal(harness.canvas.getActiveObject(), undefined);
    harness.dispatchPointer(harness.element, 'pointercancel', nextLassoStart.x, nextLassoStart.y, 771, 0);
    assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().selectedObjectIds, []);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('lasso keeps untouched strokes between the replacement fragments at their original z-order', async () => {
  const harness = createRealFabricHarness();
  try {
    const pointsAt = y => [
      { x: 20, y },
      { x: 60, y },
      { x: 100, y },
      { x: 140, y },
      { x: 180, y }
    ];
    harness.drawStroke(pointsAt(60), 78);
    harness.drawStroke(pointsAt(100), 79);
    harness.drawStroke(pointsAt(140), 80);
    const middleId = harness.sceneStore.getActiveSceneSnapshot().objects[1].id;
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    findOne(harness.root, node => node.dataset.fabricPilotAction === 'select-lasso').click();
    harness.dragLasso([
      { x: 70, y: 45 },
      { x: 130, y: 45 },
      { x: 130, y: 80 },
      { x: 190, y: 80 },
      { x: 190, y: 120 },
      { x: 130, y: 120 },
      { x: 130, y: 155 },
      { x: 70, y: 155 },
      { x: 70, y: 120 },
      { x: 10, y: 120 },
      { x: 10, y: 80 },
      { x: 70, y: 80 },
      { x: 70, y: 45 }
    ], 81);
    assert.equal(harness.sceneStore.getActiveSceneSnapshot().objects.length, 3);
    harness.dragActiveSelectionBy(1, 0, 811);
    await Promise.resolve();

    const objects = harness.sceneStore.getActiveSceneSnapshot().objects;
    const middleIndex = objects.findIndex(object => object.id === middleId);
    const layerY = object => Math.round(object.sourcePoints[0].y);
    const upperIndices = objects.map((object, index) => layerY(object) === 60 ? index : -1).filter(index => index >= 0);
    const lowerIndices = objects.map((object, index) => layerY(object) === 140 ? index : -1).filter(index => index >= 0);

    assert.equal(middleIndex >= 0, true);
    assert.equal(upperIndices.every(index => index < middleIndex), true);
    assert.equal(lowerIndices.every(index => index > middleIndex), true);
  } finally {
    await harness.destroy();
  }
});

test('real Fabric thin stroke hit margin drives honest hover cursors', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStrokeAt(30, 70);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    const center = harness.canvas.getObjects()[0].getCenterPoint();

    harness.hoverAt(center.x, center.y + 5);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grab');
    harness.hoverAt(center.x, center.y + 20);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'default');
    harness.dragStrokeBy(0, 2, 0, () => {
      assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grabbing');
    });
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'move');
  } finally {
    await harness.destroy();
  }
});

test('selected stroke owns its full bounds with a move cursor and restores pixel hit testing on switch', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStroke([
      { x: 20, y: 20 },
      { x: 40, y: 40 },
      { x: 60, y: 60 },
      { x: 80, y: 80 }
    ], 200);
    harness.drawStroke([
      { x: 120, y: 20 },
      { x: 140, y: 40 },
      { x: 160, y: 60 },
      { x: 180, y: 80 }
    ], 201);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });

    const [first, second] = harness.canvas.getObjects();
    harness.clickStroke(0, 202);
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [first]);

    const firstBounds = first.getBoundingRect();
    const firstTransparentPoint = {
      x: firstBounds.left + (firstBounds.width * 0.25),
      y: firstBounds.top + (firstBounds.height * 0.75)
    };
    const firstHover = harness.hoverAt(firstTransparentPoint.x, firstTransparentPoint.y);
    assert.equal(harness.canvas.findTarget(firstHover).target, first);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'move');
    assert.equal(first.perPixelTargetFind, false);
    assert.equal(first.hoverCursor, 'move');
    assert.equal(second.perPixelTargetFind, true);
    assert.equal(second.hoverCursor, 'grab');

    const beforeMove = harness.sceneTransforms();
    harness.dragFrom(firstTransparentPoint, 10, 5, () => {
      assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grabbing');
    }, 203);
    await Promise.resolve();
    const afterMove = harness.sceneTransforms();
    assert.deepEqual(afterMove[0], {
      left: beforeMove[0].left + 10,
      top: beforeMove[0].top + 5
    });
    assert.deepEqual(afterMove[1], beforeMove[1]);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 3);

    harness.clickStroke(1, 204);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [second]);
    assert.equal(first.perPixelTargetFind, true);
    assert.equal(first.hoverCursor, 'grab');
    assert.equal(second.perPixelTargetFind, false);
    assert.equal(second.hoverCursor, 'move');

    const secondBounds = second.getBoundingRect();
    const secondTransparentPoint = {
      x: secondBounds.left + (secondBounds.width * 0.25),
      y: secondBounds.top + (secondBounds.height * 0.75)
    };
    const secondHover = harness.hoverAt(secondTransparentPoint.x, secondTransparentPoint.y);
    assert.equal(harness.canvas.findTarget(secondHover).target, second);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'move');

    const blankHover = harness.hoverAt(195, 195);
    assert.equal(harness.canvas.findTarget(blankHover).target, undefined);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'default');
    const finalDiagnostics = harness.runtime.getDiagnostics();
    assert.equal(finalDiagnostics.mutationCount, 3);
    assert.equal(finalDiagnostics.dirty, true);
    assert.equal(finalDiagnostics.metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('active selection bounds use move and released strokes return to grab', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStrokeAt(30, 210);
    harness.drawStroke([
      { x: 120, y: 90 },
      { x: 170, y: 90 }
    ], 211);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });

    harness.dragMarquee({ x: 10, y: 10 }, { x: 190, y: 110 }, 212);
    await Promise.resolve();
    const activeSelection = harness.canvas.getActiveObject();
    const paths = harness.canvas.getObjects();
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    const emptyGroupPoint = activeSelection.getCenterPoint();
    const groupHover = harness.hoverAt(emptyGroupPoint.x, emptyGroupPoint.y);
    assert.equal(harness.canvas.findTarget(groupHover).target, activeSelection);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'move');
    assert.equal(activeSelection.perPixelTargetFind, false);
    assert.equal(activeSelection.hoverCursor, 'move');
    for (const path of paths) {
      assert.equal(path.perPixelTargetFind, true);
      assert.equal(path.hoverCursor, 'grab');
    }

    const beforeMove = harness.sceneTransforms();
    harness.dragFrom(emptyGroupPoint, 12, 8, () => {
      assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grabbing');
    }, 213);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.canvas.getActiveObjects().length, 0);
    assert.equal(harness.runtime.getDiagnostics().selectionCount, 0);
    assert.deepEqual(harness.sceneTransforms(), beforeMove.map(transform => ({
      left: transform.left + 12,
      top: transform.top + 8
    })));
    for (const path of paths) {
      assert.equal(path.perPixelTargetFind, true);
      assert.equal(path.hoverCursor, 'grab');
      const center = path.getCenterPoint();
      const pathHover = harness.hoverAt(center.x, center.y);
      assert.equal(harness.canvas.findTarget(pathHover).target, path);
      assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grab');
    }

    const blankHover = harness.hoverAt(195, 195);
    assert.equal(harness.canvas.findTarget(blankHover).target, undefined);
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'default');
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 3);
    assert.equal(harness.runtime.getDiagnostics().dirty, true);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('moved real Fabric marquee settles before the next single-stroke drag', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStrokeAt(30, 71);
    harness.drawStrokeAt(70, 72);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });

    harness.dragMarquee({ x: 10, y: 10 }, { x: 100, y: 100 });
    await Promise.resolve();
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    harness.dragActiveSelectionBy(20, 10);
    await Promise.resolve();

    assert.equal(harness.canvas.getActiveObjects().length, 0);
    assert.equal(harness.runtime.getDiagnostics().selectionCount, 0);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 3);

    const before = harness.sceneTransforms();
    harness.dragStrokeBy(0, 15, 5);
    const after = harness.sceneTransforms();
    assert.deepEqual(after[0], { ...before[0], left: before[0].left + 15, top: before[0].top + 5 });
    assert.deepEqual(after[1], before[1]);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 4);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('captured select pointerup settles a moved marquee without a direct document mouseup', async () => {
  const harness = createRealFabricHarness();
  const selectionPointerId = 112;
  try {
    harness.drawStrokeAt(30, 110);
    harness.drawStrokeAt(70, 111);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });

    harness.dragMarquee({ x: 10, y: 10 }, { x: 100, y: 100 }, 113);
    await Promise.resolve();
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    const before = harness.sceneTransforms();

    harness.dragActiveSelectionBy(20, 10, selectionPointerId);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.canvas.getActiveObjects().length, 0);
    assert.equal(harness.runtime.getDiagnostics().selectionCount, 0);
    assert.deepEqual(harness.sceneTransforms(), before.map(transform => ({
      left: transform.left + 20,
      top: transform.top + 10
    })));
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 3);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
    assert.equal(
      harness.pointerCapture.captureRequests.filter(pointerId => pointerId === selectionPointerId).length,
      1
    );
    assert.equal(
      harness.pointerCapture.releaseRequests.filter(pointerId => pointerId === selectionPointerId).length,
      1
    );
    assert.equal(harness.element.hasPointerCapture(selectionPointerId), false);
    assert.deepEqual(
      harness.pointerDispatches.filter(event => event.pointerId === selectionPointerId && event.type === 'pointerup'),
      [{ target: 'upperCanvasEl', type: 'pointerup', pointerId: selectionPointerId }]
    );
    assert.deepEqual(
      harness.pointerCapture.retargets.filter(event => event.pointerId === selectionPointerId),
      [{ pointerId: selectionPointerId, from: 'document', to: 'upperCanvasEl' }]
    );
    assert.equal(
      harness.pointerCapture.lostEvents.filter(pointerId => pointerId === selectionPointerId).length,
      1
    );
  } finally {
    await harness.destroy();
  }
});

test('viewport update during a stroke click waits and preserves the new selection', async () => {
  const harness = createRealFabricHarness();
  let selectionClearedCount = 0;
  const onSelectionCleared = () => { selectionClearedCount += 1; };
  try {
    harness.drawStrokeAt(30, 120);
    harness.drawStrokeAt(90, 121);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });

    harness.clickStroke(0, 122);
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[0]]);
    harness.canvas.on('selection:cleared', onSelectionCleared);

    let viewportResult;
    harness.clickStroke(1, 123, () => {
      viewportResult = harness.runtime.updateViewport({
        revision: 1,
        canvasRect: { left: 5, top: 10, width: 200, height: 200 },
        scale: 1.1,
        panX: 3,
        panY: -2
      });
      assert.deepEqual(viewportResult, { accepted: true, deferred: true, revision: 1 });
      assert.equal(harness.runtime.getDiagnostics().viewportRevision, 0);
    });
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.runtime.getDiagnostics().viewportRevision, 1);
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[1]]);
    assert.equal(selectionClearedCount, 0);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);

    harness.clickStroke(0, 124);
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[0]]);
    assert.equal(selectionClearedCount, 0);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.deepEqual(harness.runtime.updateViewport({
      revision: 2,
      canvasRect: { left: 8, top: 12, width: 200, height: 200 },
      scale: 1.2,
      panX: 4,
      panY: -1
    }), { accepted: true, revision: 2 });
    assert.equal(harness.runtime.getDiagnostics().viewportRevision, 2);
  } finally {
    harness.canvas.off('selection:cleared', onSelectionCleared);
    await harness.destroy();
  }
});

test('document fallback settles a select gesture when pointer capture fails', async () => {
  const harness = createRealFabricHarness();
  try {
    harness.drawStrokeAt(30, 180);
    harness.drawStrokeAt(90, 181);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    harness.element.setPointerCapture = pointerId => {
      harness.pointerCapture.captureRequests.push(pointerId);
      throw new Error('pointer capture unavailable');
    };
    harness.element.hasPointerCapture = () => false;

    const firstCenter = harness.canvas.getObjects()[0].getCenterPoint();
    harness.dispatchPointer(harness.element, 'pointerdown', firstCenter.x, firstCenter.y, 182, 1);
    assert.deepEqual(harness.runtime.updateViewport({
      revision: 1,
      canvasRect: { left: 2, top: 4, width: 200, height: 200 },
      scale: 1.1,
      panX: 1,
      panY: -1
    }), { accepted: true, deferred: true, revision: 1 });
    assert.deepEqual(harness.runtime.updateViewport({
      revision: 3,
      canvasRect: { left: 6, top: 8, width: 200, height: 200 },
      scale: 1.2,
      panX: 2,
      panY: -2
    }), { accepted: true, deferred: true, revision: 3 });
    harness.dispatchPointer(
      harness.environment.document,
      'pointermove',
      firstCenter.x,
      firstCenter.y,
      182,
      1
    );
    harness.dispatchPointer(
      harness.environment.document,
      'pointerup',
      firstCenter.x,
      firstCenter.y,
      182,
      0
    );
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.pointerCapture.captureRequests.filter(pointerId => pointerId === 182).length, 1);
    assert.equal(harness.runtime.getDiagnostics().viewportRevision, 3);
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[0]]);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);

    harness.clickStroke(1, 183);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[1]]);
    assert.deepEqual(harness.runtime.updateViewport({
      revision: 4,
      canvasRect: { left: 8, top: 10, width: 200, height: 200 },
      scale: 1.25,
      panX: 3,
      panY: -1
    }), { accepted: true, revision: 4 });
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    await harness.destroy();
  }
});

test('cancelled select gestures restore Fabric input for paths, active selections, and blank marquees', async () => {
  const harness = createRealFabricHarness();
  let fabricMoveCount = 0;
  const onFabricMove = () => { fabricMoveCount += 1; };
  const cancelDrag = (point, delta, pointerId, cancelType = 'pointercancel') => {
    harness.dispatchPointer(harness.element, 'pointerdown', point.x, point.y, pointerId, 1);
    harness.dispatchPointer(
      harness.environment.document,
      'pointermove',
      point.x + delta.x,
      point.y + delta.y,
      pointerId,
      1
    );
    if (cancelType === 'lostpointercapture') {
      harness.dispatchLostPointerCapture(pointerId);
    } else {
      harness.dispatchPointer(
        harness.element,
        'pointercancel',
        point.x + delta.x,
        point.y + delta.y,
        pointerId,
        0
      );
    }
  };
  const assertPointerRoutingRestored = pointerId => {
    const beforeDocumentMove = fabricMoveCount;
    harness.dispatchPointer(harness.environment.document, 'pointermove', 150, 150, pointerId, 0);
    assert.equal(fabricMoveCount, beforeDocumentMove);
    harness.hoverAt(150, 150);
    assert.equal(fabricMoveCount, beforeDocumentMove + 1);
  };

  try {
    harness.drawStrokeAt(30, 150);
    harness.drawStrokeAt(90, 151);
    harness.runtime.updateDrawingTool({
      sessionId: 'real-fabric-session',
      toolRevision: 1,
      tool: 'select'
    });
    harness.canvas.on('mouse:move', onFabricMove);

    harness.clickStroke(0, 152);
    await Promise.resolve();
    const beforePathCancel = harness.sceneTransforms();
    cancelDrag(harness.canvas.getObjects()[0].getCenterPoint(), { x: 15, y: 5 }, 153);
    await Promise.resolve();
    assert.deepEqual(harness.sceneTransforms(), beforePathCancel);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.equal(harness.element.hasPointerCapture(153), false);
    assertPointerRoutingRestored(154);
    harness.clickStroke(1, 155);
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[1]]);

    harness.dragMarquee({ x: 10, y: 10 }, { x: 100, y: 120 }, 156);
    await Promise.resolve();
    assert.equal(harness.canvas.getActiveObjects().length, 2);
    const beforeGroupCancel = harness.sceneTransforms();
    cancelDrag(
      harness.canvas.getActiveObject().getCenterPoint(),
      { x: 20, y: 10 },
      157,
      'lostpointercapture'
    );
    await Promise.resolve();
    assert.deepEqual(harness.sceneTransforms(), beforeGroupCancel);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.equal(harness.element.hasPointerCapture(157), false);
    assertPointerRoutingRestored(158);

    harness.dispatchPointer(harness.element, 'pointerdown', 5, 5, 159, 1);
    harness.dispatchPointer(harness.environment.document, 'pointermove', 100, 120, 159, 1);
    harness.environment.window.dispatchEvent(new harness.environment.window.Event('blur'));
    await Promise.resolve();
    assert.equal(harness.canvas.getActiveObjects().length, 0);
    assert.equal(harness.runtime.getDiagnostics().selectionCount, 0);
    assert.equal(harness.runtime.getDiagnostics().mutationCount, 2);
    assert.equal(harness.element.hasPointerCapture(159), false);
    assertPointerRoutingRestored(160);
    harness.clickStroke(0, 161);
    await Promise.resolve();
    assert.deepEqual(harness.canvas.getActiveObjects(), [harness.canvas.getObjects()[0]]);
    assert.equal(harness.runtime.getDiagnostics().metrics.saveAttemptCount, 0);
  } finally {
    harness.canvas.off('mouse:move', onFabricMove);
    await harness.destroy();
  }
});

test('latest deferred viewport wins after one select gesture settles', () => {
  FakeCanvas.instances = [];
  const queuedMicrotasks = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    queueMicrotask: callback => queuedMicrotasks.push(callback)
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });
  const canvas = FakeCanvas.instances[0];
  const element = canvas.upperCanvasEl;

  element.dispatch('pointerdown', { pointerId: 130, pointerType: 'mouse', button: 0, buttons: 1 });
  assert.deepEqual(runtime.updateViewport({
    revision: 1,
    canvasRect: { left: 1, top: 1, width: 900, height: 500 },
    scale: 1.1,
    panX: 1,
    panY: 1
  }), { accepted: true, deferred: true, revision: 1 });
  assert.deepEqual(runtime.updateViewport({
    revision: 3,
    canvasRect: { left: 3, top: 3, width: 700, height: 400 },
    scale: 1.3,
    panX: 3,
    panY: 3
  }), { accepted: true, deferred: true, revision: 3 });
  assert.deepEqual(runtime.updateViewport({
    revision: 2,
    canvasRect: { left: 2, top: 2, width: 800, height: 450 },
    scale: 1.2,
    panX: 2,
    panY: 2
  }), { accepted: false, reason: 'stale-viewport' });
  assert.equal(runtime.getDiagnostics().viewportRevision, 0);
  assert.equal(canvas.calcOffsetCalls, 1);

  element.dispatch('pointerup', { pointerId: 130, pointerType: 'mouse', button: 0, buttons: 0 });
  assert.equal(queuedMicrotasks.length, 1);
  queuedMicrotasks.shift()();

  assert.equal(runtime.getDiagnostics().viewportRevision, 3);
  assert.equal(canvas.calcOffsetCalls, 2);
  assert.deepEqual(canvas.dimensionCalls.at(-1), {
    dimensions: { width: 700, height: 400 },
    options: { cssOnly: true }
  });
  assert.equal(runtime.getDiagnostics().mutationCount, 0);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
});

test('brush stroke from a replaced enabled input cannot mutate the new session', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  const element = canvas.upperCanvasEl;

  element.dispatch('pointerdown', {
    pointerId: 170,
    pointerType: 'pen',
    button: 0,
    buttons: 1,
    clientX: 10,
    clientY: 20,
    pressure: 0.4,
    timeStamp: 1
  });
  element.dispatch('pointermove', {
    pointerId: 170,
    pointerType: 'pen',
    buttons: 1,
    clientX: 30,
    clientY: 40,
    pressure: 0.7,
    timeStamp: 2
  });
  assert.equal(canvas.getObjects().length, 1);

  const replacementInput = makeInput({
    inputRevision: 2,
    session: {
      ...makeInput().session,
      sessionId: 'replacement-brush-session',
      stableVideoIdentity: 'replacement-brush-video',
      targetFrame: 25,
      tool: 'brush'
    }
  });
  assert.equal(runtime.setDrawingInput(replacementInput).accepted, true);
  assert.equal(canvas.getObjects().length, 0);
  const beforeRelease = runtime.getDiagnostics();

  element.dispatch('pointerup', {
    pointerId: 170,
    pointerType: 'pen',
    button: 0,
    buttons: 0,
    clientX: 50,
    clientY: 60,
    pressure: 0,
    timeStamp: 3
  });

  const afterRelease = runtime.getDiagnostics();
  assert.equal(afterRelease.activeSessionId, 'replacement-brush-session');
  assert.equal(afterRelease.objectCount, 0);
  assert.equal(afterRelease.mutationCount, beforeRelease.mutationCount);
  assert.equal(afterRelease.dirty, beforeRelease.dirty);
  assert.equal(afterRelease.dirty, false);
  assert.equal(afterRelease.metrics.saveAttemptCount, 0);
  assert.equal(canvas.getObjects().length, 0);
});

test('stale deferred viewport is discarded by input disable or session replacement', () => {
  function createHarness() {
    const queuedMicrotasks = [];
    const document = new FakeDocument();
    const root = document.createElement('div');
    const runtime = createFabricOverlayRuntime({
      fabric: { Canvas: FakeCanvas, Path: FakePath },
      document,
      queueMicrotask: callback => queuedMicrotasks.push(callback)
    });
    runtime.prepare(root);
    runtime.setDrawingInput(makeInput());
    runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });
    return { runtime, canvas: FakeCanvas.instances.at(-1), queuedMicrotasks };
  }

  FakeCanvas.instances = [];
  const replacementHarness = createHarness();
  replacementHarness.canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 140,
    pointerType: 'mouse',
    button: 0,
    buttons: 1
  });
  assert.deepEqual(replacementHarness.runtime.updateViewport({
    revision: 5,
    canvasRect: { left: 5, top: 5, width: 500, height: 300 },
    scale: 1.5,
    panX: 5,
    panY: 5
  }), { accepted: true, deferred: true, revision: 5 });
  replacementHarness.canvas.upperCanvasEl.dispatch('pointerup', {
    pointerId: 140,
    pointerType: 'mouse',
    button: 0,
    buttons: 0
  });
  assert.equal(replacementHarness.queuedMicrotasks.length, 1);

  const replacementInput = makeInput({
    inputRevision: 2,
    session: {
      ...makeInput().session,
      sessionId: 'replacement-session',
      canvasRect: { left: 20, top: 30, width: 640, height: 360 },
      viewportRevision: 0,
      tool: 'select'
    }
  });
  assert.equal(replacementHarness.runtime.setDrawingInput(replacementInput).accepted, true);
  const replacementApplyCount = replacementHarness.canvas.calcOffsetCalls;
  replacementHarness.queuedMicrotasks.shift()();
  assert.equal(replacementHarness.runtime.getDiagnostics().activeSessionId, 'replacement-session');
  assert.equal(replacementHarness.runtime.getDiagnostics().viewportRevision, 0);
  assert.equal(replacementHarness.canvas.calcOffsetCalls, replacementApplyCount);
  replacementHarness.runtime.destroy();

  const disabledHarness = createHarness();
  disabledHarness.canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 141,
    pointerType: 'mouse',
    button: 0,
    buttons: 1
  });
  assert.deepEqual(disabledHarness.runtime.updateViewport({
    revision: 6,
    canvasRect: { left: 6, top: 6, width: 600, height: 340 },
    scale: 1.6,
    panX: 6,
    panY: 6
  }), { accepted: true, deferred: true, revision: 6 });
  disabledHarness.canvas.upperCanvasEl.dispatch('pointerup', {
    pointerId: 141,
    pointerType: 'mouse',
    button: 0,
    buttons: 0
  });
  assert.equal(disabledHarness.queuedMicrotasks.length, 1);
  const disabledApplyCount = disabledHarness.canvas.calcOffsetCalls;
  assert.equal(disabledHarness.runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  }).accepted, true);
  disabledHarness.queuedMicrotasks.shift()();
  assert.equal(disabledHarness.runtime.getDiagnostics().state, 'passive');
  assert.equal(disabledHarness.canvas.calcOffsetCalls, disabledApplyCount);
  disabledHarness.runtime.destroy();
});

test('stale multi-selection release respects membership and input revisions', () => {
  FakeCanvas.instances = [];
  const queuedMicrotasks = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    queueMicrotask: callback => queuedMicrotasks.push(callback)
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 81);
  drawStroke(canvas.upperCanvasEl, 82);
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });

  const [first, second] = canvas.getObjects();
  const group = new FakePath('');
  let members = [first, second];
  group.type = 'activeselection';
  group.getObjects = () => members;
  canvas.activeObject = group;
  canvas.activeObjects = members;
  canvas.emit('selection:created', { selected: [first, second] });
  canvas.emit('before:transform', { target: group, transform: { target: group } });
  group.left += 10;
  canvas.emit('object:modified', { target: group });

  assert.equal(queuedMicrotasks.length, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);
  members = [first];
  canvas.activeObjects = [first];
  canvas.emit('selection:updated', { selected: [first], deselected: [second] });
  queuedMicrotasks.shift()();

  assert.equal(canvas.getActiveObject(), group);
  assert.equal(runtime.getDiagnostics().selectionCount, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);

  members = [first, second];
  canvas.activeObjects = members;
  canvas.emit('selection:updated', { selected: members, deselected: [] });
  canvas.emit('before:transform', { target: group, transform: { target: group } });
  group.left += 5;
  canvas.emit('object:modified', { target: group });
  assert.equal(queuedMicrotasks.length, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 4);

  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  });
  queuedMicrotasks.shift()();
  assert.equal(runtime.getDiagnostics().state, 'passive');
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);

  const restoredInput = makeInput();
  assert.equal(runtime.setDrawingInput({
    ...restoredInput,
    inputRevision: 3,
    session: { ...restoredInput.session, sessionId: 'runtime-session-restored' }
  }).accepted, true);
  assert.equal(runtime.getDiagnostics().mutationCount, 4);
});

test('stale multi-selection release preserves a newer active object with identical membership', () => {
  FakeCanvas.instances = [];
  const queuedMicrotasks = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    queueMicrotask: callback => queuedMicrotasks.push(callback)
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 83);
  drawStroke(canvas.upperCanvasEl, 84);
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });

  const [first, second] = canvas.getObjects();
  const movedGroup = new FakePath('');
  movedGroup.type = 'activeselection';
  movedGroup.getObjects = () => [first, second];
  canvas.activeObject = movedGroup;
  canvas.activeObjects = [first, second];
  canvas.emit('selection:created', { selected: [first, second] });
  canvas.emit('before:transform', { target: movedGroup, transform: { target: movedGroup } });
  movedGroup.left += 10;
  canvas.emit('object:modified', { target: movedGroup });

  assert.equal(queuedMicrotasks.length, 1);
  const newerGroup = new FakePath('');
  newerGroup.type = 'activeselection';
  newerGroup.getObjects = () => [first, second];
  canvas.activeObject = newerGroup;
  canvas.activeObjects = [first, second];
  canvas.emit('selection:updated', { selected: [first, second], deselected: [] });
  queuedMicrotasks.shift()();

  assert.equal(canvas.getActiveObject(), newerGroup);
  assert.deepEqual(canvas.getActiveObjects(), [first, second]);
  assert.equal(runtime.getDiagnostics().selectionCount, 2);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
});

test('stale multi-selection release preserves selection after a higher enabled input revision', () => {
  FakeCanvas.instances = [];
  const queuedMicrotasks = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    queueMicrotask: callback => queuedMicrotasks.push(callback)
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 85);
  drawStroke(canvas.upperCanvasEl, 86);
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });

  let members = canvas.getObjects();
  const movedGroup = new FakePath('');
  movedGroup.type = 'activeselection';
  movedGroup.getObjects = () => members;
  canvas.activeObject = movedGroup;
  canvas.activeObjects = members;
  canvas.emit('selection:created', { selected: members });
  canvas.emit('before:transform', { target: movedGroup, transform: { target: movedGroup } });
  movedGroup.left += 10;
  canvas.emit('object:modified', { target: movedGroup });

  assert.equal(queuedMicrotasks.length, 1);
  const nextInput = makeInput({
    inputRevision: 2,
    session: { ...makeInput().session, tool: 'select' }
  });
  assert.equal(runtime.setDrawingInput(nextInput).accepted, true);
  members = canvas.getObjects();
  canvas.activeObject = movedGroup;
  canvas.activeObjects = members;
  canvas.emit('selection:updated', { selected: members, deselected: [] });
  queuedMicrotasks.shift()();

  assert.equal(runtime.getDiagnostics().state, 'active');
  assert.equal(runtime.getDiagnostics().tokens.inputRevision, 2);
  assert.equal(canvas.getActiveObject(), movedGroup);
  assert.deepEqual(canvas.getActiveObjects(), members);
  assert.equal(runtime.getDiagnostics().selectionCount, 2);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
});

test('pure exports load without constructing a DOM or Fabric canvas', () => {
  FakeCanvas.instances = [];
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document: new FakeDocument()
  });

  assert.deepEqual(Object.keys(runtime).sort(), [
    'applyDrawingAction',
    'destroy',
    'exportDrawingVideo',
    'getDiagnostics',
    'hydrateDrawingVideo',
    'prepare',
    'setDrawingInput',
    'updateDrawingTool',
    'updateViewport'
  ]);
  assert.equal(FakeCanvas.instances.length, 0);
  assert.equal(runtime.getDiagnostics().state, 'passive');
  assert.equal(runtime.setDrawingInput(makeInput()).accepted, false);
  assert.equal(FakeCanvas.instances.length, 0);
});

test('prepare creates one Fabric canvas and the browser runtime stays reusable', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    devicePixelRatio: 1.5
  });

  assert.equal(runtime.prepare(root).prepared, true);
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  assert.equal(toolbar.style.visibility, 'hidden');
  assert.equal(toolbar.style.opacity, '0');
  assert.equal(toolbar.style.pointerEvents, 'none');
  assert.equal(runtime.prepare(root).reused, true);
  assert.equal(FakeCanvas.instances.length, 1);
  assert.deepEqual(FakeCanvas.instances[0].options, {
    selection: true,
    preserveObjectStacking: true,
    enableRetinaScaling: false,
    enablePointerEvents: true,
    defaultCursor: 'default',
    hoverCursor: 'grab',
    moveCursor: 'grabbing',
    freeDrawingCursor: 'crosshair'
  });
  assert.equal(root.querySelectorAllByClass('mpv-fabric-pilot-toolbar').length, 1);
  assert.equal(root.querySelectorAllByClass('mpv-fabric-pilot-viewport').length, 1);
  assert.equal(root.querySelectorAllByClass('mpv-fabric-delta-canvas').length, 1);
});

test('a failed partial prepare rolls back its surface and retries without duplicate listeners', () => {
  class FailOnceCanvas extends FakeCanvas {
    static shouldFail = true;

    on(type, listener) {
      super.on(type, listener);
      if (FailOnceCanvas.shouldFail && type === 'selection:created') {
        FailOnceCanvas.shouldFail = false;
        throw new Error('synthetic partial configure failure');
      }
    }
  }

  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FailOnceCanvas, Path: FakePath },
    document
  });

  const failed = runtime.prepare(root);
  const failedCanvas = FakeCanvas.instances[0];
  assert.equal(failed.prepared, false);
  assert.equal(failedCanvas.disposed, true);
  assert.equal(root.children.length, 0);
  assert.equal([...failedCanvas.listeners.values()]
    .every(listeners => listeners.size === 0), true);

  assert.equal(runtime.prepare(root).prepared, true);
  const recoveredCanvas = FakeCanvas.instances[1];
  assert.equal(root.children.length, 1);
  assert.equal(root.querySelectorAllByClass('mpv-fabric-pilot-toolbar').length, 1);
  assert.equal(root.querySelectorAllByClass('mpv-fabric-delta-canvas').length, 1);
  assert.equal([...recoveredCanvas.listeners.values()]
    .every(listeners => listeners.size === 1), true);
  assert.equal([...recoveredCanvas.upperCanvasEl.listeners.values()]
    .every(listeners => listeners.size === 1), true);

  assert.equal(runtime.setDrawingInput(makeInput()).accepted, true);
  drawStroke(recoveredCanvas.upperCanvasEl, 77);
  assert.equal(runtime.getDiagnostics().objectCount, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 1);
});

test('viewport separates Fabric source backstore from display CSS dimensions', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];

  assert.deepEqual(canvas.dimensionCalls, [
    { dimensions: { width: 1920, height: 1080 }, options: { backstoreOnly: true } },
    { dimensions: { width: 960, height: 540 }, options: { cssOnly: true } }
  ]);
  assert.equal(canvas.lowerCanvasEl.width, 1920);
  assert.equal(canvas.upperCanvasEl.height, 1080);
  for (const element of [canvas.wrapperEl, canvas.lowerCanvasEl, canvas.upperCanvasEl]) {
    assert.equal(element.style.width, '960px');
    assert.equal(element.style.height, '540px');
  }
  assert.equal(canvas.calcOffsetCalls, 1);
});

test('viewport updates keep source coordinates aligned across resize, zoom, and pan', () => {
  const baseRect = { left: 100, top: 50, width: 800, height: 450 };
  const transform = { scale: 1.25, panX: 20, panY: -10 };
  assert.deepEqual(resolveEffectiveCanvasRect(baseRect, transform), {
    left: 25,
    top: -18.75,
    width: 1000,
    height: 562.5
  });
  assert.deepEqual(
    mapClientPointToSource(
      { clientX: 525, clientY: 262.5 },
      baseRect,
      transform,
      { width: 1920, height: 1080 }
    ),
    { x: 960, y: 540 }
  );

  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  const viewport = root.querySelectorAllByClass('mpv-fabric-pilot-viewport')[0];
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  const before = runtime.getDiagnostics();
  const result = runtime.updateViewport({
    revision: 1,
    canvasRect: baseRect,
    ...transform
  });

  assert.deepEqual(result, { accepted: true, revision: 1 });
  assert.equal(FakeCanvas.instances.length, 1);
  assert.deepEqual(canvas.dimensionCalls.at(-1), {
    dimensions: { width: 800, height: 450 },
    options: { cssOnly: true }
  });
  assert.equal(canvas.calcOffsetCalls, 2);
  assert.equal(viewport.style.transform, 'scale(1.25) translate(20px, -10px)');
  assert.equal(toolbar.style.transform, undefined);
  assert.equal(runtime.getDiagnostics().mutationCount, before.mutationCount);
  assert.equal(runtime.updateViewport({
    revision: 0,
    canvasRect: { left: 0, top: 0, width: 1, height: 1 },
    scale: 1,
    panX: 0,
    panY: 0
  }).accepted, false);
});

test('selection hit tolerance converts displayed pixels to source coordinates within bounds', () => {
  assert.equal(resolveSelectionHitTolerance({}), 6);
  assert.equal(resolveSelectionHitTolerance(makeInput().session), 12);
  assert.equal(resolveSelectionHitTolerance({
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { width: 960, height: 540 },
    viewportTransform: { scale: 2 }
  }), 6);
  assert.equal(resolveSelectionHitTolerance({
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { width: 960, height: 540 },
    viewportTransform: { scale: 0.5 }
  }), 24);
  assert.equal(resolveSelectionHitTolerance({
    sourceWidth: 100,
    sourceHeight: 100,
    canvasRect: { width: 1200, height: 1200 },
    viewportTransform: { scale: 2 }
  }), 2);
  assert.equal(resolveSelectionHitTolerance({
    sourceWidth: 7680,
    sourceHeight: 4320,
    canvasRect: { width: 100, height: 56.25 },
    viewportTransform: { scale: 0.25 }
  }), 96);
});

test('selection hit margin and cursors follow displayed pixels without scene mutations', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });

  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 61);
  const path = canvas.getObjects()[0];
  const before = runtime.getDiagnostics();

  assert.equal(canvas.defaultCursor, 'crosshair');
  assert.equal(canvas.upperCanvasEl.style.cursor, 'crosshair');
  assert.equal(canvas.targetFindTolerance, 12);
  assert.equal(path.padding, 12);
  assert.equal(path.hoverCursor, 'grab');
  assert.equal(path.moveCursor, 'grabbing');

  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });
  assert.equal(canvas.defaultCursor, 'default');
  assert.equal(canvas.upperCanvasEl.style.cursor, 'default');

  runtime.updateViewport({
    revision: 1,
    canvasRect: { left: 0, top: 0, width: 960, height: 540 },
    scale: 2,
    panX: 0,
    panY: 0
  });
  assert.equal(canvas.targetFindTolerance, 6);
  assert.equal(path.padding, 6);
  assert.equal(runtime.getDiagnostics().mutationCount, before.mutationCount);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);
});

test('selection updates synchronize the complete Fabric active selection', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 21);
  drawStroke(canvas.upperCanvasEl, 22);
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });

  const [first, second] = canvas.getObjects();
  canvas.activeObjects = [first, second];
  canvas.emit('selection:updated', { selected: [second], deselected: [] });
  const deletion = runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'delete-full-selection',
    action: 'delete-selection'
  });

  assert.equal(deletion.deletedCount, 2);
  assert.equal(runtime.getDiagnostics().objectCount, 0);
});

test('local toolbar changes do not consume controller tool revisions', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  const selectButton = toolbar.children.find(child => child.dataset.fabricPilotAction === 'select');
  const brushButton = toolbar.children.find(child => child.dataset.fabricPilotAction === 'brush');

  assert.equal(brushButton.dataset.active, 'true');
  assert.equal(selectButton.dataset.active, 'false');
  assert.equal(brushButton.getAttribute('aria-pressed'), 'true');
  assert.equal(selectButton.getAttribute('aria-pressed'), 'false');
  selectButton.dispatch('click');
  assert.equal(brushButton.dataset.active, 'false');
  assert.equal(selectButton.dataset.active, 'true');
  assert.equal(brushButton.getAttribute('aria-pressed'), 'false');
  assert.equal(selectButton.getAttribute('aria-pressed'), 'true');
  brushButton.dispatch('click');
  assert.equal(brushButton.dataset.active, 'true');
  assert.equal(selectButton.dataset.active, 'false');
  assert.equal(brushButton.getAttribute('aria-pressed'), 'true');
  assert.equal(selectButton.getAttribute('aria-pressed'), 'false');
  const controllerUpdate = runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 1,
    tool: 'select'
  });

  assert.equal(controllerUpdate.accepted, true);
  assert.equal(runtime.getDiagnostics().tool, 'select');
  assert.equal(brushButton.dataset.active, 'false');
  assert.equal(selectButton.dataset.active, 'true');
  assert.equal(brushButton.getAttribute('aria-pressed'), 'false');
  assert.equal(selectButton.getAttribute('aria-pressed'), 'true');

  const disabled = runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  });
  assert.equal(disabled.tool, 'select');
});

test('V exposes separate stroke and lasso selection modes and remembers the local choice', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());

  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  const brushButton = findOne(toolbar, node => node.dataset.fabricPilotAction === 'brush');
  const selectButton = findOne(toolbar, node => node.dataset.fabricPilotAction === 'select');
  const modeGroup = findOne(toolbar, node => node.dataset.fabricPilotGroup === 'selection-mode');
  const strokeMode = findOne(toolbar, node => node.dataset.fabricPilotAction === 'select-stroke');
  const lassoMode = findOne(toolbar, node => node.dataset.fabricPilotAction === 'select-lasso');
  const canvas = FakeCanvas.instances[0];

  assert.ok(modeGroup);
  assert.ok(strokeMode);
  assert.ok(lassoMode);
  assert.equal(modeGroup.style.display, 'none');

  selectButton.dispatch('click');
  assert.equal(modeGroup.style.display, 'flex');
  assert.equal(strokeMode.getAttribute('aria-pressed'), 'true');
  assert.equal(lassoMode.getAttribute('aria-pressed'), 'false');
  assert.equal(runtime.getDiagnostics().selectionMode, 'stroke');
  assert.equal(canvas.selection, true);

  lassoMode.dispatch('click');
  assert.equal(strokeMode.getAttribute('aria-pressed'), 'false');
  assert.equal(lassoMode.getAttribute('aria-pressed'), 'true');
  assert.equal(runtime.getDiagnostics().selectionMode, 'lasso');
  assert.equal(canvas.selection, false);

  brushButton.dispatch('click');
  assert.equal(modeGroup.style.display, 'none');
  selectButton.dispatch('click');
  assert.equal(modeGroup.style.display, 'flex');
  assert.equal(lassoMode.getAttribute('aria-pressed'), 'true');
  assert.equal(runtime.getDiagnostics().selectionMode, 'lasso');
});

test('brush settings expose the familiar bounded palette without mutating the scene', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());

  const controls = getBrushControls(root);
  const before = runtime.getDiagnostics();
  assert.ok(controls.settingsButton);
  assert.ok(controls.panel);
  assert.equal(controls.settingsButton.getAttribute('aria-expanded'), 'false');
  assert.equal(controls.panel.style.display, 'none');
  assert.equal(controls.panel.getAttribute('role'), 'group');
  assert.equal(controls.panel.getAttribute('aria-label'), '브러시 설정');
  assert.deepEqual(
    controls.colorButtons.map(button => button.dataset.fabricPilotColor),
    ['#ff4757', '#ffd000', '#26de81', '#4a9eff', '#ffffff', '#000000', '#1abc9c', '#ff6b9d']
  );
  assert.equal(controls.colorButtons[0].getAttribute('aria-pressed'), 'true');
  assert.deepEqual(
    controls.colorButtons.map(button => button.getAttribute('aria-label')),
    ['브러시 색상 빨강', '브러시 색상 노랑', '브러시 색상 초록', '브러시 색상 파랑',
      '브러시 색상 하양', '브러시 색상 검정', '브러시 색상 민트', '브러시 색상 핑크']
  );
  assert.equal(controls.sizeInput.type, 'range');
  assert.equal(controls.sizeInput.min, '1');
  assert.equal(controls.sizeInput.max, '50');
  assert.equal(controls.sizeInput.step, '1');
  assert.equal(controls.sizeInput.value, '3');
  assert.equal(controls.sizeInput.tabIndex, -1);
  assert.equal(controls.sizeInput.getAttribute('aria-label'), '브러시 크기');
  assert.equal(controls.opacityInput.min, '10');
  assert.equal(controls.opacityInput.max, '100');
  assert.equal(controls.opacityInput.step, '1');
  assert.equal(controls.opacityInput.value, '100');
  assert.equal(controls.opacityInput.tabIndex, -1);
  assert.equal(controls.opacityInput.getAttribute('aria-label'), '브러시 불투명도');
  assert.equal(controls.sizeDecrease.getAttribute('aria-label'), '브러시 크기 1px 줄이기');
  assert.equal(controls.sizeIncrease.getAttribute('aria-label'), '브러시 크기 1px 늘리기');
  assert.equal(controls.opacityDecrease.getAttribute('aria-label'), '브러시 불투명도 1% 줄이기');
  assert.equal(controls.opacityIncrease.getAttribute('aria-label'), '브러시 불투명도 1% 늘리기');
  assert.equal(controls.sizeOutput.textContent, '3px');
  assert.equal(controls.opacityOutput.textContent, '100%');
  for (const output of [controls.sizeOutput, controls.opacityOutput]) {
    assert.equal(output.getAttribute('role'), 'status');
    assert.equal(output.getAttribute('aria-live'), 'polite');
    assert.equal(output.getAttribute('aria-atomic'), 'true');
  }
  assert.equal(controls.summary.textContent, '3px · 100%');
  assert.equal(controls.colorPreview.style.background, '#ff4757');
  assert.equal(controls.sizePreview.style.width, '3px');
  assert.equal(controls.sizePreview.style.height, '3px');
  assert.equal(controls.sizePreview.style.background, '#ff4757');
  assert.equal(controls.sizePreview.style.opacity, '1');

  controls.settingsButton.dispatch('click');
  assert.equal(controls.settingsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(controls.panel.style.display, 'flex');

  controls.colorButtons[1].dispatch('click');
  controls.sizeInput.value = '24';
  controls.sizeInput.dispatch('input');
  controls.opacityInput.value = '40';
  controls.opacityInput.dispatch('input');
  assert.equal(controls.colorButtons[0].getAttribute('aria-pressed'), 'false');
  assert.equal(controls.colorButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(controls.sizeOutput.textContent, '24px');
  assert.equal(controls.opacityOutput.textContent, '40%');
  assert.equal(controls.summary.textContent, '24px · 40%');
  assert.equal(controls.colorPreview.style.background, '#ffd000');
  assert.equal(controls.sizePreview.style.width, '22px');
  assert.equal(controls.sizePreview.style.background, '#ffd000');
  assert.equal(controls.sizePreview.style.opacity, '0.4');

  controls.sizeDecrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '23');
  controls.sizeIncrease.dispatch('click');
  controls.sizeIncrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '25');
  controls.opacityDecrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '39');
  controls.opacityIncrease.dispatch('click');
  controls.opacityIncrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '41');

  controls.sizeInput.value = '1';
  controls.sizeInput.dispatch('input');
  controls.sizeDecrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '1');
  controls.sizeInput.value = '50';
  controls.sizeInput.dispatch('input');
  controls.sizeIncrease.dispatch('click');
  assert.equal(controls.sizeInput.value, '50');
  controls.opacityInput.value = '10';
  controls.opacityInput.dispatch('input');
  controls.opacityDecrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '10');
  controls.opacityInput.value = '100';
  controls.opacityInput.dispatch('input');
  controls.opacityIncrease.dispatch('click');
  assert.equal(controls.opacityInput.value, '100');

  controls.sizeInput.value = 'invalid';
  controls.sizeInput.dispatch('input');
  assert.equal(controls.sizeInput.value, '50');
  controls.opacityInput.value = 'invalid';
  controls.opacityInput.dispatch('input');
  assert.equal(controls.opacityInput.value, '100');

  const after = runtime.getDiagnostics();
  assert.equal(after.objectCount, before.objectCount);
  assert.equal(after.mutationCount, before.mutationCount);
  assert.equal(after.dirty, before.dirty);
  assert.equal(after.metrics.saveAttemptCount, before.metrics.saveAttemptCount);
});

test('add stroke undo redo restores the exact record and z-order through runtime controls', () => {
  const harness = createHistoryHarness();
  drawStroke(harness.canvas.upperCanvasEl, 501);
  drawStroke(harness.canvas.upperCanvasEl, 502);
  const before = harness.sceneStore.getActiveSceneSnapshot();
  const beforeIds = before.objects.map(object => object.id);
  const controls = getBrushControls(harness.root);

  assert.ok(controls.undoButton);
  assert.ok(controls.redoButton);
  assertHistoryDiagnostics(harness, { mutationCount: 2, undoDepth: 2, redoDepth: 0 });

  controls.undoButton.dispatch('click');
  assert.deepEqual(
    harness.sceneStore.getActiveSceneSnapshot().objects,
    before.objects.slice(0, 1)
  );
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 1, redoDepth: 1 });

  controls.redoButton.dispatch('click');
  assert.deepEqual(harness.sceneStore.getActiveSceneSnapshot().objects, before.objects);
  assert.deepEqual(
    harness.canvas.getObjects().map(object => object.__baeframeObjectId),
    beforeIds
  );
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 2, redoDepth: 0 });
});

test('single and multi stroke moves each round-trip through one undo and one redo', () => {
  const harness = createHistoryHarness();
  const { sceneStore } = harness;
  sceneStore.addStroke(makeHistoryStroke('move-a', { transform: { left: 2, top: 3 } }));
  sceneStore.addStroke(makeHistoryStroke('move-b', { transform: { left: 20, top: 30 } }));

  sceneStore.selectObjects(['move-a']);
  assert.equal(sceneStore.transformSelection({ dx: 5, dy: -2 }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects[0].transform, {
    left: 7, top: 1, scaleX: 1, scaleY: 1, angle: 0,
    skewX: 0, skewY: 0, flipX: false, flipY: false
  });
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 3, redoDepth: 0 });

  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects[0].transform, makeHistoryStroke('x', {
    transform: { left: 2, top: 3 }
  }).transform);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 2, redoDepth: 1 });

  assert.equal(sceneStore.redo().applied, true);
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 7);
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.top, 1);
  assertHistoryDiagnostics(harness, { mutationCount: 5, undoDepth: 3, redoDepth: 0 });

  sceneStore.selectObjects(['move-a', 'move-b']);
  assert.equal(sceneStore.transformSelection({ dx: 4, dy: 6 }).applied, true);
  const moved = new Map(sceneStore.getActiveSceneSnapshot().objects.map(object => [object.id, object.transform]));
  assert.deepEqual([moved.get('move-a').left, moved.get('move-a').top], [11, 7]);
  assert.deepEqual([moved.get('move-b').left, moved.get('move-b').top], [24, 36]);
  assertHistoryDiagnostics(harness, { mutationCount: 6, undoDepth: 4, redoDepth: 0 });

  assert.equal(sceneStore.undo().applied, true);
  const multiUndone = new Map(sceneStore.getActiveSceneSnapshot().objects.map(object => [object.id, object.transform]));
  assert.deepEqual([multiUndone.get('move-a').left, multiUndone.get('move-a').top], [7, 1]);
  assert.deepEqual([multiUndone.get('move-b').left, multiUndone.get('move-b').top], [20, 30]);
  assertHistoryDiagnostics(harness, { mutationCount: 7, undoDepth: 3, redoDepth: 1 });

  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => [
    object.id, object.transform.left, object.transform.top
  ]), [
    ['move-a', 11, 7],
    ['move-b', 24, 36]
  ]);
  assertHistoryDiagnostics(harness, { mutationCount: 8, undoDepth: 4, redoDepth: 0 });
});

test('a rejected Fabric multi-stroke move rolls the visible selection back to the authoritative scene', () => {
  const harness = createHistoryHarness({ maxBytes: 100000, maxHistoryBytes: 1800 });
  const { canvas, runtime, sceneStore } = harness;
  for (let index = 0; index < 8; index += 1) drawStroke(canvas.upperCanvasEl, 610 + index);
  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 1,
    tool: 'select'
  }).accepted, true);

  const paths = canvas.getObjects();
  const ids = paths.map(object => object.__baeframeObjectId);
  const activeSelection = new FakePath('', { left: 0, top: 0 });
  activeSelection.getObjects = () => paths;
  canvas.activeObject = activeSelection;
  canvas.activeObjects = paths;
  canvas.emit('selection:created', { selected: paths });
  canvas.emit('before:transform', { transform: { target: activeSelection } });

  const sceneBefore = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const diagnosticsBefore = runtime.getDiagnostics();
  const canvasBefore = canvas.getObjects().map(object => ({
    id: object.__baeframeObjectId,
    transform: {
      left: object.left,
      top: object.top,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      angle: object.angle,
      skewX: object.skewX,
      skewY: object.skewY
    }
  }));
  activeSelection.left = 18;
  activeSelection.top = 9;
  canvas.emit('object:modified', { target: activeSelection });

  assert.equal(activeSelection.left, 0);
  assert.equal(activeSelection.top, 0);
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), sceneBefore);
  assert.deepEqual(canvas.getObjects().map(object => ({
    id: object.__baeframeObjectId,
    transform: {
      left: object.left,
      top: object.top,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      angle: object.angle,
      skewX: object.skewX,
      skewY: object.skewY
    }
  })), canvasBefore);
  assert.deepEqual(canvas.getObjects().map(object => object.__baeframeObjectId), ids);
  assert.equal(canvas.getActiveObject(), activeSelection);
  assert.deepEqual(canvas.getActiveObjects(), paths);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().selectedObjectIds, ids);
  assert.deepEqual(runtime.getDiagnostics(), diagnosticsBefore);
});

test('a rejected Fabric single-stroke move preserves its active selection and visible transform', () => {
  let rejectValidation = false;
  const harness = createHistoryHarness({
    maxBytes: 100000,
    estimateObjectBytes(object) {
      if (rejectValidation) throw new Error('single-transform-rejected');
      return JSON.stringify(object).length * 2;
    }
  });
  const { canvas, runtime, sceneStore } = harness;
  drawStroke(canvas.upperCanvasEl, 640);
  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 1,
    tool: 'select'
  }).accepted, true);
  const path = canvas.getObjects()[0];
  canvas.activeObject = path;
  canvas.activeObjects = [path];
  canvas.emit('selection:created', { selected: [path] });
  canvas.emit('before:transform', { transform: { target: path } });
  const sceneBefore = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const diagnosticsBefore = runtime.getDiagnostics();

  path.left = 14;
  path.top = 6;
  rejectValidation = true;
  canvas.emit('object:modified', { target: path });
  rejectValidation = false;

  assert.equal(path.left, 0);
  assert.equal(path.top, 0);
  assert.equal(canvas.getActiveObject(), path);
  assert.deepEqual(canvas.getActiveObjects(), [path]);
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), sceneBefore);
  assert.deepEqual(runtime.getDiagnostics(), diagnosticsBefore);
});

test('undo redo during an active stroke drag cancels the gesture and ignores its late modified event', () => {
  const harness = createHistoryHarness();
  const { canvas, runtime, sceneStore } = harness;
  drawStroke(canvas.upperCanvasEl, 650);
  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 1,
    tool: 'select'
  }).accepted, true);

  const initiallyMovedPath = canvas.getObjects()[0];
  const objectId = initiallyMovedPath.__baeframeObjectId;
  canvas.activeObject = initiallyMovedPath;
  canvas.activeObjects = [initiallyMovedPath];
  canvas.emit('selection:created', { selected: [initiallyMovedPath] });
  canvas.emit('before:transform', { transform: { target: initiallyMovedPath } });
  initiallyMovedPath.left = 10;
  canvas.emit('object:modified', { target: initiallyMovedPath });
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 10);

  canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 651,
    pointerType: 'mouse',
    button: 0,
    clientX: 10,
    clientY: 10
  });
  canvas.emit('before:transform', { transform: { target: initiallyMovedPath } });
  initiallyMovedPath.left = 25;
  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'undo-during-active-drag',
    action: 'undo'
  }).applied, true);

  assert.equal(initiallyMovedPath.left, 10, 'the cancelled Fabric target returns to its drag start');
  assert.equal(canvas.upperCanvasEl.capturedPointerIds.has(651), false);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().selectedObjectIds, []);
  assert.equal(canvas.getActiveObject(), null);
  assert.deepEqual(canvas.getActiveObjects(), []);
  assert.equal(canvas.getObjects()[0].left, 0);
  const afterUndoScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const afterUndoDiagnostics = runtime.getDiagnostics();
  const afterUndoCanvasIds = canvas.getObjects().map(object => object.__baeframeObjectId);

  canvas.emit('object:modified', { target: initiallyMovedPath });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), afterUndoScene);
  assert.deepEqual(runtime.getDiagnostics(), afterUndoDiagnostics);
  assert.deepEqual(canvas.getObjects().map(object => object.__baeframeObjectId), afterUndoCanvasIds);

  const redoDragPath = canvas.getObjects()[0];
  assert.equal(redoDragPath.__baeframeObjectId, objectId);
  canvas.activeObject = redoDragPath;
  canvas.activeObjects = [redoDragPath];
  canvas.emit('selection:created', { selected: [redoDragPath] });
  canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 652,
    pointerType: 'mouse',
    button: 0,
    clientX: 10,
    clientY: 10
  });
  canvas.emit('before:transform', { transform: { target: redoDragPath } });
  redoDragPath.left = 7;
  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'redo-during-active-drag',
    action: 'redo'
  }).applied, true);

  assert.equal(redoDragPath.left, 0, 'redo also rolls the in-flight target back before history applies');
  assert.equal(canvas.upperCanvasEl.capturedPointerIds.has(652), false);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().selectedObjectIds, []);
  assert.equal(canvas.getObjects()[0].transform?.left ?? canvas.getObjects()[0].left, 10);
  const afterRedoScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const afterRedoDiagnostics = runtime.getDiagnostics();
  const afterRedoCanvasIds = canvas.getObjects().map(object => object.__baeframeObjectId);

  canvas.emit('object:modified', { target: redoDragPath });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), afterRedoScene);
  assert.deepEqual(runtime.getDiagnostics(), afterRedoDiagnostics);
  assert.deepEqual(canvas.getObjects().map(object => object.__baeframeObjectId), afterRedoCanvasIds);
});

test('redo during an active multi-stroke drag ignores the cancelled group modified event', () => {
  const harness = createHistoryHarness();
  const { canvas, runtime, sceneStore } = harness;
  drawStroke(canvas.upperCanvasEl, 660);
  drawStroke(canvas.upperCanvasEl, 661);
  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 1,
    tool: 'select'
  }).accepted, true);

  const paths = canvas.getObjects();
  const ids = paths.map(object => object.__baeframeObjectId);
  sceneStore.selectObjects(ids);
  assert.equal(sceneStore.transformSelection({ dx: 10, dy: 4 }).applied, true);
  assert.equal(sceneStore.undo().applied, true);
  const activeSelection = new FakePath('', { left: 0, top: 0 });
  activeSelection.getObjects = () => paths;
  canvas.activeObject = activeSelection;
  canvas.activeObjects = paths;
  canvas.emit('selection:created', { selected: paths });
  canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 662,
    pointerType: 'mouse',
    button: 0,
    clientX: 10,
    clientY: 10
  });
  canvas.emit('before:transform', { transform: { target: activeSelection } });
  activeSelection.left = 6;
  activeSelection.top = 3;

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'redo-during-active-multi-drag',
    action: 'redo'
  }).applied, true);
  assert.equal(activeSelection.left, 0);
  assert.equal(activeSelection.top, 0);
  assert.equal(canvas.upperCanvasEl.capturedPointerIds.has(662), false);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().selectedObjectIds, []);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => [
    object.id,
    object.transform.left,
    object.transform.top
  ]), [
    [ids[0], 10, 4],
    [ids[1], 10, 4]
  ]);
  assert.deepEqual(canvas.getObjects().map(object => [
    object.__baeframeObjectId,
    object.left,
    object.top
  ]), [
    [ids[0], 10, 4],
    [ids[1], 10, 4]
  ]);
  const settledScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const settledDiagnostics = runtime.getDiagnostics();

  canvas.emit('object:modified', { target: activeSelection });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), settledScene);
  assert.deepEqual(runtime.getDiagnostics(), settledDiagnostics);
});

test('replaceObjects applies structure and selected transforms as one undo redo command', () => {
  const harness = createHistoryHarness();
  const { sceneStore } = harness;
  const original = makeHistoryStroke('split-original', { transform: { left: 1, top: 2 } });
  const survivor = makeHistoryStroke('split-survivor', { transform: { left: 20, top: 30 } });
  const inside = makeHistoryStroke('split-inside', { transform: { left: 1, top: 2 } });
  const outside = makeHistoryStroke('split-outside', { transform: { left: 1, top: 2 } });
  sceneStore.addStroke(original);
  sceneStore.addStroke(survivor);

  assert.equal(sceneStore.replaceObjects({
    kind: 'split-stroke',
    replacements: [{ removeId: original.id, addObjects: [inside, outside] }],
    selectedObjectIds: [inside.id, survivor.id],
    transforms: [{ id: survivor.id, transform: { left: 40, top: 50 } }],
    dx: 7,
    dy: -3
  }).applied, true);
  const replaced = sceneStore.getActiveSceneSnapshot();
  assert.deepEqual(replaced.objects.map(object => object.id), [inside.id, outside.id, survivor.id]);
  assert.deepEqual(replaced.objects.map(object => [object.id, object.transform.left, object.transform.top]), [
    [inside.id, 8, -1],
    [outside.id, 1, 2],
    [survivor.id, 40, 50]
  ]);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 3, redoDepth: 0 });

  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, [original, survivor]);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 2, redoDepth: 1 });

  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot(), {
    ...replaced,
    selectedObjectIds: [],
    mutationCount: 5
  });
  assertHistoryDiagnostics(harness, { mutationCount: 5, undoDepth: 3, redoDepth: 0 });
});

test('full stroke Delete undo redo restores the deleted record and its z-order', () => {
  const harness = createHistoryHarness();
  const { sceneStore, runtime } = harness;
  const records = ['delete-a', 'delete-b', 'delete-c'].map(makeHistoryStroke);
  records.forEach(record => sceneStore.addStroke(record));
  sceneStore.selectObjects(['delete-b']);

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session', actionId: 'delete-history-1', action: 'delete-selection'
  }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['delete-a', 'delete-c']);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 4, redoDepth: 0 });

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session', actionId: 'delete-history-undo', action: 'undo'
  }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, records);
  assertHistoryDiagnostics(harness, { mutationCount: 5, undoDepth: 3, redoDepth: 1 });

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session', actionId: 'delete-history-redo', action: 'redo'
  }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['delete-a', 'delete-c']);
  assertHistoryDiagnostics(harness, { mutationCount: 6, undoDepth: 4, redoDepth: 0 });
});

test('Clear undo redo restores every record in its original z-order', () => {
  const harness = createHistoryHarness();
  const { sceneStore, runtime } = harness;
  const records = ['clear-a', 'clear-b', 'clear-c'].map(makeHistoryStroke);
  records.forEach(record => sceneStore.addStroke(record));

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session', actionId: 'clear-history-1', action: 'clear-session'
  }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 4, redoDepth: 0 });

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session', actionId: 'clear-history-undo', action: 'undo'
  }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, records);
  assertHistoryDiagnostics(harness, { mutationCount: 5, undoDepth: 3, redoDepth: 1 });

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session', actionId: 'clear-history-redo', action: 'redo'
  }).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);
  assertHistoryDiagnostics(harness, { mutationCount: 6, undoDepth: 4, redoDepth: 0 });
});

test('undo then selection-only and no-op edits preserve redo while a new stroke clears it', () => {
  const harness = createHistoryHarness();
  const { sceneStore } = harness;
  sceneStore.addStroke(makeHistoryStroke('redo-a'));
  sceneStore.addStroke(makeHistoryStroke('redo-b'));
  assert.equal(sceneStore.undo().applied, true);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 1, redoDepth: 1 });

  assert.equal(sceneStore.selectObjects(['redo-a']).changed, true);
  assert.equal(sceneStore.transformSelection({ dx: 0, dy: 0 }).applied, false);
  assert.equal(sceneStore.addStroke(makeHistoryStroke('redo-a')).reason, 'duplicate-object-id');
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 1, redoDepth: 1 });

  assert.equal(sceneStore.addStroke(makeHistoryStroke('redo-c')).applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['redo-a', 'redo-c']);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 2, redoDepth: 0 });

  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['redo-a']);
  assertHistoryDiagnostics(harness, { mutationCount: 5, undoDepth: 1, redoDepth: 1 });
  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);
  assertHistoryDiagnostics(harness, { mutationCount: 6, undoDepth: 0, redoDepth: 2 });
});

test('two consecutive moves create two distinct undo redo commands', () => {
  const harness = createHistoryHarness();
  const { sceneStore } = harness;
  sceneStore.addStroke(makeHistoryStroke('two-moves'));
  sceneStore.selectObjects(['two-moves']);
  sceneStore.transformSelection({ dx: 10, dy: 0 });
  sceneStore.transformSelection({ dx: 5, dy: 0 });
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 15);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 3, redoDepth: 0 });

  assert.equal(sceneStore.undo().applied, true);
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 10);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 2, redoDepth: 1 });
  assert.equal(sceneStore.undo().applied, true);
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 0);
  assertHistoryDiagnostics(harness, { mutationCount: 5, undoDepth: 1, redoDepth: 2 });

  assert.equal(sceneStore.redo().applied, true);
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 10);
  assertHistoryDiagnostics(harness, { mutationCount: 6, undoDepth: 2, redoDepth: 1 });
  assert.equal(sceneStore.redo().applied, true);
  assert.equal(sceneStore.getActiveSceneSnapshot().objects[0].transform.left, 15);
  assertHistoryDiagnostics(harness, { mutationCount: 7, undoDepth: 3, redoDepth: 0 });
});

test('video and frame scene histories remain independent across undo and redo', () => {
  const harness = createHistoryHarness();
  const { sceneStore } = harness;
  const activate = (sessionId, stableVideoIdentity, targetFrame) => sceneStore.activateSession({
    sessionId, stableVideoIdentity, targetFrame, videoGeneration: 1, tool: 'brush'
  });

  sceneStore.addStroke(makeHistoryStroke('scene-base'));
  assertHistoryDiagnostics(harness, { mutationCount: 1, undoDepth: 1, redoDepth: 0 });

  assert.equal(activate('frame-session', 'runtime-video', 25).accepted, true);
  sceneStore.addStroke(makeHistoryStroke('scene-frame'));
  assertHistoryDiagnostics(harness, { mutationCount: 1, undoDepth: 1, redoDepth: 0 });

  assert.equal(activate('video-session', 'other-video', 24).accepted, true);
  sceneStore.addStroke(makeHistoryStroke('scene-video'));
  assert.equal(sceneStore.undo().applied, true);
  assertHistoryDiagnostics(harness, { mutationCount: 2, undoDepth: 0, redoDepth: 1 });

  assert.equal(activate('frame-session-2', 'runtime-video', 25).restored, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['scene-frame']);
  assert.equal(sceneStore.undo().applied, true);
  assertHistoryDiagnostics(harness, { mutationCount: 2, undoDepth: 0, redoDepth: 1 });

  assert.equal(activate('base-session-2', 'runtime-video', 24).restored, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['scene-base']);
  assert.equal(sceneStore.undo().applied, true);
  assertHistoryDiagnostics(harness, { mutationCount: 2, undoDepth: 0, redoDepth: 1 });

  assert.equal(activate('video-session-2', 'other-video', 24).restored, true);
  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['scene-video']);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 1, redoDepth: 0 });

  assert.equal(activate('frame-session-3', 'runtime-video', 25).restored, true);
  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['scene-frame']);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 1, redoDepth: 0 });

  assert.equal(activate('base-session-3', 'runtime-video', 24).restored, true);
  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects.map(object => object.id), ['scene-base']);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 1, redoDepth: 0 });
});

test('redo history bytes remain in the store-wide maxBytes calculation across scenes', () => {
  const harness = createHistoryHarness({
    maxBytes: 1500,
    maxHistoryBytes: 10000,
    estimateObjectBytes: () => 100
  });
  const { sceneStore } = harness;
  const minimalStroke = id => ({
    id,
    type: 'stroke',
    pathData: 'M',
    sourcePoints: [],
    style: {},
    transform: { left: 0, top: 0 }
  });
  sceneStore.addStroke(minimalStroke('redo-bytes-a'));
  assert.equal(sceneStore.undo().applied, true);
  const firstScene = assertHistoryDiagnostics(harness, {
    mutationCount: 2, undoDepth: 0, redoDepth: 1
  });
  assert.ok(firstScene.historyBytes > 0);
  assert.equal(firstScene.undoBytes, 0);
  assert.equal(firstScene.cache.estimatedBytes, firstScene.historyBytes + 100);

  assert.equal(sceneStore.activateSession({
    sessionId: 'redo-bytes-frame',
    stableVideoIdentity: 'runtime-video',
    targetFrame: 25,
    videoGeneration: 1,
    tool: 'brush'
  }).accepted, true);
  assert.deepEqual(sceneStore.addStroke(minimalStroke('redo-bytes-b')), {
    applied: false,
    reason: 'scene-capacity-exceeded'
  });
  const secondScene = assertHistoryDiagnostics(harness, {
    mutationCount: 0, undoDepth: 0, redoDepth: 0
  });
  assert.equal(secondScene.cache.estimatedBytes, firstScene.cache.estimatedBytes);

  assert.equal(sceneStore.activateSession({
    sessionId: 'redo-bytes-original',
    stableVideoIdentity: 'runtime-video',
    targetFrame: 24,
    videoGeneration: 1,
    tool: 'brush'
  }).restored, true);
  assertHistoryDiagnostics(harness, { mutationCount: 2, undoDepth: 0, redoDepth: 1 });
});

test('later commands on sibling frames cannot consume the capacity reserved for an admitted undo redo', () => {
  const sceneStore = createSessionSceneStore({ maxBytes: 30000 });
  const activate = (targetFrame, suffix) => sceneStore.activateSession({
    sessionId: `capacity-${suffix}`,
    stableVideoIdentity: 'capacity-video',
    targetFrame,
    videoGeneration: 1,
    tool: 'brush'
  });
  const makeSizedStroke = (id, pointCount) => makeHistoryStroke(id, {
    pathData: `M ${Array.from({ length: pointCount }, (_value, index) => `${index} ${index} L`).join(' ')} Z`,
    sourcePoints: Array.from({ length: pointCount }, (_value, index) => ({
      x: index,
      y: index,
      pressure: 0.5,
      pointerType: 'pen',
      time: index
    }))
  });

  assert.equal(activate(0, 'frame-0').accepted, true);
  const restorable = makeSizedStroke('restorable-large-stroke', 40);
  assert.equal(sceneStore.addStroke(restorable).applied, true);
  sceneStore.selectObjects([restorable.id]);
  assert.equal(sceneStore.deleteSelection().applied, true);
  const admittedHistory = sceneStore.getDiagnostics();
  assert.equal(admittedHistory.undoDepth, 1);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);

  let acceptedSiblingCommands = 0;
  for (let index = 0; index < 80; index += 1) {
    const frame = index % 2 === 0 ? 1 : 2;
    activate(frame, `fill-${index}`);
    const result = sceneStore.addStroke(makeSizedStroke(`small-${index}`, 2));
    if (!result.applied) {
      assert.equal(result.reason, 'scene-capacity-exceeded');
      break;
    }
    acceptedSiblingCommands += 1;
  }
  assert.ok(acceptedSiblingCommands > 0, 'sibling frames should still use genuinely free capacity');
  assert.ok(sceneStore.getDiagnostics().estimatedBytes <= 30000);

  assert.equal(activate(0, 'return-frame-0').restored, true);
  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, [restorable]);
  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);
  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, [restorable]);
  assert.ok(sceneStore.getDiagnostics().estimatedBytes <= 30000);
});

test('undo and redo history apply failures after validation injection are atomic', () => {
  let failValidation = false;
  const harness = createHistoryHarness({
    estimateObjectBytes(object) {
      if (failValidation) throw new Error('validation-injected');
      return JSON.stringify(object).length * 2;
    }
  });
  const { sceneStore } = harness;
  sceneStore.addStroke(makeHistoryStroke('atomic-history'));
  sceneStore.selectObjects(['atomic-history']);
  sceneStore.transformSelection({ dx: 12, dy: 4 });
  const beforeUndoScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const beforeUndo = assertHistoryDiagnostics(harness, {
    mutationCount: 2, undoDepth: 2, redoDepth: 0
  });

  failValidation = true;
  assert.deepEqual(sceneStore.undo(), { applied: false, reason: 'validation-injected' });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), beforeUndoScene);
  assertHistoryDiagnostics(harness, {
    mutationCount: 2,
    undoDepth: 2,
    redoDepth: 0,
    historyBytes: beforeUndo.historyBytes
  });

  failValidation = false;
  assert.equal(sceneStore.undo().applied, true);
  const beforeRedoScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const beforeRedo = assertHistoryDiagnostics(harness, {
    mutationCount: 3, undoDepth: 1, redoDepth: 1
  });

  failValidation = true;
  assert.deepEqual(sceneStore.redo(), { applied: false, reason: 'validation-injected' });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), beforeRedoScene);
  assertHistoryDiagnostics(harness, {
    mutationCount: 3,
    undoDepth: 1,
    redoDepth: 1,
    historyBytes: beforeRedo.historyBytes
  });

  failValidation = false;
  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(
    sceneStore.getActiveSceneSnapshot().objects[0].transform,
    makeHistoryStroke('atomic-history', { transform: { left: 12, top: 4 } }).transform
  );
  assertHistoryDiagnostics(harness, {
    mutationCount: 4,
    undoDepth: 2,
    redoDepth: 0,
    historyBytes: beforeRedo.historyBytes
  });
});

test('each stroke snapshots color size and opacity and warm reactivation restores mixed styles', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sceneStore = createSessionSceneStore();
  const observedSizes = [];
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    sceneStore,
    strokePathFactory(samples, options) {
      observedSizes.push(options.size);
      return createStrokePathData(samples, options);
    }
  });
  const firstInput = makeInput();
  runtime.prepare(root);
  runtime.setDrawingInput(firstInput);
  const canvas = FakeCanvas.instances[0];
  const controls = getBrushControls(root);

  drawStroke(canvas.upperCanvasEl, 41);
  const firstCallCount = observedSizes.length;
  assert.equal(observedSizes.slice(0, firstCallCount).every(size => size === 3), true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects[0].style, {
    color: '#ff4757',
    size: 3,
    opacity: 1
  });
  assert.equal(canvas.getObjects()[0].fill, '#ff4757');
  assert.equal(canvas.getObjects()[0].opacity, 1);

  controls.colorButtons[1].dispatch('click');
  controls.sizeInput.value = '24';
  controls.sizeInput.dispatch('input');
  controls.opacityInput.value = '40';
  controls.opacityInput.dispatch('input');
  drawStroke(canvas.upperCanvasEl, 42);

  assert.equal(observedSizes.slice(firstCallCount).every(size => size === 24), true);
  const records = sceneStore.getActiveSceneSnapshot().objects;
  assert.deepEqual(records.map(record => record.style), [
    { color: '#ff4757', size: 3, opacity: 1 },
    { color: '#ffd000', size: 24, opacity: 0.4 }
  ]);
  assert.deepEqual(canvas.getObjects().map(path => [path.fill, path.opacity]), [
    ['#ff4757', 1],
    ['#ffd000', 0.4]
  ]);

  sceneStore.addStroke({
    id: 'legacy-opacity-less',
    type: 'stroke',
    pathData: 'M 0 0 L 1 1 Z',
    sourcePoints: [{ x: 0, y: 0, pressure: 0.5, pointerType: 'mouse', time: 0 }],
    style: { color: '#000000', size: 5 }
  });
  sceneStore.addStroke({
    id: 'legacy-invalid-opacity',
    type: 'stroke',
    pathData: 'M 1 1 L 2 2 Z',
    sourcePoints: [{ x: 1, y: 1, pressure: 0.5, pointerType: 'mouse', time: 1 }],
    style: { color: '#ff6b9d', size: 5, opacity: 0 }
  });

  controls.settingsButton.dispatch('click');
  assert.equal(controls.settingsButton.getAttribute('aria-expanded'), 'true');

  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  });
  runtime.setDrawingInput({
    ...firstInput,
    inputRevision: 3,
    session: { ...firstInput.session, sessionId: 'runtime-session-restored' }
  });

  const restoredControls = getBrushControls(root);
  assert.equal(restoredControls.sizeInput.value, '24');
  assert.equal(restoredControls.opacityInput.value, '40');
  assert.equal(restoredControls.colorButtons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(restoredControls.settingsButton.getAttribute('aria-expanded'), 'true');
  assert.equal(restoredControls.panel.style.display, 'flex');
  assert.deepEqual(canvas.getObjects().map(path => [path.fill, path.opacity]), [
    ['#ff4757', 1],
    ['#ffd000', 0.4],
    ['#000000', 1],
    ['#ff6b9d', 1]
  ]);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);

  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 4,
    enabled: false
  });
  runtime.setDrawingInput({
    ...firstInput,
    inputRevision: 5,
    session: {
      ...firstInput.session,
      sessionId: 'runtime-session-frame-25',
      targetFrame: 25
    }
  });
  const nextFrameControls = getBrushControls(root);
  assert.equal(nextFrameControls.sizeInput.value, '24');
  assert.equal(nextFrameControls.opacityInput.value, '40');
  assert.equal(nextFrameControls.colorButtons[1].getAttribute('aria-pressed'), 'true');
});

test('an active stroke keeps the pointerdown style while controls change', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const sceneStore = createSessionSceneStore();
  const observedSizes = [];
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    sceneStore,
    strokePathFactory(samples, options) {
      observedSizes.push(options.size);
      return createStrokePathData(samples, options);
    }
  });
  runtime.prepare(root);
  runtime.setDrawingInput(makeInput());
  const canvas = FakeCanvas.instances[0];
  const controls = getBrushControls(root);

  canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 51,
    pointerType: 'pen',
    button: 0,
    clientX: 10,
    clientY: 20,
    pressure: 0.5,
    timeStamp: 1
  });
  controls.colorButtons[1].dispatch('click');
  controls.sizeInput.value = '24';
  controls.sizeInput.dispatch('input');
  controls.opacityInput.value = '40';
  controls.opacityInput.dispatch('input');
  canvas.upperCanvasEl.dispatch('pointermove', {
    pointerId: 51,
    pointerType: 'pen',
    clientX: 30,
    clientY: 40,
    pressure: 0.5,
    timeStamp: 2
  });
  const transient = canvas.getObjects().find(path => path.__baeframeTransient === true);
  assert.ok(transient);
  assert.equal(transient.fill, '#ff4757');
  assert.equal(transient.opacity, 1);
  assert.equal(observedSizes.every(size => size === 3), true);
  canvas.upperCanvasEl.dispatch('pointerup', {
    pointerId: 51,
    pointerType: 'pen',
    clientX: 50,
    clientY: 60,
    pressure: 0.5,
    timeStamp: 3
  });

  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects[0].style, {
    color: '#ff4757',
    size: 3,
    opacity: 1
  });
  assert.equal(canvas.getObjects()[0].fill, '#ff4757');
  assert.equal(canvas.getObjects()[0].opacity, 1);
  assert.equal(observedSizes.every(size => size === 3), true);
});

test('Phase 0 selection moves while scale rotate and skew remain locked across reactivation', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document
  });
  const firstInput = makeInput();
  runtime.prepare(root);
  runtime.setDrawingInput(firstInput);
  const canvas = FakeCanvas.instances[0];
  drawStroke(canvas.upperCanvasEl, 31);
  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 1, tool: 'select' });

  const selected = canvas.getObjects()[0];
  const activeSelection = new FakePath('');
  activeSelection.getObjects = () => [selected];
  canvas.activeObjects = [selected];
  canvas.activeObject = activeSelection;
  canvas.emit('selection:created', { selected: [selected], deselected: [] });

  for (const target of [selected, activeSelection]) {
    assert.equal(target.hasControls, false);
    assert.equal(target.lockScalingX, true);
    assert.equal(target.lockScalingY, true);
    assert.equal(target.lockRotation, true);
    assert.equal(target.lockSkewingX, true);
    assert.equal(target.lockSkewingY, true);
    assert.notEqual(target.lockMovementX, true);
    assert.notEqual(target.lockMovementY, true);
    assert.equal(target.moveCursor, 'grabbing');
  }
  assert.equal(selected.perPixelTargetFind, true);
  assert.equal(selected.hoverCursor, 'grab');
  assert.equal(activeSelection.perPixelTargetFind, false);
  assert.equal(activeSelection.hoverCursor, 'move');

  canvas.emit('before:transform', { target: selected, transform: { target: selected } });
  selected.left += 12;
  selected.scaleX = 2;
  selected.scaleY = 0.5;
  selected.angle = 30;
  selected.skewX = 8;
  canvas.emit('object:modified', { target: selected });

  assert.equal(selected.left, 12, 'move remains enabled');
  assert.equal(selected.scaleX, 1);
  assert.equal(selected.scaleY, 1);
  assert.equal(selected.angle, 0);
  assert.equal(selected.skewX, 0);
  assert.equal(runtime.getDiagnostics().mutationCount, 2);

  runtime.updateDrawingTool({ sessionId: 'runtime-session', toolRevision: 2, tool: 'brush' });
  assert.equal(canvas.upperCanvasEl.style.cursor, 'crosshair');
  runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    enabled: false
  });
  assert.equal(canvas.upperCanvasEl.style.cursor, 'default');
  runtime.setDrawingInput({
    ...firstInput,
    inputRevision: 3,
    session: { ...firstInput.session, sessionId: 'runtime-session-2' }
  });
  const restored = canvas.getObjects()[0];

  assert.notEqual(restored, selected);
  assert.equal(restored.left, 12);
  assert.equal(restored.scaleX, 1);
  assert.equal(restored.scaleY, 1);
  assert.equal(restored.angle, 0);
  assert.equal(restored.skewX, 0);
  assert.equal(restored.hasControls, false);
  assert.equal(restored.lockRotation, true);
});

test('pressure strokes, selection, move, delete, clear, cancellation, and stale revisions stay local', () => {
  FakeCanvas.instances = [];
  const document = new FakeDocument();
  const root = document.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document,
    devicePixelRatio: 2
  });
  runtime.prepare(root);

  assert.equal(runtime.setDrawingInput(makeInput()).accepted, true);
  const canvas = FakeCanvas.instances[0];
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  assert.equal(canvas.upperCanvasEl.style.pointerEvents, 'auto');
  assert.equal(toolbar.style.visibility, 'visible');
  assert.equal(toolbar.style.opacity, '1');
  assert.equal(toolbar.style.pointerEvents, 'auto');
  drawStroke(canvas.upperCanvasEl);
  assert.equal(runtime.getDiagnostics().objectCount, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 1);
  assert.equal(runtime.getDiagnostics().metrics.pointerSamples.count, 3);

  canvas.upperCanvasEl.dispatch('pointerdown', {
    pointerId: 9,
    pointerType: 'pen',
    button: 0,
    clientX: 15,
    clientY: 15,
    pressure: 0.4
  });
  canvas.upperCanvasEl.dispatch('pointercancel', { pointerId: 9, pointerType: 'pen' });
  assert.equal(runtime.getDiagnostics().objectCount, 1);
  assert.equal(runtime.getDiagnostics().mutationCount, 1);

  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 2,
    tool: 'select'
  }).accepted, true);
  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 1,
    tool: 'brush'
  }).accepted, false);

  const selected = canvas.getObjects()[0];
  canvas.activeObjects = [selected];
  canvas.emit('selection:created', { selected: [selected] });
  assert.equal(runtime.getDiagnostics().mutationCount, 1);
  selected.left += 10;
  canvas.emit('object:modified', { target: selected });
  assert.equal(runtime.getDiagnostics().mutationCount, 2);

  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'delete-1',
    action: 'delete-selection'
  }).deletedCount, 1);
  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'delete-1',
    action: 'delete-selection'
  }).duplicate, true);
  assert.equal(runtime.getDiagnostics().mutationCount, 3);
  assert.equal(runtime.getDiagnostics().metrics.duplicateActionCount, 1);

  assert.equal(runtime.updateDrawingTool({
    sessionId: 'runtime-session',
    toolRevision: 3,
    tool: 'brush'
  }).accepted, true);
  drawStroke(canvas.upperCanvasEl, 2);
  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'clear-1',
    action: 'clear-session'
  }).deletedCount, 1);
  assert.equal(runtime.applyDrawingAction({
    sessionId: 'runtime-session',
    actionId: 'clear-1',
    action: 'clear-session'
  }).duplicate, true);
  assert.equal(runtime.getDiagnostics().objectCount, 0);

  drawStroke(canvas.upperCanvasEl, 3);
  const warmSceneObject = canvas.getObjects()[0];

  assert.equal(runtime.setDrawingInput({
    hostGeneration: 1,
    videoGeneration: 2,
    inputRevision: 2,
    enabled: false
  }).accepted, true);
  assert.equal(canvas.upperCanvasEl.style.pointerEvents, 'none');
  assert.equal(toolbar.style.visibility, 'hidden');
  assert.equal(toolbar.style.opacity, '0');
  assert.equal(toolbar.style.pointerEvents, 'none');
  assert.equal(canvas.getObjects()[0], warmSceneObject, 'warm disable must not rebuild a settled scene');
  assert.equal(runtime.getDiagnostics().state, 'passive');
  assert.equal(runtime.setDrawingInput(makeInput({ inputRevision: 3 })).accepted, false);
  assert.equal(runtime.getDiagnostics().metrics.saveAttemptCount, 0);

  runtime.destroy();
  assert.equal(canvas.disposed, true);
});

test('stroke path data preserves source pressure separately from its Fabric path outline', () => {
  const result = createStrokePathData([
    { x: 1, y: 2, pressure: undefined, pointerType: 'mouse', time: 1 },
    { x: 8, y: 9, pressure: 2, pointerType: 'pen', time: 2 }
  ], { size: 8 });

  assert.deepEqual(result.sourcePoints.map(point => point.pressure), [0.5, 1]);
  assert.match(result.pathData, /^M /);
  assert.match(result.pathData, / Z$/);
  assert.ok(result.outline.length >= 3);
});

test('destructive command over maxHistoryBytes is rejected without changing the scene', () => {
  const harness = createHistoryHarness({
    maxBytes: 100000,
    maxHistoryBytes: 2048,
    estimateObjectBytes: () => 50
  });
  const { sceneStore } = harness;
  for (let index = 0; index < 12; index += 1) {
    assert.equal(sceneStore.addStroke(makeHistoryStroke(`capacity-${index}`)).applied, true);
  }
  assert.equal(sceneStore.undo().applied, true);
  const beforeScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const before = assertHistoryDiagnostics(harness, {
    mutationCount: 13,
    undoDepth: sceneStore.getDiagnostics().undoDepth,
    redoDepth: 1
  });

  assert.deepEqual(sceneStore.clearSession(), {
    applied: false,
    reason: 'history-capacity-exceeded'
  });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), beforeScene);
  assertHistoryDiagnostics(harness, {
    mutationCount: 13,
    undoDepth: before.undoDepth,
    redoDepth: 1,
    historyBytes: before.historyBytes
  });
});

test('destructive command whose undo state would exceed maxBytes is rejected atomically', () => {
  const harness = createHistoryHarness({
    maxBytes: 2000,
    maxHistoryBytes: 10000,
    estimateObjectBytes: () => 1000
  });
  const { sceneStore } = harness;
  const record = {
    id: 'inverse-capacity',
    type: 'stroke',
    pathData: 'M',
    sourcePoints: [],
    style: {},
    transform: { left: 0, top: 0 }
  };
  assert.equal(sceneStore.addStroke(record).applied, true);
  assert.equal(sceneStore.activateSession({
    sessionId: 'unrelated-cache-session',
    stableVideoIdentity: 'unrelated-cache-video',
    targetFrame: 0,
    videoGeneration: 1,
    tool: 'brush'
  }).accepted, true);
  assert.equal(sceneStore.activateSession({
    sessionId: 'inverse-capacity-session',
    stableVideoIdentity: 'runtime-video',
    targetFrame: 24,
    videoGeneration: 1,
    tool: 'brush'
  }).restored, true);
  sceneStore.selectObjects([record.id]);
  const beforeScene = JSON.stringify(sceneStore.getActiveSceneSnapshot());
  const before = assertHistoryDiagnostics(harness, {
    mutationCount: 1,
    undoDepth: 1,
    redoDepth: 0
  });
  assert.equal(sceneStore.hasScene('unrelated-cache-video', 0), true);

  assert.deepEqual(sceneStore.deleteSelection(), {
    applied: false,
    reason: 'scene-capacity-exceeded'
  });
  assert.equal(JSON.stringify(sceneStore.getActiveSceneSnapshot()), beforeScene);
  assert.equal(sceneStore.hasScene('unrelated-cache-video', 0), true);
  assert.equal(sceneStore.getDiagnostics().evictionCount, before.cache.evictionCount);
  assertHistoryDiagnostics(harness, {
    mutationCount: 1,
    undoDepth: 1,
    redoDepth: 0,
    historyBytes: before.historyBytes
  });
});

test('maxEntries eviction lets a replacement history command use the freed store bytes', () => {
  const harness = createHistoryHarness({
    maxBytes: 1400,
    maxHistoryBytes: 10000,
    maxHistory: 1,
    estimateObjectBytes: () => 100
  });
  const { sceneStore } = harness;
  const record = {
    id: 'entry-eviction',
    type: 'stroke',
    pathData: 'M',
    sourcePoints: [],
    style: {},
    transform: { left: 0, top: 0 }
  };
  assert.equal(sceneStore.addStroke(record).applied, true);
  assertHistoryDiagnostics(harness, { mutationCount: 1, undoDepth: 1, redoDepth: 0 });

  assert.equal(sceneStore.clearSession().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);
  assertHistoryDiagnostics(harness, { mutationCount: 2, undoDepth: 1, redoDepth: 0 });

  assert.equal(sceneStore.undo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, [record]);
  assertHistoryDiagnostics(harness, { mutationCount: 3, undoDepth: 0, redoDepth: 1 });
  assert.equal(sceneStore.redo().applied, true);
  assert.deepEqual(sceneStore.getActiveSceneSnapshot().objects, []);
  assertHistoryDiagnostics(harness, { mutationCount: 4, undoDepth: 1, redoDepth: 0 });
});

test('lasso split interpolates a crossing stroke into selected and remaining runs', () => {
  const points = [
    { x: 0, y: 5, pressure: 0.2, time: 0 },
    { x: 5, y: 5, pressure: 0.5, time: 5 },
    { x: 10, y: 5, pressure: 0.8, time: 10 }
  ];
  const polygon = [
    { x: 3, y: 2 },
    { x: 7, y: 2 },
    { x: 7, y: 8 },
    { x: 3, y: 8 }
  ];

  const result = splitStrokePointsByPolygon(points, polygon);

  assert.equal(result.inside.length, 1);
  assert.equal(result.outside.length, 2);
  assert.deepEqual(result.inside[0].map(point => point.x), [3, 5, 7]);
  assert.deepEqual(result.outside.map(run => run.map(point => point.x)), [[0, 3], [7, 10]]);
  assert.equal(result.inside[0][0].pressure, 0.38);
  assert.equal(result.inside[0][2].pressure, 0.62);
  assert.equal(result.inside[0][0].time, 3);
  assert.equal(result.inside[0][2].time, 7);
});

test('lasso split discards sub-pixel fragments that cannot be manipulated reliably', () => {
  const result = splitStrokePointsByPolygon([
    { x: 0, y: 5, pressure: 0.5, time: 0 },
    { x: 10, y: 5, pressure: 0.5, time: 10 }
  ], [
    { x: 0.2, y: 2 },
    { x: 0.8, y: 2 },
    { x: 0.8, y: 8 },
    { x: 0.2, y: 8 }
  ]);

  assert.deepEqual(result.inside, []);
  assert.deepEqual(result.outside.map(run => run.map(point => Number(point.x.toFixed(6)))), [
    [0.8, 10]
  ]);
});

test('lasso splitting stops as soon as its run budget is exhausted', () => {
  const points = Array.from({ length: 40 }, (_value, index) => ({
    x: index % 2 === 0 ? 0 : 10,
    y: index,
    pressure: 0.5,
    time: index
  }));
  const result = splitStrokePointsByPolygon(points, [
    { x: 4, y: -1 },
    { x: 6, y: -1 },
    { x: 6, y: 50 },
    { x: 4, y: 50 }
  ], { maxRuns: 3 });

  assert.equal(result.limitExceeded, true);
  assert.equal(result.runs.length <= 3, true);
});

test('a non-collinear lasso that exactly retraces its path still has zero area', () => {
  const retracedLasso = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 0, y: 0 }
  ];

  assert.equal(polygonHasArea(retracedLasso, 1), false);
});

test('runtime and adapter sources have no review persistence or IPC integration', () => {
  const source = [runtimePath, drawingV3AdapterPath]
    .map(filePath => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    source,
    /ReviewDataManager|saveReview|saveError|_onDataChanged|ipcRenderer|electronAPI/
  );
});
