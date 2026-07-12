import test from 'node:test';
import assert from 'node:assert/strict';

import { VideoPlayer } from '../../renderer/scripts/modules/video-player.js';

function createExternalPlayer(currentFrame) {
  const player = Object.create(VideoPlayer.prototype);
  Object.assign(player, {
    engine: 'mpv',
    isLoaded: true,
    isPlaying: true,
    externalEofReached: false,
    fps: 24,
    duration: 10,
    totalFrames: 240,
    currentFrame,
    currentTime: currentFrame / 24,
    _lastEmittedFrame: currentFrame,
    _externalFrameRafId: null,
    _externalPlaybackClock: null,
    _externalStatusPending: false,
    _externalStatusFailureCount: 0,
    _externalEndedEmitted: false,
    _isSeeking: false,
    _seekTargetFrame: null,
    _seekTargetTime: null,
    _pausedSeekHoldFrame: null,
    loop: { enabled: false, inPoint: null, outPoint: null }
  });
  player._getPlaybackClockNow = () => 0;
  player._emit = () => {};
  return player;
}

function runFirstInterpolationTick(player, anchorFrame) {
  let pendingTick = null;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    pendingTick = callback;
    return 1;
  };

  try {
    player._startExternalFrameInterpolation(anchorFrame / player.fps);
    assert.equal(typeof pendingTick, 'function', 'interpolation should schedule a frame tick');
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

test('forward external playback interpolation advances one frame toward a newer anchor', () => {
  const forwardPlayer = createExternalPlayer(10);
  runFirstInterpolationTick(forwardPlayer, 11);
  assert.equal(forwardPlayer.currentFrame, 11, 'a newer poll anchor should advance by one frame');
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
