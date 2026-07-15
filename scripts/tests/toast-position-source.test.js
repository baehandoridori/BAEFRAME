const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const readSource = (relPath) =>
  normalizeNewlines(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));

const mainStyles = readSource('renderer/styles/main.css');

test('버전 드롭다운이 열려 있으면 상단 토스트가 하단으로 회피한다 (피드백 37)', () => {
  assert.match(
    mainStyles,
    /body:has\(\.version-dropdown\.open\) \.toast-container \{[\s\S]*?top: auto !important;[\s\S]*?bottom: 52px !important;/
  );
});
