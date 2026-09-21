const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { MPVEmbedHost } = require('../../main/mpv-embed-host');
const { MPVOverlayHost } = require('../../main/mpv-overlay-host');

// BrowserWindow is the OS boundary; run the real host listeners and geometry code.
function harness(Host) {
  const parent = new EventEmitter();
  let origin = { x: 100, y: 80, width: 1200, height: 800 };
  parent.getContentBounds = () => origin;
  parent.isDestroyed = () => false;
  const calls = [];
  const window = {
    bounds: null,
    visible: true,
    isVisible() { return this.visible; },
    isDestroyed: () => false,
    setBounds(bounds) { this.bounds = { ...bounds }; calls.push(['bounds', bounds]); },
    // Electron 28/Windows moveTop also shows a hidden window (native probe).
    moveTop() { this.visible = true; calls.push(['top']); },
    focus() { this.visible = true; calls.push(['focus']); },
    hide() { this.visible = false; }, showInactive() { this.visible = true; }, destroy() {}
  };
  const host = new Host({ BrowserWindow: class {}, getMainWindow: () => parent, platform: 'win32' });
  host.window = window;
  host._bindParentWindow(parent);
  host.updateBounds({ x: 25, y: 30, width: 640, height: 360 });
  calls.length = 0;
  return { host, parent, window, calls, move(x, y, event = 'move') { origin = { ...origin, x, y }; parent.emit(event); } };
}

test('a version menu keeps the overlay hidden through layout, movement and drawing input updates', async () => {
  const h = harness(MPVOverlayHost);
  try {
    h.host.setVisible(false);
    h.host.updateBounds({ x: 25, y: 30, width: 640, height: 360 });
    assert.equal(h.window.visible, false, 'unchanged layout must not show the overlay');
    h.host.updateBounds({ x: 25, y: 30, width: 800, height: 450 });
    assert.equal(h.window.visible, false, 'changed layout must not show the overlay');
    h.move(260, 170);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.window.visible, false, 'parent movement must not show the overlay');
    h.host._setNativeDrawingInput(h.window, true);
    assert.equal(h.window.visible, false, 'drawing enable must not focus a hidden overlay');
    h.host.setVisible(true);
    assert.equal(h.window.visible, true, 'closing the menu restores the overlay');
    assert.deepEqual(h.window.bounds, { x: 285, y: 200, width: 800, height: 450 });
  } finally { h.host.destroy(); }
});

for (const Host of [MPVEmbedHost, MPVOverlayHost]) {
  test(`${Host.name}: parent movement applies before the native event returns`, () => {
    const h = harness(Host);
    try {
      h.move(260, 170);
      assert.deepEqual(h.window.bounds, { x: 285, y: 200, width: 640, height: 360 });
      h.move(-100, 20);
      assert.deepEqual(h.window.bounds, { x: -75, y: 50, width: 640, height: 360 });
      assert.equal(h.calls.filter(([kind]) => kind === 'top').length, 0, 'movement must not reorder/focus windows');
    } finally { h.host.destroy(); }
  });

  test(`${Host.name}: duplicate move/moved/resize events do not repeat native work`, async () => {
    const h = harness(Host);
    try {
      h.move(260, 170);
      await new Promise(resolve => setImmediate(resolve));
      h.parent.emit('moved');
      await new Promise(resolve => setImmediate(resolve));
      h.parent.emit('resize');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.calls.filter(([kind]) => kind === 'bounds').length, 1);
    } finally { h.host.destroy(); }
  });

  test(`${Host.name}: a round trip via parent movement cannot leave stale bounds cached`, async () => {
    const h = harness(Host);
    try {
      h.move(260, 170);
      await new Promise(resolve => setImmediate(resolve));
      // The renderer may update before another parent notification arrives.
      h.parent.getContentBounds = () => ({ x: 100, y: 80, width: 1200, height: 800 });
      h.host.updateBounds({ x: 25, y: 30, width: 640, height: 360 });
      assert.deepEqual(h.window.bounds, { x: 125, y: 110, width: 640, height: 360 });
    } finally { h.host.destroy(); }
  });
}
