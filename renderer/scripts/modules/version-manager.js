/**
 * 버전 관리 모듈
 * 폴더 스캔, 버전 목록 관리, 버전 전환 지원
 *
 * @module version-manager
 */

import { createLogger } from '../logger.js';
import { parseVersion, isSameSeries, sortByVersion } from './version-parser.js';

const log = createLogger('VersionManager');

/**
 * 버전 관리자 클래스
 */
export class VersionManager extends EventTarget {
  constructor() {
    super();

    // 현재 상태
    this._currentFilePath = null;
    this._baseName = null;
    this._currentVersion = null;
    this._versions = [];
    this._manualVersions = [];

    // 스캔 상태
    this._isScanning = false;
    this._lastScanTime = null;

    log.info('VersionManager 초기화됨');
  }

  /**
   * 현재 파일 설정 및 버전 스캔
   * @param {string} filePath - 현재 파일 경로
   * @returns {Promise<Object>} 버전 스캔 결과
   */
  async setCurrentFile(filePath) {
    if (!filePath) {
      log.warn('파일 경로가 없음');
      return null;
    }

    this._currentFilePath = filePath;

    // 버전 정보 파싱
    const fileName = this._extractFileName(filePath);
    const versionInfo = parseVersion(fileName);

    this._currentVersion = versionInfo.version;
    this._baseName = versionInfo.baseName;

    log.info('현재 파일 설정', {
      filePath,
      baseName: this._baseName,
      currentVersion: this._currentVersion
    });

    // 폴더 스캔
    await this.scanVersions();

    return {
      baseName: this._baseName,
      currentVersion: this._currentVersion,
      versions: this._versions
    };
  }

  /**
   * 같은 폴더에서 버전 파일 스캔
   * @returns {Promise<Array>} 버전 목록
   */
  async scanVersions() {
    if (!this._currentFilePath) {
      log.warn('현재 파일이 설정되지 않음');
      return [];
    }

    if (this._isScanning) {
      log.info('이미 스캔 중');
      return this._versions;
    }

    this._isScanning = true;
    this._emit('scanStart');

    try {
      log.info('버전 스캔 시작', { filePath: this._currentFilePath });

      const result = await window.electronAPI.scanVersions(this._currentFilePath);

      this._baseName = result.baseName;
      this._currentVersion = result.currentVersion;
      this._versions = result.versions;
      this._lastScanTime = new Date();

      log.info('버전 스캔 완료', {
        baseName: this._baseName,
        currentVersion: this._currentVersion,
        count: this._versions.length
      });

      this._emit('scanComplete', {
        baseName: this._baseName,
        currentVersion: this._currentVersion,
        versions: this._versions
      });

      return this._versions;
    } catch (error) {
      log.error('버전 스캔 실패', error);
      this._emit('scanError', { error });
      return [];
    } finally {
      this._isScanning = false;
    }
  }

  /**
   * 수동 버전 추가
   * @param {Object} versionData - { version, fileName, filePath }
   */
  addManualVersion(versionData) {
    const existing = this._manualVersions.find(
      (v) => v.filePath === versionData.filePath
    );

    if (existing) {
      log.warn('이미 추가된 버전', { filePath: versionData.filePath });
      return false;
    }

    this._manualVersions.push({
      ...versionData,
      isManual: true,
      addedAt: new Date().toISOString()
    });

    log.info('수동 버전 추가됨', versionData);
    this._emit('manualVersionAdded', { version: versionData });

    return true;
  }

  /**
   * 수동 버전 제거
   * @param {string} filePath - 제거할 버전의 파일 경로
   */
  removeManualVersion(filePath) {
    const index = this._manualVersions.findIndex((v) => v.filePath === filePath);

    if (index === -1) {
      log.warn('찾을 수 없는 수동 버전', { filePath });
      return false;
    }

    const removed = this._manualVersions.splice(index, 1)[0];
    log.info('수동 버전 제거됨', removed);
    this._emit('manualVersionRemoved', { version: removed });

    return true;
  }

  /**
   * 전체 버전 목록 (스캔된 버전 + 수동 버전)
   * @returns {Array}
   */
  getAllVersions() {
    // 스캔된 버전과 수동 버전 병합
    const allVersions = [...this._versions];

    for (const manual of this._manualVersions) {
      // 중복 확인
      const exists = allVersions.some((v) => v.path === manual.filePath);
      if (!exists) {
        allVersions.push({
          version: manual.version,
          fileName: manual.fileName,
          path: manual.filePath,
          displayLabel: `v${manual.version}`,
          isManual: true
        });
      }
    }

    // 버전순 정렬
    return allVersions.sort((a, b) => {
      const vA = a.version ?? -1;
      const vB = b.version ?? -1;
      return vA - vB;
    });
  }

  /**
   * 특정 버전 정보 가져오기
   * @param {number} version - 버전 번호
   * @returns {Object|null}
   */
  getVersion(version) {
    return this.getAllVersions().find((v) => v.version === version) || null;
  }

  /**
   * 현재 버전 정보
   * @returns {Object|null}
   */
  getCurrentVersion() {
    if (this._currentVersion === null) return null;
    return this.getVersion(this._currentVersion);
  }

  /**
   * 다음 버전 가져오기
   * @returns {Object|null}
   */
  getNextVersion() {
    const all = this.getAllVersions();
    const currentIndex = all.findIndex((v) => v.version === this._currentVersion);

    if (currentIndex === -1 || currentIndex >= all.length - 1) {
      return null;
    }

    return all[currentIndex + 1];
  }

  /**
   * 이전 버전 가져오기
   * @returns {Object|null}
   */
  getPreviousVersion() {
    const all = this.getAllVersions();
    const currentIndex = all.findIndex((v) => v.version === this._currentVersion);

    if (currentIndex <= 0) {
      return null;
    }

    return all[currentIndex - 1];
  }

  /**
   * 버전이 여러 개인지 확인
   * @returns {boolean}
   */
  hasMultipleVersions() {
    return this.getAllVersions().length > 1;
  }

  /**
   * 현재 상태 가져오기
   * @returns {Object}
   */
  getState() {
    return {
      currentFilePath: this._currentFilePath,
      baseName: this._baseName,
      currentVersion: this._currentVersion,
      versions: this._versions,
      manualVersions: this._manualVersions,
      isScanning: this._isScanning,
      lastScanTime: this._lastScanTime
    };
  }

  /**
   * 수동 버전 목록 설정 (복원용)
   * @param {Array} manualVersions
   */
  setManualVersions(manualVersions) {
    this._manualVersions = manualVersions || [];
    log.info('수동 버전 목록 설정됨', { count: this._manualVersions.length });
  }

  /**
   * 수동 버전 목록 가져오기
   * @returns {Array}
   */
  getManualVersions() {
    return [...this._manualVersions];
  }

  /**
   * 초기화
   */
  reset() {
    this._currentFilePath = null;
    this._baseName = null;
    this._currentVersion = null;
    this._versions = [];
    this._manualVersions = [];
    this._isScanning = false;
    this._lastScanTime = null;

    log.info('VersionManager 초기화됨');
    this._emit('reset');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

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

  /**
   * 이벤트 발생
   * @param {string} type
   * @param {Object} detail
   */
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * VersionManager 싱글톤 가져오기
 * @returns {VersionManager}
 */
export function getVersionManager() {
  if (!instance) {
    instance = new VersionManager();
  }
  return instance;
}

export default VersionManager;
