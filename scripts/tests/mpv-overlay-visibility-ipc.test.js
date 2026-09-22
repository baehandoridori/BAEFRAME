const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '../..');
const ipcHandlersPath = path.join(rootDir, 'main/ipc-handlers.js');
const preloadPath = path.join(rootDir, 'preload/preload.js');

function loadWithMocks(modulePath, mocks, useModule) {
  const originalLoad = Module._load;
  delete require.cache[modulePath];
  Module._load = function loadMock(request, parent, isMain) {
    if (parent?.filename === modulePath && mocks.has(request)) return mocks.get(request);
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return useModule(require(modulePath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modulePath];
  }
}

function createIpcHarness(options = {}) {
  const noop = () => {};
  const handlers = new Map();
  const overlayCalls = [];
  const embedCalls = [];
  const mainWebContents = { id: 31, isDestroyed: () => false };
  let mainWindow = { webContents: mainWebContents, isDestroyed: () => false };
  let ready = options.ready ?? true;
  let capabilityReads = 0;
  const mocks = new Map([
    ['electron', {
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), on: noop },
      dialog: {}, app: {}, clipboard: {}, shell: {}
    }],
    ['./logger', { createLogger: () => ({
      debug: noop, error: noop, info: noop, warn: noop,
      trace: () => ({ end: noop, error: noop })
    }) }],
    ['./window', { getMainWindow: () => mainWindow }],
    ['./recent-files-store', { RecentFilesStore: class RecentFilesStore {} }],
    ['./recent-thumb-capture', {}],
    ['./cutlist-paths', {}],
    ['./review-file-store', {}],
    ['./ffmpeg-manager', {}],
    ['./mpv-manager', { mpvManager: new Proxy({}, {
      get() { throw new Error('overlay visibility must not access the playback engine'); }
    }) }],
    ['./mpv-embed-host', { mpvEmbedHost: {
      setVisible(visible) {
        embedCalls.push(visible);
        return { success: true, visible, ready: true };
      }
    } }],
    ['./mpv-overlay-host', { mpvOverlayHost: {
      getDrawingCapability() {
        capabilityReads += 1;
        if (options.capabilityError) throw options.capabilityError;
        return { passiveReady: ready, fabricReady: false, hostGeneration: 5 };
      },
      setVisible(visible) {
        overlayCalls.push(visible);
        if (options.visibilityError) throw options.visibilityError;
        return { success: true, visible, ready: ready === true };
      }
    } }],
    ['electron-store', class Store {}]
  ]);
  loadWithMocks(ipcHandlersPath, mocks, ({ setupIpcHandlers }) => setupIpcHandlers());
  return {
    handlers, overlayCalls, embedCalls, mainWebContents,
    get capabilityReads() { return capabilityReads; },
    setMainWindow: value => { mainWindow = value; },
    setReady: value => { ready = value; },
    invoke(visible, event = { sender: mainWebContents }) {
      const handler = handlers.get('mpv:set-overlay-visible');
      assert.equal(typeof handler, 'function', 'overlay-only visibility IPC must be registered');
      return handler(event, visible);
    }
  };
}

test('overlay-only visibility shows and hides a prepared surface without touching playback', async () => {
  const harness = createIpcHarness();
  assert.deepEqual(await harness.invoke(true), { success: true, visible: true, ready: true });
  assert.deepEqual(await harness.invoke(false), { success: true, visible: false, ready: true });
  assert.deepEqual(harness.overlayCalls, [true, false]);
  assert.deepEqual(harness.embedCalls, []);
});

test('overlay-only visibility rejects other senders before accessing the host', async () => {
  const harness = createIpcHarness();
  for (const event of [{}, null, { sender: {} }, { sender: { id: 31 } }]) {
    const result = await harness.invoke(true, event);
    assert.equal(result.success, false);
    assert.match(result.error, /sender is not allowed/);
  }
  for (const mainWindow of [null,
    { webContents: harness.mainWebContents, isDestroyed: () => true },
    { webContents: { isDestroyed: () => true }, isDestroyed: () => false }]) {
    harness.setMainWindow(mainWindow);
    assert.equal((await harness.invoke(false)).success, false);
  }
  assert.equal(harness.capabilityReads, 0);
  assert.deepEqual(harness.overlayCalls, []);
  assert.deepEqual(harness.embedCalls, []);
});

test('overlay-only visibility requires a boolean instead of coercing malformed input', async () => {
  const harness = createIpcHarness();
  for (const input of [undefined, null, 0, 1, '', 'false', [], {}, { visible: true }]) {
    const result = await harness.invoke(input);
    assert.equal(result.success, false);
    assert.match(result.error, /invalid.*visibility/i);
  }
  assert.equal(harness.capabilityReads, 0);
  assert.deepEqual(harness.overlayCalls, []);
  assert.deepEqual(harness.embedCalls, []);
});

test('overlay-only hide is safe before preparation and still cancels requested visibility', async () => {
  const harness = createIpcHarness({ ready: false });
  assert.deepEqual(await harness.invoke(false), { success: true, visible: false, ready: false });
  assert.deepEqual(harness.overlayCalls, [false]);
  assert.equal(harness.capabilityReads, 0);
  assert.deepEqual(harness.embedCalls, []);
});

test('overlay-only show rejects an unprepared or destroyed surface and can retry after preparation', async () => {
  const harness = createIpcHarness({ ready: false });
  for (const readiness of [false, undefined, 1, 'true']) {
    harness.setReady(readiness);
    const result = await harness.invoke(true);
    assert.equal(result.success, false);
    assert.equal(result.visible, false);
    assert.equal(result.ready, false);
    assert.equal(result.reason, 'overlay-not-ready');
    assert.match(result.error, /not ready/i);
  }
  assert.deepEqual(harness.overlayCalls, []);
  harness.setReady(true);
  assert.deepEqual(await harness.invoke(true), { success: true, visible: true, ready: true });
  assert.deepEqual(harness.overlayCalls, [true]);
  assert.deepEqual(harness.embedCalls, []);
});

test('overlay-only visibility returns host errors without changing the native playback host', async () => {
  for (const options of [
    { capabilityError: new Error('capability failed') },
    { visibilityError: new Error('visibility failed') }
  ]) {
    const harness = createIpcHarness(options);
    const result = await harness.invoke(true);
    assert.equal(result.success, false);
    assert.match(result.error, /failed/);
    assert.deepEqual(harness.embedCalls, []);
  }
});

test('native playback visibility retains the existing paired embed and overlay behavior', async () => {
  const harness = createIpcHarness();
  const pairedVisibility = harness.handlers.get('mpv:set-host-visible');
  for (const [input, expected] of [[true, true], [false, false], [undefined, true]]) {
    const result = await pairedVisibility({ sender: harness.mainWebContents }, input);
    assert.equal(result.success, true);
    assert.equal(result.visible, expected);
    assert.equal(result.embed.visible, expected);
    assert.equal(result.overlay.visible, expected);
  }
  assert.deepEqual(harness.embedCalls, [true, false, true]);
  assert.deepEqual(harness.overlayCalls, [true, false, true]);
});

test('main preload forwards overlay-only visibility separately and preserves the response', async () => {
  const exposed = new Map();
  const invocations = [];
  const expected = { success: false, visible: false, ready: false, reason: 'overlay-not-ready' };
  const pending = Promise.resolve(expected);
  loadWithMocks(preloadPath, new Map([['electron', {
    contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
    ipcRenderer: {
      invoke: (channel, ...args) => { invocations.push([channel, ...args]); return pending; }
    }
  }]]), () => {});
  const api = exposed.get('electronAPI');
  assert.equal(typeof api.mpvSetOverlayVisible, 'function');
  for (const visible of [true, false, 'false']) {
    const result = api.mpvSetOverlayVisible(visible);
    assert.equal(result, pending);
    assert.equal(await result, expected);
  }
  assert.deepEqual(invocations, [
    ['mpv:set-overlay-visible', true],
    ['mpv:set-overlay-visible', false],
    ['mpv:set-overlay-visible', 'false']
  ]);
});
