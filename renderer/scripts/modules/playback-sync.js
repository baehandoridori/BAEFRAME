/**
 * BAEFRAME - Playback Sync (Broadcast 기반)
 * 동일 세션 사용자 간 재생 상태 동기화
 *
 * 기능:
 * - 재생/일시정지/탐색 브로드캐스트
 * - 동기화 on/off 토글
 * - 리더 모드: lead (내가 주도) / follow (팔로잉)
 * - 무한 루프 방지 (타이머 기반 isRemoteUpdate)
 * - 탐색 쓰로틀링 (100ms)
 */

import { createLogger } from '../logger.js';

const log = createLogger('PlaybackSync');

const PREFIX = 'PLAYBACK_';

// 리모트 업데이트 플래그 유지 시간 (ms)
// videoPlayer.play()/pause()는 비동기로 native 이벤트를 발생시키므로
// 동기적 플래그 리셋으로는 루프 방지 불가 → 타이머로 유지
const REMOTE_UPDATE_GUARD_MS = 300;

/**
 * 재생 동기화 매니저
 */
export class PlaybackSync extends EventTarget {
  constructor({ liveblocksManager }) {
    super();

    this._lm = liveblocksManager;

    // 동기화 상태
    this._syncEnabled = false;
    this._leaderMode = 'lead'; // 'lead' | 'follow'

    // 무한 루프 방지 (타이머 기반)
    this._isRemoteUpdate = false;
    this._remoteUpdateTimer = null;

    // 탐색 쓰로틀
    this._seekThrottleTimer = null;
    this._pendingSeekTime = null;
    this._seekThrottleMs = 100;

    // 이벤트 핸들러 바인딩
    this._onBroadcast = this._onBroadcast.bind(this);

    this._started = false;

    log.info('PlaybackSync 초기화됨');
  }

  // ============================================================================
  // 시작/중지
  // ============================================================================

  start() {
    if (this._started) return;
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);
    this._started = true;
    log.info('재생 동기화 시작됨');
  }

  stop() {
    this._lm.removeEventListener('broadcastReceived', this._onBroadcast);
    if (this._seekThrottleTimer) {
      clearTimeout(this._seekThrottleTimer);
      this._seekThrottleTimer = null;
    }
    if (this._remoteUpdateTimer) {
      clearTimeout(this._remoteUpdateTimer);
      this._remoteUpdateTimer = null;
    }
    this._started = false;
    this._syncEnabled = false;
    this._isRemoteUpdate = false;
    log.info('재생 동기화 중지됨');
  }

  // ============================================================================
  // 설정
  // ============================================================================

  setSyncEnabled(enabled) {
    this._syncEnabled = enabled;
    log.info(`동기화 ${enabled ? '활성화' : '비활성화'}`);
    this.dispatchEvent(new CustomEvent('syncStateChanged', {
      detail: { enabled }
    }));
  }

  get syncEnabled() {
    return this._syncEnabled;
  }

  setLeaderMode(mode) {
    if (mode !== 'lead' && mode !== 'follow') return;
    this._leaderMode = mode;
    log.info(`리더 모드 변경: ${mode}`);
    this.dispatchEvent(new CustomEvent('leaderModeChanged', {
      detail: { mode }
    }));
  }

  get leaderMode() {
    return this._leaderMode;
  }

  // ============================================================================
  // 로컬 → 리모트 (브로드캐스트 송신)
  // ============================================================================

  broadcastPlay(time) {
    if (!this._canSend()) return;
    this._lm.broadcastEvent({ type: `${PREFIX}PLAY`, time });
    log.info('재생 브로드캐스트', { time });
  }

  broadcastPause(time) {
    if (!this._canSend()) return;
    this._lm.broadcastEvent({ type: `${PREFIX}PAUSE`, time });
    log.info('일시정지 브로드캐스트', { time });
  }

  broadcastSeek(time) {
    if (!this._canSend()) return;
    this._pendingSeekTime = time;
    if (!this._seekThrottleTimer) {
      this._flushSeek();
      this._seekThrottleTimer = setTimeout(() => {
        this._seekThrottleTimer = null;
        if (this._pendingSeekTime !== null) {
          this._flushSeek();
        }
      }, this._seekThrottleMs);
    }
  }

  _flushSeek() {
    if (this._pendingSeekTime === null) return;
    const time = this._pendingSeekTime;
    this._pendingSeekTime = null;
    this._lm.broadcastEvent({ type: `${PREFIX}SEEK`, time });
  }

  // ============================================================================
  // 리모트 → 로컬 (브로드캐스트 수신)
  // ============================================================================

  _onBroadcast(e) {
    const event = e.detail?.event;
    if (!event || !event.type?.startsWith(PREFIX)) return;
    if (!this._syncEnabled) return;

    // follow 모드가 아니면 리모트 명령 무시
    if (this._leaderMode !== 'follow') return;

    const type = event.type.replace(PREFIX, '');

    switch (type) {
      case 'PLAY':
        log.info('리모트 재생 수신', { time: event.time });
        this._setRemoteGuard();
        this.dispatchEvent(new CustomEvent('remotePlay', {
          detail: { time: event.time }
        }));
        break;

      case 'PAUSE':
        log.info('리모트 일시정지 수신', { time: event.time });
        this._setRemoteGuard();
        this.dispatchEvent(new CustomEvent('remotePause', {
          detail: { time: event.time }
        }));
        break;

      case 'SEEK':
        log.info('리모트 탐색 수신', { time: event.time });
        this._setRemoteGuard();
        this.dispatchEvent(new CustomEvent('remoteSeek', {
          detail: { time: event.time }
        }));
        break;
    }
  }

  // ============================================================================
  // 유틸리티
  // ============================================================================

  /**
   * 리모트 업데이트 가드 설정
   * videoPlayer.play()/pause()는 비동기로 native 이벤트를 트리거하므로
   * 동기 플래그 리셋으로는 루프 방지 불가 → 타이머로 일정 시간 유지
   */
  _setRemoteGuard() {
    this._isRemoteUpdate = true;
    if (this._remoteUpdateTimer) {
      clearTimeout(this._remoteUpdateTimer);
    }
    this._remoteUpdateTimer = setTimeout(() => {
      this._isRemoteUpdate = false;
      this._remoteUpdateTimer = null;
    }, REMOTE_UPDATE_GUARD_MS);
  }

  _canBroadcast() {
    return this._started && this._lm.isConnected && this._lm.hasOtherCollaborators();
  }

  _canSend() {
    if (!this._syncEnabled) return false;
    if (this._isRemoteUpdate) return false;
    if (!this._canBroadcast()) return false;
    // follow 모드에서는 송신 불가 (받기만 함)
    if (this._leaderMode === 'follow') return false;
    return true;
  }

  get isRemoteUpdate() {
    return this._isRemoteUpdate;
  }
}

// 싱글톤
let instance = null;

export function getPlaybackSync(liveblocksManager) {
  if (!instance && liveblocksManager) {
    instance = new PlaybackSync({ liveblocksManager });
  }
  return instance;
}

export default PlaybackSync;
