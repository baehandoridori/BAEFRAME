const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const playlistManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/playlist-manager.js'), 'utf8'));
const ffmpegManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/ffmpeg-manager.js'), 'utf8'));
const preloadSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'preload/preload.js'), 'utf8'));
const splitViewSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/split-view-manager.js'), 'utf8'));
const playlistCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/playlist-panel.css'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('continuous runtime imports the shared helper module', () => {
  assert.match(appSource, /CONTINUOUS_STATUS[\s\S]+findNextPlayableIndex[\s\S]+createSkippedToastMessage[\s\S]+from '\.\/modules\/playlist-continuous-core\.js'/);
});

test('continuous metadata skips FFmpeg probes for mpv pilot originals', () => {
  const metadataMatch = appSource.match(/async function collectPlaylistMetadata\(items\) \{([\s\S]*?)\n  \}\n\n  async function updatePlaylistContinuousTimeline/);
  assert.ok(metadataMatch, 'collectPlaylistMetadata should exist');

  const metadataSource = metadataMatch[1];
  assert.match(metadataSource, /state\.currentFile === item\.videoPath && videoPlayer\.duration/);
  assert.match(metadataSource, /const useMpvPilotForMetadata = !hasDuration && item\.videoPath[\s\S]+await shouldUseMpvPilot\(item\.videoPath/);
  assert.match(metadataSource, /if \(!hasDuration && item\.videoPath && useMpvPilotForMetadata\) \{[\s\S]+const mpvProbe = await window\.electronAPI\.mpvProbeMetadata\(item\.videoPath\);/);
  assert.match(metadataSource, /if \(!hasDuration && item\.videoPath && !useMpvPilotForMetadata\) \{/);
  assert.ok(
    metadataSource.indexOf('const useMpvPilotForMetadata') <
      metadataSource.indexOf('window.electronAPI.mpvProbeMetadata(item.videoPath)') &&
      metadataSource.indexOf('window.electronAPI.mpvProbeMetadata(item.videoPath)') <
      metadataSource.indexOf('ffmpegProbeCodec(item.videoPath)'),
    'mpv eligibility and mpv metadata probing should run before FFmpeg probing'
  );
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
  assert.match(timelineUpdateSource, /const bframePath = await playlistManager\.ensureItemBframePath\(item\);[\s\S]+const bframeData = await window\.electronAPI\.loadReview\(bframePath\);[\s\S]+playlistTimelineUpdateToken !== updateToken/);
});

test('opening or replacing playlists commits visible continuous work only after a file opens', () => {
  assert.match(appSource, /function resetPlaylistContinuousTimelineState\(\) \{/);
  assert.match(appSource, /function beginPlaylistReplacement\(\) \{/);
  assert.match(appSource, /function commitPlaylistReplacement\(\) \{/);

  const resetMatch = appSource.match(/function resetPlaylistContinuousTimelineState\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(resetMatch, 'continuous timeline reset helper should exist');
  const resetSource = resetMatch[1];
  assert.match(resetSource, /playlistTimelineUpdateToken \+= 1;/);
  assert.match(resetSource, /playlistAggregateCommentRanges = \[\];/);
  assert.match(resetSource, /timeline\.clearPlaylistTimeline\(\);/);
  assert.doesNotMatch(
    resetSource,
    /timeline\.clearCommentMarkers\(\);/,
    'continuous reset must not erase normal review markers when opening an empty playlist'
  );

  const openMatch = appSource.match(/async function openPlaylistFile\(filePath\) \{([\s\S]*?)\n  \}/);
  assert.ok(openMatch, 'openPlaylistFile should exist');
  const openSource = openMatch[1];

  const restoreMatch = appSource.match(/function restorePlaylistReplacementAfterFailedOpen\(replacementToken, previousState\) \{([\s\S]*?)\n  \}/);
  assert.ok(restoreMatch, 'playlist replacement restore helper should exist');
  const restoreSource = restoreMatch[1];
  assert.match(restoreSource, /playlistReplacementToken = previousState\.replacementToken;/);
  assert.doesNotMatch(restoreSource, /playlistTimelineUpdateToken|stopContinuousPlayback|setPlaylistContinuousTimelineBusy/);
  assert.match(openSource, /const previousReplacementState = \{[\s\S]+replacementToken: playlistReplacementToken[\s\S]+\};/);
  assert.match(openSource, /const replacementToken = beginPlaylistReplacement\(\);[\s\S]+openedPlaylist = await playlistManager\.open\(normalizedPath, \{[\s\S]+onCommitted: \(\) => \{[\s\S]+commitPlaylistReplacement\(\);[\s\S]+return true;[\s\S]+\}[\s\S]+\}\);/);
  assert.match(openSource, /catch \(error\) \{[\s\S]+restorePlaylistReplacementAfterFailedOpen\(replacementToken, previousReplacementState\);[\s\S]+throw error;/);
  assert.match(openSource, /if \(!openedPlaylist\) \{[\s\S]+restorePlaylistReplacementAfterFailedOpen\(replacementToken, previousReplacementState\);[\s\S]+return;/);
  assert.match(openSource, /replacementToken !== playlistReplacementToken[\s\S]+playlistReplacementCommitToken > replacementToken[\s\S]+return false;/);
  assert.match(openSource, /playlistReplacementCommitToken = replacementToken;/);
  assert.match(openSource, /playlistReplacementCommitToken !== replacementToken[\s\S]+playlistManager\.currentPlaylist !== openedPlaylist[\s\S]+return;/);
  assert.ok(
    openSource.indexOf('const replacementToken = beginPlaylistReplacement();') <
      openSource.indexOf('openedPlaylist = await playlistManager.open(normalizedPath, {'),
    'replacement attempts should be marked before opening the replacement file'
  );
  assert.ok(
    openSource.indexOf('onCommitted: () => {') <
      openSource.indexOf('commitPlaylistReplacement();'),
    'visible playback, timeline, and background work should change from the successful commit callback'
  );
  assert.ok(
    openSource.indexOf('playlistReplacementCommitToken !== replacementToken') <
      openSource.indexOf('showPlaylistSidebar();') &&
      openSource.indexOf('playlistManager.currentPlaylist !== openedPlaylist') <
        openSource.indexOf('playlistManager.selectItem(0);'),
    'post-open UI side effects should re-check that this open is still the committed playlist'
  );

  const replacementMatch = appSource.match(/function beginPlaylistReplacement\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(replacementMatch, 'beginPlaylistReplacement should exist');
  const replacementSource = replacementMatch[1];
  const commitMatch = appSource.match(/function commitPlaylistReplacement\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(commitMatch, 'commitPlaylistReplacement should exist');
  const commitSource = commitMatch[1];
  assert.match(appSource, /let playlistReplacementToken = 0;/);
  assert.match(appSource, /let playlistReplacementCommitToken = 0;/);
  assert.match(replacementSource, /playlistReplacementToken \+= 1;/);
  assert.doesNotMatch(replacementSource, /playlistSelectionLoadToken|playlistTimelineUpdateToken|stopContinuousPlayback|invalidatePlaylistBackgroundWork/);
  assert.match(commitSource, /playlistSelectionLoadToken \+= 1;/);
  assert.match(commitSource, /invalidateActiveVideoLoad\(\);/);
  assert.match(commitSource, /stopContinuousPlayback\(\);/);
  assert.match(commitSource, /invalidatePlaylistBackgroundWork\(\);/);
  assert.match(commitSource, /resetPlaylistContinuousTimelineState\(\);/);
  assert.match(replacementSource, /return playlistReplacementToken;/);
  assert.match(openSource, /if \(playlistUIState\.mode === 'continuous'\) \{[\s\S]+updatePlaylistContinuousTimeline\(\);[\s\S]+\}/);
});

test('playlist replacement invalidates background work without globally cancelling ffmpeg', () => {
  const commitMatch = appSource.match(/function commitPlaylistReplacement\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(commitMatch, 'commitPlaylistReplacement should exist');
  const commitSource = commitMatch[1];

  const invalidateMatch = appSource.match(/function invalidatePlaylistBackgroundWork\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(invalidateMatch, 'background invalidation helper should exist');
  const invalidateSource = invalidateMatch[1];

  const stopMatch = appSource.match(/function stopContinuousPlayback\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(stopMatch, 'stopContinuousPlayback should exist');
  const stopSource = stopMatch[1];

  assert.doesNotMatch(commitSource, /ffmpegCancel|cancelBackgroundTranscodes|cancelPlaylistBackgroundTranscodes/);
  assert.doesNotMatch(invalidateSource, /ffmpegCancel|cancelBackgroundTranscodes|cancelPlaylistBackgroundTranscodes/);
  assert.doesNotMatch(stopSource, /ffmpegCancel|cancelBackgroundTranscodes|cancelPlaylistBackgroundTranscodes/);
  assert.match(appSource, /window\.electronAPI\.ffmpegCancel\(\)/);
});

test('playlist replacement guard is independent from suppressed selection refreshes', () => {
  const openMatch = appSource.match(/async function openPlaylistFile\(filePath\) \{([\s\S]*?)\n  \}/);
  assert.ok(openMatch, 'openPlaylistFile should exist');
  const openSource = openMatch[1];

  assert.match(openSource, /const replacementToken = beginPlaylistReplacement\(\);/);
  assert.match(openSource, /replacementToken !== playlistReplacementToken/);
  assert.match(openSource, /playlistReplacementCommitToken > replacementToken/);
  assert.doesNotMatch(openSource, /replacementToken !== playlistSelectionLoadToken/);

  const applySortMatch = appSource.match(/function applyPlaylistSortPreservingSelection\(sortMode\) \{([\s\S]*?)\n  \}\n\n  async function refreshModifiedSortIfActive/);
  assert.ok(applySortMatch, 'selection-preserving sort helper should exist');
  assert.match(applySortMatch[1], /suppressPlaylistSelectionLoad = true;[\s\S]+playlistManager\.selectItemById\(currentItemId\);/);
});

test('continuous mode shows immediate timeline preparation feedback while metadata loads', () => {
  const timelineUpdateMatch = appSource.match(/async function updatePlaylistContinuousTimeline\(\) \{([\s\S]*?)\n  \}\n\n  async function quickCheckPlaylistForContinuous/);
  assert.ok(timelineUpdateMatch, 'updatePlaylistContinuousTimeline should exist');

  const timelineUpdateSource = timelineUpdateMatch[1];
  assert.match(appSource, /function setPlaylistContinuousTimelineBusy\(busy\) \{/);
  assert.ok(
    timelineUpdateSource.indexOf('setPlaylistContinuousTimelineBusy(true);') <
      timelineUpdateSource.indexOf('const metadata = await collectPlaylistMetadata(items);'),
    'busy feedback should be visible before slow metadata probing starts'
  );
  assert.match(timelineUpdateSource, /finally \{[\s\S]+setPlaylistContinuousTimelineBusy\(false\);/);
});

test('review mode exits through the shared continuous timeline reset helper', () => {
  const modeStart = appSource.indexOf('function setPlaylistMode(mode)');
  const modeEnd = appSource.indexOf('  async function refreshPlaylistModifiedTimes', modeStart);
  assert.notEqual(modeStart, -1, 'setPlaylistMode should exist');
  assert.notEqual(modeEnd, -1, 'setPlaylistMode boundary should exist');
  const modeSource = appSource.slice(modeStart, modeEnd);
  const reviewBranchIndex = modeSource.indexOf("nextMode === 'review'");
  const resetIndex = modeSource.indexOf('resetPlaylistContinuousTimelineState();', reviewBranchIndex);
  const renderIndex = modeSource.indexOf('renderCommentRanges();', reviewBranchIndex);

  assert.notEqual(resetIndex, -1, 'review mode should clear continuous state through the shared helper');
  assert.ok(resetIndex < renderIndex, 'continuous state should clear before normal comments render');
});

test('continuous aggregate comments recover missing bframePath from the media path', () => {
  const timelineUpdateMatch = appSource.match(/async function updatePlaylistContinuousTimeline\(\) \{([\s\S]*?)\n  \}\n\n  async function quickCheckPlaylistForContinuous/);
  assert.ok(timelineUpdateMatch, 'updatePlaylistContinuousTimeline should exist');

  const timelineUpdateSource = timelineUpdateMatch[1];
  assert.match(timelineUpdateSource, /const bframePath = await playlistManager\.ensureItemBframePath\(item\);/);
  assert.match(timelineUpdateSource, /if \(!bframePath\) continue;/);
  assert.match(timelineUpdateSource, /window\.electronAPI\.loadReview\(bframePath\)/);
  assert.doesNotMatch(timelineUpdateSource, /if \(!item\?\.bframePath\) continue;/);
});

test('aggregate comment clicks stop when playlist item load fails', () => {
  const clickMatch = appSource.match(/const playlistCommentItem = e\.target\.closest\('\.playlist-comment-range'\);([\s\S]*?)\n\n      const item = e\.target\.closest\('\.comment-range-item'\);/);
  assert.ok(clickMatch, 'aggregate comment click path should exist');

  const clickSource = clickMatch[1];
  assert.match(clickSource, /await openPlaylistAggregateComment\(playlistCommentItem\.dataset\.aggregateCommentKey\);/);

  const helperStart = appSource.indexOf('async function openPlaylistAggregateComment(key)');
  const helperEnd = appSource.indexOf('  function renderPlaylistContinuousCommentList', helperStart);
  assert.notEqual(helperStart, -1, 'aggregate comment open helper should exist');
  assert.notEqual(helperEnd, -1, 'aggregate comment open helper boundary should exist');
  const helperSource = appSource.slice(helperStart, helperEnd);

  assert.match(helperSource, /const loaded = await loadVideoFromPlaylist\(item, \{[\s\S]+preserveContinuousSession: continuousPlaybackState\.active[\s\S]+\}\);/);
  assert.match(helperSource, /if \(!loaded\) return;/);
  assert.ok(
    helperSource.indexOf('if (!loaded) return;') < helperSource.indexOf('videoPlayer.seekToFrame(range.localStartFrame || 0);'),
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

test('continuous timeline refresh clears stale comment bars before async metadata loads', () => {
  const timelineUpdateMatch = appSource.match(/async function updatePlaylistContinuousTimeline\(\) \{([\s\S]*?)\n  \}\n\n  async function quickCheckPlaylistForContinuous/);
  assert.ok(timelineUpdateMatch, 'updatePlaylistContinuousTimeline should exist');

  const timelineUpdateSource = timelineUpdateMatch[1];
  assert.match(timelineUpdateSource, /timeline\.clearCommentMarkers\(\);\s*\n\s*timeline\.renderPlaylistCommentRanges\(\[\], 0\);/);
  assert.ok(
    timelineUpdateSource.indexOf('timeline.renderPlaylistCommentRanges([], 0);') <
      timelineUpdateSource.indexOf('const metadata = await collectPlaylistMetadata(items);'),
    'stale single-video or previous playlist comment bars should clear before async metadata work'
  );
});

test('playlist timeline clear removes joined comments and cached aggregate ranges', () => {
  assert.match(timelineSource, /clearPlaylistCommentRanges\(\) \{/);
  assert.match(timelineSource, /clearPlaylistTimeline\(\) \{/);

  const clearCommentMatch = timelineSource.match(/clearPlaylistCommentRanges\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(clearCommentMatch, 'clearPlaylistCommentRanges should exist');
  const clearCommentSource = clearCommentMatch[1];
  assert.match(clearCommentSource, /this\._lastPlaylistCommentRanges = null;/);
  assert.match(clearCommentSource, /this\._lastPlaylistCommentDuration = 0;/);
  assert.match(clearCommentSource, /querySelectorAll\('\.playlist-comment-range'\)/);

  const setTimelineMatch = timelineSource.match(/setPlaylistTimeline\(segments, totalDuration\) \{([\s\S]*?)\n  \}/);
  assert.ok(setTimelineMatch, 'setPlaylistTimeline should exist');
  assert.match(setTimelineMatch[1], /if \(!this\.playlistSegments\.length \|\| !this\.playlistDuration\) \{[\s\S]+this\.clearPlaylistCommentRanges\(\);/);
});

test('continuous author filter menu uses aggregate playlist comments', () => {
  assert.match(appSource, /function getAuthorFilterSourceItems\(\) \{/);
  assert.match(appSource, /function getAuthorFilterAuthorIds\(\) \{/);

  const sourceMatch = appSource.match(/function getAuthorFilterSourceItems\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(sourceMatch, 'author filter source helper should exist');
  assert.match(sourceMatch[1], /if \(playlistUIState\.mode === 'continuous'\) \{[\s\S]+return playlistAggregateCommentRanges;/);

  const idsMatch = appSource.match(/function getAuthorFilterAuthorIds\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(idsMatch, 'author filter author id helper should exist');
  assert.match(idsMatch[1], /getAuthorFilterSourceItems\(\)/);

  const menuMatch = appSource.match(/function updateAuthorFilterMenu\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(menuMatch, 'updateAuthorFilterMenu should exist');
  assert.match(menuMatch[1], /const allMarkers = getAuthorFilterSourceItems\(\);/);

  const clickMatch = appSource.match(/document\.getElementById\('authorFilterMenu'\)\?\.addEventListener\('click', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(clickMatch, 'author filter click handler should exist');
  const clickSource = clickMatch[1];
  assert.match(clickSource, /const uniqueAuthors = getAuthorFilterAuthorIds\(\);/);
  assert.doesNotMatch(clickSource, /commentManager\.getAllMarkers\(\)/);
});

test('playlist aggregate comment keys are generated by the shared helper', () => {
  assert.match(appSource, /getPlaylistAggregateCommentKey[\s\S]+from '\.\/modules\/playlist-comment-index\.js'/);
  assert.match(timelineSource, /getPlaylistAggregateCommentKey[\s\S]+from '\.\/playlist-comment-index\.js'/);
  assert.match(timelineSource, /el\.dataset\.aggregateCommentKey = getPlaylistAggregateCommentKey\(range\);/);
  assert.doesNotMatch(appSource, /function getPlaylistAggregateCommentKey\(range\) \{[\s\S]*return `\$\{range\.itemId/);
});

test('continuous mode hides single-video vertical comment markers', () => {
  const markerStart = appSource.indexOf('function updateTimelineMarkers()');
  const markerEndMatch = appSource.slice(markerStart).match(/\r?\n  \/\*\*\r?\n   \* 댓글 목록 업데이트/);
  assert.notEqual(markerStart, -1, 'updateTimelineMarkers should exist');
  assert.ok(markerEndMatch, 'updateTimelineMarkers boundary should exist');
  const markerEnd = markerStart + markerEndMatch.index;
  const markerUpdateSource = appSource.slice(markerStart, markerEnd);
  assert.match(markerUpdateSource, /playlistUIState\.mode === 'continuous'/);
  assert.match(markerUpdateSource, /timeline\.clearCommentMarkers\(\);[\s\S]+return;/);
  assert.ok(
    markerUpdateSource.indexOf('timeline.clearCommentMarkers();') <
      markerUpdateSource.indexOf('timeline.renderClusteredCommentMarkers(allMarkerData);'),
    'continuous guard should run before single-video marker rendering'
  );

  const modeStart = appSource.indexOf('function setPlaylistMode(mode)');
  const modeEnd = appSource.indexOf('  async function refreshPlaylistModifiedTimes', modeStart);
  assert.notEqual(modeStart, -1, 'setPlaylistMode should exist');
  assert.notEqual(modeEnd, -1, 'setPlaylistMode boundary should exist');
  const modeSource = appSource.slice(modeStart, modeEnd);
  const continuousBranchIndex = modeSource.indexOf("nextMode === 'review'");
  const continuousClearIndex = modeSource.indexOf('timeline.clearCommentMarkers();', continuousBranchIndex);
  const continuousUpdateIndex = modeSource.indexOf('updatePlaylistContinuousTimeline();', continuousBranchIndex);
  assert.ok(continuousClearIndex !== -1, 'continuous mode should clear existing single-video markers');
  assert.ok(continuousClearIndex < continuousUpdateIndex, 'single-video markers should clear before aggregate timeline renders');
});

test('timeline wheel zoom anchors to the cursor position', () => {
  assert.match(timelineSource, /getTimelineFocalContentX[\s\S]+calculateAnchoredScrollLeft[\s\S]+from '\.\/timeline-zoom-core\.js'/);

  const wheelMatch = timelineSource.match(/this\.timelineTracks\?\.addEventListener\('wheel', \(e\) => \{([\s\S]*?)\n    \}, \{ passive: false \}\);/);
  assert.ok(wheelMatch, 'timeline wheel handler should exist');

  const wheelSource = wheelMatch[1];
  assert.match(wheelSource, /e\.clientX/);
  assert.match(wheelSource, /getTimelineFocalContentX\(/);
  assert.match(wheelSource, /this\.setZoomAtPosition\(newZoom, focalX\);/);
  assert.doesNotMatch(wheelSource, /newPlayheadX - viewportWidth \/ 2/);
});

test('timeline scrubbing keeps the dragged playhead from being overwritten by playback ticks', () => {
  const setCurrentTimeMatch = timelineSource.match(/setCurrentTime\(time\) \{([\s\S]*?)\n  \}/);
  assert.ok(setCurrentTimeMatch, 'setCurrentTime should exist');
  const setCurrentTimeSource = setCurrentTimeMatch[1];

  assert.match(setCurrentTimeSource, /this\.isDraggingPlayhead && this\.scrubTime !== undefined/);
  assert.ok(
    setCurrentTimeSource.indexOf('this.isDraggingPlayhead && this.scrubTime !== undefined') <
      setCurrentTimeSource.indexOf('this._updatePlayheadPosition();'),
    'playback-driven playhead updates should be skipped while the user is scrubbing'
  );
});

test('continuous aggregate comments update the right comment panel', () => {
  assert.match(appSource, /let playlistAggregateCommentRanges = \[\];/);
  assert.match(appSource, /function renderPlaylistContinuousCommentList\(filter = getActiveCommentFilter\(\)\)/);
  assert.match(appSource, /if \(playlistUIState\.mode === 'continuous'\) \{[\s\S]+renderPlaylistContinuousCommentList\(filter\);[\s\S]+return;/);
  assert.match(appSource, /playlistAggregateCommentRanges = aggregateRanges;/);
  assert.match(appSource, /formatPlaylistCommentPanelLine\(range\)/);
  assert.match(appSource, /data-aggregate-comment-key/);
  assert.match(appSource, /전체 \$\{highlightCommentSearchMatches\(range\.globalStartTimecode/);
  assert.match(appSource, /컷 \$\{highlightCommentSearchMatches\(range\.localStartTimecode/);
});

test('normal file open paths route bplaylist files into playlist open flow', () => {
  assert.match(appSource, /function isPlaylistFilePath\(filePath\)/);
  assert.match(appSource, /async function openSelectedPath\(filePath\)/);
  assert.match(appSource, /if \(isPlaylistFilePath\(filePath\)\) \{[\s\S]+return openPlaylistFile\(filePath\);[\s\S]+\}/);
  assert.match(appSource, /await openSelectedPath\(result\.filePaths\[0\]\);/);
  assert.match(appSource, /if \(isPlaylistFilePath\(file\.path \|\| file\.name\)\) \{[\s\S]+await openPlaylistFile\(file\.path\);/);
  assert.match(appSource, /window\.electronAPI\.onOpenPlaylist\?\.\(async \(path\) => \{[\s\S]+await openPlaylistFile\(path\);/);
});

test('open dialog exposes saved playlist files', () => {
  assert.match(fs.readFileSync(path.join(rootDir, 'main/ipc-handlers.js'), 'utf8'), /BAEFRAME 재생목록[\s\S]+bplaylist/);
});

test('continuous playback verifies that native playback actually advances', () => {
  assert.match(appSource, /function waitForContinuousPlaybackAdvance\(sessionId/);
  assert.match(appSource, /async function playContinuousItemWithWatchdog\(item, sessionId\)/);
  assert.match(appSource, /await videoPlayer\.play\(\)/);
  assert.match(appSource, /waitForContinuousPlaybackAdvance\(sessionId/);
  assert.match(appSource, /연속 재생이 멈춘 상태라 다시 시도합니다/);
  assert.match(appSource, /showToast\('영상을 재생할 수 없어 다음 영상으로 넘어갑니다\.', 'warning'\)/);
  assert.match(appSource, /const started = await playContinuousItemWithWatchdog\(currentItem, sessionId\);[\s\S]+if \(!started\) \{[\s\S]+await playNextContinuousItem\(sessionId\);/);
  assert.match(appSource, /const started = await playContinuousItemWithWatchdog\(nextItem, sessionId\);[\s\S]+if \(!started\) \{[\s\S]+await playNextContinuousItem\(sessionId\);/);
});

test('continuous playback watchdog uses VideoPlayer state for external engines', () => {
  const readyMatch = appSource.match(/function waitForContinuousMediaReady\(timeoutMs = 1200\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousPlaybackAdvance/);
  assert.ok(readyMatch, 'waitForContinuousMediaReady should exist');
  assert.match(readyMatch[1], /if \(videoPlayer\.engine !== 'html5'\) \{[\s\S]+return Promise\.resolve\(videoPlayer\.isLoaded === true\);/);

  const advanceMatch = appSource.match(/function waitForContinuousPlaybackAdvance\(sessionId, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function playContinuousItemWithWatchdog/);
  assert.ok(advanceMatch, 'waitForContinuousPlaybackAdvance should exist');
  const advanceSource = advanceMatch[1];
  assert.match(advanceSource, /const snapshot = getContinuousPlaybackSnapshot\(\);/);
  assert.match(advanceSource, /const startTime = snapshot\.currentTime;/);
  assert.match(advanceSource, /if \(hasContinuousPlaybackReachedMediaEnd\(snapshot\)\) return Promise\.resolve\(true\);/);
  assert.match(advanceSource, /const currentSnapshot = getContinuousPlaybackSnapshot\(\);/);
  assert.match(advanceSource, /return currentSnapshot\.currentTime - startTime >= minDelta;/);
  assert.match(advanceSource, /hasAdvanced\(\) \|\| hasContinuousPlaybackReachedMediaEnd\(currentSnapshot\)/);
  assert.doesNotMatch(advanceSource, /currentSnapshot\.paused && !videoPlayer\.isPlaying[\s\S]+finish\(true\)/);
  assert.doesNotMatch(advanceSource, /media\.currentTime \|\| videoPlayer\.currentTime/);
  assert.doesNotMatch(advanceSource, /media\.duration \|\| videoPlayer\.duration/);
});

test('continuous playback only advances on confirmed media end', () => {
  assert.match(appSource, /function hasContinuousPlaybackReachedMediaEnd\(snapshot = getContinuousPlaybackSnapshot\(\)\) \{/);
  assert.match(appSource, /const externalEofReached = videoPlayer\.externalEofReached === true;/);
  assert.match(appSource, /ended: externalEofReached \|\| \(duration > 0 && duration - currentTime <= 0\.25 && !videoPlayer\.isPlaying\),/);
  assert.match(appSource, /externalEofReached,/);
  assert.match(appSource, /const hasKnownDuration = snapshot\.duration > 0;/);
  assert.match(appSource, /const nearMediaEnd = hasKnownDuration && snapshot\.duration - snapshot\.currentTime <= 0\.25;/);
  assert.match(appSource, /if \(snapshot\.externalEofReached === true\) return !hasKnownDuration \|\| nearMediaEnd;/);
  assert.match(appSource, /return nearMediaEnd && snapshot\.ended === true;/);
  assert.doesNotMatch(appSource, /if \(snapshot\.externalEofReached === true\) return true;/);

  const endedListenerMatch = appSource.match(/videoPlayer\.addEventListener\('ended', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(endedListenerMatch, 'videoPlayer ended listener should exist');
  const endedListenerSource = endedListenerMatch[1];
  assert.match(endedListenerSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+if \(!hasContinuousPlaybackReachedMediaEnd\(\)\) \{[\s\S]+return;[\s\S]+playNextContinuousItem\(continuousPlaybackState\.sessionId\);/);

  const advanceMatch = appSource.match(/function waitForContinuousPlaybackAdvance\(sessionId, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  async function playContinuousItemWithWatchdog/);
  assert.ok(advanceMatch, 'waitForContinuousPlaybackAdvance should exist');
  const advanceSource = advanceMatch[1];
  assert.match(advanceSource, /const onEnded = \(\) => \{[\s\S]+if \(hasContinuousPlaybackReachedMediaEnd\(\)\) finish\(true\);[\s\S]+\};/);
  assert.doesNotMatch(advanceSource, /const onEnded = \(\) => finish\(true\);/);
});

test('continuous mode keeps timeline tools separate from autoplay control', () => {
  const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
  assert.match(indexSource, /id="playlistTabReview"[\s\S]*?>개별영상 모드<\/button>/);
  assert.match(indexSource, /id="playlistTabContinuous"[\s\S]*?>타임라인 이어붙이기 모드<\/button>/);
  assert.doesNotMatch(indexSource, /id="btnPlaylistContinuousPlay"/);
  assert.doesNotMatch(indexSource, /전체 자동재생/);
  assert.match(indexSource, /id="playlistAutoPlay"[\s\S]*?<span class="toggle-label">자동 재생<\/span>/);
  assert.doesNotMatch(appSource, /btnPlaylistContinuousPlay/);
});

test('prepared continuous items skip redundant preparation checks at cut boundaries', () => {
  assert.match(appSource, /if \(item\?\.continuousStatus === CONTINUOUS_STATUS\.READY\) \{[\s\S]+return true;[\s\S]+\}/);
  assert.match(appSource, /if \(item\.continuousStatus === CONTINUOUS_STATUS\.READY\) \{[\s\S]+return \{ ready: true, cached: true \};[\s\S]+\}/);
});

test('continuous playback starts next-item preparation before playback watchdog waits', () => {
  const startMatch = appSource.match(/async function startContinuousPlayback\(\) \{([\s\S]*?)\n  \}\n\n  async function playNextContinuousItem/);
  assert.ok(startMatch, 'startContinuousPlayback should exist');
  const startSource = startMatch[1];
  assert.ok(
    startSource.indexOf('prepareNextPlaylistItem(sessionId);') <
      startSource.indexOf('const started = await playContinuousItemWithWatchdog(currentItem, sessionId);'),
    'next item preparation should begin before playback watchdog waits'
  );

  const nextMatch = appSource.match(/async function playNextContinuousItem\(sessionId\) \{([\s\S]*?)\n  \}\n\n  function setPlaylistMode/);
  assert.ok(nextMatch, 'playNextContinuousItem should exist');
  const nextSource = nextMatch[1];
  assert.ok(
    nextSource.indexOf('prepareNextPlaylistItem(sessionId);') <
      nextSource.indexOf('const started = await playContinuousItemWithWatchdog(nextItem, sessionId);'),
    'following item preparation should begin before playback watchdog waits'
  );
});

test('continuous video loads preserve aggregate timeline comment ranges', () => {
  const helperMatch = appSource.match(/async function refreshCommentRangesForCurrentMode\([^)]*\) \{([\s\S]*?)\n  \}/);
  assert.ok(helperMatch, 'current-mode comment range refresher should exist');

  const helperSource = helperMatch[1];
  assert.match(helperSource, /playlistUIState\.mode === 'continuous'/);
  assert.match(helperSource, /renderVideoCommentRanges\(\);/);
  assert.match(helperSource, /await updatePlaylistContinuousTimeline\(\);/);
  assert.match(helperSource, /renderCommentRanges\(\);/);

  const loadVideoCommentRefreshMatch = appSource.match(/renderHighlights\(\);\s*\n\s*\/\/ 댓글 범위 렌더링([\s\S]*?)\/\/ ====== 최근 파일 목록에 추가/);
  assert.ok(loadVideoCommentRefreshMatch, 'loadVideo should refresh comment ranges before recent files');
  assert.match(loadVideoCommentRefreshMatch[1], /await refreshCommentRangesForCurrentMode\(/);
  assert.doesNotMatch(loadVideoCommentRefreshMatch[1], /\n\s*renderCommentRanges\(\);/);
});

test('continuous cut loads reuse the existing aggregate timeline instead of rebuilding it', () => {
  const helperMatch = appSource.match(/async function refreshCommentRangesForCurrentMode\(options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(helperMatch, 'current-mode comment range refresher should accept options');

  const helperSource = helperMatch[1];
  assert.match(helperSource, /skipContinuousTimelineRefresh = false/);
  assert.match(helperSource, /if \(skipContinuousTimelineRefresh && timeline\.playlistDuration > 0\) \{[\s\S]+renderPlaylistContinuousCommentList\(commentFilterState\.status\);[\s\S]+return;/);
  assert.match(helperSource, /await updatePlaylistContinuousTimeline\(\);/);

  const loadVideoCommentRefreshMatch = appSource.match(/renderHighlights\(\);\s*\n\s*\/\/ 댓글 범위 렌더링([\s\S]*?)\/\/ ====== 최근 파일 목록에 추가/);
  assert.ok(loadVideoCommentRefreshMatch, 'loadVideo should refresh comment ranges before recent files');
  assert.match(loadVideoCommentRefreshMatch[1], /await refreshCommentRangesForCurrentMode\(\{\s*skipContinuousTimelineRefresh: preserveContinuousSession\s*\}\);/);
});

test('continuous state is initialized before startup file-open comment refresh paths', () => {
  const stateIndex = appSource.indexOf('const playlistUIState = {');
  const helperIndex = appSource.indexOf('async function refreshCommentRangesForCurrentMode');
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
  assert.match(appSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+hasContinuousPlaybackReachedMediaEnd\(\)[\s\S]+playNextContinuousItem\(continuousPlaybackState\.sessionId\);[\s\S]+return;[\s\S]+if \(playlistManager\.isActive\(\) && userSettings\.getPlaylistAutoPlay\(\)/);
});

test('manual video loads cancel active continuous playback and stale loads', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoMatch, 'loadVideo should exist');

  const loadVideoSource = loadVideoMatch[1];
  assert.match(appSource, /let latestVideoLoadToken = 0;/);
  assert.match(appSource, /function invalidateActiveVideoLoad\(\) \{[\s\S]+latestVideoLoadToken \+= 1;[\s\S]+\}/);
  assert.match(appSource, /function invalidateActiveVideoLoad\(\) \{[\s\S]+supersedeActiveTranscodeOverlay\('재생목록 교체'\);[\s\S]+\}/);
  assert.match(loadVideoSource, /preserveContinuousSession = false/);
  assert.match(loadVideoSource, /const loadToken = \+\+latestVideoLoadToken;/);
  assert.match(loadVideoSource, /if \(!preserveContinuousSession && continuousPlaybackState\.active\) \{[\s\S]+stopContinuousPlayback\(\);[\s\S]+\}/);
  assert.match(loadVideoSource, /const isStaleVideoLoad = \(\) => loadToken !== latestVideoLoadToken;/);
  assert.match(loadVideoSource, /if \(isStaleVideoLoad\(\)\) return false;/);
});

test('rapid playlist item selections cannot let older pre-load checks win', () => {
  assert.match(appSource, /let playlistSelectionLoadToken = 0;/);

  const selectedMatch = appSource.match(/playlistManager\.onItemSelected = async \(item, index\) => \{([\s\S]*?)\n    \};/);
  assert.ok(selectedMatch, 'playlist item selected callback should exist');
  const selectedSource = selectedMatch[1];
  assert.match(selectedSource, /const selectionLoadToken = \+\+playlistSelectionLoadToken;/);
  assert.match(selectedSource, /const shouldContinuePlaylistSelectionLoad = \(\) => \([\s\S]+selectionLoadToken === playlistSelectionLoadToken[\s\S]+playlistManager\.getCurrentItem\(\)\?\.id === item\.id[\s\S]+\);/);
  assert.match(selectedSource, /loadVideoFromPlaylist\(item, \{[\s\S]+shouldContinue: shouldContinuePlaylistSelectionLoad[\s\S]+\}\);/);
  assert.match(selectedSource, /if \(!shouldContinuePlaylistSelectionLoad\(\)\) return;/);

  const playlistLoaderMatch = appSource.match(/async function loadVideoFromPlaylist\(item, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(playlistLoaderMatch, 'playlist loader should exist');
  const playlistLoaderSource = playlistLoaderMatch[1];
  assert.match(playlistLoaderSource, /shouldContinue = null/);
  assert.match(playlistLoaderSource, /const canContinuePlaylistLoad = \(\) => typeof shouldContinue !== 'function' \|\| shouldContinue\(\);/);
  assert.match(playlistLoaderSource, /if \(!canContinuePlaylistLoad\(\)\) return false;/);
  assert.ok(
    playlistLoaderSource.indexOf('if (!canContinuePlaylistLoad()) return false;') <
      playlistLoaderSource.indexOf('const loaded = await loadVideo(item.videoPath, loadOptions);'),
    'stale playlist selections must stop before loadVideo can claim the latest load token'
  );
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
  assert.match(appSource, /async function quickCheckPlaylistForContinuous\(sessionId, itemsToCheck = null\)/);
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
  const preflightMatch = appSource.match(/async function quickCheckPlaylistForContinuous\(sessionId, itemsToCheck = null\) \{([\s\S]*?)\n  \}/);
  assert.ok(preflightMatch, 'quick preflight function should exist');

  const preflightSource = preflightMatch[1];
  assert.match(preflightSource, /try \{/);
  assert.match(preflightSource, /catch \(error\) \{/);
  assert.match(preflightSource, /CONTINUOUS_STATUS\.ERROR/);
  assert.match(preflightSource, /continue;/);
});

test('continuous playback only checks the current item before first play', () => {
  const startMatch = appSource.match(/async function startContinuousPlayback\(\) \{([\s\S]*?)\n  \}\n\n  async function playNextContinuousItem/);
  assert.ok(startMatch, 'startContinuousPlayback should exist');
  const startSource = startMatch[1];

  assert.doesNotMatch(startSource, /const checked = await quickCheckPlaylistForContinuous\(sessionId\);/);
  assert.ok(
    startSource.indexOf('const currentItem = playlistManager.getCurrentItem() || selectPlaylistItemForContinuous(0);') <
      startSource.indexOf('const checked = await quickCheckPlaylistForContinuous(sessionId, [currentItem]);'),
    'current item should be selected before the preflight check'
  );
  assert.ok(
    startSource.indexOf('void quickCheckPlaylistForContinuous(') >
      startSource.indexOf('const checked = await quickCheckPlaylistForContinuous(sessionId, [currentItem]);'),
    'remaining playlist file checks should be moved to the background'
  );
});

test('continuous playback skips item when playlist load fails', () => {
  assert.match(appSource, /async function loadContinuousPlaylistItem\(item, sessionId\)/);
  assert.match(appSource, /const loaded = await loadVideoFromPlaylist\(item, \{[\s\S]+preserveContinuousSession: true,[\s\S]+preparedVideoPath[\s\S]+\}\);/);
  assert.match(appSource, /markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.ERROR, '건너뜀'\);/);
  assert.match(appSource, /continuousPlaybackState\.skippedBatch\.push\(item\);/);
  assert.match(appSource, /const loaded = await loadContinuousPlaylistItem\(currentItem, sessionId\);[\s\S]+if \(!loaded\) \{[\s\S]+await playNextContinuousItem\(sessionId\);/);
  assert.match(appSource, /const loaded = await loadContinuousPlaylistItem\(nextItem, sessionId\);[\s\S]+if \(!loaded\) \{[\s\S]+await playNextContinuousItem\(sessionId\);/);
});

test('continuous playlist loads hold the previous frame during source switches', () => {
  const loadVideoStart = appSource.indexOf('async function loadVideo(filePath, options = {})');
  const loadVideoEnd = appSource.indexOf('  async function generateThumbnails', loadVideoStart);
  assert.notEqual(loadVideoStart, -1, 'loadVideo should exist');
  assert.notEqual(loadVideoEnd, -1, 'loadVideo boundary should exist');
  const loadVideoSource = appSource.slice(loadVideoStart, loadVideoEnd);

  assert.match(loadVideoSource, /holdPreviousFrameUntilReady = false/);
  assert.match(loadVideoSource, /const shouldHoldVideoReveal = holdPreviousFrameUntilReady \|\| shouldDelayVideoReveal;/);
  assert.match(loadVideoSource, /captureVideoTransitionFreezeFrame\(\)/);
  assert.match(loadVideoSource, /await waitForVideoRenderable\(elements\.videoPlayer\)/);

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  const continuousLoadSource = continuousLoadMatch[1];

  assert.match(continuousLoadSource, /loadVideoFromPlaylist\(item, \{[\s\S]*preserveContinuousSession: true,[\s\S]*holdPreviousFrameUntilReady: true[\s\S]*\}\)/);
});

test('continuous playlist source switches defer collaboration startup off the transition path', () => {
  const loadVideoStart = appSource.indexOf('async function loadVideo(filePath, options = {})');
  const loadVideoEnd = appSource.indexOf('  async function generateThumbnails', loadVideoStart);
  assert.notEqual(loadVideoStart, -1, 'loadVideo should exist');
  assert.notEqual(loadVideoEnd, -1, 'loadVideo boundary should exist');
  const loadVideoSource = appSource.slice(loadVideoStart, loadVideoEnd);

  assert.match(appSource, /async function startCollaborationForVideoLoad\(loadToken, bframePath\)/);
  assert.match(appSource, /function scheduleDeferredCollaborationStart\(loadToken, bframePath\)/);
  assert.match(loadVideoSource, /deferCollaborationStart = false/);
  assert.match(loadVideoSource, /if \(deferCollaborationStart\) \{[\s\S]*scheduleDeferredCollaborationStart\(loadToken, currentBframePath\);[\s\S]*\} else \{[\s\S]*await startCollaborationForVideoLoad\(loadToken, currentBframePath\);/);

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  assert.match(continuousLoadMatch[1], /deferCollaborationStart: true/);
});

test('continuous playlist starts playback as soon as the next media is renderable', () => {
  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  const continuousLoadSource = continuousLoadMatch[1];

  assert.match(continuousLoadSource, /prepareNextPlaylistItem\(sessionId\);/);
  assert.match(continuousLoadSource, /loadVideoFromPlaylist\(item, \{[\s\S]*playWhenMediaReady: true[\s\S]*\}\)/);
  assert.ok(
    continuousLoadSource.indexOf('prepareNextPlaylistItem(sessionId);') <
      continuousLoadSource.indexOf('const loaded = await loadVideoFromPlaylist(item, {'),
    'following item preparation should start before the current source load waits on post-load work'
  );
});

test('continuous source switches suppress stale zero-time timeline updates', () => {
  assert.match(appSource, /loadingItemId:\s*null/);
  assert.match(appSource, /function shouldIgnoreContinuousTimelineUpdateDuringSourceLoad\(\)/);

  const timeupdateMatch = appSource.match(/videoPlayer\.addEventListener\('timeupdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(timeupdateMatch, 'timeupdate handler should exist');
  assert.match(timeupdateMatch[1], /if \(!shouldIgnoreContinuousTimelineUpdateDuringSourceLoad\(\)\) \{[\s\S]*timeline\.setCurrentTime/);

  const frameUpdateMatch = appSource.match(/videoPlayer\.addEventListener\('frameUpdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(frameUpdateMatch, 'frameUpdate handler should exist');
  assert.match(frameUpdateMatch[1], /if \(!shouldIgnoreContinuousTimelineUpdateDuringSourceLoad\(\)\) \{[\s\S]*timeline\.setCurrentTime/);

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  assert.match(continuousLoadMatch[1], /continuousPlaybackState\.loadingItemId = item\.id/);
  assert.match(continuousLoadMatch[1], /finally \{[\s\S]*continuousPlaybackState\.loadingItemId = null/);
});

test('continuous playback warms the next source with the hidden playlist preload video', () => {
  assert.match(appSource, /function preloadPlaylistMediaForItem\(item, options = \{\}\)/);

  const prepareNextMatch = appSource.match(/function prepareNextPlaylistItem\(sessionId\) \{([\s\S]*?)\n  \}\n\n  async function waitForPreparedOrSkip/);
  assert.ok(prepareNextMatch, 'prepareNextPlaylistItem should exist');
  const prepareNextSource = prepareNextMatch[1];

  assert.match(prepareNextSource, /preloadPlaylistMediaForItem\(items\[nextIndex\], \{[\s\S]*continuous: true,[\s\S]*sessionId[\s\S]*\}\);/);
  assert.ok(
    prepareNextSource.indexOf('preloadPlaylistMediaForItem(items[nextIndex]') <
      prepareNextSource.indexOf('preparePlaylistItemInBackground(items[nextIndex], sessionId);'),
    'hidden media preload should start before background preparation'
  );
});

test('continuous playback reuses prepared media paths at cut boundaries', () => {
  assert.match(appSource, /preparedMediaPaths:\s*new Map\(\)/);
  assert.match(appSource, /continuousPlaybackState\.preparedMediaPaths\.clear\(\);/);
  assert.match(appSource, /continuousPlaybackState\.preparedMediaPaths\.set\(item\.id, item\.videoPath\);/);
  assert.match(appSource, /continuousPlaybackState\.preparedMediaPaths\.set\(item\.id, cacheResult\.convertedPath\);/);
  assert.match(appSource, /continuousPlaybackState\.preparedMediaPaths\.set\(item\.id, result\.outputPath\);/);

  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];
  assert.match(loadVideoSource, /preparedVideoPath = null/);
  assert.match(loadVideoSource, /const hasPreparedVideoPath = typeof preparedVideoPath === 'string' && preparedVideoPath\.length > 0;/);
  assert.match(loadVideoSource, /let actualVideoPath = hasPreparedVideoPath \? preparedVideoPath : filePath;/);
  assert.match(loadVideoSource, /!hasPreparedVideoPath && !fileIsAudio && await window\.electronAPI\.ffmpegIsAvailable\(\)/);

  const continuousLoaderMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId\) \{([\s\S]*?)\n  \}/);
  assert.ok(continuousLoaderMatch, 'continuous playlist loader should exist');
  const continuousLoaderSource = continuousLoaderMatch[1];
  assert.match(continuousLoaderSource, /const preparedVideoPath = continuousPlaybackState\.preparedMediaPaths\.get\(item\.id\);/);
  assert.match(continuousLoaderSource, /preparedVideoPath/);
});

test('playlist loading returns the real loadVideo result', () => {
  const loadVideoFromPlaylistMatch = appSource.match(/async function loadVideoFromPlaylist\(item, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoFromPlaylistMatch, 'playlist loader should exist');

  const playlistLoaderSource = loadVideoFromPlaylistMatch[1];
  assert.match(playlistLoaderSource, /const \{ shouldContinue = null, \.\.\.loadOptions \} = options;/);
  assert.match(playlistLoaderSource, /const loaded = await loadVideo\(item\.videoPath, loadOptions\);/);
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
  assert.match(appSource, /function getActiveTimelinePlaybackTime\(currentTime = videoPlayer\.currentTime,\s*currentFrame = videoPlayer\.currentFrame\)/);
  assert.match(appSource, /playlistUIState\.mode === 'continuous'[\s\S]+return getContinuousTimelinePlaybackTime\(currentTime\);/);
  assert.match(appSource, /timeline\.setCurrentTime\(getActiveTimelinePlaybackTime\(currentTime,\s*currentFrame\)\);/);
  assert.match(appSource, /timeline\.setCurrentTime\(getActiveTimelinePlaybackTime\(time,\s*frame\)\);/);
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
  assert.match(overlaySource, /const unsubscribeTranscodeProgress = window\.electronAPI\.onTranscodeProgress\(progressHandler\);/);
  assert.match(overlaySource, /const unsubscribePreTranscodeProgress = window\.electronAPI\.onPreTranscodeProgress\(progressHandler\);/);
  assert.match(overlaySource, /unsubscribeTranscodeProgress\?\.\(\);[\s\S]+unsubscribePreTranscodeProgress\?\.\(\);/);
  assert.doesNotMatch(overlaySource, /removeAllListeners\('ffmpeg:transcode-progress'\)/);
});

test('transcode progress listeners unsubscribe individually instead of clearing shared channels', () => {
  assert.match(preloadSource, /onTranscodeProgress: \(callback\) => \{[\s\S]+const listener = \(event, data\) => callback\(data\);[\s\S]+ipcRenderer\.on\('ffmpeg:transcode-progress', listener\);[\s\S]+return \(\) => ipcRenderer\.removeListener\('ffmpeg:transcode-progress', listener\);/);
  assert.match(preloadSource, /onPreTranscodeProgress: \(callback\) => \{[\s\S]+const listener = \(event, data\) => callback\(data\);[\s\S]+ipcRenderer\.on\('ffmpeg:pre-transcode-progress', listener\);[\s\S]+return \(\) => ipcRenderer\.removeListener\('ffmpeg:pre-transcode-progress', listener\);/);

  const splitMatch = splitViewSource.match(/const progressHandler = \(data\) => \{[\s\S]*?try \{[\s\S]*?\} finally \{([\s\S]*?)\n\s*\}/);
  assert.ok(splitMatch, 'split view transcode progress cleanup should exist');
  assert.match(splitViewSource, /const unsubscribeTranscodeProgress = window\.electronAPI\.onTranscodeProgress\(progressHandler\);/);
  assert.match(splitMatch[1], /unsubscribeTranscodeProgress\?\.\(\);/);
  assert.doesNotMatch(splitMatch[1], /removeAllListeners/);
});

test('normal transcode overlay is superseded when users switch videos quickly', () => {
  assert.match(appSource, /let activeTranscodeOverlayToken = 0;/);
  assert.match(appSource, /function supersedeActiveTranscodeOverlay\(/);

  const overlayMatch = appSource.match(/async function showTranscodeOverlay\(filePath, codecName\) \{([\s\S]*?)\n  \}/);
  assert.ok(overlayMatch, 'showTranscodeOverlay should exist');
  const overlaySource = overlayMatch[1];
  assert.match(overlaySource, /const overlayToken = \+\+activeTranscodeOverlayToken;/);
  assert.match(overlaySource, /const isActiveTranscodeOverlay = \(\) => overlayToken === activeTranscodeOverlayToken;/);
  assert.match(overlaySource, /const progressHandler = \(data\) => \{[\s\S]+if \(!isActiveTranscodeOverlay\(\)\) return;/);
  assert.match(overlaySource, /if \(!isActiveTranscodeOverlay\(\)\) \{[\s\S]+return;[\s\S]+\}/);

  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  assert.match(appSource, /function invalidateActiveVideoLoad\(\) \{[\s\S]+supersedeActiveTranscodeOverlay\('재생목록 교체'\);[\s\S]+\}/);
  assert.match(loadVideoMatch[1], /supersedeActiveTranscodeOverlay\('새 영상 선택'\);/);
  assert.match(loadVideoMatch[1], /if \(transcoded\.stale\) return false;/);
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

  const refreshActiveMatch = appSource.match(/async function refreshModifiedSortIfActive\(options = \{\}\) \{([\s\S]*?)\n  \}\n\n  function initCutlistFeature/);
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
  assert.match(appSource, /playlistManager\.onPlaylistLoaded = async \(playlist, loadContext = \{\}\) => \{[\s\S]+await refreshModifiedSortIfActive\(\{ shouldContinue: loadContext\.shouldContinue \}\);[\s\S]+updatePlaylistUI\(\);/);
  assert.match(appSource, /async function openPlaylistFile\(filePath\) \{[\s\S]+await playlistManager\.open\(normalizedPath, \{[\s\S]+onCommitted:[\s\S]+\}\);[\s\S]+playlistManager\.selectItem\(0\);/);
});

test('opening playlists defers thumbnail validation until after the playlist is visible', () => {
  const openMatch = playlistManagerSource.match(/async open\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(openMatch, 'PlaylistManager.open should exist');

  const openSource = openMatch[1];
  assert.doesNotMatch(openSource, /await this\._validateThumbnails\(\);/);
  assert.match(openSource, /await this\.onPlaylistLoaded\?\.\(this\.currentPlaylist, loadContext\);/);
  assert.match(openSource, /this\._validateThumbnailsInBackground\(/);
  assert.ok(
    openSource.indexOf('await this.onPlaylistLoaded?.(this.currentPlaylist, loadContext);') <
      openSource.indexOf('this._validateThumbnailsInBackground('),
    'thumbnail repair should start only after the playlist load callback can render the list'
  );

  assert.match(playlistManagerSource, /async _validateThumbnails\(options = \{\}\) \{/);
  assert.match(playlistManagerSource, /async _validateThumbnailsInBackground\(playlist, playlistPath, token\) \{/);
});

test('stale playlist opens cannot publish older file state', () => {
  assert.match(playlistManagerSource, /this\.openOperationToken = 0;/);
  assert.match(playlistManagerSource, /this\.lastCommittedOpenToken = 0;/);
  assert.match(playlistManagerSource, /this\.thumbnailValidationToken = 0;/);

  const openMatch = playlistManagerSource.match(/async open\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(openMatch, 'PlaylistManager.open should exist');
  const openSource = openMatch[1];

  assert.doesNotMatch(openSource, /const previousOpenOperationToken = this\.openOperationToken;/);
  assert.doesNotMatch(openSource, /const previousThumbnailValidationToken = this\.thumbnailValidationToken;/);
  assert.doesNotMatch(openSource, /const previousPlaylist = this\.currentPlaylist;/);
  assert.doesNotMatch(openSource, /const previousPlaylistPath = this\.playlistPath;/);
  assert.match(openSource, /const openOperationToken = \+\+this\.openOperationToken;/);
  assert.match(openSource, /const thumbnailValidationToken = openOperationToken;/);
  assert.ok(
    openSource.indexOf('this.thumbnailValidationToken = thumbnailValidationToken;') >
      openSource.indexOf('this.lastCommittedOpenToken = openOperationToken;'),
    'new opens should activate thumbnail validation only after the replacement commits'
  );
  assert.match(openSource, /const shouldContinueOpen = \(\) => this\.lastCommittedOpenToken <= openOperationToken;/);
  assert.match(openSource, /this\.lastCommittedOpenToken = openOperationToken;/);
  assert.match(openSource, /this\.thumbnailValidationToken = thumbnailValidationToken;/);
  assert.doesNotMatch(openSource, /catch \(error\) \{[\s\S]+this\.thumbnailValidationToken = /);
  assert.doesNotMatch(openSource, /await this\.save\(/);
  assert.ok(
    openSource.indexOf('if (!shouldContinueOpen()) return null;') <
      openSource.indexOf('this.currentPlaylist = data;'),
    'stale file reads should be discarded before replacing the active playlist'
  );
  assert.match(openSource, /const repairedBframeCount = await this\._repairMissingBframePaths\(\{[\s\S]+playlist: data,[\s\S]+shouldContinue: shouldContinueOpen[\s\S]+\}\);/);
  assert.match(openSource, /await window\.electronAPI\.writePlaylist\(filePath, data\);/);
  assert.match(openSource, /const restorePreviousCommittedState = \(\) => \{[\s\S]+this\.currentPlaylist = previousCommittedState\.playlist;[\s\S]+this\.thumbnailValidationToken = previousCommittedState\.thumbnailValidationToken;/);
  assert.match(openSource, /const committed = await options\.onCommitted\?\.\(openedPlaylist, loadContext\);[\s\S]+if \(committed === false\) \{[\s\S]+restorePreviousCommittedState\(\);[\s\S]+return null;[\s\S]+\}/);
  assert.match(openSource, /if \(!shouldContinueOpen\(\) \|\| this\.currentPlaylist !== openedPlaylist\) return null;[\s\S]+const committed = await options\.onCommitted\?\.\(openedPlaylist, loadContext\);[\s\S]+await this\.onPlaylistLoaded\?\.\(this\.currentPlaylist, loadContext\);/);
  assert.match(playlistManagerSource, /async _repairMissingBframePaths\(options = \{\}\) \{/);
});

test('stale playlist load callbacks stop before app side effects', () => {
  const callbackMatch = appSource.match(/playlistManager\.onPlaylistLoaded = async \(playlist, loadContext = \{\}\) => \{([\s\S]*?)\n    \};/);
  assert.ok(callbackMatch, 'playlist load callback should accept a stale-load context');

  const callbackSource = callbackMatch[1];
  assert.match(callbackSource, /await refreshModifiedSortIfActive\(\{ shouldContinue: loadContext\.shouldContinue \}\);/);
  assert.ok(
    callbackSource.indexOf('await refreshModifiedSortIfActive({ shouldContinue: loadContext.shouldContinue });') <
      callbackSource.indexOf('if (loadContext.shouldContinue?.() === false) return;'),
    'callback should re-check stale status after modified-date refresh awaits'
  );
  assert.ok(
    callbackSource.indexOf('if (loadContext.shouldContinue?.() === false) return;') <
      callbackSource.indexOf('updatePlaylistUI();'),
    'stale playlist load callbacks must not update the visible playlist UI'
  );
  assert.ok(
    callbackSource.indexOf('if (loadContext.shouldContinue?.() === false) return;', callbackSource.indexOf('updatePlaylistUI();')) <
      callbackSource.indexOf('preTranscodePlaylistItems();'),
    'stale playlist load callbacks must not start background pre-transcode work'
  );

  const refreshMatch = appSource.match(/async function refreshModifiedSortIfActive\(options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(refreshMatch, 'refreshModifiedSortIfActive should accept stale-load options');
  const refreshSource = refreshMatch[1];
  assert.match(refreshSource, /const shouldContinue = typeof options\.shouldContinue === 'function'[\s\S]+: \(\) => true;/);
  assert.match(refreshSource, /await refreshPlaylistModifiedTimes\(\);[\s\S]+if \(!shouldContinue\(\)\) return false;/);
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

test('playlist background pre-transcode ignores stale playlist generations', () => {
  assert.match(appSource, /let playlistBackgroundWorkToken = 0;/);
  assert.match(appSource, /function invalidatePlaylistBackgroundWork\(\) \{/);

  const preTranscodeMatch = appSource.match(/async function preTranscodePlaylistItems\(\) \{([\s\S]*?)\n  \}\n\n  function toLocalMediaUrl/);
  assert.ok(preTranscodeMatch, 'preTranscodePlaylistItems should exist');

  const preTranscodeSource = preTranscodeMatch[1];
  assert.match(preTranscodeSource, /const backgroundToken = playlistBackgroundWorkToken;/);
  assert.match(preTranscodeSource, /const isCurrentBackgroundWork = \(\) => \(/);
  assert.match(preTranscodeSource, /if \(!isCurrentBackgroundWork\(\)\) return;/);
  assert.match(preTranscodeSource, /ffmpegPreTranscode\(item\.videoPath\)[\s\S]+if \(!isCurrentBackgroundWork\(\)\) return;/);
});

test('mpv pilot playlist preparation skips background transcode work', () => {
  const prepareMatch = appSource.match(/async function preparePlaylistItemInBackground\(item, sessionId = continuousPlaybackState\.sessionId\) \{([\s\S]*?)\n  \}\n\n  function prepareNextPlaylistItem/);
  assert.ok(prepareMatch, 'preparePlaylistItemInBackground should exist');

  const prepareSource = prepareMatch[1];
  assert.match(prepareSource, /const useMpvPilot = await shouldUseMpvPilot\(item\.videoPath, \{[\s\S]+fileIsAudio: isAudioFile\(item\.fileName \|\| item\.videoPath\),[\s\S]+hasPreparedVideoPath: false[\s\S]+\}\);/);
  assert.ok(
    prepareSource.indexOf('const useMpvPilot = await shouldUseMpvPilot') <
      prepareSource.indexOf('const ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();'),
    'mpv pilot eligibility should be checked before FFmpeg probing'
  );
  assert.match(prepareSource, /if \(useMpvPilot\) \{[\s\S]+continuousPlaybackState\.preparedMediaPaths\.delete\(item\.id\);[\s\S]+markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.READY, 'mpv 원본 준비'\);[\s\S]+return \{ ready: true, mpv: true \};[\s\S]+\}/);
  const mpvReadyBlock = prepareSource.match(/if \(useMpvPilot\) \{([\s\S]*?)\n        \}/);
  assert.ok(mpvReadyBlock, 'mpv ready block should exist');
  assert.doesNotMatch(mpvReadyBlock[1], /preparedMediaPaths\.set/);
  assert.ok(
    prepareSource.indexOf('if (useMpvPilot)') <
      prepareSource.indexOf('window.electronAPI.ffmpegPreTranscode(item.videoPath)'),
    'mpv-ready playlist items must return before background transcode starts'
  );
});

test('mpv pilot playlist pre-transcode scan skips ffmpeg background conversion', () => {
  const preTranscodeMatch = appSource.match(/async function preTranscodePlaylistItems\(\) \{([\s\S]*?)\n  \}\n\n  function toLocalMediaUrl/);
  assert.ok(preTranscodeMatch, 'preTranscodePlaylistItems should exist');

  const preTranscodeSource = preTranscodeMatch[1];
  assert.match(preTranscodeSource, /let ffmpegAvailable = null;/);
  assert.match(preTranscodeSource, /const useMpvPilot = await shouldUseMpvPilot\(item\.videoPath, \{[\s\S]+fileIsAudio: isAudioFile\(item\.fileName \|\| item\.videoPath\),[\s\S]+hasPreparedVideoPath: false[\s\S]+\}\);/);
  assert.ok(
    preTranscodeSource.indexOf('const useMpvPilot = await shouldUseMpvPilot') <
      preTranscodeSource.indexOf('ffmpegProbeCodec(item.videoPath)'),
    'mpv eligibility should be checked before codec probing in the pre-transcode scan'
  );
  assert.match(preTranscodeSource, /if \(useMpvPilot\) \{[\s\S]+log\.debug\('mpv 파일럿 사전 변환 건너뜀'[\s\S]+continue;[\s\S]+\}/);
  assert.ok(
    preTranscodeSource.indexOf('if (useMpvPilot)') <
      preTranscodeSource.indexOf('window.electronAPI.ffmpegPreTranscode(item.videoPath)'),
    'mpv-ready items must skip ffmpegPreTranscode'
  );
});

test('ffmpeg detection checks the main checkout when running from a git worktree', () => {
  assert.match(ffmpegManagerSource, /const appRoot = path\.join\(__dirname, '\.\.'\);/);
  assert.match(ffmpegManagerSource, /_getGitCommonWorktreeRoot\(appRoot\)/);
  assert.match(ffmpegManagerSource, /path\.join\(gitCommonRoot, 'ffmpeg', 'win32'\)/);
  assert.match(ffmpegManagerSource, /path\.join\(gitCommonRoot, 'ffmpeg'\)/);
  assert.match(ffmpegManagerSource, /readFileSync\(gitPath, 'utf8'\)/);
  assert.match(ffmpegManagerSource, /gitdir:/);
});

test('playlist test script includes continuous runtime coverage', () => {
  assert.match(packageJson.scripts['test:playlist'], /playlist-continuous-runtime\.test\.js/);
});
