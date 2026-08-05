const { contextBridge, ipcRenderer } = require('electron');

const PERSISTENCE_CHANNEL = 'mpv-overlay:fabric-drawing-persistence';
const POINTER_PRESENCE_CHANNEL = 'mpv-overlay:pointer-presence';
const COLLABORATION_ACTION_CHANNEL = 'mpv-overlay:collaboration-action';
const COLLABORATION_DRAG_RESET_CHANNEL = 'mpv-overlay:collaboration-drag-reset';
const MAX_TRANSITION_BYTES = 8 * 1024 * 1024;
const MAX_COLLABORATION_POINTER_COORDINATE = 32768;
const encoder = new TextEncoder();
const overlayDocument = typeof document === 'object' ? document : null;
const overlayWindow = typeof window === 'object' ? window : null;
const COLLABORATION_NON_DRAG_ACTIONS = new Set([
  'collab.indicator-enter',
  'collab.indicator-leave',
  'collab.panel-enter',
  'collab.panel-leave',
  'collab.sync-status',
  'collab.cursor-toggle',
  'collab.open-sync',
  'sync.toggle',
  'sync.lead',
  'sync.follow',
  'sync.collapse',
  'sync.close'
]);
const COLLABORATION_DRAG_ACTIONS = new Set([
  'sync.drag-start',
  'sync.drag-move',
  'sync.drag-end'
]);
const COLLABORATION_ACTIVATION_BY_TARGET = Object.freeze({
  'collab.sync-status': 'collab.sync-status',
  'collab.cursor-toggle': 'collab.cursor-toggle',
  'collab.open-sync': 'collab.open-sync',
  'sync.toggle': 'sync.toggle',
  'sync.lead': 'sync.lead',
  'sync.follow': 'sync.follow',
  'sync.collapse': 'sync.collapse',
  'sync.close': 'sync.close'
});

function isExactPlainObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Object.keys(value);
    return keys.length === expectedKeys.length &&
      keys.every(key => expectedKeys.includes(key));
  } catch (_error) {
    return false;
  }
}

function readOverlayViewportRect() {
  try {
    const rect = overlayDocument?.documentElement?.getBoundingClientRect?.();
    if (!rect ||
        !Number.isFinite(rect.left) ||
        !Number.isFinite(rect.top) ||
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height
    };
  } catch (_error) {
    return null;
  }
}

function normalizeCollaborationPointerPayload(payload, { requireInsideViewport = false } = {}) {
  if (!isExactPlainObject(payload, ['pointerId', 'clientX', 'clientY']) ||
      !Number.isSafeInteger(payload.pointerId) || payload.pointerId < 0 ||
      !Number.isFinite(payload.clientX) ||
      Math.abs(payload.clientX) > MAX_COLLABORATION_POINTER_COORDINATE ||
      !Number.isFinite(payload.clientY) ||
      Math.abs(payload.clientY) > MAX_COLLABORATION_POINTER_COORDINATE) {
    return null;
  }
  if (requireInsideViewport) {
    const rect = readOverlayViewportRect();
    if (!rect || payload.clientX < rect.left || payload.clientX > rect.right ||
        payload.clientY < rect.top || payload.clientY > rect.bottom) {
      return null;
    }
  }
  return {
    pointerId: payload.pointerId,
    clientX: payload.clientX,
    clientY: payload.clientY
  };
}

function normalizeMpvOverlayCollaborationAction(value) {
  if (!isExactPlainObject(value, ['action', 'payload']) ||
      typeof value.action !== 'string') {
    return null;
  }
  if (COLLABORATION_NON_DRAG_ACTIONS.has(value.action)) {
    return value.payload === null ? { action: value.action, payload: null } : null;
  }
  if (COLLABORATION_DRAG_ACTIONS.has(value.action)) {
    const payload = normalizeCollaborationPointerPayload(value.payload);
    return payload ? { action: value.action, payload } : null;
  }
  if (value.action === 'sync.drag-cancel' &&
      isExactPlainObject(value.payload, ['pointerId']) &&
      Number.isSafeInteger(value.payload.pointerId) && value.payload.pointerId >= 0) {
    return {
      action: value.action,
      payload: { pointerId: value.payload.pointerId }
    };
  }
  return null;
}

function dispatchMpvOverlayCollaborationAction(value) {
  const normalized = normalizeMpvOverlayCollaborationAction(value);
  if (!normalized) return false;
  try {
    ipcRenderer.send(COLLABORATION_ACTION_CHANNEL, normalized);
    return true;
  } catch (_error) {
    return false;
  }
}

function closestElement(target, selector) {
  try {
    return target && typeof target.closest === 'function'
      ? target.closest(selector)
      : null;
  } catch (_error) {
    return null;
  }
}

function collaborationTargetFromEvent(event) {
  if (closestElement(event?.target, '.mpv-fabric-pilot-toolbar')) return null;
  return closestElement(event?.target, '[data-mpv-collab-target]');
}

function collaborationSurfaceFromTarget(target) {
  const explicitSurface = closestElement(target, '[data-mpv-collab-surface]');
  if (explicitSurface) return explicitSurface;
  let current = target;
  while (current) {
    const name = current?.dataset?.mpvCollabTarget;
    if (name === 'collab.indicator' || name === 'collab.panel') return current;
    current = current.parentElement || current.collaborationOwner || null;
  }
  return null;
}

function isInsideCollaborationMirror(event) {
  if (closestElement(event?.target, '.mpv-fabric-pilot-toolbar')) return false;
  if (closestElement(event?.target, '#collaborationMirror')) return true;
  return collaborationTargetFromEvent(event) !== null;
}

function suppressCollaborationPointerEvent(event) {
  try {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
  } catch (_error) {
    // Suppression is best effort, but dispatch still remains allowlisted below.
  }
}

function isPrimaryLeftPointer(event) {
  return event?.button === 0 && event?.isPrimary !== false &&
    Number.isSafeInteger(event?.pointerId) && event.pointerId >= 0;
}

function installCollaborationActionRelay() {
  if (!overlayDocument?.addEventListener ||
      typeof overlayWindow?.requestAnimationFrame !== 'function') {
    return () => false;
  }

  let activeDrag = null;
  let pendingMove = null;
  let dragEpoch = 0;
  let moveFramePending = false;

  const clearMoveFrame = () => {
    pendingMove = null;
    moveFramePending = false;
    dragEpoch += 1;
  };
  const releaseCapture = (drag) => {
    try {
      drag?.captureTarget?.releasePointerCapture?.(drag.pointerId);
    } catch (_error) {
      // lostpointercapture or host reset may already have released it.
    }
  };
  const cancelActiveDrag = ({ notify = true } = {}) => {
    const drag = activeDrag;
    if (!drag) return false;
    activeDrag = null;
    clearMoveFrame();
    if (notify) {
      dispatchMpvOverlayCollaborationAction({
        action: 'sync.drag-cancel',
        payload: { pointerId: drag.pointerId }
      });
    }
    releaseCapture(drag);
    return true;
  };
  const flushPendingMove = (fallbackEvent = null) => {
    if (!activeDrag) return false;
    const source = fallbackEvent || pendingMove;
    const payload = normalizeCollaborationPointerPayload({
      pointerId: activeDrag.pointerId,
      clientX: source?.clientX,
      clientY: source?.clientY
    });
    pendingMove = null;
    moveFramePending = false;
    if (!payload) return false;
    return dispatchMpvOverlayCollaborationAction({
      action: 'sync.drag-move',
      payload
    });
  };
  const scheduleMove = () => {
    if (moveFramePending) return;
    moveFramePending = true;
    const scheduledEpoch = dragEpoch;
    overlayWindow.requestAnimationFrame(() => {
      if (scheduledEpoch !== dragEpoch || !activeDrag) return;
      flushPendingMove();
    });
  };

  overlayDocument.addEventListener('pointerover', (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    const target = collaborationTargetFromEvent(event);
    const surface = collaborationSurfaceFromTarget(target);
    if (!surface || surface.contains?.(event.relatedTarget)) return;
    const name = surface.dataset?.mpvCollabTarget;
    if (name === 'collab.indicator' || name === 'collab.panel') {
      dispatchMpvOverlayCollaborationAction({
        action: name === 'collab.indicator'
          ? 'collab.indicator-enter'
          : 'collab.panel-enter',
        payload: null
      });
    }
  }, { capture: true, passive: false });

  overlayDocument.addEventListener('pointerout', (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    const target = collaborationTargetFromEvent(event);
    const surface = collaborationSurfaceFromTarget(target);
    if (!surface || surface.contains?.(event.relatedTarget)) return;
    const relatedTarget = collaborationTargetFromEvent({ target: event.relatedTarget });
    const relatedSurface = collaborationSurfaceFromTarget(relatedTarget);
    const name = surface.dataset?.mpvCollabTarget;
    const relatedName = relatedSurface?.dataset?.mpvCollabTarget;
    if (name === 'collab.indicator' && relatedName === 'collab.panel') return;
    if (name === 'collab.panel' && relatedName === 'collab.indicator') return;
    if (name === 'collab.indicator' || name === 'collab.panel') {
      dispatchMpvOverlayCollaborationAction({
        action: name === 'collab.indicator'
          ? 'collab.indicator-leave'
          : 'collab.panel-leave',
        payload: null
      });
    }
  }, { capture: true, passive: false });

  overlayDocument.addEventListener('pointerdown', (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    const target = collaborationTargetFromEvent(event);
    if (target?.dataset?.mpvCollabTarget !== 'sync.drag-handle' ||
        !isPrimaryLeftPointer(event) || activeDrag) {
      return;
    }
    const payload = normalizeCollaborationPointerPayload({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY
    }, { requireInsideViewport: true });
    if (!payload) return;
    try {
      if (typeof target.setPointerCapture !== 'function') return;
      target.setPointerCapture(event.pointerId);
    } catch (_error) {
      return;
    }
    activeDrag = { pointerId: event.pointerId, captureTarget: target };
    clearMoveFrame();
    dispatchMpvOverlayCollaborationAction({ action: 'sync.drag-start', payload });
  }, { capture: true, passive: false });

  overlayDocument.addEventListener('pointermove', (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (collaborationEvent || activeDrag) {
      suppressCollaborationPointerEvent(event);
    }
    if (!activeDrag || event?.pointerId !== activeDrag.pointerId) return;
    pendingMove = { clientX: event.clientX, clientY: event.clientY };
    scheduleMove();
  }, { capture: true, passive: false });

  overlayDocument.addEventListener('pointerup', (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (collaborationEvent || activeDrag) {
      suppressCollaborationPointerEvent(event);
    }
    if (!activeDrag || event?.pointerId !== activeDrag.pointerId) return;
    const drag = activeDrag;
    flushPendingMove(event);
    const payload = normalizeCollaborationPointerPayload({
      pointerId: drag.pointerId,
      clientX: event.clientX,
      clientY: event.clientY
    });
    activeDrag = null;
    clearMoveFrame();
    if (payload) {
      dispatchMpvOverlayCollaborationAction({ action: 'sync.drag-end', payload });
    } else {
      dispatchMpvOverlayCollaborationAction({
        action: 'sync.drag-cancel',
        payload: { pointerId: drag.pointerId }
      });
    }
    releaseCapture(drag);
  }, { capture: true, passive: false });

  for (const type of ['pointercancel', 'lostpointercapture']) {
    overlayDocument.addEventListener(type, (event) => {
      const collaborationEvent = isInsideCollaborationMirror(event);
      if (collaborationEvent || activeDrag) {
        suppressCollaborationPointerEvent(event);
      }
      if (activeDrag?.pointerId === event?.pointerId) cancelActiveDrag();
    }, { capture: true, passive: false });
  }

  overlayDocument.addEventListener('click', (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    if (event?.button !== 0) return;
    const target = collaborationTargetFromEvent(event);
    const action = COLLABORATION_ACTIVATION_BY_TARGET[target?.dataset?.mpvCollabTarget];
    if (action) dispatchMpvOverlayCollaborationAction({ action, payload: null });
  }, { capture: true, passive: false });

  overlayWindow.addEventListener?.('blur', () => {
    cancelActiveDrag();
  }, { capture: true });
  ipcRenderer.on?.(COLLABORATION_DRAG_RESET_CHANNEL, () => {
    cancelActiveDrag({ notify: false });
  });
  return cancelActiveDrag;
}

function readNormalizedPointerPresence(event) {
  try {
    if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return undefined;
    }
    const rect = overlayDocument?.documentElement?.getBoundingClientRect?.();
    if (!rect ||
        !Number.isFinite(rect.left) ||
        !Number.isFinite(rect.top) ||
        !Number.isFinite(rect.width) ||
        !Number.isFinite(rect.height) ||
        rect.width <= 0 ||
        rect.height <= 0) {
      return undefined;
    }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  } catch (_error) {
    return undefined;
  }
}

function installPointerPresenceRelay() {
  if (!overlayDocument?.addEventListener ||
      typeof overlayWindow?.requestAnimationFrame !== 'function') {
    return;
  }

  let hasPendingPresence = false;
  let pendingPresence;
  let animationFramePending = false;
  const flushPresence = () => {
    animationFramePending = false;
    if (!hasPendingPresence) return;
    const nextPresence = pendingPresence;
    hasPendingPresence = false;
    pendingPresence = undefined;
    try {
      ipcRenderer.send(POINTER_PRESENCE_CHANNEL, nextPresence);
    } catch (_error) {
      // Cursor presence is ephemeral; the next pointer event recovers the signal.
    }
  };
  const schedulePresence = (nextPresence) => {
    pendingPresence = nextPresence;
    hasPendingPresence = true;
    if (animationFramePending) return;
    animationFramePending = true;
    overlayWindow.requestAnimationFrame(flushPresence);
  };

  overlayDocument.addEventListener('pointermove', (event) => {
    const presence = readNormalizedPointerPresence(event);
    if (presence !== undefined) schedulePresence(presence);
  }, { capture: true, passive: true });
  overlayDocument.addEventListener('pointerleave', () => {
    schedulePresence(null);
  }, { capture: true, passive: true });
}

function readFence(value) {
  try {
    const hostGeneration = value?.hostGeneration;
    const videoGeneration = value?.videoGeneration;
    const persistenceSessionId = value?.persistenceSessionId;
    const stableVideoIdentity = value?.stableVideoIdentity;
    if (!Number.isSafeInteger(hostGeneration) || hostGeneration < 0 ||
        !Number.isSafeInteger(videoGeneration) || videoGeneration < 0 ||
        typeof persistenceSessionId !== 'string' ||
        persistenceSessionId.length === 0 || persistenceSessionId.length > 32768 ||
        typeof stableVideoIdentity !== 'string' ||
        stableVideoIdentity.length === 0 || stableVideoIdentity.length > 32768) {
      return null;
    }
    return {
      hostGeneration,
      videoGeneration,
      persistenceSessionId,
      stableVideoIdentity
    };
  } catch (_error) {
    return null;
  }
}

function makeResyncMessage(fence, reason) {
  return {
    type: 'resync-required',
    ...fence,
    reason
  };
}

function createPersistenceMessage(event) {
  const fence = readFence(event);
  if (!fence) return null;

  let serialized;
  try {
    serialized = JSON.stringify(event);
  } catch (_error) {
    return makeResyncMessage(fence, 'transition-serialization-failed');
  }
  if (typeof serialized !== 'string') {
    return makeResyncMessage(fence, 'transition-serialization-failed');
  }
  if (encoder.encode(serialized).byteLength > MAX_TRANSITION_BYTES) {
    return makeResyncMessage(fence, 'transition-too-large');
  }

  try {
    return {
      type: 'transition',
      transition: JSON.parse(serialized)
    };
  } catch (_error) {
    return makeResyncMessage(fence, 'transition-serialization-failed');
  }
}

const cancelActiveCollaborationDrag = installCollaborationActionRelay();
installPointerPresenceRelay();

contextBridge.exposeInMainWorld('mpvOverlayPersistence', Object.freeze({
  notifyCommittedTransition(event) {
    const message = createPersistenceMessage(event);
    if (!message) return false;
    try {
      ipcRenderer.send(PERSISTENCE_CHANNEL, message);
      return true;
    } catch (_error) {
      return false;
    }
  }
}));

contextBridge.exposeInMainWorld('mpvOverlayCollaborationActions', Object.freeze({
  dispatch(action) {
    return dispatchMpvOverlayCollaborationAction(action);
  },
  cancelActiveDrag() {
    return cancelActiveCollaborationDrag();
  }
}));
