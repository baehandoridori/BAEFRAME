const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const fabric = require('fabric/node');
const { createCanvas, loadImage } = require('canvas');
const root = path.resolve(__dirname, '../..');
const adapterPath = path.join(root, 'renderer/scripts/editor/drawing.js');
let adapter = {};
if (fs.existsSync(adapterPath)) {
  const built = require('esbuild').buildSync({ entryPoints: [adapterPath], bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', write: false });
  const loaded = new Module(adapterPath, module);
  loaded.filename = adapterPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(adapterPath));
  loaded._compile(built.outputFiles[0].text, adapterPath);
  adapter = loaded.exports;
}
const project = { width: 200, height: 100, fps: 24 };
const stroke = (id, color = '#ff0000', extra = {}) => ({ id, type: 'stroke',
  pathData: 'M 10 10 L 30 10 L 30 30 L 10 30 Z',
  sourcePoints: [{ x: 10, y: 10, pressure: 0.5, time: 0 }, { x: 30, y: 30, pressure: 0.5, time: 1 }],
  style: { color, size: 3, opacity: 0.5 },
  transform: { left: 20, top: 20, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false },
  ...extra });
const documentValue = (frames) => ({ storageSchema: 'baeframe-fabric-scenes', storageVersion: '1.0.0',
  engine: 'fabric-7', documentId: 'fixture-document', revision: 0, fps: 24, totalFrames: 100,
  keyframes: frames.map(([frame, objects]) => ({ id: `frame-${frame}`, frame, sourceWidth: 200,
    sourceHeight: 100, mutationSequence: 0, objects })) });
const clip = (id, drawingsV3 = null, extra = {}) => ({ id, durationFrames: 24,
  drawingOffsetFrames: 0, drawingsV3, drawingLayersV1: null, ...extra });
function harness() {
  assert.equal(typeof adapter.createEditorDrawing, 'function', 'editor drawing adapter must exist');
  const { window, document } = fabric.getEnv();
  const container = document.createElement('div');
  const paletteContainer = document.createElement('div');
  paletteContainer.className = 'drawing-tools';
  document.body.appendChild(paletteContainer);
  const style = document.createElement('style');
  const cssPath = path.join(root, 'renderer/styles/editor-drawing.css');
  if (fs.existsSync(cssPath)) style.textContent = fs.readFileSync(cssPath, 'utf8');
  document.head.appendChild(style);
  Object.defineProperty(container, 'getBoundingClientRect', { value: () => ({ left: 80, top: 60,
    width: 400, height: 200, right: 480, bottom: 260 }) });
  document.body.appendChild(container);
  const changes = [];
  const drawing = adapter.createEditorDrawing({ container, paletteContainer, fabric, window,
    onChange: value => changes.push(value) });
  return { drawing, changes, window, document, container, paletteContainer, async dispose() {
    await drawing.dispose(); container.remove(); paletteContainer.remove(); style.remove();
  } };
}
function pointer(h, type, x, y, time) {
  const surface = h.document.querySelector('.upper-canvas');
  assert.ok(surface, 'real Fabric input surface is present');
  const event = new h.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y,
    button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'pen', pressure: 0.5, timeStamp: time })) {
    Object.defineProperty(event, key, { value });
  }
  surface.dispatchEvent(event);
}
async function paint(h) {
  pointer(h, 'pointerdown', 120, 100, 1);
  pointer(h, 'pointermove', 160, 120, 2);
  pointer(h, 'pointerup', 180, 140, 3);
  await Promise.resolve();
}
test('a committed stroke is emitted for its original clip when another clip is loaded immediately', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project);
    await paint(h);
    await h.drawing.loadClip(clip('b'), project);
    assert.ok(h.changes.some(change => change.clipId === 'a' && change.drawingsV3.keyframes[0].objects.length > 0));
    assert.equal(h.changes.some(change => change.clipId === 'b'), false);
    assert.equal(h.drawing.snapshot().drawingsV3.keyframes.length, 0);
    const point = h.changes.find(change => change.clipId === 'a').drawingsV3.keyframes[0].objects[0].sourcePoints[0];
    assert.equal(point.x, 20); assert.equal(point.y, 20);
  } finally { await h.dispose(); }
});
test('blank ends the current exposure without shifting a later keyframe or mutating the caller document', async () => {
  const h = harness(); const source = documentValue([[0, [stroke('red')]], [12, [stroke('blue', '#0000ff')]]]);
  try {
    await h.drawing.loadClip(clip('a', source), project);
    await h.drawing.seek(6); await h.drawing.action('blank');
    const saved = h.drawing.snapshot().drawingsV3;
    assert.deepEqual(saved.keyframes.map(frame => frame.frame), [0, 6, 12]);
    assert.equal(saved.keyframes[1].objects.length, 0);
    assert.equal(saved.keyframes[2].objects[0].style.color, '#0000ff');
    assert.deepEqual(source.keyframes.map(frame => frame.frame), [0, 12]);
  } finally { await h.dispose(); }
});
test('split offset exposes the held drawing at local zero and uses local seek for a new keyframe', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('right', documentValue([[0, [stroke('red')]], [12, []]]), { drawingOffsetFrames: 5 }), project);
    assert.equal(h.drawing.keyframes()[0].frame, 0);
    assert.equal(h.drawing.keyframes()[0].isEmpty, false);
    await h.drawing.seek(3); await h.drawing.action('keyframe');
    assert.ok(h.drawing.snapshot().drawingsV3.keyframes.some(frame => frame.frame === 8 && frame.objects.length === 1));
  } finally { await h.dispose(); }
});
test('export clips held and blank exposures to half-open local intervals and preserves PNG alpha', async () => {
  const h = harness();
  try {
    const value = clip('right', documentValue([[0, [stroke('red')]], [8, []], [12, [stroke('blue', '#0000ff')]]]),
      { drawingOffsetFrames: 5, durationFrames: 12 });
    const overlays = await h.drawing.exportOverlays(value, project);
    assert.deepEqual(overlays.map(item => [item.clipId, item.startFrame, item.endFrame]), [['right', 0, 3], ['right', 7, 12]]);
    const png = await loadImage(overlays[0].dataUrl); assert.equal(png.width, 200); assert.equal(png.height, 100);
    const canvas = createCanvas(200, 100); const ctx = canvas.getContext('2d'); ctx.drawImage(png, 0, 0);
    assert.deepEqual([...ctx.getImageData(0, 0, 1, 1).data], [0, 0, 0, 0]);
    const pixel = [...ctx.getImageData(20, 20, 1, 1).data];
    assert.equal(pixel[0], 255); assert.ok(pixel[3] >= 126 && pixel[3] <= 129);
  } finally { await h.dispose(); }
});
test('export honors renderGeometry holes, object transform and hidden layers', async () => {
  const h = harness();
  try {
    const record = stroke('shape', '#00ff00', { renderGeometry: { version: 1, fillRule: 'evenodd',
      pathData: 'M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 30 10 L 30 30 L 10 30 Z' },
    transform: { left: 70, top: 30, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false } });
    const value = clip('a', documentValue([[0, [record]]]));
    const [overlay] = await h.drawing.exportOverlays(value, project);
    const image = await loadImage(overlay.dataUrl); const ctx = createCanvas(200, 100).getContext('2d'); ctx.drawImage(image, 0, 0);
    assert.ok(ctx.getImageData(55, 15, 1, 1).data[3] > 0);
    assert.equal(ctx.getImageData(70, 30, 1, 1).data[3], 0);
    value.drawingLayersV1 = { version: 1, layers: [{ id: 'hidden', name: '숨김', visible: false, locked: false, color: '#ff0000' }],
      baseLayerId: 'hidden', activeLayerId: 'hidden', assignments: {} };
    assert.deepEqual(await h.drawing.exportOverlays(value, project), []);
  } finally { await h.dispose(); }
});
test('layer assignment survives export and input disabling prevents strokes', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project);
    await h.drawing.addLayer('효과'); const active = h.drawing.layers().find(layer => layer.active);
    assert.equal(active.name, '효과'); await paint(h);
    const saved = h.drawing.snapshot(); const id = saved.drawingsV3.keyframes[0].objects[0].id;
    assert.equal(saved.drawingLayersV1.assignments[id], active.id);
    await h.drawing.setEnabled(false); const before = JSON.stringify(h.drawing.snapshot()); await paint(h);
    assert.equal(JSON.stringify(h.drawing.snapshot()), before);
    await h.drawing.toggleLayer(active.id);
    assert.deepEqual(await h.drawing.exportOverlays({ ...clip('a'), ...h.drawing.snapshot() }, project), []);
  } finally { await h.dispose(); }
});
test('removing the last clip clears drawings and hides the fixed overlay', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a', documentValue([[0, [stroke('red')]]])), project);
    await h.drawing.loadClip(null, project);
    assert.deepEqual(h.drawing.snapshot(), { drawingsV3: null, drawingLayersV1: null });
    assert.equal(h.document.querySelector('.editor-drawing-overlay').style.display, 'none');
    assert.deepEqual(h.drawing.keyframes(), []);
  } finally { await h.dispose(); }
});
test('renderer works when randomUUID is unavailable in a preview origin', async () => {
  const crypto = globalThis.crypto;
  const own = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project);
    await paint(h);
    assert.equal(h.drawing.snapshot().drawingsV3.keyframes[0].objects.length, 1);
  } finally {
    if (own) Object.defineProperty(crypto, 'randomUUID', own); else delete crypto.randomUUID;
    await h.dispose();
  }
});
test('seek and already-existing keyframe do not dirty an unchanged drawing document', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a', documentValue([[0, [stroke('red')]]])), project);
    await h.drawing.seek(4); await h.drawing.seek(0); await h.drawing.action('keyframe');
    await Promise.resolve(); assert.equal(h.changes.length, 0);
    assert.deepEqual(h.drawing.keyframes().map(frame => [frame.frame, frame.isEmpty]), [[0, false]]);
  } finally { await h.dispose(); }
});
test('undo and redo restore the actual stroke and a held-frame insertion preserves later exposures', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project); await paint(h);
    await h.drawing.action('undo');
    assert.equal(h.drawing.snapshot().drawingsV3.keyframes.flatMap(frame => frame.objects).length, 0);
    await h.drawing.action('redo');
    assert.equal(h.drawing.snapshot().drawingsV3.keyframes.flatMap(frame => frame.objects).length, 1);
    await h.drawing.loadClip(clip('b', documentValue([[0, [stroke('red')]], [10, []]])), project);
    await h.drawing.seek(3); await h.drawing.action('hold');
    assert.deepEqual(h.drawing.snapshot().drawingsV3.keyframes.map(frame => frame.frame), [0, 11]);
  } finally { await h.dispose(); }
});
test('changing active layers cancels an unfinished stroke instead of assigning it to the new layer', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project);
    pointer(h, 'pointerdown', 120, 100, 1); pointer(h, 'pointermove', 160, 120, 2);
    await h.drawing.addLayer('다음 레이어'); pointer(h, 'pointerup', 180, 140, 3);
    await Promise.resolve();
    assert.equal(h.drawing.snapshot().drawingsV3.keyframes.flatMap(frame => frame.objects).length, 0);
  } finally { await h.dispose(); }
});
test('invalid replacement clips do not break the current clip drawing session', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project);
    await assert.rejects(h.drawing.loadClip(clip('bad', { storageVersion: 'broken' }), project));
    await h.drawing.seek(2); await paint(h);
    assert.ok(h.changes.some(change => change.clipId === 'a' && change.drawingsV3.keyframes.some(frame => frame.frame === 2)));
  } finally { await h.dispose(); }
});
test('PNG stacking follows the layer order and project resizing scales stored geometry consistently', async () => {
  const h = harness();
  try {
    const value = clip('a', documentValue([[0, [stroke('red', '#ff0000', { style: { color: '#ff0000', size: 3, opacity: 1 } }),
      stroke('blue', '#0000ff', { style: { color: '#0000ff', size: 3, opacity: 1 } })]]]));
    value.drawingLayersV1 = { version: 1, layers: [
      { id: 'top', name: '위', visible: true, locked: false, color: '#ff0000' },
      { id: 'base', name: '아래', visible: true, locked: false, color: '#0000ff' }],
    activeLayerId: 'top', baseLayerId: 'base', assignments: { red: 'top' } };
    const [overlay] = await h.drawing.exportOverlays(value, { width: 100, height: 200, fps: 24 });
    const img = await loadImage(overlay.dataUrl); const ctx = createCanvas(100, 200).getContext('2d'); ctx.drawImage(img, 0, 0);
    assert.deepEqual([...ctx.getImageData(10, 40, 1, 1).data], [255, 0, 0, 255]);
    assert.equal(ctx.getImageData(20, 40, 1, 1).data[3], 0);
    assert.equal(value.drawingsV3.keyframes[0].sourceWidth, 200);
  } finally { await h.dispose(); }
});
test('cancelling PNG preparation discards partial overlays before video export', async () => {
  const h = harness();
  try {
    let checks = 0;
    const overlays = await h.drawing.exportOverlays(clip('a', documentValue([
      [0, [stroke('red')]], [8, [stroke('blue', '#0000ff')]]
    ])), project, { isCancelled: () => ++checks > 1 });
    assert.deepEqual(overlays, []);
    assert.equal(checks, 2);
  } finally { await h.dispose(); }
});
test('palette docks in the editor tool row, excludes local history controls and hides with input', async () => {
  const h = harness();
  try {
    await h.drawing.loadClip(clip('a'), project);
    const palette = h.document.querySelector('.mpv-fabric-pilot-toolbar');
    assert.ok(h.paletteContainer.contains(palette));
    assert.equal(h.window.getComputedStyle(palette).position, 'static');
    assert.equal(h.window.getComputedStyle(palette.querySelector('[data-fabric-pilot-action="undo"]')).display, 'none');
    assert.equal(h.window.getComputedStyle(palette.querySelector('[data-fabric-pilot-action="redo"]')).display, 'none');
    assert.equal(h.document.querySelector('.editor-drawing-overlay .mpv-fabric-pilot-toolbar'), null);
    await h.drawing.setEnabled(false);
    assert.equal(h.paletteContainer.querySelector('.editor-drawing-dock').hidden, true);
  } finally { await h.dispose(); }
});
