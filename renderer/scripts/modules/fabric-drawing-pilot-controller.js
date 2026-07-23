const DRAWING_PROTOCOL = 'baeframe-drawing-surface';
const DRAWING_PROTOCOL_VERSION = 1;
const CONTROLLER_DRAWING_ACTIONS = new Set(['delete-selection', 'undo', 'redo']);

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
  const configuredDrawingToggleMatcher =
    typeof options.matchesDrawingToggleShortcut === 'function'
      ? options.matchesDrawingToggleShortcut
      : null;
  const configuredSelectionShortcutMatcher =
    typeof options.matchesSelectionShortcut === 'function'
      ? options.matchesSelectionShortcut
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

  let initializePromise = null;
  let pilotEnabled = false;
  let state = 'disabled';
  let hostGeneration = 0;
  let videoGeneration = 0;
  let inputRevision = 0;
  let desiredInputEnabled = false;
  let desiredTool = 'brush';
  let currentSession = null;
  let videoReady = false;
  let videoChangePending = false;
  let pendingLoadToken = null;
  let videoChangeEpoch = 0;
  let videoChangeRollback = null;
  let inFlightReadyReconciliation = null;
  let confirmedVideoIdentity = null;
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
  let persistenceFailureReason = null;
  let persistenceVideoContext = null;
  let persistenceBoundSourceEpoch = null;

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
      persistenceBlocked,
      persistenceFailureReason,
      persistenceSourceRefreshInProgress,
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
    state = nextState;
    notifyStateChange();
  }

  function setPersistenceBypass(reason, { blocked = false } = {}) {
    const normalizedReason = typeof reason === 'string' && reason
      ? reason.slice(0, 512)
      : 'persistence-unavailable';
    const changed = !legacyBypass ||
      persistenceBlocked !== blocked ||
      persistenceFailureReason !== normalizedReason;
    legacyBypass = true;
    persistenceBlocked = blocked;
    persistenceFailureReason = normalizedReason;
    desiredInputEnabled = false;
    resumeRequested = false;
    currentSession = null;
    persistenceBoundSourceEpoch = null;
    if (persistenceQuitSuspension) {
      persistenceQuitSuspension.shouldResume = false;
    }
    if (state !== 'disabled' && state !== 'passive') {
      setState('passive');
    } else if (changed) {
      notifyStateChange();
    }
    return false;
  }

  function clearPersistenceBypass() {
    const changed = legacyBypass || persistenceBlocked || persistenceFailureReason !== null;
    legacyBypass = false;
    persistenceBlocked = false;
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

  async function invokeInput(request) {
    if (typeof electronAPI.mpvSetOverlayDrawingInput !== 'function') {
      return { success: false, accepted: false, enabled: false };
    }
    try {
      const response = await electronAPI.mpvSetOverlayDrawingInput(request);
      if (!request.enabled && isCurrentInputRequest(request) &&
          isAcceptedInputResponse(response, false) &&
          (response.tool === 'brush' || response.tool === 'select')) {
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
    return {
      sessionId,
      persistenceSessionId,
      stableVideoIdentity: String(context.stableVideoIdentity || ''),
      targetFrame: Math.max(0, Math.trunc(Number(context.targetFrame) || 0)),
      sourceWidth: Number(context.sourceWidth),
      sourceHeight: Number(context.sourceHeight),
      canvasRect: copyRect(context.canvasRect),
      viewportRevision: Math.max(0, Math.trunc(Number(context.viewportRevision) || 0)),
      viewportTransform: copyViewportTransform(context.viewportTransform),
      tool: desiredTool,
      toolRevision: 0
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
      const response = await electronAPI.mpvUpdateOverlayDrawingTool(request);
      const accepted = response?.success === true && response.accepted === true;
      if (accepted && currentSession?.sessionId === request.sessionId) {
        currentSession.tool = tool;
      }
      return accepted;
    } catch {
      return false;
    }
  }

  function makeDrawingActionRequest(action) {
    if (state !== 'active' || !currentSession || !CONTROLLER_DRAWING_ACTIONS.has(action)) {
      return null;
    }
    const sessionId = currentSession.sessionId;
    const request = {
      ...makeEnvelope('drawing-action', { action }),
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId,
      actionId: uuid(),
      action
    };
    return { ...request };
  }

  async function sendDrawingActionRequest(request) {
    try {
      const response = await electronAPI.mpvApplyOverlayDrawingAction(request);
      return response?.success === true;
    } catch {
      return false;
    }
  }

  function applyDrawingAction(action) {
    const request = makeDrawingActionRequest(action);
    if (!request) return Promise.resolve(false);
    const operation = drawingActionQueue.then(() => sendDrawingActionRequest(request));
    drawingActionQueue = operation.catch(() => false);
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
    { allowVideoNotReady = false } = {}
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
        hydration = await electronAPI.mpvHydrateOverlayDrawingVideo(
          persistenceRequestFrom(owner, documentValue.keyframes)
        );
      } catch (_error) {
        hydration = null;
      }
      if (!ownsPersistenceOwner(owner, { allowVideoNotReady }) ||
          !isStillCurrent()) {
        return false;
      }
      if (hydration?.success !== true || hydration?.accepted !== true) {
        return setPersistenceBypass(
          hydration?.reason || 'drawing-hydration-failed'
        );
      }

      let exported;
      try {
        exported = await electronAPI.mpvExportOverlayDrawingVideo(
          persistenceRequestFrom(owner)
        );
      } catch (_error) {
        exported = null;
      }
      if (!ownsPersistenceOwner(owner, { allowVideoNotReady }) ||
          !isStillCurrent()) {
        return false;
      }
      if (exported?.success !== true ||
          exported?.accepted !== true ||
          !exported.snapshot) {
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
        exported = await electronAPI.mpvExportOverlayDrawingVideo(
          persistenceRequestFrom(owner)
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

  async function blockPersistenceAfterPullFailure(result) {
    if (result?.stale === true) return false;
    setPersistenceBypass(result?.reason || 'drawing-export-failed', {
      blocked: true
    });
    await bestEffortDisable();
    return false;
  }

  async function ensurePersistenceBindingCurrent() {
    const sourceEpoch = getPersistenceSourceEpoch();
    if (sourceEpoch === null || sourceEpoch === persistenceBoundSourceEpoch) {
      return true;
    }
    if (videoReady) {
      const shouldResume = resumeRequested ||
        state === 'active' ||
        state === 'preparing';
      const owner = capturePersistenceOwner();
      if (!owner) return false;
      return reconcileCurrentVideo(
        shouldResume,
        'passive',
        persistenceVideoContext,
        () => ownsPersistenceOwner(owner)
      );
    }
    const owner = capturePersistenceOwner(null, {
      allowVideoNotReady: true
    });
    if (!owner) return false;
    return hydratePersistenceForCurrentVideo(
      persistenceVideoContext,
      () => ownsPersistenceOwner(owner, { allowVideoNotReady: true }),
      { allowVideoNotReady: true }
    );
  }

  async function pullWithCurrentPersistenceBinding() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!await ensurePersistenceBindingCurrent()) {
        if (legacyBypass && !persistenceBlocked) {
          return {
            ok: true,
            bypassed: true,
            eventEpoch: persistenceEventEpoch
          };
        }
        return {
          ok: false,
          eventEpoch: persistenceEventEpoch,
          reason: persistenceFailureReason || 'persistence-rebind-failed'
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
    if (!persistenceStore) return true;
    if (legacyBypass) return !persistenceBlocked;
    if (!persistenceSessionId) return true;
    const result = await pullWithCurrentPersistenceBinding();
    if (result?.ok === true) return true;
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
        await blockPersistenceAfterPullFailure(pulled);
        return false;
      }

      try {
        await installSource();
      } catch (error) {
        installError = error;
      }
      if (!persistenceVideoMatches(owner)) return false;

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
      if (shouldResume) {
        return startEnable(
          persistenceVideoContext,
          () => ownsPersistenceOwner(refreshOwner)
        );
      }
      setState('passive');
      return true;
    } finally {
      persistenceSourceRefreshInProgress = false;
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

  async function startEnable(contextOverrides = null, isStillCurrent = () => true) {
    if (!isStillCurrent() ||
        !shouldOwnDrawingShortcut() ||
        !hostGeneration ||
        !videoGeneration ||
        !videoReady) {
      return false;
    }
    const context = contextSnapshot(contextOverrides);
    if (!validPilotContext(context) || !context.stableVideoIdentity) return false;

    resumeRequested = false;
    const session = buildSession(context);
    currentSession = session;
    const request = makeInputRequest(true, {
      sessionId: session.sessionId,
      stableVideoIdentity: session.stableVideoIdentity,
      targetFrame: session.targetFrame,
      sourceWidth: session.sourceWidth,
      sourceHeight: session.sourceHeight,
      canvasRect: copyRect(session.canvasRect),
      viewportRevision: session.viewportRevision,
      viewportTransform: copyViewportTransform(session.viewportTransform),
      tool: session.tool
    });
    setState('preparing');
    const response = await invokeInput(request);
    const stillCurrent = isCurrentInputRequest(request) &&
      isStillCurrent() &&
      currentSession?.sessionId === session.sessionId &&
      state === 'preparing';
    if (!stillCurrent) return false;
    if (!isAcceptedInputResponse(response, true)) {
      return enterFailure(response?.error);
    }

    lastError = null;
    setState('active');
    if (desiredTool !== session.tool) {
      await sendTool(desiredTool);
    }
    return state === 'active' && currentSession?.sessionId === session.sessionId;
  }

  async function reconcileCurrentVideo(
    shouldResume,
    settledState = 'passive',
    enableContext = null,
    isStillCurrent = () => true
  ) {
    if (!isStillCurrent() || !hostGeneration || !videoGeneration || !videoReady) return false;
    desiredInputEnabled = false;
    currentSession = null;
    const request = makeInputRequest(false);
    const response = await invokeInput(request);
    if (!isCurrentInputRequest(request) || !isStillCurrent()) return false;
    if (!isAcceptedInputResponse(response, false)) {
      return enterFailure(response?.error);
    }
    if (persistenceStore) {
      const hydrated = await hydratePersistenceForCurrentVideo(
        enableContext,
        isStillCurrent
      );
      if (!isStillCurrent()) return false;
      if (!hydrated) {
        setState('passive');
        return false;
      }
    }
    if (shouldResume) return startEnable(enableContext, isStillCurrent);
    if (!isStillCurrent()) return false;
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

  function disable() {
    persistenceQuitSuspension = null;
    resumeRequested = false;
    desiredInputEnabled = false;
    currentSession = null;
    setState(pilotEnabled ? 'passive' : 'disabled');
    if (!pilotEnabled || !hostGeneration || !videoGeneration) return Promise.resolve(false);

    const request = makeInputRequest(false);
    return invokeInput(request).then(async response => {
      if (!isCurrentInputRequest(request)) return false;
      if (!isAcceptedInputResponse(response, false)) {
        return enterFailure(response?.error);
      }
      return true;
    });
  }

  function toggle() {
    if (!shouldOwnDrawingShortcut()) return Promise.resolve(false);
    if (persistenceSourceRefreshInProgress ||
        persistenceQuitSuspension !== null) {
      return Promise.resolve(false);
    }
    const context = contextSnapshot();
    if (!validPilotContext(context)) return Promise.resolve(false);
    if (state === 'active' || state === 'preparing' ||
        (state === 'recovering' && resumeRequested)) {
      return disable();
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
      if (state !== 'preparing' && state !== 'active') return false;
      consumeKeyEvent(event);
      if (event.repeat !== true && state === 'active') {
        runDetached(applyDrawingAction(historyAction));
      }
      return true;
    }
    const isDrawingToggleShortcut = matchesDrawingToggleShortcut(event);
    const isSelectionShortcut = matchesSelectionShortcut(event);
    if (!isDrawingToggleShortcut && !isSelectionShortcut && (
      event.ctrlKey === true ||
      event.metaKey === true ||
      event.altKey === true ||
      event.shiftKey === true)) {
      return false;
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
      notifyStateChange();
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

  function shouldOwnDrawingShortcut() {
    return pilotEnabled &&
      !legacyBypass &&
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
    routeKeydown,
    disable,
    preparePersistenceSnapshotForSave,
    flushPersistenceBeforeLeave,
    refreshPersistenceSource,
    preparePersistenceForQuit,
    resumeAfterQuitCancelled,
    shouldOwnDrawingShortcut,
    isEnabled,
    isActiveOrPreparing,
    getState,
    getStatusSnapshot,
    diagnostics
  };
}
