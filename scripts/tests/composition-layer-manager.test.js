const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModule() {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '../../renderer/scripts/modules/composition-layer-manager.js')
  );
  return import(moduleUrl.href);
}

test('detects supported image and video layer media types', async () => {
  const { getCompositionLayerType } = await loadModule();

  assert.equal(getCompositionLayerType('C:/shot/plate.png'), 'image');
  assert.equal(getCompositionLayerType('C:/shot/matte.WEBP'), 'image');
  assert.equal(getCompositionLayerType('C:/shot/overlay.mov'), 'video');
  assert.equal(getCompositionLayerType('C:/shot/overlay.webm'), 'video');
  assert.equal(getCompositionLayerType('C:/shot/readme.txt'), null);
});

test('calculates practical default image durations from base video length', async () => {
  const { getDefaultImageLayerDuration } = await loadModule();

  assert.equal(getDefaultImageLayerDuration(1), 1);
  assert.equal(getDefaultImageLayerDuration(10), 2);
  assert.equal(getDefaultImageLayerDuration(60), 6);
  assert.equal(getDefaultImageLayerDuration(300), 8);
});

test('creates image layers near the playhead without exceeding the base duration by default', async () => {
  const { createCompositionLayer } = await loadModule();

  const layer = createCompositionLayer('C:/shot/title.png', {
    id: 'composition_test',
    currentTime: 3.5,
    baseDuration: 4,
    existingNames: ['title.png']
  });

  assert.equal(layer.id, 'composition_test');
  assert.equal(layer.name, 'title 2.png');
  assert.equal(layer.type, 'image');
  assert.equal(layer.startTime, 3.5);
  assert.equal(layer.endTime, 4);
  assert.equal(layer.opacity, 1);
  assert.equal(layer.enabled, true);
  assert.equal(layer.x, 0.25);
  assert.equal(layer.y, 0.25);
  assert.equal(layer.width, 0.5);
  assert.equal(layer.height, 0.5);
  assert.match(layer.color, /^#[0-9a-f]{6}$/);
  assert.match(layer.selectedColor, /^#[0-9a-f]{6}$/);
  assert.notEqual(layer.color, layer.selectedColor);
});

test('assigns different automatic colors by layer order', async () => {
  const { createCompositionLayer, getAutomaticCompositionLayerColors } = await loadModule();

  const first = createCompositionLayer('C:/shot/first.png', { order: 0 });
  const second = createCompositionLayer('C:/shot/second.png', { order: 1 });
  const automatic = getAutomaticCompositionLayerColors(1);

  assert.notEqual(first.color, second.color);
  assert.deepEqual({ color: second.color, selectedColor: second.selectedColor }, automatic);
});

test('derives selected color automatically when the layer color changes', async () => {
  const { CompositionLayerManager, deriveCompositionSelectedColor } = await loadModule();
  const manager = new CompositionLayerManager();

  manager.fromJSON([
    { id: 'a', name: 'A.png', type: 'image', filePath: 'a.png', startTime: 0, endTime: 2, order: 0 }
  ]);

  const updated = manager.updateLayer('a', { color: '#123456' });

  assert.equal(updated.color, '#123456');
  assert.equal(updated.selectedColor, deriveCompositionSelectedColor('#123456'));
});

test('creates video layers at source duration and keeps temporal overflow data', async () => {
  const { createCompositionLayer } = await loadModule();

  const layer = createCompositionLayer('C:/shot/overlay.mov', {
    id: 'composition_video',
    currentTime: 8,
    baseDuration: 10,
    sourceDuration: 7.5
  });

  assert.equal(layer.type, 'video');
  assert.equal(layer.startTime, 8);
  assert.equal(layer.endTime, 15.5);
  assert.equal(layer.sourceDuration, 7.5);
});

test('normalizes persisted layers while preserving offscreen transforms', async () => {
  const { normalizeCompositionLayer } = await loadModule();

  const layer = normalizeCompositionLayer({
    id: 'composition_bad',
    name: '',
    type: 'video',
    filePath: 'C:/shot/overlay.mov',
    enabled: 'yes',
    order: '3',
    startTime: -10,
    endTime: -3,
    opacity: 2,
    x: -0.2,
    y: 1.4,
    width: 0,
    height: -1,
    aspectLocked: false,
    color: '#ABC',
    selectedColor: '#123456',
    sourceDuration: '5'
  });

  assert.equal(layer.name, 'overlay.mov');
  assert.equal(layer.enabled, true);
  assert.equal(layer.order, 3);
  assert.equal(layer.startTime, 0);
  assert.equal(layer.endTime, 0.1);
  assert.equal(layer.opacity, 1);
  assert.equal(layer.x, -0.2);
  assert.equal(layer.y, 1.4);
  assert.equal(layer.width, 0.1);
  assert.equal(layer.height, 0.1);
  assert.equal(layer.aspectLocked, false);
  assert.equal(layer.color, '#aabbcc');
  assert.equal(layer.selectedColor, '#123456');
  assert.equal(layer.sourceDuration, 5);
});

test('serializes aspect lock state with true as the default', async () => {
  const { normalizeCompositionLayer, serializeCompositionLayer } = await loadModule();

  const defaultLayer = normalizeCompositionLayer({
    id: 'default_lock',
    name: 'default.png',
    type: 'image',
    filePath: 'C:/shot/default.png',
    startTime: 0,
    endTime: 2
  });
  const unlocked = serializeCompositionLayer({
    id: 'unlocked',
    name: 'unlocked.png',
    type: 'image',
    filePath: 'C:/shot/unlocked.png',
    startTime: 0,
    endTime: 2,
    aspectLocked: false
  });

  assert.equal(defaultLayer.aspectLocked, true);
  assert.equal(unlocked.aspectLocked, false);
  assert.equal(typeof unlocked.color, 'string');
  assert.equal(typeof unlocked.selectedColor, 'string');
});

test('filters visible layers by time, enabled state, missing state, and order', async () => {
  const { getVisibleCompositionLayers } = await loadModule();
  const layers = [
    { id: 'b', type: 'image', filePath: 'b.png', enabled: true, missing: false, order: 2, startTime: 0, endTime: 5 },
    { id: 'a', type: 'image', filePath: 'a.png', enabled: true, missing: false, order: 1, startTime: 0, endTime: 5 },
    { id: 'disabled', type: 'image', filePath: 'c.png', enabled: false, missing: false, order: 0, startTime: 0, endTime: 5 },
    { id: 'missing', type: 'image', filePath: 'd.png', enabled: true, missing: true, order: 0, startTime: 0, endTime: 5 },
    { id: 'later', type: 'image', filePath: 'e.png', enabled: true, missing: false, order: 0, startTime: 6, endTime: 7 },
    { id: 'converting', type: 'video', filePath: 'f.mov', enabled: true, missing: false, mediaStatus: 'converting', order: 0, startTime: 0, endTime: 5 },
    { id: 'error', type: 'video', filePath: 'g.mov', enabled: true, missing: false, mediaStatus: 'error', order: 0, startTime: 0, endTime: 5 }
  ];

  assert.deepEqual(getVisibleCompositionLayers(layers, 2).map(layer => layer.id), ['a', 'b']);
  assert.deepEqual(getVisibleCompositionLayers(layers, 5).map(layer => layer.id), []);
});

test('reorders layers and reindexes order fields', async () => {
  const { reorderCompositionLayers } = await loadModule();
  const layers = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1 },
    { id: 'c', order: 2 }
  ];

  const reordered = reorderCompositionLayers(layers, 'c', 0);

  assert.deepEqual(reordered.map(layer => [layer.id, layer.order]), [
    ['c', 0],
    ['a', 1],
    ['b', 2]
  ]);
});

test('duplicates a layer next to the source with a unique name and offset transform', async () => {
  const { duplicateCompositionLayer } = await loadModule();
  const layers = [
    { id: 'a', name: 'plate.png', type: 'image', filePath: 'C:/shot/plate.png', order: 0, x: 0.2, y: 0.3, width: 0.4, height: 0.2, startTime: 0, endTime: 2, aspectLocked: false },
    { id: 'b', name: 'plate 2.png', type: 'image', filePath: 'C:/shot/other.png', order: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.3, startTime: 0, endTime: 2 }
  ];

  const result = duplicateCompositionLayer(layers, 'a', { id: 'copy_id' });

  assert.deepEqual(result.map(layer => [layer.id, layer.order]), [
    ['a', 0],
    ['copy_id', 1],
    ['b', 2]
  ]);
  assert.equal(result[1].name, 'plate 3.png');
  assert.equal(result[1].aspectLocked, false);
  assert.equal(result[1].x, 0.23);
  assert.equal(result[1].y, 0.33);
});

test('resizes layer rects with optional aspect lock', async () => {
  const { resizeLayerRect } = await loadModule();
  const layer = { x: 0.2, y: 0.2, width: 0.4, height: 0.2, aspectLocked: true };

  const locked = resizeLayerRect(layer, 'se', 0.2, 0, { overlayWidth: 1000, overlayHeight: 500 });
  const free = resizeLayerRect({ ...layer, aspectLocked: false }, 'se', 0.2, 0, { overlayWidth: 1000, overlayHeight: 500 });

  assert.deepEqual(locked, { x: 0.2, y: 0.2, width: 0.6, height: 0.3 });
  assert.deepEqual(free, { x: 0.2, y: 0.2, width: 0.6, height: 0.2 });
});

test('snaps layer rects to edges and center guides', async () => {
  const { snapCompositionLayerRect } = await loadModule();

  const centered = snapCompositionLayerRect(
    { x: 0.245, y: 0.36, width: 0.5, height: 0.22 },
    { thresholdX: 0.01, thresholdY: 0.02 }
  );
  const rightBottom = snapCompositionLayerRect(
    { x: 0.702, y: 0.801, width: 0.3, height: 0.2 },
    { thresholdX: 0.01, thresholdY: 0.01 }
  );

  assert.deepEqual(centered.rect, { x: 0.25, y: 0.36, width: 0.5, height: 0.22 });
  assert.deepEqual(centered.guides, [{ axis: 'x', position: 0.5 }]);
  assert.deepEqual(rightBottom.rect, { x: 0.7, y: 0.8, width: 0.3, height: 0.2 });
  assert.deepEqual(rightBottom.guides, [
    { axis: 'x', position: 1 },
    { axis: 'y', position: 1 }
  ]);
});

test('moves and resizes timeline ranges with minimum duration protection', async () => {
  const { moveLayerRange, resizeLayerRange } = await loadModule();
  const layer = { id: 'a', startTime: 2, endTime: 5 };

  assert.deepEqual(moveLayerRange(layer, -3), { startTime: 0, endTime: 3 });
  assert.deepEqual(moveLayerRange(layer, 4), { startTime: 6, endTime: 9 });
  assert.deepEqual(resizeLayerRange(layer, 'start', 4.95), { startTime: 4.9, endTime: 5 });
  assert.deepEqual(resizeLayerRange(layer, 'end', 2.01), { startTime: 2, endTime: 2.1 });
});

test('manager keeps one-step undo and redo for layer edits', async () => {
  const { CompositionLayerManager } = await loadModule();
  const manager = new CompositionLayerManager();

  manager.fromJSON([
    { id: 'a', name: 'A', type: 'image', filePath: 'a.png', startTime: 0, endTime: 2, order: 0 }
  ]);
  manager.updateLayer('a', { opacity: 0.25 });
  assert.equal(manager.getLayer('a').opacity, 0.25);

  assert.equal(manager.undo(), true);
  assert.equal(manager.getLayer('a').opacity, 1);

  assert.equal(manager.redo(), true);
  assert.equal(manager.getLayer('a').opacity, 0.25);
});

test('manager duplicates and moves layers by one step', async () => {
  const { CompositionLayerManager } = await loadModule();
  const manager = new CompositionLayerManager();

  manager.fromJSON([
    { id: 'a', name: 'A.png', type: 'image', filePath: 'a.png', startTime: 0, endTime: 2, order: 0 },
    { id: 'b', name: 'B.png', type: 'image', filePath: 'b.png', startTime: 0, endTime: 2, order: 1 }
  ]);

  const duplicate = manager.duplicateLayer('a', { id: 'copy_a' });
  assert.equal(duplicate.id, 'copy_a');
  assert.deepEqual(manager.toJSON().map(layer => layer.id), ['a', 'copy_a', 'b']);

  assert.equal(manager.moveLayerByOffset('copy_a', 1), true);
  assert.deepEqual(manager.toJSON().map(layer => layer.id), ['a', 'b', 'copy_a']);

  assert.equal(manager.selectedLayerId, 'copy_a');
});

test('manager inserts newly added layers as the topmost layer', async () => {
  const { CompositionLayerManager } = await loadModule();
  const manager = new CompositionLayerManager({
    fileExists: async () => true,
    getCurrentTime: () => 0,
    getBaseDuration: () => 10
  });

  const first = await manager.addLayerFromFile('C:/shot/base-title.png');
  const second = await manager.addLayerFromFile('C:/shot/new-overlay.png');

  const saved = manager.toJSON();
  assert.deepEqual(saved.map(layer => [layer.id, layer.order]), [
    [first.id, 0],
    [second.id, 1]
  ]);
  assert.equal(manager.selectedLayerId, second.id);
  assert.deepEqual(manager.getMpvOverlayLayers({ currentTime: 1 }).map(layer => layer.id), [first.id, second.id]);
});

test('manager reorders layers by visual display target placement', async () => {
  const { CompositionLayerManager } = await loadModule();
  const manager = new CompositionLayerManager();

  manager.fromJSON([
    { id: 'bottom', name: 'Bottom.png', type: 'image', filePath: 'bottom.png', startTime: 0, endTime: 2, order: 0 },
    { id: 'middle', name: 'Middle.png', type: 'image', filePath: 'middle.png', startTime: 0, endTime: 2, order: 1 },
    { id: 'top', name: 'Top.png', type: 'image', filePath: 'top.png', startTime: 0, endTime: 2, order: 2 }
  ]);

  assert.equal(manager.reorderLayerByDisplayTarget('bottom', 'top', 'before'), true);
  assert.deepEqual(manager.toJSON().map(layer => layer.id), ['middle', 'top', 'bottom']);

  assert.equal(manager.reorderLayerByDisplayTarget('bottom', 'top', 'after'), true);
  assert.deepEqual(manager.toJSON().map(layer => layer.id), ['middle', 'bottom', 'top']);
});

test('manager relinks missing layers through the existing file dialog', async () => {
  const { CompositionLayerManager } = await loadModule();
  const manager = new CompositionLayerManager({
    openFileDialog: async () => ({ canceled: false, filePaths: ['C:/shot/relinked.webm'] }),
    fileExists: async () => true
  });

  manager.fromJSON([
    { id: 'missing', name: 'Missing', type: 'image', filePath: 'C:/old/missing.png', startTime: 0, endTime: 2, order: 0, missing: true }
  ]);

  const layer = await manager.relinkLayerFile('missing');

  assert.equal(layer.filePath, 'C:/shot/relinked.webm');
  assert.equal(layer.type, 'video');
  assert.equal(layer.missing, false);
});

test('manager prepares runtime display media without serializing it', async () => {
  const { CompositionLayerManager } = await loadModule();
  const manager = new CompositionLayerManager({
    prepareMedia: async (filePath) => ({
      status: 'ready',
      filePath: filePath.replace('overlay.mov', 'overlay-converted.mp4'),
      message: 'cached'
    })
  });

  manager.fromJSON([
    { id: 'video', name: 'Overlay', type: 'video', filePath: 'C:/shot/overlay.mov', startTime: 0, endTime: 2, order: 0 }
  ]);

  const layer = await manager.prepareLayerMedia('video');
  const saved = manager.toJSON()[0];
  const mpvLayer = manager.getMpvOverlayLayers({ currentTime: 1, isPlaying: false })[0];

  assert.equal(layer.mediaStatus, 'ready');
  assert.equal(layer.mediaMessage, 'cached');
  assert.equal(layer.displayFilePath, 'C:/shot/overlay-converted.mp4');
  assert.equal(saved.filePath, 'C:/shot/overlay.mov');
  assert.equal(saved.displayFilePath, undefined);
  assert.match(mpvLayer.fileUrl, /overlay-converted\.mp4/);
});
