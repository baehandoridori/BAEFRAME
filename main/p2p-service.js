/**
 * BAEFRAME - P2P Service (Main Process) - STUB
 *
 * 기존 mDNS/Bonjour/UDP 기반 P2P 서비스가 WebSocket으로 교체됨.
 * ipc-handlers.js의 기존 require 호환성을 위해 Stub 유지.
 * 실제 구현은 main/ws-server.js에서 담당.
 *
 * @version 2.0 - WebSocket 리팩토링
 */

const { EventEmitter } = require('events');
const { createLogger } = require('./logger');

const log = createLogger('P2PService');

/**
 * P2P 서비스 Stub
 * 기존 IPC 핸들러와의 호환성을 위해 인터페이스만 유지
 */
class P2PService extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    log.info('P2PService Stub 초기화됨 (mDNS/WebRTC 제거됨, ws-server.js로 대체)');
  }

  async start() {
    log.info('P2PService.start() - Stub (no-op)');
    return { success: true };
  }

  async stop() {
    log.info('P2PService.stop() - Stub (no-op)');
    return { success: true };
  }

  getStatus() {
    return { isRunning: false, peerCount: 0, peers: [] };
  }

  getPeers() {
    return [];
  }

  updateFileHash() {}

  async sendSignal() {
    return { success: true };
  }
}

const p2pService = new P2PService();

module.exports = { p2pService, P2PService };
