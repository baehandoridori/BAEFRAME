const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const {
  normalizeMpvCollaborationState
} = require('../../main/mpv-overlay-host');

const rootDir = path.resolve(__dirname, '../..');
const preloadPath = path.join(rootDir, 'preload/mpv-overlay-preload.js');
const ipcHandlersPath = path.join(rootDir, 'main/ipc-handlers.js');
const MAX_TRANSITION_BYTES = 8 * 1024 * 1024;

function makeTransition(overrides = {}) {
  return {
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'overlay-persistence-session',
    stableVideoIdentity: 'C:/shots/overlay.mov',
    scene: {
      sceneInstanceId: 'overlay-scene-1',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: 1,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: 64,
    unsupportedReason: null,
    removals: [],
    insertions: [],
    transforms: [],
    ...overrides
  };
}

function loadOverlayPreload({
  sendError = null,
  overlayDocument = undefined,
  overlayWindow = undefined
} = {}) {
  assert.equal(fs.existsSync(preloadPath), true, 'overlay persistence preload must exist');
  const sent = [];
  const exposed = new Map();
  const originalLoad = Module._load;
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  if (overlayDocument !== undefined) {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      writable: true,
      value: overlayDocument
    });
  }
  if (overlayWindow !== undefined) {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: overlayWindow
    });
  }
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            exposed.set(name, value);
          }
        },
        ipcRenderer: {
          send(channel, message) {
            if (sendError) throw sendError;
            sent.push([channel, message]);
          }
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(preloadPath)];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(preloadPath)];
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
    } else {
      delete globalThis.document;
    }
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
  }
  return { exposed, sent };
}

function createPointerEnvironment(rect = { left: 20, top: 10, width: 200, height: 100 }) {
  const listeners = new Map();
  const animationFrames = [];
  const overlayDocument = {
    documentElement: {
      getBoundingClientRect() {
        return { ...rect };
      }
    },
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    }
  };
  const overlayWindow = {
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    }
  };
  return {
    animationFrames,
    listeners,
    overlayDocument,
    overlayWindow,
    flushAnimationFrame() {
      const callbacks = animationFrames.splice(0);
      callbacks.forEach(callback => callback(0));
    }
  };
}

function loadPointerPresenceIpcHandlers() {
  const eventHandlers = new Map();
  const invokeHandlers = new Map();
  const sent = [];
  const remoteCursorCalls = [];
  const collaborationCalls = [];
  const allowedOverlaySender = {};
  const mainWebContents = {
    isDestroyed: () => false,
    send(channel, payload) {
      sent.push([channel, payload]);
    }
  };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: mainWebContents
  };
  const noop = () => {};
  const ipcMain = {
    handle(channel, handler) {
      invokeHandlers.set(channel, handler);
    },
    on(channel, handler) {
      eventHandlers.set(channel, handler);
    }
  };
  const fakeModules = new Map([
    ['electron', {
      ipcMain,
      dialog: {},
      app: {},
      clipboard: {},
      shell: {}
    }],
    ['./logger', {
      createLogger: () => ({
        debug: noop,
        error: noop,
        info: noop,
        trace: () => ({ end: noop, error: noop }),
        warn: noop
      })
    }],
    ['./window', {
      closeWindow: noop,
      getMainWindow: () => mainWindow,
      isFullscreen: () => false,
      isMaximized: () => false,
      minimizeWindow: noop,
      toggleFullscreen: noop,
      toggleMaximize: noop
    }],
    ['./recent-files-store', { RecentFilesStore: class RecentFilesStore {} }],
    ['./recent-thumb-capture', {}],
    ['./cutlist-paths', { validateCutlistFilePath: value => value }],
    ['./mpv-manager', { MPVManager: class MPVManager {}, mpvManager: {} }],
    ['./mpv-embed-host', { mpvEmbedHost: {} }],
    ['./mpv-overlay-host', {
      mpvOverlayHost: {
        isCurrentOverlaySender(event) {
          return event?.sender === allowedOverlaySender;
        },
        async updateRemoteCursorState(state) {
          remoteCursorCalls.push(state);
          return { success: true, accepted: true };
        },
        async updateCollaborationState(state) {
          collaborationCalls.push(state);
          return { success: true, accepted: true };
        }
      },
      normalizeMpvCollaborationState,
      normalizeFabricDrawingPersistenceMessage: () => null
    }],
    ['./review-file-store', {
      readReviewSnapshot: noop,
      saveReviewFile: noop
    }],
    ['electron-store', class Store {}]
  ]);
  const originalLoad = Module._load;

  delete require.cache[ipcHandlersPath];
  Module._load = function loadWithFakes(request, parent, isMain) {
    if (parent?.filename === ipcHandlersPath && fakeModules.has(request)) {
      return fakeModules.get(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { setupIpcHandlers } = require(ipcHandlersPath);
    setupIpcHandlers();
  } finally {
    Module._load = originalLoad;
    delete require.cache[ipcHandlersPath];
  }
  return {
    allowedOverlaySender,
    collaborationCalls,
    eventHandlers,
    invokeHandlers,
    mainWebContents,
    mainWindow,
    remoteCursorCalls,
    sent
  };
}

test('overlay preload exposes one narrow committed-transition bridge and sends plain JSON', () => {
  const harness = loadOverlayPreload();
  assert.deepEqual([...harness.exposed.keys()], ['mpvOverlayPersistence']);
  const bridge = harness.exposed.get('mpvOverlayPersistence');
  assert.deepEqual(Object.keys(bridge), ['notifyCommittedTransition']);

  const transition = makeTransition();
  assert.equal(bridge.notifyCommittedTransition(transition), true);
  assert.deepEqual(harness.sent, [[
    'mpv-overlay:fabric-drawing-persistence',
    { type: 'transition', transition }
  ]]);
  assert.notEqual(harness.sent[0][1].transition, transition);
});

test('overlay preload compacts oversized and unserializable transitions into exact resync envelopes', () => {
  const harness = loadOverlayPreload();
  const bridge = harness.exposed.get('mpvOverlayPersistence');
  const oversized = makeTransition({
    insertions: [{ payload: 'x'.repeat(MAX_TRANSITION_BYTES) }]
  });
  assert.equal(bridge.notifyCommittedTransition(oversized), true);

  const cyclic = makeTransition({ mutationSequence: 2 });
  cyclic.self = cyclic;
  assert.equal(bridge.notifyCommittedTransition(cyclic), true);

  assert.deepEqual(harness.sent, [
    [
      'mpv-overlay:fabric-drawing-persistence',
      {
        type: 'resync-required',
        hostGeneration: 3,
        videoGeneration: 7,
        persistenceSessionId: 'overlay-persistence-session',
        stableVideoIdentity: 'C:/shots/overlay.mov',
        reason: 'transition-too-large'
      }
    ],
    [
      'mpv-overlay:fabric-drawing-persistence',
      {
        type: 'resync-required',
        hostGeneration: 3,
        videoGeneration: 7,
        persistenceSessionId: 'overlay-persistence-session',
        stableVideoIdentity: 'C:/shots/overlay.mov',
        reason: 'transition-serialization-failed'
      }
    ]
  ]);
});

test('overlay preload drops invalid fences and isolates send failures from committed drawing state', () => {
  const harness = loadOverlayPreload();
  const bridge = harness.exposed.get('mpvOverlayPersistence');
  assert.equal(bridge.notifyCommittedTransition(makeTransition({ hostGeneration: -1 })), false);
  assert.equal(harness.sent.length, 0);

  const failing = loadOverlayPreload({ sendError: new Error('injected send failure') });
  assert.doesNotThrow(() => {
    assert.equal(
      failing.exposed.get('mpvOverlayPersistence').notifyCommittedTransition(makeTransition()),
      false
    );
  });
});

test('overlay preload relays the latest pointer once per animation frame in normalized overlay coordinates', () => {
  const pointer = createPointerEnvironment();
  const harness = loadOverlayPreload({
    overlayDocument: pointer.overlayDocument,
    overlayWindow: pointer.overlayWindow
  });
  const moveRegistration = pointer.listeners.get('pointermove');
  const leaveRegistration = pointer.listeners.get('pointerleave');

  assert.equal(typeof moveRegistration?.listener, 'function');
  assert.equal(moveRegistration?.options?.capture, true);
  assert.equal(moveRegistration?.options?.passive, true);
  assert.equal(typeof leaveRegistration?.listener, 'function');

  moveRegistration.listener({ clientX: 30, clientY: 20 });
  moveRegistration.listener({ clientX: 120, clientY: 60 });
  moveRegistration.listener({ clientX: 180, clientY: 90 });
  assert.equal(pointer.animationFrames.length, 1);
  assert.deepEqual(harness.sent, []);

  pointer.flushAnimationFrame();
  assert.deepEqual(harness.sent, [[
    'mpv-overlay:pointer-presence',
    { x: 0.8, y: 0.8 }
  ]]);

  leaveRegistration.listener({});
  pointer.flushAnimationFrame();
  assert.deepEqual(harness.sent[1], ['mpv-overlay:pointer-presence', null]);
});

test('overlay pointer relay clamps captured coordinates and drops unusable bounds or values', () => {
  const pointer = createPointerEnvironment();
  const harness = loadOverlayPreload({
    overlayDocument: pointer.overlayDocument,
    overlayWindow: pointer.overlayWindow
  });
  const move = pointer.listeners.get('pointermove')?.listener;

  move({ clientX: -50, clientY: 500 });
  pointer.flushAnimationFrame();
  assert.deepEqual(harness.sent, [[
    'mpv-overlay:pointer-presence',
    { x: 0, y: 1 }
  ]]);

  move({ clientX: Number.POSITIVE_INFINITY, clientY: 50 });
  pointer.flushAnimationFrame();
  assert.equal(harness.sent.length, 1);

  pointer.overlayDocument.documentElement.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 0,
    height: 100
  });
  move({ clientX: 20, clientY: 50 });
  pointer.flushAnimationFrame();
  assert.equal(harness.sent.length, 1);
});

test('main IPC forwards only strict pointer presence from the current native overlay sender', () => {
  const harness = loadPointerPresenceIpcHandlers();
  const relay = harness.eventHandlers.get('mpv-overlay:pointer-presence');
  assert.equal(typeof relay, 'function');

  const payload = { x: 0.125, y: 0.875 };
  relay({ sender: harness.allowedOverlaySender }, payload);
  relay({ sender: harness.allowedOverlaySender }, null);
  assert.deepEqual(harness.sent, [
    ['mpv-overlay:pointer-presence', { x: 0.125, y: 0.875 }],
    ['mpv-overlay:pointer-presence', null]
  ]);
  assert.notEqual(harness.sent[0][1], payload);

  for (const malformed of [
    undefined,
    [],
    {},
    { x: 0.5 },
    { x: 0.5, y: 0.5, z: 0.5 },
    { x: -1, y: 0.5 },
    { x: 0.5, y: 2 },
    { x: Number.POSITIVE_INFINITY, y: 0.5 },
    { x: 0.5, y: '0.5' }
  ]) {
    relay({ sender: harness.allowedOverlaySender }, malformed);
  }
  relay({ sender: {} }, { x: 0.5, y: 0.5 });
  assert.equal(harness.sent.length, 2);
});

test('main IPC accepts bounded remote cursor state only from the current main renderer', async () => {
  const harness = loadPointerPresenceIpcHandlers();
  const updateRemoteCursors = harness.invokeHandlers.get('mpv:update-overlay-remote-cursors');
  assert.equal(typeof updateRemoteCursors, 'function');

  assert.deepEqual(
    await updateRemoteCursors({ sender: {} }, { revision: Number.MAX_SAFE_INTEGER, html: '' }),
    { success: false, error: 'mpv remote cursor IPC sender is not allowed' }
  );
  assert.equal(harness.remoteCursorCalls.length, 0);

  for (const malformed of [
    null,
    { revision: 1 },
    { revision: -1, html: '' },
    { revision: 1.5, html: '' },
    { revision: 1, html: '', extra: true },
    { revision: 1, html: 'x'.repeat(256 * 1024 + 1) }
  ]) {
    const result = await updateRemoteCursors({ sender: harness.mainWebContents }, malformed);
    assert.equal(result.success, false);
    assert.equal(result.error, 'invalid mpv remote cursor state');
  }
  assert.equal(harness.remoteCursorCalls.length, 0);

  const state = { revision: 7, html: '<div class="remote-cursor"></div>' };
  assert.deepEqual(
    await updateRemoteCursors({ sender: harness.mainWebContents }, state),
    { success: true, accepted: true }
  );
  assert.deepEqual(harness.remoteCursorCalls, [state]);
  assert.notEqual(harness.remoteCursorCalls[0], state);
});

test('main IPC accepts exact collaboration state only from the current main renderer', async () => {
  const harness = loadPointerPresenceIpcHandlers();
  const updateCollaboration = harness.invokeHandlers.get('mpv:update-overlay-collaboration');
  assert.equal(typeof updateCollaboration, 'function');
  const state = {
    revision: 9,
    theme: 'dark',
    indicator: {
      visible: true,
      bounds: { left: 1, top: 2, width: 180, height: 36 },
      badge: 'synced',
      users: [{ name: 'Hansol', color: '#FFD000', isMe: true, syncActive: true }]
    },
    plexus: {
      visible: false,
      bounds: { left: 1, top: 46, width: 280, height: 0 },
      showRemoteCursors: true,
      snapshotDataUrl: ''
    },
    playback: {
      visible: true,
      bounds: { left: 400, top: 300, width: 220, height: 160 },
      collapsed: false,
      syncEnabled: true,
      leaderMode: 'lead'
    }
  };

  assert.deepEqual(await updateCollaboration({ sender: {} }, state), {
    success: false,
    error: 'mpv collaboration IPC sender is not allowed'
  });
  assert.equal(harness.collaborationCalls.length, 0);
  const invalid = structuredClone(state);
  invalid.injected = true;
  assert.deepEqual(await updateCollaboration({ sender: harness.mainWebContents }, invalid), {
    success: false,
    error: 'invalid mpv collaboration state'
  });
  assert.equal(harness.collaborationCalls.length, 0);

  assert.deepEqual(await updateCollaboration({ sender: harness.mainWebContents }, state), {
    success: true,
    accepted: true
  });
  assert.equal(harness.collaborationCalls.length, 1);
  assert.equal(harness.collaborationCalls[0].indicator.users[0].color, '#ffd000');
  assert.notEqual(harness.collaborationCalls[0], state);
});
