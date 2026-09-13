const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/modules/mention-manager.js'), 'utf8').replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
function harness(t, contenteditable = false, pointer = false) {
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  if (pointer) win.PointerEvent = win.MouseEvent;
  win.HTMLElement.prototype.scrollIntoView = () => {};
  win.Range.prototype.getBoundingClientRect = () => ({ left: 0, bottom: 20 });
  win.eval(`const TEAM_MEMBERS = [{name:'테스트'}]; const createLogger = () => ({}); ${source}; window.Manager = MentionManager;`);
  const manager = new win.Manager();
  const input = win.document.createElement(contenteditable ? 'div' : 'textarea');
  if (contenteditable) input.setAttribute('contenteditable', 'plaintext-only');
  win.document.body.appendChild(input); manager.attach(input);
  const type = value => {
    input.focus();
    if (contenteditable) {
      input.textContent = value;
      const range = win.document.createRange(); range.selectNodeContents(input); range.collapse(false);
      win.getSelection().removeAllRanges(); win.getSelection().addRange(range);
    } else { input.value = value; input.setSelectionRange(value.length, value.length); }
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  t.after(() => { manager.destroy(); win.close(); });
  return { manager, input, win, type, text: () => contenteditable ? input.textContent : input.value };
}
for (const surface of ['new', 'marker-edit', 'reply', 'reply-edit', 'aggregate-reply', 'thread', 'popout']) {
  test(`${surface}: Korean adjacent mention, IME enter, selection once`, t => {
    const h = harness(t, false, true);
    for (const value of ['확인@테', '(@테', '@테', ' @테']) { h.type(value); assert.equal(h.manager.isVisibleFor(h.input), true, value); }
    h.type('abc@te'); assert.equal(h.manager.isVisible, false);
    h.type('확인@테');
    const composing = new h.win.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    h.input.dispatchEvent(composing);
    assert.equal(composing.defaultPrevented, false); assert.equal(h.text(), '확인@테');
    h.input.dispatchEvent(new h.win.CompositionEvent('compositionstart'));
    h.input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(h.text(), '확인@테');
    h.input.dispatchEvent(new h.win.CompositionEvent('compositionend'));
    const legacyIme = new h.win.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true });
    h.input.dispatchEvent(legacyIme); assert.equal(h.text(), '확인@테');
    let submits = 0;
    h.input.addEventListener('keydown', e => { if (e.key === 'Enter') submits++; });
    h.input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(h.text(), '확인@테스트 '); assert.equal(submits, 0);
    h.type('(@테');
    const candidate = h.win.document.querySelector('.mention-item');
    candidate.dispatchEvent(new h.win.MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    candidate.dispatchEvent(new h.win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    assert.equal(h.text(), '(@테스트 ');
  });
}
test('plaintext-only editing accepts Korean and consumes only mention navigation keys', t => {
  const h = harness(t, true);
  h.type('확인@테'); assert.equal(h.manager.isVisibleFor(h.input), true);
  const letter = new h.win.KeyboardEvent('keydown', { key: 'x', bubbles: true });
  h.input.dispatchEvent(letter); assert.notEqual(letter.__mentionHandled, true);
  h.input.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(h.text(), '확인@테스트 ');
});
