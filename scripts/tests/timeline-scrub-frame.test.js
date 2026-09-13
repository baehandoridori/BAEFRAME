const { test } = require('node:test');
const assert = require('node:assert/strict');
async function fixture(fps = 24, totalFrames = 100) {
  const { Timeline } = await import('../../renderer/scripts/modules/timeline.js');
  const timeline = Object.create(Timeline.prototype);
  const emitted = [];
  Object.assign(timeline, { fps, totalFrames, duration: totalFrames / fps, currentTime: 0,
    playlistDuration: 0, cutlistDuration: 0, tracksContainer: { offsetWidth: 1000, getBoundingClientRect: () => ({ left: 0, width: 1000 }) },
    _emit: (name, detail) => emitted.push({ name, ...detail }), _updatePlayheadPositionDirect() {}, _autoScrollWhileDragging() {} });
  return { timeline, emitted };
}
test('cell 58 is frame 58 and its left neighbour remains 57', async () => {
  const { timeline } = await fixture();
  assert.equal(timeline._getTimelineTimeFromCellPercent(.58), 58 / 24);
  assert.equal(timeline._getTimelineTimeFromCellPercent(.5799), 57 / 24);
});
for (const fps of [23.976, 24, 29.97, 30, 60]) {
  for (const dpr of [1, 1.25, 1.5, 2]) {test(`release uses current scrolled CSS rect at fps ${fps}, DPR ${dpr}`, async () => {
    const { timeline, emitted } = await fixture(fps);
    timeline.scrubTime = 57 / fps;
    timeline.isDraggingPlayhead = true;
    timeline.tracksContainer = { offsetWidth: 2000, getBoundingClientRect: () => ({ left: -400, width: 2000 }) };
    timeline._finishScrubbing({ type: 'pointerup', pointerId: 3, clientX: -400 + .58 * 2000 });
    assert.equal(emitted[0].localFrame, 58); assert.equal(emitted[0].time, 58 / fps); assert.equal(emitted[0].frameExact, true);
  });}
}
test('mixed FPS and cutlist cells retain item/cut identity and source frame offsets', async () => {
  const { timeline, emitted } = await fixture();
  timeline.playlistDuration = 6;
  timeline.playlistSegments = [{ itemId: 'a', startTime: 0, duration: 3, fps: 24 }, { itemId: 'c', startTime: 3, duration: 3, fps: 30 }];
  timeline._seekFromClick({ clientX: 1000 * (72 / 162) });
  assert.equal(emitted[0].displayFrame, 72); assert.equal(emitted[0].itemId, 'c'); assert.equal(emitted[0].localFrame, 0);
  timeline.playlistDuration = 0; timeline.cutlistDuration = 3;
  timeline.cutlistSegments = [{ cutId: 'cut', globalStartTime: 0, duration: 3, fps: 24, sourceStartFrame: 100, frameCount: 72 }];
  timeline._seekFromClick({ clientX: 0 });
  assert.equal(emitted[1].cutId, 'cut'); assert.equal(emitted[1].localFrame, 100);
});
test('cancel restores the drag start and unrelated pointers cannot finish a scrub', async () => {
  const { timeline, emitted } = await fixture();
  timeline._scrubPointerId = 3; timeline._scrubStartDetail = { time: 10 / 24, displayFrame: 10, localFrame: 10, frameExact: true };
  timeline.scrubTime = 57 / 24;
  timeline._finishScrubbing({ type: 'pointerup', pointerId: 4, clientX: 900 }); assert.equal(emitted.length, 0);
  timeline._finishScrubbing({ type: 'pointercancel', pointerId: 3 });
  assert.equal(emitted[0].localFrame, 10); assert.equal(emitted[0].time, 10 / 24);
});

const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
function appFn(name) { const start = source.indexOf(`async function ${name}(`); return source.slice(start, source.indexOf('\n  }', start) + 4); }
test('continuous frame-exact seek sends the integer target to playback after item ownership is confirmed', async () => {
  const item = { id: 'b', videoPath: 'b.mp4', fps: 30 };
  const segment = { itemId: 'b', index: 0, startTime: 0, duration: 5, fps: 30 };
  const sought = []; const times = [];
  const manager = { getItems: () => [item], getCurrentItem: () => item };
  const context = vm.createContext({ videoLoadIntentGeneration: 0, pendingUserVideoLoadIntent: null,
    playlistContinuousNavigationToken: 0, activeVideoLoadCompletion: null, continuousTransitionFlight: null,
    continuousPlaybackState: { active: false }, state: { currentFile: 'b.mp4' }, playlistUIState: { mode: 'continuous' },
    timeline: { playlistSegments: [segment], playlistDuration: 5, setCurrentTime: time => times.push(time) },
    getPlaylistManager: () => manager, mapGlobalTimeToSegment: () => ({ segment, localTime: 57 / 30 }),
    mapLocalTimeToGlobal: (segment, time) => segment.startTime + time, getActiveVideoLoadCompletionForPath: () => null,
    isSameFilePath: (a,b) => a === b, hasActiveVideoLoadForDifferentFile: () => false,
    videoPlayer: { isPlaying: false, fps: 24, seek() { throw new Error('time seek lost exact frame'); }, seekToFrame: frame => sought.push(frame) },
    playbackSync: { broadcastSeek: time => times.push(time) }, updatePlaylistCurrentItem() {}, updatePlaylistPosition() {}
  });
  vm.runInContext(appFn('seekContinuousTimeline'), context);
  assert.equal(await context.seekContinuousTimeline(58 / 30, { frameExact: true, localFrame: 58, itemId: 'b' }), true);
  assert.deepEqual(sought, [58]); assert.deepEqual(times, [58 / 30, 58 / 30]);
  assert.equal(await context.seekContinuousTimeline(58 / 30, { frameExact: true, localFrame: 58, itemId: 'a' }), false);
  assert.deepEqual(sought, [58]);
});
