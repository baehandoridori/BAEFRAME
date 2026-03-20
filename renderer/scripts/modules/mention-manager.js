/**
 * baeframe - Mention Manager Module
 * @멘션 자동완성 드롭다운 기능
 */

import { createLogger } from '../logger.js';
import { TEAM_MEMBERS } from './team-members.js';

const log = createLogger('MentionManager');

let instance = null;

/**
 * 멘션 자동완성 매니저
 */
export class MentionManager {
  constructor() {
    this._attachedElements = new Map(); // element → { handlers, type }
    this._dropdown = null;
    this._activeElement = null;
    this._activeIndex = 0;
    this._filteredMembers = [];
    this._mentionStart = -1; // @ 문자 시작 위치

    this._createDropdown();
  }

  /**
   * 드롭다운 DOM 생성 (한 번만)
   */
  _createDropdown() {
    this._dropdown = document.createElement('div');
    this._dropdown.className = 'mention-dropdown';
    this._dropdown.style.display = 'none';
    document.body.appendChild(this._dropdown);

    // 클릭 이벤트 위임
    this._dropdown.addEventListener('mousedown', (e) => {
      e.preventDefault(); // blur 방지
      const item = e.target.closest('.mention-item');
      if (item) {
        const index = parseInt(item.dataset.index, 10);
        this._selectMember(index);
      }
    });
  }

  /**
   * 요소에 멘션 기능 부착
   * @param {HTMLElement} element - textarea 또는 contenteditable 요소
   */
  attach(element) {
    if (this._attachedElements.has(element)) return;

    const isContentEditable = element.getAttribute('contenteditable') === 'true';
    const type = isContentEditable ? 'contenteditable' : 'textarea';

    const onInput = () => this._handleInput(element, type);
    const onKeyDown = (e) => this._handleKeyDown(e, element, type);
    const onBlur = () => {
      // 약간의 지연: 드롭다운 클릭이 blur보다 먼저 처리되도록
      setTimeout(() => this.hide(), 150);
    };

    element.addEventListener('input', onInput);
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('blur', onBlur);

    this._attachedElements.set(element, { handlers: { onInput, onKeyDown, onBlur }, type });
  }

  /**
   * 요소에서 멘션 기능 해제
   * @param {HTMLElement} element
   */
  detach(element) {
    const entry = this._attachedElements.get(element);
    if (!entry) return;

    const { handlers } = entry;
    element.removeEventListener('input', handlers.onInput);
    element.removeEventListener('keydown', handlers.onKeyDown);
    element.removeEventListener('blur', handlers.onBlur);

    this._attachedElements.delete(element);

    if (this._activeElement === element) {
      this.hide();
    }
  }

  /**
   * 입력 이벤트 처리
   */
  _handleInput(element, type) {
    const { text, cursorPos } = this._getTextAndCursor(element, type);
    if (cursorPos < 0) {
      this.hide();
      return;
    }

    // 커서 앞에서 @ 찾기
    const beforeCursor = text.substring(0, cursorPos);
    const atIndex = beforeCursor.lastIndexOf('@');

    if (atIndex < 0) {
      this.hide();
      return;
    }

    // @ 앞이 공백이거나 텍스트 시작이어야 유효한 멘션
    if (atIndex > 0 && !/\s/.test(beforeCursor[atIndex - 1])) {
      this.hide();
      return;
    }

    // @ 뒤의 검색어
    const query = beforeCursor.substring(atIndex + 1);

    // 공백이 포함되면 멘션이 아님 (이름에 공백 없음)
    if (/\s/.test(query)) {
      this.hide();
      return;
    }

    this._mentionStart = atIndex;
    this._activeElement = element;

    // 필터링
    this._filteredMembers = query
      ? TEAM_MEMBERS.filter(m => m.name.includes(query))
      : [...TEAM_MEMBERS];

    if (this._filteredMembers.length === 0) {
      this.hide();
      return;
    }

    this._activeIndex = 0;
    this._renderDropdown();
    this._positionDropdown(element, type, atIndex);
  }

  /**
   * 키보드 이벤트 처리
   */
  _handleKeyDown(e, element, type) {
    if (this._dropdown.style.display === 'none') return;
    if (this._activeElement !== element) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        this._activeIndex = (this._activeIndex + 1) % this._filteredMembers.length;
        this._renderDropdown();
        break;

      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        this._activeIndex = (this._activeIndex - 1 + this._filteredMembers.length) % this._filteredMembers.length;
        this._renderDropdown();
        break;

      case 'Enter':
        if (this._filteredMembers.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._selectMember(this._activeIndex);
        }
        break;

      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.hide();
        break;

      case 'Tab':
        if (this._filteredMembers.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          this._selectMember(this._activeIndex);
        }
        break;
    }
  }

  /**
   * 텍스트와 커서 위치 가져오기
   */
  _getTextAndCursor(element, type) {
    if (type === 'textarea') {
      return {
        text: element.value,
        cursorPos: element.selectionStart
      };
    }

    // contenteditable
    const sel = window.getSelection();
    if (!sel.rangeCount || !element.contains(sel.anchorNode)) {
      return { text: '', cursorPos: -1 };
    }

    const text = element.textContent || '';
    // anchorNode 내에서의 offset을 전체 텍스트 내 위치로 변환
    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    const cursorPos = range.toString().length;

    return { text, cursorPos };
  }

  /**
   * 드롭다운 렌더링
   */
  _renderDropdown() {
    this._dropdown.innerHTML = this._filteredMembers.map((member, i) => `
      <div class="mention-item ${i === this._activeIndex ? 'active' : ''}" data-index="${i}">
        <span class="mention-item-name">${this._escapeHtml(member.name)}</span>
      </div>
    `).join('');

    this._dropdown.style.display = 'block';

    // 활성 항목 스크롤
    const activeItem = this._dropdown.querySelector('.mention-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * 드롭다운 위치 계산
   */
  _positionDropdown(element, type, atIndex) {
    const rect = element.getBoundingClientRect();
    let left, top;

    if (type === 'textarea') {
      // textarea: 요소 좌하단 기준
      left = rect.left;
      top = rect.bottom + 4;
    } else {
      // contenteditable: 커서 위치 기준
      const sel = window.getSelection();
      if (sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const cursorRect = range.getBoundingClientRect();
        left = cursorRect.left;
        top = cursorRect.bottom + 4;
      } else {
        left = rect.left;
        top = rect.bottom + 4;
      }
    }

    // 뷰포트 경계 처리
    const dropdownWidth = 200;
    const dropdownHeight = Math.min(this._filteredMembers.length * 36, 200);

    if (left + dropdownWidth > window.innerWidth) {
      left = window.innerWidth - dropdownWidth - 8;
    }

    if (top + dropdownHeight > window.innerHeight) {
      // 위쪽으로 표시
      top = (type === 'textarea' ? rect.top : top - 8) - dropdownHeight - 4;
    }

    this._dropdown.style.left = `${Math.max(0, left)}px`;
    this._dropdown.style.top = `${Math.max(0, top)}px`;
  }

  /**
   * 멤버 선택 → 텍스트 삽입
   */
  _selectMember(index) {
    const member = this._filteredMembers[index];
    if (!member || !this._activeElement) return;

    const entry = this._attachedElements.get(this._activeElement);
    if (!entry) return;

    const replacement = `@${member.name} `;

    if (entry.type === 'textarea') {
      this._insertIntoTextarea(this._activeElement, replacement);
    } else {
      this._insertIntoContentEditable(this._activeElement, replacement);
    }

    this.hide();
  }

  /**
   * textarea에 텍스트 삽입
   */
  _insertIntoTextarea(textarea, replacement) {
    const text = textarea.value;
    const cursorPos = textarea.selectionStart;
    const before = text.substring(0, this._mentionStart);
    const after = text.substring(cursorPos);

    textarea.value = before + replacement + after;
    const newPos = before.length + replacement.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();

    // input 이벤트 발생시켜 외부 리스너에 알림
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * contenteditable에 텍스트 삽입
   */
  _insertIntoContentEditable(element, replacement) {
    const text = element.textContent || '';
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    // 전체 텍스트에서 @부터 커서까지 교체
    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    const beforeCursorLen = range.toString().length;

    // textContent 기반으로 교체
    const before = text.substring(0, this._mentionStart);
    const after = text.substring(beforeCursorLen);
    element.textContent = before + replacement + after;

    // 커서를 삽입 텍스트 끝으로 이동
    const newRange = document.createRange();
    const textNode = element.firstChild;
    if (textNode) {
      const newPos = before.length + replacement.length;
      newRange.setStart(textNode, Math.min(newPos, textNode.length));
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    }

    element.focus();
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * 드롭다운이 현재 표시 중인지 여부
   */
  get isVisible() {
    return this._dropdown && this._dropdown.style.display !== 'none';
  }

  /**
   * 드롭다운 숨기기
   */
  hide() {
    if (this._dropdown) {
      this._dropdown.style.display = 'none';
    }
    this._activeElement = null;
    this._mentionStart = -1;
    this._filteredMembers = [];
  }

  /**
   * XSS 방지용 이스케이프
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 텍스트에서 @멘션된 이름 추출
   * @param {string} text - 파싱할 텍스트
   * @returns {string[]} 멘션된 이름 배열 (TEAM_MEMBERS에 존재하는 이름만)
   */
  static parseMentions(text) {
    if (!text) return [];

    const mentions = [];
    // @이름 패턴 매칭 (유니코드 문자 지원)
    const regex = /@([\p{L}\p{N}]+)/gu;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      if (TEAM_MEMBERS.some(m => m.name === name)) {
        mentions.push(name);
      }
    }

    // 중복 제거
    return [...new Set(mentions)];
  }

  /**
   * 파괴
   */
  destroy() {
    for (const element of this._attachedElements.keys()) {
      this.detach(element);
    }
    if (this._dropdown && this._dropdown.parentNode) {
      this._dropdown.parentNode.removeChild(this._dropdown);
    }
    this._dropdown = null;
    instance = null;
  }
}

/**
 * 싱글턴 인스턴스 반환
 * @returns {MentionManager}
 */
export function getMentionManager() {
  if (!instance) {
    instance = new MentionManager();
  }
  return instance;
}
