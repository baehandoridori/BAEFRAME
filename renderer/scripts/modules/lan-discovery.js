/**
 * BAEFRAME - LAN Discovery (Renderer)
 * 메인 프로세스의 P2P 서비스와 IPC로 통신하는 래퍼
 *
 * 기능:
 * - mDNS를 통한 피어 자동 발견
 * - 같은 파일을 열고 있는 피어 추적
 * - WebRTC 시그널링 지원
 *
 * @version 1.0
 */

import { createLogger } from '../logger.js';

const log = createLogger('LANDiscovery');

// 상수
const FILE_HASH_LENGTH = 16;

/**
 * LAN Discovery 클래스
 * 메인 프로세스의 P2P 서비스와 통신
 */
export class LANDiscovery extends EventTarget {
  constructor() {
    super();

    this.sessionId = null;
    this.userName = null;
    this.currentFileHash = null;
    this.localIP = null;
    this.peers = new Map(); // peerId -> peerInfo
    this.isRunning = false;

    // 이벤트 리스너 설정
    this._setupEventListeners();
  }

  /**
   * 메인 프로세스 이벤트 리스너 설정
   */
  _setupEventListeners() {
    // 피어 발견
    window.electronAPI.onP2PPeerFound((peer) => {
      log.info('피어 발견', { name: peer.name, ip: peer.ip });
      this.peers.set(peer.id, peer);
      this._emit('peer:found', peer);
      this._emit('peers:changed', { peers: this.getPeers() });
    });

    // 피어 연결 해제
    window.electronAPI.onP2PPeerLost((peer) => {
      log.info('피어 연결 해제', { name: peer.name });
      this.peers.delete(peer.id);
      this._emit('peer:lost', peer);
      this._emit('peers:changed', { peers: this.getPeers() });
    });

    // 시그널 수신 (WebRTC 연결용)
    window.electronAPI.onP2PSignal((signal) => {
      log.debug('시그널 수신', { from: signal.from, type: signal.type });
      this._emit('signal', signal);
    });
  }

  /**
   * LAN Discovery 시작
   * @param {string} sessionId - 고유 세션 ID
   * @param {string} userName - 사용자 이름
   * @param {string} fileHash - 현재 파일 해시
   */
  async start(sessionId, userName, fileHash) {
    if (this.isRunning) {
      await this.stop();
    }

    try {
      this.sessionId = sessionId;
      this.userName = userName;
      this.currentFileHash = fileHash;

      // 로컬 IP 가져오기
      const ipResult = await window.electronAPI.getLocalIP();
      if (ipResult.success) {
        this.localIP = ipResult.ip;
      }

      // 메인 프로세스의 P2P 서비스 시작
      const result = await window.electronAPI.p2pStart({
        sessionId,
        userName,
        fileHash,
        localIP: this.localIP
      });

      if (!result.success) {
        throw new Error(result.error || 'P2P 서비스 시작 실패');
      }

      this.isRunning = true;
      log.info('LAN Discovery 시작됨', {
        sessionId,
        userName,
        fileHash: fileHash?.substring(0, 8),
        ip: this.localIP
      });

      this._emit('started');
      return { success: true };

    } catch (error) {
      log.error('LAN Discovery 시작 실패', { error: error.message });
      this._emit('error', { error });
      return { success: false, error: error.message };
    }
  }

  /**
   * 현재 파일 해시 업데이트 (다른 파일 열 때)
   * @param {string} fileHash - 새 파일 해시
   */
  async updateCurrentFile(fileHash) {
    if (!this.isRunning) return;

    this.currentFileHash = fileHash;

    // 메인 프로세스에 알림
    await window.electronAPI.p2pUpdateFileHash(fileHash);

    // 로컬 피어 목록도 필터링
    for (const [peerId, peer] of this.peers) {
      if (peer.fileHash !== fileHash) {
        this.peers.delete(peerId);
        this._emit('peer:lost', peer);
      }
    }

    this._emit('peers:changed', { peers: this.getPeers() });
    log.info('파일 해시 업데이트됨', { fileHash: fileHash?.substring(0, 8) });
  }

  /**
   * 시그널 전송 (WebRTC 연결용)
   * @param {string} peerId - 대상 피어 ID
   * @param {Object} signal - 시그널 데이터
   */
  async sendSignal(peerId, signal) {
    if (!this.isRunning) {
      return { success: false, error: 'Not running' };
    }

    return await window.electronAPI.p2pSendSignal(peerId, signal);
  }

  /**
   * 발견된 피어 목록 반환
   * @returns {Array<Object>}
   */
  getPeers() {
    return Array.from(this.peers.values());
  }

  /**
   * 특정 피어 정보 가져오기
   * @param {string} peerId - 피어 ID
   * @returns {Object|undefined}
   */
  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  /**
   * 현재 상태 조회
   * @returns {Promise<Object>}
   */
  async getStatus() {
    return await window.electronAPI.p2pGetStatus();
  }

  /**
   * LAN Discovery 중지
   */
  async stop() {
    if (!this.isRunning) return;

    try {
      await window.electronAPI.p2pStop();
    } catch (error) {
      log.warn('P2P 서비스 중지 실패', { error: error.message });
    }

    this.isRunning = false;
    this.peers.clear();

    log.info('LAN Discovery 중지됨');
    this._emit('stopped');
  }

  /**
   * 파일 경로에서 해시 생성
   * @param {string} filePath - 파일 경로
   * @returns {string}
   */
  static createFileHash(filePath) {
    if (!filePath) return '';

    // 경로 정규화 (대소문자, 슬래시 통일)
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');

    // 간단한 해시 함수 (브라우저에서 사용 가능)
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit 정수로 변환
    }

    // 16진수 문자열로 변환하고 양수로 만듦
    return Math.abs(hash).toString(16).padStart(FILE_HASH_LENGTH, '0');
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
export const lanDiscovery = new LANDiscovery();
