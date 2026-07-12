const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainStyles = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const videoPlayerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/video-player.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const preloadSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'preload/preload.js'), 'utf8'));
const ipcSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/ipc-handlers.js'), 'utf8'));
const mainIndexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/index.js'), 'utf8'));
const mpvManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'main/mpv-manager.js'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

function loadMpvOverlayLifecycleFactory() {
  const functionStart = appSource.indexOf('function createMpvOverlayLifecycle(');
  assert.notEqual(functionStart, -1, 'mpv overlay lifecycle factory should exist');

  const bodyStart = appSource.indexOf(') {', functionStart) + 2;
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}') depth -= 1;
    if (depth === 0) {
      const functionSource = appSource.slice(functionStart, index + 1);
      return new Function(`return (${functionSource});`)();
    }
  }

  assert.fail('mpv overlay lifecycle factory should have a complete body');
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('mpv overlay lifecycle ignores stale prepare and sync completions', async () => {
  const createMpvOverlayLifecycle = loadMpvOverlayLifecycleFactory();
  const warnings = [];
  const prepareLifecycle = createMpvOverlayLifecycle({
    onWarning: (error) => warnings.push(error)
  });

  const stalePrepare = createDeferred();
  const ownerA = prepareLifecycle.begin('load-a');
  const finishPrepareA = (async () => {
    await stalePrepare.promise;
    prepareLifecycle.invalidate(ownerA);
    prepareLifecycle.markReady(ownerA);
  })();

  const ownerB = prepareLifecycle.begin('load-b');
  assert.equal(prepareLifecycle.markReady(ownerB), true);

  stalePrepare.resolve();
  await finishPrepareA;

  assert.equal(prepareLifecycle.isReady(ownerB), true);

  const syncLifecycle = createMpvOverlayLifecycle({
    onWarning: (error) => warnings.push(error)
  });
  const syncOwnerA = syncLifecycle.begin('sync-load-a');
  assert.equal(syncLifecycle.markReady(syncOwnerA), true);
  const staleSync = createDeferred();
  const finishSyncA = (async () => {
    const capturedOwner = syncLifecycle.captureReadyOwner();
    const result = await staleSync.promise;
    if (!result.success) syncLifecycle.markUnavailable(capturedOwner, result.error);
  })();

  const syncOwnerB = syncLifecycle.begin('sync-load-b');
  assert.equal(syncLifecycle.markReady(syncOwnerB), true);
  staleSync.resolve({ success: false, error: 'stale-a-failure' });
  await finishSyncA;

  assert.equal(syncLifecycle.isReady(syncOwnerB), true);
  assert.equal(warnings.length, 0);
});

test('mpv overlay lifecycle clears and warns once for a current-generation failure', () => {
  const createMpvOverlayLifecycle = loadMpvOverlayLifecycleFactory();
  const warnings = [];
  const lifecycle = createMpvOverlayLifecycle({
    onWarning: (error) => warnings.push(error)
  });

  const owner = lifecycle.begin('load-current');
  assert.equal(lifecycle.markReady(owner), true);
  assert.equal(lifecycle.markUnavailable(owner, 'first-failure'), true);
  assert.equal(lifecycle.markUnavailable(owner, 'second-failure'), true);

  assert.equal(lifecycle.isReady(owner), false);
  assert.deepEqual(warnings, ['first-failure']);
});

test('package exposes an mpv pilot test command', () => {
  assert.equal(
    packageJson.scripts['test:mpv'],
    'node --test scripts/tests/mpv-manager.test.js scripts/tests/mpv-embed-host.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-recovery-source.test.js'
  );
});

test('preload exposes a narrow mpv API surface', () => {
  assert.match(preloadSource, /mpvIsEnabled: \(\) => ipcRenderer\.invoke\('mpv:is-enabled'\)/);
  assert.match(preloadSource, /mpvIsAvailable: \(\) => ipcRenderer\.invoke\('mpv:is-available'\)/);
  assert.match(preloadSource, /mpvLoad: \(filePath, options\) => ipcRenderer\.invoke\('mpv:load', filePath, options\)/);
  assert.match(preloadSource, /mpvProbeMetadata: \(filePath\) => ipcRenderer\.invoke\('mpv:probe-metadata', filePath\)/);
  assert.match(preloadSource, /mpvPlay: \(\) => ipcRenderer\.invoke\('mpv:play'\)/);
  assert.match(preloadSource, /mpvPause: \(\) => ipcRenderer\.invoke\('mpv:pause'\)/);
  assert.match(preloadSource, /mpvSeek: \(time\) => ipcRenderer\.invoke\('mpv:seek', time\)/);
  assert.match(preloadSource, /mpvSetVolume: \(volume\) => ipcRenderer\.invoke\('mpv:set-volume', volume\)/);
  assert.match(preloadSource, /mpvSetMuted: \(muted\) => ipcRenderer\.invoke\('mpv:set-muted', muted\)/);
  assert.match(preloadSource, /mpvSetVideoTransform: \(transform\) => ipcRenderer\.invoke\('mpv:set-video-transform', transform\)/);
  assert.match(preloadSource, /mpvGetStatus: \(\) => ipcRenderer\.invoke\('mpv:get-status'\)/);
  assert.match(preloadSource, /mpvScreenshot: \(\) => ipcRenderer\.invoke\('mpv:screenshot'\)/);
  assert.match(preloadSource, /mpvStop: \(\) => ipcRenderer\.invoke\('mpv:stop'\)/);
  assert.match(preloadSource, /mpvPrepareEmbed: \(bounds\) => ipcRenderer\.invoke\('mpv:prepare-embed', bounds\)/);
  assert.match(preloadSource, /mpvUpdateEmbedBounds: \(bounds\) => ipcRenderer\.invoke\('mpv:update-embed-bounds', bounds\)/);
  assert.match(preloadSource, /mpvSetHostVisible: \(visible\) => ipcRenderer\.invoke\('mpv:set-host-visible', visible\)/);
  assert.match(preloadSource, /mpvDestroyEmbed: \(\) => ipcRenderer\.invoke\('mpv:destroy-embed'\)/);
  assert.match(preloadSource, /mpvPrepareOverlay: \(bounds\) => ipcRenderer\.invoke\('mpv:prepare-overlay', bounds\)/);
  assert.match(preloadSource, /mpvUpdateOverlayBounds: \(bounds\) => ipcRenderer\.invoke\('mpv:update-overlay-bounds', bounds\)/);
  assert.match(preloadSource, /mpvUpdateOverlayState: \(state\) => ipcRenderer\.invoke\('mpv:update-overlay-state', state\)/);
  assert.match(preloadSource, /mpvUpdateOverlayRemoteCursors: \(remoteCursorHtml\) => ipcRenderer\.invoke\('mpv:update-overlay-remote-cursors', remoteCursorHtml\)/);
  assert.match(preloadSource, /mpvDestroyOverlay: \(\) => ipcRenderer\.invoke\('mpv:destroy-overlay'\)/);
});

test('main process registers mpv IPC handlers through the manager and embed host', () => {
  assert.match(ipcSource, /const \{ MPVManager, mpvManager \} = require\('\.\/mpv-manager'\);/);
  assert.match(ipcSource, /const \{ mpvEmbedHost \} = require\('\.\/mpv-embed-host'\);/);
  assert.match(ipcSource, /const \{ mpvOverlayHost \} = require\('\.\/mpv-overlay-host'\);/);
  for (const channel of [
    'mpv:is-enabled',
    'mpv:is-available',
    'mpv:load',
    'mpv:probe-metadata',
    'mpv:play',
    'mpv:pause',
    'mpv:seek',
    'mpv:set-volume',
    'mpv:set-muted',
    'mpv:set-video-transform',
    'mpv:get-status',
    'mpv:screenshot',
    'mpv:stop',
    'mpv:prepare-embed',
    'mpv:update-embed-bounds',
    'mpv:set-host-visible',
    'mpv:destroy-embed',
    'mpv:prepare-overlay',
    'mpv:update-overlay-bounds',
    'mpv:update-overlay-state',
    'mpv:update-overlay-remote-cursors',
    'mpv:destroy-overlay'
  ]) {
    assert.match(ipcSource, new RegExp(`ipcMain\\.handle\\('${channel}'`));
  }
  assert.match(ipcSource, /ipcMain\.handle\('mpv:probe-metadata'[\s\S]+const metadataMpv = new MPVManager\(\);/);
  assert.match(ipcSource, /metadataMpv\.load\(filePath, \{[\s\S]+forceWindow: false,[\s\S]+headless: true[\s\S]+\}\)/);
  assert.match(ipcSource, /mpvEmbedHost\.ensure\(bounds\)/);
  assert.match(ipcSource, /mpvEmbedHost\.updateBounds\(bounds\)/);
  assert.match(ipcSource, /mpvEmbedHost\.setVisible\(nextVisible\)/);
  assert.match(ipcSource, /mpvEmbedHost\.destroy\(\)/);
  assert.match(ipcSource, /mpvOverlayHost\.ensure\(bounds\)/);
  assert.match(ipcSource, /mpvOverlayHost\.setVisible\(nextVisible\)/);
  assert.match(ipcSource, /mpvOverlayHost\.updateBounds\(bounds\)/);
  assert.match(ipcSource, /mpvOverlayHost\.updateState\(state\)/);
  assert.match(ipcSource, /mpvOverlayHost\.updateRemoteCursorState\(remoteCursorHtml\)/);
  assert.match(ipcSource, /mpvOverlayHost\.destroy\(\)/);
});

test('video player supports an external mpv engine without removing HTML5 fallback', () => {
  assert.match(videoPlayerSource, /this\.engine = 'html5';/);
  assert.match(videoPlayerSource, /useExternalEngine\(config = \{\}\) \{/);
  assert.match(videoPlayerSource, /this\.engine = config\.engineName \|\| 'external';/);
  assert.match(videoPlayerSource, /_startExternalStatusPolling\(\)/);
  assert.match(videoPlayerSource, /this\.externalControls\.seek\(time\)/);
  assert.match(videoPlayerSource, /this\.engine = 'html5';/);
  assert.match(videoPlayerSource, /this\.videoElement\.play\(\)/);
});

test('loadVideo checks mpv pilot before FFmpeg transcode and falls back by default', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];

  assert.match(appSource, /async function shouldUseMpvPilot\(filePath, \{ fileIsAudio, hasPreparedVideoPath \} = \{\}\) \{/);
  assert.match(loadVideoSource, /const preparedVideoPathIsOriginal = hasPreparedVideoPath && isSameFilePath\(preparedVideoPath, filePath\);/);
  assert.match(loadVideoSource, /const hasConvertedPreparedVideoPath = hasPreparedVideoPath && !preparedVideoPathIsOriginal;/);
  assert.match(loadVideoSource, /const useMpvPilot = allowMpvPilot && await shouldUseMpvPilot\(filePath, \{ fileIsAudio, hasPreparedVideoPath: hasConvertedPreparedVideoPath \}\);/);
  assert.match(loadVideoSource, /!useMpvPilot && !hasPreparedVideoPath && !fileIsAudio && await window\.electronAPI\.ffmpegIsAvailable\(\)/);
  assert.match(loadVideoSource, /await loadVideoWithMpvPilot\(filePath, \{[\s\S]+initialFrame,[\s\S]+loadToken,[\s\S]+isStaleVideoLoad[\s\S]+\}\);/);
  assert.match(loadVideoSource, /await videoPlayer\.load\(actualVideoPath\);/);
});

test('mpv pilot skips thumbnail generation without FFmpeg probing', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];

  const resolveMpvThumbnailMatch = appSource.match(/async function resolveMpvThumbnailVideoPath\(filePath, \{[\s\S]*?\n  \}\n\n  async function loadVideo/);
  assert.ok(resolveMpvThumbnailMatch, 'resolveMpvThumbnailVideoPath should exist');
  const resolveMpvThumbnailSource = resolveMpvThumbnailMatch[0];

  assert.doesNotMatch(resolveMpvThumbnailSource, /window\.electronAPI\.ffmpeg/);
  assert.match(resolveMpvThumbnailSource, /return null;/);
  assert.doesNotMatch(resolveMpvThumbnailSource, /showTranscodeOverlay\(filePath/);
  assert.match(loadVideoSource, /let thumbnailVideoPath = actualVideoPath;/);
  assert.match(loadVideoSource, /if \(ffmpegAvailable\) \{[\s\S]+actualVideoPath = transcoded\.outputPath;[\s\S]+\} else \{[\s\S]+log\.debug\('FFmpeg 사용 불가, 코덱 변환 건너뜀'\);[\s\S]+\}\s+thumbnailVideoPath = actualVideoPath;/);
  assert.match(loadVideoSource, /let shouldGenerateThumbnails = true;/);
  assert.match(loadVideoSource, /if \(useMpvPilot\) \{[\s\S]+thumbnailVideoPath = await resolveMpvThumbnailVideoPath\(filePath, \{[\s\S]+isStaleVideoLoad[\s\S]+\}\);[\s\S]+shouldGenerateThumbnails = Boolean\(thumbnailVideoPath\);[\s\S]+\}/);
  assert.match(loadVideoSource, /if \(shouldGenerateThumbnails\) \{[\s\S]+await generateThumbnails\(thumbnailVideoPath\);[\s\S]+\} else \{[\s\S]+getThumbnailGenerator\(\)\.clear\(\);[\s\S]+document\.getElementById\('videoLoadingOverlay'\)\?\.classList\.remove\('active'\);[\s\S]+\}/);
});

test('mpv pilot falls back to the normal playback path when mpv load fails', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];

  assert.match(loadVideoSource, /allowMpvPilot = true/);
  assert.match(loadVideoSource, /const useMpvPilot = allowMpvPilot && await shouldUseMpvPilot\(filePath, \{ fileIsAudio, hasPreparedVideoPath: hasConvertedPreparedVideoPath \}\);/);
  assert.match(loadVideoSource, /catch \(mpvError\) \{[\s\S]+mpv 파일럿 로드 실패, 기존 재생 방식으로 재시도[\s\S]+allowMpvPilot: false,[\s\S]+preparedVideoPath: preparedVideoPathIsOriginal \? null : preparedVideoPath[\s\S]+return loadVideo\(filePath, fallbackOptions\);[\s\S]+\}/);
});

test('loadVideo shows Google Drive loading feedback before media preparation', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];

  assert.match(appSource, /function showDriveVideoLoadingFeedback\(filePath, options = \{\}\) \{/);
  assert.match(appSource, /isGoogleDrivePath\(filePath\) \|\| isGoogleDrivePath\(options\.preparedVideoPath\)/);
  assert.match(appSource, /Google Drive에서 영상 불러오는 중/);
  assert.match(loadVideoSource, /const driveLoadingFeedbackShown = showDriveVideoLoadingFeedback\(filePath, \{ preparedVideoPath \}\);/);
  assert.match(loadVideoSource, /if \(driveLoadingFeedbackShown && fileIsAudio\) \{[\s\S]+hideVideoLoadingOverlay\('drive'\);[\s\S]+\}/);
  assert.match(loadVideoSource, /if \(driveLoadingFeedbackShown\) \{[\s\S]+hideVideoLoadingOverlay\('drive'\);[\s\S]+\}/);
});

test('mpv direct playback defaults on and can be opted out from app settings', () => {
  assert.match(userSettingsSource, /mpvPlaybackEnabled:\s*true/);
  assert.match(userSettingsSource, /getMpvPlaybackEnabled\(\) \{[\s\S]+return this\.settings\.mpvPlaybackEnabled !== false;/);
  assert.match(userSettingsSource, /setMpvPlaybackEnabled\(enabled\) \{[\s\S]+this\.settings\.mpvPlaybackEnabled = enabled === true;[\s\S]+this\._save\(\);[\s\S]+this\._emit\('mpvPlaybackEnabledChanged'/);

  assert.match(indexSource, /data-tab="playback">재생<\/button>/);
  assert.match(indexSource, /id="appSettingsMpvPilotEnabled"[\s\S]*?<span class="toggle-slider"><\/span>/);
  assert.match(indexSource, /mpv 직접 재생/);

  assert.match(appSource, /const mpvPilotEnabled = document\.getElementById\('appSettingsMpvPilotEnabled'\);/);
  assert.match(appSource, /mpvPilotEnabled\.checked = userSettings\.getMpvPlaybackEnabled\(\);/);
  assert.match(appSource, /userSettings\.setMpvPlaybackEnabled\(e\.target\.checked\);/);
  assert.match(appSource, /const locallyEnabled = userSettings\.getMpvPlaybackEnabled\(\);/);
  assert.match(appSource, /const envEnabled = await window\.electronAPI\.mpvIsEnabled\(\);/);
  assert.match(appSource, /if \(!locallyEnabled && !envEnabled\) return false;/);
});

test('mpv pilot embeds into the BAEFRAME viewer before loading media', () => {
  assert.match(mpvManagerSource, /this\.loadQueue = Promise\.resolve\(\);/);
  assert.match(mpvManagerSource, /async load\(filePath, options = \{\}\) \{[\s\S]+const queuedLoad = this\.loadQueue\.then\(runLoad, runLoad\);[\s\S]+this\.loadQueue = queuedLoad\.catch\(\(\) => \{\}\);[\s\S]+return queuedLoad;/);
  assert.match(mpvManagerSource, /async _load\(filePath, options = \{\}\) \{[\s\S]+await this\.start\(\{ wid: options\.wid, forceWindow: options\.forceWindow, headless: options\.headless \}\);/);
  assert.match(mpvManagerSource, /`--wid=\$\{normalizedWid\}`/);

  assert.match(appSource, /function getMpvEmbedBounds\(\) \{[\s\S]+syncMpvFullscreenViewportInset\(\);[\s\S]+elements\.videoWrapper\?\.getBoundingClientRect\(\)[\s\S]+height: rect\.height/);
  assert.match(appSource, /function getMpvFullscreenControlsInset\(\) \{[\s\S]+document\.body\.classList\.contains\('mpv-pilot-mode'\)[\s\S]+document\.body\.classList\.contains\('app-fullscreen'\)[\s\S]+document\.body\.classList\.contains\('show-controls'\)[\s\S]+elements\.controlsBar\?\.getBoundingClientRect\(\)[\s\S]+elements\.fullscreenSeekbar\?\.getBoundingClientRect\(\)/);
  assert.match(appSource, /function syncMpvFullscreenViewportInset\(\) \{[\s\S]+elements\.videoWrapper\?\.style\.setProperty\('--mpv-fullscreen-controls-inset', `\$\{inset\}px`\);/);
  assert.match(mainStyles, /body\.app-fullscreen\.mpv-pilot-mode\.show-controls \.video-wrapper \{[\s\S]+height: calc\(100vh - var\(--mpv-fullscreen-controls-inset, 0px\)\);/);
  assert.match(appSource, /async function prepareMpvEmbedHost\(\) \{[\s\S]+window\.electronAPI\.mpvPrepareEmbed\(bounds\)/);
  assert.match(appSource, /async function syncMpvEmbedBounds\(\) \{[\s\S]+window\.electronAPI\.mpvUpdateEmbedBounds\(bounds\)/);
  assert.match(appSource, /async function prepareMpvOverlayHost\(\) \{[\s\S]+window\.electronAPI\.mpvPrepareOverlay\(bounds\)/);
  assert.match(appSource, /async function syncMpvOverlayState\(\) \{[\s\S]+window\.electronAPI\.mpvUpdateOverlayState\(state\)/);
  assert.match(appSource, /let embedHost = null;[\s\S]+embedHost = await prepareMpvEmbedHost\(\);/);
  assert.match(appSource, /await prepareMpvOverlayHost\(\);/);
  assert.match(appSource, /loadResult = await window\.electronAPI\.mpvLoad\(filePath, \{[\s\S]+pause: true,[\s\S]+wid: embedHost\?\.wid,[\s\S]+videoTransform: getMpvVideoTransform\(\)[\s\S]+\}\);/);
  assert.match(appSource, /stop: \(\) => stopCurrentMpvPilotEngine\(\)/);
  assert.match(appSource, /resizeObserver\.observe\(elements\.videoWrapper\);[\s\S]+syncMpvEmbedBounds\(\);/);

  assert.match(videoPlayerSource, /this\.videoWidth = 0;/);
  assert.match(videoPlayerSource, /this\.videoHeight = 0;/);
  assert.match(videoPlayerSource, /this\.videoWidth = Math\.max\(0, Number\(config\.width\) \|\| 0\);/);
  assert.match(videoPlayerSource, /this\.videoHeight = Math\.max\(0, Number\(config\.height\) \|\| 0\);/);
});

test('mpv pilot requires a ready overlay host before loading media', () => {
  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  const loadMpvSource = loadMpvMatch[1];

  assert.match(appSource, /function createMpvOverlayLifecycle\(\{ onWarning = \(\) => \{\} \} = \{\}\) \{/);
  assert.match(appSource, /generation: \+\+generation,[\s\S]+loadToken/);
  assert.match(loadMpvSource, /const overlayOwner = mpvOverlayLifecycle\.begin\(loadToken\);/);
  assert.match(loadMpvSource, /let overlayHost = null;/);
  assert.match(loadMpvSource, /overlayHost = await prepareMpvOverlayHost\(\);/);
  assert.match(loadMpvSource, /if \(!overlayHost\) \{[\s\S]+throw new Error\('mpv 오버레이 호스트 준비 실패'\);[\s\S]+\}/);
  assert.match(loadMpvSource, /overlayHost = await prepareMpvOverlayHost\(\);\n      if \(isStaleMpvPilotLifecycle\(\)\) \{[\s\S]+if \(!mpvOverlayLifecycle\.markReady\(overlayOwner\)\) \{/);
});

test('mpv overlay sync circuit-breaks failed IPC responses before taking more snapshots', () => {
  const stateSyncMatch = appSource.match(/async function syncMpvOverlayState\(\) \{([\s\S]*?)\n  \}\n\n  function syncMpvOverlayRemoteCursorState/);
  assert.ok(stateSyncMatch, 'syncMpvOverlayState should exist');
  const stateSyncSource = stateSyncMatch[1];
  assert.match(stateSyncSource, /const overlayOwner = mpvOverlayLifecycle\.captureReadyOwner\(\);[\s\S]+requestAnimationFrame\(async \(\) => \{/);
  assert.match(stateSyncSource, /if \(!mpvOverlayLifecycle\.isReady\(overlayOwner\)\) return;\n      const state = getMpvOverlayState\(\);[\s\S]+if \(!mpvOverlayLifecycle\.isReady\(overlayOwner\)\) return;/);
  assert.match(stateSyncSource, /const result = await window\.electronAPI\.mpvUpdateOverlayState\(state\);[\s\S]+if \(!result\?\.success\) \{[\s\S]+if \(!mpvOverlayLifecycle\.owns\(overlayOwner\)\) return;[\s\S]+markMpvOverlayHostUnavailable\(overlayOwner, result\?\.error\);/);
  assert.match(stateSyncSource, /catch \(error\) \{[\s\S]+if \(!mpvOverlayLifecycle\.owns\(overlayOwner\)\) return;[\s\S]+markMpvOverlayHostUnavailable\(overlayOwner, error\.message\);/);

  const remoteCursorSyncMatch = appSource.match(/function syncMpvOverlayRemoteCursorState\(\) \{([\s\S]*?)\n  \}\n\n  function scheduleMpvOverlayRemoteCursorStateSync/);
  assert.ok(remoteCursorSyncMatch, 'syncMpvOverlayRemoteCursorState should exist');
  const remoteCursorSyncSource = remoteCursorSyncMatch[1];
  assert.match(remoteCursorSyncSource, /const overlayOwner = mpvOverlayLifecycle\.captureReadyOwner\(\);[\s\S]+requestAnimationFrame\(async \(\) => \{/);
  assert.match(remoteCursorSyncSource, /if \(!mpvOverlayLifecycle\.isReady\(overlayOwner\)\) return;\n      const remoteCursorHtml = serializeMpvOverlayRemoteCursorHtml\(\);[\s\S]+if \(!mpvOverlayLifecycle\.isReady\(overlayOwner\)\) return;/);
  assert.match(remoteCursorSyncSource, /const result = await window\.electronAPI\.mpvUpdateOverlayRemoteCursors\(remoteCursorHtml\);[\s\S]+if \(!result\?\.success\) \{[\s\S]+if \(!mpvOverlayLifecycle\.owns\(overlayOwner\)\) return;[\s\S]+markMpvOverlayHostUnavailable\(overlayOwner, result\?\.error\);/);
  assert.match(remoteCursorSyncSource, /catch \(error\) \{[\s\S]+if \(!mpvOverlayLifecycle\.owns\(overlayOwner\)\) return;[\s\S]+markMpvOverlayHostUnavailable\(overlayOwner, error\.message\);/);
});

test('mpv overlay lifecycle invalidates before cleanup, stop, and a new prepare attempt', () => {
  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  const loadMpvSource = loadMpvMatch[1];
  const beginIndex = loadMpvSource.indexOf('const overlayOwner = mpvOverlayLifecycle.begin(loadToken);');
  const embedPrepareIndex = loadMpvSource.indexOf('embedHost = await prepareMpvEmbedHost();');
  assert.ok(beginIndex >= 0 && beginIndex < embedPrepareIndex, 'new preparation should invalidate older generations before awaiting embed preparation');
  assert.match(loadMpvSource, /embedHost = await prepareMpvEmbedHost\(\);\n      if \(isStaleMpvPilotLifecycle\(\)\)/);
  assert.match(loadMpvSource, /overlayHost = await prepareMpvOverlayHost\(\);\n      if \(isStaleMpvPilotLifecycle\(\)\)/);
  const cleanupMatch = loadMpvSource.match(/const cleanupPendingMpvPilot = async \(\) => \{([\s\S]*?)\n    \};/);
  assert.ok(cleanupMatch, 'cleanupPendingMpvPilot should exist');
  const cleanupSource = cleanupMatch[1];
  assert.match(cleanupSource, /if \(!ownsMpvOverlayLifecycle\(\)\) \{[\s\S]+return;/);
  assert.match(cleanupSource, /await stopMpvPilotEngine\(overlayOwner\);/);
  assert.match(cleanupSource, /if \(!mpvOverlayLifecycle\.invalidate\(overlayOwner\)\) return;\n          await window\.electronAPI\?\.mpvDestroyOverlay\?\.\(\);/);

  const stopMpvMatch = appSource.match(/async function stopMpvPilotEngine\(overlayOwner = null\) \{([\s\S]*?)\n  \}/);
  assert.ok(stopMpvMatch, 'stopMpvPilotEngine should exist');
  assert.ok(
    stopMpvMatch[1].indexOf('mpvOverlayLifecycle.invalidate(overlayOwner)') < stopMpvMatch[1].indexOf('await releaseMpvReviewFreezeFrame();'),
    'stop should invalidate overlay readiness before awaiting teardown'
  );
});

test('mpv pilot hides native host while DOM blocking overlays are open', () => {
  assert.match(appSource, /const MPV_BLOCKING_OVERLAY_SELECTOR = \[[\s\S]+'.modal-overlay.active'[\s\S]+'.thread-overlay.open'[\s\S]+'.image-viewer-overlay.open'[\s\S]+\]\.join\(','\);/);
  [
    '.credits-overlay.active',
    '.codec-error-overlay.active',
    '.app-saving-overlay.active',
    '#videoLoadingOverlay.active',
    '.transcode-overlay.active',
    '.composition-layer-context-menu',
    '.comment-marker-input-wrapper',
    '.composition-drop-choice-overlay',
    '.video-wrapper.mpv-review-freeze-ready',
    '.marker-popup',
    '.layer-settings-popup',
    '.highlight-popup',
    '.shortcuts-menu.visible',
    '.comment-settings-dropdown.open',
    '.filter-dropdown-menu.open',
    '.mention-dropdown',
    '.recent-dropdown-menu.open',
    '.version-dropdown.open .version-dropdown-menu',
    '.split-version-selector.open .split-version-menu'
  ].forEach((selector) => {
    assert.match(appSource, new RegExp(`'${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  });
  const blockingSelectorMatch = appSource.match(/const MPV_BLOCKING_OVERLAY_SELECTOR = \[([\s\S]*?)\]\.join\(','\);/);
  assert.ok(blockingSelectorMatch, 'mpv blocking selector list should exist');
  assert.doesNotMatch(blockingSelectorMatch[1], /\.drawing-tools\.visible/);
  assert.doesNotMatch(appSource, /'\.credits-overlay\.open'/);
  assert.doesNotMatch(appSource, /'\.video-loading-overlay\.active'/);
  assert.match(appSource, /function doesRectOverlapMpvHost\(rect\) \{[\s\S]+elements\.videoWrapper\?\.getBoundingClientRect\(\)[\s\S]+rect\.right > hostRect\.left[\s\S]+rect\.left < hostRect\.right[\s\S]+rect\.bottom > hostRect\.top[\s\S]+rect\.top < hostRect\.bottom/);
  assert.match(appSource, /function isElementVisiblyBlockingMpv\(element\) \{[\s\S]+const rect = element\.getBoundingClientRect\(\);[\s\S]+if \(!doesRectOverlapMpvHost\(rect\)\) return false;[\s\S]+return rect\.width > 0 && rect\.height > 0;/);
  assert.match(appSource, /function hasBlockingOverlayForMpv\(\) \{[\s\S]+document\.querySelectorAll\(MPV_BLOCKING_OVERLAY_SELECTOR\)[\s\S]+some\(isElementVisiblyBlockingMpv\);/);
  assert.match(appSource, /let mpvPilotHostPreparing = false;/);
  assert.match(appSource, /function didMpvHostVisibilityApply\(result, shouldShowMpvHost\) \{[\s\S]+if \(!result\?\.success\) return false;[\s\S]+if \(shouldShowMpvHost\) return true;[\s\S]+return result\.embed\?\.ready === true && result\.overlay\?\.ready === true;/);
  assert.match(appSource, /function forceMpvHostVisibilitySync\(\) \{[\s\S]+mpvHostLastRequestedVisible = null;[\s\S]+syncMpvHostVisibilityWithDom\(\);[\s\S]+\}/);
  assert.match(appSource, /function syncMpvHostVisibilityWithDom\(\) \{[\s\S]+if \(!mpvPilotHostPreparing && !document\.body\.classList\.contains\('mpv-pilot-mode'\)\) return;[\s\S]+const shouldShowMpvHost = !mpvPilotHostPreparing && !hasBlockingOverlayForMpv\(\);[\s\S]+window\.electronAPI\.mpvSetHostVisible\(shouldShowMpvHost\);[\s\S]+didMpvHostVisibilityApply\(result, shouldShowMpvHost\)/);
  assert.match(appSource, /function installMpvBlockingOverlayObserver\(\) \{[\s\S]+new MutationObserver\(\(mutations\) => \{[\s\S]+if \(!mpvPilotHostPreparing && !document\.body\.classList\.contains\('mpv-pilot-mode'\)\) return;[\s\S]+syncMpvHostVisibilityWithDom\(\);[\s\S]+\}\);[\s\S]+attributeFilter: \['class', 'style', 'hidden'\]/);
  assert.match(appSource, /installMpvBlockingOverlayObserver\(\);/);
  assert.match(appSource, /async function prepareMpvEmbedHost\(\) \{[\s\S]+if \(result\?\.success && result\.wid\) \{[\s\S]+forceMpvHostVisibilitySync\(\);[\s\S]+return result;/);
  assert.match(appSource, /async function prepareMpvOverlayHost\(\) \{[\s\S]+if \(result\?\.success\) \{[\s\S]+forceMpvHostVisibilitySync\(\);[\s\S]+return result;/);
  assert.match(appSource, /videoPlayer\.addEventListener\('externalstopped', \(e\) => \{[\s\S]+mpvHostLastRequestedVisible = null;[\s\S]+if \(isAppShuttingDown\) return;[\s\S]+allowMpvPilot: retryMpv/);
  assert.match(appSource, /async function stopMpvPilotEngine\(overlayOwner = null\) \{[\s\S]+finally \{[\s\S]+mpvHostLastRequestedVisible = null;/);
});

test('mpv pilot waits for the requested initial frame before revealing the native host', () => {
  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  const loadMpvSource = loadMpvMatch[1];

  assert.match(appSource, /async function waitForMpvPlaybackTime\(targetTime, \{ timeoutMs = 700, tolerance = 0\.12 \} = \{\}\)/);
  assert.match(appSource, /async function seekMpvInitialFrameBeforeReveal\(initialFrame\)/);
  assert.match(appSource, /tolerance: Math\.max\(0\.004, \(1 \/ fps\) \* 0\.45\)/);
  assert.match(loadMpvSource, /const initialSeekReady = await seekMpvInitialFrameBeforeReveal\(initialFrame\);/);
  assert.match(loadMpvSource, /if \(!initialSeekReady\) \{[\s\S]+requestAnimationFrame\(resolve\)/);
  const initialSeekIndex = loadMpvSource.indexOf('const initialSeekReady = await seekMpvInitialFrameBeforeReveal(initialFrame);');
  const staleRecheckIndex = loadMpvSource.indexOf('if (isStaleMpvPilotLifecycle()) {', initialSeekIndex);
  const revealReadyIndex = loadMpvSource.indexOf('mpvPilotHostPreparing = false;', initialSeekIndex);
  const visibilitySyncIndex = loadMpvSource.indexOf('syncMpvHostVisibilityWithDom();', revealReadyIndex);
  assert.match(loadMpvSource, /if \(isStaleMpvPilotLifecycle\(\)\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+return false;[\s\S]+\}/);
  assert.ok(
    initialSeekIndex < staleRecheckIndex && staleRecheckIndex < revealReadyIndex,
    'stale mpv loads should be cleaned up after initial-frame waits and before host reveal'
  );
  assert.ok(
    initialSeekIndex < revealReadyIndex,
    'the mpv host should stay hidden until the initial seek has been requested and observed'
  );
  assert.ok(
    revealReadyIndex < visibilitySyncIndex,
    'mpv visibility should be synced only after preparation is marked complete'
  );
});

test('mpv pilot routes audio and viewport controls through mpv IPC', () => {
  assert.match(mpvManagerSource, /async setVolume\(volume\) \{[\s\S]+this\.sendCommand\(\['set_property', 'volume', normalizedVolume \* 100\]\)/);
  assert.match(mpvManagerSource, /async setMuted\(muted\) \{[\s\S]+this\.sendCommand\(\['set_property', 'mute', nextMuted\]\)/);
  assert.match(mpvManagerSource, /async setVideoTransform\(transform = \{\}\) \{[\s\S]+this\.sendCommand\(\['set_property', 'video-zoom', zoom\]\)[\s\S]+this\.sendCommand\(\['set_property', 'video-pan-x', panX\]\)[\s\S]+this\.sendCommand\(\['set_property', 'video-pan-y', panY\]\)/);
  assert.match(ipcSource, /ipcMain\.handle\('mpv:set-volume'[\s\S]+mpvManager\.setVolume\(volume\)/);
  assert.match(ipcSource, /ipcMain\.handle\('mpv:set-muted'[\s\S]+mpvManager\.setMuted\(muted\)/);
  assert.match(ipcSource, /ipcMain\.handle\('mpv:set-video-transform'[\s\S]+mpvManager\.setVideoTransform\(transform\)/);
  assert.match(videoPlayerSource, /setVolume\(volume\) \{[\s\S]+if \(this\.engine !== 'html5'\) \{[\s\S]+this\.externalControls\?\.setVolume\?\.\(normalizedVolume\)/);
  assert.match(videoPlayerSource, /setMuted\(muted\) \{[\s\S]+if \(this\.engine !== 'html5'\) \{[\s\S]+this\.externalControls\?\.setMuted\?\.\(nextMuted\)/);
  assert.match(appSource, /setVolume: \(volume\) => window\.electronAPI\.mpvSetVolume\(volume\)/);
  assert.match(appSource, /setMuted: \(muted\) => window\.electronAPI\.mpvSetMuted\(muted\)/);
  assert.match(appSource, /videoPlayer\.useExternalEngine\(\{[\s\S]+setMuted: \(muted\) => window\.electronAPI\.mpvSetMuted\(muted\)[\s\S]+\}\s+\}\);[\s\S]+videoPlayer\.setVolume\(videoPlayer\.videoElement\.volume\);[\s\S]+videoPlayer\.setMuted\(videoPlayer\.videoElement\.muted\);/);
});

test('mpv pilot applies the same zoom and pan to the mpv image', () => {
  assert.match(appSource, /function getMpvVideoTransform\(\) \{[\s\S]+const renderArea = getVideoRenderArea\(\);[\s\S]+const panWidth = Math\.max\(1, Number\(renderArea\?\.width\) \|\| rect\.width\);[\s\S]+const panHeight = Math\.max\(1, Number\(renderArea\?\.height\) \|\| rect\.height\);[\s\S]+const zoom = Math\.log2\(scale\);[\s\S]+panX: state\.videoPanX \/ panWidth,[\s\S]+panY: state\.videoPanY \/ panHeight/);
  assert.match(appSource, /function syncMpvVideoTransform\(\) \{[\s\S]+window\.electronAPI\.mpvSetVideoTransform\(transform\)/);
  assert.match(appSource, /function applyVideoZoom\(\) \{[\s\S]+syncMpvEmbedBounds\(\);[\s\S]+syncMpvVideoTransform\(\);/);
  assert.match(appSource, /videoTransform: getMpvVideoTransform\(\)/);
});

test('mpv pilot resyncs embed bounds after fullscreen layout transitions', () => {
  const fullscreenMatch = appSource.match(/async function toggleFullscreen\(\) \{([\s\S]*?)\n  \}\n\n  \/\*\*\n   \* 전체화면 타임코드 업데이트/);
  assert.ok(fullscreenMatch, 'toggleFullscreen should exist');
  const fullscreenSource = fullscreenMatch[1];

  assert.match(appSource, /function scheduleMpvEmbedBoundsSyncAfterLayout\(\) \{[\s\S]+syncMpvEmbedBounds\(\);[\s\S]+requestAnimationFrame\(\(\) => \{[\s\S]+syncMpvEmbedBounds\(\);[\s\S]+requestAnimationFrame\(\(\) => \{[\s\S]+syncMpvEmbedBounds\(\);[\s\S]+setTimeout\(\(\) => \{[\s\S]+syncMpvEmbedBounds\(\);[\s\S]+250/);
  assert.match(appSource, /function setFullscreenControlsVisible\(visible\) \{[\s\S]+document\.body\.classList\.toggle\('show-controls', visible\);[\s\S]+scheduleMpvEmbedBoundsSyncAfterLayout\(\);/);
  assert.match(fullscreenSource, /document\.body\.classList\.toggle\('app-fullscreen', isFullscreen\);[\s\S]+scheduleMpvEmbedBoundsSyncAfterLayout\(\);/);
  assert.match(fullscreenSource, /if \(isNearBottom\) \{[\s\S]+setFullscreenControlsVisible\(true\);[\s\S]+\} else \{[\s\S]+setFullscreenControlsVisible\(false\);/);
});

test('mpv pilot cleans up pending embed host when load is stale or fails before adoption', () => {
  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{[\s\S]*?\n  \}\n\n  async function loadVideo/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  const loadMpvSource = loadMpvMatch[0];

  assert.match(appSource, /let activeMpvPilotLoadToken = null;/);
  assert.match(loadMpvSource, /loadToken = null,[\s\S]+isStaleVideoLoad = \(\) => false/);
  assert.match(loadMpvSource, /activeMpvPilotLoadToken = loadToken;/);
  assert.match(loadMpvSource, /const overlayOwner = mpvOverlayLifecycle\.begin\(loadToken\);/);
  assert.match(loadMpvSource, /let embedHost = null;/);
  assert.match(loadMpvSource, /const ownsMpvPilotLoad = \(\) => activeMpvPilotLoadToken === loadToken;/);
  assert.match(loadMpvSource, /const ownsMpvOverlayLifecycle = \(\) => \([\s\S]+ownsMpvPilotLoad\(\) && mpvOverlayLifecycle\.owns\(overlayOwner\)[\s\S]+\);/);
  assert.match(loadMpvSource, /const clearMpvPilotLoadOwner = \(\) => \{[\s\S]+if \(ownsMpvPilotLoad\(\)\) \{[\s\S]+activeMpvPilotLoadToken = null;[\s\S]+\}/);
  assert.match(loadMpvSource, /const cleanupPendingMpvPilot = async \(\) => \{/);
  assert.match(loadMpvSource, /const cleanupPendingMpvPilot = async \(\) => \{[\s\S]+if \(!ownsMpvOverlayLifecycle\(\)\) \{[\s\S]+return;[\s\S]+\}[\s\S]+if \(mpvLoadStarted\)/);
  assert.match(loadMpvSource, /if \(mpvLoadStarted\) \{[\s\S]+await stopMpvPilotEngine\(overlayOwner\);[\s\S]+\}/);
  assert.match(loadMpvSource, /await window\.electronAPI\?\.mpvDestroyEmbed\?\.\(\);/);
  assert.match(loadMpvSource, /finally \{[\s\S]+if \(ownsMpvPilotLoad\(\)\) \{[\s\S]+mpvPilotHostPreparing = false;[\s\S]+clearMpvPilotLoadOwner\(\);[\s\S]+\}[\s\S]+\}/);
  assert.match(loadMpvSource, /try \{[\s\S]+mpvPilotHostPreparing = true;[\s\S]+embedHost = await prepareMpvEmbedHost\(\);[\s\S]+isStaleMpvPilotLifecycle\(\)[\s\S]+overlayHost = await prepareMpvOverlayHost\(\);[\s\S]+mpvOverlayLifecycle\.markReady\(overlayOwner\)[\s\S]+\} catch \(error\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+throw error;[\s\S]+\}/);
  assert.match(loadMpvSource, /const stopCurrentMpvPilotEngine = async \(\) => \{[\s\S]+await stopMpvPilotEngine\(overlayOwner\);[\s\S]+clearMpvPilotLoadOwner\(\);[\s\S]+\};/);
  assert.match(loadMpvSource, /stop: \(\) => stopCurrentMpvPilotEngine\(\)/);
  assert.match(loadMpvSource, /if \(isStaleMpvPilotLifecycle\(\)\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+return false;[\s\S]+\}/);
  assert.match(loadMpvSource, /catch \(error\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+throw error;[\s\S]+\}/);
  assert.match(loadMpvSource, /if \(!loadResult\?\.success\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+throw new Error/);
  assert.doesNotMatch(loadMpvSource, /ffmpegIsAvailable|ffmpegProbeCodec/);
  assert.match(loadMpvSource, /duration: Number\(loadResult\.duration\) \|\| 0/);
  assert.match(loadMpvSource, /document\.body\.classList\.add\('mpv-pilot-mode'\);[\s\S]+mpvPilotHostPreparing = false;[\s\S]+syncMpvHostVisibilityWithDom\(\);/);
});

test('mpv pilot mirrors DOM overlays into a click-through native overlay window', () => {
  assert.match(appSource, /function isMpvMarkerOverlayVisible\(\) \{[\s\S]+window\.getComputedStyle\(markerContainer\)[\s\S]+style\.display !== 'none'[\s\S]+style\.visibility !== 'hidden'/);
  assert.match(appSource, /function serializeMpvOverlayMarkerHtml\(\) \{[\s\S]+cloneNode\(true\)[\s\S]+textarea\.textContent = sourceTextarea\.value/);
  assert.match(appSource, /function serializeMpvOverlayMarkerHtml\(\) \{[\s\S]+if \(!isMpvMarkerOverlayVisible\(\)\) return '';/);
  assert.match(appSource, /function serializeMpvOverlayTooltipHtml\(\) \{[\s\S]+const tooltipLayer = document\.createElement\('div'\);[\s\S]+document\.querySelectorAll\('\.comment-marker-tooltip'\)\.forEach\(\(tooltip\) => \{[\s\S]+tooltipClone\.style\.position = 'absolute';[\s\S]+tooltipClone\.style\.transform = 'none';[\s\S]+tooltipLayer\.appendChild\(tooltipClone\);[\s\S]+\}\);/);
  assert.match(appSource, /function serializeMpvOverlayTooltipHtml\(\) \{[\s\S]+if \(!isMpvMarkerOverlayVisible\(\)\) return '';/);
  assert.match(appSource, /function copyComputedMpvOverlayStyles\(source, target\) \{/);
  assert.match(appSource, /function serializeMpvOverlayToastHtml\(\) \{/);
  assert.match(appSource, /function getMpvOverlayState\(\) \{[\s\S]+toastHtml: serializeMpvOverlayToastHtml\(\)/);
  assert.match(appSource, /function serializeMpvOverlayRemoteCursorHtml\(\) \{[\s\S]+remoteCursorsContainer\.cloneNode\(true\)[\s\S]+return clone\.innerHTML;/);
  assert.match(appSource, /function getMpvOverlayState\(\) \{[\s\S]+remoteCursorHtml: serializeMpvOverlayRemoteCursorHtml\(\)/);
  assert.match(appSource, /function syncMpvOverlayRemoteCursorState\(\) \{[\s\S]+const remoteCursorHtml = serializeMpvOverlayRemoteCursorHtml\(\);[\s\S]+window\.electronAPI\.mpvUpdateOverlayRemoteCursors\(remoteCursorHtml\)/);
  assert.match(appSource, /function scheduleMpvOverlayRemoteCursorStateSync\(\) \{[\s\S]+syncMpvOverlayRemoteCursorState\(\);[\s\S]+\}/);
  const clearRemoteCursorsSource = appSource.match(/function clearRemoteCursors\(\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  const renderRemoteCursorsSource = appSource.match(/function renderRemoteCursors\(collaborators = \[\]\) \{([\s\S]*?)\n  \}\n\n  userSettings\.addEventListener/)?.[1] || '';
  assert.match(clearRemoteCursorsSource, /remoteCursorsContainer\.querySelectorAll\('\.remote-cursor'\)\.forEach\(el => el\.remove\(\)\);[\s\S]+scheduleMpvOverlayRemoteCursorStateSync\(\);/);
  assert.match(renderRemoteCursorsSource, /scheduleMpvOverlayRemoteCursorStateSync\(\);/);
  assert.doesNotMatch(clearRemoteCursorsSource, /scheduleMpvOverlayStateSync\(/);
  assert.doesNotMatch(renderRemoteCursorsSource, /scheduleMpvOverlayStateSync\(/);
  assert.match(mainStyles, /body\.mpv-pilot-mode \.video-wrapper\.mpv-pilot-mode > \.remote-cursors-container \{[\s\S]+visibility: hidden !important;/);
  const htmlOverlayMatch = appSource.match(/function serializeMpvOverlayHtml\(\) \{([\s\S]*?)\n  \}\n\n  function getMpvOverlayState/);
  assert.ok(htmlOverlayMatch, 'serializeMpvOverlayHtml should exist');
  const htmlOverlaySource = htmlOverlayMatch[1];
  [
    'elements.currentCutOverlay',
    'elements.zoomIndicatorOverlay',
    'videoCommentRangeOverlay',
    'fullscreenTimecodeOverlay',
    'fullscreenScrubOverlay'
  ].forEach((source) => {
    assert.match(htmlOverlaySource, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  assert.match(appSource, /function getMpvOverlayState\(\) \{[\s\S]+drawingDataUrl[\s\S]+onionDataUrl[\s\S]+markerHtml: serializeMpvOverlayMarkerHtml\(\)[\s\S]+tooltipHtml: serializeMpvOverlayTooltipHtml\(\)[\s\S]+htmlOverlayHtml: serializeMpvOverlayHtml\(\)/);
  assert.match(appSource, /function scheduleMpvOverlayStateSync\(options = \{\}\) \{[\s\S]+syncMpvOverlayState\(\);/);
  assert.match(appSource, /const MPV_MIRRORED_OVERLAY_SELECTOR = \[[\s\S]+'.comment-markers-container'[\s\S]+'.comment-marker-tooltip'[\s\S]+'.video-comment-range-overlay'[\s\S]+\]\.join\(','\);/);
  assert.match(appSource, /function isMpvMirroredOverlayMutation\(mutation\) \{[\s\S]+target\.matches\?\.\(MPV_MIRRORED_OVERLAY_SELECTOR\)[\s\S]+target\.closest\?\.\(MPV_MIRRORED_OVERLAY_SELECTOR\)[\s\S]+node\.querySelector\?\.\(MPV_MIRRORED_OVERLAY_SELECTOR\)/);
  assert.match(appSource, /function installMpvMirroredOverlayObserver\(\) \{[\s\S]+new MutationObserver\(\(mutations\) => \{[\s\S]+if \(!document\.body\.classList\.contains\('mpv-pilot-mode'\)\) return;[\s\S]+mutations\.some\(isMpvMirroredOverlayMutation\)[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(appSource, /installMpvMirroredOverlayObserver\(\);/);
  assert.match(appSource, /const MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS = 350;/);
  assert.match(appSource, /function showZoomIndicator\(zoom\) \{[\s\S]+elements\.zoomIndicatorOverlay\.classList\.remove\('visible'\);[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+setTimeout\(\(\) => \{[\s\S]+if \(!elements\.zoomIndicatorOverlay\?\.classList\.contains\('visible'\)\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+\}[\s\S]+\}, MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS\);/);
  assert.match(appSource, /function hideFullscreenScrubOverlay\(\) \{[\s\S]+fullscreenScrubOverlay\?\.classList\.remove\('visible'\);[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+setTimeout\(\(\) => \{[\s\S]+if \(!fullscreenScrubOverlay\?\.classList\.contains\('visible'\)\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+\}[\s\S]+\}, MPV_OVERLAY_FADE_OUT_SYNC_DELAY_MS\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('drawmove', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\}\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('frameRendered', \(e\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\}\);/);
  assert.match(appSource, /function renderVideoMarkers\(\) \{[\s\S]+scheduleMpvOverlayStateSync\(\);/);
  assert.match(appSource, /function updateVideoMarkersVisibility\(\) \{[\s\S]+scheduleMpvOverlayStateSync\(\);/);
  assert.match(appSource, /const onMouseMove = \(e\) => \{[\s\S]+markerEl\.style\.left = `\$\{newX \* 100\}%`;[\s\S]+markerEl\.style\.top = `\$\{newY \* 100\}%`;[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\};/);
  assert.match(appSource, /const onMouseUp = \(e\) => \{[\s\S]+reviewDataManager\.save\(\);[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+document\.removeEventListener\('mousemove', onMouseMove\);/);
  assert.match(appSource, /const showTooltipHover = \(\) => \{[\s\S]+tooltip\.classList\.add\('visible'\);[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\};/);
  assert.match(appSource, /const hideTooltipHover = \(\) => \{[\s\S]+tooltip\.classList\.remove\('visible'\);[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\}, 100\);/);
  assert.match(appSource, /function updateMarkerTooltipState\(marker\) \{[\s\S]+marker\.tooltipElement\.classList\.add\('visible', 'pinned'\);[\s\S]+scheduleMpvOverlayStateSync\(\);/);
  assert.match(appSource, /async function stopMpvPilotEngine\(overlayOwner = null\) \{[\s\S]+await window\.electronAPI\?\.mpvDestroyOverlay\?\.\(\);/);
});

test('mpv pilot keeps toast notifications visible above the native video host', () => {
  assert.match(appSource, /function serializeMpvOverlayToastHtml\(\) \{[\s\S]+elements\.toastContainer[\s\S]+cloneMpvHtmlOverlayElement\(elements\.toastContainer, wrapperRect\)[\s\S]+return clone\.outerHTML;/);
  assert.match(appSource, /clone\.querySelectorAll\('\.toast-enter'\)\.forEach\(\(toast\) => \{[\s\S]+toast\.classList\.remove\('toast-enter'\);[\s\S]+toast\.style\.animation = 'none';[\s\S]+toast\.style\.transform = '';[\s\S]+toast\.style\.opacity = '';[\s\S]+\}\);/);
  assert.match(appSource, /function _updateToastStack\(\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(appSource, /function _dismissToast\(toast, swipeDir\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(appSource, /update: \(newMessage, newType = 'success', newDuration = 3000\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
  assert.match(appSource, /function _applyToastPosition\(pos\) \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);/);
});

test('mpv overlay throttles live drawing snapshots but forces final drawing sync', () => {
  assert.match(appSource, /const MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS = 48;/);
  assert.match(appSource, /let mpvOverlayStateSyncTimer = null;/);
  assert.match(appSource, /function scheduleMpvOverlayStateSync\(options = \{\}\) \{/);
  assert.match(appSource, /if \(options\.force === true\) \{[\s\S]+if \(mpvOverlayStateSyncTimer\) \{[\s\S]+clearTimeout\(mpvOverlayStateSyncTimer\);[\s\S]+mpvOverlayStateSyncTimer = null;[\s\S]+syncMpvOverlayState\(\);[\s\S]+return;[\s\S]+\}/);
  assert.match(appSource, /if \(options\.liveDrawing === true\) \{[\s\S]+const elapsed = now - mpvOverlayLastLiveDrawSyncAt;[\s\S]+if \(elapsed < MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS\) \{/);
  assert.match(appSource, /mpvOverlayStateSyncTimer = setTimeout\(\(\) => \{[\s\S]+mpvOverlayLastLiveDrawSyncAt = Date\.now\(\);[\s\S]+syncMpvOverlayState\(\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('drawmove', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\{ liveDrawing: true \}\);[\s\S]+\}\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('selectionoverlaychanged', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\{ liveDrawing: true \}\);[\s\S]+\}\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('drawend', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+\}\);/);
});

test('mpv drawing overlay snapshot includes floating selection overlay', () => {
  assert.match(appSource, /function getCompositedDrawingOverlayDataUrl\(\) \{[\s\S]+const activeLayerOpacity = Number\(drawingManager\.getActiveLayer\?\.\(\)\?\.opacity\);/);
  assert.match(appSource, /const drawCanvas = \(canvas, opacity = 1\) => \{[\s\S]+ctx\.globalAlpha = opacity;[\s\S]+ctx\.drawImage\(canvas, 0, 0\);[\s\S]+ctx\.globalAlpha = 1;/);
  assert.match(appSource, /drawCanvas\(baseCanvas, activeCanvasOpacity\);[\s\S]+drawCanvas\(elements\.selectionOverlayCanvas\);[\s\S]+drawCanvas\(elements\.layersAboveCanvas\);/);
});

test('mpv external playback preserves frame seek and loop behavior', () => {
  assert.match(videoPlayerSource, /_handleLoopRestartIfNeeded\(\) \{[\s\S]+this\.seek\(this\.loop\.inPoint\);[\s\S]+this\._emit\('loopRestart'\);[\s\S]+return true;/);
  assert.match(videoPlayerSource, /video\.addEventListener\('timeupdate', \(\) => \{[\s\S]+if \(this\._handleLoopRestartIfNeeded\(\)\) \{[\s\S]+return;[\s\S]+\}/);
  assert.match(videoPlayerSource, /const pollingControls = this\.externalControls;[\s\S]+const pollingEngine = this\.engine;[\s\S]+const status = await pollingControls\.getStatus\(\);[\s\S]+if \(this\.engine !== pollingEngine \|\| this\.externalControls !== pollingControls\) return;/);
  assert.match(videoPlayerSource, /if \(status\.stopped === true\) \{[\s\S]+const stoppedEngine = this\.engine;[\s\S]+const stoppedFilePath = this\.filePath;[\s\S]+const stoppedTime = this\.currentTime;[\s\S]+const stoppedFrame = this\.currentFrame;[\s\S]+await pollingControls\?\.stop\?\.\(\);[\s\S]+this\.useHtml5Engine\(\);[\s\S]+this\.isLoaded = false;[\s\S]+this\._emit\('externalstopped', \{[\s\S]+engine: stoppedEngine,[\s\S]+filePath: stoppedFilePath,[\s\S]+lastTime: stoppedTime,[\s\S]+lastFrame: stoppedFrame,[\s\S]+reason: 'stopped'[\s\S]+\}\);[\s\S]+return;[\s\S]+\}/);
  assert.match(appSource, /videoPlayer\.addEventListener\('externalstopped', \(e\) => \{[\s\S]+elements\.videoWrapper\?\.classList\.remove\('mpv-pilot-mode'\);[\s\S]+document\.body\.classList\.remove\('mpv-pilot-mode'\);[\s\S]+allowMpvPilot: retryMpv[\s\S]+\}\);/);
  assert.match(videoPlayerSource, /const nextWidth = Number\(status\.width\);[\s\S]+const nextHeight = Number\(status\.height\);[\s\S]+if \(Number\.isFinite\(nextWidth\) && nextWidth > 0 && this\.videoWidth !== nextWidth\) \{[\s\S]+this\.videoWidth = nextWidth;[\s\S]+\}[\s\S]+if \(Number\.isFinite\(nextHeight\) && nextHeight > 0 && this\.videoHeight !== nextHeight\) \{[\s\S]+this\.videoHeight = nextHeight;/);
  assert.match(videoPlayerSource, /let metadataChanged = false;[\s\S]+metadataChanged = true;[\s\S]+if \(metadataChanged\) \{[\s\S]+this\._emit\('loadedmetadata', \{[\s\S]+duration: this\.duration,[\s\S]+totalFrames: this\.totalFrames,[\s\S]+fps: this\.fps,[\s\S]+width: this\.videoWidth,[\s\S]+height: this\.videoHeight,[\s\S]+engine: this\.engine/);
  assert.match(videoPlayerSource, /async _syncExternalStatus\(\) \{[\s\S]+const rawEofReached = status\.eofReached === true;[\s\S]+const hasKnownDuration = this\.duration > 0;[\s\S]+const eofReached = rawEofReached && \(!hasKnownDuration \|\| this\.duration - this\.currentTime <= 0\.25\);[\s\S]+const externalIsPlaying = status\.paused === false;[\s\S]+const nextIsPlaying = !eofReached && externalIsPlaying;[\s\S]+this\.isPlaying = externalIsPlaying;[\s\S]+if \(this\._handleLoopRestartIfNeeded\(\)\) \{[\s\S]+return;[\s\S]+\}[\s\S]+this\.isPlaying = nextIsPlaying;/);

  const seekToFrameMatch = videoPlayerSource.match(/seekToFrame\(frame\) \{([\s\S]*?)\n  \}/);
  assert.ok(seekToFrameMatch, 'seekToFrame should exist');
  assert.match(seekToFrameMatch[1], /this\._seekTargetFrame = frame;/);
  assert.match(seekToFrameMatch[1], /if \(this\.engine !== 'html5'\) \{[\s\S]+this\.externalControls\.seek\(time\)[\s\S]+this\._finishManualSeek\(\);[\s\S]+return;/);
  assert.doesNotMatch(seekToFrameMatch[1], /if \(this\.engine !== 'html5'\) \{[\s\S]+this\.seek\(time\);[\s\S]+return;/);
  assert.match(videoPlayerSource, /if \(this\._isSeeking && this\._seekTargetFrame !== null\) \{[\s\S]+const candidateFrame = this\._timeToFrame\(candidateTime\);[\s\S]+if \(candidateFrame === this\._seekTargetFrame\) \{[\s\S]+this\._finishManualSeek\(\);[\s\S]+return;[\s\S]+\}/);
});

test('mpv external playback emits ended when keep-open reaches EOF', () => {
  assert.match(mpvManagerSource, /this\.getOptionalProperty\('eof-reached', false\)/);
  assert.match(videoPlayerSource, /this\._externalEndedEmitted = false;/);
  assert.match(videoPlayerSource, /this\.externalEofReached = false;/);
  assert.match(videoPlayerSource, /const rawEofReached = status\.eofReached === true;/);
  assert.match(videoPlayerSource, /const hasKnownDuration = this\.duration > 0;/);
  assert.match(videoPlayerSource, /const eofReached = rawEofReached && \(!hasKnownDuration \|\| this\.duration - this\.currentTime <= 0\.25\);/);
  assert.match(videoPlayerSource, /this\.externalEofReached = eofReached;/);
  assert.doesNotMatch(videoPlayerSource, /this\.externalEofReached = rawEofReached;/);
  assert.match(videoPlayerSource, /const externalIsPlaying = status\.paused === false;[\s\S]+const nextIsPlaying = !eofReached && externalIsPlaying;[\s\S]+this\.isPlaying = externalIsPlaying;[\s\S]+this\.isPlaying = nextIsPlaying;/);
  assert.match(videoPlayerSource, /if \(eofReached && !this\._externalEndedEmitted\) \{[\s\S]+this\._externalEndedEmitted = true;[\s\S]+this\._emit\('ended'\);[\s\S]+\}/);
  assert.match(videoPlayerSource, /if \(!eofReached\) \{[\s\S]+this\._externalEndedEmitted = false;[\s\S]+\}/);
  assert.match(videoPlayerSource, /seek\(time\) \{[\s\S]+this\._externalEndedEmitted = false;[\s\S]+this\.externalEofReached = false;/);
  assert.match(videoPlayerSource, /async play\(\) \{[\s\S]+if \(this\.engine !== 'html5'\) \{[\s\S]+this\._externalEndedEmitted = false;[\s\S]+this\.externalEofReached = false;/);
  assert.match(videoPlayerSource, /useExternalEngine\(config = \{\}\) \{[\s\S]+this\._externalEndedEmitted = false;[\s\S]+this\.externalEofReached = false;/);
  assert.match(videoPlayerSource, /useHtml5Engine\(\) \{[\s\S]+this\._externalEndedEmitted = false;[\s\S]+this\.externalEofReached = false;/);
});

test('mpv engine replacement resets playing state before html5 loads', () => {
  assert.match(videoPlayerSource, /useHtml5Engine\(\) \{[\s\S]+const wasExternalPlaying = this\.engine !== 'html5' && this\.isPlaying;[\s\S]+if \(wasExternalPlaying\) \{[\s\S]+this\.isPlaying = false;[\s\S]+this\._emit\('pause'\);[\s\S]+\}/);
  assert.match(videoPlayerSource, /async load\(filePath\) \{[\s\S]+if \(this\.engine !== 'html5'\) \{[\s\S]+await this\.externalControls\?\.stop\?\.\(\);[\s\S]+\}[\s\S]+this\.useHtml5Engine\(\);/);
});

test('main process owns mpv shutdown cleanup before forced app quit', () => {
  assert.match(mainIndexSource, /const \{ mpvManager \} = require\('\.\/mpv-manager'\);/);
  assert.match(mainIndexSource, /const \{ mpvEmbedHost \} = require\('\.\/mpv-embed-host'\);/);
  assert.match(mainIndexSource, /const \{ mpvOverlayHost \} = require\('\.\/mpv-overlay-host'\);/);
  assert.match(mainIndexSource, /async function cleanupMpvPilotBeforeQuit\(\) \{[\s\S]+mpvManager\.stop\(\{ commandTimeoutMs: 500 \}\)[\s\S]+mpvOverlayHost\.destroy\(\);[\s\S]+mpvEmbedHost\.destroy\(\);[\s\S]+\}/);
  assert.match(mainIndexSource, /app\.on\('window-all-closed', \(\) => \{[\s\S]+if \(process\.platform === 'darwin'\) \{[\s\S]+if \(!isQuitting && !forceQuit\) \{[\s\S]+cleanupMpvPilotBeforeQuit\(\)\.catch[\s\S]+return;[\s\S]+\}[\s\S]+app\.quit\(\);[\s\S]+\}\);/);
  assert.match(mainIndexSource, /if \(forceQuit && !shutdownCleanupStarted\) \{[\s\S]+event\.preventDefault\(\);[\s\S]+cleanupMpvPilotBeforeQuit\(\)[\s\S]+app\.quit\(\);/);
});
