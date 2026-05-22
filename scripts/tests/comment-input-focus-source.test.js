const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const htmlSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));

test('comment editable fields recover focus when a parent pointer handler blocks default focus', () => {
  assert.match(appSource, /function getCommentEditableTarget\(target\) \{[\s\S]+target\.closest\('\.comment-input, \.comment-marker-input, \.comment-reply-input, \.comment-edit-textarea, \.comment-reply-edit-textarea, \.thread-editor\[contenteditable="true"\]'\)/);
  assert.match(appSource, /function installCommentEditableFocusRecovery\(\) \{[\s\S]+document\.addEventListener\('pointerdown', handleEditablePointerDown, true\);[\s\S]+editable\.focus\(\{ preventScroll: true \}\);/);
  assert.match(appSource, /document\.addEventListener\('mousedown', handleEditablePointerDown, true\);/);
  assert.match(appSource, /installCommentEditableFocusRecovery\(\);/);
});

test('right sidebar comment input is covered by the same focus recovery path', () => {
  assert.match(htmlSource, /<textarea class="comment-input" id="commentInput"/);
  assert.match(appSource, /commentInput: document\.getElementById\('commentInput'\)/);
  assert.match(appSource, /target\.closest\('\.comment-input,/);
});

test('video panning does not steal mouse down from comment editors', () => {
  const panHandlerMatch = appSource.match(/elements\.videoWrapper\?\.addEventListener\('mousedown', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(panHandlerMatch, 'video wrapper panning mousedown handler should exist');
  const panHandlerSource = panHandlerMatch[1];

  assert.match(panHandlerSource, /if \(getCommentEditableTarget\(e\.target\)\) return;/);
  assert.ok(
    panHandlerSource.indexOf('if (getCommentEditableTarget(e.target)) return;') <
      panHandlerSource.indexOf('if (canPanVideo() && e.button === 0)'),
    'comment editor guard should run before panning preventDefault'
  );
});

test('pending marker input stops pointer events from bubbling into video panning', () => {
  const pendingMarkerMatch = appSource.match(/function renderPendingMarker\(marker\) \{([\s\S]*?)\n  \}\n\n  \/\*\*\n   \* Pending 마커 UI 제거/);
  assert.ok(pendingMarkerMatch, 'pending marker renderer should exist');
  const pendingMarkerSource = pendingMarkerMatch[1];

  assert.match(pendingMarkerSource, /inputWrapper\.addEventListener\('pointerdown', \(e\) => e\.stopPropagation\(\)\);/);
  assert.match(pendingMarkerSource, /inputWrapper\.addEventListener\('mousedown', \(e\) => e\.stopPropagation\(\)\);/);
});
