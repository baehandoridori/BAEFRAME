'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../../package.json');
const {
  createDrawingDocumentV3
} = require('../../renderer/scripts/modules/drawing-v3/drawing-document.js');

function createStroke(id, overrides = {}) {
  return {
    id,
    type: 'stroke',
    tool: 'brush',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    transform: [1, 0, 0, 1, 0, 0],
    points: [{ x: 10, y: 20, pressure: 0.5, time: 0 }],
    caps: { start: true, end: true },
    style: {
      color: '#ff4757',
      size: 12,
      thinning: 0.65,
      smoothing: 0.55,
      streamline: 0.5,
      outlineColor: null,
      outlineWidth: 0
    },
    ...overrides
  };
}

function createKeyframe(id, frame, objects = [], overrides = {}) {
  return {
    id,
    frame,
    empty: false,
    revision: 0,
    objects,
    ...overrides
  };
}

function createLayer(id, keyframes, overrides = {}) {
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    keyframes,
    ...overrides
  };
}

function createOptions(overrides = {}) {
  return {
    documentId: 'cow-document',
    coordinateSpace: {
      unit: 'source-pixel',
      origin: 'top-left',
      yAxis: 'down',
      pixelRatio: 1,
      width: 1920,
      height: 1080
    },
    timebase: {
      fpsNumerator: 24,
      fpsDenominator: 1,
      totalFrames: 240
    },
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [createStroke('target-stroke')])
      ])
    ],
    revisionSequence: 0,
    ...overrides
  };
}

function createCommand(overrides = {}) {
  return {
    id: 'cow-command',
    actorId: 'cow-actor',
    baseRevision: 0,
    target: {
      layerId: 'target-layer',
      keyframeId: 'target-keyframe',
      frame: 0
    },
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'target-stroke',
        transform: [1, 0, 0, 1, 10, 20]
      }]
    }],
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides
  };
}

function getTargetKeyframe(document) {
  return document.getContentSnapshot().layers
    .find(layer => layer.id === 'target-layer').keyframes
    .find(keyframe => keyframe.id === 'target-keyframe');
}

function assertAtomicFailure(document, command, reason, applyOptions) {
  const before = document.getContentSnapshot();
  const head = document.getHead();
  assert.deepEqual(document.applyCommand(command, applyOptions), {
    applied: false,
    reason
  });
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.deepEqual(document.getHead(), head);
}

function countCanonicalNodes(root) {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    count += 1;
    if (Array.isArray(value)) {
      for (const entry of value) stack.push(entry);
    } else {
      for (const entry of Object.values(value)) stack.push(entry);
    }
  }
  return count;
}

function getFormerTreapPriority(ordinal) {
  let value = (ordinal + 1) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function measureApplyCloneNodes(document, command) {
  const originalStructuredClone = global.structuredClone;
  const clonedValues = [];
  global.structuredClone = value => {
    clonedValues.push(value);
    return originalStructuredClone(value);
  };
  let result;
  try {
    result = document.applyCommand(command);
  } finally {
    global.structuredClone = originalStructuredClone;
  }
  assert.equal(result.applied, true);
  assert.equal(clonedValues.some(value =>
    value?.schemaVersion === '3.0.0' && Array.isArray(value.layers)), false);
  assert.equal(clonedValues.some(value =>
    Array.isArray(value) && value.length > 0 &&
    value.every(layer => layer?.keyframes && Array.isArray(layer.keyframes))),
  false);
  return clonedValues.reduce(
    (total, value) => total + countCanonicalNodes(value),
    0
  );
}

test('apply clones no root and unrelated 4,000 objects add no clone-node work', {
  concurrency: false
}, () => {
  const small = createDrawingDocumentV3(createOptions());
  const large = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [createStroke('target-stroke')])
      ]),
      createLayer('unrelated-layer', [
        createKeyframe(
          'unrelated-keyframe',
          10,
          Array.from({ length: 4_000 }, (_, index) =>
            createStroke(`unrelated-${index}`))
        )
      ])
    ]
  }));

  const smallNodes = measureApplyCloneNodes(small, createCommand({
    id: 'small-transform'
  }));
  const largeNodes = measureApplyCloneNodes(large, createCommand({
    id: 'large-transform'
  }));
  assert.equal(largeNodes, smallNodes);
});

test('the apply source guard forbids full-document clone and scan helpers', () => {
  const sourcePath = path.join(
    __dirname,
    '../../renderer/scripts/modules/drawing-v3/drawing-document.js'
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const applyStart = source.indexOf('function applyCommandAtomically');
  const applyEnd = source.indexOf('\nfunction createDrawingDocumentV3', applyStart);
  assert.ok(applyStart >= 0 && applyEnd > applyStart);
  const applySource = source.slice(applyStart, applyEnd);

  assert.doesNotMatch(source, /function\s+collectDocumentObjectIds\s*\(/);
  assert.doesNotMatch(applySource, /clonePlain\s*\(\s*content\s*\)/);
  assert.doesNotMatch(applySource, /collectDocumentObjectIds\s*\(/);
  assert.doesNotMatch(applySource, /content\.layers\.(?:find|map|filter|reduce|forEach)/);
  assert.doesNotMatch(applySource, /for\s*\([^)]*\bof\s+content\.layers\b/);
  assert.match(applySource, /findIndexedTarget\s*\(/);
});

test('512 insert groups do only target-sized persistent Map writes', {
  concurrency: false
}, () => {
  const baseCount = 4_000;
  const insertCount = 512;
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe(
          'target-keyframe',
          0,
          Array.from({ length: baseCount }, (_, index) =>
            createStroke(`base-${index}`))
        )
      ])
    ]
  }));
  const operations = Array.from({ length: insertCount }, (_, index) => ({
    type: 'insert-objects',
    index: baseCount + index,
    objects: [createStroke(`inserted-${index}`)]
  }));

  const originalMapSet = Map.prototype.set;
  let setCalls = 0;
  Map.prototype.set = function set(key, value) {
    setCalls += 1;
    return originalMapSet.call(this, key, value);
  };
  let result;
  try {
    result = document.applyCommand(createCommand({
      id: 'many-insert-groups',
      kind: 'add-objects',
      operations
    }));
  } finally {
    Map.prototype.set = originalMapSet;
  }
  assert.equal(result.applied, true);
  assert.ok(
    setCalls <= (baseCount + insertCount) * 2 + 20,
    `Map.set calls: ${setCalls}`
  );
  assert.equal(getTargetKeyframe(document).objects.length,
    baseCount + insertCount);
});

test('the 512-group inverse removes in near-linear indexed work', {
  concurrency: false
}, () => {
  const baseCount = 4_000;
  const insertCount = 512;
  const baseObjects = Array.from({ length: baseCount }, (_, index) =>
    createStroke(`inverse-base-${index}`));
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, baseObjects)
      ])
    ]
  }));
  const forward = document.applyCommand(createCommand({
    id: 'inverse-work-forward',
    kind: 'add-objects',
    operations: Array.from({ length: insertCount }, (_, index) => ({
      type: 'insert-objects',
      index: baseCount + index,
      objects: [createStroke(`inverse-inserted-${index}`)]
    }))
  }));
  assert.equal(forward.applied, true);

  const inverseCommand = createCommand({
    id: 'inverse-work-replay',
    baseRevision: 1,
    kind: 'delete-objects',
    operations: structuredClone(forward.inverseOperations)
  });
  const originalMapSet = Map.prototype.set;
  let setCalls = 0;
  Map.prototype.set = function set(key, value) {
    setCalls += 1;
    return originalMapSet.call(this, key, value);
  };
  let inverse;
  try {
    inverse = document.applyCommand(inverseCommand, { source: 'history' });
  } finally {
    Map.prototype.set = originalMapSet;
  }

  assert.equal(inverse.applied, true);
  assert.ok(
    setCalls <= (baseCount + insertCount) * 2 + 20,
    `Map.set calls: ${setCalls}`
  );
  assert.deepEqual(getTargetKeyframe(document).objects, baseObjects);
});

test('1,023 alternating structural operations stay near-linear and round-trip', {
  concurrency: false
}, () => {
  const baseCount = 4_000;
  const pairCount = 511;
  const baseObjects = Array.from({ length: baseCount }, (_, index) =>
    createStroke(`alternating-base-${index}`));
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, baseObjects)
      ])
    ]
  }));
  const operations = [];
  for (let index = 0; index < pairCount; index += 1) {
    const objectId = `alternating-transient-${index}`;
    operations.push({
      type: 'insert-objects',
      index: baseCount,
      objects: [createStroke(objectId)]
    });
    operations.push({ type: 'remove-objects', objectIds: [objectId] });
  }
  operations.push({
    type: 'set-transforms',
    transforms: [{
      objectId: 'alternating-base-0',
      transform: [1, 0, 0, 1, 123, 456]
    }]
  });

  const originalMapSet = Map.prototype.set;
  const runWithMapCount = callback => {
    let setCalls = 0;
    Map.prototype.set = function set(key, value) {
      setCalls += 1;
      return originalMapSet.call(this, key, value);
    };
    try {
      return { result: callback(), setCalls };
    } finally {
      Map.prototype.set = originalMapSet;
    }
  };
  const forward = runWithMapCount(() => document.applyCommand(createCommand({
    id: 'alternating-forward',
    kind: 'split-stroke',
    operations
  })));
  assert.equal(forward.result.applied, true);

  const inverseCommand = createCommand({
    id: 'alternating-inverse',
    baseRevision: 1,
    kind: 'split-stroke',
    operations: structuredClone(forward.result.inverseOperations)
  });
  const inverse = runWithMapCount(() =>
    document.applyCommand(inverseCommand, { source: 'history' }));
  assert.equal(inverse.result.applied, true);

  const referenceCount = pairCount * 2 + 1;
  const mapWriteLimit = (baseCount + referenceCount) * 2 + 50;
  assert.ok(
    forward.setCalls <= mapWriteLimit,
    `forward Map.set calls: ${forward.setCalls}`
  );
  assert.ok(
    inverse.setCalls <= mapWriteLimit,
    `inverse Map.set calls: ${inverse.setCalls}`
  );
  assert.deepEqual(getTargetKeyframe(document).objects, baseObjects);
  assert.deepEqual(document.getHead(), {
    sequence: 2,
    lastCommandId: 'alternating-inverse'
  });
});

test('10,000 valid history inserts cannot create a call-stack-shaped sequence', {
  concurrency: false
}, () => {
  const insertCount = 10_000;
  const sortedPriorities = [];
  const operations = [];
  for (let ordinal = 0; ordinal < insertCount; ordinal += 1) {
    const candidate = {
      ordinal,
      priority: getFormerTreapPriority(ordinal)
    };
    let low = 0;
    let high = sortedPriorities.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const existing = sortedPriorities[middle];
      if (existing.priority < candidate.priority ||
        (existing.priority === candidate.priority &&
          existing.ordinal < candidate.ordinal)) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    sortedPriorities.splice(low, 0, candidate);
    operations.push({
      type: 'insert-objects',
      index: low,
      objects: [createStroke(`history-boundary-${ordinal}`)]
    });
  }

  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [])
      ])
    ]
  }));
  const result = document.applyCommand(createCommand({
    id: 'history-boundary-inserts',
    kind: 'add-objects',
    operations
  }), { source: 'history' });
  assert.equal(result.applied, true);
  assert.equal(getTargetKeyframe(document).objects.length, insertCount);

  const inverse = document.applyCommand(createCommand({
    id: 'history-boundary-inserts-inverse',
    baseRevision: 1,
    kind: 'delete-objects',
    operations: structuredClone(result.inverseOperations)
  }), { source: 'history' });
  assert.equal(inverse.applied, true);
  assert.deepEqual(getTargetKeyframe(document).objects, []);
});

test('failed and no-op drafts never leak object index transitions', () => {
  const lateInsert = createDrawingDocumentV3(createOptions());
  assertAtomicFailure(lateInsert, createCommand({
    id: 'late-insert-failure',
    kind: 'split-stroke',
    operations: [
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('candidate')]
      },
      { type: 'remove-objects', objectIds: ['missing'] }
    ]
  }), 'object-not-found');
  assert.equal(lateInsert.applyCommand(createCommand({
    id: 'late-insert-retry',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('candidate')]
    }]
  })).applied, true);

  const lateRemove = createDrawingDocumentV3(createOptions());
  assertAtomicFailure(lateRemove, createCommand({
    id: 'late-remove-failure',
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['target-stroke'] },
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('temporary')]
      },
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'missing',
          transform: [1, 0, 0, 1, 1, 1]
        }]
      }
    ]
  }), 'object-not-found');
  assertAtomicFailure(lateRemove, createCommand({
    id: 'base-id-still-live',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('target-stroke')]
    }]
  }), 'duplicate-object-id');

  const overflow = createDrawingDocumentV3(createOptions({
    revisionSequence: Number.MAX_SAFE_INTEGER,
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe(
          'target-keyframe',
          0,
          [createStroke('target-stroke')],
          { revision: Number.MAX_SAFE_INTEGER }
        )
      ])
    ]
  }));
  const overflowInsert = id => createCommand({
    id,
    baseRevision: Number.MAX_SAFE_INTEGER,
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('overflow-candidate')]
    }]
  });
  assertAtomicFailure(overflow, overflowInsert('overflow-first'),
    'revision-limit-exceeded');
  assertAtomicFailure(overflow, overflowInsert('overflow-second'),
    'revision-limit-exceeded');

  const noChange = createDrawingDocumentV3(createOptions());
  assertAtomicFailure(noChange, createCommand({
    id: 'remove-reinsert-no-change',
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['target-stroke'] },
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('target-stroke')]
      }
    ]
  }), 'no-change');
  const transformed = noChange.applyCommand(createCommand({
    id: 'transform-after-no-change'
  }));
  assert.equal(transformed.applied, true);

  const inverseLimited = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [
          createStroke('point-a', {
            points: [
              { x: 0, y: 0, pressure: 0.5, time: 0 },
              { x: 1, y: 1, pressure: 0.5, time: 1 }
            ]
          }),
          createStroke('point-b', {
            points: [
              { x: 0, y: 0, pressure: 0.5, time: 0 },
              { x: 1, y: 1, pressure: 0.5, time: 1 }
            ]
          })
        ])
      ])
    ],
    limits: {
      maxInputPointsPerStroke: 1,
      maxStoredPointsPerStroke: 2,
      maxUserInsertedPointsPerCommand: 1,
      maxHistoryInsertedPointsPerCommand: 2
    }
  }));
  assertAtomicFailure(inverseLimited, createCommand({
    id: 'inverse-budget-failure',
    kind: 'delete-objects',
    operations: [{
      type: 'remove-objects',
      objectIds: ['point-a', 'point-b']
    }]
  }), 'inverse-command-limit-exceeded');
  assertAtomicFailure(inverseLimited, createCommand({
    id: 'inverse-budget-index-check',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 2,
      objects: [createStroke('point-a')]
    }]
  }), 'duplicate-object-id');
});

test('a valid transform followed by a late failure never touches shared state', () => {
  const document = createDrawingDocumentV3(createOptions());
  const before = document.getContentSnapshot();
  assertAtomicFailure(document, createCommand({
    id: 'transform-before-late-failure',
    kind: 'split-stroke',
    operations: [
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'target-stroke',
          transform: [1, 0, 0, 1, 77, 88]
        }]
      },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('late-failure-insert')]
      },
      { type: 'remove-objects', objectIds: ['missing-after-transform'] }
    ]
  }), 'object-not-found');
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.equal(document.applyCommand(createCommand({
    id: 'late-failure-insert-reusable',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('late-failure-insert')]
    }]
  })).applied, true);
});

test('a failed split cannot leak caps, content, or object index mutations', () => {
  const document = createDrawingDocumentV3(createOptions());
  const before = document.getContentSnapshot();
  const fragment = createStroke('capped-fragment', {
    caps: { start: false, end: true }
  });

  assertAtomicFailure(document, createCommand({
    id: 'caps-before-late-failure',
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['target-stroke'] },
      { type: 'insert-objects', index: 0, objects: [fragment] },
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'missing-after-caps',
          transform: [1, 0, 0, 1, 5, 6]
        }]
      }
    ]
  }), 'object-not-found');

  fragment.caps.start = true;
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.equal(document.applyCommand(createCommand({
    id: 'caps-fragment-id-reusable',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('capped-fragment', {
        caps: { start: false, end: true }
      })]
    }]
  })).applied, true);
  assert.deepEqual(
    getTargetKeyframe(document).objects[1].caps,
    { start: false, end: true }
  );
});

test('insert-before plus unordered removal keeps exact inverse indices', () => {
  const originalObjects = ['a', 'b', 'c', 'd'].map(id => createStroke(id));
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, originalObjects)
      ])
    ]
  }));
  const result = document.applyCommand(createCommand({
    id: 'insert-before-unordered-remove',
    kind: 'split-stroke',
    operations: [
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('x')]
      },
      { type: 'remove-objects', objectIds: ['d', 'b'] }
    ]
  }));
  assert.equal(result.applied, true);
  assert.deepEqual(getTargetKeyframe(document).objects.map(object => object.id),
    ['a', 'x', 'c']);
  assert.deepEqual(result.inverseOperations.map(operation => ({
    type: operation.type,
    index: operation.index,
    objectIds: operation.objectIds,
    objects: operation.objects?.map(object => object.id)
  })), [
    {
      type: 'insert-objects',
      index: 2,
      objectIds: undefined,
      objects: ['b']
    },
    {
      type: 'insert-objects',
      index: 4,
      objectIds: undefined,
      objects: ['d']
    },
    {
      type: 'remove-objects',
      index: undefined,
      objectIds: ['x'],
      objects: undefined
    }
  ]);

  const inverse = document.applyCommand(createCommand({
    id: 'insert-before-unordered-remove-inverse',
    baseRevision: 1,
    kind: 'split-stroke',
    operations: structuredClone(result.inverseOperations)
  }), { source: 'history' });
  assert.equal(inverse.applied, true);
  assert.deepEqual(getTargetKeyframe(document).objects, originalObjects);
});

test('successful structural edits refresh first, middle, and last locations', () => {
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [
          createStroke('a'),
          createStroke('b'),
          createStroke('c'),
          createStroke('d')
        ])
      ])
    ]
  }));
  assert.equal(document.applyCommand(createCommand({
    id: 'insert-shift',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('x')]
    }]
  })).applied, true);
  assert.equal(document.applyCommand(createCommand({
    id: 'remove-shift',
    baseRevision: 1,
    kind: 'delete-objects',
    operations: [{ type: 'remove-objects', objectIds: ['b'] }]
  })).applied, true);

  const transforms = [
    ['a', 10],
    ['c', 30],
    ['d', 40]
  ];
  assert.equal(document.applyCommand(createCommand({
    id: 'transform-shifted-locations',
    baseRevision: 2,
    operations: [{
      type: 'set-transforms',
      transforms: transforms.map(([objectId, x]) => ({
        objectId,
        transform: [1, 0, 0, 1, x, 0]
      }))
    }]
  })).applied, true);

  const objects = getTargetKeyframe(document).objects;
  assert.deepEqual(objects.map(object => object.id), ['a', 'x', 'c', 'd']);
  for (const [objectId, x] of transforms) {
    assert.deepEqual(
      objects.find(object => object.id === objectId).transform,
      [1, 0, 0, 1, x, 0]
    );
  }
  assert.deepEqual(objects.find(object => object.id === 'x').transform,
    [1, 0, 0, 1, 0, 0]);
});

test('transaction-local IDs survive remove, reinsert, and new-ID transitions', () => {
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [createStroke('base')])
      ]),
      createLayer('foreign-layer', [
        createKeyframe('foreign-keyframe', 20, [createStroke('foreign')])
      ])
    ]
  }));
  const result = document.applyCommand(createCommand({
    id: 'id-state-machine',
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['base'] },
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('base', { opacity: 0.9 })]
      },
      { type: 'remove-objects', objectIds: ['base'] },
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('base', { opacity: 0.8 })]
      },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('new-id')]
      },
      { type: 'remove-objects', objectIds: ['new-id'] },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('new-id', { opacity: 0.7 })]
      }
    ]
  }));
  assert.equal(result.applied, true);
  assert.deepEqual(getTargetKeyframe(document).objects.map(object => [
    object.id,
    object.opacity
  ]), [
    ['base', 0.8],
    ['new-id', 0.7]
  ]);

  assertAtomicFailure(document, createCommand({
    id: 'foreign-id-duplicate',
    baseRevision: 1,
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 2,
      objects: [createStroke('foreign')]
    }]
  }), 'duplicate-object-id');

  const transient = createDrawingDocumentV3(createOptions());
  assertAtomicFailure(transient, createCommand({
    id: 'insert-transform-remove',
    kind: 'split-stroke',
    operations: [
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('transient')]
      },
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'transient',
          transform: [1, 0, 0, 1, 8, 9]
        }]
      },
      { type: 'remove-objects', objectIds: ['transient'] }
    ]
  }), 'no-change');
  assert.equal(transient.applyCommand(createCommand({
    id: 'transient-id-reusable',
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('transient')]
    }]
  })).applied, true);
});

test('indexed target lookup rejects wrong layer and frame combinations', () => {
  const document = createDrawingDocumentV3(createOptions({
    initialLayers: [
      createLayer('target-layer', [
        createKeyframe('target-keyframe', 0, [createStroke('target-stroke')]),
        createKeyframe('later-keyframe', 20, [createStroke('later-stroke')])
      ]),
      createLayer('other-layer', [
        createKeyframe('other-keyframe', 30, [createStroke('other-stroke')])
      ])
    ]
  }));
  for (const [id, target] of [
    ['wrong-layer', {
      layerId: 'other-layer',
      keyframeId: 'target-keyframe',
      frame: 0
    }],
    ['wrong-frame', {
      layerId: 'target-layer',
      keyframeId: 'target-keyframe',
      frame: 20
    }]
  ]) {
    assertAtomicFailure(document, createCommand({ id, target }),
      'target-not-found');
  }
  assert.equal(document.applyCommand(createCommand({
    id: 'correct-indexed-target'
  })).applied, true);
});

test('100 sequential transforms preserve inverse order and round-trip semantics', () => {
  const document = createDrawingDocumentV3(createOptions());
  const beforeObjects = getTargetKeyframe(document).objects;
  const operations = Array.from({ length: 100 }, (_, index) => ({
    type: 'set-transforms',
    transforms: [{
      objectId: 'target-stroke',
      transform: [1, 0, 0, 1, index + 1, (index + 1) * 2]
    }]
  }));
  const result = document.applyCommand(createCommand({
    id: 'one-hundred-transforms',
    operations
  }));
  assert.equal(result.applied, true);
  assert.equal(result.inverseOperations.length, 100);
  assert.deepEqual(result.inverseOperations[0].transforms[0].transform,
    [1, 0, 0, 1, 99, 198]);
  assert.deepEqual(
    result.inverseOperations[result.inverseOperations.length - 1]
      .transforms[0].transform,
    [1, 0, 0, 1, 0, 0]
  );
  assert.deepEqual(getTargetKeyframe(document).objects[0].transform,
    [1, 0, 0, 1, 100, 200]);
  assert.deepEqual(document.getHead(), {
    sequence: 1,
    lastCommandId: 'one-hundred-transforms'
  });

  const inverse = document.applyCommand(createCommand({
    id: 'one-hundred-transforms-inverse',
    baseRevision: 1,
    operations: structuredClone(result.inverseOperations)
  }), { source: 'history' });
  assert.equal(inverse.applied, true);
  assert.deepEqual(getTargetKeyframe(document).objects, beforeObjects);
  assert.equal(getTargetKeyframe(document).revision, 2);
  assert.deepEqual(document.getHead(), {
    sequence: 2,
    lastCommandId: 'one-hundred-transforms-inverse'
  });
});

test('clone failure while materializing an insert is atomic and ID-reusable', {
  concurrency: false
}, () => {
  const document = createDrawingDocumentV3(createOptions());
  const inserted = createStroke('clone-failure-id');
  const objects = [inserted];
  const command = createCommand({
    id: 'clone-materialization-failure',
    kind: 'add-objects',
    operations: [{ type: 'insert-objects', index: 1, objects }]
  });
  const before = document.getContentSnapshot();
  const head = document.getHead();
  const originalStructuredClone = global.structuredClone;
  global.structuredClone = value => {
    if (value === inserted || value === objects) {
      throw new Error('injected inserted-object clone failure');
    }
    return originalStructuredClone(value);
  };
  try {
    assert.throws(() => document.applyCommand(command),
      /injected inserted-object clone failure/);
  } finally {
    global.structuredClone = originalStructuredClone;
  }
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.deepEqual(document.getHead(), head);
  assert.equal(document.applyCommand(command).applied, true);
});

test('drawing regression script includes the COW safety suite', () => {
  assert.match(
    packageJson.scripts['test:drawing'],
    /(?:^|\s)scripts\/tests\/drawing-v3-document-cow\.test\.js(?:\s|$)/
  );
});

test('drawing hardening and benchmark commands stay isolated', () => {
  assert.equal(
    packageJson.scripts['test:drawing-v3-hardening'],
    'node --test --test-concurrency=1 ' +
      'scripts/tests/drawing-v3-document.test.js ' +
      'scripts/tests/drawing-v3-document-cow.test.js'
  );
  assert.equal(
    packageJson.scripts['benchmark:drawing-v3'],
    'node --test --test-concurrency=1 ' +
      'scripts/tests/drawing-v3-document-benchmark.test.mjs'
  );
  assert.doesNotMatch(
    packageJson.scripts['test:drawing'],
    /drawing-v3-document-benchmark/
  );
});
