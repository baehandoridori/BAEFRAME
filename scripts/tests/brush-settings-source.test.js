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
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('brush and eraser settings are persisted through user settings', () => {
  assert.match(userSettingsSource, /brushSettings:\s*\{/);
  assert.match(userSettingsSource, /tool:\s*'brush'/);
  assert.match(userSettingsSource, /brushSize:\s*3/);
  assert.match(userSettingsSource, /eraserSize:\s*20/);
  assert.match(userSettingsSource, /opacity:\s*100/);
  assert.match(userSettingsSource, /strokeEnabled:\s*false/);
  assert.match(userSettingsSource, /getBrushSettings\(\)/);
  assert.match(userSettingsSource, /setBrushSettings\(partial\)/);
  assert.match(userSettingsSource, /this\._emit\('brushSettingsChanged', \{ brushSettings: this\.settings\.brushSettings \}\)/);
  assert.match(userSettingsSource, /Math\.min\(50, Math\.max\(1, parseInt\(merged\.brushSize\) \|\| 3\)\)/);
  assert.match(userSettingsSource, /Math\.min\(50, Math\.max\(1, parseInt\(merged\.eraserSize\) \|\| 20\)\)/);
  assert.match(userSettingsSource, /Math\.min\(100, Math\.max\(10, parseInt\(merged\.opacity\) \|\| 100\)\)/);
});

test('drawing toolbar restores persisted brush state and saves changes deliberately', () => {
  assert.match(appSource, /const savedBrush = userSettings\.getBrushSettings\(\);/);
  assert.match(appSource, /eraser: \{ size: savedBrush\.eraserSize \}/);
  assert.match(appSource, /brush: \{ size: savedBrush\.brushSize, opacity: savedBrush\.opacity \}/);
  assert.match(appSource, /let currentColor = savedBrush\.color;/);
  assert.match(appSource, /function applySavedBrushSettings\(settings = userSettings\.getBrushSettings\(\)\)/);
  assert.match(appSource, /applySavedBrushSettings\(savedBrush\);/);
  assert.match(appSource, /await userSettings\.waitForReady\(\);[\s\S]*applySavedBrushSettings\(userSettings\.getBrushSettings\(\)\);/);
  assert.match(appSource, /userSettings\.setBrushSettings\(\{ tool: toolName, brushSize: toolSettings\.brush\.size, eraserSize: toolSettings\.eraser\.size \}\)/);
  assert.match(appSource, /brushSizeSlider\.addEventListener\('change'/);
  assert.match(appSource, /brushOpacitySlider\.addEventListener\('change'/);
  assert.match(appSource, /strokeToggle\?\.addEventListener\('click'/);
  assert.match(appSource, /strokeWidthSlider\?\.addEventListener\('change'/);
  assert.match(appSource, /data-stroke-color/);
});

test('alt drag adjusts brush size before drawing or ctrl eraser handling', () => {
  const mouseDownBody = drawingCanvasSource.match(/_onMouseDown\(e\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.match(drawingCanvasSource, /this\.isSizeAdjusting = false;/);
  assert.match(drawingCanvasSource, /pointerdown/);
  assert.match(drawingCanvasSource, /_onPointerDown\(e\)/);
  assert.match(drawingCanvasSource, /_beginSizeAdjust\(e\)/);
  assert.match(drawingCanvasSource, /_updateSizeAdjust\(e\)/);
  assert.match(drawingCanvasSource, /_endSizeAdjust\(\)/);
  assert.match(drawingCanvasSource, /sizeadjuststart/);
  assert.match(drawingCanvasSource, /sizeadjustend/);
  assert.match(mouseDownBody, /e\.altKey && \(e\.button === 0 \|\| e\.button === 2\)/);
  assert.ok(
    mouseDownBody.indexOf('e.altKey') < mouseDownBody.indexOf('this._isCtrlActive(e)'),
    'Alt size adjustment must run before Ctrl eraser handling'
  );
  assert.ok(
    mouseDownBody.indexOf('e.altKey') < mouseDownBody.indexOf('typeof this.canDraw'),
    'Alt size adjustment must not be blocked by drawing-layer lock gates'
  );
  assert.match(drawingCanvasSource, /contextmenu/);
  assert.match(drawingCanvasSource, /this\.setLineWidth\(nextSize\)/);
});

test('alt drag size adjustment follows pen pointer events until pointer release', () => {
  assert.match(drawingCanvasSource, /e\.pointerType === 'pen'/);
  assert.match(drawingCanvasSource, /e\.altKey && \(e\.button === 0 \|\| e\.button === 2\)/);
  assert.match(drawingCanvasSource, /this\.canvas\.setPointerCapture\?\.\(e\.pointerId\)/);
  assert.match(drawingCanvasSource, /window\.addEventListener\('pointermove', this\._sizeAdjustMoveHandler/);
  assert.match(drawingCanvasSource, /window\.addEventListener\('pointerup', this\._sizeAdjustEndHandler/);
  assert.match(drawingCanvasSource, /event\.pointerId !== this\._activeSizeAdjustPointerId/);
  assert.match(drawingCanvasSource, /window\.removeEventListener\('pointermove', this\._sizeAdjustMoveHandler\)/);
  assert.match(drawingCanvasSource, /window\.removeEventListener\('pointerup', this\._sizeAdjustEndHandler\)/);
});

test('brush size HUD and bracket shortcuts are wired for drawing mode only', () => {
  assert.match(indexSource, /id="brushSizeHud"/);
  assert.match(mainCss, /\.brush-size-hud/);
  assert.match(mainCss, /\.brush-size-hud::after/);
  assert.match(mainCss, /content:\s*attr\(data-size-label\)/);
  assert.match(appSource, /brushSizeHud/);
  assert.match(appSource, /showBrushSizeHud/);
  assert.match(appSource, /hideBrushSizeHud/);
  assert.match(appSource, /brushSizeHud\.dataset\.sizeLabel = `\$\{size\}px`;/);
  assert.match(appSource, /brushSizeHud\.textContent = '';/);
  assert.doesNotMatch(appSource, /Math\.min\(96, Math\.max\(28, Math\.round\(size \* scale\)\)\)/);
  assert.match(appSource, /sizeadjuststart/);
  assert.match(appSource, /sizeadjustend/);
  assert.match(userSettingsSource, /brushSizeDown:\s*\{ key: 'BracketLeft'/);
  assert.match(userSettingsSource, /brushSizeUp:\s*\{ key: 'BracketRight'/);
  assert.match(appSource, /const matchedBrushSizeAction = userSettings\.findActionByEvent\(e\);/);
  assert.match(appSource, /matchedBrushSizeAction === 'brushSizeDown'/);
  assert.match(appSource, /matchedBrushSizeAction === 'brushSizeUp'/);
  assert.match(appSource, /'그리기 보조': \['onionSkinToggle', 'prevFrameDraw', 'nextFrameDraw', 'brushSizeDown', 'brushSizeUp'\]/);
});

test('drawing test script includes the brush settings source coverage', () => {
  assert.match(packageJson.scripts['test:drawing'], /brush-settings-source\.test\.js/);
});
