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
const reviewFileStoreSource = fs.readFileSync(
  path.join(rootDir, 'main/review-file-store.js'),
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

test('main review IPC delegates versioned snapshots and transactional saves to the review file store', () => {
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
  assert.match(snapshotHandler, /readReviewSnapshot\(validatedPath\)/);
  assert.match(saveHandler, /expectedVersionToken/);
  assert.match(saveHandler, /saveReviewFile\(validatedPath,\s*data,/);
  assert.match(saveHandler, /failIfExists:\s*options\?\.failIfExists === true/);
});

test('review file store checks the token before preparing and uses guarded CAS at commit', () => {
  assert.match(reviewFileStoreSource, /reason:\s*'stale-version-token'/);
  assert.match(reviewFileStoreSource, /createReviewVersionToken\(currentContent\)/);

  const transactionStart = reviewFileStoreSource.indexOf(
    'async function saveWithoutQueue'
  );
  const transactionEnd = reviewFileStoreSource.indexOf(
    'async function saveReviewFile',
    transactionStart
  );
  assert.ok(transactionStart >= 0 && transactionEnd > transactionStart);
  const transaction = reviewFileStoreSource.slice(
    transactionStart,
    transactionEnd
  );
  const initialCheckIndex = transaction.indexOf('initialStateResult');
  const transactionCommitIndex = transaction.indexOf(
    'commitSerializedUnderLock'
  );
  assert.ok(
    initialCheckIndex >= 0 &&
    initialCheckIndex < transactionCommitIndex
  );

  const commitStart = reviewFileStoreSource.indexOf(
    'async function commitSerializedUnderLock'
  );
  const commitEnd = reviewFileStoreSource.indexOf(
    'async function saveWithoutQueue',
    commitStart
  );
  const commitTransaction = reviewFileStoreSource.slice(
    commitStart,
    commitEnd
  );
  assert.ok(
    commitTransaction.indexOf('waitForRecoverySlot') <
      commitTransaction.indexOf('commitWithRetry')
  );
  assert.match(commitTransaction, /currentBeforeCommitToken !== baseVersionToken/);
  assert.match(
    reviewFileStoreSource,
    /atomicCompareAndReplace\(\{[\s\S]*expectedVersionToken,[\s\S]*replacementVersionToken/
  );
});
