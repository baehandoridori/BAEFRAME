const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const png = { base64: 'data:image/png;base64,aW1hZ2U=', width: 4, height: 2 };

function harness(t) {
  const dom = new JSDOM('<div id="video"><div id="markers"></div></div>');
  t.after(() => dom.window.close());
  const document = dom.window.document;
  const reads = [];
  const toasts = [];
  const timers = [];
  const context = vm.createContext({
    document, MutationObserver: dom.window.MutationObserver, EventTarget, Event, CustomEvent,
    createLogger: () => ({ info() {}, debug() {}, warn() {}, error() {} }),
    log: { error() {} },
    getAuthManager: () => ({ isAuthAvailable: () => false, getCurrentUser: () => null }),
    elements: { videoWrapper: document.getElementById('video') },
    markerContainer: document.getElementById('markers'),
    mentionManager: { attach() {}, isVisibleFor: () => false },
    scheduleMpvOverlayStateSync() {},
    setTimeout: callback => timers.push(callback),
    state: { currentFile: 'C:/shots/A.mp4' },
    latestVideoLoadToken: 1, videoLoadIntentGeneration: 1, activeVideoLoadToken: null,
    hasImageInClipboard: event => event.clipboardData?.items?.some(item => item.type.startsWith('image/')),
    getImageFromClipboard: () => new Promise((resolve, reject) => reads.push({ resolve, reject })),
    showToast: (text, kind) => toasts.push({ text, kind })
  });
  const managerSource = fs.readFileSync(path.join(root, 'renderer/scripts/modules/comment-manager.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export default .*;\r?\n?/gm, '').replace(/^export /gm, '');
  vm.runInContext(`${managerSource}\nglobalThis.commentManager = new CommentManager();`, context);
  vm.runInContext(`${declaration('removePendingMarkerUI')}\n${declaration('renderPendingMarker')}`, context);
  const cm = context.commentManager;
  cm.addEventListener('markerCreationStarted', event => context.renderPendingMarker(event.detail.marker));
  cm.addEventListener('markerCreationCancelled', () => context.removePendingMarkerUI());
  cm.addEventListener('markerAdded', () => context.removePendingMarkerUI());
  const start = () => {
    cm.setCommentMode(true);
    return cm.startMarkerCreation(0.5, 0.5);
  };
  start();
  const editor = () => document.querySelector('.comment-marker-input');
  const paste = (type = 'image/png') => {
    const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ type }] } });
    editor().dispatchEvent(event);
    return event;
  };
  const key = (name, options = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
    editor().dispatchEvent(event);
    return event;
  };
  return { dom, document, cm, context, reads, toasts, timers, start, editor, paste, key };
}

test('영상 위 댓글에 이미지를 붙이면 미리 보이고 이미지 단독으로 저장한다', async t => {
  const h = harness(t);
  assert.equal(h.paste().defaultPrevented, true, '이미지 paste는 동기적으로 소유해야 한다');
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve(png);
  await tick();
  assert.equal(h.cm._pendingImage, png);
  const preview = h.document.querySelector('.comment-marker-image-preview');
  assert.equal(preview.hidden, false);
  assert.equal(preview.querySelector('img').src, png.base64);
  h.key('Enter');
  const marker = h.cm.getAllMarkers()[0];
  assert.equal(marker.image, png.base64);
  assert.equal(marker.imageWidth, 4);
  assert.equal(marker.imageHeight, 2);
  assert.equal(marker.text, '');
  assert.equal(h.cm._pendingImage, null);
});

test('이미지 준비 중 Enter는 댓글을 지우지 않고 완료 후 텍스트와 함께 저장한다', async t => {
  const h = harness(t);
  h.editor().value = '포즈 참고';
  h.paste();
  assert.equal(h.reads.length, 1);
  h.key('Enter');
  assert.ok(h.cm.pendingMarker);
  assert.equal(h.editor().value, '포즈 참고');
  h.reads[0].resolve(png);
  await tick();
  h.key('Enter');
  assert.equal(h.cm.getAllMarkers()[0].text, '포즈 참고');
  assert.equal(h.cm.getAllMarkers()[0].image, png.base64);
});

for (const scenario of ['cancel', 'replacement marker', 'different file', 'same file new load', 'new load intent', 'loading', 'removed editor']) {
  test(`이미지 변환 중 ${scenario}이면 늦은 이미지를 첨부하지 않는다`, async t => {
    const h = harness(t);
    h.paste();
    assert.equal(h.reads.length, 1);
    if (scenario === 'cancel') h.cm.setCommentMode(false);
    if (scenario === 'replacement marker') h.start();
    if (scenario === 'different file') h.context.state.currentFile = 'C:/shots/B.mp4';
    if (scenario === 'same file new load') h.context.latestVideoLoadToken++;
    if (scenario === 'new load intent') h.context.videoLoadIntentGeneration++;
    if (scenario === 'loading') h.context.activeVideoLoadToken = 2;
    if (scenario === 'removed editor') h.context.removePendingMarkerUI();
    h.reads[0].resolve(png);
    await tick();
    assert.equal(h.cm._pendingImage, null);
    assert.equal(h.toasts.some(toast => toast.kind === 'success'), false);
  });
}

test('연속 이미지 붙여넣기는 마지막 요청을 유지하고 이전 결과를 무시한다', async t => {
  const h = harness(t);
  h.paste(); h.paste();
  assert.equal(h.reads.length, 2);
  const newer = { ...png, base64: 'data:image/png;base64,bmV3' };
  h.reads[1].resolve(newer);
  await tick();
  h.reads[0].resolve(png);
  await tick();
  assert.equal(h.cm._pendingImage, newer);
});

test('이미지 제거는 진행 중인 교체도 취소하고 텍스트와 입력 포커스를 보존한다', async t => {
  const h = harness(t);
  h.editor().value = '보존할 댓글';
  h.paste();
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve(png);
  await tick();
  h.paste();
  h.document.querySelector('.comment-marker-image-remove').click();
  h.reads[1].resolve({ ...png });
  await tick();
  assert.equal(h.cm._pendingImage, null);
  assert.equal(h.document.querySelector('.comment-marker-image-preview').hidden, true);
  assert.equal(h.editor().value, '보존할 댓글');
  assert.equal(h.document.activeElement, h.editor());
});

test('이미지가 첨부된 마커를 취소하거나 교체해도 다음 마커에 첨부가 남지 않는다', async t => {
  const h = harness(t);
  h.paste();
  assert.equal(h.reads.length, 1);
  h.reads[0].resolve(png);
  await tick();
  h.start();
  assert.equal(h.cm._pendingImage, null, '새 마커로 넘어갈 때 동기적으로 정리한다');
  h.editor().value = '다음 댓글';
  h.key('Enter');
  assert.equal(h.cm.getAllMarkers()[0].image, null);
});

test('이미지 읽기 실패는 초안을 보존하고 오류를 안내한다', async t => {
  const h = harness(t);
  h.editor().value = '댓글 유지';
  h.paste();
  assert.equal(h.reads.length, 1);
  h.reads[0].reject(new Error('decode failed'));
  await tick();
  assert.equal(h.editor().value, '댓글 유지');
  assert.equal(h.cm._pendingImage, null);
  assert.ok(h.toasts.some(toast => toast.kind === 'error'));
  h.key('Enter');
  assert.equal(h.cm.getAllMarkers()[0].text, '댓글 유지');
});

test('일반 텍스트 붙여넣기와 Ctrl+C/V는 기본 동작을 막지 않는다', t => {
  const h = harness(t);
  assert.equal(h.paste('text/plain').defaultPrevented, false);
  assert.equal(h.key('c', { code: 'KeyC', ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.key('v', { code: 'KeyV', ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.reads.length, 0);
});
