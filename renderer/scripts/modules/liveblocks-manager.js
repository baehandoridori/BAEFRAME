/**
 * BAEFRAME - Liveblocks Manager
 * 실시간 협업을 위한 Liveblocks 클라이언트 래퍼
 *
 * 기능:
 * - Room 접속/퇴장 (각 .bframe 파일 = 1 Room)
 * - Presence 관리 (커서, 재생헤드, 편집 상태)
 * - CRDT Storage (댓글, 하이라이트)
 * - Broadcast (그리기 데이터)
 * - 연결 상태 모니터링 및 오프라인 전환
 */

import { createClient, LiveList, LiveObject, LiveMap } from '../lib/liveblocks-client.js';
import { createLogger } from '../logger.js';

// Liveblocks Public Key (클라이언트용 공개 키 — 코드에 포함해도 안전)
const LIVEBLOCKS_PUBLIC_KEY = 'pk_dev_lKwyJLI2vKSI63mnDwK1zh6yKWzLflm_YbNPjY-l7VVLNS7q8M5hWdlbPO1TieUO';

// CommentSync, DrawingSync에서 LiveObject/LiveList를 사용할 수 있도록 global에 등록
globalThis.__LiveObject = LiveObject;
globalThis.__LiveList = LiveList;
globalThis.__LiveMap = LiveMap;

const log = createLogger('LiveblocksManager');

// Room 접속(연결 + Storage 로드)을 기다리는 최대 시간.
const ROOM_JOIN_TIMEOUT_MS = 10000;

// Liveblocks 가 방 정원(요금제별 동시 접속 수, 현재 10명)을 넘긴 접속을 거절할 때의 코드.
// 이 경우 클라이언트는 재시도 없이 끊고, 예외도 던지지 않는다 — 'error' 구독으로만 알 수 있다.
const ROOM_FULL_ERROR_CODE = 4005;

/**
 * 접속 실패 사유를 실은 오류. app.js 가 사유(joinFailureReason)에 따라 안내와 재접속을 정한다.
 * - 'room-full': 방 정원 초과
 * - 'timeout': 정해진 시간 안에 접속되지 않음
 * - 'connection-error': 그 밖의 접속 거절(권한 등)
 * - 'superseded': 기다리는 사이 다른 접속(영상 전환 등)에 자리를 내줌. 실패가 아니다
 */
function createJoinFailure(reason, message, code = null) {
  const error = new Error(message);
  error.joinFailureReason = reason;
  error.joinFailureCode = code;
  return error;
}

/**
 * 간단한 UUID 생성
 */
function generateRoomId() {
  const random = Math.random().toString(36).substring(2, 14);
  const timestamp = Date.now().toString(36);
  return `bframe_${timestamp}_${random}`;
}

/**
 * Liveblocks 협업 매니저
 * 기존 CollaborationManager의 이벤트 인터페이스를 유지하여 app.js 호환성 보장
 */
export class LiveblocksManager extends EventTarget {
  /**
   * @param {Object} [options]
   * @param {Function} [options.createClient] - Liveblocks 클라이언트 생성기 (검사에서 바꿔 끼운다)
   * @param {number} [options.joinTimeoutMs] - Room 접속을 기다리는 최대 시간
   */
  constructor(options = {}) {
    super();

    this._createClient = typeof options.createClient === 'function'
      ? options.createClient
      : createClient;
    this._joinTimeoutMs = Number.isFinite(options.joinTimeoutMs) && options.joinTimeoutMs > 0
      ? options.joinTimeoutMs
      : ROOM_JOIN_TIMEOUT_MS;

    this._client = null;
    this._room = null;
    this._leave = null;
    this._storage = null;
    this._unsubscribers = [];

    // 상태
    this._isConnected = false;
    this._connectionStatus = 'initial';
    this._roomId = null;
    this._userName = null;
    this._userColor = null;
    this._bframePath = null;

    // 스로틀 타이머
    this._presenceThrottleTimer = null;
    this._pendingPresence = null;

    // 진행 중인 접속 대기를 끝내는 함수. stop() 이 불러 버려진 시도를 바로 끝낸다.
    this._abortPendingJoin = null;

    log.info('LiveblocksManager 초기화됨');
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * 연결 상태
   */
  get isConnected() {
    return this._isConnected;
  }

  /**
   * 연결 상태 문자열
   */
  get connectionStatus() {
    return this._connectionStatus;
  }

  /**
   * Room ID
   */
  get roomId() {
    return this._roomId;
  }

  /**
   * Room 접속
   * @param {string} bframePath - .bframe 파일 경로
   * @param {string} userName - 사용자 이름
   * @param {string} userColor - 사용자 색상
   * @param {string} [existingRoomId] - 기존 Room ID (.bframe에서 읽은 값)
   * @returns {Promise<{roomId: string, isNewRoom: boolean}>}
   */
  async start(bframePath, userName, userColor, existingRoomId) {
    if (this._room) {
      await this.stop();
    }

    this._bframePath = bframePath;
    this._userName = userName;
    this._userColor = userColor || this._generateUserColor();

    // 클라이언트 생성 (한 번만)
    if (!this._client) {
      this._client = this._createClient({
        publicApiKey: LIVEBLOCKS_PUBLIC_KEY,
        throttle: 50
      });
      log.info('Liveblocks 클라이언트 생성됨');
    }

    // Room ID 결정
    const isNewRoom = !existingRoomId;
    this._roomId = existingRoomId || generateRoomId();

    log.info('Room 접속 시도', {
      roomId: this._roomId,
      userName: this._userName,
      isNewRoom
    });

    // 이 접속 시도의 방. 기다리는 사이 stop() 이나 다른 start() 가 끼어들 수 있으므로
    // 공유 상태(this._room)와 따로 들고 있는다.
    let room = null;
    let leave = null;
    try {
      // Room 접속
      const result = this._client.enterRoom(this._roomId, {
        initialPresence: {
          cursor: null,
          currentFrame: 0,
          isDrawing: false,
          activeComment: null,
          userName: this._userName,
          userColor: this._userColor
        },
        initialStorage: {
          commentLayers: new LiveList([]),
          highlights: new LiveList([]),
          drawingMeta: new LiveList([])
        }
      });

      room = result.room;
      leave = result.leave;
      this._room = room;
      this._leave = leave;

      // 이벤트 구독 설정 — Storage 로드를 기다리기 전에 설치해야 접속 직후 도착하는
      // 초기 참여자 상태(ROOM_STATE)를 놓치지 않는다. room.subscribe('others')는
      // 구독 시점의 현재 값을 초기 발화하지 않는 순수 이벤트 소스이기 때문이다.
      // _setupSubscriptions()는 this._room만 사용하므로 Storage 없이 안전하다.
      this._setupSubscriptions();

      // Storage 로드 대기
      const storage = await this._waitForRoomJoin(room);
      if (this._room !== room) {
        throw createJoinFailure('superseded', 'Room 접속 시도가 다른 접속으로 대체되었습니다');
      }
      this._storage = storage;

      this._isConnected = true;
      this._connectionStatus = 'connected';

      log.info('Room 접속 성공', {
        roomId: this._roomId,
        storageKeys: Object.keys(this._storage)
      });

      // 이벤트 발생
      this._emit('collaborationStarted', {
        roomId: this._roomId,
        userName: this._userName,
        isNewRoom
      });

      this._emit('connectionStatusChanged', { status: 'connected' });

      // 구독 설치 이전에 이미 확정된 초기 참여자 목록을 1회 보상 발행한다.
      // 구독을 앞당겨도 접속 직전에 확정된 상태는 변화 이벤트로 오지 않으므로,
      // 이 자체 발행이 없으면 먼저 접속해 있던 참여자가 UI에 나타나지 않는다.
      this._emitCollaboratorsChanged();

      return { roomId: this._roomId, isNewRoom };
    } catch (error) {
      if (this._room !== room) {
        // 버려진 시도다(영상을 바꿔 stop() 했거나 다른 start() 가 방을 갈아 끼웠다).
        // 공유 상태는 이미 다음 접속의 것이므로 건드리지 않고 자기 방만 떠난다.
        // 여기서 공유 상태를 정리하면 멀쩡히 연결된 다음 방이 끊긴다.
        log.info('버려진 Room 접속 시도 정리', { reason: error?.joinFailureReason || null });
        if (leave) {
          try { leave(); } catch (e) { /* 무시 */ }
        }
        throw error;
      }
      log.error('Room 접속 실패', error);
      // 구독을 Storage 대기보다 먼저 설치하므로, 접속이 실패하면 죽은 방의 구독이
      // collaboratorsChanged를 계속 발행하지 않도록 여기서 반드시 정리한다.
      this._unsubscribers.forEach(unsub => {
        try { unsub(); } catch (e) { /* 무시 */ }
      });
      this._unsubscribers = [];
      if (this._leave) {
        try { this._leave(); } catch (e) { /* 무시 */ }
      }
      this._room = null;
      this._leave = null;
      this._storage = null;
      this._isConnected = false;
      this._connectionStatus = 'disconnected';
      this._emit('connectionStatusChanged', {
        status: 'disconnected',
        error,
        reason: error?.joinFailureReason || null
      });
      throw error;
    }
  }

  /**
   * Room 접속이 끝날 때까지 기다린다.
   *
   * room.getStorage() 는 접속에 성공해 Storage 를 받은 뒤에야 끝나는 Promise 다. 접속이
   * 거절되면(방 정원 초과 등) 끝나지 않으므로, 거절 통지('error')와 시간 제한을 함께 건다.
   * 예전 구현은 getStorage() 의 반환값(항상 Promise)을 "이미 동기화됨" 으로 오인해 시간
   * 제한을 풀어 버렸고, 정원을 넘긴 사용자는 접속 대기에서 영원히 멈췄다 — 그 뒤에 있는
   * 파일 감시(대체 동기화)도 시작되지 않았다.
   */
  _waitForRoomJoin(room) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanups = [];
      const abort = () => settle(reject, createJoinFailure(
        'superseded',
        'Room 접속 시도가 다른 접속으로 대체되었습니다'
      ));
      const settle = (complete, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this._abortPendingJoin === abort) this._abortPendingJoin = null;
        cleanups.forEach(cleanup => {
          try { cleanup(); } catch (e) { /* 무시 */ }
        });
        complete(value);
      };
      // 떠난 방의 getStorage() 는 끝나지 않는다. stop() 이 이 대기를 바로 끝낼 수 있게 한다.
      this._abortPendingJoin = abort;
      const timer = setTimeout(() => {
        settle(reject, createJoinFailure(
          'timeout',
          `Room 접속 시간 초과 (${Math.round(this._joinTimeoutMs / 1000)}초)`
        ));
      }, this._joinTimeoutMs);

      cleanups.push(room.subscribe('error', (error) => {
        const code = error?.context?.code ?? error?.code ?? null;
        settle(reject, createJoinFailure(
          code === ROOM_FULL_ERROR_CODE ? 'room-full' : 'connection-error',
          error?.message || 'Room 접속이 거절되었습니다',
          code
        ));
      }));

      Promise.resolve()
        .then(() => room.getStorage())
        .then(
          storage => settle(resolve, storage),
          error => settle(reject, createJoinFailure(
            'connection-error',
            error?.message || 'Storage 로드 실패'
          ))
        );
    });
  }

  /**
   * Room 퇴장
   */
  async stop() {
    if (!this._room) return;

    log.info('Room 퇴장 시작', { roomId: this._roomId });

    // 구독 해제
    this._unsubscribers.forEach(unsub => {
      try { unsub(); } catch (e) { /* 무시 */ }
    });
    this._unsubscribers = [];

    // 스로틀 타이머 정리 및 미전송 Presence flush
    if (this._presenceThrottleTimer) {
      clearTimeout(this._presenceThrottleTimer);
      this._presenceThrottleTimer = null;
    }
    if (this._pendingPresence && this._room) {
      try { this._room.updatePresence(this._pendingPresence); } catch (e) { /* 무시 */ }
      this._pendingPresence = null;
    }

    // Room 퇴장
    if (this._leave) {
      this._leave();
    }

    const abortPendingJoin = this._abortPendingJoin;
    this._abortPendingJoin = null;
    this._room = null;
    this._leave = null;
    this._storage = null;
    this._isConnected = false;
    this._connectionStatus = 'disconnected';

    // 아직 접속을 기다리던 start() 가 있으면 여기서 끝낸다. 그냥 두면 제한 시간이 지난 뒤
    // 실패 처리로 들어가 그 사이 새로 들어간 방을 정리해 버린다.
    if (abortPendingJoin) abortPendingJoin();

    this._emit('connectionStatusChanged', { status: 'disconnected' });
    log.info('Room 퇴장 완료');
  }

  // ============================================================================
  // Presence API
  // ============================================================================

  /**
   * Presence 업데이트 (50ms 스로틀)
   * @param {Object} data - 업데이트할 presence 데이터
   */
  updatePresence(data) {
    if (!this._room) return;

    // 즉시 업데이트가 필요한 항목
    const immediateKeys = ['activeComment', 'userName', 'userColor'];
    const hasImmediate = immediateKeys.some(key => key in data);

    if (hasImmediate) {
      this._room.updatePresence(data);
      return;
    }

    // 커서/프레임 등은 스로틀
    this._pendingPresence = { ...this._pendingPresence, ...data };

    if (!this._presenceThrottleTimer) {
      this._presenceThrottleTimer = setTimeout(() => {
        if (this._pendingPresence && this._room) {
          this._room.updatePresence(this._pendingPresence);
          this._pendingPresence = null;
        }
        this._presenceThrottleTimer = null;
      }, 50);
    }
  }

  /**
   * 다른 사용자 목록
   * @returns {Array} Others 배열
   */
  getOthers() {
    if (!this._room) return [];
    const others = this._room.getOthers();
    return Array.isArray(others) ? others : [...others];
  }

  /**
   * 자기 자신 정보
   */
  getSelf() {
    if (!this._room) return null;
    return this._room.getSelf();
  }

  /**
   * 다른 협업자가 있는지 확인
   */
  hasOtherCollaborators() {
    return this.getOthers().length > 0;
  }

  // ============================================================================
  // Storage API
  // ============================================================================

  /**
   * Storage 객체 반환
   */
  getStorage() {
    return this._storage;
  }

  /**
   * Room 객체 반환 (subscribe 등에 사용)
   */
  getRoom() {
    return this._room;
  }

  /**
   * Batch 작업 수행
   * @param {Function} fn - 배치로 실행할 함수
   */
  batch(fn) {
    if (!this._room) return;
    this._room.batch(fn);
  }

  // ============================================================================
  // Broadcast API
  // ============================================================================

  /**
   * 브로드캐스트 이벤트 전송
   * @param {Object} data - 전송할 데이터 (type 필드 필수)
   */
  broadcastEvent(data) {
    if (!this._room) {
      log.warn('Broadcast 실패: Room 없음', { type: data?.type });
      return;
    }
    log.debug('Broadcast 전송', { type: data?.type });
    this._room.broadcastEvent(data);
  }

  // ============================================================================
  // Utility
  // ============================================================================

  /**
   * 편집 잠금 확인 (Presence 기반)
   * @param {string} markerId - 확인할 마커 ID
   * @returns {{isLocked: boolean, lockedBy: string|null}}
   */
  checkEditLock(markerId) {
    const others = this.getOthers();
    const locker = others.find(u => u.presence?.activeComment === markerId);

    return {
      isLocked: !!locker,
      lockedBy: locker?.presence?.userName || null
    };
  }

  /**
   * 편집 잠금 해제 (모든 잠금)
   */
  releaseAllEditingLocks() {
    this.updatePresence({ activeComment: null });
  }

  // ============================================================================
  // Private
  // ============================================================================

  /**
   * 이벤트 구독 설정
   */
  /**
   * 현재 others 스냅샷으로 collaboratorsChanged를 발행
   * room.subscribe('others')는 변화가 있을 때만 발화하므로, 구독 설치 이전에
   * 확정된 목록이나 재연결 직후 목록을 보상 푸시할 때도 이 경로를 재사용한다.
   */
  _emitCollaboratorsChanged() {
    if (!this._room) return;
    const others = this.getOthers();
    this._emit('collaboratorsChanged', {
      collaborators: others.map(u => ({
        userName: u.presence?.userName || '알 수 없음',
        userColor: u.presence?.userColor || '#888',
        cursor: u.presence?.cursor,
        currentFrame: u.presence?.currentFrame,
        isDrawing: u.presence?.isDrawing,
        activeComment: u.presence?.activeComment,
        connectionId: u.connectionId
      }))
    });
  }

  _setupSubscriptions() {
    // Others 변경 (접속/퇴장/presence 변경)
    const unsubOthers = this._room.subscribe('others', () => {
      this._emitCollaboratorsChanged();
    });
    this._unsubscribers.push(unsubOthers);

    // 연결 상태 변경
    const unsubConnection = this._room.subscribe('lost-connection', (event) => {
      if (event === 'lost') {
        this._connectionStatus = 'reconnecting';
        this._isConnected = false;
        this._emit('connectionStatusChanged', { status: 'reconnecting' });
        log.warn('연결 끊김, 재연결 시도 중');
      } else if (event === 'restored') {
        this._connectionStatus = 'connected';
        this._isConnected = true;
        this._emit('connectionStatusChanged', { status: 'connected' });
        // 'lost' 동안 others가 비워져 UI가 1명으로 줄어든 뒤, 복구 시 others 변화가
        // 발생하지 않으면 목록이 그대로 고착된다 — 복구 시점 스냅샷을 1회 재푸시한다.
        this._emitCollaboratorsChanged();
        log.info('연결 복구됨');
      } else if (event === 'failed') {
        this._connectionStatus = 'disconnected';
        this._isConnected = false;
        this._emit('connectionStatusChanged', { status: 'disconnected' });
        log.error('연결 실패 (재인증 필요)');
      }
    });
    this._unsubscribers.push(unsubConnection);

    // Broadcast 이벤트 수신
    const unsubEvent = this._room.subscribe('event', (eventData) => {
      log.debug('Broadcast 수신', { type: eventData?.event?.type });
      this._emit('broadcastReceived', eventData);
    });
    this._unsubscribers.push(unsubEvent);
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * 사용자 색상 생성
   */
  _generateUserColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F0B27A', '#82E0AA'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
