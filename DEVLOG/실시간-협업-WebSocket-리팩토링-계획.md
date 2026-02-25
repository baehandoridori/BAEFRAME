# 실시간 협업 WebSocket 리팩토링 계획

> CLAUDE_COLLAB_GUIDE.md 타당성 분석 + Gemini 리뷰 반영 + 보강된 구현 계획

---

## 요약

| Phase | 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|-------|------|----------|------|---------|------|
| 0 | 기존 mDNS/WebRTC 코드 제거 | p2p-service.js, lan-discovery.js, p2p-sync.js | 새 아키텍처와 충돌 방지 | 높음 | ⬜ 대기 |
| 1 | WebSocket 서버 + IP Drop | main/ws-server.js (신규), ipc-handlers.js | Host-Client 연결 기반 구축 | 높음 | ⬜ 대기 |
| 2 | Host Migration (방장 승계) | ws-server.js, collaboration-manager.js | Gemini 리뷰 반영 - 장애 복구 | 높음 | ⬜ 대기 |
| 3 | 실시간 동기화 프로토콜 | sync-protocol.js, collaboration-manager.js | WebSocket 기반 메시지 교환 | 높음 | ⬜ 대기 |
| 4 | 저장 전략 (Host-Only Write + Debounce) | review-data-manager.js | Gemini 리뷰 반영 - 저장 일원화 | 높음 | ⬜ 대기 |
| 5 | 실시간 커서 + Presence UI | collaboration-manager.js, app.js, CSS | Figma 스타일 커서 동기화 | 중간 | ⬜ 대기 |
| 6 | 에지케이스 처리 | 전체 | 재접속, Split-brain, 네트워크 끊김 | 중간 | ⬜ 대기 |
| 7 | 통합 테스트 | 전체 | 2PC + 3PC 시나리오 테스트 | 높음 | ⬜ 대기 |

---

## CLAUDE_COLLAB_GUIDE.md 타당성 분석

### 평가: 전체적으로 타당함 (8/10)

CLAUDE_COLLAB_GUIDE.md의 핵심 아키텍처인 **"IP Drop + LAN WebSocket"**은 현재 환경(동일 LAN, Google Drive 공유, 내부망)에 매우 적합합니다.

#### 타당한 부분

| 제안 | 평가 | 이유 |
|------|------|------|
| mDNS 폐기 → IP Drop | ✅ 매우 타당 | mDNS는 Windows 방화벽, 비대칭 발견 등 실전에서 불안정. IP Drop은 Google Drive를 활용한 단순하고 확실한 방법 |
| WebRTC → WebSocket | ✅ 타당 | WebRTC의 ICE/STUN/Glare 복잡성 제거. LAN 환경에서 WebSocket이 더 간단하고 안정적 |
| 파일 폴링 제거 → WebSocket Pub/Sub | ✅ 매우 타당 | 5~10초 파일 폴링 대신 < 10ms WebSocket 브로드캐스트로 실시간성 확보 |
| Host만 파일 저장 | ✅ 타당 | Google Drive 충돌 파일 문제 원천 해결. 단일 Writer 패턴 |
| CSS transition 커서 | ✅ 타당 | 30ms throttle + 100ms transition으로 부드러운 커서 구현 가능 |

#### 보완이 필요한 부분 (Gemini 리뷰 + 추가 발견)

| 누락 사항 | 심각도 | 출처 |
|-----------|--------|------|
| Host 비정상 종료 시 승계 로직 없음 | 🔴 높음 | Gemini 리뷰 |
| session.json Google Drive 동기화 딜레이 미고려 | 🟡 중간 | Gemini 리뷰 |
| Host 저장 Debounce 세부 전략 없음 | 🟡 중간 | Gemini 리뷰 |
| Host 크래시 시 미저장 데이터 유실 대응 없음 | 🟡 중간 | 추가 발견 |
| Client 재접속(네트워크 hiccup) 처리 없음 | 🟡 중간 | 추가 발견 |
| 새 Client 접속 시 전체 상태 동기화 방법 없음 | 🟡 중간 | 추가 발견 |
| Split-brain (2명이 동시에 Host 주장) 방지 없음 | 🟡 중간 | 추가 발견 |
| 멀티 프로젝트 포트 충돌 고려 없음 | 🟢 낮음 | 추가 발견 (단일 프로젝트로 결정됨) |

---

## Gemini 리뷰 상세 분석 및 대응

### 1. Host Migration (방장 위임/이탈) — 🔴 반드시 구현

**Gemini 제안 요약:**
- WebSocket `onclose` 시 session.json 확인
- 정상 종료: Host가 session.json 삭제
- 비정상 종료: 랜덤 딜레이 후 session.json 먼저 덮어쓰는 Client가 새 Host

**분석:** 방향은 맞지만, "랜덤 딜레이로 선점" 방식은 경쟁 조건(Race Condition) 위험이 있습니다. 더 결정적(Deterministic)인 방법이 필요합니다.

**보강된 설계:**

```
Host 종료 시나리오 분기:

A) 정상 종료 (앱 닫기, 파일 전환)
   1. Host가 모든 Client에게 HOST_SHUTDOWN 메시지 전송
   2. Host가 미저장 데이터 최종 저장
   3. Host가 session.json 삭제
   4. WebSocket 서버 종료
   → Client들은 HOST_SHUTDOWN 수신 → 승계 프로토콜 시작

B) 비정상 종료 (크래시, 전원 꺼짐)
   1. WebSocket 연결 끊김 → Client에서 onclose 이벤트 발생
   2. Client들은 HOST_SHUTDOWN을 받지 못했으므로 "비정상 종료"로 판단
   3. 승계 프로토콜 시작

승계 프로토콜 (Election Algorithm):
   1. 각 Client는 연결된 다른 Client 목록을 알고 있음 (Host가 JOIN 시 브로드캐스트)
   2. sessionId를 사전순(Lexicographic) 정렬
   3. 가장 작은 sessionId를 가진 Client가 새 Host로 선출 (결정적)
   4. 선출된 Client:
      a. WebSocket 서버 시작
      b. session.json 덮어쓰기 (새 IP/Port)
      c. 다른 Client들에게 NEW_HOST 알림 (이전 데이터 채널은 끊어졌으므로, 다른 Client들은 session.json 폴링으로 발견)
   5. 나머지 Client:
      a. 5초간 session.json 폴링 (1초 간격)
      b. 새 Host의 IP/Port 발견 시 재접속
      c. 10초 내 재접속 실패 시 독립 모드(Solo) 전환
```

**핵심 포인트:**
- 랜덤 딜레이 대신 **sessionId 기반 결정적 선출** → Race Condition 없음
- Client들이 이미 참여자 목록을 알고 있으므로 Google Drive 의존 최소화
- 새 Host는 자신의 인메모리 데이터를 기반으로 즉시 서비스 시작

### 2. session.json 동기화 딜레이 — 🟡 반드시 구현

**Gemini 제안 요약:**
- session.json이 없을 때 1~2초 대기 후 Host 선점

**분석:** 정확한 진단. Google Drive는 파일 생성 후 1~3초 동기화 딜레이가 있으며, 여러 명이 동시에 프로젝트를 열면 모두 Host가 될 수 있습니다.

**보강된 설계:**

```
프로젝트 오픈 시 Host/Client 결정 흐름:

1. session.json 읽기 시도
   ├── 존재 → session.json의 IP:Port로 WebSocket 연결 시도
   │   ├── 연결 성공 → Client 모드 ✅
   │   └── 연결 실패 → session.json이 오래됨 (이전 Host 비정상 종료)
   │       → session.json 삭제 후 Host 후보 진입
   │
   └── 부재 → Host 후보 진입

Host 후보 진입 (Race Condition 방지):
   1. 랜덤 딜레이: 500ms + Math.random() * 1500ms (총 0.5~2초)
      → 동시 접속 시 시간 분산
   2. session.json 재확인 (Drive 동기화 대기 효과)
      ├── 존재 → 다른 사람이 먼저 Host 됨 → Client 모드
      └── 부재 → session.json 생성 → Host 모드 시작
   3. Host 모드 시작 후 500ms 후 session.json 재확인
      ├── 내가 쓴 내용과 동일 → 정상 Host 확정 ✅
      └── 다른 IP가 적혀있음 → Split-brain 감지
          → sessionId 비교 → 작은 쪽이 Host 유지, 큰 쪽은 Client 전환
```

**추가 안전장치:**
- session.json에 `createdAt` 타임스탬프 포함 → 3분 이상 된 session.json은 무효 처리
- session.json에 `hostSessionId` 포함 → Split-brain 해결 시 결정적 비교 가능

**session.json 스키마:**
```json
{
  "hostIp": "192.168.1.100",
  "port": 12345,
  "hostSessionId": "abc123...",
  "hostName": "김작가",
  "projectPath": "G:/projects/shot_001_v3.bframe",
  "createdAt": "2026-02-25T10:00:00Z",
  "version": "1.0"
}
```

### 3. Host 저장 Debounce — 🟡 반드시 구현

**Gemini 제안 요약:**
- 3초 이상 변화가 없을 때 한 번에 저장

**분석:** 현재 ReviewDataManager의 autoSaveDelay가 500ms인데, Host-only 아키텍처에서는 모든 Client 변경사항이 Host에 집중되므로 너무 빈번한 저장이 발생합니다.

**보강된 설계:**

```
저장 전략 (3단계):

1. 인메모리 즉시 반영 (0ms)
   - Client가 변경 → WebSocket으로 Host에 전송
   - Host가 인메모리 상태 업데이트 → 모든 Client에 브로드캐스트
   - 모든 참여자의 UI 즉시 갱신
   → 사용자 체감: "실시간"

2. 디스크 저장 (Debounce 3초)
   - 마지막 변경 후 3초간 추가 변경 없으면 .bframe 파일 저장
   - 진행 중 변경이 들어오면 타이머 리셋
   - 저장 중 새 변경 → 저장 완료 후 다시 3초 Debounce
   → 실질적 효과: 활발한 편집 중에는 저장 미발생, 편집 멈추면 3초 후 자동 저장

3. 강제 저장 (즉시)
   - 트리거: 사용자 Ctrl+S, 앱 종료, 파일 전환, Host 승계 전
   - Debounce 타이머 무시하고 즉시 저장
   → 데이터 유실 방지 최후의 보루

추가: 최대 저장 간격 30초
   - Debounce와 별개로, 마지막 저장 후 30초가 지나면 강제 저장
   - 계속 편집하는 경우에도 최소 30초마다 한 번은 디스크에 기록
```

**기존 코드 변경:**
- `ReviewDataManager.autoSaveDelay`: 500ms → 3000ms (Host 모드일 때)
- `ReviewDataManager.maxSaveInterval`: 새로 추가 (30초)
- 새 메서드: `forceSave()` — Debounce 무시 즉시 저장

---

## 추가 발견 에지케이스 및 대응

### 4. Host 크래시 시 미저장 데이터 유실

**시나리오:** Host가 댓글 10개를 인메모리에 받고 Debounce 3초 기다리는 중에 크래시
**영향:** 최대 3초분(+ 마지막 저장 이후 30초 이내)의 변경사항 유실

**대응 (유실 허용 + 알림 방식):**
```
1. 새 Host 선출 후:
   - 새 Host의 인메모리 데이터를 기준으로 서비스 시작
   - "이전 Host가 비정상 종료되었습니다. 일부 변경사항이 유실되었을 수 있습니다." 토스트

2. 유실 최소화 보조 장치:
   - Client도 자체 인메모리 상태를 유지 (현재도 commentManager에 데이터 있음)
   - 새 Host 선출 시, 가장 최신 modifiedAt을 가진 Client의 데이터를 기준으로 복구
   - 즉, 새 Host는 자신의 인메모리 데이터 + 디스크 데이터 중 더 최신인 것을 채택

3. 추가 안전장치:
   - Host가 maxSaveInterval을 30초 → 15초로 줄여서 유실 범위 축소 가능
```

### 5. Client 재접속 (네트워크 Hiccup)

**시나리오:** WiFi 일시 끊김(1~5초), 노트북 덮었다 열기
**영향:** WebSocket 연결 끊김 → 그동안의 변경사항 누락

**대응:**
```
WebSocket 재접속 전략:

1. onclose 이벤트 발생 시:
   - 즉시 재접속 시도 (0ms)
   - 실패 시 1초 → 2초 → 4초 → 8초 (지수 백오프, 최대 4회)

2. 재접속 성공 시:
   - Client가 자신의 마지막 동기화 타임스탬프 전송
   - Host가 해당 시점 이후의 변경사항을 FULL_STATE_SYNC 또는 DELTA_SYNC로 전송

3. 재접속 실패 시 (15초 초과):
   - session.json 재확인 → Host가 바뀌었을 수 있음
   - 새 Host IP로 연결 시도
   - 그래도 실패 → Solo 모드 전환 + "협업 연결이 끊어졌습니다" 토스트
```

### 6. 새 Client 접속 시 전체 상태 동기화

**시나리오:** 진행 중인 리뷰 세션에 새 팀원이 참여
**영향:** 디스크의 .bframe 파일은 Debounce로 인해 최신이 아닐 수 있음

**대응:**
```
새 Client 접속 흐름:

1. Client가 WebSocket 연결 성공
2. Client → Host: JOIN 메시지 (sessionId, userName, userColor)
3. Host → Client: WELCOME 메시지
   {
     type: 'WELCOME',
     participants: [...],  // 현재 접속자 목록
     state: {              // Host의 인메모리 최신 상태
       comments: { ... },
       drawings: { ... },
       highlights: [ ... ]
     },
     hostModifiedAt: '...'
   }
4. Client는 WELCOME의 state로 자신의 데이터 초기화
   - 디스크의 .bframe 파일이 아닌, Host의 인메모리 상태가 진실의 원천(Source of Truth)
5. Host → 다른 모든 Client: PEER_JOINED 브로드캐스트
```

### 7. Split-brain (2명이 동시에 Host 주장)

**시나리오:** 네트워크 파티션 또는 Google Drive 딜레이로 2명이 동시에 session.json 작성
**영향:** 2개의 독립된 WebSocket 서버 운영 → 데이터 분기

**대응:**
```
Split-brain 감지 및 해결:

감지 방법:
- 새 Host가 session.json 작성 후 500ms 후 재읽기
- 자신이 쓴 내용과 다르면 Split-brain 감지

해결 (sessionId 기반 결정적 승리자):
- 두 Host의 sessionId 비교
- 사전순으로 더 작은 sessionId의 Host가 승리
- 패배한 Host:
  1. WebSocket 서버 종료
  2. Client 모드로 전환
  3. 자신의 인메모리 데이터를 승리 Host에게 MERGE_REQUEST로 전송
  4. 자신에게 연결된 Client들에게 REDIRECT 메시지 전송 (새 Host IP)

추가 안전장치:
- session.json에 hostSessionId 포함 → 결정적 비교 가능
- 30초마다 session.json 검증 (자신의 정보가 맞는지 확인)
```

---

## 파일별 변경 계획

### 제거할 파일/코드

| 파일 | 변경 | 이유 |
|------|------|------|
| `main/p2p-service.js` | 전체 재작성 → `main/ws-server.js` | mDNS/Bonjour/UDP 제거, WebSocket 서버로 교체 |
| `renderer/scripts/modules/lan-discovery.js` | 전체 재작성 | mDNS 의존 제거, session.json 기반으로 교체 |
| `renderer/scripts/modules/p2p-sync.js` | 전체 재작성 | WebRTC 제거, WebSocket Client로 교체 |
| `package.json` | `bonjour-service` 제거, `ws` 추가 | mDNS → WebSocket |

### 수정할 파일

| 파일 | 변경 내용 |
|------|----------|
| `main/ipc-handlers.js` | P2P IPC → WebSocket IPC (start-ws-server, stop-ws-server, connect-ws 등) |
| `preload/preload.js` | P2P API → WebSocket API 노출 |
| `renderer/scripts/modules/collaboration-manager.js` | .collab 파일 폴링 제거, WebSocket 이벤트 기반으로 전환 |
| `renderer/scripts/modules/review-data-manager.js` | Host-only 저장 로직, Debounce 3초, maxSaveInterval 30초 |
| `renderer/scripts/modules/sync-protocol.js` | 메시지 타입 재정의 (WebSocket 용) |
| `renderer/scripts/app.js` | 커서 오버레이 UI, Presence 바 업데이트 |
| `renderer/index.html` | 커서 오버레이 DOM 영역 추가 |
| `renderer/styles/main.css` | 커서 스타일, 전환 애니메이션 |

### 신규 파일

| 파일 | 역할 |
|------|------|
| `main/ws-server.js` | Electron Main에서 WebSocket 서버 구동 (Host 역할) |
| `renderer/scripts/modules/ws-client.js` | Renderer에서 WebSocket Client 연결 |
| `renderer/scripts/modules/cursor-overlay.js` | 다중 커서 렌더링 전담 모듈 |

---

## 메시지 프로토콜 (WebSocket)

### 메시지 타입 정의

```javascript
// === 연결 관리 ===
JOIN            // Client → Host: 세션 참가
WELCOME         // Host → Client: 참가 수락 + 전체 상태 전달
PEER_JOINED     // Host → All: 새 참가자 알림
PEER_LEFT       // Host → All: 참가자 이탈 알림
HOST_SHUTDOWN   // Host → All: 정상 종료 알림

// === 커서/Presence ===
CURSOR_MOVE     // Client → Host → All: 마우스 좌표 (30fps throttle)
PRESENCE_UPDATE // Client → Host → All: 프레임 위치, 재생 상태

// === 데이터 동기화 ===
STATE_CHANGE    // Client → Host: 로컬 변경 사항 (comment/drawing/highlight)
STATE_BROADCAST // Host → All: 변경 사항 브로드캐스트
FULL_STATE_SYNC // Host → Client: 전체 상태 동기화 (재접속 시)

// === 편집 잠금 ===
EDIT_LOCK       // Client → Host: 편집 잠금 요청
EDIT_UNLOCK     // Client → Host: 편집 잠금 해제
EDIT_LOCK_STATE // Host → All: 잠금 상태 변경 브로드캐스트

// === Host Migration ===
HOST_ELECTION   // 내부: Host 선출 프로토콜
REDIRECT        // 이전 Host → Client: 새 Host로 재접속 지시
MERGE_REQUEST   // 패배한 Host → 승리 Host: 데이터 머지 요청
```

### 메시지 포맷 예시

```javascript
// CURSOR_MOVE (30fps, 최소 payload)
{
  "t": "CM",           // type 축약 (네트워크 절약)
  "s": "abc123",       // sessionId
  "x": 0.452,          // normalized X (0~1)
  "y": 0.318,          // normalized Y (0~1)
  "f": 1200            // current frame
}

// STATE_CHANGE (댓글 추가)
{
  "type": "STATE_CHANGE",
  "sessionId": "abc123",
  "changeType": "COMMENT_ADD",
  "data": {
    "layerId": "layer_default",
    "marker": { /* 댓글 전체 데이터 */ }
  },
  "timestamp": "2026-02-25T10:00:00Z"
}
```

**커서 메시지 최적화:**
- 타입을 2글자로 축약 (`CM` = CURSOR_MOVE)
- JSON 대신 간단한 구분자 방식도 고려: `CM|abc123|0.452|0.318|1200`
- 30fps = ~33ms 간격, 참여자 7명 기준 초당 ~210 메시지 → LAN에서 충분히 처리 가능

---

## Phase별 상세 구현 계획

### Phase 0: 기존 코드 제거

**목표:** mDNS/WebRTC 코드 깔끔하게 제거하여 새 구현과 충돌 방지

**작업 내용:**
1. `main/p2p-service.js` 내용 비우기 (파일은 유지, export 비움)
2. `renderer/scripts/modules/lan-discovery.js` 내용 비우기
3. `renderer/scripts/modules/p2p-sync.js` 내용 비우기
4. `collaboration-manager.js`에서 P2P 관련 import/호출 제거
5. `app.js`에서 P2P 관련 UI 이벤트 제거
6. `package.json`에서 `bonjour-service` 제거, `ws` 추가
7. `ipc-handlers.js`에서 P2P IPC 핸들러 비활성화

**리스크:** 기존 .collab 파일 기반 협업도 함께 제거됨 → 이 Phase 이후 협업 기능 일시 불가
**완화:** Phase 1~3까지 빠르게 구현하여 공백 최소화

### Phase 1: WebSocket 서버 + IP Drop

**목표:** Host가 WebSocket 서버를 열고, Client가 session.json을 통해 발견하여 연결

**신규 파일: `main/ws-server.js`**
```
역할:
- ws 패키지로 WebSocket 서버 구동 (포트 12345)
- 클라이언트 연결 관리 (Map<sessionId, WebSocket>)
- 메시지 라우팅 (브로드캐스트, 유니캐스트)
- 참가자 목록 관리

핵심 메서드:
- start(port) → 서버 시작, 로컬 IP 감지
- stop() → 서버 종료, session.json 삭제
- broadcast(message, excludeSessionId) → 전체 브로드캐스트
- getParticipants() → 현재 참가자 목록
```

**신규 파일: `renderer/scripts/modules/ws-client.js`**
```
역할:
- WebSocket 클라이언트 연결 관리
- 자동 재접속 (지수 백오프)
- 메시지 수신/발신

핵심 메서드:
- connect(url) → WebSocket 연결
- send(message) → 메시지 전송
- disconnect() → 연결 종료
- onMessage(callback) → 메시지 수신 핸들러
```

**IP Drop 흐름:**
```
1. 프로젝트 열기 (setVideoFile)
2. session.json 경로 결정: [비디오파일].session.json
3. session.json 읽기 시도
   ├── 존재 + 3분 이내 → WebSocket 연결 시도
   │   ├── 성공 → Client 모드
   │   └── 실패 → Host 후보 진입 (딜레이 포함)
   └── 부재 또는 3분 초과 → Host 후보 진입 (딜레이 포함)
4. Host 후보 진입:
   a. 500ms~2000ms 랜덤 딜레이
   b. session.json 재확인
   c. 여전히 부재 → Host 모드 시작
   d. session.json 작성 → WebSocket 서버 구동
```

**로컬 IP 감지 (가상 어댑터 필터링):**
```javascript
function getPhysicalLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    // 가상 어댑터 필터링
    if (/virtual|vmware|vbox|docker|wsl|hyper-v/i.test(name)) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}
```

### Phase 2: Host Migration (방장 승계)

**목표:** Host 이탈 시 자동으로 새 Host 선출

**구현 위치:** `collaboration-manager.js` + `ws-client.js`

**정상 종료 흐름:**
```
1. Host가 앱 종료 / 파일 전환 감지
2. forceSave() → 디스크 저장
3. broadcast(HOST_SHUTDOWN) → 모든 Client에 알림
4. session.json 삭제
5. WebSocket 서버 종료
```

**비정상 종료 흐름:**
```
1. Client의 WebSocket onclose 발생
2. 2초 대기 (일시적 네트워크 끊김 여부 확인)
3. 재접속 시도 (2회)
4. 실패 → Host 비정상 종료로 판단
5. 승계 프로토콜 시작:
   a. 로컬 참가자 목록에서 sessionId 정렬
   b. 가장 작은 sessionId가 자신이면 → 새 Host 시작
   c. 아니면 → 5초간 session.json 폴링하여 새 Host 대기
   d. 새 Host 발견 → 재접속
   e. 10초 초과 → Solo 모드
```

**beforeunload 핸들러 (정상 종료 보장):**
```javascript
window.addEventListener('beforeunload', async () => {
  if (isHost) {
    await forceSave();
    broadcast({ type: 'HOST_SHUTDOWN' });
    deleteSessionJson();
  } else {
    send({ type: 'LEAVE', sessionId });
  }
});
```

### Phase 3: 실시간 동기화 프로토콜

**목표:** 모든 데이터 변경을 WebSocket으로 즉시 동기화

**데이터 흐름 (Star Topology):**
```
Client A (변경 발생)
    │
    │ STATE_CHANGE
    ▼
  Host (인메모리 업데이트 + 저장 Debounce 시작)
    │
    │ STATE_BROADCAST
    ▼
Client B, C, D... (인메모리 업데이트 + UI 갱신)
```

**변경 타입:**
```javascript
const CHANGE_TYPES = {
  COMMENT_ADD:     'CA',
  COMMENT_UPDATE:  'CU',
  COMMENT_DELETE:  'CD',
  REPLY_ADD:       'RA',
  DRAWING_ADD:     'DA',
  DRAWING_UPDATE:  'DU',
  DRAWING_DELETE:  'DD',
  LAYER_ADD:       'LA',
  LAYER_DELETE:    'LD',
  HIGHLIGHT_CHANGE:'HC'
};
```

**Host의 변경 처리:**
```
1. STATE_CHANGE 수신
2. 인메모리 데이터에 변경 적용 (commentManager, drawingManager)
3. 변경자를 제외한 모든 Client에 STATE_BROADCAST
4. isDirty = true → Debounce 타이머 리셋 (3초)
```

### Phase 4: 저장 전략 (Host-Only Write + Debounce)

**목표:** Host만 .bframe 파일에 쓰고, Debounce로 빈도 조절

**ReviewDataManager 변경:**
```
현재 (모든 참여자가 저장):
  _onDataChanged → 500ms debounce → save() → writeFile()

변경 후 (Host/Client 분기):
  Host일 때:
    _onDataChanged → 3000ms debounce → save() → writeFile()
    + maxSaveInterval 30초 강제 저장
    + forceSave() on 종료/전환

  Client일 때:
    _onDataChanged → WebSocket STATE_CHANGE 전송
    save() 비활성화 (디스크 쓰기 없음)
    인메모리 상태만 유지
```

**코드 변경 포인트:**
- `ReviewDataManager` 생성자에 `role` 속성 추가 ('host' | 'client' | 'solo')
- `_scheduleAutoSave()`에서 role === 'client'이면 return
- `_doSave()`에서 role === 'client'이면 return
- `setRole(role)` 메서드 추가 → Host Migration 시 역할 전환

### Phase 5: 실시간 커서 + Presence UI

**목표:** Figma 스타일 다중 커서 + 상단 접속자 표시

**커서 동기화:**
```
1. mousemove 이벤트 (비디오 플레이어 영역)
   → 33ms throttle (30fps)
   → 좌표를 비디오 영역 기준 0~1 정규화
   → WebSocket CURSOR_MOVE 전송

2. 수신 측:
   → 정규화 좌표를 현재 비디오 영역 크기로 역변환
   → DOM 오버레이 요소 position 업데이트
   → CSS transition: transform 0.1s linear (보간)
```

**신규 파일: `renderer/scripts/modules/cursor-overlay.js`**
```
역할:
- 비디오 플레이어 위에 절대 위치 오버레이 레이어 관리
- 각 참가자별 커서 DOM 요소 생성/제거
- CSS transition으로 부드러운 이동
- 커서 옆에 사용자 이름 표시

구조:
<div class="cursor-overlay-container">
  <div class="remote-cursor" style="transform: translate(452px, 318px)">
    <svg class="cursor-icon" fill="#ff4757">...</svg>
    <span class="cursor-label">김작가</span>
  </div>
</div>
```

**Presence 바 (상단):**
```
현재 참가자를 상단 바에 아바타로 표시
- 원형 아바타 (사용자 색상 배경 + 이름 첫 글자)
- 호버 시 이름 + 연결 상태 툴팁
- 클릭 시 해당 사용자의 현재 프레임으로 이동 (선택)
```

### Phase 6: 에지케이스 처리

**구현할 에지케이스 목록:**

| 시나리오 | 처리 |
|----------|------|
| Host 크래시 | 승계 프로토콜 (Phase 2) + 토스트 알림 |
| Client 일시 끊김 | 자동 재접속 (지수 백오프) + FULL_STATE_SYNC |
| Split-brain | sessionId 비교 결정적 해결 |
| session.json 동기화 딜레이 | 랜덤 딜레이 + 재확인 |
| 모든 Client 이탈 → Host 혼자 | Solo 모드 전환 (기존과 동일하게 동작) |
| Host가 파일 전환 | 기존 세션 정리 → 새 세션 시작 |
| 같은 PC에서 2개 창 | 동일 머신 감지 → 하나는 Host, 하나는 Client |

### Phase 7: 통합 테스트

**테스트 시나리오:**

| # | 시나리오 | 검증 항목 |
|---|----------|----------|
| 1 | 2PC: A(Host) + B(Client) 기본 연결 | session.json 생성, WebSocket 연결, Presence 표시 |
| 2 | 2PC: 댓글 실시간 동기화 | A 댓글 추가 → B에 즉시 표시 (< 100ms) |
| 3 | 2PC: 커서 동기화 | A 마우스 이동 → B에 커서 표시 (부드럽게) |
| 4 | 2PC: Host 정상 종료 → B가 Host 승계 | session.json 갱신, B가 WebSocket 서버 시작 |
| 5 | 2PC: Host 강제 종료 (작업관리자) | B가 비정상 종료 감지, 5초 내 Host 승계 |
| 6 | 3PC: A(Host) + B + C, A 종료 | B 또는 C가 승계 (sessionId 기반) |
| 7 | 2PC: 편집 잠금 | A 댓글 수정 중 → B 수정 불가 |
| 8 | 2PC: 네트워크 히컵 시뮬레이션 | WiFi 끊었다 켜기 → 자동 재접속 |
| 9 | 1PC: Solo 모드 | 아무도 없으면 기존과 동일하게 동작 |
| 10 | 2PC: 동시 프로젝트 오픈 | 둘 다 동시에 열 때 Split-brain 없이 Host 결정 |

---

## 리스크 매트릭스

| 리스크 | 심각도 | 발생 확률 | 완화 가능성 | 완화 방안 |
|--------|--------|----------|------------|----------|
| Host 크래시 시 데이터 유실 (최대 3초) | 중간 | 낮음 | 높음 | 유실 허용 + 토스트 알림 + 30초 강제저장 |
| session.json 동시 작성 (Split-brain) | 중간 | 낮음 | 높음 | sessionId 결정적 비교 |
| WebSocket 포트 사용 중 (다른 앱) | 낮음 | 매우 낮음 | 높음 | 포트 폴백 (12345 → 12346 → ...) |
| Google Drive 동기화 딜레이 (session.json) | 중간 | 높음 | 높음 | 랜덤 딜레이 + 재확인 로직 |
| 대규모 참여자 (7명+) 시 WebSocket 부하 | 낮음 | 낮음 | 높음 | Star topology로 Host만 N-1 연결 |
| Host Migration 중 메시지 유실 | 중간 | 중간 | 중간 | FULL_STATE_SYNC로 재접속 시 복구 |
| .collab 파일 레거시 잔존 | 낮음 | 높음 | 높음 | Phase 0에서 깨끗이 제거 |

---

## 기존 코드 재활용 분석

| 모듈 | 재활용 가능성 | 설명 |
|------|-------------|------|
| `review-data-manager.js` | 🟢 높음 | 핵심 구조 유지, role 기반 분기만 추가 |
| `collaboration-manager.js` | 🟡 중간 | 편집 잠금/Presence 로직은 재활용, .collab 파일 I/O 제거 |
| `sync-protocol.js` | 🟡 중간 | 메시지 타입 재정의하되 구조는 유사 |
| `comment-manager.js` | 🟢 높음 | 원격 동기화 메서드 (fromJSON, addMarker 등) 그대로 사용 |
| `drawing-manager.js` | 🟢 높음 | importData/exportData 그대로 사용 |
| `shared/schema.js` | 🟢 높음 | .bframe 스키마는 변경 없음 |
| `p2p-service.js` | 🔴 없음 | 전면 재작성 (ws-server.js) |
| `lan-discovery.js` | 🔴 없음 | 전면 재작성 (session.json 기반) |
| `p2p-sync.js` | 🔴 없음 | 전면 재작성 (ws-client.js) |

---

## 의존성 변경

```json
// 제거
"bonjour-service": "^1.3.0"  // mDNS - 더 이상 불필요

// 추가
"ws": "^8.16.0"              // WebSocket 서버 (Main Process)
// 참고: Client 측은 브라우저 내장 WebSocket API 사용 (추가 의존성 없음)
```

---

## .collab 파일 제거

기존의 `.bframe.collab` 파일은 더 이상 사용하지 않습니다:
- Presence → WebSocket JOIN/LEAVE 메시지로 대체
- 편집 잠금 → WebSocket EDIT_LOCK/UNLOCK 메시지로 대체
- 활동 시간 → WebSocket PRESENCE_UPDATE로 대체

**마이그레이션:** 업데이트 후 기존 `.bframe.collab` 파일은 무시됩니다. 수동 삭제해도 무방.

---

## 테스트 방법

### 환경 준비
```bash
# ws 패키지 설치
npm install ws

# 개발 모드 실행 (2개 PC 또는 2개 창에서)
npm run dev
```

### 기본 연결 테스트
```javascript
// PC1 콘솔 (Host)
collaborationManager.getRole()  // 'host'
collaborationManager.getParticipants()  // [{name: '나', role: 'host'}]

// PC2 콘솔 (Client)
collaborationManager.getRole()  // 'client'
collaborationManager.getParticipants()  // [{name: '나'}, {name: 'PC1사용자'}]
```

### Host Migration 테스트
```
1. PC1(Host) + PC2(Client)로 연결 확인
2. PC1 강제 종료 (작업관리자)
3. PC2가 5초 내에 Host로 승계되는지 확인
4. PC2 콘솔: collaborationManager.getRole() === 'host'
```

---

## 구현 순서 권장

```
Phase 0 (코드 정리)     → 30분
Phase 1 (WebSocket 기반) → 2~3시간
Phase 2 (Host Migration) → 1~2시간
Phase 3 (동기화 프로토콜) → 2~3시간
Phase 4 (저장 전략)      → 1시간
Phase 5 (커서 + UI)      → 2~3시간
Phase 6 (에지케이스)     → 1~2시간
Phase 7 (테스트)         → 각 Phase 후 수시 진행
```

각 Phase 완료 후 사용자 테스트 → 통과 시 다음 Phase 진행

---

## CLAUDE_COLLAB_GUIDE.md 원본과의 차이점

| 항목 | 원본 가이드 | 이 계획 (보강본) |
|------|------------|-----------------|
| Host 이탈 처리 | 언급 없음 | sessionId 기반 결정적 선출 알고리즘 |
| session.json 딜레이 | 언급 없음 | 랜덤 딜레이 + 재확인 + 3분 만료 |
| 저장 Debounce | "Debounce 적용" 언급만 | 3초 debounce + 30초 max interval + forceSave |
| Split-brain | 언급 없음 | sessionId 비교 결정적 해결 |
| 재접속 | 언급 없음 | 지수 백오프 + FULL_STATE_SYNC |
| 새 Client 합류 | 언급 없음 | WELCOME 메시지로 전체 상태 전달 |
| 데이터 유실 | 언급 없음 | 허용 + 토스트 알림 + Client 백업 |
| 커서 프로토콜 | "30ms throttle" | 30fps + 축약 메시지 + CSS transition |

---

*작성일: 2026-02-25*
*기반 문서: CLAUDE_COLLAB_GUIDE.md, Gemini 3.1 Pro 리뷰*
