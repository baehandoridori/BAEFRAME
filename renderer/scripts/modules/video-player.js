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

      log.info('메타데이터 로드됨', {
        duration: this.duration,
        totalFrames: this.totalFrames
      });

      this._emit('loadedmetadata', {
        duration: this.duration,
        totalFrames: this.totalFrames,
        fps: this.fps
      });
    });

    // 재생 위치 변경
    video.addEventListener('timeupdate', () => {
      this.currentTime = video.currentTime;
      this.currentFrame = Math.floor(this.currentTime * this.fps);

      this._emit('timeupdate', {
        currentTime: this.currentTime,
        currentFrame: this.currentFrame
      });
    });

    // 재생 시작
    video.addEventListener('play', () => {
      this.isPlaying = true;
      this._emit('play');
    });

    // 일시정지
    video.addEventListener('pause', () => {
      this.isPlaying = false;
      this._emit('pause');
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
    this.videoElement.currentTime = time;
    log.debug('시간 이동', { time });
  }

  /**
   * 특정 프레임으로 이동
   * @param {number} frame - 이동할 프레임 번호
   */
  seekToFrame(frame) {
    if (!this.isLoaded) return;

    frame = Math.max(0, Math.min(frame, this.totalFrames - 1));
    const time = frame / this.fps;
    this.seek(time);
    log.debug('프레임 이동', { frame });
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
    this.seek(this.currentTime - seconds);
  }

  /**
   * n초 앞으로 이동
   * @param {number} seconds
   */
  forward(seconds = 1) {
    this.seek(this.currentTime + seconds);
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

    log.info('비디오 언로드됨');
    this._emit('unloaded');
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
