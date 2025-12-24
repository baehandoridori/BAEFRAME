/**
 * baeframe - Electron Main Process Entry Point
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { createLogger } = require('./logger');
const { createMainWindow, getMainWindow } = require('./window');
const { setupIpcHandlers } = require('./ipc-handlers');

const log = createLogger('Main');

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
      const arg = commandLine.find(arg =>
        arg.startsWith('baeframe://') ||
        arg.endsWith('.bframe') ||
        arg.endsWith('.mp4') ||
        arg.endsWith('.mov') ||
        arg.endsWith('.avi') ||
        arg.endsWith('.mkv') ||
        arg.endsWith('.webm')
      );
      if (arg) {
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

    // 시작 시 전달된 파일 인자 처리
    const fileArg = process.argv.find(arg =>
      arg.endsWith('.bframe') ||
      arg.endsWith('.mp4') ||
      arg.endsWith('.mov') ||
      arg.endsWith('.avi') ||
      arg.endsWith('.mkv') ||
      arg.endsWith('.webm')
    );
    if (fileArg) {
      log.info('시작 인자로 파일 전달됨', { fileArg });
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
