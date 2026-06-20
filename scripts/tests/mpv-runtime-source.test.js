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

test('package exposes an mpv pilot test command', () => {
  assert.equal(
    packageJson.scripts['test:mpv'],
    'node --test scripts/tests/mpv-manager.test.js scripts/tests/mpv-embed-host.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js'
  );
});

test('preload exposes a narrow mpv API surface', () => {
  assert.match(preloadSource, /mpvIsEnabled: \(\) => ipcRenderer\.invoke\('mpv:is-enabled'\)/);
  assert.match(preloadSource, /mpvIsAvailable: \(\) => ipcRenderer\.invoke\('mpv:is-available'\)/);
  assert.match(preloadSource, /mpvLoad: \(filePath, options\) => ipcRenderer\.invoke\('mpv:load', filePath, options\)/);
  assert.match(preloadSource, /mpvPlay: \(\) => ipcRenderer\.invoke\('mpv:play'\)/);
  assert.match(preloadSource, /mpvPause: \(\) => ipcRenderer\.invoke\('mpv:pause'\)/);
  assert.match(preloadSource, /mpvSeek: \(time\) => ipcRenderer\.invoke\('mpv:seek', time\)/);
  assert.match(preloadSource, /mpvSetVolume: \(volume\) => ipcRenderer\.invoke\('mpv:set-volume', volume\)/);
  assert.match(preloadSource, /mpvSetMuted: \(muted\) => ipcRenderer\.invoke\('mpv:set-muted', muted\)/);
  assert.match(preloadSource, /mpvSetVideoTransform: \(transform\) => ipcRenderer\.invoke\('mpv:set-video-transform', transform\)/);
  assert.match(preloadSource, /mpvGetStatus: \(\) => ipcRenderer\.invoke\('mpv:get-status'\)/);
  assert.match(preloadSource, /mpvStop: \(\) => ipcRenderer\.invoke\('mpv:stop'\)/);
  assert.match(preloadSource, /mpvPrepareEmbed: \(bounds\) => ipcRenderer\.invoke\('mpv:prepare-embed', bounds\)/);
  assert.match(preloadSource, /mpvUpdateEmbedBounds: \(bounds\) => ipcRenderer\.invoke\('mpv:update-embed-bounds', bounds\)/);
  assert.match(preloadSource, /mpvDestroyEmbed: \(\) => ipcRenderer\.invoke\('mpv:destroy-embed'\)/);
  assert.match(preloadSource, /mpvPrepareOverlay: \(bounds\) => ipcRenderer\.invoke\('mpv:prepare-overlay', bounds\)/);
  assert.match(preloadSource, /mpvUpdateOverlayBounds: \(bounds\) => ipcRenderer\.invoke\('mpv:update-overlay-bounds', bounds\)/);
  assert.match(preloadSource, /mpvUpdateOverlayState: \(state\) => ipcRenderer\.invoke\('mpv:update-overlay-state', state\)/);
  assert.match(preloadSource, /mpvDestroyOverlay: \(\) => ipcRenderer\.invoke\('mpv:destroy-overlay'\)/);
});

test('main process registers mpv IPC handlers through the manager and embed host', () => {
  assert.match(ipcSource, /const \{ mpvManager \} = require\('\.\/mpv-manager'\);/);
  assert.match(ipcSource, /const \{ mpvEmbedHost \} = require\('\.\/mpv-embed-host'\);/);
  assert.match(ipcSource, /const \{ mpvOverlayHost \} = require\('\.\/mpv-overlay-host'\);/);
  for (const channel of [
    'mpv:is-enabled',
    'mpv:is-available',
    'mpv:load',
    'mpv:play',
    'mpv:pause',
    'mpv:seek',
    'mpv:set-volume',
    'mpv:set-muted',
    'mpv:set-video-transform',
    'mpv:get-status',
    'mpv:stop',
    'mpv:prepare-embed',
    'mpv:update-embed-bounds',
    'mpv:destroy-embed',
    'mpv:prepare-overlay',
    'mpv:update-overlay-bounds',
    'mpv:update-overlay-state',
    'mpv:destroy-overlay'
  ]) {
    assert.match(ipcSource, new RegExp(`ipcMain\\.handle\\('${channel}'`));
  }
  assert.match(ipcSource, /mpvEmbedHost\.ensure\(bounds\)/);
  assert.match(ipcSource, /mpvEmbedHost\.updateBounds\(bounds\)/);
  assert.match(ipcSource, /mpvEmbedHost\.destroy\(\)/);
  assert.match(ipcSource, /mpvOverlayHost\.ensure\(bounds\)/);
  assert.match(ipcSource, /mpvOverlayHost\.updateBounds\(bounds\)/);
  assert.match(ipcSource, /mpvOverlayHost\.updateState\(state\)/);
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
  assert.match(loadVideoSource, /const useMpvPilot = allowMpvPilot && await shouldUseMpvPilot\(filePath, \{ fileIsAudio, hasPreparedVideoPath \}\);/);
  assert.match(loadVideoSource, /!useMpvPilot && !hasPreparedVideoPath && !fileIsAudio && await window\.electronAPI\.ffmpegIsAvailable\(\)/);
  assert.match(loadVideoSource, /await loadVideoWithMpvPilot\(filePath, \{[\s\S]+initialFrame,[\s\S]+loadToken,[\s\S]+isStaleVideoLoad[\s\S]+\}\);/);
  assert.match(loadVideoSource, /await videoPlayer\.load\(actualVideoPath\);/);
});

test('mpv pilot keeps a Chromium-decodable path for thumbnails', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];

  const resolveMpvThumbnailMatch = appSource.match(/async function resolveMpvThumbnailVideoPath\(filePath, \{[\s\S]*?\n  \}\n\n  async function loadVideo/);
  assert.ok(resolveMpvThumbnailMatch, 'resolveMpvThumbnailVideoPath should exist');
  const resolveMpvThumbnailSource = resolveMpvThumbnailMatch[0];

  assert.match(resolveMpvThumbnailSource, /ffmpegProbeCodec\(filePath\)[\s\S]+ffmpegCheckCache\(filePath\)/);
  assert.match(resolveMpvThumbnailSource, /return null;/);
  assert.doesNotMatch(resolveMpvThumbnailSource, /showTranscodeOverlay\(filePath/);
  assert.match(loadVideoSource, /let thumbnailVideoPath = actualVideoPath;/);
  assert.match(loadVideoSource, /let shouldGenerateThumbnails = true;/);
  assert.match(loadVideoSource, /if \(useMpvPilot\) \{[\s\S]+thumbnailVideoPath = await resolveMpvThumbnailVideoPath\(filePath, \{[\s\S]+isStaleVideoLoad[\s\S]+\}\);[\s\S]+shouldGenerateThumbnails = Boolean\(thumbnailVideoPath\);[\s\S]+\}/);
  assert.match(loadVideoSource, /if \(shouldGenerateThumbnails\) \{[\s\S]+await generateThumbnails\(thumbnailVideoPath\);[\s\S]+\} else \{[\s\S]+getThumbnailGenerator\(\)\.clear\(\);[\s\S]+document\.getElementById\('videoLoadingOverlay'\)\?\.classList\.remove\('active'\);[\s\S]+\}/);
});

test('mpv pilot falls back to the normal playback path when mpv load fails', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];

  assert.match(loadVideoSource, /allowMpvPilot = true/);
  assert.match(loadVideoSource, /const useMpvPilot = allowMpvPilot && await shouldUseMpvPilot\(filePath, \{ fileIsAudio, hasPreparedVideoPath \}\);/);
  assert.match(loadVideoSource, /catch \(mpvError\) \{[\s\S]+mpv 파일럿 로드 실패, 기존 재생 방식으로 재시도[\s\S]+allowMpvPilot: false[\s\S]+return loadVideo\(filePath, fallbackOptions\);[\s\S]+\}/);
});

test('mpv pilot can be enabled from app playback settings without an env var', () => {
  assert.match(userSettingsSource, /mpvPilotEnabled:\s*false/);
  assert.match(userSettingsSource, /getMpvPilotEnabled\(\) \{[\s\S]+return this\.settings\.mpvPilotEnabled === true;/);
  assert.match(userSettingsSource, /setMpvPilotEnabled\(enabled\) \{[\s\S]+this\.settings\.mpvPilotEnabled = enabled === true;[\s\S]+this\._save\(\);[\s\S]+this\._emit\('mpvPilotEnabledChanged'/);

  assert.match(indexSource, /data-tab="playback">재생<\/button>/);
  assert.match(indexSource, /id="appSettingsMpvPilotEnabled"[\s\S]*?<span class="toggle-slider"><\/span>/);
  assert.match(indexSource, /mpv 직접 재생 파일럿/);

  assert.match(appSource, /const mpvPilotEnabled = document\.getElementById\('appSettingsMpvPilotEnabled'\);/);
  assert.match(appSource, /mpvPilotEnabled\.checked = userSettings\.getMpvPilotEnabled\(\);/);
  assert.match(appSource, /document\.getElementById\('appSettingsMpvPilotEnabled'\)\?\.addEventListener\('change', \(e\) => \{[\s\S]+userSettings\.setMpvPilotEnabled\(e\.target\.checked\);/);
  assert.match(appSource, /const locallyEnabled = userSettings\.getMpvPilotEnabled\(\);/);
  assert.match(appSource, /const envEnabled = await window\.electronAPI\.mpvIsEnabled\(\);/);
  assert.match(appSource, /if \(!locallyEnabled && !envEnabled\) return false;/);
});

test('mpv pilot embeds into the BAEFRAME viewer before loading media', () => {
  assert.match(mpvManagerSource, /this\.loadQueue = Promise\.resolve\(\);/);
  assert.match(mpvManagerSource, /async load\(filePath, options = \{\}\) \{[\s\S]+const queuedLoad = this\.loadQueue\.then\(runLoad, runLoad\);[\s\S]+this\.loadQueue = queuedLoad\.catch\(\(\) => \{\}\);[\s\S]+return queuedLoad;/);
  assert.match(mpvManagerSource, /async _load\(filePath, options = \{\}\) \{[\s\S]+await this\.start\(\{ wid: options\.wid \}\);/);
  assert.match(mpvManagerSource, /`--wid=\$\{normalizedWid\}`/);

  assert.match(appSource, /function getMpvEmbedBounds\(\) \{[\s\S]+syncMpvFullscreenViewportInset\(\);[\s\S]+elements\.videoWrapper\?\.getBoundingClientRect\(\)[\s\S]+height: rect\.height/);
  assert.match(appSource, /function getMpvFullscreenControlsInset\(\) \{[\s\S]+document\.body\.classList\.contains\('mpv-pilot-mode'\)[\s\S]+document\.body\.classList\.contains\('app-fullscreen'\)[\s\S]+document\.body\.classList\.contains\('show-controls'\)[\s\S]+elements\.controlsBar\?\.getBoundingClientRect\(\)[\s\S]+elements\.fullscreenSeekbar\?\.getBoundingClientRect\(\)/);
  assert.match(appSource, /function syncMpvFullscreenViewportInset\(\) \{[\s\S]+elements\.videoWrapper\?\.style\.setProperty\('--mpv-fullscreen-controls-inset', `\$\{inset\}px`\);/);
  assert.match(mainStyles, /body\.app-fullscreen\.mpv-pilot-mode\.show-controls \.video-wrapper \{[\s\S]+height: calc\(100vh - var\(--mpv-fullscreen-controls-inset, 0px\)\);/);
  assert.match(appSource, /async function prepareMpvEmbedHost\(\) \{[\s\S]+window\.electronAPI\.mpvPrepareEmbed\(bounds\)/);
  assert.match(appSource, /async function syncMpvEmbedBounds\(\) \{[\s\S]+window\.electronAPI\.mpvUpdateEmbedBounds\(bounds\)/);
  assert.match(appSource, /async function prepareMpvOverlayHost\(\) \{[\s\S]+window\.electronAPI\.mpvPrepareOverlay\(bounds\)/);
  assert.match(appSource, /async function syncMpvOverlayState\(\) \{[\s\S]+window\.electronAPI\.mpvUpdateOverlayState\(state\)/);
  assert.match(appSource, /const embedHost = await prepareMpvEmbedHost\(\);/);
  assert.match(appSource, /await prepareMpvOverlayHost\(\);/);
  assert.match(appSource, /loadResult = await window\.electronAPI\.mpvLoad\(filePath, \{[\s\S]+pause: true,[\s\S]+wid: embedHost\?\.wid,[\s\S]+videoTransform: getMpvVideoTransform\(\)[\s\S]+\}\);/);
  assert.match(appSource, /stop: \(\) => stopCurrentMpvPilotEngine\(\)/);
  assert.match(appSource, /resizeObserver\.observe\(elements\.videoWrapper\);[\s\S]+syncMpvEmbedBounds\(\);/);

  assert.match(videoPlayerSource, /this\.videoWidth = 0;/);
  assert.match(videoPlayerSource, /this\.videoHeight = 0;/);
  assert.match(videoPlayerSource, /this\.videoWidth = Math\.max\(0, Number\(config\.width\) \|\| 0\);/);
  assert.match(videoPlayerSource, /this\.videoHeight = Math\.max\(0, Number\(config\.height\) \|\| 0\);/);
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
  assert.match(loadMpvSource, /const ownsMpvPilotLoad = \(\) => activeMpvPilotLoadToken === loadToken;/);
  assert.match(loadMpvSource, /const clearMpvPilotLoadOwner = \(\) => \{[\s\S]+if \(ownsMpvPilotLoad\(\)\) \{[\s\S]+activeMpvPilotLoadToken = null;[\s\S]+\}/);
  assert.match(loadMpvSource, /const cleanupPendingMpvPilot = async \(\) => \{/);
  assert.match(loadMpvSource, /const cleanupPendingMpvPilot = async \(\) => \{[\s\S]+if \(isStaleVideoLoad\(\) && !ownsMpvPilotLoad\(\)\) \{[\s\S]+return;[\s\S]+\}[\s\S]+if \(mpvLoadStarted\)/);
  assert.match(loadMpvSource, /if \(mpvLoadStarted\) \{[\s\S]+await stopMpvPilotEngine\(\);[\s\S]+\}/);
  assert.match(loadMpvSource, /await window\.electronAPI\?\.mpvDestroyEmbed\?\.\(\);/);
  assert.match(loadMpvSource, /finally \{[\s\S]+clearMpvPilotLoadOwner\(\);[\s\S]+\}/);
  assert.match(loadMpvSource, /const stopCurrentMpvPilotEngine = async \(\) => \{[\s\S]+await stopMpvPilotEngine\(\);[\s\S]+clearMpvPilotLoadOwner\(\);[\s\S]+\};/);
  assert.match(loadMpvSource, /stop: \(\) => stopCurrentMpvPilotEngine\(\)/);
  assert.match(loadMpvSource, /if \(isStaleVideoLoad\(\)\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+return false;[\s\S]+\}/);
  assert.match(loadMpvSource, /catch \(error\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+throw error;[\s\S]+\}/);
  assert.match(loadMpvSource, /if \(!loadResult\?\.success\) \{[\s\S]+await cleanupPendingMpvPilot\(\);[\s\S]+throw new Error/);
});

test('mpv pilot mirrors DOM overlays into a click-through native overlay window', () => {
  assert.match(appSource, /function serializeMpvOverlayMarkerHtml\(\) \{[\s\S]+cloneNode\(true\)[\s\S]+textarea\.textContent = sourceTextarea\.value/);
  assert.match(appSource, /function serializeMpvOverlayTooltipHtml\(\) \{[\s\S]+const tooltipLayer = document\.createElement\('div'\);[\s\S]+document\.querySelectorAll\('\.comment-marker-tooltip'\)\.forEach\(\(tooltip\) => \{[\s\S]+tooltipClone\.style\.position = 'absolute';[\s\S]+tooltipClone\.style\.transform = 'none';[\s\S]+tooltipLayer\.appendChild\(tooltipClone\);[\s\S]+\}\);/);
  assert.match(appSource, /function getMpvOverlayState\(\) \{[\s\S]+drawingDataUrl[\s\S]+onionDataUrl[\s\S]+markerHtml: serializeMpvOverlayMarkerHtml\(\)[\s\S]+tooltipHtml: serializeMpvOverlayTooltipHtml\(\)/);
  assert.match(appSource, /function scheduleMpvOverlayStateSync\(options = \{\}\) \{[\s\S]+syncMpvOverlayState\(\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('drawmove', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\}\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('frameRendered', \(e\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\}\);/);
  assert.match(appSource, /function renderVideoMarkers\(\) \{[\s\S]+scheduleMpvOverlayStateSync\(\);/);
  assert.match(appSource, /function updateVideoMarkersVisibility\(\) \{[\s\S]+scheduleMpvOverlayStateSync\(\);/);
  assert.match(appSource, /const onMouseMove = \(e\) => \{[\s\S]+markerEl\.style\.left = `\$\{newX \* 100\}%`;[\s\S]+markerEl\.style\.top = `\$\{newY \* 100\}%`;[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\};/);
  assert.match(appSource, /const onMouseUp = \(e\) => \{[\s\S]+reviewDataManager\.save\(\);[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+document\.removeEventListener\('mousemove', onMouseMove\);/);
  assert.match(appSource, /const showTooltipHover = \(\) => \{[\s\S]+tooltip\.classList\.add\('visible'\);[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\};/);
  assert.match(appSource, /const hideTooltipHover = \(\) => \{[\s\S]+tooltip\.classList\.remove\('visible'\);[\s\S]+scheduleMpvOverlayStateSync\(\);[\s\S]+\}, 100\);/);
  assert.match(appSource, /function updateMarkerTooltipState\(marker\) \{[\s\S]+marker\.tooltipElement\.classList\.add\('visible', 'pinned'\);[\s\S]+scheduleMpvOverlayStateSync\(\);/);
  assert.match(appSource, /async function stopMpvPilotEngine\(\) \{[\s\S]+await window\.electronAPI\?\.mpvDestroyOverlay\?\.\(\);/);
});

test('mpv overlay throttles live drawing snapshots but forces final drawing sync', () => {
  assert.match(appSource, /const MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS = 48;/);
  assert.match(appSource, /let mpvOverlayStateSyncTimer = null;/);
  assert.match(appSource, /function scheduleMpvOverlayStateSync\(options = \{\}\) \{/);
  assert.match(appSource, /if \(options\.force === true\) \{[\s\S]+if \(mpvOverlayStateSyncTimer\) \{[\s\S]+clearTimeout\(mpvOverlayStateSyncTimer\);[\s\S]+mpvOverlayStateSyncTimer = null;[\s\S]+syncMpvOverlayState\(\);[\s\S]+return;[\s\S]+\}/);
  assert.match(appSource, /if \(options\.liveDrawing === true\) \{[\s\S]+const elapsed = now - mpvOverlayLastLiveDrawSyncAt;[\s\S]+if \(elapsed < MPV_OVERLAY_LIVE_DRAW_SYNC_INTERVAL_MS\) \{/);
  assert.match(appSource, /mpvOverlayStateSyncTimer = setTimeout\(\(\) => \{[\s\S]+mpvOverlayLastLiveDrawSyncAt = Date\.now\(\);[\s\S]+syncMpvOverlayState\(\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('drawmove', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\{ liveDrawing: true \}\);[\s\S]+\}\);/);
  assert.match(appSource, /drawingManager\.addEventListener\('drawend', \(\) => \{[\s\S]+scheduleMpvOverlayStateSync\(\{ force: true \}\);[\s\S]+\}\);/);
});

test('mpv external playback preserves frame seek and loop behavior', () => {
  assert.match(videoPlayerSource, /_handleLoopRestartIfNeeded\(\) \{[\s\S]+this\.seek\(this\.loop\.inPoint\);[\s\S]+this\._emit\('loopRestart'\);[\s\S]+return true;/);
  assert.match(videoPlayerSource, /video\.addEventListener\('timeupdate', \(\) => \{[\s\S]+if \(this\._handleLoopRestartIfNeeded\(\)\) \{[\s\S]+return;[\s\S]+\}/);
  assert.match(videoPlayerSource, /const pollingControls = this\.externalControls;[\s\S]+const pollingEngine = this\.engine;[\s\S]+const status = await pollingControls\.getStatus\(\);[\s\S]+if \(this\.engine !== pollingEngine \|\| this\.externalControls !== pollingControls\) return;/);
  assert.match(videoPlayerSource, /if \(status\.stopped === true\) \{[\s\S]+await pollingControls\?\.stop\?\.\(\);[\s\S]+this\.useHtml5Engine\(\);[\s\S]+this\.isLoaded = false;[\s\S]+this\._emit\('externalstopped', \{ engine: stoppedEngine \}\);[\s\S]+return;[\s\S]+\}/);
  assert.match(appSource, /videoPlayer\.addEventListener\('externalstopped', \(\) => \{[\s\S]+elements\.videoWrapper\?\.classList\.remove\('mpv-pilot-mode'\);[\s\S]+document\.body\.classList\.remove\('mpv-pilot-mode'\);[\s\S]+\}\);/);
  assert.match(videoPlayerSource, /const nextWidth = Number\(status\.width\);[\s\S]+const nextHeight = Number\(status\.height\);[\s\S]+if \(Number\.isFinite\(nextWidth\) && nextWidth > 0 && this\.videoWidth !== nextWidth\) \{[\s\S]+this\.videoWidth = nextWidth;[\s\S]+\}[\s\S]+if \(Number\.isFinite\(nextHeight\) && nextHeight > 0 && this\.videoHeight !== nextHeight\) \{[\s\S]+this\.videoHeight = nextHeight;/);
  assert.match(videoPlayerSource, /let metadataChanged = false;[\s\S]+metadataChanged = true;[\s\S]+if \(metadataChanged\) \{[\s\S]+this\._emit\('loadedmetadata', \{[\s\S]+duration: this\.duration,[\s\S]+totalFrames: this\.totalFrames,[\s\S]+fps: this\.fps,[\s\S]+width: this\.videoWidth,[\s\S]+height: this\.videoHeight,[\s\S]+engine: this\.engine/);
  assert.match(videoPlayerSource, /async _syncExternalStatus\(\) \{[\s\S]+const externalIsPlaying = status\.paused === false;[\s\S]+const nextIsPlaying = !eofReached && externalIsPlaying;[\s\S]+this\.isPlaying = externalIsPlaying;[\s\S]+if \(this\._handleLoopRestartIfNeeded\(\)\) \{[\s\S]+return;[\s\S]+\}[\s\S]+this\.isPlaying = nextIsPlaying;/);

  const seekToFrameMatch = videoPlayerSource.match(/seekToFrame\(frame\) \{([\s\S]*?)\n  \}/);
  assert.ok(seekToFrameMatch, 'seekToFrame should exist');
  assert.match(seekToFrameMatch[1], /if \(this\.engine !== 'html5'\) \{[\s\S]+this\.seek\(time\);[\s\S]+return;/);
});

test('mpv external playback emits ended when keep-open reaches EOF', () => {
  assert.match(mpvManagerSource, /this\.getOptionalProperty\('eof-reached', false\)/);
  assert.match(videoPlayerSource, /this\._externalEndedEmitted = false;/);
  assert.match(videoPlayerSource, /const eofReached = status\.eofReached === true;/);
  assert.match(videoPlayerSource, /const externalIsPlaying = status\.paused === false;[\s\S]+const nextIsPlaying = !eofReached && externalIsPlaying;[\s\S]+this\.isPlaying = externalIsPlaying;[\s\S]+this\.isPlaying = nextIsPlaying;/);
  assert.match(videoPlayerSource, /if \(eofReached && !this\._externalEndedEmitted\) \{[\s\S]+this\._externalEndedEmitted = true;[\s\S]+this\._emit\('ended'\);[\s\S]+\}/);
  assert.match(videoPlayerSource, /if \(!eofReached\) \{[\s\S]+this\._externalEndedEmitted = false;[\s\S]+\}/);
  assert.match(videoPlayerSource, /seek\(time\) \{[\s\S]+this\._externalEndedEmitted = false;/);
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
