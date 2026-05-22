const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const drawingCanvasSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-canvas.js'), 'utf8'));
const drawingManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-manager.js'), 'utf8'));
const drawingSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/drawing-sync.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));

test('drawing tools expose a persisted eraser mode segmented control', () => {
  assert.match(indexSource, /id="eraserModeSection"/);
  assert.match(indexSource, /data-eraser-mode="pixel"/);
  assert.match(indexSource, /data-eraser-mode="stroke"/);
  assert.match(mainCss, /\.eraser-mode-toggle/);
  assert.match(userSettingsSource, /eraserMode:\s*'pixel'/);
  assert.match(userSettingsSource, /getEraserMode\(\)/);
  assert.match(userSettingsSource, /setEraserMode\(mode\)/);
  assert.match(appSource, /userSettings\.getEraserMode\(\)/);
  assert.match(appSource, /drawingManager\.setEraserMode\(mode\)/);
});

test('eraser tool hides color-only controls and uses a neutral size preview', () => {
  assert.match(indexSource, /id="colorSection"/);
  assert.match(appSource, /const colorSection = document\.getElementById\('colorSection'\);/);
  assert.match(appSource, /const strokeSection = document\.getElementById\('strokeSection'\);/);
  assert.match(appSource, /colorSection\.style\.display = 'none';/);
  assert.match(appSource, /colorSection\.style\.display = 'block';/);
  assert.match(appSource, /strokeSection\.style\.display = 'none';/);
  assert.match(appSource, /strokeSection\.style\.display = 'block';/);
  assert.match(appSource, /sizePreview\.classList\.toggle\('eraser-preview', currentToolType === 'eraser'\);/);
  assert.match(mainCss, /\.size-preview\.eraser-preview::after/);
});

test('drawing canvas resolves Ctrl pen and brush strokes as eraser at stroke start', () => {
  assert.match(drawingCanvasSource, /setEraserMode\(mode\)/);
  assert.match(drawingCanvasSource, /_resolveEffectiveTool\(e\)/);
  assert.match(drawingCanvasSource, /e\.ctrlKey/);
  assert.match(drawingCanvasSource, /this\.activeTool = this\._resolveEffectiveTool\(e\);/);
  assert.match(drawingCanvasSource, /effectiveTool: this\.activeTool/);
  assert.match(drawingCanvasSource, /eraserMode: this\.activeEraserMode/);
});

test('drawing manager records freehand strokes and erases intersecting stroke records', () => {
  assert.match(drawingManagerSource, /createStrokeRecord/);
  assert.match(drawingManagerSource, /removeIntersectingStrokes/);
  assert.match(drawingManagerSource, /_onDrawMove\(detail\)/);
  assert.match(drawingManagerSource, /_saveRecordableStroke\(detail\)/);
  assert.match(drawingManagerSource, /_eraseStrokeRecords\(detail\)/);
  assert.match(drawingManagerSource, /_freezeStrokeRecords/);
  assert.match(drawingManagerSource, /keyframe\.baseCanvasData/);
  assert.match(drawingManagerSource, /keyframe\.strokeRecords/);
});

test('stroke eraser edits the held source keyframe instead of creating a new frame', () => {
  assert.match(drawingManagerSource, /_getEditableKeyframeForCurrentFrame\(options = \{\}\)/);
  assert.match(drawingManagerSource, /options\.editHeldSourceKeyframe === true/);
  assert.match(drawingManagerSource, /const sourceKeyframe = layer\.getKeyframeAtFrame\(this\.currentFrame\);/);
  assert.match(drawingManagerSource, /if \(sourceKeyframe && options\.editHeldSourceKeyframe === true\) \{[\s\S]*?return sourceKeyframe;/);
});

test('stroke eraser gestures do not stream as live pixel eraser strokes to collaborators', () => {
  assert.match(drawingSyncSource, /eraserMode === 'stroke'/);
  assert.match(drawingSyncSource, /return;/);
  assert.match(drawingSyncSource, /strokeRecords: keyframe\.strokeRecords/);
  assert.match(drawingSyncSource, /baseCanvasData: keyframe\.baseCanvasData/);
});
