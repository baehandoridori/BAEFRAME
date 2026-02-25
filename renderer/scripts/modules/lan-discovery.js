/**
 * BAEFRAME - LAN Discovery (Renderer) - STUB
 *
 * 기존 mDNS 기반 피어 발견이 session.json + WebSocket으로 교체됨.
 * collaboration-manager.js의 기존 import 호환성을 위해 Stub 유지.
 * 실제 피어 발견은 session.json IP Drop 방식으로 ws-client.js에서 담당.
 *
 * @version 2.0 - WebSocket 리팩토링
 */

import { createLogger } from '../logger.js';

const log = createLogger('LANDiscovery');

/**
 * LAN Discovery Stub
 * 기존 import 호환성을 위해 인터페이스만 유지
 */
export class LANDiscovery extends EventTarget {
  constructor() {
    super();
    this.isRunning = false;
    log.info('LANDiscovery Stub 초기화됨 (mDNS 제거됨, session.json 기반으로 대체)');
  }

  /**
   * 파일 경로에서 해시 생성 (여전히 사용됨)
   */
  static createFileHash(filePath) {
    if (!filePath) return '';
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(16, '0');
  }

  async start() {
    log.info('LANDiscovery.start() - Stub (no-op)');
  }

  async stop() {
    log.info('LANDiscovery.stop() - Stub (no-op)');
  }

  getPeers() {
    return [];
  }

  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

export const lanDiscovery = new LANDiscovery();
