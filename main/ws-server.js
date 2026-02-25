/**
 * BAEFRAME - WebSocket Server (Main Process)
 * Host 역할을 맡은 Electron 앱의 Main Process에서 WebSocket 서버를 구동
 *
 * 기능:
 * - ws 패키지로 WebSocket 서버 구동 (포트 12345)
 * - 클라이언트 연결 관리 (Map<sessionId, WebSocket>)
 * - 메시지 릴레이 (순수 브로드캐스트, 비즈니스 로직은 Renderer에서 처리)
 * - 참가자 목록 관리
 *
 * @version 1.0
 */

const WebSocket = require('ws');
const os = require('os');
const { EventEmitter } = require('events');
const { createLogger } = require('./logger');

const log = createLogger('WSServer');

// 상수
const DEFAULT_PORT = 12345;
const MAX_PORT_ATTEMPTS = 6; // 12345 ~ 12350
const HEARTBEAT_INTERVAL = 15000; // 15초

/**
 * WebSocket 서버 클래스
 */
class WSServer extends EventEmitter {
  constructor() {
    super();

    this.wss = null;           // WebSocket.Server 인스턴스
    this.clients = new Map();  // sessionId -> { ws, name, color, joinedAt }
    this.port = DEFAULT_PORT;
    this.localIP = null;
    this.isRunning = false;
    this._heartbeatTimer = null;
  }

  /**
   * WebSocket 서버 시작
   * @param {number} port - 포트 번호 (기본 12345)
   * @returns {Promise<{success: boolean, ip: string, port: number}>}
   */
  async start(port = DEFAULT_PORT) {
    if (this.isRunning) {
      await this.stop();
    }

    // 물리 IP 감지
    this.localIP = this._getPhysicalLocalIP();
    if (!this.localIP) {
      log.error('로컬 IP 감지 실패');
      return { success: false, error: '로컬 IP를 감지할 수 없습니다' };
    }

    // 포트 바인딩 시도 (충돌 시 다음 포트)
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
      const tryPort = port + attempt;
      try {
        await this._startOnPort(tryPort);
        this.port = tryPort;
        this.isRunning = true;

        // Heartbeat 시작
        this._startHeartbeat();

        log.info('WebSocket 서버 시작됨', {
          ip: this.localIP,
          port: this.port
        });

        return {
          success: true,
          ip: this.localIP,
          port: this.port
        };
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          log.warn(`포트 ${tryPort} 사용 중, 다음 포트 시도`);
          continue;
        }
        throw error;
      }
    }

    const errorMsg = `포트 ${port}~${port + MAX_PORT_ATTEMPTS - 1} 모두 사용 중`;
    log.error(errorMsg);
    return { success: false, error: errorMsg };
  }

  /**
   * 특정 포트에 서버 시작
   * @private
   */
  _startOnPort(port) {
    return new Promise((resolve, reject) => {
      const wss = new WebSocket.Server({ port });

      wss.on('listening', () => {
        this.wss = wss;
        this._setupServerEvents();
        resolve();
      });

      wss.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 서버 이벤트 핸들러 설정
   * @private
   */
  _setupServerEvents() {
    this.wss.on('connection', (ws, req) => {
      const clientIP = req.socket.remoteAddress;
      log.info('새 WebSocket 연결', { ip: clientIP });

      // 임시 ID (JOIN 메시지 수신 전까지)
      let clientSessionId = null;

      ws.on('message', (rawData) => {
        try {
          const message = JSON.parse(rawData.toString());

          // JOIN 메시지로 클라이언트 등록
          if (message.type === 'JOIN' && !clientSessionId) {
            clientSessionId = message.sessionId;
            this.clients.set(clientSessionId, {
              ws,
              name: message.userName,
              color: message.userColor,
              joinedAt: new Date().toISOString()
            });

            log.info('클라이언트 등록', {
              sessionId: clientSessionId,
              name: message.userName,
              totalClients: this.clients.size
            });

            // Renderer에 클라이언트 참가 알림
            this.emit('client:joined', {
              sessionId: clientSessionId,
              name: message.userName,
              color: message.userColor
            });
          }

          // 모든 메시지를 Renderer로 전달 (비즈니스 로직은 Renderer에서 처리)
          this.emit('message', {
            sessionId: clientSessionId,
            message
          });

        } catch (error) {
          log.warn('메시지 파싱 실패', { error: error.message });
        }
      });

      ws.on('close', (code, reason) => {
        if (clientSessionId) {
          const client = this.clients.get(clientSessionId);
          this.clients.delete(clientSessionId);

          log.info('클라이언트 연결 해제', {
            sessionId: clientSessionId,
            name: client?.name,
            code,
            reason: reason?.toString()
          });

          // Renderer에 클라이언트 이탈 알림
          this.emit('client:left', {
            sessionId: clientSessionId,
            name: client?.name
          });
        }
      });

      ws.on('error', (error) => {
        log.warn('클라이언트 WebSocket 오류', {
          sessionId: clientSessionId,
          error: error.message
        });
      });

      // ping/pong으로 연결 상태 확인
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });
    });
  }

  /**
   * 전체 브로드캐스트
   * @param {Object|string} message - 전송할 메시지
   * @param {string} excludeSessionId - 제외할 세션 ID
   */
  broadcast(message, excludeSessionId = null) {
    if (!this.isRunning) return;

    const data = typeof message === 'string' ? message : JSON.stringify(message);

    let sentCount = 0;
    for (const [sessionId, client] of this.clients) {
      if (sessionId === excludeSessionId) continue;
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(data);
          sentCount++;
        } catch (error) {
          log.warn('메시지 전송 실패', { sessionId, error: error.message });
        }
      }
    }

    return sentCount;
  }

  /**
   * 특정 클라이언트에 메시지 전송
   * @param {string} sessionId - 대상 세션 ID
   * @param {Object|string} message - 전송할 메시지
   */
  sendTo(sessionId, message) {
    const client = this.clients.get(sessionId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;

    const data = typeof message === 'string' ? message : JSON.stringify(message);
    try {
      client.ws.send(data);
      return true;
    } catch (error) {
      log.warn('메시지 전송 실패', { sessionId, error: error.message });
      return false;
    }
  }

  /**
   * 참가자 목록 반환
   * @returns {Array<{sessionId: string, name: string, color: string, joinedAt: string}>}
   */
  getParticipants() {
    const participants = [];
    for (const [sessionId, client] of this.clients) {
      participants.push({
        sessionId,
        name: client.name,
        color: client.color,
        joinedAt: client.joinedAt
      });
    }
    return participants;
  }

  /**
   * Heartbeat 시작 (연결 상태 확인)
   * @private
   */
  _startHeartbeat() {
    this._heartbeatTimer = setInterval(() => {
      if (!this.wss) return;

      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) {
          ws.terminate();
          return;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 서버 종료
   * @returns {Promise<{success: boolean}>}
   */
  async stop() {
    // Heartbeat 정지
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    // 모든 클라이언트 연결 종료
    for (const [, client] of this.clients) {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch (e) { /* ignore */ }
    }
    this.clients.clear();

    // 서버 종료
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss.close(() => {
          this.wss = null;
          this.isRunning = false;
          log.info('WebSocket 서버 종료됨');
          resolve({ success: true });
        });
      });
    }

    this.isRunning = false;
    return { success: true };
  }

  /**
   * 물리 네트워크 어댑터의 로컬 IP 감지
   * 가상 어댑터(VMware, VirtualBox, Docker, WSL, Hyper-V)를 필터링
   * @private
   * @returns {string|null}
   */
  _getPhysicalLocalIP() {
    const interfaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(interfaces)) {
      // 가상 어댑터 필터링
      if (/virtual|vmware|vbox|docker|wsl|hyper-v|vEthernet/i.test(name)) continue;
      // Loopback 필터링
      if (/loopback|lo$/i.test(name)) continue;

      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }

    // 필터링 실패 시 첫 번째 IPv4 반환
    for (const addrs of Object.values(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          return addr.address;
        }
      }
    }

    return null;
  }
}

// 싱글톤 인스턴스
const wsServer = new WSServer();

module.exports = { wsServer, WSServer };
