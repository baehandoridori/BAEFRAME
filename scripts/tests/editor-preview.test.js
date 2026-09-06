'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../shared/edit-project');
const { createPreviewTransport, layerKeyframes, presentedFrame, frameTimecode } = require('../../renderer/scripts/editor/preview-clock');

function projectFixture() {
  const source = { id: 'source', path: 'C:/clip.mp4', name: 'clip', durationSeconds: 10,
    width: 1920, height: 1080, fps: 30, hasAudio: true };
  let project = core.appendSource(core.createProject(), source);
  project = core.trimClip(project, project.clips[0].id, 12, 204);
  return core.insertHold(project, project.clips[0].id, 12, 12);
}

function harness(project = projectFixture(), initialFrame = 0) {
  let frame = initialFrame;
  let now = 0;
  let requestId = 0;
  const raf = new Map();
  const decoded = new Map();
  const changes = [];
  const playing = [];
  const errors = [];
  const video = {
    currentTime: 0.5, paused: true, ended: false,
    play: async () => { video.paused = false; },
    pause: () => { video.paused = true; },
    requestVideoFrameCallback(callback) { const id = ++requestId; decoded.set(id, callback); return id; },
    cancelVideoFrameCallback(id) { decoded.delete(id); }
  };
  const transport = createPreviewTransport({
    core, video, getProject: () => project, getFrame: () => frame,
    now: () => now,
    requestFrame(callback) { const id = ++requestId; raf.set(id, callback); return id; },
    cancelFrame(id) { raf.delete(id); },
    async onFrame(next, options) {
      frame = next;
      changes.push({ frame, prepare: !!options.prepare });
      if (options.prepare) video.currentTime = core.resolveFrame(project, frame).sourceTime;
    },
    onPlaying: value => playing.push(value), onError: error => errors.push(error)
  });
  async function settle() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
  return {
    video, transport, changes, errors, playing, get frame() { return frame; },
    async animation(time) {
      now = time;
      const pending = [...raf.values()]; raf.clear();
      for (const callback of pending) callback(time);
      await settle();
    },
    async present(mediaTime) {
      video.currentTime = mediaTime;
      const pending = [...decoded.values()]; decoded.clear();
      for (const callback of pending) callback(now, { mediaTime });
      await settle();
    },
    settle
  };
}

test('video drawing frames follow presented media time and never elapsed wall time', async () => {
  const h = harness();
  await h.transport.play();
  await h.animation(5000);
  assert.equal(h.frame, 0, 'a stalled decoder cannot advance the drawing');
  await h.present(0.75);
  assert.equal(h.frame, 6);
  await h.animation(10000);
  assert.equal(h.frame, 6);
  h.transport.pause();
  assert.equal(h.video.paused, true);
  await h.present(0.9);
  assert.equal(h.frame, 6, 'stale decoded callbacks cannot restart paused playback');
  assert.deepEqual(h.errors, []);
});

test('a video boundary starts a silent freeze clock then resumes the next source range', async () => {
  const h = harness();
  await h.transport.play();
  await h.present(1);
  assert.equal(h.frame, 12);
  assert.equal(h.video.paused, true);
  assert.deepEqual(h.changes.at(-1), { frame: 12, prepare: true });
  await h.animation(250);
  assert.equal(h.frame, 18);
  assert.equal(h.video.currentTime, 1);
  await h.animation(500);
  assert.equal(h.frame, 24);
  assert.equal(h.video.paused, false);
  assert.equal(h.video.currentTime, 1);
  assert.deepEqual(h.changes.at(-1), { frame: 24, prepare: true });
});

test('freeze pause and resume retain its output position and finish on the last frame', async () => {
  const h = harness(undefined, 15);
  await h.transport.play();
  await h.animation(125);
  assert.equal(h.frame, 18);
  h.transport.pause();
  await h.animation(1000);
  assert.equal(h.frame, 18);
  await h.transport.play();
  await h.animation(1250);
  assert.equal(h.frame, 24);
  await h.present(1.5);
  assert.equal(h.frame, 35);
  assert.equal(h.transport.playing, false);
  assert.equal(h.video.paused, true);
  assert.deepEqual(h.changes.at(-1), { frame: 35, prepare: true });
});

test('early video ended advances to the next clip instead of stranding the play button', async () => {
  const h = harness();
  await h.transport.play();
  h.video.ended = true;
  await h.animation(40);
  assert.equal(h.frame, 12);
  assert.equal(h.transport.playing, true);
});

test('a rejected old play request cannot stop a later resumed transport', async () => {
  const h = harness();
  const play = h.video.play;
  let rejectOld;
  h.video.play = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  const first = h.transport.play();
  h.transport.pause();
  h.video.play = play;
  await h.transport.play();
  rejectOld(new Error('The play request was interrupted by pause'));
  await first;
  assert.equal(h.transport.playing, true);
  assert.equal(h.video.paused, false);
  assert.deepEqual(h.errors, []);
  await h.present(0.75);
  assert.equal(h.frame, 6);
});

test('presented source timestamps map to the output clock after a fractional source trim', () => {
  const project = projectFixture();
  assert.equal(presentedFrame(project, 0, 0.5), 0);
  assert.equal(presentedFrame(project, 0, 0.75), 6);
  assert.equal(presentedFrame(project, 0, 0.4999), 0);
  assert.equal(presentedFrame(project, 2, 1.25), 30);
});

test('layer rows use object assignments and the base layer instead of whole-scene emptiness', () => {
  const keys = [
    { frame: 0, isEmpty: false, objects: [{ id: 'first' }, { id: 'unassigned' }] },
    { frame: 12, isEmpty: false, objects: [{ id: 'second' }] },
    { frame: 24, isEmpty: true, objects: [] }
  ];
  const layers = { baseLayerId: 'base', assignments: { first: 'base', second: 'other' } };
  assert.deepEqual(layerKeyframes(keys, 'base', layers).map(key => key.isEmpty), [false, true, true]);
  assert.deepEqual(layerKeyframes(keys, 'other', layers).map(key => key.isEmpty), [true, false, true]);
  assert.deepEqual(layerKeyframes(keys, 'empty', layers).map(key => key.isEmpty), [true, true, true]);
  assert.equal(keys[0].objects.length, 2);
  assert.equal(keys[0].isEmpty, false);
});

test('prototype-like stroke IDs have ordinary explicit layer assignments', () => {
  const assignments = JSON.parse('{"__proto__":"upper"}');
  const keys = [{ frame: 0, objects: [{ id: '__proto__' }, { id: 'toString' }] }];
  assert.deepEqual(layerKeyframes(keys, 'upper', { baseLayerId: 'base', assignments })[0].objects, [{ id: '__proto__' }]);
  assert.deepEqual(layerKeyframes(keys, 'base', { baseLayerId: 'base', assignments })[0].objects, [{ id: 'toString' }]);
});

test('custom fractional FPS shows integral frame fields instead of floating-point remainders', () => {
  assert.equal(frameTimecode(25, 24), '00:01:01');
  assert.equal(frameTimecode(48, 48), '00:01:00');
  assert.equal(frameTimecode(30, 29.97), '00:01:00');
  assert.equal(frameTimecode(59, 29.97), '00:01:29');
  assert.equal(frameTimecode(60, 29.97), '00:02:00');
});
