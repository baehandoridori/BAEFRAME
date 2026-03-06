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
    this._viewMode = 'side-by-side'; // 'side-by-side' | 'overlay' | 'wipe'
    this._activePanel = 'left';
    this._leftVersion = null;
    this._rightVersion = null;
    this._leftVideo = null;
    this._rightVideo = null;
    this._fps = 24;
    this._isPlaying = false;
    this._isDraggingResizer = false;
    this._animationFrameId = null;

    // 오버레이/와이프 모드 상태
    this._overlayOpacity = 50; // 0~100
    this._wipePosition = 50; // 0~100 (퍼센트)
    this._isDraggingWipe = false;
    this._overlayAutoHideTimer = null;

    // 하이브리드 동기화 상태 (GPT 권장)
    this._timeUpdateType = null; // 'rvfc' | 'raf'
    this._timeUpdateVideo = null; // RVFC cancel용
    this._lastSeekPerf = 0; // 마지막 seek 시간 (쿨다운용)
    this._lastUiFrame = -1; // UI 업데이트 최적화
    this._soloAudio = true; // 한쪽 언뮤트 시 반대쪽 자동 뮤트
    this._loadSeq = 0; // 비디오 로드 시퀀스 (레이스 방지)

    // 프레임 이동 디바운싱 (빠른 연속 입력 시 마지막 프레임만 실제 seek)
    this._frameStepRafId = null;
    this._pendingFrame = undefined;
    this._seekbarRafId = null;

    // Version Manager
    this._versionManager = getVersionManager();

    // Callbacks
    this._onClose = null;
    this._onBeforeClose = null;

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
    // 뷰 모드 버튼
    document.getElementById('btnViewSideBySide')?.addEventListener('click', () => this._setViewMode('side-by-side'));
    document.getElementById('btnViewOverlay')?.addEventListener('click', () => this._setViewMode('overlay'));
    document.getElementById('btnViewWipe')?.addEventListener('click', () => this._setViewMode('wipe'));

    // 재생 모드 버튼 (동기/독립)
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

    // 볼륨 슬라이더
    const volumeSliderLeft = document.getElementById('volumeSliderLeft');
    const volumeSliderRight = document.getElementById('volumeSliderRight');

    volumeSliderLeft?.addEventListener('input', (e) => this._setVolume('left', e.target.value / 100));
    volumeSliderRight?.addEventListener('input', (e) => this._setVolume('right', e.target.value / 100));

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

    // 오버레이/와이프 컨트롤
    this._bindOverlayControls();
    this._bindWipeControls();

    // 오버레이 모드 스왑 버튼
    document.getElementById('btnOverlaySwap')?.addEventListener('click', () => this._swapPanels());

    // 키보드 이벤트
    this._bindKeyboardEvents();
  }

  /**
   * 키보드 이벤트 바인딩
   */
  _bindKeyboardEvents() {
    document.addEventListener('keydown', (e) => {
      if (!this._isOpen) return;

      // 입력 필드에서는 무시
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

      switch (e.code) {
      case 'Escape':
        e.preventDefault();
        this.close();
        break;

      case 'Space':
        e.preventDefault();
        this._togglePlay();
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+← : 1초 뒤로
          this._stepSeconds(-1);
        } else {
          // ← : 1프레임 뒤로
          this._stepFrame(-1);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+→ : 1초 앞으로
          this._stepSeconds(1);
        } else {
          // → : 1프레임 앞으로
          this._stepFrame(1);
        }
        break;

      case 'Home':
        e.preventDefault();
        this._seekToFrame(0);
        break;

      case 'End':
        e.preventDefault();
        this._seekToEnd();
        break;

      // 뷰 모드 전환: 1/2/3
      case 'Digit1':
        e.preventDefault();
        this._setViewMode('side-by-side');
        break;

      case 'Digit2':
        e.preventDefault();
        this._setViewMode('overlay');
        break;

      case 'Digit3':
        e.preventDefault();
        this._setViewMode('wipe');
        break;

      // [ ] 키: 오버레이 불투명도 / 와이프 위치 조절
      case 'BracketLeft':
        e.preventDefault();
        if (this._viewMode === 'overlay') {
          this._setOverlayOpacity(Math.max(0, this._overlayOpacity - 10));
        } else if (this._viewMode === 'wipe') {
          this._setWipePosition(Math.max(0, this._wipePosition - 5));
        }
        break;

      case 'BracketRight':
        e.preventDefault();
        if (this._viewMode === 'overlay') {
          this._setOverlayOpacity(Math.min(100, this._overlayOpacity + 10));
        } else if (this._viewMode === 'wipe') {
          this._setWipePosition(Math.min(100, this._wipePosition + 5));
        }
        break;

      default:
        break;
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

    // 시크바 (rAF 스로틀링 + 시각적 업데이트 분리로 드래그 개선)
    const seekbar = document.getElementById('splitSeekbar');
    const seekbarProgress = document.getElementById('splitSeekbarProgress');
    const seekbarHandle = document.getElementById('splitSeekbarHandle');
    let isDraggingSplitSeek = false;
    let lastSeekPercent = 0;

    const getPercentFromEvent = (e) => {
      if (!seekbar) return 0;
      const rect = seekbar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    };

    const updateSeekbarVisual = (percent) => {
      // 시각적 업데이트 (즉시 - 실제 seek 없이)
      if (seekbarProgress) seekbarProgress.style.width = `${percent * 100}%`;
      if (seekbarHandle) seekbarHandle.style.left = `${percent * 100}%`;
      lastSeekPercent = percent;

      // 타임코드도 퍼센트 기반으로 즉시 업데이트
      const video = this._mode === 'independent'
        ? (this._activePanel === 'left' ? this._leftVideo : this._rightVideo)
        : this._leftVideo;
      if (video && video.duration) {
        const previewTime = video.duration * percent;
        const currentEl = document.getElementById('splitTimecodeCurrent');
        if (currentEl) currentEl.textContent = this._formatTimecode(previewTime);
      }
    };

    seekbar?.addEventListener('mousedown', (e) => {
      isDraggingSplitSeek = true;
      const percent = getPercentFromEvent(e);
      updateSeekbarVisual(percent);
      this._seekToPercent(percent); // 첫 클릭은 즉시 seek
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDraggingSplitSeek) return;
      const percent = getPercentFromEvent(e);
      updateSeekbarVisual(percent);
      // rAF 스로틀링: 프레임당 최대 1회 seek
      if (!this._seekbarRafId) {
        this._seekbarRafId = requestAnimationFrame(() => {
          this._seekbarRafId = null;
          this._seekToPercent(lastSeekPercent);
        });
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDraggingSplitSeek) {
        isDraggingSplitSeek = false;
        this._seekToPercent(lastSeekPercent); // 최종 위치 정확 seek
        if (this._seekbarRafId) {
          cancelAnimationFrame(this._seekbarRafId);
          this._seekbarRafId = null;
        }
      }
    });
  }

  /**
   * 스플릿 뷰 열기
   * @param {Object} options - { leftVersion, rightVersion }
   */
  async open(options = {}) {
    if (this._isOpen) {
      log.warn('스플릿 뷰가 이미 열려 있음');
      return;
    }

    log.info('스플릿 뷰 열기 시작', options);

    // 오버레이 확인
    if (!this._overlay) {
      log.error('스플릿 뷰 오버레이를 찾을 수 없음');
      return;
    }

    // 버전 목록 가져오기
    const versions = this._versionManager.getAllVersions();
    log.info('버전 목록', { count: versions.length, versions });

    if (versions.length < 2) {
      log.warn('비교할 버전이 2개 이상 필요합니다');
      alert('버전 비교를 위해서는 2개 이상의 버전이 필요합니다.');
      return;
    }

    // 초기 버전 설정
    this._leftVersion = options.leftVersion || versions[0];
    this._rightVersion = options.rightVersion || versions[1];

    log.info('초기 버전 설정', { left: this._leftVersion, right: this._rightVersion });

    // 같은 버전이면 다른 버전으로 설정
    if (this._leftVersion.path === this._rightVersion.path && versions.length > 1) {
      this._rightVersion = versions.find((v) => v.path !== this._leftVersion.path) || versions[1];
      log.info('우측 버전 변경 (중복 방지)', { right: this._rightVersion });
    }

    // 오버레이 표시
    log.info('오버레이 표시');
    this._overlay.classList.add('open');
    this._isOpen = true;

    // 패널 초기화
    this._resetPanelSizes();
    this._setActivePanel('left');

    // 버전 셀렉터 렌더링
    this._renderVersionSelector('Left', this._leftVersion);
    this._renderVersionSelector('Right', this._rightVersion);

    // 뷰 모드 초기 버튼 상태 리셋
    document.getElementById('btnViewSideBySide')?.classList.add('active');
    document.getElementById('btnViewOverlay')?.classList.remove('active');
    document.getElementById('btnViewWipe')?.classList.remove('active');

    // 비디오 로드
    try {
      await this._loadVideo('left', this._leftVersion);
      await this._loadVideo('right', this._rightVersion);
    } catch (error) {
      log.error('비디오 로드 실패', error);
    }

    // 오디오 상태 초기화: 좌측 활성화, 우측 음소거
    this._resetAudioState();

    // 오버레이 버전 라벨 초기화
    this._updateOverlayVersionLabels();

    log.info('스플릿 뷰 열림 완료');
  }

  /**
   * 오디오 상태 초기화
   * 좌측: 볼륨 100%, 음소거 해제
   * 우측: 볼륨 100%, 음소거
   */
  _resetAudioState() {
    // 좌측 패널: 음소거 해제, 볼륨 100%
    if (this._leftVideo) {
      this._leftVideo.volume = 1;
      this._leftVideo.muted = false;
    }
    this._setMuted('left', false);

    // 우측 패널: 음소거, 볼륨 100% (음소거 해제 시 바로 들리도록)
    if (this._rightVideo) {
      this._rightVideo.volume = 1;
      this._rightVideo.muted = true;
    }
    this._setMuted('right', true);

    // 볼륨 슬라이더 초기화
    const sliderLeft = document.getElementById('volumeSliderLeft');
    const sliderRight = document.getElementById('volumeSliderRight');
    if (sliderLeft) sliderLeft.value = 100;
    if (sliderRight) sliderRight.value = 0;
  }

  /**
   * 스플릿 뷰 닫기
   * @param {Object} options - { skipSave: boolean }
   */
  async close(options = {}) {
    if (!this._isOpen) return;

    log.info('스플릿 뷰 닫기');

    // 재생 중지
    this._pause();

    // 닫기 전 콜백 호출 (저장 등 처리)
    // 향후 독립적인 댓글/드로잉 편집 기능 추가 시 여기서 양쪽 .bframe 저장
    if (this._onBeforeClose && !options.skipSave) {
      try {
        await this._onBeforeClose({
          leftVersion: this._leftVersion,
          rightVersion: this._rightVersion
        });
      } catch (error) {
        log.error('닫기 전 콜백 실패', error);
      }
    }

    // 비디오 정리 (GPT 권장: 리소스 완전 해제)
    if (this._leftVideo) {
      this._leftVideo.pause();
      this._leftVideo.playbackRate = 1.0; // 속도 초기화
      this._leftVideo.removeAttribute('src');
      this._leftVideo.load(); // GPU/디코더 리소스 해제 트리거
      this._leftVideo.muted = false;
      this._leftVideo.volume = 1;
    }
    if (this._rightVideo) {
      this._rightVideo.pause();
      this._rightVideo.playbackRate = 1.0;
      this._rightVideo.removeAttribute('src');
      this._rightVideo.load();
      this._rightVideo.muted = false;
      this._rightVideo.volume = 1;
    }

    // 동기화 상태 초기화
    this._lastSeekPerf = 0;
    this._lastUiFrame = -1;

    // 프레임 이동 디바운싱 상태 초기화
    if (this._frameStepRafId) cancelAnimationFrame(this._frameStepRafId);
    this._frameStepRafId = null;
    this._pendingFrame = undefined;
    if (this._seekbarRafId) cancelAnimationFrame(this._seekbarRafId);
    this._seekbarRafId = null;

    // 뷰 모드 초기화
    if (this._viewMode !== 'side-by-side') {
      this._exitOverlayLayout();
      this._overlay.classList.remove('view-overlay', 'view-wipe');
      this._viewMode = 'side-by-side';
    }

    // 자동 숨김 타이머 정리
    if (this._overlayAutoHideTimer) {
      clearTimeout(this._overlayAutoHideTimer);
      this._overlayAutoHideTimer = null;
    }

    // 오버레이 숨기기
    this._overlay.classList.remove('open');
    this._isOpen = false;

    // 닫기 완료 콜백 호출
    if (this._onClose) {
      this._onClose({
        leftVersion: this._leftVersion,
        rightVersion: this._rightVersion
      });
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
   * 닫기 전 콜백 설정 (저장 등 처리용)
   * @param {Function} callback - async function({ leftVersion, rightVersion })
   */
  onBeforeClose(callback) {
    this._onBeforeClose = callback;
  }

  /**
   * 열림 상태 확인
   * @returns {boolean}
   */
  isOpen() {
    return this._isOpen;
  }

  // ============================================
  // 뷰 모드 (나란히 / 오버레이 / 와이프)
  // ============================================

  /**
   * 뷰 모드 설정
   * @param {'side-by-side'|'overlay'|'wipe'} viewMode
   */
  _setViewMode(viewMode) {
    if (this._viewMode === viewMode) return;

    const prevMode = this._viewMode;
    this._viewMode = viewMode;

    log.info('뷰 모드 변경', { from: prevMode, to: viewMode });

    // 뷰 모드 버튼 상태 업데이트
    document.getElementById('btnViewSideBySide')?.classList.toggle('active', viewMode === 'side-by-side');
    document.getElementById('btnViewOverlay')?.classList.toggle('active', viewMode === 'overlay');
    document.getElementById('btnViewWipe')?.classList.toggle('active', viewMode === 'wipe');

    // 오버레이 CSS 클래스 업데이트
    this._overlay.classList.remove('view-overlay', 'view-wipe');
    if (viewMode === 'overlay') {
      this._overlay.classList.add('view-overlay');
    } else if (viewMode === 'wipe') {
      this._overlay.classList.add('view-wipe');
    }

    // 재생 모드 컨트롤: 나란히 보기에서만 표시
    const playbackControls = document.getElementById('splitPlaybackModeControls');
    if (playbackControls) {
      playbackControls.style.display = viewMode === 'side-by-side' ? 'flex' : 'none';
    }

    // 통합 버전 바: 오버레이/와이프에서만 표시
    const versionBar = document.getElementById('splitOverlayVersionBar');
    if (versionBar) {
      versionBar.style.display = viewMode === 'side-by-side' ? 'none' : 'flex';
    }

    // 기존 스왑 버튼: 나란히 보기에서만 표시 (CSS로도 숨기지만 명시적)
    const btnSwap = document.getElementById('btnSwapPanels');
    if (btnSwap) {
      btnSwap.style.display = viewMode === 'side-by-side' ? '' : 'none';
    }

    // 오버레이/와이프 모드에서는 동기 재생 강제
    if (viewMode !== 'side-by-side' && this._mode !== 'sync') {
      this._setMode('sync');
    }

    // 오버레이 컨트롤 표시/숨기기
    const overlayControls = document.getElementById('splitOverlayControls');
    if (overlayControls) {
      overlayControls.style.display = viewMode === 'overlay' ? '' : 'none';
    }

    // 와이프 디바이더 표시/숨기기
    const wipeDivider = document.getElementById('splitWipeDivider');
    if (wipeDivider) {
      wipeDivider.style.display = viewMode === 'wipe' ? '' : 'none';
    }

    // 모드별 초기화
    if (viewMode === 'side-by-side') {
      this._exitOverlayLayout();
    } else if (viewMode === 'overlay') {
      this._enterOverlayMode();
    } else if (viewMode === 'wipe') {
      this._enterWipeMode();
    }

    // 통합 버전 라벨 업데이트
    this._updateOverlayVersionLabels();
  }

  /**
   * 오버레이 모드 진입
   */
  _enterOverlayMode() {
    // 불투명도 적용
    this._applyOverlayOpacity();

    // 슬라이더 자동 숨김 시작
    this._startOverlayAutoHide();
  }

  /**
   * 와이프 모드 진입
   */
  _enterWipeMode() {
    // 와이프 위치 적용
    this._applyWipePosition();
  }

  /**
   * 오버레이/와이프 레이아웃 종료 → 나란히 보기 복원
   */
  _exitOverlayLayout() {
    // 오른쪽 패널 불투명도 복원
    if (this._panelRight) {
      this._panelRight.style.opacity = '';
    }

    // 패널 clip-path 제거
    if (this._panelLeft) this._panelLeft.style.clipPath = '';
    if (this._panelRight) this._panelRight.style.clipPath = '';

    // 패널 크기 복원
    this._resetPanelSizes();

    // 자동 숨김 타이머 제거
    if (this._overlayAutoHideTimer) {
      clearTimeout(this._overlayAutoHideTimer);
      this._overlayAutoHideTimer = null;
    }
  }

  /**
   * 통합 버전 라벨 업데이트
   */
  _updateOverlayVersionLabels() {
    const getVersionLabel = (version) => {
      if (!version) return '?';
      return version.version !== null && version.version !== undefined
        ? `v${version.version}`
        : '기준';
    };

    const leftLabel = getVersionLabel(this._leftVersion);
    const rightLabel = getVersionLabel(this._rightVersion);

    // 통합 바 라벨
    const overlayLabelLeft = document.getElementById('splitOverlayLabelLeft');
    const overlayLabelRight = document.getElementById('splitOverlayLabelRight');
    if (overlayLabelLeft) overlayLabelLeft.textContent = leftLabel;
    if (overlayLabelRight) overlayLabelRight.textContent = rightLabel;

    // 불투명도 슬라이더 라벨
    const sliderLabelLeft = document.getElementById('splitOverlaySliderLabelLeft');
    const sliderLabelRight = document.getElementById('splitOverlaySliderLabelRight');
    if (sliderLabelLeft) sliderLabelLeft.textContent = leftLabel;
    if (sliderLabelRight) sliderLabelRight.textContent = rightLabel;

    // 와이프 라벨
    const wipeLabelLeft = document.getElementById('splitWipeLabelLeft');
    const wipeLabelRight = document.getElementById('splitWipeLabelRight');
    if (wipeLabelLeft) wipeLabelLeft.textContent = leftLabel;
    if (wipeLabelRight) wipeLabelRight.textContent = rightLabel;
  }

  // ============================================
  // 불투명도 오버레이 컨트롤
  // ============================================

  /**
   * 불투명도 컨트롤 바인딩
   */
  _bindOverlayControls() {
    const slider = document.getElementById('splitOverlayOpacity');
    const controls = document.getElementById('splitOverlayControls');

    slider?.addEventListener('input', (e) => {
      this._setOverlayOpacity(parseInt(e.target.value, 10));
    });

    // 마우스 호버 시 자동 숨김 해제
    controls?.addEventListener('mouseenter', () => {
      controls.classList.remove('auto-hide');
      controls.classList.add('active');
      if (this._overlayAutoHideTimer) {
        clearTimeout(this._overlayAutoHideTimer);
      }
    });

    controls?.addEventListener('mouseleave', () => {
      controls.classList.remove('active');
      this._startOverlayAutoHide();
    });

    // 영상 영역에서 마우스 이동 시 슬라이더 표시
    const body = this._overlay?.querySelector('.split-view-body');
    body?.addEventListener('mousemove', () => {
      if (this._viewMode !== 'overlay') return;
      if (controls) {
        controls.classList.remove('auto-hide');
        this._startOverlayAutoHide();
      }
    });
  }

  /**
   * 불투명도 설정
   * @param {number} value - 0~100
   */
  _setOverlayOpacity(value) {
    this._overlayOpacity = value;

    // 슬라이더 동기화
    const slider = document.getElementById('splitOverlayOpacity');
    if (slider) slider.value = value;

    // 값 표시
    const valueEl = document.getElementById('splitOverlayOpacityValue');
    if (valueEl) valueEl.textContent = `${value}%`;

    // 슬라이더 배경 그라데이션 업데이트
    if (slider) {
      slider.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${value}%, var(--bg-tertiary) ${value}%, var(--bg-tertiary) 100%)`;
    }

    this._applyOverlayOpacity();

    // 자동 숨김 리셋
    const controls = document.getElementById('splitOverlayControls');
    if (controls) {
      controls.classList.remove('auto-hide');
      this._startOverlayAutoHide();
    }
  }

  /**
   * 불투명도를 비디오에 적용
   */
  _applyOverlayOpacity() {
    if (this._viewMode !== 'overlay') return;

    // 오른쪽(상단) 패널 전체의 불투명도 조절 (비디오 + 캔버스 포함)
    if (this._panelRight) {
      this._panelRight.style.opacity = this._overlayOpacity / 100;
    }
  }

  /**
   * 슬라이더 자동 숨김 시작 (3초 후)
   */
  _startOverlayAutoHide() {
    if (this._overlayAutoHideTimer) {
      clearTimeout(this._overlayAutoHideTimer);
    }
    this._overlayAutoHideTimer = setTimeout(() => {
      const controls = document.getElementById('splitOverlayControls');
      if (controls && !controls.classList.contains('active')) {
        controls.classList.add('auto-hide');
      }
    }, 3000);
  }

  // ============================================
  // 커튼 와이프 컨트롤
  // ============================================

  /**
   * 와이프 컨트롤 바인딩
   */
  _bindWipeControls() {
    const handle = document.getElementById('splitWipeHandle');
    const body = this._overlay?.querySelector('.split-view-body');

    if (!handle || !body) return;

    const onMouseDown = (e) => {
      if (this._viewMode !== 'wipe') return;
      e.preventDefault();
      this._isDraggingWipe = true;
      handle.style.cursor = 'ew-resize';
      document.body.style.cursor = 'ew-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!this._isDraggingWipe) return;

      const bodyRect = body.getBoundingClientRect();
      const percent = ((e.clientX - bodyRect.left) / bodyRect.width) * 100;
      const clamped = Math.max(2, Math.min(98, percent));

      requestAnimationFrame(() => {
        this._setWipePosition(clamped);
      });
    };

    const onMouseUp = () => {
      this._isDraggingWipe = false;
      handle.style.cursor = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);

    // 와이프 영역 클릭으로도 위치 변경
    body.addEventListener('mousedown', (e) => {
      if (this._viewMode !== 'wipe') return;
      // 핸들 자체 클릭은 무시 (핸들 드래그로 처리)
      if (e.target.closest('.split-wipe-handle')) return;
      // 와이프 디바이더 영역에서만 처리
      if (!e.target.closest('.split-wipe-divider') && !e.target.closest('.split-video-container') && !e.target.closest('.split-panel')) return;

      const bodyRect = body.getBoundingClientRect();
      const percent = ((e.clientX - bodyRect.left) / bodyRect.width) * 100;
      const clamped = Math.max(2, Math.min(98, percent));
      this._setWipePosition(clamped);

      // 클릭 후 드래그 가능하도록
      this._isDraggingWipe = true;
      document.body.style.cursor = 'ew-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  /**
   * 와이프 위치 설정
   * @param {number} percent - 0~100
   */
  _setWipePosition(percent) {
    this._wipePosition = percent;
    this._applyWipePosition();
  }

  /**
   * 와이프 위치를 DOM에 적용
   */
  _applyWipePosition() {
    if (this._viewMode !== 'wipe') return;

    const percent = this._wipePosition;

    // 패널 clip-path 업데이트
    if (this._panelLeft) {
      this._panelLeft.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    }
    if (this._panelRight) {
      this._panelRight.style.clipPath = `inset(0 0 0 ${percent}%)`;
    }

    // 디바이더 위치 업데이트
    const divider = document.getElementById('splitWipeDivider');
    if (divider) {
      divider.style.left = `${percent}%`;
    }
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
    // 오버레이/와이프 모드에서는 독립 모드 불가
    if (this._viewMode !== 'side-by-side' && mode === 'independent') {
      log.warn('오버레이/와이프 모드에서는 독립 재생을 사용할 수 없습니다');
      return;
    }

    this._mode = mode;

    // 버튼 상태 업데이트
    document.getElementById('btnSyncMode')?.classList.toggle('active', mode === 'sync');
    document.getElementById('btnIndependentMode')?.classList.toggle('active', mode === 'independent');

    // 오버레이 클래스 업데이트
    this._overlay.classList.toggle('independent-mode', mode === 'independent');

    // 타임코드 업데이트 (독립 모드에서 [좌]/[우] 표시)
    this._updateTimecode();

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

    // 독립 모드일 때 타임코드 업데이트 (활성 패널 표시 및 해당 패널의 프레임 정보)
    if (this._mode === 'independent') {
      this._updateTimecode();
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

    // 오버레이 버전 라벨 업데이트
    this._updateOverlayVersionLabels();
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
    const statusText = loadingOverlay?.querySelector('.split-loading-text');
    const panelSuffix = panel === 'left' ? 'Left' : 'Right';
    const progressBar = document.getElementById(`splitLoadingProgress${panelSuffix}`);
    const progressFill = document.getElementById(`splitLoadingProgressFill${panelSuffix}`);

    if (!video || !versionInfo?.path) {
      emptyState?.classList.add('active');
      return;
    }

    // 로딩 표시
    loadingOverlay?.classList.add('active');
    emptyState?.classList.remove('active');
    if (statusText) statusText.textContent = '로딩 중...';
    progressBar?.classList.remove('visible');
    if (progressFill) progressFill.style.width = '0%';

    try {
      // ====== 코덱 확인 및 트랜스코딩 ======
      let actualVideoPath = versionInfo.path;

      // FFmpeg 사용 가능 여부 확인
      const ffmpegAvailable = await window.electronAPI.ffmpegIsAvailable();

      if (ffmpegAvailable) {
        const codecInfo = await window.electronAPI.ffmpegProbeCodec(versionInfo.path);

        if (codecInfo.success && !codecInfo.isSupported) {
          log.info('Split View: 미지원 코덱 감지', { panel, codec: codecInfo.codecName });
          if (statusText) statusText.textContent = `코덱 변환 중... (${codecInfo.codecName})`;
          progressBar?.classList.add('visible');

          // 캐시 확인
          const cacheResult = await window.electronAPI.ffmpegCheckCache(versionInfo.path);
          if (cacheResult.valid) {
            log.info('Split View: 캐시된 변환 파일 사용', { panel, path: cacheResult.convertedPath });
            actualVideoPath = cacheResult.convertedPath;
          } else {
            // 트랜스코딩 필요 - 진행률 표시
            const progressHandler = (data) => {
              if (data.filePath === versionInfo.path) {
                if (statusText) statusText.textContent = `코덱 변환 중... ${data.progress}%`;
                if (progressFill) progressFill.style.width = `${data.progress}%`;
              }
            };
            window.electronAPI.onTranscodeProgress(progressHandler);

            try {
              const transcodeResult = await window.electronAPI.ffmpegTranscode(versionInfo.path);

              if (transcodeResult.success) {
                log.info('Split View: 트랜스코딩 완료', { panel, outputPath: transcodeResult.outputPath });
                actualVideoPath = transcodeResult.outputPath;
              } else {
                throw new Error(transcodeResult.error || '변환 실패');
              }
            } finally {
              // 리스너 정리
              window.electronAPI.removeAllListeners?.('ffmpeg:transcode-progress');
            }
          }
        }
      }

      if (statusText) statusText.textContent = '비디오 로딩 중...';

      // 비디오 소스 설정 (변환된 경로 또는 원본 경로)
      video.src = actualVideoPath;

      // 메타데이터 로드 대기
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = (e) => reject(new Error('비디오 로드 실패: ' + (e.message || '알 수 없는 오류')));
      });

      log.info('비디오 로드 완료', { panel, path: actualVideoPath, originalPath: versionInfo.path });

      // 오디오 초기 상태 설정 (좌측: 소리 켜짐, 우측: 음소거)
      video.volume = 1;
      video.muted = panel === 'right';

      // 타임코드 업데이트
      this._updateTimecode();
    } catch (error) {
      log.error('비디오 로드 실패', { panel, error: error.message });
      emptyState?.classList.add('active');

      // 에러 메시지 표시
      const emptyText = emptyState?.querySelector('.split-empty-text');
      if (emptyText) {
        emptyText.textContent = `로드 실패: ${error.message}`;
      }
    } finally {
      loadingOverlay?.classList.remove('active');
    }
  }

  /**
   * 좌우 패널 교환
   */
  _swapPanels() {
    // 현재 재생 위치와 상태 저장
    const leftTime = this._leftVideo?.currentTime || 0;
    const rightTime = this._rightVideo?.currentTime || 0;
    const leftMuted = this._leftVideo ? this._leftVideo.muted : false;
    const rightMuted = this._rightVideo ? this._rightVideo.muted : true;
    const wasPlaying = this._isPlaying;

    // 일시정지
    if (wasPlaying) this._pause();

    // 버전 정보 교환
    const tempVersion = this._leftVersion;
    this._leftVersion = this._rightVersion;
    this._rightVersion = tempVersion;

    // 비디오 소스 교환
    if (this._leftVideo && this._rightVideo) {
      const tempSrc = this._leftVideo.src;
      this._leftVideo.src = this._rightVideo.src;
      this._rightVideo.src = tempSrc;

      // 메타데이터 로드 후 재생 위치 복원
      const restorePlayback = () => {
        this._leftVideo.currentTime = rightTime;
        this._rightVideo.currentTime = leftTime;

        // 음소거 상태 교환
        this._setMuted('left', rightMuted);
        this._setMuted('right', leftMuted);

        // 이전에 재생 중이었으면 재생 재개
        if (wasPlaying) this._play();
      };

      // 비디오 로드 대기
      let loadCount = 0;
      const onLoaded = () => {
        loadCount++;
        if (loadCount >= 2) restorePlayback();
      };

      this._leftVideo.onloadedmetadata = onLoaded;
      this._rightVideo.onloadedmetadata = onLoaded;
    }

    // 셀렉터 다시 렌더링
    this._renderVersionSelector('Left', this._leftVersion);
    this._renderVersionSelector('Right', this._rightVersion);

    // 오버레이 버전 라벨 업데이트
    this._updateOverlayVersionLabels();

    log.info('패널 교환됨');
  }

  /**
   * 음소거 토글
   * @param {'left'|'right'} panel
   */
  _toggleMute(panel) {
    const video = panel === 'left' ? this._leftVideo : this._rightVideo;
    const btn = document.getElementById(`btnMute${panel === 'left' ? 'Left' : 'Right'}`);
    const slider = document.getElementById(`volumeSlider${panel === 'left' ? 'Left' : 'Right'}`);

    if (!video || !btn) return;

    const wasMuted = video.muted;
    video.muted = !video.muted;
    btn.classList.toggle('muted', video.muted);
    this._updateMuteIcon(btn, video.muted);

    // Solo Audio: 방금 언뮤트 했다면 반대쪽은 뮤트 (GPT 권장)
    if (this._soloAudio && wasMuted === true && video.muted === false) {
      const otherPanel = panel === 'left' ? 'right' : 'left';
      this._setMuted(otherPanel, true);
      log.debug('Solo Audio: 반대쪽 자동 뮤트', { otherPanel });
    }

    // 음소거 해제 시 볼륨이 0이면 50%로 설정
    if (!video.muted && video.volume === 0) {
      video.volume = 0.5;
      if (slider) slider.value = 50;
    }

    // 재생 중이면 타임 업데이트 루프 재시작 (마스터 변경 반영)
    if (this._isPlaying && this._mode === 'sync') {
      this._startTimeUpdate();
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
    const slider = document.getElementById(`volumeSlider${panel === 'left' ? 'Left' : 'Right'}`);

    if (!video) return;

    video.muted = muted;
    btn?.classList.toggle('muted', muted);
    this._updateMuteIcon(btn, muted);

    // 슬라이더 동기화 (음소거 시 0, 해제 시 현재 볼륨 또는 100)
    if (slider) {
      slider.value = muted ? 0 : (video.volume * 100 || 100);
    }
  }

  /**
   * 볼륨 설정
   * @param {'left'|'right'} panel
   * @param {number} volume - 0~1
   */
  _setVolume(panel, volume) {
    const video = panel === 'left' ? this._leftVideo : this._rightVideo;
    const btn = document.getElementById(`btnMute${panel === 'left' ? 'Left' : 'Right'}`);
    const slider = document.getElementById(`volumeSlider${panel === 'left' ? 'Left' : 'Right'}`);

    if (!video) return;

    video.volume = Math.max(0, Math.min(1, volume));

    // 볼륨이 0이면 음소거 상태로 표시
    if (volume === 0) {
      video.muted = true;
      btn?.classList.add('muted');
      this._updateMuteIcon(btn, true);
    } else if (video.muted) {
      // 볼륨을 올리면 음소거 해제
      video.muted = false;
      btn?.classList.remove('muted');
      this._updateMuteIcon(btn, false);
    }

    // 슬라이더 동기화
    if (slider) slider.value = volume * 100;

    log.debug('볼륨 설정', { panel, volume });
  }

  /**
   * 음소거 아이콘 업데이트
   * @param {HTMLElement} btn
   * @param {boolean} muted
   */
  _updateMuteIcon(btn, muted) {
    if (!btn) return;

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
    const EPS = 0.001;

    // 수동 프레임 이동 시 동기화 루프 쿨다운 설정
    this._manualStepUntil = performance.now() + 100;

    // 이전 seek rAF 취소 (빠른 연속 입력 시 마지막 프레임만 실제 seek)
    if (this._frameStepRafId) {
      cancelAnimationFrame(this._frameStepRafId);
    }

    // 현재 프레임 계산 기준: _pendingFrame이 있으면 그 값 사용 (연속 입력 대응)
    let baseFrame;
    if (this._mode === 'sync') {
      if (!this._leftVideo) return;
      baseFrame = this._pendingFrame !== undefined
        ? this._pendingFrame
        : Math.floor(this._leftVideo.currentTime * this._fps);
    } else {
      const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
      if (!video) return;
      baseFrame = this._pendingFrame !== undefined
        ? this._pendingFrame
        : Math.floor(video.currentTime * this._fps);
    }

    const targetFrame = Math.max(0, baseFrame + delta);
    const targetTime = targetFrame / this._fps + EPS;

    // pending 프레임 저장 (연속 입력 시 누적 계산용)
    this._pendingFrame = targetFrame;

    // 타임코드 즉시 업데이트 (pending 프레임 기반 - video.currentTime 미사용)
    this._updateTimecodeForFrame(targetFrame);

    // 실제 video seek는 rAF로 배치
    this._frameStepRafId = requestAnimationFrame(() => {
      this._frameStepRafId = null;
      this._pendingFrame = undefined; // seek 완료 후 초기화

      if (this._mode === 'sync') {
        if (this._leftVideo) {
          const clampedTime = Math.min(targetTime, this._leftVideo.duration - EPS);
          this._leftVideo.currentTime = clampedTime;
          if (this._rightVideo) {
            this._rightVideo.currentTime = Math.min(clampedTime, this._rightVideo.duration - EPS);
          }
        }
      } else {
        const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
        if (video) {
          video.currentTime = Math.min(targetTime, video.duration - EPS);
        }
      }

      this._updateTimecode(); // 실제 seek 후 정확한 타임코드 반영
    });
  }

  /**
   * 초 단위 이동
   * @param {number} delta - 이동할 초 수
   */
  _stepSeconds(delta) {
    if (this._mode === 'sync') {
      // 동기 모드: 양쪽 모두 같은 시간으로 이동
      if (this._leftVideo) {
        const newTime = Math.max(0, Math.min(this._leftVideo.duration, this._leftVideo.currentTime + delta));
        this._leftVideo.currentTime = newTime;
        if (this._rightVideo) {
          // 프레임 기준 동기화
          const targetFrame = Math.round(newTime * this._fps);
          this._rightVideo.currentTime = targetFrame / this._fps;
        }
      }
    } else {
      // 독립 모드: 활성 패널만 이동
      const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
      if (video) {
        video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta));
      }
    }

    this._updateTimecode();
  }

  /**
   * 특정 프레임으로 이동
   * @param {number} frame
   */
  _seekToFrame(frame) {
    const time = frame / this._fps;

    if (this._mode === 'sync') {
      if (this._leftVideo) this._leftVideo.currentTime = time;
      if (this._rightVideo) this._rightVideo.currentTime = time;
    } else {
      const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
      if (video) video.currentTime = time;
    }

    this._updateTimecode();
  }

  /**
   * 끝으로 이동
   */
  _seekToEnd() {
    if (this._mode === 'sync') {
      if (this._leftVideo) this._leftVideo.currentTime = this._leftVideo.duration;
      if (this._rightVideo) this._rightVideo.currentTime = this._rightVideo.duration;
    } else {
      const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
      if (video) video.currentTime = video.duration;
    }
    this._updateTimecode();
  }

  /**
   * 퍼센트 위치로 이동
   * @param {number} percent - 0~1
   */
  _seekToPercent(percent) {
    // 스크러빙 중 동기화 바이패스
    this._isScrubbing = true;
    clearTimeout(this._scrubTimeout);
    this._scrubTimeout = setTimeout(() => {
      this._isScrubbing = false;
    }, 150);

    if (this._mode === 'sync') {
      // 동기 모드: 같은 프레임 번호 기준으로 이동
      if (this._leftVideo) {
        const targetFrame = Math.round(this._leftVideo.duration * percent * this._fps);
        const time = targetFrame / this._fps;
        this._leftVideo.currentTime = time;
        if (this._rightVideo) this._rightVideo.currentTime = time;
      }
    } else {
      // 독립 모드: 활성 패널만 이동
      const video = this._activePanel === 'left' ? this._leftVideo : this._rightVideo;
      if (video) video.currentTime = video.duration * percent;
    }
    this._updateTimecode();
  }

  // ============================================
  // 하이브리드 동기화 헬퍼 메서드 (GPT 권장)
  // ============================================

  /**
   * 오디오 마스터 측 결정
   * 소리가 나는 비디오를 마스터로, 동기화는 슬레이브에만 적용
   * @returns {'left'|'right'}
   */
  _getAudioMasterSide() {
    const left = this._leftVideo;
    const right = this._rightVideo;
    if (!left || !right) return 'left';

    const leftAudible = !left.muted && left.volume > 0;
    const rightAudible = !right.muted && right.volume > 0;

    if (leftAudible && !rightAudible) return 'left';
    if (rightAudible && !leftAudible) return 'right';

    // 둘 다 뮤트거나 둘 다 들리면: 기본은 left
    return 'left';
  }

  /**
   * 안전한 시크 (fastSeek 지원 시 사용)
   * @param {HTMLVideoElement} video
   * @param {number} timeSec
   */
  _seekMedia(video, timeSec) {
    if (!video || !Number.isFinite(timeSec)) return;

    const duration = Number.isFinite(video.duration) ? video.duration : timeSec;
    const EPS = 0.001; // 프레임 경계 오차 방지
    const clamped = Math.max(0, Math.min(timeSec, Math.max(0, duration - EPS)));

    try {
      if (typeof video.fastSeek === 'function') {
        video.fastSeek(clamped);
      } else {
        video.currentTime = clamped;
      }
    } catch (e) {
      log.warn('시크 실패', e);
    }
  }

  /**
   * 선형 보간
   */
  _lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * 값 제한
   */
  _clamp(x, min, max) {
    return Math.max(min, Math.min(max, x));
  }

  // ============================================
  // 타임 업데이트 (하이브리드 동기화)
  // ============================================

  /**
   * 타임 업데이트 시작 (하이브리드 동기화)
   * - 오디오 마스터 규칙: 소리 나는 쪽은 건드리지 않음
   * - playbackRate로 부드럽게 수렴, 큰 차이만 seek로 복구
   * - requestVideoFrameCallback 우선 사용
   */
  _startTimeUpdate() {
    // 중복 루프 방지
    this._stopTimeUpdate();

    const tick = (now) => {
      if (!this._isPlaying) return;

      // 동기화 상수 (성능 최적화)
      const fps = this._fps;
      const deadbandSec = 0.5 / fps;     // 0.5프레임 이내는 무시
      const seekThresholdSec = 2 / fps;  // 2프레임 이상 벌어지면 seek 고려
      const seekCooldownMs = 100;        // seek 최소 간격 (250→100)
      const RATE_GAIN = 0.5;             // diff(초)에 비례한 보정 (0.35→0.5)
      const MAX_ADJUST = 0.06;           // ±6%
      const SMOOTH = 0.4;                // rate 변화 스무딩 (0.25→0.4)

      // 1) UI 업데이트 최적화: 프레임이 바뀔 때만
      if (this._mode === 'sync' && this._leftVideo) {
        const masterSide = this._getAudioMasterSide();
        const master = masterSide === 'left' ? this._leftVideo : this._rightVideo;
        if (master) {
          const frame = Math.floor(master.currentTime * fps);
          if (frame !== this._lastUiFrame) {
            this._lastUiFrame = frame;
            this._updateTimecode();
          }
        }
      } else {
        // independent 모드는 기존대로
        this._updateTimecode();
      }

      // 2) 하이브리드 동기화 (sync 모드에서만)
      if (this._mode === 'sync' && this._leftVideo && this._rightVideo) {
        // 수동 프레임 이동 또는 스크러빙 중에는 동기화 보정 스킵
        if ((this._manualStepUntil && now < this._manualStepUntil) || this._isScrubbing) {
          this._scheduleNextTick(tick);
          return;
        }

        const masterSide = this._getAudioMasterSide();
        const master = masterSide === 'left' ? this._leftVideo : this._rightVideo;
        const slave = masterSide === 'left' ? this._rightVideo : this._leftVideo;

        // seeking 중에는 싸우지 않기
        if (!master.seeking && !slave.seeking) {
          const diff = master.currentTime - slave.currentTime;
          const absDiff = Math.abs(diff);

          // (A) 큰 차이: 드물게 seek로 즉시 복구
          if (absDiff >= seekThresholdSec) {
            const sinceLastSeek = now - (this._lastSeekPerf || 0);
            if (sinceLastSeek >= seekCooldownMs) {
              this._seekMedia(slave, master.currentTime);
              slave.playbackRate = 1.0;
              this._lastSeekPerf = now;
              log.debug('동기화 seek', { diff: diff.toFixed(3), masterSide });
            }
          }
          // (B) 작은 차이: playbackRate로 부드럽게 수렴
          else if (absDiff > deadbandSec) {
            const targetRate = 1 + this._clamp(diff * RATE_GAIN, -MAX_ADJUST, +MAX_ADJUST);
            slave.playbackRate = this._lerp(slave.playbackRate || 1, targetRate, SMOOTH);
          }
          // (C) 충분히 붙었으면 1.0으로 복귀
          else {
            slave.playbackRate = this._lerp(slave.playbackRate || 1, 1.0, SMOOTH);
          }

          // 마스터는 항상 1.0 유지
          master.playbackRate = 1.0;
        }
      }

      // 3) 다음 틱 스케줄
      this._scheduleNextTick(tick);
    };

    // 최초 스케줄
    this._scheduleNextTick(tick);
  }

  /**
   * 다음 틱 스케줄 (RVFC 우선, 없으면 RAF)
   * @param {Function} tick
   */
  _scheduleNextTick(tick) {
    const masterSide = this._getAudioMasterSide();
    const master = (this._mode === 'sync')
      ? (masterSide === 'left' ? this._leftVideo : this._rightVideo)
      : null;

    // requestVideoFrameCallback 사용 가능하면 우선 사용
    if (master && typeof master.requestVideoFrameCallback === 'function') {
      this._timeUpdateType = 'rvfc';
      this._timeUpdateVideo = master;
      this._animationFrameId = master.requestVideoFrameCallback((now) => tick(now));
    } else {
      this._timeUpdateType = 'raf';
      this._timeUpdateVideo = null;
      this._animationFrameId = requestAnimationFrame((t) => tick(t));
    }
  }

  /**
   * 타임 업데이트 중지
   */
  _stopTimeUpdate() {
    if (!this._animationFrameId) return;

    if (this._timeUpdateType === 'rvfc' && this._timeUpdateVideo?.cancelVideoFrameCallback) {
      this._timeUpdateVideo.cancelVideoFrameCallback(this._animationFrameId);
    } else {
      cancelAnimationFrame(this._animationFrameId);
    }

    this._animationFrameId = null;
    this._timeUpdateType = null;
    this._timeUpdateVideo = null;
  }

  /**
   * 타임코드 업데이트
   */
  _updateTimecode() {
    // 독립 모드에서는 활성 패널 기준, 동기 모드에서는 좌측 기준
    const video = this._mode === 'independent'
      ? (this._activePanel === 'left' ? this._leftVideo : this._rightVideo)
      : this._leftVideo;

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

    // 독립 모드에서는 어떤 패널인지 표시
    const panelIndicator = this._mode === 'independent'
      ? `[${this._activePanel === 'left' ? '좌' : '우'}] `
      : '';
    if (frameInfoEl) frameInfoEl.textContent = `${panelIndicator}${this._fps}fps · Frame ${currentFrame} / ${totalFrames}`;

    // 시크바 업데이트
    const progress = document.getElementById('splitSeekbarProgress');
    const handle = document.getElementById('splitSeekbarHandle');

    if (progress) progress.style.width = `${percent}%`;
    if (handle) handle.style.left = `${percent}%`;
  }

  /**
   * 특정 프레임 기준으로 타임코드 즉시 업데이트 (video.currentTime 미사용)
   * 빠른 프레임 이동 시 rAF 지연 전에 UI를 즉시 반영하기 위해 사용
   * @param {number} frame - 표시할 프레임 번호
   */
  _updateTimecodeForFrame(frame) {
    const video = this._mode === 'independent'
      ? (this._activePanel === 'left' ? this._leftVideo : this._rightVideo)
      : this._leftVideo;
    if (!video) return;

    const duration = video.duration || 0;
    const current = frame / this._fps;
    const percent = duration > 0 ? (current / duration) * 100 : 0;

    const currentEl = document.getElementById('splitTimecodeCurrent');
    const totalEl = document.getElementById('splitTimecodeTotal');
    const frameInfoEl = document.getElementById('splitFrameInfo');

    if (currentEl) currentEl.textContent = this._formatTimecode(current);
    if (totalEl) totalEl.textContent = this._formatTimecode(duration);

    const totalFrames = Math.floor(duration * this._fps);
    const panelIndicator = this._mode === 'independent'
      ? `[${this._activePanel === 'left' ? '좌' : '우'}] ` : '';
    if (frameInfoEl) frameInfoEl.textContent = `${panelIndicator}${this._fps}fps · Frame ${frame} / ${totalFrames}`;

    // 시크바도 업데이트
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

    // Math.round로 부동소수점 오차 방지
    const totalFrames = Math.round(seconds * this._fps);
    const f = totalFrames % this._fps;
    const totalSeconds = Math.floor(totalFrames / this._fps);
    const s = totalSeconds % 60;
    const m = Math.floor((totalSeconds % 3600) / 60);
    const h = Math.floor(totalSeconds / 3600);

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
