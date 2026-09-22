const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let createController;
before(async () => {
  ({ createFabricDrawingPilotController: createController } = await import(pathToFileURL(
    path.resolve(__dirname, '../../renderer/scripts/modules/fabric-drawing-pilot-controller.js')
  ).href));
});

test('a transient capability failure can be retried without restarting the app', async () => {
  let reads = 0;
  const controller = createController({ electronAPI: {
    getFabricDrawingPilotState: async () => { if (++reads === 1) throw new Error('bridge starting'); return true; }
  } });
  assert.equal(await controller.initialize(), false);
  assert.match(controller.getStatusSnapshot().lastError, /bridge starting/);
  assert.equal(await controller.initialize(), true);
  assert.equal(controller.isEnabled(), true);
  assert.equal(controller.getState(), 'passive');
  assert.equal(controller.getStatusSnapshot().lastError, null);
  assert.equal(reads, 2);
});

test('overlapping initialization shares one attempt and does not duplicate listeners', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  let reads = 0;
  let persistenceListeners = 0;
  let pointerListeners = 0;
  const controller = createController({
    persistenceStore: { applyTransition() {}, replaceFromOverlay() {} },
    electronAPI: {
      getFabricDrawingPilotState: async () => { reads++; return ready; },
      mpvHydrateOverlayDrawingVideo() {}, mpvExportOverlayDrawingVideo() {},
      onFabricDrawingPersistenceEvent: () => { persistenceListeners++; return () => {}; },
      onMpvOverlayDrawingPointerdownFrame: () => { pointerListeners++; return () => {}; }
    }
  });
  const first = controller.initialize();
  const second = controller.initialize();
  release(true);
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(await controller.initialize(), true);
  assert.equal(reads, 1);
  assert.equal(persistenceListeners, 1);
  assert.equal(pointerListeners, 1);
});

test('a persistence bridge that becomes ready later is rechecked', async () => {
  const api = { getFabricDrawingPilotState: async () => true };
  const controller = createController({ electronAPI: api,
    persistenceStore: { applyTransition() {}, replaceFromOverlay() {} }
  });
  assert.equal(await controller.initialize(), false);
  Object.assign(api, {
    mpvHydrateOverlayDrawingVideo() {}, mpvExportOverlayDrawingVideo() {},
    onFabricDrawingPersistenceEvent: () => () => {}
  });
  assert.equal(await controller.initialize(), true);
  assert.equal(controller.shouldOwnDrawingShortcut(), true);
});

test('an explicit disabled capability is reported truthfully and never bypassed', async () => {
  const snapshots = [];
  const controller = createController({
    electronAPI: { getFabricDrawingPilotState: async () => false },
    onStateChange: (state, snapshot) => snapshots.push({ state, snapshot })
  });
  assert.equal(await controller.initialize(), false);
  assert.equal(await controller.initialize(), false);
  assert.equal(controller.shouldOwnDrawingShortcut(), false);
  assert.match(controller.getStatusSnapshot().lastError, /disabled/);
  assert.match(snapshots.at(-1).snapshot.lastError, /disabled/);
});
