const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const controllerPath = path.join(
  rootDir,
  'renderer/scripts/modules/fabric-drawing-pilot-controller.js'
);
const storePath = path.join(
  rootDir,
  'renderer/scripts/modules/fabric-drawing-persistence-store.js'
);

let createFabricDrawingPilotController;
let createFabricDrawingPersistenceStore;

before(async () => {
  ({ createFabricDrawingPilotController } = await import(pathToFileURL(controllerPath).href));
  ({ createFabricDrawingPersistenceStore } = await import(pathToFileURL(storePath).href));
});

const IDENTITY_TRANSFORM = Object.freeze({
  left: 0,
  top: 0,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  skewX: 0,
  skewY: 0,
  flipX: false,
  flipY: false
});

function makeRecord(id, overrides = {}) {
  return {
    id,
    type: 'stroke',
    pathData: 'M 0 0 Q 5 10 10 10 Z',
    sourcePoints: [
      { x: 0, y: 0, pressure: 0.25, time: 0, pointerType: 'pen' },
      { x: 10, y: 10, pressure: 0.75, time: 8, pointerType: 'pen' }
    ],
    strokeCaps: { start: true, end: true },
    style: {
      color: '#ff4757',
      size: 7.5,
      opacity: 0.65
    },
    transform: { ...IDENTITY_TRANSFORM },
    ...overrides
  };
}

function makeRoot({
  revision = 1,
  keyframes = [{
    id: 'keyframe-12',
    frame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    mutationSequence: 1,
    objects: [makeRecord('stroke-1')]
  }]
} = {}) {
  return {
    storageSchema: 'baeframe-fabric-scenes',
    storageVersion: '1.0.0',
    engine: 'fabric-7',
    documentId: 'fabric-document-1',
    revision,
    fps: 24,
    totalFrames: 240,
    keyframes
  };
}

function clone(value) {
  return structuredClone(value);
}

function snapshotFromHydrate(request) {
  return {
    hostGeneration: request.hostGeneration,
    videoGeneration: request.videoGeneration,
    persistenceSessionId: request.persistenceSessionId,
    stableVideoIdentity: request.stableVideoIdentity,
    fps: request.fps,
    totalFrames: request.totalFrames,
    scenes: request.keyframes.map(keyframe => ({
      sceneInstanceId: `overlay-scene-${keyframe.frame}`,
      targetFrame: keyframe.frame,
      sourceWidth: keyframe.sourceWidth,
      sourceHeight: keyframe.sourceHeight,
      mutationSequence: keyframe.mutationSequence,
      objects: clone(keyframe.objects)
    }))
  };
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushDetachedWork() {
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function createHarness(options = {}) {
  let context = {
    isMpvActive: true,
    isAudio: false,
    stableVideoIdentity: 'C:/shot/scene-001.mov',
    targetFrame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240,
    canvasRect: { left: 0, top: 0, width: 960, height: 540 },
    viewportRevision: 1,
    viewportTransform: { scale: 1, panX: 0, panY: 0 }
  };
  const store = options.store || createFabricDrawingPersistenceStore({
    createId: prefix => `${prefix}-generated`
  });
  if (!options.skipImport) {
    const imported = store.importRootValue(
      options.root === undefined ? makeRoot() : options.root,
      {
        fps: context.fps,
        totalFrames: context.totalFrames,
        stableVideoIdentity: context.stableVideoIdentity
      }
    );
    assert.equal(imported.accepted, options.expectImportAccepted ?? true);
  }

  let persistenceListener = null;
  let runtimeSnapshot = null;
  let exportHandler = null;
  let inputHandler = null;
  let hydrateGate = null;
  const calls = {
    input: [],
    hydrate: [],
    export: [],
    order: []
  };
  const electronAPI = {
    async getFabricDrawingPilotState() {
      return true;
    },
    onFabricDrawingPersistenceEvent(callback) {
      persistenceListener = callback;
      return () => {
        if (persistenceListener === callback) persistenceListener = null;
      };
    },
    async mpvSetOverlayDrawingInput(request) {
      calls.input.push(clone(request));
      calls.order.push(`input:${request.enabled ? 'on' : 'off'}:${request.hostGeneration}`);
      if (inputHandler) return inputHandler(request);
      return { success: true, accepted: true, enabled: request.enabled };
    },
    async mpvUpdateOverlayDrawingTool(request) {
      return { success: true, accepted: true, tool: request.tool };
    },
    async mpvApplyOverlayDrawingAction() {
      return { success: true, applied: false, deletedCount: 0 };
    },
    async mpvHydrateOverlayDrawingVideo(request) {
      calls.hydrate.push(clone(request));
      calls.order.push(`hydrate:${request.hostGeneration}`);
      if (hydrateGate) {
        const gate = hydrateGate;
        hydrateGate = null;
        await gate;
      }
      if (options.onHydrate) return options.onHydrate(request);
      runtimeSnapshot = snapshotFromHydrate(request);
      return {
        success: true,
        accepted: true,
        sceneCount: runtimeSnapshot.scenes.length,
        objectCount: runtimeSnapshot.scenes.reduce(
          (sum, scene) => sum + scene.objects.length,
          0
        )
      };
    },
    async mpvExportOverlayDrawingVideo(request) {
      calls.export.push(clone(request));
      calls.order.push(`export:${request.hostGeneration}`);
      if (exportHandler) return exportHandler(request);
      if (options.onExport) return options.onExport(request);
      return {
        success: true,
        accepted: true,
        snapshot: clone(runtimeSnapshot)
      };
    },
    async mpvGetOverlayDrawingDiagnostics() {
      return { success: true, state: 'passive' };
    }
  };
  const controller = createFabricDrawingPilotController({
    electronAPI,
    getContext: () => ({ ...context }),
    persistenceStore: store,
    persistenceSessionIdFactory:
      options.persistenceSessionIdFactory || (() => 'persistence-session-1'),
    persistenceIpcDeadlineMs: options.persistenceIpcDeadlineMs,
    uuid: (() => {
      let sequence = 0;
      return () => `request-${++sequence}`;
    })()
  });

  return {
    calls,
    controller,
    store,
    emitPersistence(message) {
      assert.equal(typeof persistenceListener, 'function');
      return persistenceListener(clone(message));
    },
    getRuntimeSnapshot() {
      return clone(runtimeSnapshot);
    },
    setContext(patch) {
      context = { ...context, ...patch };
    },
    setExportHandler(handler) {
      exportHandler = handler;
    },
    setHydrateGate(promise) {
      hydrateGate = promise;
    },
    setInputHandler(handler) {
      inputHandler = handler;
    },
    setRuntimeSnapshot(snapshot) {
      runtimeSnapshot = clone(snapshot);
    }
  };
}

async function prepareVideo(harness) {
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 1
  }), true);
  return harness.controller.afterVideoReady({
    loadToken: 'load-a',
    stableVideoIdentity: 'C:/shot/scene-001.mov',
    targetFrame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240
  });
}

test('review hydrate is fenced, silent, and completes before Fabric can own B', async () => {
  const harness = createHarness();
  const changes = [];
  harness.store.subscribe(change => changes.push(change));

  assert.equal(typeof harness.controller.preparePersistenceSnapshotForSave, 'function');
  assert.equal(typeof harness.controller.flushPersistenceBeforeLeave, 'function');
  assert.equal(typeof harness.controller.shouldOwnDrawingShortcut, 'function');
  assert.equal(await prepareVideo(harness), true);

  assert.deepEqual(harness.calls.order.slice(0, 3), [
    'input:off:1',
    'hydrate:1',
    'export:1'
  ]);
  assert.equal(harness.calls.hydrate[0].persistenceSessionId, 'persistence-session-1');
  assert.equal(harness.calls.hydrate[0].keyframes[0].objects[0].id, 'stroke-1');
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), true);
  assert.equal(harness.controller.getState(), 'passive');
  assert.deepEqual(changes, []);

  const b = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(b), true);
  assert.deepEqual(b.calls, ['preventDefault', 'stopImmediatePropagation']);
  await flushDetachedWork();
  assert.equal(harness.controller.getState(), 'active');
});

test('committed transitions update the shared store while stale fences are ignored', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const hydrated = harness.getRuntimeSnapshot();
  const inserted = makeRecord('stroke-2');
  const transition = {
    hostGeneration: 1,
    videoGeneration: 1,
    persistenceSessionId: 'persistence-session-1',
    stableVideoIdentity: 'C:/shot/scene-001.mov',
    scene: {
      sceneInstanceId: hydrated.scenes[0].sceneInstanceId,
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: 2,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: 512,
    unsupportedReason: null,
    removals: [],
    insertions: [{
      index: 1,
      record: inserted,
      baseTransform: { ...inserted.transform }
    }],
    transforms: []
  };

  harness.emitPersistence({ type: 'transition', transition });
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'stroke-2']
  );

  harness.emitPersistence({
    type: 'transition',
    transition: { ...transition, hostGeneration: 99, mutationSequence: 3 }
  });
  assert.equal(harness.store.exportRootValue().keyframes[0].mutationSequence, 2);
});

test('future or malformed persistence data degrades saving while Fabric keeps owning B', async () => {
  const future = {
    ...makeRoot(),
    storageVersion: '9.0.0'
  };
  const harness = createHarness({
    root: future,
    expectImportAccepted: false
  });

  assert.equal(await prepareVideo(harness), false);
  assert.equal(harness.calls.hydrate.length, 0);
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), true);
  const degraded = harness.controller.getStatusSnapshot();
  assert.equal(degraded.legacyBypass, true);
  assert.equal(degraded.persistenceDegraded, true);
  assert.equal(degraded.persistenceBlocked, false);

  const b = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(b), true);
  assert.deepEqual(b.calls, ['preventDefault', 'stopImmediatePropagation']);
  await flushDetachedWork();
  assert.equal(harness.controller.getState(), 'active');
});

test('hydrate failure leaves the saved document intact while Fabric keeps owning B', async () => {
  const original = makeRoot();
  const harness = createHarness({
    root: original,
    onHydrate() {
      return { success: false, accepted: false, reason: 'hydrate-rejected' };
    }
  });

  assert.equal(await prepareVideo(harness), false);
  assert.deepEqual(harness.store.exportRootValue(), original);
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceDegraded, true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, false);
  assert.equal(harness.controller.routeKeydown(createKeyEvent('b')), true);
  await flushDetachedWork();
  assert.equal(harness.controller.getState(), 'active');
  assert.deepEqual(harness.store.exportRootValue(), original);
});

test('resync-required events coalesce in flight and pull one trailing authoritative snapshot', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const initialExportCount = harness.calls.export.length;
  const firstPull = deferred();
  let resyncExportCount = 0;
  harness.setExportHandler(_request => {
    resyncExportCount += 1;
    if (resyncExportCount === 1) return firstPull.promise;
    return {
      success: true,
      accepted: true,
      snapshot: harness.getRuntimeSnapshot()
    };
  });

  const firstSnapshot = harness.getRuntimeSnapshot();
  firstSnapshot.scenes[0].objects.push(makeRecord('stroke-2'));
  firstSnapshot.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(firstSnapshot);
  const fence = {
    type: 'resync-required',
    hostGeneration: 1,
    videoGeneration: 1,
    persistenceSessionId: 'persistence-session-1',
    stableVideoIdentity: 'C:/shot/scene-001.mov',
    reason: 'transition-too-large'
  };
  harness.emitPersistence(fence);
  await flushDetachedWork();
  assert.equal(resyncExportCount, 1);

  const latestSnapshot = harness.getRuntimeSnapshot();
  latestSnapshot.scenes[0].objects.push(makeRecord('stroke-3'));
  latestSnapshot.scenes[0].mutationSequence = 3;
  harness.setRuntimeSnapshot(latestSnapshot);
  harness.emitPersistence(fence);
  firstPull.resolve({
    success: true,
    accepted: true,
    snapshot: firstSnapshot
  });
  await flushDetachedWork();
  await flushDetachedWork();

  assert.equal(resyncExportCount, 2);
  assert.equal(harness.calls.export.length, initialExportCount + 2);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'stroke-2', 'stroke-3']
  );
});

test('백그라운드 resync 타임아웃은 입력을 차단하지 않고 다음 이벤트에서 재시도한다', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);

  const latest = harness.getRuntimeSnapshot();
  latest.scenes[0].objects.push(makeRecord('stroke-after-timeout'));
  latest.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(latest);
  const fence = {
    type: 'resync-required',
    hostGeneration: 1,
    videoGeneration: 1,
    persistenceSessionId: 'persistence-session-1',
    stableVideoIdentity: 'C:/shot/scene-001.mov',
    reason: 'transition-too-large'
  };
  const inputCountBeforeTimeout = harness.calls.input.length;
  const exportCountBeforeTimeout = harness.calls.export.length;

  harness.setExportHandler(() => new Promise(() => {}));
  assert.equal(harness.emitPersistence(fence), true);
  await new Promise(resolve => setTimeout(resolve, 120));
  await flushDetachedWork();

  const timedOutStatus = harness.controller.getStatusSnapshot();
  assert.equal(timedOutStatus.persistenceBlocked, false);
  assert.equal(timedOutStatus.legacyBypass, false);
  assert.equal(harness.controller.getState(), 'active');
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), true);
  assert.equal(harness.calls.input.length, inputCountBeforeTimeout);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1']
  );

  harness.setExportHandler(null);
  assert.equal(harness.emitPersistence(fence), true);
  await flushDetachedWork();
  await flushDetachedWork();

  assert.equal(harness.calls.export.length, exportCountBeforeTimeout + 2);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'stroke-after-timeout']
  );
  assert.equal(harness.controller.getState(), 'active');
});

test('final save pull catches a lost last event without disabling active input', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const inputCallsBeforePull = harness.calls.input.length;
  const latest = harness.getRuntimeSnapshot();
  latest.scenes[0].objects.push(makeRecord('lost-last-stroke'));
  latest.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(latest);

  assert.equal(await harness.controller.preparePersistenceSnapshotForSave(), true);
  assert.equal(harness.calls.input.length, inputCallsBeforePull);
  assert.equal(harness.controller.getState(), 'active');
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'lost-last-stroke']
  );
});

test('a video-switch save still performs its final pull after drawing input is disabled', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const initialExportCount = harness.calls.export.length;

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);
  const exportCountBeforeSave = harness.calls.export.length;
  assert.equal(exportCountBeforeSave, initialExportCount + 1);

  assert.equal(
    await harness.controller.preparePersistenceSnapshotForSave(),
    true
  );
  assert.equal(harness.calls.export.length, exportCountBeforeSave + 1);
});

test('a clean external drawingsV3 refresh rehydrates the overlay before final export', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const hydrateCount = harness.calls.hydrate.length;
  const exportCount = harness.calls.export.length;
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);

  assert.equal(
    await harness.controller.preparePersistenceSnapshotForSave(),
    true
  );
  assert.equal(harness.calls.hydrate.length, hydrateCount + 1);
  assert.equal(harness.calls.export.length, exportCount + 2);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-stroke']
  );
});

test('an active external drawingsV3 refresh resumes drawing only after rehydrate verification', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  harness.calls.order.length = 0;
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-active-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);

  assert.equal(
    await harness.controller.preparePersistenceSnapshotForSave(),
    true
  );
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'hydrate:1',
    'export:1',
    'input:on:1',
    'export:1'
  ]);
  assert.equal(harness.controller.getState(), 'active');
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-active-stroke']
  );
});

test('source rebind superseded input timeout stays retryable without a blocking latch', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-rebind-timeout-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  const exportCountBeforeTimeout = harness.calls.export.length;
  const firstInputOff = deferred();
  let inputOffCount = 0;
  harness.calls.order.length = 0;
  harness.setInputHandler(request => {
    if (request.enabled) {
      return { success: true, accepted: true, enabled: true };
    }
    inputOffCount += 1;
    if (inputOffCount === 1) {
      firstInputOff.resolve();
      return new Promise(() => {});
    }
    return { success: true, accepted: true, enabled: false };
  });

  const timedOutFlush = harness.controller.flushPersistenceBeforeLeave();
  await firstInputOff.promise;
  assert.equal(await harness.controller.disable(), true);
  assert.equal(await timedOutFlush, false);
  const timedOutStatus = harness.controller.getStatusSnapshot();
  assert.equal(timedOutStatus.persistenceBlocked, false);
  assert.equal(timedOutStatus.legacyBypass, false);
  assert.equal(timedOutStatus.state, 'passive');
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'input:off:1'
  ]);
  assert.equal(harness.calls.export.length, exportCountBeforeTimeout);

  harness.setInputHandler(null);
  harness.calls.order.length = 0;
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'hydrate:1',
    'export:1',
    'export:1'
  ]);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-rebind-timeout-stroke']
  );
  assert.equal(harness.controller.getState(), 'passive');
});

test('source rebind input-on timeout stays retryable without a blocking latch', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-input-on-timeout-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  harness.calls.order.length = 0;
  harness.setInputHandler(request => request.enabled
    ? new Promise(() => {})
    : { success: true, accepted: true, enabled: false });

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  const timedOutStatus = harness.controller.getStatusSnapshot();
  assert.equal(timedOutStatus.persistenceBlocked, false);
  assert.equal(timedOutStatus.legacyBypass, false);
  assert.equal(timedOutStatus.state, 'failed');
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'hydrate:1',
    'export:1',
    'input:on:1',
    'input:off:1'
  ]);

  harness.setInputHandler(null);
  harness.calls.order.length = 0;
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.deepEqual(harness.calls.order, ['export:1']);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-input-on-timeout-stroke']
  );
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(harness.controller.getState(), 'active');
});

test('source rebind hydrate timeout stays non-blocking after the owner is superseded', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-hydrate-timeout-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  harness.setHydrateGate(new Promise(() => {}));
  const hydrateCountBeforeTimeout = harness.calls.hydrate.length;
  harness.calls.order.length = 0;

  const timedOutFlush = harness.controller.flushPersistenceBeforeLeave();
  await flushDetachedWork();
  assert.equal(harness.calls.hydrate.length, hydrateCountBeforeTimeout + 1);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);
  assert.equal(await timedOutFlush, false);
  const timedOutStatus = harness.controller.getStatusSnapshot();
  assert.equal(timedOutStatus.persistenceBlocked, false);
  assert.equal(timedOutStatus.legacyBypass, false);

  assert.equal(await harness.controller.cancelVideoChange('load-b', {
    restorePreviousVideo: true
  }), true);
  assert.equal(harness.controller.getState(), 'active');
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-hydrate-timeout-stroke']
  );
});

test('source rebind rejection stays blocking even when its error text says timeout', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-rejected-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  harness.setInputHandler(request => request.enabled
    ? { success: true, accepted: true, enabled: true }
    : Promise.reject(new Error('persistence-ipc-timeout')));

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  const rejectedStatus = harness.controller.getStatusSnapshot();
  assert.equal(rejectedStatus.persistenceBlocked, true);
  assert.equal(rejectedStatus.legacyBypass, true);
  assert.equal(rejectedStatus.persistenceFailureReason, 'persistence-ipc-rejected');
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, true);
});

test('source rebind superseded rejection preserves the latest disable intent', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-superseded-rejection-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  const firstInputOff = deferred();
  const rejectedInputOff = deferred();
  let inputOffCount = 0;
  harness.setInputHandler(request => {
    if (request.enabled) {
      return { success: true, accepted: true, enabled: true };
    }
    inputOffCount += 1;
    if (inputOffCount === 1) {
      firstInputOff.resolve();
      return rejectedInputOff.promise;
    }
    return { success: true, accepted: true, enabled: false };
  });

  const rejectedFlush = harness.controller.flushPersistenceBeforeLeave();
  await firstInputOff.promise;
  assert.equal(await harness.controller.disable(), true);
  rejectedInputOff.reject(new Error('persistence-ipc-timeout'));
  assert.equal(await rejectedFlush, false);
  const rejectedStatus = harness.controller.getStatusSnapshot();
  assert.equal(rejectedStatus.persistenceBlocked, true);
  assert.equal(rejectedStatus.persistenceFailureReason, 'persistence-ipc-rejected');
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, false);
  assert.equal(harness.controller.getState(), 'passive');
});

test('source rebind hydrate rejection stays blocking', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-rejected-hydrate-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  const rejectedHydrate = deferred();
  harness.setHydrateGate(rejectedHydrate.promise);

  const rejectedFlush = harness.controller.flushPersistenceBeforeLeave();
  await flushDetachedWork();
  rejectedHydrate.reject(new Error('persistence-ipc-timeout'));
  assert.equal(await rejectedFlush, false);
  const rejectedStatus = harness.controller.getStatusSnapshot();
  assert.equal(rejectedStatus.persistenceBlocked, true);
  assert.equal(rejectedStatus.legacyBypass, true);
  assert.equal(rejectedStatus.persistenceFailureReason, 'persistence-ipc-rejected');
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);
  assert.equal(await harness.controller.afterVideoReady({
    loadToken: 'load-b',
    stableVideoIdentity: 'C:/shot/scene-002.mov',
    targetFrame: 24,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240
  }), true);
  assert.equal(harness.controller.getState(), 'active');
});

test('source rebind verification rejection stays blocking', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-rejected-verification-stroke')]
    }]
  });
  assert.equal(harness.store.importRootValue(externalRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  }).accepted, true);
  harness.setExportHandler(() => Promise.reject(
    new Error('persistence-ipc-timeout')
  ));

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  const rejectedStatus = harness.controller.getStatusSnapshot();
  assert.equal(rejectedStatus.persistenceBlocked, true);
  assert.equal(rejectedStatus.legacyBypass, true);
  assert.equal(rejectedStatus.persistenceFailureReason, 'persistence-ipc-rejected');
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, true);
});

test('an external future drawingsV3 refresh preserves the root and keeps Fabric owning B without blocking save', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const futureRoot = {
    ...makeRoot({ revision: 8 }),
    storageVersion: '9.0.0'
  };
  const imported = harness.store.importRootValue(futureRoot, {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  });
  assert.equal(imported.accepted, false);
  assert.equal(imported.preserved, true);

  assert.equal(
    await harness.controller.preparePersistenceSnapshotForSave(),
    true
  );
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceDegraded, true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, false);
  assert.deepEqual(harness.store.exportRootValue(), futureRoot);

  const b = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(b), true);
  assert.deepEqual(b.calls, ['preventDefault', 'stopImmediatePropagation']);
  await flushDetachedWork();
  assert.equal(harness.controller.getState(), 'active');
  assert.deepEqual(harness.store.exportRootValue(), futureRoot);
});

test('authoritative pull failure blocks leave and ends the session while Fabric keeps owning B', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  }));

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  const blockedStatus = harness.controller.getStatusSnapshot();
  assert.equal(blockedStatus.persistenceBlocked, true);
  assert.equal(blockedStatus.persistenceDegraded, true);
  assert.equal(blockedStatus.state, 'passive');
  assert.equal(blockedStatus.sessionId, null);
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), true);

  const b = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(b), true);
  assert.deepEqual(b.calls, ['preventDefault', 'stopImmediatePropagation']);
  await flushDetachedWork();
  assert.equal(harness.controller.getState(), 'active');
});

test('overlay host recovery rehydrates before restoring an active Fabric session', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const originalSession = harness.calls.hydrate[0].persistenceSessionId;
  harness.calls.order.length = 0;

  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 2
  }), true);
  assert.deepEqual(harness.calls.order.slice(0, 4), [
    'input:off:2',
    'hydrate:2',
    'export:2',
    'input:on:2'
  ]);
  assert.equal(harness.calls.hydrate.at(-1).persistenceSessionId, originalSession);
  assert.equal(harness.controller.getState(), 'active');
});

test('active source refresh disables input, pulls the old source, installs, hydrates, verifies, and only then resumes', async () => {
  const persistenceSessions = [
    'persistence-session-before-refresh',
    'persistence-session-after-refresh'
  ];
  const harness = createHarness({
    persistenceSessionIdFactory: () => persistenceSessions.shift()
  });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);

  const oldRuntime = harness.getRuntimeSnapshot();
  oldRuntime.scenes[0].objects.push(makeRecord('committed-before-refresh'));
  oldRuntime.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(oldRuntime);
  harness.calls.order.length = 0;

  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-source-stroke')]
    }]
  });

  assert.equal(
    await harness.controller.refreshPersistenceSource(() => {
      assert.deepEqual(
        harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
        ['stroke-1', 'committed-before-refresh'],
        'the old authoritative overlay must be pulled before replacement'
      );
      harness.calls.order.push('install-source');
      return harness.store.importRootValue(externalRoot, {
        fps: 24,
        totalFrames: 240,
        stableVideoIdentity: 'C:/shot/scene-001.mov'
      });
    }),
    true
  );

  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'install-source',
    'hydrate:1',
    'export:1',
    'input:on:1'
  ]);
  assert.equal(
    harness.calls.hydrate.at(-1).persistenceSessionId,
    'persistence-session-after-refresh'
  );
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-source-stroke']
  );
  assert.equal(harness.controller.getState(), 'active');
});

test('source refresh pull timeout preserves the current overlay and retries without a blocking latch', async () => {
  const persistenceSessions = [
    'persistence-session-before-refresh',
    'persistence-session-after-refresh'
  ];
  const harness = createHarness({
    persistenceIpcDeadlineMs: 40,
    persistenceSessionIdFactory: () => persistenceSessions.shift()
  });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);

  const latest = harness.getRuntimeSnapshot();
  latest.scenes[0].objects.push(makeRecord('stroke-before-timeout'));
  latest.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(latest);
  const hydrateCountBeforeTimeout = harness.calls.hydrate.length;
  let installCount = 0;
  harness.calls.order.length = 0;
  harness.setExportHandler(() => new Promise(() => {}));

  assert.equal(
    await harness.controller.refreshPersistenceSource(() => {
      installCount += 1;
    }),
    false
  );
  assert.equal(installCount, 0);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'input:on:1'
  ]);
  const timedOutStatus = harness.controller.getStatusSnapshot();
  assert.equal(timedOutStatus.persistenceBlocked, false);
  assert.equal(timedOutStatus.legacyBypass, false);
  assert.equal(timedOutStatus.resumeRequested, false);
  assert.equal(timedOutStatus.state, 'active');
  assert.equal(timedOutStatus.sessionId, harness.calls.input.at(-1).session.sessionId);
  assert.equal(
    harness.calls.export.at(-1).persistenceSessionId,
    'persistence-session-before-refresh'
  );
  assert.equal(harness.calls.hydrate.length, hydrateCountBeforeTimeout);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1']
  );
  assert.deepEqual(
    harness.getRuntimeSnapshot().scenes[0].objects.map(object => object.id),
    ['stroke-1', 'stroke-before-timeout']
  );

  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-source-stroke')]
    }]
  });
  harness.setExportHandler(null);
  harness.calls.order.length = 0;
  assert.equal(
    await harness.controller.refreshPersistenceSource(() => {
      assert.deepEqual(
        harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
        ['stroke-1', 'stroke-before-timeout']
      );
      installCount += 1;
      harness.calls.order.push('install-source');
      return harness.store.importRootValue(externalRoot, {
        fps: 24,
        totalFrames: 240,
        stableVideoIdentity: 'C:/shot/scene-001.mov'
      });
    }),
    true
  );
  assert.equal(installCount, 1);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'install-source',
    'hydrate:1',
    'export:1',
    'input:on:1'
  ]);
  assert.equal(
    harness.calls.hydrate.at(-1).persistenceSessionId,
    'persistence-session-after-refresh'
  );
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-source-stroke']
  );
  assert.equal(harness.controller.getState(), 'active');
});

test('active source refresh rejects old-session transitions while source installation is pending', async () => {
  const persistenceSessions = [
    'persistence-session-before-refresh',
    'persistence-session-after-refresh'
  ];
  const harness = createHarness({
    persistenceSessionIdFactory: () => persistenceSessions.shift()
  });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);

  const installStarted = deferred();
  const releaseInstall = deferred();
  const externalRoot = makeRoot({
    revision: 8,
    keyframes: [{
      id: 'external-keyframe',
      frame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080,
      mutationSequence: 1,
      objects: [makeRecord('external-source-stroke')]
    }]
  });
  const refresh = harness.controller.refreshPersistenceSource(async () => {
    const result = harness.store.importRootValue(externalRoot, {
      fps: 24,
      totalFrames: 240,
      stableVideoIdentity: 'C:/shot/scene-001.mov'
    });
    installStarted.resolve();
    await releaseInstall.promise;
    return result;
  });
  await installStarted.promise;

  const staleRecord = makeRecord('stale-transition-stroke');
  const staleTransition = {
    hostGeneration: 1,
    videoGeneration: 1,
    persistenceSessionId: 'persistence-session-before-refresh',
    stableVideoIdentity: 'C:/shot/scene-001.mov',
    scene: {
      sceneInstanceId: 'overlay-scene-12',
      targetFrame: 12,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: 2,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: 512,
    unsupportedReason: null,
    removals: [],
    insertions: [{
      index: 1,
      record: staleRecord,
      baseTransform: { ...staleRecord.transform }
    }],
    transforms: []
  };
  assert.equal(
    harness.emitPersistence({ type: 'transition', transition: staleTransition }),
    false
  );
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['external-source-stroke']
  );

  releaseInstall.resolve();
  assert.equal(await refresh, true);
  assert.equal(harness.controller.getState(), 'active');
});

test('quit preparation disables input before the final pull, rejects a late transition, and resumes only after cancellation', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(typeof harness.controller.preparePersistenceForQuit, 'function');
  assert.equal(typeof harness.controller.resumeAfterQuitCancelled, 'function');

  const finalRuntime = harness.getRuntimeSnapshot();
  finalRuntime.scenes[0].objects.push(makeRecord('quit-final-stroke'));
  finalRuntime.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(finalRuntime);

  const releaseInputOff = deferred();
  harness.setInputHandler(request => {
    if (!request.enabled) return releaseInputOff.promise;
    return { success: true, accepted: true, enabled: true };
  });
  harness.calls.order.length = 0;

  const preparingQuit = harness.controller.preparePersistenceForQuit();
  await flushDetachedWork();
  assert.deepEqual(harness.calls.order, ['input:off:1']);

  const lateRecord = makeRecord('late-old-session-stroke');
  assert.equal(
    harness.emitPersistence({
      type: 'transition',
      transition: {
        hostGeneration: 1,
        videoGeneration: 1,
        persistenceSessionId: 'persistence-session-1',
        stableVideoIdentity: 'C:/shot/scene-001.mov',
        scene: {
          sceneInstanceId: 'overlay-scene-12',
          targetFrame: 12,
          sourceWidth: 1920,
          sourceHeight: 1080
        },
        mutationSequence: 2,
        origin: 'live',
        kind: 'add-objects',
        estimatedBytes: 512,
        unsupportedReason: null,
        removals: [],
        insertions: [{
          index: 1,
          record: lateRecord,
          baseTransform: { ...lateRecord.transform }
        }],
        transforms: []
      }
    }),
    false,
    'an event from the disabled drawing session must not race the authoritative quit pull'
  );
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1']
  );

  releaseInputOff.resolve({
    success: true,
    accepted: true,
    enabled: false
  });
  assert.equal(await preparingQuit, true);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1'
  ]);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'quit-final-stroke']
  );
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, true);

  assert.equal(await harness.controller.resumeAfterQuitCancelled(), true);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'input:on:1'
  ]);
  assert.equal(harness.controller.getState(), 'active');
});

test('quit final pull timeout preserves cancellation recovery and retries without a blocking latch', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 40 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);

  const latest = harness.getRuntimeSnapshot();
  latest.scenes[0].objects.push(makeRecord('quit-timeout-stroke'));
  latest.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(latest);
  const hydrateCountBeforeTimeout = harness.calls.hydrate.length;
  harness.calls.order.length = 0;
  harness.setExportHandler(() => new Promise(() => {}));

  assert.equal(await harness.controller.preparePersistenceForQuit(), false);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1'
  ]);
  const timedOutStatus = harness.controller.getStatusSnapshot();
  assert.deepEqual({
    state: timedOutStatus.state,
    desiredInputEnabled: timedOutStatus.desiredInputEnabled,
    sessionId: timedOutStatus.sessionId,
    resumeRequested: timedOutStatus.resumeRequested,
    persistenceQuitPrepared: timedOutStatus.persistenceQuitPrepared,
    legacyBypass: timedOutStatus.legacyBypass,
    persistenceBlocked: timedOutStatus.persistenceBlocked,
    persistenceFailureReason: timedOutStatus.persistenceFailureReason
  }, {
    state: 'recovering',
    desiredInputEnabled: false,
    sessionId: null,
    resumeRequested: true,
    persistenceQuitPrepared: true,
    legacyBypass: false,
    persistenceBlocked: false,
    persistenceFailureReason: null
  });
  assert.equal(harness.calls.hydrate.length, hydrateCountBeforeTimeout);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1']
  );
  assert.deepEqual(
    harness.getRuntimeSnapshot().scenes[0].objects.map(object => object.id),
    ['stroke-1', 'quit-timeout-stroke']
  );

  harness.setExportHandler(null);
  assert.equal(await harness.controller.resumeAfterQuitCancelled(), true);
  assert.equal(harness.controller.getState(), 'active');
  assert.equal(harness.calls.order.at(-1), 'input:on:1');
  assert.equal(harness.calls.hydrate.length, hydrateCountBeforeTimeout);

  harness.calls.order.length = 0;
  assert.equal(await harness.controller.preparePersistenceForQuit(), true);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1'
  ]);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'quit-timeout-stroke']
  );
  assert.equal(await harness.controller.resumeAfterQuitCancelled(), true);
  assert.equal(harness.controller.getState(), 'active');
});

test('quit cancellation cannot resume Fabric after the prepared video owner has changed', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(typeof harness.controller.preparePersistenceForQuit, 'function');
  assert.equal(typeof harness.controller.resumeAfterQuitCancelled, 'function');

  assert.equal(await harness.controller.preparePersistenceForQuit(), true);
  const inputOnCountBeforeVideoChange = harness.calls.input.filter(
    request => request.enabled
  ).length;

  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);
  assert.equal(await harness.controller.resumeAfterQuitCancelled(), false);
  assert.equal(
    harness.calls.input.filter(request => request.enabled).length,
    inputOnCountBeforeVideoChange,
    'a cancelled quit must not enable input on a different or changing video owner'
  );
  assert.notEqual(harness.controller.getState(), 'active');
});

test('explicit persistence abandon preserves the current video so B can recover before target inspection', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  }));

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, true);

  // The target fails inspection before beforeVideoChange(), so the old video remains current.
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  assert.equal(harness.controller.getStatusSnapshot().videoReady, true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceReady, true);
  harness.setExportHandler(null);

  assert.equal(await harness.controller.toggle(), true);
  assert.equal(harness.controller.getState(), 'active');
  assert.equal(harness.calls.input.at(-1).enabled, true);
});

test('explicit persistence abandon preserves rollback when the target load later fails', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const previousPersistenceSessionId = harness.calls.hydrate[0].persistenceSessionId;
  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  }));

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  harness.setExportHandler(null);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  harness.calls.order.length = 0;
  assert.equal(await harness.controller.cancelVideoChange('load-b', {
    restorePreviousVideo: true
  }), true);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'hydrate:1',
    'export:1'
  ]);
  assert.equal(harness.calls.hydrate.at(-1).persistenceSessionId, previousPersistenceSessionId);
  assert.equal(harness.calls.hydrate.at(-1).stableVideoIdentity, 'C:/shot/scene-001.mov');
  assert.equal(harness.controller.getStatusSnapshot().videoReady, true);
  assert.equal(await harness.controller.toggle(), true);
});

test('explicit persistence abandon preserves active drawing intent when the target load succeeds', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  }));
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  assert.deepEqual({
    persistenceBlocked: harness.controller.getStatusSnapshot().persistenceBlocked,
    resumeRequested: harness.controller.getStatusSnapshot().resumeRequested,
    state: harness.controller.getState()
  }, {
    persistenceBlocked: true,
    resumeRequested: false,
    state: 'passive'
  });
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  assert.deepEqual({
    persistenceBlocked: harness.controller.getStatusSnapshot().persistenceBlocked,
    resumeRequested: harness.controller.getStatusSnapshot().resumeRequested,
    state: harness.controller.getState()
  }, {
    persistenceBlocked: false,
    resumeRequested: true,
    state: 'passive'
  });
  harness.setExportHandler(null);

  assert.equal(await harness.controller.afterVideoReady({
    loadToken: 'load-b',
    stableVideoIdentity: 'C:/shot/scene-002.mov',
    targetFrame: 24,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240
  }), true);
  assert.deepEqual({
    state: harness.controller.getState(),
    inputEnabled: harness.calls.input.at(-1)?.enabled,
    stableVideoIdentity: harness.calls.input.at(-1)?.session?.stableVideoIdentity
  }, {
    state: 'active',
    inputEnabled: true,
    stableVideoIdentity: 'C:/shot/scene-002.mov'
  });
});

test('explicit persistence abandon keeps the first active intent across two queued final-pull failures', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  const firstExport = deferred();
  const secondExport = deferred();
  const pendingExports = [firstExport, secondExport];
  const exportCountBeforeFinalPulls = harness.calls.export.length;
  harness.setExportHandler(() => pendingExports.shift().promise);
  const firstFlush = harness.controller.flushPersistenceBeforeLeave();
  const secondFlush = harness.controller.flushPersistenceBeforeLeave();
  await flushDetachedWork();
  assert.equal(harness.calls.export.length, exportCountBeforeFinalPulls + 1);

  firstExport.resolve({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  });
  assert.equal(await firstFlush, false);
  await flushDetachedWork();
  assert.equal(harness.calls.export.length, exportCountBeforeFinalPulls + 2);
  assert.deepEqual({
    persistenceBlocked: harness.controller.getStatusSnapshot().persistenceBlocked,
    resumeRequested: harness.controller.getStatusSnapshot().resumeRequested,
    state: harness.controller.getState()
  }, {
    persistenceBlocked: true,
    resumeRequested: false,
    state: 'passive'
  });

  secondExport.resolve({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  });
  assert.equal(await secondFlush, false);
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  harness.setExportHandler(null);

  assert.equal(await harness.controller.afterVideoReady({
    loadToken: 'load-b',
    stableVideoIdentity: 'C:/shot/scene-002.mov',
    targetFrame: 24,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240
  }), true);
  assert.deepEqual({
    state: harness.controller.getState(),
    inputEnabled: harness.calls.input.at(-1)?.enabled,
    stableVideoIdentity: harness.calls.input.at(-1)?.session?.stableVideoIdentity
  }, {
    state: 'active',
    inputEnabled: true,
    stableVideoIdentity: 'C:/shot/scene-002.mov'
  });
});

test('explicit persistence abandon preserves a drawing resume cancellation made during the final pull', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  const finalExport = deferred();
  const exportCountBeforeFinalPull = harness.calls.export.length;
  harness.setExportHandler(() => finalExport.promise);
  const finalFlush = harness.controller.flushPersistenceBeforeLeave();
  await flushDetachedWork();
  assert.equal(harness.calls.export.length, exportCountBeforeFinalPull + 1);

  assert.equal(await harness.controller.toggle(), true);
  assert.deepEqual({
    resumeRequested: harness.controller.getStatusSnapshot().resumeRequested,
    state: harness.controller.getState()
  }, {
    resumeRequested: false,
    state: 'passive'
  });

  finalExport.resolve({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  });
  assert.equal(await finalFlush, false);
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  harness.setExportHandler(null);
  const inputOnCountBeforeReady = harness.calls.input.filter(
    request => request.enabled
  ).length;

  assert.equal(await harness.controller.afterVideoReady({
    loadToken: 'load-b',
    stableVideoIdentity: 'C:/shot/scene-002.mov',
    targetFrame: 24,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240
  }), true);
  assert.deepEqual({
    state: harness.controller.getState(),
    inputEnabled: harness.calls.input.at(-1)?.enabled,
    inputOnCount: harness.calls.input.filter(request => request.enabled).length
  }, {
    state: 'passive',
    inputEnabled: false,
    inputOnCount: inputOnCountBeforeReady
  });
});

test('explicit persistence abandon preserves a drawing resume cancellation when the old video is restored', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  const finalExport = deferred();
  const exportCountBeforeFinalPull = harness.calls.export.length;
  harness.setExportHandler(() => finalExport.promise);
  const finalFlush = harness.controller.flushPersistenceBeforeLeave();
  await flushDetachedWork();
  assert.equal(harness.calls.export.length, exportCountBeforeFinalPull + 1);

  assert.equal(await harness.controller.toggle(), true);
  assert.deepEqual({
    resumeRequested: harness.controller.getStatusSnapshot().resumeRequested,
    state: harness.controller.getState()
  }, {
    resumeRequested: false,
    state: 'passive'
  });

  finalExport.resolve({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  });
  assert.equal(await finalFlush, false);
  assert.equal(harness.controller.abandonPersistenceForVideoChange(), true);
  harness.setExportHandler(null);
  const inputOnCountBeforeCancel = harness.calls.input.filter(
    request => request.enabled
  ).length;

  assert.equal(await harness.controller.cancelVideoChange('load-b', {
    restorePreviousVideo: true
  }), true);
  assert.equal(harness.controller.getStatusSnapshot().videoReady, true);
  assert.equal(harness.calls.hydrate.at(-1).stableVideoIdentity, 'C:/shot/scene-001.mov');
  assert.deepEqual({
    state: harness.controller.getState(),
    inputEnabled: harness.calls.input.at(-1)?.enabled,
    inputOnCount: harness.calls.input.filter(request => request.enabled).length
  }, {
    state: 'passive',
    inputEnabled: false,
    inputOnCount: inputOnCountBeforeCancel
  });
});

test('an explicit drawing resume request during recovery activates the old video when the load is cancelled', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(harness.controller.getState(), 'passive');
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, false);

  assert.equal(await harness.controller.toggle(), true);
  assert.deepEqual({
    resumeRequested: harness.controller.getStatusSnapshot().resumeRequested,
    state: harness.controller.getState()
  }, {
    resumeRequested: true,
    state: 'recovering'
  });
  const inputOnCountBeforeCancel = harness.calls.input.filter(
    request => request.enabled
  ).length;

  assert.equal(await harness.controller.cancelVideoChange('load-b', {
    restorePreviousVideo: true
  }), true);
  assert.equal(harness.controller.getStatusSnapshot().videoReady, true);
  assert.equal(harness.calls.hydrate.at(-1).stableVideoIdentity, 'C:/shot/scene-001.mov');
  assert.deepEqual({
    state: harness.controller.getState(),
    inputEnabled: harness.calls.input.at(-1)?.enabled,
    inputOnCount: harness.calls.input.filter(request => request.enabled).length,
    stableVideoIdentity: harness.calls.input.at(-1)?.session?.stableVideoIdentity
  }, {
    state: 'active',
    inputEnabled: true,
    inputOnCount: inputOnCountBeforeCancel + 1,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  });
});

test('overlay-host-unavailable save preserves the current video for host recovery rehydrate', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const currentPersistenceSessionId = harness.calls.hydrate[0].persistenceSessionId;
  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-host-unavailable'
  }));

  assert.equal(await harness.controller.preparePersistenceSnapshotForSave(), true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, false);
  assert.equal(harness.controller.getStatusSnapshot().videoReady, true);
  assert.equal(harness.controller.getStatusSnapshot().persistenceReady, true);

  harness.setExportHandler(null);
  harness.calls.order.length = 0;
  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 2
  }), true);
  assert.deepEqual(harness.calls.order, [
    'input:off:2',
    'hydrate:2',
    'export:2',
    'input:on:2'
  ]);
  assert.equal(harness.calls.hydrate.at(-1).persistenceSessionId, currentPersistenceSessionId);
  assert.equal(harness.controller.getState(), 'active');
});

test('오버레이 호스트가 응답하지 않으면 전환 게이트는 데드라인 안에 안전하게 실패한다', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 80 });
  assert.equal(await prepareVideo(harness), true);

  harness.setExportHandler(() => new Promise(() => {}));
  const startedAt = Date.now();
  const flushed = await harness.controller.flushPersistenceBeforeLeave();
  const elapsedMs = Date.now() - startedAt;

  assert.equal(flushed, false, '응답 없는 회수를 저장 성공으로 처리하면 안 된다');
  assert.ok(elapsedMs < 5000, `게이트가 데드라인 안에 끝나야 한다 (실측 ${elapsedMs}ms)`);
  assert.equal(
    harness.controller.getStatusSnapshot().persistenceBlocked,
    false,
    '데드라인 초과가 차단 래치를 걸면 안 된다'
  );
  assert.equal(harness.controller.getStatusSnapshot().legacyBypass, false);
});

test('최종 회수 타임아웃 취소는 최신 오버레이를 보존하고 재시도에서 마지막 획을 회수한다', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 80 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  const stableStatus = harness.controller.getStatusSnapshot();
  const persistenceSessionId = harness.calls.hydrate[0].persistenceSessionId;

  const latest = harness.getRuntimeSnapshot();
  const lastStroke = makeRecord('last-stroke');
  latest.scenes[0].objects.push(lastStroke);
  latest.scenes[0].mutationSequence = 2;
  harness.setRuntimeSnapshot(latest);

  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);
  const lateEventAccepted = harness.emitPersistence({
    type: 'transition',
    transition: {
      hostGeneration: 1,
      videoGeneration: 1,
      persistenceSessionId: 'persistence-session-1',
      stableVideoIdentity: 'C:/shot/scene-001.mov',
      scene: {
        sceneInstanceId: latest.scenes[0].sceneInstanceId,
        targetFrame: 12,
        sourceWidth: 1920,
        sourceHeight: 1080
      },
      mutationSequence: 2,
      origin: 'live',
      kind: 'add-objects',
      estimatedBytes: 512,
      unsupportedReason: null,
      removals: [],
      insertions: [{
        index: 1,
        record: lastStroke,
        baseTransform: { ...lastStroke.transform }
      }],
      transforms: []
    }
  });
  assert.equal(lateEventAccepted, false);

  harness.setExportHandler(() => new Promise(() => {}));
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1'],
    '타임아웃 시점에는 마지막 획이 아직 공유 저장소에 없어야 재현이 유효하다'
  );

  const hydrateCountBeforeCancel = harness.calls.hydrate.length;
  const orderCountBeforeCancel = harness.calls.order.length;
  assert.equal(await harness.controller.cancelVideoChange('load-b', {
    restorePreviousVideo: true,
    preserveAuthoritativeOverlay: true
  }), true);
  assert.equal(harness.calls.hydrate.length, hydrateCountBeforeCancel);
  assert.deepEqual(harness.calls.order.slice(orderCountBeforeCancel), ['input:on:1']);
  assert.equal(harness.controller.getState(), 'active');
  assert.deepEqual(
    harness.getRuntimeSnapshot().scenes[0].objects.map(object => object.id),
    ['stroke-1', 'last-stroke'],
    '취소 복구가 오래된 저장소로 최신 오버레이를 덮으면 안 된다'
  );
  assert.equal(harness.controller.getStatusSnapshot().hostGeneration, stableStatus.hostGeneration);
  assert.equal(harness.controller.getStatusSnapshot().videoGeneration, stableStatus.videoGeneration);
  assert.equal(harness.controller.getStatusSnapshot().legacyBypass, false);

  harness.setExportHandler(null);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(harness.calls.export.at(-1).persistenceSessionId, persistenceSessionId);
  assert.deepEqual(
    harness.store.exportRootValue().keyframes[0].objects.map(object => object.id),
    ['stroke-1', 'last-stroke']
  );
});

test('최종 회수 차단 뒤 최신 오버레이를 보존하면 입력을 재개하지 않고 안전하게 복귀한다', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  }));
  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, true);

  const hydrateCountBeforeCancel = harness.calls.hydrate.length;
  assert.equal(await harness.controller.cancelVideoChange('load-b', {
    restorePreviousVideo: true,
    preserveAuthoritativeOverlay: true
  }), true);
  assert.equal(harness.calls.hydrate.length, hydrateCountBeforeCancel);
  assert.equal(harness.controller.getState(), 'passive');
  assert.equal(harness.controller.getStatusSnapshot().videoReady, true);
});

test('전환 게이트는 진행 중인 영상 확정 처리를 기다린 뒤 회수한다', async () => {
  const harness = createHarness({ persistenceIpcDeadlineMs: 2000 });
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.beforeVideoChange('load-b'), true);

  const gate = deferred();
  harness.setHydrateGate(gate.promise);
  const hydrateCallsBefore = harness.calls.hydrate.length;
  const readyPromise = harness.controller.afterVideoReady({
    loadToken: 'load-b',
    stableVideoIdentity: 'C:/shot/scene-002.mov',
    targetFrame: 24,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 24,
    totalFrames: 240
  });
  await flushDetachedWork();
  assert.equal(harness.calls.hydrate.length, hydrateCallsBefore + 1);

  const flushPromise = harness.controller.flushPersistenceBeforeLeave();
  await flushDetachedWork();
  assert.equal(
    harness.calls.hydrate.length,
    hydrateCallsBefore + 1,
    '게이트가 확정 처리 완료 전에 두 번째 재수화를 기동하면 안 된다'
  );

  gate.resolve();
  assert.equal(await readyPromise, true);
  assert.equal(await flushPromise, true);
});

test('a rejected passive source refresh skips hydration and stays passive', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  const hydrateCount = harness.calls.hydrate.length;
  harness.calls.order.length = 0;

  const result = await harness.controller.refreshPersistenceSource(() => {
    harness.calls.order.push('install-source');
    return false;
  });

  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'install-source'
  ]);
  assert.equal(harness.calls.hydrate.length, hydrateCount);
  assert.equal(result, false);
  assert.equal(harness.controller.getState(), 'passive');
});

test('a rejected active source refresh skips hydration and restores drawing input', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  const hydrateCount = harness.calls.hydrate.length;
  harness.calls.order.length = 0;

  const result = await harness.controller.refreshPersistenceSource(() => {
    harness.calls.order.push('install-source');
    return false;
  });

  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'install-source',
    'input:on:1'
  ]);
  assert.equal(harness.calls.hydrate.length, hydrateCount);
  assert.equal(result, true);
  assert.equal(harness.controller.getState(), 'active');
});

test('a throwing source install releases the refresh queue for a later refresh', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);

  await assert.rejects(
    harness.controller.refreshPersistenceSource(() => {
      harness.calls.order.push('install-source:throw');
      throw new Error('source install failed');
    }),
    /source install failed/
  );

  const result = await harness.controller.refreshPersistenceSource(() => {
    harness.calls.order.push('install-source:retry');
    return true;
  });
  assert.equal(result, true);
  assert.equal(harness.calls.order.includes('install-source:retry'), true);
  assert.equal(harness.controller.getState(), 'passive');
});

test('a rejected source refresh preserves quit suspension resume intent', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  assert.equal(await harness.controller.preparePersistenceForQuit(), true);
  const hydrateCount = harness.calls.hydrate.length;
  harness.calls.order.length = 0;

  const result = await harness.controller.refreshPersistenceSource(() => {
    harness.calls.order.push('install-source');
    return false;
  });

  assert.equal(result, false);
  assert.equal(harness.controller.getState(), 'recovering');
  assert.equal(harness.controller.getStatusSnapshot().resumeRequested, true);
  assert.equal(harness.calls.hydrate.length, hydrateCount);
  assert.deepEqual(harness.calls.order, [
    'input:off:1',
    'export:1',
    'install-source'
  ]);
  assert.equal(await harness.controller.resumeAfterQuitCancelled(), true);
  assert.equal(harness.controller.getState(), 'active');
});

function makeKeyframe(frame, id, objectIds = [], overrides = {}) {
  return {
    id,
    frame,
    sourceWidth: 1920,
    sourceHeight: 1080,
    mutationSequence: frame + 1,
    objects: objectIds.map(makeRecord),
    ...overrides
  };
}

function createStoreWithKeyframes(keyframes, options = {}) {
  const store = createFabricDrawingPersistenceStore({
    createId: prefix => `${prefix}-generated`,
    ...options
  });
  const imported = store.importRootValue(makeRoot({
    revision: options.revision ?? 1,
    keyframes
  }), {
    fps: 24,
    totalFrames: 240,
    stableVideoIdentity: 'C:/shot/scene-001.mov'
  });
  assert.equal(imported.accepted, true);
  return store;
}

test('hold resolver returns the last exact or held keyframe while preserving an empty hold break', () => {
  const store = createStoreWithKeyframes([
    makeKeyframe(100, 'keyframe-100', ['stroke-100']),
    makeKeyframe(150, 'keyframe-150'),
    makeKeyframe(200, 'keyframe-200', ['stroke-200'])
  ]);

  assert.equal(store.resolveKeyframeAtFrame(99), null);
  assert.equal(store.resolveKeyframeAtFrame(-1), null);
  assert.equal(store.resolveKeyframeAtFrame(240), null);
  assert.equal(store.resolveKeyframeAtFrame(100.5), null);
  assert.deepEqual(
    { frame: store.resolveKeyframeAtFrame(100).frame, ids: store.resolveKeyframeAtFrame(100).objects.map(item => item.id) },
    { frame: 100, ids: ['stroke-100'] }
  );
  assert.deepEqual(
    { frame: store.resolveKeyframeAtFrame(149).frame, ids: store.resolveKeyframeAtFrame(149).objects.map(item => item.id) },
    { frame: 100, ids: ['stroke-100'] }
  );
  assert.deepEqual(
    { frame: store.resolveKeyframeAtFrame(150).frame, objects: store.resolveKeyframeAtFrame(150).objects },
    { frame: 150, objects: [] }
  );
  assert.deepEqual(
    { frame: store.resolveKeyframeAtFrame(199).frame, objects: store.resolveKeyframeAtFrame(199).objects },
    { frame: 150, objects: [] }
  );
  assert.deepEqual(
    { frame: store.resolveKeyframeAtFrame(200).frame, ids: store.resolveKeyframeAtFrame(200).objects.map(item => item.id) },
    { frame: 200, ids: ['stroke-200'] }
  );

  const resolvedClone = store.resolveKeyframeAtFrame(149);
  resolvedClone.objects[0].style.color = '#000000';
  assert.equal(store.resolveKeyframeAtFrame(149).objects[0].style.color, '#ff4757');
  assert.equal(createFabricDrawingPersistenceStore().resolveKeyframeAtFrame(0), null);
});

test('single keyframe move preserves the source snapshot and emits one revision', () => {
  const source = makeKeyframe(10, 'keyframe-10', ['stroke-10'], {
    sourceWidth: 1280,
    sourceHeight: 720,
    mutationSequence: 77
  });
  const store = createStoreWithKeyframes([source]);
  const changes = [];
  store.subscribe(change => changes.push(change));

  const result = store.moveKeyframes([{ fromFrame: 10, toFrame: 15 }]);

  assert.equal(result.applied, true);
  assert.equal(result.revision, 2);
  assert.deepEqual(Object.keys(result.edit), [
    'schema',
    'kind',
    'documentId',
    'before',
    'after'
  ]);
  assert.deepEqual(result.edit.before.map(item => item.frame), [10, 15]);
  assert.deepEqual(result.edit.after.map(item => item.frame), [10, 15]);
  assert.deepEqual(store.exportRootValue().keyframes, [{ ...source, frame: 15 }]);
  assert.equal(store.getStatus().objectCount, 1);
  assert.deepEqual(changes.map(change => change.revision), [2]);
});

test('multi-keyframe move uses the starting snapshot for overlap and overwrites destinations atomically', () => {
  const frame100 = makeKeyframe(100, 'keyframe-100', ['stroke-100']);
  const frame200 = makeKeyframe(200, 'keyframe-200', ['stroke-200']);
  const overwritten = makeKeyframe(220, 'keyframe-220', ['stroke-overwritten']);
  const store = createStoreWithKeyframes([frame100, frame200, overwritten]);
  const changes = [];
  store.subscribe(change => changes.push(change));

  const result = store.moveKeyframes([
    { fromFrame: 100, toFrame: 200 },
    { fromFrame: 200, toFrame: 220 }
  ]);

  assert.equal(result.applied, true);
  assert.deepEqual(
    store.exportRootValue().keyframes.map(keyframe => ({
      frame: keyframe.frame,
      id: keyframe.id,
      objectIds: keyframe.objects.map(object => object.id)
    })),
    [
      { frame: 200, id: 'keyframe-100', objectIds: ['stroke-100'] },
      { frame: 220, id: 'keyframe-200', objectIds: ['stroke-200'] }
    ]
  );
  assert.deepEqual(result.edit.before.map(item => item.frame), [100, 200, 220]);
  assert.deepEqual(result.edit.after.map(item => item.frame), [100, 200, 220]);
  assert.equal(store.getStatus().objectCount, 2);
  assert.equal(changes.length, 1);
});

test('invalid keyframe move batches leave the document, revision, and events untouched', () => {
  const invalidBatches = [
    [{ fromFrame: 10, toFrame: 240 }],
    [{ fromFrame: 10, toFrame: 11 }, { fromFrame: 99, toFrame: 12 }],
    [{ fromFrame: 10, toFrame: 11 }, { fromFrame: 10, toFrame: 12 }],
    [{ fromFrame: 10, toFrame: 12 }, { fromFrame: 20, toFrame: 12 }],
    [{ fromFrame: 10, toFrame: 10 }]
  ];

  invalidBatches.forEach(moves => {
    const store = createStoreWithKeyframes([
      makeKeyframe(10, 'keyframe-10', ['stroke-10']),
      makeKeyframe(20, 'keyframe-20', ['stroke-20'])
    ]);
    const before = store.exportRootValue();
    const changes = [];
    store.subscribe(change => changes.push(change));

    assert.equal(store.moveKeyframes(moves).applied, false);
    assert.deepEqual(store.exportRootValue(), before);
    assert.equal(store.getRevision(), before.revision);
    assert.equal(changes.length, 0);
  });

  const overflowStore = createStoreWithKeyframes([
    makeKeyframe(10, 'keyframe-10', ['stroke-10'])
  ], { revision: Number.MAX_SAFE_INTEGER });
  const overflowBefore = overflowStore.exportRootValue();
  assert.deepEqual(
    overflowStore.moveKeyframes([{ fromFrame: 10, toFrame: 11 }]),
    { applied: false, reason: 'revision-overflow' }
  );
  assert.deepEqual(overflowStore.exportRootValue(), overflowBefore);
});

test('keyframe move edit restores an overwritten destination on undo and can redo the move', () => {
  const original10 = makeKeyframe(10, 'keyframe-10', ['stroke-10']);
  const original20 = makeKeyframe(20, 'keyframe-20', ['stroke-20']);
  const store = createStoreWithKeyframes([original10, original20]);
  const changes = [];
  store.subscribe(change => changes.push(change));

  const moved = store.moveKeyframes([{ fromFrame: 10, toFrame: 20 }]);
  assert.equal(moved.applied, true);
  assert.deepEqual(
    store.exportRootValue().keyframes.map(keyframe => keyframe.id),
    ['keyframe-10']
  );

  assert.deepEqual(store.applyKeyframeEdit(moved.edit, 'undo'), {
    applied: true,
    revision: 3
  });
  assert.deepEqual(store.exportRootValue().keyframes, [original10, original20]);

  assert.deepEqual(store.applyKeyframeEdit(moved.edit, 'redo'), {
    applied: true,
    revision: 4
  });
  assert.deepEqual(store.exportRootValue().keyframes, [{ ...original10, frame: 20 }]);
  assert.deepEqual(changes.map(change => change.revision), [2, 3, 4]);
});

test('keyframe edit rejects wrong documents, malformed tokens, and changed touched frames atomically', () => {
  const store = createStoreWithKeyframes([
    makeKeyframe(10, 'keyframe-10', ['stroke-10']),
    makeKeyframe(20, 'keyframe-20', ['stroke-20'])
  ]);
  const firstMove = store.moveKeyframes([{ fromFrame: 10, toFrame: 20 }]);
  assert.equal(firstMove.applied, true);
  const secondMove = store.moveKeyframes([{ fromFrame: 20, toFrame: 21 }]);
  assert.equal(secondMove.applied, true);
  const beforeRejectedEdits = store.exportRootValue();

  assert.equal(store.applyKeyframeEdit(firstMove.edit, 'undo').applied, false);
  assert.equal(store.applyKeyframeEdit({
    ...firstMove.edit,
    documentId: 'another-document'
  }, 'undo').applied, false);
  assert.equal(store.applyKeyframeEdit({
    ...firstMove.edit,
    unexpected: true
  }, 'undo').applied, false);
  assert.equal(store.applyKeyframeEdit(firstMove.edit, 'sideways').applied, false);
  assert.deepEqual(store.exportRootValue(), beforeRejectedEdits);
});

test('B 소유권 술어는 저장 실패 래치를 참조하지 않는다', () => {
  const controllerSource = fs
    .readFileSync(controllerPath, 'utf8')
    .replace(/\r\n/g, '\n');
  const predicate = controllerSource.match(
    /function shouldOwnDrawingShortcut\(\) \{([\s\S]*?)\n  \}/
  )?.[1];
  assert.ok(predicate, '소유권 술어 원문을 추출할 수 있어야 한다');
  assert.doesNotMatch(
    predicate,
    /legacyBypass|persistenceBlocked|persistenceFailureReason/
  );
  assert.match(
    predicate,
    /pilotEnabled &&\s*\n\s*\(persistenceStore === null \|\| persistenceBridgeReady\)/
  );
});

test('비차단 저장 저하는 드로잉 세션을 강제로 내리지 않는다', () => {
  const controllerSource = fs
    .readFileSync(controllerPath, 'utf8')
    .replace(/\r\n/g, '\n');
  const bypass = controllerSource.match(
    /function setPersistenceBypass\(reason, \{ blocked = false \} = \{\}\) \{([\s\S]*?)\n  \}/
  )?.[1];
  assert.ok(bypass, '저장 저하 진입점 원문을 추출할 수 있어야 한다');
  assert.match(
    bypass,
    /if \(blocked === true\) \{[\s\S]*desiredInputEnabled = false;[\s\S]*currentSession = null;[\s\S]*setState\('passive'\);/
  );
  const beforeBlockedBranch = bypass.slice(0, bypass.indexOf('if (blocked === true) {'));
  assert.doesNotMatch(beforeBlockedBranch, /desiredInputEnabled = false;|currentSession = null;|setState\(/);
});
