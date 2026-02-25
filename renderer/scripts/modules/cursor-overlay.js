/**
 * BAEFRAME - Cursor Overlay
 * Figma 스타일 다중 커서 오버레이
 *
 * 비디오 플레이어 위에 다른 협업자의 커서를 실시간 표시
 * normalized 좌표 (0~1)를 사용하여 해상도 무관하게 동작
 *
 * @version 1.0
 */

import { createLogger } from '../logger.js';

const log = createLogger('CursorOverlay');

// 상수
const CURSOR_IDLE_TIMEOUT = 3000;  // 3초 미움직임 → idle
const CURSOR_HIDE_TIMEOUT = 10000; // 10초 미움직임 → 숨김

/**
 * 커서 오버레이 관리자
 */
export class CursorOverlay {
  /**
   * @param {HTMLElement} videoWrapper - #videoWrapper DOM 요소
   * @param {Function} getVideoRenderArea - 비디오 실제 렌더링 영역 반환 함수
   */
  constructor(videoWrapper, getVideoRenderArea) {
    this.videoWrapper = videoWrapper;
    this.getVideoRenderArea = getVideoRenderArea;
    this.container = null;
    this.cursors = new Map();  // sessionId → { element, nameLabel, lastUpdate, idleTimer, hideTimer }
    this._init();
  }

  /**
   * 오버레이 컨테이너 초기화
   * @private
   */
  _init() {
    this.container = document.createElement('div');
    this.container.className = 'cursor-overlay-container';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 5;
      overflow: hidden;
    `;
    this.videoWrapper.appendChild(this.container);
    log.info('커서 오버레이 초기화됨');
  }

  /**
   * 커서 위치 업데이트
   * @param {string} sessionId - 피어 세션 ID
   * @param {Object} data - { x, y, name, color } (x, y는 normalized 0~1)
   */
  updateCursor(sessionId, { x, y, name, color }) {
    let cursor = this.cursors.get(sessionId);

    if (!cursor) {
      cursor = this._createCursorElement(sessionId, name, color);
      this.cursors.set(sessionId, cursor);
    }

    // 비디오 렌더 영역으로 좌표 변환
    const area = this.getVideoRenderArea ? this.getVideoRenderArea() : null;
    if (!area) return;

    const pixelX = area.left + x * area.width;
    const pixelY = area.top + y * area.height;

    cursor.element.style.transform = `translate(${pixelX}px, ${pixelY}px)`;
    cursor.element.style.display = '';
    cursor.lastUpdate = Date.now();

    // idle 상태 해제
    cursor.element.classList.remove('idle', 'hidden');

    // idle 타이머 리셋
    clearTimeout(cursor.idleTimer);
    clearTimeout(cursor.hideTimer);

    cursor.idleTimer = setTimeout(() => {
      cursor.element.classList.add('idle');
    }, CURSOR_IDLE_TIMEOUT);

    cursor.hideTimer = setTimeout(() => {
      cursor.element.classList.add('hidden');
    }, CURSOR_HIDE_TIMEOUT);
  }

  /**
   * 커서 DOM 요소 생성
   * @private
   */
  _createCursorElement(sessionId, name, color) {
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    el.dataset.sessionId = sessionId;

    el.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="${color}" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
        <path d="M0 0L16 6L8 8L6 16Z"/>
      </svg>
      <span class="cursor-label" style="background:${color}">${name || '?'}</span>
    `;

    this.container.appendChild(el);

    return {
      element: el,
      lastUpdate: Date.now(),
      idleTimer: null,
      hideTimer: null
    };
  }

  /**
   * 커서 제거 (참가자 이탈)
   * @param {string} sessionId
   */
  removeCursor(sessionId) {
    const cursor = this.cursors.get(sessionId);
    if (cursor) {
      clearTimeout(cursor.idleTimer);
      clearTimeout(cursor.hideTimer);
      cursor.element.remove();
      this.cursors.delete(sessionId);
    }
  }

  /**
   * 전체 정리
   */
  destroy() {
    for (const [sessionId] of this.cursors) {
      this.removeCursor(sessionId);
    }
    if (this.container && this.container.parentNode) {
      this.container.remove();
    }
    this.container = null;
  }
}
