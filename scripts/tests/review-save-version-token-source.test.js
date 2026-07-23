const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const preloadSource = fs.readFileSync(
  path.join(rootDir, 'preload/preload.js'),
  'utf8'
).replace(/\r\n/g, '\n');
const ipcSource = fs.readFileSync(
  path.join(rootDir, 'main/ipc-handlers.js'),
  'utf8'
).replace(/\r\n/g, '\n');

test('preload exposes a separate review snapshot API without changing loadReview', () => {
  assert.ok(
    /loadReviewSnapshot:\s*\(filePath\)\s*=>\s*ipcRenderer\.invoke\('file:load-review-snapshot',\s*filePath\)/.test(preloadSource),
    'preload must expose loadReviewSnapshot through file:load-review-snapshot'
  );
  assert.match(
    preloadSource,
    /loadReview:\s*\(filePath\)\s*=>\s*ipcRenderer\.invoke\('file:load-review',\s*filePath\)/
  );
  assert.match(
    preloadSource,
    /saveReview:\s*\(filePath,\s*data,\s*options\s*=\s*\{\}\)\s*=>\s*ipcRenderer\.invoke\('file:save-review',\s*filePath,\s*data,\s*options\)/
  );
});

test('main review snapshot and save handlers enforce the version-token conflict contract before writing', () => {
  const saveStart = ipcSource.indexOf("ipcMain.handle('file:save-review'");
  const snapshotStart = ipcSource.indexOf("ipcMain.handle('file:load-review-snapshot'");
  const loadStart = ipcSource.indexOf("ipcMain.handle('file:load-review'");
  assert.ok(saveStart >= 0, 'save review IPC handler must exist');
  assert.ok(snapshotStart >= 0, 'versioned review snapshot IPC handler must exist');
  assert.ok(loadStart > snapshotStart, 'legacy loadReview must remain a separate handler');

  const saveHandler = ipcSource.slice(saveStart, snapshotStart);
  const snapshotHandler = ipcSource.slice(snapshotStart, loadStart);
  assert.match(snapshotHandler, /versionToken/);
  assert.match(snapshotHandler, /data/);
  assert.match(saveHandler, /expectedVersionToken/);
  assert.match(saveHandler, /conflict:\s*true/);
  assert.match(saveHandler, /reason:\s*'stale-version-token'/);

  const tokenCheckIndex = saveHandler.indexOf('expectedVersionToken');
  const staleConflictIndex = saveHandler.indexOf("'stale-version-token'");
  const writeIndex = saveHandler.indexOf('writeFile');
  assert.ok(tokenCheckIndex >= 0 && tokenCheckIndex < writeIndex);
  assert.ok(staleConflictIndex >= 0 && staleConflictIndex < writeIndex);
});
