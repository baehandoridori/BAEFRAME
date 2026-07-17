const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  assert.equal(fs.existsSync(controllerPath), true, 'controller module should exist');
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

function createHarness(options = {}) {
  let id = 0;
  let context = {
    isMpvActive: true,
    isAudio: false,
    stableVideoIdentity: 'video-a',
    targetFrame: 12,
    sourceWidth: 1920,
    sourceHeight: 1080,
    canvasRect: { x: 10, y: 20, width: 960, height: 540 },
    ...options.context
  };
  const calls = {
    pilotState: 0,
    input: [],
    tool: [],
    action: [],
    diagnostics: []
  };
  const states = [];
  const methods = {
    async getFabricDrawingPilotState() {
      calls.pilotState += 1;
      if (options.pilotError) throw options.pilotError;
      return options.pilotState === undefined ? true : options.pilotState;
    },
    async mpvSetOverlayDrawingInput(request) {
      calls.input.push(request);
      if (options.onInput) return options.onInput(request, calls.input.length - 1);
      return { success: true, accepted: true, enabled: request.enabled };
    },
    async mpvUpdateOverlayDrawingTool(request) {
      calls.tool.push(request);
      if (options.onTool) return options.onTool(request, calls.tool.length - 1);
      return { success: true, accepted: true, tool: request.tool };
    },
    async mpvApplyOverlayDrawingAction(request) {
      calls.action.push(request);
      if (options.onAction) return options.onAction(request, calls.action.length - 1);
      return { success: true, applied: false, deletedCount: 0 };
    },
    async mpvGetOverlayDrawingDiagnostics(request) {
      calls.diagnostics.push(request);
      return { success: true, state: 'passive' };
    }
  };
  const electronAPI = new Proxy(methods, {
    get(target, property) {
      if (property in target) return target[property];
      throw new Error(`unexpected Electron API dependency: ${String(property)}`);
    }
  });
  const controller = createFabricDrawingPilotController({
    electronAPI,
    getContext: () => context,
    onStateChange: (state, snapshot) => states.push({ state, snapshot }),
    uuid: () => `uuid-${++id}`
  });

  return {
    calls,
    controller,
    states,
    setContext(patch) {
      context = { ...context, ...patch };
    }
  };
}

function createKeyEvent(key, overrides = {}) {
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
    calls,
    ...overrides
  };
}

async function preparePassive(harness, confirmation = { loadToken: 'load-a' }) {
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(await harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 1
  }), true);
  assert.equal(await harness.controller.afterVideoReady(confirmation), true);
  assert.equal(harness.controller.getState(), 'passive');
}

function assertEnvelope(request) {
  assert.equal(request.protocol, 'baeframe-drawing-surface');
  assert.equal(request.version, 1);
  assert.match(request.requestId, /^uuid-\d+$/);
}

test('controller exposes the complete public API and initialize reads a boolean once', async () => {
  const harness = createHarness();
  const expectedMethods = [
    'initialize',
    'adoptOverlayCapability',
    'beforeVideoChange',
    'afterVideoReady',
    'toggle',
    'routeKeydown',
    'disable',
    'isEnabled',
    'isActiveOrPreparing',
    'getState',
    'diagnostics'
  ];

  for (const method of expectedMethods) {
    assert.equal(typeof harness.controller[method], 'function', `${method} should be exposed`);
  }
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(await harness.controller.initialize(), true);
  assert.equal(harness.calls.pilotState, 1);
  assert.equal(harness.controller.isEnabled(), true);

  const nonBoolean = createHarness({ pilotState: { enabled: true } });
  assert.equal(await nonBoolean.controller.initialize(), false);
  assert.equal(nonBoolean.controller.getState(), 'disabled');

  const rejected = createHarness({ pilotError: new Error('unavailable') });
  assert.equal(await rejected.controller.initialize(), false);
  assert.equal(rejected.controller.getState(), 'disabled');
});

test('capability adoption validates passive readiness and never creates a video generation', async () => {
  const harness = createHarness();
  await harness.controller.initialize();

  assert.equal(await harness.controller.adoptOverlayCapability({ passiveReady: false, hostGeneration: 1 }), false);
  assert.equal(await harness.controller.adoptOverlayCapability({ passiveReady: true, hostGeneration: 0 }), false);
  assert.equal(await harness.controller.adoptOverlayCapability({ passiveReady: true, hostGeneration: 1.5 }), false);
  assert.equal(harness.calls.input.length, 0);

  assert.equal(await harness.controller.adoptOverlayCapability({ passiveReady: true, hostGeneration: 2 }), true);
  assert.equal(harness.controller.getState(), 'recovering');
  assert.equal(harness.controller.getState().includes('active'), false);
  assert.equal(harness.calls.input.length, 0);
  assert.equal((await harness.controller.diagnostics()).videoGeneration, 0);
});

test('initial video confirmation sends an accepted disable before B can enable', async () => {
  const firstDisable = deferred();
  const harness = createHarness({
    onInput(request, index) {
      if (index === 0) return firstDisable.promise;
      return { success: true, accepted: true, enabled: request.enabled };
    }
  });
  await harness.controller.initialize();
  await harness.controller.adoptOverlayCapability({ passiveReady: true, hostGeneration: 1 });

  const ready = harness.controller.afterVideoReady({ loadToken: 'load-a' });
  assert.equal(harness.calls.input.length, 1);
  assert.equal(harness.calls.input[0].enabled, false);
  assert.equal(harness.controller.getState(), 'recovering');
  assert.equal(await harness.controller.toggle(), false);
  assert.equal(harness.calls.input.filter(request => request.enabled).length, 0);

  firstDisable.resolve({ success: true, accepted: true, enabled: false });
  assert.equal(await ready, true);
  assert.equal(harness.controller.getState(), 'passive');

  assert.equal(await harness.controller.toggle(), true);
  assert.equal(harness.calls.input[1].enabled, true);
  assertEnvelope(harness.calls.input[0]);
  assertEnvelope(harness.calls.input[1]);
});

test('100 direct B toggles issue exactly 50 enables and 50 disables after setup', async () => {
  const harness = createHarness();
  await preparePassive(harness);
  const setupCount = harness.calls.input.length;

  for (let index = 0; index < 100; index += 1) {
    assert.equal(await harness.controller.toggle(), true);
  }

  const toggles = harness.calls.input.slice(setupCount);
  assert.equal(toggles.length, 100);
  assert.equal(toggles.filter(request => request.enabled).length, 50);
  assert.equal(toggles.filter(request => !request.enabled).length, 50);
  assert.deepEqual(toggles.map(request => request.inputRevision),
    Array.from({ length: 100 }, (_, index) => index + 2));
  assert.equal(new Set(toggles.filter(request => request.enabled)
    .map(request => request.session.sessionId)).size, 50);
  assert.equal(harness.controller.getState(), 'passive');
});

test('a preparing B exits immediately and a stale enable response cannot reactivate input', async () => {
  const pendingEnable = deferred();
  const harness = createHarness({
    onInput(request) {
      if (request.enabled) return pendingEnable.promise;
      return { success: true, accepted: true, enabled: false };
    }
  });
  await preparePassive(harness);

  const enabling = harness.controller.toggle();
  assert.equal(harness.controller.getState(), 'preparing');
  const cancelling = harness.controller.toggle();
  assert.equal(harness.controller.getState(), 'passive');
  assert.equal(await cancelling, true);

  pendingEnable.resolve({ success: true, accepted: true, enabled: true });
  assert.equal(await enabling, false);
  assert.equal(harness.controller.getState(), 'passive');
  assert.equal(harness.controller.isActiveOrPreparing(), false);
  assert.deepEqual(harness.calls.input.slice(-2).map(request => request.enabled), [true, false]);
  assert.ok(harness.calls.input.at(-1).inputRevision > harness.calls.input.at(-2).inputRevision);
});

test('targetFrame is pinned once for each fresh enable session', async () => {
  const pendingEnable = deferred();
  const harness = createHarness({
    onInput(request) {
      if (request.enabled) return pendingEnable.promise;
      return { success: true, accepted: true, enabled: false };
    }
  });
  await preparePassive(harness);

  const enabling = harness.controller.toggle();
  const request = harness.calls.input.at(-1);
  assert.equal(request.session.targetFrame, 12);
  harness.setContext({ targetFrame: 99 });
  assert.equal(request.session.targetFrame, 12);

  pendingEnable.resolve({ success: true, accepted: true, enabled: true });
  assert.equal(await enabling, true);
  assert.equal((await harness.controller.diagnostics()).targetFrame, 12);

  await harness.controller.toggle();
  await harness.controller.toggle();
  assert.equal(harness.calls.input.at(-1).session.targetFrame, 99);
  assert.notEqual(harness.calls.input.at(-1).session.sessionId, request.session.sessionId);
});

test('V updates desired tool during preparing and sends one monotonic update after activation', async () => {
  const pendingEnable = deferred();
  const harness = createHarness({
    onInput(request) {
      if (request.enabled) return pendingEnable.promise;
      return { success: true, accepted: true, enabled: false };
    }
  });
  await preparePassive(harness);

  const enabling = harness.controller.toggle();
  const event = createKeyEvent('v');
  assert.equal(harness.controller.routeKeydown(event), true);
  assert.deepEqual(event.calls, ['preventDefault', 'stopImmediatePropagation']);
  assert.equal(harness.calls.tool.length, 0);

  pendingEnable.resolve({ success: true, accepted: true, enabled: true });
  assert.equal(await enabling, true);
  assert.equal(harness.calls.tool.length, 1);
  assert.equal(harness.calls.tool[0].tool, 'select');
  assert.equal(harness.calls.tool[0].toolRevision, 1);
  assertEnvelope(harness.calls.tool[0]);

  const activeV = createKeyEvent('V');
  assert.equal(harness.controller.routeKeydown(activeV), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.tool.length, 2);
  assert.equal(harness.calls.tool[1].toolRevision, 2);
});

test('B always exits active mode directly even when the current tool is select', async () => {
  const harness = createHarness();
  await preparePassive(harness);
  await harness.controller.toggle();
  harness.controller.routeKeydown(createKeyEvent('V'));
  await new Promise(resolve => setImmediate(resolve));

  const event = createKeyEvent('b');
  assert.equal(harness.controller.routeKeydown(event), true);
  assert.equal(harness.controller.getState(), 'passive');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.input.at(-1).enabled, false);
});

test('Delete is consumed while preparing or active and only active invokes the pilot action', async () => {
  const pendingEnable = deferred();
  const harness = createHarness({
    onInput(request) {
      if (request.enabled) return pendingEnable.promise;
      return { success: true, accepted: true, enabled: false };
    },
    onAction() {
      return { success: false, applied: false, error: 'nothing selected' };
    }
  });
  await preparePassive(harness);

  const enabling = harness.controller.toggle();
  const preparingDelete = createKeyEvent('Delete');
  assert.equal(harness.controller.routeKeydown(preparingDelete), true);
  assert.equal(harness.calls.action.length, 0);

  pendingEnable.resolve({ success: true, accepted: true, enabled: true });
  await enabling;
  const activeDelete = createKeyEvent('Delete');
  assert.equal(harness.controller.routeKeydown(activeDelete), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.action.length, 1);
  assert.equal(harness.calls.action[0].action, 'delete-selection');
  assert.match(harness.calls.action[0].actionId, /^uuid-\d+$/);
  assertEnvelope(harness.calls.action[0]);
  assert.equal(harness.controller.getState(), 'active');
});

test('editable targets, modifiers, non-mpv, audio, and pilot OFF never consume keys', async () => {
  const harness = createHarness();
  await preparePassive(harness);

  const excluded = [
    createKeyEvent('b', { target: { tagName: 'INPUT', isContentEditable: false } }),
    createKeyEvent('b', { target: { tagName: 'TEXTAREA', isContentEditable: false } }),
    createKeyEvent('b', { target: { tagName: 'DIV', isContentEditable: true } }),
    createKeyEvent('b', { ctrlKey: true }),
    createKeyEvent('v', { metaKey: true }),
    createKeyEvent('Delete', { altKey: true }),
    createKeyEvent('b', { shiftKey: true })
  ];
  for (const event of excluded) {
    assert.equal(harness.controller.routeKeydown(event), false);
    assert.deepEqual(event.calls, []);
  }

  harness.setContext({ isMpvActive: false });
  assert.equal(harness.controller.routeKeydown(createKeyEvent('b')), false);
  harness.setContext({ isMpvActive: true, isAudio: true });
  assert.equal(harness.controller.routeKeydown(createKeyEvent('b')), false);

  const off = createHarness({ pilotState: false });
  await off.controller.initialize();
  assert.equal(off.controller.routeKeydown(createKeyEvent('b')), false);
  assert.equal(off.calls.input.length, 0);
});

test('video confirmations advance exactly once, disable first, and resume with a fresh session', async () => {
  const harness = createHarness();
  await preparePassive(harness, { loadToken: 'load-a' });
  await harness.controller.toggle();
  const firstSessionId = harness.calls.input.at(-1).session.sessionId;

  await harness.controller.beforeVideoChange();
  harness.setContext({ stableVideoIdentity: 'video-b', targetFrame: 44 });
  const beforeReadyCount = harness.calls.input.length;
  assert.equal(await harness.controller.afterVideoReady({ loadToken: 'load-b' }), true);
  const transition = harness.calls.input.slice(beforeReadyCount);
  assert.deepEqual(transition.map(request => request.enabled), [false, true]);
  assert.deepEqual(transition.map(request => request.videoGeneration), [2, 2]);
  assert.ok(transition[1].inputRevision > transition[0].inputRevision);
  assert.notEqual(transition[1].session.sessionId, firstSessionId);
  assert.equal(transition[1].session.stableVideoIdentity, 'video-b');
  assert.equal(transition[1].session.targetFrame, 44);

  const afterFirstConfirmation = harness.calls.input.length;
  assert.equal(await harness.controller.afterVideoReady({ loadToken: 'load-b' }), true);
  assert.equal(harness.calls.input.length, afterFirstConfirmation);
  assert.equal((await harness.controller.diagnostics()).videoGeneration, 2);
});

test('afterVideoReady uses its confirmed context when resuming before getContext catches up', async () => {
  const harness = createHarness();
  await preparePassive(harness);
  await harness.controller.toggle();
  await harness.controller.beforeVideoChange();

  assert.equal(await harness.controller.afterVideoReady({
    loadToken: 'load-b',
    stableVideoIdentity: 'video-b',
    targetFrame: 77,
    sourceWidth: 3840,
    sourceHeight: 2160,
    canvasRect: { left: 2, top: 4, width: 1920, height: 1080 }
  }), true);

  const resumed = harness.calls.input.at(-1);
  assert.equal(resumed.enabled, true);
  assert.equal(resumed.session.stableVideoIdentity, 'video-b');
  assert.equal(resumed.session.targetFrame, 77);
  assert.equal(resumed.session.sourceWidth, 3840);
});

test('a recovered host generation reconciles disable-first before an optional fresh session', async () => {
  const harness = createHarness();
  await preparePassive(harness);
  await harness.controller.toggle();
  const oldSessionId = harness.calls.input.at(-1).session.sessionId;
  const callCount = harness.calls.input.length;

  const recovery = harness.controller.adoptOverlayCapability({
    passiveReady: true,
    hostGeneration: 2
  });
  assert.equal(harness.controller.getState(), 'recovering');
  assert.equal(await recovery, true);

  const reconciliation = harness.calls.input.slice(callCount);
  assert.deepEqual(reconciliation.map(request => request.enabled), [false, true]);
  assert.deepEqual(reconciliation.map(request => request.hostGeneration), [2, 2]);
  assert.deepEqual(reconciliation.map(request => request.videoGeneration), [1, 1]);
  assert.notEqual(reconciliation[1].session.sessionId, oldSessionId);
  assert.equal(harness.controller.getState(), 'active');
});

test('current failures enter failed, clear draw state, and issue a newer best-effort disable', async () => {
  const harness = createHarness({
    onInput(request) {
      if (request.enabled) return { success: false, accepted: false, enabled: false };
      return { success: true, accepted: true, enabled: false };
    }
  });
  await preparePassive(harness);
  const count = harness.calls.input.length;

  assert.equal(await harness.controller.toggle(), false);
  const failedRequests = harness.calls.input.slice(count);
  assert.deepEqual(failedRequests.map(request => request.enabled), [true, false]);
  assert.ok(failedRequests[1].inputRevision > failedRequests[0].inputRevision);
  assert.equal(harness.controller.getState(), 'failed');
  assert.equal(harness.controller.isActiveOrPreparing(), false);
  assert.equal((await harness.controller.diagnostics()).sessionId, null);
});

test('all dependencies and request envelopes stay inside the Task 3 pilot bridge', async () => {
  const harness = createHarness();
  await preparePassive(harness);
  await harness.controller.toggle();
  harness.controller.routeKeydown(createKeyEvent('V'));
  harness.controller.routeKeydown(createKeyEvent('Delete'));
  await new Promise(resolve => setImmediate(resolve));
  const snapshot = await harness.controller.diagnostics();

  for (const request of [
    ...harness.calls.input,
    ...harness.calls.tool,
    ...harness.calls.action,
    ...harness.calls.diagnostics
  ]) {
    assertEnvelope(request);
  }
  assert.equal(snapshot.overlay.success, true);

  const source = fs.readFileSync(controllerPath, 'utf8');
  assert.doesNotMatch(source, /DrawingManager|ReviewDataManager|save|videoPlayer|loadVideo|pause|hybrid|freeze/);
});
