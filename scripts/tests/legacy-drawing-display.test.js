const { test } = require('node:test');
const assert = require('node:assert/strict');

class TrackedTarget extends EventTarget {
  constructor() {
    super();
    this.listeners = [];
  }

  addEventListener(type, ...args) {
    this.listeners.push(type);
    super.addEventListener(type, ...args);
  }
}

class FakeCanvas extends TrackedTarget {
  constructor() {
    super();
    this.width = 320;
    this.height = 180;
    this.style = {};
    this.pixels = [];
    this.ctx = {
      globalAlpha: 1,
      clearRect: () => { this.pixels = []; },
      drawImage: image => { this.pixels.push([image.src, this.ctx.globalAlpha]); },
      getImageData: () => ({ width: this.width, height: this.height }),
      putImageData() {}
    };
  }

  getContext() { return this.ctx; }
  toDataURL() { return 'data:image/png;base64,display-only'; }
}

global.CustomEvent = class extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
};
global.window = new TrackedTarget();
global.document = new TrackedTarget();
global.document.createElement = () => new FakeCanvas();
global.Image = class {
  set src(value) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() { return this._src; }
};

async function makeManager() {
  const { DrawingManager } = await import('../../renderer/scripts/modules/drawing-manager.js');
  const canvas = new FakeCanvas();
  const below = new FakeCanvas();
  const above = new FakeCanvas();
  const manager = new DrawingManager({ canvas, layersBelowCanvas: below, layersAboveCanvas: above });
  return { manager, canvas, below, above };
}

const keyframe = (frame, data, options = {}) => ({
  frame, canvasData: data, isEmpty: !data, baseCanvasData: null, strokeRecords: [], ...options
});
const layer = (id, keyframes, options = {}) => ({
  id, name: id, visible: true, locked: false, color: '#123456', opacity: 1, keyframes, ...options
});
const documentData = layers => ({ layers, activeLayerId: layers[0]?.id ?? null, totalFrames: 120, fps: 24 });

test('legacy display construction registers no pointer or global modifier listeners', async () => {
  const windowListeners = window.listeners.length;
  const documentListeners = document.listeners.length;
  const { manager, canvas, below, above } = await makeManager();
  assert.deepEqual(canvas.listeners, []);
  assert.deepEqual(below.listeners, []);
  assert.deepEqual(above.listeners, []);
  assert.equal(window.listeners.length, windowListeners);
  assert.equal(document.listeners.length, documentListeners);
  manager.destroy();
});

test('legacy display exposes no stroke, selection, or tool authoring methods', async () => {
  const { manager } = await makeManager();
  for (const method of ['_onDrawStart', '_onDrawEnd', '_onSelectionCommitted', 'setTool', 'setEraserMode', 'setLineWidth']) {
    assert.equal(typeof manager[method], 'undefined', method);
  }
  for (const method of ['_onPointerDown', 'setTool', 'commitSelection', 'drawStrokeRecord']) {
    assert.equal(typeof manager.drawingCanvas[method], 'undefined', method);
  }
  manager.destroy();
});

test('drawing collaboration starts with the passive display and does not subscribe to local strokes', async () => {
  const { DrawingSync } = await import('../../renderer/scripts/modules/drawing-sync.js');
  const { manager } = await makeManager();
  const events = [];
  const liveblocksManager = new EventTarget();
  liveblocksManager.broadcastEvent = event => events.push(event);
  liveblocksManager.hasOtherCollaborators = () => true;
  const managerListeners = [];
  const addListener = manager.addEventListener.bind(manager);
  manager.addEventListener = (type, ...args) => {
    managerListeners.push(type);
    addListener(type, ...args);
  };
  const sync = new DrawingSync({ liveblocksManager, drawingManager: manager, actorId: 'passive-display' });
  assert.doesNotThrow(() => sync.start());
  assert.equal(managerListeners.includes('drawend'), false);
  for (const method of ['_onDrawStart', '_onDrawMove', '_onDrawEnd']) {
    assert.equal(typeof sync[method], 'undefined', method);
  }
  manager.dispatchEvent(new CustomEvent('drawend', { detail: {} }));
  assert.deepEqual(events, []);
  sync.stop();
  manager.destroy();
});

test('old drawings retain layer metadata, raster data, empty boundaries, and stroke records on round-trip', async () => {
  const { manager } = await makeManager();
  const stroke = {
    id: 'old-stroke', tool: 'brush', points: [{ x: 1, y: 2 }, { x: 4, y: 8 }],
    color: '#abcdef', lineWidth: 7, opacity: 0.6,
    strokeEnabled: true, strokeWidth: 2, strokeColor: '#ffffff'
  };
  const data = documentData([
    layer('legacy-a', [
      keyframe(0, 'data:image/png;base64,old', { baseCanvasData: 'data:image/png;base64,base', strokeRecords: [stroke] }),
      keyframe(12, null)
    ], { name: '기존 그림', opacity: 0.4, locked: true }),
    layer('legacy-hidden', [keyframe(2, 'data:image/png;base64,hidden')], { visible: false }),
    layer('legacy-transparent', [keyframe(0, 'data:image/png;base64,transparent')], { opacity: 0 })
  ]);
  const saved = structuredClone(data);
  manager.importData(data);
  await manager.renderFrame(0);
  assert.deepEqual(manager.exportData(), saved);
  assert.deepEqual(data, saved, 'reading and displaying must not mutate the loaded document');
  manager.destroy();
});

test('legacy held frames render below, active, and above layers with independent opacity', async () => {
  const { manager, canvas, below, above } = await makeManager();
  const data = documentData([
    layer('below', [keyframe(0, 'below')], { opacity: 0.25 }),
    layer('active', [keyframe(0, 'active'), keyframe(10, null)], { opacity: 0.5 }),
    layer('hidden', [keyframe(0, 'hidden')], { visible: false }),
    layer('above', [keyframe(3, 'above')], { opacity: 0.75 })
  ]);
  data.activeLayerId = 'active';
  manager.importData(data);
  manager.currentFrame = 5;
  await manager.renderFrame(5);
  assert.deepEqual(below.pixels, [['below', 0.25]]);
  assert.deepEqual(canvas.pixels, [['active', 1]]);
  assert.equal(canvas.style.opacity, '0.5');
  assert.deepEqual(above.pixels, [['above', 0.75]]);
  manager.currentFrame = 10;
  await manager.renderFrame(10);
  assert.deepEqual(canvas.pixels, [], 'empty keyframe stops the preceding held image');
  assert.deepEqual(below.pixels, [['below', 0.25]]);
  assert.deepEqual(above.pixels, [['above', 0.75]]);
  manager.destroy();
});

test('legacy cached playback uses the same layer composition and keeps data unchanged', async () => {
  const { manager, canvas, below } = await makeManager();
  const data = documentData([
    layer('below', [keyframe(0, 'old-below')], { opacity: 0.2 }),
    layer('active', [keyframe(0, 'old-active')])
  ]);
  data.activeLayerId = 'active';
  manager.importData(data);
  await manager.renderFrame(0);
  const saved = manager.exportData();
  manager.isPlaying = true;
  manager.currentFrame = 8;
  await manager.renderFrame(8);
  assert.deepEqual(canvas.pixels, [['old-active', 1]]);
  assert.deepEqual(below.pixels, [['old-below', 0.2]]);
  assert.deepEqual(manager.exportData(), saved);
  manager.destroy();
});

test('legacy FPS remapping retains content and playback frame count with last collision winning', async () => {
  const { manager } = await makeManager();
  manager.setVideoInfo(96, 24);
  const data = documentData([layer('legacy', [keyframe(0, 'first'), keyframe(1, 'later'), keyframe(2, 'third')])]);
  data.fps = 60;
  data.totalFrames = 240;
  manager.importData(data);
  assert.equal(manager.totalFrames, 96);
  assert.equal(manager.fps, 24);
  assert.deepEqual(manager.exportData().layers[0].keyframes.map(kf => [kf.frame, kf.canvasData]), [[0, 'later'], [1, 'third']]);
  await manager.renderFrame(0);
  manager.destroy();
});

test('layer lifecycle and ordering still work alongside legacy display data', async () => {
  const { manager } = await makeManager();
  const data = documentData([layer('old', [keyframe(0, 'old-content')])]);
  manager.importData(data);
  manager.createLayer({ id: 'fabric-layer', name: '현재 레이어' }, false);
  manager.setActiveLayer('old');
  manager.toggleLayerVisibility('fabric-layer');
  manager.toggleLayerLock('fabric-layer');
  manager.setLayerOpacity('fabric-layer', 0.3);
  manager.applyLayerOrder(['fabric-layer', 'old']);
  assert.deepEqual(manager.layers.map(item => item.id), ['fabric-layer', 'old']);
  assert.equal(manager.getActiveLayer().keyframes[0].canvasData, 'old-content');
  const newLayer = manager.layers[0].toJSON();
  assert.equal(newLayer.visible, false);
  assert.equal(newLayer.locked, true);
  assert.equal(newLayer.opacity, 0.3);
  manager.deleteLayer('fabric-layer', false);
  manager.restoreLayer(newLayer, { insertIndex: 0 });
  assert.deepEqual(manager.layers[0].toJSON(), newLayer);
  await manager.renderFrame(0);
  manager.destroy();
});
