/**
 * baeframe - Thumbnail Generator Module
 * 비디오 썸네일 사전 생성 및 캐싱
 */

import { createLogger } from '../logger.js';

const log = createLogger('ThumbnailGenerator');

export class ThumbnailGenerator extends EventTarget {
  constructor(options = {}) {
    super();

    // 설정
    this.thumbnailWidth = options.thumbnailWidth || 160;
    this.thumbnailHeight = options.thumbnailHeight || 90;
    this.interval = options.interval || 1; // 초 단위 간격
    this.quality = options.quality || 0.7; // JPEG 품질

    // 상태
    this.isGenerating = false;
    this.isReady = false;
    this.progress = 0;
    this.thumbnails = []; // { time, dataUrl }
    this.duration = 0;
    this.totalThumbnails = 0;

    // 캔버스 (오프스크린)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.thumbnailWidth;
    this.canvas.height = this.thumbnailHeight;
    this.ctx = this.canvas.getContext('2d');

    // 비디오 요소 (숨김)
    this.video = null;

    log.info('ThumbnailGenerator 초기화됨', {
      thumbnailSize: `${this.thumbnailWidth}x${this.thumbnailHeight}`,
      interval: this.interval
    });
  }

  /**
   * 비디오에서 썸네일 생성 시작
   */
  async generate(videoSrc) {
    if (this.isGenerating) {
      log.warn('이미 썸네일 생성 중');
      return;
    }

    this.isGenerating = true;
    this.isReady = false;
    this.progress = 0;
    this.thumbnails = [];

    this._emit('start');

    try {
      // 별도의 비디오 요소 생성
      this.video = document.createElement('video');
      this.video.muted = true;
      this.video.preload = 'auto';

      // 비디오 로드
      await this._loadVideo(videoSrc);

      this.duration = this.video.duration;
      this.totalThumbnails = Math.ceil(this.duration / this.interval);

      log.info('썸네일 생성 시작', {
        duration: this.duration,
        totalThumbnails: this.totalThumbnails
      });

      // 썸네일 생성
      for (let i = 0; i < this.totalThumbnails; i++) {
        const time = i * this.interval;

        // 해당 시간으로 seek
        await this._seekTo(time);

        // 프레임 캡처
        const dataUrl = this._captureFrame();

        this.thumbnails.push({
          time,
          index: i,
          dataUrl
        });

        // 진행률 업데이트
        this.progress = (i + 1) / this.totalThumbnails;
        this._emit('progress', { progress: this.progress, current: i + 1, total: this.totalThumbnails });
      }

      this.isReady = true;
      this.isGenerating = false;

      // 비디오 요소 정리
      this.video.src = '';
      this.video = null;

      log.info('썸네일 생성 완료', { count: this.thumbnails.length });
      this._emit('complete', { thumbnails: this.thumbnails });

    } catch (error) {
      log.error('썸네일 생성 실패', error);
      this.isGenerating = false;
      this._emit('error', { error });
    }
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
   * 특정 시간으로 seek
   */
  _seekTo(time) {
    return new Promise((resolve) => {
      const onSeeked = () => {
        this.video.removeEventListener('seeked', onSeeked);
        // 약간의 딜레이를 줘서 프레임이 완전히 렌더링되도록
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
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
   * 특정 시간의 썸네일 가져오기
   */
  getThumbnailAt(time) {
    if (!this.isReady || this.thumbnails.length === 0) {
      return null;
    }

    // 가장 가까운 썸네일 찾기
    const index = Math.min(
      Math.floor(time / this.interval),
      this.thumbnails.length - 1
    );

    return this.thumbnails[Math.max(0, index)];
  }

  /**
   * 특정 시간의 썸네일 dataUrl 가져오기
   */
  getThumbnailUrlAt(time) {
    const thumbnail = this.getThumbnailAt(time);
    return thumbnail ? thumbnail.dataUrl : null;
  }

  /**
   * 모든 썸네일 가져오기
   */
  getAllThumbnails() {
    return this.thumbnails;
  }

  /**
   * 메모리 정리
   */
  clear() {
    this.thumbnails = [];
    this.isReady = false;
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
