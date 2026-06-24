const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const htmlSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));
const cssSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/styles/main.css'), 'utf8'));
const commentManagerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/comment-manager.js'), 'utf8'));
const commentSyncSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/comment-sync.js'), 'utf8'));

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

test('comment mode is visibly marked on the video surface outside fullscreen', () => {
  assert.match(cssSource, /\.video-wrapper\.comment-mode::before\s*\{[\s\S]+border:\s*2px solid var\(--accent-primary\);/);
  assert.match(cssSource, /\.video-wrapper\.comment-mode::after\s*\{[\s\S]+radial-gradient\(circle at center, var\(--accent-primary\)/);
  assert.match(cssSource, /\.video-wrapper\.comment-mode \.comment-markers-container\s*\{[\s\S]+z-index:\s*30 !important;/);
  assert.match(cssSource, /body\.app-fullscreen \.video-wrapper\.comment-mode::after\s*\{[\s\S]+width:\s*auto;[\s\S]+height:\s*auto;[\s\S]+animation:\s*none;/);
});

test('pending comment editor stays visible near video edges', () => {
  const pendingMarkerMatch = appSource.match(/function renderPendingMarker\(marker\) \{([\s\S]*?)\n  \}\n\n  \/\*\*\n   \* Pending 마커 UI 제거/);
  assert.ok(pendingMarkerMatch, 'pending marker renderer should exist');
  const pendingMarkerSource = pendingMarkerMatch[1];

  assert.match(pendingMarkerSource, /elements\.videoWrapper\?\.classList\.add\('comment-pending'\);/);
  assert.match(pendingMarkerSource, /inputWrapper\.classList\.toggle\('align-left', marker\.x > 0\.68\);/);
  assert.match(pendingMarkerSource, /inputWrapper\.classList\.toggle\('align-above', marker\.y > 0\.72\);/);
  assert.match(pendingMarkerSource, /inputWrapper\.classList\.toggle\('align-below', marker\.y < 0\.22\);/);
  assert.match(cssSource, /\.comment-marker-input-wrapper\.align-left\s*\{[\s\S]+right:\s*calc\(100% \+ 16px\);/);
  assert.match(cssSource, /\.comment-marker-input-wrapper\.align-above\s*\{[\s\S]+bottom:\s*calc\(100% \+ 16px\);/);
  assert.match(cssSource, /\.comment-marker-input-wrapper\.align-below\s*\{[\s\S]+top:\s*calc\(100% \+ 16px\);/);
  assert.match(cssSource, /\.video-wrapper\.comment-mode\.comment-pending::after\s*\{[\s\S]+display:\s*none;/);

  const removePendingMatch = appSource.match(/function removePendingMarkerUI\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(removePendingMatch, 'pending marker cleanup should exist');
  assert.match(removePendingMatch[1], /elements\.videoWrapper\?\.classList\.remove\('comment-pending'\);/);
});

test('comment mode shortcut follows the same readiness guard as the toolbar button', () => {
  const buttonHandlerMatch = appSource.match(/elements\.btnAddComment\.addEventListener\('click', \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(buttonHandlerMatch, 'toolbar comment button handler should exist');
  assert.match(buttonHandlerMatch[1], /if \(!state\.isCommentMode && !\(await ensureCutlistCommentTargetReady\(\)\)\) return;/);

  const shortcutMatch = appSource.match(/if \(userSettings\.matchShortcut\('commentMode', e\)\) \{([\s\S]*?)\n    \}/);
  assert.ok(shortcutMatch, 'comment shortcut branch should exist');
  assert.match(shortcutMatch[1], /if \(!state\.isCommentMode && !\(await ensureCutlistCommentTargetReady\(\)\)\) return;/);
  assert.match(shortcutMatch[1], /toggleCommentMode\(\);/);
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
  assert.match(appSource, /playlistExpandedReplyKeys\.add\(key\);/);
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

test('playlist aggregate replies can expand and resolved state can be toggled from sidebar', () => {
  const replyRenderStart = appSource.indexOf('  function renderPlaylistAggregateReplies');
  assert.ok(replyRenderStart >= 0, 'playlist aggregate reply renderer should exist');
  const replyRenderEnd = appSource.indexOf('  async function togglePlaylistAggregateResolved', replyRenderStart);
  assert.ok(replyRenderEnd > replyRenderStart, 'playlist aggregate reply renderer should have a bounded body');
  const replyRenderSource = appSource.slice(replyRenderStart, replyRenderEnd);

  const renderStart = appSource.indexOf('  function renderPlaylistContinuousCommentList');
  assert.ok(renderStart >= 0, 'playlist aggregate comment renderer should exist');
  const renderEnd = appSource.indexOf('  function getCutlistAggregateCommentKey', renderStart);
  assert.ok(renderEnd > renderStart, 'playlist aggregate comment renderer should have a bounded body');
  const renderSource = appSource.slice(renderStart, renderEnd);

  assert.match(appSource, /const playlistExpandedReplyKeys = new Set\(\);/);
  assert.match(appSource, /let suppressCommentRangeRefreshOnce = false;/);
  assert.match(appSource, /function renderPlaylistAggregateReplies\(range, normalizedSearch\) \{/);
  assert.match(appSource, /class="playlist-comment-replies\$\{repliesExpanded \? ' expanded' : ''\}"/);
  assert.match(appSource, /playlistExpandedReplyKeys\.has\(key\)/);
  assert.match(appSource, /playlistExpandedReplyKeys\.add\(key\);[\s\S]+playlistExpandedReplyKeys\.delete\(key\);/);
  assert.match(appSource, /async function togglePlaylistAggregateResolved\(key\) \{/);
  assert.match(appSource, /async function togglePlaylistAggregateResolvedWithoutNavigation\(range\) \{/);
  assert.match(appSource, /const bframePath = await playlistManager\.ensureItemBframePath\(item\);/);
  assert.match(appSource, /commentManager\.getMarker\(range\.markerId\)/);
  assert.match(appSource, /window\.electronAPI\.loadReview\(bframePath\)/);
  assert.match(appSource, /window\.electronAPI\.saveReview\(bframePath, bframeData\)/);
  assert.match(appSource, /marker\.resolved = !previous\.resolved;/);
  assert.match(appSource, /restoreMarkerResolution\(marker, previous\);/);
  assert.match(appSource, /marker\.updatedAt = new Date\(\);/);
  assert.match(appSource, /suppressCommentRangeRefreshOnce = true;/);
  assert.doesNotMatch(appSource.match(/async function togglePlaylistAggregateResolved\(key\) \{([\s\S]*?)\n  \}/)?.[1] || '', /openPlaylistAggregateComment/);
  assert.match(appSource, /class="comment-resolve-toggle playlist-comment-resolve-toggle"/);
  assert.match(appSource, /item\.querySelector\('\.playlist-comment-resolve-toggle'\)\?\.addEventListener\('click'/);
  assert.match(replyRenderSource, /const imageUrl = reply\.image \? escapeHtmlAttribute\(reply\.image\) : '';/);
  assert.match(renderSource, /const imageUrl = range\.image \? escapeHtmlAttribute\(range\.image\) : '';/);
  assert.match(renderSource, /data-aggregate-comment-key="\$\{escapeHtmlAttribute\(key\)\}"/);
  assert.match(renderSource, /data-marker-id="\$\{escapeHtmlAttribute\(range\.markerId\)\}"/);
  assert.match(renderSource, /data-item-id="\$\{escapeHtmlAttribute\(range\.itemId\)\}"/);
  assert.doesNotMatch(replyRenderSource, /<img src="\$\{reply\.image\}"/);
  assert.doesNotMatch(renderSource, /<img src="\$\{range\.image\}"/);
  assert.match(cssSource, /\.playlist-comment-replies/);
  assert.match(cssSource, /\.playlist-comment-reply-toggle\.expanded/);
});

test('resolved author metadata is synced and visible for every resolved tooltip', () => {
  const updateBroadcastMatch = commentSyncSource.match(/type: 'COMMENT_MARKER_UPDATED'[\s\S]*?fields: \{([\s\S]*?)\n      \}/);
  assert.ok(updateBroadcastMatch, 'comment marker update broadcast should include a fields payload');
  assert.match(updateBroadcastMatch[1], /resolvedBy:/);
  assert.match(updateBroadcastMatch[1], /resolvedAt:/);

  const serializedMarkerMatch = commentSyncSource.match(/return \{([\s\S]*?)\n    \};\n  \}\n\n  \/\*\*/);
  assert.ok(serializedMarkerMatch, 'comment marker serialization should exist');
  assert.match(serializedMarkerMatch[1], /resolvedBy:/);
  assert.match(serializedMarkerMatch[1], /resolvedAt:/);

  const remoteAllowedFieldsMatch = commentManagerSource.match(/applyRemoteMarkerUpdate\(markerId, fields\) \{[\s\S]*?const allowedFields = \[([\s\S]*?)\];/);
  assert.ok(remoteAllowedFieldsMatch, 'remote marker update allowed fields should exist');
  assert.match(remoteAllowedFieldsMatch[1], /'resolvedBy'/);
  assert.match(remoteAllowedFieldsMatch[1], /'resolvedAt'/);

  assert.match(appSource, /function getResolveButtonLabel\(isResolved, resolvedBy\) \{/);
  assert.match(appSource, /function getResolveTooltipHtml\(resolvedBy, resolvedAt\) \{/);
  assert.match(appSource, /해결한 사람 기록 없음/);
  assert.match(appSource, /marker\.resolved \? getResolveTooltipHtml\(marker\.resolvedBy, marker\.resolvedAt\) : ''/);
  assert.match(appSource, /range\.resolved \? getResolveTooltipHtml\(range\.resolvedBy, range\.resolvedAt\) : ''/);
});
