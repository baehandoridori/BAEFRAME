const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const {
  MPVOverlayHost,
  normalizeOverlayState,
  normalizeMpvOverlayCollaborationAction,
  normalizeFabricDrawingPersistenceMessage
} = require('../../main/mpv-overlay-host');

function waitForAsyncReposition() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDrawingHostHarness(options = {}) {
  const events = [];
  const windows = [];
  const bundleSource = options.bundleSource || '/* fixed Fabric bundle */';
  const fakeMainWindow = {
    focused: false,
    isDestroyed: () => false,
    isFocused: () => fakeMainWindow.focused,
    getContentBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    focus: () => {
      fakeMainWindow.focused = true;
      events.push(['mainWindow.focus']);
    },
    webContents: {
      focus: () => events.push(['mainWindow.webContents.focus']),
      send: (channel, payload) => {
        events.push(['mainWindow.send', channel, payload]);
        if (options.sendError) throw options.sendError;
      },
      sendInputEvent: input => {
        events.push(['mainWindow.sendInputEvent', input]);
        if (options.sendInputEventError) throw options.sendInputEventError;
      }
    }
  };

  class FakeBrowserWindow {
    constructor(windowOptions) {
      this.options = windowOptions;
      this.destroyed = false;
      this.focused = false;
      this.listeners = new Map();
      this.webContentsListeners = new Map();
      this.webContents = {
        destroyed: false,
        isDestroyed() {
          return this.destroyed;
        },
        on: (eventName, handler) => {
          this.webContentsListeners.set(eventName, handler);
        },
        emit: (eventName, ...args) => {
          this.webContentsListeners.get(eventName)?.(...args);
        },
        executeJavaScript: async (script) => {
          events.push(['executeJavaScript', script]);
          if (typeof options.executeJavaScriptError === 'function') {
            const injectedError = options.executeJavaScriptError(script);
            if (injectedError) throw injectedError;
          }
          const bootstrapValue = readDrawingV3BootstrapValue(script);
          if (bootstrapValue !== undefined) {
            if (options.bootstrapWindow) {
              return vm.runInNewContext(script, { window: options.bootstrapWindow });
            }
            return true;
          }
          if (script.includes("typeof window.__applyMpvOverlayState === 'function'")) return true;
          if (script === bundleSource) return true;
          if (script.includes('.prepare(')) return { prepared: true, reused: false };
          if (typeof options.executeDrawing === 'function') {
            const result = options.executeDrawing(script);
            if (result !== undefined) return result;
          }
          if (script.includes('.setDrawingInput(')) {
            return { accepted: true, enabled: script.includes('"enabled":true'), restored: false };
          }
          if (script.includes('.updateDrawingTool(')) return { accepted: true, tool: 'select' };
          if (script.includes('.applyDrawingAction(')) {
            return {
              applied: true,
              deletedCount: 1,
              deletedIds: ['must-not-leak'],
              scene: { objects: [{ type: 'fabric.Path' }] },
              command: { undoState: { mustNotLeak: true } }
            };
          }
          if (script.includes('.getDiagnostics(')) {
            return {
              state: 'active',
              prepared: true,
              inputEnabled: true,
              activeSessionId: 'session-1',
              targetFrame: 24,
              tool: 'select',
              selectionTarget: 'partial',
              selectionShape: 'lasso',
              selectionControlEventCount: 4,
              lastSelectionControlAction: {
                kind: 'shape',
                value: 'lasso',
                source: 'pointerdown',
                eventCount: 4,
                scene: { mustNotLeak: true }
              },
              activeSelectionGesture: null,
              lastSelectionGesture: {
                target: 'partial',
                shape: 'lasso',
                pointerPointCount: 7,
                polygonPointCount: 5,
                polygonBounds: { left: 10, right: 110, top: 20, bottom: 120 },
                pending: true,
                applied: false,
                selectedCount: 2,
                reason: null,
                scene: { mustNotLeak: true }
              },
              objectCount: 1,
              selectionCount: 1,
              mutationCount: 2,
              undoDepth: 2,
              redoDepth: 1,
              historyBytes: 1024,
              undoBytes: 768,
              dirty: true,
              cache: { videoCount: 1, sceneCount: 1, estimatedBytes: 512, evictionCount: 0 },
              metrics: { staleMessageDropCount: 0, saveAttemptCount: 0 },
              scene: { objects: [{ type: 'fabric.Path' }] },
              fabricJSON: { version: '7.4.0' }
            };
          }
          return undefined;
        },
        invalidate: () => events.push(['webContents.invalidate'])
      };
      events.push(['construct', windowOptions]);
      windows.push(this);
    }
    loadURL(url) {
      events.push(['loadURL', url]);
      return Promise.resolve();
    }
    setBounds(bounds) {
      events.push(['setBounds', bounds]);
    }
    setIgnoreMouseEvents(ignore, mouseOptions) {
      events.push(['setIgnoreMouseEvents', ignore, mouseOptions]);
    }
    setFocusable(focusable) {
      events.push(['setFocusable', focusable]);
      if (!focusable) {
        this.focused = false;
        if (options.simulateFocusableDisableDeactivation === true) {
          fakeMainWindow.focused = false;
        }
      }
    }
    focus() {
      this.focused = true;
      events.push(['overlay.focus']);
    }
    showInactive() {
      events.push(['showInactive']);
    }
    moveTop() {
      events.push(['moveTop']);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isFocused() {
      return this.focused;
    }
    on(eventName, handler) {
      this.listeners.set(eventName, handler);
    }
    destroy() {
      this.destroyed = true;
      events.push(['destroy']);
    }
  }

  let readCount = 0;
  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    fabricBundlePath: 'fixed/app/renderer/scripts/lib/mpv-fabric-overlay.iife.js',
    now: options.now,
    fabricRetryBaseMs: options.fabricRetryBaseMs,
    fabricRetryMaxMs: options.fabricRetryMaxMs,
    fabricDrawingSnapshotMaxBytes: options.fabricDrawingSnapshotMaxBytes,
    readFile: async (filePath, encoding) => {
      readCount += 1;
      events.push(['readFile', filePath, encoding]);
      if (options.readFile) return options.readFile(filePath, encoding);
      return bundleSource;
    }
  });

  return {
    host,
    events,
    windows,
    mainWindow: fakeMainWindow,
    getReadCount: () => readCount
  };
}

function makeDrawingInput(hostGeneration, overrides = {}) {
  return {
    hostGeneration,
    videoGeneration: 1,
    inputRevision: 1,
    enabled: false,
    ...overrides
  };
}

function makeCollaborationAction(action = 'sync.toggle', payload = null) {
  return { action, payload };
}

test('normalizes only exact collaboration semantic action packets', () => {
  assert.deepEqual(
    normalizeMpvOverlayCollaborationAction(makeCollaborationAction()),
    makeCollaborationAction()
  );
  assert.deepEqual(normalizeMpvOverlayCollaborationAction(makeCollaborationAction(
    'sync.drag-move',
    { pointerId: 3, clientX: -120.5, clientY: 800.25 }
  )), {
    action: 'sync.drag-move',
    payload: { pointerId: 3, clientX: -120.5, clientY: 800.25 }
  });
  assert.deepEqual(normalizeMpvOverlayCollaborationAction(makeCollaborationAction(
    'sync.drag-cancel',
    { pointerId: 3 }
  )), {
    action: 'sync.drag-cancel',
    payload: { pointerId: 3 }
  });

  for (const malformed of [
    null,
    [],
    { action: 'sync.toggle' },
    { action: 'sync.toggle', payload: null, fence: 1 },
    { action: 'arbitrary', payload: null },
    { action: 'sync.toggle', payload: {} },
    { action: 'sync.drag-start', payload: { pointerId: 1, clientX: 2 } },
    { action: 'sync.drag-end', payload: { pointerId: 1, clientX: -32769, clientY: 2 } },
    { action: 'sync.drag-move', payload: { pointerId: 1, clientX: 2, clientY: 32769 } },
    { action: 'sync.drag-cancel', payload: { pointerId: 1, extra: true } },
    Object.assign(Object.create({ inherited: true }), makeCollaborationAction())
  ]) {
    assert.equal(normalizeMpvOverlayCollaborationAction(malformed), null);
  }
});

test('forwards collaboration actions only from the current active Fabric session with host fences', async () => {
  const { host, events, windows } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 9,
    inputRevision: 1
  }));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 9,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'collaboration-input-session',
      stableVideoIdentity: 'video-collaboration-actions',
      targetFrame: 10,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;

  const currentSender = { sender: windows[0].webContents };
  assert.deepEqual(
    host.forwardCollaborationAction({ sender: {} }, makeCollaborationAction()),
    { success: false, accepted: false, error: 'mpv collaboration action sender is not allowed' }
  );
  assert.deepEqual(
    host.forwardCollaborationAction(currentSender, {
      action: 'sync.toggle',
      payload: null,
      hostGeneration: -1
    }),
    { success: false, accepted: false, error: 'invalid mpv collaboration action' }
  );

  assert.deepEqual(
    host.forwardCollaborationAction(currentSender, makeCollaborationAction()),
    { success: true, accepted: true, sequence: 1 }
  );
  assert.deepEqual(
    host.forwardCollaborationAction(currentSender, makeCollaborationAction('sync.follow')),
    { success: true, accepted: true, sequence: 2 }
  );
  assert.deepEqual(host.forwardCollaborationAction(
    currentSender,
    makeCollaborationAction('sync.drag-start', {
      pointerId: 8,
      clientX: 100,
      clientY: 80
    })
  ), { success: true, accepted: true, sequence: 3 });
  assert.deepEqual(host.forwardCollaborationAction(
    currentSender,
    makeCollaborationAction('sync.drag-move', {
      pointerId: 8,
      clientX: -20,
      clientY: 500
    })
  ), { success: true, accepted: true, sequence: 4 });
  assert.deepEqual(host.forwardCollaborationAction(
    currentSender,
    makeCollaborationAction('sync.drag-end', {
      pointerId: 8,
      clientX: 900,
      clientY: -30
    })
  ), { success: true, accepted: true, sequence: 5 });
  const forwarded = events.filter(([name, channel]) =>
    name === 'mainWindow.send' && channel === 'mpv-overlay:collaboration-action');
  assert.deepEqual(forwarded.map(([, , message]) => message), [
    {
      action: 'sync.toggle',
      payload: null,
      hostGeneration,
      videoGeneration: 9,
      inputRevision: 2,
      activeSessionId: 'collaboration-input-session',
      sequence: 1
    },
    {
      action: 'sync.follow',
      payload: null,
      hostGeneration,
      videoGeneration: 9,
      inputRevision: 2,
      activeSessionId: 'collaboration-input-session',
      sequence: 2
    },
    {
      action: 'sync.drag-start',
      payload: { pointerId: 8, clientX: 100, clientY: 80 },
      hostGeneration,
      videoGeneration: 9,
      inputRevision: 2,
      activeSessionId: 'collaboration-input-session',
      sequence: 3
    },
    {
      action: 'sync.drag-move',
      payload: { pointerId: 8, clientX: -20, clientY: 500 },
      hostGeneration,
      videoGeneration: 9,
      inputRevision: 2,
      activeSessionId: 'collaboration-input-session',
      sequence: 4
    },
    {
      action: 'sync.drag-end',
      payload: { pointerId: 8, clientX: 900, clientY: -30 },
      hostGeneration,
      videoGeneration: 9,
      inputRevision: 2,
      activeSessionId: 'collaboration-input-session',
      sequence: 5
    }
  ]);
  assert.equal(events.some(([name]) => name === 'setIgnoreMouseEvents'), false,
    'semantic collaboration actions must not flip native click-through');

  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 9,
    inputRevision: 3
  }));
  events.length = 0;
  assert.equal(
    host.forwardCollaborationAction(currentSender, makeCollaborationAction()).accepted,
    false
  );
  assert.equal(events.some(([name]) => name === 'setIgnoreMouseEvents'), false);

  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 9,
    inputRevision: 4,
    enabled: true,
    session: {
      sessionId: 'collaboration-input-session-2',
      stableVideoIdentity: 'video-collaboration-actions',
      targetFrame: 11,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;
  assert.deepEqual(
    host.forwardCollaborationAction(currentSender, makeCollaborationAction('sync.lead')),
    { success: true, accepted: true, sequence: 1 }
  );
  assert.equal(
    events.find(([, channel]) => channel === 'mpv-overlay:collaboration-action')?.[2]
      ?.activeSessionId,
    'collaboration-input-session-2'
  );

  const staleWebContents = windows[0].webContents;
  host.destroy();
  const recreated = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  assert.equal(
    host.forwardCollaborationAction(
      { sender: staleWebContents },
      makeCollaborationAction('sync.lead')
    ).accepted,
    false
  );
  assert.equal(
    host.forwardCollaborationAction(
      { sender: windows[1].webContents },
      makeCollaborationAction('sync.lead')
    ).accepted,
    false,
    'a passive recreated overlay has no current Fabric session'
  );
  const recreatedGeneration = recreated.drawingCapability.hostGeneration;
  await host.setDrawingInput(makeDrawingInput(recreatedGeneration, {
    videoGeneration: 10,
    inputRevision: 1
  }));
  await host.setDrawingInput(makeDrawingInput(recreatedGeneration, {
    videoGeneration: 10,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'collaboration-input-session-recreated',
      stableVideoIdentity: 'video-collaboration-actions-recreated',
      targetFrame: 1,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  assert.deepEqual(host.forwardCollaborationAction(
    { sender: windows[1].webContents },
    makeCollaborationAction('sync.follow')
  ), { success: true, accepted: true, sequence: 1 });
});

test('hiding an active collaboration drag cancels once and preserves the same-fence sequence', async () => {
  const { host, events, windows } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 4,
    inputRevision: 1
  }));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 4,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'drag-before-hide',
      stableVideoIdentity: 'video-before-hide',
      targetFrame: 1,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;
  const sender = { sender: windows[0].webContents };
  assert.equal(host.forwardCollaborationAction(sender, makeCollaborationAction(
    'sync.drag-start',
    { pointerId: 6, clientX: 100, clientY: 60 }
  )).accepted, true);

  host.setVisible(false);
  const actions = events.filter(([, channel]) =>
    channel === 'mpv-overlay:collaboration-action').map(([, , message]) => message);
  assert.deepEqual(actions.map(({ action, sequence }) => [action, sequence]), [
    ['sync.drag-start', 1],
    ['sync.drag-cancel', 2]
  ]);
  assert.equal(actions[1].activeSessionId, 'drag-before-hide');
  assert.equal(host.collaborationActionSequence, 2);
  assert.equal(host.activeCollaborationDragPointerId, null);

  host.setVisible(true);
  events.length = 0;
  assert.deepEqual(host.forwardCollaborationAction(
    sender,
    makeCollaborationAction('sync.toggle')
  ), { success: true, accepted: true, sequence: 3 });
  assert.equal(events.some(([name]) => name === 'setIgnoreMouseEvents'), false);
});

test('parent hide cancels an active collaboration drag after the overlay is already hidden', async () => {
  const { host, events, windows, mainWindow } = createDrawingHostHarness();
  const parentListeners = new Map();
  mainWindow.on = (eventName, handler) => {
    const handlers = parentListeners.get(eventName) || [];
    handlers.push(handler);
    parentListeners.set(eventName, handlers);
  };
  mainWindow.off = (eventName, handler) => {
    const handlers = parentListeners.get(eventName) || [];
    parentListeners.set(eventName, handlers.filter(candidate => candidate !== handler));
  };

  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 1
  }));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'drag-before-parent-hide',
      stableVideoIdentity: 'video-before-parent-hide',
      targetFrame: 1,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;
  const sender = { sender: windows[0].webContents };
  assert.equal(host.forwardCollaborationAction(sender, makeCollaborationAction(
    'sync.drag-start',
    { pointerId: 7, clientX: 120, clientY: 70 }
  )).accepted, true);

  windows[0].isVisible = () => false;
  for (const handler of parentListeners.get('hide') || []) {
    handler();
  }

  const actions = events.filter(([, channel]) =>
    channel === 'mpv-overlay:collaboration-action').map(([, , message]) => message);
  assert.deepEqual(actions.map(({ action, sequence }) => [action, sequence]), [
    ['sync.drag-start', 1],
    ['sync.drag-cancel', 2]
  ]);
  assert.equal(actions[1].activeSessionId, 'drag-before-parent-hide');
  assert.equal(host.collaborationActionSequence, 2);
  assert.equal(host.activeCollaborationDragPointerId, null);
});

function makePersistenceHydration(hostGeneration, overrides = {}) {
  return {
    hostGeneration,
    videoGeneration: 7,
    persistenceSessionId: 'host-persistence-session',
    stableVideoIdentity: 'C:/shots/host-video.mov',
    fps: 24,
    totalFrames: 240,
    keyframes: [],
    ...overrides
  };
}

function makePersistenceExport(hostGeneration, overrides = {}) {
  const request = makePersistenceHydration(hostGeneration, overrides);
  delete request.keyframes;
  return request;
}

function makeDrawingPresentation(hostGeneration, overrides = {}) {
  return {
    hostGeneration,
    videoGeneration: 7,
    presentationRevision: 1,
    stableVideoIdentity: 'C:/shots/host-video.mov',
    storeRevision: 3,
    targetFrame: 24,
    sourceFrame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { left: 8, top: 12, width: 960, height: 540 },
    viewportRevision: 4,
    viewportTransform: { scale: 1.25, panX: 16, panY: -9 },
    ...overrides
  };
}

function makeDrawingFrameUpdate(hostGeneration, overrides = {}) {
  return {
    hostGeneration,
    videoGeneration: 7,
    inputRevision: 2,
    sessionId: 'active-frame-session',
    frameRevision: 1,
    targetFrame: 20,
    ...overrides
  };
}

function makeDrawingPointerdownFrameRequest(hostGeneration, overrides = {}) {
  return {
    hostGeneration,
    videoGeneration: 7,
    inputRevision: 2,
    sessionId: 'pointerdown-frame-session',
    pointerdownId: 'pointerdown-frame-1',
    pointerdownAt: 1234,
    ...overrides
  };
}

function makeDrawingPointerdownFrameConfirmation(hostGeneration, overrides = {}) {
  return {
    ...makeDrawingPointerdownFrameRequest(hostGeneration),
    targetFrame: 42,
    ...overrides
  };
}

function makeDrawingPointerdownFrameCancellation(hostGeneration, overrides = {}) {
  return {
    ...makeDrawingPointerdownFrameRequest(hostGeneration),
    cancelled: true,
    ...overrides
  };
}

function makePersistenceTransform(overrides = {}) {
  return {
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    skewX: 0,
    skewY: 0,
    flipX: false,
    flipY: false,
    ...overrides
  };
}

function makePersistenceRecord(overrides = {}) {
  return {
    id: 'host-stroke-1',
    type: 'stroke',
    pathData: 'M 0 0 L 10 10',
    sourcePoints: [
      { x: 0, y: 0, pressure: 0.5, time: 0, pointerType: 'pen' },
      { x: 10, y: 10, pressure: 0.75, time: 1, pointerType: 'pen' }
    ],
    style: {
      color: '#ff4757',
      size: 3,
      opacity: 1
    },
    transform: makePersistenceTransform(),
    ...overrides
  };
}

function makePersistenceSnapshot(hostGeneration, overrides = {}) {
  return {
    hostGeneration,
    videoGeneration: 7,
    persistenceSessionId: 'host-persistence-session',
    stableVideoIdentity: 'C:/shots/host-video.mov',
    fps: 24,
    totalFrames: 240,
    scenes: [{
      sceneInstanceId: 'host-scene-1',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makePersistenceRecord()]
    }],
    ...overrides
  };
}

function makePersistenceTransition(overrides = {}) {
  return {
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'host-persistence-session',
    stableVideoIdentity: 'C:/shots/host-video.mov',
    scene: {
      sceneInstanceId: 'host-scene-1',
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
    insertions: [{
      index: 0,
      record: makePersistenceRecord(),
      baseTransform: makePersistenceTransform()
    }],
    transforms: [],
    ...overrides
  };
}

function readFabricMethodPayload(script, method) {
  const marker = `.${method}(`;
  const start = script.indexOf(marker);
  if (start < 0) return null;
  const argument = script.slice(start + marker.length, script.lastIndexOf(');'));
  return argument ? JSON.parse(argument) : null;
}

function readDrawingV3BootstrapValue(script) {
  if (typeof script !== 'string' || !script.includes('__mpvFabricOverlayBootstrap')) {
    return undefined;
  }
  const match = script.match(/["']?drawingV3ShadowEnabled["']?\s*:\s*(true|false)/);
  if (!match) return undefined;
  return match[1] === 'true';
}

function drawingRuntimeExecutionSteps(events, bundleSource = '/* fixed Fabric bundle */') {
  return events.flatMap(([name, script]) => {
    if (name !== 'executeJavaScript') return [];
    const bootstrapValue = readDrawingV3BootstrapValue(script);
    if (bootstrapValue !== undefined) return [`bootstrap:${bootstrapValue}`];
    if (script === bundleSource) return ['bundle-and-singleton'];
    if (script.includes?.('.prepare(document.getElementById(\'root\'))')) return ['prepare'];
    if (script.includes?.('.setDrawingInput(') && script.includes('"enabled":true')) {
      return ['input:true'];
    }
    return [];
  });
}

async function activateDrawingHost(harness, overrides = {}) {
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  const videoGeneration = overrides.videoGeneration ?? 1;
  const inputRevision = overrides.inputRevision ?? 2;
  const sessionId = overrides.sessionId || 'session-active-actions';
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration,
    inputRevision: inputRevision - 1,
    enabled: false
  }));
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration,
    inputRevision,
    enabled: true,
    session: {
      sessionId,
      stableVideoIdentity: 'video-active-actions',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'select'
    }
  }));
  return { hostGeneration, videoGeneration, inputRevision, sessionId };
}

test('exposes the MPV overlay Fabric drawing host capability API', () => {
  const { host } = createDrawingHostHarness();

  assert.equal(typeof host.getDrawingCapability, 'function');
  assert.equal(typeof host.setDrawingInput, 'function');
  assert.equal(typeof host.updateDrawingTool, 'function');
  assert.equal(typeof host.updateDrawingFrame, 'function');
  assert.equal(typeof host.applyDrawingAction, 'function');
  assert.equal(typeof host.getDrawingDiagnostics, 'function');
  assert.equal(typeof host.configureDrawingV3Shadow, 'function');
});

test('drawing V3 shadow configuration accepts only the first valid strict boolean', async () => {
  const harness = createDrawingHostHarness();
  const { host } = harness;
  assert.equal(typeof host.configureDrawingV3Shadow, 'function');

  const invalid = host.configureDrawingV3Shadow('true');
  const accepted = host.configureDrawingV3Shadow(true);
  const repeated = host.configureDrawingV3Shadow(false);

  assert.equal(invalid.success, false, 'truthy non-booleans must not enable the experiment');
  assert.equal(accepted.success, true, 'an invalid call must not consume the one configuration slot');
  assert.equal(repeated.success, false, 'the first valid configuration is immutable');

  await activateDrawingHost(harness, { sessionId: 'session-v3-first-valid' });
  assert.deepEqual(
    harness.events
      .filter(([name]) => name === 'executeJavaScript')
      .map(([, script]) => readDrawingV3BootstrapValue(script))
      .filter(value => value !== undefined),
    [true],
    'a rejected later false value must not replace the accepted true value'
  );
});

test('the first ensure entry locks the default V3 shadow setting even when ensure fails', async () => {
  const harness = createDrawingHostHarness();
  const { host, mainWindow } = harness;
  host.getMainWindow = () => null;

  const failedEnsure = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  assert.equal(failedEnsure.success, false);
  assert.equal(typeof host.configureDrawingV3Shadow, 'function');
  assert.equal(host.configureDrawingV3Shadow(true).success, false,
    'entering ensure locks the startup-only default before any early return');

  host.getMainWindow = () => mainWindow;
  await activateDrawingHost(harness, { sessionId: 'session-v3-lock-after-failed-ensure' });
  assert.deepEqual(
    harness.events
      .filter(([name]) => name === 'executeJavaScript')
      .map(([, script]) => readDrawingV3BootstrapValue(script))
      .filter(value => value !== undefined),
    [false]
  );
});

test('destroying and recreating the overlay host does not unlock V3 shadow configuration', async () => {
  const harness = createDrawingHostHarness();
  const { host } = harness;
  assert.equal(typeof host.configureDrawingV3Shadow, 'function');
  assert.equal(host.configureDrawingV3Shadow(true).success, true);
  assert.equal((await host.ensure({ x: 0, y: 0, width: 640, height: 360 })).success, true);

  host.destroy();
  assert.equal(host.configureDrawingV3Shadow(false).success, false,
    'destroy is a window lifecycle event, not a process-startup configuration reset');

  await activateDrawingHost(harness, { sessionId: 'session-v3-recreated-host' });
  assert.deepEqual(
    harness.events
      .filter(([name]) => name === 'executeJavaScript')
      .map(([, script]) => readDrawingV3BootstrapValue(script))
      .filter(value => value !== undefined),
    [true]
  );
});

test('default-false V3 bootstrap runs before bundle singleton creation, prepare, and drawing input', async () => {
  const harness = createDrawingHostHarness();
  await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  harness.events.length = 0;

  await activateDrawingHost(harness, { sessionId: 'session-v3-default-order' });

  assert.deepEqual(drawingRuntimeExecutionSteps(harness.events), [
    'bootstrap:false',
    'bundle-and-singleton',
    'prepare',
    'input:true'
  ]);
});

test('configured-true V3 bootstrap runs before bundle singleton creation, prepare, and drawing input', async () => {
  const harness = createDrawingHostHarness();
  assert.equal(typeof harness.host.configureDrawingV3Shadow, 'function');
  assert.equal(harness.host.configureDrawingV3Shadow(true).success, true);
  await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  harness.events.length = 0;

  await activateDrawingHost(harness, { sessionId: 'session-v3-enabled-order' });

  assert.deepEqual(drawingRuntimeExecutionSteps(harness.events), [
    'bootstrap:true',
    'bundle-and-singleton',
    'prepare',
    'input:true'
  ]);
});

test('a warm Fabric runtime injects the configured V3 bootstrap only once per host generation', async () => {
  const harness = createDrawingHostHarness();
  const { host } = harness;
  assert.equal(typeof host.configureDrawingV3Shadow, 'function');
  assert.equal(host.configureDrawingV3Shadow(true).success, true);
  const active = await activateDrawingHost(harness, {
    inputRevision: 2,
    sessionId: 'session-v3-warm-first'
  });

  await host.getDrawingDiagnostics();
  await host.ensure({ x: 1, y: 2, width: 640, height: 360 });
  assert.equal((await host.setDrawingInput(makeDrawingInput(active.hostGeneration, {
    videoGeneration: active.videoGeneration,
    inputRevision: 3,
    enabled: false
  }))).success, true);
  assert.equal((await host.setDrawingInput(makeDrawingInput(active.hostGeneration, {
    videoGeneration: active.videoGeneration,
    inputRevision: 4,
    enabled: true,
    session: {
      sessionId: 'session-v3-warm-second',
      stableVideoIdentity: 'video-v3-warm',
      targetFrame: 25,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }))).success, true);

  const steps = drawingRuntimeExecutionSteps(harness.events);
  assert.equal(steps.filter(step => step === 'bootstrap:true').length, 1);
  assert.equal(steps.filter(step => step === 'bundle-and-singleton').length, 1);
  assert.equal(steps.filter(step => step === 'prepare').length, 1);
});

test('a true V3 bootstrap injection failure falls back false without poisoning Fabric retry state', async () => {
  const harness = createDrawingHostHarness({
    executeJavaScriptError(script) {
      if (readDrawingV3BootstrapValue(script) === true) {
        return new Error('injected V3 bootstrap failure');
      }
      return null;
    }
  });
  const { host } = harness;
  assert.equal(typeof host.configureDrawingV3Shadow, 'function');
  assert.equal(host.configureDrawingV3Shadow(true).success, true);

  const active = await activateDrawingHost(harness, {
    sessionId: 'session-v3-bootstrap-fallback'
  });

  assert.equal(active.hostGeneration, 1);
  assert.equal(host.getDrawingCapability().fabricReady, true);
  assert.equal(host.fabricFailureCount, 0);
  assert.equal(host.fabricRetryAfter, 0);
  assert.equal(host.fabricLastError, null);
  assert.deepEqual(drawingRuntimeExecutionSteps(harness.events), [
    'bootstrap:true',
    'bootstrap:false',
    'bundle-and-singleton',
    'prepare',
    'input:true'
  ]);
});

test('hostile bootstrap accessors cannot block the bundle when both standalone injections fail', async () => {
  let getterCalls = 0;
  let setterCalls = 0;
  const bootstrapWindow = {};
  Object.defineProperty(bootstrapWindow, '__mpvFabricOverlayBootstrap', {
    configurable: false,
    get() {
      getterCalls += 1;
      return { drawingV3ShadowEnabled: true };
    },
    set() {
      setterCalls += 1;
      throw new Error('hostile bootstrap setter');
    }
  });
  const harness = createDrawingHostHarness({ bootstrapWindow });
  const { host } = harness;
  assert.equal(host.configureDrawingV3Shadow(true).success, true);

  const active = await activateDrawingHost(harness, {
    sessionId: 'session-v3-hostile-bootstrap-slot'
  });

  assert.equal(active.hostGeneration, 1);
  assert.equal(host.getDrawingCapability().fabricReady, true);
  assert.equal(host.fabricFailureCount, 0);
  assert.equal(host.fabricRetryAfter, 0);
  assert.equal(host.fabricLastError, null);
  assert.equal(getterCalls, 0, 'bootstrap installation must not invoke a hostile getter');
  assert.equal(setterCalls, 0, 'bootstrap installation must not invoke a hostile setter');
  assert.equal(
    Object.prototype.hasOwnProperty.call(bootstrapWindow, '__mpvFabricOverlayBootstrap'),
    true,
    'an unremovable hostile slot may remain, but it must never block Fabric startup'
  );
  assert.deepEqual(drawingRuntimeExecutionSteps(harness.events), [
    'bootstrap:true',
    'bootstrap:false',
    'bundle-and-singleton',
    'prepare',
    'input:true'
  ]);
});

test('drawing diagnostics expose only the exact bounded 16-key V3 shadow aggregate', async () => {
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.getDiagnostics(')) return undefined;
      return {
        state: 'active',
        prepared: true,
        inputEnabled: true,
        drawingV3Shadow: {
          enabled: 'true',
          status: '<script>must-not-leak</script>',
          sceneCount: -1,
          bootstrapCount: 3.9,
          commitCount: '7',
          failureCount: Number.POSITIVE_INFINITY,
          divergenceCount: Number.MAX_SAFE_INTEGER + 1,
          resyncCount: Number.NaN,
          staleCount: -4,
          gapCount: null,
          headSequence: 9.8,
          objectCount: '11.2',
          estimatedBytes: { secret: 'must-not-leak' },
          latencyP50Ms: 60_001,
          latencyP95Ms: '12.5',
          lastReason: 'secret-reason-must-not-leak',
          queue: [{ points: ['must-not-leak'] }],
          document: { actors: ['must-not-leak'] },
          extraSecret: 'must-not-leak'
        }
      };
    }
  });
  await activateDrawingHost(harness, { sessionId: 'session-v3-sanitizer' });

  const diagnostics = await harness.host.getDrawingDiagnostics();
  assert.equal(diagnostics.success, true);
  assert.ok(diagnostics.drawingV3Shadow, 'the bounded V3 aggregate must be present');
  assert.deepEqual(Object.keys(diagnostics.drawingV3Shadow).sort(), [
    'bootstrapCount',
    'commitCount',
    'divergenceCount',
    'enabled',
    'estimatedBytes',
    'failureCount',
    'gapCount',
    'headSequence',
    'lastReason',
    'latencyP50Ms',
    'latencyP95Ms',
    'objectCount',
    'resyncCount',
    'sceneCount',
    'staleCount',
    'status'
  ]);
  assert.deepEqual(diagnostics.drawingV3Shadow, {
    enabled: false,
    status: 'degraded',
    sceneCount: 0,
    bootstrapCount: 3,
    commitCount: 7,
    failureCount: 0,
    divergenceCount: 0,
    resyncCount: 0,
    staleCount: 0,
    gapCount: 0,
    headSequence: 9,
    objectCount: 11,
    estimatedBytes: 0,
    latencyP50Ms: 60_000,
    latencyP95Ms: 12.5,
    lastReason: null
  });
  assert.doesNotMatch(JSON.stringify(diagnostics),
    /must-not-leak|extraSecret|secret-reason|"(?:queue|document|actors|points|secret)"/i);
});

test('passive ensure stays ready without reading or injecting the Fabric bundle', async () => {
  const { host, events, windows, getReadCount } = createDrawingHostHarness({
    readFile: async () => {
      throw new Error('Fabric bundle unavailable');
    }
  });

  const result = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });

  assert.equal(result.success, true);
  assert.equal(getReadCount(), 0);
  assert.equal(events.some(([name, script]) => name === 'executeJavaScript' && script === '/* fixed Fabric bundle */'), false);
  assert.equal(windows[0].options.focusable, false);
  assert.equal(windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(
    windows[0].options.webPreferences.preload,
    path.resolve(__dirname, '../../preload/mpv-overlay-preload.js')
  );
  assert.ok(result.drawingCapability, 'ensure should return the current drawing capability');
  assert.equal(result.drawingCapability.hostGeneration, 1);
  assert.equal(result.drawingCapability.passiveReady, true);
  assert.equal(result.drawingCapability.fabricReady, false);
});

test('only the current live overlay webContents is accepted as a persistence sender', async () => {
  const { host, windows } = createDrawingHostHarness();
  await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const firstSender = windows[0].webContents;
  assert.equal(typeof host.isCurrentOverlaySender, 'function');
  assert.equal(host.isCurrentOverlaySender({ sender: firstSender }), true);
  assert.equal(host.isCurrentOverlaySender({ sender: {} }), false);
  firstSender.destroyed = true;
  assert.equal(host.isCurrentOverlaySender({ sender: firstSender }), false);
  firstSender.destroyed = false;

  host.destroy();
  assert.equal(host.isCurrentOverlaySender({ sender: firstSender }), false);
  await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  assert.equal(host.isCurrentOverlaySender({ sender: firstSender }), false);
  assert.equal(host.isCurrentOverlaySender({ sender: windows[1].webContents }), true);
});

test('drawing persistence hydrate/export enforce fences, input state, and bounded host responses', async () => {
  const executed = [];
  const snapshot = {
    hostGeneration: 1,
    videoGeneration: 7,
    persistenceSessionId: 'host-persistence-session',
    stableVideoIdentity: 'C:/shots/host-video.mov',
    fps: 24,
    totalFrames: 240,
    scenes: []
  };
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        executed.push(['hydrate', readFabricMethodPayload(script, 'hydrateDrawingVideo')]);
        return {
          accepted: true,
          sceneCount: 2,
          objectCount: 3,
          secret: 'must-not-leak'
        };
      }
      if (script.includes('.exportDrawingVideo(')) {
        executed.push(['export', readFabricMethodPayload(script, 'exportDrawingVideo')]);
        return {
          accepted: true,
          snapshot,
          secret: 'must-not-leak'
        };
      }
      return undefined;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));

  assert.deepEqual(await harness.host.hydrateDrawingVideo({
    ...makePersistenceHydration(hostGeneration),
    secret: 'must-not-reach-runtime'
  }), {
    success: false,
    accepted: false,
    reason: 'invalid-persistence-request'
  });
  assert.deepEqual(await harness.host.hydrateDrawingVideo(makePersistenceHydration(
    hostGeneration,
    {
      keyframes: [{
        id: 'host-scene-1',
        frame: 24,
        sourceWidth: 1920,
        sourceHeight: 1080,
        mutationSequence: 1,
        objects: [{
          ...makePersistenceRecord(),
          secret: 'must-not-reach-runtime'
        }]
      }]
    }
  )), {
    success: false,
    accepted: false,
    reason: 'invalid-persistence-request'
  });
  assert.equal(executed.length, 0);

  const hydration = makePersistenceHydration(hostGeneration);
  assert.deepEqual(await harness.host.hydrateDrawingVideo(hydration), {
    success: true,
    accepted: true,
    sceneCount: 2,
    objectCount: 3
  });
  assert.deepEqual(executed[0], ['hydrate', hydration]);
  assert.deepEqual(await harness.host.exportDrawingVideo(makePersistenceExport(hostGeneration)), {
    success: true,
    accepted: true,
    snapshot
  });

  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'host-active-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  assert.equal((await harness.host.exportDrawingVideo(
    makePersistenceExport(hostGeneration)
  )).success, true, 'export stays available while drawing input is active');
  assert.deepEqual(await harness.host.hydrateDrawingVideo(hydration), {
    success: false,
    accepted: false,
    reason: 'drawing-input-enabled'
  });
  assert.deepEqual(await harness.host.exportDrawingVideo(makePersistenceExport(
    hostGeneration,
    { videoGeneration: 6 }
  )), {
    success: false,
    accepted: false,
    reason: 'stale-persistence-fence'
  });
  assert.equal(executed.filter(([kind]) => kind === 'hydrate').length, 1);
  assert.equal(JSON.stringify(executed).includes('must-not-leak'), false);
});

test('drawing export rejects non-exact requests and returns only a validated cloned snapshot', async () => {
  let exportCalls = 0;
  const runtimeSnapshot = makePersistenceSnapshot(1);
  runtimeSnapshot.scenes[0].objects[0].renderGeometry = {
    version: 1,
    pathData: [
      'M 0 0 L 12 0 L 12 12 L 0 12 Z',
      'M 3 3 L 3 9 L 9 9 L 9 3 Z',
      'M 12 12 L 16 12 L 16 16 L 12 16 Z'
    ].join(' '),
    fillRule: 'evenodd'
  };
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.exportDrawingVideo(')) return undefined;
      exportCalls += 1;
      return {
        accepted: true,
        snapshot: runtimeSnapshot,
        secret: 'outer-secret-must-not-leak'
      };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  const request = makePersistenceExport(hostGeneration);

  assert.deepEqual(await harness.host.exportDrawingVideo({
    ...request,
    secret: 'request-secret-must-not-reach-overlay'
  }), {
    success: false,
    accepted: false,
    reason: 'invalid-persistence-request'
  });
  assert.equal(exportCalls, 0);

  const exported = await harness.host.exportDrawingVideo(request);
  assert.deepEqual(exported, {
    success: true,
    accepted: true,
    snapshot: runtimeSnapshot
  });
  assert.notEqual(exported.snapshot, runtimeSnapshot);
  assert.notEqual(exported.snapshot.scenes[0], runtimeSnapshot.scenes[0]);
  assert.notEqual(
    exported.snapshot.scenes[0].objects[0],
    runtimeSnapshot.scenes[0].objects[0]
  );
  runtimeSnapshot.scenes[0].objects[0].style.color = '#000000';
  assert.equal(exported.snapshot.scenes[0].objects[0].style.color, '#ff4757');
  assert.doesNotMatch(JSON.stringify(exported), /outer-secret-must-not-leak/);
});

test('drawing export rejects snapshot fence mismatches and every non-exact inner record shape', async () => {
  let runtimeSnapshot;
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.exportDrawingVideo(')) return undefined;
      return { accepted: true, snapshot: runtimeSnapshot };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  const request = makePersistenceExport(hostGeneration);

  const mismatchedFences = [
    ['hostGeneration', hostGeneration + 1],
    ['videoGeneration', 8],
    ['persistenceSessionId', 'other-persistence-session'],
    ['stableVideoIdentity', 'C:/shots/other-video.mov'],
    ['fps', 30],
    ['totalFrames', 241]
  ];
  for (const [field, value] of mismatchedFences) {
    runtimeSnapshot = makePersistenceSnapshot(hostGeneration, { [field]: value });
    assert.deepEqual(
      await harness.host.exportDrawingVideo(request),
      {
        success: false,
        accepted: false,
        reason: 'invalid-persistence-snapshot'
      },
      `snapshot ${field} must match the exact request fence`
    );
  }

  const invalidSnapshots = [
    ['snapshot extra field', value => { value.secret = 'snapshot-secret'; }],
    ['scene extra field', value => { value.scenes[0].secret = 'scene-secret'; }],
    ['record extra field', value => { value.scenes[0].objects[0].secret = 'record-secret'; }],
    ['render geometry extra field', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 1 1 L 2 1 L 2 2 Z',
        fillRule: 'evenodd',
        secret: true
      };
    }],
    ['render geometry fill rule', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 1 1 L 2 1 L 2 2 Z',
        fillRule: 'nonzero'
      };
    }],
    ['render geometry curve command', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 1 1 Q 2 0 3 1 L 3 3 L 1 3 Z',
        fillRule: 'evenodd'
      };
    }],
    ['render geometry trailing injection token', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 1 1 L 2 1 L 2 2 Z <script>',
        fillRule: 'evenodd'
      };
    }],
    ['render geometry coordinate bound', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 1001000001 1 L 2 1 L 2 2 Z',
        fillRule: 'evenodd'
      };
    }],
    ['render geometry degenerate edge', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 0 0 L 8 0 L 8 0 L 0 8 Z',
        fillRule: 'evenodd'
      };
    }],
    ['render geometry self-crossing contour', value => {
      value.scenes[0].objects[0].renderGeometry = {
        version: 1,
        pathData: 'M 0 0 L 8 8 L 0 8 L 8 0 Z',
        fillRule: 'evenodd'
      };
    }],
    ['style extra field', value => { value.scenes[0].objects[0].style.secret = true; }],
    ['point coordinate bound', value => {
      value.scenes[0].objects[0].sourcePoints[0].x = 1_000_000_001;
    }],
    ['point time order', value => {
      value.scenes[0].objects[0].sourcePoints[0].time = 2;
    }],
    ['transform extra field', value => {
      value.scenes[0].objects[0].transform.secret = true;
    }],
    ['zero transform scale', value => {
      value.scenes[0].objects[0].transform.scaleX = 0;
    }],
    ['duplicate scene id', value => {
      const duplicate = structuredClone(value.scenes[0]);
      duplicate.targetFrame = 48;
      value.scenes.push(duplicate);
    }],
    ['duplicate object id', value => {
      value.scenes[0].objects.push(structuredClone(value.scenes[0].objects[0]));
    }],
    ['unsorted scenes', value => {
      const earlier = structuredClone(value.scenes[0]);
      earlier.sceneInstanceId = 'host-scene-0';
      earlier.targetFrame = 12;
      value.scenes.push(earlier);
    }]
  ];
  for (const [label, mutate] of invalidSnapshots) {
    runtimeSnapshot = makePersistenceSnapshot(hostGeneration);
    mutate(runtimeSnapshot);
    const rejected = await harness.host.exportDrawingVideo(request);
    assert.deepEqual(rejected, {
      success: false,
      accepted: false,
      reason: 'invalid-persistence-snapshot'
    }, label);
    assert.doesNotMatch(JSON.stringify(rejected), /secret/i, label);
  }
});

test('drawing export enforces the configured snapshot byte ceiling before returning data', async () => {
  const runtimeSnapshot = makePersistenceSnapshot(1);
  runtimeSnapshot.scenes[0].objects[0].pathData = `M 0 0 ${'x'.repeat(2048)}`;
  const harness = createDrawingHostHarness({
    fabricDrawingSnapshotMaxBytes: 1024,
    executeDrawing(script) {
      if (!script.includes('.exportDrawingVideo(')) return undefined;
      return { accepted: true, snapshot: runtimeSnapshot };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  assert.deepEqual(
    await harness.host.exportDrawingVideo(makePersistenceExport(hostGeneration)),
    {
      success: false,
      accepted: false,
      reason: 'persistence-snapshot-too-large'
    }
  );
});

test('drawing persistence maps prepare, runtime rejection, and runtime exceptions to fixed public reasons', async () => {
  const prepareFailure = createDrawingHostHarness({
    readFile: async () => {
      throw new Error('C:/private/user/project/fabric-bundle.js');
    }
  });
  const prepared = await prepareFailure.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  await prepareFailure.host.setDrawingInput(makeDrawingInput(
    prepared.drawingCapability.hostGeneration,
    { videoGeneration: 7, inputRevision: 1, enabled: false }
  ));
  const prepareResult = await prepareFailure.host.hydrateDrawingVideo(
    makePersistenceHydration(prepared.drawingCapability.hostGeneration)
  );
  assert.deepEqual(prepareResult, {
    success: false,
    accepted: false,
    reason: 'drawing-runtime-unavailable'
  });

  const runtimeFailure = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: false, reason: 'C:/private/reviews/secret.bframe' };
      }
      if (script.includes('.exportDrawingVideo(')) {
        throw new Error('token=super-secret-runtime-token');
      }
      return undefined;
    }
  });
  const ensured = await runtimeFailure.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await runtimeFailure.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  const hydration = await runtimeFailure.host.hydrateDrawingVideo(
    makePersistenceHydration(hostGeneration)
  );
  const exported = await runtimeFailure.host.exportDrawingVideo(
    makePersistenceExport(hostGeneration)
  );
  assert.deepEqual(hydration, {
    success: false,
    accepted: false,
    reason: 'drawing-hydration-rejected'
  });
  assert.deepEqual(exported, {
    success: false,
    accepted: false,
    reason: 'drawing-export-failed'
  });
  assert.doesNotMatch(
    JSON.stringify([prepareResult, hydration, exported]),
    /private|secret|token|bframe/i
  );

  const knownRuntimeRejections = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: false, reason: 'input-enabled' };
      }
      if (script.includes('.exportDrawingVideo(')) {
        return { accepted: false, reason: 'stale-fence' };
      }
      return undefined;
    }
  });
  const knownRuntime = await knownRuntimeRejections.host.ensure({
    x: 0,
    y: 0,
    width: 640,
    height: 360
  });
  const knownHostGeneration = knownRuntime.drawingCapability.hostGeneration;
  await knownRuntimeRejections.host.setDrawingInput(makeDrawingInput(knownHostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  assert.deepEqual(
    await knownRuntimeRejections.host.hydrateDrawingVideo(
      makePersistenceHydration(knownHostGeneration)
    ),
    {
      success: false,
      accepted: false,
      reason: 'drawing-input-enabled'
    }
  );
  assert.deepEqual(
    await knownRuntimeRejections.host.exportDrawingVideo(
      makePersistenceExport(knownHostGeneration)
    ),
    {
      success: false,
      accepted: false,
      reason: 'stale-persistence-fence'
    }
  );
});

test('drawing export reports host loss after asynchronous Fabric preparation failure', async () => {
  const preparation = createDeferred();
  const preparationStarted = createDeferred();
  const harness = createDrawingHostHarness();
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  harness.host._ensureFabricRuntime = () => {
    preparationStarted.resolve();
    return preparation.promise;
  };

  const pending = harness.host.exportDrawingVideo(makePersistenceExport(hostGeneration));
  await preparationStarted.promise;
  harness.host.destroy();
  preparation.resolve({ success: false, error: 'late Fabric preparation failure' });

  assert.deepEqual(await pending, {
    success: false,
    accepted: false,
    reason: 'overlay-host-unavailable'
  });
});

test('drawing export reports host loss after asynchronous runtime success', async () => {
  const deferred = createDeferred();
  const runtimeStarted = createDeferred();
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.exportDrawingVideo(')) return undefined;
      runtimeStarted.resolve();
      return deferred.promise;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));

  const pending = harness.host.exportDrawingVideo(makePersistenceExport(hostGeneration));
  await runtimeStarted.promise;
  harness.host.destroy();
  deferred.resolve({
    accepted: true,
    snapshot: makePersistenceSnapshot(hostGeneration)
  });

  assert.deepEqual(await pending, {
    success: false,
    accepted: false,
    reason: 'overlay-host-unavailable'
  });
});

test('drawing export reports host loss after asynchronous runtime failure', async () => {
  const deferred = createDeferred();
  const runtimeStarted = createDeferred();
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.exportDrawingVideo(')) return undefined;
      runtimeStarted.resolve();
      return deferred.promise;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));

  const pending = harness.host.exportDrawingVideo(makePersistenceExport(hostGeneration));
  await runtimeStarted.promise;
  harness.host.destroy();
  deferred.reject(new Error('late Fabric export failure'));

  assert.deepEqual(await pending, {
    success: false,
    accepted: false,
    reason: 'overlay-host-unavailable'
  });
});

test('drawing export keeps a live-host video-generation change classified as stale', async () => {
  const deferred = createDeferred();
  const runtimeStarted = createDeferred();
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.exportDrawingVideo(')) return undefined;
      runtimeStarted.resolve();
      return deferred.promise;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));

  const pending = harness.host.exportDrawingVideo(makePersistenceExport(hostGeneration));
  await runtimeStarted.promise;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 8,
    inputRevision: 2,
    enabled: false
  }));
  deferred.resolve({
    accepted: true,
    snapshot: makePersistenceSnapshot(hostGeneration)
  });

  assert.deepEqual(await pending, {
    success: false,
    accepted: false,
    reason: 'stale-persistence-response'
  });
});

test('drawing persistence IPC normalization preserves small transitions and never drops oversize dirty signals', () => {
  assert.equal(typeof normalizeFabricDrawingPersistenceMessage, 'function');
  const transition = makePersistenceTransition();
  const normalized = normalizeFabricDrawingPersistenceMessage({
    type: 'transition',
    transition
  });
  assert.deepEqual(normalized, { type: 'transition', transition });
  assert.notEqual(normalized.transition, transition);

  const oversized = makePersistenceTransition({
    insertions: [{ payload: 'x'.repeat(8 * 1024 * 1024) }]
  });
  assert.deepEqual(
    normalizeFabricDrawingPersistenceMessage({
      type: 'transition',
      transition: oversized
    }),
    {
      type: 'resync-required',
      hostGeneration: 3,
      videoGeneration: 7,
      persistenceSessionId: 'host-persistence-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      reason: 'transition-too-large'
    }
  );

  const invalid = makePersistenceTransition({ extra: true });
  assert.deepEqual(
    normalizeFabricDrawingPersistenceMessage({
      type: 'transition',
      transition: invalid
    }),
    {
      type: 'resync-required',
      hostGeneration: 3,
      videoGeneration: 7,
      persistenceSessionId: 'host-persistence-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      reason: 'transition-invalid-at-boundary'
    }
  );
  assert.equal(normalizeFabricDrawingPersistenceMessage({
    type: 'transition',
    transition: makePersistenceTransition({ hostGeneration: -1 })
  }), null);
});

test('drawing persistence IPC normalization resyncs malformed nested deltas with a valid fence', () => {
  const expectedResync = {
    type: 'resync-required',
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'host-persistence-session',
    stableVideoIdentity: 'C:/shots/host-video.mov',
    reason: 'transition-invalid-at-boundary'
  };
  const invalidTransitions = [
    ['removal extra field', value => {
      value.kind = 'delete-objects';
      value.insertions = [];
      value.removals = [{ id: 'host-stroke-1', index: 0, secret: true }];
    }],
    ['insertion extra field', value => {
      value.insertions[0].secret = true;
    }],
    ['record extra field', value => {
      value.insertions[0].record.secret = true;
    }],
    ['style extra field', value => {
      value.insertions[0].record.style.secret = true;
    }],
    ['invalid point pressure', value => {
      value.insertions[0].record.sourcePoints[0].pressure = 1.01;
    }],
    ['decreasing point time', value => {
      value.insertions[0].record.sourcePoints[0].time = 2;
    }],
    ['transform extra field', value => {
      value.insertions[0].record.transform.secret = true;
    }],
    ['invalid base transform', value => {
      value.insertions[0].baseTransform.scaleX = 0;
    }],
    ['transform change extra field', value => {
      value.kind = 'transform-objects';
      value.insertions = [];
      value.transforms = [{
        id: 'host-stroke-1',
        beforeTransform: makePersistenceTransform(),
        afterTransform: makePersistenceTransform({ left: 10 }),
        secret: true
      }];
    }],
    ['unsupported transition', value => {
      value.unsupportedReason = 'unsupported-transform';
    }],
    ['kind mismatch', value => {
      value.kind = 'delete-objects';
    }],
    ['duplicate insertion id', value => {
      value.insertions.push(structuredClone(value.insertions[0]));
    }],
    ['no-op delta', value => {
      value.insertions = [];
    }],
    ['target frame ceiling', value => {
      value.scene.targetFrame = 1_000_000_000;
    }],
    ['removal index ceiling', value => {
      value.kind = 'delete-objects';
      value.insertions = [];
      value.removals = [{ id: 'host-stroke-1', index: 10_000 }];
    }],
    ['insertion index ceiling', value => {
      value.insertions[0].index = 10_001;
    }]
  ];

  for (const [label, mutate] of invalidTransitions) {
    const transition = makePersistenceTransition();
    mutate(transition);
    assert.deepEqual(
      normalizeFabricDrawingPersistenceMessage({
        type: 'transition',
        transition
      }),
      expectedResync,
      label
    );
  }

  const estimatedOversize = makePersistenceTransition({
    estimatedBytes: 8 * 1024 * 1024 + 1
  });
  assert.deepEqual(
    normalizeFabricDrawingPersistenceMessage({
      type: 'transition',
      transition: estimatedOversize
    }),
    {
      ...expectedResync,
      reason: 'transition-too-large'
    }
  );
});

test('passive diagnostics expose accepted host tokens before the Fabric runtime is prepared', async () => {
  const { host, getReadCount } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;

  const disabled = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 11,
    enabled: false
  }));
  assert.equal(disabled.success, true);

  const diagnostics = await host.getDrawingDiagnostics();
  assert.equal(diagnostics.success, false);
  assert.match(diagnostics.error, /not ready/i);
  assert.equal(diagnostics.hostGeneration, hostGeneration);
  assert.equal(diagnostics.videoGeneration, 7);
  assert.equal(diagnostics.inputRevision, 11);
  assert.equal(diagnostics.desiredInputEnabled, false);
  assert.equal(getReadCount(), 0, 'passive diagnostics must not prepare Fabric');
});

test('injects and prepares Fabric once per host generation before enabling native input', async () => {
  const { host, events, getReadCount } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  events.length = 0;

  const disabling = host.setDrawingInput(makeDrawingInput(hostGeneration));
  assert.deepEqual(events[0], ['setIgnoreMouseEvents', true, undefined]);
  assert.equal((await disabling).success, true);

  const enabled = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-1',
      stableVideoIdentity: 'video-1',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));

  assert.equal(enabled.success, true);
  assert.equal(enabled.enabled, true);
  assert.equal(getReadCount(), 1);
  assert.equal(events.filter(([name, value]) => name === 'executeJavaScript' && value === '/* fixed Fabric bundle */').length, 1);
  assert.equal(events.filter(([name, value]) => name === 'executeJavaScript' && value.includes?.('.prepare(document.getElementById(\'root\'))')).length, 1);
  const runtimeEnableIndex = events.findIndex(([name, value]) =>
    name === 'executeJavaScript' && value.includes?.('.setDrawingInput(') && value.includes('"enabled":true'));
  const nativeEnableIndex = events.findIndex(([name, value]) => name === 'setIgnoreMouseEvents' && value === false);
  const focusableEnableIndex = events.findIndex(([name, value]) =>
    name === 'setFocusable' && value === true);
  assert.ok(runtimeEnableIndex >= 0);
  assert.ok(focusableEnableIndex > runtimeEnableIndex,
    'the overlay becomes focusable only after Fabric accepted activation');
  assert.ok(nativeEnableIndex > focusableEnableIndex,
    'native input opens only after the overlay can receive pointer-down events');
  assert.equal(events.some(([name, , mouseOptions]) => name === 'setIgnoreMouseEvents' && mouseOptions?.forward === true), false);

  await host.getDrawingDiagnostics();
  await host.ensure({ x: 1, y: 2, width: 640, height: 360 });
  assert.equal(getReadCount(), 1);
});

test('successful drawing activation repaints and restores the overlay above the video host', async () => {
  const { host, events } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration));
  events.length = 0;

  const enabled = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-immediate-toolbar',
      stableVideoIdentity: 'video-immediate-toolbar',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));

  assert.equal(enabled.success, true);
  const runtimeEnableIndex = events.findIndex(([name, value]) =>
    name === 'executeJavaScript' &&
    value.includes?.('.setDrawingInput(') &&
    value.includes('"enabled":true'));
  const repaintIndex = events.findIndex(([name]) =>
    name === 'webContents.invalidate');
  const focusableEnableIndex = events.findIndex(([name, value]) =>
    name === 'setFocusable' && value === true);
  const nativeEnableIndex = events.findIndex(([name, value]) =>
    name === 'setIgnoreMouseEvents' && value === false);
  const moveTopIndex = events.findIndex(([name]) => name === 'moveTop');
  assert.ok(runtimeEnableIndex >= 0);
  assert.ok(
    repaintIndex > runtimeEnableIndex,
    'the activated toolbar must schedule a repaint after its DOM becomes visible'
  );
  assert.ok(
    focusableEnableIndex > repaintIndex,
    'pointer activation must wait until the visible toolbar repaint is scheduled'
  );
  assert.ok(nativeEnableIndex > focusableEnableIndex);
  assert.ok(
    moveTopIndex > nativeEnableIndex,
    'B-on must restore the overlay above the sibling mpv video host after native flags change'
  );
  const repaintIndices = events
    .map(([name], index) => (name === 'webContents.invalidate' ? index : -1))
    .filter(index => index >= 0);
  assert.ok(repaintIndices.length >= 2, '활성화 시퀀스는 강제 재합성을 두 번 이상 예약해야 한다');
  assert.ok(
    repaintIndices[repaintIndices.length - 1] > moveTopIndex,
    '창 순서 복원 뒤에도 재합성이 한 번 더 강제되어야 한다'
  );
});

test('relays keyboard input through the focused main renderer and restores main focus on disable', async () => {
  const { host, events, windows } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-keyboard-relay',
      stableVideoIdentity: 'video-keyboard-relay',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;

  let prevented = false;
  windows[0].webContents.emit('before-input-event', {
    preventDefault: () => {
      prevented = true;
    }
  }, {
    type: 'keyDown',
    key: 'b',
    code: 'KeyB',
    shift: false,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false
  });

  assert.equal(prevented, true);
  assert.deepEqual(events, [
    ['mainWindow.focus'],
    ['mainWindow.send', 'mpv-overlay:keyboard-input', {
      type: 'keyDown',
      key: 'b',
      code: 'KeyB',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    }],
    ['overlay.focus']
  ]);
  const relayDiagnostics = await host.getDrawingDiagnostics();
  assert.equal(relayDiagnostics.keyboardRelayCount, 1);
  assert.equal(relayDiagnostics.lastKeyboardRelayCode, 'KeyB');

  events.length = 0;
  windows[0].focused = true;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 3,
    enabled: false
  }));
  const ignoreIndex = events.findIndex(([name, value]) =>
    name === 'setIgnoreMouseEvents' && value === true);
  const mainFocusIndex = events.findIndex(([name]) => name === 'mainWindow.focus');
  const focusableDisableIndex = events.findIndex(([name, value]) =>
    name === 'setFocusable' && value === false);
  const runtimeDisableIndex = events.findIndex(([name, value]) =>
    name === 'executeJavaScript' &&
    value.includes?.('.setDrawingInput(') &&
    value.includes('"enabled":false'));
  const moveTopAfterRuntimeDisableIndex = events.findIndex(
    ([name], index) => name === 'moveTop' && index > runtimeDisableIndex
  );
  const repaintAfterRuntimeDisableIndex = events.findIndex(
    ([name], index) => name === 'webContents.invalidate' && index > runtimeDisableIndex
  );
  assert.ok(ignoreIndex >= 0);
  assert.ok(focusableDisableIndex > ignoreIndex);
  assert.ok(mainFocusIndex > focusableDisableIndex);
  assert.ok(runtimeDisableIndex > focusableDisableIndex);
  assert.ok(
    moveTopAfterRuntimeDisableIndex > runtimeDisableIndex,
    'B-off must restore the passive drawing overlay above the sibling mpv video host'
  );
  assert.ok(
    repaintAfterRuntimeDisableIndex > moveTopAfterRuntimeDisableIndex,
    'B-off must present the Fabric repaint after restoring the native window order'
  );
});

test('V Delete Space and repeat relay keep the active drawing overlay focused', async () => {
  const { host, events, windows, mainWindow } = createDrawingHostHarness();
  await activateDrawingHost({ host, events, windows, mainWindow }, {
    sessionId: 'session-toolbar-focus-relay'
  });
  windows[0].focused = true;
  mainWindow.focused = false;
  events.length = 0;

  const emit = input => {
    let prevented = false;
    windows[0].webContents.emit('before-input-event', {
      preventDefault() {
        prevented = true;
      }
    }, {
      type: 'keyDown',
      key: '',
      code: '',
      shift: false,
      control: false,
      alt: false,
      meta: false,
      isAutoRepeat: false,
      ...input
    });
    assert.equal(prevented, true);
  };

  emit({ key: 'v', code: 'KeyV' });
  emit({ key: 'v', code: 'KeyV', isAutoRepeat: true });
  emit({ key: 'Delete', code: 'Delete' });
  emit({ key: ' ', code: 'Space' });
  emit({ type: 'keyUp', key: 'v', code: 'KeyV' });
  emit({ key: 'b', code: 'KeyB', isAutoRepeat: true });
  emit({ type: 'keyUp', key: 'b', code: 'KeyB' });

  assert.equal(
    events.filter(([name]) => name === 'mainWindow.send').length,
    7
  );
  assert.equal(
    events.some(([name]) => name === 'mainWindow.focus'),
    false,
    'non-toggle relay must not turn the next toolbar click into a window activation click'
  );
  assert.equal(windows[0].focused, true);
  assert.equal(mainWindow.focused, false);
});

test('disabling a focused overlay completes main focus handoff without B pre-focus', async () => {
  const harness = createDrawingHostHarness({
    simulateFocusableDisableDeactivation: true
  });
  const tokens = await activateDrawingHost(harness, {
    sessionId: 'session-custom-toggle-focus-handoff'
  });
  harness.windows[0].focused = true;
  harness.mainWindow.focused = false;
  harness.events.length = 0;

  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: tokens.videoGeneration,
    inputRevision: tokens.inputRevision + 1,
    enabled: false
  }));

  const focusableDisableIndex = harness.events.findIndex(([name, value]) =>
    name === 'setFocusable' && value === false);
  const mainFocusIndex = harness.events.findIndex(([name]) =>
    name === 'mainWindow.focus');
  const mainWebContentsFocusIndex = harness.events.findIndex(([name]) =>
    name === 'mainWindow.webContents.focus');
  assert.ok(focusableDisableIndex >= 0);
  assert.ok(mainFocusIndex > focusableDisableIndex);
  assert.ok(mainWebContentsFocusIndex > mainFocusIndex);
  assert.equal(harness.mainWindow.focused, true);
});

test('completes the main-window focus handoff when relayed B disables a focused drawing overlay', async () => {
  const { host, events, windows, mainWindow } = createDrawingHostHarness({
    simulateFocusableDisableDeactivation: true
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-focus-handoff-race',
      stableVideoIdentity: 'video-focus-handoff-race',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));

  // A pointer interaction gives the native overlay keyboard focus. Relaying B keeps
  // that focus until disable so the host can complete one deterministic handoff.
  windows[0].focused = true;
  windows[0].webContents.emit('before-input-event', { preventDefault() {} }, {
    type: 'keyDown',
    key: 'b',
    code: 'KeyB',
    shift: false,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false
  });
  windows[0].focused = false;
  events.length = 0;

  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 3,
    enabled: false
  }));

  const focusableDisableIndex = events.findIndex(([name, value]) =>
    name === 'setFocusable' && value === false);
  const finalMainFocusIndex = events.findIndex(([name]) => name === 'mainWindow.focus');
  const finalMainWebContentsFocusIndex = events.findIndex(([name]) =>
    name === 'mainWindow.webContents.focus');
  assert.ok(focusableDisableIndex >= 0);
  assert.ok(finalMainFocusIndex > focusableDisableIndex,
    'the B-triggered handoff must finish after the drawing overlay becomes non-focusable');
  assert.ok(finalMainWebContentsFocusIndex > finalMainFocusIndex,
    'keyboard input must return to the main renderer after the native focus handoff');
  assert.equal(mainWindow.focused, true);
});

test('canonicalizes overlay keys, drops IME composition, and never steals focus after Alt-Tab', async () => {
  const { host, events, windows, mainWindow } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-canonical-keys',
      stableVideoIdentity: 'video-canonical-keys',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;

  const emitKey = input => {
    let prevented = false;
    windows[0].webContents.emit('before-input-event', {
      preventDefault: () => {
        prevented = true;
      }
    }, {
      type: 'keyDown',
      shift: false,
      control: false,
      alt: false,
      meta: false,
      ...input
    });
    return prevented;
  };

  assert.equal(emitKey({ key: ' ', code: 'Space' }), true);
  assert.equal(emitKey({ key: 'ArrowLeft', code: 'ArrowLeft' }), true);
  const eventCountBeforeComposition = events.length;
  assert.equal(emitKey({ key: 'Process', code: 'KeyR', isComposing: true }), false);
  assert.equal(emitKey({ key: 'Dead', code: 'Quote' }), false);
  assert.equal(events.length, eventCountBeforeComposition);
  assert.deepEqual(events.filter(([name]) => name === 'mainWindow.send'), [
    ['mainWindow.send', 'mpv-overlay:keyboard-input', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    }],
    ['mainWindow.send', 'mpv-overlay:keyboard-input', {
      type: 'keyDown',
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    }]
  ]);

  events.length = 0;
  windows[0].focused = false;
  mainWindow.focused = false;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 3,
    enabled: false
  }));
  assert.equal(events.some(([name]) => name === 'mainWindow.focus'), false);
  assert.equal(events.some(([name, value]) => name === 'setFocusable' && value === false), true);
});

test('relays exact validated physical key codes including Enter Tab and Numpad keys', async () => {
  const harness = createDrawingHostHarness();
  await activateDrawingHost(harness, {
    videoGeneration: 11,
    sessionId: 'session-physical-key-relay'
  });
  const overlay = harness.windows[0];
  harness.events.length = 0;

  const emit = input => {
    let prevented = false;
    overlay.webContents.emit('before-input-event', {
      preventDefault() {
        prevented = true;
      }
    }, {
      type: 'keyDown',
      key: '',
      code: '',
      shift: false,
      control: false,
      alt: false,
      meta: false,
      isAutoRepeat: false,
      ...input
    });
    return prevented;
  };

  assert.equal(emit({ key: 'ㅂ', code: 'KeyQ' }), true);
  assert.equal(emit({ key: 'Enter', code: 'Enter' }), true);
  assert.equal(emit({ key: 'Tab', code: 'Tab', shift: true }), true);
  assert.equal(emit({ key: '1', code: 'Numpad1' }), true);
  assert.equal(emit({ key: 'Enter', code: 'NumpadEnter' }), true);

  const payloads = harness.events
    .filter(([name, channel]) =>
      name === 'mainWindow.send' && channel === 'mpv-overlay:keyboard-input')
    .map(([, , payload]) => payload);
  assert.deepEqual(payloads, [
    {
      type: 'keyDown',
      key: 'ㅂ',
      code: 'KeyQ',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    },
    {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    },
    {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    },
    {
      type: 'keyDown',
      key: '1',
      code: 'Numpad1',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    },
    {
      type: 'keyDown',
      key: 'Enter',
      code: 'NumpadEnter',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      repeat: false
    }
  ]);
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.sendInputEvent'), false);
});

test('overlay physical key relay rejects malformed and composing input without focusing main', async () => {
  const harness = createDrawingHostHarness();
  await activateDrawingHost(harness, {
    videoGeneration: 12,
    sessionId: 'session-physical-key-validation'
  });
  const overlay = harness.windows[0];
  harness.events.length = 0;

  const invalidInputs = [
    { type: 'char', key: 'b', code: 'KeyB' },
    { type: 'keyDown', key: 'b', code: 'InjectedCode' },
    { type: 'keyDown', key: 'x'.repeat(65), code: 'KeyX' },
    { type: 'keyDown', key: 'Process', code: 'KeyB' },
    { type: 'keyDown', key: 'Dead', code: 'Quote' },
    { type: 'keyDown', key: 'b', code: 'KeyB', isComposing: true },
    { type: 'keyDown', key: 'b', code: 'KeyB', shift: 'yes' }
  ];
  for (const input of invalidInputs) {
    let prevented = false;
    overlay.webContents.emit('before-input-event', {
      preventDefault() {
        prevented = true;
      }
    }, {
      shift: false,
      control: false,
      alt: false,
      meta: false,
      isAutoRepeat: false,
      ...input
    });
    assert.equal(prevented, false);
  }

  assert.equal(harness.events.some(([name]) => name === 'mainWindow.send'), false);
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.sendInputEvent'), false);
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.focus'), false);
});

test('overlay history shortcuts relay once to the main renderer without host-side history execution', async () => {
  const harness = createDrawingHostHarness();
  await activateDrawingHost(harness, {
    videoGeneration: 12,
    sessionId: 'session-overlay-history'
  });
  const overlay = harness.windows[0];
  harness.events.length = 0;

  const emit = input => {
    let prevented = false;
    overlay.webContents.emit('before-input-event', {
      preventDefault() {
        prevented = true;
      }
    }, {
      type: 'keyDown',
      key: 'z',
      code: 'KeyZ',
      shift: false,
      control: false,
      alt: false,
      meta: false,
      isAutoRepeat: false,
      ...input
    });
    return prevented;
  };

  assert.equal(emit({ control: true }), true);
  assert.deepEqual(harness.events.filter(([name, channel]) =>
    name === 'mainWindow.send' && channel === 'mpv-overlay:keyboard-input')
    .map(([, , input]) => input.code), ['KeyZ'],
  'the physical history key must relay synchronously to the renderer');
  assert.equal(emit({
    control: false,
    isAutoRepeat: true
  }), true, 'repeat remains suppressed after the modifier is released');
  assert.equal(emit({
    type: 'keyUp',
    control: false
  }), true, 'keyup remains suppressed after the modifier is released');
  assert.equal(emit({ meta: true }), true);
  assert.equal(emit({ key: 'y', code: 'KeyY', control: true }), true);
  assert.equal(emit({ control: true, shift: true }), true);
  assert.equal(emit({ control: true, isAutoRepeat: true }), true);
  const relayedInputs = harness.events
    .filter(([name, channel]) =>
      name === 'mainWindow.send' && channel === 'mpv-overlay:keyboard-input')
    .map(([, , input]) => input);
  assert.deepEqual(relayedInputs.map(input => input.code), ['KeyZ', 'KeyZ', 'KeyY', 'KeyZ']);
  assert.equal(harness.events.some(([name, script]) =>
    name === 'executeJavaScript' && script.includes?.('.applyDrawingAction(')), false);
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.sendInputEvent'), false);
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.focus'), false);
});

test('overlay history routing leaves invalid combinations and Electron IME input alone', async () => {
  const harness = createDrawingHostHarness();
  await activateDrawingHost(harness, {
    videoGeneration: 13,
    sessionId: 'session-overlay-invalid-history'
  });
  const overlay = harness.windows[0];
  harness.events.length = 0;

  const emit = input => {
    let prevented = false;
    overlay.webContents.emit('before-input-event', {
      preventDefault() {
        prevented = true;
      }
    }, {
      type: 'keyDown',
      key: 'z',
      code: 'KeyZ',
      shift: false,
      control: false,
      alt: false,
      meta: false,
      isAutoRepeat: false,
      ...input
    });
    return prevented;
  };

  const forwarded = [
    { key: 'z', code: 'KeyZ' },
    { key: 'y', code: 'KeyY' },
    { key: 'z', code: 'KeyZ', control: true, alt: true },
    { key: 'z', code: 'KeyZ', control: true, meta: true },
    { key: 'y', code: 'KeyY', control: true, shift: true },
    { key: 'c', code: 'KeyC', control: true },
    { key: 'v', code: 'KeyV', control: true }
  ];
  for (const input of forwarded) assert.equal(emit(input), true);

  const eventCount = harness.events.length;
  assert.equal(emit({ key: 'z', code: 'KeyZ', control: true, isComposing: true }), false);
  assert.equal(emit({ key: 'Process', code: 'KeyZ', control: true }), false);
  assert.equal(emit({ key: 'Dead', code: 'KeyZ', control: true }), false);
  assert.equal(harness.events.length, eventCount);
  await waitForAsyncReposition();

  assert.equal(harness.events.some(([name, script]) =>
    name === 'executeJavaScript' && script.includes?.('.applyDrawingAction(')), false);
  assert.equal(harness.events.filter(([name]) => name === 'mainWindow.send').length, 7);
});

test('overlay history relay bypasses an in-flight controller-origin host queue', async () => {
  const firstAttempt = createDeferred();
  const actionOrder = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      const request = readFabricMethodPayload(script, 'applyDrawingAction');
      actionOrder.push(request.action);
      if (actionOrder.length === 1) return firstAttempt.promise;
      return { applied: true, deletedCount: 0 };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 14,
    sessionId: 'session-mixed-action-queue'
  });

  const controllerAction = harness.host.applyDrawingAction({
    ...tokens,
    action: 'undo',
    actionId: 'controller-origin-undo'
  });
  let overlayPrevented = false;
  harness.windows[0].webContents.emit('before-input-event', {
    preventDefault() {
      overlayPrevented = true;
    }
  }, {
    type: 'keyDown',
    key: 'y',
    code: 'KeyY',
    shift: false,
    control: true,
    alt: false,
    meta: false,
    isAutoRepeat: false
  });
  assert.equal(overlayPrevented, true);
  assert.deepEqual(harness.events
    .filter(([name, channel]) =>
      name === 'mainWindow.send' && channel === 'mpv-overlay:keyboard-input')
    .map(([, , input]) => input.code), ['KeyY']);
  await waitForAsyncReposition();
  assert.deepEqual(actionOrder, ['undo']);

  firstAttempt.resolve({ applied: true, deletedCount: 0 });
  assert.equal((await controllerAction).success, true);
  await waitForAsyncReposition();
  assert.deepEqual(actionOrder, ['undo']);
});

test('overlay keeps forwarding B V Delete and Space through the main renderer route', async () => {
  const harness = createDrawingHostHarness();
  await activateDrawingHost(harness, {
    videoGeneration: 15,
    sessionId: 'session-overlay-forwarding-regression'
  });
  harness.events.length = 0;

  for (const input of [
    { key: 'b', code: 'KeyB' },
    { key: 'v', code: 'KeyV' },
    { key: 'Delete', code: 'Delete' },
    { key: ' ', code: 'Space' }
  ]) {
    harness.windows[0].webContents.emit('before-input-event', { preventDefault() {} }, {
      type: 'keyDown',
      shift: false,
      control: false,
      alt: false,
      meta: false,
      isAutoRepeat: false,
      ...input
    });
  }

  assert.deepEqual(harness.events
    .filter(([name, channel]) =>
      name === 'mainWindow.send' && channel === 'mpv-overlay:keyboard-input')
    .map(([, , input]) => input.code), ['KeyB', 'KeyV', 'Delete', 'Space']);
});

test('overlay history keyup suppression is cleared when drawing input is disabled', async () => {
  const harness = createDrawingHostHarness();
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 16,
    sessionId: 'session-overlay-keyup-lifecycle'
  });
  const overlay = harness.windows[0];
  overlay.webContents.emit('before-input-event', { preventDefault() {} }, {
    type: 'keyDown',
    key: 'z',
    code: 'KeyZ',
    shift: false,
    control: true,
    alt: false,
    meta: false,
    isAutoRepeat: true
  });
  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: tokens.videoGeneration,
    inputRevision: tokens.inputRevision + 1,
    enabled: false
  }));
  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: tokens.videoGeneration,
    inputRevision: tokens.inputRevision + 2,
    enabled: true,
    session: {
      sessionId: 'session-overlay-keyup-lifecycle-next',
      stableVideoIdentity: 'video-overlay-keyup-lifecycle',
      targetFrame: 25,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'select'
    }
  }));
  harness.events.length = 0;

  let prevented = false;
  overlay.webContents.emit('before-input-event', {
    preventDefault() {
      prevented = true;
    }
  }, {
    type: 'keyUp',
    key: 'z',
    code: 'KeyZ',
    shift: false,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false
  });

  assert.equal(prevented, true, 'the ordinary keyup is forwarded and consumed by the relay');
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.send'), true,
    'an old suppressed key must not leak into a new drawing session');
});

test('leaves the original overlay key untouched when forwarding fails', async () => {
  const { host, events, windows } = createDrawingHostHarness({
    sendError: new Error('synthetic forwarding failure')
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-forwarding-failure',
      stableVideoIdentity: 'video-forwarding-failure',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;
  let prevented = false;

  assert.doesNotThrow(() => windows[0].webContents.emit('before-input-event', {
    preventDefault: () => {
      prevented = true;
    }
  }, { type: 'keyDown', key: 'v', code: 'KeyV' }));
  assert.equal(prevented, false);
  assert.equal(events.some(([name]) => name === 'mainWindow.send'), true);

  events.length = 0;
  prevented = false;
  windows[0].focused = true;
  assert.doesNotThrow(() => windows[0].webContents.emit('before-input-event', {
    preventDefault: () => {
      prevented = true;
    }
  }, {
    type: 'keyDown',
    key: 'b',
    code: 'KeyB',
    shift: false,
    control: false,
    alt: false,
    meta: false,
    isAutoRepeat: false
  }));
  assert.equal(prevented, false);
  assert.deepEqual(events.map(([name]) => name), [
    'mainWindow.focus',
    'mainWindow.send',
    'overlay.focus'
  ]);
  assert.equal(windows[0].focused, true);
});

test('rejects stale host video input session and tool revisions at the host boundary', async () => {
  const { host, events } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  const session = {
    sessionId: 'session-current',
    stableVideoIdentity: 'video-current',
    targetFrame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { left: 0, top: 0, width: 640, height: 360 },
    tool: 'brush'
  };

  assert.equal((await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 10
  }))).success, true);
  assert.equal((await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 6,
    inputRevision: 11,
    enabled: true,
    session
  }))).success, false, 'a larger video generation cannot arrive through enable');
  assert.equal((await host.setDrawingInput(makeDrawingInput(hostGeneration - 1, {
    videoGeneration: 5,
    inputRevision: 11,
    enabled: true,
    session
  }))).success, false);

  assert.equal((await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 11,
    enabled: true,
    session
  }))).success, true);

  const currentTool = {
    hostGeneration,
    videoGeneration: 5,
    inputRevision: 11,
    sessionId: 'session-current',
    toolRevision: 1,
    tool: 'select'
  };
  assert.equal((await host.updateDrawingTool({ ...currentTool, hostGeneration: hostGeneration - 1 })).success, false);
  assert.equal((await host.updateDrawingTool({ ...currentTool, videoGeneration: 4 })).success, false);
  assert.equal((await host.updateDrawingTool({ ...currentTool, inputRevision: 10 })).success, false);
  assert.equal((await host.updateDrawingTool({ ...currentTool, sessionId: 'session-stale' })).success, false);
  assert.equal((await host.updateDrawingTool(currentTool)).success, true);
  assert.equal((await host.updateDrawingTool({ ...currentTool, toolRevision: 1, tool: 'brush' })).success, false);
  assert.equal(
    events.filter(([name]) => name === 'overlay.focus').length,
    1,
    'only the accepted V tool change restores overlay focus for the next toolbar click'
  );
});

test('stale disable requests cannot close native input owned by the current active session', async () => {
  const { host, events } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 10
  }));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 11,
    enabled: true,
    session: {
      sessionId: 'session-native-input-owner',
      stableVideoIdentity: 'video-native-input-owner',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;

  const staleHost = await host.setDrawingInput(makeDrawingInput(hostGeneration - 1, {
    videoGeneration: 5,
    inputRevision: 12
  }));
  const staleVideo = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 4,
    inputRevision: 12
  }));
  const staleRevision = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 5,
    inputRevision: 11
  }));

  assert.equal(staleHost.accepted, false);
  assert.equal(staleVideo.accepted, false);
  assert.equal(staleRevision.accepted, false);
  assert.equal(
    events.some(([name]) => name === 'setIgnoreMouseEvents'),
    false,
    'rejected disables must not change the native click-through state'
  );
});

test('deduplicates drawing actions and allowlists lightweight host responses', async () => {
  const { host, events } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  const input = makeDrawingInput(hostGeneration, { videoGeneration: 3, inputRevision: 1 });
  assert.equal((await host.setDrawingInput(input)).success, true);
  assert.equal((await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 3,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-actions',
      stableVideoIdentity: 'video-actions',
      targetFrame: 42,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'select'
    }
  }))).success, true);

  const action = {
    hostGeneration,
    videoGeneration: 3,
    inputRevision: 2,
    sessionId: 'session-actions',
    actionId: 'action-delete-1',
    action: 'delete-selection'
  };
  const first = await host.applyDrawingAction(action);
  const duplicate = await host.applyDrawingAction(action);
  assert.deepEqual(first, { success: true, applied: true, duplicate: false, deletedCount: 1 });
  assert.deepEqual(duplicate, { success: true, applied: false, duplicate: true, deletedCount: 0 });
  assert.equal(
    events.filter(([name, value]) => name === 'executeJavaScript' && value.includes?.('.applyDrawingAction(')).length,
    1
  );
  assert.doesNotMatch(JSON.stringify(first), /deletedIds|objects|scene|fabric/i);

  const diagnostics = await host.getDrawingDiagnostics();
  assert.equal(diagnostics.success, true);
  assert.equal(diagnostics.hostGeneration, hostGeneration);
  assert.equal(diagnostics.videoGeneration, 3);
  assert.equal(diagnostics.inputRevision, 2);
  assert.equal(diagnostics.activeSessionId, 'session-actions');
  assert.equal(diagnostics.objectCount, 1);
  assert.equal(diagnostics.selectionTarget, 'partial');
  assert.equal(diagnostics.selectionShape, 'lasso');
  assert.equal(diagnostics.selectionControlEventCount, 4);
  assert.deepEqual(diagnostics.lastSelectionControlAction, {
    kind: 'shape',
    value: 'lasso',
    source: 'pointerdown',
    eventCount: 4
  });
  assert.deepEqual(diagnostics.lastSelectionGesture, {
    target: 'partial',
    shape: 'lasso',
    pointerPointCount: 7,
    polygonPointCount: 5,
    polygonBounds: { left: 10, right: 110, top: 20, bottom: 120 },
    pending: true,
    applied: false,
    selectedCount: 2,
    reason: null
  });
  assert.equal(diagnostics.undoDepth, 2);
  assert.equal(diagnostics.redoDepth, 1);
  assert.equal(diagnostics.historyBytes, 1024);
  assert.deepEqual(diagnostics.cache, {
    videoCount: 1,
    sceneCount: 1,
    estimatedBytes: 512,
    evictionCount: 0
  });
  assert.doesNotMatch(JSON.stringify(diagnostics),
    /fabricJSON|objects|scene\s*:|deletedIds|undoBytes|undoState|command/i);
});

test('drawing action response forwards history-empty reason', async () => {
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      return { applied: false, reason: 'history-empty' };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 8,
    sessionId: 'session-history-empty-response'
  });
  const result = await harness.host.applyDrawingAction({
    ...tokens,
    action: 'undo',
    actionId: 'history-empty-response-1'
  });

  assert.equal(result.reason, 'history-empty');
  assert.equal(result.success, false);
});

test('drawing actions preserve the controller-captured target frame through the host queue', async () => {
  const payloads = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      payloads.push(readFabricMethodPayload(script, 'applyDrawingAction'));
      return { applied: true, deletedCount: 1 };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 8,
    sessionId: 'session-captured-action-frame'
  });
  assert.equal((await harness.host.applyDrawingAction({
    ...tokens,
    action: 'delete-selection',
    actionId: 'captured-action-frame-1',
    targetFrame: 42
  })).applied, true);
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].targetFrame, 42);
});

test('overlay history relay does not await or invoke host Fabric history', async () => {
  const delayedHistory = createDeferred();
  let hostHistoryCallCount = 0;
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      hostHistoryCallCount += 1;
      return delayedHistory.promise;
    }
  });
  await activateDrawingHost(harness, {
    videoGeneration: 8,
    sessionId: 'session-history-single-owner'
  });
  harness.events.length = 0;

  harness.windows[0].webContents.emit('before-input-event', {
    preventDefault() {}
  }, {
    type: 'keyDown',
    key: 'z',
    code: 'KeyZ',
    shift: false,
    control: true,
    alt: false,
    meta: false,
    isAutoRepeat: false
  });

  const relayedInputs = harness.events.filter(([name, channel]) =>
    name === 'mainWindow.send' && channel === 'mpv-overlay:keyboard-input');
  assert.equal(relayedInputs.length, 1);
  assert.equal(relayedInputs[0][2].code, 'KeyZ');
  assert.equal(hostHistoryCallCount, 0);
  delayedHistory.resolve({ applied: true });
});

test('allowlists undo and redo while rejecting unknown drawing actions', async () => {
  const harness = createDrawingHostHarness();
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 9,
    sessionId: 'session-history-allowlist'
  });
  const makeAction = (action, actionId) => ({ ...tokens, action, actionId });

  assert.deepEqual(await harness.host.applyDrawingAction(makeAction('undo', 'history-undo-1')), {
    success: true,
    applied: true,
    duplicate: false,
    deletedCount: 1
  });
  assert.deepEqual(await harness.host.applyDrawingAction(makeAction('redo', 'history-redo-1')), {
    success: true,
    applied: true,
    duplicate: false,
    deletedCount: 1
  });
  assert.deepEqual(await harness.host.applyDrawingAction(makeAction('export-scene', 'unknown-1')), {
    success: false,
    applied: false,
    error: 'stale or invalid drawing action request'
  });
  const payloads = harness.events
    .filter(([name, script]) => name === 'executeJavaScript' && script.includes?.('.applyDrawingAction('))
    .map(([, script]) => readFabricMethodPayload(script, 'applyDrawingAction'));
  assert.deepEqual(payloads.map(payload => payload.action), ['undo', 'redo']);
});

test('serializes different actions and continues after the first action fails', async () => {
  const firstAttempt = createDeferred();
  const actionOrder = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      const request = readFabricMethodPayload(script, 'applyDrawingAction');
      actionOrder.push(request.action);
      if (actionOrder.length === 1) return firstAttempt.promise;
      return { applied: true, deletedCount: 0 };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 10,
    sessionId: 'session-serialized-actions'
  });
  const first = harness.host.applyDrawingAction({
    ...tokens,
    action: 'undo',
    actionId: 'serialized-undo'
  });
  const second = harness.host.applyDrawingAction({
    ...tokens,
    action: 'redo',
    actionId: 'serialized-redo'
  });
  await waitForAsyncReposition();
  assert.deepEqual(actionOrder, ['undo']);

  firstAttempt.reject(new Error('synthetic queued failure'));
  assert.deepEqual(await first, {
    success: false,
    applied: false,
    error: 'synthetic queued failure'
  });
  assert.deepEqual(await second, {
    success: true,
    applied: true,
    duplicate: false,
    deletedCount: 0
  });
  assert.deepEqual(actionOrder, ['undo', 'redo']);
});

test('revalidates queued action tokens before runtime execution', async () => {
  const firstAttempt = createDeferred();
  const actionPayloads = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      const request = readFabricMethodPayload(script, 'applyDrawingAction');
      actionPayloads.push(request);
      if (actionPayloads.length === 1) return firstAttempt.promise;
      return { applied: true, deletedCount: 0 };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 11,
    sessionId: 'session-stale-queued-action'
  });
  const first = harness.host.applyDrawingAction({
    ...tokens,
    action: 'undo',
    actionId: 'stale-first'
  });
  const staleQueued = harness.host.applyDrawingAction({
    ...tokens,
    action: 'redo',
    actionId: 'stale-second'
  });
  await waitForAsyncReposition();
  assert.equal(actionPayloads.length, 1);

  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: tokens.videoGeneration,
    inputRevision: tokens.inputRevision + 1,
    enabled: false
  }));
  firstAttempt.resolve({ applied: true, deletedCount: 0 });
  assert.equal((await first).success, false, 'the in-flight response also becomes stale');
  assert.deepEqual(await staleQueued, {
    success: false,
    applied: false,
    error: 'stale drawing action request'
  });
  assert.equal(actionPayloads.length, 1,
    'a queued stale action must not reach the Fabric runtime');
});

test('revalidates the host window and Fabric generation before queued execution', async () => {
  const firstAttempt = createDeferred();
  let runtimeActionCount = 0;
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      runtimeActionCount += 1;
      if (runtimeActionCount === 1) return firstAttempt.promise;
      return { applied: true, deletedCount: 0 };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 17,
    sessionId: 'session-stale-window-action'
  });
  const first = harness.host.applyDrawingAction({
    ...tokens,
    action: 'undo',
    actionId: 'stale-window-first'
  });
  const staleQueued = harness.host.applyDrawingAction({
    ...tokens,
    action: 'redo',
    actionId: 'stale-window-second'
  });
  await waitForAsyncReposition();
  assert.equal(runtimeActionCount, 1);

  harness.host.destroy();
  const recovered = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  assert.equal(recovered.drawingCapability.hostGeneration, tokens.hostGeneration + 1);
  firstAttempt.resolve({ applied: true, deletedCount: 0 });

  assert.equal((await first).success, false);
  assert.deepEqual(await staleQueued, {
    success: false,
    applied: false,
    error: 'stale drawing action request'
  });
  assert.equal(runtimeActionCount, 1);
});

test('a recovered host generation is not blocked by the previous generation queue tail', async () => {
  const oldAttempt = createDeferred();
  const actionPayloads = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      const request = readFabricMethodPayload(script, 'applyDrawingAction');
      actionPayloads.push(request);
      if (actionPayloads.length === 1) return oldAttempt.promise;
      return { applied: true, deletedCount: 0 };
    }
  });
  const oldTokens = await activateDrawingHost(harness, {
    videoGeneration: 19,
    sessionId: 'session-old-generation-queue'
  });
  const oldAction = harness.host.applyDrawingAction({
    ...oldTokens,
    action: 'undo',
    actionId: 'old-generation-action'
  });
  await waitForAsyncReposition();
  assert.equal(actionPayloads.length, 1);

  harness.host.destroy();
  const freshTokens = await activateDrawingHost(harness, {
    videoGeneration: 20,
    sessionId: 'session-fresh-generation-queue'
  });
  const freshAction = harness.host.applyDrawingAction({
    ...freshTokens,
    action: 'redo',
    actionId: 'fresh-generation-action'
  });
  await waitForAsyncReposition();
  assert.equal(actionPayloads.length, 2,
    'the new generation must not wait for an abandoned old-window action');
  assert.equal((await freshAction).success, true);

  oldAttempt.resolve({ applied: true, deletedCount: 0 });
  assert.equal((await oldAction).success, false);
});

test('bounds history diagnostics to finite nonnegative integers', async () => {
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.getDiagnostics(')) return undefined;
      return {
        state: 'active',
        prepared: true,
        inputEnabled: true,
        undoDepth: -4,
        redoDepth: Number.POSITIVE_INFINITY,
        historyBytes: Number.NaN,
        undoBytes: 999,
        scene: { objects: ['must-not-leak'] }
      };
    }
  });
  await activateDrawingHost(harness, {
    videoGeneration: 18,
    sessionId: 'session-bounded-history-diagnostics'
  });

  const diagnostics = await harness.host.getDrawingDiagnostics();
  assert.equal(diagnostics.undoDepth, 0);
  assert.equal(diagnostics.redoDepth, 0);
  assert.equal(diagnostics.historyBytes, 0);
  assert.doesNotMatch(JSON.stringify(diagnostics),
    /"(?:undoBytes|scene|objects)"|must-not-leak/i);
});

test('disable responses expose only the normalized local tool for controller continuity', async () => {
  const { host } = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.setDrawingInput(') && script.includes('"enabled":false')) {
        return { accepted: true, enabled: false, tool: 'select', scene: { mustNotLeak: true } };
      }
      return undefined;
    }
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 1,
    inputRevision: 1
  }));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 1,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-tool-continuity',
      stableVideoIdentity: 'video-tool-continuity',
      targetFrame: 1,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  const disabled = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 1,
    inputRevision: 3
  }));

  assert.deepEqual(disabled, {
    success: true,
    accepted: true,
    enabled: false,
    restored: false,
    tool: 'select'
  });
});

test('shares an in-flight action failure and keeps the action ID retryable until success', async () => {
  const firstAttempt = createDeferred();
  const retryAttempt = createDeferred();
  let actionCallCount = 0;
  const { host } = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.applyDrawingAction(')) return undefined;
      actionCallCount += 1;
      return actionCallCount === 1 ? firstAttempt.promise : retryAttempt.promise;
    }
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, { videoGeneration: 4, inputRevision: 1 }));
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 4,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-action-retry',
      stableVideoIdentity: 'video-action-retry',
      targetFrame: 4,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'select'
    }
  }));
  const action = {
    hostGeneration,
    videoGeneration: 4,
    inputRevision: 2,
    sessionId: 'session-action-retry',
    actionId: 'action-retry-after-failure',
    action: 'clear-session'
  };

  const first = host.applyDrawingAction(action);
  const inFlightDuplicate = host.applyDrawingAction(action);
  let duplicateSettled = false;
  inFlightDuplicate.finally(() => { duplicateSettled = true; });
  await waitForAsyncReposition();
  assert.equal(actionCallCount, 1);
  assert.equal(duplicateSettled, false);

  firstAttempt.reject(new Error('transient action failure'));
  const [firstFailure, duplicateFailure] = await Promise.all([first, inFlightDuplicate]);
  assert.deepEqual(firstFailure, { success: false, applied: false, error: 'transient action failure' });
  assert.deepEqual(duplicateFailure, firstFailure);

  const retry = host.applyDrawingAction(action);
  await waitForAsyncReposition();
  assert.equal(actionCallCount, 2);
  retryAttempt.resolve({ applied: true, deletedCount: 2 });
  assert.deepEqual(await retry, { success: true, applied: true, duplicate: false, deletedCount: 2 });
  assert.deepEqual(await host.applyDrawingAction(action), {
    success: true,
    applied: false,
    duplicate: true,
    deletedCount: 0
  });
  assert.equal(actionCallCount, 2);
});

test('a later disable keeps click-through when an older enable finishes late', async () => {
  const lateEnable = createDeferred();
  const runtimeRequests = [];
  let runtimeEnabled = false;
  const { host, events } = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.setDrawingInput(')) return undefined;
      const request = readFabricMethodPayload(script, 'setDrawingInput');
      const duplicateDisable = !request.enabled && runtimeRequests.some(previous => (
        !previous.enabled &&
        previous.hostGeneration === request.hostGeneration &&
        previous.videoGeneration === request.videoGeneration &&
        previous.inputRevision === request.inputRevision
      ));
      runtimeRequests.push(request);
      if (request.enabled) {
        return lateEnable.promise.then((result) => {
          runtimeEnabled = true;
          return result;
        });
      }
      runtimeEnabled = false;
      return { accepted: !duplicateDisable, enabled: false };
    }
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, { videoGeneration: 8, inputRevision: 1 }));

  const pendingEnable = host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 8,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-late',
      stableVideoIdentity: 'video-late',
      targetFrame: 8,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  await waitForAsyncReposition();

  const disableEventIndex = events.length;
  const disabling = host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 8,
    inputRevision: 3
  }));
  assert.deepEqual(events[disableEventIndex], ['setIgnoreMouseEvents', true, undefined]);
  assert.equal((await disabling).success, true);

  lateEnable.resolve({ accepted: true, enabled: true });
  assert.equal((await pendingEnable).success, false);
  assert.equal(
    events.slice(disableEventIndex).some(([name, value]) => name === 'setIgnoreMouseEvents' && value === false),
    false
  );
  assert.equal(runtimeEnabled, false, 'a compensating runtime disable closes a stale late activation');
  assert.deepEqual(runtimeRequests.at(-1), {
    hostGeneration,
    videoGeneration: 8,
    inputRevision: 3,
    enabled: false
  });
  const compensationDisableIndex = events
    .map(([name, value], index) => (
      name === 'executeJavaScript' &&
      value.includes?.('.setDrawingInput(') &&
      value.includes('"enabled":false')
        ? index
        : -1
    ))
    .filter(index => index >= 0)
    .at(-1);
  const compensationMoveTopIndex = events.findIndex(
    ([name], index) => name === 'moveTop' && index > compensationDisableIndex
  );
  const compensationRepaintIndex = events.findIndex(
    ([name], index) => name === 'webContents.invalidate' && index > compensationMoveTopIndex
  );
  assert.ok(
    compensationMoveTopIndex > compensationDisableIndex,
    'stale enable compensation must restore the passive overlay above the video host'
  );
  assert.ok(
    compensationRepaintIndex > compensationMoveTopIndex,
    'stale enable compensation must repaint after restoring the native window order'
  );
});

test('revalidates desired input tokens after Fabric preparation before invoking the runtime', async () => {
  const { host, events } = createDrawingHostHarness();
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, { videoGeneration: 6, inputRevision: 1 }));

  const preparation = createDeferred();
  host._ensureFabricRuntime = () => preparation.promise;
  const runtimeCallCount = events.filter(([name, value]) =>
    name === 'executeJavaScript' && value.includes?.('.setDrawingInput(')).length;
  const staleEnable = host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 6,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-before-prepare',
      stableVideoIdentity: 'video-before-prepare',
      targetFrame: 6,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  const latestDisable = host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 6,
    inputRevision: 3
  }));

  preparation.resolve({ success: true, reused: true });
  assert.equal((await staleEnable).success, false);
  assert.equal((await latestDisable).success, true);
  const callsAfterPreparation = events
    .filter(([name, value]) => name === 'executeJavaScript' && value.includes?.('.setDrawingInput('))
    .slice(runtimeCallCount)
    .map(([, script]) => readFabricMethodPayload(script, 'setDrawingInput'));
  assert.deepEqual(callsAfterPreparation, [],
    'an unprepared disable stays fail-closed without invoking the Fabric runtime');
});

test('destroy restores click-through and only a newly constructed window advances host generation', async () => {
  const { host, events, getReadCount } = createDrawingHostHarness();
  const first = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const firstGeneration = first.drawingCapability.hostGeneration;
  await host.setDrawingInput(makeDrawingInput(firstGeneration, { videoGeneration: 4, inputRevision: 1 }));
  await host.setDrawingInput(makeDrawingInput(firstGeneration, {
    videoGeneration: 4,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-before-destroy',
      stableVideoIdentity: 'video-before-destroy',
      targetFrame: 4,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  events.length = 0;

  const destroyed = host.destroy();

  assert.deepEqual(events[0], ['setIgnoreMouseEvents', true, undefined]);
  assert.equal(destroyed.destroyed, true);
  assert.equal(host.getDrawingCapability().hostGeneration, firstGeneration);
  assert.equal(host.getDrawingCapability().passiveReady, false);
  assert.equal(host.getDrawingCapability().fabricReady, false);
  assert.equal((await host.getDrawingDiagnostics()).success, false);

  const second = await host.ensure({ x: 1, y: 2, width: 640, height: 360 });
  assert.equal(second.drawingCapability.hostGeneration, firstGeneration + 1);
  assert.equal(getReadCount(), 1, 'passive recreation does not inject Fabric');
  assert.equal((await host.setDrawingInput(makeDrawingInput(firstGeneration + 1, {
    videoGeneration: 9,
    inputRevision: 1
  }))).success, true);
  assert.equal(getReadCount(), 1, 'an unprepared disable does not inject Fabric');
  assert.equal((await host.setDrawingInput(makeDrawingInput(firstGeneration + 1, {
    videoGeneration: 9,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-after-destroy',
      stableVideoIdentity: 'video-after-destroy',
      targetFrame: 9,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }))).success, true);
  assert.equal(getReadCount(), 2, 'the replacement generation injects its own fixed bundle once');
});

test('unprepared disable skips Fabric while failed enables retry with bounded exponential backoff', async () => {
  let currentTime = 1000;
  let readAttempt = 0;
  const { host, events, getReadCount } = createDrawingHostHarness({
    now: () => currentTime,
    fabricRetryBaseMs: 250,
    fabricRetryMaxMs: 2000,
    readFile: async () => {
      readAttempt += 1;
      if (readAttempt <= 4) throw new Error(`transient fixed bundle read failure ${readAttempt}`);
      return '/* fixed Fabric bundle */';
    }
  });
  const ensured = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;

  const disabled = await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 2,
    inputRevision: 1
  }));
  assert.equal(disabled.success, true);
  assert.equal(getReadCount(), 0);

  let inputRevision = 2;
  const makeEnable = () => makeDrawingInput(hostGeneration, {
    videoGeneration: 2,
    inputRevision: inputRevision++,
    enabled: true,
    session: {
      sessionId: 'session-failure',
      stableVideoIdentity: 'video-failure',
      targetFrame: 2,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  });
  const delays = [250, 500, 1000, 2000];
  for (let index = 0; index < delays.length; index += 1) {
    assert.equal((await host.setDrawingInput(makeEnable())).success, false);
    assert.equal(getReadCount(), index + 1);
    assert.equal(host.fabricRetryAfter, currentTime + delays[index]);

    assert.equal((await host.setDrawingInput(makeEnable())).success, false);
    assert.equal(getReadCount(), index + 1, 'an immediate retry reuses the cached failure');
    currentTime += delays[index] - 1;
    assert.equal((await host.setDrawingInput(makeEnable())).success, false);
    assert.equal(getReadCount(), index + 1, 'the retry remains blocked until the cooldown expires');
    currentTime += 1;
  }

  const recoveredEnable = await host.setDrawingInput(makeEnable());
  const mirrorUpdate = await host.updateState({ markerHtml: '<div class="comment-marker"></div>' });
  const passiveEnsure = await host.ensure({ x: 1, y: 2, width: 640, height: 360 });

  assert.equal(recoveredEnable.success, true);
  assert.equal(recoveredEnable.enabled, true);
  assert.equal(mirrorUpdate.success, true);
  assert.equal(passiveEnsure.success, true);
  assert.equal(host.getDrawingCapability().passiveReady, true);
  assert.equal(host.getDrawingCapability().fabricReady, true);
  assert.equal(getReadCount(), 5);
  assert.equal(host.fabricFailureCount, 0);
  assert.equal(host.fabricRetryAfter, 0);
  assert.equal(events.some(([name, value]) =>
    name === 'setIgnoreMouseEvents' && value === false), true);
});

test('a late Fabric preparation failure from an old host generation cannot poison the recovered host', async () => {
  const oldRead = createDeferred();
  const currentRead = createDeferred();
  let readAttempt = 0;
  const { host, getReadCount } = createDrawingHostHarness({
    readFile: async () => {
      readAttempt += 1;
      return readAttempt === 1 ? oldRead.promise : currentRead.promise;
    }
  });
  const first = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  await host.setDrawingInput(makeDrawingInput(first.drawingCapability.hostGeneration, {
    videoGeneration: 2,
    inputRevision: 1
  }));
  const oldPreparation = host.setDrawingInput(makeDrawingInput(
    first.drawingCapability.hostGeneration,
    {
      videoGeneration: 2,
      inputRevision: 2,
      enabled: true,
      session: {
        sessionId: 'session-old-generation',
        stableVideoIdentity: 'video-old-generation',
        targetFrame: 2,
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 640, height: 360 },
        tool: 'brush'
      }
    }
  ));
  await waitForAsyncReposition();

  host.destroy();
  const recovered = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  await host.setDrawingInput(makeDrawingInput(recovered.drawingCapability.hostGeneration, {
    videoGeneration: 3,
    inputRevision: 1
  }));
  const currentPreparation = host.setDrawingInput(makeDrawingInput(
    recovered.drawingCapability.hostGeneration,
    {
      videoGeneration: 3,
      inputRevision: 2,
      enabled: true,
      session: {
        sessionId: 'session-current-generation',
        stableVideoIdentity: 'video-current-generation',
        targetFrame: 3,
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 640, height: 360 },
        tool: 'brush'
      }
    }
  ));
  await waitForAsyncReposition();

  currentRead.resolve('/* fixed Fabric bundle */');
  assert.equal((await currentPreparation).success, true);
  assert.equal(host.getDrawingCapability().fabricReady, true);
  oldRead.reject(new Error('late old-generation bundle failure'));
  assert.equal((await oldPreparation).success, false);
  assert.equal(host.fabricLastError, null);
  assert.equal(getReadCount(), 2);

  await host.setDrawingInput(makeDrawingInput(recovered.drawingCapability.hostGeneration, {
    videoGeneration: 3,
    inputRevision: 3
  }));
  const enabled = await host.setDrawingInput(makeDrawingInput(
    recovered.drawingCapability.hostGeneration,
    {
      videoGeneration: 3,
      inputRevision: 4,
      enabled: true,
      session: {
        sessionId: 'session-after-stale-failure',
        stableVideoIdentity: 'video-after-stale-failure',
        targetFrame: 3,
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 640, height: 360 },
        tool: 'brush'
      }
    }
  ));
  assert.equal(enabled.success, true);
  assert.equal(getReadCount(), 2,
    'the recovered ready generation reuses its successful preparation');
});

test('renderer crash discards its current overlay and recovers in a new host generation', async () => {
  const { host, events, windows, getReadCount } = createDrawingHostHarness();
  const first = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const firstGeneration = first.drawingCapability.hostGeneration;
  await host.setDrawingInput(makeDrawingInput(firstGeneration, { videoGeneration: 2, inputRevision: 1 }));
  await host.setDrawingInput(makeDrawingInput(firstGeneration, {
    videoGeneration: 2,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-before-crash',
      stableVideoIdentity: 'video-before-crash',
      targetFrame: 2,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }));
  const crashedWindow = windows[0];
  events.length = 0;

  crashedWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' });

  assert.deepEqual(events[0], ['setIgnoreMouseEvents', true, undefined]);
  assert.equal(crashedWindow.destroyed, true);
  assert.equal(host.window, null);
  assert.equal(host.getDrawingCapability().hostGeneration, firstGeneration);
  assert.equal(host.getDrawingCapability().passiveReady, false);
  assert.equal(host.getDrawingCapability().fabricReady, false);
  assert.equal((await host.getDrawingDiagnostics()).success, false);

  const recovered = await host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const replacementWindow = windows[1];
  assert.equal(recovered.success, true);
  assert.notEqual(replacementWindow, crashedWindow);
  assert.equal(recovered.drawingCapability.hostGeneration, firstGeneration + 1);
  assert.equal(getReadCount(), 1, 'passive recovery does not inject Fabric into the new generation');
  assert.equal((await host.setDrawingInput(makeDrawingInput(firstGeneration + 1, {
    videoGeneration: 3,
    inputRevision: 1
  }))).success, true);
  assert.equal(getReadCount(), 1, 'an unprepared recovery disable does not inject Fabric');
  assert.equal((await host.setDrawingInput(makeDrawingInput(firstGeneration + 1, {
    videoGeneration: 3,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'session-after-crash',
      stableVideoIdentity: 'video-after-crash',
      targetFrame: 3,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      tool: 'brush'
    }
  }))).success, true);
  assert.equal(getReadCount(), 2, 'each of the two host generations receives exactly one bundle injection');

  await host.getDrawingDiagnostics();
  await host.ensure({ x: 1, y: 2, width: 640, height: 360 });
  assert.equal(getReadCount(), 2, 'the recovered generation does not reinject its bundle');

  const eventCountBeforeStaleCrash = events.length;
  crashedWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(events.length, eventCountBeforeStaleCrash);
  assert.equal(host.window, replacementWindow);
  assert.equal(replacementWindow.destroyed, false);
  assert.equal(host.getDrawingCapability().hostGeneration, recovered.drawingCapability.hostGeneration);
  assert.equal(host.getDrawingCapability().passiveReady, true);
});

test('normalizes overlay state to bounded serializable fields', () => {
  const state = normalizeOverlayState({
    drawingDataUrl: 'data:image/png;base64,abc',
    remoteStrokeDataUrl: 'data:image/png;base64,remote-stroke',
    remoteStrokeOpacity: 0.35,
    onionDataUrl: 'file://not-allowed',
    markerHtml: '<div class="comment-marker"></div>',
    tooltipHtml: '<div class="comment-marker-tooltip visible"></div>',
    htmlOverlayHtml: '<div class="current-cut-overlay">Cut 01</div>',
    toastHtml: '<div class="toast-container"><div class="toast success">Saved</div></div>',
    remoteCursorHtml: '<div class="remote-cursor"></div>',
    canvas: { left: 10.4, top: 20.6, width: 640.2, height: 360.7 },
    markerTransform: 'scale(2) translate(1px, 2px)',
    markerTransformOrigin: 'center center'
  });

  assert.deepEqual(state.canvas, { left: 10, top: 21, width: 640, height: 361 });
  assert.equal(state.drawingDataUrl, 'data:image/png;base64,abc');
  assert.equal(state.remoteStrokeDataUrl, 'data:image/png;base64,remote-stroke');
  assert.equal(state.remoteStrokeOpacity, 0.35);
  assert.equal(state.onionDataUrl, '');
  assert.equal(state.markerHtml, '<div class="comment-marker"></div>');
  assert.equal(state.tooltipHtml, '<div class="comment-marker-tooltip visible"></div>');
  assert.equal(state.htmlOverlayHtml, '<div class="current-cut-overlay">Cut 01</div>');
  assert.equal(state.toastHtml, '<div class="toast-container"><div class="toast success">Saved</div></div>');
  assert.equal(state.remoteCursorHtml, undefined,
    'general overlay state must never be a second writer for remote cursors');
  assert.equal(state.markerTransform, 'scale(2) translate(1px, 2px)');
  assert.equal(state.markerTransformOrigin, 'center center');
});

test('normalizes Fabric viewport numbers while preserving signed offsets and safe positive dimensions', () => {
  const valid = normalizeOverlayState({
    fabricViewport: {
      revision: '9.8',
      canvasRect: {
        left: '-12.5',
        top: '6.25',
        width: '640.5',
        height: '360.25'
      },
      scale: '1.75',
      panX: '-3.5',
      panY: '4.25',
      devicePixelRatio: '2'
    }
  });
  assert.deepEqual(valid.fabricViewport, {
    revision: 9,
    canvasRect: {
      left: -12.5,
      top: 6.25,
      width: 640.5,
      height: 360.25
    },
    scale: 1.75,
    panX: -3.5,
    panY: 4.25,
    devicePixelRatio: 2
  });

  const invalid = normalizeOverlayState({
    fabricViewport: {
      revision: -4,
      canvasRect: {
        left: Number.POSITIVE_INFINITY,
        top: 'not-a-number',
        width: -640,
        height: Number.NaN
      },
      scale: 0,
      panX: Number.NaN,
      panY: Number.NEGATIVE_INFINITY,
      devicePixelRatio: -2
    }
  });
  assert.deepEqual(invalid.fabricViewport, {
    revision: 0,
    canvasRect: { left: 0, top: 0, width: 0, height: 0 },
    scale: 1,
    panX: 0,
    panY: 0,
    devicePixelRatio: 1
  });
  assert.equal(normalizeOverlayState({ fabricViewport: null }).fabricViewport, undefined);
  assert.equal(normalizeOverlayState({ markerHtml: '' }).fabricViewport, undefined);
});

test('preserves negative overlay canvas offsets from zoomed and panned video', () => {
  const state = normalizeOverlayState({
    drawingDataUrl: 'data:image/png;base64,abc',
    canvas: { left: -42.4, top: -18.6, width: 640, height: 360 }
  });

  assert.equal(state.canvas.left, -42);
  assert.equal(state.canvas.top, -19);
  assert.equal(state.canvas.width, 640);
  assert.equal(state.canvas.height, 360);
});

test('creates a click-through overlay window above the viewer area', async () => {
  const events = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.bounds = null;
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async (script) => {
          events.push(['executeJavaScript', script]);
          return script.includes("typeof window.__applyMpvOverlayState === 'function'") &&
            script.includes("typeof window.__applyMpvRemoteCursorState === 'function'");
        }
      };
      events.push(['construct', options]);
    }
    loadURL(url) {
      events.push(['loadURL', url]);
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
      events.push(['setBounds', bounds]);
    }
    setIgnoreMouseEvents(ignore, options) {
      events.push(['setIgnoreMouseEvents', ignore, options]);
    }
    showInactive() {
      events.push(['showInactive']);
    }
    moveTop() {
      events.push(['moveTop']);
    }
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
      events.push(['destroy']);
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  const result = await host.ensure({ x: 25.4, y: 30.6, width: 640.2, height: 360.9 });

  assert.equal(result.success, true);
  assert.deepEqual(result.bounds, { x: 125, y: 111, width: 640, height: 361 });
  assert.equal(events[0][0], 'construct');
  assert.equal(events[0][1].parent, fakeMainWindow);
  assert.equal(events[0][1].frame, false);
  assert.equal(events[0][1].transparent, true);
  assert.equal(events[0][1].focusable, false);
  assert.deepEqual(
    events.find(([name]) => name === 'setIgnoreMouseEvents'),
    ['setIgnoreMouseEvents', true, undefined]
  );
  const loadUrl = events.find(([name]) => name === 'loadURL')?.[1] || '';
  const overlayDocument = decodeURIComponent(loadUrl.replace(/^data:text\/html;charset=utf-8,/, ''));
  const inlineScript = overlayDocument.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript, 'overlay inline script should exist');
  assert.doesNotThrow(() => new Function(inlineScript));
  const overlayHtml = overlayDocument;
  assert.equal(overlayHtml.includes('__applyMpvOverlayState'), true);
  assert.equal(overlayHtml.includes('applyOverlayTransform'), true);
  assert.equal(overlayHtml.includes('htmlOverlay'), true);
  assert.equal(overlayHtml.includes('tooltipMirror'), true);
  assert.equal(overlayHtml.includes('toastMirror'), true);
  assert.equal(overlayHtml.includes('remoteCursorMirror'), true);
  assert.match(
    overlayHtml,
    /#htmlOverlay \*\s*\{[^}]*pointer-events:\s*none !important;/
  );
  assert.equal(overlayHtml.includes('__applyMpvRemoteCursorState'), true);
  assert.equal(overlayHtml.includes('remoteStrokeMirror'), true);
  assert.equal(overlayHtml.includes('collabRippleMirror'), true);
  assert.equal(overlayHtml.includes('__triggerMpvCollabRipple'), true);
  assert.equal(overlayHtml.includes('.remote-cursors-container'), true);
  assert.equal(overlayHtml.includes("applyImage('drawingCanvasMirror', nextState.drawingDataUrl, nextState.canvas)"), true);
  assert.equal(overlayHtml.includes("applyImage('remoteStrokeMirror', nextState.remoteStrokeDataUrl, nextState.canvas)"), true);
  assert.equal(overlayHtml.includes('remoteStrokeMirror.style.opacity = String(nextState.remoteStrokeOpacity)'), true);
  assert.doesNotMatch(
    overlayHtml,
    /function applyImage\([\s\S]*?applyOverlayTransform\(element, state\)[\s\S]*?\n    \}/
  );
  assert.equal(overlayHtml.includes("element.style.transform = 'none';"), true);
  assert.equal(overlayHtml.includes('tooltipMirror.innerHTML = nextState.tooltipHtml'), true);
  assert.equal(overlayHtml.includes('htmlOverlay.innerHTML = nextState.htmlOverlayHtml'), true);
  assert.equal(overlayHtml.includes('toastMirror.innerHTML = nextState.toastHtml'), true);
  assert.equal(overlayHtml.includes('function sanitizeRemoteCursorHtml'), true);
  assert.equal(overlayHtml.includes('function applyRemoteCursorHtml'), true);
  assert.equal(overlayHtml.includes("const allowedTags = new Set(['div', 'span', 'svg', 'path'])"), true);
  assert.equal(overlayHtml.includes("name.startsWith('on')"), true);
  assert.equal(overlayHtml.includes('remoteCursorMirror.innerHTML = sanitizeRemoteCursorHtml(remoteCursorHtml)'), true);
  assert.equal(overlayHtml.includes('applyRemoteCursorHtml(nextState.remoteCursorHtml)'), false,
    'general overlay updates must not clear or rewind the dedicated cursor mirror');
  const viewportForwarder = overlayHtml.match(
    /if \(nextState\.fabricViewport !== undefined\) \{\s*window\.__mpvFabricOverlay\?\.updateViewport\?\.\(nextState\.fabricViewport\);\s*\}/
  )?.[0];
  assert.ok(viewportForwarder,
    'overlay state should optionally forward the normalized Fabric viewport');
  const forwardViewport = new Function('window', 'nextState', viewportForwarder);
  const viewport = {
    revision: 3,
    canvasRect: { left: 0, top: 0, width: 640, height: 360 },
    scale: 1,
    panX: 0,
    panY: 0,
    devicePixelRatio: 1
  };
  assert.doesNotThrow(() => forwardViewport({}, { fabricViewport: viewport }));
  assert.doesNotThrow(() =>
    forwardViewport({ __mpvFabricOverlay: {} }, { fabricViewport: viewport }));
  let forwardedViewport = null;
  forwardViewport({
    __mpvFabricOverlay: {
      updateViewport(value) {
        forwardedViewport = value;
        return { accepted: false, reason: 'input-disabled' };
      }
    }
  }, { fabricViewport: viewport });
  assert.deepEqual(forwardedViewport, viewport);
  assert.equal(overlayHtml.includes("tooltipMirror.style.transform = 'none';"), true);
  assert.ok(events.some(([name]) => name === 'showInactive'));
  assert.ok(events.some(([name]) => name === 'moveTop'));
});

test('keeps the overlay host unready when the document APIs are unavailable', async () => {
  const scripts = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async (script) => {
          scripts.push(script);
          return false;
        }
      };
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {}
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  const result = await host.ensure({ x: 0, y: 0, width: 300, height: 200 });

  assert.equal(result.success, false);
  assert.match(result.error, /overlay API/i);
  assert.equal(host.contentLoaded, false);

  const updateResult = await host.updateState({
    markerHtml: '<div class="comment-marker pending"></div>'
  });
  assert.equal(updateResult.success, false);
  assert.equal(
    scripts.some((script) => script.startsWith('window.__applyMpvOverlayState(')),
    false
  );
});

test('keeps the newest successful ensure ready when an older overlapping load rejects late', async () => {
  const loadAttempts = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async () => true
      };
    }
    loadURL() {
      const attempt = createDeferred();
      loadAttempts.push(attempt);
      return attempt.promise;
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {}
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  const olderEnsure = host.ensure({ x: 0, y: 0, width: 300, height: 200 });
  const newerEnsure = host.ensure({ x: 5, y: 6, width: 320, height: 180 });
  assert.equal(loadAttempts.length, 2);

  loadAttempts[1].resolve();
  const newerResult = await newerEnsure;
  assert.equal(newerResult.success, true);
  assert.equal(host.contentLoaded, true);

  loadAttempts[0].reject(new Error('older overlay load failed'));
  const olderResult = await olderEnsure;
  assert.equal(olderResult.success, false);
  assert.equal(host.contentLoaded, true);
});

test('ignores a pending ensure completion after the overlay host is destroyed', async () => {
  const loadAttempt = createDeferred();
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async () => true
      };
    }
    loadURL() {
      return loadAttempt.promise;
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {}
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  const pendingEnsure = host.ensure({ x: 0, y: 0, width: 300, height: 200 });
  host.destroy();
  loadAttempt.resolve();

  const result = await pendingEnsure;
  assert.equal(result.success, false);
  assert.match(result.error, /no longer current/i);
  assert.equal(host.window, null);
  assert.equal(host.contentLoaded, false);
});

test('ignores a late closed event from a replaced overlay window', async () => {
  const windows = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.listeners = new Map();
      this.webContents = {
        executeJavaScript: async () => true
      };
      windows.push(this);
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {}
    isDestroyed() {
      return this.destroyed;
    }
    on(eventName, handler) {
      this.listeners.set(eventName, handler);
    }
    emit(eventName) {
      this.listeners.get(eventName)?.();
    }
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  await host.ensure({ x: 0, y: 0, width: 300, height: 200 });
  const replacedWindow = windows[0];
  host.destroy();
  await host.ensure({ x: 1, y: 2, width: 320, height: 180 });
  const currentWindow = windows[1];

  replacedWindow.emit('closed');

  assert.equal(host.window, currentWindow);
  assert.equal(host.contentLoaded, true);
});

test('updates overlay state through the isolated overlay document', async () => {
  const scripts = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async (script) => {
          if (script.includes("typeof window.__applyMpvOverlayState === 'function'")) {
            return true;
          }
          scripts.push(script);
        }
      };
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds() {}
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {}
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  await host.ensure({ x: 0, y: 0, width: 300, height: 200 });
  const result = await host.updateState({
    markerHtml: '<div class="comment-marker pending"></div>',
    htmlOverlayHtml: '<div class="current-cut-overlay">Cut 01</div>',
    toastHtml: '<div class="toast-container"><div class="toast info">Ready</div></div>',
    drawingDataUrl: 'data:image/png;base64,draw',
    remoteStrokeDataUrl: 'data:image/png;base64,remote-stroke',
    canvas: { left: 1, top: 2, width: 3, height: 4 }
  });

  assert.equal(result.success, true);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /window\.__applyMpvOverlayState/);
  assert.match(scripts[0], /comment-marker pending/);
  assert.match(scripts[0], /current-cut-overlay/);
  assert.match(scripts[0], /toast info/);
  assert.doesNotMatch(scripts[0], /remote-cursor/);
  assert.match(scripts[0], /data:image\/png;base64,draw/);
  assert.match(scripts[0], /data:image\/png;base64,remote-stroke/);

  const cursorOnlyResult = await host.updateRemoteCursorState({
    revision: 2,
    html: '<div class="remote-cursor" style="display:block"></div>'
  });
  assert.equal(cursorOnlyResult.success, true);
  assert.equal(cursorOnlyResult.accepted, true);
  assert.equal(scripts.length, 2);
  assert.match(scripts[1], /window\.__applyMpvRemoteCursorState/);
  assert.match(scripts[1], /remote-cursor/);
  assert.doesNotMatch(scripts[1], /drawingDataUrl|markerHtml|toastHtml/);

  const staleCursorResult = await host.updateRemoteCursorState({
    revision: 1,
    html: '<div class="remote-cursor stale"></div>'
  });
  assert.deepEqual(staleCursorResult, { success: true, accepted: false, stale: true });
  assert.equal(scripts.length, 2, 'a stale cursor revision must not reach the overlay document');

  const rippleResult = await host.triggerCollabRipple({ x: 1.5, y: -1 });
  assert.equal(rippleResult.success, true);
  assert.equal(scripts.length, 3);
  assert.match(scripts[2], /window\.__triggerMpvCollabRipple/);
  assert.match(scripts[2], /"x":1/);
  assert.match(scripts[2], /"y":0/);
});

test('hides and restores the native overlay host with the mpv embed host', async () => {
  const events = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async () => true,
        invalidate: () => events.push(['webContents.invalidate'])
      };
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      events.push(['setBounds', bounds]);
    }
    showInactive() {
      events.push(['showInactive']);
    }
    hide() {
      events.push(['hide']);
    }
    moveTop() {
      events.push(['moveTop']);
    }
    setIgnoreMouseEvents() {}
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  await host.ensure({ x: 1, y: 2, width: 300, height: 200 });
  const hideResult = host.setVisible(false);
  const showResult = host.setVisible(true);

  assert.deepEqual(hideResult, { success: true, visible: false, ready: true });
  assert.deepEqual(showResult, { success: true, visible: true, ready: true });
  assert.ok(events.some(([name]) => name === 'hide'));
  assert.ok(events.filter(([name]) => name === 'showInactive').length >= 2);
  const showIndex = events.map(([name]) => name).lastIndexOf('showInactive');
  const repaintAfterShow = events.findIndex(
    ([name], index) => name === 'webContents.invalidate' && index > showIndex
  );
  assert.ok(repaintAfterShow > showIndex, '창 재표시 직후 재합성이 강제되어야 한다');
  assert.equal(host.window.isDestroyed(), false);
});

test('repositions and hides overlay with the parent window', async () => {
  const listeners = new Map();
  let contentBounds = { x: 100, y: 80, width: 1200, height: 800 };
  let minimized = false;
  const fakeMainWindow = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    getContentBounds: () => contentBounds,
    on(eventName, handler) {
      const handlers = listeners.get(eventName) || [];
      handlers.push(handler);
      listeners.set(eventName, handlers);
    },
    off(eventName, handler) {
      const handlers = listeners.get(eventName) || [];
      listeners.set(eventName, handlers.filter((candidate) => candidate !== handler));
    }
  };
  class FakeBrowserWindow {
    constructor() {
      this.bounds = null;
      this.visible = false;
      this.destroyed = false;
      this.showCount = 0;
      this.webContents = {
        executeJavaScript: async () => true
      };
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    setIgnoreMouseEvents() {}
    showInactive() {
      this.visible = true;
      this.showCount += 1;
    }
    moveTop() {}
    hide() {
      this.visible = false;
    }
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  await host.ensure({ x: 10, y: 20, width: 640, height: 360 });
  minimized = true;
  for (const handler of listeners.get('minimize') || []) {
    handler();
  }
  assert.equal(host.window.visible, false);

  minimized = false;
  contentBounds = { x: 140, y: 160, width: 1200, height: 800 };
  for (const handler of listeners.get('restore') || []) {
    handler();
  }
  await waitForAsyncReposition();

  assert.equal(host.window.visible, true);
  assert.deepEqual(host.window.bounds, { x: 150, y: 180, width: 640, height: 360 });

  const showCountBeforeHiddenRestore = host.window.showCount;
  host.setVisible(false);
  for (const handler of listeners.get('restore') || []) {
    handler();
  }
  await waitForAsyncReposition();

  assert.equal(host.window.visible, false);
  assert.equal(host.window.showCount, showCountBeforeHiddenRestore);
});

test('동일 bounds 재호출은 setBounds를 생략한다 (피드백 32)', async () => {
  const events = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 })
  };
  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.bounds = null;
      this.destroyed = false;
      this.webContents = {
        executeJavaScript: async (script) => {
          events.push(['executeJavaScript', script]);
          return script.includes("typeof window.__applyMpvOverlayState === 'function'") &&
            script.includes("typeof window.__applyMpvRemoteCursorState === 'function'");
        }
      };
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
      events.push(['setBounds', bounds]);
    }
    setIgnoreMouseEvents() {}
    showInactive() {}
    moveTop() {
      events.push(['moveTop']);
    }
    isDestroyed() {
      return this.destroyed;
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow
  });

  await host.ensure({ x: 0, y: 0, width: 300, height: 200 });
  const bounds = { x: 5, y: 7, width: 320, height: 180 };
  host.updateBounds(bounds);
  const callsAfterFirst = events.filter(([name]) => name === 'setBounds').length;
  const result = host.updateBounds({ ...bounds });
  assert.equal(result.success, true);
  assert.equal(events.filter(([name]) => name === 'setBounds').length, callsAfterFirst);
});

test('생략된 미러 필드는 이전 DOM을 유지하고 playhead는 별도 필드로 갱신된다 (32 잔존)', () => {
  // 전체 필드로 정규화하면 6필드 모두 정상 문자열
  const full = normalizeOverlayState({
    markerHtml: '<div class="comment-marker"></div>',
    htmlOverlayHtml: '<div class="current-cut-overlay"></div>',
    toastHtml: '<div class="toast-container"></div>',
    commentPlayheadLeft: '42%'
  });
  assert.equal(full.markerHtml, '<div class="comment-marker"></div>');
  assert.equal(full.commentPlayheadLeft, '42%');

  // markerHtml만 담은 부분 state → 나머지 diff 필드는 undefined로 보존되어 JSON.stringify에서 생략된다
  const partial = normalizeOverlayState({ markerHtml: '<div class="comment-marker"></div>' });
  assert.equal(partial.htmlOverlayHtml, undefined);
  assert.equal(partial.toastHtml, undefined);
  assert.equal(partial.drawingDataUrl, undefined);
  assert.equal(partial.onionDataUrl, undefined);
  assert.equal(partial.remoteStrokeDataUrl, undefined);
  assert.equal(partial.remoteCursorHtml, undefined);
  assert.equal(partial.markerHtml, '<div class="comment-marker"></div>');

  // 호스트 적용부가 playhead를 별도 필드로 갱신한다
  const fs = require('node:fs');
  const path = require('node:path');
  const hostSource = fs.readFileSync(path.join(__dirname, '../../main/mpv-overlay-host.js'), 'utf8');
  assert.match(hostSource, /playheadMirror\.style\.left = nextState\.commentPlayheadLeft;/);
});

test('호스트 창이 파일 드롭 네비게이션을 가로채 메인 창으로 전달한다 (드래그드롭 수복)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const hostSource = fs.readFileSync(path.join(__dirname, '../../main/mpv-overlay-host.js'), 'utf8');
  assert.match(hostSource, /webContents\?\.on\?\.\('will-navigate'/);
  assert.match(hostSource, /open-from-protocol/);
});

test('Fabric 시험 툴바는 작은 화면에서도 읽기 쉽고 현재 도구가 분명하다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const hostSource = fs.readFileSync(path.join(__dirname, '../../main/mpv-overlay-host.js'), 'utf8');

  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar\s*\{[^}]*background:\s*rgba\(/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar\s*\{[^}]*border-radius:\s*14px/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar\s*\{[^}]*--fabric-toolbar-gap:\s*6px/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar\s*\{[^}]*flex-flow:\s*row wrap/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar\s*\{[^}]*width:\s*max-content/s);
  assert.match(
    hostSource,
    /\.mpv-fabric-pilot-toolbar\s*\{[^}]*max-width:\s*calc\(100% - 24px\)/s
  );
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar button\s*\{[^}]*min-width:\s*40px[^}]*min-height:\s*40px/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(
    hostSource,
    /\.mpv-fabric-pilot-toolbar\s*>\s*button,[\s\S]*?data-fabric-pilot-group="selection-controls"[\s\S]*?\{[^}]*flex:\s*0 0 auto/s
  );
  assert.match(hostSource, /button\[data-active="true"\]\s*\{/);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar button:active\s*\{[^}]*transform:\s*scale\(0\.96\)/s);
  assert.match(
    hostSource,
    /\.mpv-fabric-pilot-badge\s*\{[^}]*font-variant-numeric:\s*tabular-nums[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s
  );
  assert.match(hostSource, /@media\s*\(max-width:\s*800px\)\s*\{/s);
  assert.match(
    hostSource,
    /@media\s*\(max-width:\s*800px\)[\s\S]*?--fabric-toolbar-gap:\s*4px[\s\S]*?padding:\s*4px/s
  );
  assert.match(
    hostSource,
    /@media\s*\(max-width:\s*800px\)[\s\S]*?\.mpv-fabric-pilot-toolbar button\s*\{[^}]*padding-inline:\s*8px/s
  );
  assert.match(
    hostSource,
    /@media\s*\(max-width:\s*800px\)[\s\S]*?data-fabric-pilot-output="summary"[\s\S]*?display:\s*none/s
  );
  assert.match(hostSource, /#root\s*\{[^}]*overflow:\s*hidden/s);
  assert.doesNotMatch(
    hostSource,
    /\.mpv-fabric-pilot-toolbar\s*\{[^}]*overflow-x:\s*auto/s
  );
  assert.doesNotMatch(
    hostSource,
    /\.mpv-fabric-pilot-toolbar(?: button)?\s*\{[^}]*transition:\s*all\b/s
  );
});

test('stable overlay host does not include the old manual verification HUD', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const hostSource = fs.readFileSync(path.join(__dirname, '../../main/mpv-overlay-host.js'), 'utf8');

  assert.doesNotMatch(hostSource, /fabricPilotStatusMirror|fabricPilotStatusText|FABRIC TEST/);
  const normalized = normalizeOverlayState({
    markerHtml: '<div></div>',
    fabricPilotStatusText: 'must be ignored'
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized, 'fabricPilotStatusText'),
    false
  );
});

test('standard mpv suite includes the hidden Fabric toolbar Chromium layout regression', () => {
  const packageJson = require('../../package.json');

  assert.match(
    packageJson.scripts['test:mpv'],
    /mpv-fabric-overlay-toolbar-layout\.test\.js/
  );
});

test('current overlay pointerdown request relays only the exact active drawing session to main', async () => {
  const harness = createDrawingHostHarness();
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 7,
    sessionId: 'pointerdown-frame-session'
  });
  const currentEvent = { sender: harness.windows[0].webContents };
  const request = makeDrawingPointerdownFrameRequest(tokens.hostGeneration);
  harness.events.length = 0;

  assert.deepEqual(
    harness.host.forwardDrawingPointerdownFrameRequest(currentEvent, request),
    { success: true, accepted: true }
  );
  assert.deepEqual(harness.events, [[
    'mainWindow.send',
    'mpv-overlay:drawing-pointerdown-frame-request',
    request
  ]]);
  assert.notEqual(harness.events[0][2], request);

  for (const invalid of [
    makeDrawingPointerdownFrameRequest(tokens.hostGeneration, { sessionId: 'stale' }),
    makeDrawingPointerdownFrameRequest(tokens.hostGeneration, { hostGeneration: 0 }),
    makeDrawingPointerdownFrameRequest(tokens.hostGeneration, { pointerdownAt: 1.5 }),
    makeDrawingPointerdownFrameRequest(tokens.hostGeneration, { pointerdownId: '' }),
    { ...request, injected: true }
  ]) {
    assert.equal(
      harness.host.forwardDrawingPointerdownFrameRequest(currentEvent, invalid).accepted,
      false
    );
  }
  assert.equal(
    harness.host.forwardDrawingPointerdownFrameRequest({ sender: {} }, request).accepted,
    false
  );
  assert.equal(
    harness.events.filter(([name]) => name === 'mainWindow.send').length,
    1
  );

  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: 7,
    inputRevision: 3,
    enabled: false
  }));
  assert.equal(
    harness.host.forwardDrawingPointerdownFrameRequest(currentEvent, {
      ...request,
      inputRevision: 3
    }).accepted,
    false
  );
});

test('pointerdown frame confirmation reaches runtime only for the exact current active session', async () => {
  const confirmations = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.confirmDrawingPointerdownFrame(')) return undefined;
      const request = readFabricMethodPayload(script, 'confirmDrawingPointerdownFrame');
      confirmations.push(request);
      return {
        accepted: true,
        pointerdownId: request.pointerdownId,
        targetFrame: request.targetFrame
      };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 7,
    sessionId: 'pointerdown-frame-session'
  });
  const confirmation = makeDrawingPointerdownFrameConfirmation(tokens.hostGeneration);

  assert.deepEqual(await harness.host.confirmDrawingPointerdownFrame(confirmation), {
    success: true,
    accepted: true,
    pointerdownId: 'pointerdown-frame-1',
    targetFrame: 42
  });
  assert.deepEqual(confirmations, [confirmation]);

  for (const invalid of [
    { ...confirmation, injected: true },
    makeDrawingPointerdownFrameConfirmation(tokens.hostGeneration, { targetFrame: -1 }),
    makeDrawingPointerdownFrameConfirmation(tokens.hostGeneration, { sessionId: 'stale' }),
    makeDrawingPointerdownFrameConfirmation(tokens.hostGeneration, { pointerdownId: '' })
  ]) {
    assert.equal((await harness.host.confirmDrawingPointerdownFrame(invalid)).accepted, false);
  }
  assert.equal(confirmations.length, 1);
});

test('pointerdown frame cancellation reaches runtime and requires the exact echoed owner and time', async () => {
  const cancellations = [];
  let responseOverrides = {};
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.confirmDrawingPointerdownFrame(')) return undefined;
      const request = readFabricMethodPayload(script, 'confirmDrawingPointerdownFrame');
      cancellations.push(request);
      return {
        accepted: true,
        cancelled: true,
        hostGeneration: request.hostGeneration,
        videoGeneration: request.videoGeneration,
        inputRevision: request.inputRevision,
        sessionId: request.sessionId,
        pointerdownId: request.pointerdownId,
        pointerdownAt: request.pointerdownAt,
        ...responseOverrides
      };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 7,
    sessionId: 'pointerdown-frame-session'
  });
  const cancellation = makeDrawingPointerdownFrameCancellation(tokens.hostGeneration);

  assert.deepEqual(await harness.host.confirmDrawingPointerdownFrame(cancellation), {
    success: true,
    accepted: true,
    cancelled: true,
    hostGeneration: tokens.hostGeneration,
    videoGeneration: 7,
    inputRevision: 2,
    sessionId: 'pointerdown-frame-session',
    pointerdownId: 'pointerdown-frame-1',
    pointerdownAt: 1234
  });
  assert.deepEqual(cancellations, [cancellation]);

  for (const mismatch of [
    { hostGeneration: tokens.hostGeneration + 1 },
    { videoGeneration: 8 },
    { inputRevision: 3 },
    { sessionId: 'other-session' },
    { pointerdownId: 'other-pointerdown' },
    { pointerdownAt: 1235 },
    { cancelled: false }
  ]) {
    responseOverrides = mismatch;
    assert.deepEqual(await harness.host.confirmDrawingPointerdownFrame(cancellation), {
      success: false,
      accepted: false,
      reason: 'drawing-pointerdown-frame-cancel-rejected'
    });
  }
  assert.equal(cancellations.length, 8);
});

test('pointerdown frame cancellation rejects non-exact tags and stale owners without runtime side effects', async () => {
  let runtimeCalls = 0;
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.confirmDrawingPointerdownFrame(')) runtimeCalls += 1;
      return { accepted: true };
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 7,
    sessionId: 'pointerdown-frame-session'
  });
  const base = makeDrawingPointerdownFrameCancellation(tokens.hostGeneration);

  for (const invalid of [
    { ...base, cancelled: false },
    { ...base, targetFrame: 42 },
    { ...base, injected: true },
    makeDrawingPointerdownFrameCancellation(tokens.hostGeneration, { pointerdownAt: -1 }),
    makeDrawingPointerdownFrameCancellation(tokens.hostGeneration, { sessionId: 'stale' }),
    makeDrawingPointerdownFrameCancellation(tokens.hostGeneration, { pointerdownId: '' })
  ]) {
    assert.equal((await harness.host.confirmDrawingPointerdownFrame(invalid)).accepted, false);
  }
  assert.equal(runtimeCalls, 0);
});

test('late pointerdown cancellation response is rejected after input ownership changes', async () => {
  const delayed = createDeferred();
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.confirmDrawingPointerdownFrame(')) return delayed.promise;
      return undefined;
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 7,
    sessionId: 'pointerdown-frame-session'
  });
  const cancellation = makeDrawingPointerdownFrameCancellation(tokens.hostGeneration);
  const pending = harness.host.confirmDrawingPointerdownFrame(cancellation);
  await new Promise(resolve => setImmediate(resolve));
  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: 7,
    inputRevision: 3,
    enabled: false
  }));
  delayed.resolve({
    accepted: true,
    cancelled: true,
    hostGeneration: cancellation.hostGeneration,
    videoGeneration: cancellation.videoGeneration,
    inputRevision: cancellation.inputRevision,
    sessionId: cancellation.sessionId,
    pointerdownId: cancellation.pointerdownId,
    pointerdownAt: cancellation.pointerdownAt
  });

  assert.deepEqual(await pending, {
    success: false,
    accepted: false,
    reason: 'stale-drawing-pointerdown-frame-response'
  });
});

test('late pointerdown confirmation is rejected after input ownership changes', async () => {
  const delayed = createDeferred();
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.confirmDrawingPointerdownFrame(')) return delayed.promise;
      return undefined;
    }
  });
  const tokens = await activateDrawingHost(harness, {
    videoGeneration: 7,
    sessionId: 'pointerdown-frame-session'
  });
  const confirmation = makeDrawingPointerdownFrameConfirmation(tokens.hostGeneration);
  const pending = harness.host.confirmDrawingPointerdownFrame(confirmation);
  await new Promise(resolve => setImmediate(resolve));
  await harness.host.setDrawingInput(makeDrawingInput(tokens.hostGeneration, {
    videoGeneration: 7,
    inputRevision: 3,
    enabled: false
  }));
  delayed.resolve({
    accepted: true,
    pointerdownId: confirmation.pointerdownId,
    targetFrame: confirmation.targetFrame
  });

  assert.deepEqual(await pending, {
    success: false,
    accepted: false,
    reason: 'stale-drawing-pointerdown-frame-response'
  });
});

test('accepted passive frame presentation executes runtime, restacks, then invalidates', async () => {
  const presented = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: true, sceneCount: 0, objectCount: 0 };
      }
      if (script.includes('.presentDrawingFrame(')) {
        const request = readFabricMethodPayload(script, 'presentDrawingFrame');
        presented.push(request);
        return { accepted: true };
      }
      return undefined;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.hydrateDrawingVideo(makePersistenceHydration(hostGeneration));
  harness.events.length = 0;

  assert.deepEqual(
    await harness.host.presentDrawingFrame(makeDrawingPresentation(hostGeneration)),
    {
      success: true,
      accepted: true,
      presentationRevision: 1,
      targetFrame: 24,
      sourceFrame: 12
    }
  );
  assert.deepEqual(presented, [makeDrawingPresentation(hostGeneration)]);
  assert.deepEqual(
    harness.events
      .filter(([name, script]) =>
        (name === 'executeJavaScript' && script.includes?.('.presentDrawingFrame(')) ||
        name === 'moveTop' ||
        name === 'webContents.invalidate')
      .map(([name]) => name === 'executeJavaScript' ? 'runtime.presentDrawingFrame' : name),
    ['runtime.presentDrawingFrame', 'moveTop', 'webContents.invalidate']
  );
  assert.equal(harness.events.some(([name]) => name === 'overlay.focus'), false);
  assert.equal(harness.events.some(([name]) => name === 'mainWindow.focus'), false);
});

test('rejected and failed passive frame presentations never restack or invalidate', async () => {
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: true, sceneCount: 0, objectCount: 0 };
      }
      if (!script.includes('.presentDrawingFrame(')) return undefined;
      const request = readFabricMethodPayload(script, 'presentDrawingFrame');
      if (request.presentationRevision === 1) return { accepted: false };
      throw new Error('passive presentation failed');
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.hydrateDrawingVideo(makePersistenceHydration(hostGeneration));
  harness.events.length = 0;

  assert.deepEqual(
    await harness.host.presentDrawingFrame(makeDrawingPresentation(hostGeneration)),
    {
      success: false,
      accepted: false,
      reason: 'drawing-presentation-rejected',
      presentationRevision: 1,
      targetFrame: 24,
      sourceFrame: 12
    }
  );
  assert.deepEqual(
    await harness.host.presentDrawingFrame(makeDrawingPresentation(hostGeneration, {
      presentationRevision: 2
    })),
    {
      success: false,
      accepted: false,
      reason: 'drawing-presentation-failed',
      presentationRevision: 2,
      targetFrame: 24,
      sourceFrame: 12
    }
  );
  assert.equal(harness.events.some(([name]) => name === 'moveTop'), false);
  assert.equal(harness.events.some(([name]) => name === 'webContents.invalidate'), false);
});

test('passive frame presentation strictly rejects missing, extra, and malformed viewport geometry', async () => {
  let presentCalls = 0;
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: true, sceneCount: 0, objectCount: 0 };
      }
      if (script.includes('.presentDrawingFrame(')) presentCalls += 1;
      return { accepted: true };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.hydrateDrawingVideo(makePersistenceHydration(hostGeneration));

  const missing = makeDrawingPresentation(hostGeneration);
  delete missing.viewportTransform;
  const invalidRequests = [
    missing,
    makeDrawingPresentation(hostGeneration, { extra: true }),
    makeDrawingPresentation(hostGeneration, {
      canvasRect: { left: 8, top: 12, width: 0, height: 540 }
    }),
    makeDrawingPresentation(hostGeneration, {
      viewportTransform: { scale: 0, panX: 16, panY: -9 }
    })
  ];
  for (const request of invalidRequests) {
    assert.equal((await harness.host.presentDrawingFrame(request)).reason, 'invalid-presentation-request');
  }
  assert.equal(presentCalls, 0);
});

test('passive frame presentation rejects active input and a mismatched video identity before runtime execution', async () => {
  let presentCalls = 0;
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: true, sceneCount: 0, objectCount: 0 };
      }
      if (script.includes('.presentDrawingFrame(')) {
        presentCalls += 1;
        return { accepted: true };
      }
      return undefined;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.hydrateDrawingVideo(makePersistenceHydration(hostGeneration));

  assert.deepEqual(
    await harness.host.presentDrawingFrame(makeDrawingPresentation(hostGeneration, {
      stableVideoIdentity: 'C:/shots/other-video.mov'
    })),
    {
      success: false,
      accepted: false,
      reason: 'stale-presentation-fence',
      presentationRevision: 1,
      targetFrame: 24,
      sourceFrame: 12
    }
  );

  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'active-presentation-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      targetFrame: 24,
      sourceFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { x: 0, y: 0, width: 640, height: 360 },
      viewportRevision: 0,
      viewportTransform: { scale: 1, panX: 0, panY: 0 },
      tool: 'brush'
    }
  }));
  assert.deepEqual(
    await harness.host.presentDrawingFrame(makeDrawingPresentation(hostGeneration, {
      presentationRevision: 2
    })),
    {
      success: false,
      accepted: false,
      reason: 'drawing-input-enabled',
      presentationRevision: 2,
      targetFrame: 24,
      sourceFrame: 12
    }
  );
  assert.equal(presentCalls, 0);
});

test('newer passive presentation supersedes an older in-flight response and owns the only invalidation', async () => {
  const first = createDeferred();
  const runtimeRevisions = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (script.includes('.hydrateDrawingVideo(')) {
        return { accepted: true, sceneCount: 0, objectCount: 0 };
      }
      if (script.includes('.presentDrawingFrame(')) {
        const request = readFabricMethodPayload(script, 'presentDrawingFrame');
        runtimeRevisions.push(request.presentationRevision);
        if (request.presentationRevision === 1) return first.promise;
        return { accepted: true };
      }
      return undefined;
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.hydrateDrawingVideo(makePersistenceHydration(hostGeneration));
  harness.events.length = 0;

  const older = harness.host.presentDrawingFrame(makeDrawingPresentation(hostGeneration));
  await new Promise(resolve => setImmediate(resolve));
  const newerRequest = makeDrawingPresentation(hostGeneration, {
    presentationRevision: 2,
    targetFrame: 30,
    sourceFrame: 30
  });
  assert.deepEqual(await harness.host.presentDrawingFrame(newerRequest), {
    success: true,
    accepted: true,
    presentationRevision: 2,
    targetFrame: 30,
    sourceFrame: 30
  });

  first.resolve({ accepted: true });
  assert.deepEqual(await older, {
    success: false,
    accepted: false,
    reason: 'stale-presentation-response',
    presentationRevision: 1,
    targetFrame: 24,
    sourceFrame: 12
  });
  assert.deepEqual(runtimeRevisions, [1, 2]);
  assert.equal(
    harness.events.filter(([name]) => name === 'webContents.invalidate').length,
    1
  );
  assert.equal(
    harness.events.filter(([name]) => name === 'moveTop').length,
    1
  );
});

test('active frame updates accept only the current active session and strictly increasing revisions', async () => {
  const updates = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.updateDrawingFrame(')) return undefined;
      const request = readFabricMethodPayload(script, 'updateDrawingFrame');
      updates.push(request);
      return {
        accepted: true,
        sourceFrame: request.targetFrame === 20 ? 10 : 20,
        repainted: request.targetFrame === 20
      };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'active-frame-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      targetFrame: 10,
      sourceFrame: 10,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      viewportRevision: 0,
      viewportTransform: { scale: 1, panX: 0, panY: 0 },
      tool: 'brush'
    }
  }));
  harness.events.length = 0;

  assert.deepEqual(await harness.host.updateDrawingFrame(
    makeDrawingFrameUpdate(hostGeneration)
  ), {
    success: true,
    accepted: true,
    frameRevision: 1,
    targetFrame: 20,
    sourceFrame: 10
  });
  for (const invalid of [
    makeDrawingFrameUpdate(hostGeneration, { frameRevision: 1, targetFrame: 21 }),
    makeDrawingFrameUpdate(hostGeneration, { frameRevision: 2, inputRevision: 1 }),
    makeDrawingFrameUpdate(hostGeneration, { frameRevision: 2, sessionId: 'other-session' }),
    { ...makeDrawingFrameUpdate(hostGeneration, { frameRevision: 2 }), extra: true }
  ]) {
    assert.equal((await harness.host.updateDrawingFrame(invalid)).accepted, false);
  }
  assert.equal(updates.length, 1);
  assert.equal(
    harness.events.filter(([name]) => name === 'webContents.invalidate').length,
    1
  );

  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 3,
    enabled: false
  }));
  assert.equal((await harness.host.updateDrawingFrame(
    makeDrawingFrameUpdate(hostGeneration, { inputRevision: 3, frameRevision: 1 })
  )).accepted, false);
});

test('a late active frame response cannot supersede a newer accepted revision', async () => {
  const first = createDeferred();
  const runtimeRevisions = [];
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.updateDrawingFrame(')) return undefined;
      const request = readFabricMethodPayload(script, 'updateDrawingFrame');
      runtimeRevisions.push(request.frameRevision);
      if (request.frameRevision === 1) return first.promise;
      return { accepted: true, sourceFrame: 20, repainted: true };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'active-frame-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      targetFrame: 10,
      sourceFrame: 10,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      viewportRevision: 0,
      viewportTransform: { scale: 1, panX: 0, panY: 0 },
      tool: 'brush'
    }
  }));
  harness.events.length = 0;

  const older = harness.host.updateDrawingFrame(makeDrawingFrameUpdate(hostGeneration));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await harness.host.updateDrawingFrame(
    makeDrawingFrameUpdate(hostGeneration, { frameRevision: 2, targetFrame: 21 })
  ), {
    success: true,
    accepted: true,
    frameRevision: 2,
    targetFrame: 21,
    sourceFrame: 20
  });

  first.resolve({ accepted: true, sourceFrame: 10, repainted: true });
  assert.deepEqual(await older, {
    success: false,
    accepted: false,
    reason: 'stale-active-frame-response'
  });
  assert.deepEqual(runtimeRevisions, [1, 2]);
  assert.equal(
    harness.events.filter(([name]) => name === 'webContents.invalidate').length,
    1
  );
});

test('active frame updates invalidate the host only when the runtime repaints', async () => {
  const harness = createDrawingHostHarness({
    executeDrawing(script) {
      if (!script.includes('.updateDrawingFrame(')) return undefined;
      const request = readFabricMethodPayload(script, 'updateDrawingFrame');
      return {
        accepted: true,
        sourceFrame: 10,
        repainted: request.frameRevision === 2
      };
    }
  });
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 1,
    enabled: false
  }));
  await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 7,
    inputRevision: 2,
    enabled: true,
    session: {
      sessionId: 'active-frame-session',
      stableVideoIdentity: 'C:/shots/host-video.mov',
      targetFrame: 10,
      sourceFrame: 10,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 640, height: 360 },
      viewportRevision: 0,
      viewportTransform: { scale: 1, panX: 0, panY: 0 },
      tool: 'brush'
    }
  }));
  harness.events.length = 0;

  assert.equal((await harness.host.updateDrawingFrame(
    makeDrawingFrameUpdate(hostGeneration)
  )).accepted, true);
  assert.equal(
    harness.events.filter(([name]) => name === 'webContents.invalidate').length,
    0
  );
  assert.equal((await harness.host.updateDrawingFrame(
    makeDrawingFrameUpdate(hostGeneration, { frameRevision: 2, targetFrame: 21 })
  )).accepted, true);
  assert.equal(
    harness.events.filter(([name]) => name === 'webContents.invalidate').length,
    1
  );
});

test('drawing input disable and export degrade gracefully when the overlay host is gone', async () => {
  const harness = createDrawingHostHarness();
  const ensured = await harness.host.ensure({ x: 0, y: 0, width: 640, height: 360 });
  const { hostGeneration } = ensured.drawingCapability;
  harness.host.destroy();

  // 죽은 호스트에서 disable 요청은 no-op 성공이어야 한다(영상 전환 교착 방지).
  assert.deepEqual(await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 0,
    inputRevision: 1,
    enabled: false
  })), {
    success: true,
    accepted: true,
    enabled: false,
    fabricReady: false,
    hostUnavailable: true
  });

  // enable 요청은 기존대로 실패한다.
  assert.deepEqual(await harness.host.setDrawingInput(makeDrawingInput(hostGeneration, {
    videoGeneration: 0,
    inputRevision: 2,
    enabled: true
  })), { success: false, error: 'mpv overlay host is not ready' });

  // 죽은 호스트에 대한 export는 stale이 아니라 회복 불가 사유를 반환한다.
  assert.deepEqual(await harness.host.exportDrawingVideo(
    makePersistenceExport(hostGeneration)
  ), {
    success: false,
    accepted: false,
    reason: 'overlay-host-unavailable'
  });
});
