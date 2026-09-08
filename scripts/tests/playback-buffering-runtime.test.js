const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8').replace(/\r\n/g, '\n');

function extractFunction(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(appSource);
  assert.ok(match, `${name} exists`);
  const body = appSource.indexOf(') {', match.index) + 2;
  let depth = 0;
  for (let index = body; index < appSource.length; index++) {
    if (appSource[index] === '{') depth++;
    if (appSource[index] === '}') depth--;
    if (depth === 0) return appSource.slice(match.index, index + 1);
  }
  assert.fail(`Unclosed function ${name}`);
}

function loadFunction(name, dependencies) {
  return new Function(...Object.keys(dependencies), `${extractFunction(name)}; return ${name};`)(...Object.values(dependencies));
}

function createAdvanceHarness() {
  let now = 0;
  let active = true;
  const intervals = new Set();
  const player = Object.assign(new EventTarget(), { engine: 'mpv', videoElement: null, isPlaying: true });
  const snapshot = { currentTime: 10, statusTime: 10, duration: 100, ended: false, buffering: false };
  const wait = loadFunction('waitForContinuousPlaybackAdvance', {
    videoPlayer: player,
    getContinuousPlaybackSnapshot: () => ({ ...snapshot }),
    hasContinuousPlaybackReachedMediaEnd: value => (value || snapshot).ended,
    isContinuousSessionActive: () => active,
    performance: { now: () => now },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback)
  });
  return {
    wait, player, snapshot, intervals,
    cancel() { active = false; },
    tick(ms) { now += ms; for (const callback of [...intervals]) callback(); }
  };
}

test('normal cache waiting does not spend the continuous-playback failure budget', async () => {
  const h = createAdvanceHarness();
  h.snapshot.buffering = true;
  let settled = false;
  const result = h.wait(1, { timeoutMs: 1500 }).then(value => { settled = true; return value; });
  h.tick(1800);
  await Promise.resolve();
  assert.equal(settled, false, 'buffering must not trigger a retry or skip');
  h.snapshot.buffering = false;
  h.tick(120);
  h.snapshot.statusTime = 10.1;
  h.player.dispatchEvent(new Event('timeupdate'));
  assert.equal(await result, true);
  assert.equal(h.intervals.size, 0);
});

test('buffer wait remains bounded even when status never advances', async () => {
  const h = createAdvanceHarness();
  h.snapshot.buffering = true;
  let settled = false;
  const result = h.wait(1, { timeoutMs: 1500 }).then(value => { settled = true; return value; });
  h.tick(14000);
  await Promise.resolve();
  assert.equal(settled, false);
  h.tick(1100);
  assert.equal(await result, false);
  assert.equal(h.intervals.size, 0);
});

test('a non-buffering stall still fails within its original progress budget', async () => {
  const h = createAdvanceHarness();
  const result = h.wait(1, { timeoutMs: 1500 });
  h.tick(1600);
  assert.equal(await result, false);
});

test('cancellation wins over a late progress event during a buffer wait', async () => {
  const h = createAdvanceHarness();
  h.snapshot.buffering = true;
  const result = h.wait(1, { timeoutMs: 1500 });
  h.cancel();
  h.snapshot.statusTime = 10.2;
  h.player.dispatchEvent(new Event('timeupdate'));
  assert.equal(await result, false);
  assert.equal(h.intervals.size, 0);
});

function createWatchdogHarness({ buffering, cancelOnWait = 0, waitResults = [false, false] }) {
  let active = true;
  let waits = 0;
  const effects = { play: 0, pause: 0, stopped: 0, skipped: [], messages: [] };
  const player = {
    isPlaying: true, isBuffering: buffering,
    async play() { effects.play++; this.isPlaying = true; return true; },
    pause() { effects.pause++; this.isPlaying = false; }
  };
  const run = loadFunction('playContinuousItemWithWatchdog', {
    videoPlayer: player,
    isContinuousSessionActive: () => active,
    waitForContinuousMediaReady: async () => true,
    waitForContinuousPlaybackAdvance: async () => {
      waits++;
      if (waits === cancelOnWait) active = false;
      return waitResults[waits - 1];
    },
    waitForContinuousDelay: async () => {},
    stopContinuousPlayback: () => { active = false; effects.stopped++; },
    markPlaylistItemStatus: item => effects.skipped.push(item.id),
    continuousPlaybackState: { skippedBatch: [] },
    CONTINUOUS_STATUS: { ERROR: 'error' },
    showToast: message => effects.messages.push(message),
    log: { warn() {} }
  });
  return { run, effects };
}

test('exhausted buffer wait stops on the current item instead of retrying or skipping it', async () => {
  const h = createWatchdogHarness({ buffering: true });
  assert.equal(await h.run({ id: 'current' }, 1), false);
  assert.equal(h.effects.stopped, 1);
  assert.equal(h.effects.pause, 1);
  assert.equal(h.effects.play, 0);
  assert.deepEqual(h.effects.skipped, []);
  assert.equal(h.effects.messages.length, 1);
});

test('a cancelled retry cannot mark an item skipped after the session changes', async () => {
  const h = createWatchdogHarness({ buffering: false, cancelOnWait: 2 });
  assert.equal(await h.run({ id: 'old-item' }, 1), false);
  assert.deepEqual(h.effects.skipped, []);
});

test('composition playback follows actual buffer state while preserving user play intent', () => {
  const updates = [];
  const player = { currentTime: 12.5, isPlaying: true, isBuffering: true };
  const sync = loadFunction('syncCompositionLayerPlaybackState', {
    videoPlayer: player,
    compositionLayerManager: { setPlaybackState: value => updates.push(value), toJSON: () => [] },
    document: { body: { classList: { contains: () => false } } },
    scheduleMpvOverlayStateSync() {}
  });
  sync(12.5, true);
  assert.deepEqual(updates.pop(), { currentTime: 12.5, isPlaying: false });
  assert.equal(player.isPlaying, true);
  player.isBuffering = false;
  sync(12.5, true);
  assert.deepEqual(updates.pop(), { currentTime: 12.5, isPlaying: true });
});

test('native mpv overlay composition payload pauses and resumes with the primary video buffer', () => {
  const player = { currentTime: 12.5, isPlaying: true, isBuffering: true };
  const rect = { left: 0, top: 0, width: 640, height: 360 };
  const overlayState = loadFunction('getMpvOverlayState', {
    videoPlayer: player,
    elements: { videoWrapper: { getBoundingClientRect: () => rect }, drawingCanvas: { getBoundingClientRect: () => rect } },
    compositionLayerManager: { getMpvOverlayLayers: options => options },
    shouldSuppressLegacyDrawingForFabricPilot: () => true,
    remoteStrokeOverlayForMpv: null,
    getFabricDrawingPilotViewport: () => null,
    serializeMpvOverlayMarkerHtml: () => '',
    serializeMpvOverlayTooltipHtml: () => '',
    serializeMpvOverlayHtml: () => '',
    serializeMpvOverlayToastHtml: () => '',
    videoCommentPlayhead: null,
    markerContainer: null,
    getMpvVideoTransform: () => ({}),
    getMpvOverlayDrawModeShortcutDescriptor: () => null
  });
  assert.deepEqual(overlayState().compositionLayers, { currentTime: 12.5, isPlaying: false });
  player.isBuffering = false;
  assert.deepEqual(overlayState().compositionLayers, { currentTime: 12.5, isPlaying: true });
  player.isPlaying = false;
  assert.equal(overlayState().compositionLayers.isPlaying, false);
});
