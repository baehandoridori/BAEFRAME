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

test('loading review comments refreshes the right sidebar comment list', () => {
  const loadedHandlerMatch = appSource.match(/commentManager\.addEventListener\('loaded', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(loadedHandlerMatch, 'commentManager loaded handler should exist');
  const loadedHandlerSource = loadedHandlerMatch[1];

  assert.match(loadedHandlerSource, /void refreshCommentRangesForCurrentMode\(\);/);
  assert.match(loadedHandlerSource, /updateCommentList\(\);/);
});

test('right sidebar reply editors grow with long replies', () => {
  assert.match(appSource, /function resizeReplyEditorToContent\(editor\) \{/);
  assert.match(appSource, /replyInput\?\.addEventListener\('input', \(\) => resizeReplyEditorToContent\(replyInput\)\);/);
  assert.match(appSource, /threadEditor\?\.addEventListener\('input', \(\) => \{[\s\S]+resizeReplyEditorToContent\(threadEditor\);/);
  assert.match(appSource, /const computedMaxHeight = Number\.parseFloat\(getComputedStyle\(editor\)\.maxHeight\);/);
  assert.match(appSource, /editor\.style\.overflowY = editor\.scrollHeight > maxHeight \? 'auto' : '';/);
});

test('playlist aggregate comments can submit inline replies from the sidebar list', () => {
  assert.match(appSource, /async function submitPlaylistAggregateReply\(key, textarea\) \{/);
  assert.match(appSource, /<textarea class="playlist-comment-reply-input"[\s\S]+placeholder="답글 입력\.\.\."/);
  assert.match(appSource, /item\.querySelector\('\.playlist-comment-reply-submit'\)\?\.addEventListener\('click'/);
  assert.match(appSource, /const activeRange = playlistAggregateCommentRanges\.find\(item => getPlaylistAggregateCommentKey\(item\) === key\) \|\| range;/);
  assert.match(appSource, /commentManager\.addReplyToMarker\(activeRange\.markerId, text, commentManager\.getAuthor\(\)\)/);
  assert.match(appSource, /activeRange\.replies = \[\.\.\.\(activeRange\.replies \|\| \[\]\), reply\];/);
});

test('playlist aggregate comment rerenders detach reply editors before empty state', () => {
  const renderStart = appSource.indexOf('  function renderPlaylistContinuousCommentList');
  assert.ok(renderStart >= 0, 'playlist aggregate comment renderer should exist');
  const renderEnd = appSource.indexOf('  function getCutlistAggregateCommentKey', renderStart);
  assert.ok(renderEnd > renderStart, 'playlist aggregate comment renderer should have a bounded body');
  const renderSource = appSource.slice(renderStart, renderEnd);

  const detachIndex = renderSource.indexOf("container.querySelectorAll('.playlist-comment-reply-input').forEach");
  const emptyIndex = renderSource.indexOf('if (ranges.length === 0)');
  assert.ok(detachIndex >= 0, 'reply editors should be detached during playlist comment rerender');
  assert.ok(emptyIndex >= 0, 'playlist comment renderer should handle empty results');
  assert.ok(detachIndex < emptyIndex, 'reply editors should be detached before empty-state innerHTML replacement');
});
