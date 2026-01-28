# LAN P2P 협업 시스템 - 디버깅 세션 요약

> 2026-01-28 세션 내용 정리. 새 세션에서 이어서 작업할 때 참고용.

---

## 1. 프로젝트 개요

**목표:** 같은 LAN에서 실시간 P2P 동기화로 협업 기능 개선
- mDNS로 피어 자동 발견
- WebRTC DataChannel로 직접 통신
- 기존 Google Drive 동기화는 폴백으로 유지

**관련 문서:** `DEVLOG/LAN-P2P-협업-시스템-구현-계획.md`

---

## 2. 구현 완료된 Phase

| Phase | 내용 | 상태 | 생성/수정 파일 |
|-------|------|------|---------------|
| 1 | IPC 핸들러 | ✅ | `main/ipc-handlers.js`, `preload/preload.js` |
| 2 | mDNS 피어 발견 | ✅ | `main/p2p-service.js`, `renderer/scripts/modules/lan-discovery.js` |
| 3 | WebRTC P2P 연결 | 🔄 | `renderer/scripts/modules/p2p-sync.js` |
| 4 | 동기화 프로토콜 | ✅ | `renderer/scripts/modules/sync-protocol.js` |
| 5 | CollaborationManager 통합 | ✅ | `renderer/scripts/modules/collaboration-manager.js` |
| 6 | UI | ✅ | `renderer/index.html`, `renderer/styles/main.css`, `renderer/scripts/app.js` |
| 7 | 테스트 | 🔄 | - |

---

## 3. 핵심 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Renderer Process                        │
│  ┌─────────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ collaboration-  │──│ lan-        │──│ p2p-sync.js     │  │
│  │ manager.js      │  │ discovery.js│  │ (WebRTC)        │  │
│  └─────────────────┘  └─────────────┘  └─────────────────┘  │
│           │                  │                  │            │
│           └──────────────────┼──────────────────┘            │
│                              │ IPC                           │
├──────────────────────────────┼───────────────────────────────┤
│                      Main Process                            │
│                    ┌─────────────────┐                       │
│                    │ p2p-service.js  │                       │
│                    │ (mDNS + Signal) │                       │
│                    └─────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### 연결 흐름

1. **피어 발견**: mDNS (bonjour-service) - 메인 프로세스에서 실행
2. **시그널링**: HTTP 서버 (포트 45679) - WebRTC offer/answer/ICE 교환
3. **P2P 연결**: WebRTC DataChannel - 렌더러에서 실행
4. **Glare 방지**: Session ID 비교로 Offerer/Answerer 역할 결정

---

## 4. 수정한 버그들

### 4.1 SDP 직렬화 문제 ✅
```javascript
// Before (문제)
sdp: pc.localDescription

// After (수정)
sdp: {
  type: pc.localDescription.type,
  sdp: pc.localDescription.sdp
}
```

### 4.2 ICE Candidate 직렬화 문제 ✅
```javascript
// Before (문제)
candidate: event.candidate

// After (수정)
candidate: {
  candidate: event.candidate.candidate,
  sdpMid: event.candidate.sdpMid,
  sdpMLineIndex: event.candidate.sdpMLineIndex
}
```

### 4.3 Glare 문제 (양쪽 Offerer) ✅
```javascript
// Session ID 비교로 역할 결정
const shouldBeOfferer = this.sessionId < peer.id;
if (!shouldBeOfferer) {
  return; // 상대방의 Offer를 기다림
}
```

### 4.4 사용자 이름 '익명' 표시 문제 ✅
```javascript
// Before
const userName = userSettings.userName || '익명';

// After
const userName = userSettings.getUserName();
```

### 4.5 STUN 서버 추가 ✅
```javascript
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
});
```

---

## 5. 현재 문제점 (미해결)

### 문제: P2P 연결이 완료되지 않음

**증상:**
- mDNS로 서로 발견됨 ✅
- Glare 방지 로직 정상 동작 ✅
- ICE candidate 수집 완료 ✅
- 하지만 WebRTC 연결이 'connected' 상태에 도달하지 않음 ❌

**최근 로그 분석 (CMD 창 - 메인 프로세스):**

**PC1 (류성철, 먼저 시작):**
```
[07:32:48.090] P2P 서비스 시작됨 {sessionId:"session_mkxpjqj6_vuennclls", userName:"류성철"}
[07:32:48.091] mDNS 서비스 발견 {isSelf:true}  ← 자기 자신만 발견
[07:33:26.324] mDNS 서비스 발견 {peerId:"session_mkx...", isSelf:true}  ← 여전히 자기 자신
... knownPeers: 0 계속 ...
```

**PC2 (나중에 시작):**
```
[07:33:29.726] P2P 서비스 시작됨 {sessionId:"session_mkxprsej_pe3ear3l1"}
[07:33:29.964] mDNS 서비스 발견 {isSelf:false}  ← PC1 발견!
[07:33:29.964] 피어 발견 (같은 파일) {peer:"류성철", ip:"172.30.1.4"}
... knownPeers: 1 ...
```

**핵심 문제:**
- PC2는 PC1을 발견함
- 하지만 PC1은 PC2를 발견하지 못함 (knownPeers: 0 유지)
- mDNS 발견이 **비대칭적**

**추정 원인:**
1. PC1의 방화벽이 들어오는 mDNS 쿼리/응답을 차단
2. 또는 네트워크 스위치/공유기의 mDNS 릴레이 문제
3. 또는 bonjour-service 라이브러리의 타이밍 이슈

---

## 6. 시도해볼 것들

### 6.1 방화벽 규칙 추가
```batch
:: 관리자 권한 CMD에서
netsh advfirewall firewall add rule name="mDNS In" dir=in action=allow protocol=UDP localport=5353
netsh advfirewall firewall add rule name="mDNS Out" dir=out action=allow protocol=UDP localport=5353
netsh advfirewall firewall add rule name="BAEFRAME Signal" dir=in action=allow protocol=TCP localport=45679
```

### 6.2 mDNS 대신 직접 IP 연결 시도
- 피어 IP를 수동으로 입력받는 방식 검토
- 또는 같은 .bframe 파일의 .collab 파일에서 IP 정보 공유

### 6.3 mDNS 브라우저 재시작 로직
- 피어를 찾지 못하면 mDNS 브라우저를 주기적으로 재시작

### 6.4 WebSocket 시그널링 서버 검토
- HTTP 대신 WebSocket으로 실시간 시그널링

---

## 7. 관련 파일 위치

### 생성된 파일
- `main/p2p-service.js` - 메인 프로세스 mDNS/시그널링
- `renderer/scripts/modules/lan-discovery.js` - 렌더러 LAN 발견 래퍼
- `renderer/scripts/modules/p2p-sync.js` - WebRTC 연결 관리
- `renderer/scripts/modules/sync-protocol.js` - 메시지 프로토콜

### 수정된 파일
- `main/ipc-handlers.js` - P2P IPC 핸들러 추가
- `preload/preload.js` - P2P API 노출
- `renderer/scripts/modules/collaboration-manager.js` - P2P 통합
- `renderer/scripts/modules/comment-manager.js` - 원격 동기화 메서드
- `renderer/index.html` - 협업 상태 패널
- `renderer/styles/main.css` - 협업 UI 스타일
- `renderer/scripts/app.js` - P2P UI 이벤트

### 의존성 추가 (package.json)
```json
"bonjour-service": "^1.3.0",
"node-machine-id": "^1.1.12"
```

---

## 8. 테스트 환경

| 항목 | PC1 | PC2 |
|------|-----|-----|
| IP | 172.30.1.4 | 172.30.1.79 또는 .93 |
| 연결 | 이더넷 | 와이파이 |
| 네트워크 | 같은 서브넷 (172.30.1.x) | 같은 서브넷 |

---

## 9. 브랜치 정보

- **작업 브랜치:** `claude/lan-p2p-collaboration-GcUup`
- **최신 커밋:** `1acd8f5` - "fix: mDNS 주기적 갱신으로 늦게 접속한 피어 발견 개선"

---

## 10. 다음 세션에서 할 일

1. **mDNS 비대칭 발견 문제 해결**
   - PC1이 PC2를 발견하지 못하는 원인 파악
   - 방화벽/네트워크 설정 확인

2. **대안 검토**
   - mDNS 대신 다른 발견 메커니즘 (IP 브로드캐스트, .collab 파일 활용 등)

3. **WebRTC 연결 완료 테스트**
   - mDNS 문제 해결 후 실제 P2P 연결 테스트

4. **UI 테스트**
   - 협업 상태 패널 동작 확인
   - 토스트 알림 확인

---

*마지막 업데이트: 2026-01-28*
