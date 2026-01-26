/**
 * BAEFRAME 재생목록 매니저
 *
 * 재생목록 CRUD, 파일 I/O, 네비게이션 담당
 */

import { createLogger } from '../logger.js';

const log = createLogger('PlaylistManager');

// 스키마 함수들을 동적으로 가져올 수 없으므로 여기서 필요한 것들을 재정의
const PLAYLIST_VERSION = '1.0';
const MAX_PLAYLIST_ITEMS = 50;
const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

/**
 * 고유 ID 생성
 */
function generatePlaylistId(prefix = 'playlist') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * 아이템 ID 생성
 */
function generateItemId() {
  return generatePlaylistId('item');
}

/**
 * 파일 경로에서 파일명 추출
 */
function extractFileName(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * 파일명 안전하게 변환
 */
function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || '재생목록';
}

/**
 * 비디오 파일 확인
 */
function isVideoFile(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
}

/**
 * 기본 재생목록 데이터 생성
 */
function createDefaultPlaylistData(options = {}) {
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
 */
function createPlaylistItem(videoPath, bframePath = '') {
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

/**
 * 재생목록 데이터 유효성 검증
 */
function validatePlaylistData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  if (!data.playlistVersion || !data.id || !Array.isArray(data.items)) {
    return false;
  }
  return true;
}

/**
 * PlaylistManager 클래스
 */
export class PlaylistManager {
  constructor() {
    this.currentPlaylist = null;      // 현재 열린 재생목록 데이터
    this.playlistPath = null;         // 현재 재생목록 파일 경로
    this.currentIndex = -1;           // 현재 재생 중인 아이템 인덱스
    this.isModified = false;          // 변경 여부
    this.autoSaveTimer = null;

    // 이벤트 콜백
    this.onPlaylistLoaded = null;     // (playlist) => {}
    this.onItemSelected = null;       // (item, index) => {}
    this.onPlaylistModified = null;   // () => {}
    this.onPlaylistClosed = null;     // () => {}
    this.onError = null;              // (error) => {}

    log.info('PlaylistManager 초기화');
  }

  // ========================================
  // 재생목록 생성/열기/저장
  // ========================================

  /**
   * 새 재생목록 생성
   */
  createNew(name = '새 재생목록') {
    log.info('새 재생목록 생성', { name });

    // 기존 재생목록이 수정되었으면 저장
    if (this.isModified && this.currentPlaylist) {
      this.save().catch(err => log.warn('자동 저장 실패', err));
    }

    this.currentPlaylist = createDefaultPlaylistData({
      name,
      userName: window.appState?.userName || '',
      userId: window.appState?.sessionId || ''
    });
    this.playlistPath = null;
    this.currentIndex = -1;
    this.isModified = true;

    this.onPlaylistLoaded?.(this.currentPlaylist);
    return this.currentPlaylist;
  }

  /**
   * 기존 재생목록 파일 열기
   */
  async open(filePath) {
    log.info('재생목록 열기', { filePath });

    try {
      // 기존 재생목록이 수정되었으면 저장
      if (this.isModified && this.playlistPath) {
        await this.save();
      }

      const data = await window.electronAPI.readPlaylist(filePath);

      if (!data) {
        throw new Error('재생목록 파일을 찾을 수 없습니다.');
      }

      if (!validatePlaylistData(data)) {
        throw new Error('유효하지 않은 재생목록 파일입니다.');
      }

      this.currentPlaylist = data;
      this.playlistPath = filePath;
      this.currentIndex = data.items.length > 0 ? 0 : -1;
      this.isModified = false;

      // 썸네일 경로 검증 및 재생성
      await this._validateThumbnails();

      this.onPlaylistLoaded?.(this.currentPlaylist);
      log.info('재생목록 로드 완료', {
        name: data.name,
        itemCount: data.items.length
      });

      return this.currentPlaylist;

    } catch (error) {
      log.error('재생목록 열기 실패', { filePath, error: error.message });
      this.onError?.(error);
      throw error;
    }
  }

  /**
   * 재생목록 저장
   */
  async save(savePath = null) {
    if (!this.currentPlaylist) {
      log.warn('저장할 재생목록 없음');
      return false;
    }

    let targetPath = savePath || this.playlistPath;

    if (!targetPath) {
      // 새 재생목록: 첫 번째 아이템의 폴더에 저장
      if (this.currentPlaylist.items.length === 0) {
        throw new Error('저장할 아이템이 없습니다. 먼저 영상을 추가해주세요.');
      }

      const firstItemPath = this.currentPlaylist.items[0].videoPath;
      const folderPath = await window.electronAPI.pathDirname(firstItemPath);
      const fileName = sanitizeFileName(this.currentPlaylist.name);
      targetPath = await window.electronAPI.pathJoin(folderPath, `${fileName}.bplaylist`);
    }

    log.info('재생목록 저장', { path: targetPath });

    this.currentPlaylist.modifiedAt = new Date().toISOString();

    await window.electronAPI.writePlaylist(targetPath, this.currentPlaylist);
    this.playlistPath = targetPath;
    this.isModified = false;

    log.info('재생목록 저장 완료');
    return true;
  }

  /**
   * 재생목록 닫기
   */
  async close() {
    if (this.isModified && this.playlistPath) {
      await this.save();
    }

    log.info('재생목록 닫기');

    this.currentPlaylist = null;
    this.playlistPath = null;
    this.currentIndex = -1;
    this.isModified = false;

    this.onPlaylistClosed?.();
  }

  /**
   * 재생목록 삭제
   */
  async delete() {
    if (!this.playlistPath) {
      this.close();
      return;
    }

    log.info('재생목록 삭제', { path: this.playlistPath });

    await window.electronAPI.deletePlaylist(this.playlistPath);

    this.currentPlaylist = null;
    this.playlistPath = null;
    this.currentIndex = -1;
    this.isModified = false;

    this.onPlaylistClosed?.();
  }

  // ========================================
  // 아이템 관리
  // ========================================

  /**
   * 아이템 추가
   */
  async addItems(filePaths) {
    if (!this.currentPlaylist) {
      this.createNew();
    }

    const currentCount = this.currentPlaylist.items.length;
    const availableSlots = MAX_PLAYLIST_ITEMS - currentCount;

    if (availableSlots <= 0) {
      throw new Error(`재생목록은 최대 ${MAX_PLAYLIST_ITEMS}개까지 추가할 수 있습니다.`);
    }

    const pathsToAdd = filePaths.slice(0, availableSlots);
    const addedItems = [];

    log.info('아이템 추가 시작', { count: pathsToAdd.length });

    for (const filePath of pathsToAdd) {
      // 영상 파일인지 확인
      if (!isVideoFile(filePath)) {
        log.warn('비디오 파일이 아님', { filePath });
        continue;
      }

      // 중복 확인
      if (this._isDuplicate(filePath)) {
        log.warn('중복 파일', { filePath });
        continue;
      }

      // .bframe 파일 경로 추론
      const bframePath = await this._findBframePath(filePath);

      // 썸네일 생성 (비동기, 실패해도 계속)
      let thumbnailPath = '';
      try {
        const thumbnailResult = await window.electronAPI.generateVideoThumbnail(filePath);
        if (thumbnailResult.success) {
          thumbnailPath = thumbnailResult.path;
        }
      } catch (err) {
        log.warn('썸네일 생성 실패', { filePath, error: err.message });
      }

      const item = createPlaylistItem(filePath, bframePath);
      item.order = this.currentPlaylist.items.length;
      item.thumbnailPath = thumbnailPath;

      this.currentPlaylist.items.push(item);
      addedItems.push(item);
    }

    if (addedItems.length > 0) {
      this.isModified = true;
      this.onPlaylistModified?.();

      // 첫 번째 아이템이면 자동 선택
      if (this.currentIndex === -1) {
        this.selectItem(0);
      }

      log.info('아이템 추가 완료', { added: addedItems.length });
    }

    return addedItems;
  }

  /**
   * 아이템 제거
   */
  removeItem(itemId) {
    if (!this.currentPlaylist) return;

    const index = this.currentPlaylist.items.findIndex(item => item.id === itemId);
    if (index === -1) return;

    log.info('아이템 제거', { itemId, index });

    this.currentPlaylist.items.splice(index, 1);

    // order 재정렬
    this.currentPlaylist.items.forEach((item, i) => {
      item.order = i;
    });

    // 현재 인덱스 조정
    if (this.currentIndex >= this.currentPlaylist.items.length) {
      this.currentIndex = this.currentPlaylist.items.length - 1;
    } else if (this.currentIndex === index) {
      // 현재 재생 중인 아이템이 삭제된 경우
      // 다음 아이템 또는 이전 아이템 선택
      if (this.currentIndex >= this.currentPlaylist.items.length) {
        this.currentIndex = this.currentPlaylist.items.length - 1;
      }
    } else if (this.currentIndex > index) {
      this.currentIndex--;
    }

    this.isModified = true;
    this.onPlaylistModified?.();
  }

  /**
   * 아이템 순서 변경
   */
  reorderItem(fromIndex, toIndex) {
    if (!this.currentPlaylist) return;
    if (fromIndex === toIndex) return;

    const items = this.currentPlaylist.items;
    if (fromIndex < 0 || fromIndex >= items.length) return;
    if (toIndex < 0 || toIndex >= items.length) return;

    log.info('아이템 순서 변경', { fromIndex, toIndex });

    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);

    // order 재정렬
    items.forEach((item, i) => {
      item.order = i;
    });

    // 현재 인덱스 조정
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }

    this.isModified = true;
    this.onPlaylistModified?.();
  }

  // ========================================
  // 재생 네비게이션
  // ========================================

  /**
   * 특정 아이템 선택
   */
  selectItem(index) {
    if (!this.currentPlaylist || index < 0 || index >= this.currentPlaylist.items.length) {
      return null;
    }

    this.currentIndex = index;
    const item = this.currentPlaylist.items[index];

    log.info('아이템 선택', { index, fileName: item.fileName });

    this.onItemSelected?.(item, index);
    return item;
  }

  /**
   * ID로 아이템 선택
   */
  selectItemById(itemId) {
    if (!this.currentPlaylist) return null;

    const index = this.currentPlaylist.items.findIndex(item => item.id === itemId);
    if (index === -1) return null;

    return this.selectItem(index);
  }

  /**
   * 다음 아이템으로 이동
   */
  next() {
    if (!this.currentPlaylist) return null;

    if (this.currentIndex < this.currentPlaylist.items.length - 1) {
      return this.selectItem(this.currentIndex + 1);
    }
    return null;
  }

  /**
   * 이전 아이템으로 이동
   */
  prev() {
    if (!this.currentPlaylist) return null;

    if (this.currentIndex > 0) {
      return this.selectItem(this.currentIndex - 1);
    }
    return null;
  }

  /**
   * 다음 아이템 있는지 확인
   */
  hasNext() {
    if (!this.currentPlaylist) return false;
    return this.currentIndex < this.currentPlaylist.items.length - 1;
  }

  /**
   * 이전 아이템 있는지 확인
   */
  hasPrev() {
    if (!this.currentPlaylist) return false;
    return this.currentIndex > 0;
  }

  /**
   * 현재 아이템 가져오기
   */
  getCurrentItem() {
    if (!this.currentPlaylist || this.currentIndex === -1) {
      return null;
    }
    return this.currentPlaylist.items[this.currentIndex];
  }

  // ========================================
  // 피드백 완료율 계산
  // ========================================

  /**
   * 개별 아이템의 피드백 완료율 계산
   */
  async getItemProgress(bframePath) {
    if (!bframePath) {
      return { total: 0, resolved: 0, percent: 0 };
    }

    try {
      const bframeData = await window.electronAPI.loadReview(bframePath);

      let total = 0;
      let resolved = 0;

      if (bframeData?.comments?.layers) {
        for (const layer of bframeData.comments.layers) {
          for (const marker of layer.markers || []) {
            total++;
            if (marker.resolved) resolved++;
          }
        }
      }

      const percent = total > 0 ? Math.round((resolved / total) * 100) : 0;
      return { total, resolved, percent };

    } catch (error) {
      return { total: 0, resolved: 0, percent: 0 };
    }
  }

  /**
   * 전체 재생목록 피드백 완료율 계산
   */
  async getTotalProgress() {
    if (!this.currentPlaylist) {
      return { total: 0, resolved: 0, percent: 0 };
    }

    let totalMarkers = 0;
    let resolvedMarkers = 0;

    for (const item of this.currentPlaylist.items) {
      const progress = await this.getItemProgress(item.bframePath);
      totalMarkers += progress.total;
      resolvedMarkers += progress.resolved;
    }

    const percent = totalMarkers > 0 ? Math.round((resolvedMarkers / totalMarkers) * 100) : 0;
    return { total: totalMarkers, resolved: resolvedMarkers, percent };
  }

  // ========================================
  // 설정
  // ========================================

  setAutoPlay(enabled) {
    if (this.currentPlaylist) {
      this.currentPlaylist.settings.autoPlay = enabled;
      this.isModified = true;
    }
  }

  getAutoPlay() {
    return this.currentPlaylist?.settings?.autoPlay || false;
  }

  setFloatingMode(enabled) {
    if (this.currentPlaylist) {
      this.currentPlaylist.settings.floatingMode = enabled;
      this.isModified = true;
    }
  }

  setName(name) {
    if (this.currentPlaylist) {
      this.currentPlaylist.name = name;
      this.isModified = true;
      this.onPlaylistModified?.();
    }
  }

  getName() {
    return this.currentPlaylist?.name || '';
  }

  // ========================================
  // 유틸리티 (private)
  // ========================================

  _isDuplicate(videoPath) {
    if (!this.currentPlaylist) return false;
    return this.currentPlaylist.items.some(item => item.videoPath === videoPath);
  }

  async _findBframePath(videoPath) {
    const basePath = videoPath.replace(/\.[^/.]+$/, '');
    const bframePath = `${basePath}.bframe`;

    try {
      const exists = await window.electronAPI.fileExists(bframePath);
      return exists ? bframePath : '';
    } catch {
      return '';
    }
  }

  async _validateThumbnails() {
    if (!this.currentPlaylist) return;

    for (const item of this.currentPlaylist.items) {
      if (item.thumbnailPath) {
        try {
          const exists = await window.electronAPI.fileExists(item.thumbnailPath);
          if (!exists) {
            // 썸네일 재생성
            const result = await window.electronAPI.generateVideoThumbnail(item.videoPath);
            item.thumbnailPath = result.success ? result.path : '';
          }
        } catch {
          item.thumbnailPath = '';
        }
      } else {
        // 썸네일이 없으면 생성
        try {
          const result = await window.electronAPI.generateVideoThumbnail(item.videoPath);
          item.thumbnailPath = result.success ? result.path : '';
        } catch {
          // 무시
        }
      }
    }
  }

  // ========================================
  // 상태 확인
  // ========================================

  isActive() {
    return this.currentPlaylist !== null;
  }

  isEmpty() {
    return !this.currentPlaylist || this.currentPlaylist.items.length === 0;
  }

  getItemCount() {
    return this.currentPlaylist?.items?.length || 0;
  }

  getItems() {
    return this.currentPlaylist?.items || [];
  }
}

// ========================================
// 싱글톤 인스턴스
// ========================================

let instance = null;

export function getPlaylistManager() {
  if (!instance) {
    instance = new PlaylistManager();
  }
  return instance;
}

export default PlaylistManager;
