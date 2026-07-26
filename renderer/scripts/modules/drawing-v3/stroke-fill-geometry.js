'use strict';

const {
  EPSILON,
  boundsForPoints,
  boundsIntersect,
  polygonHasArea,
  segmentEdgeIntersectionParameters
} = require('./lasso-geometry.js');

const DEFAULT_MAX_FLATTENED_SEGMENTS = 65_536;
const DEFAULT_EDGE_INDEX_LEAF_SIZE = 8;
const MAX_CURVE_SUBDIVISION_DEPTH = 24;

function unionBounds(entries) {
  if (!entries.length) return null;
  return entries.reduce((bounds, entry) => ({
    left: Math.min(bounds.left, entry.bounds.left),
    right: Math.max(bounds.right, entry.bounds.right),
    top: Math.min(bounds.top, entry.bounds.top),
    bottom: Math.max(bounds.bottom, entry.bounds.bottom)
  }), { ...entries[0].bounds });
}

function buildOrderedSpatialIndex(entries, budget) {
  if (!entries.length) return null;
  const levels = Math.max(1, Math.ceil(Math.log2(entries.length + 1)));
  if (!budget.consume(entries.length * (levels + 4))) return null;
  const center = (entry, axis) => axis === 'x'
    ? (entry.bounds.left + entry.bounds.right) / 2
    : (entry.bounds.top + entry.bounds.bottom) / 2;
  const compare = axis => (left, right) => (
    center(left, axis) - center(right, axis) || left.index - right.index
  );
  const xOrdered = [...entries].sort(compare('x'));
  const yOrdered = [...entries].sort(compare('y'));

  const build = (xEntries, yEntries) => {
    if (xEntries.length <= DEFAULT_EDGE_INDEX_LEAF_SIZE) {
      return { bounds: unionBounds(xEntries), edges: xEntries };
    }
    const bounds = unionBounds(xEntries);
    const splitOnX = bounds.right - bounds.left >= bounds.bottom - bounds.top;
    const primary = splitOnX ? xEntries : yEntries;
    const midpointIndex = Math.ceil(primary.length / 2);
    const leftPrimary = primary.slice(0, midpointIndex);
    const rightPrimary = primary.slice(midpointIndex);
    const leftIndexes = new Set(leftPrimary.map(entry => entry.index));
    const secondary = splitOnX ? yEntries : xEntries;
    const leftSecondary = [];
    const rightSecondary = [];
    for (const entry of secondary) {
      (leftIndexes.has(entry.index) ? leftSecondary : rightSecondary).push(entry);
    }
    const left = splitOnX
      ? build(leftPrimary, leftSecondary)
      : build(leftSecondary, leftPrimary);
    const right = splitOnX
      ? build(rightPrimary, rightSecondary)
      : build(rightSecondary, rightPrimary);
    return { bounds, left, right };
  };
  return build(xOrdered, yOrdered);
}

function freezeSpatialIndex(node) {
  if (!node || Object.isFrozen(node)) return node;
  if (node.edges) Object.freeze(node.edges);
  freezeSpatialIndex(node.left);
  freezeSpatialIndex(node.right);
  Object.freeze(node.bounds);
  return Object.freeze(node);
}

function freezePathGeometry(geometry) {
  for (const contour of geometry.contours) {
    for (const point of contour) Object.freeze(point);
    Object.freeze(contour);
  }
  for (const edge of geometry.edges) {
    Object.freeze(edge.bounds);
    Object.freeze(edge);
  }
  Object.freeze(geometry.contours);
  Object.freeze(geometry.edges);
  Object.freeze(geometry.bounds);
  freezeSpatialIndex(geometry.root);
  return Object.freeze(geometry);
}

function freezeCenterlineGeometry(geometry) {
  for (const point of geometry.points) Object.freeze(point);
  for (const segment of geometry.segments) {
    Object.freeze(segment.bounds);
    Object.freeze(segment);
  }
  Object.freeze(geometry.points);
  Object.freeze(geometry.segments);
  Object.freeze(geometry.sourceDistances);
  Object.freeze(geometry.sourcePositions);
  if (geometry.bounds) Object.freeze(geometry.bounds);
  freezeSpatialIndex(geometry.root);
  return Object.freeze(geometry);
}

function queryOrderedSpatialIndex(root, bounds, budget) {
  if (!root || !bounds) return [];
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
}

function finitePoint(x, y) {
  const nextX = Number(x);
  const nextY = Number(y);
  return Number.isFinite(nextX) && Number.isFinite(nextY)
    ? { x: nextX, y: nextY }
    : null;
}

function samePoint(left, right) {
  return Math.abs(left.x - right.x) <= EPSILON &&
    Math.abs(left.y - right.y) <= EPSILON;
}

function pointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  if (Math.abs(cross) > EPSILON) return false;
  return point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON;
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.min(1, Math.max(0, (
    (point.x - start.x) * dx +
    (point.y - start.y) * dy
  ) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.y - (start.y + dy * amount)
  );
}

function midpoint(left, right) {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2
  };
}

function flattenQuadratic(start, control, end, tolerance, acceptPoint) {
  const stack = [{ start, control, end, depth: 0 }];
  while (stack.length > 0) {
    const curve = stack.pop();
    if (pointLineDistance(curve.control, curve.start, curve.end) <= tolerance) {
      if (!acceptPoint(curve.end)) return false;
      continue;
    }
    if (curve.depth >= MAX_CURVE_SUBDIVISION_DEPTH) return false;
    const startControl = midpoint(curve.start, curve.control);
    const controlEnd = midpoint(curve.control, curve.end);
    const center = midpoint(startControl, controlEnd);
    const depth = curve.depth + 1;
    stack.push(
      { start: center, control: controlEnd, end: curve.end, depth },
      { start: curve.start, control: startControl, end: center, depth }
    );
  }
  return true;
}

function flattenCubic(start, controlA, controlB, end, tolerance, acceptPoint) {
  const stack = [{ start, controlA, controlB, end, depth: 0 }];
  while (stack.length > 0) {
    const curve = stack.pop();
    const flatness = Math.max(
      pointLineDistance(curve.controlA, curve.start, curve.end),
      pointLineDistance(curve.controlB, curve.start, curve.end)
    );
    if (flatness <= tolerance) {
      if (!acceptPoint(curve.end)) return false;
      continue;
    }
    if (curve.depth >= MAX_CURVE_SUBDIVISION_DEPTH) return false;
    const startA = midpoint(curve.start, curve.controlA);
    const controls = midpoint(curve.controlA, curve.controlB);
    const controlEnd = midpoint(curve.controlB, curve.end);
    const leftControl = midpoint(startA, controls);
    const rightControl = midpoint(controls, controlEnd);
    const center = midpoint(leftControl, rightControl);
    const depth = curve.depth + 1;
    stack.push(
      {
        start: center,
        controlA: rightControl,
        controlB: controlEnd,
        end: curve.end,
        depth
      },
      {
        start: curve.start,
        controlA: startA,
        controlB: leftControl,
        end: center,
        depth
      }
    );
  }
  return true;
}

function flattenFabricPath(pathCommands, options = {}) {
  const budget = options.budget;
  if (!budget || typeof budget.consume !== 'function' || !Array.isArray(pathCommands)) {
    return { geometry: null, reason: 'selection-geometry-unavailable' };
  }
  const operationsBefore = budget.operations;
  const tolerance = Math.max(Number.EPSILON, Number(options.tolerance) || 0.25);
  const maxSegments = Math.max(
    3,
    Math.trunc(Number(options.maxSegments) || DEFAULT_MAX_FLATTENED_SEGMENTS)
  );
  const contours = [];
  let current = null;
  let currentPoint = null;
  let segmentCount = 0;
  let flattenFailed = false;

  const acceptPoint = point => {
    if (!point || !budget.consume()) {
      flattenFailed = true;
      return false;
    }
    segmentCount += 1;
    if (segmentCount > maxSegments) {
      flattenFailed = true;
      return false;
    }
    if (!samePoint(current.at(-1), point)) current.push(point);
    currentPoint = point;
    return true;
  };
  const finishContour = () => {
    if (!current) return;
    if (current.length > 1 && samePoint(current[0], current.at(-1))) current.pop();
    if (current.length >= 3) contours.push(current);
    current = null;
    currentPoint = null;
  };

  const commandLengths = { M: 3, L: 3, Q: 5, C: 7, Z: 1 };
  for (const command of pathCommands) {
    if (!Array.isArray(command) || typeof command[0] !== 'string' || !budget.consume()) {
      return {
        geometry: null,
        reason: budget.limitExceeded
          ? 'selection-complexity-limit-exceeded'
          : 'selection-geometry-unavailable'
      };
    }
    const type = command[0];
    if (!Object.hasOwn(commandLengths, type) || command.length !== commandLengths[type]) {
      return { geometry: null, reason: 'selection-geometry-unavailable' };
    }
    if (type === 'M') {
      const point = finitePoint(command[1], command[2]);
      if (!point) return { geometry: null, reason: 'selection-geometry-unavailable' };
      if (current) return { geometry: null, reason: 'selection-geometry-unavailable' };
      current = [point];
      currentPoint = point;
      continue;
    }
    if (!current || !currentPoint) {
      return { geometry: null, reason: 'selection-geometry-unavailable' };
    }
    if (type === 'L') {
      if (!acceptPoint(finitePoint(command[1], command[2]))) break;
    } else if (type === 'Q') {
      const control = finitePoint(command[1], command[2]);
      const end = finitePoint(command[3], command[4]);
      if (!control || !end ||
          !flattenQuadratic(currentPoint, control, end, tolerance, acceptPoint)) {
        flattenFailed = true;
        break;
      }
    } else if (type === 'C') {
      const controlA = finitePoint(command[1], command[2]);
      const controlB = finitePoint(command[3], command[4]);
      const end = finitePoint(command[5], command[6]);
      if (!controlA || !controlB || !end ||
          !flattenCubic(currentPoint, controlA, controlB, end, tolerance, acceptPoint)) {
        flattenFailed = true;
        break;
      }
    } else if (type === 'Z') {
      finishContour();
    }
  }
  if (flattenFailed || budget.limitExceeded || segmentCount > maxSegments) {
    return {
      geometry: null,
      reason: budget.limitExceeded || segmentCount > maxSegments
        ? 'selection-complexity-limit-exceeded'
        : 'selection-geometry-unavailable'
    };
  }
  if (current) {
    return { geometry: null, reason: 'selection-geometry-unavailable' };
  }
  if (contours.length === 0) {
    return { geometry: null, reason: 'selection-geometry-unavailable' };
  }

  const edges = [];
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      const start = contour[index];
      const end = contour[(index + 1) % contour.length];
      if (samePoint(start, end)) continue;
      edges.push({
        index: edges.length,
        start,
        end,
        bounds: {
          left: Math.min(start.x, end.x),
          right: Math.max(start.x, end.x),
          top: Math.min(start.y, end.y),
          bottom: Math.max(start.y, end.y)
        }
      });
    }
  }
  if (edges.length < 3) return { geometry: null, reason: 'selection-geometry-unavailable' };
  const root = buildOrderedSpatialIndex(edges, budget);
  if (!root) {
    return { geometry: null, reason: 'selection-complexity-limit-exceeded' };
  }

  return {
    geometry: freezePathGeometry({
      contours,
      edges,
      root,
      bounds: boundsForPoints(contours.flat()),
      fillRule: options.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      tolerance,
      logicalBuildCost: budget.operations - operationsBefore
    }),
    reason: null
  };
}

function createPathFillQuery(geometry, budget) {
  if (!geometry?.root || !budget || typeof budget.consume !== 'function') return null;
  const queryEdges = bounds => {
    if (!bounds || !boundsIntersect(geometry.bounds, bounds)) return [];
    return queryOrderedSpatialIndex(geometry.root, bounds, budget);
  };
  const classifyPoint = point => {
    if (!geometry.bounds ||
        point.x < geometry.bounds.left - EPSILON ||
        point.x > geometry.bounds.right + EPSILON ||
        point.y < geometry.bounds.top - EPSILON ||
        point.y > geometry.bounds.bottom + EPSILON) {
      return 'outside';
    }
    const candidates = queryEdges({
      left: point.x,
      right: geometry.bounds.right,
      top: point.y,
      bottom: point.y
    });
    if (candidates === null) return null;
    let winding = 0;
    let crossings = 0;
    for (const edge of candidates) {
      if (!budget.consume()) return null;
      if (pointOnSegment(point, edge.start, edge.end)) {
        return 'boundary';
      }
      const upward = edge.start.y <= point.y && edge.end.y > point.y;
      const downward = edge.start.y > point.y && edge.end.y <= point.y;
      if (!upward && !downward) continue;
      const side = (edge.end.x - edge.start.x) * (point.y - edge.start.y) -
        (point.x - edge.start.x) * (edge.end.y - edge.start.y);
      if (upward && side > EPSILON) {
        winding += 1;
        crossings += 1;
      } else if (downward && side < -EPSILON) {
        winding -= 1;
        crossings += 1;
      }
    }
    const inside = geometry.fillRule === 'evenodd'
      ? crossings % 2 === 1
      : winding !== 0;
    return inside ? 'inside' : 'outside';
  };
  const containsPoint = (point, includeBoundary) => {
    const classification = classifyPoint(point);
    if (classification === null) return null;
    return classification === 'inside' ||
      (includeBoundary && classification === 'boundary');
  };
  const visibleBoundarySegment = segment => {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return false;
    const middle = midpoint(segment.start, segment.end);
    const coordinateScale = Math.max(1, Math.abs(middle.x), Math.abs(middle.y));
    const minimumOffset = Math.max(
      Number.EPSILON * coordinateScale * 64,
      EPSILON * 4 / Math.max(1, length)
    );
    let offset = Math.max(
      minimumOffset,
      Math.min(geometry.tolerance * 0.25, length * 0.1)
    );
    const nearest = localBoundaryClearance(
      middle,
      offset,
      [{ queryEdges }],
      budget
    );
    if (nearest === null) return null;
    if (Number.isFinite(nearest)) {
      offset = Math.min(
        offset,
        Math.max(minimumOffset, nearest / 4)
      );
    }
    const certifiedOffset = offset;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (!budget.consume()) return null;
      const normalX = -dy / length * offset;
      const normalY = dx / length * offset;
      const left = classifyPoint({
        x: middle.x + normalX,
        y: middle.y + normalY
      });
      const right = classifyPoint({
        x: middle.x - normalX,
        y: middle.y - normalY
      });
      if (left === null || right === null) return null;
      const bothOffBoundary = left !== 'boundary' && right !== 'boundary';
      if (bothOffBoundary && left !== right) return true;
      if (bothOffBoundary && certifiedOffset !== null &&
          offset <= certifiedOffset + Number.EPSILON) {
        return false;
      }
      if (offset <= minimumOffset) return false;
      offset = Math.max(minimumOffset, offset / 4);
    }
    return null;
  };
  const query = {
    __baeframePathFillQuery: true,
    geometry,
    bounds: geometry.bounds,
    edges: geometry.edges,
    budget,
    queryEdges,
    classify: classifyPoint,
    contains: point => containsPoint(point, true),
    containsStrict: point => containsPoint(point, false)
  };
  const visibleSubsegmentsCache = new Map();
  query.visibleSubsegments = edge => {
    const startKey = `${edge.start.x}:${edge.start.y}`;
    const endKey = `${edge.end.x}:${edge.end.y}`;
    const cacheKey = startKey < endKey
      ? `${startKey}>${endKey}`
      : `${endKey}>${startKey}`;
    if (visibleSubsegmentsCache.has(cacheKey)) {
      return visibleSubsegmentsCache.get(cacheKey);
    }
    const split = splitBoundaryEdge(
      edge,
      { queryEdges: () => [] },
      budget,
      query
    );
    if (split.reason) return null;
    const visible = [];
    for (const segment of split.segments) {
      const active = visibleBoundarySegment(segment);
      if (active === null) return null;
      if (active) visible.push(segment);
    }
    visibleSubsegmentsCache.set(cacheKey, visible);
    return visible;
  };
  return query;
}

function pathFillOverlapsPolygon(fillQuery, polygonQuery, budget) {
  if (!fillQuery || !polygonQuery?.bounds || !boundsIntersect(fillQuery.bounds, polygonQuery.bounds)) {
    return { hit: false, limitExceeded: false };
  }
  for (const edge of polygonQuery.edges) {
    const candidates = fillQuery.queryEdges(edge.bounds);
    if (candidates === null) return { hit: false, limitExceeded: true };
    for (const fillEdge of candidates) {
      if (!budget.consume()) return { hit: false, limitExceeded: true };
      const visibleSegments = fillQuery.visibleSubsegments(fillEdge);
      if (visibleSegments === null) return { hit: false, limitExceeded: true };
      for (const visibleSegment of visibleSegments) {
        if (!budget.consume()) return { hit: false, limitExceeded: true };
        if (segmentEdgeIntersectionParameters(
          edge.start,
          edge.end,
          visibleSegment.start,
          visibleSegment.end
        ).length > 0) {
          return { hit: true, limitExceeded: false };
        }
      }
    }
  }
  for (const point of polygonQuery.polygon) {
    const contained = fillQuery.containsStrict(point);
    if (contained === null) return { hit: false, limitExceeded: true };
    if (contained) return { hit: true, limitExceeded: false };
  }
  for (const edge of fillQuery.edges) {
    if (!budget.consume()) return { hit: false, limitExceeded: true };
    const visibleSegments = fillQuery.visibleSubsegments(edge);
    if (visibleSegments === null) return { hit: false, limitExceeded: true };
    for (const visibleSegment of visibleSegments) {
      const contained = polygonQuery.contains(midpoint(
        visibleSegment.start,
        visibleSegment.end
      ));
      if (contained === null) return { hit: false, limitExceeded: true };
      if (contained) return { hit: true, limitExceeded: false };
    }
  }
  return { hit: false, limitExceeded: false };
}

function interpolatePoint(start, end, amount) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount
  };
}

function uniqueParameters(parameters, budget) {
  const logicalSortCost = parameters.length *
    (Math.ceil(Math.log2(parameters.length + 1)) + 2);
  if (!budget.consume(logicalSortCost)) return null;
  return parameters
    .filter(value => Number.isFinite(value) && value >= -EPSILON && value <= 1 + EPSILON)
    .map(value => Math.min(1, Math.max(0, value)))
    .sort((left, right) => left - right)
    .filter((value, index, values) => (
      index === 0 || Math.abs(value - values[index - 1]) > EPSILON
    ));
}

function signedDoubleArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area;
}

function segmentsHaveCollinearOverlap(start, end, otherStart, otherEnd) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const otherDx = otherEnd.x - otherStart.x;
  const otherDy = otherEnd.y - otherStart.y;
  const cross = dx * otherDy - dy * otherDx;
  const offsetCross = (otherStart.x - start.x) * dy -
    (otherStart.y - start.y) * dx;
  if (Math.abs(cross) > EPSILON || Math.abs(offsetCross) > EPSILON) return false;
  const useX = Math.abs(dx) >= Math.abs(dy);
  const [startValue, endValue] = useX ? [start.x, end.x] : [start.y, end.y];
  const [otherStartValue, otherEndValue] = useX
    ? [otherStart.x, otherEnd.x]
    : [otherStart.y, otherEnd.y];
  const overlap = Math.min(
    Math.max(startValue, endValue),
    Math.max(otherStartValue, otherEndValue)
  ) - Math.max(
    Math.min(startValue, endValue),
    Math.min(otherStartValue, otherEndValue)
  );
  return overlap > EPSILON;
}

function simpleContourIsValid(contour, budget) {
  if (!Array.isArray(contour) || contour.length < 3 || !polygonHasArea(contour, 0)) {
    return false;
  }
  for (let index = 0; index < contour.length; index += 1) {
    if (!budget.consume()) return false;
    const point = contour[index];
    const next = contour[(index + 1) % contour.length];
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) ||
        !Number.isFinite(next?.x) || !Number.isFinite(next?.y) ||
        samePoint(point, next)) {
      return false;
    }
  }
  const edges = contour.map((start, index) => {
    const end = contour[(index + 1) % contour.length];
    return {
      index,
      start,
      end,
      bounds: {
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y)
      }
    };
  });
  const root = buildOrderedSpatialIndex(edges, budget);
  if (!root) return false;
  for (const edge of edges) {
    const candidates = queryOrderedSpatialIndex(root, edge.bounds, budget);
    if (candidates === null) return false;
    for (const candidate of candidates) {
      if (candidate.index <= edge.index) continue;
      const distance = candidate.index - edge.index;
      if (distance === 1 || distance === contour.length - 1) continue;
      if (!budget.consume()) return false;
      if (segmentsHaveCollinearOverlap(
        edge.start,
        edge.end,
        candidate.start,
        candidate.end
      ) ||
          segmentEdgeIntersectionParameters(
            edge.start,
            edge.end,
            candidate.start,
            candidate.end
          ).length > 0) {
        return false;
      }
    }
  }
  return true;
}

function splitBoundaryEdge(edge, otherQuery, budget, selfQuery = null) {
  const candidates = otherQuery.queryEdges(edge.bounds);
  const selfCandidates = selfQuery?.queryEdges(edge.bounds) || [];
  if (candidates === null || selfCandidates === null) {
    return { segments: [], reason: 'selection-complexity-limit-exceeded' };
  }
  const parameters = [0, 1];
  for (const candidate of [...candidates, ...selfCandidates]) {
    if (!budget.consume()) {
      return { segments: [], reason: 'selection-complexity-limit-exceeded' };
    }
    if (candidate === edge) continue;
    parameters.push(...segmentEdgeIntersectionParameters(
      edge.start,
      edge.end,
      candidate.start,
      candidate.end
    ));
  }
  const cuts = uniqueParameters(parameters, budget);
  if (!cuts) {
    return { segments: [], reason: 'selection-complexity-limit-exceeded' };
  }
  const segments = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    if (!budget.consume()) {
      return { segments: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const from = cuts[index];
    const to = cuts[index + 1];
    if (to - from <= EPSILON) continue;
    const start = interpolatePoint(edge.start, edge.end, from);
    const end = interpolatePoint(edge.start, edge.end, to);
    if (!samePoint(start, end)) segments.push({ start, end });
  }
  return { segments, reason: null };
}

function queryClassification(query, point) {
  if (typeof query?.classify !== 'function') return null;
  return query.classify(point);
}

function resultContainsClassifications(fill, polygon, operation) {
  if (fill === 'boundary' || polygon === 'boundary') return 'boundary';
  const fillContains = fill === 'inside';
  const polygonContains = polygon === 'inside';
  return operation === 'difference'
    ? fillContains && !polygonContains
    : fillContains && polygonContains;
}

function localBoundaryClearance(middle, offset, queries, budget) {
  let nearest = Number.POSITIVE_INFINITY;
  const bounds = {
    left: middle.x - offset,
    right: middle.x + offset,
    top: middle.y - offset,
    bottom: middle.y + offset
  };
  for (const query of queries) {
    const candidates = query.queryEdges(bounds);
    if (candidates === null) return null;
    for (const candidate of candidates) {
      if (!budget.consume()) return null;
      if (pointOnSegment(middle, candidate.start, candidate.end)) continue;
      const distance = pointSegmentDistance(middle, candidate.start, candidate.end);
      if (distance > 0) nearest = Math.min(nearest, distance);
    }
  }
  return nearest;
}

function orientResultBoundarySegments(
  segment,
  fillQuery,
  polygonQuery,
  operations,
  quantum,
  budget
) {
  if (!budget.consume()) {
    return { segments: {}, reason: 'selection-complexity-limit-exceeded' };
  }
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy);
  if (length <= quantum) {
    return { segments: {}, reason: null };
  }
  const middle = midpoint(segment.start, segment.end);
  const coordinateScale = Math.max(1, Math.abs(middle.x), Math.abs(middle.y));
  const minimumOffset = Math.max(
    Number.EPSILON * coordinateScale * 64,
    EPSILON * 4 / Math.max(1, length),
    quantum
  );
  let offset = Math.max(minimumOffset, Math.min(
    length * 0.2,
    Math.max(quantum * 16, EPSILON * 16 / Math.max(1, length))
  ));
  const nearest = localBoundaryClearance(
    middle,
    offset,
    [fillQuery, polygonQuery],
    budget
  );
  if (nearest === null) {
    return { segments: {}, reason: 'selection-complexity-limit-exceeded' };
  }
  if (Number.isFinite(nearest)) {
    offset = Math.min(
      offset,
      Math.max(minimumOffset, nearest / 4)
    );
  }
  const certifiedOffset = offset;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (!budget.consume()) {
      return { segments: {}, reason: 'selection-complexity-limit-exceeded' };
    }
    const normalX = -dy / length * offset;
    const normalY = dx / length * offset;
    const leftPoint = {
      x: middle.x + normalX,
      y: middle.y + normalY
    };
    const rightPoint = {
      x: middle.x - normalX,
      y: middle.y - normalY
    };
    const leftFill = queryClassification(fillQuery, leftPoint);
    const leftPolygon = queryClassification(polygonQuery, leftPoint);
    const rightFill = queryClassification(fillQuery, rightPoint);
    const rightPolygon = queryClassification(polygonQuery, rightPoint);
    if ([leftFill, leftPolygon, rightFill, rightPolygon].includes(null)) {
      return { segments: {}, reason: 'selection-complexity-limit-exceeded' };
    }
    const sourceOffBoundary = ![
      leftFill,
      leftPolygon,
      rightFill,
      rightPolygon
    ].includes('boundary');
    if (sourceOffBoundary) {
      const oriented = {};
      for (const operation of operations) {
        const leftContains = resultContainsClassifications(
          leftFill,
          leftPolygon,
          operation
        );
        const rightContains = resultContainsClassifications(
          rightFill,
          rightPolygon,
          operation
        );
        if (leftContains === rightContains) continue;
        oriented[operation] = leftContains
          ? segment
          : { start: segment.end, end: segment.start };
      }
      if (Object.keys(oriented).length > 0) {
        return { segments: oriented, reason: null };
      }
    }
    if (sourceOffBoundary && certifiedOffset !== null &&
        offset <= certifiedOffset + Number.EPSILON) {
      return { segments: {}, reason: null };
    }
    if (offset <= minimumOffset) {
      return {
        segments: {},
        reason: sourceOffBoundary ? null : 'selection-geometry-unavailable'
      };
    }
    offset = Math.max(minimumOffset, offset / 4);
  }
  return { segments: {}, reason: 'selection-geometry-unavailable' };
}

function quantizationScale(fillQuery, polygonQuery, tolerance) {
  const values = [
    fillQuery.bounds?.left,
    fillQuery.bounds?.right,
    fillQuery.bounds?.top,
    fillQuery.bounds?.bottom,
    polygonQuery.bounds?.left,
    polygonQuery.bounds?.right,
    polygonQuery.bounds?.top,
    polygonQuery.bounds?.bottom
  ].filter(Number.isFinite);
  const coordinateScale = Math.max(1, ...values.map(Math.abs));
  return Math.max(
    coordinateScale * Number.EPSILON * 64,
    Math.max(Number.EPSILON, tolerance) * 1e-5
  );
}

function vertexKey(point, quantum) {
  const x = Math.round(point.x / quantum);
  const y = Math.round(point.y / quantum);
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return `${x}:${y}`;
}

function buildBoundaryLoops(segments, quantum, budget) {
  const vertices = new Map();
  const directed = [];
  const directedKeys = new Set();
  for (const segment of segments) {
    if (!budget.consume()) {
      return { loops: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const startKey = vertexKey(segment.start, quantum);
    const endKey = vertexKey(segment.end, quantum);
    if (!startKey || !endKey || startKey === endKey) {
      return { loops: [], reason: 'selection-geometry-unavailable' };
    }
    for (const [key, point] of [[startKey, segment.start], [endKey, segment.end]]) {
      const vertex = vertices.get(key);
      if (vertex && Math.hypot(vertex.point.x - point.x, vertex.point.y - point.y) > quantum * 2) {
        return { loops: [], reason: 'selection-geometry-unavailable' };
      }
      if (!vertex) {
        vertices.set(key, {
          point: { x: point.x, y: point.y },
          incoming: [],
          outgoing: []
        });
      }
    }
    const edgeKey = `${startKey}>${endKey}`;
    const reverseKey = `${endKey}>${startKey}`;
    if (directedKeys.has(edgeKey)) continue;
    if (directedKeys.has(reverseKey)) {
      return { loops: [], reason: 'selection-geometry-unavailable' };
    }
    const edge = {
      index: directed.length,
      startKey,
      endKey,
      used: false,
      successor: null
    };
    directedKeys.add(edgeKey);
    directed.push(edge);
    vertices.get(startKey).outgoing.push(edge);
    vertices.get(endKey).incoming.push(edge);
  }
  if (directed.length === 0) return { loops: [], reason: null };
  for (const vertex of vertices.values()) {
    if (vertex.incoming.length === 0 ||
        vertex.incoming.length !== vertex.outgoing.length) {
      return { loops: [], reason: 'selection-geometry-unavailable' };
    }
    const degree = vertex.outgoing.length;
    const logicalSortCost = degree *
      (Math.ceil(Math.log2(degree + 1)) + 2);
    if (!budget.consume(logicalSortCost)) {
      return { loops: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const outgoing = [...vertex.outgoing].sort((left, right) => {
      const leftEnd = vertices.get(left.endKey).point;
      const rightEnd = vertices.get(right.endKey).point;
      const leftAngle = Math.atan2(
        leftEnd.y - vertex.point.y,
        leftEnd.x - vertex.point.x
      );
      const rightAngle = Math.atan2(
        rightEnd.y - vertex.point.y,
        rightEnd.x - vertex.point.x
      );
      return leftAngle - rightAngle || left.index - right.index;
    });
    const assigned = new Set();
    for (const incoming of vertex.incoming) {
      if (!budget.consume(degree)) {
        return { loops: [], reason: 'selection-complexity-limit-exceeded' };
      }
      const incomingStart = vertices.get(incoming.startKey).point;
      const reverseAngle = Math.atan2(
        incomingStart.y - vertex.point.y,
        incomingStart.x - vertex.point.x
      );
      let successor = null;
      let bestClockwiseTurn = Number.POSITIVE_INFINITY;
      for (const candidate of outgoing) {
        let clockwiseTurn = reverseAngle - Math.atan2(
          vertices.get(candidate.endKey).point.y - vertex.point.y,
          vertices.get(candidate.endKey).point.x - vertex.point.x
        );
        while (clockwiseTurn < 0) clockwiseTurn += Math.PI * 2;
        while (clockwiseTurn >= Math.PI * 2) clockwiseTurn -= Math.PI * 2;
        if (clockwiseTurn < bestClockwiseTurn - Number.EPSILON ||
            (Math.abs(clockwiseTurn - bestClockwiseTurn) <= Number.EPSILON &&
             candidate.index < (successor?.index ?? Number.POSITIVE_INFINITY))) {
          successor = candidate;
          bestClockwiseTurn = clockwiseTurn;
        }
      }
      if (!successor || assigned.has(successor)) {
        return { loops: [], reason: 'selection-geometry-unavailable' };
      }
      assigned.add(successor);
      incoming.successor = successor;
    }
    if (assigned.size !== degree) {
      return { loops: [], reason: 'selection-geometry-unavailable' };
    }
  }

  const loops = [];
  for (const edge of directed) {
    if (edge.used) continue;
    const loop = [];
    const firstKey = edge.startKey;
    let current = edge;
    while (!current.used) {
      if (!budget.consume()) {
        return { loops: [], reason: 'selection-complexity-limit-exceeded' };
      }
      current.used = true;
      loop.push(vertices.get(current.startKey).point);
      current = current.successor;
      if (!current) return { loops: [], reason: 'selection-geometry-unavailable' };
    }
    if (current !== edge || edge.startKey !== firstKey || loop.length < 3 ||
        !simpleContourIsValid(loop, budget) ||
        Math.abs(signedDoubleArea(loop)) <= quantum * quantum) {
      return { loops: [], reason: 'selection-geometry-unavailable' };
    }
    loops.push(loop);
  }
  if (directed.some(edge => !edge.used)) {
    return { loops: [], reason: 'selection-geometry-unavailable' };
  }
  return { loops, reason: null };
}

function classifyPointInContour(point, contour, budget) {
  if (!budget.consume(contour.length)) return null;
  let inside = false;
  for (let index = 0; index < contour.length; index += 1) {
    const start = contour[index];
    const end = contour[(index + 1) % contour.length];
    if (pointOnSegment(point, start, end)) return 'boundary';
    const crossesRay = (end.y > point.y) !== (start.y > point.y);
    if (!crossesRay) continue;
    const crossingX = (start.x - end.x) *
      (point.y - end.y) / (start.y - end.y) + end.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

function strictContourContainment(child, candidate, budget) {
  for (const point of child) {
    const classification = classifyPointInContour(point, candidate, budget);
    if (classification === null) {
      return {
        contained: false,
        reason: 'selection-complexity-limit-exceeded'
      };
    }
    if (classification === 'boundary') continue;
    return { contained: classification === 'inside', reason: null };
  }
  return { contained: false, reason: 'selection-geometry-unavailable' };
}

function groupBoundaryLoops(loops, budget) {
  const nodes = [];
  for (const contour of loops) {
    if (!budget.consume()) {
      return { components: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const area = signedDoubleArea(contour);
    if (area === 0) return { components: [], reason: 'selection-geometry-unavailable' };
    nodes.push({
      contour,
      signedArea: area,
      area: Math.abs(area),
      parent: -1,
      depth: -1,
      component: null
    });
  }

  for (let childIndex = 0; childIndex < nodes.length; childIndex += 1) {
    const child = nodes[childIndex];
    let parentIndex = -1;
    for (let candidateIndex = 0; candidateIndex < nodes.length; candidateIndex += 1) {
      if (candidateIndex === childIndex) continue;
      const candidate = nodes[candidateIndex];
      if (candidate.area <= child.area + EPSILON) continue;
      const containment = strictContourContainment(
        child.contour,
        candidate.contour,
        budget
      );
      if (containment.reason) {
        return { components: [], reason: containment.reason };
      }
      if (!containment.contained) continue;
      if (parentIndex < 0 || candidate.area < nodes[parentIndex].area) {
        parentIndex = candidateIndex;
      }
    }
    child.parent = parentIndex;
  }

  const resolveDepth = nodeIndex => {
    const visited = new Set();
    let current = nodeIndex;
    let depth = 0;
    while (nodes[current].parent >= 0) {
      if (!budget.consume() || visited.has(current)) return null;
      visited.add(current);
      current = nodes[current].parent;
      depth += 1;
      if (depth > nodes.length) return null;
    }
    return depth;
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const depth = resolveDepth(index);
    if (depth === null) {
      return {
        components: [],
        reason: budget.limitExceeded
          ? 'selection-complexity-limit-exceeded'
          : 'selection-geometry-unavailable'
      };
    }
    nodes[index].depth = depth;
    const expectsPositiveArea = depth % 2 === 0;
    if ((nodes[index].signedArea > 0) !== expectsPositiveArea) {
      return { components: [], reason: 'selection-geometry-unavailable' };
    }
  }

  const components = [];
  for (const node of nodes) {
    if (node.depth % 2 !== 0) continue;
    node.component = { contours: [node.contour] };
    components.push(node.component);
  }
  for (const node of nodes) {
    if (node.depth % 2 === 0) continue;
    const parent = nodes[node.parent];
    if (!parent?.component) {
      return { components: [], reason: 'selection-geometry-unavailable' };
    }
    parent.component.contours.push(node.contour);
  }
  return { components, reason: null };
}

function clipPathFillOperations(fillQuery, polygonQuery, operations, options = {}) {
  const budget = options.budget;
  const operationResults = Object.fromEntries(
    operations.map(operation => [operation, { components: [], reason: null }])
  );
  const failAll = reason => Object.fromEntries(
    operations.map(operation => [operation, { components: [], reason }])
  );
  if (!budget || !fillQuery?.geometry || !polygonQuery?.polygon ||
      !Array.isArray(fillQuery.geometry.contours) ||
      fillQuery.geometry.contours.length === 0 ||
      fillQuery.geometry.contours.some(contour => (
        !Array.isArray(contour) ||
        contour.length < 3 ||
        contour.some(point => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))
      )) ||
      (options.polygonValidated !== true &&
       !simpleContourIsValid(polygonQuery.polygon, budget))) {
    return failAll(budget?.limitExceeded
      ? 'selection-complexity-limit-exceeded'
      : 'selection-geometry-unavailable');
  }
  const quantum = quantizationScale(
    fillQuery,
    polygonQuery,
    fillQuery.geometry.tolerance
  );
  const atomic = Object.fromEntries(operations.map(operation => [operation, []]));
  const collect = (edges, otherQuery, selfQuery = null) => {
    for (const edge of edges) {
      const split = splitBoundaryEdge(edge, otherQuery, budget, selfQuery);
      if (split.reason) return split.reason;
      for (const segment of split.segments) {
        const oriented = orientResultBoundarySegments(
          segment,
          fillQuery,
          polygonQuery,
          operations,
          quantum,
          budget
        );
        if (oriented.reason) return oriented.reason;
        for (const operation of operations) {
          const resultSegment = oriented.segments[operation];
          if (!resultSegment) continue;
          atomic[operation].push(resultSegment);
          if (atomic[operation].length > DEFAULT_MAX_FLATTENED_SEGMENTS) {
            return 'selection-complexity-limit-exceeded';
          }
        }
      }
    }
    return null;
  };
  const fillReason = collect(fillQuery.edges, polygonQuery, fillQuery);
  if (fillReason) return failAll(fillReason);
  const polygonReason = collect(polygonQuery.edges, fillQuery);
  if (polygonReason) return failAll(polygonReason);
  for (const operation of operations) {
    options.operationObserver?.(operation, 'start');
    const loopResult = buildBoundaryLoops(atomic[operation], quantum, budget);
    if (loopResult.reason) {
      return failAll(budget.limitExceeded
        ? 'selection-complexity-limit-exceeded'
        : loopResult.reason);
    }
    const grouped = groupBoundaryLoops(loopResult.loops, budget);
    if (grouped.reason) {
      return failAll(budget.limitExceeded
        ? 'selection-complexity-limit-exceeded'
        : grouped.reason);
    }
    operationResults[operation] = {
      components: grouped.components,
      reason: null
    };
    options.operationObserver?.(operation, 'complete');
  }
  return operationResults;
}

function clipSimplePathFill(fillQuery, polygonQuery, options = {}) {
  const operation = options.operation === 'difference' ? 'difference' : 'intersection';
  return clipPathFillOperations(fillQuery, polygonQuery, [operation], options)[operation];
}

function clipSimplePathFillPair(fillQuery, polygonQuery, options = {}) {
  return clipPathFillOperations(
    fillQuery,
    polygonQuery,
    ['difference', 'intersection'],
    options
  );
}

function contourPathData(contours) {
  if (!Array.isArray(contours) || contours.length === 0) return null;
  const commands = [];
  for (const contour of contours) {
    if (!Array.isArray(contour) || contour.length < 3) return null;
    commands.push(`M ${contour[0].x} ${contour[0].y}`);
    for (let index = 1; index < contour.length; index += 1) {
      commands.push(`L ${contour[index].x} ${contour[index].y}`);
    }
    commands.push('Z');
  }
  return commands.join(' ');
}

function createComponentFillQuery(component, budget) {
  if (!budget || !Array.isArray(component?.contours) ||
      component.contours.length === 0 ||
      component.contours.some(contour => !Array.isArray(contour) || contour.length < 3)) {
    return { query: null, reason: 'selection-geometry-unavailable' };
  }
  const edgeCount = component.contours.reduce(
    (count, contour) => count + contour.length,
    0
  );
  if (edgeCount > DEFAULT_MAX_FLATTENED_SEGMENTS) {
    return { query: null, reason: 'selection-complexity-limit-exceeded' };
  }
  const edges = [];
  for (const contour of component.contours) {
    for (let index = 0; index < contour.length; index += 1) {
      if (!budget.consume()) {
        return { query: null, reason: 'selection-complexity-limit-exceeded' };
      }
      const start = contour[index];
      const end = contour[(index + 1) % contour.length];
      if (!Number.isFinite(start?.x) || !Number.isFinite(start?.y) ||
          !Number.isFinite(end?.x) || !Number.isFinite(end?.y) ||
          samePoint(start, end)) {
        return { query: null, reason: 'selection-geometry-unavailable' };
      }
      edges.push({
        index: edges.length,
        start,
        end,
        bounds: {
          left: Math.min(start.x, end.x),
          right: Math.max(start.x, end.x),
          top: Math.min(start.y, end.y),
          bottom: Math.max(start.y, end.y)
        }
      });
    }
  }
  const root = buildOrderedSpatialIndex(edges, budget);
  if (!root) {
    return {
      query: null,
      reason: budget.limitExceeded
        ? 'selection-complexity-limit-exceeded'
        : 'selection-geometry-unavailable'
    };
  }
  const query = createPathFillQuery({
    contours: component.contours,
    edges,
    root,
    bounds: boundsForPoints(component.contours.flat()),
    fillRule: 'evenodd',
    tolerance: Number.EPSILON
  }, budget);
  return {
    query,
    reason: query ? null : 'selection-geometry-unavailable'
  };
}

function centerlineIntervalsInsideComponent(component, centerline, options = {}) {
  const budget = options.budget;
  if (!budget || !Array.isArray(component?.contours) ||
      !Array.isArray(centerline?.segments)) {
    return { intervals: [], reason: 'selection-geometry-unavailable' };
  }
  const componentFill = createComponentFillQuery(component, budget);
  if (!componentFill.query) {
    return { intervals: [], reason: componentFill.reason };
  }
  const intervals = [];
  let previousSegment = null;
  let previousInside = null;
  for (const segment of centerline.segments) {
    const parameters = [0, 1];
    const candidates = componentFill.query.queryEdges(segment.bounds);
    if (candidates === null) {
      return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
    }
    for (const candidate of candidates) {
      if (!budget.consume()) {
        return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
      }
      parameters.push(...segmentEdgeIntersectionParameters(
        segment.start,
        segment.end,
        candidate.start,
        candidate.end
      ));
    }
    const cuts = uniqueParameters(parameters, budget);
    if (!cuts) {
      return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const continuous = previousSegment &&
      samePoint(previousSegment.end, segment.start) &&
      Math.abs(
        previousSegment.end.sourcePosition - segment.start.sourcePosition
      ) <= EPSILON;
    let segmentEndInside = null;
    for (let index = 0; index < cuts.length - 1; index += 1) {
      if (!budget.consume()) {
        return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
      }
      const from = cuts[index];
      const to = cuts[index + 1];
      if (to - from <= EPSILON) continue;
      const canCarry = candidates.length === 0 &&
        continuous &&
        previousInside !== null;
      const contained = canCarry
        ? previousInside
        : componentFill.query.contains(interpolatePoint(
          segment.start,
          segment.end,
          (from + to) / 2
        ));
      if (contained === null) {
        return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
      }
      segmentEndInside = contained;
      if (!contained) continue;
      const start = segment.start.sourcePosition +
        (segment.end.sourcePosition - segment.start.sourcePosition) * from;
      const end = segment.start.sourcePosition +
        (segment.end.sourcePosition - segment.start.sourcePosition) * to;
      if (end - start > EPSILON) intervals.push([start, end]);
    }
    previousSegment = segment;
    previousInside = segmentEndInside;
  }
  const mergeCost = intervals.length *
    (Math.ceil(Math.log2(intervals.length + 1)) + 2);
  if (!budget.consume(mergeCost)) {
    return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
  }
  return { intervals: mergeSourceIntervals(intervals), reason: null };
}

function squaredDistanceToBounds(point, bounds) {
  const dx = point.x < bounds.left
    ? bounds.left - point.x
    : point.x > bounds.right
      ? point.x - bounds.right
      : 0;
  const dy = point.y < bounds.top
    ? bounds.top - point.y
    : point.y > bounds.bottom
      ? point.y - bounds.bottom
      : 0;
  return dx * dx + dy * dy;
}

function projectPointToSegment(point, segment) {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const amount = lengthSquared <= EPSILON
    ? 0
    : Math.min(1, Math.max(0, (
      (point.x - segment.start.x) * dx +
      (point.y - segment.start.y) * dy
    ) / lengthSquared));
  const projected = interpolatePoint(segment.start, segment.end, amount);
  return {
    distance: Math.hypot(point.x - projected.x, point.y - projected.y),
    sourcePosition: segment.start.sourcePosition +
      (segment.end.sourcePosition - segment.start.sourcePosition) * amount,
    segmentIndex: segment.index
  };
}

function projectPointToCenterline(point, centerline, options = {}) {
  const budget = options.budget;
  if (!budget || !centerline?.root) {
    return { candidates: [], reason: 'selection-geometry-unavailable' };
  }
  const distanceTolerance = Math.max(
    Number.EPSILON,
    Number(options.distanceTolerance) || 0.25
  );
  const maxCandidates = Math.max(2, Math.trunc(Number(options.maxCandidates) || 64));
  let bestDistance = Number.POSITIVE_INFINITY;
  let candidates = [];
  const stack = [centerline.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!budget.consume()) {
      return { candidates: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const maximumDistance = bestDistance + distanceTolerance;
    if (squaredDistanceToBounds(point, node.bounds) > maximumDistance * maximumDistance) {
      continue;
    }
    if (node.edges) {
      for (const segment of node.edges) {
        if (!budget.consume()) {
          return { candidates: [], reason: 'selection-complexity-limit-exceeded' };
        }
        const candidate = projectPointToSegment(point, segment);
        if (candidate.distance < bestDistance - distanceTolerance) {
          bestDistance = candidate.distance;
          candidates = [candidate];
        } else if (candidate.distance <= bestDistance + distanceTolerance) {
          bestDistance = Math.min(bestDistance, candidate.distance);
          candidates.push(candidate);
        }
      }
      continue;
    }
    const children = [node.left, node.right].filter(Boolean)
      .sort((left, right) => (
        squaredDistanceToBounds(point, right.bounds) -
        squaredDistanceToBounds(point, left.bounds)
      ));
    stack.push(...children);
  }
  const candidateSortCost = candidates.length *
    (Math.ceil(Math.log2(candidates.length + 1)) + 2);
  if (!budget.consume(candidateSortCost)) {
    return { candidates: [], reason: 'selection-complexity-limit-exceeded' };
  }
  candidates = candidates
    .filter(candidate => candidate.distance <= bestDistance + distanceTolerance)
    .sort((left, right) => (
      left.sourcePosition - right.sourcePosition ||
      left.segmentIndex - right.segmentIndex
    ));
  const unique = candidates.filter((candidate, index, values) => (
    index === 0 ||
    candidate.segmentIndex !== values[index - 1].segmentIndex ||
    Math.abs(candidate.sourcePosition - values[index - 1].sourcePosition) > EPSILON
  ));
  if (unique.length === 0 || unique.length > maxCandidates) {
    return { candidates: [], reason: 'selection-geometry-unavailable' };
  }
  return { candidates: unique, reason: null };
}

function candidateSetsConnect(left, middle, right, budget) {
  const connects = (source, target) => {
    for (const candidate of source) {
      let matched = false;
      for (const other of target) {
        if (!budget.consume()) return null;
        if (Math.abs(candidate.segmentIndex - other.segmentIndex) <= 2) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return true;
  };
  for (const [source, target] of [
    [left, middle],
    [middle, left],
    [middle, right],
    [right, middle]
  ]) {
    const connected = connects(source, target);
    if (connected === null) return null;
    if (!connected) return false;
  }
  return true;
}

function projectBoundarySegment(segment, centerline, options, samples) {
  const projectAt = amount => {
    const point = interpolatePoint(segment.start, segment.end, amount);
    return projectPointToCenterline(point, centerline, options);
  };
  const start = projectAt(0);
  const end = projectAt(1);
  if (start.reason || end.reason) return { reason: start.reason || end.reason };
  const stack = [{ from: 0, to: 1, start, end, depth: 0 }];
  const ordered = [{ amount: 0, candidates: start.candidates }];
  while (stack.length > 0) {
    const section = stack.pop();
    const middleAmount = (section.from + section.to) / 2;
    const middle = projectAt(middleAmount);
    if (middle.reason) return { reason: middle.reason };
    const connected = candidateSetsConnect(
      section.start.candidates,
      middle.candidates,
      section.end.candidates,
      options.budget
    );
    if (connected === null) return { reason: 'selection-complexity-limit-exceeded' };
    if (!connected && section.depth >= 12) {
      return { reason: 'selection-geometry-unavailable' };
    }
    if (!connected) {
      const depth = section.depth + 1;
      stack.push(
        {
          from: middleAmount,
          to: section.to,
          start: middle,
          end: section.end,
          depth
        },
        {
          from: section.from,
          to: middleAmount,
          start: section.start,
          end: middle,
          depth
        }
      );
      continue;
    }
    ordered.push(
      { amount: middleAmount, candidates: middle.candidates },
      { amount: section.to, candidates: section.end.candidates }
    );
  }
  const orderedSortCost = ordered.length *
    (Math.ceil(Math.log2(ordered.length + 1)) + 2);
  if (!options.budget.consume(orderedSortCost)) {
    return { reason: 'selection-complexity-limit-exceeded' };
  }
  ordered.sort((left, right) => left.amount - right.amount);
  for (const sample of ordered) {
    const previous = samples.at(-1);
    if (!previous || Math.abs(previous.amount - sample.amount) > EPSILON) {
      samples.push(sample);
    }
  }
  return { reason: null };
}

function branchIntervalsFromSamples(samples, budget) {
  let branches = [];
  const completed = [];
  for (const sample of samples) {
    if (!budget.consume(sample.candidates.length + branches.length)) {
      return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
    }
    const available = [...sample.candidates];
    const nextBranches = [];
    for (const branch of branches) {
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < available.length; index += 1) {
        if (!budget.consume()) {
          return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
        }
        const distance = Math.abs(available[index].segmentIndex - branch.segmentIndex);
        if (distance <= 2 && distance < bestDistance) {
          bestIndex = index;
          bestDistance = distance;
        }
      }
      if (bestIndex < 0) {
        completed.push(branch);
        continue;
      }
      const candidate = available.splice(bestIndex, 1)[0];
      nextBranches.push({
        segmentIndex: candidate.segmentIndex,
        minimum: Math.min(branch.minimum, candidate.sourcePosition),
        maximum: Math.max(branch.maximum, candidate.sourcePosition),
        count: branch.count + 1
      });
    }
    for (const candidate of available) {
      nextBranches.push({
        segmentIndex: candidate.segmentIndex,
        minimum: candidate.sourcePosition,
        maximum: candidate.sourcePosition,
        count: 1
      });
    }
    branches = nextBranches;
  }
  completed.push(...branches);
  return {
    intervals: completed
      .filter(branch => branch.count >= 2 && branch.maximum - branch.minimum > EPSILON)
      .map(branch => [branch.minimum, branch.maximum]),
    reason: null
  };
}

function mergeSourceIntervals(intervals) {
  const ordered = intervals
    .filter(interval => (
      Array.isArray(interval) &&
      Number.isFinite(interval[0]) &&
      Number.isFinite(interval[1]) &&
      interval[1] - interval[0] > EPSILON
    ))
    .sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1] + EPSILON) {
      merged.push([...interval]);
    } else {
      previous[1] = Math.max(previous[1], interval[1]);
    }
  }
  return merged;
}

function projectRetainedBoundaryToSourceIntervals(segments, centerline, options = {}) {
  if (!Array.isArray(segments) || !centerline?.root || !options.budget) {
    return { intervals: [], reason: 'selection-geometry-unavailable' };
  }
  const intervals = [];
  for (const segment of segments) {
    const samples = [];
    const projected = projectBoundarySegment(segment, centerline, options, samples);
    if (projected.reason) return { intervals: [], reason: projected.reason };
    const branches = branchIntervalsFromSamples(samples, options.budget);
    if (branches.reason) return branches;
    intervals.push(...branches.intervals);
  }
  const mergeCost = intervals.length *
    (Math.ceil(Math.log2(intervals.length + 1)) + 2);
  if (!options.budget.consume(mergeCost)) {
    return { intervals: [], reason: 'selection-complexity-limit-exceeded' };
  }
  return { intervals: mergeSourceIntervals(intervals), reason: null };
}

function sourcePositionToIndex(sourcePositions, value, endBoundary) {
  if (!Array.isArray(sourcePositions) || sourcePositions.length < 2 ||
      !Number.isFinite(value)) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, value));
  if (clamped <= EPSILON) {
    if (!endBoundary) return 0;
    let index = 0;
    while (index + 1 < sourcePositions.length &&
        Math.abs(sourcePositions[index + 1]) <= EPSILON) {
      index += 1;
    }
    return index;
  }
  if (clamped >= 1 - EPSILON) {
    if (endBoundary) return sourcePositions.length - 1;
    let index = sourcePositions.length - 1;
    while (index > 0 && Math.abs(sourcePositions[index - 1] - 1) <= EPSILON) {
      index -= 1;
    }
    return index;
  }
  let low = 0;
  let high = sourcePositions.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (sourcePositions[middle] < clamped) low = middle;
    else high = middle;
  }
  if (Math.abs(sourcePositions[high] - clamped) <= EPSILON) {
    let index = high;
    if (endBoundary) {
      while (index + 1 < sourcePositions.length &&
          Math.abs(sourcePositions[index + 1] - clamped) <= EPSILON) {
        index += 1;
      }
    } else {
      while (index > 0 &&
          Math.abs(sourcePositions[index - 1] - clamped) <= EPSILON) {
        index -= 1;
      }
    }
    return index;
  }
  const span = sourcePositions[high] - sourcePositions[low];
  if (span <= EPSILON) return endBoundary ? high : low;
  return low + (clamped - sourcePositions[low]) / span;
}

function sourceIntervalsToIndexIntervals(intervals, centerline) {
  if (!Array.isArray(intervals) || !Array.isArray(centerline?.sourcePositions)) {
    return null;
  }
  const converted = [];
  for (const interval of intervals) {
    const start = sourcePositionToIndex(centerline.sourcePositions, interval?.[0], false);
    const end = sourcePositionToIndex(centerline.sourcePositions, interval?.[1], true);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + EPSILON) {
      continue;
    }
    converted.push([start, end]);
  }
  return mergeSourceIntervals(converted);
}

function interpolateInputPoint(start, end, amount, pressure) {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
    pressure
  };
}

function sameStrokePointGeometry(left, right) {
  return left && right &&
    Object.is(left.point?.[0], right.point?.[0]) &&
    Object.is(left.point?.[1], right.point?.[1]) &&
    Object.is(left.vector?.[0], right.vector?.[0]) &&
    Object.is(left.vector?.[1], right.vector?.[1]) &&
    Object.is(left.distance, right.distance) &&
    Object.is(left.runningLength, right.runningLength);
}

function lowerBoundSourceSegment(segments, sourcePosition) {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle].end.sourcePosition < sourcePosition) low = middle + 1;
    else high = middle;
  }
  return Math.min(segments.length - 1, Math.max(0, low));
}

function spatialSourcePosition(
  point,
  markerSourcePosition,
  sourceSegments,
  previousSourcePosition,
  previousSegmentIndex
) {
  if (sourceSegments.length === 0) return 0;
  const markerIndex = lowerBoundSourceSegment(sourceSegments, markerSourcePosition);
  const indexes = new Set();
  for (const center of [markerIndex, previousSegmentIndex]) {
    for (let offset = -8; offset <= 8; offset += 1) {
      const index = center + offset;
      if (index >= 0 && index < sourceSegments.length) indexes.add(index);
    }
  }
  let best = null;
  for (const index of indexes) {
    const candidate = projectPointToSegment(point, sourceSegments[index]);
    if (candidate.sourcePosition < previousSourcePosition - EPSILON) continue;
    const markerDistance = Math.abs(candidate.sourcePosition - markerSourcePosition);
    if (!best ||
        candidate.distance < best.distance - EPSILON ||
        (Math.abs(candidate.distance - best.distance) <= EPSILON &&
         markerDistance < best.markerDistance - EPSILON)) {
      best = { ...candidate, markerDistance, segmentIndex: index };
    }
  }
  return best;
}

function createSmoothedCenterlineGeometry(sourcePoints, options = {}) {
  const budget = options.budget;
  if (!budget || typeof budget.consume !== 'function' ||
      !Array.isArray(sourcePoints) || sourcePoints.length === 0) {
    return { geometry: null, reason: 'selection-geometry-unavailable' };
  }
  const operationsBefore = budget.operations;
  if (!budget.consume(sourcePoints.length * 2)) {
    return { geometry: null, reason: 'selection-complexity-limit-exceeded' };
  }
  const normalized = [];
  for (const sourcePoint of sourcePoints) {
    const point = finitePoint(sourcePoint?.x, sourcePoint?.y);
    const pressure = Number(sourcePoint?.pressure);
    if (!point || !Number.isFinite(pressure)) {
      return { geometry: null, reason: 'selection-geometry-unavailable' };
    }
    normalized.push({
      ...point,
      pressure: Math.min(1, Math.max(0, pressure))
    });
  }
  const pfOptions = {
    size: Math.max(1e-5, Number(options.size) || 16),
    streamline: Number.isFinite(Number(options.streamline))
      ? Number(options.streamline)
      : 0.5,
    last: options.last !== false
  };
  const sourceDistances = [0];
  for (let index = 1; index < normalized.length; index += 1) {
    sourceDistances.push(
      sourceDistances[index - 1] +
      Math.hypot(
        normalized[index].x - normalized[index - 1].x,
        normalized[index].y - normalized[index - 1].y
      )
    );
  }
  const totalSourceLength = sourceDistances.at(-1) || 0;
  const sourcePositions = sourceDistances.map(distance => (
    totalSourceLength > EPSILON ? distance / totalSourceLength : 0
  ));
  const sourceSegments = [];
  let maximumSourceGap = 0;
  for (let index = 0; index < normalized.length - 1; index += 1) {
    if (samePoint(normalized[index], normalized[index + 1])) continue;
    const length = Math.hypot(
      normalized[index + 1].x - normalized[index].x,
      normalized[index + 1].y - normalized[index].y
    );
    maximumSourceGap = Math.max(maximumSourceGap, length);
    sourceSegments.push({
      index: sourceSegments.length,
      start: {
        ...normalized[index],
        sourcePosition: sourcePositions[index]
      },
      end: {
        ...normalized[index + 1],
        sourcePosition: sourcePositions[index + 1]
      }
    });
  }
  const actualInputs = normalized;
  let markerInputs;
  if (normalized.length === 1) {
    markerInputs = [{ ...normalized[0], pressure: 0 }];
  } else if (normalized.length === 2) {
    markerInputs = Array.from({ length: 5 }, (_value, index) => {
      const amount = index / 4;
      const sourcePosition = sourcePositions[0] +
        (sourcePositions[1] - sourcePositions[0]) * amount;
      return interpolateInputPoint(normalized[0], normalized[1], amount, sourcePosition);
    });
  } else {
    markerInputs = normalized.map((point, index) => ({
      ...point,
      pressure: sourcePositions[index]
    }));
  }

  let actual;
  let markers;
  try {
    const { getStrokePoints } = require('perfect-freehand');
    actual = getStrokePoints(actualInputs, pfOptions);
    markers = getStrokePoints(markerInputs, pfOptions);
  } catch (_error) {
    return { geometry: null, reason: 'selection-geometry-unavailable' };
  }
  if (!Array.isArray(actual) || actual.length === 0 ||
      actual.length !== markers?.length ||
      actual.some((point, index) => !sameStrokePointGeometry(point, markers[index]))) {
    return { geometry: null, reason: 'selection-geometry-unavailable' };
  }

  const points = [];
  let previousPosition = Number.NEGATIVE_INFINITY;
  let previousSourceSegmentIndex = 0;
  const useMarkerProvenance = maximumSourceGap <= pfOptions.size * 2;
  for (let index = 0; index < actual.length; index += 1) {
    if (!budget.consume()) {
      return { geometry: null, reason: 'selection-complexity-limit-exceeded' };
    }
    const markerSourcePosition = Number(markers[index].pressure);
    const point = finitePoint(actual[index].point?.[0], actual[index].point?.[1]);
    const spatial = !useMarkerProvenance && point
      ? spatialSourcePosition(
        point,
        markerSourcePosition,
        sourceSegments,
        Math.max(0, previousPosition),
        previousSourceSegmentIndex
      )
      : null;
    const sourcePosition = spatial?.sourcePosition ?? markerSourcePosition;
    if (spatial) previousSourceSegmentIndex = spatial.segmentIndex;
    if (!point || !Number.isFinite(markerSourcePosition) ||
        !Number.isFinite(sourcePosition) ||
        sourcePosition < previousPosition - EPSILON ||
        sourcePosition < -EPSILON ||
        sourcePosition > 1 + EPSILON) {
      return { geometry: null, reason: 'selection-geometry-unavailable' };
    }
    previousPosition = sourcePosition;
    points.push({ ...point, sourcePosition });
  }
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (samePoint(start, end)) continue;
    segments.push({
      index: segments.length,
      start,
      end,
      bounds: {
        left: Math.min(start.x, end.x),
        right: Math.max(start.x, end.x),
        top: Math.min(start.y, end.y),
        bottom: Math.max(start.y, end.y)
      }
    });
  }
  if (segments.length === 0) {
    return {
      geometry: freezeCenterlineGeometry({
        points,
        segments,
        root: null,
        bounds: boundsForPoints(points),
        sourceDistances,
        sourcePositions,
        totalSourceLength,
        logicalBuildCost: budget.operations - operationsBefore
      }),
      reason: null
    };
  }
  const root = buildOrderedSpatialIndex(segments, budget);
  if (!root) return { geometry: null, reason: 'selection-complexity-limit-exceeded' };
  return {
    geometry: freezeCenterlineGeometry({
      points,
      segments,
      root,
      bounds: boundsForPoints(points),
      sourceDistances,
      sourcePositions,
      totalSourceLength,
      logicalBuildCost: budget.operations - operationsBefore
    }),
    reason: null
  };
}

module.exports = {
  flattenFabricPath,
  createPathFillQuery,
  pathFillOverlapsPolygon,
  clipSimplePathFill,
  clipSimplePathFillPair,
  contourPathData,
  centerlineIntervalsInsideComponent,
  createSmoothedCenterlineGeometry,
  projectRetainedBoundaryToSourceIntervals,
  sourceIntervalsToIndexIntervals,
  validateSimpleContour: simpleContourIsValid
};
