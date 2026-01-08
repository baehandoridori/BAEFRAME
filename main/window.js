/**
 * baeframe - BrowserWindow 관리
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { createLogger } = require('./logger');

const log = createLogger('Window');

let mainWindow = null;

/**
 * 메인 윈도우 생성
 * @returns {BrowserWindow}
 */
function createMainWindow() {
  const trace = log.trace('createMainWindow');

  // 화면 크기 가져오기
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  // 윈도우 크기 계산 (화면의 85%)
  const windowWidth = Math.min(Math.floor(screenWidth * 0.85), 1600);
  const windowHeight = Math.min(Math.floor(screenHeight * 0.85), 1000);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    show: false, // ready-to-show 이벤트에서 보여줌
    frame: true, // 기본 프레임 사용
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // electron-store 등 사용을 위해
    }
  });

  // 렌더러 로드
  const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexPath);

  // 개발 모드에서 DevTools 열기
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    log.info('개발 모드 - DevTools 열림');
  }

  // 준비되면 보여주기
  const windowCreateTime = Date.now();
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    log.info('메인 윈도우 표시됨', {
      width: windowWidth,
      height: windowHeight,
      loadTime: `${Date.now() - windowCreateTime}ms`
    });
    trace.end();
  });

  // 윈도우 닫힘 처리
  mainWindow.on('closed', () => {
    log.info('메인 윈도우 닫힘');
    mainWindow = null;
  });

  // 렌더러 에러 처리
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('렌더러 프로세스 종료', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('렌더러 프로세스 응답 없음');
  });

  mainWindow.webContents.on('responsive', () => {
    log.info('렌더러 프로세스 응답 복구');
  });

  return mainWindow;
}

/**
 * 메인 윈도우 반환
 * @returns {BrowserWindow | null}
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * 윈도우 최소화
 */
function minimizeWindow() {
  if (mainWindow) {
    mainWindow.minimize();
  }
}

/**
 * 윈도우 최대화 토글
 */
function toggleMaximize() {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
}

/**
 * 윈도우 닫기
 */
function closeWindow() {
  if (mainWindow) {
    mainWindow.close();
  }
}

/**
 * 윈도우 최대화 상태 확인
 * @returns {boolean}
 */
function isMaximized() {
  return mainWindow ? mainWindow.isMaximized() : false;
}

/**
 * 전체화면 토글
 */
function toggleFullscreen() {
  if (mainWindow) {
    const isFullscreen = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFullscreen);
    log.info('전체화면 토글', { isFullscreen: !isFullscreen });
  }
}

/**
 * 전체화면 상태 확인
 * @returns {boolean}
 */
function isFullscreen() {
  return mainWindow ? mainWindow.isFullScreen() : false;
}

module.exports = {
  createMainWindow,
  getMainWindow,
  minimizeWindow,
  toggleMaximize,
  closeWindow,
  isMaximized,
  toggleFullscreen,
  isFullscreen
};
