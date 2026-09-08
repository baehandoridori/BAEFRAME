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

test('이전 리뷰 패널을 현재 저장 매니저와 연결하고 파일 전환 시 참조 읽기를 중단한다', () => {
  assert.match(appSource, /const reviewCarryoverManager = new ReviewCarryoverManager\(\)/);
  assert.match(appSource, /new ReviewDataManager\(\{[\s\S]*?reviewCarryoverManager,/);
  assert.match(appSource, /previousReviewPanel = createPreviousReviewPanel\(\{/);
  assert.match(appSource, /previousReviewPanel\?\.suspend\(\)/);
  assert.match(appSource, /previousReviewPanel\?\.decorateList\(\)/);
  assert.match(indexHtmlSource, /id="prevVersionCommentsBtn"/);
  assert.match(indexHtmlSource, /id="previousReviewMount"/);
  assert.doesNotMatch(appSource, /let previousVersionComments = null/);
});

test('검수 입력은 최종 저장과 협업 종료보다 먼저 잠그고 전환 취소 시 소유자만 해제한다', () => {
  const start = appSource.indexOf('async function loadVideo(');
  const end = appSource.indexOf('async function handleImportFeedbackFromVersion',start);
  const load = appSource.slice(start,end);
  const fence = load.indexOf('previousReviewTransitionBlockToken = loadToken;');
  assert.ok(fence >= 0);
  assert.ok(fence < load.indexOf('await reviewDataManager.save()'));
  assert.ok(fence < load.indexOf('await window.electronAPI.watchFileStop'));
  assert.match(load, /if \(!canContinueVideoLoad\(\)\) return false;\s*previousReviewTransitionBlockToken = loadToken;/);
  assert.match(load, /finally \{\s*if \(previousReviewTransitionBlockToken === loadToken\) \{\s*previousReviewTransitionBlockToken = null;/);
  assert.match(appSource, /enabled: previousReviewContextReady && previousReviewTransitionBlockToken === null/);
});
