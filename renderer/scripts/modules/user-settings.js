/**
 * baeframe - User Settings Module
 * 사용자 설정 및 Slack 연동 관리
 */

import { createLogger } from '../logger.js';
import { getAuthManager } from './auth-manager.js';

const log = createLogger('UserSettings');

// 로컬 스토리지 키
const STORAGE_KEY = 'baeframe_user_settings';

// 기본 단축키 매핑
const DEFAULT_SHORTCUTS = {
  // 재생 관련
  playPause: { key: 'Space', ctrl: false, shift: false, alt: false, label: '재생/일시정지' },
  prevFrame: { key: 'ArrowLeft', ctrl: false, shift: false, alt: false, label: '이전 프레임' },
  nextFrame: { key: 'ArrowRight', ctrl: false, shift: false, alt: false, label: '다음 프레임' },
  prevFrameFast: { key: 'ArrowLeft', ctrl: false, shift: true, alt: false, label: '프레임 빨리 뒤로' },
  nextFrameFast: { key: 'ArrowRight', ctrl: false, shift: true, alt: false, label: '프레임 빨리 앞으로' },
  prevSecond: { key: 'ArrowLeft', ctrl: true, shift: false, alt: false, label: '초 단위 뒤로' },
  nextSecond: { key: 'ArrowRight', ctrl: true, shift: false, alt: false, label: '초 단위 앞으로' },
  goToStart: { key: 'Home', ctrl: false, shift: false, alt: false, label: '처음으로' },
  goToEnd: { key: 'End', ctrl: false, shift: false, alt: false, label: '끝으로' },

  // 모드 관련
  commentMode: { key: 'KeyC', ctrl: false, shift: false, alt: false, label: '댓글 모드' },
  drawMode: { key: 'KeyB', ctrl: false, shift: false, alt: false, label: '그리기 모드' },
  fullscreen: { key: 'KeyF', ctrl: false, shift: false, alt: false, label: '전체화면' },

  // 구간 반복
  setInPoint: { key: 'KeyI', ctrl: false, shift: false, alt: false, label: '시작점 설정' },
  setOutPoint: { key: 'KeyO', ctrl: false, shift: false, alt: false, label: '종료점 설정' },
  toggleLoop: { key: 'KeyL', ctrl: false, shift: false, alt: false, label: '구간 반복 토글' },
  clearLoop: { key: 'KeyL', ctrl: false, shift: true, alt: false, label: '구간 반복 해제' },

  // 실행취소
  undo: { key: 'KeyZ', ctrl: true, shift: false, alt: false, label: '실행취소' },
  redo: { key: 'KeyY', ctrl: true, shift: false, alt: false, label: '다시실행' },

  // 키프레임 관련 (그리기 모드)
  keyframeAddWithCopy: { key: 'F6', ctrl: false, shift: false, alt: false, label: '키프레임 추가 (복사)' },
  keyframeAddBlank: { key: 'F7', ctrl: false, shift: false, alt: false, label: '빈 키프레임 추가' },
  keyframeAddBlank2: { key: 'Digit2', ctrl: false, shift: false, alt: false, label: '빈 키프레임 삽입 (2)' },
  keyframeDelete: { key: 'Delete', ctrl: false, shift: false, alt: false, label: '키프레임 삭제' },
  keyframeDeleteAlt: { key: 'Digit3', ctrl: false, shift: true, alt: false, label: '키프레임 삭제 (Shift+3)' },
  prevKeyframe: { key: 'KeyA', ctrl: false, shift: false, alt: false, label: '이전 키프레임' },
  nextKeyframe: { key: 'KeyD', ctrl: false, shift: false, alt: false, label: '다음 키프레임' },

  // 프레임 편집
  insertFrame: { key: 'Digit3', ctrl: false, shift: false, alt: false, label: '프레임 삽입 (홀드)' },
  deleteFrame: { key: 'Digit4', ctrl: false, shift: false, alt: false, label: '프레임 삭제' },

  // 그리기 보조
  onionSkinToggle: { key: 'Digit1', ctrl: false, shift: false, alt: false, label: '어니언 스킨 토글' },
  prevFrameDraw: { key: 'KeyA', ctrl: false, shift: true, alt: false, label: '1프레임 이전 (Shift+A)' },
  nextFrameDraw: { key: 'KeyD', ctrl: false, shift: true, alt: false, label: '1프레임 다음 (Shift+D)' }
};

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
      // 댓글 썸네일 설정
      showCommentThumbnails: true,
      commentThumbnailScale: 35, // 35 ~ 200 (기본값: 35%)
      // 토스트 알림 표시 여부
      showToastNotifications: true,
      // 최초 이름 설정 여부 (모달 한 번만 표시)
      hasSetNameOnce: false,
      // 사용자 정의 단축키 (기본값 위에 덮어씀)
      customShortcuts: {},
      // 프레임/초 이동 설정
      frameSkipAmount: 10, // Shift+화살표로 이동할 프레임 수
      secondSkipAmount: 1  // Ctrl+화살표로 이동할 초 수
    };

    this._ready = false;
    this._loadFromStorage();
    this._loadFromFile().then(() => {
      this._ready = true;
      this._emit('ready', { settings: this.settings });
      log.info('설정 로드 완료', {
        userName: this.settings.userName,
        hasSetNameOnce: this.settings.hasSetNameOnce,
        userSource: this.settings.userSource,
        customShortcuts: Object.keys(this.settings.customShortcuts || {}).length
      });
    });
  }

  /**
   * 설정 로드 완료 여부
   */
  isReady() {
    return this._ready;
  }

  /**
   * 설정 로드 완료 대기
   */
  async waitForReady() {
    if (this._ready) return;
    return new Promise(resolve => {
      this.addEventListener('ready', () => resolve(), { once: true });
    });
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
      log.info('설정 저장됨 (localStorage)');
    } catch (error) {
      log.error('설정 저장 실패', error);
    }
  }

  /**
   * 파일에서 설정 로드 (비동기)
   */
  async _loadFromFile() {
    try {
      if (window.electronAPI?.loadSettings) {
        const result = await window.electronAPI.loadSettings();
        if (result.success && result.data) {
          this.settings = { ...this.settings, ...result.data };
          log.info('설정 파일에서 로드됨', { userName: this.settings.userName });
        }
      }
    } catch (error) {
      log.warn('설정 파일 로드 실패', error);
    }
  }

  /**
   * 파일에 설정 저장 (비동기)
   */
  async _saveToFile() {
    try {
      if (window.electronAPI?.saveSettings) {
        const result = await window.electronAPI.saveSettings(this.settings);
        if (result.success) {
          log.info('설정 파일에 저장됨');
        } else {
          log.error('설정 파일 저장 실패', result.error);
        }
      }
    } catch (error) {
      log.error('설정 파일 저장 실패', error);
    }
  }

  /**
   * 설정 저장 (localStorage + 파일)
   */
  _save() {
    this._saveToStorage();
    this._saveToFile();
  }

  // ====== 단축키 관련 메서드 ======

  /**
   * 모든 단축키 가져오기 (기본값 + 사용자 정의)
   */
  getShortcuts() {
    return { ...DEFAULT_SHORTCUTS, ...this.settings.customShortcuts };
  }

  /**
   * 특정 단축키 가져오기
   */
  getShortcut(action) {
    return this.settings.customShortcuts[action] || DEFAULT_SHORTCUTS[action] || null;
  }

  /**
   * 단축키 설정
   */
  setShortcut(action, shortcut) {
    if (!DEFAULT_SHORTCUTS[action]) {
      log.warn('알 수 없는 단축키 액션', { action });
      return false;
    }
    this.settings.customShortcuts[action] = {
      ...DEFAULT_SHORTCUTS[action],
      ...shortcut,
      label: DEFAULT_SHORTCUTS[action].label // 라벨은 유지
    };
    this._save();
    this._emit('shortcutChanged', { action, shortcut: this.settings.customShortcuts[action] });
    log.info('단축키 변경됨', { action, shortcut });
    return true;
  }

  /**
   * 단축키 기본값으로 초기화
   */
  resetShortcut(action) {
    if (this.settings.customShortcuts[action]) {
      delete this.settings.customShortcuts[action];
      this._save();
      this._emit('shortcutChanged', { action, shortcut: DEFAULT_SHORTCUTS[action] });
      log.info('단축키 초기화됨', { action });
    }
  }

  /**
   * 모든 단축키 기본값으로 초기화
   */
  resetAllShortcuts() {
    this.settings.customShortcuts = {};
    this._save();
    this._emit('shortcutsReset');
    log.info('모든 단축키 초기화됨');
  }

  /**
   * 키 이벤트가 특정 단축키와 일치하는지 확인
   */
  matchShortcut(action, event) {
    const shortcut = this.getShortcut(action);
    if (!shortcut) return false;

    return (
      event.code === shortcut.key &&
      event.ctrlKey === shortcut.ctrl &&
      event.shiftKey === shortcut.shift &&
      event.altKey === shortcut.alt
    );
  }

  /**
   * 키 이벤트로 액션 찾기
   */
  findActionByEvent(event) {
    const shortcuts = this.getShortcuts();
    for (const [action, shortcut] of Object.entries(shortcuts)) {
      if (
        event.code === shortcut.key &&
        event.ctrlKey === shortcut.ctrl &&
        event.shiftKey === shortcut.shift &&
        event.altKey === shortcut.alt
      ) {
        return action;
      }
    }
    return null;
  }

  /**
   * 기본 단축키 목록 가져오기
   */
  getDefaultShortcuts() {
    return { ...DEFAULT_SHORTCUTS };
  }

  /**
   * 사용자 이름 초기화
   * - 이미 수동으로 설정된 이름이 있으면 사용
   * - hasSetNameOnce가 true면 기존 이름 유지
   * - 없으면 익명으로 설정 (모달에서 수동 입력 유도)
   */
  async initialize() {
    log.info('initialize 호출', {
      hasSetNameOnce: this.settings.hasSetNameOnce,
      userName: this.settings.userName,
      userSource: this.settings.userSource
    });

    // 이미 한 번 이름을 설정한 적이 있으면 기존 이름 사용
    if (this.settings.hasSetNameOnce) {
      log.info('기존 사용자 이름 사용 (hasSetNameOnce)', { userName: this.settings.userName });
      // 저장된 사용자에 맞는 테마 적용
      this.applyThemeForCurrentUser();
      return this.settings.userName || '익명';
    }

    // 이미 수동으로 설정된 이름이 있으면 사용
    if (this.settings.userName && this.settings.userSource === 'manual') {
      log.info('기존 사용자 이름 사용', { userName: this.settings.userName });
      // hasSetNameOnce가 false지만 수동 설정된 이름이 있으면 true로 설정
      this.settings.hasSetNameOnce = true;
      this._save();
      return this.settings.userName;
    }

    // 익명으로 설정 (앱에서 모달을 통해 수동 입력 유도)
    // 주의: hasSetNameOnce는 건드리지 않음 (사용자가 모달에서 설정해야 함)
    if (!this.settings.userName || this.settings.userName === '익명') {
      this.settings.userName = '익명';
      this.settings.userSource = 'anonymous';
      // hasSetNameOnce는 변경하지 않음 - 저장도 하지 않음 (불필요한 덮어쓰기 방지)
      log.info('익명 사용자로 설정됨 (수동 입력 필요)');
      this._emit('userDetected', { userName: '익명', source: 'anonymous' });
    }

    // 현재 사용자 이름에 맞는 테마 적용
    this.applyThemeForCurrentUser();

    return this.settings.userName || '익명';
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
      this.settings.hasSetNameOnce = true; // 이름 설정 완료 표시
      this._save();
      this._emit('userNameChanged', { userName: this.settings.userName });
      log.info('사용자 이름 수동 설정됨', { userName: this.settings.userName });

      // 이름에 맞는 테마 자동 적용
      this.applyThemeForCurrentUser();

      return true;
    }
    return false;
  }

  /**
   * 최초 이름 설정 여부 확인
   */
  hasSetNameOnce() {
    return this.settings.hasSetNameOnce === true;
  }

  /**
   * 토스트 알림 표시 여부 가져오기
   */
  getShowToastNotifications() {
    return this.settings.showToastNotifications !== false;
  }

  /**
   * 토스트 알림 표시 여부 설정
   */
  setShowToastNotifications(show) {
    this.settings.showToastNotifications = show;
    this._save();
    log.info('토스트 알림 설정 변경됨', { show });
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
    this._save();
    return await this.initialize();
  }

  /**
   * 이름에 맞는 테마 찾기
   * 인증 파일에 명시적 테마가 있으면 우선, "기본"(null)이면 하드코딩 매핑 참조
   * @param {string} name - 사용자 이름
   * @returns {string} 테마 키 ('default', 'blue', 'pink', 'red', 'green')
   */
  getThemeForName(name) {
    if (!name) return 'default';

    // 1. 등록된 사용자가 명시적으로 테마를 설정한 경우만 오버라이드
    //    theme이 null("기본")이면 하드코딩 매핑으로 fallback
    //    → 허혜원이 "기본" 선택 시 하드코딩 핑크 유지
    //    → 허혜원이 "파랑" 선택 시 파랑으로 오버라이드
    try {
      const authManager = getAuthManager();
      if (authManager.isReady()) {
        const registeredUsers = authManager.getRegisteredUsers();
        const authUser = registeredUsers.find(u => u.name.trim() === name.trim());
        if (authUser && authUser.theme) {
          return authUser.theme;
        }
      }
    } catch (e) {
      // 인증 매니저 사용 불가 시 기존 로직 사용
    }

    // 2. 하드코딩된 매핑 (등록 사용자의 "기본" 선택 또는 미등록 사용자)
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
   * 인증 파일의 theme 필드를 우선 참조
   * @param {string} name - 사용자 이름
   * @returns {string|null} 색상 코드 또는 null
   */
  getColorForName(name) {
    if (!name) return null;

    // 1. 등록된 사용자가 명시적으로 테마를 설정한 경우만 오버라이드
    //    theme이 null("기본")이면 하드코딩 매핑으로 fallback
    try {
      const authManager = getAuthManager();
      if (authManager.isReady()) {
        const registeredUsers = authManager.getRegisteredUsers();
        const authUser = registeredUsers.find(u => u.name.trim() === name.trim());
        if (authUser && authUser.theme) {
          const themeColors = THEME_COLORS[authUser.theme];
          if (themeColors) return themeColors.primary;
        }
      }
    } catch (e) {
      // 인증 매니저 사용 불가 시 기존 로직 사용
    }

    // 2. 하드코딩된 매핑 (등록 사용자의 "기본" 선택 또는 미등록 사용자)
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
    this._save();
    this._emit('commentThumbnailsChanged', { show: this.settings.showCommentThumbnails });
    log.info('댓글 썸네일 설정 변경됨', { show });
  }

  /**
   * 댓글 썸네일 스케일 가져오기 (35 ~ 200)
   */
  getCommentThumbnailScale() {
    return this.settings.commentThumbnailScale ?? 35;
  }

  /**
   * 댓글 썸네일 스케일 설정 (35 ~ 200)
   */
  setCommentThumbnailScale(scale) {
    const clampedScale = Math.max(35, Math.min(200, scale));
    this.settings.commentThumbnailScale = clampedScale;
    this._save();
    this._emit('commentThumbnailScaleChanged', { scale: clampedScale });
    log.info('댓글 썸네일 스케일 변경됨', { scale: clampedScale });
  }

  // ====== 프레임/초 이동 설정 ======

  /**
   * 프레임 빠른 이동량 가져오기 (기본값: 10)
   */
  getFrameSkipAmount() {
    return this.settings.frameSkipAmount ?? 10;
  }

  /**
   * 프레임 빠른 이동량 설정 (1 ~ 100)
   */
  setFrameSkipAmount(amount) {
    const clampedAmount = Math.max(1, Math.min(100, Math.round(amount)));
    this.settings.frameSkipAmount = clampedAmount;
    this._save();
    this._emit('frameSkipAmountChanged', { amount: clampedAmount });
    log.info('프레임 이동량 변경됨', { amount: clampedAmount });
  }

  /**
   * 초 단위 이동량 가져오기 (기본값: 1)
   */
  getSecondSkipAmount() {
    return this.settings.secondSkipAmount ?? 1;
  }

  /**
   * 초 단위 이동량 설정 (0.1 ~ 10)
   */
  setSecondSkipAmount(amount) {
    const clampedAmount = Math.max(0.1, Math.min(10, amount));
    this.settings.secondSkipAmount = clampedAmount;
    this._save();
    this._emit('secondSkipAmountChanged', { amount: clampedAmount });
    log.info('초 이동량 변경됨', { amount: clampedAmount });
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
