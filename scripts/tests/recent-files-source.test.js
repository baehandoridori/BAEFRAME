const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const recentCss = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/recent-files.css'), 'utf8'));

test('empty screen stacks recent files below the main open button', () => {
  assert.match(indexSource, /<button class="btn btn-primary btn-large" id="btnOpenFile">[\s\S]*?<section id="recentFilesSection"/);
  assert.match(recentCss, /\.drop-zone-actions\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(recentCss, /#recentFilesSection\.recent-inline\s*\{[\s\S]*?width:\s*min\(100%,\s*760px\);/);
  assert.match(recentCss, /#recentFilesSection\.recent-inline \.recent-cards\s*\{[^}]*flex-direction:\s*row;/);
});
