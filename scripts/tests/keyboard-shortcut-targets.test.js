const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = value => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));

test('play/pause shortcut can be handled from focused controls but not text editors', async () => {
  const {
    shouldHandlePlayPauseShortcutFromTarget
  } = await import('../../renderer/scripts/modules/keyboard-shortcut-targets.js');

  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'checkbox' }), true);
  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'range' }), true);
  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'BUTTON' }), true);

  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'TEXTAREA' }), false);
  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'text' }), false);
  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'search' }), false);
  assert.equal(shouldHandlePlayPauseShortcutFromTarget({ tagName: 'DIV', isContentEditable: true }), false);
});

test('form controls only allow play/pause override for the Space shortcut', async () => {
  const {
    shouldHandlePlayPauseShortcutFromTarget
  } = await import('../../renderer/scripts/modules/keyboard-shortcut-targets.js');

  assert.equal(
    shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'range' }, { code: 'Space' }),
    true
  );
  assert.equal(
    shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'range' }, { code: 'ArrowLeft' }),
    false
  );
  assert.equal(
    shouldHandlePlayPauseShortcutFromTarget({ tagName: 'INPUT', type: 'checkbox' }, { code: 'KeyK' }),
    false
  );
  assert.match(appSource, /shouldHandlePlayPauseShortcutFromTarget\(e\.target, e\)/);
});

test('Space play/pause shortcut suppresses focused control keyup activation', () => {
  assert.match(appSource, /let suppressPlayPauseShortcutKeyup = false;/);
  assert.match(
    appSource,
    /if \(isPlayPauseShortcut\) \{[\s\S]+if \(e\.code === 'Space'\) \{[\s\S]+suppressPlayPauseShortcutKeyup = true;[\s\S]+\}[\s\S]+e\.preventDefault\(\);[\s\S]+e\.stopPropagation\(\);[\s\S]+handleUserPlayPauseToggle\(\);/
  );
  assert.match(
    appSource,
    /function handleKeyup\(e\) \{[\s\S]+if \(!suppressPlayPauseShortcutKeyup \|\| e\.code !== 'Space'\) return;[\s\S]+e\.preventDefault\(\);[\s\S]+e\.stopPropagation\(\);[\s\S]+suppressPlayPauseShortcutKeyup = false;[\s\S]+\}/
  );
  assert.match(appSource, /document\.addEventListener\('keydown', handleKeydown, true\);/);
  assert.match(appSource, /document\.addEventListener\('keyup', handleKeyup, true\);/);
});

test('non-playback shortcuts stay ignored for form controls', async () => {
  const {
    shouldIgnoreGlobalShortcutTarget
  } = await import('../../renderer/scripts/modules/keyboard-shortcut-targets.js');

  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'INPUT', type: 'checkbox' }), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'INPUT', type: 'range' }), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'SELECT' }), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'INPUT', type: 'text' }), true);

  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'BUTTON' }), false);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'DIV' }), false);
});
