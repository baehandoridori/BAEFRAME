# LAN P2P 동기화 상세 설계

> 같은 네트워크에서 실시간 협업을 위한 P2P 동기화 시스템

---

## 개요

### 핵심 아이디어

```
현재 방식:
  [사용자 A] → (파일 저장) → [Google Drive] → (동기화 대기) → [사용자 B]
  지연: 3~30초

LAN P2P 방식:
  [사용자 A] ←――――― P2P 직접 연결 ―――――→ [사용자 B]
  지연: < 100ms
```

**Google Drive는 그대로 유지**하면서, 같은 네트워크에 있으면 **P2P로 먼저 동기화**합니다.

---

## 작동 원리

### 1단계: 피어 발견 (mDNS)

앱을 시작하면 **"나 여기 있어요"**를 네트워크에 알립니다.

```
[앱 시작]
    ↓
[mDNS 서비스 등록]
    서비스명: _baeframe._tcp.local
    포트: 45678
    TXT: { sessionId: "abc123", userName: "김작가" }
    ↓
[같은 네트워크의 다른 BAEFRAME 앱들이 자동으로 발견됨]
```

**mDNS (Multicast DNS)**란?
- 로컬 네트워크에서 서비스를 찾는 표준 기술
- Apple Bonjour, Google Cast, Spotify Connect 등이 사용
- 중앙 서버 없이 자동으로 기기를 찾아줌

### 2단계: 같은 파일 확인

피어를 발견하면 **같은 .bframe 파일을 열고 있는지** 확인합니다.

```
[피어 발견: 192.168.1.100]
    ↓
[연결 시도 + 파일 정보 교환]
    "나는 project_v3.bframe 열고 있어"
    ↓
[상대방 응답]
    "나도! 연결하자"
    ↓
[P2P 연결 수립]
```

### 3단계: WebRTC 연결

같은 파일을 열고 있으면 **WebRTC DataChannel**로 연결합니다.

```
┌─────────────────┐                    ┌─────────────────┐
│   사용자 A PC    │                    │   사용자 B PC    │
│                 │                    │                 │
│  ┌───────────┐  │   WebRTC P2P      │  ┌───────────┐  │
│  │ BAEFRAME  │◄─┼──────────────────►┼─►│ BAEFRAME  │  │
│  └───────────┘  │   DataChannel     │  └───────────┘  │
│                 │   (암호화됨)        │                 │
└─────────────────┘                    └─────────────────┘
         │                                      │
         └──────────┬──────────────────────────┘
                    ▼
              [Google Drive]
              (백업/폴백용)
```

**WebRTC DataChannel**이란?
- 브라우저/Electron에 내장된 P2P 통신 기술
- 영상통화에 쓰이는 WebRTC의 데이터 버전
- 암호화 기본 제공 (DTLS)
- 추가 서버 없이 직접 연결

### 4단계: 실시간 동기화

연결되면 **변경사항을 즉시 전송**합니다.

```javascript
// 댓글 추가 시
[사용자 A가 댓글 작성]
    ↓
[로컬에 저장 + P2P로 즉시 전송]
    {
      type: "comment:add",
      data: { id: "m123", text: "수정 필요", frame: 120 }
    }
    ↓
[사용자 B 화면에 즉시 표시] // < 100ms
    ↓
[Google Drive에도 저장] // 백업용
```

---

## 시나리오별 동작

### 시나리오 1: 같은 사무실에서 협업

```
                    ┌─────── 사무실 LAN ───────┐
                    │                         │
┌──────────┐        │   P2P 직접 연결 (즉시)   │        ┌──────────┐
│ 김작가 PC │◄───────┼─────────────────────────┼───────►│ 이작가 PC │
└──────────┘        │                         │        └──────────┘
                    └─────────────────────────┘

결과: 댓글/드로잉 변경이 100ms 이내에 동기화
```

### 시나리오 2: 재택 + 사무실 혼재

```
┌─────── 재택 ───────┐              ┌─────── 사무실 ───────┐
│                   │              │                     │
│  ┌──────────┐     │              │  ┌──────────┐       │
│  │ 김작가 PC │     │              │  │ 이작가 PC │◄─P2P─►│ 박작가 PC
│  └──────────┘     │              │  └──────────┘       │
│        │          │              │        │           │
└────────┼──────────┘              └────────┼───────────┘
         │                                  │
         └──────────► Google Drive ◄────────┘
                     (WAN 동기화)

결과:
- 이작가 ↔ 박작가: P2P로 즉시 동기화
- 김작가 ↔ 나머지: Google Drive로 동기화 (기존과 동일)
```

### 시나리오 3: 3명 이상 협업

```
        ┌──────────┐
        │ 김작가 PC │
        └────┬─────┘
             │
      P2P    │    P2P
             │
   ┌─────────┼─────────┐
   │         │         │
   ▼         ▼         ▼
┌──────┐  ┌──────┐  ┌──────┐
│이작가│  │박작가│  │최작가│
└──────┘  └──────┘  └──────┘

결과: 메시 네트워크로 모든 피어가 연결
변경사항이 모든 참여자에게 즉시 전파
```

---

## 아키텍처

### 새로 추가될 모듈

```
renderer/scripts/modules/
├── collaboration-manager.js   (기존 - P2P 통합)
├── lan-discovery.js           (신규 - mDNS 피어 발견)
├── p2p-sync.js               (신규 - WebRTC P2P 동기화)
└── sync-protocol.js          (신규 - 동기화 메시지 프로토콜)
```

### 모듈 역할

```
┌─────────────────────────────────────────────────────────┐
│                   CollaborationManager                   │
│  (기존 협업 로직 + P2P/Drive 전략 선택)                    │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ LANDiscovery │ │ P2PSync  │ │ DriveSync    │
│              │ │          │ │ (기존 방식)   │
│ - mDNS 등록  │ │ - WebRTC │ │ - 파일 폴링  │
│ - 피어 발견  │ │ - 메시지  │ │ - 머지       │
└──────────────┘ └──────────┘ └──────────────┘
```

### 동기화 전략 흐름

```javascript
// collaboration-manager.js (개선 후)
class CollaborationManager {
  async syncChange(change) {
    // 1. P2P 피어가 있으면 즉시 전송
    if (this.p2pSync.hasConnectedPeers()) {
      await this.p2pSync.broadcast(change);
    }

    // 2. Google Drive에도 저장 (백업 + WAN 사용자용)
    await this.reviewDataManager.save();
  }
}
```

---

## 구현 상세

### Phase 1: mDNS 피어 발견

#### 사용할 라이브러리

**옵션 A: `bonjour` (권장)**
```javascript
// 순수 JavaScript, 네이티브 의존성 없음
npm install bonjour-service
```

**옵션 B: `mdns`**
```javascript
// 네이티브 바인딩, 더 안정적이지만 빌드 필요
npm install mdns
npx electron-rebuild
```

#### 코드 예시 (bonjour 사용)

```javascript
// lan-discovery.js
const Bonjour = require('bonjour-service');

class LANDiscovery extends EventEmitter {
  constructor() {
    super();
    this.bonjour = new Bonjour();
    this.service = null;
    this.peers = new Map();
  }

  // 서비스 등록 (내가 BAEFRAME 쓰고 있다고 알림)
  advertise(sessionId, userName, port) {
    this.service = this.bonjour.publish({
      name: `baeframe-${sessionId}`,
      type: 'baeframe',
      port: port,
      txt: {
        sessionId,
        userName,
        version: '1.0'
      }
    });
  }

  // 다른 BAEFRAME 앱 찾기
  discover() {
    this.browser = this.bonjour.find({ type: 'baeframe' });

    this.browser.on('up', (service) => {
      // 새 피어 발견!
      const peer = {
        id: service.txt.sessionId,
        name: service.txt.userName,
        host: service.host,
        port: service.port
      };

      this.peers.set(peer.id, peer);
      this.emit('peer:found', peer);
    });

    this.browser.on('down', (service) => {
      // 피어 오프라인
      this.peers.delete(service.txt.sessionId);
      this.emit('peer:lost', service.txt.sessionId);
    });
  }

  stop() {
    if (this.service) this.service.stop();
    if (this.browser) this.browser.stop();
    this.bonjour.destroy();
  }
}
```

### Phase 2: WebRTC P2P 연결

#### 시그널링 (연결 수립)

WebRTC 연결을 위해서는 초기 "시그널링"이 필요합니다.
LAN 환경에서는 **mDNS로 발견한 IP로 직접 TCP 연결** → 시그널링 메시지 교환

```javascript
// p2p-sync.js
class P2PSync extends EventEmitter {
  constructor(lanDiscovery) {
    super();
    this.connections = new Map(); // peerId → RTCDataChannel
    this.lanDiscovery = lanDiscovery;
  }

  // 피어와 WebRTC 연결
  async connectToPeer(peer) {
    const pc = new RTCPeerConnection({
      // LAN에서는 STUN 서버 불필요
      iceServers: []
    });

    // 데이터 채널 생성
    const channel = pc.createDataChannel('sync', {
      ordered: true
    });

    channel.onopen = () => {
      this.connections.set(peer.id, channel);
      this.emit('peer:connected', peer);
    };

    channel.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.emit('message', { peerId: peer.id, message });
    };

    // Offer 생성 및 전송 (TCP 소켓으로)
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 시그널링 서버 대신 직접 TCP로 전송
    await this.sendSignal(peer, {
      type: 'offer',
      sdp: offer.sdp
    });
  }

  // 모든 피어에게 메시지 전송
  broadcast(message) {
    const data = JSON.stringify(message);
    for (const channel of this.connections.values()) {
      if (channel.readyState === 'open') {
        channel.send(data);
      }
    }
  }
}
```

### Phase 3: 동기화 프로토콜

#### 메시지 타입

```javascript
// sync-protocol.js

// 1. 연결 시 초기 동기화
{
  type: 'sync:init',
  data: {
    fileHash: 'abc123',          // 같은 파일인지 확인
    lastModified: '2024-01-20T10:00:00Z',
    commentCount: 15,
    drawingCount: 8
  }
}

// 2. 댓글 추가
{
  type: 'comment:add',
  data: {
    id: 'marker_xyz',
    layerId: 'layer_1',
    frame: 120,
    text: '여기 수정 필요',
    author: '김작가',
    createdAt: '2024-01-20T10:30:00Z'
  }
}

// 3. 댓글 수정
{
  type: 'comment:update',
  data: {
    id: 'marker_xyz',
    changes: { text: '수정된 댓글', resolved: true },
    updatedAt: '2024-01-20T10:35:00Z'
  }
}

// 4. 드로잉 추가
{
  type: 'drawing:add',
  data: {
    layerId: 'draw_layer_1',
    frame: 120,
    objects: [{ type: 'path', points: [...] }]
  }
}

// 5. Presence (커서/뷰포트 공유 - 선택사항)
{
  type: 'presence:update',
  data: {
    userId: 'user_abc',
    currentFrame: 120,
    cursor: { x: 0.5, y: 0.3 }
  }
}
```

#### 충돌 해결

```javascript
// 같은 댓글을 동시에 수정한 경우
function resolveConflict(local, remote) {
  // updatedAt 타임스탬프로 최신 버전 선택 (기존 로직 활용)
  if (new Date(remote.updatedAt) > new Date(local.updatedAt)) {
    return remote;
  }
  return local;
}
```

---

## 사용자 경험 (UX)

### 협업 상태 표시

```
┌─────────────────────────────────────────────┐
│  📺 프로젝트_v3.mp4                          │
│  ┌─────────────────────────────────────────┐│
│  │                                         ││
│  │         [비디오 플레이어]                ││
│  │                                         ││
│  └─────────────────────────────────────────┘│
│                                             │
│  ┌─ 협업 상태 ─────────────────────────────┐│
│  │ 🟢 LAN 연결됨 (2명)                      ││
│  │   • 김작가 (실시간)                      ││
│  │   • 이작가 (실시간)                      ││
│  │ 🌐 원격 (1명)                            ││
│  │   • 박작가 (Drive 동기화)                ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### 변경 알림

```javascript
// P2P로 변경사항 수신 시
onRemoteChange(change) {
  // 1. 데이터 적용
  this.applyChange(change);

  // 2. 토스트 알림 (선택적)
  showToast(`${change.author}님이 댓글을 추가했습니다`);

  // 3. 타임라인에 표시 깜빡임 (선택적)
  this.highlightMarker(change.id);
}
```

---

## 폴백 전략

### P2P 연결 실패 시

```
[P2P 연결 시도]
       │
       ▼
   성공? ──No──► [Google Drive 동기화로 폴백]
       │              (기존 방식 유지)
      Yes
       │
       ▼
[P2P + Drive 동시 사용]
   (P2P: 실시간)
   (Drive: 백업/WAN용)
```

### 네트워크 상황별 동작

| 상황 | P2P | Drive | 결과 |
|------|-----|-------|------|
| 같은 LAN, 인터넷 OK | ✅ | ✅ | 최상 (즉시 + 백업) |
| 같은 LAN, 인터넷 X | ✅ | ❌ | P2P만 동작 |
| 다른 네트워크 | ❌ | ✅ | 기존과 동일 |
| 모두 끊김 | ❌ | ❌ | 로컬 저장만 |

---

## 구현 일정 (예상)

| Phase | 내용 | 예상 작업량 |
|-------|------|------------|
| Phase 1 | mDNS 피어 발견 | 중간 |
| Phase 2 | WebRTC P2P 연결 | 중간~높음 |
| Phase 3 | 동기화 프로토콜 | 중간 |
| Phase 4 | CollaborationManager 통합 | 중간 |
| Phase 5 | UI 업데이트 (협업 상태 표시) | 낮음 |
| Phase 6 | 테스트 & 안정화 | 높음 |

---

## 필요한 의존성

```json
// package.json
{
  "dependencies": {
    "bonjour-service": "^1.2.0"  // mDNS (순수 JS)
    // WebRTC는 Electron/Chromium 내장
  }
}
```

**참고**: `bonjour-service`는 순수 JavaScript이므로 **네이티브 빌드 불필요**

---

## 리스크 및 완화 방안

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| mDNS 차단 (일부 기업 네트워크) | 중간 | Drive 폴백으로 기능 보장 |
| WebRTC ICE 실패 | 중간 | 재연결 로직 + Drive 폴백 |
| 방화벽 차단 (Windows) | 중간 | 문서화 + 자동 규칙 추가 시도 |
| 3명+ 메시 네트워크 복잡도 | 낮음 | 풀 메시 또는 릴레이 전략 |

---

## 참고 자료

- [MDN: Using WebRTC data channels](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels)
- [MDN: Simple RTCDataChannel sample](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Simple_RTCDataChannel_sample)
- [bonjour-service npm](https://www.npmjs.com/package/bonjour-service)
- [node_mdns GitHub](https://github.com/agnat/node_mdns)
- [WebRTC DataChannel Guide](https://getstream.io/resources/projects/webrtc/basics/rtcdatachannel/)

---

## 다음 단계

이 설계를 승인하시면:

1. [ ] Phase 1 구현 시작 (mDNS 피어 발견)
2. [ ] PoC (Proof of Concept) 작성
3. [ ] 팀 내 테스트
4. [ ] 피드백 반영 후 전체 구현
