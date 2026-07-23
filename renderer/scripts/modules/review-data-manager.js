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

function getNextPrefixedId(prefix, usedIds) {
  let maxId = 0;
  for (const id of usedIds) {
    const match = String(id).match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) {
      maxId = Math.max(maxId, parseInt(match[1], 10));
    }
  }

  let nextId = maxId + 1;
  let candidate = `${prefix}-${nextId}`;
  while (usedIds.has(candidate)) {
    nextId += 1;
    candidate = `${prefix}-${nextId}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function hasDrawingLayerContent(layer) {
  return (layer?.keyframes || []).some(keyframe => {
    return !keyframe?.isEmpty
      || !!keyframe?.canvasData
      || !!keyframe?.baseCanvasData
      || (keyframe?.strokeRecords || []).length > 0;
  });
}

function mergeDrawingData(localData = {}, remoteData = {}) {
  const localLayers = Array.isArray(localData?.layers) ? localData.layers : [];
  const remoteLayers = Array.isArray(remoteData?.layers) ? remoteData.layers : [];
  const usedIds = new Set(localLayers.map(layer => layer.id).filter(Boolean));
  const mergedLayers = localLayers.map(layer => cloneJson(layer));

  for (const remoteLayer of remoteLayers) {
    const remoteCopy = cloneJson(remoteLayer);
    const existingIndex = mergedLayers.findIndex(layer => layer.id === remoteCopy.id);

    if (existingIndex === -1) {
      usedIds.add(remoteCopy.id);
      mergedLayers.push(remoteCopy);
      continue;
    }

    const localLayer = mergedLayers[existingIndex];
    if (jsonEquals(localLayer, remoteCopy)) continue;

    const localHasContent = hasDrawingLayerContent(localLayer);
    const remoteHasContent = hasDrawingLayerContent(remoteCopy);

    if (!localHasContent && remoteHasContent) {
      usedIds.add(remoteCopy.id);
      mergedLayers[existingIndex] = remoteCopy;
    } else if (remoteHasContent) {
      remoteCopy.id = getNextPrefixedId('layer', usedIds);
      remoteCopy.name = `${remoteCopy.name || '원격 드로잉'} (원격)`;
      mergedLayers.push(remoteCopy);
    }
  }

  const activeLayerId = mergedLayers.some(layer => layer.id === localData?.activeLayerId)
    ? localData.activeLayerId
    : remoteData?.activeLayerId || mergedLayers[0]?.id || null;

  return {
    ...remoteData,
    ...localData,
    layers: mergedLayers,
    activeLayerId
  };
}

function getHighlightList(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.highlights) ? data.highlights : [];
}

function mergeHighlightData(localData = {}, remoteData = {}) {
  const localHighlights = getHighlightList(localData);
  const remoteHighlights = getHighlightList(remoteData);
  const usedIds = new Set(localHighlights.map(highlight => highlight.id).filter(Boolean));
  const mergedHighlights = localHighlights.map(highlight => cloneJson(highlight));

  for (const remoteHighlight of remoteHighlights) {
    const remoteCopy = cloneJson(remoteHighlight);
    const existingIndex = mergedHighlights.findIndex(highlight => highlight.id === remoteCopy.id);

    if (existingIndex === -1) {
      usedIds.add(remoteCopy.id);
      mergedHighlights.push(remoteCopy);
      continue;
    }

    if (jsonEquals(mergedHighlights[existingIndex], remoteCopy)) continue;

    remoteCopy.id = getNextPrefixedId('highlight', usedIds);
    mergedHighlights.push(remoteCopy);
  }

  return {
    ...(Array.isArray(remoteData) ? {} : remoteData),
    ...(Array.isArray(localData) ? {} : localData),
    highlights: mergedHighlights
  };
}

function mergeManualVersions(localVersions = [], remoteVersions = []) {
  const merged = Array.isArray(localVersions) ? localVersions.map(version => cloneJson(version)) : [];
  const keySet = new Set(merged.map(version => version.filePath || version.path || version.fileName).filter(Boolean));

  for (const remoteVersion of Array.isArray(remoteVersions) ? remoteVersions : []) {
    const key = remoteVersion.filePath || remoteVersion.path || remoteVersion.fileName;
    if (key && keySet.has(key)) continue;
    if (key) keySet.add(key);
    merged.push(cloneJson(remoteVersion));
  }

  return merged;
}

function mergeCompositionLayers(localLayers = [], remoteLayers = []) {
  const merged = Array.isArray(localLayers) ? localLayers.map(layer => cloneJson(layer)) : [];
  const usedIds = new Set(merged.map(layer => layer.id).filter(Boolean));

  for (const remoteLayer of Array.isArray(remoteLayers) ? remoteLayers : []) {
    const remoteCopy = cloneJson(remoteLayer);
    const existingIndex = merged.findIndex(layer => layer.id === remoteCopy.id);

    if (existingIndex === -1) {
      usedIds.add(remoteCopy.id);
      merged.push(remoteCopy);
      continue;
    }

    if (jsonEquals(merged[existingIndex], remoteCopy)) continue;

    remoteCopy.id = `composition_${Date.now()}_${getNextPrefixedId('remote', usedIds)}`;
    remoteCopy.name = `${remoteCopy.name || '원격 합성 레이어'} (원격)`;
    remoteCopy.order = merged.length;
    usedIds.add(remoteCopy.id);
    merged.push(remoteCopy);
  }

  return merged
    .map((layer, index) => ({ ...layer, order: Number.isFinite(layer.order) ? layer.order : index }))
    .sort((a, b) => a.order - b.order);
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
    this._changeRevision = 0;
    this._hasPersistedFile = false;
    this._beforeSaveHandler = null;
    this._initialSaveConflictHandler = null;
    this._opaqueRootFields = {};
    this._fabricDrawingPersistenceContext = {};
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    this._fabricDrawingHasLocalChanges = false;
    this._fabricDrawingCollectedRevision = null;
    this._fabricDrawingProviderUnsubscribe = null;
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
    this._disconnectFabricDrawingPersistenceProvider();
    this.fabricDrawingPersistenceProvider = provider || null;
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
    // 자동 저장 일시 중지 및 대기 중인 저장 취소
    this._cancelAutoSave();
    this.isLoading = true;

    // 이전 파일의 변경사항 저장 (skipSave가 true면 건너뛰기)
    if (!options.skipSave && this.hasUnsavedChanges() && this.currentBframePath) {
      await this.save();
    }

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
    const loaded = await this.load();

    // 로딩 완료 후 isLoading 해제 (load() 내부에서도 설정하지만 여기서 확실히 해제)
    this.isLoading = false;

    this._emit('videoFileSet', {
      videoPath: this.currentVideoPath,
      bframePath: this.currentBframePath,
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
    this._savePromise = Promise.resolve().then(() => this._doSave(options));

    try {
      return await this._savePromise;
    } finally {
      this._savePromise = null;
    }
  }

  /**
   * 실제 저장 수행 (내부용)
   */
  async _doSave(_options = {}) {
    try {
      let savedData = null;
      let savedChangeRevision = null;
      let savedFabricDrawingRevision = null;
      let lastConflictResult = null;
      const maxAttempts = 5;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const wasInitialPersist = !this._hasPersistedFile;

        if (this._beforeSaveHandler) {
          await this._beforeSaveHandler({
            path: this.currentBframePath,
            videoPath: this.currentVideoPath,
            hasPersistedFile: this._hasPersistedFile,
            options: _options
          });
        }

        await this._refreshRootEnvelopeBeforeSave();
        this._assertRootEnvelopeWritable();
        this._ensureReviewDocumentId();
        const data = this._collectData();
        const attemptChangeRevision = this._changeRevision;
        const attemptFabricDrawingRevision = this._fabricDrawingCollectedRevision;

        // Liveblocks 연결 시 CRDT가 머지를 처리하므로 _mergeBeforeSave 불필요
        // 로컬 .bframe 스냅샷만 저장 (오프라인 백업 역할)
        if (this._liveblocksManager?.isConnected) {
          // liveblocksRoomId 포함
          data.liveblocksRoomId = this._liveblocksManager.roomId || null;
        }

        const saveResult = await window.electronAPI.saveReview(this.currentBframePath, data, {
          failIfExists: wasInitialPersist
        });

        if (saveResult?.exists === true && wasInitialPersist) {
          log.info('첫 .bframe 저장 충돌 감지, 기존 파일과 병합 시도', {
            path: this.currentBframePath
          });
          lastConflictResult = await this._initialSaveConflictHandler?.({
            path: this.currentBframePath,
            videoPath: this.currentVideoPath
          });

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

        this._hasPersistedFile = true;
        this._reviewDocumentIdPersisted = true;
        savedData = data;
        savedChangeRevision = attemptChangeRevision;
        savedFabricDrawingRevision = attemptFabricDrawingRevision;
        break;
      }

      if (!savedData) {
        throw new Error(lastConflictResult?.error || '첫 .bframe 저장 충돌 병합 실패');
      }

      const hasConcurrentChanges = this._changeRevision !== savedChangeRevision;
      this.isDirty = hasConcurrentChanges;
      this._acknowledgeFabricDrawingSave(savedFabricDrawingRevision);

      log.info('.bframe 파일 저장됨', {
        path: this.currentBframePath,
        commentLayers: savedData?.comments?.layers?.length || 0,
        drawingLayers: savedData?.drawings?.layers?.length || 0,
        liveblocksConnected: !!this._liveblocksManager?.isConnected
      });

      this._emit('saved', { path: this.currentBframePath });

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
   * 저장 전 원격 데이터와 머지
   * @param {Object} localData - 로컬에서 수집한 데이터
   * @returns {Promise<Object>} 머지된 데이터
   */
  async _mergeBeforeSave(localData) {
    try {
      const remoteData = await window.electronAPI.loadReview(this.currentBframePath);

      if (!remoteData) {
        // 원격 파일 없음 → 로컬 데이터 그대로 저장
        return localData;
      }

      // 협업 중이면 항상 머지 (타임스탬프와 무관하게)
      // 개별 댓글의 updatedAt으로 충돌 해결
      if (remoteData.comments?.layers && localData.comments?.layers) {
        const { merged, added, updated } = mergeLayers(
          localData.comments.layers,
          remoteData.comments.layers
        );
        localData.comments.layers = merged;

        if (added > 0 || updated > 0) {
          log.info('저장 전 댓글 머지 완료', { added, updated });
        }
      }

      // 드로잉은 타임스탬프 기반 (전체 교체)
      // 주의: localData.modifiedAt은 _collectData()에서 now로 설정되므로 사용 불가
      // 파일에서 로드된 원래 시간인 this._modifiedAt을 사용해야 원격 최신 변경 보호 가능
      const localModified = new Date(this._modifiedAt || 0).getTime();
      const remoteModified = new Date(remoteData.modifiedAt || 0).getTime();

      if (remoteModified > localModified && remoteData.drawings) {
        // 원격 드로잉이 더 최신이면 원격 데이터로 교체 (다른 협업자 작업 보호)
        localData.drawings = remoteData.drawings;
        log.info('원격 드로잉이 더 최신, 원격 데이터로 교체');
      }

      if (remoteData.highlights) {
        localData.highlights = mergeHighlightData(localData.highlights, remoteData.highlights);
      }

      if (remoteData.compositionLayers) {
        localData.compositionLayers = mergeCompositionLayers(
          localData.compositionLayers,
          remoteData.compositionLayers
        );
      }

      if (remoteData.manualVersions) {
        localData.manualVersions = mergeManualVersions(localData.manualVersions, remoteData.manualVersions);
      }

      if (!localData.versionInfo && remoteData.versionInfo) {
        localData.versionInfo = remoteData.versionInfo;
      }

      if (!localData.liveblocksRoomId && remoteData.liveblocksRoomId) {
        localData.liveblocksRoomId = remoteData.liveblocksRoomId;
      }

      // 머지 후 modifiedAt 갱신
      localData.modifiedAt = new Date().toISOString();

      return localData;

    } catch (error) {
      log.warn('저장 전 머지 실패, 로컬 데이터로 저장', { error: error.message });
      return localData;
    }
  }

  /**
   * .bframe 파일에서 데이터 로드 (마이그레이션 포함)
   */
  async load() {
    if (!this.currentBframePath) {
      log.warn('로드할 파일 경로가 없음');
      return false;
    }

    try {
      this.isLoading = true;

      const data = await window.electronAPI.loadReview(this.currentBframePath);

      if (!data) {
        log.info('.bframe 파일 없음 (새 리뷰)', { path: this.currentBframePath });
        this.compositionLayerManager?.fromJSON?.([]);
        this._hasPersistedFile = false;
        this._resetRootEnvelopeState();
        this._resetFabricDrawingPersistenceProvider();
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
        const backupCreated = await this._createBackup();
        if (!backupCreated) {
          log.warn('백업 생성 실패, 마이그레이션 계속 진행');
        }

        try {
          migratedData = migrateToV2(data);
          log.info('마이그레이션 성공', { version: migratedData.bframeVersion });

          // 마이그레이션 후 자동 저장 (새 스키마로 업데이트)
          this._shouldSaveAfterMigration = true;
        } catch (migrationError) {
          log.error('마이그레이션 실패', migrationError);

          // 백업에서 복구 시도
          if (backupCreated) {
            const restored = await this._restoreFromBackup();
            if (restored) {
              log.info('백업에서 복구됨');
              migratedData = restored;
            }
          }

          this._emit('migrationError', { error: migrationError });
        }
      }

      // 데이터 적용
      this._applyData(migratedData);

      this.isDirty = false;
      this.isLoading = false;

      log.info('.bframe 파일 로드됨', {
        path: this.currentBframePath,
        version: migratedData.bframeVersion || migratedData.version,
        commentLayers: migratedData.comments?.layers?.length || 0,
        drawingLayers: migratedData.drawings?.layers?.length || 0
      });

      this._emit('loaded', { path: this.currentBframePath, data: migratedData });

      // 마이그레이션 후 자동 저장
      if (this._shouldSaveAfterMigration) {
        this._shouldSaveAfterMigration = false;
        // 약간의 딜레이 후 저장 (데이터 적용 완료 보장)
        setTimeout(() => this.save(), 100);
      }

      return true;
    } catch (error) {
      log.error('.bframe 로드 실패', error);
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

    // 미저장 작업 보호: isDirty이고 force가 아니면 머지만 하고 덮어쓰기 방지
    if (this.isDirty && !options.force) {
      log.info('reloadAndMerge: 미저장 작업 있음 - 안전 머지 모드');
      // 강제 머지 모드로 전환 (로컬 데이터 유지하면서 원격 추가분만 반영)
      options.merge = true;
      options.preserveLocal = true;
    }

    // 자동저장 일시 중지
    this._cancelAutoSave();
    const wasLoading = this.isLoading;
    this.isLoading = true;

    try {
      // 원격 데이터 로드
      const remoteData = await window.electronAPI.loadReview(this.currentBframePath);

      if (!remoteData) {
        log.info('reloadAndMerge: 원격 파일 없음');
        this.isLoading = wasLoading;
        return { success: false, added: 0, updated: 0 };
      }

      const retainIdentityWhenMissing = !this._reviewDocumentIdPersisted;
      const allowIdentityReplacement = options.merge === false;
      this._captureRootEnvelope(remoteData, {
        retainIdentityWhenMissing,
        allowIdentityReplacement
      });
      if (!allowIdentityReplacement) {
        this._assertRootEnvelopeWritable();
      }
      this._hasPersistedFile = true;

      const result = { added: 0, updated: 0 };

      if (options.merge && this.commentManager) {
        // 로컬 댓글 데이터 수집
        const localComments = this.commentManager.toJSON();

        // 원격과 머지
        if (remoteData.comments?.layers && localComments.layers) {
          const mergeResult = mergeLayers(
            localComments.layers,
            remoteData.comments.layers
          );

          result.added = mergeResult.added;
          result.updated = mergeResult.updated;

          // 변경이 있으면 머지된 데이터 적용
          if (mergeResult.added > 0 || mergeResult.updated > 0) {
            // 댓글 매니저에 머지된 데이터 적용
            this.commentManager.fromJSON({ layers: mergeResult.merged });

            log.info('reloadAndMerge: 댓글 머지 완료', {
              added: result.added,
              updated: result.updated
            });
          }
        }

        // 드로잉 데이터 머지
        if (options.preserveLocal && remoteData.drawings && this.drawingManager) {
          const mergedDrawings = mergeDrawingData(this.drawingManager.exportData(), remoteData.drawings);
          this.drawingManager.importData(mergedDrawings);
          log.info('reloadAndMerge: 드로잉 데이터 보존 병합 완료', {
            layers: mergedDrawings.layers?.length || 0
          });
        } else if (remoteData.drawings && this.drawingManager) {
          const localModified = new Date(this._modifiedAt || 0).getTime();
          const remoteModified = new Date(remoteData.modifiedAt || 0).getTime();

          if (remoteModified > localModified) {
            this.drawingManager.importData(remoteData.drawings);
            log.info('reloadAndMerge: 드로잉 데이터 업데이트됨');
          }
        }

        // 하이라이트 데이터
        if (options.preserveLocal && remoteData.highlights && this.highlightManager) {
          const mergedHighlights = mergeHighlightData(this.highlightManager.toJSON(), remoteData.highlights);
          this.highlightManager.fromJSON(mergedHighlights);
          log.info('reloadAndMerge: 하이라이트 데이터 보존 병합 완료', {
            highlights: mergedHighlights.highlights?.length || 0
          });
        } else if (remoteData.highlights && this.highlightManager) {
          const localModified = new Date(this._modifiedAt || 0).getTime();
          const remoteModified = new Date(remoteData.modifiedAt || 0).getTime();

          if (remoteModified > localModified) {
            this.highlightManager.fromJSON(remoteData.highlights);
            log.info('reloadAndMerge: 하이라이트 데이터 업데이트됨');
          }
        }

        if (remoteData.liveblocksRoomId && !this._liveblocksRoomId) {
          this._liveblocksRoomId = remoteData.liveblocksRoomId;
        }

        if (remoteData.versionInfo && !this._versionInfo) {
          this._versionInfo = remoteData.versionInfo;
        }

        if (remoteData.manualVersions) {
          this._manualVersions = mergeManualVersions(this._manualVersions, remoteData.manualVersions);
        }

        if (Array.isArray(remoteData.compositionLayers) && this.compositionLayerManager) {
          const mergedCompositionLayers = mergeCompositionLayers(
            this.compositionLayerManager.toJSON(),
            remoteData.compositionLayers
          );
          this.compositionLayerManager.fromJSON(mergedCompositionLayers);
          log.info('reloadAndMerge: 합성 레이어 데이터 병합 완료', {
            layers: mergedCompositionLayers.length
          });
        }

        if (remoteData.modifiedAt && toTime(remoteData.modifiedAt) > toTime(this._modifiedAt)) {
          this._modifiedAt = remoteData.modifiedAt;
        }

      } else {
        // 덮어쓰기 모드: 원격 데이터로 전체 교체
        this._applyData(remoteData, { allowIdentityReplacement: true });
        log.info('reloadAndMerge: 데이터 덮어쓰기 완료');
      }

      this.isLoading = wasLoading;
      this._emit('reloaded', {
        merged: options.merge,
        added: result.added,
        updated: result.updated
      });

      return { success: true, ...result };

    } catch (error) {
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
  async _createBackup() {
    if (!this.currentBframePath) return false;

    const backupPath = this.currentBframePath + '.bak';

    try {
      await window.electronAPI.copyFile(this.currentBframePath, backupPath);
      log.info('백업 생성됨', { path: backupPath });
      return true;
    } catch (error) {
      // copyFile API가 없으면 읽고 쓰기로 대체
      try {
        const data = await window.electronAPI.loadReview(this.currentBframePath);
        if (data) {
          await window.electronAPI.saveReview(backupPath, data);
          log.info('백업 생성됨 (대체 방식)', { path: backupPath });
          return true;
        }
      } catch (fallbackError) {
        log.warn('백업 생성 실패', fallbackError);
      }
      return false;
    }
  }

  /**
   * 백업에서 데이터 복구
   * @returns {Promise<Object|null>} 복구된 데이터 또는 null
   */
  async _restoreFromBackup() {
    if (!this.currentBframePath) return null;

    const backupPath = this.currentBframePath + '.bak';

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
  async _deleteBackup() {
    if (!this.currentBframePath) return false;

    const backupPath = this.currentBframePath + '.bak';

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
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    if (typeof this.fabricDrawingPersistenceProvider?.reset !== 'function') return null;

    try {
      const result = this.fabricDrawingPersistenceProvider.reset(
        this._fabricDrawingPersistenceContext
      );
      this._fabricDrawingProviderLoadedForCurrentReview =
        result?.accepted === true || result?.preserved === true;
      return result;
    } catch (error) {
      log.warn('Fabric 드로잉 새 문서 초기화 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  _importFabricDrawingPersistenceRoot(data) {
    this._fabricDrawingHasLocalChanges = false;
    this._fabricDrawingCollectedRevision = null;
    this._fabricDrawingProviderLoadedForCurrentReview = false;
    if (typeof this.fabricDrawingPersistenceProvider?.importRootValue !== 'function') {
      return null;
    }

    const rawValue = Object.hasOwn(data, 'drawingsV3')
      ? data.drawingsV3
      : undefined;
    try {
      const result = this.fabricDrawingPersistenceProvider.importRootValue(
        rawValue,
        this._fabricDrawingPersistenceContext
      );
      this._fabricDrawingProviderLoadedForCurrentReview =
        result?.accepted === true || result?.preserved === true;
      return result;
    } catch (error) {
      log.warn('Fabric 드로잉 문서 불러오기 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
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
  }

  async _refreshRootEnvelopeBeforeSave() {
    if (!this._hasPersistedFile) return;

    const latestRoot = await window.electronAPI.loadReview(this.currentBframePath);
    if (!latestRoot || typeof latestRoot !== 'object' || Array.isArray(latestRoot)) {
      throw new Error('최신 .bframe root를 다시 읽지 못해 저장을 중단했습니다.');
    }

    this._captureRootEnvelope(latestRoot, {
      retainIdentityWhenMissing: !this._reviewDocumentIdPersisted
    });
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
  _collectData() {
    const now = new Date().toISOString();
    const videoFile = extractFileName(this.currentVideoPath);
    this._collectFabricDrawingPersistenceRoot();

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
      manualVersions: this._manualVersions || [],

      // 리뷰 데이터
      comments: this.commentManager?.toJSON() || { layers: [] },
      drawings: this.drawingManager?.exportData() || { layers: [] },
      highlights: this.highlightManager?.toJSON() || [],
      compositionLayers: this.compositionLayerManager?.toJSON() || []
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
    this._importFabricDrawingPersistenceRoot(data);

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
      this.highlightManager.fromJSON(data.highlights);
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
