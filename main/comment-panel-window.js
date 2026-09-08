const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MAIN_URL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
const PANEL_URL = pathToFileURL(path.join(__dirname, '../renderer/comment-panel.html')).href;
const PANEL_NAMES = new Set(['baeframe-comments', 'baeframe-previous-reviews']);

function configureCommentPanelWindow(mainWindow) {
  const children = new Set();
  const contents = mainWindow.webContents;
  const isAllowed = (details) => !mainWindow.isDestroyed() && !contents.isDestroyed()
    && contents.getURL() === MAIN_URL && contents.mainFrame?.url === MAIN_URL
    && details?.url === PANEL_URL && PANEL_NAMES.has(details.frameName);

  contents.setWindowOpenHandler((details) => {
    if (!isAllowed(details)) return { action: 'deny' };
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: {
        width: 420, height: 760, minWidth: 320, minHeight: 480,
        title: 'BAEFRAME 댓글', backgroundColor: '#1a1a1a',
        frame: true, movable: true, resizable: true, autoHideMenuBar: true,
        webPreferences: {
          // 댓글 DOM과 기존 리스너만 옮긴다. 부모의 파일/IPC 권한은 제공하지 않는다.
          preload: path.join(__dirname, '../preload/comment-panel-preload.js'),
          nodeIntegration: false,
          nodeIntegrationInSubFrames: false,
          nodeIntegrationInWorker: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          webviewTag: false
        }
      }
    };
  });

  contents.on('did-create-window', (child, details) => {
    if (!isAllowed(details)) {
      if (!child.isDestroyed()) child.destroy();
      return;
    }
    children.add(child);
    child.once('closed', () => children.delete(child));
    child.setMenuBarVisibility(false);
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const prevent = (event) => event.preventDefault();
    const guardInitialNavigation = (event) => {
      // window.open의 첫 로드도 will-frame-navigate를 거친다. 빈 창에서
      // 지정 문서로 가는 최초 main-frame 요청을 허용해야 실제 패널이 열린다.
      const currentUrl = child.webContents.getURL();
      if ((currentUrl === '' || currentUrl === 'about:blank')
        && event.url === PANEL_URL && event.isMainFrame === true) return;
      event.preventDefault();
    };
    child.webContents.on('will-navigate', guardInitialNavigation);
    child.webContents.on('will-frame-navigate', guardInitialNavigation);
    for (const eventName of ['will-redirect', 'will-attach-webview']) {
      child.webContents.on(eventName, prevent);
    }
  });

  const closeChildren = () => {
    for (const child of children) {
      if (!child.isDestroyed()) child.destroy();
    }
    children.clear();
  };
  mainWindow.once('closed', closeChildren);
  contents.on('render-process-gone', closeChildren);
}

module.exports = { configureCommentPanelWindow };
