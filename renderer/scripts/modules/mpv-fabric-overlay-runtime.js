'use strict';

const {
  createFabricDrawingPilotMetrics
} = require('./fabric-drawing-pilot-metrics.js');

const SCENE_KEY_SEPARATOR = '\u0000';
const DEFAULT_MAX_VIDEOS = 10;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_ACTIONS = 2048;
const MAX_STROKE_POINTS = 20000;
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

function createSessionSceneStore(options = {}) {
  const maxVideos = positiveInteger(options.maxVideos, DEFAULT_MAX_VIDEOS);
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxObjects = positiveInteger(options.maxObjects, DEFAULT_MAX_OBJECTS);
  const estimateObjectBytes = typeof options.estimateObjectBytes === 'function'
    ? options.estimateObjectBytes
    : defaultEstimateObjectBytes;
  const scenes = new Map();
  const videoAccess = new Map();
  let accessClock = 0;
  let latestVideoGeneration = -1;
  let activeSession = null;
  let evictionCount = 0;

  function activeScene() {
    return activeSession ? scenes.get(activeSession.sceneKey) || null : null;
  }

  function touchVideo(stableVideoIdentity) {
    accessClock += 1;
    videoAccess.delete(stableVideoIdentity);
    videoAccess.set(stableVideoIdentity, accessClock);
  }

  function calculateEstimatedBytes() {
    let total = 0;
    for (const scene of scenes.values()) total += scene.estimatedBytes;
    return total;
  }

  function evictVideo(stableVideoIdentity) {
    for (const [key, scene] of scenes) {
      if (scene.stableVideoIdentity === stableVideoIdentity) scenes.delete(key);
    }
    videoAccess.delete(stableVideoIdentity);
    evictionCount += 1;
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
  }

  function recalculateSceneBytes(scene) {
    scene.estimatedBytes = [...scene.objects.values()].reduce((total, object) => {
      const estimated = finiteNumber(estimateObjectBytes(object), 1);
      return total + Math.max(1, estimated);
    }, 0);
  }

  function activateSession(session) {
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
        stableVideoIdentity: session.stableVideoIdentity,
        targetFrame,
        objects: new Map(),
        selectedObjectIds: new Set(),
        dirty: false,
        mutationCount: 0,
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
    return { accepted: true, restored, sceneKey };
  }

  function deactivateSession(sessionId) {
    if (!activeSession) return { accepted: true, active: false };
    if (sessionId && sessionId !== activeSession.sessionId) {
      return { accepted: false, reason: 'stale-session' };
    }
    activeScene()?.selectedObjectIds.clear();
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
    scene.objects.set(record.id, record);
    recalculateSceneBytes(scene);
    enforceLimits();
    if (calculateEstimatedBytes() > maxBytes) {
      scene.objects.delete(record.id);
      recalculateSceneBytes(scene);
      return { applied: false, reason: 'scene-capacity-exceeded' };
    }
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
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
    let changed = false;
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
      object.transform = next;
      changed = true;
      changedIds.push(id);
    }

    if (!changed) return { applied: false, objectIds: [] };
    recalculateSceneBytes(scene);
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
    return { applied: true, objectIds: changedIds };
  }

  function deleteSelection() {
    const scene = activeScene();
    if (!scene || scene.selectedObjectIds.size === 0) {
      return { applied: false, deletedCount: 0, deletedIds: [] };
    }
    const deletedIds = [];
    for (const id of scene.selectedObjectIds) {
      if (!scene.objects.delete(id)) continue;
      deletedIds.push(id);
    }
    scene.selectedObjectIds.clear();
    if (deletedIds.length === 0) return { applied: false, deletedCount: 0, deletedIds };
    recalculateSceneBytes(scene);
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
    return { applied: true, deletedCount: deletedIds.length, deletedIds };
  }

  function clearSession() {
    const scene = activeScene();
    const deletedCount = scene?.objects.size || 0;
    if (!scene || deletedCount === 0) return { applied: false, deletedCount: 0, deletedIds: [] };
    const deletedIds = [...scene.objects.keys()];
    scene.objects.clear();
    scene.selectedObjectIds.clear();
    recalculateSceneBytes(scene);
    noteMutation(scene);
    touchVideo(scene.stableVideoIdentity);
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
    return {
      maxVideos,
      maxBytes,
      maxObjects,
      videoCount: videoAccess.size,
      sceneCount: scenes.size,
      estimatedBytes: calculateEstimatedBytes(),
      evictionCount,
      latestVideoGeneration,
      activeSessionId: activeSession?.sessionId || null,
      activeSceneKey: activeSession?.sceneKey || null,
      tool: activeSession?.tool || null,
      toolRevision: activeSession?.toolRevision ?? -1,
      objectCount: scene?.objects.size || 0,
      selectionCount: scene?.selectedObjectIds.size || 0,
      mutationCount: scene?.mutationCount || 0,
      dirty: scene?.dirty || false,
      sceneKeys: [...scenes.keys()]
    };
  }

  function destroy() {
    scenes.clear();
    videoAccess.clear();
    activeSession = null;
  }

  return {
    activateSession,
    deactivateSession,
    addStroke,
    selectObjects,
    transformSelection,
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
  const sceneStore = options.sceneStore || createSessionSceneStore(options.sceneStoreOptions);
  const actionDeduper = options.actionDeduper || createActionDeduper(options.actionDeduperOptions);
  const strokePathFactory = options.strokePathFactory || createStrokePathData;
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
  let brushStyle = { ...DEFAULT_BRUSH_STYLE };
  let brushControls = null;
  let brushPanelOpen = false;
  let transformStart = null;
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
      lockSkewingY: true,
      hoverCursor: 'grab',
      moveCursor: 'grabbing'
    });
    object.setCoords?.();
  }

  function restoreUnsupportedTransform(object, persistedTransform = {}) {
    const values = {};
    for (const field of UNSUPPORTED_PHASE0_TRANSFORM_FIELDS) {
      const fallback = field === 'scaleX' || field === 'scaleY' ? 1 : field === 'flipX' || field === 'flipY' ? false : 0;
      values[field] = persistedTransform[field] ?? fallback;
    }
    object.set(values);
    applyMoveOnlyConstraints(object);
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
    if (!transient) applyMoveOnlyConstraints(path);
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
    fabricCanvas.requestRenderAll();
    updateObjectMetric();
  }

  function setToolMode(tool) {
    if (!fabricCanvas) return;
    const selectMode = tool === 'select';
    for (const [buttonTool, button] of toolButtons) {
      const active = buttonTool === tool;
      button.dataset.active = String(active);
      button.setAttribute?.('aria-pressed', String(active));
    }
    fabricCanvas.isDrawingMode = false;
    fabricCanvas.selection = selectMode;
    fabricCanvas.defaultCursor = selectMode ? 'default' : 'crosshair';
    fabricCanvas.hoverCursor = 'grab';
    fabricCanvas.moveCursor = 'grabbing';
    fabricCanvas.freeDrawingCursor = 'crosshair';
    fabricCanvas.setCursor?.(fabricCanvas.defaultCursor);
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      object.set({ selectable: selectMode, evented: selectMode });
      applyMoveOnlyConstraints(object);
    }
    if (!selectMode) {
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
    }
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
    fabricCanvas?.requestRenderAll();
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

  function onPointerDown(event) {
    if (!inputEnabled || sceneStore.getDiagnostics().tool !== 'brush' || event.button !== 0 || activeStroke) return;
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
  }

  function onPointerMove(event) {
    if (!activeStroke || event.pointerId !== activeStroke.pointerId) return;
    const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [event];
    for (const sample of samples) appendPointerSample(sample);
    updateTransientPreview();
    event.preventDefault?.();
  }

  function onPointerUp(event) {
    if (!activeStroke || event.pointerId !== activeStroke.pointerId) return;
    appendPointerSample(event);
    event.currentTarget?.releasePointerCapture?.(event.pointerId);
    finalizeActiveStroke();
    event.preventDefault?.();
  }

  function onPointerCancel(event) {
    if (!activeStroke || (event.pointerId !== undefined && event.pointerId !== activeStroke.pointerId)) return;
    cancelActiveStroke();
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
      fabricCanvas.setCursor?.(fabricCanvas.defaultCursor || 'default');
      fabricCanvas.requestRenderAll();
    });
  }

  function onSelectionChanged() {
    applyMoveOnlyConstraints(fabricCanvas?.getActiveObject?.());
    for (const object of fabricCanvas?.getActiveObjects?.() || []) applyMoveOnlyConstraints(object);
    sceneStore.selectObjects(selectionIds());
  }

  function onSelectionCleared() {
    sceneStore.selectObjects([]);
  }

  function onBeforeTransform(event) {
    const target = event?.transform?.target || event?.target;
    if (!target) return;
    transformStart = {
      target,
      transform: captureTransform(target)
    };
  }

  function onObjectModified(event) {
    const target = event?.target;
    if (!target) return;
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
    const shouldReleaseMultiSelection = result.applied && children.length > 1;
    transformStart = null;
    if (result.applied) updateObjectMetric();
    if (shouldReleaseMultiSelection) scheduleMovedMultiSelectionRelease(target, ids);
  }

  function configureCanvasEvents() {
    const pointerTarget = fabricCanvas.upperCanvasEl || canvasElement;
    addDomListener(pointerTarget, 'pointerdown', onPointerDown);
    addDomListener(pointerTarget, 'pointermove', onPointerMove);
    addDomListener(pointerTarget, 'pointerup', onPointerUp);
    addDomListener(pointerTarget, 'pointercancel', onPointerCancel);
    addDomListener(pointerTarget, 'lostpointercapture', onPointerCancel);
    addDomListener(windowRef, 'blur', onPointerCancel);
    addFabricListener('selection:created', onSelectionChanged);
    addFabricListener('selection:updated', onSelectionChanged);
    addFabricListener('selection:cleared', onSelectionCleared);
    addFabricListener('before:transform', onBeforeTransform);
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

  function applySelectionHitPolicy(session = currentSession) {
    if (!fabricCanvas) return;
    const tolerance = resolveSelectionHitTolerance(session || {});
    fabricCanvas.setTargetFindTolerance?.(tolerance);
    for (const object of fabricCanvas.getObjects()) {
      if (object.__baeframeTransient) continue;
      object.set({ padding: tolerance, hoverCursor: 'grab', moveCursor: 'grabbing' });
      object.setCoords?.();
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
    applySelectionHitPolicy(session);
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

  function validateSession(session) {
    return !!session &&
      typeof session.sessionId === 'string' && session.sessionId.length > 0 &&
      typeof session.stableVideoIdentity === 'string' && session.stableVideoIdentity.length > 0 &&
      Number.isInteger(Number(session.targetFrame)) && Number(session.targetFrame) >= 0 &&
      finiteNumber(session.sourceWidth) > 0 && finiteNumber(session.sourceHeight) > 0 &&
      finiteNumber(session.canvasRect?.width) > 0 && finiteNumber(session.canvasRect?.height) > 0;
  }

  function disableInput() {
    const shouldRollbackTransform = transformStart !== null;
    setSurfaceInput(false);
    fabricCanvas?.setCursor?.('default');
    cancelActiveStroke();
    if (shouldRollbackTransform && fabricCanvas && sceneStore.getActiveSceneSnapshot()) renderActiveScene();
    transformStart = null;
    fabricCanvas?.discardActiveObject();
    sceneStore.selectObjects([]);
    inputEnabled = false;
    currentSession = null;
    sceneStore.deactivateSession();
    if (badge) badge.textContent = '새 드로잉 시험판 · 저장 안 됨 · 시험 프레임 -';
  }

  function releaseSurfaceResources() {
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
    transformStart = null;
    inputEnabled = false;
    currentSession = null;
    viewportElement = null;
    canvasElement = null;
    toolbar = null;
    brushControls = null;
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
      const deleteButton = createButton('Delete', 'delete-selection');
      const clearButton = createButton('Clear', 'clear-session');
      brushControls = createBrushSettingsControls();
      badge = documentRef.createElement('span');
      badge.className = 'mpv-fabric-pilot-badge';
      badge.textContent = '새 드로잉 시험판 · 저장 안 됨 · 시험 프레임 -';
      toolbar.appendChild(brushButton);
      toolbar.appendChild(selectButton);
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
        defaultCursor: 'default',
        hoverCursor: 'grab',
        moveCursor: 'grabbing',
        freeDrawingCursor: 'crosshair'
      });
      configureCanvasEvents();
      addDomListener(brushButton, 'click', () => updateLocalDrawingTool('brush'));
      addDomListener(selectButton, 'click', () => updateLocalDrawingTool('select'));
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
    if (revision <= currentSession.viewportRevision) {
      return { accepted: false, reason: 'stale-viewport' };
    }

    cancelActiveStroke();
    if (transformStart !== null) {
      renderActiveScene();
      transformStart = null;
      fabricCanvas.discardActiveObject();
      sceneStore.selectObjects([]);
    }
    currentSession.canvasRect = {
      left: finiteNumber(rect.left),
      top: finiteNumber(rect.top),
      width: finiteNumber(rect.width),
      height: finiteNumber(rect.height)
    };
    currentSession.viewportTransform = normalizeViewportTransform(command);
    currentSession.viewportRevision = revision;
    applyViewport(currentSession);
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
    if (action !== 'delete-selection' && action !== 'clear-session') {
      return { applied: false, reason: 'invalid-action' };
    }
    if (!actionDeduper.accept(command.actionId)) {
      metrics.recordDuplicateAction();
      return { applied: false, duplicate: true };
    }

    const result = action === 'delete-selection' ? sceneStore.deleteSelection() : sceneStore.clearSession();
    if (result.applied) {
      const deletedIds = new Set(result.deletedIds);
      for (const object of fabricCanvas.getObjects()) {
        if (action === 'clear-session' || deletedIds.has(object.__baeframeObjectId)) fabricCanvas.remove(object);
      }
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
      updateObjectMetric();
    }
    return result;
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
      tool: scene.tool,
      objectCount: scene.objectCount,
      selectionCount: scene.selectionCount,
      mutationCount: scene.mutationCount,
      dirty: scene.dirty,
      cache: {
        videoCount: scene.videoCount,
        sceneCount: scene.sceneCount,
        estimatedBytes: scene.estimatedBytes,
        evictionCount: scene.evictionCount
      },
      metrics: metrics.snapshot(),
      lastError
    };
  }

  function destroy() {
    if (destroyed) return { destroyed: true, reused: true };
    disableInput();
    releaseSurfaceResources();
    sceneStore.destroy();
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

if (typeof window !== 'undefined' && window && !window.__mpvFabricOverlay) {
  window.__mpvFabricOverlay = createFabricOverlayRuntime({
    window,
    document: typeof document !== 'undefined' ? document : null
  });
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
  mapClientPointToSource
};
