'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
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
