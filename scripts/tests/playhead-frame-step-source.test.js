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
  assert.match(videoPlayerSource, /_timeToFrame\(time\) \{[\s\S]+Math\.floor\(\(Number\(time\) \|\| 0\) \* fps \+ 0\.05\)/);

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

test('paused seek hold initializes and resets at playback lifecycle boundaries', () => {
  const constructorMatch = videoPlayerSource.match(/constructor\(options = \{\}\) \{([\s\S]*?)\n  \}\n\n  _clampFrame/);
  assert.ok(constructorMatch, 'VideoPlayer constructor should exist before _clampFrame');
  assert.match(constructorMatch[1], /this\._seekToken = 0;\s*this\._pausedSeekHoldFrame = null;/);

  const unloadMatch = videoPlayerSource.match(/unload\(\) \{([\s\S]*?)\n  \}\n\n  _startExternalStatusPolling/);
  assert.ok(unloadMatch, 'unload should exist before external status polling');
  assert.match(unloadMatch[1], /this\.fps = 24;\s*this\.filePath = null;\s*this\._pausedSeekHoldFrame = null;/);
});

test('time and frame seeks hold the frame immediately after calculating their targets', () => {
  const seekMatch = videoPlayerSource.match(/\n  seek\(time\) \{([\s\S]*?)\n  \}\n\n  \/\*\*\n   \* 특정 프레임으로 이동/);
  assert.ok(seekMatch, 'seek should exist before seekToFrame');
  assert.match(seekMatch[1], /this\.currentFrame = this\._timeToFrame\(time\);\s*this\._pausedSeekHoldFrame = this\.currentFrame;/);

  const seekToFrameMatch = videoPlayerSource.match(/seekToFrame\(frame\) \{([\s\S]*?)\n  \}\n\n  stepFrames/);
  assert.ok(seekToFrameMatch, 'seekToFrame should exist before stepFrames');
  assert.match(seekToFrameMatch[1], /this\._seekTargetTime = time;\s*this\._pausedSeekHoldFrame = frame;/);
});

test('paused polling keeps plus or minus one frame noise and adopts larger external drift', () => {
  const externalStatusMatch = videoPlayerSource.match(/async _syncExternalStatus\(\) \{([\s\S]*?)\n  \}\n\n  \/\/ ====== 영상 어니언 스킨/);
  assert.ok(externalStatusMatch, 'external status polling should exist');
  const externalStatusSource = externalStatusMatch[1];

  assert.match(externalStatusSource, /const nextIsPlaying = !eofReached && externalIsPlaying;\s*if \(nextIsPlaying\) \{\s*this\._pausedSeekHoldFrame = null; \/\/ 재생이 시작되면 유지 해제\s*\}\s*const shouldInterpolateExternalPlayback = nextIsPlaying && !this\._isSeeking;/);
  assert.match(externalStatusSource, /this\._stopExternalFrameInterpolation\(\);\s*const clampedNextFrame = Math\.max\(0, Math\.min\(nextFrame, Math\.max\(0, this\.totalFrames - 1\)\)\);\s*const holdFrame = this\._pausedSeekHoldFrame;\s*if \(holdFrame !== null && Math\.abs\(clampedNextFrame - holdFrame\) <= 1\) \{[\s\S]*?this\.currentFrame = this\._clampFrame\(holdFrame\);\s*this\.currentTime = this\.currentFrame \/ Math\.max\(1, Number\(this\.fps\) \|\| 24\);\s*\} else \{\s*this\._pausedSeekHoldFrame = null;\s*this\.currentTime = candidateTime;\s*this\.currentFrame = clampedNextFrame;\s*\}/);
});
