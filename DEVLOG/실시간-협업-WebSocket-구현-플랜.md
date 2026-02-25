# 실시간 협업 WebSocket 리팩토링 - 구현 플랜

> 기존 DEVLOG 계획서를 기반으로 한 코드 레벨 구현 상세

---

## 구현 순서 및 Phase별 상세

### Phase 0: 기존 mDNS/WebRTC 코드 제거

**목표:** 새 WebSocket 아키텍처와 충돌하는 기존 P2P 코드 정리

#### 0-1. `main/p2p-service.js` → Stub으로 교체

**현재:** Bonjour(mDNS) + HTTP 시그널링 서버 + UDP 브로드캐스트 (250줄+)
**변경:** export 구조만 유지, 내부 구현 비움

```javascript
// main/p2p-service.js - Stub (Phase 1에서 ws-server.js로 대체)
const { EventEmitter } = require('events');

class P2PService extends EventEmitter {
  async start() { return { success: true }; }
  async stop() { return { success: true }; }
  getStatus() { return { isRunning: false }; }
  getPeers() { return []; }
  updateFileHash() {}
  async sendSignal() { return { success: true }; }
}

const p2pService = new P2PService();
module.exports = { p2pService, P2PService };
```

**이유:** `ipc-handlers.js`에서 `require('./p2p-service')`하므로 export 형태 유지 필요

#### 0-2. `renderer/scripts/modules/lan-discovery.js` → Stub

**현재:** mDNS 피어 발견 (LANDiscovery 클래스)
**변경:** export 구조만 유지, EventTarget 빈 구현

```javascript
// Stub - Phase 1에서 session.json 기반으로 대체
export class LANDiscovery extends EventTarget {
  static createFileHash() { return ''; }
  async start() {}
  async stop() {}
}
export const lanDiscovery = new LANDiscovery();
```

#### 0-3. `renderer/scripts/modules/p2p-sync.js` → Stub

**현재:** WebRTC DataChannel P2P 동기화 (P2PSync 클래스)
**변경:** export 구조만 유지

```javascript
// Stub - Phase 1에서 ws-client.js로 대체
export class P2PSync extends EventTarget {
  async start() {}
  async stop() {}
  broadcast() {}
  get isRunning() { return false; }
}
export const p2pSync = new P2PSync();
```

#### 0-4. `collaboration-manager.js` P2P 의존성 제거

**수정 포인트:**
- `import { lanDiscovery, LANDiscovery } from './lan-discovery.js'` → 제거 또는 stub import 유지
- `import { p2pSync } from './p2p-sync.js'` → 제거 또는 stub import 유지
- `_startP2P()` 메서드 → 비움 (Phase 1에서 `_startWebSocket()`으로 교체)
- `_setupP2PEvents()` → 비움
- `_stopP2P()` → 비움
- `.collab` 파일 관련 코드 (`_updatePresence`, `_readCollabFile`, `_writeCollabFile`) → 비움

#### 0-5. `package.json` 의존성 변경

```diff
- "bonjour-service": "^1.3.0",
+ "ws": "^8.16.0",
```

#### 0-6. `ipc-handlers.js` P2P 핸들러 비활성화

기존 P2P 핸들러는 stub의 no-op 메서드를 호출하므로 에러 없이 동작. 추가 작업 불필요.

**Phase 0 완료 기준:** `npm run dev`로 앱 정상 실행, 협업 기능은 비활성 상태

---

### Phase 1: WebSocket 서버 + session.json IP Drop + Client 연결

**목표:** Host-Client WebSocket 연결 확립

#### 1-1. 신규 파일: `main/ws-server.js`

**역할:** Electron Main Process에서 WebSocket 서버 구동

```javascript
// main/ws-server.js
const WebSocket = require('ws');
const os = require('os');
const { createLogger } = require('./logger');

class WSServer {
  constructor() {
    this.wss = null;           // WebSocket.Server
    this.clients = new Map();  // sessionId -> { ws, name, color, joinedAt }
    this.port = 12345;
    this.localIP = null;
    this.isRunning = false;
    this.onMessage = null;     // 외부 메시지 핸들러
  }

  // WebSocket 서버 시작
  async start(port = 12345) { ... }

  // 서버 종료
  async stop() { ... }

  // 전체 브로드캐스트 (excludeSessionId로 발신자 제외)
  broadcast(message, excludeSessionId = null) { ... }

  // 특정 클라이언트에 메시지 전송
  sendTo(sessionId, message) { ... }

  // 물리 IP 감지 (가상 어댑터 필터링)
  _getPhysicalLocalIP() { ... }

  // 참가자 목록 반환
  getParticipants() { ... }
}
```

**핵심 구현 사항:**
- `ws.on('connection')` → JOIN 메시지 대기 → clients Map에 등록
- `ws.on('message')` → JSON 파싱 → `this.onMessage(sessionId, parsedMessage)` 호출
- `ws.on('close')` → clients Map에서 제거 → PEER_LEFT 브로드캐스트
- 포트 충돌 시 12345 → 12346 → ... 12350까지 시도

#### 1-2. IPC 핸들러 추가 (`main/ipc-handlers.js`)

기존 P2P 핸들러를 WebSocket 핸들러로 교체:

```javascript
// ====== WebSocket 서버 관련 ======
const { wsServer } = require('./ws-server');

ipcMain.handle('ws:start-server', async (event, port) => {
  const result = await wsServer.start(port);
  return result; // { success, ip, port }
});

ipcMain.handle('ws:stop-server', async () => {
  return await wsServer.stop();
});

ipcMain.handle('ws:broadcast', async (event, message, excludeSessionId) => {
  wsServer.broadcast(message, excludeSessionId);
  return { success: true };
});

ipcMain.handle('ws:send-to', async (event, sessionId, message) => {
  wsServer.sendTo(sessionId, message);
  return { success: true };
});

ipcMain.handle('ws:get-participants', async () => {
  return wsServer.getParticipants();
});

// session.json 파일 I/O
ipcMain.handle('ws:write-session', async (event, filePath, data) => {
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { success: true };
});

ipcMain.handle('ws:read-session', async (event, filePath) => {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(content);
});

ipcMain.handle('ws:delete-session', async (event, filePath) => {
  await fs.promises.unlink(filePath);
  return { success: true };
});
```

**WebSocket 서버 → Renderer 이벤트 전달:**
```javascript
wsServer.onMessage = (sessionId, message) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('ws:message', { sessionId, message });
  }
};

wsServer.onClientJoined = (sessionId, clientInfo) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('ws:client-joined', { sessionId, ...clientInfo });
  }
};

wsServer.onClientLeft = (sessionId) => {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('ws:client-left', { sessionId });
  }
};
```

#### 1-3. Preload API 추가 (`preload/preload.js`)

```javascript
// ====== WebSocket 서버 관련 (Host용, Main Process) ======
wsStartServer: (port) => ipcRenderer.invoke('ws:start-server', port),
wsStopServer: () => ipcRenderer.invoke('ws:stop-server'),
wsBroadcast: (message, excludeSessionId) =>
  ipcRenderer.invoke('ws:broadcast', message, excludeSessionId),
wsSendTo: (sessionId, message) =>
  ipcRenderer.invoke('ws:send-to', sessionId, message),
wsGetParticipants: () => ipcRenderer.invoke('ws:get-participants'),

// session.json 파일 I/O
wsWriteSession: (filePath, data) =>
  ipcRenderer.invoke('ws:write-session', filePath, data),
wsReadSession: (filePath) =>
  ipcRenderer.invoke('ws:read-session', filePath),
wsDeleteSession: (filePath) =>
  ipcRenderer.invoke('ws:delete-session', filePath),

// WebSocket 이벤트 리스너
onWsMessage: (callback) => {
  ipcRenderer.on('ws:message', (event, data) => callback(data));
},
onWsClientJoined: (callback) => {
  ipcRenderer.on('ws:client-joined', (event, data) => callback(data));
},
onWsClientLeft: (callback) => {
  ipcRenderer.on('ws:client-left', (event, data) => callback(data));
},
```

#### 1-4. 신규 파일: `renderer/scripts/modules/ws-client.js`

**역할:** Renderer에서 브라우저 내장 WebSocket으로 Host에 직접 연결

```javascript
// renderer/scripts/modules/ws-client.js
export class WSClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;          // 브라우저 내장 WebSocket
    this.url = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 4;
  }

  // WebSocket 연결 (브라우저 내장 API 사용 - IPC 없음)
  connect(url) {
    this.url = url;
    this.ws = new WebSocket(url);  // 브라우저 네이티브!
    this.ws.onopen = () => { ... };
    this.ws.onmessage = (event) => { ... };
    this.ws.onclose = () => { ... };
    this.ws.onerror = (error) => { ... };
  }

  // 메시지 전송
  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  // 연결 종료
  disconnect() { ... }

  // 자동 재접속 (지수 백오프: 0s → 1s → 2s → 4s → 8s)
  _scheduleReconnect() { ... }
}

export const wsClient = new WSClient();
```

**핵심:** Client는 IPC를 거치지 않고 `new WebSocket('ws://192.168.1.100:12345')` 직접 연결

#### 1-5. `collaboration-manager.js` WebSocket 연동

**`start()` 메서드 재작성:**

```
기존 흐름:
  start(bframePath, userName)
    → _updatePresence() (.collab 파일 쓰기)
    → _startP2P() (mDNS + WebRTC)

새 흐름:
  start(bframePath, userName)
    → _determineRole() (session.json 확인 → Host/Client 결정)
    → Host면: _startAsHost() (WS 서버 시작 + session.json 작성)
    → Client면: _startAsClient(hostIp, port) (WS Client 연결)
```

**새 메서드들:**
```javascript
// Host/Client 결정 로직
async _determineRole() {
  const sessionPath = this.bframePath + '.session.json';

  try {
    // 1. session.json 읽기
    const session = await window.electronAPI.wsReadSession(sessionPath);

    // 2. 3분 만료 확인
    const elapsed = Date.now() - new Date(session.createdAt).getTime();
    if (elapsed > 180000) throw new Error('session expired');

    // 3. WebSocket 연결 시도
    return { role: 'client', hostIp: session.hostIp, port: session.port };
  } catch {
    // session.json 없거나 만료 → Host 후보
    return await this._tryBecomeHost(sessionPath);
  }
}

async _tryBecomeHost(sessionPath) {
  // 랜덤 딜레이 (500~2000ms) - Drive 동기화 대기
  await this._sleep(500 + Math.random() * 1500);

  // session.json 재확인
  try {
    const session = await window.electronAPI.wsReadSession(sessionPath);
    return { role: 'client', hostIp: session.hostIp, port: session.port };
  } catch {
    return { role: 'host' };
  }
}

async _startAsHost() {
  // 1. Main Process에서 WS 서버 시작 (IPC)
  const result = await window.electronAPI.wsStartServer(12345);

  // 2. session.json 작성 (IPC)
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
  wsClient.connect(`ws://127.0.0.1:${result.port}`);

  // 4. Main Process WS 서버 메시지 수신 이벤트 설정
  window.electronAPI.onWsMessage(({ sessionId, message }) => {
    this._handleWsMessage(sessionId, message);
  });

  this.role = 'host';
}

async _startAsClient(hostIp, port) {
  // 브라우저 네이티브 WebSocket 직접 연결 (IPC 안 거침!)
  wsClient.connect(`ws://${hostIp}:${port}`);

  wsClient.addEventListener('open', () => {
    wsClient.send({
      type: 'JOIN',
      sessionId: this.sessionId,
      userName: this.userName,
      userColor: this.userColor
    });
  });

  wsClient.addEventListener('message', (e) => {
    this._handleWsMessage(null, e.detail);
  });

  this.role = 'client';
}
```

**Host의 메시지 라우팅 (Main Process `ws-server.js`):**
- JOIN → clients Map에 등록 → WELCOME 응답 → PEER_JOINED 브로드캐스트
- CURSOR_MOVE → 발신자 제외 전체 브로드캐스트
- STATE_CHANGE → 인메모리 상태 업데이트 → STATE_BROADCAST
- LEAVE → clients Map에서 제거 → PEER_LEFT 브로드캐스트

**단, 메시지 라우팅은 어디서?**
- 방법 A: Main Process(ws-server.js)에서 모든 라우팅 → 단순하지만 Main에 비즈니스 로직이 들어감
- 방법 B (채택): Main Process는 순수 relay만. Host의 Renderer가 메시지 핸들링

```
Client A → WS Server(Main) → IPC로 Host Renderer에 전달
Host Renderer가 로직 처리 → IPC로 WS Server에 브로드캐스트 요청
WS Server → 다른 Client들에게 브로드캐스트
```

**하지만!** Host도 wsClient로 localhost에 연결하므로:
```
Client A → WS Server(Main) → Host의 wsClient.onmessage 수신 (브라우저 WebSocket)
Host Renderer가 로직 처리 → wsClient.send(응답) → WS Server → 브로드캐스트
```

**최종 결정: Hybrid 방식**
- WS Server(Main)는 **순수 메시지 릴레이** (broadcast만 담당)
- Host의 Renderer가 비즈니스 로직 처리
- Host Renderer가 `window.electronAPI.wsBroadcast(msg, excludeId)`로 브로드캐스트 요청
- 이렇게 하면 Main Process에 비즈니스 로직이 없고, Renderer에서 모든 것을 처리

**Phase 1 완료 기준:**
- PC1(Host): 앱 실행 → session.json 생성 → WS 서버 구동
- PC2(Client): 같은 파일 오픈 → session.json 읽기 → WS 연결 → JOIN/WELCOME 교환
- 콘솔에서 `collaborationManager.role` 확인 가능

---

### Phase 2: Host Migration (방장 승계)

**목표:** Host 이탈 시 자동으로 새 Host 선출

#### 2-1. 정상 종료 처리

**`collaboration-manager.js`에 추가:**

```javascript
async _shutdownAsHost() {
  // 1. 미저장 데이터 즉시 저장
  await this._reviewDataManager.forceSave();

  // 2. HOST_SHUTDOWN 브로드캐스트
  await window.electronAPI.wsBroadcast({
    type: 'HOST_SHUTDOWN',
    sessionId: this.sessionId
  });

  // 3. session.json 삭제
  await window.electronAPI.wsDeleteSession(this.sessionPath);

  // 4. WS 서버 종료
  await window.electronAPI.wsStopServer();
}
```

**트리거:** `window.addEventListener('beforeunload')` + 파일 전환 시 `setVideoFile()`

#### 2-2. 비정상 종료 감지 + 승계 프로토콜

**Client의 wsClient `onclose` 이벤트:**

```javascript
wsClient.addEventListener('close', async () => {
  // 1. 2초 대기 (일시적 끊김 구분)
  await sleep(2000);

  // 2. 재접속 시도 (2회, 각 1초 간격)
  const reconnected = await this._tryReconnect(2);
  if (reconnected) return;

  // 3. Host 비정상 종료로 판단 → 승계 프로토콜
  await this._startElection();
});

async _startElection() {
  // 참가자 목록에서 sessionId 정렬
  const sorted = [...this.participants]
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));

  // 가장 작은 sessionId가 나인가?
  if (sorted[0].sessionId === this.sessionId) {
    // 내가 새 Host!
    await this._promoteToHost();
  } else {
    // 다른 사람이 Host → session.json 폴링 (5초간, 1초 간격)
    await this._waitForNewHost();
  }
}

async _promoteToHost() {
  // 1. WS 서버 시작
  const result = await window.electronAPI.wsStartServer(12345);

  // 2. session.json 갱신
  await window.electronAPI.wsWriteSession(this.sessionPath, { ... });

  // 3. 역할 전환
  this.role = 'host';
  this._reviewDataManager.setRole('host');

  // 4. localhost WS 연결
  wsClient.connect(`ws://127.0.0.1:${result.port}`);

  // 5. 토스트 알림
  this._emit('showToast', { type: 'info', message: 'Host로 승격되었습니다' });
}
```

**Phase 2 완료 기준:**
- PC1(Host) 정상 종료 → PC2가 Host 승계, session.json 갱신
- PC1(Host) 작업관리자 강제 종료 → PC2가 5~10초 내 Host 승계

---

### Phase 3: 실시간 동기화 프로토콜

**목표:** 댓글/그리기/하이라이트 변경사항 WebSocket으로 즉시 전파

#### 3-1. `sync-protocol.js` 메시지 타입 재정의

```javascript
export const MessageTypes = {
  // 연결 관리
  JOIN: 'JOIN',
  WELCOME: 'WELCOME',
  PEER_JOINED: 'PEER_JOINED',
  PEER_LEFT: 'PEER_LEFT',
  HOST_SHUTDOWN: 'HOST_SHUTDOWN',
  LEAVE: 'LEAVE',

  // 커서/Presence
  CURSOR_MOVE: 'CM',            // 축약 (30fps 빈번 전송)
  PRESENCE_UPDATE: 'PU',        // 축약

  // 데이터 동기화
  STATE_CHANGE: 'STATE_CHANGE',
  STATE_BROADCAST: 'STATE_BROADCAST',
  FULL_STATE_SYNC: 'FULL_STATE_SYNC',

  // 편집 잠금
  EDIT_LOCK: 'EDIT_LOCK',
  EDIT_UNLOCK: 'EDIT_UNLOCK',
  EDIT_LOCK_STATE: 'EDIT_LOCK_STATE',

  // Host Migration
  HOST_ELECTION: 'HOST_ELECTION',
  REDIRECT: 'REDIRECT',
  MERGE_REQUEST: 'MERGE_REQUEST'
};
```

#### 3-2. `collaboration-manager.js` 메시지 핸들러

```javascript
_handleWsMessage(senderSessionId, message) {
  switch (message.type || message.t) {
    case 'JOIN':
      if (this.role === 'host') this._handleJoin(senderSessionId, message);
      break;
    case 'WELCOME':
      this._handleWelcome(message);
      break;
    case 'PEER_JOINED':
      this._handlePeerJoined(message);
      break;
    case 'PEER_LEFT':
      this._handlePeerLeft(message);
      break;
    case 'STATE_CHANGE':
      if (this.role === 'host') this._handleStateChange(senderSessionId, message);
      break;
    case 'STATE_BROADCAST':
      this._applyRemoteChange(message);
      break;
    case 'CM': // CURSOR_MOVE
      this._handleCursorMove(message);
      break;
    case 'PU': // PRESENCE_UPDATE
      this._handlePresenceUpdate(message);
      break;
    // ... 기타
  }
}
```

#### 3-3. 데이터 변경 → WebSocket 전송 연동

**`collaboration-manager.js`에서 기존 `syncChange()` 재작성:**

```javascript
// 기존: p2pSync.broadcast(message)
// 변경: wsClient.send(STATE_CHANGE)

syncChange(changeType, data) {
  if (this.role === 'host') {
    // Host는 직접 인메모리 반영 + 브로드캐스트
    window.electronAPI.wsBroadcast({
      type: 'STATE_BROADCAST',
      changeType,
      data,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString()
    }, this.sessionId);
  } else {
    // Client는 Host에게 전송
    wsClient.send({
      type: 'STATE_CHANGE',
      changeType,
      data,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString()
    });
  }
}
```

**Host의 STATE_CHANGE 처리:**
```javascript
_handleStateChange(senderSessionId, message) {
  // 1. 인메모리 상태 업데이트 (commentManager, drawingManager)
  this._applyChange(message.changeType, message.data);

  // 2. 발신자 제외 전체 브로드캐스트
  window.electronAPI.wsBroadcast({
    type: 'STATE_BROADCAST',
    ...message
  }, senderSessionId);

  // 3. isDirty → Debounce 타이머 리셋
  this._reviewDataManager.markDirty();
}
```

**Phase 3 완료 기준:**
- PC1에서 댓글 추가 → PC2에 즉시 표시 (< 100ms)
- PC2에서 그리기 → PC1에 즉시 표시

---

### Phase 4: 저장 전략 (Host-Only Write + Debounce)

**목표:** Host만 .bframe 파일에 쓰고, Debounce로 저장 빈도 조절

#### 4-1. `review-data-manager.js` 역할 기반 저장

**추가할 속성/메서드:**
```javascript
constructor(options) {
  // ... 기존 코드
  this.role = 'solo';  // 'host' | 'client' | 'solo'
  this.maxSaveInterval = 30000;  // 30초 최대 저장 간격
  this._maxSaveTimer = null;
  this._lastSavedAt = Date.now();
}

setRole(role) {
  this.role = role;
  if (role === 'host') {
    this.autoSaveDelay = 3000;  // Host: 3초 debounce
    this._startMaxSaveInterval();
  } else if (role === 'client') {
    this.autoSaveDelay = 500;  // 유지하되, 실제 저장은 안 함
    this._cancelAutoSave();
    this._stopMaxSaveInterval();
  } else {
    this.autoSaveDelay = 500;  // Solo: 기존과 동일
    this._stopMaxSaveInterval();
  }
}

// 강제 저장 (Debounce 무시)
async forceSave() {
  this._cancelAutoSave();
  return await this.save({ skipMerge: true });
}

// 30초 최대 저장 간격
_startMaxSaveInterval() {
  this._maxSaveTimer = setInterval(() => {
    if (this.isDirty) {
      this.forceSave();
    }
  }, this.maxSaveInterval);
}
```

**`_onDataChanged()` 수정:**
```javascript
_onDataChanged(event) {
  if (this.isLoading) return;
  this.isDirty = true;

  if (this.role === 'client') {
    // Client는 디스크 저장 안 함 → WebSocket으로 변경 전파만
    // (collaboration-manager가 이벤트 감지하여 syncChange 호출)
    return;
  }

  // Host 또는 Solo → 기존 debounce 저장
  this._scheduleAutoSave();
}
```

**Phase 4 완료 기준:**
- Host에서만 .bframe 파일 쓰기 발생
- Client에서 변경 시 Host로 전송 → Host가 debounce 후 저장
- Ctrl+S → forceSave() 즉시 실행

---

### Phase 5: 실시간 커서 + Presence UI

**목표:** Figma 스타일 다중 커서 오버레이 + 상단 접속자 표시

#### 5-1. 신규 파일: `renderer/scripts/modules/cursor-overlay.js`

```javascript
export class CursorOverlay {
  constructor(videoWrapper) {
    this.videoWrapper = videoWrapper;  // #videoWrapper DOM
    this.container = null;             // 커서 오버레이 컨테이너
    this.cursors = new Map();          // sessionId → { element, nameLabel }
    this._init();
  }

  _init() {
    // 커서 오버레이 컨테이너 생성
    this.container = document.createElement('div');
    this.container.className = 'cursor-overlay-container';
    this.container.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none; z-index: 5;
    `;
    this.videoWrapper.appendChild(this.container);
  }

  // 커서 위치 업데이트 (normalized 0~1 좌표)
  updateCursor(sessionId, { x, y, name, color }) {
    let cursor = this.cursors.get(sessionId);
    if (!cursor) {
      cursor = this._createCursorElement(sessionId, name, color);
      this.cursors.set(sessionId, cursor);
    }

    // getVideoRenderArea()로 실제 비디오 영역 계산
    const area = this._getVideoRenderArea();
    const pixelX = area.left + x * area.width;
    const pixelY = area.top + y * area.height;

    cursor.element.style.transform = `translate(${pixelX}px, ${pixelY}px)`;
    cursor.lastUpdate = Date.now();
  }

  // 커서 DOM 생성
  _createCursorElement(sessionId, name, color) {
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="${color}">
        <path d="M0 0L16 6L8 8L6 16Z"/>
      </svg>
      <span class="cursor-label" style="background:${color}">${name}</span>
    `;
    this.container.appendChild(el);
    return { element: el, lastUpdate: Date.now() };
  }

  // 커서 제거 (참가자 이탈)
  removeCursor(sessionId) { ... }

  // 전체 정리
  destroy() { ... }
}
```

#### 5-2. CSS 스타일 추가 (`renderer/styles/main.css`)

```css
/* 원격 커서 */
.remote-cursor {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
  transition: transform 0.1s linear;  /* 30fps 보간 */
  will-change: transform;
  z-index: 5;
}

.cursor-label {
  position: absolute;
  left: 18px; top: 2px;
  padding: 2px 6px;
  border-radius: 3px;
  color: white;
  font-size: 11px;
  white-space: nowrap;
  opacity: 0.9;
}

/* 3초 이상 미움직임 → 이름 라벨 투명 */
.remote-cursor.idle .cursor-label {
  opacity: 0;
  transition: opacity 1s ease;
}
```

#### 5-3. 커서 이벤트 송신 (`app.js`)

```javascript
// 비디오 플레이어 위에서 마우스 이동 시
let lastCursorSend = 0;
videoWrapper.addEventListener('mousemove', (e) => {
  const now = Date.now();
  if (now - lastCursorSend < 33) return;  // 30fps throttle
  lastCursorSend = now;

  const area = getVideoRenderArea();
  const x = (e.offsetX - area.left) / area.width;
  const y = (e.offsetY - area.top) / area.height;

  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    collaborationManager.sendCursorMove(x, y);
  }
});
```

#### 5-4. Presence 바 업데이트 (기존 코드 활용)

기존 `updateCollaboratorsUI()` 함수를 WebSocket 이벤트에 연결:
- PEER_JOINED → 아바타 추가
- PEER_LEFT → 아바타 제거
- PRESENCE_UPDATE → 프레임 위치, 재생 상태 갱신

**기존 `#collaboratorsAvatars`, `#collaboratorsCount` DOM 재활용 가능**

**Phase 5 완료 기준:**
- 상대방 마우스 커서가 비디오 위에 부드럽게 표시
- 상단 아바타 바에 접속자 표시
- 3초 이상 미움직임 → 커서 이름 라벨 페이드아웃

---

### Phase 6: 에지케이스 처리

**목표:** 실전에서 발생 가능한 에지케이스 안정적 처리

#### 6-1. Client 재접속 (네트워크 Hiccup)
- `ws-client.js`의 `_scheduleReconnect()` 구현
- 재접속 성공 시 마지막 동기화 시점 이후 변경분 요청

#### 6-2. Split-brain 방지
- Host 모드 시작 후 500ms 후 session.json 재확인
- 다른 IP가 적혀있으면 sessionId 비교 → 작은 쪽이 Host

#### 6-3. session.json 정리
- 앱 종료 시 Host → session.json 삭제
- session.json 3분 만료 → 무시

#### 6-4. 모든 Client 이탈 → Host 혼자
- Solo 모드와 동일하게 동작 (WS 서버는 유지)

**Phase 6 완료 기준:** 각 시나리오별 수동 테스트 통과

---

### Phase 7: 통합 테스트

수동 테스트 체크리스트:

| # | 시나리오 | 통과 |
|---|----------|------|
| 1 | 2PC 기본 연결 (Host + Client) | ⬜ |
| 2 | 2PC 댓글 실시간 동기화 | ⬜ |
| 3 | 2PC 커서 동기화 | ⬜ |
| 4 | 2PC Host 정상 종료 → 승계 | ⬜ |
| 5 | 2PC Host 강제 종료 → 승계 | ⬜ |
| 6 | 3PC Host 종료 → 승계 | ⬜ |
| 7 | 2PC 네트워크 히컵 → 재접속 | ⬜ |
| 8 | 1PC Solo 모드 정상 동작 | ⬜ |
| 9 | 2PC 동시 오픈 → Split-brain 없음 | ⬜ |

---

## 파일 변경 요약

| 파일 | 액션 | Phase |
|------|------|-------|
| `main/p2p-service.js` | Stub으로 교체 | 0 |
| `renderer/scripts/modules/lan-discovery.js` | Stub으로 교체 | 0 |
| `renderer/scripts/modules/p2p-sync.js` | Stub으로 교체 | 0 |
| `package.json` | bonjour-service 제거, ws 추가 | 0 |
| **`main/ws-server.js`** | **신규 생성** | 1 |
| `main/ipc-handlers.js` | WS IPC 핸들러 추가 | 1 |
| `preload/preload.js` | WS API 노출 | 1 |
| **`renderer/scripts/modules/ws-client.js`** | **신규 생성** | 1 |
| `renderer/scripts/modules/collaboration-manager.js` | WS 연동 전면 재작성 | 1, 2, 3 |
| `renderer/scripts/modules/sync-protocol.js` | 메시지 타입 재정의 | 3 |
| `renderer/scripts/modules/review-data-manager.js` | role 기반 저장 분기 | 4 |
| **`renderer/scripts/modules/cursor-overlay.js`** | **신규 생성** | 5 |
| `renderer/scripts/app.js` | 커서 이벤트 + UI 연동 | 5 |
| `renderer/styles/main.css` | 커서 스타일 추가 | 5 |

---

## 아키텍처 결정 사항

### WebSocket Client 위치: Renderer 직접 연결 (확정)

```
Client Renderer ──(브라우저 WebSocket)──→ Host Main Process (ws 서버)
Host Renderer   ──(브라우저 WebSocket)──→ Host Main Process (localhost)
```

- 커서 30fps 메시지가 IPC를 거치지 않아 레이턴시 최소화
- session.json 파일 I/O만 IPC 사용 (빈도 낮음)
- Host의 브로드캐스트 요청은 IPC (`wsBroadcast`)

### 메시지 라우팅: Main Process = 순수 릴레이

- WS Server는 메시지 내용을 해석하지 않음
- Host Renderer가 비즈니스 로직 전담
- 단, JOIN/LEAVE는 WS Server가 감지하여 IPC로 Renderer에 알림

### Host의 데이터 권한

- Host = Source of Truth (인메모리 상태)
- Client는 디스크에 직접 쓰지 않음
- 새 Client 접속 시 Host가 WELCOME으로 전체 상태 전달

---

*작성일: 2026-02-25*
*기반: DEVLOG/실시간-협업-WebSocket-리팩토링-계획.md*
