/**
 * BAEFRAME - P2P Service (Main Process)
 * mDNS 피어 발견 및 시그널링 서버
 *
 * 렌더러에서 nodeIntegration이 비활성화되어 있으므로
 * bonjour-service는 메인 프로세스에서 실행하고 IPC로 통신
 */

const { Bonjour } = require('bonjour-service');
const http = require('http');
const { EventEmitter } = require('events');
const { createLogger } = require('./logger');

const log = createLogger('P2PService');

// 상수
const SERVICE_TYPE = 'baeframe';
const SERVICE_PORT = 45678;
const SIGNALING_PORT = 45679;

/**
 * P2P 서비스 클래스
 */
class P2PService extends EventEmitter {
  constructor() {
    super();
    this.bonjour = null;
    this.service = null;
    this.browser = null;
    this.signalingServer = null;
    this.peers = new Map(); // peerId -> peerInfo
    this.sessionId = null;
    this.userName = null;
    this.currentFileHash = null;
    this.localIP = null;
    this.isRunning = false;
  }

  /**
   * 서비스 시작
   * @param {Object} options - 시작 옵션
   * @param {string} options.sessionId - 세션 ID
   * @param {string} options.userName - 사용자 이름
   * @param {string} options.fileHash - 현재 파일 해시
   * @param {string} options.localIP - 로컬 IP
   */
  async start(options) {
    if (this.isRunning) {
      await this.stop();
    }

    try {
      this.sessionId = options.sessionId;
      this.userName = options.userName;
      this.currentFileHash = options.fileHash;
      this.localIP = options.localIP;

      // Bonjour 인스턴스 생성
      this.bonjour = new Bonjour();

      // mDNS 서비스 등록
      await this._advertise();

      // 피어 검색 시작
      this._startDiscovery();

      // 시그널링 서버 시작
      await this._startSignalingServer();

      this.isRunning = true;
      log.info('P2P 서비스 시작됨', {
        sessionId: this.sessionId,
        userName: this.userName,
        fileHash: this.currentFileHash
      });

      return { success: true };
    } catch (error) {
      log.error('P2P 서비스 시작 실패', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * mDNS 서비스 등록
   */
  async _advertise() {
    return new Promise((resolve, reject) => {
      try {
        this.service = this.bonjour.publish({
          name: `baeframe-${this.sessionId.substring(0, 8)}`,
          type: SERVICE_TYPE,
          port: SIGNALING_PORT,
          txt: {
            sessionId: this.sessionId,
            userName: this.userName,
            fileHash: this.currentFileHash || '',
            ip: this.localIP || '',
            version: '1.0'
          }
        });

        this.service.on('up', () => {
          log.info('mDNS 서비스 등록 완료');
          resolve();
        });

        this.service.on('error', (err) => {
          log.warn('mDNS 서비스 등록 실패', { error: err.message });
          // 등록 실패해도 계속 진행 (검색만 가능)
          resolve();
        });

        // 타임아웃 (5초)
        setTimeout(() => resolve(), 5000);
      } catch (error) {
        log.warn('mDNS 서비스 등록 예외', { error: error.message });
        resolve(); // 실패해도 계속 진행
      }
    });
  }

  /**
   * 피어 검색 시작
   */
  _startDiscovery() {
    try {
      this.browser = this.bonjour.find({ type: SERVICE_TYPE });

      this.browser.on('up', (service) => {
        // mDNS로 발견된 모든 서비스 로깅
        const peerId = service.txt?.sessionId;
        log.info('mDNS 서비스 발견', {
          name: service.name,
          host: service.host,
          peerId: peerId || '(없음)',
          isSelf: peerId === this.sessionId
        });

        // 자기 자신은 제외
        if (!peerId || peerId === this.sessionId) {
          return;
        }

        const peer = {
          id: peerId,
          name: service.txt?.userName || '알 수 없음',
          fileHash: service.txt?.fileHash || '',
          ip: service.txt?.ip || service.referer?.address,
          port: service.port,
          host: service.host,
          discoveredAt: new Date().toISOString()
        };

        // 같은 파일을 열고 있는 피어만 저장
        if (peer.fileHash && peer.fileHash === this.currentFileHash) {
          const isNew = !this.peers.has(peer.id);
          this.peers.set(peer.id, peer);

          if (isNew) {
            log.info('피어 발견 (같은 파일)', { peer: peer.name, ip: peer.ip });
            this.emit('peer:found', peer);
          }
        } else {
          // 디버깅을 위해 info 레벨로 출력
          log.info('피어 발견 (다른 파일 - 무시됨)', {
            peer: peer.name,
            theirFile: peer.fileHash,
            myFile: this.currentFileHash
          });
        }
      });

      this.browser.on('down', (service) => {
        const peerId = service.txt?.sessionId;
        if (peerId && this.peers.has(peerId)) {
          const peer = this.peers.get(peerId);
          this.peers.delete(peerId);
          log.info('피어 오프라인', { peer: peer.name });
          this.emit('peer:lost', peer);
        }
      });

      log.info('피어 검색 시작됨');
    } catch (error) {
      log.error('피어 검색 시작 실패', { error: error.message });
    }
  }

  /**
   * 시그널링 서버 시작 (WebRTC 연결용)
   */
  async _startSignalingServer() {
    return new Promise((resolve, reject) => {
      try {
        this.signalingServer = http.createServer((req, res) => {
          // CORS 허용
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          if (req.method === 'POST' && req.url === '/signal') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                const signal = JSON.parse(body);
                log.debug('시그널 수신', { from: signal.from, type: signal.type });
                this.emit('signal', signal);
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
              } catch (error) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
              }
            });
          } else {
            res.writeHead(404);
            res.end();
          }
        });

        this.signalingServer.listen(SIGNALING_PORT, () => {
          log.info('시그널링 서버 시작됨', { port: SIGNALING_PORT });
          resolve();
        });

        this.signalingServer.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            log.warn('시그널링 포트 사용 중, 다른 포트 시도');
            // 포트 충돌 시 랜덤 포트 사용
            this.signalingServer.listen(0, () => {
              log.info('시그널링 서버 시작됨 (대체 포트)', {
                port: this.signalingServer.address().port
              });
              resolve();
            });
          } else {
            log.error('시그널링 서버 오류', { error: err.message });
            resolve(); // 실패해도 계속 진행
          }
        });
      } catch (error) {
        log.error('시그널링 서버 시작 예외', { error: error.message });
        resolve(); // 실패해도 계속 진행
      }
    });
  }

  /**
   * 시그널 전송 (다른 피어에게)
   * @param {string} peerId - 대상 피어 ID
   * @param {Object} signal - 시그널 데이터
   */
  async sendSignal(peerId, signal) {
    const peer = this.peers.get(peerId);
    if (!peer || !peer.ip) {
      return { success: false, error: 'Peer not found' };
    }

    try {
      const response = await this._httpPost(
        `http://${peer.ip}:${peer.port || SIGNALING_PORT}/signal`,
        {
          from: this.sessionId,
          fromName: this.userName,
          ...signal
        }
      );
      return { success: true, response };
    } catch (error) {
      log.warn('시그널 전송 실패', { peer: peer.name, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * HTTP POST 요청
   */
  async _httpPost(url, data) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const body = JSON.stringify(data);

      const req = http.request({
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 5000
      }, (res) => {
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(responseBody);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * 현재 파일 해시 업데이트
   */
  updateFileHash(fileHash) {
    this.currentFileHash = fileHash;

    // 서비스 재등록 (TXT 레코드 업데이트)
    if (this.service && this.isRunning) {
      this.service.stop();
      this._advertise();
    }

    // 기존 피어 목록 필터링 (다른 파일 피어 제거)
    for (const [peerId, peer] of this.peers) {
      if (peer.fileHash !== fileHash) {
        this.peers.delete(peerId);
        this.emit('peer:lost', peer);
      }
    }

    log.info('파일 해시 업데이트됨', { fileHash: fileHash?.substring(0, 8) });
  }

  /**
   * 현재 발견된 피어 목록
   */
  getPeers() {
    return Array.from(this.peers.values());
  }

  /**
   * 서비스 중지
   */
  async stop() {
    this.isRunning = false;

    if (this.service) {
      try {
        this.service.stop();
      } catch (e) { /* ignore */ }
      this.service = null;
    }

    if (this.browser) {
      try {
        this.browser.stop();
      } catch (e) { /* ignore */ }
      this.browser = null;
    }

    if (this.bonjour) {
      try {
        this.bonjour.destroy();
      } catch (e) { /* ignore */ }
      this.bonjour = null;
    }

    if (this.signalingServer) {
      try {
        this.signalingServer.close();
      } catch (e) { /* ignore */ }
      this.signalingServer = null;
    }

    this.peers.clear();
    log.info('P2P 서비스 중지됨');

    return { success: true };
  }

  /**
   * 현재 상태 반환
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      sessionId: this.sessionId,
      userName: this.userName,
      fileHash: this.currentFileHash,
      peerCount: this.peers.size,
      peers: this.getPeers(),
      signalingPort: this.signalingServer?.address()?.port || SIGNALING_PORT
    };
  }
}

// 싱글톤 인스턴스
const p2pService = new P2PService();

module.exports = { p2pService, P2PService };
