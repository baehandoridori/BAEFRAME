const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const mainCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
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

test('current drawing owns brush input while removed legacy controls cannot bind on startup', () => {
  assert.doesNotMatch(indexSource, /id="(?:drawingTools|brushSizeHud|brushSizeSlider)"/);
  assert.doesNotMatch(mainCss, /\.drawing-tools|\.brush-size-hud/);
  assert.doesNotMatch(appSource, /applySavedBrushSettings|selectDrawingTool|adjustBrushSizeBy/);
  assert.match(appSource, /fabricDrawingPilotController\.routeKeydown\(e\)/);
  assert.match(appSource, /matchShortcut\('brushSizeUp', event\)/);
  assert.match(appSource, /matchShortcut\('brushSizeDown', event\)/);
  assert.match(userSettingsSource, /brushSizeDown:\s*\{ key: 'BracketLeft'/);
  assert.match(userSettingsSource, /brushSizeUp:\s*\{ key: 'BracketRight'/);
});

test('drawing test script includes the brush settings source coverage', () => {
  assert.match(packageJson.scripts['test:drawing'], /brush-settings-source\.test\.js/);
});
