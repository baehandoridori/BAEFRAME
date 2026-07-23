const STORAGE_SCHEMA = 'baeframe-fabric-scenes';
const STORAGE_VERSION = '1.0.0';
const STORAGE_ENGINE = 'fabric-7';

const DEFAULT_LIMITS = Object.freeze({
  maxDocumentBytes: 128 * 1024 * 1024,
  maxTransitionBytes: 8 * 1024 * 1024,
  maxKeyframes: 10000,
  maxObjectsPerKeyframe: 10000,
  maxObjectsTotal: 100000,
  maxPointsPerStroke: 20000
});

const ROOT_KEYS = Object.freeze([
  'storageSchema',
  'storageVersion',
  'engine',
  'documentId',
  'revision',
  'fps',
  'totalFrames',
  'keyframes'
]);
const KEYFRAME_KEYS = Object.freeze([
  'id',
  'frame',
  'sourceWidth',
  'sourceHeight',
  'mutationSequence',
  'objects'
]);
const RECORD_REQUIRED_KEYS = Object.freeze([
  'id',
  'type',
  'pathData',
  'sourcePoints',
  'style',
  'transform'
]);
const RECORD_OPTIONAL_KEYS = Object.freeze(['strokeCaps']);
const STYLE_KEYS = Object.freeze(['color', 'size', 'opacity']);
const TRANSFORM_KEYS = Object.freeze([
  'left',
  'top',
  'scaleX',
  'scaleY',
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY'
]);
const POINT_REQUIRED_KEYS = Object.freeze(['x', 'y', 'pressure', 'time']);
const POINT_OPTIONAL_KEYS = Object.freeze(['pointerType']);
const CAPS_KEYS = Object.freeze(['start', 'end']);
const EVENT_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'scene',
  'mutationSequence',
  'origin',
  'kind',
  'estimatedBytes',
  'unsupportedReason',
  'removals',
  'insertions',
  'transforms'
]);
const EVENT_SCENE_KEYS = Object.freeze([
  'sceneInstanceId',
  'targetFrame',
  'sourceWidth',
  'sourceHeight'
]);
const REMOVAL_KEYS = Object.freeze(['id', 'index']);
const INSERTION_KEYS = Object.freeze(['index', 'record', 'baseTransform']);
const TRANSFORM_CHANGE_KEYS = Object.freeze(['id', 'beforeTransform', 'afterTransform']);
const OVERLAY_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'fps',
  'totalFrames',
  'scenes'
]);
const OVERLAY_SCENE_KEYS = Object.freeze([
  'sceneInstanceId',
  'targetFrame',
  'sourceWidth',
  'sourceHeight',
  'mutationSequence',
  'objects'
]);
const VALID_ORIGINS = new Set(['live', 'history']);
const VALID_KINDS = new Set([
  'add-objects',
  'transform-objects',
  'split-stroke',
  'delete-objects',
  'clear-keyframe'
]);
const VALID_POINTER_TYPES = new Set(['mouse', 'pen', 'touch']);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_TOTAL_FRAMES = 1_000_000_000;
const MAX_SOURCE_DIMENSION = 1_000_000;
const MAX_POINT_COORDINATE = 1_000_000_000;
const MAX_POINT_TIME = 1_000_000_000_000;
const MAX_BRUSH_SIZE = 1_000_000;
const MAX_TRANSFORM_MAGNITUDE = 1_000_000_000;
const encoder = new TextEncoder();

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return Reflect.ownKeys(value).every(key =>
    key === 'length' ||
    (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)
  );
}

function hasExactKeys(value, required, optional = []) {
  if (!isPlainRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return false;
  const allowed = new Set([...required, ...optional]);
  if (keys.some(key => !allowed.has(key))) return false;
  return required.every(key => Object.hasOwn(value, key));
}

function isNonemptyString(value, maximum = 1024) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}

function clonePlain(value) {
  return structuredClone(value);
}

function jsonBytes(value) {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return Number.POSITIVE_INFINITY;
    return encoder.encode(serialized).byteLength;
  } catch (_error) {
    return Number.POSITIVE_INFINITY;
  }
}

function sameTransform(left, right) {
  return TRANSFORM_KEYS.every(key => left[key] === right[key]);
}

function validateTransform(value) {
  if (!hasExactKeys(value, TRANSFORM_KEYS)) return false;
  for (const key of TRANSFORM_KEYS) {
    if (key === 'flipX' || key === 'flipY') {
      if (typeof value[key] !== 'boolean') return false;
    } else if (!Number.isFinite(value[key]) ||
        Math.abs(value[key]) > MAX_TRANSFORM_MAGNITUDE) {
      return false;
    }
  }
  return value.scaleX !== 0 && value.scaleY !== 0;
}

function validatePoint(value) {
  if (!hasExactKeys(value, POINT_REQUIRED_KEYS, POINT_OPTIONAL_KEYS)) return false;
  if (!Number.isFinite(value.x) || Math.abs(value.x) > MAX_POINT_COORDINATE ||
      !Number.isFinite(value.y) || Math.abs(value.y) > MAX_POINT_COORDINATE ||
      !Number.isFinite(value.pressure) || value.pressure < 0 || value.pressure > 1 ||
      !Number.isFinite(value.time) || value.time < 0 || value.time > MAX_POINT_TIME) {
    return false;
  }
  return value.pointerType === undefined ||
    (typeof value.pointerType === 'string' && VALID_POINTER_TYPES.has(value.pointerType));
}

function validateRecord(value, limits) {
  if (!hasExactKeys(value, RECORD_REQUIRED_KEYS, RECORD_OPTIONAL_KEYS) ||
      !isNonemptyString(value.id, 512) || value.type !== 'stroke' ||
      !isNonemptyString(value.pathData, limits.maxDocumentBytes) ||
      !isDenseArray(value.sourcePoints) || value.sourcePoints.length === 0 ||
      value.sourcePoints.length > limits.maxPointsPerStroke ||
      !hasExactKeys(value.style, STYLE_KEYS) ||
      !HEX_COLOR.test(value.style.color) ||
      !isPositiveFinite(value.style.size) || value.style.size > MAX_BRUSH_SIZE ||
      !Number.isFinite(value.style.opacity) ||
      value.style.opacity < 0 || value.style.opacity > 1 ||
      !validateTransform(value.transform)) {
    return false;
  }

  let previousTime = 0;
  for (const point of value.sourcePoints) {
    if (!validatePoint(point) || point.time < previousTime) return false;
    previousTime = point.time;
  }
  if (value.strokeCaps !== undefined &&
      (!hasExactKeys(value.strokeCaps, CAPS_KEYS) ||
       typeof value.strokeCaps.start !== 'boolean' ||
       typeof value.strokeCaps.end !== 'boolean')) {
    return false;
  }
  return true;
}

function validateFpsAndFrames(fps, totalFrames) {
  return isPositiveFinite(fps) && fps <= 1000 &&
    Number.isSafeInteger(totalFrames) && totalFrames > 0 &&
    totalFrames <= MAX_TOTAL_FRAMES;
}

function validateKeyframes(keyframes, totalFrames, limits) {
  if (!isDenseArray(keyframes) || keyframes.length > limits.maxKeyframes) {
    return { valid: false, reason: 'invalid-document' };
  }
  const keyframeIds = new Set();
  const frames = new Set();
  let objectCount = 0;
  let previousFrame = -1;

  for (const keyframe of keyframes) {
    if (!hasExactKeys(keyframe, KEYFRAME_KEYS) ||
        !isNonemptyString(keyframe.id, 512) ||
        !Number.isSafeInteger(keyframe.frame) || keyframe.frame < 0 ||
        keyframe.frame >= totalFrames || keyframe.frame <= previousFrame ||
        !isPositiveFinite(keyframe.sourceWidth) ||
        keyframe.sourceWidth > MAX_SOURCE_DIMENSION ||
        !isPositiveFinite(keyframe.sourceHeight) ||
        keyframe.sourceHeight > MAX_SOURCE_DIMENSION ||
        !isSafeCount(keyframe.mutationSequence) ||
        !isDenseArray(keyframe.objects) ||
        keyframe.objects.length > limits.maxObjectsPerKeyframe ||
        keyframeIds.has(keyframe.id) || frames.has(keyframe.frame)) {
      return { valid: false, reason: 'invalid-document' };
    }
    const objectIds = new Set();
    for (const object of keyframe.objects) {
      if (!validateRecord(object, limits) || objectIds.has(object.id)) {
        return { valid: false, reason: 'invalid-document' };
      }
      objectIds.add(object.id);
    }
    objectCount += keyframe.objects.length;
    if (objectCount > limits.maxObjectsTotal) {
      return { valid: false, reason: 'document-too-large' };
    }
    keyframeIds.add(keyframe.id);
    frames.add(keyframe.frame);
    previousFrame = keyframe.frame;
  }
  return { valid: true, objectCount };
}

function validateRootValue(value, limits) {
  if (!hasExactKeys(value, ROOT_KEYS) ||
      value.storageSchema !== STORAGE_SCHEMA ||
      value.storageVersion !== STORAGE_VERSION ||
      value.engine !== STORAGE_ENGINE ||
      !isNonemptyString(value.documentId, 512) ||
      !isSafeCount(value.revision) ||
      !validateFpsAndFrames(value.fps, value.totalFrames)) {
    return { valid: false, reason: 'invalid-document' };
  }
  if (jsonBytes(value) > limits.maxDocumentBytes) {
    return { valid: false, reason: 'document-too-large' };
  }
  const keyframes = validateKeyframes(value.keyframes, value.totalFrames, limits);
  if (!keyframes.valid) return keyframes;
  return { valid: true, objectCount: keyframes.objectCount };
}

function normalizeLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeLimits(input = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [
      key,
      normalizeLimit(input?.[key], fallback)
    ])
  ));
}

function normalizeContext(meta = {}) {
  if (!isPlainRecord(meta) ||
      (meta.documentId !== undefined && !isNonemptyString(meta.documentId, 512)) ||
      !validateFpsAndFrames(meta.fps, meta.totalFrames)) {
    return null;
  }
  const optionalCounts = ['hostGeneration', 'videoGeneration'];
  if (optionalCounts.some(key => meta[key] !== undefined && !isSafeCount(meta[key]))) {
    return null;
  }
  const optionalStrings = ['persistenceSessionId', 'stableVideoIdentity'];
  if (optionalStrings.some(key =>
    meta[key] !== undefined && !isNonemptyString(meta[key], 32768))) {
    return null;
  }
  return {
    hostGeneration: meta.hostGeneration ?? null,
    videoGeneration: meta.videoGeneration ?? null,
    persistenceSessionId: meta.persistenceSessionId ?? null,
    stableVideoIdentity: meta.stableVideoIdentity ?? null
  };
}

function createRootValue({ documentId, fps, totalFrames }) {
  return {
    storageSchema: STORAGE_SCHEMA,
    storageVersion: STORAGE_VERSION,
    engine: STORAGE_ENGINE,
    documentId,
    revision: 0,
    fps,
    totalFrames,
    keyframes: []
  };
}

function calculateFrameBytes(frame, bytesByObjectId) {
  const emptyFrameBytes = jsonBytes({
    id: frame.id,
    frame: frame.frame,
    sourceWidth: frame.sourceWidth,
    sourceHeight: frame.sourceHeight,
    mutationSequence: frame.mutationSequence,
    objects: []
  });
  let objectBytes = 0;
  for (const bytes of bytesByObjectId.values()) objectBytes += bytes;
  return emptyFrameBytes + objectBytes + Math.max(0, bytesByObjectId.size - 1);
}

function eventFailure(reason, needsResync = false) {
  return { applied: false, reason, needsResync };
}

function exactEventEnvelope(event) {
  return hasExactKeys(event, EVENT_KEYS) &&
    isSafeCount(event.hostGeneration) &&
    isSafeCount(event.videoGeneration) &&
    isNonemptyString(event.persistenceSessionId, 32768) &&
    isNonemptyString(event.stableVideoIdentity, 32768) &&
    hasExactKeys(event.scene, EVENT_SCENE_KEYS) &&
    isNonemptyString(event.scene.sceneInstanceId, 512) &&
    Number.isSafeInteger(event.scene.targetFrame) && event.scene.targetFrame >= 0 &&
    isPositiveFinite(event.scene.sourceWidth) &&
    event.scene.sourceWidth <= MAX_SOURCE_DIMENSION &&
    isPositiveFinite(event.scene.sourceHeight) &&
    event.scene.sourceHeight <= MAX_SOURCE_DIMENSION &&
    isSafeCount(event.mutationSequence) &&
    VALID_ORIGINS.has(event.origin) &&
    VALID_KINDS.has(event.kind) &&
    isSafeCount(event.estimatedBytes) &&
    (event.unsupportedReason === null || typeof event.unsupportedReason === 'string') &&
    isDenseArray(event.removals) &&
    isDenseArray(event.insertions) &&
    isDenseArray(event.transforms);
}

function fenceMatches(context, value, includeSession = true) {
  const keys = ['hostGeneration', 'videoGeneration', 'stableVideoIdentity'];
  if (includeSession) keys.push('persistenceSessionId');
  return keys.every(key => context[key] === null || context[key] === value[key]);
}

function validateRemoval(value) {
  return hasExactKeys(value, REMOVAL_KEYS) &&
    isNonemptyString(value.id, 512) &&
    Number.isSafeInteger(value.index) && value.index >= 0;
}

function validateInsertion(value, limits) {
  return hasExactKeys(value, INSERTION_KEYS) &&
    Number.isSafeInteger(value.index) && value.index >= 0 &&
    validateRecord(value.record, limits) &&
    (value.baseTransform === null || validateTransform(value.baseTransform));
}

function validateTransformChange(value) {
  return hasExactKeys(value, TRANSFORM_CHANGE_KEYS) &&
    isNonemptyString(value.id, 512) &&
    validateTransform(value.beforeTransform) &&
    validateTransform(value.afterTransform);
}

function deriveTransitionKind(event) {
  if (event.removals.length > 0 && event.insertions.length > 0) return 'split-stroke';
  if (event.insertions.length > 0) return 'add-objects';
  if (event.removals.length > 0) {
    return event.kind === 'clear-keyframe' ? 'clear-keyframe' : 'delete-objects';
  }
  if (event.transforms.length > 0) return 'transform-objects';
  return null;
}

function cloneOpaque(value) {
  try {
    return clonePlain(value);
  } catch (_error) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_ignored) {
      return null;
    }
  }
}

function defaultCreateId(prefix) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createFabricDrawingPersistenceStore(options = {}) {
  const limits = normalizeLimits(options.limits);
  const createId = typeof options.createId === 'function'
    ? options.createId
    : defaultCreateId;
  const listeners = new Set();
  const issuedIds = new Set();
  let documentValue = null;
  let opaqueRootValue = null;
  let context = {
    hostGeneration: null,
    videoGeneration: null,
    persistenceSessionId: null,
    stableVideoIdentity: null
  };
  let state = 'uninitialized';
  let incompatibleReason = null;
  let sceneInstances = new Map();
  let fallbackIdSequence = 0;
  let documentBytes = 0;
  let objectCount = 0;
  let frameBytesByFrame = new Map();
  let recordBytesByFrame = new Map();

  function allocateId(prefix) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let candidate = null;
      try {
        candidate = createId(prefix);
      } catch (_error) {
        candidate = null;
      }
      if (isNonemptyString(candidate, 512) && !issuedIds.has(candidate)) {
        issuedIds.add(candidate);
        return candidate;
      }
    }
    do {
      fallbackIdSequence += 1;
    } while (issuedIds.has(`${prefix}-${fallbackIdSequence}`));
    const fallback = `${prefix}-${fallbackIdSequence}`;
    issuedIds.add(fallback);
    return fallback;
  }

  function registerDocumentIds(value) {
    issuedIds.clear();
    if (!value) return;
    issuedIds.add(value.documentId);
    for (const frame of value.keyframes) {
      issuedIds.add(frame.id);
      for (const object of frame.objects) issuedIds.add(object.id);
    }
  }

  function rebuildByteAccounting(value) {
    documentBytes = jsonBytes(value);
    objectCount = 0;
    frameBytesByFrame = new Map();
    recordBytesByFrame = new Map();
    for (const frame of value.keyframes) {
      const recordBytes = new Map();
      for (const object of frame.objects) {
        recordBytes.set(object.id, jsonBytes(object));
      }
      recordBytesByFrame.set(frame.frame, recordBytes);
      frameBytesByFrame.set(frame.frame, calculateFrameBytes(frame, recordBytes));
      objectCount += frame.objects.length;
    }
  }

  function installReady(value, nextContext, nextSceneInstances = new Map()) {
    documentValue = clonePlain(value);
    opaqueRootValue = null;
    context = { ...nextContext };
    state = 'ready';
    incompatibleReason = null;
    sceneInstances = new Map(nextSceneInstances);
    registerDocumentIds(documentValue);
    rebuildByteAccounting(documentValue);
  }

  function installOpaque(value, reason, nextContext) {
    documentValue = null;
    opaqueRootValue = cloneOpaque(value);
    context = nextContext ? { ...nextContext } : context;
    state = 'incompatible';
    incompatibleReason = reason;
    sceneInstances = new Map();
    issuedIds.clear();
    documentBytes = 0;
    objectCount = 0;
    frameBytesByFrame = new Map();
    recordBytesByFrame = new Map();
  }

  function invalidate(reason = 'unavailable') {
    documentValue = null;
    opaqueRootValue = null;
    context = {
      hostGeneration: null,
      videoGeneration: null,
      persistenceSessionId: null,
      stableVideoIdentity: null
    };
    state = 'unavailable';
    incompatibleReason =
      typeof reason === 'string' && reason.length > 0
        ? reason.slice(0, 512)
        : 'unavailable';
    sceneInstances = new Map();
    issuedIds.clear();
    documentBytes = 0;
    objectCount = 0;
    frameBytesByFrame = new Map();
    recordBytesByFrame = new Map();
    return true;
  }

  function reset(meta = {}) {
    const nextContext = normalizeContext(meta);
    if (!nextContext) {
      return { accepted: false, compatible: false, reason: 'invalid-metadata' };
    }
    issuedIds.clear();
    const documentId = meta.documentId || allocateId('fabric-document');
    const candidate = createRootValue({
      documentId,
      fps: meta.fps,
      totalFrames: meta.totalFrames
    });
    installReady(candidate, nextContext);
    return { accepted: true, compatible: true, reason: null };
  }

  function importRootValue(raw, meta = {}) {
    if (raw === null || raw === undefined) return reset(meta);
    const rawHasValidTimeline = isPlainRecord(raw) &&
      validateFpsAndFrames(raw.fps, raw.totalFrames);
    const nextContext = normalizeContext({
      ...meta,
      fps: rawHasValidTimeline ? raw.fps : meta.fps,
      totalFrames: rawHasValidTimeline ? raw.totalFrames : meta.totalFrames
    });
    if (!nextContext) {
      return { accepted: false, compatible: false, reason: 'invalid-metadata' };
    }

    if (isPlainRecord(raw) &&
        raw.storageSchema === STORAGE_SCHEMA &&
        typeof raw.storageVersion === 'string' &&
        raw.storageVersion !== STORAGE_VERSION) {
      installOpaque(raw, 'unsupported-storage-version', nextContext);
      return {
        accepted: false,
        compatible: false,
        reason: 'unsupported-storage-version',
        preserved: true
      };
    }

    const validation = validateRootValue(raw, limits);
    if (!validation.valid) {
      installOpaque(raw, validation.reason, nextContext);
      return {
        accepted: false,
        compatible: false,
        reason: validation.reason,
        preserved: true
      };
    }
    installReady(raw, nextContext);
    return { accepted: true, compatible: true, reason: null };
  }

  function emitChange(value) {
    for (const listener of [...listeners]) {
      try {
        listener(clonePlain(value));
      } catch (_error) {
        // Persistence observers are isolated from the authoritative drawing cache.
      }
    }
  }

  function applyTransition(event) {
    if (state !== 'ready' || !documentValue) {
      return eventFailure('store-incompatible');
    }
    if (!exactEventEnvelope(event)) return eventFailure('invalid-transition');
    if (context.persistenceSessionId === null) {
      return eventFailure('unbound-persistence-session');
    }
    if (!fenceMatches(context, event)) return eventFailure('stale-fence');
    if (event.scene.targetFrame >= documentValue.totalFrames) {
      return eventFailure('invalid-transition');
    }

    const frameIndex = documentValue.keyframes.findIndex(
      keyframe => keyframe.frame === event.scene.targetFrame
    );
    const currentFrame = frameIndex >= 0 ? documentValue.keyframes[frameIndex] : null;
    const currentSequence = currentFrame?.mutationSequence || 0;
    if (event.mutationSequence === currentSequence) {
      return eventFailure('duplicate-transition');
    }
    if (event.mutationSequence < currentSequence) {
      return eventFailure('stale-transition');
    }
    if (event.mutationSequence !== currentSequence + 1) {
      return eventFailure('sequence-gap', true);
    }

    const knownSceneInstance = sceneInstances.get(event.scene.targetFrame);
    if (knownSceneInstance && knownSceneInstance !== event.scene.sceneInstanceId) {
      return eventFailure('stale-scene', true);
    }
    if (currentFrame &&
        (currentFrame.sourceWidth !== event.scene.sourceWidth ||
         currentFrame.sourceHeight !== event.scene.sourceHeight)) {
      return eventFailure('scene-metadata-mismatch', true);
    }
    if (event.unsupportedReason !== null) {
      return eventFailure('unsupported-transition', true);
    }
    if (event.estimatedBytes > limits.maxTransitionBytes ||
        jsonBytes(event) > limits.maxTransitionBytes) {
      return eventFailure('transition-too-large', true);
    }
    if (!event.removals.every(validateRemoval) ||
        !event.insertions.every(value => validateInsertion(value, limits)) ||
        !event.transforms.every(validateTransformChange)) {
      return eventFailure('invalid-transition', true);
    }
    const removals = [...event.removals];
    const insertions = [...event.insertions];
    if (removals.some((item, index) =>
      index > 0 && removals[index - 1].index >= item.index) ||
      insertions.some((item, index) =>
        index > 0 && insertions[index - 1].index > item.index)) {
      return eventFailure('invalid-transition', true);
    }
    const removalIds = new Set(removals.map(item => item.id));
    const insertionIds = new Set(insertions.map(item => item.record.id));
    const transformIds = new Set(event.transforms.map(item => item.id));
    if (removalIds.size !== removals.length ||
        insertionIds.size !== insertions.length ||
        transformIds.size !== event.transforms.length) {
      return eventFailure('duplicate-object-id', true);
    }

    const objects = currentFrame ? [...currentFrame.objects] : [];
    const nextRecordBytes = new Map(
      recordBytesByFrame.get(event.scene.targetFrame) || []
    );
    for (const removal of removals) {
      if (removal.index >= objects.length || objects[removal.index]?.id !== removal.id) {
        return eventFailure('transition-before-mismatch', true);
      }
    }
    for (let index = removals.length - 1; index >= 0; index -= 1) {
      nextRecordBytes.delete(removals[index].id);
      objects.splice(removals[index].index, 1);
    }

    const liveIds = new Set(objects.map(object => object.id));
    for (const insertion of insertions) {
      if (insertion.index > objects.length || liveIds.has(insertion.record.id)) {
        return eventFailure('duplicate-object-id', true);
      }
      if (insertion.baseTransform !== null &&
          !sameTransform(insertion.record.transform, insertion.baseTransform)) {
        return eventFailure('transition-before-mismatch', true);
      }
      const inserted = clonePlain(insertion.record);
      const insertedBytes = jsonBytes(inserted);
      if (!Number.isFinite(insertedBytes)) {
        return eventFailure('invalid-transition', true);
      }
      objects.splice(insertion.index, 0, inserted);
      liveIds.add(inserted.id);
      nextRecordBytes.set(inserted.id, insertedBytes);
    }

    const effectiveTransforms = [];
    for (const transform of event.transforms) {
      const objectIndex = objects.findIndex(object => object.id === transform.id);
      if (objectIndex < 0 ||
          !sameTransform(objects[objectIndex].transform, transform.beforeTransform)) {
        return eventFailure('transition-before-mismatch', true);
      }
      if (sameTransform(transform.beforeTransform, transform.afterTransform)) continue;
      const transformedObject = {
        ...objects[objectIndex],
        transform: clonePlain(transform.afterTransform)
      };
      const transformedBytes = jsonBytes(transformedObject);
      if (!Number.isFinite(transformedBytes)) {
        return eventFailure('invalid-transition', true);
      }
      objects[objectIndex] = transformedObject;
      nextRecordBytes.set(transform.id, transformedBytes);
      effectiveTransforms.push(transform);
    }
    if (removals.length === 0 && insertions.length === 0 && effectiveTransforms.length === 0) {
      return eventFailure('no-op');
    }
    if (deriveTransitionKind({ ...event, transforms: effectiveTransforms }) !== event.kind) {
      return eventFailure('invalid-transition', true);
    }

    const nextObjectCount = objectCount - (currentFrame?.objects.length || 0) + objects.length;
    if (objects.length > limits.maxObjectsPerKeyframe ||
        nextObjectCount > limits.maxObjectsTotal ||
        (!currentFrame && documentValue.keyframes.length >= limits.maxKeyframes) ||
        documentValue.revision >= Number.MAX_SAFE_INTEGER) {
      return eventFailure('document-too-large', true);
    }

    const nextFrame = {
      id: currentFrame?.id || allocateId('fabric-keyframe'),
      frame: event.scene.targetFrame,
      sourceWidth: event.scene.sourceWidth,
      sourceHeight: event.scene.sourceHeight,
      mutationSequence: event.mutationSequence,
      objects
    };
    const nextRevision = documentValue.revision + 1;
    const nextKeyframes = [...documentValue.keyframes];
    if (frameIndex >= 0) nextKeyframes[frameIndex] = nextFrame;
    else {
      nextKeyframes.push(nextFrame);
      nextKeyframes.sort((left, right) => left.frame - right.frame);
    }
    const nextFrameBytes = calculateFrameBytes(nextFrame, nextRecordBytes);
    const nextDocumentBytes = documentBytes -
      (currentFrame ? frameBytesByFrame.get(currentFrame.frame) : 0) +
      nextFrameBytes +
      (currentFrame ? 0 : (documentValue.keyframes.length > 0 ? 1 : 0)) +
      jsonBytes(nextRevision) -
      jsonBytes(documentValue.revision);
    if (!Number.isFinite(nextDocumentBytes) ||
        nextDocumentBytes > limits.maxDocumentBytes) {
      return eventFailure('document-too-large', true);
    }

    documentValue = {
      ...documentValue,
      revision: nextRevision,
      keyframes: nextKeyframes
    };
    documentBytes = nextDocumentBytes;
    objectCount = nextObjectCount;
    frameBytesByFrame.set(nextFrame.frame, nextFrameBytes);
    recordBytesByFrame.set(nextFrame.frame, nextRecordBytes);
    sceneInstances.set(event.scene.targetFrame, event.scene.sceneInstanceId);
    context = {
      hostGeneration: event.hostGeneration,
      videoGeneration: event.videoGeneration,
      persistenceSessionId: event.persistenceSessionId,
      stableVideoIdentity: event.stableVideoIdentity
    };
    emitChange({
      kind: event.kind,
      origin: event.origin,
      frame: event.scene.targetFrame,
      mutationSequence: event.mutationSequence,
      revision: documentValue.revision
    });
    return { applied: true, revision: documentValue.revision };
  }

  function validateOverlaySnapshot(snapshot) {
    if (!hasExactKeys(snapshot, OVERLAY_KEYS) ||
        !isSafeCount(snapshot.hostGeneration) ||
        !isSafeCount(snapshot.videoGeneration) ||
        !isNonemptyString(snapshot.persistenceSessionId, 32768) ||
        !isNonemptyString(snapshot.stableVideoIdentity, 32768) ||
        !validateFpsAndFrames(snapshot.fps, snapshot.totalFrames) ||
        !isDenseArray(snapshot.scenes) ||
        snapshot.scenes.length > limits.maxKeyframes) {
      return { valid: false, reason: 'invalid-overlay-snapshot' };
    }
    if (!fenceMatches(context, snapshot, false)) {
      return { valid: false, reason: 'stale-fence' };
    }
    const frames = new Set();
    const sceneIds = new Set();
    let objectCount = 0;
    for (const scene of snapshot.scenes) {
      if (!hasExactKeys(scene, OVERLAY_SCENE_KEYS) ||
          !isNonemptyString(scene.sceneInstanceId, 512) ||
          !Number.isSafeInteger(scene.targetFrame) || scene.targetFrame < 0 ||
          scene.targetFrame >= snapshot.totalFrames ||
          !isPositiveFinite(scene.sourceWidth) ||
          scene.sourceWidth > MAX_SOURCE_DIMENSION ||
          !isPositiveFinite(scene.sourceHeight) ||
          scene.sourceHeight > MAX_SOURCE_DIMENSION ||
          !isSafeCount(scene.mutationSequence) ||
          !isDenseArray(scene.objects) ||
          scene.objects.length > limits.maxObjectsPerKeyframe ||
          frames.has(scene.targetFrame) ||
          sceneIds.has(scene.sceneInstanceId)) {
        return { valid: false, reason: 'invalid-overlay-snapshot' };
      }
      const objectIds = new Set();
      for (const object of scene.objects) {
        if (!validateRecord(object, limits) || objectIds.has(object.id)) {
          return { valid: false, reason: 'invalid-overlay-snapshot' };
        }
        objectIds.add(object.id);
      }
      objectCount += scene.objects.length;
      if (objectCount > limits.maxObjectsTotal) {
        return { valid: false, reason: 'document-too-large' };
      }
      frames.add(scene.targetFrame);
      sceneIds.add(scene.sceneInstanceId);
    }
    if (jsonBytes(snapshot) > limits.maxDocumentBytes) {
      return { valid: false, reason: 'document-too-large' };
    }
    return { valid: true };
  }

  function replaceFromOverlay(snapshot, replaceOptions = {}) {
    if (state !== 'ready' || !documentValue) {
      return { accepted: false, reason: 'store-incompatible' };
    }
    const mode = replaceOptions.mode || 'hydrate';
    if (mode !== 'hydrate' && mode !== 'resync') {
      return { accepted: false, reason: 'invalid-replace-mode' };
    }
    const validation = validateOverlaySnapshot(snapshot);
    if (!validation.valid) return { accepted: false, reason: validation.reason };
    if (snapshot.fps !== documentValue.fps ||
        snapshot.totalFrames !== documentValue.totalFrames) {
      return { accepted: false, reason: 'timeline-mismatch' };
    }
    if (context.persistenceSessionId === null) {
      if (mode !== 'hydrate' || replaceOptions.adoptPersistenceSession !== true) {
        return { accepted: false, reason: 'unbound-persistence-session' };
      }
    } else if (snapshot.persistenceSessionId !== context.persistenceSessionId) {
      return { accepted: false, reason: 'stale-persistence-session' };
    }

    const existingByFrame = new Map(documentValue.keyframes.map(frame => [frame.frame, frame]));
    const nextSceneInstances = new Map();
    const nextKeyframes = [...snapshot.scenes]
      .sort((left, right) => left.targetFrame - right.targetFrame)
      .map(scene => {
        const existing = existingByFrame.get(scene.targetFrame);
        nextSceneInstances.set(scene.targetFrame, scene.sceneInstanceId);
        return {
          id: existing?.id || allocateId('fabric-keyframe'),
          frame: scene.targetFrame,
          sourceWidth: scene.sourceWidth,
          sourceHeight: scene.sourceHeight,
          mutationSequence: scene.mutationSequence,
          objects: clonePlain(scene.objects)
        };
      });
    let nextDocument = {
      ...clonePlain(documentValue),
      fps: snapshot.fps,
      totalFrames: snapshot.totalFrames,
      keyframes: nextKeyframes
    };
    const documentValidation = validateRootValue(nextDocument, limits);
    if (!documentValidation.valid) {
      return { accepted: false, reason: documentValidation.reason };
    }
    const nextContext = {
      hostGeneration: snapshot.hostGeneration,
      videoGeneration: snapshot.videoGeneration,
      persistenceSessionId: snapshot.persistenceSessionId,
      stableVideoIdentity: snapshot.stableVideoIdentity
    };
    if (mode === 'hydrate') {
      installReady(nextDocument, nextContext, nextSceneInstances);
      return { accepted: true, revision: documentValue.revision };
    }

    const changed = JSON.stringify({
      fps: documentValue.fps,
      totalFrames: documentValue.totalFrames,
      keyframes: documentValue.keyframes
    }) !== JSON.stringify({
      fps: nextDocument.fps,
      totalFrames: nextDocument.totalFrames,
      keyframes: nextDocument.keyframes
    });
    if (!changed) {
      installReady(nextDocument, nextContext, nextSceneInstances);
      return { accepted: true, revision: documentValue.revision, changed: false };
    }
    if (documentValue.revision >= Number.MAX_SAFE_INTEGER) {
      return { accepted: false, reason: 'revision-overflow' };
    }
    nextDocument = { ...nextDocument, revision: documentValue.revision + 1 };
    const reconciledValidation = validateRootValue(nextDocument, limits);
    if (!reconciledValidation.valid) {
      return { accepted: false, reason: reconciledValidation.reason };
    }
    installReady(nextDocument, nextContext, nextSceneInstances);
    emitChange({
      kind: 'snapshot-resync',
      origin: 'resync',
      frame: null,
      mutationSequence: null,
      revision: documentValue.revision
    });
    return { accepted: true, revision: documentValue.revision, changed: true };
  }

  function exportRootValue() {
    if (state === 'ready' && documentValue) return clonePlain(documentValue);
    return cloneOpaque(opaqueRootValue);
  }

  function getHydrationDocument() {
    if (state !== 'ready' || !documentValue) return null;
    return clonePlain({
      documentId: documentValue.documentId,
      revision: documentValue.revision,
      fps: documentValue.fps,
      totalFrames: documentValue.totalFrames,
      keyframes: documentValue.keyframes
    });
  }

  function getStatus() {
    if (state !== 'ready' || !documentValue) {
      return {
        state: ['uninitialized', 'unavailable'].includes(state)
          ? state
          : 'incompatible',
        compatible: false,
        reason: incompatibleReason,
        revision: null,
        keyframeCount: 0,
        objectCount: 0
      };
    }
    return {
      state: 'ready',
      compatible: true,
      reason: null,
      revision: documentValue.revision,
      keyframeCount: documentValue.keyframes.length,
      objectCount
    };
  }

  function getRevision() {
    return state === 'ready' && documentValue ? documentValue.revision : null;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    importRootValue,
    reset,
    invalidate,
    applyTransition,
    replaceFromOverlay,
    exportRootValue,
    getHydrationDocument,
    getStatus,
    getRevision,
    subscribe
  });
}

export const FABRIC_DRAWING_STORAGE = Object.freeze({
  schema: STORAGE_SCHEMA,
  version: STORAGE_VERSION,
  engine: STORAGE_ENGINE,
  limits: DEFAULT_LIMITS
});
