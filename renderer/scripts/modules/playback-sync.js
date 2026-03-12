/**
 * BAEFRAME - Playback Sync (Broadcast 기반)
 * 동일 세션 사용자 간 재생 상태 동기화
 *
 * 기능:
 * - 재생/일시정지/탐색 브로드캐스트
 * - 동기화 on/off 토글
 * - 리더 모드: anyone (누구나 주도) / host (호스트만 주도)
 * - 무한 루프 방지 (isRemoteUpdate 플래그)
 * - 탐색 쓰로틀링 (100ms)
 */

import { createLogger } from '../logger.js';

const log = createLogger('PlaybackSync');

// 브로드캐스트 이벤트 타입 접두사
const PREFIX = 'PLAYBACK_';

/**
 * 재생 동기화 매니저
 */
export class PlaybackSync extends EventTarget {
  constructor({ liveblocksManager }) {
    super();

    this._lm = liveblocksManager;

    // 동기화 상태
    this._syncEnabled = false;
    this._leaderMode = 'anyone'; // 'anyone' | 'host'
    this._isHost = false;

    // 무한 루프 방지
    this._isRemoteUpdate = false;

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

  /**
   * 동기화 시작 (Liveblocks 연결 후 호출)
   */
  start() {
    if (this._started) return;

    this._lm.addEventListener('broadcastReceived', this._onBroadcast);
    this._started = true;

    log.info('재생 동기화 시작됨');
  }

  /**
   * 동기화 중지
   */
  stop() {
    this._lm.removeEventListener('broadcastReceived', this._onBroadcast);

    if (this._seekThrottleTimer) {
      clearTimeout(this._seekThrottleTimer);
      this._seekThrottleTimer = null;
    }

    this._started = false;
    this._syncEnabled = false;

    log.info('재생 동기화 중지됨');
  }

  // ============================================================================
  // 설정
  // ============================================================================

  /**
   * 동기화 활성/비활성
   */
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

  /**
   * 리더 모드 설정
   */
  setLeaderMode(mode) {
    if (mode !== 'anyone' && mode !== 'host') return;
    this._leaderMode = mode;
    log.info(`리더 모드 변경: ${mode}`);

    // 모드 변경을 다른 사용자에게 알림
    if (this._canBroadcast()) {
      this._lm.broadcastEvent({
        type: `${PREFIX}SYNC_MODE`,
        mode,
      });
    }

    this.dispatchEvent(new CustomEvent('leaderModeChanged', {
      detail: { mode }
    }));
  }

  get leaderMode() {
    return this._leaderMode;
  }

  /**
   * 호스트 여부 설정
   */
  setHost(isHost) {
    this._isHost = isHost;
  }

  // ============================================================================
  // 로컬 → 리모트 (브로드캐스트 송신)
  // ============================================================================

  /**
   * 재생 브로드캐스트
   */
  broadcastPlay(time) {
    if (!this._canSend()) return;

    this._lm.broadcastEvent({
      type: `${PREFIX}PLAY`,
      time,
    });

    log.info('재생 브로드캐스트', { time });
  }

  /**
   * 일시정지 브로드캐스트
   */
  broadcastPause(time) {
    if (!this._canSend()) return;

    this._lm.broadcastEvent({
      type: `${PREFIX}PAUSE`,
      time,
    });

    log.info('일시정지 브로드캐스트', { time });
  }

  /**
   * 탐색 브로드캐스트 (100ms 쓰로틀)
   */
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

    this._lm.broadcastEvent({
      type: `${PREFIX}SEEK`,
      time,
    });
  }

  // ============================================================================
  // 리모트 → 로컬 (브로드캐스트 수신)
  // ============================================================================

  _onBroadcast(e) {
    const event = e.detail?.event;
    if (!event || !event.type?.startsWith(PREFIX)) return;

    // 동기화 비활성 시 무시
    if (!this._syncEnabled) return;

    // 호스트 모드에서 비호스트 사용자의 조작 무시
    // (호스트 모드라면, 보내는 쪽에서 이미 _canSend()로 차단하므로
    //  여기서는 추가 필터링 불필요 — 수신된 건 항상 유효한 리더)

    const type = event.type.replace(PREFIX, '');

    switch (type) {
      case 'PLAY':
        log.info('리모트 재생 수신', { time: event.time });
        this._isRemoteUpdate = true;
        this.dispatchEvent(new CustomEvent('remotePlay', {
          detail: { time: event.time }
        }));
        this._isRemoteUpdate = false;
        break;

      case 'PAUSE':
        log.info('리모트 일시정지 수신', { time: event.time });
        this._isRemoteUpdate = true;
        this.dispatchEvent(new CustomEvent('remotePause', {
          detail: { time: event.time }
        }));
        this._isRemoteUpdate = false;
        break;

      case 'SEEK':
        log.info('리모트 탐색 수신', { time: event.time });
        this._isRemoteUpdate = true;
        this.dispatchEvent(new CustomEvent('remoteSeek', {
          detail: { time: event.time }
        }));
        this._isRemoteUpdate = false;
        break;

      case 'SYNC_MODE':
        if (event.mode === 'anyone' || event.mode === 'host') {
          this._leaderMode = event.mode;
          this.dispatchEvent(new CustomEvent('leaderModeChanged', {
            detail: { mode: event.mode }
          }));
        }
        break;
    }
  }

  // ============================================================================
  // 유틸리티
  // ============================================================================

  /**
   * 브로드캐스트 가능 여부 (연결 확인)
   */
  _canBroadcast() {
    return this._started && this._lm.isConnected && this._lm.hasOtherCollaborators();
  }

  /**
   * 송신 가능 여부 (동기화 + 리더 권한 + 루프 방지)
   */
  _canSend() {
    if (!this._syncEnabled) return false;
    if (this._isRemoteUpdate) return false;
    if (!this._canBroadcast()) return false;

    // 호스트 모드에서는 호스트만 송신 가능
    if (this._leaderMode === 'host' && !this._isHost) return false;

    return true;
  }

  /**
   * isRemoteUpdate getter (app.js에서 루프 방지용)
   */
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
