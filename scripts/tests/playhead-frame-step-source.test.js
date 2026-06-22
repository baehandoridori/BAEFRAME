const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const videoPlayerSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/video-player.js'), 'utf8'));

test('playback frame updates drive the same UI path as timeupdate ticks', () => {
  assert.match(appSource, /function syncPlaybackPositionUI\(currentTime, currentFrame, options = \{\}\) \{/);
  assert.match(appSource, /let lastFrameConsumerSyncFrame = null;/);
  assert.match(appSource, /videoPlayer\.addEventListener\('loadedmetadata', \(e\) => \{[\s\S]+lastFrameConsumerSyncFrame = null;/);

  const syncMatch = appSource.match(/function syncPlaybackPositionUI\(currentTime, currentFrame, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\/ 비디오 시간 업데이트/);
  assert.ok(syncMatch, 'shared playback UI sync helper should be defined before video time handlers');
  const syncSource = syncMatch[1];
  assert.match(syncSource, /timeline\.setCurrentTime\(getActiveTimelinePlaybackTime\(currentTime, currentFrame\)\);/);
  assert.match(syncSource, /updateTimecodeDisplay\(\);/);
  assert.match(syncSource, /updateFullscreenTimecode\(\);/);
  assert.match(syncSource, /updateFullscreenSeekbar\(\);/);
  assert.match(syncSource, /commentManager\.setCurrentFrame\(currentFrame\);/);
  assert.match(syncSource, /updateVideoCommentPlayhead\(\);/);

  const timeupdateMatch = appSource.match(/videoPlayer\.addEventListener\('timeupdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(timeupdateMatch, 'timeupdate handler should exist');
  assert.match(timeupdateMatch[1], /syncPlaybackPositionUI\(currentTime, currentFrame, \{[\s\S]*updatePresence: true,[\s\S]*updateDrawing: !videoPlayer\.isPlaying/);

  const frameUpdateMatch = appSource.match(/videoPlayer\.addEventListener\('frameUpdate', \(e\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(frameUpdateMatch, 'frameUpdate handler should exist');
  assert.match(frameUpdateMatch[1], /syncPlaybackPositionUI\(time, frame, \{[\s\S]*updatePresence: false,[\s\S]*updateDrawing: true/);
  assert.doesNotMatch(frameUpdateMatch[1], /updateTimecodeDisplay\(\);\s*$/);
});

test('rapid frame stepping accumulates from the last requested frame', () => {
  assert.match(videoPlayerSource, /this\._seekTargetFrame = null;/);
  assert.match(videoPlayerSource, /this\._seekToken = 0;/);
  assert.match(videoPlayerSource, /_timeToFrame\(time\) \{[\s\S]+Math\.floor\(\(Number\(time\) \|\| 0\) \* fps \+ 1e-4\)/);

  const seekToFrameMatch = videoPlayerSource.match(/seekToFrame\(frame\) \{([\s\S]*?)\n  \}\n\n  stepFrames/);
  assert.ok(seekToFrameMatch, 'seekToFrame should exist before stepFrames');
  const seekToFrameSource = seekToFrameMatch[1];
  assert.match(seekToFrameSource, /frame = this\._clampFrame\(frame\);/);
  assert.match(seekToFrameSource, /const seekToken = \+\+this\._seekToken;/);
  assert.match(seekToFrameSource, /this\._seekTargetFrame = frame;/);
  assert.match(seekToFrameSource, /if \(seekToken !== this\._seekToken\) return;/);
  assert.match(seekToFrameSource, /if \(this\.engine !== 'html5'\) \{[\s\S]+this\.externalControls\.seek\(time\)/);
  assert.doesNotMatch(seekToFrameSource, /if \(this\.engine !== 'html5'\) \{[\s\S]+this\.seek\(time\);/);

  const externalStatusMatch = videoPlayerSource.match(/async _syncExternalStatus\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ ====== 영상 어니언 스킨/);
  assert.ok(externalStatusMatch, 'external status polling should exist');
  assert.match(externalStatusMatch[1], /this\._isSeeking && this\._seekTargetFrame !== null/);
  assert.match(externalStatusMatch[1], /candidateFrame === this\._seekTargetFrame/);

  const stepMatch = videoPlayerSource.match(/stepFrames\(delta\) \{([\s\S]*?)\n  \}\n\n  \/\*\*/);
  assert.ok(stepMatch, 'stepFrames should exist');
  assert.match(stepMatch[1], /this\._seekTargetFrame !== null[\s\S]+this\._seekTargetFrame[\s\S]+this\.currentFrame/);
  assert.match(stepMatch[1], /this\.seekToFrame\(baseFrame \+ delta\);/);
  assert.match(videoPlayerSource, /prevFrame\(\) \{[\s\S]+this\.stepFrames\(-1\);/);
  assert.match(videoPlayerSource, /nextFrame\(\) \{[\s\S]+this\.stepFrames\(1\);/);
});

test('keyboard frame skip shortcuts use VideoPlayer frame stepping', () => {
  assert.match(appSource, /if \(userSettings\.matchShortcut\('prevFrameFast', e\)\) \{[\s\S]+videoPlayer\.stepFrames\(-frameAmount\);/);
  assert.match(appSource, /if \(userSettings\.matchShortcut\('nextFrameFast', e\)\) \{[\s\S]+videoPlayer\.stepFrames\(frameAmount\);/);
  assert.doesNotMatch(appSource, /const currentFrame = videoPlayer\.currentFrame \|\| 0;[\s\S]+const newFrame = Math\.max\(0, currentFrame - frameAmount\);/);
});
