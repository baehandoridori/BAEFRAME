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
    playlistAggregateCommentRanges: [], playlistCommentStructureKey: '', playlistCommentSegments: [], playlistCommentScanPromise: null,
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
    refreshCommentPlaybackIndex() {}, deferCommentListRefresh: () => false, playlistAggregateCommentRanges: ranges, playlistResolutionStates: new Map(), renderPlaylistResolutionState() {}, playlistExpandedReplyKeys: new Set(), commentSearchKeyword: '',
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

test('one changed cut in 100 refreshes only its snapshot and leaves segment metadata intact', async () => {
  const mod = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  const items = Array.from({ length: 100 }, (_, index) => ({ id: String(index), videoPath: `${index}.mp4`, bframePath: `${index}.bframe` }));
  const segments = items.map((item, index) => ({ itemId: item.id, index, startTime: index * 3, duration: 3, fps: 24 }));
  const manager = { currentPlaylist: { id: '100' }, getItems: () => items, ensureItemBframePath: async item => item.bframePath };
  let reads = 0; let probes = 0; let clears = 0; let renders = 0;
  const context = vm.createContext({ ...mod, playlistUIState: { mode: 'continuous' }, playlistCommentModeGeneration: 0,
    playlistTimelineUpdateToken: 0, playlistCommentSegments: segments, playlistCommentScanPromise: null,
    playlistAggregateCommentRanges: [], getPlaylistManager: () => manager, isSameFilePath: (a,b) => a === b,
    readPlaylistCommentSnapshot: async path => { reads++; assert.equal(path, '52.bframe'); return { comments: { layers: [{ id: 'l', markers: [{ id: 'm', startFrame: 32 }] }] } }; },
    commentFilterState: { status: 'all' }, filterPlaylistAggregateCommentRanges: r => r,
    timeline: { playlistDuration: 300, clearCommentMarkers() { clears++; }, renderPlaylistCommentRanges() { renders++; } },
    collectPlaylistMetadata() { probes++; }, renderPlaylistContinuousCommentList() {}, log: { warn: e => { throw new Error(e); } }
  });
  vm.runInContext(appFunction('refreshPlaylistCommentsForItem'), context);
  await context.refreshPlaylistCommentsForItem('52');
  assert.equal(reads, 1); assert.equal(probes, 0); assert.equal(clears, 0);
  assert.equal(context.playlistCommentSegments, segments);
  assert.equal(context.playlistAggregateCommentRanges[0].globalStartTime, 156 + 32 / 24);
  const originalRanges = context.playlistAggregateCommentRanges;
  await context.refreshPlaylistCommentsForItem('52');
  assert.equal(context.playlistAggregateCommentRanges, originalRanges);
  assert.equal(renders, 1);
});


test('list filtering keeps unknown timing after valid comments within its cut', () => {
  const context = vm.createContext({ filterByAuthors: rows => rows, getActiveCommentFilter: () => 'all' });
  vm.runInContext(appFunction('filterPlaylistAggregateCommentRanges'), context);
  const rows = context.filterPlaylistAggregateCommentRanges([
    { id: 'zero', itemIndex: 0, globalStartTime: 0 },
    { id: 'bad', itemIndex: 0, globalStartTime: null, timingValid: false },
    { id: 'later', itemIndex: 0, globalStartTime: 1 },
    { id: 'next', itemIndex: 1, globalStartTime: 3 }
  ]);
  assert.deepEqual(Array.from(rows, r => r.id), ['zero', 'later', 'bad', 'next']);
});


test('background revalidation bounds metadata work and renders changed snapshots once per batch', async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: String(i), videoPath: `${i}.mp4`, bframePath: `${i}.bframe` }));
  let callback; let checks = 0; let reads = 0; let lists = 0; let timelineRenders = 0; let changedPath = null;
  const context = vm.createContext({
    playlistCommentRevalidationTimer: null, playlistCommentRevalidationRunning: false, playlistCommentRevalidationCursor: 0,
    playlistCommentModeGeneration: 0, playlistCommentScanPromise: null, playlistUIState: { mode: 'continuous' },
    setInterval: cb => { callback = cb; return 1; }, clearInterval() {},
    getPlaylistManager: () => ({ getItems: () => items }), reviewDataManager: { getVideoPath: () => null },
    normalizeComparableFilePath: p => p, isSameFilePath: (a, b) => a === b,
    playlistCommentCache: { isFresh: () => false, invalidate() {}, revalidate: async p => { checks++; return { changed: p === changedPath }; } },
    refreshPlaylistCommentsForItem: async (_id, options = {}) => { reads++; if (options.render !== false) lists++; return true; },
    playlistAggregateCommentRanges: [], commentFilterState: { status: 'all' }, filterPlaylistAggregateCommentRanges: rows => rows,
    timeline: { playlistDuration: 300, renderPlaylistCommentRanges: () => timelineRenders++ },
    renderPlaylistContinuousCommentList: () => lists++, log: { warn() {} }
  });
  vm.runInContext(appFunction('startPlaylistCommentRevalidation'), context);
  context.startPlaylistCommentRevalidation(); await callback();
  assert.equal(reads, 0); assert.equal(checks, 4); assert.equal(lists, 0);
  changedPath = '5.bframe'; await callback();
  assert.equal(reads, 1); assert.equal(checks, 8); assert.equal(lists, 1); assert.equal(timelineRenders, 1);
});


test('ordinary rows show untimed text and never seek or request thumbnails for missing frames', async () => {
  const { CommentMarker } = await import('../../renderer/scripts/modules/comment-manager.js');
  const indexModule = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  const importedNames = source.match(/import \{([^}]+)\} from '\.\/modules\/playlist-comment-index\.js';/)[1].split(',').map(name => name.trim()).filter(Boolean);
  const indexBindings = Object.fromEntries(importedNames.map(name => [name, indexModule[name]]));
  const dom = new JSDOM('<div id="list"></div>'); const seeks = [], captures = []; const noop = () => {};
  const markers = [0, undefined, null, -1, 'bad', true].map((startFrame, i) => CommentMarker.fromJSON({
    id: 'm' + i, text: 'comment', author: 'tester', startFrame, createdAt: '2026-09-14T00:00:00Z', replies: [] }));
  const settings = { getShowCommentThumbnails: () => true, getCommentThumbnailScale: () => 100, getAvatarForName: () => null };
  const context = vm.createContext({ ...indexBindings, elements: { commentsList: dom.window.document.querySelector('#list') },
    getActiveCommentFilter: () => 'all', deferCommentListRefresh: () => false, playlistUIState: { mode: 'normal' }, cutlistUIState: { active: false },
    getFilteredCurrentCommentMarkers: () => markers, normalizeCommentSearch: () => '', commentSearchKeyword: '',
    commentManager: { getAllMarkers: () => markers, getMarker: id => markers.find(m => m.id === id), canEdit: () => true },
    updateFeedbackProgress: noop, virtualScrollState: {}, getUserSettings: () => settings, getThumbnailGenerator: () => ({ isReady: true,
      getThumbnailUrlAtExact: frame => { captures.push(frame); return null; }, requestExactCapture: noop, getThumbnailUrlAt: () => null }),
    mentionManager: { attach: noop, detach: noop }, getAuthorColorClass: () => '', getAuthorColorStyle: () => '', getCommentAuthorColor: () => ({ color: '#fff' }),
    getCutlistCommentLabelForMarker: () => '', getCutlistCommentPanelLineForMarker: () => '', getResolveButtonLabel: () => '',
    getResolveTooltipHtml: () => '', highlightCommentSearchMatches: v => v || '', highlightMentions: v => v, renderGDriveLinks: v => v,
    escapeHtml: v => v || '', escapeHtmlAttribute: v => v || '', formatRelativeTime: () => '', previousReviewPanel: null,
    resizeReplyEditorToContent: noop, setupAttachedImagePreview: noop, setupGDriveLinkButtons: noop, refreshCommentPlaybackIndex: noop,
    videoPlayer: { fps: 24, seekToFrame: f => seeks.push(f) }, log: { warn: noop } });
  if (source.includes('function seekToCommentFrame(')) vm.runInContext(appFunction('seekToCommentFrame'), context);
  vm.runInContext(appFunction('updateCommentListImmediate'), context); context.updateCommentListImmediate();
  const rows = [...context.elements.commentsList.querySelectorAll('.comment-item')];
  for (const row of rows.slice(1)) { row.click(); assert.match(row.querySelector('.comment-timecode').textContent, /시간 정보 없음/); }
  assert.deepEqual(seeks, []); assert.deepEqual(captures, [0]);
  rows[0].click(); assert.deepEqual(seeks, [0]); assert.match(rows[0].querySelector('.comment-timecode').textContent, /00:00:00:00/);
  dom.window.close();
});


test('direct comment focus keeps untimed comments selectable without sending invalid frame seeks', async () => {
  const indexModule = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  const importedNames = source.match(/import \{([^}]+)\} from '\.\/modules\/playlist-comment-index\.js';/)[1].split(',').map(name => name.trim()).filter(Boolean);
  const indexBindings = Object.fromEntries(importedNames.map(name => [name, indexModule[name]]));
  const seeks = [], focus = []; let marker = { startFrame: undefined };
  const context = vm.createContext({ ...indexBindings, videoPlayer: { seekToFrame: frame => seeks.push(frame) },
    commentManager: { getMarker: () => marker }, log: { info() {}, warn() {} }, showToast() {},
    scrollToCommentWithGlow: id => focus.push(id) });
  vm.runInContext(appFunction('seekToCommentFrame') + '\n' + appFunction('focusComment'), context);
  for (const startFrame of [undefined, null, -1, true, 'bad']) { marker = { startFrame }; context.focusComment('untimed'); }
  assert.deepEqual(seeks, []); assert.equal(focus.length, 5);
  marker = { startFrame: 0 }; context.focusComment('zero'); assert.deepEqual(seeks, [0]);
});
