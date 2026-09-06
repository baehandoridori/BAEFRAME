const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const hostPath = path.join(__dirname, '../../main/comment-panel-window.js');
const mainUrl = pathToFileURL(path.join(__dirname, '../../renderer/index.html')).href;
const panelUrl = pathToFileURL(path.join(__dirname, '../../renderer/comment-panel.html')).href;

class FakeWindow extends EventEmitter {
  constructor(url = mainUrl) {
    super();
    this.destroyed = false;
    this.webContents = new EventEmitter();
    this.webContents.mainFrame = { url };
    this.webContents.getURL = () => this.webContents.mainFrame.url;
    this.webContents.isDestroyed = () => this.destroyed;
    this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
    this.setMenuBarVisibility = (visible) => { this.menuVisible = visible; };
  }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

function configure(window = new FakeWindow()) {
  assert.ok(fs.existsSync(hostPath), '댓글 팝업을 제한하는 메인 프로세스 호스트가 필요합니다.');
  require(hostPath).configureCommentPanelWindow(window);
  return window;
}

function allowedDetails(overrides = {}) {
  return { url: panelUrl, frameName: 'baeframe-comments', ...overrides };
}

test('리뷰 화면에서 지정된 댓글 문서와 이름의 팝업만 허용한다', () => {
  const window = configure();
  assert.equal(window.openHandler(allowedDetails()).action, 'allow');
  for (const details of [
    { url: `${panelUrl}?mode=other` }, { url: `${panelUrl}#section` },
    { url: mainUrl }, { url: 'https://example.com/comment-panel.html' },
    { url: 'javascript:alert(1)' }, { url: 'about:blank' },
    { frameName: '_blank' }, { frameName: '' }
  ]) assert.deepEqual(window.openHandler(allowedDetails(details)), { action: 'deny' });
});

test('메인 문서가 다른 주소로 바뀌거나 창이 종료되면 팝업을 차단한다', () => {
  const window = configure();
  window.webContents.mainFrame.url = `${mainUrl}#other`;
  assert.deepEqual(window.openHandler(allowedDetails()), { action: 'deny' });
  window.webContents.mainFrame.url = mainUrl;
  window.webContents.getURL = () => 'https://example.com';
  assert.deepEqual(window.openHandler(allowedDetails()), { action: 'deny' });
  window.webContents.getURL = () => mainUrl;
  window.destroy();
  assert.deepEqual(window.openHandler(allowedDetails()), { action: 'deny' });
});

test('댓글 창은 독립 이동을 허용하며 부모의 preload 권한을 상속하지 않는다', () => {
  const window = configure();
  const response = window.openHandler(allowedDetails());
  assert.equal(response.outlivesOpener, false);
  const options = response.overrideBrowserWindowOptions;
  assert.equal(options.width, 420);
  assert.equal(options.height, 760);
  assert.equal(options.minWidth, 320);
  assert.equal(options.minHeight, 480);
  assert.equal(options.title, 'BAEFRAME 댓글');
  assert.equal(options.parent, undefined);
  assert.equal(options.movable, true);
  assert.equal(options.resizable, true);
  assert.deepEqual(options.webPreferences, {
    preload: path.join(__dirname, '../../preload/comment-panel-preload.js'),
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false
  });
  const preload = fs.readFileSync(options.webPreferences.preload, 'utf8');
  assert.doesNotMatch(preload, /require\s*\(|exposeInMainWorld|ipcRenderer/);
});

test('생성된 댓글 창에서는 추가 창, 이동, 리디렉션, webview를 막는다', () => {
  const window = configure();
  const child = new FakeWindow(panelUrl);
  window.webContents.emit('did-create-window', child, allowedDetails());
  assert.deepEqual(child.openHandler(allowedDetails()), { action: 'deny' });
  for (const type of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    child.webContents.emit(type, { preventDefault: () => { prevented = true; } });
    assert.ok(prevented, `${type} 차단`);
  }
  assert.equal(child.menuVisible, false);
});

test('빈 자식 창의 최초 댓글 문서 로드만 허용하고 이후 탐색은 차단한다', () => {
  const window = configure();
  const child = new FakeWindow('');
  window.webContents.emit('did-create-window', child, allowedDetails());
  const navigate = (type, url, isMainFrame = true) => {
    let prevented = false;
    child.webContents.emit(type, { url, isMainFrame, preventDefault() { prevented = true; } }, url);
    return prevented;
  };
  assert.equal(navigate('will-frame-navigate', panelUrl), false);
  assert.equal(navigate('will-navigate', panelUrl), false);
  assert.equal(navigate('will-frame-navigate', panelUrl, false), true);
  assert.equal(navigate('will-frame-navigate', mainUrl), true);
  child.webContents.mainFrame.url = panelUrl;
  assert.equal(navigate('will-frame-navigate', panelUrl), true);
  assert.equal(navigate('will-navigate', panelUrl), true);
});

test('예상하지 못한 자식 창 생성과 부모가 먼저 종료된 생성 경합을 차단한다', () => {
  const window = configure();
  const foreignChild = new FakeWindow();
  window.webContents.emit('did-create-window', foreignChild, allowedDetails({ frameName: 'foreign' }));
  assert.equal(foreignChild.destroyed, true);
  window.destroy();
  const lateChild = new FakeWindow(panelUrl);
  window.webContents.emit('did-create-window', lateChild, allowedDetails());
  assert.equal(lateChild.destroyed, true);
});

test('부모가 닫히면 댓글 창도 닫으며 먼저 닫힌 자식은 재정리하지 않는다', () => {
  const window = configure();
  const first = new FakeWindow(panelUrl);
  const second = new FakeWindow(panelUrl);
  window.webContents.emit('did-create-window', first, allowedDetails());
  first.destroy();
  first.destroy = () => assert.fail('이미 닫힌 자식을 다시 정리하지 않아야 합니다.');
  window.webContents.emit('did-create-window', second, allowedDetails());
  window.destroy();
  assert.equal(second.destroyed, true);
});

test('부모 렌더러가 종료되면 상태를 잃은 댓글 팝업도 정리한다', () => {
  const window = configure();
  const child = new FakeWindow(panelUrl);
  window.webContents.emit('did-create-window', child, allowedDetails());
  window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(child.destroyed, true);
});
