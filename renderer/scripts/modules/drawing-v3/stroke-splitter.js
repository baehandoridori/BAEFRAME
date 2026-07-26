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
  if (t <= 0) return { ...start };
  if (t >= 1) return { ...end };
  const sample = {
    ...start,
    x: finiteNumber(start?.x) + (finiteNumber(end?.x) - finiteNumber(start?.x)) * t,
    y: finiteNumber(start?.y) + (finiteNumber(end?.y) - finiteNumber(start?.y)) * t,
    pressure: finiteNumber(start?.pressure, 0.5) +
      (finiteNumber(end?.pressure, 0.5) - finiteNumber(start?.pressure, 0.5)) * t,
    time: finiteNumber(start?.time) + (finiteNumber(end?.time) - finiteNumber(start?.time)) * t
  };
  return sample;
}

function samePoint(left, right) {
  return Math.abs(finiteNumber(left?.x) - finiteNumber(right?.x)) <= EPSILON &&
    Math.abs(finiteNumber(left?.y) - finiteNumber(right?.y)) <= EPSILON;
}

function sameGeometrySample(left, right) {
  return samePoint(left, right) &&
    Math.abs(
      finiteNumber(left?.pressure, 0.5) - finiteNumber(right?.pressure, 0.5)
    ) <= PARAMETER_EPSILON;
}

function appendPoint(run, point) {
  if (!run.length || !sameGeometrySample(run[run.length - 1], point)) run.push(point);
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
    if (!deduplicated.length ||
        !sameGeometrySample(deduplicated[deduplicated.length - 1], point)) {
      deduplicated.push(point);
    }
  }
  if (deduplicated.length > 1 &&
      deduplicated.every(point => samePoint(point, deduplicated[0]))) {
    return [deduplicated[0]];
  }
  return deduplicated;
}

function restoreSamePositionPressureChains(runs, sourcePoints, samplePositions) {
  const chainsBySegmentStart = new Map();
  const chainsBySegmentEnd = new Map();
  for (let startIndex = 0; startIndex < sourcePoints.length;) {
    let endIndex = startIndex + 1;
    while (endIndex < sourcePoints.length &&
        samePoint(sourcePoints[startIndex], sourcePoints[endIndex])) {
      endIndex += 1;
    }
    if (endIndex - startIndex > 1) {
      const chain = sourcePoints.slice(startIndex, endIndex);
      if (startIndex > 0) chainsBySegmentEnd.set(startIndex - 1, chain);
      if (endIndex < sourcePoints.length) chainsBySegmentStart.set(endIndex - 1, chain);
    }
    startIndex = endIndex;
  }
  const chainForPoint = point => {
    const position = samplePositions.get(point);
    if (!position) return null;
    if (position.amount <= PARAMETER_EPSILON) {
      return chainsBySegmentStart.get(position.segmentIndex) || null;
    }
    if (position.amount >= 1 - PARAMETER_EPSILON) {
      return chainsBySegmentEnd.get(position.segmentIndex) || null;
    }
    return null;
  };
  for (const run of runs) {
    const restored = [];
    for (let index = 0; index < run.points.length;) {
      let endIndex = index + 1;
      while (endIndex < run.points.length &&
          samePoint(run.points[index], run.points[endIndex])) {
        endIndex += 1;
      }
      const chain = run.points
        .slice(index, endIndex)
        .map(chainForPoint)
        .find(Boolean);
      restored.push(...(chain || run.points.slice(index, endIndex)));
      index = endIndex;
    }
    run.points.splice(0, run.points.length, ...restored);
  }
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

function quadraticHitIntervals(coefficients, from, to, budget, hitAtAmount) {
  if (!budget.consume()) return { intervals: [], limitExceeded: true };
  const roots = quadraticRoots(coefficients)
    .filter(root => root >= from - PARAMETER_EPSILON && root <= to + PARAMETER_EPSILON)
    .map(root => Math.min(to, Math.max(from, root)));
  const cuts = [from, ...roots, to]
    .sort((left, right) => left - right)
    .filter((value, index, values) => (
      index === 0 || Math.abs(value - values[index - 1]) > PARAMETER_EPSILON
    ));
  const intervals = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const intervalStart = cuts[index];
    const intervalEnd = cuts[index + 1];
    const middle = (intervalStart + intervalEnd) / 2;
    if (hitAtAmount(middle)) {
      intervals.push([intervalStart, intervalEnd]);
    }
  }
  for (const cut of cuts) {
    if (!hitAtAmount(cut)) continue;
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

function clipEdgeToStrokeCaps(start, end, edgeStart, edgeEnd, caps = {}) {
  if (caps.start !== false && caps.end !== false) {
    return { start: edgeStart, end: edgeEnd };
  }
  const strokeDelta = {
    x: finiteNumber(end?.x) - finiteNumber(start?.x),
    y: finiteNumber(end?.y) - finiteNumber(start?.y)
  };
  const strokeLength = Math.hypot(strokeDelta.x, strokeDelta.y);
  if (strokeLength <= EPSILON) return null;
  const direction = {
    x: strokeDelta.x / strokeLength,
    y: strokeDelta.y / strokeLength
  };
  const edgeDelta = {
    x: finiteNumber(edgeEnd?.x) - finiteNumber(edgeStart?.x),
    y: finiteNumber(edgeEnd?.y) - finiteNumber(edgeStart?.y)
  };
  const edgeStartDistance = (
    (finiteNumber(edgeStart?.x) - finiteNumber(start?.x)) * direction.x +
    (finiteNumber(edgeStart?.y) - finiteNumber(start?.y)) * direction.y
  );
  const edgeDistanceDelta = edgeDelta.x * direction.x + edgeDelta.y * direction.y;
  let from = 0;
  let to = 1;

  const clipLower = boundary => {
    if (Math.abs(edgeDistanceDelta) <= EPSILON) {
      return edgeStartDistance >= boundary - EPSILON;
    }
    const amount = (boundary - edgeStartDistance) / edgeDistanceDelta;
    if (edgeDistanceDelta > 0) from = Math.max(from, amount);
    else to = Math.min(to, amount);
    return from <= to + PARAMETER_EPSILON;
  };
  const clipUpper = boundary => {
    if (Math.abs(edgeDistanceDelta) <= EPSILON) {
      return edgeStartDistance <= boundary + EPSILON;
    }
    const amount = (boundary - edgeStartDistance) / edgeDistanceDelta;
    if (edgeDistanceDelta > 0) to = Math.min(to, amount);
    else from = Math.max(from, amount);
    return from <= to + PARAMETER_EPSILON;
  };

  if (caps.start === false && !clipLower(0)) return null;
  if (caps.end === false && !clipUpper(strokeLength)) return null;
  const clippedFrom = Math.min(1, Math.max(0, from));
  const clippedTo = Math.min(1, Math.max(0, to));
  if (clippedFrom > clippedTo + PARAMETER_EPSILON) return null;
  return {
    start: {
      x: finiteNumber(edgeStart?.x) + edgeDelta.x * clippedFrom,
      y: finiteNumber(edgeStart?.y) + edgeDelta.y * clippedFrom
    },
    end: {
      x: finiteNumber(edgeStart?.x) + edgeDelta.x * clippedTo,
      y: finiteNumber(edgeStart?.y) + edgeDelta.y * clippedTo
    }
  };
}

function proximityHitAtAmount(start, end, edgeStart, edgeEnd, options, amount) {
  const sample = interpolateSample(start, end, amount);
  const distance = pointToSegmentDistance(sample, edgeStart, edgeEnd);
  const radius = strokeRadius(sample, options) + EPSILON;
  const distanceSquared = distance * distance;
  const radiusSquared = radius * radius;
  const distanceTolerance = Number.EPSILON *
    Math.max(1, distanceSquared, radiusSquared) * 64;
  return distanceSquared - radiusSquared <= distanceTolerance;
}

function edgeProximityIntervals(
  start,
  end,
  edgeStart,
  edgeEnd,
  options,
  budget,
  caps = {}
) {
  const clippedEdge = clipEdgeToStrokeCaps(start, end, edgeStart, edgeEnd, caps);
  if (!clippedEdge) return { intervals: [], limitExceeded: false };
  const clippedEdgeStart = clippedEdge.start;
  const clippedEdgeEnd = clippedEdge.end;
  const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
  if (!boundsIntersect(
    segmentBounds(start, end, maximumRadius),
    segmentBounds(clippedEdgeStart, clippedEdgeEnd)
  )) {
    return { intervals: [], limitExceeded: false };
  }
  const edgeDelta = {
    x: finiteNumber(clippedEdgeEnd?.x) - finiteNumber(clippedEdgeStart?.x),
    y: finiteNumber(clippedEdgeEnd?.y) - finiteNumber(clippedEdgeStart?.y)
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
      (finiteNumber(start?.x) - finiteNumber(clippedEdgeStart?.x)) * edgeDelta.x +
      (finiteNumber(start?.y) - finiteNumber(clippedEdgeStart?.y)) * edgeDelta.y
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
      distanceSquared = pointDistanceSquaredCoefficients(start, end, clippedEdgeStart);
    } else if (projection >= 1) {
      distanceSquared = pointDistanceSquaredCoefficients(start, end, clippedEdgeEnd);
    } else {
      distanceSquared = lineDistanceSquaredCoefficients(
        start,
        end,
        clippedEdgeStart,
        edgeDelta,
        edgeLengthSquared
      );
    }
    const hit = quadraticHitIntervals(
      subtractRadiusSquared(distanceSquared, start, end, options),
      from,
      to,
      budget,
      amount => proximityHitAtAmount(
        start,
        end,
        clippedEdgeStart,
        clippedEdgeEnd,
        options,
        amount
      )
    );
    if (hit.limitExceeded) return hit;
    intervals.push(...hit.intervals);
  }
  return { intervals, limitExceeded: false };
}

function endpointCapIntervals(
  start,
  end,
  edgeStart,
  edgeEnd,
  capSample,
  endpoint,
  options,
  budget
) {
  if (!capSample) return { intervals: [], limitExceeded: false };
  const pressure = finiteNumber(capSample.pressure, 0.5);
  const proximity = edgeProximityIntervals(
    { ...start, pressure },
    { ...end, pressure },
    edgeStart,
    edgeEnd,
    options,
    budget,
    { start: true, end: true }
  );
  if (proximity.limitExceeded) return proximity;
  return {
    intervals: proximity.intervals.filter(interval => (
      endpoint === 'start'
        ? interval[0] <= PARAMETER_EPSILON
        : interval[1] >= 1 - PARAMETER_EPSILON
    )),
    limitExceeded: false
  };
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
    .filter((value, index, values) => (
      index === 0 || Math.abs(value - values[index - 1]) > PARAMETER_EPSILON
    ));
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
    .filter(interval => interval && interval[1] - interval[0] > PARAMETER_EPSILON)
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1] + PARAMETER_EPSILON) {
      merged.push([...interval]);
    } else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function segmentSelectionIntervals(start, end, query, options, budget, caps) {
  const centerline = centerlineIntervals(start, end, query, budget);
  if (centerline.limitExceeded) return centerline;
  const intervals = centerline.intervals;
  const radiusEnabled = Number.isFinite(Number(options?.size)) && Number(options.size) > 0;
  if (radiusEnabled) {
    const maximumRadius = Math.max(
      strokeRadius(start, options),
      strokeRadius(end, options),
      caps.roundStart ? strokeRadius(caps.roundStart, options) : 0,
      caps.roundEnd ? strokeRadius(caps.roundEnd, options) : 0
    );
    const candidates = query.queryEdges(segmentBounds(start, end, maximumRadius));
    if (candidates === null) return { intervals: [], limitExceeded: true };
    for (const edge of candidates) {
      const proximity = edgeProximityIntervals(
        start,
        end,
        edge.start,
        edge.end,
        options,
        budget,
        { start: caps.bodyStart, end: caps.bodyEnd }
      );
      if (proximity.limitExceeded) return { intervals: [], limitExceeded: true };
      intervals.push(...proximity.intervals);
      for (const [capSample, endpoint] of [
        [caps.roundStart, 'start'],
        [caps.roundEnd, 'end']
      ]) {
        const cap = endpointCapIntervals(
          start,
          end,
          edge.start,
          edge.end,
          capSample,
          endpoint,
          options,
          budget
        );
        if (cap.limitExceeded) return { intervals: [], limitExceeded: true };
        intervals.push(...cap.intervals);
      }
    }
  }
  return { intervals: mergeIntervals(intervals), limitExceeded: false };
}

function intervalContains(intervals, amount) {
  return intervals.some(interval => (
    amount >= interval[0] - PARAMETER_EPSILON &&
    amount <= interval[1] + PARAMETER_EPSILON
  ));
}

function pointTouchesPolygon(point, query, options, budget, includeRadius = true) {
  const contained = query.contains(point);
  if (contained === null) return { hit: false, limitExceeded: true };
  if (contained) return { hit: true, limitExceeded: false };
  if (!includeRadius) return { hit: false, limitExceeded: false };
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

function segmentTouchesPolygon(start, end, query, options, budget, caps) {
  const startTouch = pointTouchesPolygon(start, query, options, budget, caps.bodyStart);
  if (startTouch.hit || startTouch.limitExceeded) return startTouch;
  if (caps.roundStart) {
    const roundStartTouch = pointTouchesPolygon(caps.roundStart, query, options, budget);
    if (roundStartTouch.hit || roundStartTouch.limitExceeded) return roundStartTouch;
  }
  const endContained = query.contains(end);
  if (endContained === null) return { hit: false, limitExceeded: true };
  if (endContained) return { hit: true, limitExceeded: false };
  if (caps.roundEnd) {
    const roundEndTouch = pointTouchesPolygon(caps.roundEnd, query, options, budget);
    if (roundEndTouch.hit || roundEndTouch.limitExceeded) return roundEndTouch;
  }

  const maximumRadius = Math.max(strokeRadius(start, options), strokeRadius(end, options));
  const candidates = query.queryEdges(segmentBounds(start, end, maximumRadius));
  if (candidates === null) return { hit: false, limitExceeded: true };
  for (const edge of candidates) {
    if (!budget.consume()) return { hit: false, limitExceeded: true };
    if (segmentEdgeIntersectionParameters(start, end, edge.start, edge.end).length > 0) {
      return { hit: true, limitExceeded: false };
    }
    const proximity = edgeProximityIntervals(
      start,
      end,
      edge.start,
      edge.end,
      options,
      budget,
      { start: caps.bodyStart, end: caps.bodyEnd }
    );
    if (proximity.limitExceeded) return { hit: false, limitExceeded: true };
    if (proximity.intervals.length > 0) return { hit: true, limitExceeded: false };
  }
  return { hit: false, limitExceeded: false };
}

function segmentCaps(options, index, segmentCount, sourcePoints) {
  const firstSegment = index === 0;
  const lastSegment = index === segmentCount - 1;
  return {
    bodyStart: !firstSegment,
    bodyEnd: !lastSegment,
    roundStart: firstSegment && options?.strokeCaps?.start !== false
      ? sourcePoints[0]
      : null,
    roundEnd: lastSegment && options?.strokeCaps?.end !== false
      ? sourcePoints.at(-1)
      : null
  };
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
    const pointHasVisibleCap = options?.strokeCaps?.start !== false ||
      options?.strokeCaps?.end !== false;
    return pointTouchesPolygon(deduplicated[0], query, options, budget, pointHasVisibleCap);
  }
  const visibleSegmentIndexes = [];
  for (let index = 0; index < deduplicated.length - 1; index += 1) {
    if (!samePoint(deduplicated[index], deduplicated[index + 1])) {
      visibleSegmentIndexes.push(index);
    }
  }
  for (let visibleIndex = 0; visibleIndex < visibleSegmentIndexes.length; visibleIndex += 1) {
    if (!budget.consume()) return { hit: false, limitExceeded: true };
    const pointIndex = visibleSegmentIndexes[visibleIndex];
    const result = segmentTouchesPolygon(
      deduplicated[pointIndex],
      deduplicated[pointIndex + 1],
      query,
      options,
      budget,
      segmentCaps(options, visibleIndex, visibleSegmentIndexes.length, deduplicated)
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
  const sourcePoints = Array.isArray(points) ? deduplicateStrokePoints(points) : [];
  if (sourcePoints.length < 2 ||
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
  const samplePositions = new WeakMap();

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

  const visibleSegmentIndexes = [];
  for (let index = 0; index < sourcePoints.length - 1; index += 1) {
    if (!samePoint(sourcePoints[index], sourcePoints[index + 1])) {
      visibleSegmentIndexes.push(index);
    }
  }

  outer: for (
    let visibleIndex = 0;
    visibleIndex < visibleSegmentIndexes.length;
    visibleIndex += 1
  ) {
    if (!budget.consume()) {
      result.limitExceeded = true;
      limitReason = 'operations';
      break;
    }
    const pointIndex = visibleSegmentIndexes[visibleIndex];
    const start = sourcePoints[pointIndex];
    const end = sourcePoints[pointIndex + 1];
    const selection = segmentSelectionIntervals(
      start,
      end,
      query,
      options,
      budget,
      segmentCaps(options, visibleIndex, visibleSegmentIndexes.length, sourcePoints)
    );
    if (selection.limitExceeded) {
      result.limitExceeded = true;
      limitReason = 'operations';
      break;
    }
    const selectionIntervals = selection.intervals;
    const cuts = [0, ...selectionIntervals.flat(), 1]
      .sort((left, right) => left - right)
      .filter((value, cutIndex, values) => (
        cutIndex === 0 ||
        Math.abs(value - values[cutIndex - 1]) > PARAMETER_EPSILON
      ));

    for (let cutIndex = 0; cutIndex < cuts.length - 1; cutIndex += 1) {
      const fromAmount = cuts[cutIndex];
      const toAmount = cuts[cutIndex + 1];
      const from = interpolateSample(start, end, fromAmount);
      const to = interpolateSample(start, end, toAmount);
      samplePositions.set(from, { segmentIndex: pointIndex, amount: fromAmount });
      samplePositions.set(to, { segmentIndex: pointIndex, amount: toAmount });
      const midpoint = (cuts[cutIndex] + cuts[cutIndex + 1]) / 2;
      const kind = intervalContains(selectionIntervals, midpoint) ? 'inside' : 'outside';
      if ((currentKind !== kind || !currentRun) && !startRun(kind, from)) break outer;
      else appendPoint(currentRun, from);
      appendPoint(currentRun, to);
    }
  }

  restoreSamePositionPressureChains(result.runs, sourcePoints, samplePositions);
  result.runs = result.runs.filter(({ points: run }) => run.length >= 2 && hasVisibleLength(run));
  result.inside = result.runs.filter(run => run.kind === 'inside').map(run => run.points);
  result.outside = result.runs.filter(run => run.kind === 'outside').map(run => run.points);
  if (result.limitExceeded) result.limitReason = limitReason || 'operations';
  return result;
}

function splitStrokePointsBySourceIntervals(points = [], intervals = [], options = {}) {
  const sourcePoints = Array.isArray(points) ? [...points] : [];
  const maximumPosition = Math.max(0, sourcePoints.length - 1);
  const budget = options.budget || createGeometryBudget(options.maxOperations);
  const unavailable = () => ({
    inside: [],
    outside: sourcePoints.length > 0 ? [sourcePoints] : [],
    runs: sourcePoints.length > 0
      ? [{ kind: 'outside', points: sourcePoints }]
      : [],
    limitExceeded: false,
    geometryUnavailable: true
  });
  if (!Array.isArray(intervals)) return unavailable();
  const normalizedIntervals = [];
  for (const interval of intervals) {
    if (!budget.consume() || !Array.isArray(interval) || interval.length !== 2) {
      return budget.limitExceeded
        ? { ...unavailable(), limitExceeded: true, limitReason: 'operations' }
        : unavailable();
    }
    const start = Number(interval[0]);
    const end = Number(interval[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) ||
        start < -PARAMETER_EPSILON ||
        end > maximumPosition + PARAMETER_EPSILON ||
        start > end + PARAMETER_EPSILON) {
      return unavailable();
    }
    if (end - start > PARAMETER_EPSILON) {
      normalizedIntervals.push([
        Math.max(0, start),
        Math.min(maximumPosition, end)
      ]);
    }
  }
  normalizedIntervals.sort((left, right) => left[0] - right[0]);
  const mergedIntervals = [];
  for (const interval of normalizedIntervals) {
    const previous = mergedIntervals.at(-1);
    if (!previous || interval[0] > previous[1] + PARAMETER_EPSILON) {
      mergedIntervals.push([...interval]);
    } else {
      previous[1] = Math.max(previous[1], interval[1]);
    }
  }
  if (sourcePoints.length < 2 || mergedIntervals.length === 0) {
    const outside = sourcePoints.length > 0 ? [sourcePoints] : [];
    return {
      inside: [],
      outside,
      runs: outside.map(run => ({ kind: 'outside', points: run })),
      limitExceeded: false
    };
  }

  const maxRuns = Number.isInteger(Number(options.maxRuns)) && Number(options.maxRuns) > 0
    ? Number(options.maxRuns)
    : Number.POSITIVE_INFINITY;
  const result = { inside: [], outside: [], runs: [], limitExceeded: false };
  let currentKind = null;
  let currentRun = null;
  let limitReason = null;
  const boundaries = mergedIntervals.flat();
  let boundaryCursor = 0;
  let membershipCursor = 0;
  const startRun = (kind, point) => {
    if (result.runs.length >= maxRuns) {
      result.limitExceeded = true;
      limitReason = 'runs';
      return false;
    }
    currentKind = kind;
    currentRun = [point];
    result.runs.push({ kind, points: currentRun });
    return true;
  };

  outer: for (let index = 0; index < sourcePoints.length - 1; index += 1) {
    if (!budget.consume()) {
      result.limitExceeded = true;
      limitReason = 'operations';
      break;
    }
    const cuts = [0, 1];
    while (boundaryCursor < boundaries.length &&
        boundaries[boundaryCursor] <= index + PARAMETER_EPSILON) {
      boundaryCursor += 1;
    }
    let nextBoundary = boundaryCursor;
    while (nextBoundary < boundaries.length &&
        boundaries[nextBoundary] < index + 1 - PARAMETER_EPSILON) {
      if (!budget.consume()) {
        result.limitExceeded = true;
        limitReason = 'operations';
        break outer;
      }
      cuts.push(boundaries[nextBoundary] - index);
      nextBoundary += 1;
    }
    boundaryCursor = nextBoundary;
    cuts.sort((left, right) => left - right);
    for (let cutIndex = 0; cutIndex < cuts.length - 1; cutIndex += 1) {
      if (!budget.consume()) {
        result.limitExceeded = true;
        limitReason = 'operations';
        break outer;
      }
      const fromAmount = cuts[cutIndex];
      const toAmount = cuts[cutIndex + 1];
      const from = interpolateSample(sourcePoints[index], sourcePoints[index + 1], fromAmount);
      const to = interpolateSample(sourcePoints[index], sourcePoints[index + 1], toAmount);
      const midpoint = index + (fromAmount + toAmount) / 2;
      while (membershipCursor < mergedIntervals.length &&
          mergedIntervals[membershipCursor][1] < midpoint - PARAMETER_EPSILON) {
        membershipCursor += 1;
      }
      const interval = mergedIntervals[membershipCursor];
      const kind = interval &&
        midpoint >= interval[0] - PARAMETER_EPSILON &&
        midpoint <= interval[1] + PARAMETER_EPSILON
        ? 'inside'
        : 'outside';
      if ((currentKind !== kind || !currentRun) && !startRun(kind, from)) break outer;
      else appendPoint(currentRun, from);
      appendPoint(currentRun, to);
    }
  }

  result.runs = result.runs.filter(({ points: run }) => (
    run.length >= 2 && hasVisibleLength(run)
  ));
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
  splitStrokePointsByPolygon,
  splitStrokePointsBySourceIntervals
};
