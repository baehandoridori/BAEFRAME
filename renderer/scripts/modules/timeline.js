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
    this.minZoom = 25;
    this.maxZoom = 800;  // 확대 상한 800%로 증가

    // 프레임 그리드 설정
    this.frameGridContainer = null;

    // 플레이헤드 드래그 상태
    this.isDraggingPlayhead = false;

    // 타임라인 드래그 seek 상태
    this.isDraggingSeeking = false;

    // 패닝 상태
    this.isPanning = false;
    this.panStartX = 0;
    this.panScrollLeft = 0;

    // 키프레임 드래그 상태
    this.isDraggingKeyframe = false;
    this.draggedKeyframe = null;  // { layerId, frame, element }
    this.dragStartX = 0;
    this.dragStartFrame = 0;
    this.dragGhost = null;  // 드래그 중 표시할 고스트 요소

    // 다중 선택 상태
    this.selectedKeyframes = [];  // [ { layerId, frame } ]
    this.isSelecting = false;  // 드래그 박스 선택 중
    this.selectionBox = null;
    this.selectionStartX = 0;
    this.selectionStartY = 0;

    // 썸네일 프리뷰 상태
    this.thumbnailGenerator = null;
    this.thumbnailTooltip = null;
    this.isThumbnailVisible = false;

    // 초기화
    this._setupEventListeners();
    this._setupThumbnailTooltip();
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

      if (e.shiftKey) {
        // Shift + 휠: 상하 스크롤 (레이어 탐색)
        this.timelineTracks.scrollTop += e.deltaY;
        if (this.layerHeaders) {
          this.layerHeaders.scrollTop = this.timelineTracks.scrollTop;
        }
      } else {
        // 기본 휠: 마우스 위치 기준 확대/축소
        const delta = e.deltaY > 0 ? -15 : 15;
        const rect = this.timelineTracks.getBoundingClientRect();
        const mouseX = e.clientX - rect.left + this.timelineTracks.scrollLeft;
        this.setZoomAtPosition(this.zoom + delta, mouseX);
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

    // 트랙 영역 마우스 이벤트 (드래그 seek + 패닝 + 선택)
    this.tracksContainer?.addEventListener('mousedown', (e) => {
      if (this.isDraggingPlayhead) return;

      // Space 키를 누른 상태면 패닝 모드
      if (this._isSpacePressed) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panScrollLeft = this.timelineTracks.scrollLeft;
        this.tracksContainer.classList.add('panning');
        e.preventDefault();
        return;
      }

      // Alt 키를 누른 상태면 선택 박스 모드
      if (e.altKey) {
        e.preventDefault();
        this._startSelection(e);
        return;
      }

      // 빈 영역에서 마우스 다운 시 드래그 seek 시작
      if (e.target === this.tracksContainer ||
          e.target.classList.contains('track-row') ||
          e.target.classList.contains('frame-grid-container')) {
        this.isDraggingSeeking = true;
        this._seekFromClick(e);
        document.body.style.cursor = 'ew-resize';
      }
    });

    // Space 키 추적 (패닝 모드용)
    this._isSpacePressed = false;
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.target.matches('input, textarea')) {
        this._isSpacePressed = true;
        if (this.tracksContainer) {
          this.tracksContainer.style.cursor = 'grab';
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this._isSpacePressed = false;
        if (this.tracksContainer && !this.isPanning) {
          this.tracksContainer.style.cursor = 'grab';
        }
      }
    });

    // 전역 마우스 이벤트 (드래그용)
    document.addEventListener('mousemove', (e) => {
      // 플레이헤드 드래그 (스크러빙 모드)
      if (this.isDraggingPlayhead) {
        this._scrubFromClick(e);
        return;
      }

      // 드래그 seek (스크러빙 모드)
      if (this.isDraggingSeeking) {
        this._scrubFromClick(e);
        return;
      }

      // 패닝
      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        this.timelineTracks.scrollLeft = this.panScrollLeft - dx;
      }

      // 키프레임 드래그
      if (this.isDraggingKeyframe) {
        this._updateKeyframeDrag(e);
      }

      // 선택 박스 드래그
      if (this.isSelecting) {
        this._updateSelection(e);
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (this.isDraggingPlayhead) {
        // 드래그 종료 시 실제 seek 수행
        this._finishScrubbing(e);
        this.isDraggingPlayhead = false;
        document.body.style.cursor = 'default';
      }

      if (this.isDraggingSeeking) {
        // 드래그 종료 시 실제 seek 수행
        this._finishScrubbing(e);
        this.isDraggingSeeking = false;
        document.body.style.cursor = 'default';
      }

      if (this.isPanning) {
        this.isPanning = false;
        this.tracksContainer?.classList.remove('panning');
      }

      // 키프레임 드래그 완료
      if (this.isDraggingKeyframe) {
        this._finishKeyframeDrag(e);
      }

      // 선택 박스 완료
      if (this.isSelecting) {
        this._finishSelection(e);
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
   * 스크러빙 중 (드래그 중 프리뷰만 표시, 실제 seek 없음)
   */
  _scrubFromClick(e) {
    if (this.duration === 0) return;

    const rect = this.tracksContainer?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const containerWidth = this.tracksContainer?.offsetWidth || rect.width;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const time = percent * this.duration;

    // 플레이헤드 위치 업데이트 (시각적으로만)
    this.scrubTime = time;
    this._updatePlayheadPositionDirect(time);

    // 스크러빙 프리뷰 이벤트 (썸네일 표시용)
    this._emit('scrubbing', { time, percent });
  }

  /**
   * 스크러빙 완료 (실제 seek 수행)
   */
  _finishScrubbing(e) {
    if (this.scrubTime !== undefined) {
      this._emit('seek', { time: this.scrubTime });
      this._emit('scrubbingEnd', { time: this.scrubTime });
      this.scrubTime = undefined;
    }
  }

  /**
   * 플레이헤드 위치 직접 업데이트 (스크러빙용)
   */
  _updatePlayheadPositionDirect(time) {
    if (this.duration === 0) return;

    const percent = time / this.duration;
    const containerWidth = this.tracksContainer?.offsetWidth || 1000;
    const positionPx = percent * containerWidth;

    if (this.playheadLine) {
      this.playheadLine.style.left = `${positionPx}px`;
    }
    if (this.playheadHandle) {
      this.playheadHandle.style.left = `${positionPx}px`;
    }
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
   * 특정 위치를 기준으로 줌 설정 (마우스 위치 기준 확대/축소)
   * @param {number} zoom - 새 줌 레벨
   * @param {number} focalX - 기준점 X 좌표 (스크롤 포함된 절대 위치)
   */
  setZoomAtPosition(zoom, focalX) {
    const oldZoom = this.zoom;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));

    if (oldZoom === newZoom) return;

    // 현재 기준점의 상대적 위치 (0~1)
    const oldScale = oldZoom / 100;
    const newScale = newZoom / 100;

    // 현재 뷰포트에서의 마우스 위치
    const viewportX = focalX - this.timelineTracks.scrollLeft;

    // 줌 적용
    this.zoom = newZoom;
    this._applyZoom();
    this._updateZoomDisplay();
    this._showZoomIndicator();

    // 새 줌에서 같은 콘텐츠 위치가 마우스 아래에 오도록 스크롤 조정
    const newFocalX = (focalX / oldScale) * newScale;
    this.timelineTracks.scrollLeft = newFocalX - viewportX;
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
    clip.dataset.layerId = layer.id;

    // 선택된 키프레임인지 확인
    const isSelected = this.selectedKeyframes.some(
      kf => kf.layerId === layer.id && kf.frame === range.start
    );
    if (isSelected) {
      clip.classList.add('selected');
    }

    // 위치 및 크기 계산
    const startPercent = (range.start / this.totalFrames) * 100;
    const widthPercent = ((range.end - range.start + 1) / this.totalFrames) * 100;

    clip.style.cssText = `
      left: ${startPercent}%;
      width: ${widthPercent}%;
      background: linear-gradient(90deg, ${layer.color}66, ${layer.color}33);
      border-left: 2px solid ${layer.color};
    `;

    // 키프레임 마커 (드래그 핸들)
    const marker = document.createElement('div');
    marker.className = 'keyframe-marker';
    marker.innerHTML = range.keyframe.isEmpty ? '○' : '●';
    marker.title = `키프레임 ${range.start} (드래그하여 이동)`;
    marker.dataset.layerId = layer.id;
    marker.dataset.frame = range.start;

    // 키프레임 마커 드래그 시작
    marker.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this._startKeyframeDrag(e, layer.id, range.start, clip);
    });

    // 키프레임 클릭으로 선택 토글
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleKeyframeSelection(layer.id, range.start, e.ctrlKey || e.metaKey);
    });

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

  // ====== 키프레임 드래그 ======

  /**
   * 키프레임 드래그 시작
   */
  _startKeyframeDrag(e, layerId, frame, clipElement) {
    this.isDraggingKeyframe = true;
    this.draggedKeyframe = { layerId, frame, element: clipElement };
    this.dragStartX = e.clientX;
    this.dragStartFrame = frame;

    // 이 키프레임이 선택되지 않았으면 단독 선택
    const isSelected = this.selectedKeyframes.some(
      kf => kf.layerId === layerId && kf.frame === frame
    );
    if (!isSelected) {
      this.selectedKeyframes = [{ layerId, frame }];
    }

    // 고스트 요소 생성
    this._createDragGhost(e, frame);

    document.body.style.cursor = 'grabbing';
    log.debug('키프레임 드래그 시작', { layerId, frame });
  }

  /**
   * 키프레임 드래그 업데이트
   */
  _updateKeyframeDrag(e) {
    if (!this.dragGhost || !this.tracksContainer) return;

    const containerRect = this.tracksContainer.getBoundingClientRect();
    const containerWidth = this.tracksContainer.offsetWidth;

    // 마우스 위치에서 프레임 계산
    const x = e.clientX - containerRect.left + this.timelineTracks.scrollLeft;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const newFrame = Math.round(percent * (this.totalFrames - 1));

    // 고스트 위치 업데이트
    const ghostPercent = (newFrame / this.totalFrames) * 100;
    this.dragGhost.style.left = `${ghostPercent}%`;
    this.dragGhost.textContent = `F${newFrame}`;

    // 프레임 이동량 저장
    this.dragGhost.dataset.targetFrame = newFrame;
  }

  /**
   * 키프레임 드래그 완료
   */
  _finishKeyframeDrag(e) {
    if (!this.draggedKeyframe) return;

    const targetFrame = parseInt(this.dragGhost?.dataset.targetFrame || this.dragStartFrame);
    const frameDelta = targetFrame - this.dragStartFrame;

    // 고스트 제거
    if (this.dragGhost) {
      this.dragGhost.remove();
      this.dragGhost = null;
    }

    this.isDraggingKeyframe = false;
    document.body.style.cursor = 'default';

    // 이동량이 있으면 이벤트 발생
    if (frameDelta !== 0) {
      // 선택된 모든 키프레임 이동
      const keyframesToMove = this.selectedKeyframes.map(kf => ({
        layerId: kf.layerId,
        fromFrame: kf.frame,
        toFrame: kf.frame + frameDelta
      }));

      this._emit('keyframesMove', { keyframes: keyframesToMove, frameDelta });
      log.info('키프레임 이동', { keyframes: keyframesToMove, frameDelta });
    }

    this.draggedKeyframe = null;
  }

  /**
   * 드래그 고스트 생성
   */
  _createDragGhost(e, frame) {
    this.dragGhost = document.createElement('div');
    this.dragGhost.className = 'keyframe-drag-ghost';
    this.dragGhost.textContent = `F${frame}`;

    const containerRect = this.tracksContainer.getBoundingClientRect();
    const percent = (frame / this.totalFrames) * 100;
    this.dragGhost.style.left = `${percent}%`;

    this.tracksContainer.appendChild(this.dragGhost);
  }

  // ====== 키프레임 선택 ======

  /**
   * 키프레임 선택 토글
   */
  _toggleKeyframeSelection(layerId, frame, addToSelection) {
    const index = this.selectedKeyframes.findIndex(
      kf => kf.layerId === layerId && kf.frame === frame
    );

    if (addToSelection) {
      // Ctrl/Cmd + 클릭: 선택에 추가/제거
      if (index !== -1) {
        this.selectedKeyframes.splice(index, 1);
      } else {
        this.selectedKeyframes.push({ layerId, frame });
      }
    } else {
      // 일반 클릭: 단독 선택
      if (index !== -1 && this.selectedKeyframes.length === 1) {
        // 이미 단독 선택된 상태면 선택 해제
        this.selectedKeyframes = [];
      } else {
        this.selectedKeyframes = [{ layerId, frame }];
      }
    }

    this._emit('keyframeSelectionChanged', { selected: this.selectedKeyframes });
    this._updateKeyframeSelectionUI();
  }

  /**
   * 키프레임 선택 UI 업데이트
   */
  _updateKeyframeSelectionUI() {
    // 모든 클립에서 selected 클래스 제거
    this.tracksContainer?.querySelectorAll('.drawing-clip').forEach(clip => {
      clip.classList.remove('selected');
    });

    // 선택된 키프레임에 selected 클래스 추가
    this.selectedKeyframes.forEach(kf => {
      const clip = this.tracksContainer?.querySelector(
        `.drawing-clip[data-layer-id="${kf.layerId}"][data-start-frame="${kf.frame}"]`
      );
      if (clip) {
        clip.classList.add('selected');
      }
    });
  }

  /**
   * 선택 박스 시작 (빈 영역 드래그)
   */
  _startSelection(e) {
    if (this.isDraggingPlayhead || this.isPanning || this.isDraggingSeeking) return;

    this.isSelecting = true;
    const containerRect = this.tracksContainer.getBoundingClientRect();
    this.selectionStartX = e.clientX - containerRect.left + this.timelineTracks.scrollLeft;
    this.selectionStartY = e.clientY - containerRect.top;

    // 선택 박스 생성
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'selection-box';
    this.selectionBox.style.left = `${this.selectionStartX}px`;
    this.selectionBox.style.top = `${this.selectionStartY}px`;
    this.tracksContainer.appendChild(this.selectionBox);

    // 기존 선택 초기화 (Ctrl 안 누른 경우)
    if (!e.ctrlKey && !e.metaKey) {
      this.selectedKeyframes = [];
    }
  }

  /**
   * 선택 박스 업데이트
   */
  _updateSelection(e) {
    if (!this.selectionBox || !this.tracksContainer) return;

    const containerRect = this.tracksContainer.getBoundingClientRect();
    const currentX = e.clientX - containerRect.left + this.timelineTracks.scrollLeft;
    const currentY = e.clientY - containerRect.top;

    const left = Math.min(this.selectionStartX, currentX);
    const top = Math.min(this.selectionStartY, currentY);
    const width = Math.abs(currentX - this.selectionStartX);
    const height = Math.abs(currentY - this.selectionStartY);

    this.selectionBox.style.left = `${left}px`;
    this.selectionBox.style.top = `${top}px`;
    this.selectionBox.style.width = `${width}px`;
    this.selectionBox.style.height = `${height}px`;
  }

  /**
   * 선택 박스 완료
   */
  _finishSelection(e) {
    if (!this.selectionBox) return;

    const boxRect = this.selectionBox.getBoundingClientRect();

    // 선택 박스 내의 키프레임 마커 찾기
    this.tracksContainer?.querySelectorAll('.keyframe-marker').forEach(marker => {
      const markerRect = marker.getBoundingClientRect();

      // 마커가 선택 박스 안에 있는지 확인
      if (markerRect.left >= boxRect.left &&
          markerRect.right <= boxRect.right &&
          markerRect.top >= boxRect.top &&
          markerRect.bottom <= boxRect.bottom) {
        const layerId = marker.dataset.layerId;
        const frame = parseInt(marker.dataset.frame);

        // 선택에 추가 (중복 방지)
        if (!this.selectedKeyframes.some(kf => kf.layerId === layerId && kf.frame === frame)) {
          this.selectedKeyframes.push({ layerId, frame });
        }
      }
    });

    // 선택 박스 제거
    this.selectionBox.remove();
    this.selectionBox = null;
    this.isSelecting = false;

    this._emit('keyframeSelectionChanged', { selected: this.selectedKeyframes });
    this._updateKeyframeSelectionUI();
  }

  /**
   * 선택 초기화
   */
  clearSelection() {
    this.selectedKeyframes = [];
    this._updateKeyframeSelectionUI();
  }

  /**
   * 댓글 마커 추가
   */
  addCommentMarker(time, resolved = false, frame = 0) {
    const percent = (time / this.duration) * 100;
    const marker = document.createElement('div');
    marker.className = `comment-marker-track${resolved ? ' resolved' : ''}`;
    marker.style.left = `${percent}%`;
    marker.dataset.time = time;
    marker.dataset.frame = frame;
    marker.title = `댓글 (프레임 ${frame})`;

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit('commentMarkerClick', { time, frame });
    });

    this.tracksContainer?.appendChild(marker);
    return marker;
  }

  /**
   * 모든 댓글 마커 제거
   */
  clearCommentMarkers() {
    const markers = this.tracksContainer?.querySelectorAll('.comment-marker-track');
    markers?.forEach(marker => marker.remove());
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
    this.clearCommentMarkers();
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

  // ==========================================
  // 썸네일 프리뷰 관련
  // ==========================================

  /**
   * 썸네일 툴팁 초기화
   */
  _setupThumbnailTooltip() {
    // 툴팁 요소 생성
    this.thumbnailTooltip = document.createElement('div');
    this.thumbnailTooltip.className = 'timeline-thumbnail-tooltip';
    this.thumbnailTooltip.innerHTML = `
      <img class="thumbnail-image" src="" alt="Preview">
      <div class="thumbnail-time"></div>
    `;
    this.thumbnailTooltip.style.cssText = `
      position: fixed;
      display: none;
      z-index: 9999;
      pointer-events: none;
    `;
    document.body.appendChild(this.thumbnailTooltip);

    // 영상 레이어(비디오 트랙 클립)에만 썸네일 표시
    const videoTrackClip = document.getElementById('videoTrackClip');

    videoTrackClip?.addEventListener('mousemove', (e) => {
      if (this.isDraggingPlayhead || this.isDraggingSeeking || this.isPanning) {
        this._hideThumbnailTooltip();
        return;
      }
      this._showThumbnailAtPosition(e);
    });

    videoTrackClip?.addEventListener('mouseleave', () => {
      this._hideThumbnailTooltip();
    });
  }

  /**
   * 썸네일 생성기 설정
   */
  setThumbnailGenerator(generator) {
    this.thumbnailGenerator = generator;
    log.info('썸네일 생성기 연결됨');
  }

  /**
   * 마우스 위치에 썸네일 표시
   */
  _showThumbnailAtPosition(e) {
    if (!this.thumbnailGenerator?.isReady || this.duration === 0) {
      return;
    }

    const rect = this.tracksContainer?.getBoundingClientRect();
    if (!rect) return;

    // 마우스 위치에서 시간 계산
    const x = e.clientX - rect.left;
    const containerWidth = this.tracksContainer?.offsetWidth || rect.width;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const time = percent * this.duration;

    // 해당 시간의 썸네일 가져오기
    const thumbnailUrl = this.thumbnailGenerator.getThumbnailUrlAt(time);
    if (!thumbnailUrl) return;

    // 툴팁 업데이트
    const img = this.thumbnailTooltip.querySelector('.thumbnail-image');
    const timeDisplay = this.thumbnailTooltip.querySelector('.thumbnail-time');

    img.src = thumbnailUrl;
    timeDisplay.textContent = this._formatTime(time);

    // 툴팁 위치 설정 (마우스 위)
    const tooltipWidth = 170;
    const tooltipHeight = 110;
    let tooltipX = e.clientX - tooltipWidth / 2;
    let tooltipY = rect.top - tooltipHeight - 10;

    // 화면 밖으로 나가지 않도록 조정
    tooltipX = Math.max(10, Math.min(tooltipX, window.innerWidth - tooltipWidth - 10));
    if (tooltipY < 10) {
      tooltipY = rect.bottom + 10;
    }

    this.thumbnailTooltip.style.left = `${tooltipX}px`;
    this.thumbnailTooltip.style.top = `${tooltipY}px`;
    this.thumbnailTooltip.style.display = 'block';
    this.isThumbnailVisible = true;
  }

  /**
   * 썸네일 툴팁 숨기기
   */
  _hideThumbnailTooltip() {
    if (this.thumbnailTooltip) {
      this.thumbnailTooltip.style.display = 'none';
      this.isThumbnailVisible = false;
    }
  }

  /**
   * 시간 포맷 (HH:MM:SS)
   */
  _formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * this.fps);

    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  /**
   * 정리
   */
  destroy() {
    this.clearMarkers();
    if (this.thumbnailTooltip) {
      this.thumbnailTooltip.remove();
      this.thumbnailTooltip = null;
    }
    log.info('Timeline 정리됨');
  }
}

export default Timeline;
