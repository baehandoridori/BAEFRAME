/**
 * baeframe - Preload Script
 * Renderer에서 사용할 안전한 API 노출
 */

const { contextBridge, ipcRenderer } = require('electron');

const MPV_OVERLAY_KEYBOARD_CHANNEL = 'mpv-overlay:keyboard-input';
const MPV_OVERLAY_POINTER_PRESENCE_CHANNEL = 'mpv-overlay:pointer-presence';
const MPV_OVERLAY_COLLABORATION_ACTION_CHANNEL = 'mpv-overlay:collaboration-action';
const MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_CHANNEL =
  'mpv-overlay:drawing-pointerdown-frame-request';
const MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_KEYS = Object.freeze([
  'hostGeneration',
  'videoGeneration',
  'inputRevision',
  'sessionId',
  'pointerdownId',
  'pointerdownAt'
]);
const MPV_OVERLAY_COLLABORATION_ACTIONS = new Set([
  'collab.indicator-enter',
  'collab.indicator-leave',
  'collab.panel-enter',
  'collab.panel-leave',
  'collab.sync-status',
  'collab.cursor-toggle',
  'collab.open-sync',
  'sync.toggle',
  'sync.lead',
  'sync.follow',
  'sync.collapse',
  'sync.close',
  'sync.drag-start',
  'sync.drag-move',
  'sync.drag-end',
  'sync.drag-cancel'
]);
const MPV_OVERLAY_COLLABORATION_DRAG_ACTIONS = new Set([
  'sync.drag-start',
  'sync.drag-move',
  'sync.drag-end'
]);
const MPV_OVERLAY_NAMED_KEY_CODES = new Set([
  'Backspace', 'Tab', 'Enter', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'Escape', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Backquote',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'CapsLock', 'Semicolon',
  'Quote', 'Comma', 'Period', 'Slash', 'PrintScreen', 'ScrollLock', 'Pause', 'NumLock',
  'ContextMenu', 'IntlBackslash', 'IntlRo', 'IntlYen', 'Convert', 'NonConvert', 'KanaMode',
  'Lang1', 'Lang2', 'Lang3', 'Lang4', 'Lang5', 'Help', 'Again', 'Undo', 'Cut', 'Copy',
  'Paste', 'Find', 'Props', 'Select', 'Open', 'Eject', 'Power', 'WakeUp', 'BrowserBack',
  'BrowserForward', 'BrowserRefresh', 'BrowserStop', 'BrowserSearch', 'BrowserFavorites',
  'BrowserHome', 'AudioVolumeMute', 'AudioVolumeDown', 'AudioVolumeUp', 'MediaTrackNext',
  'MediaTrackPrevious', 'MediaStop', 'MediaPlayPause', 'MediaSelect', 'LaunchMail',
  'LaunchApp1', 'LaunchApp2'
]);
const MPV_OVERLAY_KEYBOARD_FIELDS = new Set([
  'type', 'key', 'code', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'repeat'
]);

function isMpvOverlayPhysicalKeyCode(code) {
  if (typeof code !== 'string' || code.length === 0 || code.length > 32) return false;
  if (/^Key[A-Z]$/.test(code) ||
      /^Digit[0-9]$/.test(code) ||
      /^F(?:[1-9]|1\d|2[0-4])$/.test(code) ||
      /^Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma|ParenLeft|ParenRight|Backspace|Clear|ClearEntry|MemoryAdd|MemoryClear|MemoryRecall|MemoryStore|MemorySubtract)$/.test(code)) {
    return true;
  }
  return MPV_OVERLAY_NAMED_KEY_CODES.has(code);
}

function normalizeMpvOverlayKeyboardInput(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields = Object.keys(value);
    if (fields.length !== MPV_OVERLAY_KEYBOARD_FIELDS.size ||
        fields.some(field => !MPV_OVERLAY_KEYBOARD_FIELDS.has(field))) {
      return null;
    }
    if (value.type !== 'keyDown' && value.type !== 'keyUp') return null;
    if (typeof value.key !== 'string' ||
        value.key.length === 0 ||
        value.key.length > 64 ||
        value.key.includes('\u0000') ||
        ['Process', 'Dead', 'Unidentified'].includes(value.key) ||
        !isMpvOverlayPhysicalKeyCode(value.code) ||
        ['Process', 'Dead', 'Unidentified'].includes(value.code) ||
        typeof value.shiftKey !== 'boolean' ||
        typeof value.ctrlKey !== 'boolean' ||
        typeof value.altKey !== 'boolean' ||
        typeof value.metaKey !== 'boolean' ||
        typeof value.repeat !== 'boolean') {
      return null;
    }
    return {
      type: value.type,
      key: value.key,
      code: value.code,
      shiftKey: value.shiftKey,
      ctrlKey: value.ctrlKey,
      altKey: value.altKey,
      metaKey: value.metaKey,
      repeat: value.repeat
    };
  } catch (_error) {
    return null;
  }
}

function normalizeMpvOverlayPointerPresence(value) {
  if (value === null) return null;
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const fields = Object.keys(value);
    if (fields.length !== 2 || !fields.includes('x') || !fields.includes('y') ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        value.x < 0 || value.x > 1 ||
        value.y < 0 || value.y > 1) {
      return undefined;
    }
    return { x: value.x, y: value.y };
  } catch (_error) {
    return undefined;
  }
}

function isExactPlainObject(value, keys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length &&
      ownKeys.every(key => typeof key === 'string' && keys.includes(key));
  } catch (_error) {
    return false;
  }
}

function normalizeMpvOverlayDrawingPointerdownFrame(value) {
  if (!isExactPlainObject(value, MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_KEYS) ||
      !Number.isSafeInteger(value.hostGeneration) || value.hostGeneration <= 0 ||
      !Number.isSafeInteger(value.videoGeneration) || value.videoGeneration <= 0 ||
      !Number.isSafeInteger(value.inputRevision) || value.inputRevision <= 0 ||
      typeof value.sessionId !== 'string' || value.sessionId.length === 0 ||
      value.sessionId.length > 256 ||
      typeof value.pointerdownId !== 'string' || value.pointerdownId.length === 0 ||
      value.pointerdownId.length > 256 ||
      !Number.isSafeInteger(value.pointerdownAt) || value.pointerdownAt < 0) {
    return null;
  }
  return {
    hostGeneration: value.hostGeneration,
    videoGeneration: value.videoGeneration,
    inputRevision: value.inputRevision,
    sessionId: value.sessionId,
    pointerdownId: value.pointerdownId,
    pointerdownAt: value.pointerdownAt
  };
}

function normalizeMpvOverlayCollaborationActionPayload(action, payload) {
  if (MPV_OVERLAY_COLLABORATION_DRAG_ACTIONS.has(action)) {
    if (!isExactPlainObject(payload, ['pointerId', 'clientX', 'clientY']) ||
        !Number.isSafeInteger(payload.pointerId) || payload.pointerId < 0 ||
        !Number.isFinite(payload.clientX) || Math.abs(payload.clientX) > 32768 ||
        !Number.isFinite(payload.clientY) || Math.abs(payload.clientY) > 32768) {
      return undefined;
    }
    return {
      pointerId: payload.pointerId,
      clientX: payload.clientX,
      clientY: payload.clientY
    };
  }
  if (action === 'sync.drag-cancel') {
    if (!isExactPlainObject(payload, ['pointerId']) ||
        !Number.isSafeInteger(payload.pointerId) || payload.pointerId < 0) {
      return undefined;
    }
    return { pointerId: payload.pointerId };
  }
  return payload === null ? null : undefined;
}

function normalizeMpvOverlayCollaborationAction(value) {
  try {
    const keys = [
      'action',
      'payload',
      'hostGeneration',
      'videoGeneration',
      'inputRevision',
      'activeSessionId',
      'sequence'
    ];
    if (!isExactPlainObject(value, keys) ||
        typeof value.action !== 'string' ||
        !MPV_OVERLAY_COLLABORATION_ACTIONS.has(value.action) ||
        !Number.isSafeInteger(value.hostGeneration) || value.hostGeneration < 0 ||
        !Number.isSafeInteger(value.videoGeneration) || value.videoGeneration < 0 ||
        !Number.isSafeInteger(value.inputRevision) || value.inputRevision < 0 ||
        typeof value.activeSessionId !== 'string' ||
        value.activeSessionId.length === 0 || value.activeSessionId.length > 32768 ||
        !Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
      return null;
    }
    const payload = normalizeMpvOverlayCollaborationActionPayload(
      value.action,
      value.payload
    );
    if (payload === undefined) return null;
    return {
      action: value.action,
      payload,
      hostGeneration: value.hostGeneration,
      videoGeneration: value.videoGeneration,
      inputRevision: value.inputRevision,
      activeSessionId: value.activeSessionId,
      sequence: value.sequence
    };
  } catch (_error) {
    return null;
  }
}

// Renderer에 노출할 API
contextBridge.exposeInMainWorld('electronAPI', {
  // ====== 파일 관련 ======
  openFileDialog: (options) => ipcRenderer.invoke('file:open-dialog', options),
  getFileInfo: (filePath) => ipcRenderer.invoke('file:get-info', filePath),
  saveReview: (filePath, data, options = {}) => ipcRenderer.invoke('file:save-review', filePath, data, options),
  loadReview: (filePath) => ipcRenderer.invoke('file:load-review', filePath),
  loadReviewSnapshot: (filePath) => ipcRenderer.invoke('file:load-review-snapshot', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  scanVersions: (filePath) => ipcRenderer.invoke('file:scan-versions', filePath),

  // ====== 윈도우 관련 ======
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen'),
  focusMainWindow: () => ipcRenderer.invoke('window:focus-main'),

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
  clipboardHasImage: () => ipcRenderer.invoke('clipboard:has-image'),
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

  // ====== 최근 파일 관련 ======
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentAdd: (input) => ipcRenderer.invoke('recent:add', input),
  recentRemove: (id) => ipcRenderer.invoke('recent:remove', id),
  recentClear: () => ipcRenderer.invoke('recent:clear'),
  recentTogglePin: (id) => ipcRenderer.invoke('recent:togglePin', id),
  recentPruneMissing: () => ipcRenderer.invoke('recent:pruneMissing'),
  recentOpenInFolder: (filePath) => ipcRenderer.invoke('recent:openInFolder', filePath),
  recentCaptureThumb: (videoPath, id, durationSec) =>
    ipcRenderer.invoke('recent:captureThumb', videoPath, id, durationSec),
  recentGetThumbUrl: (id) => ipcRenderer.invoke('recent:getThumbUrl', id),

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
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ffmpeg:pre-transcode-progress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:pre-transcode-progress', listener);
  },

  // ====== MPV 파일럿 관련 ======
  getFabricDrawingPilotState: () => ipcRenderer.invoke('fabric-drawing:get-pilot-state'),
  mpvIsEnabled: () => ipcRenderer.invoke('mpv:is-enabled'),
  mpvIsAvailable: () => ipcRenderer.invoke('mpv:is-available'),
  mpvLoad: (filePath, options) => ipcRenderer.invoke('mpv:load', filePath, options),
  mpvProbeMetadata: (filePath) => ipcRenderer.invoke('mpv:probe-metadata', filePath),
  mpvPlay: () => ipcRenderer.invoke('mpv:play'),
  mpvPause: () => ipcRenderer.invoke('mpv:pause'),
  mpvSeek: (time) => ipcRenderer.invoke('mpv:seek', time),
  mpvSetVolume: (volume) => ipcRenderer.invoke('mpv:set-volume', volume),
  mpvSetMuted: (muted) => ipcRenderer.invoke('mpv:set-muted', muted),
  mpvSetVideoTransform: (transform) => ipcRenderer.invoke('mpv:set-video-transform', transform),
  mpvGetStatus: () => ipcRenderer.invoke('mpv:get-status'),
  mpvScreenshot: () => ipcRenderer.invoke('mpv:screenshot'),
  mpvStop: () => ipcRenderer.invoke('mpv:stop'),
  mpvPrepareEmbed: (bounds) => ipcRenderer.invoke('mpv:prepare-embed', bounds),
  mpvUpdateEmbedBounds: (bounds) => ipcRenderer.invoke('mpv:update-embed-bounds', bounds),
  mpvSetHostVisible: (visible) => ipcRenderer.invoke('mpv:set-host-visible', visible),
  mpvDestroyEmbed: () => ipcRenderer.invoke('mpv:destroy-embed'),
  mpvPrepareOverlay: (bounds) => ipcRenderer.invoke('mpv:prepare-overlay', bounds),
  mpvUpdateOverlayBounds: (bounds) => ipcRenderer.invoke('mpv:update-overlay-bounds', bounds),
  mpvUpdateOverlayState: (state) => ipcRenderer.invoke('mpv:update-overlay-state', state),
  mpvUpdateOverlayRemoteCursors: (state) => ipcRenderer.invoke('mpv:update-overlay-remote-cursors', state),
  mpvUpdateOverlayCollaboration: (state) => ipcRenderer.invoke('mpv:update-overlay-collaboration', state),
  mpvTriggerOverlayCollabRipple: (state) => ipcRenderer.invoke('mpv:trigger-overlay-collab-ripple', state),
  mpvSetOverlayDrawingInput: (request) => ipcRenderer.invoke('mpv:set-overlay-drawing-input', request),
  mpvUpdateOverlayDrawingTool: (request) => ipcRenderer.invoke('mpv:update-overlay-drawing-tool', request),
  mpvUpdateOverlayDrawingBrush: (request) => ipcRenderer.invoke('mpv:update-overlay-drawing-brush', request),
  mpvUpdateOverlayDrawingLayerView: (request) =>
    ipcRenderer.invoke('mpv:update-overlay-drawing-layer-view', request),
  mpvUpdateOverlayDrawingFrame: (request) => ipcRenderer.invoke('mpv:update-overlay-drawing-frame', request),
  mpvApplyOverlayDrawingAction: (request) => ipcRenderer.invoke('mpv:apply-overlay-drawing-action', request),
  mpvConfirmOverlayDrawingPointerdownFrame: (request) =>
    ipcRenderer.invoke('mpv:confirm-overlay-drawing-pointerdown-frame', request),
  mpvPresentOverlayDrawingFrame: (request) => ipcRenderer.invoke('mpv:present-overlay-drawing-frame', request),
  mpvGetOverlayDrawingDiagnostics: () => ipcRenderer.invoke('mpv:get-overlay-drawing-diagnostics'),
  mpvHydrateOverlayDrawingVideo: (request) => ipcRenderer.invoke('mpv:hydrate-overlay-drawing-video', request),
  mpvExportOverlayDrawingVideo: (request) => ipcRenderer.invoke('mpv:export-overlay-drawing-video', request),
  onMpvOverlayKeyboardInput: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, input) => {
      const normalized = normalizeMpvOverlayKeyboardInput(input);
      if (normalized) callback(normalized);
    };
    ipcRenderer.on(MPV_OVERLAY_KEYBOARD_CHANNEL, listener);
    return () => ipcRenderer.removeListener(MPV_OVERLAY_KEYBOARD_CHANNEL, listener);
  },
  onMpvOverlayPointerPresence: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, presence) => {
      const normalized = normalizeMpvOverlayPointerPresence(presence);
      if (normalized !== undefined) callback(normalized);
    };
    ipcRenderer.on(MPV_OVERLAY_POINTER_PRESENCE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(MPV_OVERLAY_POINTER_PRESENCE_CHANNEL, listener);
  },
  onMpvOverlayDrawingPointerdownFrame: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, value) => {
      const request = normalizeMpvOverlayDrawingPointerdownFrame(value);
      if (request) callback(request);
    };
    ipcRenderer.on(MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_CHANNEL, listener);
    return () => ipcRenderer.removeListener(
      MPV_OVERLAY_DRAWING_POINTERDOWN_FRAME_CHANNEL,
      listener
    );
  },
  onMpvOverlayCollaborationAction: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, message) => {
      const normalized = normalizeMpvOverlayCollaborationAction(message);
      if (normalized) callback(normalized);
    };
    ipcRenderer.on(MPV_OVERLAY_COLLABORATION_ACTION_CHANNEL, listener);
    return () => ipcRenderer.removeListener(
      MPV_OVERLAY_COLLABORATION_ACTION_CHANNEL,
      listener
    );
  },
  onFabricDrawingPersistenceEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (event, message) => callback(message);
    ipcRenderer.on('fabric-drawing:persistence-event', listener);
    return () => ipcRenderer.removeListener('fabric-drawing:persistence-event', listener);
  },
  mpvDestroyOverlay: () => ipcRenderer.invoke('mpv:destroy-overlay'),

  // ====== 파일 관련 (유틸리티) ======
  readBinaryFile: (filePath) => ipcRenderer.invoke('file:read-binary', filePath),
  getFileStats: (filePath) => ipcRenderer.invoke('file:get-stats', filePath),

  // ====== 오디오 웨이브폼 ======
  generateAudioWaveform: (filePath, barCount) => ipcRenderer.invoke('audio:generate-waveform', filePath, barCount),

  // ====== 재생목록 관련 ======
  readPlaylist: (filePath) => ipcRenderer.invoke('playlist:read', filePath),
  writePlaylist: (filePath, data) => ipcRenderer.invoke('playlist:write', filePath, data),
  deletePlaylist: (filePath) => ipcRenderer.invoke('playlist:delete', filePath),
  generatePlaylistLink: (playlistPath) => ipcRenderer.invoke('playlist:generate-link', playlistPath),
  scanPlaylistsInFolder: (folderPath) => ipcRenderer.invoke('playlist:scan-folder', folderPath),

  // ====== 컷 묶음 관련 ======
  readCutlist: (filePath) => ipcRenderer.invoke('cutlist:read', filePath),
  writeCutlist: (filePath, data) => ipcRenderer.invoke('cutlist:write', filePath, data),
  deleteCutlist: (filePath) => ipcRenderer.invoke('cutlist:delete', filePath),
  readCutlistInfoText: (filePath) => ipcRenderer.invoke('cutlist:read-info-text', filePath),
  generateCutlistLink: (cutlistPath) => ipcRenderer.invoke('cutlist:generate-link', cutlistPath),

  // ====== 영상 썸네일 관련 (재생목록용) ======
  generateVideoThumbnail: (videoPath) => ipcRenderer.invoke('thumbnail:generate-video', videoPath),
  checkVideoThumbnail: (videoPath) => ipcRenderer.invoke('thumbnail:check-video-thumb', videoPath),
  getVideoThumbnailPath: (videoPath) => ipcRenderer.invoke('thumbnail:get-video-thumb-path', videoPath),

  // ====== Slack 웹훅 ======
  sendSlackWebhook: (url, payload) => ipcRenderer.invoke('slack:send-webhook', url, payload),

  // ====== 경로 유틸리티 ======
  pathDirname: (filePath) => ipcRenderer.invoke('path:dirname', filePath),
  pathBasename: (filePath) => ipcRenderer.invoke('path:basename', filePath),
  pathJoin: (...paths) => ipcRenderer.invoke('path:join', ...paths),

  // ====== 파일 감시 (실시간 동기화) ======
  watchFileStart: (filePath) => ipcRenderer.invoke('file:watch-start', filePath),
  watchFileStop: (filePath) => ipcRenderer.invoke('file:watch-stop', filePath),
  watchFileStopAll: () => ipcRenderer.invoke('file:watch-stop-all'),

  // renderer 초기화 완료 알림
  notifyRendererReady: () => ipcRenderer.send('renderer-ready'),

  // ====== 이벤트 리스너 ======
  onOpenFromProtocol: (callback) => {
    ipcRenderer.on('open-from-protocol', (event, arg, commentId) => callback(arg, commentId));
  },
  onRequestSaveBeforeQuit: (callback) => {
    ipcRenderer.on('app:request-save-before-quit', () => callback());
  },
  onTranscodeProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ffmpeg:transcode-progress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:transcode-progress', listener);
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file:changed', (event, data) => callback(data));
  },
  onOpenPlaylist: (callback) => {
    ipcRenderer.on('open-playlist', (event, path) => callback(path));
  },
  onOpenCutlist: (callback) => {
    ipcRenderer.on('open-cutlist', (event, path) => callback(path));
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
