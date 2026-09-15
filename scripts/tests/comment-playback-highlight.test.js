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
  const dom = new JSDOM(`<div id="list">${Array.from({ length:500 },(_,i) => `<div class="comment-item ${i === 1 ? 'selected' : ''}" data-playback-comment-key="${i}"><textarea>draft</textarea></div>`).join('')}</div>`);
  const list = dom.window.document.querySelector('#list'); const editor = list.children[1].firstChild; editor.focus(); editor.setSelectionRange(1,3); list.scrollTop = 88;
  const query = list.querySelectorAll.bind(list); let queries = 0;
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

function scrollFixture() {
  const dom = new JSDOM('<section class="comment-panel"><div id="list"><div data-playback-comment-key="a"></div><div data-playback-comment-key="b"></div></div><textarea>draft</textarea></section>');
  const list = dom.window.document.querySelector('#list');
  // jsdom has no layout; supply viewport geometry while using real elements/state.
  list.getBoundingClientRect = () => ({ top: 100, bottom: 300, height: 200 });
  Object.defineProperty(list, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(list, 'clientWidth', { value: 300, configurable: true });
  list.children[0].getBoundingClientRect = () => ({ top: 600 - list.scrollTop, bottom: 680 - list.scrollTop, height: 80 });
  list.children[1].getBoundingClientRect = () => ({ top: 900 - list.scrollTop, bottom: 980 - list.scrollTop, height: 80 });
  return { dom, list };
}

test('newly active offscreen comment scrolls into view without repeatedly pulling the list back', async () => {
  const { applyCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.ok(list.scrollTop > 0, 'active comment must enter the viewport');
  assert.ok(list.children[0].getBoundingClientRect().bottom <= 300);
  const position = list.scrollTop;
  applyCommentPlaybackHighlight(list, new Set(['a', 'b']));
  assert.ok(list.scrollTop > position, 'new overlapping comment must be revealed');
  assert.equal(list.children[0].dataset.currentFrame, 'true');
  assert.equal(list.children[1].dataset.currentFrame, 'true');
  list.scrollTop = 0; // user reads another comment in the same active range
  applyCommentPlaybackHighlight(list, new Set(['a', 'b']));
  assert.equal(list.scrollTop, 0);
  applyCommentPlaybackHighlight(list, new Set());
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.ok(list.scrollTop > 0, 'returning to a range follows it again');
  dom.window.close();
});

test('already visible comment does not move the list; backward seeking brings an earlier comment back', async () => {
  const { applyCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  list.scrollTop = 500;
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.equal(list.scrollTop, 500);
  applyCommentPlaybackHighlight(list, new Set(['b']));
  const laterPosition = list.scrollTop;
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.ok(list.scrollTop < laterPosition);
  assert.ok(list.children[0].getBoundingClientRect().top >= 100);
  dom.window.close();
});

test('editing in the panel preserves draft, focus and scroll while the highlight still updates', async () => {
  const { applyCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  const editor = dom.window.document.querySelector('textarea');
  editor.focus(); editor.setSelectionRange(1, 3);
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.equal(list.scrollTop, 0);
  assert.equal(list.children[0].dataset.currentFrame, 'true');
  assert.equal(dom.window.document.activeElement, editor);
  assert.equal(editor.value, 'draft');
  assert.equal(editor.selectionStart, 1);
  editor.blur();
  applyCommentPlaybackHighlight(list, new Set(['b']));
  assert.ok(list.scrollTop > 0);
  dom.window.close();
});

test('auto scroll can be disabled without disabling highlights and reenabled at the same position', async () => {
  const { applyCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  applyCommentPlaybackHighlight(list, new Set(['a']), { autoScroll: false });
  assert.equal(list.scrollTop, 0);
  assert.equal(list.children[0].dataset.currentFrame, 'true');
  applyCommentPlaybackHighlight(list, new Set(['b']), { autoScroll: false });
  assert.equal(list.scrollTop, 0);
  assert.equal(list.children[0].dataset.currentFrame, 'false');
  assert.equal(list.children[1].dataset.currentFrame, 'true');
  const checkbox = dom.window.document.createElement('input');
  checkbox.type = 'checkbox'; list.parentElement.append(checkbox); checkbox.focus();
  applyCommentPlaybackHighlight(list, new Set(['b']), { autoScroll: true });
  assert.ok(list.scrollTop > 0, 'turning on follows the current comment, including with checkbox focused');
  assert.equal(dom.window.document.activeElement, checkbox);
  dom.window.close();
});

test('a hidden panel retries its pending reveal when reopened at the same paused frame', async () => {
  const { applyCommentPlaybackHighlight, invalidateCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  let visible = false, resized;
  Object.defineProperty(list, 'clientHeight', { get: () => visible ? 200 : 0 });
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { resized = this.callback; }
    disconnect() { if (resized === this.callback) resized = null; }
  };
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.equal(list.scrollTop, 0);
  invalidateCommentPlaybackHighlight(list); // previous review decoration can rebuild the index while hidden
  applyCommentPlaybackHighlight(list, new Set(['a']));
  visible = true;
  applyCommentPlaybackHighlight(list, new Set(['a']));
  assert.equal(list.scrollTop, 0, 'playback updates wait for the pending panel resize to settle');
  resized?.(); // no new playback event: paused frame is unchanged
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(list.scrollTop > 0);
  assert.equal(resized, null, 'one-shot visibility observer is released after following');
  dom.window.close();
});

test('turning follow off while hidden cancels any deferred scroll', async () => {
  const { applyCommentPlaybackHighlight } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  let visible = false, resized;
  Object.defineProperty(list, 'clientWidth', { get: () => visible ? 300 : 0 });
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { resized = this.callback; }
    disconnect() { if (resized === this.callback) resized = null; }
  };
  applyCommentPlaybackHighlight(list, new Set(['a']));
  applyCommentPlaybackHighlight(list, new Set(['a']), { autoScroll: false });
  visible = true; resized?.();
  assert.equal(list.scrollTop, 0);
  assert.equal(resized, null);
  dom.window.close();
});

test('auto scroll defaults on for older settings and persists a disabled choice across restarts', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const dom = new JSDOM('', { url: 'https://settings.test' });
  let savedFile = { lightMode: true };
  dom.window.electronAPI = {
    loadSettings: async () => ({ success: true, data: savedFile }),
    saveSettings: async value => { savedFile = JSON.parse(JSON.stringify(value)); return { success: true }; }
  };
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/modules/user-settings.js'), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace(/export default UserSettings;/, '').replace(/export /g, '');
  const context = vm.createContext({ window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, EventTarget: dom.window.EventTarget, CustomEvent: dom.window.CustomEvent,
    createLogger: () => ({ info() {}, warn() {}, error() {} }), setTimeout });
  vm.runInContext(source + '\nthis.TestSettings = UserSettings;', context);
  const initial = new context.TestSettings(); await initial.waitForReady();
  assert.equal(initial.getCommentAutoScroll(), true);
  initial.setCommentAutoScroll(false);
  assert.equal(JSON.parse(dom.window.localStorage.getItem('baeframe_user_settings')).commentAutoScroll, false);
  assert.equal(savedFile.commentAutoScroll, false);
  const reopened = new context.TestSettings(); await reopened.waitForReady();
  assert.equal(reopened.getCommentAutoScroll(), false);
  assert.equal(reopened.settings.lightMode, true, 'unrelated preferences are preserved');
  reopened.setCommentAutoScroll(true);
  assert.equal(savedFile.commentAutoScroll, true);
  dom.window.close();
});

test('the actual checkbox handler applies the preference to current and popup comments without moving the playhead', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { applyCommentPlaybackHighlight, getActiveCommentKeys } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const { dom, list } = scrollFixture();
  const popup = list.cloneNode(true); list.parentElement.append(popup);
  popup.getBoundingClientRect = list.getBoundingClientRect;
  Object.defineProperty(popup, 'clientHeight', { value: 200 });
  Object.defineProperty(popup, 'clientWidth', { value: 300 });
  popup.children[0].getBoundingClientRect = () => ({ top: 600 - popup.scrollTop, bottom: 680 - popup.scrollTop, height: 80 });
  const html = fs.readFileSync(path.join(__dirname, '../../renderer/index.html'), 'utf8');
  const markup = new JSDOM(html);
  const checkbox = markup.window.document.getElementById('toggleCommentAutoScroll');
  list.parentElement.append(dom.window.document.adoptNode(checkbox));
  const popupModule = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/modules/previous-review-panel.js'), 'utf8');
  const popupBody = popupModule.match(/    updatePlaybackFrame\(currentFrame[^]*?\n    \},/)?.[0];
  assert.ok(popupBody);
  const popupContext = vm.createContext({ popupList: popup, playbackRows: [{ key: 'a', startFrame: 24, endFrame: 48 }], applyCommentPlaybackHighlight, getActiveCommentKeys });
  const popupPanel = vm.runInContext('({' + popupBody + '})', popupContext);
  let enabled = false;
  const context = vm.createContext({
    toggleCommentAutoScroll: checkbox, commentPlaybackLastPosition: null,
    userSettings: { getCommentAutoScroll: () => enabled, setCommentAutoScroll: value => { enabled = value; } },
    playlistUIState: { mode: 'single' }, cutlistUIState: { active: false },
    getPlaylistManager: () => ({}), getCurrentContinuousSegment: () => null,
    videoPlayer: { currentFrame: 30, currentTime: 1.25 }, getActiveTimelinePlaybackTime: time => time,
    commentPlaybackRanges: [{ key: 'a', startFrame: 24, endFrame: 48 }], elements: { commentsList: list },
    applyCommentPlaybackHighlight, getActiveCommentKeys, previousReviewPanel: popupPanel
  });
  const app = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
  const update = app.match(/  function updateCommentPlaybackHighlight\([^]*?\n  \}/)?.[0];
  const binding = app.match(/  toggleCommentAutoScroll\?\.addEventListener\('change', \(\) => \{[^]*?\n  \}\);/)?.[0];
  assert.ok(update); assert.ok(binding);
  vm.runInContext(update + '\n' + binding, context);
  checkbox.checked = false; checkbox.dispatchEvent(new dom.window.Event('change'));
  assert.equal(list.scrollTop, 0); assert.equal(popup.scrollTop, 0);
  assert.equal(list.children[0].dataset.currentFrame, 'true');
  assert.equal(popup.children[0].dataset.currentFrame, 'true');
  checkbox.checked = true; checkbox.dispatchEvent(new dom.window.Event('change'));
  assert.ok(list.scrollTop > 0); assert.ok(popup.scrollTop > 0);
  assert.equal(context.videoPlayer.currentFrame, 30);
  markup.window.close();
  dom.window.close();
});


function seekHarness(mode) {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
  const start = source.indexOf('  // 타임라인에서 시간 이동 요청');
  const end = source.indexOf('  // 타임라인 마커 클릭', start);
  const handlers = new Map(); const highlights = []; const requests = [];
  const seek = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  const context = vm.createContext({
    timeline: { playlistDuration: 3, cutlistDuration: 3, addEventListener: (event, fn) => handlers.set(event, fn) },
    playlistUIState: { mode: mode === 'continuous' ? mode : 'normal' }, cutlistUIState: { active: mode === 'cutlist' },
    getCutlistManager: () => ({ isActive: () => true }), getCurrentContinuousSegment: () => ({ itemId: 'old' }),
    getActiveTimelinePlaybackTime: () => 4, state: { currentFile: 'old.mp4' },
    videoPlayer: { currentFrame: 24, currentTime: 1, fps: 24 },
    seekContinuousTimeline: seek, seekCutlistTimeline: seek,
    isSameFilePath: (a, b) => a === b,
    updateCommentPlaybackHighlight: position => highlights.push(position || { time: context.getActiveTimelinePlaybackTime(), localFrame: context.videoPlayer.currentFrame, itemId: 'old' }),
    hideScrubPreview() {}, showScrubPreview() {}, log: { warn() {} }, showToast() {}
  });
  vm.runInContext(source.slice(start, end), context);
  return { handlers, highlights, requests, context };
}
for (const mode of ['continuous', 'cutlist']) {
  test(`${mode}: rejected async release restores actual frame and ignores stale failure during a new drag`, async () => {
    const h = seekHarness(mode);
    const destination = { detail: { time: 9, localFrame: 60, itemId: 'next' } };
    h.handlers.get('scrubbing')(destination);
    const pending = h.handlers.get('seek')(destination);
    h.handlers.get('scrubbingEnd')(destination);
    h.requests[0].resolve(false); await pending;
    assert.equal(h.highlights.at(-1).localFrame, 24);
    assert.equal(h.highlights.at(-1).time, 4);
    const oldPending = h.handlers.get('seek')(destination);
    const newer = { detail: { time: 12, localFrame: 72, itemId: 'newest' } };
    h.handlers.get('scrubbing')(newer);
    const count = h.highlights.length;
    h.requests[1].resolve(false); await oldPending;
    assert.equal(h.highlights.length, count);
    assert.equal(h.highlights.at(-1).localFrame, 72);
  });
}

for (const mode of ['continuous', 'cutlist']) {
  test(`${mode}: success uses confirmed frame and thrown load restores the advancing source frame`, async () => {
    const h = seekHarness(mode);
    const destination = { detail: { time: 9, localFrame: 60, itemId: 'next' } };
    const pending = h.handlers.get('seek')(destination);
    h.handlers.get('scrubbingEnd')(destination);
    h.context.videoPlayer.currentFrame = 60;
    h.context.getActiveTimelinePlaybackTime = () => 9;
    h.requests[0].resolve(true); await pending;
    assert.equal(h.highlights.at(-1).localFrame, 60);
    assert.equal(h.highlights.at(-1).time, 9);
    const failing = h.handlers.get('seek')(destination);
    h.context.videoPlayer.currentFrame = 66;
    h.requests[1].reject(new Error('load failed')); await failing;
    assert.equal(h.highlights.at(-1).localFrame, 66);
    assert.equal(h.highlights.at(-1).time, 9.25);
  });
}
