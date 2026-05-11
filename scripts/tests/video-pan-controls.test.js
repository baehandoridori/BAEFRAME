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
