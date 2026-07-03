const { test } = require('node:test');
const assert = require('node:assert/strict');

let partitionDrawingLayersForActive;

test('drawing manager partition helper loads', async () => {
  ({ partitionDrawingLayersForActive } = await import('../../renderer/scripts/modules/drawing-manager.js'));
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
