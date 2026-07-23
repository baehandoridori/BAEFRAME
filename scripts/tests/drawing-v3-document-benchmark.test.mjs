import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');
const {
  createDrawingDocumentV3
} = require('../../renderer/scripts/modules/drawing-v3/drawing-document.js');

const WARMUP_BATCHES = 5;
const MEASURED_BATCHES = 20;
const LIGHT_APPLIES_PER_BATCH = 200;
const STRUCTURAL_ROUND_TRIPS_PER_BATCH = 5;
const IDENTITY_TRANSFORM = [1, 0, 0, 1, 0, 0];
const CREATED_AT = '2026-07-23T00:00:00.000Z';
const HISTORY_APPLY_OPTIONS = Object.freeze({ source: 'history' });
const TARGET = {
  layerId: 'target-layer',
  keyframeId: 'target-keyframe',
  frame: 0
};

function createStroke(id) {
  return {
    id,
    type: 'stroke',
    tool: 'brush',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    transform: IDENTITY_TRANSFORM.slice(),
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
    }
  };
}

function createKeyframe(id, frame, objects) {
  return {
    id,
    frame,
    empty: false,
    revision: 0,
    objects
  };
}

function createLayer(id, keyframes) {
  return {
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    keyframes
  };
}

function createOptions(targetObjects, unrelatedObjects = []) {
  const initialLayers = [
    createLayer('target-layer', [
      createKeyframe('target-keyframe', 0, targetObjects)
    ])
  ];
  if (unrelatedObjects.length > 0) {
    initialLayers.push(createLayer('unrelated-layer', [
      createKeyframe('unrelated-keyframe', 10, unrelatedObjects)
    ]));
  }
  return {
    documentId: 'drawing-v3-benchmark',
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
    initialLayers,
    revisionSequence: 0
  };
}

function createCommand({ id, baseRevision, kind, operations }) {
  return {
    id,
    actorId: 'benchmark-actor',
    baseRevision,
    target: TARGET,
    kind,
    operations,
    createdAt: CREATED_AT
  };
}

function createAlternatingTransformCommands(prefix, objectId) {
  return Array.from({ length: LIGHT_APPLIES_PER_BATCH }, (_, index) =>
    createCommand({
      id: `${prefix}-${index}`,
      baseRevision: index,
      kind: 'transform-objects',
      operations: [{
        type: 'set-transforms',
        transforms: [{
          objectId,
          transform: index % 2 === 0
            ? [1, 0, 0, 1, 16, 24]
            : IDENTITY_TRANSFORM.slice()
        }]
      }]
    }));
}

function createHundredTransformCommands(prefix, objectId) {
  return Array.from({ length: LIGHT_APPLIES_PER_BATCH }, (_, commandIndex) =>
    createCommand({
      id: `${prefix}-${commandIndex}`,
      baseRevision: commandIndex,
      kind: 'transform-objects',
      operations: Array.from({ length: 100 }, (_, operationIndex) => {
        const offset = commandIndex * 100 + operationIndex + 1;
        return {
          type: 'set-transforms',
          transforms: [{
            objectId,
            transform: [1, 0, 0, 1, offset, offset * 2]
          }]
        };
      })
    }));
}

function createLateFailureCommands(prefix, objectId) {
  const operations = Array.from({ length: 100 }, (_, operationIndex) => ({
    type: 'set-transforms',
    transforms: [{
      objectId: operationIndex === 99 ? 'missing-object' : objectId,
      transform: [1, 0, 0, 1, operationIndex + 1, operationIndex + 2]
    }]
  }));
  return Array.from({ length: LIGHT_APPLIES_PER_BATCH }, (_, index) =>
    createCommand({
      id: `${prefix}-${index}`,
      baseRevision: 0,
      kind: 'transform-objects',
      operations
    }));
}

function createStructuralTemplates(prefix, targetObjects, removalCount) {
  const removed = Array.from({ length: removalCount }, (_, index) => ({
    index: index * 2,
    object: targetObjects[index * 2]
  }));
  const objectIds = removed.map(entry => entry.object.id);
  const inverseOperations = removed.map(entry => ({
    type: 'insert-objects',
    index: entry.index,
    objects: [entry.object]
  }));
  const forwardCommands = [];
  const inverseCommands = [];
  for (let index = 0;
    index < STRUCTURAL_ROUND_TRIPS_PER_BATCH;
    index += 1) {
    forwardCommands.push(createCommand({
      id: `${prefix}-forward-${index}`,
      baseRevision: index * 2,
      kind: 'delete-objects',
      operations: [{ type: 'remove-objects', objectIds }]
    }));
    inverseCommands.push(createCommand({
      id: `${prefix}-inverse-${index}`,
      baseRevision: index * 2 + 1,
      kind: 'add-objects',
      operations: inverseOperations
    }));
  }
  return {
    forwardCommands,
    inverseCommands,
    inverseOperations,
    removalCount
  };
}

function getKeyframe(snapshot, layerId, keyframeId) {
  const layer = snapshot.layers.find(candidate => candidate.id === layerId);
  assert.ok(layer, `missing layer: ${layerId}`);
  const keyframe = layer.keyframes.find(candidate =>
    candidate.id === keyframeId);
  assert.ok(keyframe, `missing keyframe: ${keyframeId}`);
  return keyframe;
}

function verifyAlternatingScenario(options, commands) {
  const document = createDrawingDocumentV3(options);
  const before = document.getContentSnapshot();
  for (let index = 0; index < commands.length; index += 1) {
    const result = document.applyCommand(commands[index]);
    assert.equal(result.applied, true);
    assert.equal(result.sequence, index + 1);
    assert.equal(result.inverseOperations.length, 1);
  }
  const after = document.getContentSnapshot();
  const beforeTarget = getKeyframe(before, 'target-layer', 'target-keyframe');
  const afterTarget = getKeyframe(after, 'target-layer', 'target-keyframe');
  assert.deepEqual(afterTarget.objects, beforeTarget.objects);
  assert.equal(afterTarget.revision, commands.length);
  if (options.initialLayers.length > 1) {
    const beforeUnrelated = getKeyframe(
      before,
      'unrelated-layer',
      'unrelated-keyframe'
    );
    const afterUnrelated = getKeyframe(
      after,
      'unrelated-layer',
      'unrelated-keyframe'
    );
    assert.deepEqual(afterUnrelated, beforeUnrelated);
  }
  assert.deepEqual(document.getHead(), {
    sequence: commands.length,
    lastCommandId: commands.at(-1).id
  });
}

function verifyHundredTransformScenario(options, commands, objectId) {
  const document = createDrawingDocumentV3(options);
  const before = document.getContentSnapshot();
  for (let index = 0; index < commands.length; index += 1) {
    const result = document.applyCommand(commands[index]);
    assert.equal(result.applied, true);
    assert.equal(result.sequence, index + 1);
    assert.equal(result.inverseOperations.length, 100);
  }
  const after = document.getContentSnapshot();
  const beforeTarget = getKeyframe(before, 'target-layer', 'target-keyframe');
  const afterTarget = getKeyframe(after, 'target-layer', 'target-keyframe');
  const expectedOffset = LIGHT_APPLIES_PER_BATCH * 100;
  assert.deepEqual(
    afterTarget.objects.find(object => object.id === objectId).transform,
    [1, 0, 0, 1, expectedOffset, expectedOffset * 2]
  );
  assert.deepEqual(
    afterTarget.objects.filter(object => object.id !== objectId),
    beforeTarget.objects.filter(object => object.id !== objectId)
  );
  assert.equal(afterTarget.revision, commands.length);
  assert.deepEqual(document.getHead(), {
    sequence: commands.length,
    lastCommandId: commands.at(-1).id
  });
}

function verifyLateFailureScenario(options, commands) {
  const document = createDrawingDocumentV3(options);
  const before = document.getContentSnapshot();
  for (const command of commands) {
    assert.deepEqual(document.applyCommand(command), {
      applied: false,
      reason: 'object-not-found'
    });
  }
  assert.deepEqual(document.getContentSnapshot(), before);
  assert.deepEqual(document.getHead(), {
    sequence: 0,
    lastCommandId: null
  });
}

function verifyStructuralScenario(options, templates) {
  const document = createDrawingDocumentV3(options);
  const before = document.getContentSnapshot();
  const forward = document.applyCommand(templates.forwardCommands[0]);
  assert.equal(forward.applied, true);
  assert.equal(forward.inverseOperations.length, templates.removalCount);
  assert.deepEqual(forward.inverseOperations, templates.inverseOperations);

  const generatedInverse = {
    ...templates.inverseCommands[0],
    operations: forward.inverseOperations
  };
  const inverse = document.applyCommand(generatedInverse, {
    source: 'history'
  });
  assert.equal(inverse.applied, true);
  const beforeTarget = getKeyframe(before, 'target-layer', 'target-keyframe');
  const afterTarget = getKeyframe(
    document.getContentSnapshot(),
    'target-layer',
    'target-keyframe'
  );
  assert.deepEqual(afterTarget.objects, beforeTarget.objects);
  assert.equal(afterTarget.revision, 2);
  assert.deepEqual(document.getHead(), {
    sequence: 2,
    lastCommandId: templates.inverseCommands[0].id
  });
}

function runSuccessfulApplyBatch(options, commands) {
  const document = createDrawingDocumentV3(options);
  let lastResult = null;
  const latenciesMs = new Array(commands.length);
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const startedAt = performance.now();
    lastResult = document.applyCommand(command);
    latenciesMs[index] = performance.now() - startedAt;
  }

  assert.equal(lastResult?.applied, true);
  assert.deepEqual(document.getHead(), {
    sequence: commands.length,
    lastCommandId: commands.at(-1).id
  });
  return {
    batchMeanMs: latenciesMs.reduce((sum, latency) => sum + latency, 0) /
      commands.length,
    latenciesMs
  };
}

function runLateFailureBatch(options, commands) {
  const document = createDrawingDocumentV3(options);
  let lastResult = null;
  const latenciesMs = new Array(commands.length);
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    const startedAt = performance.now();
    lastResult = document.applyCommand(command);
    latenciesMs[index] = performance.now() - startedAt;
  }

  assert.deepEqual(lastResult, {
    applied: false,
    reason: 'object-not-found'
  });
  assert.deepEqual(document.getHead(), {
    sequence: 0,
    lastCommandId: null
  });
  return {
    batchMeanMs: latenciesMs.reduce((sum, latency) => sum + latency, 0) /
      commands.length,
    latenciesMs
  };
}

function runStructuralBatch(options, templates) {
  const document = createDrawingDocumentV3(options);
  let lastForward = null;
  let lastInverse = null;
  let forwardElapsedMs = 0;
  let inverseElapsedMs = 0;

  for (let index = 0;
    index < STRUCTURAL_ROUND_TRIPS_PER_BATCH;
    index += 1) {
    const forwardCommand = templates.forwardCommands[index];
    const inverseCommand = templates.inverseCommands[index];
    let startedAt = performance.now();
    lastForward = document.applyCommand(forwardCommand);
    forwardElapsedMs += performance.now() - startedAt;

    startedAt = performance.now();
    lastInverse = document.applyCommand(
      inverseCommand,
      HISTORY_APPLY_OPTIONS
    );
    inverseElapsedMs += performance.now() - startedAt;
  }

  assert.equal(lastForward?.applied, true);
  assert.equal(lastInverse?.applied, true);
  assert.deepEqual(document.getHead(), {
    sequence: STRUCTURAL_ROUND_TRIPS_PER_BATCH * 2,
    lastCommandId: templates.inverseCommands.at(-1).id
  });
  return {
    forwardMs: forwardElapsedMs / STRUCTURAL_ROUND_TRIPS_PER_BATCH,
    inverseMs: inverseElapsedMs / STRUCTURAL_ROUND_TRIPS_PER_BATCH,
    roundTripMs: (forwardElapsedMs + inverseElapsedMs) /
      STRUCTURAL_ROUND_TRIPS_PER_BATCH
  };
}

function collectInterleavedSamples(scenarios) {
  const samples = Object.fromEntries(scenarios.map(scenario => [
    scenario.name,
    []
  ]));
  const totalBatches = WARMUP_BATCHES + MEASURED_BATCHES;
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const offset = batchIndex % scenarios.length;
    const ordered = scenarios.slice(offset).concat(scenarios.slice(0, offset));
    for (const scenario of ordered) {
      const sample = scenario.run();
      if (batchIndex >= WARMUP_BATCHES) {
        samples[scenario.name].push(sample);
      }
    }
  }
  return samples;
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(samples, field, unit) {
  assert.equal(samples.length, MEASURED_BATCHES);
  const sorted = samples.map(sample => sample[field]).sort((left, right) =>
    left - right);
  const p95Index = Math.ceil(0.95 * sorted.length) - 1;
  return {
    unit,
    measuredBatches: samples.length,
    medianMs: median(sorted),
    p95Ms: sorted[p95Index]
  };
}

function summarizeLatencies(samples, unit) {
  assert.equal(samples.length, MEASURED_BATCHES);
  const sorted = samples.flatMap(sample => sample.latenciesMs)
    .sort((left, right) => left - right);
  assert.equal(
    sorted.length,
    MEASURED_BATCHES * LIGHT_APPLIES_PER_BATCH
  );
  const p95Index = Math.ceil(0.95 * sorted.length) - 1;
  return {
    unit,
    measuredApplies: sorted.length,
    medianMs: median(sorted),
    p95Ms: sorted[p95Index]
  };
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function formatSummary(summary) {
  return {
    unit: summary.unit,
    measuredBatches: summary.measuredBatches,
    medianMs: rounded(summary.medianMs),
    p95Ms: rounded(summary.p95Ms)
  };
}

function formatLightMetric(latencySummary, batchMeanSummary) {
  return {
    unit: latencySummary.unit,
    measuredApplies: latencySummary.measuredApplies,
    measuredBatches: batchMeanSummary.measuredBatches,
    medianMs: rounded(latencySummary.medianMs),
    p95Ms: rounded(latencySummary.p95Ms),
    batchMeanMedianMs: rounded(batchMeanSummary.medianMs),
    batchMeanP95Ms: rounded(batchMeanSummary.p95Ms)
  };
}

function createFixtures() {
  const target20 = Array.from({ length: 20 }, (_, index) =>
    createStroke(`target-${index}`));
  const unrelated4000 = Array.from({ length: 4_000 }, (_, index) =>
    createStroke(`unrelated-${index}`));
  const target10000 = Array.from({ length: 10_000 }, (_, index) =>
    createStroke(`large-target-${index}`));
  const target5000 = target10000.slice(0, 5_000);
  return {
    options: {
      small: createOptions(target20),
      unrelated: createOptions(target20, unrelated4000),
      target10000: createOptions(target10000),
      target5000: createOptions(target5000)
    },
    commands: {
      small: createAlternatingTransformCommands('small', 'target-0'),
      unrelated: createAlternatingTransformCommands(
        'unrelated',
        'target-0'
      ),
      targetFirst: createAlternatingTransformCommands(
        'target-first',
        'large-target-0'
      ),
      targetMiddle: createAlternatingTransformCommands(
        'target-middle',
        'large-target-5000'
      ),
      targetLast: createAlternatingTransformCommands(
        'target-last',
        'large-target-9999'
      ),
      hundredTransforms: createHundredTransformCommands(
        'hundred-transforms',
        'target-0'
      ),
      lateFailure: createLateFailureCommands('late-failure', 'target-0')
    },
    structural: {
      remove2500: createStructuralTemplates(
        'remove-2500',
        target5000,
        2_500
      ),
      remove5000: createStructuralTemplates(
        'remove-5000',
        target10000,
        5_000
      )
    }
  };
}

const fixtures = createFixtures();

test('DrawingDocumentV3 benchmark scenarios preserve content and head', {
  timeout: 300_000
}, () => {
  verifyAlternatingScenario(
    fixtures.options.small,
    fixtures.commands.small
  );
  verifyAlternatingScenario(
    fixtures.options.unrelated,
    fixtures.commands.unrelated
  );
  verifyAlternatingScenario(
    fixtures.options.target10000,
    fixtures.commands.targetFirst
  );
  verifyAlternatingScenario(
    fixtures.options.target10000,
    fixtures.commands.targetMiddle
  );
  verifyAlternatingScenario(
    fixtures.options.target10000,
    fixtures.commands.targetLast
  );
  verifyHundredTransformScenario(
    fixtures.options.small,
    fixtures.commands.hundredTransforms,
    'target-0'
  );
  verifyLateFailureScenario(
    fixtures.options.small,
    fixtures.commands.lateFailure
  );
  verifyStructuralScenario(
    fixtures.options.target5000,
    fixtures.structural.remove2500
  );
  verifyStructuralScenario(
    fixtures.options.target10000,
    fixtures.structural.remove5000
  );
});

test('DrawingDocumentV3 runtime hardening benchmark emits stable telemetry', {
  timeout: 300_000
}, t => {
  const smallAndUnrelated = collectInterleavedSamples([
    {
      name: 'small',
      run: () => runSuccessfulApplyBatch(
        fixtures.options.small,
        fixtures.commands.small
      )
    },
    {
      name: 'unrelated4000',
      run: () => runSuccessfulApplyBatch(
        fixtures.options.unrelated,
        fixtures.commands.unrelated
      )
    }
  ]);
  const targetPositions = collectInterleavedSamples([
    {
      name: 'target10000First',
      run: () => runSuccessfulApplyBatch(
        fixtures.options.target10000,
        fixtures.commands.targetFirst
      )
    },
    {
      name: 'target10000Middle',
      run: () => runSuccessfulApplyBatch(
        fixtures.options.target10000,
        fixtures.commands.targetMiddle
      )
    },
    {
      name: 'target10000Last',
      run: () => runSuccessfulApplyBatch(
        fixtures.options.target10000,
        fixtures.commands.targetLast
      )
    }
  ]);
  const commandShapeSamples = collectInterleavedSamples([
    {
      name: 'hundredTransforms',
      run: () => runSuccessfulApplyBatch(
        fixtures.options.small,
        fixtures.commands.hundredTransforms
      )
    },
    {
      name: 'lateFailure',
      run: () => runLateFailureBatch(
        fixtures.options.small,
        fixtures.commands.lateFailure
      )
    }
  ]);
  const structuralSamples = collectInterleavedSamples([
    {
      name: 'noncontiguous2500',
      run: () => runStructuralBatch(
        fixtures.options.target5000,
        fixtures.structural.remove2500
      )
    },
    {
      name: 'noncontiguous5000',
      run: () => runStructuralBatch(
        fixtures.options.target10000,
        fixtures.structural.remove5000
      )
    }
  ]);

  const latencySummaries = {
    small: summarizeLatencies(smallAndUnrelated.small, 'apply'),
    unrelated4000: summarizeLatencies(
      smallAndUnrelated.unrelated4000,
      'apply'
    ),
    target10000First: summarizeLatencies(
      targetPositions.target10000First,
      'apply'
    ),
    target10000Middle: summarizeLatencies(
      targetPositions.target10000Middle,
      'apply'
    ),
    target10000Last: summarizeLatencies(
      targetPositions.target10000Last,
      'apply'
    ),
    hundredTransforms: summarizeLatencies(
      commandShapeSamples.hundredTransforms,
      'apply'
    ),
    lateFailure: summarizeLatencies(
      commandShapeSamples.lateFailure,
      'apply'
    )
  };
  const batchMeanSummaries = {
    small: summarize(smallAndUnrelated.small, 'batchMeanMs', 'apply'),
    unrelated4000: summarize(
      smallAndUnrelated.unrelated4000,
      'batchMeanMs',
      'apply'
    ),
    target10000First: summarize(
      targetPositions.target10000First,
      'batchMeanMs',
      'apply'
    ),
    target10000Middle: summarize(
      targetPositions.target10000Middle,
      'batchMeanMs',
      'apply'
    ),
    target10000Last: summarize(
      targetPositions.target10000Last,
      'batchMeanMs',
      'apply'
    ),
    hundredTransforms: summarize(
      commandShapeSamples.hundredTransforms,
      'batchMeanMs',
      'apply'
    ),
    lateFailure: summarize(
      commandShapeSamples.lateFailure,
      'batchMeanMs',
      'apply'
    )
  };
  const structuralSummaries = {
    noncontiguous2500: {
      forward: summarize(
        structuralSamples.noncontiguous2500,
        'forwardMs',
        'apply'
      ),
      inverse: summarize(
        structuralSamples.noncontiguous2500,
        'inverseMs',
        'apply'
      ),
      roundTrip: summarize(
        structuralSamples.noncontiguous2500,
        'roundTripMs',
        'round-trip'
      )
    },
    noncontiguous5000: {
      forward: summarize(
        structuralSamples.noncontiguous5000,
        'forwardMs',
        'apply'
      ),
      inverse: summarize(
        structuralSamples.noncontiguous5000,
        'inverseMs',
        'apply'
      ),
      roundTrip: summarize(
        structuralSamples.noncontiguous5000,
        'roundTripMs',
        'round-trip'
      )
    }
  };

  const unrelatedRatio = batchMeanSummaries.unrelated4000.medianMs /
    batchMeanSummaries.small.medianMs;
  const target10000WorstP95 = Math.max(
    latencySummaries.target10000First.p95Ms,
    latencySummaries.target10000Middle.p95Ms,
    latencySummaries.target10000Last.p95Ms
  );
  const structuralRatio =
    structuralSummaries.noncontiguous5000.roundTrip.medianMs /
    structuralSummaries.noncontiguous2500.roundTrip.medianMs;
  const acceptance = {
    unrelated4000MedianWithin2x: {
      observed: rounded(unrelatedRatio),
      limit: 2,
      status: unrelatedRatio <= 2 ? 'PASS' : 'WARN'
    },
    target10000WorstP95Within16_7ms: {
      observedMs: rounded(target10000WorstP95),
      limitMs: 16.7,
      status: target10000WorstP95 <= 16.7 ? 'PASS' : 'WARN'
    },
    noncontiguousDoubleSizeMedianWithin3x: {
      observed: rounded(structuralRatio),
      limit: 3,
      status: structuralRatio <= 3 ? 'PASS' : 'WARN'
    }
  };

  const report = {
    benchmark: 'drawing-document-v3-runtime-hardening',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      baeframe: packageJson.version
    },
    configuration: {
      warmupBatches: WARMUP_BATCHES,
      measuredBatches: MEASURED_BATCHES,
      lightAppliesPerBatch: LIGHT_APPLIES_PER_BATCH,
      structuralRoundTripsPerBatch: STRUCTURAL_ROUND_TRIPS_PER_BATCH,
      p95: 'nearest-rank'
    },
    historicalFullCloneReferenceMs: {
      target20Median: 0.228,
      target20PlusUnrelated4000Median: 17.864,
      target10000Median: 108.271
    },
    metrics: {
      small: formatLightMetric(
        latencySummaries.small,
        batchMeanSummaries.small
      ),
      unrelated4000: formatLightMetric(
        latencySummaries.unrelated4000,
        batchMeanSummaries.unrelated4000
      ),
      target10000First: formatLightMetric(
        latencySummaries.target10000First,
        batchMeanSummaries.target10000First
      ),
      target10000Middle: formatLightMetric(
        latencySummaries.target10000Middle,
        batchMeanSummaries.target10000Middle
      ),
      target10000Last: formatLightMetric(
        latencySummaries.target10000Last,
        batchMeanSummaries.target10000Last
      ),
      hundredTransforms: formatLightMetric(
        latencySummaries.hundredTransforms,
        batchMeanSummaries.hundredTransforms
      ),
      lateFailure: formatLightMetric(
        latencySummaries.lateFailure,
        batchMeanSummaries.lateFailure
      ),
      noncontiguous2500: {
        forward: formatSummary(structuralSummaries.noncontiguous2500.forward),
        inverse: formatSummary(structuralSummaries.noncontiguous2500.inverse),
        roundTrip: formatSummary(
          structuralSummaries.noncontiguous2500.roundTrip
        )
      },
      noncontiguous5000: {
        forward: formatSummary(structuralSummaries.noncontiguous5000.forward),
        inverse: formatSummary(structuralSummaries.noncontiguous5000.inverse),
        roundTrip: formatSummary(
          structuralSummaries.noncontiguous5000.roundTrip
        )
      }
    },
    acceptance
  };

  for (const [name, result] of Object.entries(acceptance)) {
    if (result.status === 'WARN') {
      t.diagnostic(`performance acceptance warning: ${name}`);
    }
  }
  console.log(JSON.stringify(report));
});
