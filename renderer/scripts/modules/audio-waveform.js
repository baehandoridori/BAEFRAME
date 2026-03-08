/**
 * BAEFRAME - Audio Waveform Module
 * 오디오 파일 전용 시각화 및 인터랙션
 *
 * - Web Audio API로 오디오 데이터 디코딩
 * - Canvas로 미러 웨이브폼 렌더링 (위/아래 대칭)
 * - 그라데이션 컬러링 (accent 기반)
 * - 스크러빙 (클릭/드래그 탐색)
 * - 재생 헤드 동기화
 * - 호버 시간 미리보기
 */

import { createLogger } from '../logger.js';

const log = createLogger('AudioWaveform');

/**
 * 오디오 웨이브폼 클래스
 */
export class AudioWaveform extends EventTarget {
  constructor(options = {}) {
    super();

    this.container = options.container || null;
    this.canvas = null;
    this.ctx = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;

    // 오디오 데이터
    this.waveformData = null; // Main Process에서 생성된 웨이브폼 데이터
    this.duration = 0;

    // 재생 상태
    this.currentTime = 0;
    this.isPlaying = false;

    // 인터랙션 상태
    this._isDragging = false;
    this._hoverTime = -1;
    this._animationId = null;
    this._isVisible = false;

    // 디자인 설정
    this._barWidth = 3;
    this._barGap = 1;
    this._cornerRadius = 1.5;
    this._glowIntensity = 0.6;

    // 바운드 핸들러
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onResize = this._onResize.bind(this);
    this._animate = this._animate.bind(this);

    log.info('AudioWaveform 초기화됨');
  }

  /**
   * 컨테이너 설정 및 캔버스 생성
   */
  mount(container) {
    this.container = container;

    // 메인 웨이브폼 캔버스
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'audio-waveform-canvas';
    this.ctx = this.canvas.getContext('2d');

    // 오버레이 캔버스 (플레이헤드, 호버)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'audio-waveform-overlay';
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    // 시간 표시 엘리먼트
    this._timeDisplay = document.createElement('div');
    this._timeDisplay.className = 'audio-waveform-time';

    // 호버 타임 표시
    this._hoverLabel = document.createElement('div');
    this._hoverLabel.className = 'audio-waveform-hover-label';

    container.appendChild(this.canvas);
    container.appendChild(this.overlayCanvas);
    container.appendChild(this._timeDisplay);
    container.appendChild(this._hoverLabel);

    // 이벤트 리스너
    this.overlayCanvas.addEventListener('mousedown', this._onMouseDown);
    this.overlayCanvas.addEventListener('mousemove', this._onMouseMove);
    this.overlayCanvas.addEventListener('mouseleave', this._onMouseLeave);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('resize', this._onResize);

    this._resize();
    log.info('AudioWaveform 마운트됨');
  }

  /**
   * 정리
   */
  unmount() {
    this.stopAnimation();

    if (this.overlayCanvas) {
      this.overlayCanvas.removeEventListener('mousedown', this._onMouseDown);
      this.overlayCanvas.removeEventListener('mousemove', this._onMouseMove);
      this.overlayCanvas.removeEventListener('mouseleave', this._onMouseLeave);
    }
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('resize', this._onResize);

    if (this.container) {
      this.container.innerHTML = '';
    }

    this.canvas = null;
    this.ctx = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this._timeDisplay = null;
    this._hoverLabel = null;
    this.waveformData = null;
    this._rawWaveformData = null;
    this._isVisible = false;

    log.info('AudioWaveform 언마운트됨');
  }

  /**
   * 오디오 파일 로드 및 웨이브폼 생성
   * @param {string} filePath - 파일 경로
   * @returns {Promise<{duration: number}>}
   */
  async loadAudio(filePath) {
    log.info('오디오 파일 로드 시작', { filePath });

    try {
      // Main Process에서 WAV 파싱 + 웨이브폼 데이터 생성 (IPC)
      // 대용량 바이너리를 렌더러로 전송하지 않고, main에서 직접 파싱하여
      // 소량의 웨이브폼 데이터(수 KB)만 전송
      log.info('웨이브폼 생성 요청 (IPC)', { filePath });

      const result = await window.electronAPI.generateAudioWaveform(filePath, 800);

      if (!result.success) {
        throw new Error(result.error || '웨이브폼 생성 실패');
      }

      this.duration = result.duration;
      this._rawWaveformData = Array.from(result.waveformData); // 원본 보관 (리사이즈용)

      log.info('웨이브폼 데이터 수신 완료', {
        duration: this.duration,
        barCount: this._rawWaveformData.length,
        channels: result.channels,
        sampleRate: result.sampleRate
      });

      // IPC 응답 후 캔버스 크기 재확인 (IPC 대기 동안 레이아웃 확정됨)
      this._resize();
      if (!this.canvas.width || !this.canvas.height) {
        await new Promise(r => requestAnimationFrame(r));
        this._resize();
      }

      log.info('캔버스 크기 (렌더링 직전)', {
        canvasWidth: this.canvas.width,
        canvasHeight: this.canvas.height
      });

      // 현재 캔버스 크기에 맞는 barCount로 리샘플링
      this._resampleFromRaw();

      // 렌더링
      this._isVisible = true;
      this._drawWaveform();
      this._drawOverlay();
      this.startAnimation();

      log.info('오디오 파일 로드 완료', { duration: this.duration });

      return { duration: this.duration };
    } catch (error) {
      log.error('오디오 파일 로드 실패', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * 원본 데이터에서 현재 캔버스 크기에 맞게 리샘플링
   */
  _resampleFromRaw() {
    if (!this._rawWaveformData || !this.canvas) return;

    const barCount = Math.max(1, Math.floor(this.canvas.width / (this._barWidth + this._barGap)));
    const oldData = this._rawWaveformData;
    const newData = new Float32Array(barCount);
    const ratio = oldData.length / barCount;

    for (let i = 0; i < barCount; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, oldData.length - 1);
      const frac = srcIdx - lo;
      newData[i] = oldData[lo] * (1 - frac) + oldData[hi] * frac;
    }

    this.waveformData = newData;
  }

  /**
   * 메인 웨이브폼 렌더링
   */
  _drawWaveform() {
    if (!this.ctx || !this.waveformData || !this.canvas) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const centerY = h / 2;
    const maxBarHeight = (h / 2) * 0.85; // 중앙에서 위/아래 최대 높이

    ctx.clearRect(0, 0, w, h);

    // 현재 재생 위치 비율
    const playRatio = this.duration > 0 ? this.currentTime / this.duration : 0;
    const playX = playRatio * w;

    // 그라데이션 생성 - 재생된 부분과 미재생 부분
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary').trim() || '#ffd000';

    // 재생된 부분: accent → 따뜻한 오렌지
    const playedGrad = ctx.createLinearGradient(0, 0, w, 0);
    playedGrad.addColorStop(0, accentColor);
    playedGrad.addColorStop(0.5, this._shiftHue(accentColor, 15));
    playedGrad.addColorStop(1, this._shiftHue(accentColor, 30));

    // 미재생 부분: 반투명
    const unplayedColor = 'rgba(255, 255, 255, 0.2)';
    const unplayedHighlight = 'rgba(255, 255, 255, 0.35)';

    for (let i = 0; i < this.waveformData.length; i++) {
      const x = i * (this._barWidth + this._barGap);
      const amplitude = this.waveformData[i];

      // 최소 높이 보장 (무음 구간도 작은 바 표시)
      const barHeight = Math.max(2, amplitude * maxBarHeight);

      const isPlayed = x < playX;
      const isNearPlayhead = Math.abs(x - playX) < 30;

      if (isPlayed) {
        // 재생된 부분 - 풀 컬러 + 글로우
        ctx.fillStyle = playedGrad;
        ctx.globalAlpha = 0.9 + amplitude * 0.1;

        if (isNearPlayhead) {
          // 재생 헤드 근처 글로우
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 8 * this._glowIntensity;
        }
      } else {
        // 미재생 부분 - 반투명 흰색
        ctx.fillStyle = isNearPlayhead ? unplayedHighlight : unplayedColor;
        ctx.globalAlpha = 0.6 + amplitude * 0.3;
        ctx.shadowBlur = 0;
      }

      // 위쪽 바 (둥근 모서리)
      this._drawRoundedBar(ctx, x, centerY - barHeight, this._barWidth, barHeight, this._cornerRadius);
      // 아래쪽 바 (미러)
      this._drawRoundedBar(ctx, x, centerY, this._barWidth, barHeight, this._cornerRadius);

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // 중앙선
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * 오버레이 렌더링 (플레이헤드, 호버)
   */
  _drawOverlay() {
    if (!this.overlayCtx || !this.overlayCanvas) return;

    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;

    ctx.clearRect(0, 0, w, h);

    if (!this.waveformData || this.duration <= 0) return;

    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary').trim() || '#ffd000';

    // 재생 헤드
    const playRatio = this.currentTime / this.duration;
    const playX = playRatio * w;

    // 재생 헤드 글로우
    const glowGrad = ctx.createRadialGradient(playX, h / 2, 0, playX, h / 2, 40);
    glowGrad.addColorStop(0, this._hexToRgba(accentColor, 0.15));
    glowGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(playX - 40, 0, 80, h);

    // 재생 헤드 라인
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 재생 헤드 원형 핸들
    ctx.beginPath();
    ctx.arc(playX, h / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 호버 라인
    if (this._hoverTime >= 0 && !this._isDragging) {
      const hoverRatio = this._hoverTime / this.duration;
      const hoverX = hoverRatio * w;

      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 시간 표시 업데이트
    if (this._timeDisplay) {
      this._timeDisplay.textContent = this._formatTime(this.currentTime) +
        ' / ' + this._formatTime(this.duration);
    }
  }

  /**
   * 둥근 모서리 바 그리기
   */
  _drawRoundedBar(ctx, x, y, width, height, radius) {
    if (height < 1) return;
    radius = Math.min(radius, width / 2, height / 2);

    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * 재생 시간 업데이트
   */
  updateTime(time) {
    this.currentTime = time;
  }

  /**
   * 재생 상태 업데이트
   */
  setPlaying(isPlaying) {
    this.isPlaying = isPlaying;
  }

  /**
   * 애니메이션 시작
   */
  startAnimation() {
    if (this._animationId) return;
    this._animate();
  }

  /**
   * 애니메이션 정지
   */
  stopAnimation() {
    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }
  }

  /**
   * 애니메이션 루프
   */
  _animate() {
    if (!this._isVisible) return;

    this._drawWaveform();
    this._drawOverlay();

    this._animationId = requestAnimationFrame(this._animate);
  }

  /**
   * 표시/숨김
   */
  show() {
    if (this.container) {
      this.container.classList.add('active');
      this._isVisible = true;
      this._resize();
      // 컨테이너가 display:none → block 전환 후 웨이브폼 재생성 필요
      if (this._rawWaveformData) {
        this._resampleFromRaw();
        this._drawWaveform();
        this._drawOverlay();
      }
      this.startAnimation();
    }
  }

  hide() {
    if (this.container) {
      this.container.classList.remove('active');
      this._isVisible = false;
      this.stopAnimation();
    }
  }

  /**
   * 리셋 (파일 전환 시)
   */
  reset() {
    this.stopAnimation();
    this.waveformData = null;
    this._rawWaveformData = null;
    this.duration = 0;
    this.currentTime = 0;
    this.isPlaying = false;
    this._isDragging = false;
    this._hoverTime = -1;
    this._isVisible = false;

    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.overlayCtx && this.overlayCanvas) {
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
    if (this._timeDisplay) {
      this._timeDisplay.textContent = '';
    }
  }

  // ====== 이벤트 핸들러 ======

  _onMouseDown(e) {
    if (!this.waveformData || this.duration <= 0) return;

    this._isDragging = true;
    this._seekFromEvent(e);
    this.overlayCanvas.style.cursor = 'grabbing';
  }

  _onMouseMove(e) {
    if (!this.waveformData || this.duration <= 0) return;

    const rect = this.overlayCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    this._hoverTime = ratio * this.duration;

    // 호버 라벨 위치 및 표시
    if (this._hoverLabel) {
      this._hoverLabel.textContent = this._formatTime(this._hoverTime);
      this._hoverLabel.style.left = `${x}px`;
      this._hoverLabel.classList.add('visible');
    }

    if (this._isDragging) {
      this._seekFromEvent(e);
    }
  }

  _onMouseUp() {
    if (this._isDragging) {
      this._isDragging = false;
      if (this.overlayCanvas) {
        this.overlayCanvas.style.cursor = '';
      }
    }
  }

  _onMouseLeave() {
    this._hoverTime = -1;
    if (this._hoverLabel) {
      this._hoverLabel.classList.remove('visible');
    }
  }

  _seekFromEvent(e) {
    const rect = this.overlayCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const time = ratio * this.duration;

    this.currentTime = time;

    this.dispatchEvent(new CustomEvent('seek', {
      detail: { time, ratio }
    }));
  }

  _onResize() {
    this._resize();
    if (this._rawWaveformData) {
      this._resampleFromRaw();
      this._drawWaveform();
      this._drawOverlay();
    }
  }

  _resize() {
    if (!this.container || !this.canvas || !this.overlayCanvas) return;

    const rect = this.container.getBoundingClientRect();

    // 논리적 크기 사용 (CSS로 스케일링)
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.overlayCanvas.width = rect.width;
    this.overlayCanvas.height = rect.height;
  }

  // ====== 유틸리티 ======

  /**
   * 시간 포맷팅
   */
  _formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Hex → RGBA
   */
  _hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Hex 색상의 Hue 시프트 (간단한 방법)
   */
  _shiftHue(hex, degrees) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map(c => c + c).join('');
    }

    let r = parseInt(hex.substring(0, 2), 16) / 255;
    let g = parseInt(hex.substring(2, 4), 16) / 255;
    let b = parseInt(hex.substring(4, 6), 16) / 255;

    // RGB → HSL
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    // Hue 시프트
    h = (h + degrees / 360) % 1;
    if (h < 0) h += 1;

    // HSL → RGB
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    return '#' +
      Math.round(r * 255).toString(16).padStart(2, '0') +
      Math.round(g * 255).toString(16).padStart(2, '0') +
      Math.round(b * 255).toString(16).padStart(2, '0');
  }
}

// 싱글톤
let instance = null;

export function getAudioWaveform() {
  if (!instance) {
    instance = new AudioWaveform();
  }
  return instance;
}

export default AudioWaveform;
