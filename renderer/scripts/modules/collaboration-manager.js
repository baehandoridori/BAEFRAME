/**
 * BAEFRAME - Collaboration Manager
 * 실시간 협업 및 동기화 관리
 *
 * 기능:
 * - 협업자 presence 추적 (누가 파일을 열고 있는지)
 * - 협업자 감지 시 자동 동기화
 * - 댓글 머지 (충돌 해결)
 * - P2P 실시간 동기화 (LAN 내)
 *
 * @version 2.0
 */

import { createLogger } from '../logger.js';
import { lanDiscovery, LANDiscovery } from './lan-discovery.js';
import { p2pSync } from './p2p-sync.js';
import { MessageTypes, createMessage, compareTimestamps } from './sync-protocol.js';

const log = createLogger('CollaborationManager');

// 상수 정의
// 공유 드라이브(Google Drive, 네트워크 드라이브)의 동기화 지연을 고려하여 값 조정
const PRESENCE_UPDATE_INTERVAL = 10000;   // 10초마다 presence 업데이트 (I/O 부하 감소)
const PRESENCE_TIMEOUT = 45000;           // 45초 동안 업데이트 없으면 오프라인으로 간주 (공유 드라이브 지연 고려)
const COLLAB_FILE_EXTENSION = '.collab';  // presence 파일 확장자
const EDITING_TIMEOUT = 60000;            // 편집 잠금 60초 후 자동 해제
const COLLAB_FILE_RETRY_COUNT = 3;        // collab 파일 읽기/쓰기 재시도 횟수
const COLLAB_FILE_RETRY_DELAY = 500;      // 재시도 간격 (ms)

// 동기화 간격 설정 (동적 조정)
const SYNC_INTERVAL_SOLO = 10000;         // 혼자일 때: 10초 (동기화 안 함, 값만 유지)
const SYNC_INTERVAL_COLLAB = 5000;        // 협업자 있을 때: 5초
const SYNC_INTERVAL_ACTIVE = 3000;        // 활발한 편집 시: 3초
const ACTIVITY_WINDOW = 60000;            // 활동량 측정 윈도우: 1분
const ACTIVITY_THRESHOLD = 5;             // 활발 판단 기준: 1분 내 5회 이상

// P2P 관련 상수
const P2P_PRESENCE_UPDATE_INTERVAL = 1000;  // P2P presence 업데이트 간격 (1초)
const P2P_PRESENCE_THROTTLE = 500;          // P2P presence 스로틀링 (500ms)

/**
 * 협업 관리자
 */
export class CollaborationManager extends EventTarget {
  constructor(options = {}) {
    super();

    // 설정
    this.syncInterval = options.syncInterval || SYNC_INTERVAL_COLLAB;
    this.presenceUpdateInterval = options.presenceUpdateInterval || PRESENCE_UPDATE_INTERVAL;
    this.presenceTimeout = options.presenceTimeout || PRESENCE_TIMEOUT;

    // 상태
    this.bframePath = null;
    this.collabPath = null;
    this.sessionId = this._generateSessionId();
    this.userName = null;
    this.userColor = this._generateUserColor();

    // 협업자 목록
    this.collaborators = new Map(); // sessionId -> { name, color, lastSeen }

    // 타이머
    this._presenceTimer = null;
    this._syncTimer = null;
    this._isActive = false;

    // 콜백
    this._onRemoteDataLoaded = null;  // 원격 데이터 로드 콜백

    // 활동량 추적 (동기화 간격 동적 조정용)
    this._activityTimestamps = [];

    // P2P 관련 상태
    this.p2pEnabled = false;
    this.p2pPeers = new Map(); // P2P 연결된 피어
    this.p2pPresence = new Map(); // P2P 피어 presence (프레임 위치 등)
    this._p2pPresenceTimer = null;
    this._lastPresenceUpdate = 0;
    this._currentFrame = 0;
    this._isPlaying = false;

    // 데이터 매니저 참조 (외부에서 설정)
    this._commentManager = null;
    this._drawingManager = null;

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
    this.collabPath = bframePath + COLLAB_FILE_EXTENSION;
    this.userName = userName;
    this._isActive = true;

    log.info('협업 세션 시작', {
      bframePath,
      collabPath: this.collabPath,
      userName
    });

    // 즉시 presence 업데이트
    await this._updatePresence();

    // 주기적 presence 업데이트 시작
    this._presenceTimer = setInterval(() => {
      this._updatePresence().catch(err => {
        log.warn('Presence 업데이트 실패', { error: err.message });
      });
    }, this.presenceUpdateInterval);

    // P2P 시작
    await this._startP2P(userName);

    this._emit('sessionStarted', {
      sessionId: this.sessionId,
      userName: this.userName,
      userColor: this.userColor
    });

    // 협업자 UI 초기 업데이트 (자신 포함)
    this._updateCollaboratorsFromP2P();
  }

  /**
   * 매니저 참조 설정 (외부에서 호출)
   */
  setManagers(commentManager, drawingManager) {
    this._commentManager = commentManager;
    this._drawingManager = drawingManager;
  }

  /**
   * P2P 동기화 시작
   * @private
   */
  async _startP2P(userName) {
    try {
      // 파일 해시 생성 (같은 파일 식별용)
      const fileHash = LANDiscovery.createFileHash(this.bframePath);

      // mDNS 시작
      await lanDiscovery.start(this.sessionId, userName, fileHash);

      // P2P Sync 시작
      await p2pSync.start(this.sessionId, userName);

      // 이벤트 연결
      this._setupP2PEvents();

      this.p2pEnabled = true;
      log.info('P2P 협업 시작됨', { fileHash: fileHash?.substring(0, 8) });

    } catch (error) {
      log.warn('P2P 시작 실패, Drive 모드로 동작', { error: error.message });
      this.p2pEnabled = false;
    }
  }

  /**
   * P2P 이벤트 핸들러 설정
   * @private
   */
  _setupP2PEvents() {
    // 피어 발견 시 연결 시도
    lanDiscovery.addEventListener('peer:found', async (e) => {
      const peer = e.detail;
      log.info('P2P 피어 발견, 연결 시도', { name: peer.name, id: peer.id?.substring(0, 20) });

      // p2pSync가 준비되었는지 확인
      if (!p2pSync.isRunning) {
        log.warn('P2P Sync가 아직 시작되지 않음');
        return;
      }

      await p2pSync.connectToPeer(peer);
    });

    // 피어 연결됨
    p2pSync.addEventListener('peer:connected', (e) => {
      const { peer } = e.detail;
      this.p2pPeers.set(peer.id, peer);
      this._updateCollaboratorsFromP2P();
      this._emit('p2pPeerConnected', { peer });

      // 토스트 메시지용 이벤트
      this._emit('showToast', {
        type: 'success',
        message: `${peer.name}님과 실시간 연결되었습니다`
      });

      log.info('P2P 피어 연결됨', { name: peer.name });
    });

    // 피어 연결 해제
    p2pSync.addEventListener('peer:disconnected', (e) => {
      const { peer, reason } = e.detail;
      if (peer) {
        this.p2pPeers.delete(peer.id);
        this.p2pPresence.delete(peer.id);
        this._updateCollaboratorsFromP2P();
        this._emit('p2pPeerDisconnected', { peer, reason });

        // 토스트 메시지용 이벤트
        this._emit('showToast', {
          type: 'warning',
          message: `${peer.name}님과의 연결이 끊겼습니다`
        });

        log.info('P2P 피어 연결 해제', { name: peer.name, reason });
      }
    });

    // P2P 메시지 핸들러 등록
    this._setupP2PMessageHandlers();
  }

  /**
   * P2P 메시지 핸들러 설정
   * @private
   */
  _setupP2PMessageHandlers() {
    // 댓글 추가
    p2pSync.onMessage(MessageTypes.COMMENT_ADD, (peerId, message) => {
      const marker = message.data;
      if (this._commentManager && !this._commentManager.getMarker(marker.id)) {
        this._commentManager.addMarkerFromRemote(marker);
        this._emit('remoteCommentAdded', { marker, from: peerId });
        log.debug('원격 댓글 추가', { id: marker.id, from: message.fromName });
      }
    });

    // 댓글 수정
    p2pSync.onMessage(MessageTypes.COMMENT_UPDATE, (peerId, message) => {
      const { id, changes, updatedAt } = message.data;
      if (this._commentManager) {
        this._commentManager.updateMarkerFromRemote(id, changes, updatedAt);
        this._emit('remoteCommentUpdated', { id, changes, from: peerId });
        log.debug('원격 댓글 수정', { id, from: message.fromName });
      }
    });

    // 댓글 삭제
    p2pSync.onMessage(MessageTypes.COMMENT_DELETE, (peerId, message) => {
      const { id } = message.data;
      if (this._commentManager) {
        this._commentManager.deleteMarkerFromRemote(id);
        this._emit('remoteCommentDeleted', { id, from: peerId });
        log.debug('원격 댓글 삭제', { id, from: message.fromName });
      }
    });

    // resolved 상태 변경
    p2pSync.onMessage(MessageTypes.COMMENT_RESOLVE, (peerId, message) => {
      const { id, resolved } = message.data;
      if (this._commentManager) {
        this._commentManager.updateMarkerFromRemote(id, { resolved }, message.data.updatedAt);
        this._emit('remoteCommentResolved', { id, resolved, from: peerId });
        log.debug('원격 댓글 resolved 변경', { id, resolved, from: message.fromName });
      }
    });

    // 답글 추가
    p2pSync.onMessage(MessageTypes.REPLY_ADD, (peerId, message) => {
      const { markerId, reply } = message.data;
      if (this._commentManager) {
        this._commentManager.addReplyFromRemote(markerId, reply);
        this._emit('remoteReplyAdded', { markerId, reply, from: peerId });
        log.debug('원격 답글 추가', { markerId, from: message.fromName });
      }
    });

    // Presence 업데이트
    p2pSync.onMessage(MessageTypes.PRESENCE_UPDATE, (peerId, message) => {
      const { userName, currentFrame, isPlaying, updatedAt } = message.data;
      this.p2pPresence.set(peerId, {
        userName,
        currentFrame,
        isPlaying,
        updatedAt
      });
      this._emit('peerPresenceUpdated', { peerId, ...message.data });
    });

    // Heartbeat
    p2pSync.onMessage(MessageTypes.HEARTBEAT, (peerId, message) => {
      // 피어가 살아있음 확인
      const peer = this.p2pPeers.get(peerId);
      if (peer) {
        peer.lastActivity = new Date().toISOString();
      }
    });

    // 전체 동기화 요청
    p2pSync.onMessage(MessageTypes.SYNC_REQUEST, (peerId, message) => {
      this._handleSyncRequest(peerId);
    });

    // 전체 동기화 응답
    p2pSync.onMessage(MessageTypes.SYNC_RESPONSE, (peerId, message) => {
      this._handleSyncResponse(peerId, message.data);
    });
  }

  /**
   * 전체 동기화 요청 처리
   * @private
   */
  _handleSyncRequest(peerId) {
    if (!this._commentManager) return;

    const comments = this._commentManager.getAllMarkers();
    const drawings = this._drawingManager?.getAllDrawings() || [];

    const message = createMessage.syncResponse(comments, drawings, null);
    p2pSync.sendTo(peerId, message);
    log.info('동기화 데이터 전송', { peerId, commentCount: comments.length });
  }

  /**
   * 전체 동기화 응답 처리
   * @private
   */
  _handleSyncResponse(peerId, data) {
    log.info('동기화 데이터 수신', {
      from: peerId,
      commentCount: data.comments?.length || 0
    });
    // 실제 머지 로직은 기존 mergeComments 활용
    // 여기서는 이벤트만 발생시키고 외부에서 처리
    this._emit('syncDataReceived', { from: peerId, ...data });
  }

  /**
   * P2P 피어 목록으로 협업자 목록 업데이트
   * @private
   */
  _updateCollaboratorsFromP2P() {
    this._emit('collaboratorsChanged', {
      collaborators: this.getCollaborators(),
      count: this.collaborators.size + this.p2pPeers.size
    });
  }

  /**
   * 협업 세션 종료
   */
  async stop() {
    if (!this._isActive) return;

    // 편집 잠금 먼저 해제 (_isActive가 true일 때 해야 함)
    await this.releaseAllEditingLocks();

    this._isActive = false;

    // 타이머 정리
    if (this._presenceTimer) {
      clearInterval(this._presenceTimer);
      this._presenceTimer = null;
    }
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
    if (this._p2pPresenceTimer) {
      clearInterval(this._p2pPresenceTimer);
      this._p2pPresenceTimer = null;
    }

    // P2P 정리
    if (this.p2pEnabled) {
      await lanDiscovery.stop();
      await p2pSync.stop();
      this.p2pEnabled = false;
      this.p2pPeers.clear();
      this.p2pPresence.clear();
    }

    // 자신의 presence 제거
    await this._removePresence();

    this.collaborators.clear();

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
        connectionType: this.p2pEnabled ? 'p2p' : 'drive'
      });
    }

    // Drive 협업자 (기존 .collab 파일 기반)
    for (const [sessionId, info] of this.collaborators) {
      // 자기 자신은 이미 추가했으므로 제외
      if (sessionId === this.sessionId) continue;
      // P2P로 연결된 피어는 제외 (중복 방지)
      if (this.p2pPeers.has(sessionId)) continue;

      result.push({
        sessionId,
        name: info.name,
        color: info.color,
        isMe: false,
        connectionType: 'drive',
        lastSeen: info.lastSeen
      });
    }

    // P2P 연결된 피어
    for (const [peerId, peer] of this.p2pPeers) {
      const presence = this.p2pPresence.get(peerId);
      result.push({
        sessionId: peerId,
        name: peer.name,
        color: peer.color || this._generateUserColor(),
        isMe: false,
        connectionType: 'p2p',
        currentFrame: presence?.currentFrame,
        isPlaying: presence?.isPlaying,
        lastActivity: peer.lastActivity || peer.connectedAt
      });
    }

    return result;
  }

  /**
   * 변경 사항 P2P 동기화
   * @param {string} changeType - 변경 타입 (comment:add, comment:update 등)
   * @param {Object} data - 변경 데이터
   */
  async syncChange(changeType, data) {
    // P2P로 즉시 전송
    if (this.p2pEnabled && p2pSync.hasConnectedPeers()) {
      let message;
      switch (changeType) {
      case 'comment:add':
        message = createMessage.commentAdd(data);
        break;
      case 'comment:update':
        message = createMessage.commentUpdate(data.id, data.changes);
        break;
      case 'comment:delete':
        message = createMessage.commentDelete(data.id);
        break;
      case 'comment:resolve':
        message = createMessage.commentResolve(data.id, data.resolved);
        break;
      case 'reply:add':
        message = createMessage.replyAdd(data.markerId, data.reply);
        break;
      case 'drawing:add':
        message = createMessage.drawingAdd(data);
        break;
      case 'drawing:delete':
        message = createMessage.drawingDelete(data.id);
        break;
      }

      if (message) {
        const sentCount = p2pSync.broadcast(message);
        log.debug('P2P 브로드캐스트', { type: changeType, sentCount });
      }
    }

    // Drive에도 저장 (백업 + WAN 사용자용)
    // 저장은 외부에서 처리 (reviewDataManager.save())
    this.recordActivity();
  }

  /**
   * Presence 업데이트 (프레임 위치 공유)
   * @param {number} currentFrame - 현재 프레임
   * @param {boolean} isPlaying - 재생 중 여부
   */
  updatePresenceFrame(currentFrame, isPlaying) {
    // 스로틀링
    const now = Date.now();
    if (now - this._lastPresenceUpdate < P2P_PRESENCE_THROTTLE) {
      return;
    }

    this._currentFrame = currentFrame;
    this._isPlaying = isPlaying;
    this._lastPresenceUpdate = now;

    // P2P로 전송
    if (this.p2pEnabled && p2pSync.hasConnectedPeers()) {
      const message = createMessage.presenceUpdate(this.userName, currentFrame, isPlaying);
      p2pSync.broadcast(message);
    }
  }

  /**
   * P2P 연결 상태 반환
   * @returns {Object}
   */
  getP2PStatus() {
    return {
      enabled: this.p2pEnabled,
      connectedPeers: p2pSync.getConnectedPeers().length,
      discoveredPeers: lanDiscovery.getPeers().length
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
    return this.collaborators.size > 1 ||
           (this.collaborators.size === 1 && !this.collaborators.has(this.sessionId));
  }

  /**
   * 수동 동기화 트리거
   */
  async syncNow() {
    if (!this._isActive || !this.bframePath) return;

    log.info('수동 동기화 시작');
    await this._performSync();
  }

  /**
   * 활동 기록 (데이터 변경 시 외부에서 호출)
   * 동기화 간격 동적 조정에 사용
   */
  recordActivity() {
    const now = Date.now();
    this._activityTimestamps.push(now);

    // 오래된 기록 정리 (ACTIVITY_WINDOW 밖의 기록 제거)
    this._activityTimestamps = this._activityTimestamps.filter(
      t => now - t < ACTIVITY_WINDOW
    );

    // 협업자 있으면 간격 재조정
    if (this.hasOtherCollaborators()) {
      this._adjustSyncInterval();
    }
  }

  /**
   * 최근 활동 횟수 반환
   */
  get recentActivityCount() {
    const now = Date.now();
    return this._activityTimestamps.filter(t => now - t < ACTIVITY_WINDOW).length;
  }

  /**
   * 동기화 간격 동적 조정
   */
  _adjustSyncInterval() {
    let newInterval;

    if (!this.hasOtherCollaborators()) {
      newInterval = SYNC_INTERVAL_SOLO;
    } else if (this.recentActivityCount >= ACTIVITY_THRESHOLD) {
      newInterval = SYNC_INTERVAL_ACTIVE;
    } else {
      newInterval = SYNC_INTERVAL_COLLAB;
    }

    // 간격이 변경되었으면 타이머 재시작
    if (newInterval !== this.syncInterval) {
      log.info('동기화 간격 조정', {
        from: this.syncInterval,
        to: newInterval,
        activityCount: this.recentActivityCount
      });
      this.syncInterval = newInterval;
      this._restartSyncTimer();
    }
  }

  /**
   * 동기화 타이머 재시작
   */
  _restartSyncTimer() {
    this._stopSyncTimer();
    if (this.hasOtherCollaborators()) {
      this._startSyncTimer();
    }
  }

  // ============================================================================
  // 댓글 편집 잠금 메서드
  // ============================================================================

  /**
   * 댓글 편집 시작 (잠금 획득 시도)
   * @param {string} markerId - 편집할 마커 ID
   * @returns {Promise<{success: boolean, lockedBy?: string}>}
   */
  async startEditing(markerId) {
    // 협업 중이 아니면 바로 성공
    if (!this._isActive || !this.collabPath || !this.hasOtherCollaborators()) {
      return { success: true };
    }

    try {
      const collabData = await this._readCollabFile() || {
        version: '1.1',
        presence: {},
        editingState: {}
      };

      // 기존 편집 상태 확인
      const existing = collabData.editingState?.[markerId];
      if (existing && existing.sessionId !== this.sessionId) {
        // 타임아웃 체크
        const elapsed = Date.now() - new Date(existing.startedAt).getTime();
        if (elapsed < EDITING_TIMEOUT) {
          log.info('편집 잠금 실패: 다른 사용자가 편집 중', {
            markerId,
            lockedBy: existing.userName
          });
          return { success: false, lockedBy: existing.userName };
        }
        // 타임아웃됨 - 잠금 해제하고 새로 획득
      }

      // 편집 상태 설정
      if (!collabData.editingState) {
        collabData.editingState = {};
      }

      collabData.editingState[markerId] = {
        sessionId: this.sessionId,
        userName: this.userName,
        startedAt: new Date().toISOString()
      };

      await this._writeCollabFile(collabData);

      log.info('편집 잠금 획득', { markerId });
      return { success: true };

    } catch (error) {
      log.warn('편집 잠금 설정 실패', { error: error.message });
      // 실패 시에도 편집 허용 (fail-open)
      return { success: true };
    }
  }

  /**
   * 댓글 편집 종료 (잠금 해제)
   * @param {string} markerId - 편집 완료한 마커 ID
   */
  async stopEditing(markerId) {
    if (!this._isActive || !this.collabPath) return;

    try {
      const collabData = await this._readCollabFile();

      if (collabData?.editingState?.[markerId]?.sessionId === this.sessionId) {
        delete collabData.editingState[markerId];
        await this._writeCollabFile(collabData);
        log.info('편집 잠금 해제', { markerId });
      }
    } catch (error) {
      log.warn('편집 잠금 해제 실패', { error: error.message });
    }
  }

  /**
   * 다른 사람이 편집 중인지 확인
   * @param {string} markerId
   * @returns {Promise<{isLocked: boolean, lockedBy?: string}>}
   */
  async isBeingEdited(markerId) {
    // 협업 중이 아니면 잠금 없음
    if (!this._isActive || !this.collabPath || !this.hasOtherCollaborators()) {
      return { isLocked: false };
    }

    try {
      const collabData = await this._readCollabFile();
      const existing = collabData?.editingState?.[markerId];

      if (!existing || existing.sessionId === this.sessionId) {
        return { isLocked: false };
      }

      // 타임아웃 체크
      const elapsed = Date.now() - new Date(existing.startedAt).getTime();
      if (elapsed >= EDITING_TIMEOUT) {
        return { isLocked: false };
      }

      return { isLocked: true, lockedBy: existing.userName };

    } catch {
      return { isLocked: false };
    }
  }

  /**
   * 앱 종료 시 모든 편집 잠금 해제
   */
  async releaseAllEditingLocks() {
    if (!this._isActive || !this.collabPath) return;

    try {
      const collabData = await this._readCollabFile();

      if (collabData?.editingState) {
        // 내 세션의 모든 편집 잠금 해제
        let changed = false;
        for (const [markerId, info] of Object.entries(collabData.editingState)) {
          if (info.sessionId === this.sessionId) {
            delete collabData.editingState[markerId];
            changed = true;
          }
        }

        if (changed) {
          await this._writeCollabFile(collabData);
          log.info('모든 편집 잠금 해제됨');
        }
      }
    } catch (error) {
      log.warn('편집 잠금 일괄 해제 실패', { error: error.message });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Presence 업데이트 (내 상태를 collab 파일에 기록)
   */
  async _updatePresence() {
    if (!this._isActive || !this.collabPath) return;

    try {
      // 현재 collab 데이터 읽기
      const collabData = await this._readCollabFile();

      // 읽기 실패 시 기존 협업자 목록 유지 (타임아웃 체크만 수행)
      if (!collabData) {
        log.debug('Collab 파일 읽기 실패, 기존 협업자 목록 유지하며 타임아웃만 체크');
        this._cleanupTimeoutCollaborators();
        return;
      }

      // 내 presence 업데이트
      collabData.presence[this.sessionId] = {
        name: this.userName,
        color: this.userColor,
        lastSeen: new Date().toISOString(),
        startedAt: collabData.presence[this.sessionId]?.startedAt || new Date().toISOString()
      };

      // 오래된 presence 정리 (타임아웃된 사용자 제거)
      const now = Date.now();
      const activePresence = {};

      for (const [sessionId, info] of Object.entries(collabData.presence)) {
        const lastSeen = new Date(info.lastSeen).getTime();
        if (now - lastSeen < this.presenceTimeout) {
          activePresence[sessionId] = info;
        }
      }

      collabData.presence = activePresence;

      // collab 파일 저장
      await this._writeCollabFile(collabData);

      // 협업자 목록 업데이트
      this._updateCollaboratorsList(activePresence);

    } catch (error) {
      log.warn('Presence 업데이트 실패, 기존 협업자 목록 유지', { error: error.message });
      // 실패 시에도 타임아웃 체크는 수행
      this._cleanupTimeoutCollaborators();
    }
  }

  /**
   * 자신의 Presence 제거
   */
  async _removePresence() {
    if (!this.collabPath) return;

    try {
      const collabData = await this._readCollabFile();

      if (collabData?.presence) {
        delete collabData.presence[this.sessionId];
        await this._writeCollabFile(collabData);
      }
    } catch (error) {
      log.warn('Presence 제거 실패', { error: error.message });
    }
  }

  /**
   * 타임아웃된 협업자만 제거 (collab 파일 읽기 실패 시 사용)
   * 기존 협업자 목록은 유지하면서 타임아웃된 사용자만 제거
   */
  _cleanupTimeoutCollaborators() {
    const now = Date.now();
    let removedCount = 0;
    const hadOthers = this.hasOtherCollaborators();

    for (const [sessionId, info] of this.collaborators) {
      // 자신은 제거하지 않음
      if (sessionId === this.sessionId) continue;

      const lastSeen = new Date(info.lastSeen).getTime();
      if (now - lastSeen >= this.presenceTimeout) {
        this.collaborators.delete(sessionId);
        removedCount++;
        log.debug('타임아웃된 협업자 제거', { sessionId, name: info.name });
      }
    }

    // 협업자가 제거되었으면 이벤트 발생
    if (removedCount > 0) {
      this._emit('collaboratorsChanged', {
        collaborators: this.getCollaborators(),
        count: this.collaborators.size
      });

      // 혼자 남았으면 동기화 중지
      if (hadOthers && !this.hasOtherCollaborators()) {
        log.info('혼자 남음 (타임아웃 정리), 자동 동기화 중지');
        this._stopSyncTimer();
        this._emit('collaborationEnded', {});
      }
    }
  }

  /**
   * 협업자 목록 업데이트 및 이벤트 발생
   */
  _updateCollaboratorsList(presenceData) {
    const hadOthers = this.hasOtherCollaborators();

    // 기존 협업자 sessionId 목록
    const previousIds = new Set(this.collaborators.keys());
    const newIds = new Set(Object.keys(presenceData));

    // 실제 변경 여부 확인 (sessionId 기준)
    const hasChanged = previousIds.size !== newIds.size ||
      [...previousIds].some(id => !newIds.has(id)) ||
      [...newIds].some(id => !previousIds.has(id));

    // 협업자 목록 업데이트
    this.collaborators.clear();
    for (const [sessionId, info] of Object.entries(presenceData)) {
      this.collaborators.set(sessionId, {
        name: info.name,
        color: info.color,
        lastSeen: info.lastSeen,
        startedAt: info.startedAt
      });
    }

    const hasOthersNow = this.hasOtherCollaborators();

    // 협업자 목록이 실제로 변경되었을 때만 이벤트 발생
    if (hasChanged) {
      this._emit('collaboratorsChanged', {
        collaborators: this.getCollaborators(),
        count: this.collaborators.size
      });
    }

    // 다른 협업자가 생겼으면 동기화 시작
    if (!hadOthers && hasOthersNow) {
      log.info('다른 협업자 감지됨, 자동 동기화 시작');
      this._startSyncTimer();
      this._emit('collaborationStarted', {
        collaborators: this.getCollaborators()
      });
    }

    // 혼자 남았으면 동기화 중지
    if (hadOthers && !hasOthersNow) {
      log.info('혼자 남음, 자동 동기화 중지');
      this._stopSyncTimer();
      this._emit('collaborationEnded', {});
    }
  }

  /**
   * 동기화 타이머 시작
   */
  _startSyncTimer() {
    if (this._syncTimer) return;

    this._syncTimer = setInterval(() => {
      this._performSync().catch(err => {
        log.warn('자동 동기화 실패', { error: err.message });
      });
    }, this.syncInterval);

    // 즉시 한 번 동기화
    this._performSync().catch(() => {});
  }

  /**
   * 동기화 타이머 중지
   */
  _stopSyncTimer() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }

  /**
   * 동기화 수행
   */
  async _performSync() {
    if (!this._isActive || !this.bframePath) return;

    try {
      // 원격 파일의 수정 시간 확인
      const remoteStats = await window.electronAPI.getFileStats(this.bframePath);

      if (!remoteStats) {
        return; // 파일이 없음
      }

      // 원격 데이터 로드 콜백 호출
      if (this._onRemoteDataLoaded) {
        this._emit('syncStarted', {});
        await this._onRemoteDataLoaded();
        this._emit('syncCompleted', {
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      log.warn('동기화 실패', { error: error.message });
      this._emit('syncError', { error: error.message });
    }
  }

  /**
   * Collab 파일 읽기 (재시도 로직 포함)
   * 공유 드라이브에서 동기화 지연이나 일시적 오류에 대응
   */
  async _readCollabFile() {
    let lastError = null;

    for (let attempt = 1; attempt <= COLLAB_FILE_RETRY_COUNT; attempt++) {
      try {
        const data = await window.electronAPI.readCollabFile(this.collabPath);
        return data;
      } catch (error) {
        lastError = error;
        log.debug('Collab 파일 읽기 실패', {
          attempt,
          maxAttempts: COLLAB_FILE_RETRY_COUNT,
          error: error.message
        });

        // 마지막 시도가 아니면 재시도 대기
        if (attempt < COLLAB_FILE_RETRY_COUNT) {
          await this._delay(COLLAB_FILE_RETRY_DELAY * attempt); // 지수 백오프
        }
      }
    }

    // 모든 재시도 실패 시 로그 기록
    if (lastError) {
      log.warn('Collab 파일 읽기 최종 실패', {
        path: this.collabPath,
        error: lastError.message
      });
    }
    return null;
  }

  /**
   * Collab 파일 쓰기 (재시도 로직 포함)
   * 공유 드라이브에서 동기화 지연이나 파일 잠금 오류에 대응
   */
  async _writeCollabFile(data) {
    let lastError = null;

    for (let attempt = 1; attempt <= COLLAB_FILE_RETRY_COUNT; attempt++) {
      try {
        await window.electronAPI.writeCollabFile(this.collabPath, data);
        return; // 성공 시 종료
      } catch (error) {
        lastError = error;
        log.debug('Collab 파일 쓰기 실패', {
          attempt,
          maxAttempts: COLLAB_FILE_RETRY_COUNT,
          error: error.message
        });

        // 마지막 시도가 아니면 재시도 대기
        if (attempt < COLLAB_FILE_RETRY_COUNT) {
          await this._delay(COLLAB_FILE_RETRY_DELAY * attempt); // 지수 백오프
        }
      }
    }

    // 모든 재시도 실패 시 에러 기록 및 이벤트 발생
    if (lastError) {
      log.warn('Collab 파일 쓰기 최종 실패', {
        path: this.collabPath,
        error: lastError.message
      });
      // 쓰기 실패 이벤트 발생 (UI에서 사용자에게 알릴 수 있도록)
      this._emit('collabWriteError', {
        error: lastError.message,
        path: this.collabPath
      });
    }
  }

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
