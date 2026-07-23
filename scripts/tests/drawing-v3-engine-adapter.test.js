'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createDrawingEngineAdapter
} = require('../../renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js');
const {
  createDrawingDocumentV3
} = require('../../renderer/scripts/modules/drawing-v3/drawing-document.js');

const DIAGNOSTIC_KEYS = [
  'bootstrapCount',
  'commitCount',
  'divergenceCount',
  'enabled',
  'estimatedBytes',
  'failureCount',
  'gapCount',
  'headSequence',
  'lastReason',
  'latencyP50Ms',
  'latencyP95Ms',
  'objectCount',
  'resyncCount',
  'sceneCount',
  'staleCount',
  'status'
].sort();

function makeTransform(overrides = {}) {
  return {
    left: 10,
    top: 20,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
    ...overrides
  };
}

function makeRecord(id = 'stroke-1', overrides = {}) {
  const sourcePoints = overrides.sourcePoints || [
    { x: 1, y: 2, pressure: 0.25, time: 0, pointerType: 'pen' },
    { x: 3, y: 4, pressure: 0.75, time: 1, pointerType: 'pen' }
  ];
  const style = {
    color: '#FF4757',
    size: 7,
    opacity: 0.8,
    ...(overrides.style || {})
  };
  const transform = makeTransform(overrides.transform);
  const record = {
    id,
    type: 'stroke',
    pathData: 'M 0 0 Z',
    sourcePoints,
    style,
    transform,
    ...overrides
  };
  record.style = style;
  record.transform = transform;
  record.sourcePoints = sourcePoints;
  return record;
}

function makeScene(overrides = {}) {
  return {
    sceneInstanceId: 'scene-1',
    targetFrame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    mutationSequence: 0,
    ...overrides
  };
}

function eventScene(scene) {
  return {
    sceneInstanceId: scene.sceneInstanceId,
    targetFrame: scene.targetFrame,
    sourceWidth: scene.sourceWidth,
    sourceHeight: scene.sourceHeight
  };
}

function makeEvent(scene, mutationSequence, overrides = {}) {
  return {
    scene: eventScene(scene),
    mutationSequence,
    origin: 'live',
    kind: 'add-objects',
    unsupportedReason: null,
    removals: [],
    insertions: [],
    transforms: [],
    estimatedBytes: 256,
    ...overrides
  };
}

function makeIdFactory(log = []) {
  let sequence = 0;
  return prefix => {
    log.push(prefix);
    sequence += 1;
    return `${prefix}-${sequence}`;
  };
}

function makeHarness(overrides = {}) {
  const scheduled = [];
  const documentOptions = [];
  const commands = [];
  const idPrefixes = [];
  const createDocument = overrides.createDocument || (options => {
    documentOptions.push(structuredClone(options));
    const document = createDrawingDocumentV3(options);
    return {
      ...document,
      applyCommand(command, applyOptions) {
        commands.push({
          command: structuredClone(command),
          applyOptions: structuredClone(applyOptions)
        });
        return document.applyCommand(command, applyOptions);
      }
    };
  });
  const scheduleWork = Object.hasOwn(overrides, 'scheduleWork')
    ? overrides.scheduleWork
    : callback => scheduled.push(callback);
  const fallbackScheduleWork = Object.hasOwn(overrides, 'fallbackScheduleWork')
    ? overrides.fallbackScheduleWork
    : callback => scheduled.push(callback);
  const adapter = createDrawingEngineAdapter({
    createDocument,
    createId: overrides.createId || makeIdFactory(idPrefixes),
    nowIso: overrides.nowIso || (() => '2026-07-23T01:02:03.456Z'),
    latencyNow: overrides.latencyNow || (() => 0),
    scheduleWork,
    fallbackScheduleWork,
    limits: overrides.limits
  });
  return {
    adapter,
    scheduled,
    documentOptions,
    commands,
    idPrefixes,
    flushOne() {
      assert.ok(scheduled.length > 0, 'expected scheduled adapter work');
      scheduled.shift()();
    },
    flushAll(maximum = 100) {
      let count = 0;
      while (scheduled.length > 0) {
        assert.ok(count < maximum, 'adapter work did not drain');
        scheduled.shift()();
        count += 1;
      }
    }
  };
}

function projectionObjects(adapter, sceneInstanceId) {
  const projection = adapter.getSceneProjection(sceneInstanceId);
  assert.ok(projection, 'expected a synced scene projection');
  return projection.document.layers[0].keyframes[0].objects;
}

function transformEvent(scene, sequence, id, beforeTransform, afterTransform) {
  return makeEvent(scene, sequence, {
    kind: 'transform-objects',
    transforms: [{ id, beforeTransform, afterTransform }]
  });
}

test('bootstraps the exact provisional document skeleton and reuses a warm scene', () => {
  const harness = makeHarness();
  const scene = makeScene({
    sceneInstanceId: 'C:\\private\\movie.mov\u0000frame-12',
    mutationSequence: 7
  });

  assert.deepEqual(harness.adapter.activateScene(scene, new Map()), {
    activated: true,
    restored: false
  });
  assert.equal(harness.documentOptions.length, 1);
  assert.deepEqual(harness.documentOptions[0], {
    documentId: 'document-1',
    coordinateSpace: {
      unit: 'source-pixel',
      origin: 'top-left',
      yAxis: 'down',
      pixelRatio: 1,
      width: 1920,
      height: 1080
    },
    timebase: {
      fpsNumerator: 1,
      fpsDenominator: 1,
      totalFrames: 13
    },
    initialLayers: [{
      id: 'layer-2',
      name: 'Session shadow',
      visible: true,
      locked: false,
      opacity: 1,
      keyframes: [{
        id: 'keyframe-3',
        frame: 12,
        empty: false,
        revision: 0,
        objects: []
      }]
    }],
    revisionSequence: 7
  });
  assert.deepEqual(harness.idPrefixes, [
    'document', 'layer', 'keyframe', 'actor'
  ]);
  assert.deepEqual(harness.adapter.activateScene(scene, new Map()), {
    activated: true,
    restored: true
  });
  assert.equal(harness.documentOptions.length, 1);
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).bootstrapCount, 1);
  assert.doesNotMatch(
    JSON.stringify(harness.documentOptions[0]),
    /private|movie\.mov/
  );
});

test('projects exact points, style, opacity, caps and isolates input aliases', () => {
  const harness = makeHarness();
  const scene = makeScene();
  const first = makeRecord('opaque-stroke-a', {
    strokeCaps: { start: false, end: true }
  });
  const second = makeRecord('opaque-stroke-b', {
    style: { color: '#ABCDEF', size: 3, opacity: 1 }
  });
  const authoritative = new Map([
    [first.id, first],
    [second.id, second]
  ]);

  assert.equal(harness.adapter.activateScene(scene, authoritative).activated, true);
  first.sourcePoints[0].x = 999;
  first.style.color = '#000000';
  first.strokeCaps.start = true;
  authoritative.delete(second.id);

  assert.deepEqual(projectionObjects(harness.adapter, scene.sceneInstanceId), [
    {
      id: 'opaque-stroke-a',
      type: 'stroke',
      tool: 'brush',
      visible: true,
      locked: false,
      opacity: 0.8,
      blendMode: 'source-over',
      transform: [1, 0, 0, 1, 0, 0],
      points: [
        { x: 1, y: 2, pressure: 0.25, time: 0 },
        { x: 3, y: 4, pressure: 0.75, time: 1 }
      ],
      caps: { start: false, end: true },
      style: {
        color: '#ff4757',
        size: 7,
        thinning: 0.65,
        smoothing: 0.55,
        streamline: 0.5,
        outlineColor: null,
        outlineWidth: 0
      }
    },
    {
      id: 'opaque-stroke-b',
      type: 'stroke',
      tool: 'brush',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'source-over',
      transform: [1, 0, 0, 1, 0, 0],
      points: [
        { x: 1, y: 2, pressure: 0.25, time: 0 },
        { x: 3, y: 4, pressure: 0.75, time: 1 }
      ],
      caps: { start: true, end: true },
      style: {
        color: '#abcdef',
        size: 3,
        thinning: 0.65,
        smoothing: 0.55,
        streamline: 0.5,
        outlineColor: null,
        outlineWidth: 0
      }
    }
  ]);
});

test('quarantines invalid and over-budget seeds without throwing', () => {
  const invalidHarness = makeHarness();
  const invalidScene = makeScene({ sourceWidth: 0 });
  assert.doesNotThrow(() => {
    assert.deepEqual(
      invalidHarness.adapter.activateScene(invalidScene, new Map()),
      { activated: false, restored: false, reason: 'invalid-seed' }
    );
  });
  assert.equal(
    invalidHarness.adapter.getSceneProjection(invalidScene.sceneInstanceId),
    null
  );
  assert.equal(
    invalidHarness.adapter.getDiagnostics(invalidScene.sceneInstanceId).lastReason,
    'invalid-seed'
  );

  const frameHarness = makeHarness();
  const overflowFrame = makeScene({
    sceneInstanceId: 'frame-overflow',
    targetFrame: Number.MAX_SAFE_INTEGER
  });
  assert.equal(
    frameHarness.adapter.activateScene(overflowFrame, new Map()).reason,
    'invalid-seed'
  );

  const capacityHarness = makeHarness({ limits: { maxSeedObjects: 1 } });
  const capacityScene = makeScene({ sceneInstanceId: 'seed-capacity' });
  assert.equal(capacityHarness.adapter.activateScene(capacityScene, new Map([
    ['a', makeRecord('a')],
    ['b', makeRecord('b')]
  ])).reason, 'seed-capacity-exceeded');

  const byteHarness = makeHarness({ limits: { maxSeedBytes: 64 } });
  const byteScene = makeScene({ sceneInstanceId: 'seed-bytes' });
  assert.equal(
    byteHarness.adapter.activateScene(
      byteScene,
      new Map([['a', makeRecord('a')]])
    ).reason,
    'seed-capacity-exceeded'
  );

  const invalidObjectHarness = makeHarness();
  const invalidObjectScene = makeScene({ sceneInstanceId: 'invalid-object' });
  const invalidRecord = makeRecord('broken');
  invalidRecord.sourcePoints[0].pressure = 2;
  assert.equal(
    invalidObjectHarness.adapter.activateScene(
      invalidObjectScene,
      new Map([['broken', invalidRecord]])
    ).reason,
    'invalid-seed'
  );
});

test('applies add, translate, delete and clear with stable order and relative transforms', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  const a = makeRecord('a', { transform: { left: 1, top: 2 } });
  const b = makeRecord('b', { transform: { left: 20, top: 30 } });
  harness.adapter.activateScene(scene, new Map([['a', a], ['b', b]]));
  const c = makeRecord('c', { transform: { left: 100, top: 200 } });

  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 1, {
    insertions: [{ index: 1, record: c, baseTransform: c.transform }]
  })).applied, true);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId).map(item => item.id),
    ['a', 'c', 'b']
  );

  assert.equal(harness.adapter.applyTransition(transformEvent(
    scene,
    2,
    'c',
    makeTransform({ left: 100, top: 200 }),
    makeTransform({ left: 105, top: 198 })
  )).applied, true);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId)
      .find(item => item.id === 'c').transform,
    [1, 0, 0, 1, 5, -2]
  );

  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 3, {
    kind: 'delete-objects',
    removals: [{ id: 'a', index: 0 }]
  })).applied, true);
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 4, {
    kind: 'clear-keyframe',
    removals: [{ id: 'c', index: 0 }, { id: 'b', index: 1 }]
  })).applied, true);
  assert.deepEqual(projectionObjects(harness.adapter, scene.sceneInstanceId), []);
  assert.equal(harness.commands.length, 4);
  assert.deepEqual(harness.commands.map(entry => entry.command.kind), [
    'add-objects',
    'transform-objects',
    'delete-objects',
    'delete-objects'
  ]);
});

test('maps lasso replacement and movement to one atomic split command', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  const original = makeRecord('original', { transform: { left: 0, top: 0 } });
  const tail = makeRecord('tail');
  harness.adapter.activateScene(
    scene,
    new Map([['original', original], ['tail', tail]])
  );
  const inside = makeRecord('inside', {
    transform: { left: 100, top: 200 },
    strokeCaps: { start: true, end: false }
  });
  const outside = makeRecord('outside', {
    transform: { left: 300, top: 400 },
    strokeCaps: { start: false, end: true }
  });

  const result = harness.adapter.applyTransition(makeEvent(scene, 1, {
    kind: 'split-stroke',
    removals: [{ id: 'original', index: 0 }],
    insertions: [
      { index: 0, record: inside, baseTransform: inside.transform },
      { index: 1, record: outside, baseTransform: outside.transform }
    ],
    transforms: [{
      id: 'inside',
      beforeTransform: makeTransform({ left: 100, top: 200 }),
      afterTransform: makeTransform({ left: 112, top: 191 })
    }]
  }));

  assert.equal(result.applied, true);
  assert.equal(harness.commands.length, 1);
  assert.equal(harness.commands[0].command.kind, 'split-stroke');
  assert.deepEqual(
    harness.commands[0].command.operations.map(operation => operation.type),
    ['remove-objects', 'insert-objects', 'set-transforms']
  );
  const projected = projectionObjects(harness.adapter, scene.sceneInstanceId);
  assert.deepEqual(projected.map(item => item.id), ['inside', 'outside', 'tail']);
  assert.deepEqual(projected[0].caps, { start: true, end: false });
  assert.deepEqual(projected[1].caps, { start: false, end: true });
  assert.deepEqual(projected[0].transform, [1, 0, 0, 1, 12, -9]);
});

test('keeps baseline archives through split Undo and Redo history transitions', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  const original = makeRecord('original', { transform: { left: 5, top: 6 } });
  harness.adapter.activateScene(scene, new Map([['original', original]]));
  const inside = makeRecord('inside', {
    transform: { left: 100, top: 200 },
    strokeCaps: { start: true, end: false }
  });
  const outside = makeRecord('outside', {
    transform: { left: 300, top: 400 },
    strokeCaps: { start: false, end: true }
  });

  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 1, {
    kind: 'split-stroke',
    removals: [{ id: 'original', index: 0 }],
    insertions: [
      { index: 0, record: inside, baseTransform: inside.transform },
      { index: 1, record: outside, baseTransform: outside.transform }
    ],
    transforms: [{
      id: 'inside',
      beforeTransform: makeTransform({ left: 100, top: 200 }),
      afterTransform: makeTransform({ left: 110, top: 205 })
    }]
  })).applied, true);

  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 2, {
    origin: 'history',
    kind: 'split-stroke',
    removals: [{ id: 'inside', index: 0 }, { id: 'outside', index: 1 }],
    insertions: [{
      index: 0,
      record: original,
      baseTransform: null
    }]
  })).applied, true);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId).map(item => item.id),
    ['original']
  );

  const replayInside = makeRecord('inside', {
    transform: { left: 110, top: 205 },
    strokeCaps: { start: true, end: false }
  });
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 3, {
    origin: 'history',
    kind: 'split-stroke',
    removals: [{ id: 'original', index: 0 }],
    insertions: [
      { index: 0, record: replayInside, baseTransform: null },
      { index: 1, record: outside, baseTransform: null }
    ]
  })).applied, true);
  const replayed = projectionObjects(harness.adapter, scene.sceneInstanceId);
  assert.deepEqual(replayed.map(item => item.id), ['inside', 'outside']);
  assert.deepEqual(replayed[0].transform, [1, 0, 0, 1, 10, 5]);
  assert.deepEqual(harness.commands.map(entry => entry.applyOptions), [
    { source: 'user' },
    { source: 'history' },
    { source: 'history' }
  ]);
  assert.deepEqual(harness.commands.map(entry => entry.command.baseRevision), [0, 1, 2]);
});

test('keeps add, delete, Undo and Redo translations relative to the first live baseline', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  const stroke = makeRecord('stroke', { transform: { left: 50, top: 60 } });
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 1, {
    insertions: [{ index: 0, record: stroke, baseTransform: stroke.transform }]
  })).applied, true);
  assert.equal(harness.adapter.applyTransition(transformEvent(
    scene,
    2,
    'stroke',
    makeTransform({ left: 50, top: 60 }),
    makeTransform({ left: 55, top: 65 })
  )).applied, true);
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 3, {
    kind: 'delete-objects',
    removals: [{ id: 'stroke', index: 0 }]
  })).applied, true);
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 4, {
    origin: 'history',
    insertions: [{
      index: 0,
      record: makeRecord('stroke', { transform: { left: 55, top: 65 } }),
      baseTransform: null
    }]
  })).applied, true);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId)[0].transform,
    [1, 0, 0, 1, 5, 5]
  );
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 5, {
    origin: 'history',
    kind: 'delete-objects',
    removals: [{ id: 'stroke', index: 0 }]
  })).applied, true);
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 6, {
    origin: 'history',
    insertions: [{ index: 0, record: stroke, baseTransform: null }]
  })).applied, true);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId)[0].transform,
    [1, 0, 0, 1, 0, 0]
  );
});

test('quarantines a history insertion whose live baseline was never observed', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  const result = harness.adapter.applyTransition(makeEvent(scene, 1, {
    origin: 'history',
    insertions: [{
      index: 0,
      record: makeRecord('unknown'),
      baseTransform: null
    }]
  }));
  assert.deepEqual(result, { applied: false, reason: 'missing-baseline' });
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
  assert.equal(
    harness.adapter.getDiagnostics(scene.sceneInstanceId).lastReason,
    'missing-baseline'
  );
});

test('rejects a live object ID reincarnation instead of overwriting its lifetime baseline', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  const original = makeRecord('same-id');
  harness.adapter.activateScene(scene, new Map([['same-id', original]]));
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 1, {
    kind: 'delete-objects',
    removals: [{ id: 'same-id', index: 0 }]
  })).applied, true);

  const replacement = makeRecord('same-id', {
    sourcePoints: [
      { x: 100, y: 200, pressure: 0.5, time: 0 },
      { x: 110, y: 210, pressure: 0.5, time: 1 }
    ]
  });
  const result = harness.adapter.applyTransition(makeEvent(scene, 2, {
    insertions: [{
      index: 0,
      record: replacement,
      baseTransform: replacement.transform
    }]
  }));

  assert.deepEqual(result, {
    applied: false,
    reason: 'unsupported-field-mutation'
  });
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
});

test('history reinsertion must match the archived immutable stroke content', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  const original = makeRecord('archived');
  harness.adapter.activateScene(scene, new Map([['archived', original]]));
  assert.equal(harness.adapter.applyTransition(makeEvent(scene, 1, {
    kind: 'delete-objects',
    removals: [{ id: 'archived', index: 0 }]
  })).applied, true);

  const changed = makeRecord('archived', {
    style: { color: '#00FF00', size: 7, opacity: 0.8 }
  });
  const result = harness.adapter.applyTransition(makeEvent(scene, 2, {
    origin: 'history',
    insertions: [{ index: 0, record: changed, baseTransform: null }]
  }));

  assert.deepEqual(result, {
    applied: false,
    reason: 'unsupported-field-mutation'
  });
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
});

test('a first live insertion must start at its declared baseline transform', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  const record = makeRecord('offset-at-birth', {
    transform: { left: 50, top: 20 }
  });
  const result = harness.adapter.applyTransition(makeEvent(scene, 1, {
    insertions: [{
      index: 0,
      record,
      baseTransform: makeTransform({ left: 10, top: 20 })
    }]
  }));

  assert.deepEqual(result, {
    applied: false,
    reason: 'transition-before-mismatch'
  });
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
});

test('warm activation and UI-only lifecycle do not create commands or resync divergence', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  const objects = new Map([['a', makeRecord('a')]]);
  harness.adapter.activateScene(scene, objects);
  harness.adapter.activateScene(scene, objects);
  assert.equal(harness.commands.length, 0);
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 0);

  harness.adapter.applyTransition(makeEvent(scene, 2, {
    kind: 'delete-objects',
    removals: [{ id: 'a', index: 0 }]
  }));
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
  assert.deepEqual(harness.adapter.activateScene(scene, objects), {
    activated: false,
    restored: true,
    reason: 'sequence-gap'
  });
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).bootstrapCount, 1);
});

test('quarantines warm activation sequence and object-count mismatches without rescanning', () => {
  for (const mismatch of ['sequence', 'object-count', 'object-identity']) {
    const harness = makeHarness();
    const scene = makeScene({ sceneInstanceId: `warm-${mismatch}`, targetFrame: 0 });
    const objects = new Map([['a', makeRecord('a')]]);
    assert.equal(harness.adapter.activateScene(scene, objects).activated, true);
    const warmScene = mismatch === 'sequence'
      ? { ...scene, mutationSequence: 1 }
      : scene;
    const warmObjects = mismatch === 'object-count'
      ? new Map([...objects, ['b', makeRecord('b')]])
      : mismatch === 'object-identity'
        ? new Map([['b', makeRecord('b')]])
        : objects;

    assert.deepEqual(harness.adapter.activateScene(warmScene, warmObjects), {
      activated: false,
      restored: true,
      reason: 'warm-seed-mismatch'
    });
    assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
  }
});

test('warm activation accepts the authoritative state already represented by pending events', () => {
  const harness = makeHarness();
  const scene = makeScene({ sceneInstanceId: 'warm-pending', targetFrame: 0 });
  const record = makeRecord('pending');
  harness.adapter.activateScene(scene, new Map());
  assert.equal(harness.adapter.enqueueTransition(makeEvent(scene, 1, {
    insertions: [{
      index: 0,
      record,
      baseTransform: record.transform
    }]
  })), true);

  assert.deepEqual(harness.adapter.activateScene(
    { ...scene, mutationSequence: 1 },
    new Map([['pending', record]])
  ), {
    activated: true,
    restored: true
  });
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 0);
  harness.flushAll();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 1);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId).map(item => item.id),
    ['pending']
  );
});

test('quarantines duplicate, gap, field, order and unsupported transform events', () => {
  const cases = [
    {
      id: 'duplicate',
      event: scene => makeEvent(scene, 0),
      reason: 'stale-transition',
      counter: 'staleCount'
    },
    {
      id: 'gap',
      event: scene => makeEvent(scene, 2),
      reason: 'sequence-gap',
      counter: 'gapCount'
    },
    {
      id: 'field',
      event: scene => makeEvent(scene, 1, {
        unsupportedReason: 'unsupported-field-mutation'
      }),
      reason: 'unsupported-field-mutation'
    },
    {
      id: 'order',
      event: scene => makeEvent(scene, 1, {
        unsupportedReason: 'unsupported-order-mutation'
      }),
      reason: 'unsupported-order-mutation'
    },
    {
      id: 'transform',
      event: scene => transformEvent(
        scene,
        1,
        'a',
        makeTransform(),
        makeTransform({ scaleX: 2 })
      ),
      reason: 'unsupported-transform'
    },
    {
      id: 'before-mismatch',
      event: scene => transformEvent(
        scene,
        1,
        'a',
        makeTransform({ left: 999 }),
        makeTransform({ left: 1000 })
      ),
      reason: 'transition-before-mismatch'
    }
  ];
  for (const item of cases) {
    const harness = makeHarness();
    const scene = makeScene({ sceneInstanceId: item.id, targetFrame: 0 });
    harness.adapter.activateScene(scene, new Map([['a', makeRecord('a')]]));
    const result = harness.adapter.applyTransition(item.event(scene));
    assert.equal(result.applied, false, item.id);
    assert.equal(result.reason, item.reason, item.id);
    const diagnostics = harness.adapter.getDiagnostics(scene.sceneInstanceId);
    assert.equal(diagnostics.lastReason, item.reason, item.id);
    if (item.counter) assert.equal(diagnostics[item.counter], 1, item.id);
    assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
  }
});

test('quarantines changed scene signatures instead of bootstrapping a hidden resync', () => {
  const harness = makeHarness();
  const scene = makeScene();
  harness.adapter.activateScene(scene, new Map());
  const changed = makeScene({ sourceWidth: 1280 });
  assert.deepEqual(harness.adapter.activateScene(changed, new Map()), {
    activated: false,
    restored: true,
    reason: 'seed-signature-changed'
  });
  assert.equal(harness.documentOptions.length, 1);
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
});

test('isolates converter, document apply and activation failures by scene', () => {
  let documentCount = 0;
  const harness = makeHarness({
    createDocument(options) {
      documentCount += 1;
      if (documentCount === 1) {
        const document = createDrawingDocumentV3(options);
        return {
          ...document,
          applyCommand() {
            throw new Error('C:\\private\\apply exploded');
          }
        };
      }
      if (documentCount === 2) throw new Error('activation exploded');
      return createDrawingDocumentV3(options);
    }
  });
  const a = makeScene({ sceneInstanceId: 'scene-a', targetFrame: 0 });
  const activationFailure = makeScene({
    sceneInstanceId: 'scene-activation-failure',
    targetFrame: 0
  });
  const b = makeScene({ sceneInstanceId: 'scene-b', targetFrame: 0 });
  harness.adapter.activateScene(a, new Map());
  assert.doesNotThrow(() => harness.adapter.applyTransition(makeEvent(a, 1, {
    insertions: [{
      index: 0,
      record: makeRecord('a'),
      baseTransform: makeTransform()
    }]
  })));
  assert.equal(harness.adapter.getSceneProjection(a.sceneInstanceId), null);

  assert.doesNotThrow(() => {
    assert.equal(
      harness.adapter.activateScene(activationFailure, new Map()).activated,
      false
    );
  });
  assert.equal(
    harness.adapter.getSceneProjection(activationFailure.sceneInstanceId),
    null
  );

  assert.equal(harness.adapter.activateScene(b, new Map()).activated, true);
  assert.equal(harness.adapter.applyTransition(makeEvent(b, 1, {
    insertions: [{
      index: 0,
      record: makeRecord('b'),
      baseTransform: makeTransform()
    }]
  })).applied, true);
  assert.deepEqual(projectionObjects(harness.adapter, b.sceneInstanceId)
    .map(item => item.id), ['b']);
  assert.doesNotMatch(JSON.stringify(harness.adapter.getDiagnostics()), /private/);
});

test('hides a document that reports a sequence different from the Fabric event', () => {
  const harness = makeHarness({
    createDocument(options) {
      const document = createDrawingDocumentV3(options);
      return {
        ...document,
        applyCommand(command, applyOptions) {
          const result = document.applyCommand(command, applyOptions);
          return { ...result, sequence: result.sequence + 1 };
        }
      };
    }
  });
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  const result = harness.adapter.applyTransition(makeEvent(scene, 1, {
    insertions: [{
      index: 0,
      record: makeRecord('a'),
      baseTransform: makeTransform()
    }]
  }));
  assert.deepEqual(result, {
    applied: false,
    reason: 'document-sequence-mismatch'
  });
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
});

test('uses ISO time only for commands and the monotonic clock only for latency', () => {
  const monotonicCalls = [];
  let monotonic = 40;
  const harness = makeHarness({
    nowIso: () => '2027-01-02T03:04:05.006Z',
    latencyNow: () => {
      monotonicCalls.push(monotonic);
      monotonic += 0.5;
      return monotonic;
    }
  });
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  harness.adapter.enqueueTransition(makeEvent(scene, 1, {
    insertions: [{
      index: 0,
      record: makeRecord('a'),
      baseTransform: makeTransform()
    }]
  }));
  harness.flushAll();
  assert.equal(harness.commands[0].command.createdAt, '2027-01-02T03:04:05.006Z');
  assert.ok(monotonicCalls.length >= 2);
  assert.ok(harness.adapter.getDiagnostics(scene.sceneInstanceId).latencyP50Ms >= 0);
});

test('runs at most four queued items per macrotask and preserves FIFO order', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map([['a', makeRecord('a')]]));
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    assert.equal(harness.adapter.enqueueTransition(transformEvent(
      scene,
      sequence,
      'a',
      makeTransform({ left: 10 + sequence - 1 }),
      makeTransform({ left: 10 + sequence })
    )), true);
  }
  assert.equal(harness.scheduled.length, 1);
  harness.flushOne();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 4);
  assert.equal(harness.scheduled.length, 1);
  harness.flushOne();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 5);
  assert.deepEqual(
    projectionObjects(harness.adapter, scene.sceneInstanceId)[0].transform,
    [1, 0, 0, 1, 5, 0]
  );
});

test('ignores a duplicate callback from an older scheduled queue slice', () => {
  const harness = makeHarness();
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map([['a', makeRecord('a')]]));
  for (let sequence = 1; sequence <= 5; sequence += 1) {
    harness.adapter.enqueueTransition(transformEvent(
      scene,
      sequence,
      'a',
      makeTransform({ left: 10 + sequence - 1 }),
      makeTransform({ left: 10 + sequence })
    ));
  }
  const firstCallback = harness.scheduled.shift();
  firstCallback();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 4);
  assert.equal(harness.scheduled.length, 1);
  firstCallback();
  assert.equal(
    harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence,
    4,
    'an already-consumed scheduler callback must be a no-op'
  );
  harness.flushAll();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 5);
});

test('a synchronous scheduler cannot apply adapter work before enqueue returns', async () => {
  const harness = makeHarness({
    scheduleWork(callback) {
      callback();
    }
  });
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  assert.equal(harness.adapter.enqueueTransition(makeEvent(scene, 1, {
    insertions: [{
      index: 0,
      record: makeRecord('deferred'),
      baseTransform: makeTransform()
    }]
  })), true);

  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 1);
});

test('yields a queue batch after the four millisecond budget', () => {
  let now = 0;
  const harness = makeHarness({
    latencyNow: () => {
      now += 5;
      return now;
    }
  });
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map([['a', makeRecord('a')]]));
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    harness.adapter.enqueueTransition(transformEvent(
      scene,
      sequence,
      'a',
      makeTransform({ left: 10 + sequence - 1 }),
      makeTransform({ left: 10 + sequence })
    ));
  }
  harness.flushOne();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 1);
  assert.equal(harness.scheduled.length, 1);
  harness.flushAll();
  assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 3);
});

test('quarantines only the overflowing scene for item, byte and oversize limits', () => {
  const itemHarness = makeHarness({ limits: { maxQueueItems: 1 } });
  const a = makeScene({ sceneInstanceId: 'item-a', targetFrame: 0 });
  const b = makeScene({ sceneInstanceId: 'item-b', targetFrame: 0 });
  itemHarness.adapter.activateScene(a, new Map());
  itemHarness.adapter.activateScene(b, new Map());
  assert.equal(itemHarness.adapter.enqueueTransition(makeEvent(a, 1, {
    insertions: [{ index: 0, record: makeRecord('a'), baseTransform: makeTransform() }]
  })), true);
  assert.equal(itemHarness.adapter.enqueueTransition(makeEvent(b, 1, {
    insertions: [{ index: 0, record: makeRecord('b'), baseTransform: makeTransform() }]
  })), false);
  assert.equal(itemHarness.adapter.getSceneProjection(b.sceneInstanceId), null);
  itemHarness.flushAll();
  assert.deepEqual(projectionObjects(itemHarness.adapter, a.sceneInstanceId)
    .map(item => item.id), ['a']);

  const byteHarness = makeHarness({ limits: { maxQueueBytes: 10 } });
  const byteA = makeScene({ sceneInstanceId: 'byte-a', targetFrame: 0 });
  const byteB = makeScene({ sceneInstanceId: 'byte-b', targetFrame: 0 });
  byteHarness.adapter.activateScene(byteA, new Map());
  byteHarness.adapter.activateScene(byteB, new Map());
  assert.equal(byteHarness.adapter.enqueueTransition(makeEvent(byteA, 1, {
    estimatedBytes: 6,
    insertions: [{ index: 0, record: makeRecord('a'), baseTransform: makeTransform() }]
  })), true);
  assert.equal(byteHarness.adapter.enqueueTransition(makeEvent(byteB, 1, {
    estimatedBytes: 6,
    insertions: [{ index: 0, record: makeRecord('b'), baseTransform: makeTransform() }]
  })), false);
  assert.equal(
    byteHarness.adapter.getDiagnostics(byteB.sceneInstanceId).lastReason,
    'queue-capacity-exceeded'
  );
  byteHarness.flushAll();
  assert.notEqual(byteHarness.adapter.getSceneProjection(byteA.sceneInstanceId), null);

  const oversizeHarness = makeHarness({ limits: { maxQueueBytes: 10 } });
  const oversize = makeScene({ sceneInstanceId: 'oversize', targetFrame: 0 });
  oversizeHarness.adapter.activateScene(oversize, new Map());
  assert.equal(oversizeHarness.adapter.enqueueTransition(makeEvent(oversize, 1, {
    estimatedBytes: 11
  })), false);
  assert.equal(
    oversizeHarness.adapter.getDiagnostics(oversize.sceneInstanceId).lastReason,
    'queue-event-too-large'
  );

  const accountingHarness = makeHarness({ limits: { maxQueueItems: 2 } });
  const retained = makeScene({ sceneInstanceId: 'retained', targetFrame: 0 });
  const overflowed = makeScene({ sceneInstanceId: 'overflowed', targetFrame: 0 });
  const admitted = makeScene({ sceneInstanceId: 'admitted', targetFrame: 0 });
  for (const candidate of [retained, overflowed, admitted]) {
    accountingHarness.adapter.activateScene(candidate, new Map());
  }
  accountingHarness.adapter.enqueueTransition(makeEvent(retained, 1, {
    insertions: [{ index: 0, record: makeRecord('r'), baseTransform: makeTransform() }]
  }));
  accountingHarness.adapter.enqueueTransition(makeEvent(overflowed, 1, {
    insertions: [{ index: 0, record: makeRecord('o'), baseTransform: makeTransform() }]
  }));
  assert.equal(accountingHarness.adapter.enqueueTransition(makeEvent(overflowed, 2)), false);
  assert.equal(accountingHarness.adapter.enqueueTransition(makeEvent(admitted, 1, {
    insertions: [{ index: 0, record: makeRecord('n'), baseTransform: makeTransform() }]
  })), true, 'removing overflowed-scene payloads must restore exact queue capacity');
  accountingHarness.flushAll();
  assert.deepEqual(projectionObjects(
    accountingHarness.adapter,
    retained.sceneInstanceId
  ).map(item => item.id), ['r']);
  assert.deepEqual(projectionObjects(
    accountingHarness.adapter,
    admitted.sceneInstanceId
  ).map(item => item.id), ['n']);
});

test('scheduler exceptions quarantine the final event immediately and never escape', () => {
  const harness = makeHarness({
    scheduleWork() {
      throw new Error('scheduler exploded');
    },
    fallbackScheduleWork() {
      throw new Error('fallback scheduler exploded');
    }
  });
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  assert.doesNotThrow(() => {
    assert.equal(harness.adapter.enqueueTransition(makeEvent(scene, 1)), false);
  });
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
  assert.equal(
    harness.adapter.getDiagnostics(scene.sceneInstanceId).lastReason,
    'scheduler-failed'
  );
});

test('fallback scheduling drains later scenes and double failure releases every payload', () => {
  const primary = [];
  const fallback = [];
  let primaryCalls = 0;
  const harness = makeHarness({
    scheduleWork(callback) {
      primaryCalls += 1;
      if (primaryCalls === 1) primary.push(callback);
      else throw new Error('primary reschedule failed');
    },
    fallbackScheduleWork: callback => fallback.push(callback),
    limits: { maxWorkItems: 1 }
  });
  const scenes = ['a', 'b', 'c'].map(id => makeScene({
    sceneInstanceId: `fallback-${id}`,
    targetFrame: 0
  }));
  for (const scene of scenes) {
    harness.adapter.activateScene(scene, new Map([['stroke', makeRecord('stroke')]]));
    assert.equal(harness.adapter.enqueueTransition(transformEvent(
      scene,
      1,
      'stroke',
      makeTransform(),
      makeTransform({ left: 11 })
    )), true);
  }
  primary.shift()();
  while (fallback.length > 0) fallback.shift()();
  for (const scene of scenes) {
    assert.equal(harness.adapter.getDiagnostics(scene.sceneInstanceId).headSequence, 1);
  }

  const failedPrimary = [];
  let failedCalls = 0;
  const failed = makeHarness({
    scheduleWork(callback) {
      failedCalls += 1;
      if (failedCalls === 1) failedPrimary.push(callback);
      else throw new Error('primary failed');
    },
    fallbackScheduleWork() {
      throw new Error('fallback failed');
    },
    limits: { maxWorkItems: 1 }
  });
  const failedScenes = ['a', 'b', 'c'].map(id => makeScene({
    sceneInstanceId: `failed-${id}`,
    targetFrame: 0
  }));
  for (const scene of failedScenes) {
    failed.adapter.activateScene(scene, new Map([['stroke', makeRecord('stroke')]]));
    failed.adapter.enqueueTransition(transformEvent(
      scene,
      1,
      'stroke',
      makeTransform(),
      makeTransform({ left: 11 })
    ));
  }
  failedPrimary.shift()();
  assert.equal(failed.adapter.getDiagnostics(failedScenes[0].sceneInstanceId).headSequence, 1);
  for (const scene of failedScenes.slice(1)) {
    assert.equal(failed.adapter.getSceneProjection(scene.sceneInstanceId), null);
    assert.equal(
      failed.adapter.getDiagnostics(scene.sceneInstanceId).lastReason,
      'scheduler-failed'
    );
  }
});

test('enqueue snapshots routing and scalar envelope fields before deferred work', () => {
  const harness = makeHarness();
  const a = makeScene({ sceneInstanceId: 'snapshot-a', targetFrame: 0 });
  const b = makeScene({ sceneInstanceId: 'snapshot-b', targetFrame: 0 });
  for (const scene of [a, b]) {
    harness.adapter.activateScene(scene, new Map([['stroke', makeRecord('stroke')]]));
  }
  const event = transformEvent(
    a,
    1,
    'stroke',
    makeTransform(),
    makeTransform({ left: 11 })
  );
  assert.equal(harness.adapter.enqueueTransition(event), true);
  event.scene.sceneInstanceId = b.sceneInstanceId;
  event.mutationSequence = 99;
  event.transforms = [];
  harness.flushAll();

  assert.equal(harness.adapter.getDiagnostics(a.sceneInstanceId).headSequence, 1);
  assert.equal(harness.adapter.getDiagnostics(b.sceneInstanceId).headSequence, 0);
});

test('drop and destroy discard pending payloads while preserving other scenes', () => {
  const harness = makeHarness();
  const a = makeScene({ sceneInstanceId: 'drop-a', targetFrame: 0 });
  const b = makeScene({ sceneInstanceId: 'keep-b', targetFrame: 0 });
  harness.adapter.activateScene(a, new Map());
  harness.adapter.activateScene(b, new Map());
  harness.adapter.enqueueTransition(makeEvent(a, 1, {
    insertions: [{ index: 0, record: makeRecord('a'), baseTransform: makeTransform() }]
  }));
  harness.adapter.enqueueTransition(makeEvent(b, 1, {
    insertions: [{ index: 0, record: makeRecord('b'), baseTransform: makeTransform() }]
  }));
  assert.equal(harness.adapter.dropScenes([a.sceneInstanceId]), 1);
  harness.flushAll();
  assert.equal(harness.adapter.getSceneProjection(a.sceneInstanceId), null);
  assert.deepEqual(projectionObjects(harness.adapter, b.sceneInstanceId)
    .map(item => item.id), ['b']);

  harness.adapter.enqueueTransition(makeEvent(b, 2, {
    kind: 'delete-objects',
    removals: [{ id: 'b', index: 0 }]
  }));
  harness.adapter.destroy();
  harness.flushAll();
  assert.equal(harness.adapter.getSceneProjection(b.sceneInstanceId), null);
  assert.equal(harness.adapter.getDiagnostics().status, 'destroyed');
  assert.equal(harness.adapter.getDiagnostics().sceneCount, 0);
  assert.equal(harness.adapter.getDiagnostics().estimatedBytes, 0);
  assert.equal(harness.adapter.enqueueTransition(makeEvent(b, 2)), false);
  assert.equal(harness.adapter.dropScenes([b.sceneInstanceId]), 0);
  assert.doesNotThrow(() => harness.adapter.destroy());
});

test('an eviction callback cannot run work from a recreated scene instance ID', () => {
  const harness = makeHarness();
  const scene = makeScene({ sceneInstanceId: 'recreated', targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  harness.adapter.enqueueTransition(makeEvent(scene, 1, {
    insertions: [{ index: 0, record: makeRecord('old'), baseTransform: makeTransform() }]
  }));
  const staleCallback = harness.scheduled.shift();
  assert.equal(harness.adapter.dropScenes([scene.sceneInstanceId]), 1);
  harness.adapter.activateScene(scene, new Map());
  harness.adapter.enqueueTransition(makeEvent(scene, 1, {
    insertions: [{ index: 0, record: makeRecord('new'), baseTransform: makeTransform() }]
  }));
  assert.equal(harness.scheduled.length, 1);
  staleCallback();
  assert.deepEqual(projectionObjects(harness.adapter, scene.sceneInstanceId), []);
  harness.flushAll();
  assert.deepEqual(projectionObjects(harness.adapter, scene.sceneInstanceId)
    .map(item => item.id), ['new']);
});

test('enqueueTransition and quarantineScene are non-throwing defensive APIs', () => {
  const harness = makeHarness();
  assert.doesNotThrow(() => {
    assert.equal(harness.adapter.enqueueTransition(null), false);
    assert.equal(harness.adapter.enqueueTransition({}), false);
    assert.equal(harness.adapter.quarantineScene(null, 'C:\\secret'), false);
    assert.equal(harness.adapter.quarantineScene('missing', 'C:\\secret'), false);
  });
});

test('returns no partial projection after nowIso or apply failure', () => {
  const harness = makeHarness({
    nowIso() {
      throw new Error('time failed');
    }
  });
  const scene = makeScene({ targetFrame: 0 });
  harness.adapter.activateScene(scene, new Map());
  const result = harness.adapter.applyTransition(makeEvent(scene, 1, {
    insertions: [{
      index: 0,
      record: makeRecord('a'),
      baseTransform: makeTransform()
    }]
  }));
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'adapter-failed');
  assert.equal(harness.adapter.getSceneProjection(scene.sceneInstanceId), null);
});

test('diagnostics are bounded, sanitized and never contain projection data', () => {
  const harness = makeHarness();
  const scene = makeScene({
    sceneInstanceId: 'C:\\secret-video\\shot.mov\u0000frame-12'
  });
  harness.adapter.activateScene(
    scene,
    new Map([['private-stroke-id', makeRecord('private-stroke-id')]])
  );
  const sceneDiagnostics = harness.adapter.getDiagnostics(scene.sceneInstanceId);
  const aggregateDiagnostics = harness.adapter.getDiagnostics();
  assert.deepEqual(Object.keys(sceneDiagnostics).sort(), DIAGNOSTIC_KEYS);
  assert.deepEqual(Object.keys(aggregateDiagnostics).sort(), DIAGNOSTIC_KEYS);
  const serialized = JSON.stringify({ sceneDiagnostics, aggregateDiagnostics });
  assert.doesNotMatch(serialized, /secret-video|shot\.mov|private-stroke-id/);
  assert.doesNotMatch(serialized, /sourcePoints|points|layers|documentId/);
  assert.equal(sceneDiagnostics.objectCount, 1);
  assert.ok(sceneDiagnostics.estimatedBytes > 0);
});
