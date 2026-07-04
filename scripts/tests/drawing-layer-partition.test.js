const { test } = require('node:test');
const assert = require('node:assert/strict');

global.window = global.window || {};
global.window.logPanel = null;
global.window.electronAPI = null;

let partitionDrawingLayersForActive;
let DrawingLayer;
let Keyframe;

test('drawing manager partition helper loads', async () => {
  ({ partitionDrawingLayersForActive } = await import('../../renderer/scripts/modules/drawing-manager.js'));
  ({ DrawingLayer, Keyframe } = await import('../../renderer/scripts/modules/drawing-layer.js'));
});

function layer(id) {
  return { id };
}

function ids(layers) {
  return layers.map(item => item.id);
}

test('partition splits layers below active layer and above active layer', () => {
  const layers = [layer('layer-1'), layer('layer-2'), layer('layer-3')];
  const result = partitionDrawingLayersForActive(layers, 'layer-2');

  assert.deepEqual(ids(result.below), ['layer-1']);
  assert.equal(result.active.id, 'layer-2');
  assert.deepEqual(ids(result.above), ['layer-3']);
});

test('partition keeps all higher layers above when active layer is first', () => {
  const layers = [layer('layer-1'), layer('layer-2'), layer('layer-3')];
  const result = partitionDrawingLayersForActive(layers, 'layer-1');

  assert.deepEqual(ids(result.below), []);
  assert.equal(result.active.id, 'layer-1');
  assert.deepEqual(ids(result.above), ['layer-2', 'layer-3']);
});

test('partition keeps all lower layers below when active layer is last', () => {
  const layers = [layer('layer-1'), layer('layer-2'), layer('layer-3')];
  const result = partitionDrawingLayersForActive(layers, 'layer-3');

  assert.deepEqual(ids(result.below), ['layer-1', 'layer-2']);
  assert.equal(result.active.id, 'layer-3');
  assert.deepEqual(ids(result.above), []);
});

test('partition treats every layer as static when active layer is missing', () => {
  const layers = [layer('layer-1'), layer('layer-2')];
  const result = partitionDrawingLayersForActive(layers, 'missing-layer');

  assert.deepEqual(ids(result.below), ['layer-1', 'layer-2']);
  assert.equal(result.active, null);
  assert.deepEqual(ids(result.above), []);
});

test('deleteFrame shortens a tail-held final keyframe by adding a blank boundary', () => {
  const drawingLayer = new DrawingLayer({ id: 'layer-tail', name: 'Tail' });
  drawingLayer.keyframes = [new Keyframe(10, 'tail-content')];

  drawingLayer.deleteFrame(10, 15);

  assert.deepEqual(drawingLayer.keyframes.map(kf => [kf.frame, kf.canvasData]), [
    [10, 'tail-content'],
    [14, null]
  ]);

  const ranges = drawingLayer.getKeyframeRanges(15);
  assert.deepEqual(ranges.map(range => [range.start, range.end, range.keyframe.canvasData]), [
    [10, 13, 'tail-content'],
    [14, 14, null]
  ]);
});

test('deleteFrame shortens an ordinary frame in the final held range', () => {
  const drawingLayer = new DrawingLayer({ id: 'layer-tail-held', name: 'Tail Held' });
  drawingLayer.keyframes = [new Keyframe(10, 'tail-content')];

  drawingLayer.deleteFrame(12, 15);

  assert.deepEqual(drawingLayer.keyframes.map(kf => [kf.frame, kf.canvasData]), [
    [10, 'tail-content'],
    [14, null]
  ]);
});

test('deleteFrame removes a one-frame keyframe when the next keyframe starts immediately', () => {
  const drawingLayer = new DrawingLayer({ id: 'layer-adjacent', name: 'Adjacent' });
  drawingLayer.keyframes = [
    new Keyframe(10, 'one-frame'),
    new Keyframe(11, 'next-frame')
  ];

  drawingLayer.deleteFrame(10, 20);

  assert.deepEqual(drawingLayer.keyframes.map(kf => [kf.frame, kf.canvasData]), [
    [10, 'next-frame']
  ]);
});
