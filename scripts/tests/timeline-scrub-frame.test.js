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

// ── 프레임 바를 끄는 입력: 마우스·터치는 엄격하게, 펜은 너그럽게 ──────────────────────────
// 실제 리스너(_setupEventListeners)를 가짜 대상에 걸어 이벤트 순서대로 부른다.
async function listenerFixture(t, fps = 24, totalFrames = 100) {
  const { Timeline } = await import('../../renderer/scripts/modules/timeline.js');
  const listeners = { document: {}, window: {}, handle: {}, ruler: {} };
  const makeTarget = name => ({
    name,
    style: {},
    captured: [],
    released: [],
    addEventListener(type, handler) { (listeners[name][type] ||= []).push(handler); },
    removeEventListener() {},
    setPointerCapture(id) { this.captured.push(id); },
    releasePointerCapture(id) { this.released.push(id); }
  });
  const handle = makeTarget('handle');
  const ruler = makeTarget('ruler');
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = {
    body: { style: {} },
    addEventListener(type, handler) { (listeners.document[type] ||= []).push(handler); },
    removeEventListener() {}
  };
  globalThis.window = {
    addEventListener(type, handler) { (listeners.window[type] ||= []).push(handler); },
    removeEventListener() {}
  };
  t.after(() => {
    if (previous.document === undefined) delete globalThis.document; else globalThis.document = previous.document;
    if (previous.window === undefined) delete globalThis.window; else globalThis.window = previous.window;
  });
  const timeline = Object.create(Timeline.prototype);
  const emitted = [];
  Object.assign(timeline, {
    fps, totalFrames, duration: totalFrames / fps, currentTime: 10 / fps, playlistDuration: 0, cutlistDuration: 0,
    tracksContainer: { offsetWidth: 1000, getBoundingClientRect: () => ({ left: 0, width: 1000 }),
      addEventListener() {}, ownerDocument: { body: { style: {} } } },
    playheadHandle: handle, timelineRuler: ruler, isDraggingPlayhead: false,
    _emit: (name, detail) => emitted.push({ name, ...detail }),
    _updatePlayheadPositionDirect() {}, _autoScrollWhileDragging() {}
  });
  timeline._setupEventListeners();
  const targets = { handle, ruler };
  // 프레임 f 의 칸 한가운데(폭 1000, 100프레임 → 칸 하나가 10px).
  const xOf = frame => frame * 10 + 5;
  const fire = (where, type, init = {}) => {
    const event = { type, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      isPrimary: true, preventDefault() {}, ...init };
    if (targets[where]) { event.currentTarget = targets[where]; event.target = init.target || targets[where]; }
    for (const handler of listeners[where][type] || []) handler(event);
    return event;
  };
  const seeks = () => emitted.filter(event => event.name === 'seek').map(event => event.localFrame);
  const scrubs = () => emitted.filter(event => event.name === 'scrubbing').map(event => event.localFrame);
  return { timeline, emitted, fire, xOf, seeks, scrubs, handle, ruler };
}

const pen = (pointerId, extra = {}) => ({ pointerType: 'pen', pointerId, ...extra });
const mouse = (extra = {}) => ({ pointerType: 'mouse', pointerId: 1, ...extra });
const touch = (pointerId, extra = {}) => ({ pointerType: 'touch', pointerId, ...extra });

test('a mouse scrub stays strict: lost capture, blur and cancel restore the start, other pointers are ignored', async t => {
  for (const [where, type] of [['handle', 'lostpointercapture'], ['window', 'blur'], ['document', 'pointercancel']]) {
    const { timeline, fire, xOf, seeks, scrubs } = await listenerFixture(t);
    fire('handle', 'pointerdown', mouse({ clientX: xOf(10) }));
    assert.equal(timeline.isDraggingPlayhead, true);
    fire('document', 'pointermove', mouse({ clientX: xOf(40) }));
    fire('document', 'pointermove', { pointerType: 'pen', pointerId: 9, clientX: xOf(70) });
    assert.deepEqual(scrubs(), [40], '다른 포인터의 이동은 받지 않는다');
    fire('document', 'pointerup', { pointerType: 'pen', pointerId: 9, clientX: xOf(70) });
    assert.equal(timeline.isDraggingPlayhead, true, '다른 포인터의 뗌으로 끝나지 않는다');
    fire(where, type, mouse());
    assert.equal(timeline.isDraggingPlayhead, false, `${type} 로 끝난다`);
    assert.deepEqual(seeks(), [10], `${type}: 끌기 시작한 자리로 되돌린다`);
  }
});

test('a pen scrub survives a lost pointer capture and commits where the pen is lifted', async t => {
  const { timeline, fire, xOf, seeks, scrubs, handle } = await listenerFixture(t);
  fire('handle', 'pointerdown', pen(4, { clientX: xOf(10) }));
  assert.equal(timeline.isDraggingPlayhead, true);
  assert.deepEqual(handle.captured, [4], '펜도 포인터를 묶어 둔다(창 밖으로 나가도 따라오게)');
  fire('document', 'pointermove', pen(4, { clientX: xOf(20) }));
  // 브라우저가 묶음을 풀어 버렸다(펜은 닿기 전과 닿은 뒤가 다른 입력 경로로 들어온다).
  fire('handle', 'lostpointercapture', pen(4));
  assert.equal(timeline.isDraggingPlayhead, true, '묶음이 풀려도 끌기는 이어진다');
  assert.deepEqual(seeks(), [], '되돌리지 않는다');
  fire('document', 'pointermove', pen(4, { clientX: xOf(45) }));
  fire('document', 'pointerup', pen(4, { clientX: xOf(58) }));
  assert.deepEqual(scrubs(), [20, 45]);
  assert.deepEqual(seeks(), [58], '펜을 뗀 자리로 확정한다');
  assert.equal(timeline.isDraggingPlayhead, false);
});

test('a pen scrub ignores hover moves and a window blur', async t => {
  const { timeline, fire, xOf, seeks, scrubs } = await listenerFixture(t);
  fire('ruler', 'pointerdown', pen(4, { clientX: xOf(30) }));
  assert.deepEqual(scrubs(), [30], '눈금자는 누른 자리로 바로 옮긴다');
  // 닿지 않은 채(buttons 0) 보낸 이동은 끌기가 아니다. 그 자리로 튀지도, 끌기를 끝내지도 않는다.
  fire('document', 'pointermove', pen(4, { clientX: xOf(5), buttons: 0 }));
  fire('document', 'pointermove', pen(7, { clientX: xOf(6), buttons: 0 }));
  assert.deepEqual(scrubs(), [30]);
  assert.equal(timeline.isDraggingPlayhead, true);
  fire('window', 'blur', {});
  assert.equal(timeline.isDraggingPlayhead, true, '창이 포커스를 잃어도 펜이 닿아 있는 동안은 이어진다');
  fire('document', 'pointermove', pen(4, { clientX: xOf(50) }));
  // 버튼은 싣지 않았지만 필압이 있으면 닿아 있는 것이다.
  fire('document', 'pointermove', pen(4, { clientX: xOf(52), buttons: 0, pressure: 0.4 }));
  fire('document', 'pointerup', pen(4, { clientX: xOf(51) }));
  assert.deepEqual(scrubs(), [30, 50, 52]);
  assert.deepEqual(seeks(), [51]);
});

test('a pen scrub accepts the pen even when its pointer id changes or it is not the primary pointer', async t => {
  const { timeline, fire, xOf, seeks, scrubs } = await listenerFixture(t);
  fire('handle', 'pointerdown', pen(4, { clientX: xOf(10), isPrimary: false }));
  assert.equal(timeline.isDraggingPlayhead, true, '펜은 주 포인터가 아니어도 시작한다');
  fire('document', 'pointermove', pen(5, { clientX: xOf(33) }));
  // 펜이 아닌 포인터는 여전히 받지 않는다.
  fire('document', 'pointermove', touch(8, { clientX: xOf(90) }));
  fire('document', 'pointerup', touch(8, { clientX: xOf(90) }));
  assert.equal(timeline.isDraggingPlayhead, true);
  fire('document', 'pointerup', pen(6, { clientX: xOf(34) }));
  assert.deepEqual(scrubs(), [33]);
  assert.deepEqual(seeks(), [34]);
  assert.equal(timeline.isDraggingPlayhead, false);

  // 손가락은 지금처럼 주 포인터만 시작한다. 시작하지 못한 누름은 눈금자에서도 자리를 옮기지 않는다.
  fire('handle', 'pointerdown', touch(8, { clientX: xOf(10), isPrimary: false }));
  fire('ruler', 'pointerdown', touch(8, { clientX: xOf(77), isPrimary: false }));
  assert.equal(timeline.isDraggingPlayhead, false);
  assert.deepEqual(scrubs(), [33]);
});

test('a cancelled pen scrub keeps the last dragged frame instead of snapping back', async t => {
  const { timeline, fire, xOf, seeks } = await listenerFixture(t);
  fire('handle', 'pointerdown', pen(4, { clientX: xOf(10) }));
  fire('document', 'pointermove', pen(4, { clientX: xOf(62) }));
  fire('document', 'pointercancel', pen(4));
  assert.deepEqual(seeks(), [62], '마지막으로 끈 자리에 둔다');
  assert.equal(timeline.isDraggingPlayhead, false);

  // 끌지 않고 취소되면 제자리다.
  fire('handle', 'pointerdown', pen(4, { clientX: xOf(10) }));
  fire('document', 'pointercancel', pen(4));
  assert.deepEqual(seeks(), [62, 10]);
});

test('a new press supersedes a scrub that never saw its release, except for a second finger', async t => {
  const { timeline, fire, xOf, seeks, scrubs } = await listenerFixture(t);
  fire('handle', 'pointerdown', pen(4, { clientX: xOf(10) }));
  fire('document', 'pointermove', pen(4, { clientX: xOf(25) }));
  // 펜의 뗌이 오지 않았다. 다음 누름(마우스)이 앞선 끌기를 마지막 자리에서 끝내고 새로 시작한다.
  fire('ruler', 'pointerdown', mouse({ clientX: xOf(70) }));
  assert.deepEqual(seeks(), [25], '앞선 끌기는 마지막으로 끈 자리에서 끝난다');
  assert.equal(timeline.isDraggingPlayhead, true);
  fire('document', 'pointerup', mouse({ clientX: xOf(71) }));
  assert.deepEqual(seeks(), [25, 71]);
  assert.deepEqual(scrubs(), [25, 70]);

  // 손가락 하나가 끄는 동안 두 번째 손가락의 누름은 무시한다.
  fire('handle', 'pointerdown', touch(8, { clientX: xOf(10) }));
  fire('ruler', 'pointerdown', touch(9, { clientX: xOf(80), isPrimary: false }));
  fire('ruler', 'pointerdown', touch(9, { clientX: xOf(80) }));
  fire('document', 'pointermove', touch(9, { clientX: xOf(80) }));
  assert.equal(timeline._scrubPointerId, 8);
  fire('document', 'pointerup', touch(8, { clientX: xOf(12) }));
  assert.deepEqual(seeks(), [25, 71, 12]);
});
