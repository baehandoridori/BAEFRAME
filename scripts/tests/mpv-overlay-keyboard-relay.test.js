const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const preloadPath = path.join(rootDir, 'preload/preload.js');
const relayModulePath = path.join(
  rootDir,
  'renderer/scripts/modules/mpv-overlay-keyboard-relay.js'
);
const shortcutTargetsModulePath = path.join(
  rootDir,
  'renderer/scripts/modules/keyboard-shortcut-targets.js'
);
const appPath = path.join(rootDir, 'renderer/scripts/app.js');

function loadMainPreload() {
  const exposed = new Map();
  const listeners = new Map();
  const removed = [];
  const invoked = [];
  const originalLoad = Module._load;
  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === 'electron') {
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            exposed.set(name, value);
          }
        },
        ipcRenderer: {
          invoke(channel, ...args) {
            invoked.push([channel, ...args]);
            return Promise.resolve({ success: true });
          },
          send() {},
          on(channel, listener) {
            listeners.set(channel, listener);
          },
          removeListener(channel, listener) {
            removed.push([channel, listener]);
            if (listeners.get(channel) === listener) listeners.delete(channel);
          },
          removeAllListeners() {}
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(preloadPath)];
    require(preloadPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(preloadPath)];
  }
  return { exposed, invoked, listeners, removed };
}

function validInput(overrides = {}) {
  return {
    type: 'keyDown',
    key: 'ㅂ',
    code: 'KeyQ',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    ...overrides
  };
}

function validPointerdownFrameRequest(overrides = {}) {
  return {
    hostGeneration: 3,
    videoGeneration: 7,
    inputRevision: 11,
    sessionId: 'main-preload-pointerdown-session',
    pointerdownId: 'main-preload-pointerdown-1',
    pointerdownAt: 1234,
    ...overrides
  };
}

test('main preload exposes a narrow validated overlay keyboard subscription', () => {
  const harness = loadMainPreload();
  const electronAPI = harness.exposed.get('electronAPI');
  assert.equal(typeof electronAPI.onMpvOverlayKeyboardInput, 'function');

  const received = [];
  const unsubscribe = electronAPI.onMpvOverlayKeyboardInput(input => {
    received.push(input);
  });
  const listener = harness.listeners.get('mpv-overlay:keyboard-input');
  assert.equal(typeof listener, 'function');

  const input = validInput();
  listener({}, input);
  assert.deepEqual(received, [input]);
  assert.notEqual(received[0], input);

  for (const malformed of [
    null,
    validInput({ type: 'char' }),
    validInput({ code: 'InjectedCode' }),
    validInput({ key: 'x'.repeat(65) }),
    validInput({ key: 'Process' }),
    validInput({ key: 'Dead' }),
    validInput({ code: 'Process' }),
    validInput({ shiftKey: 'yes' }),
    validInput({ extra: true })
  ]) {
    listener({}, malformed);
  }
  assert.equal(received.length, 1);

  unsubscribe();
  assert.equal(harness.listeners.has('mpv-overlay:keyboard-input'), false);
  assert.equal(harness.removed.length, 1);
});

test('main preload overlay keyboard bridge preserves Enter Tab Numpad and keyup fields', () => {
  const harness = loadMainPreload();
  const electronAPI = harness.exposed.get('electronAPI');
  const received = [];
  electronAPI.onMpvOverlayKeyboardInput(input => received.push(input));
  const listener = harness.listeners.get('mpv-overlay:keyboard-input');

  for (const input of [
    validInput({ key: 'Enter', code: 'Enter' }),
    validInput({ key: 'Tab', code: 'Tab', shiftKey: true }),
    validInput({ key: '1', code: 'Numpad1' }),
    validInput({ key: 'Enter', code: 'NumpadEnter' }),
    validInput({ type: 'keyUp', key: ' ', code: 'Space' })
  ]) {
    listener({}, input);
  }

  assert.deepEqual(received.map(({ type, code }) => [type, code]), [
    ['keyDown', 'Enter'],
    ['keyDown', 'Tab'],
    ['keyDown', 'Numpad1'],
    ['keyDown', 'NumpadEnter'],
    ['keyUp', 'Space']
  ]);
});

test('main preload exposes a narrow validated overlay pointer presence subscription', () => {
  const harness = loadMainPreload();
  const electronAPI = harness.exposed.get('electronAPI');
  assert.equal(typeof electronAPI.onMpvOverlayPointerPresence, 'function');

  const received = [];
  const unsubscribe = electronAPI.onMpvOverlayPointerPresence(presence => {
    received.push(presence);
  });
  const listener = harness.listeners.get('mpv-overlay:pointer-presence');
  assert.equal(typeof listener, 'function');

  const validPresence = { x: 0.25, y: 1 };
  listener({}, validPresence);
  listener({}, null);
  assert.deepEqual(received, [{ x: 0.25, y: 1 }, null]);
  assert.notEqual(received[0], validPresence);

  for (const malformed of [
    undefined,
    {},
    [],
    { x: 0.2, y: 0.3, extra: true },
    { x: -0.01, y: 0.5 },
    { x: 0.5, y: 1.01 },
    { x: Number.NaN, y: 0.5 },
    { x: '0.5', y: 0.5 }
  ]) {
    listener({}, malformed);
  }
  assert.equal(received.length, 2);

  unsubscribe();
  assert.equal(harness.listeners.has('mpv-overlay:pointer-presence'), false);
  assert.equal(harness.removed.length, 1);
});

test('main preload validates pointerdown frame subscriptions and exposes the confirm invoke', async () => {
  const harness = loadMainPreload();
  const electronAPI = harness.exposed.get('electronAPI');
  assert.equal(typeof electronAPI.onMpvOverlayDrawingPointerdownFrame, 'function');
  assert.equal(typeof electronAPI.mpvConfirmOverlayDrawingPointerdownFrame, 'function');

  const received = [];
  const unsubscribe = electronAPI.onMpvOverlayDrawingPointerdownFrame(request => {
    received.push(request);
  });
  const listener = harness.listeners.get('mpv-overlay:drawing-pointerdown-frame-request');
  assert.equal(typeof listener, 'function');

  const request = validPointerdownFrameRequest();
  listener({}, request);
  assert.deepEqual(received, [request]);
  assert.notEqual(received[0], request);
  for (const malformed of [
    null,
    validPointerdownFrameRequest({ hostGeneration: 0 }),
    validPointerdownFrameRequest({ sessionId: '' }),
    validPointerdownFrameRequest({ pointerdownId: 'p'.repeat(257) }),
    validPointerdownFrameRequest({ pointerdownAt: Number.POSITIVE_INFINITY }),
    { ...validPointerdownFrameRequest(), injected: true }
  ]) {
    listener({}, malformed);
  }
  assert.equal(received.length, 1);

  const confirmation = { ...request, targetFrame: 42 };
  assert.deepEqual(
    await electronAPI.mpvConfirmOverlayDrawingPointerdownFrame(confirmation),
    { success: true }
  );
  assert.deepEqual(harness.invoked.at(-1), [
    'mpv:confirm-overlay-drawing-pointerdown-frame',
    confirmation
  ]);

  unsubscribe();
  assert.equal(
    harness.listeners.has('mpv-overlay:drawing-pointerdown-frame-request'),
    false
  );
});

test('main preload exposes the dedicated collaboration state invoke channel', async () => {
  const harness = loadMainPreload();
  const electronAPI = harness.exposed.get('electronAPI');
  assert.equal(typeof electronAPI.mpvUpdateOverlayCollaboration, 'function');
  const state = { revision: 4 };
  assert.deepEqual(await electronAPI.mpvUpdateOverlayCollaboration(state), { success: true });
  assert.deepEqual(harness.invoked, [[
    'mpv:update-overlay-collaboration',
    state
  ]]);
});

test('main preload exposes only exact host-fenced collaboration action messages', () => {
  const harness = loadMainPreload();
  const electronAPI = harness.exposed.get('electronAPI');
  assert.equal(typeof electronAPI.onMpvOverlayCollaborationAction, 'function');
  const received = [];
  const unsubscribe = electronAPI.onMpvOverlayCollaborationAction(message => {
    received.push(message);
  });
  const listener = harness.listeners.get('mpv-overlay:collaboration-action');
  assert.equal(typeof listener, 'function');

  const valid = {
    action: 'sync.drag-move',
    payload: { pointerId: 7, clientX: -20, clientY: 500 },
    hostGeneration: 3,
    videoGeneration: 9,
    inputRevision: 12,
    activeSessionId: 'fabric-session-current',
    sequence: 4
  };
  listener({}, valid);
  const validEnd = {
    ...valid,
    action: 'sync.drag-end',
    payload: { pointerId: 7, clientX: 900, clientY: -30 },
    sequence: 5
  };
  listener({}, validEnd);
  assert.deepEqual(received, [valid, validEnd]);
  assert.notEqual(received[0], valid);
  assert.notEqual(received[0].payload, valid.payload);

  for (const malformed of [
    null,
    [],
    { ...valid, injected: true },
    { ...valid, action: 'unknown' },
    { ...valid, payload: null },
    { ...valid, payload: { pointerId: 7, clientX: Infinity, clientY: 80 } },
    { ...valid, hostGeneration: -1 },
    { ...valid, videoGeneration: 1.5 },
    { ...valid, inputRevision: -1 },
    { ...valid, activeSessionId: '' },
    { ...valid, sequence: 0 },
    Object.assign(Object.create({ inherited: true }), valid)
  ]) {
    listener({}, malformed);
  }
  assert.equal(received.length, 2);

  unsubscribe();
  assert.equal(harness.listeners.has('mpv-overlay:collaboration-action'), false);
});

test('renderer relay rebuilds a bubbling keyboard event with the exact physical code', async () => {
  assert.equal(
    fs.existsSync(relayModulePath),
    true,
    'the renderer keyboard relay module must exist'
  );
  const { dispatchMpvOverlayKeyboardInput } = await import(
    `${pathToFileURL(relayModulePath).href}?test=${Date.now()}`
  );
  const dispatched = [];
  class FakeKeyboardEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  const ownerDocument = {
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    }
  };

  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({
      key: 'ㅂ',
      code: 'KeyQ',
      ctrlKey: true,
      repeat: true
    }),
    { ownerDocument, KeyboardEventConstructor: FakeKeyboardEvent }
  ), true);
  assert.deepEqual(dispatched.map(event => ({ ...event })), [
    {
      type: 'keydown',
      key: 'ㅂ',
      code: 'KeyQ',
      shiftKey: false,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      repeat: true,
      bubbles: true,
      cancelable: true,
      composed: false
    }
  ]);

  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ type: 'keyUp', key: 'Enter', code: 'NumpadEnter' }),
    { ownerDocument, KeyboardEventConstructor: FakeKeyboardEvent }
  ), true);
  assert.equal(dispatched[1].type, 'keyup');
  assert.equal(dispatched[1].code, 'NumpadEnter');
});

test('renderer relay rejects malformed payloads before DOM dispatch', async () => {
  assert.equal(fs.existsSync(relayModulePath), true);
  const { dispatchMpvOverlayKeyboardInput } = await import(
    `${pathToFileURL(relayModulePath).href}?validation=${Date.now()}`
  );
  const dispatched = [];
  const ownerDocument = {
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    }
  };
  class FakeKeyboardEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  for (const malformed of [
    null,
    validInput({ type: 'char' }),
    validInput({ code: 'InjectedCode' }),
    validInput({ key: 'Process' }),
    validInput({ key: 'Dead' }),
    validInput({ ctrlKey: 1 }),
    validInput({ extra: true })
  ]) {
    assert.equal(dispatchMpvOverlayKeyboardInput(
      malformed,
      { ownerDocument, KeyboardEventConstructor: FakeKeyboardEvent }
    ), false);
  }
  assert.equal(dispatched.length, 0);
});

test('renderer relay keeps ordinary keys on the remembered editor but sends overlay history to the document', async () => {
  assert.equal(fs.existsSync(relayModulePath), true);
  const { dispatchMpvOverlayKeyboardInput } = await import(
    `${pathToFileURL(relayModulePath).href}?editable=${Date.now()}`
  );
  const {
    getEffectiveKeyboardShortcutTarget,
    shouldIgnoreGlobalShortcutTarget
  } = await import(
    `${pathToFileURL(shortcutTargetsModulePath).href}?overlay-history=${Date.now()}`
  );
  const activeEvents = [];
  const documentEvents = [];
  const activeElement = {
    tagName: 'TEXTAREA',
    dispatchEvent(event) {
      event.target = this;
      activeEvents.push(event);
      return true;
    }
  };
  const ownerDocument = {
    activeElement,
    dispatchEvent(event) {
      event.target = this;
      documentEvents.push(event);
      return true;
    }
  };
  class FakeKeyboardEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ key: 'Tab', code: 'Tab' }),
    { ownerDocument, KeyboardEventConstructor: FakeKeyboardEvent }
  ), true);
  assert.equal(activeEvents.length, 1);
  assert.equal(documentEvents.length, 0);

  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ key: 'z', code: 'KeyZ', ctrlKey: true }),
    { ownerDocument, KeyboardEventConstructor: FakeKeyboardEvent }
  ), true);
  assert.equal(activeEvents.length, 1);
  assert.equal(documentEvents.length, 1);
  assert.equal(documentEvents[0].code, 'KeyZ');
  const shortcutTarget = getEffectiveKeyboardShortcutTarget(
    documentEvents[0],
    ownerDocument
  );
  assert.equal(shortcutTarget, ownerDocument);
  assert.equal(shouldIgnoreGlobalShortcutTarget(shortcutTarget), false);
});

test('app subscribes once and dispatches overlay keyboard payloads through the guarded relay', () => {
  const appSource = fs.readFileSync(appPath, 'utf8');
  assert.match(
    appSource,
    /import\s*\{\s*dispatchMpvOverlayKeyboardInput\s*\}\s*from\s*['"]\.\/modules\/mpv-overlay-keyboard-relay\.js['"]/
  );
  assert.match(
    appSource,
    /window\.electronAPI\.onMpvOverlayKeyboardInput\?\.\(\(input\)\s*=>\s*\{\s*dispatchMpvOverlayKeyboardInput\(input,\s*\{\s*ownerDocument:\s*document,\s*globalShortcutCodes:\s*getMpvOverlayRelayGlobalShortcutCodes\(\)\s*\}\);\s*\}\);/
  );
});

test('릴레이된 전역 단축키 코드는 남아 있는 텍스트 포커스를 건너뛰고 문서로 간다', async () => {
  const { dispatchMpvOverlayKeyboardInput } = await import(
    `${pathToFileURL(relayModulePath).href}?global-shortcut=${Date.now()}`
  );
  class FakeKeyboardEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  const makeDocument = activeElement => {
    const activeEvents = [];
    const documentEvents = [];
    const ownerDocument = {
      activeElement,
      dispatchEvent(event) {
        documentEvents.push(event);
        return true;
      }
    };
    if (activeElement) {
      activeElement.dispatchEvent = event => {
        activeEvents.push(event);
        return true;
      };
    }
    return { ownerDocument, activeEvents, documentEvents };
  };

  // 텍스트 입력 포커스 + 등록된 전역 단축키 코드 → 문서로 우회
  const editor = makeDocument({ tagName: 'TEXTAREA' });
  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ key: 'ㅂ', code: 'KeyB' }),
    {
      ownerDocument: editor.ownerDocument,
      KeyboardEventConstructor: FakeKeyboardEvent,
      globalShortcutCodes: ['KeyB']
    }
  ), true);
  assert.equal(editor.activeEvents.length, 0);
  assert.deepEqual(editor.documentEvents.map(event => event.code), ['KeyB']);

  // 등록되지 않은 코드는 기존대로 활성 편집기로 간다
  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ key: 'c', code: 'KeyC' }),
    {
      ownerDocument: editor.ownerDocument,
      KeyboardEventConstructor: FakeKeyboardEvent,
      globalShortcutCodes: ['KeyB']
    }
  ), true);
  assert.deepEqual(editor.activeEvents.map(event => event.code), ['KeyC']);
  assert.equal(editor.documentEvents.length, 1);

  // 텍스트 입력이 아닌 포커스는 그대로 유지한다
  const button = makeDocument({ tagName: 'BUTTON' });
  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ key: 'b', code: 'KeyB' }),
    {
      ownerDocument: button.ownerDocument,
      KeyboardEventConstructor: FakeKeyboardEvent,
      globalShortcutCodes: ['KeyB']
    }
  ), true);
  assert.deepEqual(button.activeEvents.map(event => event.code), ['KeyB']);
  assert.equal(button.documentEvents.length, 0);

  // 빈 목록/비문자열은 기존 동작으로 되돌아간다
  const fallback = makeDocument({ tagName: 'TEXTAREA' });
  assert.equal(dispatchMpvOverlayKeyboardInput(
    validInput({ key: 'b', code: 'KeyB' }),
    {
      ownerDocument: fallback.ownerDocument,
      KeyboardEventConstructor: FakeKeyboardEvent,
      globalShortcutCodes: []
    }
  ), true);
  assert.deepEqual(fallback.activeEvents.map(event => event.code), ['KeyB']);
  assert.equal(fallback.documentEvents.length, 0);
});

test('app은 drawMode 단축키 코드를 릴레이 우회 목록으로 넘긴다', () => {
  const appSource = fs.readFileSync(appPath, 'utf8');
  assert.match(
    appSource,
    /function getMpvOverlayDrawModeShortcutDescriptor\(\) \{[\s\S]*?userSettings\.getShortcut\('drawMode'\)[\s\S]*?key: shortcut\.key[\s\S]*?\}/
  );
  // 우회 목록에는 drawMode 외에 그리기 도구·브러시 크기 단축키도 함께 들어간다.
  // 오버레이가 키보드를 갖고 있어도 메인 렌더러의 기억된 activeElement 가 에디터면
  // 그 키들이 에디터로 새고 컨트롤러가 editable-target 으로 버리기 때문이다.
  assert.match(
    appSource,
    /function getMpvOverlayRelayGlobalShortcutCodes\(\) \{[\s\S]*?drawModeShortcut\.ctrl && !drawModeShortcut\.shift && !drawModeShortcut\.alt[\s\S]*?codes\.add\(drawModeShortcut\.key\);[\s\S]*?return \[\.\.\.codes\];[\s\S]*?\}/
  );
  assert.match(appSource, /drawModeShortcut: getMpvOverlayDrawModeShortcutDescriptor\(\),/);
});
