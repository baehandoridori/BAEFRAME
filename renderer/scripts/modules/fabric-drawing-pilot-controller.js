const DRAWING_PROTOCOL = 'baeframe-drawing-surface';
const DRAWING_PROTOCOL_VERSION = 1;
// 오버레이로 보낼 수 있는 액션. **여기에 없으면 makeDrawingActionRequest 가 조용히
// 거절해 IPC 가 아예 나가지 않는다** — 단축키를 새로 이어도 아무 일이 일어나지 않는다.
const CONTROLLER_DRAWING_ACTIONS = new Set([
  'delete-selection',
  'undo',
  'redo',
  // 프레임·키프레임 구조 조작(레거시 2 / 3 / Shift+2 / Shift+3 / 4 / Ctrl+Alt+C·V)
  'frame-insert-blank-keyframe',
  'frame-insert',
  'frame-remove',
  'keyframe-to-frame',
  'frame-to-keyframe',
  'frame-copy',
  'frame-paste',
  // 레이어 단위 오브젝트 조작(레거시 Shift+` / Ctrl+Shift+X·C). 페이로드를 나른다.
  'layer-objects-remove',
  'layer-objects-reorder',
  'layer-model-marker'
]);
// shared/fabric-drawing-tools.js 의 FABRIC_DRAWING_TOOLS 와 같아야 한다.
// 이 파일은 브라우저 네이티브 ES 모듈이라 CommonJS 를 import 할 수 없어 리터럴을 둔다
// (shared/fabric-drawing-limits.js ↔ fabric-drawing-persistence-store.js 와 같은 구조).
// 값이 어긋나지 않도록 파리티 테스트가 대조한다.
const CONTROLLER_DRAWING_TOOLS = new Set([
  'brush', 'pen', 'eraser', 'line', 'rect', 'circle', 'arrow', 'select'
]);
const ACTIVE_FRAME_MAX_IN_FLIGHT = 2;
const ACTIVE_FRAME_OBSERVATION_LIMIT = 64;
const POINTERDOWN_FRAME_REQUEST_KEYS = [
  'hostGeneration',
  'videoGeneration',
  'inputRevision',
  'sessionId',
  'pointerdownId',
  'pointerdownAt'
];

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some(key => typeof key !== 'string')) return false;
  const actualKeys = ownKeys.sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function normalizePointerdownFrameRequest(value) {
  if (!exactKeys(value, POINTERDOWN_FRAME_REQUEST_KEYS)) return null;
  const hostGeneration = value.hostGeneration;
  const videoGeneration = value.videoGeneration;
  const inputRevision = value.inputRevision;
  const pointerdownAt = value.pointerdownAt;
  if (![hostGeneration, videoGeneration, inputRevision].every(
    number => Number.isSafeInteger(number) && number > 0
  ) || !Number.isSafeInteger(pointerdownAt) || pointerdownAt < 0 ||
      typeof value.sessionId !== 'string' || value.sessionId.length < 1 ||
      value.sessionId.length > 256 || typeof value.pointerdownId !== 'string' ||
      value.pointerdownId.length < 1 || value.pointerdownId.length > 256) {
    return null;
  }
  return {
    hostGeneration,
    videoGeneration,
    inputRevision,
    sessionId: value.sessionId,
    pointerdownId: value.pointerdownId,
    pointerdownAt
  };
}

function copyRect(rect) {
  return rect && typeof rect === 'object' ? { ...rect } : null;
}

function copyViewportTransform(transform) {
  const value = transform && typeof transform === 'object' ? transform : {};
  return {
    scale: Number(value.scale) || 1,
    panX: Number(value.panX) || 0,
    panY: Number(value.panY) || 0
  };
}

function isAcceptedInputResponse(response, enabled) {
  return response?.success === true &&
    response.accepted === true &&
    response.enabled === enabled;
}

function capabilityFrom(value) {
  if (value?.drawingCapability && typeof value.drawingCapability === 'object') {
    return value.drawingCapability;
  }
  return value;
}

function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  const tagName = String(target.tagName || '').toUpperCase();
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (typeof target.closest !== 'function') return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]');
}

function consumeKeyEvent(event) {
  event.preventDefault?.();
  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  } else {
    event.stopPropagation?.();
  }
}

function isImeKeyEvent(event = {}) {
  const key = String(event.key || '');
  const code = String(event.code || '');
  return event.isComposing === true ||
    Number(event.keyCode) === 229 ||
    ['Process', 'Dead', 'Unidentified'].includes(key) ||
    ['Process', 'Dead'].includes(code);
}

function drawingHistoryActionFromKeyEvent(event = {}) {
  const exactlyOnePrimaryModifier =
    (event.ctrlKey === true) !== (event.metaKey === true);
  if (!exactlyOnePrimaryModifier || event.altKey === true) return null;
  if (event.code === 'KeyZ') return event.shiftKey === true ? 'redo' : 'undo';
  if (event.code === 'KeyY' && event.shiftKey !== true) return 'redo';
  return null;
}

export function createFabricDrawingPilotController(options = {}) {
  const electronAPI = options.electronAPI || {};
  const getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
  // 구조 실행취소가 레이어 조작을 되돌리면 알린다. 레이어 목록·배정은 렌더러
  // 쪽에 있어서 오버레이 혼자서는 되돌릴 수 없다.
  const onLayerHistoryApplied = typeof options.onLayerHistoryApplied === 'function'
    ? options.onLayerHistoryApplied
    : () => {};
  const onHistoryFallback = typeof options.onHistoryFallback === 'function'
    ? options.onHistoryFallback
    : () => {};
  const getHistoryRevision = typeof options.getHistoryRevision === 'function'
    ? options.getHistoryRevision
    : null;
  const configuredDrawingToggleMatcher =
    typeof options.matchesDrawingToggleShortcut === 'function'
      ? options.matchesDrawingToggleShortcut
      : null;
  const configuredSelectionShortcutMatcher =
    typeof options.matchesSelectionShortcut === 'function'
      ? options.matchesSelectionShortcut
      : null;
  // app.js 가 주입한다. 이벤트를 도구 이름으로 바꿔 주며, 해당 없으면 null 이다.
  // 이 주입이 없으면 설정 UI 에서 배정한 도구 단축키가 아무 일도 하지 않는다.
  const configuredToolShortcutMatcher =
    typeof options.matchesToolShortcut === 'function'
      ? options.matchesToolShortcut
      : null;
  // app.js 가 주입하는 매처. 주입 전에는 기본 키([ / ])로 판정한다.
  const configuredBrushSizeShortcutMatcher =
    typeof options.matchesBrushSizeShortcut === 'function'
      ? options.matchesBrushSizeShortcut
      : null;
  // 프레임·키프레임 구조 조작(레거시 2 / 3 / Shift+2 / Shift+3 / 4 / Ctrl+Alt+C·V).
  // 이벤트를 오버레이 액션 이름으로 바꿔 주며 해당 없으면 null 이다. app.js 가
  // 액션 id 로 판정해 주입하므로 사용자가 키를 재지정해도 따라간다.
  const configuredFrameOperationMatcher =
    typeof options.matchesFrameOperationShortcut === 'function'
      ? options.matchesFrameOperationShortcut
      : null;
  const persistenceStore = options.persistenceStore || null;
  let fallbackId = 0;
  const uuid = typeof options.uuid === 'function'
    ? options.uuid
    : () => globalThis.crypto?.randomUUID?.() || `fabric-request-${Date.now()}-${++fallbackId}`;
  const persistenceSessionIdFactory =
    typeof options.persistenceSessionIdFactory === 'function'
      ? options.persistenceSessionIdFactory
      : () => globalThis.crypto?.randomUUID?.() || uuid();
  const wallNow = typeof options.wallNow === 'function'
    ? options.wallNow
    : () => {
      const performanceValue = globalThis.performance;
      const epochMilliseconds = Number(performanceValue?.timeOrigin) +
        Number(performanceValue?.now?.());
      return Number.isFinite(epochMilliseconds)
        ? Math.floor(epochMilliseconds * 1000)
        : Date.now() * 1000;
    };
  // 오버레이 호스트 IPC 응답 데드라인. 호스트가 응답하지 않으면 게이트가 영구 pending이 되어
  // 이어붙이기 전환 전체가 침묵 정지하므로(2026-08-21), 경계에서 유한 시간으로 자른다.
  // 기본 8000ms: 문서가 커지면 export/hydrate 직렬화가 수 초까지 늘어나는데,
  // 종전 3000ms에서는 정상 회수가 'persistence-ipc-timeout'으로 잘려 저장이 반복 중단됐다
  // (2026-08-27 실측). 데드라인은 '무응답 감지'용이므로 정상 최댓값보다 넉넉해야 한다.
  const persistenceIpcDeadlineMs =
    Number.isFinite(Number(options.persistenceIpcDeadlineMs)) &&
    Number(options.persistenceIpcDeadlineMs) > 0
      ? Number(options.persistenceIpcDeadlineMs)
      : 8000;

  let initializePromise = null;
  let pilotEnabled = false;
  let state = 'disabled';
  let hostGeneration = 0;
  let videoGeneration = 0;
  let inputRevision = 0;
  let desiredInputEnabled = false;
  let desiredTool = 'brush';
  // 오버레이가 마지막으로 알려 준 굵기. 표시·진단용이며 다음 증감의 기준이 아니다
  // (기준은 언제나 오버레이의 현재 값이다).
  let lastKnownBrushSize = null;

  let currentSession = null;
  let videoReady = false;
  let videoChangePending = false;
  let pendingLoadToken = null;
  let videoChangeEpoch = 0;
  let videoChangeRollback = null;
  let inFlightReadyReconciliation = null;
  let confirmedVideoIdentity = null;
  // 레이어 뷰 리비전은 **세션보다 오래 산다.** passive 에서도 보내야 하는데
  // 그때는 세션이 없다. 세션별로 세면 그리기 모드를 껐다 켜는 사이에 리비전이
  // 되감겨 호스트가 새 갱신을 낡은 것으로 보고 버린다.
  let passiveLayerViewRevision = 0;
  let confirmedLoadToken = null;
  let resumeRequested = false;
  let lastError = null;
  let bInputAttempted = 0;
  let bInputAccepted = 0;
  let bInputRejected = 0;
  let bAutoRepeatIgnored = 0;
  let drawingActionQueue = Promise.resolve(false);
  let persistenceSessionId = null;
  let persistenceBridgeReady = persistenceStore === null;
  let persistenceEventUnsubscribe = null;
  let persistenceEventEpoch = 0;
  let persistenceOwnerEpoch = 0;
  let persistencePullQueue = Promise.resolve(true);
  let persistenceSourceRefreshQueue = Promise.resolve(true);
  let persistenceSourceRefreshInProgress = false;
  let persistenceQuitSuspension = null;
  let persistenceQuitPreparationPromise = null;
  let persistenceResyncPromise = null;
  let persistenceResyncTrailing = false;
  let legacyBypass = false;
  let persistenceBlocked = false;
  let persistenceAbandonResumeRequested = false;
  let persistenceFailureReason = null;
  let persistenceVideoContext = null;
  let persistenceBoundSourceEpoch = null;
  let presentationRevision = 0;
  let passivePresentationInFlight = null;
  let passivePresentationTrailing = null;
  let lastAcceptedPresentationSignature = null;
  let activeFrameRevision = 0;
  const activeFrameInFlight = new Set();
  let activeFramePending = null;
  let activeFrameDispatchScheduled = false;
  let lastAcceptedActiveFrameSignature = null;
  let activeFrameObservations = [];
  let passivePresentationBlock = null;

  function contextSnapshot(overrides) {
    let current = {};
    try {
      current = getContext() || {};
    } catch {
      current = {};
    }
    return overrides && typeof overrides === 'object'
      ? { ...current, ...overrides }
      : { ...current };
  }

  function isPassivePresentationBlocked() {
    return !!(
      passivePresentationBlock &&
      passivePresentationBlock.hostGeneration === hostGeneration &&
      passivePresentationBlock.videoGeneration === videoGeneration &&
      passivePresentationBlock.inputRevision === inputRevision
    );
  }

  function releasePassivePresentationBlock(block) {
    if (passivePresentationBlock !== block) return false;
    passivePresentationBlock = null;
    return true;
  }

  function readPersistenceRevision() {
    let value = null;
    try {
      value = persistenceStore?.getRevision?.();
      if (value === null || value === undefined) {
        value = persistenceStore?.getStatus?.()?.revision;
      }
    } catch {
      value = null;
    }
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function resolveSourceFrame(targetFrame) {
    if (typeof persistenceStore?.resolveSourceFrameAtFrame === 'function') {
      let sourceFrame = null;
      try {
        sourceFrame = persistenceStore.resolveSourceFrameAtFrame(targetFrame);
      } catch {
        return null;
      }
      if (sourceFrame === null) return { sourceFrame: null };
      const normalizedSourceFrame = Number(sourceFrame);
      if (!Number.isSafeInteger(normalizedSourceFrame) || normalizedSourceFrame < 0 ||
          normalizedSourceFrame > targetFrame) {
        return null;
      }
      return { sourceFrame: normalizedSourceFrame };
    }
    if (typeof persistenceStore?.resolveKeyframeAtFrame !== 'function') return null;
    let keyframe = null;
    try {
      keyframe = persistenceStore.resolveKeyframeAtFrame(targetFrame);
    } catch {
      return null;
    }
    if (keyframe === null) return { sourceFrame: null };
    const sourceFrame = Number(keyframe?.frame);
    if (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0 || sourceFrame > targetFrame) {
      return null;
    }
    return { sourceFrame };
  }

  function readPassiveViewport(context) {
    const sourceWidth = Number(context.sourceWidth);
    const sourceHeight = Number(context.sourceHeight);
    const rect = context.canvasRect;
    const canvasRect = {
      left: Number(rect?.left),
      top: Number(rect?.top),
      width: Number(rect?.width),
      height: Number(rect?.height)
    };
    const viewportRevision = Number(context.viewportRevision);
    const viewportTransform = copyViewportTransform(context.viewportTransform);
    if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 ||
        !Number.isFinite(sourceHeight) || sourceHeight <= 0 ||
        !Object.values(canvasRect).every(Number.isFinite) ||
        canvasRect.width <= 0 || canvasRect.height <= 0 ||
        !Number.isSafeInteger(viewportRevision) || viewportRevision < 0 ||
        !Number.isFinite(viewportTransform.scale) || viewportTransform.scale <= 0 ||
        !Number.isFinite(viewportTransform.panX) ||
        !Number.isFinite(viewportTransform.panY)) {
      return null;
    }
    return {
      sourceWidth,
      sourceHeight,
      canvasRect,
      viewportRevision,
      viewportTransform
    };
  }

  function createPassivePresentationEntry(targetFrame, { force = false } = {}) {
    if (!pilotEnabled || state !== 'passive' || desiredInputEnabled ||
        isPassivePresentationBlocked() ||
        !videoReady || !hostGeneration || !videoGeneration) {
      return null;
    }
    let presentFrame;
    try {
      presentFrame = electronAPI.mpvPresentOverlayDrawingFrame;
    } catch {
      presentFrame = null;
    }
    if (typeof presentFrame !== 'function') return null;
    const context = contextSnapshot();
    const stableVideoIdentity = String(context.stableVideoIdentity || '');
    if (!validPilotContext(context) || !stableVideoIdentity ||
        stableVideoIdentity !== confirmedVideoIdentity) {
      return null;
    }
    const normalizedTargetFrame = Math.max(0, Math.trunc(Number(targetFrame) || 0));
    const totalFrames = Number(context.totalFrames);
    if (Number.isSafeInteger(totalFrames) && totalFrames > 0 &&
        normalizedTargetFrame >= totalFrames) {
      return null;
    }
    const resolved = resolveSourceFrame(normalizedTargetFrame);
    const storeRevision = readPersistenceRevision();
    const viewport = readPassiveViewport(context);
    if (!resolved || storeRevision === null || !viewport ||
        presentationRevision >= Number.MAX_SAFE_INTEGER) {
      return null;
    }
    const signature = JSON.stringify([
      hostGeneration,
      videoGeneration,
      stableVideoIdentity,
      storeRevision,
      resolved.sourceFrame,
      viewport.sourceWidth,
      viewport.sourceHeight,
      viewport.canvasRect.left,
      viewport.canvasRect.top,
      viewport.canvasRect.width,
      viewport.canvasRect.height,
      viewport.viewportRevision,
      viewport.viewportTransform.scale,
      viewport.viewportTransform.panX,
      viewport.viewportTransform.panY
    ]);
    if (!force) {
      if (passivePresentationTrailing?.signature === signature) {
        return { existingPromise: passivePresentationTrailing.promise };
      }
      if (passivePresentationInFlight?.signature === signature &&
          !passivePresentationTrailing) {
        return { existingPromise: passivePresentationInFlight.promise };
      }
      if (signature === lastAcceptedPresentationSignature &&
          !passivePresentationInFlight) {
        return { deduped: true };
      }
    }
    presentationRevision += 1;
    let resolveEntry;
    const promise = new Promise(resolve => {
      resolveEntry = resolve;
    });
    const request = {
      hostGeneration,
      videoGeneration,
      presentationRevision,
      stableVideoIdentity,
      storeRevision,
      targetFrame: normalizedTargetFrame,
      sourceFrame: resolved.sourceFrame,
      ...viewport
    };
    return {
      force,
      signature,
      request,
      presentFrame,
      promise,
      resolve: resolveEntry
    };
  }

  function passivePresentationEntryIsCurrent(entry) {
    const request = entry?.request;
    if (!request || state !== 'passive' || desiredInputEnabled || !videoReady ||
        request.hostGeneration !== hostGeneration ||
        request.videoGeneration !== videoGeneration ||
        request.presentationRevision !== presentationRevision ||
        request.stableVideoIdentity !== confirmedVideoIdentity) {
      return false;
    }
    const context = contextSnapshot();
    const viewport = readPassiveViewport(context);
    if (!validPilotContext(context) ||
        String(context.stableVideoIdentity || '') !== request.stableVideoIdentity ||
        readPersistenceRevision() !== request.storeRevision ||
        !viewport ||
        JSON.stringify(viewport) !== JSON.stringify({
          sourceWidth: request.sourceWidth,
          sourceHeight: request.sourceHeight,
          canvasRect: request.canvasRect,
          viewportRevision: request.viewportRevision,
          viewportTransform: request.viewportTransform
        })) {
      return false;
    }
    const resolved = resolveSourceFrame(request.targetFrame);
    return resolved !== null && resolved.sourceFrame === request.sourceFrame;
  }

  function responseMatchesPassivePresentation(response, request) {
    return response?.success === true &&
      response.accepted === true &&
      response.presentationRevision === request.presentationRevision &&
      response.targetFrame === request.targetFrame &&
      response.sourceFrame === request.sourceFrame;
  }

  function runPassivePresentationEntry(entry) {
    passivePresentationInFlight = entry;
    void (async () => {
      let accepted = false;
      try {
        const response = await withPersistenceIpcDeadline(
          entry.presentFrame(entry.request),
          {
            success: false,
            accepted: false,
            presentationRevision: entry.request.presentationRevision,
            targetFrame: entry.request.targetFrame,
            sourceFrame: entry.request.sourceFrame,
            reason: 'passive-presentation-ipc-timeout'
          }
        );
        accepted = responseMatchesPassivePresentation(response, entry.request) &&
          passivePresentationEntryIsCurrent(entry);
        if (accepted) lastAcceptedPresentationSignature = entry.signature;
      } catch {
        accepted = false;
      } finally {
        if (passivePresentationInFlight === entry) {
          passivePresentationInFlight = null;
        }
        entry.resolve(accepted);
        const trailing = passivePresentationTrailing;
        passivePresentationTrailing = null;
        if (!trailing) return;
        if (!passivePresentationEntryIsCurrent(trailing)) {
          trailing.resolve(false);
          return;
        }
        if (!trailing.force && trailing.signature === lastAcceptedPresentationSignature) {
          trailing.resolve(true);
          return;
        }
        runPassivePresentationEntry(trailing);
      }
    })();
  }

  function syncDisplayFrame(targetFrame, options = {}) {
    if (state === 'active') return syncActiveDrawingFrame(targetFrame, options);
    const entry = createPassivePresentationEntry(targetFrame, options);
    if (!entry) return Promise.resolve(false);
    if (entry.deduped) return Promise.resolve(true);
    if (entry.existingPromise) return entry.existingPromise;
    if (passivePresentationInFlight) {
      if (passivePresentationTrailing) passivePresentationTrailing.resolve(false);
      passivePresentationTrailing = entry;
      return entry.promise;
    }
    runPassivePresentationEntry(entry);
    return entry.promise;
  }

  function pushActiveFrameObservation(targetFrame, observedAt = wallNow()) {
    if (!currentSession || !Number.isSafeInteger(targetFrame) || targetFrame < 0 ||
        !Number.isSafeInteger(observedAt) || observedAt < 0) {
      return false;
    }
    const observation = {
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId: currentSession.sessionId,
      targetFrame,
      observedAt
    };
    const previous = activeFrameObservations.at(-1);
    if (previous && previous.hostGeneration === observation.hostGeneration &&
        previous.videoGeneration === observation.videoGeneration &&
        previous.inputRevision === observation.inputRevision &&
        previous.sessionId === observation.sessionId &&
        previous.targetFrame === observation.targetFrame &&
        previous.observedAt === observation.observedAt) {
      return true;
    }
    activeFrameObservations.push(observation);
    if (activeFrameObservations.length > ACTIVE_FRAME_OBSERVATION_LIMIT) {
      activeFrameObservations.splice(
        0,
        activeFrameObservations.length - ACTIVE_FRAME_OBSERVATION_LIMIT
      );
    }
    return true;
  }

  function recordActiveFrameObservation(targetFrame) {
    if (state !== 'active' || !desiredInputEnabled || !currentSession || !videoReady) {
      return false;
    }
    const context = contextSnapshot();
    const normalizedTargetFrame = Math.max(0, Math.trunc(Number(targetFrame) || 0));
    const totalFrames = Number(context.totalFrames);
    if (!validPilotContext(context) ||
        String(context.stableVideoIdentity || '') !== confirmedVideoIdentity ||
        (Number.isSafeInteger(totalFrames) && totalFrames > 0 &&
          normalizedTargetFrame >= totalFrames)) {
      return false;
    }
    return pushActiveFrameObservation(normalizedTargetFrame);
  }

  function resolvePointerdownFrame(request) {
    for (let index = activeFrameObservations.length - 1; index >= 0; index -= 1) {
      const observation = activeFrameObservations[index];
      if (observation.observedAt <= request.pointerdownAt &&
          observation.hostGeneration === request.hostGeneration &&
          observation.videoGeneration === request.videoGeneration &&
          observation.inputRevision === request.inputRevision &&
          observation.sessionId === request.sessionId) {
        return observation.targetFrame;
      }
    }
    return null;
  }

  async function cancelPointerdownFrame(request, confirmPointerdownFrame) {
    try {
      await withPersistenceIpcDeadline(
        confirmPointerdownFrame({ ...request, cancelled: true }),
        { success: false, accepted: false, reason: 'pointerdown-cancel-ipc-timeout' }
      );
    } catch { /* cancellation is best-effort and runtime-fenced */ }
    return false;
  }

  async function handlePointerdownFrameRequest(value) {
    const request = normalizePointerdownFrameRequest(value);
    let confirmPointerdownFrame;
    try {
      confirmPointerdownFrame = electronAPI.mpvConfirmOverlayDrawingPointerdownFrame;
    } catch {
      confirmPointerdownFrame = null;
    }
    if (!request || typeof confirmPointerdownFrame !== 'function') {
      return false;
    }
    if (state !== 'active' || !desiredInputEnabled || !currentSession ||
        request.hostGeneration !== hostGeneration ||
        request.videoGeneration !== videoGeneration ||
        request.inputRevision !== inputRevision ||
        request.sessionId !== currentSession.sessionId) {
      return cancelPointerdownFrame(request, confirmPointerdownFrame);
    }
    const targetFrame = resolvePointerdownFrame(request);
    if (!Number.isSafeInteger(targetFrame)) {
      return cancelPointerdownFrame(request, confirmPointerdownFrame);
    }
    const confirmation = { ...request, targetFrame };
    try {
      const response = await withPersistenceIpcDeadline(
        confirmPointerdownFrame(confirmation),
        { success: false, accepted: false, reason: 'pointerdown-frame-ipc-timeout' }
      );
      const accepted = response?.success === true && response.accepted === true &&
        response.pointerdownId === request.pointerdownId &&
        response.targetFrame === targetFrame && state === 'active' &&
        desiredInputEnabled && currentSession?.sessionId === request.sessionId &&
        hostGeneration === request.hostGeneration &&
        videoGeneration === request.videoGeneration &&
        inputRevision === request.inputRevision;
      return accepted
        ? true
        : cancelPointerdownFrame(request, confirmPointerdownFrame);
    } catch {
      return cancelPointerdownFrame(request, confirmPointerdownFrame);
    }
  }

  function createActiveFrameEntry(targetFrame, { force = false } = {}) {
    if (!pilotEnabled || state !== 'active' || !desiredInputEnabled ||
        !currentSession || !videoReady || !hostGeneration || !videoGeneration) {
      return null;
    }
    let updateFrame;
    try {
      updateFrame = electronAPI.mpvUpdateOverlayDrawingFrame;
    } catch {
      updateFrame = null;
    }
    if (typeof updateFrame !== 'function') return null;
    const context = contextSnapshot();
    if (!validPilotContext(context) ||
        String(context.stableVideoIdentity || '') !== confirmedVideoIdentity) {
      return null;
    }
    const normalizedTargetFrame = Math.max(0, Math.trunc(Number(targetFrame) || 0));
    const totalFrames = Number(context.totalFrames);
    if (Number.isSafeInteger(totalFrames) && totalFrames > 0 &&
        normalizedTargetFrame >= totalFrames) {
      return null;
    }
    const signature = JSON.stringify([
      hostGeneration,
      videoGeneration,
      inputRevision,
      currentSession.sessionId,
      normalizedTargetFrame
    ]);
    if (!force) {
      if (activeFramePending?.signature === signature) {
        return { existingPromise: activeFramePending.promise };
      }
      const matchingInFlight = [...activeFrameInFlight]
        .find(candidate => candidate.signature === signature);
      if (matchingInFlight && !activeFramePending) {
        return { existingPromise: matchingInFlight.promise };
      }
      if (signature === lastAcceptedActiveFrameSignature &&
          activeFrameInFlight.size === 0 && !activeFramePending) {
        return { deduped: true };
      }
    }
    if (activeFrameRevision >= Number.MAX_SAFE_INTEGER) return null;
    activeFrameRevision += 1;
    let resolveEntry;
    const promise = new Promise(resolve => {
      resolveEntry = resolve;
    });
    let settled = false;
    return {
      force,
      signature,
      request: {
        hostGeneration,
        videoGeneration,
        inputRevision,
        sessionId: currentSession.sessionId,
        frameRevision: activeFrameRevision,
        targetFrame: normalizedTargetFrame
      },
      updateFrame,
      promise,
      resolve(value) {
        if (settled) return;
        settled = true;
        resolveEntry(value);
      }
    };
  }

  function activeFrameEntryIsCurrent(entry) {
    const request = entry?.request;
    if (!request || state !== 'active' || !desiredInputEnabled || !currentSession ||
        !videoReady || request.hostGeneration !== hostGeneration ||
        request.videoGeneration !== videoGeneration ||
        request.inputRevision !== inputRevision ||
        request.sessionId !== currentSession.sessionId ||
        request.frameRevision !== activeFrameRevision) {
      return false;
    }
    const context = contextSnapshot();
    return validPilotContext(context) &&
      String(context.stableVideoIdentity || '') === confirmedVideoIdentity;
  }

  function runActiveFrameEntry(entry) {
    activeFrameInFlight.add(entry);
    void (async () => {
      let accepted = false;
      try {
        const response = await withPersistenceIpcDeadline(
          entry.updateFrame(entry.request),
          {
            success: false,
            accepted: false,
            frameRevision: entry.request.frameRevision,
            targetFrame: entry.request.targetFrame,
            reason: 'active-frame-ipc-timeout'
          }
        );
        accepted = response?.success === true &&
          response.accepted === true &&
          response.frameRevision === entry.request.frameRevision &&
          response.targetFrame === entry.request.targetFrame &&
          activeFrameEntryIsCurrent(entry);
        if (accepted) lastAcceptedActiveFrameSignature = entry.signature;
      } catch {
        accepted = false;
      } finally {
        activeFrameInFlight.delete(entry);
        entry.resolve(accepted);
        scheduleActiveFrameDispatch();
      }
    })();
  }

  function scheduleActiveFrameDispatch() {
    if (activeFrameDispatchScheduled || !activeFramePending) return;
    activeFrameDispatchScheduled = true;
    queueMicrotask(() => {
      activeFrameDispatchScheduled = false;
      if (!activeFramePending ||
          activeFrameInFlight.size >= ACTIVE_FRAME_MAX_IN_FLIGHT) {
        return;
      }
      const pending = activeFramePending;
      activeFramePending = null;
      if (!activeFrameEntryIsCurrent(pending)) {
        pending.resolve(false);
        scheduleActiveFrameDispatch();
        return;
      }
      if (!pending.force && pending.signature === lastAcceptedActiveFrameSignature) {
        pending.resolve(true);
        scheduleActiveFrameDispatch();
        return;
      }
      runActiveFrameEntry(pending);
    });
  }

  function syncActiveDrawingFrame(targetFrame, options = {}) {
    recordActiveFrameObservation(targetFrame);
    const entry = createActiveFrameEntry(targetFrame, options);
    if (!entry) return Promise.resolve(false);
    if (entry.deduped) return Promise.resolve(true);
    if (entry.existingPromise) return entry.existingPromise;
    if (activeFrameInFlight.size > 0) {
      if (activeFramePending) activeFramePending.resolve(false);
      activeFramePending = entry;
      scheduleActiveFrameDispatch();
      return entry.promise;
    }
    runActiveFrameEntry(entry);
    return entry.promise;
  }

  function readHistoryRevision() {
    if (!getHistoryRevision) return null;
    try {
      return getHistoryRevision();
    } catch {
      // 설정된 fence를 읽지 못하면 서로 다른 객체를 반환해 fallback을 fail-close한다.
      return {};
    }
  }

  function localSnapshot() {
    return {
      state,
      enabled: pilotEnabled,
      hostGeneration,
      videoGeneration,
      inputRevision,
      desiredInputEnabled,
      desiredTool,
      sessionId: currentSession?.sessionId || null,
      targetFrame: currentSession?.targetFrame ?? null,
      toolRevision: currentSession?.toolRevision ?? 0,
      videoReady,
      resumeRequested,
      lastError,
      legacyBypass,
      persistenceDegraded: legacyBypass,
      persistenceBlocked,
      persistenceFailureReason,
      persistenceSourceRefreshInProgress,
      presentationRevision,
      activeFrameRevision,
      persistenceQuitPrepared: persistenceQuitSuspension !== null,
      persistenceReady: persistenceStore === null ||
        (persistenceBridgeReady && persistenceSessionId !== null),
      bInput: {
        attempted: bInputAttempted,
        accepted: bInputAccepted,
        rejected: bInputRejected,
        autoRepeatIgnored: bAutoRepeatIgnored
      }
    };
  }

  function notifyStateChange() {
    const snapshot = localSnapshot();
    try {
      onStateChange(state, snapshot);
    } catch {
      // State delivery is advisory and must not change the input boundary.
    }
  }

  function matchesDrawingToggleShortcut(event = {}) {
    if (configuredDrawingToggleMatcher) {
      try {
        return configuredDrawingToggleMatcher(event) === true;
      } catch {
        return false;
      }
    }
    return String(event.key || '').toLowerCase() === 'b' &&
      event.ctrlKey !== true &&
      event.metaKey !== true &&
      event.altKey !== true &&
      event.shiftKey !== true;
  }

  // 반환값은 크기 증감 방향이다. 0 이면 브러시 크기 단축키가 아니다.
  function matchBrushSizeShortcut(event = {}) {
    if (configuredBrushSizeShortcutMatcher) {
      try {
        const step = Number(configuredBrushSizeShortcutMatcher(event));
        return Number.isFinite(step) ? Math.sign(step) : 0;
      } catch {
        return 0;
      }
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return 0;
    if (event.code === 'BracketLeft') return -1;
    if (event.code === 'BracketRight') return 1;
    return 0;
  }

  function matchToolShortcut(event = {}) {
    if (!configuredToolShortcutMatcher) return null;
    try {
      const tool = configuredToolShortcutMatcher(event);
      return CONTROLLER_DRAWING_TOOLS.has(tool) ? tool : null;
    } catch {
      return null;
    }
  }

  function matchFrameOperationShortcut(event = {}) {
    if (!configuredFrameOperationMatcher) return null;
    try {
      const operation = configuredFrameOperationMatcher(event);
      return typeof operation === 'string' && operation.length > 0 ? operation : null;
    } catch {
      return null;
    }
  }

  function matchesSelectionShortcut(event = {}) {
    if (configuredSelectionShortcutMatcher) {
      try {
        return configuredSelectionShortcutMatcher(event) === true;
      } catch {
        return false;
      }
    }
    return String(event.key || '').toLowerCase() === 'v' &&
      event.ctrlKey !== true &&
      event.metaKey !== true &&
      event.altKey !== true &&
      event.shiftKey !== true;
  }

  function setState(nextState) {
    if (state === nextState) return;
    if (nextState !== 'passive') invalidatePassivePresentationOwner();
    if (nextState !== 'active') invalidateActiveFrameOwner();
    state = nextState;
    notifyStateChange();
  }

  function invalidatePassivePresentationOwner() {
    presentationRevision += 1;
    lastAcceptedPresentationSignature = null;
    if (passivePresentationTrailing) {
      passivePresentationTrailing.resolve(false);
      passivePresentationTrailing = null;
    }
  }

  function invalidateActiveFrameOwner() {
    activeFrameRevision += 1;
    lastAcceptedActiveFrameSignature = null;
    activeFrameObservations = [];
    if (activeFramePending) {
      activeFramePending.resolve(false);
      activeFramePending = null;
    }
    for (const entry of activeFrameInFlight) {
      entry.resolve(false);
    }
    activeFrameInFlight.clear();
  }

  function syncExplicitResumeIntent() {
    if (videoChangePending && videoChangeRollback) {
      videoChangeRollback.shouldResume = resumeRequested;
    }
  }

  // 예약(resumeRequested) 소비 단일 지점.
  // 정착 지점에서 남아 있는 예약을 실제 진입(startEnable)으로 소비하거나,
  // 진입 전제조건이 사라졌으면 명시적으로 취소하고 상태를 정착시킨다.
  // 반환값 — null: 소비할 예약 없음, false: 예약을 취소하고 정착시킴,
  //          Promise<boolean>: startEnable에 소비를 위임함.
  function consumePendingResumeRequest(
    enableContext = null,
    isStillCurrent = () => true,
    onInputFailure = null,
    { allowResume = true, settleState = null } = {}
  ) {
    if (!resumeRequested) return null;
    const context = contextSnapshot(enableContext);
    // startEnable(2041~2054행)의 전제조건 + 종료 준비 유예 제외 조건을 선평가한다.
    // 전제조건이 깨진 채 startEnable을 부르면 예약도 상태도 정착되지 않고 반환된다.
    // persistenceQuitSuspension === null 은 startEnable에는 없는 추가 조건이다 —
    // 종료 준비 유예 중에는 그 자체 예약 의미론(1917~1926행)이 우선하므로 여기서 진입하지 않는다.
    const canResume = allowResume === true &&
      persistenceQuitSuspension === null &&
      shouldOwnDrawingShortcut() &&
      hostGeneration > 0 &&
      videoGeneration > 0 &&
      videoReady &&
      isStillCurrent() &&
      validPilotContext(context) &&
      String(context.stableVideoIdentity || '') !== '';
    if (canResume) return startEnable(enableContext, isStillCurrent, onInputFailure);
    resumeRequested = false;
    syncExplicitResumeIntent();
    // 상태가 실제로 바뀔 때만 setState한다. settleState === state인데도 별도로
    // notifyStateChange()를 부르면 오버레이 강제 동기화가 한 번 더 나가(엣지 8),
    // setState 경로의 알림과 합쳐 2배가 된다. 예약만 사라지고 상태가 그대로인
    // 경우는 알림 없이 종료한다(엣지 12 참조).
    if (settleState !== null && state !== settleState) {
      setState(settleState);
    }
    return false;
  }

  // legacyBypass는 "저장 계층 저하" 표시일 뿐 소유권 플래그가 아니다.
  // blocked=true(데이터 보호가 필요한 재수화·검증 실패)일 때만 진행 중인 드로잉 세션을 내린다.
  // 세션을 내려도 소유권은 유지되므로 타임라인 투영과 CSS 마스크는 그대로 남는다.
  function setPersistenceBypass(reason, { blocked = false } = {}) {
    if (blocked === true && !persistenceBlocked) {
      persistenceAbandonResumeRequested =
        resumeRequested || state === 'active' || state === 'preparing';
    } else if (blocked !== true) {
      persistenceAbandonResumeRequested = false;
    }
    const normalizedReason = typeof reason === 'string' && reason
      ? reason.slice(0, 512)
      : 'persistence-unavailable';
    const changed = !legacyBypass ||
      persistenceBlocked !== blocked ||
      persistenceFailureReason !== normalizedReason;
    legacyBypass = true;
    persistenceBlocked = blocked;
    persistenceFailureReason = normalizedReason;
    persistenceBoundSourceEpoch = null;
    if (blocked === true) {
      desiredInputEnabled = false;
      resumeRequested = false;
      currentSession = null;
      if (persistenceQuitSuspension) {
        persistenceQuitSuspension.shouldResume = false;
      }
      if (state !== 'disabled' && state !== 'passive') {
        setState('passive');
        return false;
      }
    }
    if (changed) notifyStateChange();
    return false;
  }

  function clearPersistenceBypass() {
    const changed = legacyBypass || persistenceBlocked || persistenceFailureReason !== null;
    legacyBypass = false;
    persistenceBlocked = false;
    persistenceAbandonResumeRequested = false;
    persistenceFailureReason = null;
    if (changed) notifyStateChange();
  }

  function normalizePersistenceContext(context = {}) {
    const stableVideoIdentity = String(context.stableVideoIdentity || '');
    const fps = Number(context.fps);
    const totalFrames = Number(context.totalFrames);
    if (!stableVideoIdentity ||
        !Number.isFinite(fps) || fps <= 0 ||
        !Number.isSafeInteger(totalFrames) || totalFrames <= 0) {
      return null;
    }
    return {
      stableVideoIdentity,
      fps,
      totalFrames
    };
  }

  function capturePersistenceOwner(
    contextOverrides = null,
    { allowVideoNotReady = false } = {}
  ) {
    if (!persistenceStore ||
        !persistenceBridgeReady ||
        !persistenceSessionId ||
        !hostGeneration ||
        !videoGeneration ||
        (!videoReady && !allowVideoNotReady)) {
      return null;
    }
    const rawContext = contextOverrides
      ? contextSnapshot(contextOverrides)
      : (persistenceVideoContext || contextSnapshot());
    const context = normalizePersistenceContext(rawContext);
    if (!context) return null;
    return {
      ownerEpoch: persistenceOwnerEpoch,
      hostGeneration,
      videoGeneration,
      persistenceSessionId,
      stableVideoIdentity: context.stableVideoIdentity,
      fps: context.fps,
      totalFrames: context.totalFrames
    };
  }

  function ownsPersistenceOwner(owner, options = {}) {
    if (!owner) return false;
    const current = capturePersistenceOwner(null, options);
    return Boolean(
      current &&
      owner.ownerEpoch === current.ownerEpoch &&
      owner.hostGeneration === current.hostGeneration &&
      owner.videoGeneration === current.videoGeneration &&
      owner.persistenceSessionId === current.persistenceSessionId &&
      owner.stableVideoIdentity === current.stableVideoIdentity &&
      owner.fps === current.fps &&
      owner.totalFrames === current.totalFrames
    );
  }

  function messageFence(message) {
    return message?.type === 'transition' ? message.transition : message;
  }

  function messageMatchesPersistenceOwner(message) {
    const owner = capturePersistenceOwner();
    const fence = messageFence(message);
    return Boolean(
      owner &&
      fence &&
      fence.hostGeneration === owner.hostGeneration &&
      fence.videoGeneration === owner.videoGeneration &&
      fence.persistenceSessionId === owner.persistenceSessionId &&
      fence.stableVideoIdentity === owner.stableVideoIdentity
    );
  }

  function makeEnvelope(type, payload = {}) {
    return {
      protocol: DRAWING_PROTOCOL,
      version: DRAWING_PROTOCOL_VERSION,
      requestId: uuid(),
      type,
      payload
    };
  }

  function makeInputRequest(enabled, session = null) {
    inputRevision += 1;
    desiredInputEnabled = enabled;
    const request = {
      ...makeEnvelope('surface-state', { enabled }),
      hostGeneration,
      videoGeneration,
      inputRevision,
      enabled
    };
    if (session) request.session = session;
    return request;
  }

  function isCurrentInputRequest(request) {
    return request.hostGeneration === hostGeneration &&
      request.videoGeneration === videoGeneration &&
      request.inputRevision === inputRevision &&
      request.enabled === desiredInputEnabled;
  }

  function withPersistenceIpcDeadline(operation, deadlineValue) {
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(deadlineValue);
      }, persistenceIpcDeadlineMs);
      Promise.resolve(operation).then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        rejection => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // 거부(rejection)는 타임아웃과 다른 사유로 남긴다 — 진단 정보(실제 오류 메시지)를
          // 보존하고, 회수 실패의 기존 래치 의미론('persistence-ipc-rejected'는 비래치
          // 통과 목록에 없으므로 종전처럼 차단 래치)을 바꾸지 않기 위함이다.
          resolve({
            ...deadlineValue,
            reason: 'persistence-ipc-rejected',
            error: rejection instanceof Error ? rejection.message : String(rejection)
          });
        }
      );
    });
  }

  async function invokeInput(request) {
    if (typeof electronAPI.mpvSetOverlayDrawingInput !== 'function') {
      return { success: false, accepted: false, enabled: false };
    }
    try {
      const response = await withPersistenceIpcDeadline(
        electronAPI.mpvSetOverlayDrawingInput(request),
        { success: false, accepted: false, enabled: false, error: 'persistence-ipc-timeout' }
      );
      if (!request.enabled && isCurrentInputRequest(request) &&
          isAcceptedInputResponse(response, false) &&
          CONTROLLER_DRAWING_TOOLS.has(response.tool)) {
        desiredTool = response.tool;
      }
      return response;
    } catch (error) {
      return {
        success: false,
        accepted: false,
        enabled: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async function bestEffortDisable() {
    if (!hostGeneration || !videoGeneration) return;
    const request = makeInputRequest(false);
    currentSession = null;
    await invokeInput(request);
  }

  async function enterFailure(error) {
    desiredInputEnabled = false;
    resumeRequested = false;
    currentSession = null;
    lastError = typeof error === 'string' && error ? error : 'drawing surface request failed';
    setState('failed');
    await bestEffortDisable();
    return false;
  }

  function validPilotContext(context) {
    return context.isMpvActive === true && context.isAudio !== true;
  }

  function normalizeLoadToken(value) {
    const tokenValue = value && typeof value === 'object'
      ? value.loadToken ?? value.videoLoadToken ?? value.confirmationToken ?? null
      : value;
    return tokenValue === null || tokenValue === undefined
      ? null
      : String(tokenValue);
  }

  function settleWithoutPilotVideo() {
    videoChangeEpoch += 1;
    desiredInputEnabled = false;
    currentSession = null;
    videoReady = false;
    videoChangePending = false;
    pendingLoadToken = null;
    videoChangeRollback = null;
    resumeRequested = false;
    persistenceOwnerEpoch += 1;
    persistenceSessionId = null;
    persistenceVideoContext = null;
    persistenceBoundSourceEpoch = null;
    persistenceQuitSuspension = null;
    clearPersistenceBypass();
    setState(pilotEnabled ? 'passive' : 'disabled');
    return true;
  }

  function abandonPersistenceForVideoChange() {
    if (persistenceBlocked) {
      resumeRequested = persistenceAbandonResumeRequested;
    }
    clearPersistenceBypass();
    return true;
  }

  function currentVideoChangeOwner() {
    return {
      epoch: videoChangeEpoch,
      loadToken: pendingLoadToken
    };
  }

  function ownsVideoChange(owner) {
    return Boolean(
      owner &&
      videoChangePending &&
      owner.epoch === videoChangeEpoch &&
      owner.loadToken === pendingLoadToken
    );
  }

  function finishVideoChange(owner) {
    if (!ownsVideoChange(owner)) return false;
    videoChangeEpoch += 1;
    videoChangePending = false;
    pendingLoadToken = null;
    videoChangeRollback = null;
    return true;
  }

  function buildSession(context) {
    const sessionId = uuid();
    const targetFrame = Math.max(0, Math.trunc(Number(context.targetFrame) || 0));
    const resolved = resolveSourceFrame(targetFrame);
    return {
      sessionId,
      persistenceSessionId,
      stableVideoIdentity: String(context.stableVideoIdentity || ''),
      targetFrame,
      sourceFrame: resolved?.sourceFrame ?? null,
      sourceWidth: Number(context.sourceWidth),
      sourceHeight: Number(context.sourceHeight),
      canvasRect: copyRect(context.canvasRect),
      viewportRevision: Math.max(0, Math.trunc(Number(context.viewportRevision) || 0)),
      viewportTransform: copyViewportTransform(context.viewportTransform),
      tool: desiredTool,
      toolRevision: 0,
      brushRevision: 0,
      layerViewRevision: 0
    };
  }

  async function sendTool(tool) {
    if (state !== 'active' || !currentSession) return false;
    currentSession.toolRevision += 1;
    desiredTool = tool;
    const request = {
      ...makeEnvelope('tool-update', { tool }),
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId: currentSession.sessionId,
      toolRevision: currentSession.toolRevision,
      tool
    };
    try {
      const response = await withPersistenceIpcDeadline(
        electronAPI.mpvUpdateOverlayDrawingTool(request),
        { success: false, accepted: false, tool: request.tool, error: 'persistence-ipc-timeout' }
      );
      const accepted = response?.success === true && response.accepted === true;
      if (accepted && currentSession?.sessionId === request.sessionId) {
        currentSession.tool = tool;
      }
      return accepted;
    } catch {
      return false;
    }
  }

  // 레이어 표시·잠금은 **뷰 상태**다. 문서를 바꾸지 않으므로 씬·프레임 왕복이
  // 없고, 델타가 아니라 **전체 집합**을 보낸다 — 늦게 도착한 것은 리비전으로
  // 버리면 되고, 순서가 어긋나도 마지막 것이 옳다.
  //
  // 세션이 새로 살아나면 오버레이의 집합은 비어 있다. 렌더러가 active 전이에서
  // 다시 불러 줘야 숨긴 레이어가 되살아나지 않는다.
  async function sendLayerView({
    hiddenObjectIds, lockedObjectIds, activeLayerDrawable,
    objectRanks, defaultRank, activeLayerRank, layerHistoryBusy
  }) {
    // passive 투영에서도 보낸다 — 저장된 레이어 모델이 숨겨 둔 획은 보기만 하는
    // 동안에도 숨겨져 있어야 한다. 그때는 세션이 없으므로 영상 정체로 맞춘다.
    if (state !== 'active' && state !== 'passive') return false;
    if (!confirmedVideoIdentity) return false;
    passiveLayerViewRevision += 1;
    if (currentSession) currentSession.layerViewRevision = passiveLayerViewRevision;
    const request = {
      ...makeEnvelope('layer-view-update', {}),
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId: currentSession?.sessionId ?? null,
      stableVideoIdentity: confirmedVideoIdentity,
      layerViewRevision: passiveLayerViewRevision,
      hiddenObjectIds: [...hiddenObjectIds],
      lockedObjectIds: [...lockedObjectIds],
      activeLayerDrawable: activeLayerDrawable !== false,
      // 레이어 조작이 정착하는 동안 팔레트 되돌리기를 잠근다.
      layerHistoryBusy: layerHistoryBusy === true,
      // 겹침 순서 랭크. 새 획이 그리는 순간 제 층에 들어가게 한다.
      objectRanks: Array.isArray(objectRanks) ? objectRanks : [],
      defaultRank: Number.isInteger(defaultRank) ? defaultRank : 0,
      // 새로 그리는 획이 들어갈 자리. 랭크 맵에는 이미 문서에 있는 id 만 있다.
      activeLayerRank: Number.isInteger(activeLayerRank)
        ? activeLayerRank
        : (Number.isInteger(defaultRank) ? defaultRank : 0)
    };
    try {
      const response = await withPersistenceIpcDeadline(
        electronAPI.mpvUpdateOverlayDrawingLayerView(request),
        { success: false, accepted: false, error: 'persistence-ipc-timeout' }
      );
      return response?.success === true && response.accepted === true;
    } catch {
      return false;
    }
  }

  // 굵기의 진실의 원천은 오버레이 런타임이다. 팔레트 슬라이더와 Alt 드래그는
  // 오버레이 안에서만 값을 바꾸고 컨트롤러에 알리지 않으므로, 컨트롤러가 절대값을
  // 세면 반드시 낡는다. 그래서 **증감만** 보내고 결과 값을 응답으로 받는다.
  async function sendBrushSizeStep(step) {
    if (state !== 'active' || !currentSession) return false;
    currentSession.brushRevision += 1;
    const request = {
      ...makeEnvelope('brush-update', { step }),
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId: currentSession.sessionId,
      brushRevision: currentSession.brushRevision,
      step
    };
    try {
      const response = await withPersistenceIpcDeadline(
        electronAPI.mpvUpdateOverlayDrawingBrush(request),
        { success: false, accepted: false, error: 'persistence-ipc-timeout' }
      );
      const accepted = response?.success === true && response.accepted === true;
      if (accepted && Number.isInteger(response.size)) lastKnownBrushSize = response.size;
      return accepted;
    } catch {
      return false;
    }
  }

  function makeDrawingActionRequest(action, payload = null) {
    if (state !== 'active' || !currentSession || !CONTROLLER_DRAWING_ACTIONS.has(action)) {
      return null;
    }
    const sessionId = currentSession.sessionId;
    const context = contextSnapshot();
    const targetFrame = Math.max(0, Math.trunc(Number(context.targetFrame) || 0));
    const totalFrames = Number(context.totalFrames);
    if (!validPilotContext(context) ||
        (Number.isSafeInteger(totalFrames) && totalFrames > 0 && targetFrame >= totalFrames)) {
      return null;
    }
    const request = {
      ...makeEnvelope('drawing-action', { action }),
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId,
      actionId: uuid(),
      action,
      targetFrame,
      // 레이어 조작만 페이로드를 나른다. 호스트가 형식을 다시 검사한다.
      ...(payload || null)
    };
    return { ...request };
  }

  async function sendDrawingActionRequest(request) {
    try {
      const response = await electronAPI.mpvApplyOverlayDrawingAction(request);
      if (!response || typeof response !== 'object') {
        return { success: false, applied: false };
      }
      // 실행취소가 키프레임을 없애거나 되살리면 전이만으로는 스토어의 키프레임 목록을
      // 맞출 수 없다(전이는 객체 단위다). 그대로 두면 타임라인이 다음 저장 주기까지
      // 사라진 키프레임 마커를 들고 있으므로 즉시 재동기한다.
      // 레이어 조작은 키프레임 집합을 바꾸지 않지만 씬 내용을 통째로 갈아
      // 끼우고 전이를 내보내지 않는다. 두 경우 모두 수화 문서를 다시 받아야
      // 렌더러가 조작 전 그림을 계속 투영하지 않는다.
      if (response.keyframeSetChanged === true ||
          response.persistenceResyncRequired === true) {
        runDetached(requestPersistenceResync());
      }
      return response;
    } catch {
      return { success: false, applied: false };
    }
  }

  function applyDrawingAction(action, payload = null) {
    return applyDrawingActionDetailed(action, payload)
      .then(response => response?.success === true);
  }

  // 응답 원문이 필요한 호출부용. 성공 여부만으로는 **의도한 no-change** 와
  // 전송 실패(낡은 토큰·타임아웃)를 가릴 수 없다 — 레이어 순서 이동은 그 둘을
  // 다르게 다뤄야 한다(전자는 모델을 반영, 후자는 되돌린다).
  // options.finalize 를 주면 **그것이 끝날 때까지 큐를 풀지 않는다.** 레이어
  // 조작은 오버레이 응답 뒤에 렌더러가 모델을 커밋하는데, 응답에서 큐를 풀어
  // 버리면 그 틈에 Ctrl+Z 가 씬을 먼저 되돌린다 — 그러면 아직 바뀌지 않은
  // 모델을 되돌리려 해 아무 일도 안 하고, 뒤이은 커밋이 이미 되돌린 씬 위에
  // 모델을 얹는다.
  function applyDrawingActionDetailed(action, payload = null, options = {}) {
    const request = makeDrawingActionRequest(action, payload);
    if (!request) {
      return Promise.resolve({ success: false, applied: false, reason: 'invalid-request' });
    }
    const operation = drawingActionQueue.then(async () => {
      const response = await sendDrawingActionRequest(request);
      if (typeof options.finalize === 'function') {
        try {
          await options.finalize(response);
        } catch (_error) {
          // 커밋 실패는 호출부가 다룬다. 큐만 풀어 준다.
        }
      }
      return response;
    });
    drawingActionQueue = operation.then(r => r?.success === true, () => false);
    return operation.then(r => r || { success: false, applied: false });
  }

  function enqueueHistoryFallback(historyAction, historyRevision) {
    const operation = drawingActionQueue.then(async () => {
      if (historyRevision !== readHistoryRevision()) return false;
      return onHistoryFallback(historyAction);
    });
    drawingActionQueue = operation.then(result => result === true, () => false);
    return operation;
  }

  function applyHistoryAction(historyAction, historyRevision) {
    const request = makeDrawingActionRequest(historyAction);
    if (!request) {
      return Promise.resolve({ success: false, applied: false });
    }
    const operation = drawingActionQueue.then(async () => {
      const result = await sendDrawingActionRequest(request);
      if (result?.applied === true &&
          typeof result.commandId === 'string' &&
          (result.historyDirection === 'undo' || result.historyDirection === 'redo')) {
        onLayerHistoryApplied({
          commandId: result.commandId,
          direction: result.historyDirection
        });
      }
      if (result?.applied === true || result?.duplicate === true) return result;
      if (result?.reason === 'history-empty' &&
          historyRevision === readHistoryRevision()) {
        await onHistoryFallback(historyAction);
      }
      return result;
    });
    drawingActionQueue = operation.then(r => r?.success === true, () => false);
    return operation;
  }

  function runDetached(operation) {
    Promise.resolve(operation).catch(() => {});
  }

  function persistenceRequestFrom(owner, keyframes = null) {
    const request = {
      hostGeneration: owner.hostGeneration,
      videoGeneration: owner.videoGeneration,
      persistenceSessionId: owner.persistenceSessionId,
      stableVideoIdentity: owner.stableVideoIdentity,
      fps: owner.fps,
      totalFrames: owner.totalFrames
    };
    if (keyframes !== null) request.keyframes = keyframes;
    return request;
  }

  function rebindPersistenceStore(owner) {
    const status = persistenceStore?.getStatus?.();
    if (status?.state !== 'ready' || status.compatible !== true) {
      return { accepted: false, reason: status?.reason || 'store-incompatible' };
    }
    if (typeof persistenceStore.exportRootValue !== 'function' ||
        typeof persistenceStore.importRootValue !== 'function') {
      return { accepted: false, reason: 'persistence-store-api-missing' };
    }
    let rootValue;
    try {
      rootValue = persistenceStore.exportRootValue();
      return persistenceStore.importRootValue(rootValue, {
        fps: owner.fps,
        totalFrames: owner.totalFrames,
        hostGeneration: owner.hostGeneration,
        videoGeneration: owner.videoGeneration,
        persistenceSessionId: owner.persistenceSessionId,
        stableVideoIdentity: owner.stableVideoIdentity
      });
    } catch (_error) {
      return { accepted: false, reason: 'persistence-store-rebind-failed' };
    }
  }

  function allocatePersistenceSessionId() {
    let nextPersistenceSessionId = null;
    try {
      nextPersistenceSessionId = persistenceSessionIdFactory();
    } catch (_error) {
      nextPersistenceSessionId = null;
    }
    persistenceSessionId =
      typeof nextPersistenceSessionId === 'string' &&
      nextPersistenceSessionId.length > 0 &&
      nextPersistenceSessionId.length <= 32768
        ? nextPersistenceSessionId
        : null;
    return persistenceSessionId !== null;
  }

  function getPersistenceSourceEpoch() {
    if (typeof persistenceStore?.getSourceEpoch !== 'function') return null;
    let value = null;
    try {
      value = persistenceStore.getSourceEpoch();
    } catch (_error) {
      return null;
    }
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  async function hydratePersistenceForCurrentVideo(
    contextOverrides = null,
    isStillCurrent = () => true,
    { allowVideoNotReady = false, onIpcFailure = null } = {}
  ) {
    if (!persistenceStore) return true;
    const owner = capturePersistenceOwner(contextOverrides, {
      allowVideoNotReady
    });
    if (!owner || !isStillCurrent()) {
      return setPersistenceBypass('invalid-persistence-context');
    }
    if (typeof persistenceStore.getHydrationDocument !== 'function' ||
        typeof persistenceStore.replaceFromOverlay !== 'function') {
      return setPersistenceBypass('persistence-store-api-missing');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rebound = rebindPersistenceStore(owner);
      if (rebound?.accepted !== true || rebound?.compatible !== true) {
        return setPersistenceBypass(rebound?.reason || 'store-incompatible');
      }
      const hydrationSourceEpoch = getPersistenceSourceEpoch();

      let documentValue;
      try {
        documentValue = persistenceStore.getHydrationDocument();
      } catch (_error) {
        documentValue = null;
      }
      if (!documentValue ||
          documentValue.fps !== owner.fps ||
          documentValue.totalFrames !== owner.totalFrames ||
          !Array.isArray(documentValue.keyframes)) {
        return setPersistenceBypass('invalid-hydration-document');
      }

      let hydration;
      try {
        hydration = await withPersistenceIpcDeadline(
          electronAPI.mpvHydrateOverlayDrawingVideo(
            persistenceRequestFrom(owner, documentValue.keyframes)
          ),
          { success: false, accepted: false, reason: 'persistence-ipc-timeout' }
        );
      } catch (_error) {
        hydration = null;
      }
      const hydrationAccepted = hydration?.success === true &&
        hydration?.accepted === true;
      if (!hydrationAccepted && typeof onIpcFailure === 'function') {
        onIpcFailure(
          hydration?.reason || hydration?.error || 'drawing-hydration-failed'
        );
      }
      if (!ownsPersistenceOwner(owner, { allowVideoNotReady }) ||
          !isStillCurrent()) {
        return false;
      }
      if (!hydrationAccepted) {
        if (hydration?.reason === 'persistence-ipc-rejected' &&
            typeof onIpcFailure === 'function') {
          return false;
        }
        return setPersistenceBypass(
          hydration?.reason || 'drawing-hydration-failed'
        );
      }

      let exported;
      try {
        exported = await withPersistenceIpcDeadline(
          electronAPI.mpvExportOverlayDrawingVideo(
            persistenceRequestFrom(owner)
          ),
          { success: false, accepted: false, reason: 'persistence-ipc-timeout' }
        );
      } catch (_error) {
        exported = null;
      }
      const exportAccepted = exported?.success === true &&
        exported?.accepted === true &&
        !!exported.snapshot;
      if (!exportAccepted && typeof onIpcFailure === 'function') {
        onIpcFailure(
          exported?.reason || exported?.error ||
          'drawing-hydration-verification-failed'
        );
      }
      if (!ownsPersistenceOwner(owner, { allowVideoNotReady }) ||
          !isStillCurrent()) {
        return false;
      }
      if (!exportAccepted) {
        if (exported?.reason === 'persistence-ipc-rejected' &&
            typeof onIpcFailure === 'function') {
          return false;
        }
        return setPersistenceBypass(
          exported?.reason || 'drawing-hydration-verification-failed'
        );
      }
      if (hydrationSourceEpoch !== null &&
          getPersistenceSourceEpoch() !== hydrationSourceEpoch) {
        continue;
      }

      let replaced;
      try {
        replaced = persistenceStore.replaceFromOverlay(exported.snapshot, {
          mode: 'hydrate'
        });
      } catch (_error) {
        replaced = null;
      }
      if (!ownsPersistenceOwner(owner, { allowVideoNotReady }) ||
          !isStillCurrent()) {
        return false;
      }
      if (replaced?.accepted !== true) {
        return setPersistenceBypass(
          replaced?.reason || 'drawing-hydration-verification-failed'
        );
      }
      persistenceBoundSourceEpoch = getPersistenceSourceEpoch();
      clearPersistenceBypass();
      return true;
    }
    return setPersistenceBypass('persistence-source-kept-changing');
  }

  async function pullAuthoritativePersistenceSnapshot() {
    if (!persistenceStore) {
      return { ok: true, eventEpoch: persistenceEventEpoch };
    }
    if (legacyBypass) {
      return {
        ok: !persistenceBlocked,
        eventEpoch: persistenceEventEpoch,
        reason: persistenceFailureReason
      };
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const owner = capturePersistenceOwner(null, {
        allowVideoNotReady: true
      });
      if (!owner) {
        return {
          ok: false,
          stale: true,
          eventEpoch: persistenceEventEpoch,
          reason: 'persistence-owner-unavailable'
        };
      }
      const startedEventEpoch = persistenceEventEpoch;
      const startedSourceEpoch = getPersistenceSourceEpoch();
      if (startedSourceEpoch !== null &&
          persistenceBoundSourceEpoch !== startedSourceEpoch) {
        return {
          ok: false,
          sourceChanged: true,
          eventEpoch: persistenceEventEpoch,
          reason: 'persistence-source-changed'
        };
      }
      let exported;
      try {
        exported = await withPersistenceIpcDeadline(
          electronAPI.mpvExportOverlayDrawingVideo(
            persistenceRequestFrom(owner)
          ),
          { success: false, accepted: false, reason: 'persistence-ipc-timeout' }
        );
      } catch (_error) {
        exported = null;
      }
      if (!ownsPersistenceOwner(owner, { allowVideoNotReady: true })) {
        return {
          ok: false,
          stale: true,
          eventEpoch: persistenceEventEpoch,
          reason: 'stale-persistence-owner'
        };
      }
      if (exported?.success !== true ||
          exported?.accepted !== true ||
          !exported.snapshot) {
        return {
          ok: false,
          hostUnavailable: exported?.reason === 'overlay-host-unavailable',
          eventEpoch: persistenceEventEpoch,
          reason: exported?.reason || 'drawing-export-failed'
        };
      }
      if (startedEventEpoch !== persistenceEventEpoch) continue;
      if (startedSourceEpoch !== null &&
          getPersistenceSourceEpoch() !== startedSourceEpoch) {
        return {
          ok: false,
          sourceChanged: true,
          eventEpoch: persistenceEventEpoch,
          reason: 'persistence-source-changed'
        };
      }

      let replaced;
      try {
        replaced = persistenceStore.replaceFromOverlay(exported.snapshot, {
          mode: 'resync'
        });
      } catch (_error) {
        replaced = null;
      }
      if (replaced?.accepted !== true) {
        return {
          ok: false,
          eventEpoch: persistenceEventEpoch,
          reason: replaced?.reason || 'drawing-resync-failed'
        };
      }
      return {
        ok: true,
        changed: replaced.changed === true,
        eventEpoch: startedEventEpoch
      };
    }

    return {
      ok: false,
      eventEpoch: persistenceEventEpoch,
      reason: 'drawing-snapshot-kept-changing'
    };
  }

  function enqueuePersistencePull() {
    const operation = persistencePullQueue.then(
      () => pullAuthoritativePersistenceSnapshot(),
      () => pullAuthoritativePersistenceSnapshot()
    );
    persistencePullQueue = operation.then(() => true, () => false);
    return operation;
  }

  // 회수 실패 중 '이번 시도만 실패한' 사유들. 데이터 손상이 아니므로 차단 래치로 승격하지 않는다.
  // 'stale-drawing-snapshot'은 오버레이가 요청 펜스보다 늦게 응답한 신선도 문제라
  // stale과 동일 취급한다(2026-08-27 결정).
  const TRANSIENT_PERSISTENCE_PULL_REASONS = new Set([
    'persistence-ipc-timeout',
    'stale-drawing-snapshot',
    'persistence-source-changed',
    'persistence-source-kept-changing',
    'drawing-snapshot-kept-changing'
  ]);

  function isTransientPersistencePullFailure(result) {
    if (!result) return false;
    if (result.stale === true) return true;
    return TRANSIENT_PERSISTENCE_PULL_REASONS.has(result.reason);
  }

  async function blockPersistenceAfterPullFailure(result) {
    if (result?.stale === true) return false;
    if (result?.hostUnavailable === true) {
      // 새 호스트가 현재 영상 소유권을 이어받아 재수화할 수 있도록 세션을 보존한다.
      return false;
    }
    if (isTransientPersistencePullFailure(result)) {
      // 신선도·타임아웃 등 일시 실패는 이번 저장만 중단하고 래치를 걸지 않는다.
      return false;
    }
    setPersistenceBypass(result?.reason || 'drawing-export-failed', {
      blocked: true
    });
    await bestEffortDisable();
    return false;
  }

  async function ensurePersistenceBindingCurrent() {
    const sourceEpoch = getPersistenceSourceEpoch();
    if (sourceEpoch === null || sourceEpoch === persistenceBoundSourceEpoch) {
      return { ok: true, reason: null };
    }
    if (videoReady) {
      const shouldResume = resumeRequested ||
        state === 'active' ||
        state === 'preparing';
      const owner = capturePersistenceOwner();
      if (!owner) return { ok: false, reason: null };
      let failureReason = null;
      const reconciled = await reconcileCurrentVideo(
        shouldResume,
        'passive',
        persistenceVideoContext,
        () => ownsPersistenceOwner(owner),
        reason => {
          failureReason = reason;
        }
      );
      return {
        ok: reconciled,
        stale: !reconciled && !ownsPersistenceOwner(owner),
        hostUnavailable: failureReason === 'overlay-host-unavailable',
        reason: failureReason
      };
    }
    const owner = capturePersistenceOwner(null, {
      allowVideoNotReady: true
    });
    if (!owner) return { ok: false, reason: null };
    let failureReason = null;
    const hydrated = await hydratePersistenceForCurrentVideo(
      persistenceVideoContext,
      () => ownsPersistenceOwner(owner, { allowVideoNotReady: true }),
      {
        allowVideoNotReady: true,
        onIpcFailure: reason => {
          failureReason = reason;
        }
      }
    );
    return {
      ok: hydrated,
      stale: !hydrated && !ownsPersistenceOwner(owner, { allowVideoNotReady: true }),
      hostUnavailable: failureReason === 'overlay-host-unavailable',
      reason: failureReason
    };
  }

  async function pullWithCurrentPersistenceBinding() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const binding = await ensurePersistenceBindingCurrent();
      if (binding?.ok !== true) {
        if (binding?.reason !== 'persistence-ipc-rejected' &&
            legacyBypass && !persistenceBlocked) {
          return {
            ok: true,
            bypassed: true,
            eventEpoch: persistenceEventEpoch
          };
        }
        return {
          ok: false,
          // 재바인딩(입력 해제·재수화·검증) 단계에서 끊긴 실패는 즉시 재시도해도
          // 같은 경로를 그대로 반복하므로, 회수(export) 단계 실패와 구분한다.
          bindingFailed: true,
          stale: binding?.stale === true,
          hostUnavailable: binding?.hostUnavailable === true,
          eventEpoch: persistenceEventEpoch,
          reason: binding?.reason || persistenceFailureReason || 'persistence-rebind-failed'
        };
      }
      const result = await enqueuePersistencePull();
      if (result?.sourceChanged === true) continue;
      return result;
    }
    return {
      ok: false,
      eventEpoch: persistenceEventEpoch,
      reason: 'persistence-source-kept-changing'
    };
  }

  async function preparePersistenceSnapshotForSave() {
    await persistenceSourceRefreshQueue;
    if (inFlightReadyReconciliation) {
      // 직전 영상 확정 처리(재수화·검증 회수)가 진행 중이면 완료를 기다린다.
      // 동시 진행 시 두 재수화가 서로의 source epoch를 무효화해 IPC 왕복이 수 배로 늘고
      // 결과가 stale로 흔들린다(2026-08 하네스 실측: 1.4초 → 9.9초).
      try {
        await inFlightReadyReconciliation.promise;
      } catch (_error) {
        // 확정 처리 실패는 아래 pull이 실상태 기준으로 다시 판정한다.
      }
    }
    if (!persistenceStore) return true;
    if (legacyBypass) return !persistenceBlocked;
    if (!persistenceSessionId) return true;
    let result = await pullWithCurrentPersistenceBinding();
    if (result?.ok !== true &&
        result?.hostUnavailable !== true &&
        result?.bindingFailed !== true &&
        result?.stale !== true &&
        isTransientPersistencePullFailure(result)) {
      // 회수 단계의 일시 실패(IPC 지연·요청 펜스 신선도 불일치)는 즉시 1회만 다시 회수한다.
      // 재바인딩 실패·소유권 상실은 재시도해도 같은 결과이므로 제외한다.
      result = await pullWithCurrentPersistenceBinding();
    }
    if (result?.ok === true) return true;
    if (result?.hostUnavailable === true) {
      // 오버레이 호스트가 이미 파괴된 상태: 회수할 드로잉 표면 자체가 없다.
      // 여기서 차단 래치를 걸면 모든 후속 영상 전환이 영구 거부되므로,
      // 현재 영상 소유권은 보존하고 다음 호스트가 재수화하도록 저장만 통과시킨다.
      return true;
    }
    if (isTransientPersistencePullFailure(result)) {
      // 호스트 응답 지연·신선도 불일치는 차단 래치로 승격하지 않지만,
      // 권위 스냅샷을 확인하지 못한 현재 저장은 중단한다.
      return false;
    }
    return blockPersistenceAfterPullFailure(result);
  }

  async function flushPersistenceBeforeLeave() {
    return preparePersistenceSnapshotForSave();
  }

  function requestPersistenceResync() {
    if (!persistenceStore || legacyBypass || !videoReady) {
      return Promise.resolve(false);
    }
    if (persistenceResyncPromise) {
      persistenceResyncTrailing = true;
      return persistenceResyncPromise;
    }
    const operation = (async () => {
      let result = null;
      do {
        persistenceResyncTrailing = false;
        result = await pullWithCurrentPersistenceBinding();
        if (result?.ok !== true) {
          if (result?.reason === 'persistence-ipc-timeout') return false;
          await blockPersistenceAfterPullFailure(result);
          return false;
        }
        if (result.eventEpoch === persistenceEventEpoch) {
          persistenceResyncTrailing = false;
        }
      } while (persistenceResyncTrailing);
      return true;
    })();
    persistenceResyncPromise = operation.finally(() => {
      if (persistenceResyncPromise) persistenceResyncPromise = null;
    });
    return persistenceResyncPromise;
  }

  function handlePersistenceEvent(message) {
    if (!persistenceStore ||
        persistenceSourceRefreshInProgress ||
        persistenceQuitSuspension !== null ||
        legacyBypass ||
        !videoReady ||
        !messageMatchesPersistenceOwner(message)) {
      return false;
    }
    persistenceEventEpoch += 1;
    if (message.type === 'resync-required') {
      runDetached(requestPersistenceResync());
      return true;
    }
    // 팔레트 버튼으로 되돌린 레이어 조작. 오버레이는 씬만 되돌렸으므로 모델을
    // 함께 되돌리고 문서를 다시 받아 온다.
    if (message.type === 'layer-history') {
      onLayerHistoryApplied({
        commandId: message.commandId,
        direction: message.direction
      });
      runDetached(requestPersistenceResync());
      return true;
    }
    if (message.type !== 'transition' || !message.transition) return false;

    let result;
    try {
      result = persistenceStore.applyTransition(message.transition);
    } catch (_error) {
      result = { applied: false, needsResync: true };
    }
    if (result?.needsResync === true) {
      runDetached(requestPersistenceResync());
    }
    return result?.applied === true || result?.needsResync === true;
  }

  function persistenceVideoMatches(owner) {
    const context = normalizePersistenceContext(
      persistenceVideoContext || contextSnapshot()
    );
    return Boolean(
      owner &&
      context &&
      videoReady &&
      owner.hostGeneration === hostGeneration &&
      owner.videoGeneration === videoGeneration &&
      owner.stableVideoIdentity === context.stableVideoIdentity
    );
  }

  async function runPersistenceSourceRefresh(installSource) {
    if (typeof installSource !== 'function') return false;
    if (!persistenceStore ||
        !pilotEnabled ||
        !persistenceBridgeReady ||
        !persistenceSessionId ||
        !hostGeneration ||
        !videoGeneration ||
        !videoReady) {
      await installSource();
      return true;
    }

    const owner = capturePersistenceOwner();
    if (!owner) {
      await installSource();
      return true;
    }

    const quitResumeIntent = persistenceQuitSuspension?.shouldResume === true;
    const shouldResume = persistenceQuitSuspension === null && (
      resumeRequested ||
      state === 'active' ||
      state === 'preparing'
    );
    persistenceSourceRefreshInProgress = true;
    resumeRequested = shouldResume;
    desiredInputEnabled = false;
    currentSession = null;
    setState('recovering');

    let installError = null;
    try {
      const request = makeInputRequest(false);
      const response = await invokeInput(request);
      if (!isCurrentInputRequest(request) ||
          !persistenceVideoMatches(owner)) {
        return false;
      }
      if (!isAcceptedInputResponse(response, false)) {
        await enterFailure(response?.error);
        return false;
      }

      const pulled = await enqueuePersistencePull();
      if (!persistenceVideoMatches(owner)) return false;
      if (pulled?.ok !== true) {
        if (pulled?.reason === 'persistence-ipc-timeout') {
          if (persistenceQuitSuspension) {
            resumeRequested = quitResumeIntent;
          } else if (resumeRequested) {
            await startEnable(
              persistenceVideoContext,
              () => ownsPersistenceOwner(owner)
            );
          } else {
            setState('passive');
          }
          return false;
        }
        await blockPersistenceAfterPullFailure(pulled);
        return false;
      }

      let installedSource = null;
      try {
        installedSource = await installSource();
      } catch (error) {
        installError = error;
      }
      if (!persistenceVideoMatches(owner)) return false;
      if (installError === null && installedSource === false) {
        // 소스 설치가 명시적으로 거부되면 설치 안 된 소스로 재수화하지 않는다.
        // 사용자가 그리던 중이면 드로잉 입력만 복원하고, 아니면 대기 상태로 내린다.
        if (resumeRequested) {
          const rejectOwner = capturePersistenceOwner();
          return startEnable(persistenceVideoContext, () => ownsPersistenceOwner(rejectOwner));
        }
        if (persistenceQuitSuspension) {
          // 종료 준비 유예 중에는 정상 경로(1120-1128행)처럼 재개 의도를 복원하고 recovering으로 홀드한다
          resumeRequested = quitResumeIntent;
          setState('recovering');
          return false;
        }
        setState('passive');
        return false;
      }

      persistenceOwnerEpoch += 1;
      persistenceBoundSourceEpoch = null;
      persistenceResyncTrailing = false;
      if (!allocatePersistenceSessionId()) {
        setPersistenceBypass('invalid-persistence-context', {
          blocked: true
        });
        await bestEffortDisable();
        return false;
      }

      clearPersistenceBypass();
      const refreshOwner = capturePersistenceOwner();
      const hydrated = await hydratePersistenceForCurrentVideo(
        persistenceVideoContext,
        () => ownsPersistenceOwner(refreshOwner)
      );
      if (installError) throw installError;
      if (!hydrated) {
        setState('passive');
        return true;
      }
      if (persistenceQuitSuspension) {
        persistenceQuitSuspension = {
          owner: refreshOwner,
          shouldResume: quitResumeIntent,
          context: { ...persistenceVideoContext }
        };
        resumeRequested = quitResumeIntent;
        setState('recovering');
        return true;
      }
      if (resumeRequested) {
        return startEnable(
          persistenceVideoContext,
          () => ownsPersistenceOwner(refreshOwner)
        );
      }
      setState('passive');
      return true;
    } finally {
      persistenceSourceRefreshInProgress = false;
      // 갱신이 어떤 경로로 끝나든 남은 B 예약을 여기서 소비한다.
      // 이미 진입 중(preparing/active)이면 try 경로가 소비를 끝냈고,
      // 종료 준비 유예는 자체 예약 의미론(1917-1926행)을 가지므로 건드리지 않는다.
      if (resumeRequested &&
          persistenceQuitSuspension === null &&
          state !== 'preparing' &&
          state !== 'active' &&
          persistenceVideoMatches(owner)) {
        const resumed = consumePendingResumeRequest(
          persistenceVideoContext,
          () => persistenceVideoMatches(owner),
          null,
          { settleState: 'passive' }
        );
        if (resumed !== null && resumed !== false) await resumed;
      }
      notifyStateChange();
    }
  }

  function refreshPersistenceSource(installSource) {
    if (typeof installSource !== 'function') return Promise.resolve(false);
    const operation = persistenceSourceRefreshQueue.then(
      () => runPersistenceSourceRefresh(installSource),
      () => runPersistenceSourceRefresh(installSource)
    );
    persistenceSourceRefreshQueue = operation.then(() => true, () => false);
    return operation;
  }

  async function runPersistenceQuitPreparation() {
    await persistenceSourceRefreshQueue;
    if (!pilotEnabled ||
        !persistenceStore ||
        !persistenceBridgeReady ||
        !persistenceSessionId ||
        !hostGeneration ||
        !videoGeneration ||
        !videoReady) {
      return true;
    }
    if (persistenceQuitSuspension) return true;

    const owner = capturePersistenceOwner();
    if (!owner) return true;
    const shouldResume = resumeRequested ||
      state === 'active' ||
      state === 'preparing';
    persistenceQuitSuspension = {
      owner,
      shouldResume,
      context: { ...persistenceVideoContext }
    };
    resumeRequested = shouldResume;
    desiredInputEnabled = false;
    currentSession = null;
    setState('recovering');

    const request = makeInputRequest(false);
    const response = await invokeInput(request);
    if (!isCurrentInputRequest(request) ||
        !ownsPersistenceOwner(owner)) {
      persistenceQuitSuspension = null;
      return false;
    }
    if (!isAcceptedInputResponse(response, false)) {
      persistenceQuitSuspension = null;
      return enterFailure(response?.error);
    }

    const pulled = await enqueuePersistencePull();
    if (!ownsPersistenceOwner(owner)) {
      persistenceQuitSuspension = null;
      return false;
    }
    if (pulled?.ok !== true) {
      if (pulled?.reason === 'persistence-ipc-timeout') return false;
      persistenceQuitSuspension = null;
      return blockPersistenceAfterPullFailure(pulled);
    }
    setState('recovering');
    return true;
  }

  function preparePersistenceForQuit() {
    if (persistenceQuitPreparationPromise) {
      return persistenceQuitPreparationPromise;
    }
    const operation = runPersistenceQuitPreparation();
    persistenceQuitPreparationPromise = operation.finally(() => {
      if (persistenceQuitPreparationPromise) {
        persistenceQuitPreparationPromise = null;
      }
    });
    return persistenceQuitPreparationPromise;
  }

  async function resumeAfterQuitCancelled() {
    if (persistenceQuitPreparationPromise) {
      await persistenceQuitPreparationPromise;
    }
    const suspension = persistenceQuitSuspension;
    persistenceQuitSuspension = null;
    if (!suspension ||
        legacyBypass ||
        persistenceBlocked ||
        !ownsPersistenceOwner(suspension.owner)) {
      return false;
    }
    resumeRequested = false;
    if (!suspension.shouldResume) {
      setState('passive');
      return true;
    }
    return startEnable(
      suspension.context,
      () => ownsPersistenceOwner(suspension.owner)
    );
  }

  async function startEnable(
    contextOverrides = null,
    isStillCurrent = () => true,
    onInputFailure = null
  ) {
    if (!isStillCurrent() ||
        !shouldOwnDrawingShortcut() ||
        !hostGeneration ||
        !videoGeneration ||
        !videoReady) {
      return false;
    }
    const context = contextSnapshot(contextOverrides);
    if (!validPilotContext(context) || !context.stableVideoIdentity) return false;

    passivePresentationBlock = null;
    resumeRequested = false;
    const session = buildSession(context);
    currentSession = session;
    const request = makeInputRequest(true, {
      sessionId: session.sessionId,
      stableVideoIdentity: session.stableVideoIdentity,
      targetFrame: session.targetFrame,
      sourceFrame: session.sourceFrame,
      sourceWidth: session.sourceWidth,
      sourceHeight: session.sourceHeight,
      canvasRect: copyRect(session.canvasRect),
      viewportRevision: session.viewportRevision,
      viewportTransform: copyViewportTransform(session.viewportTransform),
      tool: session.tool
    });
    setState('preparing');
    const response = await invokeInput(request);
    const inputAccepted = isAcceptedInputResponse(response, true);
    if (!inputAccepted && typeof onInputFailure === 'function') {
      onInputFailure(response?.reason || response?.error || null);
    }
    const stillCurrent = isCurrentInputRequest(request) &&
      isStillCurrent() &&
      currentSession?.sessionId === session.sessionId &&
      state === 'preparing';
    if (!stillCurrent) {
      // 준비 중 소유권을 잃었는데 아무도 상태를 내리지 않으면 preparing이 고착되어
      // #btnDrawMode의 준비중 표시가 남는다. 우리 세션이 여전히 preparing을
      // 들고 있을 때만(= 더 새 소유자가 없을 때만) 대기 상태로 정착시킨다.
      if (state === 'preparing' && currentSession?.sessionId === session.sessionId) {
        currentSession = null;
        setState('passive');
        if (inputAccepted) {
          // 오버레이는 이미 입력을 켠 상태이므로 표면을 반드시 되돌린다
          await bestEffortDisable();
        } else {
          desiredInputEnabled = false;
        }
      }
      return false;
    }
    if (!inputAccepted) {
      if (response?.reason === 'persistence-ipc-rejected' &&
          typeof onInputFailure === 'function') {
        return false;
      }
      return enterFailure(response?.error);
    }

    lastError = null;
    setState('active');
    const acceptedTargetFrame = Math.max(
      0,
      Math.trunc(Number(contextSnapshot().targetFrame) || 0)
    );
    if (acceptedTargetFrame === session.targetFrame) {
      recordActiveFrameObservation(acceptedTargetFrame);
    } else {
      runDetached(syncActiveDrawingFrame(acceptedTargetFrame, { force: true }));
    }
    if (desiredTool !== session.tool) {
      await sendTool(desiredTool);
    }
    return state === 'active' && currentSession?.sessionId === session.sessionId;
  }

  async function reconcileCurrentVideo(
    shouldResume,
    settledState = 'passive',
    enableContext = null,
    isStillCurrent = () => true,
    onInputFailure = null
  ) {
    if (!isStillCurrent() || !hostGeneration || !videoGeneration || !videoReady) return false;
    desiredInputEnabled = false;
    currentSession = null;
    const request = makeInputRequest(false);
    const response = await invokeInput(request);
    const inputAccepted = isAcceptedInputResponse(response, false);
    if (!inputAccepted && typeof onInputFailure === 'function') {
      onInputFailure(response?.reason || response?.error || null);
    }
    if (!isCurrentInputRequest(request) || !isStillCurrent()) return false;
    if (!inputAccepted) {
      if (response?.reason === 'persistence-ipc-rejected' &&
          typeof onInputFailure === 'function') {
        return false;
      }
      return enterFailure(response?.error);
    }
    if (persistenceStore) {
      let hydrationFailureReason = null;
      const hydrationOptions = {};
      if (typeof onInputFailure === 'function') {
        hydrationOptions.onIpcFailure = reason => {
          hydrationFailureReason = reason;
          onInputFailure(reason);
        };
      }
      const hydrated = await hydratePersistenceForCurrentVideo(
        enableContext,
        isStillCurrent,
        hydrationOptions
      );
      // 수화 대기 중 B 취소(disable)로 입력 revision이 넘어갔으면 재개하지 않는다
      if (!isCurrentInputRequest(request) || !isStillCurrent()) return false;
      if (!hydrated) {
        if (hydrationFailureReason === 'persistence-ipc-rejected' &&
            typeof onInputFailure === 'function') {
          return false;
        }
        // 수화 실패로 내려가면서 대기 중 들어온 B 예약을 명시적으로 취소한다.
        // 예약을 남기면 이후 호스트 재생성/영상 확정이 shouldResume으로 승격시켜
        // 사용자가 누르지 않은 드로잉 모드를 자동으로 켠다.
        // settleState는 넘기지 않는다 — 정착은 바로 아래 setState('passive')가 책임진다.
        consumePendingResumeRequest(enableContext, isStillCurrent, onInputFailure, {
          allowResume: false
        });
        setState('passive');
        return false;
      }
    }
    if (!isStillCurrent()) return false;
    if (shouldResume || resumeRequested) {
      resumeRequested = true;
    }
    const resumed = consumePendingResumeRequest(
      enableContext,
      isStillCurrent,
      onInputFailure,
      { settleState: settledState }
    );
    if (resumed !== null) return resumed;
    setState(settledState);
    return true;
  }

  function initialize() {
    if (initializePromise) return initializePromise;
    initializePromise = (async () => {
      let enabled = false;
      try {
        const value = await electronAPI.getFabricDrawingPilotState?.();
        enabled = typeof value === 'boolean' ? value : false;
      } catch {
        enabled = false;
      }
      if (enabled && persistenceStore) {
        const hasPersistenceApi =
          typeof electronAPI.mpvHydrateOverlayDrawingVideo === 'function' &&
          typeof electronAPI.mpvExportOverlayDrawingVideo === 'function' &&
          typeof electronAPI.onFabricDrawingPersistenceEvent === 'function' &&
          typeof persistenceStore.applyTransition === 'function' &&
          typeof persistenceStore.replaceFromOverlay === 'function';
        if (!hasPersistenceApi) {
          enabled = false;
          lastError = 'drawing persistence bridge is unavailable';
        } else {
          try {
            persistenceEventUnsubscribe =
              electronAPI.onFabricDrawingPersistenceEvent(handlePersistenceEvent);
            persistenceBridgeReady =
              typeof persistenceEventUnsubscribe === 'function';
          } catch {
            persistenceBridgeReady = false;
          }
          if (!persistenceBridgeReady) {
            enabled = false;
            lastError = 'drawing persistence listener is unavailable';
          }
        }
      }
      pilotEnabled = enabled;
      let subscribePointerdownFrame;
      try {
        subscribePointerdownFrame = electronAPI.onMpvOverlayDrawingPointerdownFrame;
      } catch {
        subscribePointerdownFrame = null;
      }
      if (enabled && typeof subscribePointerdownFrame === 'function') {
        try {
          subscribePointerdownFrame(handlePointerdownFrameRequest);
        } catch { /* optional pointerdown frame bridge */ }
      }
      setState(enabled ? 'passive' : 'disabled');
      return enabled;
    })();
    return initializePromise;
  }

  async function adoptOverlayCapability(value) {
    if (!pilotEnabled) return false;
    const capability = capabilityFrom(value);
    const generation = Number(capability?.hostGeneration);
    if (capability?.passiveReady !== true ||
        !Number.isInteger(generation) || generation <= 0) {
      return false;
    }
    if (generation === hostGeneration) return true;

    const shouldResume = resumeRequested || state === 'active' || state === 'preparing';
    hostGeneration = generation;
    persistenceOwnerEpoch += 1;
    desiredInputEnabled = false;
    currentSession = null;
    resumeRequested = shouldResume;
    setState('recovering');
    if (!videoReady || videoGeneration === 0) return true;
    return reconcileCurrentVideo(shouldResume);
  }

  async function beforeVideoChange(nextLoadToken = null) {
    if (!pilotEnabled) return true;
    await persistenceSourceRefreshQueue;
    const shouldResume = resumeRequested || state === 'active' || state === 'preparing';
    const previousRollback = videoChangePending ? videoChangeRollback : null;
    const previousContext = contextSnapshot();
    const canRestorePreviousVideo = videoReady &&
      videoGeneration > 0 &&
      validPilotContext(previousContext) &&
      String(previousContext.stableVideoIdentity || '') === confirmedVideoIdentity;
    const rollback = previousRollback || (canRestorePreviousVideo
      ? {
        context: {
          ...previousContext,
          canvasRect: copyRect(previousContext.canvasRect),
          viewportTransform: copyViewportTransform(previousContext.viewportTransform)
        },
        shouldResume
      }
      : null);
    resumeRequested = shouldResume;
    videoReady = false;
    persistenceOwnerEpoch += 1;
    persistenceResyncTrailing = false;
    videoChangePending = true;
    pendingLoadToken = normalizeLoadToken(nextLoadToken);
    videoChangeRollback = rollback;
    videoChangeEpoch += 1;
    const owner = currentVideoChangeOwner();
    setState('recovering');
    if (!hostGeneration || !videoGeneration) return true;

    // A newer media transition must prove that its own input revision is disabled.
    // desiredInputEnabled may already be false only because an older disable request
    // is still in flight and can later be rejected by the overlay host.
    currentSession = null;
    const request = makeInputRequest(false);
    const response = await invokeInput(request);
    if (!isCurrentInputRequest(request) || !ownsVideoChange(owner)) return false;
    if (!isAcceptedInputResponse(response, false)) {
      await enterFailure(response?.error);
      await cancelVideoChange(nextLoadToken, { restorePreviousVideo: true });
      return false;
    }
    setState('recovering');
    return true;
  }

  async function afterVideoReady(confirmation) {
    if (!pilotEnabled) return false;
    const overrides = confirmation && typeof confirmation === 'object' ? confirmation : null;
    const context = contextSnapshot(overrides);
    const loadToken = normalizeLoadToken(confirmation);
    if (pendingLoadToken !== null && loadToken !== pendingLoadToken) return false;
    const identity = String(context.stableVideoIdentity || '');
    if (inFlightReadyReconciliation &&
        inFlightReadyReconciliation.epoch === videoChangeEpoch) {
      if (inFlightReadyReconciliation.loadToken === loadToken &&
          validPilotContext(context) &&
          identity === inFlightReadyReconciliation.identity) {
        return inFlightReadyReconciliation.promise;
      }
      return false;
    }
    const reusesPreviousLoadTokenWithoutExpectedOwner = videoChangePending &&
      pendingLoadToken === null &&
      videoGeneration > 0 &&
      loadToken !== null &&
      loadToken === confirmedLoadToken;
    const repeatsPreviousIdentityWithoutToken = videoChangePending &&
      pendingLoadToken === null &&
      videoGeneration > 0 &&
      loadToken === null &&
      identity === confirmedVideoIdentity;
    if (reusesPreviousLoadTokenWithoutExpectedOwner || repeatsPreviousIdentityWithoutToken) {
      return false;
    }
    if (!validPilotContext(context)) {
      if (!videoChangePending) return false;
      if (pendingLoadToken === null && loadToken !== null) {
        pendingLoadToken = loadToken;
      }
      return cancelVideoChange(loadToken);
    }

    if (!identity) return false;
    if (!videoChangePending && videoGeneration > 0) {
      return identity === confirmedVideoIdentity &&
        (loadToken === null || loadToken === confirmedLoadToken);
    }

    if (!videoChangePending) {
      videoChangePending = true;
      pendingLoadToken = loadToken;
      videoChangeEpoch += 1;
    } else if (pendingLoadToken === null && loadToken !== null) {
      pendingLoadToken = loadToken;
    }
    const owner = currentVideoChangeOwner();
    const operation = {
      epoch: videoChangeEpoch,
      loadToken,
      identity,
      promise: null
    };
    operation.promise = (async () => {
      videoGeneration += 1;
      videoReady = true;
      confirmedVideoIdentity = identity;
      confirmedLoadToken = loadToken;
      persistenceOwnerEpoch += 1;
      persistenceEventEpoch = 0;
      persistenceResyncTrailing = false;
      persistenceVideoContext = normalizePersistenceContext(context);
      persistenceBoundSourceEpoch = null;
      if (persistenceStore) {
        allocatePersistenceSessionId();
        clearPersistenceBypass();
        if (!persistenceSessionId || !persistenceVideoContext) {
          setPersistenceBypass('invalid-persistence-context');
        }
      } else {
        persistenceSessionId = null;
      }
      const shouldResume = resumeRequested;
      setState('recovering');
      if (!hostGeneration) {
        finishVideoChange(owner);
        setState('passive');
        return false;
      }
      const reconciled = await reconcileCurrentVideo(
        shouldResume,
        'passive',
        context,
        () => ownsVideoChange(owner)
      );
      if (!ownsVideoChange(owner)) return false;
      finishVideoChange(owner);
      return reconciled;
    })();
    inFlightReadyReconciliation = operation;
    try {
      return await operation.promise;
    } finally {
      if (inFlightReadyReconciliation === operation) {
        inFlightReadyReconciliation = null;
      }
    }
  }

  async function cancelVideoChange(loadTokenValue = null, options = {}) {
    if (!pilotEnabled || !videoChangePending) return false;
    const loadToken = normalizeLoadToken(loadTokenValue);
    if (loadToken !== pendingLoadToken) return false;
    const shouldRestorePreviousVideo = options?.restorePreviousVideo === true;
    const rollback = shouldRestorePreviousVideo ? videoChangeRollback : null;
    if (rollback) {
      const owner = currentVideoChangeOwner();
      if (!finishVideoChange(owner)) return false;
      const restoreEpoch = videoChangeEpoch;
      videoReady = true;
      resumeRequested = rollback.shouldResume;
      setState('recovering');
      const isStillCurrent = () => (
        !videoChangePending &&
        videoChangeEpoch === restoreEpoch &&
        videoReady &&
        String(rollback.context.stableVideoIdentity || '') === confirmedVideoIdentity
      );
      if (options?.preserveAuthoritativeOverlay === true) {
        if (!isStillCurrent()) return false;
        if (legacyBypass || persistenceBlocked || !rollback.shouldResume) {
          // 2401행에서 세운 예약을 남기지 않고 취소한 뒤 대기 상태로 정착시킨다
          // (settleState 미전달 — 정착은 바로 아래 setState('passive')가 책임진다. (b)와 동일 규약)
          consumePendingResumeRequest(rollback.context, isStillCurrent, null, {
            allowResume: false
          });
          setState('passive');
          return true;
        }
        const resumed = consumePendingResumeRequest(rollback.context, isStillCurrent, null, {
          settleState: 'passive'
        });
        if (resumed !== null) return resumed;
        setState('passive');
        return true;
      }
      const restored = await reconcileCurrentVideo(
        rollback.shouldResume,
        'passive',
        rollback.context,
        isStillCurrent
      );
      if (!isStillCurrent()) return false;
      return restored;
    }
    settleWithoutPilotVideo();
    await bestEffortDisable();
    return true;
  }

  async function disable() {
    persistenceQuitSuspension = null;
    resumeRequested = false;
    syncExplicitResumeIntent();
    desiredInputEnabled = false;
    currentSession = null;
    const presentationBlock = {
      hostGeneration,
      videoGeneration,
      inputRevision
    };
    passivePresentationBlock = presentationBlock;
    setState(pilotEnabled ? 'passive' : 'disabled');
    if (!pilotEnabled || !hostGeneration || !videoGeneration) {
      releasePassivePresentationBlock(presentationBlock);
      return false;
    }

    const request = makeInputRequest(false);
    presentationBlock.inputRevision = request.inputRevision;
    let shouldPresent = false;
    try {
      const response = await invokeInput(request);
      if (!isCurrentInputRequest(request)) return false;
      if (!isAcceptedInputResponse(response, false)) {
        return enterFailure(response?.error);
      }
      shouldPresent = true;
      return true;
    } finally {
      const released = releasePassivePresentationBlock(presentationBlock);
      if (released && shouldPresent && state === 'passive' && !desiredInputEnabled) {
        runDetached(syncDisplayFrame(contextSnapshot().targetFrame, { force: true }));
      }
    }
  }

  function toggle() {
    if (!shouldOwnDrawingShortcut()) return Promise.resolve(false);
    if (persistenceQuitSuspension !== null) return Promise.resolve(false);
    const context = contextSnapshot();
    if (!validPilotContext(context)) return Promise.resolve(false);
    if (persistenceSourceRefreshInProgress) {
      // 저장 소스 갱신 중: B를 버리지 않고 갱신 완료 후 자동 진입/취소 예약으로 처리한다
      resumeRequested = !resumeRequested;
      syncExplicitResumeIntent();
      notifyStateChange();
      return Promise.resolve(true);
    }
    if (state === 'active' || state === 'preparing' ||
        (state === 'recovering' && resumeRequested)) {
      return disable();
    }
    if (state === 'recovering') {
      // 복구가 끝나면 자동으로 드로잉 모드에 진입하도록 예약한다
      resumeRequested = true;
      syncExplicitResumeIntent();
      notifyStateChange();
      return Promise.resolve(true);
    }
    if (state !== 'passive' && state !== 'failed') return Promise.resolve(false);
    if (!hostGeneration || !videoGeneration || !videoReady) {
      return enterFailure('drawing surface is unavailable');
    }
    return startEnable();
  }

  function routeKeydown(event = {}) {
    if (!shouldOwnDrawingShortcut() ||
        isImeKeyEvent(event) ||
        isEditableTarget(event.target)) {
      return false;
    }
    const context = contextSnapshot();
    if (!validPilotContext(context)) return false;

    const historyAction = drawingHistoryActionFromKeyEvent(event);
    if (historyAction) {
      if (state !== 'preparing' && state !== 'active' && state !== 'recovering') {
        return false;
      }
      consumeKeyEvent(event);
      if (event.repeat === true) return true;
      const historyRevision = readHistoryRevision();
      if (state !== 'active') {
        // 세션 준비·복구 중에는 fabric 히스토리를 쓸 수 없다 — 전역 undo로 폴백
        runDetached(enqueueHistoryFallback(historyAction, historyRevision));
        return true;
      }
      runDetached(applyHistoryAction(historyAction, historyRevision));
      return true;
    }
    const isDrawingToggleShortcut = matchesDrawingToggleShortcut(event);
    const isSelectionShortcut = matchesSelectionShortcut(event);
    // 사용자가 chord 로 재지정했을 수 있으므로 modifier 가드의 허용 목록에 넣는다.
    const brushSizeStep = matchBrushSizeShortcut(event);
    const shortcutTool = matchToolShortcut(event);
    // Shift+2·Shift+3·Ctrl+Alt+C·V 는 전부 수식키를 쓴다. 아래 수식키 가드의
    // 허용 목록에 넣지 않으면 판정 전에 통째로 빠져나간다.
    const frameOperation = matchFrameOperationShortcut(event);
    if (!isDrawingToggleShortcut && !isSelectionShortcut &&
      brushSizeStep === 0 && shortcutTool === null && frameOperation === null && (
      event.ctrlKey === true ||
      event.metaKey === true ||
      event.altKey === true ||
      event.shiftKey === true)) {
      return false;
    }
    // 도구 단축키는 선택 도구(V)와 같은 경로로 처리한다. 설정에서 배정할 수 있는
    // 액션이 실제로 도구를 바꾸지 않으면 설정 UI 가 거짓말을 하는 셈이다.
    if (shortcutTool !== null && (state === 'preparing' || state === 'active')) {
      consumeKeyEvent(event);
      desiredTool = shortcutTool;
      if (state === 'active') runDetached(sendTool(shortcutTool));
      return true;
    }
    // 구조 조작은 세션이 살아 있을 때만 의미가 있다. 오버레이가 키프레임 집합을
    // 바꾸고 keyframeSetChanged 로 알리면 sendDrawingActionRequest 가 타임라인을
    // 재동기한다(실행취소가 키프레임을 되살릴 때와 같은 경로).
    if (frameOperation !== null) {
      if (state !== 'active') return false;
      consumeKeyEvent(event);
      if (event.repeat === true) return true;
      runDetached(applyDrawingAction(frameOperation));
      return true;
    }
    if (brushSizeStep !== 0) {
      if (state !== 'active') return false;
      consumeKeyEvent(event);
      // 상한·하한은 오버레이가 자른다. 여기서 미리 판단하면 팔레트로 바꾼 굵기를
      // 모르는 채 "이미 최대"라고 잘못 넘겨 버릴 수 있다.
      runDetached(sendBrushSizeStep(brushSizeStep));
      return true;
    }

    const key = String(event.key || '').toLowerCase();
    const repeatIsRelevant = isDrawingToggleShortcut ||
      ((isSelectionShortcut || key === 'delete') &&
        (state === 'preparing' || state === 'active'));
    if (event.repeat === true && repeatIsRelevant) {
      consumeKeyEvent(event);
      if (isDrawingToggleShortcut) {
        bAutoRepeatIgnored += 1;
        notifyStateChange();
      }
      return true;
    }
    if (isDrawingToggleShortcut) {
      consumeKeyEvent(event);
      bInputAttempted += 1;
      // 여기서 알리면 아직 passive인 상태로 표시·오버레이 IPC가 한 번 더 나간다.
      // 직후 toggle()의 setState('preparing')와 아래 완료 핸들러가 카운터를 싣고
      // 알리므로, 카운터 반영이 한 틱 늦어지는 것을 허용한다.
      runDetached(Promise.resolve(toggle()).then(
        accepted => {
          if (accepted) {
            bInputAccepted += 1;
          } else {
            bInputRejected += 1;
          }
          notifyStateChange();
        },
        () => {
          bInputRejected += 1;
          notifyStateChange();
        }
      ));
      return true;
    }
    if (isSelectionShortcut && (state === 'preparing' || state === 'active')) {
      consumeKeyEvent(event);
      desiredTool = 'select';
      if (state === 'active') runDetached(sendTool('select'));
      return true;
    }
    if (key === 'delete' && (state === 'preparing' || state === 'active')) {
      consumeKeyEvent(event);
      if (state === 'active') runDetached(applyDrawingAction('delete-selection'));
      return true;
    }
    return false;
  }

  function isEnabled() {
    return pilotEnabled;
  }

  // 소유권은 파일럿 활성화와 persistence 브리지 준비 여부만으로 결정한다.
  // legacyBypass(저장 계층 저하)는 저장 게이트 전용 플래그이므로 여기서 참조하지 않는다.
  function shouldOwnDrawingShortcut() {
    return pilotEnabled &&
      (persistenceStore === null || persistenceBridgeReady);
  }

  function isActiveOrPreparing() {
    return state === 'active' || state === 'preparing';
  }

  function getState() {
    return state;
  }

  function getStatusSnapshot() {
    return localSnapshot();
  }

  async function diagnostics() {
    const local = localSnapshot();
    if (typeof electronAPI.mpvGetOverlayDrawingDiagnostics !== 'function') return local;
    try {
      const overlay = await electronAPI.mpvGetOverlayDrawingDiagnostics();
      return { ...local, overlay };
    } catch (error) {
      return {
        ...local,
        overlay: {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  return {
    initialize,
    adoptOverlayCapability,
    beforeVideoChange,
    afterVideoReady,
    cancelVideoChange,
    toggle,
    applyDrawingAction,
    applyDrawingActionDetailed,
    sendLayerView,
    routeKeydown,
    disable,
    preparePersistenceSnapshotForSave,
    flushPersistenceBeforeLeave,
    abandonPersistenceForVideoChange,
    refreshPersistenceSource,
    syncDisplayFrame,
    preparePersistenceForQuit,
    resumeAfterQuitCancelled,
    shouldOwnDrawingShortcut,
    clearPersistenceSaveBlock: clearPersistenceBypass,
    isEnabled,
    isActiveOrPreparing,
    getState,
    getStatusSnapshot,
    diagnostics
  };
}
