const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MPVOverlayHost,
  normalizeOverlayState
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
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    focus: () => events.push(['mainWindow.focus']),
    webContents: {
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
        on: (eventName, handler) => {
          this.webContentsListeners.set(eventName, handler);
        },
        emit: (eventName, ...args) => {
          this.webContentsListeners.get(eventName)?.(...args);
        },
        executeJavaScript: async (script) => {
          events.push(['executeJavaScript', script]);
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
              scene: { objects: [{ type: 'fabric.Path' }] }
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
              objectCount: 1,
              selectionCount: 1,
              mutationCount: 2,
              dirty: true,
              cache: { videoCount: 1, sceneCount: 1, estimatedBytes: 512, evictionCount: 0 },
              metrics: { staleMessageDropCount: 0, saveAttemptCount: 0 },
              scene: { objects: [{ type: 'fabric.Path' }] },
              fabricJSON: { version: '7.4.0' }
            };
          }
          return undefined;
        }
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
      if (!focusable) this.focused = false;
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

function readFabricMethodPayload(script, method) {
  const marker = `.${method}(`;
  const start = script.indexOf(marker);
  if (start < 0) return null;
  const argument = script.slice(start + marker.length, script.lastIndexOf(');'));
  return argument ? JSON.parse(argument) : null;
}

test('exposes the MPV overlay Fabric drawing host capability API', () => {
  const { host } = createDrawingHostHarness();

  assert.equal(typeof host.getDrawingCapability, 'function');
  assert.equal(typeof host.setDrawingInput, 'function');
  assert.equal(typeof host.updateDrawingTool, 'function');
  assert.equal(typeof host.applyDrawingAction, 'function');
  assert.equal(typeof host.getDrawingDiagnostics, 'function');
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
  assert.equal(windows[0].options.webPreferences.preload, undefined);
  assert.ok(result.drawingCapability, 'ensure should return the current drawing capability');
  assert.equal(result.drawingCapability.hostGeneration, 1);
  assert.equal(result.drawingCapability.passiveReady, true);
  assert.equal(result.drawingCapability.fabricReady, false);
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

test('returns focus to the main window and relays keyboard input while the drawing overlay owns focus', async () => {
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
    shift: false,
    control: true,
    alt: false,
    meta: false,
    isAutoRepeat: true
  });

  assert.equal(prevented, true);
  assert.deepEqual(events, [
    ['mainWindow.focus'],
    ['mainWindow.sendInputEvent', {
      type: 'keyDown',
      keyCode: 'b',
      modifiers: ['control', 'isAutoRepeat']
    }]
  ]);

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
  assert.ok(ignoreIndex >= 0);
  assert.ok(focusableDisableIndex > ignoreIndex);
  assert.ok(mainFocusIndex > focusableDisableIndex);
});

test('canonicalizes overlay keys, drops IME composition, and never steals focus after Alt-Tab', async () => {
  const { host, events, windows } = createDrawingHostHarness();
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

  assert.equal(emitKey({ key: ' ' }), true);
  assert.equal(emitKey({ key: 'ArrowLeft' }), true);
  const eventCountBeforeComposition = events.length;
  assert.equal(emitKey({ key: 'Process', code: 'KeyR', isComposing: true }), false);
  assert.equal(emitKey({ key: 'Dead', code: 'Quote' }), false);
  assert.equal(events.length, eventCountBeforeComposition);
  assert.deepEqual(events.filter(([name]) => name === 'mainWindow.sendInputEvent'), [
    ['mainWindow.sendInputEvent', { type: 'keyDown', keyCode: 'Space', modifiers: [] }],
    ['mainWindow.sendInputEvent', { type: 'keyDown', keyCode: 'Left', modifiers: [] }]
  ]);

  events.length = 0;
  windows[0].focused = false;
  await host.setDrawingInput(makeDrawingInput(hostGeneration, {
    inputRevision: 3,
    enabled: false
  }));
  assert.equal(events.some(([name]) => name === 'mainWindow.focus'), false);
  assert.equal(events.some(([name, value]) => name === 'setFocusable' && value === false), true);
});

test('leaves the original overlay key untouched when forwarding fails', async () => {
  const { host, events, windows } = createDrawingHostHarness({
    sendInputEventError: new Error('synthetic forwarding failure')
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
  }, { type: 'keyDown', key: 'v' }));
  assert.equal(prevented, false);
  assert.equal(events.some(([name]) => name === 'mainWindow.sendInputEvent'), true);
});

test('rejects stale host video input session and tool revisions at the host boundary', async () => {
  const { host } = createDrawingHostHarness();
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
  assert.deepEqual(diagnostics.cache, {
    videoCount: 1,
    sceneCount: 1,
    estimatedBytes: 512,
    evictionCount: 0
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /fabricJSON|objects|scene\s*:/i);
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
      runtimeRequests.push(request);
      if (request.enabled) {
        return lateEnable.promise.then((result) => {
          runtimeEnabled = true;
          return result;
        });
      }
      runtimeEnabled = false;
      return { accepted: true, enabled: false };
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
  assert.equal(state.onionDataUrl, '');
  assert.equal(state.markerHtml, '<div class="comment-marker"></div>');
  assert.equal(state.tooltipHtml, '<div class="comment-marker-tooltip visible"></div>');
  assert.equal(state.htmlOverlayHtml, '<div class="current-cut-overlay">Cut 01</div>');
  assert.equal(state.toastHtml, '<div class="toast-container"><div class="toast success">Saved</div></div>');
  assert.equal(state.remoteCursorHtml, '<div class="remote-cursor"></div>');
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
  assert.equal(overlayHtml.includes('__applyMpvRemoteCursorState'), true);
  assert.equal(overlayHtml.includes('.remote-cursors-container'), true);
  assert.equal(overlayHtml.includes("applyImage('drawingCanvasMirror', nextState.drawingDataUrl, nextState.canvas)"), true);
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
  assert.equal(overlayHtml.includes('applyRemoteCursorHtml(nextState.remoteCursorHtml)'), true);
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
    remoteCursorHtml: '<div class="remote-cursor" style="display:block"></div>',
    drawingDataUrl: 'data:image/png;base64,draw',
    canvas: { left: 1, top: 2, width: 3, height: 4 }
  });

  assert.equal(result.success, true);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /window\.__applyMpvOverlayState/);
  assert.match(scripts[0], /comment-marker pending/);
  assert.match(scripts[0], /current-cut-overlay/);
  assert.match(scripts[0], /toast info/);
  assert.match(scripts[0], /remote-cursor/);
  assert.match(scripts[0], /data:image\/png;base64,draw/);

  const cursorOnlyResult = await host.updateRemoteCursorState('<div class="remote-cursor" style="display:block"></div>');
  assert.equal(cursorOnlyResult.success, true);
  assert.equal(scripts.length, 2);
  assert.match(scripts[1], /window\.__applyMpvRemoteCursorState/);
  assert.match(scripts[1], /remote-cursor/);
  assert.doesNotMatch(scripts[1], /drawingDataUrl|markerHtml|toastHtml/);
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
        executeJavaScript: async () => true
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
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar button\s*\{[^}]*min-width:\s*40px[^}]*min-height:\s*40px/s);
  assert.match(hostSource, /button\[data-active="true"\]\s*\{/);
  assert.match(hostSource, /\.mpv-fabric-pilot-toolbar button:active\s*\{[^}]*transform:\s*scale\(0\.96\)/s);
  assert.match(hostSource, /\.mpv-fabric-pilot-badge\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  assert.doesNotMatch(
    hostSource,
    /\.mpv-fabric-pilot-toolbar(?: button)?\s*\{[^}]*transition:\s*all\b/s
  );
});

test('Fabric 수동 검증 HUD는 항상 존재하며 click-through textContent로만 갱신된다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const hostSource = fs.readFileSync(path.join(__dirname, '../../main/mpv-overlay-host.js'), 'utf8');

  assert.match(hostSource, /#fabricPilotStatusMirror\s*\{[^}]*top:\s*12px;[^}]*right:\s*12px;[^}]*pointer-events:\s*none;/s);
  assert.match(hostSource, /<div id="fabricPilotStatusMirror"[^>]*><\/div>/);

  const applyStatusBlock = hostSource.match(
    /const fabricPilotStatusMirror = document\.getElementById\('fabricPilotStatusMirror'\);([\s\S]*?)\n\s*if \(nextState\.fabricViewport !== undefined\)/
  )?.[1] || '';
  assert.match(applyStatusBlock, /if \(nextState\.fabricPilotStatusText !== undefined\)/);
  assert.match(applyStatusBlock, /fabricPilotStatusMirror\.textContent = statusText;/);
  assert.match(applyStatusBlock, /fabricPilotStatusMirror\.style\.display = statusText \? 'block' : 'none';/);
  assert.doesNotMatch(applyStatusBlock, /innerHTML/);
});

test('Fabric 수동 검증 HUD 상태는 512자로 제한되고 생략 시 기존 값을 보존한다', () => {
  const longStatus = '상'.repeat(600);
  const normalized = normalizeOverlayState({ fabricPilotStatusText: longStatus });
  assert.equal(normalized.fabricPilotStatusText, longStatus.slice(0, 512));

  const partial = normalizeOverlayState({ markerHtml: '<div></div>' });
  assert.equal(partial.fabricPilotStatusText, undefined);
  assert.doesNotMatch(JSON.stringify(partial), /fabricPilotStatusText/);
});
