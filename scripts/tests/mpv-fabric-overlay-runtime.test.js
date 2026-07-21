const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const runtimePath = path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-overlay-runtime.js');
const {
  createFabricOverlayRuntime,
  createSessionSceneStore,
  createStrokePathData,
  resolveEffectiveCanvasRect,
  resolveSelectionHitTolerance,
  mapClientPointToSource
} = require(runtimePath);

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
  return matches.concat((root.children || []).flatMap(child => findAll(child, predicate)));
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function getBrushControls(root) {
  const toolbar = root.querySelectorAllByClass('mpv-fabric-pilot-toolbar')[0];
  return {
    toolbar,
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

function createRealFabricHarness() {
  const realFabric = require('fabric/node');
  const environment = realFabric.getEnv();
  const canvases = [];
  const sceneStore = createSessionSceneStore();
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
    fabric: { ...realFabric, Canvas: CaptureCanvas },
    document: environment.document,
    window: environment.window,
    sceneStore
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
  }

  function drawStrokeAt(y, pointerId) {
    dispatchPointer(element, 'pointerdown', 20, y, pointerId, 1);
    dispatchPointer(element, 'pointermove', 60, y, pointerId, 1);
    dispatchPointer(element, 'pointerup', 60, y, pointerId, 0);
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

  function dragActiveSelectionBy(dx, dy, pointerId = 102) {
    const center = canvas.getActiveObject().getCenterPoint();
    dispatchPointer(element, 'pointerdown', center.x, center.y, pointerId, 1);
    dispatchPointer(environment.document, 'pointermove', center.x + dx, center.y + dy, pointerId, 1);
    dispatchCapturedPointerUp(center.x + dx, center.y + dy, pointerId);
  }

  function dragStrokeBy(index, dx, dy, onMove, pointerId = 103) {
    const center = canvas.getObjects()[index].getCenterPoint();
    dispatchPointer(element, 'pointerdown', center.x, center.y, pointerId, 1);
    dispatchPointer(environment.document, 'pointermove', center.x + dx, center.y + dy, pointerId, 1);
    onMove?.();
    dispatchCapturedPointerUp(center.x + dx, center.y + dy, pointerId);
  }

  function clickStroke(index, pointerId, onPointerDown) {
    const center = canvas.getObjects()[index].getCenterPoint();
    dispatchPointer(element, 'pointerdown', center.x, center.y, pointerId, 1);
    onPointerDown?.();
    dispatchCapturedPointerUp(center.x, center.y, pointerId);
  }

  function hoverAt(x, y) {
    dispatchPointer(element, 'pointermove', x, y, 0, 0);
  }

  function sceneTransforms() {
    return sceneStore.getActiveSceneSnapshot().objects.map(object => ({
      left: Number(object.transform?.left) || 0,
      top: Number(object.transform?.top) || 0
    }));
  }

  return {
    runtime,
    canvas,
    environment,
    element,
    pointerCapture,
    dispatchLostPointerCapture,
    pointerDispatches,
    dispatchPointer,
    drawStrokeAt,
    dragMarquee,
    dragActiveSelectionBy,
    dragStrokeBy,
    clickStroke,
    hoverAt,
    sceneTransforms,
    async destroy() {
      runtime.destroy();
      await canvas.__disposePromise;
      root.remove();
    }
  };
}

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
    assert.equal(harness.canvas.upperCanvasEl.style.cursor, 'grab');
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

    harness.dispatchPointer(harness.element, 'pointerdown', 140, 140, 159, 1);
    harness.dispatchPointer(harness.environment.document, 'pointermove', 180, 180, 159, 1);
    harness.environment.window.dispatchEvent(new harness.environment.window.Event('blur'));
    await Promise.resolve();
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
    'getDiagnostics',
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
    assert.equal(target.hoverCursor, 'grab');
    assert.equal(target.moveCursor, 'grabbing');
  }

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

test('runtime source has no review persistence integration', () => {
  const source = fs.readFileSync(runtimePath, 'utf8');
  assert.doesNotMatch(source, /ReviewDataManager|saveReview|saveError|_onDataChanged/);
});
