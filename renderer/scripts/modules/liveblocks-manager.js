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
  constructor() {
    super();

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
      this._client = createClient({
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

      this._room = result.room;
      this._leave = result.leave;

      // Storage 로드 대기
      this._storage = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Storage 로드 타임아웃 (10초)'));
        }, 10000);

        const unsub = this._room.subscribe('storage-status', (status) => {
          if (status === 'synchronized') {
            clearTimeout(timeout);
            unsub();
            resolve(this._room.getStorage());
          }
        });

        // 이미 동기화된 경우
        const currentStorage = this._room.getStorage();
        if (currentStorage) {
          clearTimeout(timeout);
          unsub();
          resolve(currentStorage);
        }
      });

      // 이벤트 구독 설정
      this._setupSubscriptions();

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

      return { roomId: this._roomId, isNewRoom };
    } catch (error) {
      log.error('Room 접속 실패', error);
      this._isConnected = false;
      this._connectionStatus = 'disconnected';
      this._emit('connectionStatusChanged', { status: 'disconnected', error });
      throw error;
    }
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

    // 스로틀 타이머 정리
    if (this._presenceThrottleTimer) {
      clearTimeout(this._presenceThrottleTimer);
      this._presenceThrottleTimer = null;
    }

    // Room 퇴장
    if (this._leave) {
      this._leave();
    }

    this._room = null;
    this._leave = null;
    this._storage = null;
    this._isConnected = false;
    this._connectionStatus = 'disconnected';

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
    if (!this._room) return;
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
  _setupSubscriptions() {
    // Others 변경 (접속/퇴장/presence 변경)
    const unsubOthers = this._room.subscribe('others', () => {
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
    });
    this._unsubscribers.push(unsubOthers);

    // 연결 상태 변경
    const unsubConnection = this._room.subscribe('lost-connection', (event) => {
      if (event === 'lost') {
        this._connectionStatus = 'reconnecting';
        this._emit('connectionStatusChanged', { status: 'reconnecting' });
        log.warn('연결 끊김, 재연결 시도 중');
      } else if (event === 'restored') {
        this._connectionStatus = 'connected';
        this._isConnected = true;
        this._emit('connectionStatusChanged', { status: 'connected' });
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
