/**
 * baeframe - BrowserWindow 관리
 */

const { BrowserWindow, screen, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger');
const { mpvManager } = require('./mpv-manager');
const { mpvEmbedHost } = require('./mpv-embed-host');
const { mpvOverlayHost } = require('./mpv-overlay-host');

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

async function cleanupMpvAfterRendererGone(reason) {
  log.warn('렌더러 이탈로 mpv 재생 엔진 정리', { reason });
  try {
    await mpvManager.stop({ commandTimeoutMs: 500 });
  } catch (error) {
    log.warn('렌더러 이탈 mpv 종료 실패', { error: error.message });
  }
  try {
    mpvOverlayHost.destroy();
  } catch (error) {
    log.debug('렌더러 이탈 mpv 오버레이 정리 실패', { error: error.message });
  }
  try {
    mpvEmbedHost.destroy();
  } catch (error) {
    log.debug('렌더러 이탈 mpv 임베드 정리 실패', { error: error.message });
  }
}

// 드롭된 경로를 확장자에 따라 렌더러의 올바른 열기 채널로 보낸다.
// (open-from-protocol의 handleExternalFile은 재생목록/컷 묶음을 모른다 — main/index.js의 분기와 동일)
function sendDroppedPathToRenderer(mainWindow, filePath) {
  if (!mainWindow || mainWindow.isDestroyed?.()) return;
  const lower = String(filePath).toLowerCase();
  if (lower.endsWith('.bplaylist')) {
    mainWindow.webContents.send('open-playlist', filePath);
  } else if (lower.endsWith('.bcutlist')) {
    mainWindow.webContents.send('open-cutlist', filePath);
  } else {
    mainWindow.webContents.send('open-from-protocol', filePath, null);
  }
}

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
  let rendererCrashRecoveryCount = 0;

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

  // 개발 모드에서 DevTools 열기, 프로덕션에서 메뉴바 숨기기
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
    log.info('개발 모드 - DevTools 열림');
  } else {
    Menu.setApplicationMenu(null);
    log.info('프로덕션 모드 - 메뉴바 숨김');
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
    void cleanupMpvAfterRendererGone(`render-process-gone:${details?.reason}`);

    const recoverableReasons = ['crashed', 'oom', 'abnormal-exit', 'launch-failed'];
    if (recoverableReasons.includes(details?.reason) && rendererCrashRecoveryCount < 2) {
      rendererCrashRecoveryCount += 1;
      log.warn('렌더러 자동 복구 시도', { attempt: rendererCrashRecoveryCount });
      mainWindow.webContents.reload();
    }
  });

  mainWindow.webContents.on('did-navigate', () => {
    // 리로드/내비게이션 시 렌더러 상태가 초기화되므로 mpv도 함께 정리
    void cleanupMpvAfterRendererGone('did-navigate');
  });

  // 신규: 파일 드롭이 페이지 네비게이션으로 새는 것을 차단하고 파일 열기로 라우팅한다.
  // (렌더러의 document dragover preventDefault 이후 메인 창 드롭은 렌더러가 소비하므로
  //  이 가드는 주로 방어용이다 — 기존 did-navigate 리스너가 네비게이션을 렌더러-사망 정리로
  //  이어가는 파괴 경로를 원천 차단하는 가치가 있다.)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (!url.startsWith('file://')) return;
    try {
      const filePath = require('url').fileURLToPath(url);
      const rendererUrl = mainWindow.webContents.getURL();
      if (require('url').pathToFileURL(filePath).href === rendererUrl) return; // 자기 자신 재로드는 무시
      sendDroppedPathToRenderer(mainWindow, filePath);
    } catch (_error) { /* 파싱 실패 시 네비게이션만 차단 */ }
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
