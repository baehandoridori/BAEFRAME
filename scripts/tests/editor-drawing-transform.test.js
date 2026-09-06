const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const fabric = require('fabric/node');
const { createCanvas, loadImage } = require('canvas');

const adapterPath = path.resolve(__dirname, '../../renderer/scripts/editor/drawing.js');
const built = require('esbuild').buildSync({ entryPoints: [adapterPath], bundle: true,
  platform: 'node', format: 'cjs', packages: 'external', write: false });
const loaded = new Module(adapterPath, module);
loaded.filename = adapterPath;
loaded.paths = Module._nodeModulePaths(path.dirname(adapterPath));
// Count the actual persistence store export boundary without adding a production
// testing API. The bundle contains exactly one store exportRootValue function.
const exportBoundary = 'function exportRootValue() {';
assert.equal(built.outputFiles[0].text.split(exportBoundary).length, 2);
loaded._compile(`let rootExportCalls = 0;\n${built.outputFiles[0].text.replace(exportBoundary,
  `${exportBoundary} rootExportCalls++;`)}\nmodule.exports.rootExports = () => rootExportCalls;`, adapterPath);
const { createEditorDrawing, rootExports } = loaded.exports;
const project = { width: 1920, height: 1080, fps: 24 };
const clip = { id: 'a', durationFrames: 48, drawingOffsetFrames: 0, drawingsV3: null, drawingLayersV1: null };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01,
  `${label}: expected ${expected}, got ${actual}`);

function harness() {
  const { window, document } = fabric.getEnv();
  let area = { left: 211, top: 113, width: 640, height: 360 };
  const viewport = document.createElement('div');
  viewport.id = 'stageViewport';
  viewport.getBoundingClientRect = () => ({ left: 100, top: 70, width: 800, height: 500,
    right: 900, bottom: 570 });
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ ...area, right: area.left + area.width, bottom: area.top + area.height });
  viewport.appendChild(container); document.body.appendChild(viewport);
  const nativeQueue = window.queueMicrotask;
  const microtasks = [];
  window.queueMicrotask = callback => microtasks.push(callback);
  const checkpoint = () => { for (const callback of microtasks.splice(0)) callback(); };
  let canvas;
  class CaptureCanvas extends fabric.Canvas {
    constructor(...args) { super(...args); canvas = this; }
  }
  const drawing = createEditorDrawing({ container, fabric: { ...fabric, Canvas: CaptureCanvas }, window });
  for (const element of [canvas.upperCanvasEl, canvas.lowerCanvasEl, canvas.wrapperEl]) {
    element.getBoundingClientRect = container.getBoundingClientRect;
  }
  // Native Chrome drains microtasks between separate DOM listener callbacks.
  // jsdom dispatchEvent normally drains only after all listeners; insert that real
  // browser checkpoint after the runtime capture listener, before Fabric bubbles.
  canvas.upperCanvasEl.addEventListener('pointerup', checkpoint);
  document.addEventListener('pointerup', checkpoint);
  let timestamp = 0;
  function pointer(type, x, y, id, target = canvas.upperCanvasEl) {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true,
      clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    for (const [name, value] of Object.entries({ pointerId: id, pointerType: 'mouse', isPrimary: true, pressure: 0.5, timeStamp: ++timestamp })) {
      Object.defineProperty(event, name, { value });
    }
    target.dispatchEvent(event);
  }
  async function drag(from, to, id) {
    pointer('pointerdown', ...from, id);
    pointer('pointermove', ...to, id, document);
    pointer('pointerup', ...to, id);
    checkpoint(); await settle(); checkpoint();
  }
  async function paint(y, id) {
    pointer('pointerdown', 350, y, id);
    pointer('pointermove', 500, y + 10, id);
    pointer('pointerup', 500, y + 10, id);
    checkpoint(); await settle();
  }
  return { drawing, canvas, document, viewport, container, drag, paint,
    setArea(next) { area = next; },
    async dispose() {
      await drawing.dispose();
      document.removeEventListener('pointerup', checkpoint);
      window.queueMicrotask = nativeQueue;
      viewport.remove();
    }
  };
}

test('native pointerup checkpoints keep grouped move coordinates through undo, reopening and PNG export', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip, project);
    await h.drawing.setTool('brush', { size: 24 });
    await h.paint(240, 1); await h.paint(300, 2);
    const before = h.drawing.snapshot();
    await h.drawing.setTool('select');
    await h.drag([320, 220], [530, 340], 3);
    assert.equal(h.canvas.getActiveObjects().length, 2);
    assert.deepEqual(h.drawing.snapshot(), before, 'selecting is not a document edit');
    await h.drag([425, 275], [465, 295], 4);
    const moved = h.drawing.snapshot();
    const beforeObjects = before.drawingsV3.keyframes[0].objects;
    const movedObjects = moved.drawingsV3.keyframes[0].objects;
    for (let index = 0; index < 2; index++) {
      closeTo(movedObjects[index].transform.left, beforeObjects[index].transform.left + 120, 'group x');
      closeTo(movedObjects[index].transform.top, beforeObjects[index].transform.top + 60, 'group y');
    }
    await h.drawing.action('undo');
    assert.deepEqual(h.drawing.snapshot().drawingsV3.keyframes[0].objects, beforeObjects);
    await h.drawing.action('redo');
    assert.deepEqual(h.drawing.snapshot().drawingsV3.keyframes[0].objects, movedObjects);
    await h.drawing.loadClip({ ...clip, ...moved }, project);
    for (let index = 0; index < 2; index++) {
      closeTo(h.canvas.getObjects()[index].left, movedObjects[index].transform.left, 'reopened x');
      closeTo(h.canvas.getObjects()[index].top, movedObjects[index].transform.top, 'reopened y');
    }
    const [overlay] = await h.drawing.exportOverlays({ ...clip, ...moved }, project);
    const image = await loadImage(overlay.dataUrl);
    const context = createCanvas(project.width, project.height).getContext('2d');
    context.drawImage(image, 0, 0);
    for (const record of movedObjects) {
      const { left, top } = record.transform;
      assert.ok(context.getImageData(Math.round(left), Math.round(top), 1, 1).data[3] > 0, 'PNG keeps moved coordinates');
    }
  } finally { await h.dispose(); }
});

test('refreshViewport follows a translated scaled stage and clips the body overlay to the viewing area', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip, project);
    assert.equal(typeof h.drawing.refreshViewport, 'function');
    h.setArea({ left: 50, top: 40, width: 1280, height: 720 });
    h.drawing.refreshViewport();
    const viewport = h.document.querySelector('.mpv-fabric-pilot-viewport');
    assert.equal(viewport.style.left, '50px');
    assert.equal(viewport.style.top, '40px');
    assert.equal(viewport.style.width, '1280px');
    const overlay = h.document.querySelector('.editor-drawing-overlay');
    assert.match(overlay.style.clipPath, /70px.*100px/);
    await h.drawing.setTool('brush', { size: 24 });
    await h.paint(240, 5);
    const points = h.drawing.snapshot().drawingsV3.keyframes[0].objects[0].sourcePoints;
    closeTo(points[0].x, (350 - 50) * 1.5, 'zoomed input x');
    closeTo(points[0].y, (240 - 40) * 1.5, 'zoomed input y');
  } finally { await h.dispose(); }
});

test('pan and frame seeks reuse layer geometry without copying an unchanged drawing document', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip, project);
    await h.drawing.setTool('brush', { size: 24 });
    await h.paint(240, 6);
    await h.drawing.setEnabled(false);
    const before = rootExports();
    for (let index = 0; index < 60; index++) {
      h.setArea({ left: 211 + index, top: 113, width: 640, height: 360 });
      h.drawing.refreshViewport();
    }
    for (let frame = 0; frame < 24; frame++) await h.drawing.seek(frame);
    assert.equal(rootExports() - before, 0, 'view-only updates never export the whole V3 document');
  } finally { await h.dispose(); }
});

test('cached layer masks track selection, hidden layers, drawing undo and reopened documents', async () => {
  const h = harness();
  const visible = () => h.canvas.getObjects().filter(object => object.visible !== false).length;
  try {
    await h.drawing.loadClip(clip, project);
    await h.drawing.setTool('brush', { size: 24 });
    const base = h.drawing.layers()[0].id;
    await h.paint(240, 7);
    await h.drawing.addLayer('위 그림');
    const upper = h.drawing.layers().find(layer => layer.active).id;
    await h.paint(300, 8);
    assert.equal(visible(), 2);
    const beforeHide = rootExports();
    await h.drawing.toggleLayer(upper);
    assert.equal(rootExports() - beforeHide, 1, 'visibility exports only its required change snapshot');
    assert.equal(visible(), 1);
    await h.drawing.setActiveLayer(base);
    const existingIds = new Set(h.drawing.snapshot().drawingsV3.keyframes[0].objects.map(object => object.id));
    await h.paint(330, 9);
    assert.equal(visible(), 2, 'the new base-layer stroke stays visible under a hidden upper layer');
    const saved = h.drawing.snapshot();
    const newest = saved.drawingsV3.keyframes[0].objects.find(object => !existingIds.has(object.id));
    assert.equal(saved.drawingLayersV1.assignments[newest.id] ?? saved.drawingLayersV1.baseLayerId, base);
    await h.drawing.action('undo');
    assert.equal(visible(), 1);
    await h.drawing.action('redo');
    assert.equal(visible(), 2);
    await h.drawing.loadClip({ ...clip, ...saved }, project);
    assert.equal(visible(), 2, 'reopening builds masks for the new owner');
    await h.drawing.toggleLayer(upper);
    assert.equal(visible(), 3);
  } finally { await h.dispose(); }
});
