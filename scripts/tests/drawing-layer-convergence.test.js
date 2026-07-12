const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setMaxListeners } = require('node:events');

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

class FakeCanvas extends EventTarget {
  constructor() {
    super();
    this.width = 1;
    this.height = 1;
  }

  getContext() {
    return {
      clearRect() {},
      drawImage() {},
      getImageData: () => ({ width: this.width, height: this.height }),
      putImageData() {}
    };
  }
}

class FakeLiveblocksManager extends EventTarget {
  constructor(actorId = null) {
    super();
    this.events = [];
    this.actorId = actorId;
  }

  broadcastEvent(event) {
    this.events.push(event);
  }

  hasOtherCollaborators() {
    return true;
  }

  getSelf() {
    return this.actorId ? { connectionId: this.actorId } : null;
  }

  receive(event) {
    this.dispatchEvent(new TestCustomEvent('broadcastReceived', { detail: { event } }));
  }
}

global.CustomEvent = global.CustomEvent || TestCustomEvent;
global.window = global.window || new EventTarget();
global.window.logPanel = null;
global.window.electronAPI = null;
global.document = global.document || new EventTarget();
global.document.createElement = () => new FakeCanvas();
setMaxListeners(0, global.window, global.document);

async function createPeer({ includeAnchor = true, actorId = null } = {}) {
  const [{ DrawingManager }, { DrawingSync }] = await Promise.all([
    import('../../renderer/scripts/modules/drawing-manager.js'),
    import('../../renderer/scripts/modules/drawing-sync.js')
  ]);
  const manager = new DrawingManager({ canvas: new FakeCanvas() });
  manager.renderFrame = () => {};
  manager.commitActiveSelection = () => {};
  if (includeAnchor) {
    manager.createLayer({ id: 'anchor', name: 'Anchor' }, false);
    manager.activeLayerId = 'anchor';
  }

  const liveblocks = new FakeLiveblocksManager(actorId);
  const sync = new DrawingSync({ liveblocksManager: liveblocks, drawingManager: manager, actorId });
  sync.start();
  return { manager, liveblocks, sync };
}

test('concurrent layers created before the same anchor converge regardless of event order', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();

  peerA.manager.createLayer({
    id: 'layer-peer-a',
    name: 'A',
    insertBeforeLayerId: 'anchor',
    insertIndex: 0
  });
  peerB.manager.createLayer({
    id: 'layer-peer-b',
    name: 'B',
    insertBeforeLayerId: 'anchor',
    insertIndex: 0
  });

  const eventA = peerA.liveblocks.events.at(-1);
  const eventB = peerB.liveblocks.events.at(-1);
  peerA.liveblocks.receive(eventB);
  peerB.liveblocks.receive(eventA);

  assert.equal(eventA.insertBeforeLayerId, 'anchor');
  assert.equal(eventB.insertBeforeLayerId, 'anchor');
  assert.deepEqual(
    peerA.manager.layers.map(layer => layer.id),
    peerB.manager.layers.map(layer => layer.id)
  );
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), [
    'layer-peer-a',
    'layer-peer-b',
    'anchor'
  ]);

  peerA.sync.stop();
  peerB.sync.stop();
});

test('new layer ids remain unique even when peers start from the same legacy counter state', async () => {
  const { DrawingLayer } = await import('../../renderer/scripts/modules/drawing-layer.js');

  DrawingLayer.resetNextId();
  const peerAId = new DrawingLayer().id;
  DrawingLayer.resetNextId();
  const peerBId = new DrawingLayer().id;

  assert.notEqual(peerAId, peerBId);
});

test('siblings converge before a missing anchor and move directly before it when it arrives', async () => {
  const peerA = await createPeer({ includeAnchor: false });
  const peerB = await createPeer({ includeAnchor: false });
  const layerA = {
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    insertBeforeLayerId: 'late-anchor',
    layer: { id: 'layer-a', name: 'A' }
  };
  const layerB = {
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    insertBeforeLayerId: 'late-anchor',
    layer: { id: 'layer-b', name: 'B' }
  };

  peerA.liveblocks.receive(layerA);
  peerA.liveblocks.receive(layerB);
  peerB.liveblocks.receive(layerB);
  peerB.liveblocks.receive(layerA);

  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['layer-a', 'layer-b']);
  assert.deepEqual(peerB.manager.layers.map(layer => layer.id), ['layer-a', 'layer-b']);

  const anchor = {
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    layer: { id: 'late-anchor', name: 'Anchor' }
  };
  peerA.liveblocks.receive(anchor);
  peerB.liveblocks.receive(anchor);

  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['layer-a', 'layer-b', 'late-anchor']);
  assert.deepEqual(peerB.manager.layers.map(layer => layer.id), ['layer-a', 'layer-b', 'late-anchor']);
});

test('deleted anchor tombstone keeps delayed siblings convergent and rejects delayed anchor creation', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  const deleted = { type: 'DRAWING_LAYER_DELETED', layerId: 'anchor' };
  const layerA = {
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    insertBeforeLayerId: 'anchor',
    layer: { id: 'layer-a', name: 'A' }
  };
  const layerB = {
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    insertBeforeLayerId: 'anchor',
    layer: { id: 'layer-b', name: 'B' }
  };

  peerA.liveblocks.receive(deleted);
  peerB.liveblocks.receive(deleted);
  peerA.liveblocks.receive(layerA);
  peerA.liveblocks.receive(layerB);
  peerB.liveblocks.receive(layerB);
  peerB.liveblocks.receive(layerA);

  const delayedAnchor = {
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    layer: { id: 'anchor', name: 'Anchor' }
  };
  peerA.liveblocks.receive(delayedAnchor);
  peerB.liveblocks.receive(delayedAnchor);

  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['layer-a', 'layer-b']);
  assert.deepEqual(peerB.manager.layers.map(layer => layer.id), ['layer-a', 'layer-b']);
});

test('manual reorder clears stale anchors and current-state round-trip preserves visible order', async () => {
  const sender = await createPeer();
  sender.manager.createLayer({
    id: 'layer-old',
    name: 'Old',
    insertBeforeLayerId: 'anchor',
    insertIndex: 0
  });
  sender.manager.moveActiveLayerByOffset(1);
  sender.manager.setActiveLayer('anchor');
  sender.manager.createLayer({
    id: 'layer-new',
    name: 'New',
    insertBeforeLayerId: 'anchor',
    insertIndex: 0
  });

  assert.deepEqual(sender.manager.layers.map(layer => layer.id), [
    'layer-new',
    'anchor',
    'layer-old'
  ]);

  sender.liveblocks.events.length = 0;
  sender.sync.broadcastCurrentState();
  const receiver = await createPeer({ includeAnchor: false });
  for (const event of sender.liveblocks.events) {
    receiver.liveblocks.receive(event);
  }

  assert.deepEqual(
    receiver.manager.layers.map(layer => layer.id),
    sender.manager.layers.map(layer => layer.id)
  );
});

test('current-state seed sends bounded legacy preview before exact chunk convergence', async () => {
  const sender = await createPeer({ actorId: 'actor-state-seed' });
  sender.manager.createLayer({ id: 'state-seed-secondary', name: 'Secondary' }, false);
  const layer = sender.manager.layers.find(item => item.id === 'anchor');
  const originalCanvasData = `data:image/png;base64,${'q'.repeat(1024 * 1024 + 64)}`;
  const reducedCanvasData = 'data:image/png;base64,reduced-legacy-preview';
  const keyframe = layer.getOrCreateKeyframe(27);
  keyframe.setCanvasData(originalCanvasData);
  keyframe.baseCanvasData = 'state-seed-base';
  keyframe.strokeRecords = [{
    id: 'state-seed-stroke',
    tool: 'pen',
    points: [{ x: 7, y: 8 }],
    color: '#abcdef',
    lineWidth: 4,
    opacity: 0.75,
    strokeEnabled: false,
    strokeWidth: 0,
    strokeColor: '#ffffff'
  }];
  sender.sync._reduceCanvasData = async () => reducedCanvasData;
  sender.liveblocks.events.length = 0;

  sender.sync.broadcastCurrentState();
  await sender.sync.waitForPendingBroadcasts();

  const events = sender.liveblocks.events;
  const layerEventIndexes = events
    .map((event, index) => event.type === 'DRAWING_LAYER_CREATED' ? index : -1)
    .filter(index => index >= 0);
  const previewEventIndex = events.findIndex(event => (
    event.type === 'DRAWING_KEYFRAME_UPDATE' && event.frame === 27
  ));
  const firstChunkIndex = events.findIndex(event => (
    event.type === 'DRAWING_KEYFRAME_CHUNK' && event.frame === 27
  ));
  const orderEventIndex = events.findIndex(event => event.type === 'DRAWING_LAYER_ORDER_CHANGED');
  assert.equal(layerEventIndexes.length, 2);
  assert.ok(Math.max(...layerEventIndexes) < previewEventIndex);
  assert.ok(previewEventIndex < firstChunkIndex);
  assert.equal(orderEventIndex, events.length - 1);
  assert.equal(events[previewEventIndex].canvasData, reducedCanvasData);
  for (const event of events) {
    assert.ok(
      new TextEncoder().encode(JSON.stringify(event)).byteLength < 1024 * 1024,
      `${event.type} must stay below broadcast limit`
    );
  }

  const legacyKeyframes = new Map();
  for (const event of events) {
    if (event.type === 'DRAWING_KEYFRAME_UPDATE') {
      legacyKeyframes.set(event.frame, event.canvasData);
    }
  }
  assert.equal(legacyKeyframes.get(27), reducedCanvasData);

  const receiver = await createPeer({ includeAnchor: false, actorId: 'actor-state-receiver' });
  receiver.liveblocks.events.length = 0;
  for (const event of events) receiver.liveblocks.receive(event);
  const received = receiver.manager.layers
    .find(item => item.id === 'anchor')
    .getKeyframeAtFrame(27);
  assert.equal(received.canvasData, originalCanvasData);
  assert.equal(received.baseCanvasData, 'state-seed-base');
  assert.deepEqual(received.strokeRecords, keyframe.strokeRecords);
  assert.deepEqual(receiver.liveblocks.events, []);
});

test('current-state seed continues after one keyframe failure and sends order last', async () => {
  const sender = await createPeer({ actorId: 'actor-state-continuation' });
  const layer = sender.manager.layers.find(item => item.id === 'anchor');
  layer.getOrCreateKeyframe(31).setCanvasData('will-fail');
  layer.getOrCreateKeyframe(32).setCanvasData('will-continue');
  const broadcastKeyframeUpdate = sender.sync._broadcastKeyframeUpdate.bind(sender.sync);
  sender.sync._broadcastKeyframeUpdate = async (targetLayer, keyframe) => {
    if (keyframe.frame === 31) throw new Error('expected state seed failure');
    return broadcastKeyframeUpdate(targetLayer, keyframe);
  };
  sender.liveblocks.events.length = 0;

  sender.sync.broadcastCurrentState();
  await sender.sync.waitForPendingBroadcasts();

  assert.equal(sender.liveblocks.events.some(event => (
    event.type === 'DRAWING_KEYFRAME_UPDATE'
      && event.frame === 31
  )), false);
  assert.equal(sender.liveblocks.events.some(event => (
    event.type === 'DRAWING_KEYFRAME_UPDATE'
      && event.frame === 32
      && event.canvasData === 'will-continue'
  )), true);
  assert.equal(sender.liveblocks.events.at(-1).type, 'DRAWING_LAYER_ORDER_CHANGED');
});

test('current-state seed restores a live layer over a stale deletion tombstone', async () => {
  const sender = await createPeer({ actorId: 'actor-state-sender' });
  const receiver = await createPeer({ actorId: 'actor-state-receiver' });
  sender.manager.layers[0].getOrCreateKeyframe(33).setCanvasData('restored-state-data');
  receiver.liveblocks.receive({ type: 'DRAWING_LAYER_DELETED', layerId: 'anchor' });
  assert.equal(receiver.manager.isLayerDeleted('anchor'), true);
  sender.liveblocks.events.length = 0;

  await sender.sync.broadcastCurrentState();
  for (const event of sender.liveblocks.events) receiver.liveblocks.receive(event);

  const restored = receiver.manager.layers.find(layer => layer.id === 'anchor');
  assert.ok(restored);
  assert.equal(receiver.manager.isLayerDeleted('anchor'), false);
  assert.equal(restored.getKeyframeAtFrame(33)?.canvasData, 'restored-state-data');
});

test('stopped current-state seed cannot broadcast old keyframes after restart', async () => {
  const peer = await createPeer({ actorId: 'actor-state-cancel' });
  const layer = peer.manager.layers.find(item => item.id === 'anchor');
  layer.getOrCreateKeyframe(41).setCanvasData(
    `data:image/png;base64,${'x'.repeat(1024 * 1024 + 64)}`
  );
  let releaseReduction;
  let reductionStarted;
  const started = new Promise(resolve => { reductionStarted = resolve; });
  peer.sync._reduceCanvasData = async () => {
    reductionStarted();
    return new Promise(resolve => { releaseReduction = resolve; });
  };
  peer.liveblocks.events.length = 0;

  const seed = peer.sync.broadcastCurrentState();
  await started;
  peer.sync.stop();
  const eventCountAtStop = peer.liveblocks.events.length;
  peer.sync.start();
  releaseReduction('reduced-preview');
  await seed;

  assert.equal(peer.liveblocks.events.length, eventCountAtStop);
  assert.equal(peer.liveblocks.events.some(event => (
    event.type === 'DRAWING_KEYFRAME_UPDATE' || event.type === 'DRAWING_KEYFRAME_CHUNK'
  )), false);
});

test('stopped layer restore cannot finish broadcasting into a restarted session', async () => {
  const peer = await createPeer({ actorId: 'actor-restore-cancel' });
  const layer = peer.manager.layers.find(item => item.id === 'anchor');
  layer.getOrCreateKeyframe(42).setCanvasData(
    `data:image/png;base64,${'y'.repeat(1024 * 1024 + 64)}`
  );
  let releaseReduction;
  let reductionStarted;
  const started = new Promise(resolve => { reductionStarted = resolve; });
  peer.sync._reduceCanvasData = async () => {
    reductionStarted();
    return new Promise(resolve => { releaseReduction = resolve; });
  };
  peer.liveblocks.events.length = 0;

  const restore = peer.sync._broadcastRestoredLayer(layer, 0);
  await started;
  peer.sync.stop();
  const eventCountAtStop = peer.liveblocks.events.length;
  peer.sync.start();
  releaseReduction('reduced-preview');
  await restore;

  assert.equal(peer.liveblocks.events.length, eventCountAtStop);
  assert.equal(peer.liveblocks.events.some(event => (
    event.type === 'DRAWING_KEYFRAME_UPDATE'
      || event.type === 'DRAWING_KEYFRAME_CHUNK'
      || event.type === 'DRAWING_LAYER_ORDER_CHANGED'
  )), false);
});

test('layer id generation fails explicitly when Web Crypto is unavailable', async () => {
  const { DrawingLayer } = await import('../../renderer/scripts/modules/drawing-layer.js');
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    assert.throws(() => new DrawingLayer(), /Web Crypto/);
  } finally {
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});

test('local deletion snapshots an existing layer before recording its tombstone', async () => {
  const peer = await createPeer();
  const snapshots = [];
  const undoActions = [];
  const createSnapshot = peer.manager._createSnapshot.bind(peer.manager);
  peer.manager._createSnapshot = () => {
    const snapshot = createSnapshot();
    snapshots.push(snapshot);
    return snapshot;
  };
  peer.manager._onUndoPush = action => undoActions.push(action);

  peer.manager.deleteLayer('anchor');

  assert.deepEqual(snapshots[0].deletedLayerIds, []);
  assert.equal(peer.manager.isLayerDeleted('anchor'), true);
  await undoActions[0].undo();
  assert.equal(peer.manager.layers.some(layer => layer.id === 'anchor'), true);
  assert.equal(peer.manager.isLayerDeleted('anchor'), false);
});

test('remote deletion does not push into local undo history', async () => {
  const peer = await createPeer();
  const undoActions = [];
  peer.manager._onUndoPush = action => undoActions.push(action);

  peer.liveblocks.receive({ type: 'DRAWING_LAYER_DELETED', layerId: 'anchor' });

  assert.deepEqual(undoActions, []);
  assert.equal(peer.manager.isLayerDeleted('anchor'), true);
});

test('remote deletion records a tombstone when the layer is already missing', async () => {
  const peer = await createPeer({ includeAnchor: false });

  peer.liveblocks.receive({ type: 'DRAWING_LAYER_DELETED', layerId: 'missing-layer' });

  assert.equal(peer.manager.isLayerDeleted('missing-layer'), true);
});

test('local delete undo redo converges both peers without dropping restored keyframes', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);
  const anchorA = peerA.manager.layers.find(layer => layer.id === 'anchor');
  const anchorB = peerB.manager.layers.find(layer => layer.id === 'anchor');
  anchorA.addBlankKeyframe(7);
  anchorB.addBlankKeyframe(7);
  peerA.liveblocks.events.length = 0;

  peerA.manager.deleteLayer('anchor');
  const redoSnapshot = peerA.manager._createSnapshot();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
  assert.deepEqual([...peerA.manager._deletedLayerIds], [...peerB.manager._deletedLayerIds]);
  assert.equal(peerB.manager.isLayerDeleted('anchor'), true);

  await undoActions[0].undo();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
  assert.deepEqual([...peerA.manager._deletedLayerIds], [...peerB.manager._deletedLayerIds]);
  assert.equal(peerB.manager.isLayerDeleted('anchor'), false);
  assert.equal(peerB.manager.layers[0].keyframes[0].frame, 7);
  assert.equal(peerB.manager.layers[0].keyframes[0].isEmpty, true);

  peerA.manager._restoreSnapshot(redoSnapshot, {
    actionMetadata: undoActions[0].drawingAction,
    direction: 'redo'
  });
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
  assert.deepEqual([...peerA.manager._deletedLayerIds], [...peerB.manager._deletedLayerIds]);
  assert.equal(peerA.manager.isLayerDeleted('anchor'), true);
  assert.equal(peerB.manager.isLayerDeleted('anchor'), true);
});

test('remote restore preserves an unrelated concurrent layer', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);
  peerA.liveblocks.events.length = 0;

  peerA.manager.deleteLayer('anchor');
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  peerB.liveblocks.events.length = 0;
  peerB.manager.createLayer({ id: 'unrelated', name: 'Unrelated' }, false);
  for (const event of peerB.liveblocks.events.splice(0)) peerA.liveblocks.receive(event);

  await undoActions[0].undo();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  assert.equal(peerB.manager.layers.some(layer => layer.id === 'anchor'), true);
  assert.equal(peerB.manager.layers.some(layer => layer.id === 'unrelated'), true);
  assert.equal(peerA.manager.layers.some(layer => layer.id === 'unrelated'), true);
});

test('unrelated drawing undo does not resurrect a remotely deleted layer', async () => {
  const peer = await createPeer();
  peer.manager.createLayer({ id: 'editable', name: 'Editable' }, false);
  peer.manager.activeLayerId = 'editable';
  const undoActions = [];
  peer.manager._onUndoPush = action => undoActions.push(action);
  peer.liveblocks.events.length = 0;

  peer.manager.addBlankKeyframe();
  peer.liveblocks.receive({ type: 'DRAWING_LAYER_DELETED', layerId: 'anchor' });
  peer.liveblocks.events.length = 0;
  await undoActions[0].undo();

  assert.equal(peer.manager.layers.some(layer => layer.id === 'anchor'), false);
  assert.equal(
    peer.liveblocks.events.some(event => (
      event.type === 'DRAWING_LAYER_RESTORED' && event.layer?.id === 'anchor'
    )),
    false
  );
  assert.equal(
    peer.liveblocks.events.some(event => event.type === 'DRAWING_LAYER_DELETED'),
    false
  );
});

test('local create undo redo converges action target only', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);
  peerA.liveblocks.events.length = 0;

  peerA.manager.createLayer({ id: 'created', name: 'Created' });
  const redoSnapshot = peerA.manager._createSnapshot();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  await undoActions[0].undo();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.equal(peerA.manager.layers.some(layer => layer.id === 'created'), false);
  assert.equal(peerB.manager.layers.some(layer => layer.id === 'created'), false);

  peerA.manager._restoreSnapshot(redoSnapshot, {
    actionMetadata: undoActions[0].drawingAction,
    direction: 'redo'
  });
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
  assert.equal(peerB.manager.layers.some(layer => layer.id === 'created'), true);
});

test('local order undo redo converges through action-scoped order delta', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  for (const peer of [peerA, peerB]) {
    peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
    peer.manager.activeLayerId = 'anchor';
    peer.liveblocks.events.length = 0;
  }
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);

  peerA.manager.moveActiveLayerByOffset(1);
  const redoSnapshot = peerA.manager._createSnapshot();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  await undoActions[0].undo();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['anchor', 'second']);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));

  peerA.manager._restoreSnapshot(redoSnapshot, {
    actionMetadata: undoActions[0].drawingAction,
    direction: 'redo'
  });
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['second', 'anchor']);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
});

test('delete undo redo preserves current non-target object and remote keyframe data', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  for (const peer of [peerA, peerB]) {
    peer.manager.createLayer({ id: 'other', name: 'Other' }, false);
    peer.manager.activeLayerId = 'anchor';
    peer.liveblocks.events.length = 0;
  }
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);
  const otherA = peerA.manager.layers.find(layer => layer.id === 'other');

  peerA.manager.deleteLayer('anchor');
  const redoSnapshot = peerA.manager._createSnapshot();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  const otherB = peerB.manager.layers.find(layer => layer.id === 'other');
  const remoteKeyframe = otherB.getOrCreateKeyframe(3);
  remoteKeyframe.setCanvasData('remote-keyframe-data');
  peerA.liveblocks.receive({
    type: 'DRAWING_KEYFRAME_UPDATE',
    layerId: 'other',
    frame: 3,
    canvasData: 'remote-keyframe-data',
    baseCanvasData: null,
    strokeRecords: [],
    isEmpty: false
  });

  await undoActions[0].undo();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.equal(peerA.manager.layers.find(layer => layer.id === 'other'), otherA);
  assert.equal(otherA.getKeyframeAtFrame(3).canvasData, 'remote-keyframe-data');
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));

  peerA.manager._restoreSnapshot(redoSnapshot, {
    actionMetadata: undoActions[0].drawingAction,
    direction: 'redo'
  });
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.equal(peerA.manager.layers.find(layer => layer.id === 'other'), otherA);
  assert.equal(otherA.getKeyframeAtFrame(3).canvasData, 'remote-keyframe-data');
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
});

test('order undo redo preserves current objects and remote keyframe data', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  for (const peer of [peerA, peerB]) {
    peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
    peer.manager.activeLayerId = 'anchor';
    peer.liveblocks.events.length = 0;
  }
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);
  const secondA = peerA.manager.layers.find(layer => layer.id === 'second');

  peerA.manager.moveActiveLayerByOffset(1);
  const redoSnapshot = peerA.manager._createSnapshot();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  const secondB = peerB.manager.layers.find(layer => layer.id === 'second');
  const remoteKeyframe = secondB.getOrCreateKeyframe(4);
  remoteKeyframe.setCanvasData('remote-order-data');
  peerA.liveblocks.receive({
    type: 'DRAWING_KEYFRAME_UPDATE',
    layerId: 'second',
    frame: 4,
    canvasData: 'remote-order-data',
    baseCanvasData: null,
    strokeRecords: [],
    isEmpty: false
  });

  await undoActions[0].undo();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.equal(peerA.manager.layers.find(layer => layer.id === 'second'), secondA);
  assert.equal(secondA.getKeyframeAtFrame(4).canvasData, 'remote-order-data');
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));

  peerA.manager._restoreSnapshot(redoSnapshot, {
    actionMetadata: undoActions[0].drawingAction,
    direction: 'redo'
  });
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.equal(peerA.manager.layers.find(layer => layer.id === 'second'), secondA);
  assert.equal(secondA.getKeyframeAtFrame(4).canvasData, 'remote-order-data');
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
});

test('manual layer move broadcasts order and converges existing peer objects', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  for (const peer of [peerA, peerB]) {
    peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
    peer.manager.activeLayerId = 'anchor';
    peer.liveblocks.events.length = 0;
  }

  const originalAnchorB = peerB.manager.layers.find(layer => layer.id === 'anchor');
  peerA.manager.moveActiveLayerByOffset(1);
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['second', 'anchor']);
  assert.deepEqual(peerB.manager.layers.map(layer => layer.id), ['second', 'anchor']);
  assert.equal(peerB.manager.layers[1], originalAnchorB);
  assert.deepEqual(peerB.liveblocks.events, []);
});

test('current-state broadcast corrects existing receiver order and preserves unknown layers', async () => {
  const peerA = await createPeer();
  const peerB = await createPeer();
  peerA.manager.createLayer({ id: 'second', name: 'Second' }, false);
  peerB.manager.createLayer({ id: 'second', name: 'Second' }, false);
  peerB.manager.createLayer({ id: 'unknown', name: 'Unknown', insertIndex: 1 }, false);
  peerA.manager.layers.reverse();
  peerA.liveblocks.events.length = 0;

  peerA.sync.broadcastCurrentState();
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);

  assert.deepEqual(peerB.manager.layers.map(layer => layer.id), ['second', 'unknown', 'anchor']);
});

test('simultaneous layer orders converge by Lamport clock and actor tie-break', async () => {
  const peerA = await createPeer({ actorId: 'actor-a' });
  const peerB = await createPeer({ actorId: 'actor-b' });
  for (const peer of [peerA, peerB]) {
    peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
    peer.manager.createLayer({ id: 'third', name: 'Third' }, false);
    peer.liveblocks.events.length = 0;
  }

  peerA.manager.activeLayerId = 'anchor';
  peerA.manager.moveActiveLayerByOffset(1);
  const orderA = peerA.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_ORDER_CHANGED');

  peerB.manager.activeLayerId = 'third';
  peerB.manager.moveActiveLayerByOffset(-1);
  const orderB = peerB.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_ORDER_CHANGED');

  assert.deepEqual(orderA.version, { clock: 1, actorId: 'actor-a' });
  assert.deepEqual(orderB.version, { clock: 1, actorId: 'actor-b' });
  peerA.liveblocks.receive(orderB);
  peerB.liveblocks.receive(orderA);

  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['anchor', 'third', 'second']);
  assert.deepEqual(
    peerA.manager.layers.map(layer => layer.id),
    peerB.manager.layers.map(layer => layer.id)
  );

  peerA.liveblocks.receive(orderA);
  peerA.liveblocks.receive(orderB);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), ['anchor', 'third', 'second']);
});

test('layer order waits for a referenced layer and applies when that layer arrives', async () => {
  const peer = await createPeer({ actorId: 'actor-receiver' });
  peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
  peer.liveblocks.events.length = 0;

  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_ORDER_CHANGED',
    layerIds: ['late-layer', 'anchor', 'second'],
    version: { clock: 7, actorId: 'actor-sender' }
  });

  assert.deepEqual(peer.manager.layers.map(layer => layer.id), ['anchor', 'second']);
  assert.deepEqual(peer.sync._lastAppliedOrderVersion, { clock: 0, actorId: '' });

  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 2,
    layer: { id: 'late-layer', name: 'Late Layer' }
  });

  assert.deepEqual(peer.manager.layers.map(layer => layer.id), ['late-layer', 'anchor', 'second']);
  assert.deepEqual(peer.sync._lastAppliedOrderVersion, { clock: 7, actorId: 'actor-sender' });
});

test('pending layer order completes when a missing layer is learned to be deleted', async () => {
  const peer = await createPeer({ actorId: 'actor-receiver' });
  peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
  peer.liveblocks.events.length = 0;

  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_ORDER_CHANGED',
    layerIds: ['anchor', 'deleted-before-arrival', 'second'],
    version: { clock: 8, actorId: 'actor-sender' }
  });
  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_DELETED',
    layerId: 'deleted-before-arrival'
  });

  assert.equal(peer.sync._pendingRemoteLayerOrder, null);
  assert.deepEqual(peer.sync._lastAppliedOrderVersion, { clock: 8, actorId: 'actor-sender' });
});

test('partial remote order preserves an omitted layer anchor until its anchor arrives', async () => {
  const peer = await createPeer({ includeAnchor: false, actorId: 'actor-receiver' });
  for (const layer of [
    { id: 'known-a', name: 'Known A' },
    { id: 'known-b', name: 'Known B' },
    { id: 'waiting-x', name: 'Waiting X', insertBeforeLayerId: 'late-z' }
  ]) {
    peer.liveblocks.receive({
      type: 'DRAWING_LAYER_CREATED',
      insertBeforeLayerId: layer.insertBeforeLayerId,
      layer
    });
  }

  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_ORDER_CHANGED',
    layerIds: ['known-b', 'known-a'],
    version: { clock: 9, actorId: 'actor-sender' }
  });
  assert.equal(peer.manager.getLayerInsertBeforeId('waiting-x'), 'late-z');

  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_CREATED',
    insertIndex: 0,
    layer: { id: 'late-z', name: 'Late Z' }
  });

  const ids = peer.manager.layers.map(layer => layer.id);
  assert.equal(ids.indexOf('waiting-x') + 1, ids.indexOf('late-z'));
});

test('applied remote order emits one persistence-facing order event', async () => {
  const peer = await createPeer({ actorId: 'actor-receiver' });
  peer.manager.createLayer({ id: 'second', name: 'Second' }, false);
  let orderEventCount = 0;
  peer.manager.addEventListener('layerOrderChanged', () => { orderEventCount += 1; });

  peer.liveblocks.receive({
    type: 'DRAWING_LAYER_ORDER_CHANGED',
    layerIds: ['second', 'anchor'],
    version: { clock: 10, actorId: 'actor-sender' }
  });

  assert.equal(orderEventCount, 1);
  assert.deepEqual(peer.liveblocks.events.filter(event => (
    event.type === 'DRAWING_LAYER_ORDER_CHANGED'
  )), []);
});

test('restore emits legacy create and keyframe fallbacks for old receivers', async () => {
  const peer = await createPeer({ actorId: 'actor-new' });
  const undoActions = [];
  peer.manager._onUndoPush = action => undoActions.push(action);
  const layer = peer.manager.layers.find(item => item.id === 'anchor');
  layer.locked = true;
  const keyframe = layer.getOrCreateKeyframe(9);
  keyframe.setCanvasData('legacy-restore-data');
  peer.liveblocks.events.length = 0;

  peer.manager.deleteLayer('anchor');
  peer.liveblocks.events.length = 0;
  await undoActions[0].undo();
  await peer.sync.waitForPendingBroadcasts();

  const restoreEvent = peer.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_RESTORED');
  const createEvent = peer.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_CREATED');
  const keyframeEvent = peer.liveblocks.events.find(event => event.type === 'DRAWING_KEYFRAME_UPDATE');
  assert.ok(restoreEvent);
  assert.equal(createEvent.restore, true);
  assert.equal(createEvent.layer.id, 'anchor');
  assert.equal(createEvent.layer.locked, true);
  assert.equal(keyframeEvent.layerId, 'anchor');
  assert.equal(keyframeEvent.frame, 9);
  assert.equal(keyframeEvent.canvasData, 'legacy-restore-data');

  const legacyLayers = [];
  for (const event of peer.liveblocks.events) {
    if (event.type === 'DRAWING_LAYER_CREATED') {
      if (!legacyLayers.some(item => item.id === event.layer.id)) {
        legacyLayers.splice(event.insertIndex ?? legacyLayers.length, 0, {
          ...event.layer,
          keyframes: []
        });
      }
    } else if (event.type === 'DRAWING_KEYFRAME_UPDATE') {
      const legacyLayer = legacyLayers.find(item => item.id === event.layerId);
      if (legacyLayer) legacyLayer.keyframes.push({ ...event });
    }
  }

  assert.equal(legacyLayers.length, 1);
  assert.equal(legacyLayers[0].locked, true);
  assert.equal(legacyLayers[0].keyframes[0].canvasData, 'legacy-restore-data');

  const newReceiver = await createPeer({ actorId: 'actor-receiver' });
  newReceiver.liveblocks.receive({ type: 'DRAWING_LAYER_DELETED', layerId: 'anchor' });
  newReceiver.liveblocks.events.length = 0;
  for (const event of peer.liveblocks.events) newReceiver.liveblocks.receive(event);
  for (const event of peer.liveblocks.events) newReceiver.liveblocks.receive(event);
  const restoredLayers = newReceiver.manager.layers.filter(item => item.id === 'anchor');
  assert.equal(restoredLayers.length, 1);
  assert.equal(restoredLayers[0].keyframes.length, 1);
  assert.equal(restoredLayers[0].keyframes[0].canvasData, 'legacy-restore-data');
  assert.deepEqual(newReceiver.liveblocks.events, []);
});

test('oversized restore chunks full keyframes when reduction fails or stays oversized', async () => {
  const peerA = await createPeer({ actorId: 'actor-large-a' });
  const peerB = await createPeer({ actorId: 'actor-large-b' });
  const undoActions = [];
  peerA.manager._onUndoPush = action => undoActions.push(action);
  const throwingCanvasData = `data:image/png;base64,${'z'.repeat(1024 * 1024 + 48)}`;
  const largeCanvasData = `data:image/png;base64,${'x'.repeat(1024 * 1024 + 64)}`;
  const secondLargeCanvasData = `data:image/png;base64,${'y'.repeat(1024 * 1024 + 96)}`;
  const stillOversizedReducedData = `data:image/png;base64,${'r'.repeat(1024 * 1024 + 32)}`;
  for (const peer of [peerA, peerB]) {
    const layer = peer.manager.layers.find(item => item.id === 'anchor');
    layer.getOrCreateKeyframe(11).setCanvasData(throwingCanvasData);
    const first = layer.getOrCreateKeyframe(12);
    first.setCanvasData(largeCanvasData);
    first.baseCanvasData = 'first-base-data';
    first.strokeRecords = [{
      id: 'stroke-1',
      tool: 'pen',
      points: [{ x: 1, y: 2 }],
      color: '#123456',
      lineWidth: 3,
      opacity: 0.8,
      strokeEnabled: false,
      strokeWidth: 0,
      strokeColor: '#ffffff'
    }];
    const second = layer.getOrCreateKeyframe(13);
    second.setCanvasData(secondLargeCanvasData);
    second.baseCanvasData = 'second-base-data';
    second.strokeRecords = [{
      id: 'stroke-2',
      tool: 'brush',
      points: [{ x: 3, y: 4 }],
      color: '#654321',
      lineWidth: 5,
      opacity: 1,
      strokeEnabled: false,
      strokeWidth: 0,
      strokeColor: '#ffffff'
    }];
    layer.getOrCreateKeyframe(14).setCanvasData('next-keyframe-data');
    peer.liveblocks.events.length = 0;
  }
  let reduceCalls = 0;
  peerA.sync._reduceCanvasData = async data => {
    reduceCalls += 1;
    if (data === throwingCanvasData) throw new Error('reducer failed');
    return data === largeCanvasData ? null : stillOversizedReducedData;
  };

  peerA.manager.deleteLayer('anchor');
  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  await undoActions[0].undo();
  await peerA.sync.waitForPendingBroadcasts();

  const restoreEvent = peerA.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_RESTORED');
  const createEvent = peerA.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_CREATED');
  const chunkEvents = peerA.liveblocks.events.filter(event => event.type === 'DRAWING_KEYFRAME_CHUNK');
  const keyframeEvent = peerA.liveblocks.events.find(event => (
    event.type === 'DRAWING_KEYFRAME_UPDATE' && event.frame === 14
  ));
  const orderEvent = peerA.liveblocks.events.find(event => event.type === 'DRAWING_LAYER_ORDER_CHANGED');
  assert.equal(reduceCalls, 3);
  assert.equal(restoreEvent.layer.keyframes, undefined);
  assert.equal(createEvent.layer.keyframes, undefined);
  assert.ok(JSON.stringify(restoreEvent).length < 10000);
  assert.ok(JSON.stringify(createEvent).length < 10000);
  assert.ok(chunkEvents.length > 2);
  assert.equal(keyframeEvent.canvasData, 'next-keyframe-data');
  assert.ok(orderEvent);
  for (const event of peerA.liveblocks.events) {
    assert.ok(
      new TextEncoder().encode(JSON.stringify(event)).byteLength < 1024 * 1024,
      `${event.type} must stay below broadcast limit`
    );
  }

  for (const event of peerA.liveblocks.events.splice(0)) peerB.liveblocks.receive(event);
  assert.deepEqual(peerA.manager.layers.map(layer => layer.id), peerB.manager.layers.map(layer => layer.id));
  assert.deepEqual(peerB.manager.layers[0].keyframes.map(keyframe => keyframe.frame), [11, 12, 13, 14]);
  assert.equal(peerB.manager.layers[0].keyframes[0].canvasData, throwingCanvasData);
  assert.equal(peerB.manager.layers[0].keyframes[1].canvasData, largeCanvasData);
  assert.equal(peerB.manager.layers[0].keyframes[1].baseCanvasData, 'first-base-data');
  assert.deepEqual(peerB.manager.layers[0].keyframes[1].strokeRecords, [
    {
      id: 'stroke-1',
      tool: 'pen',
      points: [{ x: 1, y: 2 }],
      color: '#123456',
      lineWidth: 3,
      opacity: 0.8,
      strokeEnabled: false,
      strokeWidth: 0,
      strokeColor: '#ffffff'
    }
  ]);
  assert.equal(peerB.manager.layers[0].keyframes[2].canvasData, secondLargeCanvasData);
  assert.equal(peerB.manager.layers[0].keyframes[2].baseCanvasData, 'second-base-data');
  assert.equal(peerB.manager.layers[0].keyframes[3].canvasData, 'next-keyframe-data');
  assert.deepEqual(peerB.liveblocks.events, []);
});

test('malformed and stale keyframe chunks are ignored and pruned safely', async () => {
  const peer = await createPeer({ actorId: 'actor-chunk-safety' });
  peer.liveblocks.events.length = 0;

  peer.liveblocks.receive({
    type: 'DRAWING_KEYFRAME_CHUNK',
    transferId: 'bad-index',
    index: -1,
    count: 2,
    layerId: 'anchor',
    frame: 1,
    data: 'YQ=='
  });
  assert.equal(peer.sync._keyframeChunkTransfers.size, 0);

  peer.liveblocks.receive({
    type: 'DRAWING_KEYFRAME_CHUNK',
    transferId: 'stale-transfer',
    index: 0,
    count: 2,
    layerId: 'anchor',
    frame: 1,
    data: 'YQ=='
  });
  assert.equal(peer.sync._keyframeChunkTransfers.size, 1);
  peer.sync._pruneExpiredKeyframeChunks(Date.now() + 60000);
  assert.equal(peer.sync._keyframeChunkTransfers.size, 0);
  assert.deepEqual(peer.liveblocks.events, []);
});

test('chunk receiver enforces active, transfer, and global byte caps then recovers', async () => {
  const peer = await createPeer({ actorId: 'actor-chunk-limits' });
  peer.liveblocks.events.length = 0;
  const sendChunk = (transferId, index, count, data, frame = 2) => {
    peer.liveblocks.receive({
      type: 'DRAWING_KEYFRAME_CHUNK',
      transferId,
      index,
      count,
      layerId: 'anchor',
      frame,
      data
    });
  };

  for (let index = 0; index < 9; index++) {
    sendChunk(`active-${index}`, 0, 2, 'YQ==');
  }
  assert.equal(peer.sync._keyframeChunkTransfers.size, 8);
  peer.sync._clearKeyframeChunkTransfers();
  assert.equal(peer.sync._keyframeChunkBufferedBytes, 0);

  const oversizedChunkData = 'A'.repeat(600 * 1024);
  for (let index = 0; index < 64; index++) {
    sendChunk('transfer-overflow', index, 64, oversizedChunkData);
    if (!peer.sync._keyframeChunkTransfers.has('transfer-overflow')) break;
  }
  assert.equal(peer.sync._keyframeChunkTransfers.has('transfer-overflow'), false);
  assert.equal(peer.sync._keyframeChunkBufferedBytes, 0);

  const globalChunkData = 'A'.repeat(512 * 1024);
  for (let transferIndex = 0; transferIndex < 8; transferIndex++) {
    for (let chunkIndex = 0; chunkIndex < 16; chunkIndex++) {
      sendChunk(`global-${transferIndex}`, chunkIndex, 64, globalChunkData, 10 + transferIndex);
    }
  }
  assert.equal(peer.sync._keyframeChunkTransfers.size, 8);
  assert.equal(peer.sync._keyframeChunkBufferedBytes, 64 * 1024 * 1024);
  sendChunk('global-0', 16, 64, globalChunkData, 10);
  assert.equal(peer.sync._keyframeChunkTransfers.has('global-0'), false);
  assert.ok(peer.sync._keyframeChunkBufferedBytes >= 0);

  peer.sync._clearKeyframeChunkTransfers();
  assert.equal(peer.sync._keyframeChunkTransfers.size, 0);
  assert.equal(peer.sync._keyframeChunkBufferedBytes, 0);

  const recoveredPayload = {
    type: 'DRAWING_KEYFRAME_UPDATE',
    layerId: 'anchor',
    frame: 99,
    canvasData: 'recovered-data',
    baseCanvasData: 'recovered-base',
    strokeRecords: [],
    isEmpty: false
  };
  sendChunk('recovered-transfer', 0, 1, btoa(JSON.stringify(recoveredPayload)), 99);
  assert.equal(peer.sync._keyframeChunkTransfers.size, 0);
  assert.equal(peer.sync._keyframeChunkBufferedBytes, 0);
  assert.equal(peer.manager.layers[0].getKeyframeAtFrame(99).canvasData, 'recovered-data');
  assert.deepEqual(peer.liveblocks.events, []);
});
