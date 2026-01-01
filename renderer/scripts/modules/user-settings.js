/**
 * baeframe - User Settings Module
 * 사용자 설정 및 Slack 연동 관리
 */

import { createLogger } from '../logger.js';

const log = createLogger('UserSettings');

// 로컬 스토리지 키
const STORAGE_KEY = 'baeframe_user_settings';

// 이름별 테마 매핑
const NAME_THEMES = {
  // 파란색 테마
  blue: ['윤성원', '성원', 'SW', 'sw'],
  // 보라-핑크 테마
  pink: ['허혜원', '혜원', '모몽가'],
  // 붉은색 테마
  red: ['한솔', '배한솔', '한솔쿤']
};

// 이름별 아바타 이미지 매핑 (특별 이벤트용)
const NAME_AVATARS = {
  hansol: {
    names: ['한솔', '배한솔', '한솔쿤'],
    image: 'assets/avatars/hansol.png'
  },
  hyewon: {
    names: ['허혜원', '혜원', '모몽가'],
    image: 'assets/avatars/hyewon.png'
  }
};

// 이름별 색상 매핑 (이름 표시용)
const NAME_COLORS = {
  red: {
    names: ['한솔', '배한솔', '한솔쿤'],
    color: '#ff5555'
  },
  blue: {
    names: ['윤성원', '성원', 'SW', 'sw'],
    color: '#4a9eff'
  },
  pink: {
    names: ['허혜원', '혜원', '모몽가'],
    color: '#ffaaaa'
  }
};

// 테마별 색상 정의
const THEME_COLORS = {
  default: {
    primary: '#ffd000',
    secondary: '#e6bb00',
    tertiary: '#ccaa00',
    glow: 'rgba(255, 208, 0, 0.15)',
    glowStrong: 'rgba(255, 208, 0, 0.25)'
  },
  blue: {
    primary: '#4a9eff',
    secondary: '#3d8ae6',
    tertiary: '#3075cc',
    glow: 'rgba(74, 158, 255, 0.15)',
    glowStrong: 'rgba(74, 158, 255, 0.25)'
  },
  pink: {
    primary: '#ffaaaa',
    secondary: '#e69999',
    tertiary: '#cc8888',
    glow: 'rgba(255, 170, 170, 0.15)',
    glowStrong: 'rgba(255, 170, 170, 0.25)'
  },
  red: {
    primary: '#ff5555',
    secondary: '#e64a4a',
    tertiary: '#cc4040',
    glow: 'rgba(255, 85, 85, 0.15)',
    glowStrong: 'rgba(255, 85, 85, 0.25)'
  }
};

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
      slackWorkspace: null,
      shortcutSet: 'set2', // 'set1' 또는 'set2' (기본값: set2)
      // 댓글 썸네일 설정
      showCommentThumbnails: true,
      commentThumbnailScale: 100 // 50 ~ 200
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

        // 저장된 이름이 있으면 테마 자동 적용 (DOM 로드 후)
        if (this.settings.userName && this.settings.userSource === 'manual') {
          // DOMContentLoaded 이후에 테마 적용
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.applyThemeForCurrentUser());
          } else {
            // 이미 로드된 경우 약간의 딜레이 후 적용
            setTimeout(() => this.applyThemeForCurrentUser(), 0);
          }
        }
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
   * 사용자 이름 초기화
   * - 이미 수동으로 설정된 이름이 있으면 사용
   * - 없으면 익명으로 설정 (모달에서 수동 입력 유도)
   */
  async initialize() {
    // 이미 수동으로 설정된 이름이 있으면 사용
    if (this.settings.userName && this.settings.userSource === 'manual') {
      log.info('기존 사용자 이름 사용', { userName: this.settings.userName });
      return this.settings.userName;
    }

    // 익명으로 설정 (앱에서 모달을 통해 수동 입력 유도)
    this.settings.userName = '익명';
    this.settings.userSource = 'anonymous';
    this._saveToStorage();
    log.info('익명 사용자로 설정됨 (수동 입력 필요)');
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

      // 이름에 맞는 테마 자동 적용
      this.applyThemeForCurrentUser();

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
      slackWorkspace: null,
      shortcutSet: 'set2'
    };
    this._saveToStorage();
    return await this.initialize();
  }

  /**
   * 현재 단축키 세트 가져오기
   * @returns {string} 'set1' 또는 'set2'
   */
  getShortcutSet() {
    return this.settings.shortcutSet || 'set2';
  }

  /**
   * 단축키 세트 설정
   * @param {string} set - 'set1' 또는 'set2'
   */
  setShortcutSet(set) {
    if (set === 'set1' || set === 'set2') {
      this.settings.shortcutSet = set;
      this._saveToStorage();
      this._emit('shortcutSetChanged', { shortcutSet: set });
      log.info('단축키 세트 변경됨', { shortcutSet: set });
    }
  }

  /**
   * 이름에 맞는 테마 찾기
   * @param {string} name - 사용자 이름
   * @returns {string} 테마 키 ('default', 'blue', 'pink', 'red')
   */
  getThemeForName(name) {
    if (!name) return 'default';

    const lowerName = name.toLowerCase();

    for (const [theme, names] of Object.entries(NAME_THEMES)) {
      for (const themeName of names) {
        if (lowerName === themeName.toLowerCase() || lowerName.includes(themeName.toLowerCase())) {
          return theme;
        }
      }
    }

    return 'default';
  }

  /**
   * 테마 적용 (CSS 변수 설정)
   * @param {string} themeName - 테마 이름
   */
  applyTheme(themeName = 'default') {
    const colors = THEME_COLORS[themeName] || THEME_COLORS.default;
    const root = document.documentElement;

    root.style.setProperty('--accent-primary', colors.primary);
    root.style.setProperty('--accent-secondary', colors.secondary);
    root.style.setProperty('--accent-tertiary', colors.tertiary);
    root.style.setProperty('--accent-glow', colors.glow);
    root.style.setProperty('--accent-glow-strong', colors.glowStrong);

    log.info('테마 적용됨', { theme: themeName, colors });
    this._emit('themeChanged', { theme: themeName, colors });
  }

  /**
   * 현재 이름에 맞는 테마 자동 적용
   */
  applyThemeForCurrentUser() {
    const theme = this.getThemeForName(this.settings.userName);
    this.applyTheme(theme);
    return theme;
  }

  /**
   * 이름에 맞는 아바타 이미지 경로 반환
   * @param {string} name - 사용자 이름
   * @returns {string|null} 이미지 경로 또는 null
   */
  getAvatarForName(name) {
    if (!name) return null;

    const lowerName = name.toLowerCase();

    for (const avatarData of Object.values(NAME_AVATARS)) {
      for (const avatarName of avatarData.names) {
        if (lowerName === avatarName.toLowerCase() || lowerName.includes(avatarName.toLowerCase())) {
          return avatarData.image;
        }
      }
    }

    return null;
  }

  /**
   * 이름에 맞는 색상 반환
   * @param {string} name - 사용자 이름
   * @returns {string|null} 색상 코드 또는 null
   */
  getColorForName(name) {
    if (!name) return null;

    const lowerName = name.toLowerCase();

    for (const colorData of Object.values(NAME_COLORS)) {
      for (const colorName of colorData.names) {
        if (lowerName === colorName.toLowerCase() || lowerName.includes(colorName.toLowerCase())) {
          return colorData.color;
        }
      }
    }

    return null;
  }

  // ====== 댓글 썸네일 설정 ======

  /**
   * 댓글 썸네일 표시 여부 가져오기
   */
  getShowCommentThumbnails() {
    return this.settings.showCommentThumbnails ?? true;
  }

  /**
   * 댓글 썸네일 표시 여부 설정
   */
  setShowCommentThumbnails(show) {
    this.settings.showCommentThumbnails = !!show;
    this._saveToStorage();
    this._emit('commentThumbnailsChanged', { show: this.settings.showCommentThumbnails });
    log.info('댓글 썸네일 설정 변경됨', { show });
  }

  /**
   * 댓글 썸네일 스케일 가져오기 (50 ~ 200)
   */
  getCommentThumbnailScale() {
    return this.settings.commentThumbnailScale ?? 100;
  }

  /**
   * 댓글 썸네일 스케일 설정 (50 ~ 200)
   */
  setCommentThumbnailScale(scale) {
    const clampedScale = Math.max(50, Math.min(200, scale));
    this.settings.commentThumbnailScale = clampedScale;
    this._saveToStorage();
    this._emit('commentThumbnailScaleChanged', { scale: clampedScale });
    log.info('댓글 썸네일 스케일 변경됨', { scale: clampedScale });
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
