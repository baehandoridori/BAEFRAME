'use strict';

const HARD_LIMITS = Object.freeze({
  maxObjectsPerKeyframe: 10_000,
  maxInputPointsPerStroke: 20_000,
  maxStoredPointsPerStroke: 100_000
});

const CREATE_OPTION_KEYS = Object.freeze([
  'documentId',
  'coordinateSpace',
  'timebase',
  'initialLayers',
  'revisionSequence'
]);
const LIMIT_KEYS = Object.freeze(Object.keys(HARD_LIMITS));
const COORDINATE_SPACE_KEYS = Object.freeze([
  'unit',
  'origin',
  'yAxis',
  'pixelRatio',
  'width',
  'height'
]);
const TIMEBASE_KEYS = Object.freeze([
  'fpsNumerator',
  'fpsDenominator',
  'totalFrames'
]);
const LAYER_KEYS = Object.freeze([
  'id',
  'name',
  'visible',
  'locked',
  'opacity',
  'keyframes'
]);
const KEYFRAME_KEYS = Object.freeze([
  'id',
  'frame',
  'empty',
  'revision',
  'objects'
]);
const STROKE_KEYS = Object.freeze([
  'id',
  'type',
  'tool',
  'visible',
  'locked',
  'opacity',
  'blendMode',
  'transform',
  'points',
  'style'
]);
const POINT_KEYS = Object.freeze(['x', 'y', 'pressure', 'time']);
const STYLE_KEYS = Object.freeze([
  'color',
  'size',
  'thinning',
  'smoothing',
  'streamline',
  'outlineColor',
  'outlineWidth'
]);
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

function clonePlain(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value, requiredKeys, optionalKeys = []) {
  if (!isPlainRecord(value)) return false;

  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
    return false;
  }
  if (requiredKeys.some(key => !Object.hasOwn(value, key))) return false;

  const descriptors = Object.getOwnPropertyDescriptors(value);
  return ownKeys.every(key => {
    const descriptor = descriptors[key];
    return descriptor.enumerable && Object.hasOwn(descriptor, 'value') &&
      descriptor.value !== undefined;
  });
}

function isDenseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) {
      return false;
    }
  }
  return true;
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isFinitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function isFiniteInRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateLimits(value) {
  if (value !== undefined && !hasExactDataKeys(value, [], LIMIT_KEYS)) {
    throw new TypeError('Invalid DrawingDocumentV3 limits');
  }

  const limits = { ...HARD_LIMITS };
  if (value !== undefined) {
    for (const key of Object.keys(value)) limits[key] = value[key];
  }

  for (const key of LIMIT_KEYS) {
    if (!isPositiveInteger(limits[key]) || limits[key] > HARD_LIMITS[key]) {
      throw new TypeError('Invalid DrawingDocumentV3 limits');
    }
  }
  if (limits.maxInputPointsPerStroke > limits.maxStoredPointsPerStroke) {
    throw new TypeError('Invalid DrawingDocumentV3 limits');
  }
  return limits;
}

function isValidCoordinateSpace(value) {
  return hasExactDataKeys(value, COORDINATE_SPACE_KEYS) &&
    value.unit === 'source-pixel' &&
    value.origin === 'top-left' &&
    value.yAxis === 'down' &&
    isFinitePositive(value.pixelRatio) &&
    isFinitePositive(value.width) &&
    isFinitePositive(value.height);
}

function isValidTimebase(value) {
  return hasExactDataKeys(value, TIMEBASE_KEYS) &&
    isPositiveInteger(value.fpsNumerator) &&
    isPositiveInteger(value.fpsDenominator) &&
    isPositiveInteger(value.totalFrames);
}

function isValidAffineTransform(value) {
  if (!isDenseArray(value) || value.length !== 6 ||
    !value.every(Number.isFinite)) {
    return false;
  }
  const determinant = value[0] * value[3] - value[1] * value[2];
  return Math.abs(determinant) > 1e-8;
}

function isValidPoint(value, previousTime) {
  return hasExactDataKeys(value, POINT_KEYS) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    isFiniteInRange(value.pressure, 0, 1) &&
    Number.isFinite(value.time) &&
    value.time >= 0 &&
    value.time >= previousTime;
}

function isValidStyle(value) {
  return hasExactDataKeys(value, STYLE_KEYS) &&
    typeof value.color === 'string' &&
    HEX_COLOR_PATTERN.test(value.color) &&
    isFinitePositive(value.size) &&
    isFiniteInRange(value.thinning, -1, 1) &&
    isFiniteInRange(value.smoothing, 0, 1) &&
    isFiniteInRange(value.streamline, 0, 1) &&
    (value.outlineColor === null ||
      (typeof value.outlineColor === 'string' &&
        HEX_COLOR_PATTERN.test(value.outlineColor))) &&
    Number.isFinite(value.outlineWidth) &&
    value.outlineWidth >= 0;
}

function validateStrokeObject(object, limits, source = 'user') {
  if (!hasExactDataKeys(object, STROKE_KEYS)) return 'invalid-object';
  if (!isNonemptyString(object.id) || object.type !== 'stroke' ||
    (object.tool !== 'pen' && object.tool !== 'brush') ||
    typeof object.visible !== 'boolean' ||
    typeof object.locked !== 'boolean' ||
    !isFiniteInRange(object.opacity, 0, 1) ||
    object.blendMode !== 'source-over' ||
    !isDenseArray(object.points) || object.points.length === 0 ||
    !isValidStyle(object.style)) {
    return 'invalid-object';
  }

  const pointLimit = source === 'history'
    ? limits.maxStoredPointsPerStroke
    : limits.maxInputPointsPerStroke;
  if (object.points.length > pointLimit) return 'point-limit-exceeded';

  let previousTime = 0;
  for (const point of object.points) {
    if (!isValidPoint(point, previousTime)) return 'invalid-object';
    previousTime = point.time;
  }

  if (!isValidAffineTransform(object.transform)) return 'invalid-transform';
  return null;
}

function validateInitialLayers(layers, timebase, limits) {
  if (!isDenseArray(layers)) {
    throw new TypeError('Invalid DrawingDocumentV3 layers');
  }

  const layerIds = new Set();
  const keyframeIds = new Set();
  const objectIds = new Set();

  for (const layer of layers) {
    if (!hasExactDataKeys(layer, LAYER_KEYS) ||
      !isNonemptyString(layer.id) || !isNonemptyString(layer.name) ||
      typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
      !isFiniteInRange(layer.opacity, 0, 1) || !isDenseArray(layer.keyframes) ||
      layerIds.has(layer.id)) {
      throw new TypeError('Invalid DrawingDocumentV3 layer');
    }
    layerIds.add(layer.id);

    let previousFrame = -1;
    for (const keyframe of layer.keyframes) {
      if (!hasExactDataKeys(keyframe, KEYFRAME_KEYS) ||
        !isNonemptyString(keyframe.id) ||
        !isNonnegativeInteger(keyframe.frame) ||
        keyframe.frame >= timebase.totalFrames ||
        !isNonnegativeInteger(keyframe.revision) ||
        typeof keyframe.empty !== 'boolean' ||
        !isDenseArray(keyframe.objects) ||
        keyframe.frame <= previousFrame ||
        keyframeIds.has(keyframe.id) ||
        (keyframe.empty && keyframe.objects.length > 0) ||
        keyframe.objects.length > limits.maxObjectsPerKeyframe) {
        throw new TypeError('Invalid DrawingDocumentV3 keyframe');
      }
      keyframeIds.add(keyframe.id);
      previousFrame = keyframe.frame;

      for (const object of keyframe.objects) {
        const reason = validateStrokeObject(object, limits, 'history');
        if (reason || objectIds.has(object.id)) {
          throw new TypeError('Invalid DrawingDocumentV3 object');
        }
        objectIds.add(object.id);
      }
    }
  }
}

function validateAndCloneInitialContent(options, limits) {
  if (!isNonemptyString(options.documentId) ||
    !isValidCoordinateSpace(options.coordinateSpace) ||
    !isValidTimebase(options.timebase) ||
    !isNonnegativeInteger(options.revisionSequence)) {
    throw new TypeError('Invalid DrawingDocumentV3 options');
  }

  validateInitialLayers(options.initialLayers, options.timebase, limits);
  return {
    schemaVersion: '3.0.0',
    documentId: options.documentId,
    engine: 'baeframe-drawing',
    coordinateSpace: clonePlain(options.coordinateSpace),
    timebase: clonePlain(options.timebase),
    layers: clonePlain(options.initialLayers)
  };
}

function resolveFrameSnapshot(content, request) {
  if (!hasExactDataKeys(request, ['layerId', 'frame']) ||
    !isNonemptyString(request.layerId) ||
    !Number.isSafeInteger(request.frame) ||
    request.frame < 0 || request.frame >= content.timebase.totalFrames) {
    return null;
  }

  const layer = content.layers.find(candidate => candidate.id === request.layerId);
  if (!layer) return null;

  let source = null;
  for (const keyframe of layer.keyframes) {
    if (keyframe.frame > request.frame) break;
    source = keyframe;
  }

  if (!source) {
    return {
      layerId: layer.id,
      frame: request.frame,
      sourceFrame: null,
      keyframeId: null,
      held: false,
      empty: true,
      objects: []
    };
  }

  return {
    layerId: layer.id,
    frame: request.frame,
    sourceFrame: source.frame,
    keyframeId: source.id,
    held: source.frame !== request.frame,
    empty: source.empty,
    objects: source.empty ? [] : clonePlain(source.objects)
  };
}

function createDrawingDocumentV3(options = {}) {
  if (!hasExactDataKeys(options, CREATE_OPTION_KEYS, ['limits'])) {
    throw new TypeError('Invalid DrawingDocumentV3 options');
  }
  const limits = validateLimits(options.limits);
  const content = validateAndCloneInitialContent(options, limits);
  const head = {
    sequence: options.revisionSequence,
    lastCommandId: null
  };

  return {
    getContentSnapshot: () => clonePlain(content),
    getHead: () => ({ ...head }),
    resolveFrame: request => resolveFrameSnapshot(content, request)
  };
}

module.exports = { createDrawingDocumentV3 };
