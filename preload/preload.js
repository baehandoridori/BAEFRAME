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
  scanVersions: (filePath) => ipcRenderer.invoke('file:scan-versions', filePath),

  // ====== 윈도우 관련 ======
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),

  // ====== 앱 관련 ======
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPath: (name) => ipcRenderer.invoke('app:get-path', name),

  // ====== 링크 관련 ======
  copyToClipboard: (text) => ipcRenderer.invoke('link:copy', text),

  // ====== 폴더/탐색기 관련 ======
  openFolder: (folderPath) => ipcRenderer.invoke('folder:open', folderPath),
  showInFolder: (filePath) => ipcRenderer.invoke('folder:show-item', filePath),

  // ====== 외부 링크 열기 ======
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  // ====== Google Drive 파일 ID 추출 ======
  getGDriveFileId: (localPath) => ipcRenderer.invoke('gdrive:get-file-id', localPath),
  generateGDriveShareLink: (videoPath, bframePath) =>
    ipcRenderer.invoke('gdrive:generate-share-link', videoPath, bframePath),

  // ====== 클립보드 관련 ======
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  readGDriveLink: () => ipcRenderer.invoke('clipboard:read-gdrive-link'),
  generateWebShareLink: (videoUrl, bframeUrl) =>
    ipcRenderer.invoke('webshare:generate-link', videoUrl, bframeUrl),

  // ====== 사용자 정보 관련 ======
  getOSUser: () => ipcRenderer.invoke('user:get-os-user'),
  getSlackUser: () => ipcRenderer.invoke('user:get-slack-user'),

  // ====== 설정 파일 관련 ======
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  getSettingsPath: () => ipcRenderer.invoke('settings:get-path'),

  // ====== 썸네일 캐시 관련 ======
  thumbnailGetCachePath: () => ipcRenderer.invoke('thumbnail:get-cache-path'),
  thumbnailCheckValid: (videoPath) => ipcRenderer.invoke('thumbnail:check-valid', videoPath),
  thumbnailLoadAll: (videoHash) => ipcRenderer.invoke('thumbnail:load-all', videoHash),
  thumbnailSaveBatch: (data) => ipcRenderer.invoke('thumbnail:save-batch', data),
  thumbnailClearVideoCache: (videoHash) => ipcRenderer.invoke('thumbnail:clear-video-cache', videoHash),
  thumbnailClearAllCache: () => ipcRenderer.invoke('thumbnail:clear-all-cache'),
  thumbnailGetCacheSize: () => ipcRenderer.invoke('thumbnail:get-cache-size'),

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
