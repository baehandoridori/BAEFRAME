'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const timeline = require('../../renderer/scripts/editor/timeline-interaction');

test('fit and logarithmic zoom use real pixels per frame and bound browser content width', () => {
  assert.equal(timeline.fitScale(240, 960), 4);
  assert.equal(timeline.sliderScale(0, 4, 64), 4);
  assert.equal(timeline.sliderScale(100, 4, 64), 64);
  assert.equal(timeline.scaleSlider(16, 4, 64), 50);
  assert(timeline.scaleLimits(10_000_000, 1000).max * 10_000_000 <= 16_000_000);
});

test('zoom preserves the frame below the pointer and clamps either content edge', () => {
  const zoom = timeline.zoomAt({
    scale: 4,
    nextScale: 8,
    scrollLeft: 120,
    anchorX: 240,
    viewportWidth: 600,
    totalFrames: 240
  });
  assert.equal((zoom.scrollLeft + 240) / zoom.scale, 90);
  assert.equal(zoom.scrollLeft, 480);
  assert.equal(
    timeline.zoomAt({
      scale: 8,
      nextScale: 2.5,
      scrollLeft: 1200,
      anchorX: 600,
      viewportWidth: 600,
      totalFrames: 240
    }).scrollLeft,
    0
  );
});

test('pointer mapping excludes fixed layer labels and honors horizontal scroll', () => {
  const view = { left: 10, labelWidth: 164, scrollLeft: 96, pxPerFrame: 8, totalFrames: 120 };
  assert.equal(timeline.frameAtClientX(174, view), 12);
  assert.equal(timeline.frameAtClientX(270, view), 24);
  assert.equal(timeline.frameAtClientX(-500, view), 0);
  assert.equal(timeline.frameAtClientX(9999, view), 119);
});

test('ruler labels adapt from seconds to integer frames without a fixed five-column grid', () => {
  const distant = timeline.rulerTicks({
    fps: 24,
    pxPerFrame: 0.5,
    scrollLeft: 0,
    viewportWidth: 960,
    totalFrames: 2400
  });
  assert(distant.majorStep >= 120);
  const close = timeline.rulerTicks({
    fps: 24,
    pxPerFrame: 24,
    scrollLeft: 48,
    viewportWidth: 960,
    totalFrames: 2400
  });
  assert(close.majorStep <= 5);
  assert(close.ticks.some((tick) => !tick.major));
  assert(close.ticks.filter((tick) => tick.major).every((tick) => tick.label.endsWith('F')));
  assert(close.ticks.every((tick) => Number.isInteger(tick.frame)));
  assert(close.ticks.length <= 150);
});

test('fractional-FPS ruler stays on integral output frames and only emits visible neighborhood', () => {
  const value = timeline.rulerTicks({
    fps: 29.97,
    pxPerFrame: 0.1,
    scrollLeft: 3000,
    viewportWidth: 800,
    totalFrames: 100_000
  });
  assert(value.ticks.length < 150);
  assert(value.ticks.every((tick) => Number.isInteger(tick.frame) && tick.frame >= 0));
  assert(value.ticks[0].frame >= 25000);
});

test('razor resolves exact frame and ignores clip edges and one-frame clips', () => {
  const clips = [
    { id: 'a', durationFrames: 24 },
    { id: 'b', durationFrames: 1 },
    { id: 'c', durationFrames: 48 }
  ];
  assert.deepEqual(timeline.razorTarget(clips, 'c', 35), {
    clipId: 'c',
    localFrame: 10,
    frame: 35
  });
  assert.equal(timeline.razorTarget(clips, 'a', 0), null);
  assert.equal(timeline.razorTarget(clips, 'a', 24), null);
  assert.equal(timeline.razorTarget(clips, 'b', 24), null);
});

test('drag insertion returns final core move index and actual boundary for uneven clips', () => {
  const clips = [
    { id: 'a', durationFrames: 24 },
    { id: 'b', durationFrames: 48 },
    { id: 'c', durationFrames: 12 }
  ];
  assert.deepEqual(timeline.insertionTarget(clips, 'a', 80), {
    index: 2,
    frame: 84,
    beforeId: null
  });
  assert.deepEqual(timeline.insertionTarget(clips, 'c', 30), {
    index: 1,
    frame: 24,
    beforeId: 'b'
  });
  assert.deepEqual(timeline.insertionTarget(clips, 'b', 0), { index: 0, frame: 0, beforeId: 'a' });
  assert.deepEqual(timeline.insertionTarget(clips, 'b', 40), {
    index: 1,
    frame: 72,
    beforeId: 'c'
  });
});

test('layer holds keep clip-local duration and inherited source-frame identity', () => {
  const ranges = timeline.holdRanges(
    [
      { frame: 0, sourceFrame: 12, held: true, isEmpty: false },
      { frame: 5, sourceFrame: 17, isEmpty: true },
      { frame: 8, sourceFrame: 20, isEmpty: false }
    ],
    12
  );
  assert.deepEqual(
    ranges.map((range) => [range.start, range.end, range.empty, range.held]),
    [
      [0, 5, false, true],
      [5, 8, true, false],
      [8, 12, false, false]
    ]
  );
  assert.equal(ranges[0].sourceFrame, 12);
  assert.equal(ranges[2].duration, 4);
});

test('tool shortcuts ignore form fields, composition, repeats and OS shortcuts', () => {
  assert.equal(timeline.shortcutTool({ key: 'C' }), 'razor');
  assert.equal(timeline.shortcutTool({ key: 'v' }), 'select');
  assert.equal(timeline.shortcutTool({ key: 'B' }), 'brush');
  assert.equal(timeline.shortcutTool({ key: 'e' }), 'eraser');
  assert.equal(timeline.shortcutTool({ key: 'h' }), 'hand');
  for (const properties of [
    { ctrlKey: true },
    { metaKey: true },
    { altKey: true },
    { isComposing: true },
    { repeat: true },
    { editable: true }
  ])
  {assert.equal(timeline.shortcutTool({ key: 'c', ...properties }), null);}
});

test('latest seek coalesces superseded positions while keeping one preparation boundary', async () => {
  let unblock;
  const seen = [],
    boundaries = [];
  const queue = timeline.createLatestQueue(
    async (frame, hasNewer) => {
      seen.push(frame);
      if (frame === 1)
      {await new Promise((resolve) => {
        unblock = resolve;
      });}
      if (!hasNewer()) seen.push(`present:${frame}`);
    },
    { start: async () => boundaries.push('start'), finish: async () => boundaries.push('finish') }
  );
  const pending = queue.request(1);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  queue.request(2);
  queue.request(8);
  queue.request(12);
  unblock();
  await pending;
  assert.deepEqual(seen, [1, 12, 'present:12']);
  assert.deepEqual(boundaries, ['start', 'finish']);
});

test('latest seek releases preparation on failure and can run another request', async () => {
  const finished = [];
  const queue = timeline.createLatestQueue(
    async (frame) => {
      if (frame === 1) throw new Error('decode');
    },
    { finish: async () => finished.push(true) }
  );
  await assert.rejects(queue.request(1), /decode/);
  await queue.request(2);
  assert.equal(finished.length, 2);
});

test('failed seek preparation still releases its UI boundary and pending requests', async () => {
  let attempts = 0;
  let finishes = 0;
  const queue = timeline.createLatestQueue(async () => {}, {
    start: async () => {
      if (++attempts === 1) throw new Error('prepare');
    },
    finish: async () => {
      finishes++;
    }
  });
  await assert.rejects(queue.request(4), /prepare/);
  assert.equal(finishes, 1);
  assert.equal(queue.hasPending, false);
  await queue.request(8);
  assert.equal(finishes, 2);
});

test('preview zoom anchors a stage point and pan remains bounded by viewport geometry', () => {
  const result = timeline.zoomPreview({
    zoom: 1,
    nextZoom: 2,
    panX: 0,
    panY: 0,
    anchorX: 100,
    anchorY: -50
  });
  assert.deepEqual(result, { zoom: 2, panX: -100, panY: 50 });
  const clamped = timeline.clampPan({
    panX: 999,
    panY: -999,
    zoom: 2,
    stageWidth: 800,
    stageHeight: 450,
    viewportWidth: 1000,
    viewportHeight: 600
  });
  assert.equal(clamped.panX, 999);
  assert.equal(clamped.panY, -600);
});
