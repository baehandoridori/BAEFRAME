'use strict';

const {
  EPSILON,
  pointInPolygon,
  pointToSegmentDistance,
  segmentPolygonIntersectionParameters
} = require('./lasso-geometry.js');

const DEFAULT_THINNING = 0.65;
const MINIMIZE_ITERATIONS = 14;
const ROOT_ITERATIONS = 20;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function interpolateSample(start, end, amount) {
  const t = Math.min(1, Math.max(0, finiteNumber(amount)));
  const sample = {
    ...start,
    x: finiteNumber(start?.x) + (finiteNumber(end?.x) - finiteNumber(start?.x)) * t,
    y: finiteNumber(start?.y) + (finiteNumber(end?.y) - finiteNumber(start?.y)) * t,
    pressure: finiteNumber(start?.pressure, 0.5) +
      (finiteNumber(end?.pressure, 0.5) - finiteNumber(start?.pressure, 0.5)) * t,
    time: finiteNumber(start?.time) + (finiteNumber(end?.time) - finiteNumber(start?.time)) * t
  };
  if (t >= 1) return { ...end, ...sample };
  return sample;
}

function samePoint(left, right) {
  return Math.abs(finiteNumber(left?.x) - finiteNumber(right?.x)) <= EPSILON &&
    Math.abs(finiteNumber(left?.y) - finiteNumber(right?.y)) <= EPSILON;
}

function appendPoint(run, point) {
  if (!run.length || !samePoint(run[run.length - 1], point)) run.push(point);
}

function hasVisibleLength(run) {
  let length = 0;
  for (let index = 1; index < run.length; index += 1) {
    const dx = finiteNumber(run[index]?.x) - finiteNumber(run[index - 1]?.x);
    const dy = finiteNumber(run[index]?.y) - finiteNumber(run[index - 1]?.y);
    length += Math.hypot(dx, dy);
  }
  return length + EPSILON >= 1;
}

function strokeRadius(sample, options = {}) {
  const size = Math.max(1, finiteNumber(options.size, 0));
  if (size <= 1 && !Number.isFinite(Number(options.size))) return 0;
  const thinning = finiteNumber(options.thinning, DEFAULT_THINNING);
  const pressure = Math.min(1, Math.max(0, finiteNumber(sample?.pressure, 0.5)));
  return Math.max(0.01, size * (0.5 - thinning * (0.5 - pressure)));
}

function boundsOverlapWithPadding(start, end, edgeStart, edgeEnd, padding) {
  const left = Math.min(finiteNumber(start?.x), finiteNumber(end?.x)) - padding;
  const right = Math.max(finiteNumber(start?.x), finiteNumber(end?.x)) + padding;
  const top = Math.min(finiteNumber(start?.y), finiteNumber(end?.y)) - padding;
  const bottom = Math.max(finiteNumber(start?.y), finiteNumber(end?.y)) + padding;
  return right >= Math.min(finiteNumber(edgeStart?.x), finiteNumber(edgeEnd?.x)) - EPSILON &&
    left <= Math.max(finiteNumber(edgeStart?.x), finiteNumber(edgeEnd?.x)) + EPSILON &&
    bottom >= Math.min(finiteNumber(edgeStart?.y), finiteNumber(edgeEnd?.y)) - EPSILON &&
    top <= Math.max(finiteNumber(edgeStart?.y), finiteNumber(edgeEnd?.y)) + EPSILON;
}

function proximityMetric(start, end, edgeStart, edgeEnd, options, amount) {
  const sample = interpolateSample(start, end, amount);
  return pointToSegmentDistance(sample, edgeStart, edgeEnd) - strokeRadius(sample, options);
}

function findRoot(metric, low, high, lowIsHit) {
  let left = low;
  let right = high;
  for (let iteration = 0; iteration < ROOT_ITERATIONS; iteration += 1) {
    const middle = (left + right) / 2;
    const middleIsHit = metric(middle) <= EPSILON;
    if (middleIsHit === lowIsHit) left = middle;
    else right = middle;
  }
  return (left + right) / 2;
}

function edgeProximityInterval(start, end, edgeStart, edgeEnd, options) {
  const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
  if (!boundsOverlapWithPadding(start, end, edgeStart, edgeEnd, maximumRadius)) return null;
  const metric = amount => proximityMetric(start, end, edgeStart, edgeEnd, options, amount);
  let left = 0;
  let right = 1;
  for (let iteration = 0; iteration < MINIMIZE_ITERATIONS; iteration += 1) {
    const first = left + (right - left) / 3;
    const second = right - (right - left) / 3;
    if (metric(first) <= metric(second)) right = second;
    else left = first;
  }
  const minimum = (left + right) / 2;
  if (metric(minimum) > EPSILON) return null;
  const startAmount = metric(0) <= EPSILON ? 0 : findRoot(metric, 0, minimum, false);
  const endAmount = metric(1) <= EPSILON ? 1 : findRoot(metric, minimum, 1, true);
  return [startAmount, endAmount];
}

function centerlineIntervals(start, end, polygon) {
  const cuts = [0, ...segmentPolygonIntersectionParameters(start, end, polygon), 1]
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
  const intervals = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1];
    if (pointInPolygon(interpolateSample(start, end, (from + to) / 2), polygon)) {
      intervals.push([from, to]);
    }
  }
  return intervals;
}

function mergeIntervals(intervals) {
  const ordered = intervals
    .filter(interval => interval && interval[1] - interval[0] > EPSILON)
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1] + EPSILON) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function segmentSelectionIntervals(start, end, polygon, options) {
  const intervals = centerlineIntervals(start, end, polygon);
  const radiusEnabled = Number.isFinite(Number(options?.size)) && Number(options.size) > 0;
  if (radiusEnabled) {
    for (let index = 0; index < polygon.length; index += 1) {
      const interval = edgeProximityInterval(
        start,
        end,
        polygon[index],
        polygon[(index + 1) % polygon.length],
        options
      );
      if (interval) intervals.push(interval);
    }
  }
  return mergeIntervals(intervals);
}

function intervalContains(intervals, amount) {
  return intervals.some(interval => amount >= interval[0] - EPSILON && amount <= interval[1] + EPSILON);
}

function splitStrokePointsByPolygon(points = [], polygon = [], options = {}) {
  if (!Array.isArray(points) || points.length < 2 || !Array.isArray(polygon) || polygon.length < 3) {
    const outside = Array.isArray(points) && points.length ? [[...points]] : [];
    return { inside: [], outside, runs: outside.map(run => ({ kind: 'outside', points: run })) };
  }

  const result = { inside: [], outside: [], runs: [], limitExceeded: false };
  const maxRuns = Number.isInteger(Number(options.maxRuns)) && Number(options.maxRuns) > 0
    ? Number(options.maxRuns)
    : Number.POSITIVE_INFINITY;
  let currentKind = null;
  let currentRun = null;

  const startRun = (kind, point) => {
    if (result.runs.length >= maxRuns) {
      result.limitExceeded = true;
      return false;
    }
    currentKind = kind;
    currentRun = [point];
    result[kind].push(currentRun);
    result.runs.push({ kind, points: currentRun });
    return true;
  };

  outer: for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const selectionIntervals = segmentSelectionIntervals(start, end, polygon, options);
    const cuts = [0, ...selectionIntervals.flat(), 1]
      .sort((left, right) => left - right)
      .filter((value, cutIndex, values) => cutIndex === 0 || Math.abs(value - values[cutIndex - 1]) > EPSILON);

    for (let cutIndex = 0; cutIndex < cuts.length - 1; cutIndex += 1) {
      const from = interpolateSample(start, end, cuts[cutIndex]);
      const to = interpolateSample(start, end, cuts[cutIndex + 1]);
      const midpoint = (cuts[cutIndex] + cuts[cutIndex + 1]) / 2;
      const kind = intervalContains(selectionIntervals, midpoint) ? 'inside' : 'outside';
      if ((currentKind !== kind || !currentRun) && !startRun(kind, from)) break outer;
      else appendPoint(currentRun, from);
      appendPoint(currentRun, to);
    }
  }

  result.runs = result.runs.filter(({ points: run }) => run.length >= 2 && hasVisibleLength(run));
  result.inside = result.runs.filter(run => run.kind === 'inside').map(run => run.points);
  result.outside = result.runs.filter(run => run.kind === 'outside').map(run => run.points);
  return result;
}

module.exports = {
  interpolateSample,
  strokeRadius,
  splitStrokePointsByPolygon
};
