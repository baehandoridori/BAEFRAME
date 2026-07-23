import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');
const {
  createFabricOverlayRuntime,
  createSessionSceneStore
} = require('../../renderer/scripts/modules/mpv-fabric-overlay-runtime.js');
const {
  createDrawingEngineAdapter
} = require('../../renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js');
const {
  createDrawingDocumentV3
} = require('../../renderer/scripts/modules/drawing-v3/drawing-document.js');

const IDENTITY = Object.freeze({
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
const SCENE = Object.freeze({
  sceneInstanceId: 'benchmark-scene',
  targetFrame: 12,
  sourceWidth: 1920,
  sourceHeight: 1080,
  mutationSequence: 0
});
const telemetry = {
  benchmark: 'drawing-v3-engine-adapter',
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    baeframe: packageJson.version
  }
};
const runtimeSource = readFileSync(new URL(
  '../../renderer/scripts/modules/mpv-fabric-overlay-runtime.js',
  import.meta.url
), 'utf8');
const adapterSource = readFileSync(new URL(
  '../../renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js',
  import.meta.url
), 'utf8');

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function session(overrides = {}) {
  return {
    sessionId: 'benchmark-session',
    stableVideoIdentity: 'benchmark-video',
    targetFrame: 12,
    videoGeneration: 1,
    sourceWidth: 1920,
    sourceHeight: 1080,
    tool: 'brush',
    ...overrides
  };
}

function points(count = 2, y = 20) {
  return Array.from({ length: count }, (_value, index) => ({
    x: index % 1920,
    y: y + (index % 3),
    pressure: 0.5,
    pointerType: 'pen',
    time: index
  }));
}

function stroke(id, overrides = {}) {
  return {
    id,
    type: 'stroke',
    pathData: 'M 0 0 L 10 10 Z',
    sourcePoints: overrides.sourcePoints || points(),
    strokeCaps: overrides.strokeCaps || { start: true, end: true },
    style: overrides.style || { color: '#ff4757', size: 6, opacity: 1 },
    transform: { ...IDENTITY, ...(overrides.transform || {}) }
  };
}

function event(sequence, changes = {}) {
  return {
    scene: {
      sceneInstanceId: SCENE.sceneInstanceId,
      targetFrame: SCENE.targetFrame,
      sourceWidth: SCENE.sourceWidth,
      sourceHeight: SCENE.sourceHeight
    },
    mutationSequence: sequence,
    origin: 'live',
    kind: 'transform-objects',
    estimatedBytes: 256,
    unsupportedReason: null,
    removals: [],
    insertions: [],
    transforms: [],
    ...changes
  };
}

function percentile(samples, ratio) {
  assert.ok(samples.length > 0);
  const sorted = samples.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function latencySummary(samples, limitMs = null) {
  const result = {
    samples: samples.length,
    medianMs: rounded(percentile(samples, 0.5)),
    p95Ms: rounded(percentile(samples, 0.95)),
    maxMs: rounded(Math.max(...samples))
  };
  if (Number.isFinite(limitMs)) {
    result.limitMs = limitMs;
    result.status = result.p95Ms <= limitMs ? 'PASS' : 'WARN';
  }
  return result;
}

function createScheduledAdapter(options = {}) {
  const scheduled = [];
  let idSequence = 0;
  const adapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-${++idSequence}`,
    nowIso: () => '2026-07-23T00:00:00.000Z',
    latencyNow: () => performance.now(),
    scheduleWork: callback => scheduled.push(callback),
    fallbackScheduleWork: callback => scheduled.push(callback),
    ...options
  });
  return {
    adapter,
    scheduled,
    flushAll() {
      while (scheduled.length > 0) scheduled.shift()();
    }
  };
}

function seedStore(store, count, prefix = 'seeded') {
  assert.equal(store.addStroke(stroke(`${prefix}-placeholder`)).applied, true);
  const records = Array.from({ length: count }, (_value, index) =>
    stroke(index === 0 ? `${prefix}-target` : `${prefix}-unrelated-${index}`));
  assert.equal(store.replaceObjects({
    replacements: [{
      removeId: `${prefix}-placeholder`,
      addObjects: records
    }]
  }).applied, true);
  return records;
}

function makeStore(observer = null, overrides = {}) {
  const store = createSessionSceneStore({
    maxObjects: 10_000,
    maxBytes: 256 * 1024 * 1024,
    maxHistoryBytes: 64 * 1024 * 1024,
    estimateObjectBytes: () => 1,
    createSceneInstanceId: () => SCENE.sceneInstanceId,
    ...(observer ? { drawingEngineObserver: observer } : {}),
    ...overrides
  });
  assert.equal(store.activateSession(session()).accepted, true);
  return store;
}

function measure(operation) {
  const startedAt = performance.now();
  const result = operation();
  return { result, elapsedMs: performance.now() - startedAt };
}

function measurePair(index, offOperation, onOperation) {
  let off;
  let on;
  if (index % 2 === 0) {
    off = measure(offOperation);
    on = measure(onOperation);
  } else {
    on = measure(onOperation);
    off = measure(offOperation);
  }
  assert.equal(off.result.applied, true);
  assert.equal(on.result.applied, true);
  return { offMs: off.elapsedMs, onMs: on.elapsedMs, deltaMs: on.elapsedMs - off.elapsedMs };
}

function scenarioSummary(samples) {
  const shadowOff = latencySummary(samples.map(sample => sample.offMs));
  const shadowOn = latencySummary(samples.map(sample => sample.onMs));
  const onMinusOffP95Ms = rounded(shadowOn.p95Ms - shadowOff.p95Ms);
  return {
    shadowOff,
    shadowOn,
    onMinusOffP95Ms,
    limitMs: 4,
    status: onMinusOffP95Ms <= 4 ? 'PASS' : 'WARN'
  };
}

test('source gate keeps shadow work on touched history payloads and default OFF', () => {
  const transitionSource = sourceSection(
    runtimeSource,
    'function makeTransitionEvent',
    'function nextCommandId'
  );
  const transformStart = transitionSource.indexOf(
    "if (beforeState.type === 'transforms')"
  );
  const objectStart = transitionSource.indexOf(
    "if (beforeState.type !== 'objects'"
  );
  assert.ok(transformStart >= 0 && objectStart > transformStart);
  const transformBranch = transitionSource.slice(transformStart, objectStart);
  assert.match(transformBranch, /beforeState\.transforms/);
  assert.match(transformBranch, /afterState\.transforms/);
  assert.match(transformBranch, /return event;/);
  assert.doesNotMatch(
    transformBranch,
    /scene\.objects|sourcePoints|JSON\.stringify|structuredClone|estimateObjectsBytes/
  );

  const commitSource = sourceSection(
    runtimeSource,
    'function commitStagedMutation',
    'function activateSession'
  );
  assert.match(commitSource, /beforeState: change\.undoState/);
  assert.match(commitSource, /afterState: change\.redoState/);
  const queueSnapshotSource = sourceSection(
    adapterSource,
    'function snapshotTransitionEnvelope',
    'function normalizeFabricTransform'
  );
  assert.doesNotMatch(
    queueSnapshotSource,
    /clonePlain|structuredClone|JSON\.stringify|sourcePoints/
  );

  const runtimeInitialization = sourceSection(
    runtimeSource,
    'const drawingV3ShadowRequested',
    'const actionDeduper'
  );
  assert.match(
    runtimeInitialization,
    /options\.drawingV3ShadowEnabled === true/
  );
  assert.match(
    runtimeInitialization,
    /if \(drawingV3ShadowRequested && !customSceneStore\)/
  );
  assert.match(
    runtimeInitialization,
    /drawingV3Adapter \? \{ drawingEngineObserver: drawingV3Adapter \} : \{\}/
  );
  assert.equal((runtimeSource.match(/drawingV3AdapterFactory/g) || []).length, 2,
    'adapter factory must remain startup-only');
  telemetry.sourceGates = {
    touchedTransformHistoryOnly: true,
    shallowQueueEnvelope: true,
    defaultOffStartupOnly: true
  };
});

test('2,000-object adapter transform reports bounded hot-path latency and exact projection', t => {
  const harness = createScheduledAdapter();
  const records = new Map(Array.from({ length: 2_000 }, (_value, index) => {
    const record = stroke(`adapter-${index}`);
    return [record.id, record];
  }));
  assert.equal(harness.adapter.activateScene(SCENE, records).activated, true);

  const samples = [];
  let currentLeft = 0;
  for (let sequence = 1; sequence <= 220; sequence += 1) {
    const nextLeft = currentLeft === 0 ? 1 : 0;
    const transition = event(sequence, {
      transforms: [{
        id: 'adapter-1000',
        beforeTransform: { ...IDENTITY, left: currentLeft },
        afterTransform: { ...IDENTITY, left: nextLeft }
      }]
    });
    const startedAt = performance.now();
    const result = harness.adapter.applyTransition(transition);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(result.applied, true);
    if (sequence > 20) samples.push(elapsedMs);
    currentLeft = nextLeft;
  }

  const projection = harness.adapter.getSceneProjection(SCENE.sceneInstanceId);
  assert.ok(projection);
  assert.equal(projection.headSequence, 220);
  assert.equal(projection.document.layers[0].keyframes[0].objects.length, 2_000);
  assert.deepEqual(
    projection.document.layers[0].keyframes[0].objects[1_000].transform,
    [1, 0, 0, 1, currentLeft, 0]
  );
  telemetry.adapterTransform2000 = latencySummary(samples, 4);
  if (telemetry.adapterTransform2000.status === 'WARN') {
    t.diagnostic('local timing warning: 2,000-object adapter transform p95 exceeded 4ms');
  }
  assert.ok(telemetry.adapterTransform2000.p95Ms <= 4,
    '2,000-object adapter transform p95 must stay within 4ms');
});

test('primary return stays ahead of observer work and adds no unrelated event scan', async t => {
  let documentApplyCount = 0;
  const synchronousAdapter = createDrawingEngineAdapter({
    createId: prefix => `${prefix}-sync`,
    nowIso: () => '2026-07-23T00:00:00.000Z',
    latencyNow: () => performance.now(),
    scheduleWork(callback) {
      callback();
    },
    fallbackScheduleWork(callback) {
      callback();
    },
    createDocument(options) {
      const document = createDrawingDocumentV3(options);
      return {
        applyCommand(command, applyOptions) {
          documentApplyCount += 1;
          return document.applyCommand(command, applyOptions);
        },
        getContentSnapshot: () => document.getContentSnapshot(),
        getHead: () => document.getHead()
      };
    }
  });
  const syncStore = makeStore(synchronousAdapter);
  const syncAdd = syncStore.addStroke(stroke('sync-boundary'));
  assert.equal(syncAdd.applied, true);
  assert.equal(documentApplyCount, 0, 'observer work must not run before primary return');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(documentApplyCount, 1);

  const transitions = [];
  const observer = {
    activateScene() {},
    enqueueTransition(transition) {
      transitions.push(transition);
    },
    quarantineScene() {},
    dropScenes() {}
  };
  let offEstimateCalls = 0;
  let onEstimateCalls = 0;
  const offStore = makeStore(null, {
    estimateObjectBytes() {
      offEstimateCalls += 1;
      return 1;
    }
  });
  const onStore = makeStore(observer, {
    estimateObjectBytes() {
      onEstimateCalls += 1;
      return 1;
    }
  });
  seedStore(offStore, 4_001, 'off-4000');
  seedStore(onStore, 4_001, 'on-4000');
  offStore.selectObjects(['off-4000-target']);
  onStore.selectObjects(['on-4000-target']);
  transitions.length = 0;
  offEstimateCalls = 0;
  onEstimateCalls = 0;

  const countPrimaryWork = operation => {
    const originalStringify = JSON.stringify;
    const originalMapMethods = {
      iterator: Map.prototype[Symbol.iterator],
      entries: Map.prototype.entries,
      keys: Map.prototype.keys,
      values: Map.prototype.values
    };
    const originalArrayMethods = Object.fromEntries(
      ['every', 'filter', 'forEach', 'map', 'some'].map(name => [name, Array.prototype[name]])
    );
    let stringifyCalls = 0;
    let mapItemVisits = 0;
    let arrayItemVisitUpperBound = 0;
    const instrumentMapIterator = original => function instrumentedMapIterator(...args) {
      const iterator = original.apply(this, args);
      return {
        next() {
          const entry = iterator.next();
          if (!entry.done) mapItemVisits += 1;
          return entry;
        },
        [Symbol.iterator]() {
          return this;
        }
      };
    };
    Object.defineProperties(Map.prototype, {
      [Symbol.iterator]: { configurable: true, writable: true,
        value: instrumentMapIterator(originalMapMethods.iterator) },
      entries: { configurable: true, writable: true,
        value: instrumentMapIterator(originalMapMethods.entries) },
      keys: { configurable: true, writable: true,
        value: instrumentMapIterator(originalMapMethods.keys) },
      values: { configurable: true, writable: true,
        value: instrumentMapIterator(originalMapMethods.values) }
    });
    for (const [name, original] of Object.entries(originalArrayMethods)) {
      Object.defineProperty(Array.prototype, name, {
        configurable: true,
        writable: true,
        value: function instrumentedArrayTraversal(...args) {
          arrayItemVisitUpperBound += this.length;
          return original.apply(this, args);
        }
      });
    }
    JSON.stringify = function instrumentedStringify(...args) {
      stringifyCalls += 1;
      return originalStringify.apply(this, args);
    };
    try {
      const measurement = measure(operation);
      assert.equal(measurement.result.applied, true);
      return {
        stringifyCalls,
        mapItemVisits,
        arrayItemVisitUpperBound,
        elapsedMs: measurement.elapsedMs
      };
    } finally {
      JSON.stringify = originalStringify;
      Object.defineProperties(Map.prototype, {
        [Symbol.iterator]: { configurable: true, writable: true,
          value: originalMapMethods.iterator },
        entries: { configurable: true, writable: true, value: originalMapMethods.entries },
        keys: { configurable: true, writable: true, value: originalMapMethods.keys },
        values: { configurable: true, writable: true, value: originalMapMethods.values }
      });
      for (const [name, original] of Object.entries(originalArrayMethods)) {
        Object.defineProperty(Array.prototype, name, {
          configurable: true,
          writable: true,
          value: original
        });
      }
    }
  };
  const offMeasurement = countPrimaryWork(() => offStore.transformSelection({ dx: 1, dy: 0 }));
  const onMeasurement = countPrimaryWork(() => onStore.transformSelection({ dx: 1, dy: 0 }));
  assert.equal(onMeasurement.stringifyCalls, offMeasurement.stringifyCalls,
    'observer event assembly must add zero JSON clone or byte scans');
  assert.equal(onEstimateCalls, offEstimateCalls,
    'observer event assembly must add zero object-byte scans');
  assert.ok(onMeasurement.mapItemVisits - offMeasurement.mapItemVisits < 64,
    'observer event assembly must not visit 4,000 unrelated map records');
  assert.ok(onMeasurement.arrayItemVisitUpperBound -
    offMeasurement.arrayItemVisitUpperBound < 64,
  'observer event assembly must not visit 4,000 unrelated array records');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].transforms.length, 1);
  assert.equal(transitions[0].insertions.length, 0);
  assert.equal(transitions[0].removals.length, 0);

  const primaryStore = makeStore(observer);
  seedStore(primaryStore, 2_000, 'primary-2000');
  primaryStore.selectObjects(['primary-2000-target']);
  const primarySamples = [];
  for (let index = 0; index < 120; index += 1) {
    const measurement = measure(() => primaryStore.transformSelection({
      dx: index % 2 === 0 ? 1 : -1,
      dy: 0
    }));
    assert.equal(measurement.result.applied, true);
    if (index >= 20) primarySamples.push(measurement.elapsedMs);
  }
  telemetry.primaryTransform2000 = latencySummary(primarySamples, 1);
  telemetry.unrelated4000EventAssembly = {
    extraJsonStringifyCalls:
      onMeasurement.stringifyCalls - offMeasurement.stringifyCalls,
    extraObjectEstimateCalls: onEstimateCalls - offEstimateCalls,
    extraMapItemVisits: onMeasurement.mapItemVisits - offMeasurement.mapItemVisits,
    extraArrayItemVisitUpperBound:
      onMeasurement.arrayItemVisitUpperBound - offMeasurement.arrayItemVisitUpperBound,
    shadowOffMs: rounded(offMeasurement.elapsedMs),
    shadowOnMs: rounded(onMeasurement.elapsedMs)
  };
  if (telemetry.primaryTransform2000.status === 'WARN') {
    t.diagnostic('local timing warning: primary enqueue+return p95 exceeded 1ms');
  }
  assert.ok(telemetry.primaryTransform2000.p95Ms < 1,
    'primary enqueue+return p95 must stay below 1ms');

  syncStore.destroy();
  synchronousAdapter.destroy();
  offStore.destroy();
  onStore.destroy();
  primaryStore.destroy();
});

test('shadow ON/OFF deltas, 512-fragment atomicity, queue cleanup and B100 stay bounded', t => {
  const runScenario = ({ count, setup, prepareOperation, operation }) => {
    const shadow = createScheduledAdapter();
    const offStore = makeStore();
    const onStore = makeStore(shadow.adapter);
    setup?.(offStore, onStore);
    shadow.flushAll();
    const preparedOperations = Array.from(
      { length: count },
      (_value, index) => prepareOperation?.(index)
    );
    const samples = [];
    for (let index = 0; index < count; index += 1) {
      const sample = measurePair(
        index,
        () => operation(offStore, index, preparedOperations[index]),
        () => operation(onStore, index, preparedOperations[index])
      );
      samples.push(sample);
      shadow.flushAll();
    }
    assert.equal(offStore.getDiagnostics().objectCount, onStore.getDiagnostics().objectCount);
    assert.equal(offStore.getDiagnostics().mutationCount, onStore.getDiagnostics().mutationCount);
    const shadowDiagnostics = shadow.adapter.getDiagnostics(SCENE.sceneInstanceId);
    assert.equal(shadowDiagnostics.status, 'synced');
    assert.equal(shadowDiagnostics.failureCount, 0);
    assert.equal(shadowDiagnostics.commitCount, onStore.getDiagnostics().mutationCount);
    const summary = scenarioSummary(samples);
    offStore.destroy();
    onStore.destroy();
    shadow.adapter.destroy();
    return summary;
  };

  telemetry.primaryReturnDelta = {
    normalBrush: runScenario({
      count: 24,
      prepareOperation: index => stroke(`normal-${index}`),
      operation: (store, _index, record) => store.addStroke(record)
    }),
    boundary20000PointBrush: runScenario({
      count: 24,
      prepareOperation: index => stroke(`boundary-${index}`, {
        sourcePoints: points(20_000, 40 + index)
      }),
      operation: (store, _index, record) => store.addStroke(record)
    }),
    normalMultiFragmentSplit: runScenario({
      count: 32,
      setup(offStore, onStore) {
        for (let index = 0; index < 32; index += 1) {
          const original = stroke(`split-original-${index}`, { sourcePoints: points(18, 70 + index) });
          assert.equal(offStore.addStroke(original).applied, true);
          assert.equal(onStore.addStroke(original).applied, true);
        }
      },
      prepareOperation: index => ({
        kind: 'split-stroke',
        replacements: [{
          removeId: `split-original-${index}`,
          addObjects: Array.from({ length: 8 }, (_value, fragmentIndex) =>
            stroke(`split-${index}-${fragmentIndex}`, {
              sourcePoints: points(2, 80 + fragmentIndex),
              strokeCaps: {
                start: fragmentIndex === 0,
                end: fragmentIndex === 7
              }
            }))
        }]
      }),
      operation: (store, _index, replacement) => store.replaceObjects(replacement)
    })
  };
  for (const [name, summary] of Object.entries(telemetry.primaryReturnDelta)) {
    if (summary.status === 'WARN') {
      t.diagnostic(`local timing warning: ${name} shadow ON/OFF p95 delta ` +
        `${summary.onMinusOffP95Ms}ms exceeded 4ms`);
    }
    assert.ok(summary.onMinusOffP95Ms <= 4,
      `${name} shadow ON/OFF p95 delta must stay within 4ms`);
  }

  const boundaryHarness = createScheduledAdapter();
  let boundaryOffEstimateCalls = 0;
  let boundaryOnEstimateCalls = 0;
  const boundaryOffStore = makeStore(null, {
    estimateObjectBytes() {
      boundaryOffEstimateCalls += 1;
      return 1;
    }
  });
  const boundaryOnStore = makeStore(boundaryHarness.adapter, {
    estimateObjectBytes() {
      boundaryOnEstimateCalls += 1;
      return 1;
    }
  });
  const boundaryRecord = stroke('instrumented-boundary', {
    sourcePoints: points(20_000, 60)
  });
  boundaryOffEstimateCalls = 0;
  boundaryOnEstimateCalls = 0;
  const profileBoundaryAdd = store => {
    const originalStructuredClone = globalThis.structuredClone;
    const originalBoundaryStringify = JSON.stringify;
    const originalBoundaryParse = JSON.parse;
    let structuredCloneCalls = 0;
    let largeJsonSerializations = 0;
    let pointArrayItemReads = 0;
    const instrumentParsedPointArrays = value => {
      if (Array.isArray(value)) {
        for (const item of value) instrumentParsedPointArrays(item);
        return value;
      }
      if (!value || typeof value !== 'object') return value;
      for (const [key, child] of Object.entries(value)) {
        instrumentParsedPointArrays(child);
        if (key !== 'sourcePoints' || !Array.isArray(child)) continue;
        value[key] = new Proxy(child, {
          get(target, property, receiver) {
            if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) {
              pointArrayItemReads += 1;
            }
            return Reflect.get(target, property, receiver);
          }
        });
      }
      return value;
    };
    globalThis.structuredClone = function instrumentedStructuredClone(...args) {
      structuredCloneCalls += 1;
      return Reflect.apply(originalStructuredClone, globalThis, args);
    };
    JSON.stringify = function instrumentedBoundaryStringify(...args) {
      const serialized = originalBoundaryStringify.apply(this, args);
      if (typeof serialized === 'string' && serialized.length >= 100_000) {
        largeJsonSerializations += 1;
      }
      return serialized;
    };
    JSON.parse = function instrumentedBoundaryParse(...args) {
      return instrumentParsedPointArrays(originalBoundaryParse.apply(this, args));
    };
    try {
      const result = store.addStroke(boundaryRecord);
      assert.equal(result.applied, true);
      return { structuredCloneCalls, largeJsonSerializations, pointArrayItemReads };
    } finally {
      globalThis.structuredClone = originalStructuredClone;
      JSON.stringify = originalBoundaryStringify;
      JSON.parse = originalBoundaryParse;
    }
  };
  const boundaryOffProfile = profileBoundaryAdd(boundaryOffStore);
  const boundaryOnProfile = profileBoundaryAdd(boundaryOnStore);
  assert.equal(boundaryOnProfile.structuredCloneCalls, boundaryOffProfile.structuredCloneCalls,
    'shadow enqueue must not deep-clone a boundary point array');
  assert.equal(boundaryOnProfile.largeJsonSerializations, boundaryOffProfile.largeJsonSerializations,
    'shadow event assembly must not serialize a boundary point array again');
  assert.equal(boundaryOnProfile.pointArrayItemReads, boundaryOffProfile.pointArrayItemReads,
    'shadow event assembly must not manually scan or copy a boundary point array');
  assert.equal(boundaryOnEstimateCalls, boundaryOffEstimateCalls,
    'shadow event assembly must not rescan a boundary point array for byte accounting');
  telemetry.boundaryPointArrayHotPath = {
    extraStructuredCloneCalls:
      boundaryOnProfile.structuredCloneCalls - boundaryOffProfile.structuredCloneCalls,
    extraLargeJsonSerializations:
      boundaryOnProfile.largeJsonSerializations - boundaryOffProfile.largeJsonSerializations,
    extraPointArrayItemReads:
      boundaryOnProfile.pointArrayItemReads - boundaryOffProfile.pointArrayItemReads,
    extraObjectEstimateCalls: boundaryOnEstimateCalls - boundaryOffEstimateCalls
  };
  boundaryOffStore.destroy();
  boundaryOnStore.destroy();
  boundaryHarness.adapter.destroy();

  const fragmentHarness = createScheduledAdapter();
  const fragmentStore = makeStore(fragmentHarness.adapter);
  const original = stroke('fragment-original', { sourcePoints: points(1_025, 100) });
  assert.equal(fragmentStore.addStroke(original).applied, true);
  const fragments = Array.from({ length: 512 }, (_value, index) =>
    stroke(`fragment-${index}`, {
      sourcePoints: points(2, 100 + (index % 20)),
      strokeCaps: { start: index === 0, end: index === 511 }
    }));
  assert.equal(fragmentStore.replaceObjects({
    kind: 'split-stroke',
    replacements: [{ removeId: original.id, addObjects: fragments }]
  }).applied, true);
  fragmentHarness.flushAll();
  const fragmentProjection = fragmentHarness.adapter.getSceneProjection(SCENE.sceneInstanceId);
  const fragmentDiagnostics = fragmentHarness.adapter.getDiagnostics(SCENE.sceneInstanceId);
  assert.ok(fragmentProjection, 'normal-budget 512-fragment split must project atomically');
  const fragmentKeyframe = fragmentProjection.document.layers[0].keyframes[0];
  assert.equal(fragmentProjection.headSequence, 2);
  assert.equal(fragmentKeyframe.revision, 2);
  assert.deepEqual(
    fragmentKeyframe.objects.map(object => object.id),
    fragments.map(fragment => fragment.id)
  );
  for (let index = 0; index < fragments.length; index += 1) {
    const projected = fragmentKeyframe.objects[index];
    assert.deepEqual(projected.caps, {
      start: index === 0,
      end: index === fragments.length - 1
    });
    assert.deepEqual(projected.transform, [1, 0, 0, 1, 0, 0]);
    assert.deepEqual(projected.points, [
      { x: 0, y: 100 + (index % 20), pressure: 0.5, time: 0 },
      { x: 1, y: 101 + (index % 20), pressure: 0.5, time: 1 }
    ]);
  }
  assert.equal(fragmentDiagnostics.status, 'synced');
  assert.equal(fragmentDiagnostics.commitCount, 2);
  assert.equal(fragmentDiagnostics.failureCount, 0);
  telemetry.fragment512 = {
    outcome: 'applied',
    status: fragmentDiagnostics.status,
    objectCount: fragmentDiagnostics.objectCount,
    estimatedBytes: fragmentDiagnostics.estimatedBytes
  };
  assert.ok(fragmentDiagnostics.estimatedBytes > 0);
  fragmentStore.destroy();
  assert.equal(fragmentHarness.adapter.getDiagnostics().sceneCount, 0);
  assert.equal(fragmentHarness.adapter.getDiagnostics().estimatedBytes, 0);
  fragmentHarness.adapter.destroy();
  assert.equal(fragmentHarness.adapter.getDiagnostics().status, 'destroyed');
  assert.equal(fragmentHarness.adapter.getDiagnostics().estimatedBytes, 0);

  const evictionHarness = createScheduledAdapter();
  let evictionSceneSequence = 0;
  const evictionStore = makeStore(evictionHarness.adapter, {
    maxVideos: 1,
    createSceneInstanceId: () => `eviction-scene-${++evictionSceneSequence}`
  });
  assert.equal(evictionStore.addStroke(stroke('eviction-a')).applied, true);
  evictionHarness.flushAll();
  const beforeEviction = evictionHarness.adapter.getDiagnostics();
  assert.equal(beforeEviction.sceneCount, 1);
  assert.ok(beforeEviction.estimatedBytes > 0);
  assert.equal(evictionStore.activateSession(session({
    sessionId: 'eviction-session-b',
    stableVideoIdentity: 'eviction-video-b',
    videoGeneration: 2
  })).accepted, true);
  const afterEviction = evictionHarness.adapter.getDiagnostics();
  assert.equal(afterEviction.sceneCount, 1);
  assert.equal(afterEviction.objectCount, 0);
  assert.equal(afterEviction.estimatedBytes, 0);
  telemetry.evictionCleanup = {
    sceneCount: afterEviction.sceneCount,
    objectCount: afterEviction.objectCount,
    estimatedBytes: afterEviction.estimatedBytes
  };
  evictionStore.destroy();
  assert.equal(evictionHarness.adapter.getDiagnostics().sceneCount, 0);
  assert.equal(evictionHarness.adapter.getDiagnostics().estimatedBytes, 0);
  evictionHarness.adapter.destroy();

  const queueHarness = createScheduledAdapter({
    limits: { maxQueueItems: 2, maxQueueBytes: 10 }
  });
  const queueScenes = {
    retained: { ...SCENE, sceneInstanceId: 'queue-retained' },
    overflowed: { ...SCENE, sceneInstanceId: 'queue-overflowed' },
    admitted: { ...SCENE, sceneInstanceId: 'queue-admitted' }
  };
  for (const queueScene of Object.values(queueScenes)) {
    assert.equal(queueHarness.adapter.activateScene(queueScene, new Map()).activated, true);
  }
  const retainedRecord = stroke('queue-r');
  const overflowedRecord = stroke('queue-o');
  const admittedRecord = stroke('queue-n');
  assert.equal(queueHarness.adapter.enqueueTransition(event(1, {
    scene: queueScenes.retained,
    kind: 'add-objects',
    estimatedBytes: 4,
    insertions: [{ index: 0, record: retainedRecord,
      baseTransform: retainedRecord.transform }]
  })), true);
  assert.equal(queueHarness.adapter.enqueueTransition(event(1, {
    scene: queueScenes.overflowed,
    kind: 'add-objects',
    estimatedBytes: 6,
    insertions: [{ index: 0, record: overflowedRecord,
      baseTransform: overflowedRecord.transform }]
  })), true);
  assert.equal(queueHarness.adapter.enqueueTransition(event(2, {
    scene: queueScenes.overflowed,
    estimatedBytes: 1
  })), false);
  assert.equal(
    queueHarness.adapter.getDiagnostics(queueScenes.overflowed.sceneInstanceId).lastReason,
    'queue-capacity-exceeded'
  );
  assert.equal(queueHarness.adapter.enqueueTransition(event(1, {
    scene: queueScenes.admitted,
    kind: 'add-objects',
    estimatedBytes: 6,
    insertions: [{ index: 0, record: admittedRecord,
      baseTransform: admittedRecord.transform }]
  })), true, 'failed-scene payloads must release exact item and byte capacity');
  queueHarness.flushAll();
  assert.equal(queueHarness.adapter.getSceneProjection(queueScenes.overflowed.sceneInstanceId), null);
  assert.deepEqual(
    queueHarness.adapter.getSceneProjection(queueScenes.retained.sceneInstanceId)
      .document.layers[0].keyframes[0].objects.map(object => object.id),
    [retainedRecord.id]
  );
  assert.deepEqual(
    queueHarness.adapter.getSceneProjection(queueScenes.admitted.sceneInstanceId)
      .document.layers[0].keyframes[0].objects.map(object => object.id),
    [admittedRecord.id]
  );
  assert.equal(queueHarness.adapter.enqueueTransition(event(2, {
    scene: queueScenes.retained,
    kind: 'delete-objects',
    estimatedBytes: 4,
    removals: [{ id: retainedRecord.id, index: 0 }]
  })), true);
  assert.equal(queueHarness.adapter.enqueueTransition(event(2, {
    scene: queueScenes.admitted,
    kind: 'delete-objects',
    estimatedBytes: 6,
    removals: [{ id: admittedRecord.id, index: 0 }]
  })), true, 'applied payloads must release exact item and byte capacity');
  queueHarness.flushAll();
  assert.equal(queueHarness.adapter.getDiagnostics(queueScenes.retained.sceneInstanceId).objectCount, 0);
  assert.equal(queueHarness.adapter.getDiagnostics(queueScenes.admitted.sceneInstanceId).objectCount, 0);
  telemetry.queueCleanup = {
    failureCapacityReused: true,
    appliedCapacityReused: true,
    retainedObjectCount:
      queueHarness.adapter.getDiagnostics(queueScenes.retained.sceneInstanceId).objectCount,
    admittedObjectCount:
      queueHarness.adapter.getDiagnostics(queueScenes.admitted.sceneInstanceId).objectCount
  };
  queueHarness.adapter.dropScenes(Object.values(queueScenes)
    .map(queueScene => queueScene.sceneInstanceId));
  assert.equal(queueHarness.adapter.getDiagnostics().estimatedBytes, 0);
  queueHarness.adapter.destroy();

  const warmHarness = createScheduledAdapter();
  const warmStore = makeStore(warmHarness.adapter);
  assert.equal(warmStore.addStroke(stroke('warm-stroke')).applied, true);
  warmHarness.flushAll();
  const beforeWarm = warmHarness.adapter.getDiagnostics();
  const beforeWarmProjection = warmHarness.adapter.getSceneProjection(SCENE.sceneInstanceId);
  assert.ok(beforeWarmProjection);
  for (let index = 0; index < 100; index += 1) {
    assert.equal(warmStore.deactivateSession().accepted, true);
    assert.equal(warmStore.activateSession(session({
      sessionId: `warm-session-${index}`
    })).accepted, true);
  }
  const afterWarm = warmHarness.adapter.getDiagnostics();
  const afterWarmProjection = warmHarness.adapter.getSceneProjection(SCENE.sceneInstanceId);
  assert.ok(afterWarmProjection);
  const beforeWarmKeyframe = beforeWarmProjection.document.layers[0].keyframes[0];
  const afterWarmKeyframe = afterWarmProjection.document.layers[0].keyframes[0];
  assert.equal(afterWarm.sceneCount, beforeWarm.sceneCount);
  assert.equal(afterWarm.bootstrapCount, beforeWarm.bootstrapCount);
  assert.equal(afterWarm.headSequence, beforeWarm.headSequence);
  assert.equal(afterWarm.objectCount, beforeWarm.objectCount);
  assert.equal(afterWarm.estimatedBytes, beforeWarm.estimatedBytes);
  assert.equal(afterWarm.divergenceCount, 0);
  assert.equal(afterWarmKeyframe.revision, beforeWarmKeyframe.revision);
  telemetry.warmB100 = {
    sceneCountDelta: afterWarm.sceneCount - beforeWarm.sceneCount,
    bootstrapDelta: afterWarm.bootstrapCount - beforeWarm.bootstrapCount,
    headDelta: afterWarm.headSequence - beforeWarm.headSequence,
    keyframeRevisionDelta: afterWarmKeyframe.revision - beforeWarmKeyframe.revision,
    objectDelta: afterWarm.objectCount - beforeWarm.objectCount,
    estimatedBytesDelta: afterWarm.estimatedBytes - beforeWarm.estimatedBytes
  };
  warmStore.destroy();
  warmHarness.adapter.destroy();

  let disabledFactoryCalls = 0;
  const disabledRuntime = createFabricOverlayRuntime({
    drawingV3AdapterFactory() {
      disabledFactoryCalls += 1;
      throw new Error('default OFF must not construct an adapter');
    }
  });
  const disabledDiagnostics = disabledRuntime.getDiagnostics();
  assert.equal(disabledFactoryCalls, 0);
  assert.equal(disabledDiagnostics.drawingV3Shadow.status, 'disabled');
  assert.equal(disabledDiagnostics.drawingV3Shadow.sceneCount, 0);
  assert.equal(disabledDiagnostics.drawingV3Shadow.estimatedBytes, 0);
  disabledRuntime.destroy();
  telemetry.defaultOff = {
    adapterFactoryCalls: disabledFactoryCalls,
    sceneCount: disabledDiagnostics.drawingV3Shadow.sceneCount,
    estimatedBytes: disabledDiagnostics.drawingV3Shadow.estimatedBytes
  };

  console.log(JSON.stringify(telemetry));
});
