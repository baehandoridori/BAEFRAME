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

    // 파티클 시스템
    this._particles = [];
    this._maxParticles = 50;

    // 줌 상태
    this._zoom = 1.0;           // 현재 줌 레벨 (1.0 = 100%)
    this._targetZoom = 1.0;     // 애니메이션 목표 줌
    this._scrollOffset = 0;     // 보이는 시작 비율 (0~1)
    this._zoomIndicator = null; // 줌 % 표시 엘리먼트
    this._zoomHideTimer = null;

    // 애니메이션 타이밍
    this._animStartTime = 0;
    this._pulsePhase = 0;

    // 바운드 핸들러
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onWheel = this._onWheel.bind(this);
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

    // 줌 인디케이터
    this._zoomIndicator = document.createElement('div');
    this._zoomIndicator.className = 'audio-zoom-indicator';

    container.appendChild(this.canvas);
    container.appendChild(this.overlayCanvas);
    container.appendChild(this._timeDisplay);
    container.appendChild(this._hoverLabel);
    container.appendChild(this._zoomIndicator);

    // 이벤트 리스너
    this.overlayCanvas.addEventListener('mousedown', this._onMouseDown);
    this.overlayCanvas.addEventListener('mousemove', this._onMouseMove);
    this.overlayCanvas.addEventListener('mouseleave', this._onMouseLeave);
    this.overlayCanvas.addEventListener('wheel', this._onWheel, { passive: false });
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
      this.overlayCanvas.removeEventListener('wheel', this._onWheel);
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
      // 1차: Main Process에서 WAV 파싱 + 웨이브폼 데이터 생성 (IPC)
      // 대용량 바이너리를 렌더러로 전송하지 않고, main에서 직접 파싱하여
      // 소량의 웨이브폼 데이터(수 KB)만 전송
      let useIpc = true;
      try {
        log.info('웨이브폼 생성 요청 (IPC)', { filePath });
        const result = await window.electronAPI.generateAudioWaveform(filePath, 800);

        if (!result.success) {
          throw new Error(result.error || '웨이브폼 생성 실패');
        }

        this.duration = result.duration;
        this._rawWaveformData = Array.from(result.waveformData);

        log.info('웨이브폼 데이터 수신 완료 (IPC)', {
          duration: this.duration,
          barCount: this._rawWaveformData.length,
          channels: result.channels,
          sampleRate: result.sampleRate
        });
      } catch (ipcErr) {
        // 2차: Web Audio API 폴백 (MP3/OGG/FLAC/AAC 등 지원)
        log.info('IPC 웨이브폼 실패, Web Audio API 폴백 시도', { error: ipcErr.message });
        useIpc = false;
        await this._loadAudioFallback(filePath);
      }

      if (useIpc) {
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
      }

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
   * Web Audio API 폴백 - MP3/OGG/FLAC/AAC 등 비-WAV 오디오 지원
   * IPC 바이너리 읽기 → AudioContext.decodeAudioData() → 웨이브폼 생성
   */
  async _loadAudioFallback(filePath) {
    log.info('Web Audio API 폴백 로드 시작', { filePath });

    // IPC로 파일 바이너리 읽기 (Uint8Array 반환)
    const uint8 = await window.electronAPI.readBinaryFile(filePath);
    // Uint8Array → ArrayBuffer 복사 (decodeAudioData 호환)
    const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      this.duration = audioBuffer.duration;
      const channelData = audioBuffer.getChannelData(0);

      // 800개 바로 다운샘플링
      const barCount = 800;
      const samplesPerBar = Math.max(1, Math.floor(channelData.length / barCount));
      const waveformData = [];
      for (let i = 0; i < barCount; i++) {
        let sum = 0;
        const offset = i * samplesPerBar;
        for (let j = 0; j < samplesPerBar; j++) {
          sum += Math.abs(channelData[offset + j]);
        }
        waveformData.push(sum / samplesPerBar);
      }
      this._rawWaveformData = waveformData;

      log.info('Web Audio API 웨이브폼 생성 완료', {
        duration: this.duration,
        barCount: waveformData.length,
        sampleRate: audioBuffer.sampleRate
      });

      // 캔버스 크기 확인 후 리샘플링
      this._resize();
      if (!this.canvas.width || !this.canvas.height) {
        await new Promise(r => requestAnimationFrame(r));
        this._resize();
      }
      this._resampleFromRaw();
    } finally {
      await audioCtx.close();
    }
  }

  /**
   * 원본 데이터에서 현재 캔버스 크기 × 줌에 맞게 리샘플링
   */
  _resampleFromRaw() {
    if (!this._rawWaveformData || !this.canvas) return;

    // 줌 적용: 전체 바 수 = 캔버스 너비 × 줌 / (바폭 + 갭)
    const totalBars = Math.max(1, Math.floor(this.canvas.width * this._zoom / (this._barWidth + this._barGap)));
    const oldData = this._rawWaveformData;
    const newData = new Float32Array(totalBars);
    const ratio = oldData.length / totalBars;

    for (let i = 0; i < totalBars; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, oldData.length - 1);
      const frac = srcIdx - lo;
      newData[i] = oldData[lo] * (1 - frac) + oldData[hi] * frac;
    }

    this.waveformData = newData;
    this._totalBars = totalBars;
  }

  /**
   * 메인 웨이브폼 렌더링 (리플렉션 + 글로우 + 펄스)
   */
  _drawWaveform() {
    if (!this.ctx || !this.waveformData || !this.canvas) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    // 중심선을 화면 2/3 지점에 배치
    const centerY = h * 0.67;
    const maxBarHeight = centerY * 0.55;
    const reflectionHeight = (h - centerY) * 0.45; // 리플렉션도 비례 축소

    ctx.clearRect(0, 0, w, h);

    // 줌 부드러운 보간
    if (Math.abs(this._zoom - this._targetZoom) > 0.001) {
      const prevZoom = this._zoom;
      this._zoom += (this._targetZoom - this._zoom) * 0.15;
      // 줌 변경 시 리샘플링
      if (Math.abs(this._zoom - prevZoom) > 0.005) {
        this._resampleFromRaw();
      }
    } else {
      this._zoom = this._targetZoom;
    }

    const now = performance.now();
    this._pulsePhase = (now % 2000) / 2000; // 2초 주기

    // 줌/스크롤 계산
    const totalBars = this._totalBars || this.waveformData.length;
    const visibleBars = Math.floor(w / (this._barWidth + this._barGap));
    const maxScrollBars = Math.max(0, totalBars - visibleBars);
    const startBar = Math.round(this._scrollOffset * maxScrollBars);

    // 현재 재생 위치 비율
    const playRatio = this.duration > 0 ? this.currentTime / this.duration : 0;
    // 줌 적용된 재생 위치: 전체 바 중 재생 위치에서 스크롤 오프셋 빼기
    const playBarIdx = playRatio * totalBars;
    const playX = (playBarIdx - startBar) * (this._barWidth + this._barGap);

    // accent 색상
    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary').trim() || '#ffd000';
    const accentShift1 = this._shiftHue(accentColor, 20);
    const accentShift2 = this._shiftHue(accentColor, -15);

    // 재생된 부분: 수평 + 수직 그라데이션 조합
    const playedGrad = ctx.createLinearGradient(0, centerY - maxBarHeight, 0, centerY);
    playedGrad.addColorStop(0, accentShift1);
    playedGrad.addColorStop(0.5, accentColor);
    playedGrad.addColorStop(1, accentShift2);

    // ─── 배경 앰비언트 글로우 (재생 헤드 주변) ───
    if (playX > 0) {
      const ambientRadius = Math.max(80, h * 0.4);
      const ambientGrad = ctx.createRadialGradient(
        playX, centerY, 0,
        playX, centerY, ambientRadius
      );
      ambientGrad.addColorStop(0, this._hexToRgba(accentColor, 0.08 + Math.sin(this._pulsePhase * Math.PI * 2) * 0.03));
      ambientGrad.addColorStop(0.6, this._hexToRgba(accentColor, 0.02));
      ambientGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = ambientGrad;
      ctx.fillRect(playX - ambientRadius, 0, ambientRadius * 2, h);
    }

    // ─── 메인 바 + 리플렉션 (보이는 범위만) ───
    const endBar = Math.min(startBar + visibleBars + 1, totalBars);
    for (let i = startBar; i < endBar; i++) {
      const x = (i - startBar) * (this._barWidth + this._barGap);
      const amplitude = this.waveformData[i] || 0;

      // 재생 헤드 근처 펄스 효과
      const distToPlayhead = Math.abs(x - playX);
      const barHeight = Math.max(2, amplitude * maxBarHeight);
      const isPlayed = x < playX;
      const isNearPlayhead = distToPlayhead < 40;

      // ── 위쪽 바 (메인) ──
      if (isPlayed) {
        ctx.fillStyle = playedGrad;
        ctx.globalAlpha = 0.9 + amplitude * 0.1;

        if (isNearPlayhead) {
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 12 * this._glowIntensity;
        }
      } else {
        const baseAlpha = isNearPlayhead ? 0.35 : 0.18;
        ctx.fillStyle = `rgba(255, 255, 255, ${baseAlpha + amplitude * 0.15})`;
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }

      this._drawRoundedBar(ctx, x, centerY - barHeight, this._barWidth, barHeight, this._cornerRadius);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      // ── 아래쪽 바 (리플렉션) ──
      const reflectBarHeight = Math.min(barHeight * 0.55, reflectionHeight);

      if (isPlayed) {
        // 리플렉션용 수직 그라데이션 (위에서 아래로 fade)
        const refGrad = ctx.createLinearGradient(0, centerY + 2, 0, centerY + 2 + reflectBarHeight);
        refGrad.addColorStop(0, this._hexToRgba(accentColor, 0.35));
        refGrad.addColorStop(0.5, this._hexToRgba(accentColor, 0.12));
        refGrad.addColorStop(1, this._hexToRgba(accentColor, 0));
        ctx.fillStyle = refGrad;
      } else {
        const refGrad = ctx.createLinearGradient(0, centerY + 2, 0, centerY + 2 + reflectBarHeight);
        refGrad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
        refGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)');
        refGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = refGrad;
      }

      ctx.globalAlpha = 1;
      this._drawRoundedBar(ctx, x, centerY + 2, this._barWidth, reflectBarHeight, this._cornerRadius);
    }

    ctx.globalAlpha = 1;

    // ─── 중앙선 (글로우 포함) ───
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 중앙선 하이라이트 (재생된 구간)
    if (playX > 0) {
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(playX, centerY);
      ctx.strokeStyle = this._hexToRgba(accentColor, 0.2);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ─── 파티클 렌더링 (오버레이에서 처리) ───
  }

  /**
   * 오버레이 렌더링 (플레이헤드 + 호버 - 프리미엄 디자인)
   */
  _drawOverlay() {
    if (!this.overlayCtx || !this.overlayCanvas) return;

    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    const centerY = h * 0.67;

    ctx.clearRect(0, 0, w, h);

    if (!this.waveformData || this.duration <= 0) return;

    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary').trim() || '#ffd000';

    // 줌/스크롤 계산 (waveform과 동일)
    const totalBars = this._totalBars || (this.waveformData ? this.waveformData.length : 1);
    const visibleBars = Math.floor(w / (this._barWidth + this._barGap));
    const maxScrollBars = Math.max(0, totalBars - visibleBars);
    const startBar = Math.round(this._scrollOffset * maxScrollBars);

    const playRatio = this.currentTime / this.duration;
    const playBarIdx = playRatio * totalBars;
    const playX = (playBarIdx - startBar) * (this._barWidth + this._barGap);

    // ─── 재생 헤드 네온 글로우 (다중 레이어) ───
    // 외곽 글로우 (넓고 희미)
    const outerGlow = ctx.createRadialGradient(playX, centerY, 0, playX, centerY, 60);
    outerGlow.addColorStop(0, this._hexToRgba(accentColor, 0.12));
    outerGlow.addColorStop(0.5, this._hexToRgba(accentColor, 0.04));
    outerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = outerGlow;
    ctx.fillRect(playX - 60, 0, 120, h);

    // 내부 글로우 (좁고 강렬)
    const innerGlow = ctx.createRadialGradient(playX, centerY, 0, playX, centerY, 20);
    innerGlow.addColorStop(0, this._hexToRgba(accentColor, 0.25));
    innerGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = innerGlow;
    ctx.fillRect(playX - 20, centerY - 30, 40, 60);

    // ─── 재생 헤드 라인 (네온 더블 라인) ───
    // 바깥쪽 글로우 라인
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.strokeStyle = this._hexToRgba(accentColor, 0.3);
    ctx.lineWidth = 4;
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 12;
    ctx.stroke();

    // 메인 라인
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 6;
    ctx.stroke();

    // 중심 밝은 라인
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, h);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 0.5;
    ctx.shadowBlur = 0;
    ctx.stroke();

    // ─── 플레이헤드 다이아몬드 핸들 ───
    const handleSize = 6;
    const pulse = 1 + Math.sin(this._pulsePhase * Math.PI * 2) * 0.15;
    const hs = handleSize * pulse;

    // 다이아몬드 글로우
    ctx.shadowColor = accentColor;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(playX, centerY - hs);
    ctx.lineTo(playX + hs, centerY);
    ctx.lineTo(playX, centerY + hs);
    ctx.lineTo(playX - hs, centerY);
    ctx.closePath();
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.shadowBlur = 0;

    // 다이아몬드 하이라이트
    ctx.beginPath();
    ctx.moveTo(playX, centerY - hs * 0.5);
    ctx.lineTo(playX + hs * 0.5, centerY);
    ctx.lineTo(playX, centerY + hs * 0.5);
    ctx.lineTo(playX - hs * 0.5, centerY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fill();

    // ─── 호버 라인 (부드러운 그라데이션) ───
    if (this._hoverTime >= 0 && !this._isDragging) {
      const hoverRatio = this._hoverTime / this.duration;
      const hoverX = hoverRatio * w;

      // 호버 글로우
      const hoverGlow = ctx.createRadialGradient(hoverX, centerY, 0, hoverX, centerY, 30);
      hoverGlow.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
      hoverGlow.addColorStop(1, 'transparent');
      ctx.fillStyle = hoverGlow;
      ctx.fillRect(hoverX - 30, 0, 60, h);

      // 호버 라인
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 호버 위치 작은 원
      ctx.beginPath();
      ctx.arc(hoverX, centerY, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.fill();
    }

    // ─── 파티클 (오버레이 위에 렌더링) ───
    this._updateAndDrawParticles(ctx, w, h, centerY, playX, accentColor);

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
   * 파티클 업데이트 및 렌더링
   */
  _updateAndDrawParticles(ctx, w, h, centerY, playX, accentColor) {
    // 재생 중일 때 파티클 생성 (재생 헤드 근처)
    if (this.isPlaying && playX > 0 && this._particles.length < this._maxParticles) {
      // 프레임당 1~3개 생성
      const spawnCount = 1 + Math.floor(Math.random() * 3);
      for (let s = 0; s < spawnCount; s++) {
        const spread = (Math.random() - 0.5) * 40;
        // 웨이브폼 바 영역 근처에서 생성
        const barAreaTop = centerY * 0.2;
        const spawnY = barAreaTop + Math.random() * (centerY - barAreaTop);
        this._particles.push({
          x: playX + spread,
          y: spawnY,
          vx: (Math.random() - 0.5) * 1.2,
          vy: -0.5 - Math.random() * 1.5, // 위로 떠오름
          life: 1,
          decay: 0.005 + Math.random() * 0.008, // 더 오래 지속
          size: 1.5 + Math.random() * 3,
          type: Math.random() < 0.5 ? 'dot' : 'star',
        });
      }
    }

    // 파티클 업데이트 & 렌더링
    for (let i = this._particles.length - 1; i >= 0; i--) {
      const p = this._particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy *= 0.99;
      p.life -= p.decay;

      if (p.life <= 0 || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) {
        this._particles.splice(i, 1);
        continue;
      }

      const alpha = p.life * 0.9;
      ctx.globalAlpha = alpha;

      if (p.type === 'star') {
        // 별 모양 파티클 - 밝고 글로우 강하게
        ctx.fillStyle = accentColor;
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 8;
        this._drawStar(ctx, p.x, p.y, p.size * (0.6 + p.life * 0.4), 4);
        ctx.shadowBlur = 0;
      } else {
        // 원형 파티클 - 밝은 코어 + 글로우
        const r = p.size * (0.5 + p.life * 0.5);
        ctx.shadowColor = accentColor;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = accentColor;
        ctx.fill();
        // 밝은 중심점
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    ctx.globalAlpha = 1;
  }

  /**
   * 별 모양 그리기
   */
  _drawStar(ctx, cx, cy, size, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? size : size * 0.4;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
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
    if (!isPlaying) {
      this._particles = [];
    }
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
    this._particles = [];
    this._zoom = 1.0;
    this._targetZoom = 1.0;
    this._scrollOffset = 0;

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

    // 줌/스크롤 반영
    const totalBars = this._totalBars || this.waveformData.length;
    const visibleBars = Math.floor(rect.width / (this._barWidth + this._barGap));
    const maxScrollBars = Math.max(0, totalBars - visibleBars);
    const startBar = this._scrollOffset * maxScrollBars;
    const barAtX = startBar + (x / rect.width) * visibleBars;
    const ratio = Math.max(0, Math.min(1, barAtX / totalBars));
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

    // 줌/스크롤 반영: 화면 x → 전체 비율
    const totalBars = this._totalBars || (this.waveformData ? this.waveformData.length : 1);
    const visibleBars = Math.floor(rect.width / (this._barWidth + this._barGap));
    const maxScrollBars = Math.max(0, totalBars - visibleBars);
    const startBar = this._scrollOffset * maxScrollBars;
    const barAtX = startBar + (x / rect.width) * visibleBars;
    const ratio = Math.max(0, Math.min(1, barAtX / totalBars));
    const time = ratio * this.duration;

    this.currentTime = time;

    this.dispatchEvent(new CustomEvent('seek', {
      detail: { time, ratio }
    }));
  }

  _onWheel(e) {
    if (!this.waveformData || this.duration <= 0) return;
    e.preventDefault();

    const rect = this.overlayCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseRatio = mouseX / rect.width; // 마우스가 보이는 영역의 어디인지 (0~1)

    // 줌 전: 마우스가 가리키는 전체 비율 계산
    const totalBars = this._totalBars || this.waveformData.length;
    const visibleBars = Math.floor(rect.width / (this._barWidth + this._barGap));
    const maxScrollBars = Math.max(0, totalBars - visibleBars);
    const cursorBar = this._scrollOffset * maxScrollBars + mouseRatio * visibleBars;
    const cursorGlobalRatio = cursorBar / totalBars;

    // 줌 레벨 변경 (부드러운 단계)
    const zoomStep = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this._targetZoom = Math.max(1.0, Math.min(8.0, this._targetZoom * zoomStep));

    // 줌 후 스크롤 오프셋 조정: 마우스 커서 위치가 같은 시간을 가리키도록
    const newTotalBars = Math.max(1, Math.floor(rect.width * this._targetZoom / (this._barWidth + this._barGap)));
    const newVisibleBars = Math.floor(rect.width / (this._barWidth + this._barGap));
    const newMaxScrollBars = Math.max(0, newTotalBars - newVisibleBars);
    if (newMaxScrollBars > 0) {
      const newCursorBar = cursorGlobalRatio * newTotalBars;
      const newStartBar = newCursorBar - mouseRatio * newVisibleBars;
      this._scrollOffset = Math.max(0, Math.min(1, newStartBar / newMaxScrollBars));
    } else {
      this._scrollOffset = 0;
    }

    // 줌 인디케이터 표시
    this._showZoomIndicator();

    log.debug('웨이브폼 줌', { zoom: Math.round(this._targetZoom * 100) + '%' });
  }

  _showZoomIndicator() {
    if (!this._zoomIndicator) return;
    this._zoomIndicator.textContent = `${Math.round(this._targetZoom * 100)}%`;
    this._zoomIndicator.classList.add('visible');

    clearTimeout(this._zoomHideTimer);
    this._zoomHideTimer = setTimeout(() => {
      this._zoomIndicator.classList.remove('visible');
    }, 1500);
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
