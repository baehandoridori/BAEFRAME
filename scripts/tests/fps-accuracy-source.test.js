const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const readSource = (relPath) =>
  normalizeNewlines(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));

const ffmpegManagerSource = readSource('main/ffmpeg-manager.js');
const videoPlayerSource = readSource('renderer/scripts/modules/video-player.js');
const appSource = readSource('renderer/scripts/app.js');
const timelineSource = readSource('renderer/scripts/modules/timeline.js');
const commentManagerSource = readSource('renderer/scripts/modules/comment-manager.js');
const drawingManagerSource = readSource('renderer/scripts/modules/drawing-manager.js');
const webViewerSource = readSource('web-viewer/scripts/app.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('package exposes an fps accuracy test command', () => {
  assert.match(packageJson.scripts['test:fps'], /fps-accuracy-source\.test\.js/);
});

test('ffprobe frame rate keeps fractional fps instead of integer rounding', () => {
  const parseMatch = ffmpegManagerSource.match(/_parseFrameRate\(rateStr\) \{([\s\S]*?)\n  \}/);
  assert.ok(parseMatch, '_parseFrameRate should exist');
  const parseSource = parseMatch[1];
  assert.doesNotMatch(parseSource, /Math\.round\(parseInt\(parts\[0\]\) \/ parseInt\(parts\[1\]\)\)/);
  assert.match(parseSource, /Math\.round\(fps \* 1000\) \/ 1000/);
});

test('video player resets fps on unload and setFps refreshes metadata', () => {
  const unloadMatch = videoPlayerSource.match(/unload\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(unloadMatch, 'unload should exist');
  assert.match(unloadMatch[1], /this\.fps = 24;/);

  const setFpsMatch = videoPlayerSource.match(/setFps\(fps\) \{([\s\S]*?)\n  \}/);
  assert.ok(setFpsMatch, 'setFps should exist');
  assert.match(setFpsMatch[1], /normalizeFpsValue\(fps\)/);
  assert.match(setFpsMatch[1], /this\._emit\('loadedmetadata'/);

  // mpv/ffprobe 양쪽 fps를 소수점 3자리로 통일하는 정규화 헬퍼 (설계 결정 2)
  assert.match(videoPlayerSource, /function normalizeFpsValue\(value, fallback = null\) \{/);
  assert.match(videoPlayerSource, /Math\.round\(fps \* 1000\) \/ 1000;/);
  assert.match(videoPlayerSource, /this\.fps = Math\.max\(1, normalizeFpsValue\(config\.fps\) \?\? this\.fps \?\? 24\);/);
  assert.match(videoPlayerSource, /const nextFps = normalizeFpsValue\(status\.fps\);/);
});
