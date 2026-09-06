const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const modulePath = path.join(__dirname, '../../renderer/scripts/modules/comment-panel-popout.js');
const mainUrl = pathToFileURL(path.join(__dirname, '../../renderer/index.html')).href;
const popupUrl = pathToFileURL(path.join(__dirname, '../../renderer/comment-panel.html')).href;
const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t, options = {}) {
  assert.ok(fs.existsSync(modulePath), '댓글 패널 이동 컨트롤러가 필요합니다.');
  const { createCommentPanelPopout } = await import(pathToFileURL(modulePath).href);
  const main = new JSDOM('<html class="light-mode" style="--accent-primary: #4a9eff"><body><main><i id="before"></i><aside id="panel"><button id="toggle"></button><textarea id="draft"></textarea><img id="image" src="data:image/png;base64,AA=="><input id="search"><select id="filter"><option>a</option><option>b</option></select><div id="list"><button id="counter">0</button></div></aside><i id="after"></i></main><button id="focus"></button></body></html>', { url: mainUrl, pretendToBeVisual: true });
  const win = main.window;
  const document = win.document;
  const panel = document.getElementById('panel');
  const toggleButton = document.getElementById('toggle');
  const focusButton = document.getElementById('focus');
  const created = [];
  const changes = [];
  const errors = [];
  let opens = 0;
  let mainFocuses = 0;
  let readyCount = 0;
  let cleanupCount = 0;
  win.focus = () => { mainFocuses++; };
  const makeChild = ({ ready = true, mount = true, blank = false } = {}) => {
    const dom = new JSDOM(`<html><body class="comment-popout-body">${mount ? '<div id="commentPopoutMount"></div>' : ''}</body></html>`, { url: blank ? 'about:blank' : popupUrl, pretendToBeVisual: true });
    const child = dom.window;
    let closed = false;
    let focuses = 0;
    let closes = 0;
    Object.defineProperty(child, 'closed', { get: () => closed });
    Object.defineProperty(child.document, 'readyState', { value: ready ? 'complete' : 'loading', configurable: true });
    child.focus = () => { focuses++; };
    const reallyClose = child.close.bind(child);
    child.close = () => {
      closes++;
      child.dispatchEvent(new child.Event('beforeunload'));
      closed = true;
    };
    const instance = {
      window: child, dom, reallyClose,
      get focuses() { return focuses; }, get closes() { return closes; },
      forceClose() { closed = true; },
      loaded() {
        dom.reconfigure({ url: popupUrl });
        if (!child.document.getElementById('commentPopoutMount')) child.document.body.innerHTML = '<div id="commentPopoutMount"></div>';
        Object.defineProperty(child.document, 'readyState', { value: 'complete', configurable: true });
        child.dispatchEvent(new child.Event('load'));
      }
    };
    created.push(instance);
    return instance;
  };
  let next = options.child ? makeChild(options.child) : null;
  win.open = (url, name) => {
    opens++;
    assert.equal(url, popupUrl);
    assert.equal(name, 'baeframe-comments');
    if (options.throwOpen) throw new Error('open failed');
    if (options.blocked) return null;
    const child = next || makeChild();
    next = null;
    return child.window;
  };
  const controller = createCommentPanelPopout({
    panel, toggleButton, focusButton, windowRef: win,
    loadTimeoutMs: options.loadTimeoutMs || 1000,
    onChange: value => changes.push(value),
    onError: error => errors.push(error),
    onReady: child => {
      readyCount++;
      assert.equal(panel.ownerDocument, child.document);
      if (options.throwReady) throw new Error('ready failed');
      return () => { cleanupCount++; };
    }
  });
  t.after(() => {
    controller.dispose();
    for (const child of created) child.reallyClose();
    main.window.close();
  });
  return { controller, win, document, panel, toggleButton, focusButton, changes, errors, created,
    get opens() { return opens; }, get readyCount() { return readyCount; },
    get cleanupCount() { return cleanupCount; }, get mainFocuses() { return mainFocuses; } };
}

test('같은 댓글 노드와 초안, 첨부, 검색, 필터, 스크롤, 리스너를 분리/복귀에 보존한다', async t => {
  const h = await setup(t);
  const draft = h.panel.querySelector('#draft');
  draft.value = '작성 중인 한글 댓글';
  draft.setSelectionRange(2, 5);
  h.panel.querySelector('#search').value = '윤성원';
  h.panel.querySelector('#filter').value = 'b';
  const list = h.panel.querySelector('#list');
  list.scrollTop = 173;
  list.scrollLeft = 9;
  const image = h.panel.querySelector('#image');
  let clicks = 0;
  h.panel.querySelector('#counter').addEventListener('click', () => clicks++);
  assert.equal(await h.controller.detach(), true);
  const child = h.created[0].window;
  assert.equal(child.document.getElementById('panel'), h.panel);
  assert.equal(h.document.getElementById('panel'), null);
  child.document.getElementById('counter').click();
  assert.equal(clicks, 1);
  assert.equal(draft.value, '작성 중인 한글 댓글');
  assert.equal(draft.selectionStart, 2);
  assert.equal(draft.selectionEnd, 5);
  assert.equal(child.document.getElementById('image'), image);
  assert.equal(child.document.getElementById('search').value, '윤성원');
  assert.equal(child.document.getElementById('filter').value, 'b');
  assert.equal(list.scrollTop, 173);
  assert.equal(list.scrollLeft, 9);
  assert.equal(h.controller.dock(), true);
  assert.equal(h.document.getElementById('panel'), h.panel);
  assert.equal(h.panel.previousElementSibling.id, 'before');
  assert.equal(h.panel.nextElementSibling.id, 'after');
  h.panel.querySelector('#counter').click();
  assert.equal(clicks, 2);
  assert.equal(draft.value, '작성 중인 한글 댓글');
  assert.equal(list.scrollTop, 173);
  assert.deepEqual(h.changes, [true, false]);
  assert.equal(h.readyCount, 1);
  assert.equal(h.cleanupCount, 1);
});

test('분리 상태와 실제 버튼 표기, 메인 레이아웃, 창 제목이 일치한다', async t => {
  const h = await setup(t);
  assert.equal(h.focusButton.hidden, true);
  assert.equal(h.toggleButton.getAttribute('aria-pressed'), 'false');
  await h.controller.detach();
  assert.equal(h.controller.isDetached(), true);
  assert.equal(h.focusButton.hidden, false);
  assert.equal(h.document.body.classList.contains('comments-detached'), true);
  assert.equal(h.toggleButton.title, '댓글 다시 붙이기');
  assert.equal(h.toggleButton.getAttribute('aria-label'), '댓글 다시 붙이기');
  assert.equal(h.toggleButton.getAttribute('aria-pressed'), 'true');
  assert.equal(h.created[0].window.document.title, 'BAEFRAME 댓글');
  h.controller.dock();
  assert.equal(h.controller.isDetached(), false);
  assert.equal(h.focusButton.hidden, true);
  assert.equal(h.document.body.classList.contains('comments-detached'), false);
  assert.equal(h.toggleButton.title, '댓글 창 분리');
  assert.equal(h.toggleButton.getAttribute('aria-pressed'), 'false');
});

test('중복 분리와 포커스 버튼은 기존 창만 다시 활성화한다', async t => {
  const h = await setup(t, { child: { ready: false } });
  const first = h.controller.detach();
  const second = h.controller.detach();
  assert.equal(h.opens, 1);
  assert.equal(h.toggleButton.disabled, true);
  assert.equal(h.panel.ownerDocument, h.document);
  h.created[0].loaded();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(await h.controller.detach(), true);
  h.focusButton.click();
  assert.equal(h.opens, 1);
  assert.ok(h.created[0].focuses >= 3);
  assert.equal(h.toggleButton.disabled, false);
});

test('팝업 창 닫기는 즉시 복귀하고 재귀 close를 만들지 않는다', async t => {
  const h = await setup(t);
  await h.controller.detach();
  h.created[0].window.close();
  assert.equal(h.controller.isDetached(), false);
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.created[0].closes, 1);
  assert.equal(h.cleanupCount, 1);
  assert.deepEqual(h.changes, [true, false]);
});

test('beforeunload 없이 강제 닫힌 팝업도 원래 위치로 복귀한다', async t => {
  const h = await setup(t);
  await h.controller.detach();
  h.created[0].forceClose();
  await wait(180);
  assert.equal(h.controller.isDetached(), false);
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.cleanupCount, 1);
});

for (const scenario of ['blocked', 'throwOpen']) {
  test(`창 열기 실패(${scenario})는 원래 댓글과 버튼을 보존한다`, async t => {
    const h = await setup(t, { [scenario]: true });
    assert.equal(await h.controller.detach(), false);
    assert.equal(h.panel.ownerDocument, h.document);
    assert.equal(h.controller.isDetached(), false);
    assert.equal(h.toggleButton.disabled, false);
    assert.equal(h.focusButton.hidden, true);
    assert.equal(h.errors.length, 1);
    assert.deepEqual(h.changes, []);
  });
}

test('about:blank의 readyState 완료만으로 패널을 옮기지 않는다', async t => {
  const h = await setup(t, { child: { blank: true, ready: true } });
  const pending = h.controller.detach();
  await wait(10);
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.controller.isDetached(), false);
  h.created[0].loaded();
  assert.equal(await pending, true);
});

test('댓글 mount가 없는 로드와 타임아웃은 빈 창을 닫고 상태를 복구한다', async t => {
  const h = await setup(t, { child: { mount: false }, loadTimeoutMs: 25 });
  assert.equal(await h.controller.detach(), false);
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.toggleButton.disabled, false);
  assert.equal(h.created[0].window.closed, true);
  assert.equal(h.errors.length, 1);
  assert.deepEqual(h.changes, []);
});

test('로딩 중 창 닫기와 늦게 도착한 load는 패널을 떼지 않는다', async t => {
  const h = await setup(t, { child: { ready: false } });
  const pending = h.controller.detach();
  h.created[0].forceClose();
  assert.equal(await pending, false);
  h.created[0].loaded();
  await wait();
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.controller.isDetached(), false);
  assert.equal(h.toggleButton.disabled, false);
});

test('로딩 중 dock 취소 뒤 새 분리 요청에 이전 load가 영향을 주지 않는다', async t => {
  const h = await setup(t, { child: { ready: false } });
  const first = h.controller.detach();
  assert.equal(h.controller.dock(), true);
  assert.equal(await first, false);
  assert.equal(h.created[0].window.closed, true);
  const second = h.controller.detach();
  h.created[0].loaded();
  assert.equal(await second, true);
  assert.equal(h.panel.ownerDocument, h.created[1].window.document);
  assert.equal(h.opens, 2);
  assert.deepEqual(h.changes, [true]);
});

test('팝업 HTML에는 현재 테마와 변경한 테마만 복사하고 자체 body 클래스는 보존한다', async t => {
  const h = await setup(t);
  await h.controller.detach();
  const child = h.created[0].window;
  assert.equal(child.document.documentElement.className, 'light-mode');
  assert.equal(child.document.documentElement.style.getPropertyValue('--accent-primary'), '#4a9eff');
  assert.equal(child.document.body.className, 'comment-popout-body');
  h.document.documentElement.className = 'dark-mode';
  h.document.documentElement.style.setProperty('--accent-primary', '#aabbcc');
  await wait();
  assert.equal(child.document.documentElement.className, 'dark-mode');
  assert.equal(child.document.documentElement.style.getPropertyValue('--accent-primary'), '#aabbcc');
  h.controller.dock();
  h.document.documentElement.className = 'light-mode';
  await wait();
  assert.equal(child.document.documentElement.className, 'dark-mode');
});

test('onReady 실패는 옮겼던 패널을 복귀시키고 창과 pending 상태를 정리한다', async t => {
  const h = await setup(t, { throwReady: true });
  assert.equal(await h.controller.detach(), false);
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.created[0].window.closed, true);
  assert.equal(h.toggleButton.disabled, false);
  assert.equal(h.errors.length, 1);
  assert.equal(h.controller.isDetached(), false);
});

for (const pending of [false, true]) {
  test(`dispose는 ${pending ? '로딩 중' : '분리된'} 창과 이벤트를 정리하고 재시작을 막는다`, async t => {
    const h = await setup(t, { child: { ready: !pending } });
    const result = h.controller.detach();
    if (!pending) assert.equal(await result, true);
    h.controller.dispose();
    assert.equal(await result, !pending);
    assert.equal(h.panel.ownerDocument, h.document);
    assert.equal(h.created[0].window.closed, true);
    assert.equal(h.toggleButton.disabled, false);
    assert.equal(h.controller.isDetached(), false);
    assert.equal(await h.controller.detach(), false);
    h.toggleButton.click();
    assert.equal(h.opens, 1);
    h.controller.dispose();
  });
}

test('부모 beforeunload는 패널을 복귀시키고 자식 창을 닫는다', async t => {
  const h = await setup(t);
  await h.controller.detach();
  h.win.dispatchEvent(new h.win.Event('beforeunload'));
  assert.equal(h.panel.ownerDocument, h.document);
  assert.equal(h.created[0].window.closed, true);
  assert.equal(h.controller.isDetached(), false);
});

test('분리 버튼은 열기와 다시 붙이기를 직접 연결한다', async t => {
  const h = await setup(t);
  h.toggleButton.click();
  await wait(10);
  assert.equal(h.controller.isDetached(), true);
  h.toggleButton.click();
  assert.equal(h.controller.isDetached(), false);
});
