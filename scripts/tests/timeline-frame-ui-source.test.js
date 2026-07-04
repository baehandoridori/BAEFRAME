const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('playhead position is centered within the current frame cell', () => {
  assert.match(timelineSource, /_getDisplayTotalFrames\(\)/);
  assert.match(timelineSource, /_getPlayheadFrameCenterPx\(time = this\.currentTime\)/);
  assert.match(timelineSource, /const frame = Math\.max\(0, Math\.min\(totalFrames - 1, rawFrame\)\);/);
  assert.match(timelineSource, /return \(\(frame \+ 0\.5\) \/ totalFrames\) \* containerWidth;/);
  assert.match(timelineSource, /const positionPx = this\._getPlayheadFrameCenterPx\(time\);/);
  assert.match(timelineSource, /const positionPx = this\._getPlayheadFrameCenterPx\(\);/);
  assert.match(timelineSource, /const playheadPx = this\._getPlayheadFrameCenterPx\(\);/);
});

test('drawing hold ranges are filled with the layer color', () => {
  assert.match(timelineSource, /rangeBar\.style\.setProperty\('--kf-color', layer\.color\);/);
  assert.doesNotMatch(timelineSource, /rangeBar\.style\.background = '#5a5a5a'/);
  assert.match(mainCss, /\.keyframe-range-bar\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--kf-color, #4a9eff\) 34%, transparent\);/);
  assert.match(mainCss, /\.keyframe-range-bar\s*\{[\s\S]*?box-shadow:\s*inset 1px 0 0 color-mix\(in srgb, var\(--kf-color, #4a9eff\) 70%, transparent\);/);
});

test('frame grid overlay is pinned to the same pixel width as the tracks', () => {
  assert.match(timelineSource, /_syncFrameGridContainerMetrics\(\)/);
  assert.match(timelineSource, /const contentWidth = this\.tracksContainer\.offsetWidth \|\| 0;/);
  assert.match(timelineSource, /this\.frameGridContainer\.style\.width = `\$\{contentWidth\}px`;/);
  assert.match(timelineSource, /_formatGridPx\(value\)/);
  assert.match(timelineSource, /backgroundPosition = '0px 0px';/);
  assert.match(timelineSource, /sizes\.push\(`\$\{this\._formatGridPx\(pxPerFrame\)\} 100%`\);/);
});

test('timeline frame UI source coverage runs with frame grid tests', () => {
  assert.match(packageJson.scripts['test:frame-grid'], /timeline-frame-ui-source\.test\.js/);
});
