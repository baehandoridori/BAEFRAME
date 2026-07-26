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
  let contourCount = 0;
  while (cursor < tokens.length) {
    if (tokens[cursor] !== 'M' ||
        !validPathCoordinate(tokens[cursor + 1], maximumCoordinate) ||
        !validPathCoordinate(tokens[cursor + 2], maximumCoordinate)) {
      return false;
    }
    cursor += 3;
    let pointCount = 1;
    while (tokens[cursor] === 'L') {
      if (!validPathCoordinate(tokens[cursor + 1], maximumCoordinate) ||
          !validPathCoordinate(tokens[cursor + 2], maximumCoordinate)) {
        return false;
      }
      cursor += 3;
      pointCount += 1;
    }
    if (pointCount < 3 || tokens[cursor] !== 'Z') return false;
    cursor += 1;
    contourCount += 1;
  }
  return contourCount > 0;
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
  DRAWING_RENDER_GEOMETRY_VERSION,
  validateDrawingRenderGeometry,
  validateDrawingRenderPathData
};
