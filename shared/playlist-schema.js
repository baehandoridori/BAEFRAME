/**
 * BAEFRAME 재생목록 스키마 정의
 *
 * 이 파일은 .bplaylist 파일의 스키마를 정의하는 단일 소스입니다.
 * 여러 영상을 묶어서 공유하는 재생목록 기능을 위한 데이터 구조입니다.
 *
 * @version 1.0
 */

// ============================================================================
// 버전 상수
// ============================================================================

/**
 * 현재 .bplaylist 스키마 버전
 */
export const PLAYLIST_VERSION = '1.0';

/**
 * 지원하는 이전 버전 목록 (마이그레이션 가능)
 */
export const SUPPORTED_PLAYLIST_VERSIONS = ['1.0'];

/**
 * 재생목록 최대 항목 수
 */
export const MAX_PLAYLIST_ITEMS = 50;

/**
 * 지원하는 비디오 확장자
 */
export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

// ============================================================================
// 스키마 정의 (TypeScript 스타일 JSDoc)
// ============================================================================

/**
 * @typedef {Object} PlaylistItem
 * @property {string} id - 고유 ID (item_timestamp_random)
 * @property {string} videoPath - 영상 파일 전체 경로
 * @property {string} bframePath - .bframe 파일 경로 (없으면 빈 문자열)
 * @property {string} fileName - 표시용 파일명
 * @property {string} thumbnailPath - 썸네일 캐시 경로
 * @property {number} order - 정렬 순서 (0부터 시작)
 * @property {string} addedAt - 추가 시각 (ISO 8601)
 */

/**
 * @typedef {Object} PlaylistSettings
 * @property {boolean} autoPlay - 자동 재생 여부
 * @property {boolean} floatingMode - 플로팅 모드 여부
 */

/**
 * @typedef {Object} PlaylistData
 * @property {string} playlistVersion - 스키마 버전 ("1.0")
 * @property {string} name - 재생목록 이름
 * @property {string} id - 재생목록 고유 ID
 * @property {string} createdAt - 생성 시각 (ISO 8601)
 * @property {string} modifiedAt - 수정 시각 (ISO 8601)
 * @property {string} createdBy - 생성자 이름
 * @property {string} createdById - 생성자 ID
 * @property {Array<PlaylistItem>} items - 재생목록 항목들 (최대 50개)
 * @property {PlaylistSettings} settings - 재생목록 설정
 */

// ============================================================================
// 기본값 생성 함수
// ============================================================================

/**
 * 고유 ID 생성
 * @param {string} [prefix='id'] - ID 접두사
 * @returns {string}
 */
export function generatePlaylistId(prefix = 'playlist') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 아이템 ID 생성
 * @returns {string}
 */
export function generateItemId() {
  return generatePlaylistId('item');
}

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
 * 기본 재생목록 데이터 생성
 * @param {Object} [options]
 * @param {string} [options.name='새 재생목록'] - 재생목록 이름
 * @param {string} [options.userName=''] - 생성자 이름
 * @param {string} [options.userId=''] - 생성자 ID
 * @returns {PlaylistData}
 */
export function createDefaultPlaylistData(options = {}) {
  const now = new Date().toISOString();

  return {
    playlistVersion: PLAYLIST_VERSION,
    name: options.name || '새 재생목록',
    id: generatePlaylistId(),
    createdAt: now,
    modifiedAt: now,
    createdBy: options.userName || '',
    createdById: options.userId || '',
    items: [],
    settings: {
      autoPlay: false,
      floatingMode: false
    }
  };
}

/**
 * 재생목록 아이템 생성
 * @param {string} videoPath - 영상 파일 경로
 * @param {string} [bframePath=''] - .bframe 파일 경로
 * @returns {PlaylistItem}
 */
export function createPlaylistItem(videoPath, bframePath = '') {
  const fileName = extractFileName(videoPath);

  return {
    id: generateItemId(),
    videoPath: videoPath,
    bframePath: bframePath,
    fileName: fileName,
    thumbnailPath: '',
    order: 0,
    addedAt: new Date().toISOString()
  };
}

// ============================================================================
// 검증 함수
// ============================================================================

/**
 * 재생목록 데이터 유효성 검증
 * @param {Object} data - 검증할 데이터
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePlaylistData(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['데이터가 객체가 아닙니다.'] };
  }

  // 필수 필드 검증
  if (!data.playlistVersion) {
    errors.push('playlistVersion 필드가 없습니다.');
  } else if (!SUPPORTED_PLAYLIST_VERSIONS.includes(data.playlistVersion)) {
    errors.push(`지원하지 않는 버전입니다: ${data.playlistVersion}`);
  }

  if (!data.id) {
    errors.push('id 필드가 없습니다.');
  }

  if (!data.name || typeof data.name !== 'string') {
    errors.push('name 필드가 유효하지 않습니다.');
  }

  // items 배열 검증
  if (!Array.isArray(data.items)) {
    errors.push('items 필드가 배열이 아닙니다.');
  } else {
    if (data.items.length > MAX_PLAYLIST_ITEMS) {
      errors.push(`항목 수가 최대 허용 개수(${MAX_PLAYLIST_ITEMS})를 초과합니다.`);
    }

    // 각 아이템 검증
    data.items.forEach((item, index) => {
      if (!item.id) {
        errors.push(`items[${index}]: id 필드가 없습니다.`);
      }
      if (!item.videoPath) {
        errors.push(`items[${index}]: videoPath 필드가 없습니다.`);
      }
    });
  }

  // settings 검증
  if (data.settings && typeof data.settings !== 'object') {
    errors.push('settings 필드가 유효하지 않습니다.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 데이터 버전 확인
 * @param {Object} data - .bplaylist 데이터
 * @returns {string} 버전 문자열
 */
export function getPlaylistVersion(data) {
  if (!data || typeof data !== 'object') {
    return 'unknown';
  }

  if (data.playlistVersion) {
    return data.playlistVersion;
  }

  return 'unknown';
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

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 파일명 안전하게 변환 (특수문자 제거)
 * @param {string} name - 원본 이름
 * @returns {string} 안전한 파일명
 */
export function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || '재생목록';
}

/**
 * 재생목록 파일 저장 경로 생성
 * 첫 번째 영상과 같은 폴더에 저장
 * @param {PlaylistData} playlist - 재생목록 데이터
 * @returns {string|null} 저장 경로 또는 null (아이템이 없으면)
 */
export function getPlaylistSavePath(playlist) {
  if (!playlist || !playlist.items || playlist.items.length === 0) {
    return null;
  }

  const firstItemPath = playlist.items[0].videoPath;
  const normalized = firstItemPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const folderPath = lastSlash > 0 ? normalized.substring(0, lastSlash) : '.';

  const safeFileName = sanitizeFileName(playlist.name);
  return `${folderPath}/${safeFileName}.bplaylist`;
}

/**
 * 경로에서 폴더 경로 추출
 * @param {string} filePath - 파일 경로
 * @returns {string} 폴더 경로
 */
export function extractFolderPath(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : '';
}

// ============================================================================
// 내보내기
// ============================================================================

export default {
  PLAYLIST_VERSION,
  SUPPORTED_PLAYLIST_VERSIONS,
  MAX_PLAYLIST_ITEMS,
  SUPPORTED_VIDEO_EXTENSIONS,
  generatePlaylistId,
  generateItemId,
  extractFileName,
  createDefaultPlaylistData,
  createPlaylistItem,
  validatePlaylistData,
  getPlaylistVersion,
  isValidVideoFile,
  sanitizeFileName,
  getPlaylistSavePath,
  extractFolderPath
};
