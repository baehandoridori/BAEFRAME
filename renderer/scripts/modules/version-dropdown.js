/**
 * 버전 드롭다운 UI 모듈
 * 버전 목록 표시, 선택, 수동 버전 추가 등 UI 처리
 *
 * @module version-dropdown
 */

import { createLogger } from '../logger.js';
import { getVersionManager } from './version-manager.js';

const log = createLogger('VersionDropdown');

/**
 * 버전 드롭다운 UI 컨트롤러
 */
export class VersionDropdown {
  constructor() {
    // DOM Elements
    this._container = null;
    this._trigger = null;
    this._menu = null;
    this._list = null;
    this._countBadge = null;
    this._badgeLabel = null;

    // State
    this._isOpen = false;
    this._currentVersion = null;

    // Callbacks
    this._onVersionSelect = null;

    // VersionManager 참조
    this._versionManager = getVersionManager();

    log.info('VersionDropdown 초기화됨');
  }

  /**
   * DOM 초기화
   */
  init() {
    // DOM 요소 찾기
    this._container = document.getElementById('versionDropdown');
    this._trigger = document.getElementById('versionDropdownTrigger');
    this._menu = document.getElementById('versionDropdownMenu');
    this._list = document.getElementById('versionList');
    this._countBadge = document.getElementById('versionCount');
    this._badgeLabel = document.getElementById('versionBadge');

    if (!this._container || !this._trigger || !this._menu) {
      log.error('필수 DOM 요소를 찾을 수 없음');
      return false;
    }

    // 이벤트 바인딩
    this._bindEvents();

    // VersionManager 이벤트 연결
    this._bindVersionManagerEvents();

    log.info('VersionDropdown DOM 초기화 완료');
    return true;
  }

  /**
   * 이벤트 바인딩
   */
  _bindEvents() {
    // 트리거 클릭 - 토글
    this._trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // 메뉴 클릭 - 버블링 방지
    this._menu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // 바깥 클릭 - 닫기
    document.addEventListener('click', (e) => {
      if (this._isOpen && !this._container.contains(e.target)) {
        this.close();
      }
    });

    // ESC 키 - 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen) {
        this.close();
      }
    });

    // 수동 버전 추가 버튼
    const btnAddManual = document.getElementById('btnAddManualVersion');
    if (btnAddManual) {
      btnAddManual.addEventListener('click', () => {
        this._handleAddManualVersion();
      });
    }

    // 다시 스캔 버튼
    const btnRescan = document.getElementById('btnRescanVersions');
    if (btnRescan) {
      btnRescan.addEventListener('click', () => {
        this._handleRescan();
      });
    }
  }

  /**
   * VersionManager 이벤트 연결
   */
  _bindVersionManagerEvents() {
    this._versionManager.addEventListener('scanStart', () => {
      this._showLoading();
    });

    this._versionManager.addEventListener('scanComplete', (e) => {
      this._render();
    });

    this._versionManager.addEventListener('scanError', (e) => {
      this._showError(e.detail?.error?.message || '스캔 실패');
    });

    this._versionManager.addEventListener('manualVersionAdded', () => {
      this._render();
    });

    this._versionManager.addEventListener('manualVersionRemoved', () => {
      this._render();
    });
  }

  /**
   * 드롭다운 열기
   */
  open() {
    if (this._isOpen) return;

    this._isOpen = true;
    this._container.classList.add('open');
    log.debug('드롭다운 열림');
  }

  /**
   * 드롭다운 닫기
   */
  close() {
    if (!this._isOpen) return;

    this._isOpen = false;
    this._container.classList.remove('open');
    log.debug('드롭다운 닫힘');
  }

  /**
   * 드롭다운 토글
   */
  toggle() {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * 드롭다운 표시
   * @param {number} currentVersion - 현재 버전
   */
  show(currentVersion = null) {
    this._currentVersion = currentVersion;
    this._container.style.display = '';
    this._updateBadgeLabel(currentVersion);
    this._render();
    log.info('드롭다운 표시', { currentVersion });
  }

  /**
   * 드롭다운 숨기기
   */
  hide() {
    this._container.style.display = 'none';
    this.close();
    log.info('드롭다운 숨김');
  }

  /**
   * 현재 버전 설정
   * @param {number} version
   */
  setCurrentVersion(version) {
    this._currentVersion = version;
    this._updateBadgeLabel(version);
    this._render();
  }

  /**
   * 버전 선택 콜백 설정
   * @param {Function} callback - (versionInfo) => void
   */
  onVersionSelect(callback) {
    this._onVersionSelect = callback;
  }

  /**
   * 목록 렌더링
   */
  _render() {
    const versions = this._versionManager.getAllVersions();
    const count = versions.length;

    // 카운트 배지 업데이트
    if (this._countBadge) {
      this._countBadge.textContent = count;
    }

    // 목록 비우기
    this._list.innerHTML = '';

    if (count === 0) {
      this._showEmpty();
      return;
    }

    // 버전 아이템 렌더링
    versions.forEach((v) => {
      const item = this._createVersionItem(v);
      this._list.appendChild(item);
    });

    log.debug('버전 목록 렌더링 완료', { count });
  }

  /**
   * 버전 아이템 요소 생성
   * @param {Object} versionInfo
   * @returns {HTMLElement}
   */
  _createVersionItem(versionInfo) {
    const item = document.createElement('div');
    item.className = 'version-item';

    // 현재 버전인지 확인
    const isCurrent = versionInfo.version === this._currentVersion;
    if (isCurrent) {
      item.classList.add('active');
    }

    // 아이콘
    const icon = document.createElement('div');
    icon.className = 'version-item-icon';
    icon.innerHTML = versionInfo.isManual
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      : '📦';

    // 정보
    const info = document.createElement('div');
    info.className = 'version-item-info';

    const label = document.createElement('div');
    label.className = 'version-item-label';
    label.textContent = versionInfo.displayLabel || `v${versionInfo.version}`;

    const filename = document.createElement('div');
    filename.className = 'version-item-filename';
    filename.textContent = versionInfo.fileName || '';
    filename.title = versionInfo.path || '';

    info.appendChild(label);
    info.appendChild(filename);

    // 배지
    const badge = document.createElement('div');
    badge.className = 'version-item-badge';

    if (isCurrent) {
      const currentBadge = document.createElement('span');
      currentBadge.className = 'version-item-current';
      currentBadge.textContent = '현재';
      badge.appendChild(currentBadge);
    }

    if (versionInfo.isManual) {
      const manualBadge = document.createElement('span');
      manualBadge.className = 'version-item-manual';
      manualBadge.textContent = '수동';
      badge.appendChild(manualBadge);

      // 삭제 버튼 (수동 버전만)
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'version-item-delete';
      deleteBtn.title = '제거';
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleRemoveManualVersion(versionInfo.path);
      });
      badge.appendChild(deleteBtn);
    }

    // 조립
    item.appendChild(icon);
    item.appendChild(info);
    item.appendChild(badge);

    // 클릭 이벤트 (현재 버전이 아닌 경우만)
    if (!isCurrent) {
      item.addEventListener('click', () => {
        this._handleVersionSelect(versionInfo);
      });
    }

    return item;
  }

  /**
   * 배지 라벨 업데이트
   * @param {number} version
   */
  _updateBadgeLabel(version) {
    if (this._badgeLabel) {
      if (version !== null && version !== undefined) {
        this._badgeLabel.textContent = `v${version}`;
      } else {
        this._badgeLabel.textContent = 'v?';
      }
    }
  }

  /**
   * 로딩 상태 표시
   */
  _showLoading() {
    this._list.innerHTML = `
      <div class="version-list-loading">
        <div class="spinner"></div>
        <span>버전 스캔 중...</span>
      </div>
    `;
  }

  /**
   * 빈 상태 표시
   */
  _showEmpty() {
    this._list.innerHTML = `
      <div class="version-list-empty">
        <div class="version-list-empty-icon">📁</div>
        <div class="version-list-empty-text">
          같은 폴더에서<br>버전 파일을 찾지 못했습니다
        </div>
      </div>
    `;
  }

  /**
   * 에러 표시
   * @param {string} message
   */
  _showError(message) {
    this._list.innerHTML = `
      <div class="version-list-empty">
        <div class="version-list-empty-icon">⚠️</div>
        <div class="version-list-empty-text">${message}</div>
      </div>
    `;
  }

  /**
   * 버전 선택 처리
   * @param {Object} versionInfo
   */
  _handleVersionSelect(versionInfo) {
    log.info('버전 선택됨', versionInfo);
    this.close();

    if (this._onVersionSelect) {
      this._onVersionSelect(versionInfo);
    }
  }

  /**
   * 수동 버전 추가 처리
   */
  async _handleAddManualVersion() {
    log.info('수동 버전 추가 요청');
    this.close();

    try {
      // 파일 선택 다이얼로그
      const result = await window.electronAPI.openFileDialog({
        title: '버전 파일 선택',
        filters: [
          { name: '비디오', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] },
          { name: '모든 파일', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result && result.length > 0) {
        const filePath = result[0];
        const fileName = this._extractFileName(filePath);

        // 버전 번호 입력 받기 (간단한 prompt 사용)
        const versionStr = prompt(
          `"${fileName}"의 버전 번호를 입력하세요:`,
          '1'
        );

        if (versionStr !== null) {
          const version = parseInt(versionStr, 10);

          if (!isNaN(version) && version > 0) {
            const added = this._versionManager.addManualVersion({
              version,
              fileName,
              filePath
            });

            if (added) {
              log.info('수동 버전 추가 성공', { version, fileName, filePath });
            }
          } else {
            alert('유효한 버전 번호를 입력해주세요 (1 이상의 숫자)');
          }
        }
      }
    } catch (error) {
      log.error('수동 버전 추가 실패', error);
    }
  }

  /**
   * 수동 버전 제거 처리
   * @param {string} filePath
   */
  _handleRemoveManualVersion(filePath) {
    if (confirm('이 수동 버전을 제거하시겠습니까?')) {
      this._versionManager.removeManualVersion(filePath);
    }
  }

  /**
   * 다시 스캔 처리
   */
  async _handleRescan() {
    log.info('버전 다시 스캔 요청');
    await this._versionManager.scanVersions();
  }

  /**
   * 파일 경로에서 파일명 추출
   * @param {string} filePath
   * @returns {string}
   */
  _extractFileName(filePath) {
    if (!filePath) return '';
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || '';
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * VersionDropdown 싱글톤 가져오기
 * @returns {VersionDropdown}
 */
export function getVersionDropdown() {
  if (!instance) {
    instance = new VersionDropdown();
  }
  return instance;
}

export default VersionDropdown;
