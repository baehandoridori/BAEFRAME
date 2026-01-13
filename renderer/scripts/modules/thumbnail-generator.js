/**
 * baeframe - Thumbnail Generator Module
 * 비디오 썸네일 사전 생성 및 캐싱
 *
 * 2단계 생성 방식:
 * - 1단계: 빠른 스캔 (5초 간격) → 빠르게 UI 해제
 * - 2단계: 백그라운드에서 세부 채움 (1초 간격)
 */

import { createLogger } from '../logger.js';

const log = createLogger('ThumbnailGenerator');

export class ThumbnailGenerator extends EventTarget {
  constructor(options = {}) {
    super();

    // 설정
    this.thumbnailWidth = options.thumbnailWidth || 160;
    this.thumbnailHeight = options.thumbnailHeight || 90;
    this.quickInterval = options.quickInterval || 5; // 1단계: 빠른 스캔 간격 (초)
    this.detailInterval = options.detailInterval || 1; // 2단계: 세부 간격 (초)
    this.quality = options.quality || 0.6; // JPEG 품질 (약간 낮춤)
    this.useCache = options.useCache !== false; // 디스크 캐싱 사용 여부 (기본: true)

    // 상태
    this.isGenerating = false;
    this.isQuickReady = false; // 1단계 완료 여부
    this.isFullReady = false;  // 2단계 완료 여부
    this.progress = 0;
    this.thumbnailMap = new Map(); // time -> dataUrl (빠른 검색용)
    this.sortedTimes = []; // 이진 탐색용 정렬된 시간 배열
    this.duration = 0;
    this.videoSrc = null;
    this.currentVideoHash = null; // 캐시 키

    // 캔버스 (오프스크린)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.thumbnailWidth;
    this.canvas.height = this.thumbnailHeight;
    this.ctx = this.canvas.getContext('2d');

    // 비디오 요소 (숨김)
    this.video = null;

    // 백그라운드 생성 제어
    this.abortController = null;

    log.info('ThumbnailGenerator 초기화됨', {
      thumbnailSize: `${this.thumbnailWidth}x${this.thumbnailHeight}`,
      quickInterval: this.quickInterval,
      detailInterval: this.detailInterval,
      useCache: this.useCache
    });
  }

  /**
   * 비디오에서 썸네일 생성 시작 (2단계)
   */
  async generate(videoSrc) {
    // 이전 작업 중단
    if (this.abortController) {
      this.abortController.abort();
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.isGenerating = true;
    this.isQuickReady = false;
    this.isFullReady = false;
    this.progress = 0;
    this.thumbnailMap.clear();
    this.sortedTimes = [];
    this.videoSrc = videoSrc;
    this.currentVideoHash = null;

    this._emit('start');

    try {
      // ===== 캐시 확인 =====
      if (this.useCache && window.electronAPI?.thumbnailCheckValid) {
        const cacheCheck = await window.electronAPI.thumbnailCheckValid(videoSrc);
        log.info('캐시 확인 결과', cacheCheck);

        if (cacheCheck.valid) {
          // 캐시에서 로드
          this.currentVideoHash = cacheCheck.videoHash;
          const cacheData = await window.electronAPI.thumbnailLoadAll(cacheCheck.videoHash);

          if (cacheData.success) {
            // 캐시된 썸네일 적용
            for (const [time, dataUrl] of Object.entries(cacheData.thumbnails)) {
              const roundedTime = Math.round(parseFloat(time) * 10) / 10;
              this.thumbnailMap.set(roundedTime, dataUrl);
            }
            this._rebuildSortedTimes();
            this.duration = cacheData.duration;

            this.isQuickReady = true;
            this.isFullReady = true;
            this.isGenerating = false;
            this.progress = 1;

            log.info('캐시에서 썸네일 로드 완료', { count: this.thumbnailMap.size });
            this._emit('quickReady', { count: this.thumbnailMap.size, fromCache: true });
            this._emit('complete', { count: this.thumbnailMap.size, fromCache: true });
            return;
          }
        } else {
          // 캐시가 없거나 무효 - videoHash 저장
          this.currentVideoHash = cacheCheck.videoHash;
        }
      }

      // ===== 새로 생성 =====
      // 비디오 요소 생성
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.preload = 'auto';

      // 비디오 로드
      await this._loadVideo(videoSrc);
      this.duration = this.video.duration;

      // ===== 1단계: 빠른 스캔 =====
      log.info('1단계: 빠른 스캔 시작', { interval: this.quickInterval });
      await this._generatePhase1(signal);

      if (signal.aborted) return;

      this.isQuickReady = true;
      this.isGenerating = false;

      log.info('1단계 완료 - UI 사용 가능', { count: this.thumbnailMap.size });
      this._emit('quickReady', { count: this.thumbnailMap.size });

      // ===== 2단계: 백그라운드에서 세부 채움 =====
      // 약간의 딜레이 후 시작 (UI 반응성 확보)
      await this._delay(100);

      if (signal.aborted) return;

      log.info('2단계: 세부 생성 시작 (백그라운드)', { interval: this.detailInterval });
      await this._generatePhase2(signal);

      if (signal.aborted) return;

      this.isFullReady = true;

      // 비디오 요소 정리
      this._cleanupVideo();

      // ===== 캐시 저장 =====
      await this._saveToCache();

      log.info('모든 썸네일 생성 완료', { count: this.thumbnailMap.size });
      this._emit('complete', { count: this.thumbnailMap.size });

    } catch (error) {
      if (error.name === 'AbortError') {
        log.info('썸네일 생성 중단됨');
        return;
      }
      log.error('썸네일 생성 실패', error);
      this.isGenerating = false;
      this._emit('error', { error });
    }
  }

  /**
   * 캐시에 썸네일 저장
   */
  async _saveToCache() {
    if (!this.useCache || !window.electronAPI?.thumbnailSaveBatch) {
      return;
    }

    if (!this.currentVideoHash || !this.videoSrc) {
      log.warn('캐시 저장 불가: videoHash 또는 videoSrc 없음');
      return;
    }

    try {
      // Map을 Object로 변환
      const thumbnails = {};
      for (const [time, dataUrl] of this.thumbnailMap.entries()) {
        thumbnails[time] = dataUrl;
      }

      const result = await window.electronAPI.thumbnailSaveBatch({
        videoPath: this.videoSrc,
        videoHash: this.currentVideoHash,
        duration: this.duration,
        thumbnails
      });

      if (result.success) {
        log.info('썸네일 캐시 저장 완료', { savedCount: result.savedCount });
      } else {
        log.warn('썸네일 캐시 저장 실패', result.error);
      }
    } catch (error) {
      log.error('썸네일 캐시 저장 오류', error);
    }
  }

  /**
   * 정렬된 시간 배열 재구성 (캐시 로드 시 사용)
   */
  _rebuildSortedTimes() {
    this.sortedTimes = Array.from(this.thumbnailMap.keys()).sort((a, b) => a - b);
  }

  /**
   * 1단계: 빠른 스캔 (큰 간격으로 전체 커버)
   */
  async _generatePhase1(signal) {
    const totalQuick = Math.ceil(this.duration / this.quickInterval);

    for (let i = 0; i < totalQuick; i++) {
      if (signal.aborted) return;

      const time = i * this.quickInterval;
      await this._seekAndCapture(time);

      // 진행률 (1단계는 0~80%)
      this.progress = ((i + 1) / totalQuick) * 0.8;
      this._emit('progress', {
        progress: this.progress,
        phase: 1,
        current: i + 1,
        total: totalQuick
      });
    }
  }

  /**
   * 2단계: 세부 채움 (사이사이 채우기)
   */
  async _generatePhase2(signal) {
    const timesToGenerate = [];

    // 1단계에서 생성되지 않은 시간 수집
    for (let time = 0; time < this.duration; time += this.detailInterval) {
      const roundedTime = Math.round(time * 10) / 10;
      if (!this.thumbnailMap.has(roundedTime)) {
        timesToGenerate.push(roundedTime);
      }
    }

    const total = timesToGenerate.length;
    if (total === 0) {
      this.progress = 1;
      return;
    }

    // 배치 처리 (UI 블로킹 방지)
    const batchSize = 5;
    for (let i = 0; i < total; i++) {
      if (signal.aborted) return;

      const time = timesToGenerate[i];
      await this._seekAndCapture(time);

      // 진행률 (2단계는 80~100%)
      this.progress = 0.8 + ((i + 1) / total) * 0.2;

      // 배치마다 이벤트 발생 (빈번한 업데이트 방지)
      if ((i + 1) % batchSize === 0 || i === total - 1) {
        this._emit('progress', {
          progress: this.progress,
          phase: 2,
          current: i + 1,
          total
        });
        // UI 반응성을 위해 잠시 양보
        await this._delay(0);
      }
    }
  }

  /**
   * 특정 시간으로 seek하고 캡처
   */
  async _seekAndCapture(time) {
    const roundedTime = Math.round(time * 10) / 10;

    // 이미 있으면 스킵
    if (this.thumbnailMap.has(roundedTime)) {
      return;
    }

    await this._seekTo(time);
    const dataUrl = this._captureFrame();
    this.thumbnailMap.set(roundedTime, dataUrl);

    // 정렬된 배열에 삽입 (이진 탐색 위치 찾기)
    this._insertSorted(roundedTime);
  }

  /**
   * 정렬된 배열에 시간 삽입
   */
  _insertSorted(time) {
    // 이진 탐색으로 삽입 위치 찾기
    let left = 0;
    let right = this.sortedTimes.length;

    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (this.sortedTimes[mid] < time) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    this.sortedTimes.splice(left, 0, time);
  }

  /**
   * 비디오 로드
   */
  _loadVideo(src) {
    return new Promise((resolve, reject) => {
      this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      this.video.addEventListener('error', (e) => reject(e), { once: true });
      this.video.src = src;
    });
  }

  /**
   * 특정 시간으로 seek (최적화)
   */
  _seekTo(time) {
    return new Promise((resolve) => {
      const onSeeked = () => {
        this.video.removeEventListener('seeked', onSeeked);
        // 프레임 렌더링 대기 (1프레임만)
        requestAnimationFrame(() => resolve());
      };

      this.video.addEventListener('seeked', onSeeked);
      this.video.currentTime = Math.min(time, this.video.duration - 0.1);
    });
  }

  /**
   * 현재 프레임 캡처
   */
  _captureFrame() {
    this.ctx.drawImage(
      this.video,
      0, 0,
      this.thumbnailWidth, this.thumbnailHeight
    );
    return this.canvas.toDataURL('image/jpeg', this.quality);
  }

  /**
   * 딜레이 헬퍼
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 비디오 정리
   */
  _cleanupVideo() {
    if (this.video) {
      this.video.src = '';
      this.video = null;
    }
  }

  /**
   * 특정 시간의 썸네일 dataUrl 가져오기 (이진 탐색)
   */
  getThumbnailUrlAt(time) {
    if (this.thumbnailMap.size === 0) {
      return null;
    }

    // 정확한 시간 먼저 찾기 (O(1))
    const roundedTime = Math.round(time * 10) / 10;
    if (this.thumbnailMap.has(roundedTime)) {
      return this.thumbnailMap.get(roundedTime);
    }

    // 정렬된 배열이 비어있으면 선형 탐색 (폴백)
    if (this.sortedTimes.length === 0) {
      return this._findClosestLinear(time);
    }

    // 이진 탐색으로 가장 가까운 시간 찾기 (O(log n))
    const closestTime = this._binarySearchClosest(time);
    return this.thumbnailMap.get(closestTime) || null;
  }

  /**
   * 이진 탐색으로 가장 가까운 시간 찾기
   */
  _binarySearchClosest(target) {
    const arr = this.sortedTimes;
    if (arr.length === 0) return 0;
    if (arr.length === 1) return arr[0];

    let left = 0;
    let right = arr.length - 1;

    // target이 범위 밖인 경우
    if (target <= arr[0]) return arr[0];
    if (target >= arr[right]) return arr[right];

    // 이진 탐색
    while (left < right - 1) {
      const mid = Math.floor((left + right) / 2);
      if (arr[mid] === target) {
        return arr[mid];
      } else if (arr[mid] < target) {
        left = mid;
      } else {
        right = mid;
      }
    }

    // left와 right 중 더 가까운 것 반환
    const leftDiff = Math.abs(arr[left] - target);
    const rightDiff = Math.abs(arr[right] - target);
    return leftDiff <= rightDiff ? arr[left] : arr[right];
  }

  /**
   * 선형 탐색 (폴백용)
   */
  _findClosestLinear(time) {
    let closestTime = 0;
    let minDiff = Infinity;

    for (const t of this.thumbnailMap.keys()) {
      const diff = Math.abs(t - time);
      if (diff < minDiff) {
        minDiff = diff;
        closestTime = t;
      }
    }

    return this.thumbnailMap.get(closestTime) || null;
  }

  /**
   * 준비 상태 확인
   */
  get isReady() {
    return this.isQuickReady || this.isFullReady;
  }

  /**
   * 메모리 정리
   */
  clear() {
    if (this.abortController) {
      this.abortController.abort();
    }
    this._cleanupVideo();
    this.thumbnailMap.clear();
    this.sortedTimes = [];
    this.currentVideoHash = null;
    this.isQuickReady = false;
    this.isFullReady = false;
    this.progress = 0;
    log.info('썸네일 캐시 정리됨');
  }

  /**
   * 이벤트 발생
   */
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// 싱글톤 인스턴스
let instance = null;

export function getThumbnailGenerator(options) {
  if (!instance) {
    instance = new ThumbnailGenerator(options);
  }
  return instance;
}
