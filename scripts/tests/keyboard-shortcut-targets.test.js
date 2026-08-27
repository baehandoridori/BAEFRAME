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
  assert.match(appSource, /shouldHandlePlayPauseShortcutFromTarget\(shortcutTarget, e\)/);
});

test('Space play/pause shortcut suppresses focused control keyup activation', () => {
  assert.match(appSource, /let suppressPlayPauseShortcutKeyup = false;/);
  assert.match(
    appSource,
    /if \(isPlayPauseInput\) \{[\s\S]+if \(e\.code === 'Space' && state\.isDrawMode && !isFabricDrawingPilotEngaged\(\)\) \{[\s\S]+state\.isSpaceHeld = true;[\s\S]+\}[\s\S]+if \(e\.code === 'Space'\) \{[\s\S]+suppressPlayPauseShortcutKeyup = true;[\s\S]+\}[\s\S]+e\.preventDefault\(\);[\s\S]+e\.stopPropagation\(\);[\s\S]+handleUserPlayPauseToggle\(\);/
  );
  assert.match(
    appSource,
    /function handleKeyup\(e\) \{[\s\S]+if \(e\.code !== 'Space'\) return;[\s\S]+if \(state\.isSpaceHeld\) \{[\s\S]+handleUserPlayPauseToggle\(\);[\s\S]+\}[\s\S]+if \(!suppressPlayPauseShortcutKeyup\) return;[\s\S]+suppressPlayPauseShortcutKeyup = false;[\s\S]+\}/
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

test('global shortcuts use active text entry when keyboard target is the page shell', async () => {
  const {
    getEffectiveKeyboardShortcutTarget,
    shouldIgnoreComposingKeyboardEvent
  } = await import('../../renderer/scripts/modules/keyboard-shortcut-targets.js');

  const activeInput = { tagName: 'TEXTAREA' };
  const bodyTarget = { tagName: 'BODY' };
  assert.equal(
    getEffectiveKeyboardShortcutTarget({ target: bodyTarget }, { activeElement: activeInput }),
    activeInput
  );
  assert.equal(
    getEffectiveKeyboardShortcutTarget({ target: { tagName: 'INPUT', type: 'text' } }, { activeElement: activeInput })?.tagName,
    'INPUT'
  );
  assert.equal(shouldIgnoreComposingKeyboardEvent({ isComposing: true }), true);
  assert.equal(shouldIgnoreComposingKeyboardEvent({ key: 'Process' }), true);
  assert.equal(shouldIgnoreComposingKeyboardEvent({ code: 'Process' }), true);
  assert.equal(shouldIgnoreComposingKeyboardEvent({ key: 'a', code: 'KeyA' }), false);

  assert.match(appSource, /if \(isTextEntryShortcutTarget\(shortcutTarget\) && shouldIgnoreComposingKeyboardEvent\(e\)\) return;/);
  assert.match(appSource, /const shortcutTarget = getEffectiveKeyboardShortcutTarget\(e, document\);/);
  assert.match(appSource, /shouldHandlePlayPauseShortcutFromTarget\(shortcutTarget, e\)/);
  assert.match(appSource, /shouldIgnoreGlobalShortcutTarget\(shortcutTarget, e\)/);
});

test('비텍스트 폼 컨트롤은 그 컨트롤이 소비하는 키만 차단한다', async () => {
  const {
    shouldIgnoreGlobalShortcutTarget
  } = await import('../../renderer/scripts/modules/keyboard-shortcut-targets.js');

  const range = { tagName: 'INPUT', type: 'range' };
  const checkbox = { tagName: 'INPUT', type: 'checkbox' };
  const select = { tagName: 'SELECT' };

  // 문자 키는 통과한다 — 슬라이더/셀렉트에 포커스가 남아도 B/C/V가 살아야 한다.
  assert.equal(shouldIgnoreGlobalShortcutTarget(range, { code: 'KeyB' }), false);
  assert.equal(shouldIgnoreGlobalShortcutTarget(checkbox, { code: 'KeyC' }), false);
  assert.equal(shouldIgnoreGlobalShortcutTarget(select, { code: 'KeyV' }), false);

  // 컨트롤이 실제로 소비하는 키는 계속 차단한다.
  for (const code of [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Space', 'Home', 'End', 'PageUp', 'PageDown', 'Enter'
  ]) {
    assert.equal(shouldIgnoreGlobalShortcutTarget(range, { code }), true, `range/${code}`);
    assert.equal(shouldIgnoreGlobalShortcutTarget(select, { code }), true, `select/${code}`);
  }

  // 텍스트 입력형은 키와 무관하게 전면 차단을 유지한다.
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'INPUT', type: 'text' }, { code: 'KeyB' }), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'TEXTAREA' }, { code: 'KeyB' }), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget({ tagName: 'DIV', isContentEditable: true }, { code: 'KeyB' }), true);

  // code를 알 수 없는 호출은 기존과 동일하게 보수적으로 차단한다.
  assert.equal(shouldIgnoreGlobalShortcutTarget(range), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget(range, {}), true);
  assert.equal(shouldIgnoreGlobalShortcutTarget(select, { code: 123 }), true);
});

test('IME 조합 게이트는 텍스트 입력 대상에만 적용되고 폼 컨트롤 가드는 이벤트를 함께 본다', () => {
  assert.match(
    appSource,
    /const shortcutTarget = getEffectiveKeyboardShortcutTarget\(e, document\);\n(?:\s*\/\/[^\n]*\n)*\s*if \(isTextEntryShortcutTarget\(shortcutTarget\) && shouldIgnoreComposingKeyboardEvent\(e\)\) return;/
  );
  assert.doesNotMatch(appSource, /\n\s+if \(shouldIgnoreComposingKeyboardEvent\(e\)\) return;\n/);
  assert.match(appSource, /if \(shouldIgnoreGlobalShortcutTarget\(shortcutTarget, e\)\) return;/);
  assert.match(appSource, /document\.addEventListener\('paste', async \(e\) => \{\n\s+if \(shouldIgnoreGlobalShortcutTarget\(e\.target\)\) return;/);
});
