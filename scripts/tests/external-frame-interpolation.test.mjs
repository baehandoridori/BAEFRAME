import test from 'node:test';
import assert from 'node:assert/strict';

import { VideoPlayer } from '../../renderer/scripts/modules/video-player.js';

function createExternalPlayer(currentFrame, fps = 24) {
  const player = Object.create(VideoPlayer.prototype);
  Object.assign(player, {
    engine: 'mpv',
    isLoaded: true,
    isPlaying: true,
    isBuffering: false,
    cacheDuration: 0,
    cacheBufferingState: 0,
    externalEofReached: false,
    fps,
    duration: 10,
    totalFrames: 10 * fps,
    currentFrame,
    currentTime: currentFrame / fps,
    _lastEmittedFrame: currentFrame,
    _externalFrameRafId: null,
    _externalPlaybackClock: null,
    _externalStatusPending: false,
    _externalStatusEpoch: 0,
    _externalStatusFailureCount: 0,
    _externalEndedEmitted: false,
    _isSeeking: false,
    _seekTargetFrame: null,
    _seekTargetTime: null,
    _seekToken: 0,
    _pausedSeekHoldFrame: null,
    loop: { enabled: false, inPoint: null, outPoint: null }
  });
  player._getPlaybackClockNow = () => 0;
  player.events = [];
  player._emit = (name, detail = {}) => player.events.push({ name, detail });
  return player;
}

function runFirstInterpolationTick(player, anchorFrame, elapsedMs = 0) {
  let pendingTick = null;
  let now = 0;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    pendingTick = callback;
    return 1;
  };
  player._getPlaybackClockNow = () => now;

  try {
    player._startExternalFrameInterpolation(anchorFrame / player.fps);
    assert.equal(typeof pendingTick, 'function', 'interpolation should schedule a frame tick');
    now = elapsedMs;
    pendingTick();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
}

test('forward external playback interpolation does not move backward toward a late poll anchor', () => {
  const latePollPlayer = createExternalPlayer(10);
  runFirstInterpolationTick(latePollPlayer, 9);
  assert.equal(latePollPlayer.currentFrame, 10, 'a late poll anchor must not decrement the displayed frame');
});

function mpvStatus(overrides = {}) {
  return {
    success: true, stopped: false, time: 2, duration: 10, fps: 24,
    width: 1920, height: 1080, paused: false, eofReached: false,
    buffering: false, cacheDuration: 5, cacheBufferingState: 100,
    ...overrides
  };
}

async function withFrameScheduler(run) {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const originalWindow = globalThis.window;
  globalThis.window = {};
  const callbacks = new Map();
  let nextId = 1;
  globalThis.requestAnimationFrame = callback => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = id => callbacks.delete(id);
  try {
    await run(callbacks);
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
    globalThis.window = originalWindow;
  }
}

test('cache buffering pins timeline and drawings to mpv time while preserving playback intent', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(52);
    player.lastExternalStatusTime = 2;
    player.externalControls = { getStatus: async () => mpvStatus({ buffering: true, cacheDuration: 0.2, cacheBufferingState: 10 }) };
    player._startExternalFrameInterpolation(player.currentTime);
    await player._syncExternalStatus();

    assert.equal(player.isPlaying, true, 'waiting for data is not a user pause');
    assert.equal(player.isBuffering, true);
    assert.equal(player.currentTime, 2);
    assert.equal(player.currentFrame, 48, 'correct an interpolation lead back to the actual frame');
    assert.equal(callbacks.size, 0, 'no interpolated frames may run while data is missing');
    assert.deepEqual(player.events.filter(e => e.name === 'bufferingchange'), [{
      name: 'bufferingchange', detail: { buffering: true, cacheDuration: 0.2, cacheBufferingState: 10 }
    }]);
    assert.deepEqual(player.events.filter(e => e.name === 'play' || e.name === 'pause'), []);
    assert.ok(player.events.some(e => e.name === 'frameUpdate' && e.detail.frame === 48));
  });
});

test('buffering transition listeners observe the corrected frame and playback state', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(60);
    let observed = null;
    player._emit = name => {
      if (name === 'bufferingchange') observed = [player.currentTime, player.currentFrame, player.isPlaying];
    };
    player.externalControls = { getStatus: async () => mpvStatus({ buffering: true }) };
    await player._syncExternalStatus();
    assert.deepEqual(observed, [2, 48, true]);
  });
});

test('resuming after buffering starts interpolation from the fresh mpv time', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(52);
    let now = 0;
    let status = mpvStatus({ buffering: true });
    player._getPlaybackClockNow = () => now;
    player.externalControls = { getStatus: async () => status };
    await player._syncExternalStatus();
    now = 30_000;
    status = mpvStatus({ time: 2.25 });
    await player._syncExternalStatus();
    assert.equal(player.isBuffering, false);
    assert.equal(player.currentTime, 2.25);
    assert.equal(player.currentFrame, 54);
    assert.equal(player.isPlaying, true);
    now += 1000 / 24;
    const tick = callbacks.values().next().value;
    assert.equal(typeof tick, 'function');
    tick();
    assert.equal(player.currentFrame, 55, '30 seconds of buffering must not advance the clock');
    assert.deepEqual(player.events.filter(e => e.name === 'play' || e.name === 'pause'), []);
    assert.deepEqual(player.events.filter(e => e.name === 'bufferingchange').map(e => e.detail.buffering), [true, false]);
  });
});

test('an already queued interpolation callback cannot advance while buffering', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(48);
    let now = 0;
    player._getPlaybackClockNow = () => now;
    player._startExternalFrameInterpolation(2);
    const tick = callbacks.values().next().value;
    callbacks.clear();
    player.isBuffering = true;
    now = 5000;
    tick();
    assert.equal(player.currentFrame, 48);
    assert.equal(callbacks.size, 0);
    player._startExternalFrameInterpolation(2);
    assert.equal(callbacks.size, 0, 'other callers must not restart interpolation during buffering');
  });
});

test('calling play during buffering cannot restart the interpolated clock', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    player.externalControls = { play: async () => ({ success: true }) };
    assert.equal(await player.play(), true);
    assert.equal(player.isPlaying, true);
    assert.equal(player.isBuffering, true);
    assert.equal(callbacks.size, 0);
  });
});

test('buffering with missing status time holds the last accepted mpv time', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(60);
    player.lastExternalStatusTime = 2;
    player.externalControls = { getStatus: async () => mpvStatus({ time: null, buffering: true }) };
    await player._syncExternalStatus();
    assert.equal(player.currentTime, 2);
    assert.equal(player.currentFrame, 48);
    assert.equal(player.lastExternalStatusTime, 2);
  });
});

test('buffering does not trigger a loop restart before playback resumes', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(48);
    player.loop = { enabled: true, inPoint: 1, outPoint: 2 };
    const seeks = [];
    player.externalControls = {
      getStatus: async () => mpvStatus({ buffering: true }),
      seek: async time => seeks.push(time)
    };
    await player._syncExternalStatus();
    assert.equal(player.currentTime, 2);
    assert.deepEqual(seeks, []);
    assert.equal(player.isBuffering, true);
  });
});

test('a loop ending at EOF resumes from its in point after buffering', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(239);
    player.isBuffering = true;
    player.loop = { enabled: true, inPoint: 1, outPoint: 10 };
    player.externalControls = {
      getStatus: async () => mpvStatus({ time: 10, eofReached: true }),
      seek: async () => ({ success: true })
    };
    await player._syncExternalStatus();
    assert.equal(player.currentTime, 1);
    assert.equal(player.isPlaying, true, 'keep-open EOF does not cancel the active loop');
    assert.equal(player.isBuffering, false);
    assert.equal(player.events.filter(e => e.name === 'pause' || e.name === 'ended').length, 0);
  });
});

test('user pause clears buffering and rejects a status response captured before the pause', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    let resolveStatus;
    player.externalControls = {
      getStatus: () => new Promise(resolve => { resolveStatus = resolve; }),
      pause: async () => ({ success: true })
    };
    const polling = player._syncExternalStatus();
    player.pause();
    resolveStatus(mpvStatus({ buffering: false, time: 2.5 }));
    await polling;
    assert.equal(player.isPlaying, false);
    assert.equal(player.isBuffering, false);
    assert.equal(player.currentTime, 2);
    assert.equal(callbacks.size, 0);
    assert.equal(player.events.filter(e => e.name === 'play').length, 0);
    assert.deepEqual(player.events.filter(e => e.name === 'bufferingchange').map(e => e.detail.buffering), [false]);

    player.externalControls.getStatus = async () => mpvStatus({ paused: true, buffering: true });
    await player._syncExternalStatus();
    assert.equal(player.isBuffering, false, 'cache activity during user pause must not look like a playback stall');
    player.externalControls.getStatus = async () => mpvStatus({ paused: true, buffering: false });
    await player._syncExternalStatus();
    assert.equal(player.isPlaying, false, 'cache recovery must not resume a user pause');
  });
});

test('polling cannot resume playback while the user pause command is still in flight', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    let resolvePause;
    player.externalControls = {
      getStatus: async () => mpvStatus({ buffering: false }),
      pause: () => new Promise(resolve => { resolvePause = resolve; })
    };
    player.pause();
    try {
      await player._syncExternalStatus();
      assert.equal(player.isPlaying, false);
      assert.equal(player.isBuffering, false);
      assert.equal(callbacks.size, 0);
    } finally {
      resolvePause({ success: true });
    }
  });
});

test('loading a new file clears buffering before the previous engine finishes stopping', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    const video = new EventTarget();
    video.style = {};
    Object.defineProperty(video, 'src', {
      set() { queueMicrotask(() => video.dispatchEvent(new Event('loadedmetadata'))); }
    });
    player.videoElement = video;
    let resolveStop;
    player.externalControls = { stop: () => new Promise(resolve => { resolveStop = resolve; }) };
    const loading = player.load('C:/video/next.mp4');
    try {
      assert.equal(player.isBuffering, false);
      assert.equal(player.isPlaying, false);
    } finally {
      resolveStop({ success: true });
      await loading;
    }
  });
});

test('a status response from before a manual seek cannot rewind the new target or enter buffering', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(48);
    let resolveStatus;
    player.externalControls = {
      getStatus: () => new Promise(resolve => { resolveStatus = resolve; }),
      seek: async () => ({ success: true })
    };
    const polling = player._syncExternalStatus();
    player.seek(5);
    resolveStatus(mpvStatus({ buffering: true }));
    await polling;
    assert.equal(player.currentTime, 5);
    assert.equal(player.currentFrame, 120);
    assert.equal(player.isBuffering, false);
    assert.equal(player._externalPlaybackClock, null, 'an old seek position must not become the new clock anchor');
  });
});

test('a buffering status rejected by a pending frame seek preserves the requested frame', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(120);
    player._isSeeking = true;
    player._seekTargetFrame = 120;
    player._seekTargetTime = 5;
    player.lastExternalStatusTime = 2;
    player.externalControls = { getStatus: async () => mpvStatus({ buffering: true }) };
    await player._syncExternalStatus();
    assert.equal(player.currentTime, 5);
    assert.equal(player.currentFrame, 120);
    assert.equal(player.lastExternalStatusTime, 2, 'rejected seek observations are not accepted engine progress');
  });
});

test('seeking during buffering holds the target when the next poll has no time', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    player.lastExternalStatusTime = 2;
    player.externalControls = {
      getStatus: async () => mpvStatus({ time: null, buffering: true }),
      seek: async () => ({ success: true })
    };
    player.seek(5);
    await player._syncExternalStatus();
    assert.equal(player.currentTime, 5);
    assert.equal(player.currentFrame, 120);
  });
});

test('switching external media resets buffering even when the controls object is reused', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    player.cacheDuration = 0.25;
    let resolveStatus;
    const controls = { getStatus: () => new Promise(resolve => { resolveStatus = resolve; }) };
    player.externalControls = controls;
    const polling = player._syncExternalStatus();
    player.useExternalEngine({ engineName: 'mpv', controls, filePath: 'next.mp4', duration: 20, currentTime: 7, paused: true });
    try {
      resolveStatus(mpvStatus({ buffering: true }));
      await polling;
      assert.equal(player.isBuffering, false);
      assert.equal(player.cacheDuration, 0);
      assert.equal(player.currentTime, 7);
      assert.equal(player.duration, 20);
      assert.equal(player.isPlaying, false);
    } finally {
      player._stopExternalStatusPolling();
    }
  });
});

test('a stopped engine clears buffering and emits the stopped event', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(48);
    player.isBuffering = true;
    player.externalControls = { getStatus: async () => mpvStatus({ stopped: true }), stop: async () => ({ success: true }) };
    await player._syncExternalStatus();
    assert.equal(player.engine, 'html5');
    assert.equal(player.isLoaded, false);
    assert.equal(player.isBuffering, false);
    assert.equal(player.events.filter(e => e.name === 'externalstopped').length, 1);
  });
});

test('EOF clears buffering and reports one playback end', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(230);
    player.isBuffering = true;
    player.externalControls = { getStatus: async () => mpvStatus({ time: 10, eofReached: true, buffering: true }) };
    await player._syncExternalStatus();
    await player._syncExternalStatus();
    assert.equal(player.isBuffering, false);
    assert.equal(player.isPlaying, false);
    assert.equal(player.events.filter(e => e.name === 'ended').length, 1);
  });
});

test('forward external playback interpolation advances one frame toward a newer anchor', () => {
  const forwardPlayer = createExternalPlayer(10);
  runFirstInterpolationTick(forwardPlayer, 11);
  assert.equal(forwardPlayer.currentFrame, 11, 'a newer poll anchor should advance by one frame');
});

test('high-fps interpolation advances by the predicted elapsed frame delta', () => {
  const highFpsPlayer = createExternalPlayer(10, 120);
  runFirstInterpolationTick(highFpsPlayer, 10, 1000 / 60);
  assert.equal(highFpsPlayer.currentFrame, 12, '120fps playback should advance two frames per 60Hz tick');
});

test('paused external polling holds one-frame seek noise but adopts a real two-frame backward move', async () => {
  const heldPlayer = createExternalPlayer(10);
  heldPlayer._pausedSeekHoldFrame = 10;
  heldPlayer.externalControls = {
    getStatus: async () => ({ success: true, time: 9 / 24, duration: 10, fps: 24, paused: true })
  };
  await heldPlayer._syncExternalStatus();
  assert.equal(heldPlayer.currentFrame, 10, 'N-1 polling noise should preserve the paused seek target');
  assert.equal(heldPlayer._pausedSeekHoldFrame, 10);

  const movedPlayer = createExternalPlayer(10);
  movedPlayer._pausedSeekHoldFrame = 10;
  movedPlayer.externalControls = {
    getStatus: async () => ({ success: true, time: 8 / 24, duration: 10, fps: 24, paused: true })
  };
  await movedPlayer._syncExternalStatus();
  assert.equal(movedPlayer.currentFrame, 8, 'N-2 should be treated as a real backward move');
  assert.equal(movedPlayer._pausedSeekHoldFrame, null);
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('pauseAndSync waits for the pause ACK and final engine frame before it reports success', async () => {
  await withFrameScheduler(async callbacks => {
    const player = createExternalPlayer(60);
    const pause = deferred();
    const status = deferred();
    let statusReads = 0;
    player.externalControls = {
      pause: () => pause.promise,
      getStatus: () => { statusReads++; return status.promise; }
    };
    player._startExternalFrameInterpolation(player.currentTime);
    const pending = player.pauseAndSync();
    assert.equal(player.isPlaying, false, 'existing immediate pause feedback remains');
    assert.equal(callbacks.size, 0);
    await player._syncExternalStatus();
    assert.equal(statusReads, 0, 'ordinary polling must wait for the pause ACK');
    pause.resolve({ success: true });
    await Promise.resolve();
    assert.equal(statusReads, 1);
    assert.equal(player.currentFrame, 60, 'the interpolated frame is not confirmed yet');
    await player._syncExternalStatus();
    assert.equal(statusReads, 1, 'ordinary polling must not race the final status read');
    status.resolve(mpvStatus({ paused: true, time: 2.125 }));
    assert.equal(await pending, true);
    assert.equal(player.currentFrame, 51);
    assert.equal(player.currentTime, 2.125);
    assert.equal(player.lastExternalStatusTime, 2.125);
    assert.equal(player.isPlaying, false);
    assert.equal(player._externalPlaybackRequest, null);
    assert.ok(player.events.some(event => event.name === 'frameUpdate' && event.detail.frame === 51));
  });
});

for (const scenario of ['pause rejected', 'pause failed', 'pause unacknowledged', 'status failed', 'status running', 'status stopped', 'status missing time']) {
  test(`pauseAndSync does not confirm an unavailable engine snapshot: ${scenario}`, async () => {
    await withFrameScheduler(async () => {
      const player = createExternalPlayer(60);
      const status = mpvStatus({ paused: true });
      if (scenario === 'status failed') status.success = false;
      if (scenario === 'status running') status.paused = false;
      if (scenario === 'status stopped') status.stopped = true;
      if (scenario === 'status missing time') status.time = null;
      player.externalControls = {
        pause: async () => {
          if (scenario === 'pause rejected') throw new Error('pause failed');
          if (scenario === 'pause unacknowledged') return undefined;
          return { success: scenario !== 'pause failed' };
        },
        getStatus: async () => status,
        stop: async () => ({ success: true })
      };
      assert.equal(await player.pauseAndSync(), false);
      assert.equal(player.currentFrame, 60);
      assert.equal(player._externalPlaybackRequest, null);
    });
  });
}

for (const stage of ['pause ACK', 'final status']) {
  for (const scenario of ['play', 'seek', 'reused controls new media', 'controls replaced']) {
    test(`pauseAndSync abandons stale ${stage} after ${scenario}`, async () => {
      await withFrameScheduler(async () => {
        const player = createExternalPlayer(60);
        const pause = deferred();
        const status = deferred();
        const controls = {
          pause: () => pause.promise,
          getStatus: () => status.promise,
          play: async () => ({ success: true }),
          seek: async () => ({ success: true })
        };
        player.externalControls = controls;
        const pending = player.pauseAndSync();
        if (stage === 'final status') {
          pause.resolve({ success: true });
          await Promise.resolve();
        }
        if (scenario === 'play') await player.play();
        if (scenario === 'seek') player.seek(5);
        if (scenario === 'reused controls new media') {
          player.useExternalEngine({ engineName: 'mpv', controls, filePath: 'new.mp4', duration: 10, currentTime: 6 });
        }
        if (scenario === 'controls replaced') player.externalControls = { ...controls };
        const frame = player.currentFrame;
        pause.resolve({ success: true });
        status.resolve(mpvStatus({ paused: true, time: 2 }));
        try {
          assert.equal(await pending, false);
          assert.equal(player.currentFrame, frame);
          if (scenario === 'play') assert.equal(player.isPlaying, true);
        } finally {
          player._stopExternalStatusPolling();
        }
      });
    });
  }
}

test('pauseAndSync adopts actual frame zero and does not retain a previous seek hold frame', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(1);
    player._pausedSeekHoldFrame = 1;
    player.externalControls = {
      pause: async () => ({ success: true }),
      getStatus: async () => mpvStatus({ paused: true, time: 0 })
    };
    assert.equal(await player.pauseAndSync(), true);
    assert.equal(player.currentFrame, 0);
    assert.equal(player.currentTime, 0);
  });
});

test('pauseAndSync rejects an engine position that has not reached an existing manual seek', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(120);
    player._isSeeking = true;
    player._seekTargetFrame = 120;
    player.externalControls = {
      pause: async () => ({ success: true }),
      getStatus: async () => mpvStatus({ paused: true, time: 2 })
    };
    assert.equal(await player.pauseAndSync(), false);
    assert.equal(player.currentFrame, 120);
  });
});

test('a pre-pause status response cannot replace the final pauseAndSync snapshot', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(60);
    const oldStatus = deferred();
    let reads = 0;
    player.externalControls = {
      pause: async () => ({ success: true }),
      getStatus: () => ++reads === 1 ? oldStatus.promise : Promise.resolve(mpvStatus({ paused: true, time: 2.125 }))
    };
    const polling = player._syncExternalStatus();
    assert.equal(await player.pauseAndSync(), true);
    oldStatus.resolve(mpvStatus({ time: 3 }));
    await polling;
    assert.equal(player.currentFrame, 51);
    assert.equal(player.isPlaying, false);
  });
});

test('an older pause request cannot unlock polling or confirm the newer request', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(60);
    const firstPause = deferred();
    const secondPause = deferred();
    let pauses = 0;
    let reads = 0;
    player.externalControls = {
      pause: () => ++pauses === 1 ? firstPause.promise : secondPause.promise,
      getStatus: async () => { reads++; return mpvStatus({ paused: true }); }
    };
    const first = player.pauseAndSync();
    const second = player.pauseAndSync();
    const secondOwner = player._externalPlaybackRequest;
    firstPause.resolve({ success: true });
    assert.equal(await first, false);
    assert.equal(player._externalPlaybackRequest, secondOwner);
    await player._syncExternalStatus();
    assert.equal(reads, 0);
    secondPause.resolve({ success: true });
    assert.equal(await second, true);
    assert.equal(reads, 1);
  });
});

test('pauseAndSync does not apply a final status after a direct media identity change', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(60);
    const status = deferred();
    player.filePath = 'A.mp4';
    player.externalControls = { pause: async () => ({ success: true }), getStatus: () => status.promise };
    const pending = player.pauseAndSync();
    await Promise.resolve();
    player.filePath = 'B.mp4';
    status.resolve(mpvStatus({ paused: true, time: 2 }));
    assert.equal(await pending, false);
    assert.equal(player.currentFrame, 60);
  });
});

test('pauseAndSync rejects a seek started by its frame notification listener', async () => {
  await withFrameScheduler(async () => {
    const player = createExternalPlayer(60);
    player.externalControls = {
      pause: async () => ({ success: true }),
      getStatus: async () => mpvStatus({ paused: true, time: 2 }),
      seek: async () => ({ success: true })
    };
    let changed = false;
    player._emit = name => {
      if (name === 'timeupdate' && !changed) {
        changed = true;
        player.seek(5);
      }
    };
    assert.equal(await player.pauseAndSync(), false);
    assert.equal(player.currentFrame, 120);
  });
});

for (const seeking of [false, true]) {
  test(`HTML5 pauseAndSync confirms only a settled frame (seeking=${seeking})`, async () => {
    await withFrameScheduler(async () => {
      const player = createExternalPlayer(60);
      player.engine = 'html5';
      player.videoElement = { currentTime: 2.125, paused: false, seeking, pause() { this.paused = true; } };
      assert.equal(await player.pauseAndSync(), !seeking);
      assert.equal(player.currentFrame, seeking ? 60 : 51);
    });
  });
}
