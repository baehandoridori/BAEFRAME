const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));

test('keyframe drag ghost renders as an exact one-frame cell', () => {
  assert.match(timelineSource, /keyframe-drag-ghost-cell/);
  assert.match(timelineSource, /this\.dragGhost = document\.createElement\('div'\)/);
  assert.match(timelineSource, /const ghostWidthPercent = \(1 \/ this\.totalFrames\) \* 100/);
  assert.match(timelineSource, /Math\.floor\(percent \* this\.totalFrames\)/);
  assert.match(timelineSource, /\(\(targetFrame \+ 0\.5\) \/ this\.totalFrames\) \* 100/);
  assert.doesNotMatch(timelineSource, /Math\.round\(percent \* \(this\.totalFrames - 1\)\)/);
  assert.doesNotMatch(timelineSource, /cloneNode\(true\)/);
  assert.match(mainCss, /\.keyframe-drag-ghost-cell\s*\{[\s\S]*?height:\s*100%;[\s\S]*?outline:\s*2px dashed var\(--accent-primary\);/);
});

test('keyframe drag ghost previews every selected keyframe while dragging', () => {
  assert.match(timelineSource, /this\.dragGhostItems = \[\]/);
  assert.match(timelineSource, /this\.dragSourceElements = \[\]/);
  assert.match(timelineSource, /this\.dragGhostKeyframes = \[\]/);
  assert.match(timelineSource, /_getDragGhostKeyframes\(layerId, frame\)/);
  assert.match(timelineSource, /const ghostKeyframes = this\._getDragGhostKeyframes\(layerId, frame\);/);
  assert.match(timelineSource, /this\.dragGhostKeyframes = ghostKeyframes\.map\(keyframe => \(\{ \.\.\.keyframe \}\)\);/);
  assert.match(timelineSource, /ghostKeyframes\.forEach\(keyframe => \{/);
  assert.match(timelineSource, /ghostCell\.dataset\.sourceFrame = keyframe\.frame;/);
  assert.match(timelineSource, /this\.dragGhostItems\.push\(ghostCell\)/);
  assert.match(timelineSource, /const rawFrameDelta = newFrame - this\.dragStartFrame;/);
  assert.match(timelineSource, /const frameDelta = this\._clampKeyframeDragDelta\(rawFrameDelta\);/);
  assert.match(timelineSource, /this\.dragGhostItems\.forEach\(ghostCell => \{/);
  assert.match(timelineSource, /parseInt\(ghostCell\.dataset\.sourceFrame \|\| '0', 10\) \+ frameDelta/);
  assert.match(timelineSource, /this\.dragSourceElements\.forEach\(element => \{/);
  assert.match(timelineSource, /this\.dragGhostItems\.forEach\(ghost => ghost\.remove\(\)\)/);
});

test('keyframe drag ghost clamps group delta before preview and move emit', () => {
  assert.match(timelineSource, /_clampKeyframeDragDelta\(frameDelta\)/);
  assert.match(timelineSource, /const minFrame = Math\.min\(\.\.\.sourceFrames\);/);
  assert.match(timelineSource, /const maxFrame = Math\.max\(\.\.\.sourceFrames\);/);
  assert.match(timelineSource, /const minDelta = -minFrame;/);
  assert.match(timelineSource, /const maxDelta = \(this\.totalFrames - 1\) - maxFrame;/);
  assert.match(timelineSource, /return Math\.max\(minDelta, Math\.min\(maxDelta, frameDelta\)\);/);
  assert.match(timelineSource, /const targetFrame = this\.dragStartFrame \+ frameDelta;/);
  assert.match(timelineSource, /this\.dragGhost\.dataset\.targetFrame = targetFrame;/);
});

test('frame cell mode is stored and wired through the timeline toolbar', () => {
  assert.match(userSettingsSource, /frameCellMode: 'auto'/);
  assert.match(userSettingsSource, /getFrameCellMode\(\)/);
  assert.match(userSettingsSource, /setFrameCellMode\(mode\)/);
  assert.match(userSettingsSource, /this\._emit\('frameCellModeChanged', \{ mode \}\)/);
  assert.match(indexSource, /id="btnFrameCellMode"/);
  assert.match(indexSource, /id="frameCellModeBadge"/);
  assert.match(appSource, /FRAME_CELL_MODE_ORDER = \['auto', 'on', 'off'\]/);
  assert.match(appSource, /timeline\.setFrameCellMode\(initFrameCellMode\)/);
  assert.match(appSource, /userSettings\.setFrameCellMode\(next\)/);
});

test('timeline can switch between dot markers and one-frame keyframe cells', () => {
  assert.match(timelineSource, /this\.frameCellMode = 'auto'/);
  assert.match(timelineSource, /this\._frameCellActive = false/);
  assert.match(timelineSource, /setFrameCellMode\(mode\)/);
  assert.match(timelineSource, /_applyCellModeMinZoom\(\)/);
  assert.match(timelineSource, /resolveFrameCellActive\(this\.frameCellMode, tierResult\)/);
  assert.match(timelineSource, /this\._refreshDrawingLayerRender\(\)/);
  assert.match(timelineSource, /marker\.className = `keyframe-cell keyframe-marker-dot/);
  assert.match(timelineSource, /marker\.style\.setProperty\('--kf-color', layer\.color\)/);
  assert.match(timelineSource, /marker\.innerHTML = '<span class="keyframe-cell-dot" aria-hidden="true"><\/span>'/);
  assert.match(mainCss, /\.keyframe-container \.keyframe-cell\s*\{[\s\S]*?width:[\s\S]*?height:\s*100%;/);
  assert.match(mainCss, /\.keyframe-cell \.keyframe-cell-dot/);
});

test('frame cell ON mode recomputes minimum zoom when the timeline viewport resizes', () => {
  const resizeObserverMatch = timelineSource.match(/const resizeObserver = new ResizeObserver\(\(entries\) => \{([\s\S]*?)\n    \}\);/);
  assert.ok(resizeObserverMatch, 'timeline ResizeObserver should exist');
  assert.match(resizeObserverMatch[1], /this\._applyCellModeMinZoom\(\)/);
  assert.match(resizeObserverMatch[1], /if \(this\.zoom !== prevZoom\) \{[\s\S]*?this\._applyZoom\(\);/);
});
