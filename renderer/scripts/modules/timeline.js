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
    this.totalFrames = 0;
    this.currentTime = 0;
    this.zoom = 100; // 100% = 기본
    this.minZoom = 50;
    this.maxZoom = 400;

    // 프레임 그리드 설정
    this.frameGridContainer = null;

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

    const rect = this.tracksContainer?.getBoundingClientRect();
    if (!rect) return;

    // getBoundingClientRect()는 이미 스크롤 위치를 반영하므로
    // 클릭 위치에서 rect.left를 빼면 컨테이너 내 상대 위치가 됨
    const x = e.clientX - rect.left;

    // tracksContainer의 실제 너비 (줌이 적용된 상태)
    const containerWidth = this.tracksContainer?.offsetWidth || rect.width;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const time = percent * this.duration;

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
    this.totalFrames = Math.floor(duration * fps);
    this._updateRuler();
    this._updateFrameGrid();
    log.info('비디오 정보 설정', { duration, fps, totalFrames: this.totalFrames });
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
   * 핸들과 라인 모두 동일한 left 값을 사용 (CSS에서 margin-left로 핸들 중앙 정렬)
   */
  _updatePlayheadPosition() {
    if (this.duration === 0) return;

    // tracksContainer의 실제 너비를 기준으로 픽셀 위치 계산
    const containerWidth = this.tracksContainer?.offsetWidth || 0;
    if (containerWidth === 0) return;

    const percent = this.currentTime / this.duration;
    const positionPx = containerWidth * percent;

    // 핸들과 라인 모두 동일한 픽셀 위치 설정
    // CSS에서 핸들은 margin-left: -6px로 중앙 정렬됨
    if (this.playheadLine) {
      this.playheadLine.style.left = `${positionPx}px`;
    }
    if (this.playheadHandle) {
      this.playheadHandle.style.left = `${positionPx}px`;
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
    this._updateFrameGrid();
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
   * 프레임 그리드 업데이트
   * 줌 레벨에 따라 프레임 단위 격자선 표시 (프리미어 스타일)
   */
  _updateFrameGrid() {
    if (!this.tracksContainer || this.duration === 0 || this.totalFrames === 0) return;

    // 프레임 그리드 컨테이너 생성 또는 가져오기
    if (!this.frameGridContainer) {
      this.frameGridContainer = document.createElement('div');
      this.frameGridContainer.className = 'frame-grid-container';
      this.frameGridContainer.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1;
      `;
      this.tracksContainer.appendChild(this.frameGridContainer);
    }

    const containerWidth = this.tracksContainer.offsetWidth;
    const frameWidth = containerWidth / this.totalFrames;

    // 프레임 너비에 따른 그리드 표시 결정
    // 4px 이상: 개별 프레임 표시
    // 2px 이상: 5프레임 단위 표시
    // 그 이하: 숨김
    const minFrameWidthForGrid = 4;
    const minFrameWidthForSparse = 2;

    if (frameWidth >= minFrameWidthForGrid) {
      // 개별 프레임 그리드 표시
      this._renderFrameGrid(frameWidth, 1);
    } else if (frameWidth >= minFrameWidthForSparse) {
      // 5프레임 또는 10프레임 단위로 표시
      const step = frameWidth * 5 >= minFrameWidthForGrid ? 5 : 10;
      this._renderFrameGrid(frameWidth * step, step);
    } else {
      // 그리드 숨김
      this.frameGridContainer.innerHTML = '';
      this.frameGridContainer.style.display = 'none';
    }
  }

  /**
   * 프레임 그리드 렌더링
   * @param {number} gridWidth - 격자 간격 (픽셀)
   * @param {number} frameStep - 프레임 단위 (1, 5, 10 등)
   */
  _renderFrameGrid(gridWidth, frameStep) {
    this.frameGridContainer.style.display = 'block';

    // CSS background로 효율적인 그리드 렌더링
    // 가시성 개선: 투명도를 높임
    const majorLineColor = 'rgba(255, 208, 0, 0.6)'; // 1초 단위 (노란색, 더 진하게)
    const minorLineColor = 'rgba(255, 255, 255, 0.25)'; // 일반 프레임 (더 잘 보이게)

    // 1초 단위 강조선 계산
    const framesPerSecond = this.fps;
    const secondWidth = gridWidth * (framesPerSecond / frameStep);

    // 그리드 패턴 생성
    let backgroundImage = '';
    let backgroundSize = '';

    if (frameStep === 1) {
      // 개별 프레임 표시 + 1초 단위 강조
      backgroundImage = `
        repeating-linear-gradient(
          to right,
          ${majorLineColor} 0px,
          ${majorLineColor} 2px,
          transparent 2px,
          transparent ${secondWidth}px
        ),
        repeating-linear-gradient(
          to right,
          ${minorLineColor} 0px,
          ${minorLineColor} 1px,
          transparent 1px,
          transparent ${gridWidth}px
        )
      `;
      backgroundSize = `${secondWidth}px 100%, ${gridWidth}px 100%`;
    } else {
      // 스파스 그리드 (5프레임/10프레임 단위)
      const sparseLineColor = 'rgba(255, 255, 255, 0.35)';
      backgroundImage = `
        repeating-linear-gradient(
          to right,
          ${majorLineColor} 0px,
          ${majorLineColor} 2px,
          transparent 2px,
          transparent ${secondWidth}px
        ),
        repeating-linear-gradient(
          to right,
          ${sparseLineColor} 0px,
          ${sparseLineColor} 1px,
          transparent 1px,
          transparent ${gridWidth}px
        )
      `;
      backgroundSize = `${secondWidth}px 100%, ${gridWidth}px 100%`;
    }

    this.frameGridContainer.style.backgroundImage = backgroundImage;
    this.frameGridContainer.style.backgroundSize = backgroundSize;
    this.frameGridContainer.style.backgroundRepeat = 'repeat-x';
    this.frameGridContainer.style.backgroundPosition = '0 0';

    log.debug('프레임 그리드 업데이트', {
      frameStep,
      gridWidth: gridWidth.toFixed(2),
      zoom: this.zoom
    });
  }

  /**
   * 시간 포맷팅 (MM:SS)
   */
  _formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // ====== 그리기 레이어 관련 ======

  /**
   * 그리기 레이어들 렌더링
   * @param {Array} layers - DrawingLayer 배열
   * @param {string} activeLayerId - 현재 선택된 레이어 ID
   */
  renderDrawingLayers(layers, activeLayerId) {
    if (!this.tracksContainer || !this.layerHeaders) return;

    // 기존 그리기 레이어 트랙 제거
    const existingTracks = this.tracksContainer.querySelectorAll('.drawing-track-row');
    existingTracks.forEach(t => t.remove());

    const existingHeaders = this.layerHeaders.querySelectorAll('.drawing-layer-header');
    existingHeaders.forEach(h => h.remove());

    // 각 레이어 렌더링
    layers.forEach((layer, index) => {
      this._renderLayerHeader(layer, activeLayerId === layer.id);
      this._renderLayerTrack(layer, activeLayerId === layer.id);
    });
  }

  /**
   * 레이어 헤더 렌더링 (왼쪽 패널)
   */
  _renderLayerHeader(layer, isActive) {
    const header = document.createElement('div');
    header.className = `layer-header drawing-layer-header${isActive ? ' selected' : ''}`;
    header.dataset.layerId = layer.id;

    header.innerHTML = `
      <div class="layer-color" style="background: ${layer.color}"></div>
      <span class="layer-visibility" data-action="visibility">
        ${layer.visible ? '👁' : '👁‍🗨'}
      </span>
      <span class="layer-name">${layer.name}</span>
      <span class="layer-lock" data-action="lock">
        ${layer.locked ? '🔒' : ''}
      </span>
    `;

    // 레이어 선택 클릭
    header.addEventListener('click', (e) => {
      if (e.target.dataset.action) return;
      this._emit('layerSelect', { layerId: layer.id });
    });

    // 가시성 토글
    header.querySelector('[data-action="visibility"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit('layerVisibilityToggle', { layerId: layer.id });
    });

    // 잠금 토글
    header.querySelector('[data-action="lock"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit('layerLockToggle', { layerId: layer.id });
    });

    this.layerHeaders.appendChild(header);
  }

  /**
   * 레이어 트랙 렌더링 (오른쪽 타임라인)
   */
  _renderLayerTrack(layer, isActive) {
    const trackRow = document.createElement('div');
    trackRow.className = `track-row drawing-track-row${isActive ? ' active-layer' : ''}`;
    trackRow.dataset.layerId = layer.id;

    // 키프레임 범위 가져오기
    const ranges = layer.getKeyframeRanges(this.totalFrames);

    ranges.forEach(range => {
      const clip = this._createKeyframeClip(layer, range);
      trackRow.appendChild(clip);
    });

    // 트랙 클릭 이벤트 (프레임 이동)
    trackRow.addEventListener('click', (e) => {
      if (e.target.classList.contains('keyframe-marker')) return;
      this._seekFromClick(e);
    });

    this.tracksContainer.appendChild(trackRow);
  }

  /**
   * 키프레임 클립 요소 생성
   */
  _createKeyframeClip(layer, range) {
    const clip = document.createElement('div');
    clip.className = 'track-clip drawing-clip';
    clip.dataset.startFrame = range.start;
    clip.dataset.endFrame = range.end;

    // 위치 및 크기 계산
    const startPercent = (range.start / this.totalFrames) * 100;
    const widthPercent = ((range.end - range.start + 1) / this.totalFrames) * 100;

    clip.style.cssText = `
      left: ${startPercent}%;
      width: ${widthPercent}%;
      background: linear-gradient(90deg, ${layer.color}66, ${layer.color}33);
      border-left: 2px solid ${layer.color};
    `;

    // 키프레임 마커
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    marker.innerHTML = range.keyframe.isEmpty ? '○' : '●';
    marker.title = `키프레임 ${range.start}`;
    clip.appendChild(marker);

    // 프레임 범위 표시
    if (range.end - range.start > 0) {
      const label = document.createElement('span');
      label.className = 'clip-label';
      label.textContent = `${range.start} - ${range.end}`;
      clip.appendChild(label);
    }

    return clip;
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
