/**
 * highlight-manager.js
 * 타임라인 하이라이트 관리 모듈
 */

import { createLogger } from './logger.js';

const log = createLogger('HighlightManager');

// 하이라이트 색상 정의
export const HIGHLIGHT_COLORS = {
  red: { name: '빨강', color: '#ff5555', bgColor: 'rgba(255, 85, 85, 0.3)' },
  yellow: { name: '노랑', color: '#ffdd59', bgColor: 'rgba(255, 221, 89, 0.3)' },
  green: { name: '초록', color: '#2ed573', bgColor: 'rgba(46, 213, 115, 0.3)' },
  blue: { name: '파랑', color: '#4a9eff', bgColor: 'rgba(74, 158, 255, 0.3)' },
  gray: { name: '회색', color: '#a0a0a0', bgColor: 'rgba(160, 160, 160, 0.3)' },
  white: { name: '흰색', color: '#ffffff', bgColor: 'rgba(255, 255, 255, 0.3)' }
};

// 기본 하이라이트 길이 (초)
const DEFAULT_HIGHLIGHT_DURATION = 5;

/**
 * 하이라이트 데이터 클래스
 */
export class Highlight {
  static nextId = 1;

  /**
   * nextId 초기화
   */
  static resetNextId() {
    Highlight.nextId = 1;
  }

  /**
   * 로드된 하이라이트들의 ID를 기반으로 nextId 업데이트
   * @param {Highlight[]} highlights
   */
  static updateNextIdFromHighlights(highlights) {
    let maxId = 0;
    highlights.forEach(h => {
      const match = h.id.match(/^highlight-(\d+)$/);
      if (match) {
        const idNum = parseInt(match[1], 10);
        if (idNum > maxId) {
          maxId = idNum;
        }
      }
    });
    Highlight.nextId = maxId + 1;
  }

  constructor(options = {}) {
    this.id = options.id || `highlight-${Highlight.nextId++}`;
    this.startTime = options.startTime || 0;      // 시작 시간 (초)
    this.endTime = options.endTime || 0;          // 종료 시간 (초)
    this.colorKey = options.colorKey || 'yellow'; // 색상 키
    this.note = options.note || '';               // 주석
    this.createdAt = options.createdAt || new Date().toISOString();
    this.modifiedAt = options.modifiedAt || this.createdAt;
  }

  /**
   * 색상 정보 반환
   */
  get colorInfo() {
    return HIGHLIGHT_COLORS[this.colorKey] || HIGHLIGHT_COLORS.yellow;
  }

  /**
   * 하이라이트 길이 (초)
   */
  get duration() {
    return this.endTime - this.startTime;
  }

  /**
   * JSON 직렬화
   */
  toJSON() {
    return {
      id: this.id,
      startTime: this.startTime,
      endTime: this.endTime,
      colorKey: this.colorKey,
      note: this.note,
      createdAt: this.createdAt,
      modifiedAt: this.modifiedAt
    };
  }

  /**
   * JSON에서 복원
   */
  static fromJSON(json) {
    return new Highlight({
      id: json.id,
      startTime: json.startTime,
      endTime: json.endTime,
      colorKey: json.colorKey,
      note: json.note,
      createdAt: json.createdAt,
      modifiedAt: json.modifiedAt
    });
  }
}

/**
 * 하이라이트 매니저 클래스
 */
export class HighlightManager extends EventTarget {
  constructor(options = {}) {
    super();

    this.highlights = [];
    this.duration = options.duration || 0;  // 영상 총 길이
    this.fps = options.fps || 24;

    log.info('HighlightManager 초기화됨');
  }

  /**
   * 영상 정보 설정
   */
  setVideoInfo(duration, fps) {
    this.duration = duration;
    this.fps = fps;
    log.debug('영상 정보 설정', { duration, fps });
  }

  /**
   * 새 하이라이트 생성
   * @param {number} currentTime - 현재 시간 (초)
   * @returns {Highlight}
   */
  createHighlight(currentTime) {
    const startTime = currentTime;
    const endTime = Math.min(currentTime + DEFAULT_HIGHLIGHT_DURATION, this.duration);

    const highlight = new Highlight({
      startTime,
      endTime,
      colorKey: 'yellow'
    });

    this.highlights.push(highlight);
    this._sortHighlights();

    log.info('하이라이트 생성됨', { id: highlight.id, startTime, endTime });
    this._emit('highlightCreated', { highlight });
    this._emit('changed');

    return highlight;
  }

  /**
   * 하이라이트 업데이트
   * @param {string} id - 하이라이트 ID
   * @param {object} updates - 업데이트할 속성
   */
  updateHighlight(id, updates) {
    const highlight = this.getHighlight(id);
    if (!highlight) {
      log.warn('하이라이트를 찾을 수 없음', { id });
      return null;
    }

    // 시간 유효성 검사
    if (updates.startTime !== undefined) {
      updates.startTime = Math.max(0, updates.startTime);
    }
    if (updates.endTime !== undefined) {
      updates.endTime = Math.min(this.duration, updates.endTime);
    }

    // startTime이 endTime보다 크면 스왑
    const newStart = updates.startTime ?? highlight.startTime;
    const newEnd = updates.endTime ?? highlight.endTime;
    if (newStart > newEnd) {
      updates.startTime = newEnd;
      updates.endTime = newStart;
    }

    // 업데이트 적용
    Object.assign(highlight, updates);
    highlight.modifiedAt = new Date().toISOString();

    this._sortHighlights();

    log.debug('하이라이트 업데이트됨', { id, updates });
    this._emit('highlightUpdated', { highlight });
    this._emit('changed');

    return highlight;
  }

  /**
   * 하이라이트 삭제
   * @param {string} id
   */
  deleteHighlight(id) {
    const index = this.highlights.findIndex(h => h.id === id);
    if (index === -1) {
      log.warn('삭제할 하이라이트를 찾을 수 없음', { id });
      return false;
    }

    const [removed] = this.highlights.splice(index, 1);

    log.info('하이라이트 삭제됨', { id });
    this._emit('highlightDeleted', { highlight: removed });
    this._emit('changed');

    return true;
  }

  /**
   * ID로 하이라이트 조회
   * @param {string} id
   * @returns {Highlight|null}
   */
  getHighlight(id) {
    return this.highlights.find(h => h.id === id) || null;
  }

  /**
   * 모든 하이라이트 반환
   * @returns {Highlight[]}
   */
  getAllHighlights() {
    return [...this.highlights];
  }

  /**
   * 특정 시간에 있는 하이라이트 조회
   * @param {number} time - 시간 (초)
   * @returns {Highlight[]}
   */
  getHighlightsAtTime(time) {
    return this.highlights.filter(h => time >= h.startTime && time <= h.endTime);
  }

  /**
   * 하이라이트 존재 여부
   * @returns {boolean}
   */
  hasHighlights() {
    return this.highlights.length > 0;
  }

  /**
   * 모든 하이라이트 초기화
   */
  clear() {
    this.highlights = [];
    Highlight.resetNextId();

    log.info('모든 하이라이트 초기화됨');
    this._emit('cleared');
    this._emit('changed');
  }

  /**
   * 초기화 (새 파일 로드 시)
   */
  reset() {
    this.clear();
    this.duration = 0;
    this.fps = 24;
  }

  /**
   * 시간순 정렬
   */
  _sortHighlights() {
    this.highlights.sort((a, b) => a.startTime - b.startTime);
  }

  /**
   * JSON 직렬화 (저장용)
   */
  toJSON() {
    return {
      highlights: this.highlights.map(h => h.toJSON())
    };
  }

  /**
   * JSON에서 복원 (로드용)
   * @param {object} data
   */
  fromJSON(data) {
    if (!data || !data.highlights) {
      log.debug('하이라이트 데이터 없음');
      return;
    }

    this.highlights = data.highlights.map(h => Highlight.fromJSON(h));
    Highlight.updateNextIdFromHighlights(this.highlights);
    this._sortHighlights();

    log.info('하이라이트 데이터 로드됨', { count: this.highlights.length });
    this._emit('loaded');
    this._emit('changed');
  }

  /**
   * 이벤트 발생
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export default HighlightManager;
