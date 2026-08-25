const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const controllerPath = path.join(
  __dirname,
  '..',
  '..',
  'renderer',
  'scripts',
  'modules',
  'fabric-drawing-pilot-controller.js'
);

let createFabricDrawingPilotController;

before(async () => {
  ({ createFabricDrawingPilotController } = await import(pathToFileURL(controllerPath).href));
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function createHarness(options = {}) {
  let id = 0;
  let revision = 4;
  let wallTime = options.wallTime ?? 100;
  let context = {
    isMpvActive: true,
    isAudio: false,
    stableVideoIdentity: 'C:/shots/display.mov',
    targetFrame: 99,
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { left: 0, top: 0, width: 960, height: 540 },
    viewportRevision: 1,
    viewportTransform: { scale: 1, panX: 0, panY: 0 },
    fps: 24,
    totalFrames: 240,
    ...options.context
  };
  const keyframes = [
    { id: 'kf-100', frame: 100, sourceWidth: 1920, sourceHeight: 1080, mutationSequence: 1, objects: [{ id: 'held' }] },
    { id: 'kf-150', frame: 150, sourceWidth: 1920, sourceHeight: 1080, mutationSequence: 2, objects: [] },
    { id: 'kf-200', frame: 200, sourceWidth: 1920, sourceHeight: 1080, mutationSequence: 3, objects: [{ id: 'next' }] }
  ];
  const calls = {
    input: [],
    hydrate: [],
    present: [],
    frame: [],
    pointerdownConfirm: [],
    action: []
  };
  let pointerdownFrameListener = null;
  let runtimeSnapshot = null;
  const rootValue = () => ({
    storageSchema: 'baeframe-drawings-v3',
    storageVersion: 1,
    engine: 'fabric',
    documentId: 'display-document',
    revision,
    fps: context.fps,
    totalFrames: context.totalFrames,
    keyframes: clone(keyframes)
  });
  const persistenceStore = {
    getStatus: () => ({ state: 'ready', compatible: true, revision }),
    exportRootValue: rootValue,
    importRootValue: () => ({ accepted: true, compatible: true, revision }),
    getSourceEpoch: () => 1,
    getHydrationDocument: () => ({
      documentId: 'display-document',
      revision,
      fps: context.fps,
      totalFrames: context.totalFrames,
      keyframes: clone(keyframes)
    }),
    replaceFromOverlay: () => ({ accepted: true, changed: false, revision }),
    applyTransition: () => ({ applied: true, revision }),
    resolveKeyframeAtFrame(targetFrame) {
      const source = [...keyframes]
        .reverse()
        .find(keyframe => keyframe.frame <= targetFrame);
      return clone(source || null);
    },
    getRevision: () => revision
  };
  const electronAPI = {
    getFabricDrawingPilotState: async () => true,
    onFabricDrawingPersistenceEvent: () => () => {},
    onMpvOverlayDrawingPointerdownFrame(callback) {
      pointerdownFrameListener = callback;
      return () => {
        if (pointerdownFrameListener === callback) pointerdownFrameListener = null;
      };
    },
    async mpvSetOverlayDrawingInput(request) {
      calls.input.push(request);
      if (options.onInput) return options.onInput(request, calls.input.length - 1);
      return { success: true, accepted: true, enabled: request.enabled };
    },
    async mpvHydrateOverlayDrawingVideo(request) {
      calls.hydrate.push(request);
      runtimeSnapshot = {
        hostGeneration: request.hostGeneration,
        videoGeneration: request.videoGeneration,
        persistenceSessionId: request.persistenceSessionId,
        stableVideoIdentity: request.stableVideoIdentity,
        fps: request.fps,
        totalFrames: request.totalFrames,
        scenes: request.keyframes.map(keyframe => ({
          sceneInstanceId: `display-scene-${keyframe.frame}`,
          targetFrame: keyframe.frame,
          sourceWidth: keyframe.sourceWidth,
          sourceHeight: keyframe.sourceHeight,
          mutationSequence: keyframe.mutationSequence,
          objects: clone(keyframe.objects)
        }))
      };
      return { success: true, accepted: true, sceneCount: request.keyframes.length, objectCount: 2 };
    },
    async mpvExportOverlayDrawingVideo() {
      return { success: true, accepted: true, snapshot: clone(runtimeSnapshot) };
    },
    async mpvPresentOverlayDrawingFrame(request) {
      calls.present.push(request);
      if (options.onPresent) return options.onPresent(request, calls.present.length - 1);
      return {
        success: true,
        accepted: true,
        presentationRevision: request.presentationRevision,
        targetFrame: request.targetFrame,
        sourceFrame: request.sourceFrame
      };
    },
    async mpvUpdateOverlayDrawingFrame(request) {
      calls.frame.push(request);
      if (options.onFrame) return options.onFrame(request, calls.frame.length - 1);
      return {
        success: true,
        accepted: true,
        frameRevision: request.frameRevision,
        targetFrame: request.targetFrame
      };
    },
    async mpvConfirmOverlayDrawingPointerdownFrame(request) {
      calls.pointerdownConfirm.push(request);
      if (options.onPointerdownConfirm) {
        return options.onPointerdownConfirm(request, calls.pointerdownConfirm.length - 1);
      }
      return {
        success: true,
        accepted: true,
        pointerdownId: request.pointerdownId,
        targetFrame: request.targetFrame
      };
    },
    async mpvApplyOverlayDrawingAction(request) {
      calls.action.push(request);
      if (options.onAction) return options.onAction(request, calls.action.length - 1);
      return { success: true, applied: true, deletedCount: 1 };
    }
  };
  const controller = createFabricDrawingPilotController({
    electronAPI,
    getContext: () => context,
    onStateChange: (state, snapshot) => options.onStateChange?.(state, snapshot, controller),
    persistenceStore,
    persistenceSessionIdFactory: () => 'display-persistence-session',
    uuid: () => `display-request-${++id}`,
    wallNow: () => wallTime,
    ...(options.persistenceIpcDeadlineMs
      ? { persistenceIpcDeadlineMs: options.persistenceIpcDeadlineMs }
      : {})
  });

  return {
    calls,
    controller,
    persistenceStore,
    setContext(patch) {
      context = { ...context, ...patch };
    },
    setWallTime(value) {
      wallTime = value;
    },
    setRevision(nextRevision) {
      revision = nextRevision;
    },
    setKeyframes(nextKeyframes) {
      keyframes.splice(0, keyframes.length, ...clone(nextKeyframes));
    },
    emitPointerdownFrame(request) {
      return pointerdownFrameListener?.(request);
    }
  };
}

async function preparePassive(harness) {
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 1
  }), true);
  assert.equal(await harness.controller.afterVideoReady({ loadToken: 'display-load' }), true);
  assert.equal(harness.controller.getState(), 'passive');
}

test('passive display resolves held sources and resends the same source when viewport geometry changes', async () => {
  const harness = createHarness();
  await preparePassive(harness);

  assert.equal(await harness.controller.syncDisplayFrame(99), true);
  assert.equal(await harness.controller.syncDisplayFrame(100), true);
  assert.equal(await harness.controller.syncDisplayFrame(101), true);
  assert.equal(await harness.controller.syncDisplayFrame(149), true);
  harness.setContext({
    canvasRect: { left: 12, top: 18, width: 900, height: 506.25 },
    viewportRevision: 2,
    viewportTransform: { scale: 1.25, panX: 14, panY: -8 }
  });
  assert.equal(await harness.controller.syncDisplayFrame(149), true);
  assert.equal(await harness.controller.syncDisplayFrame(150), true);

  assert.deepEqual(
    harness.calls.present.map(request => ({
      targetFrame: request.targetFrame,
      sourceFrame: request.sourceFrame,
      storeRevision: request.storeRevision,
      sourceWidth: request.sourceWidth,
      sourceHeight: request.sourceHeight,
      canvasRect: request.canvasRect,
      viewportRevision: request.viewportRevision,
      viewportTransform: request.viewportTransform
    })),
    [
      {
        targetFrame: 99, sourceFrame: null, storeRevision: 4,
        sourceWidth: 1920, sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 960, height: 540 },
        viewportRevision: 1,
        viewportTransform: { scale: 1, panX: 0, panY: 0 }
      },
      {
        targetFrame: 100, sourceFrame: 100, storeRevision: 4,
        sourceWidth: 1920, sourceHeight: 1080,
        canvasRect: { left: 0, top: 0, width: 960, height: 540 },
        viewportRevision: 1,
        viewportTransform: { scale: 1, panX: 0, panY: 0 }
      },
      {
        targetFrame: 149, sourceFrame: 100, storeRevision: 4,
        sourceWidth: 1920, sourceHeight: 1080,
        canvasRect: { left: 12, top: 18, width: 900, height: 506.25 },
        viewportRevision: 2,
        viewportTransform: { scale: 1.25, panX: 14, panY: -8 }
      },
      {
        targetFrame: 150, sourceFrame: 150, storeRevision: 4,
        sourceWidth: 1920, sourceHeight: 1080,
        canvasRect: { left: 12, top: 18, width: 900, height: 506.25 },
        viewportRevision: 2,
        viewportTransform: { scale: 1.25, panX: 14, panY: -8 }
      }
    ]
  );

  harness.setRevision(5);
  assert.equal(await harness.controller.syncDisplayFrame(151), true);
  assert.equal(harness.calls.present.at(-1).targetFrame, 151);
  assert.equal(harness.calls.present.at(-1).sourceFrame, 150);
  assert.equal(harness.calls.present.at(-1).storeRevision, 5);
});

test('passive display serializes one request and keeps only the newest trailing source', async () => {
  const first = deferred();
  const harness = createHarness({
    onPresent(request, index) {
      if (index === 0) return first.promise;
      return {
        success: true,
        accepted: true,
        presentationRevision: request.presentationRevision,
        targetFrame: request.targetFrame,
        sourceFrame: request.sourceFrame
      };
    }
  });
  await preparePassive(harness);

  const firstResult = harness.controller.syncDisplayFrame(100);
  const discardedTrailing = harness.controller.syncDisplayFrame(150);
  const newestTrailing = harness.controller.syncDisplayFrame(200);

  assert.equal(harness.calls.present.length, 1);
  assert.equal(await discardedTrailing, false);
  first.resolve({
    success: true,
    accepted: true,
    presentationRevision: harness.calls.present[0].presentationRevision,
    targetFrame: 100,
    sourceFrame: 100
  });

  assert.equal(await firstResult, false);
  assert.equal(await newestTrailing, true);
  assert.deepEqual(harness.calls.present.map(request => request.sourceFrame), [100, 200]);
});

test('seeking A to B and back to in-flight A replaces the stale B trailing request', async () => {
  const first = deferred();
  const harness = createHarness({
    onPresent(request, index) {
      if (index === 0) return first.promise;
      return {
        success: true,
        accepted: true,
        presentationRevision: request.presentationRevision,
        targetFrame: request.targetFrame,
        sourceFrame: request.sourceFrame
      };
    }
  });
  await preparePassive(harness);

  const firstA = harness.controller.syncDisplayFrame(100);
  const staleB = harness.controller.syncDisplayFrame(200);
  const latestA = harness.controller.syncDisplayFrame(101);

  assert.equal(await staleB, false);
  first.resolve({
    success: true,
    accepted: true,
    presentationRevision: harness.calls.present[0].presentationRevision,
    targetFrame: 100,
    sourceFrame: 100
  });
  assert.equal(await firstA, false);
  assert.equal(await latestA, true);
  assert.deepEqual(harness.calls.present.map(request => request.sourceFrame), [100, 100]);
  assert.equal(harness.calls.present.at(-1).targetFrame, 101);
});

test('active state syncs the latest playhead as an edit candidate while B-off force-presents it', async () => {
  const harness = createHarness({ context: { targetFrame: 101 } });
  await preparePassive(harness);

  assert.equal(await harness.controller.toggle(), true);
  const enableRequest = harness.calls.input.at(-1);
  assert.equal(enableRequest.enabled, true);
  assert.equal(enableRequest.session.targetFrame, 101);
  assert.equal(enableRequest.session.sourceFrame, 100);

  harness.setContext({ targetFrame: 200 });
  assert.equal(await harness.controller.syncDisplayFrame(200), true);
  assert.equal(harness.calls.present.length, 0);
  assert.equal(harness.calls.frame.length, 1);
  assert.deepEqual(Object.keys(harness.calls.frame[0]).sort(), [
    'frameRevision',
    'hostGeneration',
    'inputRevision',
    'sessionId',
    'targetFrame',
    'videoGeneration'
  ]);
  assert.equal(harness.calls.frame[0].targetFrame, 200);

  assert.equal(await harness.controller.disable(), true);
  assert.equal(harness.controller.getState(), 'passive');
  assert.equal(harness.calls.present.length, 1);
  assert.equal(harness.calls.present[0].targetFrame, 200);
  assert.equal(harness.calls.present[0].sourceFrame, 200);

  await harness.controller.beforeVideoChange('next-load');
  assert.equal(harness.controller.getState(), 'recovering');
  assert.equal(await harness.controller.syncDisplayFrame(100), false);
  assert.equal(harness.calls.present.length, 1);
});

test('active frame sync sends a coalesced latest target concurrently without waiting for an older invoke', async () => {
  const first = deferred();
  const harness = createHarness({
    context: { targetFrame: 10 },
    onFrame(request, index) {
      if (index === 0) return first.promise;
      return {
        success: true,
        accepted: true,
        frameRevision: request.frameRevision,
        targetFrame: request.targetFrame
      };
    }
  });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);

  const frame20 = harness.controller.syncDisplayFrame(20);
  const discarded21 = harness.controller.syncDisplayFrame(21);
  const latest22 = harness.controller.syncDisplayFrame(22);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(harness.calls.frame.map(request => request.targetFrame), [20, 22]);
  assert.equal(await discarded21, false);
  assert.equal(await latest22, true);

  const firstRequest = harness.calls.frame[0];
  first.resolve({
    success: true,
    accepted: true,
    frameRevision: firstRequest.frameRevision,
    targetFrame: firstRequest.targetFrame
  });
  assert.equal(await frame20, false);
});

test('active frame sync stays bounded and a replacement session sends without waiting for a stale owner', async () => {
  const first = deferred();
  const second = deferred();
  const harness = createHarness({
    context: { targetFrame: 10 },
    onFrame(request, index) {
      if (index === 0) return first.promise;
      if (index === 1) return second.promise;
      return {
        success: true,
        accepted: true,
        frameRevision: request.frameRevision,
        targetFrame: request.targetFrame
      };
    }
  });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);

  const frame20 = harness.controller.syncDisplayFrame(20);
  const replaced = [];
  for (let targetFrame = 21; targetFrame <= 120; targetFrame += 1) {
    replaced.push(harness.controller.syncDisplayFrame(targetFrame));
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(harness.calls.frame.map(request => request.targetFrame), [20, 120]);
  assert.equal(await replaced[0], false);

  harness.setContext({ targetFrame: 30 });
  assert.equal(await harness.controller.disable(), true);
  assert.equal(await harness.controller.toggle(), true);
  const replacementOwner = harness.controller.syncDisplayFrame(30);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.frame.length, 3, 'the new session must not wait for stale unresolved invokes');
  assert.notEqual(harness.calls.frame[2].sessionId, harness.calls.frame[0].sessionId);
  assert.equal(await replacementOwner, true);

  first.resolve({
    success: true,
    accepted: true,
    frameRevision: harness.calls.frame[0].frameRevision,
    targetFrame: harness.calls.frame[0].targetFrame
  });
  second.resolve({
    success: true,
    accepted: true,
    frameRevision: harness.calls.frame[1].frameRevision,
    targetFrame: harness.calls.frame[1].targetFrame
  });
  assert.equal(await frame20, false);
  assert.equal(await replaced.at(-1), false);
});

test('two unresolved active frame invokes time out locally so the newest pending frame can advance', async () => {
  const harness = createHarness({
    context: { targetFrame: 10 },
    persistenceIpcDeadlineMs: 10,
    onFrame(request, index) {
      if (index < 2) return new Promise(() => {});
      return {
        success: true,
        accepted: true,
        frameRevision: request.frameRevision,
        targetFrame: request.targetFrame
      };
    }
  });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);

  void harness.controller.syncDisplayFrame(20);
  void harness.controller.syncDisplayFrame(21);
  await new Promise(resolve => setImmediate(resolve));
  const newest = harness.controller.syncDisplayFrame(22);
  const result = await Promise.race([
    newest,
    new Promise(resolve => setTimeout(() => resolve('test-timeout'), 150))
  ]);
  assert.equal(result, true);
  assert.deepEqual(harness.calls.frame.map(request => request.targetFrame), [20, 21, 22]);
});

test('an unresolved burst coalesces to one newest target after the local deadline', async () => {
  const harness = createHarness({
    context: { targetFrame: 10 },
    persistenceIpcDeadlineMs: 10,
    onFrame: () => new Promise(() => {})
  });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);

  void harness.controller.syncDisplayFrame(20);
  void harness.controller.syncDisplayFrame(21);
  await new Promise(resolve => setImmediate(resolve));
  for (let targetFrame = 22; targetFrame <= 120; targetFrame += 1) {
    void harness.controller.syncDisplayFrame(targetFrame);
  }
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(harness.calls.frame.map(request => request.targetFrame), [20, 21, 120]);
});

test('drawing actions capture the keypress frame and do not wait for a forced preview update', async () => {
  const harness = createHarness({ context: { targetFrame: 20 } });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);

  const action = harness.controller.applyDrawingAction('delete-selection');
  harness.setContext({ targetFrame: 21 });
  assert.equal(await action, true);
  assert.equal(harness.calls.frame.length, 0);
  assert.equal(harness.calls.action.length, 1);
  assert.equal(harness.calls.action[0].targetFrame, 20);
});

test('pointerdown handshake confirms the current renderer frame and drops a stale session request', async () => {
  const harness = createHarness({ context: { targetFrame: 10 } });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);
  const session = harness.calls.input.at(-1).session;

  harness.setWallTime(200);
  harness.setContext({ targetFrame: 20 });
  assert.equal(await harness.controller.syncDisplayFrame(20), true);
  harness.setWallTime(300);
  harness.setContext({ targetFrame: 21 });
  assert.equal(await harness.controller.syncDisplayFrame(21), true);

  assert.equal(await harness.emitPointerdownFrame({
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    sessionId: session.sessionId,
    pointerdownId: 'pointerdown-current-1',
    pointerdownAt: 250
  }), true);
  assert.deepEqual(harness.calls.pointerdownConfirm, [{
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    sessionId: session.sessionId,
    pointerdownId: 'pointerdown-current-1',
    pointerdownAt: 250,
    targetFrame: 20
  }]);

  const staleRequest = {
    hostGeneration: 1,
    videoGeneration: 1,
    inputRevision: 2,
    sessionId: 'stale-session',
    pointerdownId: 'pointerdown-stale-1',
    pointerdownAt: 250
  };
  assert.equal(await harness.emitPointerdownFrame(staleRequest), false);
  assert.deepEqual(harness.calls.pointerdownConfirm[1], {
    ...staleRequest,
    cancelled: true
  });
});

for (const failure of ['rejected', 'timeout', 'throw']) {
  test(`pointerdown ${failure} sends a fenced negative acknowledgement`, async () => {
    const harness = createHarness({
      context: { targetFrame: 20 },
      persistenceIpcDeadlineMs: 10,
      onPointerdownConfirm(request) {
        if (request.cancelled === true) {
          return {
            success: true,
            accepted: true,
            cancelled: true,
            hostGeneration: request.hostGeneration,
            videoGeneration: request.videoGeneration,
            inputRevision: request.inputRevision,
            sessionId: request.sessionId,
            pointerdownId: request.pointerdownId,
            pointerdownAt: request.pointerdownAt
          };
        }
        if (failure === 'timeout') return new Promise(() => {});
        if (failure === 'throw') throw new Error('pointerdown confirmation failed');
        return { success: false, accepted: false, reason: 'confirmation-rejected' };
      }
    });
    await preparePassive(harness);
    assert.equal(await harness.controller.toggle(), true);
    const session = harness.calls.input.at(-1).session;
    harness.setWallTime(200);
    assert.equal(await harness.controller.syncDisplayFrame(20), true);

    const request = {
      hostGeneration: 1,
      videoGeneration: 1,
      inputRevision: 2,
      sessionId: session.sessionId,
      pointerdownId: `pointerdown-${failure}`,
      pointerdownAt: 200
    };
    assert.equal(await harness.emitPointerdownFrame(request), false);
    assert.deepEqual(harness.calls.pointerdownConfirm, [
      { ...request, targetFrame: 20 },
      { ...request, cancelled: true }
    ]);
  });
}

test('B-off blocks passive state-hook presentation until the disable acknowledgement', async () => {
  const disableGate = deferred();
  let holdDisable = false;
  let stateHookSync = null;
  const harness = createHarness({
    context: { targetFrame: 20 },
    onInput(request) {
      if (holdDisable && request.enabled === false) return disableGate.promise;
      return { success: true, accepted: true, enabled: request.enabled };
    },
    onStateChange(state, snapshot, controller) {
      if (state === 'passive' && snapshot.inputRevision === 2) {
        stateHookSync = controller.syncDisplayFrame(20);
      }
    }
  });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);
  holdDisable = true;

  const disabling = harness.controller.disable();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await stateHookSync, false);
  assert.equal(harness.calls.present.length, 0);

  disableGate.resolve({ success: true, accepted: true, enabled: false });
  assert.equal(await disabling, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.present.length, 1);
  assert.equal(harness.calls.present[0].targetFrame, 20);
});

test('an early B-off without a host cannot permanently block a later passive owner', async () => {
  const harness = createHarness({ context: { targetFrame: 100 } });
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(await harness.controller.disable(), false);

  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 1
  }), true);
  assert.equal(await harness.controller.afterVideoReady({ loadToken: 'display-load' }), true);
  assert.equal(await harness.controller.syncDisplayFrame(100, { force: true }), true);
  assert.equal(harness.calls.present.at(-1).hostGeneration, 1);
});

test('a stale disable owner neither blocks nor releases the replacement passive owner', async () => {
  const staleDisable = deferred();
  let holdStaleDisable = false;
  const harness = createHarness({
    context: { targetFrame: 100 },
    onInput(request) {
      if (holdStaleDisable && request.hostGeneration === 1 && request.enabled === false) {
        return staleDisable.promise;
      }
      return { success: true, accepted: true, enabled: request.enabled };
    }
  });
  await preparePassive(harness);
  assert.equal(await harness.controller.toggle(), true);

  holdStaleDisable = true;
  const disabling = harness.controller.disable();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 2
  }), true);
  const beforeReplacementPresent = harness.calls.present.length;
  assert.equal(await harness.controller.syncDisplayFrame(100, { force: true }), true);
  assert.equal(harness.calls.present.length, beforeReplacementPresent + 1);
  assert.equal(harness.calls.present.at(-1).hostGeneration, 2);

  staleDisable.resolve({ success: true, accepted: true, enabled: false });
  assert.equal(await disabling, false);
  assert.equal(await harness.controller.syncDisplayFrame(101, { force: true }), true);
  assert.equal(harness.calls.present.at(-1).hostGeneration, 2);
});

test('active frame sync drops a stale owner response on disable', async () => {
  const stale = deferred();
  const staleHarness = createHarness({
    context: { targetFrame: 10 },
    onFrame: () => stale.promise
  });
  await preparePassive(staleHarness);
  assert.equal(await staleHarness.controller.toggle(), true);

  const staleResult = staleHarness.controller.syncDisplayFrame(30);
  const staleRequest = staleHarness.calls.frame[0];
  const disabling = staleHarness.controller.disable();
  stale.resolve({
    success: true,
    accepted: true,
    frameRevision: staleRequest.frameRevision,
    targetFrame: staleRequest.targetFrame
  });
  assert.equal(await staleResult, false);
  assert.equal(await disabling, true);
});

test('a presentation response is discarded when its host owner changes while in flight', async () => {
  const held = deferred();
  const harness = createHarness({ onPresent: () => held.promise });
  await preparePassive(harness);

  const pending = harness.controller.syncDisplayFrame(100);
  const request = harness.calls.present[0];
  const recovery = harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 2
  });
  held.resolve({
    success: true,
    accepted: true,
    presentationRevision: request.presentationRevision,
    targetFrame: request.targetFrame,
    sourceFrame: request.sourceFrame
  });

  assert.equal(await pending, false);
  assert.equal(await recovery, true);
});

test('an in-flight presentation is discarded when the store revision and held source change', async () => {
  const held = deferred();
  const harness = createHarness({ onPresent: () => held.promise });
  await preparePassive(harness);

  const pending = harness.controller.syncDisplayFrame(149);
  const request = harness.calls.present[0];
  assert.equal(request.storeRevision, 4);
  assert.equal(request.sourceFrame, 100);

  harness.setRevision(5);
  harness.setKeyframes([
    { id: 'kf-120', frame: 120, sourceWidth: 1920, sourceHeight: 1080, mutationSequence: 4, objects: [{ id: 'new-hold' }] }
  ]);
  held.resolve({
    success: true,
    accepted: true,
    presentationRevision: request.presentationRevision,
    targetFrame: request.targetFrame,
    sourceFrame: request.sourceFrame
  });

  assert.equal(await pending, false);
});
