const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
function appFunction(name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, name);
  // Top-level app functions end at this indentation; braces in templates are irrelevant.
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
test('current editor frame 32 wins over disk frame zero without collecting drawings', async () => {
  const mod = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  const cacheMod = await import('../../renderer/scripts/modules/playlist-comment-cache.js');
  let reads = 0;
  const comments = frame => ({ layers: [{ id: 'l', markers: [{ id: 'm', startFrame: frame }] }] });
  const item = { id: 'a', videoPath: 'a.mp4' };
  const manager = { getItems: () => [item], getPlaylist: () => manager, ensureItemBframePath: async () => 'a.bframe' };
  const context = vm.createContext({ ...mod, ...cacheMod, Map, Set, Promise,
    playlistUIState: { mode: 'continuous' }, playlistTimelineUpdateToken: 0, playlistCommentModeGeneration: 0,
    playlistAggregateCommentRanges: [], playlistCommentSegments: [], playlistCommentScanPromise: null,
    commentFilterState: { status: 'all' }, videoPlayer: { fps: 24 },
    timeline: { clearCommentMarkers() {}, renderPlaylistCommentRanges(r) { context.timelineRanges = r; }, setPlaylistTimeline() {}, setCurrentTime() {} },
    getPlaylistManager: () => manager, collectPlaylistMetadata: async () => new Map(),
    buildPlaylistSegments: () => ({ segments: [{ itemId: 'a', index: 0, fileName: 'a.mp4', startTime: 0, duration: 3, fps: 24 }], totalDuration: 3 }),
    setPlaylistContinuousTimelineBusy() {}, renderActiveDrawingLayers() {}, getContinuousTimelinePlaybackTime: () => 0,
    filterPlaylistAggregateCommentRanges: r => r, renderPlaylistContinuousCommentList() {}, startPlaylistCommentRevalidation() {},
    commentManager: { toJSON: () => comments(32) },
    reviewDataManager: { getVideoPath: () => 'a.mp4', getBframePath: () => 'a.bframe', isLoading: false },
    isSameFilePath: (a, b) => a === b,
    window: { electronAPI: { loadReview: async () => { reads++; return { comments: comments(0) }; } } }, log: { warn() {} }
  });
  context.playlistCommentCache = cacheMod.createPlaylistCommentCache({ read: context.window.electronAPI.loadReview, normalizePath: p => p });
  for (const name of ['readPlaylistCommentSnapshot', 'updatePlaylistContinuousTimeline']) {
    if (source.includes(`function ${name}(`)) vm.runInContext(appFunction(name), context);
  }
  await context.updatePlaylistContinuousTimeline();
  assert.equal(context.playlistAggregateCommentRanges[0].localStartFrame, 32);
  assert.equal(context.timelineRanges[0].localStartFrame, 32);
  assert.equal(reads, 0);
});

test('panel contains a single local label and global badge; invalid timing cannot seek', async () => {
  const mod = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  const dom = new JSDOM('<div id="list"></div>');
  const ranges = mod.extractPlaylistCommentRanges({ segment: { itemId: 'a', fileName: 'a.mp4', startTime: 3, duration: 3, fps: 24 }, bframeData: { comments: { layers: [{ id: 'l', markers: [{ id: 'zero', startFrame: 0 }, { id: 'bad' }] }] } } });
  let seeks = 0;
  const noop = () => {};
  const escape = value => String(value ?? '');
  const context = vm.createContext({ ...mod, elements: { commentsList: dom.window.document.querySelector('#list') },
    playlistAggregateCommentRanges: ranges, playlistExpandedReplyKeys: new Set(), commentSearchKeyword: '',
    getActiveCommentFilter: () => 'all', normalizeCommentSearch: escape, filterByAuthors: r => r,
    filterPlaylistAggregateCommentRanges: r => r, updateFeedbackProgress: noop,
    mentionManager: { attach: noop, detach: noop }, escapeHtmlAttribute: escape, escapeHtml: escape,
    highlightCommentSearchMatches: escape, getCommentAuthorColor: () => ({ color: '#fff' }),
    renderPlaylistAggregateReplies: () => '', getResolveButtonLabel: () => '', getResolveTooltipHtml: () => '',
    highlightMentions: escape, renderGDriveLinks: escape, getAuthorColorClass: () => '', formatRelativeTime: () => '',
    resizeReplyEditorToContent: noop, setupAttachedImagePreview: noop, openPlaylistAggregateComment: () => { seeks++; },
    selectedPlaylistAggregateCommentKey: null, setupGDriveLinkButtons: noop
  });
  vm.runInContext(appFunction('renderPlaylistContinuousCommentList'), context);
  context.renderPlaylistContinuousCommentList();
  const container = context.elements.commentsList;
  assert.equal(container.querySelectorAll('.playlist-comment-local-time').length, 0);
  assert.match(container.querySelector('[data-marker-id="zero"] .comment-timecode').textContent, /a 00:00:00:00/);
  const invalid = container.querySelector('[data-marker-id="bad"]');
  assert.match(invalid.textContent, /시간 정보 없음/);
  assert.doesNotMatch(invalid.textContent, /null/);
  invalid.click();
  assert.equal(seeks, 0);
  dom.window.close();
});
