const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const managerSource = fs.readFileSync(path.join(root, 'renderer/scripts/modules/mention-manager.js'), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
const membersSource = fs.readFileSync(path.join(root, 'renderer/scripts/modules/team-members.js'), 'utf8')
  .replace(/^export /gm, '');

function harness(t) {
  const main = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://baeframe.test/' });
  const popup = new JSDOM('<body></body>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://baeframe.test/comments' });
  for (const dom of [main, popup]) {
    dom.window.HTMLElement.prototype.scrollIntoView = function () {};
    dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 260, top: 176, right: 260, bottom: 200, width: 0, height: 24 });
  }
  Object.defineProperties(popup.window, { innerWidth: { value: 320 }, innerHeight: { value: 230 } });
  main.window.eval(`${membersSource}\nconst createLogger = () => ({});\n${managerSource}\nwindow.MentionManager = MentionManager;`);
  const manager = new main.window.MentionManager();
  t.after(() => { manager.destroy(); main.window.close(); popup.window.close(); });
  return { main: main.window, popup: popup.window, manager };
}

function typeQuery(textarea, value) {
  textarea.value = value;
  textarea.focus();
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new textarea.ownerDocument.defaultView.Event('input', { bubbles: true }));
}

test('adopted textarea places and selects mentions in the popup, then returns to its original document', t => {
  const { main, popup, manager } = harness(t);
  const textarea = main.document.createElement('textarea');
  main.document.body.appendChild(textarea);
  manager.attach(textarea);
  popup.document.body.appendChild(popup.document.adoptNode(textarea));
  textarea.getBoundingClientRect = () => ({ left: 260, top: 160, right: 300, bottom: 200, width: 40, height: 40 });
  const inputs = [];
  textarea.addEventListener('input', event => inputs.push(event));
  typeQuery(textarea, '검토 @윤 / 뒤');
  textarea.setSelectionRange('검토 @윤'.length, '검토 @윤'.length);
  textarea.dispatchEvent(new popup.Event('input', { bubbles: true }));

  const dropdown = popup.document.querySelector('.mention-dropdown');
  assert.ok(dropdown, 'the menu must follow the adopted input to the popup body');
  assert.equal(dropdown.parentNode, popup.document.body);
  assert.equal(dropdown.style.left, '112px', 'position must use the smaller popup viewport');
  assert.equal(dropdown.style.top, '120px');
  assert.equal(dropdown.querySelector('.mention-item-name').textContent, '윤성원');
  dropdown.querySelector('.mention-item').dispatchEvent(new popup.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '검토 @윤성원  / 뒤');
  assert.equal(textarea.selectionStart, '검토 @윤성원 '.length);
  assert.ok(inputs.at(-1) instanceof popup.Event, 'inserted text must notify listeners with an event from its own window');
  assert.equal(inputs.at(-1) instanceof main.Event, false);
  assert.equal(manager.isVisible, false);

  manager.hide();
  main.document.body.appendChild(main.document.adoptNode(textarea));
  typeQuery(textarea, textarea.value + '\n@배');
  assert.equal(main.document.querySelector('.mention-dropdown'), dropdown, 'the same manager and menu return to the main document');
  textarea.dispatchEvent(new main.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(textarea.value, '검토 @윤성원  / 뒤\n@배한솔 ');
  assert.ok(inputs.at(-1) instanceof main.Event);
  assert.equal(inputs.at(-1) instanceof popup.Event, false);
});

test('popup contenteditable uses its own selection and ranges while preserving formatted surrounding text', t => {
  const { main, popup, manager } = harness(t);
  const parentText = main.document.createTextNode('부모 선택은 그대로');
  main.document.body.appendChild(parentText);
  const parentRange = main.document.createRange();
  parentRange.setStart(parentText, 2); parentRange.collapse(true);
  main.getSelection().addRange(parentRange);
  const editor = main.document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.innerHTML = '<strong>확인</strong> @<em>윤</em><span> 뒤</span>';
  main.document.body.appendChild(editor);
  manager.attach(editor);
  popup.document.body.appendChild(popup.document.adoptNode(editor));
  editor.focus();
  const range = popup.document.createRange();
  range.setStart(editor.querySelector('em').firstChild, 1); range.collapse(true);
  popup.getSelection().removeAllRanges();
  popup.getSelection().addRange(range);
  const inputs = [];
  editor.addEventListener('input', event => inputs.push(event));
  editor.dispatchEvent(new popup.Event('input', { bubbles: true }));

  assert.equal(manager.isVisible, true, 'the parent selection must not hide mentions in the child document');
  const dropdown = popup.document.querySelector('.mention-dropdown');
  assert.ok(dropdown);
  assert.equal(dropdown.style.left, '112px');
  editor.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(editor.textContent, '확인 @윤성원  뒤');
  assert.equal(editor.querySelector('strong').textContent, '확인');
  assert.equal(editor.querySelector('span').textContent, ' 뒤');
  assert.ok(inputs.at(-1) instanceof popup.Event);
  assert.equal(inputs.at(-1) instanceof main.Event, false);
  const caret = popup.getSelection();
  assert.equal(caret.isCollapsed, true);
  assert.ok(editor.contains(caret.anchorNode));
  const prefix = popup.document.createRange();
  prefix.setStart(editor, 0); prefix.setEnd(caret.anchorNode, caret.anchorOffset);
  assert.equal(prefix.toString(), '확인 @윤성원 ');
  assert.equal(main.getSelection().anchorNode, parentText);
  assert.equal(main.getSelection().anchorOffset, 2);
});

test('a delayed blur from the original input does not close a new popup mention', async t => {
  const { main, popup, manager } = harness(t);
  const original = main.document.createElement('textarea');
  const other = popup.document.createElement('textarea');
  main.document.body.appendChild(original); popup.document.body.appendChild(other);
  manager.attach(original); manager.attach(other);
  typeQuery(original, '@윤');
  original.dispatchEvent(new main.FocusEvent('blur'));
  typeQuery(other, '@배');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(manager.isVisible, true);
  assert.equal(manager._activeElement, other);
  assert.equal(popup.document.querySelector('.mention-item-name').textContent, '배한솔');
});
