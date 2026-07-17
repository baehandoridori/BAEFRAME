const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const controllerPath = path.join(
  rootDir,
  'renderer/scripts/modules/fabric-drawing-pilot-controller.js'
);
const diagnosticsRunnerPath = path.join(rootDir, 'scripts/run-fabric-drawing-pilot-diagnostics.js');
const {
  createFabricOverlayRuntime
} = require('../../renderer/scripts/modules/mpv-fabric-overlay-runtime.js');
const { MPVOverlayHost } = require('../../main/mpv-overlay-host.js');
const { validateDiagnostics, runCli } = require('../run-fabric-drawing-pilot-diagnostics.js');
const appPackage = require('../../package.json');

let createFabricDrawingPilotController;

before(async () => {
  ({ createFabricDrawingPilotController } = await import(pathToFileURL(controllerPath).href));
});

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.listeners = new Map();
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, event = {}) {
    const payload = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      setPointerCapture() {},
      releasePointerCapture() {},
      ...event
    };
    for (const listener of this.listeners.get(type) || []) listener(payload);
  }

  querySelectorAllByClass(className) {
    const matches = this.className.split(/\s+/).includes(className) ? [this] : [];
    return matches.concat(
      this.children.flatMap((child) => child.querySelectorAllByClass(className))
    );
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

class FakePath {
  constructor(pathData, options = {}) {
    this.pathData = pathData;
    this.left = 0;
    this.top = 0;
    this.scaleX = 1;
    this.scaleY = 1;
    this.angle = 0;
    this.skewX = 0;
    this.skewY = 0;
    Object.assign(this, options);
  }

  set(values) {
    Object.assign(this, values);
    return this;
  }

  setCoords() {}
}

class FakeCanvas {
  static instances = [];

  constructor(element, options) {
    this.lowerCanvasEl = element;
    this.upperCanvasEl = element;
    this.wrapperEl = new FakeElement('div', element.ownerDocument);
    this.options = options;
    this.selection = options.selection;
    this.isDrawingMode = false;
    this.objects = [];
    this.activeObjects = [];
    this.activeObject = null;
    this.listeners = new Map();
    this.disposed = false;
    FakeCanvas.instances.push(this);
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  add(object) {
    this.objects.push(object);
    return object;
  }

  remove(object) {
    this.objects = this.objects.filter((candidate) => candidate !== object);
    this.activeObjects = this.activeObjects.filter((candidate) => candidate !== object);
  }

  clear() {
    this.objects = [];
    this.activeObjects = [];
  }

  getObjects() {
    return [...this.objects];
  }

  getActiveObjects() {
    return [...this.activeObjects];
  }

  getActiveObject() {
    return this.activeObject || this.activeObjects[0] || null;
  }

  discardActiveObject() {
    this.activeObjects = [];
    this.activeObject = null;
  }

  setDimensions(dimensions, options = {}) {
    if (options.backstoreOnly) {
      this.lowerCanvasEl.width = dimensions.width;
      this.lowerCanvasEl.height = dimensions.height;
      this.upperCanvasEl.width = dimensions.width;
      this.upperCanvasEl.height = dimensions.height;
    }
    if (options.cssOnly) {
      for (const element of [this.lowerCanvasEl, this.upperCanvasEl, this.wrapperEl]) {
        element.style.width = `${dimensions.width}px`;
        element.style.height = `${dimensions.height}px`;
      }
    }
  }

  calcOffset() {}

  requestRenderAll() {}

  dispose() {
    this.disposed = true;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitForDetachedControllerAction() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createKeyEvent(key) {
  const calls = [];
  return {
    key,
    target: { tagName: 'DIV', isContentEditable: false },
    preventDefault() {
      calls.push('preventDefault');
    },
    stopImmediatePropagation() {
      calls.push('stopImmediatePropagation');
    },
    calls
  };
}

function drawStroke(element, pointerId) {
  element.dispatch('pointerdown', {
    pointerId,
    pointerType: 'pen',
    button: 0,
    clientX: 10,
    clientY: 20,
    pressure: 0.2,
    timeStamp: 1
  });
  element.dispatch('pointermove', {
    pointerId,
    pointerType: 'pen',
    clientX: 30,
    clientY: 40,
    pressure: 0.8,
    timeStamp: 2
  });
  element.dispatch('pointerup', {
    pointerId,
    pointerType: 'pen',
    clientX: 50,
    clientY: 60,
    pressure: 0.6,
    timeStamp: 3
  });
}

function snapshotBframe(filePath) {
  const data = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function counterSnapshot(ledger, toggleCount, duplicateActionCount) {
  return {
    toggleCount,
    saveReview: ledger.saveReview,
    reviewDataManagerSave: ledger.reviewDataManagerSave,
    mpvLoad: ledger.mpvLoad,
    mpvPlay: ledger.mpvPlay,
    mpvPause: ledger.mpvPause,
    mpvDestroyEmbed: ledger.mpvDestroyEmbed,
    mpvDestroyOverlay: ledger.mpvDestroyOverlay,
    timelineMutation: ledger.timelineMutation,
    duplicateAction: duplicateActionCount
  };
}

function controllerSnapshot(diagnostics) {
  return {
    videoGeneration: diagnostics.videoGeneration,
    inputRevision: diagnostics.inputRevision,
    sessionId: diagnostics.sessionId
  };
}

function createRuntimeControllerHarness() {
  FakeCanvas.instances = [];
  const documentRef = new FakeDocument();
  const root = documentRef.createElement('div');
  const runtime = createFabricOverlayRuntime({
    fabric: { Canvas: FakeCanvas, Path: FakePath },
    document: documentRef,
    now: () => 1
  });
  assert.deepEqual(runtime.prepare(root), { prepared: true, reused: false });

  const ledger = {
    saveReview: 0,
    reviewDataManagerSave: 0,
    mpvLoad: 0,
    mpvPlay: 0,
    mpvPause: 0,
    mpvDestroyEmbed: 0,
    mpvDestroyOverlay: 0,
    timelineMutation: 0,
    input: 0,
    tool: 0,
    action: 0
  };
  const playbackCanaries = {
    owner: { identity: 'mpv-playback-owner-1' },
    mediaInstance: { identity: 'video-element-1' },
    timeline: {
      duration: 240,
      currentFrame: 12,
      playlistContinuousOffset: 480
    }
  };
  const forbidden = (name) => () => {
    ledger[name] += 1;
    throw new Error(`${name} must not be called by the Fabric drawing pilot`);
  };
  let uuid = 0;
  const electronAPI = {
    async getFabricDrawingPilotState() {
      return true;
    },
    async mpvSetOverlayDrawingInput(request) {
      ledger.input += 1;
      const result = runtime.setDrawingInput(request);
      return {
        success: result.accepted === true,
        accepted: result.accepted === true,
        enabled: result.enabled === true,
        restored: result.restored === true
      };
    },
    async mpvUpdateOverlayDrawingTool(request) {
      ledger.tool += 1;
      const result = runtime.updateDrawingTool(request);
      return {
        success: result.accepted === true,
        accepted: result.accepted === true,
        tool: result.tool
      };
    },
    async mpvApplyOverlayDrawingAction(request) {
      ledger.action += 1;
      const result = runtime.applyDrawingAction(request);
      return {
        success: result.applied === true || result.duplicate === true,
        ...result
      };
    },
    async mpvGetOverlayDrawingDiagnostics() {
      return { success: true, ...runtime.getDiagnostics() };
    },
    saveReview: forbidden('saveReview'),
    reviewDataManagerSave: forbidden('reviewDataManagerSave'),
    mpvLoad: forbidden('mpvLoad'),
    mpvPlay: forbidden('mpvPlay'),
    mpvPause: forbidden('mpvPause'),
    mpvDestroyEmbed: forbidden('mpvDestroyEmbed'),
    mpvDestroyOverlay: forbidden('mpvDestroyOverlay')
  };
  const controller = createFabricDrawingPilotController({
    electronAPI,
    getContext: () => ({
      isMpvActive: true,
      isAudio: false,
      stableVideoIdentity: 'integration-video',
      targetFrame: playbackCanaries.timeline.currentFrame,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 960, height: 540 },
      playbackOwner: playbackCanaries.owner,
      mediaInstance: playbackCanaries.mediaInstance,
      timeline: playbackCanaries.timeline
    }),
    uuid: () => `integration-${++uuid}`
  });

  return {
    controller,
    ledger,
    playbackCanaries,
    root,
    runtime
  };
}

function createHostLifecycleHarness() {
  const events = [];
  const windows = [];
  const bundleSource = '/* fixed Fabric integration bundle */';
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    on() {},
    off() {}
  };

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.identity = `window-${windows.length + 1}`;
      this.destroyed = false;
      this.listeners = new Map();
      this.webContentsListeners = new Map();
      this.webContents = {
        on: (eventName, handler) => {
          this.webContentsListeners.set(eventName, handler);
        },
        executeJavaScript: async (script) => {
          if (script.includes("typeof window.__applyMpvOverlayState === 'function'")) return true;
          if (script === bundleSource) return true;
          if (script.includes('.prepare(')) return { prepared: true, reused: false };
          if (script.includes('.setDrawingInput(')) {
            return {
              accepted: true,
              enabled: script.includes('"enabled":true'),
              restored: false
            };
          }
          return undefined;
        }
      };
      windows.push(this);
      events.push(['construct']);
    }

    loadURL() {
      events.push(['loadURL']);
      return Promise.resolve();
    }

    setBounds() {
      events.push(['setBounds']);
    }

    setIgnoreMouseEvents() {}

    showInactive() {
      events.push(['show']);
    }

    hide() {
      events.push(['hide']);
    }

    moveTop() {
      events.push(['moveTop']);
    }

    isDestroyed() {
      return this.destroyed;
    }

    on(eventName, handler) {
      this.listeners.set(eventName, handler);
    }

    destroy() {
      this.destroyed = true;
      events.push(['destroy']);
    }
  }

  const host = new MPVOverlayHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    fabricBundlePath: 'fixed/mpv-fabric-overlay.iife.js',
    readFile: async () => bundleSource
  });

  function snapshot() {
    const count = (name) => events.filter(([eventName]) => eventName === name).length;
    return {
      construct: count('construct'),
      loadURL: count('loadURL'),
      setBounds: count('setBounds'),
      show: count('show'),
      hide: count('hide'),
      moveTop: count('moveTop'),
      destroy: count('destroy'),
      generation: host.getDrawingCapability().hostGeneration,
      windowIdentity: host.window?.identity || null
    };
  }

  return { host, snapshot, windows };
}

async function runDeferredStaleGenerationProbe() {
  const staleDisable = deferred();
  const requests = [];
  let uuid = 0;
  const controller = createFabricDrawingPilotController({
    electronAPI: {
      async getFabricDrawingPilotState() {
        return true;
      },
      async mpvSetOverlayDrawingInput(request) {
        requests.push(request);
        if (request.videoGeneration === 2 && request.enabled === false) {
          return staleDisable.promise;
        }
        return { success: true, accepted: true, enabled: request.enabled };
      },
      async mpvUpdateOverlayDrawingTool(request) {
        return { success: true, accepted: true, tool: request.tool };
      },
      async mpvApplyOverlayDrawingAction() {
        return { success: true, applied: false, deletedCount: 0 };
      }
    },
    getContext: () => ({
      isMpvActive: true,
      isAudio: false,
      stableVideoIdentity: 'stale-video-initial',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasRect: { left: 0, top: 0, width: 960, height: 540 }
    }),
    uuid: () => `stale-${++uuid}`
  });

  assert.equal(await controller.initialize(), true);
  assert.equal(
    await controller.adoptOverlayCapability({
      passiveReady: true,
      hostGeneration: 1
    }),
    true
  );
  assert.equal(
    await controller.afterVideoReady({
      loadToken: 'load-initial',
      stableVideoIdentity: 'stale-video-initial'
    }),
    true
  );
  assert.equal(await controller.toggle(), true);
  assert.equal(await controller.beforeVideoChange('load-n'), true);

  const lateGenerationReady = controller.afterVideoReady({
    loadToken: 'load-n',
    stableVideoIdentity: 'stale-video-n',
    targetFrame: 20
  });
  await waitForDetachedControllerAction();
  assert.equal(requests.at(-1).videoGeneration, 2);
  assert.equal(requests.at(-1).enabled, false);

  assert.equal(await controller.beforeVideoChange('load-n-plus-1'), true);
  assert.equal(
    await controller.afterVideoReady({
      loadToken: 'load-n-plus-1',
      stableVideoIdentity: 'stale-video-n-plus-1',
      targetFrame: 21
    }),
    true
  );
  const newerSnapshot = await controller.diagnostics();
  assert.equal(newerSnapshot.videoGeneration, 3);
  assert.equal(newerSnapshot.state, 'active');
  const expectedSessionId = newerSnapshot.sessionId;

  staleDisable.resolve({ success: true, accepted: true, enabled: false });
  const lateAccepted = await lateGenerationReady;
  const finalSnapshot = await controller.diagnostics();

  assert.equal(lateAccepted, false);
  assert.equal(finalSnapshot.videoGeneration, 3);
  assert.equal(finalSnapshot.sessionId, expectedSessionId);
  assert.equal(finalSnapshot.state, 'active');

  return {
    olderGeneration: 2,
    newerGeneration: 3,
    lateAccepted,
    activeGeneration: finalSnapshot.videoGeneration,
    activeSessionId: finalSnapshot.sessionId,
    expectedSessionId
  };
}

function makeValidRawDiagnostics() {
  const before = {
    file: {
      sha256: 'a'.repeat(64),
      size: 128,
      mtimeMs: 1234.5
    },
    controller: {
      videoGeneration: 1,
      inputRevision: 1,
      sessionId: null
    },
    counters: {
      toggleCount: 0,
      saveReview: 0,
      reviewDataManagerSave: 0,
      mpvLoad: 0,
      mpvPlay: 0,
      mpvPause: 0,
      mpvDestroyEmbed: 0,
      mpvDestroyOverlay: 0,
      timelineMutation: 0,
      duplicateAction: 0
    },
    host: {
      construct: 1,
      loadURL: 1,
      setBounds: 1,
      show: 1,
      hide: 0,
      moveTop: 1,
      destroy: 0,
      generation: 1,
      windowIdentity: 'window-1'
    },
    playbackOwner: 'mpv-playback-owner-1',
    mediaInstanceIdentity: 'video-element-1',
    timeline: {
      duration: 240,
      currentFrame: 12,
      playlistContinuousOffset: 480
    }
  };
  const after = structuredClone(before);
  after.controller.inputRevision = 101;
  after.counters.toggleCount = 100;

  return {
    before,
    after,
    staleProbe: {
      olderGeneration: 2,
      newerGeneration: 3,
      lateAccepted: false,
      activeGeneration: 3,
      activeSessionId: 'session-new',
      expectedSessionId: 'session-new'
    }
  };
}

test('synthetic controller/runtime boundary preserves no-save, playback, owner, media, and timeline canaries', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-fabric-drawing-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const bframePath = path.join(tempDir, 'integration-evidence.bframe');
  fs.writeFileSync(bframePath, JSON.stringify({ review: 'immutable integration fixture' }));

  const hostHarness = createHostLifecycleHarness();
  const ensured = await hostHarness.host.ensure({ x: 0, y: 0, width: 960, height: 540 });
  assert.equal(ensured.success, true);
  const hostWindow = hostHarness.host.window;
  const hostBefore = hostHarness.snapshot();
  for (let index = 0; index < 100; index += 1) {
    const enabled = index % 2 === 1;
    const request = {
      hostGeneration: hostBefore.generation,
      videoGeneration: 1,
      inputRevision: index + 1,
      enabled
    };
    if (enabled) {
      request.session = {
        sessionId: `host-session-${index}`,
        stableVideoIdentity: 'host-video',
        targetFrame: 12,
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 960, height: 540 },
        tool: 'brush'
      };
    }
    const result = await hostHarness.host.setDrawingInput(request);
    assert.equal(result.success, true);
    assert.equal(result.accepted, true);
  }
  const hostAfter = hostHarness.snapshot();
  assert.equal(hostHarness.windows.length, 1);
  assert.equal(hostHarness.host.window, hostWindow);
  assert.deepEqual(hostAfter, hostBefore);

  const harness = createRuntimeControllerHarness();
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(
    await harness.controller.adoptOverlayCapability({
      passiveReady: true,
      hostGeneration: 1
    }),
    true
  );
  assert.equal(await harness.controller.afterVideoReady({ loadToken: 'load-integration' }), true);
  const controllerBeforeDiagnostics = await harness.controller.diagnostics();
  const runtimeBefore = harness.runtime.getDiagnostics();
  const fileBefore = snapshotBframe(bframePath);
  const canariesBefore = {
    playbackOwner: harness.playbackCanaries.owner.identity,
    mediaInstanceIdentity: harness.playbackCanaries.mediaInstance.identity,
    timeline: { ...harness.playbackCanaries.timeline }
  };
  const countersBefore = counterSnapshot(
    harness.ledger,
    0,
    runtimeBefore.metrics.duplicateActionCount
  );
  let runtimeMutationEvidence = 0;

  for (let index = 0; index < 100; index += 1) {
    assert.equal(await harness.controller.toggle(), true);
    if (index !== 0) continue;

    const canvas = FakeCanvas.instances.at(-1);
    drawStroke(canvas.upperCanvasEl, 1);
    assert.equal(harness.runtime.getDiagnostics().objectCount, 1);

    const selectEvent = createKeyEvent('V');
    assert.equal(harness.controller.routeKeydown(selectEvent), true);
    await waitForDetachedControllerAction();
    assert.deepEqual(selectEvent.calls, ['preventDefault', 'stopImmediatePropagation']);
    assert.equal(harness.runtime.getDiagnostics().tool, 'select');

    const selected = canvas.getObjects()[0];
    canvas.activeObjects = [selected];
    canvas.activeObject = selected;
    canvas.emit('selection:created', { selected: [selected], deselected: [] });
    const mutationCountBeforeMove = harness.runtime.getDiagnostics().mutationCount;
    canvas.emit('before:transform', { target: selected, transform: { target: selected } });
    selected.left += 8;
    selected.top -= 3;
    canvas.emit('object:modified', { target: selected });
    assert.equal(selected.left, 8);
    assert.equal(selected.top, -3);
    assert.ok(harness.runtime.getDiagnostics().mutationCount > mutationCountBeforeMove);

    const deleteEvent = createKeyEvent('Delete');
    assert.equal(harness.controller.routeKeydown(deleteEvent), true);
    await waitForDetachedControllerAction();
    assert.deepEqual(deleteEvent.calls, ['preventDefault', 'stopImmediatePropagation']);
    assert.equal(harness.runtime.getDiagnostics().objectCount, 0);

    const toolbar = harness.root.children[0].children[1];
    const brushButton = toolbar.children.find(
      (child) => child.dataset.fabricPilotAction === 'brush'
    );
    const clearButton = toolbar.children.find(
      (child) => child.dataset.fabricPilotAction === 'clear-session'
    );
    brushButton.dispatch('click');
    drawStroke(canvas.upperCanvasEl, 2);
    assert.equal(harness.runtime.getDiagnostics().objectCount, 1);
    clearButton.dispatch('click');
    assert.equal(harness.runtime.getDiagnostics().objectCount, 0);
    runtimeMutationEvidence = harness.runtime.getDiagnostics().mutationCount;
  }

  const runtimeAfter = harness.runtime.getDiagnostics();
  const controllerAfterDiagnostics = await harness.controller.diagnostics();
  const fileAfter = snapshotBframe(bframePath);
  const canariesAfter = {
    playbackOwner: harness.playbackCanaries.owner.identity,
    mediaInstanceIdentity: harness.playbackCanaries.mediaInstance.identity,
    timeline: { ...harness.playbackCanaries.timeline }
  };
  const countersAfter = counterSnapshot(
    harness.ledger,
    100,
    runtimeAfter.metrics.duplicateActionCount
  );
  const staleProbe = await runDeferredStaleGenerationProbe();
  const raw = {
    before: {
      file: fileBefore,
      controller: controllerSnapshot(controllerBeforeDiagnostics),
      counters: countersBefore,
      host: hostBefore,
      ...canariesBefore
    },
    after: {
      file: fileAfter,
      controller: controllerSnapshot(controllerAfterDiagnostics),
      counters: countersAfter,
      host: hostAfter,
      ...canariesAfter
    },
    staleProbe
  };
  const report = validateDiagnostics(raw);

  assert.deepEqual(report.violations, []);
  assert.deepEqual(report, {
    hostCreateCount: 1,
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 101,
    sessionId: null,
    toggleCount: 100,
    playbackCommandDelta: 0,
    saveAttemptDelta: 0,
    timelineMutationDelta: 0,
    duplicateActionCount: 0,
    violations: []
  });
  assert.equal(harness.ledger.input, 101, 'one setup disable plus exactly 100 controller toggles');
  assert.equal(harness.ledger.tool, 1, 'V crosses the real controller/runtime bridge once');
  assert.equal(harness.ledger.action, 1, 'Delete crosses the real controller/runtime bridge once');
  assert.equal(
    runtimeMutationEvidence >= 4,
    true,
    'stroke, move, Delete, and Clear mutated only runtime memory'
  );
});

test('a late generation N response cannot reactivate or replace the ready N+1 session', async () => {
  const staleProbe = await runDeferredStaleGenerationProbe();

  assert.deepEqual(staleProbe, {
    olderGeneration: 2,
    newerGeneration: 3,
    lateAccepted: false,
    activeGeneration: 3,
    activeSessionId: staleProbe.expectedSessionId,
    expectedSessionId: staleProbe.expectedSessionId
  });
  assert.match(staleProbe.expectedSessionId, /^stale-\d+$/);
});

test('validator rejects playback, save, host, file, owner, media, timeline, controller, and stale mutations', () => {
  const cases = [
    [
      'playback command',
      /playback/i,
      (raw) => {
        raw.after.counters.mpvPlay += 1;
      }
    ],
    [
      'saveReview',
      /save/i,
      (raw) => {
        raw.after.counters.saveReview += 1;
      }
    ],
    [
      'ReviewDataManager.save',
      /save/i,
      (raw) => {
        raw.after.counters.reviewDataManagerSave += 1;
      }
    ],
    [
      'host construct',
      /host/i,
      (raw) => {
        raw.after.host.construct += 1;
      }
    ],
    [
      'host baseline is not a single fresh host',
      /host/i,
      (raw) => {
        for (const snapshot of [raw.before.host, raw.after.host]) {
          snapshot.construct = 2;
          snapshot.loadURL = 2;
          snapshot.destroy = 1;
          snapshot.generation = 2;
        }
      }
    ],
    [
      'host generation is inconsistent with construction count',
      /host/i,
      (raw) => {
        raw.before.host.generation = 7;
        raw.after.host.generation = 7;
      }
    ],
    [
      'host generation',
      /host/i,
      (raw) => {
        raw.after.host.generation += 1;
      }
    ],
    [
      'host window identity',
      /host/i,
      (raw) => {
        raw.after.host.windowIdentity = 'window-2';
      }
    ],
    [
      'file SHA-256',
      /file.*sha|sha.*file/i,
      (raw) => {
        raw.after.file.sha256 = 'b'.repeat(64);
      }
    ],
    [
      'file size',
      /file.*size|size.*file/i,
      (raw) => {
        raw.after.file.size += 1;
      }
    ],
    [
      'file mtime',
      /file.*mtime|mtime.*file/i,
      (raw) => {
        raw.after.file.mtimeMs += 1;
      }
    ],
    [
      'playback owner',
      /owner/i,
      (raw) => {
        raw.after.playbackOwner = 'owner-2';
      }
    ],
    [
      'media instance',
      /media/i,
      (raw) => {
        raw.after.mediaInstanceIdentity = 'video-element-2';
      }
    ],
    [
      'timeline duration',
      /timeline/i,
      (raw) => {
        raw.after.timeline.duration += 1;
      }
    ],
    [
      'timeline current frame',
      /timeline/i,
      (raw) => {
        raw.after.timeline.currentFrame += 1;
      }
    ],
    [
      'playlist offset',
      /timeline/i,
      (raw) => {
        raw.after.timeline.playlistContinuousOffset += 1;
      }
    ],
    [
      'timeline mutation ledger',
      /timeline/i,
      (raw) => {
        raw.after.counters.timelineMutation += 1;
      }
    ],
    [
      'toggle count',
      /toggle/i,
      (raw) => {
        raw.after.counters.toggleCount = 99;
      }
    ],
    [
      'input revision',
      /input revision/i,
      (raw) => {
        raw.after.controller.inputRevision = 102;
      }
    ],
    [
      'video generation',
      /video generation/i,
      (raw) => {
        raw.after.controller.videoGeneration = 2;
      }
    ],
    [
      'zero video generation',
      /videoGeneration|video generation/i,
      (raw) => {
        raw.before.controller.videoGeneration = 0;
        raw.after.controller.videoGeneration = 0;
      }
    ],
    [
      'negative timeline duration',
      /timeline|duration/i,
      (raw) => {
        raw.before.timeline.duration = -1;
        raw.after.timeline.duration = -1;
      }
    ],
    [
      'negative timeline current frame',
      /timeline|currentFrame/i,
      (raw) => {
        raw.before.timeline.currentFrame = -1;
        raw.after.timeline.currentFrame = -1;
      }
    ],
    [
      'negative playlist continuous offset',
      /timeline|playlistContinuousOffset/i,
      (raw) => {
        raw.before.timeline.playlistContinuousOffset = -1;
        raw.after.timeline.playlistContinuousOffset = -1;
      }
    ],
    [
      'session residue',
      /session/i,
      (raw) => {
        raw.after.controller.sessionId = 'left-active';
      }
    ],
    [
      'duplicate action',
      /duplicate/i,
      (raw) => {
        raw.after.counters.duplicateAction += 1;
      }
    ],
    [
      'late stale acceptance',
      /stale/i,
      (raw) => {
        raw.staleProbe.lateAccepted = true;
      }
    ],
    [
      'stale active generation',
      /stale/i,
      (raw) => {
        raw.staleProbe.activeGeneration = 2;
      }
    ],
    [
      'stale generation jump',
      /stale/i,
      (raw) => {
        raw.staleProbe.newerGeneration = 99;
        raw.staleProbe.activeGeneration = 99;
      }
    ],
    [
      'stale active session',
      /stale/i,
      (raw) => {
        raw.staleProbe.activeSessionId = 'session-old';
      }
    ]
  ];

  for (const [name, expectedViolation, mutate] of cases) {
    const raw = makeValidRawDiagnostics();
    mutate(raw);
    const report = validateDiagnostics(raw);
    assert.notEqual(report.violations.length, 0, `${name} must be rejected`);
    assert.match(
      report.violations.join('\n'),
      expectedViolation,
      `${name} must identify its invariant`
    );
  }
});

test('validator rejects missing and malformed raw before/after/staleProbe fields without throwing', () => {
  const malformed = [
    null,
    {},
    { before: {}, after: {}, staleProbe: {} },
    (() => {
      const raw = makeValidRawDiagnostics();
      delete raw.after.file.sha256;
      return raw;
    })(),
    (() => {
      const raw = makeValidRawDiagnostics();
      raw.before.counters.mpvLoad = '0';
      return raw;
    })(),
    (() => {
      const raw = makeValidRawDiagnostics();
      raw.after.timeline.duration = Number.NaN;
      return raw;
    })(),
    (() => {
      const raw = makeValidRawDiagnostics();
      raw.staleProbe.lateAccepted = 'false';
      return raw;
    })()
  ];

  for (const raw of malformed) {
    const report = validateDiagnostics(raw);
    assert.notEqual(report.violations.length, 0);
    assert.match(report.violations.join('\n'), /missing|malformed/i);
  }
});

test('CLI reads raw JSON, emits only the bounded summary, and exits 1 for violations', () => {
  assert.equal(typeof runCli, 'function');
  const valid = spawnSync(process.execPath, [diagnosticsRunnerPath], {
    cwd: rootDir,
    input: JSON.stringify(makeValidRawDiagnostics()),
    encoding: 'utf8'
  });
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  const validOutput = JSON.parse(valid.stdout);
  assert.deepEqual(Object.keys(validOutput), [
    'hostCreateCount',
    'hostGeneration',
    'videoGeneration',
    'inputRevision',
    'sessionId',
    'toggleCount',
    'playbackCommandDelta',
    'saveAttemptDelta',
    'timelineMutationDelta',
    'duplicateActionCount',
    'violations'
  ]);
  assert.deepEqual(validOutput.violations, []);
  assert.doesNotMatch(valid.stdout, /sha256|playbackOwner|mediaInstanceIdentity|windowIdentity/);

  const invalidRaw = makeValidRawDiagnostics();
  invalidRaw.after.counters.mpvPause += 1;
  const invalid = spawnSync(process.execPath, [diagnosticsRunnerPath], {
    cwd: rootDir,
    input: JSON.stringify(invalidRaw),
    encoding: 'utf8'
  });
  assert.equal(invalid.status, 1, invalid.stderr || invalid.stdout);
  assert.notEqual(JSON.parse(invalid.stdout).violations.length, 0);

  const semanticallyImpossible = makeValidRawDiagnostics();
  for (const snapshot of [semanticallyImpossible.before, semanticallyImpossible.after]) {
    snapshot.host.construct = 2;
    snapshot.host.loadURL = 2;
    snapshot.host.destroy = 1;
    snapshot.host.generation = 7;
    snapshot.controller.videoGeneration = 0;
    snapshot.timeline.duration = -1;
    snapshot.timeline.currentFrame = -1;
    snapshot.timeline.playlistContinuousOffset = -1;
  }
  semanticallyImpossible.staleProbe.newerGeneration = 99;
  semanticallyImpossible.staleProbe.activeGeneration = 99;
  const impossible = spawnSync(process.execPath, [diagnosticsRunnerPath], {
    cwd: rootDir,
    input: JSON.stringify(semanticallyImpossible),
    encoding: 'utf8'
  });
  assert.equal(impossible.status, 1, impossible.stderr || impossible.stdout);
  assert.notEqual(JSON.parse(impossible.stdout).violations.length, 0);

  const malformed = spawnSync(process.execPath, [diagnosticsRunnerPath], {
    cwd: rootDir,
    input: '{not-json',
    encoding: 'utf8'
  });
  assert.equal(malformed.status, 1, malformed.stderr || malformed.stdout);
  assert.match(JSON.parse(malformed.stdout).violations.join('\n'), /malformed/i);
});

test('package exposes focused Fabric pilot test and diagnostics commands', () => {
  assert.equal(
    appPackage.scripts['test:fabric-drawing-pilot'],
    'node --test scripts/tests/fabric-drawing-pilot-integration.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs'
  );
  assert.equal(
    appPackage.scripts['diagnostics:fabric-drawing-pilot'],
    'node scripts/run-fabric-drawing-pilot-diagnostics.js'
  );
  assert.equal(
    appPackage.scripts.prebuild,
    'npm run bundle:mpv-fabric-overlay',
    'npm run build must regenerate the Fabric browser bundle before packaging'
  );
  assert.equal(
    appPackage.scripts['prebuild:installer'],
    'npm run bundle:mpv-fabric-overlay',
    'npm run build:installer must regenerate the Fabric browser bundle before packaging'
  );
});
