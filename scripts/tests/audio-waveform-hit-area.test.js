const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..', '..');
const sourcePath = path.join(rootDir, 'renderer', 'scripts', 'modules', 'audio-waveform.js');
const cssPath = path.join(rootDir, 'renderer', 'styles', 'main.css');

const source = fs.readFileSync(sourcePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

test('audio waveform uses a constrained hit area for pointer interaction', () => {
  assert.match(source, /this\.hitArea\s*=\s*document\.createElement\('div'\)/);
  assert.match(source, /this\.hitArea\.className\s*=\s*'audio-waveform-hit-area'/);
  assert.doesNotMatch(source, /this\.overlayCanvas\.addEventListener\('mousedown', this\._onMouseDown\)/);
  assert.match(source, /this\.hitArea\.addEventListener\('mousedown', this\._onMouseDown\)/);
  assert.match(source, /const rect = this\._getInteractionRect\(\)/);
});

test('audio waveform overlay is visual-only and comment mode can receive marker clicks', () => {
  assert.match(css, /\.audio-waveform-overlay\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(css, /\.audio-waveform-hit-area\s*\{[\s\S]*?top:\s*30%;[\s\S]*?height:\s*52%;/);
  assert.match(css, /\.video-wrapper\.comment-mode\s+\.audio-waveform-hit-area\s*\{[\s\S]*?pointer-events:\s*none;/);
});
