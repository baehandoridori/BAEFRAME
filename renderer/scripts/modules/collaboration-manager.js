/**
 * BAEFRAME - Collaboration Manager
 * 실시간 협업 및 동기화 관리
 *
 * 기능:
 * - 협업자 presence 추적
 * - WebSocket 기반 실시간 동기화 (LAN 내)
 * - Host-Client 아키텍처
 * - Host Migration (방장 승계)
 * - 편집 잠금 (Optimistic Locking)
 *
 * @version 3.0 - WebSocket 리팩토링
 */

import { createLogger } from '../logger.js';
import { wsClient } from './ws-client.js';
import { MessageTypes, createMessage, compareTimestamps } from './sync-protocol.js';

const log = createLogger('CollaborationManager');

// WebSocket 관련 상수
const WS_PORT = 12345;
const SESSION_FILE_EXTENSION = '.session.json';
const SESSION_EXPIRY_MS = 180000;        // session.json 3분 만료
const HOST_CANDIDATE_DELAY_MIN = 500;    // Host 후보 최소 딜레이 (ms)
const HOST_CANDIDATE_DELAY_MAX = 2000;   // Host 후보 최대 딜레이 (ms)
const PRESENCE_THROTTLE = 500;           // Presence 스로틀링 (500ms)
const CURSOR_THROTTLE = 33;              // 커서 스로틀링 (~30fps)
const ELECTION_WAIT_MS = 5000;           // Host 선출 대기 시간 (5초)
const ELECTION_POLL_MS = 1000;           // session.json 폴링 간격 (1초)
const SESSION_REFRESH_INTERVAL = 60000;  // session.json 갱신 간격 (1분)

// 동기화 간격 설정
const ACTIVITY_WINDOW = 60000;            // 활동량 측정 윈도우: 1분
const ACTIVITY_THRESHOLD = 5;             // 활발 판단 기준: 1분 내 5회 이상

/**
 * 협업 관리자
 */
export class CollaborationManager extends EventTarget {
  constructor(options = {}) {
    super();

    // 상태
    this.bframePath = null;
    this.sessionPath = null;           // .session.json 경로
    this.collabPath = null;            // 호환성 유지
    this.sessionId = this._generateSessionId();
    this.userName = null;
    this.userColor = this._generateUserColor();

    // WebSocket 역할 (host / client / solo)
    this.role = 'solo';
    this.p2pEnabled = false;           // WebSocket 연결 활성화 여부 (호환성)

    // 참가자 목록
    this.collaborators = new Map();    // sessionId -> { name, color, lastSeen }
    this.participants = [];            // WebSocket 참가자 목록 [{sessionId, name, color}]
    this.p2pPeers = new Map();         // 호환성: WebSocket 피어
    this.p2pPresence = new Map();      // 피어 presence (프레임 위치 등)

    // 편집 잠금 (markerId -> { sessionId, userName })
    this._editLocks = new Map();

    // 타이머
    this._syncTimer = null;
    this._sessionRefreshTimer = null;
    this._isActive = false;

    // 콜백
    this._onRemoteDataLoaded = null;

    // 활동량 추적
    this._activityTimestamps = [];

    // Presence 관련
    this._lastPresenceUpdate = 0;
    this._lastCursorSend = 0;
    this._currentFrame = 0;
    this._isPlaying = false;

    // 데이터 매니저 참조 (외부에서 설정)
    this._commentManager = null;
    this._drawingManager = null;
    this._highlightManager = null;

    // ReviewDataManager 참조 (저장 전략용)
    this._reviewDataManager = null;

    log.info('CollaborationManager 초기화됨', { sessionId: this.sessionId });
  }

  /**
   * 협업 세션 시작
   * @param {string} bframePath - .bframe 파일 경로
   * @param {string} userName - 사용자 이름
   */
  async start(bframePath, userName) {
    if (this._isActive) {
      await this.stop();
    }

    this.bframePath = bframePath;
    this.sessionPath = bframePath + SESSION_FILE_EXTENSION;
    this.collabPath = bframePath + '.collab'; // 호환성
    this.userName = userName;
    this._isActive = true;

    log.info('협업 세션 시작', { bframePath, userName });

    // WebSocket 연결 시작 (Host/Client 자동 결정)
    await this._startWebSocket();

    this._emit('sessionStarted', {
      sessionId: this.sessionId,
      userName: this.userName,
      userColor: this.userColor,
      role: this.role
    });

    // 협업자 UI 초기 업데이트 (자신 포함)
    this._updateCollaboratorsUI();
  }

  /**
   * 매니저 참조 설정 (외부에서 호출)
   */
  setManagers(commentManager, drawingManager, highlightManager) {
    this._commentManager = commentManager;
    this._drawingManager = drawingManager;
    this._highlightManager = highlightManager;
  }

  /**
   * ReviewDataManager 참조 설정
   */
  setReviewDataManager(manager) {
    this._reviewDataManager = manager;
  }

  /**
   * 현재 역할 반환
   * @returns {string} 'host' | 'client' | 'solo'
   */
  getRole() {
    return this.role;
  }

  // ============================================================================
  // WebSocket 연결 관리
  // ============================================================================

  /**
   * WebSocket 연결 시작 (Host/Client 자동 결정)
   * @private
   */
  async _startWebSocket() {
    try {
      const roleInfo = await this._determineRole();

      if (roleInfo.role === 'host') {
        await this._startAsHost();
      } else if (roleInfo.role === 'client') {
        await this._startAsClient(roleInfo.hostIp, roleInfo.port);
      }
    } catch (error) {
      log.warn('WebSocket 시작 실패, Solo 모드로 동작', { error: error.message });
      this.role = 'solo';
      this.p2pEnabled = false;
    }
  }

  /**
   * Host/Client 결정 로직
   * session.json 확인 → 존재하면 Client, 없으면 Host 후보
   * @private
   * @returns {Promise<{role: string, hostIp?: string, port?: number}>}
   */
  async _determineRole() {
    try {
      // 1. session.json 읽기 시도
      const result = await window.electronAPI.wsReadSession(this.sessionPath);

      if (result.success && result.data) {
        const session = result.data;

        // 2. 3분 만료 확인
        const elapsed = Date.now() - new Date(session.createdAt).getTime();
        if (elapsed > SESSION_EXPIRY_MS) {
          log.info('session.json 만료됨, Host 후보 진입', { elapsed });
          return await this._tryBecomeHost();
        }

        // 3. WebSocket 연결 시도
        log.info('session.json 발견, Client 연결 시도', {
          hostIp: session.hostIp,
          port: session.port,
          hostName: session.hostName
        });

        const connected = await wsClient.connect(`ws://${session.hostIp}:${session.port}`);
        if (connected) {
          return { role: 'client', hostIp: session.hostIp, port: session.port };
        }

        // 연결 실패 → 오래된 session.json (이전 Host 비정상 종료)
        log.info('WebSocket 연결 실패, session.json 삭제 후 Host 후보 진입');
        await window.electronAPI.wsDeleteSession(this.sessionPath);
        return await this._tryBecomeHost();
      }
    } catch (error) {
      log.debug('session.json 읽기 실패 (정상: 첫 접속)', { error: error.message });
    }

    // session.json 없음 → Host 후보 진입
    return await this._tryBecomeHost();
  }

  /**
   * Host 후보 진입 (Race Condition 방지)
   * @private
   */
  async _tryBecomeHost() {
    // 랜덤 딜레이 (500~2000ms) - Drive 동기화 대기
    const delay = HOST_CANDIDATE_DELAY_MIN +
      Math.random() * (HOST_CANDIDATE_DELAY_MAX - HOST_CANDIDATE_DELAY_MIN);
    log.info('Host 후보 딜레이', { delay: Math.round(delay) });
    await this._delay(delay);

    // session.json 재확인 (다른 사람이 먼저 Host가 되었을 수 있음)
    try {
      const result = await window.electronAPI.wsReadSession(this.sessionPath);
      if (result.success && result.data) {
        log.info('딜레이 후 session.json 발견, Client 모드로 전환');
        const session = result.data;
        const connected = await wsClient.connect(`ws://${session.hostIp}:${session.port}`);
        if (connected) {
          return { role: 'client', hostIp: session.hostIp, port: session.port };
        }
      }
    } catch {
      // session.json 아직 없음 → Host 진행
    }

    return { role: 'host' };
  }

  /**
   * Host 모드로 시작
   * @private
   */
  async _startAsHost() {
    // 1. Main Process에서 WS 서버 시작
    const result = await window.electronAPI.wsStartServer(WS_PORT);
    if (!result.success) {
      throw new Error(`WS 서버 시작 실패: ${result.error}`);
    }

    // 2. session.json 작성
    await window.electronAPI.wsWriteSession(this.sessionPath, {
      hostIp: result.ip,
      port: result.port,
      hostSessionId: this.sessionId,
      hostName: this.userName,
      projectPath: this.bframePath,
      createdAt: new Date().toISOString(),
      version: '1.0'
    });

    // 3. Host 자신도 localhost WS에 연결 (브라우저 WebSocket)
    const connected = await wsClient.connect(`ws://127.0.0.1:${result.port}`);
    if (!connected) {
      throw new Error('Host localhost WS 연결 실패');
    }

    // 4. JOIN 메시지 전송 (자기 자신 등록)
    wsClient.send(createMessage.join(this.sessionId, this.userName, this.userColor));

    // 5. Main Process WS 서버 이벤트 수신 설정
    this._setupHostEventListeners();

    // 6. wsClient 메시지 수신 설정
    this._setupWsClientEvents();

    // 7. session.json 주기적 갱신 (만료 방지)
    this._startSessionRefresh();

    this.role = 'host';
    this.p2pEnabled = true;

    // ReviewDataManager 역할 설정
    if (this._reviewDataManager) {
      this._reviewDataManager.setRole('host');
    }

    log.info('Host 모드로 시작', { ip: result.ip, port: result.port });

    this._emit('showToast', {
      type: 'success',
      message: `협업 Host 모드 (${result.ip}:${result.port})`
    });
  }

  /**
   * Client 모드로 시작
   * @private
   */
  async _startAsClient(hostIp, port) {
    // wsClient.connect는 이미 _determineRole에서 호출되었을 수 있음
    if (!wsClient.isConnected) {
      const connected = await wsClient.connect(`ws://${hostIp}:${port}`);
      if (!connected) {
        throw new Error(`Client WS 연결 실패: ${hostIp}:${port}`);
      }
    }

    // JOIN 메시지 전송
    wsClient.send(createMessage.join(this.sessionId, this.userName, this.userColor));

    // wsClient 메시지 수신 설정
    this._setupWsClientEvents();

    this.role = 'client';
    this.p2pEnabled = true;

    // ReviewDataManager 역할 설정
    if (this._reviewDataManager) {
      this._reviewDataManager.setRole('client');
    }

    log.info('Client 모드로 시작', { hostIp, port });

    this._emit('showToast', {
      type: 'success',
      message: `협업 Client 모드 (${hostIp}에 연결)`
    });
  }

  /**
   * Host의 Main Process 이벤트 리스너 설정
   * WS 서버의 연결/해제 이벤트를 IPC로 수신
   * @private
   */
  _setupHostEventListeners() {
    window.electronAPI.onWsClientJoined((data) => {
      // Host 자신은 무시
      if (data.sessionId === this.sessionId) return;

      log.info('클라이언트 참가', { name: data.name, sessionId: data.sessionId });

      // 참가자 목록에 추가
      this.p2pPeers.set(data.sessionId, {
        name: data.name,
        color: data.color,
        joinedAt: new Date().toISOString()
      });

      this._updateCollaboratorsUI();

      // WELCOME 메시지 전송 (새 Client에게 현재 상태 + 전체 데이터)
      const fullState = this._collectFullState();
      window.electronAPI.wsSendTo(data.sessionId,
        createMessage.welcome(this.getCollaborators(), this.sessionId, fullState)
      );

      // 다른 Client들에게 PEER_JOINED 알림
      window.electronAPI.wsBroadcast(
        createMessage.peerJoined(data.sessionId, data.name, data.color),
        data.sessionId
      );

      // 현재 편집 잠금 상태 전송
      for (const [markerId, lock] of this._editLocks) {
        window.electronAPI.wsSendTo(data.sessionId,
          createMessage.editLockState(markerId, true, lock.userName)
        );
      }
    });

    window.electronAPI.onWsClientLeft((data) => {
      log.info('클라이언트 이탈', { name: data.name, sessionId: data.sessionId });

      this.p2pPeers.delete(data.sessionId);
      this.p2pPresence.delete(data.sessionId);

      // 이탈한 사용자의 편집 잠금 해제
      this._releaseLocksForSession(data.sessionId);

      this._updateCollaboratorsUI();

      // 다른 Client들에게 PEER_LEFT 알림
      window.electronAPI.wsBroadcast(
        createMessage.peerLeft(data.sessionId, data.name)
      );

      this._emit('showToast', {
        type: 'warning',
        message: `${data.name}님이 이탈했습니다`
      });
    });
  }

  /**
   * wsClient 메시지 수신 이벤트 설정
   * Host/Client 공통으로 사용
   * @private
   */
  _setupWsClientEvents() {
    wsClient.addEventListener('message', (e) => {
      this._handleWsMessage(e.detail);
    });

    wsClient.addEventListener('close', (e) => {
      if (e.detail.wasConnected && this.role === 'client') {
        log.warn('Host와의 연결 끊김, 재접속 시도 중...');
        this._emit('showToast', {
          type: 'warning',
          message: 'Host와의 연결이 끊겼습니다. 재접속 중...'
        });
      }
    });

    wsClient.addEventListener('reconnectFailed', () => {
      if (this.role === 'client') {
        log.warn('재접속 실패, Host 승계 시도');
        this._startElection();
      }
    });
  }

  /**
   * session.json 주기적 갱신 (Host 전용)
   * @private
   */
  _startSessionRefresh() {
    this._sessionRefreshTimer = setInterval(async () => {
      if (this.role !== 'host' || !this.sessionPath) return;

      try {
        const result = await window.electronAPI.wsReadSession(this.sessionPath);
        if (result.success && result.data) {
          result.data.createdAt = new Date().toISOString();
          await window.electronAPI.wsWriteSession(this.sessionPath, result.data);
        }
      } catch (error) {
        log.warn('session.json 갱신 실패', { error: error.message });
      }
    }, SESSION_REFRESH_INTERVAL);
  }

  // ============================================================================
  // Host Migration (Phase 2)
  // ============================================================================

  /**
   * Host 선출 프로토콜 시작
   * sessionId가 가장 작은 Client가 새 Host가 됨
   * @private
   */
  async _startElection() {
    log.info('Host 선출 시작', { mySessionId: this.sessionId });

    // 현재 참가자 목록에서 sessionId 정렬
    const allParticipants = [
      { sessionId: this.sessionId },
      ...Array.from(this.p2pPeers.entries()).map(([id]) => ({ sessionId: id }))
    ].sort((a, b) => a.sessionId.localeCompare(b.sessionId));

    if (allParticipants.length === 0) {
      // 혼자 남음 → Solo 모드
      this.role = 'solo';
      this.p2pEnabled = false;
      if (this._reviewDataManager) {
        this._reviewDataManager.setRole('solo');
      }
      return;
    }

    if (allParticipants[0].sessionId === this.sessionId) {
      // 내가 새 Host
      log.info('내가 새 Host로 선출됨');
      await this._promoteToHost();
    } else {
      // 다른 사람이 Host → session.json 폴링으로 대기
      log.info('다른 Client가 Host 예정, session.json 폴링 시작');
      await this._waitForNewHost();
    }
  }

  /**
   * Host로 승격
   * @private
   */
  async _promoteToHost() {
    try {
      // 1. WS 서버 시작
      const result = await window.electronAPI.wsStartServer(WS_PORT);
      if (!result.success) {
        log.error('Host 승격 실패: WS 서버 시작 실패', { error: result.error });
        this.role = 'solo';
        this.p2pEnabled = false;
        return;
      }

      // 2. session.json 갱신
      await window.electronAPI.wsWriteSession(this.sessionPath, {
        hostIp: result.ip,
        port: result.port,
        hostSessionId: this.sessionId,
        hostName: this.userName,
        projectPath: this.bframePath,
        createdAt: new Date().toISOString(),
        version: '1.0'
      });

      // 3. 역할 전환
      this.role = 'host';
      if (this._reviewDataManager) {
        this._reviewDataManager.setRole('host');
      }

      // 4. Host 이벤트 리스너 설정
      this._setupHostEventListeners();

      // 5. session.json 갱신 시작
      this._startSessionRefresh();

      // 6. localhost WS 연결
      const connected = await wsClient.connect(`ws://127.0.0.1:${result.port}`);
      if (connected) {
        wsClient.send(createMessage.join(this.sessionId, this.userName, this.userColor));
      }

      log.info('Host로 승격 완료', { ip: result.ip, port: result.port });

      this._emit('showToast', {
        type: 'info',
        message: 'Host로 승격되었습니다'
      });

    } catch (error) {
      log.error('Host 승격 중 오류', { error: error.message });
      this.role = 'solo';
      this.p2pEnabled = false;
    }
  }

  /**
   * 새 Host가 session.json을 작성할 때까지 폴링
   * @private
   */
  async _waitForNewHost() {
    const startTime = Date.now();

    while (Date.now() - startTime < ELECTION_WAIT_MS) {
      await this._delay(ELECTION_POLL_MS);

      try {
        const result = await window.electronAPI.wsReadSession(this.sessionPath);
        if (result.success && result.data) {
          const session = result.data;
          const elapsed = Date.now() - new Date(session.createdAt).getTime();

          // 새로 작성된 session.json인지 확인 (3초 이내)
          if (elapsed < 3000) {
            log.info('새 Host 발견, 재접속 시도', {
              hostIp: session.hostIp,
              port: session.port
            });

            const connected = await wsClient.connect(`ws://${session.hostIp}:${session.port}`);
            if (connected) {
              wsClient.send(createMessage.join(this.sessionId, this.userName, this.userColor));
              this.role = 'client';
              if (this._reviewDataManager) {
                this._reviewDataManager.setRole('client');
              }

              this._emit('showToast', {
                type: 'info',
                message: '새 Host에 연결되었습니다'
              });
              return;
            }
          }
        }
      } catch {
        // session.json 아직 없음 → 대기 계속
      }
    }

    // 타임아웃 → 내가 Host가 되어야 함
    log.warn('새 Host 대기 타임아웃, 직접 Host 승격');
    await this._promoteToHost();
  }

  // ============================================================================
  // WebSocket 메시지 핸들링 (Phase 3)
  // ============================================================================

  /**
   * WebSocket 메시지 핸들러
   * @private
   */
  _handleWsMessage(message) {
    // 축약 메시지 타입 처리
    const type = message.type || message.t;

    switch (type) {
    case 'WELCOME':
      this._handleWelcome(message);
      break;
    case 'PEER_JOINED':
      this._handlePeerJoined(message);
      break;
    case 'PEER_LEFT':
      this._handlePeerLeft(message);
      break;
    case 'HOST_SHUTDOWN':
      this._handleHostShutdown(message);
      break;
    case 'STATE_CHANGE':
      if (this.role === 'host') this._handleStateChange(message);
      break;
    case 'STATE_BROADCAST':
      this._handleStateBroadcast(message);
      break;
    case 'FULL_STATE_SYNC':
      this._handleFullStateSync(message);
      break;
    case 'EDIT_LOCK':
      if (this.role === 'host') this._handleEditLockRequest(message);
      break;
    case 'EDIT_UNLOCK':
      if (this.role === 'host') this._handleEditUnlockRequest(message);
      break;
    case 'EDIT_LOCK_STATE':
      this._handleEditLockState(message);
      break;
    case 'REDIRECT':
      this._handleRedirect(message);
      break;
    case 'CM': // CURSOR_MOVE
      this._handleCursorMove(message);
      break;
    case 'PU': // PRESENCE_UPDATE
      this._handlePresenceUpdate(message);
      break;
    default:
      log.debug('알 수 없는 메시지 타입', { type });
      break;
    }
  }

  /**
   * WELCOME 메시지 처리 (Client가 수신)
   * @private
   */
  _handleWelcome(message) {
    log.info('WELCOME 수신', {
      participants: message.participants?.length,
      hostSessionId: message.hostSessionId,
      hasFullState: !!message.fullState
    });

    // 참가자 목록 업데이트
    if (message.participants) {
      for (const p of message.participants) {
        if (p.sessionId !== this.sessionId) {
          this.p2pPeers.set(p.sessionId, {
            name: p.name,
            color: p.color,
            joinedAt: new Date().toISOString()
          });
        }
      }
    }

    // 전체 상태 동기화 (새 Client 접속 시 Host의 인메모리 상태 수신)
    if (message.fullState) {
      this._applyFullState(message.fullState);
    }

    this._updateCollaboratorsUI();
  }

  /**
   * PEER_JOINED 메시지 처리
   * @private
   */
  _handlePeerJoined(message) {
    if (message.sessionId === this.sessionId) return; // 자기 자신 무시

    this.p2pPeers.set(message.sessionId, {
      name: message.name,
      color: message.color,
      joinedAt: new Date().toISOString()
    });

    this._updateCollaboratorsUI();

    this._emit('showToast', {
      type: 'success',
      message: `${message.name}님이 참가했습니다`
    });
  }

  /**
   * PEER_LEFT 메시지 처리
   * @private
   */
  _handlePeerLeft(message) {
    this.p2pPeers.delete(message.sessionId);
    this.p2pPresence.delete(message.sessionId);
    this._updateCollaboratorsUI();

    this._emit('peerCursorRemoved', { peerId: message.sessionId });
  }

  /**
   * HOST_SHUTDOWN 메시지 처리
   * @private
   */
  _handleHostShutdown(message) {
    log.info('Host 정상 종료 알림 수신');
    this._emit('showToast', {
      type: 'warning',
      message: 'Host가 종료되었습니다. 새 Host 선출 중...'
    });

    // Host 승계 시작
    this._startElection();
  }

  /**
   * STATE_CHANGE 메시지 처리 (Host만)
   * Client가 보낸 변경사항을 인메모리에 반영 후 브로드캐스트
   * @private
   */
  _handleStateChange(message) {
    // 인메모리 상태 업데이트
    this._applyRemoteChange(message.changeType, message.data);

    // 발신자 제외 전체 브로드캐스트
    window.electronAPI.wsBroadcast(
      createMessage.stateBroadcast(message.sessionId, message.changeType, message.data),
      message.sessionId
    );

    // isDirty 설정 → Debounce 저장 트리거
    if (this._reviewDataManager) {
      this._reviewDataManager.markDirty();
    }
  }

  /**
   * STATE_BROADCAST 메시지 처리 (Client가 수신)
   * @private
   */
  _handleStateBroadcast(message) {
    if (message.sessionId === this.sessionId) return; // 자기 변경 무시
    this._applyRemoteChange(message.changeType, message.data);
  }

  /**
   * FULL_STATE_SYNC 메시지 처리
   * @private
   */
  _handleFullStateSync(message) {
    if (message.data) {
      this._applyFullState(message.data);
    }
  }

  /**
   * REDIRECT 메시지 처리 (새 Host로 리다이렉트)
   * @private
   */
  _handleRedirect(message) {
    log.info('새 Host로 리다이렉트', { hostIp: message.hostIp, port: message.port });
    wsClient.disconnect();
    this._startAsClient(message.hostIp, message.port);
  }

  /**
   * 커서 이동 메시지 처리
   * @private
   */
  _handleCursorMove(message) {
    if (message.s === this.sessionId) return;

    this._emit('peerCursorMoved', {
      peerId: message.s,
      x: message.x,
      y: message.y,
      name: message.n,
      color: message.c
    });
  }

  /**
   * Presence 업데이트 메시지 처리
   * @private
   */
  _handlePresenceUpdate(message) {
    if (message.s === this.sessionId) return;

    this.p2pPresence.set(message.s, {
      currentFrame: message.f,
      isPlaying: message.p,
      updatedAt: Date.now()
    });

    this._emit('peerPresenceUpdated', {
      peerId: message.s,
      currentFrame: message.f,
      isPlaying: message.p
    });
  }

  // ============================================================================
  // 데이터 동기화 (Phase 3)
  // ============================================================================

  /**
   * 변경 사항 동기화
   * @param {string} changeType - 변경 타입 (comment:add, comment:update 등)
   * @param {Object} data - 변경 데이터
   */
  async syncChange(changeType, data) {
    if (!this.p2pEnabled) return;

    if (this.role === 'host') {
      // Host는 직접 브로드캐스트
      window.electronAPI.wsBroadcast(
        createMessage.stateBroadcast(this.sessionId, changeType, data),
        this.sessionId
      );
    } else {
      // Client는 Host에게 STATE_CHANGE 전송
      wsClient.send(createMessage.stateChange(this.sessionId, changeType, data));
    }

    this.recordActivity();
  }

  /**
   * 원격 변경사항을 인메모리에 적용
   * @private
   */
  _applyRemoteChange(changeType, data) {
    if (!changeType || !data) return;

    const wasLoading = this._reviewDataManager?.isLoading;
    if (this._reviewDataManager) {
      this._reviewDataManager.isLoading = true; // 이벤트 루프 방지
    }

    try {
      switch (changeType) {
      // 댓글 관련
      case 'comment:add':
        if (this._commentManager) {
          this._commentManager.addMarkerFromRemote(data);
          this._emit('remoteCommentAdded', { data });
        }
        break;

      case 'comment:update':
        if (this._commentManager) {
          this._commentManager.updateMarkerFromRemote(data.id, data.changes);
          this._emit('remoteCommentUpdated', { data });
        }
        break;

      case 'comment:delete':
        if (this._commentManager) {
          this._commentManager.deleteMarkerFromRemote(data.id);
          this._emit('remoteCommentDeleted', { data });
        }
        break;

      case 'comment:resolve':
        if (this._commentManager) {
          this._commentManager.updateMarkerFromRemote(data.id, { resolved: data.resolved });
          this._emit('remoteCommentUpdated', { data });
        }
        break;

      case 'reply:add':
        if (this._commentManager) {
          this._commentManager.addReplyFromRemote(data.markerId, data.reply);
          this._emit('remoteCommentUpdated', { data });
        }
        break;

      case 'reply:update':
        if (this._commentManager) {
          this._commentManager.updateReplyFromRemote(data.markerId, data.replyId, data.text);
          this._emit('remoteCommentUpdated', { data });
        }
        break;

      case 'reply:delete':
        if (this._commentManager) {
          this._commentManager.deleteReplyFromRemote(data.markerId, data.replyId);
          this._emit('remoteCommentUpdated', { data });
        }
        break;

      // 드로잉 관련
      case 'drawing:add':
        if (this._drawingManager) {
          this._drawingManager.addStrokeFromRemote(data);
          this._emit('remoteDrawingChanged', { data });
        }
        break;

      case 'drawing:delete':
        if (this._drawingManager) {
          this._drawingManager.deleteStrokeFromRemote(data.id);
          this._emit('remoteDrawingChanged', { data });
        }
        break;

      case 'drawing:clear':
        if (this._drawingManager) {
          this._drawingManager.clearFrameFromRemote(data.frame, data.layerId);
          this._emit('remoteDrawingChanged', { data });
        }
        break;

      // 하이라이트 관련
      case 'highlight:add':
      case 'highlight:update':
      case 'highlight:delete':
        if (this._highlightManager) {
          // 하이라이트는 전체 교체 방식
          if (data.highlights) {
            this._highlightManager.fromJSON(data.highlights);
          }
          this._emit('remoteHighlightChanged', { data });
        }
        break;

      default:
        log.debug('알 수 없는 변경 타입', { changeType });
        break;
      }
    } finally {
      if (this._reviewDataManager) {
        this._reviewDataManager.isLoading = wasLoading;
      }
    }
  }

  /**
   * 전체 상태 수집 (Host → WELCOME 응답용)
   * @private
   */
  _collectFullState() {
    return {
      comments: this._commentManager?.toJSON() || { layers: [] },
      drawings: this._drawingManager?.exportData() || { layers: [] },
      highlights: this._highlightManager?.toJSON() || [],
      syncedAt: new Date().toISOString()
    };
  }

  /**
   * 전체 상태 적용 (Client: WELCOME/FULL_STATE_SYNC 수신 시)
   * @private
   */
  _applyFullState(state) {
    if (!state) return;

    const wasLoading = this._reviewDataManager?.isLoading;
    if (this._reviewDataManager) {
      this._reviewDataManager.isLoading = true;
    }

    try {
      if (state.comments && this._commentManager) {
        this._commentManager.fromJSON(state.comments);
        log.info('전체 상태 동기화: 댓글 적용');
      }

      if (state.drawings && this._drawingManager) {
        this._drawingManager.importData(state.drawings);
        log.info('전체 상태 동기화: 드로잉 적용');
      }

      if (state.highlights && this._highlightManager) {
        this._highlightManager.fromJSON(state.highlights);
        log.info('전체 상태 동기화: 하이라이트 적용');
      }

      this._emit('remoteDataSynced', { syncedAt: state.syncedAt });
    } finally {
      if (this._reviewDataManager) {
        this._reviewDataManager.isLoading = wasLoading;
      }
    }
  }

  // ============================================================================
  // 편집 잠금 (Phase 3)
  // ============================================================================

  /**
   * 댓글 편집 시작 (잠금 획득 시도)
   * @param {string} markerId - 편집할 마커 ID
   * @returns {Promise<{success: boolean, lockedBy?: string}>}
   */
  async startEditing(markerId) {
    if (!this.p2pEnabled) return { success: true };

    if (this.role === 'host') {
      // Host는 직접 잠금 설정
      const existing = this._editLocks.get(markerId);
      if (existing && existing.sessionId !== this.sessionId) {
        return { success: false, lockedBy: existing.userName };
      }
      this._editLocks.set(markerId, { sessionId: this.sessionId, userName: this.userName });

      // 잠금 상태 브로드캐스트
      window.electronAPI.wsBroadcast(
        createMessage.editLockState(markerId, true, this.userName),
        this.sessionId
      );
      return { success: true };
    } else {
      // Client는 Host에게 잠금 요청
      wsClient.send(createMessage.editLock(this.sessionId, markerId, this.userName));

      // 응답 대기 (1초 타임아웃)
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ success: true }); // 타임아웃 시 낙관적으로 허용
        }, 1000);

        const handler = (e) => {
          const msg = e.detail;
          if (msg.type === 'EDIT_LOCK_STATE' && msg.markerId === markerId) {
            clearTimeout(timeout);
            wsClient.removeEventListener('message', handler);
            resolve({ success: !msg.isLocked || msg.lockedBy === this.userName, lockedBy: msg.lockedBy });
          }
        };
        wsClient.addEventListener('message', handler);
      });
    }
  }

  /**
   * 댓글 편집 종료 (잠금 해제)
   * @param {string} markerId - 편집 완료한 마커 ID
   */
  async stopEditing(markerId) {
    if (!this.p2pEnabled) return;

    if (this.role === 'host') {
      this._editLocks.delete(markerId);
      window.electronAPI.wsBroadcast(
        createMessage.editLockState(markerId, false, null),
        this.sessionId
      );
    } else {
      wsClient.send(createMessage.editUnlock(this.sessionId, markerId));
    }
  }

  /**
   * 다른 사람이 편집 중인지 확인
   * @param {string} markerId
   * @returns {Promise<{isLocked: boolean, lockedBy?: string}>}
   */
  async isBeingEdited(markerId) {
    const lock = this._editLocks.get(markerId);
    if (lock && lock.sessionId !== this.sessionId) {
      return { isLocked: true, lockedBy: lock.userName };
    }
    return { isLocked: false };
  }

  /**
   * 앱 종료 시 모든 편집 잠금 해제
   */
  async releaseAllEditingLocks() {
    if (!this.p2pEnabled) return;

    for (const [markerId] of this._editLocks) {
      await this.stopEditing(markerId);
    }
    this._editLocks.clear();
  }

  /**
   * Host: 편집 잠금 요청 처리
   * @private
   */
  _handleEditLockRequest(message) {
    const existing = this._editLocks.get(message.markerId);
    if (existing && existing.sessionId !== message.sessionId) {
      // 이미 다른 사람이 잠금 중
      window.electronAPI.wsSendTo(message.sessionId,
        createMessage.editLockState(message.markerId, true, existing.userName)
      );
    } else {
      // 잠금 승인
      this._editLocks.set(message.markerId, {
        sessionId: message.sessionId,
        userName: message.userName
      });
      // 요청자에게 잠금 확인
      window.electronAPI.wsSendTo(message.sessionId,
        createMessage.editLockState(message.markerId, false, null)
      );
      // 다른 모든 Client에게 잠금 상태 알림
      window.electronAPI.wsBroadcast(
        createMessage.editLockState(message.markerId, true, message.userName),
        message.sessionId
      );
    }
  }

  /**
   * Host: 편집 잠금 해제 요청 처리
   * @private
   */
  _handleEditUnlockRequest(message) {
    const existing = this._editLocks.get(message.markerId);
    if (existing && existing.sessionId === message.sessionId) {
      this._editLocks.delete(message.markerId);
      window.electronAPI.wsBroadcast(
        createMessage.editLockState(message.markerId, false, null)
      );
    }
  }

  /**
   * 편집 잠금 상태 변경 처리 (Client)
   * @private
   */
  _handleEditLockState(message) {
    if (message.isLocked) {
      this._editLocks.set(message.markerId, {
        sessionId: null, // Client는 sessionId 모름
        userName: message.lockedBy
      });
    } else {
      this._editLocks.delete(message.markerId);
    }

    this._emit('editLockChanged', {
      markerId: message.markerId,
      isLocked: message.isLocked,
      lockedBy: message.lockedBy
    });
  }

  /**
   * 특정 세션의 편집 잠금 모두 해제 (이탈 시)
   * @private
   */
  _releaseLocksForSession(sessionId) {
    for (const [markerId, lock] of this._editLocks) {
      if (lock.sessionId === sessionId) {
        this._editLocks.delete(markerId);
        window.electronAPI.wsBroadcast(
          createMessage.editLockState(markerId, false, null)
        );
      }
    }
  }

  // ============================================================================
  // Presence & Cursor
  // ============================================================================

  /**
   * 협업자 UI 업데이트
   * @private
   */
  _updateCollaboratorsUI() {
    this._emit('collaboratorsChanged', {
      collaborators: this.getCollaborators(),
      count: 1 + this.p2pPeers.size
    });
  }

  /**
   * 협업 세션 종료
   */
  async stop() {
    if (!this._isActive) return;

    // 편집 잠금 먼저 해제
    await this.releaseAllEditingLocks();

    this._isActive = false;

    // 타이머 정리
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    if (this._sessionRefreshTimer) {
      clearInterval(this._sessionRefreshTimer);
      this._sessionRefreshTimer = null;
    }

    // WebSocket 정리
    if (this.role === 'host') {
      // Host: 미저장 데이터 즉시 저장 → HOST_SHUTDOWN 브로드캐스트 → session.json 삭제 → WS 서버 종료
      try {
        if (this._reviewDataManager?.isDirty) {
          await this._reviewDataManager.forceSave();
        }
        await window.electronAPI.wsBroadcast(
          createMessage.hostShutdown(this.sessionId)
        );
        await window.electronAPI.wsDeleteSession(this.sessionPath);
        await window.electronAPI.wsStopServer();
      } catch (error) {
        log.warn('Host 종료 정리 실패', { error: error.message });
      }
    } else if (this.role === 'client') {
      // Client: LEAVE 메시지 전송
      wsClient.send({
        type: 'LEAVE',
        sessionId: this.sessionId
      });
    }

    // wsClient 연결 종료
    wsClient.disconnect();

    // 역할 초기화
    const prevRole = this.role;
    this.role = 'solo';
    this.p2pEnabled = false;
    this.p2pPeers.clear();
    this.p2pPresence.clear();
    this.collaborators.clear();
    this._editLocks.clear();

    // ReviewDataManager 역할 리셋
    if (this._reviewDataManager && prevRole !== 'solo') {
      this._reviewDataManager.setRole('solo');
    }

    log.info('협업 세션 종료됨');

    this._emit('sessionStopped', {
      sessionId: this.sessionId
    });
  }

  /**
   * 원격 데이터 로드 콜백 설정
   * @param {Function} callback - 원격 데이터를 로드하는 함수
   */
  setRemoteDataLoader(callback) {
    this._onRemoteDataLoaded = callback;
  }

  /**
   * 현재 협업자 목록 반환
   * @returns {Array<{sessionId: string, name: string, color: string, isMe: boolean}>}
   */
  getCollaborators() {
    const result = [];

    // 현재 사용자 추가 (항상 맨 앞에)
    if (this._isActive) {
      result.push({
        sessionId: this.sessionId,
        name: this.userName || '나',
        color: this.userColor,
        isMe: true,
        connectionType: this.p2pEnabled ? 'websocket' : 'solo',
        role: this.role
      });
    }

    // WebSocket 연결된 피어
    for (const [peerId, peer] of this.p2pPeers) {
      if (peerId === this.sessionId) continue; // 자기 자신 제외

      const presence = this.p2pPresence.get(peerId);
      result.push({
        sessionId: peerId,
        name: peer.name,
        color: peer.color || this._generateUserColor(),
        isMe: false,
        connectionType: 'websocket',
        currentFrame: presence?.currentFrame,
        isPlaying: presence?.isPlaying,
        lastActivity: peer.joinedAt
      });
    }

    return result;
  }

  /**
   * Presence 업데이트 (프레임 위치 공유)
   * @param {number} currentFrame - 현재 프레임
   * @param {boolean} isPlaying - 재생 중 여부
   */
  updatePresenceFrame(currentFrame, isPlaying) {
    this._currentFrame = currentFrame;
    this._isPlaying = isPlaying;

    if (!this.p2pEnabled) return;

    // 스로틀링
    const now = Date.now();
    if (now - this._lastPresenceUpdate < PRESENCE_THROTTLE) return;
    this._lastPresenceUpdate = now;

    // 축약 메시지로 전송
    wsClient.send(createMessage.presenceUpdate(this.sessionId, currentFrame, isPlaying));
  }

  /**
   * 커서 이동 전송
   * @param {number} x - normalized x (0~1)
   * @param {number} y - normalized y (0~1)
   */
  sendCursorMove(x, y) {
    if (!this.p2pEnabled) return;

    const now = Date.now();
    if (now - this._lastCursorSend < CURSOR_THROTTLE) return;
    this._lastCursorSend = now;

    wsClient.send(createMessage.cursorMove(
      this.sessionId, x, y, this.userName, this.userColor
    ));
  }

  /**
   * 연결 상태 반환
   * @returns {Object}
   */
  getP2PStatus() {
    return {
      enabled: this.p2pEnabled,
      connectedPeers: this.p2pPeers.size,
      discoveredPeers: 0
    };
  }

  /**
   * P2P 피어 presence 정보 반환
   * @returns {Map}
   */
  getP2PPresence() {
    return this.p2pPresence;
  }

  /**
   * 다른 협업자가 있는지 확인
   * @returns {boolean}
   */
  hasOtherCollaborators() {
    return this.p2pPeers.size > 0;
  }

  /**
   * 수동 동기화 트리거
   */
  async syncNow() {
    if (!this._isActive || !this.bframePath) return;
    log.info('수동 동기화 요청');
  }

  /**
   * 활동 기록 (데이터 변경 시 외부에서 호출)
   */
  recordActivity() {
    const now = Date.now();
    this._activityTimestamps.push(now);

    // 오래된 기록 정리 (ACTIVITY_WINDOW 밖의 기록 제거)
    this._activityTimestamps = this._activityTimestamps.filter(
      t => now - t < ACTIVITY_WINDOW
    );
  }

  /**
   * 최근 활동 횟수 반환
   */
  get recentActivityCount() {
    const now = Date.now();
    return this._activityTimestamps.filter(t => now - t < ACTIVITY_WINDOW).length;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 지연 헬퍼 함수
   * @param {number} ms - 대기 시간 (밀리초)
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 세션 ID 생성
   */
  _generateSessionId() {
    return 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 사용자 색상 생성 (구분용)
   */
  _generateUserColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * 이벤트 발생
   */
  _emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// ============================================================================
// 댓글 머지 유틸리티
// ============================================================================

/**
 * 두 댓글 목록을 머지
 * @param {Array} localComments - 로컬 댓글 목록
 * @param {Array} remoteComments - 원격 댓글 목록
 * @returns {Object} { merged: Array, conflicts: Array, added: number, updated: number }
 */
export function mergeComments(localComments, remoteComments) {
  const localMap = new Map(localComments.map(c => [c.id, c]));
  const remoteMap = new Map(remoteComments.map(c => [c.id, c]));

  const merged = [];
  const conflicts = [];
  let added = 0;
  let updated = 0;
  let deleted = 0;

  // 모든 ID 수집
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!local && remote) {
      // 원격에만 있음 → 추가 (삭제된 마커도 포함)
      merged.push(remote);
      if (!remote.deleted) {
        added++;
      }
    } else if (local && !remote) {
      // 로컬에만 있음 → 유지
      merged.push(local);
    } else if (local && remote) {
      // 둘 다 있음 → updatedAt 비교로 최신 버전 선택
      const localTime = new Date(local.updatedAt || local.createdAt).getTime();
      const remoteTime = new Date(remote.updatedAt || remote.createdAt).getTime();

      if (localTime === remoteTime) {
        // 동일 → 로컬 유지
        merged.push(local);
      } else if (remoteTime > localTime) {
        // 원격이 더 최신 → 원격 사용
        merged.push(remote);
        // 변경 추적 (삭제도 updated로 카운트 - fromJSON 호출 트리거용)
        if (remote.deleted && !local.deleted) {
          deleted++;
          updated++; // 삭제도 변경으로 카운트해야 fromJSON 호출됨
        } else if (!remote.deleted) {
          updated++;
        }
      } else {
        // 로컬이 더 최신 → 로컬 유지
        merged.push(local);
      }
    }
  }

  return { merged, conflicts, added, updated, deleted };
}

/**
 * 두 레이어 목록을 머지
 */
export function mergeLayers(localLayers, remoteLayers) {
  const localMap = new Map(localLayers.map(l => [l.id, l]));
  const remoteMap = new Map(remoteLayers.map(l => [l.id, l]));

  const merged = [];
  let totalAdded = 0;
  let totalUpdated = 0;

  // 모든 레이어 ID 수집
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!local && remote) {
      // 원격에만 있는 레이어 → 추가
      merged.push(remote);
      totalAdded += remote.markers?.length || 0;
    } else if (local && !remote) {
      // 로컬에만 있는 레이어 → 유지
      merged.push(local);
    } else if (local && remote) {
      // 둘 다 있음 → 마커 머지
      const { merged: mergedMarkers, added, updated } = mergeComments(
        local.markers || [],
        remote.markers || []
      );

      merged.push({
        ...local,
        markers: mergedMarkers
      });

      totalAdded += added;
      totalUpdated += updated;
    }
  }

  return { merged, added: totalAdded, updated: totalUpdated };
}

export default CollaborationManager;
