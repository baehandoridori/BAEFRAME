/**
 * baeframe - Video Player Module
 * HTML5 Video를 기본으로 사용하고, 나중에 mpv로 교체 가능하도록 추상화
 */

import { createLogger } from '../logger.js';

const log = createLogger('VideoPlayer');

/**
 * 비디오 플레이어 클래스
 * EventTarget을 상속하여 이벤트 기반 통신 지원
 */
export class VideoPlayer extends EventTarget {
  constructor(options = {}) {
    super();

    this.videoElement = options.videoElement || document.getElementById('videoPlayer');
    this.container = options.container || document.getElementById('videoWrapper');
    this.fps = options.fps || 24;

    // 상태
    this.isLoaded = false;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.currentFrame = 0;
    this.totalFrames = 0;
    this.filePath = null;

    // 구간 반복 설정
    this.loop = {
      enabled: false,
      inPoint: null,   // 시작점 (초)
      outPoint: null   // 종료점 (초)
    };

    // 수동 seek 중 플래그 (timeupdate가 프레임을 덮어쓰지 않도록)
    this._isSeeking = false;
    this._seekTimeout = null;

    // 프레임 콜백 상태
    this._frameCallbackId = null;
    this._lastEmittedFrame = -1;

    // 초기화
    this._setupEventListeners();

    log.info('VideoPlayer 초기화됨', { fps: this.fps });
  }

  /**
   * 이벤트 리스너 설정
   */
  _setupEventListeners() {
    const video = this.videoElement;

    // 메타데이터 로드됨
    video.addEventListener('loadedmetadata', () => {
      this.duration = video.duration;
      this.totalFrames = Math.floor(this.duration * this.fps);
      this.isLoaded = true;

      // 상세 비디오 정보 로깅 (디버깅용)
      log.info('메타데이터 로드됨', {
        duration: this.duration,
        totalFrames: this.totalFrames,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        networkState: video.networkState
      });

      // 비디오 크기가 0이면 경고 (코덱 문제 가능성)
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        log.warn('비디오 크기가 0입니다. 코덱 호환성 문제일 수 있습니다.');
      }

      this._emit('loadedmetadata', {
        duration: this.duration,
        totalFrames: this.totalFrames,
        fps: this.fps
      });
    });

    // 첫 프레임 로드됨 (실제 렌더링 가능 상태)
    video.addEventListener('loadeddata', () => {
      log.info('비디오 데이터 로드됨', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        currentSrc: video.currentSrc
      });
    });

    // 재생 위치 변경
    video.addEventListener('timeupdate', () => {
      // 수동 seek 중에는 프레임 계산을 건너뜀 (이미 정확한 값이 설정됨)
      if (this._isSeeking) {
        this._emit('timeupdate', {
          currentTime: this.currentTime,
          currentFrame: this.currentFrame
        });
        return;
      }

      this.currentTime = video.currentTime;
      // 부동소수점 오차 보정: 약간의 여유를 두고 반올림
      this.currentFrame = Math.round(this.currentTime * this.fps - 0.0001);
      this.currentFrame = Math.max(0, this.currentFrame);

      // 구간 반복 처리
      if (this.loop.enabled && this.isPlaying &&
          this.loop.inPoint !== null && this.loop.outPoint !== null) {
        if (this.currentTime >= this.loop.outPoint) {
          this.seek(this.loop.inPoint);
          this._emit('loopRestart');
          return;
        }
      }

      this._emit('timeupdate', {
        currentTime: this.currentTime,
        currentFrame: this.currentFrame
      });
    });

    // 재생 시작
    video.addEventListener('play', () => {
      this.isPlaying = true;
      this._emit('play');
      this._startFrameCallback();
    });

    // 일시정지
    video.addEventListener('pause', () => {
      this.isPlaying = false;
      this._emit('pause');
      this._stopFrameCallback();
    });

    // 재생 종료
    video.addEventListener('ended', () => {
      this.isPlaying = false;
      this._emit('ended');
    });

    // 에러
    video.addEventListener('error', (e) => {
      const error = video.error;
      log.error('비디오 에러', {
        code: error?.code,
        message: error?.message
      });
      this._emit('error', { error });
    });

    // 버퍼링
    video.addEventListener('waiting', () => {
      this._emit('buffering', { buffering: true });
    });

    video.addEventListener('canplay', () => {
      this._emit('buffering', { buffering: false });
    });
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  /**
   * 프레임 콜백 시작 (requestVideoFrameCallback 또는 requestAnimationFrame 폴백)
   */
  _startFrameCallback() {
    if (this._frameCallbackId) return;

    const video = this.videoElement;

    // requestVideoFrameCallback이 지원되는 경우 (Chrome 83+, Edge 83+)
    if ('requestVideoFrameCallback' in video) {
      const onFrame = (now, metadata) => {
        if (!this.isPlaying) return;

        // 정확한 프레임 번호 계산
        const frame = Math.round(metadata.mediaTime * this.fps);

        if (frame !== this._lastEmittedFrame) {
          this._lastEmittedFrame = frame;
          this.currentFrame = frame;
          this.currentTime = metadata.mediaTime;

          this._emit('frameUpdate', {
            frame,
            time: metadata.mediaTime,
            presentedFrames: metadata.presentedFrames
          });
        }

        this._frameCallbackId = video.requestVideoFrameCallback(onFrame);
      };

      this._frameCallbackId = video.requestVideoFrameCallback(onFrame);
      log.debug('requestVideoFrameCallback 사용');
    } else {
      // 폴백: requestAnimationFrame
      const onFrame = () => {
        if (!this.isPlaying) return;

        const frame = Math.round(video.currentTime * this.fps);

        if (frame !== this._lastEmittedFrame) {
          this._lastEmittedFrame = frame;
          this.currentFrame = frame;
          this.currentTime = video.currentTime;

          this._emit('frameUpdate', {
            frame,
            time: video.currentTime
          });
        }

        this._frameCallbackId = requestAnimationFrame(onFrame);
      };

      this._frameCallbackId = requestAnimationFrame(onFrame);
      log.debug('requestAnimationFrame 폴백 사용');
    }
  }

  /**
   * 프레임 콜백 정지
   */
  _stopFrameCallback() {
    if (!this._frameCallbackId) return;

    const video = this.videoElement;

    if ('requestVideoFrameCallback' in video && video.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this._frameCallbackId);
    } else {
      cancelAnimationFrame(this._frameCallbackId);
    }

    this._frameCallbackId = null;
  }

  /**
   * 비디오 파일 로드
   * @param {string} filePath - 파일 경로
   * @returns {Promise<void>}
   */
  async load(filePath) {
    const trace = log.trace('load');

    try {
      this.filePath = filePath;
      this.isLoaded = false;

      // file:// 프로토콜로 로컬 파일 로드
      const videoUrl = filePath.startsWith('file://') ? filePath : `file://${filePath}`;

      this.videoElement.src = videoUrl;
      this.videoElement.style.display = 'block';

      // 메타데이터 로드 대기
      await new Promise((resolve, reject) => {
        const onLoaded = () => {
          this.videoElement.removeEventListener('loadedmetadata', onLoaded);
          this.videoElement.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e) => {
          this.videoElement.removeEventListener('loadedmetadata', onLoaded);
          this.videoElement.removeEventListener('error', onError);
          reject(new Error('비디오 로드 실패'));
        };

        this.videoElement.addEventListener('loadedmetadata', onLoaded);
        this.videoElement.addEventListener('error', onError);
      });

      trace.end({ filePath, duration: this.duration });
      this._emit('loaded', { filePath, duration: this.duration });

    } catch (error) {
      trace.error(error);
      throw error;
    }
  }

  /**
   * 재생
   */
  play() {
    if (!this.isLoaded) {
      log.warn('비디오가 로드되지 않음');
      return;
    }
    this.videoElement.play();
    log.debug('재생');
  }

  /**
   * 일시정지
   */
  pause() {
    this.videoElement.pause();
    log.debug('일시정지');
  }

  /**
   * 재생/일시정지 토글
   */
  togglePlay() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * 특정 시간으로 이동 (초)
   * @param {number} time - 이동할 시간 (초)
   */
  seek(time) {
    if (!this.isLoaded) return;

    time = Math.max(0, Math.min(time, this.duration));

    // 내부 상태 즉시 업데이트 (timeupdate 이벤트 전에)
    this.currentTime = time;
    this.currentFrame = Math.floor(time * this.fps);

    this.videoElement.currentTime = time;
    log.debug('시간 이동', { time, frame: this.currentFrame });
  }

  /**
   * 특정 프레임으로 이동
   * @param {number} frame - 이동할 프레임 번호
   */
  seekToFrame(frame) {
    if (!this.isLoaded) return;

    frame = Math.max(0, Math.min(frame, this.totalFrames - 1));
    const time = frame / this.fps;

    // seeking 플래그 설정 (timeupdate가 프레임을 덮어쓰지 않도록)
    this._isSeeking = true;
    if (this._seekTimeout) {
      clearTimeout(this._seekTimeout);
    }

    // 프레임 번호 직접 설정 (시간에서 재계산하지 않음)
    this.currentFrame = frame;
    this.currentTime = time;

    this.videoElement.currentTime = time;

    // 100ms 후 seeking 플래그 해제
    this._seekTimeout = setTimeout(() => {
      this._isSeeking = false;
    }, 100);

    log.debug('프레임 이동', { frame, time });
  }

  /**
   * 이전 프레임으로 이동
   */
  prevFrame() {
    this.seekToFrame(this.currentFrame - 1);
  }

  /**
   * 다음 프레임으로 이동
   */
  nextFrame() {
    this.seekToFrame(this.currentFrame + 1);
  }

  /**
   * 처음으로 이동
   */
  seekToStart() {
    this.seek(0);
  }

  /**
   * 끝으로 이동
   */
  seekToEnd() {
    this.seek(this.duration - 0.001);
  }

  /**
   * n초 뒤로 이동
   * @param {number} seconds
   */
  rewind(seconds = 1) {
    const newTime = Math.max(0, this.currentTime - seconds);
    this.seek(newTime);
  }

  /**
   * n초 앞으로 이동
   * @param {number} seconds
   */
  forward(seconds = 1) {
    const newTime = Math.min(this.duration, this.currentTime + seconds);
    this.seek(newTime);
  }

  /**
   * 볼륨 설정
   * @param {number} volume - 0~1
   */
  setVolume(volume) {
    this.videoElement.volume = Math.max(0, Math.min(1, volume));
  }

  /**
   * 음소거 토글
   */
  toggleMute() {
    this.videoElement.muted = !this.videoElement.muted;
    return this.videoElement.muted;
  }

  /**
   * FPS 설정
   * @param {number} fps
   */
  setFps(fps) {
    this.fps = fps;
    if (this.isLoaded) {
      this.totalFrames = Math.floor(this.duration * this.fps);
    }
    log.info('FPS 변경', { fps });
  }

  /**
   * 현재 프레임 번호 계산
   * @returns {number}
   */
  getCurrentFrame() {
    return Math.floor(this.currentTime * this.fps);
  }

  /**
   * 시간을 타임코드로 변환
   * @param {number} time - 시간 (초)
   * @returns {string} HH:MM:SS:FF 형식
   */
  timeToTimecode(time) {
    const totalFrames = Math.floor(time * this.fps);
    const frames = totalFrames % this.fps;
    const totalSeconds = Math.floor(time);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const hours = Math.floor(totalSeconds / 3600);

    return [
      String(hours).padStart(2, '0'),
      String(minutes).padStart(2, '0'),
      String(seconds).padStart(2, '0'),
      String(frames).padStart(2, '0')
    ].join(':');
  }

  /**
   * 현재 시간의 타임코드
   * @returns {string}
   */
  getCurrentTimecode() {
    return this.timeToTimecode(this.currentTime);
  }

  /**
   * 총 시간의 타임코드
   * @returns {string}
   */
  getDurationTimecode() {
    return this.timeToTimecode(this.duration);
  }

  /**
   * 비디오 크기 정보
   * @returns {{ width: number, height: number, aspectRatio: number }}
   */
  getVideoSize() {
    return {
      width: this.videoElement.videoWidth,
      height: this.videoElement.videoHeight,
      aspectRatio: this.videoElement.videoWidth / this.videoElement.videoHeight
    };
  }

  // ====== 구간 반복 ======

  /**
   * 시작점(In Point) 설정
   * @param {number|null} time - 시작점 시간 (초), null이면 해제
   */
  setInPoint(time) {
    this.loop.inPoint = time;
    log.debug('시작점 설정', { inPoint: time });
    this._emit('loopChanged', { ...this.loop });
  }

  /**
   * 종료점(Out Point) 설정
   * @param {number|null} time - 종료점 시간 (초), null이면 해제
   */
  setOutPoint(time) {
    this.loop.outPoint = time;
    log.debug('종료점 설정', { outPoint: time });
    this._emit('loopChanged', { ...this.loop });
  }

  /**
   * 구간 반복 활성화/비활성화
   * @param {boolean} enabled
   */
  setLoopEnabled(enabled) {
    this.loop.enabled = enabled;
    log.debug('구간 반복 설정', { enabled });
    this._emit('loopChanged', { ...this.loop });
  }

  /**
   * 구간 반복 토글
   * @returns {boolean} 새로운 상태
   */
  toggleLoop() {
    this.loop.enabled = !this.loop.enabled;
    log.debug('구간 반복 토글', { enabled: this.loop.enabled });
    this._emit('loopChanged', { ...this.loop });
    return this.loop.enabled;
  }

  /**
   * 구간 초기화
   */
  clearLoop() {
    this.loop.inPoint = null;
    this.loop.outPoint = null;
    this.loop.enabled = false;
    log.debug('구간 초기화');
    this._emit('loopChanged', { ...this.loop });
  }

  /**
   * 현재 시간을 시작점으로 설정
   */
  setInPointAtCurrent() {
    this.setInPoint(this.currentTime);
    return this.currentTime;
  }

  /**
   * 현재 시간을 종료점으로 설정
   */
  setOutPointAtCurrent() {
    this.setOutPoint(this.currentTime);
    return this.currentTime;
  }

  /**
   * 시간을 MM:SS 형식으로 포맷
   * @param {number} time - 시간 (초)
   * @returns {string}
   */
  formatTimeShort(time) {
    if (time === null || time === undefined) return '--:--';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * 비디오 언로드
   */
  unload() {
    this.videoElement.src = '';
    this.videoElement.style.display = 'none';
    this.isLoaded = false;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.currentFrame = 0;
    this.totalFrames = 0;
    this.filePath = null;

    // 구간 반복 초기화
    this.clearLoop();

    // 영상 어니언 스킨 클리어
    this._clearVideoOnionSkin();

    log.info('비디오 언로드됨');
    this._emit('unloaded');
  }

  // ====== 영상 어니언 스킨 ======

  /**
   * 영상 어니언 스킨 캔버스 설정
   * @param {HTMLCanvasElement} canvas
   */
  setVideoOnionSkinCanvas(canvas) {
    this.videoOnionSkinCanvas = canvas;
    this.videoOnionSkinCtx = canvas?.getContext('2d');

    // 어니언 스킨 설정
    this.videoOnionSkin = {
      enabled: false,
      before: 1,
      after: 1,
      opacity: 0.3
    };

    // 프레임 캡처용 임시 캔버스
    this._frameCaptureCanvas = document.createElement('canvas');
    this._frameCaptureCtx = this._frameCaptureCanvas.getContext('2d');

    log.info('영상 어니언 스킨 캔버스 설정됨');
  }

  /**
   * 영상 어니언 스킨 활성화/비활성화
   * @param {boolean} enabled
   * @param {Object} options - { before, after, opacity }
   */
  setVideoOnionSkin(enabled, options = {}) {
    if (!this.videoOnionSkin) return;

    this.videoOnionSkin.enabled = enabled;
    if (options.before !== undefined) this.videoOnionSkin.before = options.before;
    if (options.after !== undefined) this.videoOnionSkin.after = options.after;
    if (options.opacity !== undefined) this.videoOnionSkin.opacity = options.opacity;

    if (enabled && !this.isPlaying) {
      this.renderVideoOnionSkin();
    } else {
      this._clearVideoOnionSkin();
    }

    log.debug('영상 어니언 스킨 설정', this.videoOnionSkin);
  }

  /**
   * 영상 어니언 스킨 클리어
   */
  _clearVideoOnionSkin() {
    if (this.videoOnionSkinCtx && this.videoOnionSkinCanvas) {
      this.videoOnionSkinCtx.clearRect(
        0, 0,
        this.videoOnionSkinCanvas.width,
        this.videoOnionSkinCanvas.height
      );
    }
  }

  /**
   * 영상 어니언 스킨 렌더링
   */
  async renderVideoOnionSkin() {
    if (!this.videoOnionSkin?.enabled || !this.isLoaded) {
      this._clearVideoOnionSkin();
      return;
    }

    // 재생 중에는 렌더링하지 않음 (성능)
    if (this.isPlaying) {
      this._clearVideoOnionSkin();
      return;
    }

    // 이미 렌더링 중이면 스킵
    if (this._isRenderingVideoOnionSkin) return;
    this._isRenderingVideoOnionSkin = true;

    const canvas = this.videoOnionSkinCanvas;
    const ctx = this.videoOnionSkinCtx;
    if (!canvas || !ctx) {
      this._isRenderingVideoOnionSkin = false;
      return;
    }

    // 캔버스 클리어
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentFrame = this.currentFrame;
    const { before, after, opacity } = this.videoOnionSkin;

    // 현재 시간 저장
    const originalTime = this.videoElement.currentTime;

    try {
      // 이전 프레임들 렌더링 (파란색 틴트)
      for (let i = before; i >= 1; i--) {
        const frame = currentFrame - i;
        if (frame >= 0) {
          const frameOpacity = opacity * (1 - (i - 1) / Math.max(before, 1));
          await this._renderVideoOnionFrame(frame, frameOpacity, 'rgba(100, 149, 237, 0.4)');
        }
      }

      // 이후 프레임들 렌더링 (녹색 틴트)
      for (let i = 1; i <= after; i++) {
        const frame = currentFrame + i;
        if (frame < this.totalFrames) {
          const frameOpacity = opacity * (1 - (i - 1) / Math.max(after, 1));
          await this._renderVideoOnionFrame(frame, frameOpacity, 'rgba(50, 205, 50, 0.4)');
        }
      }
    } finally {
      // 원래 시간으로 복원
      this.videoElement.currentTime = originalTime;
      this._isRenderingVideoOnionSkin = false;
    }
  }

  /**
   * 단일 영상 어니언 프레임 렌더링
   * @param {number} frame - 프레임 번호
   * @param {number} opacity - 투명도
   * @param {string} tintColor - 틴트 색상
   */
  async _renderVideoOnionFrame(frame, opacity, tintColor) {
    const video = this.videoElement;
    const canvas = this.videoOnionSkinCanvas;
    const ctx = this.videoOnionSkinCtx;

    if (!canvas || !ctx) return;

    // 프레임 시간으로 이동
    const time = frame / this.fps;
    video.currentTime = time;

    // 비디오가 해당 시간으로 이동할 때까지 대기
    await new Promise(resolve => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      // 타임아웃 (100ms)
      setTimeout(() => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }, 100);
    });

    // 캡처 캔버스에 비디오 프레임 그리기
    const captureCanvas = this._frameCaptureCanvas;
    const captureCtx = this._frameCaptureCtx;

    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    captureCtx.drawImage(video, 0, 0);

    // 틴트 적용
    captureCtx.globalCompositeOperation = 'source-atop';
    captureCtx.fillStyle = tintColor;
    captureCtx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
    captureCtx.globalCompositeOperation = 'source-over';

    // 메인 어니언 스킨 캔버스에 그리기
    ctx.globalAlpha = opacity;
    ctx.drawImage(captureCanvas, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  /**
   * 정리
   */
  destroy() {
    this.unload();
    log.info('VideoPlayer 정리됨');
  }
}

/**
 * 싱글톤 인스턴스 생성
 */
let playerInstance = null;

export function getVideoPlayer(options) {
  if (!playerInstance) {
    playerInstance = new VideoPlayer(options);
  }
  return playerInstance;
}

export default VideoPlayer;
