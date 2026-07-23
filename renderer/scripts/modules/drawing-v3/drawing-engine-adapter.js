'use strict';

const {
  createDrawingDocumentV3
} = require('./drawing-document.js');

const DEFAULT_LIMITS = Object.freeze({
  maxSeedObjects: 10_000,
  maxSeedBytes: 32 * 1024 * 1024,
  maxQueueItems: 128,
  maxQueueBytes: 32 * 1024 * 1024,
  maxWorkItems: 4,
  maxWorkMs: 4,
  maxLatencySamples: 256
});
const LIMIT_KEYS = Object.freeze(Object.keys(DEFAULT_LIMITS));
const UNSUPPORTED_TRANSFORM_FIELDS = Object.freeze([
  'scaleX',
  'scaleY',
  'angle',
  'skewX',
  'skewY',
  'flipX',
  'flipY'
]);
const TRANSFORM_FIELDS = Object.freeze([
  'left',
  'top',
  ...UNSUPPORTED_TRANSFORM_FIELDS
]);
const REASON_ALLOWLIST = Object.freeze(new Set([
  'adapter-failed',
  'document-rejected',
  'document-sequence-mismatch',
  'invalid-seed',
  'invalid-transition',
  'missing-baseline',
  'observer-failed',
  'queue-capacity-exceeded',
  'queue-event-too-large',
  'scheduler-failed',
  'seed-capacity-exceeded',
  'seed-signature-changed',
  'sequence-gap',
  'stale-transition',
  'transition-before-mismatch',
  'unsupported-field-mutation',
  'unsupported-order-mutation',
  'unsupported-transform',
  'warm-seed-mismatch'
]));
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isNonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function resolveLimits(value) {
  if (value === undefined) return { ...DEFAULT_LIMITS };
  if (!isPlainRecord(value) || Reflect.ownKeys(value).some(key =>
    typeof key !== 'string' || !LIMIT_KEYS.includes(key))) {
    throw new TypeError('Invalid DrawingEngineAdapter limits');
  }
  const limits = { ...DEFAULT_LIMITS, ...value };
  for (const key of LIMIT_KEYS) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0) {
      throw new TypeError('Invalid DrawingEngineAdapter limits');
    }
  }
  if (limits.maxWorkItems > DEFAULT_LIMITS.maxWorkItems ||
    limits.maxWorkMs > DEFAULT_LIMITS.maxWorkMs) {
    throw new TypeError('Invalid DrawingEngineAdapter limits');
  }
  return limits;
}

function defaultCreateId(prefix) {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  defaultCreateId.sequence = (defaultCreateId.sequence || 0) + 1;
  return `${prefix}-${Date.now()}-${defaultCreateId.sequence}`;
}

function defaultLatencyNow() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function clonePlain(value) {
  return structuredClone(value);
}

function sanitizeReason(reason) {
  return REASON_ALLOWLIST.has(reason) ? reason : 'adapter-failed';
}

function snapshotTransitionEnvelope(event) {
  return {
    ...event,
    scene: isPlainRecord(event.scene) ? { ...event.scene } : event.scene,
    removals: Array.isArray(event.removals)
      ? event.removals.map(item => isPlainRecord(item) ? { ...item } : item)
      : event.removals,
    insertions: Array.isArray(event.insertions)
      ? event.insertions.map(item => isPlainRecord(item)
        ? {
          ...item,
          baseTransform: isPlainRecord(item.baseTransform)
            ? { ...item.baseTransform }
            : item.baseTransform
        }
        : item)
      : event.insertions,
    transforms: Array.isArray(event.transforms)
      ? event.transforms.map(item => isPlainRecord(item)
        ? {
          ...item,
          beforeTransform: isPlainRecord(item.beforeTransform)
            ? { ...item.beforeTransform }
            : item.beforeTransform,
          afterTransform: isPlainRecord(item.afterTransform)
            ? { ...item.afterTransform }
            : item.afterTransform
        }
        : item)
      : event.transforms
  };
}

function normalizeFabricTransform(value) {
  if (!isPlainRecord(value)) return null;
  const defaults = {
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false
  };
  const transform = {};
  for (const field of TRANSFORM_FIELDS) {
    const candidate = Object.hasOwn(value, field) ? value[field] : defaults[field];
    if (field === 'flipX' || field === 'flipY') {
      if (typeof candidate !== 'boolean') return null;
    } else if (!Number.isFinite(candidate)) {
      return null;
    }
    transform[field] = candidate;
  }
  if (transform.scaleX === 0 || transform.scaleY === 0) return null;
  return transform;
}

function transformsEqual(left, right, fields = TRANSFORM_FIELDS) {
  return fields.every(field => left[field] === right[field]);
}

function canonicalTransform(finalTransform, baseline) {
  if (!transformsEqual(finalTransform, baseline, UNSUPPORTED_TRANSFORM_FIELDS)) {
    return null;
  }
  return [
    1,
    0,
    0,
    1,
    finalTransform.left - baseline.left,
    finalTransform.top - baseline.top
  ];
}

function hashText(text, seed, multiplier) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), multiplier) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function immutableContentSignature(object) {
  const serialized = JSON.stringify({
    id: object.id,
    type: object.type,
    tool: object.tool,
    visible: object.visible,
    locked: object.locked,
    opacity: object.opacity,
    blendMode: object.blendMode,
    points: object.points,
    caps: object.caps,
    style: object.style
  });
  return `${serialized.length}:` +
    `${hashText(serialized, 0x811c9dc5, 0x01000193)}:` +
    hashText(serialized, 0x9e3779b9, 0x85ebca6b);
}

function canonicalizeRecord(record, baseline) {
  if (!isPlainRecord(record) || !isNonemptyString(record.id) ||
    record.type !== 'stroke' || !Array.isArray(record.sourcePoints) ||
    record.sourcePoints.length === 0 || !isPlainRecord(record.style) ||
    !HEX_COLOR_PATTERN.test(record.style.color) ||
    !Number.isFinite(record.style.size) || record.style.size <= 0 ||
    !Number.isFinite(record.style.opacity) || record.style.opacity < 0 ||
    record.style.opacity > 1) {
    return { valid: false, reason: 'invalid-transition' };
  }
  const finalTransform = normalizeFabricTransform(record.transform);
  const normalizedBaseline = normalizeFabricTransform(baseline);
  if (finalTransform === null || normalizedBaseline === null) {
    return { valid: false, reason: 'invalid-transition' };
  }
  const transform = canonicalTransform(finalTransform, normalizedBaseline);
  if (transform === null) {
    return { valid: false, reason: 'unsupported-transform' };
  }

  const points = [];
  let previousTime = 0;
  for (const point of record.sourcePoints) {
    if (!isPlainRecord(point) || !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) || !Number.isFinite(point.pressure) ||
      point.pressure < 0 || point.pressure > 1 ||
      !Number.isFinite(point.time) || point.time < previousTime ||
      point.time < 0) {
      return { valid: false, reason: 'invalid-transition' };
    }
    points.push({
      x: point.x,
      y: point.y,
      pressure: point.pressure,
      time: point.time
    });
    previousTime = point.time;
  }

  let caps = { start: true, end: true };
  if (record.strokeCaps !== undefined) {
    if (!isPlainRecord(record.strokeCaps) ||
      typeof record.strokeCaps.start !== 'boolean' ||
      typeof record.strokeCaps.end !== 'boolean') {
      return { valid: false, reason: 'invalid-transition' };
    }
    caps = {
      start: record.strokeCaps.start,
      end: record.strokeCaps.end
    };
  }
  const object = {
    id: record.id,
    type: 'stroke',
    tool: 'brush',
    visible: true,
    locked: false,
    opacity: record.style.opacity,
    blendMode: 'source-over',
    transform,
    points,
    caps,
    style: {
      color: record.style.color.toLowerCase(),
      size: record.style.size,
      thinning: 0.65,
      smoothing: 0.55,
      streamline: 0.5,
      outlineColor: null,
      outlineWidth: 0
    }
  };
  let estimatedBytes;
  let contentSignature;
  try {
    estimatedBytes = Math.max(1, JSON.stringify(object).length * 2);
    contentSignature = immutableContentSignature(object);
  } catch (_error) {
    return { valid: false, reason: 'invalid-transition' };
  }
  return {
    valid: true,
    object,
    finalTransform,
    baseline: normalizedBaseline,
    contentSignature,
    estimatedBytes
  };
}

function makeSceneSignature(scene) {
  if (!isPlainRecord(scene) || !isNonemptyString(scene.sceneInstanceId) ||
    !Number.isFinite(scene.sourceWidth) || scene.sourceWidth <= 0 ||
    !Number.isFinite(scene.sourceHeight) || scene.sourceHeight <= 0 ||
    !isNonnegativeSafeInteger(scene.targetFrame) ||
    !Number.isSafeInteger(scene.targetFrame + 1) ||
    scene.targetFrame + 1 <= 0) {
    return null;
  }
  return {
    targetFrame: scene.targetFrame,
    sourceWidth: scene.sourceWidth,
    sourceHeight: scene.sourceHeight
  };
}

function signaturesEqual(left, right) {
  return left.targetFrame === right.targetFrame &&
    left.sourceWidth === right.sourceWidth &&
    left.sourceHeight === right.sourceHeight;
}

function percentile(samples, ratio) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function createDrawingEngineAdapter(options = {}) {
  if (!isPlainRecord(options)) {
    throw new TypeError('Invalid DrawingEngineAdapter options');
  }
  const createDocument = options.createDocument || createDrawingDocumentV3;
  const createId = options.createId || defaultCreateId;
  const nowIso = options.nowIso || (() => new Date().toISOString());
  const latencyNow = options.latencyNow || defaultLatencyNow;
  const scheduleWork = options.scheduleWork || (callback => setTimeout(callback, 0));
  const fallbackScheduleWork = options.fallbackScheduleWork ||
    (callback => setTimeout(callback, 0));
  if (typeof createDocument !== 'function' || typeof createId !== 'function' ||
    typeof nowIso !== 'function' || typeof latencyNow !== 'function' ||
    typeof scheduleWork !== 'function' ||
    typeof fallbackScheduleWork !== 'function') {
    throw new TypeError('Invalid DrawingEngineAdapter options');
  }
  const limits = resolveLimits(options.limits);
  const scenes = new Map();
  const queue = [];
  const aggregate = {
    bootstrapCount: 0,
    commitCount: 0,
    failureCount: 0,
    divergenceCount: 0,
    resyncCount: 0,
    staleCount: 0,
    gapCount: 0,
    latencies: []
  };
  let queueBytes = 0;
  let workScheduled = false;
  let destroyed = false;
  let schedulerGeneration = 0;

  function deferSynchronousWork(callback) {
    globalThis.setTimeout(callback, 0);
  }

  function invokeScheduler(scheduler, callback) {
    let schedulerReturned = false;
    scheduler(() => {
      if (!schedulerReturned) {
        deferSynchronousWork(callback);
        return;
      }
      callback();
    });
    schedulerReturned = true;
  }

  function emptyState(sceneInstanceId, signature = null) {
    return {
      sceneInstanceId,
      signature,
      status: 'initializing',
      lastReason: null,
      document: null,
      layerId: null,
      keyframeId: null,
      actorId: null,
      headSequence: 0,
      objectOrder: [],
      baselines: new Map(),
      contentSignatures: new Map(),
      currentTransforms: new Map(),
      objectBytes: new Map(),
      estimatedBytes: 0,
      bootstrapCount: 0,
      commitCount: 0,
      failureCount: 0,
      divergenceCount: 0,
      resyncCount: 0,
      staleCount: 0,
      gapCount: 0,
      latencies: []
    };
  }

  function removeQueuedScene(sceneInstanceId) {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].sceneInstanceId !== sceneInstanceId) continue;
      queueBytes = Math.max(0, queueBytes - queue[index].estimatedBytes);
      queue.splice(index, 1);
    }
    if (queue.length === 0 && workScheduled) {
      workScheduled = false;
      schedulerGeneration += 1;
    }
  }

  function quarantineInternal(sceneInstanceId, rawReason) {
    const state = scenes.get(sceneInstanceId);
    if (!state) return false;
    const reason = sanitizeReason(rawReason);
    removeQueuedScene(sceneInstanceId);
    if (state.status !== 'desynced') {
      state.status = 'desynced';
      state.lastReason = reason;
      state.failureCount += 1;
      state.divergenceCount += 1;
      aggregate.failureCount += 1;
      aggregate.divergenceCount += 1;
    }
    return false;
  }

  function failResult(state, reason) {
    quarantineInternal(state.sceneInstanceId, reason);
    return { applied: false, reason: sanitizeReason(reason) };
  }

  function makeOpaqueId(prefix) {
    const id = createId(prefix);
    if (!isNonemptyString(id)) throw new TypeError('Invalid opaque ID');
    return id;
  }

  function projectPendingWarmState(state) {
    let sequence = state.headSequence;
    let order = state.objectOrder.slice();
    for (const item of queue) {
      if (item.sceneInstanceId !== state.sceneInstanceId) continue;
      const event = item.event;
      if (event.mutationSequence !== sequence + 1 ||
        !Array.isArray(event.removals) ||
        !Array.isArray(event.insertions)) {
        return null;
      }
      const removalIds = new Set();
      for (const removal of event.removals) {
        if (!isPlainRecord(removal) || !isNonemptyString(removal.id) ||
          !isNonnegativeSafeInteger(removal.index) ||
          removalIds.has(removal.id) || order[removal.index] !== removal.id) {
          return null;
        }
        removalIds.add(removal.id);
      }
      order = order.filter(id => !removalIds.has(id));
      const insertions = event.insertions.slice().sort((left, right) =>
        Number(left?.index) - Number(right?.index));
      const insertionIds = new Set();
      let previousIndex = -1;
      for (const insertion of insertions) {
        const objectId = insertion?.record?.id;
        if (!isPlainRecord(insertion) ||
          !isNonnegativeSafeInteger(insertion.index) ||
          insertion.index <= previousIndex ||
          !isNonemptyString(objectId) || insertionIds.has(objectId) ||
          order.includes(objectId) || insertion.index > order.length) {
          return null;
        }
        previousIndex = insertion.index;
        insertionIds.add(objectId);
        order.splice(insertion.index, 0, objectId);
      }
      sequence = event.mutationSequence;
    }
    return { sequence, order };
  }

  function mapOrderMatches(objects, order) {
    if (!(objects instanceof Map) || objects.size !== order.length) return false;
    let index = 0;
    for (const objectId of objects.keys()) {
      if (objectId !== order[index]) return false;
      index += 1;
    }
    return true;
  }

  function activateScene(scene, authoritativeObjects) {
    let sceneInstanceId = null;
    try {
      sceneInstanceId = isPlainRecord(scene) &&
        isNonemptyString(scene.sceneInstanceId)
        ? scene.sceneInstanceId
        : null;
      if (destroyed || sceneInstanceId === null) {
        return { activated: false, restored: false, reason: 'invalid-seed' };
      }
      const signature = makeSceneSignature(scene);
      const existing = scenes.get(sceneInstanceId);
      if (existing) {
        const pendingState = projectPendingWarmState(existing);
        if (signature === null) {
          quarantineInternal(sceneInstanceId, 'invalid-seed');
        } else if (!signaturesEqual(existing.signature, signature)) {
          quarantineInternal(sceneInstanceId, 'seed-signature-changed');
        } else if (pendingState === null ||
          !isNonnegativeSafeInteger(scene.mutationSequence) ||
          scene.mutationSequence !== pendingState.sequence ||
          !mapOrderMatches(authoritativeObjects, pendingState.order)) {
          quarantineInternal(sceneInstanceId, 'warm-seed-mismatch');
        }
        if (existing.status !== 'synced') {
          return {
            activated: false,
            restored: true,
            reason: existing.lastReason
          };
        }
        return { activated: true, restored: true };
      }

      const state = emptyState(sceneInstanceId, signature);
      scenes.set(sceneInstanceId, state);
      if (signature === null || !isNonnegativeSafeInteger(scene.mutationSequence) ||
        !(authoritativeObjects instanceof Map)) {
        quarantineInternal(sceneInstanceId, 'invalid-seed');
        return { activated: false, restored: false, reason: 'invalid-seed' };
      }
      if (authoritativeObjects.size > limits.maxSeedObjects) {
        quarantineInternal(sceneInstanceId, 'seed-capacity-exceeded');
        return {
          activated: false,
          restored: false,
          reason: 'seed-capacity-exceeded'
        };
      }

      const canonicalObjects = [];
      const objectOrder = [];
      const baselines = new Map();
      const currentTransforms = new Map();
      const contentSignatures = new Map();
      const objectBytes = new Map();
      let estimatedBytes = 0;
      for (const [objectId, record] of authoritativeObjects) {
        if (!isNonemptyString(objectId) || objectId !== record?.id ||
          baselines.has(objectId)) {
          quarantineInternal(sceneInstanceId, 'invalid-seed');
          return { activated: false, restored: false, reason: 'invalid-seed' };
        }
        const baseline = normalizeFabricTransform(record.transform);
        const converted = canonicalizeRecord(record, baseline);
        if (!converted.valid) {
          const reason = 'invalid-seed';
          quarantineInternal(sceneInstanceId, reason);
          return { activated: false, restored: false, reason };
        }
        estimatedBytes += converted.estimatedBytes;
        if (!Number.isSafeInteger(estimatedBytes) ||
          estimatedBytes > limits.maxSeedBytes) {
          quarantineInternal(sceneInstanceId, 'seed-capacity-exceeded');
          return {
            activated: false,
            restored: false,
            reason: 'seed-capacity-exceeded'
          };
        }
        canonicalObjects.push(converted.object);
        objectOrder.push(objectId);
        baselines.set(objectId, converted.baseline);
        currentTransforms.set(objectId, converted.finalTransform);
        contentSignatures.set(objectId, converted.contentSignature);
        objectBytes.set(objectId, converted.estimatedBytes);
      }

      const documentId = makeOpaqueId('document');
      const layerId = makeOpaqueId('layer');
      const keyframeId = makeOpaqueId('keyframe');
      const actorId = makeOpaqueId('actor');
      const document = createDocument({
        documentId,
        coordinateSpace: {
          unit: 'source-pixel',
          origin: 'top-left',
          yAxis: 'down',
          pixelRatio: 1,
          width: signature.sourceWidth,
          height: signature.sourceHeight
        },
        timebase: {
          fpsNumerator: 1,
          fpsDenominator: 1,
          totalFrames: signature.targetFrame + 1
        },
        initialLayers: [{
          id: layerId,
          name: 'Session shadow',
          visible: true,
          locked: false,
          opacity: 1,
          keyframes: [{
            id: keyframeId,
            frame: signature.targetFrame,
            empty: false,
            revision: 0,
            objects: canonicalObjects
          }]
        }],
        revisionSequence: scene.mutationSequence
      });
      if (!document || typeof document.applyCommand !== 'function' ||
        typeof document.getContentSnapshot !== 'function' ||
        typeof document.getHead !== 'function' ||
        document.getHead()?.sequence !== scene.mutationSequence) {
        throw new TypeError('Invalid DrawingDocumentV3 instance');
      }
      state.status = 'synced';
      state.document = document;
      state.layerId = layerId;
      state.keyframeId = keyframeId;
      state.actorId = actorId;
      state.headSequence = scene.mutationSequence;
      state.objectOrder = objectOrder;
      state.baselines = baselines;
      state.currentTransforms = currentTransforms;
      state.contentSignatures = contentSignatures;
      state.objectBytes = objectBytes;
      state.estimatedBytes = estimatedBytes;
      state.bootstrapCount = 1;
      aggregate.bootstrapCount += 1;
      return { activated: true, restored: false };
    } catch (_error) {
      if (sceneInstanceId !== null) {
        if (!scenes.has(sceneInstanceId)) {
          scenes.set(sceneInstanceId, emptyState(sceneInstanceId));
        }
        quarantineInternal(sceneInstanceId, 'adapter-failed');
      }
      return {
        activated: false,
        restored: false,
        reason: 'adapter-failed'
      };
    }
  }

  function validateEventEnvelope(event, state) {
    if (!isPlainRecord(event) || !isPlainRecord(event.scene) ||
      event.scene.sceneInstanceId !== state.sceneInstanceId ||
      !isNonnegativeSafeInteger(event.mutationSequence) ||
      (event.origin !== 'live' && event.origin !== 'history') ||
      !isNonemptyString(event.kind) ||
      !(event.unsupportedReason === null ||
        isNonemptyString(event.unsupportedReason)) ||
      !Array.isArray(event.removals) || !Array.isArray(event.insertions) ||
      !Array.isArray(event.transforms) ||
      !isNonnegativeSafeInteger(event.estimatedBytes)) {
      return 'invalid-transition';
    }
    const signature = makeSceneSignature(event.scene);
    if (signature === null || !signaturesEqual(signature, state.signature)) {
      return 'seed-signature-changed';
    }
    if (event.mutationSequence <= state.headSequence) return 'stale-transition';
    if (event.mutationSequence !== state.headSequence + 1) return 'sequence-gap';
    if (event.unsupportedReason !== null) {
      return sanitizeReason(event.unsupportedReason);
    }
    return null;
  }

  function deriveKind(event, hasRemovals, hasInsertions, hasTransforms) {
    if (hasRemovals && hasInsertions) {
      return event.kind === 'split-stroke' ? 'split-stroke' : null;
    }
    if (hasInsertions && !hasRemovals && !hasTransforms) {
      return event.kind === 'add-objects' ? 'add-objects' : null;
    }
    if (hasRemovals && !hasInsertions && !hasTransforms) {
      return event.kind === 'delete-objects' || event.kind === 'clear-keyframe'
        ? 'delete-objects'
        : null;
    }
    if (hasTransforms && !hasRemovals && !hasInsertions) {
      return event.kind === 'transform-objects' ? 'transform-objects' : null;
    }
    return null;
  }

  function prepareTransition(state, event) {
    const operations = [];
    const baselineAdds = new Map();
    const contentSignatureAdds = new Map();
    const currentUpdates = new Map();
    const currentDeletes = new Set();
    const byteUpdates = new Map();
    const byteDeletes = new Set();
    let nextEstimatedBytes = state.estimatedBytes;
    const structurallyChanged = event.removals.length > 0 ||
      event.insertions.length > 0;
    let nextOrder = structurallyChanged
      ? state.objectOrder.slice()
      : state.objectOrder;

    const removalIds = new Set();
    for (const removal of event.removals) {
      if (!isPlainRecord(removal) || !isNonemptyString(removal.id) ||
        !isNonnegativeSafeInteger(removal.index) ||
        removalIds.has(removal.id) ||
        state.objectOrder[removal.index] !== removal.id) {
        return { valid: false, reason: 'invalid-transition' };
      }
      removalIds.add(removal.id);
    }
    if (removalIds.size > 0) {
      operations.push({
        type: 'remove-objects',
        objectIds: [...removalIds]
      });
      nextOrder = nextOrder.filter(id => !removalIds.has(id));
      for (const id of removalIds) {
        currentDeletes.add(id);
        byteDeletes.add(id);
        nextEstimatedBytes = Math.max(
          0,
          nextEstimatedBytes - (state.objectBytes.get(id) || 0)
        );
      }
    }

    const sortedInsertions = event.insertions.slice().sort((left, right) =>
      Number(left?.index) - Number(right?.index));
    const insertionIds = new Set();
    const preparedInsertions = [];
    let previousIndex = -1;
    for (const insertion of sortedInsertions) {
      if (!isPlainRecord(insertion) ||
        !isNonnegativeSafeInteger(insertion.index) ||
        insertion.index <= previousIndex || !isPlainRecord(insertion.record) ||
        !isNonemptyString(insertion.record.id) ||
        insertionIds.has(insertion.record.id) ||
        nextOrder.includes(insertion.record.id)) {
        return { valid: false, reason: 'invalid-transition' };
      }
      previousIndex = insertion.index;
      const objectId = insertion.record.id;
      if (removalIds.has(objectId) ||
        (event.origin === 'live' && state.baselines.has(objectId))) {
        return { valid: false, reason: 'unsupported-field-mutation' };
      }
      insertionIds.add(objectId);
      let baseline = null;
      if (insertion.baseTransform === null) {
        if (event.origin !== 'history') {
          return { valid: false, reason: 'missing-baseline' };
        }
        baseline = state.baselines.get(objectId) || baselineAdds.get(objectId);
        if (!baseline) {
          return { valid: false, reason: 'missing-baseline' };
        }
      } else {
        baseline = normalizeFabricTransform(insertion.baseTransform);
        if (baseline === null) {
          return { valid: false, reason: 'invalid-transition' };
        }
        const archived = state.baselines.get(objectId) || baselineAdds.get(objectId);
        if (archived && !transformsEqual(archived, baseline)) {
          return { valid: false, reason: 'transition-before-mismatch' };
        }
        if (!archived) baselineAdds.set(objectId, baseline);
      }
      const converted = canonicalizeRecord(insertion.record, baseline);
      if (!converted.valid) return converted;
      if (event.origin === 'live' &&
        !transformsEqual(converted.finalTransform, baseline)) {
        return { valid: false, reason: 'transition-before-mismatch' };
      }
      const archivedSignature = state.contentSignatures.get(objectId) ||
        contentSignatureAdds.get(objectId);
      if (event.origin === 'history') {
        if (!archivedSignature) {
          return { valid: false, reason: 'missing-baseline' };
        }
        if (archivedSignature !== converted.contentSignature) {
          return { valid: false, reason: 'unsupported-field-mutation' };
        }
      } else if (!archivedSignature) {
        contentSignatureAdds.set(objectId, converted.contentSignature);
      }
      if (insertion.index > nextOrder.length) {
        return { valid: false, reason: 'invalid-transition' };
      }
      nextOrder.splice(insertion.index, 0, objectId);
      currentDeletes.delete(objectId);
      byteDeletes.delete(objectId);
      currentUpdates.set(objectId, converted.finalTransform);
      byteUpdates.set(objectId, converted.estimatedBytes);
      nextEstimatedBytes += converted.estimatedBytes;
      preparedInsertions.push({
        index: insertion.index,
        object: converted.object
      });
    }

    for (let index = 0; index < preparedInsertions.length;) {
      const first = preparedInsertions[index];
      const objects = [first.object];
      let next = index + 1;
      while (next < preparedInsertions.length &&
        preparedInsertions[next].index ===
          preparedInsertions[next - 1].index + 1) {
        objects.push(preparedInsertions[next].object);
        next += 1;
      }
      operations.push({
        type: 'insert-objects',
        index: first.index,
        objects
      });
      index = next;
    }

    const transformIds = new Set();
    const canonicalTransforms = [];
    for (const transform of event.transforms) {
      if (!isPlainRecord(transform) || !isNonemptyString(transform.id) ||
        transformIds.has(transform.id) || !nextOrder.includes(transform.id)) {
        return { valid: false, reason: 'invalid-transition' };
      }
      transformIds.add(transform.id);
      const before = normalizeFabricTransform(transform.beforeTransform);
      const after = normalizeFabricTransform(transform.afterTransform);
      if (before === null || after === null) {
        return { valid: false, reason: 'invalid-transition' };
      }
      const current = currentUpdates.get(transform.id) ||
        (currentDeletes.has(transform.id)
          ? null
          : state.currentTransforms.get(transform.id));
      if (!current || !transformsEqual(current, before)) {
        return { valid: false, reason: 'transition-before-mismatch' };
      }
      if (!transformsEqual(before, after, UNSUPPORTED_TRANSFORM_FIELDS)) {
        return { valid: false, reason: 'unsupported-transform' };
      }
      const baseline = state.baselines.get(transform.id) ||
        baselineAdds.get(transform.id);
      if (!baseline) return { valid: false, reason: 'missing-baseline' };
      const projected = canonicalTransform(after, baseline);
      if (projected === null) {
        return { valid: false, reason: 'unsupported-transform' };
      }
      currentUpdates.set(transform.id, after);
      canonicalTransforms.push({
        objectId: transform.id,
        transform: projected
      });
    }
    if (canonicalTransforms.length > 0) {
      operations.push({
        type: 'set-transforms',
        transforms: canonicalTransforms
      });
    }

    const commandKind = deriveKind(
      event,
      removalIds.size > 0,
      preparedInsertions.length > 0,
      canonicalTransforms.length > 0
    );
    if (commandKind === null || operations.length === 0) {
      return { valid: false, reason: 'invalid-transition' };
    }
    return {
      valid: true,
      operations,
      commandKind,
      baselineAdds,
      contentSignatureAdds,
      currentUpdates,
      currentDeletes,
      byteUpdates,
      byteDeletes,
      nextEstimatedBytes,
      nextOrder
    };
  }

  function applyTransition(event) {
    let state = null;
    try {
      const sceneInstanceId = event?.scene?.sceneInstanceId;
      if (!isNonemptyString(sceneInstanceId)) {
        return { applied: false, reason: 'invalid-transition' };
      }
      state = scenes.get(sceneInstanceId);
      if (!state || destroyed) {
        return { applied: false, reason: 'invalid-transition' };
      }
      if (state.status !== 'synced') {
        return { applied: false, reason: state.lastReason || 'adapter-failed' };
      }
      const envelopeReason = validateEventEnvelope(event, state);
      if (envelopeReason !== null) {
        if (envelopeReason === 'stale-transition') {
          state.staleCount += 1;
          aggregate.staleCount += 1;
        } else if (envelopeReason === 'sequence-gap') {
          state.gapCount += 1;
          aggregate.gapCount += 1;
        }
        return failResult(state, envelopeReason);
      }
      const prepared = prepareTransition(state, event);
      if (!prepared.valid) return failResult(state, prepared.reason);

      const command = {
        id: makeOpaqueId('command'),
        actorId: state.actorId,
        baseRevision: state.headSequence,
        target: {
          layerId: state.layerId,
          keyframeId: state.keyframeId,
          frame: state.signature.targetFrame
        },
        kind: prepared.commandKind,
        operations: prepared.operations,
        createdAt: nowIso()
      };
      const result = state.document.applyCommand(command, {
        source: event.origin === 'history' ? 'history' : 'user'
      });
      if (!result?.applied) return failResult(state, 'document-rejected');
      const documentHead = state.document.getHead();
      if (result.sequence !== event.mutationSequence ||
        documentHead?.sequence !== event.mutationSequence) {
        return failResult(state, 'document-sequence-mismatch');
      }

      for (const [id, baseline] of prepared.baselineAdds) {
        state.baselines.set(id, baseline);
      }
      for (const [id, signature] of prepared.contentSignatureAdds) {
        state.contentSignatures.set(id, signature);
      }
      for (const id of prepared.currentDeletes) state.currentTransforms.delete(id);
      for (const [id, transform] of prepared.currentUpdates) {
        state.currentTransforms.set(id, transform);
      }
      for (const id of prepared.byteDeletes) state.objectBytes.delete(id);
      for (const [id, bytes] of prepared.byteUpdates) {
        state.objectBytes.set(id, bytes);
      }
      state.objectOrder = prepared.nextOrder;
      state.estimatedBytes = prepared.nextEstimatedBytes;
      state.headSequence = event.mutationSequence;
      state.commitCount += 1;
      aggregate.commitCount += 1;
      return {
        applied: true,
        commandId: result.commandId,
        sequence: result.sequence
      };
    } catch (_error) {
      if (state) return failResult(state, 'adapter-failed');
      return { applied: false, reason: 'invalid-transition' };
    }
  }

  function recordLatency(state, startedAt, finishedAt) {
    const latency = Number.isFinite(startedAt) && Number.isFinite(finishedAt)
      ? Math.max(0, finishedAt - startedAt)
      : 0;
    state.latencies.push(latency);
    aggregate.latencies.push(latency);
    while (state.latencies.length > limits.maxLatencySamples) {
      state.latencies.shift();
    }
    while (aggregate.latencies.length > limits.maxLatencySamples) {
      aggregate.latencies.shift();
    }
  }

  function scheduleNext(_sceneInstanceId) {
    if (destroyed || workScheduled || queue.length === 0) return true;
    workScheduled = true;
    schedulerGeneration += 1;
    const generation = schedulerGeneration;
    const callback = () => runScheduledWork(generation);
    try {
      invokeScheduler(scheduleWork, callback);
      return true;
    } catch (_error) {
      try {
        invokeScheduler(fallbackScheduleWork, callback);
        return true;
      } catch (_fallbackError) {
        workScheduled = false;
        const queuedSceneIds = [...new Set(queue.map(item => item.sceneInstanceId))];
        for (const queuedSceneId of queuedSceneIds) {
          quarantineInternal(queuedSceneId, 'scheduler-failed');
        }
        queue.length = 0;
        queueBytes = 0;
        schedulerGeneration += 1;
        return false;
      }
    }
  }

  function runScheduledWork(generation) {
    if (destroyed || generation !== schedulerGeneration || !workScheduled) {
      return;
    }
    workScheduled = false;
    if (queue.length === 0) return;
    let batchStarted;
    try {
      batchStarted = latencyNow();
      if (!Number.isFinite(batchStarted)) throw new TypeError('Invalid clock');
    } catch (_error) {
      const failedSceneId = queue[0]?.sceneInstanceId;
      if (failedSceneId) quarantineInternal(failedSceneId, 'adapter-failed');
      if (queue.length > 0) scheduleNext(queue[0].sceneInstanceId);
      return;
    }
    let processed = 0;
    while (!destroyed && queue.length > 0 &&
      processed < limits.maxWorkItems) {
      const item = queue.shift();
      queueBytes = Math.max(0, queueBytes - item.estimatedBytes);
      const state = scenes.get(item.sceneInstanceId);
      if (state?.status === 'synced') applyTransition(item.event);
      processed += 1;
      let finishedAt;
      try {
        finishedAt = latencyNow();
        if (!Number.isFinite(finishedAt)) throw new TypeError('Invalid clock');
      } catch (_error) {
        if (state) quarantineInternal(state.sceneInstanceId, 'adapter-failed');
        finishedAt = batchStarted + limits.maxWorkMs;
      }
      if (state) recordLatency(state, item.enqueuedAt, finishedAt);
      if (finishedAt - batchStarted >= limits.maxWorkMs) break;
    }
    if (!destroyed && queue.length > 0) {
      scheduleNext(queue[0].sceneInstanceId);
    }
  }

  function enqueueTransition(event) {
    try {
      if (destroyed || !isPlainRecord(event) || !isPlainRecord(event.scene) ||
        !isNonemptyString(event.scene.sceneInstanceId)) {
        return false;
      }
      const sceneInstanceId = event.scene.sceneInstanceId;
      const state = scenes.get(sceneInstanceId);
      if (!state || state.status !== 'synced' ||
        !isNonnegativeSafeInteger(event.estimatedBytes)) {
        if (state?.status === 'synced') {
          quarantineInternal(sceneInstanceId, 'invalid-transition');
        }
        return false;
      }
      if (event.estimatedBytes > limits.maxQueueBytes) {
        quarantineInternal(sceneInstanceId, 'queue-event-too-large');
        return false;
      }
      if (queue.length + 1 > limits.maxQueueItems ||
        queueBytes + event.estimatedBytes > limits.maxQueueBytes) {
        quarantineInternal(sceneInstanceId, 'queue-capacity-exceeded');
        return false;
      }
      const enqueuedAt = latencyNow();
      if (!Number.isFinite(enqueuedAt)) throw new TypeError('Invalid clock');
      const queuedEvent = snapshotTransitionEnvelope(event);
      queue.push({
        event: queuedEvent,
        sceneInstanceId,
        estimatedBytes: event.estimatedBytes,
        enqueuedAt
      });
      queueBytes += event.estimatedBytes;
      if (!scheduleNext(sceneInstanceId)) return false;
      return true;
    } catch (_error) {
      const sceneInstanceId = event?.scene?.sceneInstanceId;
      if (isNonemptyString(sceneInstanceId)) {
        quarantineInternal(sceneInstanceId, 'adapter-failed');
      }
      return false;
    }
  }

  function quarantineScene(sceneInstanceId, reason) {
    try {
      if (!isNonemptyString(sceneInstanceId)) return false;
      return quarantineInternal(sceneInstanceId, reason);
    } catch (_error) {
      return false;
    }
  }

  function dropScenes(sceneInstanceIds) {
    if (destroyed || !Array.isArray(sceneInstanceIds)) return 0;
    let dropped = 0;
    const uniqueIds = new Set(sceneInstanceIds.filter(isNonemptyString));
    for (const sceneInstanceId of uniqueIds) {
      removeQueuedScene(sceneInstanceId);
      if (scenes.delete(sceneInstanceId)) dropped += 1;
    }
    return dropped;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    schedulerGeneration += 1;
    workScheduled = false;
    queue.length = 0;
    queueBytes = 0;
    scenes.clear();
  }

  function getSceneProjection(sceneInstanceId) {
    const state = scenes.get(sceneInstanceId);
    if (!state || state.status !== 'synced' || destroyed) return null;
    try {
      return {
        headSequence: state.headSequence,
        document: clonePlain(state.document.getContentSnapshot())
      };
    } catch (_error) {
      quarantineInternal(sceneInstanceId, 'adapter-failed');
      return null;
    }
  }

  function makeDiagnostics({
    status,
    sceneCount,
    bootstrapCount,
    commitCount,
    failureCount,
    divergenceCount,
    resyncCount,
    staleCount,
    gapCount,
    headSequence,
    objectCount,
    estimatedBytes,
    latencies,
    lastReason
  }) {
    return {
      enabled: !destroyed,
      status,
      sceneCount,
      bootstrapCount,
      commitCount,
      failureCount,
      divergenceCount,
      resyncCount,
      staleCount,
      gapCount,
      headSequence,
      objectCount,
      estimatedBytes,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      lastReason
    };
  }

  function getDiagnostics(sceneInstanceId) {
    const state = isNonemptyString(sceneInstanceId)
      ? scenes.get(sceneInstanceId)
      : null;
    if (state) {
      return makeDiagnostics({
        status: state.status,
        sceneCount: 1,
        bootstrapCount: state.bootstrapCount,
        commitCount: state.commitCount,
        failureCount: state.failureCount,
        divergenceCount: state.divergenceCount,
        resyncCount: state.resyncCount,
        staleCount: state.staleCount,
        gapCount: state.gapCount,
        headSequence: state.headSequence,
        objectCount: state.objectOrder.length,
        estimatedBytes: state.estimatedBytes,
        latencies: state.latencies,
        lastReason: state.lastReason
      });
    }
    const states = [...scenes.values()];
    const anyDesynced = states.some(candidate => candidate.status === 'desynced');
    return makeDiagnostics({
      status: destroyed
        ? 'destroyed'
        : anyDesynced
          ? 'degraded'
          : states.length > 0
            ? 'active'
            : 'idle',
      sceneCount: states.length,
      bootstrapCount: aggregate.bootstrapCount,
      commitCount: aggregate.commitCount,
      failureCount: aggregate.failureCount,
      divergenceCount: aggregate.divergenceCount,
      resyncCount: aggregate.resyncCount,
      staleCount: aggregate.staleCount,
      gapCount: aggregate.gapCount,
      headSequence: states.reduce((maximum, candidate) =>
        Math.max(maximum, candidate.headSequence), 0),
      objectCount: states.reduce((total, candidate) =>
        total + candidate.objectOrder.length, 0),
      estimatedBytes: states.reduce((total, candidate) =>
        total + candidate.estimatedBytes, 0),
      latencies: aggregate.latencies,
      lastReason: states.find(candidate => candidate.status === 'desynced')
        ?.lastReason || null
    });
  }

  return {
    activateScene,
    enqueueTransition,
    applyTransition,
    quarantineScene,
    dropScenes,
    destroy,
    getSceneProjection,
    getDiagnostics
  };
}

module.exports = { createDrawingEngineAdapter };
