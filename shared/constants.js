/**
 * baeframe 전역 상수 정의
 */

// 앱 정보
export const APP_NAME = 'baeframe';
export const APP_VERSION = '1.0.0-dev';

// 로그 레벨
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// 기본 FPS
export const DEFAULT_FPS = 24;

// 지원 파일 형식
export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
export const SUPPORTED_FORMATS = {
  video: SUPPORTED_VIDEO_EXTENSIONS,
  review: ['.review.json'],
  link: ['.baef']
};

// 그리기 도구
export const DRAWING_TOOLS = {
  PEN: 'pen',
  ARROW: 'arrow',
  CIRCLE: 'circle',
  RECTANGLE: 'rectangle'
};

// 그리기 색상
export const DRAWING_COLORS = {
  RED: '#ff4757',
  YELLOW: '#ffd000',
  GREEN: '#26de81',
  BLUE: '#4a9eff',
  WHITE: '#ffffff'
};

// 기본 선 굵기
export const DEFAULT_STROKE_WIDTH = 3;

// 자동 저장 딜레이 (ms)
export const AUTO_SAVE_DELAY = 2000;

// UI 기본값
export const UI_DEFAULTS = {
  panelWidth: 320,
  timelineHeight: 180,
  headerHeight: 48,
  controlsHeight: 52
};

// 댓글 필터
export const COMMENT_FILTERS = {
  ALL: 'all',
  UNRESOLVED: 'unresolved',
  RESOLVED: 'resolved'
};
