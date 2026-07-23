/**
 * .bframe 최상위 envelope 호환성 유틸리티.
 *
 * 현재 앱이 이해하지 못하는 최상위 필드는 opaque 데이터로 분리한 뒤
 * 저장 시 canonical known 필드와 다시 합쳐 데이터 손실을 막는다.
 */

export const KNOWN_BFRAME_ROOT_FIELDS = Object.freeze([
  'bframeVersion',
  'version',
  'reviewDocumentId',
  'videoFile',
  'videoPath',
  'fps',
  'createdAt',
  'modifiedAt',
  'liveblocksRoomId',
  'versionInfo',
  'manualVersions',
  'versions',
  'comments',
  'drawings',
  'highlights',
  'compositionLayers'
]);

const KNOWN_BFRAME_ROOT_FIELD_SET = new Set(KNOWN_BFRAME_ROOT_FIELDS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRootObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 현재 앱이 알지 못하는 최상위 필드만 추출한다.
 * `drawingsV3`는 의도적으로 unknown이므로 그대로 포함된다.
 *
 * @param {Object} root
 * @returns {Object}
 */
export function extractOpaqueBframeRoot(root) {
  if (!isRootObject(root)) return {};

  return Object.fromEntries(
    Object.entries(root).filter(([key]) => !KNOWN_BFRAME_ROOT_FIELD_SET.has(key))
  );
}

/**
 * opaque 최상위 데이터에 canonical known 필드를 덮어쓴다.
 * opaque 입력에 known 키가 잘못 섞여 있어도 되살리지 않는다.
 *
 * @param {Object} opaqueRoot
 * @param {Object} knownRoot
 * @returns {Object}
 */
export function mergeBframeRoot(opaqueRoot, knownRoot) {
  const canonicalKnownRoot = isRootObject(knownRoot)
    ? Object.fromEntries(
      Object.entries(knownRoot).filter(([key]) => KNOWN_BFRAME_ROOT_FIELD_SET.has(key))
    )
    : {};

  return {
    ...extractOpaqueBframeRoot(opaqueRoot),
    ...canonicalKnownRoot
  };
}

function parseVersionMajor(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^(\d+)(?:\.\d+)*$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

/**
 * 현재 버전보다 큰 top-level major를 반환한다.
 * 같은 major의 minor 차이와 이전 버전은 마이그레이션 가능 범위다.
 * 명시된 버전을 해석할 수 없으면 fail-closed 신호로 NaN을 반환한다.
 *
 * @param {*} version
 * @param {*} currentVersion
 * @param {boolean} [allowLegacy=false] 버전 필드가 실제로 없을 때만 true
 * @returns {number|null}
 */
export function getUnsupportedBframeMajor(version, currentVersion, allowLegacy = false) {
  if (allowLegacy && version === 'legacy') return null;

  const versionMajor = parseVersionMajor(version);
  const currentMajor = parseVersionMajor(currentVersion);

  if (versionMajor === null || currentMajor === null) {
    return Number.NaN;
  }

  if (versionMajor <= currentMajor) {
    return null;
  }

  return versionMajor;
}

/**
 * reviewDocumentId가 canonical 계보 ID 형식인지 확인한다.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isValidReviewDocumentId(value) {
  if (typeof value !== 'string' || !value.startsWith('reviewdoc-')) return false;
  return UUID_PATTERN.test(value.slice('reviewdoc-'.length));
}

/**
 * 안정적인 리뷰 문서 ID를 생성한다.
 *
 * @param {Function} [randomUUID]
 * @returns {string}
 */
export function createReviewDocumentId(randomUUID) {
  const uuidFactory = randomUUID || (() => globalThis.crypto?.randomUUID?.());
  if (typeof uuidFactory !== 'function') {
    throw new Error('reviewDocumentId 생성을 위한 randomUUID 함수가 필요합니다.');
  }

  const uuid = uuidFactory();
  const reviewDocumentId = `reviewdoc-${uuid}`;
  if (!isValidReviewDocumentId(reviewDocumentId)) {
    throw new Error('randomUUID가 유효한 UUID를 반환하지 않았습니다.');
  }

  return reviewDocumentId.toLowerCase();
}

/**
 * reviewDocumentId가 없는 root에만 새 ID를 추가한다.
 * 이미 존재하는 값은 유효하지 않아도 교체하지 않아 validator가 저장을 차단하게 한다.
 *
 * @param {Object} root
 * @param {Function} [randomUUID]
 * @returns {Object} 입력과 동일한 root 객체
 */
export function ensureReviewDocumentId(root, randomUUID) {
  if (!isRootObject(root)) {
    throw new TypeError('reviewDocumentId를 추가할 root 객체가 필요합니다.');
  }

  if (!Object.hasOwn(root, 'reviewDocumentId')) {
    root.reviewDocumentId = createReviewDocumentId(randomUUID);
  }

  return root;
}

export default {
  KNOWN_BFRAME_ROOT_FIELDS,
  extractOpaqueBframeRoot,
  mergeBframeRoot,
  getUnsupportedBframeMajor,
  isValidReviewDocumentId,
  createReviewDocumentId,
  ensureReviewDocumentId
};
