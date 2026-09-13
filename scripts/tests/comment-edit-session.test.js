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
function fn(name) { const start = appSource.indexOf(`function ${name}(`); return appSource.slice(start, appSource.indexOf('\n  }', start)+4); }
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
