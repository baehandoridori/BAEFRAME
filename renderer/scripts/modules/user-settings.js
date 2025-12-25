/**
 * baeframe - User Settings Module
 * 사용자 설정 및 Slack 연동 관리
 */

import { createLogger } from '../logger.js';

const log = createLogger('UserSettings');

// 로컬 스토리지 키
const STORAGE_KEY = 'baeframe_user_settings';

/**
 * User Settings Manager
 */
export class UserSettings extends EventTarget {
  constructor() {
    super();

    this.settings = {
      userName: null,
      userSource: null, // 'slack', 'os', 'manual', 'anonymous'
      slackUserId: null,
      slackWorkspace: null
    };

    this._loadFromStorage();
  }

  /**
   * 로컬 스토리지에서 설정 로드
   */
  _loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.settings = { ...this.settings, ...parsed };
        log.info('설정 로드됨', { userName: this.settings.userName, source: this.settings.userSource });
      }
    } catch (error) {
      log.warn('설정 로드 실패', error);
    }
  }

  /**
   * 로컬 스토리지에 설정 저장
   */
  _saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      log.info('설정 저장됨');
    } catch (error) {
      log.error('설정 저장 실패', error);
    }
  }

  /**
   * 사용자 이름 초기화 (자동 감지 시도)
   */
  async initialize() {
    // 이미 설정된 이름이 있으면 스킵
    if (this.settings.userName && this.settings.userSource !== 'anonymous') {
      log.info('기존 사용자 이름 사용', { userName: this.settings.userName });
      return this.settings.userName;
    }

    // 1. Slack에서 사용자 정보 가져오기 시도
    const slackUser = await this._tryGetSlackUser();
    if (slackUser) {
      this.settings.userName = slackUser.name;
      this.settings.userSource = 'slack';
      this.settings.slackUserId = slackUser.id;
      this.settings.slackWorkspace = slackUser.workspace;
      this._saveToStorage();
      log.info('Slack에서 사용자 감지됨', { userName: slackUser.name });
      this._emit('userDetected', { userName: slackUser.name, source: 'slack' });
      return slackUser.name;
    }

    // 2. OS 사용자 이름 가져오기 시도
    const osUser = await this._tryGetOSUser();
    if (osUser) {
      this.settings.userName = osUser;
      this.settings.userSource = 'os';
      this._saveToStorage();
      log.info('OS에서 사용자 감지됨', { userName: osUser });
      this._emit('userDetected', { userName: osUser, source: 'os' });
      return osUser;
    }

    // 3. 익명으로 설정
    this.settings.userName = '익명';
    this.settings.userSource = 'anonymous';
    this._saveToStorage();
    log.info('익명 사용자로 설정됨');
    this._emit('userDetected', { userName: '익명', source: 'anonymous' });
    return '익명';
  }

  /**
   * Slack 로컬 데이터에서 사용자 정보 읽기 시도
   */
  async _tryGetSlackUser() {
    try {
      // Main 프로세스에 Slack 사용자 정보 요청
      if (window.electronAPI?.getSlackUser) {
        const slackUser = await window.electronAPI.getSlackUser();
        if (slackUser && slackUser.name) {
          return slackUser;
        }
      }
    } catch (error) {
      log.debug('Slack 사용자 감지 실패', error);
    }
    return null;
  }

  /**
   * OS 사용자 이름 가져오기
   */
  async _tryGetOSUser() {
    try {
      if (window.electronAPI?.getOSUser) {
        const osUser = await window.electronAPI.getOSUser();
        if (osUser) {
          return osUser;
        }
      }
    } catch (error) {
      log.debug('OS 사용자 감지 실패', error);
    }
    return null;
  }

  /**
   * 사용자 이름 가져오기
   */
  getUserName() {
    return this.settings.userName || '익명';
  }

  /**
   * 사용자 이름 수동 설정
   */
  setUserName(name) {
    if (name && name.trim()) {
      this.settings.userName = name.trim();
      this.settings.userSource = 'manual';
      this._saveToStorage();
      this._emit('userNameChanged', { userName: this.settings.userName });
      log.info('사용자 이름 수동 설정됨', { userName: this.settings.userName });
      return true;
    }
    return false;
  }

  /**
   * Slack 연동 상태 확인
   */
  isSlackConnected() {
    return this.settings.userSource === 'slack' && this.settings.slackUserId;
  }

  /**
   * 사용자 소스 가져오기
   */
  getUserSource() {
    return this.settings.userSource;
  }

  /**
   * 사용자 정보 초기화 (다시 감지)
   */
  async resetAndDetect() {
    this.settings = {
      userName: null,
      userSource: null,
      slackUserId: null,
      slackWorkspace: null
    };
    this._saveToStorage();
    return await this.initialize();
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// 싱글톤 인스턴스
let instance = null;

export function getUserSettings() {
  if (!instance) {
    instance = new UserSettings();
  }
  return instance;
}

export default UserSettings;
