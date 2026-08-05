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
  const received = new Map();
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
          },
          on(channel, listener) {
            const listeners = received.get(channel) || [];
            listeners.push(listener);
            received.set(channel, listeners);
          },
          removeListener(channel, listener) {
            const listeners = received.get(channel) || [];
            received.set(channel, listeners.filter(candidate => candidate !== listener));
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
  return {
    exposed,
    sent,
    emit(channel, message) {
      for (const listener of received.get(channel) || []) listener({}, message);
    }
  };
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
  const collaborationActionCalls = [];
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
        },
        forwardCollaborationAction(event, action) {
          collaborationActionCalls.push([event, action]);
          return { success: true, accepted: true, sequence: collaborationActionCalls.length };
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
    collaborationActionCalls,
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
  assert.deepEqual(
    [...harness.exposed.keys()],
    ['mpvOverlayPersistence', 'mpvOverlayCollaborationActions']
  );
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

test('overlay collaboration bridge accepts only exact allowlisted semantic actions', () => {
  const pointer = createPointerEnvironment({ left: 0, top: 0, width: 640, height: 360 });
  const harness = loadOverlayPreload({
    overlayDocument: pointer.overlayDocument,
    overlayWindow: pointer.overlayWindow
  });
  const bridge = harness.exposed.get('mpvOverlayCollaborationActions');

  assert.equal(Object.isFrozen(bridge), true);
  assert.deepEqual(Object.keys(bridge), ['dispatch', 'cancelActiveDrag']);
  assert.equal(bridge.dispatch({ action: 'sync.toggle', payload: null }), true);
  assert.equal(bridge.dispatch({
    action: 'sync.drag-start',
    payload: { pointerId: 7, clientX: 120, clientY: 80 }
  }), true);
  assert.equal(bridge.dispatch({
    action: 'sync.drag-move',
    payload: { pointerId: 7, clientX: -20, clientY: 500 }
  }), true);
  assert.equal(bridge.dispatch({
    action: 'sync.drag-end',
    payload: { pointerId: 7, clientX: 900, clientY: -30 }
  }), true);
  assert.equal(bridge.dispatch({
    action: 'sync.drag-cancel',
    payload: { pointerId: 7 }
  }), true);
  assert.deepEqual(harness.sent.slice(-5), [
    ['mpv-overlay:collaboration-action', { action: 'sync.toggle', payload: null }],
    ['mpv-overlay:collaboration-action', {
      action: 'sync.drag-start',
      payload: { pointerId: 7, clientX: 120, clientY: 80 }
    }],
    ['mpv-overlay:collaboration-action', {
      action: 'sync.drag-move',
      payload: { pointerId: 7, clientX: -20, clientY: 500 }
    }],
    ['mpv-overlay:collaboration-action', {
      action: 'sync.drag-end',
      payload: { pointerId: 7, clientX: 900, clientY: -30 }
    }],
    ['mpv-overlay:collaboration-action', {
      action: 'sync.drag-cancel',
      payload: { pointerId: 7 }
    }]
  ]);

  const malformed = [
    null,
    [],
    { action: 'sync.toggle' },
    { action: 'sync.toggle', payload: {}, extra: true },
    { action: 'not-allowed', payload: null },
    { action: 'sync.toggle', payload: {} },
    { action: 'sync.drag-start', payload: { pointerId: 7, clientX: 120 } },
    { action: 'sync.drag-move', payload: { pointerId: 7, clientX: Infinity, clientY: 10 } },
    { action: 'sync.drag-end', payload: { pointerId: 7, clientX: -32769, clientY: 10 } },
    { action: 'sync.drag-move', payload: { pointerId: 7, clientX: 10, clientY: 32769 } },
    { action: 'sync.drag-cancel', payload: { pointerId: 7, clientX: 10 } },
    Object.assign(Object.create({ inherited: true }), { action: 'sync.toggle', payload: null })
  ];
  const sentBeforeMalformed = harness.sent.length;
  for (const action of malformed) assert.equal(bridge.dispatch(action), false);
  assert.equal(harness.sent.length, sentBeforeMalformed);
});

function createCollaborationActionEnvironment() {
  const listeners = new Map();
  const windowListeners = new Map();
  const animationFrames = [];
  const rect = { left: 0, top: 0, width: 640, height: 360 };
  const overlayDocument = {
    documentElement: {
      getBoundingClientRect() {
        return { ...rect };
      }
    },
    addEventListener(type, listener, options) {
      const registrations = listeners.get(type) || [];
      registrations.push({ listener, options });
      listeners.set(type, registrations);
    }
  };
  const overlayWindow = {
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    addEventListener(type, listener, options) {
      const registrations = windowListeners.get(type) || [];
      registrations.push({ listener, options });
      windowListeners.set(type, registrations);
    }
  };

  function makeTarget(targetName, {
    toolbar = false,
    collaborationOwner = null,
    pointerCaptureError = null
  } = {}) {
    const target = {
      dataset: { mpvCollabTarget: targetName },
      collaborationOwner,
      captured: [],
      released: [],
      closest(selector) {
        if (selector === '.mpv-fabric-pilot-toolbar') return toolbar ? target : null;
        if (selector === '[data-mpv-collab-target]') {
          return collaborationOwner || (targetName ? target : null);
        }
        return null;
      },
      contains(candidate) {
        return candidate === target || candidate?.collaborationOwner === target;
      },
      setPointerCapture(pointerId) {
        if (pointerCaptureError) throw pointerCaptureError;
        target.captured.push(pointerId);
      },
      releasePointerCapture(pointerId) {
        target.released.push(pointerId);
      }
    };
    return target;
  }

  function makeEvent(type, target, overrides = {}) {
    return {
      type,
      target,
      relatedTarget: null,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 100,
      clientY: 80,
      defaultPreventedCount: 0,
      immediateStopCount: 0,
      preventDefault() {
        this.defaultPreventedCount += 1;
      },
      stopImmediatePropagation() {
        this.immediateStopCount += 1;
      },
      ...overrides
    };
  }

  function dispatch(type, event) {
    for (const registration of listeners.get(type) || []) {
      registration.listener(event);
      if (event.immediateStopCount > 0) break;
    }
  }

  return {
    animationFrames,
    listeners,
    overlayDocument,
    overlayWindow,
    windowListeners,
    makeEvent,
    makeTarget,
    dispatch,
    flushAnimationFrame() {
      const callbacks = animationFrames.splice(0);
      callbacks.forEach(callback => callback(0));
    }
  };
}

test('collaboration capture handlers suppress Fabric while preserving toolbar priority', () => {
  const env = createCollaborationActionEnvironment();
  const harness = loadOverlayPreload({
    overlayDocument: env.overlayDocument,
    overlayWindow: env.overlayWindow
  });
  const indicator = env.makeTarget('collab.indicator');
  for (const type of [
    'pointerover', 'pointerout', 'pointerdown', 'pointermove', 'pointerup',
    'pointercancel', 'lostpointercapture', 'click'
  ]) {
    const registration = env.listeners.get(type)?.[0];
    assert.equal(registration?.options?.capture, true, `${type} must be capture-phase`);
    assert.equal(registration?.options?.passive, false, `${type} must permit preventDefault`);
  }
  const enter = env.makeEvent('pointerover', indicator);
  env.dispatch('pointerover', enter);
  assert.equal(enter.defaultPreventedCount, 1);
  assert.equal(enter.immediateStopCount, 1);
  assert.deepEqual(harness.sent.at(-1), [
    'mpv-overlay:collaboration-action',
    { action: 'collab.indicator-enter', payload: null }
  ]);

  const indicatorChild = env.makeTarget(null, { collaborationOwner: indicator });
  const sentBeforeInternalTransition = harness.sent.length;
  env.dispatch('pointerover', env.makeEvent('pointerover', indicatorChild, {
    relatedTarget: indicator
  }));
  env.dispatch('pointerout', env.makeEvent('pointerout', indicatorChild, {
    relatedTarget: indicator
  }));
  assert.equal(harness.sent.length, sentBeforeInternalTransition,
    'moving among indicator children must not duplicate hover actions');

  const panel = env.makeTarget('collab.panel');
  env.dispatch('pointerout', env.makeEvent('pointerout', indicator, {
    relatedTarget: panel
  }));
  assert.equal(harness.sent.length, sentBeforeInternalTransition,
    'moving from indicator into its plexus panel must not schedule an indicator leave');
  env.dispatch('pointerover', env.makeEvent('pointerover', panel, {
    relatedTarget: indicator
  }));
  assert.deepEqual(harness.sent.at(-1)[1], {
    action: 'collab.panel-enter',
    payload: null
  });

  let fabricGestureCount = 0;
  const toggle = env.makeTarget('sync.toggle');
  const click = env.makeEvent('click', toggle);
  env.dispatch('click', click);
  if (click.immediateStopCount === 0) fabricGestureCount += 1;
  assert.equal(fabricGestureCount, 0);
  assert.deepEqual(harness.sent.at(-1), [
    'mpv-overlay:collaboration-action',
    { action: 'sync.toggle', payload: null }
  ]);

  const sentBeforePassiveControlEvents = harness.sent.length;
  const controlMove = env.makeEvent('pointermove', toggle, { pointerId: 12 });
  const controlUp = env.makeEvent('pointerup', toggle, { pointerId: 12 });
  env.dispatch('pointermove', controlMove);
  env.dispatch('pointerup', controlUp);
  assert.equal(controlMove.immediateStopCount, 1);
  assert.equal(controlUp.immediateStopCount, 1);
  assert.equal(harness.sent.length, sentBeforePassiveControlEvents,
    'non-drag pointer movement is suppressed without semantic duplicates');

  const canvas = env.makeTarget(null);
  const canvasDown = env.makeEvent('pointerdown', canvas);
  env.dispatch('pointerdown', canvasDown);
  if (canvasDown.immediateStopCount === 0) fabricGestureCount += 1;
  assert.equal(fabricGestureCount, 1,
    'an adjacent canvas gesture still reaches Fabric');

  const toolbar = env.makeTarget('sync.toggle', { toolbar: true });
  const toolbarClick = env.makeEvent('click', toolbar);
  const sentBeforeToolbar = harness.sent.length;
  env.dispatch('click', toolbarClick);
  assert.equal(toolbarClick.defaultPreventedCount, 0);
  assert.equal(toolbarClick.immediateStopCount, 0);
  assert.equal(harness.sent.length, sentBeforeToolbar);

  const secondary = env.makeEvent('click', toggle, { button: 2 });
  env.dispatch('click', secondary);
  assert.equal(secondary.defaultPreventedCount, 1);
  assert.equal(secondary.immediateStopCount, 1);
  assert.equal(harness.sent.length, sentBeforeToolbar);
});

test('collaboration drag captures one pointer, coalesces moves, flushes end, and cancels safely', () => {
  const env = createCollaborationActionEnvironment();
  const harness = loadOverlayPreload({
    overlayDocument: env.overlayDocument,
    overlayWindow: env.overlayWindow
  });
  const header = env.makeTarget('sync.drag-handle');
  env.dispatch('pointerdown', env.makeEvent('pointerdown', header, {
    pointerId: 4,
    clientX: 80,
    clientY: 40
  }));
  assert.deepEqual(header.captured, [4]);
  assert.deepEqual(harness.sent.at(-1), [
    'mpv-overlay:collaboration-action',
    { action: 'sync.drag-start', payload: { pointerId: 4, clientX: 80, clientY: 40 } }
  ]);

  const sentBeforeSecondPointer = harness.sent.length;
  const secondPointer = env.makeEvent('pointerdown', header, { pointerId: 99 });
  env.dispatch('pointerdown', secondPointer);
  assert.equal(secondPointer.immediateStopCount, 1);
  assert.equal(harness.sent.length, sentBeforeSecondPointer);
  assert.deepEqual(header.captured, [4]);

  const canvas = env.makeTarget(null);
  const outsideSecondPointer = env.makeEvent('pointerdown', canvas, { pointerId: 100 });
  env.dispatch('pointerdown', outsideSecondPointer);
  assert.equal(outsideSecondPointer.immediateStopCount, 1,
    'a second pointer outside the mirror cannot leak into Fabric during a panel drag');
  assert.equal(harness.sent.length, sentBeforeSecondPointer);

  env.dispatch('pointermove', env.makeEvent('pointermove', header, {
    pointerId: 4,
    clientX: 100,
    clientY: 60
  }));
  env.dispatch('pointermove', env.makeEvent('pointermove', header, {
    pointerId: 4,
    clientX: 140,
    clientY: 90
  }));
  assert.equal(env.animationFrames.length, 1);
  const sentBeforeFrame = harness.sent.length;
  env.flushAnimationFrame();
  assert.equal(harness.sent.length, sentBeforeFrame + 1);
  assert.deepEqual(harness.sent.at(-1)[1], {
    action: 'sync.drag-move',
    payload: { pointerId: 4, clientX: 140, clientY: 90 }
  });

  env.dispatch('pointermove', env.makeEvent('pointermove', header, {
    pointerId: 4,
    clientX: -20,
    clientY: 500
  }));
  env.dispatch('pointerup', env.makeEvent('pointerup', header, {
    pointerId: 4,
    clientX: 900,
    clientY: -30
  }));
  assert.deepEqual(harness.sent.slice(-2).map(([, message]) => message), [
    { action: 'sync.drag-move', payload: { pointerId: 4, clientX: 900, clientY: -30 } },
    { action: 'sync.drag-end', payload: { pointerId: 4, clientX: 900, clientY: -30 } }
  ]);
  assert.deepEqual(header.released, [4]);
  const sentBeforeStaleFrame = harness.sent.length;
  env.flushAnimationFrame();
  assert.equal(harness.sent.length, sentBeforeStaleFrame);

  env.dispatch('lostpointercapture', env.makeEvent('lostpointercapture', header, {
    pointerId: 4
  }));
  assert.equal(harness.sent.length, sentBeforeStaleFrame,
    'lost capture after a normal end must not emit a second cancel');

  env.dispatch('pointerdown', env.makeEvent('pointerdown', header, { pointerId: 5 }));
  env.dispatch('pointercancel', env.makeEvent('pointercancel', header, { pointerId: 5 }));
  assert.deepEqual(harness.sent.at(-1)[1], {
    action: 'sync.drag-cancel',
    payload: { pointerId: 5 }
  });

  const captureFailure = env.makeTarget('sync.drag-handle', {
    pointerCaptureError: new Error('capture unavailable')
  });
  const sentBeforeCaptureFailure = harness.sent.length;
  env.dispatch('pointerdown', env.makeEvent('pointerdown', captureFailure, { pointerId: 6 }));
  assert.equal(harness.sent.length, sentBeforeCaptureFailure,
    'a failed pointer capture cannot emit a half-started drag');
});

test('collaboration drag cancels once on lost capture or blur and invalidates pending frames', () => {
  const env = createCollaborationActionEnvironment();
  const harness = loadOverlayPreload({
    overlayDocument: env.overlayDocument,
    overlayWindow: env.overlayWindow
  });
  const header = env.makeTarget('sync.drag-handle');

  env.dispatch('pointerdown', env.makeEvent('pointerdown', header, { pointerId: 8 }));
  env.dispatch('pointermove', env.makeEvent('pointermove', header, {
    pointerId: 8,
    clientX: 220,
    clientY: 120
  }));
  env.dispatch('lostpointercapture', env.makeEvent('lostpointercapture', header, { pointerId: 8 }));
  assert.deepEqual(harness.sent.at(-1)[1], {
    action: 'sync.drag-cancel',
    payload: { pointerId: 8 }
  });
  const sentAfterLostCapture = harness.sent.length;
  env.flushAnimationFrame();
  assert.equal(harness.sent.length, sentAfterLostCapture);

  env.dispatch('pointerdown', env.makeEvent('pointerdown', header, { pointerId: 9 }));
  env.dispatch('pointermove', env.makeEvent('pointermove', header, {
    pointerId: 9,
    clientX: 240,
    clientY: 140
  }));
  const blur = env.makeEvent('blur', null);
  for (const registration of env.windowListeners.get('blur') || []) {
    registration.listener(blur);
  }
  assert.deepEqual(harness.sent.at(-1)[1], {
    action: 'sync.drag-cancel',
    payload: { pointerId: 9 }
  });
  const sentAfterBlur = harness.sent.length;
  for (const registration of env.windowListeners.get('blur') || []) {
    registration.listener(blur);
  }
  env.flushAnimationFrame();
  assert.equal(harness.sent.length, sentAfterBlur,
    'repeated blur and stale rAF callbacks cannot duplicate cancellation');
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

test('main IPC delegates raw collaboration actions to the overlay host sender fence', () => {
  const harness = loadPointerPresenceIpcHandlers();
  const relay = harness.eventHandlers.get('mpv-overlay:collaboration-action');
  assert.equal(typeof relay, 'function');
  const event = { sender: harness.allowedOverlaySender };
  const action = { action: 'sync.toggle', payload: null };

  relay(event, action);
  assert.deepEqual(harness.collaborationActionCalls, [[event, action]]);
});
