const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const mainIpc = fs.readFileSync(path.join(rootDir, 'main/ipc-handlers.js'), 'utf-8');
const preload = fs.readFileSync(path.join(rootDir, 'preload/preload.js'), 'utf-8');
const mainIndex = fs.readFileSync(path.join(rootDir, 'main/index.js'), 'utf-8');
const rendererIndex = fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf-8');
const appSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf-8');
const timelineSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf-8');
const mainStyles = fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const launchRouting = require(path.join(rootDir, 'main/launch-routing'));
const cutlistPaths = require(path.join(rootDir, 'main/cutlist-paths'));

function extractBalancedBlock(source, startNeedle) {
  const startIndex = source.indexOf(startNeedle);
  assert.notEqual(startIndex, -1, `Missing source section: ${startNeedle}`);

  const blockStart = source.indexOf('{', startIndex);
  assert.notEqual(blockStart, -1, `Missing block start for: ${startNeedle}`);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(blockStart + 1, index);
      }
    }
  }

  assert.fail(`Missing block end for: ${startNeedle}`);
}

test('main process exposes cutlist file handlers', () => {
  assert.match(mainIpc, /cutlist:read/);
  assert.match(mainIpc, /cutlist:write/);
  assert.match(mainIpc, /cutlist:read-info-text/);
  assert.match(mainIpc, /cutlist:generate-link/);
});

test('preload exposes cutlist renderer API', () => {
  assert.match(preload, /readCutlist/);
  assert.match(preload, /writeCutlist/);
  assert.match(preload, /readCutlistInfoText/);
  assert.match(preload, /onOpenCutlist/);
});

test('main process recognizes bcutlist launch inputs', () => {
  assert.match(mainIndex, /\.bcutlist/);
  assert.match(mainIndex, /open-cutlist/);
  assert.match(mainIndex, /baeframe:\/\/cutlist/);
});

test('renderer has cutlist DOM hooks', () => {
  assert.match(rendererIndex, /btnCutlist/);
  assert.match(rendererIndex, /btnCutlistPrimaryAdd/);
  assert.match(rendererIndex, /btnCutlistCopyLink/);
  assert.match(rendererIndex, /영상 \+ info txt 쌍 추가/);
  assert.match(rendererIndex, /cutlistSidebar/);
  assert.match(rendererIndex, /currentCutOverlay/);
});

test('renderer initializes cutlist feature', () => {
  assert.match(appSource, /initCutlistFeature/);
  assert.match(appSource, /openCutlistFile/);
  assert.match(appSource, /btnCutlistCopyLink/);
  assert.match(appSource, /btnCutlistPrimaryAdd/);
  assert.match(appSource, /btnCutlistPrimaryAdd\?\.addEventListener\('click'[\s\S]*handleCutlistAddClick\(\)/);
  assert.match(appSource, /addCutlistSourcePair/);
});

test('cutlist video picker asks for the video matching the selected info file', () => {
  const sourcePairBody = extractBalancedBlock(appSource, 'async function addCutlistSourcePair');

  assert.match(appSource, /function getDialogFileName\(filePath\)/);
  assert.match(sourcePairBody, /const infoFileNameForDialog = getDialogFileName\(txtResult\.filePaths\[0\]\);/);
  assert.match(sourcePairBody, /title:\s*`\$\{infoFileNameForDialog\} 이름의 영상을 찾아주세요`/);
  assert.ok(
    sourcePairBody.indexOf('const infoFileNameForDialog') <
      sourcePairBody.indexOf('const videoResult'),
    'video picker title should be derived after the info file is selected'
  );
});

test('cutlist copy link saves then copies a shareable bcutlist path', () => {
  const listenerBody = extractBalancedBlock(appSource, "elements.btnCutlistCopyLink?.addEventListener('click'");

  assert.match(listenerBody, /await saveCurrentCutlist\(\)/);
  assert.ok(listenerBody.includes("replace(/\\//g, '\\\\')"));
  assert.match(listenerBody, /const clipboardContent = `\$\{windowsPath\}\\n\\n\$\{fileName\}`/);
  assert.match(listenerBody, /copyToClipboard\(clipboardContent\)/);
  assert.match(listenerBody, /Slack에서 Ctrl\+Shift\+V/);
});

test('cutlist source missing rows show a visible file status', () => {
  const renderBody = extractBalancedBlock(appSource, 'function renderCutlistItems');

  assert.match(renderBody, /sourceMissing/);
  assert.match(renderBody, /cutlist-item-status/);
  assert.match(renderBody, /파일 없음/);
});

test('package exposes a full cutlist test script', () => {
  const script = packageJson.scripts?.['test:cutlist'] || '';

  assert.match(script, /cutlist-manager\.test\.js/);
  assert.match(script, /cutlist-schema\.test\.js/);
  assert.match(script, /moho-scene-info-parser\.test\.js/);
  assert.match(script, /cutlist-core\.test\.js/);
  assert.match(script, /cutlist-runtime-source\.test\.js/);
  assert.match(script, /cutlist-comment-index\.test\.js/);
});

test('timeline can render cutlist segments', () => {
  assert.match(timelineSource, /setCutlistTimeline\(segments, totalDuration\)/);
  assert.match(timelineSource, /setCurrentCutId\(cutId\)/);
  assert.match(timelineSource, /cutlist-segment-block/);
  assert.match(timelineSource, /has-cutlist-segments/);
  assert.match(timelineSource, /this\._emit\('cutlist-seek', \{\s*cutId/);
});

test('timeline uses cutlist duration for shared timeline math', () => {
  const durationBody = extractBalancedBlock(timelineSource, '_getTimelineDuration()');

  assert.match(durationBody, /this\.playlistDuration \|\| this\.cutlistDuration \|\| this\.duration/);
  assert.match(timelineSource, /this\.cutlistTotalFrames = 0/);
  assert.match(timelineSource, /_getTimelineTotalFrames\(\)/);
  assert.match(timelineSource, /this\.cutlistDuration \? \(this\.cutlistTotalFrames \|\| this\.totalFrames\) : this\.totalFrames/);
});

test('renderer wires cutlist playback and comment integration', () => {
  assert.match(appSource, /cutlist-comment-index\.js/);
  assert.match(appSource, /findCurrentCut/);
  assert.match(appSource, /mapGlobalTimeToCut/);
  assert.match(appSource, /timeline\.addEventListener\('cutlist-seek'/);
  assert.match(appSource, /function updateCutlistTimeline\(\)[\s\S]*timeline\.setCutlistTimeline/);
  assert.match(appSource, /async function seekToCut\(cut\)[\s\S]*loadVideo/);
  assert.match(appSource, /function refreshCurrentCutFromPlayback/);
  assert.match(appSource, /function ensureCutlistCommentTargetReady/);
});

test('generic timeline seeking routes through cutlist global time when cutlist is active', () => {
  const listenerBody = extractBalancedBlock(appSource, "timeline.addEventListener('seek'");

  assert.match(listenerBody, /timeline\.cutlistDuration > 0/);
  assert.match(listenerBody, /await seekCutlistTimeline\(e\.detail\.time\)/);
  assert.ok(
    listenerBody.indexOf('await seekCutlistTimeline(e.detail.time)') <
      listenerBody.indexOf('videoPlayer.seek(e.detail.time)'),
    'cutlist seek branch should run before raw media seek'
  );
});

test('cutlist playback uses global cutlist timeline time for playhead', () => {
  assert.match(appSource, /function getCutlistTimelinePlaybackTime/);
  assert.match(appSource, /function getActiveTimelinePlaybackTime/);
  assert.match(appSource, /timeline\.setCurrentTime\(getActiveTimelinePlaybackTime\(currentTime,\s*currentFrame\)\)/);
  assert.match(appSource, /timeline\.setCurrentTime\(getActiveTimelinePlaybackTime\(time,\s*frame\)\)/);

  const seekStartBody = extractBalancedBlock(appSource, 'async function seekPlaybackToCutStart');
  assert.match(seekStartBody, /await seekCutlistTimeline\(segment\.globalStartTime\)/);
  assert.doesNotMatch(seekStartBody, /timeline\.setCurrentTime\(frame \/ fps\)/);
});

test('cutlist playback advances to the next ordered cut instead of the next cut in the same source', () => {
  const timeUpdateBody = extractBalancedBlock(appSource, "videoPlayer.addEventListener('timeupdate'");
  const frameUpdateBody = extractBalancedBlock(appSource, "videoPlayer.addEventListener('frameUpdate'");
  const endedBody = extractBalancedBlock(appSource, "videoPlayer.addEventListener('ended'");
  const refreshBody = extractBalancedBlock(appSource, 'function refreshCurrentCutFromPlayback');
  const advanceBody = extractBalancedBlock(appSource, 'async function advanceCutlistPlaybackFromCut');

  assert.match(appSource, /function getNextCutlistCut\(cut\)/);
  assert.match(appSource, /async function handleCutlistPlaybackFrame\(frame/);
  assert.match(timeUpdateBody, /handleCutlistPlaybackFrame\(currentFrame\)/);
  assert.match(frameUpdateBody, /handleCutlistPlaybackFrame\(frame\)/);
  assert.match(endedBody, /advanceCutlistPlaybackFromCut\(currentCut\)/);
  assert.match(advanceBody, /getNextCutlistCut\(cut\)/);
  assert.match(advanceBody, /await seekPlaybackToCutStart\(nextCut\)/);
  assert.match(advanceBody, /await videoPlayer\.play\(\)/);
  assert.match(refreshBody, /isCutlistPlaybackLockedToSelectedCut\(\)/);
  assert.match(refreshBody, /currentCut/);
});

test('cutlist source switches reveal new video only after the target cut frame is ready', () => {
  const mappedSeekBody = extractBalancedBlock(appSource, 'async function seekCutlistMappedPosition');
  const seekToCutBody = extractBalancedBlock(appSource, 'async function seekToCut');
  const commentReadyBody = extractBalancedBlock(appSource, 'async function ensureCutlistCommentTargetReady');

  assert.match(appSource, /initialFrame = null/);
  assert.match(appSource, /revealAfterInitialSeek = false/);
  assert.match(appSource, /async function seekInitialVideoFrameBeforeReveal\(initialFrame\)/);
  assert.match(appSource, /elements\.videoPlayer\.style\.visibility = 'hidden'/);
  assert.match(appSource, /await seekInitialVideoFrameBeforeReveal\(initialFrame\)/);

  const frameIndex = mappedSeekBody.indexOf('const frame = Math.max');
  const loadIndex = mappedSeekBody.indexOf('await loadVideo(source.videoPath, {');
  assert.notEqual(frameIndex, -1, 'cutlist seek should resolve the target source frame');
  assert.notEqual(loadIndex, -1, 'cutlist seek should pass initial frame options into loadVideo');
  assert.ok(frameIndex < loadIndex, 'target frame should be known before a new source video is revealed');
  assert.match(mappedSeekBody, /loadVideo\(source\.videoPath,\s*\{[\s\S]*initialFrame:\s*frame[\s\S]*revealAfterInitialSeek:\s*true[\s\S]*holdPreviousFrameUntilReady:\s*true[\s\S]*\}\)/);
  assert.match(seekToCutBody, /loadVideo\(source\.videoPath,\s*\{[\s\S]*initialFrame:\s*Number\(cut\.startFrame\)[\s\S]*revealAfterInitialSeek:\s*true[\s\S]*holdPreviousFrameUntilReady:\s*true[\s\S]*\}\)/);
  assert.match(commentReadyBody, /loadVideo\(source\.videoPath,\s*\{[\s\S]*initialFrame:\s*Number\(cut\.startFrame\)[\s\S]*revealAfterInitialSeek:\s*true[\s\S]*holdPreviousFrameUntilReady:\s*true[\s\S]*\}\)/);
});

test('cutlist source switches defer collaboration startup until after the target cut is shown', () => {
  const mappedSeekBody = extractBalancedBlock(appSource, 'async function seekCutlistMappedPosition');
  const seekToCutBody = extractBalancedBlock(appSource, 'async function seekToCut');
  const commentReadyBody = extractBalancedBlock(appSource, 'async function ensureCutlistCommentTargetReady');

  assert.match(appSource, /async function startCollaborationForVideoLoad\(loadToken, bframePath\)/);
  assert.match(appSource, /function scheduleDeferredCollaborationStart\(loadToken, bframePath\)/);
  assert.match(mappedSeekBody, /loadVideo\(source\.videoPath,\s*\{[\s\S]*deferCollaborationStart:\s*true[\s\S]*\}\)/);
  assert.match(seekToCutBody, /loadVideo\(source\.videoPath,\s*\{[\s\S]*deferCollaborationStart:\s*true[\s\S]*\}\)/);
  assert.match(commentReadyBody, /loadVideo\(source\.videoPath,\s*\{[\s\S]*deferCollaborationStart:\s*true[\s\S]*\}\)/);
});

test('cutlist hidden source switches hold the previous frame instead of flashing black', () => {
  assert.match(appSource, /let videoTransitionFreezeCanvas = null/);
  assert.match(appSource, /function captureVideoTransitionFreezeFrame\(\)/);
  assert.match(appSource, /function releaseVideoTransitionFreezeFrame\(wasCaptured\)/);
  assert.match(appSource, /drawImage\(video,\s*0,\s*0,\s*canvas\.width,\s*canvas\.height\)/);
  assert.match(appSource, /const shouldHoldVideoReveal = holdPreviousFrameUntilReady \|\| shouldDelayVideoReveal/);
  assert.match(appSource, /const transitionFreezeCaptured = shouldHoldVideoReveal && captureVideoTransitionFreezeFrame\(\)/);
  assert.match(appSource, /const shouldHideVideoDuringLoad = shouldDelayVideoReveal \|\| transitionFreezeCaptured/);
  assert.match(appSource, /releaseVideoTransitionFreezeFrame\(transitionFreezeCaptured\)/);
  assert.match(mainStyles, /\.video-transition-freeze-canvas/);
  assert.match(mainStyles, /z-index:\s*1/);
  assert.match(mainStyles, /pointer-events:\s*none/);
});

test('cutlist playback preloads the next source cut to reduce visible transition delay', () => {
  const setCurrentBody = extractBalancedBlock(appSource, 'function setCutlistCurrentCut');
  const hideBody = extractBalancedBlock(appSource, 'function hideCutlistSidebar');

  assert.match(appSource, /const cutlistMediaPreload = \{/);
  assert.match(appSource, /function ensureCutlistPreloadElement\(\)/);
  assert.match(appSource, /function clearCutlistMediaPreload\(\)/);
  assert.match(appSource, /function preloadNextCutlistMedia\(cut\)/);
  assert.match(appSource, /media\.preload = 'auto'/);
  assert.match(appSource, /media\.currentTime = targetTime/);
  assert.match(setCurrentBody, /preloadNextCutlistMedia\(cut\)/);
  assert.match(hideBody, /clearCutlistMediaPreload\(\)/);
});

test('cutlist timeline comment markers use global display time but keep source click frame', () => {
  const updateMarkersBody = extractBalancedBlock(appSource, 'function updateTimelineMarkers');
  const mapRangesBody = extractBalancedBlock(appSource, 'function mapCutlistCommentRangesToTimeline');

  assert.match(updateMarkersBody, /cutlistAggregateCommentRanges/);
  assert.match(updateMarkersBody, /const markerFrame = Number\(range\.startFrame\)/);
  assert.doesNotMatch(updateMarkersBody, /range\.globalStartFrame/);
  assert.match(mapRangesBody, /sourceStartFrame:\s*range\.startFrame/);
  assert.match(updateMarkersBody, /markersAtFrame\[0\]\?\.sourceStartFrame/);
  assert.match(updateMarkersBody, /const time = cutlistUIState\.active/);
  assert.match(updateMarkersBody, /markersAtFrame\[0\]\?\.globalStartTime/);
});

test('cutlist mode aggregates comments from every source bframe for the joined timeline', () => {
  const refreshMatch = appSource.match(/async function refreshCommentRangesForCurrentMode\(options = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(refreshMatch, 'refreshCommentRangesForCurrentMode should exist');
  const refreshBody = refreshMatch[1];
  const updateListBody = extractBalancedBlock(appSource, 'function updateCommentListImmediate');
  const renderRangesBody = extractBalancedBlock(appSource, 'function renderCommentRanges');
  const updateMarkersBody = extractBalancedBlock(appSource, 'function updateTimelineMarkers');
  const interactionBody = extractBalancedBlock(appSource, 'function setupCommentRangeInteractions');

  assert.match(appSource, /getBframePath/);
  assert.match(appSource, /extractCutlistCommentRanges/);
  assert.match(appSource, /let cutlistAggregateCommentRanges = \[\]/);
  assert.match(appSource, /async function updateCutlistAggregateComments\(\)/);
  assert.match(appSource, /function renderCutlistAggregateCommentList/);
  assert.match(appSource, /async function openCutlistAggregateComment/);
  assert.match(refreshBody, /await updateCutlistAggregateComments\(\)/);
  assert.match(updateListBody, /renderCutlistAggregateCommentList\(filter\)/);
  assert.match(renderRangesBody, /cutlistAggregateCommentRanges/);
  assert.match(updateMarkersBody, /cutlistAggregateCommentRanges/);
  assert.match(interactionBody, /item\.dataset\.cutlistAggregateCommentKey/);
  assert.match(timelineSource, /dataset\.cutlistAggregateCommentKey/);
});

test('clustered comment markers use active timeline duration', () => {
  const renderMarkersBody = extractBalancedBlock(timelineSource, 'renderClusteredCommentMarkers(allMarkerData)');
  const addMarkerBody = extractBalancedBlock(timelineSource, '_addClusteredMarker(time, resolved, frame, markerInfos, clusterCount, colorKey = ');

  assert.match(renderMarkersBody, /const duration = this\._getTimelineDuration\(\)/);
  assert.match(renderMarkersBody, /markerData\.time \/ duration/);
  assert.doesNotMatch(renderMarkersBody, /this\.duration === 0/);
  assert.match(addMarkerBody, /const duration = this\._getTimelineDuration\(\)/);
  assert.match(addMarkerBody, /time \/ duration/);
  assert.doesNotMatch(addMarkerBody, /time \/ this\.duration/);
});

test('timeline cutlist segment clicks route through cutlist manager selection', () => {
  const listenerBody = extractBalancedBlock(appSource, "timeline.addEventListener('cutlist-seek'");

  assert.match(listenerBody, /getCutlistManager\(\)\.selectCut\(e\.detail\.cutId\)/);
  assert.doesNotMatch(listenerBody, /seekToCut\(/);
  assert.doesNotMatch(listenerBody, /getCutById\(e\.detail\.cutId\)/);
});

test('comment target readiness loads the selected cut source, not any loaded cutlist source', () => {
  const functionBody = extractBalancedBlock(appSource, 'async function ensureCutlistCommentTargetReady');

  assert.match(functionBody, /cutlistManager\.getCutById\(cutlistManager\.currentCutId\)/);
  assert.match(functionBody, /resolveCutlistSourceForPlayback\(cut\)/);
  assert.match(functionBody, /isSameFilePath\(state\.currentFile,\s*source\.videoPath\)/);
  assert.match(functionBody, /loadVideo\(source\.videoPath,\s*\{/);
  assert.doesNotMatch(functionBody, /getCurrentCutlistSourceForFile\(state\.currentFile\)\)\s*return true/);
  assert.doesNotMatch(functionBody, /getOrderedCuts\(\)\[0\]/);
});

test('opening cutlist mode exits playlist continuous state before cutlist timeline renders', () => {
  const helperBody = extractBalancedBlock(appSource, 'function exitPlaylistContinuousModeForCutlist');
  const showBody = extractBalancedBlock(appSource, 'function showCutlistSidebar');

  assert.match(helperBody, /setPlaylistMode\('review'\)/);
  assert.match(helperBody, /playlistAggregateCommentRanges = \[\]/);
  assert.match(helperBody, /timeline\.setPlaylistTimeline\(\[\], 0\)/);

  const exitIndex = showBody.indexOf('exitPlaylistContinuousModeForCutlist()');
  const updateIndex = showBody.indexOf('updateCutlistTimeline()');
  assert.notEqual(exitIndex, -1, 'cutlist mode should leave continuous playlist mode');
  assert.ok(exitIndex < updateIndex, 'playlist continuous state should clear before cutlist timeline renders');
});

test('cutlist sidebar transitions refresh comment labels and ranges', () => {
  const showBody = extractBalancedBlock(appSource, 'function showCutlistSidebar');
  const hideBody = extractBalancedBlock(appSource, 'function hideCutlistSidebar');

  assert.match(showBody, /cutlistUIState\.active = true;[\s\S]+refreshCommentRangesForCurrentMode\(\)/);
  assert.match(showBody, /cutlistUIState\.active = true;[\s\S]+updateCommentList\(getActiveCommentFilter\(\)\)/);
  assert.match(hideBody, /cutlistUIState\.active = false;[\s\S]+refreshCommentRangesForCurrentMode\(\)/);
  assert.match(hideBody, /cutlistUIState\.active = false;[\s\S]+updateCommentList\(getActiveCommentFilter\(\)\)/);
});

test('showing cutlist sidebar re-syncs current cut from playback frame', () => {
  const showBody = extractBalancedBlock(appSource, 'function showCutlistSidebar');

  const activeIndex = showBody.indexOf('cutlistUIState.active = true;');
  const refreshIndex = showBody.indexOf('refreshCurrentCutFromPlayback(videoPlayer.currentFrame)');
  const displayIndex = showBody.indexOf('updateCurrentCutDisplay(currentCut)');

  assert.notEqual(refreshIndex, -1, 'cutlist sidebar should recompute the selected cut from playback');
  assert.ok(activeIndex < refreshIndex, 'cutlist mode must be active before recomputing from playback');
  assert.ok(refreshIndex < displayIndex, 'overlay should use the recomputed current cut');
  assert.doesNotMatch(showBody, /getCutById\(getCutlistManager\(\)\.currentCutId\)/);
});

test('comment target readiness realigns stale same-file cut selection', () => {
  const functionBody = extractBalancedBlock(appSource, 'async function ensureCutlistCommentTargetReady');

  assert.doesNotMatch(functionBody, /if \(isSameFilePath\(state\.currentFile,\s*source\.videoPath\)\) return true;/);
  assert.match(functionBody, /isFrameInsideCut\(cut,\s*videoPlayer\.currentFrame\)/);
  assert.match(functionBody, /await seekPlaybackToCutStart\(cut\)/);
});

test('cutlist comment tooltip uses attribute-safe escaping', () => {
  assert.match(appSource, /function escapeHtmlAttribute\(text\)/);
  assert.match(appSource, /replace\(/);
  assert.match(appSource, /&quot;/);
  assert.match(appSource, /&#39;/);
  assert.match(appSource, /commentPanelLine \? ` title="\$\{escapeHtmlAttribute\(commentPanelLine\)\}"` : ''/);
  assert.doesNotMatch(appSource, /commentPanelLine \? ` title="\$\{escapeHtml\(commentPanelLine\)\}"` : ''/);
});

test('cutlist route URLs preserve or recover Windows drive paths', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist/G:/dir/file.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist/G/dir/file.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );
});

test('cutlist query route decodes only the file value', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist?file=G%3A%5Cdir%5Cfile.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist?file=G%3A%5Cdir%5Cfile.bcutlist&x=1', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );
});

test('cutlist query route preserves literal percent characters in the file path', () => {
  const encodedPath = encodeURIComponent('G:\\dir\\100% done\\file.bcutlist');

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://cutlist?file=${encodedPath}`, 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\100% done\\file.bcutlist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://cutlist/?file=${encodedPath}`, 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\100% done\\file.bcutlist' }
  );
});

test('cutlist route with slash before query decodes the file value', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://cutlist/?file=G%3A%5Cdir%5Cfile.bcutlist', 'cutlist'),
    { route: 'cutlist', filePath: 'G:\\dir\\file.bcutlist' }
  );
});

test('playlist query route preserves literal percent characters in the file path', () => {
  const encodedPath = encodeURIComponent('G:\\dir\\100% done\\file.bplaylist');

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://playlist?file=${encodedPath}`, 'playlist'),
    { route: 'playlist', filePath: 'G:\\dir\\100% done\\file.bplaylist' }
  );

  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl(`baeframe://playlist/?file=${encodedPath}`, 'playlist'),
    { route: 'playlist', filePath: 'G:\\dir\\100% done\\file.bplaylist' }
  );
});

test('playlist route with slash before query decodes the file value', () => {
  assert.deepEqual(
    launchRouting.resolveRoutedFileUrl('baeframe://playlist/?file=G%3A%5Cdir%5Cfile.bplaylist', 'playlist'),
    { route: 'playlist', filePath: 'G:\\dir\\file.bplaylist' }
  );
});

test('malformed cutlist route URL does not throw or resolve', () => {
  assert.doesNotThrow(() => {
    assert.deepEqual(
      launchRouting.resolveRoutedFileUrl('baeframe://cutlist?file=G%ZZbad.bcutlist', 'cutlist'),
      { route: '', filePath: '' }
    );
  });
});

test('launch arguments classify cutlist and existing file types', () => {
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\file.bcutlist'), 'cutlist');
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\clip.mp4'), 'video');
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\project.bframe'), 'project');
  assert.equal(launchRouting.classifyLaunchArgument('C:\\dir\\playlist.bplaylist'), 'playlist');
});

test('cutlist IPC path validation only allows bcutlist files', () => {
  assert.equal(cutlistPaths.validateCutlistFilePath('C:/dir/file.bcutlist'), 'C:\\dir\\file.bcutlist');
  assert.throws(() => cutlistPaths.validateCutlistFilePath('C:/dir/file.json'), /bcutlist/);
  assert.throws(() => cutlistPaths.validateCutlistFilePath('C:/dir/file.bframe'), /bcutlist/);
  assert.throws(() => cutlistPaths.validateCutlistFilePath('C:/dir/file.mp4'), /bcutlist/);
});
