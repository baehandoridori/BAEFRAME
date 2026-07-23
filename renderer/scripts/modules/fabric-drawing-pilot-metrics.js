'use strict';

const DEFAULT_MAX_SAMPLES = 512;

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function createBoundedSeries(maxSamples) {
  const samples = [];
  let count = 0;
  let total = 0;
  let max = 0;

  return {
    add(value) {
      const sample = finiteNonNegative(value);
      count += 1;
      total += sample;
      max = Math.max(max, sample);
      samples.push(sample);
      if (samples.length > maxSamples) samples.shift();
    },

    snapshot() {
      const sorted = [...samples].sort((left, right) => left - right);
      const percentile = ratio => {
        if (sorted.length === 0) return 0;
        const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
        return sorted[Math.max(0, index)];
      };

      return {
        count,
        average: count > 0 ? total / count : 0,
        max,
        p50: percentile(0.5),
        p95: percentile(0.95),
        samples: [...samples]
      };
    }
  };
}

function createFabricDrawingPilotMetrics(options = {}) {
  const requestedMaxSamples = Number(options.maxSamples);
  const maxSamples = Number.isInteger(requestedMaxSamples) && requestedMaxSamples > 0
    ? requestedMaxSamples
    : DEFAULT_MAX_SAMPLES;
  const toggleLatency = createBoundedSeries(maxSamples);
  const pointerPreviewLatency = createBoundedSeries(maxSamples);
  const longTaskDurations = createBoundedSeries(maxSamples);
  let pointerSampleCount = 0;
  let pressureMin = null;
  let pressureMax = null;
  let objectCount = 0;
  let peakObjectCount = 0;
  let duplicateActionCount = 0;
  let saveAttemptCount = 0;
  let staleMessageDropCount = 0;
  let surfaceErrorCount = 0;

  return {
    recordToggleLatency(durationMs) {
      toggleLatency.add(durationMs);
    },

    recordPointerPreviewLatency(durationMs) {
      pointerPreviewLatency.add(durationMs);
    },

    recordPointerSample(pressure) {
      pointerSampleCount += 1;
      const value = Number(pressure);
      if (!Number.isFinite(value)) return;
      pressureMin = pressureMin === null ? value : Math.min(pressureMin, value);
      pressureMax = pressureMax === null ? value : Math.max(pressureMax, value);
    },

    recordLongTask(durationMs) {
      longTaskDurations.add(durationMs);
    },

    setObjectCount(count) {
      objectCount = Math.max(0, Number.isFinite(Number(count)) ? Number(count) : 0);
      peakObjectCount = Math.max(peakObjectCount, objectCount);
    },

    recordDuplicateAction() {
      duplicateActionCount += 1;
    },

    recordSaveAttempt() {
      saveAttemptCount += 1;
    },

    recordStaleMessageDrop() {
      staleMessageDropCount += 1;
    },

    recordSurfaceError() {
      surfaceErrorCount += 1;
    },

    snapshot() {
      return {
        maxSamples,
        toggleLatency: toggleLatency.snapshot(),
        pointerPreviewLatency: pointerPreviewLatency.snapshot(),
        pointerSamples: {
          count: pointerSampleCount,
          pressureMin,
          pressureMax,
          pressureRange: pressureMin === null || pressureMax === null ? 0 : pressureMax - pressureMin
        },
        longTasks: longTaskDurations.snapshot(),
        objectCount: {
          current: objectCount,
          peak: peakObjectCount
        },
        duplicateActionCount,
        saveAttemptCount,
        staleMessageDropCount,
        surfaceErrorCount
      };
    }
  };
}

module.exports = {
  createFabricDrawingPilotMetrics
};
