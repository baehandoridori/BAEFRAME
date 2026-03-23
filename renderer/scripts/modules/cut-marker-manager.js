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
  small: '11px',
  medium: '14px',
  large: '18px'
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
    this._position = 'top-left';
    this._fontSize = 'medium';

    this._loadSettings();

    logger.info('CutMarkerManager 초기화');
  }

  // ============================================================
  // Settings
  // ============================================================

  _loadSettings() {
    if (!this.settings) return;
    this._visible = this.settings.getSetting('showCutMarkers') !== false;
    this._position = this.settings.getSetting('cutMarkerPosition') || 'top-left';
    this._fontSize = this.settings.getSetting('cutMarkerFontSize') || 'medium';
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

  _applyOverlaySettings() {
    if (!this.overlayContainer) return;

    for (const pos of POSITIONS) {
      this.overlayContainer.classList.remove(`cut-marker-pos-${pos}`);
    }
    this.overlayContainer.classList.add(`cut-marker-pos-${this._position}`);

    this.overlayContainer.style.fontSize = FONT_SIZES[this._fontSize] || FONT_SIZES.medium;

    this.overlayContainer.style.display =
      (this._visible && this.markers.length > 0) ? 'block' : 'none';
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
