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
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
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

  // ====== 인증 파일 관련 ======
  loadAuthData: () => ipcRenderer.invoke('auth:load'),
  saveAuthData: (data) => ipcRenderer.invoke('auth:save', data),

  // ====== 설정 파일 관련 ======
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  getSettingsPath: () => ipcRenderer.invoke('settings:get-path'),
  // ====== Windows 통합(우클릭) 관련 ======
  detectWindowsIntegration: () => ipcRenderer.invoke('integration:detect'),
  runWindowsIntegrationRepair: () => ipcRenderer.invoke('integration:run-repair'),


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

  // ====== 앱 종료 관련 ======
  confirmQuit: () => ipcRenderer.invoke('app:quit-confirmed'),
  cancelQuit: () => ipcRenderer.invoke('app:quit-cancelled'),

  // ====== FFmpeg 트랜스코딩 관련 ======
  ffmpegIsAvailable: () => ipcRenderer.invoke('ffmpeg:is-available'),
  ffmpegProbeCodec: (filePath) => ipcRenderer.invoke('ffmpeg:probe-codec', filePath),
  ffmpegCheckCache: (filePath) => ipcRenderer.invoke('ffmpeg:check-cache', filePath),
  ffmpegTranscode: (filePath) => ipcRenderer.invoke('ffmpeg:transcode', filePath),
  ffmpegCancel: () => ipcRenderer.invoke('ffmpeg:cancel'),
  ffmpegGetCacheSize: () => ipcRenderer.invoke('ffmpeg:get-cache-size'),
  ffmpegSetCacheLimit: (limitGB) => ipcRenderer.invoke('ffmpeg:set-cache-limit', limitGB),
  ffmpegClearVideoCache: (filePath) => ipcRenderer.invoke('ffmpeg:clear-video-cache', filePath),
  ffmpegClearAllCache: () => ipcRenderer.invoke('ffmpeg:clear-all-cache'),
  ffmpegGetSupportedCodecs: () => ipcRenderer.invoke('ffmpeg:get-supported-codecs'),
  ffmpegPreTranscode: (filePath) => ipcRenderer.invoke('ffmpeg:pre-transcode', filePath),
  onPreTranscodeProgress: (callback) => {
    ipcRenderer.on('ffmpeg:pre-transcode-progress', (event, data) => callback(data));
  },

  // ====== 협업 관련 ======
  readCollabFile: (filePath) => ipcRenderer.invoke('collab:read', filePath),
  writeCollabFile: (filePath, data) => ipcRenderer.invoke('collab:write', filePath, data),
  getFileStats: (filePath) => ipcRenderer.invoke('file:get-stats', filePath),

  // ====== 재생목록 관련 ======
  readPlaylist: (filePath) => ipcRenderer.invoke('playlist:read', filePath),
  writePlaylist: (filePath, data) => ipcRenderer.invoke('playlist:write', filePath, data),
  deletePlaylist: (filePath) => ipcRenderer.invoke('playlist:delete', filePath),
  generatePlaylistLink: (playlistPath) => ipcRenderer.invoke('playlist:generate-link', playlistPath),
  scanPlaylistsInFolder: (folderPath) => ipcRenderer.invoke('playlist:scan-folder', folderPath),

  // ====== 영상 썸네일 관련 (재생목록용) ======
  generateVideoThumbnail: (videoPath) => ipcRenderer.invoke('thumbnail:generate-video', videoPath),
  checkVideoThumbnail: (videoPath) => ipcRenderer.invoke('thumbnail:check-video-thumb', videoPath),
  getVideoThumbnailPath: (videoPath) => ipcRenderer.invoke('thumbnail:get-video-thumb-path', videoPath),

  // ====== 경로 유틸리티 ======
  pathDirname: (filePath) => ipcRenderer.invoke('path:dirname', filePath),
  pathBasename: (filePath) => ipcRenderer.invoke('path:basename', filePath),
  pathJoin: (...paths) => ipcRenderer.invoke('path:join', ...paths),

  // ====== 파일 감시 (실시간 동기화) ======
  watchFileStart: (filePath) => ipcRenderer.invoke('file:watch-start', filePath),
  watchFileStop: (filePath) => ipcRenderer.invoke('file:watch-stop', filePath),
  watchFileStopAll: () => ipcRenderer.invoke('file:watch-stop-all'),

  // ====== 이벤트 리스너 ======
  onOpenFromProtocol: (callback) => {
    ipcRenderer.on('open-from-protocol', (event, arg) => callback(arg));
  },
  onRequestSaveBeforeQuit: (callback) => {
    ipcRenderer.on('app:request-save-before-quit', () => callback());
  },
  onTranscodeProgress: (callback) => {
    ipcRenderer.on('ffmpeg:transcode-progress', (event, data) => callback(data));
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file:changed', (event, data) => callback(data));
  },
  onOpenPlaylist: (callback) => {
    ipcRenderer.on('open-playlist', (event, path) => callback(path));
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
