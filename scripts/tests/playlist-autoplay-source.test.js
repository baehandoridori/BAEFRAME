const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const playlistCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/playlist-panel.css'), 'utf8'));

test('normal playlist autoplay plays the selected next item after ended navigation', () => {
  assert.match(appSource, /let playlistAutoPlayAfterSelection = false;/);
  assert.match(appSource, /playlistAutoPlayAfterSelection = true;[\s\S]+playlistManager\.next\(\);/);
  assert.match(appSource, /const shouldAutoPlaySelectedItem = playlistAutoPlayAfterSelection && userSettings\.getPlaylistAutoPlay\(\);/);
  assert.match(appSource, /loadVideoFromPlaylist\(item, \{[\s\S]*?playWhenMediaReady: shouldAutoPlaySelectedItem/);
  assert.match(appSource, /playWhenMediaReady = false/);
  assert.match(appSource, /await playVideoAfterMediaLoad\(\{ silent: true \}\);/);
});

test('playlist autoplay is controlled by the single autoplay toggle', () => {
  assert.doesNotMatch(indexSource, /btnPlaylistContinuousPlay/);
  assert.doesNotMatch(indexSource, /전체 자동재생/);
  assert.match(indexSource, /id="playlistAutoPlay"[\s\S]*?<span class="toggle-label">자동 재생<\/span>/);
  assert.match(indexSource, /id="btnPlaylistClose" title="패널 숨기기"/);
  assert.doesNotMatch(appSource, /btnPlaylistContinuousPlay/);
  assert.doesNotMatch(playlistCss, /playlist-continuous-play/);
});

test('playlist autoplay is a local user setting and not playlist file state', () => {
  assert.match(userSettingsSource, /playlistAutoPlay:\s*false/);
  assert.match(userSettingsSource, /getPlaylistAutoPlay\(\) \{[\s\S]+return this\.settings\.playlistAutoPlay === true;/);
  assert.match(userSettingsSource, /setPlaylistAutoPlay\(enabled\) \{[\s\S]+this\.settings\.playlistAutoPlay = enabled === true;[\s\S]+this\._save\(\);/);
  assert.match(appSource, /userSettings\.getPlaylistAutoPlay\(\)/);
  assert.match(appSource, /userSettings\.setPlaylistAutoPlay\(e\.target\.checked\);/);
  assert.doesNotMatch(appSource, /playlistManager\.getAutoPlay\(\)/);
  assert.doesNotMatch(appSource, /playlistManager\.setAutoPlay\(/);
});

test('playlist panel close hides the panel without clearing the active playlist', () => {
  const closeHandler = appSource.match(/elements\.btnPlaylistClose\?\.[\s\S]*?\n    \}\);/);
  assert.ok(closeHandler, 'playlist close button handler should exist');
  assert.match(closeHandler[0], /hidePlaylistSidebar\(\);/);
  assert.doesNotMatch(closeHandler[0], /playlistManager\.close\(\)/);
});

test('starting playback warms the next autoplay item for button and spacebar playback', () => {
  assert.match(appSource, /function warmPlaylistAutoPlayQueue\(\) \{[\s\S]*?playlistManager\.isActive\(\)[\s\S]*?userSettings\.getPlaylistAutoPlay\(\)[\s\S]*?preloadNextPlaylistMedia\(\);[\s\S]*?\}/);
  assert.match(appSource, /function shouldStartPlaylistContinuousAutoPlayback\(\) \{[\s\S]*?playlistUIState\.mode === 'continuous'[\s\S]*?userSettings\.getPlaylistAutoPlay\(\)[\s\S]*?\}/);
  assert.match(appSource, /async function handleUserPlayPauseToggle\(\) \{[\s\S]*?const startedItem = await startContinuousPlayback\(\);[\s\S]*?broadcastPlaylistContinuousPlaybackPlay\(startedItem, videoPlayer\.currentTime\);[\s\S]*?warmPlaylistAutoPlayQueue\(\);[\s\S]*?\}/);
  assert.doesNotMatch(appSource, /void startContinuousPlayback\(\);[\s\S]*?broadcastCurrentPlaybackPlay\(\);/);

  assert.match(appSource, /elements\.btnPlay\.addEventListener\('click', handleUserPlayPauseToggle\);/);

  assert.match(appSource, /const isPlayPauseShortcut = userSettings\.matchShortcut\('playPause', e\);/);
  const shortcutHandler = appSource.match(/if \(isPlayPauseShortcut\) \{([\s\S]*?)\n      return;/);
  assert.ok(shortcutHandler, 'play/pause shortcut handler should exist');
  assert.match(shortcutHandler[1], /handleUserPlayPauseToggle\(\);/);
});

test('continuous playlist playback starts immediately before falling back to readiness waits', () => {
  const watchdogMatch = appSource.match(/async function playContinuousItemWithWatchdog\(item, sessionId\) \{([\s\S]*?)\n  \}\n\n  async function startContinuousPlayback/);
  assert.ok(watchdogMatch, 'continuous playback watchdog should exist');
  const watchdogSource = watchdogMatch[1];
  assert.match(watchdogSource, /let started = videoPlayer\.isPlaying === true;/);
  assert.match(watchdogSource, /if \(!started\) \{[\s\S]+started = await videoPlayer\.play\(\);[\s\S]+\}/);
  assert.ok(
    watchdogSource.indexOf('started = await videoPlayer.play();') <
      watchdogSource.indexOf('await waitForContinuousMediaReady(250);'),
    'play should be attempted before waiting for canplay/loadeddata'
  );
});

test('playlist row progress loads in parallel before rendering rows', () => {
  const renderMatch = appSource.match(/async function renderPlaylistItems\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ 현재 아이템 하이라이트/);
  assert.ok(renderMatch, 'playlist item renderer should exist');
  const renderSource = renderMatch[1];

  assert.match(renderSource, /const progressById = new Map\(await Promise\.all\(items\.map\(async item =>/);
  assert.ok(
    renderSource.indexOf('const progressById = new Map') <
      renderSource.indexOf('for (let i = 0; i < items.length; i++)'),
    'all progress reads should start before row DOM creation'
  );
  assert.doesNotMatch(renderSource, /const progress = await playlistManager\.getItemProgress\(item\.bframePath\);/);
});

test('playlist add and drop paths accept saved bplaylist files', () => {
  assert.match(appSource, /name: '지원 파일'/);
  assert.match(appSource, /extensions: \[\.\.\.SUPPORTED_MEDIA_EXTENSIONS, SUPPORTED_PLAYLIST_EXTENSION\]/);
  assert.match(appSource, /BAEFRAME 재생목록/);
  assert.match(appSource, /extensions: \[SUPPORTED_PLAYLIST_EXTENSION\]/);
  assert.match(appSource, /const playlistPath = result\.filePaths\.find\(isPlaylistFilePath\);/);
  assert.match(appSource, /await openPlaylistFile\(playlistPath\);/);
  assert.match(appSource, /files\.find\(f => isPlaylistFilePath\(f\.path \|\| f\.name\)\)\?\.path/);
});

test('continuous playlist timeline renders joined video blocks on the video track', () => {
  assert.match(indexSource, /class="track-row video-track-row"/);
  assert.match(timelineSource, /querySelectorAll\('\.playlist-segment-boundary, \.playlist-segment-block'\)/);
  assert.match(timelineSource, /querySelector\('\.video-track-row'\)/);
  assert.match(timelineSource, /playlist-segment-block/);
  assert.match(timelineSource, /videoTrackRow\.classList\.toggle\('has-playlist-segments'/);
  assert.match(playlistCss, /\.playlist-segment-block\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(playlistCss, /\.video-track-row\.has-playlist-segments\s+\.track-clip\.video/);
});
