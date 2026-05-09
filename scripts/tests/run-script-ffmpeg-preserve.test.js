const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const runScript = fs.readFileSync(path.join(repoRoot, 'run-baeframe.bat'), 'utf8');

test('run-baeframe.bat does not delete local FFmpeg binaries during mirror sync', () => {
  const mirrorLine = runScript
    .split(/\r?\n/)
    .find((line) => line.includes('robocopy "%SOURCE_DIR%" "%LOCAL_DIR%" /MIR'));

  assert.ok(mirrorLine, 'expected main robocopy mirror line');
  assert.match(mirrorLine, /\/XD\b.*\bffmpeg\b/i);
});

test('run-baeframe.bat syncs FFmpeg binaries only when source binaries exist', () => {
  assert.match(runScript, /SOURCE_HAS_FFMPEG/);
  assert.match(runScript, /LOCAL_HAS_FFMPEG/);
  assert.match(runScript, /robocopy "%SOURCE_DIR%\\ffmpeg" "%LOCAL_DIR%\\ffmpeg"/);
});

test('run-baeframe.bat stays ASCII-only for reliable cmd.exe parsing', () => {
  assert.doesNotMatch(runScript, /[^\x00-\x7F]/);
});

test('run-baeframe.bat uses rem comments instead of label-style comments', () => {
  assert.doesNotMatch(runScript, /^\s*::/m);
});

test('run-baeframe.bat preserves user data stored beside the local mirror', () => {
  const mirrorLine = runScript
    .split(/\r?\n/)
    .find((line) => line.includes('robocopy "%SOURCE_DIR%" "%LOCAL_DIR%" /MIR'));

  assert.ok(mirrorLine, 'expected main robocopy mirror line');
  assert.match(mirrorLine, /\brecent-files\.json\b/i);
  assert.match(mirrorLine, /"Local Storage"/i);
  assert.match(mirrorLine, /"Code Cache"/i);
  assert.match(mirrorLine, /\bPreferences\b/i);
});
