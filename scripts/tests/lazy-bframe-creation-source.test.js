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
const reviewFileStoreSource = normalizeNewlines(
  fs.readFileSync(path.join(rootDir, 'main/review-file-store.js'), 'utf8')
);
const commentSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/comment-sync.js'), 'utf8'));
const drawingSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-sync.js'), 'utf8'));

function extractNamedFunction(source, functionName) {
  const functionStart = source.indexOf(`function ${functionName}`);
  assert.ok(functionStart >= 0, `${functionName} should exist`);
  const signatureEnd = /\)\s*\{/.exec(source.slice(functionStart));
  const bodyStart = signatureEnd
    ? functionStart + signatureEnd.index + signatureEnd[0].lastIndexOf('{')
    : -1;
  assert.ok(bodyStart > functionStart, `${functionName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(functionStart, index + 1);
    }
  }
  assert.fail(`${functionName} body should be balanced`);
}

function loadNamedFunction(source, functionName) {
  const functionSource = extractNamedFunction(source, functionName);
  return Function(`"use strict"; return (${functionSource});`)();
}

test('missing .bframe loads enter deferred discovery instead of immediate collaboration save', () => {
  assert.match(appSource, /function startDeferredReviewFileDiscovery\(loadToken, bframePath\)/);
  assert.match(appSource, /async function stopDeferredReviewFileDiscovery\(bframePath = null\)/);
  assert.match(appSource, /async function handleDeferredReviewFileDiscovered\(bframePath, source = 'watch'\)/);
  assert.match(appSource, /function isCurrentReviewPath\(bframePath\) \{\s*return !!bframePath && isSameFilePath\(reviewDataManager\.currentBframePath, bframePath\);/);
  assert.match(appSource, /const synced = await syncReviewFileFromDisk\(bframePath, \{[\s\S]*bypassDebounce: true,/);
  assert.match(appSource, /replaceDeferredDiscovery: true,/);
  assert.match(appSource, /replaceDeferredDiscovery = false,/);
  assert.match(appSource, /if \(result\.success && startCollaborationIfNeeded && replaceDeferredDiscovery\) \{[\s\S]*await stopDeferredReviewFileDiscovery\(filePath\);[\s\S]*if \(result\.success && startCollaborationIfNeeded && !liveblocksManager\.isConnected\) \{[\s\S]*await startCollaborationForVideoLoad/);
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
  assert.match(appSource, /persistNewRoom = true,/);
  assert.match(appSource, /seedCurrentState = false/);
  assert.match(appSource, /if \(seedCurrentState\) \{[\s\S]*fabricDrawingSync\.broadcastCurrentState\?\.\(\);/);

  const newRoomBranch = appSource.match(/if \(isNewRoom && isCurrentReviewPath\(bframePath\)\) \{([\s\S]*?)\n      \}/);
  assert.ok(newRoomBranch, 'startCollaborationForVideoLoad should handle newly-created rooms explicitly');
  assert.match(newRoomBranch[1], /reviewDataManager\.setLiveblocksRoomId\(roomId\);/);
  assert.match(newRoomBranch[1], /if \(persistNewRoom\) \{/);
  assert.match(newRoomBranch[1], /await reviewDataManager\.save\(\{ skipMerge: true \}\);/);
});

test('all collaboration seeds exclude additive legacy snapshots while preserving causal Fabric seed', () => {
  const handlerStart = appSource.indexOf(
    "liveblocksManager.addEventListener('collaboratorsChanged'"
  );
  const handlerEnd = appSource.indexOf(
    "liveblocksManager.addEventListener('collaborationStarted'",
    handlerStart
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const collaboratorsChangedHandler = appSource.slice(handlerStart, handlerEnd);
  const lateSeedBlock = collaboratorsChangedHandler.match(
    /if \(currentOthersCount > _previousOthersCount &&[\s\S]*?\) \{([\s\S]*?)\n\s*\}/
  );
  assert.ok(lateSeedBlock, 'collaborator increase seed block should exist');
  assert.doesNotMatch(lateSeedBlock[1], /commentSync\.broadcastCurrentState\?\.\(\);/);
  assert.doesNotMatch(lateSeedBlock[1], /drawingSync\.broadcastCurrentState\?\.\(\);/);
  assert.match(lateSeedBlock[1], /fabricDrawingSync\.broadcastCurrentState\?\.\(\);/);

  const explicitSeedBlock = appSource.match(
    /if \(seedCurrentState\) \{([\s\S]*?)\n\s*\}/
  );
  assert.ok(explicitSeedBlock, 'explicit recovery seed block should exist');
  assert.doesNotMatch(explicitSeedBlock[1], /commentSync\.broadcastCurrentState\?\.\(\);/);
  assert.doesNotMatch(explicitSeedBlock[1], /drawingSync\.broadcastCurrentState\?\.\(\);/);
  assert.match(explicitSeedBlock[1], /fabricDrawingSync\.broadcastCurrentState\?\.\(\);/);

  const mergeSeedStart = appSource.indexOf('async function prepareReviewFileBeforeSave');
  const mergeSeedEnd = appSource.indexOf('async function prepareCompositionLayerMedia', mergeSeedStart);
  assert.ok(mergeSeedStart >= 0 && mergeSeedEnd > mergeSeedStart);
  const mergeSeedHandlers = appSource.slice(mergeSeedStart, mergeSeedEnd);
  assert.equal((mergeSeedHandlers.match(/seedCurrentState:\s*true/g) || []).length, 3);

  const quitHandlerStart = appSource.indexOf('window.electronAPI.onRequestSaveBeforeQuit');
  const quitHandlerEnd = appSource.indexOf('// ====== 사용자 이름 초기화', quitHandlerStart);
  assert.ok(quitHandlerStart >= 0 && quitHandlerEnd > quitHandlerStart);
  const quitHandler = appSource.slice(quitHandlerStart, quitHandlerEnd);
  assert.doesNotMatch(quitHandler, /seedCurrentState:\s*true/);
  assert.equal((quitHandler.match(/seedCurrentState:\s*false/g) || []).length, 2);
});

test('first .bframe save is protected against another user creating the file first', () => {
  assert.match(reviewDataManagerSource, /setBeforeSaveHandler\(handler\)/);
  assert.match(reviewDataManagerSource, /setInitialSaveConflictHandler\(handler\)/);
  assert.match(reviewDataManagerSource, /failIfExists: wasInitialPersist/);
  assert.match(reviewDataManagerSource, /saveResult\?\.exists === true/);
  assert.match(reviewDataManagerSource, /lastConflictResult = await this\._initialSaveConflictHandler\?\.\(\{/);
  assert.match(reviewDataManagerSource, /if \(lastConflictResult\?\.success === true\) \{[\s\S]*this\._hasPersistedFile = true;[\s\S]*\} else \{[\s\S]*this\._hasPersistedFile = false;/);
  assert.match(reviewDataManagerSource, /if \(!savedData\) \{[\s\S]*throw new Error\(lastConflictResult\?\.error/);
  assert.match(appSource, /const mergeResult = await reviewDataManager\.reloadAndMerge\(\{ merge: true, force: true, preserveLocal: true \}\);[\s\S]*if \(!mergeResult\.success\) \{[\s\S]*return mergeResult;/);
  assert.match(appSource, /persistNewRoom: false,\s*seedCurrentState: true/);
  assert.match(commentSyncSource, /broadcastCurrentState\(\) \{[\s\S]*type: 'COMMENT_MARKER_ADDED'/);
  assert.match(drawingSyncSource, /broadcastCurrentState\(\) \{[\s\S]*type: 'DRAWING_KEYFRAME_UPDATE'/);
  assert.match(reviewDataManagerSource, /function mergeReviewDataThreeWay\(baseData, localData, remoteData\)/);
  assert.match(
    reviewDataManagerSource,
    /constructor\(options = \{\}\) \{[\s\S]*?this\._reviewMergeBase = createEmptyReviewMergeBase\(\);/
  );
  assert.match(
    reviewDataManagerSource,
    /async setVideoFile\(videoPath, options = \{\}\) \{[\s\S]*?this\._reviewMergeBase = createEmptyReviewMergeBase\(\);/
  );
  assert.match(
    reviewDataManagerSource,
    /const loadedReviewMergeBase = captureReviewMergeBase\(migratedData\);[\s\S]*?this\._applyData\(migratedData\);[\s\S]*?this\._reviewMergeBase = captureAcceptedReviewMergeBase\([\s\S]*?loadedReviewMergeBase,[\s\S]*?this\._collectReviewDataForMerge\(loadedReviewMergeBase\)/
  );
  assert.match(
    reviewDataManagerSource,
    /const attemptReviewMergeBase = captureReviewMergeBase\(localData\);[\s\S]*?savedReviewMergeBase = attemptReviewMergeBase;/
  );
  assert.match(
    reviewDataManagerSource,
    /this\._reviewMergeBase = savedReviewMergeBase \|\|[\s\S]*?captureReviewMergeBase\(savedData\);/
  );
  assert.match(
    reviewDataManagerSource,
    /const mergedData = mergeReviewDataThreeWay\(\s*this\._reviewMergeBase,\s*localData,\s*remoteData\s*\);/
  );
  assert.match(
    reviewDataManagerSource,
    /const localReviewData = this\._collectReviewDataForMerge\(\);[\s\S]*?const mergedReviewData = mergeReviewDataThreeWay\(\s*this\._reviewMergeBase,[\s\S]*?remoteReviewData[\s\S]*?this\._reviewMergeBase = captureReviewMergeBase\(remoteReviewData\);/
  );
  assert.match(
    reviewDataManagerSource,
    /const overwrittenReviewMergeBase = captureReviewMergeBase\(remoteReviewData\);[\s\S]*?this\._reviewMergeBase = captureAcceptedReviewMergeBase\(\s*overwrittenReviewMergeBase/
  );

  assert.match(preloadSource, /saveReview: \(filePath, data, options = \{\}\) => ipcRenderer\.invoke\('file:save-review', filePath, data, options\)/);
  assert.match(ipcHandlersSource, /failIfExists/);
  assert.match(ipcHandlersSource, /saveReviewFile\(validatedPath,\s*data,/);
  assert.match(reviewFileStoreSource, /fileHandle = await fsPromises\.open\(filePath,\s*'wx'/);
  assert.match(reviewFileStoreSource, /if \(failIfExists\) \{[\s\S]*currentContent !== null[\s\S]*exists: true/);
  assert.match(reviewFileStoreSource, /commitWithRetry\(\{[\s\S]*failIfExists/);
  assert.match(reviewFileStoreSource, /expectedVersionToken:\s*baseContent === null[\s\S]*ABSENT_VERSION_TOKEN/);
});

test('metadata-only dirty state does not create a bframe file', () => {
  assert.match(reviewDataManagerSource, /hasSubstantiveContent\(\) \{/);
  assert.match(
    reviewDataManagerSource,
    /if \(!this\._hasPersistedFile && !this\.hasSubstantiveContent\(\)\) return false;/
  );
  assert.match(
    reviewDataManagerSource,
    /if \(!options\.skipSave && this\.hasUnsavedChanges\(\) && this\.currentBframePath\) \{/
  );
  assert.match(
    reviewDataManagerSource,
    /this\.autoSaveTimer = setTimeout\(async \(\) => \{\s*\n\s*if \(this\.hasUnsavedChanges\(\)\) \{/
  );
});

test('playlist aggregate direct save protects identity and uses a version token without touching future majors', () => {
  assert.match(
    appSource,
    /import \{ BFRAME_VERSION, getDataVersion, hasExplicitBframeVersion \} from '\.\.\/\.\.\/shared\/schema\.js';/
  );
  assert.match(
    appSource,
    /import \{[\s\S]*ensureReviewDocumentId,[\s\S]*getUnsupportedBframeMajor,[\s\S]*isValidReviewDocumentId[\s\S]*\} from '\.\.\/\.\.\/shared\/bframe-root-envelope\.js';/
  );

  const directSaveStart = appSource.indexOf(
    'async function togglePlaylistAggregateResolvedWithoutNavigation(range)'
  );
  const directSaveEnd = appSource.indexOf(
    'function renderPlaylistAggregateReplies(range, normalizedSearch)',
    directSaveStart
  );
  assert.ok(directSaveStart > -1 && directSaveEnd > directSaveStart);
  const directSaveSource = appSource.slice(directSaveStart, directSaveEnd);

  assert.match(
    directSaveSource,
    /const dataVersion = getDataVersion\(bframeData\);[\s\S]*getUnsupportedBframeMajor\([\s\S]*dataVersion,[\s\S]*BFRAME_VERSION,[\s\S]*!hasExplicitBframeVersion\(bframeData\)[\s\S]*\)/
  );
  assert.match(
    directSaveSource,
    /if \(unsupportedMajor !== null\) \{[\s\S]*throw new Error\([\s\S]*?\);[\s\S]*\}/
  );
  assert.match(
    directSaveSource,
    /ensureReviewDocumentId\(bframeData\);[\s\S]*if \(!isValidReviewDocumentId\(bframeData\.reviewDocumentId\)\) \{[\s\S]*throw new Error/
  );
  assert.match(
    directSaveSource,
    /window\.electronAPI\.loadReviewSnapshot\(bframePath\)/
  );
  assert.match(
    directSaveSource,
    /window\.electronAPI\.saveReview\([\s\S]*?bframePath,[\s\S]*?bframeData,[\s\S]*?\{[\s\S]*?expectedVersionToken(?:\s*:|\s*\})/
  );
  assert.match(
    directSaveSource,
    /if \(saved\?\.success !== true\) \{[\s\S]*?restoreMarkerResolution\(marker, previous\);[\s\S]*?saved\?\.conflict[\s\S]*?throw new Error/
  );
  assert.ok(
    directSaveSource.indexOf('ensureReviewDocumentId(bframeData);') <
      directSaveSource.indexOf('window.electronAPI.saveReview('),
    'review identity must be prepared before direct save'
  );
});

test('Fabric 드로잉(drawingsV3) 동기화가 배선되어 있다', () => {
  assert.match(appSource, /new FabricDrawingSync\(\{/);
  assert.match(appSource, /fabricDrawingSync\.broadcastCurrentState\?\.\(\);/);
  assert.match(appSource, /reloadDrawingsV3FromDisk/);
  assert.match(appSource, /_previousOthersCount = 0;\s*\n\s*_collaborationSessionStartedAt = Date\.now\(\);/);
  assert.match(appSource, /currentOthersCount > _previousOthersCount &&\s*\n\s*Date\.now\(\) - _collaborationSessionStartedAt > 10000/);
  const syncSource = fs.readFileSync(
    path.join(rootDir, 'renderer/scripts/modules/fabric-drawing-sync.js'), 'utf8'
  );
  assert.match(syncSource, /FABRIC_DRAWING_ROOT_CHUNK/);
  assert.match(syncSource, /applyExternalDrawingsV3/);
});

test('connected drawingsV3 file notifications keep one latest trailing reload', () => {
  const createLeadingTrailingThrottle = loadNamedFunction(
    appSource,
    'createLeadingTrailingThrottle'
  );
  let now = 10000;
  let currentPath = 'C:/reviews/a.bframe';
  const timers = [];
  const reloads = [];
  const throttle = createLeadingTrailingThrottle({
    intervalMs: 500,
    now: () => now,
    run: filePath => reloads.push(filePath),
    shouldRun: filePath => filePath === currentPath,
    setTimer: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => {
      const index = timers.indexOf(timer);
      if (index >= 0) timers.splice(index, 1);
    }
  });

  throttle.schedule('C:/reviews/a.bframe');
  assert.deepEqual(reloads, ['C:/reviews/a.bframe']);

  now = 10350;
  throttle.schedule('C:/reviews/a.bframe');
  throttle.schedule('C:/reviews/a.bframe');
  assert.equal(reloads.length, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 150);

  now = 10500;
  timers.shift().callback();
  assert.deepEqual(reloads, [
    'C:/reviews/a.bframe',
    'C:/reviews/a.bframe'
  ]);

  now = 10600;
  throttle.schedule('C:/reviews/a.bframe');
  assert.equal(timers.length, 1);
  currentPath = 'C:/reviews/b.bframe';
  now = 11000;
  timers.shift().callback();
  assert.equal(reloads.length, 2, 'a trailing reload for the previous file must be discarded');

  currentPath = 'C:/reviews/b.bframe';
  throttle.schedule('C:/reviews/b.bframe');
  assert.deepEqual(reloads.at(-1), 'C:/reviews/b.bframe');
  now = 11100;
  throttle.schedule('C:/reviews/b.bframe');
  assert.equal(timers.length, 1);
  now = 11600;
  throttle.schedule('C:/reviews/b.bframe');
  assert.equal(timers.length, 0, 'an overdue timer must be cleared by the new leading run');
  assert.equal(reloads.length, 4);

  assert.match(
    appSource,
    /if \(liveblocksManager\.isConnected\) \{[\s\S]*connectedDrawingsV3ReloadThrottle\.schedule\(filePath\);[\s\S]*return false;/
  );
});
