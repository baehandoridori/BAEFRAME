const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const drawingLayerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-layer.js'), 'utf8'));
const drawingManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-manager.js'), 'utf8'));
const timelineSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/timeline.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('Animate-style drawing layer shortcuts are configured and handled', () => {
  assert.match(userSettingsSource, /drawingLayerAdd:\s*\{ key: 'F1', ctrl: false, shift: true, alt: false/);
  assert.match(userSettingsSource, /drawingLayerDelete:\s*\{ key: 'Backquote', ctrl: false, shift: true, alt: false/);
  assert.match(userSettingsSource, /drawingLayerSelectUp:\s*\{ key: 'KeyX', ctrl: false, shift: true, alt: false/);
  assert.match(userSettingsSource, /drawingLayerSelectDown:\s*\{ key: 'KeyC', ctrl: false, shift: true, alt: false/);
  assert.match(userSettingsSource, /drawingLayerMoveUp:\s*\{ key: 'KeyX', ctrl: true, shift: true, alt: false/);
  assert.match(userSettingsSource, /drawingLayerMoveDown:\s*\{ key: 'KeyC', ctrl: true, shift: true, alt: false/);
  assert.match(userSettingsSource, /timelineCenterOnPlayhead:\s*\{ key: 'KeyC', ctrl: false, shift: true, alt: true/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerAdd', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerDelete', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerSelectUp', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerSelectDown', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerMoveUp', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerMoveDown', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('timelineCenterOnPlayhead', e\)/);
  assert.match(appSource, /timeline\.centerOnPlayhead\(\)/);
});

test('DrawingManager supports selecting and moving active layers by offset', () => {
  assert.match(drawingManagerSource, /selectActiveLayerByOffset\(offset\)/);
  assert.match(drawingManagerSource, /moveActiveLayerByOffset\(offset\)/);
  assert.match(drawingManagerSource, /const targetIndex = index \+ offset;/);
  assert.match(drawingManagerSource, /this\.layers\.splice\(targetIndex, 0, layer\);/);
  assert.match(drawingManagerSource, /this\._emit\('activeLayerChanged'/);
  assert.match(drawingManagerSource, /this\._emit\('layersChanged'\)/);
});

test('frame and keyframe conversion shortcuts are configured and handled', () => {
  assert.match(userSettingsSource, /keyframeConvertToFrame:\s*\{ key: 'Digit2', ctrl: false, shift: true, alt: false/);
  assert.match(userSettingsSource, /keyframeConvertToKeyframe:\s*\{ key: 'Digit3', ctrl: false, shift: true, alt: false/);
  assert.match(appSource, /userSettings\.matchShortcut\('keyframeConvertToFrame', e\)/);
  assert.match(appSource, /drawingManager\.convertKeyframeToFrame\(\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('keyframeConvertToKeyframe', e\)/);
  assert.match(appSource, /drawingManager\.convertFrameToKeyframe\(\)/);
  assert.doesNotMatch(userSettingsSource, /keyframeDeleteAlt/);
});

test('delete frame removes a frame cell without deleting a held keyframe marker', () => {
  assert.match(drawingManagerSource, /layer\.deleteFrame\(this\.currentFrame, this\.totalFrames\);/);
  assert.match(drawingLayerSource, /deleteFrame\(frame, totalFrames = null\)/);
  assert.match(drawingLayerSource, /const hasTimelineTail = Number\.isFinite\(totalFrames\) \? frame < totalFrames - 1 : true;/);
  assert.match(drawingLayerSource, /const currentHasHold = nextKeyframe \? nextKeyframe\.frame > frame \+ 1 : hasTimelineTail;/);
  assert.match(drawingLayerSource, /const heldKeyframe = this\.keyframes/);
  assert.match(drawingLayerSource, /const deletesTailHeldFrame = heldKeyframe && !heldKeyframe\.isEmpty && !nextKeyframe && Number\.isFinite\(totalFrames\)/);
  assert.match(drawingLayerSource, /const tailBoundaryFrame = frame < totalFrames - 1 \? totalFrames : frame;/);
  assert.match(drawingLayerSource, /const tailBoundaryKeyframe = new Keyframe\(tailBoundaryFrame, null\);/);
  assert.match(drawingLayerSource, /this\.keyframes\.push\(tailBoundaryKeyframe\);/);
  assert.match(drawingLayerSource, /const preservesTailBlankBoundary = currentKeyframe\?\.isEmpty && !nextKeyframe && Number\.isFinite\(totalFrames\)/);
  assert.match(drawingLayerSource, /if \(currentKeyframeIndex !== -1 && !currentHasHold && !preservesTailBlankBoundary\) \{/);
  assert.doesNotMatch(drawingLayerSource, /현재 프레임에 키프레임이 있으면 먼저 삭제/);
});

test('timeline can center the viewport on the current playhead', () => {
  assert.match(timelineSource, /centerOnPlayhead\(\)/);
  assert.match(timelineSource, /const targetScrollLeft = playheadPx - \(viewportWidth \/ 2\);/);
  assert.match(timelineSource, /this\.timelineTracks\.scrollLeft = Math\.max\(0, targetScrollLeft\);/);
});

test('keyframe shortcut source coverage is part of the drawing test command', () => {
  assert.match(packageJson.scripts['test:drawing'], /keyframe-shortcuts-source\.test\.js/);
});
