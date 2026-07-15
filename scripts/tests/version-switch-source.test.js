const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));

test('버전 전환이 전환 직전 시간을 initialTime으로 넘긴다 (피드백 36)', () => {
  assert.match(appSource, /onVersionSelect\(async \(versionInfo\) => \{[\s\S]*?initialTime: resumeTime/);
  assert.match(appSource, /initialTime = null,/);
  assert.match(appSource, /function resolveInitialFrameFromOptions\(initialFrame, initialTime\)/);
  assert.match(appSource, /seekMpvInitialFrameBeforeReveal\(mpvInitialFrame\)/);
  assert.match(
    appSource,
    /loadVideoWithMpvPilot\(filePath, \{\s*initialFrame,\s*initialTime,\s*loadToken,\s*isStaleVideoLoad\s*\}\)/
  );
});
