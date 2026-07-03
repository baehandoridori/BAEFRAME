const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));

test('comment range track synchronizes the left header height with dynamic lanes', () => {
  assert.match(timelineSource, /_setCommentTrackRowHeight\(height = 24\)/);
  assert.match(timelineSource, /this\.commentTrack\.style\.height = `\$\{height\}px`;/);
  assert.match(timelineSource, /this\.commentLayerHeader\.style\.height = `\$\{height\}px`;/);
  assert.match(timelineSource, /this\.commentLayerHeader\.style\.minHeight = `\$\{height\}px`;/);
  assert.match(timelineSource, /this\._setCommentTrackRowHeight\(targetHeight\);/);
});

test('comment row spacing matches between the layer header column and track column', () => {
  assert.match(mainCss, /\.comment-track\s*\{[\s\S]*?height: 24px;[\s\S]*?margin-bottom: 2px;/);
  assert.match(mainCss, /\.comment-layer-header\s*\{[\s\S]*?height: 24px;[\s\S]*?min-height: 24px;[\s\S]*?margin-bottom: 2px;/);
  assert.match(mainCss, /\.comment-layer-header\s*\{[\s\S]*?transition: height 0\.28s ease, min-height 0\.28s ease;/);
});

test('playlist and empty comment states reset the shared comment row height', () => {
  assert.match(timelineSource, /clearCommentTrackRowHeight\(\)/);
  assert.match(timelineSource, /this\._setCommentTrackRowHeight\(\);/);
  assert.match(timelineSource, /renderPlaylistCommentRanges\(ranges, totalDuration\) \{[\s\S]*?this\._setCommentTrackRowHeight\(\);/);
});
