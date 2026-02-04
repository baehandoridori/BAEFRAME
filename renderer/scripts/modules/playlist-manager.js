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
    // 수정되었고 저장 경로가 있으면 파일로 저장
    if (this.isModified && this.playlistPath) {
      await this.save();
    }
    // 아이템이 있지만 파일로 저장되지 않은 경우 → localStorage 임시 저장
    else if (this.currentPlaylist && this.currentPlaylist.items.length > 0 && !this.playlistPath) {
      this._saveToLocalStorage();
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
      const thumbnailPath = await this._tryGenerateThumbnail(filePath);

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
      return { total: 0, resolved: 0, percent: 0, hasData: false };
    }

    try {
      const bframeData = await window.electronAPI.loadReview(bframePath);

      if (!bframeData) {
        return { total: 0, resolved: 0, percent: 0, hasData: false };
      }

      let total = 0;
      let resolved = 0;

      // comments.layers 구조 확인
      if (bframeData?.comments?.layers && Array.isArray(bframeData.comments.layers)) {
        for (const layer of bframeData.comments.layers) {
          if (layer?.markers && Array.isArray(layer.markers)) {
            for (const marker of layer.markers) {
              total++;
              if (marker.resolved) resolved++;
            }
          }
        }
      }

      const percent = total > 0 ? Math.round((resolved / total) * 100) : 0;
      return { total, resolved, percent, hasData: true };

    } catch (error) {
      log.warn('피드백 완료율 계산 실패', { bframePath, error: error.message });
      return { total: 0, resolved: 0, percent: 0, hasData: false };
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
    // 경로 정규화하여 비교 (대소문자, 슬래시 통일)
    const normalizedPath = videoPath.replace(/\\/g, '/').toLowerCase();
    return this.currentPlaylist.items.some(item => {
      const itemPath = item.videoPath.replace(/\\/g, '/').toLowerCase();
      return itemPath === normalizedPath;
    });
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

  /**
   * Canvas API를 사용하여 썸네일 생성 (ffmpeg 대체)
   * @param {string} videoPath - 비디오 파일 경로
   * @returns {Promise<string>} 썸네일 Data URL 또는 빈 문자열
   */
  async _generateThumbnailWithCanvas(videoPath) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      // 파일 URL로 변환
      const fileUrl = `file://${videoPath.replace(/\\/g, '/')}`;

      const cleanup = () => {
        video.removeEventListener('loadeddata', onLoaded);
        video.removeEventListener('error', onError);
        video.src = '';
        video.remove();
      };

      const onLoaded = () => {
        // 첫 프레임 이동
        video.currentTime = 0.1;
      };

      const onSeeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const width = 160;
          const height = 90;
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            // 비율 유지하면서 중앙 정렬
            const videoRatio = video.videoWidth / video.videoHeight;
            const canvasRatio = width / height;

            let drawWidth, drawHeight, offsetX, offsetY;
            if (videoRatio > canvasRatio) {
              drawHeight = height;
              drawWidth = height * videoRatio;
              offsetX = (width - drawWidth) / 2;
              offsetY = 0;
            } else {
              drawWidth = width;
              drawHeight = width / videoRatio;
              offsetX = 0;
              offsetY = (height - drawHeight) / 2;
            }

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            cleanup();
            resolve(dataUrl);
          } else {
            cleanup();
            resolve('');
          }
        } catch (err) {
          log.warn('Canvas 렌더링 오류', { error: err.message });
          cleanup();
          resolve('');
        }
      };

      const onError = () => {
        log.warn('비디오 로드 실패 (Canvas 방식)', { videoPath });
        cleanup();
        resolve('');
      };

      video.addEventListener('loadeddata', onLoaded);
      video.addEventListener('seeked', onSeeked, { once: true });
      video.addEventListener('error', onError);

      // 타임아웃
      setTimeout(() => {
        cleanup();
        resolve('');
      }, 5000);

      video.src = fileUrl;
      video.load();
    });
  }

  async _validateThumbnails() {
    if (!this.currentPlaylist) return;

    let thumbnailsUpdated = false;

    for (const item of this.currentPlaylist.items) {
      // Data URL은 항상 유효
      if (item.thumbnailPath && item.thumbnailPath.startsWith('data:')) {
        continue;
      }

      if (item.thumbnailPath) {
        try {
          const exists = await window.electronAPI.fileExists(item.thumbnailPath);
          if (!exists) {
            // 썸네일 재생성
            log.info('썸네일 재생성 시도', { fileName: item.fileName });
            const newPath = await this._tryGenerateThumbnail(item.videoPath);
            if (newPath !== item.thumbnailPath) {
              item.thumbnailPath = newPath;
              thumbnailsUpdated = true;
            }
          }
        } catch (err) {
          log.warn('썸네일 검증 실패', { fileName: item.fileName, error: err.message });
          item.thumbnailPath = '';
          thumbnailsUpdated = true;
        }
      } else {
        // 썸네일이 없으면 생성
        log.info('새 썸네일 생성 시도', { fileName: item.fileName });
        const newPath = await this._tryGenerateThumbnail(item.videoPath);
        if (newPath) {
          item.thumbnailPath = newPath;
          thumbnailsUpdated = true;
          log.info('썸네일 생성 성공', { fileName: item.fileName });
        }
      }
    }

    // 썸네일이 업데이트되었으면 저장 필요 표시
    if (thumbnailsUpdated) {
      this.isModified = true;
    }
  }

  /**
   * 썸네일 생성 시도 (ffmpeg 먼저, 실패 시 Canvas)
   * @param {string} videoPath - 비디오 파일 경로
   * @returns {Promise<string>} 썸네일 경로/URL 또는 빈 문자열
   */
  async _tryGenerateThumbnail(videoPath) {
    try {
      // ffmpeg 시도
      const result = await window.electronAPI.generateVideoThumbnail(videoPath);
      if (result.success) {
        return result.path;
      }
    } catch (err) {
      log.warn('ffmpeg 썸네일 생성 실패', { error: err.message });
    }

    // Canvas API 대체
    try {
      const dataUrl = await this._generateThumbnailWithCanvas(videoPath);
      return dataUrl || '';
    } catch (err) {
      log.warn('Canvas 썸네일 생성 실패', { error: err.message });
      return '';
    }
  }

  // ========================================
  // localStorage 임시 저장/복원
  // ========================================

  _saveToLocalStorage() {
    try {
      const data = JSON.stringify({
        playlist: this.currentPlaylist,
        currentIndex: this.currentIndex,
        savedAt: new Date().toISOString()
      });
      localStorage.setItem('baeframe_temp_playlist', data);
      log.info('재생목록 임시 저장 (localStorage)');
    } catch (err) {
      log.warn('localStorage 저장 실패', { error: err.message });
    }
  }

  _restoreFromLocalStorage() {
    try {
      const raw = localStorage.getItem('baeframe_temp_playlist');
      if (!raw) return null;

      const data = JSON.parse(raw);
      if (!data.playlist || !validatePlaylistData(data.playlist)) return null;

      // 24시간 이상 된 데이터는 무시
      const savedAt = new Date(data.savedAt);
      if (Date.now() - savedAt.getTime() > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('baeframe_temp_playlist');
        return null;
      }

      return data;
    } catch (err) {
      log.warn('localStorage 복원 실패', { error: err.message });
      return null;
    }
  }

  _clearLocalStorage() {
    localStorage.removeItem('baeframe_temp_playlist');
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
