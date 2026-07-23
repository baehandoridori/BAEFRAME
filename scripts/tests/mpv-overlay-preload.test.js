const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const preloadPath = path.join(rootDir, 'preload/mpv-overlay-preload.js');
const MAX_TRANSITION_BYTES = 8 * 1024 * 1024;

function makeTransition(overrides = {}) {
  return {
    hostGeneration: 3,
    videoGeneration: 7,
    persistenceSessionId: 'overlay-persistence-session',
    stableVideoIdentity: 'C:/shots/overlay.mov',
    scene: {
      sceneInstanceId: 'overlay-scene-1',
      targetFrame: 24,
      sourceWidth: 1920,
      sourceHeight: 1080
    },
    mutationSequence: 1,
    origin: 'live',
    kind: 'add-objects',
    estimatedBytes: 64,
    unsupportedReason: null,
    removals: [],
    insertions: [],
    transforms: [],
    ...overrides
  };
}

function loadOverlayPreload({ sendError = null } = {}) {
  assert.equal(fs.existsSync(preloadPath), true, 'overlay persistence preload must exist');
  const sent = [];
  const exposed = new Map();
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
          send(channel, message) {
            if (sendError) throw sendError;
            sent.push([channel, message]);
          }
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
  return { exposed, sent };
}

test('overlay preload exposes one narrow committed-transition bridge and sends plain JSON', () => {
  const harness = loadOverlayPreload();
  assert.deepEqual([...harness.exposed.keys()], ['mpvOverlayPersistence']);
  const bridge = harness.exposed.get('mpvOverlayPersistence');
  assert.deepEqual(Object.keys(bridge), ['notifyCommittedTransition']);

  const transition = makeTransition();
  assert.equal(bridge.notifyCommittedTransition(transition), true);
  assert.deepEqual(harness.sent, [[
    'mpv-overlay:fabric-drawing-persistence',
    { type: 'transition', transition }
  ]]);
  assert.notEqual(harness.sent[0][1].transition, transition);
});

test('overlay preload compacts oversized and unserializable transitions into exact resync envelopes', () => {
  const harness = loadOverlayPreload();
  const bridge = harness.exposed.get('mpvOverlayPersistence');
  const oversized = makeTransition({
    insertions: [{ payload: 'x'.repeat(MAX_TRANSITION_BYTES) }]
  });
  assert.equal(bridge.notifyCommittedTransition(oversized), true);

  const cyclic = makeTransition({ mutationSequence: 2 });
  cyclic.self = cyclic;
  assert.equal(bridge.notifyCommittedTransition(cyclic), true);

  assert.deepEqual(harness.sent, [
    [
      'mpv-overlay:fabric-drawing-persistence',
      {
        type: 'resync-required',
        hostGeneration: 3,
        videoGeneration: 7,
        persistenceSessionId: 'overlay-persistence-session',
        stableVideoIdentity: 'C:/shots/overlay.mov',
        reason: 'transition-too-large'
      }
    ],
    [
      'mpv-overlay:fabric-drawing-persistence',
      {
        type: 'resync-required',
        hostGeneration: 3,
        videoGeneration: 7,
        persistenceSessionId: 'overlay-persistence-session',
        stableVideoIdentity: 'C:/shots/overlay.mov',
        reason: 'transition-serialization-failed'
      }
    ]
  ]);
});

test('overlay preload drops invalid fences and isolates send failures from committed drawing state', () => {
  const harness = loadOverlayPreload();
  const bridge = harness.exposed.get('mpvOverlayPersistence');
  assert.equal(bridge.notifyCommittedTransition(makeTransition({ hostGeneration: -1 })), false);
  assert.equal(harness.sent.length, 0);

  const failing = loadOverlayPreload({ sendError: new Error('injected send failure') });
  assert.doesNotThrow(() => {
    assert.equal(
      failing.exposed.get('mpvOverlayPersistence').notifyCommittedTransition(makeTransition()),
      false
    );
  });
});
