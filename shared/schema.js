/**
 * BAEFRAME 스키마 정의 - 단일 소스
 *
 * 이 파일은 .bframe 파일의 스키마를 정의하는 단일 소스입니다.
 * 모든 스키마 관련 코드는 이 파일을 참조해야 합니다.
 *
 * @version 2.0
 */

// ============================================================================
// 버전 상수
// ============================================================================

/**
 * 현재 .bframe 스키마 버전
 */
export const BFRAME_VERSION = '2.0';

/**
 * 지원하는 이전 버전 목록 (마이그레이션 가능)
 */
export const SUPPORTED_VERSIONS = ['1.0', '2.0'];

/**
 * 지원하는 비디오 확장자
 */
export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

// ============================================================================
// 스키마 정의 (TypeScript 스타일 JSDoc)
// ============================================================================

/**
 * @typedef {Object} VersionInfo
 * @property {number|null} detectedVersion - 파일명에서 감지된 버전 번호
 * @property {string|null} originalSuffix - 원본 버전 접미사 (_v3, _re 등)
 * @property {string} baseName - 버전 정보를 제외한 기본 파일명
 */

/**
 * @typedef {Object} ManualVersion
 * @property {number} version - 수동 지정된 버전 번호
 * @property {string} fileName - 파일명
 * @property {string} filePath - 전체 파일 경로
 * @property {string} addedAt - 추가 시각 (ISO 8601)
 */

/**
 * @typedef {Object} CommentMarker
 * @property {string} id - 고유 ID
 * @property {number} frame - 프레임 번호
 * @property {string} timecode - 타임코드 (HH:MM:SS:FF)
 * @property {string} author - 작성자 이름
 * @property {string} authorId - 작성자 ID
 * @property {string} content - 댓글 내용
 * @property {boolean} resolved - 해결 여부
 * @property {string} createdAt - 생성 시각 (ISO 8601)
 * @property {string} updatedAt - 수정 시각 (ISO 8601)
 * @property {Array<Object>} drawings - 그리기 데이터
 * @property {Array<Object>} replies - 답글 목록
 */

/**
 * @typedef {Object} CommentLayer
 * @property {string} id - 레이어 ID
 * @property {string} name - 레이어 이름
 * @property {boolean} visible - 표시 여부
 * @property {Array<CommentMarker>} markers - 댓글 마커 목록
 */

/**
 * @typedef {Object} DrawingKeyframe
 * @property {number} frame - 프레임 번호
 * @property {Array<Object>} objects - 그리기 객체 목록
 */

/**
 * @typedef {Object} DrawingLayer
 * @property {string} id - 레이어 ID
 * @property {string} name - 레이어 이름
 * @property {boolean} visible - 표시 여부
 * @property {string} color - 레이어 색상
 * @property {Array<DrawingKeyframe>} keyframes - 키프레임 목록
 */

/**
 * @typedef {Object} Highlight
 * @property {number} startFrame - 시작 프레임
 * @property {number} endFrame - 종료 프레임
 * @property {string} color - 하이라이트 색상
 */

/**
 * @typedef {Object} BframeData
 * @property {string} bframeVersion - 스키마 버전 (예: "2.0")
 * @property {string} videoFile - 비디오 파일명 (확장자 포함)
 * @property {string} videoPath - 전체 파일 경로
 * @property {number} fps - 프레임 레이트
 * @property {string} createdAt - 생성 시각 (ISO 8601)
 * @property {string} modifiedAt - 수정 시각 (ISO 8601)
 * @property {VersionInfo} [versionInfo] - 버전 정보 (Phase 1 이후)
 * @property {Array<ManualVersion>} [manualVersions] - 수동 추가된 버전 목록
 * @property {Object} comments - 댓글 데이터 { layers: CommentLayer[] }
 * @property {Object} drawings - 그리기 데이터 { layers: DrawingLayer[] }
 * @property {Array<Highlight>} highlights - 하이라이트 목록
 */

// ============================================================================
// 기본값 생성 함수
// ============================================================================

/**
 * 기본 .bframe 데이터 생성
 * @param {Object} options
 * @param {string} options.videoPath - 비디오 파일 경로
 * @param {string} [options.videoFile] - 비디오 파일명 (없으면 경로에서 추출)
 * @param {number} [options.fps=24] - 프레임 레이트
 * @returns {BframeData}
 */
export function createDefaultBframeData(options = {}) {
  const now = new Date().toISOString();
  const videoFile = options.videoFile || extractFileName(options.videoPath);

  return {
    bframeVersion: BFRAME_VERSION,
    videoFile: videoFile,
    videoPath: options.videoPath || '',
    fps: options.fps || 24,
    createdAt: now,
    modifiedAt: now,
    versionInfo: null,
    manualVersions: [],
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: []
  };
}

/**
 * 기본 댓글 레이어 생성
 * @param {string} [id] - 레이어 ID (없으면 자동 생성)
 * @param {string} [name='기본 레이어'] - 레이어 이름
 * @returns {CommentLayer}
 */
export function createDefaultCommentLayer(id, name = '기본 레이어') {
  return {
    id: id || generateId('layer'),
    name: name,
    visible: true,
    markers: []
  };
}

/**
 * 기본 그리기 레이어 생성
 * @param {string} [id] - 레이어 ID
 * @param {string} [name='레이어 1'] - 레이어 이름
 * @param {string} [color='#ff4757'] - 레이어 색상
 * @returns {DrawingLayer}
 */
export function createDefaultDrawingLayer(id, name = '레이어 1', color = '#ff4757') {
  return {
    id: id || generateId('drawing'),
    name: name,
    visible: true,
    color: color,
    keyframes: []
  };
}

// ============================================================================
// 마이그레이션 함수
// ============================================================================

/**
 * 데이터 버전 확인
 * @param {Object} data - .bframe 데이터
 * @returns {string} 버전 문자열
 */
export function getDataVersion(data) {
  if (!data || typeof data !== 'object') {
    return 'unknown';
  }

  // v2.0: bframeVersion 필드 사용
  if (data.bframeVersion) {
    return data.bframeVersion;
  }

  // v1.0: version 필드 사용
  if (data.version) {
    return data.version;
  }

  // 레거시: 버전 필드 없음
  return 'legacy';
}

/**
 * 데이터가 마이그레이션이 필요한지 확인
 * @param {Object} data - .bframe 데이터
 * @returns {boolean}
 */
export function needsMigration(data) {
  const version = getDataVersion(data);
  return version !== BFRAME_VERSION;
}

/**
 * v1.0 또는 레거시 데이터를 v2.0으로 마이그레이션
 * @param {Object} data - 원본 데이터
 * @returns {BframeData} 마이그레이션된 데이터
 */
export function migrateToV2(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('유효하지 않은 데이터: 객체가 아닙니다.');
  }

  const version = getDataVersion(data);
  const now = new Date().toISOString();

  // 이미 v2.0인 경우
  if (version === BFRAME_VERSION) {
    return data;
  }

  // 마이그레이션 시작
  const migrated = {
    // 새 버전 표시
    bframeVersion: BFRAME_VERSION,

    // 비디오 정보 정규화
    videoFile: data.videoFile || extractFileName(data.videoPath) || '',
    videoPath: data.videoPath || '',
    fps: typeof data.fps === 'number' ? data.fps : 24,

    // 시간 정보
    createdAt: data.createdAt || now,
    modifiedAt: now,

    // 버전 관리 필드 (신규)
    versionInfo: null,
    manualVersions: [],

    // 댓글 데이터 마이그레이션
    comments: migrateComments(data.comments),

    // 그리기 데이터 마이그레이션
    drawings: migrateDrawings(data.drawings),

    // 하이라이트
    highlights: Array.isArray(data.highlights) ? data.highlights : []
  };

  // versions 필드가 있었다면 manualVersions로 변환 (문서 기반 레거시)
  if (Array.isArray(data.versions)) {
    migrated.manualVersions = data.versions.map((v) => ({
      version: v.version || 0,
      fileName: v.filename || v.fileName || '',
      filePath: '',
      addedAt: v.createdAt || now
    }));
  }

  return migrated;
}

/**
 * 댓글 데이터 마이그레이션
 * @param {Object|Array} comments - 원본 댓글 데이터
 * @returns {Object} { layers: CommentLayer[] }
 */
function migrateComments(comments) {
  // 이미 새 형식인 경우
  if (comments && typeof comments === 'object' && Array.isArray(comments.layers)) {
    return comments;
  }

  // 배열 형식 (레거시 문서 형식)인 경우
  if (Array.isArray(comments)) {
    return {
      layers: [
        {
          id: 'layer_default',
          name: '기본 레이어',
          visible: true,
          markers: comments.map((c) => ({
            ...c,
            id: c.id || generateId('comment'),
            replies: c.replies || []
          }))
        }
      ]
    };
  }

  // 없거나 유효하지 않은 경우
  return { layers: [] };
}

/**
 * 그리기 데이터 마이그레이션
 * @param {Object} drawings - 원본 그리기 데이터
 * @returns {Object} { layers: DrawingLayer[] }
 */
function migrateDrawings(drawings) {
  // 이미 새 형식인 경우
  if (drawings && typeof drawings === 'object' && Array.isArray(drawings.layers)) {
    return drawings;
  }

  // 없거나 유효하지 않은 경우
  return { layers: [] };
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 파일 경로에서 파일명 추출 (확장자 포함)
 * @param {string} filePath - 파일 경로
 * @returns {string} 파일명
 */
export function extractFileName(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * 파일 경로에서 확장자 제외한 파일명 추출
 * @param {string} filePath - 파일 경로
 * @returns {string} 확장자 제외 파일명
 */
export function extractFileNameWithoutExt(filePath) {
  const fileName = extractFileName(filePath);
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
}

/**
 * 고유 ID 생성
 * @param {string} [prefix='id'] - ID 접두사
 * @returns {string}
 */
export function generateId(prefix = 'id') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 지원하는 비디오 파일인지 확인
 * @param {string} filePath - 파일 경로
 * @returns {boolean}
 */
export function isValidVideoFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;

  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
}

/**
 * 좌표가 유효한 범위(0~1)인지 확인
 * @param {number} value - 좌표 값
 * @returns {boolean}
 */
export function isValidCoordinate(value) {
  return typeof value === 'number' && value >= 0 && value <= 1;
}

// ============================================================================
// 내보내기
// ============================================================================

export default {
  BFRAME_VERSION,
  SUPPORTED_VERSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  createDefaultBframeData,
  createDefaultCommentLayer,
  createDefaultDrawingLayer,
  getDataVersion,
  needsMigration,
  migrateToV2,
  extractFileName,
  extractFileNameWithoutExt,
  generateId,
  isValidVideoFile,
  isValidCoordinate
};
