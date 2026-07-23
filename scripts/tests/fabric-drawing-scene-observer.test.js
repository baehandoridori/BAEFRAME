const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createSessionSceneStore
} = require('../../renderer/scripts/modules/mpv-fabric-overlay-runtime.js');
const {
  createDrawingEngineAdapter
} = require('../../renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js');

const IDENTITY_TRANSFORM = Object.freeze({
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  skewX: 0,
  skewY: 0,
  flipX: false,
  flipY: false
});

function session(overrides = {}) {
  return {
    sessionId: 'session-a',
    stableVideoIdentity: 'video-a',
    targetFrame: 12,
    hostGeneration: 3,
    videoGeneration: 1,
    sourceWidth: 1920,
    sourceHeight: 1080,
    tool: 'brush',
    ...overrides
  };
}

function stroke(id, overrides = {}) {
  const base = {
    id,
    type: 'stroke',
    pathData: 'M 0 0 L 10 10 Z',
    sourcePoints: [
      { x: 0, y: 0, pressure: 0.5, pointerType: 'pen', time: 0 },
      { x: 10, y: 10, pressure: 0.75, pointerType: 'pen', time: 1 }
    ],
    strokeCaps: { start: true, end: true },
    style: { color: '#ff4757', size: 3, opacity: 1 },
    transform: { ...IDENTITY_TRANSFORM }
  };
  return {
    ...base,
    ...overrides,
    sourcePoints: overrides.sourcePoints || base.sourcePoints,
    strokeCaps: { ...base.strokeCaps, ...(overrides.strokeCaps || {}) },
    style: { ...base.style, ...(overrides.style || {}) },
    transform: { ...base.transform, ...(overrides.transform || {}) }
  };
}

function createObserverHarness(overrides = {}) {
  const activations = [];
  const transitions = [];
  const quarantines = [];
  const drops = [];
  let idSequence = 0;
  let store = null;
  const observer = {
    activateScene(sceneDescriptor, authoritativeObjects) {
      activations.push({
        scene: { ...sceneDescriptor },
        objectIds: [...authoritativeObjects.keys()]
      });
      return overrides.activateScene?.(sceneDescriptor, authoritativeObjects);
    },
    enqueueTransition(event) {
      transitions.push(event);
      return overrides.enqueueTransition?.(event, store);
    },
    quarantineScene(sceneInstanceId, reason) {
      quarantines.push({ sceneInstanceId, reason });
      return overrides.quarantineScene?.(sceneInstanceId, reason);
    },
    dropScenes(sceneInstanceIds) {
      drops.push([...sceneInstanceIds]);
      return overrides.dropScenes?.(sceneInstanceIds);
    }
  };
  store = createSessionSceneStore({
    drawingEngineObserver: observer,
    createSceneInstanceId: () => `scene-${++idSequence}`,
    ...overrides.storeOptions
  });
  return { store, observer, activations, transitions, quarantines, drops };
}

function eventShape(event) {
  return {
    scene: event.scene,
    mutationSequence: event.mutationSequence,
    origin: event.origin,
    kind: event.kind,
    estimatedBytes: event.estimatedBytes,
    unsupportedReason: event.unsupportedReason,
    removals: event.removals,
    insertions: event.insertions,
    transforms: event.transforms
  };
}

function persistenceRequest(overrides = {}) {
  return {
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'persistence-session-a',
    stableVideoIdentity: 'video-a',
    fps: 24,
    totalFrames: 240,
    keyframes: [],
    ...overrides
  };
}

function exportRequest(overrides = {}) {
  const request = persistenceRequest(overrides);
  delete request.keyframes;
  return request;
}

test('persistence observer emits one fenced event per committed mutation and ignores UI-only work', () => {
  const persistenceTransitions = [];
  const store = createSessionSceneStore({
    createSceneInstanceId: (() => {
      let sequence = 0;
      return () => `persistence-scene-${++sequence}`;
    })(),
    committedTransitionObserver(event) {
      persistenceTransitions.push(event);
    }
  });

  assert.equal(store.hydrateVideo(persistenceRequest()).accepted, true);
  assert.equal(store.activateSession(session({
    videoGeneration: 7
  })).accepted, true);
  assert.equal(persistenceTransitions.length, 0, 'hydrate and activation are not commits');

  const original = stroke('persist-original');
  assert.equal(store.addStroke(original).applied, true);
  assert.equal(store.selectObjects([original.id]).changed, true);
  assert.equal(store.selectObjects([original.id]).changed, false);
  assert.equal(store.transformSelection({ dx: 0, dy: 0 }).applied, false);
  assert.equal(store.addStroke(original).applied, false);
  assert.equal(persistenceTransitions.length, 1, 'selection and rejected no-ops stay silent');

  assert.equal(store.transformSelection({ dx: 4, dy: -2 }).applied, true);
  const inside = stroke('persist-inside', { transform: { left: 4, top: -2 } });
  const outside = stroke('persist-outside', { transform: { left: 4, top: -2 } });
  assert.equal(store.replaceObjects({
    kind: 'split-stroke',
    replacements: [{ removeId: original.id, addObjects: [inside, outside] }],
    selectedObjectIds: [inside.id]
  }).applied, true);
  assert.equal(store.deleteSelection().applied, true);
  assert.equal(store.clearSession().applied, true);

  assert.deepEqual(
    persistenceTransitions.map(event => event.kind),
    [
      'add-objects',
      'transform-objects',
      'split-stroke',
      'delete-objects',
      'clear-keyframe'
    ]
  );
  assert.deepEqual(
    persistenceTransitions.map(event => event.mutationSequence),
    [1, 2, 3, 4, 5]
  );
  for (const event of persistenceTransitions) {
    assert.equal(event.hostGeneration, 3);
    assert.equal(event.videoGeneration, 7);
    assert.equal(event.persistenceSessionId, 'persistence-session-a');
    assert.equal(event.stableVideoIdentity, 'video-a');
    assert.equal(event.scene.targetFrame, 12);
  }
});

test('persistence history events observe finalized stacks and observer failures stay isolated', () => {
  const v3Transitions = [];
  const persistenceTransitions = [];
  const observedHistory = [];
  let throwFromV3 = true;
  let throwFromPersistence = false;
  const store = createSessionSceneStore({
    createSceneInstanceId: () => 'persistence-history-scene',
    drawingEngineObserver: {
      activateScene() {},
      enqueueTransition(event) {
        v3Transitions.push(event);
        if (throwFromV3) throw new Error('v3-observer-injected');
      },
      quarantineScene() {},
      dropScenes() {}
    },
    committedTransitionObserver(event) {
      persistenceTransitions.push(event);
      if (event.origin === 'history') {
        const diagnostics = store.getDiagnostics();
        observedHistory.push({
          kind: event.kind,
          undoDepth: diagnostics.undoDepth,
          redoDepth: diagnostics.redoDepth
        });
      }
      if (throwFromPersistence) throw new Error('persistence-observer-injected');
    }
  });
  store.hydrateVideo(persistenceRequest());
  store.activateSession(session({ videoGeneration: 7 }));

  assert.equal(store.addStroke(stroke('isolated-add')).applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 1);
  assert.equal(persistenceTransitions.length, 1, 'V3 failure does not suppress persistence');

  throwFromV3 = false;
  throwFromPersistence = true;
  assert.equal(store.undo().applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 0);
  assert.equal(v3Transitions.length, 2, 'persistence failure does not suppress V3');
  assert.deepEqual(observedHistory, [{
    kind: 'delete-objects',
    undoDepth: 0,
    redoDepth: 1
  }]);

  throwFromPersistence = false;
  assert.equal(store.redo().applied, true);
  assert.deepEqual(observedHistory, [
    { kind: 'delete-objects', undoDepth: 0, redoDepth: 1 },
    { kind: 'add-objects', undoDepth: 1, redoDepth: 0 }
  ]);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 1);
  assert.equal(store.getDiagnostics().observerFailureCount, 1);
  assert.equal(store.getDiagnostics().persistenceObserverFailureCount, 1);
});

test('hydrate restores sequence atomically, clears transient state, and gives V3 one full seed', () => {
  const seededValues = [];
  const persistenceTransitions = [];
  const record = stroke('hydrated-stroke');
  const store = createSessionSceneStore({
    createSceneInstanceId: () => 'hydrated-runtime-scene',
    drawingEngineObserver: {
      activateScene(_scene, authoritativeObjects) {
        seededValues.push(authoritativeObjects.get(record.id));
      },
      enqueueTransition() {},
      quarantineScene() {},
      dropScenes() {}
    },
    committedTransitionObserver(event) {
      persistenceTransitions.push(event);
    }
  });

  const hydrateResult = store.hydrateVideo(persistenceRequest({
    keyframes: [{
      id: 'persisted-keyframe-id-is-not-runtime-identity',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 9,
      objects: [record]
    }]
  }));
  assert.equal(hydrateResult.accepted, true);
  assert.equal(persistenceTransitions.length, 0);

  assert.equal(store.activateSession(session({ videoGeneration: 7 })).accepted, true);
  assert.deepEqual(seededValues[0], record, 'first activation receives the full persisted record');
  assert.equal(store.getDiagnostics().dirty, false);
  assert.equal(store.getDiagnostics().undoDepth, 0);
  assert.equal(store.getDiagnostics().redoDepth, 0);
  assert.equal(store.getDiagnostics().mutationCount, 0);

  store.selectObjects([record.id]);
  store.deactivateSession('session-a');
  assert.equal(store.activateSession(session({
    sessionId: 'session-warm',
    videoGeneration: 7
  })).accepted, true);
  assert.equal(seededValues[1], null, 'warm activation receives only the identity seed');
  assert.equal(store.getDiagnostics().selectionCount, 0);

  assert.equal(store.selectObjects([record.id]).changed, true);
  assert.equal(store.transformSelection({ dx: 1, dy: 0 }).applied, true);
  assert.equal(persistenceTransitions[0].mutationSequence, 10);
  assert.equal(
    store.exportVideo(exportRequest()).snapshot.scenes[0].sceneInstanceId,
    'hydrated-runtime-scene',
    'persisted keyframe id is never reused as the runtime scene identity'
  );
});

test('real V3 adapter bootstraps once from a persisted nonzero sequence', () => {
  const scheduled = [];
  let adapterId = 0;
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-hydrate-${++adapterId}`,
    nowIso: () => '2026-07-23T01:02:03.456Z',
    latencyNow: () => 0,
    scheduleWork: callback => scheduled.push(callback),
    fallbackScheduleWork: callback => scheduled.push(callback)
  });
  const store = createSessionSceneStore({
    drawingEngineObserver: adapter,
    createSceneInstanceId: () => 'real-hydrated-scene'
  });
  const record = stroke('real-hydrated-stroke');
  assert.equal(store.hydrateVideo(persistenceRequest({
    keyframes: [{
      id: 'disk-real-v3-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 9,
      objects: [record]
    }]
  })).accepted, true);
  assert.equal(store.activateSession(session({ videoGeneration: 7 })).accepted, true);

  let projection = adapter.getSceneProjection('real-hydrated-scene');
  assert.ok(projection);
  assert.equal(projection.headSequence, 9);
  assert.deepEqual(
    projection.document.layers[0].keyframes[0].objects.map(object => object.id),
    [record.id]
  );
  assert.equal(adapter.getDiagnostics('real-hydrated-scene').bootstrapCount, 1);

  store.deactivateSession('session-a');
  assert.equal(store.activateSession(session({
    sessionId: 'real-hydrated-warm',
    videoGeneration: 7
  })).accepted, true);
  while (scheduled.length > 0) scheduled.shift()();
  projection = adapter.getSceneProjection('real-hydrated-scene');
  assert.ok(projection);
  assert.equal(projection.headSequence, 9);
  assert.equal(adapter.getDiagnostics('real-hydrated-scene').bootstrapCount, 1);
});

test('new and warm activation reuse one opaque scene while UI-only paths emit no transition', () => {
  const harness = createObserverHarness();
  const { store, activations, transitions } = harness;

  assert.equal(store.activateSession(session()).accepted, true);
  assert.deepEqual(activations, [{
    scene: {
      sceneInstanceId: 'scene-1',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 0
    },
    objectIds: []
  }]);

  const first = stroke('warm-stroke');
  assert.equal(store.addStroke(first).applied, true);
  assert.equal(store.selectObjects([first.id]).changed, true);
  assert.equal(store.updateTool({
    sessionId: 'session-a', toolRevision: 1, tool: 'select'
  }).accepted, true);
  assert.equal(store.deactivateSession('session-a').accepted, true);
  assert.equal(store.activateSession(session({ sessionId: 'session-b', tool: 'select' })).accepted, true);

  assert.equal(transitions.length, 1);
  assert.deepEqual(activations.at(-1), {
    scene: {
      sceneInstanceId: 'scene-1',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1
    },
    objectIds: ['warm-stroke']
  });
});

test('live add move delete and clear emit one exact post-commit delta each', () => {
  const { store, transitions } = createObserverHarness();
  store.activateSession(session());
  const first = stroke('first');

  assert.equal(store.addStroke(first).applied, true);
  assert.deepEqual(eventShape(transitions[0]), {
    scene: {
      sceneInstanceId: 'scene-1',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: 1,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: transitions[0].estimatedBytes,
    unsupportedReason: null,
    removals: [],
    insertions: [{ index: 0, record: first, baseTransform: first.transform }],
    transforms: []
  });
  assert.equal(Number.isSafeInteger(transitions[0].estimatedBytes), true);
  assert.equal(transitions[0].estimatedBytes > 0, true);

  store.selectObjects([first.id]);
  assert.equal(store.transformSelection({ dx: 8, dy: -3 }).applied, true);
  assert.deepEqual(transitions[1].transforms, [{
    id: first.id,
    beforeTransform: first.transform,
    afterTransform: { ...first.transform, left: 8, top: -3 }
  }]);
  assert.equal(transitions[1].kind, 'transform-objects');
  assert.equal(transitions[1].mutationSequence, 2);

  assert.equal(store.deleteSelection().applied, true);
  assert.deepEqual(transitions[2].removals, [{ id: first.id, index: 0 }]);
  assert.equal(transitions[2].kind, 'delete-objects');
  assert.equal(transitions[2].mutationSequence, 3);

  const second = stroke('second');
  const third = stroke('third');
  store.addStroke(second);
  store.addStroke(third);
  const beforeClear = transitions.length;
  assert.equal(store.clearSession().applied, true);
  assert.equal(transitions.length, beforeClear + 1);
  assert.deepEqual(transitions.at(-1).removals, [
    { id: second.id, index: 0 },
    { id: third.id, index: 1 }
  ]);
  assert.equal(transitions.at(-1).kind, 'clear-keyframe');
});

test('split emits one atomic final-order delta with insertion baselines and moves', () => {
  const { store, transitions } = createObserverHarness();
  store.activateSession(session());
  const original = stroke('original', { transform: { left: 1, top: 2 } });
  const survivor = stroke('survivor', { transform: { left: 20, top: 30 } });
  const inside = stroke('inside', { transform: { left: 1, top: 2 }, strokeCaps: { end: false } });
  const outside = stroke('outside', { transform: { left: 1, top: 2 }, strokeCaps: { start: false } });
  store.addStroke(original);
  store.addStroke(survivor);

  assert.equal(store.replaceObjects({
    kind: 'split-stroke',
    replacements: [{ removeId: original.id, addObjects: [inside, outside] }],
    selectedObjectIds: [inside.id, survivor.id],
    transforms: [{ id: survivor.id, transform: { left: 40, top: 50 } }],
    dx: 7,
    dy: -3
  }).applied, true);

  assert.equal(transitions.length, 3);
  const event = transitions.at(-1);
  assert.equal(event.kind, 'split-stroke');
  assert.equal(event.mutationSequence, 3);
  assert.deepEqual(event.removals, [{ id: original.id, index: 0 }]);
  assert.deepEqual(event.insertions.map(item => ({
    index: item.index,
    id: item.record.id,
    baseTransform: item.baseTransform
  })), [
    { index: 0, id: inside.id, baseTransform: inside.transform },
    { index: 1, id: outside.id, baseTransform: outside.transform }
  ]);
  assert.deepEqual(event.transforms, [
    {
      id: inside.id,
      beforeTransform: inside.transform,
      afterTransform: { ...inside.transform, left: 8, top: -1 }
    },
    {
      id: survivor.id,
      beforeTransform: survivor.transform,
      afterTransform: { ...survivor.transform, left: 40, top: 50 }
    }
  ]);
});

test('Undo and Redo notify only after both history stacks and mirrored entries move', () => {
  const observedHistory = [];
  const harness = createObserverHarness({
    enqueueTransition(event, store) {
      if (event.origin === 'history') {
        const diagnostics = store.getDiagnostics();
        observedHistory.push({
          kind: event.kind,
          undoDepth: diagnostics.undoDepth,
          redoDepth: diagnostics.redoDepth
        });
      }
    }
  });
  const { store, transitions } = harness;
  store.activateSession(session());
  const record = stroke('history-stroke');
  store.addStroke(record);

  assert.equal(store.undo().applied, true);
  const undoEvent = transitions.at(-1);
  assert.equal(undoEvent.origin, 'history');
  assert.equal(undoEvent.kind, 'delete-objects');
  assert.deepEqual(undoEvent.removals, [{ id: record.id, index: 0 }]);
  assert.equal(undoEvent.mutationSequence, 2);

  assert.equal(store.redo().applied, true);
  const redoEvent = transitions.at(-1);
  assert.equal(redoEvent.origin, 'history');
  assert.equal(redoEvent.kind, 'add-objects');
  assert.equal(redoEvent.insertions[0].baseTransform, null);
  assert.equal(redoEvent.mutationSequence, 3);
  assert.deepEqual(observedHistory, [
    { kind: 'delete-objects', undoDepth: 0, redoDepth: 1 },
    { kind: 'add-objects', undoDepth: 1, redoDepth: 0 }
  ]);
});

test('failed and UI-only mutations emit nothing, while observer failure cannot roll back primary state', () => {
  let throwOnTransition = false;
  const harness = createObserverHarness({
    enqueueTransition() {
      if (throwOnTransition) throw new Error('observer-injected');
    }
  });
  const { store, transitions, quarantines } = harness;
  store.activateSession(session());
  const record = stroke('atomic-observer');

  assert.equal(store.addStroke(record).applied, true);
  const beforeFailures = transitions.length;
  assert.equal(store.addStroke(record).applied, false);
  store.selectObjects([record.id]);
  assert.equal(store.transformSelection({ dx: 0, dy: 0 }).applied, false);
  assert.equal(store.replaceObjects({ replacements: [] }).applied, false);
  assert.equal(transitions.length, beforeFailures);

  throwOnTransition = true;
  const beforeUndo = store.getDiagnostics();
  const undoResult = store.undo();
  assert.equal(undoResult.applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 0);
  assert.equal(store.getDiagnostics().mutationCount, beforeUndo.mutationCount + 1);
  assert.equal(store.getDiagnostics().undoDepth, 0);
  assert.equal(store.getDiagnostics().redoDepth, 1);
  assert.deepEqual(quarantines.at(-1), {
    sceneInstanceId: 'scene-1',
    reason: 'observer-failed'
  });
  assert.equal(store.getDiagnostics().observerFailureCount, 1);
});

test('transition payload ownership cannot mutate primary scene or stored history', () => {
  const harness = createObserverHarness({
    enqueueTransition(event) {
      if (event.insertions[0]) {
        event.insertions[0].record.style.color = '#000000';
        event.insertions[0].record.sourcePoints[0].x = 999;
      }
    }
  });
  const { store } = harness;
  store.activateSession(session());
  const original = stroke('owned-payload');

  assert.equal(store.addStroke(original).applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects[0].style.color, '#ff4757');
  assert.equal(store.getActiveSceneSnapshot().objects[0].sourcePoints[0].x, 0);
  assert.equal(store.undo().applied, true);
  assert.equal(store.redo().applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects[0].style.color, '#ff4757');
  assert.equal(store.getActiveSceneSnapshot().objects[0].sourcePoints[0].x, 0);
});

test('eviction and destroy drop opaque scene instances exactly once and recreation gets a new ID', () => {
  const harness = createObserverHarness({
    storeOptions: { maxVideos: 1 }
  });
  const { store, activations, drops } = harness;
  store.activateSession(session());
  store.activateSession(session({
    sessionId: 'session-b',
    stableVideoIdentity: 'video-b'
  }));

  assert.deepEqual(drops, [['scene-1']]);
  store.activateSession(session({
    sessionId: 'session-a-new',
    stableVideoIdentity: 'video-a',
    videoGeneration: 2
  }));
  assert.equal(activations.at(-1).scene.sceneInstanceId, 'scene-3');
  assert.deepEqual(drops, [['scene-1'], ['scene-2']]);

  store.destroy();
  store.destroy();
  assert.deepEqual(drops, [['scene-1'], ['scene-2'], ['scene-3']]);
});

test('activation and lifecycle observer exceptions never reject primary store work', () => {
  const activationHarness = createObserverHarness({
    activateScene() {
      throw new Error('activation-injected');
    }
  });
  assert.equal(activationHarness.store.activateSession(session()).accepted, true);
  assert.equal(activationHarness.store.addStroke(stroke('after-activation-failure')).applied, true);
  assert.equal(activationHarness.store.getActiveSceneSnapshot().objects.length, 1);
  assert.deepEqual(activationHarness.quarantines, [{
    sceneInstanceId: 'scene-1',
    reason: 'observer-failed'
  }]);
  assert.equal(activationHarness.store.getDiagnostics().observerFailureCount, 1);

  const lifecycleHarness = createObserverHarness({
    storeOptions: { maxVideos: 1 },
    dropScenes() {
      throw new Error('drop-injected');
    }
  });
  assert.equal(lifecycleHarness.store.activateSession(session()).accepted, true);
  assert.equal(lifecycleHarness.store.activateSession(session({
    sessionId: 'session-b', stableVideoIdentity: 'video-b'
  })).accepted, true);
  assert.equal(lifecycleHarness.store.getDiagnostics().observerLifecycleFailureCount, 1);
  lifecycleHarness.store.destroy();
  assert.equal(lifecycleHarness.store.getDiagnostics().observerLifecycleFailureCount, 2);
});

test('warm activation view and destroy callback reentry cannot mutate or recreate primary scenes', () => {
  let activationCount = 0;
  const activationHarness = createObserverHarness({
    activateScene(_scene, authoritativeObjects) {
      activationCount += 1;
      if (activationCount !== 2) return;
      for (const record of authoritativeObjects.values()) {
        if (record?.style) record.style.color = '#000000';
      }
      authoritativeObjects.clear();
    }
  });
  const record = stroke('activation-alias');
  activationHarness.store.activateSession(session());
  activationHarness.store.addStroke(record);
  activationHarness.store.deactivateSession('session-a');
  activationHarness.store.activateSession(session({ sessionId: 'session-warm-alias' }));
  assert.deepEqual(activationHarness.store.getActiveSceneSnapshot().objects, [record]);

  let store = null;
  let reentryResult = null;
  let dropCount = 0;
  store = createSessionSceneStore({
    createSceneInstanceId: () => 'scene-destroy-reentry',
    drawingEngineObserver: {
      activateScene() {},
      dropScenes() {
        dropCount += 1;
        reentryResult = store.activateSession(session({ sessionId: 'destroy-reentry' }));
      }
    }
  });
  store.activateSession(session());
  store.destroy();
  store.destroy();
  assert.deepEqual(reentryResult, { accepted: false, reason: 'store-destroyed' });
  assert.equal(dropCount, 1);
  assert.equal(store.getDiagnostics().sceneCount, 0);
  assert.equal(store.addStroke(stroke('after-destroy')).applied, false);
});

test('real adapter stays synced through live split movement Undo and Redo', () => {
  const scheduled = [];
  let adapterId = 0;
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-${++adapterId}`,
    nowIso: () => '2026-07-23T01:02:03.456Z',
    latencyNow: () => 0,
    scheduleWork: callback => scheduled.push(callback),
    fallbackScheduleWork: callback => scheduled.push(callback)
  });
  const store = createSessionSceneStore({
    drawingEngineObserver: adapter,
    createSceneInstanceId: () => 'scene-integrated'
  });
  const flushAll = () => {
    while (scheduled.length > 0) scheduled.shift()();
  };

  store.activateSession(session());
  const original = stroke('integrated-original', { transform: { left: 1, top: 2 } });
  const survivor = stroke('integrated-survivor', { transform: { left: 20, top: 30 } });
  const inside = stroke('integrated-inside', { transform: { left: 1, top: 2 } });
  const outside = stroke('integrated-outside', { transform: { left: 1, top: 2 } });
  store.addStroke(original);
  store.deactivateSession('session-a');
  assert.equal(store.activateSession(session({ sessionId: 'session-warm' })).accepted, true);
  store.addStroke(survivor);
  store.replaceObjects({
    kind: 'split-stroke',
    replacements: [{ removeId: original.id, addObjects: [inside, outside] }],
    selectedObjectIds: [inside.id, survivor.id],
    transforms: [{ id: survivor.id, transform: { left: 40, top: 50 } }],
    dx: 7,
    dy: -3
  });
  flushAll();

  let projection = adapter.getSceneProjection('scene-integrated');
  assert.ok(projection);
  assert.equal(projection.headSequence, 3);
  assert.deepEqual(
    projection.document.layers[0].keyframes[0].objects.map(object => object.id),
    [inside.id, outside.id, survivor.id]
  );
  assert.deepEqual(
    projection.document.layers[0].keyframes[0].objects[0].transform,
    [1, 0, 0, 1, 7, -3]
  );

  assert.equal(store.undo().applied, true);
  flushAll();
  projection = adapter.getSceneProjection('scene-integrated');
  assert.ok(projection);
  assert.equal(projection.headSequence, 4);
  assert.deepEqual(
    projection.document.layers[0].keyframes[0].objects.map(object => object.id),
    [original.id, survivor.id]
  );

  assert.equal(store.redo().applied, true);
  flushAll();
  projection = adapter.getSceneProjection('scene-integrated');
  assert.ok(projection);
  assert.equal(projection.headSequence, 5);
  assert.deepEqual(
    projection.document.layers[0].keyframes[0].objects.map(object => object.id),
    [inside.id, outside.id, survivor.id]
  );
});

test('warm source dimension mismatch quarantines only the shadow projection', () => {
  const scheduled = [];
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-fixed`,
    nowIso: () => '2026-07-23T01:02:03.456Z',
    latencyNow: () => 0,
    scheduleWork: callback => scheduled.push(callback),
    fallbackScheduleWork: callback => scheduled.push(callback)
  });
  const store = createSessionSceneStore({
    drawingEngineObserver: adapter,
    createSceneInstanceId: () => 'scene-dimensions'
  });

  assert.equal(store.activateSession(session()).accepted, true);
  assert.equal(store.deactivateSession('session-a').accepted, true);
  assert.equal(store.activateSession(session({
    sessionId: 'session-resized-source',
    sourceWidth: 1280
  })).accepted, true);
  assert.equal(adapter.getSceneProjection('scene-dimensions'), null);
  assert.equal(adapter.getDiagnostics('scene-dimensions').lastReason, 'seed-signature-changed');
  assert.equal(store.addStroke(stroke('primary-still-works')).applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 1);
});

test('a final enqueue exception immediately hides the real shadow without rolling back Fabric', () => {
  let adapterId = 0;
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-${++adapterId}`,
    nowIso: () => '2026-07-23T01:02:03.456Z',
    latencyNow: () => 0,
    scheduleWork() {
      throw new Error('must-not-schedule');
    },
    fallbackScheduleWork() {
      throw new Error('must-not-fallback');
    }
  });
  const observer = {
    activateScene: adapter.activateScene,
    quarantineScene: adapter.quarantineScene,
    dropScenes: adapter.dropScenes,
    enqueueTransition() {
      throw new Error('enqueue-injected');
    }
  };
  const store = createSessionSceneStore({
    drawingEngineObserver: observer,
    createSceneInstanceId: () => 'scene-enqueue-failure'
  });

  store.activateSession(session());
  assert.equal(store.addStroke(stroke('fabric-survives')).applied, true);
  assert.equal(store.getActiveSceneSnapshot().objects.length, 1);
  assert.equal(adapter.getSceneProjection('scene-enqueue-failure'), null);
  assert.equal(adapter.getDiagnostics('scene-enqueue-failure').lastReason, 'observer-failed');
});

test('same-ID replacement is committed only to Fabric and quarantined as a new stroke incarnation', () => {
  const scheduled = [];
  let adapterId = 0;
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-${++adapterId}`,
    nowIso: () => '2026-07-23T01:02:03.456Z',
    latencyNow: () => 0,
    scheduleWork: callback => scheduled.push(callback),
    fallbackScheduleWork: callback => scheduled.push(callback)
  });
  const store = createSessionSceneStore({
    drawingEngineObserver: adapter,
    createSceneInstanceId: () => 'scene-reincarnation'
  });
  store.activateSession(session());
  const original = stroke('same-id');
  store.addStroke(original);
  while (scheduled.length > 0) scheduled.shift()();

  assert.equal(store.replaceObjects({
    kind: 'split-stroke',
    replacements: [{
      removeId: original.id,
      addObjects: [stroke(original.id, { style: { color: '#4a9eff' } })]
    }]
  }).applied, true);
  while (scheduled.length > 0) scheduled.shift()();

  assert.equal(store.getActiveSceneSnapshot().objects[0].style.color, '#4a9eff');
  assert.equal(adapter.getSceneProjection('scene-reincarnation'), null);
  assert.equal(
    adapter.getDiagnostics('scene-reincarnation').lastReason,
    'unsupported-field-mutation'
  );
});
