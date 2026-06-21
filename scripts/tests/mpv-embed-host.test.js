const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MPVEmbedHost,
  nativeWindowHandleToMpvWid,
  normalizeEmbedBounds
} = require('../../main/mpv-embed-host');

function createHandleBuffer(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function waitForAsyncReposition() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('converts Windows native window handle buffers to unsigned mpv wid strings', () => {
  assert.equal(nativeWindowHandleToMpvWid(createHandleBuffer(0x1234), 'win32'), '4660');
  assert.equal(nativeWindowHandleToMpvWid(createHandleBuffer(0xffffffff), 'win32'), '4294967295');
});

test('normalizes embed bounds to positive integer rectangles', () => {
  assert.deepEqual(
    normalizeEmbedBounds({ x: 10.6, y: 20.2, width: 640.8, height: 360.1 }),
    { x: 11, y: 20, width: 641, height: 360 }
  );
  assert.deepEqual(
    normalizeEmbedBounds({ x: -5, y: -3, width: 0.2, height: Number.NaN }),
    { x: 0, y: 0, width: 1, height: 1 }
  );
});

test('creates a child host window positioned over the main content area', async () => {
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
    showInactive() {
      events.push(['showInactive']);
    }
    setIgnoreMouseEvents(ignore, options) {
      events.push(['setIgnoreMouseEvents', ignore, options]);
    }
    isDestroyed() {
      return this.destroyed;
    }
    getNativeWindowHandle() {
      return createHandleBuffer(0x1200);
    }
    on() {}
    destroy() {
      this.destroyed = true;
      events.push(['destroy']);
    }
  }

  const host = new MPVEmbedHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    platform: 'win32'
  });

  const result = await host.ensure({ x: 25.4, y: 30.6, width: 640.2, height: 360.9 });

  assert.equal(result.success, true);
  assert.equal(result.wid, '4608');
  assert.deepEqual(result.bounds, { x: 125, y: 111, width: 640, height: 361 });
  assert.equal(events[0][0], 'construct');
  assert.equal(events[0][1].parent, fakeMainWindow);
  assert.equal(events[0][1].frame, false);
  assert.equal(events[0][1].transparent, true);
  assert.equal(events[0][1].backgroundColor, '#00000000');
  assert.equal(events[0][1].focusable, false);
  assert.equal(events[0][1].webPreferences.backgroundThrottling, false);
  assert.deepEqual(
    events.find(([name]) => name === 'setIgnoreMouseEvents'),
    ['setIgnoreMouseEvents', true, { forward: true }]
  );
  assert.equal(events.find(([name]) => name === 'loadURL')?.[1].includes('background:transparent'), true);
  assert.ok(events.some(([name]) => name === 'showInactive'));
});

test('updates and destroys an existing host window', async () => {
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 800, height: 600 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.bounds = null;
      this.destroyed = false;
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    showInactive() {}
    isDestroyed() {
      return this.destroyed;
    }
    getNativeWindowHandle() {
      return createHandleBuffer(99);
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVEmbedHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    platform: 'win32'
  });

  await host.ensure({ x: 1, y: 2, width: 300, height: 200 });
  const updateResult = host.updateBounds({ x: 5, y: 7, width: 320, height: 180 });

  assert.equal(updateResult.success, true);
  assert.deepEqual(updateResult.bounds, { x: 25, y: 37, width: 320, height: 180 });

  const destroyResult = host.destroy();
  assert.deepEqual(destroyResult, { success: true, destroyed: true });
  assert.equal(host.window, null);
});

test('hides and restores an embedded host without destroying playback', async () => {
  const events = [];
  const fakeMainWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 20, y: 30, width: 800, height: 600 })
  };
  class FakeBrowserWindow {
    constructor() {
      this.destroyed = false;
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
    isDestroyed() {
      return this.destroyed;
    }
    getNativeWindowHandle() {
      return createHandleBuffer(99);
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVEmbedHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    platform: 'win32'
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

test('repositions the host window when the parent window moves', async () => {
  const listeners = new Map();
  let contentBounds = { x: 100, y: 80, width: 1200, height: 800 };
  const fakeMainWindow = {
    isDestroyed: () => false,
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
      this.destroyed = false;
      this.boundsHistory = [];
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
      this.boundsHistory.push(bounds);
    }
    showInactive() {}
    isDestroyed() {
      return this.destroyed;
    }
    getNativeWindowHandle() {
      return createHandleBuffer(100);
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVEmbedHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    platform: 'win32'
  });

  await host.ensure({ x: 25, y: 30, width: 640, height: 360 });
  contentBounds = { x: 260, y: 170, width: 1200, height: 800 };
  for (const handler of listeners.get('move') || []) {
    handler();
  }
  await waitForAsyncReposition();

  assert.deepEqual(host.window.bounds, { x: 285, y: 200, width: 640, height: 360 });
  assert.deepEqual(host.window.boundsHistory, [
    { x: 125, y: 110, width: 640, height: 360 },
    { x: 285, y: 200, width: 640, height: 360 }
  ]);
});

test('hides the host while the parent is minimized and restores it with fresh bounds', async () => {
  const listeners = new Map();
  let contentBounds = { x: 40, y: 50, width: 1200, height: 800 };
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
      this.events = [];
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
      this.events.push(['setBounds', bounds]);
    }
    showInactive() {
      this.visible = true;
      this.events.push(['showInactive']);
    }
    hide() {
      this.visible = false;
      this.events.push(['hide']);
    }
    isDestroyed() {
      return this.destroyed;
    }
    getNativeWindowHandle() {
      return createHandleBuffer(101);
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVEmbedHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    platform: 'win32'
  });

  await host.ensure({ x: 10, y: 20, width: 640, height: 360 });
  minimized = true;
  for (const handler of listeners.get('minimize') || []) {
    handler();
  }

  assert.equal(host.window.visible, false);
  assert.ok(host.window.events.some(([name]) => name === 'hide'));

  minimized = false;
  contentBounds = { x: 140, y: 160, width: 1200, height: 800 };
  for (const handler of listeners.get('restore') || []) {
    handler();
  }
  await waitForAsyncReposition();

  assert.equal(host.window.visible, true);
  assert.deepEqual(host.window.bounds, { x: 150, y: 180, width: 640, height: 360 });
  assert.ok(host.window.events.some(([name]) => name === 'showInactive'));

  const showCountBeforeHiddenRestore = host.window.events.filter(([name]) => name === 'showInactive').length;
  host.setVisible(false);
  for (const handler of listeners.get('restore') || []) {
    handler();
  }
  await waitForAsyncReposition();

  assert.equal(host.window.visible, false);
  assert.equal(host.window.events.filter(([name]) => name === 'showInactive').length, showCountBeforeHiddenRestore);
});

test('destroys the host and unbinds parent listeners when the parent closes', async () => {
  const listeners = new Map();
  const fakeMainWindow = {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 10, y: 20, width: 1200, height: 800 }),
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
      this.destroyed = false;
    }
    loadURL() {
      return Promise.resolve();
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
    showInactive() {}
    isDestroyed() {
      return this.destroyed;
    }
    getNativeWindowHandle() {
      return createHandleBuffer(102);
    }
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }

  const host = new MPVEmbedHost({
    BrowserWindow: FakeBrowserWindow,
    getMainWindow: () => fakeMainWindow,
    platform: 'win32'
  });

  await host.ensure({ x: 10, y: 20, width: 640, height: 360 });
  const hostWindow = host.window;

  assert.equal((listeners.get('closed') || []).length, 1);
  for (const handler of [...(listeners.get('closed') || [])]) {
    handler();
  }

  assert.equal(hostWindow.destroyed, true);
  assert.equal(host.window, null);
  assert.equal((listeners.get('closed') || []).length, 0);
  assert.equal((listeners.get('move') || []).length, 0);
  assert.equal((listeners.get('minimize') || []).length, 0);
  assert.equal((listeners.get('restore') || []).length, 0);
});
