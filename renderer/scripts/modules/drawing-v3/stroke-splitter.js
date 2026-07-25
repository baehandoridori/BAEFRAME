'use strict';

const {
  EPSILON,
  boundsForPoints,
  boundsIntersect,
  createGeometryBudget,
  createPolygonEdgeIndex,
  pointToSegmentDistance,
  segmentEdgeIntersectionParameters
} = require('./lasso-geometry.js');

const DEFAULT_THINNING = 0.65;
const PARAMETER_EPSILON = 1e-12;

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
    if (length + EPSILON >= 1) return true;
  }
  return false;
}

function strokeHasSplittableLength(points = []) {
  return Array.isArray(points) && points.length >= 2 && hasVisibleLength(points);
}

function strokeRadius(sample, options = {}) {
  const size = Math.max(1, finiteNumber(options.size, 0));
  if (size <= 1 && !Number.isFinite(Number(options.size))) return 0;
  const thinning = finiteNumber(options.thinning, DEFAULT_THINNING);
  const pressure = Math.min(1, Math.max(0, finiteNumber(sample?.pressure, 0.5)));
  return Math.max(0.01, size * (0.5 - thinning * (0.5 - pressure)));
}

function isPolygonQuery(value) {
  return value?.__baeframePolygonEdgeIndex === true;
}

function resolvePolygonQuery(value, options = {}) {
  if (isPolygonQuery(value)) return value;
  const budget = options.budget || createGeometryBudget();
  return createPolygonEdgeIndex(value, { budget });
}

function segmentBounds(start, end, padding = 0) {
  const safePadding = Math.max(0, finiteNumber(padding));
  return {
    left: Math.min(finiteNumber(start?.x), finiteNumber(end?.x)) - safePadding,
    right: Math.max(finiteNumber(start?.x), finiteNumber(end?.x)) + safePadding,
    top: Math.min(finiteNumber(start?.y), finiteNumber(end?.y)) - safePadding,
    bottom: Math.max(finiteNumber(start?.y), finiteNumber(end?.y)) + safePadding
  };
}

function deduplicateStrokePoints(points = []) {
  const deduplicated = [];
  for (const point of points) {
    if (!deduplicated.length || !samePoint(deduplicated[deduplicated.length - 1], point)) {
      deduplicated.push(point);
    }
  }
  return deduplicated;
}

function quadraticValue(coefficients, amount) {
  return coefficients.a * amount * amount +
    coefficients.b * amount +
    coefficients.c;
}

function quadraticRoots(coefficients) {
  const { a, b, c } = coefficients;
  const coefficientScale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
  const coefficientTolerance = Number.EPSILON * coefficientScale * 64;
  if (Math.abs(a) <= coefficientTolerance) {
    if (Math.abs(b) <= coefficientTolerance) return [];
    return [-c / b];
  }
  const discriminantTerm = 4 * a * c;
  const discriminant = b * b - discriminantTerm;
  const discriminantScale = Math.max(1, b * b, Math.abs(discriminantTerm));
  if (discriminant < -Number.EPSILON * discriminantScale * 128) return [];
  const squareRoot = Math.sqrt(Math.max(0, discriminant));
  if (squareRoot <= Number.EPSILON * Math.max(1, Math.abs(b)) * 64) {
    return [-b / (2 * a)];
  }
  const q = -0.5 * (b + (b < 0 ? -squareRoot : squareRoot));
  if (Math.abs(q) <= Number.EPSILON * coefficientScale * 64) {
    return [-b / (2 * a)];
  }
  return [q / a, c / q].sort((left, right) => left - right);
}

function quadraticHitIntervals(coefficients, from, to, budget) {
  if (!budget.consume()) return { intervals: [], limitExceeded: true };
  const roots = quadraticRoots(coefficients)
    .filter(root => root >= from - PARAMETER_EPSILON && root <= to + PARAMETER_EPSILON)
    .map(root => Math.min(to, Math.max(from, root)));
  const cuts = [from, ...roots, to]
    .sort((left, right) => left - right)
    .filter((value, index, values) => (
      index === 0 || Math.abs(value - values[index - 1]) > PARAMETER_EPSILON
    ));
  const evaluationTolerance = Number.EPSILON *
    Math.max(1, Math.abs(coefficients.a), Math.abs(coefficients.b), Math.abs(coefficients.c)) *
    256;
  const intervals = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const intervalStart = cuts[index];
    const intervalEnd = cuts[index + 1];
    const middle = (intervalStart + intervalEnd) / 2;
    if (quadraticValue(coefficients, middle) <= evaluationTolerance) {
      intervals.push([intervalStart, intervalEnd]);
    }
  }
  for (const cut of cuts) {
    if (quadraticValue(coefficients, cut) > evaluationTolerance) continue;
    if (!intervals.some(interval => (
      cut >= interval[0] - PARAMETER_EPSILON &&
      cut <= interval[1] + PARAMETER_EPSILON
    ))) {
      intervals.push([cut, cut]);
    }
  }
  return { intervals, limitExceeded: false };
}

function pointDistanceSquaredCoefficients(start, end, point) {
  const offsetX = finiteNumber(start?.x) - finiteNumber(point?.x);
  const offsetY = finiteNumber(start?.y) - finiteNumber(point?.y);
  const deltaX = finiteNumber(end?.x) - finiteNumber(start?.x);
  const deltaY = finiteNumber(end?.y) - finiteNumber(start?.y);
  return {
    a: deltaX * deltaX + deltaY * deltaY,
    b: 2 * (offsetX * deltaX + offsetY * deltaY),
    c: offsetX * offsetX + offsetY * offsetY
  };
}

function lineDistanceSquaredCoefficients(start, end, edgeStart, edgeDelta, edgeLengthSquared) {
  const offsetX = finiteNumber(start?.x) - finiteNumber(edgeStart?.x);
  const offsetY = finiteNumber(start?.y) - finiteNumber(edgeStart?.y);
  const deltaX = finiteNumber(end?.x) - finiteNumber(start?.x);
  const deltaY = finiteNumber(end?.y) - finiteNumber(start?.y);
  const crossStart = offsetX * edgeDelta.y - offsetY * edgeDelta.x;
  const crossDelta = deltaX * edgeDelta.y - deltaY * edgeDelta.x;
  return {
    a: crossDelta * crossDelta / edgeLengthSquared,
    b: 2 * crossStart * crossDelta / edgeLengthSquared,
    c: crossStart * crossStart / edgeLengthSquared
  };
}

function subtractRadiusSquared(coefficients, start, end, options) {
  const radiusStart = strokeRadius(start, options) + EPSILON;
  const radiusEnd = strokeRadius(end, options) + EPSILON;
  const radiusDelta = radiusEnd - radiusStart;
  return {
    a: coefficients.a - radiusDelta * radiusDelta,
    b: coefficients.b - 2 * radiusStart * radiusDelta,
    c: coefficients.c - radiusStart * radiusStart
  };
}

function edgeProximityIntervals(start, end, edgeStart, edgeEnd, options, budget) {
  const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
  if (!boundsIntersect(
    segmentBounds(start, end, maximumRadius),
    segmentBounds(edgeStart, edgeEnd)
  )) {
    return { intervals: [], limitExceeded: false };
  }
  const edgeDelta = {
    x: finiteNumber(edgeEnd?.x) - finiteNumber(edgeStart?.x),
    y: finiteNumber(edgeEnd?.y) - finiteNumber(edgeStart?.y)
  };
  const edgeLengthSquared = edgeDelta.x * edgeDelta.x + edgeDelta.y * edgeDelta.y;
  const domains = [0, 1];
  let projectionStart = 0;
  let projectionDelta = 0;
  if (edgeLengthSquared > EPSILON) {
    const strokeDelta = {
      x: finiteNumber(end?.x) - finiteNumber(start?.x),
      y: finiteNumber(end?.y) - finiteNumber(start?.y)
    };
    projectionStart = (
      (finiteNumber(start?.x) - finiteNumber(edgeStart?.x)) * edgeDelta.x +
      (finiteNumber(start?.y) - finiteNumber(edgeStart?.y)) * edgeDelta.y
    ) / edgeLengthSquared;
    projectionDelta = (
      strokeDelta.x * edgeDelta.x +
      strokeDelta.y * edgeDelta.y
    ) / edgeLengthSquared;
    if (Math.abs(projectionDelta) > PARAMETER_EPSILON) {
      for (const projectionBoundary of [0, 1]) {
        const amount = (projectionBoundary - projectionStart) / projectionDelta;
        if (amount > PARAMETER_EPSILON && amount < 1 - PARAMETER_EPSILON) {
          domains.push(amount);
        }
      }
    }
  }
  domains.sort((left, right) => left - right);

  const intervals = [];
  for (let index = 0; index < domains.length - 1; index += 1) {
    const from = domains[index];
    const to = domains[index + 1];
    const middle = (from + to) / 2;
    const projection = projectionStart + projectionDelta * middle;
    let distanceSquared;
    if (edgeLengthSquared <= EPSILON || projection <= 0) {
      distanceSquared = pointDistanceSquaredCoefficients(start, end, edgeStart);
    } else if (projection >= 1) {
      distanceSquared = pointDistanceSquaredCoefficients(start, end, edgeEnd);
    } else {
      distanceSquared = lineDistanceSquaredCoefficients(
        start,
        end,
        edgeStart,
        edgeDelta,
        edgeLengthSquared
      );
    }
    const hit = quadraticHitIntervals(
      subtractRadiusSquared(distanceSquared, start, end, options),
      from,
      to,
      budget
    );
    if (hit.limitExceeded) return hit;
    intervals.push(...hit.intervals);
  }
  return { intervals, limitExceeded: false };
}

function centerlineIntervals(start, end, query, budget) {
  const candidates = query.queryEdges(segmentBounds(start, end));
  if (candidates === null) return { intervals: [], limitExceeded: true };
  const parameters = [];
  for (const edge of candidates) {
    if (!budget.consume()) return { intervals: [], limitExceeded: true };
    parameters.push(...segmentEdgeIntersectionParameters(start, end, edge.start, edge.end));
  }
  const cuts = [0, ...parameters, 1]
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > EPSILON);
  const intervals = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const from = cuts[index];
    const to = cuts[index + 1];
    const contained = query.contains(interpolateSample(start, end, (from + to) / 2));
    if (contained === null) return { intervals: [], limitExceeded: true };
    if (contained) {
      intervals.push([from, to]);
    }
  }
  return { intervals, limitExceeded: false };
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

function segmentSelectionIntervals(start, end, query, options, budget) {
  const centerline = centerlineIntervals(start, end, query, budget);
  if (centerline.limitExceeded) return centerline;
  const intervals = centerline.intervals;
  const radiusEnabled = Number.isFinite(Number(options?.size)) && Number(options.size) > 0;
  if (radiusEnabled) {
    const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
    const candidates = query.queryEdges(segmentBounds(start, end, maximumRadius));
    if (candidates === null) return { intervals: [], limitExceeded: true };
    for (const edge of candidates) {
      const proximity = edgeProximityIntervals(
        start,
        end,
        edge.start,
        edge.end,
        options,
        budget
      );
      if (proximity.limitExceeded) return { intervals: [], limitExceeded: true };
      intervals.push(...proximity.intervals);
    }
  }
  return { intervals: mergeIntervals(intervals), limitExceeded: false };
}

function intervalContains(intervals, amount) {
  return intervals.some(interval => amount >= interval[0] - EPSILON && amount <= interval[1] + EPSILON);
}

function pointTouchesPolygon(point, query, options, budget) {
  const contained = query.contains(point);
  if (contained === null) return { hit: false, limitExceeded: true };
  if (contained) return { hit: true, limitExceeded: false };
  const radius = strokeRadius(point, options);
  const candidates = query.queryEdges(segmentBounds(point, point, radius));
  if (candidates === null) return { hit: false, limitExceeded: true };
  for (const edge of candidates) {
    if (!budget.consume()) return { hit: false, limitExceeded: true };
    if (pointToSegmentDistance(point, edge.start, edge.end) <= radius + EPSILON) {
      return { hit: true, limitExceeded: false };
    }
  }
  return { hit: false, limitExceeded: false };
}

function segmentTouchesPolygon(start, end, query, options, budget) {
  const startTouch = pointTouchesPolygon(start, query, options, budget);
  if (startTouch.hit || startTouch.limitExceeded) return startTouch;
  const endContained = query.contains(end);
  if (endContained === null) return { hit: false, limitExceeded: true };
  if (endContained) return { hit: true, limitExceeded: false };

  const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
  const candidates = query.queryEdges(segmentBounds(start, end, maximumRadius));
  if (candidates === null) return { hit: false, limitExceeded: true };
  for (const edge of candidates) {
    if (!budget.consume()) return { hit: false, limitExceeded: true };
    if (segmentEdgeIntersectionParameters(start, end, edge.start, edge.end).length > 0) {
      return { hit: true, limitExceeded: false };
    }
    const proximity = edgeProximityIntervals(start, end, edge.start, edge.end, options, budget);
    if (proximity.limitExceeded) return { hit: false, limitExceeded: true };
    if (proximity.intervals.length > 0) return { hit: true, limitExceeded: false };
  }
  return { hit: false, limitExceeded: false };
}

function strokeTouchesPolygon(points = [], polygon = [], options = {}) {
  if (!Array.isArray(points) || points.length === 0) {
    return { hit: false, limitExceeded: false };
  }
  const budget = options.budget || (isPolygonQuery(polygon)
    ? polygon.budget
    : createGeometryBudget(options.maxOperations));
  const query = resolvePolygonQuery(polygon, { budget });
  if (!query.bounds || query.edges.length < 3 || budget.limitExceeded) {
    return { hit: false, limitExceeded: budget.limitExceeded };
  }
  const deduplicated = deduplicateStrokePoints(points);
  const maximumRadius = deduplicated.reduce(
    (maximum, point) => Math.max(maximum, strokeRadius(point, options)),
    0
  );
  if (!boundsIntersect(boundsForPoints(deduplicated, maximumRadius), query.bounds)) {
    return { hit: false, limitExceeded: false };
  }
  if (deduplicated.length === 1) {
    return pointTouchesPolygon(deduplicated[0], query, options, budget);
  }
  for (let index = 0; index < deduplicated.length - 1; index += 1) {
    if (!budget.consume()) return { hit: false, limitExceeded: true };
    const result = segmentTouchesPolygon(
      deduplicated[index],
      deduplicated[index + 1],
      query,
      options,
      budget
    );
    if (result.hit || result.limitExceeded) return result;
  }
  return { hit: false, limitExceeded: false };
}

function shortStrokeTouchesPolygon(points = [], polygon = [], options = {}) {
  const deduplicated = deduplicateStrokePoints(points);
  if (strokeHasSplittableLength(deduplicated)) return false;
  return strokeTouchesPolygon(deduplicated, polygon, options).hit;
}

function splitStrokePointsByPolygon(points = [], polygon = [], options = {}) {
  const polygonArray = isPolygonQuery(polygon) ? polygon.polygon : polygon;
  if (!Array.isArray(points) || points.length < 2 ||
      !Array.isArray(polygonArray) || polygonArray.length < 3) {
    const outside = Array.isArray(points) && points.length ? [[...points]] : [];
    return { inside: [], outside, runs: outside.map(run => ({ kind: 'outside', points: run })) };
  }

  const result = { inside: [], outside: [], runs: [], limitExceeded: false };
  const budget = options.budget || (isPolygonQuery(polygon)
    ? polygon.budget
    : createGeometryBudget(options.maxOperations));
  const query = resolvePolygonQuery(polygon, { budget });
  if (budget.limitExceeded) {
    return { ...result, limitExceeded: true, limitReason: 'operations' };
  }
  const maxRuns = Number.isInteger(Number(options.maxRuns)) && Number(options.maxRuns) > 0
    ? Number(options.maxRuns)
    : Number.POSITIVE_INFINITY;
  let limitReason = null;
  let currentKind = null;
  let currentRun = null;

  const startRun = (kind, point) => {
    if (result.runs.length >= maxRuns) {
      result.limitExceeded = true;
      limitReason = 'runs';
      return false;
    }
    currentKind = kind;
    currentRun = [point];
    result[kind].push(currentRun);
    result.runs.push({ kind, points: currentRun });
    return true;
  };

  outer: for (let index = 0; index < points.length - 1; index += 1) {
    if (!budget.consume()) {
      result.limitExceeded = true;
      limitReason = 'operations';
      break;
    }
    const start = points[index];
    const end = points[index + 1];
    const selection = segmentSelectionIntervals(start, end, query, options, budget);
    if (selection.limitExceeded) {
      result.limitExceeded = true;
      limitReason = 'operations';
      break;
    }
    const selectionIntervals = selection.intervals;
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
  if (result.limitExceeded) result.limitReason = limitReason || 'operations';
  return result;
}

module.exports = {
  interpolateSample,
  shortStrokeTouchesPolygon,
  strokeHasSplittableLength,
  strokeRadius,
  strokeTouchesPolygon,
  splitStrokePointsByPolygon
};
