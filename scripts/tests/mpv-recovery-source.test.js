const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const readSource = (relPath) =>
  normalizeNewlines(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));

const videoPlayerSource = readSource('renderer/scripts/modules/video-player.js');
const appSource = readSource('renderer/scripts/app.js');
const windowSource = readSource('main/window.js');
const preloadSource = readSource('preload/preload.js');
const ipcSource = readSource('main/ipc-handlers.js');
const mainStyles = readSource('renderer/styles/main.css');
const mpvManagerSource = readSource('main/mpv-manager.js');
const userSettingsSource = readSource('renderer/scripts/modules/user-settings.js');

test('external status polling escalates repeated failures to a stop event', () => {
  assert.match(videoPlayerSource, /this\._externalStatusFailureCount = 0;/);
  const watchdogMatch = videoPlayerSource.match(/async _registerExternalStatusFailure\(pollingControls\) \{([\s\S]*?)\n  \}/);
  assert.ok(watchdogMatch, 'watchdog method should exist');
  assert.match(watchdogMatch[1], /this\._externalStatusFailureCount \+= 1;/);
  assert.match(watchdogMatch[1], /reason: 'unresponsive'/);
  assert.match(watchdogMatch[1], /await Promise\.resolve\(pollingControls\?\.stop\?\.\(\)\)/);
  assert.match(watchdogMatch[1], /_emit\('externalstopped', detail\);/);
  assert.match(videoPlayerSource, /await this\._registerExternalStatusFailure\(pollingControls\);/);
});

test('externalstopped carries recovery context', () => {
  assert.match(videoPlayerSource, /_emit\('externalstopped', \{[\s\S]*?engine: stoppedEngine,[\s\S]*?filePath:[\s\S]*?lastFrame:[\s\S]*?reason: 'stopped'/);
});

test('unexpected mpv stop triggers reload with retry policy', () => {
  const handlerMatch = appSource.match(/videoPlayer\.addEventListener\('externalstopped', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(handlerMatch, 'externalstopped handler should exist');
  const handlerSource = handlerMatch[1];
  assert.match(handlerSource, /if \(isAppShuttingDown\) return;/);
  assert.match(handlerSource, /if \(mpvPilotHostPreparing\) return;/);
  assert.match(handlerSource, /if \(hasActiveVideoLoadForDifferentFile\(stoppedFilePath\)\) return;/);
  assert.match(handlerSource, /allowMpvPilot: retryMpv/);
  assert.match(handlerSource, /initialFrame: resumeFrame/);
  assert.match(handlerSource, /showToast\(/);
  assert.match(appSource, /let mpvUnexpectedStopRecovery = \{ filePath: null, attempted: false \};/);
  assert.match(appSource, /isAppShuttingDown = true;/);
});

test('renderer crash and reload clean up mpv processes and hosts', () => {
  assert.match(windowSource, /async function cleanupMpvAfterRendererGone\(reason\)/);
  assert.match(windowSource, /webContents\.on\('render-process-gone'[\s\S]*?cleanupMpvAfterRendererGone/);
  assert.match(windowSource, /webContents\.on\('did-navigate'[\s\S]*?cleanupMpvAfterRendererGone/);
  assert.match(windowSource, /rendererCrashRecoveryCount/);
  assert.match(windowSource, /webContents\.reload\(\)/);
});

test('mpv screenshot ipc channel is wired end to end', () => {
  assert.match(ipcSource, /ipcMain\.handle\('mpv:screenshot'/);
  assert.match(ipcSource, /mpv-frames/);
  assert.match(preloadSource, /mpvScreenshot: \(\) => ipcRenderer\.invoke\('mpv:screenshot'\),/);
});

test('draw mode shows a frozen mpv frame under the drawing canvases', () => {
  assert.match(appSource, /async function showMpvDrawFreezeFrame\(\)/);
  assert.match(appSource, /function removeMpvDrawFreezeFrame\(\)/);
  assert.match(appSource, /function scheduleMpvDrawFreezeRefresh\(\)/);
  const applyMatch = appSource.match(/function applyDrawModeState\(enabled\) \{([\s\S]*?)\n  \}/);
  assert.ok(applyMatch, 'applyDrawModeState should exist');
  assert.match(applyMatch[1], /videoPlayer\.pause\(\);/);
  assert.match(applyMatch[1], /showMpvDrawFreezeFrame\(\)/);
  assert.match(applyMatch[1], /removeMpvDrawFreezeFrame\(\)/);
  assert.match(appSource, /videoPlayer\.addEventListener\('frameUpdate'[\s\S]*?scheduleMpvDrawFreezeRefresh\(\);/);
  assert.match(videoPlayerSource, /isSeeking\(\) \{/);
  assert.match(mainStyles, /\.mpv-draw-freeze-frame \{/);
});

test('mpv draw freeze frame is cleared and refreshed across media changes', () => {
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  assert.match(loadVideoMatch[1], /removeMpvDrawFreezeFrame\(\);/);

  const loadMpvMatch = appSource.match(/async function loadVideoWithMpvPilot\(filePath, \{([\s\S]*?)\n  \}\n\n  async function resolveMpvThumbnailVideoPath/);
  assert.ok(loadMpvMatch, 'loadVideoWithMpvPilot should exist');
  assert.match(loadMpvMatch[1], /if \(state\.isDrawMode\) \{[\s\S]*?await showMpvDrawFreezeFrame\(\);[\s\S]*?\}/);
});

test('mpv playback is enabled by default with legacy pilot key migration', () => {
  assert.match(userSettingsSource, /mpvPlaybackEnabled: true,/);
  assert.doesNotMatch(userSettingsSource, /mpvPilotEnabled: false,/);
  assert.match(userSettingsSource, /getMpvPlaybackEnabled\(\) \{[\s\S]+?return this\.settings\.mpvPlaybackEnabled !== false;/);
  assert.match(userSettingsSource, /setMpvPlaybackEnabled\(enabled\) \{[\s\S]+?this\.settings\.mpvPlaybackEnabled = enabled === true;[\s\S]+?this\._save\(\);/);
  const migrateMatch = userSettingsSource.match(/_migrateLegacySettings\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(migrateMatch, 'legacy settings migration should exist');
  assert.match(migrateMatch[1], /delete this\.settings\.mpvPilotEnabled;/);

  const loadFromStorageMatch = userSettingsSource.match(/_loadFromStorage\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadFromStorageMatch, '_loadFromStorage should exist');
  assert.match(loadFromStorageMatch[1], /this\._migrateLegacySettings\(\);/);
  const loadFromFileMatch = userSettingsSource.match(/async _loadFromFile\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadFromFileMatch, '_loadFromFile should exist');
  assert.match(loadFromFileMatch[1], /this\._migrateLegacySettings\(\);/);
});

test('mpv can be disabled per machine via env for troubleshooting', () => {
  assert.match(mpvManagerSource, /function isMpvPlaybackDisabledByEnv\(env = process\.env\)/);
  assert.match(mpvManagerSource, /BAEFRAME_DISABLE_MPV/);
  const availableMatch = mpvManagerSource.match(/isAvailable\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(availableMatch, 'isAvailable should exist');
  assert.match(availableMatch[1], /isMpvPlaybackDisabledByEnv\(this\.env\)/);
});
