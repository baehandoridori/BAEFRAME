'use strict';

const EPSILON = 1e-7;
const PARAMETER_EPSILON = 1e-12;
const DEFAULT_EDGE_INDEX_LEAF_SIZE = 8;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function pointOnSegment(point, start, end) {
  const px = finiteNumber(point?.x);
  const py = finiteNumber(point?.y);
  const ax = finiteNumber(start?.x);
  const ay = finiteNumber(start?.y);
  const bx = finiteNumber(end?.x);
  const by = finiteNumber(end?.y);
  const area = cross(px - ax, py - ay, bx - ax, by - ay);
  if (Math.abs(area) > EPSILON) return false;
  return px >= Math.min(ax, bx) - EPSILON && px <= Math.max(ax, bx) + EPSILON &&
    py >= Math.min(ay, by) - EPSILON && py <= Math.max(ay, by) + EPSILON;
}

function pointInPolygon(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const startY = finiteNumber(start?.y);
    const endY = finiteNumber(end?.y);
    const pointY = finiteNumber(point?.y);
    const crossesRay = (endY > pointY) !== (startY > pointY);
    if (!crossesRay) continue;
    const crossingX = (finiteNumber(start?.x) - finiteNumber(end?.x)) *
      (pointY - endY) / (startY - endY) + finiteNumber(end?.x);
    if (finiteNumber(point?.x) < crossingX) inside = !inside;
  }
  return inside;
}

function pointToSegmentDistance(point, start, end) {
  const px = finiteNumber(point?.x);
  const py = finiteNumber(point?.y);
  const ax = finiteNumber(start?.x);
  const ay = finiteNumber(start?.y);
  const dx = finiteNumber(end?.x) - ax;
  const dy = finiteNumber(end?.y) - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(px - ax, py - ay);
  const amount = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + dx * amount), py - (ay + dy * amount));
}

function pointToPolygonDistance(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length === 0) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(point, polygon)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointToSegmentDistance(
      point,
      polygon[index],
      polygon[(index + 1) % polygon.length]
    ));
  }
  return distance;
}

function polygonHasArea(polygon = [], minimumArea = 1) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let doubleArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    doubleArea += finiteNumber(current?.x) * finiteNumber(next?.y) -
      finiteNumber(next?.x) * finiteNumber(current?.y);
  }
  return Math.abs(doubleArea) + EPSILON >= Math.max(0, finiteNumber(minimumArea, 1)) * 2;
}

function boundsForPoints(points = [], padding = 0) {
  if (!Array.isArray(points) || points.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const x = finiteNumber(point?.x);
    const y = finiteNumber(point?.y);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const safePadding = Math.max(0, finiteNumber(padding));
  return {
    left: left - safePadding,
    right: right + safePadding,
    top: top - safePadding,
    bottom: bottom + safePadding
  };
}

function boundsIntersect(left, right) {
  return !!left && !!right &&
    left.right >= right.left - EPSILON &&
    left.left <= right.right + EPSILON &&
    left.bottom >= right.top - EPSILON &&
    left.top <= right.bottom + EPSILON;
}

function createGeometryBudget(maxOperations = Number.POSITIVE_INFINITY) {
  const numericLimit = Number(maxOperations);
  const limit = Number.isFinite(numericLimit)
    ? Math.max(0, Math.trunc(numericLimit))
    : Number.POSITIVE_INFINITY;
  let operations = 0;
  let limitExceeded = false;
  return {
    consume(count = 1) {
      const amount = Math.max(0, Math.trunc(finiteNumber(count, 1)));
      if (limitExceeded) return false;
      if (operations + amount > limit) {
        limitExceeded = true;
        return false;
      }
      operations += amount;
      return true;
    },
    get operations() {
      return operations;
    },
    get maxOperations() {
      return limit;
    },
    get limitExceeded() {
      return limitExceeded;
    }
  };
}

function boundsForEdge(start, end) {
  return {
    left: Math.min(finiteNumber(start?.x), finiteNumber(end?.x)),
    right: Math.max(finiteNumber(start?.x), finiteNumber(end?.x)),
    top: Math.min(finiteNumber(start?.y), finiteNumber(end?.y)),
    bottom: Math.max(finiteNumber(start?.y), finiteNumber(end?.y))
  };
}

function unionBounds(entries) {
  if (!entries.length) return null;
  return entries.reduce((bounds, entry) => ({
    left: Math.min(bounds.left, entry.bounds.left),
    right: Math.max(bounds.right, entry.bounds.right),
    top: Math.min(bounds.top, entry.bounds.top),
    bottom: Math.max(bounds.bottom, entry.bounds.bottom)
  }), { ...entries[0].bounds });
}

function buildEdgeIndexNode(entries, leafSize) {
  const bounds = unionBounds(entries);
  if (entries.length <= leafSize) return { bounds, edges: entries };
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const axis = width >= height ? 'x' : 'y';
  const ordered = [...entries].sort((left, right) => {
    const leftCenter = axis === 'x'
      ? (left.bounds.left + left.bounds.right) / 2
      : (left.bounds.top + left.bounds.bottom) / 2;
    const rightCenter = axis === 'x'
      ? (right.bounds.left + right.bounds.right) / 2
      : (right.bounds.top + right.bounds.bottom) / 2;
    return leftCenter - rightCenter || left.index - right.index;
  });
  const middle = Math.ceil(ordered.length / 2);
  return {
    bounds,
    left: buildEdgeIndexNode(ordered.slice(0, middle), leafSize),
    right: buildEdgeIndexNode(ordered.slice(middle), leafSize)
  };
}

function createPolygonEdgeIndex(polygon = [], options = {}) {
  const budget = options.budget || createGeometryBudget();
  const leafSize = Math.max(
    2,
    Math.trunc(finiteNumber(options.leafSize, DEFAULT_EDGE_INDEX_LEAF_SIZE))
  );
  const normalized = Array.isArray(polygon)
    ? polygon.map(point => ({ x: finiteNumber(point?.x), y: finiteNumber(point?.y) }))
    : [];
  const polygonBounds = boundsForPoints(normalized);
  const edges = normalized.length >= 3
    ? normalized.map((start, index) => {
      const end = normalized[(index + 1) % normalized.length];
      return { index, start, end, bounds: boundsForEdge(start, end) };
    })
    : [];
  const buildCost = edges.length > 0
    ? edges.length * (Math.ceil(Math.log2(edges.length + 1)) + 1)
    : 0;
  const buildAccepted = budget.consume(buildCost);
  const root = buildAccepted && edges.length > 0 ? buildEdgeIndexNode(edges, leafSize) : null;

  const queryEdges = bounds => {
    if (!root || !bounds) return budget.limitExceeded ? null : [];
    const matches = [];
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!budget.consume()) return null;
      if (!boundsIntersect(node.bounds, bounds)) continue;
      if (node.edges) {
        for (const edge of node.edges) {
          if (!budget.consume()) return null;
          if (boundsIntersect(edge.bounds, bounds)) matches.push(edge);
        }
      } else {
        if (node.right) stack.push(node.right);
        if (node.left) stack.push(node.left);
      }
    }
    return matches;
  };

  const contains = point => {
    if (!polygonBounds ||
        finiteNumber(point?.x) < polygonBounds.left - EPSILON ||
        finiteNumber(point?.x) > polygonBounds.right + EPSILON ||
        finiteNumber(point?.y) < polygonBounds.top - EPSILON ||
        finiteNumber(point?.y) > polygonBounds.bottom + EPSILON) {
      return false;
    }
    const candidates = queryEdges({
      left: finiteNumber(point?.x),
      right: polygonBounds.right,
      top: finiteNumber(point?.y),
      bottom: finiteNumber(point?.y)
    });
    if (candidates === null) return null;
    let inside = false;
    for (const edge of candidates) {
      if (!budget.consume()) return null;
      if (pointOnSegment(point, edge.start, edge.end)) return true;
      const startY = edge.start.y;
      const endY = edge.end.y;
      const pointY = finiteNumber(point?.y);
      if ((endY > pointY) === (startY > pointY)) continue;
      const crossingX = (edge.start.x - edge.end.x) *
        (pointY - endY) / (startY - endY) + edge.end.x;
      if (finiteNumber(point?.x) < crossingX) inside = !inside;
    }
    return inside;
  };

  return {
    __baeframePolygonEdgeIndex: true,
    polygon: normalized,
    bounds: polygonBounds,
    edges,
    budget,
    queryEdges,
    contains
  };
}

function simplifyOpenPolyline(points, tolerance) {
  if (points.length <= 2) return points.map(point => ({ ...point }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop();
    let farthestIndex = -1;
    let farthestDistance = tolerance;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = pointToSegmentDistance(points[index], points[startIndex], points[endIndex]);
      if (distance <= farthestDistance) continue;
      farthestDistance = distance;
      farthestIndex = index;
    }
    if (farthestIndex < 0) continue;
    keep[farthestIndex] = 1;
    stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
  }
  return points.filter((_point, index) => keep[index]).map(point => ({ ...point }));
}

function simplifyClosedPolygon(points = [], tolerance = 1) {
  const deduplicated = [];
  for (const point of points) {
    const normalized = { x: finiteNumber(point?.x), y: finiteNumber(point?.y) };
    const previous = deduplicated[deduplicated.length - 1];
    if (!previous || Math.hypot(normalized.x - previous.x, normalized.y - previous.y) > EPSILON) {
      deduplicated.push(normalized);
    }
  }
  if (deduplicated.length > 1) {
    const first = deduplicated[0];
    const last = deduplicated[deduplicated.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON) deduplicated.pop();
  }
  if (deduplicated.length <= 3 || finiteNumber(tolerance) <= 0) return deduplicated;
  let farthestIndex = 1;
  let farthestDistance = -1;
  for (let index = 1; index < deduplicated.length; index += 1) {
    const dx = deduplicated[index].x - deduplicated[0].x;
    const dy = deduplicated[index].y - deduplicated[0].y;
    const distance = dx * dx + dy * dy;
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthestIndex = index;
    }
  }
  const safeTolerance = Math.max(EPSILON, finiteNumber(tolerance, 1));
  const firstHalf = simplifyOpenPolyline(deduplicated.slice(0, farthestIndex + 1), safeTolerance);
  const secondHalf = simplifyOpenPolyline(
    [...deduplicated.slice(farthestIndex), deduplicated[0]],
    safeTolerance
  );
  const simplified = [...firstHalf, ...secondHalf.slice(1, -1)];
  return simplified.length >= 3 ? simplified : deduplicated;
}

function segmentEdgeIntersectionParameters(start, end, edgeStart, edgeEnd) {
  const ax = finiteNumber(start?.x);
  const ay = finiteNumber(start?.y);
  const rx = finiteNumber(end?.x) - ax;
  const ry = finiteNumber(end?.y) - ay;
  const parameters = [];
  const qx = finiteNumber(edgeStart?.x);
  const qy = finiteNumber(edgeStart?.y);
  const sx = finiteNumber(edgeEnd?.x) - qx;
  const sy = finiteNumber(edgeEnd?.y) - qy;
  const denominator = cross(rx, ry, sx, sy);
  const qpx = qx - ax;
  const qpy = qy - ay;

  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(qpx, qpy, rx, ry)) > EPSILON) return parameters;
    const lengthSquared = rx * rx + ry * ry;
    if (lengthSquared <= EPSILON) return parameters;
    for (const edgePoint of [edgeStart, edgeEnd]) {
      const t = ((finiteNumber(edgePoint?.x) - ax) * rx +
        (finiteNumber(edgePoint?.y) - ay) * ry) / lengthSquared;
      if (t > PARAMETER_EPSILON && t < 1 - PARAMETER_EPSILON) parameters.push(t);
    }
    return parameters;
  }

  const t = cross(qpx, qpy, sx, sy) / denominator;
  const u = cross(qpx, qpy, rx, ry) / denominator;
  if (t >= -PARAMETER_EPSILON && t <= 1 + PARAMETER_EPSILON &&
      u >= -PARAMETER_EPSILON && u <= 1 + PARAMETER_EPSILON) {
    parameters.push(Math.min(1, Math.max(0, t)));
  }
  return parameters;
}

function segmentPolygonIntersectionParameters(start, end, polygon = []) {
  const parameters = [];
  for (let index = 0; index < polygon.length; index += 1) {
    parameters.push(...segmentEdgeIntersectionParameters(
      start,
      end,
      polygon[index],
      polygon[(index + 1) % polygon.length]
    ));
  }
  return parameters
    .sort((left, right) => left - right)
    .filter((value, index, values) => (
      index === 0 || Math.abs(value - values[index - 1]) > PARAMETER_EPSILON
    ));
}

module.exports = {
  EPSILON,
  pointInPolygon,
  pointToSegmentDistance,
  pointToPolygonDistance,
  polygonHasArea,
  boundsForPoints,
  boundsIntersect,
  createGeometryBudget,
  createPolygonEdgeIndex,
  simplifyClosedPolygon,
  segmentEdgeIntersectionParameters,
  segmentPolygonIntersectionParameters
};
