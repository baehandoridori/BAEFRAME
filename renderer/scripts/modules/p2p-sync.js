/**
 * BAEFRAME - P2P Sync (Renderer) - STUB
 *
 * 기존 WebRTC DataChannel 기반 P2P 동기화가 WebSocket으로 교체됨.
 * collaboration-manager.js의 기존 import 호환성을 위해 Stub 유지.
 * 실제 메시지 송수신은 ws-client.js에서 담당.
 *
 * @version 2.0 - WebSocket 리팩토링
 */

import { createLogger } from '../logger.js';

const log = createLogger('P2PSync');

/**
 * P2P Sync Stub
 * 기존 import 호환성을 위해 인터페이스만 유지
 */
export class P2PSync extends EventTarget {
  constructor() {
    super();
    this.isRunning = false;
    this.connections = new Map();
    log.info('P2PSync Stub 초기화됨 (WebRTC 제거됨, ws-client.js로 대체)');
  }

  async start() {
    log.info('P2PSync.start() - Stub (no-op)');
  }

  async stop() {
    log.info('P2PSync.stop() - Stub (no-op)');
  }

  broadcast() {
    return 0;
  }

  sendTo() {
    return false;
  }

  hasConnectedPeers() {
    return false;
  }

  getConnectedPeers() {
    return [];
  }

  onMessage() {}

  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export const p2pSync = new P2PSync();
