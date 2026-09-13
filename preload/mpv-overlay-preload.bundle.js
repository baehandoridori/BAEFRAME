var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// shared/viewport-pan-message.js
var require_viewport_pan_message = __commonJS({
  "shared/viewport-pan-message.js"(exports2, module2) {
    "use strict";
    var PAN_CHANNEL2 = "mpv-overlay:viewport-pan";
    var PAN_COMMAND_CHANNEL2 = "mpv-overlay:viewport-pan-command";
    var FENCE_KEYS = ["gestureId", "sequence", "pointerId", "hostGeneration", "videoGeneration", "persistenceSessionId", "stableVideoIdentity"];
    var SESSION_KEYS = ["hostGeneration", "videoGeneration", "persistenceSessionId", "stableVideoIdentity"];
    function exact(value, keys) {
      if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
      const own = Reflect.ownKeys(value);
      return own.length === keys.length && own.every((key) => keys.includes(key) && Object.getOwnPropertyDescriptor(value, key)?.get === void 0);
    }
    function boundedString(value, max) {
      return typeof value === "string" && value.length > 0 && value.length <= max;
    }
    function fenceValid(value) {
      return ["sequence", "pointerId", "hostGeneration", "videoGeneration"].every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) && boundedString(value.gestureId, 256) && boundedString(value.persistenceSessionId, 32768) && boundedString(value.stableVideoIdentity, 32768);
    }
    function normalizeViewportPanMessage2(value) {
      if (!exact(value, [...FENCE_KEYS, "phase", "clientX", "clientY"]) || !fenceValid(value) || !["start", "move", "end", "cancel"].includes(value.phase) || (value.phase === "start" ? value.sequence !== 0 : value.sequence < 1) || !["clientX", "clientY"].every((key) => Number.isFinite(value[key]) && Math.abs(value[key]) <= 1e6)) return null;
      return { ...value };
    }
    function normalizeViewportPanCommand2(value) {
      const extra = value?.type === "decision" ? ["disposition", "transform"] : ["ack", "cancel"].includes(value?.type) ? ["transform"] : [];
      if (!exact(value, [...FENCE_KEYS, "type", ...extra]) || !fenceValid(value) || !["decision", "ack", "flush", "cancel"].includes(value.type)) return null;
      if (value.type === "decision" && !["pan", "draw", "blocked"].includes(value.disposition)) return null;
      if (extra.includes("transform")) {
        const t = value.transform;
        if (!exact(t, ["scale", "panX", "panY"]) || !Object.values(t).every(Number.isFinite) || t.scale < 0.25 || t.scale > 8) return null;
        return { ...value, transform: { ...t } };
      }
      return { ...value };
    }
    function samePanSession(a, b) {
      return !!a && !!b && SESSION_KEYS.every((key) => a[key] === b[key]);
    }
    function samePanGesture(a, b) {
      return samePanSession(a, b) && a.gestureId === b.gestureId && a.pointerId === b.pointerId;
    }
    function panCommandFields(value) {
      return Object.fromEntries(FENCE_KEYS.map((key) => [key, value[key]]));
    }
    module2.exports = { PAN_CHANNEL: PAN_CHANNEL2, PAN_COMMAND_CHANNEL: PAN_COMMAND_CHANNEL2, normalizeViewportPanMessage: normalizeViewportPanMessage2, normalizeViewportPanCommand: normalizeViewportPanCommand2, samePanSession, samePanGesture, panCommandFields };
  }
});

// preload/mpv-overlay-preload.js
var { contextBridge, ipcRenderer } = require("electron");
var { PAN_CHANNEL, PAN_COMMAND_CHANNEL, normalizeViewportPanMessage, normalizeViewportPanCommand } = require_viewport_pan_message();
contextBridge.exposeInMainWorld("mpvOverlayViewportPan", {
  send(value) {
    const normalized = normalizeViewportPanMessage(value);
    if (!normalized) return false;
    try {
      ipcRenderer.send(PAN_CHANNEL, normalized);
      return true;
    } catch {
      return false;
    }
  },
  onCommand(callback) {
    if (typeof callback !== "function") return () => {
    };
    const listener = (_event, value) => {
      const command = normalizeViewportPanCommand(value);
      if (command) callback(command);
    };
    ipcRenderer.on(PAN_COMMAND_CHANNEL, listener);
    return () => ipcRenderer.removeListener(PAN_COMMAND_CHANNEL, listener);
  }
});
var PERSISTENCE_CHANNEL = "mpv-overlay:fabric-drawing-persistence";
var POINTER_PRESENCE_CHANNEL = "mpv-overlay:pointer-presence";
var COLLABORATION_ACTION_CHANNEL = "mpv-overlay:collaboration-action";
var COLLABORATION_DRAG_RESET_CHANNEL = "mpv-overlay:collaboration-drag-reset";
var DRAWING_POINTERDOWN_FRAME_REQUEST_CHANNEL = "mpv-overlay:drawing-pointerdown-frame-request";
var DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS = Object.freeze([
  "hostGeneration",
  "videoGeneration",
  "inputRevision",
  "sessionId",
  "pointerdownId",
  "pointerdownAt"
]);
var MAX_TRANSITION_BYTES = 8 * 1024 * 1024;
var MAX_COLLABORATION_POINTER_COORDINATE = 32768;
var encoder = new TextEncoder();
var overlayDocument = typeof document === "object" ? document : null;
var overlayWindow = typeof window === "object" ? window : null;
var COLLABORATION_NON_DRAG_ACTIONS = /* @__PURE__ */ new Set([
  "collab.indicator-enter",
  "collab.indicator-leave",
  "collab.panel-enter",
  "collab.panel-leave",
  "collab.sync-status",
  "collab.cursor-toggle",
  "collab.open-sync",
  "sync.toggle",
  "sync.lead",
  "sync.follow",
  "sync.collapse",
  "sync.close"
]);
var COLLABORATION_DRAG_ACTIONS = /* @__PURE__ */ new Set([
  "sync.drag-start",
  "sync.drag-move",
  "sync.drag-end"
]);
var COLLABORATION_ACTIVATION_BY_TARGET = Object.freeze({
  "collab.sync-status": "collab.sync-status",
  "collab.cursor-toggle": "collab.cursor-toggle",
  "collab.open-sync": "collab.open-sync",
  "sync.toggle": "sync.toggle",
  "sync.lead": "sync.lead",
  "sync.follow": "sync.follow",
  "sync.collapse": "sync.collapse",
  "sync.close": "sync.close"
});
function isExactPlainObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === expectedKeys.length && keys.every((key) => typeof key === "string" && expectedKeys.includes(key));
  } catch (_error) {
    return false;
  }
}
function normalizeDrawingPointerdownFrameRequest(value) {
  if (!isExactPlainObject(value, DRAWING_POINTERDOWN_FRAME_REQUEST_KEYS) || !Number.isSafeInteger(value.hostGeneration) || value.hostGeneration <= 0 || !Number.isSafeInteger(value.videoGeneration) || value.videoGeneration <= 0 || !Number.isSafeInteger(value.inputRevision) || value.inputRevision <= 0 || typeof value.sessionId !== "string" || value.sessionId.length === 0 || value.sessionId.length > 256 || typeof value.pointerdownId !== "string" || value.pointerdownId.length === 0 || value.pointerdownId.length > 256 || !Number.isSafeInteger(value.pointerdownAt) || value.pointerdownAt < 0) {
    return null;
  }
  return {
    hostGeneration: value.hostGeneration,
    videoGeneration: value.videoGeneration,
    inputRevision: value.inputRevision,
    sessionId: value.sessionId,
    pointerdownId: value.pointerdownId,
    pointerdownAt: value.pointerdownAt
  };
}
function readOverlayViewportRect() {
  try {
    const rect = overlayDocument?.documentElement?.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
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
  if (!isExactPlainObject(payload, ["pointerId", "clientX", "clientY"]) || !Number.isSafeInteger(payload.pointerId) || payload.pointerId < 0 || !Number.isFinite(payload.clientX) || Math.abs(payload.clientX) > MAX_COLLABORATION_POINTER_COORDINATE || !Number.isFinite(payload.clientY) || Math.abs(payload.clientY) > MAX_COLLABORATION_POINTER_COORDINATE) {
    return null;
  }
  if (requireInsideViewport) {
    const rect = readOverlayViewportRect();
    if (!rect || payload.clientX < rect.left || payload.clientX > rect.right || payload.clientY < rect.top || payload.clientY > rect.bottom) {
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
  if (!isExactPlainObject(value, ["action", "payload"]) || typeof value.action !== "string") {
    return null;
  }
  if (COLLABORATION_NON_DRAG_ACTIONS.has(value.action)) {
    return value.payload === null ? { action: value.action, payload: null } : null;
  }
  if (COLLABORATION_DRAG_ACTIONS.has(value.action)) {
    const payload = normalizeCollaborationPointerPayload(value.payload);
    return payload ? { action: value.action, payload } : null;
  }
  if (value.action === "sync.drag-cancel" && isExactPlainObject(value.payload, ["pointerId"]) && Number.isSafeInteger(value.payload.pointerId) && value.payload.pointerId >= 0) {
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
    return target && typeof target.closest === "function" ? target.closest(selector) : null;
  } catch (_error) {
    return null;
  }
}
function collaborationTargetFromEvent(event) {
  if (closestElement(event?.target, ".mpv-fabric-pilot-toolbar")) return null;
  return closestElement(event?.target, "[data-mpv-collab-target]");
}
function collaborationSurfaceFromTarget(target) {
  const explicitSurface = closestElement(target, "[data-mpv-collab-surface]");
  if (explicitSurface) return explicitSurface;
  let current = target;
  while (current) {
    const name = current?.dataset?.mpvCollabTarget;
    if (name === "collab.indicator" || name === "collab.panel") return current;
    current = current.parentElement || current.collaborationOwner || null;
  }
  return null;
}
function isInsideCollaborationMirror(event) {
  if (closestElement(event?.target, ".mpv-fabric-pilot-toolbar")) return false;
  if (closestElement(event?.target, "#collaborationMirror")) return true;
  return collaborationTargetFromEvent(event) !== null;
}
function suppressCollaborationPointerEvent(event) {
  try {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
  } catch (_error) {
  }
}
function isPrimaryLeftPointer(event) {
  return event?.button === 0 && event?.isPrimary !== false && Number.isSafeInteger(event?.pointerId) && event.pointerId >= 0;
}
function installCollaborationActionRelay() {
  if (!overlayDocument?.addEventListener || typeof overlayWindow?.requestAnimationFrame !== "function") {
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
    }
  };
  const cancelActiveDrag = ({ notify = true } = {}) => {
    const drag = activeDrag;
    if (!drag) return false;
    activeDrag = null;
    clearMoveFrame();
    if (notify) {
      dispatchMpvOverlayCollaborationAction({
        action: "sync.drag-cancel",
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
      action: "sync.drag-move",
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
  overlayDocument.addEventListener("pointerover", (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    const target = collaborationTargetFromEvent(event);
    const surface = collaborationSurfaceFromTarget(target);
    if (!surface || surface.contains?.(event.relatedTarget)) return;
    const name = surface.dataset?.mpvCollabTarget;
    if (name === "collab.indicator" || name === "collab.panel") {
      dispatchMpvOverlayCollaborationAction({
        action: name === "collab.indicator" ? "collab.indicator-enter" : "collab.panel-enter",
        payload: null
      });
    }
  }, { capture: true, passive: false });
  overlayDocument.addEventListener("pointerout", (event) => {
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
    if (name === "collab.indicator" && relatedName === "collab.panel") return;
    if (name === "collab.panel" && relatedName === "collab.indicator") return;
    if (name === "collab.indicator" || name === "collab.panel") {
      dispatchMpvOverlayCollaborationAction({
        action: name === "collab.indicator" ? "collab.indicator-leave" : "collab.panel-leave",
        payload: null
      });
    }
  }, { capture: true, passive: false });
  overlayDocument.addEventListener("pointerdown", (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    const target = collaborationTargetFromEvent(event);
    if (target?.dataset?.mpvCollabTarget !== "sync.drag-handle" || !isPrimaryLeftPointer(event) || activeDrag) {
      return;
    }
    const payload = normalizeCollaborationPointerPayload({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY
    }, { requireInsideViewport: true });
    if (!payload) return;
    try {
      if (typeof target.setPointerCapture !== "function") return;
      target.setPointerCapture(event.pointerId);
    } catch (_error) {
      return;
    }
    activeDrag = { pointerId: event.pointerId, captureTarget: target };
    clearMoveFrame();
    dispatchMpvOverlayCollaborationAction({ action: "sync.drag-start", payload });
  }, { capture: true, passive: false });
  overlayDocument.addEventListener("pointermove", (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (collaborationEvent || activeDrag) {
      suppressCollaborationPointerEvent(event);
    }
    if (!activeDrag || event?.pointerId !== activeDrag.pointerId) return;
    pendingMove = { clientX: event.clientX, clientY: event.clientY };
    scheduleMove();
  }, { capture: true, passive: false });
  overlayDocument.addEventListener("pointerup", (event) => {
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
      dispatchMpvOverlayCollaborationAction({ action: "sync.drag-end", payload });
    } else {
      dispatchMpvOverlayCollaborationAction({
        action: "sync.drag-cancel",
        payload: { pointerId: drag.pointerId }
      });
    }
    releaseCapture(drag);
  }, { capture: true, passive: false });
  for (const type of ["pointercancel", "lostpointercapture"]) {
    overlayDocument.addEventListener(type, (event) => {
      const collaborationEvent = isInsideCollaborationMirror(event);
      if (collaborationEvent || activeDrag) {
        suppressCollaborationPointerEvent(event);
      }
      if (activeDrag?.pointerId === event?.pointerId) cancelActiveDrag();
    }, { capture: true, passive: false });
  }
  overlayDocument.addEventListener("click", (event) => {
    const collaborationEvent = isInsideCollaborationMirror(event);
    if (!collaborationEvent && !activeDrag) return;
    suppressCollaborationPointerEvent(event);
    if (!collaborationEvent) return;
    if (event?.button !== 0) return;
    const target = collaborationTargetFromEvent(event);
    const action = COLLABORATION_ACTIVATION_BY_TARGET[target?.dataset?.mpvCollabTarget];
    if (action) dispatchMpvOverlayCollaborationAction({ action, payload: null });
  }, { capture: true, passive: false });
  overlayWindow.addEventListener?.("blur", () => {
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
      return void 0;
    }
    const rect = overlayDocument?.documentElement?.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return void 0;
    }
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  } catch (_error) {
    return void 0;
  }
}
function installPointerPresenceRelay() {
  if (!overlayDocument?.addEventListener || typeof overlayWindow?.requestAnimationFrame !== "function") {
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
    pendingPresence = void 0;
    try {
      ipcRenderer.send(POINTER_PRESENCE_CHANNEL, nextPresence);
    } catch (_error) {
    }
  };
  const schedulePresence = (nextPresence) => {
    pendingPresence = nextPresence;
    hasPendingPresence = true;
    if (animationFramePending) return;
    animationFramePending = true;
    overlayWindow.requestAnimationFrame(flushPresence);
  };
  overlayDocument.addEventListener("pointermove", (event) => {
    const presence = readNormalizedPointerPresence(event);
    if (presence !== void 0) schedulePresence(presence);
  }, { capture: true, passive: true });
  overlayDocument.addEventListener("pointerleave", () => {
    schedulePresence(null);
  }, { capture: true, passive: true });
}
function readFence(value) {
  try {
    const hostGeneration = value?.hostGeneration;
    const videoGeneration = value?.videoGeneration;
    const persistenceSessionId = value?.persistenceSessionId;
    const stableVideoIdentity = value?.stableVideoIdentity;
    if (!Number.isSafeInteger(hostGeneration) || hostGeneration < 0 || !Number.isSafeInteger(videoGeneration) || videoGeneration < 0 || typeof persistenceSessionId !== "string" || persistenceSessionId.length === 0 || persistenceSessionId.length > 32768 || typeof stableVideoIdentity !== "string" || stableVideoIdentity.length === 0 || stableVideoIdentity.length > 32768) {
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
    type: "resync-required",
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
    return makeResyncMessage(fence, "transition-serialization-failed");
  }
  if (typeof serialized !== "string") {
    return makeResyncMessage(fence, "transition-serialization-failed");
  }
  if (encoder.encode(serialized).byteLength > MAX_TRANSITION_BYTES) {
    return makeResyncMessage(fence, "transition-too-large");
  }
  try {
    return {
      type: "transition",
      transition: JSON.parse(serialized)
    };
  } catch (_error) {
    return makeResyncMessage(fence, "transition-serialization-failed");
  }
}
var cancelActiveCollaborationDrag = installCollaborationActionRelay();
installPointerPresenceRelay();
contextBridge.exposeInMainWorld("mpvOverlayPersistence", Object.freeze({
  // 팔레트의 되돌리기·다시하기가 레이어 조작을 되돌렸을 때 짝 id 를 알린다.
  // 그 조작은 씬만 되돌릴 수 있고 레이어 목록·배정은 렌더러 쪽에 있다.
  notifyLayerHistory(event) {
    const fence = readFence(event);
    if (!fence || typeof event?.commandId !== "string" || event.commandId.length === 0 || event.commandId.length > 256 || event.direction !== "undo" && event.direction !== "redo") {
      return false;
    }
    try {
      ipcRenderer.send(PERSISTENCE_CHANNEL, {
        type: "layer-history",
        ...fence,
        commandId: event.commandId,
        direction: event.direction
      });
      return true;
    } catch (_error) {
      return false;
    }
  },
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
contextBridge.exposeInMainWorld("mpvOverlayCollaborationActions", Object.freeze({
  dispatch(action) {
    return dispatchMpvOverlayCollaborationAction(action);
  },
  cancelActiveDrag() {
    return cancelActiveCollaborationDrag();
  }
}));
contextBridge.exposeInMainWorld("mpvOverlayDrawingFrame", Object.freeze({
  requestPointerdownFrame(value) {
    const request = normalizeDrawingPointerdownFrameRequest(value);
    if (!request) return false;
    try {
      ipcRenderer.send(DRAWING_POINTERDOWN_FRAME_REQUEST_CHANNEL, request);
      return true;
    } catch (_error) {
      return false;
    }
  }
}));
