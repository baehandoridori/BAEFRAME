const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../../../..');
const source = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
function appFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(match, name);
  const start = source.indexOf(') {', match.index) + 2;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(match.index, i + 1);
  }
  throw new Error(`Unterminated function: ${name}`);
}

(async () => {
  const mod = await import(pathToFileURL(path.join(root,
    'renderer/scripts/modules/playlist-comment-index.js')));
  const segment = { itemId: 'item-a', index: 0, fileName: 'shot.mp4',
    startTime: 10, duration: 20, fps: 24 };
  const review = (startFrame) => ({ fps: 24, comments: { layers: [{
    id: 'layer-a', markers: [{ id: 'marker-a', startFrame, endFrame: 144 }]
  }] } });
  const [valid] = mod.extractPlaylistCommentRanges({ segment, bframeData: review(32) });
  assert.equal(valid.localStartTimecode, '00:00:01:08');
  const [invalid] = mod.extractPlaylistCommentRanges({ segment, bframeData: review(undefined) });
  assert.equal(invalid.localStartTimecode, '00:00:00:00');

  let release;
  const saved = new Promise(resolve => { release = resolve; });
  const effects = [];
  const range = { itemId: 'item-a', layerId: 'layer-a', markerId: 'marker-a' };
  const context = vm.createContext({
    playlistAggregateCommentRanges: [range],
    getPlaylistAggregateCommentKey: mod.getPlaylistAggregateCommentKey,
    togglePlaylistAggregateResolvedWithoutNavigation: () => saved,
    refreshCommentRangesForCurrentMode: async () => effects.push('refresh-current-mode'),
    updatePlaylistUI: async () => effects.push('refresh-whole-playlist'),
    renderPlaylistContinuousCommentList: () => effects.push('render-continuous-list'),
    highlightPlaylistAggregateComment: () => effects.push('steal-focus'),
    showToast: () => {},
    commentFilterState: { status: 'all' }
  });
  vm.runInContext(appFunction('togglePlaylistAggregateResolved'), context);
  const pending = context.togglePlaylistAggregateResolved('item-a:layer-a:marker-a');
  // Simulate leaving continuous mode while the old save is pending.
  context.playlistAggregateCommentRanges = [];
  release({ resolved: true, resolvedBy: 'test', resolvedAt: null });
  await pending;
  assert.ok(effects.includes('render-continuous-list'));
  assert.ok(effects.includes('steal-focus'));

  let diskReads = 0;
  const aggregateContext = vm.createContext({
    playlistUIState: { mode: 'continuous' }, playlistTimelineUpdateToken: 0,
    playlistAggregateCommentRanges: [], commentFilterState: { status: 'all' },
    timeline: { clearCommentMarkers() {}, renderPlaylistCommentRanges() {},
      setPlaylistTimeline() {}, setCurrentTime() {} },
    getPlaylistManager: () => ({ getItems: () => [{ id: 'item-a' }],
      ensureItemBframePath: async () => 'C:/test/shot.bframe' }),
    collectPlaylistMetadata: async () => new Map(),
    buildPlaylistSegments: () => ({ segments: [segment], totalDuration: 30 }),
    setPlaylistContinuousTimelineBusy() {}, renderActiveDrawingLayers() {},
    getContinuousTimelinePlaybackTime: () => 0,
    extractPlaylistCommentRanges: mod.extractPlaylistCommentRanges,
    filterPlaylistAggregateCommentRanges: ranges => ranges,
    renderPlaylistContinuousCommentList() {},
    // The current editor has already moved this marker to frame 32.
    commentManager: { toJSON: () => review(32).comments },
    reviewDataManager: { getBframePath: () => 'C:/test/shot.bframe' },
    window: { electronAPI: { loadReview: async () => { diskReads += 1; return review(0); } } },
    log: { warn() {} }
  });
  vm.runInContext(appFunction('updatePlaylistContinuousTimeline'), aggregateContext);
  await aggregateContext.updatePlaylistContinuousTimeline();
  const stale = aggregateContext.playlistAggregateCommentRanges[0];
  assert.equal(stale.localStartFrame, 0);
  assert.equal(diskReads, 1);
  console.log(JSON.stringify({
    assertions: 6,
    validFrame32: valid.localStartTimecode,
    missingFrame: invalid.localStartTimecode,
    pendingSaveAfterModeExit: effects,
    currentEditorFrame: 32,
    aggregateFrameFromStaleDisk: stale.localStartFrame,
    diskReads,
    scope: 'Real function bodies with controlled dependencies; no UI or production-file writes'
  }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
