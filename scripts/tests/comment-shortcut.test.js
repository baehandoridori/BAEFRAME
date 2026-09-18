const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
function appFunction(name, async = false) {
  const start = appSource.indexOf(`${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0, name);
  return appSource.slice(start, appSource.indexOf('\n  }', start) + 4);
}

async function createHarness(commentShortcut = { key: 'KeyC', ctrl: false, shift: false, alt: false }) {
  const dom = new JSDOM('<textarea id="draft"></textarea><button id="video">video</button>');
  const targets = await import(pathToFileURL(path.join(root, 'renderer/scripts/modules/keyboard-shortcut-targets.js')));
  const relay = await import(pathToFileURL(path.join(root, 'renderer/scripts/modules/mpv-overlay-keyboard-relay.js')));
  const userSettings = {
    getShortcut(action) {
      return action === 'commentMode' ? commentShortcut : null;
    },
    matchShortcut(action, event) {
      const binding = this.getShortcut(action);
      return !!binding && event.code === binding.key && event.ctrlKey === binding.ctrl &&
        event.shiftKey === binding.shift && event.altKey === binding.alt;
    }
  };
  let toggles = 0;
  const context = vm.createContext({
    ...targets, document: dom.window.document, userSettings,
    MPV_OVERLAY_RELAY_DRAWING_ACTIONS: [],
    state: { isCommentMode: false, isDrawMode: false },
    commentManager: { pendingMarker: null },
    getSplitViewManager: () => ({ isOpen: () => false }),
    fabricDrawingPilotController: { routeKeydown: () => false },
    shouldBlockFabricDrawingLegacyShortcut: () => false,
    ensureCutlistCommentTargetReady: async () => true,
    toggleCommentMode: () => { toggles += 1; }
  });
  for (const name of ['getMpvOverlayDrawModeShortcutDescriptor', 'getMpvOverlayRelayGlobalShortcutCodes']) {
    vm.runInContext(appFunction(name), context);
  }
  vm.runInContext(appFunction('handleKeydown', true), context);
  const pending = [];
  dom.window.document.addEventListener('keydown', event => pending.push(context.handleKeydown(event)), true);
  const send = async (init, forwarded = false) => {
    if (forwarded) {
      assert.equal(relay.dispatchMpvOverlayKeyboardInput({
        type: 'keyDown', key: 'c', code: 'KeyC', shiftKey: false, ctrlKey: false,
        altKey: false, metaKey: false, repeat: false, ...init
      }, {
        ownerDocument: dom.window.document,
        KeyboardEventConstructor: dom.window.KeyboardEvent,
        globalShortcutCodes: context.getMpvOverlayRelayGlobalShortcutCodes()
      }), true);
    } else {
      dom.window.document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key: 'c', code: 'KeyC', bubbles: true, cancelable: true, ...init
      }));
    }
    await Promise.all(pending.splice(0));
  };
  return { dom, context, send, toggles: () => toggles };
}

test('overlay C opens comment mode when main window retains a draft focus', async t => {
  const harness = await createHarness();
  t.after(() => harness.dom.window.close());
  const draft = harness.dom.window.document.getElementById('draft');
  draft.value = '보존할 댓글';
  draft.focus();
  await harness.send({}, true);
  assert.equal(harness.toggles(), 1);
  assert.equal(draft.value, '보존할 댓글');
});

test('custom comment chord escapes stale focus without stealing unmodified typing', async t => {
  const harness = await createHarness({ key: 'KeyG', ctrl: false, shift: true, alt: false });
  t.after(() => harness.dom.window.close());
  harness.dom.window.document.getElementById('draft').focus();
  await harness.send({ key: 'g', code: 'KeyG' }, true);
  assert.equal(harness.toggles(), 0);
  await harness.send({ key: 'G', code: 'KeyG', shiftKey: true }, true);
  assert.equal(harness.toggles(), 1);
});

test('main-window English and Korean typing in an editor never toggles comment mode', async t => {
  const harness = await createHarness();
  t.after(() => harness.dom.window.close());
  harness.dom.window.document.getElementById('draft').focus();
  await harness.send({});
  await harness.send({ key: 'Process', isComposing: true, keyCode: 229 });
  assert.equal(harness.toggles(), 0);
});

test('main-window Korean C outside an editor opens comments only once while held', async t => {
  const harness = await createHarness();
  t.after(() => harness.dom.window.close());
  harness.dom.window.document.getElementById('video').focus();
  await harness.send({ key: 'Process', isComposing: true, keyCode: 229 });
  await harness.send({ key: 'Process', isComposing: true, keyCode: 229, repeat: true });
  assert.equal(harness.toggles(), 1);
});

test('pending comment marker keeps its input even for a forwarded C', async t => {
  const harness = await createHarness();
  t.after(() => harness.dom.window.close());
  harness.context.commentManager.pendingMarker = {};
  await harness.send({}, true);
  assert.equal(harness.toggles(), 0);
});
