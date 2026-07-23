const { contextBridge, ipcRenderer } = require('electron');

const PERSISTENCE_CHANNEL = 'mpv-overlay:fabric-drawing-persistence';
const MAX_TRANSITION_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

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
