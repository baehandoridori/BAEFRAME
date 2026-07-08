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

test('shift and ctrl keyframe clicks update selection before any drag ghost is created', () => {
  assert.match(timelineSource, /this\.lastSelectedKeyframe = null/);
  assert.match(timelineSource, /_handleKeyframePointerDown\(e, layerId, frame\)/);
  assert.match(timelineSource, /if \(e\.shiftKey\) \{[\s\S]*?this\._selectKeyframeRange\(layerId, frame, e\.ctrlKey \|\| e\.metaKey\);/);
  assert.match(timelineSource, /this\._toggleKeyframeSelection\(layerId, frame, true\);/);
  assert.match(timelineSource, /const wasSelected = this\._isKeyframeSelected\(layerId, frame\);[\s\S]*?return !wasSelected;/);
  assert.match(timelineSource, /this\._setKeyframeSelection\(nextSelection, \{ anchor: \{ layerId, frame \} \}\);/);
  assert.match(timelineSource, /nextSelection\.some\(item =>[\s\S]*item\.layerId === this\.lastSelectedKeyframe\?\.layerId/);

  const markerMouseDown = timelineSource.match(/marker\.addEventListener\('mousedown', \(e\) => \{([\s\S]*?)\n      \}\);/);
  assert.ok(markerMouseDown, 'rendered keyframe marker mousedown handler should exist');
  assert.ok(
    markerMouseDown[1].indexOf('const shouldStartDrag = this._handleKeyframePointerDown(e, layer.id, range.start);') <
      markerMouseDown[1].indexOf('this._startKeyframeDrag(e, layer.id, range.start, marker);'),
    'selection must update before drag ghost creation'
  );
  assert.match(markerMouseDown[1], /if \(shouldStartDrag === false\) return;/);
});

test('shift range selection is limited to the clicked drawing layer keyframes', () => {
  assert.match(timelineSource, /_selectKeyframeRange\(layerId, frame, addToSelection = false\) \{/);
  assert.match(timelineSource, /const anchor = this\.lastSelectedKeyframe\?\.layerId === layerId/);
  assert.match(timelineSource, /this\._getLayerKeyframeFrames\(layerId\)/);
  assert.match(timelineSource, /frameNumber >= startFrame && frameNumber <= endFrame/);
  assert.match(timelineSource, /this\._setKeyframeSelection\(nextSelection, \{ anchor: \{ layerId, frame \} \}\);/);
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

test('moved keyframes refresh selection through the timeline setter', () => {
  assert.match(timelineSource, /setKeyframeSelection\(selection, options = \{\}\) \{/);
  assert.match(timelineSource, /this\._setKeyframeSelection\(selection, options\);/);
  assert.match(appSource, /const movedSelection = keyframes\.map\(kf => \(\{/);
  assert.match(appSource, /timeline\.setKeyframeSelection\(movedSelection\)/);
  assert.doesNotMatch(appSource, /timeline\.selectedKeyframes\s*=\s*keyframes\.map/);
});

test('single remaining keyframe can be deleted', () => {
  assert.doesNotMatch(drawingManagerSource, /마지막 키프레임은 삭제할 수 없습니다/);
  assert.doesNotMatch(drawingManagerSource, /layer\.keyframes\.length <= 1/);
});

test('lasso selection selects keyframes that intersect the drag box', () => {
  const finishSelectionMatch = timelineSource.match(/_finishSelection\(e\) \{([\s\S]*?)\n  \}/);
  assert.ok(finishSelectionMatch, 'finish selection method should exist');
  assert.match(finishSelectionMatch[1], /markerRect\.right >= boxRect\.left/);
  assert.match(finishSelectionMatch[1], /markerRect\.left <= boxRect\.right/);
  assert.match(finishSelectionMatch[1], /markerRect\.bottom >= boxRect\.top/);
  assert.match(finishSelectionMatch[1], /markerRect\.top <= boxRect\.bottom/);
  assert.doesNotMatch(finishSelectionMatch[1], /markerRect\.left >= boxRect\.left &&[\s\S]*markerRect\.right <= boxRect\.right/);
});

test('selection state is normalized through the shared setter', () => {
  const setSelectionMatch = timelineSource.match(/_setKeyframeSelection\(selection, \{ anchor = null \} = \{\}\) \{([\s\S]*?)\n  \}/);
  assert.ok(setSelectionMatch, 'shared selection setter should exist');
  assert.match(setSelectionMatch[1], /const normalizedSelection = \[\]/);
  assert.match(setSelectionMatch[1], /normalizedSelection\.push\(normalized\)/);
  assert.doesNotMatch(setSelectionMatch[1], /keyframe\.layerId =/);
  assert.doesNotMatch(setSelectionMatch[1], /keyframe\.frame =/);

  const startSelectionMatch = timelineSource.match(/_startSelection\(e\) \{([\s\S]*?)\n  \}/);
  assert.ok(startSelectionMatch, 'selection-box start method should exist');
  assert.match(startSelectionMatch[1], /this\._setKeyframeSelection\(\[\]\)/);
});
