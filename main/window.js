/**
 * baeframe - BrowserWindow 관리
 */

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger');

const log = createLogger('Window');

// 디버그 로그 (startup-debug.log에 기록)
const startupDebugPath = path.join(process.env.APPDATA || '', 'baeframe', 'startup-debug.log');
function debugLog(msg) {
  const line = `[${new Date().toISOString()}] [Window] ${msg}\n`;
  try {
    fs.appendFileSync(startupDebugPath, line);
  } catch (e) { /* ignore */ }
}

let mainWindow = null;
let loadingWindow = null;

/**
 * 로딩 창 생성
 * @param {object} [options] - 로딩창 옵션
 * @param {string} [options.filePath] - 로딩 중인 파일 경로 (표시용)
 * @param {string} [options.launchContext] - app | deeplink
 * @returns {BrowserWindow}
 */
function createLoadingWindow(options = {}) {
  const { filePath = '', launchContext = 'app' } = options;
  // 이미 로딩 창이 있으면 반환
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    return loadingWindow;
  }

  loadingWindow = new BrowserWindow({
    width: 460,
    height: 300,
    frame: false,
    transparent: false,
    backgroundColor: '#1a1a1a',
    resizable: false,
    movable: true,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: false, // 작업표시줄에 표시 (사용자가 로딩 중임을 인지할 수 있도록)
    title: 'BAEFRAME 로딩 중...',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const loadingPath = path.join(__dirname, '..', 'renderer', 'loading.html');
  const search = new URLSearchParams();
  if (filePath) {
    search.set('file', filePath);
  }
  search.set('context', launchContext);

  loadingWindow.loadFile(loadingPath, { search: search.toString() });

  loadingWindow.on('closed', () => {
    loadingWindow = null;
  });

  debugLog('로딩 창 생성됨');
  return loadingWindow;
}

/**
 * 로딩 창 닫기
 */
function closeLoadingWindow() {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close();
    loadingWindow = null;
    debugLog('로딩 창 닫힘');
  }
}

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
  debugLog(`렌더러 경로: ${indexPath}`);
  debugLog(`파일 존재 여부: ${fs.existsSync(indexPath)}`);

  // 개발 모드에서 DevTools 열기
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    log.info('개발 모드 - DevTools 열림');
  }

  // 로드 실패 핸들러 (중요!)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    debugLog(`로드 실패! errorCode: ${errorCode}, desc: ${errorDescription}, url: ${validatedURL}`);
    log.error('렌더러 로드 실패', { errorCode, errorDescription, validatedURL });
    // 로드 실패해도 창은 표시
    closeLoadingWindow();
    mainWindow.show();
  });

  // 로드 성공 핸들러
  mainWindow.webContents.on('did-finish-load', () => {
    debugLog('렌더러 로드 완료 (did-finish-load)');
  });

  // 준비되면 보여주기
  const windowCreateTime = Date.now();
  mainWindow.once('ready-to-show', () => {
    debugLog('ready-to-show 이벤트 발생');
    // 로딩 창 닫기
    closeLoadingWindow();
    mainWindow.show();
    log.info('메인 윈도우 표시됨', {
      width: windowWidth,
      height: windowHeight,
      loadTime: `${Date.now() - windowCreateTime}ms`
    });
    trace.end();
  });

  // 5초 후에도 창이 안 보이면 강제로 표시 (안전장치)
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      debugLog('타임아웃 - 강제로 창 표시');
      log.warn('ready-to-show 타임아웃, 강제 표시');
      closeLoadingWindow();
      mainWindow.show();
    }
  }, 5000);

  // 파일 로드 시작
  mainWindow.loadFile(indexPath).then(() => {
    debugLog('loadFile Promise 완료');
  }).catch((err) => {
    debugLog(`loadFile 에러: ${err.message}`);
    log.error('loadFile 에러', { error: err.message });
    mainWindow.show();
  });

  // 윈도우 닫힘 처리
  mainWindow.on('closed', () => {
    log.info('메인 윈도우 닫힘');
    mainWindow = null;
  });

  // 렌더러 에러 처리
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    debugLog(`렌더러 프로세스 종료: ${JSON.stringify(details)}`);
    log.error('렌더러 프로세스 종료', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    debugLog('렌더러 프로세스 응답 없음');
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
  createLoadingWindow,
  closeLoadingWindow,
  minimizeWindow,
  toggleMaximize,
  closeWindow,
  isMaximized,
  toggleFullscreen,
  isFullscreen
};
