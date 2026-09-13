const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
test('inclusive overlapping ranges, absent ends and invalid values preserve real frame zero', async () => {
  const { getActiveCommentKeys } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const ranges = [{ key: 'a', startFrame: 24, endFrame: 48 }, { key: 'b', startFrame: 32, endFrame: 64 },
    { key: 'zero', startFrame: 0 }, { key: 'missing', startFrame: null }, { key: 'invalid', timingValid: false }];
  assert.deepEqual([...getActiveCommentKeys(ranges, { mode: 'single', currentFrame: 32 })], ['a', 'b']);
  assert.deepEqual([...getActiveCommentKeys(ranges, { mode: 'single', currentFrame: 0 })], ['zero']);
  assert.deepEqual([...getActiveCommentKeys(ranges, { mode: 'single', currentFrame: 48 })], ['a', 'b']);
  assert.deepEqual([...getActiveCommentKeys(ranges, { mode: 'single', currentFrame: 49 })], ['b']);
});
test('playlist item identity disambiguates an inclusive boundary; cutlist uses global intervals', async () => {
  const { getActiveCommentKeys } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const ranges = [{ key: 'a:m', itemId: 'a', globalStartTime: 2, globalEndTime: 3 }, { key: 'b:m', itemId: 'b', globalStartTime: 3, globalEndTime: 4 }];
  assert.deepEqual([...getActiveCommentKeys(ranges, { mode: 'continuous', currentItemId: 'b', globalTime: 3 })], ['b:m']);
  assert.deepEqual([...getActiveCommentKeys(ranges, { mode: 'cutlist', globalTime: 3.5 })], ['b:m']);
});
test('500 rows keep selection, focus, drafts and scroll with no HTML writes or repeated DOM queries', async () => {
  const { applyCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const dom = new JSDOM(`<div id="list">${Array.from({length:500},(_,i)=>`<div class="comment-item ${i===1?'selected':''}" data-playback-comment-key="${i}"><textarea>draft</textarea></div>`).join('')}</div>`);
  const list = dom.window.document.querySelector('#list'); const editor = list.children[1].firstChild; editor.focus(); editor.setSelectionRange(1,3); list.scrollTop=88;
  const query = list.querySelectorAll.bind(list); let queries=0;
  list.querySelectorAll = (...args) => { queries++; return query(...args); };
  Object.defineProperty(list, 'innerHTML', { set() { throw new Error('DOM replaced'); } });
  applyCommentPlaybackHighlight(list, new Set(['1','2']));
  applyCommentPlaybackHighlight(list, new Set(['2','3']));
  applyCommentPlaybackHighlight(list, new Set(['2','3']));
  assert.equal(queries,1); assert.equal(list.children[1].classList.contains('selected'),true);
  assert.equal(list.children[1].classList.contains('is-current-frame'),false);
  assert.equal(list.children[2].dataset.currentFrame,'true'); assert.equal(list.scrollTop,88);
  assert.equal(dom.window.document.activeElement,editor); assert.equal(editor.selectionStart,1); assert.equal(editor.value,'draft'); dom.window.close();
});
