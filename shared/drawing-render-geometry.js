'use strict';

const DRAWING_RENDER_GEOMETRY_KEYS = Object.freeze([
  'version',
  'pathData',
  'fillRule'
]);
const DRAWING_RENDER_GEOMETRY_VERSION = 1;
const DRAWING_RENDER_GEOMETRY_FILL_RULE = 'evenodd';
const DRAWING_RENDER_GEOMETRY_MAX_PATH_LENGTH = 32_768;
const DRAWING_RENDER_GEOMETRY_MAX_COORDINATE = 1_001_000_000;
const DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_OPERATIONS = 250_000;
const DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_POINTS = 4_096;
const PATH_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i;

function hasExactRenderGeometryKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === DRAWING_RENDER_GEOMETRY_KEYS.length &&
    keys.every(key => (
      typeof key === 'string' &&
      DRAWING_RENDER_GEOMETRY_KEYS.includes(key)
    )) &&
    DRAWING_RENDER_GEOMETRY_KEYS.every(key => Object.hasOwn(value, key));
}

function validPathCoordinate(token, maximumCoordinate) {
  if (typeof token !== 'string' || !PATH_NUMBER_PATTERN.test(token)) return false;
  const value = Number(token);
  return Number.isFinite(value) && Math.abs(value) <= maximumCoordinate;
}

function boundedTopologyLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.trunc(number)
    : fallback;
}

function pointKey(point) {
  return `${point.x}\u0000${point.y}`;
}

function edgeKey(start, end) {
  const startKey = pointKey(start);
  const endKey = pointKey(end);
  return startKey < endKey
    ? `${startKey}\u0001${endKey}`
    : `${endKey}\u0001${startKey}`;
}

function crossProduct(start, end, point) {
  return (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x);
}

function pointWithinEdgeBounds(point, start, end) {
  return point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y);
}

function edgesIntersect(left, right) {
  const leftStart = crossProduct(left.start, left.end, right.start);
  const leftEnd = crossProduct(left.start, left.end, right.end);
  const rightStart = crossProduct(right.start, right.end, left.start);
  const rightEnd = crossProduct(right.start, right.end, left.end);
  if (leftStart === 0 && pointWithinEdgeBounds(right.start, left.start, left.end)) return true;
  if (leftEnd === 0 && pointWithinEdgeBounds(right.end, left.start, left.end)) return true;
  if (rightStart === 0 && pointWithinEdgeBounds(left.start, right.start, right.end)) return true;
  if (rightEnd === 0 && pointWithinEdgeBounds(left.end, right.start, right.end)) return true;
  return (leftStart < 0) !== (leftEnd < 0) &&
    (rightStart < 0) !== (rightEnd < 0);
}

function validateDrawingRenderContours(contours, options = {}) {
  const maximumPoints = boundedTopologyLimit(
    options.maxTopologyPoints,
    DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_POINTS
  );
  const maximumOperations = boundedTopologyLimit(
    options.maxTopologyOperations,
    DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_OPERATIONS
  );
  const totalPointCount = contours.reduce((count, contour) => count + contour.length, 0);
  if (totalPointCount > maximumPoints) return false;
  let operations = 0;
  const consume = (count = 1) => {
    if (operations + count > maximumOperations) return false;
    operations += count;
    return true;
  };
  const seenEdges = new Set();

  for (const contour of contours) {
    if (!consume(contour.length)) return false;
    const distinctVertices = new Set(contour.map(pointKey));
    if (distinctVertices.size < 3 || distinctVertices.size !== contour.length) return false;

    let doubleArea = 0;
    const origin = contour[0];
    const edges = [];
    for (let index = 0; index < contour.length; index += 1) {
      const start = contour[index];
      const end = contour[(index + 1) % contour.length];
      if (start.x === end.x && start.y === end.y) return false;
      const signature = edgeKey(start, end);
      if (seenEdges.has(signature)) return false;
      seenEdges.add(signature);
      doubleArea += (start.x - origin.x) * (end.y - origin.y) -
        (end.x - origin.x) * (start.y - origin.y);
      edges.push({
        index,
        start,
        end,
        minX: Math.min(start.x, end.x),
        maxX: Math.max(start.x, end.x),
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y)
      });
    }
    if (!Number.isFinite(doubleArea) || doubleArea === 0) return false;

    const sortCost = edges.length * Math.ceil(Math.log2(edges.length + 1));
    if (!consume(sortCost)) return false;
    const orderedEdges = [...edges].sort((left, right) => (
      left.minX - right.minX ||
      left.minY - right.minY ||
      left.index - right.index
    ));
    for (let leftIndex = 0; leftIndex < orderedEdges.length; leftIndex += 1) {
      const left = orderedEdges[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < orderedEdges.length; rightIndex += 1) {
        const right = orderedEdges[rightIndex];
        if (right.minX > left.maxX) break;
        if (!consume()) return false;
        const adjacentDistance = Math.abs(left.index - right.index);
        if (adjacentDistance === 1 || adjacentDistance === contour.length - 1) continue;
        if (right.minY > left.maxY || right.maxY < left.minY) continue;
        if (edgesIntersect(left, right)) return false;
      }
    }
  }
  return true;
}

function validateDrawingRenderPathData(pathData, options = {}) {
  const maximumLength = Math.max(
    1,
    Math.trunc(Number(options.maxPathLength) || DRAWING_RENDER_GEOMETRY_MAX_PATH_LENGTH)
  );
  const maximumCoordinate = Math.max(
    1,
    Number(options.maxCoordinate) || DRAWING_RENDER_GEOMETRY_MAX_COORDINATE
  );
  if (typeof pathData !== 'string' ||
      pathData.length === 0 ||
      pathData.length > maximumLength ||
      pathData.trim() !== pathData) {
    return false;
  }

  const tokens = pathData.split(/\s+/);
  let cursor = 0;
  const contours = [];
  while (cursor < tokens.length) {
    if (tokens[cursor] !== 'M' ||
        !validPathCoordinate(tokens[cursor + 1], maximumCoordinate) ||
        !validPathCoordinate(tokens[cursor + 2], maximumCoordinate)) {
      return false;
    }
    const contour = [{
      x: Number(tokens[cursor + 1]),
      y: Number(tokens[cursor + 2])
    }];
    cursor += 3;
    while (tokens[cursor] === 'L') {
      if (!validPathCoordinate(tokens[cursor + 1], maximumCoordinate) ||
          !validPathCoordinate(tokens[cursor + 2], maximumCoordinate)) {
        return false;
      }
      contour.push({
        x: Number(tokens[cursor + 1]),
        y: Number(tokens[cursor + 2])
      });
      cursor += 3;
    }
    if (contour.length < 3 || tokens[cursor] !== 'Z') return false;
    cursor += 1;
    contours.push(contour);
  }
  return contours.length > 0 && validateDrawingRenderContours(contours, options);
}

function validateDrawingRenderGeometry(value, options = {}) {
  return hasExactRenderGeometryKeys(value) &&
    value.version === DRAWING_RENDER_GEOMETRY_VERSION &&
    value.fillRule === DRAWING_RENDER_GEOMETRY_FILL_RULE &&
    validateDrawingRenderPathData(value.pathData, options);
}

module.exports = {
  DRAWING_RENDER_GEOMETRY_FILL_RULE,
  DRAWING_RENDER_GEOMETRY_KEYS,
  DRAWING_RENDER_GEOMETRY_MAX_COORDINATE,
  DRAWING_RENDER_GEOMETRY_MAX_PATH_LENGTH,
  DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_OPERATIONS,
  DRAWING_RENDER_GEOMETRY_MAX_TOPOLOGY_POINTS,
  DRAWING_RENDER_GEOMETRY_VERSION,
  validateDrawingRenderGeometry,
  validateDrawingRenderPathData
};
