const { test } = require('node:test');
const assert = require('node:assert/strict');

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
