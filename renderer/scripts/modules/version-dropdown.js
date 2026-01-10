/**
 * 버전 드롭다운 UI 모듈
 * 버전 목록 표시, 선택, 수동 버전 추가 등 UI 처리
 *
 * @module version-dropdown
 */

import { createLogger } from '../logger.js';
import { getVersionManager } from './version-manager.js';

const log = createLogger('VersionDropdown');

// ReviewDataManager 참조 (외부에서 설정)
let reviewDataManagerRef = null;

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
   * ReviewDataManager 참조 설정 (저장 연동용)
   * @param {Object} reviewDataManager
   */
  setReviewDataManager(reviewDataManager) {
    reviewDataManagerRef = reviewDataManager;
    log.info('ReviewDataManager 연결됨');
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
    }

    // 버튼 컨테이너
    const btnContainer = document.createElement('div');
    btnContainer.className = 'version-item-actions';

    // 편집 버튼 (모든 버전)
    const editBtn = document.createElement('button');
    editBtn.className = 'version-item-edit';
    editBtn.title = '버전 번호 편집';
    editBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleEditVersion(versionInfo);
    });
    btnContainer.appendChild(editBtn);

    // 삭제 버튼 (수동 버전만)
    if (versionInfo.isManual) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'version-item-delete';
      deleteBtn.title = '제거';
      deleteBtn.innerHTML =
        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._handleRemoveManualVersion(versionInfo.path);
      });
      btnContainer.appendChild(deleteBtn);
    }

    badge.appendChild(btnContainer);

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
        // 버전 번호가 없으면 "버전" 으로 표시
        this._badgeLabel.textContent = '버전';
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

      // 디버깅: 결과 확인
      log.info('파일 다이얼로그 결과', result);
      console.log('[VersionDropdown] 파일 다이얼로그 결과:', result);

      if (!result) {
        log.warn('파일 다이얼로그 결과가 없음');
        return;
      }

      if (result.canceled) {
        log.info('파일 선택 취소됨');
        return;
      }

      if (!result.filePaths || result.filePaths.length === 0) {
        log.warn('선택된 파일이 없음', result);
        return;
      }

      const filePath = result.filePaths[0];
      const fileName = this._extractFileName(filePath);
      log.info('선택된 파일', { filePath, fileName });

      // 기존 버전 목록에서 다음 버전 번호 제안
      const allVersions = this._versionManager.getAllVersions();
      const maxVersion = allVersions.reduce(
        (max, v) => Math.max(max, v.version || 0),
        0
      );
      const suggestedVersion = maxVersion + 1;

      // 버전 번호 입력 받기 (간단한 prompt 사용)
      const versionStr = prompt(
        `"${fileName}"의 버전 번호를 입력하세요:`,
        String(suggestedVersion)
      );

      log.info('버전 번호 입력', { versionStr });

      if (versionStr === null) {
        log.info('버전 번호 입력 취소됨');
        return;
      }

      const version = parseInt(versionStr, 10);

      if (isNaN(version) || version <= 0) {
        alert('유효한 버전 번호를 입력해주세요 (1 이상의 숫자)');
        return;
      }

      // 중복 버전 번호 검증
      const existingVersion = allVersions.find((v) => v.version === version);
      if (existingVersion) {
        const retry = confirm(
          `버전 ${version}은(는) 이미 "${existingVersion.fileName}"에 할당되어 있습니다.\n다른 번호를 사용하시겠습니까?`
        );
        if (retry) {
          // 다시 입력 받도록 재귀 호출
          this._handleAddManualVersion();
        }
        return;
      }

      const manualVersionData = {
        version,
        fileName,
        filePath,
        addedAt: new Date().toISOString()
      };

      log.info('수동 버전 데이터 생성', manualVersionData);

      const added = this._versionManager.addManualVersion(manualVersionData);

      if (added) {
        log.info('수동 버전 추가 성공', { version, fileName, filePath });

        // ReviewDataManager에도 저장 (영구 저장)
        if (reviewDataManagerRef) {
          reviewDataManagerRef.addManualVersion(manualVersionData);
          log.info('수동 버전이 .bframe에 저장됨');
        }

        // 드롭다운 다시 열어서 결과 확인
        this._render();
        this.open();
      } else {
        log.warn('수동 버전 추가 실패 (이미 존재하는 파일)');
        alert('이미 추가된 파일입니다.');
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
      const removed = this._versionManager.removeManualVersion(filePath);

      if (removed && reviewDataManagerRef) {
        // ReviewDataManager에서도 제거 (영구 저장)
        reviewDataManagerRef.removeManualVersion(filePath);
        log.info('수동 버전이 .bframe에서 제거됨');
      }
    }
  }

  /**
   * 버전 번호 편집 처리
   * @param {Object} versionInfo
   */
  _handleEditVersion(versionInfo) {
    log.info('버전 편집 요청', versionInfo);

    const currentVersion = versionInfo.version;
    const fileName = versionInfo.fileName || '';

    // 새 버전 번호 입력
    const newVersionStr = prompt(
      `"${fileName}"의 버전 번호를 변경합니다.\n현재: v${currentVersion || '?'}\n\n새 버전 번호:`,
      String(currentVersion || 1)
    );

    if (newVersionStr === null) {
      log.info('버전 편집 취소됨');
      return;
    }

    const newVersion = parseInt(newVersionStr, 10);

    if (isNaN(newVersion) || newVersion <= 0) {
      alert('유효한 버전 번호를 입력해주세요 (1 이상의 숫자)');
      return;
    }

    if (newVersion === currentVersion) {
      log.info('버전 번호 변경 없음');
      return;
    }

    // 중복 버전 번호 검증
    const allVersions = this._versionManager.getAllVersions();
    const existingVersion = allVersions.find(
      (v) => v.version === newVersion && v.path !== versionInfo.path
    );

    if (existingVersion) {
      alert(
        `버전 ${newVersion}은(는) 이미 "${existingVersion.fileName}"에 할당되어 있습니다.`
      );
      return;
    }

    // 수동 버전인 경우 VersionManager에서 업데이트
    if (versionInfo.isManual) {
      // 기존 버전 제거 후 새 버전으로 추가
      this._versionManager.removeManualVersion(versionInfo.path);
      this._versionManager.addManualVersion({
        version: newVersion,
        fileName: versionInfo.fileName,
        filePath: versionInfo.path,
        addedAt: new Date().toISOString()
      });

      // ReviewDataManager에도 반영
      if (reviewDataManagerRef) {
        reviewDataManagerRef.removeManualVersion(versionInfo.path);
        reviewDataManagerRef.addManualVersion({
          version: newVersion,
          fileName: versionInfo.fileName,
          filePath: versionInfo.path,
          addedAt: new Date().toISOString()
        });
        log.info('수동 버전 번호가 .bframe에 업데이트됨', { oldVersion: currentVersion, newVersion });
      }
    } else {
      // 자동 스캔된 버전은 수동 버전으로 변환하여 저장
      // (원본 파일의 이름은 변경하지 않고, 오버라이드 정보만 저장)
      this._versionManager.addManualVersion({
        version: newVersion,
        fileName: versionInfo.fileName,
        filePath: versionInfo.path,
        addedAt: new Date().toISOString(),
        isOverride: true,
        originalVersion: currentVersion
      });

      if (reviewDataManagerRef) {
        reviewDataManagerRef.addManualVersion({
          version: newVersion,
          fileName: versionInfo.fileName,
          filePath: versionInfo.path,
          addedAt: new Date().toISOString(),
          isOverride: true,
          originalVersion: currentVersion
        });
        log.info('스캔 버전 오버라이드 저장됨', { originalVersion: currentVersion, newVersion });
      }
    }

    log.info('버전 번호 변경 완료', { oldVersion: currentVersion, newVersion });
    this._render();
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
