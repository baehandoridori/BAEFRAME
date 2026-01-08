/**
 * baeframe - Electron Main Process Entry Point
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createLogger } = require('./logger');
const { createMainWindow, getMainWindow } = require('./window');
const { setupIpcHandlers } = require('./ipc-handlers');

const log = createLogger('Main');

// ============================================
// baeframe:// 프로토콜 URL 파싱 헬퍼
// ============================================
/**
 * baeframe:// URL을 실제 파일 경로로 변환
 * - URL 디코딩 (한글 등 인코딩된 문자 복원)
 * - Slack이 G:/ → G/ 로 변환하는 문제 수정
 * - 슬래시를 백슬래시로 변환 (Windows)
 * - 공유 링크 형식(경로|웹URL|파일명)에서 경로만 추출
 *
 * @param {string} url - baeframe://... 형식의 URL
 * @returns {string} 실제 파일 경로
 */
function parseBaeframeUrl(url) {
  if (!url || !url.startsWith('baeframe://')) {
    return url;
  }

  log.debug('프로토콜 URL 파싱 시작', { url });

  // baeframe:// 제거
  let filePath = url.replace(/^baeframe:\/\//, '');

  // URL 디코딩 (한글, 공백 등)
  try {
    filePath = decodeURIComponent(filePath);
  } catch (e) {
    log.warn('URL 디코딩 실패, 원본 사용', { error: e.message });
  }

  // 공유 링크 형식: 경로\n웹URL\n파일명 또는 경로|웹URL|파일명
  // 첫 번째 줄 또는 | 이전의 경로만 추출
  if (filePath.includes('\n')) {
    const parts = filePath.split('\n');
    filePath = parts[0]; // 파일 경로만 사용
    log.debug('공유 링크에서 경로 추출 (줄바꿈)', { extractedPath: filePath });
  } else if (filePath.includes('|')) {
    const parts = filePath.split('|');
    filePath = parts[0]; // 파일 경로만 사용 (하위호환)
    log.debug('공유 링크에서 경로 추출 (|)', { extractedPath: filePath });
  }

  // Slack이 "G:/" → "G/" 로 변환하는 문제 수정
  // 예: "G/공유" → "G:/공유"
  if (/^[A-Za-z]\//.test(filePath)) {
    filePath = filePath[0] + ':' + filePath.slice(1);
  }

  // 슬래시를 백슬래시로 변환 (Windows)
  if (process.platform === 'win32') {
    filePath = filePath.replace(/\//g, '\\');
  }

  log.debug('프로토콜 URL 파싱 완료', { filePath });
  return filePath;
}

// ============================================
// 비디오 코덱 지원 향상을 위한 Chromium 플래그
// ============================================
// HEVC/H.265 하드웨어 디코딩 활성화 시도
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-gpu-rasterization');
// 일부 시스템에서 GPU 프로세스 안정성 향상
app.commandLine.appendSwitch('ignore-gpu-blocklist');

log.info('비디오 하드웨어 가속 플래그 적용됨');

// ============================================
// baeframe:// 프로토콜 등록 (Electron 내장)
// ============================================
// 개발 모드: process.execPath = electron.exe, process.argv[1] = "."
// 빌드 모드: process.execPath = BAEFRAME.exe
if (process.defaultApp) {
  // 개발 모드 (npm start / npx electron .)
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('baeframe', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  // 빌드된 exe
  app.setAsDefaultProtocolClient('baeframe');
}

log.info('baeframe:// 프로토콜 등록됨 (Electron 내장)');

// 단일 인스턴스 잠금
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.warn('다른 인스턴스가 이미 실행 중입니다. 종료합니다.');
  app.quit();
} else {
  // 두 번째 인스턴스가 실행되려 할 때
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    log.info('두 번째 인스턴스 감지', { commandLine });
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // 프로토콜 링크나 파일 경로가 있으면 처리
      let arg = commandLine.find(a =>
        a.startsWith('baeframe://') ||
        a.endsWith('.bframe') ||
        a.endsWith('.mp4') ||
        a.endsWith('.mov') ||
        a.endsWith('.avi') ||
        a.endsWith('.mkv') ||
        a.endsWith('.webm')
      );

      if (arg) {
        // baeframe:// URL이면 파일 경로로 변환
        if (arg.startsWith('baeframe://')) {
          arg = parseBaeframeUrl(arg);
          log.info('프로토콜 URL 처리됨', { filePath: arg });
        }
        mainWindow.webContents.send('open-from-protocol', arg);
      }
    }
  });

  // 앱 준비 완료
  app.whenReady().then(() => {
    log.info('앱 시작', { version: app.getVersion() });

    // IPC 핸들러 설정
    setupIpcHandlers();

    // 메인 윈도우 생성
    createMainWindow();

    // 시작 시 전달된 파일/프로토콜 인자 처리
    let fileArg = process.argv.find(arg =>
      arg.startsWith('baeframe://') ||
      arg.endsWith('.bframe') ||
      arg.endsWith('.mp4') ||
      arg.endsWith('.mov') ||
      arg.endsWith('.avi') ||
      arg.endsWith('.mkv') ||
      arg.endsWith('.webm')
    );

    if (fileArg) {
      // baeframe:// URL이면 파일 경로로 변환
      if (fileArg.startsWith('baeframe://')) {
        fileArg = parseBaeframeUrl(fileArg);
        log.info('프로토콜 URL로 시작됨', { filePath: fileArg });
      } else {
        log.info('시작 인자로 파일 전달됨', { fileArg });
      }

      // 윈도우 로드 완료 후 파일 열기
      const mainWindow = getMainWindow();
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.send('open-from-protocol', fileArg);
      });
    }

    // macOS: 모든 창이 닫혀도 앱은 유지
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  // 모든 창이 닫히면 앱 종료 (macOS 제외)
  app.on('window-all-closed', () => {
    log.info('모든 창 닫힘');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // 앱 종료 전
  app.on('before-quit', () => {
    log.info('앱 종료 중...');
  });

  // 앱 종료 완료 - 프로세스 강제 종료
  app.on('quit', () => {
    log.info('앱 종료됨, 프로세스 정리');
    // GPU 프로세스 등이 남아있을 수 있으므로 강제 종료
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });

  // 에러 핸들링
  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception', {
      message: error.message,
      stack: error.stack
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    log.error('Unhandled Rejection', { reason });
  });
}
