const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8');
const playlistCss = fs.readFileSync(path.join(rootDir, 'renderer/styles/playlist-panel.css'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('continuous runtime imports the shared helper module', () => {
  assert.match(appSource, /CONTINUOUS_STATUS[\s\S]+findNextPlayableIndex[\s\S]+createSkippedToastMessage[\s\S]+from '\.\/modules\/playlist-continuous-core\.js'/);
});

test('continuous selection does not auto-load before preparation finishes', () => {
  assert.match(appSource, /let suppressPlaylistSelectionLoad = false;/);
  assert.match(appSource, /function selectPlaylistItemForContinuous\(index\)/);
  assert.match(appSource, /if \(suppressPlaylistSelectionLoad\) \{[\s\S]+updatePlaylistCurrentItem\(\);[\s\S]+updatePlaylistPosition\(\);[\s\S]+return;/);
});

test('ended event routes active continuous playback before normal autoplay', () => {
  assert.match(appSource, /if \(continuousPlaybackState\.active\) \{[\s\S]+playNextContinuousItem\(\);[\s\S]+return;[\s\S]+if \(playlistManager\.isActive\(\) && playlistManager\.getAutoPlay\(\)/);
});

test('continuous completion flushes skipped batch before stopping playback', () => {
  const completionBranchMatch = appSource.match(/if \(nextIndex < 0\) \{([\s\S]*?)\n    \}/);
  assert.ok(completionBranchMatch, 'completion branch should exist');

  const completionBranch = completionBranchMatch[1];
  assert.ok(
    completionBranch.indexOf('flushSkippedToastBatch();') < completionBranch.indexOf('stopContinuousPlayback();'),
    'skipped batch must flush before stopContinuousPlayback clears it'
  );
  assert.ok(
    completionBranch.indexOf('stopContinuousPlayback();') < completionBranch.indexOf("showToast('재생목록 재생 완료', 'success');"),
    'completion toast should be shown after playback is stopped'
  );
});

test('playlist rows render and color continuous status text', () => {
  assert.match(appSource, /playlist-item-continuous-status/);
  assert.match(appSource, /el\.dataset\.continuousStatus = item\.continuousStatus;/);
  assert.match(playlistCss, /\.playlist-item-continuous-status/);
  assert.match(playlistCss, /\[data-continuous-status="preparing"\]/);
  assert.match(playlistCss, /\[data-continuous-status="ready"\]/);
  assert.match(playlistCss, /\[data-continuous-status="missing"\]/);
});

test('playlist test script includes continuous runtime coverage', () => {
  assert.match(packageJson.scripts['test:playlist'], /playlist-continuous-runtime\.test\.js/);
});
