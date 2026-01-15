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
  needsMigration,
  migrateToV2,
  extractFileName,
  extractFileNameWithoutExt
} from '../../../shared/schema.js';
import { mergeLayers } from './collaboration-manager.js';

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

    // 현재 상태
    this.currentVideoPath = null;
    this.currentBframePath = null;
    this.isDirty = false; // 저장되지 않은 변경사항 있음
    this.isLoading = false; // 로딩 중 (변경 이벤트 무시)

    // 자동 저장 설정
    this.autoSaveEnabled = options.autoSave !== false;
    this.autoSaveDelay = options.autoSaveDelay || 500; // 500ms (타이핑 완료 후 저장)
    this.autoSaveTimer = null;

    // 이벤트 바인딩
    this._onDataChanged = this._onDataChanged.bind(this);

    // 협업 매니저 연결 (저장 전 머지용)
    this._collaborationManager = null;

    log.info('ReviewDataManager 초기화됨', {
      autoSave: this.autoSaveEnabled,
      autoSaveDelay: this.autoSaveDelay
    });
  }

  /**
   * CollaborationManager 연결 (협업 중 저장 시 머지용)
   * @param {CollaborationManager} manager
   */
  setCollaborationManager(manager) {
    this._collaborationManager = manager;
    log.info('CollaborationManager 연결됨');
  }

  /**
   * 매니저들 연결 및 이벤트 리스너 설정
   */
  connect() {
    if (this.commentManager) {
      this.commentManager.addEventListener('markerAdded', this._onDataChanged);
      this.commentManager.addEventListener('markerUpdated', this._onDataChanged);
      this.commentManager.addEventListener('markerDeleted', this._onDataChanged);
      this.commentManager.addEventListener('replyAdded', this._onDataChanged);
      this.commentManager.addEventListener('layerAdded', this._onDataChanged);
      this.commentManager.addEventListener('layerRemoved', this._onDataChanged);
    }

    if (this.drawingManager) {
      this.drawingManager.addEventListener('drawend', this._onDataChanged);
      this.drawingManager.addEventListener('layerCreated', this._onDataChanged);
      this.drawingManager.addEventListener('layerDeleted', this._onDataChanged);
      this.drawingManager.addEventListener('activeLayerChanged', this._onDataChanged);
      this.drawingManager.addEventListener('keyframeAdded', this._onDataChanged);
      this.drawingManager.addEventListener('keyframeRemoved', this._onDataChanged);
      this.drawingManager.addEventListener('undo', this._onDataChanged);
      this.drawingManager.addEventListener('redo', this._onDataChanged);
    }

    if (this.highlightManager) {
      this.highlightManager.addEventListener('changed', this._onDataChanged);
    }

    log.info('데이터 변경 이벤트 연결됨');
  }

  /**
   * 이벤트 리스너 해제
   */
  disconnect() {
    if (this.commentManager) {
      this.commentManager.removeEventListener('markerAdded', this._onDataChanged);
      this.commentManager.removeEventListener('markerUpdated', this._onDataChanged);
      this.commentManager.removeEventListener('markerDeleted', this._onDataChanged);
      this.commentManager.removeEventListener('replyAdded', this._onDataChanged);
      this.commentManager.removeEventListener('layerAdded', this._onDataChanged);
      this.commentManager.removeEventListener('layerRemoved', this._onDataChanged);
    }

    if (this.drawingManager) {
      this.drawingManager.removeEventListener('drawend', this._onDataChanged);
      this.drawingManager.removeEventListener('layerCreated', this._onDataChanged);
      this.drawingManager.removeEventListener('layerDeleted', this._onDataChanged);
      this.drawingManager.removeEventListener('activeLayerChanged', this._onDataChanged);
      this.drawingManager.removeEventListener('keyframeAdded', this._onDataChanged);
      this.drawingManager.removeEventListener('keyframeRemoved', this._onDataChanged);
      this.drawingManager.removeEventListener('undo', this._onDataChanged);
      this.drawingManager.removeEventListener('redo', this._onDataChanged);
    }

    if (this.highlightManager) {
      this.highlightManager.removeEventListener('changed', this._onDataChanged);
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
    if (!options.skipSave && this.isDirty && this.currentBframePath) {
      await this.save();
    }

    this.currentVideoPath = videoPath;
    this.currentBframePath = getBframePath(videoPath);
    this.isDirty = false;

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
   * @param {Object} options
   * @param {boolean} options.skipMerge - true면 머지 없이 저장 (초기 저장 등)
   */
  async save(options = {}) {
    if (!this.currentBframePath) {
      log.warn('저장할 파일 경로가 없음');
      return false;
    }

    this._cancelAutoSave();

    try {
      let data = this._collectData();

      // 협업 중이면 머지 후 저장 (덮어쓰기 방지)
      if (!options.skipMerge && this._collaborationManager?.hasOtherCollaborators()) {
        data = await this._mergeBeforeSave(data);
      }

      await window.electronAPI.saveReview(this.currentBframePath, data);

      this.isDirty = false;

      log.info('.bframe 파일 저장됨', {
        path: this.currentBframePath,
        commentLayers: data.comments?.layers?.length || 0,
        drawingLayers: data.drawings?.layers?.length || 0,
        merged: !options.skipMerge && this._collaborationManager?.hasOtherCollaborators()
      });

      this._emit('saved', { path: this.currentBframePath });

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

      // modifiedAt 비교
      const localModified = new Date(localData.modifiedAt).getTime();
      const remoteModified = new Date(remoteData.modifiedAt || 0).getTime();

      if (remoteModified <= localModified) {
        // 로컬이 더 최신 또는 동일 → 로컬 그대로 저장
        return localData;
      }

      // 원격이 더 최신 → 댓글 머지
      if (remoteData.comments?.layers && localData.comments?.layers) {
        const { merged } = mergeLayers(
          localData.comments.layers,
          remoteData.comments.layers
        );
        localData.comments.layers = merged;

        log.info('저장 전 댓글 머지 완료');
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
        this.isLoading = false;
        return false;
      }

      // 버전 확인 및 마이그레이션
      const dataVersion = getDataVersion(data);
      let migratedData = data;

      if (needsMigration(data)) {
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
   * @returns {Promise<{success: boolean, added: number, updated: number}>}
   */
  async reloadAndMerge(options = { merge: true }) {
    if (!this.currentBframePath) {
      log.warn('reloadAndMerge: 파일 경로가 없음');
      return { success: false, added: 0, updated: 0 };
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

        // 드로잉 데이터 머지 (원격이 더 최신이면 적용)
        if (remoteData.drawings && this.drawingManager) {
          const localModified = new Date(this._modifiedAt || 0).getTime();
          const remoteModified = new Date(remoteData.modifiedAt || 0).getTime();

          if (remoteModified > localModified) {
            this.drawingManager.importData(remoteData.drawings);
            log.info('reloadAndMerge: 드로잉 데이터 업데이트됨');
          }
        }

        // 하이라이트 데이터 (원격이 더 최신이면 적용)
        if (remoteData.highlights && this.highlightManager) {
          const localModified = new Date(this._modifiedAt || 0).getTime();
          const remoteModified = new Date(remoteData.modifiedAt || 0).getTime();

          if (remoteModified > localModified) {
            this.highlightManager.fromJSON(remoteData.highlights);
            log.info('reloadAndMerge: 하이라이트 데이터 업데이트됨');
          }
        }

      } else {
        // 덮어쓰기 모드: 원격 데이터로 전체 교체
        this._applyData(remoteData);
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

  /**
   * 현재 모든 데이터 수집 (v2.0 스키마)
   */
  _collectData() {
    const now = new Date().toISOString();
    const videoFile = extractFileName(this.currentVideoPath);

    return {
      // v2.0 스키마 필드
      bframeVersion: BFRAME_VERSION,
      videoFile: videoFile,
      videoPath: this.currentVideoPath,
      fps: this._fps || 24,
      createdAt: this._createdAt || now,
      modifiedAt: now,

      // 버전 관리 필드
      versionInfo: this._versionInfo || null,
      manualVersions: this._manualVersions || [],

      // 리뷰 데이터
      comments: this.commentManager?.toJSON() || { layers: [] },
      drawings: this.drawingManager?.exportData() || { layers: [] },
      highlights: this.highlightManager?.toJSON() || []
    };
  }

  /**
   * 로드한 데이터 적용 (v2.0 스키마)
   */
  _applyData(data) {
    // 메타데이터
    this._createdAt = data.createdAt;
    this._fps = data.fps || 24;

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
  }

  /**
   * FPS 설정
   * @param {number} fps
   */
  setFps(fps) {
    if (typeof fps === 'number' && fps > 0) {
      this._fps = fps;
      this.isDirty = true;
    }
  }

  /**
   * 현재 FPS 가져오기
   * @returns {number}
   */
  getFps() {
    return this._fps || 24;
  }

  /**
   * 버전 정보 설정
   * @param {Object} versionInfo
   */
  setVersionInfo(versionInfo) {
    this._versionInfo = versionInfo;
    this.isDirty = true;
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
    this.isDirty = true;
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
    this.isDirty = true;
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
    this.isDirty = true;
    return true;
  }

  /**
   * 데이터 변경 이벤트 핸들러
   */
  _onDataChanged(e) {
    // 로딩 중이면 무시
    if (this.isLoading) return;

    this.isDirty = true;
    this._emit('dataChanged', { event: e.type });

    // 협업 매니저에 활동 기록 (동기화 간격 동적 조정용)
    if (this._collaborationManager) {
      this._collaborationManager.recordActivity();
    }

    // 자동 저장 스케줄
    if (this.autoSaveEnabled) {
      this._scheduleAutoSave();
    }
  }

  /**
   * 자동 저장 스케줄링 (디바운스)
   */
  _scheduleAutoSave() {
    this._cancelAutoSave();

    this.autoSaveTimer = setTimeout(async () => {
      if (this.isDirty) {
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
   * 저장되지 않은 변경사항 있는지 확인
   */
  hasUnsavedChanges() {
    return this.isDirty;
  }

  /**
   * 현재 .bframe 경로 가져오기
   */
  getBframePath() {
    return this.currentBframePath;
  }
}

export default ReviewDataManager;
