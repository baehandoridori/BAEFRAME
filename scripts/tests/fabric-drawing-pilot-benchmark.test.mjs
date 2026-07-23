import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const { Path } = require('fabric');
const appPackage = require('../../package.json');
const {
  createStrokePathData,
  shouldAcceptInputRequest
} = require('../../renderer/scripts/modules/mpv-fabric-overlay-runtime.js');

const makePathData = index => createStrokePathData([
  { x: index % 100, y: index % 80, pressure: 0.2, pointerType: 'pen' },
  { x: (index % 100) + 8, y: (index % 80) + 5, pressure: 0.8, pointerType: 'pen' },
  { x: (index % 100) + 16, y: (index % 80) + 2, pressure: 0.5, pointerType: 'pen' }
], { size: 6 }).pathData;

const timePathCreation = count => {
  const pathData = Array.from({ length: count }, (_, index) => makePathData(index));
  const startedAt = performance.now();
  const paths = pathData.map((data, index) => new Path(data, {
    fill: '#ff3355',
    stroke: null,
    objectCaching: true,
    left: index % 100,
    top: index % 80
  }));
  return { count: paths.length, elapsedMs: performance.now() - startedAt };
};

test('Fabric path and input-toggle benchmark emits one environment JSON record', () => {
  const paths500 = timePathCreation(500);
  const paths2000 = timePathCreation(2000);
  const inputState = { hostGeneration: 1, videoGeneration: 1, inputRevision: -1 };
  const toggleStartedAt = performance.now();
  let acceptedToggles = 0;

  for (let index = 0; index < 100; index += 1) {
    const request = {
      hostGeneration: 1,
      videoGeneration: 1,
      inputRevision: index,
      enabled: index % 2 === 0,
      ...(index % 2 === 0 ? { session: { sessionId: `benchmark-${index}` } } : {})
    };
    if (shouldAcceptInputRequest(inputState, request)) {
      acceptedToggles += 1;
      inputState.inputRevision = request.inputRevision;
    }
  }

  const result = {
    benchmark: 'fabric-drawing-pilot',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      fabric: appPackage.devDependencies.fabric
    },
    paths500,
    paths2000,
    inputToggles100: {
      accepted: acceptedToggles,
      elapsedMs: performance.now() - toggleStartedAt
    }
  };

  assert.equal(paths500.count, 500);
  assert.equal(paths2000.count, 2000);
  assert.equal(acceptedToggles, 100);
  assert.ok(paths500.elapsedMs >= 0);
  assert.ok(paths2000.elapsedMs >= 0);
  console.log(JSON.stringify(result));
});
