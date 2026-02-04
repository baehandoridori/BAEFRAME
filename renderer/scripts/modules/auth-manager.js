/**
 * baeframe - Auth Manager Module
 * 사용자 인증 및 세션 관리
 */

import { createLogger } from '../logger.js';

const log = createLogger('AuthManager');

// 테마 색상 정의
const AUTH_THEME_COLORS = {
  default: { name: '기본 (노랑)', color: '#ffd000' },
  red: { name: '빨강', color: '#ff5555' },
  blue: { name: '파랑', color: '#4a9eff' },
  pink: { name: '핑크', color: '#ffaaaa' },
  green: { name: '초록', color: '#2ed573' }
};

/**
 * Auth Manager
 * 인증 파일 기반 사용자 관리
 */
class AuthManager extends EventTarget {
  constructor() {
    super();

    this.authData = null;       // 전체 인증 데이터
    this.currentUser = null;    // 현재 로그인한 사용자 정보
    this.isAuthenticated = false;
    this._ready = false;
    this._authAvailable = false; // 인증 파일 접근 가능 여부
  }

  /**
   * 초기화 (앱 시작 시)
   */
  async init() {
    log.info('AuthManager 초기화 시작');
    await this._loadAuthData();
    this._ready = true;
    log.info('AuthManager 초기화 완료', {
      authAvailable: this._authAvailable,
      userCount: this.authData?.users?.length || 0
    });
  }

  /**
   * 초기화 완료 여부
   */
  isReady() {
    return this._ready;
  }

  /**
   * 인증 시스템 사용 가능 여부
   */
  isAuthAvailable() {
    return this._authAvailable;
  }

  /**
   * 사용자 등록 (새 팀원 추가)
   * @param {string} name - 사용자 이름
   * @param {string|null} theme - 테마 키
   */
  async registerUser(name, theme = null) {
    if (!name || !name.trim()) {
      throw new Error('이름을 입력해주세요');
    }

    const trimmedName = name.trim();

    // 중복 체크
    if (this._findUser(trimmedName)) {
      throw new Error('이미 등록된 사용자입니다');
    }

    const initialPassword = '1234';
    const hash = await this._hashPassword(initialPassword);

    if (!this.authData) {
      this.authData = { version: 1, users: [] };
    }

    this.authData.users.push({
      name: trimmedName,
      passwordHash: hash,
      theme: theme || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await this._saveAuthData();
    log.info('사용자 등록 완료', { name: trimmedName, theme });
    this._emit('userRegistered', { name: trimmedName, theme });
  }

  /**
   * 사용자 삭제
   * @param {string} name - 삭제할 사용자 이름
   */
  async deleteUser(name) {
    if (!this.authData?.users) {
      throw new Error('인증 데이터가 없습니다');
    }

    const index = this.authData.users.findIndex(u => u.name === name);
    if (index === -1) {
      throw new Error('등록되지 않은 사용자입니다');
    }

    this.authData.users.splice(index, 1);
    await this._saveAuthData();
    log.info('사용자 삭제 완료', { name });
    this._emit('userDeleted', { name });
  }

  /**
   * 로그인
   * @param {string} name - 사용자 이름
   * @param {string|null} password - 비밀번호 (보호 사용자만)
   * @returns {{ protected: boolean, theme: string|null }}
   */
  async login(name, password) {
    const trimmedName = name.trim();
    const user = this._findUser(trimmedName);

    // 보호된 사용자
    if (user) {
      if (!password) {
        throw new Error('비밀번호가 필요합니다');
      }

      const hash = await this._hashPassword(password);
      if (hash !== user.passwordHash) {
        throw new Error('비밀번호가 일치하지 않습니다');
      }

      this.currentUser = { name: user.name, protected: true, theme: user.theme };
      this.isAuthenticated = true;

      log.info('보호 사용자 로그인 성공', { name: user.name });
      this._emit('loginSuccess', { name: user.name, protected: true, theme: user.theme });
      return { protected: true, theme: user.theme };
    }

    // 비보호 사용자 (자유 사용)
    this.currentUser = { name: trimmedName, protected: false, theme: null };
    this.isAuthenticated = true;

    log.info('비보호 사용자 로그인', { name: trimmedName });
    this._emit('loginSuccess', { name: trimmedName, protected: false, theme: null });
    return { protected: false, theme: null };
  }

  /**
   * 로그아웃
   */
  logout() {
    const prevUser = this.currentUser?.name;
    this.currentUser = null;
    this.isAuthenticated = false;
    log.info('로그아웃', { prevUser });
    this._emit('logout', { prevUser });
  }

  /**
   * 비밀번호 변경
   * @param {string} oldPassword - 현재 비밀번호
   * @param {string} newPassword - 새 비밀번호
   */
  async changePassword(oldPassword, newPassword) {
    if (!this.currentUser?.name) {
      throw new Error('로그인이 필요합니다');
    }

    const user = this._findUser(this.currentUser.name);
    if (!user) {
      throw new Error('등록된 사용자가 아닙니다');
    }

    // 이전 비밀번호 확인
    const oldHash = await this._hashPassword(oldPassword);
    if (oldHash !== user.passwordHash) {
      throw new Error('현재 비밀번호가 일치하지 않습니다');
    }

    if (!newPassword || newPassword.length < 1) {
      throw new Error('새 비밀번호를 입력해주세요');
    }

    // 새 비밀번호 설정
    user.passwordHash = await this._hashPassword(newPassword);
    user.updatedAt = new Date().toISOString();

    await this._saveAuthData();
    log.info('비밀번호 변경 완료', { name: user.name });
    this._emit('passwordChanged', { name: user.name });
  }

  /**
   * 사용자 테마 변경
   * @param {string|null} theme - 테마 키
   */
  async changeTheme(theme) {
    if (!this.currentUser?.name) {
      throw new Error('로그인이 필요합니다');
    }

    const user = this._findUser(this.currentUser.name);
    if (!user) {
      // 비보호 사용자는 인증 파일에 테마 저장 불가
      return false;
    }

    user.theme = theme || null;
    user.updatedAt = new Date().toISOString();
    this.currentUser.theme = user.theme;

    await this._saveAuthData();
    log.info('테마 변경 완료', { name: user.name, theme });
    this._emit('themeChanged', { name: user.name, theme });
    return true;
  }

  /**
   * 등록된 사용자 목록 반환
   * @returns {Array<{ name: string, theme: string|null, createdAt: string }>}
   */
  getRegisteredUsers() {
    return (this.authData?.users || []).map(u => ({
      name: u.name,
      theme: u.theme,
      createdAt: u.createdAt
    }));
  }

  /**
   * 현재 사용자가 해당 코멘트/답글을 수정/삭제할 수 있는지
   * @param {{ author: string }} item - 코멘트 또는 답글 객체
   * @returns {boolean}
   */
  canEditComment(item) {
    if (!this.isAuthenticated || !this.currentUser?.name) return false;
    if (!item?.author) return false;
    return item.author.trim() === this.currentUser.name.trim();
  }

  /**
   * 사용자가 보호된 사용자인지 확인
   * @param {string} name - 사용자 이름
   * @returns {boolean}
   */
  isProtectedUser(name) {
    return !!this._findUser(name);
  }

  /**
   * 현재 로그인한 사용자가 보호 사용자인지
   * @returns {boolean}
   */
  isCurrentUserProtected() {
    return this.currentUser?.protected === true;
  }

  /**
   * 현재 사용자 이름 반환
   * @returns {string|null}
   */
  getCurrentUserName() {
    return this.currentUser?.name || null;
  }

  /**
   * 현재 사용자 테마 반환
   * @returns {string|null}
   */
  getCurrentUserTheme() {
    return this.currentUser?.theme || null;
  }

  /**
   * 테마 목록 반환
   */
  getThemeList() {
    return { ...AUTH_THEME_COLORS };
  }

  // === Private ===

  /**
   * SHA-256 해시 생성
   */
  async _hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'baeframe_salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * 이름으로 사용자 찾기
   */
  _findUser(name) {
    if (!this.authData?.users || !name) return null;
    return this.authData.users.find(u => u.name.trim() === name.trim());
  }

  /**
   * 인증 데이터 로드
   */
  async _loadAuthData() {
    try {
      if (!window.electronAPI?.loadAuthData) {
        log.warn('electronAPI.loadAuthData 사용 불가 (비보호 모드)');
        this._authAvailable = false;
        this.authData = { version: 1, users: [] };
        return;
      }

      const result = await window.electronAPI.loadAuthData();

      if (result.success) {
        this.authData = result.data || { version: 1, users: [] };
        this._authAvailable = true;
        log.info('인증 데이터 로드 성공', { userCount: this.authData.users?.length || 0 });
      } else {
        log.warn('인증 데이터 로드 실패', { error: result.error });
        this._authAvailable = false;
        this.authData = { version: 1, users: [] };
      }
    } catch (error) {
      log.error('인증 데이터 로드 오류', { error: error.message });
      this._authAvailable = false;
      this.authData = { version: 1, users: [] };
    }
  }

  /**
   * 인증 데이터 저장
   */
  async _saveAuthData() {
    try {
      if (!window.electronAPI?.saveAuthData) {
        log.warn('electronAPI.saveAuthData 사용 불가');
        return;
      }

      // 저장 전 최신 데이터 로드하여 머지 (동시 수정 대비)
      const freshResult = await window.electronAPI.loadAuthData();
      if (freshResult.success && freshResult.data) {
        // 나중에 저장한 사람이 이기는 방식 (심플)
        // 현재 authData를 그대로 저장
      }

      const result = await window.electronAPI.saveAuthData(this.authData);
      if (!result.success) {
        log.error('인증 데이터 저장 실패', { error: result.error });
      }
    } catch (error) {
      log.error('인증 데이터 저장 오류', { error: error.message });
    }
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

export function getAuthManager() {
  if (!instance) {
    instance = new AuthManager();
  }
  return instance;
}

export { AUTH_THEME_COLORS };
export default AuthManager;
