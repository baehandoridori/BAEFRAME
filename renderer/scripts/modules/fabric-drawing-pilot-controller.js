const DRAWING_PROTOCOL = 'baeframe-drawing-surface';
const DRAWING_PROTOCOL_VERSION = 1;

function copyRect(rect) {
  return rect && typeof rect === 'object' ? { ...rect } : null;
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

export function createFabricDrawingPilotController(options = {}) {
  const electronAPI = options.electronAPI || {};
  const getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};
  let fallbackId = 0;
  const uuid = typeof options.uuid === 'function'
    ? options.uuid
    : () => globalThis.crypto?.randomUUID?.() || `fabric-request-${Date.now()}-${++fallbackId}`;

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
  let confirmedVideoIdentity = null;
  let confirmedLoadToken = null;
  let resumeRequested = false;
  let lastError = null;

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
      lastError
    };
  }

  function setState(nextState) {
    if (state === nextState) return;
    state = nextState;
    const snapshot = localSnapshot();
    try {
      onStateChange(state, snapshot);
    } catch {
      // State delivery is advisory and must not change the input boundary.
    }
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
      return await electronAPI.mpvSetOverlayDrawingInput(request);
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
    resumeRequested = false;
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
    return true;
  }

  function buildSession(context) {
    const sessionId = uuid();
    return {
      sessionId,
      stableVideoIdentity: String(context.stableVideoIdentity || ''),
      targetFrame: Math.max(0, Math.trunc(Number(context.targetFrame) || 0)),
      sourceWidth: Number(context.sourceWidth),
      sourceHeight: Number(context.sourceHeight),
      canvasRect: copyRect(context.canvasRect),
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

  async function applyDeleteSelection() {
    if (state !== 'active' || !currentSession) return false;
    const request = {
      ...makeEnvelope('drawing-action', { action: 'delete-selection' }),
      hostGeneration,
      videoGeneration,
      inputRevision,
      sessionId: currentSession.sessionId,
      actionId: uuid(),
      action: 'delete-selection'
    };
    try {
      const response = await electronAPI.mpvApplyOverlayDrawingAction(request);
      return response?.success === true;
    } catch {
      return false;
    }
  }

  function runDetached(operation) {
    Promise.resolve(operation).catch(() => {});
  }

  async function startEnable(contextOverrides = null, isStillCurrent = () => true) {
    if (!isStillCurrent() || !pilotEnabled || !hostGeneration || !videoGeneration || !videoReady) return false;
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
    desiredInputEnabled = false;
    currentSession = null;
    resumeRequested = shouldResume;
    setState('recovering');
    if (!videoReady || videoGeneration === 0) return true;
    return reconcileCurrentVideo(shouldResume);
  }

  async function beforeVideoChange(nextLoadToken = null) {
    if (!pilotEnabled) return false;
    const shouldResume = resumeRequested || state === 'active' || state === 'preparing';
    resumeRequested = shouldResume;
    videoReady = false;
    videoChangePending = true;
    pendingLoadToken = normalizeLoadToken(nextLoadToken);
    videoChangeEpoch += 1;
    const owner = currentVideoChangeOwner();
    setState('recovering');
    if (!desiredInputEnabled || !hostGeneration || !videoGeneration) return true;

    currentSession = null;
    const request = makeInputRequest(false);
    const response = await invokeInput(request);
    if (!isCurrentInputRequest(request) || !ownsVideoChange(owner)) return false;
    if (!isAcceptedInputResponse(response, false)) {
      finishVideoChange(owner);
      return enterFailure(response?.error);
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
    if (!validPilotContext(context)) {
      if (!videoChangePending) return false;
      return cancelVideoChange(loadToken);
    }

    const identity = String(context.stableVideoIdentity || '');
    if (!identity) return false;
    const repeatsPreviousWithoutExpectedToken = videoChangePending &&
      pendingLoadToken === null &&
      videoGeneration > 0 &&
      identity === confirmedVideoIdentity &&
      (loadToken === null || loadToken === confirmedLoadToken);
    if (repeatsPreviousWithoutExpectedToken) return false;
    const duplicate = !videoChangePending &&
      videoGeneration > 0 &&
      identity === confirmedVideoIdentity &&
      (loadToken === null || loadToken === confirmedLoadToken);
    if (duplicate) return true;

    if (!videoChangePending) {
      videoChangePending = true;
      pendingLoadToken = loadToken;
      videoChangeEpoch += 1;
    } else if (pendingLoadToken === null && loadToken !== null) {
      pendingLoadToken = loadToken;
    }
    const owner = currentVideoChangeOwner();

    videoGeneration += 1;
    videoReady = true;
    confirmedVideoIdentity = identity;
    confirmedLoadToken = loadToken;
    const shouldResume = resumeRequested;
    setState('recovering');
    if (!hostGeneration) {
      finishVideoChange(owner);
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
  }

  async function cancelVideoChange(loadTokenValue = null) {
    if (!pilotEnabled || !videoChangePending) return false;
    const loadToken = normalizeLoadToken(loadTokenValue);
    if (loadToken !== pendingLoadToken) return false;
    settleWithoutPilotVideo();
    await bestEffortDisable();
    return true;
  }

  function disable() {
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
    if (!pilotEnabled) return Promise.resolve(false);
    const context = contextSnapshot();
    if (!validPilotContext(context)) return Promise.resolve(false);
    if (state === 'active' || state === 'preparing' ||
        (state === 'recovering' && resumeRequested)) {
      return disable();
    }
    if (state !== 'passive') return Promise.resolve(false);
    return startEnable();
  }

  function routeKeydown(event = {}) {
    if (!pilotEnabled ||
        event.isComposing === true ||
        event.keyCode === 229 ||
        event.ctrlKey === true ||
        event.metaKey === true ||
        event.altKey === true ||
        event.shiftKey === true ||
        isEditableTarget(event.target)) {
      return false;
    }
    const context = contextSnapshot();
    if (!validPilotContext(context)) return false;

    const key = String(event.key || '').toLowerCase();
    const repeatIsRelevant = key === 'b' ||
      ((key === 'v' || key === 'delete') && (state === 'preparing' || state === 'active'));
    if (event.repeat === true && repeatIsRelevant) {
      consumeKeyEvent(event);
      return true;
    }
    if (key === 'b') {
      consumeKeyEvent(event);
      runDetached(toggle());
      return true;
    }
    if (key === 'v' && (state === 'preparing' || state === 'active')) {
      consumeKeyEvent(event);
      desiredTool = 'select';
      if (state === 'active') runDetached(sendTool('select'));
      return true;
    }
    if (key === 'delete' && (state === 'preparing' || state === 'active')) {
      consumeKeyEvent(event);
      if (state === 'active') runDetached(applyDeleteSelection());
      return true;
    }
    return false;
  }

  function isEnabled() {
    return pilotEnabled;
  }

  function isActiveOrPreparing() {
    return state === 'active' || state === 'preparing';
  }

  function getState() {
    return state;
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
    routeKeydown,
    disable,
    isEnabled,
    isActiveOrPreparing,
    getState,
    diagnostics
  };
}
