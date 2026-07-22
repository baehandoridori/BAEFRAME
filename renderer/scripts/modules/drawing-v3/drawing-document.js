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
const COMMAND_KEYS = Object.freeze([
  'id',
  'actorId',
  'baseRevision',
  'target',
  'kind',
  'operations',
  'createdAt'
]);
const COMMAND_TARGET_KEYS = Object.freeze([
  'layerId',
  'keyframeId',
  'frame'
]);
const COMMAND_KINDS = Object.freeze(new Set([
  'add-objects',
  'delete-objects',
  'transform-objects',
  'split-stroke'
]));
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

function deepEqualPlain(left, right) {
  if (left === right) return true;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) ||
      left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqualPlain(value, right[index]));
  }

  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) =>
    key === rightKeys[index] && deepEqualPlain(left[key], right[key]));
}

function isValidIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31, leapYear ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31
  ];
  return day >= 1 && day <= daysInMonth[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59 &&
    Number.isFinite(Date.parse(value));
}

function isValidOperationStructure(operation) {
  if (!isPlainRecord(operation)) return false;
  const typeDescriptor = Object.getOwnPropertyDescriptor(operation, 'type');
  if (!typeDescriptor || !typeDescriptor.enumerable ||
    !Object.hasOwn(typeDescriptor, 'value')) {
    return false;
  }

  if (typeDescriptor.value === 'insert-objects') {
    return hasExactDataKeys(operation, ['type', 'index', 'objects']) &&
      isNonnegativeInteger(operation.index) &&
      isDenseArray(operation.objects) && operation.objects.length > 0;
  }

  if (typeDescriptor.value === 'remove-objects') {
    if (!hasExactDataKeys(operation, ['type', 'objectIds']) ||
      !isDenseArray(operation.objectIds) || operation.objectIds.length === 0 ||
      !operation.objectIds.every(isNonemptyString)) {
      return false;
    }
    return new Set(operation.objectIds).size === operation.objectIds.length;
  }

  if (typeDescriptor.value === 'set-transforms') {
    if (!hasExactDataKeys(operation, ['type', 'transforms']) ||
      !isDenseArray(operation.transforms) || operation.transforms.length === 0) {
      return false;
    }
    const objectIds = new Set();
    for (const transform of operation.transforms) {
      if (!hasExactDataKeys(transform, ['objectId', 'transform']) ||
        !isNonemptyString(transform.objectId) || objectIds.has(transform.objectId)) {
        return false;
      }
      objectIds.add(transform.objectId);
    }
    return true;
  }

  return false;
}

function commandKindMatchesOperations(kind, operations) {
  const types = operations.map(operation => operation.type);
  if (kind === 'add-objects') {
    return types.every(type => type === 'insert-objects');
  }
  if (kind === 'delete-objects') {
    return types.every(type => type === 'remove-objects');
  }
  if (kind === 'transform-objects') {
    return types.every(type => type === 'set-transforms');
  }
  return kind === 'split-stroke' &&
    types.includes('insert-objects') &&
    types.includes('remove-objects') &&
    types.every(type => [
      'insert-objects',
      'remove-objects',
      'set-transforms'
    ].includes(type));
}

function isValidCommandEnvelope(command, content) {
  if (!hasExactDataKeys(command, COMMAND_KEYS) ||
    !isNonemptyString(command.id) ||
    !isNonemptyString(command.actorId) ||
    !isNonnegativeInteger(command.baseRevision) ||
    !hasExactDataKeys(command.target, COMMAND_TARGET_KEYS) ||
    !isNonemptyString(command.target.layerId) ||
    !isNonemptyString(command.target.keyframeId) ||
    !isNonnegativeInteger(command.target.frame) ||
    command.target.frame >= content.timebase.totalFrames ||
    !COMMAND_KINDS.has(command.kind) ||
    !isDenseArray(command.operations) || command.operations.length === 0 ||
    !isValidIsoTimestamp(command.createdAt)) {
    return false;
  }
  return command.operations.every(isValidOperationStructure) &&
    commandKindMatchesOperations(command.kind, command.operations);
}

function resolveApplySource(applyOptions) {
  if (!hasExactDataKeys(applyOptions, [], ['source'])) return null;
  const source = Object.hasOwn(applyOptions, 'source')
    ? applyOptions.source
    : 'user';
  return source === 'user' || source === 'history' ? source : null;
}

function findExactTarget(content, request) {
  const layer = content.layers.find(candidate => candidate.id === request.layerId);
  if (!layer) return null;
  const keyframe = layer.keyframes.find(candidate =>
    candidate.id === request.keyframeId && candidate.frame === request.frame);
  if (!keyframe || keyframe.empty) return null;
  return { layer, keyframe };
}

function collectDocumentObjectIds(content) {
  const objectIds = new Set();
  for (const layer of content.layers) {
    for (const keyframe of layer.keyframes) {
      for (const object of keyframe.objects) objectIds.add(object.id);
    }
  }
  return objectIds;
}

function applyInsertOperation(
  documentObjectIds,
  keyframe,
  operation,
  limits,
  source
) {
  if (operation.index > keyframe.objects.length) {
    return { applied: false, reason: 'invalid-command' };
  }

  for (const object of operation.objects) {
    const reason = validateStrokeObject(object, limits, source);
    if (reason) return { applied: false, reason };
  }
  if (keyframe.objects.length + operation.objects.length >
    limits.maxObjectsPerKeyframe) {
    return { applied: false, reason: 'object-limit-exceeded' };
  }

  const insertedObjectIds = new Set();
  for (const object of operation.objects) {
    if (documentObjectIds.has(object.id) || insertedObjectIds.has(object.id)) {
      return { applied: false, reason: 'duplicate-object-id' };
    }
    insertedObjectIds.add(object.id);
  }

  const insertedObjects = clonePlain(operation.objects);
  keyframe.objects.splice(operation.index, 0, ...insertedObjects);
  for (const objectId of insertedObjectIds) documentObjectIds.add(objectId);
  return {
    applied: true,
    inverseOperations: [{
      type: 'remove-objects',
      objectIds: insertedObjects.map(object => object.id)
    }]
  };
}

function applyRemoveOperation(documentObjectIds, keyframe, operation) {
  const indexedObjects = new Map(
    keyframe.objects.map((object, index) => [object.id, { index, object }])
  );
  const removals = [];
  for (const objectId of operation.objectIds) {
    const match = indexedObjects.get(objectId);
    if (!match) return { applied: false, reason: 'object-not-found' };
    removals.push(match);
  }
  removals.sort((left, right) => left.index - right.index);
  for (let index = removals.length - 1; index >= 0; index -= 1) {
    keyframe.objects.splice(removals[index].index, 1);
  }
  for (const removal of removals) documentObjectIds.delete(removal.object.id);
  return {
    applied: true,
    inverseOperations: removals.map(removal => ({
      type: 'insert-objects',
      index: removal.index,
      objects: [clonePlain(removal.object)]
    }))
  };
}

function applyTransformOperation(keyframe, operation) {
  for (const entry of operation.transforms) {
    if (!isValidAffineTransform(entry.transform)) {
      return { applied: false, reason: 'invalid-transform' };
    }
  }

  const objectsById = new Map(keyframe.objects.map(object => [object.id, object]));
  const inverseTransforms = [];
  for (const entry of operation.transforms) {
    const object = objectsById.get(entry.objectId);
    if (!object) return { applied: false, reason: 'object-not-found' };
    inverseTransforms.push({
      objectId: object.id,
      transform: clonePlain(object.transform)
    });
  }
  for (const entry of operation.transforms) {
    objectsById.get(entry.objectId).transform = clonePlain(entry.transform);
  }
  return {
    applied: true,
    inverseOperations: [{
      type: 'set-transforms',
      transforms: inverseTransforms
    }]
  };
}

function applyOperation(documentObjectIds, keyframe, operation, limits, source) {
  if (operation.type === 'insert-objects') {
    return applyInsertOperation(
      documentObjectIds,
      keyframe,
      operation,
      limits,
      source
    );
  }
  if (operation.type === 'remove-objects') {
    return applyRemoveOperation(documentObjectIds, keyframe, operation);
  }
  return applyTransformOperation(keyframe, operation);
}

function applyCommandAtomically({
  content,
  head,
  limits,
  command,
  appliedCommandIds,
  source
}, commit) {
  if (!isValidCommandEnvelope(command, content) || source === null) {
    return { applied: false, reason: 'invalid-command' };
  }
  if (appliedCommandIds.has(command.id)) {
    return { applied: false, reason: 'duplicate-command-id' };
  }
  if (command.baseRevision !== head.sequence) {
    return { applied: false, reason: 'stale-revision' };
  }

  const draft = clonePlain(content);
  const target = findExactTarget(draft, command.target);
  if (!target) return { applied: false, reason: 'target-not-found' };
  if (target.layer.locked) return { applied: false, reason: 'layer-locked' };

  const objectsBefore = clonePlain(target.keyframe.objects);
  const documentObjectIds = collectDocumentObjectIds(draft);
  const inverseOperations = [];
  for (const operation of command.operations) {
    const result = applyOperation(
      documentObjectIds,
      target.keyframe,
      operation,
      limits,
      source
    );
    if (!result.applied) return { applied: false, reason: result.reason };
    inverseOperations.unshift(...result.inverseOperations);
  }

  if (deepEqualPlain(objectsBefore, target.keyframe.objects)) {
    return { applied: false, reason: 'no-change' };
  }
  if (head.sequence === Number.MAX_SAFE_INTEGER ||
    target.keyframe.revision === Number.MAX_SAFE_INTEGER) {
    return { applied: false, reason: 'revision-limit-exceeded' };
  }

  target.keyframe.revision += 1;
  const nextHead = {
    sequence: head.sequence + 1,
    lastCommandId: command.id
  };
  commit({ content: draft, head: nextHead });
  appliedCommandIds.add(command.id);
  return {
    applied: true,
    commandId: command.id,
    sequence: nextHead.sequence,
    inverseOperations: clonePlain(inverseOperations)
  };
}

function createDrawingDocumentV3(options = {}) {
  if (!hasExactDataKeys(options, CREATE_OPTION_KEYS, ['limits'])) {
    throw new TypeError('Invalid DrawingDocumentV3 options');
  }
  const limits = validateLimits(options.limits);
  let content = validateAndCloneInitialContent(options, limits);
  let head = {
    sequence: options.revisionSequence,
    lastCommandId: null
  };
  const appliedCommandIds = new Set();

  return {
    getContentSnapshot: () => clonePlain(content),
    getHead: () => ({ ...head }),
    resolveFrame: request => resolveFrameSnapshot(content, request),
    applyCommand(command, applyOptions = {}) {
      return applyCommandAtomically({
        content,
        head,
        limits,
        command,
        appliedCommandIds,
        source: resolveApplySource(applyOptions)
      }, next => {
        content = next.content;
        head = next.head;
      });
    }
  };
}

module.exports = { createDrawingDocumentV3 };
