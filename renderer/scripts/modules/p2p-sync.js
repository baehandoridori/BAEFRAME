/**
 * BAEFRAME - P2P Sync (Renderer)
 * WebRTC DataChannel을 통한 P2P 동기화
 *
 * 기능:
 * - 발견된 피어와 WebRTC 연결
 * - DataChannel을 통한 메시지 송수신
 * - 연결 상태 관리
 *
 * @version 1.0
 */

import { createLogger } from '../logger.js';
import { lanDiscovery } from './lan-discovery.js';

const log = createLogger('P2PSync');

// 상수
const CONNECTION_TIMEOUT = 10000; // 10초
const HEARTBEAT_INTERVAL = 5000; // 5초
const RECONNECT_DELAY = 3000; // 3초
const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * P2P 동기화 클래스
 * WebRTC DataChannel을 통한 피어 간 직접 통신
 */
export class P2PSync extends EventTarget {
  constructor() {
    super();

    this.connections = new Map(); // peerId -> { pc, channel, state, peer }
    this.sessionId = null;
    this.userName = null;
    this.messageHandlers = new Map(); // messageType -> handler
    this.heartbeatTimer = null;
    this.isRunning = false;
    this.pendingSignals = new Map(); // peerId -> [signals]

    // 시그널 수신 이벤트 처리
    this._setupSignalHandler();
  }

  /**
   * 시그널 핸들러 설정
   */
  _setupSignalHandler() {
    lanDiscovery.addEventListener('signal', async (e) => {
      const signal = e.detail;
      await this._handleIncomingSignal(signal);
    });
  }

  /**
   * P2P 동기화 시작
   * @param {string} sessionId - 세션 ID
   * @param {string} userName - 사용자 이름
   */
  async start(sessionId, userName) {
    if (this.isRunning) {
      await this.stop();
    }

    this.sessionId = sessionId;
    this.userName = userName;
    this.isRunning = true;

    // Heartbeat 시작
    this._startHeartbeat();

    log.info('P2P Sync 시작됨', { sessionId, userName });
    this._emit('started');
  }

  /**
   * 피어와 연결 (Offerer)
   * @param {Object} peer - 피어 정보
   */
  async connectToPeer(peer) {
    if (!this.isRunning) return;

    if (this.connections.has(peer.id)) {
      const existing = this.connections.get(peer.id);
      if (existing.state === 'connected' || existing.state === 'connecting') {
        log.debug('이미 연결된 피어', { peer: peer.name });
        return;
      }
    }

    try {
      log.info('피어 연결 시도', { peer: peer.name, ip: peer.ip });

      // RTCPeerConnection 생성 (LAN에서는 STUN 불필요)
      const pc = new RTCPeerConnection({
        iceServers: [] // LAN 환경이므로 STUN/TURN 불필요
      });

      // 연결 정보 저장
      const connectionInfo = {
        pc,
        channel: null,
        state: 'connecting',
        peer,
        connectedAt: null,
        reconnectAttempts: 0
      };
      this.connections.set(peer.id, connectionInfo);

      // ICE 후보 수집
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._sendSignal(peer.id, {
            type: 'ice-candidate',
            candidate: event.candidate
          });
        }
      };

      // ICE 연결 상태 변경
      pc.oniceconnectionstatechange = () => {
        log.debug('ICE 상태 변경', { peer: peer.name, state: pc.iceConnectionState });

        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          this._handleDisconnection(peer.id, 'ICE failed');
        }
      };

      // 연결 상태 변경
      pc.onconnectionstatechange = () => {
        log.debug('연결 상태 변경', { peer: peer.name, state: pc.connectionState });
        connectionInfo.state = pc.connectionState;

        if (pc.connectionState === 'connected') {
          connectionInfo.connectedAt = new Date().toISOString();
          connectionInfo.reconnectAttempts = 0;
          this._emit('peer:connected', { peer, connectionType: 'p2p' });
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this._handleDisconnection(peer.id, pc.connectionState);
        }
      };

      // 데이터 채널 생성 (Offerer)
      const channel = pc.createDataChannel('baeframe-sync', {
        ordered: true // 순서 보장
      });

      this._setupDataChannel(channel, peer.id);
      connectionInfo.channel = channel;

      // Offer 생성 및 전송
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await this._sendSignal(peer.id, {
        type: 'offer',
        sdp: pc.localDescription
      });

      // 타임아웃 설정
      setTimeout(() => {
        const conn = this.connections.get(peer.id);
        if (conn && conn.state === 'connecting') {
          log.warn('연결 타임아웃', { peer: peer.name });
          this._handleDisconnection(peer.id, 'timeout');
        }
      }, CONNECTION_TIMEOUT);

    } catch (error) {
      log.error('피어 연결 실패', { peer: peer.name, error: error.message });
      this._handleDisconnection(peer.id, error.message);
    }
  }

  /**
   * 수신 시그널 처리
   * @param {Object} signal - 시그널 데이터
   */
  async _handleIncomingSignal(signal) {
    const fromPeerId = signal.from;

    if (signal.type === 'offer') {
      // Offer 수신 (Answerer)
      await this._handleOffer(fromPeerId, signal);
    } else if (signal.type === 'answer') {
      // Answer 수신
      const conn = this.connections.get(fromPeerId);
      if (conn?.pc) {
        try {
          await conn.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          // 대기 중인 ICE 후보 적용
          await this._applyPendingCandidates(fromPeerId);
        } catch (error) {
          log.error('Answer 처리 실패', { error: error.message });
        }
      }
    } else if (signal.type === 'ice-candidate') {
      // ICE 후보 수신
      const conn = this.connections.get(fromPeerId);
      if (conn?.pc) {
        try {
          if (conn.pc.remoteDescription) {
            await conn.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            // Remote description이 아직 없으면 대기열에 저장
            if (!this.pendingSignals.has(fromPeerId)) {
              this.pendingSignals.set(fromPeerId, []);
            }
            this.pendingSignals.get(fromPeerId).push(signal);
          }
        } catch (error) {
          log.warn('ICE 후보 추가 실패', { error: error.message });
        }
      }
    }
  }

  /**
   * 대기 중인 ICE 후보 적용
   * @param {string} peerId - 피어 ID
   */
  async _applyPendingCandidates(peerId) {
    const pending = this.pendingSignals.get(peerId);
    if (!pending || pending.length === 0) return;

    const conn = this.connections.get(peerId);
    if (!conn?.pc) return;

    for (const signal of pending) {
      if (signal.type === 'ice-candidate') {
        try {
          await conn.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (error) {
          log.warn('대기 ICE 후보 추가 실패', { error: error.message });
        }
      }
    }

    this.pendingSignals.delete(peerId);
  }

  /**
   * Offer 수신 처리 (Answerer)
   * @param {string} peerId - 피어 ID
   * @param {Object} signal - 시그널 데이터
   */
  async _handleOffer(peerId, signal) {
    try {
      const peerInfo = {
        id: peerId,
        name: signal.fromName || '알 수 없음',
        ip: signal.fromIP
      };

      // RTCPeerConnection 생성
      const pc = new RTCPeerConnection({
        iceServers: []
      });

      const connectionInfo = {
        pc,
        channel: null,
        state: 'connecting',
        peer: peerInfo,
        connectedAt: null,
        reconnectAttempts: 0
      };
      this.connections.set(peerId, connectionInfo);

      // ICE 후보 수집
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._sendSignal(peerId, {
            type: 'ice-candidate',
            candidate: event.candidate
          });
        }
      };

      // 데이터 채널 수신
      pc.ondatachannel = (event) => {
        this._setupDataChannel(event.channel, peerId);
        connectionInfo.channel = event.channel;
      };

      // 연결 상태 변경
      pc.onconnectionstatechange = () => {
        connectionInfo.state = pc.connectionState;

        if (pc.connectionState === 'connected') {
          connectionInfo.connectedAt = new Date().toISOString();
          this._emit('peer:connected', { peer: peerInfo, connectionType: 'p2p' });
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this._handleDisconnection(peerId, pc.connectionState);
        }
      };

      // Remote description 설정
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));

      // Answer 생성 및 전송
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await this._sendSignal(peerId, {
        type: 'answer',
        sdp: pc.localDescription
      });

      log.info('Offer 수락, Answer 전송', { peer: peerInfo.name });

    } catch (error) {
      log.error('Offer 처리 실패', { error: error.message });
    }
  }

  /**
   * 데이터 채널 설정
   * @param {RTCDataChannel} channel - 데이터 채널
   * @param {string} peerId - 피어 ID
   */
  _setupDataChannel(channel, peerId) {
    channel.onopen = () => {
      log.info('데이터 채널 열림', { peerId });
      const conn = this.connections.get(peerId);
      if (conn) {
        conn.state = 'connected';
        conn.channel = channel;
      }
      this._emit('channel:open', { peerId });
    };

    channel.onclose = () => {
      log.info('데이터 채널 닫힘', { peerId });
      this._handleDisconnection(peerId, 'channel closed');
    };

    channel.onerror = (error) => {
      log.error('데이터 채널 오류', { peerId, error: error.message || 'unknown' });
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this._handleMessage(peerId, message);
      } catch (error) {
        log.error('메시지 파싱 오류', { peerId, error: error.message });
      }
    };
  }

  /**
   * 시그널 전송
   * @param {string} peerId - 대상 피어 ID
   * @param {Object} signal - 시그널 데이터
   */
  async _sendSignal(peerId, signal) {
    try {
      await lanDiscovery.sendSignal(peerId, {
        ...signal,
        fromName: this.userName
      });
    } catch (error) {
      log.warn('시그널 전송 실패', { peerId, error: error.message });
    }
  }

  /**
   * 메시지 핸들러 등록
   * @param {string} type - 메시지 타입
   * @param {Function} handler - 핸들러 함수
   */
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  /**
   * 메시지 처리
   * @param {string} peerId - 피어 ID
   * @param {Object} message - 메시지
   */
  _handleMessage(peerId, message) {
    log.debug('메시지 수신', { peerId, type: message.type });

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        handler(peerId, message);
      } catch (error) {
        log.error('메시지 핸들러 오류', { type: message.type, error: error.message });
      }
    }

    this._emit('message', { peerId, message });
  }

  /**
   * 모든 연결된 피어에게 메시지 브로드캐스트
   * @param {Object} message - 메시지
   * @returns {number} 전송된 피어 수
   */
  broadcast(message) {
    const data = JSON.stringify({
      ...message,
      from: this.sessionId,
      fromName: this.userName,
      timestamp: new Date().toISOString()
    });

    let sentCount = 0;
    for (const [peerId, conn] of this.connections) {
      if (conn.channel?.readyState === 'open') {
        try {
          conn.channel.send(data);
          sentCount++;
        } catch (error) {
          log.error('메시지 전송 실패', { peerId, error: error.message });
        }
      }
    }

    log.debug('브로드캐스트', { type: message.type, sentCount });
    return sentCount;
  }

  /**
   * 특정 피어에게 메시지 전송
   * @param {string} peerId - 피어 ID
   * @param {Object} message - 메시지
   * @returns {boolean} 전송 성공 여부
   */
  sendTo(peerId, message) {
    const conn = this.connections.get(peerId);
    if (conn?.channel?.readyState === 'open') {
      try {
        const data = JSON.stringify({
          ...message,
          from: this.sessionId,
          fromName: this.userName,
          timestamp: new Date().toISOString()
        });
        conn.channel.send(data);
        return true;
      } catch (error) {
        log.error('메시지 전송 실패', { peerId, error: error.message });
      }
    }
    return false;
  }

  /**
   * 연결된 피어가 있는지 확인
   * @returns {boolean}
   */
  hasConnectedPeers() {
    for (const conn of this.connections.values()) {
      if (conn.channel?.readyState === 'open') {
        return true;
      }
    }
    return false;
  }

  /**
   * 연결된 피어 목록
   * @returns {Array<Object>}
   */
  getConnectedPeers() {
    const peers = [];
    for (const conn of this.connections.values()) {
      if (conn.state === 'connected' && conn.peer) {
        peers.push({
          ...conn.peer,
          connectedAt: conn.connectedAt,
          connectionType: 'p2p'
        });
      }
    }
    return peers;
  }

  /**
   * 연결 해제 처리
   * @param {string} peerId - 피어 ID
   * @param {string} reason - 해제 이유
   */
  _handleDisconnection(peerId, reason = 'unknown') {
    const conn = this.connections.get(peerId);
    if (!conn) return;

    // 재연결 시도
    if (conn.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && this.isRunning) {
      conn.reconnectAttempts++;
      log.info('재연결 시도', {
        peer: conn.peer?.name,
        attempt: conn.reconnectAttempts,
        reason
      });

      // 기존 연결 정리
      if (conn.channel) {
        try { conn.channel.close(); } catch (e) { /* ignore */ }
      }
      if (conn.pc) {
        try { conn.pc.close(); } catch (e) { /* ignore */ }
      }

      // 잠시 후 재연결
      setTimeout(() => {
        if (this.isRunning && conn.peer) {
          this.connectToPeer(conn.peer);
        }
      }, RECONNECT_DELAY);

      return;
    }

    // 재연결 실패 또는 최대 시도 초과
    if (conn.channel) {
      try { conn.channel.close(); } catch (e) { /* ignore */ }
    }
    if (conn.pc) {
      try { conn.pc.close(); } catch (e) { /* ignore */ }
    }

    const peer = conn.peer;
    this.connections.delete(peerId);
    this.pendingSignals.delete(peerId);

    log.info('피어 연결 해제', { peer: peer?.name, reason });
    this._emit('peer:disconnected', { peer, reason });
  }

  /**
   * Heartbeat 시작
   */
  _startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      if (this.hasConnectedPeers()) {
        this.broadcast({
          type: 'heartbeat',
          userName: this.userName
        });
      }
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * P2P 동기화 중지
   */
  async stop() {
    this.isRunning = false;

    // Heartbeat 정지
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 모든 연결 종료
    for (const [peerId, conn] of this.connections) {
      if (conn.channel) {
        try { conn.channel.close(); } catch (e) { /* ignore */ }
      }
      if (conn.pc) {
        try { conn.pc.close(); } catch (e) { /* ignore */ }
      }
    }

    this.connections.clear();
    this.pendingSignals.clear();
    this.messageHandlers.clear();

    log.info('P2P Sync 중지됨');
    this._emit('stopped');
  }

  /**
   * 이벤트 발생 헬퍼
   * @private
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// 싱글톤 인스턴스
export const p2pSync = new P2PSync();
