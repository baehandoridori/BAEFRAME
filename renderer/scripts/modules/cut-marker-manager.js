/**
 * cut-marker-manager.js
 * Premiere Pro 중첩 시퀀스 기반 컷 마커 관리 + 영상 오버레이
 */

import { createLogger } from '../logger.js';

const logger = createLogger('CutMarkerManager');

// ============================================================
// CutMarker 데이터 클래스
// ============================================================

class CutMarker {
  constructor({ name, startFrame, endFrame, startTime, endTime }) {
    this.name = name;
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.startTime = startTime;
    this.endTime = endTime;
  }

  containsFrame(frame) {
    return frame >= this.startFrame && frame < this.endFrame;
  }

  containsTime(time) {
    return time >= this.startTime && time < this.endTime;
  }

  toJSON() {
    return {
      name: this.name,
      startFrame: this.startFrame,
      endFrame: this.endFrame,
      startTime: this.startTime,
      endTime: this.endTime
    };
  }

  static fromJSON(json) {
    return new CutMarker(json);
  }
}

// ============================================================
// CutMarkerManager
// ============================================================

const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'bottom-left', 'bottom-center', 'bottom-right'
];

const FONT_SIZES = {
  small: '12px',
  medium: '18px',
  large: '26px',
  xlarge: '36px'
};

class CutMarkerManager extends EventTarget {
  constructor(options = {}) {
    super();

    this.overlayContainer = options.overlayContainer || null;
    this.overlayLabel = this.overlayContainer?.querySelector('.cut-marker-label') || null;

    this.videoPlayer = options.videoPlayer || null;
    this.timeline = options.timeline || null;
    this.settings = options.settings || null;

    this.markers = [];
    this.currentCut = null;
    this.source = null;
    this.sequenceName = null;
    this.sourceFps = null;

    this._visible = true;
    this._timelineVisible = true;
    this._position = 'top-left';
    this._fontSize = 'large';
    this._opacity = 0.8;

    this._loadSettings();
    this._setupOverlayDrag();

    logger.info('CutMarkerManager 초기화');
  }

  // ============================================================
  // Settings
  // ============================================================

  _loadSettings() {
    if (!this.settings) return;
    this._visible = this.settings.getSetting('showCutMarkers') !== false;
    this._timelineVisible = this.settings.getSetting('showCutMarkersTimeline') !== false;
    this._position = this.settings.getSetting('cutMarkerPosition') || 'top-left';
    this._fontSize = this.settings.getSetting('cutMarkerFontSize') || 'large';
    this._opacity = this.settings.getSetting('cutMarkerOpacity') ?? 0.8;
    this._applyOverlaySettings();
  }

  setVisible(show) {
    this._visible = show;
    if (this.settings) {
      this.settings.setSetting('showCutMarkers', show);
    }
    this._applyOverlaySettings();
    this._emit('visibilityChanged', { visible: show });
  }

  setPosition(position) {
    if (!POSITIONS.includes(position)) return;
    this._position = position;
    if (this.settings) {
      this.settings.setSetting('cutMarkerPosition', position);
    }
    this._applyOverlaySettings();
    this._emit('positionChanged', { position });
  }

  setFontSize(size) {
    if (!FONT_SIZES[size]) return;
    this._fontSize = size;
    if (this.settings) {
      this.settings.setSetting('cutMarkerFontSize', size);
    }
    this._applyOverlaySettings();
    this._emit('fontSizeChanged', { size });
  }

  setOpacity(opacity) {
    this._opacity = Math.max(0, Math.min(1, opacity));
    if (this.settings) {
      this.settings.setSetting('cutMarkerOpacity', this._opacity);
    }
    this._applyOverlaySettings();
    this._emit('opacityChanged', { opacity: this._opacity });
  }

  setTimelineVisible(show) {
    this._timelineVisible = show;
    if (this.settings) {
      this.settings.setSetting('showCutMarkersTimeline', show);
    }
    if (this.timeline) {
      this.timeline.setCutMarkersVisible(show);
    }
    this._emit('timelineVisibilityChanged', { visible: show });
  }

  // 현재 설정 값 가져오기
  getSettings() {
    return {
      visible: this._visible,
      timelineVisible: this._timelineVisible,
      position: this._position,
      fontSize: this._fontSize,
      opacity: this._opacity
    };
  }

  _applyOverlaySettings() {
    if (!this.overlayContainer) return;

    // 위치 클래스
    for (const pos of POSITIONS) {
      this.overlayContainer.classList.remove(`cut-marker-pos-${pos}`);
    }
    this.overlayContainer.classList.add(`cut-marker-pos-${this._position}`);

    // 폰트 크기
    this.overlayContainer.style.fontSize = FONT_SIZES[this._fontSize] || FONT_SIZES.large;

    // 불투명도
    this.overlayContainer.style.opacity = this._opacity;

    // 표시/숨김
    this.overlayContainer.style.display =
      (this._visible && this.markers.length > 0) ? 'block' : 'none';

    // 드래그 가능하게
    this.overlayContainer.style.pointerEvents =
      (this._visible && this.markers.length > 0) ? 'auto' : 'none';
  }

  // ============================================================
  // Overlay Drag & Resize
  // ============================================================

  _setupOverlayDrag() {
    if (!this.overlayContainer) return;
    if (this._dragSetup) return;
    this._dragSetup = true;

    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    this.overlayContainer.style.cursor = 'move';

    this.overlayContainer.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      const rect = this.overlayContainer.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;

      // 위치 클래스 제거하고 자유 위치로 전환
      for (const pos of POSITIONS) {
        this.overlayContainer.classList.remove(`cut-marker-pos-${pos}`);
      }
      this.overlayContainer.style.transform = 'none';

      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const parent = this.overlayContainer.offsetParent;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const x = e.clientX - parentRect.left - offsetX;
      const y = e.clientY - parentRect.top - offsetY;
      this.overlayContainer.style.left = `${Math.max(0, x)}px`;
      this.overlayContainer.style.top = `${Math.max(0, y)}px`;
      this.overlayContainer.style.right = 'auto';
      this.overlayContainer.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // 마우스 휠로 크기 조정
    this.overlayContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const currentSize = parseFloat(getComputedStyle(this.overlayContainer).fontSize) || 26;
      const delta = e.deltaY > 0 ? -2 : 2;
      const newSize = Math.max(10, Math.min(80, currentSize + delta));
      this.overlayContainer.style.fontSize = `${newSize}px`;
    }, { passive: false });
  }

  // ============================================================
  // Data Management
  // ============================================================

  importFromPrproj(parsedData) {
    this.markers = parsedData.cuts.map(c => CutMarker.fromJSON(c));
    this.source = parsedData.source || null;
    this.sequenceName = parsedData.sequenceName;
    this.sourceFps = parsedData.fps;

    if (this.timeline) {
      this.timeline.setCutMarkers(this.markers);
      this.timeline.setCutMarkersVisible(this._timelineVisible);

      // 타임라인 드래그로 마커 이동 시 데이터 동기화
      this.timeline.removeEventListener('cutMarkersChanged', this._onTimelineDrag);
      this._onTimelineDrag = () => { this._emit('markersUpdated'); };
      this.timeline.addEventListener('cutMarkersChanged', this._onTimelineDrag);
    }

    this._applyOverlaySettings();
    this._emit('imported', {
      count: this.markers.length,
      sequenceName: this.sequenceName
    });

    logger.info(`컷 마커 가져오기 완료: ${this.markers.length}개 (${this.sequenceName})`);
  }

  clear() {
    this.markers = [];
    this.currentCut = null;
    this.source = null;
    this.sequenceName = null;
    this.sourceFps = null;

    if (this.overlayLabel) {
      this.overlayLabel.textContent = '';
    }
    if (this.overlayContainer) {
      this.overlayContainer.style.display = 'none';
    }
    if (this.timeline) {
      this.timeline.setCutMarkers([]);
    }

    this._emit('cleared');
    logger.info('컷 마커 초기화');
  }

  hasMarkers() {
    return this.markers.length > 0;
  }

  // ============================================================
  // Frame Lookup (Binary Search)
  // ============================================================

  getCutAtFrame(frame) {
    if (this.markers.length === 0) return null;

    let low = 0;
    let high = this.markers.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const marker = this.markers[mid];

      if (frame < marker.startFrame) {
        high = mid - 1;
      } else if (frame >= marker.endFrame) {
        low = mid + 1;
      } else {
        return marker;
      }
    }

    return null;
  }

  getCutAtTime(time) {
    if (this.markers.length === 0) return null;

    let low = 0;
    let high = this.markers.length - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const marker = this.markers[mid];

      if (time < marker.startTime) {
        high = mid - 1;
      } else if (time >= marker.endTime) {
        low = mid + 1;
      } else {
        return marker;
      }
    }

    return null;
  }

  // ============================================================
  // Overlay Rendering
  // ============================================================

  updateOverlay(currentFrame) {
    if (!this._visible || this.markers.length === 0) {
      if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }
      return;
    }

    const cut = this.getCutAtFrame(currentFrame);

    if (cut !== this.currentCut) {
      this.currentCut = cut;

      if (cut && this.overlayLabel) {
        this.overlayLabel.textContent = cut.name;
        this.overlayContainer.style.display = 'block';
      } else if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }

      this._emit('cutChanged', { cut });
    }
  }

  updateOverlayByTime(currentTime) {
    if (!this._visible || this.markers.length === 0) {
      if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }
      return;
    }

    const cut = this.getCutAtTime(currentTime);

    if (cut !== this.currentCut) {
      this.currentCut = cut;

      if (cut && this.overlayLabel) {
        this.overlayLabel.textContent = cut.name;
        this.overlayContainer.style.display = 'block';
      } else if (this.overlayContainer) {
        this.overlayContainer.style.display = 'none';
      }

      this._emit('cutChanged', { cut });
    }
  }

  // ============================================================
  // Persistence (.bframe)
  // ============================================================

  toJSON() {
    if (this.markers.length === 0) return null;

    return {
      source: this.source,
      sequenceName: this.sequenceName,
      fps: this.sourceFps,
      markers: this.markers.map(m => m.toJSON())
    };
  }

  loadFromJSON(json) {
    if (!json || !json.markers || json.markers.length === 0) {
      this.clear();
      return;
    }

    this.source = json.source || null;
    this.sequenceName = json.sequenceName || null;
    this.sourceFps = json.fps || null;
    this.markers = json.markers.map(m => CutMarker.fromJSON(m));

    if (this.timeline) {
      this.timeline.setCutMarkers(this.markers);
    }

    this._applyOverlaySettings();
    this._emit('loaded', {
      count: this.markers.length,
      sequenceName: this.sequenceName
    });

    logger.info(`컷 마커 로드 완료: ${this.markers.length}개`);
  }

  // ============================================================
  // Events
  // ============================================================

  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// Singleton
let instance = null;

export function getCutMarkerManager(options) {
  if (!instance) {
    instance = new CutMarkerManager(options);
  }
  return instance;
}

export { CutMarker, CutMarkerManager };
