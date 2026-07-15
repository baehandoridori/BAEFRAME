const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const indexHtmlSource = normalizeNewlines(
  fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8')
);
const mainStyles = normalizeNewlines(
  fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8')
);

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

test('이전 버전 댓글을 읽기 전용 고스트 섹션으로 표시한다 (피드백 36)', () => {
  assert.match(appSource, /let previousVersionComments = null;/);
  assert.match(appSource, /async function togglePreviousVersionComments\(versionInfo\)/);
  assert.match(appSource, /appendPreviousVersionCommentSection\(container\);/);
  assert.match(appSource, /comment-ghost-item/);
  assert.match(indexHtmlSource, /id="prevVersionCommentsBtn"/);
  assert.match(mainStyles, /\.comment-ghost-section \{/);
});
