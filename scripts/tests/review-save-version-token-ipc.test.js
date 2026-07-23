const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');
const ipcHandlersPath = path.join(repoRoot, 'main', 'ipc-handlers.js');

function loadReviewIpcHandlers() {
  const handlers = new Map();
  const noop = () => {};
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    on: noop
  };
  const fakeModules = new Map([
    ['electron', {
      ipcMain,
      dialog: {},
      app: {},
      clipboard: {},
      shell: {}
    }],
    ['./logger', {
      createLogger: () => ({
        debug: noop,
        error: noop,
        info: noop,
        trace: () => ({ end: noop, error: noop }),
        warn: noop
      })
    }],
    ['./window', {
      closeWindow: noop,
      getMainWindow: () => null,
      isFullscreen: () => false,
      isMaximized: () => false,
      minimizeWindow: noop,
      toggleFullscreen: noop,
      toggleMaximize: noop
    }],
    ['./recent-files-store', { RecentFilesStore: class RecentFilesStore {} }],
    ['./recent-thumb-capture', {}],
    ['./cutlist-paths', { validateCutlistFilePath: value => value }],
    ['./mpv-manager', { MPVManager: class MPVManager {}, mpvManager: {} }],
    ['./mpv-embed-host', { mpvEmbedHost: {} }],
    ['./mpv-overlay-host', { mpvOverlayHost: {} }],
    ['electron-store', class Store {}]
  ]);
  const originalLoad = Module._load;

  delete require.cache[ipcHandlersPath];
  Module._load = function loadWithFakes(request, parent, isMain) {
    if (parent?.filename === ipcHandlersPath && fakeModules.has(request)) {
      return fakeModules.get(request);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const { setupIpcHandlers } = require(ipcHandlersPath);
    setupIpcHandlers();
    return handlers;
  } finally {
    Module._load = originalLoad;
    delete require.cache[ipcHandlersPath];
  }
}

function createTempReview(t, data) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'baeframe-review-version-token-')
  );
  const filePath = path.join(directory, 'review.bframe');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return filePath;
}

test('two writes with one review version token serialize so exactly one can replace the file', async t => {
  const handlers = loadReviewIpcHandlers();
  const loadSnapshot = handlers.get('file:load-review-snapshot');
  const saveReview = handlers.get('file:save-review');
  assert.equal(typeof loadSnapshot, 'function');
  assert.equal(typeof saveReview, 'function');

  const filePath = createTempReview(t, {
    reviewDocumentId: 'review-cas-same-token',
    winner: 'initial'
  });
  const snapshot = await loadSnapshot({}, filePath);
  const candidates = [
    { reviewDocumentId: 'review-cas-same-token', winner: 'first' },
    { reviewDocumentId: 'review-cas-same-token', winner: 'second' }
  ];

  const results = await Promise.all(candidates.map(data =>
    saveReview({}, filePath, data, {
      expectedVersionToken: snapshot.versionToken
    })
  ));

  assert.equal(results.filter(result => result.success === true).length, 1);
  assert.equal(
    results.filter(result =>
      result.success === false &&
      result.conflict === true &&
      result.reason === 'stale-version-token'
    ).length,
    1
  );
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const successfulIndex = results.findIndex(result => result.success === true);
  assert.deepEqual(persisted, candidates[successfulIndex]);
});

test('an external write makes an old review version token conflict without changing disk', async t => {
  const handlers = loadReviewIpcHandlers();
  const loadSnapshot = handlers.get('file:load-review-snapshot');
  const saveReview = handlers.get('file:save-review');
  const filePath = createTempReview(t, {
    reviewDocumentId: 'review-cas-external-write',
    revision: 1
  });
  const snapshot = await loadSnapshot({}, filePath);
  const externalData = {
    reviewDocumentId: 'review-cas-external-write',
    revision: 2,
    source: 'external'
  };
  fs.writeFileSync(filePath, JSON.stringify(externalData, null, 2), 'utf8');

  const result = await saveReview({}, filePath, {
    reviewDocumentId: 'review-cas-external-write',
    revision: 3,
    source: 'stale-local'
  }, {
    expectedVersionToken: snapshot.versionToken
  });

  assert.deepEqual(result, {
    success: false,
    conflict: true,
    reason: 'stale-version-token'
  });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(filePath, 'utf8')),
    externalData
  );
});

test('an existing bframe refuses a blind overwrite when no version token is provided', async t => {
  const handlers = loadReviewIpcHandlers();
  const saveReview = handlers.get('file:save-review');
  const originalData = {
    reviewDocumentId: 'review-cas-token-required',
    revision: 1
  };
  const filePath = createTempReview(t, originalData);

  const result = await saveReview({}, filePath, {
    reviewDocumentId: 'review-cas-token-required',
    revision: 2
  });

  assert.deepEqual(result, {
    success: false,
    conflict: true,
    reason: 'stale-version-token'
  });
  assert.deepEqual(
    JSON.parse(fs.readFileSync(filePath, 'utf8')),
    originalData
  );
});
