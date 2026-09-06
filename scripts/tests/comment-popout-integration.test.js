const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const app = fs.readFileSync(path.resolve(__dirname, '../../renderer/scripts/app.js'), 'utf8');
function functionSource(name) {
  const match = app.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  \\}`));
  assert.ok(match, `${name} exists`);
  return match[0];
}
function fixture(t) {
  const parent = new JSDOM('<body><button class="filter-chip active" data-filter="all"></button></body>');
  const child = new JSDOM('<body><aside id="commentPanel"><button class="filter-chip active" data-filter="unresolved"></button><button class="filter-chip" data-filter="all"></button><button id="authorFilterBtn" class="active"></button><button id="markerToggleBtn"></button><div id="authorFilterMenu" class="open"></div><textarea class="comment-reply-input"></textarea></aside></body>');
  t.after(() => { parent.window.close(); child.window.close(); });
  const context = vm.createContext({
    document: parent.window.document,
    window: parent.window,
    Element: parent.window.Element,
    HTMLTextAreaElement: parent.window.HTMLTextAreaElement,
    getComputedStyle: node => node.ownerDocument.defaultView.getComputedStyle(node),
    elements: { commentPanel: child.window.document.getElementById('commentPanel') },
    commentFilterState: { status: 'unresolved', authors: ['a'], showMarkers: false },
    isTextEntryShortcutTarget: target => target.tagName === 'TEXTAREA'
  });
  return { parent, child, context };
}

test('comment editable and keyboard targets accept nodes from the detached window realm', t => {
  const { child, context } = fixture(t);
  vm.runInContext(functionSource('getCommentEditableTarget') + functionSource('getTextEntryFocusableTarget'), context);
  context.target = child.window.document.querySelector('textarea');
  assert.equal(vm.runInContext('getCommentEditableTarget(target)', context), context.target);
  assert.equal(vm.runInContext('getTextEntryFocusableTarget(target)', context), context.target);
});

test('detached reply editors retain automatic height limits', t => {
  const { child, context } = fixture(t);
  vm.runInContext(functionSource('resizeReplyEditorToContent'), context);
  context.editor = child.window.document.querySelector('textarea');
  Object.defineProperty(context.editor, 'scrollHeight', { value: 225 });
  vm.runInContext('resizeReplyEditorToContent(editor)', context);
  assert.equal(context.editor.style.height, '150px');
  assert.equal(context.editor.style.overflowY, 'auto');
});

test('active filter and reset act on the moved panel rather than the parent document', t => {
  const { parent, child, context } = fixture(t);
  vm.runInContext(functionSource('getActiveCommentFilter') + functionSource('resetCommentFilters'), context);
  assert.equal(vm.runInContext('getActiveCommentFilter()', context), 'unresolved');
  vm.runInContext('resetCommentFilters()', context);
  assert.equal(context.elements.commentPanel.querySelector('.filter-chip.active').dataset.filter, 'all');
  assert.equal(child.window.document.getElementById('authorFilterMenu').classList.contains('open'), false);
  assert.equal(parent.window.document.querySelector('.filter-chip').classList.contains('active'), true);
});

test('global shortcuts resolve focus in the event window while typing', async t => {
  const { child, context } = fixture(t);
  const input = child.window.document.querySelector('textarea');
  input.focus();
  let resolvedDocument;
  Object.assign(context, {
    getEffectiveKeyboardShortcutTarget: (_event, ownerDocument) => { resolvedDocument = ownerDocument; return ownerDocument.activeElement; },
    shouldIgnoreComposingKeyboardEvent: () => false,
    userSettings: { matchShortcut: () => false },
    commentManager: {},
    getSplitViewManager: () => ({ isOpen: () => false }),
    shouldIgnoreGlobalShortcutTarget: () => true,
    event: { target: child.window.document.body, code: 'KeyB' }
  });
  vm.runInContext(functionSource('handleKeydown'), context);
  await vm.runInContext('handleKeydown(event)', context);
  assert.equal(resolvedDocument, child.window.document);
});

test('delegated attachment images and Drive links work in the child document', t => {
  const { child, context } = fixture(t);
  let shownImage, shownPath;
  context.openImageViewer = src => { shownImage = src; };
  context.window.electronAPI = { showInFolder: selectedPath => { shownPath = selectedPath; } };
  vm.runInContext(functionSource('handleCommentImageClick') + functionSource('handleDriveLinkClick'), context);
  child.window.document.body.insertAdjacentHTML('beforeend', '<div class="comment-attached-image"><img data-full-image="data:image/png;base64,AA=="></div><button class="gdrive-link-btn" data-path="G:/review/example.mov"></button>');
  context.event = { target: child.window.document.querySelector('img'), preventDefault() {}, stopPropagation() {} };
  vm.runInContext('handleCommentImageClick(event)', context);
  context.event.target = child.window.document.querySelector('.gdrive-link-btn');
  vm.runInContext('handleDriveLinkClick(event)', context);
  assert.equal(shownImage, 'data:image/png;base64,AA==');
  assert.equal(shownPath, 'G:/review/example.mov');
});

test('child listeners clean up on docking and main modals focus only when newly opened', async t => {
  const { parent, child, context } = fixture(t);
  parent.window.document.body.insertAdjacentHTML('beforeend', '<div class="modal-overlay"></div>');
  let clicks = 0, keydowns = 0, focusCalls = 0;
  parent.window.focus = () => { focusCalls += 1; };
  Object.assign(context, {
    MutationObserver: parent.window.MutationObserver,
    handleKeydown: () => { keydowns += 1; },
    handleKeyup() {},
    handleSidebarCommentEscape() {},
    handleCommentMenusOutsideClick: () => { clicks += 1; },
    handleCommentImageClick() {},
    handleDriveLinkClick() {},
    state: { isSpaceHeld: true, spacePanUsed: true },
    suppressPlayPauseShortcutKeyup: true,
    childWindow: child.window
  });
  vm.runInContext(functionSource('installCommentPopoutDocument'), context);
  const cleanup = vm.runInContext('installCommentPopoutDocument(childWindow)', context);
  child.window.document.body.click();
  child.window.document.body.dispatchEvent(new child.window.KeyboardEvent('keydown', { bubbles: true, key: 'x' }));
  assert.equal(clicks, 1);
  assert.equal(keydowns, 1);
  const modal = parent.window.document.querySelector('.modal-overlay');
  modal.classList.add('active');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(focusCalls, 1);
  modal.classList.add('extra-layout-class');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(focusCalls, 1, 'layout updates in an open modal do not steal focus repeatedly');
  cleanup();
  child.window.document.body.click();
  child.window.document.body.dispatchEvent(new child.window.KeyboardEvent('keydown', { bubbles: true, key: 'x' }));
  assert.equal(clicks, 1);
  assert.equal(keydowns, 1);
  assert.equal(context.state.isSpaceHeld, false);
});

test('outside clicks in the other window dismiss moved author and settings menus', t => {
  const { child, context } = fixture(t);
  context.elements.commentPanel.insertAdjacentHTML('beforeend', '<div id="authorFilterWrapper"></div><div id="commentSettingsDropdown" class="open"></div><button id="btnCommentSettings" class="active"></button>');
  vm.runInContext(functionSource('handleCommentMenusOutsideClick'), context);
  context.event = { target: child.window.document.body };
  vm.runInContext('handleCommentMenusOutsideClick(event)', context);
  assert.equal(child.window.document.getElementById('authorFilterMenu').classList.contains('open'), false);
  assert.equal(child.window.document.getElementById('commentSettingsDropdown').classList.contains('open'), false);
});

test('the first inline reply stays expanded on redraw before a thread toggle exists', t => {
  const { child, context } = fixture(t);
  const container = child.window.document.createElement('div');
  container.innerHTML = `
    <div class="comment-item" data-marker-id="first-reply">
      <div class="comment-replies expanded" data-marker-id="first-reply"><textarea>작성 중인 첫 답글</textarea></div>
    </div>
    <div class="comment-item" data-marker-id="existing">
      <button class="comment-thread-toggle expanded" data-marker-id="existing"></button>
      <div class="comment-replies expanded" data-marker-id="existing"></div>
    </div>
    <div class="comment-item" data-marker-id="closed">
      <div class="comment-replies" data-marker-id="closed"></div>
    </div>`;
  context.container = container;
  const renderer = functionSource('updateCommentListImmediate');
  const collection = renderer.match(/const expandedIds = new Set\([\s\S]*?\n    \);/)?.[0];
  assert.ok(collection, 'the renderer captures expanded threads before replacing the list');
  const expandedIds = vm.runInContext(`${collection}\nexpandedIds`, context);
  assert.equal(expandedIds.has('first-reply'), true);
  assert.equal(expandedIds.has('existing'), true);
  assert.equal(expandedIds.has('closed'), false);
  assert.equal(expandedIds.size, 2, 'one comment is kept once even when both controls are expanded');
});
