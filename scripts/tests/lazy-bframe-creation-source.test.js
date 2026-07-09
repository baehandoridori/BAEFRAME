const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, '\n');
}

const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const reviewDataManagerSource = normalizeNewlines(
  fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/review-data-manager.js'), 'utf8')
);
const preloadSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'preload/preload.js'), 'utf8'));
const ipcHandlersSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/ipc-handlers.js'), 'utf8'));

test('missing .bframe loads enter deferred discovery instead of immediate collaboration save', () => {
  assert.match(appSource, /function startDeferredReviewFileDiscovery\(loadToken, bframePath\)/);
  assert.match(appSource, /function stopDeferredReviewFileDiscovery\(bframePath = null\)/);
  assert.match(appSource, /async function handleDeferredReviewFileDiscovered\(bframePath, source = 'watch'\)/);
  assert.match(appSource, /function isCurrentReviewPath\(bframePath\) \{\s*return !!bframePath && isSameFilePath\(reviewDataManager\.currentBframePath, bframePath\);/);
  assert.match(appSource, /const synced = await syncReviewFileFromDisk\(bframePath, \{[\s\S]*bypassDebounce: true,/);
  assert.match(appSource, /if \(synced\) \{\s*stopDeferredReviewFileDiscovery\(bframePath\);\s*\}/);
  assert.doesNotMatch(appSource, /stopDeferredReviewFileDiscovery\(bframePath\);\s*log\.info\('지연 \.bframe 생성 감지됨'/);

  const renderMarkerIndex = appSource.indexOf('// 마커 및 그리기 렌더링 업데이트');
  const branchStart = appSource.lastIndexOf('if (hasExistingData) {', renderMarkerIndex);
  assert.ok(branchStart > -1, 'loadVideo should branch on existing .bframe data before rendering markers');
  const loadBranch = appSource.slice(branchStart, renderMarkerIndex);

  assert.match(loadBranch, /if \(deferCollaborationStart\) \{[\s\S]*scheduleDeferredCollaborationStart\(loadToken, currentBframePath\);/);
  assert.match(loadBranch, /await startCollaborationForVideoLoad\(loadToken, currentBframePath\);/);
  assert.match(loadBranch, /else \{\s*startDeferredReviewFileDiscovery\(loadToken, currentBframePath\);\s*\}/);
});

test('new review room can be attached to first save without recursively saving at load time', () => {
  assert.match(appSource, /async function startCollaborationForVideoLoad\(loadToken, bframePath, options = \{\}\)/);
  assert.match(appSource, /const \{ persistNewRoom = true \} = options;/);

  const newRoomBranch = appSource.match(/if \(isNewRoom && isCurrentReviewPath\(bframePath\)\) \{([\s\S]*?)\n      \}/);
  assert.ok(newRoomBranch, 'startCollaborationForVideoLoad should handle newly-created rooms explicitly');
  assert.match(newRoomBranch[1], /reviewDataManager\.setLiveblocksRoomId\(roomId\);/);
  assert.match(newRoomBranch[1], /if \(persistNewRoom\) \{/);
  assert.match(newRoomBranch[1], /await reviewDataManager\.save\(\{ skipMerge: true \}\);/);
});

test('first .bframe save is protected against another user creating the file first', () => {
  assert.match(reviewDataManagerSource, /setBeforeSaveHandler\(handler\)/);
  assert.match(reviewDataManagerSource, /setInitialSaveConflictHandler\(handler\)/);
  assert.match(reviewDataManagerSource, /failIfExists: wasInitialPersist/);
  assert.match(reviewDataManagerSource, /saveResult\?\.exists === true/);
  assert.match(reviewDataManagerSource, /lastConflictResult = await this\._initialSaveConflictHandler\?\.\(\{/);
  assert.match(reviewDataManagerSource, /if \(lastConflictResult\?\.success === true\) \{[\s\S]*this\._hasPersistedFile = true;[\s\S]*\} else \{[\s\S]*this\._hasPersistedFile = false;/);
  assert.match(reviewDataManagerSource, /if \(!savedData\) \{[\s\S]*throw new Error\(lastConflictResult\?\.error/);
  assert.match(appSource, /const mergeResult = await reviewDataManager\.reloadAndMerge\(\{ merge: true, force: true \}\);[\s\S]*if \(!mergeResult\.success\) \{[\s\S]*return mergeResult;/);

  assert.match(preloadSource, /saveReview: \(filePath, data, options = \{\}\) => ipcRenderer\.invoke\('file:save-review', filePath, data, options\)/);
  assert.match(ipcHandlersSource, /failIfExists/);
  assert.match(ipcHandlersSource, /flag: options\?\.failIfExists \? 'wx' : 'w'/);
  assert.match(ipcHandlersSource, /error\.code === 'EEXIST'/);
});
