/**
 * baeframe - Review Data Manager
 * .bframe 파일 저장/로드 관리
 *
 * @version 2.0 - 스키마 통합 및 마이그레이션 지원
 */

import { createLogger } from '../logger.js';
import {
  BFRAME_VERSION,
  getDataVersion,
  hasExplicitBframeVersion,
  needsMigration,
  migrateToV2,
  extractFileName,
  extractFileNameWithoutExt
} from '../../../shared/schema.js';
import {
  createReviewDocumentId,
  extractOpaqueBframeRoot,
  getUnsupportedBframeMajor,
  isValidReviewDocumentId,
  mergeBframeRoot
} from '../../../shared/bframe-root-envelope.js';
// 오프라인 머지 유틸리티 (Liveblocks 비활성 시 폴백)

function toTime(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getCommentRevisionTime(comment) {
  const ownRevision = Math.max(
    toTime(comment.updatedAt),
    toTime(comment.createdAt),
    toTime(comment.deletedAt)
  );
  const replyRevision = (comment.replies || []).reduce((latest, reply) => {
    return Math.max(
      latest,
      toTime(reply.updatedAt),
      toTime(reply.createdAt),
      toTime(reply.deletedAt)
    );
  }, 0);

  return Math.max(ownRevision, replyRevision);
}

function mergeComments(localComments, remoteComments) {
  const localMap = new Map(localComments.map(c => [c.id, c]));
  const remoteMap = new Map(remoteComments.map(c => [c.id, c]));
  const merged = [];
  let added = 0;
  let updated = 0;
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!local && remote) {
      merged.push(remote);
      if (!remote.deleted) added++;
    } else if (local && !remote) {
      merged.push(local);
    } else if (local && remote) {
      const localTime = getCommentRevisionTime(local);
      const remoteTime = getCommentRevisionTime(remote);
      if (remoteTime > localTime) {
        merged.push(remote);
        updated++;
      } else {
        merged.push(local);
      }
    }
  }
  return { merged, added, updated };
}

function mergeLayers(localLayers, remoteLayers) {
  const localMap = new Map(localLayers.map(l => [l.id, l]));
  const remoteMap = new Map(remoteLayers.map(l => [l.id, l]));
  const merged = [];
  let totalAdded = 0;
  let totalUpdated = 0;
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!local && remote) {
      merged.push(remote);
      totalAdded += remote.markers?.length || 0;
    } else if (local && !remote) {
      merged.push(local);
    } else if (local && remote) {
      const { merged: mergedMarkers, added, updated } = mergeComments(
        local.markers || [], remote.markers || []
      );
      merged.push({ ...local, markers: mergedMarkers });
      totalAdded += added;
      totalUpdated += updated;
    }
  }
  return { merged, added: totalAdded, updated: totalUpdated };
}

function cloneJson(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function jsonEquals(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => canonicalizeJson(item));
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) {
      result[key] = canonicalizeJson(value[key]);
    }
  }
  return result;
}

function captureDrawingsV3DiskState(data) {
  const present = Boolean(
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.hasOwn(data, 'drawingsV3')
  );
  const value = present ? cloneJson(data.drawingsV3) : undefined;
  let serialized = 'undefined';
  if (present) {
    try {
      const candidate = JSON.stringify(canonicalizeJson(value));
      if (candidate !== undefined) serialized = candidate;
    } catch (_error) {
      serialized = 'unserializable';
    }
  }
  return {
    known: true,
    present,
    value,
    fingerprint: present ? `present:${serialized}` : 'missing'
  };
}

function createUnknownDrawingsV3DiskState() {
  return {
    known: false,
    present: false,
    value: undefined,
    fingerprint: null
  };
}

function getHighlightList(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.highlights) ? data.highlights : [];
}

function normalizeHighlightData(data) {
  return {
    ...(data && typeof data === 'object' && !Array.isArray(data)
      ? cloneJson(data)
      : {}),
    highlights: cloneJson(getHighlightList(data))
  };
}

function normalizeReviewRootForMerge(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const dataVersion = getDataVersion(data);
  const unsupportedMajor = getUnsupportedBframeMajor(
    dataVersion,
    BFRAME_VERSION,
    !hasExplicitBframeVersion(data)
  );
  if (unsupportedMajor !== null) {
    return data;
  }

  return needsMigration(data) ? migrateToV2(data) : data;
}

function createEmptyReviewMergeBase() {
  return {
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: { highlights: [] },
    compositionLayers: [],
    manualVersions: [],
    versionInfo: null,
    liveblocksRoomId: null
  };
}

function captureReviewMergeBase(data) {
  const source = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : {};
  return {
    comments: cloneJson(source.comments || { layers: [] }),
    drawings: cloneJson(source.drawings || { layers: [] }),
    highlights: normalizeHighlightData(source.highlights),
    compositionLayers: cloneJson(
      Array.isArray(source.compositionLayers) ? source.compositionLayers : []
    ),
    manualVersions: cloneJson(
      Array.isArray(source.manualVersions) ? source.manualVersions : []
    ),
    versionInfo: cloneJson(source.versionInfo ?? null),
    liveblocksRoomId: source.liveblocksRoomId ?? null
  };
}

function filterAcceptedItems(sourceItems, appliedItems, options = {}) {
  const getKey = options.getKey || (item => item?.id);
  const mergeAccepted = options.mergeAccepted ||
    ((sourceItem) => cloneJson(sourceItem));
  const appliedByKey = new Map(
    (Array.isArray(appliedItems) ? appliedItems : [])
      .map((item, index) => [String(getKey(item) ?? `__index-${index}`), item])
  );

  return (Array.isArray(sourceItems) ? sourceItems : []).flatMap(
    (sourceItem, index) => {
      const key = String(getKey(sourceItem) ?? `__index-${index}`);
      const appliedItem = appliedByKey.get(key);
      return appliedItem
        ? [mergeAccepted(sourceItem, appliedItem)]
        : [];
    }
  );
}

function captureAcceptedReviewMergeBase(sourceData, appliedData) {
  const source = captureReviewMergeBase(sourceData);
  const applied = captureReviewMergeBase(appliedData);
  const comments = {
    ...cloneJson(source.comments),
    layers: filterAcceptedItems(
      source.comments.layers,
      applied.comments.layers,
      {
        mergeAccepted: (sourceLayer, appliedLayer) => ({
          ...cloneJson(sourceLayer),
          markers: filterAcceptedItems(
            sourceLayer?.markers,
            appliedLayer?.markers,
            {
              mergeAccepted: (sourceMarker, appliedMarker) => ({
                ...cloneJson(sourceMarker),
                replies: filterAcceptedItems(
                  sourceMarker?.replies,
                  appliedMarker?.replies
                )
              })
            }
          )
        })
      }
    )
  };

  return {
    ...source,
    comments,
    drawings: {
      ...cloneJson(source.drawings),
      layers: filterAcceptedItems(
        source.drawings.layers,
        applied.drawings.layers
      )
    },
    highlights: {
      ...cloneJson(source.highlights),
      highlights: filterAcceptedItems(
        source.highlights.highlights,
        applied.highlights.highlights
      )
    },
    compositionLayers: filterAcceptedItems(
      source.compositionLayers,
      applied.compositionLayers
    ),
    manualVersions: filterAcceptedItems(
      source.manualVersions,
      applied.manualVersions,
      { getKey: getManualVersionMergeKey }
    )
  };
}

function createDeterministicConflictCopy(
  item,
  usedIds,
  {
    idKey = 'id',
    conflictKind = 'remote',
    labelKey = 'name'
  } = {}
) {
  const copy = cloneJson(item);
  const originalId = String(copy?.[idKey] || 'item');
  const suffix = conflictKind === 'local'
    ? '__local-conflict'
    : '__remote-conflict';
  let candidate = `${originalId}${suffix}`;
  let sequence = 2;
  while (usedIds.has(candidate)) {
    candidate = `${originalId}${suffix}-${sequence}`;
    sequence += 1;
  }
  usedIds.add(candidate);
  copy[idKey] = candidate;
  if (labelKey && typeof copy[labelKey] === 'string') {
    copy[labelKey] = `${copy[labelKey]} (${conflictKind === 'local' ? '로컬' : '원격'} 충돌)`;
  }
  return copy;
}

function mergeEntityCollectionThreeWay(
  baseItems,
  localItems,
  remoteItems,
  {
    getKey = item => item?.id,
    createConflictCopy = (item, usedKeys, conflictKind) =>
      createDeterministicConflictCopy(item, usedKeys, { conflictKind }),
    mergeConcurrent = null
  } = {}
) {
  const normalizeKey = (item, index, source) => {
    const key = getKey(item);
    if (key !== null && key !== undefined && String(key).length > 0) {
      return String(key);
    }
    return `__anonymous-${source}-${index}-${JSON.stringify(canonicalizeJson(item))}`;
  };
  const makeMap = (items, source) => new Map(
    (Array.isArray(items) ? items : []).map((item, index) => [
      normalizeKey(item, index, source),
      item
    ])
  );
  const baseMap = makeMap(baseItems, 'base');
  const localMap = makeMap(localItems, 'local');
  const remoteMap = makeMap(remoteItems, 'remote');
  const baseKeys = [...baseMap.keys()];
  const localKeys = [...localMap.keys()];
  const remoteKeys = [...remoteMap.keys()];
  const localOrderChanged = !jsonEquals(localKeys, baseKeys);
  const remoteOrderChanged = !jsonEquals(remoteKeys, baseKeys);
  // 한쪽만 순서를 바꿨으면 그 순서를 따른다. 양쪽이 동시에 서로 다른
  // 순서를 만들었으면 저장 직전에 읽은 최신 디스크 순서를 결정적으로 따른다.
  const preferLocalOrder = localOrderChanged && !remoteOrderChanged;
  const preferredKeys = preferLocalOrder ? localKeys : remoteKeys;
  const secondaryKeys = preferLocalOrder ? remoteKeys : localKeys;
  const orderedKeys = [
    ...preferredKeys,
    ...secondaryKeys,
    ...baseKeys
  ].filter((key, index, all) => all.indexOf(key) === index);
  const usedKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
  const mergedByKey = new Map();

  for (const key of orderedKeys) {
    const hasBase = baseMap.has(key);
    const hasLocal = localMap.has(key);
    const hasRemote = remoteMap.has(key);
    const base = baseMap.get(key);
    const local = localMap.get(key);
    const remote = remoteMap.get(key);

    if (!hasBase) {
      if (hasLocal && hasRemote) {
        if (jsonEquals(local, remote)) {
          mergedByKey.set(key, [cloneJson(local)]);
        } else if (typeof mergeConcurrent === 'function') {
          mergedByKey.set(key, mergeConcurrent({
            base: undefined,
            local,
            remote,
            usedKeys
          }));
        } else {
          mergedByKey.set(key, [
            cloneJson(local),
            createConflictCopy(remote, usedKeys, 'remote')
          ]);
        }
      } else if (hasLocal) {
        mergedByKey.set(key, [cloneJson(local)]);
      } else if (hasRemote) {
        mergedByKey.set(key, [cloneJson(remote)]);
      }
      continue;
    }

    if (!hasLocal && !hasRemote) {
      mergedByKey.set(key, []);
      continue;
    }
    if (!hasLocal) {
      if (!jsonEquals(remote, base)) {
        mergedByKey.set(key, [
          createConflictCopy(remote, usedKeys, 'remote')
        ]);
      } else {
        mergedByKey.set(key, []);
      }
      continue;
    }
    if (!hasRemote) {
      if (!jsonEquals(local, base)) {
        mergedByKey.set(key, [
          createConflictCopy(local, usedKeys, 'local')
        ]);
      } else {
        mergedByKey.set(key, []);
      }
      continue;
    }

    if (jsonEquals(local, remote)) {
      mergedByKey.set(key, [cloneJson(local)]);
    } else if (jsonEquals(local, base)) {
      mergedByKey.set(key, [cloneJson(remote)]);
    } else if (jsonEquals(remote, base)) {
      mergedByKey.set(key, [cloneJson(local)]);
    } else if (typeof mergeConcurrent === 'function') {
      mergedByKey.set(key, mergeConcurrent({
        base,
        local,
        remote,
        usedKeys
      }));
    } else {
      mergedByKey.set(key, [
        cloneJson(local),
        createConflictCopy(remote, usedKeys, 'remote')
      ]);
    }
  }

  return orderedKeys.flatMap(key => mergedByKey.get(key) || []);
}

function withoutReplies(marker) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return marker;
  }
  const metadata = cloneJson(marker);
  delete metadata.replies;
  return metadata;
}

function getMarkerContentForMerge(marker) {
  const content = withoutReplies(marker);
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return content;
  }
  // 답글 추가/수정도 parent.updatedAt을 올리므로 revision 시각 자체는
  // 부모 본문 충돌 판정에서 제외하고 실제 필드 변경만 비교한다.
  delete content.updatedAt;
  return content;
}

function mergeRepliesThreeWay(baseReplies, localReplies, remoteReplies) {
  return mergeEntityCollectionThreeWay(
    baseReplies,
    localReplies,
    remoteReplies,
    {
      createConflictCopy: (reply, replyIds, conflictKind) =>
        createDeterministicConflictCopy(reply, replyIds, {
          conflictKind,
          labelKey: null
        }),
      mergeConcurrent: ({ local, remote, usedKeys }) => [
        cloneJson(local),
        createDeterministicConflictCopy(remote, usedKeys, {
          conflictKind: 'remote',
          labelKey: null
        })
      ]
    }
  );
}

function selectMarkerMetadata(baseMarker, localMarker, remoteMarker) {
  const localMetadata = withoutReplies(localMarker);
  const remoteMetadata = withoutReplies(remoteMarker);
  const baseContent = getMarkerContentForMerge(baseMarker);
  const localContent = getMarkerContentForMerge(localMarker);
  const remoteContent = getMarkerContentForMerge(remoteMarker);

  if (jsonEquals(localContent, remoteContent)) {
    const selected = getCommentRevisionTime(remoteMetadata) >
      getCommentRevisionTime(localMetadata)
      ? remoteMetadata
      : localMetadata;
    return {
      selected: cloneJson(selected),
      conflict: null,
      conflictKind: null
    };
  }
  if (baseMarker && jsonEquals(localContent, baseContent)) {
    return {
      selected: cloneJson(remoteMetadata),
      conflict: null,
      conflictKind: null
    };
  }
  if (baseMarker && jsonEquals(remoteContent, baseContent)) {
    return {
      selected: cloneJson(localMetadata),
      conflict: null,
      conflictKind: null
    };
  }

  const localDeleted = localMarker?.deleted === true;
  const remoteDeleted = remoteMarker?.deleted === true;
  if (localDeleted !== remoteDeleted) {
    // 삭제 tombstone이 원래 ID를 계속 소유해 뒤늦은 저장이 원본 댓글을
    // 부활시키지 않게 하고, 반대편 편집은 결정적인 conflict copy로 보존한다.
    return localDeleted
      ? {
        selected: cloneJson(localMetadata),
        conflict: cloneJson(remoteMetadata),
        conflictKind: 'remote'
      }
      : {
        selected: cloneJson(remoteMetadata),
        conflict: cloneJson(localMetadata),
        conflictKind: 'local'
      };
  }

  return {
    selected: cloneJson(localMetadata),
    conflict: cloneJson(remoteMetadata),
    conflictKind: 'remote'
  };
}

function mergeMarkerThreeWay(baseMarker, localMarker, remoteMarker, usedKeys) {
  const replies = mergeRepliesThreeWay(
    baseMarker?.replies,
    localMarker?.replies,
    remoteMarker?.replies
  );
  const { selected, conflict, conflictKind } = selectMarkerMetadata(
    baseMarker,
    localMarker,
    remoteMarker
  );
  const mergedMarker = { ...selected, replies };
  if (!conflict) return [mergedMarker];

  return [
    mergedMarker,
    createDeterministicConflictCopy(
      { ...conflict, replies: cloneJson(replies) },
      usedKeys,
      { conflictKind, labelKey: null }
    )
  ];
}

function mergeCommentDataThreeWay(baseData, localData, remoteData) {
  const baseLayers = Array.isArray(baseData?.layers) ? baseData.layers : [];
  const localLayers = Array.isArray(localData?.layers) ? localData.layers : [];
  const remoteLayers = Array.isArray(remoteData?.layers) ? remoteData.layers : [];
  const layers = mergeEntityCollectionThreeWay(
    baseLayers,
    localLayers,
    remoteLayers,
    {
      createConflictCopy: (layer, usedIds, conflictKind) =>
        createDeterministicConflictCopy(layer, usedIds, {
          conflictKind,
          labelKey: 'name'
        }),
      mergeConcurrent: ({ base, local, remote, usedKeys }) => {
        const markers = mergeEntityCollectionThreeWay(
          base?.markers,
          local.markers,
          remote.markers,
          {
            createConflictCopy: (marker, markerIds, conflictKind) =>
              createDeterministicConflictCopy(marker, markerIds, {
                conflictKind,
                labelKey: null
              }),
            mergeConcurrent: ({
              base: baseMarker,
              local: localMarker,
              remote: remoteMarker,
              usedKeys: markerIds
            }) => mergeMarkerThreeWay(
              baseMarker,
              localMarker,
              remoteMarker,
              markerIds
            )
          }
        );
        const localMetadata = { ...local, markers: undefined };
        const remoteMetadata = { ...remote, markers: undefined };
        const baseMetadata = base ? { ...base, markers: undefined } : null;
        if (jsonEquals(localMetadata, remoteMetadata) ||
            (baseMetadata && jsonEquals(remoteMetadata, baseMetadata))) {
          return [{ ...cloneJson(local), markers }];
        }
        if (baseMetadata && jsonEquals(localMetadata, baseMetadata)) {
          return [{ ...cloneJson(remote), markers }];
        }
        const localLayer = { ...cloneJson(local), markers };
        const remoteLayer = createDeterministicConflictCopy(
          { ...cloneJson(remote), markers: [] },
          usedKeys,
          { conflictKind: 'remote', labelKey: 'name' }
        );
        return [localLayer, remoteLayer];
      }
    }
  );
  return {
    ...(remoteData && !Array.isArray(remoteData) ? cloneJson(remoteData) : {}),
    ...(localData && !Array.isArray(localData) ? cloneJson(localData) : {}),
    layers
  };
}

function mergeDrawingDataThreeWay(baseData, localData, remoteData) {
  const layers = mergeEntityCollectionThreeWay(
    baseData?.layers,
    localData?.layers,
    remoteData?.layers,
    {
      createConflictCopy: (layer, usedIds, conflictKind) =>
        createDeterministicConflictCopy(layer, usedIds, {
          conflictKind,
          labelKey: 'name'
        })
    }
  );
  const activeLayerId = layers.some(layer => layer.id === localData?.activeLayerId)
    ? localData.activeLayerId
    : layers.some(layer => layer.id === remoteData?.activeLayerId)
      ? remoteData.activeLayerId
      : layers[0]?.id || null;
  return {
    ...(remoteData || {}),
    ...(localData || {}),
    layers,
    activeLayerId
  };
}

function mergeHighlightDataThreeWay(baseData, localData, remoteData) {
  const highlights = mergeEntityCollectionThreeWay(
    getHighlightList(baseData),
    getHighlightList(localData),
    getHighlightList(remoteData),
    {
      createConflictCopy: (highlight, usedIds, conflictKind) =>
        createDeterministicConflictCopy(highlight, usedIds, {
          conflictKind,
          labelKey: 'note'
        })
    }
  );
  return {
    ...(Array.isArray(remoteData) ? {} : remoteData || {}),
    ...(Array.isArray(localData) ? {} : localData || {}),
    highlights
  };
}

function mergeCompositionLayersThreeWay(baseLayers, localLayers, remoteLayers) {
  return mergeEntityCollectionThreeWay(
    baseLayers,
    localLayers,
    remoteLayers,
    {
      createConflictCopy: (layer, usedIds, conflictKind) =>
        createDeterministicConflictCopy(layer, usedIds, {
          conflictKind,
          labelKey: 'name'
        })
    }
  ).map((layer, order) => ({ ...layer, order }));
}

function getManualVersionMergeKey(version) {
  return version?.__baeframeMergeConflictId ||
    version?.filePath ||
    version?.path ||
    version?.fileName;
}

function mergeManualVersionsThreeWay(baseVersions, localVersions, remoteVersions) {
  return mergeEntityCollectionThreeWay(
    baseVersions,
    localVersions,
    remoteVersions,
    {
      getKey: getManualVersionMergeKey,
      createConflictCopy: (version, usedKeys, conflictKind) => {
        const copy = cloneJson(version);
        const originalKey = String(getManualVersionMergeKey(copy) || 'manual-version');
        const suffix = conflictKind === 'local'
          ? '__local-conflict'
          : '__remote-conflict';
        let candidate = `${originalKey}${suffix}`;
        let sequence = 2;
        while (usedKeys.has(candidate)) {
          candidate = `${originalKey}${suffix}-${sequence}`;
          sequence += 1;
        }
        usedKeys.add(candidate);
        copy.__baeframeMergeConflictId = candidate;
        return copy;
      }
    }
  );
}

function mergeScalarThreeWay(baseValue, localValue, remoteValue) {
  if (jsonEquals(localValue, remoteValue)) return cloneJson(localValue);
  if (jsonEquals(localValue, baseValue)) return cloneJson(remoteValue);
  if (jsonEquals(remoteValue, baseValue)) return cloneJson(localValue);
  // 두 인스턴스가 동시에 바꾼 단일 값은 데이터를 복제할 수 없으므로
  // 저장 직전에 읽은 최신 디스크 값을 결정적으로 보존한다.
  return cloneJson(remoteValue);
}

function mergeReviewDataThreeWay(baseData, localData, remoteData) {
  const base = captureReviewMergeBase(baseData);
  const local = captureReviewMergeBase(localData);
  const remote = captureReviewMergeBase(remoteData);
  return {
    ...localData,
    comments: mergeCommentDataThreeWay(
      base.comments,
      local.comments,
      remote.comments
    ),
    drawings: mergeDrawingDataThreeWay(
      base.drawings,
      local.drawings,
      remote.drawings
    ),
    highlights: mergeHighlightDataThreeWay(
      base.highlights,
      local.highlights,
      remote.highlights
    ),
    compositionLayers: mergeCompositionLayersThreeWay(
      base.compositionLayers,
      local.compositionLayers,
      remote.compositionLayers
    ),
    manualVersions: mergeManualVersionsThreeWay(
      base.manualVersions,
      local.manualVersions,
      remote.manualVersions
    ),
    versionInfo: mergeScalarThreeWay(
      base.versionInfo,
      local.versionInfo,
      remote.versionInfo
    ),
    liveblocksRoomId: mergeScalarThreeWay(
      base.liveblocksRoomId,
      local.liveblocksRoomId,
      remote.liveblocksRoomId
    )
  };
}

const log = createLogger('ReviewDataManager');

/**
 * 영상 파일 경로에서 .bframe 경로 생성
 * @param {string} videoPath - 영상 파일 경로
 * @returns {string} .bframe 파일 경로
 */
export function getBframePath(videoPath) {
  // 확장자를 .bframe으로 교체
  const lastDot = videoPath.lastIndexOf('.');
  if (lastDot === -1) {
    return videoPath + '.bframe';
  }
  return videoPath.substring(0, lastDot) + '.bframe';
}

/**
 * Review Data Manager
 * 자동 저장 및 로드 관리
 */
export class ReviewDataManager extends EventTarget {
  constructor(options = {}) {
    super();

    this.commentManager = options.commentManager;
    this.drawingManager = options.drawingManager;
    this.highlightManager = options.highlightManager;
    this.compositionLayerManager = options.compositionLayerManager;
    this.fabricDrawingPersistenceProvider =
      options.fabricDrawingPersistenceProvider || null;

    // 현재 상태
    this.currentVideoPath = null;
    this.currentBframePath = null;
    this.isDirty = false; // 저장되지 않은 변경사항 있음
    this.isLoading = false; // 로딩 중 (변경 이벤트 무시)

    // 자동 저장 설정
    this.autoSaveEnabled = options.autoSave !== false;
    this.autoSaveDelay = options.autoSaveDelay || 500; // 500ms (타이핑 완료 후 저장)
    this.autoSaveTimer = null;

    // 저장 동시성 제어
    this._savePromise = null;  // 저장 중인 Promise (락)
    this._videoFileRequestEpoch = 0;
    this._reviewContextEpoch = 0;
    this._reviewFileObservationEpoch = 0;
    this._reviewFileVersionToken = null;
    this._changeRevision = 0;
    this._hasPersistedFile = false;
    this._beforeSaveHandler = null;
    this._finalFabricSnapshotHandler = null;
    this._fabricDrawingSourceRefreshHandler = null;
    this._initialSaveConflictHandler = null;
    this._opaqueRootFields = {};
    this._fabricDrawingPersistenceContext = {};
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    this._fabricDrawingHasLocalChanges = false;
    this._fabricDrawingCollectedRevision = null;
    this._fabricDrawingProviderUnsubscribe = null;
    this._drawingsV3DiskState = createUnknownDrawingsV3DiskState();
    this._reviewMergeBase = createEmptyReviewMergeBase();
    this._hasCompletedReviewLoad = false;
    this._isConnected = false;
    this._reviewDocumentId = null;
    this._reviewDocumentIdPersisted = false;
    this._reviewDocumentIdFactory = options.reviewDocumentIdFactory || createReviewDocumentId;
    this._writeBlockedVersion = null;
    this._writeBlockedVersionDetected = false;
    this._writeBlockedReason = null;

    // 이벤트 바인딩
    this._onDataChanged = this._onDataChanged.bind(this);
    this._onFabricDrawingPersistenceChanged =
      this._onFabricDrawingPersistenceChanged.bind(this);

    // Liveblocks 매니저 연결 (실시간 협업용)
    this._liveblocksManager = null;

    log.info('ReviewDataManager 초기화됨', {
      autoSave: this.autoSaveEnabled,
      autoSaveDelay: this.autoSaveDelay
    });
  }

  /**
   * LiveblocksManager 연결 (실시간 협업용)
   * @param {LiveblocksManager} manager
   */
  setLiveblocksManager(manager) {
    this._liveblocksManager = manager;
    log.info('LiveblocksManager 연결됨');
  }

  /**
   * 저장 직전 훅 설정
   * @param {Function|null} handler
   */
  setBeforeSaveHandler(handler) {
    this._beforeSaveHandler = typeof handler === 'function' ? handler : null;
  }

  /**
   * 최신 root 확인 뒤 최종 Fabric snapshot을 가져오는 훅 설정
   * @param {Function|null} handler
   */
  setFinalFabricSnapshotHandler(handler) {
    this._finalFabricSnapshotHandler =
      typeof handler === 'function' ? handler : null;
  }

  /**
   * 외부 drawingsV3 교체를 활성 Fabric 입력 수명주기와 원자적으로 연결
   * @param {Function|null} handler
   */
  setFabricDrawingSourceRefreshHandler(handler) {
    this._fabricDrawingSourceRefreshHandler =
      typeof handler === 'function' ? handler : null;
  }

  /**
   * 첫 저장 중 다른 사용자가 먼저 파일을 만든 경우의 처리 훅 설정
   * @param {Function|null} handler
   */
  setInitialSaveConflictHandler(handler) {
    this._initialSaveConflictHandler = typeof handler === 'function' ? handler : null;
  }

  /**
   * Fabric 드로잉 persistence provider 교체
   * @param {Object|null} provider
   */
  setFabricDrawingPersistenceProvider(provider) {
    let transferableLocalRoot = null;
    const hadLocalChanges = this._fabricDrawingHasLocalChanges;
    if (hadLocalChanges &&
        this.fabricDrawingPersistenceProvider?.getStatus?.()?.state === 'ready') {
      try {
        transferableLocalRoot =
          this.fabricDrawingPersistenceProvider.exportRootValue?.() || null;
      } catch (_error) {
        transferableLocalRoot = null;
      }
    }

    this._disconnectFabricDrawingPersistenceProvider();
    this.fabricDrawingPersistenceProvider = provider || null;
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    this._invalidateFabricDrawingPersistenceProvider(
      this._hasCompletedReviewLoad ? 'provider-replaced' : 'no-current-review',
      { clearLocalChanges: false }
    );

    if (this._hasCompletedReviewLoad) {
      if (transferableLocalRoot) {
        this._installFabricDrawingRootInProvider({
          present: true,
          value: transferableLocalRoot
        }, {
          clearLocalChanges: false,
          failureReason: 'provider-replacement-failed'
        });
      } else {
        this._installRecordedDiskStateInProvider({
          clearLocalChanges: !hadLocalChanges,
          failureReason: 'provider-replacement-failed'
        });
      }
    }

    if (this._isConnected) {
      this._connectFabricDrawingPersistenceProvider();
    }
  }

  _connectFabricDrawingPersistenceProvider() {
    if (this._fabricDrawingProviderUnsubscribe ||
        typeof this.fabricDrawingPersistenceProvider?.subscribe !== 'function') {
      return;
    }
    this._fabricDrawingProviderUnsubscribe =
      this.fabricDrawingPersistenceProvider.subscribe(
        this._onFabricDrawingPersistenceChanged
      );
  }

  _disconnectFabricDrawingPersistenceProvider() {
    if (typeof this._fabricDrawingProviderUnsubscribe === 'function') {
      this._fabricDrawingProviderUnsubscribe();
    }
    this._fabricDrawingProviderUnsubscribe = null;
  }

  /**
   * 매니저들 연결 및 이벤트 리스너 설정
   */
  connect() {
    this._isConnected = true;
    this._connectFabricDrawingPersistenceProvider();

    if (this.commentManager) {
      this.commentManager.addEventListener('markerAdded', this._onDataChanged);
      this.commentManager.addEventListener('markerUpdated', this._onDataChanged);
      this.commentManager.addEventListener('markerDeleted', this._onDataChanged);
      this.commentManager.addEventListener('replyAdded', this._onDataChanged);
      this.commentManager.addEventListener('replyUpdated', this._onDataChanged);
      this.commentManager.addEventListener('replyDeleted', this._onDataChanged);
      this.commentManager.addEventListener('layerAdded', this._onDataChanged);
      this.commentManager.addEventListener('layerRemoved', this._onDataChanged);
    }

    if (this.drawingManager) {
      this.drawingManager.addEventListener('drawend', this._onDataChanged);
      this.drawingManager.addEventListener('layerCreated', this._onDataChanged);
      this.drawingManager.addEventListener('layerDeleted', this._onDataChanged);
      this.drawingManager.addEventListener('layerRestored', this._onDataChanged);
      this.drawingManager.addEventListener('layerOrderChanged', this._onDataChanged);
      this.drawingManager.addEventListener('activeLayerChanged', this._onDataChanged);
      this.drawingManager.addEventListener('keyframeAdded', this._onDataChanged);
      this.drawingManager.addEventListener('keyframeUpdated', this._onDataChanged);
      this.drawingManager.addEventListener('keyframeRemoved', this._onDataChanged);
      this.drawingManager.addEventListener('undo', this._onDataChanged);
      this.drawingManager.addEventListener('redo', this._onDataChanged);
    }

    if (this.highlightManager) {
      this.highlightManager.addEventListener('changed', this._onDataChanged);
    }

    if (this.compositionLayerManager) {
      this.compositionLayerManager.addEventListener('changed', this._onDataChanged);
    }

    log.info('데이터 변경 이벤트 연결됨');
  }

  /**
   * 이벤트 리스너 해제
   */
  disconnect() {
    this._isConnected = false;
    this._disconnectFabricDrawingPersistenceProvider();

    if (this.commentManager) {
      this.commentManager.removeEventListener('markerAdded', this._onDataChanged);
      this.commentManager.removeEventListener('markerUpdated', this._onDataChanged);
      this.commentManager.removeEventListener('markerDeleted', this._onDataChanged);
      this.commentManager.removeEventListener('replyAdded', this._onDataChanged);
      this.commentManager.removeEventListener('replyUpdated', this._onDataChanged);
      this.commentManager.removeEventListener('replyDeleted', this._onDataChanged);
      this.commentManager.removeEventListener('layerAdded', this._onDataChanged);
      this.commentManager.removeEventListener('layerRemoved', this._onDataChanged);
    }

    if (this.drawingManager) {
      this.drawingManager.removeEventListener('drawend', this._onDataChanged);
      this.drawingManager.removeEventListener('layerCreated', this._onDataChanged);
      this.drawingManager.removeEventListener('layerDeleted', this._onDataChanged);
      this.drawingManager.removeEventListener('layerRestored', this._onDataChanged);
      this.drawingManager.removeEventListener('layerOrderChanged', this._onDataChanged);
      this.drawingManager.removeEventListener('activeLayerChanged', this._onDataChanged);
      this.drawingManager.removeEventListener('keyframeAdded', this._onDataChanged);
      this.drawingManager.removeEventListener('keyframeUpdated', this._onDataChanged);
      this.drawingManager.removeEventListener('keyframeRemoved', this._onDataChanged);
      this.drawingManager.removeEventListener('undo', this._onDataChanged);
      this.drawingManager.removeEventListener('redo', this._onDataChanged);
    }

    if (this.highlightManager) {
      this.highlightManager.removeEventListener('changed', this._onDataChanged);
    }

    if (this.compositionLayerManager) {
      this.compositionLayerManager.removeEventListener('changed', this._onDataChanged);
    }

    this._cancelAutoSave();
    log.info('데이터 변경 이벤트 해제됨');
  }

  /**
   * 새 영상 파일 설정
   * @param {string} videoPath - 영상 파일 경로
   * @param {Object} options - 옵션
   * @param {boolean} options.skipSave - true면 이전 파일 저장 건너뛰기 (외부에서 이미 저장한 경우)
   */
  async setVideoFile(videoPath, options = {}) {
    const requestEpoch = ++this._videoFileRequestEpoch;

    // 자동 저장 일시 중지 및 대기 중인 저장 취소
    this._cancelAutoSave();
    if (this._savePromise) {
      await this._savePromise;
    }
    if (requestEpoch !== this._videoFileRequestEpoch) {
      return false;
    }

    // 이전 파일의 변경사항 저장 (skipSave가 true면 건너뛰기)
    if (!options.skipSave && this.hasUnsavedChanges() && this.currentBframePath) {
      await this.save();
    }
    if (requestEpoch !== this._videoFileRequestEpoch) {
      return false;
    }

    this.isLoading = true;
    this._reviewContextEpoch += 1;
    this._reviewFileObservationEpoch += 1;
    this._reviewFileVersionToken = null;
    this._invalidateFabricDrawingPersistenceProvider('video-load-started');
    this._drawingsV3DiskState = createUnknownDrawingsV3DiskState();
    this._reviewMergeBase = createEmptyReviewMergeBase();
    this._hasCompletedReviewLoad = false;
    this.currentVideoPath = videoPath;
    this.currentBframePath = getBframePath(videoPath);
    this._fabricDrawingPersistenceContext = {
      stableVideoIdentity: videoPath,
      ...(options.fabricDrawingPersistenceContext || {})
    };
    this._createdAt = null;
    this._modifiedAt = null;
    this._fps = 24;
    this._liveblocksRoomId = null;
    this._manualVersions = [];
    this._hasPersistedFile = false;
    this.isDirty = false;
    this._changeRevision = 0;
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    this._fabricDrawingHasLocalChanges = false;
    this._fabricDrawingCollectedRevision = null;
    this._resetRootEnvelopeState();

    log.info('영상 파일 설정됨', {
      videoPath: this.currentVideoPath,
      bframePath: this.currentBframePath
    });

    // 기존 .bframe 파일이 있으면 로드
    const loadOwner = this._captureReviewContextOwner(requestEpoch);
    const loaded = await this.load(loadOwner);
    if (!this._ownsReviewContext(loadOwner)) {
      return false;
    }

    // 로딩 완료 후 isLoading 해제 (load() 내부에서도 설정하지만 여기서 확실히 해제)
    this.isLoading = false;

    this._emit('videoFileSet', {
      videoPath: loadOwner.videoPath,
      bframePath: loadOwner.bframePath,
      hasExistingData: loaded
    });

    return loaded;
  }

  /**
   * 현재 영상 파일 경로 반환
   * @returns {string|null}
   */
  getVideoPath() {
    return this.currentVideoPath;
  }

  /**
   * 현재 데이터를 .bframe 파일로 저장
   * 저장 동시성 제어: 이미 저장 중이면 대기 후 반환
   * @param {Object} options
   * @param {boolean} options.skipMerge - true면 머지 없이 저장 (초기 저장 등)
   */
  async save(options = {}) {
    if (!this.currentBframePath) {
      log.warn('저장할 파일 경로가 없음');
      return false;
    }

    // 저장 동시성 제어: 이미 저장 중이면 해당 Promise 반환
    if (this._savePromise) {
      log.debug('저장 중 - 기존 저장 완료 대기');
      return this._savePromise;
    }

    this._cancelAutoSave();

    // 저장 Promise 생성 (락)
    const saveOwner = this._captureSaveOwner();
    this._savePromise = Promise.resolve().then(
      () => this._doSave(options, saveOwner)
    );

    try {
      return await this._savePromise;
    } finally {
      this._savePromise = null;
    }
  }

  async waitForPendingSave() {
    if (!this._savePromise) return true;
    return this._savePromise;
  }

  _captureSaveOwner() {
    return Object.freeze({
      contextEpoch: this._reviewContextEpoch,
      videoPath: this.currentVideoPath,
      bframePath: this.currentBframePath
    });
  }

  _captureReviewContextOwner(requestEpoch = this._videoFileRequestEpoch) {
    return Object.freeze({
      requestEpoch,
      contextEpoch: this._reviewContextEpoch,
      videoPath: this.currentVideoPath,
      bframePath: this.currentBframePath
    });
  }

  _ownsReviewContext(owner) {
    return Boolean(
      owner &&
      owner.requestEpoch === this._videoFileRequestEpoch &&
      owner.contextEpoch === this._reviewContextEpoch &&
      owner.videoPath === this.currentVideoPath &&
      owner.bframePath === this.currentBframePath
    );
  }

  _ownsSave(owner) {
    return Boolean(
      owner &&
      owner.contextEpoch === this._reviewContextEpoch &&
      owner.videoPath === this.currentVideoPath &&
      owner.bframePath === this.currentBframePath
    );
  }

  _assertSaveOwner(owner) {
    if (!this._ownsSave(owner)) {
      throw new Error('저장 중 영상이 바뀌어 이전 영상의 저장 결과를 적용하지 않았습니다.');
    }
  }

  /**
   * 실제 저장 수행 (내부용)
   */
  async _doSave(_options = {}, saveOwner = this._captureSaveOwner()) {
    try {
      this._assertSaveOwner(saveOwner);
      let savedData = null;
      let savedChangeRevision = null;
      let savedFabricDrawingRevision = null;
      let savedReviewMergeBase = null;
      let lastConflictResult = null;
      const maxAttempts = 5;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const wasInitialPersist = !this._hasPersistedFile;

        if (this._beforeSaveHandler) {
          await this._beforeSaveHandler({
            path: saveOwner.bframePath,
            videoPath: saveOwner.videoPath,
            hasPersistedFile: this._hasPersistedFile,
            options: _options
          });
        }

        this._assertSaveOwner(saveOwner);
        const latestRoot = await this._refreshRootEnvelopeBeforeSave(saveOwner);
        this._assertSaveOwner(saveOwner);
        this._assertRootEnvelopeWritable();
        this._ensureReviewDocumentId();
        if (this._finalFabricSnapshotHandler) {
          await this._finalFabricSnapshotHandler({
            path: saveOwner.bframePath,
            videoPath: saveOwner.videoPath,
            hasPersistedFile: this._hasPersistedFile,
            options: _options
          });
        }
        this._assertSaveOwner(saveOwner);
        const localData = this._collectData();
        const attemptReviewMergeBase = captureReviewMergeBase(localData);
        const data = this._mergeBeforeSave(localData, latestRoot);
        const attemptChangeRevision = this._changeRevision;
        const attemptFabricDrawingRevision = this._fabricDrawingCollectedRevision;
        const attemptObservationEpoch = this._reviewFileObservationEpoch;

        // Liveblocks 연결 중에도 로컬 .bframe에는 최신 병합 snapshot을 백업한다.
        if (this._liveblocksManager?.isConnected) {
          // liveblocksRoomId 포함
          data.liveblocksRoomId = this._liveblocksManager.roomId || null;
        }

        const saveOptions = {
          failIfExists: wasInitialPersist
        };
        if (!wasInitialPersist && this._reviewFileVersionToken) {
          saveOptions.expectedVersionToken = this._reviewFileVersionToken;
        }
        const saveResult = await window.electronAPI.saveReview(
          saveOwner.bframePath,
          data,
          saveOptions
        );
        this._assertSaveOwner(saveOwner);

        if (saveResult?.conflict === true) {
          this._writeBlockedReason = 'review-file-version-conflict';
          throw new Error('저장 직전 .bframe이 다시 변경되어 덮어쓰기를 중단했습니다.');
        }
        if (saveResult?.retryable === true) {
          this.isDirty = true;
          log.warn('.bframe 저장이 잠시 지연됨', {
            path: saveOwner.bframePath,
            reason: saveResult.reason || 'review-file-busy'
          });
          this._emit('saveDeferred', {
            path: saveOwner.bframePath,
            reason: saveResult.reason || 'review-file-busy'
          });
          if (this.autoSaveEnabled) {
            this._scheduleAutoSave();
          }
          return false;
        }
        const observationChanged = attemptObservationEpoch !==
          this._reviewFileObservationEpoch;
        const observationMatchesCompletedWrite =
          saveResult?.success === true &&
          typeof saveResult.versionToken === 'string' &&
          saveResult.versionToken === this._reviewFileVersionToken;
        if (observationChanged && !observationMatchesCompletedWrite) {
          this._writeBlockedReason = 'review-file-version-conflict';
          throw new Error('저장 중 .bframe 상태가 바뀌어 저장 완료 처리를 중단했습니다.');
        }

        if (saveResult?.exists === true && wasInitialPersist) {
          log.info('첫 .bframe 저장 충돌 감지, 기존 파일과 병합 시도', {
            path: saveOwner.bframePath
          });
          lastConflictResult = await this._initialSaveConflictHandler?.({
            path: saveOwner.bframePath,
            videoPath: saveOwner.videoPath
          });
          this._assertSaveOwner(saveOwner);

          if (lastConflictResult?.success === true) {
            this._hasPersistedFile = true;
          } else {
            this._hasPersistedFile = false;
            if (attempt < maxAttempts - 1) {
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }

          continue;
        }

        if (saveResult?.success !== true) {
          throw new Error(saveResult?.error || '.bframe 저장 실패');
        }

        if (typeof saveResult.versionToken === 'string' &&
            saveResult.versionToken.length > 0) {
          this._reviewFileVersionToken = saveResult.versionToken;
        }
        this._hasPersistedFile = true;
        this._reviewDocumentIdPersisted = true;
        savedData = data;
        savedChangeRevision = attemptChangeRevision;
        savedFabricDrawingRevision = attemptFabricDrawingRevision;
        savedReviewMergeBase = attemptReviewMergeBase;
        break;
      }

      if (!savedData) {
        throw new Error(lastConflictResult?.error || '첫 .bframe 저장 충돌 병합 실패');
      }

      const hasConcurrentChanges = this._changeRevision !== savedChangeRevision;
      this.isDirty = hasConcurrentChanges;
      this._assertSaveOwner(saveOwner);
      this._recordDrawingsV3DiskState(savedData);
      this._reviewMergeBase = savedReviewMergeBase ||
        captureReviewMergeBase(savedData);
      this._acknowledgeFabricDrawingSave(savedFabricDrawingRevision);

      log.info('.bframe 파일 저장됨', {
        path: saveOwner.bframePath,
        commentLayers: savedData?.comments?.layers?.length || 0,
        drawingLayers: savedData?.drawings?.layers?.length || 0,
        liveblocksConnected: !!this._liveblocksManager?.isConnected
      });

      this._emit('saved', { path: saveOwner.bframePath });

      if (hasConcurrentChanges && this.autoSaveEnabled) {
        this._scheduleAutoSave();
      }

      return true;
    } catch (error) {
      log.error('.bframe 저장 실패', error);
      this._emit('saveError', { error });
      return false;
    }
  }

  /**
   * 저장 직전 읽은 최신 root의 리뷰 데이터와 로컬 미저장 데이터를 병합한다.
   * 버전 토큰을 얻은 snapshot과 동일한 데이터를 사용해야 CAS 저장 전에
   * 다른 인스턴스의 변경을 다시 덮어쓰지 않는다.
   * @param {Object} localData - 로컬에서 수집한 데이터
   * @param {Object|null} remoteData - 저장 직전 읽은 최신 root
   * @returns {Object} 병합된 데이터
   */
  _mergeBeforeSave(localData, remoteData) {
    if (!remoteData || typeof remoteData !== 'object' || Array.isArray(remoteData)) {
      return localData;
    }

    const mergedData = mergeReviewDataThreeWay(
      this._reviewMergeBase,
      localData,
      remoteData
    );

    mergedData.modifiedAt = new Date().toISOString();
    return mergedData;
  }

  /**
   * .bframe 파일에서 데이터 로드 (마이그레이션 포함)
   */
  async load(loadOwner = this._captureReviewContextOwner()) {
    if (!loadOwner?.bframePath || !this._ownsReviewContext(loadOwner)) {
      log.warn('로드할 파일 경로가 없음');
      return false;
    }

    try {
      this.isLoading = true;
      let shouldSaveAfterMigration = false;

      const data = await window.electronAPI.loadReview(loadOwner.bframePath);
      if (!this._ownsReviewContext(loadOwner)) {
        return false;
      }

      if (!data) {
        log.info('.bframe 파일 없음 (새 리뷰)', { path: loadOwner.bframePath });
        this.compositionLayerManager?.fromJSON?.([]);
        this._hasPersistedFile = false;
        this._resetRootEnvelopeState();
        this._resetFabricDrawingPersistenceProvider();
        this._recordDrawingsV3DiskState({});
        this._reviewMergeBase = createEmptyReviewMergeBase();
        this.isLoading = false;
        return false;
      }

      this._hasPersistedFile = true;

      // 버전 확인 및 마이그레이션
      const dataVersion = getDataVersion(data);
      let migratedData = data;
      const unsupportedMajor = getUnsupportedBframeMajor(
        dataVersion,
        BFRAME_VERSION,
        !hasExplicitBframeVersion(data)
      );

      if (unsupportedMajor !== null) {
        log.warn('지원하지 않는 미래 .bframe 버전은 읽기 전용으로 엽니다', {
          version: dataVersion,
          supportedVersion: BFRAME_VERSION
        });
      } else if (needsMigration(data)) {
        log.info('마이그레이션 필요', { from: dataVersion, to: BFRAME_VERSION });

        // 마이그레이션 전 백업 생성
        const backupCreated = await this._createBackup(loadOwner.bframePath);
        if (!this._ownsReviewContext(loadOwner)) {
          return false;
        }
        if (!backupCreated) {
          log.warn('백업 생성 실패, 마이그레이션 결과의 자동 저장을 보류');
        }

        try {
          migratedData = migrateToV2(data);
          log.info('마이그레이션 성공', { version: migratedData.bframeVersion });

          // 마이그레이션 후 자동 저장 (새 스키마로 업데이트)
          shouldSaveAfterMigration = backupCreated;
        } catch (migrationError) {
          log.error('마이그레이션 실패', migrationError);

          // 백업에서 복구 시도
          if (backupCreated) {
            const restored = await this._restoreFromBackup(loadOwner.bframePath);
            if (!this._ownsReviewContext(loadOwner)) {
              return false;
            }
            if (restored) {
              log.info('백업에서 복구됨');
              migratedData = restored;
            }
          }

          this._emit('migrationError', { error: migrationError });
        }
      }

      // 데이터 적용
      if (!this._ownsReviewContext(loadOwner)) {
        return false;
      }
      const loadedReviewMergeBase = captureReviewMergeBase(migratedData);
      this._applyData(migratedData);
      this._reviewMergeBase = captureAcceptedReviewMergeBase(
        loadedReviewMergeBase,
        this._collectReviewDataForMerge(loadedReviewMergeBase)
      );

      this.isDirty = false;
      this.isLoading = false;

      log.info('.bframe 파일 로드됨', {
        path: loadOwner.bframePath,
        version: migratedData.bframeVersion || migratedData.version,
        commentLayers: migratedData.comments?.layers?.length || 0,
        drawingLayers: migratedData.drawings?.layers?.length || 0
      });

      this._emit('loaded', { path: loadOwner.bframePath, data: migratedData });

      // 마이그레이션 후 자동 저장
      if (shouldSaveAfterMigration) {
        // 약간의 딜레이 후 저장 (데이터 적용 완료 보장)
        setTimeout(() => {
          if (this._ownsReviewContext(loadOwner)) {
            this.save();
          }
        }, 100);
      }

      return true;
    } catch (error) {
      if (!this._ownsReviewContext(loadOwner)) {
        return false;
      }
      log.error('.bframe 로드 실패', error);
      this._hasCompletedReviewLoad = false;
      this._drawingsV3DiskState = createUnknownDrawingsV3DiskState();
      this._reviewMergeBase = createEmptyReviewMergeBase();
      this._invalidateFabricDrawingPersistenceProvider('review-load-failed');
      this.isLoading = false;
      this._emit('loadError', { error });
      return false;
    }
  }

  /**
   * 원격 데이터를 로드하고 로컬 데이터와 머지 (비디오 유지)
   * 협업 중 동기화에 사용
   *
   * @param {Object} options
   * @param {boolean} options.merge - true면 머지, false면 덮어쓰기
   * @param {boolean} options.force - true면 isDirty 무시하고 강제 진행
   * @returns {Promise<{success: boolean, added: number, updated: number, skipped?: boolean}>}
   */
  async reloadAndMerge(options = { merge: true }) {
    if (!this.currentBframePath) {
      log.warn('reloadAndMerge: 파일 경로가 없음');
      return { success: false, added: 0, updated: 0 };
    }

    const reloadOwner = this._captureReviewContextOwner();
    const reloadOptions = { ...options };

    // 미저장 작업 보호: isDirty이고 force가 아니면 머지만 하고 덮어쓰기 방지
    if (this.isDirty && !reloadOptions.force) {
      log.info('reloadAndMerge: 미저장 작업 있음 - 안전 머지 모드');
      // 강제 머지 모드로 전환 (로컬 데이터 유지하면서 원격 추가분만 반영)
      reloadOptions.merge = true;
      reloadOptions.preserveLocal = true;
    }

    // 자동저장 일시 중지
    this._cancelAutoSave();
    const wasLoading = this.isLoading;
    this.isLoading = true;

    try {
      // 원격 데이터 로드
      const remoteSnapshot = await this._readReviewSnapshot(reloadOwner.bframePath);
      if (!this._ownsReviewContext(reloadOwner)) {
        return { success: false, added: 0, updated: 0, skipped: true };
      }
      const remoteData = remoteSnapshot.data;
      this._reviewFileObservationEpoch += 1;
      this._reviewFileVersionToken = remoteSnapshot.versionToken;

      if (!remoteData) {
        log.info('reloadAndMerge: 원격 파일 없음');
        this.isLoading = wasLoading;
        return { success: false, added: 0, updated: 0 };
      }

      const retainIdentityWhenMissing = !this._reviewDocumentIdPersisted;
      const allowIdentityReplacement = reloadOptions.merge === false;
      const rootCaptured = this._captureRootEnvelope(remoteData, {
        retainIdentityWhenMissing,
        allowIdentityReplacement
      });
      if (rootCaptured) {
        const reconciled = await this._reconcileDrawingsV3DiskState(
          remoteData,
          reloadOwner
        );
        if (!this._ownsReviewContext(reloadOwner)) {
          return { success: false, added: 0, updated: 0, skipped: true };
        }
        if (!reconciled) {
          this._assertRootEnvelopeWritable();
          throw new Error('외부 Fabric 드로잉 교체를 안전하게 완료하지 못했습니다.');
        }
      }
      if (!allowIdentityReplacement) {
        this._assertRootEnvelopeWritable();
      }
      const remoteReviewData = normalizeReviewRootForMerge(remoteData);
      this._hasPersistedFile = true;

      const result = { added: 0, updated: 0 };

      if (reloadOptions.merge) {
        const localReviewData = this._collectReviewDataForMerge();
        if (Array.isArray(remoteData.comments?.layers) &&
            Array.isArray(localReviewData.comments?.layers)) {
          const mergeResult = mergeLayers(
            localReviewData.comments.layers,
            remoteData.comments.layers
          );
          result.added = mergeResult.added;
          result.updated = mergeResult.updated;
        }
        const mergedReviewData = mergeReviewDataThreeWay(
          this._reviewMergeBase,
          localReviewData,
          remoteReviewData
        );

        this.commentManager?.fromJSON?.(mergedReviewData.comments);
        this.drawingManager?.importData?.(mergedReviewData.drawings);
        this.highlightManager?.fromJSON?.(mergedReviewData.highlights);
        this.compositionLayerManager?.fromJSON?.(
          mergedReviewData.compositionLayers
        );
        this._manualVersions = mergedReviewData.manualVersions;
        this._liveblocksRoomId = mergedReviewData.liveblocksRoomId ?? null;
        this._versionInfo = cloneJson(mergedReviewData.versionInfo ?? null);
        // reload merge의 공통 기준점은 ID가 conflict copy로 바뀐 적용 결과가
        // 아니라 저장 직전에 읽은 원격 원본이어야 삭제가 다시 살아나지 않는다.
        this._reviewMergeBase = captureReviewMergeBase(remoteReviewData);

        if (remoteReviewData.modifiedAt &&
            toTime(remoteReviewData.modifiedAt) > toTime(this._modifiedAt)) {
          this._modifiedAt = remoteReviewData.modifiedAt;
        }

      } else {
        // 덮어쓰기 모드: 원격 데이터로 전체 교체
        this._applyData(remoteReviewData, {
          allowIdentityReplacement: true,
          skipFabricDrawingImport: true
        });
        const overwrittenReviewMergeBase = captureReviewMergeBase(remoteReviewData);
        this._reviewMergeBase = captureAcceptedReviewMergeBase(
          overwrittenReviewMergeBase,
          this._collectReviewDataForMerge(overwrittenReviewMergeBase)
        );
        log.info('reloadAndMerge: 데이터 덮어쓰기 완료');
      }

      this.isLoading = wasLoading;
      this._emit('reloaded', {
        merged: reloadOptions.merge,
        added: result.added,
        updated: result.updated
      });

      return { success: true, ...result };

    } catch (error) {
      if (!this._ownsReviewContext(reloadOwner)) {
        return { success: false, added: 0, updated: 0, skipped: true };
      }
      log.error('reloadAndMerge 실패', error);
      this.isLoading = wasLoading;
      this._emit('reloadError', { error });
      return { success: false, added: 0, updated: 0 };
    }
  }

  /**
   * .bframe 파일 백업 생성
   * @returns {Promise<boolean>} 백업 성공 여부
   */
  async _createBackup(reviewPath = this.currentBframePath) {
    if (!reviewPath) return false;

    const backupPath = reviewPath + '.bak';

    try {
      const data = await window.electronAPI.loadReview(reviewPath);
      if (!data) return false;

      const saveResult = await window.electronAPI.saveReview(backupPath, data);
      if (saveResult?.success !== true) {
        log.warn('백업 저장이 완료되지 않음', {
          path: backupPath,
          reason: saveResult?.reason || saveResult?.error || 'unknown'
        });
        return false;
      }

      log.info('백업 생성됨', { path: backupPath });
      return true;
    } catch (error) {
      log.warn('백업 생성 실패', error);
      return false;
    }
  }

  /**
   * 백업에서 데이터 복구
   * @returns {Promise<Object|null>} 복구된 데이터 또는 null
   */
  async _restoreFromBackup(reviewPath = this.currentBframePath) {
    if (!reviewPath) return null;

    const backupPath = reviewPath + '.bak';

    try {
      const data = await window.electronAPI.loadReview(backupPath);
      if (data) {
        log.info('백업에서 복구됨', { path: backupPath });
        return data;
      }
    } catch (error) {
      log.warn('백업 복구 실패', error);
    }

    return null;
  }

  /**
   * 백업 파일 삭제
   * @returns {Promise<boolean>}
   */
  async _deleteBackup(reviewPath = this.currentBframePath) {
    if (!reviewPath) return false;

    const backupPath = reviewPath + '.bak';

    try {
      await window.electronAPI.deleteFile(backupPath);
      log.info('백업 삭제됨', { path: backupPath });
      return true;
    } catch (error) {
      // 백업 파일이 없으면 무시
      return false;
    }
  }

  _resetRootEnvelopeState() {
    this._opaqueRootFields = {};
    this._reviewDocumentId = null;
    this._reviewDocumentIdPersisted = false;
    this._writeBlockedVersion = null;
    this._writeBlockedVersionDetected = false;
    this._writeBlockedReason = null;
  }

  _resetFabricDrawingPersistenceProvider() {
    this._fabricDrawingHasLocalChanges = false;
    this._fabricDrawingCollectedRevision = null;
    return this._installFabricDrawingRootInProvider({
      present: false,
      value: undefined
    }, {
      clearLocalChanges: true,
      failureReason: 'review-reset-failed'
    });
  }

  _importFabricDrawingPersistenceRoot(data) {
    this._fabricDrawingHasLocalChanges = false;
    this._fabricDrawingCollectedRevision = null;
    const state = captureDrawingsV3DiskState(data);
    const result = this._installFabricDrawingRootInProvider(state, {
      clearLocalChanges: true,
      failureReason: 'review-import-failed'
    });
    this._recordDrawingsV3DiskState(data);
    return result;
  }

  _installRecordedDiskStateInProvider(options = {}) {
    if (!this._drawingsV3DiskState.known) {
      this._invalidateFabricDrawingPersistenceProvider(
        options.failureReason || 'disk-state-unavailable',
        { clearLocalChanges: options.clearLocalChanges !== false }
      );
      return null;
    }
    return this._installFabricDrawingRootInProvider(
      this._drawingsV3DiskState,
      options
    );
  }

  _installFabricDrawingRootInProvider(state, options = {}) {
    const {
      clearLocalChanges = true,
      failureReason = 'provider-install-failed'
    } = options;
    this._fabricDrawingCollectedRevision = null;
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    if (clearLocalChanges) {
      this._fabricDrawingHasLocalChanges = false;
    }

    const provider = this.fabricDrawingPersistenceProvider;
    const method = state.present ? 'importRootValue' : 'reset';
    if (typeof provider?.[method] !== 'function') {
      this._invalidateFabricDrawingPersistenceProvider(failureReason, {
        clearLocalChanges
      });
      return null;
    }

    try {
      const result = state.present
        ? provider.importRootValue(
          cloneJson(state.value),
          this._fabricDrawingPersistenceContext
        )
        : provider.reset(this._fabricDrawingPersistenceContext);
      this._fabricDrawingProviderLoadedForCurrentReview =
        result?.accepted === true || result?.preserved === true;
      if (!this._fabricDrawingProviderLoadedForCurrentReview) {
        this._invalidateFabricDrawingPersistenceProvider(failureReason, {
          clearLocalChanges
        });
      }
      return result;
    } catch (error) {
      this._invalidateFabricDrawingPersistenceProvider(failureReason, {
        clearLocalChanges
      });
      log.warn('Fabric 드로잉 provider 설치 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  _invalidateFabricDrawingPersistenceProvider(reason, options = {}) {
    const { clearLocalChanges = true } = options;
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    this._fabricDrawingCollectedRevision = null;
    if (clearLocalChanges) {
      this._fabricDrawingHasLocalChanges = false;
    }
    try {
      this.fabricDrawingPersistenceProvider?.invalidate?.(reason);
    } catch (error) {
      log.warn('Fabric 드로잉 provider 무효화 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  _recordDrawingsV3DiskState(data) {
    this._drawingsV3DiskState = captureDrawingsV3DiskState(data);
    this._hasCompletedReviewLoad = true;
  }

  async _readReviewSnapshot(filePath) {
    if (typeof window.electronAPI.loadReviewSnapshot === 'function') {
      const snapshot = await window.electronAPI.loadReviewSnapshot(filePath);
      if (!snapshot ||
          typeof snapshot !== 'object' ||
          Array.isArray(snapshot) ||
          !Object.hasOwn(snapshot, 'data')) {
        throw new Error('버전이 포함된 .bframe snapshot을 읽지 못했습니다.');
      }
      const versionToken =
        typeof snapshot.versionToken === 'string' &&
        snapshot.versionToken.length > 0 &&
        snapshot.versionToken.length <= 512
          ? snapshot.versionToken
          : null;
      return {
        data: snapshot.data,
        versionToken
      };
    }
    return {
      data: await window.electronAPI.loadReview(filePath),
      versionToken: null
    };
  }

  async _runFabricDrawingSourceRefresh(
    installSource,
    details = {},
    isOwnerCurrent = () => true
  ) {
    let installInvoked = false;
    let installResult = false;
    const guardedInstallSource = async () => {
      if (installInvoked) return installResult;
      installInvoked = true;
      installResult = await installSource();
      return installResult;
    };

    if (!this._fabricDrawingSourceRefreshHandler) {
      return guardedInstallSource();
    }

    await this._fabricDrawingSourceRefreshHandler({
      installSource: guardedInstallSource,
      path: this.currentBframePath,
      videoPath: this.currentVideoPath,
      ...details
    });
    if (!installInvoked) {
      if (isOwnerCurrent()) {
        this._writeBlockedReason = 'fabric-drawing-source-refresh-failed';
      }
      return false;
    }
    return installResult;
  }

  async _reconcileDrawingsV3DiskState(
    data,
    owner = this._captureReviewContextOwner(),
    ownsOwner = candidate => this._ownsReviewContext(candidate)
  ) {
    const latestState = captureDrawingsV3DiskState(data);
    if (this._drawingsV3DiskState.known &&
        latestState.fingerprint === this._drawingsV3DiskState.fingerprint) {
      return true;
    }

    return this._runFabricDrawingSourceRefresh(async () => {
      if (!ownsOwner(owner)) {
        return false;
      }
      if (this._drawingsV3DiskState.known &&
          latestState.fingerprint === this._drawingsV3DiskState.fingerprint) {
        return true;
      }
      if (this._fabricDrawingHasLocalChanges) {
        this._writeBlockedReason = 'fabric-drawing-conflict';
        return false;
      }

      this._drawingsV3DiskState = latestState;
      this._hasCompletedReviewLoad = true;
      const installed = this._installRecordedDiskStateInProvider({
        clearLocalChanges: true,
        failureReason: 'disk-reconcile-failed'
      });
      const accepted = !this.fabricDrawingPersistenceProvider ||
        installed?.accepted === true ||
        installed?.preserved === true;
      if (!accepted) {
        this._writeBlockedReason = 'fabric-drawing-source-refresh-failed';
        return false;
      }
      return true;
    }, {
      reason: 'external-drawings-v3-changed',
      fingerprint: latestState.fingerprint
    }, () => ownsOwner(owner));
  }

  _captureRootEnvelope(data, options = {}) {
    const {
      retainIdentityWhenMissing = false,
      allowIdentityReplacement = false
    } = options;
    const hasIncomingIdentity = Object.hasOwn(data, 'reviewDocumentId');
    const incomingIdentityIsValid = hasIncomingIdentity &&
      isValidReviewDocumentId(data.reviewDocumentId);

    if (this._reviewDocumentIdPersisted && !allowIdentityReplacement) {
      if (!hasIncomingIdentity) {
        this._writeBlockedReason = 'review-document-id-missing';
        return false;
      }
      if (!incomingIdentityIsValid) {
        this._writeBlockedReason = 'invalid-review-document-id';
        return false;
      }
      if (data.reviewDocumentId !== this._reviewDocumentId) {
        this._writeBlockedReason = 'review-document-id-mismatch';
        return false;
      }
    }

    this._opaqueRootFields = extractOpaqueBframeRoot(data);

    const dataVersion = getDataVersion(data);
    const unsupportedMajor = getUnsupportedBframeMajor(
      dataVersion,
      BFRAME_VERSION,
      !hasExplicitBframeVersion(data)
    );
    this._writeBlockedVersionDetected = unsupportedMajor !== null;
    this._writeBlockedVersion = unsupportedMajor === null ? null : dataVersion;
    this._writeBlockedReason = null;

    if (hasIncomingIdentity) {
      if (incomingIdentityIsValid) {
        this._reviewDocumentId = data.reviewDocumentId;
        this._reviewDocumentIdPersisted = true;
      } else {
        this._reviewDocumentId = null;
        this._reviewDocumentIdPersisted = false;
        this._writeBlockedReason = 'invalid-review-document-id';
      }
    } else if (!retainIdentityWhenMissing) {
      this._reviewDocumentId = null;
      this._reviewDocumentIdPersisted = false;
    }
    return true;
  }

  async _refreshRootEnvelopeBeforeSave(saveOwner = null) {
    if (!this._hasPersistedFile) return null;

    const reviewPath = saveOwner?.bframePath || this.currentBframePath;
    const snapshot = await this._readReviewSnapshot(reviewPath);
    if (saveOwner) this._assertSaveOwner(saveOwner);
    const latestRoot = snapshot.data;
    if (!latestRoot || typeof latestRoot !== 'object' || Array.isArray(latestRoot)) {
      throw new Error('최신 .bframe root를 다시 읽지 못해 저장을 중단했습니다.');
    }
    this._reviewFileObservationEpoch += 1;
    this._reviewFileVersionToken = snapshot.versionToken;

    const rootCaptured = this._captureRootEnvelope(latestRoot, {
      retainIdentityWhenMissing: !this._reviewDocumentIdPersisted
    });
    if (rootCaptured) {
      await this._reconcileDrawingsV3DiskState(
        latestRoot,
        saveOwner || this._captureSaveOwner(),
        owner => this._ownsSave(owner)
      );
    }
    return normalizeReviewRootForMerge(latestRoot);
  }

  _assertRootEnvelopeWritable() {
    if (this._writeBlockedVersionDetected) {
      throw new Error(
        `지원하지 않는 .bframe ${this._writeBlockedVersion} 파일은 이 버전에서 저장할 수 없습니다.`
      );
    }

    if (this._writeBlockedReason === 'invalid-review-document-id') {
      throw new Error('유효하지 않은 reviewDocumentId가 있어 원본 보호를 위해 저장을 중단했습니다.');
    }

    if (this._writeBlockedReason === 'review-document-id-missing') {
      throw new Error('최신 .bframe에서 reviewDocumentId가 사라져 계보 충돌로 저장을 중단했습니다.');
    }

    if (this._writeBlockedReason === 'review-document-id-mismatch') {
      throw new Error('최신 .bframe의 reviewDocumentId가 달라 계보 충돌로 저장을 중단했습니다.');
    }

    if (this._writeBlockedReason === 'fabric-drawing-conflict') {
      throw new Error('다른 변경과 로컬 Fabric 드로잉이 충돌해 원본 보호를 위해 저장을 중단했습니다.');
    }

    if (this._writeBlockedReason === 'fabric-drawing-source-refresh-stale') {
      throw new Error('영상이 바뀌어 외부 Fabric 드로잉 갱신을 안전하게 중단했습니다.');
    }

    if (this._writeBlockedReason === 'fabric-drawing-source-refresh-failed') {
      throw new Error('외부 Fabric 드로잉 갱신을 안전하게 완료하지 못해 저장을 중단했습니다.');
    }
  }

  _ensureReviewDocumentId() {
    if (this._reviewDocumentId) return this._reviewDocumentId;

    const reviewDocumentId = this._reviewDocumentIdFactory();
    if (!isValidReviewDocumentId(reviewDocumentId)) {
      throw new Error('reviewDocumentId 생성기가 유효하지 않은 ID를 반환했습니다.');
    }

    this._reviewDocumentId = reviewDocumentId;
    this._reviewDocumentIdPersisted = false;
    return reviewDocumentId;
  }

  /**
   * 현재 모든 데이터 수집 (v2.0 스키마)
   */
  _collectReviewDataForMerge(fallbackReviewData = this._reviewMergeBase) {
    const collectManagerData = (manager, method, fallback) => {
      if (typeof manager?.[method] !== 'function') {
        return cloneJson(fallback);
      }
      const value = manager[method]();
      return value === undefined ? cloneJson(fallback) : value;
    };
    const mergeBase = fallbackReviewData || createEmptyReviewMergeBase();

    return {
      comments: collectManagerData(
        this.commentManager,
        'toJSON',
        mergeBase.comments
      ),
      drawings: collectManagerData(
        this.drawingManager,
        'exportData',
        mergeBase.drawings
      ),
      highlights: collectManagerData(
        this.highlightManager,
        'toJSON',
        mergeBase.highlights
      ),
      compositionLayers: collectManagerData(
        this.compositionLayerManager,
        'toJSON',
        mergeBase.compositionLayers
      ),
      manualVersions: cloneJson(this._manualVersions || []),
      versionInfo: cloneJson(this._versionInfo ?? null),
      liveblocksRoomId: this._liveblocksRoomId ?? null
    };
  }

  _collectData() {
    const now = new Date().toISOString();
    const videoFile = extractFileName(this.currentVideoPath);
    this._collectFabricDrawingPersistenceRoot();
    const reviewData = this._collectReviewDataForMerge();

    const knownRoot = {
      // v2.0 스키마 필드
      bframeVersion: BFRAME_VERSION,
      videoFile: videoFile,
      videoPath: this.currentVideoPath,
      fps: this._fps || 24,
      createdAt: this._createdAt || now,
      modifiedAt: now,

      // Liveblocks Room ID (실시간 협업용)
      liveblocksRoomId: this._liveblocksRoomId || null,

      // 버전 관리 필드
      versionInfo: this._versionInfo || null,
      manualVersions: reviewData.manualVersions,

      // 리뷰 데이터
      comments: reviewData.comments,
      drawings: reviewData.drawings,
      highlights: reviewData.highlights,
      compositionLayers: reviewData.compositionLayers
    };

    if (this._reviewDocumentId) {
      knownRoot.reviewDocumentId = this._reviewDocumentId;
    }

    return mergeBframeRoot(this._opaqueRootFields, knownRoot);
  }

  _collectFabricDrawingPersistenceRoot() {
    this._fabricDrawingCollectedRevision = null;
    if (!this._fabricDrawingHasLocalChanges) return;
    if (!this._fabricDrawingProviderLoadedForCurrentReview) {
      throw new Error('현재 영상의 Fabric 드로잉 저장소가 준비되지 않았습니다.');
    }

    const provider = this.fabricDrawingPersistenceProvider;
    const status = provider?.getStatus?.();
    if (status?.state !== 'ready' || status?.compatible !== true) {
      throw new Error('Fabric 드로잉 저장 문서가 호환되지 않아 저장을 중단했습니다.');
    }
    if (typeof provider.exportRootValue !== 'function') {
      throw new Error('Fabric 드로잉 저장 문서를 가져올 수 없습니다.');
    }

    const snapshot = provider.exportRootValue();
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('Fabric 드로잉 저장 문서가 유효하지 않습니다.');
    }
    this._opaqueRootFields = {
      ...this._opaqueRootFields,
      drawingsV3: snapshot
    };
    this._fabricDrawingCollectedRevision = status.revision;
  }

  _acknowledgeFabricDrawingSave(savedRevision) {
    if (savedRevision === null || savedRevision === undefined) return;
    const currentRevision = this.fabricDrawingPersistenceProvider?.getRevision?.();
    if (currentRevision === savedRevision) {
      this._fabricDrawingHasLocalChanges = false;
    }
  }

  /**
   * 로드한 데이터 적용 (v2.0 스키마)
   */
  _applyData(data, options = {}) {
    this._captureRootEnvelope(data, options);
    if (!options.skipFabricDrawingImport) {
      this._importFabricDrawingPersistenceRoot(data);
    }

    // 메타데이터
    this._createdAt = data.createdAt;
    this._modifiedAt = data.modifiedAt;  // 머지 비교용
    this._fps = data.fps || 24;

    // Liveblocks Room ID
    this._liveblocksRoomId = data.liveblocksRoomId || null;

    // 버전 관리 정보
    this._versionInfo = data.versionInfo || null;
    this._manualVersions = data.manualVersions || [];

    // 리뷰 데이터
    if (data.comments && this.commentManager) {
      this.commentManager.fromJSON(data.comments);
    }

    if (data.drawings && this.drawingManager) {
      this.drawingManager.importData(data.drawings);
    }

    if (data.highlights && this.highlightManager) {
      this.highlightManager.fromJSON(normalizeHighlightData(data.highlights));
    }

    if (this.compositionLayerManager) {
      this.compositionLayerManager.fromJSON(data.compositionLayers || []);
    }
  }

  /**
   * FPS 설정
   * @param {number} fps
   */
  setFps(fps) {
    const nextFps = Number(fps);
    if (!Number.isFinite(nextFps) || nextFps <= 0) return;
    if (this._fps === nextFps) return;
    this._fps = nextFps;
    this._markDirty();
  }

  /**
   * 현재 FPS 가져오기
   * @returns {number}
   */
  getFps() {
    return this._fps || 24;
  }

  /**
   * Liveblocks Room ID 가져오기
   * @returns {string|null}
   */
  getLiveblocksRoomId() {
    return this._liveblocksRoomId || null;
  }

  /**
   * Liveblocks Room ID 설정
   * @param {string} roomId
   */
  setLiveblocksRoomId(roomId) {
    this._liveblocksRoomId = roomId;
    this._markDirty();
  }

  /**
   * 버전 정보 설정
   * @param {Object} versionInfo
   */
  setVersionInfo(versionInfo) {
    this._versionInfo = versionInfo;
    this._markDirty();
  }

  /**
   * 현재 버전 정보 가져오기
   * @returns {Object|null}
   */
  getVersionInfo() {
    return this._versionInfo;
  }

  /**
   * 수동 버전 추가
   * @param {Object} manualVersion
   */
  addManualVersion(manualVersion) {
    if (!this._manualVersions) {
      this._manualVersions = [];
    }
    this._manualVersions.push(manualVersion);
    this._markDirty();
  }

  /**
   * 수동 버전 목록 가져오기
   * @returns {Array}
   */
  getManualVersions() {
    return this._manualVersions || [];
  }

  /**
   * 수동 버전 목록 설정 (전체 교체)
   * @param {Array} manualVersions
   */
  setManualVersions(manualVersions) {
    this._manualVersions = manualVersions || [];
    this._markDirty();
  }

  /**
   * 수동 버전 제거
   * @param {string} filePath - 제거할 버전의 파일 경로
   * @returns {boolean}
   */
  removeManualVersion(filePath) {
    if (!this._manualVersions) return false;

    const index = this._manualVersions.findIndex(
      (v) => v.filePath === filePath || v.path === filePath
    );

    if (index === -1) return false;

    this._manualVersions.splice(index, 1);
    this._markDirty();
    return true;
  }

  _markDirty({ eventType = null, event = null, scheduleAutoSave = false } = {}) {
    this.isDirty = true;
    this._changeRevision += 1;
    if (eventType) {
      this._emit('dataChanged', { event: eventType, data: event });
    }
    if (scheduleAutoSave && this.autoSaveEnabled && !this._savePromise) {
      this._scheduleAutoSave();
    }
  }

  _onFabricDrawingPersistenceChanged(change) {
    if (!this._fabricDrawingProviderLoadedForCurrentReview) return;
    this._fabricDrawingHasLocalChanges = true;
    this._markDirty({
      eventType: 'fabricDrawingChanged',
      event: change,
      scheduleAutoSave: true
    });
  }

  /**
   * 데이터 변경 이벤트 핸들러
   */
  _onDataChanged(e) {
    // 로딩 중이면 무시
    if (this.isLoading) return;

    this._markDirty({
      eventType: e.type,
      event: e,
      scheduleAutoSave: true
    });
  }

  /**
   * 자동 저장 스케줄링 (디바운스)
   */
  _scheduleAutoSave() {
    this._cancelAutoSave();

    this.autoSaveTimer = setTimeout(async () => {
      if (this.hasUnsavedChanges()) {
        log.info('자동 저장 실행');
        await this.save();
      }
    }, this.autoSaveDelay);
  }

  /**
   * 예약된 자동 저장 취소
   */
  _cancelAutoSave() {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 자동 저장 일시 중지 (로딩 중 데이터 초기화 시 사용)
   */
  pauseAutoSave() {
    this._cancelAutoSave();
    this.isLoading = true;
    log.info('자동 저장 일시 중지');
  }

  /**
   * 자동 저장 재개
   */
  resumeAutoSave() {
    this.isLoading = false;
    log.info('자동 저장 재개');
  }

  /**
   * 파일 경로에서 파일명 추출 (확장자 제외)
   * @deprecated schema.js의 extractFileNameWithoutExt 사용 권장
   */
  _getFileName(filePath) {
    return extractFileNameWithoutExt(filePath);
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * 실질 리뷰 데이터(댓글/드로잉/하이라이트/합성 레이어/수동 버전) 존재 여부.
   * fps·versionInfo 같은 자동 메타데이터만으로는 true가 되지 않는다. (피드백 20)
   */
  hasSubstantiveContent() {
    const hasComments = (this.commentManager?.layers || []).some(
      layer => Array.from(layer.markers?.values?.() || []).some(marker => marker && !marker.deleted)
    );
    const hasDrawings = (this.drawingManager?.layers || []).some(
      layer => (layer.keyframes?.length || 0) > 0
    );
    const fabricDrawingStatus =
      this._fabricDrawingProviderLoadedForCurrentReview
        ? this.fabricDrawingPersistenceProvider?.getStatus?.()
        : null;
    const hasFabricDrawings = fabricDrawingStatus?.state === 'ready' &&
      fabricDrawingStatus.compatible === true &&
      fabricDrawingStatus.objectCount > 0;
    const hasHighlights = (this.highlightManager?.highlights?.length || 0) > 0;
    const hasCompositionLayers = (this.compositionLayerManager?.layers?.length || 0) > 0;
    const hasManualVersions = (this._manualVersions?.length || 0) > 0;
    return hasComments || hasDrawings || hasFabricDrawings ||
      hasHighlights || hasCompositionLayers || hasManualVersions;
  }

  /**
   * 저장되지 않은 변경사항 있는지 확인
   */
  hasUnsavedChanges() {
    if (!this.isDirty) return false;
    // 파일이 아직 없고 실질 데이터도 없으면(fps 등 메타데이터만 dirty)
    // 파일을 만들 이유가 없으므로 저장할 변경사항 없음으로 취급한다. (피드백 20)
    if (!this._hasPersistedFile && !this.hasSubstantiveContent()) return false;
    return true;
  }

  /**
   * 현재 .bframe 경로 가져오기
   */
  getBframePath() {
    return this.currentBframePath;
  }

  /**
   * 현재 .bframe 파일이 실제로 존재하는 상태인지 반환
   */
  hasPersistedFile() {
    return this._hasPersistedFile;
  }
}

export default ReviewDataManager;
