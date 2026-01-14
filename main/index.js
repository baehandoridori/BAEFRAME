/**
 * baeframe - Electron Main Process Entry Point
 */

// ============================================
// 시작 디버깅 (프로토콜 링크 문제 진단용)
// ============================================
const fs = require('fs');
const path = require('path');
const baeframeDataDir = path.join(process.env.APPDATA || '', 'baeframe');
const startupDebugPath = path.join(baeframeDataDir, 'startup-debug.log');

// 디버그 로그 폴더가 없으면 생성
try {
  if (!fs.existsSync(baeframeDataDir)) {
    fs.mkdirSync(baeframeDataDir, { recursive: true });
  }
} catch (e) { /* ignore */ }

function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(startupDebugPath, line);
  } catch (e) { /* ignore */ }
}

debugLog('========== 앱 시작 ==========');
debugLog(`argv: ${JSON.stringify(process.argv)}`);
debugLog(`cwd: ${process.cwd()}`);
debugLog(`__dirname: ${__dirname}`);

// 앱 시작 시간 측정
const appStartTime = Date.now();

const { app, BrowserWindow, ipcMain } = require('electron');
debugLog('electron 모듈 로드 완료');

// ============================================
// 앱 종료 상태 관리
// ============================================
let isQuitting = false;
let forceQuit = false;

const { createLogger } = require('./logger');
const { createMainWindow, getMainWindow, createLoadingWindow, closeLoadingWindow } = require('./window');
const { setupIpcHandlers } = require('./ipc-handlers');
debugLog('내부 모듈 로드 완료');

const log = createLogger('Main');
log.info(`앱 모듈 로딩 완료: ${Date.now() - appStartTime}ms`);
debugLog(`로거 초기화 완료: ${Date.now() - appStartTime}ms`);

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
  log.info('baeframe:// 제거 후', { filePath });

  // URL 디코딩 (한글, 공백 등)
  // decodeURIComponent가 한글을 제대로 처리하지 못하는 경우 수동 UTF-8 디코딩
  try {
    const beforeDecode = filePath;
    log.info('디코딩 시작', { length: filePath.length, last20: filePath.slice(-20) });

    // 수동 UTF-8 디코딩: %XX 시퀀스를 바이트로 변환 후 UTF-8 문자열로
    const bytes = [];
    let skippedPercent = [];
    for (let i = 0; i < filePath.length; i++) {
      if (filePath[i] === '%' && i + 2 < filePath.length) {
        const hex = filePath.substring(i + 1, i + 3);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          bytes.push(parseInt(hex, 16));
          i += 2;
          continue;
        } else {
          // hex가 유효하지 않은 경우 로깅
          skippedPercent.push({ pos: i, hex, charCodes: [filePath.charCodeAt(i+1), filePath.charCodeAt(i+2)] });
        }
      }
      // 일반 ASCII 문자
      bytes.push(filePath.charCodeAt(i));
    }

    if (skippedPercent.length > 0) {
      log.warn('유효하지 않은 % 시퀀스 발견', { skippedPercent });
    }

    log.info('바이트 배열', { length: bytes.length, last10: bytes.slice(-10) });
    filePath = Buffer.from(bytes).toString('utf8');

    log.info('URL 디코딩 결과', { before: beforeDecode.slice(-30), after: filePath.slice(-30), changed: beforeDecode !== filePath });
  } catch (e) {
    log.warn('URL 디코딩 실패, 원본 사용', { error: e.message, filePath });
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
//
// 중요: 개발 모드에서는 프로토콜을 등록하지 않음
// - 개발 모드와 빌드된 앱이 프로토콜을 서로 덮어쓰는 문제 방지
// - 팀원들이 공유 드라이브의 빌드된 exe를 사용할 때 충돌 방지
//
// 프로토콜 등록 규칙:
// - 빌드된 앱(process.defaultApp !== true)에서만 등록
// - 개발 모드에서는 기존 등록을 유지
// ============================================

// 개발 모드, 빌드된 앱 모두 프로토콜 등록
// 개발 모드에서도 Slack 링크 테스트가 가능하도록 함
// 팀원 배포 시 빌드된 exe 한 번 실행하면 해당 경로로 덮어씌워짐
if (process.defaultApp) {
  // 개발 모드: electron 실행 파일 + 스크립트 경로로 등록
  app.setAsDefaultProtocolClient('baeframe', process.execPath, [path.resolve(process.argv[1])]);
  log.info('개발 모드 - 프로토콜 등록됨', {
    execPath: process.execPath,
    scriptPath: path.resolve(process.argv[1])
  });
  debugLog(`개발 모드 프로토콜 등록됨: ${process.execPath} ${path.resolve(process.argv[1])}`);
} else {
  // 빌드된 exe - 현재 실행 파일로 등록
  app.setAsDefaultProtocolClient('baeframe');
  log.info('baeframe:// 프로토콜 등록됨', {
    execPath: process.execPath,
    defaultApp: process.defaultApp
  });
  debugLog(`프로토콜 등록됨: ${process.execPath}`);
}

// 단일 인스턴스 잠금
debugLog('단일 인스턴스 잠금 요청 중...');
const gotTheLock = app.requestSingleInstanceLock();
debugLog(`잠금 결과: ${gotTheLock}`);

if (!gotTheLock) {
  debugLog('다른 인스턴스 실행 중 - 종료');
  log.warn('다른 인스턴스가 이미 실행 중입니다. 종료합니다.');
  app.quit();
} else {
  debugLog('잠금 획득 성공 - 메인 인스턴스로 실행');

  // 두 번째 인스턴스가 실행되려 할 때
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    debugLog(`second-instance 이벤트: ${JSON.stringify(commandLine)}`);
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
  debugLog('whenReady 대기 중...');
  app.whenReady().then(() => {
    debugLog(`앱 준비 완료: ${Date.now() - appStartTime}ms`);
    log.info(`앱 준비 완료: ${Date.now() - appStartTime}ms`, { version: app.getVersion() });

    // 시작 시 전달된 파일/프로토콜 인자 확인
    let fileArg = process.argv.find(arg =>
      arg.startsWith('baeframe://') ||
      arg.endsWith('.bframe') ||
      arg.endsWith('.mp4') ||
      arg.endsWith('.mov') ||
      arg.endsWith('.avi') ||
      arg.endsWith('.mkv') ||
      arg.endsWith('.webm')
    );

    // 파일 인자가 있으면 로딩 창 먼저 표시
    if (fileArg) {
      // baeframe:// URL이면 파일 경로로 변환
      if (fileArg.startsWith('baeframe://')) {
        fileArg = parseBaeframeUrl(fileArg);
        log.info('프로토콜 URL로 시작됨', { filePath: fileArg });
      } else {
        log.info('시작 인자로 파일 전달됨', { fileArg });
      }
      // 로딩 창 표시
      createLoadingWindow(fileArg);
      debugLog('로딩 창 표시됨');
    }

    // IPC 핸들러 설정
    debugLog('IPC 핸들러 설정 중...');
    setupIpcHandlers();

    // 메인 윈도우 생성
    debugLog('메인 윈도우 생성 중...');
    createMainWindow();
    debugLog('메인 윈도우 생성 완료');

    // 파일 인자가 있으면 윈도우 로드 완료 후 파일 열기
    if (fileArg) {
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

  // 앱 종료 전 - 저장 확인
  app.on('before-quit', (event) => {
    log.info('앱 종료 요청', { isQuitting, forceQuit });

    // 이미 종료 처리 중이거나 강제 종료인 경우 진행
    if (forceQuit) {
      log.info('강제 종료 진행');
      return;
    }

    // 아직 저장 확인 안 했으면 종료 지연
    if (!isQuitting) {
      event.preventDefault();
      isQuitting = true;

      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('Renderer에 저장 확인 요청');
        mainWindow.webContents.send('app:request-save-before-quit');
      } else {
        // 윈도우가 없으면 바로 종료
        forceQuit = true;
        app.quit();
      }
    }
  });

  // Renderer에서 종료 확인 응답 처리
  ipcMain.handle('app:quit-confirmed', () => {
    log.info('Renderer 저장 완료, 앱 종료');
    forceQuit = true;
    app.quit();
  });

  ipcMain.handle('app:quit-cancelled', () => {
    log.info('사용자가 종료 취소');
    isQuitting = false;
    forceQuit = false;
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
