const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createViewportPanOwner, createViewportPanInput } = require('../../shared/viewport-pan-controller');
const fence = { hostGeneration: 1, videoGeneration: 2, persistenceSessionId: 's', stableVideoIdentity: 'v' };
function harness({ canPan = true, delayed = false } = {}) {
  let transform = { scale: 2, panX: 5, panY: 7 }, toggles = 0, draws = 0;
  const commands = [], messages = [], timers = new Map(); let tid = 0;
  const timing = { setTimeout: cb => { timers.set(++tid, cb); return tid; }, clearTimeout: id => timers.delete(id) };
  const owner = createViewportPanOwner({ ...timing, getFence: () => fence, canPan: () => canPan,
    getTransform: () => transform, applyTransform: t => { transform = t; }, togglePlayback: () => toggles++,
    send: value => { commands.push(value); if (!delayed) input.command(value); return true; } });
  const input = createViewportPanInput({ ...timing, getFence: () => fence, createId: () => 'g',
    send: value => { messages.push(value); owner.message(value); return true; },
    applyTransform: t => { transform = t; }, replay: events => { draws += events.filter(e => e.type === 'pointerdown').length; },
    requestAnimationFrame: cb => { timers.set(++tid, cb); return tid; }, cancelAnimationFrame: id => timers.delete(id) });
  const event = (type, x = 10, extra = {}) => ({ type, pointerId: 3, pointerType: 'pen', isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: 20, preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {}, ...extra });
  return { owner, input, event, commands, messages, timers, get transform() { return transform; }, get toggles() { return toggles; }, get draws() { return draws; } };
}
test('same-tick Space pen pan owns input, uses initial scale and consumes return to origin', () => {
  const h = harness(); h.owner.keyDown({ tapAllowed: true });
  h.input.down(h.event('pointerdown')); h.input.event(h.event('pointermove', 50));
  assert.equal(h.transform.panX, 25);
  h.input.event(h.event('pointerup', 10)); h.owner.keyUp();
  assert.equal(h.transform.panX, 5); assert.equal(h.draws, 0); assert.equal(h.toggles, 0);
});
test('keyup flushes unsent final coordinates before resolving tap', () => {
  const h = harness(); h.owner.keyDown({ tapAllowed: true }); h.input.down(h.event('pointerdown'));
  h.input.event(h.event('pointermove', 50)); h.owner.keyUp();
  assert.deepEqual(h.messages.map(v => v.phase), ['start', 'move', 'end']);
  assert.equal(h.toggles, 0); assert.equal(h.transform.panX, 25);
});
test('up before decision stays buffered; draw replays once and pan never draws', () => {
  for (const pan of [false, true]) {
    const h = harness({ delayed: true }); if (pan) h.owner.keyDown({ tapAllowed: true });
    h.input.down(h.event('pointerdown')); h.input.event(h.event('pointerup', 50));
    assert.equal(h.draws, 0); h.input.command(h.commands[0]); h.input.command(h.commands[0]);
    assert.equal(h.draws, pan ? 0 : 1); if (pan) assert.equal(h.transform.panX, 25);
  }
});
test('locked viewport blocks input; remapped/repeated Space never invents a playback action', () => {
  const h = harness({ canPan: false }); h.owner.keyDown({ tapAllowed: true }); h.input.down(h.event('pointerdown'));
  h.input.event(h.event('pointerup', 50)); h.owner.keyUp(); assert.equal(h.draws, 0); assert.equal(h.toggles, 0);
  const tap = harness(); tap.owner.keyDown({ tapAllowed: false }); tap.owner.keyUp(); assert.equal(tap.toggles, 0);
  tap.owner.keyDown({ tapAllowed: true }); tap.owner.keyDown({ tapAllowed: true, repeat: true }); tap.owner.keyUp(); tap.owner.keyUp(); assert.equal(tap.toggles, 1);
});
test('stale ack/foreign pointer/cancel cannot reverse the viewport or toggle playback', () => {
  const h = harness(); h.owner.keyDown({ tapAllowed: true }); h.input.down(h.event('pointerdown')); h.input.event(h.event('pointermove', 50));
  h.input.event(h.event('pointerup', 99, { pointerId: 9 }));
  h.input.command({ ...h.commands[0], type: 'ack', disposition: undefined, transform: { scale: 2, panX: -100, panY: 0 } });
  assert.equal(h.transform.panX, 25); h.input.cancel(); h.owner.keyUp(); assert.equal(h.toggles, 0);
});
test('Space during a draw retains draw ownership and consumes its key cycle', () => {
  const h = harness(); h.input.down(h.event('pointerdown')); assert.equal(h.draws, 1);
  h.owner.keyDown({ tapAllowed: true }); h.input.event(h.event('pointerup')); h.owner.keyUp(); assert.equal(h.toggles, 0);
});
test('decision timeout discards buffered input and never falls back to draw', () => {
  const h = harness({ delayed: true }); h.owner.keyDown({ tapAllowed: true }); h.input.down(h.event('pointerdown'));
  for (const cb of [...h.timers.values()]) cb();
  h.input.command(h.commands[0]); h.owner.keyUp(); assert.equal(h.draws, 0); assert.equal(h.toggles, 0);
});


test('native host checks both senders, every fence, monotonic events and actual overlay focus', () => {
  const { MPVOverlayHost } = require('../../main/mpv-overlay-host');
  const sent = [];
  const mainWindow = { webContents: { send: (...args) => sent.push(args) }, isDestroyed: () => false };
  const overlay = { webContents: { send: (...args) => sent.push(args) }, isDestroyed: () => false, isVisible: () => true, isFocused: () => true };
  const host = new MPVOverlayHost({ getMainWindow: () => mainWindow });
  Object.assign(host, { window: overlay, contentLoaded: true, requestedVisible: true, desiredInputEnabled: true,
    hostGeneration: 1, fabricReadyGeneration: 1, currentVideoGeneration: 2, currentInputRevision: 1,
    activeSessionId: 'input-s', currentPanPersistenceSessionId: 's', currentStableVideoIdentity: 'v' });
  const start = { ...fence, gestureId: 'g', sequence: 0, pointerId: 3, phase: 'start', clientX: 10, clientY: 20 };
  assert.equal(host.forwardViewportPan({ sender: mainWindow.webContents }, start), false);
  for (const key of Object.keys(fence)) assert.equal(host.forwardViewportPan({ sender: overlay.webContents }, { ...start, [key]: typeof fence[key] === 'number' ? 99 : 'other' }), false);
  assert.equal(host.forwardViewportPan({ sender: overlay.webContents }, start), true);
  assert.equal(host.forwardViewportPan({ sender: overlay.webContents }, start), false);
  const { phase, clientX, clientY, ...fields } = start;
  const decision = { ...fields, type: 'decision', disposition: 'pan', transform: { scale: 2, panX: 0, panY: 0 } };
  assert.equal(host.forwardViewportPanCommand({ sender: overlay.webContents }, decision), false);
  assert.equal(host.forwardViewportPanCommand({ sender: mainWindow.webContents }, decision), true);
  assert.equal(host.forwardViewportPan({ sender: overlay.webContents }, { ...start, phase: 'move', sequence: 1 }), true);
  assert.equal(host.forwardViewportPan({ sender: overlay.webContents }, { ...start, phase: 'move', sequence: 1 }), false);
  assert.deepEqual(host.getInputFocus({ sender: mainWindow.webContents }), fence);
  overlay.isFocused = () => false;
  assert.equal(host.getInputFocus({ sender: mainWindow.webContents }), null);
  host.currentStableVideoIdentity = 'new-video';
  assert.equal(host.forwardViewportPanCommand({ sender: mainWindow.webContents }, decision), false);
});

test('generated sandbox preload loads with electron-only require and validates fixed pan channels', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const exposed = {}, sent = [], received = new Map();
  const context = vm.createContext({ TextEncoder, require: name => {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
      ipcRenderer: { send: (...args) => sent.push(args), on: (key, cb) => received.set(key, cb), removeListener: key => received.delete(key) } };
  } });
  vm.runInContext(fs.readFileSync(require.resolve('../../preload/mpv-overlay-preload.bundle.js'), 'utf8'), context);
  assert.ok(exposed.mpvOverlayViewportPan);
  context.bridge = exposed.mpvOverlayViewportPan;
  const packet = { ...fence, gestureId: 'g', sequence: 0, pointerId: 3, phase: 'start', clientX: 0, clientY: 0 };
  assert.equal(vm.runInContext('bridge.send(' + JSON.stringify(packet) + ')', context), true);
  assert.equal(sent[0][0], 'mpv-overlay:viewport-pan');
  assert.equal(vm.runInContext('bridge.send(' + JSON.stringify({ ...packet, extra: true }) + ')', context), false);
});
