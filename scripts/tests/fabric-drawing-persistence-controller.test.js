const { before, test } = require('node:test');
const assert = require('node:assert/strict');
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
    persistenceSessionIdFactory: () => 'persistence-session-1',
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
      persistenceListener(clone(message));
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

test('future or malformed persistence data bypasses Fabric without consuming B', async () => {
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
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), false);
  assert.equal(harness.controller.getStatusSnapshot().legacyBypass, true);

  const b = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(b), false);
  assert.deepEqual(b.calls, []);
});

test('hydrate failure leaves the saved document intact and routes B to legacy', async () => {
  const original = makeRoot();
  const harness = createHarness({
    root: original,
    onHydrate() {
      return { success: false, accepted: false, reason: 'hydrate-rejected' };
    }
  });

  assert.equal(await prepareVideo(harness), false);
  assert.deepEqual(harness.store.exportRootValue(), original);
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), false);
  assert.equal(harness.controller.routeKeydown(createKeyEvent('b')), false);
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

test('an external future drawingsV3 refresh preserves the root and hands B to legacy without blocking save', async () => {
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
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), false);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, false);
  assert.deepEqual(harness.store.exportRootValue(), futureRoot);
});

test('authoritative pull failure blocks leave and immediately hands B back to legacy', async () => {
  const harness = createHarness();
  assert.equal(await prepareVideo(harness), true);
  assert.equal(await harness.controller.toggle(), true);
  harness.setExportHandler(() => ({
    success: false,
    accepted: false,
    reason: 'overlay-unavailable'
  }));

  assert.equal(await harness.controller.flushPersistenceBeforeLeave(), false);
  assert.equal(harness.controller.shouldOwnDrawingShortcut(), false);
  assert.equal(harness.controller.getStatusSnapshot().persistenceBlocked, true);
  const b = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(b), false);
  assert.deepEqual(b.calls, []);
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
