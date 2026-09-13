const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
test('refresh keeps the actual editing DOM, draft, selection and focus; last refresh runs once on end', async () => {
  const { createCommentEditSession } = await import('../../renderer/scripts/modules/comment-edit-session.js');
  const dom = new JSDOM('<div><textarea>draft</textarea></div>');
  const element = dom.window.document.querySelector('textarea'); element.focus(); element.setSelectionRange(1, 3);
  const session = createCommentEditSession(); const calls = [];
  session.begin({ key: 'a:l:m', element });
  session.deferRefresh(() => calls.push('old')); session.deferRefresh(() => calls.push('latest'));
  assert.equal(session.getElement(), element); assert.equal(element.value, 'draft');
  assert.equal(element.selectionStart, 1); assert.equal(dom.window.document.activeElement, element);
  assert.deepEqual(calls, []); session.end(); session.end(); assert.deepEqual(calls, ['latest']);
  session.begin({ key: 'b:l:m', element }); session.deferRefresh(() => calls.push('wrong-context')); session.end({ flush: false });
  assert.deepEqual(calls, ['latest']); assert.equal(session.isEditing(), false); dom.window.close();
});

const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
function fn(name) { const start = appSource.indexOf(`function ${name}(`); return appSource.slice(start, appSource.indexOf('\n  }', start) + 4); }
test('actual playlist and normal list renderers defer refresh while an editor owns the DOM', async () => {
  const { createCommentEditSession } = await import('../../renderer/scripts/modules/comment-edit-session.js');
  for (const name of ['renderPlaylistContinuousCommentList', 'updateCommentListImmediate']) {
    const dom = new JSDOM('<div id="list"><textarea>unfinished</textarea></div>');
    const container = dom.window.document.querySelector('#list'); const editor = container.firstChild; editor.focus();
    const session = createCommentEditSession(); session.begin({ key: 'a:m', element: editor });
    const context = vm.createContext({ commentEditSession: session, elements: { commentsList: container },
      getActiveCommentFilter: () => 'all', deferCommentListRefresh: cb => session.isEditing() && session.deferRefresh(cb) });
    vm.runInContext(fn(name), context);
    context[name]('all');
    assert.equal(container.firstChild, editor); assert.equal(editor.value, 'unfinished');
    assert.equal(dom.window.document.activeElement, editor); session.end({ flush: false }); dom.window.close();
  }
});


test('actual focus handoff preserves a deferred remote refresh until the next editor ends', async () => {
  const { createCommentEditSession } = await import('../../renderer/scripts/modules/comment-edit-session.js');
  const dom = new JSDOM('<div id="list"><textarea id="a">first draft</textarea><textarea id="b">second draft</textarea></div>');
  const container = dom.window.document.querySelector('#list');
  const session = createCommentEditSession(); const drafts = new Map(); const calls = [];
  const context = vm.createContext({ commentEditSession: session, commentDrafts: drafts,
    getCommentDraftKey: element => element.id, restoreCommentDraft() {} });
  vm.runInContext(fn('finishCommentEdit') + '\n' + fn('installCommentEditProtection'), context);
  context.installCommentEditProtection(container);
  const a = container.querySelector('#a'), b = container.querySelector('#b');
  a.focus(); session.deferRefresh(() => calls.push('remote change'));
  b.focus(); assert.equal(session.getElement(), b); assert.equal(dom.window.document.activeElement, b);
  assert.equal(drafts.get('a').value, 'first draft'); assert.deepEqual(calls, []);
  context.finishCommentEdit(); assert.deepEqual(calls, ['remote change']);
  assert.equal(drafts.get('b').value, 'second draft');
  context.finishCommentEdit(); assert.equal(calls.length, 1); dom.window.close();
});


test('canceling the next reply editor flushes a refresh carried from the previous field', async () => {
  const { createCommentEditSession } = await import('../../renderer/scripts/modules/comment-edit-session.js');
  const dom = new JSDOM('<div id="list"><textarea id="first">draft</textarea><div id="reply"><span class="text">old</span></div></div>');
  const container = dom.window.document.querySelector('#list'); const session = createCommentEditSession(); let refreshed = 0;
  const context = vm.createContext({ commentEditSession: session, commentDrafts: new Map(),
    getCommentDraftKey: element => element.id || element.className, restoreCommentDraft() {},
    commentManager: { getMarker: () => ({ replies: [{ id: 'r', text: 'old' }] }) },
    mentionManager: { attach() {}, detach() {} }, resizeReplyEditorToContent() {} });
  for (const name of ['finishCommentEdit', 'installCommentEditProtection', 'startReplyEdit']) vm.runInContext(fn(name), context);
  context.installCommentEditProtection(container); container.querySelector('#first').focus();
  session.deferRefresh(() => { refreshed++; assert.equal(container.querySelector('.form'), null); });
  context.startReplyEdit(container.querySelector('#reply'), 'm', 'r', { textSelector: '.text', editorType: 'textarea',
    editorClass: 'editor', formClass: 'form', actionsClass: 'actions', saveClass: 'save', cancelClass: 'cancel' }, () => {});
  assert.equal(session.getElement(), container.querySelector('.editor')); assert.equal(refreshed, 0);
  container.querySelector('.cancel').click(); assert.equal(refreshed, 1); assert.equal(session.isEditing(), false);
  dom.window.close();
});
