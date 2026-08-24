const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const playlistManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/playlist-manager.js'), 'utf8'));
const playbackSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/playback-sync.js'), 'utf8'));
const ffmpegManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/ffmpeg-manager.js'), 'utf8'));
const preloadSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'preload/preload.js'), 'utf8'));
const splitViewSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/split-view-manager.js'), 'utf8'));
const playlistCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/playlist-panel.css'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

function extractAppFunctionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(appSource);
  assert.ok(match, `${name} should exist`);

  const functionStart = match.index;
  const bodyStart = appSource.indexOf(') {', functionStart) + 2;
  assert.ok(bodyStart > 1, `${name} should have a function body`);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(functionStart, index + 1);
  }
  assert.fail(`${name} should have a complete body`);
}

function extractOptionalAppFunctions(names) {
  return names
    .filter(name => new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).test(appSource))
    .map(extractAppFunctionSource)
    .join('\n');
}

function extractRemotePauseHandlerSource() {
  const match = appSource.match(
    /playbackSync\.addEventListener\('remotePause', (\(e\) => \{[\s\S]*?\n  \})\);/
  );
  assert.ok(match, 'remotePause handler should exist');
  return match[1];
}

function extractEndedHandlerSource() {
  const match = appSource.match(/videoPlayer\.addEventListener\('ended', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(match, 'videoPlayer ended handler should exist');
  return match[1];
}

function loadPlaylistVideoPathIndexHelper() {
  const helperNames = [
    'normalizeComparableFilePath',
    'isSameFilePath',
    'findPlaylistItemIndexByVideoPath'
  ];
  const helperSources = helperNames.map((name) => {
    const functionStart = appSource.indexOf(`function ${name}(`);
    assert.notEqual(functionStart, -1, `${name} should exist`);

    const bodyStart = appSource.indexOf(') {', functionStart) + 2;
    let depth = 0;
    for (let index = bodyStart; index < appSource.length; index += 1) {
      if (appSource[index] === '{') depth += 1;
      if (appSource[index] === '}') depth -= 1;
      if (depth === 0) return appSource.slice(functionStart, index + 1);
    }
    assert.fail(`${name} should have a complete body`);
  });

  return new Function(`${helperSources.join('\n')}\nreturn findPlaylistItemIndexByVideoPath;`)();
}

test('continuous runtime imports the shared helper module', () => {
  assert.match(appSource, /CONTINUOUS_STATUS[\s\S]+findNextPlayableIndex[\s\S]+createSkippedToastMessage[\s\S]+from '\.\/modules\/playlist-continuous-core\.js'/);
});

test('continuous metadata keeps mpv pilot originals off FFmpeg probing', () => {
  const metadataMatch = appSource.match(/async function collectPlaylistMetadata\(items\) \{([\s\S]*?)\n  \}\n\n  async function updatePlaylistContinuousTimeline/);
  assert.ok(metadataMatch, 'collectPlaylistMetadata should exist');

  const metadataSource = metadataMatch[1];
  assert.match(metadataSource, /isSameFilePath\(state\.currentFile, item\.videoPath\) && videoPlayer\.duration/);
  assert.match(metadataSource, /const useMpvPilotForMetadata = !hasDuration && item\.videoPath[\s\S]+await shouldUseMpvPilot\(item\.videoPath/);
  assert.match(metadataSource, /if \(!hasDuration && item\.videoPath && useMpvPilotForMetadata\) \{[\s\S]+const mpvProbe = await window\.electronAPI\.mpvProbeMetadata\(item\.videoPath\);/);
  assert.match(metadataSource, /mpv 타임라인 메타데이터 수집 실패: FFmpeg 없이 건너뜀/);
  assert.match(metadataSource, /if \(!hasDuration && item\.videoPath && !useMpvPilotForMetadata\) \{/);
  assert.ok(
    metadataSource.indexOf('const useMpvPilotForMetadata') <
      metadataSource.indexOf('window.electronAPI.mpvProbeMetadata(item.videoPath)') &&
      metadataSource.indexOf('window.electronAPI.mpvProbeMetadata(item.videoPath)') <
      metadataSource.indexOf('ffmpegProbeCodec(item.videoPath)'),
    'mpv eligibility and mpv metadata probing should run before FFmpeg probing'
  );
  assert.doesNotMatch(metadataSource, /!metadataResolvedByMpv/);
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

  assert.match(helperSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+stopContinuousPlayback\(\);[\s\S]+\}/);
  assert.match(helperSource, /const isCurrentNavigation = \(\) => \([\s\S]+navigationToken === playlistContinuousNavigationToken[\s\S]+\);/);
  assert.match(helperSource, /const loaded = await loadVideoFromPlaylist\(item, \{[\s\S]+preserveContinuousSession: true[\s\S]+initialFrame: range\.localStartFrame \|\| 0[\s\S]+revealAfterInitialSeek: true[\s\S]+holdPreviousFrameUntilReady: true[\s\S]+shouldContinue: isCurrentNavigation[\s\S]+\}\);/);
  assert.match(helperSource, /if \(!loaded\) return;/);
  assert.ok(
    helperSource.indexOf('if (!loaded) return;') < helperSource.indexOf('videoPlayer.seekToFrame(range.localStartFrame || 0);'),
    'load failure guard should run before seeking'
  );
});

test('aggregate comment clicks cancel stale continuous navigation and hide first-frame flashes', () => {
  const helperStart = appSource.indexOf('async function openPlaylistAggregateComment(key)');
  const helperEnd = appSource.indexOf('  async function submitPlaylistAggregateReply', helperStart);
  assert.notEqual(helperStart, -1, 'aggregate comment open helper should exist');
  assert.notEqual(helperEnd, -1, 'aggregate comment open helper boundary should exist');
  const helperSource = appSource.slice(helperStart, helperEnd);

  assert.match(appSource, /let playlistContinuousNavigationToken = 0;/);
  assert.match(appSource, /let activeVideoLoadPath = null;/);
  assert.match(appSource, /function hasActiveVideoLoadForDifferentFile\(filePath\) \{[\s\S]+!isSameFilePath\(activeVideoLoadPath, filePath\);[\s\S]+\}/);
  assert.match(helperSource, /const navigationToken = \+\+playlistContinuousNavigationToken;/);
  assert.match(helperSource, /const isCurrentNavigation = \(\) =>[\s\S]+navigationToken === playlistContinuousNavigationToken/);
  assert.match(helperSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+stopContinuousPlayback\(\);[\s\S]+\}/);
  assert.match(helperSource, /const isAlreadyLoaded = isSameFilePath\(state\.currentFile, item\.videoPath\) &&[\s\S]+!hasActiveVideoLoadForDifferentFile\(item\.videoPath\);/);
  assert.match(helperSource, /initialFrame: range\.localStartFrame \|\| 0/);
  assert.match(helperSource, /revealAfterInitialSeek: true/);
  assert.match(helperSource, /holdPreviousFrameUntilReady: true/);
  assert.match(helperSource, /preserveContinuousSession: true/);
  assert.match(helperSource, /shouldContinue: isCurrentNavigation/);
  assert.match(helperSource, /if \(!isCurrentNavigation\(\)\) return false;/);
  assert.ok(
    helperSource.indexOf('if (!isCurrentNavigation()) return false;') <
      helperSource.indexOf('videoPlayer.seekToFrame(range.localStartFrame || 0);'),
    'stale aggregate comment navigation must stop before the final seek/pause'
  );
});

test('manual continuous timeline seeks restart active sessions and preserve the target frame', () => {
  assert.match(appSource, /function restartContinuousPlaybackSessionForManualSeek\(\) \{/);

  const seekStart = appSource.indexOf('async function seekContinuousTimeline(globalTime, options = {})');
  const seekEnd = appSource.indexOf('  function stopContinuousPlayback', seekStart);
  assert.notEqual(seekStart, -1, 'seekContinuousTimeline should exist');
  assert.notEqual(seekEnd, -1, 'seekContinuousTimeline boundary should exist');
  const seekSource = appSource.slice(seekStart, seekEnd);

  assert.match(seekSource, /const navigationToken = \+\+playlistContinuousNavigationToken;/);
  assert.match(seekSource, /const wasContinuousActive = continuousPlaybackState\.active === true;/);
  assert.match(seekSource, /const shouldResumePlayback = resumePlayback && \(videoPlayer\.isPlaying === true \|\| wasContinuousActive\);/);
  assert.match(seekSource, /const manualSessionId = wasContinuousActive[\s\S]+restartContinuousPlaybackSessionForManualSeek\(\)/);
  assert.match(seekSource, /const isAlreadyLoaded = canReuseCurrentMedia && isSameFilePath\(state\.currentFile, item\.videoPath\) &&[\s\S]+!hasActiveVideoLoadForDifferentFile\(item\.videoPath\);/);
  assert.match(seekSource, /preserveContinuousSession: true/);
  assert.match(seekSource, /initialFrame: targetFrame/);
  assert.match(seekSource, /revealAfterInitialSeek: true/);
  assert.match(seekSource, /holdPreviousFrameUntilReady: true/);
  assert.match(seekSource, /shouldContinue: isCurrentNavigation/);
  assert.match(seekSource, /if \(!isCurrentNavigation\(\)\) return false;/);
  assert.match(seekSource, /if \(shouldResumePlayback\) \{[\s\S]+await playVideoAfterMediaLoad\(\{[\s\S]+silent: true/);
  assert.ok(
    seekSource.indexOf('if (!isCurrentNavigation()) return false;') <
      seekSource.indexOf('videoPlayer.seek(mapped.localTime);'),
    'stale manual timeline seeks must not move the player after a newer navigation'
  );
});

test('manual continuous timeline seeks suppress zero-time updates while cross-file loads settle', () => {
  const seekStart = appSource.indexOf('async function seekContinuousTimeline(globalTime, options = {})');
  const seekEnd = appSource.indexOf('  function resetContinuousPlaybackRuntimeState', seekStart);
  assert.notEqual(seekStart, -1, 'seekContinuousTimeline should exist');
  assert.notEqual(seekEnd, -1, 'seekContinuousTimeline boundary should exist');
  const seekSource = appSource.slice(seekStart, seekEnd);

  assert.match(seekSource, /const previousLoadingItemId = continuousPlaybackState\.loadingItemId;/);
  assert.match(seekSource, /const previousLoadingSessionId = continuousPlaybackState\.loadingSessionId;/);
  assert.match(seekSource, /continuousPlaybackState\.loadingItemId = item\.id;/);
  assert.match(seekSource, /continuousPlaybackState\.loadingSessionId = manualSessionId;/);
  assert.match(seekSource, /const loaded = await loadVideoFromPlaylist\(item, \{[\s\S]+holdPreviousFrameUntilReady: true[\s\S]+\}\);/);
  assert.ok(
    seekSource.indexOf('continuousPlaybackState.loadingItemId = item.id;') <
      seekSource.indexOf('const loaded = await loadVideoFromPlaylist(item, {'),
    'manual seek should mark the loading item before the async cross-file load starts'
  );
  assert.ok(
    seekSource.indexOf('timeline.setCurrentTime(mapLocalTimeToGlobal(mapped.segment, mapped.localTime));') <
      seekSource.indexOf('continuousPlaybackState.loadingItemId = previousLoadingItemId;'),
    'manual seek should keep zero-time suppression active until the target global playhead is restored'
  );
  assert.match(seekSource, /continuousPlaybackState\.loadingItemId === item\.id &&[\s\S]+continuousPlaybackState\.loadingSessionId === manualSessionId/);
  assert.match(seekSource, /continuousPlaybackState\.loadingSessionId = previousLoadingSessionId;/);
});

test('continuous timeline maps current files with normalized Windows paths', () => {
  const segmentStart = appSource.indexOf('function getCurrentContinuousSegment()');
  const segmentEnd = appSource.indexOf('  function shouldIgnoreContinuousTimelineUpdateDuringSourceLoad', segmentStart);
  assert.notEqual(segmentStart, -1, 'getCurrentContinuousSegment should exist');
  assert.notEqual(segmentEnd, -1, 'getCurrentContinuousSegment boundary should exist');
  const segmentSource = appSource.slice(segmentStart, segmentEnd);

  assert.match(segmentSource, /isSameFilePath\(currentItem\?\.videoPath, state\.currentFile\)/);
  assert.match(segmentSource, /items\.find\(item => isSameFilePath\(item\.videoPath, state\.currentFile\)\)/);
  assert.doesNotMatch(segmentSource, /currentItem\?\.videoPath === state\.currentFile/);
  assert.doesNotMatch(segmentSource, /item\.videoPath === state\.currentFile/);

  const metadataMatch = appSource.match(/async function collectPlaylistMetadata\(items\) \{([\s\S]*?)\n  \}\n\n  async function updatePlaylistContinuousTimeline/);
  assert.ok(metadataMatch, 'collectPlaylistMetadata should exist');
  assert.match(metadataMatch[1], /isSameFilePath\(state\.currentFile, item\.videoPath\) && videoPlayer\.duration/);
  assert.doesNotMatch(metadataMatch[1], /state\.currentFile === item\.videoPath/);
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
  assert.match(appSource, /playlist-comment-resolve-toggle/);
  assert.match(appSource, /playlist-comment-replies/);
});

test('continuous preparation summary distinguishes mpv-ready originals', () => {
  const summaryMatch = appSource.match(/function updatePlaylistPrepareSummary\(\) \{([\s\S]*?)\n  \}\n\n  function setPlaylistContinuousTimelineBusy/);
  assert.ok(summaryMatch, 'updatePlaylistPrepareSummary should exist');

  const summarySource = summaryMatch[1];
  assert.match(summarySource, /const mpvReadyCount = items\.filter/);
  assert.match(summarySource, /개 바로 재생 가능/);
  assert.match(summarySource, /mpv 원본 \$\{mpvReadyCount\}개/);
  assert.doesNotMatch(summarySource, /개 준비됨/);
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
  assert.match(appSource, /let started = videoPlayer\.isPlaying === true;/);
  assert.match(appSource, /if \(!started\) \{[\s\S]+started = await videoPlayer\.play\(\);[\s\S]+\}/);
  assert.match(appSource, /waitForContinuousPlaybackAdvance\(sessionId/);
  assert.match(appSource, /연속 재생이 멈춘 상태라 다시 시도합니다/);
  assert.match(appSource, /showToast\('영상을 재생할 수 없어 다음 영상으로 넘어갑니다\.', 'warning'\)/);
  assert.match(appSource, /const started = await playContinuousItemWithWatchdog\(currentItem, sessionId\);[\s\S]+if \(!started\) \{[\s\S]+await playNextContinuousItem\(sessionId, \{ inFlight: true \}\);/);
  assert.match(appSource, /const started = await playContinuousItemWithWatchdog\(nextItem, sessionId\);[\s\S]+if \(!started\) \{[\s\S]+await playNextContinuousItem\(sessionId, \{ inFlight: true \}\);/);

  const watchdogMatch = appSource.match(/async function playContinuousItemWithWatchdog\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  async function startContinuousPlayback/);
  assert.ok(watchdogMatch, 'playContinuousItemWithWatchdog should exist');
  assert.match(watchdogMatch[1], /if \(videoPlayer\.isPlaying === true\) \{[\s\S]+videoPlayer\.pause\(\);[\s\S]+await waitForContinuousDelay\(40\);[\s\S]+\}/);
  assert.match(watchdogMatch[1], /const retryStarted = await videoPlayer\.play\(\);/);
  assert.ok(
    watchdogMatch[1].indexOf('videoPlayer.pause();') <
      watchdogMatch[1].indexOf('const retryStarted = await videoPlayer.play();'),
    'stalled playback should be paused before retrying play'
  );
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
  assert.match(advanceSource, /const startStatusTime = snapshot\.statusTime;/);
  assert.match(advanceSource, /return currentSnapshot\.statusTime - startStatusTime >= minDelta;/);
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

test('spacebar pauses an active continuous handoff instead of starting a duplicate session', () => {
  const shouldStartMatch = appSource.match(/function shouldStartPlaylistContinuousAutoPlayback\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(shouldStartMatch, 'continuous autoplay start predicate should exist');
  assert.match(shouldStartMatch[1], /!continuousPlaybackState\.active/);

  const handleMatch = appSource.match(/async function handleUserPlayPauseToggle\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(handleMatch, 'play/pause toggle handler should exist');
  const handleSource = handleMatch[1];
  assert.match(handleSource, /const continuousPausePosition = continuousPlaybackState\.active[\s\S]+getPlaybackSyncPosition\(videoPlayer\.currentTime, \{ forceContinuous: true \}\)/);
  assert.match(handleSource, /playbackSync\.broadcastPause\(continuousPausePosition\.time, continuousPausePosition\.options\);/);
  assert.match(handleSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+const continuousPausePosition = getPlaybackSyncPosition\(videoPlayer\.currentTime, \{ forceContinuous: true \}\);[\s\S]+stopContinuousPlayback\(\);[\s\S]+videoPlayer\.pause\(\);[\s\S]+playbackSync\.broadcastPause\(continuousPausePosition\.time, continuousPausePosition\.options\);[\s\S]+return;/);
  assert.doesNotMatch(handleSource, /invalidateActiveVideoLoad\(\);/);
  assert.match(handleSource, /const startedItem = await startContinuousPlayback\(\);[\s\S]+broadcastPlaylistContinuousPlaybackPlay\(startedItem, videoPlayer\.currentTime\);/);
  assert.doesNotMatch(handleSource, /void startContinuousPlayback\(\);[\s\S]+broadcastCurrentPlaybackPlay\(\);/);
  assert.ok(
    handleSource.indexOf('if (continuousPlaybackState.active)') <
      handleSource.indexOf('if (shouldStartPlaylistContinuousAutoPlayback())'),
    'active continuous handoffs should be cancelled before the handler can start a new session'
  );
});

test('prepared continuous items are reused only when a prepared path or mpv path is still valid', () => {
  assert.match(appSource, /async function canReusePreparedContinuousItem\(item\) \{/);
  assert.match(appSource, /continuousPlaybackState\.preparedMediaPaths\.has\(item\.id\)/);
  assert.match(appSource, /const useMpvPilot = await shouldUseMpvPilot\(item\.videoPath/);
  assert.match(appSource, /if \(item\?\.continuousStatus === CONTINUOUS_STATUS\.READY && await canReusePreparedContinuousItem\(item\)\) \{[\s\S]+return true;[\s\S]+\}/);
  assert.match(appSource, /if \(!item\) return false;/);
  assert.match(appSource, /if \(item\.continuousStatus === CONTINUOUS_STATUS\.READY && await canReusePreparedContinuousItem\(item\)\) \{[\s\S]+return \{ ready: true, cached: true \};[\s\S]+\}/);
  assert.match(appSource, /if \(item\?\.continuousStatus === CONTINUOUS_STATUS\.READY\) \{[\s\S]+markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.IDLE, ''\);[\s\S]+\}/);
  assert.match(appSource, /if \(item\.continuousStatus === CONTINUOUS_STATUS\.READY\) \{[\s\S]+markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.IDLE, ''\);[\s\S]+\}/);
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
  assert.match(startSource, /return await playNextContinuousItem\(sessionId, \{ inFlight: true \}\);/);
  assert.match(startSource, /return currentItem;/);

  const nextMatch = appSource.match(/async function playNextContinuousItem\(sessionId, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  function setPlaylistMode/);
  assert.ok(nextMatch, 'playNextContinuousItem should exist');
  const nextSource = nextMatch[1];
  assert.ok(
    nextSource.indexOf('prepareNextPlaylistItem(sessionId);') <
      nextSource.indexOf('const started = await playContinuousItemWithWatchdog(nextItem, sessionId);'),
    'following item preparation should begin before playback watchdog waits'
  );
  assert.match(nextSource, /return await playNextContinuousItem\(sessionId, \{ inFlight: true \}\);/);
  assert.match(nextSource, /return nextItem;/);
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
  assert.match(loadVideoSource, /shouldContinue = null/);
  assert.match(loadVideoSource, /const shouldContinueVideoLoad = typeof shouldContinue === 'function'[\s\S]+: \(\) => true;/);
  assert.match(loadVideoSource, /let allowNavigationGuardAbort = true;/);
  assert.match(loadVideoSource, /const canContinueVideoLoad = \(\) => \([\s\S]+!isStaleVideoLoad\(\) &&[\s\S]+\(!allowNavigationGuardAbort \|\| shouldContinueVideoLoad\(\)\)[\s\S]+\);/);
  assert.match(loadVideoSource, /activeVideoLoadPath = filePath;/);
  assert.match(loadVideoSource, /allowNavigationGuardAbort = false;[\s\S]+\/\/ ====== 이전 파일 감시 및 협업 세션 정리/);
  assert.match(loadVideoSource, /finally \{[\s\S]+const ownsActiveLoad = activeVideoLoadToken === loadToken;[\s\S]+if \(activeVideoLoadToken === loadToken\) \{[\s\S]+activeVideoLoadToken = null;[\s\S]+activeVideoLoadPath = null;/);
  assert.match(loadVideoSource, /if \(!preserveContinuousSession && continuousPlaybackState\.active\) \{[\s\S]+stopContinuousPlayback\(\);[\s\S]+\}/);
  assert.match(loadVideoSource, /const isStaleVideoLoad = \(\) => loadToken !== latestVideoLoadToken;/);
  assert.match(loadVideoSource, /if \(!canContinueVideoLoad\(\)\) return false;/);
  assert.match(loadVideoSource, /if \(playWhenMediaReady && shouldContinueVideoLoad\(\)\) \{[\s\S]+await playVideoAfterMediaLoad\(\{ silent: true \}\);[\s\S]+\}/);
  assert.doesNotMatch(loadVideoSource, /if \(playWhenMediaReady\) \{\s*\n\s*await playVideoAfterMediaLoad\(\{ silent: true \}\);/);
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
  assert.match(playlistLoaderSource, /const canContinuePlaylistLoad = \(\) => loadIntent === videoLoadIntentGeneration &&[\s\S]+typeof shouldContinue !== 'function' \|\| shouldContinue\(\)/);
  assert.match(playlistLoaderSource, /if \(!canContinuePlaylistLoad\(\)\) return false;/);
  assert.ok(
    playlistLoaderSource.indexOf('if (!canContinuePlaylistLoad()) return false;') <
      playlistLoaderSource.indexOf('const loaded = await loadVideo(item.videoPath, {'),
    'stale playlist selections must stop before loadVideo can claim the latest load token'
  );
  assert.match(playlistLoaderSource, /const loaded = await loadVideo\(item\.videoPath, \{[\s\S]+\.\.\.loadOptions,[\s\S]+shouldContinue: canContinuePlaylistLoad[\s\S]+\}\);/);
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
  assert.match(appSource, /async function playNextContinuousItem\(sessionId, options = \{\}\)/);
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

test('continuous preflight updates item status without rebuilding the playlist list', () => {
  const preflightMatch = appSource.match(/async function quickCheckPlaylistForContinuous\(sessionId, itemsToCheck = null\) \{([\s\S]*?)\n  \}/);
  assert.ok(preflightMatch, 'quick preflight function should exist');

  const preflightSource = preflightMatch[1];
  assert.match(preflightSource, /markPlaylistItemStatus\(item,/);
  assert.doesNotMatch(
    preflightSource,
    /updatePlaylistUI\(\)/,
    'preflight status checks should not rebuild the playlist DOM and reset scroll'
  );
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
  assert.match(appSource, /async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\)/);
  assert.match(appSource, /const loaded = await loadVideoFromPlaylist\(item, \{[\s\S]+preserveContinuousSession: true,[\s\S]+preparedVideoPath[\s\S]+\}\);/);
  assert.match(appSource, /markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.ERROR, '건너뜀'\);/);
  assert.match(appSource, /continuousPlaybackState\.skippedBatch\.push\(item\);/);
  assert.match(appSource, /const loaded = await loadContinuousPlaylistItem\(currentItem, sessionId, startLoadIntent\);[\s\S]+if \(!loaded\) \{[\s\S]+await playNextContinuousItem\(sessionId, \{ inFlight: true \}\);/);
  assert.match(appSource, /const loaded = await loadContinuousPlaylistItem\(nextItem, sessionId, videoLoadIntent\);[\s\S]+if \(!loaded\) \{[\s\S]+await playNextContinuousItem\(sessionId, \{ inFlight: true \}\);/);
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

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
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

  assert.match(appSource, /async function startCollaborationForVideoLoad\(loadToken, bframePath, options = \{\}\)/);
  assert.match(appSource, /function scheduleDeferredCollaborationStart\(loadToken, bframePath\)/);
  assert.match(loadVideoSource, /deferCollaborationStart = false/);
  assert.match(loadVideoSource, /if \(hasExistingData\) \{[\s\S]*if \(deferCollaborationStart\) \{[\s\S]*scheduleDeferredCollaborationStart\(loadToken, currentBframePath\);[\s\S]*\} else \{[\s\S]*await startCollaborationForVideoLoad\(loadToken, currentBframePath\);/);
  assert.match(loadVideoSource, /else \{\s*startDeferredReviewFileDiscovery\(loadToken, currentBframePath\);\s*\}/);

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  assert.match(continuousLoadMatch[1], /deferCollaborationStart: true/);
});

test('playlist marker refreshes update visible progress without rebuilding scrolled playlist rows', () => {
  const markerRefreshMatch = appSource.match(/commentManager\.addEventListener\('markersChanged', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(markerRefreshMatch, 'markersChanged listener should exist');

  const markerRefreshSource = markerRefreshMatch[1];
  assert.match(markerRefreshSource, /void refreshVisiblePlaylistProgress\(\);/);
  assert.doesNotMatch(
    markerRefreshSource,
    /updatePlaylistUI\(\)/,
    'marker refreshes should not rebuild playlist rows during item navigation'
  );
});

test('continuous playlist starts playback as soon as the next media is renderable', () => {
  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
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
  assert.match(appSource, /loadingSessionId:\s*null/);
  assert.match(appSource, /function shouldIgnoreContinuousTimelineUpdateDuringSourceLoad\(\)/);
  const playbackSyncMatch = appSource.match(/function syncPlaybackPositionUI\(currentTime, currentFrame, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 비디오 시간 업데이트/);
  assert.ok(playbackSyncMatch, 'shared playback UI sync helper should exist');
  assert.match(playbackSyncMatch[1], /if \(!shouldIgnoreContinuousTimelineUpdateDuringSourceLoad\(\)\) \{[\s\S]*timeline\.setCurrentTime/);

  const timeupdateMatch = appSource.match(/videoPlayer\.addEventListener\('timeupdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(timeupdateMatch, 'timeupdate handler should exist');
  assert.match(timeupdateMatch[1], /syncPlaybackPositionUI\(currentTime, currentFrame/);

  const frameUpdateMatch = appSource.match(/videoPlayer\.addEventListener\('frameUpdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(frameUpdateMatch, 'frameUpdate handler should exist');
  assert.match(frameUpdateMatch[1], /syncPlaybackPositionUI\(time, frame/);

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  assert.match(continuousLoadMatch[1], /continuousPlaybackState\.loadingItemId = item\.id/);
  assert.match(continuousLoadMatch[1], /continuousPlaybackState\.loadingSessionId = sessionId/);
  assert.match(continuousLoadMatch[1], /finally \{[\s\S]*continuousPlaybackState\.loadingItemId === item\.id &&[\s\S]*continuousPlaybackState\.loadingSessionId === sessionId[\s\S]*continuousPlaybackState\.loadingItemId = null/);
  assert.match(continuousLoadMatch[1], /continuousPlaybackState\.loadingSessionId = null/);
});

test('continuous playback skips hidden HTML preload for mpv pilot items', () => {
  assert.match(appSource, /async function preloadPlaylistMediaForItem\(item, options = \{\}\)/);
  const preloadMatch = appSource.match(/async function preloadPlaylistMediaForItem\(item, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  function preloadNextPlaylistMedia/);
  assert.ok(preloadMatch, 'playlist preload helper should exist');
  const preloadSource = preloadMatch[1];
  assert.match(preloadSource, /const useMpvPilot = await shouldUseMpvPilot\(item\.videoPath/);
  assert.match(preloadSource, /if \(isSameFilePath\(state\.currentFile, item\.videoPath\)\) return;/);
  assert.match(preloadSource, /if \(useMpvPilot\) \{[\s\S]+mpv 파일럿 재생목록 HTML 사전 로드 건너뜀[\s\S]+return;[\s\S]+\}/);
  assert.ok(
    preloadSource.indexOf('if (useMpvPilot)') < preloadSource.indexOf('media.src = toLocalMediaUrl(item.videoPath);'),
    'mpv pilot items should not be routed through the hidden Chromium video preload path'
  );

  const prepareNextMatch = appSource.match(/function prepareNextPlaylistItem\(sessionId\) \{([\s\S]*?)\n  \}\n\n  async function waitForPreparedOrSkip/);
  assert.ok(prepareNextMatch, 'prepareNextPlaylistItem should exist');
  const prepareNextSource = prepareNextMatch[1];

  assert.match(prepareNextSource, /void preloadPlaylistMediaForItem\(items\[nextIndex\], \{[\s\S]*continuous: true,[\s\S]*sessionId[\s\S]*\}\);/);
  assert.ok(
    prepareNextSource.indexOf('void preloadPlaylistMediaForItem(items[nextIndex]') <
      prepareNextSource.indexOf('preparePlaylistItemInBackground(items[nextIndex], sessionId);'),
    'eligible hidden media preload should start before background preparation'
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

  const continuousLoaderMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\) \{([\s\S]*?)\n  \}/);
  assert.ok(continuousLoaderMatch, 'continuous playlist loader should exist');
  const continuousLoaderSource = continuousLoaderMatch[1];
  assert.match(continuousLoaderSource, /const preparedVideoPath = continuousPlaybackState\.preparedMediaPaths\.get\(item\.id\);/);
  assert.match(continuousLoaderSource, /preparedVideoPath/);
});

test('playlist loading returns the real loadVideo result', () => {
  const loadVideoFromPlaylistMatch = appSource.match(/async function loadVideoFromPlaylist\(item, options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadVideoFromPlaylistMatch, 'playlist loader should exist');

  const playlistLoaderSource = loadVideoFromPlaylistMatch[1];
  assert.match(playlistLoaderSource, /const \{ shouldContinue = null, videoLoadIntent = null, \.\.\.loadOptions \} = options;/);
  assert.match(playlistLoaderSource, /const loaded = await loadVideo\(item\.videoPath, \{[\s\S]+\.\.\.loadOptions,[\s\S]+shouldContinue: canContinuePlaylistLoad[\s\S]+\}\);/);
  assert.match(playlistLoaderSource, /return loaded === true;/);
  assert.doesNotMatch(playlistLoaderSource, /await loadVideo\(item\.videoPath\);\s*return true;/);

  assert.match(appSource, /showToast\(`코덱 변환 실패: \$\{transcoded\.error \|\| '취소됨'\}`, 'error'\);\s*return false;/);
  assert.match(appSource, /showToast\('파일을 로드할 수 없습니다\.', 'error'\);\s*return false;/);
  assert.match(appSource, /trace\.end\(\{ filePath, hasExistingData \}\);\s*videoLoadCompleted = true;\s*return true;/);
});

test('continuous timeline uses aggregate time for playback and seek', () => {
  assert.match(appSource, /mapGlobalTimeToSegment[\s\S]+mapLocalTimeToGlobal[\s\S]+from '\.\/modules\/playlist-continuous-core\.js'/);
  assert.match(appSource, /function getContinuousTimelinePlaybackTime\(localTime = videoPlayer\.currentTime\)/);
  assert.match(appSource, /mapLocalTimeToGlobal\(segment, localTime\)/);
  assert.match(appSource, /function getPlaybackSyncPosition\(localTime = videoPlayer\.currentTime, options = \{\}\)/);
  assert.match(appSource, /const \{ forceContinuous = false \} = options;/);
  assert.match(appSource, /\(forceContinuous \|\| continuousPlaybackState\.active === true\) &&[\s\S]+playlistUIState\.mode === 'continuous'/);
  assert.match(appSource, /const segment = getCurrentContinuousSegment\(\);[\s\S]+if \(!segment\) return \{ time: localTime, options: \{\} \};/);
  assert.match(appSource, /time: mapLocalTimeToGlobal\(segment, localTime\)/);
  assert.match(appSource, /options: \{ playlistContinuous: true \}/);
  assert.match(appSource, /function getPlaylistContinuousSyncPositionForItem\(item, localTime = videoPlayer\.currentTime\)/);
  assert.match(appSource, /timeline\.playlistSegments\?\.find\(candidate => candidate\.itemId === item\.id\)/);
  assert.match(appSource, /function broadcastPlaylistContinuousPlaybackPlay\(item, localTime = videoPlayer\.currentTime\)/);
  assert.match(appSource, /playbackSync\.broadcastPlay\(position\.time, position\.options\);/);
  assert.match(appSource, /function getActiveTimelinePlaybackTime\(currentTime = videoPlayer\.currentTime,\s*currentFrame = videoPlayer\.currentFrame\)/);
  assert.match(appSource, /playlistUIState\.mode === 'continuous'[\s\S]+return getContinuousTimelinePlaybackTime\(currentTime\);/);
  assert.match(appSource, /timeline\.setCurrentTime\(getActiveTimelinePlaybackTime\(currentTime,\s*currentFrame\)\);/);
  assert.match(appSource, /syncPlaybackPositionUI\(time, frame, \{/);
  assert.match(appSource, /async function seekContinuousTimeline\(globalTime, options = \{\}\)/);
  assert.match(appSource, /const \{ resumePlayback = true \} = options;/);
  assert.match(appSource, /mapGlobalTimeToSegment\(timeline\.playlistSegments, globalTime\)/);
  assert.match(appSource, /videoPlayer\.seek\(mapped\.localTime\);/);
  assert.match(appSource, /playbackSync\.broadcastSeek\(mapLocalTimeToGlobal\(mapped\.segment, mapped\.localTime\), \{[\s\S]+playlistContinuous: true[\s\S]+\}\);/);
  assert.match(playbackSyncSource, /broadcastSeek\(time, options = \{\}\)/);
  assert.match(playbackSyncSource, /this\._pendingSeekEvent = \{ time, \.\.\.options \};/);
  assert.match(playbackSyncSource, /this\._lm\.broadcastEvent\(\{ type: `\$\{PREFIX\}SEEK`, \.\.\.event \}\);/);
  assert.match(playbackSyncSource, /detail: \{ time: event\.time, playlistContinuous: event\.playlistContinuous === true \}/);
  assert.match(appSource, /function canHandleRemoteContinuousSync\(\) \{[\s\S]+playlistUIState\.mode === 'continuous' && timeline\.playlistDuration > 0;[\s\S]+\}/);
  assert.match(appSource, /function warnRemoteContinuousSyncUnavailable\(action, time\) \{[\s\S]+상대방의 재생목록 위치를 따라갈 수 없습니다\./);
  assert.match(appSource, /playbackSync\.addEventListener\('remotePlay', \(e\) => \{[\s\S]+const followed = await seekContinuousTimeline\(time\);[\s\S]+if \(!followed\) \{[\s\S]+상대방의 재생목록 위치를 따라갈 수 없습니다\.[\s\S]+return;[\s\S]+\}[\s\S]+if \(!continuousPlaybackState\.active\) \{[\s\S]+await startContinuousPlayback\(\);/);
  assert.match(appSource, /playbackSync\.addEventListener\('remotePlay', \(e\) => \{[\s\S]+if \(playlistContinuous\) \{[\s\S]+if \(!canHandleRemoteContinuousSync\(\)\) \{[\s\S]+warnRemoteContinuousSyncUnavailable\('play', time\);[\s\S]+return;[\s\S]+\}/);
  assert.match(appSource, /playbackSync\.addEventListener\('remotePause', \(e\) => \{[\s\S]+seekContinuousTimeline\(time, \{ resumePlayback: false \}\);/);
  assert.match(appSource, /playbackSync\.addEventListener\('remotePause', \(e\) => \{[\s\S]+if \(playlistContinuous\) \{[\s\S]+if \(!canHandleRemoteContinuousSync\(\)\) \{[\s\S]+warnRemoteContinuousSyncUnavailable\('pause', time\);[\s\S]+return;[\s\S]+\}/);
  const remotePauseMatch = appSource.match(/playbackSync\.addEventListener\('remotePause', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(remotePauseMatch, 'remotePause handler should exist');
  assert.match(remotePauseMatch[1], /stopContinuousPlayback\(\);/);
  assert.doesNotMatch(remotePauseMatch[1], /invalidateActiveVideoLoad\(\);/);
  assert.ok(
    remotePauseMatch[1].indexOf('if (!canHandleRemoteContinuousSync())') <
      remotePauseMatch[1].indexOf('videoPlayer.pause();'),
    'unhandled continuous pause should return before touching local playback'
  );
  assert.match(appSource, /playbackSync\.addEventListener\('remoteSeek', \(e\) => \{[\s\S]+const \{ time, playlistContinuous \} = e\.detail;[\s\S]+seekContinuousTimeline\(time\);/);
  assert.match(appSource, /playbackSync\.addEventListener\('remoteSeek', \(e\) => \{[\s\S]+if \(playlistContinuous\) \{[\s\S]+if \(!canHandleRemoteContinuousSync\(\)\) \{[\s\S]+warnRemoteContinuousSyncUnavailable\('seek', time\);[\s\S]+return;[\s\S]+\}/);
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

test('playlist rows highlight videos with comments by resolved state', () => {
  assert.match(appSource, /function applyPlaylistItemCommentState\(el, progress\) \{/);
  assert.match(appSource, /el\.classList\.toggle\('has-comments', hasComments\);/);
  assert.match(appSource, /el\.classList\.toggle\('has-unresolved-comments', unresolved > 0\);/);
  assert.match(appSource, /el\.classList\.toggle\('comments-resolved', allResolved\);/);
  assert.match(playlistManagerSource, /if \(!marker \|\| marker\.deleted\) continue;[\s\S]+total\+\+;/);
  assert.match(appSource, /<span class="playlist-item-comment-state" hidden><\/span>/);
  assert.match(appSource, /applyPlaylistItemCommentState\(el, progress\);/);
  assert.match(playlistCss, /\.playlist-item\.has-unresolved-comments/);
  assert.match(playlistCss, /\.playlist-item\.comments-resolved/);
  assert.match(playlistCss, /\.playlist-item-comment-state/);
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
  assert.match(appSource, /async function cancelPlaylistBackgroundTranscodesForMpvPilot\(reason = 'mpv 파일럿 사용'\) \{[\s\S]+invalidatePlaylistBackgroundWork\(\);[\s\S]+await window\.electronAPI\.ffmpegCancel\(\);/);
  assert.match(prepareSource, /const useMpvPilot = await shouldUseMpvPilot\(item\.videoPath, \{[\s\S]+fileIsAudio: isAudioFile\(item\.fileName \|\| item\.videoPath\),[\s\S]+hasPreparedVideoPath: false[\s\S]+\}\);/);
  assert.ok(
    prepareSource.indexOf('const useMpvPilot = await shouldUseMpvPilot') <
      prepareSource.indexOf('const ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();'),
    'mpv pilot eligibility should be checked before FFmpeg probing'
  );
  assert.match(prepareSource, /if \(useMpvPilot\) \{[\s\S]+await cancelPlaylistBackgroundTranscodesForMpvPilot\('mpv 재생목록 원본 준비'\);[\s\S]+continuousPlaybackState\.preparedMediaPaths\.delete\(item\.id\);[\s\S]+markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.READY, 'mpv 원본 준비'\);[\s\S]+return \{ ready: true, mpv: true \};[\s\S]+\}/);
  const mpvReadyBlock = prepareSource.match(/if \(useMpvPilot\) \{([\s\S]*?)\n        \}/);
  assert.ok(mpvReadyBlock, 'mpv ready block should exist');
  assert.doesNotMatch(mpvReadyBlock[1], /preparedMediaPaths\.set/);
  assert.ok(
    prepareSource.indexOf('if (useMpvPilot)') <
      prepareSource.indexOf('window.electronAPI.ffmpegPreTranscode(item.videoPath)'),
    'mpv-ready playlist items must return before background transcode starts'
  );
});

test('mpv pilot video loads cancel already-running FFmpeg background work before playback', () => {
  const loadVideoStart = appSource.indexOf('  async function loadVideo(filePath, options = {}) {');
  const loadVideoEnd = appSource.indexOf('  async function generateThumbnails', loadVideoStart);
  assert.notEqual(loadVideoStart, -1, 'loadVideo should exist');
  assert.notEqual(loadVideoEnd, -1, 'loadVideo boundary should exist');

  const loadVideoSource = appSource.slice(loadVideoStart, loadVideoEnd);
  assert.match(loadVideoSource, /const useMpvPilot = allowMpvPilot && await shouldUseMpvPilot/);
  assert.match(loadVideoSource, /if \(useMpvPilot\) \{[\s\S]+await cancelPlaylistBackgroundTranscodesForMpvPilot\('mpv 직접 재생 시작'\);[\s\S]+if \(!canContinueVideoLoad\(\)\) return false;[\s\S]+\}/);
  assert.ok(
    loadVideoSource.indexOf("await cancelPlaylistBackgroundTranscodesForMpvPilot('mpv 직접 재생 시작')") <
      loadVideoSource.indexOf('const ffmpegAvailable = !useMpvPilot'),
    'mpv direct playback should cancel stale FFmpeg background work before any FFmpeg branch'
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

test('continuous playback stops with one toast when a global drawing gate cancels the load', () => {
  const loadVideoMatch = appSource.match(
    /async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 피드백 36/
  );
  assert.ok(loadVideoMatch, 'video loader should exist');
  const loadVideoSource = loadVideoMatch[1];
  const genericToast = 'showToast(\'새 드로잉을 저장할 수 없어 영상 전환을 취소했습니다.\', \'error\');';
  const failureBranchPattern = persistenceVariable => new RegExp(
    `if \\(!${persistenceVariable}\\) \\{\\s+` +
    'if \\(preserveContinuousSession\\) \\{\\s+' +
    'lastVideoLoadFabricCancelReason = \'fabric-persistence\';\\s+' +
    `\\} else \\{\\s+${genericToast.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+` +
    '\\}\\s+return false;\\s+\\}'
  );
  assert.match(loadVideoSource, failureBranchPattern('fabricPersistenceReadyToLeave'));
  assert.match(loadVideoSource, failureBranchPattern('finalFabricPersistenceReadyToLeave'));
  assert.equal(loadVideoSource.split(genericToast).length - 1, 2);

  const continuousLoadMatch = appSource.match(/async function loadContinuousPlaylistItem\(item, sessionId, videoLoadIntent\) \{([\s\S]*?)\n  \}\n\n  function waitForContinuousDelay/);
  assert.ok(continuousLoadMatch, 'continuous playlist loader should exist');
  assert.match(
    continuousLoadMatch[1],
    /lastVideoLoadFabricCancelReason = null;[\s\S]+loadVideoFromPlaylist\(item, \{[\s\S]+if \(lastVideoLoadFabricCancelReason !== null\) \{[\s\S]+stopContinuousPlayback\(\);[\s\S]+showToast\('드로잉 저장 문제로 이어붙이기 재생을 중단했습니다\.', 'error'\);[\s\S]+return false;[\s\S]+\}[\s\S]+markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.ERROR, '건너뜀'\);/
  );
});

test('playlist failure rollback finds the actual loaded item despite optimistic intermediate selections', () => {
  const findPlaylistItemIndexByVideoPath = loadPlaylistVideoPathIndexHelper();
  const items = [
    { id: 'O', videoPath: 'C:\\show\\original.mp4' },
    { id: 'A', videoPath: 'C:\\show\\optimistic-a.mp4' },
    { id: 'B', videoPath: 'C:\\show\\target-b.mp4' }
  ];

  assert.equal(
    findPlaylistItemIndexByVideoPath(items, 'C:/SHOW/ORIGINAL.MP4'),
    0,
    'B must roll back to O, not the optimistic A selection'
  );
  assert.equal(findPlaylistItemIndexByVideoPath(items, null), -1);
  assert.equal(findPlaylistItemIndexByVideoPath(items, 'C:/show/missing.mp4'), -1);
});

test('playlist clicks highlight immediately, roll back from current media, and retry skipped items', () => {
  const selectedMatch = appSource.match(/playlistManager\.onItemSelected = async \(item, index\) => \{([\s\S]*?)\n    \};/);
  assert.ok(selectedMatch, 'playlist item selected callback should exist');
  const selectedSource = selectedMatch[1];

  const suppressReturnIndex = selectedSource.indexOf('return;');
  const optimisticIndex = selectedSource.indexOf('updatePlaylistCurrentItem();', suppressReturnIndex);
  const loadIndex = selectedSource.indexOf('loadVideoFromPlaylist(item, {');
  assert.ok(
    optimisticIndex !== -1 && optimisticIndex < loadIndex,
    'selection highlight must render before the video load starts'
  );

  assert.match(
    selectedSource,
    /if \(loaded === false\) \{\s+playlistManager\.currentIndex = findPlaylistItemIndexByVideoPath\(playlistManager\.getItems\?\.\(\) \|\| \[\], state\.currentFile\);\s+\}/
  );
  assert.doesNotMatch(selectedSource, /previousIndex/);
  assert.doesNotMatch(playlistManagerSource, /onItemSelected\?\.\(item, index, previousIndex\)/);
  assert.match(
    selectedSource,
    /if \(item\.continuousStatus === CONTINUOUS_STATUS\.SKIPPED \|\|\s+item\.continuousStatus === CONTINUOUS_STATUS\.ERROR\) \{\s+markPlaylistItemStatus\(item, CONTINUOUS_STATUS\.IDLE, ''\);\s+\}/
  );
  assert.match(selectedSource, /holdPreviousFrameUntilReady: true,/);
});

test('이어붙이기 자동 전환은 드로잉 저장 실패를 자동 포기하거나 우회하지 않는다', () => {
  assert.doesNotMatch(appSource, /function bypassContinuousPersistenceGate\(stage\) \{/);
  assert.doesNotMatch(appSource, /continuousPersistenceAbandonNotified/);
  assert.doesNotMatch(appSource, /bypassContinuousPersistenceGate\('(?:first|final)-gate'\)/);
});

test('이어붙이기 전환은 예외 격리와 제한 시간 감시자를 가진다', () => {
  const endedListenerMatch = appSource.match(/videoPlayer\.addEventListener\('ended', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(endedListenerMatch, 'ended listener should exist');
  assert.match(
    endedListenerMatch[1],
    /const advanceSessionId = continuousPlaybackState\.sessionId;\s+const advancePromise = playNextContinuousItem\(continuousPlaybackState\.sessionId\);\s+void advancePromise\.catch/
  );
  assert.match(endedListenerMatch[1], /isContinuousSessionActive\(advanceSessionId\)/);
  assert.match(appSource, /const CONTINUOUS_TRANSITION_DEADLINE_MS = 20000;/);
  assert.match(appSource, /function startContinuousTransitionDeadline\(item, sessionId\) \{/);
  const deadlineMatch = appSource.match(/function startContinuousTransitionDeadline\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  function getContinuousPlaybackSnapshot/);
  assert.ok(deadlineMatch, 'transition deadline helper should exist');
  assert.match(deadlineMatch[1], /if \(!isContinuousSessionActive\(sessionId\)\) return;/);
  assert.match(deadlineMatch[1], /continuousPlaybackState\.loadingItemId !== item\.id/);
  assert.match(deadlineMatch[1], /invalidateActiveVideoLoad\(\);/);
  assert.match(
    appSource,
    /const transitionDeadline = startContinuousTransitionDeadline\(nextItem, sessionId\);\s+const loaded = await loadContinuousPlaylistItem\(nextItem, sessionId, videoLoadIntent\);\s+transitionDeadline\.cancel\(\);/
  );
  assert.match(
    appSource,
    /const transitionDeadline = startContinuousTransitionDeadline\(currentItem, sessionId\);\s+const loaded = await loadContinuousPlaylistItem\(currentItem, sessionId, startLoadIntent\);\s+transitionDeadline\.cancel\(\);/
  );
  const ipcHandlersSourceLocal = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/ipc-handlers.js'), 'utf8'));
  assert.match(ipcHandlersSourceLocal, /const FILE_EXISTS_DEADLINE_MS = 3000;/);
  assert.match(ipcHandlersSourceLocal, /파일 존재 확인 지연, 존재로 간주하고 진행/);
});

test('영상 끝에서 멈춘 이어붙이기 세션은 스페이스 1회로 재개된다', () => {
  const handleMatch = appSource.match(/async function handleUserPlayPauseToggle\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(handleMatch, 'play/pause toggle handler should exist');
  const handleSource = handleMatch[1];
  const resumeBranch = handleSource.match(
    /continuousPlaybackState\.active &&\s+continuousPlaybackState\.loadingItemId === null &&\s+hasContinuousPlaybackReachedMediaEnd\(\)\s*\) \{([\s\S]*?)\n    \}/
  );
  assert.ok(resumeBranch, 'stalled-session resume branch should exist');
  assert.match(resumeBranch[1], /stopContinuousPlayback\(\);/);
  assert.match(resumeBranch[1], /const restartedItem = await startContinuousPlayback\(\);/);
  assert.match(resumeBranch[1], /finally \{\s+continuousStalledResumeInFlight = false;/);
  assert.match(handleSource, /if \(continuousStalledResumeInFlight\) return;/);
  assert.match(appSource, /let continuousStalledResumeInFlight = false;/);
  assert.ok(
    handleSource.indexOf('hasContinuousPlaybackReachedMediaEnd()') <
      handleSource.indexOf('const continuousPausePosition = getPlaybackSyncPosition(videoPlayer.currentTime, { forceContinuous: true });\n      stopContinuousPlayback();'),
    'resume branch must run before the handoff-pause branch'
  );
});

function createContinuousSingleFlightHarness(dependencies) {
  const optionalSources = extractOptionalAppFunctions([
    'hardAbandonContinuousTransitionFlight',
    'waitForContinuousTransitionFlight',
    'runContinuousTransitionFlight',
    'requestContinuousPlaybackAdvance',
    'getActiveVideoLoadCompletionForPath',
    'startContinuousPlaybackInFlight'
  ]);
  const runtimeFactory = new Function('dependencies', `
    with (dependencies) {
      let continuousTransitionFlight = null;
      let activeVideoLoadCompletion = null;
      let activeVideoLoadToken = null;
      let videoLoadIntentGeneration = 0;
      let pendingUserVideoLoadIntent = null;
      let continuousPersistenceAbandonNotified = false;
      let continuousStalledResumeInFlight = false;
      let lastVideoLoadFabricCancelReason = null;
      let playlistSelectionLoadToken = 0;
      let playlistContinuousNavigationToken = 0;
      let suppressPlaylistSelectionLoad = false;
      const CONTINUOUS_TRANSITION_DEADLINE_MS = 20000;
      ${optionalSources}
      ${extractAppFunctionSource('isContinuousSessionActive')}
      ${extractAppFunctionSource('resetContinuousPlaybackRuntimeState')}
      ${extractAppFunctionSource('restartContinuousPlaybackSessionForManualSeek')}
      ${extractAppFunctionSource('stopContinuousPlayback')}
      ${extractAppFunctionSource('commitPlaylistReplacement')}
      ${extractAppFunctionSource('loadContinuousPlaylistItem')}
      ${extractAppFunctionSource('startContinuousTransitionDeadline')}
      ${extractAppFunctionSource('startContinuousPlayback')}
      ${extractAppFunctionSource('playNextContinuousItemForIntent')}
      ${extractAppFunctionSource('playNextContinuousItem')}
      ${extractAppFunctionSource('seekContinuousTimeline')}
      ${extractAppFunctionSource('handleUserPlayPauseToggle')}
      const handleRemotePause = ${extractRemotePauseHandlerSource()};
      return {
        playNextContinuousItem,
        startContinuousPlayback,
        seekContinuousTimeline,
        commitPlaylistReplacement,
        handleUserPlayPauseToggle,
        handleRemotePause,
        setActiveVideoLoadCompletion: record => { activeVideoLoadCompletion = record; },
        setActiveVideoLoadState: (record, token) => {
          activeVideoLoadCompletion = record;
          activeVideoLoadToken = token;
        },
        getFlight: () => continuousTransitionFlight
      };
    }
  `);
  return runtimeFactory(dependencies);
}

function createNormalPlaylistLoadPriorityHarness(dependencies) {
  const optionalSources = extractOptionalAppFunctions([
    'hardAbandonContinuousTransitionFlight',
    'preemptContinuousPlaybackForUserLoad',
    'waitForContinuousTransitionFlight'
  ]);
  const runtimeFactory = new Function('dependencies', `
    with (dependencies) {
      let continuousTransitionFlight = null;
      let videoLoadIntentGeneration = 0;
      let pendingUserVideoLoadIntent = null;
      let playlistContinuousNavigationToken = 0;
      ${optionalSources}
      ${extractAppFunctionSource('isContinuousSessionActive')}
      ${extractAppFunctionSource('resetContinuousPlaybackRuntimeState')}
      ${extractAppFunctionSource('stopContinuousPlayback')}
      ${extractAppFunctionSource('loadVideoFromPlaylist')}
      return {
        loadVideoFromPlaylist,
        setFlight: flight => { continuousTransitionFlight = flight; },
        getFlight: () => continuousTransitionFlight
      };
    }
  `);
  return runtimeFactory(dependencies);
}

function createActualLoadRaceHarness(dependencies, {
  useActualPlayNext = false,
  useActualContinuousLoad = false
} = {}) {
  const optionalSources = extractOptionalAppFunctions([
    'beginActiveVideoLoadCompletion',
    'completeActiveVideoLoad',
    'getActiveVideoLoadCompletionForPath',
    'hardAbandonContinuousTransitionFlight',
    'preemptContinuousPlaybackForUserLoad',
    'waitForContinuousTransitionFlight',
    'runContinuousTransitionFlight',
    'requestContinuousPlaybackAdvance',
    ...(useActualPlayNext ? ['playNextContinuousItemForIntent', 'playNextContinuousItem'] : []),
    ...(useActualContinuousLoad ? ['loadContinuousPlaylistItem'] : [])
  ]);
  const runtimeFactory = new Function('dependencies', `
    with (dependencies) {
      let latestVideoLoadToken = 0;
      let activeVideoLoadToken = null;
      let activeVideoLoadPath = null;
      let activeVideoLoadCompletion = null;
      let continuousTransitionFlight = null;
      let videoLoadIntentGeneration = 0;
      let pendingUserVideoLoadIntent = null;
      let lastVideoLoadFabricCancelReason = null;
      let continuousPersistenceAbandonNotified = false;
      let continuousStalledResumeInFlight = false;
      let playlistSelectionLoadToken = 0;
      let playlistContinuousNavigationToken = 0;
      let suppressPlaylistSelectionLoad = false;
      let mpvDrawPlaybackTransitionToken = 0;
      let hybridReviewResumeMpvFile = null;
      let suppressReviewFreezeReleaseForMediaChange = false;
      let playlistAutoPlayAfterSelection = false;
      let previousVersionComments = null;
      const undoStack = [];
      const redoStack = [];
      const CONTINUOUS_TRANSITION_DEADLINE_MS = 20000;
      ${optionalSources}
      ${extractAppFunctionSource('hasActiveVideoLoadForDifferentFile')}
      ${extractAppFunctionSource('invalidateActiveVideoLoad')}
      ${extractAppFunctionSource('isContinuousSessionActive')}
      ${extractAppFunctionSource('resetContinuousPlaybackRuntimeState')}
      ${extractAppFunctionSource('restartContinuousPlaybackSessionForManualSeek')}
      ${extractAppFunctionSource('stopContinuousPlayback')}
      ${extractAppFunctionSource('loadVideoWithHtml5Fallback')}
      ${extractAppFunctionSource('loadVideo')}
      ${extractAppFunctionSource('loadVideoFromPlaylist')}
      ${extractAppFunctionSource('seekContinuousTimeline')}
      ${extractAppFunctionSource('commitPlaylistReplacement')}
      ${extractAppFunctionSource('startContinuousTransitionDeadline')}
      ${extractAppFunctionSource('startContinuousPlayback')}
      ${extractAppFunctionSource('handleUserPlayPauseToggle')}
      const handleEnded = () => {${extractEndedHandlerSource()}\n      };
      return {
        loadVideo,
        loadVideoFromPlaylist,
        seekContinuousTimeline,
        commitPlaylistReplacement,
        startContinuousPlayback,
        startContinuousTransitionDeadline,
        handleUserPlayPauseToggle,
        handleEnded,
        requestContinuousPlaybackAdvance,
        hardAbandonContinuousTransitionFlight,
        setFlight: flight => {
          flight.completion = activeVideoLoadCompletion;
          continuousTransitionFlight = flight;
        },
        getFlight: () => continuousTransitionFlight,
        setActiveVideoLoadState: ({ completion, token = null, filePath = null }) => {
          activeVideoLoadCompletion = completion;
          activeVideoLoadToken = token;
          activeVideoLoadPath = filePath;
        },
        getLatestVideoLoadToken: () => latestVideoLoadToken,
        getIntentGeneration: () => videoLoadIntentGeneration,
        getPendingUserVideoLoadIntent: () => pendingUserVideoLoadIntent
      };
    }
  `);
  return runtimeFactory(dependencies);
}

function createActualLoadRaceScenario({
  holdFirstFileExists = false,
  useMpvPilot = false,
  invalidSeekMap = false,
  seekItemIndex = 1,
  continuousMediaEnded = false,
  holdFirstMediaLoad = false,
  failFirstMediaLoad = false,
  holdSecondMediaLoad = false,
  useActualPlayNext = false,
  useActualContinuousLoad = false,
  failFirstContinuousLoad = false,
  failFirstPreparedItem = false,
  holdSecondFileExists = false,
  fabricFlushResults = null
} = {}) {
  const effects = {
    mediaLoads: [],
    continuousLoads: 0,
    settlements: [],
    teardowns: 0,
    fallbacks: 0,
    normalAutoNext: 0,
    queuedAutoAdvances: 0,
    playAfterLoad: 0,
    fabricFlushes: 0,
    fabricBeforeChanges: 0,
    fabricCancellations: [],
    persistenceBypassStages: [],
    persistenceAbandons: 0,
    playlistStatusChanges: [],
    toasts: []
  };
  const queuedFabricFlushResults = Array.isArray(fabricFlushResults)
    ? [...fabricFlushResults]
    : null;
  let releaseOldTail;
  let notifyOldTailStarted;
  const oldTailStarted = new Promise(resolve => { notifyOldTailStarted = resolve; });
  const heldOldTail = new Promise(resolve => { releaseOldTail = resolve; });
  let versionCallCount = 0;
  let releaseFirstFileExists;
  let notifyFirstFileExistsStarted;
  const firstFileExistsStarted = new Promise(resolve => { notifyFirstFileExistsStarted = resolve; });
  const heldFirstFileExists = new Promise(resolve => { releaseFirstFileExists = resolve; });
  let releaseSecondFileExists;
  let notifySecondFileExistsStarted;
  const secondFileExistsStarted = new Promise(resolve => { notifySecondFileExistsStarted = resolve; });
  const heldSecondFileExists = new Promise(resolve => { releaseSecondFileExists = resolve; });
  let fileExistsCalls = 0;
  let releaseFirstMediaLoad;
  let notifyFirstMediaLoadStarted;
  const firstMediaLoadStarted = new Promise(resolve => { notifyFirstMediaLoadStarted = resolve; });
  const heldFirstMediaLoad = new Promise(resolve => { releaseFirstMediaLoad = resolve; });
  let releaseSecondMediaLoad;
  let notifySecondMediaLoadStarted;
  const secondMediaLoadStarted = new Promise(resolve => { notifySecondMediaLoadStarted = resolve; });
  const heldSecondMediaLoad = new Promise(resolve => { releaseSecondMediaLoad = resolve; });
  let mediaLoadCalls = 0;
  let capturedDeadline = null;
  let preparedItemCalls = 0;
  let mediaEnded = continuousMediaEnded;
  const continuousPlaybackState = {
    active: true,
    waiting: false,
    skippedBatch: [],
    preparePromises: new Map(),
    preparedMediaPaths: new Map(),
    loadingItemId: null,
    loadingSessionId: null,
    sessionId: 7
  };
  const state = { isDrawMode: false, isCommentMode: false, isAudioMode: false, currentFile: null };
  const items = [
    { id: 'item-a', fileName: 'a.mp4', videoPath: 'C:/clips/a.mp4', continuousStatus: 'ready', fps: 24 },
    { id: 'item-c', fileName: 'c.mp4', videoPath: 'C:/clips/c.mp4', continuousStatus: 'ready', fps: 24 }
  ];
  const playlistManager = {
    currentIndex: 0,
    isActive: () => true,
    isEmpty: () => false,
    getItems: () => items,
    getCurrentItem: () => items[playlistManager.currentIndex],
    selectItemById: itemId => {
      const index = items.findIndex(item => item.id === itemId);
      if (index >= 0) playlistManager.currentIndex = index;
      return items[playlistManager.currentIndex];
    },
    getContinuousSettings: () => ({ loop: true }),
    hasNext: () => true,
    next: () => { effects.normalAutoNext += 1; return items[0]; }
  };
  const makeElement = () => {
    const element = {
      style: {}, dataset: {}, textContent: '', innerHTML: '',
      classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
      addEventListener: () => {}, removeEventListener: () => {}, setAttribute: () => {},
      removeAttribute: () => {}, remove: () => {}, querySelector: () => null,
      closest: () => element
    };
    return element;
  };
  const fallbackElement = makeElement();
  const elements = new Proxy({
    videoPlayer: makeElement(), videoWrapper: makeElement(), drawingTools: makeElement(),
    fileName: makeElement(), filePath: makeElement(), dropZone: makeElement(),
    btnOpenFolder: makeElement(), btnOpenOther: makeElement(), videoTrackClip: makeElement(),
    btnDrawMode: makeElement(), videoZoomControls: makeElement()
  }, { get: (target, key) => target[key] || fallbackElement });
  const videoPlayer = {
    engine: 'html5', fps: 24, totalFrames: 240, currentFrame: 0, currentTime: 0,
    duration: 10, isPlaying: false, isAudioMode: false,
    setFps: () => {}, seekToFrame: () => {},
    seek: time => { videoPlayer.currentTime = time; },
    pause: () => { videoPlayer.isPlaying = false; },
    togglePlay: () => { videoPlayer.isPlaying = !videoPlayer.isPlaying; },
    load: async filePath => {
      effects.mediaLoads.push(filePath);
      mediaLoadCalls += 1;
      if (holdFirstMediaLoad && mediaLoadCalls === 1) {
        notifyFirstMediaLoadStarted();
        await heldFirstMediaLoad;
      }
      if (failFirstMediaLoad && mediaLoadCalls === 1) throw new Error('first media load failed');
      if (holdSecondMediaLoad && mediaLoadCalls === 2) {
        notifySecondMediaLoadStarted();
        await heldSecondMediaLoad;
      }
    }
  };
  const reviewDataManager = {
    currentBframePath: null,
    isModified: false,
    waitForPendingSave: async () => {},
    hasUnsavedChanges: () => false,
    save: async () => true,
    pauseAutoSave: () => {}, resumeAutoSave: () => {}, setVersionInfo: () => {},
    setVideoFile: async () => false, setFps: () => {}, getManualVersions: () => []
  };
  const fabricDrawingPilotController = {
    flushPersistenceBeforeLeave: async () => {
      effects.fabricFlushes += 1;
      return queuedFabricFlushResults?.length
        ? queuedFabricFlushResults.shift()
        : true;
    },
    beforeVideoChange: async () => {
      effects.fabricBeforeChanges += 1;
      return true;
    },
    cancelVideoChange: async (loadToken, options) => {
      effects.fabricCancellations.push({ loadToken, options });
      return true;
    },
    abandonPersistenceForVideoChange: () => {
      effects.persistenceAbandons += 1;
      return true;
    },
    afterVideoReady: async () => {}
  };
  const pendingReview = { token: null };
  const runtime = createActualLoadRaceHarness({
    continuousPlaybackState,
    state,
    elements,
    videoPlayer,
    reviewDataManager,
    fabricDrawingPilotInitialization: Promise.resolve(true),
    fabricDrawingPilotController,
    confirm: () => false,
    bypassContinuousPersistenceGate: stage => {
      effects.persistenceBypassStages.push(stage);
      return false;
    },
    supersedeActiveTranscodeOverlay: () => {},
    showDriveVideoLoadingFeedback: () => false,
    hideVideoLoadingOverlay: () => {},
    document: { body: makeElement(), getElementById: () => fallbackElement, querySelectorAll: () => [] },
    window: {
      electronAPI: {
        getFileInfo: async filePath => ({ name: path.basename(filePath), dir: path.dirname(filePath), ext: '.mp4', size: 1 }),
        ffmpegIsAvailable: async () => false,
        watchFileStop: async () => {},
        fileExists: async () => {
          fileExistsCalls += 1;
          if (holdFirstFileExists && fileExistsCalls === 1) {
            notifyFirstFileExistsStarted();
            await heldFirstFileExists;
          }
          if (holdSecondFileExists && fileExistsCalls === 2) {
            notifySecondFileExistsStarted();
            await heldSecondFileExists;
          }
          return true;
        }
      }
    },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, trace: () => ({ end: () => {}, error: () => {} }) },
    isAudioFile: () => false,
    isSameFilePath: (left, right) => left === right,
    shouldUseMpvPilot: async () => useMpvPilot,
    mpvPilotSeamlessTransitionGate: { begin: () => {}, clear: () => {} },
    isMpvPilotPlaybackActive: () => false,
    cancelPlaylistBackgroundTranscodesForMpvPilot: async () => {},
    beginDestructiveMpvReviewMediaChange: loadToken => { pendingReview.token = loadToken; return true; },
    stopDeferredReviewFileDiscovery: () => {},
    liveblocksManager: { stop: async () => {} },
    commentSync: { stop: () => {} }, drawingSync: { stop: () => {} }, fabricDrawingSync: { stop: () => {} },
    updateCollaboratorsUI: () => {}, commentManager: { setCommentMode: () => {}, clear: () => {} },
    setCommentModeReadyState: () => {}, setCommentModePreparingState: () => {},
    preserveMpvReviewFreezeFrameForMediaChange: () => false,
    releaseMpvReviewFreezeFrame: async () => {}, resetCommentFilters: () => {},
    advanceGlobalHistoryRevision: () => {},
    drawingManager: { reset: () => {}, setPlaying: () => {}, layers: [], activeLayerId: null, renderFrame: () => {} },
    highlightManager: { reset: () => {}, setVideoInfo: () => {} },
    timeline: {
      playlistDuration: 20,
      playlistSegments: items.map((item, index) => ({ index, itemId: item.id, startTime: index * 10, duration: 10, fps: 24 })),
      clearMarkers: () => {}, renderDrawingLayers: () => {}, setCurrentTime: () => {}, setPlayingState: () => {}
    },
    markerContainer: makeElement(), codecErrorOverlay: makeElement(),
    getAudioWaveform: () => ({ hide: () => {}, reset: () => {}, setPlaying: () => {} }),
    invalidateMpvHostVisibilityRequests: () => {}, resolveInitialFrameFromOptions: () => null,
    captureVideoTransitionFreezeFrame: () => false, releaseVideoTransitionFreezeFrame: () => {},
    resolveHtml5PlaybackFps: async () => 24, seekInitialVideoFrameBeforeReveal: async () => {},
    waitForVideoRenderable: async () => true, waitForNextVideoPaint: async () => {},
    playVideoAfterMediaLoad: async () => { effects.playAfterLoad += 1; return true; },
    parseVersion: () => ({ version: 1 }),
    getVersionManager: () => ({
      setCurrentFile: async () => {
        versionCallCount += 1;
        if (versionCallCount === 1) {
          notifyOldTailStarted();
          await heldOldTail;
        }
      },
      setManualVersions: () => {}
    }),
    getVersionDropdown: () => ({ show: () => {}, onVersionSelect: () => {}, _render: () => {} }),
    toVersionInfo: () => ({}), generateThumbnails: async () => {},
    getThumbnailGenerator: () => ({ clear: () => {} }),
    scheduleDeferredCollaborationStart: () => {}, startCollaborationForVideoLoad: async () => true,
    startDeferredReviewFileDiscovery: () => {},
    showToast: (message, type) => { effects.toasts.push({ message, type }); },
    renderVideoMarkers: () => {},
    updateTimelineMarkers: () => {}, updateCommentList: () => {},
    compositionLayerManager: { setVideoInfo: () => {}, setPlaybackState: () => {}, render: () => {} },
    renderCompositionLayerTimeline: () => {}, renderHighlights: () => {},
    refreshCommentRangesForCurrentMode: async () => {}, recentFilesManager: { add: () => {} },
    getFabricDrawingPilotContext: () => ({}),
    settlePendingMpvReviewFreezeMediaChange: async options => {
      effects.settlements.push(options);
      if (pendingReview.token !== options?.expectedLoadToken) return false;
      pendingReview.token = null;
      if (options.loaded !== true) effects.teardowns += 1;
      return options.loaded === true;
    },
    retryDeferredMpvOverlayFallback: () => { effects.fallbacks += 1; }, resolveMpvThumbnailVideoPath: async filePath => filePath,
    loadVideoWithMpvPilot: async () => false,
    beginMpvHtml5FallbackReviewTransition: () => null,
    beginExpectedMpvHtml5FallbackStop: () => 1,
    finishMpvHtml5FallbackReviewTransition: () => {},
    scheduleExpectedMpvHtml5FallbackStopCleanup: () => {},
    clearPlaylistMediaPreload: () => {}, getPlaylistManager: () => playlistManager,
    selectPlaylistItemForContinuous: index => {
      playlistManager.currentIndex = index;
      return items[index];
    },
    quickCheckPlaylistForContinuous: async () => true,
    waitForPreparedOrSkip: async () => {
      preparedItemCalls += 1;
      return !(failFirstPreparedItem && preparedItemCalls === 1);
    },
    prepareNextPlaylistItem: () => {},
    playContinuousItemWithWatchdog: async () => true,
    playNextContinuousItem: (sessionId, options = {}) => {
      if (!options.inFlight) return runtime.requestContinuousPlaybackAdvance(sessionId);
      effects.queuedAutoAdvances += 1;
      return Promise.resolve(null);
    },
    loadContinuousPlaylistItem: async (item, sessionId, videoLoadIntent) => {
      effects.continuousLoads += 1;
      if (failFirstContinuousLoad && effects.continuousLoads === 1) return false;
      return runtime.loadVideo(item.videoPath, {
        preserveContinuousSession: true,
        playWhenMediaReady: true,
        allowMpvPilot: false,
        videoLoadIntent,
        shouldContinue: () => continuousPlaybackState.active && continuousPlaybackState.sessionId === sessionId
      });
    },
    setTimeout: (callback, delay) => {
      if (delay === 20000) { capturedDeadline = callback; return { deadline: true }; }
      const timer = setTimeout(callback, delay); timer.unref?.(); return timer;
    },
    clearTimeout: timer => { if (!timer?.deadline) clearTimeout(timer); },
    invalidatePlaylistBackgroundWork: () => {}, resetPlaylistContinuousTimelineState: () => {},
    playlistUIState: { mode: 'continuous' },
    mapGlobalTimeToSegment: (_segments, time) => invalidSeekMap ? null : ({
      segment: {
        index: seekItemIndex,
        itemId: items[seekItemIndex].id,
        startTime: seekItemIndex * 10,
        duration: 10,
        fps: 24
      },
      localTime: Math.max(0, time - (seekItemIndex * 10))
    }),
    mapLocalTimeToGlobal: (segment, localTime) => segment.startTime + localTime,
    findPlaylistItemIndexByVideoPath: (playlistItems, videoPath) =>
      playlistItems.findIndex(item => item.videoPath === videoPath),
    updatePlaylistCurrentItem: () => {}, updatePlaylistPosition: () => {},
    getPlaybackSyncPosition: () => ({ time: 0, options: { playlistContinuous: true } }),
    playbackSync: { broadcastPause: () => {}, broadcastSeek: () => {} },
    broadcastCurrentPlaybackPause: () => {}, broadcastCurrentPlaybackPlay: () => {},
    broadcastPlaylistContinuousPlaybackPlay: () => {}, warmPlaylistAutoPlayQueue: () => {},
    shouldStartPlaylistContinuousAutoPlayback: () => true,
    hasContinuousPlaybackReachedMediaEnd: () => mediaEnded,
    findNextPlayableIndex: (_items, index) => (index + 1) % items.length,
    flushSkippedToastBatch: () => {},
    markPlaylistItemStatus: (item, status, message) => {
      effects.playlistStatusChanges.push({ itemId: item?.id, status, message });
    },
    CONTINUOUS_STATUS: { ERROR: 'error' },
    playIconSVG: '',
    syncCompositionLayerPlaybackState: () => {},
    restoreMpvDrawFreezeAfterPlayback: () => {},
    cutlistUIState: { active: false },
    getCutlistManager: () => ({ isActive: () => false }),
    getNextCutlistCut: () => null,
    advanceCutlistPlaybackFromCut: () => {},
    getContinuousPlaybackSnapshot: () => ({}),
    userSettings: { getPlaylistAutoPlay: () => true }
  }, { useActualPlayNext, useActualContinuousLoad });

  return {
    effects, runtime, state, continuousPlaybackState, items, playlistManager,
    oldTailStarted, releaseOldTail,
    firstFileExistsStarted, releaseFirstFileExists,
    secondFileExistsStarted, releaseSecondFileExists,
    firstMediaLoadStarted, releaseFirstMediaLoad,
    secondMediaLoadStarted, releaseSecondMediaLoad,
    setContinuousMediaEnded: ended => { mediaEnded = ended; },
    fireDeadline: () => { assert.equal(typeof capturedDeadline, 'function'); capturedDeadline(); }
  };
}

test('드로잉 저장 게이트 실패는 이어붙이기를 한 번만 중단하고 현재 영상 선택을 복원한다', async (t) => {
  const cases = [
    { name: 'first gate', flushResults: [false], expectedFlushes: 1, expectedBeforeChanges: 0, expectedCancellations: 0 },
    { name: 'final gate', flushResults: [true, false], expectedFlushes: 2, expectedBeforeChanges: 1, expectedCancellations: 1 }
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const scenario = createActualLoadRaceScenario({
        useActualPlayNext: true,
        useActualContinuousLoad: true,
        fabricFlushResults: testCase.flushResults
      });
      scenario.state.currentFile = scenario.items[0].videoPath;
      scenario.releaseOldTail();

      const result = await scenario.runtime.requestContinuousPlaybackAdvance(7);

      assert.equal(result, null);
      assert.equal(scenario.continuousPlaybackState.active, false);
      assert.equal(scenario.effects.fabricFlushes, testCase.expectedFlushes);
      assert.equal(scenario.effects.fabricBeforeChanges, testCase.expectedBeforeChanges);
      assert.equal(scenario.effects.fabricCancellations.length, testCase.expectedCancellations);
      assert.deepEqual(scenario.effects.persistenceBypassStages, []);
      assert.equal(scenario.effects.persistenceAbandons, 0);
      assert.deepEqual(scenario.effects.mediaLoads, []);
      assert.deepEqual(scenario.effects.playlistStatusChanges, []);
      assert.equal(scenario.playlistManager.currentIndex, 0);
      assert.deepEqual(scenario.effects.toasts, [{
        message: '드로잉 저장 문제로 이어붙이기 재생을 중단했습니다.',
        type: 'error'
      }]);
      if (testCase.expectedCancellations > 0) {
        assert.equal(
          scenario.effects.fabricCancellations[0].options?.preserveAuthoritativeOverlay,
          true
        );
      }
    });
  }
});

function createSingleFlightScenario({ itemCount = 2, currentIndex = 0, captureDeadline = false } = {}) {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `item-${index}`,
    fileName: `clip-${index}.mp4`,
    videoPath: `C:/clips/clip-${index}.mp4`,
    continuousStatus: 'ready'
  }));
  const continuousPlaybackState = {
    active: true,
    waiting: false,
    skippedBatch: [],
    preparePromises: new Map(),
    preparedMediaPaths: new Map(),
    loadingItemId: null,
    loadingSessionId: null,
    sessionId: 7
  };
  const state = { currentFile: items[currentIndex]?.videoPath || null };
  const playlistManager = {
    currentIndex,
    isActive: () => true,
    isEmpty: () => false,
    getItems: () => items,
    getCurrentItem: () => items[playlistManager.currentIndex] || null,
    selectItemById: itemId => {
      const index = items.findIndex(item => item.id === itemId);
      if (index >= 0) playlistManager.currentIndex = index;
      return items[playlistManager.currentIndex] || null;
    },
    getContinuousSettings: () => ({ loop: true })
  };
  const loadCalls = [];
  const heldLoads = [];
  let holdLoads = true;
  let activeLoads = 0;
  let maxConcurrentLoads = 0;
  let invalidations = 0;
  const deadlineCallbacks = [];
  const videoPlayer = {
    isPlaying: false,
    currentTime: 0,
    seekToFrame: () => {},
    seek: time => { videoPlayer.currentTime = time; },
    pause: () => { videoPlayer.isPlaying = false; },
    togglePlay: () => { videoPlayer.isPlaying = !videoPlayer.isPlaying; }
  };
  const runtime = createContinuousSingleFlightHarness({
    continuousPlaybackState,
    state,
    getPlaylistManager: () => playlistManager,
    findNextPlayableIndex: (_items, index) => (index + 1) % items.length,
    selectPlaylistItemForContinuous: index => {
      playlistManager.currentIndex = index;
      return items[index];
    },
    waitForPreparedOrSkip: async () => true,
    flushSkippedToastBatch: () => {},
    showToast: () => {},
    prepareNextPlaylistItem: () => {},
    playContinuousItemWithWatchdog: async () => true,
    loadVideoFromPlaylist: async (item, options) => {
      loadCalls.push({ item, options });
      activeLoads += 1;
      maxConcurrentLoads = Math.max(maxConcurrentLoads, activeLoads);
      if (!holdLoads) {
        state.currentFile = item.videoPath;
        activeLoads -= 1;
        return true;
      }
      return new Promise(resolve => {
        heldLoads.push(() => {
          state.currentFile = item.videoPath;
          activeLoads -= 1;
          resolve(true);
        });
      });
    },
    markPlaylistItemStatus: () => {},
    CONTINUOUS_STATUS: { ERROR: 'error' },
    clearPlaylistMediaPreload: () => {},
    setTimeout: (callback, delay) => {
      if (captureDeadline && delay === 20000) {
        const deadline = { callback, cancelled: false };
        deadlineCallbacks.push(deadline);
        return deadline;
      }
      const timer = setTimeout(callback, delay);
      timer.unref?.();
      return timer;
    },
    clearTimeout: timer => {
      if (timer && Object.hasOwn(timer, 'cancelled')) {
        timer.cancelled = true;
        return;
      }
      clearTimeout(timer);
    },
    invalidateActiveVideoLoad: () => { invalidations += 1; },
    invalidatePlaylistBackgroundWork: () => {},
    resetPlaylistContinuousTimelineState: () => {},
    log: { error: () => {}, warn: () => {} },
    isSameFilePath: (left, right) => left === right,
    hasActiveVideoLoadForDifferentFile: () => false,
    quickCheckPlaylistForContinuous: async () => true,
    videoPlayer,
    playlistUIState: { mode: 'continuous' },
    timeline: {
      playlistDuration: itemCount * 10,
      playlistSegments: items.map((item, index) => ({
        index,
        itemId: item.id,
        startTime: index * 10,
        duration: 10,
        fps: 24
      })),
      setCurrentTime: () => {}
    },
    mapGlobalTimeToSegment: (_segments, globalTime) => {
      const index = Math.max(0, Math.min(items.length - 1, Math.floor(globalTime / 10)));
      return {
        segment: { index, itemId: items[index].id, startTime: index * 10, duration: 10, fps: 24 },
        localTime: globalTime - index * 10
      };
    },
    mapLocalTimeToGlobal: (segment, localTime) => segment.startTime + localTime,
    updatePlaylistCurrentItem: () => {},
    updatePlaylistPosition: () => {},
    playVideoAfterMediaLoad: async () => true,
    getPlaybackSyncPosition: () => ({ time: 0, options: { playlistContinuous: true } }),
    playbackSync: { broadcastPause: () => {}, broadcastSeek: () => {} },
    broadcastCurrentPlaybackPause: () => {},
    broadcastCurrentPlaybackPlay: () => {},
    broadcastPlaylistContinuousPlaybackPlay: () => {},
    warmPlaylistAutoPlayQueue: () => {},
    shouldStartPlaylistContinuousAutoPlayback: () => true,
    hasContinuousPlaybackReachedMediaEnd: () => false,
    canHandleRemoteContinuousSync: () => true,
    warnRemoteContinuousSyncUnavailable: () => {}
  });

  return {
    continuousPlaybackState,
    items,
    loadCalls,
    runtime,
    state,
    videoPlayer,
    getInvalidations: () => invalidations,
    getMaxConcurrentLoads: () => maxConcurrentLoads,
    fireLatestDeadline: () => {
      const deadline = [...deadlineCallbacks].reverse().find(candidate => !candidate.cancelled);
      assert.ok(deadline, 'a live 20 second transition deadline should exist');
      deadline.callback();
    },
    releaseNextLoad: () => heldLoads.shift()?.(),
    releaseAllLoads: () => {
      holdLoads = false;
      heldLoads.splice(0).forEach(release => release());
    }
  };
}

test('single-flight coalesces duplicate EOF while the early-play load tail is pending', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 3, currentIndex: 0 });
  const firstAdvance = scenario.runtime.playNextContinuousItem(7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.loadCalls.length, 1);

  const duplicateEofA = scenario.runtime.playNextContinuousItem(7);
  const duplicateEofB = scenario.runtime.playNextContinuousItem(7);
  await new Promise(resolve => setImmediate(resolve));
  const callsBeforeTailRelease = scenario.loadCalls.length;

  scenario.releaseAllLoads();
  await Promise.allSettled([firstAdvance, duplicateEofA, duplicateEofB]);

  assert.equal(callsBeforeTailRelease, 1, 'duplicate EOF must not start a concurrent transition');
  assert.deepEqual(
    scenario.loadCalls.map(call => call.item.id),
    ['item-1', 'item-2'],
    'the pending EOF flag must be consumed exactly once after the current tail settles'
  );
  assert.ok(scenario.loadCalls.every(call => call.options.playWhenMediaReady === true));
});

test('local pause followed by immediate Space waits for the old production transition tail', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 2, currentIndex: 0 });
  scenario.videoPlayer.isPlaying = true;
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.loadCalls.length, 1);

  await scenario.runtime.handleUserPlayPauseToggle();
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  const callsBeforeTailRelease = scenario.loadCalls.length;
  const invalidationsBeforeTailRelease = scenario.getInvalidations();

  scenario.releaseAllLoads();
  await Promise.allSettled([oldTransition, resumed]);

  assert.equal(callsBeforeTailRelease, 1, 'Space resume must not mint a replacement load before the old tail settles');
  assert.equal(invalidationsBeforeTailRelease, 0, 'a user pause must not destructively invalidate the retained media');
});

test('immediate Space hard-abandons a permanently stalled soft predecessor after the deadline', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 2, currentIndex: 0, captureDeadline: true });
  scenario.videoPlayer.isPlaying = true;
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);
  scenario.runtime.setActiveVideoLoadState({
    filePath: scenario.items[1].videoPath,
    intentGeneration: 1,
    loadToken: 41,
    hardInvalidated: false,
    promise: Promise.resolve(false)
  }, 41);

  await scenario.runtime.handleUserPlayPauseToggle();
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  scenario.fireLatestDeadline();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.loadCalls.length, 2, 'the latest session must start without waiting for stalled predecessor I/O');
  assert.equal(scenario.getInvalidations(), 1, 'the timed-out predecessor media load must be hard-invalidated');
  assert.equal(scenario.continuousPlaybackState.active, true, 'the latest resumed session must remain active');

  scenario.releaseAllLoads();
  await Promise.allSettled([oldTransition, resumed]);
});

test('a superseded soft-flight deadline cannot hard-invalidate a newer active completion', async () => {
  const scenario = createActualLoadRaceScenario();
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.oldTailStarted;
  scenario.runtime.setFlight({ sessionId: 7, promise: oldLoad, pendingAdvance: false, hardAbandoned: false });
  const resumed = scenario.runtime.startContinuousPlayback();
  await new Promise(resolve => setImmediate(resolve));

  const newerCompletion = {
    filePath: 'C:/clips/newer.mp4', intentGeneration: 2, loadToken: 91,
    hardInvalidated: false, promise: new Promise(() => {}), settle: () => {}
  };
  scenario.runtime.hardAbandonContinuousTransitionFlight();
  scenario.runtime.setActiveVideoLoadState({ completion: newerCompletion, token: 91, filePath: newerCompletion.filePath });
  scenario.fireDeadline();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(newerCompletion.hardInvalidated, false, 'an obsolete wait timer must not invalidate newer media ownership');
  scenario.releaseOldTail();
  await Promise.allSettled([oldLoad, resumed]);
});

test('a preflight soft-flight timeout leaves an inactive prior completion reusable', async () => {
  const scenario = createActualLoadRaceScenario();
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[0].videoPath;
  const priorCompletion = {
    filePath: scenario.items[0].videoPath, intentGeneration: 0, loadToken: 41,
    hardInvalidated: false, promise: Promise.resolve(true), settle: () => {}
  };
  scenario.runtime.setActiveVideoLoadState({ completion: priorCompletion });
  let abandonPreflight;
  const stalledPreflight = new Promise(resolve => { abandonPreflight = resolve; });
  scenario.runtime.setFlight({
    sessionId: 7,
    promise: stalledPreflight,
    pendingAdvance: false,
    hardAbandoned: false,
    abandon: abandonPreflight
  });

  const resumed = scenario.runtime.startContinuousPlayback();
  await new Promise(resolve => setImmediate(resolve));
  scenario.fireDeadline();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(priorCompletion.hardInvalidated, false, 'a settled record is not the stalled preflight media owner');

  scenario.releaseOldTail();
  await resumed;
});

test('a soft-flight timeout after the resumed session is paused leaves retained media intact', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 2, currentIndex: 0, captureDeadline: true });
  scenario.videoPlayer.isPlaying = true;
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);
  scenario.runtime.setActiveVideoLoadState({
    filePath: scenario.items[1].videoPath,
    intentGeneration: 1,
    loadToken: 51,
    hardInvalidated: false,
    promise: Promise.resolve(false)
  }, 51);

  await scenario.runtime.handleUserPlayPauseToggle();
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  await scenario.runtime.handleUserPlayPauseToggle();
  scenario.fireLatestDeadline();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.continuousPlaybackState.active, false);
  assert.equal(scenario.getInvalidations(), 0, 'a timer owned by an inactive resumed session must be inert');
  scenario.releaseAllLoads();
  await Promise.allSettled([oldTransition, resumed]);
});

test('an inactive remote cross-file seek times out its stalled predecessor and continues', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 3, currentIndex: 0, captureDeadline: true });
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);
  scenario.runtime.setActiveVideoLoadState({
    filePath: scenario.items[1].videoPath,
    intentGeneration: 1,
    loadToken: 61,
    hardInvalidated: false,
    promise: Promise.resolve(false)
  }, 61);

  scenario.runtime.handleRemotePause({ detail: { time: 21, playlistContinuous: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.continuousPlaybackState.active, false);
  assert.equal(scenario.runtime.getFlight()?.sessionId, scenario.continuousPlaybackState.sessionId);
  assert.equal(scenario.loadCalls.length, 1);
  scenario.fireLatestDeadline();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.loadCalls.length, 2, 'the latest inactive navigation must bypass stalled predecessor I/O');
  assert.equal(scenario.loadCalls[1].item.id, 'item-2');
  assert.equal(scenario.getInvalidations(), 1);
  scenario.releaseAllLoads();
  await oldTransition;
});

test('hard abandonment releases a soft transition waiter before the retained tail settles', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 2, currentIndex: 0 });
  scenario.videoPlayer.isPlaying = true;
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);

  await scenario.runtime.handleUserPlayPauseToggle();
  const queuedResume = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  scenario.runtime.commitPlaylistReplacement();
  const resumeSettledBeforeOldTail = await Promise.race([
    queuedResume.then(() => true),
    new Promise(resolve => setImmediate(() => resolve(false)))
  ]);

  assert.equal(resumeSettledBeforeOldTail, true, 'hard abandonment must signal and release an already waiting soft flight');
  scenario.releaseAllLoads();
  await oldTransition;
});

test('a normal playlist load claims priority before its first persistence await', async () => {
  let releaseFlight;
  const oldFlightPromise = new Promise(resolve => { releaseFlight = resolve; });
  let releaseSave;
  let notifySaveStarted;
  const saveStarted = new Promise(resolve => { notifySaveStarted = resolve; });
  const heldSave = new Promise(resolve => { releaseSave = resolve; });
  const continuousPlaybackState = {
    active: true,
    waiting: false,
    skippedBatch: [],
    preparePromises: new Map(),
    preparedMediaPaths: new Map(),
    loadingItemId: 'continuous-item',
    loadingSessionId: 7,
    sessionId: 7
  };
  let loadCalls = 0;
  const runtime = createNormalPlaylistLoadPriorityHarness({
    continuousPlaybackState,
    clearPlaylistMediaPreload: () => {},
    window: { electronAPI: { fileExists: async () => true } },
    reviewDataManager: {
      isModified: true,
      save: async () => {
        notifySaveStarted();
        await heldSave;
        return true;
      }
    },
    loadVideo: async () => {
      loadCalls += 1;
      return true;
    },
    showToast: () => {},
    markPlaylistItemAsMissing: () => {}
  });
  runtime.setFlight({
    sessionId: 7,
    promise: oldFlightPromise,
    pendingAdvance: true,
    hardAbandoned: false
  });

  const normalLoad = runtime.loadVideoFromPlaylist({
    id: 'normal-item',
    fileName: 'normal.mp4',
    videoPath: 'C:/clips/normal.mp4'
  });
  await saveStarted;
  const activeDuringPersistence = continuousPlaybackState.active;
  const pendingAdvanceDuringPersistence = runtime.getFlight()?.pendingAdvance;

  releaseFlight();
  releaseSave();
  assert.equal(await normalLoad, true);
  assert.equal(activeDuringPersistence, false, 'normal load intent must stop the continuous session before persistence waits');
  assert.equal(pendingAdvanceDuringPersistence, false, 'queued EOF must yield to the normal load intent');
  assert.equal(loadCalls, 1);
});

async function waitForScenarioLoadCount(scenario, expected) {
  for (let attempt = 0; attempt < 20 && scenario.loadCalls.length < expected; attempt += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(scenario.loadCalls.length, expected);
}

test('eight short items keep one load in flight across three exact loops', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 8, currentIndex: 7 });
  const transitionPromises = [scenario.runtime.playNextContinuousItem(7)];

  for (let index = 0; index < 24; index += 1) {
    await waitForScenarioLoadCount(scenario, index + 1);
    if (index < 23) {
      transitionPromises.push(scenario.runtime.playNextContinuousItem(7));
      await new Promise(resolve => setImmediate(resolve));
    }
    scenario.releaseNextLoad();
  }
  await Promise.allSettled(transitionPromises);

  assert.equal(scenario.getMaxConcurrentLoads(), 1);
  assert.deepEqual(
    scenario.loadCalls.map(call => call.item.id),
    Array.from({ length: 24 }, (_, index) => `item-${index % 8}`)
  );
});

test('a hard deadline drops queued EOF and Space starts one replacement transition', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 3, currentIndex: 0, captureDeadline: true });
  const stalledTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);
  const queuedEof = scenario.runtime.playNextContinuousItem(7);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.loadCalls.length, 1);

  scenario.fireLatestDeadline();
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await waitForScenarioLoadCount(scenario, 2);
  assert.equal(scenario.loadCalls.length, 2, 'hard abandonment must allow exactly one fresh Space transition');

  scenario.releaseAllLoads();
  await Promise.allSettled([stalledTransition, queuedEof, resumed]);
});

test('playlist replacement clears a queued EOF without loading an old-playlist item', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 3, currentIndex: 0 });
  const transition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);
  const queuedEof = scenario.runtime.playNextContinuousItem(7);
  await new Promise(resolve => setImmediate(resolve));

  scenario.runtime.commitPlaylistReplacement();
  scenario.releaseAllLoads();
  await Promise.allSettled([transition, queuedEof]);

  assert.equal(scenario.loadCalls.length, 1);
  assert.equal(scenario.continuousPlaybackState.active, false);
  assert.equal(scenario.getInvalidations(), 1);
});

test('rapid same-file then cross-file manual seeks run only the latest navigation after the old tail', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 3, currentIndex: 0 });
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);

  const sameFileSeek = scenario.runtime.seekContinuousTimeline(1, { resumePlayback: false });
  const crossFileSeek = scenario.runtime.seekContinuousTimeline(21, { resumePlayback: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.loadCalls.length, 1, 'manual navigation must wait for the retained transition tail');

  scenario.releaseNextLoad();
  await waitForScenarioLoadCount(scenario, 2);
  scenario.releaseNextLoad();
  const [sameResult, crossResult] = await Promise.all([sameFileSeek, crossFileSeek]);
  await oldTransition;

  assert.equal(sameResult, false);
  assert.equal(crossResult, true);
  assert.equal(scenario.loadCalls[1].item.id, 'item-2');
  assert.equal(scenario.getMaxConcurrentLoads(), 1);
});

test('initial same-file continuous start waits for the ordinary load completion record', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 2, currentIndex: 0 });
  scenario.continuousPlaybackState.active = false;
  let resolveOrdinaryTail;
  const ordinaryTail = new Promise(resolve => { resolveOrdinaryTail = resolve; });
  scenario.runtime.setActiveVideoLoadCompletion({
    loadToken: 41,
    filePath: scenario.items[0].videoPath,
    intentGeneration: 0,
    result: null,
    promise: ordinaryTail
  });

  let startSettled = false;
  const started = scenario.runtime.startContinuousPlayback().then(result => {
    startSettled = true;
    return result;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(startSettled, false, 'same-file fast path must wait for the ordinary review tail');
  assert.equal(scenario.loadCalls.length, 0);

  resolveOrdinaryTail(true);
  assert.equal(await started, scenario.items[0]);
  assert.equal(scenario.loadCalls.length, 0);
});

test('remote pause cross-file seek waits for the retained tail without destructive invalidation', async () => {
  const scenario = createSingleFlightScenario({ itemCount: 3, currentIndex: 0 });
  const oldTransition = scenario.runtime.playNextContinuousItem(7);
  await waitForScenarioLoadCount(scenario, 1);

  scenario.runtime.handleRemotePause({ detail: { time: 21, playlistContinuous: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.loadCalls.length, 1);
  assert.equal(scenario.getInvalidations(), 0);

  scenario.releaseNextLoad();
  await waitForScenarioLoadCount(scenario, 2);
  assert.equal(scenario.loadCalls[1].item.id, 'item-2');
  assert.equal(scenario.getMaxConcurrentLoads(), 1);
  scenario.releaseNextLoad();
  await oldTransition;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scenario.state.currentFile, scenario.items[2].videoPath);
});

test('stale rejection is suppressed while current rejection and mpv HTML5 fallback stay live', async () => {
  const loadOptions = [];
  const runtimeFactory = new Function('dependencies', `
    with (dependencies) {
      ${extractAppFunctionSource('loadVideoWithHtml5Fallback')}
      return { loadVideoWithHtml5Fallback };
    }
  `);
  const runtime = runtimeFactory({
    beginMpvHtml5FallbackReviewTransition: () => ({ drawModeWasActive: false }),
    beginExpectedMpvHtml5FallbackStop: () => 1,
    finishMpvHtml5FallbackReviewTransition: () => {},
    scheduleExpectedMpvHtml5FallbackStopCleanup: () => {},
    loadVideo: async (_filePath, options) => {
      loadOptions.push(options);
      return true;
    }
  });

  const loadVideoSource = extractAppFunctionSource('loadVideo');
  const quietFailureIndex = loadVideoSource.indexOf('if (loadIntent !== videoLoadIntentGeneration || isStaleVideoLoad() || !shouldContinueVideoLoad()) return false;');
  assert.notEqual(quietFailureIndex, -1);
  assert.ok(quietFailureIndex < loadVideoSource.indexOf('trace.error(error);'));
  assert.equal(await runtime.loadVideoWithHtml5Fallback('C:/clips/fallback.mp4', {
    preserveContinuousSession: true,
    playWhenMediaReady: true
  }), true);
  assert.equal(loadOptions.length, 1);
  assert.equal(loadOptions[0].allowMpvPilot, false);
  assert.equal(loadOptions[0].preserveContinuousSession, true);
  assert.equal(loadOptions[0].playWhenMediaReady, true);
});

test('hard deadline Space resume bypasses the active production tail and same-file completion join', async () => {
  const scenario = createActualLoadRaceScenario();
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  scenario.runtime.setFlight({
    sessionId: 7,
    promise: oldLoad,
    pendingAdvance: false,
    hardAbandoned: false
  });
  scenario.continuousPlaybackState.loadingItemId = scenario.items[0].id;
  scenario.continuousPlaybackState.loadingSessionId = 7;
  await scenario.oldTailStarted;
  const oldToken = scenario.runtime.getLatestVideoLoadToken();

  scenario.runtime.startContinuousTransitionDeadline(scenario.items[0], 7);
  scenario.fireDeadline();
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const loadsBeforeOldRelease = scenario.effects.continuousLoads;
  const tokenBeforeOldRelease = scenario.runtime.getLatestVideoLoadToken();
  const fallbacksBeforeOldRelease = scenario.effects.fallbacks;

  scenario.releaseOldTail();
  await Promise.allSettled([oldLoad, resumed]);
  assert.equal(loadsBeforeOldRelease, 1, 'hard-abandoned completion must not block the replacement load');
  assert.ok(tokenBeforeOldRelease > oldToken);
  assert.equal(scenario.effects.fallbacks, fallbacksBeforeOldRelease + 1, 'hard old cleanup keeps its fallback after a newer token starts');
  assert.equal(scenario.effects.settlements.find(entry => entry.expectedLoadToken === oldToken)?.loaded, false);
});

test('a soft timeout gives its same-file replacement fresh EOF ownership before media claim', async () => {
  const scenario = createActualLoadRaceScenario({
    holdSecondMediaLoad: true
  });
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.oldTailStarted;
  let abandonOldFlight;
  const oldFlightAbandoned = new Promise(resolve => { abandonOldFlight = resolve; });
  scenario.runtime.setFlight({
    sessionId: 7,
    promise: Promise.race([oldLoad, oldFlightAbandoned]),
    pendingAdvance: false,
    hardAbandoned: false,
    abandon: abandonOldFlight
  });

  await scenario.runtime.handleUserPlayPauseToggle();
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  scenario.fireDeadline();
  await scenario.secondMediaLoadStarted;
  scenario.setContinuousMediaEnded(true);
  scenario.runtime.handleEnded();
  scenario.releaseSecondMediaLoad();
  await resumed;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.state.currentFile, scenario.items[0].videoPath);
  assert.equal(scenario.effects.queuedAutoAdvances, 0, 'old EOF must not skip the timeout replacement');
  scenario.releaseOldTail();
  await oldLoad;
});

test('a standalone local pause soft-settles the current production tail without fallback', async () => {
  const scenario = createActualLoadRaceScenario();
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.oldTailStarted;
  const oldToken = scenario.runtime.getLatestVideoLoadToken();
  const fallbacksBeforePause = scenario.effects.fallbacks;

  await scenario.runtime.handleUserPlayPauseToggle();
  scenario.releaseOldTail();
  await oldLoad;

  assert.equal(scenario.continuousPlaybackState.active, false);
  assert.equal(scenario.effects.settlements.find(entry => entry.expectedLoadToken === oldToken)?.loaded, true);
  assert.equal(scenario.effects.fallbacks, fallbacksBeforePause);
  assert.equal(scenario.effects.teardowns, 0);
});

test('Space reloads a hard-abandoned same-file tail that settled before resume', async () => {
  const scenario = createActualLoadRaceScenario();
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  scenario.runtime.setFlight({ sessionId: 7, promise: oldLoad, pendingAdvance: false, hardAbandoned: false });
  scenario.continuousPlaybackState.loadingItemId = scenario.items[0].id;
  scenario.continuousPlaybackState.loadingSessionId = 7;
  await scenario.oldTailStarted;

  scenario.runtime.startContinuousTransitionDeadline(scenario.items[0], 7);
  scenario.fireDeadline();
  scenario.releaseOldTail();
  await oldLoad;
  const resumed = scenario.runtime.handleUserPlayPauseToggle();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.effects.continuousLoads, 1, 'a settled hard tail must not satisfy the same-file fast path');
  await resumed;
});

test('playlist replacement and normal production load bypass a permanently hard-abandoned flight', async () => {
  const scenario = createActualLoadRaceScenario();
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  scenario.runtime.setFlight({
    sessionId: 7,
    promise: oldLoad,
    pendingAdvance: false,
    hardAbandoned: false
  });
  await scenario.oldTailStarted;
  const oldToken = scenario.runtime.getLatestVideoLoadToken();

  scenario.runtime.commitPlaylistReplacement();
  const normalLoad = scenario.runtime.loadVideo('C:/clips/normal.mp4', { allowMpvPilot: false });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  const tokenBeforeOldRelease = scenario.runtime.getLatestVideoLoadToken();
  const normalStartedBeforeOldRelease = scenario.effects.mediaLoads.includes('C:/clips/normal.mp4');

  scenario.releaseOldTail();
  await Promise.allSettled([oldLoad, normalLoad]);
  assert.ok(tokenBeforeOldRelease > oldToken);
  assert.equal(normalStartedBeforeOldRelease, true);
  assert.ok(scenario.effects.settlements.every(settlement => Number.isInteger(settlement.expectedLoadToken)));
  assert.equal(scenario.effects.teardowns, 0);
});

test('newer cross-file navigation fences an older normal preflight intent after a stalled production tail', async () => {
  const scenario = createActualLoadRaceScenario({ holdFirstFileExists: true });
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  scenario.runtime.setFlight({
    sessionId: 7,
    promise: oldLoad,
    pendingAdvance: false,
    hardAbandoned: false
  });
  await scenario.oldTailStarted;
  const oldToken = scenario.runtime.getLatestVideoLoadToken();

  const olderNormalLoad = scenario.runtime.loadVideoFromPlaylist({
    id: 'normal-b', fileName: 'b.mp4', videoPath: 'C:/clips/b.mp4'
  });
  await scenario.firstFileExistsStarted;
  const newerNavigation = scenario.runtime.seekContinuousTimeline(11, { resumePlayback: false });
  assert.equal(await newerNavigation, true);
  const fallbacksBeforeOldRelease = scenario.effects.fallbacks;

  scenario.releaseOldTail();
  await oldLoad;
  scenario.releaseFirstFileExists();
  const normalResult = await olderNormalLoad;

  assert.equal(normalResult, false);
  assert.equal(scenario.state.currentFile, scenario.items[1].videoPath);
  assert.equal(scenario.effects.mediaLoads.includes('C:/clips/b.mp4'), false);
  assert.ok(scenario.effects.settlements.every(settlement => Number.isInteger(settlement.expectedLoadToken)));
  assert.equal(scenario.effects.settlements.find(entry => entry.expectedLoadToken === oldToken)?.loaded, true);
  assert.equal(scenario.effects.fallbacks, fallbacksBeforeOldRelease, 'soft stale tails must not run destructive fallback');
  assert.equal(scenario.effects.teardowns, 0);
});

test('a normal preflight soft-stales the old production tail without running fallback', async () => {
  const scenario = createActualLoadRaceScenario({ holdFirstFileExists: true });
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.oldTailStarted;
  const oldToken = scenario.runtime.getLatestVideoLoadToken();

  const normalLoad = scenario.runtime.loadVideoFromPlaylist({
    id: 'normal-b', fileName: 'b.mp4', videoPath: 'C:/clips/b.mp4'
  });
  await scenario.firstFileExistsStarted;
  const fallbacksBeforeOldRelease = scenario.effects.fallbacks;
  scenario.releaseOldTail();
  assert.equal(await oldLoad, false);
  const fallbacksAfterOldRelease = scenario.effects.fallbacks;

  scenario.releaseFirstFileExists();
  assert.equal(await normalLoad, true);
  assert.equal(fallbacksAfterOldRelease, fallbacksBeforeOldRelease);
  assert.equal(scenario.effects.settlements.find(entry => entry.expectedLoadToken === oldToken)?.loaded, true);
  assert.equal(scenario.state.currentFile, 'C:/clips/b.mp4');
  assert.equal(scenario.effects.teardowns, 0);
});

test('a newer continuous start takes over a stalled normal intent before its media EOF', async () => {
  const scenario = createActualLoadRaceScenario({
    holdFirstFileExists: true,
    continuousMediaEnded: true
  });
  const normalLoad = scenario.runtime.loadVideoFromPlaylist({
    id: 'normal-b', fileName: 'b.mp4', videoPath: 'C:/clips/b.mp4'
  });
  await scenario.firstFileExistsStarted;

  const started = scenario.runtime.startContinuousPlayback();
  await scenario.oldTailStarted;
  scenario.runtime.handleEnded();
  scenario.releaseOldTail();
  await started;
  const queuedAfterNewMediaEof = scenario.effects.queuedAutoAdvances;

  scenario.releaseFirstFileExists();
  const normalResult = await normalLoad;
  assert.equal(normalResult, false);
  assert.equal(queuedAfterNewMediaEof, 1);
  assert.equal(scenario.runtime.getPendingUserVideoLoadIntent(), null);
  assert.equal(scenario.state.currentFile, scenario.items[0].videoPath);
});

test('an initial cross-file start fences the old media EOF until production media claim', async () => {
  const scenario = createActualLoadRaceScenario({
    continuousMediaEnded: true,
    holdFirstMediaLoad: true
  });
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[1].videoPath;

  const started = scenario.runtime.startContinuousPlayback();
  await scenario.firstMediaLoadStarted;
  scenario.runtime.handleEnded();
  scenario.releaseFirstMediaLoad();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  const startResult = await started;

  assert.equal(startResult, scenario.items[0]);
  assert.equal(scenario.effects.queuedAutoAdvances, 0, 'old media EOF must not skip the newly claimed item');
  assert.equal(scenario.state.currentFile, scenario.items[0].videoPath);
});

test('a hard-invalidated same-file start fences old EOF until replacement media claim', async () => {
  const scenario = createActualLoadRaceScenario({
    continuousMediaEnded: true,
    holdFirstMediaLoad: true,
    holdSecondMediaLoad: true
  });
  scenario.state.currentFile = scenario.items[0].videoPath;
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.firstMediaLoadStarted;
  scenario.continuousPlaybackState.loadingItemId = scenario.items[0].id;
  scenario.continuousPlaybackState.loadingSessionId = 7;
  scenario.runtime.startContinuousTransitionDeadline(scenario.items[0], 7);
  scenario.fireDeadline();

  const started = scenario.runtime.startContinuousPlayback();
  await scenario.secondMediaLoadStarted;
  scenario.runtime.handleEnded();
  scenario.releaseSecondMediaLoad();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  const startResult = await started;

  assert.equal(startResult, scenario.items[0]);
  assert.equal(scenario.effects.queuedAutoAdvances, 0, 'old EOF must not skip the same-path replacement');
  scenario.releaseFirstMediaLoad();
  await oldLoad;
});

test('a null current item start fences old EOF until index zero claims production media', async () => {
  const scenario = createActualLoadRaceScenario({
    continuousMediaEnded: true,
    holdFirstMediaLoad: true
  });
  scenario.continuousPlaybackState.active = false;
  scenario.playlistManager.currentIndex = -1;
  scenario.state.currentFile = scenario.items[1].videoPath;

  const started = scenario.runtime.startContinuousPlayback();
  await scenario.firstMediaLoadStarted;
  scenario.runtime.handleEnded();
  scenario.releaseFirstMediaLoad();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  const startResult = await started;

  assert.equal(startResult, scenario.items[0]);
  assert.equal(scenario.effects.queuedAutoAdvances, 0, 'old EOF must not skip the selected index-zero item');
});

test('an initial already-loaded same-file start leaves genuine EOF navigation live', async () => {
  const scenario = createActualLoadRaceScenario({ continuousMediaEnded: true });
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[0].videoPath;

  assert.equal(await scenario.runtime.startContinuousPlayback(), scenario.items[0]);
  assert.equal(scenario.runtime.getPendingUserVideoLoadIntent(), null);
  scenario.runtime.handleEnded();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.effects.queuedAutoAdvances, 1);
});

test('a failed current start does not hide the next production item EOF', async () => {
  const scenario = createActualLoadRaceScenario({
    holdFirstFileExists: true,
    continuousMediaEnded: true,
    useActualPlayNext: true,
    failFirstContinuousLoad: true
  });
  const normalLoad = scenario.runtime.loadVideoFromPlaylist({
    id: 'normal-b', fileName: 'b.mp4', videoPath: 'C:/clips/b.mp4'
  });
  await scenario.firstFileExistsStarted;

  const started = scenario.runtime.startContinuousPlayback();
  await scenario.oldTailStarted;
  scenario.runtime.handleEnded();
  scenario.releaseOldTail();
  await started;
  const continuousLoadsAfterNextEof = scenario.effects.continuousLoads;

  scenario.releaseFirstFileExists();
  assert.equal(await normalLoad, false);
  assert.equal(continuousLoadsAfterNextEof, 3);
  assert.equal(scenario.effects.mediaLoads.length, 2);
  assert.equal(scenario.runtime.getPendingUserVideoLoadIntent(), null);
  assert.equal(scenario.state.currentFile, scenario.items[0].videoPath);
});

test('a failed current start fences old EOF during the next production preflight', async () => {
  const scenario = createActualLoadRaceScenario({
    holdFirstFileExists: true,
    holdSecondFileExists: true,
    continuousMediaEnded: true,
    useActualPlayNext: true,
    useActualContinuousLoad: true,
    failFirstPreparedItem: true
  });
  const normalLoad = scenario.runtime.loadVideoFromPlaylist({
    id: 'normal-b', fileName: 'b.mp4', videoPath: 'C:/clips/b.mp4'
  });
  await scenario.firstFileExistsStarted;

  const started = scenario.runtime.startContinuousPlayback();
  await scenario.secondFileExistsStarted;
  scenario.runtime.handleEnded();
  scenario.releaseSecondFileExists();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  await started;
  const mediaLoadsAfterNextItem = scenario.effects.mediaLoads.slice();

  scenario.releaseFirstFileExists();
  assert.equal(await normalLoad, false);
  assert.deepEqual(mediaLoadsAfterNextItem, [scenario.items[1].videoPath]);
  assert.equal(scenario.state.currentFile, scenario.items[1].videoPath);
  assert.equal(scenario.runtime.getPendingUserVideoLoadIntent(), null);
});

test('a same-file seek reuses and waits for the current production load completion', async () => {
  const scenario = createActualLoadRaceScenario({ seekItemIndex: 0 });
  scenario.continuousPlaybackState.active = false;
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, { allowMpvPilot: false });
  await scenario.oldTailStarted;
  const tokenBeforeSeek = scenario.runtime.getLatestVideoLoadToken();
  const intentBeforeSeek = scenario.runtime.getIntentGeneration();

  let seekSettled = false;
  const seek = scenario.runtime.seekContinuousTimeline(1, { resumePlayback: false })
    .finally(() => { seekSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  const seekSettledBeforeRelease = seekSettled;
  const tokenDuringSeek = scenario.runtime.getLatestVideoLoadToken();
  const intentDuringSeek = scenario.runtime.getIntentGeneration();

  scenario.releaseOldTail();
  const [loadResult, seekResult] = await Promise.all([oldLoad, seek]);
  assert.equal(seekSettledBeforeRelease, false);
  assert.equal(tokenDuringSeek, tokenBeforeSeek);
  assert.equal(intentDuringSeek, intentBeforeSeek);
  assert.equal(loadResult, true);
  assert.equal(seekResult, true);
});

test('a same-file start gives a failed normal producer retry fresh EOF ownership', async () => {
  const scenario = createActualLoadRaceScenario({
    continuousMediaEnded: true,
    holdFirstMediaLoad: true,
    failFirstMediaLoad: true,
    holdSecondMediaLoad: true
  });
  scenario.continuousPlaybackState.active = false;
  const normalLoad = scenario.runtime.loadVideoFromPlaylist(scenario.items[0], { allowMpvPilot: false });
  await scenario.firstMediaLoadStarted;
  const producerIntent = scenario.runtime.getIntentGeneration();

  const started = scenario.runtime.startContinuousPlayback();
  await new Promise(resolve => setImmediate(resolve));
  scenario.releaseFirstMediaLoad();
  await scenario.secondMediaLoadStarted;
  await new Promise(resolve => setImmediate(resolve));
  const retryIntent = scenario.runtime.getIntentGeneration();
  scenario.runtime.handleEnded();

  scenario.releaseSecondMediaLoad();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  const [normalResult, startResult] = await Promise.all([normalLoad, started]);
  assert.equal(normalResult, false);
  assert.equal(startResult, scenario.items[0]);
  assert.ok(retryIntent > producerIntent, 'a failed producer retry must reserve a new load intent');
  assert.equal(scenario.effects.queuedAutoAdvances, 0, 'old EOF must stay fenced until the retry claims media');
});

test('a same-file seek gives a failed normal producer retry fresh EOF ownership', async () => {
  const scenario = createActualLoadRaceScenario({
    seekItemIndex: 0,
    holdFirstMediaLoad: true,
    failFirstMediaLoad: true,
    holdSecondFileExists: true
  });
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[0].videoPath;
  const normalLoad = scenario.runtime.loadVideoFromPlaylist(scenario.items[0], { allowMpvPilot: false });
  await scenario.firstMediaLoadStarted;
  const producerIntent = scenario.runtime.getIntentGeneration();

  const seek = scenario.runtime.seekContinuousTimeline(1, { resumePlayback: false });
  await new Promise(resolve => setImmediate(resolve));
  scenario.releaseFirstMediaLoad();
  await scenario.secondFileExistsStarted;
  await new Promise(resolve => setImmediate(resolve));
  const retryIntent = scenario.runtime.getIntentGeneration();
  scenario.runtime.handleEnded();
  const autoNextDuringRetry = scenario.effects.normalAutoNext;

  scenario.releaseSecondFileExists();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  const [normalResult, seekResult] = await Promise.all([normalLoad, seek]);
  assert.equal(normalResult, false);
  assert.equal(seekResult, true);
  assert.ok(retryIntent > producerIntent, 'a failed producer retry must reserve a new load intent');
  assert.equal(autoNextDuringRetry, 0, 'old EOF must stay fenced through retry preflight');
});

test('a pre-claim same-file join keeps its ended fence through the old review tail', async () => {
  const scenario = createActualLoadRaceScenario({
    seekItemIndex: 0,
    continuousMediaEnded: true,
    holdFirstMediaLoad: true
  });
  scenario.state.currentFile = scenario.items[0].videoPath;
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.firstMediaLoadStarted;

  const seek = scenario.runtime.seekContinuousTimeline(1);
  await new Promise(resolve => setImmediate(resolve));
  scenario.releaseFirstMediaLoad();
  await scenario.oldTailStarted;
  scenario.runtime.handleEnded();
  scenario.releaseOldTail();
  const [loadResult, seekResult] = await Promise.all([oldLoad, seek]);

  assert.equal(loadResult, true);
  assert.equal(scenario.effects.queuedAutoAdvances, 0);
  assert.equal(seekResult, true);
  assert.equal(scenario.state.currentFile, scenario.items[0].videoPath);
});

test('playlist replacement releases an inactive same-file completion waiter', async () => {
  const scenario = createActualLoadRaceScenario({
    seekItemIndex: 0,
    holdFirstMediaLoad: true
  });
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[0].videoPath;
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, { allowMpvPilot: false });
  await scenario.firstMediaLoadStarted;

  let seekSettled = false;
  const seek = scenario.runtime.seekContinuousTimeline(1, { resumePlayback: false })
    .finally(() => { seekSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  scenario.runtime.commitPlaylistReplacement();
  await new Promise(resolve => setImmediate(resolve));
  const settledBeforeOldIoRelease = seekSettled;
  const pendingBeforeOldIoRelease = scenario.runtime.getPendingUserVideoLoadIntent();

  scenario.releaseFirstMediaLoad();
  const [loadResult, seekResult] = await Promise.all([oldLoad, seek]);
  assert.equal(settledBeforeOldIoRelease, true);
  assert.equal(pendingBeforeOldIoRelease, null);
  assert.equal(loadResult, false);
  assert.equal(seekResult, false);
});

test('a same-file seek reloads a hard-invalidated production completion', async () => {
  const scenario = createActualLoadRaceScenario({ seekItemIndex: 0 });
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.oldTailStarted;
  const oldToken = scenario.runtime.getLatestVideoLoadToken();
  scenario.continuousPlaybackState.loadingItemId = scenario.items[0].id;
  scenario.continuousPlaybackState.loadingSessionId = 7;
  scenario.runtime.startContinuousTransitionDeadline(scenario.items[0], 7);
  scenario.fireDeadline();

  const seekResult = await scenario.runtime.seekContinuousTimeline(1, { resumePlayback: false });
  const replacementToken = scenario.runtime.getLatestVideoLoadToken();
  const mediaLoadsBeforeOldRelease = scenario.effects.mediaLoads.length;
  scenario.releaseOldTail();
  const oldResult = await oldLoad;

  assert.equal(seekResult, true);
  assert.ok(replacementToken > oldToken);
  assert.equal(mediaLoadsBeforeOldRelease, 2);
  assert.equal(oldResult, false);
  assert.equal(scenario.effects.teardowns, 0);
});

test('an invalid production seek does not stale the active media load intent', async () => {
  const scenario = createActualLoadRaceScenario({ invalidSeekMap: true });
  const oldLoad = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    allowMpvPilot: false,
    shouldContinue: () => scenario.continuousPlaybackState.active
  });
  await scenario.oldTailStarted;
  const intentBeforeSeek = scenario.runtime.getIntentGeneration();

  const seekResult = await scenario.runtime.seekContinuousTimeline(-1, { resumePlayback: false });
  const intentAfterSeek = scenario.runtime.getIntentGeneration();
  scenario.releaseOldTail();
  const loadResult = await oldLoad;

  assert.equal(seekResult, false);
  assert.equal(intentAfterSeek, intentBeforeSeek);
  assert.equal(loadResult, true);
});

test('an inactive cross-file seek fences old-media ended autoplay during production preflight', async () => {
  const scenario = createActualLoadRaceScenario({ holdFirstFileExists: true });
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[0].videoPath;

  const navigation = scenario.runtime.seekContinuousTimeline(11, { resumePlayback: false });
  await scenario.firstFileExistsStarted;
  scenario.runtime.handleEnded();
  const autoNextDuringPreflight = scenario.effects.normalAutoNext;

  scenario.releaseFirstFileExists();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  assert.equal(await navigation, true);
  assert.equal(autoNextDuringPreflight, 0);
});

test('an active cross-file seek fences old EOF from queuing a post-load advance', async () => {
  const scenario = createActualLoadRaceScenario({
    holdFirstFileExists: true,
    continuousMediaEnded: true
  });
  scenario.state.currentFile = scenario.items[0].videoPath;

  const navigation = scenario.runtime.seekContinuousTimeline(11);
  await scenario.firstFileExistsStarted;
  scenario.runtime.handleEnded();
  scenario.releaseFirstFileExists();
  await scenario.oldTailStarted;
  scenario.releaseOldTail();
  const navigationResult = await navigation;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(scenario.effects.playAfterLoad, 1);
  assert.equal(scenario.effects.queuedAutoAdvances, 0);
  assert.equal(scenario.state.currentFile, scenario.items[1].videoPath);
  assert.equal(navigationResult, true);
});

test('a pending normal production intent fences the actual ended autoplay callback', () => {
  const endedMatch = appSource.match(/videoPlayer\.addEventListener\('ended', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(endedMatch, 'videoPlayer ended handler should exist');
  let nextCalls = 0;
  const playlistManager = {
    isActive: () => true,
    hasNext: () => true,
    next: () => { nextCalls += 1; return {}; }
  };
  const runtimeFactory = new Function('dependencies', `
    with (dependencies) {
      let pendingUserVideoLoadIntent = 12;
      let videoLoadIntentGeneration = 12;
      let playlistAutoPlayAfterSelection = false;
      const handleEnded = () => {${endedMatch[1]}\n      };
      return {
        handleEnded,
        clearPendingIntent: () => { pendingUserVideoLoadIntent = null; }
      };
    }
  `);
  const runtime = runtimeFactory({
    elements: { btnPlay: { innerHTML: '' }, drawingTools: { classList: { contains: () => false } } },
    playIconSVG: '',
    drawingManager: { setPlaying: () => {} },
    timeline: { setPlayingState: () => {} },
    syncCompositionLayerPlaybackState: () => {},
    videoPlayer: { currentTime: 0 },
    getAudioWaveform: () => ({ setPlaying: () => {} }),
    state: { isDrawMode: false },
    fabricDrawingPilotController: { isActiveOrPreparing: () => false },
    isMpvPilotPlaybackActive: () => false,
    restoreMpvDrawFreezeAfterPlayback: () => {},
    cutlistUIState: { active: false },
    getCutlistManager: () => ({ isActive: () => false }),
    getNextCutlistCut: () => null,
    advanceCutlistPlaybackFromCut: () => {},
    getPlaylistManager: () => playlistManager,
    continuousPlaybackState: { active: false, sessionId: 7 },
    hasContinuousPlaybackReachedMediaEnd: () => false,
    getContinuousPlaybackSnapshot: () => ({}),
    playNextContinuousItem: async () => null,
    isContinuousSessionActive: () => false,
    stopContinuousPlayback: () => {},
    showToast: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    userSettings: { getPlaylistAutoPlay: () => true }
  });

  runtime.handleEnded();
  assert.equal(nextCalls, 0);
  runtime.clearPendingIntent();
  runtime.handleEnded();
  assert.equal(nextCalls, 1);
});

test('a normal production load fences old-media EOF but releases it at the new media claim', async () => {
  const scenario = createActualLoadRaceScenario({ holdFirstFileExists: true });
  scenario.continuousPlaybackState.active = false;
  scenario.state.currentFile = scenario.items[0].videoPath;
  const normalLoad = scenario.runtime.loadVideoFromPlaylist(scenario.items[1], {
    allowMpvPilot: false,
    playWhenMediaReady: true
  });

  await scenario.firstFileExistsStarted;
  scenario.runtime.handleEnded();
  assert.equal(scenario.effects.normalAutoNext, 0, 'old media EOF must stay fenced during preflight');

  scenario.releaseFirstFileExists();
  await scenario.oldTailStarted;
  assert.equal(scenario.state.currentFile, scenario.items[1].videoPath);
  scenario.runtime.handleEnded();
  assert.equal(scenario.effects.normalAutoNext, 1, 'new media EOF must be live after ownership is claimed');

  scenario.releaseOldTail();
  assert.equal(await normalLoad, true);
  assert.equal(scenario.runtime.getPendingUserVideoLoadIntent(), null);
});

test('mpv to HTML5 fallback reuses the top-level intent and finishes without deadlock', async () => {
  const scenario = createActualLoadRaceScenario({ useMpvPilot: true });
  const load = scenario.runtime.loadVideo(scenario.items[0].videoPath, {
    preserveContinuousSession: true,
    playWhenMediaReady: true
  });
  await scenario.oldTailStarted;
  assert.equal(scenario.runtime.getIntentGeneration(), 1);

  scenario.releaseOldTail();
  assert.equal(await load, true);
  assert.equal(scenario.runtime.getIntentGeneration(), 1);
});
