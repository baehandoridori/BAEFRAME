const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const drawingManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-manager.js'), 'utf8'));
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));

test('drawing timeline box-selects the rendered keyframe markers', () => {
  assert.match(timelineSource, /_shouldStartTimelineLasso\(e\)/);
  assert.match(timelineSource, /querySelectorAll\('\.keyframe-marker, \.keyframe-marker-dot'\)/);
  assert.match(timelineSource, /querySelectorAll\('\.keyframe-marker-dot, \.keyframe-marker'\)/);
});

test('timeline lasso can start from the timeline body while panning stays video-only', () => {
  assert.match(timelineSource, /_shouldStartTimelineLasso\(e\) \{/);
  assert.match(timelineSource, /_shouldStartTimelinePan\(e\) \{/);
  assert.match(timelineSource, /if \(this\._shouldStartTimelineLasso\(e\)\) \{[\s\S]+this\._startSelection\(e\);/);
  assert.match(timelineSource, /if \(this\._shouldStartTimelinePan\(e\)\) \{[\s\S]+this\.isPanning = true;/);
  assert.match(timelineSource, /closest\?\.\('\.video-track-row, \.track-clip\.video'\)/);
  assert.doesNotMatch(timelineSource, /classList\.contains\('frame-grid-container'\)[\s\S]{0,240}this\.isPanning = true/);
});

test('timeline rows expose taller video and keyframe interaction targets', () => {
  assert.match(indexSource, /class="track-row video-track-row"/);
  assert.match(mainCss, /--timeline-video-track-height:\s*48px;/);
  assert.match(mainCss, /--timeline-drawing-track-height:\s*44px;/);
  assert.match(mainCss, /\.tracks-container\s*\{[\s\S]*?min-height:\s*calc\(100% - 32px\);/);
  assert.match(mainCss, /\.video-track-row\s*\{[\s\S]*?height:\s*var\(--timeline-video-track-height\);/);
  assert.match(mainCss, /\.drawing-track-row\s*\{[\s\S]*?min-height:\s*var\(--timeline-drawing-track-height\);/);
  assert.match(mainCss, /\.layer-header\.drawing-layer-header\s*\{[\s\S]*?height:\s*var\(--timeline-drawing-track-height\);/);
});

test('timeline lasso coordinates use scrolled content coordinates only once', () => {
  const startSelectionMatch = timelineSource.match(/_startSelection\(e\) \{([\s\S]*?)\n  \}/);
  assert.ok(startSelectionMatch, 'start selection method should exist');
  assert.doesNotMatch(startSelectionMatch[1], /scrollLeft/);

  const updateSelectionMatch = timelineSource.match(/_updateSelection\(e\) \{([\s\S]*?)\n  \}/);
  assert.ok(updateSelectionMatch, 'update selection method should exist');
  assert.doesNotMatch(updateSelectionMatch[1], /scrollLeft/);
});

test('plain keyframe click selects without immediately toggling the only selected keyframe off', () => {
  assert.match(timelineSource, /_selectKeyframe\(layerId, frame, addToSelection\)/);
  assert.match(timelineSource, /if \(!isSelected && !e\.ctrlKey && !e\.metaKey\)/);
  const toggleMatch = timelineSource.match(/_toggleKeyframeSelection\(layerId, frame, addToSelection\) \{([\s\S]*?)\n  \}/);
  assert.ok(toggleMatch, 'toggle keyframe selection method should exist');
  assert.doesNotMatch(toggleMatch[1], /이미 단독 선택된 상태면 선택 해제/);
});

test('selected keyframes can be deleted through the drawing manager', () => {
  assert.match(drawingManagerSource, /removeKeyframes\(selectedKeyframes = \[\]\)/);
  assert.match(drawingManagerSource, /this\._emit\('keyframeRemoved'/);
  assert.match(appSource, /deleteSelectedOrCurrentKeyframes\(\)/);
  assert.match(appSource, /timeline\.selectedKeyframes/);
  assert.match(appSource, /drawingManager\.removeKeyframes\(selectedKeyframes\)/);
});

test('selected keyframe moves are ordered by drag direction to keep adjacent moves together', () => {
  assert.match(drawingManagerSource, /const frameDelta = \(a\.toFrame - a\.fromFrame\) \|\| \(b\.toFrame - b\.fromFrame\);/);
  assert.match(drawingManagerSource, /if \(frameDelta < 0\) return a\.fromFrame - b\.fromFrame;/);
  assert.match(drawingManagerSource, /if \(frameDelta > 0\) return b\.fromFrame - a\.fromFrame;/);
  assert.doesNotMatch(drawingManagerSource, /sort\(\(a, b\) => b\.fromFrame - a\.fromFrame\)/);
});

test('single remaining keyframe can be deleted', () => {
  assert.doesNotMatch(drawingManagerSource, /마지막 키프레임은 삭제할 수 없습니다/);
  assert.doesNotMatch(drawingManagerSource, /layer\.keyframes\.length <= 1/);
});
