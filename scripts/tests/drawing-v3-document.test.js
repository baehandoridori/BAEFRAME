'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../../package.json');
const {
  createDrawingDocumentV3
} = require('../../renderer/scripts/modules/drawing-v3/drawing-document.js');

function createStroke(id = 'stroke-1', overrides = {}) {
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

function createPoints(count) {
  return Array.from({ length: count }, (_, index) => ({
    x: index,
    y: index,
    pressure: 0.5,
    time: index
  }));
}

function createManyStrokes(count) {
  return Array.from({ length: count }, (_, index) =>
    createStroke(`stroke-${index}`));
}

function createKeyframeFixture(overrides = {}) {
  return {
    id: 'keyframe-1',
    frame: 0,
    empty: false,
    revision: 0,
    objects: [],
    ...overrides
  };
}

function createLayerFixture(overrides = {}) {
  return {
    id: 'layer-1',
    name: '드로잉 1',
    visible: true,
    locked: false,
    opacity: 1,
    keyframes: [createKeyframeFixture()],
    ...overrides
  };
}

function createDocumentOptions(overrides = {}) {
  return {
    documentId: 'drawdoc-1',
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
    initialLayers: [createLayerFixture()],
    revisionSequence: 0,
    ...overrides
  };
}

function createPopulatedDocumentOptions() {
  return createDocumentOptions({
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        objects: [createStroke()]
      })]
    })]
  });
}

function deleteRequiredKey(record, key) {
  delete record[key];
}

function createDocumentWithObjects(objects = [], overrides = {}) {
  const keyframeOverrides = overrides.keyframe || {};
  const layerOverrides = overrides.layer || {};
  const options = createDocumentOptions({
    revisionSequence: overrides.revisionSequence ?? 0,
    initialLayers: [createLayerFixture({
      ...layerOverrides,
      keyframes: [createKeyframeFixture({
        objects,
        ...keyframeOverrides
      })]
    })]
  });
  if (overrides.limits !== undefined) options.limits = overrides.limits;
  return createDrawingDocumentV3(options);
}

function createCommand(overrides = {}) {
  return {
    id: 'command-1',
    actorId: 'actor-1',
    baseRevision: 0,
    target: {
      layerId: 'layer-1',
      keyframeId: 'keyframe-1',
      frame: 0
    },
    kind: 'add-objects',
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('stroke-new')]
    }],
    createdAt: '2026-07-23T00:00:00.000Z',
    ...overrides
  };
}

function deriveCommandKind(operations) {
  const types = operations.map(operation => operation.type);
  if (types.every(type => type === 'insert-objects')) return 'add-objects';
  if (types.every(type => type === 'remove-objects')) return 'delete-objects';
  if (types.every(type => type === 'set-transforms')) return 'transform-objects';
  if (types.includes('insert-objects') && types.includes('remove-objects') &&
    types.every(type => [
      'insert-objects',
      'remove-objects',
      'set-transforms'
    ].includes(type))) {
    return 'split-stroke';
  }
  throw new TypeError('Unsupported inverse operation composition');
}

function createInverseCommand(result, overrides = {}) {
  return createCommand({
    id: 'command-inverse',
    baseRevision: result.sequence,
    kind: deriveCommandKind(result.inverseOperations),
    operations: structuredClone(result.inverseOperations),
    ...overrides
  });
}

function getKeyframe(document, index = 0) {
  return document.getContentSnapshot().layers[0].keyframes[index];
}

function getObjectById(document, objectId) {
  return getKeyframe(document).objects.find(object => object.id === objectId);
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

function createSmallCommandBudgetLimits(overrides = {}) {
  return {
    maxObjectsPerKeyframe: 10,
    maxInputPointsPerStroke: 1,
    maxStoredPointsPerStroke: 1,
    maxUserOperationsPerCommand: 2,
    maxHistoryOperationsPerCommand: 3,
    maxUserInsertedObjectsPerCommand: 2,
    maxHistoryInsertedObjectsPerCommand: 3,
    maxUserRemovedIdsPerCommand: 2,
    maxHistoryRemovedIdsPerCommand: 3,
    maxUserTransformedIdsPerCommand: 2,
    maxHistoryTransformedIdsPerCommand: 3,
    maxUserObjectReferencesPerCommand: 2,
    maxHistoryObjectReferencesPerCommand: 3,
    maxUserInsertedPointsPerCommand: 2,
    maxHistoryInsertedPointsPerCommand: 3,
    maxUserCommandBytes: 1_000_000,
    maxHistoryCommandBytes: 2_000_000,
    ...overrides
  };
}

function estimateCommandBytesForTest(value) {
  if (value === null) return 4;
  if (typeof value === 'boolean') return 5;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return 4 + value.length * 2;
  if (Array.isArray(value)) {
    return 8 + value.length * 4 + value.reduce(
      (total, entry) => total + estimateCommandBytesForTest(entry),
      0
    );
  }
  const keys = Reflect.ownKeys(value);
  return 8 + keys.reduce((total, key) =>
    total + 4 + estimateCommandBytesForTest(key) +
      estimateCommandBytesForTest(value[key]), 0);
}

test('document snapshots are isolated from constructor input and returned mutations', () => {
  const layers = [createLayerFixture()];
  const document = createDrawingDocumentV3(createDocumentOptions({ initialLayers: layers }));

  layers[0].name = '외부 변경';
  const first = document.getContentSnapshot();
  first.layers[0].name = '반환값 변경';

  const second = document.getContentSnapshot();
  assert.equal(second.layers[0].name, '드로잉 1');
  assert.deepEqual(Object.keys(second), [
    'schemaVersion',
    'documentId',
    'engine',
    'coordinateSpace',
    'timebase',
    'layers'
  ]);
  assert.equal(second.schemaVersion, '3.0.0');
  assert.equal(second.documentId, 'drawdoc-1');
  assert.equal(second.engine, 'baeframe-drawing');
  assert.deepEqual(document.getHead(), { sequence: 0, lastCommandId: null });
});

test('constructor snapshots preserve full-stroke caps without input aliases', () => {
  const stroke = createStroke('stroke-caps');
  const document = createDrawingDocumentV3(createDocumentOptions({
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({ objects: [stroke] })]
    })]
  }));

  stroke.caps.start = false;
  const first = document.getContentSnapshot();
  assert.deepEqual(first.layers[0].keyframes[0].objects[0].caps, {
    start: true,
    end: true
  });

  first.layers[0].keyframes[0].objects[0].caps.end = false;
  assert.deepEqual(
    document.getContentSnapshot().layers[0].keyframes[0].objects[0].caps,
    { start: true, end: true }
  );
});

test('resolveFrame distinguishes exact, held, empty-break, and no-source frames', () => {
  const stroke = createStroke('stroke-1', { opacity: 0 });
  const document = createDrawingDocumentV3(createDocumentOptions({
    initialLayers: [createLayerFixture({
      opacity: 0,
      keyframes: [
        createKeyframeFixture({
          id: 'keyframe-2',
          frame: 2,
          objects: [stroke]
        }),
        createKeyframeFixture({
          id: 'keyframe-10',
          frame: 10,
          empty: true,
          objects: []
        })
      ]
    })]
  }));

  const snapshot = document.getContentSnapshot();
  assert.equal(snapshot.layers[0].opacity, 0);
  assert.equal(snapshot.layers[0].keyframes[0].objects[0].opacity, 0);
  assert.deepEqual(document.resolveFrame({ layerId: 'layer-1', frame: 2 }), {
    layerId: 'layer-1',
    frame: 2,
    sourceFrame: 2,
    keyframeId: 'keyframe-2',
    held: false,
    empty: false,
    objects: [stroke]
  });

  const held = document.resolveFrame({ layerId: 'layer-1', frame: 5 });
  assert.deepEqual(held, {
    layerId: 'layer-1',
    frame: 5,
    sourceFrame: 2,
    keyframeId: 'keyframe-2',
    held: true,
    empty: false,
    objects: [stroke]
  });
  held.objects[0].points[0].x = 9999;
  assert.equal(
    document.resolveFrame({ layerId: 'layer-1', frame: 5 }).objects[0].points[0].x,
    stroke.points[0].x,
    'resolveFrame must return a deep clone'
  );

  assert.deepEqual(document.resolveFrame({ layerId: 'layer-1', frame: 12 }), {
    layerId: 'layer-1',
    frame: 12,
    sourceFrame: 10,
    keyframeId: 'keyframe-10',
    held: true,
    empty: true,
    objects: []
  });
  assert.deepEqual(document.resolveFrame({ layerId: 'layer-1', frame: 0 }), {
    layerId: 'layer-1',
    frame: 0,
    sourceFrame: null,
    keyframeId: null,
    held: false,
    empty: true,
    objects: []
  });
  assert.equal(document.resolveFrame({ layerId: 'missing', frame: 0 }), null);
  assert.equal(document.resolveFrame({ layerId: 'layer-1', frame: -1 }), null);
  assert.equal(document.resolveFrame({ layerId: 'layer-1', frame: 240 }), null);
  assert.equal(document.resolveFrame({ layerId: 'layer-1', frame: 2.5 }), null);
});

const invalidInitialCases = [
  ['missing documentId', options => deleteRequiredKey(options, 'documentId')],
  ['unknown create option', options => { options.futureOption = true; }],
  ['empty documentId', options => { options.documentId = ''; }],
  ['negative revisionSequence', options => { options.revisionSequence = -1; }],
  ['fractional revisionSequence', options => { options.revisionSequence = 0.5; }],
  ['unsafe revisionSequence', options => {
    options.revisionSequence = Number.MAX_SAFE_INTEGER + 1;
  }],
  ['unknown coordinateSpace key', options => { options.coordinateSpace.left = 0; }],
  ['missing coordinateSpace key', options => deleteRequiredKey(options.coordinateSpace, 'width')],
  ['wrong coordinate unit', options => { options.coordinateSpace.unit = 'normalized'; }],
  ['wrong coordinate origin', options => { options.coordinateSpace.origin = 'center'; }],
  ['wrong coordinate yAxis', options => { options.coordinateSpace.yAxis = 'up'; }],
  ['non-finite source width', options => { options.coordinateSpace.width = Number.NaN; }],
  ['non-positive source height', options => { options.coordinateSpace.height = 0; }],
  ['non-finite pixelRatio', options => { options.coordinateSpace.pixelRatio = Infinity; }],
  ['non-positive pixelRatio', options => { options.coordinateSpace.pixelRatio = -1; }],
  ['unknown timebase key', options => { options.timebase.dropFrame = false; }],
  ['missing timebase key', options => deleteRequiredKey(options.timebase, 'fpsNumerator')],
  ['non-positive fps numerator', options => { options.timebase.fpsNumerator = 0; }],
  ['fractional fps numerator', options => { options.timebase.fpsNumerator = 23.976; }],
  ['unsafe fps numerator', options => {
    options.timebase.fpsNumerator = Number.MAX_SAFE_INTEGER + 1;
  }],
  ['non-positive fps denominator', options => { options.timebase.fpsDenominator = 0; }],
  ['unsafe fps denominator', options => {
    options.timebase.fpsDenominator = Number.MAX_SAFE_INTEGER + 1;
  }],
  ['non-integer totalFrames', options => { options.timebase.totalFrames = 10.5; }],
  ['non-positive totalFrames', options => { options.timebase.totalFrames = 0; }],
  ['unsafe totalFrames', options => {
    options.timebase.totalFrames = Number.MAX_SAFE_INTEGER + 1;
  }],
  ['sparse initialLayers', options => { options.initialLayers = new Array(1); }],
  ['unknown layer key', options => { options.initialLayers[0].selected = true; }],
  ['missing layer key', options => deleteRequiredKey(options.initialLayers[0], 'visible')],
  ['empty layer id', options => { options.initialLayers[0].id = ''; }],
  ['empty layer name', options => { options.initialLayers[0].name = ''; }],
  ['non-boolean layer visible', options => { options.initialLayers[0].visible = 1; }],
  ['non-boolean layer locked', options => { options.initialLayers[0].locked = 0; }],
  ['layer opacity below zero', options => { options.initialLayers[0].opacity = -0.01; }],
  ['layer opacity above one', options => { options.initialLayers[0].opacity = 1.01; }],
  ['non-finite layer opacity', options => { options.initialLayers[0].opacity = Number.NaN; }],
  ['sparse keyframes', options => { options.initialLayers[0].keyframes = new Array(1); }],
  ['unknown keyframe key', options => { options.initialLayers[0].keyframes[0].selected = true; }],
  ['missing keyframe key', options => deleteRequiredKey(options.initialLayers[0].keyframes[0], 'revision')],
  ['empty keyframe id', options => { options.initialLayers[0].keyframes[0].id = ''; }],
  ['negative frame', options => { options.initialLayers[0].keyframes[0].frame = -1; }],
  ['fractional frame', options => { options.initialLayers[0].keyframes[0].frame = 1.5; }],
  ['frame at totalFrames', options => { options.initialLayers[0].keyframes[0].frame = 240; }],
  ['negative keyframe revision', options => { options.initialLayers[0].keyframes[0].revision = -1; }],
  ['fractional keyframe revision', options => { options.initialLayers[0].keyframes[0].revision = 0.5; }],
  ['unsafe keyframe revision', options => {
    options.initialLayers[0].keyframes[0].revision = Number.MAX_SAFE_INTEGER + 1;
  }],
  ['non-boolean keyframe empty', options => { options.initialLayers[0].keyframes[0].empty = 0; }],
  ['sparse keyframe objects', options => { options.initialLayers[0].keyframes[0].objects = new Array(1); }],
  ['empty keyframe with objects', options => { options.initialLayers[0].keyframes[0].empty = true; }],
  ['unknown stroke key', options => { options.initialLayers[0].keyframes[0].objects[0].pathData = 'M 0 0'; }],
  ['missing stroke key', options => deleteRequiredKey(options.initialLayers[0].keyframes[0].objects[0], 'tool')],
  ['missing stroke caps', options => deleteRequiredKey(options.initialLayers[0].keyframes[0].objects[0], 'caps')],
  ['unknown stroke caps key', options => { options.initialLayers[0].keyframes[0].objects[0].caps.flat = true; }],
  ['non-boolean stroke caps start', options => { options.initialLayers[0].keyframes[0].objects[0].caps.start = 1; }],
  ['non-boolean stroke caps end', options => { options.initialLayers[0].keyframes[0].objects[0].caps.end = 0; }],
  ['empty stroke id', options => { options.initialLayers[0].keyframes[0].objects[0].id = ''; }],
  ['unsupported object type', options => { options.initialLayers[0].keyframes[0].objects[0].type = 'shape'; }],
  ['unsupported stroke tool', options => { options.initialLayers[0].keyframes[0].objects[0].tool = 'eraser'; }],
  ['non-boolean stroke visible', options => { options.initialLayers[0].keyframes[0].objects[0].visible = 1; }],
  ['non-boolean stroke locked', options => { options.initialLayers[0].keyframes[0].objects[0].locked = 0; }],
  ['stroke opacity below zero', options => { options.initialLayers[0].keyframes[0].objects[0].opacity = -0.01; }],
  ['stroke opacity above one', options => { options.initialLayers[0].keyframes[0].objects[0].opacity = 1.01; }],
  ['non-finite stroke opacity', options => { options.initialLayers[0].keyframes[0].objects[0].opacity = Infinity; }],
  ['unsupported blend mode', options => { options.initialLayers[0].keyframes[0].objects[0].blendMode = 'multiply'; }],
  ['missing transform', options => deleteRequiredKey(options.initialLayers[0].keyframes[0].objects[0], 'transform')],
  ['sparse transform', options => { options.initialLayers[0].keyframes[0].objects[0].transform = new Array(6); }],
  ['wrong transform length', options => { options.initialLayers[0].keyframes[0].objects[0].transform = [1, 0, 0, 1, 0]; }],
  ['non-finite transform value', options => { options.initialLayers[0].keyframes[0].objects[0].transform[4] = Infinity; }],
  ['singular transform', options => { options.initialLayers[0].keyframes[0].objects[0].transform = [1, 0, 0, 0, 0, 0]; }],
  ['empty stroke points', options => { options.initialLayers[0].keyframes[0].objects[0].points = []; }],
  ['sparse stroke points', options => { options.initialLayers[0].keyframes[0].objects[0].points = new Array(1); }],
  ['unknown point key', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].tilt = 0; }],
  ['missing point key', options => deleteRequiredKey(options.initialLayers[0].keyframes[0].objects[0].points[0], 'pressure')],
  ['non-finite point x', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].x = Number.NaN; }],
  ['non-finite point y', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].y = Infinity; }],
  ['pressure below zero', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].pressure = -0.01; }],
  ['pressure above one', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].pressure = 1.01; }],
  ['non-finite point time', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].time = Number.NaN; }],
  ['negative point time', options => { options.initialLayers[0].keyframes[0].objects[0].points[0].time = -1; }],
  ['decreasing point time', options => {
    options.initialLayers[0].keyframes[0].objects[0].points.push({
      x: 20,
      y: 30,
      pressure: 0.5,
      time: -0
    });
    options.initialLayers[0].keyframes[0].objects[0].points[0].time = 1;
  }],
  ['unknown style key', options => { options.initialLayers[0].keyframes[0].objects[0].style.dash = []; }],
  ['missing style key', options => deleteRequiredKey(options.initialLayers[0].keyframes[0].objects[0].style, 'size')],
  ['uppercase style color', options => { options.initialLayers[0].keyframes[0].objects[0].style.color = '#FF4757'; }],
  ['invalid style color', options => { options.initialLayers[0].keyframes[0].objects[0].style.color = 'red'; }],
  ['boxed style color', options => { options.initialLayers[0].keyframes[0].objects[0].style.color = new String('#ff4757'); }],
  ['non-positive style size', options => { options.initialLayers[0].keyframes[0].objects[0].style.size = 0; }],
  ['thinning outside range', options => { options.initialLayers[0].keyframes[0].objects[0].style.thinning = 1.01; }],
  ['smoothing outside range', options => { options.initialLayers[0].keyframes[0].objects[0].style.smoothing = -0.01; }],
  ['streamline outside range', options => { options.initialLayers[0].keyframes[0].objects[0].style.streamline = 1.01; }],
  ['invalid outline color', options => { options.initialLayers[0].keyframes[0].objects[0].style.outlineColor = '#fff'; }],
  ['boxed outline color', options => { options.initialLayers[0].keyframes[0].objects[0].style.outlineColor = new String('#ffffff'); }],
  ['negative outline width', options => { options.initialLayers[0].keyframes[0].objects[0].style.outlineWidth = -1; }],
  ['duplicate layer id', options => { options.initialLayers.push(createLayerFixture()); }],
  ['duplicate keyframe id', options => {
    options.initialLayers[0].keyframes.push(createKeyframeFixture({ frame: 1, objects: [] }));
  }],
  ['duplicate object id across keyframes', options => {
    options.initialLayers[0].keyframes.push(createKeyframeFixture({
      id: 'keyframe-2',
      frame: 1,
      objects: [createStroke()]
    }));
  }],
  ['unsorted keyframe frames', options => {
    options.initialLayers[0].keyframes = [
      createKeyframeFixture({ id: 'keyframe-10', frame: 10, objects: [] }),
      createKeyframeFixture({ id: 'keyframe-0', frame: 0, objects: [] })
    ];
  }],
  ['duplicate keyframe frame', options => {
    options.initialLayers[0].keyframes = [
      createKeyframeFixture({ id: 'keyframe-a', frame: 0, objects: [] }),
      createKeyframeFixture({ id: 'keyframe-b', frame: 0, objects: [] })
    ];
  }]
];

for (const [name, mutate] of invalidInitialCases) {
  test(`initial validator rejects ${name} without mutating input`, () => {
    const options = createPopulatedDocumentOptions();
    mutate(options);
    const before = structuredClone(options);

    assert.throws(() => createDrawingDocumentV3(options), TypeError);
    assert.deepEqual(options, before);
  });
}

test('initial validator rejects non-plain records and accessors without invoking getters', () => {
  class LayerRecord {}
  const classOptions = createPopulatedDocumentOptions();
  classOptions.initialLayers[0] = Object.assign(
    new LayerRecord(),
    classOptions.initialLayers[0]
  );
  assert.throws(() => createDrawingDocumentV3(classOptions), TypeError);
  assert.equal(Object.getPrototypeOf(classOptions.initialLayers[0]), LayerRecord.prototype);

  let getterReads = 0;
  const accessorOptions = createPopulatedDocumentOptions();
  Object.defineProperty(accessorOptions.coordinateSpace, 'width', {
    enumerable: true,
    configurable: true,
    get() {
      getterReads += 1;
      return 1920;
    }
  });
  assert.throws(() => createDrawingDocumentV3(accessorOptions), TypeError);
  assert.equal(getterReads, 0);
});

test('initial validator rejects dense array class instances', () => {
  class PointArray extends Array {}
  const options = createPopulatedDocumentOptions();
  const points = new PointArray();
  points.push({ x: 10, y: 20, pressure: 0.5, time: 0 });
  options.initialLayers[0].keyframes[0].objects[0].points = points;

  assert.throws(() => createDrawingDocumentV3(options), TypeError);
  assert.equal(
    Object.getPrototypeOf(options.initialLayers[0].keyframes[0].objects[0].points),
    PointArray.prototype
  );
});

test('initial validator accepts canonical boundary values and off-canvas points', () => {
  const stroke = createStroke('stroke-boundary', {
    tool: 'pen',
    opacity: 0,
    transform: [1, 0, 0, 1, -100, 200],
    points: [
      { x: -500, y: 5000, pressure: 0, time: 0 },
      { x: 2500, y: -300, pressure: 1, time: 0 }
    ],
    style: {
      color: '#000000',
      size: Number.MIN_VALUE,
      thinning: -1,
      smoothing: 0,
      streamline: 1,
      outlineColor: '#ffffff',
      outlineWidth: 0
    }
  });
  const options = createDocumentOptions({
    initialLayers: [createLayerFixture({
      opacity: 0,
      keyframes: [createKeyframeFixture({
        revision: 0,
        objects: [stroke]
      })]
    })]
  });

  const snapshot = createDrawingDocumentV3(options).getContentSnapshot();
  assert.deepEqual(snapshot.layers[0].keyframes[0].objects[0], stroke);
});

test('initial validator accepts safe-integer maxima and rejects an unsafe frame request', () => {
  const options = createDocumentOptions({
    revisionSequence: Number.MAX_SAFE_INTEGER,
    timebase: {
      fpsNumerator: Number.MAX_SAFE_INTEGER,
      fpsDenominator: Number.MAX_SAFE_INTEGER,
      totalFrames: Number.MAX_SAFE_INTEGER
    },
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        frame: Number.MAX_SAFE_INTEGER - 1,
        revision: Number.MAX_SAFE_INTEGER
      })]
    })]
  });
  const document = createDrawingDocumentV3(options);

  assert.deepEqual(document.getHead(), {
    sequence: Number.MAX_SAFE_INTEGER,
    lastCommandId: null
  });
  assert.equal(document.resolveFrame({
    layerId: 'layer-1',
    frame: Number.MAX_SAFE_INTEGER - 1
  }).held, false);
  assert.equal(document.resolveFrame({
    layerId: 'layer-1',
    frame: Number.MAX_SAFE_INTEGER + 1
  }), null);
});

test('initial validator enforces lowered positive integer limits', () => {
  const accepted = createPopulatedDocumentOptions();
  accepted.limits = {
    maxObjectsPerKeyframe: 2,
    maxInputPointsPerStroke: 4,
    maxStoredPointsPerStroke: 8
  };
  assert.doesNotThrow(() => createDrawingDocumentV3(accepted));

  const invalidLimits = [
    { maxObjectsPerKeyframe: 0 },
    { maxInputPointsPerStroke: -1 },
    { maxObjectsPerKeyframe: 10_001 },
    { maxInputPointsPerStroke: 20_001 },
    { maxStoredPointsPerStroke: 100_001 },
    { maxInputPointsPerStroke: 9, maxStoredPointsPerStroke: 8 },
    { maxStoredPointsPerStroke: 1.5 },
    { unknownLimit: 1 }
  ];
  for (const limits of invalidLimits) {
    const options = createPopulatedDocumentOptions();
    options.limits = limits;
    const before = structuredClone(options);
    assert.throws(() => createDrawingDocumentV3(options), TypeError);
    assert.deepEqual(options, before);
  }
});

test('insert command increments revisions once and returns an isolated inverse removal', () => {
  const document = createDocumentWithObjects();
  const stroke = createStroke('stroke-1');
  const command = createCommand({
    id: 'command-insert',
    operations: [{ type: 'insert-objects', index: 0, objects: [stroke] }]
  });
  const result = document.applyCommand(command);

  assert.deepEqual(result, {
    applied: true,
    commandId: 'command-insert',
    sequence: 1,
    inverseOperations: [{ type: 'remove-objects', objectIds: ['stroke-1'] }]
  });
  assert.deepEqual(document.getHead(), {
    sequence: 1,
    lastCommandId: 'command-insert'
  });
  assert.equal(getKeyframe(document).revision, 1);
  assert.deepEqual(getKeyframe(document).objects, [stroke]);

  stroke.points[0].x = 999;
  stroke.transform[4] = 999;
  command.operations[0].objects[0].style.size = 999;
  result.inverseOperations[0].objectIds[0] = 'mutated-result';
  assert.equal(getObjectById(document, 'stroke-1').points[0].x, 10);
  assert.equal(getObjectById(document, 'stroke-1').style.size, 12);
  assert.deepEqual(getObjectById(document, 'stroke-1').transform,
    [1, 0, 0, 1, 0, 0]);
});

test('insert boundary separates non-canonical strokes from malformed transforms', () => {
  const fabricPath = createStroke('fabric-path');
  fabricPath.pathData = 'M 0 0';
  const fabricPoints = createStroke('fabric-points');
  fabricPoints.sourcePoints = [[0, 0]];
  const missingTransform = createStroke('missing-transform');
  delete missingTransform.transform;
  const unsupportedTool = createStroke('unsupported-tool', { tool: 'eraser' });
  const invalidPoint = createStroke('invalid-point');
  invalidPoint.points[0].pressure = 2;
  const invalidStyle = createStroke('invalid-style');
  invalidStyle.style.size = 0;

  for (const stroke of [
    fabricPath,
    fabricPoints,
    missingTransform,
    unsupportedTool,
    invalidPoint,
    invalidStyle
  ]) {
    const document = createDocumentWithObjects();
    assertAtomicFailure(document, createCommand({
      operations: [{ type: 'insert-objects', index: 0, objects: [stroke] }]
    }), 'invalid-object');
  }

  const document = createDocumentWithObjects();
  assertAtomicFailure(document, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('fabric-transform', {
        transform: { left: 10, top: 20, scaleX: 1, angle: 0 }
      })]
    }]
  }), 'invalid-transform');
});

test('object limit takes precedence over defects in an extra object', () => {
  const objectLimited = createDrawingDocumentV3(createDocumentOptions({
    limits: {
      maxObjectsPerKeyframe: 1,
      maxInputPointsPerStroke: 4,
      maxStoredPointsPerStroke: 8
    },
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        objects: [createStroke('existing')]
      })]
    })]
  }));
  const malformedExtraObject = createStroke('malformed-extra');
  malformedExtraObject.pathData = 'M 0 0';
  assertAtomicFailure(objectLimited, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [malformedExtraObject]
    }]
  }), 'object-limit-exceeded');
});

test('point limit takes precedence over nested defects past the input cap', () => {
  const pointLimited = createDrawingDocumentV3(createDocumentOptions({
    limits: {
      maxObjectsPerKeyframe: 2,
      maxInputPointsPerStroke: 4,
      maxStoredPointsPerStroke: 8
    }
  }));
  const malformedOversizedStroke = createStroke('malformed-oversized', {
    points: createPoints(5)
  });
  malformedOversizedStroke.style.color = 'red';
  assertAtomicFailure(pointLimited, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [malformedOversizedStroke]
    }]
  }), 'point-limit-exceeded');
});

test('command envelope and kind mapping reject malformed commands atomically', () => {
  const removeOperation = {
    type: 'remove-objects',
    objectIds: ['stroke-existing']
  };
  const transformOperation = {
    type: 'set-transforms',
    transforms: [{
      objectId: 'stroke-existing',
      transform: [1, 0, 0, 1, 10, 0]
    }]
  };
  const missingId = createCommand();
  delete missingId.id;
  const unknownCommandKey = createCommand();
  unknownCommandKey.future = true;
  const unknownTargetKey = createCommand();
  unknownTargetKey.target.future = true;
  const sparseOperations = createCommand();
  sparseOperations.operations = new Array(1);

  const invalidCommands = [
    ['null command', null],
    ['missing id', missingId],
    ['unknown command key', unknownCommandKey],
    ['empty id', createCommand({ id: '' })],
    ['empty actorId', createCommand({ actorId: '' })],
    ['negative baseRevision', createCommand({ baseRevision: -1 })],
    ['fractional baseRevision', createCommand({ baseRevision: 0.5 })],
    ['unsafe baseRevision', createCommand({
      baseRevision: Number.MAX_SAFE_INTEGER + 1
    })],
    ['non-record target', createCommand({ target: [] })],
    ['unknown target key', unknownTargetKey],
    ['empty target layerId', createCommand({
      target: { layerId: '', keyframeId: 'keyframe-1', frame: 0 }
    })],
    ['empty target keyframeId', createCommand({
      target: { layerId: 'layer-1', keyframeId: '', frame: 0 }
    })],
    ['negative target frame', createCommand({
      target: { layerId: 'layer-1', keyframeId: 'keyframe-1', frame: -1 }
    })],
    ['fractional target frame', createCommand({
      target: { layerId: 'layer-1', keyframeId: 'keyframe-1', frame: 0.5 }
    })],
    ['unsafe target frame', createCommand({
      target: {
        layerId: 'layer-1',
        keyframeId: 'keyframe-1',
        frame: Number.MAX_SAFE_INTEGER + 1
      }
    })],
    ['out-of-range target frame', createCommand({
      target: { layerId: 'layer-1', keyframeId: 'keyframe-1', frame: 240 }
    })],
    ['unsupported kind', createCommand({ kind: 'unknown-kind' })],
    ['empty operations', createCommand({ operations: [] })],
    ['sparse operations', sparseOperations],
    ['add kind with removal', createCommand({
      kind: 'add-objects',
      operations: [removeOperation]
    })],
    ['delete kind with insert', createCommand({
      kind: 'delete-objects'
    })],
    ['transform kind with insert', createCommand({
      kind: 'transform-objects'
    })],
    ['split kind without insert', createCommand({
      kind: 'split-stroke',
      operations: [removeOperation, transformOperation]
    })],
    ['split kind without removal', createCommand({
      kind: 'split-stroke',
      operations: [createCommand().operations[0], transformOperation]
    })],
    ['invalid createdAt', createCommand({ createdAt: 'not-a-date' })],
    ['non-string createdAt', createCommand({ createdAt: 123 })],
    ['duplicate removal IDs', createCommand({
      kind: 'delete-objects',
      operations: [{
        type: 'remove-objects',
        objectIds: ['stroke-existing', 'stroke-existing']
      }]
    })],
    ['duplicate transform IDs', createCommand({
      kind: 'transform-objects',
      operations: [{
        type: 'set-transforms',
        transforms: [
          { objectId: 'stroke-existing', transform: [1, 0, 0, 1, 10, 0] },
          { objectId: 'stroke-existing', transform: [1, 0, 0, 1, 20, 0] }
        ]
      }]
    })]
  ];

  for (const [name, command] of invalidCommands) {
    const document = createDocumentWithObjects([createStroke('stroke-existing')]);
    assertAtomicFailure(document, command, 'invalid-command');
    assert.ok(name);
  }
});

test('operation payload validation is exact, safe-integer based, and atomic', () => {
  const insert = (index, objects = [createStroke('stroke-new')]) => ({
    type: 'insert-objects',
    index,
    objects
  });
  const remove = objectIds => ({ type: 'remove-objects', objectIds });
  const transform = transforms => ({ type: 'set-transforms', transforms });

  const insertWithExtraKey = insert(1);
  insertWithExtraKey.future = true;
  const removeWithExtraKey = remove(['stroke-existing']);
  removeWithExtraKey.future = true;
  const transformWithExtraKey = transform([{
    objectId: 'stroke-existing',
    transform: [1, 0, 0, 1, 1, 0]
  }]);
  transformWithExtraKey.future = true;
  const sparseObjects = new Array(1);
  const sparseObjectIds = new Array(1);
  const sparseTransforms = new Array(1);

  const cases = [
    ['negative insert index', 'add-objects', [insert(-1)]],
    ['fractional insert index', 'add-objects', [insert(0.5)]],
    ['unsafe insert index', 'add-objects', [insert(Number.MAX_SAFE_INTEGER + 1)]],
    ['insert index beyond current length', 'add-objects', [insert(2)]],
    ['empty insert objects', 'add-objects', [insert(1, [])]],
    ['sparse insert objects', 'add-objects', [insert(1, sparseObjects)]],
    ['unknown insert key', 'add-objects', [insertWithExtraKey]],
    ['empty removal IDs', 'delete-objects', [remove([])]],
    ['empty removal ID', 'delete-objects', [remove([''])]],
    ['sparse removal IDs', 'delete-objects', [remove(sparseObjectIds)]],
    ['unknown removal key', 'delete-objects', [removeWithExtraKey]],
    ['empty transforms', 'transform-objects', [transform([])]],
    ['empty transform object ID', 'transform-objects', [transform([{
      objectId: '',
      transform: [1, 0, 0, 1, 1, 0]
    }])]],
    ['sparse transforms', 'transform-objects', [transform(sparseTransforms)]],
    ['unknown transform entry key', 'transform-objects', [transform([{
      objectId: 'stroke-existing',
      transform: [1, 0, 0, 1, 1, 0],
      future: true
    }])]],
    ['unknown transform operation key', 'transform-objects', [transformWithExtraKey]],
    ['unknown operation', 'add-objects', [{ type: 'future-operation' }]]
  ];

  for (const [name, kind, operations] of cases) {
    const document = createDocumentWithObjects([createStroke('stroke-existing')]);
    assertAtomicFailure(document, createCommand({ kind, operations }), 'invalid-command');
    assert.ok(name);
  }

  const dynamicFailure = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(dynamicFailure, createCommand({
    operations: [
      insert(1, [createStroke('stroke-a')]),
      insert(3, [createStroke('stroke-b')])
    ]
  }), 'invalid-command');
});

test('sequential insert indices use the current draft length', () => {
  const document = createDocumentWithObjects();
  const result = document.applyCommand(createCommand({
    operations: [
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('stroke-a')]
      },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('stroke-b')]
      }
    ]
  }));

  assert.equal(result.applied, true);
  assert.deepEqual(
    getKeyframe(document).objects.map(object => object.id),
    ['stroke-a', 'stroke-b']
  );
});

test('exact target mismatch and empty-break keyframes are not editable', () => {
  const wrongFrame = createDocumentWithObjects();
  assertAtomicFailure(wrongFrame, createCommand({
    target: { layerId: 'layer-1', keyframeId: 'keyframe-1', frame: 1 }
  }), 'target-not-found');

  const missingTarget = createDocumentWithObjects();
  assertAtomicFailure(missingTarget, createCommand({
    target: { layerId: 'layer-1', keyframeId: 'missing', frame: 0 }
  }), 'target-not-found');

  const emptyBreak = createDocumentWithObjects([], {
    keyframe: { empty: true }
  });
  assertAtomicFailure(emptyBreak, createCommand(), 'target-not-found');
});

test('affine transform changes only transform and identical transform is a no-op', () => {
  const original = createStroke('stroke-1');
  const document = createDocumentWithObjects([original]);
  const moved = document.applyCommand(createCommand({
    id: 'move-1',
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-1',
        transform: [1, 0, 0, 1, 30, 40]
      }]
    }]
  }));

  assert.deepEqual(moved, {
    applied: true,
    commandId: 'move-1',
    sequence: 1,
    inverseOperations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-1',
        transform: [1, 0, 0, 1, 0, 0]
      }]
    }]
  });
  const after = getObjectById(document, 'stroke-1');
  assert.deepEqual(after.transform, [1, 0, 0, 1, 30, 40]);
  assert.deepEqual(after.points, original.points);
  assert.deepEqual(after.style, original.style);

  const head = document.getHead();
  assertAtomicFailure(document, createCommand({
    id: 'move-noop',
    baseRevision: head.sequence,
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-1',
        transform: [1, -0, 0, 1, 30, 40]
      }]
    }]
  }), 'no-change');
});

test('invalid affine and Fabric-style transforms fail atomically', () => {
  const invalidTransforms = [
    [1, 0, 0, 0, 0, 0],
    { left: 10, top: 20, scaleX: 1, angle: 0 }
  ];

  for (const transform of invalidTransforms) {
    const document = createDocumentWithObjects([createStroke('stroke-1')]);
    assertAtomicFailure(document, createCommand({
      kind: 'transform-objects',
      operations: [{
        type: 'set-transforms',
        transforms: [{ objectId: 'stroke-1', transform }]
      }]
    }), 'invalid-transform');
  }
});

test('a command whose final canonical objects equal the start is a no-op', () => {
  const document = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(document, createCommand({
    kind: 'split-stroke',
    operations: [
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('stroke-temporary')]
      },
      {
        type: 'remove-objects',
        objectIds: ['stroke-temporary']
      }
    ]
  }), 'no-change');
});

test('compound split preserves z-order and its derived inverse round-trips canonical objects', () => {
  const initialObjects = [
    createStroke('stroke-a'),
    createStroke('stroke-b'),
    createStroke('stroke-c')
  ];
  const document = createDocumentWithObjects(initialObjects);
  const result = document.applyCommand(createCommand({
    id: 'split-1',
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['stroke-b'] },
      {
        type: 'insert-objects',
        index: 1,
        objects: [
          createStroke('fragment-1', {
            caps: { start: true, end: false }
          }),
          createStroke('fragment-2', {
            caps: { start: false, end: true }
          })
        ]
      },
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'fragment-2',
          transform: [1, 0, 0, 1, 30, 40]
        }]
      }
    ]
  }));

  assert.equal(result.applied, true);
  assert.deepEqual(
    getKeyframe(document).objects.map(object => object.id),
    ['stroke-a', 'fragment-1', 'fragment-2', 'stroke-c']
  );
  assert.deepEqual(getObjectById(document, 'fragment-2').transform, [1, 0, 0, 1, 30, 40]);
  assert.deepEqual(getObjectById(document, 'fragment-1').caps, {
    start: true,
    end: false
  });
  assert.deepEqual(getObjectById(document, 'fragment-2').caps, {
    start: false,
    end: true
  });

  const inverse = createInverseCommand(result);
  assert.equal(inverse.kind, 'split-stroke');
  const restored = document.applyCommand(inverse, { source: 'history' });
  assert.equal(restored.applied, true);
  assert.deepEqual(getKeyframe(document).objects, initialObjects);
  assert.equal(getKeyframe(document).revision, 2);
  assert.deepEqual(document.getHead(), {
    sequence: 2,
    lastCommandId: 'command-inverse'
  });
});

test('unordered removal returns ascending-index inserts and restores original order', () => {
  const initialObjects = [
    createStroke('stroke-a'),
    createStroke('stroke-b'),
    createStroke('stroke-c'),
    createStroke('stroke-d')
  ];
  const document = createDocumentWithObjects(initialObjects);
  const removed = document.applyCommand(createCommand({
    id: 'remove-1',
    kind: 'delete-objects',
    operations: [{
      type: 'remove-objects',
      objectIds: ['stroke-d', 'stroke-b']
    }]
  }));

  assert.deepEqual(removed.inverseOperations, [
    { type: 'insert-objects', index: 1, objects: [createStroke('stroke-b')] },
    { type: 'insert-objects', index: 3, objects: [createStroke('stroke-d')] }
  ]);
  const inverse = createInverseCommand(removed);
  assert.equal(inverse.kind, 'add-objects');
  assert.equal(document.applyCommand(inverse, { source: 'history' }).applied, true);
  assert.deepEqual(getKeyframe(document).objects, initialObjects);
});

test('insert and transform inverse operations derive delete and transform kinds', () => {
  const insertedDocument = createDocumentWithObjects();
  const inserted = insertedDocument.applyCommand(createCommand());
  const insertInverse = createInverseCommand(inserted);
  assert.equal(insertInverse.kind, 'delete-objects');
  assert.equal(
    insertedDocument.applyCommand(insertInverse, { source: 'history' }).applied,
    true
  );
  assert.deepEqual(getKeyframe(insertedDocument).objects, []);

  const transformedDocument = createDocumentWithObjects([createStroke('stroke-1')]);
  const transformed = transformedDocument.applyCommand(createCommand({
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-1',
        transform: [1, 0, 0, 1, 10, 20]
      }]
    }]
  }));
  const transformInverse = createInverseCommand(transformed);
  assert.equal(transformInverse.kind, 'transform-objects');
  assert.equal(
    transformedDocument.applyCommand(transformInverse, { source: 'history' }).applied,
    true
  );
  assert.deepEqual(getObjectById(transformedDocument, 'stroke-1').transform,
    [1, 0, 0, 1, 0, 0]);
});

test('stale, locked, duplicate, missing object, and invalid object failures are atomic', () => {
  const stale = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(stale, createCommand({ baseRevision: 99 }), 'stale-revision');

  const locked = createDocumentWithObjects([createStroke('stroke-existing')], {
    layer: { locked: true }
  });
  assertAtomicFailure(locked, createCommand(), 'layer-locked');

  const duplicate = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(duplicate, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('stroke-existing')]
    }]
  }), 'duplicate-object-id');

  const missingRemove = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(missingRemove, createCommand({
    kind: 'delete-objects',
    operations: [{ type: 'remove-objects', objectIds: ['missing'] }]
  }), 'object-not-found');

  const missingTransform = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(missingTransform, createCommand({
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{ objectId: 'missing', transform: [1, 0, 0, 1, 1, 1] }]
    }]
  }), 'object-not-found');

  const invalidStroke = createStroke('stroke-invalid');
  invalidStroke.pathData = 'M 0 0';
  const invalidObject = createDocumentWithObjects();
  assertAtomicFailure(invalidObject, createCommand({
    operations: [{ type: 'insert-objects', index: 0, objects: [invalidStroke] }]
  }), 'invalid-object');
});

test('successful command IDs dedupe but failed and no-op IDs stay reusable', () => {
  const document = createDocumentWithObjects();
  const first = document.applyCommand(createCommand({ id: 'shared-id' }));
  assert.equal(first.applied, true);
  assertAtomicFailure(document, createCommand({
    id: 'shared-id',
    baseRevision: 1,
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('stroke-second')]
    }]
  }), 'duplicate-command-id');

  const reusable = createDocumentWithObjects([createStroke('stroke-existing')]);
  assertAtomicFailure(reusable, createCommand({
    id: 'reusable-id',
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-existing',
        transform: [1, 0, 0, 1, 0, 0]
      }]
    }]
  }), 'no-change');
  const retried = reusable.applyCommand(createCommand({
    id: 'reusable-id',
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-existing',
        transform: [1, 0, 0, 1, 1, 0]
      }]
    }]
  }));
  assert.equal(retried.applied, true);
});

test('invalid command source is rejected atomically', () => {
  const document = createDocumentWithObjects();
  assertAtomicFailure(document, createCommand(), 'invalid-command', {
    source: 'external'
  });
});

test('revision limits reject net changes after validation without consuming IDs', () => {
  const headLimited = createDocumentWithObjects([], {
    revisionSequence: Number.MAX_SAFE_INTEGER
  });
  assertAtomicFailure(headLimited, createCommand({
    id: 'head-overflow',
    baseRevision: Number.MAX_SAFE_INTEGER
  }), 'revision-limit-exceeded');

  const keyframeLimited = createDrawingDocumentV3(createDocumentOptions({
    initialLayers: [createLayerFixture({
      keyframes: [
        createKeyframeFixture({
          id: 'keyframe-max',
          frame: 0,
          revision: Number.MAX_SAFE_INTEGER
        }),
        createKeyframeFixture({
          id: 'keyframe-safe',
          frame: 1,
          revision: 0
        })
      ]
    })]
  }));
  const overflowing = createCommand({
    id: 'keyframe-overflow',
    target: { layerId: 'layer-1', keyframeId: 'keyframe-max', frame: 0 }
  });
  assertAtomicFailure(keyframeLimited, overflowing, 'revision-limit-exceeded');

  const retried = keyframeLimited.applyCommand(createCommand({
    id: 'keyframe-overflow',
    target: { layerId: 'layer-1', keyframeId: 'keyframe-safe', frame: 1 }
  }));
  assert.equal(retried.applied, true);
  assert.equal(keyframeLimited.getHead().sequence, 1);
});

test('a no-op takes precedence over revision overflow', () => {
  const document = createDocumentWithObjects([createStroke('stroke-1')], {
    revisionSequence: Number.MAX_SAFE_INTEGER,
    keyframe: { revision: Number.MAX_SAFE_INTEGER }
  });
  assertAtomicFailure(document, createCommand({
    id: 'overflow-noop',
    baseRevision: Number.MAX_SAFE_INTEGER,
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-1',
        transform: [1, 0, 0, 1, 0, 0]
      }]
    }]
  }), 'no-change');
});

test('object IDs stay unique across the live draft and the entire document', () => {
  const acrossLayers = createDrawingDocumentV3(createDocumentOptions({
    initialLayers: [
      createLayerFixture(),
      createLayerFixture({
        id: 'layer-2',
        keyframes: [createKeyframeFixture({
          id: 'keyframe-2',
          objects: [createStroke('shared-id')]
        })]
      })
    ]
  }));
  assertAtomicFailure(acrossLayers, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('shared-id')]
    }]
  }), 'duplicate-object-id');

  const withinInsert = createDocumentWithObjects();
  assertAtomicFailure(withinInsert, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('same-id'), createStroke('same-id')]
    }]
  }), 'duplicate-object-id');

  const acrossSequentialInserts = createDocumentWithObjects();
  assertAtomicFailure(acrossSequentialInserts, createCommand({
    operations: [
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('same-id')]
      },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('same-id')]
      }
    ]
  }), 'duplicate-object-id');

  const removeThenReinsert = createDocumentWithObjects([createStroke('same-id')]);
  const movedStroke = createStroke('same-id', {
    transform: [1, 0, 0, 1, 25, 0]
  });
  const replaced = removeThenReinsert.applyCommand(createCommand({
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['same-id'] },
      { type: 'insert-objects', index: 0, objects: [movedStroke] }
    ]
  }));
  assert.equal(replaced.applied, true);
  assert.deepEqual(getObjectById(removeThenReinsert, 'same-id'), movedStroke);
});

test('malformed input wins before dedupe, dedupe wins before stale, and target wins before lock', () => {
  const document = createDocumentWithObjects();
  assert.equal(document.applyCommand(createCommand({ id: 'used-id' })).applied, true);

  const malformedUsedId = createCommand({
    id: 'used-id',
    baseRevision: 99,
    operations: []
  });
  assertAtomicFailure(document, malformedUsedId, 'invalid-command');
  assertAtomicFailure(document, createCommand({
    id: 'used-id',
    baseRevision: 99,
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('stroke-another')]
    }]
  }), 'duplicate-command-id');

  const invalidSource = createCommand({
    id: 'used-id',
    baseRevision: 1,
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('stroke-another')]
    }]
  });
  assertAtomicFailure(document, invalidSource, 'invalid-command', {
    source: 'external'
  });

  const locked = createDocumentWithObjects([], { layer: { locked: true } });
  assertAtomicFailure(locked, createCommand({
    target: { layerId: 'layer-1', keyframeId: 'missing', frame: 0 }
  }), 'target-not-found');
});

test('final-state no-op spans sequential transforms while real net changes still commit', () => {
  const noOp = createDocumentWithObjects([createStroke('stroke-a')]);
  assertAtomicFailure(noOp, createCommand({
    kind: 'transform-objects',
    operations: [
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'stroke-a',
          transform: [1, 0, 0, 1, 10, 0]
        }]
      },
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'stroke-a',
          transform: [1, 0, 0, 1, 0, 0]
        }]
      }
    ]
  }), 'no-change');

  const changed = createDocumentWithObjects([
    createStroke('stroke-a'),
    createStroke('stroke-b')
  ]);
  const result = changed.applyCommand(createCommand({
    kind: 'split-stroke',
    operations: [
      {
        type: 'set-transforms',
        transforms: [{
          objectId: 'stroke-a',
          transform: [1, 0, 0, 1, 0, 0]
        }]
      },
      { type: 'remove-objects', objectIds: ['stroke-b'] },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('stroke-c')]
      }
    ]
  }));
  assert.equal(result.applied, true);
  assert.deepEqual(getObjectById(changed, 'stroke-a').transform,
    [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(getKeyframe(changed).objects.map(object => object.id),
    ['stroke-a', 'stroke-c']);
});

test('inverse operation groups reverse while each multi-remove group stays index-sorted', () => {
  const initialObjects = [
    createStroke('stroke-a'),
    createStroke('stroke-b'),
    createStroke('stroke-c'),
    createStroke('stroke-d')
  ];
  const document = createDocumentWithObjects(initialObjects);
  const removed = document.applyCommand(createCommand({
    kind: 'delete-objects',
    operations: [
      { type: 'remove-objects', objectIds: ['stroke-d', 'stroke-b'] },
      { type: 'remove-objects', objectIds: ['stroke-a'] }
    ]
  }));

  assert.deepEqual(removed.inverseOperations, [
    { type: 'insert-objects', index: 0, objects: [createStroke('stroke-a')] },
    { type: 'insert-objects', index: 1, objects: [createStroke('stroke-b')] },
    { type: 'insert-objects', index: 3, objects: [createStroke('stroke-d')] }
  ]);
  const inverse = createInverseCommand(removed);
  assert.equal(inverse.kind, 'add-objects');
  assert.equal(document.applyCommand(inverse, { source: 'history' }).applied, true);
  assert.deepEqual(getKeyframe(document).objects, initialObjects);
});

test('transform command and inverse outputs do not alias caller-owned matrices', () => {
  const document = createDocumentWithObjects([createStroke('stroke-1')]);
  const matrix = [1, 0, 0, 1, 12, 34];
  const command = createCommand({
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{ objectId: 'stroke-1', transform: matrix }]
    }]
  });
  const result = document.applyCommand(command);
  assert.equal(result.applied, true);

  matrix[4] = 999;
  command.operations[0].transforms[0].transform[5] = 999;
  result.inverseOperations[0].transforms[0].transform[0] = 999;
  assert.deepEqual(getObjectById(document, 'stroke-1').transform,
    [1, 0, 0, 1, 12, 34]);
});

test('MAX_SAFE_INTEGER minus one can commit once, then only no-ops remain possible', () => {
  const document = createDocumentWithObjects([], {
    revisionSequence: Number.MAX_SAFE_INTEGER - 1,
    keyframe: { revision: Number.MAX_SAFE_INTEGER - 1 }
  });
  const first = document.applyCommand(createCommand({
    id: 'last-safe-change',
    baseRevision: Number.MAX_SAFE_INTEGER - 1
  }));
  assert.equal(first.applied, true);
  assert.equal(document.getHead().sequence, Number.MAX_SAFE_INTEGER);
  assert.equal(getKeyframe(document).revision, Number.MAX_SAFE_INTEGER);

  assertAtomicFailure(document, createCommand({
    id: 'at-limit-noop',
    baseRevision: Number.MAX_SAFE_INTEGER,
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-new',
        transform: [1, 0, 0, 1, 0, 0]
      }]
    }]
  }), 'no-change');
  assertAtomicFailure(document, createCommand({
    id: 'at-limit-change',
    baseRevision: Number.MAX_SAFE_INTEGER,
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-new',
        transform: [1, 0, 0, 1, 1, 0]
      }]
    }]
  }), 'revision-limit-exceeded');
});

test('lowered point and object limits reject whole commands without truncation', () => {
  const limits = {
    maxObjectsPerKeyframe: 2,
    maxInputPointsPerStroke: 4,
    maxStoredPointsPerStroke: 8
  };
  const pointLimited = createDrawingDocumentV3(createDocumentOptions({
    limits,
    initialLayers: [createLayerFixture()]
  }));
  assertAtomicFailure(pointLimited, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('five-points', { points: createPoints(5) })]
    }]
  }), 'point-limit-exceeded');

  const objectLimited = createDrawingDocumentV3(createDocumentOptions({
    limits,
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        objects: [createStroke('stroke-a'), createStroke('stroke-b')]
      })]
    })]
  }));
  assertAtomicFailure(objectLimited, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 2,
      objects: [createStroke('stroke-c')]
    }]
  }), 'object-limit-exceeded');

  const storedTooLarge = createDocumentOptions({
    limits,
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        objects: [createStroke('nine-points', { points: createPoints(9) })]
      })]
    })]
  });
  assert.throws(() => createDrawingDocumentV3(storedTooLarge), TypeError);
});

test('lowered limits accept values exactly at every configured boundary', () => {
  const limits = {
    maxObjectsPerKeyframe: 2,
    maxInputPointsPerStroke: 4,
    maxStoredPointsPerStroke: 8
  };
  const document = createDrawingDocumentV3(createDocumentOptions({
    limits,
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        objects: [createStroke('stored-boundary', {
          points: createPoints(8)
        })]
      })]
    })]
  }));
  const inserted = document.applyCommand(createCommand({
    operations: [{
      type: 'insert-objects',
      index: 1,
      objects: [createStroke('input-boundary', {
        points: createPoints(4)
      })]
    }]
  }));

  assert.equal(inserted.applied, true);
  assert.equal(getKeyframe(document).objects.length, 2);
  assert.equal(getObjectById(document, 'stored-boundary').points.length, 8);
  assert.equal(getObjectById(document, 'input-boundary').points.length, 4);
});

test('hard limits accept exact user, stored, history, and object boundaries', () => {
  const userBoundary = createDocumentWithObjects();
  const userInserted = userBoundary.applyCommand(createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('user-boundary', {
        points: createPoints(20_000)
      })]
    }]
  }));
  assert.equal(userInserted.applied, true);
  assert.equal(getObjectById(userBoundary, 'user-boundary').points.length, 20_000);

  const storedBoundaryPoints = createPoints(100_000);
  const storedBoundary = createDocumentWithObjects([
    createStroke('stored-boundary', { points: storedBoundaryPoints })
  ]);
  assert.equal(
    getObjectById(storedBoundary, 'stored-boundary').points.length,
    100_000
  );

  const historyBoundary = createDocumentWithObjects();
  const historyInserted = historyBoundary.applyCommand(createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('history-boundary', {
        points: storedBoundaryPoints
      })]
    }]
  }), { source: 'history' });
  assert.equal(historyInserted.applied, true);
  assert.equal(
    getObjectById(historyBoundary, 'history-boundary').points.length,
    100_000
  );

  const objectBoundary = createDocumentWithObjects(createManyStrokes(9_999));
  const objectInserted = objectBoundary.applyCommand(createCommand({
    id: 'reach-object-boundary',
    operations: [{
      type: 'insert-objects',
      index: 9_999,
      objects: [createStroke('stroke-9999')]
    }]
  }));
  assert.equal(objectInserted.applied, true);
  assert.equal(getKeyframe(objectBoundary).objects.length, 10_000);
  assertAtomicFailure(objectBoundary, createCommand({
    id: 'exceed-object-boundary',
    baseRevision: 1,
    operations: [{
      type: 'insert-objects',
      index: 10_000,
      objects: [createStroke('one-too-many')]
    }]
  }), 'object-limit-exceeded');
});

test('hard point limits distinguish stored content from user input', () => {
  const storedPoints = createPoints(20_001);
  const storedDocument = createDocumentWithObjects([
    createStroke('stored-stroke', { points: storedPoints })
  ]);
  assert.equal(getObjectById(storedDocument, 'stored-stroke').points.length, 20_001);

  const userPointLimited = createDocumentWithObjects();
  assertAtomicFailure(userPointLimited, createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('user-stroke', { points: storedPoints })]
    }]
  }), 'point-limit-exceeded');

  const oversizedStoredOptions = createDocumentOptions({
    initialLayers: [createLayerFixture({
      keyframes: [createKeyframeFixture({
        objects: [createStroke('oversized-stored', {
          points: createPoints(100_001)
        })]
      })]
    })]
  });
  assert.throws(() => createDrawingDocumentV3(oversizedStoredOptions), TypeError);
});

test('history restores a large stored stroke without weakening the user limit', () => {
  const largeStroke = createStroke('large-stored', {
    points: createPoints(50_000)
  });
  const document = createDocumentWithObjects([largeStroke]);
  const removed = document.applyCommand(createCommand({
    id: 'remove-large',
    kind: 'delete-objects',
    operations: [{ type: 'remove-objects', objectIds: ['large-stored'] }]
  }));
  assert.equal(removed.applied, true);

  const inverse = createInverseCommand(removed, { id: 'restore-large' });
  assertAtomicFailure(document, inverse, 'point-limit-exceeded');
  const restored = document.applyCommand(inverse, { source: 'history' });
  assert.equal(restored.applied, true);
  assert.equal(getObjectById(document, 'large-stored').points.length, 50_000);

  const historyLimited = createDocumentWithObjects();
  assertAtomicFailure(historyLimited, createCommand({
    id: 'history-too-large',
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('history-oversized', {
        points: createPoints(100_001)
      })]
    }]
  }), 'point-limit-exceeded', { source: 'history' });
});

test('user and history command count budgets accept exact boundaries and reject +1', () => {
  for (const [source, boundary] of [['user', 2], ['history', 3]]) {
    const applyOptions = source === 'history' ? { source } : undefined;
    const makeOperations = count => Array.from({ length: count }, (_, index) => ({
      type: 'set-transforms',
      transforms: [{
        objectId: 'stroke-1',
        transform: [1, 0, 0, 1, index + 1, 0]
      }]
    }));
    const exact = createDocumentWithObjects([createStroke('stroke-1')], {
      limits: createSmallCommandBudgetLimits()
    });
    assert.equal(exact.applyCommand(createCommand({
      kind: 'transform-objects',
      operations: makeOperations(boundary)
    }), applyOptions).applied, true);

    const over = createDocumentWithObjects([createStroke('stroke-1')], {
      limits: createSmallCommandBudgetLimits()
    });
    assertAtomicFailure(over, createCommand({
      kind: 'transform-objects',
      operations: makeOperations(boundary + 1)
    }), 'operation-limit-exceeded', applyOptions);
  }
});

test('user and history occurrence budgets cover insert, remove, and transform payloads', () => {
  for (const [source, boundary] of [['user', 2], ['history', 3]]) {
    const applyOptions = source === 'history' ? { source } : undefined;
    const limits = createSmallCommandBudgetLimits();

    const exactInsert = createDocumentWithObjects([], { limits });
    assert.equal(exactInsert.applyCommand(createCommand({
      operations: [{
        type: 'insert-objects',
        index: 0,
        objects: createManyStrokes(boundary)
      }]
    }), applyOptions).applied, true);
    const overInsert = createDocumentWithObjects([], { limits });
    assertAtomicFailure(overInsert, createCommand({
      operations: [{
        type: 'insert-objects',
        index: 0,
        objects: createManyStrokes(boundary + 1)
      }]
    }), 'command-object-reference-limit-exceeded', applyOptions);

    const exactRemove = createDocumentWithObjects(createManyStrokes(boundary), {
      limits
    });
    assert.equal(exactRemove.applyCommand(createCommand({
      kind: 'delete-objects',
      operations: [{
        type: 'remove-objects',
        objectIds: createManyStrokes(boundary).map(stroke => stroke.id)
      }]
    }), applyOptions).applied, true);
    const overRemove = createDocumentWithObjects(
      createManyStrokes(boundary + 1),
      { limits }
    );
    assertAtomicFailure(overRemove, createCommand({
      kind: 'delete-objects',
      operations: [{
        type: 'remove-objects',
        objectIds: createManyStrokes(boundary + 1).map(stroke => stroke.id)
      }]
    }), 'command-object-reference-limit-exceeded', applyOptions);

    const exactTransform = createDocumentWithObjects(createManyStrokes(boundary), {
      limits
    });
    assert.equal(exactTransform.applyCommand(createCommand({
      kind: 'transform-objects',
      operations: [{
        type: 'set-transforms',
        transforms: createManyStrokes(boundary).map((stroke, index) => ({
          objectId: stroke.id,
          transform: [1, 0, 0, 1, index + 1, 0]
        }))
      }]
    }), applyOptions).applied, true);
    const overTransform = createDocumentWithObjects(
      createManyStrokes(boundary + 1),
      { limits }
    );
    assertAtomicFailure(overTransform, createCommand({
      kind: 'transform-objects',
      operations: [{
        type: 'set-transforms',
        transforms: createManyStrokes(boundary + 1).map((stroke, index) => ({
          objectId: stroke.id,
          transform: [1, 0, 0, 1, index + 1, 0]
        }))
      }]
    }), 'command-object-reference-limit-exceeded', applyOptions);
  }
});

test('combined references count repeated IDs by occurrence for both sources', () => {
  for (const [source, boundary] of [['user', 2], ['history', 3]]) {
    const applyOptions = source === 'history' ? { source } : undefined;
    const limits = createSmallCommandBudgetLimits({
      maxUserOperationsPerCommand: 5,
      maxHistoryOperationsPerCommand: 5
    });
    const operations = [
      { type: 'remove-objects', objectIds: ['stroke-same'] },
      {
        type: 'insert-objects',
        index: 0,
        objects: [createStroke('stroke-same', { opacity: 0.5 })]
      }
    ];
    if (boundary >= 3) {
      operations.push({
        type: 'set-transforms',
        transforms: [{
          objectId: 'stroke-same',
          transform: [1, 0, 0, 1, 1, 0]
        }]
      });
    }
    const exact = createDocumentWithObjects([
      createStroke('stroke-same'),
      createStroke('stroke-other')
    ], { limits });
    assert.equal(exact.applyCommand(createCommand({
      kind: 'split-stroke',
      operations
    }), applyOptions).applied, true);

    const overOperations = structuredClone(operations);
    const transforms = overOperations.at(-1).type === 'set-transforms'
      ? overOperations.at(-1).transforms
      : null;
    if (transforms) {
      transforms.push({
        objectId: 'stroke-other',
        transform: [1, 0, 0, 1, 2, 0]
      });
    } else {
      overOperations.push({
        type: 'set-transforms',
        transforms: [{
          objectId: 'stroke-same',
          transform: [1, 0, 0, 1, 1, 0]
        }]
      });
    }
    const over = createDocumentWithObjects([
      createStroke('stroke-same'),
      createStroke('stroke-other')
    ], { limits });
    assertAtomicFailure(over, createCommand({
      kind: 'split-stroke',
      operations: overOperations
    }), 'command-object-reference-limit-exceeded', applyOptions);
  }
});

test('aggregate inserted point budgets accept exact boundaries and reject +1', () => {
  const limits = createSmallCommandBudgetLimits({
    maxUserOperationsPerCommand: 5,
    maxHistoryOperationsPerCommand: 5,
    maxUserInsertedObjectsPerCommand: 5,
    maxHistoryInsertedObjectsPerCommand: 5,
    maxUserRemovedIdsPerCommand: 5,
    maxHistoryRemovedIdsPerCommand: 5,
    maxUserTransformedIdsPerCommand: 5,
    maxHistoryTransformedIdsPerCommand: 5,
    maxUserObjectReferencesPerCommand: 5,
    maxHistoryObjectReferencesPerCommand: 5
  });
  for (const [source, boundary] of [['user', 2], ['history', 3]]) {
    const applyOptions = source === 'history' ? { source } : undefined;
    const commandFor = count => createCommand({
      operations: [{
        type: 'insert-objects',
        index: 0,
        objects: createManyStrokes(count)
      }]
    });
    const exact = createDocumentWithObjects([], { limits });
    assert.equal(exact.applyCommand(commandFor(boundary), applyOptions).applied, true);
    const over = createDocumentWithObjects([], { limits });
    assertAtomicFailure(over, commandFor(boundary + 1),
      'command-point-limit-exceeded', applyOptions);
  }
});

test('single-stroke source caps keep point-limit reason at exact and +1', () => {
  const limits = createSmallCommandBudgetLimits({
    maxInputPointsPerStroke: 2,
    maxStoredPointsPerStroke: 3,
    maxUserInsertedPointsPerCommand: 2,
    maxHistoryInsertedPointsPerCommand: 3
  });
  for (const [source, boundary] of [['user', 2], ['history', 3]]) {
    const applyOptions = source === 'history' ? { source } : undefined;
    const commandFor = count => createCommand({
      operations: [{
        type: 'insert-objects',
        index: 0,
        objects: [createStroke(`${source}-${count}`, {
          points: createPoints(count)
        })]
      }]
    });
    const exact = createDocumentWithObjects([], { limits });
    assert.equal(exact.applyCommand(commandFor(boundary), applyOptions).applied,
      true);
    const over = createDocumentWithObjects([], { limits });
    assertAtomicFailure(over, commandFor(boundary + 1),
      'point-limit-exceeded', applyOptions);
  }
});

test('approximate command bytes count UTF-16 and shared occurrences at exact boundaries', () => {
  const command = createCommand();
  const exactBytes = estimateCommandBytesForTest(command);
  assert.ok(exactBytes < 4 * 1024 * 1024);
  assert.equal(
    estimateCommandBytesForTest(createCommand({ actorId: 'A' })),
    estimateCommandBytesForTest(createCommand({ actorId: '한' }))
  );
  assert.equal(
    estimateCommandBytesForTest(createCommand({ actorId: '😀' })),
    estimateCommandBytesForTest(createCommand({ actorId: 'A' })) + 2
  );
  for (const source of ['user', 'history']) {
    const applyOptions = source === 'history' ? { source } : undefined;
    const limits = {
      maxUserCommandBytes: exactBytes,
      maxHistoryCommandBytes: exactBytes
    };
    const exact = createDocumentWithObjects([], { limits });
    assert.equal(exact.applyCommand(command, applyOptions).applied, true);

    const overCommand = createCommand({ actorId: `${command.actorId}한` });
    assert.equal(estimateCommandBytesForTest(overCommand), exactBytes + 2);
    const over = createDocumentWithObjects([], { limits });
    assertAtomicFailure(over, overCommand, 'command-payload-limit-exceeded',
      applyOptions);
  }

  const sharedPoint = { x: 10, y: 20, pressure: 0.5, time: 0 };
  const sharedCommand = createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('shared-points', {
        points: [sharedPoint, sharedPoint]
      })]
    }]
  });
  const sharedBytes = estimateCommandBytesForTest(sharedCommand);
  const sharedLimited = createDocumentWithObjects([], {
    limits: {
      maxUserCommandBytes: sharedBytes - 1,
      maxHistoryCommandBytes: sharedBytes
    }
  });
  assertAtomicFailure(sharedLimited, sharedCommand,
    'command-payload-limit-exceeded');
});

test('count-first gates reject oversized sparse arrays without deep inspection', {
  concurrency: false
}, () => {
  const cases = [];
  let getterCalls = 0;
  let ownKeysCalls = 0;
  const guardedArrays = new Set();
  const guardedSparse = length => {
    const array = new Array(length);
    guardedArrays.add(array);
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('nested getter must not run');
      }
    });
    return array;
  };

  cases.push([
    createCommand({ operations: guardedSparse(1_025) }),
    'operation-limit-exceeded'
  ]);
  cases.push([
    createCommand({
      operations: [{
        type: 'insert-objects',
        index: 0,
        objects: guardedSparse(513)
      }]
    }),
    'command-object-reference-limit-exceeded'
  ]);
  cases.push([
    createCommand({
      kind: 'delete-objects',
      operations: [{
        type: 'remove-objects',
        objectIds: guardedSparse(10_001)
      }]
    }),
    'command-object-reference-limit-exceeded'
  ]);
  cases.push([
    createCommand({
      kind: 'transform-objects',
      operations: [{
        type: 'set-transforms',
        transforms: guardedSparse(10_001)
      }]
    }),
    'command-object-reference-limit-exceeded'
  ]);
  const pointHeavy = createStroke('point-heavy', {
    points: guardedSparse(20_001)
  });
  pointHeavy.style.color = 'bad';
  cases.push([
    createCommand({
      operations: [{ type: 'insert-objects', index: 0, objects: [pointHeavy] }]
    }),
    'point-limit-exceeded'
  ]);

  const originalOwnKeys = Reflect.ownKeys;
  Reflect.ownKeys = value => {
    if (guardedArrays.has(value)) ownKeysCalls += 1;
    return originalOwnKeys(value);
  };
  try {
    for (const [commandValue, reason] of cases) {
      assertAtomicFailure(createDocumentWithObjects(), commandValue, reason);
    }
  } finally {
    Reflect.ownKeys = originalOwnKeys;
  }
  assert.equal(getterCalls, 0);
  assert.equal(ownKeysCalls, 0);
});

test('at-limit sparse, accessor, and class payloads keep malformed reasons', () => {
  let getterCalls = 0;
  const guardedSparse = length => {
    const array = new Array(length);
    Object.defineProperty(array, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter must not run');
      }
    });
    return array;
  };
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: guardedSparse(1_024)
  }), 'invalid-command');
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: guardedSparse(512)
    }]
  }), 'invalid-command');
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: [{
      type: 'insert-objects',
      index: 0,
      objects: [createStroke('sparse-points', {
        points: guardedSparse(20_000)
      })]
    }]
  }), 'invalid-object');
  class Operation {
    constructor() {
      this.type = 'insert-objects';
      this.index = 0;
      this.objects = [createStroke('class-op')];
    }
  }
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: [new Operation()]
  }), 'invalid-command');
  class OperationArray extends Array {}
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: new OperationArray(1_025)
  }), 'invalid-command');
  assert.equal(getterCalls, 0);
});

test('the 512-fragment split shape fits while 1,025 operations are rejected', () => {
  const operations = [{ type: 'remove-objects', objectIds: ['source'] }];
  for (let index = 0; index < 512; index += 1) {
    operations.push({
      type: 'insert-objects',
      index,
      objects: [createStroke(`fragment-${index}`)]
    });
  }
  const document = createDocumentWithObjects([createStroke('source')]);
  const result = document.applyCommand(createCommand({
    kind: 'split-stroke',
    operations
  }));
  assert.equal(result.applied, true);
  assert.equal(getKeyframe(document).objects.length, 512);

  const tooMany = Array.from({ length: 1_025 }, () => ({
    type: 'insert-objects',
    index: 0,
    objects: [createStroke('duplicate-after-gate')]
  }));
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: tooMany
  }), 'operation-limit-exceeded');
});

test('byte estimation is deferred behind dedupe, stale, target, lock, and semantics', () => {
  const lowByteLimits = {
    maxUserCommandBytes: 1_500,
    maxHistoryCommandBytes: 2_000
  };
  const used = createDocumentWithObjects([], { limits: lowByteLimits });
  assert.equal(used.applyCommand(createCommand({ id: 'used-id' })).applied, true);
  assertAtomicFailure(used, createCommand({
    id: 'used-id',
    baseRevision: 1,
    actorId: '한'.repeat(1_000),
    kind: 'transform-objects',
    operations: [{
      type: 'set-transforms',
      transforms: [{ objectId: 'stroke-new', transform: [0, 0, 0, 0, 0, 0] }]
    }]
  }), 'duplicate-command-id');

  const invalidStroke = createStroke('invalid-stale');
  invalidStroke.style.color = 'red';
  const stale = createDocumentWithObjects([], { limits: lowByteLimits });
  assertAtomicFailure(stale, createCommand({
    baseRevision: 1,
    actorId: '한'.repeat(1_000),
    operations: [{ type: 'insert-objects', index: 0, objects: [invalidStroke] }]
  }), 'stale-revision');

  const missingTarget = createDocumentWithObjects([], { limits: lowByteLimits });
  assertAtomicFailure(missingTarget, createCommand({
    actorId: '한'.repeat(1_000),
    target: { layerId: 'missing', keyframeId: 'missing', frame: 0 },
    operations: [{ type: 'insert-objects', index: 0, objects: [invalidStroke] }]
  }), 'target-not-found');

  const locked = createDocumentWithObjects([], {
    limits: lowByteLimits,
    layer: { locked: true }
  });
  assertAtomicFailure(locked, createCommand({
    actorId: '한'.repeat(1_000),
    operations: [{ type: 'insert-objects', index: 0, objects: [invalidStroke] }]
  }), 'layer-locked');

  const semanticOrder = createDocumentWithObjects([createStroke('existing')]);
  assertAtomicFailure(semanticOrder, createCommand({
    kind: 'split-stroke',
    operations: [
      { type: 'remove-objects', objectIds: ['missing'] },
      {
        type: 'set-transforms',
        transforms: [{ objectId: 'existing', transform: [0, 0, 0, 0, 0, 0] }]
      },
      {
        type: 'insert-objects',
        index: 1,
        objects: [createStroke('inserted')]
      }
    ]
  }), 'object-not-found');

  const malformedOversized = createCommand({
    actorId: '',
    operations: new Array(1_025)
  });
  assertAtomicFailure(createDocumentWithObjects(), malformedOversized,
    'invalid-command');
  assertAtomicFailure(createDocumentWithObjects(), createCommand({
    operations: new Array(1_025)
  }), 'invalid-command', { source: 'external' });
});

test('byte and revision precedence is fixed before inverse admission', () => {
  const oversized = createCommand({
    baseRevision: Number.MAX_SAFE_INTEGER,
    actorId: '한'.repeat(1_000)
  });
  const byteLimit = estimateCommandBytesForTest(oversized) - 1;
  const byteFirst = createDocumentWithObjects([], {
    revisionSequence: Number.MAX_SAFE_INTEGER,
    limits: {
      maxUserCommandBytes: byteLimit,
      maxHistoryCommandBytes: byteLimit + 1
    }
  });
  assertAtomicFailure(byteFirst, oversized, 'command-payload-limit-exceeded');

  const inverseLimited = createSmallCommandBudgetLimits({
    maxStoredPointsPerStroke: 2,
    maxHistoryInsertedPointsPerCommand: 2
  });
  const revisionFirst = createDocumentWithObjects([
    createStroke('revision-a', { points: createPoints(2) }),
    createStroke('revision-b', { points: createPoints(2) })
  ], {
    revisionSequence: Number.MAX_SAFE_INTEGER,
    limits: inverseLimited
  });
  assertAtomicFailure(revisionFirst, createCommand({
    baseRevision: Number.MAX_SAFE_INTEGER,
    kind: 'delete-objects',
    operations: [{
      type: 'remove-objects',
      objectIds: ['revision-a', 'revision-b']
    }]
  }), 'revision-limit-exceeded');
});

test('cyclic and accessor records keep field-specific invalid reasons without getters', () => {
  const cyclic = createStroke('cyclic');
  cyclic.style.self = cyclic.style;
  const cycleDocument = createDocumentWithObjects([], {
    limits: { maxUserCommandBytes: 1, maxHistoryCommandBytes: 1 }
  });
  assertAtomicFailure(cycleDocument, createCommand({
    operations: [{ type: 'insert-objects', index: 0, objects: [cyclic] }]
  }), 'invalid-object');

  let getterCalls = 0;
  const accessor = createStroke('accessor');
  Object.defineProperty(accessor.style, 'color', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('style getter must not run');
    }
  });
  const accessorDocument = createDocumentWithObjects([], {
    limits: { maxUserCommandBytes: 1, maxHistoryCommandBytes: 1 }
  });
  assertAtomicFailure(accessorDocument, createCommand({
    operations: [{ type: 'insert-objects', index: 0, objects: [accessor] }]
  }), 'invalid-object');
  assert.equal(getterCalls, 0);
});

test('generated inverse operation and point budgets fail atomically and keep IDs reusable', () => {
  const operationLimits = createSmallCommandBudgetLimits({
    maxUserOperationsPerCommand: 1,
    maxHistoryOperationsPerCommand: 2,
    maxUserInsertedObjectsPerCommand: 1,
    maxHistoryInsertedObjectsPerCommand: 3,
    maxUserRemovedIdsPerCommand: 1,
    maxHistoryRemovedIdsPerCommand: 3,
    maxUserTransformedIdsPerCommand: 1,
    maxHistoryTransformedIdsPerCommand: 3,
    maxUserObjectReferencesPerCommand: 1,
    maxHistoryObjectReferencesPerCommand: 3,
    maxUserInsertedPointsPerCommand: 1,
    maxHistoryInsertedPointsPerCommand: 3
  });
  const operationDocument = createDocumentWithObjects(createManyStrokes(3), {
    limits: operationLimits
  });
  assertAtomicFailure(operationDocument, createCommand({
    id: 'inverse-operation-overflow',
    kind: 'delete-objects',
    operations: [{
      type: 'remove-objects',
      objectIds: ['stroke-0', 'stroke-1', 'stroke-2']
    }]
  }), 'inverse-command-limit-exceeded', { source: 'history' });
  assert.equal(operationDocument.applyCommand(createCommand({
    id: 'inverse-operation-overflow',
    kind: 'delete-objects',
    operations: [{
      type: 'remove-objects',
      objectIds: ['stroke-0', 'stroke-1']
    }]
  }), { source: 'history' }).applied, true);

  const pointLimits = createSmallCommandBudgetLimits({
    maxStoredPointsPerStroke: 2,
    maxHistoryInsertedPointsPerCommand: 2
  });
  const pointDocument = createDocumentWithObjects([
    createStroke('two-a', { points: createPoints(2) }),
    createStroke('two-b', { points: createPoints(2) })
  ], { limits: pointLimits });
  assertAtomicFailure(pointDocument, createCommand({
    id: 'inverse-point-overflow',
    kind: 'delete-objects',
    operations: [{ type: 'remove-objects', objectIds: ['two-a', 'two-b'] }]
  }), 'inverse-command-limit-exceeded');
  const retry = pointDocument.applyCommand(createCommand({
    id: 'inverse-point-overflow',
    kind: 'delete-objects',
    operations: [{ type: 'remove-objects', objectIds: ['two-a'] }]
  }));
  assert.equal(retry.applied, true);
});

test('generated inverse byte budget is checked before commit', () => {
  const stroke = createStroke('inverse-byte-stroke');
  const forward = createCommand({
    id: 'inverse-byte',
    kind: 'delete-objects',
    operations: [{ type: 'remove-objects', objectIds: [stroke.id] }]
  });
  const inverseOperations = [{
    type: 'insert-objects',
    index: 0,
    objects: [stroke]
  }];
  const forwardBytes = estimateCommandBytesForTest(forward);
  const inverseBytes = estimateCommandBytesForTest(inverseOperations);
  assert.ok(inverseBytes > forwardBytes);
  const document = createDocumentWithObjects([stroke], {
    limits: {
      maxUserCommandBytes: forwardBytes,
      maxHistoryCommandBytes: inverseBytes - 1
    }
  });
  assertAtomicFailure(document, forward, 'inverse-command-limit-exceeded');
});

test('public inverse clone failure cannot partially commit or consume the command ID', () => {
  const document = createDocumentWithObjects();
  const command = createCommand({ id: 'clone-failure' });
  const before = document.getContentSnapshot();
  const head = document.getHead();
  const originalStructuredClone = global.structuredClone;
  global.structuredClone = value => {
    if (Array.isArray(value) && value.length === 1 &&
      value[0]?.type === 'remove-objects') {
      throw new Error('injected public inverse clone failure');
    }
    return originalStructuredClone(value);
  };
  try {
    assert.throws(() => document.applyCommand(command),
      /injected public inverse clone failure/);
  } finally {
    global.structuredClone = originalStructuredClone;
  }
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.deepEqual(document.getHead(), head);
  assert.equal(document.applyCommand(command).applied, true);
});

test('new limit overrides enforce hard caps and cross-profile relationships', () => {
  assert.doesNotThrow(() => createDrawingDocumentV3(createDocumentOptions({
    limits: createSmallCommandBudgetLimits()
  })));
  const invalidLimits = [
    { maxUserOperationsPerCommand: 0 },
    { maxHistoryOperationsPerCommand: 10_001 },
    { maxUserOperationsPerCommand: 4, maxHistoryOperationsPerCommand: 3 },
    {
      maxUserInsertedObjectsPerCommand: 4,
      maxUserObjectReferencesPerCommand: 3
    },
    {
      maxInputPointsPerStroke: 4,
      maxUserInsertedPointsPerCommand: 3
    },
    {
      maxStoredPointsPerStroke: 4,
      maxHistoryInsertedPointsPerCommand: 3
    },
    {
      maxUserRemovedIdsPerCommand: 4,
      maxHistoryInsertedObjectsPerCommand: 3
    },
    {
      maxUserObjectReferencesPerCommand: 4,
      maxHistoryOperationsPerCommand: 3
    },
    { maxUserCommandBytes: 2_000, maxHistoryCommandBytes: 1_000 }
  ];
  for (const limits of invalidLimits) {
    assert.throws(() => createDrawingDocumentV3(createDocumentOptions({ limits })),
      TypeError);
  }
});

test('drawing regression suite includes DrawingDocumentV3 coverage', () => {
  assert.match(
    packageJson.scripts['test:drawing'],
    /(?:^|\s)scripts\/tests\/drawing-v3-document\.test\.js(?:\s|$)/
  );
});
