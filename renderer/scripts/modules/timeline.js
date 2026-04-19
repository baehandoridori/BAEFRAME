/**
 * baeframe - Timeline Module
 * 타임라인 UI 및 인터랙션 관리
 */

import { createLogger } from '../logger.js';
import { MARKER_COLORS } from './comment-manager.js';
import { resolveFrameGridTier } from './frame-grid-tiers.js';
import { findRangeClusters, assignLanes, clusterKey } from './comment-cluster.js';

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
    this.minZoom = 100; // 최소 100% (타임라인이 꽉 차게)
    this.maxZoom = 800;  // 기본값 (영상 길이에 따라 동적 조정됨)
    this.baseMaxZoom = 800;  // 최소 maxZoom 보장

    // 재생 중 플레이헤드 따라가기 상태
    this.isPlaying = false;

    // 프레임 그리드 설정
    this.frameGridContainer = null;
    this.gridVisible = true;          // 격자 표시 토글 (기본 ON)
    this._lastFrameGridTier = null;  // 히스테리시스용 직전 단계

    // 클러스터 펼침/접힘 상태
    this.expandedClusterId = null;  // 현재 펼친 클러스터의 키 (markerId)
    this._lastComments = null;      // 펼치기/접기 재렌더용 캐시

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
    this._setupResizeObserver();
    this._updateZoomDisplay();

    log.info('Timeline 초기화됨');
  }

  /**
   * 리사이즈 옵저버 설정 (창 크기 변경 시 플레이헤드 위치 보정)
   */
  _setupResizeObserver() {
    if (!this.timelineTracks) return;

    let prevContainerWidth = 0;

    const resizeObserver = new ResizeObserver((entries) => {
      // DOM이 완전히 업데이트된 후 처리
      requestAnimationFrame(() => {
        const newContainerWidth = this.tracksContainer?.offsetWidth || 0;

        // 스크롤 위치 비율 유지 (리사이즈 전 비율로 새 위치 계산)
        if (prevContainerWidth > 0 && newContainerWidth > 0 && prevContainerWidth !== newContainerWidth) {
          const scrollRatio = this.timelineTracks.scrollLeft / prevContainerWidth;
          this.timelineTracks.scrollLeft = scrollRatio * newContainerWidth;
        }

        prevContainerWidth = newContainerWidth;

        // 플레이헤드 위치 업데이트
        this._updatePlayheadPosition();

        // 구간 반복 마커도 업데이트 (이벤트 발생)
        this._emit('resize', { width: newContainerWidth });
      });
    });

    resizeObserver.observe(this.timelineTracks);
  }

  /**
   * 이벤트 리스너 설정
   */
  _setupEventListeners() {
    // 줌 슬라이더 - 플레이헤드 중심으로 줌
    this.zoomSlider?.addEventListener('input', (e) => {
      const value = e.target.value;
      const newZoom = this.minZoom + (value / 100) * (this.maxZoom - this.minZoom);

      // 현재 시간의 비율 (0~1) - 줌과 무관하게 항상 동일
      const timeRatio = this.duration > 0 ? this.currentTime / this.duration : 0;

      // 줌 적용
      this.zoom = newZoom;
      this._applyZoom();
      this._updateZoomDisplay();

      // 플레이헤드가 뷰포트 중앙에 오도록 스크롤
      const newContainerWidth = this.tracksContainer?.offsetWidth || 1000;
      const newPlayheadX = timeRatio * newContainerWidth;
      const viewportWidth = this.timelineTracks?.clientWidth || 1000;
      if (this.timelineTracks) {
        this.timelineTracks.scrollLeft = Math.max(0, newPlayheadX - viewportWidth / 2);
      }
    });

    // 줌 슬라이더 사용 후 포커스 해제 (스페이스바가 재생으로 작동하도록)
    this.zoomSlider?.addEventListener('mouseup', (e) => {
      e.target.blur();
    });
    this.zoomSlider?.addEventListener('change', (e) => {
      e.target.blur();
    });

    // 타임라인 휠 이벤트 (passive: false로 preventDefault 사용 가능하게)
    this.timelineTracks?.addEventListener('wheel', (e) => {
      e.preventDefault();

      if (e.shiftKey) {
        // Shift + 휠: 상하 스크롤 (레이어 탐색)
        this.timelineTracks.scrollTop += e.deltaY;
        if (this.layerHeaders) {
          this.layerHeaders.scrollTop = this.timelineTracks.scrollTop;
        }
      } else if (e.ctrlKey) {
        // Ctrl + 휠: 가로 스크롤 (긴 영상에서 빠른 위치 이동)
        const scrollAmount = e.deltaY * 3;
        this.timelineTracks.scrollLeft += scrollAmount;
      } else {
        // 기본 휠: 플레이헤드(재생바) 위치 기준 확대/축소
        // 비율 기반 줌: 현재 줌 레벨의 5%씩 변화 (고배율일수록 변화량 증가)
        const zoomStep = Math.max(15, this.zoom * 0.05);
        const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));

        if (Math.abs(newZoom - this.zoom) < 0.1) return;

        // 현재 시간의 비율 (0~1) - 줌과 무관하게 항상 동일
        const timeRatio = this.duration > 0 ? this.currentTime / this.duration : 0;

        // 줌 적용
        this.zoom = newZoom;
        this._applyZoom();
        this._updateZoomDisplay();
        this._showZoomIndicator();

        // 새 줌에서 플레이헤드가 뷰포트 중앙에 오도록 스크롤
        const newContainerWidth = this.tracksContainer?.offsetWidth || 1000;
        const newPlayheadX = timeRatio * newContainerWidth;
        const viewportWidth = this.timelineTracks.clientWidth;
        this.timelineTracks.scrollLeft = Math.max(0, newPlayheadX - viewportWidth / 2);
      }
    }, { passive: false });

    // 레이어 헤더 스크롤 동기화
    this.layerHeaders?.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.layerHeaders.scrollTop += e.deltaY;
      if (this.timelineTracks) {
        this.timelineTracks.scrollTop = this.layerHeaders.scrollTop;
      }
    }, { passive: false });

    // 플레이헤드 드래그
    this.playheadHandle?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDraggingPlayhead = true;
      document.body.style.cursor = 'ew-resize';
    });

    // 룰러 커서 설정
    if (this.timelineRuler) {
      this.timelineRuler.style.cursor = 'ew-resize';
    }

    // 룰러 클릭/드래그로 시간 이동
    this.timelineRuler?.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.isDraggingPlayhead = true;
      this._seekFromClick(e);
      document.body.style.cursor = 'ew-resize';
    });

    // 트랙 영역 마우스 이벤트 (패닝 + 선택)
    this.tracksContainer?.addEventListener('mousedown', (e) => {
      if (this.isDraggingPlayhead) return;

      // Alt 키를 누른 상태면 선택 박스 모드
      if (e.altKey) {
        e.preventDefault();
        this._startSelection(e);
        return;
      }

      // 빈 영역 또는 비디오 트랙에서 마우스 다운 시 패닝 모드 (기본 동작)
      if (e.target === this.tracksContainer ||
          e.target.classList.contains('track-row') ||
          e.target.classList.contains('frame-grid-container') ||
          e.target.classList.contains('track-clip')) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panScrollLeft = this.timelineTracks.scrollLeft;
        this.tracksContainer.classList.add('panning');
        e.preventDefault();
      }
    });

    // 트랙 영역 기본 커서를 grab으로 설정
    if (this.tracksContainer) {
      this.tracksContainer.style.cursor = 'grab';
    }

    // 전역 마우스 이벤트 (드래그용)
    document.addEventListener('mousemove', (e) => {
      // 플레이헤드 드래그 (스크러빙 모드)
      if (this.isDraggingPlayhead) {
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
   * 시간을 프레임 단위로 스냅
   */
  _snapTimeToFrame(time) {
    if (this.fps === 0) return time;
    const frame = Math.round(time * this.fps);
    return Math.max(0, Math.min(frame / this.fps, this.duration));
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
    const time = this._snapTimeToFrame(percent * this.duration);

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
    const time = this._snapTimeToFrame(percent * this.duration);

    // 플레이헤드 위치 업데이트 (시각적으로만)
    this.scrubTime = time;
    this._updatePlayheadPositionDirect(time);

    // 플레이헤드가 뷰포트 경계에 가까우면 자동 스크롤
    this._autoScrollWhileDragging(e.clientX);

    // 스크러빙 프리뷰 이벤트 (썸네일 표시용)
    this._emit('scrubbing', { time, percent });
  }

  /**
   * 플레이헤드 드래그 중 자동 스크롤
   * @param {number} clientX - 마우스 X 좌표
   */
  _autoScrollWhileDragging(clientX) {
    if (!this.timelineTracks) return;

    // timelineTracks (스크롤 뷰포트)의 경계를 사용
    const viewportRect = this.timelineTracks.getBoundingClientRect();
    const viewportLeft = viewportRect.left;
    const viewportRight = viewportRect.right;
    const edgeThreshold = 60; // 경계에서 60px 이내면 스크롤
    const scrollSpeed = 20; // 스크롤 속도 (px)

    // 왼쪽 경계에 가까우면 왼쪽으로 스크롤
    if (clientX < viewportLeft + edgeThreshold && this.timelineTracks.scrollLeft > 0) {
      const intensity = 1 - Math.max(0, clientX - viewportLeft) / edgeThreshold;
      this.timelineTracks.scrollLeft -= scrollSpeed * Math.max(0.3, intensity);
    }
    // 오른쪽 경계에 가까우면 오른쪽으로 스크롤
    else if (clientX > viewportRight - edgeThreshold) {
      const maxScroll = this.timelineTracks.scrollWidth - this.timelineTracks.clientWidth;
      if (this.timelineTracks.scrollLeft < maxScroll) {
        const intensity = 1 - Math.max(0, viewportRight - clientX) / edgeThreshold;
        this.timelineTracks.scrollLeft += scrollSpeed * Math.max(0.3, intensity);
      }
    }
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
    this._lastFrameGridTier = null;  // 재로드 시 히스테리시스 상태 리셋

    // 영상 길이에 따라 maxZoom 동적 계산
    // 프레임이 4px 이상일 때 개별 프레임 그리드가 표시됨
    // 목표: maxZoom에서 frameWidth >= 5px (여유있게)
    this._calculateDynamicMaxZoom();

    this._updateRuler();
    this._updateFrameGrid();
    log.info('비디오 정보 설정', { duration, fps, totalFrames: this.totalFrames, maxZoom: this.maxZoom });
  }

  /**
   * 영상 길이에 따른 동적 maxZoom 계산
   * 프레임 단위가 잘 보이도록 설정
   */
  _calculateDynamicMaxZoom() {
    if (this.totalFrames === 0) {
      this.maxZoom = this.baseMaxZoom;
      return;
    }

    // 기준 컨테이너 너비 (100% 줌일 때)
    // tracksContainer가 아직 렌더링 안됐을 수 있으므로 기본값 사용
    const baseContainerWidth = this.tracksContainer?.offsetWidth || 1200;

    // 100% 줌에서 프레임당 픽셀
    const baseFrameWidth = baseContainerWidth / this.totalFrames;

    // 목표 프레임 너비: 15px (개별 프레임이 편하게 보이도록 - 기존 5px에서 증가)
    const targetFrameWidth = 15;

    // 필요한 줌 레벨 계산
    // frameWidth = baseContainerWidth * (zoom/100) / totalFrames
    // targetFrameWidth = baseContainerWidth * (maxZoom/100) / totalFrames
    // maxZoom = targetFrameWidth * totalFrames * 100 / baseContainerWidth
    const calculatedMaxZoom = (targetFrameWidth * this.totalFrames * 100) / baseContainerWidth;

    // 최소 baseMaxZoom (800%) 보장, 최대 50000%로 제한 (긴 영상도 충분히 확대 가능)
    this.maxZoom = Math.max(this.baseMaxZoom, Math.min(calculatedMaxZoom, 50000));

    // 줌 슬라이더 업데이트
    this._updateZoomDisplay();

    log.debug('동적 maxZoom 계산', {
      totalFrames: this.totalFrames,
      baseContainerWidth,
      baseFrameWidth: baseFrameWidth.toFixed(4),
      calculatedMaxZoom: calculatedMaxZoom.toFixed(0),
      finalMaxZoom: this.maxZoom
    });
  }

  /**
   * 재생 상태 설정
   * @param {boolean} isPlaying - 재생 중 여부
   */
  setPlayingState(isPlaying) {
    this.isPlaying = isPlaying;
  }

  /**
   * 현재 시간 설정 (플레이헤드 위치 업데이트)
   */
  setCurrentTime(time) {
    this.currentTime = time;
    this._updatePlayheadPosition();

    // 재생 중일 때 플레이헤드가 화면 밖으로 나가면 자동 스크롤
    if (this.isPlaying && this.timelineTracks) {
      this._autoScrollToPlayhead();
    }
  }

  /**
   * 플레이헤드가 보이도록 자동 스크롤
   */
  _autoScrollToPlayhead() {
    if (!this.timelineTracks || this.duration === 0) return;

    const containerWidth = this.tracksContainer?.offsetWidth || 0;
    if (containerWidth === 0) return;

    const percent = this.currentTime / this.duration;
    const playheadPx = containerWidth * percent;

    const scrollLeft = this.timelineTracks.scrollLeft;
    const viewportWidth = this.timelineTracks.clientWidth;

    // 플레이헤드가 화면 오른쪽 밖으로 나갔으면 스크롤
    // 여유 공간 50px을 두고 체크
    const margin = 50;
    if (playheadPx > scrollLeft + viewportWidth - margin) {
      // 플레이헤드를 왼쪽에 두고 스크롤 (부드러운 전환)
      this.timelineTracks.scrollLeft = playheadPx - margin;
    }
    // 플레이헤드가 화면 왼쪽 밖에 있으면 스크롤
    else if (playheadPx < scrollLeft + margin) {
      this.timelineTracks.scrollLeft = Math.max(0, playheadPx - margin);
    }
  }

  /**
   * 플레이헤드 위치로 스크롤 (재생 시작 시)
   */
  scrollToPlayhead() {
    if (!this.timelineTracks || this.duration === 0) return;

    const containerWidth = this.tracksContainer?.offsetWidth || 0;
    if (containerWidth === 0) return;

    const percent = this.currentTime / this.duration;
    const playheadPx = containerWidth * percent;

    const scrollLeft = this.timelineTracks.scrollLeft;
    const viewportWidth = this.timelineTracks.clientWidth;

    // 플레이헤드가 현재 뷰포트 내에 없으면 왼쪽에 오도록 스크롤
    if (playheadPx < scrollLeft || playheadPx > scrollLeft + viewportWidth) {
      const margin = 50;
      this.timelineTracks.scrollLeft = Math.max(0, playheadPx - margin);
    }
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
   * 구간 반복 마커 설정
   * @param {number|null} inPoint - 시작점 (초)
   * @param {number|null} outPoint - 종료점 (초)
   * @param {boolean} enabled - 활성화 여부
   */
  setLoopRegion(inPoint, outPoint, enabled) {
    // 기존 마커 제거
    this._clearLoopMarkers();

    if (this.duration === 0) return;

    const containerWidth = this.tracksContainer?.offsetWidth || 0;
    if (containerWidth === 0) return;

    // 구간 영역 오버레이 생성
    if (inPoint !== null && outPoint !== null) {
      const inPercent = inPoint / this.duration;
      const outPercent = outPoint / this.duration;
      const inPx = containerWidth * inPercent;
      const outPx = containerWidth * outPercent;

      // 구간 영역 오버레이
      const loopRegion = document.createElement('div');
      loopRegion.className = 'loop-region' + (enabled ? ' active' : '');
      loopRegion.style.left = `${inPx}px`;
      loopRegion.style.width = `${outPx - inPx}px`;
      this.tracksContainer.appendChild(loopRegion);
    }

    // In 마커
    if (inPoint !== null) {
      const inPercent = inPoint / this.duration;
      const inPx = containerWidth * inPercent;
      const inMarker = document.createElement('div');
      inMarker.className = 'loop-marker loop-in-marker';
      inMarker.style.left = `${inPx}px`;
      this.tracksContainer.appendChild(inMarker);
    }

    // Out 마커
    if (outPoint !== null) {
      const outPercent = outPoint / this.duration;
      const outPx = containerWidth * outPercent;
      const outMarker = document.createElement('div');
      outMarker.className = 'loop-marker loop-out-marker';
      outMarker.style.left = `${outPx}px`;
      this.tracksContainer.appendChild(outMarker);
    }
  }

  /**
   * 구간 마커 제거
   */
  _clearLoopMarkers() {
    const markers = this.tracksContainer?.querySelectorAll('.loop-marker, .loop-region');
    markers?.forEach(m => m.remove());
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

    // 줌 변경 이벤트 발생 (마커 클러스터링 재계산용)
    this._emit('zoomChanged', { zoom: this.zoom });
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
    indicator.textContent = `${Math.round(this.zoom)}%`;
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
   * 줌 레벨에 따라 5단 계단식 격자선 표시 (히스테리시스 적용)
   */
  _updateFrameGrid() {
    if (!this.tracksContainer || this.duration === 0 || this.totalFrames === 0) return;

    // 격자 토글 OFF면 즉시 숨김 후 리턴
    if (!this.gridVisible) {
      if (this.frameGridContainer) {
        this.frameGridContainer.style.display = 'none';
      }
      this._lastFrameGridTier = null;
      return;
    }

    // 프레임 그리드 컨테이너 생성 또는 가져오기
    if (!this.frameGridContainer) {
      this.frameGridContainer = document.createElement('div');
      this.frameGridContainer.className = 'frame-grid-container';
      this.frameGridContainer.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none; z-index: 1;
      `;
      this.tracksContainer.appendChild(this.frameGridContainer);
    }

    const containerWidth = this.tracksContainer.offsetWidth;
    const frameWidth = containerWidth / this.totalFrames;

    const tierResult = resolveFrameGridTier(frameWidth, this._lastFrameGridTier ?? null);
    this._lastFrameGridTier = tierResult.tier;

    this._renderFrameGridTiered(frameWidth, tierResult);
  }

  /**
   * 격자 표시 토글 설정
   */
  setGridVisible(visible) {
    this.gridVisible = !!visible;
    this._updateFrameGrid();
  }

  /**
   * 단계별 프레임 격자 렌더링 — resolveFrameGridTier 결과를 CSS background로 합성
   *
   * Note: tier 플래그 의미
   *   showFiveSec: "오직 5초만" (tier === FIVE_SEC, 가장 줌아웃 상태)
   *   showOneSec/showHalf/showQuarter/showFrame: "해당 단계 이상"(누산)
   * 각 if 블록이 서로 겹치는 영역(예: 1초 선이 ½초 선 위치와 겹침)은 먼저 push된 레이어가
   * CSS 합성에서 상위에 그려져 하위 레이어를 가린다. 1초/5초(노란색, 2px)는 상위에,
   * ½/¼/frame(파랑·흰색, 1px)은 하위에 배치돼 우선순위가 유지됨.
   */
  _renderFrameGridTiered(pxPerFrame, t) {
    this.frameGridContainer.style.display = 'block';

    const fps = this.fps || 24;
    const secPx = pxPerFrame * fps;

    // 색상 정의
    const colorSec = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-shadow-strong').trim() || 'rgba(255, 208, 0, 0.75)';
    const colorHalf = 'rgba(120, 180, 255, 0.55)';
    const colorQuarter = 'rgba(120, 180, 255, 0.32)';
    const colorFrame = 'rgba(255, 255, 255, 0.22)';

    const layers = [];
    const sizes = [];

    if (t.showFiveSec) {
      // 5초 간격 2px 폭 강조선
      const fiveSecPx = secPx * 5;
      layers.push(`repeating-linear-gradient(to right, ${colorSec} 0px, ${colorSec} 2px, transparent 2px, transparent ${fiveSecPx}px)`);
      sizes.push(`${fiveSecPx}px 100%`);
    }
    if (t.showOneSec) {
      layers.push(`repeating-linear-gradient(to right, ${colorSec} 0px, ${colorSec} 2px, transparent 2px, transparent ${secPx}px)`);
      sizes.push(`${secPx}px 100%`);
    }
    if (t.showHalf) {
      const halfSecPx = secPx / 2;
      layers.push(`repeating-linear-gradient(to right, ${colorHalf} 0px, ${colorHalf} 1px, transparent 1px, transparent ${halfSecPx}px)`);
      sizes.push(`${halfSecPx}px 100%`);
    }
    if (t.showQuarter) {
      // ¼초는 fps 인식: round(fps/4) 프레임마다
      const quarterFrames = Math.max(1, Math.round(fps / 4));
      const quarterPx = pxPerFrame * quarterFrames;
      layers.push(`repeating-linear-gradient(to right, ${colorQuarter} 0px, ${colorQuarter} 1px, transparent 1px, transparent ${quarterPx}px)`);
      sizes.push(`${quarterPx}px 100%`);
    }
    if (t.showFrame) {
      layers.push(`repeating-linear-gradient(to right, ${colorFrame} 0px, ${colorFrame} 1px, transparent 1px, transparent ${pxPerFrame}px)`);
      sizes.push(`${pxPerFrame}px 100%`);
    }

    this.frameGridContainer.style.backgroundImage = layers.join(', ');
    this.frameGridContainer.style.backgroundSize = sizes.join(', ');
    this.frameGridContainer.style.backgroundRepeat = 'repeat-x';
    this.frameGridContainer.style.backgroundPosition = '0 0';
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

    const opacityPercent = Math.round((layer.opacity ?? 1) * 100);
    header.innerHTML = `
      <div class="layer-color" style="background: ${layer.color}"></div>
      <span class="layer-visibility" data-action="visibility">
        ${layer.visible ? '👁' : '👁‍🗨'}
      </span>
      <span class="layer-name" title="${layer.name}">${layer.name}</span>
      <span class="layer-opacity-badge" title="불투명도 ${opacityPercent}%">${opacityPercent}%</span>
      <span class="layer-lock" data-action="lock">
        ${layer.locked ? '🔒' : ''}
      </span>
    `;

    // 레이어 선택 클릭
    header.addEventListener('click', (e) => {
      if (e.target.dataset.action || e.target.closest('[data-action]')) return;
      this._emit('layerSelect', { layerId: layer.id });
    });

    // 우클릭 → 레이어 설정 팝업
    header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._emit('layerContextMenu', {
        layerId: layer.id,
        x: e.clientX,
        y: e.clientY
      });
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
   * 레이어 트랙 렌더링 (오른쪽 타임라인) - Adobe Animate 격자 스타일
   * 성능 최적화: CSS 배경 패턴 + 키프레임만 DOM 요소로 렌더링
   */
  _renderLayerTrack(layer, isActive) {
    const trackRow = document.createElement('div');
    trackRow.className = `track-row drawing-track-row${isActive ? ' active-layer' : ''}`;
    trackRow.dataset.layerId = layer.id;

    // 키프레임 컨테이너 (키프레임만 DOM 요소로)
    const keyframeContainer = document.createElement('div');
    keyframeContainer.className = 'keyframe-container';
    keyframeContainer.dataset.layerId = layer.id;

    // 키프레임 범위 정보 가져오기
    const ranges = layer.getKeyframeRanges(this.totalFrames);

    // 컨테이너 너비와 프레임당 픽셀 계산
    const containerWidth = this.tracksContainer?.offsetWidth || 1000;
    const pixelsPerFrame = containerWidth / this.totalFrames;

    // 격자 배경 패턴 제거 (#72: 그리기 레이어에 별도 격자 패턴 불필요)
    // this._applyGridBackground(trackRow, pixelsPerFrame);

    // 콘텐츠 범위 표시 (키프레임 간 구간) - 빈 키프레임이 아닌 경우만 채움
    ranges.forEach(range => {
      // 빈 키프레임이 아닌 경우에만 범위 바 표시
      if (!range.keyframe.isEmpty) {
        const rangeBar = document.createElement('div');
        rangeBar.className = 'keyframe-range-bar';

        const startPercent = (range.start / this.totalFrames) * 100;
        const widthPercent = ((range.end - range.start + 1) / this.totalFrames) * 100;

        rangeBar.style.left = `${startPercent}%`;
        rangeBar.style.width = `${widthPercent}%`;
        rangeBar.style.background = '#5a5a5a'; // 회색 고정 (#72: 레이어 색상을 회색으로 변경)

        keyframeContainer.appendChild(rangeBar);
      }

      // 키프레임 마커 - 격자 칸 중앙에 배치
      const marker = document.createElement('div');
      marker.className = `keyframe-marker-dot${range.keyframe.isEmpty ? ' empty' : ''}`;
      marker.dataset.frame = range.start;
      marker.dataset.layerId = layer.id;

      // 프레임 중앙에 배치 (프레임 시작 + 0.5프레임)
      const markerLeft = ((range.start + 0.5) / this.totalFrames) * 100;
      marker.style.left = `${markerLeft}%`;
      marker.style.background = range.keyframe.isEmpty ? 'transparent' : layer.color;
      marker.title = `F${range.start}${range.keyframe.isEmpty ? ' (빈 키프레임)' : ''}`;

      // 선택 상태
      const isSelected = this.selectedKeyframes.some(
        kf => kf.layerId === layer.id && kf.frame === range.start
      );
      if (isSelected) {
        marker.classList.add('selected');
      }

      // 키프레임 드래그
      marker.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        this._startKeyframeDrag(e, layer.id, range.start, marker);
      });

      // 클릭으로 선택
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleKeyframeSelection(layer.id, range.start, e.ctrlKey || e.metaKey);
      });

      keyframeContainer.appendChild(marker);
    });

    trackRow.appendChild(keyframeContainer);
    this.tracksContainer.appendChild(trackRow);
  }

  /**
   * 트랙에 격자 배경 패턴 적용
   */
  _applyGridBackground(trackRow, pixelsPerFrame) {
    // 프레임 너비에 따른 격자 표시 결정
    const frameWidth = pixelsPerFrame;

    if (frameWidth >= 4) {
      // 개별 프레임 격자 + 5/10프레임 강조
      // 각 프레임의 오른쪽 경계에 선을 그림 (프레임 너비 - 1px 위치)
      const frame5Width = frameWidth * 5;
      const frame10Width = frameWidth * 10;

      // 단일 패턴으로 통합하여 중첩 방지
      trackRow.style.backgroundImage = `
        repeating-linear-gradient(
          to right,
          transparent 0px,
          transparent ${frameWidth - 1}px,
          rgba(255, 255, 255, 0.06) ${frameWidth - 1}px,
          rgba(255, 255, 255, 0.06) ${frameWidth}px
        )
      `;
      trackRow.style.backgroundSize = `${frameWidth}px 100%`;

      // 5프레임, 10프레임 강조선은 별도 요소로 추가 (옵션)
      // 또는 기존 패턴 유지하되 위치 오프셋 적용
      trackRow.style.backgroundPosition = '0 0';
    } else if (frameWidth >= 1) {
      // 5프레임 단위만 표시
      const frame5Width = frameWidth * 5;

      trackRow.style.backgroundImage = `
        repeating-linear-gradient(
          to right,
          transparent 0px,
          transparent ${frame5Width - 1}px,
          rgba(255, 255, 255, 0.12) ${frame5Width - 1}px,
          rgba(255, 255, 255, 0.12) ${frame5Width}px
        )
      `;
      trackRow.style.backgroundSize = `${frame5Width}px 100%`;
    } else {
      // 매우 축소된 상태 - 1초 단위만
      const secondWidth = Math.max(frameWidth * this.fps, 1);
      trackRow.style.backgroundImage = `
        repeating-linear-gradient(
          to right,
          transparent 0px,
          transparent ${secondWidth - 1}px,
          ${getComputedStyle(document.documentElement).getPropertyValue('--accent-shadow').trim() || 'rgba(255, 208, 0, 0.3)'} ${secondWidth - 1}px,
          ${getComputedStyle(document.documentElement).getPropertyValue('--accent-shadow').trim() || 'rgba(255, 208, 0, 0.3)'} ${secondWidth}px
        )
      `;
      trackRow.style.backgroundSize = `${secondWidth}px 100%`;
    }

    trackRow.style.backgroundRepeat = 'repeat-x';
    trackRow.style.backgroundPosition = '0 0';
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
    // getBoundingClientRect()는 이미 스크롤 위치를 반영하므로 scrollLeft 추가 불필요
    const x = e.clientX - containerRect.left;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const newFrame = Math.round(percent * (this.totalFrames - 1));

    // 고스트 클립 위치 업데이트
    const ghostPercent = (newFrame / this.totalFrames) * 100;
    this.dragGhost.style.left = `${ghostPercent}%`;

    // 툴팁 위치 및 내용 업데이트
    if (this.dragTooltip) {
      this.dragTooltip.style.left = `${ghostPercent}%`;
      this.dragTooltip.textContent = `F${newFrame}`;
    }

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

    // 원본 클립 투명도 복원
    if (this.draggedKeyframe.element) {
      this.draggedKeyframe.element.style.opacity = '';
    }

    // 고스트 및 툴팁 제거
    if (this.dragGhost) {
      this.dragGhost.remove();
      this.dragGhost = null;
    }
    if (this.dragTooltip) {
      this.dragTooltip.remove();
      this.dragTooltip = null;
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
    const { element: clipElement, layerId } = this.draggedKeyframe;

    // 클립 요소 복제하여 고스트로 사용
    this.dragGhost = clipElement.cloneNode(true);
    this.dragGhost.className = 'drawing-clip keyframe-drag-ghost-clip';

    // 원본 클립의 스타일 복사하고 투명도 적용
    const clipRect = clipElement.getBoundingClientRect();
    const trackRect = clipElement.parentElement.getBoundingClientRect();

    this.dragGhost.style.cssText = clipElement.style.cssText;
    this.dragGhost.style.opacity = '0.5';
    this.dragGhost.style.pointerEvents = 'none';
    this.dragGhost.style.zIndex = '100';

    // 원본 클립을 반투명하게 처리
    clipElement.style.opacity = '0.3';

    // 프레임 표시 툴팁 추가
    this.dragTooltip = document.createElement('div');
    this.dragTooltip.className = 'keyframe-drag-ghost';
    this.dragTooltip.textContent = `F${frame}`;
    const percent = (frame / this.totalFrames) * 100;
    this.dragTooltip.style.left = `${percent}%`;

    clipElement.parentElement.appendChild(this.dragGhost);
    this.tracksContainer.appendChild(this.dragTooltip);
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
  addCommentMarker(time, resolved = false, frame = 0, markerInfos = []) {
    const percent = (time / this.duration) * 100;
    const marker = document.createElement('div');
    marker.className = `comment-marker-track${resolved ? ' resolved' : ''}`;
    marker.style.left = `${percent}%`;
    marker.dataset.time = time;
    marker.dataset.frame = frame;

    // 호버 툴팁 생성
    const tooltip = document.createElement('div');
    tooltip.className = 'comment-marker-tooltip';

    // 댓글 내용 표시 (여러 개일 수 있음)
    if (markerInfos.length > 0) {
      const content = markerInfos.map(info => {
        const text = info.text || '';
        const hasImage = !!info.image;
        // "(이미지)"만 있으면 아이콘으로 대체
        const displayText = text === '(이미지)' ? '' : text;
        const preview = displayText.length > 50 ? displayText.substring(0, 50) + '...' : displayText;
        const imageIcon = hasImage ? '<span class="tooltip-image-icon">🖼</span>' : '';
        const textHtml = preview ? this._escapeHtml(preview) : '';
        return `<div class="tooltip-comment">${imageIcon}${textHtml || (hasImage ? '이미지' : '')}</div>`;
      }).join('');
      tooltip.innerHTML = `
        <div class="tooltip-frame">프레임 ${frame}</div>
        <div class="tooltip-comments">${content}</div>
        ${markerInfos.length > 1 ? `<div class="tooltip-count">${markerInfos.length}개 댓글</div>` : ''}
      `;
    } else {
      tooltip.innerHTML = `<div class="tooltip-frame">프레임 ${frame}</div>`;
    }

    // 툴팁을 body에 추가 (overflow: hidden에 의한 클리핑 방지)
    document.body.appendChild(tooltip);

    // 호버 이벤트 - 툴팁 위치 동적 계산
    marker.addEventListener('mouseenter', () => {
      const markerRect = marker.getBoundingClientRect();
      // 마커 오른쪽에 툴팁 표시
      tooltip.style.left = `${markerRect.right + 10}px`;
      tooltip.style.top = `${markerRect.top + markerRect.height / 2}px`;
      tooltip.classList.add('visible');
    });
    marker.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });

    // 마커 제거 시 툴팁도 함께 제거
    const originalRemove = marker.remove.bind(marker);
    marker.remove = () => {
      tooltip.remove();
      originalRemove();
    };

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit('commentMarkerClick', { time, frame, markerInfos });
    });

    this.tracksContainer?.appendChild(marker);
    return marker;
  }

  /**
   * HTML 이스케이프
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 타임코드 포맷 (HH:MM:SS:FF)
   * @param {number} time - 시간 (초)
   * @returns {string} 타임코드 문자열
   */
  _formatTimecode(time) {
    const fps = this.fps || 24;
    // Math.round로 부동소수점 오차 방지
    const totalFrames = Math.round(time * fps);
    const frames = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const hours = Math.floor(totalSeconds / 3600);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  }

  /**
   * 클러스터링된 댓글 마커 렌더링
   * 픽셀 거리 기반으로 가까운 마커들을 그룹화
   * @param {Array} allMarkerData - 모든 마커 데이터 배열 [{time, frame, resolved, infos}, ...]
   */
  renderClusteredCommentMarkers(allMarkerData) {
    // 기존 마커 제거
    this.clearCommentMarkers();

    if (!allMarkerData || allMarkerData.length === 0) return;
    if (!this.tracksContainer || this.duration === 0) return;

    // 픽셀 거리 계산을 위한 컨테이너 너비
    const containerWidth = this.tracksContainer.offsetWidth || 1000;
    const minClusterDistance = 20; // 20px 미만이면 클러스터링

    // 시간순 정렬
    const sortedMarkers = [...allMarkerData].sort((a, b) => a.time - b.time);

    // 클러스터 그룹화
    const clusters = [];
    let currentCluster = null;

    sortedMarkers.forEach(markerData => {
      const pixelX = (markerData.time / this.duration) * containerWidth;

      if (!currentCluster) {
        // 첫 클러스터 시작
        currentCluster = {
          markers: [markerData],
          startPixelX: pixelX,
          endPixelX: pixelX
        };
      } else {
        // 이전 클러스터와의 거리 확인
        const distance = pixelX - currentCluster.endPixelX;

        if (distance < minClusterDistance) {
          // 클러스터에 추가
          currentCluster.markers.push(markerData);
          currentCluster.endPixelX = pixelX;
        } else {
          // 새 클러스터 시작
          clusters.push(currentCluster);
          currentCluster = {
            markers: [markerData],
            startPixelX: pixelX,
            endPixelX: pixelX
          };
        }
      }
    });

    // 마지막 클러스터 추가
    if (currentCluster) {
      clusters.push(currentCluster);
    }

    // 클러스터별로 마커 렌더링
    clusters.forEach(cluster => {
      const count = cluster.markers.length;
      // 클러스터의 대표 위치 (중앙)
      const centerTime = cluster.markers.reduce((sum, m) => sum + m.time, 0) / count;
      // 모든 마커 정보 병합
      const allInfos = cluster.markers.flatMap(m => m.infos || []);
      // 모든 마커가 resolved인 경우에만 resolved
      const allResolved = cluster.markers.every(m => m.resolved);
      // 대표 프레임 (첫 번째 마커의 프레임)
      const representativeFrame = cluster.markers[0].frame;
      // 대표 색상 (첫 번째 마커의 colorKey 사용)
      const representativeColorKey = allInfos[0]?.colorKey || 'default';

      this._addClusteredMarker(centerTime, allResolved, representativeFrame, allInfos, count, representativeColorKey);
    });
  }

  /**
   * 클러스터된 마커 추가 (내부용)
   */
  _addClusteredMarker(time, resolved, frame, markerInfos, clusterCount, colorKey = 'default') {
    const percent = (time / this.duration) * 100;
    const marker = document.createElement('div');
    marker.className = `comment-marker-track${resolved ? ' resolved' : ''}`;
    marker.style.left = `${percent}%`;
    marker.dataset.time = time;

    // 마커 색상 적용 (resolved가 아닌 경우에만)
    if (!resolved) {
      const markerColor = MARKER_COLORS[colorKey]?.color || MARKER_COLORS.default.color;
      marker.style.backgroundColor = markerColor;
    }
    marker.dataset.frame = frame;

    // 클러스터 카운트가 2 이상이면 배지 표시
    if (clusterCount > 1) {
      marker.dataset.count = clusterCount;
      marker.classList.add('clustered');
    }

    // 호버 툴팁 생성
    const tooltip = document.createElement('div');
    tooltip.className = 'comment-marker-tooltip';

    // 타임코드 + 프레임 표시
    const timecode = this._formatTimecode(time);

    // 댓글 내용 표시
    if (markerInfos.length > 0) {
      const content = markerInfos.slice(0, 5).map(info => {
        const text = info.text || '';
        const hasImage = !!info.image;
        const displayText = text === '(이미지)' ? '' : text;
        const preview = displayText.length > 50 ? displayText.substring(0, 50) + '...' : displayText;
        const imageIcon = hasImage ? '<span class="tooltip-image-icon">🖼</span>' : '';
        const textHtml = preview ? this._escapeHtml(preview) : '';
        return `<div class="tooltip-comment">${imageIcon}${textHtml || (hasImage ? '이미지' : '')}</div>`;
      }).join('');

      const moreText = markerInfos.length > 5 ? `<div class="tooltip-more">...외 ${markerInfos.length - 5}개</div>` : '';

      tooltip.innerHTML = `
        <div class="tooltip-header">
          <span class="tooltip-timecode">${timecode}</span>
          <span class="tooltip-frame">${frame}f</span>
        </div>
        <div class="tooltip-comments">${content}${moreText}</div>
        ${markerInfos.length > 1 ? `<div class="tooltip-count">${markerInfos.length}개 댓글</div>` : ''}
      `;
    } else {
      tooltip.innerHTML = `
        <div class="tooltip-header">
          <span class="tooltip-timecode">${timecode}</span>
          <span class="tooltip-frame">${frame}f</span>
        </div>
      `;
    }

    // 툴팁을 body에 추가
    document.body.appendChild(tooltip);

    // 호버 이벤트
    marker.addEventListener('mouseenter', () => {
      const markerRect = marker.getBoundingClientRect();
      tooltip.style.left = `${markerRect.right + 10}px`;
      tooltip.style.top = `${markerRect.top + markerRect.height / 2}px`;
      tooltip.classList.add('visible');
    });
    marker.addEventListener('mouseleave', () => {
      tooltip.classList.remove('visible');
    });

    // 마커 제거 시 툴팁도 함께 제거
    const originalRemove = marker.remove.bind(marker);
    marker.remove = () => {
      tooltip.remove();
      originalRemove();
    };

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      this._emit('commentMarkerClick', { time, frame, markerInfos });
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
  // 하이라이트 관련
  // ==========================================

  /**
   * 하이라이트 트랙 요소 참조 설정
   * @param {HTMLElement} trackElement - 하이라이트 트랙 요소
   * @param {HTMLElement} layerHeaderElement - 좌측 하이라이트 레이어 헤더 요소 (선택)
   */
  setHighlightTrack(trackElement, layerHeaderElement = null) {
    this.highlightTrack = trackElement;
    this.highlightLayerHeader = layerHeaderElement;
  }

  /**
   * 하이라이트 렌더링
   * @param {Array} highlights - 하이라이트 배열
   */
  renderHighlights(highlights) {
    if (!this.highlightTrack) return;

    // 기존 하이라이트 제거
    this.highlightTrack.innerHTML = '';

    // 하이라이트가 없으면 트랙 및 레이어 헤더 숨김
    if (!highlights || highlights.length === 0) {
      this.highlightTrack.style.display = 'none';
      if (this.highlightLayerHeader) {
        this.highlightLayerHeader.style.display = 'none';
      }
      // 하이라이트 없으면 마커 오프셋 제거
      this.tracksContainer?.style.setProperty('--marker-top-offset', '0px');
      return;
    }

    // 트랙 및 레이어 헤더 표시
    this.highlightTrack.style.display = 'block';
    if (this.highlightLayerHeader) {
      this.highlightLayerHeader.style.display = 'flex';
    }

    // 하이라이트 트랙 높이만큼 마커 오프셋 설정 (24px + 2px margin)
    this.tracksContainer?.style.setProperty('--marker-top-offset', '26px');

    // 각 하이라이트 렌더링
    highlights.forEach(highlight => {
      const element = this._createHighlightElement(highlight);
      this.highlightTrack.appendChild(element);
    });
  }

  /**
   * 하이라이트 요소 생성
   * @param {object} highlight - 하이라이트 데이터
   * @returns {HTMLElement}
   */
  _createHighlightElement(highlight) {
    const element = document.createElement('div');
    element.className = 'highlight-item';
    element.dataset.highlightId = highlight.id;

    // 위치 및 크기 계산 (duration이 0이면 기본값 사용)
    const duration = this.duration || 1;
    const leftPercent = (highlight.startTime / duration) * 100;
    const widthPercent = ((highlight.endTime - highlight.startTime) / duration) * 100;

    // 색상 정보 (colorInfo가 없으면 기본 노랑색 사용)
    const colorInfo = highlight.colorInfo || { color: '#ffdd59', bgColor: 'rgba(255, 221, 89, 0.3)' };

    element.style.left = `${leftPercent}%`;
    element.style.width = `${widthPercent}%`;
    element.style.background = colorInfo.bgColor;
    element.style.borderLeft = `3px solid ${colorInfo.color}`;
    element.style.borderRight = `3px solid ${colorInfo.color}`;

    // 드래그 핸들 추가
    const leftHandle = document.createElement('div');
    leftHandle.className = 'highlight-handle highlight-handle-left';
    leftHandle.dataset.handle = 'left';

    const rightHandle = document.createElement('div');
    rightHandle.className = 'highlight-handle highlight-handle-right';
    rightHandle.dataset.handle = 'right';

    element.appendChild(leftHandle);
    element.appendChild(rightHandle);

    // 주석 표시
    if (highlight.note) {
      const noteIndicator = document.createElement('div');
      noteIndicator.className = 'highlight-note-indicator';
      noteIndicator.textContent = highlight.note;
      // 글자색은 항상 흰색
      noteIndicator.style.color = '#ffffff';
      noteIndicator.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.5)';
      element.appendChild(noteIndicator);
    }

    return element;
  }

  /**
   * 단일 하이라이트 업데이트
   * @param {object} highlight - 하이라이트 데이터
   */
  updateHighlightElement(highlight) {
    if (!this.highlightTrack) return;

    const element = this.highlightTrack.querySelector(`[data-highlight-id="${highlight.id}"]`);
    if (!element) return;

    // 위치 및 크기 업데이트 (duration이 0이면 기본값 사용)
    const duration = this.duration || 1;
    const leftPercent = (highlight.startTime / duration) * 100;
    const widthPercent = ((highlight.endTime - highlight.startTime) / duration) * 100;

    // 색상 정보 (colorInfo가 없으면 기본 노랑색 사용)
    const colorInfo = highlight.colorInfo || { color: '#ffdd59', bgColor: 'rgba(255, 221, 89, 0.3)' };

    element.style.left = `${leftPercent}%`;
    element.style.width = `${widthPercent}%`;
    element.style.background = colorInfo.bgColor;
    element.style.borderLeft = `3px solid ${colorInfo.color}`;
    element.style.borderRight = `3px solid ${colorInfo.color}`;

    // 주석 업데이트
    let noteIndicator = element.querySelector('.highlight-note-indicator');
    if (highlight.note) {
      if (!noteIndicator) {
        noteIndicator = document.createElement('div');
        noteIndicator.className = 'highlight-note-indicator';
        element.appendChild(noteIndicator);
      }
      noteIndicator.textContent = highlight.note;
      // 글자색은 항상 흰색
      noteIndicator.style.color = '#ffffff';
      noteIndicator.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.5)';
    } else if (noteIndicator) {
      noteIndicator.remove();
    }
  }

  // ==========================================
  // 댓글 범위 트랙 관련
  // ==========================================

  /**
   * 댓글 트랙 요소 참조 설정
   * @param {HTMLElement} trackElement - 댓글 트랙 요소
   * @param {HTMLElement} layerHeaderElement - 좌측 댓글 레이어 헤더 요소 (선택)
   */
  setCommentTrack(trackElement, layerHeaderElement = null) {
    this.commentTrack = trackElement;
    this.commentLayerHeader = layerHeaderElement;

    // 타임라인 배경 클릭 시 펼친 클러스터 접기
    if (this.commentTrack) {
      this.commentTrack.addEventListener('click', (e) => {
        if (e.target === this.commentTrack && this.expandedClusterId !== null) {
          this.expandedClusterId = null;
          this.renderCommentRanges(this._lastComments || []);
        }
      });
    }
  }

  /**
   * 댓글 범위 렌더링
   * @param {Array} comments - 댓글 범위 배열 (getMarkerRanges() 결과)
   */
  renderCommentRanges(comments) {
    if (!this.commentTrack) return;

    // 데이터 캐시 (펼침/접힘 재렌더용)
    this._lastComments = comments;

    // 기존 댓글 제거
    this.commentTrack.innerHTML = '';

    // 댓글이 없으면 트랙 및 레이어 헤더 숨김 (기존 로직 유지)
    if (!comments || comments.length === 0) {
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      // 펼침 상태는 데이터가 없어진 상황이므로 리셋
      this.expandedClusterId = null;
      return;
    }

    // 트랙 및 레이어 헤더 표시 (기존 로직 유지)
    this.commentTrack.style.display = 'block';
    if (this.commentLayerHeader) {
      this.commentLayerHeader.style.display = 'flex';
    }

    // 1) 클러스터링
    const clusters = findRangeClusters(comments);

    // 2) 펼침 상태 유효성 검증 — 해당 clusterKey가 더 이상 존재하지 않으면 리셋
    if (this.expandedClusterId !== null) {
      const stillExists = clusters.some(c =>
        clusterKey(c) === this.expandedClusterId && c.length > 1
      );
      if (!stillExists) {
        this.expandedClusterId = null;
      }
    }

    // 3) 최대 레인 수 계산 — 펼친 클러스터가 있으면 그 클러스터의 레인 수
    //    assignLanes 호출 결과(_lane)를 여기서 메모이제이션하여 step 5에서 재호출하지 않음
    let maxLanes = 1;
    const expandedClusters = new Set();
    clusters.forEach(cluster => {
      if (clusterKey(cluster) === this.expandedClusterId && cluster.length > 1) {
        const { maxLane } = assignLanes(cluster); // _lane이 여기서 1회 설정됨
        maxLanes = Math.max(maxLanes, maxLane);
        expandedClusters.add(cluster);
      }
    });

    // 4) 트랙 높이 동적 설정 (애니메이션)
    const baseHeight = 24;
    const laneHeight = 24;
    const lanePadding = 6;
    const targetHeight = maxLanes > 1
      ? laneHeight * maxLanes + lanePadding
      : baseHeight;
    this.commentTrack.style.height = `${targetHeight}px`;

    // 5) 각 클러스터 렌더
    clusters.forEach(cluster => {
      if (cluster.length === 1) {
        // 단일 댓글 — 기존처럼
        const el = this._createCommentRangeElement(cluster[0]);
        el.style.top = '2px';
        this.commentTrack.appendChild(el);
      } else if (expandedClusters.has(cluster)) {
        // 펼친 클러스터 — step 3에서 assignLanes가 이미 실행되어 _lane이 설정된 상태
        cluster.forEach(c => {
          const el = this._createCommentRangeElement(c);
          el.style.top = `${2 + c._lane * laneHeight}px`;
          this.commentTrack.appendChild(el);
        });
        const chip = this._createCollapseChip(cluster, maxLanes);
        this.commentTrack.appendChild(chip);
      } else {
        // 접힌 클러스터 — 배지
        const badge = this._createClusterBadgeElement(cluster);
        this.commentTrack.appendChild(badge);
      }
    });
  }

  /**
   * 댓글 범위 요소 생성
   * @param {object} comment - 댓글 범위 데이터 {layerId, markerId, startFrame, endFrame, color, text, resolved}
   * @returns {HTMLElement}
   */
  _createCommentRangeElement(comment) {
    const element = document.createElement('div');
    element.className = 'comment-range-item';
    element.dataset.layerId = comment.layerId;
    element.dataset.markerId = comment.markerId;

    // resolved 상태 추가
    if (comment.resolved) {
      element.classList.add('resolved');
    }

    // 위치 및 크기 계산 (프레임 기반)
    const totalFrames = this.totalFrames || 1;
    const leftPercent = (comment.startFrame / totalFrames) * 100;
    const widthPercent = ((comment.endFrame - comment.startFrame) / totalFrames) * 100;

    // 최소 너비 보장 (클릭 가능하도록)
    const minWidthPercent = Math.max(widthPercent, 0.5);

    // 색상 정보 (레이어 색상 사용)
    const color = comment.color || '#4a9eff';
    const bgColor = this._hexToRgba(color, 0.25);

    element.style.left = `${leftPercent}%`;
    element.style.width = `${minWidthPercent}%`;
    element.style.background = bgColor;
    element.style.borderLeftColor = color;
    element.style.borderRightColor = color;

    // 드래그 핸들 추가
    const leftHandle = document.createElement('div');
    leftHandle.className = 'comment-handle comment-handle-left';
    leftHandle.dataset.handle = 'left';

    const rightHandle = document.createElement('div');
    rightHandle.className = 'comment-handle comment-handle-right';
    rightHandle.dataset.handle = 'right';

    element.appendChild(leftHandle);
    element.appendChild(rightHandle);

    // 텍스트 표시 (줄임 처리)
    if (comment.text) {
      const textIndicator = document.createElement('div');
      textIndicator.className = 'comment-range-text';
      // 짧은 텍스트로 표시 (첫 줄만)
      const shortText = comment.text.split('\n')[0].slice(0, 30);
      textIndicator.textContent = shortText + (comment.text.length > 30 ? '...' : '');
      element.appendChild(textIndicator);
    }

    return element;
  }

  /**
   * 접힌 클러스터의 배지 바 DOM 생성
   */
  _createClusterBadgeElement(cluster) {
    const totalFrames = this.totalFrames || 1;
    const minStart = Math.min(...cluster.map(c => c.startFrame));
    const maxEnd = Math.max(...cluster.map(c => c.endFrame));
    const leftPercent = (minStart / totalFrames) * 100;
    const widthPercent = ((maxEnd - minStart) / totalFrames) * 100;

    const el = document.createElement('div');
    el.className = 'comment-cluster-badge';
    el.dataset.clusterKey = clusterKey(cluster);
    el.style.left = `${leftPercent}%`;
    el.style.width = `${Math.max(widthPercent, 3)}%`;
    el.style.top = '2px';

    // 스택 힌트 (최대 3색)
    const hint = document.createElement('div');
    hint.className = 'comment-cluster-stack-hint';
    cluster.slice(0, 3).forEach(c => {
      const stripe = document.createElement('div');
      stripe.style.background = c.color || '#4a9eff';
      hint.appendChild(stripe);
    });
    el.appendChild(hint);

    // 카운트 칩
    const chip = document.createElement('span');
    chip.className = 'comment-cluster-count';
    chip.textContent = `⊕${cluster.length}`;
    el.appendChild(chip);

    // 라벨
    const label = document.createElement('span');
    label.className = 'comment-cluster-label';
    label.textContent = '겹친 코멘트';
    el.appendChild(label);

    // 클릭 → 펼치기
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expandedClusterId = clusterKey(cluster);
      this.renderCommentRanges(this._lastComments || []);
    });

    return el;
  }

  /**
   * 펼친 클러스터를 접는 칩 DOM
   */
  _createCollapseChip(cluster, maxLanes) {
    const totalFrames = this.totalFrames || 1;
    const minStart = Math.min(...cluster.map(c => c.startFrame));
    const leftPercent = (minStart / totalFrames) * 100;

    const chip = document.createElement('button');
    chip.className = 'comment-collapse-chip';
    chip.type = 'button';
    chip.textContent = '▲ 접기';
    chip.style.left = `${leftPercent}%`;
    chip.style.top = `${24 * maxLanes + 2}px`;

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expandedClusterId = null;
      this.renderCommentRanges(this._lastComments || []);
    });

    return chip;
  }

  /**
   * 단일 댓글 범위 업데이트
   *
   * 주의: 클러스터로 접힌 상태의 댓글은 개별 .comment-range-item DOM이 없고
   * 주황 배지로만 렌더됩니다. 따라서 접힌 상태에서 리사이즈 결과를 여기서
   * 반영하려 하면 element가 null이라 조용히 무시됩니다. 접힌 클러스터의
   * 리사이즈는 먼저 펼친 뒤 진행되는 것이 MVP 전제입니다.
   *
   * @param {object} comment - 댓글 범위 데이터
   */
  updateCommentRangeElement(comment) {
    if (!this.commentTrack) return;

    const element = this.commentTrack.querySelector(
      `[data-layer-id="${comment.layerId}"][data-marker-id="${comment.markerId}"]`
    );
    if (!element) return;

    // resolved 상태 업데이트
    element.classList.toggle('resolved', comment.resolved);

    // 위치 및 크기 업데이트
    const totalFrames = this.totalFrames || 1;
    const leftPercent = (comment.startFrame / totalFrames) * 100;
    const widthPercent = ((comment.endFrame - comment.startFrame) / totalFrames) * 100;
    const minWidthPercent = Math.max(widthPercent, 0.5);

    // 색상 정보
    const color = comment.color || '#4a9eff';
    const bgColor = this._hexToRgba(color, 0.25);

    element.style.left = `${leftPercent}%`;
    element.style.width = `${minWidthPercent}%`;
    element.style.background = bgColor;
    element.style.borderLeftColor = color;
    element.style.borderRightColor = color;

    // 텍스트 업데이트
    let textIndicator = element.querySelector('.comment-range-text');
    if (comment.text) {
      if (!textIndicator) {
        textIndicator = document.createElement('div');
        textIndicator.className = 'comment-range-text';
        element.appendChild(textIndicator);
      }
      const shortText = comment.text.split('\n')[0].slice(0, 30);
      textIndicator.textContent = shortText + (comment.text.length > 30 ? '...' : '');
    } else if (textIndicator) {
      textIndicator.remove();
    }
  }

  /**
   * HEX 색상을 RGBA로 변환
   * @param {string} hex - HEX 색상
   * @param {number} alpha - 투명도
   * @returns {string} - RGBA 색상
   */
  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * 픽셀 위치를 시간으로 변환
   * @param {number} pixelX - 픽셀 X 좌표
   * @returns {number} - 시간 (초)
   */
  pixelToTime(pixelX) {
    if (!this.tracksContainer) return 0;
    const trackWidth = this.tracksContainer.scrollWidth;
    const ratio = pixelX / trackWidth;
    return ratio * this.duration;
  }

  /**
   * 시간을 픽셀 위치로 변환
   * @param {number} time - 시간 (초)
   * @returns {number} - 픽셀 X 좌표
   */
  timeToPixel(time) {
    if (!this.tracksContainer) return 0;
    const trackWidth = this.tracksContainer.scrollWidth;
    return (time / this.duration) * trackWidth;
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
