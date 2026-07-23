const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionSceneStore,
  normalizePressure,
  createActionDeduper,
  shouldAcceptInputRequest
} = require('../../renderer/scripts/modules/mpv-fabric-overlay-runtime.js');
const {
  createFabricDrawingPilotMetrics
} = require('../../renderer/scripts/modules/fabric-drawing-pilot-metrics.js');

const session = (overrides = {}) => ({
  sessionId: 'session-a',
  stableVideoIdentity: 'video-a',
  targetFrame: 12,
  videoGeneration: 1,
  sourceWidth: 1920,
  sourceHeight: 1080,
  tool: 'brush',
  ...overrides
});

const stroke = (id, bytes = 16) => ({
  id,
  type: 'stroke',
  pathData: 'M 0 0 L 10 10 Z',
  sourcePoints: [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 10, y: 10, pressure: 0.75 }
  ],
  transform: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0 },
  bytes
});

test('session scenes are separated by stable video identity and target frame', () => {
  const store = createSessionSceneStore();

  assert.equal(store.activateSession(session()).accepted, true);
  assert.equal(store.addStroke(stroke('stroke-a')).applied, true);

  assert.equal(store.activateSession(session({ sessionId: 'session-b', targetFrame: 13 })).accepted, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 0);
  assert.equal(store.addStroke(stroke('stroke-b')).applied, true);

  assert.equal(store.activateSession(session({ sessionId: 'session-c', stableVideoIdentity: 'video-b' })).accepted, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 0);

  assert.deepEqual(store.getSceneSnapshot('video-a', 12).objects.map(object => object.id), ['stroke-a']);
  assert.deepEqual(store.getSceneSnapshot('video-a', 13).objects.map(object => object.id), ['stroke-b']);
  assert.equal(store.getSceneSnapshot('video-b', 12).objects.length, 0);
  assert.equal(store.getDiagnostics().sceneKeys.every(key => key.includes('\u0000')), true);
});

test('a newer video generation permanently rejects activation from the previous generation', () => {
  const store = createSessionSceneStore();

  assert.equal(store.activateSession(session()).accepted, true);
  assert.equal(store.activateSession(session({ sessionId: 'session-new', videoGeneration: 2 })).accepted, true);

  const stale = store.activateSession(session({ sessionId: 'session-old', videoGeneration: 1 }));
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale-video-generation');
  assert.equal(store.getDiagnostics().activeSessionId, 'session-new');
});

test('input and tool revisions only move forward and disable does not require a session', () => {
  const inputState = { hostGeneration: 4, videoGeneration: 7, inputRevision: 12 };

  assert.equal(shouldAcceptInputRequest(inputState, {
    hostGeneration: 4,
    videoGeneration: 7,
    inputRevision: 11,
    enabled: true,
    session: session()
  }), false);
  assert.equal(shouldAcceptInputRequest(inputState, {
    hostGeneration: 4,
    videoGeneration: 7,
    inputRevision: 13,
    enabled: false
  }), true);
  assert.equal(shouldAcceptInputRequest(inputState, {
    hostGeneration: 4,
    videoGeneration: 6,
    inputRevision: 14,
    enabled: false
  }), false);

  const store = createSessionSceneStore();
  store.activateSession(session());
  assert.equal(store.updateTool({ sessionId: 'session-a', toolRevision: 3, tool: 'select' }).accepted, true);
  assert.equal(store.updateTool({ sessionId: 'session-a', toolRevision: 2, tool: 'brush' }).accepted, false);
  assert.equal(store.getDiagnostics().tool, 'select');
});

test('selection is clean while stroke, real move, delete, and clear are mutations', () => {
  const store = createSessionSceneStore();
  store.activateSession(session());
  store.addStroke(stroke('one'));
  store.addStroke(stroke('two'));

  assert.equal(store.getActiveSceneSnapshot().mutationCount, 2);
  assert.equal(store.selectObjects(['one']).changed, true);
  assert.equal(store.getActiveSceneSnapshot().mutationCount, 2);
  assert.equal(store.getActiveSceneSnapshot().dirty, true);

  assert.equal(store.transformSelection({ dx: 0, dy: 0 }).applied, false);
  assert.equal(store.getActiveSceneSnapshot().mutationCount, 2);
  assert.equal(store.transformSelection({ dx: 8, dy: -3 }).applied, true);
  assert.equal(store.getActiveSceneSnapshot().mutationCount, 3);

  assert.equal(store.deleteSelection().deletedCount, 1);
  assert.equal(store.getActiveSceneSnapshot().mutationCount, 4);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 1);

  assert.equal(store.clearSession().deletedCount, 1);
  assert.equal(store.getActiveSceneSnapshot().mutationCount, 5);
  assert.equal(store.clearSession().applied, false);
  assert.equal(store.getActiveSceneSnapshot().mutationCount, 5);
});

test('delete and clear action ids are accepted exactly once within a bounded LRU window', () => {
  const deduper = createActionDeduper({ maxEntries: 2 });

  assert.equal(deduper.accept('delete-a'), true);
  assert.equal(deduper.accept('clear-a'), true);
  assert.equal(deduper.accept('delete-a'), false);
  assert.equal(deduper.accept('delete-b'), true);
  assert.equal(deduper.size, 2);
  assert.equal(deduper.accept('clear-a'), true);
});

test('pressure defaults to 0.5 when absent and clamps supplied values', () => {
  assert.equal(normalizePressure(undefined), 0.5);
  assert.equal(normalizePressure(Number.NaN), 0.5);
  assert.equal(normalizePressure(0, 'mouse'), 0.5);
  assert.equal(normalizePressure(0, 'pen'), 0);
  assert.equal(normalizePressure(-0.25, 'pen'), 0);
  assert.equal(normalizePressure(1.25, 'pen'), 1);
  assert.equal(normalizePressure(0.35, 'pen'), 0.35);
});

test('scene cache evicts least recently used videos by count and byte budget', () => {
  const store = createSessionSceneStore({
    maxVideos: 2,
    maxBytes: 50,
    estimateObjectBytes: object => object.bytes
  });

  store.activateSession(session({ stableVideoIdentity: 'video-a' }));
  store.addStroke(stroke('a', 20));
  store.activateSession(session({ sessionId: 'session-b', stableVideoIdentity: 'video-b' }));
  store.addStroke(stroke('b', 20));
  store.activateSession(session({ sessionId: 'session-a2', stableVideoIdentity: 'video-a' }));
  store.activateSession(session({ sessionId: 'session-c', stableVideoIdentity: 'video-c' }));
  store.addStroke(stroke('c', 20));

  assert.equal(store.hasScene('video-a', 12), true);
  assert.equal(store.hasScene('video-b', 12), false);
  assert.equal(store.hasScene('video-c', 12), true);
  assert.ok(store.getDiagnostics().estimatedBytes <= 50);
  assert.ok(store.getDiagnostics().videoCount <= 2);
});

test('scene object count is bounded before accepting another stroke', () => {
  const store = createSessionSceneStore({ maxObjects: 2 });
  store.activateSession(session());

  assert.equal(store.addStroke(stroke('one')).applied, true);
  assert.equal(store.addStroke(stroke('two')).applied, true);
  const overflow = store.addStroke(stroke('three'));

  assert.equal(overflow.applied, false);
  assert.equal(overflow.reason, 'scene-object-limit-exceeded');
  assert.equal(store.getDiagnostics().objectCount, 2);
  assert.equal(store.getDiagnostics().maxObjects, 2);
  assert.equal(createSessionSceneStore().getDiagnostics().maxObjects, 10000);
});

test('pilot metrics retain bounded samples while accumulating full counters', () => {
  const metrics = createFabricDrawingPilotMetrics({ maxSamples: 3 });

  [4, 8, 12, 16].forEach(value => metrics.recordToggleLatency(value));
  metrics.recordPointerSample(0.2);
  metrics.recordPointerSample(0.8);
  metrics.recordLongTask(55);
  metrics.setObjectCount(7);
  metrics.recordDuplicateAction();
  metrics.recordSaveAttempt();

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.toggleLatency.count, 4);
  assert.equal(snapshot.toggleLatency.samples.length, 3);
  assert.equal(snapshot.pointerSamples.count, 2);
  assert.equal(snapshot.pointerSamples.pressureMin, 0.2);
  assert.equal(snapshot.pointerSamples.pressureMax, 0.8);
  assert.equal(snapshot.longTasks.count, 1);
  assert.equal(snapshot.objectCount.current, 7);
  assert.equal(snapshot.objectCount.peak, 7);
  assert.equal(snapshot.duplicateActionCount, 1);
  assert.equal(snapshot.saveAttemptCount, 1);
});
