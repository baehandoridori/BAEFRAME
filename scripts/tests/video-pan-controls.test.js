import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');

const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|\\n)${escapedSelector}\\s*\\{`).exec(mainCss);
  const start = match ? match.index + match[1].length : -1;
  assert.notEqual(start, -1, `${selector} CSS block should exist`);
  const open = mainCss.indexOf('{', start);
  const close = mainCss.indexOf('\n}', open);
  assert.notEqual(close, -1, `${selector} CSS block should close`);
  return mainCss.slice(open + 1, close);
}

function jsFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} function should exist`);
  const close = appSource.indexOf('\n  }', start);
  assert.notEqual(close, -1, `${name} function should close`);
  return appSource.slice(start, close + 4);
}

test('video center lock is exposed as a persisted zoom-control toggle', () => {
  assert.match(indexSource, /id="btnVideoCenterLock"/);
  assert.match(indexSource, /aria-label="화면 중앙 고정"/);
  assert.match(mainCss, /\.video-zoom-btn\.active/);
  assert.match(userSettingsSource, /videoCenterLocked: true/);
  assert.match(userSettingsSource, /getVideoCenterLocked\(\)/);
  assert.match(userSettingsSource, /setVideoCenterLocked\(locked\)/);
});

test('video can be panned at 100 percent or below when center lock is off', () => {
  assert.match(appSource, /videoCenterLocked: userSettings\.getVideoCenterLocked\(\)/);
  assert.match(appSource, /function canPanVideo\(\) \{[\s\S]*state\.videoZoom > 100 \|\| !state\.videoCenterLocked[\s\S]*\}/);
  assert.match(appSource, /if \(canPanVideo\(\) && e\.button === 0\) \{/);
  assert.doesNotMatch(appSource, /state\.videoZoom > 100 && !state\.isDrawMode && e\.button === 0/);
});

test('center lock keeps 100 percent and smaller zoom levels centered', () => {
  assert.match(appSource, /function shouldCenterVideo\(\) \{[\s\S]*state\.videoCenterLocked && state\.videoZoom <= 100[\s\S]*\}/);
  assert.match(appSource, /if \(shouldCenterVideo\(\)\) \{[\s\S]*state\.videoPanX = 0;[\s\S]*state\.videoPanY = 0;[\s\S]*\}/);
  assert.match(appSource, /setVideoCenterLocked\(!state\.videoCenterLocked\)/);
});

test('video bottom seekbar stays slim until hover or active scrubbing', () => {
  assert.match(mainCss, /\.seekbar-track\s*\{[\s\S]*height:\s*4px;/);
  assert.match(mainCss, /\.fullscreen-seekbar:hover \.seekbar-track,\s*\.fullscreen-seekbar\.is-scrubbing \.seekbar-track\s*\{[\s\S]*height:\s*12px;/);
  assert.match(mainCss, /\.fullscreen-seekbar:hover \.seekbar-handle,\s*\.fullscreen-seekbar\.is-scrubbing \.seekbar-handle\s*\{[\s\S]*opacity:\s*1;/);
  assert.match(appSource, /function setFullscreenSeekbarScrubbing\(scrubbing\) \{[\s\S]*fullscreenSeekbar\?\.classList\.toggle\('is-scrubbing', scrubbing\);[\s\S]*\}/);
});

test('video bottom seekbar handle grows as a centered circular grip', () => {
  assert.match(mainCss, /\.seekbar-handle\s*\{[\s\S]*top:\s*28px;[\s\S]*transform:\s*translate\(-50%, -50%\);[\s\S]*width:\s*12px;[\s\S]*height:\s*12px;[\s\S]*z-index:\s*2;/);
  assert.match(mainCss, /\.fullscreen-seekbar:hover \.seekbar-handle,\s*\.fullscreen-seekbar\.is-scrubbing \.seekbar-handle\s*\{[\s\S]*width:\s*22px;[\s\S]*height:\s*22px;[\s\S]*box-shadow:/);
});

test('video bottom seekbar handle is layered above the track so the circle rises over the bar', () => {
  assert.match(indexSource, /<div class="fullscreen-seekbar" id="fullscreenSeekbar">\s*<div class="seekbar-track">\s*<div class="seekbar-progress" id="seekbarProgress"><\/div>\s*<\/div>\s*<div class="seekbar-handle" id="seekbarHandle"><\/div>\s*<\/div>/);
  assert.match(mainCss, /\.fullscreen-seekbar\s*\{[\s\S]*top:\s*-28px;[\s\S]*height:\s*44px;[\s\S]*padding:\s*0;/);
  assert.match(mainCss, /\.seekbar-track\s*\{[\s\S]*position:\s*absolute;[\s\S]*top:\s*28px;[\s\S]*transform:\s*translateY\(-50%\);[\s\S]*z-index:\s*1;/);
});

test('playback controls allow the enlarged seekbar handle above the bar in normal and fullscreen modes', () => {
  const normalControls = cssBlock('.controls-bar');
  const fullscreenControls = cssBlock('body.app-fullscreen .controls-bar');

  assert.match(normalControls, /overflow:\s*visible;/);
  assert.doesNotMatch(normalControls, /overflow-x:\s*auto;/);
  assert.match(fullscreenControls, /overflow:\s*visible;/);
});

test('middle-button drag scrubs video in normal and fullscreen modes', () => {
  const canStartMiddleScrub = jsFunction('canStartFullscreenMiddleScrub');

  assert.match(appSource, /isFullscreenScrubbing:\s*false/);
  assert.match(canStartMiddleScrub, /e\.button === 1/);
  assert.match(canStartMiddleScrub, /!state\.isDrawMode/);
  assert.match(canStartMiddleScrub, /videoPlayer\.isLoaded/);
  assert.match(canStartMiddleScrub, /videoPlayer\.duration > 0/);
  assert.doesNotMatch(canStartMiddleScrub, /state\.isFullscreen/);
  assert.match(appSource, /function startFullscreenMiddleScrub\(e\) \{[\s\S]*state\.fullscreenScrubStartX = e\.clientX;[\s\S]*state\.fullscreenScrubStartTime = videoPlayer\.currentTime \|\| 0;[\s\S]*showFullscreenScrubOverlay/);
  assert.match(appSource, /function updateFullscreenMiddleScrub\(e\) \{[\s\S]*const timeDelta = \(dx \/ Math\.max\(1, window\.innerWidth\)\) \* state\.fullscreenScrubDuration;[\s\S]*videoPlayer\.seek\(targetTime\);[\s\S]*\}/);
  assert.match(appSource, /elements\.videoWrapper\?\.addEventListener\('auxclick', \(e\) => \{[\s\S]*if \(e\.button === 1\) \{[\s\S]*e\.preventDefault\(\);/);
  assert.match(mainCss, /\.fullscreen-scrub-overlay\s*\{/);
  assert.match(mainCss, /\.fullscreen-scrub-overlay\.visible\s*\{/);
});

test('timeline height resizer sits below playback controls, not on the seekbar edge', () => {
  const controlsIndex = indexSource.indexOf('<!-- Playback Controls -->');
  const resizerIndex = indexSource.indexOf('id="viewerResizer"');
  const timelineIndex = indexSource.indexOf('<!-- Timeline -->');

  assert.notEqual(controlsIndex, -1, 'playback controls markup should exist');
  assert.notEqual(resizerIndex, -1, 'timeline height resizer should exist');
  assert.notEqual(timelineIndex, -1, 'timeline markup should exist');
  assert.ok(
    controlsIndex < resizerIndex && resizerIndex < timelineIndex,
    'timeline height resizer should be between playback controls and timeline'
  );
  assert.match(indexSource, /id="viewerResizer"[^>]*title="타임라인 높이 조절"/);
});
