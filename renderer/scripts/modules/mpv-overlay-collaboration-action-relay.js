const NON_DRAG_ACTIONS = new Set([
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
const DRAG_ACTIONS = new Set([
  'sync.drag-start',
  'sync.drag-move',
  'sync.drag-end'
]);

function isExactPlainObject(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length &&
      ownKeys.every(key => typeof key === 'string' && keys.includes(key));
  } catch (_error) {
    return false;
  }
}

function normalizePayload(action, payload) {
  if (DRAG_ACTIONS.has(action)) {
    if (!isExactPlainObject(payload, ['pointerId', 'clientX', 'clientY']) ||
        !Number.isSafeInteger(payload.pointerId) || payload.pointerId < 0 ||
        !Number.isFinite(payload.clientX) || Math.abs(payload.clientX) > 32768 ||
        !Number.isFinite(payload.clientY) || Math.abs(payload.clientY) > 32768) {
      return undefined;
    }
    return {
      pointerId: payload.pointerId,
      clientX: payload.clientX,
      clientY: payload.clientY
    };
  }
  if (action === 'sync.drag-cancel') {
    if (!isExactPlainObject(payload, ['pointerId']) ||
        !Number.isSafeInteger(payload.pointerId) || payload.pointerId < 0) {
      return undefined;
    }
    return { pointerId: payload.pointerId };
  }
  return NON_DRAG_ACTIONS.has(action) && payload === null ? null : undefined;
}

function normalizeMessage(value) {
  const keys = [
    'action',
    'payload',
    'hostGeneration',
    'videoGeneration',
    'inputRevision',
    'activeSessionId',
    'sequence'
  ];
  if (!isExactPlainObject(value, keys) ||
      typeof value.action !== 'string' ||
      !Number.isSafeInteger(value.hostGeneration) || value.hostGeneration < 0 ||
      !Number.isSafeInteger(value.videoGeneration) || value.videoGeneration < 0 ||
      !Number.isSafeInteger(value.inputRevision) || value.inputRevision < 0 ||
      typeof value.activeSessionId !== 'string' ||
      value.activeSessionId.length === 0 || value.activeSessionId.length > 32768 ||
      !Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
    return null;
  }
  const payload = normalizePayload(value.action, value.payload);
  if (payload === undefined) return null;
  return { ...value, payload };
}

function currentFence(snapshot) {
  if (!snapshot || snapshot.state !== 'active' || snapshot.enabled !== true ||
      snapshot.desiredInputEnabled !== true ||
      !Number.isSafeInteger(snapshot.hostGeneration) || snapshot.hostGeneration < 0 ||
      !Number.isSafeInteger(snapshot.videoGeneration) || snapshot.videoGeneration < 0 ||
      !Number.isSafeInteger(snapshot.inputRevision) || snapshot.inputRevision < 0 ||
      typeof snapshot.sessionId !== 'string' || snapshot.sessionId.length === 0) {
    return null;
  }
  return {
    hostGeneration: snapshot.hostGeneration,
    videoGeneration: snapshot.videoGeneration,
    inputRevision: snapshot.inputRevision,
    activeSessionId: snapshot.sessionId
  };
}

function fenceMatches(message, fence) {
  return message.hostGeneration === fence.hostGeneration &&
    message.videoGeneration === fence.videoGeneration &&
    message.inputRevision === fence.inputRevision &&
    message.activeSessionId === fence.activeSessionId;
}

function fenceKey(fence) {
  return `${fence.hostGeneration}:${fence.videoGeneration}:${fence.inputRevision}:${fence.activeSessionId}`;
}

function readVideoWrapperRect(getVideoWrapperRect) {
  try {
    const rect = getVideoWrapperRect();
    if (!rect ||
        !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
        !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
        rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return rect;
  } catch (_error) {
    return null;
  }
}

function mappedInvocation(message, actions, getVideoWrapperRect) {
  switch (message.action) {
  case 'collab.indicator-enter':
    return [actions.handleCollaborationIndicatorEnter, []];
  case 'collab.indicator-leave':
    return [actions.handleCollaborationIndicatorLeave, [null]];
  case 'collab.panel-enter':
    return [actions.handleCollaborationPanelEnter, []];
  case 'collab.panel-leave':
    return [actions.handleCollaborationPanelLeave, []];
  case 'collab.sync-status':
    return [actions.showCollaborationSyncStatus, []];
  case 'collab.cursor-toggle':
    return [actions.toggleRemoteCollaboratorCursors, []];
  case 'collab.open-sync':
    return [actions.setPlaybackSyncPanelVisible, [true]];
  case 'sync.toggle':
    return [actions.togglePlaybackSyncEnabled, []];
  case 'sync.lead':
    return [actions.setPlaybackSyncLeaderMode, ['lead']];
  case 'sync.follow':
    return [actions.setPlaybackSyncLeaderMode, ['follow']];
  case 'sync.collapse':
    return [actions.togglePlaybackSyncPanelCollapsed, []];
  case 'sync.close':
    return [actions.setPlaybackSyncPanelVisible, [false]];
  case 'sync.drag-cancel':
    return [actions.cancelPlaybackSyncPanelDrag, [{ ...message.payload }]];
  default: {
    if (!DRAG_ACTIONS.has(message.action)) return null;
    const rect = readVideoWrapperRect(getVideoWrapperRect);
    if (!rect) return null;
    const payload = {
      pointerId: message.payload.pointerId,
      clientX: rect.left + message.payload.clientX,
      clientY: rect.top + message.payload.clientY
    };
    if (message.action === 'sync.drag-start') {
      return [actions.startPlaybackSyncPanelDrag, [payload]];
    }
    if (message.action === 'sync.drag-move') {
      return [actions.movePlaybackSyncPanelDrag, [payload]];
    }
    return [actions.endPlaybackSyncPanelDrag, [payload]];
  }
  }
}

export function createMpvOverlayCollaborationActionRelay(options = {}) {
  const getStatusSnapshot = typeof options.getStatusSnapshot === 'function'
    ? options.getStatusSnapshot
    : () => null;
  const getVideoWrapperRect = typeof options.getVideoWrapperRect === 'function'
    ? options.getVideoWrapperRect
    : () => null;
  const actions = options.actions && typeof options.actions === 'object'
    ? options.actions
    : {};
  let appliedFenceKey = null;
  let lastSequence = 0;

  return Object.freeze({
    apply(value) {
      const message = normalizeMessage(value);
      if (!message) return false;
      let snapshot;
      try {
        snapshot = getStatusSnapshot();
      } catch (_error) {
        return false;
      }
      const fence = currentFence(snapshot);
      if (!fence || !fenceMatches(message, fence)) return false;
      const nextFenceKey = fenceKey(fence);
      const fenceChanged = appliedFenceKey !== nextFenceKey;
      const sequenceFloor = fenceChanged ? 0 : lastSequence;
      if (message.sequence <= sequenceFloor) return false;
      const invocation = mappedInvocation(message, actions, getVideoWrapperRect);
      if (!invocation || typeof invocation[0] !== 'function') return false;

      if (fenceChanged) {
        try {
          actions.resetPlaybackSyncPanelDrag?.();
        } catch (_error) {
          // A new valid fence still owns the next semantic action.
        }
        appliedFenceKey = nextFenceKey;
        lastSequence = 0;
      }
      lastSequence = message.sequence;
      try {
        invocation[0](...invocation[1]);
        return true;
      } catch (_error) {
        return false;
      }
    }
  });
}
