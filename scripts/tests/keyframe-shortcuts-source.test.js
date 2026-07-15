const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
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

test('new drawing layers are inserted above the active layer in the timeline list', () => {
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerSelectUp', e\)[\s\S]{0,140}selectDrawingLayerByOffset\(-1\);/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerSelectDown', e\)[\s\S]{0,140}selectDrawingLayerByOffset\(1\);/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerMoveUp', e\)[\s\S]{0,140}moveDrawingLayerByOffset\(-1\);/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerMoveDown', e\)[\s\S]{0,140}moveDrawingLayerByOffset\(1\);/);
  assert.match(appSource, /패널은 배열 인덱스 0이 최상단이므로 activeIndex 위치에 삽입한다\./);
  assert.match(appSource, /const insertIndex = activeIndex === -1 \? drawingManager\.layers\.length : activeIndex;/);
  assert.match(appSource, /const insertBeforeLayerId = activeIndex === -1 \? null : drawingManager\.activeLayerId;/);
});

test('layer settings popup deletes the layer that was right-clicked', () => {
  assert.match(indexSource, /id="layerDeleteBtn"[\s\S]{0,120}>레이어 삭제<\/button>/);
  assert.match(appSource, /const layerDeleteBtn = document\.getElementById\('layerDeleteBtn'\);/);
  assert.match(appSource, /function deleteDrawingLayer\(layerId\) \{[\s\S]{0,300}drawingManager\.layers\.length <= 1/);
  assert.match(appSource, /drawingManager\.deleteLayer\(layerId\)/);
  assert.match(appSource, /layerDeleteBtn\.addEventListener\('click', \(\) => \{[\s\S]{0,120}deleteDrawingLayer\(selectedLayerIdForPopup\);/);
  assert.match(appSource, /function deleteActiveDrawingLayer\(\) \{[\s\S]{0,160}deleteDrawingLayer\(drawingManager\.activeLayerId\);/);
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

test('Animate-style playback, layer toggle, and frame clipboard shortcuts are configured', () => {
  assert.match(userSettingsSource, /playPauseAlt:\s*\{ key: 'KeyV', ctrl: false, shift: true, alt: false/);
  assert.match(userSettingsSource, /drawingLayerVisibilityToggle:\s*\{ key: 'Backquote', ctrl: false, shift: false, alt: false/);
  assert.match(userSettingsSource, /drawingLayerLockToggle:\s*\{ key: 'Digit2', ctrl: true, shift: false, alt: false/);
  assert.match(userSettingsSource, /frameCopy:\s*\{ key: 'KeyC', ctrl: true, shift: false, alt: true/);
  assert.match(userSettingsSource, /framePaste:\s*\{ key: 'KeyV', ctrl: true, shift: false, alt: true/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerVisibilityToggle', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingLayerLockToggle', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('frameCopy', e\)/);
  assert.match(appSource, /userSettings\.matchShortcut\('framePaste', e\)/);
  assert.match(drawingManagerSource, /copyFrames\(targets = null\)/);
  assert.match(drawingManagerSource, /pasteFrames\(targetFrame = this\.currentFrame\)/);
  assert.match(userSettingsSource, /drawingToolSelect:\s*\{ key: 'KeyV', ctrl: false, shift: false, alt: false/);
  assert.match(appSource, /userSettings\.matchShortcut\('drawingToolSelect', e\)/);
  assert.doesNotMatch(appSource, /\/\/ V: 선택 모드 \(드로잉 모드 끄기\)/);
  // 피드백 33: 드로잉 모드 중 B는 브러시 복귀 → 브러시 상태에서만 모드 종료
  assert.match(appSource, /matchShortcut\('drawMode', e\)[\s\S]{0,600}?currentToolName !== 'brush'/);
  assert.match(appSource, /\[data-tool="brush"\]'\);\s*\n\s*if \(brushBtn\) brushBtn\.click\(\);/);
});
