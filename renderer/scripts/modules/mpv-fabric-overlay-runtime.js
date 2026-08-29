'use strict';

const {
  createFabricDrawingPilotMetrics
} = require('./fabric-drawing-pilot-metrics.js');
const {
  strokeHasSplittableLength,
  splitStrokePointsByPolygon,
  splitStrokePointsBySourceIntervals
} = require('./drawing-v3/stroke-splitter.js');
const {
  polygonHasArea,
  boundsForPoints,
  boundsIntersect,
  createGeometryBudget,
  createPolygonEdgeIndex,
  simplifyClosedPolygon,
  simplifyOpenPolyline
} = require('./drawing-v3/lasso-geometry.js');
const {
  clipSimplePathFillPair,
  contourPathData,
  centerlineIntervalsInsideComponent,
  flattenFabricPath,
  createPathFillQuery,
  pathFillOverlapsPolygon,
  createSmoothedCenterlineGeometry,
  projectRetainedBoundaryToSourceIntervals,
  sourceIntervalsToIndexIntervals,
  validateSimpleContour
} = require('./drawing-v3/stroke-fill-geometry.js');
const {
  createDrawingCommandHistory
} = require('./drawing-v3/drawing-command-history.js');
const {
  createDrawingEngineAdapter
} = require('./drawing-v3/drawing-engine-adapter.js');
const {
  createFabricDrawingPalette
} = require('./mpv-fabric-toolbar.js');
const {
  validateDrawingRenderGeometry
} = require('../../../shared/drawing-render-geometry.js');
const {
  FABRIC_DRAWING_MAX_KEYFRAMES: MAX_PERSISTED_KEYFRAMES,
  FABRIC_DRAWING_MAX_OBJECTS_TOTAL: MAX_PERSISTED_OBJECTS_TOTAL,
  FABRIC_DRAWING_MAX_SOURCE_DIMENSION: MAX_PERSISTED_SOURCE_DIMENSION,
  FABRIC_DRAWING_MAX_TOTAL_FRAMES: MAX_PERSISTED_TOTAL_FRAMES,
  FABRIC_DRAWING_MAX_POINT_COORDINATE: MAX_PERSISTED_POINT_COORDINATE,
  FABRIC_DRAWING_MAX_POINT_TIME: MAX_PERSISTED_POINT_TIME,
  FABRIC_DRAWING_MAX_BRUSH_SIZE: MAX_PERSISTED_BRUSH_SIZE,
  FABRIC_DRAWING_MAX_TRANSFORM_MAGNITUDE: MAX_PERSISTED_TRANSFORM_MAGNITUDE,
  FABRIC_DRAWING_MAX_STRING_LENGTH: MAX_PERSISTENCE_STRING_LENGTH
} = require('../../../shared/fabric-drawing-limits.js');
const {
  FABRIC_SHAPE_TOOLS,
  isFabricDrawingTool,
  normalizeFabricDrawingTool
} = require('../../../shared/fabric-drawing-tools.js');

const SCENE_KEY_SEPARATOR = '\u0000';
const DEFAULT_MAX_VIDEOS = 10;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ACTIONS = 2048;
const MAX_STROKE_POINTS = 20000;
const MAX_LASSO_POINTS = 1024;
const MAX_PENDING_POINTER_EVENTS = 1024;
const POINTERDOWN_FRAME_CONFIRMATION_DEADLINE_MS = 3000;
const DEFAULT_MAX_SELECTION_GEOMETRY_OPERATIONS = 250_000;
const MAX_STROKE_GEOMETRY_CACHE_ENTRIES = 512;
const MAX_STROKE_GEOMETRY_CACHE_WEIGHT = 250_000;
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
// 레거시 팔레트(renderer/index.html)의 도구 아이콘을 그대로 쓴다. 한글 라벨은
// 190px 팔레트의 5열 그리드에서 잘리므로 아이콘만 두고 이름은 title/aria-label 로 준다.
const TOOL_ICON_SVG = Object.freeze({
  brush: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  eraser: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
  line: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="5" y1="19" x2="19" y2="5"/></svg>',
  rect: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>',
  circle: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  select: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 3l7 18 2.5-7.5L20 11z"/></svg>'
});
// 도형 버튼 우하단의 플라이아웃 예고 삼각형.
const SHAPE_MENU_CARET_SVG = '<svg viewBox="0 0 4 4" width="4" height="4" fill="currentColor" aria-hidden="true"><path d="M4 4H0l4-4z"/></svg>';
// 상시 요약 줄에 띄우는 도구 이름.
const TOOL_STATUS_LABELS = Object.freeze({
  brush: '브러시',
  pen: '펜',
  eraser: '지우개',
  line: '직선',
  rect: '사각형',
  circle: '원',
  arrow: '화살표',
  select: '선택'
});
const SHAPE_TOOL_LABELS = Object.freeze({
  line: '직선',
  rect: '사각형',
  circle: '원',
  arrow: '화살표'
});
const RECENT_COLOR_LIMIT = 4;
const MIN_BRUSH_SIZE = 1;
const MAX_BRUSH_SIZE = 50;
const MIN_OUTLINE_WIDTH = 1;
const MAX_OUTLINE_WIDTH = 20;
const DEFAULT_OUTLINE_WIDTH = 2;
const DEFAULT_OUTLINE_COLOR = '#000000';
// [ / ] 로 띄운 크기 HUD 가 스스로 사라지기까지. 레거시 감각과 같다.
const SIZE_ADJUST_HUD_FLASH_MS = 700;
const MIN_BRUSH_OPACITY_PERCENT = 10;
const MAX_BRUSH_OPACITY_PERCENT = 100;
// 레거시 Canvas2D 엔진(drawing-canvas.js `_updateSizeAdjust`)의 delta/4 감도를 그대로 계승한다.
const SIZE_ADJUST_PIXELS_PER_STEP = 4;
const FABRIC_PERSISTENCE_BADGE_PREFIX = '새 드로잉 · 리뷰 자동 저장';
const SELECTION_HIT_MARGIN_CSS_PX = 6;
const MIN_SELECTION_HIT_TOLERANCE = 2;
const MAX_SELECTION_HIT_TOLERANCE = 96;
const SOURCE_INTERVAL_EPSILON = 1e-7;
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
const PERSISTENCE_HYDRATE_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'persistenceSessionId',
  'stableVideoIdentity',
  'fps',
  'totalFrames',
  'keyframes'
]);
const PERSISTENCE_EXPORT_KEYS = Object.freeze(
  PERSISTENCE_HYDRATE_KEYS.filter(key => key !== 'keyframes')
);
const PRESENTATION_REQUEST_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'presentationRevision',
  'stableVideoIdentity',
  'storeRevision',
  'targetFrame',
  'sourceFrame',
  'sourceWidth',
  'sourceHeight',
  'canvasRect',
  'viewportRevision',
  'viewportTransform'
]);
const PRESENTATION_CANVAS_RECT_KEYS = Object.freeze(['left', 'top', 'width', 'height']);
const PRESENTATION_VIEWPORT_TRANSFORM_KEYS = Object.freeze(['scale', 'panX', 'panY']);
const ACTIVE_FRAME_REQUEST_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'inputRevision',
  'sessionId',
  'frameRevision',
  'targetFrame'
]);
const POINTERDOWN_FRAME_BASE_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'inputRevision',
  'sessionId',
  'pointerdownId',
  'pointerdownAt'
]);
const POINTERDOWN_FRAME_CONFIRMATION_KEYS = Object.freeze([
  ...POINTERDOWN_FRAME_BASE_KEYS,
  'targetFrame'
]);
const POINTERDOWN_FRAME_CANCELLATION_KEYS = Object.freeze([
  ...POINTERDOWN_FRAME_BASE_KEYS,
  'cancelled'
]);
const REPLAYED_POINTERDOWN = Symbol('baeframe-replayed-pointerdown');
const POINTER_EVENT_SNAPSHOT_FIELDS = Object.freeze([
  'pointerId',
  'pointerType',
  'button',
  'buttons',
  'clientX',
  'clientY',
  'pressure',
  'width',
  'height',
  'tiltX',
  'tiltY',
  'twist',
  'isPrimary',
  'ctrlKey',
  'shiftKey',
  'altKey',
  'metaKey',
  // timeStamp를 보존하지 않으면 재생된 이벤트가 '재생 시각'을 갖게 되고, 확정 직전에
  // 생성돼 확정 뒤에 배달된 라이브 pointermove가 그보다 이른 시각을 실어 와 획의
  // sourcePoints 시각이 역행한다. 그러면 세 검증기가 모두 요구하는 시간 단조 불변식이
  // 깨져 호스트가 export 전체를 거절하고 저장이 영구 차단된다(2026-08-27 실측:
  // failedCheck "snapshot-record:point-time:3@5.12").
  'timeStamp'
]);
const PERSISTENCE_KEYFRAME_KEYS = Object.freeze([
  'id',
  'frame',
  'sourceWidth',
  'sourceHeight',
  'mutationSequence',
  'objects'
]);
const PERSISTENCE_RECORD_REQUIRED_KEYS = Object.freeze([
  'id',
  'type',
  'pathData',
  'sourcePoints',
  'style',
  'transform'
]);
const PERSISTENCE_RECORD_OPTIONAL_KEYS = Object.freeze(['strokeCaps', 'renderGeometry']);
const PERSISTENCE_STYLE_KEYS = Object.freeze(['color', 'size', 'opacity']);
const PERSISTENCE_POINT_REQUIRED_KEYS = Object.freeze(['x', 'y', 'pressure', 'time']);
const PERSISTENCE_POINT_OPTIONAL_KEYS = Object.freeze(['pointerType']);
const PERSISTENCE_CAPS_KEYS = Object.freeze(['start', 'end']);
const PERSISTENCE_RENDER_GEOMETRY_KEYS = Object.freeze([
  'version',
  'pathData',
  'fillRule'
]);
const PERSISTENCE_POINTER_TYPES = new Set(['mouse', 'pen', 'touch']);
const PERSISTENCE_HEX_COLOR = /^#[0-9a-f]{6}$/i;
const persistenceUtf8Encoder = new TextEncoder();

function formatFabricPersistenceBadge(targetFrame = null) {
  const frameLabel = Number.isSafeInteger(targetFrame) && targetFrame >= 0
    ? targetFrame
    : '-';
  return `${FABRIC_PERSISTENCE_BADGE_PREFIX} · 프레임 ${frameLabel}`;
}

function formatCompactFabricPersistenceBadge(targetFrame = null) {
  const frameLabel = Number.isSafeInteger(targetFrame) && targetFrame >= 0
    ? targetFrame
    : '-';
  return `자동 저장 · F${frameLabel}`;
}

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
  const bytes = jsonUtf8Bytes(object);
  return Number.isFinite(bytes) ? Math.max(1, bytes) : Number.POSITIVE_INFINITY;
}

function jsonUtf8Bytes(value) {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return Number.POSITIVE_INFINITY;
    return persistenceUtf8Encoder.encode(serialized).byteLength;
  } catch (_error) {
    return Number.POSITIVE_INFINITY;
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
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) return false;
  const allowed = new Set([...required, ...optional]);
  if (ownKeys.some(key => !allowed.has(key))) return false;
  return required.every(key => Object.hasOwn(value, key));
}

function isBoundedPersistenceString(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PERSISTENCE_STRING_LENGTH;
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validatePersistenceEnvelope(request, includeKeyframes) {
  const keys = includeKeyframes ? PERSISTENCE_HYDRATE_KEYS : PERSISTENCE_EXPORT_KEYS;
  if (!hasExactKeys(request, keys) ||
      !isSafeCount(request.hostGeneration) ||
      !isSafeCount(request.videoGeneration) ||
      !isBoundedPersistenceString(request.persistenceSessionId) ||
      !isBoundedPersistenceString(request.stableVideoIdentity) ||
      !Number.isFinite(request.fps) || request.fps <= 0 || request.fps > 1000 ||
      !Number.isSafeInteger(request.totalFrames) || request.totalFrames <= 0 ||
      request.totalFrames > MAX_PERSISTED_TOTAL_FRAMES) {
    return false;
  }
  return !includeKeyframes ||
    (isDenseArray(request.keyframes) && request.keyframes.length <= MAX_PERSISTED_KEYFRAMES);
}

function validatePersistedTransform(transform) {
  if (!hasExactKeys(transform, TRANSFORM_FIELDS)) return false;
  for (const field of TRANSFORM_FIELDS) {
    if (field === 'flipX' || field === 'flipY') {
      if (typeof transform[field] !== 'boolean') return false;
    } else if (!Number.isFinite(transform[field]) ||
        Math.abs(transform[field]) > MAX_PERSISTED_TRANSFORM_MAGNITUDE) {
      return false;
    }
  }
  return transform.scaleX !== 0 && transform.scaleY !== 0;
}

function validatePersistedPoint(point) {
  if (!hasExactKeys(
    point,
    PERSISTENCE_POINT_REQUIRED_KEYS,
    PERSISTENCE_POINT_OPTIONAL_KEYS
  )) {
    return false;
  }
  if (!Number.isFinite(point.x) ||
      Math.abs(point.x) > MAX_PERSISTED_POINT_COORDINATE ||
      !Number.isFinite(point.y) ||
      Math.abs(point.y) > MAX_PERSISTED_POINT_COORDINATE ||
      !Number.isFinite(point.pressure) ||
      point.pressure < 0 || point.pressure > 1 ||
      !Number.isFinite(point.time) ||
      point.time < 0 || point.time > MAX_PERSISTED_POINT_TIME) {
    return false;
  }
  return point.pointerType === undefined ||
    (typeof point.pointerType === 'string' &&
     PERSISTENCE_POINTER_TYPES.has(point.pointerType));
}

function validatePersistedRecord(record, maxDocumentBytes) {
  if (!hasExactKeys(
    record,
    PERSISTENCE_RECORD_REQUIRED_KEYS,
    PERSISTENCE_RECORD_OPTIONAL_KEYS
  ) ||
      typeof record.id !== 'string' || record.id.length === 0 ||
      record.id.length > 512 ||
      record.type !== 'stroke' ||
      typeof record.pathData !== 'string' || record.pathData.length === 0 ||
      record.pathData.length > maxDocumentBytes ||
      !isDenseArray(record.sourcePoints) ||
      record.sourcePoints.length === 0 ||
      record.sourcePoints.length > MAX_STROKE_POINTS ||
      !hasExactKeys(record.style, PERSISTENCE_STYLE_KEYS) ||
      !PERSISTENCE_HEX_COLOR.test(record.style.color) ||
      !Number.isFinite(record.style.size) ||
      record.style.size <= 0 ||
      record.style.size > MAX_PERSISTED_BRUSH_SIZE ||
      !Number.isFinite(record.style.opacity) ||
      record.style.opacity < 0 || record.style.opacity > 1 ||
      !validatePersistedTransform(record.transform)) {
    return false;
  }

  let previousTime = 0;
  for (const point of record.sourcePoints) {
    if (!validatePersistedPoint(point) || point.time < previousTime) return false;
    previousTime = point.time;
  }
  if (record.strokeCaps !== undefined &&
      (!hasExactKeys(record.strokeCaps, PERSISTENCE_CAPS_KEYS) ||
       typeof record.strokeCaps.start !== 'boolean' ||
       typeof record.strokeCaps.end !== 'boolean')) {
    return false;
  }
  if (record.renderGeometry !== undefined &&
      (!hasExactKeys(record.renderGeometry, PERSISTENCE_RENDER_GEOMETRY_KEYS) ||
       !validateDrawingRenderGeometry(record.renderGeometry, {
         maxPathLength: Math.min(MAX_PERSISTENCE_STRING_LENGTH, maxDocumentBytes),
         maxCoordinate: MAX_PERSISTED_POINT_COORDINATE + MAX_PERSISTED_BRUSH_SIZE
       }))) {
    return false;
  }
  return true;
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
  const committedTransitionObserver = typeof options.committedTransitionObserver === 'function'
    ? options.committedTransitionObserver
    : null;
  const createSceneInstanceId = typeof options.createSceneInstanceId === 'function'
    ? options.createSceneInstanceId
    : null;
  const scenes = new Map();
  const persistenceByVideo = new Map();
  const issuedSceneInstanceIds = new Set();
  const videoAccess = new Map();
  let accessClock = 0;
  let latestVideoGeneration = -1;
  let latestPersistenceHostGeneration = -1;
  let latestPersistenceVideoIdentity = null;
  let activeSession = null;
  let evictionCount = 0;
  let commandSequence = 0;
  let sceneInstanceSequence = 0;
  let observerFailureCount = 0;
  let observerQuarantineFailureCount = 0;
  let observerLifecycleFailureCount = 0;
  let persistenceObserverFailureCount = 0;
  let persistenceUnboundCommitCount = 0;
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

  function notifySceneActivation(scene, incomingSession) {
    const alreadySeeded = scene.drawingObserverSeeded === true;
    scene.drawingObserverSeeded = true;
    try {
      const activate = drawingEngineObserver?.activateScene;
      if (typeof activate !== 'function') return;
      activate.call(drawingEngineObserver, {
        ...sceneDescriptor(scene, incomingSession),
        mutationSequence: scene.mutationSequence +
          (scene.provisional === true && scene.objects.size > 0 ? 1 : 0)
      }, activationObjectView(scene, alreadySeeded));
    } catch (_error) {
      recordObserverFailure(scene.sceneInstanceId);
    }
  }

  function notifyDrawingEngineTransition(scene, eventFactory) {
    try {
      const enqueue = drawingEngineObserver?.enqueueTransition;
      if (typeof enqueue !== 'function') return;
      enqueue.call(drawingEngineObserver, eventFactory());
    } catch (_error) {
      recordObserverFailure(scene.sceneInstanceId);
    }
  }

  function recordPersistenceObserverFailure() {
    persistenceObserverFailureCount += 1;
  }

  function notifyPersistenceTransition(scene, eventFactory) {
    if (!committedTransitionObserver) return;
    const persistence = persistenceByVideo.get(scene.stableVideoIdentity);
    if (!persistence) {
      persistenceUnboundCommitCount += 1;
      return;
    }
    try {
      const result = committedTransitionObserver({
        hostGeneration: persistence.hostGeneration,
        videoGeneration: persistence.videoGeneration,
        persistenceSessionId: persistence.persistenceSessionId,
        stableVideoIdentity: scene.stableVideoIdentity,
        ...eventFactory()
      });
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).catch(recordPersistenceObserverFailure);
      }
    } catch (_error) {
      recordPersistenceObserverFailure();
    }
  }

  function notifyCommittedTransition(scene, eventFactory) {
    notifyDrawingEngineTransition(scene, () => clonePlain(eventFactory()));
    notifyPersistenceTransition(scene, () => clonePlain(eventFactory()));
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

  // ── 전역 실행취소 순서 인덱스 ────────────────────────────────────────────────
  // 씬별 히스토리·씬별 예산 회계·undoDepth 진단의 의미는 그대로 두고, "어느 씬의
  // 어떤 커맨드가 시각 순서 몇 번째였는가"만 따로 쌓는다. Ctrl+Z는 재생헤드 위치와
  // 무관하게 이 스택의 마지막 항목을 되돌린다(애니메이트 동치).
  //
  // 영상별로 나누는 이유: 실행취소는 문서 단위여야 하고, 씬 축출(evictVideo)이
  // 영상 단위라 인덱스 회수 경계가 자연히 일치해 유령 항목이 생기지 않는다.
  //
  // 정합성: 한 씬 안에서 커맨드는 scene.history의 undoStack과 order.undo에 같은
  // 순서로 쌓이므로, order.undo의 마지막 항목은 언제나 그 씬 히스토리의 최상단이다.
  const globalHistoryOrder = new Map();
  // 적용에 실패한 항목을 건너뛰며 시도할 최대 횟수. 한 번의 Ctrl+Z가 스택 전체를
  // 훑으며 시간을 쓰지 않도록 상한을 둔다.
  const MAX_GLOBAL_HISTORY_ATTEMPTS = 8;

  function globalOrderFor(stableVideoIdentity, create = false) {
    if (typeof stableVideoIdentity !== 'string' || stableVideoIdentity.length === 0) return null;
    let order = globalHistoryOrder.get(stableVideoIdentity);
    if (!order && create) {
      order = { undo: [], redo: [] };
      globalHistoryOrder.set(stableVideoIdentity, order);
    }
    return order || null;
  }

  // 씬 히스토리가 버린 항목(용량 축출 + redo 폐기)을 전역 인덱스에서도 지운다.
  function reconcileGlobalOrder(scene, recorded) {
    const order = globalOrderFor(scene?.stableVideoIdentity);
    if (!order) return;
    const dropped = new Set();
    for (const id of recorded?.evictedUndoIds || []) dropped.add(id);
    for (const id of recorded?.clearedRedoIds || []) dropped.add(id);
    if (dropped.size === 0) return;
    order.undo = order.undo.filter(entry => !dropped.has(entry.commandId));
    order.redo = order.redo.filter(entry => !dropped.has(entry.commandId));
  }

  // 새 편집이 들어오면 전역 redo는 전부 무효다(애니메이트 동일). 커맨드를 기록한
  // 씬의 redo는 history.record()가 이미 비웠으므로 나머지 씬만 비운다. 이걸 빼면
  // 전역 인덱스에서 사라진 항목이 씬 히스토리에 남아 redoDepth 진단이 어긋난다.
  function appendGlobalOrder(scene, commandId) {
    const order = globalOrderFor(scene?.stableVideoIdentity, true);
    if (!order || !scene) return;
    const clearedSceneKeys = new Set([scene.key]);
    for (const entry of order.redo) {
      if (clearedSceneKeys.has(entry.sceneKey)) continue;
      clearedSceneKeys.add(entry.sceneKey);
      const other = scenes.get(entry.sceneKey);
      if (!other) continue;
      other.history.clearRedo();
      // 바이트 거울도 함께 비운다. 남겨 두면 estimateSceneBytes가 이미 사라진
      // redo 상태를 계속 예약해 용량을 과대 계상한다.
      other.historyEntries = { undo: other.historyEntries.undo, redo: [] };
    }
    order.redo = [];
    order.undo.push({ sceneKey: scene.key, commandId });
  }

  // 전역 스택을 위에서부터 훑으며 적용 가능한 후보를 순서대로 내놓는다.
  //
  // 최상단 하나만 보면 안 되는 이유: applyHistoryState는 실패할 수 있고
  // (scene-capacity-exceeded / mutation-sequence-overflow / invalid-history-state),
  // 실패 시 씬 히스토리의 moveTop은 스택을 pop하지 않는다. 최상단에서 멈추면 그
  // 항목이 영구히 남아 이후 모든 Ctrl+Z가 같은 실패를 반복한다. 씬별 히스토리에는
  // 없던 고착이다 — 예전에는 다른 키프레임으로 옮기면 그 씬의 undo가 동작했다.
  //
  // 실패한 항목은 **버리지 않고 건너뛴다**. 일시적 실패(용량 압박)라면 다음에 다시
  // 시도할 수 있어야 하기 때문이다. 건너뛰어도 불변식은 유지된다 — 각 항목은 여전히
  // 자기 씬 히스토리의 최상단이고, 중간에서 하나가 빠져도 상대 순서는 그대로다.
  function* globalHistoryCandidates(direction) {
    const order = globalOrderFor(activeSession?.stableVideoIdentity);
    if (!order) return;
    const list = direction === 'undo' ? order.undo : order.redo;
    let index = list.length - 1;
    let attempts = 0;
    while (index >= 0 && attempts < MAX_GLOBAL_HISTORY_ATTEMPTS) {
      const scene = scenes.get(list[index].sceneKey);
      if (!scene) {
        // 정리 누락으로 남은 유령 항목만 실제로 걷어낸다.
        list.splice(index, 1);
        index -= 1;
        continue;
      }
      attempts += 1;
      yield { scene, order };
      index -= 1;
    }
  }

  function moveGlobalOrderEntry(order, direction, commandId) {
    const from = direction === 'undo' ? order.undo : order.redo;
    const to = direction === 'undo' ? order.redo : order.undo;
    const index = from.findLastIndex(entry => entry.commandId === commandId);
    if (index < 0) return;
    const [entry] = from.splice(index, 1);
    to.push(entry);
  }

  function globalHistoryDepths() {
    const order = globalOrderFor(activeSession?.stableVideoIdentity);
    return {
      globalUndoDepth: order ? order.undo.length : 0,
      globalRedoDepth: order ? order.redo.length : 0
    };
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
    persistenceByVideo.delete(stableVideoIdentity);
    // 씬이 사라지면 그 영상의 전역 실행취소 순서도 함께 사라진다.
    globalHistoryOrder.delete(stableVideoIdentity);
    if (latestPersistenceVideoIdentity === stableVideoIdentity) {
      latestPersistenceVideoIdentity = [...videoAccess.keys()].at(-1) || null;
    }
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

  function materializeProvisionalScene(scene) {
    if (scene?.provisional !== true) return;
    scene.provisional = false;
    scene.provisionalSourceFrame = null;
    if (scene.objects.size === 0) return;

    const objectIds = [...scene.objects.keys()];
    const emptyObjects = new Map();
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
    notifyPersistenceTransition(scene, () => makeTransitionEvent(scene, {
      origin: 'live',
      kind: 'add-objects',
      estimatedBytes: scene.estimatedBytes,
      beforeState: makeObjectsState(emptyObjects, objectIds, []),
      afterState: makeObjectsState(scene.objects, objectIds, objectIds),
      baseTransforms: new Map(
        [...scene.objects].map(([id, object]) => [id, clonePlain(object.transform || {})])
      )
    }));
  }

  function commitStagedMutation(scene, change) {
    const requiredMutationSequence = scene.provisional === true && scene.objects.size > 0 ? 2 : 1;
    if (!isSafeCount(scene.mutationSequence) ||
        scene.mutationSequence > Number.MAX_SAFE_INTEGER - requiredMutationSequence) {
      return { applied: false, reason: 'mutation-sequence-overflow' };
    }
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
    // 임시 씬을 정식 키프레임으로 승격시키는 커맨드인지 남겨 둔다.
    //
    // 키프레임은 직전 키프레임 내용을 복사해서 만들어진다(홀드 모델). 그 복사는
    // 히스토리에 기록되지 않으므로, 이 커맨드를 되돌리면서 키프레임을 그대로 두면
    // "원본 편집은 되돌렸는데 복사본은 남는" 모순이 생긴다 — 프레임 10의 획을
    // 되돌려도 프레임 20이 들고 있는 복사본은 그대로라 화면이 바뀌지 않는다.
    //
    // 애니메이트처럼 키프레임 생성 자체를 되돌림 대상에 포함시킨다. 씬을 삭제하지
    // 않고 provisional 로 되돌리는 이유는 redo 가 그 씬을 다시 찾아야 하기 때문이며,
    // provisional 씬은 exportVideo 와 resolveCommittedSceneAtFrame 이 모두 건너뛰므로
    // 파일과 이후 프레임 해석에서는 키프레임이 사라진 것과 같다.
    if (scene.provisional === true) {
      command.materializesScene = true;
      command.provisionalSourceFrame = scene.provisionalSourceFrame ?? null;
    }
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
    // 씬 히스토리가 버린 항목을 전역 인덱스에서도 지운다. 기록 실패 경로에서도
    // redo는 이미 폐기됐으므로 성공 여부와 무관하게 먼저 맞춘다.
    reconcileGlobalOrder(scene, recorded);
    if (!recorded.recorded) {
      return { applied: false, reason: recorded.reason || 'history-record-failed' };
    }
    // evictVideo가 globalHistoryOrder를 지우므로 방금 넣은 항목보다 먼저 둔다.
    appendGlobalOrder(scene, command.id);
    for (const stableVideoIdentity of plannedEvictions) evictVideo(stableVideoIdentity);

    materializeProvisionalScene(scene);
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

  function persistenceFenceMatches(binding, request) {
    return binding.hostGeneration === request.hostGeneration &&
      binding.videoGeneration === request.videoGeneration &&
      binding.persistenceSessionId === request.persistenceSessionId &&
      binding.stableVideoIdentity === request.stableVideoIdentity;
  }

  function validateHydrationFrames(request) {
    const preparedFrames = [];
    const keyframeIds = new Set();
    const frameNumbers = new Set();
    let previousFrame = -1;
    let objectCount = 0;
    let estimatedBytes = 0;

    try {
      for (const keyframe of request.keyframes) {
        if (!hasExactKeys(keyframe, PERSISTENCE_KEYFRAME_KEYS) ||
            typeof keyframe.id !== 'string' || keyframe.id.length === 0 ||
            keyframe.id.length > 512 ||
            !Number.isSafeInteger(keyframe.frame) || keyframe.frame < 0 ||
            keyframe.frame >= request.totalFrames ||
            keyframe.frame <= previousFrame ||
            !Number.isFinite(keyframe.sourceWidth) || keyframe.sourceWidth <= 0 ||
            keyframe.sourceWidth > MAX_PERSISTED_SOURCE_DIMENSION ||
            !Number.isFinite(keyframe.sourceHeight) || keyframe.sourceHeight <= 0 ||
            keyframe.sourceHeight > MAX_PERSISTED_SOURCE_DIMENSION ||
            !isSafeCount(keyframe.mutationSequence) ||
            !isDenseArray(keyframe.objects) ||
            keyframe.objects.length > maxObjects ||
            keyframeIds.has(keyframe.id) ||
            frameNumbers.has(keyframe.frame)) {
          return { accepted: false, reason: 'invalid-hydration-request' };
        }
        const objects = new Map();
        for (const object of keyframe.objects) {
          if (!validatePersistedRecord(object, maxBytes) || objects.has(object.id)) {
            return { accepted: false, reason: 'invalid-hydration-request' };
          }
          const cloned = clonePlain(object);
          objects.set(cloned.id, cloned);
        }
        const frameBytes = estimateObjectsBytes(objects);
        if (!Number.isFinite(frameBytes) || frameBytes > maxBytes) {
          return { accepted: false, reason: 'scene-capacity-exceeded' };
        }
        objectCount += objects.size;
        estimatedBytes += frameBytes;
        if (objectCount > MAX_PERSISTED_OBJECTS_TOTAL ||
            estimatedBytes > maxBytes) {
          return { accepted: false, reason: 'scene-capacity-exceeded' };
        }
        preparedFrames.push({
          targetFrame: keyframe.frame,
          sourceWidth: keyframe.sourceWidth,
          sourceHeight: keyframe.sourceHeight,
          mutationSequence: keyframe.mutationSequence,
          objects,
          estimatedBytes: frameBytes
        });
        keyframeIds.add(keyframe.id);
        frameNumbers.add(keyframe.frame);
        previousFrame = keyframe.frame;
      }
    } catch (_error) {
      return { accepted: false, reason: 'invalid-hydration-request' };
    }
    return { accepted: true, preparedFrames, objectCount, estimatedBytes };
  }

  function planHydrationEvictions(stableVideoIdentity, nextVideoBytes) {
    let projectedBytes = calculateEstimatedBytes() -
      estimateVideoBytes(stableVideoIdentity) +
      nextVideoBytes;
    let projectedVideoCount = videoAccess.size +
      (videoAccess.has(stableVideoIdentity) ? 0 : 1);
    const planned = [];
    for (const candidate of videoAccess.keys()) {
      if (projectedBytes <= maxBytes && projectedVideoCount <= maxVideos) break;
      if (candidate === stableVideoIdentity ||
          candidate === activeSession?.stableVideoIdentity) {
        continue;
      }
      projectedBytes -= estimateVideoBytes(candidate);
      projectedVideoCount -= 1;
      planned.push(candidate);
    }
    return projectedBytes <= maxBytes && projectedVideoCount <= maxVideos
      ? planned
      : null;
  }

  function hydrateVideo(request = {}) {
    if (destroyed) return { accepted: false, reason: 'store-destroyed' };
    if (!validatePersistenceEnvelope(request, true)) {
      return { accepted: false, reason: 'invalid-hydration-request' };
    }
    if (activeSession?.stableVideoIdentity === request.stableVideoIdentity) {
      return { accepted: false, reason: 'video-active' };
    }
    if (request.hostGeneration < latestPersistenceHostGeneration ||
        (request.hostGeneration === latestPersistenceHostGeneration &&
         request.videoGeneration < latestVideoGeneration)) {
      return { accepted: false, reason: 'stale-fence' };
    }

    const validation = validateHydrationFrames(request);
    if (!validation.accepted) return validation;
    const plannedEvictions = planHydrationEvictions(
      request.stableVideoIdentity,
      validation.estimatedBytes
    );
    if (!plannedEvictions) {
      return { accepted: false, reason: 'scene-capacity-exceeded' };
    }

    const hydratedScenes = [];
    for (const frame of validation.preparedFrames) {
      hydratedScenes.push({
        key: makeSceneKey(request.stableVideoIdentity, frame.targetFrame),
        sceneInstanceId: allocateSceneInstanceId(),
        stableVideoIdentity: request.stableVideoIdentity,
        targetFrame: frame.targetFrame,
        sourceWidth: frame.sourceWidth,
        sourceHeight: frame.sourceHeight,
        objects: frame.objects,
        selectedObjectIds: new Set(),
        history: createDrawingCommandHistory({
          maxEntries: maxHistory,
          maxBytes: maxHistoryBytes,
          estimateEntryBytes: defaultEstimateObjectBytes
        }),
        historyEntries: { undo: [], redo: [] },
        dirty: false,
        mutationCount: 0,
        mutationSequence: frame.mutationSequence,
        estimatedBytes: frame.estimatedBytes,
        drawingObserverSeeded: false,
        provisional: false,
        provisionalSourceFrame: null
      });
    }

    const droppedSceneInstanceIds = [];
    for (const [key, scene] of scenes) {
      if (scene.stableVideoIdentity !== request.stableVideoIdentity) continue;
      droppedSceneInstanceIds.push(scene.sceneInstanceId);
      scenes.delete(key);
    }
    // 씬이 통째로 교체되므로 이 영상의 전역 실행취소 순서는 전부 무효다.
    globalHistoryOrder.delete(request.stableVideoIdentity);
    for (const scene of hydratedScenes) scenes.set(scene.key, scene);
    persistenceByVideo.set(request.stableVideoIdentity, {
      hostGeneration: request.hostGeneration,
      videoGeneration: request.videoGeneration,
      persistenceSessionId: request.persistenceSessionId,
      stableVideoIdentity: request.stableVideoIdentity,
      fps: request.fps,
      totalFrames: request.totalFrames
    });
    if (request.hostGeneration > latestPersistenceHostGeneration) {
      latestVideoGeneration = request.videoGeneration;
    } else {
      latestVideoGeneration = Math.max(latestVideoGeneration, request.videoGeneration);
    }
    latestPersistenceHostGeneration = Math.max(
      latestPersistenceHostGeneration,
      request.hostGeneration
    );
    latestPersistenceVideoIdentity = request.stableVideoIdentity;
    touchVideo(request.stableVideoIdentity);
    for (const stableVideoIdentity of plannedEvictions) evictVideo(stableVideoIdentity);
    notifyScenesDropped(droppedSceneInstanceIds);
    return {
      accepted: true,
      sceneCount: hydratedScenes.length,
      objectCount: validation.objectCount
    };
  }

  function exportVideo(request = {}) {
    if (destroyed) return { accepted: false, reason: 'store-destroyed' };
    if (!validatePersistenceEnvelope(request, false)) {
      return { accepted: false, reason: 'invalid-export-request' };
    }
    const binding = persistenceByVideo.get(request.stableVideoIdentity);
    if (!binding ||
        request.hostGeneration !== latestPersistenceHostGeneration ||
        !persistenceFenceMatches(binding, request)) {
      return { accepted: false, reason: 'stale-fence' };
    }
    if (binding.fps !== request.fps || binding.totalFrames !== request.totalFrames) {
      return { accepted: false, reason: 'timeline-mismatch' };
    }

    try {
      const scenesForVideo = [...scenes.values()]
        .filter(scene =>
          scene.stableVideoIdentity === request.stableVideoIdentity &&
          scene.provisional !== true)
        .sort((left, right) => left.targetFrame - right.targetFrame)
        .map(scene => ({
          sceneInstanceId: scene.sceneInstanceId,
          targetFrame: scene.targetFrame,
          sourceWidth: scene.sourceWidth,
          sourceHeight: scene.sourceHeight,
          mutationSequence: scene.mutationSequence,
          objects: [...scene.objects.values()].map(clonePlain)
        }));
      return {
        accepted: true,
        snapshot: {
          hostGeneration: binding.hostGeneration,
          videoGeneration: binding.videoGeneration,
          persistenceSessionId: binding.persistenceSessionId,
          stableVideoIdentity: binding.stableVideoIdentity,
          fps: binding.fps,
          totalFrames: binding.totalFrames,
          scenes: scenesForVideo
        }
      };
    } catch (_error) {
      return { accepted: false, reason: 'snapshot-export-failed' };
    }
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
    const hostGeneration = Number(session.hostGeneration);
    const sourceFrame = session.sourceFrame === null || session.sourceFrame === undefined
      ? null
      : Number(session.sourceFrame);
    if (!Number.isInteger(targetFrame) || targetFrame < 0 || !Number.isInteger(videoGeneration) || videoGeneration < 0) {
      return { accepted: false, reason: 'invalid-session-coordinates' };
    }
    if (sourceFrame !== null &&
        (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0 || sourceFrame > targetFrame)) {
      return { accepted: false, reason: 'invalid-session-source-frame' };
    }
    if (videoGeneration < latestVideoGeneration) {
      return { accepted: false, reason: 'stale-video-generation' };
    }
    const persistence = persistenceByVideo.get(session.stableVideoIdentity);
    if (persistence &&
        (!Number.isSafeInteger(hostGeneration) ||
         persistence.hostGeneration !== hostGeneration ||
         persistence.videoGeneration !== videoGeneration ||
         targetFrame >= persistence.totalFrames)) {
      return { accepted: false, reason: 'stale-persistence-session' };
    }

    latestVideoGeneration = Math.max(latestVideoGeneration, videoGeneration);
    const sceneKey = makeSceneKey(session.stableVideoIdentity, targetFrame);
    const restored = scenes.has(sceneKey);
    const sourceScene = sourceFrame === null
      ? null
      : scenes.get(makeSceneKey(session.stableVideoIdentity, sourceFrame));
    if (!restored && sourceFrame !== null &&
        (!sourceScene || sourceScene.provisional === true)) {
      return { accepted: false, reason: 'missing-source-scene' };
    }
    if (!restored) {
      const objects = new Map(
        [...(sourceScene?.objects || new Map()).entries()]
          .map(([id, object]) => [id, clonePlain(object)])
      );
      const estimatedBytes = estimateObjectsBytes(objects);
      let projectedBytes = calculateEstimatedBytes() + estimatedBytes;
      let projectedVideoCount = videoAccess.size +
        (videoAccess.has(session.stableVideoIdentity) ? 0 : 1);
      const plannedEvictions = [];
      for (const candidate of videoAccess.keys()) {
        if (projectedBytes <= maxBytes && projectedVideoCount <= maxVideos) break;
        if (candidate === session.stableVideoIdentity) continue;
        projectedBytes -= estimateVideoBytes(candidate);
        projectedVideoCount -= 1;
        plannedEvictions.push(candidate);
      }
      if (objects.size > maxObjects || projectedBytes > maxBytes || projectedVideoCount > maxVideos) {
        return { accepted: false, reason: 'scene-capacity-exceeded' };
      }
      scenes.set(sceneKey, {
        key: sceneKey,
        sceneInstanceId: allocateSceneInstanceId(),
        stableVideoIdentity: session.stableVideoIdentity,
        targetFrame,
        sourceWidth: sourceDimension(session.sourceWidth),
        sourceHeight: sourceDimension(session.sourceHeight),
        objects,
        selectedObjectIds: new Set(),
        history: createDrawingCommandHistory({
          maxEntries: maxHistory,
          maxBytes: maxHistoryBytes,
          estimateEntryBytes: defaultEstimateObjectBytes
        }),
        historyEntries: { undo: [], redo: [] },
        dirty: false,
        mutationCount: 0,
        mutationSequence: 0,
        estimatedBytes,
        drawingObserverSeeded: false,
        provisional: true,
        provisionalSourceFrame: sourceScene ? sourceFrame : null
      });
      for (const stableVideoIdentity of plannedEvictions) evictVideo(stableVideoIdentity);
    }

    activeSession = {
      sessionId: session.sessionId,
      stableVideoIdentity: session.stableVideoIdentity,
      targetFrame,
      sourceFrame: restored ? sourceFrame : (sourceScene ? sourceFrame : null),
      sceneKey,
      videoGeneration,
      tool: normalizeFabricDrawingTool(session.tool),
      toolRevision: -1
    };
    const scene = activeScene();
    scene.selectedObjectIds.clear();
    touchVideo(session.stableVideoIdentity);
    enforceLimits();
    notifySceneActivation(scene, session);
    return {
      accepted: true,
      restored,
      sceneKey,
      provisional: scene.provisional === true,
      sourceFrame: activeSession.sourceFrame
    };
  }

  // 임시 씬은 원래 "한 번도 편집되지 않은 스크래치"라 자리를 뜨면 버려도 됐다.
  // 그런데 키프레임 생성을 되돌리면 정식 씬이 다시 임시가 되고, 그 씬은 redo 를
  // 위한 히스토리를 들고 있다. 그것까지 버리면 되돌린 뒤 프레임을 옮기는 순간
  // 다시 실행이 영영 불가능해진다. 히스토리가 있는 임시 씬은 남긴다
  // (export 는 여전히 임시 씬을 걸러 내므로 파일에는 키프레임이 없다).
  function provisionalSceneIsDisposable(scene) {
    if (scene?.provisional !== true) return false;
    const history = historyDiagnostics(scene);
    return history.undoDepth === 0 && history.redoDepth === 0;
  }

  function replaceActiveSession(session) {
    const previousScene = activeScene();
    const activation = activateSession(session);
    if (!activation.accepted) return activation;
    previousScene?.selectedObjectIds.clear();
    if (provisionalSceneIsDisposable(previousScene) &&
        previousScene.key !== activeSession.sceneKey) {
      scenes.delete(previousScene.key);
      notifyScenesDropped([previousScene.sceneInstanceId]);
    }
    return activation;
  }

  function deactivateSession(sessionId) {
    if (!activeSession) return { accepted: true, active: false };
    if (sessionId && sessionId !== activeSession.sessionId) {
      return { accepted: false, reason: 'stale-session' };
    }
    const scene = activeScene();
    scene?.selectedObjectIds.clear();
    if (provisionalSceneIsDisposable(scene)) {
      scenes.delete(scene.key);
      notifyScenesDropped([scene.sceneInstanceId]);
    }
    activeSession = null;
    return { accepted: true, active: false };
  }

  // outlineRecord 는 본체에서 파생된 짝이다. 같은 커맨드로 넣어야 실행취소가 1건이다.
  // Map 삽입 순서가 곧 z-order 이므로 외곽선을 **먼저** 넣는다.
  function addStroke(stroke, outlineRecord = null) {
    // 낡은 사본 위에 커밋하면 이미 지워진 내용이 되살아난다.
    const scene = syncProvisionalSceneForMutation(activeScene());
    if (!scene) return { applied: false, reason: 'no-active-session' };
    if (!stroke || typeof stroke.id !== 'string' || stroke.id.length === 0) {
      return { applied: false, reason: 'invalid-stroke' };
    }
    if (scene.objects.has(stroke.id)) return { applied: false, reason: 'duplicate-object-id' };
    const pending = outlineRecord ? 2 : 1;
    if (scene.objects.size + pending > maxObjects) {
      return { applied: false, reason: 'scene-object-limit-exceeded' };
    }
    if (!Array.isArray(stroke.sourcePoints) || stroke.sourcePoints.length > MAX_STROKE_POINTS) {
      return { applied: false, reason: 'invalid-stroke-points' };
    }

    const record = clonePlain(stroke);
    const outline = outlineRecord && !scene.objects.has(outlineRecord.id)
      ? clonePlain(outlineRecord)
      : null;
    const nextObjects = new Map(scene.objects);
    if (outline) nextObjects.set(outline.id, outline);
    nextObjects.set(record.id, record);
    const touchedIds = outline ? [outline.id, record.id] : [record.id];
    const baseTransforms = new Map([[record.id, clonePlain(record.transform || {})]]);
    if (outline) baseTransforms.set(outline.id, clonePlain(outline.transform || {}));
    const result = commitStagedMutation(scene, {
      kind: 'add-objects',
      nextObjects,
      nextSelection: scene.selectedObjectIds,
      undoState: makeObjectsState(scene.objects, touchedIds, scene.objects.keys()),
      redoState: makeObjectsState(nextObjects, touchedIds, nextObjects.keys()),
      baseTransforms
    });
    if (!result.applied) return result;
    return { applied: true, objectId: record.id, outlineId: outline?.id || null };
  }

  // 접미사만으로는 부족하다. 구버전 앱이 본체만 지우고 저장하면 `…~outline` 만
  // 남는데, 그것까지 선택·지우기에서 빼면 화면에 보이는데 손댈 수 없는 획이 된다.
  // **짝이 실제로 살아 있을 때만** 파생 외곽선으로 취급한다.
  function isDerivedOutline(id, objects = activeScene()?.objects) {
    if (!objects || !isOutlineId(id)) return false;
    const bodyId = bodyIdFor(id);
    return bodyId !== null && objects.has(bodyId);
  }

  function selectObjects(objectIds = []) {
    const scene = activeScene();
    if (!scene) return { changed: false, selection: [] };
    // 외곽선은 본체에서 파생된 짝이라 따로 고르지 않는다. 본체를 고르면 변형·삭제가
    // 짝을 함께 다룬다. 짝을 잃은 고아는 평범한 획으로 되돌아간다.
    const next = new Set(objectIds.filter(id =>
      scene.objects.has(id) && !isDerivedOutline(id, scene.objects)));
    const changed = next.size !== scene.selectedObjectIds.size ||
      [...next].some(id => !scene.selectedObjectIds.has(id));
    scene.selectedObjectIds = next;
    return { changed, selection: [...next] };
  }

  function transformSelection(change = {}) {
    // 낡은 사본 위에 커밋하면 이미 지워진 내용이 되살아난다.
    const scene = syncProvisionalSceneForMutation(activeScene());
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
      // 외곽선은 자기 자연 위치를 갖는다(pathOffset 이 본체와 다르다).
      // 본체 transform 을 그대로 베끼면 그 간격이 무너져 첫 이동에서 어긋난다.
      // **이동량만** 더한다. 오브젝트 변형은 이동 전용이라(applyMoveOnlyConstraints)
      // 회전·크기조절을 따로 옮길 일이 없다.
      const outlineId = outlineIdFor(id);
      const outlineObject = outlineId ? scene.objects.get(outlineId) : null;
      if (outlineObject) {
        const outlineCurrent = {
          left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0,
          ...(outlineObject.transform || {})
        };
        const outlineNext = {
          ...outlineCurrent,
          left: finiteNumber(outlineCurrent.left) + (finiteNumber(next.left) - finiteNumber(current.left)),
          top: finiteNumber(outlineCurrent.top) + (finiteNumber(next.top) - finiteNumber(current.top))
        };
        nextObjects.set(outlineId, { ...clonePlain(outlineObject), transform: outlineNext });
        changedIds.push(outlineId);
      }
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
    // 낡은 사본 위에 커밋하면 이미 지워진 내용이 되살아난다.
    const scene = syncProvisionalSceneForMutation(activeScene());
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
      for (const id of nextSelection) {
        transformTargetIds.add(id);
        // 외곽선은 본체와 함께 움직여야 한다. 선택 집합에는 넣지 않고 변형 대상에만
        // 넣는다 — 외곽선은 선택 대상이 아니기 때문이다. 이게 없으면 조각을 끌었을 때
        // 본체만 가고 외곽선은 제자리에 남아 눈에 띄게 어긋난다.
        const outlineId = outlineIdFor(id);
        if (outlineId && nextObjects.has(outlineId)) transformTargetIds.add(outlineId);
      }
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
    if (!isSafeCount(scene.mutationSequence) ||
        scene.mutationSequence >= Number.MAX_SAFE_INTEGER) {
      return { applied: false, reason: 'mutation-sequence-overflow' };
    }
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

  // 임시 씬은 저장되지 않는 **파생 뷰**다 — exportVideo 도 resolveCommittedSceneAtFrame 도
  // 임시 씬을 건너뛴다. 그런데 씬 객체 안에는 만들어질 당시의 사본이 그대로 들어 있어,
  // 되돌림으로 원본이 바뀌면 그 사본이 낡는다. 사본을 그 자리에서 갈아끼우면 그 씬의
  // 히스토리(절대 스냅샷)와 어긋나 redo 가 invalid-history-state 로 죽으므로,
  // **저장된 사본은 건드리지 않고 화면에 보여 줄 때만 원본에서 다시 파생**한다.
  function derivedProvisionalObjects(scene) {
    const source = resolveCommittedSceneAtFrame(scene.stableVideoIdentity, scene.targetFrame);
    return new Map(
      [...(source?.objects || new Map()).entries()]
        .map(([id, object]) => [id, clonePlain(object)])
    );
  }

  function sameObjectIds(left, right) {
    if (left.size !== right.size) return false;
    for (const id of left.keys()) {
      if (!right.has(id)) return false;
    }
    return true;
  }

  // 낡은 사본 위에 새로 그리면 이미 지워진 내용이 되살아난다. 새 편집은 어차피 이 씬의
  // redo 를 무효화하므로(되돌린 뒤 새 동작을 하면 다시실행이 사라지는 일반 규칙),
  // 여기서 히스토리를 비우고 원본에서 다시 파생해 둔다.
  function syncProvisionalSceneForMutation(scene) {
    // 히스토리가 없는 임시 씬은 "한 번도 편집되지 않은 스크래치"다. 그 내용은
    // activateSession 이 정한 것이며 낡음 문제가 없다. 되돌려서 임시가 된 씬만 맞춘다.
    if (scene?.provisional !== true || provisionalSceneIsDisposable(scene)) return scene;
    const derived = derivedProvisionalObjects(scene);
    if (sameObjectIds(scene.objects, derived)) return scene;
    let estimatedBytes;
    try {
      estimatedBytes = estimateObjectsBytes(derived);
    } catch (_error) {
      return scene;
    }
    // 임시가 된 정식 씬은 자기 materialize 커맨드 하나만 redo 로 들고 있다.
    const droppedIds = new Set(scene.history.clearRedo());
    const order = globalOrderFor(scene.stableVideoIdentity);
    if (order && droppedIds.size > 0) {
      order.undo = order.undo.filter(entry => !droppedIds.has(entry.commandId));
      order.redo = order.redo.filter(entry => !droppedIds.has(entry.commandId));
    }
    scene.historyEntries = { undo: [], redo: [] };
    scene.objects = derived;
    scene.selectedObjectIds = new Set();
    scene.estimatedBytes = estimatedBytes;
    return scene;
  }

  function applyHistoryEntry(scene, order, direction) {
    let transition = null;
    let entryMaterializesScene = false;
    const result = scene.history[direction]((state, _historyDirection, entry) => {
      const applied = applyHistoryState(scene, state);
      if (applied.applied) {
        // 키프레임 생성(임시 씬 정식화)까지 함께 되돌린다. 되돌리면 그 프레임은
        // 다시 "키프레임 아님"이 되어 이후 프레임이 앞 키프레임을 따라간다.
        if (entry.materializesScene === true) {
          entryMaterializesScene = true;
          scene.provisional = direction === 'undo';
          scene.provisionalSourceFrame = direction === 'undo'
            ? (entry.provisionalSourceFrame ?? null)
            : null;
        }
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
    moveGlobalOrderEntry(order, direction, result.commandId);
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
      selectedObjectIds: [],
      // 되돌린 씬이 지금 화면에 떠 있는 씬인지. 아니면 캔버스 재도색과 도구 모드
      // 재설정을 건너뛴다. 다만 활성 씬이 임시 씬이면 그 화면은 커밋된 원본에서
      // 파생되므로, 어느 씬이 바뀌었든 다시 그려야 한다.
      affectedActiveScene: scene === activeScene() || activeScene()?.provisional === true,
      affectedTargetFrame: scene.targetFrame,
      // 키프레임이 생기거나 사라졌으면 지속화 스토어의 키프레임 목록과 어긋난다.
      // 전이(transition)는 객체 단위라 "이 키프레임이 사라졌다"를 표현할 수 없어,
      // 타임라인이 다음 저장 주기까지 옛 마커를 들고 있게 된다. 재동기를 요청하도록 알린다.
      keyframeSetChanged: entryMaterializesScene
    };
  }

  function moveHistory(direction) {
    // 대상은 활성 씬이 아니라 전역 순서 인덱스의 최상단이다. 재생헤드가 키프레임에
    // 정확히 있지 않아도, 다른 키프레임의 편집이어도 시각 순서의 역순으로 되돌린다.
    // 되돌린 곳이 현재 보고 있는 키프레임이 아니면 화면에는 변화가 없다 — 의도된
    // 동작이며, 사용자 결정에 따라 재생헤드를 옮기지 않는다.
    let lastFailure = null;
    for (const { scene, order } of globalHistoryCandidates(direction)) {
      const attempt = applyHistoryEntry(scene, order, direction);
      if (attempt.applied) return attempt;
      lastFailure = attempt;
    }
    return lastFailure || { applied: false, reason: 'history-empty' };
  }

  function undo() {
    return moveHistory('undo');
  }

  function redo() {
    return moveHistory('redo');
  }

  function deleteSelection() {
    // 낡은 사본 위에 커밋하면 이미 지워진 내용이 되살아난다.
    const scene = syncProvisionalSceneForMutation(activeScene());
    if (!scene || scene.selectedObjectIds.size === 0) {
      return { applied: false, deletedCount: 0, deletedIds: [] };
    }
    const selectedIds = [...scene.selectedObjectIds].filter(id => scene.objects.has(id));
    // 본체를 지우면 그 외곽선도 함께 지운다. 남으면 속이 빈 윤곽만 떠 있게 된다.
    const deletedIds = [];
    for (const id of selectedIds) {
      deletedIds.push(id);
      const outlineId = outlineIdFor(id);
      if (outlineId && scene.objects.has(outlineId)) deletedIds.push(outlineId);
    }
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
    // 낡은 사본 위에 커밋하면 이미 지워진 내용이 되살아난다.
    const scene = syncProvisionalSceneForMutation(activeScene());
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
    if (!isFabricDrawingTool(command.tool)) {
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
    if (!isFabricDrawingTool(command.tool)) {
      return { accepted: false, reason: 'invalid-tool' };
    }
    activeSession.tool = command.tool;
    return { accepted: true, tool: command.tool, toolRevision: activeSession.toolRevision };
  }

  function getSceneSnapshot(stableVideoIdentity, targetFrame) {
    return snapshotScene(scenes.get(makeSceneKey(stableVideoIdentity, targetFrame)));
  }

  function getPresentationScene(request = {}) {
    const binding = persistenceByVideo.get(request.stableVideoIdentity);
    if (!binding ||
        request.stableVideoIdentity !== latestPersistenceVideoIdentity ||
        request.hostGeneration !== latestPersistenceHostGeneration ||
        request.videoGeneration !== latestVideoGeneration ||
        binding.hostGeneration !== request.hostGeneration ||
        binding.videoGeneration !== request.videoGeneration) {
      return { accepted: false, reason: 'stale-presentation-fence' };
    }
    if (request.targetFrame >= binding.totalFrames ||
        (request.sourceFrame !== null && request.sourceFrame >= binding.totalFrames)) {
      return { accepted: false, reason: 'invalid-presentation-frame' };
    }
    const scene = resolveCommittedSceneAtFrame(
      request.stableVideoIdentity,
      request.targetFrame
    );
    if ((scene?.targetFrame ?? null) !== request.sourceFrame) {
      return { accepted: false, reason: 'stale-presentation-source' };
    }
    return {
      accepted: true,
      snapshot: snapshotScene(scene)
    };
  }

  function resolveCommittedSceneAtFrame(stableVideoIdentity, targetFrame) {
    let resolved = null;
    for (const scene of scenes.values()) {
      if (scene.stableVideoIdentity !== stableVideoIdentity ||
          scene.provisional === true ||
          scene.targetFrame > targetFrame ||
          (resolved && scene.targetFrame <= resolved.targetFrame)) {
        continue;
      }
      resolved = scene;
    }
    return resolved;
  }

  function getActiveFrameCandidate(targetFrame, options = {}) {
    if (!activeSession || !Number.isSafeInteger(targetFrame) || targetFrame < 0) {
      return { accepted: false, reason: 'invalid-active-frame' };
    }
    const binding = persistenceByVideo.get(activeSession.stableVideoIdentity);
    if (!binding ||
        binding.videoGeneration !== activeSession.videoGeneration ||
        targetFrame >= binding.totalFrames) {
      return { accepted: false, reason: 'stale-active-frame-session' };
    }
    const sourceScene = resolveCommittedSceneAtFrame(
      activeSession.stableVideoIdentity,
      targetFrame
    );
    return {
      accepted: true,
      sourceFrame: sourceScene?.targetFrame ?? null,
      sceneInstanceId: sourceScene?.sceneInstanceId ?? null,
      mutationSequence: sourceScene?.mutationSequence ?? 0,
      ...(options.includeSnapshot === true ? { snapshot: snapshotScene(sourceScene) } : {})
    };
  }

  function retargetActiveSession(session = {}) {
    if (!activeSession || session.sessionId !== activeSession.sessionId) {
      return { accepted: false, reason: 'stale-session' };
    }
    const targetFrame = Number(session.targetFrame);
    if (targetFrame === activeSession.targetFrame) {
      return {
        accepted: true,
        restored: true,
        sourceFrame: activeSession.sourceFrame,
        targetFrame
      };
    }
    const candidate = getActiveFrameCandidate(targetFrame);
    if (!candidate.accepted) return candidate;

    const previousSession = { ...activeSession };
    const activation = replaceActiveSession({
      ...session,
      targetFrame,
      sourceFrame: candidate.sourceFrame,
      tool: previousSession.tool
    });
    if (!activation.accepted) return activation;
    activeSession.toolRevision = previousSession.toolRevision;
    return {
      ...activation,
      targetFrame,
      sourceFrame: activeSession.sourceFrame
    };
  }

  function getActiveSceneSnapshot() {
    const scene = activeScene();
    // 되돌려서 임시가 된 씬만 파생한다. 스크래치 임시 씬의 내용은 activateSession 이
    // 정한 것이므로 그대로 보여 준다(원본이 없으면 빈 화면인 것이 기존 계약이다).
    if (!scene || scene.provisional !== true || provisionalSceneIsDisposable(scene)) {
      return snapshotScene(scene);
    }
    // 저장된 사본은 건드리지 않는다 — 그래야 그 씬의 redo 가 살아 있다.
    return snapshotScene({ ...scene, objects: derivedProvisionalObjects(scene) });
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
      persistenceObserverFailureCount,
      persistenceUnboundCommitCount,
      persistenceVideoCount: persistenceByVideo.size,
      latestPersistenceHostGeneration,
      latestVideoGeneration,
      latestPersistenceVideoIdentity,
      activeSessionId: activeSession?.sessionId || null,
      activeSceneKey: activeSession?.sceneKey || null,
      tool: activeSession?.tool || null,
      toolRevision: activeSession?.toolRevision ?? -1,
      objectCount: scene?.objects.size || 0,
      selectionCount: scene?.selectedObjectIds.size || 0,
      mutationCount: scene?.mutationCount || 0,
      dirty: scene?.dirty || false,
      provisional: scene?.provisional === true,
      provisionalSourceFrame: scene?.provisionalSourceFrame ?? null,
      undoDepth: history.undoDepth,
      redoDepth: history.redoDepth,
      // 활성 씬 기준 깊이(위)와 전역 순서 인덱스 깊이(아래)는 의미가 다르다.
      // 기존 진단의 의미를 바꾸지 않으려고 새 필드로 낸다.
      ...globalHistoryDepths(),
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
    globalHistoryOrder.clear();
    videoAccess.clear();
    persistenceByVideo.clear();
    latestPersistenceVideoIdentity = null;
    activeSession = null;
    notifyScenesDropped(droppedSceneInstanceIds);
  }

  return {
    activateSession,
    replaceActiveSession,
    deactivateSession,
    hydrateVideo,
    exportVideo,
    addStroke,
    selectObjects,
    isDerivedOutline,
    transformSelection,
    replaceObjects,
    undo,
    redo,
    deleteSelection,
    clearSession,
    updateTool,
    setLocalTool,
    getSceneSnapshot,
    getPresentationScene,
    getActiveFrameCandidate,
    retargetActiveSession,
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

// 도형 중심선 표본 생성기. 도형은 "미리 계산된 경로를 따라 그은 획"으로 저장하므로
// (drawingsV3 스키마 무변경), 여기서 만든 표본을 브러시와 같은 createStrokePathData 에
// 그대로 통과시킨다. 시간은 표본 순서대로 1씩 증가시켜 저장 스키마의
// "한 획의 sourcePoints[].time 은 단조 증가" 불변식을 만족시킨다.
const SHAPE_EDGE_SEGMENTS = 24;
const SHAPE_ELLIPSE_SEGMENTS = 128;
const SHAPE_ARROW_HEAD_MIN = 15;
const SHAPE_ARROW_HEAD_SIZE_FACTOR = 4;
const SHAPE_ARROW_HEAD_ANGLE = Math.PI / 6;
// 클릭만 하고 드래그하지 않았을 때 점 하나짜리 도형이 씬에 들어가 undo 를 소모하는
// 것을 막는다. 소스 좌표 기준이다.
const SHAPE_MIN_DRAG_DISTANCE = 2;

function interpolateShapeEdge(points, from, to, segments) {
  for (let index = 1; index <= segments; index += 1) {
    const amount = index / segments;
    points.push({
      x: from.x + (to.x - from.x) * amount,
      y: from.y + (to.y - from.y) * amount
    });
  }
}

function shapeCenterlinePoints(tool, start, end, brushSize) {
  const points = [{ x: start.x, y: start.y }];
  if (tool === 'line') {
    interpolateShapeEdge(points, start, end, SHAPE_EDGE_SEGMENTS);
    return points;
  }
  if (tool === 'rect') {
    const topRight = { x: end.x, y: start.y };
    const bottomRight = { x: end.x, y: end.y };
    const bottomLeft = { x: start.x, y: end.y };
    interpolateShapeEdge(points, start, topRight, SHAPE_EDGE_SEGMENTS);
    interpolateShapeEdge(points, topRight, bottomRight, SHAPE_EDGE_SEGMENTS);
    interpolateShapeEdge(points, bottomRight, bottomLeft, SHAPE_EDGE_SEGMENTS);
    interpolateShapeEdge(points, bottomLeft, start, SHAPE_EDGE_SEGMENTS);
    return points;
  }
  if (tool === 'circle') {
    // 레거시 _traceShapePath 의 ctx.ellipse 와 같은 기하 — 드래그 사각형에 내접하는 타원.
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    const centerX = start.x + (end.x - start.x) / 2;
    const centerY = start.y + (end.y - start.y) / 2;
    // 시작점은 곡선 위에 있지 않다. 버리지 않으면 중심에서 뻗어 나온 꼬리가 생긴다.
    points.length = 0;
    for (let index = 0; index <= SHAPE_ELLIPSE_SEGMENTS; index += 1) {
      const angle = (index / SHAPE_ELLIPSE_SEGMENTS) * Math.PI * 2;
      points.push({
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY
      });
    }
    return points;
  }
  // arrow — 레거시 _drawArrow 와 같은 화살촉 기하를 하나의 폴리라인으로 잇는다.
  // 축(start→end) 뒤에 촉을 그리려면 end 를 다시 지나야 하는데, 되짚기 구간은
  // getStroke 가 만든 윤곽이 자기 자신과 겹칠 뿐이고 makeFabricPath 의 기본
  // fillRule('nonzero')에서 합집합으로 칠해지므로 시각적으로 정확한 화살표가 된다.
  // 레코드를 둘로 쪼개면 undo·선택·이동이 축과 촉을 따로 다루게 되어 더 나쁘다.
  const headLength = Math.max(SHAPE_ARROW_HEAD_MIN, brushSize * SHAPE_ARROW_HEAD_SIZE_FACTOR);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const barbA = {
    x: end.x - headLength * Math.cos(angle - SHAPE_ARROW_HEAD_ANGLE),
    y: end.y - headLength * Math.sin(angle - SHAPE_ARROW_HEAD_ANGLE)
  };
  const barbB = {
    x: end.x - headLength * Math.cos(angle + SHAPE_ARROW_HEAD_ANGLE),
    y: end.y - headLength * Math.sin(angle + SHAPE_ARROW_HEAD_ANGLE)
  };
  interpolateShapeEdge(points, start, end, SHAPE_EDGE_SEGMENTS);
  interpolateShapeEdge(points, end, barbA, SHAPE_EDGE_SEGMENTS);
  interpolateShapeEdge(points, barbA, end, SHAPE_EDGE_SEGMENTS);
  interpolateShapeEdge(points, end, barbB, SHAPE_EDGE_SEGMENTS);
  return points;
}

// 도형 표본은 압력 1 상수·시간 단조 증가로 만든다. pointerType 을 넣지 않는 이유는
// 저장 스키마에서 선택 키이고, 도형은 어떤 포인터로 그렸든 결과가 같아야 하기 때문이다.
function shapeCenterlineSamples(tool, start, end, brushSize) {
  return shapeCenterlinePoints(tool, start, end, brushSize).map((point, index) => ({
    x: point.x,
    y: point.y,
    pressure: 1,
    time: index
  }));
}

// 도형·펜은 브러시와 다른 기하 파라미터로 획을 만든다. 저장 레코드는 어떤 도구로
// 그렸는지를 남기지 않으므로(스키마 무변경), 재구성할 때 후보를 순서대로 시도해
// pathData 가 일치하는 것을 그 획의 생성 규약으로 삼는다.
// 이게 없으면 도형·펜 획은 canonicalStrokePathMatches 를 절대 통과하지 못해
// 부분 선택·픽셀 지우개가 그 획을 통째로 삭제하는 쪽으로 떨어진다.
const PEN_STROKE_GEOMETRY = Object.freeze({ thinning: 0, smoothing: 0.4, streamline: 0.35 });
const SHAPE_STROKE_GEOMETRY = Object.freeze({ thinning: 0, smoothing: 0, streamline: 0 });
const STROKE_GEOMETRY_CANDIDATES = Object.freeze([
  null,
  SHAPE_STROKE_GEOMETRY,
  PEN_STROKE_GEOMETRY
]);

// 외곽선은 본체에서 파생된 짝 레코드다. 관계를 id 규약으로 표현해 drawingsV3
// 스키마를 건드리지 않는다 — style 은 exact-keys ['color','size','opacity'] 라
// 필드를 늘리면 구버전 앱이 문서를 통째로 거부한다. 규약을 모르는 구버전은
// 독립 획 2개로 읽고 그림은 똑같이 보인다.
//
// '~' 는 createId() 가 만드는 값에 등장하지 않는다(UUID 는 hex+'-',
// 폴백은 `${prefix}-${Date.now()}-${n}`).
const OUTLINE_ID_SUFFIX = '~outline';
const MAX_OUTLINE_BODY_ID_LENGTH = 512 - OUTLINE_ID_SUFFIX.length;

function isOutlineId(id) {
  return typeof id === 'string' && id.endsWith(OUTLINE_ID_SUFFIX);
}

function outlineIdFor(bodyId) {
  if (typeof bodyId !== 'string' || bodyId.length === 0) return null;
  if (bodyId.length > MAX_OUTLINE_BODY_ID_LENGTH) return null;
  if (isOutlineId(bodyId)) return null;
  return bodyId + OUTLINE_ID_SUFFIX;
}

function bodyIdFor(outlineId) {
  return isOutlineId(outlineId)
    ? outlineId.slice(0, -OUTLINE_ID_SUFFIX.length)
    : null;
}

// 외곽선 레코드에서 그것을 만든 사양을 되읽는다. 부분 분할이 조각마다 외곽선을
// 다시 만들 때 쓴다 — 씬에 있는 외곽선이 곧 사양의 진실이다.
function outlineSpecFromPair(bodyRecord, outlineRecord) {
  if (!bodyRecord || !outlineRecord) return null;
  const bodySize = finiteNumber(bodyRecord.style?.size, 0);
  const outlineSize = finiteNumber(outlineRecord.style?.size, 0);
  const width = Math.round((outlineSize - bodySize) / 2);
  if (!Number.isInteger(width) || width < MIN_OUTLINE_WIDTH || width > MAX_OUTLINE_WIDTH) {
    return null;
  }
  return {
    enabled: true,
    width,
    color: outlineRecord.style?.color || DEFAULT_OUTLINE_COLOR
  };
}

const SHAPE_STROKE_OPTIONS = Object.freeze({
  ...SHAPE_STROKE_GEOMETRY,
  alreadyNormalizedPressure: true,
  last: true
});

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
    pressure: options.alreadyNormalizedPressure === true
      ? Math.min(1, Math.max(0, finiteNumber(sample.pressure, 0.5)))
      : normalizePressure(sample.pressure, sample.pointerType),
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

    release(actionId) {
      entries.delete(actionId);
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

function validatePresentationRequest(request = {}) {
  if (!hasExactKeys(request, PRESENTATION_REQUEST_KEYS) ||
      !isSafeCount(request.hostGeneration) ||
      !isSafeCount(request.videoGeneration) ||
      !isSafeCount(request.presentationRevision) ||
      !isBoundedPersistenceString(request.stableVideoIdentity) ||
      !isSafeCount(request.storeRevision) ||
      !isSafeCount(request.targetFrame) ||
      !Number.isFinite(request.sourceWidth) || request.sourceWidth <= 0 ||
      request.sourceWidth > MAX_PERSISTED_SOURCE_DIMENSION ||
      !Number.isFinite(request.sourceHeight) || request.sourceHeight <= 0 ||
      request.sourceHeight > MAX_PERSISTED_SOURCE_DIMENSION ||
      !hasExactKeys(request.canvasRect, PRESENTATION_CANVAS_RECT_KEYS) ||
      !PRESENTATION_CANVAS_RECT_KEYS.every(key => Number.isFinite(request.canvasRect[key])) ||
      request.canvasRect.width <= 0 || request.canvasRect.height <= 0 ||
      request.canvasRect.width > MAX_PERSISTED_SOURCE_DIMENSION ||
      request.canvasRect.height > MAX_PERSISTED_SOURCE_DIMENSION ||
      !isSafeCount(request.viewportRevision) ||
      !hasExactKeys(
        request.viewportTransform,
        PRESENTATION_VIEWPORT_TRANSFORM_KEYS
      ) ||
      !PRESENTATION_VIEWPORT_TRANSFORM_KEYS.every(
        key => Number.isFinite(request.viewportTransform[key]) &&
          Math.abs(request.viewportTransform[key]) <= MAX_PERSISTED_TRANSFORM_MAGNITUDE
      ) ||
      request.viewportTransform.scale <= 0) {
    return false;
  }
  return request.sourceFrame === null ||
    (isSafeCount(request.sourceFrame) && request.sourceFrame <= request.targetFrame);
}

function validateActiveFrameRequest(request = {}) {
  return hasExactKeys(request, ACTIVE_FRAME_REQUEST_KEYS) &&
    isSafeCount(request.hostGeneration) &&
    isSafeCount(request.videoGeneration) &&
    isSafeCount(request.inputRevision) &&
    isBoundedPersistenceString(request.sessionId) &&
    isSafeCount(request.frameRevision) &&
    request.frameRevision > 0 &&
    isSafeCount(request.targetFrame);
}

function validatePointerdownFrameConfirmation(request = {}) {
  const validBase =
    isSafeCount(request.hostGeneration) && request.hostGeneration > 0 &&
    isSafeCount(request.videoGeneration) && request.videoGeneration > 0 &&
    isSafeCount(request.inputRevision) && request.inputRevision > 0 &&
    isBoundedPersistenceString(request.sessionId) &&
    isBoundedPersistenceString(request.pointerdownId) &&
    isSafeCount(request.pointerdownAt);
  if (!validBase) return false;
  if (hasExactKeys(request, POINTERDOWN_FRAME_CANCELLATION_KEYS)) {
    return request.cancelled === true;
  }
  return hasExactKeys(request, POINTERDOWN_FRAME_CONFIRMATION_KEYS) &&
    isSafeCount(request.targetFrame);
}

function resolvePersistenceCommitObserver(options, windowRef) {
  if (typeof options.persistenceCommitObserver === 'function') {
    return options.persistenceCommitObserver;
  }
  try {
    const bridge = windowRef?.mpvOverlayPersistence;
    return typeof bridge?.notifyCommittedTransition === 'function'
      ? bridge.notifyCommittedTransition.bind(bridge)
      : null;
  } catch (_error) {
    return null;
  }
}

function createFabricOverlayRuntime(options = {}) {
  const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
  const windowRef = options.window || (typeof window !== 'undefined' ? window : null);
  const performanceRef = options.performance || (typeof performance !== 'undefined' ? performance : null);
  const queueMicrotaskRef = options.queueMicrotask ||
    windowRef?.queueMicrotask?.bind(windowRef) ||
    globalThis.queueMicrotask?.bind(globalThis) ||
    (callback => Promise.resolve().then(callback));
  const setTimeoutRef = typeof options.setTimeout === 'function'
    ? options.setTimeout
    : globalThis.setTimeout?.bind(globalThis);
  const clearTimeoutRef = typeof options.clearTimeout === 'function'
    ? options.clearTimeout
    : globalThis.clearTimeout?.bind(globalThis);
  const now = () => typeof performanceRef?.now === 'function' ? performanceRef.now() : Date.now();
  const wallNow = typeof options.wallNow === 'function'
    ? options.wallNow
    : () => {
      const epochMilliseconds = Number(performanceRef?.timeOrigin) +
        Number(performanceRef?.now?.());
      return Number.isFinite(epochMilliseconds)
        ? Math.floor(epochMilliseconds * 1000)
        : Date.now() * 1000;
    };
  const devicePixelRatio = finiteNumber(options.devicePixelRatio ?? windowRef?.devicePixelRatio, 1) || 1;
  const metrics = options.metrics || createFabricDrawingPilotMetrics(options.metricsOptions);
  const drawingV3ShadowRequested = options.drawingV3ShadowEnabled === true;
  const persistenceCommitObserver = resolvePersistenceCommitObserver(options, windowRef);
  const requestPointerdownFrame = typeof options.requestPointerdownFrame === 'function'
    ? options.requestPointerdownFrame
    : (() => {
      try {
        const bridge = windowRef?.mpvOverlayDrawingFrame;
        return typeof bridge?.requestPointerdownFrame === 'function'
          ? bridge.requestPointerdownFrame.bind(bridge)
          : null;
      } catch (_error) {
        return null;
      }
    })();
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
    ...(drawingV3Adapter ? { drawingEngineObserver: drawingV3Adapter } : {}),
    ...(persistenceCommitObserver ? { committedTransitionObserver: persistenceCommitObserver } : {})
  });
  const actionDeduper = options.actionDeduper || createActionDeduper(options.actionDeduperOptions);
  const strokePathFactory = options.strokePathFactory || createStrokePathData;
  const maxLassoFragments = positiveInteger(options.maxLassoFragments, 512);
  const maxSelectionGeometryOperations = positiveInteger(
    options.maxSelectionGeometryOperations,
    DEFAULT_MAX_SELECTION_GEOMETRY_OPERATIONS
  );
  const tokenState = { hostGeneration: -1, videoGeneration: -1, inputRevision: -1 };
  const presentationState = {
    hostGeneration: -1,
    videoGeneration: -1,
    presentationRevision: -1,
    stableVideoIdentity: null,
    storeRevision: -1,
    targetFrame: null,
    sourceFrame: null
  };
  const activeFrameState = {
    hostGeneration: -1,
    videoGeneration: -1,
    inputRevision: -1,
    sessionId: null,
    frameRevision: -1,
    targetFrame: null,
    sourceFrame: null,
    sourceSceneInstanceId: null,
    sourceMutationSequence: 0,
    renderedSourceFrame: null,
    renderedSceneInstanceId: null,
    renderedMutationSequence: 0,
    previewed: false
  };
  const domListeners = [];
  const fabricListeners = [];
  let fabricModule = null;
  let root = null;
  let container = null;
  let viewportElement = null;
  let canvasElement = null;
  let toolbar = null;
  let paletteShell = null;
  let badge = null;
  const toolButtons = new Map();
  let fabricCanvas = null;
  let prepared = false;
  let destroyed = false;
  let inputEnabled = false;
  let currentSession = null;
  let passiveDisplaySession = null;
  let lastPaintedScene = null;
  let activeStroke = null;
  let activeLasso = null;
  // Alt 드래그 크기 조절 / Ctrl 임시 획 지우개 — 씬 스키마와 무관한 순수 입력 계층 상태
  let sizeAdjustGesture = null;
  let strokeEraseGesture = null;
  // 도형 도구(line/rect/circle/arrow)의 시작점→끝점 드래그 상태.
  // 커밋 전까지는 미리보기 경로만 캔버스에 올리고 씬에는 아무것도 넣지 않는다.
  let shapeGesture = null;
  let sizeAdjustHud = null;
  let sizeAdjustHudLabel = null;
  // [ / ] 로 띄운 HUD 를 되돌리는 타이머. Alt 제스처는 자기 수명 동안 HUD 를
  // 계속 잡고 있어야 하므로 제스처가 시작되면 이 타이머를 취소한다.
  let sizeAdjustHudTimer = null;
  const overlayModifierState = { alt: false, ctrl: false };
  // Alt 제스처 실기 미동작(v2.4.3-beta) 원인 확정용 관측값.
  // "오버레이 문서가 Alt keydown을 받기는 하는가"와 "마우스 pointerdown이 altKey를
  // 싣고 오는가"를 분리해 재현 1회로 원인을 가른다. 씬·스키마와 무관한 진단 전용 상태다.
  const gestureProbe = {
    overlayAltKeyDownCount: 0,
    overlayCtrlKeyDownCount: 0,
    lastPointerdown: null
  };
  let pendingPointerdownFrame = null;
  let lastSelectionGesture = null;
  let pendingLassoSelection = null;
  let preservingPendingLassoSelectionEvent = false;
  let brushStyle = { ...DEFAULT_BRUSH_STYLE };
  // 외곽선 설정. 그리는 시점의 값이 그 획에 굳는다 — 나중에 켜도 이미 그린 획에는
  // 붙지 않는다(그러려면 모든 획을 다시 만들어야 하고 이 라운드 범위 밖이다).
  let outlineStyle = {
    enabled: false,
    color: DEFAULT_OUTLINE_COLOR,
    width: DEFAULT_OUTLINE_WIDTH
  };
  let outlineControls = null;
  let brushControls = null;
  let brushPanelOpen = false;
  let selectionTarget = 'stroke';
  let selectionShape = 'rectangle';
  let selectionControlEventCount = 0;
  let lastSelectionControlAction = null;
  let selectionControls = null;
  // 지우개 방식 — 레거시 eraserModeSection 동치. 'stroke'는 지나간 획 전체를,
  // 'pixel'은 지나간 구간만 잘라낸다. 부분 삭제 엔진(stroke-splitter)은 이미 있으므로
  // 여기서는 어느 경로로 커밋할지만 고른다.
  let eraserMode = 'stroke';
  let eraserModeControls = null;
  // 도형 도구 4종은 버튼 1개 + 드롭다운으로 접는다. 런타임의 도구 값은 여전히
  // line/rect/circle/arrow 그대로이고, 팔레트가 "그 4종 중 활성인 것"으로 표시만 묶는다.
  let shapeMenuControls = null;
  // 도형 메뉴가 열려 있어야 하는가. 실제 표시는 이 값과 섹션 접힘의 곱이다.
  // 캔버스 쪽 상태를 팔레트 셸이 캐시하면 접혀 있는 동안 낡는다.
  let shapeMenuOpen = false;
  let lastShapeTool = 'rect';
  let brushStatusRow = null;
  // 최근 사용 색 4개. 팔레트 색상 8종 중 실제로 쓰는 건 보통 2~3개인데 매번 전체를
  // 훑어야 했다. 오버레이 문서는 data: URL 오리진이라 localStorage 가 SecurityError 를
  // 던지므로 세션 메모리에만 둔다.
  const recentColors = [];
  let recentColorControls = null;
  let transformStart = null;
  let selectGesture = null;
  const ignoredModifiedTargets = new WeakSet();
  let deferredViewport = null;
  let longTaskObserver = null;
  let localSequence = 0;
  let lastError = null;
  let appliedSourceWidth = null;
  let appliedSourceHeight = null;
  const strokeFillGeometryCache = new Map();
  let strokeFillGeometryCacheWeight = 0;

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
    if (isFabricDrawingTool(action)) {
      button.dataset.active = 'false';
      button.setAttribute?.('aria-pressed', 'false');
      toolButtons.set(action, button);
    }
    return button;
  }

  function labelToolbarButton(button, label) {
    button.setAttribute?.('aria-label', label);
    button.setAttribute?.('title', label);
    return button;
  }

  // 아이콘 전용 버튼. 이름은 title/aria-label 로만 남기므로 스크린리더와 툴팁은
  // 그대로 동작하고, 좁은 팔레트에서 한글 라벨이 잘리는 문제만 사라진다.
  function iconToolbarButton(button, label, icon) {
    labelToolbarButton(button, label);
    button.textContent = '';
    if (icon) button.innerHTML = icon;
    return button;
  }

  function syncPersistenceBadge(targetFrame = null) {
    if (!badge) return;
    const fullLabel = formatFabricPersistenceBadge(targetFrame);
    badge.textContent = formatCompactFabricPersistenceBadge(targetFrame);
    badge.setAttribute?.('aria-label', fullLabel);
    badge.setAttribute?.('title', fullLabel);
  }

  function syncSelectionControls(tool = currentSession?.tool) {
    if (!selectionControls) return;
    selectionControls.group.style.display = tool === 'select' ? 'flex' : 'none';
    for (const [target, button] of selectionControls.targetButtons) {
      const active = selectionTarget === target;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
    for (const [shape, button] of selectionControls.shapeButtons) {
      const active = selectionShape === shape;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
    selectionControls.summary.textContent = selectionTarget === 'partial'
      ? `현재: 부분 자르기 · ${selectionShape === 'lasso' ? '라쏘 영역' : '사각 영역'}`
      : `현재: 획 전체 · ${selectionShape === 'lasso' ? '라쏘 영역' : '사각 영역'}`;
  }

  // 팔레트를 펼치지 않아도 현재 브러시 상태가 보이게 하는 상시 요약 줄.
  // brushControls.sizePreview / summary 는 설정 패널·버튼 안에 그대로 둔다
  // (appendChild 로 옮기면 원래 자리에서 사라진다).
  function createBrushStatusRow() {
    const row = documentRef.createElement('div');
    row.className = 'mpv-fabric-pilot-brush-status';
    const swatch = documentRef.createElement('span');
    swatch.dataset.fabricPilotOutput = 'brush-status-swatch';
    const text = documentRef.createElement('span');
    text.dataset.fabricPilotOutput = 'brush-status-text';
    text.setAttribute?.('role', 'status');
    text.setAttribute?.('aria-live', 'polite');
    row.appendChild(swatch);
    row.appendChild(text);
    return { row, swatch, text };
  }

  function syncBrushStatusRow(tool = sceneStore.getDiagnostics().tool) {
    if (!brushStatusRow) return;
    const diameter = Math.min(22, Math.max(2, brushStyle.size));
    setStyles(brushStatusRow.swatch, {
      display: 'inline-block',
      width: `${diameter}px`,
      height: `${diameter}px`,
      borderRadius: '50%',
      background: brushStyle.color,
      opacity: String(brushStyle.opacity)
    });
    const toolName = TOOL_STATUS_LABELS[tool] || '';
    const outlineSuffix = outlineStyle.enabled ? ` · 외곽선 ${outlineStyle.width}px` : '';
    brushStatusRow.text.textContent = toolName
      ? `${brushStyle.size}px · ${Math.round(brushStyle.opacity * 100)}% · ${toolName}${outlineSuffix}`
      : `${brushStyle.size}px · ${Math.round(brushStyle.opacity * 100)}%${outlineSuffix}`;
  }

  function createRecentColorControls() {
    const row = documentRef.createElement('div');
    row.className = 'mpv-fabric-pilot-recent-colors';
    row.setAttribute?.('role', 'group');
    row.setAttribute?.('aria-label', '최근 사용 색');
    const buttons = [];
    for (let index = 0; index < RECENT_COLOR_LIMIT; index += 1) {
      const button = createButton('', `recent-color-${index}`);
      button.dataset.fabricPilotRecentColor = '';
      setStyles(button, { display: 'none', minWidth: '20px', minHeight: '20px', padding: '0' });
      addDomListener(button, 'click', () => {
        const color = button.dataset.fabricPilotRecentColor;
        if (color) setBrushColor(color);
      });
      row.appendChild(button);
      buttons.push(button);
    }
    return { row, buttons };
  }

  function syncRecentColorControls() {
    if (!recentColorControls) return;
    recentColorControls.buttons.forEach((button, index) => {
      const color = recentColors[index];
      button.dataset.fabricPilotRecentColor = color || '';
      setStyles(button, {
        display: color ? 'inline-block' : 'none',
        background: color || 'transparent'
      });
      button.setAttribute?.('aria-label', color ? `최근 색 ${color}` : '');
      button.setAttribute?.('title', color ? `최근 색 ${color}` : '');
    });
  }

  function noteRecentColor(color) {
    if (typeof color !== 'string' || color.length === 0) return;
    const index = recentColors.indexOf(color);
    if (index >= 0) recentColors.splice(index, 1);
    recentColors.unshift(color);
    while (recentColors.length > RECENT_COLOR_LIMIT) recentColors.pop();
    syncRecentColorControls();
  }

  function createShapeMenuControls() {
    const button = labelToolbarButton(createButton('', 'shape-menu'), '도형 도구');
    button.dataset.active = 'false';
    button.setAttribute?.('aria-haspopup', 'true');
    button.setAttribute?.('aria-expanded', 'false');
    setStyles(button, { position: 'relative' });
    const icon = documentRef.createElement('span');
    icon.dataset.fabricPilotOutput = 'shape-menu-icon';
    const caret = documentRef.createElement('span');
    caret.dataset.fabricPilotOutput = 'shape-menu-caret';
    caret.innerHTML = SHAPE_MENU_CARET_SVG;
    setStyles(caret, {
      position: 'absolute',
      right: '2px',
      bottom: '2px',
      lineHeight: '0',
      pointerEvents: 'none'
    });
    button.appendChild(icon);
    button.appendChild(caret);

    const flyout = documentRef.createElement('div');
    flyout.className = 'mpv-fabric-pilot-shape-menu';
    flyout.dataset.fabricPilotPanel = 'shape-menu';
    flyout.setAttribute?.('role', 'group');
    flyout.setAttribute?.('aria-label', '도형 도구');
    setStyles(flyout, {
      display: 'none',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      gap: '3px',
      width: '100%'
    });
    const shapeButtons = new Map();
    for (const tool of FABRIC_SHAPE_TOOLS) {
      const shapeButton = iconToolbarButton(
        createButton('', tool),
        `${SHAPE_TOOL_LABELS[tool] || tool} 도구`,
        TOOL_ICON_SVG[tool]
      );
      setStyles(shapeButton, { minWidth: '0', padding: '0' });
      flyout.appendChild(shapeButton);
      shapeButtons.set(tool, shapeButton);
    }
    return { button, icon, flyout, shapeButtons };
  }

  function setShapeMenuOpen(open) {
    if (!shapeMenuControls) return false;
    shapeMenuOpen = open === true;
    return applyShapeMenuVisibility();
  }

  function applyShapeMenuVisibility() {
    if (!shapeMenuControls) return false;
    const collapsed = paletteShell?.isSectionCollapsed?.('tools') === true;
    const visible = shapeMenuOpen && !collapsed;
    setStyles(shapeMenuControls.flyout, { display: visible ? 'grid' : 'none' });
    shapeMenuControls.button.setAttribute?.('aria-expanded', String(shapeMenuOpen));
    return visible;
  }

  function syncShapeMenuControls(tool = currentSession?.tool) {
    if (!shapeMenuControls) return;
    const isShapeTool = FABRIC_SHAPE_TOOLS.includes(tool);
    if (isShapeTool) lastShapeTool = tool;
    // 버튼에는 마지막에 쓴 도형이 남아, 다시 누르면 그 도형으로 바로 돌아간다.
    shapeMenuControls.icon.innerHTML = TOOL_ICON_SVG[lastShapeTool] || '';
    const label = `도형 도구 (${SHAPE_TOOL_LABELS[lastShapeTool] || lastShapeTool})`;
    shapeMenuControls.button.setAttribute?.('aria-label', label);
    shapeMenuControls.button.setAttribute?.('title', label);
    shapeMenuControls.button.dataset.active = String(isShapeTool);
    shapeMenuControls.button.setAttribute?.('aria-pressed', String(isShapeTool));
    if (!isShapeTool) setShapeMenuOpen(false);
    else applyShapeMenuVisibility();
  }

  function createEraserModeControls() {
    const group = documentRef.createElement('div');
    group.className = 'mpv-fabric-pilot-eraser-mode';
    group.setAttribute?.('role', 'group');
    group.setAttribute?.('aria-label', '지우개 방식');
    const pixelButton = labelToolbarButton(
      createButton('픽셀', 'eraser-mode-pixel'),
      '지우개 방식: 지나간 부분만 지움'
    );
    const strokeButton = labelToolbarButton(
      createButton('획', 'eraser-mode-stroke'),
      '지우개 방식: 지나간 획 전체를 지움'
    );
    group.appendChild(pixelButton);
    group.appendChild(strokeButton);
    return { group, pixelButton, strokeButton };
  }

  function setEraserMode(mode) {
    eraserMode = mode === 'pixel' ? 'pixel' : 'stroke';
    syncEraserModeControls();
    return eraserMode;
  }

  function syncEraserModeControls(tool = currentSession?.tool) {
    if (!eraserModeControls) return;
    setStyles(eraserModeControls.group, {
      display: tool === 'eraser' ? 'flex' : 'none'
    });
    for (const [modeName, button] of [
      ['pixel', eraserModeControls.pixelButton],
      ['stroke', eraserModeControls.strokeButton]
    ]) {
      const active = eraserMode === modeName;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
  }

  // 도구별로 의미 있는 섹션만 남긴다. 섹션이 늘어나면 세로 팔레트가 화면을 덮으므로,
  // 지금 쓰는 것만 보이게 하는 편이 훨씬 편하다.
  // selection 섹션은 syncSelectionControls 가 자체 관리하므로 여기서 건드리지 않는다
  // (라벨이 없어 셸의 sectionElements 에도 등록되지 않는다).
  function syncToolSectionVisibility(tool) {
    if (!paletteShell?.setSectionVisible) return;
    // 브러시·펜·도형은 크기·불투명도·색상이 필요하다. 지우개는 지우개 방식만.
    // 선택 도구는 둘 다 필요 없다.
    paletteShell.setSectionVisible('brush', tool !== 'eraser' && tool !== 'select');
    paletteShell.setSectionVisible('eraser', tool === 'eraser');
  }

  function usesNativeRectangleSelection(tool = currentSession?.tool) {
    return tool === 'select' &&
      selectionTarget === 'stroke' &&
      selectionShape === 'rectangle';
  }

  function clearSelectionForConfigurationChange() {
    const viewportContext = {
      sessionId: currentSession?.sessionId,
      inputRevision: tokenState.inputRevision
    };
    if (activeLasso) cancelActiveLasso();
    if (selectGesture || transformStart) {
      ignoreLateModifiedEvents(transformStart?.target || fabricCanvas?.getActiveObject?.());
      cancelSelectInteraction(undefined, { preserveDeferredViewport: true });
    }
    abortPendingLassoSelection();
    fabricCanvas?.discardActiveObject();
    sceneStore.selectObjects([]);
    refreshSelectionInteractionPolicy();
    fabricCanvas?.requestRenderAll();
    return viewportContext;
  }

  function syncChangedSelectionConfiguration() {
    if (currentSession?.tool === 'select') {
      setToolMode('select');
    } else {
      syncSelectionControls();
    }
  }

  function recordSelectionControlAction(kind, value, source = 'click') {
    selectionControlEventCount += 1;
    lastSelectionControlAction = {
      kind,
      value,
      source,
      eventCount: selectionControlEventCount
    };
  }

  function setSelectionTarget(target, source = 'click') {
    const nextTarget = target === 'partial' ? 'partial' : 'stroke';
    recordSelectionControlAction('target', nextTarget, source);
    if (selectionTarget === nextTarget) return selectionTarget;
    const viewportContext = clearSelectionForConfigurationChange();
    selectionTarget = nextTarget;
    syncChangedSelectionConfiguration();
    settleDeferredViewport(viewportContext.sessionId, viewportContext.inputRevision);
    return selectionTarget;
  }

  function setSelectionShape(shape, source = 'click') {
    const nextShape = shape === 'lasso' ? 'lasso' : 'rectangle';
    recordSelectionControlAction('shape', nextShape, source);
    if (selectionShape === nextShape) return selectionShape;
    const viewportContext = clearSelectionForConfigurationChange();
    selectionShape = nextShape;
    syncChangedSelectionConfiguration();
    settleDeferredViewport(viewportContext.sessionId, viewportContext.inputRevision);
    return selectionShape;
  }

  function createSelectionControls() {
    const group = documentRef.createElement('div');
    group.dataset.fabricPilotGroup = 'selection-controls';
    group.setAttribute?.('role', 'group');
    group.setAttribute?.('aria-label', '선택 설정');
    setStyles(group, {
      display: 'none',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '6px',
      padding: '6px',
      borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.08)'
    });

    const targetGroup = documentRef.createElement('div');
    targetGroup.dataset.fabricPilotGroup = 'selection-target';
    targetGroup.setAttribute?.('role', 'group');
    targetGroup.setAttribute?.('aria-label', '선택 대상');
    setStyles(targetGroup, {
      display: 'flex',
      flexFlow: 'row wrap',
      alignItems: 'center',
      gap: '4px',
      paddingBottom: '6px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.18)'
    });

    const targetLabel = documentRef.createElement('span');
    targetLabel.dataset.fabricPilotLabel = 'selection-target';
    targetLabel.textContent = '선택 대상';
    setStyles(targetLabel, {
      flex: '1 1 100%',
      color: 'rgba(255, 255, 255, 0.64)',
      fontSize: '11px',
      fontWeight: '600',
      whiteSpace: 'nowrap'
    });

    const strokeTargetButton = labelToolbarButton(
      createButton('획 전체', 'select-target-stroke'),
      '획 전체 선택'
    );
    const partialTargetButton = labelToolbarButton(
      createButton('부분 자르기', 'select-target-partial'),
      '획 일부 선택'
    );
    const targetButtons = new Map([
      ['stroke', strokeTargetButton],
      ['partial', partialTargetButton]
    ]);
    targetGroup.appendChild(targetLabel);
    for (const button of targetButtons.values()) {
      button.setAttribute?.('aria-pressed', 'false');
      targetGroup.appendChild(button);
    }

    const shapeGroup = documentRef.createElement('div');
    shapeGroup.dataset.fabricPilotGroup = 'selection-shape';
    shapeGroup.setAttribute?.('role', 'group');
    shapeGroup.setAttribute?.('aria-label', '선택 모양');
    setStyles(shapeGroup, {
      display: 'flex',
      flexFlow: 'row wrap',
      alignItems: 'center',
      gap: '4px'
    });

    const shapeLabel = documentRef.createElement('span');
    shapeLabel.dataset.fabricPilotLabel = 'selection-shape';
    shapeLabel.textContent = '영역 모양';
    setStyles(shapeLabel, {
      flex: '1 1 100%',
      color: 'rgba(255, 255, 255, 0.64)',
      fontSize: '11px',
      fontWeight: '600',
      whiteSpace: 'nowrap'
    });

    const rectangleShapeButton = labelToolbarButton(
      createButton('사각 영역', 'select-shape-rectangle'),
      '사각형 선택'
    );
    const lassoShapeButton = labelToolbarButton(
      createButton('라쏘 영역', 'select-shape-lasso'),
      '라쏘 선택'
    );
    const shapeButtons = new Map([
      ['rectangle', rectangleShapeButton],
      ['lasso', lassoShapeButton]
    ]);
    shapeGroup.appendChild(shapeLabel);
    for (const button of shapeButtons.values()) {
      button.setAttribute?.('aria-pressed', 'false');
      shapeGroup.appendChild(button);
    }

    const summary = documentRef.createElement('span');
    summary.dataset.fabricPilotOutput = 'selection-summary';
    summary.setAttribute?.('role', 'status');
    summary.setAttribute?.('aria-live', 'polite');
    setStyles(summary, {
      minWidth: '0',
      color: 'rgba(255, 255, 255, 0.76)',
      fontSize: '11px',
      fontWeight: '650',
      whiteSpace: 'normal'
    });

    group.appendChild(targetGroup);
    group.appendChild(shapeGroup);
    group.appendChild(summary);
    const bindSelectionControl = (button, action) => {
      addDomListener(button, 'pointerdown', event => {
        if (event?.button !== undefined && event.button !== 0) return;
        action('pointerdown');
      });
      addDomListener(button, 'click', () => action('click'));
    };
    bindSelectionControl(strokeTargetButton, source => setSelectionTarget('stroke', source));
    bindSelectionControl(partialTargetButton, source => setSelectionTarget('partial', source));
    bindSelectionControl(rectangleShapeButton, source => setSelectionShape('rectangle', source));
    bindSelectionControl(lassoShapeButton, source => setSelectionShape('lasso', source));
    return {
      group,
      targetGroup,
      shapeGroup,
      targetButtons,
      shapeButtons,
      summary
    };
  }

  function setOutlineEnabled(enabled) {
    outlineStyle = { ...outlineStyle, enabled: enabled === true };
    syncBrushControls();
    return outlineStyle.enabled;
  }

  function setOutlineColor(color) {
    if (!BRUSH_COLORS.includes(color)) return outlineStyle.color;
    outlineStyle = { ...outlineStyle, color };
    syncBrushControls();
    return outlineStyle.color;
  }

  function setOutlineWidth(value) {
    outlineStyle = {
      ...outlineStyle,
      width: boundedInteger(value, MIN_OUTLINE_WIDTH, MAX_OUTLINE_WIDTH, outlineStyle.width)
    };
    syncBrushControls();
    return outlineStyle.width;
  }

  function setBrushColor(color) {
    if (!BRUSH_COLORS.includes(color)) return brushStyle.color;
    brushStyle = { ...brushStyle, color };
    syncBrushControls();
    // 팔레트 클릭과 원격 변경을 모두 여기서 거치므로 최근 색 기록도 여기 둔다.
    noteRecentColor(brushStyle.color);
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
    // 상시 요약 줄은 설정 패널과 별개 요소다. brushControls 가 아직 없어도 갱신한다.
    syncBrushStatusRow();
    if (!brushControls) return;
    const opacityPercent = Math.round(brushStyle.opacity * 100);
    brushControls.settingsButton.setAttribute?.('aria-expanded', String(brushPanelOpen));
    // 섹션이 접혀 있으면 패널도 접힌 상태다. 이 판정을 빼면 [ / ] 로 크기를
    // 바꿀 때마다 syncBrushControls 가 패널을 도로 열어, 라벨과 버튼 줄은
    // 접힌 채 설정 패널만 떠 있는 상태가 된다.
    const sectionCollapsed = paletteShell?.isSectionCollapsed?.('brush') === true;
    brushControls.panel.style.display = brushPanelOpen && !sectionCollapsed ? 'flex' : 'none';
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
    if (outlineControls) {
      outlineControls.toggle.dataset.active = String(outlineStyle.enabled);
      outlineControls.toggle.setAttribute?.('aria-pressed', String(outlineStyle.enabled));
      // 꺼져 있으면 색·굵기 컨트롤을 감춘다 — 아무 효과도 없는 컨트롤을 띄우지 않는다.
      const detailDisplay = outlineStyle.enabled ? 'flex' : 'none';
      setStyles(outlineControls.palette, { display: detailDisplay });
      setStyles(outlineControls.widthRow.row, { display: detailDisplay });
      outlineControls.widthRow.input.value = String(outlineStyle.width);
      outlineControls.widthRow.output.textContent = `${outlineStyle.width}px`;
      for (const button of outlineControls.colorButtons) {
        const active = button.dataset.fabricPilotOutlineColor === outlineStyle.color;
        button.setAttribute?.('aria-pressed', String(active));
        button.style.boxShadow = active
          ? '0 0 0 2px #fff, 0 0 0 4px rgba(255, 71, 87, 0.75)'
          : 'none';
      }
    }
    for (const button of brushControls.colorButtons) {
      const active = button.dataset.fabricPilotColor === brushStyle.color;
      button.setAttribute?.('aria-pressed', String(active));
      button.style.boxShadow = active
        ? '0 0 0 2px #fff, 0 0 0 4px rgba(255, 71, 87, 0.75)'
        : 'none';
    }
  }

  function createBrushSettingsControls() {
    const settingsButton = labelToolbarButton(
      createButton('', 'brush-settings'),
      '브러시 설정'
    );
    settingsButton.setAttribute?.('aria-expanded', 'false');
    setStyles(settingsButton, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      width: '100%',
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
    // 팔레트 안에 인라인으로 펼쳐진다(더 이상 툴바 아래로 떨어지는 드롭다운이 아니다)
    setStyles(panel, {
      display: 'none',
      position: 'static',
      width: '100%',
      maxHeight: '210px',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      flexDirection: 'column',
      gap: '10px',
      marginTop: '6px',
      padding: '8px',
      boxSizing: 'border-box',
      borderRadius: '8px',
      background: 'rgba(255, 255, 255, 0.05)',
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
        flexFlow: 'row wrap',
        alignItems: 'center',
        gap: '6px'
      });
      const labelElement = documentRef.createElement('span');
      labelElement.textContent = label;
      setStyles(labelElement, { flex: '1 1 100%', fontSize: '11px' });
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

    // 외곽선 — 목업이 "색상 아래 자리를 비워 둔다"고 한 그 자리다.
    const outlineGroup = documentRef.createElement('div');
    outlineGroup.className = 'mpv-fabric-pilot-outline';
    outlineGroup.setAttribute?.('role', 'group');
    outlineGroup.setAttribute?.('aria-label', '외곽선');
    setStyles(outlineGroup, { display: 'flex', flexFlow: 'row wrap', gap: '6px' });
    const outlineToggle = labelToolbarButton(
      createButton('외곽선', 'outline-toggle'),
      '외곽선 켜기/끄기'
    );
    outlineToggle.dataset.active = 'false';
    outlineToggle.setAttribute?.('aria-pressed', 'false');
    setStyles(outlineToggle, { flex: '1 1 100%' });
    outlineGroup.appendChild(outlineToggle);

    const outlinePalette = documentRef.createElement('div');
    setStyles(outlinePalette, { display: 'flex', flexFlow: 'row wrap', gap: '4px', flex: '1 1 100%' });
    const outlineColorButtons = BRUSH_COLORS.map(color => {
      const button = createButton('', `outline-color-${color.replace('#', '')}`);
      button.dataset.fabricPilotOutlineColor = color;
      button.setAttribute?.('aria-label', `외곽선 색 ${color}`);
      button.setAttribute?.('title', `외곽선 색 ${color}`);
      setStyles(button, {
        minWidth: '20px',
        minHeight: '20px',
        padding: '0',
        background: color,
        border: color === '#ffffff' ? '1px solid rgba(0, 0, 0, 0.7)' : 'none'
      });
      outlinePalette.appendChild(button);
      return button;
    });
    outlineGroup.appendChild(outlinePalette);

    const outlineWidthRow = createRangeRow({
      label: '외곽선 굵기',
      setting: 'outline-width',
      min: MIN_OUTLINE_WIDTH,
      max: MAX_OUTLINE_WIDTH,
      decreaseAction: 'outline-width-decrease',
      decreaseLabel: '외곽선 굵기 1px 줄이기',
      increaseAction: 'outline-width-increase',
      increaseLabel: '외곽선 굵기 1px 늘리기',
      output: 'outline-width'
    });
    setStyles(outlineWidthRow.row, { flex: '1 1 100%' });
    outlineGroup.appendChild(outlineWidthRow.row);

    const recentColors = createRecentColorControls();
    panel.appendChild(previewRow);
    panel.appendChild(palette);
    panel.appendChild(recentColors.row);
    panel.appendChild(outlineGroup);
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
    addDomListener(outlineToggle, 'click', () => setOutlineEnabled(!outlineStyle.enabled));
    for (const button of outlineColorButtons) {
      addDomListener(button, 'click', () => setOutlineColor(button.dataset.fabricPilotOutlineColor));
    }
    addDomListener(outlineWidthRow.input, 'input', () => setOutlineWidth(outlineWidthRow.input.value));
    addDomListener(outlineWidthRow.decrease, 'click', () => setOutlineWidth(outlineStyle.width - 1));
    addDomListener(outlineWidthRow.increase, 'click', () => setOutlineWidth(outlineStyle.width + 1));

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
      sizePreview,
      recentColors,
      outline: {
        group: outlineGroup,
        toggle: outlineToggle,
        palette: outlinePalette,
        colorButtons: outlineColorButtons,
        widthRow: outlineWidthRow
      }
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
    const path = new Path(record.renderGeometry?.pathData || record.pathData, {
      fill: record.style?.color || DEFAULT_BRUSH_STYLE.color,
      fillRule: record.renderGeometry?.fillRule || 'nonzero',
      opacity: normalizePathOpacity(record.style?.opacity),
      stroke: null,
      strokeWidth: 0,
      // 외곽선은 본체에서 파생된 짝이라 **선택 대상은 아니다** — 따로 잡히면
      // 사용자가 본체 대신 윤곽만 옮기게 되어 쌍이 어긋난다.
      // 다만 이벤트는 받아야 한다. 고리로 칠한 테두리는 본체 밖에 있어서,
      // evented 까지 끄면 눈에 보이는 그 픽셀을 클릭해도 그냥 빠져 버린다.
      // 클릭이 들어오면 onCanvasMouseDown 이 짝인 본체로 돌린다.
      // 짝을 잃은 고아는 평범한 획으로 되돌아간다.
      selectable: !transient && !sceneStore.isDerivedOutline(record.id) &&
        sceneStore.getDiagnostics().tool === 'select',
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

  function renderActiveScene(options = {}) {
    if (!fabricCanvas) return;
    strokeFillGeometryCache.clear();
    strokeFillGeometryCacheWeight = 0;
    const snapshot = sceneStore.getActiveSceneSnapshot();
    const paths = (snapshot?.objects || []).map(record => makeFabricPath(record));
    fabricCanvas.clear();
    for (const path of paths) fabricCanvas.add(path);
    refreshSelectionInteractionPolicy();
    if (options.immediate === true && typeof fabricCanvas.renderAll === 'function') {
      fabricCanvas.renderAll();
    } else {
      fabricCanvas.requestRenderAll();
    }
    updateObjectMetric();
    rememberRenderedActiveScene();
  }

  function rememberRenderedActiveScene() {
    if (!currentSession) return;
    const candidate = sceneStore.getActiveFrameCandidate(currentSession.targetFrame);
    if (!candidate?.accepted) return;
    activeFrameState.renderedSourceFrame = candidate.sourceFrame;
    activeFrameState.renderedSceneInstanceId = candidate.sceneInstanceId;
    activeFrameState.renderedMutationSequence = candidate.mutationSequence;
  }

  function resetActiveFrameState(session = null) {
    const candidate = session
      ? sceneStore.getActiveFrameCandidate(session.targetFrame)
      : null;
    activeFrameState.hostGeneration = session?.hostGeneration ?? -1;
    activeFrameState.videoGeneration = session?.videoGeneration ?? -1;
    activeFrameState.inputRevision = session ? tokenState.inputRevision : -1;
    activeFrameState.sessionId = session?.sessionId || null;
    activeFrameState.frameRevision = -1;
    activeFrameState.targetFrame = session?.targetFrame ?? null;
    activeFrameState.sourceFrame = candidate?.accepted
      ? candidate.sourceFrame
      : session?.sourceFrame ?? null;
    activeFrameState.sourceSceneInstanceId = candidate?.accepted
      ? candidate.sceneInstanceId
      : null;
    activeFrameState.sourceMutationSequence = candidate?.accepted
      ? candidate.mutationSequence
      : 0;
    activeFrameState.renderedSourceFrame = candidate?.accepted
      ? candidate.sourceFrame
      : session?.sourceFrame ?? null;
    activeFrameState.renderedSceneInstanceId = candidate?.accepted
      ? candidate.sceneInstanceId
      : null;
    activeFrameState.renderedMutationSequence = candidate?.accepted
      ? candidate.mutationSequence
      : 0;
    activeFrameState.previewed = false;
  }

  function activeFrameInteractionInProgress() {
    // 제스처 중 renderArmedFramePreview()가 캔버스를 재구성하면 Ctrl 지우개의 은닉 표시가 사라진다.
    return !!(pendingPointerdownFrame || activeStroke || activeLasso || selectGesture ||
      transformStart || sizeAdjustGesture || strokeEraseGesture || shapeGesture);
  }

  function renderedCandidateMatches(candidate) {
    return candidate.sourceFrame === activeFrameState.renderedSourceFrame &&
      candidate.sceneInstanceId === activeFrameState.renderedSceneInstanceId &&
      candidate.mutationSequence === activeFrameState.renderedMutationSequence;
  }

  function renderArmedFramePreview(frameState = activeFrameState) {
    if (!inputEnabled || !currentSession || !fabricCanvas ||
        frameState.sessionId !== currentSession.sessionId) {
      return { accepted: false, reason: 'stale-active-frame' };
    }
    if (activeFrameInteractionInProgress()) {
      return {
        accepted: true,
        deferred: true,
        repainted: false,
        previewed: activeFrameState.previewed,
        sourceFrame: frameState.sourceFrame,
        sourceSceneInstanceId: frameState.sourceSceneInstanceId,
        sourceMutationSequence: frameState.sourceMutationSequence,
        renderedSourceFrame: activeFrameState.renderedSourceFrame,
        renderedSceneInstanceId: activeFrameState.renderedSceneInstanceId,
        renderedMutationSequence: activeFrameState.renderedMutationSequence
      };
    }
    const candidate = sceneStore.getActiveFrameCandidate(frameState.targetFrame);
    if (!candidate?.accepted) return candidate;
    const isPreview = frameState.targetFrame !== currentSession.targetFrame;
    if (renderedCandidateMatches(candidate)) {
      if (isPreview) {
        if (pendingLassoSelection) abortPendingLassoSelection();
        fabricCanvas.discardActiveObject();
        sceneStore.selectObjects([]);
        for (const object of fabricCanvas.getObjects()) {
          object.set?.({ selectable: false, evented: false });
        }
      } else {
        refreshSelectionInteractionPolicy();
      }
      return {
        accepted: true,
        deferred: false,
        repainted: false,
        previewed: isPreview,
        sourceFrame: candidate.sourceFrame,
        sourceSceneInstanceId: candidate.sceneInstanceId,
        sourceMutationSequence: candidate.mutationSequence,
        renderedSourceFrame: candidate.sourceFrame,
        renderedSceneInstanceId: candidate.sceneInstanceId,
        renderedMutationSequence: candidate.mutationSequence
      };
    }

    let preparedCandidate;
    let paths;
    try {
      preparedCandidate = sceneStore.getActiveFrameCandidate(frameState.targetFrame, {
        includeSnapshot: true
      });
      if (!preparedCandidate?.accepted ||
          preparedCandidate.sourceFrame !== candidate.sourceFrame ||
          preparedCandidate.sceneInstanceId !== candidate.sceneInstanceId ||
          preparedCandidate.mutationSequence !== candidate.mutationSequence) {
        return { accepted: false, reason: 'stale-active-frame-preview' };
      }
      paths = (preparedCandidate.snapshot?.objects || []).map(record => makeFabricPath(record));
      if (isPreview) {
        for (const path of paths) path.set({ selectable: false, evented: false });
      }
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      return { accepted: false, reason: 'active-frame-preview-failed' };
    }

    const previousObjects = [...fabricCanvas.getObjects()];
    const previousActiveObject = fabricCanvas.getActiveObject?.() || null;
    const previousSelection = sceneStore.getActiveSceneSnapshot()?.selectedObjectIds || [];
    const previousPendingLassoSelection = pendingLassoSelection;
    const previousObjectStates = previousObjects.map(object => ({
      object,
      transform: captureTransform(object),
      opacity: object.opacity,
      selectable: object.selectable,
      evented: object.evented,
      perPixelTargetFind: object.perPixelTargetFind,
      padding: object.padding,
      hoverCursor: object.hoverCursor,
      moveCursor: object.moveCursor,
      pendingLasso: object.__baeframePendingLasso
    }));
    try {
      if (pendingLassoSelection) abortPendingLassoSelection();
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
      fabricCanvas.clear();
      for (const path of paths) fabricCanvas.add(path);
      if (!isPreview) refreshSelectionInteractionPolicy();
      if (typeof fabricCanvas.renderAll === 'function') fabricCanvas.renderAll();
      else fabricCanvas.requestRenderAll();
    } catch (error) {
      pendingLassoSelection = previousPendingLassoSelection;
      try {
        fabricCanvas.clear();
        for (const state of previousObjectStates) {
          state.object.set?.({
            ...state.transform,
            opacity: state.opacity,
            selectable: state.selectable,
            evented: state.evented,
            perPixelTargetFind: state.perPixelTargetFind,
            padding: state.padding,
            hoverCursor: state.hoverCursor,
            moveCursor: state.moveCursor
          });
          state.object.__baeframePendingLasso = state.pendingLasso;
          state.object.setCoords?.();
          fabricCanvas.add(state.object);
        }
        if (previousActiveObject && typeof fabricCanvas.setActiveObject === 'function') {
          fabricCanvas.setActiveObject(previousActiveObject);
        }
      } catch (_rollbackError) { /* best-effort visual rollback */ }
      try {
        sceneStore.selectObjects(previousSelection);
      } catch (_rollbackError) { /* best-effort selection rollback */ }
      lastError = error.message;
      metrics.recordSurfaceError();
      return { accepted: false, reason: 'active-frame-preview-failed' };
    }
    updateObjectMetric();
    return {
      accepted: true,
      deferred: false,
      repainted: true,
      previewed: isPreview,
      sourceFrame: preparedCandidate.sourceFrame,
      sourceSceneInstanceId: preparedCandidate.sceneInstanceId,
      sourceMutationSequence: preparedCandidate.mutationSequence,
      renderedSourceFrame: preparedCandidate.sourceFrame,
      renderedSceneInstanceId: preparedCandidate.sceneInstanceId,
      renderedMutationSequence: preparedCandidate.mutationSequence
    };
  }

  function publishActiveFramePreview(frameState, preview) {
    activeFrameState.hostGeneration = frameState.hostGeneration;
    activeFrameState.videoGeneration = frameState.videoGeneration;
    activeFrameState.inputRevision = frameState.inputRevision;
    activeFrameState.sessionId = frameState.sessionId;
    activeFrameState.frameRevision = frameState.frameRevision;
    activeFrameState.targetFrame = frameState.targetFrame;
    activeFrameState.sourceFrame = preview.sourceFrame;
    activeFrameState.sourceSceneInstanceId = preview.sourceSceneInstanceId;
    activeFrameState.sourceMutationSequence = preview.sourceMutationSequence;
    activeFrameState.renderedSourceFrame = preview.renderedSourceFrame;
    activeFrameState.renderedSceneInstanceId = preview.renderedSceneInstanceId;
    activeFrameState.renderedMutationSequence = preview.renderedMutationSequence;
    activeFrameState.previewed = preview.previewed === true;
    if (preview.deferred !== true) {
      lastPaintedScene = preview.sourceFrame === null
        ? null
        : {
          stableVideoIdentity: currentSession.stableVideoIdentity,
          targetFrame: preview.sourceFrame
        };
      presentationState.hostGeneration = frameState.hostGeneration;
      presentationState.videoGeneration = frameState.videoGeneration;
      presentationState.stableVideoIdentity = currentSession.stableVideoIdentity;
      presentationState.targetFrame = frameState.targetFrame;
      presentationState.sourceFrame = preview.sourceFrame;
      syncPersistenceBadge(frameState.targetFrame);
    }
  }

  function retargetFrameForMutation(targetFrame) {
    if (!inputEnabled || !currentSession || !Number.isSafeInteger(targetFrame) || targetFrame < 0) {
      return { accepted: false, reason: 'stale-active-frame' };
    }
    if (targetFrame === currentSession.targetFrame &&
        activeFrameState.previewed !== true) {
      return {
        accepted: true,
        restored: true,
        targetFrame: currentSession.targetFrame,
        sourceFrame: currentSession.sourceFrame
      };
    }
    if (targetFrame !== currentSession.targetFrame && pendingLassoSelection) {
      abortPendingLassoSelection();
    }
    const result = sceneStore.retargetActiveSession({
      ...currentSession,
      targetFrame
    });
    if (!result?.accepted) return result || { accepted: false, reason: 'retarget-failed' };
    currentSession.targetFrame = result.targetFrame;
    currentSession.sourceFrame = result.sourceFrame;
    if (activeFrameState.targetFrame === targetFrame) {
      const candidate = sceneStore.getActiveFrameCandidate(targetFrame);
      activeFrameState.sourceFrame = result.sourceFrame;
      activeFrameState.sourceSceneInstanceId = candidate?.sceneInstanceId ?? null;
      activeFrameState.sourceMutationSequence = candidate?.mutationSequence ?? 0;
    }
    activeFrameState.previewed = false;
    renderActiveScene({ immediate: true });
    setToolMode(currentSession.tool);
    lastPaintedScene = {
      stableVideoIdentity: currentSession.stableVideoIdentity,
      targetFrame: currentSession.targetFrame
    };
    syncPersistenceBadge(currentSession.targetFrame);
    return result;
  }

  function retargetArmedFrameForMutation() {
    if (!inputEnabled || !currentSession ||
        activeFrameState.hostGeneration !== tokenState.hostGeneration ||
        activeFrameState.videoGeneration !== tokenState.videoGeneration ||
        activeFrameState.inputRevision !== tokenState.inputRevision ||
        activeFrameState.sessionId !== currentSession.sessionId ||
        !Number.isSafeInteger(activeFrameState.targetFrame)) {
      return { accepted: false, reason: 'stale-active-frame' };
    }
    return retargetFrameForMutation(activeFrameState.targetFrame);
  }

  function settleArmedFramePreview() {
    if (!inputEnabled || !currentSession || activeFrameInteractionInProgress() ||
        activeFrameState.targetFrame === currentSession.targetFrame) {
      return false;
    }
    const preview = renderArmedFramePreview(activeFrameState);
    if (preview?.accepted !== true) return false;
    publishActiveFramePreview(activeFrameState, preview);
    return true;
  }

  function repaintLastPaintedScene(options = {}) {
    if (destroyed || !fabricCanvas || inputEnabled || !lastPaintedScene) return;
    if (typeof sceneStore.getSceneSnapshot !== 'function') return;
    const snapshot = sceneStore.getSceneSnapshot(
      lastPaintedScene.stableVideoIdentity,
      lastPaintedScene.targetFrame
    );
    if (!snapshot) {
      // 스냅샷 부재의 의미는 호출 맥락에 따라 다르다:
      // - disable 경로(기본): '정보 없음'(씬 축출 등) — 화면을 보존한다.
      // - 수화 직후((e), clearWhenMissing): 수화가 그 프레임 키프레임을 싣지 않았다는
      //   '삭제 확정' — 삭제된 획이 화면에 남지 않게 캔버스를 비운다.
      if (options.clearWhenMissing === true) {
        fabricCanvas.clear();
        if (typeof fabricCanvas.renderAll === 'function') fabricCanvas.renderAll();
        else fabricCanvas.requestRenderAll();
      }
      return;
    }
    if (options.force !== true) {
      const snapshotIds = (snapshot.objects || []).map(record => record.id || null);
      const canvasIds = fabricCanvas.getObjects()
        .filter(object => !object.__baeframeTransient)
        .map(object => object.__baeframeObjectId);
      if (snapshotIds.length === canvasIds.length &&
          snapshotIds.every((id, index) => id === canvasIds[index])) {
        return;
      }
    }
    const paths = (snapshot.objects || []).map(record => makeFabricPath(record));
    for (const path of paths) path.set({ selectable: false, evented: false });
    fabricCanvas.clear();
    for (const path of paths) fabricCanvas.add(path);
    if (typeof fabricCanvas.renderAll === 'function') fabricCanvas.renderAll();
    else fabricCanvas.requestRenderAll();
  }

  function setToolMode(tool) {
    if (!fabricCanvas) return;
    if (tool !== 'select') abortPendingLassoSelection();
    const selectMode = tool === 'select';
    const nativeSelectMode = usesNativeRectangleSelection(tool);
    for (const [buttonTool, button] of toolButtons) {
      const active = buttonTool === tool;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = nativeSelectMode;
    fabricCanvas.defaultCursor = selectMode
      ? (nativeSelectMode ? 'default' : 'crosshair')
      : 'crosshair';
    fabricCanvas.hoverCursor = 'grab';
    fabricCanvas.moveCursor = 'grabbing';
    fabricCanvas.freeDrawingCursor = 'crosshair';
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      // 외곽선은 본체의 짝이라 어떤 도구에서도 따로 **선택**되지 않는다.
      // 이벤트는 받아 그 위 클릭을 짝인 본체로 돌린다.
      object.set({
        selectable: nativeSelectMode && !sceneStore.isDerivedOutline(object.__baeframeObjectId),
        evented: nativeSelectMode
      });
    }
    if (!selectMode) {
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
    }
    syncSelectionControls(tool);
    syncEraserModeControls(tool);
    syncShapeMenuControls(tool);
    // 상시 요약 줄이 현재 도구 이름을 함께 띄우므로 도구가 바뀔 때도 갱신한다.
    syncBrushStatusRow(tool);
    syncToolSectionVisibility(tool);
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
    // 시간 단조는 저장 스키마의 불변식이다(스토어·런타임·호스트 세 검증기가 모두
    // point.time < previousTime을 거절한다). 어떤 시계 이상으로도 획 하나가 파일 전체의
    // 저장을 막지 못하도록, 표본을 쌓는 지점에서 단조성을 보장한다. x/y는 건드리지
    // 않으므로 획 모양은 달라지지 않는다.
    const previous = activeStroke.samples[activeStroke.samples.length - 1];
    if (previous && sample.time < previous.time) sample.time = previous.time;
    activeStroke.samples.push(sample);
    metrics.recordPointerSample(sample.pressure);
  }

  function removeTransientPreview() {
    if (!fabricCanvas) return;
    if (activeStroke?.outlinePreview) {
      fabricCanvas.remove(activeStroke.outlinePreview);
      activeStroke.outlinePreview = null;
    }
    if (!activeStroke?.preview) return;
    fabricCanvas.remove(activeStroke.preview);
    activeStroke.preview = null;
  }

  // 그리는 동안에도 외곽선을 함께 보여 준다. 커밋해야 나타나면 굵기 20px 에서는
  // 손을 떼는 순간 자국이 확 커져, 기존 그림이나 화면 가장자리 옆에 정확히
  // 놓으려는 사용자가 결과를 예측할 수 없다.
  //
  // 커밋본과 **같은 고리**로 만든다. 채워진 판으로 두면 불투명도 1 미만에서
  // 미리보기 중심만 두 번 합성돼(50% 두 겹 = 75%) 손을 떼는 순간 색이 변한다 —
  // 미리보기의 목적이 바로 그 변화를 없애는 것이다.
  function makeOutlinePreviewPath(samples, style, geometryOptions, bodyPathData, outline) {
    if (outline?.enabled !== true) return null;
    const width = boundedInteger(
      outline.width,
      MIN_OUTLINE_WIDTH,
      MAX_OUTLINE_WIDTH,
      DEFAULT_OUTLINE_WIDTH
    );
    try {
      const strokeData = strokePathFactory(samples, {
        size: finiteNumber(style.size, DEFAULT_BRUSH_STYLE.size) + 2 * width,
        ...(geometryOptions || null)
      });
      if (!strokeData?.pathData) return null;
      const record = {
        id: null,
        pathData: strokeData.pathData,
        style: { ...style, color: outline.color || DEFAULT_OUTLINE_COLOR }
      };
      const ringPathData = bodyPathData
        ? `${outlineToPathData([...strokeData.outline].reverse())} ${bodyPathData}`
        : null;
      if (ringPathData && ringPathData.length <= MAX_PERSISTENCE_STRING_LENGTH) {
        record.renderGeometry = { version: 1, pathData: ringPathData, fillRule: 'nonzero' };
      } else if (finiteNumber(style.opacity, 1) < 1) {
        // 고리를 못 만드는데 반투명이면, 채워진 판은 중심 색을 바꿔 놓는다.
        // 미리보기를 생략해 커밋 결과와 어긋나지 않게 한다.
        return null;
      }
      return makeFabricPath(record, true);
    } catch (_error) {
      return null;
    }
  }

  function updateTransientPreview() {
    if (!activeStroke || activeStroke.samples.length === 0) return;
    const startedAt = now();
    removeTransientPreview();
    try {
      const strokeData = strokePathFactory(activeStroke.samples, {
        size: activeStroke.style.size,
        ...(activeStroke.tool === 'pen' ? PEN_STROKE_GEOMETRY : null)
      });
      if (!strokeData.pathData) return;
      const geometryOptions = activeStroke.tool === 'pen' ? PEN_STROKE_GEOMETRY : null;
      activeStroke.outlinePreview = makeOutlinePreviewPath(
        activeStroke.samples,
        activeStroke.style,
        geometryOptions,
        strokeData.pathData,
        activeStroke.outline
      );
      activeStroke.preview = makeFabricPath({
        id: null,
        pathData: strokeData.pathData,
        style: { ...activeStroke.style }
      }, true);
      // 외곽선이 먼저 올라가야 본체 뒤에 깔린다.
      if (activeStroke.outlinePreview) fabricCanvas.add(activeStroke.outlinePreview);
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
    if (activeLasso.shape === 'rectangle') {
      if (activeLasso.points.length === 0) activeLasso.points.push(point);
      else activeLasso.points[1] = point;
      return;
    }
    if (activeLasso.points.length >= MAX_LASSO_POINTS) {
      activeLasso.points = activeLasso.points.filter((_sample, index) => index === 0 || index % 2 === 0);
    }
    activeLasso.points.push(point);
  }

  function updateLassoPreview() {
    if (!activeLasso || activeLasso.points.length < 2 || !fabricCanvas) return;
    removeLassoPreview();
    const { Path } = resolveFabric();
    const previewPoints = activeLasso.shape === 'rectangle'
      ? rectanglePolygon(activeLasso.points[0], activeLasso.points.at(-1))
      : activeLasso.points;
    const [first, ...rest] = previewPoints;
    const pathData = `M ${first.x} ${first.y} ${rest.map(point => `L ${point.x} ${point.y}`).join(' ')}${
      activeLasso.shape === 'rectangle' ? ' Z' : ''
    }`;
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
    const { pointerId, previousSelectionContext = null } = activeLasso;
    removeLassoPreview();
    activeLasso = null;
    releasePointerCapture(fabricCanvas?.upperCanvasEl || canvasElement, pointerId);
    if (previousSelectionContext?.pendingSelection &&
        pendingLassoSelection === previousSelectionContext.pendingSelection) {
      abortPendingLassoSelection({
        authoritative: !pendingLassoIsFresh(previousSelectionContext.pendingSelection)
      });
      return;
    }
    restoreSelectionContext(previousSelectionContext);
  }

  function strokeObjectSceneBounds(record, object, padding = 0) {
    const safePadding = Math.max(0, finiteNumber(padding));
    const rectangle = object?.getBoundingRect?.();
    if (rectangle &&
        [rectangle.left, rectangle.top, rectangle.width, rectangle.height]
          .every(value => Number.isFinite(Number(value)))) {
      const left = finiteNumber(rectangle.left);
      const top = finiteNumber(rectangle.top);
      const right = left + finiteNumber(rectangle.width);
      const bottom = top + finiteNumber(rectangle.height);
      return {
        left: Math.min(left, right) - safePadding,
        right: Math.max(left, right) + safePadding,
        top: Math.min(top, bottom) - safePadding,
        bottom: Math.max(top, bottom) + safePadding
      };
    }
    return boundsForPoints(record?.sourcePoints || [], safePadding);
  }

  function createSourcePolygonQuery(object, scenePolygon, budget) {
    const { Path, Point, util } = resolveFabric();
    if (!object || !Path || !(object instanceof Path) ||
        typeof object.calcTransformMatrix !== 'function' ||
        !object.pathOffset ||
        !Number.isFinite(Number(object.pathOffset.x)) ||
        !Number.isFinite(Number(object.pathOffset.y)) ||
        !Point || !util?.transformPoint || !util?.invertTransform) {
      return { query: null, reason: 'selection-complexity-limit-exceeded' };
    }
    let matrix;
    try {
      matrix = Array.from(object.calcTransformMatrix() || []);
    } catch (_error) {
      return { query: null, reason: 'selection-complexity-limit-exceeded' };
    }
    if (matrix.length < 6 || matrix.some(value => !Number.isFinite(Number(value)))) {
      return { query: null, reason: 'selection-complexity-limit-exceeded' };
    }
    const a = finiteNumber(matrix[0]);
    const b = finiteNumber(matrix[1]);
    const c = finiteNumber(matrix[2]);
    const d = finiteNumber(matrix[3]);
    const determinant = a * d - b * c;
    const linearMagnitudeSquared = a * a + b * b + c * c + d * d;
    const discriminant = Math.max(
      0,
      linearMagnitudeSquared * linearMagnitudeSquared - 4 * determinant * determinant
    );
    const maximumSingularValueSquared = (
      linearMagnitudeSquared + Math.sqrt(discriminant)
    ) / 2;
    const relativeDeterminant = Math.abs(determinant) / maximumSingularValueSquared;
    if (!Number.isFinite(determinant) ||
        !Number.isFinite(maximumSingularValueSquared) ||
        maximumSingularValueSquared <= 0 ||
        !Number.isFinite(relativeDeterminant) ||
        relativeDeterminant <= 1e-8) {
      return { query: null, reason: 'selection-complexity-limit-exceeded' };
    }
    let inverse;
    try {
      inverse = util.invertTransform(matrix);
    } catch (_error) {
      return { query: null, reason: 'selection-complexity-limit-exceeded' };
    }
    if (!Array.isArray(inverse) || inverse.length < 6 ||
        inverse.some(value => !Number.isFinite(Number(value)))) {
      return { query: null, reason: 'selection-complexity-limit-exceeded' };
    }
    const sourcePolygon = [];
    for (const point of scenePolygon) {
      if (!budget.consume()) {
        return { query: null, reason: 'selection-complexity-limit-exceeded' };
      }
      let local;
      try {
        local = util.transformPoint(
          new Point(finiteNumber(point?.x), finiteNumber(point?.y)),
          inverse
        );
      } catch (_error) {
        return { query: null, reason: 'selection-complexity-limit-exceeded' };
      }
      if (!Number.isFinite(Number(local?.x)) || !Number.isFinite(Number(local?.y))) {
        return { query: null, reason: 'selection-complexity-limit-exceeded' };
      }
      sourcePolygon.push({
        x: finiteNumber(local?.x) + finiteNumber(object.pathOffset.x),
        y: finiteNumber(local?.y) + finiteNumber(object.pathOffset.y)
      });
    }
    return {
      query: createPolygonEdgeIndex(sourcePolygon, { budget }),
      maximumScale: Math.sqrt(maximumSingularValueSquared),
      reason: budget.limitExceeded ? 'selection-complexity-limit-exceeded' : null
    };
  }

  function strokeGeometryCacheEntryWeight(entry) {
    const fillEdges = entry?.geometry?.edges?.length || 0;
    const fillPoints = (entry?.geometry?.contours || []).reduce(
      (count, contour) => count + contour.length,
      0
    );
    const centerlinePoints = entry?.centerline?.points?.length || 0;
    const centerlineSegments = entry?.centerline?.segments?.length || 0;
    const sourceSignatureValues = entry?.centerlineSourceGeometry?.length || 0;
    return Math.max(
      1,
      fillEdges * 3 +
      fillPoints +
      centerlineSegments * 3 +
      centerlinePoints +
      sourceSignatureValues
    );
  }

  function deleteStrokeGeometryCacheEntry(id) {
    const existing = strokeFillGeometryCache.get(id);
    if (!existing) return false;
    strokeFillGeometryCache.delete(id);
    strokeFillGeometryCacheWeight = Math.max(
      0,
      strokeFillGeometryCacheWeight - strokeGeometryCacheEntryWeight(existing)
    );
    return true;
  }

  function storeStrokeGeometryCacheEntry(id, entry) {
    deleteStrokeGeometryCacheEntry(id);
    strokeFillGeometryCache.set(id, entry);
    strokeFillGeometryCacheWeight += strokeGeometryCacheEntryWeight(entry);
    while (strokeFillGeometryCache.size > MAX_STROKE_GEOMETRY_CACHE_ENTRIES ||
        strokeFillGeometryCacheWeight > MAX_STROKE_GEOMETRY_CACHE_WEIGHT) {
      deleteStrokeGeometryCacheEntry(strokeFillGeometryCache.keys().next().value);
    }
  }

  function touchStrokeGeometryCacheEntry(id, entry) {
    if (!strokeFillGeometryCache.has(id)) return;
    strokeFillGeometryCache.delete(id);
    strokeFillGeometryCache.set(id, entry);
  }

  function createStoredPathFillQuery(record, object, sourceSelection, budget) {
    if (!record?.id || !object || !Array.isArray(object.path)) {
      return { query: null, reason: 'selection-geometry-unavailable' };
    }
    const maximumScale = Math.max(1e-9, finiteNumber(sourceSelection?.maximumScale, 1));
    const requiredTolerance = Math.max(
      Number.EPSILON,
      Math.min(0.25, 0.25 / maximumScale)
    );
    const displayPathData = record.renderGeometry?.pathData || record.pathData;
    let cached = strokeFillGeometryCache.get(record.id);
    if (!cached ||
        cached.displayPathData !== displayPathData ||
        cached.pathCommands !== object.path ||
        cached.fillRule !== object.fillRule ||
        !Object.is(cached.tolerance, requiredTolerance)) {
      const flattened = flattenFabricPath(object.path, {
        tolerance: requiredTolerance,
        fillRule: object.fillRule,
        budget
      });
      if (!flattened.geometry) {
        deleteStrokeGeometryCacheEntry(record.id);
        return { query: null, reason: flattened.reason };
      }
      cached = {
        displayPathData,
        pathCommands: object.path,
        fillRule: object.fillRule,
        tolerance: flattened.geometry.tolerance,
        geometry: flattened.geometry,
        centerlinePathData: null,
        centerlineSize: null,
        centerlineSourceGeometry: null,
        centerline: null
      };
      storeStrokeGeometryCacheEntry(record.id, cached);
    } else {
      if (!budget.consume(cached.geometry.logicalBuildCost || 0)) {
        return { query: null, reason: 'selection-complexity-limit-exceeded' };
      }
      touchStrokeGeometryCacheEntry(record.id, cached);
    }
    const query = createPathFillQuery(cached.geometry, budget);
    return {
      query,
      reason: query
        ? null
        : budget.limitExceeded
          ? 'selection-complexity-limit-exceeded'
          : 'selection-geometry-unavailable'
    };
  }

  // 일치하는 생성 규약을 돌려준다. 못 찾으면 null.
  // 조각을 다시 만들 때도 같은 규약을 써야 도형·펜의 생김새가 바뀌지 않는다.
  function resolveStrokeGeometryOptions(record, budget) {
    if (!record || !Array.isArray(record.sourcePoints) || !record.pathData) return null;
    const logicalCost = record.sourcePoints.length * 2 +
      Math.ceil(record.pathData.length / 8);
    for (const candidate of STROKE_GEOMETRY_CANDIDATES) {
      if (!budget?.consume(logicalCost)) return null;
      let canonical;
      try {
        canonical = strokePathFactory(record.sourcePoints, {
          size: record.style?.size,
          last: true,
          alreadyNormalizedPressure: true,
          start: { cap: record.strokeCaps?.start !== false },
          end: { cap: record.strokeCaps?.end !== false },
          ...(candidate || null)
        });
      } catch (_error) {
        return null;
      }
      if (canonical?.pathData === record.pathData) return candidate || {};
    }
    return null;
  }

  function sourceGeometryMatches(signature, sourcePoints) {
    if (!Array.isArray(signature) || signature.length !== sourcePoints.length * 3) return false;
    for (let index = 0; index < sourcePoints.length; index += 1) {
      const point = sourcePoints[index];
      const offset = index * 3;
      if (!Object.is(signature[offset], point.x) ||
          !Object.is(signature[offset + 1], point.y) ||
          !Object.is(signature[offset + 2], point.pressure)) {
        return false;
      }
    }
    return true;
  }

  function captureSourceGeometry(sourcePoints) {
    return Object.freeze(sourcePoints.flatMap(point => [
      point.x,
      point.y,
      point.pressure
    ]));
  }

  function createStoredCenterline(record, budget) {
    const cached = strokeFillGeometryCache.get(record.id);
    if (!cached) return { geometry: null, reason: 'selection-geometry-unavailable' };
    if (!budget.consume(record.sourcePoints.length)) {
      return { geometry: null, reason: 'selection-complexity-limit-exceeded' };
    }
    const centerlineSize = Number(record.style?.size);
    if (cached.centerline &&
        cached.centerlinePathData === record.pathData &&
        Object.is(cached.centerlineSize, centerlineSize) &&
        sourceGeometryMatches(cached.centerlineSourceGeometry, record.sourcePoints)) {
      if (!budget.consume(cached.centerline.logicalBuildCost || 0)) {
        return { geometry: null, reason: 'selection-complexity-limit-exceeded' };
      }
      return { geometry: cached.centerline, reason: null };
    }
    const built = createSmoothedCenterlineGeometry(record.sourcePoints, {
      size: record.style?.size,
      streamline: 0.5,
      last: true,
      budget
    });
    if (!built.geometry) return built;
    deleteStrokeGeometryCacheEntry(record.id);
    cached.centerlinePathData = record.pathData;
    cached.centerlineSize = centerlineSize;
    cached.centerlineSourceGeometry = captureSourceGeometry(record.sourcePoints);
    cached.centerline = built.geometry;
    storeStrokeGeometryCacheEntry(record.id, cached);
    return built;
  }

  function componentBoundarySegments(component) {
    return (component?.contours || []).flatMap(contour => contour.map((start, index) => ({
      start,
      end: contour[(index + 1) % contour.length]
    })));
  }

  function projectFillComponentToSourceIntervals(
    component,
    centerline,
    budget
  ) {
    const onCenterline = centerlineIntervalsInsideComponent(component, centerline, {
      budget
    });
    if (onCenterline.reason) return { interval: null, reason: onCenterline.reason };
    let sourceIntervals = onCenterline.intervals;
    if (sourceIntervals.length === 0) {
      const projected = projectRetainedBoundaryToSourceIntervals(
        componentBoundarySegments(component),
        centerline,
        { budget, distanceTolerance: 0.25 }
      );
      if (projected.reason) return { intervals: null, reason: projected.reason };
      sourceIntervals = projected.intervals;
    }
    if (sourceIntervals.length === 0) {
      return { intervals: null, reason: 'selection-geometry-unavailable' };
    }
    return { intervals: sourceIntervals, reason: null };
  }

  function sourceIntervalsFormExactPartition(projections, budget) {
    const partition = [];
    for (const projection of projections) {
      for (const interval of projection.intervals || []) {
        if (!budget.consume()) {
          return {
            exact: false,
            reason: 'selection-complexity-limit-exceeded'
          };
        }
        partition.push(interval);
      }
    }
    const sortCost = partition.length *
      (Math.ceil(Math.log2(partition.length + 1)) + 2);
    if (!budget.consume(sortCost)) {
      return {
        exact: false,
        reason: 'selection-complexity-limit-exceeded'
      };
    }
    partition.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let coveredUntil = 0;
    for (const interval of partition) {
      if (!budget.consume()) {
        return {
          exact: false,
          reason: 'selection-complexity-limit-exceeded'
        };
      }
      if (Math.abs(interval[0] - coveredUntil) > SOURCE_INTERVAL_EPSILON ||
          interval[1] <= coveredUntil + SOURCE_INTERVAL_EPSILON) {
        return { exact: false, reason: null };
      }
      coveredUntil = interval[1];
    }
    return {
      exact: Math.abs(coveredUntil - 1) <= SOURCE_INTERVAL_EPSILON,
      reason: null
    };
  }

  function centerlineIsStrictlyChordMonotone(centerline, budget) {
    const points = centerline?.points;
    const segments = centerline?.segments;
    if (!Array.isArray(points) || points.length < 2 ||
        !Array.isArray(segments) || segments.length === 0) {
      return {
        monotone: false,
        reason: 'selection-geometry-unavailable'
      };
    }
    const first = points[0];
    const last = points.at(-1);
    const chordX = last.x - first.x;
    const chordY = last.y - first.y;
    const chordLength = Math.hypot(chordX, chordY);
    if (!Number.isFinite(chordLength) || chordLength <= SOURCE_INTERVAL_EPSILON) {
      return {
        monotone: false,
        reason: Number.isFinite(chordLength)
          ? null
          : 'selection-geometry-unavailable'
      };
    }
    const axisX = chordX / chordLength;
    const axisY = chordY / chordLength;
    for (const segment of segments) {
      if (!budget.consume()) {
        return {
          monotone: false,
          reason: 'selection-complexity-limit-exceeded'
        };
      }
      const sourceProgress =
        segment.end.sourcePosition - segment.start.sourcePosition;
      const chordProgress =
        (segment.end.x - segment.start.x) * axisX +
        (segment.end.y - segment.start.y) * axisY;
      if (!Number.isFinite(sourceProgress) ||
          !Number.isFinite(chordProgress) ||
          sourceProgress < -SOURCE_INTERVAL_EPSILON) {
        return {
          monotone: false,
          reason: 'selection-geometry-unavailable'
        };
      }
      if (chordProgress <= SOURCE_INTERVAL_EPSILON) {
        return { monotone: false, reason: null };
      }
    }
    return { monotone: true, reason: null };
  }

  function sourceEnvelopesCoverSourceDomain(planned, budget) {
    const envelopes = planned.map(projection => projection.envelope);
    const sortCost = envelopes.length *
      (Math.ceil(Math.log2(envelopes.length + 1)) + 2);
    if (!budget.consume(sortCost)) {
      return {
        covered: false,
        reason: 'selection-complexity-limit-exceeded'
      };
    }
    envelopes.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    let coveredUntil = 0;
    for (const envelope of envelopes) {
      if (!budget.consume()) {
        return {
          covered: false,
          reason: 'selection-complexity-limit-exceeded'
        };
      }
      if (envelope[0] > coveredUntil + SOURCE_INTERVAL_EPSILON) {
        return { covered: false, reason: null };
      }
      coveredUntil = Math.max(coveredUntil, envelope[1]);
    }
    return {
      covered: coveredUntil >= 1 - SOURCE_INTERVAL_EPSILON,
      reason: null
    };
  }

  function bridgeHiddenSourceEnvelopeGaps(planned, budget) {
    if (planned.length === 0 ||
        planned.some(projection => projection.maskedSource !== true)) {
      return { bridged: false, reason: null };
    }
    const sortCost = planned.length *
      (Math.ceil(Math.log2(planned.length + 1)) + 2);
    if (!budget.consume(sortCost)) {
      return {
        bridged: false,
        reason: 'selection-complexity-limit-exceeded'
      };
    }
    const ordered = [...planned].sort((left, right) => (
      left.envelope[0] - right.envelope[0] ||
      left.envelope[1] - right.envelope[1]
    ));
    let coverageOwner = ordered[0];
    coverageOwner.envelope[0] = 0;
    let coveredUntil = coverageOwner.envelope[1];
    for (let index = 1; index < ordered.length; index += 1) {
      if (!budget.consume()) {
        return {
          bridged: false,
          reason: 'selection-complexity-limit-exceeded'
        };
      }
      const current = ordered[index];
      if (current.envelope[0] > coveredUntil + SOURCE_INTERVAL_EPSILON) {
        const boundary = (coveredUntil + current.envelope[0]) / 2;
        coverageOwner.envelope[1] = boundary;
        current.envelope[0] = boundary;
      }
      if (current.envelope[1] > coveredUntil) {
        coverageOwner = current;
        coveredUntil = current.envelope[1];
      }
    }
    coverageOwner.envelope[1] = 1;
    return { bridged: true, reason: null };
  }

  function bridgeUnambiguousComponentIntervals(projections, budget) {
    const planned = [];
    for (const projection of projections) {
      const intervals = projection.intervals;
      if (!Array.isArray(intervals) || intervals.length === 0 ||
          intervals.some((interval, index) => (
            !Array.isArray(interval) ||
            !Number.isFinite(interval[0]) ||
            !Number.isFinite(interval[1]) ||
            interval[0] < -SOURCE_INTERVAL_EPSILON ||
            interval[1] > 1 + SOURCE_INTERVAL_EPSILON ||
            interval[1] - interval[0] <= SOURCE_INTERVAL_EPSILON ||
            (index > 0 &&
              interval[0] < intervals[index - 1][1] - SOURCE_INTERVAL_EPSILON)
          ))) {
        return { projections: null, reason: 'selection-geometry-unavailable' };
      }
      if (!budget.consume(intervals.length + 1)) {
        return { projections: null, reason: 'selection-complexity-limit-exceeded' };
      }
      planned.push({
        ...projection,
        envelope: [intervals[0][0], intervals.at(-1)[1]]
      });
    }

    const wrapped = planned.filter(projection => projection.intervals.length > 1);
    const partition = sourceIntervalsFormExactPartition(planned, budget);
    if (partition.reason) {
      return { projections: null, reason: partition.reason };
    }
    const requiresEnvelopeBridge = wrapped.length > 0 || !partition.exact;
    if (requiresEnvelopeBridge) {
      const centerline = planned[0]?.centerline;
      if (!centerline ||
          planned.some(projection => projection.centerline !== centerline)) {
        return { projections: null, reason: 'selection-geometry-unavailable' };
      }
      const monotone = centerlineIsStrictlyChordMonotone(centerline, budget);
      if (monotone.reason) {
        return { projections: null, reason: monotone.reason };
      }
      if (!monotone.monotone) {
        return {
          projections: null,
          reason: 'selection-nonmonotone-centerline'
        };
      }
      const coverage = sourceEnvelopesCoverSourceDomain(planned, budget);
      if (coverage.reason) {
        return { projections: null, reason: coverage.reason };
      }
      if (!coverage.covered) {
        const hiddenBridge = bridgeHiddenSourceEnvelopeGaps(planned, budget);
        if (hiddenBridge.reason) {
          return { projections: null, reason: hiddenBridge.reason };
        }
        if (!hiddenBridge.bridged) {
          return { projections: null, reason: 'selection-geometry-unavailable' };
        }
        const bridgedCoverage = sourceEnvelopesCoverSourceDomain(planned, budget);
        if (bridgedCoverage.reason) {
          return { projections: null, reason: bridgedCoverage.reason };
        }
        if (!bridgedCoverage.covered) {
          return { projections: null, reason: 'selection-geometry-unavailable' };
        }
      }
    }

    for (const projection of planned) {
      const sourceIntervals = requiresEnvelopeBridge
        ? [projection.envelope]
        : projection.intervals;
      const intervals = sourceIntervalsToIndexIntervals(sourceIntervals, projection.centerline);
      if (!Array.isArray(intervals) || intervals.length !== 1) {
        return { projections: null, reason: 'selection-geometry-unavailable' };
      }
      projection.interval = intervals[0];
    }
    return { projections: planned, reason: null };
  }

  function groupProjectedComponentsBySourceInterval(projections, budget) {
    const sortCost = projections.length *
      (Math.ceil(Math.log2(projections.length + 1)) + 2);
    if (!budget.consume(sortCost)) {
      return {
        groups: null,
        reason: 'selection-complexity-limit-exceeded'
      };
    }
    const ordered = [...projections].sort((left, right) => (
      Number(left.selected) - Number(right.selected) ||
      left.interval[0] - right.interval[0] ||
      left.interval[1] - right.interval[1]
    ));
    const groups = [];
    for (const projection of ordered) {
      if (!budget.consume()) {
        return {
          groups: null,
          reason: 'selection-complexity-limit-exceeded'
        };
      }
      const previous = groups.at(-1);
      if (previous &&
          previous.selected === projection.selected &&
          projection.interval[0] <=
            previous.interval[1] + SOURCE_INTERVAL_EPSILON) {
        previous.interval[1] = Math.max(
          previous.interval[1],
          projection.interval[1]
        );
        previous.components.push(projection.component);
        continue;
      }
      groups.push({
        selected: projection.selected,
        interval: [...projection.interval],
        components: [projection.component]
      });
    }
    return { groups, reason: null };
  }

  function applySourceTransformToFragment(path, sourceObject) {
    if (!sourceObject) return true;
    const sourceTransform = captureTransform(sourceObject);
    if (!sourceObject.calcTransformMatrix) {
      path.set(sourceTransform);
      path.setCoords?.();
      return true;
    }
    const inheritedTransform = {};
    for (const field of TRANSFORM_FIELDS) {
      if (field !== 'left' && field !== 'top') inheritedTransform[field] = sourceTransform[field];
    }
    path.set(inheritedTransform);

    const { Point, util } = resolveFabric();
    if (!path.pathOffset || !sourceObject.pathOffset || !path.setPositionByOrigin ||
        !Point || !util?.transformPoint) {
      return false;
    }
    const sourceMatrix = sourceObject.calcTransformMatrix();
    const fragmentCenter = util.transformPoint(new Point(
      finiteNumber(path.pathOffset.x) - finiteNumber(sourceObject.pathOffset.x),
      finiteNumber(path.pathOffset.y) - finiteNumber(sourceObject.pathOffset.y)
    ), sourceMatrix);
    if (!Number.isFinite(Number(fragmentCenter?.x)) ||
        !Number.isFinite(Number(fragmentCenter?.y))) {
      return false;
    }
    path.setPositionByOrigin(fragmentCenter, 'center', 'center');
    path.setCoords?.();
    return true;
  }

  function compactOutlineSourcePoints(sourcePoints, budget) {
    if (!Array.isArray(sourcePoints) || sourcePoints.length < 2) {
      return { points: null, reason: 'selection-geometry-unavailable' };
    }
    if (!budget.consume(sourcePoints.length)) {
      return { points: null, reason: 'selection-complexity-limit-exceeded' };
    }
    const first = sourcePoints[0];
    let furthest = sourcePoints.at(-1);
    let furthestDistance = -1;
    for (let index = 1; index < sourcePoints.length; index += 1) {
      const candidate = sourcePoints[index];
      const dx = finiteNumber(candidate.x) - finiteNumber(first.x);
      const dy = finiteNumber(candidate.y) - finiteNumber(first.y);
      const distance = dx * dx + dy * dy;
      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthest = candidate;
      }
    }
    return {
      points: [clonePlain(first), clonePlain(furthest)],
      reason: null
    };
  }

  function createCompactOutlineComponentPlans(
    record,
    remainingComponents,
    selectedComponents,
    budget
  ) {
    const support = compactOutlineSourcePoints(record.sourcePoints, budget);
    if (!support.points || support.reason) {
      return { plans: null, reason: support.reason };
    }
    const plans = [];
    for (const group of [
      { selected: false, components: remainingComponents },
      { selected: true, components: selectedComponents }
    ]) {
      const contourCount = group.components.reduce(
        (count, component) => count + (component?.contours?.length || 0),
        0
      );
      if (!budget.consume(group.components.length + contourCount + 1)) {
        return {
          plans: null,
          reason: 'selection-complexity-limit-exceeded'
        };
      }
      const renderPathData = contourPathData(
        group.components.flatMap(component => component.contours)
      );
      if (!renderPathData ||
          renderPathData.length > MAX_PERSISTENCE_STRING_LENGTH) {
        return { plans: null, reason: 'selection-geometry-unavailable' };
      }
      plans.push({
        selected: group.selected,
        points: support.points.map(point => clonePlain(point)),
        interval: [0, record.sourcePoints.length - 1],
        caps: { start: false, end: false },
        renderGeometry: {
          version: 1,
          pathData: renderPathData,
          fillRule: 'evenodd'
        }
      });
    }
    return { plans, reason: null };
  }

  // 본체 레코드에서 외곽선 레코드를 만든다. 굵기만 키우고 색을 바꾼 같은 획이다.
  // geometryOptions 는 본체를 만든 생성 규약이어야 한다 — 도형·펜은 브러시와 다르다.
  // 조각의 외곽선 기하. 본체와 같은 중심선으로 굵은 획을 만든 뒤 **같은 폴리곤으로**
  // 잘라, 조각이 실제로 남은 자리에만 테두리가 남게 한다. 마지막에 본체 조각 윤곽을
  // 합쳐 evenodd 로 칠하면 겹침이 상쇄돼 고리가 된다(불투명도 이중 합성 방지).
  //
  // 여기서 실패해도 본체 분할은 그대로 성공해야 한다. 예산은 본체와 **따로** 두되
  // 조각들이 **함께** 쓴다 — 조각마다 새 예산을 주면 512조각에서 설정 한도의
  // 수백 배를 동기로 돌아 손을 떼는 순간 오버레이가 멈춘다.
  // 어느 단계든 어긋나면 null 을 돌려 그 조각만 외곽선 없이 남긴다.
  function buildClippedOutlineRenderGeometry(plan, record, spec, sourceSelection, geometryOptions, budget) {
    if (!plan?.renderGeometry?.pathData || !Array.isArray(plan.points) || plan.points.length < 2) {
      return null;
    }
    if (!budget || budget.limitExceeded) return null;
    const size = finiteNumber(record.style?.size, DEFAULT_BRUSH_STYLE.size) + 2 * spec.width;
    let strokeData;
    try {
      strokeData = strokePathFactory(plan.points, {
        size,
        last: true,
        alreadyNormalizedPressure: true,
        start: { cap: plan.caps?.start !== false },
        end: { cap: plan.caps?.end !== false },
        ...(geometryOptions || null)
      });
    } catch (_error) {
      return null;
    }
    if (!strokeData?.pathData) return null;

    let outlineContour = null;
    try {
      const probe = makeFabricPath({
        id: null,
        pathData: strokeData.pathData,
        style: { ...record.style, size }
      }, true);
      const maximumScale = Math.max(1e-9, finiteNumber(sourceSelection?.maximumScale, 1));
      const flattened = flattenFabricPath(probe.path, {
        tolerance: Math.max(Number.EPSILON, Math.min(0.25, 0.25 / maximumScale)),
        fillRule: probe.fillRule,
        budget
      });
      if (!flattened.geometry) return null;
      const query = createPathFillQuery(flattened.geometry, budget);
      if (!query) return null;
      const clipped = clipSimplePathFillPair(query, sourceSelection.query, {
        budget,
        polygonValidated: true
      });
      const side = plan.selected ? clipped.intersection : clipped.difference;
      if (!side || side.reason || side.components.length === 0) return null;
      // 감기 방향을 뒤집어 본체 자리만 상쇄되게 한다(evenodd 는 외곽선 자기 겹침까지 지운다).
      outlineContour = contourPathData(
        side.components.flatMap(component =>
          component.contours.map(contour => [...contour].reverse()))
      );
    } catch (_error) {
      return null;
    }
    if (!outlineContour) return null;

    const ringPathData = `${outlineContour} ${plan.renderGeometry.pathData}`;
    if (ringPathData.length > MAX_PERSISTENCE_STRING_LENGTH) return null;
    return {
      pathData: strokeData.pathData,
      renderGeometry: { version: 1, pathData: ringPathData, fillRule: 'nonzero' }
    };
  }

  // 조각 본체에서 외곽선 짝 레코드를 만든다. 기하는 이미 잘라 둔 것을 쓴다.
  function makeOutlineFragmentRecord(fragment, spec, outlineGeometry, sourceOutlineObject) {
    const id = outlineIdFor(fragment?.id);
    if (!id || !outlineGeometry?.renderGeometry || !outlineGeometry.pathData) return null;
    const size = finiteNumber(fragment.style?.size, DEFAULT_BRUSH_STYLE.size) + 2 * spec.width;
    const derived = {
      id,
      type: 'stroke',
      pathData: outlineGeometry.pathData,
      sourcePoints: clonePlain(fragment.sourcePoints),
      style: { ...fragment.style, color: spec.color, size },
      renderGeometry: clonePlain(outlineGeometry.renderGeometry)
    };
    if (fragment.strokeCaps) derived.strokeCaps = clonePlain(fragment.strokeCaps);
    // 본체 조각의 transform 을 베끼면 안 된다. 잘라 낸 고리는 pathOffset·바운딩 박스
    // 중심이 본체 조각과 달라서, 같은 값을 주면 두 **오브젝트 중심**이 맞춰질 뿐
    // 소스 좌표가 어긋난다. 본체 조각과 똑같이 자기 경로에서 자연 위치를 뽑고
    // 원본 외곽선의 변형을 얹는다.
    try {
      const path = makeFabricPath(derived);
      if (!applySourceTransformToFragment(path, sourceOutlineObject)) return null;
      derived.transform = captureTransform(path);
    } catch (_error) {
      return null;
    }
    return derived;
  }

  function deriveOutlineRecord(record, outline, geometryOptions = null) {
    if (outline?.enabled !== true) return null;
    const id = outlineIdFor(record?.id);
    if (!id || !Array.isArray(record.sourcePoints) || record.sourcePoints.length === 0) return null;
    const width = boundedInteger(
      outline.width,
      MIN_OUTLINE_WIDTH,
      MAX_OUTLINE_WIDTH,
      DEFAULT_OUTLINE_WIDTH
    );
    const size = finiteNumber(record.style?.size, DEFAULT_BRUSH_STYLE.size) + 2 * width;
    let strokeData;
    try {
      strokeData = strokePathFactory(record.sourcePoints, {
        size,
        last: true,
        alreadyNormalizedPressure: true,
        start: { cap: record.strokeCaps?.start !== false },
        end: { cap: record.strokeCaps?.end !== false },
        ...(geometryOptions || null)
      });
    } catch (_error) {
      return null;
    }
    if (!strokeData?.pathData) return null;
    // 외곽선은 본체를 통째로 덮는 **채워진** 경로다. 그대로 두면 불투명도가 1 미만일 때
    // 두 층이 따로 합성돼 중심이 두 번 칠해지고(50% 두 층 = 75%) 외곽선 색이 본체
    // 색으로 번진다. 본체 윤곽을 같은 경로에 합쳐 **고리**로 만들어 그 겹침을 없앤다.
    // renderGeometry 는 이미 허용된 선택 키라 저장 스키마는 그대로다.
    //
    // evenodd 로 칠하면 안 된다. 획이 되짚어 본체 두 구간은 떨어져 있는데 굵은
    // 외곽선끼리만 겹치는 자리에서, evenodd 는 그 **외곽선 자기 겹침까지 상쇄해**
    // 구멍을 낸다(기하 프로브로 실측). 본체 위에 덮이지도 않는 자리라 그대로 뚫린다.
    // 대신 외곽선 윤곽을 뒤집어 감기 방향을 반대로 두고 nonzero 로 칠한다 —
    // 본체 자리만 상쇄되고 외곽선 자기 겹침은 그대로 채워진다.
    const ringPathData = `${outlineToPathData([...strokeData.outline].reverse())} ${record.pathData}`;
    const derived = {
      id,
      type: 'stroke',
      pathData: strokeData.pathData,
      // strokeData.sourcePoints 가 아니라 본체 것을 복사한다 — 재생성이 멱등해야
      // 조각을 다시 자를 때도 같은 외곽선이 나온다.
      sourcePoints: clonePlain(record.sourcePoints),
      style: { ...record.style, color: outline.color || DEFAULT_OUTLINE_COLOR, size }
    };
    if (record.strokeCaps) derived.strokeCaps = clonePlain(record.strokeCaps);
    // 합친 경로가 저장 한도를 넘으면 고리를 만들 수 없다. 그때 채워진 판으로
    // 두면 불투명도 1 미만에서 중심이 두 번 칠해지고 색이 번진다 — 그 상태를
    // 남기느니 **외곽선을 붙이지 않는다.** 덜 그리는 쪽이 틀리게 그리는 쪽보다 낫다.
    if (ringPathData.length > MAX_PERSISTENCE_STRING_LENGTH) return null;
    derived.renderGeometry = {
      version: 1,
      pathData: ringPathData,
      fillRule: 'nonzero'
    };
    // 본체 transform 을 그대로 베끼면 안 된다. 외곽선은 더 굵어 pathData 의
    // pathOffset·바운딩 박스 중심이 본체와 다르고, 같은 transform 을 주면 두
    // **오브젝트 중심**이 맞춰질 뿐 소스 좌표가 어긋난다. 압력이 실린 획이나
    // 좌우 비대칭 획에서 처음 그릴 때부터 눈에 띄게 밀린다.
    // 본체와 똑같이 자기 경로에서 자연 위치를 뽑는다.
    derived.transform = captureTransform(makeFabricPath(derived));
    return derived;
  }

  function createStrokeFragment(
    record,
    points,
    selected,
    caps = {},
    sourceObject = null,
    renderGeometry = null,
    geometryOptions = null
  ) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let strokeData;
    try {
      strokeData = strokePathFactory(points, {
        size: record.style?.size,
        last: true,
        alreadyNormalizedPressure: true,
        start: { cap: caps.start !== false },
        end: { cap: caps.end !== false },
        // 원본이 도형·펜이면 브러시 기본값으로 다시 만들면 안 된다.
        ...(geometryOptions || null)
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
    if (renderGeometry) fragment.renderGeometry = clonePlain(renderGeometry);
    try {
      const path = makeFabricPath(fragment);
      if (!applySourceTransformToFragment(path, sourceObject)) return null;
      fragment.transform = captureTransform(path);
      return fragment;
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      return null;
    }
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
    const previousPendingSelection = pendingLassoSelection;
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
    if (previousPendingSelection) {
      if (pendingLassoSelection !== previousPendingSelection ||
          !pendingLassoIsFresh(previousPendingSelection)) {
        for (const object of fragmentFabricObjects.values()) fabricCanvas.remove(object);
        if (pendingLassoSelection === previousPendingSelection) {
          abortPendingLassoSelection({ authoritative: true });
        }
        return { staged: false, reason: 'stale-pending-lasso' };
      }
      abortPendingLassoSelection();
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

    const pendingFabricObjects = new Set(pending.fragmentFabricObjects?.values() || []);
    for (const object of [...fabricCanvas.getObjects()]) {
      if (pendingFabricObjects.has(object)) fabricCanvas.remove(object);
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
    // 선택된 조각을 버릴 때 그 조각의 외곽선도 함께 버려야 한다. 외곽선 id 는
    // 선택 집합에 없으므로(외곽선은 선택 대상이 아니다) 짝을 보고 걸러야 한다.
    const dropsFragment = object => pending.selectedFragmentIds.has(object.id) ||
      pending.selectedFragmentIds.has(bodyIdFor(object.id));
    const replacements = pending.replacements.map(replacement => ({
      removeId: replacement.removeId,
      addObjects: replacement.addObjects.filter(object => !dropsFragment(object))
    }));
    const replacementSourceIds = new Set(replacements.map(replacement => replacement.removeId));
    const snapshotIds = new Set(
      (sceneStore.getActiveSceneSnapshot()?.objects || []).map(object => object.id)
    );
    for (const id of pending.selectedPersistedIds) {
      if (!replacementSourceIds.has(id)) {
        replacements.push({ removeId: id, addObjects: [] });
        replacementSourceIds.add(id);
      }
      // 통째로 덮인 획은 selectedPersistedIds 로만 들어와 짝이 확장 목록에 없다.
      // replaceObjects 는 짝을 알아서 지우지 않으므로 여기서 함께 넣지 않으면
      // 그 획의 외곽선이 고아로 남아 화면에 그대로 보인다.
      const outlineId = outlineIdFor(id);
      if (outlineId && snapshotIds.has(outlineId) && !replacementSourceIds.has(outlineId)) {
        replacements.push({ removeId: outlineId, addObjects: [] });
        replacementSourceIds.add(outlineId);
      }
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
    const objectsById = new Map(
      fabricCanvas.getObjects()
        .filter(object => ids.has(object.__baeframeObjectId))
        .map(object => [object.__baeframeObjectId, object])
    );
    const objects = objectIds.map(id => objectsById.get(id)).filter(Boolean);
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      const selected = ids.has(object.__baeframeObjectId) &&
        !sceneStore.isDerivedOutline(object.__baeframeObjectId);
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

  function restoreSelectionContext(context) {
    const currentSelectedIds = sceneStore.getActiveSceneSnapshot()?.selectedObjectIds || [];
    if (!context ||
        context.sessionId !== currentSession?.sessionId ||
        context.inputRevision !== tokenState.inputRevision ||
        context.mutationCount !== sceneStore.getDiagnostics().mutationCount) {
      if (context?.pendingSelection &&
          pendingLassoSelection === context.pendingSelection &&
          !pendingLassoIsFresh(context.pendingSelection)) {
        abortPendingLassoSelection({ authoritative: true });
        return [...(sceneStore.getActiveSceneSnapshot()?.selectedObjectIds || [])];
      }
      return [...currentSelectedIds];
    }
    if (context.pendingSelection &&
        (pendingLassoSelection !== context.pendingSelection ||
         !pendingLassoIsFresh(context.pendingSelection))) {
      return [...currentSelectedIds];
    }
    const existingIds = new Set(
      fabricCanvas?.getObjects()
        .map(object => object.__baeframeObjectId)
        .filter(Boolean) || []
    );
    if (context.objectIds.some(id => !existingIds.has(id))) {
      return [...currentSelectedIds];
    }
    activateObjectIds(context.objectIds);
    return [...context.objectIds];
  }

  function retireReplacedPendingSelection(context) {
    const replacedPendingSelection = context?.pendingSelection;
    if (!replacedPendingSelection ||
        pendingLassoSelection !== replacedPendingSelection) {
      return false;
    }
    return abortPendingLassoSelection();
  }

  function rectanglePolygon(start, end) {
    if (!start || !end) return [];
    return [
      { x: start.x, y: start.y },
      { x: end.x, y: start.y },
      { x: end.x, y: end.y },
      { x: start.x, y: end.y }
    ];
  }

  function finalizeWholeStrokeSelectionPolygon(polygon, failureSelectionContext = null) {
    if (polygon.length < 3 || !polygonHasArea(polygon, 1)) {
      const restoredSelectionIds = restoreSelectionContext(failureSelectionContext);
      return {
        applied: false,
        reason: 'lasso-too-small',
        selectedObjectIds: restoredSelectionIds
      };
    }

    const snapshot = sceneStore.getActiveSceneSnapshot();
    const canvasObjects = new Map(
      fabricCanvas.getObjects()
        .filter(object => object.__baeframeObjectId)
        .map(object => [object.__baeframeObjectId, object])
    );
    const polygonBounds = boundsForPoints(polygon);
    const selectedObjectIds = [];
    const geometryBudget = createGeometryBudget(maxSelectionGeometryOperations);
    const fail = reason => {
      const restoredSelectionIds = restoreSelectionContext(failureSelectionContext);
      return {
        applied: false,
        reason,
        selectedObjectIds: restoredSelectionIds
      };
    };
    const selectedIdSet = new Set();
    for (const record of snapshot?.objects || []) {
      if (record.type !== 'stroke') continue;
      // 외곽선은 본체보다 최대 20px 더 뻗는다. 후보에서 통째로 빼면 눈에 보이는
      // 그 테두리를 집어도 아무것도 안 잡힌다. 판정은 하되 **결과를 짝인 본체로
      // 돌린다.** 짝을 잃은 고아는 평범한 획이라 자기 자신이 대상이다.
      const targetId = sceneStore.isDerivedOutline(record.id)
        ? bodyIdFor(record.id)
        : record.id;
      if (!targetId || selectedIdSet.has(targetId)) continue;
      const maximumRadius = Math.max(1, finiteNumber(record.style?.size, 1)) * 0.825;
      const object = canvasObjects.get(record.id);
      if (!boundsIntersect(strokeObjectSceneBounds(record, object, maximumRadius), polygonBounds)) {
        continue;
      }
      const sourceSelection = createSourcePolygonQuery(object, polygon, geometryBudget);
      if (!sourceSelection.query || sourceSelection.reason) {
        return fail(sourceSelection.reason || 'selection-geometry-unavailable');
      }
      const fillSelection = createStoredPathFillQuery(
        record,
        object,
        sourceSelection,
        geometryBudget
      );
      if (!fillSelection.query || fillSelection.reason) {
        return fail(fillSelection.reason || 'selection-geometry-unavailable');
      }
      const touch = pathFillOverlapsPolygon(
        fillSelection.query,
        sourceSelection.query,
        geometryBudget
      );
      if (touch.limitExceeded) {
        return fail('selection-complexity-limit-exceeded');
      }
      if (touch.hit) {
        selectedIdSet.add(targetId);
        selectedObjectIds.push(targetId);
      }
    }

    retireReplacedPendingSelection(failureSelectionContext);
    activateObjectIds(selectedObjectIds);
    return { applied: false, selectedObjectIds };
  }

  function finalizePartialSelectionPolygon(polygon, failureSelectionContext = null) {
    if (polygon.length < 3 || !polygonHasArea(polygon, 1)) {
      const restoredSelectionIds = restoreSelectionContext(failureSelectionContext);
      return {
        applied: false,
        reason: 'lasso-too-small',
        selectedObjectIds: restoredSelectionIds
      };
    }

    const snapshot = sceneStore.getActiveSceneSnapshot();
    const canvasObjects = new Map(
      fabricCanvas.getObjects()
        .filter(object => object.__baeframeObjectId)
        .map(object => [object.__baeframeObjectId, object])
    );
    // 짝인 외곽선 레코드를 찾기 위한 조회표.
    const recordsById = new Map((snapshot?.objects || []).map(object => [object.id, object]));
    const replacementPlans = [];
    const selectedPersistedIds = new Set();
    const polygonBounds = boundsForPoints(polygon);
    const sceneLimits = sceneStore.getDiagnostics();
    const geometryBudget = createGeometryBudget(maxSelectionGeometryOperations);
    // 외곽선 재생성 전용 예산. 본체와 분리해 외곽선이 실패해도 분할은 성공하게 하되,
    // 조각 전체가 하나를 나눠 써 총 작업량이 설정 한도를 넘지 않게 한다.
    const outlineGeometryBudget = createGeometryBudget(maxSelectionGeometryOperations);
    let accumulatedFragments = 0;
    let accumulatedOutlineFragments = 0;
    let accumulatedRemovedPairs = 0;
    const fail = reason => {
      const restoredSelectionIds = restoreSelectionContext(failureSelectionContext);
      return {
        applied: false,
        reason,
        selectedObjectIds: restoredSelectionIds
      };
    };
    const queueReplacementPlan = (
      record,
      object,
      componentPlans,
      geometryOptions,
      outlineSpec = null,
      outlineObject = null
    ) => {
      accumulatedFragments += componentPlans.length;
      // 외곽선 조각도 씬에 들어가는 오브젝트다. 세지 않으면 상한 근처에서 스테이징은
      // 통과하고 replaceObjects 가 scene-object-limit-exceeded 로 되돌린다.
      const outlineFragments = outlineSpec
        ? componentPlans.filter(plan => plan.outlineRenderGeometry).length
        : 0;
      // 짝인 낡은 외곽선도 함께 제거되므로 그만큼 자리가 빈다.
      const removedPairs = outlineSpec ? 1 : 0;
      accumulatedOutlineFragments += outlineFragments;
      accumulatedRemovedPairs += removedPairs;
      const projectedObjectCount = snapshot.objects.length -
        (replacementPlans.length + 1) - accumulatedRemovedPairs +
        accumulatedFragments + accumulatedOutlineFragments;
      if (accumulatedFragments > maxLassoFragments ||
          projectedObjectCount > sceneLimits.maxObjects) {
        return false;
      }
      replacementPlans.push({
        record,
        object,
        componentPlans,
        geometryOptions,
        outlineSpec,
        outlineObject
      });
      return true;
    };
    if (!validateSimpleContour(polygon, geometryBudget)) {
      return fail(geometryBudget.limitExceeded
        ? 'selection-complexity-limit-exceeded'
        : 'selection-geometry-unavailable');
    }

    for (const record of snapshot?.objects || []) {
      // 외곽선은 본체보다 굵어 같은 폴리곤으로 잘라도 조각 수가 어긋난다.
      // 후보에서 빼고, 본체가 잘릴 때 조각마다 다시 만든다.
      // 짝을 잃은 고아는 평범한 획이므로 그대로 잘릴 수 있어야 한다.
      if (record.type !== 'stroke' || sceneStore.isDerivedOutline(record.id)) continue;
      const maximumRadius = Math.max(1, finiteNumber(record.style?.size, 1)) * 0.825;
      const object = canvasObjects.get(record.id);
      if (!boundsIntersect(strokeObjectSceneBounds(record, object, maximumRadius), polygonBounds)) {
        continue;
      }
      const sourceSelection = createSourcePolygonQuery(object, polygon, geometryBudget);
      if (!sourceSelection.query || sourceSelection.reason) {
        return fail(sourceSelection.reason || 'selection-geometry-unavailable');
      }
      const fillSelection = createStoredPathFillQuery(
        record,
        object,
        sourceSelection,
        geometryBudget
      );
      if (!fillSelection.query || fillSelection.reason) {
        return fail(fillSelection.reason || 'selection-geometry-unavailable');
      }
      const touch = pathFillOverlapsPolygon(
        fillSelection.query,
        sourceSelection.query,
        geometryBudget
      );
      if (touch.limitExceeded) return fail('selection-complexity-limit-exceeded');
      if (!touch.hit) continue;
      const geometryOptions = resolveStrokeGeometryOptions(record, geometryBudget);
      if (!geometryOptions) {
        return fail(geometryBudget.limitExceeded
          ? 'selection-complexity-limit-exceeded'
          : 'selection-geometry-unavailable');
      }
      // 이 획에 살아 있는 외곽선이 있으면 어느 갈래로 가든 낡은 외곽선을 함께
      // 교체해야 한다. 안 그러면 고아가 남는다.
      const outlineSpec = outlineSpecFromPair(record, recordsById.get(outlineIdFor(record.id)));
      const queueWithOutlines = plans => {
        // 이미 한 번 잘린 조각(renderGeometry 를 쥔 본체)은 그 마스크를 다시 반영할
        // 방법이 없다. 중심선에서 새로 만든 외곽선은 앞서 지운 자리까지 되칠하므로
        // **다시 만들지 않는다** — 낡은 외곽선만 걷어내고 조각은 테두리 없이 남긴다.
        if (outlineSpec && record.renderGeometry === undefined) {
          for (const plan of plans) {
            plan.outlineRenderGeometry = buildClippedOutlineRenderGeometry(
              plan,
              record,
              outlineSpec,
              sourceSelection,
              geometryOptions,
              outlineGeometryBudget
            );
          }
        }
        return queueReplacementPlan(
          record,
          object,
          plans,
          geometryOptions,
          outlineSpec,
          canvasObjects.get(outlineIdFor(record.id)) || null
        );
      };
      if (!strokeHasSplittableLength(record.sourcePoints)) {
        selectedPersistedIds.add(record.id);
        continue;
      }
      const clipped = clipSimplePathFillPair(
        fillSelection.query,
        sourceSelection.query,
        {
          budget: geometryBudget,
          polygonValidated: true
        }
      );
      const remainingClip = clipped.difference;
      if (remainingClip.reason) return fail(remainingClip.reason);
      if (remainingClip.components.length === 0) {
        selectedPersistedIds.add(record.id);
        continue;
      }
      const selectedClip = clipped.intersection;
      if (selectedClip.reason) return fail(selectedClip.reason);
      if (selectedClip.components.length === 0) continue;
      if (record.renderGeometry !== undefined) {
        const compact = createCompactOutlineComponentPlans(
          record,
          remainingClip.components,
          selectedClip.components,
          geometryBudget
        );
        if (!compact.plans || compact.reason) {
          return fail(compact.reason || 'selection-geometry-unavailable');
        }
        if (!queueWithOutlines(compact.plans)) {
          return fail('lasso-fragment-limit-exceeded');
        }
        continue;
      }
      const centerline = createStoredCenterline(record, geometryBudget);
      if (!centerline.geometry || centerline.reason) {
        return fail(centerline.reason || 'selection-geometry-unavailable');
      }
      const projectedComponents = [];
      for (const group of [
        { selected: false, components: remainingClip.components },
        { selected: true, components: selectedClip.components }
      ]) {
        for (const component of group.components) {
          const projected = projectFillComponentToSourceIntervals(
            component,
            centerline.geometry,
            geometryBudget
          );
          if (!projected.intervals || projected.reason) {
            return fail(projected.reason || 'selection-geometry-unavailable');
          }
          projectedComponents.push({
            selected: group.selected,
            component,
            intervals: projected.intervals,
            centerline: centerline.geometry,
            maskedSource: record.renderGeometry !== undefined
          });
        }
      }
      const bridged = bridgeUnambiguousComponentIntervals(
        projectedComponents,
        geometryBudget
      );
      if (!bridged.projections || bridged.reason) {
        if (bridged.reason === 'selection-nonmonotone-centerline') {
          const compact = createCompactOutlineComponentPlans(
            record,
            remainingClip.components,
            selectedClip.components,
            geometryBudget
          );
          if (!compact.plans || compact.reason) {
            return fail(compact.reason || 'selection-geometry-unavailable');
          }
          if (!queueWithOutlines(compact.plans)) {
            return fail('lasso-fragment-limit-exceeded');
          }
          continue;
        }
        return fail(bridged.reason || 'selection-geometry-unavailable');
      }
      const grouped = groupProjectedComponentsBySourceInterval(
        bridged.projections,
        geometryBudget
      );
      if (!grouped.groups || grouped.reason) {
        return fail(grouped.reason || 'selection-geometry-unavailable');
      }
      const componentPlans = [];
      for (const projected of grouped.groups) {
        const sliced = splitStrokePointsBySourceIntervals(
          record.sourcePoints,
          [projected.interval],
          {
            budget: geometryBudget,
            maxRuns: 3,
            retainSubunitRuns: true
          }
        );
        if (sliced.limitExceeded) {
          return fail(sliced.limitReason === 'operations'
            ? 'selection-complexity-limit-exceeded'
            : 'lasso-fragment-limit-exceeded');
        }
        if (sliced.geometryUnavailable ||
            sliced.inside.length !== 1 ||
              sliced.inside[0].length < 2) {
          return fail('selection-geometry-unavailable');
        }
        const renderPathData = contourPathData(
          projected.components.flatMap(component => component.contours)
        );
        if (!renderPathData ||
            renderPathData.length > MAX_PERSISTENCE_STRING_LENGTH) {
          return fail('selection-geometry-unavailable');
        }
        const originalCaps = record.strokeCaps || { start: true, end: true };
        componentPlans.push({
          selected: projected.selected,
          points: sliced.inside[0],
          interval: projected.interval,
          caps: {
            start: projected.interval[0] <= 1e-7
              ? originalCaps.start !== false
              : false,
            end: projected.interval[1] >= record.sourcePoints.length - 1 - 1e-7
              ? originalCaps.end !== false
              : false
          },
          renderGeometry: {
            version: 1,
            pathData: renderPathData,
            fillRule: 'evenodd'
          }
        });
      }
      let totalPlannedPoints = componentPlans.reduce(
        (count, plan) => count + plan.points.length,
        0
      );
      if (totalPlannedPoints >
          record.sourcePoints.length + componentPlans.length * 2) {
        const compact = createCompactOutlineComponentPlans(
          record,
          remainingClip.components,
          selectedClip.components,
          geometryBudget
        );
        if (!compact.plans || compact.reason) {
          return fail(compact.reason || 'selection-geometry-unavailable');
        }
        componentPlans.splice(0, componentPlans.length, ...compact.plans);
        totalPlannedPoints = componentPlans.reduce(
          (count, plan) => count + plan.points.length,
          0
        );
      }
      componentPlans.sort((left, right) => (
        left.interval[0] - right.interval[0] ||
        Number(left.selected) - Number(right.selected) ||
        left.interval[1] - right.interval[1]
      ));
      if (!queueWithOutlines(componentPlans)) {
        return fail('lasso-fragment-limit-exceeded');
      }
    }

    const replacements = [];
    const selectedFragmentIds = new Set();
    for (const replacementPlan of replacementPlans) {
      const addObjects = [];
      const outlineAddObjects = [];
      let fragmentBuildFailed = false;
      for (const plan of replacementPlan.componentPlans) {
        const fragment = createStrokeFragment(
          replacementPlan.record,
          plan.points,
          plan.selected,
          plan.caps,
          replacementPlan.object,
          plan.renderGeometry,
          replacementPlan.geometryOptions
        );
        if (!fragment) {
          fragmentBuildFailed = true;
          break;
        }
        addObjects.push(fragment);
        if (plan.selected) selectedFragmentIds.add(fragment.id);
        if (replacementPlan.outlineSpec && plan.outlineRenderGeometry) {
          const outlineFragment = makeOutlineFragmentRecord(
            fragment,
            replacementPlan.outlineSpec,
            plan.outlineRenderGeometry,
            replacementPlan.outlineObject
          );
          if (outlineFragment) outlineAddObjects.push(outlineFragment);
        }
      }
      if (fragmentBuildFailed) {
        return fail('fragment-build-failed');
      }
      // 외곽선 교체를 본체보다 **먼저** 넣는다. 씬 Map 에서 외곽선이 본체 앞이므로
      // 그 자리에 조각들이 들어가 z-order 가 유지된다.
      const outlineId = outlineIdFor(replacementPlan.record.id);
      if (replacementPlan.outlineSpec && outlineId) {
        replacements.push({ removeId: outlineId, addObjects: outlineAddObjects });
      }
      replacements.push({
        removeId: replacementPlan.record.id,
        addObjects
      });
    }

    const selectedObjectIds = [...selectedPersistedIds, ...selectedFragmentIds];
    let result = { applied: false, selectedObjectIds };
    if (replacements.length > 0 && selectedFragmentIds.size > 0) {
      const staged = stagePendingLassoSelection({
        // 외곽선 교체는 조각 루프에서 이미 만들어 넣었다(잘라 낸 기하 포함).
        replacements,
        selectedPersistedIds,
        selectedFragmentIds,
        snapshot,
        canvasObjects
      });
      if (!staged.staged) {
        return fail(staged.reason);
      }
      result = { applied: false, pending: true, selectedObjectIds };
    }
    retireReplacedPendingSelection(failureSelectionContext);
    activateObjectIds(selectedObjectIds);
    if (pendingLassoSelection) {
      pendingLassoSelection.activeTarget = fabricCanvas.getActiveObject?.() || null;
      pendingLassoSelection.initialTargetTransform = captureTransform(pendingLassoSelection.activeTarget);
    }
    return { ...result, selectedObjectIds };
  }

  function finalizeActiveLasso() {
    if (!activeLasso) return { applied: false, reason: 'no-active-lasso' };
    const gesture = activeLasso;
    const sourcePerCssPixel = currentSession
      ? currentSession.sourceWidth / Math.max(1, currentSession.canvasRect.width) /
        Math.max(0.01, Math.abs(finiteNumber(currentSession.viewportTransform?.scale, 1)))
      : 1;
    const polygon = gesture.shape === 'rectangle'
      ? rectanglePolygon(gesture.points[0], gesture.points.at(-1))
      : simplifyClosedPolygon(
        gesture.points,
        Math.min(8, Math.max(0.25, sourcePerCssPixel * 1.5))
      );
    removeLassoPreview();
    activeLasso = null;
    const result = selectionTarget === 'stroke'
      ? finalizeWholeStrokeSelectionPolygon(polygon, gesture.previousSelectionContext)
      : finalizePartialSelectionPolygon(polygon, gesture.previousSelectionContext);
    const polygonBounds = boundsForPoints(polygon);
    lastSelectionGesture = {
      target: selectionTarget,
      shape: gesture.shape,
      pointerPointCount: gesture.points.length,
      polygonPointCount: polygon.length,
      polygonBounds: polygonBounds
        ? {
          left: finiteNumber(polygonBounds.left),
          right: finiteNumber(polygonBounds.right),
          top: finiteNumber(polygonBounds.top),
          bottom: finiteNumber(polygonBounds.bottom)
        }
        : null,
      pending: result?.pending === true,
      applied: result?.applied === true,
      selectedCount: Array.isArray(result?.selectedObjectIds)
        ? result.selectedObjectIds.length
        : 0,
      reason: typeof result?.reason === 'string' ? result.reason.slice(0, 128) : null
    };
    settleArmedFramePreview();
    return result;
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
    // activeStroke 는 커밋 도중 null 이 되므로 도구와 외곽선 설정을 먼저 뽑는다.
    const activeStrokeTool = activeStroke.tool;
    const activeStrokeOutline = activeStroke.outline;
    removeTransientPreview();
    let strokeData;
    try {
      strokeData = strokePathFactory(samples, {
        size: style.size,
        last: true,
        // 펜은 압력에 따라 굵기가 변하지 않는다(레거시 pen 동치).
        ...(activeStrokeTool === 'pen' ? PEN_STROKE_GEOMETRY : null)
      });
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      activeStroke = null;
      settleArmedFramePreview();
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
    const outlineRecord = deriveOutlineRecord(
      record,
      activeStrokeOutline,
      activeStrokeTool === 'pen' ? PEN_STROKE_GEOMETRY : null
    );
    const result = sceneStore.addStroke(record, outlineRecord);
    activeStroke = null;
    if (!result.applied) {
      settleArmedFramePreview();
      return result;
    }
    // 외곽선이 본체보다 먼저 캔버스에 올라가야 뒤에 깔린다.
    if (result.outlineId && outlineRecord) fabricCanvas.add(makeFabricPath(outlineRecord));
    fabricCanvas.add(path);
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
    settleArmedFramePreview();
    return result;
  }

  function releasePointerCapture(target, pointerId) {
    try {
      if (typeof target?.hasPointerCapture === 'function' && !target.hasPointerCapture(pointerId)) return;
      target?.releasePointerCapture?.(pointerId);
    } catch (_error) { /* best-effort pointer release */ }
  }

  // 펜/터치 유래 포인터 이벤트는 altKey/ctrlKey가 비어 오는 환경이 있어(레거시 피드백 22)
  // 오버레이 문서의 전역 키 상태를 보조로 본다. 다만 이 래치는 keyup을 놓치면 켜진 채
  // 남는데(오버레이는 별도 창이라 호스트가 키를 가로채거나 포커스가 옮겨갈 수 있다),
  // 그 상태로 브러시가 조용히 지우개·크기 조절로 바뀌면 사용자는 원인을 알 수 없다
  // (2026-08-27 실사용 보고: Ctrl+Z 뒤 아무것도 그려지지 않음).
  // 따라서 마우스 포인터에서는 이벤트가 실어 온 modifier만 신뢰한다.
  function isAltActive(event) {
    if (event?.altKey === true) return true;
    if (event?.pointerType === 'mouse') return false;
    return overlayModifierState.alt === true;
  }

  function isCtrlActive(event) {
    if (event?.ctrlKey === true) return true;
    if (event?.pointerType === 'mouse') return false;
    return overlayModifierState.ctrl === true;
  }

  function recordPointerdownProbe(event) {
    gestureProbe.lastPointerdown = {
      pointerType: typeof event?.pointerType === 'string' ? event.pointerType : null,
      button: Number.isFinite(event?.button) ? event.button : null,
      altKey: event?.altKey === true,
      ctrlKey: event?.ctrlKey === true,
      latchAlt: overlayModifierState.alt === true,
      latchCtrl: overlayModifierState.ctrl === true,
      documentHasFocus: typeof documentRef?.hasFocus === 'function'
        ? documentRef.hasFocus() === true
        : null,
      replayed: event?.[REPLAYED_POINTERDOWN] === true
    };
  }

  // 마우스 이벤트는 modifier 상태를 정확히 실어 오므로, 래치가 stuck이면 여기서 되돌린다.
  // 펜만 쓰다 마우스를 한 번 잡아도 복구되도록 포인터 진입 지점에서 동기화한다.
  function syncOverlayModifierStateFromPointer(event) {
    if (event?.pointerType !== 'mouse') return;
    if (event.altKey !== true) overlayModifierState.alt = false;
    if (event.ctrlKey !== true) overlayModifierState.ctrl = false;
  }

  function resetOverlayModifierState() {
    overlayModifierState.alt = false;
    overlayModifierState.ctrl = false;
  }

  function onOverlayKeyDown(event) {
    if (event?.key === 'Alt') {
      overlayModifierState.alt = true;
      gestureProbe.overlayAltKeyDownCount += 1;
    }
    if (event?.key === 'Control') {
      overlayModifierState.ctrl = true;
      gestureProbe.overlayCtrlKeyDownCount += 1;
    }
  }

  function onOverlayKeyUp(event) {
    if (event?.key === 'Alt') overlayModifierState.alt = false;
    if (event?.key === 'Control') overlayModifierState.ctrl = false;
  }

  function onOverlayWindowBlur(event) {
    resetOverlayModifierState();
    endSizeAdjustGesture(event);
    cancelStrokeEraseGesture(event);
    cancelShapeGesture();
    onPointerCancel(event);
  }

  function onCanvasContextMenu(event) {
    // 레거시 drawing-canvas.js L113-117 동치: Alt 우클릭 드래그가 컨텍스트 메뉴를 띄우지 않게 한다.
    if (!isAltActive(event) && !sizeAdjustGesture) return;
    event.preventDefault?.();
  }

  // 레거시 .brush-size-hud 계승 — 숫자만 띄우면 제스처의 목적(굵기를 눈으로 보는 것)이
  // 사라진다. 실제 브러시 굵기만 한 원을 브러시 색으로 그리고 라벨을 위에 붙인다.
  function createSizeAdjustHud() {
    const hud = documentRef.createElement('div');
    hud.className = 'mpv-fabric-pilot-size-hud';
    hud.dataset.fabricPilotOutput = 'size-adjust';
    hud.setAttribute?.('role', 'status');
    hud.setAttribute?.('aria-live', 'polite');
    hud.setAttribute?.('aria-atomic', 'true');
    setStyles(hud, {
      position: 'fixed',
      display: 'none',
      left: '0px',
      top: '0px',
      zIndex: '3',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      borderRadius: '50%',
      borderStyle: 'solid',
      borderWidth: '2px',
      borderColor: 'rgba(255, 255, 255, 0.9)',
      // 앵커 좌표를 원의 중심으로 삼는다. 레거시와 같다.
      transform: 'translate(-50%, -50%)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)'
    });
    const label = documentRef.createElement('span');
    label.className = 'mpv-fabric-pilot-size-hud-label';
    label.dataset.fabricPilotOutput = 'size-adjust-label';
    setStyles(label, {
      position: 'absolute',
      left: '50%',
      top: '-22px',
      transform: 'translateX(-50%)',
      padding: '3px 6px',
      borderRadius: '6px',
      background: 'rgba(9, 12, 18, 0.84)',
      color: '#fff',
      font: '700 11px/1 sans-serif',
      whiteSpace: 'nowrap',
      pointerEvents: 'none'
    });
    hud.appendChild(label);
    sizeAdjustHudLabel = label;
    return hud;
  }

  // 브러시 크기는 소스 픽셀 단위다. 화면에 보이는 굵기와 맞추려면 표시 배율을 곱해야
  // 한다(레거시 updateBrushSizeHud 의 rect.width / canvas.width 와 같은 계산이며,
  // 여기서는 확대·이동이 반영된 유효 rect 를 쓴다).
  function sourceToClientScale(session) {
    const sourceWidth = Math.max(0, finiteNumber(session?.sourceWidth, 0));
    if (sourceWidth <= 0) return 1;
    const rect = resolveEffectiveCanvasRect(session.canvasRect, session.viewportTransform);
    if (!(rect.width > 0)) return 1;
    return rect.width / sourceWidth;
  }

  function showSizeAdjustHud(clientX, clientY, size) {
    if (!sizeAdjustHud) return;
    const diameter = Math.max(2, Math.round(size * sourceToClientScale(currentSession)));
    if (sizeAdjustHudLabel) sizeAdjustHudLabel.textContent = `${size}px`;
    setStyles(sizeAdjustHud, {
      display: 'block',
      left: `${Math.round(finiteNumber(clientX))}px`,
      top: `${Math.round(finiteNumber(clientY))}px`,
      width: `${diameter}px`,
      height: `${diameter}px`,
      // 색은 8자리 hex 로 알파를 붙인다(스키마상 style.color 는 항상 #RRGGBB).
      background: `${brushStyle.color}80`,
      borderColor: brushStyle.color
    });
  }

  function hideSizeAdjustHud() {
    if (!sizeAdjustHud) return;
    setStyles(sizeAdjustHud, { display: 'none' });
  }

  function cancelSizeAdjustHudTimer() {
    if (sizeAdjustHudTimer === null) return;
    clearTimeoutRef?.(sizeAdjustHudTimer);
    sizeAdjustHudTimer = null;
  }

  // 좌표 없이 크기가 바뀌는 경로([ / ] 단축키)는 레거시와 같이 HUD 를 화면
  // 중앙에 띄운다. 그러지 않으면 팔레트 숫자만 바뀌어 굵기 변화가 안 보인다.
  function flashSizeAdjustHudAtViewportCenter(size) {
    if (!sizeAdjustHud) return false;
    cancelSizeAdjustHudTimer();
    showSizeAdjustHud(
      finiteNumber(windowRef?.innerWidth, 0) / 2,
      finiteNumber(windowRef?.innerHeight, 0) / 2,
      size
    );
    if (typeof setTimeoutRef !== 'function') return true;
    sizeAdjustHudTimer = setTimeoutRef(() => {
      sizeAdjustHudTimer = null;
      // Alt 제스처가 그 사이에 시작됐다면 그쪽 HUD 를 지우면 안 된다.
      if (sizeAdjustGesture) return;
      hideSizeAdjustHud();
    }, SIZE_ADJUST_HUD_FLASH_MS);
    return true;
  }

  function shapeGestureRecord(gesture, transient) {
    const samples = shapeCenterlineSamples(
      gesture.tool,
      gesture.origin,
      gesture.current,
      gesture.style.size
    );
    if (samples.length < 2) return null;
    let strokeData;
    try {
      strokeData = strokePathFactory(samples, {
        ...SHAPE_STROKE_OPTIONS,
        size: gesture.style.size
      });
    } catch (_error) {
      return null;
    }
    if (!strokeData?.pathData) return null;
    return {
      // 미리보기는 오브젝트 id 를 갖지 않는다. 기존 미리보기 경로
      // (updateTransientPreview / updateLassoPreview)와 같은 관례다 —
      // makeFabricPath 가 path.__baeframeObjectId = record.id || null 로 넘긴다.
      id: transient ? null : createId('shape'),
      type: 'stroke',
      pathData: strokeData.pathData,
      sourcePoints: strokeData.sourcePoints,
      style: { ...gesture.style }
    };
  }

  function clearShapePreviewFor(gesture) {
    if (!fabricCanvas) return;
    if (gesture?.outlinePreview) {
      fabricCanvas.remove(gesture.outlinePreview);
      gesture.outlinePreview = null;
    }
    if (!gesture?.preview) return;
    fabricCanvas.remove(gesture.preview);
    gesture.preview = null;
    fabricCanvas.requestRenderAll();
  }

  function updateShapePreview() {
    if (!shapeGesture || !fabricCanvas) return;
    const record = shapeGestureRecord(shapeGesture, true);
    clearShapePreviewFor(shapeGesture);
    if (!record) {
      fabricCanvas.requestRenderAll();
      return;
    }
    const preview = makeFabricPath(record, true);
    preview.__baeframeTransient = true;
    const outlinePreview = makeOutlinePreviewPath(
      record.sourcePoints,
      record.style,
      SHAPE_STROKE_GEOMETRY,
      record.pathData,
      shapeGesture.outline
    );
    if (outlinePreview) {
      outlinePreview.__baeframeTransient = true;
      shapeGesture.outlinePreview = outlinePreview;
      // 외곽선이 먼저 올라가야 본체 뒤에 깔린다.
      fabricCanvas.add(outlinePreview);
    }
    shapeGesture.preview = preview;
    fabricCanvas.add(preview);
    fabricCanvas.requestRenderAll();
  }

  function shapeGestureDragDistance(gesture) {
    return Math.hypot(
      finiteNumber(gesture.current?.x) - finiteNumber(gesture.origin?.x),
      finiteNumber(gesture.current?.y) - finiteNumber(gesture.origin?.y)
    );
  }

  function commitShapeGesture() {
    // 제스처를 먼저 비운 뒤 정리·커밋한다. 이렇게 해야 동기 lostpointercapture 가
    // 취소로 해석되지 않는다(기존 finalizeStrokeEraseGesture 와 같은 이유).
    const gesture = shapeGesture;
    shapeGesture = null;
    if (!gesture) return { applied: false, reason: 'no-shape-gesture' };
    clearShapePreviewFor(gesture);
    // 클릭만 하고 드래그하지 않은 경우 아무것도 만들지 않는다.
    if (shapeGestureDragDistance(gesture) < SHAPE_MIN_DRAG_DISTANCE) {
      settleArmedFramePreview();
      return { applied: false, reason: 'shape-too-small' };
    }
    const record = shapeGestureRecord(gesture, false);
    if (!record) {
      settleArmedFramePreview();
      return { applied: false, reason: 'shape-path-error' };
    }
    const path = makeFabricPath(record);
    record.transform = captureTransform(path);
    const outlineRecord = deriveOutlineRecord(record, gesture.outline, SHAPE_STROKE_GEOMETRY);
    const result = sceneStore.addStroke(record, outlineRecord);
    if (!result.applied) {
      settleArmedFramePreview();
      return result;
    }
    // 외곽선이 본체보다 먼저 캔버스에 올라가야 뒤에 깔린다.
    if (result.outlineId && outlineRecord) fabricCanvas.add(makeFabricPath(outlineRecord));
    fabricCanvas.add(path);
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
    settleArmedFramePreview();
    return result;
  }

  function cancelShapeGesture() {
    const gesture = shapeGesture;
    shapeGesture = null;
    if (!gesture) return false;
    clearShapePreviewFor(gesture);
    settleArmedFramePreview();
    return true;
  }

  function beginSizeAdjustGesture(event) {
    // 키보드 HUD 와 제스처 HUD 가 같은 요소를 공유한다. 남은 타이머가
    // 제스처 도중 HUD 를 지우지 않게 먼저 회수한다.
    cancelSizeAdjustHudTimer();
    sizeAdjustGesture = {
      pointerId: event.pointerId,
      startClientX: finiteNumber(event.clientX),
      startClientY: finiteNumber(event.clientY),
      startSize: boundedInteger(
        brushStyle.size,
        MIN_BRUSH_SIZE,
        MAX_BRUSH_SIZE,
        DEFAULT_BRUSH_STYLE.size
      )
    };
    try {
      event.currentTarget?.setPointerCapture?.(event.pointerId);
    } catch (_error) { /* pointer capture is best-effort */ }
    // HUD 앵커는 레거시 sizeadjust 이벤트와 같이 드래그 '시작' 좌표에 고정한다.
    showSizeAdjustHud(
      sizeAdjustGesture.startClientX,
      sizeAdjustGesture.startClientY,
      sizeAdjustGesture.startSize
    );
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  }

  function updateSizeAdjustGesture(event) {
    const gesture = sizeAdjustGesture;
    if (!gesture) return brushStyle.size;
    const delta = finiteNumber(event.clientX) - gesture.startClientX;
    // boundedInteger는 parseInt 절삭이므로 레거시 Math.round 동치를 여기서 만든다.
    const requested = Math.round(gesture.startSize + delta / SIZE_ADJUST_PIXELS_PER_STEP);
    const size = setBrushSize(requested);
    showSizeAdjustHud(gesture.startClientX, gesture.startClientY, size);
    return size;
  }

  // 정상 종료와 취소가 동일하다 — 레거시 _endSizeAdjust도 크기를 되돌리지 않는다.
  function endSizeAdjustGesture(event) {
    const gesture = sizeAdjustGesture;
    sizeAdjustGesture = null;
    if (!gesture) return false;
    hideSizeAdjustHud();
    releasePointerCapture(
      event?.currentTarget || fabricCanvas?.upperCanvasEl || canvasElement,
      gesture.pointerId
    );
    return true;
  }

  function strokeErasePoint(event) {
    if (!currentSession) return null;
    return mapClientPointToSource(
      event,
      currentSession.canvasRect,
      currentSession.viewportTransform,
      { width: currentSession.sourceWidth, height: currentSession.sourceHeight }
    );
  }

  function strokeEraseRadius() {
    return Math.max(1, resolveSelectionHitTolerance(currentSession || {}) / 2);
  }

  // 직전 샘플 → 현재 샘플 구간을 반경 radius로 부풀린 볼록 사각형.
  // 점 단위 판정은 빠른 드래그에서 획을 건너뛰므로 스윕 형상으로 판정한다.
  function strokeEraseSweepPolygon(previous, current, radius) {
    const dx = current.x - finiteNumber(previous?.x, current.x);
    const dy = current.y - finiteNumber(previous?.y, current.y);
    const length = Math.hypot(dx, dy);
    if (!previous || length < 1e-6) {
      return rectanglePolygon(
        { x: current.x - radius, y: current.y - radius },
        { x: current.x + radius, y: current.y + radius }
      );
    }
    const ux = (dx / length) * radius;
    const uy = (dy / length) * radius;
    const nx = -uy;
    const ny = ux;
    return [
      { x: previous.x - ux + nx, y: previous.y - uy + ny },
      { x: current.x + ux + nx, y: current.y + uy + ny },
      { x: current.x + ux - nx, y: current.y + uy - ny },
      { x: previous.x - ux - nx, y: previous.y - uy - ny }
    ];
  }

  // 히트테스트 문맥은 **포인터 이벤트 1회당 한 번만** 만든다. coalesced 샘플마다
  // 씬 스냅샷·캔버스 오브젝트 맵·기하 예산을 재구축하면 240Hz 펜에서 프레임당
  // 4~8회 × 프레임 오브젝트 수만큼 반복되어 그리기 지연이 눈에 띈다.
  function createStrokeEraseContext() {
    if (!fabricCanvas) return null;
    return {
      snapshot: sceneStore.getActiveSceneSnapshot(),
      canvasObjects: new Map(
        fabricCanvas.getObjects()
          .filter(object => object.__baeframeObjectId)
          .map(object => [object.__baeframeObjectId, object])
      ),
      budget: createGeometryBudget(maxSelectionGeometryOperations),
      radius: strokeEraseRadius(),
      hidden: 0
    };
  }

  function collectErasedStrokesAt(event, context) {
    const gesture = strokeEraseGesture;
    if (!gesture || !fabricCanvas || !context) return 0;
    const point = strokeErasePoint(event);
    if (!point) return 0;
    const polygon = strokeEraseSweepPolygon(gesture.lastPoint, point, context.radius);
    gesture.lastPoint = point;
    // 픽셀 모드 커밋에서 리본 폴리곤을 만들 원본 경로. 히트 여부와 무관하게 누적해야
    // 획 사이 빈 구간을 지나간 뒤 다시 획을 만나도 리본이 끊기지 않는다.
    gesture.pathPoints?.push(point);
    if (!polygonHasArea(polygon, 1)) return 0;

    const polygonBounds = boundsForPoints(polygon);
    let hidden = 0;
    for (const record of context.snapshot?.objects || []) {
      // 이미 지운 획은 판정 자체를 건너뛴다 — 같은 획 위를 여러 번 지나가도 1회만 처리된다.
      if (record.type !== 'stroke') continue;
      // 외곽선은 본체보다 최대 20px 더 뻗는다. 획 단위 모드에서 그 테두리만 스친
      // 지우개가 아무 일도 하지 않으면, 칠해진 데를 분명히 지나갔는데 반응이 없다.
      // 그래서 판정은 하되 **결과를 짝인 본체로 돌린다** — 짝 처리 로직이 삭제를
      // 함께 다룬다. 짝을 잃은 고아는 평범한 획이라 자기 자신이 대상이다.
      //
      // 픽셀 모드는 다르다. 커밋이 리본 폴리곤으로 본체를 다시 판정하는데 본체는
      // 닿은 적이 없으므로 어차피 아무것도 잘리지 않는다. 외곽선은 잘라 낼 수도
      // 없다(조각 수가 어긋난다). 그러니 대상으로 세우지 않고 조기 반환에 맡긴다.
      const derivedOutline = sceneStore.isDerivedOutline(record.id);
      if (derivedOutline && gesture.mode === 'pixel') continue;
      const targetId = derivedOutline ? bodyIdFor(record.id) : record.id;
      if (!targetId || gesture.erasedIds.has(targetId)) continue;
      const maximumRadius = Math.max(1, finiteNumber(record.style?.size, 1)) * 0.825;
      const object = context.canvasObjects.get(record.id);
      if (!boundsIntersect(strokeObjectSceneBounds(record, object, maximumRadius), polygonBounds)) {
        continue;
      }
      const sourceSelection = createSourcePolygonQuery(object, polygon, context.budget);
      if (!sourceSelection.query || sourceSelection.reason) continue;
      const fillSelection = createStoredPathFillQuery(record, object, sourceSelection, context.budget);
      if (!fillSelection.query || fillSelection.reason) continue;
      const touch = pathFillOverlapsPolygon(fillSelection.query, sourceSelection.query, context.budget);
      // 기하 예산을 초과한 획은 삭제 후보에서 제외한다 (오삭제보다 미삭제가 안전하다).
      if (touch.limitExceeded || !touch.hit) continue;
      gesture.erasedIds.add(targetId);
      // 획 단위 모드는 닿은 획을 통째로 지우므로, 드래그 중 숨기는 미리보기가
      // 커밋 결과와 정확히 일치한다.
      //
      // 픽셀 모드는 다르다. 히트 판정은 스윕 사각형들의 합집합으로 하는데 커밋은
      // 그것을 근사한 단순 폴리곤 하나로 하고, 이 저장소에는 폴리곤 불리언
      // 유니온이 없다(부록 C 참조). 그래서 안쪽 모서리처럼 근사가 미치지 못하는
      // 자리에서만 닿은 획은 숨었다가 되살아나 사용자를 혼란스럽게 한다.
      // 어차피 일치시킬 수 없다면 **숨기지 않는 편이 정직하다** — 픽셀 모드는
      // 손을 뗄 때 잘린 결과만 보여 준다.
      if (gesture.mode !== 'pixel') {
        // 삭제는 짝을 함께 다루므로 미리보기도 짝을 함께 감춘다.
        const outlineId = outlineIdFor(targetId);
        for (const hideId of outlineId ? [targetId, outlineId] : [targetId]) {
          const hideObject = context.canvasObjects.get(hideId);
          if (!hideObject || hideObject.visible === false) continue;
          gesture.hiddenObjects.push(hideObject);
          hideObject.set?.({ visible: false });
          hidden += 1;
        }
      }
    }
    // requestRenderAll()은 호출자가 이벤트당 1회만 수행한다 (루프 밖).
    context.hidden += hidden;
    return hidden;
  }

  function restoreErasedStrokeVisibility(gesture) {
    if (!gesture) return;
    for (const object of gesture.hiddenObjects) object.set?.({ visible: true });
    gesture.hiddenObjects = [];
    fabricCanvas?.requestRenderAll();
  }

  function cancelStrokeEraseGesture(event) {
    const gesture = strokeEraseGesture;
    strokeEraseGesture = null;
    if (!gesture) return false;
    restoreErasedStrokeVisibility(gesture);
    releasePointerCapture(
      event?.currentTarget || fabricCanvas?.upperCanvasEl || canvasElement,
      gesture.pointerId
    );
    return true;
  }

  // 지우개가 지나간 경로를 반경만큼 좌/우로 부풀린 닫힌 폴리곤.
  // 폴리곤 불리언 유니온이 저장소에 없으므로, 스윕 quad 들을 합치는 대신
  // 경로 자체를 리본으로 만들어 부분 선택 경로에 한 번에 넘긴다.
  // 스윕 사각형은 각 변을 반경만큼 부풀린 직사각형이고, 꺾임에서 두 사각형의
  // 합집합은 **바깥** 모서리를 마이터 지점까지 채운다(90도면 V 에서 1.414r).
  // 꼭짓점을 평균 법선 하나로만 밀면 그 삼각형이 커밋 폴리곤에서 빠져, 그 안에서만
  // 닿은 획이 드래그 중 숨었다가 되살아난다.
  //
  // 마이터는 **바깥쪽에만** 넣는다. 양쪽에 넣으면 안쪽 오프셋이 서로를 가로질러
  // 단순 폴리곤이 못 되고, 그러면 커밋 자체가 무산된다(실측 확인).
  function offsetRibbonFromSpine(spine, radius) {
    const left = [];
    const right = [];
    const unitNormal = (dx, dy) => {
      const length = Math.hypot(dx, dy) || 1;
      return { x: -dy / length, y: dx / length };
    };
    const at = (point, normal, sign) => ({
      x: point.x + normal.x * radius * sign,
      y: point.y + normal.y * radius * sign
    });
    for (let index = 0; index < spine.length; index += 1) {
      const current = spine[index];
      const previous = spine[index - 1];
      const next = spine[index + 1];
      if (!previous || !next) {
        const from = previous || current;
        const to = next || current;
        const normal = unitNormal(to.x - from.x, to.y - from.y);
        left.push(at(current, normal, 1));
        right.push(at(current, normal, -1));
        continue;
      }
      const inNormal = unitNormal(current.x - previous.x, current.y - previous.y);
      const outNormal = unitNormal(next.x - current.x, next.y - current.y);
      const averageNormal = unitNormal(next.x - previous.x, next.y - previous.y);
      const miterX = inNormal.x + outNormal.x;
      const miterY = inNormal.y + outNormal.y;
      const miterLength = Math.hypot(miterX, miterY);
      let miterNormal = null;
      if (miterLength > 1e-6) {
        const mx = miterX / miterLength;
        const my = miterY / miterLength;
        const projection = mx * inNormal.x + my * inNormal.y;
        // 아주 급한 꺾임에서는 마이터가 무한히 뻗는다. 스윕이 실제로 덮는 범위를
        // 넘지 않도록 2r 에서 자르고, 넘으면 마이터 없이 두 법선만 남긴다.
        if (projection > 0.5) miterNormal = { x: mx / projection, y: my / projection };
      }
      // 진행 방향의 외적 부호가 어느 쪽이 바깥인지를 알려 준다.
      const turn = (current.x - previous.x) * (next.y - current.y) -
        (current.y - previous.y) * (next.x - current.x);
      const outer = turn < 0 ? left : right;
      const inner = turn < 0 ? right : left;
      const outerSign = turn < 0 ? 1 : -1;
      outer.push(at(current, inNormal, outerSign));
      if (miterNormal) outer.push(at(current, miterNormal, outerSign));
      outer.push(at(current, outNormal, outerSign));
      inner.push(at(current, averageNormal, -outerSign));
    }
    return [...left, ...right.reverse()];
  }

  // 스윕 사각형(strokeEraseSweepPolygon)은 시작·끝에서 진행 방향으로도 반경만큼
  // 더 뻗는다. 리본이 척추 끝점에서 딱 끊기면 "지워진 것으로 표시됐는데 커밋
  // 폴리곤에는 안 들어간" 획이 생겨 그 획만 되살아난다. 끝을 같은 만큼 연장한다.
  function extendSpineEndpoints(spine, radius) {
    const extend = (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-6) return { x: to.x, y: to.y };
      return { x: to.x + (dx / length) * radius, y: to.y + (dy / length) * radius };
    };
    const extended = spine.map(point => ({ x: point.x, y: point.y }));
    extended[0] = extend(spine[1], spine[0]);
    extended[extended.length - 1] = extend(spine[spine.length - 2], spine[spine.length - 1]);
    return extended;
  }

  function strokeEraseCorridorPolygon(spine, radius) {
    const first = spine[0];
    let far = spine[0];
    let farDistance = 0;
    for (const point of spine) {
      const distance = Math.hypot(point.x - first.x, point.y - first.y);
      if (distance > farDistance) {
        farDistance = distance;
        far = point;
      }
    }
    if (farDistance < 1e-6) return [];
    const ux = (far.x - first.x) / farDistance;
    const uy = (far.y - first.y) / farDistance;
    let minAlong = 0;
    let maxAlong = 0;
    let maxPerpendicular = 0;
    for (const point of spine) {
      const dx = point.x - first.x;
      const dy = point.y - first.y;
      const along = dx * ux + dy * uy;
      const perpendicular = Math.abs(dx * -uy + dy * ux);
      if (along < minAlong) minAlong = along;
      if (along > maxAlong) maxAlong = along;
      if (perpendicular > maxPerpendicular) maxPerpendicular = perpendicular;
    }
    // 주축에서 반경 이상 벗어났다면 복도가 아니다(원·지그재그·고리 모양).
    // 그런 제스처는 어떤 단일 폴리곤으로도 안전하게 근사할 수 없다.
    if (maxPerpendicular > radius) return [];
    const startAlong = minAlong - radius;
    const endAlong = maxAlong + radius;
    const corner = (along, side) => ({
      x: first.x + ux * along + -uy * radius * side,
      y: first.y + uy * along + ux * radius * side
    });
    return [
      corner(startAlong, 1),
      corner(endAlong, 1),
      corner(endAlong, -1),
      corner(startAlong, -1)
    ];
  }

  function strokeEraseRibbonPolygon(pathPoints, radius, budget) {
    if (!Array.isArray(pathPoints) || pathPoints.length === 0) return [];
    // 지우개 경로는 닫힌 폴리곤이 아니라 열린 폴리라인이다.
    // simplifyClosedPolygon 을 쓰면 첫 점과 끝 점을 잇는 변까지 기준으로 삼아
    // 왕복 구간이 잘못 남는다.
    const simplified = simplifyOpenPolyline(pathPoints, Math.max(0.25, radius / 4));
    const spine = simplified.length >= 2 ? simplified : pathPoints;
    if (spine.length === 1) {
      const point = spine[0];
      return rectanglePolygon(
        { x: point.x - radius, y: point.y - radius },
        { x: point.x + radius, y: point.y + radius }
      );
    }
    const extended = extendSpineEndpoints(spine, radius);
    const ribbon = offsetRibbonFromSpine(extended, radius);
    if (validateSimpleContour(ribbon, budget)) return ribbon;
    // 앞뒤로 문지르는(A→B→A) 동작은 좌/우 오프셋이 서로를 가로질러 단순 폴리곤이
    // 되지 않는다. 한 축을 따르는 스크럽이면 복도로 되살리고, 그 밖의 모양이면
    // 빈 폴리곤을 돌려 **아무것도 지우지 않는다.**
    //
    // 복도는 **연장하지 않은** 척추에서 만든다. strokeEraseCorridorPolygon 이
    // 자체적으로 양 끝에 반경을 더하므로, 이미 연장된 척추를 넘기면 실제 스윕보다
    // 반경만큼 더 뻗어 지나가지도 않은 획을 삼킨다.
    return strokeEraseCorridorPolygon(spine, radius);
  }

  function commitStrokeEraseAsWholeStrokes(gesture) {
    const selection = sceneStore.selectObjects([...gesture.erasedIds]);
    if (selection.selection.length === 0) {
      restoreErasedStrokeVisibility(gesture);
      return { applied: false, reason: 'stroke-erase-target-missing' };
    }
    // 기존 삭제 액션 경로를 그대로 쓴다 — dedupe·프레임 재조준·undo 1건·영속화 관찰자까지 동일.
    const result = applyDrawingAction({
      sessionId: currentSession.sessionId,
      actionId: createId('stroke-erase'),
      action: 'delete-selection'
    });
    if (!result.applied) {
      sceneStore.selectObjects([]);
      restoreErasedStrokeVisibility(gesture);
    }
    return result;
  }

  function finalizeStrokeEraseGesture() {
    const gesture = strokeEraseGesture;
    strokeEraseGesture = null;
    if (!gesture) return { applied: false, reason: 'no-stroke-erase-gesture' };
    if (gesture.erasedIds.size === 0) {
      settleArmedFramePreview();
      return { applied: false, deletedCount: 0, deletedIds: [] };
    }
    if (!inputEnabled || !currentSession ||
        currentSession.sessionId !== gesture.sessionId ||
        tokenState.inputRevision !== gesture.inputRevision) {
      restoreErasedStrokeVisibility(gesture);
      return { applied: false, reason: 'stale-stroke-erase-gesture' };
    }
    const retargeted = retargetArmedFrameForMutation();
    if (!retargeted?.accepted) {
      restoreErasedStrokeVisibility(gesture);
      return { applied: false, reason: retargeted?.reason || 'retarget-failed' };
    }
    // stroke 모드: 지나간 획 전체를 지운다(기존 경로 그대로).
    if (gesture.mode !== 'pixel') return commitStrokeEraseAsWholeStrokes(gesture);

    // pixel 모드: 리본 폴리곤으로 부분 선택을 만든 뒤 1회 커밋으로 잘라낸다.
    // 부분 분할은 캔버스 오브젝트를 실제로 읽으므로, 드래그 중 숨겨 둔 획을 먼저 되살린다.
    restoreErasedStrokeVisibility(gesture);
    const ribbon = strokeEraseRibbonPolygon(
      gesture.pathPoints,
      strokeEraseRadius(),
      createGeometryBudget(maxSelectionGeometryOperations)
    );
    const staged = finalizePartialSelectionPolygon(ribbon, null);
    if (staged?.pending === true) return commitPendingLassoDelete();
    // 조각이 하나도 안 생겼지만 리본이 획을 통째로 덮은 경우가 있다(점·짧은 획).
    // 그때 finalizePartialSelectionPolygon 은 pending 없이 선택만 세워 돌려주므로,
    // 여기서 삭제 경로로 넘겨야 한다. reason 이 있으면 기하 실패이지 덮음이 아니다.
    if (!staged?.reason && staged?.selectedObjectIds?.length > 0) {
      return applyDrawingAction({
        sessionId: currentSession.sessionId,
        actionId: createId('pixel-erase'),
        action: 'delete-selection'
      });
    }
    // 여기까지 왔다면 기하가 성립하지 않았다는 뜻이다. **아무것도 지우지 않는다** —
    // 픽셀 지우개가 지나가지도 않은 부분까지 날리는 쪽이 훨씬 나쁜 실패다.
    sceneStore.selectObjects([]);
    return {
      applied: false,
      reason: staged?.reason || 'pixel-erase-unavailable',
      deletedCount: 0,
      deletedIds: []
    };
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
      // 드래그 미리보기가 짝인 외곽선도 함께 옮겨 놨다. 본체만 되돌리면
      // 외곽선이 마지막 미리보기 자리에 남아, 저장된 값은 그대로인데 화면만 어긋난다.
      for (const pair of start.outlinePairs || []) {
        pair.object.set?.({ left: pair.startLeft, top: pair.startTop });
        pair.object.setCoords?.();
      }
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

  function cancelSelectInteraction(event, options = {}) {
    const gesture = selectGesture;
    const preserveDeferredViewport = options.preserveDeferredViewport === true;
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
    if (!preserveDeferredViewport) deferredViewport = null;
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
    if (tokenState.inputRevision !== inputRevision) return false;
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
      settleArmedFramePreview();
    });
  }

  function beginPointerDown(event, retargetArmed = true) {
    if (!inputEnabled || event.button !== 0) return;
    if (retargetArmed) {
      const retargeted = retargetArmedFrameForMutation();
      if (!retargeted?.accepted) {
        event.preventDefault?.();
        event.stopImmediatePropagation?.();
        return;
      }
    }
    const tool = sceneStore.getDiagnostics().tool;
    // 레거시 _resolveEffectiveTool 계승: Ctrl은 pointerdown 시점에 래치되고 pointerup에서 풀린다.
    // fabric에서는 새 획을 만들지 않고 포인터가 지나가는 기존 스트로크를 지운다.
    // 지우개 도구는 modifier 없이 같은 제스처를 연다. Ctrl 임시 지우개는 브러시·펜에서
    // 그대로 유지된다(레거시 _resolveEffectiveTool 계승).
    if (tool === 'eraser' || ((tool === 'brush' || tool === 'pen') && isCtrlActive(event))) {
      if (activeStroke || selectGesture || strokeEraseGesture || shapeGesture) return;
      strokeEraseGesture = {
        pointerId: event.pointerId,
        sessionId: currentSession?.sessionId,
        inputRevision: tokenState.inputRevision,
        lastPoint: null,
        erasedIds: new Set(),
        hiddenObjects: [],
        // 제스처 시작 시점의 모드를 고정한다. 드래그 도중 팔레트로 모드를 바꿔도
        // 한 제스처 안에서 커밋 방식이 갈리지 않게 한다.
        // Ctrl 임시 지우개는 항상 'stroke' 다 — 레거시 동작과 같고, modifier 제스처가
        // 팔레트 상태에 따라 달라지면 사용자가 예측할 수 없다.
        mode: tool === 'eraser' ? eraserMode : 'stroke',
        // 픽셀 모드에서 리본 폴리곤을 만들기 위한 지나간 경로. stroke 모드에서는 쓰지 않는다.
        pathPoints: []
      };
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch (_error) { /* pointer capture is best-effort */ }
      const eraseContext = createStrokeEraseContext();
      collectErasedStrokesAt(event, eraseContext);
      if (eraseContext && eraseContext.hidden > 0) fabricCanvas.requestRenderAll();
      event.preventDefault?.();
      return;
    }
    if (tool === 'brush' || tool === 'pen') {
      if (activeStroke || selectGesture) return;
      activeStroke = {
        pointerId: event.pointerId,
        samples: [],
        preview: null,
        style: { ...brushStyle },
        // 다른 손가락이 그리는 도중 팔레트를 만져도 이 획의 외곽선은 바뀌지 않는다.
        // 굵기·색·불투명도를 pointerdown 에 굳히는 것과 같은 규칙이다.
        outline: { ...outlineStyle },
        tool
      };
      event.currentTarget?.setPointerCapture?.(event.pointerId);
      appendPointerSample(event);
      updateTransientPreview();
      event.preventDefault?.();
      return;
    }
    if (FABRIC_SHAPE_TOOLS.includes(tool)) {
      if (activeStroke || selectGesture || shapeGesture) return;
      const origin = strokeErasePoint(event);
      if (!origin) return;
      shapeGesture = {
        pointerId: event.pointerId,
        tool,
        origin,
        current: origin,
        preview: null,
        style: { ...brushStyle },
        outline: { ...outlineStyle }
      };
      try {
        event.currentTarget?.setPointerCapture?.(event.pointerId);
      } catch (_error) { /* pointer capture is best-effort */ }
      event.preventDefault?.();
      return;
    }
    if (tool !== 'select' || selectGesture || activeStroke) return;
    if (!usesNativeRectangleSelection(tool)) {
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
      if (pendingLassoSelection && !pendingLassoIsFresh(pendingLassoSelection)) {
        abortPendingLassoSelection({ authoritative: true });
      }
      const previousPendingSelection = pendingLassoSelection;
      const activeObjectIds = fabricCanvas.getActiveObjects?.()
        .map(object => object.__baeframeObjectId)
        .filter(Boolean) || [];
      const previousSelectedObjectIds = activeObjectIds.length > 0
        ? activeObjectIds
        : sceneStore.getActiveSceneSnapshot()?.selectedObjectIds || [];
      activeLasso = {
        pointerId: event.pointerId,
        sessionId: currentSession?.sessionId,
        inputRevision: tokenState.inputRevision,
        phase: 'tracking',
        shape: selectionShape,
        previousSelectionContext: {
          objectIds: [...previousSelectedObjectIds],
          sessionId: currentSession?.sessionId,
          inputRevision: tokenState.inputRevision,
          mutationCount: sceneStore.getDiagnostics().mutationCount,
          pendingSelection: previousPendingSelection
        },
        points: [],
        preview: null
      };
      preservingPendingLassoSelectionEvent = !!previousPendingSelection;
      try {
        fabricCanvas.discardActiveObject();
      } finally {
        preservingPendingLassoSelectionEvent = false;
      }
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

  function snapshotPointerEvent(event) {
    const snapshot = { type: String(event.type || '') };
    for (const field of POINTER_EVENT_SNAPSHOT_FIELDS) {
      const value = event[field];
      if (value !== undefined) snapshot[field] = value;
    }
    return snapshot;
  }

  function cancelPendingPointerdownFrame() {
    const pending = pendingPointerdownFrame;
    pendingPointerdownFrame = null;
    if (!pending) return false;
    if (pending.confirmationDeadline !== null) {
      try {
        clearTimeoutRef?.(pending.confirmationDeadline);
      } catch (_error) { /* deadline cleanup is best-effort */ }
      pending.confirmationDeadline = null;
    }
    releasePointerCapture(pending.target, pending.pointerId);
    return true;
  }

  function schedulePendingPointerdownFrameDeadline(pending) {
    if (typeof setTimeoutRef !== 'function') return false;
    try {
      pending.confirmationDeadline = setTimeoutRef(() => {
        if (pendingPointerdownFrame !== pending) return;
        pending.confirmationDeadline = null;
        cancelPendingPointerdownFrame();
      }, POINTERDOWN_FRAME_CONFIRMATION_DEADLINE_MS);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function consumePendingPointerEvent(event) {
    const pending = pendingPointerdownFrame;
    if (!pending || (event.pointerId !== undefined && event.pointerId !== pending.pointerId)) {
      return false;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    const coalesced = event.type === 'pointermove' &&
      typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [];
    const samples = coalesced.length > 0 ? coalesced : [event];
    if (pending.events.length + samples.length > MAX_PENDING_POINTER_EVENTS) {
      cancelPendingPointerdownFrame();
      return true;
    }
    for (const sample of samples) pending.events.push(snapshotPointerEvent(sample));
    return true;
  }

  function dispatchReplayedPointerEvent(target, snapshot) {
    if (typeof target?.dispatchEvent === 'function' && windowRef?.Event) {
      const EventConstructor = typeof windowRef.PointerEvent === 'function'
        ? windowRef.PointerEvent
        : windowRef.Event;
      let event;
      if (EventConstructor === windowRef.PointerEvent) {
        event = new EventConstructor(snapshot.type, {
          bubbles: true,
          cancelable: true,
          ...snapshot
        });
      } else {
        event = new EventConstructor(snapshot.type, { bubbles: true, cancelable: true });
        for (const [field, value] of Object.entries(snapshot)) {
          if (field === 'type') continue;
          Object.defineProperty(event, field, { value });
        }
      }
      // PointerEventInit에는 timeStamp 멤버가 없어 생성자가 무시하고 '생성 시각'을
      // 넣는다. 원본 시각을 반드시 되돌려 놓아야 재생 샘플과 라이브 샘플의 시간 축이
      // 어긋나지 않는다.
      if (typeof snapshot.timeStamp === 'number' && event.timeStamp !== snapshot.timeStamp) {
        Object.defineProperty(event, 'timeStamp', { value: snapshot.timeStamp });
      }
      Object.defineProperty(event, REPLAYED_POINTERDOWN, { value: true });
      target.dispatchEvent(event);
      return true;
    }
    if (typeof target?.dispatch === 'function') {
      target.dispatch(snapshot.type, { ...snapshot, [REPLAYED_POINTERDOWN]: true });
      return true;
    }
    return false;
  }

  function onPointerDown(event) {
    // 표본은 래치 자가복구(syncOverlayModifierStateFromPointer)보다 먼저 찍는다.
    // 뒤에 찍으면 마우스 경로에서 래치가 지워진 뒤라 원인 판별 정보가 사라진다.
    recordPointerdownProbe(event);
    syncOverlayModifierStateFromPointer(event);
    if (event?.[REPLAYED_POINTERDOWN] === true) {
      beginPointerDown(event, false);
      return;
    }
    // Alt 드래그는 씬을 바꾸지 않으므로 pointerdown 프레임 확정 왕복 이전에 가로챈다.
    // 레거시와 같이 좌/우 버튼 모두 허용한다.
    if (inputEnabled && isAltActive(event) &&
        (event.button === 0 || event.button === 2) &&
        !sizeAdjustGesture && !strokeEraseGesture && !shapeGesture && !pendingPointerdownFrame &&
        !activeStroke && !activeLasso && !selectGesture) {
      beginSizeAdjustGesture(event);
      return;
    }
    if (!inputEnabled || event.button !== 0 || pendingPointerdownFrame ||
        activeStroke || activeLasso || selectGesture || strokeEraseGesture || shapeGesture) {
      return;
    }
    if (!requestPointerdownFrame) {
      beginPointerDown(event, true);
      return;
    }
    const pointerdownAt = Number(wallNow());
    if (!currentSession || !Number.isSafeInteger(pointerdownAt) || pointerdownAt < 0) {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      return;
    }
    const request = {
      hostGeneration: tokenState.hostGeneration,
      videoGeneration: tokenState.videoGeneration,
      inputRevision: tokenState.inputRevision,
      sessionId: currentSession.sessionId,
      pointerdownId: createId('pointerdown'),
      pointerdownAt
    };
    const target = event.currentTarget || fabricCanvas?.upperCanvasEl || canvasElement;
    pendingPointerdownFrame = {
      request,
      pointerId: event.pointerId,
      target,
      events: [snapshotPointerEvent(event)],
      confirmationDeadline: null
    };
    const pending = pendingPointerdownFrame;
    try {
      target?.setPointerCapture?.(event.pointerId);
    } catch (_error) { /* pointer capture is best-effort */ }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    try {
      if (requestPointerdownFrame(request) !== true) {
        cancelPendingPointerdownFrame();
      } else if (pendingPointerdownFrame === pending &&
          !schedulePendingPointerdownFrameDeadline(pending)) {
        cancelPendingPointerdownFrame();
      }
    } catch (_error) {
      cancelPendingPointerdownFrame();
    }
  }

  function confirmDrawingPointerdownFrame(request = {}) {
    if (!validatePointerdownFrameConfirmation(request)) {
      return { accepted: false, reason: 'invalid-pointerdown-frame-confirmation' };
    }
    const pending = pendingPointerdownFrame;
    if (!pending || !inputEnabled || !currentSession ||
        request.hostGeneration !== tokenState.hostGeneration ||
        request.videoGeneration !== tokenState.videoGeneration ||
        request.inputRevision !== tokenState.inputRevision ||
        request.sessionId !== currentSession.sessionId ||
        request.pointerdownId !== pending.request.pointerdownId ||
        request.pointerdownAt !== pending.request.pointerdownAt) {
      return { accepted: false, reason: 'stale-pointerdown-frame-confirmation' };
    }
    if (request.cancelled === true) {
      cancelPendingPointerdownFrame();
      return {
        accepted: true,
        cancelled: true,
        hostGeneration: request.hostGeneration,
        videoGeneration: request.videoGeneration,
        inputRevision: request.inputRevision,
        sessionId: request.sessionId,
        pointerdownId: request.pointerdownId,
        pointerdownAt: request.pointerdownAt
      };
    }
    const previousFrameState = { ...activeFrameState };
    const candidate = sceneStore.getActiveFrameCandidate(request.targetFrame);
    if (!candidate?.accepted) {
      cancelPendingPointerdownFrame();
      return { accepted: false, reason: candidate?.reason || 'retarget-failed' };
    }
    activeFrameState.targetFrame = request.targetFrame;
    activeFrameState.sourceFrame = candidate.sourceFrame;
    activeFrameState.sourceSceneInstanceId = candidate.sceneInstanceId;
    activeFrameState.sourceMutationSequence = candidate.mutationSequence;
    const retargeted = retargetFrameForMutation(request.targetFrame);
    if (!retargeted?.accepted) {
      Object.assign(activeFrameState, previousFrameState);
      cancelPendingPointerdownFrame();
      return { accepted: false, reason: retargeted?.reason || 'retarget-failed' };
    }
    pendingPointerdownFrame = null;
    if (pending.confirmationDeadline !== null) {
      try {
        clearTimeoutRef?.(pending.confirmationDeadline);
      } catch (_error) { /* deadline cleanup is best-effort */ }
      pending.confirmationDeadline = null;
    }
    for (const replayEvent of pending.events) {
      if (!dispatchReplayedPointerEvent(pending.target, replayEvent)) {
        cancelActiveStroke();
        cancelActiveLasso();
        cancelSelectInteraction();
        releasePointerCapture(pending.target, pending.pointerId);
        return { accepted: false, reason: 'pointerdown-replay-failed' };
      }
    }
    return {
      accepted: true,
      pointerdownId: request.pointerdownId,
      targetFrame: request.targetFrame
    };
  }

  function onPointerMove(event) {
    if (sizeAdjustGesture) {
      if (event.pointerId !== sizeAdjustGesture.pointerId) return;
      updateSizeAdjustGesture(event);
      event.preventDefault?.();
      return;
    }
    if (consumePendingPointerEvent(event)) return;
    if (strokeEraseGesture) {
      if (event.pointerId !== strokeEraseGesture.pointerId) return;
      const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const samples = coalesced.length > 0 ? coalesced : [event];
      // 스냅샷·오브젝트 맵·기하 예산은 이벤트당 1회만 만든다 (샘플마다 재구축 금지).
      const eraseContext = createStrokeEraseContext();
      for (const sample of samples) collectErasedStrokesAt(sample, eraseContext);
      if (eraseContext && eraseContext.hidden > 0) fabricCanvas.requestRenderAll();
      event.preventDefault?.();
      return;
    }
    if (shapeGesture) {
      if (event.pointerId !== shapeGesture.pointerId) return;
      const point = strokeErasePoint(event);
      if (point) {
        shapeGesture.current = point;
        updateShapePreview();
      }
      event.preventDefault?.();
      return;
    }
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
    if (sizeAdjustGesture) {
      if (event.pointerId !== sizeAdjustGesture.pointerId) return;
      endSizeAdjustGesture(event);
      event.preventDefault?.();
      return;
    }
    if (consumePendingPointerEvent(event)) return;
    if (strokeEraseGesture) {
      if (event.pointerId !== strokeEraseGesture.pointerId) return;
      const eraseContext = createStrokeEraseContext();
      collectErasedStrokesAt(event, eraseContext);
      if (eraseContext && eraseContext.hidden > 0) fabricCanvas.requestRenderAll();
      // 제스처를 먼저 비운 뒤 캡처를 놓아, 동기 lostpointercapture가 취소로 해석되지 않게 한다.
      finalizeStrokeEraseGesture();
      releasePointerCapture(event.currentTarget, event.pointerId);
      event.preventDefault?.();
      return;
    }
    if (shapeGesture) {
      if (event.pointerId !== shapeGesture.pointerId) return;
      // 빠른 드래그·이벤트 병합·문서 경로에서는 마지막 pointermove 보다 release
      // 좌표가 더 뒤에 있다. 커밋 전에 끝점을 갱신하지 않으면 도형이 직전 move
      // 위치에서 끝나고, move 가 하나도 없던 드래그는 클릭으로 오인돼 버려진다.
      const releasePoint = strokeErasePoint(event);
      if (releasePoint) shapeGesture.current = releasePoint;
      // 커밋이 shapeGesture 를 먼저 비우므로, 그 뒤에 캡처를 놓는다.
      commitShapeGesture();
      releasePointerCapture(event.currentTarget, event.pointerId);
      event.preventDefault?.();
      return;
    }
    if (activeLasso) {
      if (event.pointerId !== activeLasso.pointerId) return;
      const { sessionId, inputRevision } = activeLasso;
      activeLasso.phase = 'settling';
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
    if (sizeAdjustGesture) {
      if (event.pointerId !== undefined && event.pointerId !== sizeAdjustGesture.pointerId) return;
      endSizeAdjustGesture(event);
      return;
    }
    if (strokeEraseGesture) {
      if (event.pointerId !== undefined && event.pointerId !== strokeEraseGesture.pointerId) return;
      cancelStrokeEraseGesture(event);
      return;
    }
    if (shapeGesture && (event?.pointerId === undefined || event.pointerId === shapeGesture.pointerId)) {
      cancelShapeGesture();
      return;
    }
    if (pendingPointerdownFrame) {
      if (event.pointerId !== undefined &&
          event.pointerId !== pendingPointerdownFrame.pointerId) return;
      if (event.type === 'lostpointercapture' &&
          pendingPointerdownFrame.events.some(pendingEvent => pendingEvent.type === 'pointerup')) {
        return;
      }
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      cancelPendingPointerdownFrame();
      return;
    }
    if (activeLasso) {
      if (event.pointerId !== undefined && event.pointerId !== activeLasso.pointerId) return;
      if (event.type === 'lostpointercapture' && activeLasso.phase === 'settling') return;
      cancelActiveLasso();
      deferredViewport = null;
      return;
    }
    if (activeStroke) {
      if (event.pointerId !== undefined && event.pointerId !== activeStroke.pointerId) return;
      cancelActiveStroke();
      return;
    }
    const gesture = selectGesture;
    if (!gesture) {
      // 정상 pointerup에서 releasePointerCapture()가 뒤늦게 발생시킨 이벤트다.
      // 이미 확정된 부분 선택을 취소 사유로 해석하면 선택 상자가 즉시 사라진다.
      if (event.type === 'lostpointercapture') return;
      if (pendingLassoSelection) abortPendingLassoSelection();
      return;
    }
    if (event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
    if (event.type === 'lostpointercapture' && gesture.phase === 'settling') return;
    cancelSelectInteraction(event);
  }

  function onDocumentPointerUp(event) {
    // 포인터 캡처가 실패한 환경에서도 제스처가 끝나도록 문서 경로에서 회수한다.
    if (sizeAdjustGesture && event.pointerId === sizeAdjustGesture.pointerId) {
      onPointerUp(event);
      return;
    }
    if (strokeEraseGesture && event.pointerId === strokeEraseGesture.pointerId) {
      onPointerUp(event);
      return;
    }
    if (shapeGesture && event.pointerId === shapeGesture.pointerId) {
      onPointerUp(event);
      return;
    }
    if (pendingPointerdownFrame && event.pointerId === pendingPointerdownFrame.pointerId) {
      consumePendingPointerEvent(event);
      return;
    }
    if (activeLasso && event.pointerId === activeLasso.pointerId) {
      onPointerUp(event);
      return;
    }
    if (!selectGesture || event.pointerId !== selectGesture.pointerId) return;
    onPointerUp(event);
  }

  function onDocumentPointerCancel(event) {
    if (sizeAdjustGesture && event.pointerId === sizeAdjustGesture.pointerId) {
      onPointerCancel(event);
      return;
    }
    if (strokeEraseGesture && event.pointerId === strokeEraseGesture.pointerId) {
      onPointerCancel(event);
      return;
    }
    if (shapeGesture && event.pointerId === shapeGesture.pointerId) {
      onPointerCancel(event);
      return;
    }
    if (pendingPointerdownFrame && event.pointerId === pendingPointerdownFrame.pointerId) {
      onPointerCancel(event);
      return;
    }
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
    if (preservingPendingLassoSelectionEvent) return;
    if (pendingLassoSelection &&
        !pendingTargetMatches(fabricCanvas?.getActiveObject?.(), pendingLassoSelection.selectedIds)) {
      abortPendingLassoSelection();
      return;
    }
    refreshSelectionInteractionPolicy();
    sceneStore.selectObjects(selectionIds());
  }

  function onSelectionCleared() {
    if (preservingPendingLassoSelectionEvent) return;
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
      transform: captureTransform(target),
      // 외곽선은 선택 대상이 아니라 fabric 의 이동 타깃에 들어가지 않는다.
      // 드래그 중에도 짝이 붙어 다니도록 출발 위치를 기억해 두고 같은 델타를 준다.
      outlinePairs: collectDraggedOutlinePairs(target)
    };
    if (pendingLassoSelection) {
      pendingLassoSelection.activeTarget = target;
      pendingLassoSelection.startTargetTransform = clonePlain(transformStart.transform);
    }
  }

  // 이동 중인 타깃(단일 오브젝트 또는 ActiveSelection)에 딸린 외곽선들.
  function collectDraggedOutlinePairs(target) {
    if (!fabricCanvas || !target) return [];
    const children = typeof target.getObjects === 'function' ? target.getObjects() : [target];
    const canvasObjects = new Map(
      fabricCanvas.getObjects()
        .filter(object => object.__baeframeObjectId)
        .map(object => [object.__baeframeObjectId, object])
    );
    const pairs = [];
    for (const child of children) {
      const outlineId = outlineIdFor(child?.__baeframeObjectId);
      const outlineObject = outlineId ? canvasObjects.get(outlineId) : null;
      if (!outlineObject) continue;
      pairs.push({
        object: outlineObject,
        startLeft: finiteNumber(outlineObject.left),
        startTop: finiteNumber(outlineObject.top)
      });
    }
    return pairs;
  }

  // 드래그 중 본체만 포인터를 따라가고 외곽선이 제자리에 남으면, 손을 뗄 때까지
  // 짝이 눈에 띄게 벌어진다. 커밋 전까지도 같은 델타로 따라가게 한다.
  function syncDraggedOutlinePairs() {
    const start = transformStart;
    if (!start?.outlinePairs?.length) return;
    // 라쏘 조각은 materialize 이후 타깃이 바뀌므로 그때 잡아 둔 기준을 우선한다.
    const target = start.outlineBaseTarget || start.target;
    const base = start.outlineBaseTransform || start.transform;
    if (!target || !base) return;
    const dx = finiteNumber(target.left) - finiteNumber(base.left);
    const dy = finiteNumber(target.top) - finiteNumber(base.top);
    for (const pair of start.outlinePairs) {
      pair.object.set?.({ left: pair.startLeft + dx, top: pair.startTop + dy });
      pair.object.setCoords?.();
    }
    fabricCanvas?.requestRenderAll();
  }

  // 네이티브 선택 모드에서는 fabric 이 직접 히트테스트를 한다. 고리로 칠한 외곽선
  // 테두리는 본체 밖이라, 그 픽셀을 클릭하면 fabric 이 외곽선을 타깃으로 잡는다.
  // 외곽선은 선택 대상이 아니므로 그대로 두면 아무것도 안 잡힌다 — 짝인 본체로 돌린다.
  //
  // 한계: fabric 의 __onMouseDown 은 selectable 이 false 인 타깃을 만나면 그 자리에서
  // 마퀴(_groupSelector)를 시작하고, 이 핸들러는 그 뒤(down 이벤트)에 실행된다.
  // 그래서 **클릭 선택은 되지만 그 밴드에서 바로 끌어 옮길 수는 없다** — 드래그는
  // 획 본체를 잡아야 한다. 밴드에서도 끌리게 하려면 외곽선을 selectable 로 만들고
  // 선택·변형을 외곽선→본체 방향으로 되짚어야 해서, 지금의 본체→외곽선 짝 방향을
  // 양방향으로 늘려야 한다.
  function onCanvasMouseDown(event) {
    if (!fabricCanvas || !inputEnabled) return;
    const target = event?.target;
    const outlineId = target?.__baeframeObjectId;
    if (!outlineId || !sceneStore.isDerivedOutline(outlineId)) return;
    if (sceneStore.getDiagnostics().tool !== 'select') return;
    const bodyId = bodyIdFor(outlineId);
    const bodyPath = fabricCanvas.getObjects()
      .find(object => object.__baeframeObjectId === bodyId);
    if (!bodyPath?.selectable) return;
    fabricCanvas.setActiveObject?.(bodyPath);
    sceneStore.selectObjects([bodyId]);
    refreshSelectionInteractionPolicy();
    fabricCanvas.requestRenderAll();
  }

  function onObjectMoving(event) {
    const target = event?.target;
    if (!pendingLassoSelection) {
      syncDraggedOutlinePairs();
      return;
    }
    if (!pendingTargetMatches(target, pendingLassoSelection.selectedIds)) {
      transformStart = null;
      abortPendingLassoSelection();
      return;
    }
    const wasMoving = pendingLassoSelection.phase === 'moving';
    if (!materializePendingLassoSelection(target)) {
      transformStart = null;
      return;
    }
    // 조각 외곽선 프록시는 이 순간 처음 캔버스에 올라온다. before:transform 때 뜬
    // 짝 목록에는 없으므로 여기서 다시 뜬다 — 안 그러면 본체 조각만 포인터를 따라가고
    // 외곽선은 커밋 재렌더 때까지 제자리에 남는다.
    //
    // 기준 변형은 transformStart.transform 을 건드리지 않고 따로 잡는다.
    // 그 값은 rollbackSelectTransform 이 원래 자리로 되돌릴 때 쓰는 진짜 출발점이다.
    if (!wasMoving && transformStart) {
      const activeTarget = pendingLassoSelection.activeTarget || transformStart.target;
      transformStart.outlineBaseTarget = activeTarget;
      transformStart.outlineBaseTransform = captureTransform(activeTarget);
      transformStart.outlinePairs = collectDraggedOutlinePairs(activeTarget);
    }
    syncDraggedOutlinePairs();
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
      settleArmedFramePreview();
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
      settleArmedFramePreview();
      return;
    }
    const shouldReleaseMultiSelection = result.applied && children.length > 1;
    transformStart = null;
    if (result.applied) updateObjectMetric();
    if (shouldReleaseMultiSelection) scheduleMovedMultiSelectionRelease(target, ids);
    settleArmedFramePreview();
  }

  function configureCanvasEvents() {
    const pointerTarget = fabricCanvas.upperCanvasEl || canvasElement;
    addDomListener(pointerTarget, 'pointerdown', onPointerDown, true);
    addDomListener(pointerTarget, 'pointermove', onPointerMove, true);
    addDomListener(pointerTarget, 'pointerup', onPointerUp, true);
    addDomListener(pointerTarget, 'pointercancel', onPointerCancel, true);
    addDomListener(pointerTarget, 'lostpointercapture', onPointerCancel, true);
    addDomListener(pointerTarget, 'contextmenu', onCanvasContextMenu, true);
    addDomListener(documentRef, 'pointerup', onDocumentPointerUp);
    addDomListener(documentRef, 'pointercancel', onDocumentPointerCancel);
    // 펜/터치에서 modifier가 비어 오는 환경 대응 — 오버레이 문서 전역 키 상태
    addDomListener(documentRef, 'keydown', onOverlayKeyDown, true);
    addDomListener(documentRef, 'keyup', onOverlayKeyUp, true);
    addDomListener(windowRef, 'blur', onOverlayWindowBlur);
    addFabricListener('mouse:down', onCanvasMouseDown);
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
    const tool = sceneStore.getDiagnostics().tool;
    const selectTool = tool === 'select';
    const nativeSelection = usesNativeRectangleSelection(tool);
    const activeIds = new Set(selectionIds());
    fabricCanvas.setTargetFindTolerance?.(tolerance);
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      applyMoveOnlyConstraints(object);
      applyUnselectedPermanentPathPolicy(object, tolerance);
      const activeInCustomSelection = selectTool &&
        !nativeSelection &&
        activeIds.has(object.__baeframeObjectId);
      // 외곽선은 본체의 짝이라 어떤 선택 방식에서도 따로 잡히지 않는다.
      const interactive = nativeSelection || activeInCustomSelection;
      object.set({
        selectable: interactive && !sceneStore.isDerivedOutline(object.__baeframeObjectId),
        // 외곽선도 이벤트는 받는다 — 그 위 클릭을 짝인 본체로 돌리기 위해서다.
        evented: interactive
      });
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

  function resetPassivePresentationState() {
    passiveDisplaySession = null;
    presentationState.hostGeneration = -1;
    presentationState.videoGeneration = -1;
    presentationState.presentationRevision = -1;
    presentationState.stableVideoIdentity = null;
    presentationState.storeRevision = -1;
    presentationState.targetFrame = null;
    presentationState.sourceFrame = null;
  }

  function validateSession(session) {
    const targetFrame = Number(session?.targetFrame);
    const sourceFrame = session?.sourceFrame;
    return !!session &&
      typeof session.sessionId === 'string' && session.sessionId.length > 0 &&
      typeof session.stableVideoIdentity === 'string' && session.stableVideoIdentity.length > 0 &&
      Number.isInteger(targetFrame) && targetFrame >= 0 &&
      (sourceFrame === undefined || sourceFrame === null ||
        (Number.isSafeInteger(Number(sourceFrame)) && Number(sourceFrame) >= 0 &&
         Number(sourceFrame) <= targetFrame)) &&
      finiteNumber(session.sourceWidth) > 0 && finiteNumber(session.sourceHeight) > 0 &&
      finiteNumber(session.canvasRect?.width) > 0 && finiteNumber(session.canvasRect?.height) > 0;
  }

  function disableInput({ preservePassiveDisplay = true } = {}) {
    const disabledSession = currentSession;
    const disabledFrameState = { ...activeFrameState };
    const previewWasDisplayed = disabledSession &&
      disabledFrameState.sessionId === disabledSession.sessionId &&
      disabledFrameState.previewed === true;
    const disabledTargetFrame = previewWasDisplayed
      ? disabledFrameState.targetFrame
      : disabledSession?.targetFrame;
    const disabledCandidate = disabledSession && Number.isSafeInteger(disabledTargetFrame)
      ? sceneStore.getActiveFrameCandidate(disabledTargetFrame)
      : null;
    const disabledSourceFrame = disabledCandidate?.accepted === true
      ? disabledCandidate.sourceFrame
      : previewWasDisplayed
        ? disabledFrameState.sourceFrame
        : disabledSession?.sourceFrame ?? null;
    const discardedProvisional = sceneStore.getDiagnostics().provisional === true;
    cancelPendingPointerdownFrame();
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
    resetActiveFrameState();
    if (preservePassiveDisplay && disabledSession) {
      passiveDisplaySession = {
        hostGeneration: disabledSession.hostGeneration,
        videoGeneration: disabledSession.videoGeneration,
        stableVideoIdentity: disabledSession.stableVideoIdentity,
        targetFrame: disabledTargetFrame,
        sourceFrame: disabledSourceFrame,
        sourceWidth: disabledSession.sourceWidth,
        sourceHeight: disabledSession.sourceHeight,
        canvasRect: { ...disabledSession.canvasRect },
        viewportRevision: disabledSession.viewportRevision,
        viewportTransform: { ...disabledSession.viewportTransform }
      };
      presentationState.hostGeneration = disabledSession.hostGeneration;
      presentationState.videoGeneration = disabledSession.videoGeneration;
      presentationState.stableVideoIdentity = disabledSession.stableVideoIdentity;
      presentationState.targetFrame = passiveDisplaySession.targetFrame;
      presentationState.sourceFrame = passiveDisplaySession.sourceFrame;
    } else if (!preservePassiveDisplay) {
      passiveDisplaySession = null;
    }
    if (previewWasDisplayed) {
      lastPaintedScene = disabledSourceFrame === null
        ? null
        : {
          stableVideoIdentity: disabledSession.stableVideoIdentity,
          targetFrame: disabledSourceFrame
        };
    } else if (disabledCandidate?.accepted === true) {
      lastPaintedScene = disabledSourceFrame === null
        ? null
        : {
          stableVideoIdentity: disabledSession.stableVideoIdentity,
          targetFrame: disabledSourceFrame
        };
    } else if (discardedProvisional && disabledSession) {
      lastPaintedScene = disabledSession.sourceFrame === null
        ? null
        : {
          stableVideoIdentity: disabledSession.stableVideoIdentity,
          targetFrame: disabledSession.sourceFrame
        };
    }
    if (!previewWasDisplayed) repaintLastPaintedScene();
    syncPersistenceBadge();
  }

  function releaseSurfaceResources() {
    endSizeAdjustGesture();
    cancelStrokeEraseGesture();
    cancelShapeGesture();
    resetOverlayModifierState();
    cancelPendingPointerdownFrame();
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
    resetPassivePresentationState();
    viewportElement = null;
    canvasElement = null;
    toolbar = null;
    paletteShell = null;
    brushControls = null;
    selectionControls = null;
    eraserModeControls = null;
    shapeMenuControls = null;
    brushStatusRow = null;
    recentColorControls = null;
    outlineControls = null;
    badge = null;
    sizeAdjustHud = null;
    sizeAdjustHudLabel = null;
    cancelSizeAdjustHudTimer();
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
      // 도구 줄은 아이콘 5개 한 줄이다 — 브러시·펜·지우개·도형▾·선택.
      // 도형 4종은 드롭다운으로 접히므로 190px 팔레트에서도 라벨이 잘리지 않는다.
      const brushButton = iconToolbarButton(
        createButton('', 'brush'), '브러시 도구 (B)', TOOL_ICON_SVG.brush);
      const penButton = iconToolbarButton(
        createButton('', 'pen'), '펜 도구', TOOL_ICON_SVG.pen);
      const eraserButton = iconToolbarButton(
        createButton('', 'eraser'), '지우개 도구', TOOL_ICON_SVG.eraser);
      const selectButton = iconToolbarButton(
        createButton('', 'select'), '선택 도구 (V)', TOOL_ICON_SVG.select);
      shapeMenuControls = createShapeMenuControls();
      const undoButton = labelToolbarButton(createButton('실행 취소', 'undo'), '실행 취소 (Ctrl+Z)');
      const redoButton = labelToolbarButton(createButton('다시 실행', 'redo'), '다시 실행 (Ctrl+Y)');
      const deleteButton = labelToolbarButton(
        createButton('선택 삭제', 'delete-selection'),
        '선택한 획 삭제 (Delete)'
      );
      const clearButton = labelToolbarButton(
        createButton('전체 지우기', 'clear-session'),
        '현재 프레임 드로잉 전체 삭제'
      );
      brushControls = createBrushSettingsControls();
      brushStatusRow = createBrushStatusRow();
      recentColorControls = brushControls.recentColors;
      outlineControls = brushControls.outline;
      selectionControls = createSelectionControls();
      eraserModeControls = createEraserModeControls();
      badge = documentRef.createElement('span');
      badge.className = 'mpv-fabric-pilot-badge';
      badge.setAttribute?.('role', 'status');
      badge.setAttribute?.('aria-live', 'polite');
      badge.setAttribute?.('aria-atomic', 'true');
      syncPersistenceBadge();
      // 크기 조절 HUD는 팔레트 레이아웃 계산에 섞이면 안 되므로 surface 직속으로 붙인다.
      sizeAdjustHud = createSizeAdjustHud();
      // 레거시 #drawingTools 팔레트 셸(헤더 드래그 + 접기 + 세로 섹션)을 그대로 계승한다
      paletteShell = createFabricDrawingPalette({
        documentRef,
        windowRef,
        element: toolbar,
        setStyles,
        addDomListener,
        // 섹션을 펼치면 셸이 붙임 패널의 인라인 표시를 비운다. 그 직후 소유자가
        // 자기 상태를 다시 써야 접혀 있는 동안 바뀐 값이 반영된다.
        onSectionToggle: () => {
          syncBrushControls();
          applyShapeMenuVisibility();
        },
        sections: [
          {
            id: 'tools',
            label: '도구',
            layout: 'grid',
            columns: 5,
            gap: '3px',
            items: [
              brushButton, penButton, eraserButton, shapeMenuControls.button, selectButton
            ],
            appended: [shapeMenuControls.flyout]
          },
          { id: 'brush-status', items: [brushStatusRow.row] },
          { id: 'selection', items: [selectionControls.group] },
          { id: 'eraser', label: '지우개 방식', items: [eraserModeControls.group] },
          {
            id: 'brush',
            label: '브러시 설정',
            items: [brushControls.settingsButton],
            appended: [brushControls.panel]
          },
          {
            id: 'actions',
            label: '편집',
            items: [undoButton, redoButton, deleteButton, clearButton]
          },
          { id: 'status', items: [badge] }
        ]
      });
      viewportElement.appendChild(canvasElement);
      container.appendChild(viewportElement);
      container.appendChild(toolbar);
      container.appendChild(sizeAdjustHud);
      root.appendChild(container);
      paletteShell.restore();

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
      for (const [toolButton, toolName] of [
        [brushButton, 'brush'],
        [penButton, 'pen'],
        [eraserButton, 'eraser'],
        [selectButton, 'select']
      ]) {
        addDomListener(toolButton, 'click', () => updateLocalDrawingTool(toolName));
      }
      // 도형 버튼: 이미 도형 도구를 쓰고 있으면 메뉴만 여닫고, 아니면 마지막에 쓴
      // 도형으로 바로 전환한다. 새 상태를 만들지 않고 기존 경로를 그대로 부른다.
      addDomListener(shapeMenuControls.button, 'click', () => {
        const active = FABRIC_SHAPE_TOOLS.includes(sceneStore.getDiagnostics().tool);
        if (active) {
          setShapeMenuOpen(!shapeMenuOpen);
          return;
        }
        updateLocalDrawingTool(lastShapeTool);
        setShapeMenuOpen(true);
      });
      for (const [shapeTool, shapeButton] of shapeMenuControls.shapeButtons) {
        addDomListener(shapeButton, 'click', () => {
          updateLocalDrawingTool(shapeTool);
          setShapeMenuOpen(false);
        });
      }
      addDomListener(eraserModeControls.pixelButton, 'click', () => setEraserMode('pixel'));
      addDomListener(eraserModeControls.strokeButton, 'click', () => setEraserMode('stroke'));
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

    endSizeAdjustGesture();
    cancelStrokeEraseGesture();
    cancelShapeGesture();
    resetOverlayModifierState();
    cancelPendingPointerdownFrame();
    abortPendingLassoSelection();
    if (activeStroke) cancelActiveStroke();
    if (activeLasso) cancelActiveLasso();
    if (selectGesture || transformStart || deferredViewport) cancelSelectInteraction();

    if (!request.enabled) {
      const ownerChanged = Number(request.hostGeneration) !== tokenState.hostGeneration ||
        Number(request.videoGeneration) !== tokenState.videoGeneration;
      tokenState.hostGeneration = Number(request.hostGeneration);
      tokenState.videoGeneration = Number(request.videoGeneration);
      tokenState.inputRevision = Number(request.inputRevision);
      const lastTool = normalizeFabricDrawingTool(currentSession?.tool);
      disableInput({ preservePassiveDisplay: !ownerChanged });
      if (ownerChanged) {
        resetPassivePresentationState();
      }
      resetActiveFrameState();
      metrics.recordToggleLatency(now() - startedAt);
      return { accepted: true, enabled: false, tool: lastTool };
    }

    const session = {
      ...clonePlain(request.session),
      targetFrame: Number(request.session.targetFrame),
      sourceFrame: request.session.sourceFrame === null || request.session.sourceFrame === undefined
        ? null
        : Number(request.session.sourceFrame),
      sourceWidth: Number(request.session.sourceWidth),
      sourceHeight: Number(request.session.sourceHeight),
      hostGeneration: Number(request.hostGeneration),
      videoGeneration: Number(request.videoGeneration),
      viewportRevision: Math.max(-1, Math.trunc(Number(request.session.viewportRevision) || 0)),
      viewportTransform: normalizeViewportTransform(request.session.viewportTransform),
      tool: normalizeFabricDrawingTool(request.session.tool)
    };
    const activation = typeof sceneStore.replaceActiveSession === 'function'
      ? sceneStore.replaceActiveSession(session)
      : sceneStore.activateSession(session);
    if (!activation.accepted) {
      metrics.recordStaleMessageDrop();
      return activation;
    }
    session.sourceFrame = activation.sourceFrame;
    tokenState.hostGeneration = Number(request.hostGeneration);
    tokenState.videoGeneration = Number(request.videoGeneration);
    tokenState.inputRevision = Number(request.inputRevision);
    currentSession = session;
    passiveDisplaySession = null;
    resetActiveFrameState(session);
    presentationState.hostGeneration = session.hostGeneration;
    presentationState.videoGeneration = session.videoGeneration;
    presentationState.stableVideoIdentity = session.stableVideoIdentity;
    presentationState.targetFrame = session.targetFrame;
    presentationState.sourceFrame = session.sourceFrame;
    applyViewport(session);
    renderActiveScene({ immediate: true });
    lastPaintedScene = {
      stableVideoIdentity: session.stableVideoIdentity,
      targetFrame: session.targetFrame
    };
    setToolMode(session.tool);
    inputEnabled = true;
    setSurfaceInput(true);
    syncPersistenceBadge(session.targetFrame);
    metrics.recordToggleLatency(now() - startedAt);
    return { accepted: true, enabled: true, restored: activation.restored };
  }

  function hydrateDrawingVideo(request = {}) {
    if (destroyed || !prepared) {
      return {
        accepted: false,
        reason: destroyed ? 'destroyed' : 'not-prepared'
      };
    }
    if (inputEnabled) return { accepted: false, reason: 'input-enabled' };
    if (typeof sceneStore.hydrateVideo !== 'function') {
      return { accepted: false, reason: 'persistence-unavailable' };
    }
    try {
      const result = sceneStore.hydrateVideo(clonePlain(request));
      if (result?.accepted === true) {
        if (passiveDisplaySession &&
            passiveDisplaySession.stableVideoIdentity !==
              String(request?.stableVideoIdentity || '')) {
          resetPassivePresentationState();
        }
        if (lastPaintedScene &&
            lastPaintedScene.stableVideoIdentity === String(request?.stableVideoIdentity || '')) {
          // 수화는 같은 objectId를 유지한 채 내용(pathData·transform)만 바꿀 수 있으므로
          // id 비교를 생략하고 강제 재도색하며(disable 배선은 기본 호출 = id 비교 유지),
          // 수화 결과에 이 프레임 키프레임이 없으면 '삭제 확정'이므로 캔버스를 비운다
          repaintLastPaintedScene({ force: true, clearWhenMissing: true });
        } else if (lastPaintedScene) {
          // 다른 영상의 수화: 이전 영상 잔상이 새 영상 위에 남지 않게 캔버스를 비운다
          lastPaintedScene = null;
          if (fabricCanvas) {
            fabricCanvas.clear();
            if (typeof fabricCanvas.renderAll === 'function') fabricCanvas.renderAll();
            else fabricCanvas.requestRenderAll();
          }
        }
      }
      return result;
    } catch (_error) {
      return { accepted: false, reason: 'invalid-hydration-request' };
    }
  }

  function presentDrawingFrame(request = {}) {
    if (destroyed || !prepared) {
      return { accepted: false, reason: destroyed ? 'destroyed' : 'not-prepared' };
    }
    if (inputEnabled) return { accepted: false, reason: 'input-enabled' };
    if (!validatePresentationRequest(request)) {
      return { accepted: false, reason: 'invalid-presentation-request' };
    }
    if (request.presentationRevision <= presentationState.presentationRevision) {
      return { accepted: false, reason: 'stale-presentation-revision' };
    }
    if ((tokenState.hostGeneration >= 0 &&
         request.hostGeneration !== tokenState.hostGeneration) ||
        (tokenState.videoGeneration >= 0 &&
         request.videoGeneration !== tokenState.videoGeneration)) {
      return { accepted: false, reason: 'stale-presentation-fence' };
    }
    if (typeof sceneStore.getPresentationScene !== 'function') {
      return { accepted: false, reason: 'persistence-unavailable' };
    }

    let resolved;
    try {
      resolved = sceneStore.getPresentationScene(request);
    } catch (_error) {
      return { accepted: false, reason: 'invalid-presentation-request' };
    }
    if (resolved?.accepted !== true) return resolved;

    try {
      const displaySession = {
        hostGeneration: request.hostGeneration,
        videoGeneration: request.videoGeneration,
        stableVideoIdentity: request.stableVideoIdentity,
        targetFrame: request.targetFrame,
        sourceFrame: request.sourceFrame,
        sourceWidth: request.sourceWidth,
        sourceHeight: request.sourceHeight,
        canvasRect: { ...request.canvasRect },
        viewportRevision: request.viewportRevision,
        viewportTransform: { ...request.viewportTransform }
      };
      applyViewport(displaySession);
      const sameSource = presentationState.hostGeneration === request.hostGeneration &&
        presentationState.videoGeneration === request.videoGeneration &&
        presentationState.stableVideoIdentity === request.stableVideoIdentity &&
        presentationState.storeRevision === request.storeRevision &&
        presentationState.sourceFrame === request.sourceFrame;
      const snapshot = resolved.snapshot;
      const records = snapshot?.objects || [];
      if (!sameSource) {
        const paths = records.map(record => makeFabricPath(record));
        for (const path of paths) path.set({ selectable: false, evented: false });
        fabricCanvas.clear();
        for (const path of paths) fabricCanvas.add(path);
      } else {
        for (const object of fabricCanvas.getObjects()) {
          object.set?.({ selectable: false, evented: false });
        }
      }
      fabricCanvas.discardActiveObject();
      if (typeof fabricCanvas.renderAll === 'function') fabricCanvas.renderAll();
      else fabricCanvas.requestRenderAll();

      presentationState.hostGeneration = request.hostGeneration;
      presentationState.videoGeneration = request.videoGeneration;
      presentationState.presentationRevision = request.presentationRevision;
      presentationState.stableVideoIdentity = request.stableVideoIdentity;
      presentationState.storeRevision = request.storeRevision;
      presentationState.targetFrame = request.targetFrame;
      presentationState.sourceFrame = request.sourceFrame;
      passiveDisplaySession = displaySession;
      lastPaintedScene = request.sourceFrame === null
        ? null
        : {
          stableVideoIdentity: request.stableVideoIdentity,
          targetFrame: request.sourceFrame
        };
      return {
        accepted: true,
        targetFrame: request.targetFrame,
        sourceFrame: request.sourceFrame
      };
    } catch (error) {
      lastError = error.message;
      metrics.recordSurfaceError();
      return { accepted: false, reason: 'presentation-render-failed' };
    }
  }

  function updateDrawingFrame(request = {}) {
    if (destroyed || !prepared) {
      return { accepted: false, reason: destroyed ? 'destroyed' : 'not-prepared' };
    }
    if (!inputEnabled || !currentSession) {
      return { accepted: false, reason: 'input-disabled' };
    }
    if (!validateActiveFrameRequest(request)) {
      return { accepted: false, reason: 'invalid-active-frame-request' };
    }
    if (request.hostGeneration !== tokenState.hostGeneration ||
        request.videoGeneration !== tokenState.videoGeneration ||
        request.inputRevision !== tokenState.inputRevision ||
        request.sessionId !== currentSession.sessionId) {
      return { accepted: false, reason: 'stale-active-frame-fence' };
    }
    if (request.frameRevision <= activeFrameState.frameRevision) {
      return { accepted: false, reason: 'stale-active-frame-revision' };
    }
    const candidate = sceneStore.getActiveFrameCandidate(request.targetFrame);
    if (!candidate?.accepted) return candidate;

    const stagedFrameState = {
      hostGeneration: request.hostGeneration,
      videoGeneration: request.videoGeneration,
      inputRevision: request.inputRevision,
      sessionId: request.sessionId,
      frameRevision: request.frameRevision,
      targetFrame: request.targetFrame,
      sourceFrame: candidate.sourceFrame,
      sourceSceneInstanceId: candidate.sceneInstanceId,
      sourceMutationSequence: candidate.mutationSequence
    };
    const preview = renderArmedFramePreview(stagedFrameState);
    if (!preview?.accepted) return preview;
    publishActiveFramePreview(stagedFrameState, preview);
    return {
      accepted: true,
      frameRevision: request.frameRevision,
      targetFrame: request.targetFrame,
      sourceFrame: preview.sourceFrame,
      deferred: preview.deferred === true,
      repainted: preview.repainted === true
    };
  }

  function exportDrawingVideo(request = {}) {
    if (destroyed || !prepared) {
      return {
        accepted: false,
        reason: destroyed ? 'destroyed' : 'not-prepared'
      };
    }
    if (typeof sceneStore.exportVideo !== 'function') {
      return { accepted: false, reason: 'persistence-unavailable' };
    }
    try {
      return sceneStore.exportVideo(clonePlain(request));
    } catch (_error) {
      return { accepted: false, reason: 'invalid-export-request' };
    }
  }

  function updateViewport(command = {}) {
    const viewportSession = inputEnabled ? currentSession : passiveDisplaySession;
    if (!viewportSession) return { accepted: false, reason: 'input-disabled' };
    const revision = Number(command.revision);
    const rect = command.canvasRect;
    if (!Number.isInteger(revision) || revision < 0 ||
        !rect || finiteNumber(rect.width) <= 0 || finiteNumber(rect.height) <= 0) {
      return { accepted: false, reason: 'invalid-viewport' };
    }
    const pendingRevision = inputEnabled ? deferredViewport?.command?.revision ?? -1 : -1;
    if (revision <= Math.max(viewportSession.viewportRevision, pendingRevision)) {
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
    if (!inputEnabled) {
      passiveDisplaySession.canvasRect = { ...normalizedCommand.canvasRect };
      passiveDisplaySession.viewportTransform = normalizeViewportTransform(normalizedCommand);
      passiveDisplaySession.viewportRevision = revision;
      applyViewport(passiveDisplaySession);
      return { accepted: true, revision };
    }
    if (activeLasso || selectGesture || transformStart !== null) {
      deferredViewport = {
        sessionId: currentSession.sessionId,
        inputRevision: tokenState.inputRevision,
        command: normalizedCommand
      };
      return { accepted: true, deferred: true, revision };
    }

    // 진행 중인 제스처의 좌표는 전부 이전 뷰포트로 매핑돼 있다. 그대로 두면
    // 다음 표본이 새 뷰포트로 매핑돼 두 좌표계 사이에 있지도 않은 획이 생긴다.
    // 도형은 끝점만 어긋나 찌그러지고, 지우개는 그 가짜 스윕이 지나가지도 않은
    // 획을 지운다. 자유 획과 같이 전부 취소한다.
    cancelActiveStroke();
    cancelShapeGesture();
    cancelStrokeEraseGesture();
    applyViewportCommand(normalizedCommand);
    return { accepted: true, revision };
  }

  function updateDrawingTool(command = {}) {
    if (!inputEnabled) return { accepted: false, reason: 'input-disabled' };
    const normalized = { ...command, tool: command.tool === 'V' ? 'select' : command.tool };
    const result = sceneStore.updateTool(normalized);
    if (!result.accepted) {
      metrics.recordStaleMessageDrop();
      return result;
    }
    currentSession.tool = result.tool;
    setToolMode(result.tool);
    return result;
  }

  // 브러시 크기 원격 변경. 도구 변경과 같은 토큰 규약을 쓰되 revision 은 별도로 센다.
  // 크기는 씬 스키마와 무관한 입력 계층 상태이므로 히스토리에 남기지 않는다.
  // step 은 현재 굵기 기준 상대 증감이다. 팔레트 슬라이더와 Alt 드래그는 오버레이
  // 안에서만 굵기를 바꾸므로 컨트롤러가 든 값은 언제든 낡을 수 있다. 절대값을 받으면
  // 20px 로 바꾼 뒤 ] 를 눌렀을 때 21 이 아니라 4 가 되어 버린다.
  function updateDrawingBrush(command = {}) {
    if (!inputEnabled) return { accepted: false, reason: 'input-disabled' };
    const step = Math.trunc(Number(command.step));
    const size = setBrushSize(
      Number.isInteger(step) && step !== 0 ? brushStyle.size + step : command.size
    );
    flashSizeAdjustHudAtViewportCenter(size);
    return { accepted: true, size };
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
    const hasExplicitTarget = command.targetFrame !== undefined;
    const targetFrame = hasExplicitTarget ? Number(command.targetFrame) : activeFrameState.targetFrame;
    if (!Number.isSafeInteger(targetFrame) || targetFrame < 0) {
      return { applied: false, reason: 'invalid-action-target' };
    }
    if (!actionDeduper.accept(command.actionId)) {
      metrics.recordDuplicateAction();
      return { applied: false, duplicate: true };
    }
    const retargeted = hasExplicitTarget
      ? retargetFrameForMutation(targetFrame)
      : retargetArmedFrameForMutation();
    if (!retargeted?.accepted) {
      actionDeduper.release?.(command.actionId);
      return { applied: false, reason: retargeted?.reason || 'retarget-failed' };
    }
    if (pendingLassoSelection) {
      if (action === 'delete-selection') {
        const result = commitPendingLassoDelete();
        settleArmedFramePreview();
        return result;
      }
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
        // 전역 실행취소가 다른 키프레임을 되돌린 경우 화면에는 아무 변화가 없다.
        // 그때까지 캔버스를 다시 그리고 도구 모드를 재설정하면 헛일이고, 사용자의
        // 활성 선택만 사라진다. 활성 씬이 실제로 바뀐 경우에만 손댄다.
        // !== false 로 쓰는 이유: 이 필드 없이 도달하는 경로는 안전한 쪽(재도색)이 기본이어야 한다.
        let repainted = false;
        if (result.affectedActiveScene !== false) {
          // 오버레이는 투명 BrowserWindow 라 requestRenderAll 의 다음 프레임을 기다리면
          // 지워진 획이 잠깐 남아 보인다. 여기서 동기로 그려 두고, 호스트가 응답을 받아
          // invalidate() 로 합성을 강제한다(updateDrawingFrame 의 repainted 규약과 동일).
          renderActiveScene({ immediate: true });
          fabricCanvas.discardActiveObject();
          sceneStore.selectObjects([]);
          setToolMode(currentSession?.tool || 'brush');
          repainted = true;
        }
        updateObjectMetric();
        settleArmedFramePreview();
        return { ...result, repainted, keyframeSetChanged: result.keyframeSetChanged === true };
      }
      const deletedIds = new Set(result.deletedIds);
      for (const object of fabricCanvas.getObjects()) {
        if (action === 'clear-session' || deletedIds.has(object.__baeframeObjectId)) fabricCanvas.remove(object);
      }
      fabricCanvas.discardActiveObject();
      refreshSelectionInteractionPolicy();
      // 삭제·전체 지우기도 같은 이유로 동기 렌더 후 합성을 강제한다.
      if (typeof fabricCanvas.renderAll === 'function') {
        fabricCanvas.renderAll();
      } else {
        fabricCanvas.requestRenderAll();
      }
      updateObjectMetric();
      settleArmedFramePreview();
      return { ...result, repainted: true };
    }
    settleArmedFramePreview();
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
      gestures: {
        altSizeAdjustActive: !!sizeAdjustGesture,
        ctrlStrokeEraseActive: !!strokeEraseGesture,
        strokeEraseCandidateCount: strokeEraseGesture ? strokeEraseGesture.erasedIds.size : 0,
        modifierAlt: overlayModifierState.alt,
        modifierCtrl: overlayModifierState.ctrl,
        overlayAltKeyDownCount: gestureProbe.overlayAltKeyDownCount,
        overlayCtrlKeyDownCount: gestureProbe.overlayCtrlKeyDownCount,
        lastPointerdown: gestureProbe.lastPointerdown
          ? { ...gestureProbe.lastPointerdown }
          : null
      },
      presentationRevision: presentationState.presentationRevision,
      presentedStableVideoIdentity: currentSession?.stableVideoIdentity ??
        presentationState.stableVideoIdentity,
      presentedStoreRevision: presentationState.storeRevision,
      presentedTargetFrame: currentSession?.targetFrame ?? presentationState.targetFrame,
      presentedSourceFrame: currentSession
        ? currentSession.sourceFrame
        : presentationState.sourceFrame,
      activeFrameRevision: activeFrameState.frameRevision,
      armedTargetFrame: activeFrameState.targetFrame,
      armedSourceFrame: activeFrameState.sourceFrame,
      provisional: scene.provisional === true,
      activeSessionId: scene.activeSessionId,
      activeSceneKey: scene.activeSceneKey,
      targetFrame: currentSession?.targetFrame ?? null,
      viewportRevision: currentSession?.viewportRevision ??
        passiveDisplaySession?.viewportRevision ?? null,
      tool: scene.tool,
      selectionTarget,
      selectionShape,
      eraserMode,
      // 진행 중 지우기 제스처가 시작 시점에 래치한 모드. 드래그 도중 팔레트를 눌러도
      // 이 값은 바뀌지 않는다.
      activeEraseMode: strokeEraseGesture ? strokeEraseGesture.mode : null,
      selectionControlEventCount,
      lastSelectionControlAction: lastSelectionControlAction
        ? clonePlain(lastSelectionControlAction)
        : null,
      activeSelectionGesture: activeLasso
        ? {
          target: selectionTarget,
          shape: activeLasso.shape,
          pointerPointCount: activeLasso.points.length
        }
        : null,
      lastSelectionGesture: lastSelectionGesture ? clonePlain(lastSelectionGesture) : null,
      objectCount: scene.objectCount,
      selectionCount: scene.selectionCount,
      mutationCount: scene.mutationCount,
      dirty: scene.dirty,
      undoDepth: scene.undoDepth,
      redoDepth: scene.redoDepth,
      globalUndoDepth: scene.globalUndoDepth,
      globalRedoDepth: scene.globalRedoDepth,
      undoBytes: scene.undoBytes,
      historyBytes: scene.historyBytes,
      cache: {
        videoCount: scene.videoCount,
        sceneCount: scene.sceneCount,
        estimatedBytes: scene.estimatedBytes,
        evictionCount: scene.evictionCount
      },
      drawingPersistence: {
        videoCount: drawingV3Count(scene.persistenceVideoCount),
        observerFailureCount: drawingV3Count(scene.persistenceObserverFailureCount),
        unboundCommitCount: drawingV3Count(scene.persistenceUnboundCommitCount)
      },
      drawingV3Shadow: getDrawingV3Diagnostics(),
      metrics: metrics.snapshot(),
      lastError
    };
  }

  function destroy() {
    if (destroyed) return { destroyed: true, reused: true };
    lastPaintedScene = null;
    disableInput();
    releaseSurfaceResources();
    strokeFillGeometryCache.clear();
    strokeFillGeometryCacheWeight = 0;
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
    hydrateDrawingVideo,
    presentDrawingFrame,
    updateDrawingFrame,
    confirmDrawingPointerdownFrame,
    exportDrawingVideo,
    updateDrawingTool,
    updateDrawingBrush,
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
  shapeCenterlinePoints,
  shapeCenterlineSamples,
  createActionDeduper,
  shouldAcceptInputRequest,
  resolveEffectiveCanvasRect,
  resolveSelectionHitTolerance,
  mapClientPointToSource,
  splitStrokePointsByPolygon
};
