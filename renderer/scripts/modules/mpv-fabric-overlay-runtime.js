'use strict';

const {
  createFabricDrawingPilotMetrics
} = require('./fabric-drawing-pilot-metrics.js');
const {
  splitStrokePointsByPolygon
} = require('./drawing-v3/stroke-splitter.js');
const {
  polygonHasArea,
  boundsForPoints,
  boundsIntersect,
  simplifyClosedPolygon
} = require('./drawing-v3/lasso-geometry.js');
const {
  createDrawingCommandHistory
} = require('./drawing-v3/drawing-command-history.js');
const {
  createDrawingEngineAdapter
} = require('./drawing-v3/drawing-engine-adapter.js');

const SCENE_KEY_SEPARATOR = '\u0000';
const DEFAULT_MAX_VIDEOS = 10;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ACTIONS = 2048;
const MAX_STROKE_POINTS = 20000;
const MAX_LASSO_POINTS = 1024;
const DEFAULT_MAX_OBJECTS = 10000;
const TRANSFORM_FIELDS = ['left', 'top', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'flipX', 'flipY'];
const UNSUPPORTED_PHASE0_TRANSFORM_FIELDS = ['scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'flipX', 'flipY'];
const BRUSH_COLORS = Object.freeze([
  '#ff4757',
  '#ffd000',
  '#26de81',
  '#4a9eff',
  '#ffffff',
  '#000000',
  '#1abc9c',
  '#ff6b9d'
]);
const BRUSH_COLOR_LABELS = Object.freeze({
  '#ff4757': '빨강',
  '#ffd000': '노랑',
  '#26de81': '초록',
  '#4a9eff': '파랑',
  '#ffffff': '하양',
  '#000000': '검정',
  '#1abc9c': '민트',
  '#ff6b9d': '핑크'
});
const DEFAULT_BRUSH_STYLE = Object.freeze({ color: '#ff4757', size: 3, opacity: 1 });
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 50;
const MIN_BRUSH_OPACITY_PERCENT = 10;
const MAX_BRUSH_OPACITY_PERCENT = 100;
const SELECTION_HIT_MARGIN_CSS_PX = 6;
const MIN_SELECTION_HIT_TOLERANCE = 2;
const MAX_SELECTION_HIT_TOLERANCE = 96;
const DRAWING_ACTIONS = new Set([
  'delete-selection',
  'clear-session',
  'undo',
  'redo'
]);
const DRAWING_V3_DIAGNOSTIC_STATUSES = new Set([
  'active',
  'degraded',
  'desynced',
  'destroyed',
  'disabled',
  'idle',
  'not-connected',
  'synced'
]);
const DRAWING_V3_DIAGNOSTIC_REASONS = new Set([
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
]);

function clonePlain(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedInteger(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePathOpacity(value) {
  if (value === null || value === undefined || value === '') return 1;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.1 || number > 1) return 1;
  return number;
}

function normalizeViewportTransform(value = {}) {
  const scale = finiteNumber(value.scale, 1);
  return {
    scale: scale > 0 ? scale : 1,
    panX: finiteNumber(value.panX, 0),
    panY: finiteNumber(value.panY, 0)
  };
}

function resolveSelectionHitTolerance(session = {}) {
  const rect = session.canvasRect || {};
  const sourceWidth = Math.max(0, finiteNumber(session.sourceWidth));
  const sourceHeight = Math.max(0, finiteNumber(session.sourceHeight));
  const displayWidth = Math.max(0, finiteNumber(rect.width));
  const displayHeight = Math.max(0, finiteNumber(rect.height));
  const scale = normalizeViewportTransform(session.viewportTransform).scale;
  if (!sourceWidth || !sourceHeight || !displayWidth || !displayHeight) {
    return SELECTION_HIT_MARGIN_CSS_PX;
  }
  const sourcePerCssPixel = Math.max(
    sourceWidth / displayWidth / scale,
    sourceHeight / displayHeight / scale
  );
  return Math.min(
    MAX_SELECTION_HIT_TOLERANCE,
    Math.max(MIN_SELECTION_HIT_TOLERANCE, Math.ceil(SELECTION_HIT_MARGIN_CSS_PX * sourcePerCssPixel))
  );
}

function resolveEffectiveCanvasRect(canvasRect = {}, viewportTransform = {}) {
  const left = finiteNumber(canvasRect.left, 0);
  const top = finiteNumber(canvasRect.top, 0);
  const width = Math.max(0, finiteNumber(canvasRect.width, 0));
  const height = Math.max(0, finiteNumber(canvasRect.height, 0));
  const { scale, panX, panY } = normalizeViewportTransform(viewportTransform);
  return {
    left: left + ((1 - scale) * width) / 2 + scale * panX,
    top: top + ((1 - scale) * height) / 2 + scale * panY,
    width: width * scale,
    height: height * scale
  };
}

function mapClientPointToSource(point = {}, canvasRect = {}, viewportTransform = {}, source = {}) {
  const effectiveRect = resolveEffectiveCanvasRect(canvasRect, viewportTransform);
  const sourceWidth = Math.max(0, finiteNumber(source.width, 0));
  const sourceHeight = Math.max(0, finiteNumber(source.height, 0));
  if (effectiveRect.width <= 0 || effectiveRect.height <= 0 || sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }
  const x = (finiteNumber(point.clientX) - effectiveRect.left) * sourceWidth / effectiveRect.width;
  const y = (finiteNumber(point.clientY) - effectiveRect.top) * sourceHeight / effectiveRect.height;
  return {
    x: Math.min(sourceWidth, Math.max(0, x)),
    y: Math.min(sourceHeight, Math.max(0, y))
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function makeSceneKey(stableVideoIdentity, targetFrame) {
  return `${stableVideoIdentity}${SCENE_KEY_SEPARATOR}${targetFrame}`;
}

function defaultEstimateObjectBytes(object) {
  try {
    return Math.max(1, JSON.stringify(object).length * 2);
  } catch (_error) {
    return 1;
  }
}

function makeObjectsState(objects, touchedIds, order) {
  return {
    type: 'objects',
    touchedIds: [...touchedIds],
    objects: [...touchedIds]
      .filter(id => objects.has(id))
      .map(id => clonePlain(objects.get(id))),
    order: [...order]
  };
}

function makeTransformsState(objects, objectIds) {
  return {
    type: 'transforms',
    transforms: objectIds.map(id => ({
      id,
      transform: clonePlain(objects.get(id)?.transform || {})
    }))
  };
}

function normalizedStoredTransform(value = {}) {
  return {
    left: finiteNumber(value.left),
    top: finiteNumber(value.top),
    scaleX: finiteNumber(value.scaleX, 1),
    scaleY: finiteNumber(value.scaleY, 1),
    angle: finiteNumber(value.angle),
    skewX: finiteNumber(value.skewX),
    skewY: finiteNumber(value.skewY),
    flipX: value.flipX === true,
    flipY: value.flipY === true
  };
}

function storedTransformsEqual(left, right, fields = TRANSFORM_FIELDS) {
  const normalizedLeft = normalizedStoredTransform(left);
  const normalizedRight = normalizedStoredTransform(right);
  return fields.every(field => normalizedLeft[field] === normalizedRight[field]);
}

function safeEstimatedBytes(value) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function drawingV3Count(value) {
  const number = Math.trunc(Number(value));
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function drawingV3Latency(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, 60_000) : 0;
}

function emptyDrawingV3Diagnostics(status, reason = null, failureCount = 0) {
  return {
    enabled: false,
    status,
    sceneCount: 0,
    bootstrapCount: 0,
    commitCount: 0,
    failureCount,
    divergenceCount: 0,
    resyncCount: 0,
    staleCount: 0,
    gapCount: 0,
    headSequence: 0,
    objectCount: 0,
    estimatedBytes: 0,
    latencyP50Ms: 0,
    latencyP95Ms: 0,
    lastReason: reason
  };
}

function sanitizeDrawingV3Diagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return emptyDrawingV3Diagnostics('degraded', 'adapter-failed', 1);
  }
  return {
    enabled: value.enabled === true,
    status: DRAWING_V3_DIAGNOSTIC_STATUSES.has(value.status) ? value.status : 'degraded',
    sceneCount: drawingV3Count(value.sceneCount),
    bootstrapCount: drawingV3Count(value.bootstrapCount),
    commitCount: drawingV3Count(value.commitCount),
    failureCount: drawingV3Count(value.failureCount),
    divergenceCount: drawingV3Count(value.divergenceCount),
    resyncCount: drawingV3Count(value.resyncCount),
    staleCount: drawingV3Count(value.staleCount),
    gapCount: drawingV3Count(value.gapCount),
    headSequence: drawingV3Count(value.headSequence),
    objectCount: drawingV3Count(value.objectCount),
    estimatedBytes: drawingV3Count(value.estimatedBytes),
    latencyP50Ms: drawingV3Latency(value.latencyP50Ms),
    latencyP95Ms: drawingV3Latency(value.latencyP95Ms),
    lastReason: DRAWING_V3_DIAGNOSTIC_REASONS.has(value.lastReason) ? value.lastReason : null
  };
}

function createSessionSceneStore(options = {}) {
  const maxVideos = positiveInteger(options.maxVideos, DEFAULT_MAX_VIDEOS);
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxObjects = positiveInteger(options.maxObjects, DEFAULT_MAX_OBJECTS);
  const maxHistory = positiveInteger(options.maxHistory, 32);
  const maxHistoryBytes = positiveInteger(
    options.maxHistoryBytes,
    Math.max(1, Math.min(16 * 1024 * 1024, Math.floor(maxBytes / 4)))
  );
  const estimateObjectBytes = typeof options.estimateObjectBytes === 'function'
    ? options.estimateObjectBytes
    : defaultEstimateObjectBytes;
  const drawingEngineObserver = options.drawingEngineObserver &&
    typeof options.drawingEngineObserver === 'object'
    ? options.drawingEngineObserver
    : null;
  const createSceneInstanceId = typeof options.createSceneInstanceId === 'function'
    ? options.createSceneInstanceId
    : null;
  const scenes = new Map();
  const issuedSceneInstanceIds = new Set();
  const videoAccess = new Map();
  let accessClock = 0;
  let latestVideoGeneration = -1;
  let activeSession = null;
  let evictionCount = 0;
  let commandSequence = 0;
  let sceneInstanceSequence = 0;
  let observerFailureCount = 0;
  let observerQuarantineFailureCount = 0;
  let observerLifecycleFailureCount = 0;
  let destroyed = false;

  function sourceDimension(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 1;
  }

  function allocateSceneInstanceId() {
    let candidate = null;
    try {
      candidate = createSceneInstanceId?.();
    } catch (_error) {
      candidate = null;
    }
    if (typeof candidate === 'string' && candidate && !issuedSceneInstanceIds.has(candidate)) {
      issuedSceneInstanceIds.add(candidate);
      return candidate;
    }
    do {
      sceneInstanceSequence += 1;
      candidate = `scene-instance-${Date.now()}-${sceneInstanceSequence}`;
    } while (issuedSceneInstanceIds.has(candidate));
    issuedSceneInstanceIds.add(candidate);
    return candidate;
  }

  function sceneDescriptor(scene, dimensions = scene) {
    return {
      sceneInstanceId: scene.sceneInstanceId,
      targetFrame: scene.targetFrame,
      sourceWidth: sourceDimension(dimensions.sourceWidth),
      sourceHeight: sourceDimension(dimensions.sourceHeight)
    };
  }

  function quarantineObserverScene(sceneInstanceId) {
    try {
      const quarantine = drawingEngineObserver?.quarantineScene;
      if (typeof quarantine === 'function') {
        quarantine.call(drawingEngineObserver, sceneInstanceId, 'observer-failed');
      }
    } catch (_error) {
      observerQuarantineFailureCount += 1;
    }
  }

  function recordObserverFailure(sceneInstanceId) {
    observerFailureCount += 1;
    quarantineObserverScene(sceneInstanceId);
  }

  function activationObjectView(scene, restored) {
    const authoritativeObjects = new Map();
    for (const [id, record] of scene.objects) {
      authoritativeObjects.set(id, restored ? null : clonePlain(record));
    }
    return authoritativeObjects;
  }

  function notifySceneActivation(scene, incomingSession, restored) {
    try {
      const activate = drawingEngineObserver?.activateScene;
      if (typeof activate !== 'function') return;
      activate.call(drawingEngineObserver, {
        ...sceneDescriptor(scene, incomingSession),
        mutationSequence: scene.mutationSequence
      }, activationObjectView(scene, restored));
    } catch (_error) {
      recordObserverFailure(scene.sceneInstanceId);
    }
  }

  function notifyCommittedTransition(scene, eventFactory) {
    try {
      const enqueue = drawingEngineObserver?.enqueueTransition;
      if (typeof enqueue !== 'function') return;
      enqueue.call(drawingEngineObserver, eventFactory());
    } catch (_error) {
      recordObserverFailure(scene.sceneInstanceId);
    }
  }

  function notifyScenesDropped(sceneInstanceIds) {
    if (!Array.isArray(sceneInstanceIds) || sceneInstanceIds.length === 0) return;
    try {
      const dropScenes = drawingEngineObserver?.dropScenes;
      if (typeof dropScenes === 'function') {
        dropScenes.call(drawingEngineObserver, sceneInstanceIds);
      }
    } catch (_error) {
      observerLifecycleFailureCount += 1;
    }
  }

  function activeScene() {
    return activeSession ? scenes.get(activeSession.sceneKey) || null : null;
  }

  function historyDiagnostics(scene) {
    return scene?.history?.getDiagnostics() || {
      undoDepth: 0,
      redoDepth: 0,
      undoBytes: 0,
      redoBytes: 0,
      historyBytes: 0
    };
  }

  function reachableObjectBytes(scene, entries = scene?.historyEntries, currentBytes = scene?.estimatedBytes) {
    let reservedBytes = Math.max(0, finiteNumber(currentBytes));
    for (const entry of entries?.undo || []) {
      reservedBytes = Math.max(reservedBytes, Math.max(0, finiteNumber(entry.undoObjectBytes)));
    }
    for (const entry of entries?.redo || []) {
      reservedBytes = Math.max(reservedBytes, Math.max(0, finiteNumber(entry.redoObjectBytes)));
    }
    return reservedBytes;
  }

  function estimateSceneBytes(scene, entries = scene?.historyEntries, currentBytes = scene?.estimatedBytes,
    historyBytes = historyDiagnostics(scene).historyBytes) {
    return reachableObjectBytes(scene, entries, currentBytes) + Math.max(0, finiteNumber(historyBytes));
  }

  function touchVideo(stableVideoIdentity) {
    accessClock += 1;
    videoAccess.delete(stableVideoIdentity);
    videoAccess.set(stableVideoIdentity, accessClock);
  }

  function calculateEstimatedBytes() {
    let total = 0;
    for (const scene of scenes.values()) {
      total += estimateSceneBytes(scene);
    }
    return total;
  }

  function evictVideo(stableVideoIdentity) {
    const droppedSceneInstanceIds = [];
    for (const [key, scene] of scenes) {
      if (scene.stableVideoIdentity !== stableVideoIdentity) continue;
      droppedSceneInstanceIds.push(scene.sceneInstanceId);
      scenes.delete(key);
    }
    videoAccess.delete(stableVideoIdentity);
    evictionCount += 1;
    notifyScenesDropped(droppedSceneInstanceIds);
  }

  function enforceLimits() {
    let estimatedBytes = calculateEstimatedBytes();
    while (videoAccess.size > maxVideos || estimatedBytes > maxBytes) {
      const candidate = [...videoAccess.keys()].find(identity => identity !== activeSession?.stableVideoIdentity);
      if (!candidate) break;
      evictVideo(candidate);
      estimatedBytes = calculateEstimatedBytes();
    }
    return estimatedBytes;
  }

  function estimateVideoBytes(stableVideoIdentity) {
    let total = 0;
    for (const scene of scenes.values()) {
      if (scene.stableVideoIdentity !== stableVideoIdentity) continue;
      total += estimateSceneBytes(scene);
    }
    return total;
  }

  function planProjectedEvictions(scene, nextObjectBytes, nextHistory) {
    let projectedBytes = calculateEstimatedBytes() - estimateSceneBytes(scene) +
      estimateSceneBytes(scene, nextHistory, nextObjectBytes, nextHistory.historyBytes);
    const planned = [];
    for (const candidate of videoAccess.keys()) {
      if (projectedBytes <= maxBytes) break;
      if (candidate === activeSession?.stableVideoIdentity) continue;
      projectedBytes -= estimateVideoBytes(candidate);
      planned.push(candidate);
    }
    return projectedBytes <= maxBytes ? planned : null;
  }

  function projectHistoryRecord(scene, commandId, commandBytes, undoObjectBytes, redoObjectBytes,
    entries = scene.historyEntries) {
    const undo = entries.undo.map(entry => ({ ...entry }));
    let undoBytes = undo.reduce((total, entry) => total + entry.estimatedBytes, 0);
    while (undo.length >= maxHistory || undoBytes + commandBytes > maxHistoryBytes) {
      const [removed] = undo.splice(0, 1);
      undoBytes = Math.max(0, undoBytes - finiteNumber(removed?.estimatedBytes));
    }
    undo.push({
      id: commandId,
      estimatedBytes: commandBytes,
      undoObjectBytes,
      redoObjectBytes
    });
    return {
      undo,
      redo: [],
      historyBytes: undoBytes + commandBytes
    };
  }

  function snapshotScene(scene) {
    if (!scene) return null;
    return {
      key: scene.key,
      stableVideoIdentity: scene.stableVideoIdentity,
      targetFrame: scene.targetFrame,
      objects: [...scene.objects.values()].map(clonePlain),
      selectedObjectIds: [...scene.selectedObjectIds],
      dirty: scene.dirty,
      mutationCount: scene.mutationCount,
      estimatedBytes: scene.estimatedBytes
    };
  }

  function noteMutation(scene) {
    scene.dirty = true;
    scene.mutationCount += 1;
    scene.mutationSequence += 1;
  }

  function estimateObjectsBytes(objects) {
    return [...objects.values()].reduce((total, object) => {
      const estimated = finiteNumber(estimateObjectBytes(object), 1);
      return total + Math.max(1, estimated);
    }, 0);
  }

  function transitionKind(sourceKind, removalCount, insertionCount, transformCount) {
    if (removalCount > 0 && insertionCount > 0) return 'split-stroke';
    if (insertionCount > 0 && removalCount === 0) return 'add-objects';
    if (removalCount > 0 && insertionCount === 0) {
      return sourceKind === 'clear-keyframe' ? 'clear-keyframe' : 'delete-objects';
    }
    if (transformCount > 0) return 'transform-objects';
    return typeof sourceKind === 'string' && sourceKind ? sourceKind : 'unsupported-transition';
  }

  function makeTransitionEvent(scene, transition) {
    const event = {
      scene: sceneDescriptor(scene),
      mutationSequence: scene.mutationSequence,
      origin: transition.origin,
      kind: transition.kind,
      estimatedBytes: safeEstimatedBytes(transition.estimatedBytes),
      unsupportedReason: null,
      removals: [],
      insertions: [],
      transforms: []
    };
    const beforeState = transition.beforeState;
    const afterState = transition.afterState;
    if (!beforeState || !afterState || beforeState.type !== afterState.type) {
      event.unsupportedReason = 'unsupported-field-mutation';
      return event;
    }

    if (beforeState.type === 'transforms') {
      const beforeTransforms = new Map((beforeState.transforms || []).map(item => [item.id, item.transform]));
      const afterTransforms = new Map((afterState.transforms || []).map(item => [item.id, item.transform]));
      const objectIds = [...new Set([...beforeTransforms.keys(), ...afterTransforms.keys()])];
      if (beforeTransforms.size !== afterTransforms.size ||
          objectIds.some(id => !beforeTransforms.has(id) || !afterTransforms.has(id))) {
        event.unsupportedReason = 'unsupported-field-mutation';
      }
      for (const id of objectIds) {
        if (!beforeTransforms.has(id) || !afterTransforms.has(id)) continue;
        const beforeTransform = beforeTransforms.get(id);
        const afterTransform = afterTransforms.get(id);
        if (storedTransformsEqual(beforeTransform, afterTransform)) continue;
        if (!storedTransformsEqual(
          beforeTransform,
          afterTransform,
          UNSUPPORTED_PHASE0_TRANSFORM_FIELDS
        )) {
          event.unsupportedReason = 'unsupported-transform';
        }
        event.transforms.push({ id, beforeTransform, afterTransform });
      }
      event.kind = transitionKind(
        transition.kind,
        event.removals.length,
        event.insertions.length,
        event.transforms.length
      );
      return event;
    }

    if (beforeState.type !== 'objects' || !Array.isArray(beforeState.order) ||
        !Array.isArray(afterState.order)) {
      event.unsupportedReason = 'unsupported-field-mutation';
      return event;
    }

    const beforeObjects = new Map((beforeState.objects || []).map(object => [object.id, object]));
    const afterObjects = new Map((afterState.objects || []).map(object => [object.id, object]));
    const beforeIndices = new Map(beforeState.order.map((id, index) => [id, index]));
    const afterIndices = new Map(afterState.order.map((id, index) => [id, index]));
    const touchedIds = [...new Set([
      ...(beforeState.touchedIds || []),
      ...(afterState.touchedIds || [])
    ])];
    const removedIds = touchedIds.filter(id => beforeObjects.has(id) && !afterObjects.has(id));
    const insertedIds = touchedIds.filter(id => !beforeObjects.has(id) && afterObjects.has(id));
    const commonIds = touchedIds.filter(id => beforeObjects.has(id) && afterObjects.has(id));
    const removedIdSet = new Set(removedIds);

    event.removals = removedIds
      .map(id => ({ id, index: beforeIndices.get(id) ?? -1 }))
      .sort((left, right) => left.index - right.index);

    const baseTransforms = transition.baseTransforms instanceof Map
      ? transition.baseTransforms
      : new Map();
    const contentStableIds = transition.contentStableIds instanceof Set
      ? transition.contentStableIds
      : new Set(Array.isArray(transition.contentStableIds) ? transition.contentStableIds : []);
    event.insertions = insertedIds
      .map(id => {
        const record = afterObjects.get(id);
        const index = afterIndices.get(id) ?? -1;
        if (transition.origin === 'history') {
          return { index, record, baseTransform: null };
        }
        const baseTransform = baseTransforms.get(id) || clonePlain(record?.transform || {});
        const finalTransform = record?.transform || {};
        const insertionRecord = storedTransformsEqual(baseTransform, finalTransform)
          ? record
          : { ...record, transform: baseTransform };
        if (!storedTransformsEqual(baseTransform, finalTransform)) {
          if (!storedTransformsEqual(
            baseTransform,
            finalTransform,
            UNSUPPORTED_PHASE0_TRANSFORM_FIELDS
          )) {
            event.unsupportedReason = 'unsupported-transform';
          }
          event.transforms.push({
            id,
            beforeTransform: baseTransform,
            afterTransform: finalTransform
          });
        }
        return { index, record: insertionRecord, baseTransform };
      })
      .sort((left, right) => left.index - right.index);

    for (const id of commonIds) {
      const beforeObject = beforeObjects.get(id);
      const afterObject = afterObjects.get(id);
      if (!contentStableIds.has(id)) {
        event.unsupportedReason = 'unsupported-field-mutation';
      }
      const beforeTransform = beforeObject?.transform || {};
      const afterTransform = afterObject?.transform || {};
      if (storedTransformsEqual(beforeTransform, afterTransform)) continue;
      if (!storedTransformsEqual(
        beforeTransform,
        afterTransform,
        UNSUPPORTED_PHASE0_TRANSFORM_FIELDS
      )) {
        event.unsupportedReason = 'unsupported-transform';
      }
      event.transforms.push({ id, beforeTransform, afterTransform });
    }

    const expectedOrder = beforeState.order.filter(id => !removedIdSet.has(id));
    for (const insertion of event.insertions) {
      expectedOrder.splice(insertion.index, 0, insertion.record.id);
    }
    if (expectedOrder.length !== afterState.order.length ||
        expectedOrder.some((id, index) => id !== afterState.order[index])) {
      event.unsupportedReason = 'unsupported-order-mutation';
    }
    event.kind = transitionKind(
      transition.kind,
      event.removals.length,
      event.insertions.length,
      event.transforms.length
    );
    return event;
  }

  function nextCommandId(scene, kind) {
    commandSequence += 1;
    return `${kind}:${scene.key}:${commandSequence}`;
  }

  function makeHistoryCommand(scene, kind, undoState, redoState, contentStableIds) {
    const command = {
      id: nextCommandId(scene, kind),
      kind,
      undoState,
      redoState
    };
    if (contentStableIds instanceof Set && contentStableIds.size > 0) {
      command.contentStableIds = [...contentStableIds];
    }
    return command;
  }

  function commitStagedMutation(scene, change) {
    const previousEstimatedBytes = scene.estimatedBytes;
    let nextEstimatedBytes;
    try {
      nextEstimatedBytes = estimateObjectsBytes(change.nextObjects);
    } catch (error) {
      return { applied: false, reason: error?.message || 'scene-validation-failed' };
    }
    const command = makeHistoryCommand(
      scene,
      change.kind,
      change.undoState,
      change.redoState,
      change.contentStableIds
    );
    const commandBytes = defaultEstimateObjectBytes(command);
    if (commandBytes > maxHistoryBytes) {
      return { applied: false, reason: 'history-capacity-exceeded' };
    }
    const projectedHistory = projectHistoryRecord(
      scene,
      command.id,
      commandBytes,
      previousEstimatedBytes,
      nextEstimatedBytes
    );
    const plannedEvictions = planProjectedEvictions(
      scene,
      nextEstimatedBytes,
      projectedHistory
    );
    if (!plannedEvictions) {
      return { applied: false, reason: 'scene-capacity-exceeded' };
    }
    const recorded = scene.history.record(command);
    if (!recorded.recorded) {
      return { applied: false, reason: recorded.reason || 'history-record-failed' };
    }
    for (const stableVideoIdentity of plannedEvictions) evictVideo(stableVideoIdentity);

    scene.historyEntries = { undo: projectedHistory.undo, redo: projectedHistory.redo };
    scene.objects = change.nextObjects;
    scene.selectedObjectIds = new Set(change.nextSelection || []);
    scene.estimatedBytes = nextEstimatedBytes;
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
    notifyCommittedTransition(scene, () => makeTransitionEvent(scene, {
      origin: 'live',
      kind: change.kind,
      estimatedBytes: commandBytes,
      beforeState: change.undoState,
      afterState: change.redoState,
      baseTransforms: change.baseTransforms,
      contentStableIds: change.contentStableIds
    }));
    return { applied: true, commandId: command.id, ...recorded };
  }

  function activateSession(session) {
    if (destroyed) return { accepted: false, reason: 'store-destroyed' };
    if (!session || typeof session.sessionId !== 'string' || session.sessionId.length === 0) {
      return { accepted: false, reason: 'invalid-session' };
    }
    if (typeof session.stableVideoIdentity !== 'string' || session.stableVideoIdentity.length === 0) {
      return { accepted: false, reason: 'invalid-video-identity' };
    }
    const targetFrame = Number(session.targetFrame);
    const videoGeneration = Number(session.videoGeneration);
    if (!Number.isInteger(targetFrame) || targetFrame < 0 || !Number.isInteger(videoGeneration) || videoGeneration < 0) {
      return { accepted: false, reason: 'invalid-session-coordinates' };
    }
    if (videoGeneration < latestVideoGeneration) {
      return { accepted: false, reason: 'stale-video-generation' };
    }

    latestVideoGeneration = Math.max(latestVideoGeneration, videoGeneration);
    const sceneKey = makeSceneKey(session.stableVideoIdentity, targetFrame);
    const restored = scenes.has(sceneKey);
    if (!restored) {
      scenes.set(sceneKey, {
        key: sceneKey,
        sceneInstanceId: allocateSceneInstanceId(),
        stableVideoIdentity: session.stableVideoIdentity,
        targetFrame,
        sourceWidth: sourceDimension(session.sourceWidth),
        sourceHeight: sourceDimension(session.sourceHeight),
        objects: new Map(),
        selectedObjectIds: new Set(),
        history: createDrawingCommandHistory({
          maxEntries: maxHistory,
          maxBytes: maxHistoryBytes
        }),
        historyEntries: { undo: [], redo: [] },
        dirty: false,
        mutationCount: 0,
        mutationSequence: 0,
        estimatedBytes: 0
      });
    }

    activeSession = {
      sessionId: session.sessionId,
      stableVideoIdentity: session.stableVideoIdentity,
      targetFrame,
      sceneKey,
      videoGeneration,
      tool: session.tool === 'select' ? 'select' : 'brush',
      toolRevision: -1
    };
    const scene = activeScene();
    scene.selectedObjectIds.clear();
    touchVideo(session.stableVideoIdentity);
    enforceLimits();
    notifySceneActivation(scene, session, restored);
    return { accepted: true, restored, sceneKey };
  }

  function deactivateSession(sessionId) {
    if (!activeSession) return { accepted: true, active: false };
    if (sessionId && sessionId !== activeSession.sessionId) {
      return { accepted: false, reason: 'stale-session' };
    }
    const scene = activeScene();
    scene?.selectedObjectIds.clear();
    activeSession = null;
    return { accepted: true, active: false };
  }

  function addStroke(stroke) {
    const scene = activeScene();
    if (!scene) return { applied: false, reason: 'no-active-session' };
    if (!stroke || typeof stroke.id !== 'string' || stroke.id.length === 0) {
      return { applied: false, reason: 'invalid-stroke' };
    }
    if (scene.objects.has(stroke.id)) return { applied: false, reason: 'duplicate-object-id' };
    if (scene.objects.size >= maxObjects) return { applied: false, reason: 'scene-object-limit-exceeded' };
    if (!Array.isArray(stroke.sourcePoints) || stroke.sourcePoints.length > MAX_STROKE_POINTS) {
      return { applied: false, reason: 'invalid-stroke-points' };
    }

    const record = clonePlain(stroke);
    const nextObjects = new Map(scene.objects);
    nextObjects.set(record.id, record);
    const touchedIds = [record.id];
    const result = commitStagedMutation(scene, {
      kind: 'add-objects',
      nextObjects,
      nextSelection: scene.selectedObjectIds,
      undoState: makeObjectsState(scene.objects, touchedIds, scene.objects.keys()),
      redoState: makeObjectsState(nextObjects, touchedIds, nextObjects.keys()),
      baseTransforms: new Map([[record.id, clonePlain(record.transform || {})]])
    });
    if (!result.applied) return result;
    return { applied: true, objectId: record.id };
  }

  function selectObjects(objectIds = []) {
    const scene = activeScene();
    if (!scene) return { changed: false, selection: [] };
    const next = new Set(objectIds.filter(id => scene.objects.has(id)));
    const changed = next.size !== scene.selectedObjectIds.size ||
      [...next].some(id => !scene.selectedObjectIds.has(id));
    scene.selectedObjectIds = next;
    return { changed, selection: [...next] };
  }

  function transformSelection(change = {}) {
    const scene = activeScene();
    if (!scene || scene.selectedObjectIds.size === 0) return { applied: false, objectIds: [] };
    const nextObjects = new Map(scene.objects);
    const changedIds = [];
    const transformById = new Map((change.transforms || []).map(item => [item.id, item.transform]));
    const dx = finiteNumber(change.dx, 0);
    const dy = finiteNumber(change.dy, 0);

    for (const id of scene.selectedObjectIds) {
      const object = scene.objects.get(id);
      if (!object) continue;
      const current = { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, ...(object.transform || {}) };
      let next = current;
      if (transformById.has(id)) {
        next = { ...current, ...clonePlain(transformById.get(id)) };
      } else if (dx !== 0 || dy !== 0) {
        next = { ...current, left: finiteNumber(current.left) + dx, top: finiteNumber(current.top) + dy };
      }
      const objectChanged = TRANSFORM_FIELDS.some(field => current[field] !== next[field]);
      if (!objectChanged) continue;
      nextObjects.set(id, { ...clonePlain(object), transform: next });
      changedIds.push(id);
    }

    if (changedIds.length === 0) return { applied: false, objectIds: [] };
    const result = commitStagedMutation(scene, {
      kind: 'transform-objects',
      nextObjects,
      nextSelection: scene.selectedObjectIds,
      undoState: makeTransformsState(scene.objects, changedIds),
      redoState: makeTransformsState(nextObjects, changedIds)
    });
    if (!result.applied) return { ...result, objectIds: [] };
    return { applied: true, objectIds: changedIds };
  }

  function replaceObjects(change = {}) {
    const scene = activeScene();
    if (!scene) return { applied: false, reason: 'no-active-session' };
    let replacements = Array.isArray(change.replacements)
      ? change.replacements.map(replacement => ({
        removeId: replacement?.removeId,
        addObjects: Array.isArray(replacement?.addObjects) ? replacement.addObjects.map(clonePlain) : []
      }))
      : [];
    if (replacements.length === 0 && Array.isArray(change.removeIds)) {
      const legacyRemoveIds = [...new Set(change.removeIds)];
      replacements = legacyRemoveIds.map((removeId, index) => ({
        removeId,
        addObjects: index === 0 && Array.isArray(change.addObjects) ? change.addObjects.map(clonePlain) : []
      }));
    }
    const removeIds = new Set(replacements.map(replacement => replacement.removeId));
    const additions = replacements.flatMap(replacement => replacement.addObjects);
    if (removeIds.size === 0 || ![...removeIds].every(id => scene.objects.has(id))) {
      return { applied: false, reason: 'invalid-replacement-source' };
    }
    if (removeIds.size !== replacements.length) {
      return { applied: false, reason: 'duplicate-replacement-source' };
    }
    const survivingIds = new Set([...scene.objects.keys()].filter(id => !removeIds.has(id)));
    const additionIds = new Set();
    for (const object of additions) {
      if (!object || typeof object.id !== 'string' || !object.id ||
          !Array.isArray(object.sourcePoints) || object.sourcePoints.length > MAX_STROKE_POINTS ||
          survivingIds.has(object.id) || additionIds.has(object.id)) {
        return { applied: false, reason: 'invalid-replacement-object' };
      }
      additionIds.add(object.id);
    }
    if (survivingIds.size + additions.length > maxObjects) {
      return { applied: false, reason: 'scene-object-limit-exceeded' };
    }

    const requestedSelection = Array.isArray(change.selectedObjectIds) ? change.selectedObjectIds : [];
    const additionBaseTransforms = new Map(additions.map(object => [
      object.id,
      clonePlain(object.transform || {})
    ]));
    const nextObjects = new Map();
    const replacementsById = new Map(replacements.map(replacement => [replacement.removeId, replacement.addObjects]));
    for (const [id, object] of scene.objects) {
      if (!removeIds.has(id)) {
        nextObjects.set(id, object);
        continue;
      }
      for (const addition of replacementsById.get(id) || []) nextObjects.set(addition.id, addition);
    }

    const nextSelection = new Set(requestedSelection.filter(id => nextObjects.has(id)));
    const transformItems = Array.isArray(change.transforms) ? change.transforms : [];
    const transformById = new Map();
    for (const item of transformItems) {
      if (!item || typeof item.id !== 'string' || !nextObjects.has(item.id) ||
          !item.transform || typeof item.transform !== 'object' || Array.isArray(item.transform) ||
          transformById.has(item.id)) {
        return { applied: false, reason: 'invalid-replacement-transform' };
      }
      transformById.set(item.id, clonePlain(item.transform));
    }
    const dx = finiteNumber(change.dx, 0);
    const dy = finiteNumber(change.dy, 0);
    const transformTargetIds = new Set(transformById.keys());
    if (dx !== 0 || dy !== 0) {
      for (const id of nextSelection) transformTargetIds.add(id);
    }
    const changedTransformIds = [];
    for (const id of transformTargetIds) {
      const object = nextObjects.get(id);
      if (!object) continue;
      const current = {
        left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0,
        skewX: 0, skewY: 0, flipX: false, flipY: false,
        ...(object.transform || {})
      };
      const next = transformById.has(id)
        ? { ...current, ...transformById.get(id) }
        : { ...current, left: finiteNumber(current.left) + dx, top: finiteNumber(current.top) + dy };
      if (!TRANSFORM_FIELDS.some(field => current[field] !== next[field])) continue;
      nextObjects.set(id, { ...clonePlain(object), transform: next });
      changedTransformIds.push(id);
    }

    const touchedIds = new Set([
      ...removeIds,
      ...additions.map(object => object.id),
      ...changedTransformIds
    ]);
    const contentStableIds = new Set(changedTransformIds.filter(id =>
      !removeIds.has(id) && !additionIds.has(id)));
    const result = commitStagedMutation(scene, {
      kind: typeof change.kind === 'string' && change.kind ? change.kind : 'split-stroke',
      nextObjects,
      nextSelection,
      undoState: makeObjectsState(scene.objects, touchedIds, scene.objects.keys()),
      redoState: makeObjectsState(nextObjects, touchedIds, nextObjects.keys()),
      baseTransforms: additionBaseTransforms,
      contentStableIds
    });
    if (!result.applied) return result;
    return {
      applied: true,
      removedIds: [...removeIds],
      addedIds: additions.map(object => object.id),
      selectedObjectIds: [...scene.selectedObjectIds],
      undoRecorded: true
    };
  }

  function applyHistoryState(scene, state) {
    if (!state || typeof state !== 'object') {
      return { applied: false, reason: 'invalid-history-state' };
    }
    let nextObjects;
    if (state.type === 'objects') {
      if (!Array.isArray(state.touchedIds) || !Array.isArray(state.objects) || !Array.isArray(state.order)) {
        return { applied: false, reason: 'invalid-history-state' };
      }
      const touchedIds = new Set(state.touchedIds);
      if (touchedIds.size !== state.touchedIds.length ||
          state.touchedIds.some(id => typeof id !== 'string' || !id)) {
        return { applied: false, reason: 'invalid-history-state' };
      }
      nextObjects = new Map(scene.objects);
      for (const id of touchedIds) nextObjects.delete(id);
      const restoredIds = new Set();
      for (const object of state.objects) {
        if (!object || typeof object.id !== 'string' || !object.id ||
            !touchedIds.has(object.id) || restoredIds.has(object.id)) {
          return { applied: false, reason: 'invalid-history-state' };
        }
        restoredIds.add(object.id);
        nextObjects.set(object.id, clonePlain(object));
      }
      const order = [...state.order];
      const orderedIds = new Set(order);
      if (orderedIds.size !== order.length || order.length !== nextObjects.size ||
          order.some(id => typeof id !== 'string' || !nextObjects.has(id))) {
        return { applied: false, reason: 'invalid-history-state' };
      }
      nextObjects = new Map(order.map(id => [id, nextObjects.get(id)]));
    } else if (state.type === 'transforms') {
      if (!Array.isArray(state.transforms)) {
        return { applied: false, reason: 'invalid-history-state' };
      }
      nextObjects = new Map(scene.objects);
      const transformedIds = new Set();
      for (const item of state.transforms) {
        if (!item || typeof item.id !== 'string' || !item.id || transformedIds.has(item.id) ||
            !nextObjects.has(item.id) || !item.transform || typeof item.transform !== 'object' ||
            Array.isArray(item.transform)) {
          return { applied: false, reason: 'invalid-history-state' };
        }
        transformedIds.add(item.id);
        nextObjects.set(item.id, {
          ...clonePlain(nextObjects.get(item.id)),
          transform: clonePlain(item.transform)
        });
      }
    } else {
      return { applied: false, reason: 'invalid-history-state' };
    }

    const nextEstimatedBytes = estimateObjectsBytes(nextObjects);
    const reservedObjectBytes = reachableObjectBytes(scene);
    const projectedBytes = calculateEstimatedBytes() - estimateSceneBytes(scene) +
      estimateSceneBytes(scene, scene.historyEntries, nextEstimatedBytes, historyDiagnostics(scene).historyBytes);
    if (nextEstimatedBytes > reservedObjectBytes || projectedBytes > maxBytes) {
      return { applied: false, reason: 'scene-capacity-exceeded' };
    }
    scene.objects = nextObjects;
    scene.selectedObjectIds = new Set();
    scene.estimatedBytes = nextEstimatedBytes;
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
    return { applied: true };
  }

  function moveHistory(direction) {
    const scene = activeScene();
    if (!scene) return { applied: false, reason: 'history-empty' };
    let transition = null;
    const result = scene.history[direction]((state, _historyDirection, entry) => {
      const applied = applyHistoryState(scene, state);
      if (applied.applied) {
        transition = {
          origin: 'history',
          kind: entry.kind,
          estimatedBytes: entry.estimatedBytes,
          beforeState: direction === 'undo' ? entry.redoState : entry.undoState,
          afterState: direction === 'undo' ? entry.undoState : entry.redoState,
          contentStableIds: entry.contentStableIds
        };
      }
      return applied;
    });
    if (!result.applied) return result;
    const from = direction === 'undo' ? scene.historyEntries.undo : scene.historyEntries.redo;
    const to = direction === 'undo' ? scene.historyEntries.redo : scene.historyEntries.undo;
    const entryIndex = from.findLastIndex(entry => entry.id === result.commandId);
    if (entryIndex >= 0) {
      const [entry] = from.splice(entryIndex, 1);
      to.push(entry);
    }
    if (transition) {
      notifyCommittedTransition(scene, () => makeTransitionEvent(scene, transition));
    }
    return {
      ...result,
      objectCount: scene.objects.size,
      selectedObjectIds: []
    };
  }

  function undo() {
    return moveHistory('undo');
  }

  function redo() {
    return moveHistory('redo');
  }

  function deleteSelection() {
    const scene = activeScene();
    if (!scene || scene.selectedObjectIds.size === 0) {
      return { applied: false, deletedCount: 0, deletedIds: [] };
    }
    const deletedIds = [...scene.selectedObjectIds].filter(id => scene.objects.has(id));
    if (deletedIds.length === 0) return { applied: false, deletedCount: 0, deletedIds };
    const nextObjects = new Map(scene.objects);
    for (const id of deletedIds) nextObjects.delete(id);
    const result = commitStagedMutation(scene, {
      kind: 'delete-objects',
      nextObjects,
      nextSelection: [],
      undoState: makeObjectsState(scene.objects, deletedIds, scene.objects.keys()),
      redoState: makeObjectsState(nextObjects, deletedIds, nextObjects.keys())
    });
    if (!result.applied) return result;
    return { applied: true, deletedCount: deletedIds.length, deletedIds };
  }

  function clearSession() {
    const scene = activeScene();
    const deletedCount = scene?.objects.size || 0;
    if (!scene || deletedCount === 0) return { applied: false, deletedCount: 0, deletedIds: [] };
    const deletedIds = [...scene.objects.keys()];
    const nextObjects = new Map();
    const result = commitStagedMutation(scene, {
      kind: 'clear-keyframe',
      nextObjects,
      nextSelection: [],
      undoState: makeObjectsState(scene.objects, deletedIds, scene.objects.keys()),
      redoState: makeObjectsState(nextObjects, deletedIds, nextObjects.keys())
    });
    if (!result.applied) return result;
    return { applied: true, deletedCount, deletedIds };
  }

  function updateTool(command = {}) {
    if (!activeSession || command.sessionId !== activeSession.sessionId) {
      return { accepted: false, reason: 'stale-session' };
    }
    const toolRevision = Number(command.toolRevision);
    if (!Number.isInteger(toolRevision) || toolRevision <= activeSession.toolRevision) {
      return { accepted: false, reason: 'stale-tool-revision' };
    }
    if (command.tool !== 'brush' && command.tool !== 'select') {
      return { accepted: false, reason: 'invalid-tool' };
    }
    activeSession.toolRevision = toolRevision;
    activeSession.tool = command.tool;
    return { accepted: true, tool: command.tool, toolRevision };
  }

  function setLocalTool(command = {}) {
    if (!activeSession || command.sessionId !== activeSession.sessionId) {
      return { accepted: false, reason: 'stale-session' };
    }
    if (command.tool !== 'brush' && command.tool !== 'select') {
      return { accepted: false, reason: 'invalid-tool' };
    }
    activeSession.tool = command.tool;
    return { accepted: true, tool: command.tool, toolRevision: activeSession.toolRevision };
  }

  function getSceneSnapshot(stableVideoIdentity, targetFrame) {
    return snapshotScene(scenes.get(makeSceneKey(stableVideoIdentity, targetFrame)));
  }

  function getActiveSceneSnapshot() {
    return snapshotScene(activeScene());
  }

  function hasScene(stableVideoIdentity, targetFrame) {
    return scenes.has(makeSceneKey(stableVideoIdentity, targetFrame));
  }

  function getDiagnostics() {
    const scene = activeScene();
    const history = historyDiagnostics(scene);
    return {
      maxVideos,
      maxBytes,
      maxObjects,
      maxHistoryBytes,
      videoCount: videoAccess.size,
      sceneCount: scenes.size,
      estimatedBytes: calculateEstimatedBytes(),
      evictionCount,
      observerFailureCount,
      observerQuarantineFailureCount,
      observerLifecycleFailureCount,
      latestVideoGeneration,
      activeSessionId: activeSession?.sessionId || null,
      activeSceneKey: activeSession?.sceneKey || null,
      tool: activeSession?.tool || null,
      toolRevision: activeSession?.toolRevision ?? -1,
      objectCount: scene?.objects.size || 0,
      selectionCount: scene?.selectedObjectIds.size || 0,
      mutationCount: scene?.mutationCount || 0,
      dirty: scene?.dirty || false,
      undoDepth: history.undoDepth,
      redoDepth: history.redoDepth,
      undoBytes: history.undoBytes,
      historyBytes: history.historyBytes,
      sceneKeys: [...scenes.keys()]
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    const droppedSceneInstanceIds = [...scenes.values()].map(scene => scene.sceneInstanceId);
    scenes.clear();
    videoAccess.clear();
    activeSession = null;
    notifyScenesDropped(droppedSceneInstanceIds);
  }

  return {
    activateSession,
    deactivateSession,
    addStroke,
    selectObjects,
    transformSelection,
    replaceObjects,
    undo,
    redo,
    deleteSelection,
    clearSession,
    updateTool,
    setLocalTool,
    getSceneSnapshot,
    getActiveSceneSnapshot,
    hasScene,
    getDiagnostics,
    destroy
  };
}

function normalizePressure(value, pointerType = 'mouse') {
  const pressure = Number(value);
  if (!Number.isFinite(pressure)) return 0.5;
  if (pointerType === 'mouse' && pressure === 0) return 0.5;
  return Math.min(1, Math.max(0, pressure));
}

function formatCoordinate(value) {
  return Number(finiteNumber(value).toFixed(3)).toString();
}

function outlineToPathData(outline) {
  if (!Array.isArray(outline) || outline.length === 0) return '';
  const first = outline[0];
  const commands = [`M ${formatCoordinate(first[0])} ${formatCoordinate(first[1])}`];
  for (let index = 1; index < outline.length; index += 1) {
    const current = outline[index];
    const next = outline[(index + 1) % outline.length];
    const midpointX = (current[0] + next[0]) / 2;
    const midpointY = (current[1] + next[1]) / 2;
    commands.push(`Q ${formatCoordinate(current[0])} ${formatCoordinate(current[1])} ${formatCoordinate(midpointX)} ${formatCoordinate(midpointY)}`);
  }
  commands.push('Z');
  return commands.join(' ');
}

function createStrokePathData(samples, options = {}) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { sourcePoints: [], outline: [], pathData: '' };
  }
  if (samples.length > MAX_STROKE_POINTS) {
    throw new RangeError(`stroke point limit exceeded: ${samples.length}/${MAX_STROKE_POINTS}`);
  }
  const sourcePoints = samples.map(sample => ({
    x: finiteNumber(sample.x),
    y: finiteNumber(sample.y),
    pressure: normalizePressure(sample.pressure, sample.pointerType),
    time: finiteNumber(sample.time ?? sample.timeStamp)
  }));
  const { getStroke } = require('perfect-freehand');
  const outline = getStroke(
    sourcePoints.map(point => [point.x, point.y, point.pressure]),
    {
      size: Math.max(1, finiteNumber(options.size, 8)),
      thinning: finiteNumber(options.thinning, 0.65),
      smoothing: finiteNumber(options.smoothing, 0.55),
      streamline: finiteNumber(options.streamline, 0.5),
      easing: options.easing,
      simulatePressure: false,
      start: options.start,
      end: options.end,
      last: options.last === true
    }
  );
  return {
    sourcePoints,
    outline: outline.map(point => [point[0], point[1]]),
    pathData: outlineToPathData(outline)
  };
}

function createActionDeduper(options = {}) {
  const maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ACTIONS);
  const entries = new Map();

  return {
    accept(actionId) {
      if (typeof actionId !== 'string' || actionId.length === 0) return false;
      if (entries.has(actionId)) {
        const value = entries.get(actionId);
        entries.delete(actionId);
        entries.set(actionId, value);
        return false;
      }
      entries.set(actionId, true);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      return true;
    },

    clear() {
      entries.clear();
    },

    get size() {
      return entries.size;
    }
  };
}

function shouldAcceptInputRequest(current = {}, request = {}) {
  if (typeof request.enabled !== 'boolean') return false;
  const hostGeneration = Number(request.hostGeneration);
  const videoGeneration = Number(request.videoGeneration);
  const inputRevision = Number(request.inputRevision);
  if (!Number.isInteger(hostGeneration) || hostGeneration < 0) return false;
  if (!Number.isInteger(videoGeneration) || videoGeneration < 0) return false;
  if (!Number.isInteger(inputRevision) || inputRevision < 0) return false;

  const currentHost = Number.isInteger(Number(current.hostGeneration)) ? Number(current.hostGeneration) : -1;
  const currentVideo = Number.isInteger(Number(current.videoGeneration)) ? Number(current.videoGeneration) : -1;
  const currentInput = Number.isInteger(Number(current.inputRevision)) ? Number(current.inputRevision) : -1;
  if (hostGeneration < currentHost || videoGeneration < currentVideo || inputRevision <= currentInput) return false;
  if (request.enabled && !request.session) return false;
  if (request.enabled && currentVideo >= 0 && videoGeneration > currentVideo) return false;
  return true;
}

function createFabricOverlayRuntime(options = {}) {
  const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
  const windowRef = options.window || (typeof window !== 'undefined' ? window : null);
  const performanceRef = options.performance || (typeof performance !== 'undefined' ? performance : null);
  const queueMicrotaskRef = options.queueMicrotask ||
    windowRef?.queueMicrotask?.bind(windowRef) ||
    globalThis.queueMicrotask?.bind(globalThis) ||
    (callback => Promise.resolve().then(callback));
  const now = () => typeof performanceRef?.now === 'function' ? performanceRef.now() : Date.now();
  const devicePixelRatio = finiteNumber(options.devicePixelRatio ?? windowRef?.devicePixelRatio, 1) || 1;
  const metrics = options.metrics || createFabricDrawingPilotMetrics(options.metricsOptions);
  const drawingV3ShadowRequested = options.drawingV3ShadowEnabled === true;
  const customSceneStore = options.sceneStore || null;
  let drawingV3Adapter = null;
  let drawingV3ShadowStartupFailed = false;
  if (drawingV3ShadowRequested && !customSceneStore) {
    try {
      const adapterFactory = options.drawingV3AdapterFactory === undefined
        ? createDrawingEngineAdapter
        : options.drawingV3AdapterFactory;
      if (typeof adapterFactory !== 'function') throw new TypeError('Invalid Drawing V3 adapter factory');
      const candidate = adapterFactory(options.drawingV3AdapterOptions || {});
      const requiredMethods = [
        'activateScene',
        'enqueueTransition',
        'quarantineScene',
        'dropScenes',
        'destroy',
        'getDiagnostics'
      ];
      if (!candidate || requiredMethods.some(method => typeof candidate[method] !== 'function')) {
        throw new TypeError('Invalid Drawing V3 adapter');
      }
      drawingV3Adapter = candidate;
    } catch (_error) {
      drawingV3ShadowStartupFailed = true;
    }
  }
  const sceneStore = customSceneStore || createSessionSceneStore({
    ...(options.sceneStoreOptions || {}),
    ...(drawingV3Adapter ? { drawingEngineObserver: drawingV3Adapter } : {})
  });
  const actionDeduper = options.actionDeduper || createActionDeduper(options.actionDeduperOptions);
  const strokePathFactory = options.strokePathFactory || createStrokePathData;
  const maxLassoFragments = positiveInteger(options.maxLassoFragments, 512);
  const tokenState = { hostGeneration: -1, videoGeneration: -1, inputRevision: -1 };
  const domListeners = [];
  const fabricListeners = [];
  let fabricModule = null;
  let root = null;
  let container = null;
  let viewportElement = null;
  let canvasElement = null;
  let toolbar = null;
  let badge = null;
  const toolButtons = new Map();
  let fabricCanvas = null;
  let prepared = false;
  let destroyed = false;
  let inputEnabled = false;
  let currentSession = null;
  let activeStroke = null;
  let activeLasso = null;
  let pendingLassoSelection = null;
  let brushStyle = { ...DEFAULT_BRUSH_STYLE };
  let brushControls = null;
  let brushPanelOpen = false;
  let selectionMode = 'stroke';
  let selectionControls = null;
  let transformStart = null;
  let selectGesture = null;
  const ignoredModifiedTargets = new WeakSet();
  let deferredViewport = null;
  let longTaskObserver = null;
  let localSequence = 0;
  let lastError = null;
  let appliedSourceWidth = null;
  let appliedSourceHeight = null;

  function resolveFabric() {
    if (!fabricModule) fabricModule = options.fabric || require('fabric');
    if (!fabricModule?.Canvas || !fabricModule?.Path) throw new Error('Fabric Canvas and Path exports are required');
    return fabricModule;
  }

  function addDomListener(target, type, listener, listenerOptions) {
    domListeners.push({ target, type, listener, listenerOptions });
    target?.addEventListener?.(type, listener, listenerOptions);
  }

  function addFabricListener(type, listener) {
    fabricListeners.push({ type, listener });
    fabricCanvas.on(type, listener);
  }

  function setStyles(element, styles) {
    if (!element?.style) return;
    Object.assign(element.style, styles);
  }

  function createButton(label, action) {
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.fabricPilotAction = action;
    if (action === 'brush' || action === 'select') {
      button.dataset.active = 'false';
      button.setAttribute?.('aria-pressed', 'false');
      toolButtons.set(action, button);
    }
    return button;
  }

  function syncSelectionControls(tool = currentSession?.tool) {
    if (!selectionControls) return;
    selectionControls.group.style.display = tool === 'select' ? 'flex' : 'none';
    for (const [mode, button] of selectionControls.buttons) {
      const active = selectionMode === mode;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
  }

  function setSelectionMode(mode) {
    const nextMode = mode === 'lasso' ? 'lasso' : 'stroke';
    if (selectionMode !== nextMode) abortPendingLassoSelection();
    const selectedObjectIds = sceneStore.getActiveSceneSnapshot()?.selectedObjectIds || [];
    if (selectionMode !== nextMode && (activeLasso || selectGesture || transformStart || deferredViewport)) {
      cancelActiveLasso();
      cancelSelectInteraction();
    }
    selectionMode = nextMode;
    if (currentSession?.tool === 'select') {
      setToolMode('select');
      if (selectionMode === 'lasso' && selectedObjectIds.length > 0) activateObjectIds(selectedObjectIds);
    }
    else syncSelectionControls();
    return selectionMode;
  }

  function createSelectionModeControls() {
    const group = documentRef.createElement('div');
    group.dataset.fabricPilotGroup = 'selection-mode';
    group.setAttribute?.('role', 'group');
    group.setAttribute?.('aria-label', '선택 방식');
    setStyles(group, {
      display: 'none',
      alignItems: 'center',
      gap: '4px',
      padding: '3px',
      borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.08)'
    });

    const strokeButton = createButton('획', 'select-stroke');
    strokeButton.setAttribute?.('aria-label', '획 전체 선택');
    const lassoButton = createButton('라쏘', 'select-lasso');
    lassoButton.setAttribute?.('aria-label', '라쏘 부분 선택');
    const buttons = new Map([
      ['stroke', strokeButton],
      ['lasso', lassoButton]
    ]);
    for (const button of buttons.values()) {
      button.setAttribute?.('aria-pressed', 'false');
      group.appendChild(button);
    }
    addDomListener(strokeButton, 'click', () => setSelectionMode('stroke'));
    addDomListener(lassoButton, 'click', () => setSelectionMode('lasso'));
    return { group, buttons, strokeButton, lassoButton };
  }

  function setBrushColor(color) {
    if (!BRUSH_COLORS.includes(color)) return brushStyle.color;
    brushStyle = { ...brushStyle, color };
    syncBrushControls();
    return brushStyle.color;
  }

  function setBrushSize(value) {
    brushStyle = {
      ...brushStyle,
      size: boundedInteger(value, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, brushStyle.size)
    };
    syncBrushControls();
    return brushStyle.size;
  }

  function setBrushOpacityPercent(value) {
    const currentPercent = Math.round(brushStyle.opacity * 100);
    const percent = boundedInteger(
      value,
      MIN_BRUSH_OPACITY_PERCENT,
      MAX_BRUSH_OPACITY_PERCENT,
      currentPercent
    );
    brushStyle = { ...brushStyle, opacity: percent / 100 };
    syncBrushControls();
    return percent;
  }

  function syncBrushControls() {
    if (!brushControls) return;
    const opacityPercent = Math.round(brushStyle.opacity * 100);
    brushControls.settingsButton.setAttribute?.('aria-expanded', String(brushPanelOpen));
    brushControls.panel.style.display = brushPanelOpen ? 'flex' : 'none';
    brushControls.sizeInput.value = String(brushStyle.size);
    brushControls.opacityInput.value = String(opacityPercent);
    brushControls.sizeOutput.textContent = `${brushStyle.size}px`;
    brushControls.opacityOutput.textContent = `${opacityPercent}%`;
    brushControls.summary.textContent = `${brushStyle.size}px · ${opacityPercent}%`;
    brushControls.colorPreview.style.background = brushStyle.color;
    brushControls.sizePreview.style.width = `${Math.min(22, Math.max(2, brushStyle.size))}px`;
    brushControls.sizePreview.style.height = brushControls.sizePreview.style.width;
    brushControls.sizePreview.style.background = brushStyle.color;
    brushControls.sizePreview.style.opacity = String(brushStyle.opacity);
    for (const button of brushControls.colorButtons) {
      const active = button.dataset.fabricPilotColor === brushStyle.color;
      button.setAttribute?.('aria-pressed', String(active));
      button.style.boxShadow = active
        ? '0 0 0 2px #fff, 0 0 0 4px rgba(255, 71, 87, 0.75)'
        : 'none';
    }
  }

  function createBrushSettingsControls() {
    const settingsButton = createButton('', 'brush-settings');
    settingsButton.setAttribute?.('aria-expanded', 'false');
    settingsButton.setAttribute?.('aria-label', '브러시 설정');
    setStyles(settingsButton, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      minHeight: '40px'
    });

    const colorPreview = documentRef.createElement('span');
    colorPreview.dataset.fabricPilotOutput = 'color-preview';
    setStyles(colorPreview, {
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      border: '1px solid rgba(0, 0, 0, 0.35)',
      flex: '0 0 auto'
    });
    const summary = documentRef.createElement('span');
    summary.dataset.fabricPilotOutput = 'summary';
    settingsButton.appendChild(colorPreview);
    settingsButton.appendChild(summary);

    const panel = documentRef.createElement('div');
    panel.dataset.fabricPilotPanel = 'brush-settings';
    panel.setAttribute?.('role', 'group');
    panel.setAttribute?.('aria-label', '브러시 설정');
    setStyles(panel, {
      display: 'none',
      position: 'absolute',
      top: '52px',
      left: '0',
      width: '360px',
      maxWidth: 'calc(100vw - 24px)',
      flexDirection: 'column',
      gap: '12px',
      padding: '12px',
      boxSizing: 'border-box',
      borderRadius: '8px',
      background: 'rgba(24, 24, 28, 0.96)',
      color: '#fff'
    });

    const previewRow = documentRef.createElement('div');
    setStyles(previewRow, {
      display: 'flex',
      alignItems: 'center',
      minHeight: '22px'
    });
    const sizePreview = documentRef.createElement('span');
    sizePreview.dataset.fabricPilotOutput = 'size-preview';
    setStyles(sizePreview, {
      display: 'block',
      borderRadius: '50%',
      flex: '0 0 auto'
    });
    previewRow.appendChild(sizePreview);

    const palette = documentRef.createElement('div');
    setStyles(palette, {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px'
    });
    const colorButtons = BRUSH_COLORS.map(color => {
      const button = createButton('', 'brush-color');
      button.dataset.fabricPilotColor = color;
      button.setAttribute?.('aria-label', `브러시 색상 ${BRUSH_COLOR_LABELS[color]}`);
      button.setAttribute?.('aria-pressed', 'false');
      setStyles(button, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '40px',
        minHeight: '40px'
      });
      const dot = documentRef.createElement('span');
      setStyles(dot, {
        width: '22px',
        height: '22px',
        borderRadius: '50%',
        background: color,
        border: color === '#ffffff' ? '1px solid rgba(0, 0, 0, 0.7)' : 'none'
      });
      button.appendChild(dot);
      palette.appendChild(button);
      return button;
    });

    const createRangeRow = ({
      label,
      setting,
      min,
      max,
      decreaseAction,
      decreaseLabel,
      increaseAction,
      increaseLabel,
      output
    }) => {
      const row = documentRef.createElement('div');
      setStyles(row, {
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      });
      const labelElement = documentRef.createElement('span');
      labelElement.textContent = label;
      const decrease = createButton('−', decreaseAction);
      decrease.setAttribute?.('aria-label', decreaseLabel);
      const input = documentRef.createElement('input');
      input.type = 'range';
      input.tabIndex = -1;
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.dataset.fabricPilotSetting = setting;
      input.setAttribute?.('aria-label', label);
      setStyles(input, { flex: '1 1 auto', minWidth: '0' });
      const increase = createButton('+', increaseAction);
      increase.setAttribute?.('aria-label', increaseLabel);
      const outputElement = documentRef.createElement('span');
      outputElement.dataset.fabricPilotOutput = output;
      outputElement.setAttribute?.('role', 'status');
      outputElement.setAttribute?.('aria-live', 'polite');
      outputElement.setAttribute?.('aria-atomic', 'true');
      setStyles(outputElement, { minWidth: '42px', textAlign: 'right' });
      row.appendChild(labelElement);
      row.appendChild(decrease);
      row.appendChild(input);
      row.appendChild(increase);
      row.appendChild(outputElement);
      return { row, decrease, input, increase, output: outputElement };
    };

    const sizeRow = createRangeRow({
      label: '브러시 크기',
      setting: 'size',
      min: MIN_BRUSH_SIZE,
      max: MAX_BRUSH_SIZE,
      decreaseAction: 'size-decrease',
      decreaseLabel: '브러시 크기 1px 줄이기',
      increaseAction: 'size-increase',
      increaseLabel: '브러시 크기 1px 늘리기',
      output: 'size'
    });
    const opacityRow = createRangeRow({
      label: '브러시 불투명도',
      setting: 'opacity',
      min: MIN_BRUSH_OPACITY_PERCENT,
      max: MAX_BRUSH_OPACITY_PERCENT,
      decreaseAction: 'opacity-decrease',
      decreaseLabel: '브러시 불투명도 1% 줄이기',
      increaseAction: 'opacity-increase',
      increaseLabel: '브러시 불투명도 1% 늘리기',
      output: 'opacity'
    });

    panel.appendChild(previewRow);
    panel.appendChild(palette);
    panel.appendChild(sizeRow.row);
    panel.appendChild(opacityRow.row);

    addDomListener(settingsButton, 'click', () => {
      brushPanelOpen = !brushPanelOpen;
      syncBrushControls();
    });
    addDomListener(sizeRow.input, 'input', () => setBrushSize(sizeRow.input.value));
    addDomListener(opacityRow.input, 'input', () => setBrushOpacityPercent(opacityRow.input.value));
    addDomListener(sizeRow.decrease, 'click', () => setBrushSize(brushStyle.size - 1));
    addDomListener(sizeRow.increase, 'click', () => setBrushSize(brushStyle.size + 1));
    addDomListener(opacityRow.decrease, 'click', () => {
      setBrushOpacityPercent(Math.round(brushStyle.opacity * 100) - 1);
    });
    addDomListener(opacityRow.increase, 'click', () => {
      setBrushOpacityPercent(Math.round(brushStyle.opacity * 100) + 1);
    });
    for (const button of colorButtons) {
      addDomListener(button, 'click', () => setBrushColor(button.dataset.fabricPilotColor));
    }

    return {
      settingsButton,
      panel,
      colorButtons,
      sizeInput: sizeRow.input,
      opacityInput: opacityRow.input,
      sizeOutput: sizeRow.output,
      opacityOutput: opacityRow.output,
      summary,
      colorPreview,
      sizePreview
    };
  }

  function createId(prefix) {
    localSequence += 1;
    const randomUUID = windowRef?.crypto?.randomUUID || globalThis.crypto?.randomUUID;
    return typeof randomUUID === 'function'
      ? randomUUID.call(windowRef?.crypto || globalThis.crypto)
      : `${prefix}-${Date.now()}-${localSequence}`;
  }

  function captureTransform(object) {
    const transform = {};
    for (const field of TRANSFORM_FIELDS) {
      if (typeof object?.[field] === 'boolean') transform[field] = object[field];
      else transform[field] = finiteNumber(object?.[field], field === 'scaleX' || field === 'scaleY' ? 1 : 0);
    }
    return transform;
  }

  function transformTargets(target) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return [];
    const children = typeof target.getObjects === 'function' ? target.getObjects() : [];
    return [target, ...children].filter(candidate =>
      candidate && (typeof candidate === 'object' || typeof candidate === 'function'));
  }

  function ignoreLateModifiedEvents(target) {
    for (const candidate of transformTargets(target)) ignoredModifiedTargets.add(candidate);
  }

  function acceptsModifiedEvent(target) {
    const candidates = transformTargets(target);
    return candidates.length === 0 || !candidates.some(candidate => ignoredModifiedTargets.has(candidate));
  }

  function beginModifiedEventGeneration(target) {
    for (const candidate of transformTargets(target)) ignoredModifiedTargets.delete(candidate);
  }

  function applyMoveOnlyConstraints(object) {
    if (!object?.set) return;
    object.set({
      hasControls: false,
      lockMovementX: false,
      lockMovementY: false,
      lockScalingX: true,
      lockScalingY: true,
      lockScalingFlip: true,
      lockRotation: true,
      lockSkewingX: true,
      lockSkewingY: true
    });
  }

  function applyUnselectedPermanentPathPolicy(object, tolerance = resolveSelectionHitTolerance(currentSession || {})) {
    if (!object?.set) return;
    object.set({
      padding: tolerance,
      perPixelTargetFind: true,
      hoverCursor: 'grab',
      moveCursor: 'grabbing'
    });
  }

  function applySelectedActivePolicy(object) {
    if (!object?.set) return;
    object.set({
      perPixelTargetFind: false,
      hoverCursor: 'move',
      moveCursor: 'grabbing'
    });
  }

  function restoreUnsupportedTransform(object, persistedTransform = {}) {
    const values = {};
    for (const field of UNSUPPORTED_PHASE0_TRANSFORM_FIELDS) {
      const fallback = field === 'scaleX' || field === 'scaleY' ? 1 : field === 'flipX' || field === 'flipY' ? false : 0;
      values[field] = persistedTransform[field] ?? fallback;
    }
    object.set(values);
    applyMoveOnlyConstraints(object);
    object.setCoords?.();
  }

  function makeFabricPath(record, transient = false) {
    const { Path } = resolveFabric();
    const path = new Path(record.pathData, {
      fill: record.style?.color || DEFAULT_BRUSH_STYLE.color,
      opacity: normalizePathOpacity(record.style?.opacity),
      stroke: null,
      strokeWidth: 0,
      selectable: !transient && sceneStore.getDiagnostics().tool === 'select',
      evented: !transient && sceneStore.getDiagnostics().tool === 'select',
      objectCaching: !transient,
      perPixelTargetFind: !transient,
      padding: transient ? 0 : resolveSelectionHitTolerance(currentSession || {}),
      hoverCursor: transient ? null : 'grab',
      moveCursor: transient ? null : 'grabbing',
      hasControls: false,
      lockMovementX: false,
      lockMovementY: false,
      lockScalingX: true,
      lockScalingY: true,
      lockScalingFlip: true,
      lockRotation: true,
      lockSkewingX: true,
      lockSkewingY: true
    });
    if (record.transform) path.set(record.transform);
    if (!transient) {
      applyMoveOnlyConstraints(path);
      applyUnselectedPermanentPathPolicy(path);
    }
    path.__baeframeObjectId = record.id || null;
    path.__baeframeTransient = transient;
    path.setCoords?.();
    return path;
  }

  function updateObjectMetric() {
    metrics.setObjectCount(sceneStore.getDiagnostics().objectCount);
  }

  function renderActiveScene() {
    if (!fabricCanvas) return;
    const snapshot = sceneStore.getActiveSceneSnapshot();
    fabricCanvas.clear();
    for (const record of snapshot?.objects || []) fabricCanvas.add(makeFabricPath(record));
    refreshSelectionInteractionPolicy();
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
  }

  function setToolMode(tool) {
    if (!fabricCanvas) return;
    if (tool !== 'select') abortPendingLassoSelection();
    const selectMode = tool === 'select';
    const nativeSelectMode = selectMode && selectionMode === 'stroke';
    for (const [buttonTool, button] of toolButtons) {
      const active = buttonTool === tool;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = nativeSelectMode;
    fabricCanvas.defaultCursor = selectMode
      ? (selectionMode === 'lasso' ? 'crosshair' : 'default')
      : 'crosshair';
    fabricCanvas.hoverCursor = 'grab';
    fabricCanvas.moveCursor = 'grabbing';
    fabricCanvas.freeDrawingCursor = 'crosshair';
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      object.set({ selectable: nativeSelectMode, evented: nativeSelectMode });
    }
    if (!selectMode) {
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
    }
    syncSelectionControls(tool);
    refreshSelectionInteractionPolicy();
    fabricCanvas.setCursor?.(fabricCanvas.defaultCursor);
    fabricCanvas.requestRenderAll();
  }

  function setSurfaceInput(enabled) {
    const pointerEvents = enabled ? 'auto' : 'none';
    setStyles(fabricCanvas?.upperCanvasEl, { pointerEvents });
    setStyles(fabricCanvas?.lowerCanvasEl, { pointerEvents });
    setStyles(toolbar, {
      pointerEvents,
      visibility: enabled ? 'visible' : 'hidden',
      opacity: enabled ? '1' : '0'
    });
  }

  function toSourceSample(event) {
    if (!currentSession) return null;
    const point = mapClientPointToSource(
      event,
      currentSession.canvasRect,
      currentSession.viewportTransform,
      { width: currentSession.sourceWidth, height: currentSession.sourceHeight }
    );
    if (!point) return null;
    return {
      ...point,
      pressure: normalizePressure(event.pressure, event.pointerType),
      pointerType: event.pointerType || 'mouse',
      time: finiteNumber(event.timeStamp, now())
    };
  }

  function appendPointerSample(event) {
    const sample = toSourceSample(event);
    if (!sample) return;
    activeStroke.samples.push(sample);
    metrics.recordPointerSample(sample.pressure);
  }

  function removeTransientPreview() {
    if (!activeStroke?.preview || !fabricCanvas) return;
    fabricCanvas.remove(activeStroke.preview);
    activeStroke.preview = null;
  }

  function updateTransientPreview() {
    if (!activeStroke || activeStroke.samples.length === 0) return;
    const startedAt = now();
    removeTransientPreview();
    try {
      const strokeData = strokePathFactory(activeStroke.samples, { size: activeStroke.style.size });
      if (!strokeData.pathData) return;
      activeStroke.preview = makeFabricPath({
        id: null,
        pathData: strokeData.pathData,
        style: { ...activeStroke.style }
      }, true);
      fabricCanvas.add(activeStroke.preview);
      fabricCanvas.requestRenderAll();
      metrics.recordPointerPreviewLatency(now() - startedAt);
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      cancelActiveStroke();
    }
  }

  function cancelActiveStroke() {
    removeTransientPreview();
    activeStroke = null;
    activeLasso = null;
    fabricCanvas?.requestRenderAll();
  }

  function removeLassoPreview() {
    if (!activeLasso?.preview || !fabricCanvas) return;
    fabricCanvas.remove(activeLasso.preview);
    activeLasso.preview = null;
  }

  function appendLassoPoint(event) {
    if (!activeLasso) return;
    const point = mapClientPointToSource(
      event,
      currentSession?.canvasRect,
      currentSession?.viewportTransform,
      { width: currentSession?.sourceWidth, height: currentSession?.sourceHeight }
    );
    if (!point) return;
    const previous = activeLasso.points[activeLasso.points.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) return;
    if (activeLasso.points.length >= MAX_LASSO_POINTS) {
      activeLasso.points = activeLasso.points.filter((_sample, index) => index === 0 || index % 2 === 0);
    }
    activeLasso.points.push(point);
  }

  function updateLassoPreview() {
    if (!activeLasso || activeLasso.points.length < 2 || !fabricCanvas) return;
    removeLassoPreview();
    const { Path } = resolveFabric();
    const [first, ...rest] = activeLasso.points;
    const pathData = `M ${first.x} ${first.y} ${rest.map(point => `L ${point.x} ${point.y}`).join(' ')}`;
    const preview = new Path(pathData, {
      fill: 'rgba(255, 208, 0, 0.08)',
      stroke: '#ffd000',
      strokeWidth: Math.max(1, resolveSelectionHitTolerance(currentSession || {}) / 3),
      strokeDashArray: [8, 6],
      selectable: false,
      evented: false,
      objectCaching: false,
      perPixelTargetFind: false
    });
    preview.__baeframeObjectId = null;
    preview.__baeframeTransient = true;
    activeLasso.preview = preview;
    fabricCanvas.add(preview);
    fabricCanvas.requestRenderAll();
  }

  function cancelActiveLasso() {
    if (!activeLasso) return;
    const pointerId = activeLasso.pointerId;
    removeLassoPreview();
    activeLasso = null;
    releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, pointerId);
    fabricCanvas?.requestRenderAll();
  }

  function flattenStrokeSourcePoints(record, object) {
    const points = Array.isArray(record?.sourcePoints) ? record.sourcePoints : [];
    const { Point, util } = resolveFabric();
    if (!object?.calcTransformMatrix || !object?.pathOffset || !Point || !util?.transformPoint) {
      return points.map(point => ({ ...point }));
    }
    const matrix = object.calcTransformMatrix();
    return points.map(point => {
      const local = new Point(
        finiteNumber(point.x) - finiteNumber(object.pathOffset.x),
        finiteNumber(point.y) - finiteNumber(object.pathOffset.y)
      );
      const transformed = util.transformPoint(local, matrix);
      return { ...point, x: transformed.x, y: transformed.y };
    });
  }

  function createStrokeFragment(record, points, selected, caps = {}) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let strokeData;
    try {
      strokeData = strokePathFactory(points, {
        size: record.style?.size,
        last: true,
        start: { cap: caps.start !== false },
        end: { cap: caps.end !== false }
      });
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      return null;
    }
    if (!strokeData?.pathData || !Array.isArray(strokeData.sourcePoints) || strokeData.sourcePoints.length < 2) {
      return null;
    }
    const fragment = {
      id: createId(selected ? 'lasso-selected' : 'lasso-remain'),
      type: 'stroke',
      pathData: strokeData.pathData,
      sourcePoints: strokeData.sourcePoints,
      style: clonePlain(record.style || DEFAULT_BRUSH_STYLE),
      strokeCaps: {
        start: caps.start !== false,
        end: caps.end !== false
      }
    };
    const path = makeFabricPath(fragment);
    fragment.transform = captureTransform(path);
    return fragment;
  }

  function pendingTargetMatches(target, objectIds) {
    if (!target || !objectIds?.size) return false;
    const children = typeof target.getObjects === 'function' ? target.getObjects() : [target];
    const targetIds = children.map(object => object?.__baeframeObjectId).filter(Boolean);
    if (targetIds.length !== objectIds.size) return false;
    const uniqueTargetIds = new Set(targetIds);
    return uniqueTargetIds.size === objectIds.size &&
      targetIds.every(id => objectIds.has(id));
  }

  function pendingLassoIsFresh(pending = pendingLassoSelection) {
    if (!pending) return false;
    return pending.sessionId === currentSession?.sessionId &&
      pending.inputRevision === tokenState.inputRevision &&
      pending.sourceMutationCount === sceneStore.getDiagnostics().mutationCount;
  }

  function reorderCanvasObjects(order = []) {
    if (!fabricCanvas) return;
    const objectsById = new Map(
      fabricCanvas.getObjects()
        .filter(object => object.__baeframeObjectId)
        .map(object => [object.__baeframeObjectId, object])
    );
    order.forEach((id, index) => {
      const object = objectsById.get(id);
      if (object) fabricCanvas.moveObjectTo?.(object, index);
    });
  }

  function pendingReplacementOrder(pending) {
    const replacementsById = new Map(
      pending.replacements.map(replacement => [replacement.removeId, replacement.addObjects])
    );
    return pending.originalOrder.flatMap(id => (
      replacementsById.has(id)
        ? replacementsById.get(id).map(object => object.id)
        : [id]
    ));
  }

  function stagePendingLassoSelection({
    replacements,
    selectedPersistedIds,
    selectedFragmentIds,
    snapshot,
    canvasObjects
  }) {
    if (!fabricCanvas || !currentSession || replacements.length === 0 || selectedFragmentIds.size === 0) {
      return { staged: false, reason: 'invalid-pending-lasso' };
    }
    abortPendingLassoSelection();
    const originalFabricObjects = replacements.map(replacement => {
      const object = canvasObjects.get(replacement.removeId);
      return object
        ? {
          id: replacement.removeId,
          object,
          transform: captureTransform(object),
          opacity: object.opacity
        }
        : null;
    });
    if (originalFabricObjects.some(entry => !entry)) {
      return { staged: false, reason: 'missing-original-fabric-object' };
    }
    const selectedPersistedFabricObjects = [...selectedPersistedIds].map(id => {
      const object = canvasObjects.get(id);
      return object ? { id, object, transform: captureTransform(object), opacity: object.opacity } : null;
    }).filter(Boolean);
    if (selectedPersistedFabricObjects.length !== selectedPersistedIds.size) {
      return { staged: false, reason: 'missing-selected-fabric-object' };
    }
    const fragmentFabricObjects = new Map();
    try {
      for (const record of replacements.flatMap(replacement => replacement.addObjects)) {
        if (!selectedFragmentIds.has(record.id)) continue;
        const proxy = makeFabricPath(record);
        proxy.set({ opacity: 0 });
        proxy.__baeframePendingLasso = true;
        proxy.setCoords?.();
        fragmentFabricObjects.set(record.id, proxy);
        fabricCanvas.add(proxy);
      }
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      for (const object of fragmentFabricObjects.values()) {
        try {
          fabricCanvas.remove(object);
        } catch (_error) { /* best-effort staged proxy cleanup */ }
      }
      fabricCanvas.requestRenderAll?.();
      return { staged: false, reason: 'fragment-proxy-build-failed' };
    }
    if (fragmentFabricObjects.size !== selectedFragmentIds.size) {
      for (const object of fragmentFabricObjects.values()) fabricCanvas.remove(object);
      return { staged: false, reason: 'fragment-proxy-build-failed' };
    }
    pendingLassoSelection = {
      sessionId: currentSession.sessionId,
      inputRevision: tokenState.inputRevision,
      sourceMutationCount: sceneStore.getDiagnostics().mutationCount,
      replacements: clonePlain(replacements),
      selectedPersistedIds: new Set(selectedPersistedIds),
      selectedFragmentIds: new Set(selectedFragmentIds),
      selectedIds: new Set([...selectedPersistedIds, ...selectedFragmentIds]),
      originalFabricObjects,
      selectedPersistedFabricObjects,
      fragmentFabricObjects,
      originalOrder: (snapshot?.objects || []).map(object => object.id),
      activeTarget: null,
      initialTargetTransform: null,
      startTargetTransform: null,
      phase: 'selected'
    };
    refreshSelectionInteractionPolicy();
    fabricCanvas.requestRenderAll();
    return { staged: true };
  }

  function abortPendingLassoSelection(options = {}) {
    const pending = pendingLassoSelection;
    if (!pending) return false;
    pendingLassoSelection = null;
    if (!fabricCanvas) return true;
    const authoritative = options.authoritative === true || !pendingLassoIsFresh(pending);
    fabricCanvas.discardActiveObject();
    sceneStore.selectObjects([]);
    if (authoritative) {
      renderActiveScene();
      return true;
    }

    for (const object of [...fabricCanvas.getObjects()]) {
      if (object.__baeframePendingLasso) fabricCanvas.remove(object);
    }
    const existingIds = new Set(
      fabricCanvas.getObjects().map(object => object.__baeframeObjectId).filter(Boolean)
    );
    for (const entry of pending.originalFabricObjects) {
      entry.object.set({ ...entry.transform, opacity: entry.opacity });
      entry.object.__baeframePendingLasso = false;
      entry.object.setCoords?.();
      if (!existingIds.has(entry.id)) {
        fabricCanvas.add(entry.object);
        existingIds.add(entry.id);
      }
    }
    for (const entry of pending.selectedPersistedFabricObjects) {
      entry.object.set({ ...entry.transform, opacity: entry.opacity });
      entry.object.setCoords?.();
    }
    reorderCanvasObjects(pending.originalOrder);
    refreshSelectionInteractionPolicy();
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
    return true;
  }

  function materializePendingLassoSelection(target = fabricCanvas?.getActiveObject?.()) {
    const pending = pendingLassoSelection;
    if (!pending || !fabricCanvas) return false;
    if (!pendingLassoIsFresh(pending)) {
      abortPendingLassoSelection({ authoritative: true });
      return false;
    }
    if (pending.phase === 'moving') return true;
    pending.phase = 'moving';
    pending.activeTarget = target || pending.activeTarget;
    pending.startTargetTransform = transformStart?.target === pending.activeTarget
      ? clonePlain(transformStart.transform)
      : clonePlain(pending.initialTargetTransform || captureTransform(pending.activeTarget));

    try {
      const createdFragmentIds = [];
      for (const replacement of pending.replacements) {
        for (const record of replacement.addObjects) {
          if (pending.fragmentFabricObjects.has(record.id)) continue;
          const object = makeFabricPath(record);
          object.__baeframePendingLasso = true;
          pending.fragmentFabricObjects.set(record.id, object);
          createdFragmentIds.push(record.id);
        }
      }
      for (const entry of pending.originalFabricObjects) fabricCanvas.remove(entry.object);
      for (const id of createdFragmentIds) {
        fabricCanvas.add(pending.fragmentFabricObjects.get(id));
      }
      for (const replacement of pending.replacements) {
        for (const record of replacement.addObjects) {
          if (!pending.selectedFragmentIds.has(record.id)) continue;
          const object = pending.fragmentFabricObjects.get(record.id);
          object.set({ opacity: normalizePathOpacity(record.style?.opacity) });
          object.setCoords?.();
        }
      }
      reorderCanvasObjects(pendingReplacementOrder(pending));
      refreshSelectionInteractionPolicy();
      fabricCanvas.requestRenderAll();
      return true;
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      abortPendingLassoSelection();
      return false;
    }
  }

  function commitPendingLassoMove(target = fabricCanvas?.getActiveObject?.()) {
    const pending = pendingLassoSelection;
    if (!pending) return { applied: false, reason: 'no-pending-lasso' };
    if (!pendingLassoIsFresh(pending)) {
      abortPendingLassoSelection({ authoritative: true });
      return { applied: false, reason: 'stale-pending-lasso' };
    }
    if (pending.phase !== 'moving' && !materializePendingLassoSelection(target)) {
      return { applied: false, reason: 'pending-lasso-materialize-failed' };
    }
    const activeTarget = target || pending.activeTarget;
    const start = pending.startTargetTransform || pending.initialTargetTransform || {};
    const dx = finiteNumber(activeTarget?.left) - finiteNumber(start.left);
    const dy = finiteNumber(activeTarget?.top) - finiteNumber(start.top);
    if (Math.abs(dx) <= 1e-7 && Math.abs(dy) <= 1e-7) {
      abortPendingLassoSelection();
      return { applied: false, reason: 'no-op-transform' };
    }
    if (!pendingLassoIsFresh(pending)) {
      abortPendingLassoSelection({ authoritative: true });
      return { applied: false, reason: 'stale-pending-lasso' };
    }
    const selectedObjectIds = [...pending.selectedIds];
    const result = sceneStore.replaceObjects({
      replacements: pending.replacements,
      selectedObjectIds,
      dx,
      dy,
      kind: 'split-stroke'
    });
    if (!result.applied) {
      abortPendingLassoSelection();
      return result;
    }
    pendingLassoSelection = null;
    renderActiveScene();
    if (selectedObjectIds.length === 1) activateObjectIds(selectedObjectIds);
    else {
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
      refreshSelectionInteractionPolicy();
      fabricCanvas.setCursor?.(fabricCanvas.defaultCursor || 'default');
      fabricCanvas.requestRenderAll();
      const sessionId = currentSession?.sessionId;
      const inputRevision = tokenState.inputRevision;
      queueMicrotaskRef(() => {
        if (destroyed || !inputEnabled || !fabricCanvas || fabricCanvas.getActiveObject?.()) return;
        if (currentSession?.sessionId !== sessionId || tokenState.inputRevision !== inputRevision) return;
        fabricCanvas.setCursor?.(fabricCanvas.defaultCursor || 'default');
      });
    }
    updateObjectMetric();
    return { ...result, selectedObjectIds };
  }

  function commitPendingLassoDelete() {
    const pending = pendingLassoSelection;
    if (!pending) return { applied: false, reason: 'no-pending-lasso' };
    if (!pendingLassoIsFresh(pending)) {
      abortPendingLassoSelection({ authoritative: true });
      return { applied: false, reason: 'stale-pending-lasso' };
    }
    const replacements = pending.replacements.map(replacement => ({
      removeId: replacement.removeId,
      addObjects: replacement.addObjects.filter(object => !pending.selectedFragmentIds.has(object.id))
    }));
    const replacementSourceIds = new Set(replacements.map(replacement => replacement.removeId));
    for (const id of pending.selectedPersistedIds) {
      if (!replacementSourceIds.has(id)) replacements.push({ removeId: id, addObjects: [] });
    }
    const deletedIds = [...pending.selectedFragmentIds, ...pending.selectedPersistedIds];
    const result = sceneStore.replaceObjects({
      replacements,
      selectedObjectIds: [],
      kind: 'split-stroke'
    });
    if (!result.applied) {
      abortPendingLassoSelection();
      return result;
    }
    pendingLassoSelection = null;
    renderActiveScene();
    fabricCanvas.discardActiveObject();
    sceneStore.selectObjects([]);
    refreshSelectionInteractionPolicy();
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
    return { ...result, deletedCount: deletedIds.length, deletedIds };
  }

  function activateObjectIds(objectIds = []) {
    if (!fabricCanvas) return;
    const ids = new Set(objectIds);
    fabricCanvas.discardActiveObject();
    const objects = fabricCanvas.getObjects().filter(object => ids.has(object.__baeframeObjectId));
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      const selected = ids.has(object.__baeframeObjectId);
      object.set({ selectable: selected, evented: selected });
    }
    if (objects.length === 1) {
      fabricCanvas.setActiveObject?.(objects[0]);
    } else if (objects.length > 1) {
      const { ActiveSelection } = resolveFabric();
      if (ActiveSelection) {
        fabricCanvas.setActiveObject?.(new ActiveSelection(objects, { canvas: fabricCanvas }));
      }
    }
    sceneStore.selectObjects(objects.map(object => object.__baeframeObjectId));
    refreshSelectionInteractionPolicy();
    fabricCanvas.requestRenderAll();
  }

  function finalizeActiveLasso() {
    if (!activeLasso) return { applied: false, reason: 'no-active-lasso' };
    const sourcePerCssPixel = currentSession
      ? currentSession.sourceWidth / Math.max(1, currentSession.canvasRect.width) /
        Math.max(0.01, Math.abs(finiteNumber(currentSession.viewportTransform?.scale, 1)))
      : 1;
    const polygon = simplifyClosedPolygon(
      activeLasso.points,
      Math.min(8, Math.max(0.25, sourcePerCssPixel * 1.5))
    );
    removeLassoPreview();
    activeLasso = null;
    if (polygon.length < 3 || !polygonHasArea(polygon, 1)) {
      activateObjectIds([]);
      return { applied: false, reason: 'lasso-too-small' };
    }

    const snapshot = sceneStore.getActiveSceneSnapshot();
    const canvasObjects = new Map(
      fabricCanvas.getObjects()
        .filter(object => object.__baeframeObjectId)
        .map(object => [object.__baeframeObjectId, object])
    );
    const replacements = [];
    const selectedPersistedIds = new Set();
    const selectedFragmentIds = new Set();
    const polygonBounds = boundsForPoints(polygon);
    const sceneLimits = sceneStore.getDiagnostics();
    let accumulatedFragments = 0;

    for (const record of snapshot?.objects || []) {
      if (record.type !== 'stroke') continue;
      const flattenedPoints = flattenStrokeSourcePoints(record, canvasObjects.get(record.id));
      const maximumRadius = Math.max(1, finiteNumber(record.style?.size, 1)) * 0.825;
      if (!boundsIntersect(boundsForPoints(flattenedPoints, maximumRadius), polygonBounds)) continue;
      const split = splitStrokePointsByPolygon(flattenedPoints, polygon, {
        size: record.style?.size,
        thinning: 0.65,
        maxRuns: Math.max(1, maxLassoFragments - accumulatedFragments + 1)
      });
      if (split.limitExceeded) {
        activateObjectIds([]);
        return { applied: false, reason: 'lasso-fragment-limit-exceeded', selectedObjectIds: [] };
      }
      if (split.inside.length === 0) continue;
      if (split.outside.length === 0) {
        selectedPersistedIds.add(record.id);
        continue;
      }
      accumulatedFragments += split.runs.length;
      const projectedObjectCount = snapshot.objects.length - (replacements.length + 1) + accumulatedFragments;
      if (accumulatedFragments > maxLassoFragments || projectedObjectCount > sceneLimits.maxObjects) {
        activateObjectIds([]);
        return { applied: false, reason: 'lasso-fragment-limit-exceeded', selectedObjectIds: [] };
      }
      const addObjects = [];
      let fragmentBuildFailed = false;
      const originalCaps = record.strokeCaps || { start: true, end: true };
      for (let runIndex = 0; runIndex < split.runs.length; runIndex += 1) {
        const run = split.runs[runIndex];
        const selected = run.kind === 'inside';
        const fragment = createStrokeFragment(record, run.points, selected, {
          start: runIndex === 0 ? originalCaps.start !== false : false,
          end: runIndex === split.runs.length - 1 ? originalCaps.end !== false : false
        });
        if (!fragment) {
          fragmentBuildFailed = true;
          break;
        }
        addObjects.push(fragment);
        if (selected) selectedFragmentIds.add(fragment.id);
      }
      if (fragmentBuildFailed) {
        activateObjectIds([]);
        return { applied: false, reason: 'fragment-build-failed', selectedObjectIds: [] };
      }
      replacements.push({ removeId: record.id, addObjects });
    }

    const selectedObjectIds = [...selectedPersistedIds, ...selectedFragmentIds];
    let result = { applied: false, selectedObjectIds };
    if (replacements.length > 0 && selectedFragmentIds.size > 0) {
      const staged = stagePendingLassoSelection({
        replacements,
        selectedPersistedIds,
        selectedFragmentIds,
        snapshot,
        canvasObjects
      });
      if (!staged.staged) {
        activateObjectIds([]);
        return { applied: false, reason: staged.reason, selectedObjectIds: [] };
      }
      result = { applied: false, pending: true, selectedObjectIds };
    }
    activateObjectIds(selectedObjectIds);
    if (pendingLassoSelection) {
      pendingLassoSelection.activeTarget = fabricCanvas.getActiveObject?.() || null;
      pendingLassoSelection.initialTargetTransform = captureTransform(pendingLassoSelection.activeTarget);
    }
    return { ...result, selectedObjectIds };
  }

  function pointerTargetsActiveSelection(event) {
    const activeObject = fabricCanvas?.getActiveObject?.();
    if (!activeObject) return false;
    try {
      const point = fabricCanvas.getScenePoint?.(event) || {
        x: finiteNumber(event?.clientX),
        y: finiteNumber(event?.clientY)
      };
      const bounds = activeObject.getBoundingRect?.();
      if (bounds && point.x >= bounds.left && point.x <= bounds.left + bounds.width &&
          point.y >= bounds.top && point.y <= bounds.top + bounds.height) {
        return true;
      }
    } catch (_error) { /* bounds lookup is best-effort */ }
    let target = null;
    try {
      target = fabricCanvas.findTarget?.(event) || null;
    } catch (_error) { /* target lookup is best-effort */ }
    if (target === activeObject) return true;
    const activeChildren = typeof activeObject.getObjects === 'function' ? activeObject.getObjects() : [];
    return activeChildren.includes(target);
  }

  function finalizeActiveStroke() {
    if (!activeStroke || activeStroke.samples.length === 0) {
      cancelActiveStroke();
      return { applied: false };
    }
    const samples = activeStroke.samples;
    const style = { ...activeStroke.style };
    removeTransientPreview();
    let strokeData;
    try {
      strokeData = strokePathFactory(samples, { size: style.size, last: true });
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      activeStroke = null;
      return { applied: false, reason: 'stroke-path-error' };
    }
    const record = {
      id: createId('stroke'),
      type: 'stroke',
      pathData: strokeData.pathData,
      sourcePoints: strokeData.sourcePoints,
      style
    };
    const path = makeFabricPath(record);
    record.transform = captureTransform(path);
    const result = sceneStore.addStroke(record);
    activeStroke = null;
    if (!result.applied) return result;
    fabricCanvas.add(path);
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
    return result;
  }

  function releasePointerCapture(target, pointerId) {
    try {
      if (typeof target?.hasPointerCapture === 'function' && !target.hasPointerCapture(pointerId)) return;
      target?.releasePointerCapture?.(pointerId);
    } catch (_error) { /* best-effort pointer release */ }
  }

  function rollbackSelectTransform(event, shouldEndTransform) {
    const start = transformStart;
    if (!start?.target) {
      transformStart = null;
      return;
    }
    try {
      start.target.set?.(start.transform);
      applyMoveOnlyConstraints(start.target);
      start.target.setCoords?.();
      if (shouldEndTransform) fabricCanvas?.endCurrentTransform?.(event);
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
    }
    transformStart = null;
    fabricCanvas?.requestRenderAll();
  }

  function drainFabricPointerLifecycle(gesture, event) {
    const targetDocument = fabricCanvas?.upperCanvasEl?.ownerDocument || documentRef;
    if (!gesture || typeof targetDocument?.dispatchEvent !== 'function') return;
    try {
      const properties = {
        clientX: finiteNumber(event?.clientX),
        clientY: finiteNumber(event?.clientY),
        pointerId: gesture.pointerId,
        pointerType: event?.pointerType || 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 0,
        pressure: 0
      };
      let pointerUp;
      if (typeof windowRef?.PointerEvent === 'function') {
        pointerUp = new windowRef.PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          ...properties
        });
      } else {
        pointerUp = new windowRef.Event('pointerup', { bubbles: true, cancelable: true });
        for (const [name, value] of Object.entries(properties)) {
          Object.defineProperty(pointerUp, name, { value });
        }
      }
      targetDocument.dispatchEvent(pointerUp);
    } catch (_error) { /* best-effort Fabric pointer lifecycle cleanup */ }
  }

  function cancelSelectInteraction(event) {
    const gesture = selectGesture;
    const hadTransformTarget = !!transformStart?.target;
    const wasTracking = gesture?.phase === 'tracking';
    if (gesture) gesture.phase = 'cancelling';
    rollbackSelectTransform(event, wasTracking);
    drainFabricPointerLifecycle(gesture, event);
    if (gesture && !hadTransformTarget) {
      fabricCanvas?.discardActiveObject();
      sceneStore.selectObjects([]);
    }
    if (gesture) {
      releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, gesture.pointerId);
    }
    selectGesture = null;
    transformStart = null;
    deferredViewport = null;
    if (gesture && pendingLassoSelection) {
      abortPendingLassoSelection();
      return;
    }
    refreshSelectionInteractionPolicy();
    fabricCanvas?.requestRenderAll();
  }

  function settleDeferredViewport(sessionId, inputRevision) {
    const pending = deferredViewport;
    deferredViewport = null;
    if (!pending || pending.sessionId !== sessionId || pending.inputRevision !== inputRevision) return false;
    if (destroyed || !inputEnabled || !fabricCanvas || currentSession?.sessionId !== sessionId) return false;
    if (pending.command.revision <= currentSession.viewportRevision) return false;
    applyViewportCommand(pending.command);
    return true;
  }

  function scheduleSelectGestureSettle(gesture) {
    const pointerId = gesture.pointerId;
    queueMicrotaskRef(() => {
      if (selectGesture !== gesture || gesture.pointerId !== pointerId || gesture.phase !== 'settling') return;
      if (destroyed || !inputEnabled || !fabricCanvas ||
          currentSession?.sessionId !== gesture.sessionId ||
          tokenState.inputRevision !== gesture.inputRevision) {
        selectGesture = null;
        transformStart = null;
        deferredViewport = null;
        return;
      }

      transformStart = null;
      selectGesture = null;
      settleDeferredViewport(gesture.sessionId, gesture.inputRevision);
    });
  }

  function onPointerDown(event) {
    if (!inputEnabled || event.button !== 0) return;
    const tool = sceneStore.getDiagnostics().tool;
    if (tool === 'brush') {
      if (activeStroke || selectGesture) return;
      activeStroke = {
        pointerId: event.pointerId,
        samples: [],
        preview: null,
        style: { ...brushStyle }
      };
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      appendPointerSample(event);
      updateTransientPreview();
      event.preventDefault?.();
      return;
    }
    if (tool !== 'select' || selectGesture || activeStroke) return;
    if (selectionMode === 'lasso') {
      if (activeLasso) return;
      if (pointerTargetsActiveSelection(event)) {
        selectGesture = {
          pointerId: event.pointerId,
          sessionId: currentSession?.sessionId,
          inputRevision: tokenState.inputRevision,
          phase: 'tracking'
        };
        try {
          event.currentTarget?.setPointerCapture?.(event.pointerId);
        } catch (_error) { /* pointer capture is best-effort */ }
        return;
      }
      abortPendingLassoSelection();
      activeLasso = {
        pointerId: event.pointerId,
        sessionId: currentSession?.sessionId,
        inputRevision: tokenState.inputRevision,
        points: [],
        preview: null
      };
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch (_error) { /* pointer capture is best-effort */ }
      appendLassoPoint(event);
      event.preventDefault?.();
      return;
    }
    selectGesture = {
      pointerId: event.pointerId,
      sessionId: currentSession?.sessionId,
      inputRevision: tokenState.inputRevision,
      phase: 'tracking'
    };
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (_error) { /* pointer capture is best-effort */ }
  }

  function onPointerMove(event) {
    if (activeLasso) {
      if (event.pointerId !== activeLasso.pointerId) return;
      appendLassoPoint(event);
      updateLassoPreview();
      event.preventDefault?.();
      return;
    }
    if (!activeStroke || event.pointerId !== activeStroke.pointerId) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [event];
    for (const sample of samples) appendPointerSample(sample);
    updateTransientPreview();
    event.preventDefault?.();
  }

  function onPointerUp(event) {
    if (activeLasso) {
      if (event.pointerId !== activeLasso.pointerId) return;
      const { sessionId, inputRevision } = activeLasso;
      appendLassoPoint(event);
      releasePointerCapture(event.currentTarget || fabricCanvas?.upperCanvasEl, event.pointerId);
      finalizeActiveLasso();
      settleDeferredViewport(sessionId, inputRevision);
      event.preventDefault?.();
      return;
    }
    if (activeStroke) {
      if (event.pointerId !== activeStroke.pointerId) return;
      appendPointerSample(event);
      releasePointerCapture(event.currentTarget, event.pointerId);
      finalizeActiveStroke();
      event.preventDefault?.();
      return;
    }
    const gesture = selectGesture;
    if (!gesture || gesture.phase !== 'tracking' || event.pointerId !== gesture.pointerId) return;
    gesture.phase = 'settling';
    releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, event.pointerId);
    scheduleSelectGestureSettle(gesture);
  }

  function onPointerCancel(event) {
    if (activeLasso) {
      if (event.pointerId !== undefined && event.pointerId !== activeLasso.pointerId) return;
      const { sessionId, inputRevision } = activeLasso;
      cancelActiveLasso();
      settleDeferredViewport(sessionId, inputRevision);
      return;
    }
    if (activeStroke) {
      if (event.pointerId !== undefined && event.pointerId !== activeStroke.pointerId) return;
      cancelActiveStroke();
      return;
    }
    const gesture = selectGesture;
    if (!gesture) {
      if (pendingLassoSelection) abortPendingLassoSelection();
      return;
    }
    if (event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
    if (event.type === 'lostpointercapture' && gesture.phase === 'settling') return;
    cancelSelectInteraction(event);
  }

  function onDocumentPointerUp(event) {
    if (activeLasso && event.pointerId === activeLasso.pointerId) {
      onPointerUp(event);
      return;
    }
    if (!selectGesture || event.pointerId !== selectGesture.pointerId) return;
    onPointerUp(event);
  }

  function onDocumentPointerCancel(event) {
    if (activeLasso && event.pointerId === activeLasso.pointerId) {
      onPointerCancel(event);
      return;
    }
    if (!selectGesture || event.pointerId !== selectGesture.pointerId) return;
    onPointerCancel(event);
  }

  function selectionIds() {
    const objects = fabricCanvas?.getActiveObjects?.() || [];
    return objects.map(object => object.__baeframeObjectId).filter(Boolean);
  }

  function scheduleMovedMultiSelectionRelease(target, selectedIds) {
    const sessionId = currentSession?.sessionId;
    const inputRevision = tokenState.inputRevision;
    const expectedSelection = [...selectedIds].sort().join(SCENE_KEY_SEPARATOR);
    queueMicrotaskRef(() => {
      if (destroyed || !inputEnabled || !fabricCanvas) return;
      if (currentSession?.sessionId !== sessionId || tokenState.inputRevision !== inputRevision) return;
      if (fabricCanvas.getActiveObject?.() !== target) return;
      if (selectionIds().sort().join(SCENE_KEY_SEPARATOR) !== expectedSelection) return;
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
      refreshSelectionInteractionPolicy();
      fabricCanvas.setCursor?.(fabricCanvas.defaultCursor || 'default');
      fabricCanvas.requestRenderAll();
    });
  }

  function onSelectionChanged() {
    if (pendingLassoSelection &&
        !pendingTargetMatches(fabricCanvas?.getActiveObject?.(), pendingLassoSelection.selectedIds)) {
      abortPendingLassoSelection();
      return;
    }
    refreshSelectionInteractionPolicy();
    sceneStore.selectObjects(selectionIds());
  }

  function onSelectionCleared() {
    if (pendingLassoSelection) {
      abortPendingLassoSelection();
      return;
    }
    refreshSelectionInteractionPolicy();
    sceneStore.selectObjects([]);
  }

  function onBeforeTransform(event) {
    const target = event?.transform?.target || event?.target;
    if (!target) return;
    beginModifiedEventGeneration(target);
    if (pendingLassoSelection && !pendingTargetMatches(target, pendingLassoSelection.selectedIds)) {
      transformStart = null;
      abortPendingLassoSelection();
      return;
    }
    transformStart = {
      target,
      transform: captureTransform(target)
    };
    if (pendingLassoSelection) {
      pendingLassoSelection.activeTarget = target;
      pendingLassoSelection.startTargetTransform = clonePlain(transformStart.transform);
    }
  }

  function onObjectMoving(event) {
    const target = event?.target;
    if (!pendingLassoSelection) return;
    if (!pendingTargetMatches(target, pendingLassoSelection.selectedIds)) {
      transformStart = null;
      abortPendingLassoSelection();
      return;
    }
    if (!materializePendingLassoSelection(target)) transformStart = null;
  }

  function onObjectModified(event) {
    const target = event?.target;
    if (!target) return;
    if (!acceptsModifiedEvent(target)) {
      transformStart = null;
      return;
    }
    if (pendingLassoSelection && !pendingTargetMatches(target, pendingLassoSelection.selectedIds)) {
      abortPendingLassoSelection();
      transformStart = null;
      return;
    }
    if (pendingLassoSelection) {
      const result = commitPendingLassoMove(target);
      transformStart = null;
      if (result.applied) updateObjectMetric();
      return;
    }
    const children = typeof target.getObjects === 'function' ? target.getObjects() : [target];
    const ids = children.map(object => object.__baeframeObjectId).filter(Boolean);
    sceneStore.selectObjects(ids);
    let result;
    if (children.length > 1 && transformStart?.target === target) {
      restoreUnsupportedTransform(target, transformStart.transform);
      result = sceneStore.transformSelection({
        dx: finiteNumber(target.left) - finiteNumber(transformStart.transform.left),
        dy: finiteNumber(target.top) - finiteNumber(transformStart.transform.top)
      });
    } else {
      const persistedObjects = new Map(
        (sceneStore.getActiveSceneSnapshot()?.objects || []).map(object => [object.id, object.transform || {}])
      );
      result = sceneStore.transformSelection({
        transforms: children.map(object => {
          const persisted = persistedObjects.get(object.__baeframeObjectId) || {};
          const left = finiteNumber(object.left, finiteNumber(persisted.left));
          const top = finiteNumber(object.top, finiteNumber(persisted.top));
          restoreUnsupportedTransform(object, persisted);
          return { id: object.__baeframeObjectId, transform: { ...captureTransform(object), left, top } };
        })
      });
    }
    if (!result.applied) {
      rollbackSelectTransform(event, false);
      return;
    }
    const shouldReleaseMultiSelection = result.applied && children.length > 1;
    transformStart = null;
    if (result.applied) updateObjectMetric();
    if (shouldReleaseMultiSelection) scheduleMovedMultiSelectionRelease(target, ids);
  }

  function configureCanvasEvents() {
    const pointerTarget = fabricCanvas.upperCanvasEl || canvasElement;
    addDomListener(pointerTarget, 'pointerdown', onPointerDown, true);
    addDomListener(pointerTarget, 'pointermove', onPointerMove);
    addDomListener(pointerTarget, 'pointerup', onPointerUp);
    addDomListener(pointerTarget, 'pointercancel', onPointerCancel);
    addDomListener(pointerTarget, 'lostpointercapture', onPointerCancel);
    addDomListener(documentRef, 'pointerup', onDocumentPointerUp);
    addDomListener(documentRef, 'pointercancel', onDocumentPointerCancel);
    addDomListener(windowRef, 'blur', onPointerCancel);
    addFabricListener('selection:created', onSelectionChanged);
    addFabricListener('selection:updated', onSelectionChanged);
    addFabricListener('selection:cleared', onSelectionCleared);
    addFabricListener('before:transform', onBeforeTransform);
    addFabricListener('object:moving', onObjectMoving);
    addFabricListener('object:modified', onObjectModified);
  }

  function configureLongTaskObserver() {
    const Observer = options.PerformanceObserver || windowRef?.PerformanceObserver;
    if (typeof Observer !== 'function') return;
    try {
      longTaskObserver = new Observer(list => {
        for (const entry of list.getEntries()) metrics.recordLongTask(entry.duration);
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch (_error) {
      longTaskObserver = null;
    }
  }

  function refreshSelectionInteractionPolicy(session = currentSession) {
    if (!fabricCanvas) return;
    const tolerance = resolveSelectionHitTolerance(session || {});
    const selectTool = sceneStore.getDiagnostics().tool === 'select';
    const nativeSelection = selectTool && selectionMode === 'stroke';
    const activeIds = new Set(selectionIds());
    fabricCanvas.setTargetFindTolerance?.(tolerance);
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      applyMoveOnlyConstraints(object);
      applyUnselectedPermanentPathPolicy(object, tolerance);
      const activeInLasso = selectTool && selectionMode === 'lasso' && activeIds.has(object.__baeframeObjectId);
      object.set({ selectable: nativeSelection || activeInLasso, evented: nativeSelection || activeInLasso });
      object.setCoords?.();
    }

    const activeObject = fabricCanvas.getActiveObject?.();
    const activeChildren = typeof activeObject?.getObjects === 'function'
      ? activeObject.getObjects()
      : [];
    const isPermanentPath = !!activeObject?.__baeframeObjectId && !activeObject.__baeframeTransient;
    const isPermanentActiveSelection = activeChildren.length > 0 && activeChildren.every(
      object => !!object?.__baeframeObjectId && !object.__baeframeTransient
    );
    if (isPermanentPath || isPermanentActiveSelection) {
      applyMoveOnlyConstraints(activeObject);
      applySelectedActivePolicy(activeObject);
      activeObject.set?.({ selectable: true, evented: true });
      activeObject.setCoords?.();
    }
  }

  function applyViewport(session) {
    const rect = session.canvasRect;
    if (session.sourceWidth !== appliedSourceWidth || session.sourceHeight !== appliedSourceHeight) {
      fabricCanvas.setDimensions(
        { width: session.sourceWidth, height: session.sourceHeight },
        { backstoreOnly: true }
      );
      appliedSourceWidth = session.sourceWidth;
      appliedSourceHeight = session.sourceHeight;
    }
    fabricCanvas.setDimensions(
      { width: rect.width, height: rect.height },
      { cssOnly: true }
    );
    refreshSelectionInteractionPolicy(session);
    const viewportTransform = normalizeViewportTransform(session.viewportTransform);
    setStyles(viewportElement, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      transform: `scale(${viewportTransform.scale}) translate(${viewportTransform.panX}px, ${viewportTransform.panY}px)`,
      transformOrigin: 'center center'
    });
    fabricCanvas.calcOffset();
    fabricCanvas.requestRenderAll();
  }

  function applyViewportCommand(command) {
    currentSession.canvasRect = {
      left: finiteNumber(command.canvasRect.left),
      top: finiteNumber(command.canvasRect.top),
      width: finiteNumber(command.canvasRect.width),
      height: finiteNumber(command.canvasRect.height)
    };
    currentSession.viewportTransform = normalizeViewportTransform(command);
    currentSession.viewportRevision = command.revision;
    applyViewport(currentSession);
  }

  function validateSession(session) {
    return !!session &&
      typeof session.sessionId === 'string' && session.sessionId.length > 0 &&
      typeof session.stableVideoIdentity === 'string' && session.stableVideoIdentity.length > 0 &&
      Number.isInteger(Number(session.targetFrame)) && Number(session.targetFrame) >= 0 &&
      finiteNumber(session.sourceWidth) > 0 && finiteNumber(session.sourceHeight) > 0 &&
      finiteNumber(session.canvasRect?.width) > 0 && finiteNumber(session.canvasRect?.height) > 0;
  }

  function disableInput() {
    abortPendingLassoSelection();
    cancelActiveLasso();
    cancelSelectInteraction();
    setSurfaceInput(false);
    fabricCanvas?.setCursor?.('default');
    cancelActiveStroke();
    fabricCanvas?.discardActiveObject();
    refreshSelectionInteractionPolicy();
    sceneStore.selectObjects([]);
    inputEnabled = false;
    currentSession = null;
    sceneStore.deactivateSession();
    if (badge) badge.textContent = '새 드로잉 시험판 · 저장 안 됨 · 시험 프레임 -';
  }

  function releaseSurfaceResources() {
    cancelSelectInteraction();
    for (const { target, type, listener, listenerOptions } of domListeners.splice(0)) {
      try {
        target?.removeEventListener?.(type, listener, listenerOptions);
      } catch (_error) { /* best-effort prepare rollback */ }
    }
    for (const { type, listener } of fabricListeners.splice(0)) {
      try {
        fabricCanvas?.off?.(type, listener);
      } catch (_error) { /* best-effort prepare rollback */ }
    }
    try {
      longTaskObserver?.disconnect?.();
    } catch (_error) { /* best-effort prepare rollback */ }
    longTaskObserver = null;
    try {
      fabricCanvas?.dispose?.();
    } catch (_error) { /* best-effort prepare rollback */ }
    try {
      container?.remove?.();
    } catch (_error) { /* best-effort prepare rollback */ }
    toolButtons.clear();
    fabricCanvas = null;
    appliedSourceWidth = null;
    appliedSourceHeight = null;
    activeStroke = null;
    pendingLassoSelection = null;
    transformStart = null;
    selectGesture = null;
    deferredViewport = null;
    inputEnabled = false;
    currentSession = null;
    viewportElement = null;
    canvasElement = null;
    toolbar = null;
    brushControls = null;
    selectionControls = null;
    badge = null;
    container = null;
    root = null;
    prepared = false;
  }

  function prepare(nextRoot) {
    if (destroyed) return { prepared: false, reason: 'destroyed' };
    if (prepared) {
      return nextRoot === root
        ? { prepared: true, reused: true }
        : { prepared: false, reason: 'already-prepared-for-another-root' };
    }
    if (!nextRoot?.appendChild || !documentRef?.createElement) {
      return { prepared: false, reason: 'invalid-root' };
    }

    try {
      resolveFabric();
      root = nextRoot;
      container = documentRef.createElement('div');
      container.className = 'mpv-fabric-overlay-surface';
      setStyles(container, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '40'
      });
      viewportElement = documentRef.createElement('div');
      viewportElement.className = 'mpv-fabric-pilot-viewport';
      setStyles(viewportElement, { position: 'absolute', pointerEvents: 'none' });
      canvasElement = documentRef.createElement('canvas');
      canvasElement.className = 'mpv-fabric-delta-canvas';
      toolbar = documentRef.createElement('div');
      toolbar.className = 'mpv-fabric-pilot-toolbar';
      setStyles(toolbar, {
        position: 'absolute',
        top: '12px',
        left: '12px',
        display: 'flex',
        gap: '6px',
        zIndex: '2',
        transition: 'opacity 100ms ease',
        pointerEvents: 'none'
      });
      const brushButton = createButton('Brush', 'brush');
      const selectButton = createButton('V', 'select');
      const undoButton = createButton('Undo', 'undo');
      const redoButton = createButton('Redo', 'redo');
      const deleteButton = createButton('Delete', 'delete-selection');
      const clearButton = createButton('Clear', 'clear-session');
      brushControls = createBrushSettingsControls();
      selectionControls = createSelectionModeControls();
      badge = documentRef.createElement('span');
      badge.className = 'mpv-fabric-pilot-badge';
      badge.textContent = '새 드로잉 시험판 · 저장 안 됨 · 시험 프레임 -';
      toolbar.appendChild(brushButton);
      toolbar.appendChild(selectButton);
      toolbar.appendChild(selectionControls.group);
      toolbar.appendChild(undoButton);
      toolbar.appendChild(redoButton);
      toolbar.appendChild(deleteButton);
      toolbar.appendChild(clearButton);
      toolbar.appendChild(brushControls.settingsButton);
      toolbar.appendChild(brushControls.panel);
      toolbar.appendChild(badge);
      viewportElement.appendChild(canvasElement);
      container.appendChild(viewportElement);
      container.appendChild(toolbar);
      root.appendChild(container);

      const { Canvas } = resolveFabric();
      fabricCanvas = new Canvas(canvasElement, {
        selection: true,
        preserveObjectStacking: true,
        enableRetinaScaling: false,
        enablePointerEvents: true,
        defaultCursor: 'default',
        hoverCursor: 'grab',
        moveCursor: 'grabbing',
        freeDrawingCursor: 'crosshair'
      });
      configureCanvasEvents();
      addDomListener(brushButton, 'click', () => updateLocalDrawingTool('brush'));
      addDomListener(selectButton, 'click', () => updateLocalDrawingTool('select'));
      addDomListener(undoButton, 'click', () => applyDrawingAction({
        sessionId: currentSession?.sessionId,
        actionId: createId('undo'),
        action: 'undo'
      }));
      addDomListener(redoButton, 'click', () => applyDrawingAction({
        sessionId: currentSession?.sessionId,
        actionId: createId('redo'),
        action: 'redo'
      }));
      addDomListener(deleteButton, 'click', () => applyDrawingAction({
        sessionId: currentSession?.sessionId,
        actionId: createId('delete'),
        action: 'delete-selection'
      }));
      addDomListener(clearButton, 'click', () => applyDrawingAction({
        sessionId: currentSession?.sessionId,
        actionId: createId('clear'),
        action: 'clear-session'
      }));
      syncBrushControls();
      syncSelectionControls('brush');
      setSurfaceInput(false);
      configureLongTaskObserver();
      prepared = true;
      return { prepared: true, reused: false };
    } catch (error) {
      releaseSurfaceResources();
      lastError = error.message;
      metrics.recordSurfaceError();
      return { prepared: false, reason: 'fabric-prepare-failed', error: error.message };
    }
  }

  function setDrawingInput(request = {}) {
    const startedAt = now();
    if (!prepared || destroyed) return { accepted: false, reason: destroyed ? 'destroyed' : 'not-prepared' };
    if (!shouldAcceptInputRequest(tokenState, request)) {
      metrics.recordStaleMessageDrop();
      return { accepted: false, reason: 'stale-or-invalid-input-request' };
    }
    if (request.enabled && !validateSession(request.session)) {
      return { accepted: false, reason: 'invalid-session' };
    }

    abortPendingLassoSelection();
    if (activeStroke) cancelActiveStroke();
    if (activeLasso) cancelActiveLasso();
    if (selectGesture || transformStart || deferredViewport) cancelSelectInteraction();

    tokenState.hostGeneration = Number(request.hostGeneration);
    tokenState.videoGeneration = Number(request.videoGeneration);
    tokenState.inputRevision = Number(request.inputRevision);

    if (!request.enabled) {
      const lastTool = currentSession?.tool === 'select' ? 'select' : 'brush';
      disableInput();
      metrics.recordToggleLatency(now() - startedAt);
      return { accepted: true, enabled: false, tool: lastTool };
    }

    const session = {
      ...clonePlain(request.session),
      targetFrame: Number(request.session.targetFrame),
      sourceWidth: Number(request.session.sourceWidth),
      sourceHeight: Number(request.session.sourceHeight),
      videoGeneration: Number(request.videoGeneration),
      viewportRevision: Math.max(-1, Math.trunc(Number(request.session.viewportRevision) || 0)),
      viewportTransform: normalizeViewportTransform(request.session.viewportTransform),
      tool: request.session.tool === 'select' ? 'select' : 'brush'
    };
    const activation = sceneStore.activateSession(session);
    if (!activation.accepted) {
      metrics.recordStaleMessageDrop();
      return activation;
    }
    currentSession = session;
    applyViewport(session);
    renderActiveScene();
    setToolMode(session.tool);
    inputEnabled = true;
    setSurfaceInput(true);
    badge.textContent = `새 드로잉 시험판 · 저장 안 됨 · 시험 프레임 ${session.targetFrame}`;
    metrics.recordToggleLatency(now() - startedAt);
    return { accepted: true, enabled: true, restored: activation.restored };
  }

  function updateViewport(command = {}) {
    if (!inputEnabled || !currentSession) return { accepted: false, reason: 'input-disabled' };
    const revision = Number(command.revision);
    const rect = command.canvasRect;
    if (!Number.isInteger(revision) || revision < 0 ||
        !rect || finiteNumber(rect.width) <= 0 || finiteNumber(rect.height) <= 0) {
      return { accepted: false, reason: 'invalid-viewport' };
    }
    const pendingRevision = deferredViewport?.command?.revision ?? -1;
    if (revision <= Math.max(currentSession.viewportRevision, pendingRevision)) {
      return { accepted: false, reason: 'stale-viewport' };
    }

    const normalizedCommand = {
      revision,
      canvasRect: {
        left: finiteNumber(rect.left),
        top: finiteNumber(rect.top),
        width: finiteNumber(rect.width),
        height: finiteNumber(rect.height)
      },
      ...normalizeViewportTransform(command)
    };
    if (activeLasso || selectGesture || transformStart !== null) {
      deferredViewport = {
        sessionId: currentSession.sessionId,
        inputRevision: tokenState.inputRevision,
        command: normalizedCommand
      };
      return { accepted: true, deferred: true, revision };
    }

    cancelActiveStroke();
    applyViewportCommand(normalizedCommand);
    return { accepted: true, revision };
  }

  function updateDrawingTool(command = {}) {
    if (!inputEnabled) return { accepted: false, reason: 'input-disabled' };
    const normalized = { ...command, tool: command.tool === 'select' || command.tool === 'V' ? 'select' : command.tool };
    const result = sceneStore.updateTool(normalized);
    if (!result.accepted) {
      metrics.recordStaleMessageDrop();
      return result;
    }
    currentSession.tool = result.tool;
    setToolMode(result.tool);
    return result;
  }

  function updateLocalDrawingTool(tool) {
    if (!inputEnabled) return { accepted: false, reason: 'input-disabled' };
    const result = sceneStore.setLocalTool({ sessionId: currentSession?.sessionId, tool });
    if (!result.accepted) return result;
    currentSession.tool = result.tool;
    setToolMode(result.tool);
    return result;
  }

  function applyDrawingAction(command = {}) {
    if (!inputEnabled || command.sessionId !== currentSession?.sessionId) {
      return { applied: false, reason: 'stale-session' };
    }
    const action = command.action || command.type;
    if (!DRAWING_ACTIONS.has(action)) {
      return { applied: false, reason: 'invalid-action' };
    }
    if (!actionDeduper.accept(command.actionId)) {
      metrics.recordDuplicateAction();
      return { applied: false, duplicate: true };
    }
    if (pendingLassoSelection) {
      if (action === 'delete-selection') return commitPendingLassoDelete();
      abortPendingLassoSelection();
    }
    if ((action === 'undo' || action === 'redo') && (selectGesture || transformStart)) {
      ignoreLateModifiedEvents(transformStart?.target || fabricCanvas?.getActiveObject?.());
      cancelSelectInteraction();
    }

    const result = action === 'delete-selection'
      ? sceneStore.deleteSelection()
      : action === 'clear-session'
        ? sceneStore.clearSession()
        : action === 'undo'
          ? sceneStore.undo()
          : sceneStore.redo();
    if (result.applied) {
      if (action === 'undo' || action === 'redo') {
        renderActiveScene();
        fabricCanvas.discardActiveObject();
        sceneStore.selectObjects([]);
        setToolMode(currentSession?.tool || 'brush');
        updateObjectMetric();
        return result;
      }
      const deletedIds = new Set(result.deletedIds);
      for (const object of fabricCanvas.getObjects()) {
        if (action === 'clear-session' || deletedIds.has(object.__baeframeObjectId)) fabricCanvas.remove(object);
      }
      fabricCanvas.discardActiveObject();
      refreshSelectionInteractionPolicy();
      fabricCanvas.requestRenderAll();
      updateObjectMetric();
    }
    return result;
  }

  function getDrawingV3Diagnostics() {
    if (drawingV3Adapter) {
      try {
        return sanitizeDrawingV3Diagnostics(drawingV3Adapter.getDiagnostics());
      } catch (_error) {
        return emptyDrawingV3Diagnostics('degraded', 'adapter-failed', 1);
      }
    }
    if (drawingV3ShadowStartupFailed) {
      return emptyDrawingV3Diagnostics('degraded', 'adapter-failed', 1);
    }
    return emptyDrawingV3Diagnostics(
      drawingV3ShadowRequested && customSceneStore ? 'not-connected' : 'disabled'
    );
  }

  function getDiagnostics() {
    const scene = sceneStore.getDiagnostics();
    return {
      state: destroyed ? 'destroyed' : inputEnabled ? 'active' : 'passive',
      prepared,
      inputEnabled,
      devicePixelRatio,
      tokens: { ...tokenState },
      activeSessionId: scene.activeSessionId,
      activeSceneKey: scene.activeSceneKey,
      targetFrame: currentSession?.targetFrame ?? null,
      viewportRevision: currentSession?.viewportRevision ?? null,
      tool: scene.tool,
      selectionMode,
      objectCount: scene.objectCount,
      selectionCount: scene.selectionCount,
      mutationCount: scene.mutationCount,
      dirty: scene.dirty,
      undoDepth: scene.undoDepth,
      redoDepth: scene.redoDepth,
      undoBytes: scene.undoBytes,
      historyBytes: scene.historyBytes,
      cache: {
        videoCount: scene.videoCount,
        sceneCount: scene.sceneCount,
        estimatedBytes: scene.estimatedBytes,
        evictionCount: scene.evictionCount
      },
      drawingV3Shadow: getDrawingV3Diagnostics(),
      metrics: metrics.snapshot(),
      lastError
    };
  }

  function destroy() {
    if (destroyed) return { destroyed: true, reused: true };
    disableInput();
    releaseSurfaceResources();
    sceneStore.destroy();
    try {
      drawingV3Adapter?.destroy();
    } catch (_error) { /* shadow teardown must not affect Fabric */ }
    actionDeduper.clear();
    destroyed = true;
    return { destroyed: true, reused: false };
  }

  return {
    prepare,
    setDrawingInput,
    updateDrawingTool,
    updateViewport,
    applyDrawingAction,
    getDiagnostics,
    destroy
  };
}

function consumeDrawingV3Bootstrap(target) {
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(target, '__mpvFabricOverlayBootstrap');
  } catch (_error) {
    return false;
  }
  if (!descriptor) return false;

  let requestedEnabled = false;
  try {
    const bootstrap = descriptor.value;
    const bootstrapKeys = Reflect.ownKeys(bootstrap);
    const enabledDescriptor = Object.getOwnPropertyDescriptor(
      bootstrap,
      'drawingV3ShadowEnabled'
    );
    const trusted = descriptor.configurable === true &&
      descriptor.enumerable === false &&
      descriptor.writable === false &&
      bootstrap &&
      typeof bootstrap === 'object' &&
      !Array.isArray(bootstrap) &&
      Object.isFrozen(bootstrap) &&
      bootstrapKeys.length === 1 &&
      bootstrapKeys[0] === 'drawingV3ShadowEnabled' &&
      enabledDescriptor?.configurable === false &&
      enabledDescriptor.enumerable === true &&
      enabledDescriptor.writable === false &&
      typeof enabledDescriptor.value === 'boolean';
    requestedEnabled = trusted && enabledDescriptor.value === true;
  } catch (_error) {
    requestedEnabled = false;
  }

  try {
    if (Reflect.deleteProperty(target, '__mpvFabricOverlayBootstrap') !== true) return false;
    if (Object.getOwnPropertyDescriptor(target, '__mpvFabricOverlayBootstrap') !== undefined) {
      return false;
    }
  } catch (_error) {
    return false;
  }
  return requestedEnabled;
}

if (typeof window !== 'undefined' && window) {
  const drawingV3ShadowEnabled = consumeDrawingV3Bootstrap(window);
  if (!window.__mpvFabricOverlay) {
    window.__mpvFabricOverlay = createFabricOverlayRuntime({
      window,
      document: typeof document !== 'undefined' ? document : null,
      drawingV3ShadowEnabled
    });
  }
}

module.exports = {
  createFabricOverlayRuntime,
  createSessionSceneStore,
  normalizePressure,
  createStrokePathData,
  createActionDeduper,
  shouldAcceptInputRequest,
  resolveEffectiveCanvasRect,
  resolveSelectionHitTolerance,
  mapClientPointToSource,
  splitStrokePointsByPolygon
};
