/**
 * baeframe - Timeline Module
 * 타임라인 UI 및 인터랙션 관리
 */

import { createLogger } from '../logger.js';
import { MARKER_COLORS } from './comment-manager.js';
import { computeMinZoomForCellMode, resolveFrameCellActive, resolveFrameGridTier } from './frame-grid-tiers.js';
import { findRangeClusters, assignLanes, assignRenderLanes, clusterKey, splitClustersByPixelGap } from './comment-cluster.js';
import { getTimelineFocalContentX, calculateAnchoredScrollLeft } from './timeline-zoom-core.js';
import {
  formatPlaylistCommentLabel,
  formatPlaylistCommentTitle,
  getPlaylistAggregateCommentKey
} from './playlist-comment-index.js';

const log = createLogger('Timeline');

function _getCompositionLayerTypeIcon(type) {
  if (type === 'video') {
    return `
      <svg class="composition-layer-media-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="6" width="14" height="12" rx="2"></rect>
        <path d="M17 10.5l4-2.5v8l-4-2.5z"></path>
      </svg>
    `;
  }
  return `
    <svg class="composition-layer-media-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"></rect>
      <circle cx="8" cy="10" r="1.6"></circle>
      <path d="M4.5 17l4.2-4.2 3.2 3.2 2.4-2.4 5.2 5.2"></path>
    </svg>
  `;
}

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
    this.frameCellMode = 'auto';
    this._frameCellActive = false;
    this.minFrameCellPx = 8;
    this._lastDrawingLayers = null;
    this._lastDrawingActiveLayerId = null;

    // 클러스터 펼침/접힘 상태
    this.expandedClusterId = null;  // 현재 펼친 클러스터의 키 (markerId)
    this._lastComments = null;      // 펼치기/접기 재렌더용 캐시
    this.commentRangesVisible = true;
    this._lastPlaylistCommentRanges = null;
    this._lastPlaylistCommentDuration = 0;
    this.playlistSegments = [];
    this.playlistDuration = 0;
    this.cutlistSegments = [];
    this.cutlistDuration = 0;
    this.cutlistTotalFrames = 0;
    this.currentCutId = null;

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
    this.dragGhostItems = [];
    this.dragSourceElements = [];
    this.dragGhostKeyframes = [];

    // 다중 선택 상태
    this.selectedKeyframes = [];  // [ { layerId, frame } ]
    this.lastSelectedKeyframe = null;
    this.isSelecting = false;  // 드래그 박스 선택 중
    this.selectionBox = null;
    this.selectionStartX = 0;
    this.selectionStartY = 0;

    // 썸네일 프리뷰 상태
    this.thumbnailGenerator = null;
    this.thumbnailTooltip = null;
    this.isThumbnailVisible = false;
    this.compositionLayerReorderState = null;

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

        const prevZoom = this.zoom;
        this._applyCellModeMinZoom();
        if (this.zoom !== prevZoom) {
          this._applyZoom();
        }

        this._syncFrameGridContainerMetrics();

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
        // 기본 휠: 커서 위치 기준 확대/축소
        // 비율 기반 줌: 현재 줌 레벨의 5%씩 변화 (고배율일수록 변화량 증가)
        const zoomStep = Math.max(15, this.zoom * 0.05);
        const delta = e.deltaY > 0 ? -zoomStep : zoomStep;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom + delta));

        if (Math.abs(newZoom - this.zoom) < 0.1) return;

        const rect = this.timelineTracks.getBoundingClientRect();
        const focalX = getTimelineFocalContentX({
          clientX: e.clientX,
          viewportLeft: rect.left,
          scrollLeft: this.timelineTracks.scrollLeft
        });
        this.setZoomAtPosition(newZoom, focalX);
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

      if (this._shouldStartTimelineLasso(e)) {
        e.preventDefault();
        this._startSelection(e);
        return;
      }

      // 비디오 트랙에서만 홀드 드래그 패닝
      if (this._shouldStartTimelinePan(e)) {
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panScrollLeft = this.timelineTracks?.scrollLeft || 0;
        this.tracksContainer.classList.add('panning');
        e.preventDefault();
      }
    });

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
  _getTimelineDuration() {
    return this.playlistDuration || this.cutlistDuration || this.duration;
  }

  _getTimelineTotalFrames() {
    return this.cutlistDuration ? (this.cutlistTotalFrames || this.totalFrames) : this.totalFrames;
  }

  _getFrameMappedSegments() {
    if (this.playlistDuration > 0 && this.playlistSegments?.length) return this.playlistSegments;
    if (this.cutlistDuration > 0 && this.cutlistSegments?.length) return this.cutlistSegments;
    return [];
  }

  _getSegmentFps(segment) {
    const fps = Number(segment?.fps);
    if (Number.isFinite(fps) && fps > 0) return fps;

    const fallbackFps = Number(this.fps);
    return Number.isFinite(fallbackFps) && fallbackFps > 0 ? fallbackFps : 24;
  }

  _getSegmentStartTime(segment) {
    const startTime = Number(segment?.globalStartTime ?? segment?.startTime);
    return Number.isFinite(startTime) ? startTime : 0;
  }

  _getSegmentEndTime(segment) {
    const explicitEnd = Number(segment?.globalEndTime ?? segment?.endTime);
    if (Number.isFinite(explicitEnd)) return explicitEnd;
    return this._getSegmentStartTime(segment) + this._getSegmentDuration(segment);
  }

  _getSegmentDuration(segment) {
    const duration = Number(segment?.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;

    const startTime = this._getSegmentStartTime(segment);
    const explicitEnd = Number(segment?.globalEndTime ?? segment?.endTime);
    if (Number.isFinite(explicitEnd) && explicitEnd > startTime) {
      return explicitEnd - startTime;
    }

    const frameCount = Number(segment?.frameCount);
    const fps = this._getSegmentFps(segment);
    return Number.isFinite(frameCount) && frameCount > 0 ? frameCount / fps : 0;
  }

  _getSegmentFrameCount(segment) {
    const explicitFrameCount = Number(segment?.frameCount);
    if (Number.isFinite(explicitFrameCount) && explicitFrameCount >= 0) {
      return Math.floor(explicitFrameCount);
    }

    const frameCount = Math.floor((this._getSegmentDuration(segment) * this._getSegmentFps(segment)) + 1e-6);
    return frameCount > 0 ? frameCount : 0;
  }

  _getTimelineSegmentTotalFrames(segments = this._getFrameMappedSegments()) {
    return (segments || []).reduce((total, segment) => total + this._getSegmentFrameCount(segment), 0);
  }

  _getSegmentTimeFromDisplayFrame(frame) {
    const segments = this._getFrameMappedSegments();
    if (!segments.length) return null;

    let frameCursor = 0;
    for (const segment of segments) {
      const frameCount = this._getSegmentFrameCount(segment);
      if (frameCount <= 0) continue;

      const segmentEndFrame = frameCursor + frameCount;
      if (frame < segmentEndFrame) {
        const localFrame = Math.max(0, Math.min(frameCount - 1, frame - frameCursor));
        return this._getSegmentStartTime(segment) + (localFrame / this._getSegmentFps(segment));
      }
      frameCursor = segmentEndFrame;
    }

    return null;
  }

  _getDisplayFrameFromSegmentTime(time) {
    const segments = this._getFrameMappedSegments();
    if (!segments.length) return null;

    const targetTime = Math.max(0, Number(time) || 0);
    let frameCursor = 0;
    let firstSegmentInfo = null;
    let lastSegmentInfo = null;

    for (const segment of segments) {
      const frameCount = this._getSegmentFrameCount(segment);
      if (frameCount <= 0) continue;

      const fps = this._getSegmentFps(segment);
      const startTime = this._getSegmentStartTime(segment);
      const endTime = this._getSegmentEndTime(segment);
      const segmentInfo = { frameCursor, frameCount, startTime };
      if (!firstSegmentInfo) firstSegmentInfo = segmentInfo;
      lastSegmentInfo = segmentInfo;

      if (targetTime >= startTime && targetTime < endTime) {
        const localFrame = Math.floor(((targetTime - startTime) * fps) + 1e-6);
        return frameCursor + Math.max(0, Math.min(frameCount - 1, localFrame));
      }

      frameCursor += frameCount;
    }

    if (!lastSegmentInfo) return null;
    if (firstSegmentInfo && targetTime <= firstSegmentInfo.startTime) {
      return firstSegmentInfo.frameCursor;
    }
    const localFrame = targetTime <= lastSegmentInfo.startTime
      ? 0
      : lastSegmentInfo.frameCount - 1;
    return lastSegmentInfo.frameCursor + localFrame;
  }

  _getDisplayTotalFrames() {
    const segmentFrames = this._getTimelineSegmentTotalFrames();
    if (segmentFrames > 0) return segmentFrames;

    if (this.playlistDuration > 0) {
      const playlistFrames = Math.floor(this.playlistDuration * (this.fps || 0));
      if (playlistFrames > 0) return playlistFrames;
    }

    const timelineFrames = this._getTimelineTotalFrames();
    if (timelineFrames > 0) return timelineFrames;

    const duration = this._getTimelineDuration();
    const derivedFrames = Math.floor(duration * (this.fps || 0));
    return derivedFrames > 0 ? derivedFrames : 0;
  }

  _getPlayheadFrameCenterPx(time = this.currentTime) {
    const duration = this._getTimelineDuration();
    const totalFrames = this._getDisplayTotalFrames();
    const containerWidth = this.tracksContainer?.offsetWidth || 0;
    if (duration === 0 || totalFrames === 0 || containerWidth === 0) return 0;

    const mappedFrame = this._getDisplayFrameFromSegmentTime(time);
    const fps = this.fps || (totalFrames / duration);
    const rawFrame = mappedFrame !== null
      ? mappedFrame
      : (fps > 0
        ? Math.floor((time * fps) + 1e-6)
        : Math.floor(((time / duration) * totalFrames) + 1e-6));
    const frame = Math.max(0, Math.min(totalFrames - 1, rawFrame));
    return ((frame + 0.5) / totalFrames) * containerWidth;
  }

  _getTimelineTimeFromCellPercent(percent) {
    const duration = this._getTimelineDuration();
    const totalFrames = this._getDisplayTotalFrames();
    if (duration === 0 || totalFrames === 0) return 0;

    const frame = Math.max(0, Math.min(totalFrames - 1, Math.floor(percent * totalFrames)));
    const mappedTime = this._getSegmentTimeFromDisplayFrame(frame);
    if (mappedTime !== null) {
      return Math.max(0, Math.min(mappedTime, duration));
    }
    if (!this.fps) {
      return (frame / totalFrames) * duration;
    }
    return frame / this.fps;
  }

  _snapTimeToFrame(time) {
    const duration = this._getTimelineDuration();
    if (this.fps === 0) return time;
    const frame = Math.round(time * this.fps);
    return Math.max(0, Math.min(frame / this.fps, duration));
  }

  /**
   * 클릭 위치에서 시간 계산하여 이동
   */
  _seekFromClick(e) {
    const duration = this._getTimelineDuration();
    if (duration === 0) return;

    const rect = this.tracksContainer?.getBoundingClientRect();
    if (!rect) return;

    // getBoundingClientRect()는 이미 스크롤 위치를 반영하므로
    // 클릭 위치에서 rect.left를 빼면 컨테이너 내 상대 위치가 됨
    const x = e.clientX - rect.left;

    // tracksContainer의 실제 너비 (줌이 적용된 상태)
    const containerWidth = this.tracksContainer?.offsetWidth || rect.width;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const time = this._getTimelineTimeFromCellPercent(percent);

    this._emit('seek', { time });
  }

  /**
   * 스크러빙 중 (드래그 중 프리뷰만 표시, 실제 seek 없음)
   */
  _scrubFromClick(e) {
    const duration = this._getTimelineDuration();
    if (duration === 0) return;

    const rect = this.tracksContainer?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const containerWidth = this.tracksContainer?.offsetWidth || rect.width;
    const percent = Math.max(0, Math.min(x / containerWidth, 1));
    const time = this._getTimelineTimeFromCellPercent(percent);

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
    const duration = this._getTimelineDuration();
    if (duration === 0) return;

    const positionPx = this._getPlayheadFrameCenterPx(time);

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
    this._applyCellModeMinZoom();
    this._applyZoom();

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
    if (this.isDraggingPlayhead && this.scrubTime !== undefined) {
      return;
    }
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
    const duration = this._getTimelineDuration();
    if (!this.timelineTracks || duration === 0) return;

    const playheadPx = this._getPlayheadFrameCenterPx();
    if (playheadPx === 0) return;

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
    const duration = this._getTimelineDuration();
    if (!this.timelineTracks || duration === 0) return;

    const playheadPx = this._getPlayheadFrameCenterPx();
    if (playheadPx === 0) return;

    const scrollLeft = this.timelineTracks.scrollLeft;
    const viewportWidth = this.timelineTracks.clientWidth;

    // 플레이헤드가 현재 뷰포트 내에 없으면 왼쪽에 오도록 스크롤
    if (playheadPx < scrollLeft || playheadPx > scrollLeft + viewportWidth) {
      const margin = 50;
      this.timelineTracks.scrollLeft = Math.max(0, playheadPx - margin);
    }
  }

  centerOnPlayhead() {
    const duration = this._getTimelineDuration();
    if (!this.timelineTracks || duration === 0) return;

    const playheadPx = this._getPlayheadFrameCenterPx();
    if (playheadPx === 0) return;
    const viewportWidth = this.timelineTracks.clientWidth;
    const targetScrollLeft = playheadPx - (viewportWidth / 2);
    this.timelineTracks.scrollLeft = Math.max(0, targetScrollLeft);
  }

  /**
   * 플레이헤드 위치 업데이트
   * 핸들과 라인 모두 동일한 left 값을 사용 (CSS에서 margin-left로 핸들 중앙 정렬)
   */
  _updatePlayheadPosition() {
    const duration = this._getTimelineDuration();
    if (duration === 0) return;

    const positionPx = this._getPlayheadFrameCenterPx();

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

    // 현재 뷰포트에서의 마우스 위치
    const viewportX = focalX - this.timelineTracks.scrollLeft;

    // 줌 적용
    this.zoom = newZoom;
    this._applyZoom();
    this._updateZoomDisplay();
    this._showZoomIndicator();

    // 새 줌에서 같은 콘텐츠 위치가 마우스 아래에 오도록 스크롤 조정
    const maxScrollLeft = Math.max(0, this.timelineTracks.scrollWidth - this.timelineTracks.clientWidth);
    this.timelineTracks.scrollLeft = calculateAnchoredScrollLeft({
      focalContentX: focalX,
      viewportX,
      oldZoom,
      newZoom,
      minScrollLeft: 0,
      maxScrollLeft
    });
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
  _getDisplayZoomPercent(zoom = this.zoom) {
    const zoomRange = Math.max(1, this.maxZoom - this.minZoom);
    const numericZoom = Number.isFinite(zoom) ? zoom : this.minZoom;
    const clamped = Math.max(this.minZoom, Math.min(this.maxZoom, numericZoom));
    const normalized = 100 + ((clamped - this.minZoom) / zoomRange) * 200;
    return Math.round(Math.max(100, Math.min(300, normalized)));
  }

  _updateZoomDisplay() {
    if (this.zoomDisplay) {
      this.zoomDisplay.textContent = `${this._getDisplayZoomPercent()}%`;
    }
    if (this.zoomSlider) {
      const zoomRange = Math.max(1, this.maxZoom - this.minZoom);
      this.zoomSlider.value = ((this.zoom - this.minZoom) / zoomRange) * 100;
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
    indicator.textContent = `${this._getDisplayZoomPercent()}%`;
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
    const duration = this._getTimelineDuration();
    if (!this.timelineRuler || duration === 0) return;

    // 기존 마크 제거
    const existingMarks = this.timelineRuler.querySelectorAll('.ruler-mark');
    existingMarks.forEach(mark => mark.remove());

    // 마크 간격 계산 (화면에 약 6~8개의 마크가 보이도록)
    const scale = this.zoom / 100;
    const numMarks = Math.min(Math.ceil(6 * scale), 600);
    const interval = duration / numMarks;

    for (let i = 0; i <= numMarks; i++) {
      const time = i * interval;
      const percent = (time / duration) * 100;

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
    const duration = this._getTimelineDuration();
    const totalFrames = this._getDisplayTotalFrames();
    if (!this.tracksContainer || duration === 0 || totalFrames === 0) {
      this._updateFrameCellActive(false);
      return;
    }

    const frameWidth = this._computePxPerFrame();
    const tierResult = resolveFrameGridTier(frameWidth, this._lastFrameGridTier ?? null);
    this._lastFrameGridTier = tierResult.tier;
    this._updateFrameCellActive(resolveFrameCellActive(this.frameCellMode, tierResult));

    // 격자 토글 OFF면 즉시 숨김 후 리턴
    if (!this.gridVisible) {
      if (this.frameGridContainer) {
        this.frameGridContainer.style.display = 'none';
      }
      return;
    }

    // 프레임 그리드 컨테이너 생성 또는 가져오기
    if (!this.frameGridContainer) {
      this.frameGridContainer = document.createElement('div');
      this.frameGridContainer.className = 'frame-grid-container';
      this.frameGridContainer.style.cssText = `
        position: absolute; top: 0; left: 0;
        width: 0; height: 100%;
        pointer-events: none; z-index: 1;
        contain: layout paint;
      `;
      this.tracksContainer.appendChild(this.frameGridContainer);
    }

    this._renderFrameGridTiered(frameWidth, tierResult);
  }

  _syncFrameGridContainerMetrics() {
    if (!this.frameGridContainer || !this.tracksContainer) return 0;
    const contentWidth = this.tracksContainer.offsetWidth || 0;
    this.frameGridContainer.style.width = `${contentWidth}px`;
    this.frameGridContainer.style.height = `${this._getTrackContentHeight()}px`;
    return contentWidth;
  }

  _getTrackContentHeight() {
    if (!this.tracksContainer) return 0;

    let contentHeight = 0;
    this.tracksContainer.querySelectorAll(':scope > *').forEach((child) => {
      if (child === this.frameGridContainer) return;
      const style = getComputedStyle(child);
      if (style.position === 'absolute' || style.position === 'fixed') return;
      contentHeight = Math.max(contentHeight, child.offsetTop + child.offsetHeight);
    });

    return Math.max(contentHeight, this.tracksContainer.offsetHeight || 0);
  }

  _formatGridPx(value) {
    const px = Number.isFinite(value) ? Math.max(1, value) : 1;
    return `${Number(px.toFixed(4))}px`;
  }

  _computePxPerFrame() {
    const containerWidth = this.tracksContainer?.offsetWidth || 0;
    const totalFrames = this._getDisplayTotalFrames();
    return totalFrames > 0 ? containerWidth / totalFrames : 0;
  }

  _updateFrameCellActive(active) {
    const next = active === true;
    if (this._frameCellActive === next) return;
    this._frameCellActive = next;
    this._refreshDrawingLayerRender();
  }

  /**
   * 격자 표시 토글 설정
   */
  setGridVisible(visible) {
    this.gridVisible = !!visible;
    this._updateFrameGrid();
  }

  setFrameCellMode(mode) {
    this.frameCellMode = ['on', 'off', 'auto'].includes(mode) ? mode : 'auto';
    this._applyCellModeMinZoom();
    this._applyZoom();
  }

  _applyCellModeMinZoom() {
    const viewportWidth = this.timelineTracks?.clientWidth || 0;
    const totalFrames = this._getDisplayTotalFrames();
    this.minZoom = this.frameCellMode === 'on'
      ? computeMinZoomForCellMode(totalFrames, viewportWidth, this.minFrameCellPx)
      : 100;
    this.maxZoom = Math.max(this.maxZoom, this.minZoom);
    if (this.zoom < this.minZoom) this.zoom = this.minZoom;
    this._updateZoomDisplay();
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
    this._syncFrameGridContainerMetrics();

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
      sizes.push(`${this._formatGridPx(fiveSecPx)} 100%`);
    }
    if (t.showOneSec) {
      layers.push(`repeating-linear-gradient(to right, ${colorSec} 0px, ${colorSec} 2px, transparent 2px, transparent ${secPx}px)`);
      sizes.push(`${this._formatGridPx(secPx)} 100%`);
    }
    if (t.showHalf) {
      const halfSecPx = secPx / 2;
      layers.push(`repeating-linear-gradient(to right, ${colorHalf} 0px, ${colorHalf} 1px, transparent 1px, transparent ${halfSecPx}px)`);
      sizes.push(`${this._formatGridPx(halfSecPx)} 100%`);
    }
    if (t.showQuarter) {
      // ¼초는 fps 인식: round(fps/4) 프레임마다
      const quarterFrames = Math.max(1, Math.round(fps / 4));
      const quarterPx = pxPerFrame * quarterFrames;
      layers.push(`repeating-linear-gradient(to right, ${colorQuarter} 0px, ${colorQuarter} 1px, transparent 1px, transparent ${quarterPx}px)`);
      sizes.push(`${this._formatGridPx(quarterPx)} 100%`);
    }
    if (t.showFrame) {
      layers.push(`repeating-linear-gradient(to right, ${colorFrame} 0px, ${colorFrame} 1px, transparent 1px, transparent ${pxPerFrame}px)`);
      sizes.push(`${this._formatGridPx(pxPerFrame)} 100%`);
    }

    this.frameGridContainer.style.backgroundImage = layers.join(', ');
    this.frameGridContainer.style.backgroundSize = sizes.join(', ');
    this.frameGridContainer.style.backgroundRepeat = 'repeat-x';
    this.frameGridContainer.style.backgroundPosition = '0px 0px';
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
   * 합성 레이어 타임라인 렌더링
   * @param {Array} layers - CompositionLayer 배열
   * @param {Object} options
   * @param {string|null} options.selectedLayerId - 선택된 합성 레이어 ID
   * @param {number} options.duration - 기준 영상 길이(초)
   */
  renderCompositionLayers(layers, options = {}) {
    if (!this.tracksContainer || !this.layerHeaders) return;

    this.tracksContainer.querySelectorAll('.composition-layer-track-row').forEach(track => track.remove());
    this.layerHeaders.querySelectorAll('.composition-layer-header').forEach(header => header.remove());

    const sourceLayers = Array.isArray(layers) ? layers : [];
    const duration = Math.max(
      0,
      Number(options.duration) || this.duration || Math.max(0, ...sourceLayers.map(layer => Number(layer.endTime) || 0))
    );
    const timelineDuration = duration > 0 ? duration : 1;

    sourceLayers
      .slice()
      .sort((a, b) => (Number(b.order) || 0) - (Number(a.order) || 0))
      .forEach((layer) => {
        const isSelected = layer.id === options.selectedLayerId;
        const header = this._createCompositionLayerHeader(layer, isSelected);
        const track = this._createCompositionLayerTrack(layer, isSelected, timelineDuration, duration);
        const videoHeader = this.layerHeaders.querySelector('.layer-header[data-layer="video"]');
        const videoTrack = this.tracksContainer.querySelector('.video-track-row');

        if (videoHeader) {
          this.layerHeaders.insertBefore(header, videoHeader);
        } else {
          this.layerHeaders.appendChild(header);
        }

        if (videoTrack) {
          this.tracksContainer.insertBefore(track, videoTrack);
        } else {
          this.tracksContainer.appendChild(track);
        }
      });

    this._syncFrameGridContainerMetrics();
  }

  _createCompositionLayerHeader(layer, isSelected) {
    const header = document.createElement('div');
    header.className = `layer-header composition-layer-header${isSelected ? ' selected' : ''}`;
    header.dataset.layerId = layer.id;
    header.draggable = true;
    const layerColor = layer.color || (layer.type === 'video' ? '#4a9eff' : '#ffd000');
    const selectedColor = layer.selectedColor || layerColor;
    const typeLabel = layer.type === 'video' ? '영상' : '이미지';
    header.style.setProperty('--composition-layer-color', layerColor);
    header.style.setProperty('--composition-layer-selected-color', selectedColor);
    header.innerHTML = `
      <div class="layer-color" style="background: var(--composition-layer-color)"></div>
      <span class="composition-layer-header-drag" title="순서 변경" aria-hidden="true">⋮⋮</span>
      <button class="layer-visibility composition-layer-header-visibility" type="button" data-action="composition-visibility" title="${layer.enabled ? '레이어 숨기기' : '레이어 보이기'}" aria-label="${layer.enabled ? '레이어 숨기기' : '레이어 보이기'}">
        ${this._getLayerVisibilityIcon(layer.enabled, 16)}
      </button>
      <span class="composition-layer-header-type" title="${typeLabel}" aria-label="${typeLabel}">${_getCompositionLayerTypeIcon(layer.type)}</span>
      <span class="layer-name" title="${this._escapeHtml(layer.name)}">${this._escapeHtml(layer.name)}</span>
      <span class="layer-opacity-badge">${Math.round((layer.opacity ?? 1) * 100)}%</span>
    `;
    header.addEventListener('click', (event) => {
      const action = event.target.closest?.('[data-action]')?.dataset.action;
      if (action === 'composition-visibility') {
        event.preventDefault();
        event.stopPropagation();
        this._emit('compositionLayerVisibilityToggle', { layerId: layer.id });
        return;
      }
      this._emit('compositionLayerSelect', { layerId: layer.id });
    });
    header.addEventListener('dragstart', (event) => this._handleCompositionLayerHeaderDragStart(event, layer.id, header));
    header.addEventListener('dragover', (event) => this._handleCompositionLayerHeaderDragOver(event, layer.id, header));
    header.addEventListener('drop', (event) => this._handleCompositionLayerHeaderDrop(event, layer.id, header));
    header.addEventListener('dragend', () => this._clearCompositionLayerHeaderDragFeedback());
    return header;
  }

  _handleCompositionLayerHeaderDragStart(event, layerId, header) {
    if (event.target.closest?.('[data-action]')) {
      event.preventDefault();
      return;
    }
    this.compositionLayerReorderState = { layerId };
    header.classList.add('is-dragging');
    this.layerHeaders?.classList.add('composition-layer-reordering');
    event.dataTransfer?.setData('application/x-baeframe-composition-layer', layerId);
    event.dataTransfer?.setData('text/plain', layerId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  _handleCompositionLayerHeaderDragOver(event, targetLayerId, header) {
    const sourceLayerId = this.compositionLayerReorderState?.layerId ||
      event.dataTransfer?.getData('application/x-baeframe-composition-layer') ||
      event.dataTransfer?.getData('text/plain');
    if (!sourceLayerId || sourceLayerId === targetLayerId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const placement = this._getCompositionHeaderDropPlacement(event, header);
    this._setCompositionLayerHeaderDropFeedback(header, placement);
  }

  _handleCompositionLayerHeaderDrop(event, targetLayerId, header) {
    const sourceLayerId = this.compositionLayerReorderState?.layerId ||
      event.dataTransfer?.getData('application/x-baeframe-composition-layer') ||
      event.dataTransfer?.getData('text/plain');
    if (!sourceLayerId || sourceLayerId === targetLayerId) return;
    event.preventDefault();
    const placement = this._getCompositionHeaderDropPlacement(event, header);
    this._clearCompositionLayerHeaderDragFeedback();
    this._emit('compositionLayerReorder', {
      layerId: sourceLayerId,
      targetLayerId,
      placement
    });
  }

  _getCompositionHeaderDropPlacement(event, header) {
    const rect = header?.getBoundingClientRect?.();
    if (!rect) return 'before';
    return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
  }

  _setCompositionLayerHeaderDropFeedback(header, placement = 'before') {
    this._clearCompositionLayerHeaderDropFeedback();
    header.classList.add(placement === 'after' ? 'is-drop-after' : 'is-drop-before');
  }

  _clearCompositionLayerHeaderDropFeedback() {
    this.layerHeaders
      ?.querySelectorAll?.('.composition-layer-header.is-drop-before, .composition-layer-header.is-drop-after')
      .forEach(header => header.classList.remove('is-drop-before', 'is-drop-after'));
  }

  _clearCompositionLayerHeaderDragFeedback() {
    this._clearCompositionLayerHeaderDropFeedback();
    this.layerHeaders
      ?.querySelectorAll?.('.composition-layer-header.is-dragging')
      .forEach(header => header.classList.remove('is-dragging'));
    this.layerHeaders?.classList.remove('composition-layer-reordering');
    this.compositionLayerReorderState = null;
  }

  _getLayerVisibilityIcon(enabled, size = 16) {
    const slash = enabled
      ? ''
      : '<line x1="4" y1="20" x2="20" y2="4"></line>';
    return `
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"></path>
        <circle cx="12" cy="12" r="2.4"></circle>
        ${slash}
      </svg>
    `;
  }

  _createCompositionLayerTrack(layer, isSelected, timelineDuration, baseDuration) {
    const trackRow = document.createElement('div');
    trackRow.className = 'track-row composition-layer-track-row';
    trackRow.dataset.layerId = layer.id;
    const layerColor = layer.color || (layer.type === 'video' ? '#4a9eff' : '#ffd000');
    const selectedColor = layer.selectedColor || layerColor;
    trackRow.style.setProperty('--composition-layer-color', layerColor);
    trackRow.style.setProperty('--composition-layer-selected-color', selectedColor);

    const startTime = Math.max(0, Number(layer.startTime) || 0);
    const endTime = Math.max(startTime, Number(layer.endTime) || startTime);
    const visibleEndTime = baseDuration > 0 ? Math.min(endTime, baseDuration) : endTime;
    const leftPercent = Math.min(100, Math.max(0, (startTime / timelineDuration) * 100));
    const rightPercent = Math.min(100, Math.max(leftPercent, (visibleEndTime / timelineDuration) * 100));
    const widthPercent = Math.max(0.4, rightPercent - leftPercent);
    const overflows = baseDuration > 0 && endTime > baseDuration;

    const range = document.createElement('div');
    range.className = `composition-layer-range${isSelected ? ' selected' : ''}${layer.enabled ? '' : ' is-disabled'}`;
    range.dataset.layerId = layer.id;
    range.style.left = `${leftPercent}%`;
    range.style.width = `${widthPercent}%`;
    range.style.setProperty('--composition-layer-color', layerColor);
    range.style.setProperty('--composition-layer-selected-color', selectedColor);
    range.innerHTML = `
      <span class="composition-layer-range-handle start" data-mode="start"></span>
      <span class="composition-layer-range-label">${this._escapeHtml(layer.name)}</span>
      <span class="composition-layer-range-handle end" data-mode="end"></span>
    `;

    range.addEventListener('click', (event) => {
      event.stopPropagation();
      this._emit('compositionLayerSelect', { layerId: layer.id });
    });
    range.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const mode = event.target.dataset.mode || 'move';
      this._emit('compositionLayerRangeChange', {
        layerId: layer.id,
        mode,
        clientX: event.clientX,
        trackWidth: Math.max(1, trackRow.getBoundingClientRect().width)
      });
    });

    trackRow.appendChild(range);

    if (overflows) {
      const overflow = document.createElement('div');
      const overflowLeft = rightPercent;
      const overflowWidth = Math.max(1.5, 100 - overflowLeft);
      overflow.className = 'composition-layer-overflow';
      overflow.style.left = `${overflowLeft}%`;
      overflow.style.width = `${overflowWidth}%`;
      overflow.innerHTML = '<span class="composition-layer-overflow-badge">초과</span>';
      trackRow.appendChild(overflow);
    }

    return trackRow;
  }

  _escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 그리기 레이어들 렌더링
   * @param {Array} layers - DrawingLayer 배열
   * @param {string} activeLayerId - 현재 선택된 레이어 ID
   */
  renderDrawingLayers(layers, activeLayerId) {
    if (!this.tracksContainer || !this.layerHeaders) return;

    this._lastDrawingLayers = layers;
    this._lastDrawingActiveLayerId = activeLayerId;

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

    this._syncFrameGridContainerMetrics();
  }

  _refreshDrawingLayerRender() {
    if (!this._lastDrawingLayers) return;
    this.renderDrawingLayers(this._lastDrawingLayers, this._lastDrawingActiveLayerId);
  }

  /**
   * 레이어 헤더 렌더링 (왼쪽 패널)
   */
  _renderLayerHeader(layer, isActive) {
    const header = document.createElement('div');
    header.className = `layer-header drawing-layer-header${isActive ? ' selected' : ''}`;
    header.dataset.layerId = layer.id;
    header.classList.toggle('layer-hidden', !layer.visible);

    const opacityPercent = Math.round((layer.opacity ?? 1) * 100);
    const safeName = this._escapeHtml(layer.name);
    const visibilityLabel = layer.visible ? '레이어 숨기기' : '레이어 보이기';
    const lockLabel = layer.locked ? '잠금 해제' : '레이어 잠금';
    header.innerHTML = `
      <div class="layer-color" style="background: ${layer.color}"></div>
      <button class="layer-visibility" type="button" data-action="visibility" title="${visibilityLabel}" aria-label="${visibilityLabel}" aria-pressed="${layer.visible}">
        ${this._getLayerVisibilityIcon(layer.visible)}
      </button>
      <span class="layer-name" title="${safeName}">${safeName}</span>
      <span class="layer-opacity-badge" title="불투명도 ${opacityPercent}%">${opacityPercent}%</span>
      <button class="layer-lock${layer.locked ? ' locked' : ''}" type="button" data-action="lock" title="${lockLabel}" aria-label="${lockLabel}" aria-pressed="${layer.locked}">
        ${layer.locked ? '🔒' : '🔓'}
      </button>
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
        rangeBar.style.setProperty('--kf-color', layer.color);

        keyframeContainer.appendChild(rangeBar);
      }

      // 키프레임 마커 - 점 모드 또는 정확한 1프레임 셀 모드로 표시
      const marker = document.createElement('div');
      const emptyClass = range.keyframe.isEmpty ? ' empty' : '';
      if (this._frameCellActive && this.totalFrames > 0) {
        marker.className = `keyframe-cell keyframe-marker-dot${emptyClass}`;
        marker.style.left = `${(range.start / this.totalFrames) * 100}%`;
        marker.style.width = `${(1 / this.totalFrames) * 100}%`;
        marker.style.setProperty('--kf-color', layer.color);
        marker.innerHTML = '<span class="keyframe-cell-dot" aria-hidden="true"></span>';
      } else {
        marker.className = `keyframe-marker-dot${emptyClass}`;
        // 프레임 중앙에 배치 (프레임 시작 + 0.5프레임)
        const markerLeft = ((range.start + 0.5) / this.totalFrames) * 100;
        marker.style.left = `${markerLeft}%`;
        marker.style.background = range.keyframe.isEmpty ? 'transparent' : layer.color;
      }
      marker.dataset.frame = range.start;
      marker.dataset.layerId = layer.id;
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
        const shouldStartDrag = this._handleKeyframePointerDown(e, layer.id, range.start);
        if (shouldStartDrag === false) return;
        this._startKeyframeDrag(e, layer.id, range.start, marker);
      });

      // 선택은 mousedown에서 먼저 처리한다. 그래야 드래그 고스트가 최신 선택 전체를 반영한다.
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
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
      const shouldStartDrag = this._handleKeyframePointerDown(e, layer.id, range.start);
      if (shouldStartDrag === false) return;
      this._startKeyframeDrag(e, layer.id, range.start, clip);
    });

    // 선택은 mousedown에서 먼저 처리한다. 그래야 드래그 고스트가 최신 선택 전체를 반영한다.
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
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
    if (!isSelected && !e.ctrlKey && !e.metaKey) {
      this._selectKeyframe(layerId, frame, false);
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
    const newFrame = Math.min(this.totalFrames - 1, Math.floor(percent * this.totalFrames));

    // 고스트 클립 위치 업데이트
    const rawFrameDelta = newFrame - this.dragStartFrame;
    const frameDelta = this._clampKeyframeDragDelta(rawFrameDelta);
    const targetFrame = this.dragStartFrame + frameDelta;
    this.dragGhostItems.forEach(ghostCell => {
      const sourceFrame = parseInt(ghostCell.dataset.sourceFrame || '0', 10) + frameDelta;
      const ghostPercent = (sourceFrame / this.totalFrames) * 100;
      ghostCell.style.left = `${ghostPercent}%`;
    });

    // 툴팁 위치 및 내용 업데이트
    if (this.dragTooltip) {
      const tooltipPercent = ((targetFrame + 0.5) / this.totalFrames) * 100;
      this.dragTooltip.style.left = `${tooltipPercent}%`;
      this.dragTooltip.textContent = `F${targetFrame}`;
    }

    // 프레임 이동량 저장
    this.dragGhost.dataset.targetFrame = targetFrame;
    this.dragGhost.dataset.frameDelta = frameDelta;
  }

  /**
   * 키프레임 드래그 완료
   */
  _finishKeyframeDrag(e) {
    if (!this.draggedKeyframe) return;

    const targetFrame = parseInt(this.dragGhost?.dataset.targetFrame || this.dragStartFrame);
    const frameDelta = targetFrame - this.dragStartFrame;

    // 원본 키프레임 투명도 복원
    this.dragSourceElements.forEach(element => {
      element.style.opacity = '';
    });
    this.dragSourceElements = [];

    // 고스트 및 툴팁 제거
    this.dragGhostItems.forEach(ghost => ghost.remove());
    this.dragGhostItems = [];
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
      const keyframesToMove = this.dragGhostKeyframes.map(kf => ({
        layerId: kf.layerId,
        fromFrame: kf.frame,
        toFrame: kf.frame + frameDelta
      }));
      const selectionAnchor = this.draggedKeyframe
        ? {
            layerId: this.draggedKeyframe.layerId,
            frame: this.draggedKeyframe.frame + frameDelta
          }
        : null;

      if (keyframesToMove.length > 0) {
        this._emit('keyframesMove', { keyframes: keyframesToMove, frameDelta, anchor: selectionAnchor });
        log.info('키프레임 이동', { keyframes: keyframesToMove, frameDelta });
      }
    }

    this.dragGhostKeyframes = [];
    this.draggedKeyframe = null;
  }

  /**
   * 드래그 고스트 생성
   */
  _createDragGhost(e, frame) {
    const { layerId, element: clipElement } = this.draggedKeyframe;
    const ghostKeyframes = this._getDragGhostKeyframes(layerId, frame);
    if (ghostKeyframes.length === 0) return;

    this.dragGhost = document.createElement('div');
    this.dragGhost.className = 'keyframe-drag-ghost-group';
    this.dragGhost.dataset.targetFrame = frame;
    this.dragGhost.dataset.frameDelta = '0';
    this.dragGhostItems = [];
    this.dragSourceElements = [];
    this.dragGhostKeyframes = ghostKeyframes.map(keyframe => ({ ...keyframe }));

    // 선택된 키프레임 각각에 정확히 1프레임 칸을 나타내는 고스트를 만든다.
    const ghostWidthPercent = (1 / this.totalFrames) * 100;
    ghostKeyframes.forEach(keyframe => {
      const sourceElement = this.tracksContainer?.querySelector(
        `[data-layer-id="${keyframe.layerId}"][data-frame="${keyframe.frame}"]`
      );
      const ghostHost = sourceElement?.parentElement || clipElement.parentElement;
      if (!ghostHost) return;

      const ghostCell = document.createElement('div');
      ghostCell.className = 'keyframe-drag-ghost-cell';
      ghostCell.dataset.layerId = keyframe.layerId;
      ghostCell.dataset.sourceFrame = keyframe.frame;
      ghostCell.style.left = `${(keyframe.frame / this.totalFrames) * 100}%`;
      ghostCell.style.width = `${ghostWidthPercent}%`;

      ghostHost.appendChild(ghostCell);
      this.dragGhostItems.push(ghostCell);

      if (sourceElement) {
        sourceElement.style.opacity = '0.3';
        this.dragSourceElements.push(sourceElement);
      }
    });

    if (this.dragGhostItems.length === 0) {
      const fallbackGhost = document.createElement('div');
      fallbackGhost.className = 'keyframe-drag-ghost-cell';
      fallbackGhost.dataset.layerId = layerId;
      fallbackGhost.dataset.sourceFrame = frame;
      fallbackGhost.style.left = `${(frame / this.totalFrames) * 100}%`;
      fallbackGhost.style.width = `${ghostWidthPercent}%`;
      clipElement.parentElement?.appendChild(fallbackGhost);
      this.dragGhostItems.push(fallbackGhost);
    }

    // 프레임 표시 툴팁 추가
    this.dragTooltip = document.createElement('div');
    this.dragTooltip.className = 'keyframe-drag-ghost';
    this.dragTooltip.textContent = `F${frame}`;
    const percent = ((frame + 0.5) / this.totalFrames) * 100;
    this.dragTooltip.style.left = `${percent}%`;

    clipElement.parentElement.appendChild(this.dragGhost);
    this.tracksContainer.appendChild(this.dragTooltip);
  }

  _getDragGhostKeyframes(layerId, frame) {
    const isDraggedKeyframeSelected = this.selectedKeyframes.some(
      keyframe => keyframe.layerId === layerId && keyframe.frame === frame
    );
    const keyframes = isDraggedKeyframeSelected && this.selectedKeyframes.length > 0
      ? this.selectedKeyframes.map(keyframe => ({ ...keyframe }))
      : [{ layerId, frame }];
    return keyframes.filter(keyframe => this._isKeyframeLayerMovable(keyframe.layerId));
  }

  _isKeyframeLayerMovable(layerId) {
    if (!Array.isArray(this._lastDrawingLayers)) return true;
    const layer = this._lastDrawingLayers.find(item => item.id === layerId);
    return layer?.locked !== true;
  }

  _clampKeyframeDragDelta(frameDelta) {
    const sourceFrames = this.dragGhostKeyframes
      .map(keyframe => Number(keyframe.frame))
      .filter(Number.isFinite);
    if (sourceFrames.length === 0 || this.totalFrames <= 0) return frameDelta;

    const minFrame = Math.min(...sourceFrames);
    const maxFrame = Math.max(...sourceFrames);
    const minDelta = -minFrame;
    const maxDelta = (this.totalFrames - 1) - maxFrame;
    return Math.max(minDelta, Math.min(maxDelta, frameDelta));
  }

  // ====== 키프레임 선택 ======

  /**
   * 키프레임 선택 토글
   */
  _toggleKeyframeSelection(layerId, frame, addToSelection) {
    const index = this.selectedKeyframes.findIndex(
      kf => kf.layerId === layerId && kf.frame === frame
    );
    let nextSelection;
    let anchor = { layerId, frame };

    if (addToSelection) {
      // Ctrl/Cmd + 클릭: 선택에 추가/제거
      if (index !== -1) {
        nextSelection = this.selectedKeyframes.filter((_, itemIndex) => itemIndex !== index);
        anchor = nextSelection.some(item =>
          item.layerId === this.lastSelectedKeyframe?.layerId &&
          item.frame === this.lastSelectedKeyframe?.frame
        ) ? this.lastSelectedKeyframe : null;
      } else {
        nextSelection = [...this.selectedKeyframes, { layerId, frame }];
      }
    } else {
      // 일반 클릭: 단독 선택
      nextSelection = [{ layerId, frame }];
    }

    this._setKeyframeSelection(nextSelection, { anchor });
  }

  _selectKeyframe(layerId, frame, addToSelection) {
    this._toggleKeyframeSelection(layerId, frame, addToSelection);
  }

  setKeyframeSelection(selection, options = {}) {
    this._setKeyframeSelection(selection, options);
  }

  _handleKeyframePointerDown(e, layerId, frame) {
    if (e.shiftKey) {
      this._selectKeyframeRange(layerId, frame, e.ctrlKey || e.metaKey);
      return true;
    }

    if (e.ctrlKey || e.metaKey) {
      const wasSelected = this._isKeyframeSelected(layerId, frame);
      this._toggleKeyframeSelection(layerId, frame, true);
      return !wasSelected;
    }

    const isSelected = this._isKeyframeSelected(layerId, frame);
    if (!isSelected || this.selectedKeyframes.length <= 1) {
      this._setKeyframeSelection([{ layerId, frame }], { anchor: { layerId, frame } });
      return true;
    }

    this.lastSelectedKeyframe = { layerId, frame };
    return true;
  }

  _selectKeyframeRange(layerId, frame, addToSelection = false) {
    const anchor = this.lastSelectedKeyframe?.layerId === layerId
      ? this.lastSelectedKeyframe
      : { layerId, frame };
    const frames = this._getLayerKeyframeFrames(layerId);
    const startFrame = Math.min(anchor.frame, frame);
    const endFrame = Math.max(anchor.frame, frame);
    const rangeSelection = frames
      .filter(frameNumber => frameNumber >= startFrame && frameNumber <= endFrame)
      .map(frameNumber => ({ layerId, frame: frameNumber }));
    const nextSelection = addToSelection ? [...this.selectedKeyframes] : [];

    const selectionToAdd = rangeSelection.length > 0
      ? rangeSelection
      : [{ layerId, frame }];
    selectionToAdd.forEach(keyframe => {
      if (!nextSelection.some(item => item.layerId === keyframe.layerId && item.frame === keyframe.frame)) {
        nextSelection.push(keyframe);
      }
    });

    this._setKeyframeSelection(nextSelection, { anchor: { layerId, frame } });
  }

  _getLayerKeyframeFrames(layerId) {
    const layer = Array.isArray(this._lastDrawingLayers)
      ? this._lastDrawingLayers.find(item => item.id === layerId)
      : null;
    return (layer?.keyframes || [])
      .map(keyframe => Number(keyframe?.frame))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
  }

  _isKeyframeSelected(layerId, frame) {
    return this.selectedKeyframes.some(
      keyframe => keyframe.layerId === layerId && keyframe.frame === frame
    );
  }

  _setKeyframeSelection(selection, { anchor = null } = {}) {
    const seen = new Set();
    const normalizedSelection = [];

    (selection || []).forEach(keyframe => {
      if (!keyframe?.layerId || !Number.isFinite(Number(keyframe.frame))) return;
      const normalized = { layerId: keyframe.layerId, frame: Number(keyframe.frame) };
      const key = `${normalized.layerId}:${normalized.frame}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalizedSelection.push(normalized);
    });

    this.selectedKeyframes = normalizedSelection;

    if (anchor?.layerId && Number.isFinite(Number(anchor.frame))) {
      this.lastSelectedKeyframe = { layerId: anchor.layerId, frame: Number(anchor.frame) };
    } else if (this.selectedKeyframes.length === 0) {
      this.lastSelectedKeyframe = null;
    } else if (
      !this.lastSelectedKeyframe ||
      !this._isKeyframeSelected(this.lastSelectedKeyframe.layerId, this.lastSelectedKeyframe.frame)
    ) {
      this.lastSelectedKeyframe = { ...this.selectedKeyframes[this.selectedKeyframes.length - 1] };
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
    this.tracksContainer?.querySelectorAll('.keyframe-marker-dot, .keyframe-marker').forEach(marker => {
      marker.classList.remove('selected');
    });

    // 선택된 키프레임에 selected 클래스 추가
    this.selectedKeyframes.forEach(kf => {
      const clip = this.tracksContainer?.querySelector(
        `.drawing-clip[data-layer-id="${kf.layerId}"][data-start-frame="${kf.frame}"]`
      );
      if (clip) {
        clip.classList.add('selected');
      }
      const marker = this.tracksContainer?.querySelector(
        `.keyframe-marker-dot[data-layer-id="${kf.layerId}"][data-frame="${kf.frame}"], .keyframe-marker[data-layer-id="${kf.layerId}"][data-frame="${kf.frame}"]`
      );
      if (marker) {
        marker.classList.add('selected');
      }
    });
  }

  _shouldStartTimelinePan(e) {
    if (e.button !== 0) return false;
    if (e.target?.closest?.('.cutlist-segment-block')) return false;
    return Boolean(e.target?.closest?.('.video-track-row, .track-clip.video'));
  }

  _shouldStartTimelineLasso(e) {
    if (e.button !== 0 || !this.tracksContainer) return false;
    if (this._shouldStartTimelinePan(e)) return false;

    const target = e.target;
    if (!target?.closest || !this.tracksContainer.contains(target)) return false;

    const blockedTarget = target.closest([
      '.keyframe-marker',
      '.keyframe-marker-dot',
      '.playlist-segment-boundary',
      '.playlist-segment-block',
      '.cutlist-segment-block',
      '.playlist-comment-range',
      '.comment-range-item',
      '.comment-cluster-badge',
      '.comment-cluster-close-badge',
      '.highlight-range',
      '.highlight-handle',
      'button',
      'input',
      'select',
      'textarea',
      '[data-action]'
    ].join(', '));
    if (blockedTarget) return false;

    return target === this.tracksContainer || Boolean(target.closest([
      '.track-row',
      '.drawing-track-row',
      '.frame-grid-container',
      '.keyframe-container',
      '.keyframe-range-bar',
      '.drawing-clip'
    ].join(', ')));
  }

  /**
   * 선택 박스 시작 (빈 영역 드래그)
   */
  _startSelection(e) {
    if (this.isDraggingPlayhead || this.isPanning || this.isDraggingSeeking) return;

    this.isSelecting = true;
    const containerRect = this.tracksContainer.getBoundingClientRect();
    this.selectionStartX = e.clientX - containerRect.left;
    this.selectionStartY = e.clientY - containerRect.top;

    // 선택 박스 생성
    this.selectionBox = document.createElement('div');
    this.selectionBox.className = 'selection-box';
    this.selectionBox.style.left = `${this.selectionStartX}px`;
    this.selectionBox.style.top = `${this.selectionStartY}px`;
    this.tracksContainer.appendChild(this.selectionBox);

    // 기존 선택 초기화 (Ctrl 안 누른 경우)
    if (!e.ctrlKey && !e.metaKey) {
      this._setKeyframeSelection([]);
    }
  }

  /**
   * 선택 박스 업데이트
   */
  _updateSelection(e) {
    if (!this.selectionBox || !this.tracksContainer) return;

    const containerRect = this.tracksContainer.getBoundingClientRect();
    const currentX = e.clientX - containerRect.left;
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

    const nextSelection = [...this.selectedKeyframes];
    let lastHit = null;

    // 선택 박스와 겹치는 키프레임 마커 찾기
    this.tracksContainer?.querySelectorAll('.keyframe-marker, .keyframe-marker-dot').forEach(marker => {
      const markerRect = marker.getBoundingClientRect();

      // 마커가 선택 박스와 조금이라도 겹치는지 확인
      if (markerRect.right >= boxRect.left &&
          markerRect.left <= boxRect.right &&
          markerRect.bottom >= boxRect.top &&
          markerRect.top <= boxRect.bottom) {
        const layerId = marker.dataset.layerId;
        const frame = parseInt(marker.dataset.frame);
        lastHit = { layerId, frame };

        // 선택에 추가 (중복 방지)
        if (!nextSelection.some(kf => kf.layerId === layerId && kf.frame === frame)) {
          nextSelection.push({ layerId, frame });
        }
      }
    });

    // 선택 박스 제거
    this.selectionBox.remove();
    this.selectionBox = null;
    this.isSelecting = false;

    this._setKeyframeSelection(nextSelection, { anchor: lastHit });
  }

  /**
   * 선택 초기화
   */
  clearSelection() {
    this._setKeyframeSelection([]);
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
    const duration = this._getTimelineDuration();
    if (!this.tracksContainer || duration === 0) return;

    // 픽셀 거리 계산을 위한 컨테이너 너비
    const containerWidth = this.tracksContainer.offsetWidth || 1000;
    const minClusterDistance = 20; // 20px 미만이면 클러스터링

    // 시간순 정렬
    const sortedMarkers = [...allMarkerData].sort((a, b) => a.time - b.time);

    // 클러스터 그룹화
    const clusters = [];
    let currentCluster = null;

    sortedMarkers.forEach(markerData => {
      const pixelX = (markerData.time / duration) * containerWidth;

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
    const duration = this._getTimelineDuration();
    const percent = duration > 0 ? (time / duration) * 100 : 0;
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
      this._syncFrameGridContainerMetrics();
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

    this._syncFrameGridContainerMetrics();
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
    this.clearCommentTrackRowHeight();
    // 트랙 배경 클릭으로 펼친 클러스터 접기 / 배지 펼치기 등은 app.js의
    // setupCommentRangeInteractions()에서 드래그 가드와 함께 위임 처리한다.
  }

  _setCommentTrackRowHeight(height = 24) {
    if (this.commentTrack) {
      this.commentTrack.style.height = `${height}px`;
    }
    if (this.commentLayerHeader) {
      this.commentLayerHeader.style.height = `${height}px`;
      this.commentLayerHeader.style.minHeight = `${height}px`;
    }
    this._syncFrameGridContainerMetrics();
  }

  clearCommentTrackRowHeight() {
    this._setCommentTrackRowHeight();
  }

  setCommentRangesVisible(visible) {
    this.commentRangesVisible = visible !== false;
    if (!this.commentTrack) return;

    if (!this.commentRangesVisible) {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      this._syncFrameGridContainerMetrics();
      return;
    }

    if (Array.isArray(this._lastPlaylistCommentRanges)) {
      this.renderPlaylistCommentRanges(
        this._lastPlaylistCommentRanges,
        this._lastPlaylistCommentDuration
      );
      return;
    }

    if (Array.isArray(this._lastComments)) {
      this.renderCommentRanges(this._lastComments);
    }
  }

  setPlaylistTimeline(segments, totalDuration) {
    this.playlistSegments = Array.isArray(segments) ? segments : [];
    this.playlistDuration = totalDuration || 0;
    this._updateRuler();
    this._updatePlayheadPosition();
    if (!this.playlistSegments.length || !this.playlistDuration) {
      this.clearPlaylistCommentRanges();
    }
    this._renderPlaylistSegments();
    this._updateFrameGrid();
  }

  clearPlaylistCommentRanges() {
    this._lastPlaylistCommentRanges = null;
    this._lastPlaylistCommentDuration = 0;
    this.expandedClusterId = null;

    if (!this.commentTrack) return;
    this.commentTrack.querySelectorAll('.playlist-comment-range').forEach(el => el.remove());

    const hasCommentContent = this.commentTrack.querySelector(
      '.comment-range-item, .comment-cluster-badge, .comment-cluster-close-badge'
    );
    if (!hasCommentContent) {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      this._syncFrameGridContainerMetrics();
    }
  }

  clearPlaylistTimeline() {
    this.playlistSegments = [];
    this.playlistDuration = 0;
    this._updateRuler();
    this._updatePlayheadPosition();
    this._clearPlaylistSegmentElements();
    this.clearPlaylistCommentRanges();
    this._updateFrameGrid();
  }

  setCutlistTimeline(segments, totalDuration) {
    this.cutlistSegments = segments || [];
    this.cutlistDuration = totalDuration || 0;
    this.cutlistTotalFrames = this.cutlistSegments.reduce((maxFrame, segment) => (
      Math.max(maxFrame, Number(segment?.globalEndFrame) + 1 || 0)
    ), 0);
    this._updateRuler();
    this._updatePlayheadPosition();
    this._renderCutlistSegments();
    this._updateFrameGrid();
  }

  setCurrentCutId(cutId) {
    this.currentCutId = cutId || null;
    this.tracksContainer?.querySelectorAll('.cutlist-segment-block').forEach(block => {
      block.classList.toggle('current', block.dataset.cutId === this.currentCutId);
    });
  }

  _renderPlaylistSegments() {
    if (!this.tracksContainer) return;
    this._clearPlaylistSegmentElements();
    const videoTrackRow = this.tracksContainer.querySelector('.video-track-row');
    const duration = this.playlistDuration || this.duration;
    const hasSegments = Boolean(duration && this.playlistSegments?.length);
    if (videoTrackRow) {
      videoTrackRow.classList.toggle('has-playlist-segments', hasSegments);
    }
    if (!hasSegments) return;

    for (const segment of this.playlistSegments || []) {
      const left = (segment.startTime / duration) * 100;
      const width = Math.max(0.25, ((segment.endTime - segment.startTime) / duration) * 100);
      if (videoTrackRow) {
        const block = document.createElement('button');
        block.type = 'button';
        block.className = 'playlist-segment-block';
        block.style.left = `${left}%`;
        block.style.width = `${width}%`;
        block.title = `${segment.fileName} ${this._formatTime(segment.startTime)} - ${this._formatTime(segment.endTime)}`;
        block.dataset.itemId = segment.itemId;
        block.dataset.startTime = String(segment.startTime);

        const label = document.createElement('span');
        label.className = 'playlist-segment-block-label';
        label.textContent = segment.fileName || `컷 ${segment.index + 1}`;
        block.appendChild(label);

        let pointerDown = null;
        block.addEventListener('mousedown', (e) => {
          pointerDown = { x: e.clientX, y: e.clientY };
        });
        block.addEventListener('click', (e) => {
          e.stopPropagation();
          const moved = pointerDown
            ? Math.abs(e.clientX - pointerDown.x) + Math.abs(e.clientY - pointerDown.y) > 4
            : false;
          pointerDown = null;
          if (moved) return;
          const time = Number(block.dataset.startTime) || 0;
          this._emit('seek', { time, itemId: segment.itemId });
        });
        videoTrackRow.appendChild(block);
      }

      const boundary = document.createElement('button');
      boundary.type = 'button';
      boundary.className = 'playlist-segment-boundary';
      boundary.style.left = `${left}%`;
      boundary.title = `${segment.fileName} ${this._formatTime(segment.startTime)}`;
      boundary.dataset.itemId = segment.itemId;
      boundary.dataset.startTime = String(segment.startTime);
      boundary.addEventListener('click', (e) => {
        e.stopPropagation();
        const time = Number(boundary.dataset.startTime) || 0;
        this._emit('seek', { time, itemId: segment.itemId });
      });
      this.tracksContainer.appendChild(boundary);
    }
  }

  _clearPlaylistSegmentElements() {
    if (!this.tracksContainer) return;
    this.tracksContainer.querySelectorAll('.playlist-segment-boundary, .playlist-segment-block').forEach(el => el.remove());
    const videoTrackRow = this.tracksContainer.querySelector('.video-track-row');
    if (videoTrackRow) {
      videoTrackRow.classList.remove('has-playlist-segments');
    }
  }

  _renderCutlistSegments() {
    if (!this.tracksContainer) return;
    this.tracksContainer.querySelectorAll('.cutlist-segment-block').forEach(el => el.remove());
    const videoTrackRow = this.tracksContainer.querySelector('.video-track-row');
    const duration = this.cutlistDuration || 0;
    const hasSegments = Boolean(duration && this.cutlistSegments?.length);
    if (videoTrackRow) {
      videoTrackRow.classList.toggle('has-cutlist-segments', hasSegments);
    }
    if (!hasSegments || !videoTrackRow) return;

    for (const segment of this.cutlistSegments || []) {
      const startTime = Number(segment.globalStartTime) || 0;
      const endTime = Number(segment.globalEndTime) || startTime;
      const left = (startTime / duration) * 100;
      const width = Math.max(0.25, ((endTime - startTime) / duration) * 100);
      const cutId = segment.cutId || segment.cut?.id || '';
      const labelText = segment.label || segment.cut?.label || `컷 ${segment.index + 1}`;

      const block = document.createElement('button');
      block.type = 'button';
      block.className = `cutlist-segment-block${cutId === this.currentCutId ? ' current' : ''}`;
      block.style.left = `${left}%`;
      block.style.width = `${width}%`;
      block.title = `${labelText} ${this._formatTime(startTime)} - ${this._formatTime(endTime)}`;
      block.dataset.cutId = cutId;

      const label = document.createElement('span');
      label.className = 'cutlist-segment-label';
      label.textContent = labelText;
      block.appendChild(label);

      let pointerDown = null;
      block.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        pointerDown = { x: e.clientX, y: e.clientY };
      });
      block.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const moved = pointerDown
          ? Math.abs(e.clientX - pointerDown.x) + Math.abs(e.clientY - pointerDown.y) > 4
          : false;
        pointerDown = null;
        if (moved || !cutId) return;
        this._emit('cutlist-seek', { cutId });
      });

      videoTrackRow.appendChild(block);
    }
  }

  renderPlaylistCommentRanges(ranges, totalDuration) {
    if (!this.commentTrack) return;
    this._lastPlaylistCommentRanges = ranges || [];
    this._lastPlaylistCommentDuration = totalDuration || this.playlistDuration || this.duration || 0;
    this._setCommentTrackRowHeight();
    this.commentTrack.querySelectorAll(
      '.playlist-comment-range, .comment-range-item, .comment-cluster-badge, .comment-cluster-close-badge'
    ).forEach(el => el.remove());
    this._lastComments = null;
    this.expandedClusterId = null;
    if (!this.commentRangesVisible) {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      this._syncFrameGridContainerMetrics();
      return;
    }

    const duration = this._lastPlaylistCommentDuration;
    if (!duration) {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      this._syncFrameGridContainerMetrics();
      return;
    }

    for (const range of ranges || []) {
      const left = (range.globalStartTime / duration) * 100;
      const width = Math.max(0.2, ((range.globalEndTime - range.globalStartTime) / duration) * 100);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `playlist-comment-range${range.resolved ? ' resolved' : ''}`;
      el.style.left = `${left}%`;
      el.style.width = `${width}%`;
      el.style.setProperty('--comment-color', range.color);
      el.dataset.itemId = range.itemId;
      el.dataset.markerId = range.markerId;
      el.dataset.aggregateCommentKey = getPlaylistAggregateCommentKey(range);
      el.dataset.localStartFrame = String(range.localStartFrame);
      el.title = formatPlaylistCommentTitle(range);
      const label = document.createElement('span');
      label.className = 'playlist-comment-range-label';
      label.textContent = formatPlaylistCommentLabel(range);
      el.appendChild(label);
      this.commentTrack.appendChild(el);
    }

    const hasRanges = ranges && ranges.length > 0;
    if (hasRanges) {
      this.commentTrack.style.display = 'block';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'flex';
      }
      this._syncFrameGridContainerMetrics();
    } else {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      this._syncFrameGridContainerMetrics();
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
    this._lastPlaylistCommentRanges = null;
    this._lastPlaylistCommentDuration = 0;

    // 기존 댓글 제거
    this.commentTrack.innerHTML = '';

    if (!this.commentRangesVisible) {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      this._syncFrameGridContainerMetrics();
      return;
    }

    // 댓글이 없으면 트랙 및 레이어 헤더 숨김 (기존 로직 유지)
    if (!comments || comments.length === 0) {
      this.clearCommentTrackRowHeight();
      this.commentTrack.style.display = 'none';
      if (this.commentLayerHeader) {
        this.commentLayerHeader.style.display = 'none';
      }
      // 펼침 상태는 데이터가 없어진 상황이므로 리셋
      this.expandedClusterId = null;
      this._syncFrameGridContainerMetrics();
      return;
    }

    // 트랙 및 레이어 헤더 표시 (기존 로직 유지)
    this.commentTrack.style.display = 'block';
    if (this.commentLayerHeader) {
      this.commentLayerHeader.style.display = 'flex';
    }

    // 1) 프레임 기반 클러스터링
    const rawClusters = findRangeClusters(comments);

    // 1b) 픽셀 기반 split — 줌 반응형. 포인트 마커 클러스터링과 동일한 20px 기준.
    const trackRect = this.commentTrack.getBoundingClientRect();
    const totalFrames = this._getTimelineTotalFrames();
    const pxPerFrame = totalFrames > 0 && trackRect.width > 0
      ? trackRect.width / totalFrames
      : 0;
    const clusters = splitClustersByPixelGap(rawClusters, { pxPerFrame, minSpacingPx: 20 });

    // 2) 펼침 상태 유효성 검증 — split 후 clusterKey 기준으로 판정
    if (this.expandedClusterId !== null) {
      const stillExists = clusters.some(c =>
        clusterKey(c) === this.expandedClusterId && c.length > 1
      );
      if (!stillExists) {
        this.expandedClusterId = null;
      }
    }

    // 3) 렌더 단위 레인 계산 — 접힌 클러스터 배지와 단일 댓글이 서로 덮이지 않게 배치
    const expandedClusters = new Set();
    const renderItems = clusters.map(cluster => {
      const startFrame = Math.min(...cluster.map(c => c.startFrame));
      const endFrame = Math.max(...cluster.map(c => c.endFrame));
      const item = {
        cluster,
        startFrame,
        endFrame,
        laneSpan: 1
      };

      if (clusterKey(cluster) === this.expandedClusterId && cluster.length > 1) {
        const { maxLane } = assignLanes(cluster); // _lane이 여기서 1회 설정됨
        item.laneSpan = maxLane;
        expandedClusters.add(cluster);
      }

      return item;
    });
    const { maxLane: maxRenderLane } = assignRenderLanes(renderItems);
    const maxLanes = Math.max(1, maxRenderLane);

    // 4) 트랙 높이 동적 설정 (애니메이션)
    const baseHeight = 24;
    const laneHeight = 24;
    const lanePadding = 6;
    const targetHeight = maxLanes > 1
      ? laneHeight * maxLanes + lanePadding
      : baseHeight;
    this._setCommentTrackRowHeight(targetHeight);

    // 5) 각 클러스터 렌더
    renderItems.forEach(item => {
      const { cluster } = item;
      const laneTop = 2 + item._lane * laneHeight;
      if (cluster.length === 1) {
        // 단일 댓글 (또는 split 후 단일 멤버로 쪼개진 조각)
        const el = this._createCommentRangeElement(cluster[0]);
        el.style.top = `${laneTop}px`;
        this.commentTrack.appendChild(el);
      } else if (expandedClusters.has(cluster)) {
        // 펼친 클러스터 — step 3에서 assignLanes가 이미 실행되어 _lane이 설정된 상태
        cluster.forEach(c => {
          const el = this._createCommentRangeElement(c);
          el.style.top = `${laneTop + c._lane * laneHeight}px`;
          this.commentTrack.appendChild(el);
        });
        const closeBadge = this._createClusterCloseBadge(cluster);
        closeBadge.style.top = `${laneTop - 22}px`;
        this.commentTrack.appendChild(closeBadge);
      } else {
        // 접힌 클러스터 — 배지
        const badge = this._createClusterBadgeElement(cluster);
        badge.style.top = `${laneTop}px`;
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
    if (comment.aggregateCommentKey) {
      element.classList.add('cutlist-comment-range');
      element.dataset.cutlistAggregateCommentKey = comment.aggregateCommentKey;
    }
    element.dataset.layerId = comment.layerId;
    element.dataset.markerId = comment.markerId;

    // resolved 상태 추가
    if (comment.resolved) {
      element.classList.add('resolved');
    }

    // 위치 및 크기 계산 (프레임 기반)
    const totalFrames = this._getTimelineTotalFrames() || 1;
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
   * 접힌 클러스터의 배지 바 DOM 생성 (이벤트는 위임 핸들러가 처리)
   */
  _createClusterBadgeElement(cluster) {
    const totalFrames = this._getTimelineTotalFrames() || 1;
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

    const leftHandle = document.createElement('span');
    leftHandle.className = 'comment-cluster-handle comment-cluster-handle-left';
    leftHandle.dataset.handle = 'left';
    el.appendChild(leftHandle);

    // "+N" 숫자 강조 레이블만 표시 (세로 스트라이프/라벨 제거)
    const label = document.createElement('span');
    label.className = 'comment-cluster-badge-label';
    label.textContent = `+${cluster.length}`;
    el.appendChild(label);

    const rightHandle = document.createElement('span');
    rightHandle.className = 'comment-cluster-handle comment-cluster-handle-right';
    rightHandle.dataset.handle = 'right';
    el.appendChild(rightHandle);

    return el;
  }

  /**
   * 펼친 클러스터의 접기 배지 DOM (오른쪽 상단 고정, 이벤트는 위임)
   */
  _createClusterCloseBadge(cluster) {
    const totalFrames = this._getTimelineTotalFrames() || 1;
    const minStart = Math.min(...cluster.map(c => c.startFrame));
    const maxEnd = Math.max(...cluster.map(c => c.endFrame));
    const leftPercent = (minStart / totalFrames) * 100;
    const widthPercent = ((maxEnd - minStart) / totalFrames) * 100;

    const el = document.createElement('div');
    el.className = 'comment-cluster-close-badge';
    el.textContent = '접기';
    el.dataset.clusterKey = clusterKey(cluster);
    // 클러스터 영역의 오른쪽 상단에 고정
    el.style.left = `calc(${leftPercent}% + ${widthPercent}% - 60px)`;
    el.style.top = '-22px';
    return el;
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
    const totalFrames = this._getTimelineTotalFrames() || 1;
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
