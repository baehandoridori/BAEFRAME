const { contextBridge, ipcRenderer } = require('electron');

const PERSISTENCE_CHANNEL = 'mpv-overlay:fabric-drawing-persistence';
const POINTER_PRESENCE_CHANNEL = 'mpv-overlay:pointer-presence';
const MAX_TRANSITION_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const overlayDocument = typeof document === 'object' ? document : null;
const overlayWindow = typeof window === 'object' ? window : null;

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
