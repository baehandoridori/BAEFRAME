const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8');
const timelineSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8');
const ffmpegManagerSource = fs.readFileSync(path.join(rootDir, 'main/ffmpeg-manager.js'), 'utf8');
const playlistCss = fs.readFileSync(path.join(rootDir, 'renderer/styles/playlist-panel.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('continuous runtime imports the shared helper module', () => {
  assert.match(appSource, /CONTINUOUS_STATUS[\s\S]+findNextPlayableIndex[\s\S]+createSkippedToastMessage[\s\S]+from '\.\/modules\/playlist-continuous-core\.js'/);
});

test('continuous metadata probes unloaded playlist items without saved duration', () => {
  const metadataMatch = appSource.match(/async function collectPlaylistMetadata\(items\) \{([\s\S]*?)\n  \}\n\n  async function updatePlaylistContinuousTimeline/);
  assert.ok(metadataMatch, 'collectPlaylistMetadata should exist');

  const metadataSource = metadataMatch[1];
  assert.match(metadataSource, /state\.currentFile === item\.videoPath && videoPlayer\.duration/);
  assert.match(metadataSource, /ffmpegProbeCodec\(item\.videoPath\)/);
  assert.match(metadataSource, /probe\.duration/);
  assert.match(metadataSource, /probe\.frameRate/);
  assert.match(metadataSource, /item\.duration = duration/);
  assert.match(metadataSource, /item\.fps = fps/);
});

test('status filter chip changes route through shared comment filter refresh', () => {
  const filterHandlerMatch = appSource.match(/document\.querySelectorAll\('\.filter-chip'\)\.forEach\(chip => \{([\s\S]*?)\n  \}\);/);
  assert.ok(filterHandlerMatch, 'filter chip handler should exist');

  const filterHandlerSource = filterHandlerMatch[1];
  assert.match(filterHandlerSource, /commentFilterState\.status = filter;/);
  assert.match(filterHandlerSource, /applyCommentFilters\(\);/);
  assert.doesNotMatch(filterHandlerSource, /updateCommentList\(filter\);/);
});

test('continuous timeline updates ignore stale async completions', () => {
  const timelineUpdateMatch = appSource.match(/async function updatePlaylistContinuousTimeline\(\) \{([\s\S]*?)\n  \}\n\n  async function quickCheckPlaylistForContinuous/);
  assert.ok(timelineUpdateMatch, 'updatePlaylistContinuousTimeline should exist');

  const timelineUpdateSource = timelineUpdateMatch[1];
  assert.match(appSource, /let playlistTimelineUpdateToken = 0;/);
  assert.match(timelineUpdateSource, /const updateToken = \+\+playlistTimelineUpdateToken;/);
  assert.match(timelineUpdateSource, /playlistTimelineUpdateToken !== updateToken/);
  assert.match(timelineUpdateSource, /const metadata = await collectPlaylistMetadata\(items\);[\s\S]+playlistTimelineUpdateToken !== updateToken/);
  assert.match(timelineUpdateSource, /const bframeData = await window\.electronAPI\.loadReview\(item\.bframePath\);[\s\S]+playlistTimelineUpdateToken !== updateToken/);
});

test('aggregate comment clicks stop when playlist item load fails', () => {
  const clickMatch = appSource.match(/const playlistCommentItem = e\.target\.closest\('\.playlist-comment-range'\);([\s\S]*?)\n\n      const item = e\.target\.closest\('\.comment-range-item'\);/);
  assert.ok(clickMatch, 'aggregate comment click path should exist');

  const clickSource = clickMatch[1];
  assert.match(clickSource, /const loaded = await loadVideoFromPlaylist\(item\);/);
  assert.match(clickSource, /if \(!loaded\) return;/);
  assert.ok(
    clickSource.indexOf('if (!loaded) return;') < clickSource.indexOf('videoPlayer.seekToFrame(localStartFrame);'),
    'load failure guard should run before seeking'
  );
});

test('aggregate comment range rendering keeps the comment track header in sync', () => {
  const renderMatch = timelineSource.match(/renderPlaylistCommentRanges\(ranges, totalDuration\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/);
  assert.ok(renderMatch, 'renderPlaylistCommentRanges should exist');

  const renderSource = renderMatch[1];
  assert.match(renderSource, /this\.commentLayerHeader/);
  assert.match(renderSource, /this\.commentLayerHeader\.style\.display = 'none';/);
  assert.match(renderSource, /this\.commentLayerHeader\.style\.display = 'flex';/);
});

test('continuous video loads preserve aggregate timeline comment ranges', () => {
  const helperMatch = appSource.match(/async function refreshCommentRangesForCurrentMode\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(helperMatch, 'current-mode comment range refresher should exist');

  const helperSource = helperMatch[1];
  assert.match(helperSource, /playlistUIState\.mode === 'continuous'/);
  assert.match(helperSource, /renderVideoCommentRanges\(\);/);
  assert.match(helperSource, /await updatePlaylistContinuousTimeline\(\);/);
  assert.match(helperSource, /renderCommentRanges\(\);/);

  const loadVideoCommentRefreshMatch = appSource.match(/renderHighlights\(\);\s*\n\s*\/\/ 댓글 범위 렌더링([\s\S]*?)\/\/ ====== 최근 파일 목록에 추가/);
  assert.ok(loadVideoCommentRefreshMatch, 'loadVideo should refresh comment ranges before recent files');
  assert.match(loadVideoCommentRefreshMatch[1], /await refreshCommentRangesForCurrentMode\(\);/);
  assert.doesNotMatch(loadVideoCommentRefreshMatch[1], /\n\s*renderCommentRanges\(\);/);
});

test('continuous state is initialized before startup file-open comment refresh paths', () => {
  const stateIndex = appSource.indexOf('const playlistUIState = {');
  const helperIndex = appSource.indexOf('async function refreshCommentRangesForCurrentMode()');
  const loadVideoIndex = appSource.indexOf('async function loadVideo(filePath, options = {})');
  const rendererReadyIndex = appSource.indexOf('window.electronAPI.notifyRendererReady?.();');

  assert.notEqual(stateIndex, -1, 'playlist UI state should exist');
  assert.notEqual(helperIndex, -1, 'comment refresh helper should exist');
  assert.notEqual(loadVideoIndex, -1, 'loadVideo should exist');
  assert.notEqual(rendererReadyIndex, -1, 'renderer ready notification should exist');
  assert.ok(stateIndex < helperIndex, 'playlist UI state must be initialized before comment refresh helper can run');
  assert.ok(stateIndex < loadVideoIndex, 'playlist UI state must be initialized before loadVideo can refresh comments');
  assert.ok(stateIndex < rendererReadyIndex, 'playlist UI state must be initialized before startup file-open events can arrive');
});

test('continuous selection does not auto-load before preparation finishes', () => {
  assert.match(appSource, /let suppressPlaylistSelectionLoad = false;/);
  assert.match(appSource, /function selectPlaylistItemForContinuous\(index\)/);
  assert.match(appSource, /if \(suppressPlaylistSelectionLoad\) \{[\s\S]+updatePlaylistCurrentItem\(\);[\s\S]+updatePlaylistPosition\(\);[\s\S]+return;/);
});

test('ended event routes active continuous playback before normal autoplay', () => {
  assert.match(appSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+playNextContinuousItem\(continuousPlaybackState\.sessionId\);[\s\S]+return;[\s\S]+if \(playlistManager\.isActive\(\) && playlistManager\.getAutoPlay\(\)/);
});

test('manual video loads cancel active continuous playback and stale loads', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoMatch, 'loadVideo should exist');

  const loadVideoSource = loadVideoMatch[1];
  assert.match(appSource, /let latestVideoLoadToken = 0;/);
  assert.match(loadVideoSource, /preserveContinuousSession = false/);
  assert.match(loadVideoSource, /const loadToken = \+\+latestVideoLoadToken;/);
  assert.match(loadVideoSource, /if \(!preserveContinuousSession && continuousPlaybackState\.active\) \{[\s\S]+stopContinuousPlayback\(\);[\s\S]+\}/);
  assert.match(loadVideoSource, /const isStaleVideoLoad = \(\) => loadToken !== latestVideoLoadToken;/);
  assert.match(loadVideoSource, /if \(isStaleVideoLoad\(\)\) return false;/);
});

test('continuous completion flushes skipped batch before stopping playback', () => {
  const completionBranchMatch = appSource.match(/if \(nextIndex < 0\) \{([\s\S]*?)\n    \}/);
  assert.ok(completionBranchMatch, 'completion branch should exist');

  const completionBranch = completionBranchMatch[1];
  assert.ok(
    completionBranch.indexOf('flushSkippedToastBatch();') < completionBranch.indexOf('stopContinuousPlayback();'),
    'skipped batch must flush before stopContinuousPlayback clears it'
  );
  assert.ok(
    completionBranch.indexOf('stopContinuousPlayback();') < completionBranch.indexOf("showToast('재생목록 재생 완료', 'success');"),
    'completion toast should be shown after playback is stopped'
  );
});

test('continuous async flows are guarded by a session id', () => {
  assert.match(appSource, /sessionId:\s*0/);
  assert.match(appSource, /continuousPlaybackState\.sessionId \+= 1;/);
  assert.match(appSource, /function isContinuousSessionActive\(sessionId\)/);
  assert.match(appSource, /async function quickCheckPlaylistForContinuous\(sessionId\)/);
  assert.match(appSource, /async function waitForPreparedOrSkip\(item, sessionId\)/);
  assert.match(appSource, /async function startContinuousPlayback\(\)[\s\S]+const sessionId = continuousPlaybackState\.sessionId;/);
  assert.match(appSource, /async function playNextContinuousItem\(sessionId\)/);
  assert.match(appSource, /if \(!isContinuousSessionActive\(sessionId\)\) return;/);
});

test('continuous preparation promises are scoped to the active session', () => {
  assert.match(appSource, /const existingPrepare = continuousPlaybackState\.preparePromises\.get\(item\.id\);/);
  assert.match(appSource, /existingPrepare\?\.sessionId === sessionId/);
  assert.match(appSource, /continuousPlaybackState\.preparePromises\.set\(item\.id, \{ sessionId, promise \}\);/);
  assert.match(appSource, /currentPrepare\?\.promise === promise/);
});

test('continuous preflight handles per-item fileExists failures', () => {
  const preflightMatch = appSource.match(/async function quickCheckPlaylistForContinuous\(sessionId\) \{([\s\S]*?)\n  \}/);
  assert.ok(preflightMatch, 'quick preflight function should exist');

  const preflightSource = preflightMatch[1];
  assert.match(preflightSource, /try \{/);
  assert.match(preflightSource, /catch \(error\) \{/);
  assert.match(preflightSource, /CONTINUOUS_STATUS\.ERROR/);
  assert.match(preflightSource, /continue;/);
});

test('continuous playback skips item when playlist load fails', () => {
  assert.match(appSource, /async function loadContinuousPlaylistItem\(item, sessionId\)/);
  assert.match(appSource, /const loaded = await loadVideoFromPlaylist\(item, \{ preserveContinuousSession: true \}\);/);
  assert.match(appSource, /markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.ERROR, '건너뜀'\);/);
  assert.match(appSource, /continuousPlaybackState\.skippedBatch\.push\(item\);/);
  assert.match(appSource, /const loaded = await loadContinuousPlaylistItem\(currentItem, sessionId\);[\s\S]+if \(!loaded\) \{[\s\S]+await playNextContinuousItem\(sessionId\);/);
  assert.match(appSource, /const loaded = await loadContinuousPlaylistItem\(nextItem, sessionId\);[\s\S]+if \(!loaded\) \{[\s\S]+await playNextContinuousItem\(sessionId\);/);
});

test('playlist loading returns the real loadVideo result', () => {
  const loadVideoFromPlaylistMatch = appSource.match(/async function loadVideoFromPlaylist\(item, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoFromPlaylistMatch, 'playlist loader should exist');

  const playlistLoaderSource = loadVideoFromPlaylistMatch[1];
  assert.match(playlistLoaderSource, /const loaded = await loadVideo\(item\.videoPath, options\);/);
  assert.match(playlistLoaderSource, /return loaded === true;/);
  assert.doesNotMatch(playlistLoaderSource, /await loadVideo\(item\.videoPath\);\s*return true;/);

  assert.match(appSource, /showToast\(`코덱 변환 실패: \$\{transcoded\.error \|\| '취소됨'\}`, 'error'\);\s*return false;/);
  assert.match(appSource, /showToast\('파일을 로드할 수 없습니다\.', 'error'\);\s*return false;/);
  assert.match(appSource, /trace\.end\(\{ filePath, hasExistingData \}\);\s*return true;/);
});

test('continuous timeline uses aggregate time for playback and seek', () => {
  assert.match(appSource, /mapGlobalTimeToSegment[\s\S]+mapLocalTimeToGlobal[\s\S]+from '\.\/modules\/playlist-continuous-core\.js'/);
  assert.match(appSource, /function getContinuousTimelinePlaybackTime\(localTime = videoPlayer\.currentTime\)/);
  assert.match(appSource, /mapLocalTimeToGlobal\(segment, localTime\)/);
  assert.match(appSource, /timeline\.setCurrentTime\(getContinuousTimelinePlaybackTime\(currentTime\)\);/);
  assert.match(appSource, /timeline\.setCurrentTime\(getContinuousTimelinePlaybackTime\(time\)\);/);
  assert.match(appSource, /async function seekContinuousTimeline\(globalTime\)/);
  assert.match(appSource, /mapGlobalTimeToSegment\(timeline\.playlistSegments, globalTime\)/);
  assert.match(appSource, /videoPlayer\.seek\(mapped\.localTime\);/);
});

test('playlist segment boundaries navigate through timeline seek', () => {
  const boundaryRenderMatch = timelineSource.match(/_renderPlaylistSegments\(\) \{([\s\S]*?)\n  \}\n\n  renderPlaylistCommentRanges/);
  assert.ok(boundaryRenderMatch, 'playlist segment renderer should exist');

  const boundaryRenderSource = boundaryRenderMatch[1];
  assert.match(boundaryRenderSource, /boundary\.addEventListener\('click', \(e\) => \{/);
  assert.match(boundaryRenderSource, /this\._emit\('seek', \{ time, itemId: segment\.itemId \}\);/);
});

test('normal transcode overlay follows joined pre-transcode progress', () => {
  const overlayMatch = appSource.match(/async function showTranscodeOverlay\(filePath, codecName\) \{([\s\S]*?)\n  \}/);
  assert.ok(overlayMatch, 'showTranscodeOverlay should exist');

  const overlaySource = overlayMatch[1];
  assert.match(overlaySource, /window\.electronAPI\.onTranscodeProgress\(progressHandler\);/);
  assert.match(overlaySource, /window\.electronAPI\.onPreTranscodeProgress\(progressHandler\);/);
  assert.match(overlaySource, /removeAllListeners\('ffmpeg:transcode-progress'\);[\s\S]+removeAllListeners\('ffmpeg:pre-transcode-progress'\);/);
});

test('playlist rows render and color continuous status text', () => {
  assert.match(appSource, /playlist-item-continuous-status/);
  assert.match(appSource, /el\.dataset\.continuousStatus = item\.continuousStatus;/);
  assert.match(playlistCss, /\.playlist-item-continuous-status/);
  assert.match(playlistCss, /\[data-continuous-status="preparing"\]/);
  assert.match(playlistCss, /\[data-continuous-status="ready"\]/);
  assert.match(playlistCss, /\[data-continuous-status="missing"\]/);
});

test('modified-date sort refreshes stats and preserves current selection without loading', () => {
  const refreshMatch = appSource.match(/async function refreshPlaylistModifiedTimes\(\) \{([\s\S]*?)\n  \}\n\n  function initPlaylistFeature/);
  assert.ok(refreshMatch, 'refreshPlaylistModifiedTimes should exist before playlist feature init');

  const refreshSource = refreshMatch[1];
  assert.match(refreshSource, /playlistManager\.getItems\(\)/);
  assert.match(refreshSource, /window\.electronAPI\.getFileStats\(item\.videoPath\)/);
  assert.match(refreshSource, /item\.modifiedAtMs = Number\(stats\?\.mtimeMs\) \|\| 0;/);
  assert.match(refreshSource, /catch \(error\) \{/);

  assert.match(appSource, /let playlistSortChangeToken = 0;/);
  const sortHandlerMatch = appSource.match(/elements\.playlistSortMode\?\.addEventListener\('change', async \(e\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(sortHandlerMatch, 'sort change handler should be async');

  const sortHandlerSource = sortHandlerMatch[1];
  assert.match(sortHandlerSource, /const sortMode = e\.target\.value;/);
  assert.match(sortHandlerSource, /const sortChangeToken = \+\+playlistSortChangeToken;/);
  assert.match(sortHandlerSource, /if \(sortMode === 'modifiedAt'\) \{[\s\S]+await refreshPlaylistModifiedTimes\(\);/);
  assert.match(sortHandlerSource, /playlistSortChangeToken !== sortChangeToken/);
  assert.match(sortHandlerSource, /elements\.playlistSortMode\?\.value !== sortMode/);
  assert.match(sortHandlerSource, /applyPlaylistSortPreservingSelection\(sortMode\);/);
});

test('manual playlist reorder updates order without selecting an item directly', () => {
  const start = appSource.indexOf('function initPlaylistDragReorder()');
  const end = appSource.indexOf('  // 리사이저', start);
  assert.notEqual(start, -1, 'drag reorder initializer should exist');
  assert.notEqual(end, -1, 'drag reorder initializer boundary should exist');

  const reorderSource = appSource.slice(start, end);
  assert.match(reorderSource, /playlistManager\.reorderItem\(draggedIndex, newIndex\);/);
  assert.doesNotMatch(reorderSource, /playlistManager\.selectItem\(/);
});

test('modified-date sort is refreshed after every playlist add path', () => {
  const applySortMatch = appSource.match(/function applyPlaylistSortPreservingSelection\(sortMode\) \{([\s\S]*?)\n  \}\n\n  async function refreshModifiedSortIfActive/);
  assert.ok(applySortMatch, 'selection-preserving sort helper should exist');
  const applySortSource = applySortMatch[1];
  assert.match(applySortSource, /const currentItemId = playlistManager\.getCurrentItem\(\)\?\.id \|\| null;/);
  assert.match(applySortSource, /playlistManager\.setSortMode\(sortMode\);/);
  assert.match(applySortSource, /suppressPlaylistSelectionLoad = true;[\s\S]+playlistManager\.selectItemById\(currentItemId\);[\s\S]+suppressPlaylistSelectionLoad = false;/);

  const refreshActiveMatch = appSource.match(/async function refreshModifiedSortIfActive\(\) \{([\s\S]*?)\n  \}\n\n  function initPlaylistFeature/);
  assert.ok(refreshActiveMatch, 'active modified-date sort refresh helper should exist');
  const refreshActiveSource = refreshActiveMatch[1];
  assert.match(refreshActiveSource, /const continuousSettings = playlistManager\.getContinuousSettings\(\);/);
  assert.match(refreshActiveSource, /continuousSettings\?\.sortMode !== 'modifiedAt'/);
  assert.match(refreshActiveSource, /continuousSettings\?\.manualOrder === true/);
  assert.ok(
    refreshActiveSource.indexOf('manualOrder') < refreshActiveSource.indexOf('await refreshPlaylistModifiedTimes();'),
    'manual order guard should run before refreshing and reapplying modified-date sort'
  );
  assert.match(refreshActiveSource, /await refreshPlaylistModifiedTimes\(\);/);
  assert.match(refreshActiveSource, /const nextContinuousSettings = playlistManager\.getContinuousSettings\(\);/);
  assert.match(refreshActiveSource, /nextContinuousSettings\?\.sortMode !== 'modifiedAt'/);
  assert.match(refreshActiveSource, /nextContinuousSettings\?\.manualOrder === true/);
  assert.ok(
    refreshActiveSource.indexOf('nextContinuousSettings?.manualOrder') > refreshActiveSource.indexOf('await refreshPlaylistModifiedTimes();') &&
      refreshActiveSource.indexOf('nextContinuousSettings?.manualOrder') < refreshActiveSource.indexOf("applyPlaylistSortPreservingSelection('modifiedAt');"),
    'manual order should be rechecked after stats refresh and before reapplying modified-date sort'
  );
  assert.match(refreshActiveSource, /applyPlaylistSortPreservingSelection\('modifiedAt'\);/);
  assert.match(refreshActiveSource, /updatePlaylistUI\(\);/);
  assert.match(refreshActiveSource, /updatePlaylistContinuousTimeline\(\);/);

  const addItemCalls = [...appSource.matchAll(/playlistManager\.addItems\(/g)].length;
  const refreshAfterAddCalls = [...appSource.matchAll(/await playlistManager\.addItems\([\s\S]*?\);\s*await refreshModifiedSortIfActive\(\);/g)].length;
  assert.equal(addItemCalls, 4, 'expected the four known playlist add paths');
  assert.equal(refreshAfterAddCalls, addItemCalls, 'each playlist add path should refresh modified-date sort when active');
});

test('opened modified-date playlists refresh filesystem mtimes before first selection', () => {
  assert.match(appSource, /playlistManager\.onPlaylistLoaded = async \(playlist\) => \{[\s\S]+await refreshModifiedSortIfActive\(\);[\s\S]+updatePlaylistUI\(\);/);
  assert.match(appSource, /await playlistManager\.open\(filePath\);[\s\S]+playlistManager\.selectItem\(0\);/);
});

test('playlist modifications rebuild the continuous aggregate timeline', () => {
  const modifiedMatch = appSource.match(/playlistManager\.onPlaylistModified = \(\) => \{([\s\S]*?)\n    \};/);
  assert.ok(modifiedMatch, 'playlist modified callback should exist');

  const modifiedSource = modifiedMatch[1];
  assert.match(modifiedSource, /updatePlaylistUI\(\);/);
  assert.match(modifiedSource, /updatePlaylistContinuousTimeline\(\);/);
  assert.ok(
    modifiedSource.indexOf('updatePlaylistUI();') < modifiedSource.indexOf('updatePlaylistContinuousTimeline();'),
    'continuous timeline should refresh after playlist UI updates'
  );
});

test('pre-transcode joins an existing pending transcode instead of marking it failed', () => {
  const preTranscodeMatch = ffmpegManagerSource.match(/async preTranscode\(filePath, onProgress = null\) \{([\s\S]*?)\n  \}/);
  assert.ok(preTranscodeMatch, 'preTranscode should exist');

  const preTranscodeSource = preTranscodeMatch[1];
  assert.match(preTranscodeSource, /if \(this\.pendingTranscodes\.has\(filePath\)\) \{[\s\S]+return this\.pendingTranscodes\.get\(filePath\);[\s\S]+\}/);
  assert.doesNotMatch(preTranscodeSource, /already-in-progress/);
});

test('playlist test script includes continuous runtime coverage', () => {
  assert.match(packageJson.scripts['test:playlist'], /playlist-continuous-runtime\.test\.js/);
});
