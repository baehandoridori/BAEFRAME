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

test('html5 load path feeds probed fps into the video player', () => {
  assert.match(appSource, /async function resolveHtml5PlaybackFps\(filePath\)/);
  // 참고: 이 추출 정규식은 기존 mpv-runtime-source.test.js:104와 같은 관례로,
  // 실제로는 loadVideo보다 넓은 범위(다음 함수 포함)를 캡처한다 — 단언 목적에는 충분.
  const loadVideoMatch = appSource.match(/async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//);
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];
  assert.match(loadVideoSource, /let html5ProbedFps = null;/);
  assert.match(loadVideoSource, /videoPlayer\.setFps\(html5Fps\);/);
});

test('timecode formatters round fps for frame digits (fractional fps safe)', () => {
  const timecodeMatch = videoPlayerSource.match(/timeToTimecode\(time\) \{([\s\S]*?)\n  \}/);
  assert.ok(timecodeMatch, 'timeToTimecode should exist');
  assert.match(timecodeMatch[1], /Math\.max\(1, Math\.round\(Number\(this\.fps\) \|\| 24\)\)/);

  assert.match(appSource, /function formatTimecode\(seconds, fps = 24\) \{[\s\S]*?Math\.max\(1, Math\.round\(Number\(fps\) \|\| 24\)\)/);
  assert.match(appSource, /function formatFpsLabel\(fps\)/);
  assert.match(appSource, /\$\{formatFpsLabel\(videoPlayer\.fps\)\}fps · Frame/);
  assert.match(timelineSource, /_formatTimecode\(time\) \{[\s\S]*?Math\.max\(1, Math\.round\(Number\(this\.fps\) \|\| 24\)\)/);
});
