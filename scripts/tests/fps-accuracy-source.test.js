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
