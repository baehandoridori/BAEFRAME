/**
 * baeframe - Preload Script
 * Renderer에서 사용할 안전한 API 노출
 */

const { contextBridge, ipcRenderer } = require('electron');

// Renderer에 노출할 API
contextBridge.exposeInMainWorld('electronAPI', {
  // ====== 파일 관련 ======
  openFileDialog: (options) => ipcRenderer.invoke('file:open-dialog', options),
  getFileInfo: (filePath) => ipcRenderer.invoke('file:get-info', filePath),
  saveReview: (filePath, data) => ipcRenderer.invoke('file:save-review', filePath, data),
  loadReview: (filePath) => ipcRenderer.invoke('file:load-review', filePath),

  // ====== 윈도우 관련 ======
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),

  // ====== 앱 관련 ======
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPath: (name) => ipcRenderer.invoke('app:get-path', name),

  // ====== 링크 관련 ======
  copyToClipboard: (text) => ipcRenderer.invoke('link:copy', text),

  // ====== 로그 관련 ======
  writeLog: (logData) => ipcRenderer.send('log:write', logData),

  // ====== 이벤트 리스너 ======
  onOpenFromProtocol: (callback) => {
    ipcRenderer.on('open-from-protocol', (event, arg) => callback(arg));
  },

  // 이벤트 리스너 제거
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});

// 플랫폼 정보 노출
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
  name: process.platform
});

console.log('[Preload] electronAPI 노출 완료');
