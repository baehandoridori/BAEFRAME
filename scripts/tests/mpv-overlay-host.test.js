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
