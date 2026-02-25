/**
 * BAEFRAME - WebSocket Client (Renderer)
 * 브라우저 내장 WebSocket API로 Host에 직접 연결
 *
 * IPC를 거치지 않으므로 커서 30fps 메시지의 레이턴시가 최소화됨.
 * Host의 Renderer도 localhost로 자신의 Main Process WS 서버에 연결하여
 * 동일한 코드 패스를 사용.
 *
 * @version 1.0
 */

import { createLogger } from '../logger.js';

const log = createLogger('WSClient');

// 상수
const MAX_RECONNECT_ATTEMPTS = 4;
const RECONNECT_DELAYS = [0, 1000, 2000, 4000, 8000]; // 지수 백오프
const CONNECT_TIMEOUT_MS = 5000; // 연결 타임아웃 (5초)

/**
 * WebSocket Client 클래스
 * 브라우저 내장 WebSocket 사용 (IPC 없음)
 */
export class WSClient extends EventTarget {
  constructor() {
    super();

    this.ws = null;                   // 브라우저 내장 WebSocket
    this.url = null;                  // 연결 URL (ws://ip:port)
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    this._reconnectTimer = null;
    this._shouldReconnect = true;     // 의도적 disconnect 시 false
  }

  /**
   * WebSocket 연결
   * @param {string} url - 연결 URL (예: ws://192.168.1.100:12345)
   * @returns {Promise<boolean>} 연결 성공 여부
   */
  connect(url) {
    return new Promise((resolve) => {
      if (this.ws) {
        this.disconnect();
      }

      this.url = url;
      this._shouldReconnect = true;
      this.reconnectAttempts = 0;
      let settled = false;

      log.info('WebSocket 연결 시도', { url });

      try {
        this.ws = new WebSocket(url);
      } catch (error) {
        log.error('WebSocket 생성 실패', { error: error.message });
        resolve(false);
        return;
      }

      // 연결 타임아웃 (공인 IP 등 NAT 문제로 TCP SYN이 멈추는 경우 방지)
      const connectTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          log.warn('WebSocket 연결 타임아웃', { url, timeout: CONNECT_TIMEOUT_MS });
          try {
            if (this.ws) {
              this.ws.close();
              this.ws = null;
            }
          } catch (e) { /* ignore */ }
          this.isConnected = false;
          resolve(false);
        }
      }, CONNECT_TIMEOUT_MS);

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);

        this.isConnected = true;
        this.reconnectAttempts = 0;
        log.info('WebSocket 연결 성공', { url });

        this._emit('open', {});
        resolve(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this._emit('message', message);
        } catch (error) {
          log.warn('메시지 파싱 실패', { error: error.message });
        }
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this.ws = null;

        log.info('WebSocket 연결 종료', {
          code: event.code,
          reason: event.reason,
          wasConnected
        });

        this._emit('close', {
          code: event.code,
          reason: event.reason,
          wasConnected
        });

        // 의도적 종료가 아니면 재접속 시도
        if (this._shouldReconnect && wasConnected) {
          this._scheduleReconnect();
        }

        // 첫 연결 시도 실패
        if (!wasConnected && !settled) {
          settled = true;
          clearTimeout(connectTimer);
          resolve(false);
        }
      };

      this.ws.onerror = (error) => {
        log.warn('WebSocket 오류', { url });
        this._emit('error', { error });
      };
    });
  }

  /**
   * 메시지 전송
   * @param {Object} message - 전송할 메시지 (JSON 직렬화됨)
   * @returns {boolean} 전송 성공 여부
   */
  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      log.warn('메시지 전송 실패', { error: error.message });
      return false;
    }
  }

  /**
   * 연결 종료 (의도적)
   */
  disconnect() {
    this._shouldReconnect = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch (e) { /* ignore */ }
      this.ws = null;
    }

    this.isConnected = false;
    log.info('WebSocket 연결 해제 (의도적)');
  }

  /**
   * 자동 재접속 (지수 백오프: 0s → 1s → 2s → 4s → 8s)
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log.warn('재접속 최대 시도 횟수 초과', {
        attempts: this.reconnectAttempts
      });
      this._emit('reconnectFailed', {
        attempts: this.reconnectAttempts
      });
      return;
    }

    const delay = RECONNECT_DELAYS[this.reconnectAttempts + 1] || 8000;
    this.reconnectAttempts++;

    log.info('재접속 예약', {
      attempt: this.reconnectAttempts,
      delay
    });

    this._emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay
    });

    this._reconnectTimer = setTimeout(async () => {
      if (!this._shouldReconnect) return;

      log.info('재접속 시도', { attempt: this.reconnectAttempts, url: this.url });
      const connected = await this.connect(this.url);

      if (!connected && this._shouldReconnect) {
        // connect() 내부의 onclose에서 다시 _scheduleReconnect 호출됨
        // 하지만 wasConnected가 false라서 호출 안 됨 → 여기서 수동 호출
        this._scheduleReconnect();
      }
    }, delay);
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
export const wsClient = new WSClient();
