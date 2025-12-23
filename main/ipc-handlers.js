/**
 * baeframe - IPC 핸들러 등록
 */

const { ipcMain, dialog, app, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('./logger');
const { getMainWindow, minimizeWindow, toggleMaximize, closeWindow, isMaximized } = require('./window');

const log = createLogger('IPC');

/**
 * IPC 핸들러 설정
 */
function setupIpcHandlers() {
  log.info('IPC 핸들러 등록 시작');

  // ====== 파일 관련 ======

  // 파일 열기 다이얼로그
  ipcMain.handle('file:open-dialog', async (event, options = {}) => {
    const trace = log.trace('file:open-dialog');
    try {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: '영상 파일 열기',
        filters: [
          { name: '비디오 파일', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: '모든 파일', extensions: ['*'] }
        ],
        properties: ['openFile'],
        ...options
      });
      trace.end({ canceled: result.canceled });
      return result;
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 파일 정보 가져오기
  ipcMain.handle('file:get-info', async (event, filePath) => {
    const trace = log.trace('file:get-info');
    try {
      const stats = await fs.promises.stat(filePath);
      const info = {
        path: filePath,
        name: path.basename(filePath),
        dir: path.dirname(filePath),
        ext: path.extname(filePath),
        size: stats.size,
        mtime: stats.mtime
      };
      trace.end(info);
      return info;
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 리뷰 데이터 저장
  ipcMain.handle('file:save-review', async (event, filePath, data) => {
    const trace = log.trace('file:save-review');
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      trace.end({ filePath });
      return { success: true };
    } catch (error) {
      trace.error(error);
      throw error;
    }
  });

  // 리뷰 데이터 로드
  ipcMain.handle('file:load-review', async (event, filePath) => {
    const trace = log.trace('file:load-review');
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      trace.end({ filePath });
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        trace.end({ filePath, exists: false });
        return null;
      }
      trace.error(error);
      throw error;
    }
  });

  // ====== 윈도우 관련 ======

  ipcMain.handle('window:minimize', () => {
    minimizeWindow();
  });

  ipcMain.handle('window:maximize', () => {
    toggleMaximize();
  });

  ipcMain.handle('window:close', () => {
    closeWindow();
  });

  ipcMain.handle('window:is-maximized', () => {
    return isMaximized();
  });

  // ====== 앱 관련 ======

  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('app:get-path', (event, name) => {
    return app.getPath(name);
  });

  // ====== 클립보드/링크 관련 ======

  ipcMain.handle('link:copy', (event, text) => {
    clipboard.writeText(text);
    log.info('클립보드에 복사됨', { text });
    return { success: true };
  });

  // ====== 로그 관련 ======

  ipcMain.on('log:write', (event, logData) => {
    // 렌더러에서 온 로그를 파일에 기록
    const rendererLog = createLogger(`Renderer:${logData.module}`);
    const level = logData.level?.toLowerCase() || 'info';
    if (typeof rendererLog[level] === 'function') {
      rendererLog[level](logData.message, logData.data);
    }
  });

  log.info('IPC 핸들러 등록 완료');
}

module.exports = { setupIpcHandlers };
