/**
 * baeframe - Timeline Module
 * 타임라인 UI 및 인터랙션 관리
 */

import { createLogger } from '../logger.js';

const log = createLogger('Timeline');

export class Timeline extends EventTarget {
  constructor(options = {}) {
    super();

    // DOM 요소
    this.container = options.container || document.getElementById('timelineSection');
    this.tracksContainer = options.tracksContainer || document.getElementById('tracksContainer');
    this.timelineRuler = options.timelineRuler || document.getElementById('timelineRuler');
    this.playheadLine = options.playheadLine || document.getElementById('playheadLine');
    this.playheadHandle = options.playheadHandle || document.getElementById('playheadHandle');
    this.zoomSlider = options.zoomSlider || document.getElementById('zoomSlider');
    this.zoomDisplay = options.zoomDisplay || document.getElementById('zoomDisplay');
    this.timelineTracks = options.timelineTracks || document.getElementById('timelineTracks');
    this.layerHeaders = options.layerHeaders || document.getElementById('layerHeaders');

    // 상태
    this.duration = 0;
    this.fps = 24;
    this.currentTime = 0;
    this.zoom = 100; // 100% = 기본
    this.minZoom = 50;
    this.maxZoom = 400;

    // 플레이헤드 드래그 상태
    this.isDraggingPlayhead = false;

    // 초기화
    this._setupEventListeners();
    this._updateZoomDisplay();

    log.info('Timeline 초기화됨');
  }

  /**
   * 이벤트 리스너 설정
   */
  _setupEventListeners() {
    // 줌 슬라이더
    this.zoomSlider?.addEventListener('input', (e) => {
      const value = e.target.value;
      this.zoom = this.minZoom + (value / 100) * (this.maxZoom - this.minZoom);
      this._applyZoom();
      this._updateZoomDisplay();
    });

    // 타임라인 휠 이벤트
    this.timelineTracks?.addEventListener('wheel', (e) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl + 휠: 확대/축소
        const delta = e.deltaY > 0 ? -15 : 15;
        this.setZoom(this.zoom + delta);
      } else if (e.shiftKey) {
        // Shift + 휠: 좌우 스크롤
        this.timelineTracks.scrollLeft += e.deltaY;
      } else {
        // 기본 휠: 상하 스크롤
        this.timelineTracks.scrollTop += e.deltaY;
        if (this.layerHeaders) {
          this.layerHeaders.scrollTop = this.timelineTracks.scrollTop;
        }
      }
    });

    // 레이어 헤더 스크롤 동기화
    this.layerHeaders?.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.layerHeaders.scrollTop += e.deltaY;
      if (this.timelineTracks) {
        this.timelineTracks.scrollTop = this.layerHeaders.scrollTop;
      }
    });

    // 플레이헤드 드래그
    this.playheadHandle?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDraggingPlayhead = true;
      document.body.style.cursor = 'ew-resize';
    });

    // 룰러 클릭으로 시간 이동
    this.timelineRuler?.addEventListener('click', (e) => {
      if (this.isDraggingPlayhead) return;
      this._seekFromClick(e);
    });

    // 트랙 영역 클릭으로 시간 이동
    this.tracksContainer?.addEventListener('click', (e) => {
      if (this.isDraggingPlayhead) return;
      // 클립이 아닌 빈 영역 클릭 시에만
      if (e.target === this.tracksContainer || e.target.classList.contains('track-row')) {
        this._seekFromClick(e);
      }
    });

    // 전역 마우스 이벤트 (드래그용)
    document.addEventListener('mousemove', (e) => {
      if (this.isDraggingPlayhead) {
        this._seekFromClick(e);
      }
    });

    document.addEventListener('mouseup', () => {
      if (this.isDraggingPlayhead) {
        this.isDraggingPlayhead = false;
        document.body.style.cursor = 'default';
      }
    });
  }

  /**
   * 클릭 위치에서 시간 계산하여 이동
   */
  _seekFromClick(e) {
    if (this.duration === 0) return;

    const rect = this.tracksContainer?.getBoundingClientRect() || this.timelineRuler?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left + (this.timelineTracks?.scrollLeft || 0);
    const width = this.tracksContainer?.offsetWidth || rect.width;
    const scale = this.zoom / 100;
    const percent = x / (width * scale);
    const time = Math.max(0, Math.min(percent * this.duration, this.duration));

    this._emit('seek', { time });
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  /**
   * 비디오 정보 설정
   */
  setVideoInfo(duration, fps) {
    this.duration = duration;
    this.fps = fps;
    this._updateRuler();
    log.info('비디오 정보 설정', { duration, fps });
  }

  /**
   * 현재 시간 설정 (플레이헤드 위치 업데이트)
   */
  setCurrentTime(time) {
    this.currentTime = time;
    this._updatePlayheadPosition();
  }

  /**
   * 플레이헤드 위치 업데이트
   */
  _updatePlayheadPosition() {
    if (this.duration === 0) return;

    const percent = (this.currentTime / this.duration) * 100;
    const scale = this.zoom / 100;
    const position = percent * scale;

    if (this.playheadLine) {
      this.playheadLine.style.left = `${position}%`;
    }
    if (this.playheadHandle) {
      this.playheadHandle.style.left = `${position}%`;
    }
  }

  /**
   * 줌 레벨 설정
   */
  setZoom(zoom) {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this._applyZoom();
    this._updateZoomDisplay();
    this._showZoomIndicator();
  }

  /**
   * 줌 적용
   */
  _applyZoom() {
    const scale = this.zoom / 100;

    if (this.tracksContainer) {
      this.tracksContainer.style.width = `${scale * 100}%`;
    }
    if (this.timelineRuler) {
      this.timelineRuler.style.width = `${scale * 100}%`;
    }

    this._updatePlayheadPosition();
    this._updateRuler();
  }

  /**
   * 줌 표시 업데이트
   */
  _updateZoomDisplay() {
    if (this.zoomDisplay) {
      this.zoomDisplay.textContent = `${Math.round(this.zoom)}%`;
    }
    if (this.zoomSlider) {
      this.zoomSlider.value = ((this.zoom - this.minZoom) / (this.maxZoom - this.minZoom)) * 100;
    }
  }

  /**
   * 줌 인디케이터 표시
   */
  _showZoomIndicator() {
    // 기존 인디케이터 제거
    const existing = this.container?.querySelector('.zoom-indicator');
    if (existing) existing.remove();

    const indicator = document.createElement('div');
    indicator.className = 'zoom-indicator';
    indicator.textContent = `🔍 ${Math.round(this.zoom)}%`;
    indicator.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--bg-elevated);
      border: 1px solid var(--accent-primary);
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-primary);
      box-shadow: var(--shadow-lg);
      z-index: 1000;
      pointer-events: none;
    `;

    this.container?.appendChild(indicator);

    setTimeout(() => {
      indicator.style.opacity = '0';
      indicator.style.transition = 'opacity 0.3s';
      setTimeout(() => indicator.remove(), 300);
    }, 600);
  }

  /**
   * 룰러 업데이트
   */
  _updateRuler() {
    if (!this.timelineRuler || this.duration === 0) return;

    // 기존 마크 제거
    const existingMarks = this.timelineRuler.querySelectorAll('.ruler-mark');
    existingMarks.forEach(mark => mark.remove());

    // 마크 간격 계산 (화면에 약 6~8개의 마크가 보이도록)
    const scale = this.zoom / 100;
    const numMarks = Math.ceil(6 * scale);
    const interval = this.duration / numMarks;

    for (let i = 0; i <= numMarks; i++) {
      const time = i * interval;
      const percent = (time / this.duration) * 100;

      const mark = document.createElement('span');
      mark.className = 'ruler-mark';
      mark.style.left = `${percent}%`;
      mark.textContent = this._formatTime(time);
      mark.style.cssText += `
        position: absolute;
        font-size: 9px;
        color: var(--text-tertiary);
        font-family: var(--font-mono);
        bottom: 4px;
      `;

      this.timelineRuler.appendChild(mark);
    }
  }

  /**
   * 시간 포맷팅 (MM:SS)
   */
  _formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * 댓글 마커 추가
   */
  addCommentMarker(time, resolved = false) {
    const percent = (time / this.duration) * 100;
    const marker = document.createElement('div');
    marker.className = `comment-marker-track${resolved ? ' resolved' : ''}`;
    marker.style.left = `${percent}%`;
    marker.dataset.time = time;

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit('markerClick', { time });
    });

    this.tracksContainer?.appendChild(marker);
    return marker;
  }

  /**
   * 마커 제거
   */
  removeMarker(marker) {
    marker.remove();
  }

  /**
   * 모든 마커 제거
   */
  clearMarkers() {
    const markers = this.tracksContainer?.querySelectorAll('.comment-marker-track');
    markers?.forEach(marker => marker.remove());
  }

  /**
   * 전체 보기 (100% 줌)
   */
  fitToView() {
    this.setZoom(100);
  }

  /**
   * 확대
   */
  zoomIn() {
    this.setZoom(this.zoom + 25);
  }

  /**
   * 축소
   */
  zoomOut() {
    this.setZoom(this.zoom - 25);
  }

  /**
   * 정리
   */
  destroy() {
    this.clearMarkers();
    log.info('Timeline 정리됨');
  }
}

export default Timeline;
