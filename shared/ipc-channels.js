/**
 * IPC 채널명 상수
 * Main <-> Renderer 간 통신에 사용
 */

// 파일 관련
export const FILE = {
  OPEN_DIALOG: 'file:open-dialog',
  OPEN_VIDEO: 'file:open-video',
  SAVE_REVIEW: 'file:save-review',
  LOAD_REVIEW: 'file:load-review',
  GET_FILE_INFO: 'file:get-info',
  WATCH_FILE: 'file:watch',
  UNWATCH_FILE: 'file:unwatch'
};

// 윈도우 관련
export const WINDOW = {
  MINIMIZE: 'window:minimize',
  MAXIMIZE: 'window:maximize',
  CLOSE: 'window:close',
  IS_MAXIMIZED: 'window:is-maximized'
};

// 앱 관련
export const APP = {
  GET_VERSION: 'app:get-version',
  GET_PATH: 'app:get-path',
  QUIT: 'app:quit'
};

// 로그 관련
export const LOG = {
  WRITE: 'log:write',
  READ: 'log:read',
  CLEAR: 'log:clear'
};

// 설정 관련
export const SETTINGS = {
  GET: 'settings:get',
  SET: 'settings:set',
  GET_ALL: 'settings:get-all'
};

// 프로토콜/링크 관련
export const LINK = {
  COPY: 'link:copy',
  OPEN: 'link:open',
  REGISTER_PROTOCOL: 'link:register-protocol'
};

// mpv 관련
export const MPV = {
  INIT: 'mpv:init',
  LOAD: 'mpv:load',
  PLAY: 'mpv:play',
  PAUSE: 'mpv:pause',
  SEEK: 'mpv:seek',
  SEEK_FRAME: 'mpv:seek-frame',
  GET_POSITION: 'mpv:get-position',
  GET_DURATION: 'mpv:get-duration',
  ON_TIME_UPDATE: 'mpv:on-time-update',
  ON_END: 'mpv:on-end',
  ON_ERROR: 'mpv:on-error'
};
