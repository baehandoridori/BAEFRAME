/**
 * baeframe - Review Data Manager
 * .bframe 파일 저장/로드 관리
 */

import { createLogger } from '../logger.js';

const log = createLogger('ReviewDataManager');

// .bframe 파일 버전
const BFRAME_VERSION = '1.0';

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

    // 현재 상태
    this.currentVideoPath = null;
    this.currentBframePath = null;
    this.isDirty = false; // 저장되지 않은 변경사항 있음
    this.isLoading = false; // 로딩 중 (변경 이벤트 무시)

    // 자동 저장 설정
    this.autoSaveEnabled = options.autoSave !== false;
    this.autoSaveDelay = options.autoSaveDelay || 2000; // 2초 디바운스
    this.autoSaveTimer = null;

    // 이벤트 바인딩
    this._onDataChanged = this._onDataChanged.bind(this);

    log.info('ReviewDataManager 초기화됨', {
      autoSave: this.autoSaveEnabled,
      autoSaveDelay: this.autoSaveDelay
    });
  }

  /**
   * 매니저들 연결 및 이벤트 리스너 설정
   */
  connect() {
    if (this.commentManager) {
      this.commentManager.addEventListener('markerAdded', this._onDataChanged);
      this.commentManager.addEventListener('markerUpdated', this._onDataChanged);
      this.commentManager.addEventListener('markerDeleted', this._onDataChanged);
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

    this._cancelAutoSave();
    log.info('데이터 변경 이벤트 해제됨');
  }

  /**
   * 새 영상 파일 설정
   * @param {string} videoPath - 영상 파일 경로
   */
  async setVideoFile(videoPath) {
    // 이전 파일의 변경사항 저장
    if (this.isDirty && this.currentBframePath) {
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
   */
  async save() {
    if (!this.currentBframePath) {
      log.warn('저장할 파일 경로가 없음');
      return false;
    }

    this._cancelAutoSave();

    try {
      const data = this._collectData();

      await window.electronAPI.saveReview(this.currentBframePath, data);

      this.isDirty = false;

      log.info('.bframe 파일 저장됨', {
        path: this.currentBframePath,
        commentLayers: data.comments?.layers?.length || 0,
        drawingLayers: data.drawings?.layers?.length || 0
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
   * .bframe 파일에서 데이터 로드
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

      // 버전 체크
      if (data.version && data.version !== BFRAME_VERSION) {
        log.warn('버전 불일치', { file: data.version, current: BFRAME_VERSION });
      }

      // 데이터 적용
      this._applyData(data);

      this.isDirty = false;
      this.isLoading = false;

      log.info('.bframe 파일 로드됨', {
        path: this.currentBframePath,
        version: data.version,
        commentLayers: data.comments?.layers?.length || 0,
        drawingLayers: data.drawings?.layers?.length || 0
      });

      this._emit('loaded', { path: this.currentBframePath, data });

      return true;
    } catch (error) {
      log.error('.bframe 로드 실패', error);
      this.isLoading = false;
      this._emit('loadError', { error });
      return false;
    }
  }

  /**
   * 현재 모든 데이터 수집
   */
  _collectData() {
    const now = new Date().toISOString();

    return {
      version: BFRAME_VERSION,
      videoPath: this.currentVideoPath,
      videoName: this._getFileName(this.currentVideoPath),
      createdAt: this._createdAt || now,
      modifiedAt: now,
      comments: this.commentManager?.toJSON() || null,
      drawings: this.drawingManager?.exportData() || null
    };
  }

  /**
   * 로드한 데이터 적용
   */
  _applyData(data) {
    this._createdAt = data.createdAt;

    if (data.comments && this.commentManager) {
      this.commentManager.fromJSON(data.comments);
    }

    if (data.drawings && this.drawingManager) {
      this.drawingManager.importData(data.drawings);
    }
  }

  /**
   * 데이터 변경 이벤트 핸들러
   */
  _onDataChanged(e) {
    // 로딩 중이면 무시
    if (this.isLoading) return;

    this.isDirty = true;
    this._emit('dataChanged', { event: e.type });

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
   * 파일 경로에서 파일명 추출
   */
  _getFileName(filePath) {
    if (!filePath) return '';
    const parts = filePath.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1];
    const lastDot = fileName.lastIndexOf('.');
    return lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
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
