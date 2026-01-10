/**
 * 스플릿 뷰 매니저
 * 두 버전을 나란히 비교하는 스플릿 뷰 기능을 관리합니다.
 *
 * @module split-view-manager
 */

import { createLogger } from '../logger.js';
import { getVersionManager } from './version-manager.js';

const log = createLogger('SplitViewManager');

/**
 * 스플릿 뷰 매니저 클래스
 */
export class SplitViewManager {
  constructor() {
    // DOM Elements
    this._overlay = null;
    this._panelLeft = null;
    this._panelRight = null;
    this._resizer = null;
    this._timeline = null;

    // State
    this._isOpen = false;
    this._mode = 'sync'; // 'sync' | 'independent'
    this._activePanel = 'left';
    this._leftVersion = null;
    this._rightVersion = null;
    this._leftVideo = null;
    this._rightVideo = null;
    this._fps = 24;
    this._isPlaying = false;
    this._isDraggingResizer = false;

    // Version Manager
    this._versionManager = getVersionManager();

    // Callbacks
    this._onClose = null;

    log.info('SplitViewManager 생성됨');
  }

  /**
   * DOM 초기화
   */
  init() {
    // 오버레이
    this._overlay = document.getElementById('splitViewOverlay');
    if (!this._overlay) {
      log.error('splitViewOverlay 요소를 찾을 수 없음');
      return false;
    }

    // 패널
    this._panelLeft = document.getElementById('splitPanelLeft');
    this._panelRight = document.getElementById('splitPanelRight');
    this._resizer = document.getElementById('splitResizer');
    this._timeline = document.getElementById('splitViewTimeline');

    // 비디오 요소
    this._leftVideo = document.getElementById('splitVideoLeft');
    this._rightVideo = document.getElementById('splitVideoRight');

    // 이벤트 바인딩
    this._bindEvents();

    log.info('SplitViewManager 초기화 완료');
    return true;
  }

  /**
   * 이벤트 바인딩
   */
  _bindEvents() {
    // 모드 버튼
    const btnSyncMode = document.getElementById('btnSyncMode');
    const btnIndependentMode = document.getElementById('btnIndependentMode');

    btnSyncMode?.addEventListener('click', () => this._setMode('sync'));
    btnIndependentMode?.addEventListener('click', () => this._setMode('independent'));

    // 액션 버튼
    const btnSwap = document.getElementById('btnSwapPanels');
    const btnClose = document.getElementById('btnCloseSplitView');

    btnSwap?.addEventListener('click', () => this._swapPanels());
    btnClose?.addEventListener('click', () => this.close());

    // 음소거 버튼
    const btnMuteLeft = document.getElementById('btnMuteLeft');
    const btnMuteRight = document.getElementById('btnMuteRight');

    btnMuteLeft?.addEventListener('click', () => this._toggleMute('left'));
    btnMuteRight?.addEventListener('click', () => this._toggleMute('right'));

    // 패널 클릭 - 활성화
    this._panelLeft?.addEventListener('click', () => this._setActivePanel('left'));
    this._panelRight?.addEventListener('click', () => this._setActivePanel('right'));

    // 버전 셀렉터
    this._bindVersionSelector('Left');
    this._bindVersionSelector('Right');

    // 리사이저 드래그
    this._bindResizerDrag();

    // 타임라인 컨트롤
    this._bindTimelineControls();

    // ESC 키로 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._isOpen) {
        this.close();
      }
    });
  }

  /**
   * 버전 셀렉터 이벤트 바인딩
   * @param {string} side - 'Left' | 'Right'
   */
  _bindVersionSelector(side) {
    const selector = document.getElementById(`splitVersionSelector${side}`);
    const trigger = document.getElementById(`splitVersionTrigger${side}`);
    const menu = document.getElementById(`splitVersionMenu${side}`);

    if (!selector || !trigger || !menu) return;

    // 트리거 클릭 - 토글
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = selector.classList.contains('open');

      // 다른 셀렉터 닫기
      document.querySelectorAll('.split-version-selector.open').forEach((el) => {
        if (el !== selector) el.classList.remove('open');
      });

      selector.classList.toggle('open', !isOpen);
    });

    // 바깥 클릭 - 닫기
    document.addEventListener('click', (e) => {
      if (!selector.contains(e.target)) {
        selector.classList.remove('open');
      }
    });
  }

  /**
   * 리사이저 드래그 이벤트 바인딩
   */
  _bindResizerDrag() {
    if (!this._resizer) return;

    let startX = 0;
    let startLeftWidth = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      this._isDraggingResizer = true;
      startX = e.clientX;
      startLeftWidth = this._panelLeft.offsetWidth;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!this._isDraggingResizer) return;

      const deltaX = e.clientX - startX;
      const newLeftWidth = startLeftWidth + deltaX;
      const containerWidth = this._overlay.querySelector('.split-view-body').offsetWidth;
      const minWidth = 300;
      const maxWidth = containerWidth - minWidth - this._resizer.offsetWidth;

      if (newLeftWidth >= minWidth && newLeftWidth <= maxWidth) {
        const leftPercent = (newLeftWidth / containerWidth) * 100;
        const rightPercent = 100 - leftPercent - (this._resizer.offsetWidth / containerWidth * 100);

        this._panelLeft.style.flex = `0 0 ${leftPercent}%`;
        this._panelRight.style.flex = `0 0 ${rightPercent}%`;
      }
    };

    const onMouseUp = () => {
      this._isDraggingResizer = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this._resizer.addEventListener('mousedown', onMouseDown);
  }

  /**
   * 타임라인 컨트롤 이벤트 바인딩
   */
  _bindTimelineControls() {
    // 재생 버튼
    const btnPlay = document.getElementById('splitBtnPlay');
    btnPlay?.addEventListener('click', () => this._togglePlay());

    // 프레임 이동 버튼
    document.getElementById('splitBtnFirst')?.addEventListener('click', () => this._seekToFrame(0));
    document.getElementById('splitBtnPrevFrame')?.addEventListener('click', () => this._stepFrame(-1));
    document.getElementById('splitBtnNextFrame')?.addEventListener('click', () => this._stepFrame(1));
    document.getElementById('splitBtnLast')?.addEventListener('click', () => this._seekToEnd());

    // 시크바
    const seekbar = document.getElementById('splitSeekbar');
    seekbar?.addEventListener('click', (e) => {
      const rect = seekbar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      this._seekToPercent(percent);
    });
  }

  /**
   * 스플릿 뷰 열기
   * @param {Object} options - { leftVersion, rightVersion }
   */
  async open(options = {}) {
    if (this._isOpen) return;

    log.info('스플릿 뷰 열기', options);

    // 버전 목록 가져오기
    const versions = this._versionManager.getAllVersions();

    if (versions.length < 2) {
      log.warn('비교할 버전이 2개 이상 필요합니다');
      alert('버전 비교를 위해서는 2개 이상의 버전이 필요합니다.');
      return;
    }

    // 초기 버전 설정
    this._leftVersion = options.leftVersion || versions[0];
    this._rightVersion = options.rightVersion || versions[1];

    // 같은 버전이면 다른 버전으로 설정
    if (this._leftVersion.path === this._rightVersion.path && versions.length > 1) {
      this._rightVersion = versions.find((v) => v.path !== this._leftVersion.path) || versions[1];
    }

    // 오버레이 표시
    this._overlay.classList.add('open');
    this._isOpen = true;

    // 패널 초기화
    this._resetPanelSizes();
    this._setActivePanel('left');

    // 버전 셀렉터 렌더링
    this._renderVersionSelector('Left', this._leftVersion);
    this._renderVersionSelector('Right', this._rightVersion);

    // 비디오 로드
    await this._loadVideo('left', this._leftVersion);
    await this._loadVideo('right', this._rightVersion);

    // 보조 패널(우측) 음소거
    this._setMuted('right', true);

    log.info('스플릿 뷰 열림');
  }

  /**
   * 스플릿 뷰 닫기
   */
  close() {
    if (!this._isOpen) return;

    log.info('스플릿 뷰 닫기');

    // 재생 중지
    this._pause();

    // 비디오 정리
    if (this._leftVideo) {
      this._leftVideo.pause();
      this._leftVideo.src = '';
    }
    if (this._rightVideo) {
      this._rightVideo.pause();
      this._rightVideo.src = '';
    }

    // 오버레이 숨기기
    this._overlay.classList.remove('open');
    this._isOpen = false;

    // 콜백 호출
    if (this._onClose) {
      this._onClose();
    }

    log.info('스플릿 뷰 닫힘');
  }

  /**
   * 닫기 콜백 설정
   * @param {Function} callback
   */
  onClose(callback) {
    this._onClose = callback;
  }

  /**
   * 열림 상태 확인
   * @returns {boolean}
   */
  isOpen() {
    return this._isOpen;
  }

  /**
   * 패널 크기 초기화 (50:50)
   */
  _resetPanelSizes() {
    if (this._panelLeft) this._panelLeft.style.flex = '1';
    if (this._panelRight) this._panelRight.style.flex = '1';
  }

  /**
   * 모드 설정
   * @param {'sync'|'independent'} mode
   */
  _setMode(mode) {
    this._mode = mode;

    // 버튼 상태 업데이트
    document.getElementById('btnSyncMode')?.classList.toggle('active', mode === 'sync');
    document.getElementById('btnIndependentMode')?.classList.toggle('active', mode === 'independent');

    // 오버레이 클래스 업데이트
    this._overlay.classList.toggle('independent-mode', mode === 'independent');

    log.info('모드 변경됨', { mode });
  }

  /**
   * 활성 패널 설정
   * @param {'left'|'right'} panel
   */
  _setActivePanel(panel) {
    this._activePanel = panel;

    // 패널 클래스 업데이트
    this._panelLeft?.classList.toggle('active', panel === 'left');
    this._panelRight?.classList.toggle('active', panel === 'right');

    // 배지 업데이트
    const leftBadge = document.getElementById('splitBadgeLeft');
    const rightBadge = document.getElementById('splitBadgeRight');

    if (leftBadge) {
      leftBadge.classList.toggle('active-badge', panel === 'left');
      leftBadge.textContent = panel === 'left' ? '활성' : '';
    }
    if (rightBadge) {
      rightBadge.classList.toggle('active-badge', panel === 'right');
      rightBadge.textContent = panel === 'right' ? '활성' : '';
    }

    log.debug('활성 패널 변경됨', { panel });
  }

  /**
   * 버전 셀렉터 렌더링
   * @param {'Left'|'Right'} side
   * @param {Object} currentVersion
   */
  _renderVersionSelector(side, currentVersion) {
    const label = document.getElementById(`splitVersionLabel${side}`);
    const menu = document.getElementById(`splitVersionMenu${side}`);

    if (!label || !menu) return;

    // 라벨 업데이트
    if (currentVersion) {
      const versionText =
        currentVersion.version !== null && currentVersion.version !== undefined
          ? `v${currentVersion.version}`
          : '기준';
      label.textContent = versionText;
    } else {
      label.textContent = '선택...';
    }

    // 메뉴 렌더링
    const versions = this._versionManager.getAllVersions();
    const otherVersion = side === 'Left' ? this._rightVersion : this._leftVersion;

    menu.innerHTML = '';

    versions.forEach((v) => {
      const item = document.createElement('div');
      item.className = 'split-version-item';

      // 현재 선택된 버전인지
      if (currentVersion && v.path === currentVersion.path) {
        item.classList.add('active');
      }

      // 다른 패널에서 사용 중인 버전인지 (비활성화)
      if (otherVersion && v.path === otherVersion.path) {
        item.classList.add('disabled');
      }

      // 라벨
      const labelSpan = document.createElement('span');
      labelSpan.className = 'split-version-item-label';
      labelSpan.textContent =
        v.version !== null && v.version !== undefined
          ? `v${v.version}`
          : '기준';

      // 파일명
      const filenameSpan = document.createElement('span');
      filenameSpan.className = 'split-version-item-filename';
      filenameSpan.textContent = v.fileName || '';
      filenameSpan.title = v.path || '';

      item.appendChild(labelSpan);
      item.appendChild(filenameSpan);

      // 배지
      if (otherVersion && v.path === otherVersion.path) {
        const badge = document.createElement('span');
        badge.className = 'split-version-item-badge';
        badge.textContent = '사용 중';
        item.appendChild(badge);
      }

      // 클릭 이벤트
      if (!(otherVersion && v.path === otherVersion.path)) {
        item.addEventListener('click', () => {
          this._selectVersion(side.toLowerCase(), v);
          document.getElementById(`splitVersionSelector${side}`)?.classList.remove('open');
        });
      }

      menu.appendChild(item);
    });
  }

  /**
   * 버전 선택
   * @param {'left'|'right'} panel
   * @param {Object} versionInfo
   */
  async _selectVersion(panel, versionInfo) {
    log.info('버전 선택됨', { panel, versionInfo });

    if (panel === 'left') {
      this._leftVersion = versionInfo;
      this._renderVersionSelector('Left', versionInfo);
      await this._loadVideo('left', versionInfo);
    } else {
      this._rightVersion = versionInfo;
      this._renderVersionSelector('Right', versionInfo);
      await this._loadVideo('right', versionInfo);
    }

    // 다른 패널의 셀렉터 다시 렌더링 (disabled 상태 업데이트)
    if (panel === 'left') {
      this._renderVersionSelector('Right', this._rightVersion);
    } else {
      this._renderVersionSelector('Left', this._leftVersion);
    }
  }

  /**
   * 비디오 로드
   * @param {'left'|'right'} panel
   * @param {Object} versionInfo
   */
  async _loadVideo(panel, versionInfo) {
    const video = panel === 'left' ? this._leftVideo : this._rightVideo;
    const loadingOverlay = document.getElementById(`splitLoading${panel === 'left' ? 'Left' : 'Right'}`);
    const emptyState = document.getElementById(`splitEmpty${panel === 'left' ? 'Left' : 'Right'}`);

    if (!video || !versionInfo?.path) {
      emptyState?.classList.add('active');
      return;
    }

    // 로딩 표시
    loadingOverlay?.classList.add('active');
    emptyState?.classList.remove('active');

    try {
      // 비디오 소스 설정
      video.src = versionInfo.path;

      // 메타데이터 로드 대기
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });

      log.info('비디오 로드 완료', { panel, path: versionInfo.path });

      // 타임코드 업데이트
      this._updateTimecode();
    } catch (error) {
      log.error('비디오 로드 실패', { panel, error });
    } finally {
      loadingOverlay?.classList.remove('active');
    }
  }

  /**
   * 좌우 패널 교환
   */
  _swapPanels() {
    const tempVersion = this._leftVersion;
    this._leftVersion = this._rightVersion;
    this._rightVersion = tempVersion;

    // 셀렉터 다시 렌더링
    this._renderVersionSelector('Left', this._leftVersion);
    this._renderVersionSelector('Right', this._rightVersion);

    // 비디오 다시 로드
    this._loadVideo('left', this._leftVersion);
    this._loadVideo('right', this._rightVersion);

    log.info('패널 교환됨');
  }

  /**
   * 음소거 토글
   * @param {'left'|'right'} panel
   */
  _toggleMute(panel) {
    const video = panel === 'left' ? this._leftVideo : this._rightVideo;
    const btn = document.getElementById(`btnMute${panel === 'left' ? 'Left' : 'Right'}`);

    if (!video || !btn) return;

    video.muted = !video.muted;
    btn.classList.toggle('muted', video.muted);

    // 아이콘 교체
    if (video.muted) {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      `;
    } else {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </svg>
      `;
    }

    log.debug('음소거 토글', { panel, muted: video.muted });
  }

  /**
   * 음소거 설정
   * @param {'left'|'right'} panel
   * @param {boolean} muted
   */
  _setMuted(panel, muted) {
    const video = panel === 'left' ? this._leftVideo : this._rightVideo;
    const btn = document.getElementById(`btnMute${panel === 'left' ? 'Left' : 'Right'}`);

    if (!video) return;

    video.muted = muted;
    btn?.classList.toggle('muted', muted);

    // 아이콘 업데이트
    if (btn) {
      if (muted) {
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <line x1="23" y1="9" x2="17" y2="15"/>
            <line x1="17" y1="9" x2="23" y2="15"/>
          </svg>
        `;
      } else {
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        `;
      }
    }
  }

  /**
   * 재생/일시정지 토글
   */
  _togglePlay() {
    if (this._isPlaying) {
      this._pause();
    } else {
      this._play();
    }
  }

  /**
   * 재생
   */
  _play() {
    if (this._mode === 'sync') {
      this._leftVideo?.play();
      this._rightVideo?.play();
    } else {
      // 독립 모드에서는 활성 패널만 재생
      const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
      video?.play();
    }

    this._isPlaying = true;
    this._updatePlayButton(true);
    this._startTimeUpdate();
  }

  /**
   * 일시정지
   */
  _pause() {
    this._leftVideo?.pause();
    this._rightVideo?.pause();

    this._isPlaying = false;
    this._updatePlayButton(false);
    this._stopTimeUpdate();
  }

  /**
   * 재생 버튼 상태 업데이트
   * @param {boolean} isPlaying
   */
  _updatePlayButton(isPlaying) {
    const playIcon = document.getElementById('splitPlayIcon');
    if (!playIcon) return;

    if (isPlaying) {
      playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
    } else {
      playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    }
  }

  /**
   * 프레임 이동
   * @param {number} delta - 이동할 프레임 수
   */
  _stepFrame(delta) {
    const frameTime = 1 / this._fps;
    const video = this._leftVideo;

    if (video) {
      video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + frameTime * delta));

      if (this._mode === 'sync' && this._rightVideo) {
        this._rightVideo.currentTime = video.currentTime;
      }
    }

    this._updateTimecode();
  }

  /**
   * 특정 프레임으로 이동
   * @param {number} frame
   */
  _seekToFrame(frame) {
    const frameTime = 1 / this._fps;
    const time = frame * frameTime;

    if (this._leftVideo) this._leftVideo.currentTime = time;
    if (this._mode === 'sync' && this._rightVideo) this._rightVideo.currentTime = time;

    this._updateTimecode();
  }

  /**
   * 끝으로 이동
   */
  _seekToEnd() {
    const video = this._leftVideo;
    if (video) {
      video.currentTime = video.duration;
      if (this._mode === 'sync' && this._rightVideo) {
        this._rightVideo.currentTime = this._rightVideo.duration;
      }
    }
    this._updateTimecode();
  }

  /**
   * 퍼센트 위치로 이동
   * @param {number} percent - 0~1
   */
  _seekToPercent(percent) {
    const video = this._leftVideo;
    if (video) {
      video.currentTime = video.duration * percent;
      if (this._mode === 'sync' && this._rightVideo) {
        this._rightVideo.currentTime = this._rightVideo.duration * percent;
      }
    }
    this._updateTimecode();
  }

  /**
   * 타임 업데이트 시작
   */
  _startTimeUpdate() {
    this._timeUpdateInterval = setInterval(() => {
      this._updateTimecode();

      // 동기 모드에서 프레임 동기화
      if (this._mode === 'sync' && this._leftVideo && this._rightVideo) {
        this._rightVideo.currentTime = this._leftVideo.currentTime;
      }
    }, 1000 / 30); // 30fps로 업데이트
  }

  /**
   * 타임 업데이트 중지
   */
  _stopTimeUpdate() {
    if (this._timeUpdateInterval) {
      clearInterval(this._timeUpdateInterval);
      this._timeUpdateInterval = null;
    }
  }

  /**
   * 타임코드 업데이트
   */
  _updateTimecode() {
    const video = this._leftVideo;
    if (!video) return;

    const current = video.currentTime || 0;
    const duration = video.duration || 0;
    const percent = duration > 0 ? (current / duration) * 100 : 0;

    // 타임코드 표시
    const currentEl = document.getElementById('splitTimecodeCurrent');
    const totalEl = document.getElementById('splitTimecodeTotal');
    const frameInfoEl = document.getElementById('splitFrameInfo');

    if (currentEl) currentEl.textContent = this._formatTimecode(current);
    if (totalEl) totalEl.textContent = this._formatTimecode(duration);

    const currentFrame = Math.floor(current * this._fps);
    const totalFrames = Math.floor(duration * this._fps);
    if (frameInfoEl) frameInfoEl.textContent = `${this._fps}fps · Frame ${currentFrame} / ${totalFrames}`;

    // 시크바 업데이트
    const progress = document.getElementById('splitSeekbarProgress');
    const handle = document.getElementById('splitSeekbarHandle');

    if (progress) progress.style.width = `${percent}%`;
    if (handle) handle.style.left = `${percent}%`;
  }

  /**
   * 타임코드 포맷
   * @param {number} seconds
   * @returns {string}
   */
  _formatTimecode(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00:00:00';

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * this._fps);

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  /**
   * FPS 설정
   * @param {number} fps
   */
  setFps(fps) {
    this._fps = fps;
    this._updateTimecode();
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * SplitViewManager 싱글톤 가져오기
 * @returns {SplitViewManager}
 */
export function getSplitViewManager() {
  if (!instance) {
    instance = new SplitViewManager();
  }
  return instance;
}

export default SplitViewManager;
