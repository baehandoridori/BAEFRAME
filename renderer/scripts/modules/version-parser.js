/**
 * 버전 파싱 모듈
 * 파일명에서 버전 정보를 추출하는 유틸리티
 *
 * 지원 패턴:
 * - _v1, _v02, _V3 → 버전 1, 2, 3
 * - _re, _RE → 버전 2 (리테이크 1회)
 * - _re2, _RE3 → 버전 3, 4 (리테이크 N회)
 * - _final, _FINAL → 버전 999 (최종)
 * - 버전 없음 → null
 *
 * @module version-parser
 */

import { createLogger } from '../logger.js';

const log = createLogger('VersionParser');

// ============================================================================
// 버전 패턴 정의
// ============================================================================

/**
 * 버전 패턴 목록 (우선순위 순서)
 * @type {Array<{regex: RegExp, extract: Function, suffix: Function, type: string}>}
 */
const VERSION_PATTERNS = [
  {
    // _v1, _v02, _V10 등
    regex: /_v(\d+)/i,
    extract: (match) => parseInt(match[1], 10),
    suffix: (match) => match[0],
    type: 'version'
  },
  {
    // _re2, _re3, _RE10 등 (리테이크 N회 = 버전 N+1)
    regex: /_re(\d+)/i,
    extract: (match) => parseInt(match[1], 10) + 1,
    suffix: (match) => match[0],
    type: 'retake'
  },
  {
    // _re, _RE (리테이크 1회 = 버전 2)
    regex: /_re$/i,
    extract: () => 2,
    suffix: () => '_re',
    type: 'retake'
  },
  {
    // _final, _FINAL (최종 버전 = 999)
    regex: /_final/i,
    extract: () => 999,
    suffix: (match) => match[0],
    type: 'final'
  }
];

/**
 * 최종 버전 상수
 */
export const FINAL_VERSION = 999;

// ============================================================================
// 메인 함수
// ============================================================================

/**
 * 파일명에서 버전 정보 파싱
 *
 * @param {string} fileName - 파일명 (확장자 포함 가능)
 * @returns {{
 *   version: number | null,
 *   baseName: string,
 *   suffix: string | null,
 *   displayLabel: string,
 *   type: string | null
 * }}
 *
 * @example
 * parseVersion('shot_001_v3.mp4')
 * // { version: 3, baseName: 'shot_001', suffix: '_v3', displayLabel: 'v3', type: 'version' }
 *
 * parseVersion('shot_001_re.mp4')
 * // { version: 2, baseName: 'shot_001', suffix: '_re', displayLabel: 'v2 (_re)', type: 'retake' }
 *
 * parseVersion('shot_001_final.mp4')
 * // { version: 999, baseName: 'shot_001', suffix: '_final', displayLabel: 'FINAL', type: 'final' }
 */
export function parseVersion(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return {
      version: null,
      baseName: '',
      suffix: null,
      displayLabel: '-',
      type: null
    };
  }

  // 확장자 제거
  const nameWithoutExt = removeExtension(fileName);

  // 패턴 매칭
  for (const pattern of VERSION_PATTERNS) {
    const match = nameWithoutExt.match(pattern.regex);
    if (match) {
      const version = pattern.extract(match);
      const suffix = pattern.suffix(match);
      const baseName = nameWithoutExt.replace(pattern.regex, '');

      return {
        version,
        baseName,
        suffix,
        displayLabel: formatDisplayLabel(version, suffix, pattern.type),
        type: pattern.type
      };
    }
  }

  // 버전 없음
  return {
    version: null,
    baseName: nameWithoutExt,
    suffix: null,
    displayLabel: '-',
    type: null
  };
}

/**
 * 파일명에서 기본 이름 추출 (버전 접미사 제거)
 *
 * @param {string} fileName - 파일명
 * @returns {string} 버전 접미사가 제거된 기본 이름
 *
 * @example
 * extractBaseName('shot_001_v3.mp4') // 'shot_001'
 * extractBaseName('shot_001_re2.mov') // 'shot_001'
 */
export function extractBaseName(fileName) {
  return parseVersion(fileName).baseName;
}

/**
 * 버전 정보를 versionInfo 객체로 변환
 * review-data-manager.js에서 사용하는 형식
 *
 * @param {string} fileName - 파일명
 * @returns {{
 *   detectedVersion: number | null,
 *   originalSuffix: string | null,
 *   baseName: string
 * }}
 */
export function toVersionInfo(fileName) {
  const parsed = parseVersion(fileName);

  return {
    detectedVersion: parsed.version,
    originalSuffix: parsed.suffix,
    baseName: parsed.baseName
  };
}

/**
 * 두 파일이 같은 시리즈(baseName)인지 확인
 *
 * @param {string} fileName1 - 첫 번째 파일명
 * @param {string} fileName2 - 두 번째 파일명
 * @returns {boolean}
 *
 * @example
 * isSameSeries('shot_001_v1.mp4', 'shot_001_v2.mp4') // true
 * isSameSeries('shot_001_v1.mp4', 'shot_002_v1.mp4') // false
 */
export function isSameSeries(fileName1, fileName2) {
  const base1 = extractBaseName(fileName1);
  const base2 = extractBaseName(fileName2);

  return base1 === base2 && base1 !== '';
}

/**
 * 버전 번호로 정렬 비교 함수
 * Array.sort()에 사용
 *
 * @param {Object} a - { version: number | null, ... }
 * @param {Object} b - { version: number | null, ... }
 * @returns {number}
 */
export function compareVersions(a, b) {
  const vA = a.version ?? -1;
  const vB = b.version ?? -1;
  return vA - vB;
}

/**
 * 파일명 배열을 버전순으로 정렬
 *
 * @param {string[]} fileNames - 파일명 배열
 * @returns {Array<{fileName: string, version: number | null, displayLabel: string}>}
 */
export function sortByVersion(fileNames) {
  return fileNames
    .map((fileName) => {
      const parsed = parseVersion(fileName);
      return {
        fileName,
        version: parsed.version,
        displayLabel: parsed.displayLabel
      };
    })
    .sort(compareVersions);
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * 파일명에서 확장자 제거
 * @param {string} fileName
 * @returns {string}
 */
function removeExtension(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot > 0) {
    return fileName.substring(0, lastDot);
  }
  return fileName;
}

/**
 * 버전을 표시 라벨로 포맷
 * @param {number} version
 * @param {string} suffix
 * @param {string} type
 * @returns {string}
 */
function formatDisplayLabel(version, suffix, type) {
  if (type === 'final') {
    return 'FINAL';
  }

  if (type === 'retake') {
    // v2 (_re) 형식
    return `v${version} (${suffix})`;
  }

  // 일반 버전
  return `v${version}`;
}

/**
 * 커스텀 버전 패턴 추가
 * 특수한 프로젝트 요구사항에 맞게 패턴 확장 가능
 *
 * @param {Object} pattern - 패턴 객체
 * @param {RegExp} pattern.regex - 정규식
 * @param {Function} pattern.extract - 버전 번호 추출 함수
 * @param {Function} pattern.suffix - 접미사 추출 함수
 * @param {string} pattern.type - 패턴 타입
 */
export function addPattern(pattern) {
  if (!pattern.regex || !pattern.extract || !pattern.suffix || !pattern.type) {
    log.warn('유효하지 않은 패턴', pattern);
    return;
  }

  // 우선순위: 최종 버전 패턴 앞에 삽입
  const finalIndex = VERSION_PATTERNS.findIndex((p) => p.type === 'final');
  if (finalIndex > -1) {
    VERSION_PATTERNS.splice(finalIndex, 0, pattern);
  } else {
    VERSION_PATTERNS.push(pattern);
  }

  log.info('패턴 추가됨', { type: pattern.type });
}

/**
 * 현재 등록된 패턴 목록 반환
 * @returns {Array}
 */
export function getPatterns() {
  return [...VERSION_PATTERNS];
}

// ============================================================================
// 내보내기
// ============================================================================

export default {
  parseVersion,
  extractBaseName,
  toVersionInfo,
  isSameSeries,
  compareVersions,
  sortByVersion,
  addPattern,
  getPatterns,
  FINAL_VERSION
};
