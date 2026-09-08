const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const moduleUrl = name => pathToFileURL(path.join(__dirname, '../../renderer/scripts/modules/', name)).href;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const sourceRoot = () => ({ fps: 30, comments: { layers: [{ markers: [
  { id: 'a', author: '전혜림', text: '눈 깜빡임 확인', startFrame: 90, resolved: false,
    replies: [{ id: 'r1', author: '배한솔', text: '수정했습니다' }] },
  { id: 'b', author: '김리뷰', text: '완료된 원본', startFrame: 150, resolved: true },
  { id: 'c', author: '김리뷰', text: '길이 밖', startFrame: 900, resolved: false },
  { id: 'd', deleted: true, text: '삭제됨' }
] }] } });

test('compact options switch between separated and chronological reviews with plain version badges', async t => {
  const x = await setup(t); await x.selectVersion(0);
  assert.equal(x.document.querySelectorAll('[data-pr-mode]').length, 3);
  assert.equal(x.document.querySelector('[data-pr-options]').hidden, false);
  x.click('[data-pr-mode="merged"]');
  assert.equal(x.document.querySelector('[data-pr-options]').hidden, true);
  assert.equal(x.document.querySelector('[data-pr-queue]'), null);
  assert.equal(x.document.querySelector('.pr-origin').textContent, 'v3');
  const rows = [...x.document.querySelector('#list').children];
  assert.equal(rows.findIndex(row => row.classList.contains('comment-item')), 1);
});

test('carry keeps original resolution, replaces the reference once, and offers a two-state toggle', async t => {
  const x = await setup(t); await x.selectVersion(0);
  x.click('[data-pr-action="carry-all"]');
  assert.equal(x.manager.getItems().length, 3);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 3);
  assert.equal(x.document.querySelector('[data-pr-status]'), null);
  assert.doesNotMatch(x.document.body.textContent, /확인 전|반영 확인|추가 수정|이번 버전 확인/);
  const row = [...x.document.querySelectorAll('[data-pr-item]')].find(row => row.textContent.includes('완료된 원본'));
  assert.equal(row.dataset.resolved, 'true');
  row.querySelector('[data-pr-resolve]').click();
  assert.equal([...x.document.querySelectorAll('[data-pr-item]')].find(row => row.textContent.includes('완료된 원본')).dataset.resolved, 'false');
  assert.equal(x.root.comments.layers[0].markers[1].resolved, true);
  assert.deepEqual(x.seeks, []);
});

test('removing a selected version prunes its references but preserves carried snapshots', async t => {
  const timeline = [];
  const x = await setup(t, { withToggle: true, autoOpen: false, onTimelineChange: entries => timeline.push(entries) });
  await tick(); x.toggle.click();
  x.click('[data-pr-carry]');
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 2);
  x.versions.splice(0, 1);
  await x.panel.refreshAvailability({ force: true });
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 1);
  assert.equal(timeline.at(-1).length, 1);
  assert.equal(x.document.querySelectorAll('[data-pr-version]:checked').length, 0);
  x.click('[data-pr-action="carry-all"]');
  assert.equal(x.manager.getItems().length, 1);
});

test('a pending read cannot restore a version removed from the version list', async t => {
  let deferred = false, release;
  const x = await setup(t, { withToggle: true, autoOpen: false,
    versions: [{ path:'C:/shots/shot_v3.mp4', displayLabel:'v3' }],
    loadReview: () => deferred ? new Promise(resolve => { release = resolve; }) : Promise.resolve(sourceRoot()) });
  await tick(); x.toggle.click();
  deferred = true; x.click('[data-pr-action="versions"]'); x.click('[data-pr-action="refresh"]');
  x.versions.length = 0;
  await x.panel.refreshAvailability({ force: true });
  release(sourceRoot()); await tick();
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
  assert.equal(x.toggle.hidden, true);
});

test('reference and carried review body clicks seek by source FPS; controls do not seek', async t => {
  const x = await setup(t); await x.selectVersion(0);
  x.click('[data-pr-source] .pr-text');
  assert.deepEqual(x.seeks, [72]);
  x.click('[data-pr-source] summary'); assert.deepEqual(x.seeks, [72]);
  x.click('[data-pr-carry]'); x.click('[data-pr-item] .pr-text');
  assert.deepEqual(x.seeks, [72, 72]);
  const row = x.document.querySelector('[data-pr-item]');
  row.dispatchEvent(new x.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(x.seeks, [72, 72, 72]);
  [...x.document.querySelectorAll('[data-pr-source]')].find(row => row.textContent.includes('길이 밖')).querySelector('.pr-text').click();
  assert.equal(x.seeks.length, 3);
});

async function setup(t, options = {}) {
  const { createPreviousReviewPanel } = await import(moduleUrl('previous-review-panel.js'));
  const { ReviewCarryoverManager } = await import(moduleUrl('review-carryover-manager.js'));
  const dom = new JSDOM('<body><aside><div id="mount"></div><div id="list"><div class="comment-item" data-start-frame="96"><div class="comment-header">현재 리뷰</div></div></div></aside></body>', { url: 'http://localhost/renderer/index.html' });
  const document = dom.window.document;
  const children = [];
  dom.window.open = (url, name) => {
    assert.equal(name, 'baeframe-previous-reviews');
    const childDom = new JSDOM('<body><div id="commentPopoutMount"></div></body>', { url });
    const child = childDom.window;
    Object.defineProperty(child.document, 'readyState', { value: 'complete' });
    child.closed = false; child.focus = () => {};
    const close = child.close.bind(child);
    child.close = () => { child.dispatchEvent(new child.Event('beforeunload')); child.closed = true; };
    children.push({ child, close });
    return child;
  };
  const manager = new ReviewCarryoverManager();
  const root = sourceRoot();
  const context = { path: 'C:/shots/shot_v4.mp4', label: 'v4', fps: 24, duration: 12, enabled: true };
  const versions = options.versions || [{ path: 'C:/shots/shot_v3.mp4', displayLabel: 'v3' }, { path: 'C:/shots/shot_v2.mp4', displayLabel: 'v2' }];
  const toggle = options.withToggle ? document.createElement('button') : null;
  if (toggle) { toggle.hidden = true; toggle.textContent = '이전 리뷰 확인하기'; document.querySelector('aside').prepend(toggle); }
  const seeks = [], notices = [];
  const panel = createPreviousReviewPanel({
    mount: document.getElementById('mount'), list: document.getElementById('list'), manager, toggleButton: toggle,
    getContext: () => context, getVersions: () => versions,
    matchesReview: options.matchesReview, onSummaryChange: options.onSummaryChange,
    onTimelineChange: options.onTimelineChange,
    loadReview: options.loadReview || (async () => structuredClone(root)),
    seek: frame => seeks.push(frame), notify: message => notices.push(message),
    windowRef: dom.window
  });
  const click = selector => { const button = document.querySelector(selector); assert.ok(button, selector); button.click(); };
  const selectVersion = async index => { click('[data-pr-action="versions"]'); const input = document.querySelectorAll('[data-pr-version]')[index]; assert.ok(input); if (!input.checked) input.click(); await tick(); };
  if (options.autoOpen !== false) panel.setOpen(true);
  t.after(() => { panel.dispose(); for (const { close } of children) close(); dom.window.close(); });
  return { panel, manager, document, dom, root, context, versions, click, selectVersion, seeks, notices, toggle, children };
}

test('previous review popup keeps live state and seeking; closing restores the separated list', async t => {
  const x = await setup(t); await x.selectVersion(0);
  x.click('[data-pr-mode="popup"]'); await tick();
  const child = x.children[0]?.child;
  assert.ok(child, '이전 리뷰 창이 열려야 한다');
  assert.equal(child.document.querySelectorAll('[data-pr-source]').length, 3);
  assert.equal(x.document.querySelector('#list [data-pr-source]'), null);
  assert.equal(x.document.body.classList.contains('comments-detached'), false, 'historical popout must not detach the current comment panel');
  child.document.querySelector('[data-pr-source] .pr-text').click();
  assert.deepEqual(x.seeks, [72]);
  child.document.querySelector('[data-pr-carry]').click();
  assert.equal(child.document.querySelectorAll('[data-pr-item]').length, 1);
  child.document.querySelector('[data-pr-resolve]').click();
  assert.equal(x.manager.getItems()[0].status, 'verified');
  child.close();
  assert.equal(x.document.querySelectorAll('#list [data-pr-source], #list [data-pr-item]').length, 3);
  assert.equal(x.document.querySelector('[data-pr-mode="split"]').getAttribute('aria-pressed'), 'true');
  assert.equal(x.manager.getItems().length, 1);
});

test('toggle stays hidden for current-only, empty, deleted or unreadable historical reviews', async t => {
  const reads = [];
  const x = await setup(t, { withToggle: true, autoOpen: false, versions: [
    { path: 'c:\\SHOTS\\SHOT_v4.mp4' }, { path: 'C:/shots/shot_v3.mp4' },
    { path: 'C:/shots/shot_v2.mp4' }, { path: 'C:/shots/shot_v1.mp4' }
  ], loadReview: async file => {
    reads.push(file);
    if (file.includes('_v3')) return { comments: { layers: [{ markers: [{ id: 'gone', deleted: true }] }] } };
    if (file.includes('_v2')) return { comments: { layers: [] } };
    throw new Error('missing');
  } });
  await tick();
  assert.equal(reads.length, 3);
  assert.equal(x.toggle.hidden, true);
  assert.equal(x.toggle.getAttribute('aria-expanded'), 'false');
  x.toggle.click();
  assert.equal(x.panel.isOpen(), false);
});

test('stored resolved reviews reveal the toggle; closing hides the entire review area and preserves work', async t => {
  const x = await setup(t, { withToggle: true, autoOpen: false, loadReview: async () => ({ comments: [
    { id: 'done', text: '반영 확인할 이전 의견', resolved: true, startFrame: 24 }
  ] }) });
  await tick();
  assert.equal(x.toggle.hidden, false);
  assert.equal(x.toggle.getAttribute('aria-pressed'), 'false');
  x.toggle.click();
  assert.equal(x.panel.isOpen(), true);
  assert.equal(x.toggle.classList.contains('active'), true);
  assert.equal(x.toggle.getAttribute('aria-expanded'), 'true');
  await x.selectVersion(0);
  x.click('[data-pr-carry]');
  x.toggle.click();
  assert.equal(x.document.querySelector('.previous-review-controls').hidden, true);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
  assert.equal(x.toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(x.manager.getItems().length, 1);
  x.toggle.click();
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 1);
  assert.equal(x.document.querySelector('[data-pr-version]').checked, true);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 1);
  x.toggle.click();
  assert.equal(x.toggle.classList.contains('active'), false);
});

test('a late availability read cannot reveal the toggle on a different video', async t => {
  const pending = [];
  const x = await setup(t, { withToggle: true, autoOpen: false, loadReview: () => new Promise(resolve => pending.push(resolve)) });
  assert.equal(pending.length, 2);
  x.context.path = 'C:/shots/other_v1.mp4'; x.versions.length = 0;
  x.panel.refreshContext();
  for (const resolve of pending) resolve(sourceRoot());
  await tick();
  assert.equal(x.toggle.hidden, true);
  assert.equal(x.panel.isOpen(), false);
});

test('availability refresh finds newly saved reviews without rereading on every comment render', async t => {
  let data = null, reads = 0;
  const x = await setup(t, { withToggle: true, autoOpen: false, loadReview: async () => { reads++; return data; } });
  await tick();
  assert.equal(x.toggle.hidden, true);
  x.panel.refreshContext(); x.panel.refreshContext(); await tick();
  assert.equal(reads, 2);
  data = sourceRoot();
  x.dom.window.dispatchEvent(new x.dom.window.Event('focus')); await tick();
  assert.equal(x.toggle.hidden, false);
  x.context.enabled = false; x.panel.refreshContext();
  assert.equal(x.toggle.hidden, true);
  x.context.enabled = true; x.panel.refreshContext();
  assert.equal(x.toggle.hidden, false);
});

test('carried snapshots remain accessible with missing original files and survive toggling off', async t => {
  const x = await setup(t, { withToggle: true, autoOpen: false, loadReview: async () => null });
  await tick();
  const { createPreviousReviewSources } = await import(pathToFileURL(path.join(__dirname, '../../shared/review-carryover.js')).href);
  x.manager.carry(createPreviousReviewSources(sourceRoot(), x.versions[0])[0]);
  assert.equal(x.toggle.hidden, false);
  assert.equal(x.document.querySelector('.previous-review-controls').hidden, true);
  x.toggle.click();
  assert.equal(x.document.querySelector('.previous-review-controls').hidden, false);
  x.toggle.click();
  assert.equal(x.document.querySelector('.previous-review-controls').hidden, true);
  assert.equal(x.manager.getItems().length, 1);
});

test('versions are references until explicitly carried; snapshots preserve original status', async t => {
  const x = await setup(t); const original = JSON.stringify(x.root);
  await x.selectVersion(0);
  assert.equal(x.manager.getItems().length, 0);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 3);
  x.click('[data-pr-action="carry-all"]');
  assert.equal(x.manager.getItems().length, 3);
  assert.equal(x.manager.getItems().filter(item => item.status === 'verified').length, 1);
  assert.equal(JSON.stringify(x.root), original);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
  assert.equal(x.document.querySelector('[data-pr-item] .pr-origin').textContent, 'v3');
});

test('resolution filters and dedup use the carried state while preserving originals', async t => {
  const summaries = [];
  const x = await setup(t, { onSummaryChange: summary => summaries.push(summary) });
  await x.selectVersion(0); x.click('[data-pr-action="carry-all"]');
  x.click('[data-pr-resolve]'); x.click('[data-pr-action="carry-all"]');
  assert.equal(x.manager.getItems().length, 3);
  x.context.filter = 'resolved'; x.panel.refreshContext();
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 2);
  assert.deepEqual(summaries.at(-1), { total: 3, resolved: 2, visible: 2 });
  x.context.filter = 'unresolved'; x.panel.refreshContext();
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 1);
  x.click('[data-pr-resolve]');
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 0);
  assert.deepEqual(summaries.at(-1), { total: 3, resolved: 3, visible: 0 });
  assert.equal(x.root.comments.layers[0].markers[0].resolved, false);
  x.context.filter = 'all'; x.panel.refreshContext(); x.click('[data-pr-remove]');
  assert.equal(x.manager.getItems().length, 2);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 1);
});

test('multiple versions merge chronologically and clearing references preserves carried reviews', async t => {
  const x = await setup(t); await x.selectVersion(0); x.click('[data-pr-action="carry-all"]');
  await x.selectVersion(1);
  x.click('[data-pr-mode="merged"]');
  const order = [...x.document.querySelector('#list').children];
  assert.equal(order.findIndex(el => el.classList.contains('comment-item')), 2);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 3);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 3);
  x.click('[data-pr-action="carry-all"]'); x.click('[data-pr-action="clear-versions"]');
  assert.equal(x.manager.getItems().length, 6);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 6);
  x.panel.setOpen(false); assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 0);
  x.panel.setOpen(true); assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 6);
});

test('timeline receives filtered historical reviews and clears immediately when switched off or changing videos', async t => {
  const states = [];
  const x = await setup(t, { onTimelineChange: entries => states.push(entries) });
  await x.selectVersion(0);
  assert.equal(states.at(-1)?.length, 3, 'previous reviews must reach the timeline');
  assert.equal(states.at(-1)[1].resolved, true);
  x.click('[data-pr-action="carry-all"]');
  x.click('[data-pr-resolve]');
  x.context.filter = 'unresolved'; x.panel.refreshContext();
  assert.deepEqual(states.at(-1).map(entry => entry.source.text), ['길이 밖']);
  x.panel.setOpen(false); assert.deepEqual(states.at(-1), []);
  x.panel.setOpen(true); assert.equal(states.at(-1).length, 1);
  x.context.path = 'C:/shots/other_v1.mp4'; x.panel.refreshContext();
  assert.deepEqual(states.at(-1), []);
});

test('first toggle selects the most recent saved review and timeline visibility is independent', async t => {
  const states = [];
  const x = await setup(t, { withToggle: true, autoOpen: false, onTimelineChange: entries => states.push(entries) });
  await tick(); x.toggle.click(); await tick();
  assert.equal(x.document.querySelector('[data-pr-version]').checked, true);
  assert.equal(states.at(-1)?.length, 3);
  x.click('[data-pr-timeline]');
  assert.deepEqual(states.at(-1), []);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 3);
  x.click('[data-pr-timeline]'); assert.equal(states.at(-1).length, 3);
  x.panel.seekSource(states.at(-1)[0].source.key);
  assert.deepEqual(x.seeks, [72]);
  assert.equal(x.document.querySelector('.pr-review.pr-selected')?.textContent.includes('눈 깜빡임'), true);
});

test('timestamp uses source FPS and refuses duration overflow', async t => {
  const x = await setup(t);
  await x.selectVersion(0);
  const time = x.document.querySelector('[data-pr-source] [data-pr-seek]');
  assert.match(time.getAttribute('aria-label'), /현재 v4/);
  time.click(); assert.deepEqual(x.seeks, [72]);
  const outside = [...x.document.querySelectorAll('[data-pr-source]')].find(el => el.textContent.includes('길이 밖'));
  assert.equal(outside.querySelector('[data-pr-seek]').disabled, true);
  outside.querySelector('[data-pr-seek]').click(); assert.equal(x.seeks.length, 1);
});

test('late source load cannot appear after switching target or deselecting', async t => {
  const resolves = [];
  const x = await setup(t, { loadReview: () => new Promise(resolve => resolves.push(resolve)) });
  x.click('[data-pr-action="versions"]'); x.document.querySelector('[data-pr-version]').click();
  x.click('[data-pr-action="clear-versions"]');
  resolves.shift()(sourceRoot()); await tick();
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
  x.click('[data-pr-action="versions"]'); x.document.querySelector('[data-pr-version]').click();
  x.context.path = 'C:/shots/other_v1.mp4'; x.panel.refreshContext();
  resolves.shift()(sourceRoot()); await tick();
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 0);
});

test('failed reads expose retry without mutating the target queue', async t => {
  let fail = true;
  const x = await setup(t, { loadReview: async () => { if (fail) throw new Error('missing'); return sourceRoot(); } });
  await x.selectVersion(0);
  assert.match(x.document.body.textContent, /읽을 수 없습니다/);
  fail = false; x.click('[data-pr-action="refresh"]'); await tick();
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 3);
  assert.equal(x.manager.getItems().length, 0);
});

test('untrusted text stays text; replies remain readable and no unsafe image is inserted', async t => {
  const x = await setup(t);
  x.root.comments.layers[0].markers[0].text = '<img src=x onerror=alert(1)>';
  x.root.comments.layers[0].markers[0].image = 'https://tracker.invalid/private';
  await x.selectVersion(0);
  const row = x.document.querySelector('[data-pr-source]');
  assert.match(row.textContent, /<img src=x/);
  assert.equal(row.querySelector('img'), null);
  assert.match(row.querySelector('details').textContent, /수정했습니다/);
});

test('whole-playlist mode hides carried rows and returns without losing selection', async t => {
  const x = await setup(t); await x.selectVersion(0); x.click('[data-pr-action="carry-all"]');
  x.context.enabled = false; x.panel.refreshContext();
  assert.equal(x.document.querySelector('[data-pr-toolbar]').hidden, true);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 0);
  x.context.enabled = true; x.panel.refreshContext();
  assert.equal(x.manager.getItems().length, 3);
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 3);
});

test('missing frame stays unavailable instead of turning into zero seconds', async t => {
  const x = await setup(t);
  delete x.root.comments.layers[0].markers[0].startFrame;
  await x.selectVersion(0);
  const row = [...x.document.querySelectorAll('[data-pr-source]')].find(el => el.textContent.includes('눈 깜빡임'));
  assert.equal(row.querySelector('[data-pr-seek]').disabled, true);
  assert.match(row.textContent, /시간 정보 없음/);
});

test('unsupported source comments are an error, not a misleading empty review', async t => {
  const x = await setup(t, { loadReview: async () => ({ comments: { future: {} } }) });
  await x.selectVersion(0);
  assert.match(x.document.body.textContent, /읽을 수 없습니다/);
  assert.doesNotMatch(x.document.body.textContent, /저장된 리뷰가 없습니다/);
});

test('video-switch fence blocks late resolution and seeks and restores carried rows when cancelled', async t => {
  const x = await setup(t); await x.selectVersion(0); x.click('[data-pr-action="carry-all"]');
  const button = x.document.querySelector('[data-pr-resolve]');
  const row = x.document.querySelector('[data-pr-item]');
  const before = x.manager.toJSON();
  x.context.enabled = false; x.panel.refreshContext(); button.click(); row.click();
  assert.deepEqual(x.manager.toJSON(), before); assert.deepEqual(x.seeks, []);
  x.context.enabled = true; x.panel.refreshContext();
  assert.equal(x.document.querySelectorAll('[data-pr-item]').length, 3);
  x.click('[data-pr-resolve]');
  assert.equal(x.manager.getItems().filter(item => item.status === 'verified').length, 2);
});

test('UI displays every raster attachment format accepted by the source model', async t => {
  const x = await setup(t);
  x.root.comments.layers[0].markers[0].images = ['data:image/jpg;base64,AA==', 'data:image/avif;base64,AA=='];
  await x.selectVersion(0);
  const row = x.document.querySelector('[data-pr-source]');
  assert.equal(row.querySelectorAll('img').length,2);
  row.querySelector('[data-pr-carry]').click();
  assert.equal(x.document.querySelector('[data-pr-item]').querySelectorAll('img').length,2);
});

test('queue order stays chronological after a save/load canonicalizes item IDs', async t => {
  const x = await setup(t);
  x.root.comments.layers[0].markers[0].id = 'z-earliest';
  await x.selectVersion(0); x.click('[data-pr-action="carry-all"]');
  x.manager.fromJSON(x.manager.toJSON());
  assert.match(x.document.querySelector('[data-pr-item]').textContent, /눈 깜빡임/);
});

test('search matching and empty-state visibility include historical rows without changing current DOM', async t => {
  const x = await setup(t, { matchesReview: source => source.text.includes('눈') });
  const current = x.document.querySelector('.comment-item');
  const empty = x.document.createElement('div'); empty.className = 'comment-empty';
  x.document.querySelector('#list').append(empty);
  await x.selectVersion(0);
  assert.equal(x.document.querySelectorAll('[data-pr-source]').length, 1);
  assert.equal(empty.hidden, true);
  x.panel.setOpen(false);
  assert.equal(empty.hidden, false);
  assert.equal(x.document.querySelector('.comment-item'), current);
  assert.equal(x.document.querySelector('.pr-current-badge'), null);
});
