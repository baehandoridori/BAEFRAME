/**
 * 정적 배포되는 web-viewer 전용 .bframe write guard.
 * desktop shared codec과 같은 버전/ID 계약을 유지하되 외부 파일에 의존하지 않는다.
 */

export const BFRAME_VERSION = '2.0';

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

export function hasExplicitBframeVersion(root) {
  return isRootObject(root) && (
    Object.hasOwn(root, 'bframeVersion') || Object.hasOwn(root, 'version')
  );
}

export function getDataVersion(root) {
  if (!isRootObject(root)) return 'unknown';
  if (Object.hasOwn(root, 'bframeVersion')) return root.bframeVersion;
  if (Object.hasOwn(root, 'version')) return root.version;
  return 'legacy';
}

function parseVersionMajor(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^(\d+)(?:\.\d+)*$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function getUnsupportedBframeMajor(version, currentVersion, allowLegacy = false) {
  if (allowLegacy && version === 'legacy') return null;

  const versionMajor = parseVersionMajor(version);
  const currentMajor = parseVersionMajor(currentVersion);
  if (versionMajor === null || currentMajor === null) return Number.NaN;
  return versionMajor > currentMajor ? versionMajor : null;
}

export function isValidReviewDocumentId(value) {
  if (typeof value !== 'string' || !value.startsWith('reviewdoc-')) return false;
  return UUID_PATTERN.test(value.slice('reviewdoc-'.length));
}

export function extractOpaqueBframeRoot(root) {
  if (!isRootObject(root)) return {};
  return Object.fromEntries(
    Object.entries(root).filter(([key]) => !KNOWN_BFRAME_ROOT_FIELD_SET.has(key))
  );
}

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

export function mergeDriveBframeAfterWrite(committedRoot, currentLocalRoot) {
  if (!isRootObject(committedRoot) || !isRootObject(currentLocalRoot)) {
    throw new TypeError('저장된 Drive root와 현재 로컬 .bframe root 객체가 모두 필요합니다.');
  }

  return mergeBframeRoot(committedRoot, currentLocalRoot);
}

export function reconcileDriveBframeAfterWrite(committedRoot, currentLocalRoot) {
  const mergedRoot = mergeDriveBframeAfterWrite(committedRoot, currentLocalRoot);
  for (const key of Object.keys(currentLocalRoot)) {
    delete currentLocalRoot[key];
  }
  Object.assign(currentLocalRoot, mergedRoot);
  return currentLocalRoot;
}

export async function runContextBoundBframeLoad(context, operations) {
  const { isCurrent, load, commit } = operations;
  const assertCurrent = () => {
    if (!isCurrent(context)) {
      throw new Error('로드 대상 문서가 변경되어 이전 로드 결과를 적용하지 않았습니다.');
    }
  };

  assertCurrent();
  const loadedRoot = await load(context);
  assertCurrent();
  commit(loadedRoot, context);
  return loadedRoot;
}

export async function runContextBoundDriveSave(context, operations) {
  const {
    isCurrent,
    loadLatest,
    prepare,
    persist,
    commit
  } = operations;
  const assertCurrent = () => {
    if (!isCurrent(context)) {
      throw new Error('저장 대상 문서가 변경되어 이전 저장 요청을 중단했습니다.');
    }
  };

  assertCurrent();
  const latestRoot = await loadLatest(context);
  assertCurrent();
  const prepared = prepare(latestRoot, context);
  assertCurrent();
  await persist(prepared, context);

  if (!isCurrent(context)) {
    return { prepared, applied: false };
  }

  commit(prepared, context);
  return { prepared, applied: true };
}

export function createTrailingSingleFlight(run) {
  if (typeof run !== 'function') {
    throw new TypeError('single-flight 실행 함수가 필요합니다.');
  }

  let activeRequest = null;
  let trailingRequest = null;

  function createRequest(args) {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { args, promise, resolve, reject };
  }

  async function execute(request) {
    try {
      request.resolve(await run(...request.args));
    } catch (error) {
      request.reject(error);
    } finally {
      if (activeRequest !== request) return;

      if (trailingRequest) {
        const nextRequest = trailingRequest;
        trailingRequest = null;
        activeRequest = nextRequest;
        void execute(nextRequest);
      } else {
        activeRequest = null;
      }
    }
  }

  return function request(...args) {
    if (!activeRequest) {
      const nextRequest = createRequest(args);
      activeRequest = nextRequest;
      void execute(nextRequest);
      return nextRequest.promise;
    }

    if (!trailingRequest) {
      trailingRequest = createRequest(args);
    } else {
      trailingRequest.args = args;
    }
    return trailingRequest.promise;
  };
}

function bytesToUuid(bytes) {
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join('')
  ].join('-');
}

function createUuidV4(randomUUID) {
  if (typeof randomUUID === 'function') return randomUUID();
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytesToUuid(bytes);
  }
  throw new Error('reviewDocumentId를 생성할 안전한 난수 기능을 사용할 수 없습니다.');
}

export function prepareBframeForWrite(root, options = {}) {
  if (!isRootObject(root)) {
    throw new TypeError('저장할 .bframe root 객체가 필요합니다.');
  }

  const version = getDataVersion(root);
  const unsupportedMajor = getUnsupportedBframeMajor(
    version,
    BFRAME_VERSION,
    !hasExplicitBframeVersion(root)
  );
  if (unsupportedMajor !== null) {
    throw new Error(`지원하지 않는 .bframe ${String(version)} 파일은 웹 뷰어에서 저장할 수 없습니다.`);
  }

  if (!Object.hasOwn(root, 'reviewDocumentId')) {
    root.reviewDocumentId = `reviewdoc-${createUuidV4(options.randomUUID)}`.toLowerCase();
  }
  if (!isValidReviewDocumentId(root.reviewDocumentId)) {
    throw new Error('유효하지 않은 reviewDocumentId가 있어 원본 보호를 위해 저장을 중단했습니다.');
  }

  return root;
}

export function serializeBframeForWrite(root, options = {}) {
  return JSON.stringify(prepareBframeForWrite(root, options), null, 2);
}

export function prepareDriveBframeForWrite(latestRoot, localRoot, options = {}) {
  if (!isRootObject(latestRoot) || !isRootObject(localRoot)) {
    throw new TypeError('최신 Drive root와 로컬 .bframe root 객체가 모두 필요합니다.');
  }

  const {
    localIdentityPersisted = false,
    randomUUID
  } = options;
  const assertVersionWritable = root => {
    const version = getDataVersion(root);
    const unsupportedMajor = getUnsupportedBframeMajor(
      version,
      BFRAME_VERSION,
      !hasExplicitBframeVersion(root)
    );
    if (unsupportedMajor !== null) {
      throw new Error(`지원하지 않는 .bframe ${String(version)} 파일은 웹 뷰어에서 저장할 수 없습니다.`);
    }
  };

  assertVersionWritable(latestRoot);
  assertVersionWritable(localRoot);

  const latestHasIdentity = Object.hasOwn(latestRoot, 'reviewDocumentId');
  const localHasIdentity = Object.hasOwn(localRoot, 'reviewDocumentId');
  if (latestHasIdentity && !isValidReviewDocumentId(latestRoot.reviewDocumentId)) {
    throw new Error('최신 Drive 파일의 reviewDocumentId가 유효하지 않아 저장을 중단했습니다.');
  }
  if (localHasIdentity && !isValidReviewDocumentId(localRoot.reviewDocumentId)) {
    throw new Error('로컬 reviewDocumentId가 유효하지 않아 저장을 중단했습니다.');
  }
  if (localIdentityPersisted && (
    !latestHasIdentity ||
    !localHasIdentity ||
    latestRoot.reviewDocumentId !== localRoot.reviewDocumentId
  )) {
    throw new Error('최신 Drive 파일과 로컬 리뷰의 reviewDocumentId 계보 충돌로 저장을 중단했습니다.');
  }
  if (
    latestHasIdentity &&
    localHasIdentity &&
    latestRoot.reviewDocumentId !== localRoot.reviewDocumentId
  ) {
    throw new Error('최신 Drive 파일과 로컬 리뷰의 reviewDocumentId 계보 충돌로 저장을 중단했습니다.');
  }

  let reviewDocumentId = localHasIdentity
    ? localRoot.reviewDocumentId
    : latestRoot.reviewDocumentId;
  if (!reviewDocumentId) {
    reviewDocumentId = `reviewdoc-${createUuidV4(randomUUID)}`.toLowerCase();
  }

  const data = mergeBframeRoot(
    extractOpaqueBframeRoot(latestRoot),
    { ...localRoot, reviewDocumentId }
  );
  prepareBframeForWrite(data, { randomUUID });

  return {
    data,
    identityPersisted: latestHasIdentity && latestRoot.reviewDocumentId === reviewDocumentId
  };
}

export function prepareContextBoundDriveBframeForWrite(
  latestRoot,
  context,
  options = {}
) {
  const {
    currentIdentityPersisted = false,
    randomUUID
  } = options;
  const prepared = prepareDriveBframeForWrite(latestRoot, context.root, {
    localIdentityPersisted: context.localIdentityPersisted || currentIdentityPersisted,
    randomUUID
  });

  context.root.reviewDocumentId = prepared.data.reviewDocumentId;
  if (prepared.identityPersisted) {
    context.localIdentityPersisted = true;
  }
  return prepared;
}

export default {
  BFRAME_VERSION,
  KNOWN_BFRAME_ROOT_FIELDS,
  hasExplicitBframeVersion,
  getDataVersion,
  getUnsupportedBframeMajor,
  isValidReviewDocumentId,
  extractOpaqueBframeRoot,
  mergeBframeRoot,
  mergeDriveBframeAfterWrite,
  reconcileDriveBframeAfterWrite,
  runContextBoundBframeLoad,
  runContextBoundDriveSave,
  createTrailingSingleFlight,
  prepareBframeForWrite,
  prepareDriveBframeForWrite,
  prepareContextBoundDriveBframeForWrite,
  serializeBframeForWrite
};
