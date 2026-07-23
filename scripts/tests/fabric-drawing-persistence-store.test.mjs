import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(path.resolve(
  import.meta.dirname,
  '../../renderer/scripts/modules/fabric-drawing-persistence-store.js'
)).href;

async function loadModule() {
  return import(`${moduleUrl}?test=${Date.now()}-${Math.random()}`);
}

const META = Object.freeze({
  documentId: 'fabric-document-1',
  fps: 24,
  totalFrames: 240,
  hostGeneration: 3,
  videoGeneration: 7,
  persistenceSessionId: 'persistence-session-1',
  stableVideoIdentity: 'C:/shot/scene-001.mov'
});

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

function record(id, overrides = {}) {
  const base = {
    id,
    type: 'stroke',
    pathData: 'M 0 0 Q 5 10 10 10 Z',
    sourcePoints: [
      { x: 0, y: 0, pressure: 0.25, time: 0, pointerType: 'pen' },
      { x: 10, y: 10, pressure: 0.75, time: 8, pointerType: 'pen' }
    ],
    strokeCaps: { start: true, end: false },
    style: {
      color: '#ff4757',
      size: 7.5,
      opacity: 0.65
    },
    transform: { ...IDENTITY_TRANSFORM }
  };
  return {
    ...base,
    ...overrides,
    sourcePoints: overrides.sourcePoints || base.sourcePoints,
    strokeCaps: overrides.strokeCaps === undefined
      ? base.strokeCaps
      : overrides.strokeCaps,
    style: { ...base.style, ...(overrides.style || {}) },
    transform: { ...base.transform, ...(overrides.transform || {}) }
  };
}

function rootValue(overrides = {}) {
  return {
    storageSchema: 'baeframe-fabric-scenes',
    storageVersion: '1.0.0',
    engine: 'fabric-7',
    documentId: META.documentId,
    revision: 4,
    fps: META.fps,
    totalFrames: META.totalFrames,
    keyframes: [],
    ...overrides
  };
}

function keyframe(frame, objects = [], overrides = {}) {
  return {
    id: `keyframe-${frame}`,
    frame,
    sourceWidth: 1920,
    sourceHeight: 1080,
    mutationSequence: objects.length,
    objects,
    ...overrides
  };
}

function event(sequence, overrides = {}) {
  return {
    hostGeneration: META.hostGeneration,
    videoGeneration: META.videoGeneration,
    persistenceSessionId: META.persistenceSessionId,
    stableVideoIdentity: META.stableVideoIdentity,
    scene: {
      sceneInstanceId: 'overlay-scene-12',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: sequence,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: 512,
    unsupportedReason: null,
    removals: [],
    insertions: [],
    transforms: [],
    ...overrides
  };
}

test('reset creates an empty canonical document without reporting a user change', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const generated = [];
  const changes = [];
  const store = createFabricDrawingPersistenceStore({
    createId(prefix) {
      generated.push(prefix);
      return `${prefix}-generated`;
    }
  });
  store.subscribe(change => changes.push(change));

  assert.deepEqual(store.reset({ ...META, documentId: undefined }), {
    accepted: true,
    compatible: true,
    reason: null
  });
  assert.deepEqual(store.exportRootValue(), rootValue({
    documentId: 'fabric-document-generated',
    revision: 0
  }));
  assert.deepEqual(store.getHydrationDocument(), {
    documentId: 'fabric-document-generated',
    revision: 0,
    fps: 24,
    totalFrames: 240,
    keyframes: []
  });
  assert.equal(store.getRevision(), 0);
  assert.deepEqual(store.getStatus(), {
    state: 'ready',
    compatible: true,
    reason: null,
    revision: 0,
    keyframeCount: 0,
    objectCount: 0
  });
  assert.deepEqual(generated, ['fabric-document']);
  assert.deepEqual(changes, []);
});

test('multiple frames and every Fabric record field round-trip exactly without aliases', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const first = record('first', {
    pathData: 'M 1 2 Q 3 4 5 6 Z',
    strokeCaps: { start: false, end: true },
    style: { color: '#4a9eff', size: 19, opacity: 0.4 },
    transform: {
      left: 12.5,
      top: -7,
      scaleX: 1.25,
      scaleY: 0.75,
      angle: 18,
      skewX: 2,
      skewY: -3,
      flipX: true,
      flipY: false
    }
  });
  const second = record('second', { strokeCaps: undefined });
  delete second.strokeCaps;
  const input = rootValue({
    keyframes: [
      keyframe(3, [first, second], { mutationSequence: 9 }),
      keyframe(90, [record('third')], { mutationSequence: 2 })
    ]
  });
  const store = createFabricDrawingPersistenceStore();

  assert.deepEqual(store.importRootValue(input, META), {
    accepted: true,
    compatible: true,
    reason: null
  });
  assert.deepEqual(store.exportRootValue(), input);
  assert.deepEqual(store.getHydrationDocument().keyframes, input.keyframes);

  input.keyframes[0].objects[0].style.color = '#000000';
  const exported = store.exportRootValue();
  exported.keyframes[0].objects[0].sourcePoints[0].x = 999;
  assert.equal(store.exportRootValue().keyframes[0].objects[0].style.color, '#4a9eff');
  assert.equal(store.exportRootValue().keyframes[0].objects[0].sourcePoints[0].x, 0);
});

test('delta byte accounting never stringifies untouched records in the active frame', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const untouched = record('untouched-large', {
    sourcePoints: Array.from({ length: 10000 }, (_, index) => ({
      x: index,
      y: index % 100,
      pressure: 0.5,
      time: index
    }))
  });
  const store = createFabricDrawingPersistenceStore();
  assert.equal(store.importRootValue(rootValue({
    revision: 1,
    keyframes: [keyframe(12, [untouched], { mutationSequence: 1 })]
  }), META).accepted, true);
  const inserted = record('small-inserted');
  const originalStringify = JSON.stringify;
  let untouchedSerializationCount = 0;
  let result;
  JSON.stringify = function instrumentedStringify(value, ...args) {
    const touchesUntouched = value?.id === untouched.id ||
      (Array.isArray(value?.objects) &&
       value.objects.some(object => object?.id === untouched.id));
    if (touchesUntouched) {
      untouchedSerializationCount += 1;
      throw new Error('untouched record entered the delta serialization path');
    }
    return originalStringify.call(this, value, ...args);
  };
  try {
    result = store.applyTransition(event(2, {
      insertions: [{
        index: 1,
        record: inserted,
        baseTransform: inserted.transform
      }]
    }));
  } finally {
    JSON.stringify = originalStringify;
  }

  assert.deepEqual(result, { applied: true, revision: 2 });
  assert.equal(untouchedSerializationCount, 0);
  assert.deepEqual(
    store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['untouched-large', 'small-inserted']
  );
});

test('add, move, split, delete, Undo, Redo, and clear deltas preserve final order', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const changes = [];
  let generatedId = 0;
  const store = createFabricDrawingPersistenceStore({
    createId: prefix => `${prefix}-${++generatedId}`
  });
  store.reset(META);
  store.subscribe(change => changes.push(change));

  const original = record('original');
  assert.deepEqual(store.applyTransition(event(1, {
    insertions: [{ index: 0, record: original, baseTransform: original.transform }]
  })), { applied: true, revision: 1 });

  const moved = { ...original.transform, left: 8, top: -3 };
  assert.deepEqual(store.applyTransition(event(2, {
    kind: 'transform-objects',
    insertions: [],
    transforms: [{
      id: original.id,
      beforeTransform: original.transform,
      afterTransform: moved
    }]
  })), { applied: true, revision: 2 });

  const selected = record('selected-fragment', {
    strokeCaps: { start: true, end: false },
    transform: moved
  });
  const remaining = record('remaining-fragment', {
    strokeCaps: { start: false, end: true },
    transform: moved
  });
  assert.deepEqual(store.applyTransition(event(3, {
    kind: 'split-stroke',
    removals: [{ id: original.id, index: 0 }],
    insertions: [
      { index: 0, record: selected, baseTransform: selected.transform },
      { index: 1, record: remaining, baseTransform: remaining.transform }
    ]
  })), { applied: true, revision: 3 });

  assert.deepEqual(store.applyTransition(event(4, {
    kind: 'delete-objects',
    removals: [{ id: remaining.id, index: 1 }]
  })), { applied: true, revision: 4 });

  assert.deepEqual(store.applyTransition(event(5, {
    origin: 'history',
    insertions: [{ index: 1, record: remaining, baseTransform: null }]
  })), { applied: true, revision: 5 });

  assert.deepEqual(store.applyTransition(event(6, {
    origin: 'history',
    kind: 'delete-objects',
    removals: [{ id: remaining.id, index: 1 }]
  })), { applied: true, revision: 6 });

  assert.deepEqual(store.applyTransition(event(7, {
    kind: 'clear-keyframe',
    removals: [{ id: selected.id, index: 0 }]
  })), { applied: true, revision: 7 });

  const saved = store.exportRootValue();
  assert.equal(saved.revision, 7);
  assert.deepEqual(saved.keyframes, [keyframe(12, [], {
    id: 'fabric-keyframe-1',
    mutationSequence: 7
  })]);
  assert.deepEqual(changes.map(change => [change.kind, change.origin, change.revision]), [
    ['add-objects', 'live', 1],
    ['transform-objects', 'live', 2],
    ['split-stroke', 'live', 3],
    ['delete-objects', 'live', 4],
    ['add-objects', 'history', 5],
    ['delete-objects', 'history', 6],
    ['clear-keyframe', 'live', 7]
  ]);
  assert.equal(
    JSON.stringify(store.getHydrationDocument()).includes('undo'),
    false,
    'runtime Undo/Redo stacks must never be persisted'
  );
});

test('independent frame scenes track their own mutation sequence', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  let generatedId = 0;
  const store = createFabricDrawingPersistenceStore({
    createId: prefix => `${prefix}-${++generatedId}`
  });
  store.reset(META);
  const first = record('frame-12');
  const second = record('frame-30');

  assert.equal(store.applyTransition(event(1, {
    insertions: [{ index: 0, record: first, baseTransform: first.transform }]
  })).applied, true);
  assert.equal(store.applyTransition(event(1, {
    scene: {
      sceneInstanceId: 'overlay-scene-30',
      targetFrame: 30,
      sourceWidth: 1280,
      sourceHeight: 720
    },
    insertions: [{ index: 0, record: second, baseTransform: second.transform }]
  })).applied, true);

  assert.deepEqual(
    store.exportRootValue().keyframes.map(frame => [
      frame.frame,
      frame.sourceWidth,
      frame.sourceHeight,
      frame.mutationSequence,
      frame.objects[0].id
    ]),
    [
      [12, 1920, 1080, 1, 'frame-12'],
      [30, 1280, 720, 1, 'frame-30']
    ]
  );
});

test('identical transforms are ignored alone and beside a real insertion', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const changes = [];
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  const first = record('no-op-first');
  assert.equal(store.applyTransition(event(1, {
    insertions: [{ index: 0, record: first, baseTransform: first.transform }]
  })).applied, true);
  store.subscribe(change => changes.push(change));
  const beforeNoOp = store.exportRootValue();

  assert.deepEqual(store.applyTransition(event(2, {
    kind: 'transform-objects',
    transforms: [{
      id: first.id,
      beforeTransform: first.transform,
      afterTransform: { ...first.transform }
    }]
  })), {
    applied: false,
    reason: 'no-op',
    needsResync: false
  });
  assert.deepEqual(store.exportRootValue(), beforeNoOp);
  assert.deepEqual(changes, []);

  const second = record('real-insertion');
  assert.deepEqual(store.applyTransition(event(2, {
    kind: 'add-objects',
    insertions: [{ index: 1, record: second, baseTransform: second.transform }],
    transforms: [{
      id: first.id,
      beforeTransform: first.transform,
      afterTransform: { ...first.transform }
    }]
  })), {
    applied: true,
    revision: 2
  });
  assert.deepEqual(
    store.exportRootValue().keyframes[0].objects,
    [first, second]
  );
  assert.deepEqual(changes.map(change => change.kind), ['add-objects']);
});

test('duplicate, stale, and sequence-gap events are rejected atomically', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  const first = record('first');
  const initial = event(1, {
    insertions: [{ index: 0, record: first, baseTransform: first.transform }]
  });
  assert.equal(store.applyTransition(initial).applied, true);
  const before = store.exportRootValue();

  assert.deepEqual(store.applyTransition(initial), {
    applied: false,
    reason: 'duplicate-transition',
    needsResync: false
  });
  assert.deepEqual(store.applyTransition(event(0)), {
    applied: false,
    reason: 'stale-transition',
    needsResync: false
  });
  assert.deepEqual(store.applyTransition(event(3)), {
    applied: false,
    reason: 'sequence-gap',
    needsResync: true
  });
  assert.deepEqual(store.exportRootValue(), before);
});

test('stale host, video, persistence session, identity, and scene fences reject atomically', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const base = event(1, {
    insertions: [{
      index: 0,
      record: record('fenced'),
      baseTransform: IDENTITY_TRANSFORM
    }]
  });
  const staleCases = [
    { hostGeneration: 2 },
    { videoGeneration: 6 },
    { persistenceSessionId: 'stale-persistence-session' },
    { stableVideoIdentity: 'C:/shot/other.mov' }
  ];

  for (const patch of staleCases) {
    const store = createFabricDrawingPersistenceStore();
    store.reset(META);
    const before = store.exportRootValue();
    assert.deepEqual(store.applyTransition({ ...base, ...patch }), {
      applied: false,
      reason: 'stale-fence',
      needsResync: false
    });
    assert.deepEqual(store.exportRootValue(), before);
  }

  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  assert.equal(store.applyTransition(base).applied, true);
  const before = store.exportRootValue();
  assert.deepEqual(store.applyTransition(event(2, {
    scene: { ...base.scene, sceneInstanceId: 'replaced-scene' }
  })), {
    applied: false,
    reason: 'stale-scene',
    needsResync: true
  });
  assert.deepEqual(store.exportRootValue(), before);
});

test('unsupported or malformed deltas reject without partial removals or insertions', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  const first = record('first');
  assert.equal(store.applyTransition(event(1, {
    insertions: [{ index: 0, record: first, baseTransform: first.transform }]
  })).applied, true);
  const before = store.exportRootValue();

  const malformed = [
    event(2, { unsupportedReason: 'unsupported-transform' }),
    event(2, {
      kind: 'delete-objects',
      removals: [{ id: first.id, index: 7 }]
    }),
    event(2, {
      kind: 'split-stroke',
      removals: [{ id: first.id, index: 0 }],
      insertions: [{ index: 0, record: { ...record('bad'), sourcePoints: [] } }]
    }),
    event(2, {
      kind: 'transform-objects',
      transforms: [{
        id: first.id,
        beforeTransform: { ...first.transform, left: 99 },
        afterTransform: { ...first.transform, left: 100 }
      }]
    }),
    event(2, {
      insertions: [{ index: 1, record: first, baseTransform: first.transform }]
    }),
    { ...event(2), extraField: true }
  ];

  for (const value of malformed) {
    const result = store.applyTransition(value);
    assert.equal(result.applied, false);
    assert.match(result.reason, /invalid|unsupported|mismatch|duplicate/);
    assert.deepEqual(store.exportRootValue(), before);
  }
});

test('configured transition and document limits reject oversize input atomically', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const limits = {
    maxDocumentBytes: 1800,
    maxTransitionBytes: 1200,
    maxKeyframes: 2,
    maxObjectsPerKeyframe: 2,
    maxObjectsTotal: 3,
    maxPointsPerStroke: 3
  };
  const store = createFabricDrawingPersistenceStore({ limits });
  store.reset(META);
  const before = store.exportRootValue();
  const huge = record('huge', { pathData: `M ${'1 '.repeat(2000)}` });

  assert.deepEqual(store.applyTransition(event(1, {
    estimatedBytes: 8000,
    insertions: [{ index: 0, record: huge, baseTransform: huge.transform }]
  })), {
    applied: false,
    reason: 'transition-too-large',
    needsResync: true
  });
  assert.deepEqual(store.exportRootValue(), before);

  const oversizedRoot = rootValue({
    keyframes: [keyframe(1, [huge])]
  });
  const result = store.importRootValue(oversizedRoot, META);
  assert.deepEqual(result, {
    accepted: false,
    compatible: false,
    reason: 'document-too-large',
    preserved: true
  });
  assert.deepEqual(store.exportRootValue(), oversizedRoot);
});

test('future and malformed root values are preserved opaquely and never hydrated', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const future = rootValue({
    storageVersion: '2.0.0',
    futurePayload: { keep: ['exactly', true] }
  });
  const malformed = {
    storageSchema: 'baeframe-fabric-scenes',
    storageVersion: '1.0.0',
    documentId: 'broken',
    keyframes: 'not-an-array'
  };

  for (const [input, reason] of [
    [future, 'unsupported-storage-version'],
    [malformed, 'invalid-document'],
    [rootValue({ fps: 0 }), 'invalid-document']
  ]) {
    const changes = [];
    const store = createFabricDrawingPersistenceStore();
    store.subscribe(change => changes.push(change));
    assert.deepEqual(store.importRootValue(input, META), {
      accepted: false,
      compatible: false,
      reason,
      preserved: true
    });
    assert.deepEqual(store.exportRootValue(), input);
    assert.equal(store.getHydrationDocument(), null);
    assert.deepEqual(store.getStatus(), {
      state: 'incompatible',
      compatible: false,
      reason,
      revision: null,
      keyframeCount: 0,
      objectCount: 0
    });
    assert.deepEqual(store.applyTransition(event(1)), {
      applied: false,
      reason: 'store-incompatible',
      needsResync: false
    });
    assert.deepEqual(changes, []);
  }
});

test('replaceFromOverlay installs an authoritative clone without a user-change event', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const changes = [];
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  store.subscribe(change => changes.push(change));
  const snapshot = {
    hostGeneration: META.hostGeneration,
    videoGeneration: META.videoGeneration,
    persistenceSessionId: META.persistenceSessionId,
    stableVideoIdentity: META.stableVideoIdentity,
    fps: META.fps,
    totalFrames: META.totalFrames,
    scenes: [
      {
        sceneInstanceId: 'overlay-scene-3',
        targetFrame: 3,
        sourceWidth: 2048,
        sourceHeight: 858,
        mutationSequence: 4,
        objects: [record('overlay-first')]
      },
      {
        sceneInstanceId: 'overlay-scene-40',
        targetFrame: 40,
        sourceWidth: 2048,
        sourceHeight: 858,
        mutationSequence: 0,
        objects: []
      }
    ]
  };

  assert.deepEqual(store.replaceFromOverlay(snapshot, { mode: 'hydrate' }), {
    accepted: true,
    revision: 0
  });
  assert.deepEqual(
    store.getHydrationDocument(),
    {
      documentId: META.documentId,
      revision: 0,
      fps: META.fps,
      totalFrames: META.totalFrames,
      keyframes: [
        keyframe(3, [record('overlay-first')], {
          id: store.exportRootValue().keyframes[0].id,
          sourceWidth: 2048,
          sourceHeight: 858,
          mutationSequence: 4
        }),
        keyframe(40, [], {
          id: store.exportRootValue().keyframes[1].id,
          sourceWidth: 2048,
          sourceHeight: 858,
          mutationSequence: 0
        })
      ]
    }
  );
  snapshot.scenes[0].objects[0].style.color = '#000000';
  assert.equal(store.exportRootValue().keyframes[0].objects[0].style.color, '#ff4757');
  assert.deepEqual(changes, []);
});

test('numeric ceilings and exact active timeline reject hostile finite values', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const oversizedDocuments = [
    rootValue({
      totalFrames: Number.MAX_SAFE_INTEGER,
      keyframes: [keyframe(3, [record('huge-total-frames')])]
    }),
    rootValue({
      keyframes: [keyframe(3, [record('huge-source')], {
        sourceWidth: Number.MAX_VALUE
      })]
    }),
    rootValue({
      keyframes: [keyframe(3, [record('huge-point', {
        sourcePoints: [
          { x: Number.MAX_VALUE, y: 0, pressure: 0.5, time: 0 },
          { x: 1, y: 1, pressure: 0.5, time: 1 }
        ]
      })])]
    }),
    rootValue({
      keyframes: [keyframe(3, [record('huge-brush', {
        style: { size: Number.MAX_VALUE }
      })])]
    }),
    rootValue({
      keyframes: [keyframe(3, [record('huge-transform', {
        transform: { left: Number.MAX_VALUE }
      })])]
    }),
    rootValue({
      keyframes: [keyframe(3, [record('huge-time', {
        sourcePoints: [
          { x: 0, y: 0, pressure: 0.5, time: 0 },
          { x: 1, y: 1, pressure: 0.5, time: Number.MAX_VALUE }
        ]
      })])]
    })
  ];
  for (const input of oversizedDocuments) {
    const store = createFabricDrawingPersistenceStore();
    assert.deepEqual(store.importRootValue(input, META), {
      accepted: false,
      compatible: false,
      reason: 'invalid-document',
      preserved: true
    });
    assert.deepEqual(store.exportRootValue(), input);
  }

  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  const snapshot = {
    hostGeneration: META.hostGeneration,
    videoGeneration: META.videoGeneration,
    persistenceSessionId: META.persistenceSessionId,
    stableVideoIdentity: META.stableVideoIdentity,
    fps: META.fps,
    totalFrames: META.totalFrames,
    scenes: []
  };
  assert.deepEqual(store.replaceFromOverlay({
    ...snapshot,
    fps: 23.976
  }, { mode: 'hydrate' }), {
    accepted: false,
    reason: 'timeline-mismatch'
  });
  assert.deepEqual(store.replaceFromOverlay({
    ...snapshot,
    totalFrames: META.totalFrames + 1
  }, { mode: 'hydrate' }), {
    accepted: false,
    reason: 'timeline-mismatch'
  });
  assert.deepEqual(store.replaceFromOverlay({
    ...snapshot,
    scenes: [{
      sceneInstanceId: 'huge-overlay-source',
      targetFrame: 0,
      sourceWidth: Number.MAX_VALUE,
      sourceHeight: 1080,
      mutationSequence: 0,
      objects: []
    }]
  }, { mode: 'hydrate' }), {
    accepted: false,
    reason: 'invalid-overlay-snapshot'
  });
});

test('overlay snapshot persistence session requires exact match or explicit one-shot adoption', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const snapshot = {
    hostGeneration: META.hostGeneration,
    videoGeneration: META.videoGeneration,
    persistenceSessionId: META.persistenceSessionId,
    stableVideoIdentity: META.stableVideoIdentity,
    fps: META.fps,
    totalFrames: META.totalFrames,
    scenes: []
  };

  const bound = createFabricDrawingPersistenceStore();
  bound.reset(META);
  assert.deepEqual(bound.replaceFromOverlay({
    ...snapshot,
    persistenceSessionId: 'late-old-persistence-session'
  }, { mode: 'hydrate' }), {
    accepted: false,
    reason: 'stale-persistence-session'
  });
  assert.deepEqual(bound.exportRootValue(), rootValue({ revision: 0 }));

  const unboundMeta = { ...META };
  delete unboundMeta.persistenceSessionId;
  const unbound = createFabricDrawingPersistenceStore();
  unbound.reset(unboundMeta);
  assert.deepEqual(unbound.applyTransition(event(1)), {
    applied: false,
    reason: 'unbound-persistence-session',
    needsResync: false
  });
  assert.deepEqual(unbound.replaceFromOverlay(snapshot, { mode: 'hydrate' }), {
    accepted: false,
    reason: 'unbound-persistence-session'
  });
  assert.deepEqual(unbound.replaceFromOverlay(snapshot, {
    mode: 'hydrate',
    adoptPersistenceSession: true
  }), {
    accepted: true,
    revision: 0
  });
  assert.deepEqual(unbound.replaceFromOverlay({
    ...snapshot,
    persistenceSessionId: 'late-after-adoption'
  }, {
    mode: 'hydrate',
    adoptPersistenceSession: true
  }), {
    accepted: false,
    reason: 'stale-persistence-session'
  });
});

test('resync replacement reports one real lost delta while identical resync is silent', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const changes = [];
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  const original = record('resync-original');
  const hydrated = {
    hostGeneration: META.hostGeneration,
    videoGeneration: META.videoGeneration,
    persistenceSessionId: META.persistenceSessionId,
    stableVideoIdentity: META.stableVideoIdentity,
    fps: META.fps,
    totalFrames: META.totalFrames,
    scenes: [{
      sceneInstanceId: 'resync-scene',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [original]
    }]
  };
  assert.deepEqual(store.replaceFromOverlay(hydrated, { mode: 'hydrate' }), {
    accepted: true,
    revision: 0
  });
  store.subscribe(change => changes.push(change));

  const recovered = structuredClone(hydrated);
  recovered.scenes[0].mutationSequence = 2;
  recovered.scenes[0].objects[0].transform.left = 24;
  assert.deepEqual(store.replaceFromOverlay(recovered, { mode: 'resync' }), {
    accepted: true,
    revision: 1,
    changed: true
  });
  assert.deepEqual(changes, [{
    kind: 'snapshot-resync',
    origin: 'resync',
    frame: null,
    mutationSequence: null,
    revision: 1
  }]);

  assert.deepEqual(store.replaceFromOverlay(structuredClone(recovered), { mode: 'resync' }), {
    accepted: true,
    revision: 1,
    changed: false
  });
  assert.equal(changes.length, 1);
});

test('malformed overlay replacement and subscriber exceptions cannot corrupt the store', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  store.subscribe(() => {
    throw new Error('listener-isolated');
  });
  const first = record('safe');
  assert.equal(store.applyTransition(event(1, {
    insertions: [{ index: 0, record: first, baseTransform: first.transform }]
  })).applied, true);
  const before = store.exportRootValue();

  assert.deepEqual(store.replaceFromOverlay({
    hostGeneration: META.hostGeneration,
    videoGeneration: META.videoGeneration,
    persistenceSessionId: META.persistenceSessionId,
    stableVideoIdentity: META.stableVideoIdentity,
    fps: 24,
    totalFrames: 240,
    scenes: [{
      sceneInstanceId: 'duplicate-a',
      targetFrame: 9,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 0,
      objects: []
    }, {
      sceneInstanceId: 'duplicate-b',
      targetFrame: 9,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 0,
      objects: []
    }]
  }), {
    accepted: false,
    reason: 'invalid-overlay-snapshot'
  });
  assert.deepEqual(store.exportRootValue(), before);
});

test('unsubscribe stops isolated change delivery and returned values stay owned by the store', async () => {
  const { createFabricDrawingPersistenceStore } = await loadModule();
  const changes = [];
  const store = createFabricDrawingPersistenceStore();
  store.reset(META);
  const unsubscribe = store.subscribe(change => {
    changes.push(change);
    change.revision = 999;
  });
  const first = record('first');
  assert.equal(store.applyTransition(event(1, {
    insertions: [{ index: 0, record: first, baseTransform: first.transform }]
  })).applied, true);
  unsubscribe();
  assert.equal(store.applyTransition(event(2, {
    kind: 'delete-objects',
    removals: [{ id: first.id, index: 0 }]
  })).applied, true);

  assert.equal(changes.length, 1);
  assert.equal(store.getRevision(), 2);
});
