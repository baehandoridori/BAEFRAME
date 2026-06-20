const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MPVOverlayHost,
  normalizeOverlayState
} = require('../../main/mpv-overlay-host');

function waitForAsyncReposition() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('normalizes overlay state to bounded serializable fields', () => {
  const state = normalizeOverlayState({
    drawingDataUrl: 'data:image/png;base64,abc',
    onionDataUrl: 'file://not-allowed',
    markerHtml: '<div class="comment-marker"></div>',
    canvas: { left: 10.4, top: 20.6, width: 640.2, height: 360.7 },
    markerTransform: 'scale(2) translate(1px, 2px)',
    markerTransformOrigin: 'center center'
  });

  assert.deepEqual(state.canvas, { left: 10, top: 21, width: 640, height: 361 });
  assert.equal(state.drawingDataUrl, 'data:image/png;base64,abc');
  assert.equal(state.onionDataUrl, '');
  assert.equal(state.markerHtml, '<div class="comment-marker"></div>');
  assert.equal(state.markerTransform, 'scale(2) translate(1px, 2px)');
  assert.equal(state.markerTransformOrigin, 'center center');
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
    ['setIgnoreMouseEvents', true, { forward: true }]
  );
  const overlayHtml = decodeURIComponent(events.find(([name]) => name === 'loadURL')?.[1] || '');
  assert.equal(overlayHtml.includes('__applyMpvOverlayState'), true);
  assert.equal(overlayHtml.includes('applyOverlayTransform'), true);
  assert.equal(overlayHtml.includes("applyImage('drawingCanvasMirror', nextState.drawingDataUrl, nextState.canvas)"), true);
  assert.doesNotMatch(
    overlayHtml,
    /function applyImage\([\s\S]*?applyOverlayTransform\(element, state\)[\s\S]*?\n    \}/
  );
  assert.equal(overlayHtml.includes("element.style.transform = 'none';"), true);
  assert.ok(events.some(([name]) => name === 'showInactive'));
  assert.ok(events.some(([name]) => name === 'moveTop'));
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
    drawingDataUrl: 'data:image/png;base64,draw',
    canvas: { left: 1, top: 2, width: 3, height: 4 }
  });

  assert.equal(result.success, true);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /window\.__applyMpvOverlayState/);
  assert.match(scripts[0], /comment-marker pending/);
  assert.match(scripts[0], /data:image\/png;base64,draw/);
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
});
