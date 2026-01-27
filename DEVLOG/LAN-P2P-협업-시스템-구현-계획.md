# LAN P2P 협업 시스템 구현 계획

> 같은 네트워크에서 실시간 협업을 위한 P2P 동기화 시스템

---

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | main/ipc-handlers.js, preload/preload.js | P2P 통신용 IPC 핸들러 | 높음 | ✅ 완료 |
| Phase 2 | renderer/scripts/modules/lan-discovery.js (신규) | mDNS 피어 발견 | 높음 | ✅ 완료 |
| Phase 3 | renderer/scripts/modules/p2p-sync.js (신규) | WebRTC P2P 연결 | 높음 | ✅ 완료 |
| Phase 4 | renderer/scripts/modules/sync-protocol.js (신규) | 동기화 메시지 프로토콜 | 높음 | ✅ 완료 |
| Phase 5 | renderer/scripts/modules/collaboration-manager.js | P2P 통합 + 하이브리드 전략 | 높음 | ✅ 완료 |
| Phase 6 | renderer/index.html, renderer/styles/ | 협업 상태 탭 UI | 중간 | ✅ 완료 |
| Phase 7 | 전체 | 테스트 (3개 환경) | 높음 | 🔄 진행중 |

---

## 배경 및 목적

### 왜 필요한가?

현재 BAEFRAME의 협업 기능은 Google Drive 파일 동기화에 의존합니다. 이로 인해:
- 댓글 추가/수정/삭제가 **불안정** (안 되는 경우가 있음)
- 동기화 속도가 **느림** (3~30초 지연)
- "동기화됨" 표시가 **불안정** (세션이 끊기는 느낌)
- `.collab` 파일을 지속적으로 읽고 쓰는 **비효율적인 폴링**

### 팀 환경 분석 (인터뷰 결과)

| 항목 | 내용 |
|------|------|
| 팀 총원 | 약 15명 |
| 동시 협업 인원 | 보통 1~2명, 많으면 5~7명 |
| 네트워크 환경 | **단일 유선 네트워크** (사무실) |
| 재택 근무 | 아주 가끔 |
| 협업 패턴 | 협업 빈도보다 **안정성**이 중요 |

### 해결하려는 문제

1. **댓글 즉시 동기화**: 달면 바로 상대방 화면에 표시
2. **접속자 실시간 확인**: 누가 이 파일을 보고 있는지
3. **연결 상태 구분**: P2P(실시간) vs Drive(느림) 명확히 표시
4. **프레임 위치 공유**: 다른 사용자가 어디를 보고 있는지 (선택)

### 핵심 요구사항

1. **P2P 우선**: 같은 네트워크면 P2P로 즉시 동기화
2. **Drive 폴백**: P2P 실패 시 기존 방식으로 동작 (안정성 보장)
3. **협업 상태 탭**: 접속자 목록, 연결 상태, 활동 시간 표시
4. **사용자 이름 표시**: 기존 익명 → 이름 표시
5. **프레임 위치 공유**: 다른 사용자의 현재 프레임 표시 (선택)

### 명시적으로 불필요한 것

- Google Docs 수준의 실시간 커서 동기화 (선택사항)
- 원격(WAN) P2P 연결 (STUN/TURN 서버 불필요)
- 복잡한 충돌 해결 (기존 updatedAt 비교로 충분)

---

## UI 미리보기

> 구현 전에 최종 결과물이 어떻게 보일지 시각적으로 확인

### 1. 헤더 영역 - 협업자 표시 (현재 → 개선)

**현재 (기존 UI)**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🎬 BAEFRAME                              [검색]     [설정]     [?]         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                     (협업자 표시 없거나 불안정)                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**개선 후**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🎬 BAEFRAME                   ┌──────────────────────┐  [설정]     [?]     │
│                                │ 🔴 🔵 🟢  3명 작업 중 │                     │
│                                │  김  이  박    🟢    │ ← 클릭 가능         │
│                                └──────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼ 클릭하면 상세 패널 열림
```

**아바타 색상 의미**
- 🔴 빨강: 한솔 (기존 테마)
- 🔵 파랑: 성원 (기존 테마)
- 🟢 초록: 기본 사용자

---

### 2. 협업 상태 패널 (클릭 시 펼쳐짐)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                        ┌───────────────────────────────────┐                │
│                        │ 📡 협업 상태               [✕]   │                │
│                        ├───────────────────────────────────┤                │
│                        │                                   │                │
│                        │  📁 현재 파일                     │                │
│                        │     project_v3.bframe             │                │
│                        │                                   │                │
│                        │  👤 내 이름                       │                │
│                        │     김작가                        │                │
│                        │                                   │                │
│                        │  ─────────────────────────────── │                │
│                        │                                   │                │
│                        │  🟢 실시간 연결 (P2P)             │                │
│                        │  ┌─────────────────────────────┐ │                │
│                        │  │ 🔵 이작가                   │ │                │
│                        │  │    📍 120프레임             │ │                │
│                        │  │    ⏱️ 방금 전 활동          │ │                │
│                        │  ├─────────────────────────────┤ │                │
│                        │  │ 🟣 박작가                   │ │                │
│                        │  │    📍 340프레임             │ │                │
│                        │  │    ⏱️ 30초 전 활동          │ │                │
│                        │  └─────────────────────────────┘ │                │
│                        │                                   │                │
│                        │  🟡 Drive 동기화                  │                │
│                        │  ┌─────────────────────────────┐ │                │
│                        │  │ 🟠 최작가 (재택)            │ │                │
│                        │  │    ⏱️ 마지막 동기화: 5초 전  │ │                │
│                        │  └─────────────────────────────┘ │                │
│                        │                                   │                │
│                        │  ─────────────────────────────── │                │
│                        │                                   │                │
│                        │  📊 연결 정보                     │                │
│                        │     P2P 연결: 2명                 │                │
│                        │     Drive 동기화: 1명             │                │
│                        │     발견된 피어: 3명              │                │
│                        │                                   │                │
│                        └───────────────────────────────────┘                │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │                          [비디오 플레이어]                             │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. 연결 상태별 아이콘/색상

| 상태 | 아이콘 | 색상 | 의미 |
|------|--------|------|------|
| P2P 연결됨 | 🟢 | `#2ed573` | 실시간 동기화 (< 100ms) |
| Drive 동기화 | 🟡 | `#ffa502` | 파일 기반 동기화 (3~30초) |
| 오프라인 | 🔴 | `#ff4757` | 연결 끊김 |
| 연결 중 | ⚪ | `#a4b0be` | P2P 연결 시도 중 |

---

### 4. 피어 아이템 상세

**P2P 연결된 피어 (실시간)**
```
┌────────────────────────────────────────┐
│  ┌────┐                                │
│  │ 이 │  이작가                        │
│  │    │  📍 120프레임 • ▶️ 재생 중     │
│  └────┘  ⏱️ 방금 전 활동                │
│          🟢 실시간 연결                 │
└────────────────────────────────────────┘
```

**Drive 동기화 피어 (느림)**
```
┌────────────────────────────────────────┐
│  ┌────┐                                │
│  │ 최 │  최작가                        │
│  │    │  (재택근무)                    │
│  └────┘  ⏱️ 마지막 동기화: 5초 전       │
│          🟡 Drive 동기화                │
└────────────────────────────────────────┘
```

---

### 5. 상태별 토스트 메시지

**P2P 연결 성공**
```
┌────────────────────────────────────────┐
│  🟢 이작가님과 실시간 연결되었습니다    │
└────────────────────────────────────────┘
```

**P2P 연결 해제**
```
┌────────────────────────────────────────┐
│  🟡 이작가님과의 연결이 끊겼습니다      │
│     Drive 동기화로 전환됩니다           │
└────────────────────────────────────────┘
```

**원격 댓글 수신**
```
┌────────────────────────────────────────┐
│  💬 이작가님이 댓글을 추가했습니다      │
│     120프레임: "여기 수정 필요"         │
└────────────────────────────────────────┘
```

---

### 6. 타임라인에서 다른 사용자 위치 표시 (선택 기능)

```
타임라인:
0        100       200       300       400       500
├─────────┼─────────┼─────────┼─────────┼─────────┤
          │         ▼ 내 위치 (현재 프레임)
          │         🔵
          │
          ▼ 이작가 (120프레임)
          🔴
                              ▼ 박작가 (340프레임)
                              🟢
```

**범례**
- 🔵 파란 마커: 내 위치
- 🔴 빨간 마커: 이작가 위치 (클릭하면 해당 프레임으로 이동)
- 🟢 초록 마커: 박작가 위치

---

### 7. 협업 시나리오별 UI 상태

**시나리오 A: 혼자 작업 중**
```
헤더:    [내 아바타만 표시]  1명 작업 중  ⚪
패널:    "다른 협업자 없음"
```

**시나리오 B: P2P 2명 협업**
```
헤더:    [김] [이]  2명 작업 중  🟢
패널:    실시간 연결 (P2P): 이작가
```

**시나리오 C: P2P 2명 + Drive 1명 (재택)**
```
헤더:    [김] [이] [최]  3명 작업 중  🟢
패널:    실시간 연결 (P2P): 이작가
         Drive 동기화: 최작가
```

**시나리오 D: P2P 실패, Drive만 동작**
```
헤더:    [김] [이]  2명 작업 중  🟡
패널:    (P2P 연결 실패)
         Drive 동기화: 이작가
토스트:  "P2P 연결 실패. Drive 동기화로 동작합니다."
```

---

## 선택 기능: 프레임/마우스 위치 공유 (구현 가능성 분석)

> 다른 사용자가 어디를 보고 있는지, 마우스가 어디에 있는지 표시

### 1. 프레임 위치 공유 - ✅ 매우 간단

**구현 난이도**: 낮음
**P2P 필수 여부**: P2P 권장 (Drive로도 가능하지만 느림)

#### 작동 원리

```javascript
// 전송할 데이터 (매우 가벼움)
{
  type: 'presence:update',
  data: {
    userName: '이작가',
    currentFrame: 120,
    isPlaying: true       // 재생 중인지
  }
}
// 크기: ~100 bytes
```

#### 전송 빈도

| 상황 | 빈도 | 이유 |
|------|------|------|
| 프레임 이동 (수동) | 즉시 | 사용자가 탐색 중 |
| 재생 중 | 1초마다 | 너무 자주 보내면 과부하 |
| 정지 상태 | 5초마다 | heartbeat 용도 |

#### UI 표시

```
협업 상태 패널:
┌─────────────────────────────────────┐
│ 🔵 이작가                           │
│    📍 120프레임  ▶️ 재생 중         │
│    ⏱️ 방금 전 활동                  │
└─────────────────────────────────────┘

타임라인 (선택):
0        100       200       300
├─────────┼─────────┼─────────┤
          ▼ 이작가
          🔵
                    ▼ 박작가
                    🟢
```

#### 추가 코드량

```
- sync-protocol.js: 10줄 (메시지 타입 추가)
- p2p-sync.js: 15줄 (전송 로직)
- collaboration-manager.js: 20줄 (상태 관리)
- app.js: 30줄 (UI 업데이트)

총: ~75줄
```

**결론**: ✅ P2P 구현하면 거의 공짜로 추가 가능

---

### 2. 마우스 커서 위치 공유 - ⚠️ 중간 난이도

**구현 난이도**: 중간
**P2P 필수 여부**: **필수** (Drive로는 불가능)

#### 작동 원리

```javascript
// 전송할 데이터
{
  type: 'presence:cursor',
  data: {
    userName: '이작가',
    cursor: { x: 0.45, y: 0.32 },  // 정규화 좌표 (0~1)
    frame: 120                     // 어떤 프레임에서의 위치인지
  }
}
// 크기: ~80 bytes
```

#### 주의: 스로틀링 필수

```javascript
// mousemove는 초당 60~120회 발생
// 모두 전송하면 과부하

// 해결: 50~100ms 스로틀링
let lastSent = 0;
canvas.addEventListener('mousemove', (e) => {
  const now = Date.now();
  if (now - lastSent > 50) {  // 50ms = 초당 20회
    sendCursorPosition(e.x, e.y);
    lastSent = now;
  }
});
```

#### UI 표시

```
비디오 오버레이 (캔버스):
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                    ┌─────────────┐                      │
│                    │ 🔵 이작가   │  ← 커서 옆에 이름    │
│                    └──────┬──────┘                      │
│                           │                             │
│                           ▼                             │
│                           ⬤  ← 상대방 커서 (색상 구분)  │
│                                                         │
│                                     ⬤ ← 박작가 커서     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 추가 코드량

```
- sync-protocol.js: 10줄
- p2p-sync.js: 20줄 (스로틀링 포함)
- collaboration-manager.js: 30줄
- drawing-overlay.js 또는 신규 파일: 80줄 (커서 렌더링)
- app.js: 20줄

총: ~160줄
```

#### 고려 사항

| 항목 | 내용 |
|------|------|
| 같은 프레임일 때만 표시 | 다른 프레임 보고 있으면 커서 숨김 |
| 색상 구분 | 사용자별 다른 색상 |
| 이름 표시 | 커서 옆에 작은 라벨 |
| 페이드 아웃 | 2초간 움직임 없으면 서서히 사라짐 |

**결론**: ⚠️ 구현 가능하지만 필수는 아님. Phase 2로 분리 권장

---

### 3. 구현 우선순위 제안

| 기능 | 우선순위 | 난이도 | 포함 Phase |
|------|---------|--------|-----------|
| 프레임 위치 공유 | **높음** | 낮음 | Phase 5 (기본 포함) |
| 타임라인에 위치 표시 | 중간 | 낮음 | Phase 6 (선택) |
| 마우스 커서 공유 | **낮음** | 중간 | Phase 8 (추후) |

### 4. 프레임 위치만 먼저 구현 시 예상 결과

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🎬 BAEFRAME                   ┌──────────────────────┐                     │
│                                │ 🔴 🔵   2명 작업 중  │                     │
│                                └──────────────────────┘                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │                                                                       │  │
│  │                          [비디오 플레이어]                             │  │
│  │                                                                       │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  타임라인:                                                                  │
│  0        100       200       300       400       500                       │
│  ├─────────┼─────────┼─────────┼─────────┼─────────┤                        │
│            │                   │                                            │
│            ▼ 나 (150프레임)    ▼ 이작가 (320프레임)                         │
│            🔵                  🔴                                           │
│                                                                             │
│  협업 상태 패널 (펼침):                                                     │
│  ┌───────────────────────────────────┐                                      │
│  │ 🟢 실시간 연결 (P2P)               │                                      │
│  │ ┌───────────────────────────────┐ │                                      │
│  │ │ 🔴 이작가                     │ │                                      │
│  │ │    📍 320프레임 • 방금 전     │ │  ← 클릭하면 해당 프레임으로 이동     │
│  │ └───────────────────────────────┘ │                                      │
│  └───────────────────────────────────┘                                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. 결론

| 기능 | 구현 가능? | 권장 |
|------|-----------|------|
| **프레임 위치 공유** | ✅ 매우 간단 | 기본 포함 |
| 타임라인 위치 표시 | ✅ 간단 | 기본 포함 |
| **마우스 커서 공유** | ⚠️ 가능하지만 복잡 | 추후 (Phase 8) |

**프레임 위치 공유**는 P2P 구현하면 거의 추가 비용 없이 가능합니다.
**마우스 커서 공유**는 가능하지만 스로틀링, 렌더링 등 고려 사항이 많아 나중에 추가하는 것을 권장합니다.

---

## 개발/테스트/배포 환경 (중요!)

### 세 가지 환경

| 환경 | 경로 | 실행 방법 | 특이사항 |
|------|------|----------|----------|
| **개발** | `C:\BAEframe\BAEFRAME\` | `npm run dev` | DevTools 자동 열림 |
| **개발 빌드** | `C:\BAEframe\BAEFRAME\dist\win-unpacked\` | `BFRAME_alpha_v2.exe` | 빌드 테스트용 |
| **배포** | `G:\공유 드라이브\...\테스트버전 빌드\` | `BFRAME_alpha_v2.exe` | 팀 전체 사용 |

### 환경별 동작 확인 사항

1. **개발 환경**: mDNS 서비스 등록/발견이 정상 동작하는지
2. **개발 빌드**: 패키징 후에도 P2P 연결이 되는지
3. **배포 환경**: 여러 PC에서 동시에 P2P 연결이 되는지

### P2P 특이사항

- mDNS는 **로컬 네트워크**에서만 동작
- WebRTC는 Electron/Chromium에 **내장**되어 있음
- 추가 서버 **불필요** (같은 LAN이므로 STUN/TURN 불필요)

---

## 핵심 개념: "온라인 게임 방"

### 비유

```
.bframe 파일 열기 = "방 만들기"
같은 .bframe 열기 = "같은 방에 접속"

[김작가가 project_v3.bframe 열었을 때]
  → 자동으로 "방"이 생김
  → 같은 네트워크의 다른 BAEFRAME 앱이 이 "방"을 발견
  → 같은 파일을 열면 자동으로 "입장"
  → P2P로 직접 연결되어 즉시 대화
```

### 현재 vs P2P 후

```
[현재]
김작가 → 파일저장 → Google Drive → 동기화대기 → 이작가
         지연: 3~30초

[P2P 후]
김작가 ←――― P2P 직접 연결 ―――→ 이작가
         지연: < 100ms
```

---

## 현재 시스템 분석

### 현재 협업 관련 파일

| 파일 | 역할 | 줄 수 |
|------|------|-------|
| `collaboration-manager.js` | 협업 관리 (Presence, 동기화) | 828 |
| `review-data-manager.js` | 파일 저장/로드, 머지 | 804 |
| `comment-manager.js` | 댓글 CRUD | 897 |
| `user-settings.js` | 사용자 설정/이름 | 600+ |

### 현재 협업 흐름

```javascript
// collaboration-manager.js 현재 설정값
const PRESENCE_UPDATE_INTERVAL = 10000;   // 10초마다 presence 업데이트
const SYNC_INTERVAL_COLLAB = 5000;        // 협업자 있을 때: 5초
const SYNC_INTERVAL_ACTIVE = 3000;        // 활발한 편집 시: 3초
const PRESENCE_TIMEOUT = 45000;           // 45초 동안 업데이트 없으면 오프라인
```

### 현재 파일 구조

```
project_v3.bframe        ← 댓글, 드로잉 데이터 (본체)
project_v3.bframe.collab ← 누가 파일 열고 있는지 (presence)
```

### 현재 문제점

| 문제 | 원인 | 영향 |
|------|------|------|
| 동기화 느림 | Google Drive 지연 + 폴링 간격 | 3~30초 지연 |
| 세션 끊김 | .collab 파일 경쟁 상태 | "동기화됨" 표시 불안정 |
| 리소스 낭비 | 매번 전체 파일 읽기/쓰기 | I/O 오버헤드 |

---

## P2P 시스템 설계

### 아키텍처

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

### 새로 추가될 모듈

```
renderer/scripts/modules/
├── collaboration-manager.js   (기존 - P2P 통합)
├── lan-discovery.js           (신규 - mDNS 피어 발견)
├── p2p-sync.js               (신규 - WebRTC P2P 동기화)
└── sync-protocol.js          (신규 - 동기화 메시지 프로토콜)
```

### 동기화 전략 흐름

```javascript
// 개선된 흐름
collaborationManager.syncChange(change) {
  // 1. P2P 피어가 있으면 즉시 전송 (< 100ms)
  if (this.p2pSync.hasConnectedPeers()) {
    await this.p2pSync.broadcast(change);
  }

  // 2. Google Drive에도 저장 (백업 + WAN 사용자용)
  await this.reviewDataManager.save();
}
```

---

## Phase 1: P2P 통신용 IPC 핸들러

### 목표

메인 프로세스에서 mDNS 및 네트워크 관련 기능 지원

### 수정 파일

- `main/ipc-handlers.js`
- `preload/preload.js`

### 구현 내용

#### main/ipc-handlers.js

```javascript
// === P2P 관련 IPC 핸들러 ===

// 로컬 IP 주소 가져오기
ipcMain.handle('network:get-local-ip', async () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // IPv4이고 내부 IP가 아닌 경우
      if (net.family === 'IPv4' && !net.internal) {
        return { success: true, ip: net.address };
      }
    }
  }
  return { success: false, error: 'No network interface found' };
});

// 머신 고유 ID 가져오기 (세션 식별용)
ipcMain.handle('network:get-machine-id', async () => {
  const machineId = require('node-machine-id').machineIdSync();
  return { success: true, id: machineId };
});
```

#### preload/preload.js

```javascript
// contextBridge.exposeInMainWorld('electronAPI', { ... })에 추가
getLocalIP: () => ipcRenderer.invoke('network:get-local-ip'),
getMachineId: () => ipcRenderer.invoke('network:get-machine-id'),
```

### 필요한 의존성

```json
{
  "dependencies": {
    "node-machine-id": "^1.1.12"
  }
}
```

---

## Phase 2: mDNS 피어 발견 (lan-discovery.js)

### 목표

같은 네트워크에서 BAEFRAME 앱을 자동으로 발견

### 수정 파일

- `renderer/scripts/modules/lan-discovery.js` (신규)

### 사용할 라이브러리

```json
{
  "dependencies": {
    "bonjour-service": "^1.2.1"
  }
}
```

**왜 bonjour-service?**
- 순수 JavaScript (네이티브 빌드 불필요)
- electron-rebuild 없이 바로 사용 가능
- Windows/Mac/Linux 모두 지원

### 구현 내용

```javascript
// lan-discovery.js
import { Bonjour } from 'bonjour-service';
import { EventEmitter } from './event-emitter.js';
import { createLogger } from '../logger.js';

const log = createLogger('LANDiscovery');

// 상수
const SERVICE_TYPE = 'baeframe';
const SERVICE_PORT = 45678;
const DISCOVERY_TIMEOUT = 30000; // 30초 후 재검색

/**
 * LAN에서 BAEFRAME 피어를 발견하는 클래스
 */
export class LANDiscovery extends EventEmitter {
  constructor() {
    super();
    this.bonjour = null;
    this.service = null;
    this.browser = null;
    this.peers = new Map(); // peerId → peerInfo
    this.sessionId = null;
    this.userName = null;
    this.currentFile = null; // 현재 열고 있는 .bframe 파일 해시
    this.localIP = null;
  }

  /**
   * 서비스 시작
   * @param {string} sessionId - 고유 세션 ID
   * @param {string} userName - 사용자 이름
   * @param {string} fileHash - 현재 열고 있는 파일의 해시
   */
  async start(sessionId, userName, fileHash) {
    try {
      this.sessionId = sessionId;
      this.userName = userName;
      this.currentFile = fileHash;

      // 로컬 IP 가져오기
      const ipResult = await window.electronAPI.getLocalIP();
      if (ipResult.success) {
        this.localIP = ipResult.ip;
      }

      this.bonjour = new Bonjour();

      // 1. 서비스 등록 (내가 여기 있다고 알림)
      await this._advertise();

      // 2. 다른 피어 검색
      this._discover();

      log.info('LAN Discovery 시작됨', { sessionId, userName, fileHash });
      this._emit('started');

    } catch (error) {
      log.error('LAN Discovery 시작 실패', { error: error.message });
      this._emit('error', { error });
    }
  }

  /**
   * 서비스 등록 (mDNS 광고)
   */
  async _advertise() {
    this.service = this.bonjour.publish({
      name: `baeframe-${this.sessionId.substring(0, 8)}`,
      type: SERVICE_TYPE,
      port: SERVICE_PORT,
      txt: {
        sessionId: this.sessionId,
        userName: this.userName,
        fileHash: this.currentFile || '',
        ip: this.localIP || '',
        version: '1.0'
      }
    });

    this.service.on('up', () => {
      log.info('mDNS 서비스 등록됨');
    });

    this.service.on('error', (err) => {
      log.warn('mDNS 서비스 등록 실패', { error: err.message });
    });
  }

  /**
   * 피어 검색 시작
   */
  _discover() {
    this.browser = this.bonjour.find({ type: SERVICE_TYPE });

    this.browser.on('up', (service) => {
      // 자기 자신은 제외
      if (service.txt?.sessionId === this.sessionId) {
        return;
      }

      const peer = {
        id: service.txt?.sessionId,
        name: service.txt?.userName || '알 수 없음',
        fileHash: service.txt?.fileHash || '',
        ip: service.txt?.ip || service.referer?.address,
        port: service.port,
        host: service.host,
        discoveredAt: new Date().toISOString()
      };

      // 같은 파일을 열고 있는 피어만 추가
      if (peer.fileHash && peer.fileHash === this.currentFile) {
        this.peers.set(peer.id, peer);
        log.info('피어 발견 (같은 파일)', { peer: peer.name, file: peer.fileHash });
        this._emit('peer:found', peer);
        this._emit('peers:changed', { peers: this.getPeers() });
      } else {
        log.debug('피어 발견 (다른 파일)', { peer: peer.name, theirFile: peer.fileHash, myFile: this.currentFile });
      }
    });

    this.browser.on('down', (service) => {
      const peerId = service.txt?.sessionId;
      if (peerId && this.peers.has(peerId)) {
        const peer = this.peers.get(peerId);
        this.peers.delete(peerId);
        log.info('피어 오프라인', { peer: peer.name });
        this._emit('peer:lost', peer);
        this._emit('peers:changed', { peers: this.getPeers() });
      }
    });
  }

  /**
   * 현재 파일 해시 업데이트 (다른 파일 열 때)
   */
  updateCurrentFile(fileHash) {
    this.currentFile = fileHash;

    // 서비스 재등록 (TXT 레코드 업데이트)
    if (this.service) {
      this.service.stop();
      this._advertise();
    }

    // 기존 피어 목록 재필터링
    for (const [peerId, peer] of this.peers) {
      if (peer.fileHash !== fileHash) {
        this.peers.delete(peerId);
        this._emit('peer:lost', peer);
      }
    }
    this._emit('peers:changed', { peers: this.getPeers() });
  }

  /**
   * 발견된 피어 목록 반환
   */
  getPeers() {
    return Array.from(this.peers.values());
  }

  /**
   * 특정 피어 정보 가져오기
   */
  getPeer(peerId) {
    return this.peers.get(peerId);
  }

  /**
   * 서비스 중지
   */
  stop() {
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
    this.peers.clear();
    log.info('LAN Discovery 중지됨');
    this._emit('stopped');
  }
}

// 싱글톤 인스턴스
export const lanDiscovery = new LANDiscovery();
```

### 이벤트 목록

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `started` | - | 서비스 시작됨 |
| `stopped` | - | 서비스 중지됨 |
| `peer:found` | `{ peer }` | 새 피어 발견 (같은 파일) |
| `peer:lost` | `{ peer }` | 피어 오프라인 |
| `peers:changed` | `{ peers: [] }` | 피어 목록 변경 |
| `error` | `{ error }` | 오류 발생 |

---

## Phase 3: WebRTC P2P 연결 (p2p-sync.js)

### 목표

발견된 피어와 WebRTC DataChannel로 직접 연결

### 수정 파일

- `renderer/scripts/modules/p2p-sync.js` (신규)

### 구현 내용

```javascript
// p2p-sync.js
import { EventEmitter } from './event-emitter.js';
import { createLogger } from '../logger.js';

const log = createLogger('P2PSync');

// 상수
const SIGNALING_PORT = 45679;
const CONNECTION_TIMEOUT = 10000; // 10초
const HEARTBEAT_INTERVAL = 5000; // 5초

/**
 * WebRTC P2P 동기화 클래스
 */
export class P2PSync extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // peerId → { pc, channel, state }
    this.signalingServer = null;
    this.sessionId = null;
    this.userName = null;
    this.messageHandlers = new Map();
    this.heartbeatTimer = null;
  }

  /**
   * P2P 동기화 시작
   */
  async start(sessionId, userName) {
    this.sessionId = sessionId;
    this.userName = userName;

    // 시그널링 서버 시작 (TCP 소켓)
    await this._startSignalingServer();

    // Heartbeat 시작
    this._startHeartbeat();

    log.info('P2P Sync 시작됨');
    this._emit('started');
  }

  /**
   * 피어와 연결
   */
  async connectToPeer(peer) {
    if (this.connections.has(peer.id)) {
      log.debug('이미 연결된 피어', { peer: peer.name });
      return;
    }

    try {
      log.info('피어 연결 시도', { peer: peer.name, ip: peer.ip });

      // RTCPeerConnection 생성
      const pc = new RTCPeerConnection({
        // LAN에서는 STUN 서버 불필요
        iceServers: []
      });

      // 연결 상태 추적
      const connectionInfo = {
        pc,
        channel: null,
        state: 'connecting',
        peer,
        connectedAt: null
      };
      this.connections.set(peer.id, connectionInfo);

      // ICE 후보 수집
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._sendSignal(peer, {
            type: 'ice-candidate',
            candidate: event.candidate
          });
        }
      };

      // 연결 상태 변경
      pc.onconnectionstatechange = () => {
        log.debug('연결 상태 변경', { peer: peer.name, state: pc.connectionState });
        connectionInfo.state = pc.connectionState;

        if (pc.connectionState === 'connected') {
          connectionInfo.connectedAt = new Date().toISOString();
          this._emit('peer:connected', { peer, connectionType: 'p2p' });
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          this._handleDisconnection(peer.id);
        }
      };

      // 데이터 채널 생성 (Offerer)
      const channel = pc.createDataChannel('baeframe-sync', {
        ordered: true // 순서 보장
      });

      this._setupDataChannel(channel, peer.id);
      connectionInfo.channel = channel;

      // Offer 생성 및 전송
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await this._sendSignal(peer, {
        type: 'offer',
        sdp: pc.localDescription
      });

      // 타임아웃 설정
      setTimeout(() => {
        if (connectionInfo.state === 'connecting') {
          log.warn('연결 타임아웃', { peer: peer.name });
          this._handleDisconnection(peer.id);
        }
      }, CONNECTION_TIMEOUT);

    } catch (error) {
      log.error('피어 연결 실패', { peer: peer.name, error: error.message });
      this._handleDisconnection(peer.id);
    }
  }

  /**
   * 데이터 채널 설정
   */
  _setupDataChannel(channel, peerId) {
    channel.onopen = () => {
      log.info('데이터 채널 열림', { peerId });
      const conn = this.connections.get(peerId);
      if (conn) {
        conn.state = 'connected';
        conn.channel = channel;
      }
      this._emit('channel:open', { peerId });
    };

    channel.onclose = () => {
      log.info('데이터 채널 닫힘', { peerId });
      this._handleDisconnection(peerId);
    };

    channel.onerror = (error) => {
      log.error('데이터 채널 오류', { peerId, error });
    };

    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this._handleMessage(peerId, message);
      } catch (error) {
        log.error('메시지 파싱 오류', { peerId, error: error.message });
      }
    };
  }

  /**
   * 시그널링 메시지 처리 (Answer 수신 시)
   */
  async handleSignal(fromPeerId, signal) {
    const conn = this.connections.get(fromPeerId);

    if (signal.type === 'offer') {
      // Answerer로서 연결 수락
      await this._handleOffer(fromPeerId, signal);
    } else if (signal.type === 'answer') {
      // Answer 수신
      if (conn?.pc) {
        await conn.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      }
    } else if (signal.type === 'ice-candidate') {
      // ICE 후보 추가
      if (conn?.pc) {
        await conn.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  }

  /**
   * Offer 수신 처리 (Answerer)
   */
  async _handleOffer(peerId, signal) {
    const peer = { id: peerId, ...signal.peerInfo };

    const pc = new RTCPeerConnection({
      iceServers: []
    });

    const connectionInfo = {
      pc,
      channel: null,
      state: 'connecting',
      peer,
      connectedAt: null
    };
    this.connections.set(peerId, connectionInfo);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignal(peer, {
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };

    pc.ondatachannel = (event) => {
      this._setupDataChannel(event.channel, peerId);
      connectionInfo.channel = event.channel;
    };

    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await this._sendSignal(peer, {
      type: 'answer',
      sdp: pc.localDescription
    });
  }

  /**
   * 모든 연결된 피어에게 메시지 브로드캐스트
   */
  broadcast(message) {
    const data = JSON.stringify({
      ...message,
      from: this.sessionId,
      timestamp: new Date().toISOString()
    });

    let sentCount = 0;
    for (const [peerId, conn] of this.connections) {
      if (conn.channel?.readyState === 'open') {
        try {
          conn.channel.send(data);
          sentCount++;
        } catch (error) {
          log.error('메시지 전송 실패', { peerId, error: error.message });
        }
      }
    }

    log.debug('브로드캐스트', { type: message.type, sentCount });
    return sentCount;
  }

  /**
   * 특정 피어에게 메시지 전송
   */
  sendTo(peerId, message) {
    const conn = this.connections.get(peerId);
    if (conn?.channel?.readyState === 'open') {
      const data = JSON.stringify({
        ...message,
        from: this.sessionId,
        timestamp: new Date().toISOString()
      });
      conn.channel.send(data);
      return true;
    }
    return false;
  }

  /**
   * 연결된 피어가 있는지 확인
   */
  hasConnectedPeers() {
    for (const conn of this.connections.values()) {
      if (conn.channel?.readyState === 'open') {
        return true;
      }
    }
    return false;
  }

  /**
   * 연결된 피어 목록
   */
  getConnectedPeers() {
    const peers = [];
    for (const conn of this.connections.values()) {
      if (conn.state === 'connected' && conn.peer) {
        peers.push({
          ...conn.peer,
          connectedAt: conn.connectedAt,
          connectionType: 'p2p'
        });
      }
    }
    return peers;
  }

  /**
   * 메시지 핸들러 등록
   */
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  /**
   * 메시지 처리
   */
  _handleMessage(peerId, message) {
    log.debug('메시지 수신', { peerId, type: message.type });

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(peerId, message);
    }

    this._emit('message', { peerId, message });
  }

  /**
   * 연결 해제 처리
   */
  _handleDisconnection(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) {
      if (conn.channel) conn.channel.close();
      if (conn.pc) conn.pc.close();
      this.connections.delete(peerId);

      log.info('피어 연결 해제', { peer: conn.peer?.name });
      this._emit('peer:disconnected', { peer: conn.peer });
    }
  }

  /**
   * Heartbeat (연결 유지)
   */
  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.broadcast({
        type: 'heartbeat',
        userName: this.userName
      });
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * 시그널링 서버 시작 (TCP)
   * 참고: 실제 구현에서는 .collab 파일을 통한 시그널링 또는
   * 간단한 HTTP 서버를 사용할 수 있음
   */
  async _startSignalingServer() {
    // TODO: TCP 시그널링 서버 구현
    // 또는 .collab 파일을 통한 시그널링 폴백
    log.info('시그널링 준비됨');
  }

  /**
   * 시그널링 메시지 전송
   */
  async _sendSignal(peer, signal) {
    // TODO: TCP 또는 .collab 파일을 통한 시그널링
    // 임시: HTTP POST로 전송
    try {
      const response = await fetch(`http://${peer.ip}:${SIGNALING_PORT}/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: this.sessionId,
          peerInfo: { name: this.userName },
          ...signal
        })
      });
      return response.ok;
    } catch (error) {
      log.warn('시그널링 전송 실패, .collab 폴백', { peer: peer.name });
      // TODO: .collab 파일을 통한 폴백 시그널링
      return false;
    }
  }

  /**
   * 정리
   */
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [peerId] of this.connections) {
      this._handleDisconnection(peerId);
    }

    if (this.signalingServer) {
      this.signalingServer.close();
      this.signalingServer = null;
    }

    log.info('P2P Sync 중지됨');
    this._emit('stopped');
  }
}

// 싱글톤 인스턴스
export const p2pSync = new P2PSync();
```

### 이벤트 목록

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `started` | - | 시작됨 |
| `stopped` | - | 중지됨 |
| `peer:connected` | `{ peer, connectionType }` | 피어 연결됨 |
| `peer:disconnected` | `{ peer }` | 피어 연결 해제 |
| `channel:open` | `{ peerId }` | 데이터 채널 열림 |
| `message` | `{ peerId, message }` | 메시지 수신 |

---

## Phase 4: 동기화 프로토콜 (sync-protocol.js)

### 목표

P2P로 주고받을 메시지 타입과 형식 정의

### 수정 파일

- `renderer/scripts/modules/sync-protocol.js` (신규)

### 메시지 타입

```javascript
// sync-protocol.js

/**
 * 동기화 메시지 타입 정의
 */
export const MessageTypes = {
  // === 연결 관련 ===
  HANDSHAKE: 'handshake',         // 초기 연결 시 정보 교환
  HEARTBEAT: 'heartbeat',         // 연결 유지 확인

  // === 댓글 관련 ===
  COMMENT_ADD: 'comment:add',           // 댓글 추가
  COMMENT_UPDATE: 'comment:update',     // 댓글 수정
  COMMENT_DELETE: 'comment:delete',     // 댓글 삭제
  COMMENT_RESOLVE: 'comment:resolve',   // resolved 상태 변경
  REPLY_ADD: 'reply:add',               // 답글 추가
  REPLY_UPDATE: 'reply:update',         // 답글 수정
  REPLY_DELETE: 'reply:delete',         // 답글 삭제

  // === 드로잉 관련 ===
  DRAWING_ADD: 'drawing:add',           // 드로잉 추가
  DRAWING_UPDATE: 'drawing:update',     // 드로잉 수정
  DRAWING_DELETE: 'drawing:delete',     // 드로잉 삭제

  // === Presence 관련 ===
  PRESENCE_UPDATE: 'presence:update',   // 상태 업데이트 (프레임 위치 등)
  PRESENCE_CURSOR: 'presence:cursor',   // 커서 위치 (선택)

  // === 동기화 관련 ===
  SYNC_REQUEST: 'sync:request',         // 전체 동기화 요청
  SYNC_RESPONSE: 'sync:response',       // 전체 동기화 응답
};

/**
 * 메시지 생성 헬퍼
 */
export const createMessage = {
  // 초기 핸드셰이크
  handshake: (fileHash, userName, commentCount, drawingCount) => ({
    type: MessageTypes.HANDSHAKE,
    data: {
      fileHash,
      userName,
      commentCount,
      drawingCount,
      version: '1.0'
    }
  }),

  // 댓글 추가
  commentAdd: (marker) => ({
    type: MessageTypes.COMMENT_ADD,
    data: {
      id: marker.id,
      layerId: marker.layerId,
      frame: marker.frame,
      x: marker.x,
      y: marker.y,
      text: marker.text,
      author: marker.author,
      createdAt: marker.createdAt,
      colorKey: marker.colorKey
    }
  }),

  // 댓글 수정
  commentUpdate: (markerId, changes) => ({
    type: MessageTypes.COMMENT_UPDATE,
    data: {
      id: markerId,
      changes,
      updatedAt: new Date().toISOString()
    }
  }),

  // 댓글 삭제
  commentDelete: (markerId) => ({
    type: MessageTypes.COMMENT_DELETE,
    data: {
      id: markerId,
      deletedAt: new Date().toISOString()
    }
  }),

  // resolved 상태 변경
  commentResolve: (markerId, resolved) => ({
    type: MessageTypes.COMMENT_RESOLVE,
    data: {
      id: markerId,
      resolved,
      updatedAt: new Date().toISOString()
    }
  }),

  // 답글 추가
  replyAdd: (markerId, reply) => ({
    type: MessageTypes.REPLY_ADD,
    data: {
      markerId,
      reply: {
        id: reply.id,
        text: reply.text,
        author: reply.author,
        createdAt: reply.createdAt
      }
    }
  }),

  // Presence 업데이트
  presenceUpdate: (userName, currentFrame, isPlaying) => ({
    type: MessageTypes.PRESENCE_UPDATE,
    data: {
      userName,
      currentFrame,
      isPlaying,
      updatedAt: new Date().toISOString()
    }
  }),

  // 커서 위치 (선택)
  presenceCursor: (userName, x, y, frame) => ({
    type: MessageTypes.PRESENCE_CURSOR,
    data: {
      userName,
      cursor: { x, y },
      frame
    }
  }),

  // 전체 동기화 요청
  syncRequest: () => ({
    type: MessageTypes.SYNC_REQUEST,
    data: {}
  }),

  // 전체 동기화 응답
  syncResponse: (comments, drawings) => ({
    type: MessageTypes.SYNC_RESPONSE,
    data: {
      comments,
      drawings,
      syncedAt: new Date().toISOString()
    }
  })
};

/**
 * 메시지 검증
 */
export const validateMessage = (message) => {
  if (!message || !message.type) {
    return { valid: false, error: 'Missing type' };
  }
  if (!Object.values(MessageTypes).includes(message.type)) {
    return { valid: false, error: 'Unknown type' };
  }
  if (!message.data) {
    return { valid: false, error: 'Missing data' };
  }
  return { valid: true };
};
```

---

## Phase 5: CollaborationManager 통합

### 목표

기존 CollaborationManager에 P2P 동기화 통합

### 수정 파일

- `renderer/scripts/modules/collaboration-manager.js`

### 주요 변경 사항

```javascript
// collaboration-manager.js 수정 부분

import { lanDiscovery } from './lan-discovery.js';
import { p2pSync } from './p2p-sync.js';
import { createMessage, MessageTypes } from './sync-protocol.js';

class CollaborationManager extends EventEmitter {
  constructor() {
    super();
    // ... 기존 코드 ...

    // P2P 관련 추가
    this.p2pEnabled = false;
    this.p2pPeers = new Map(); // P2P 연결된 피어
    this.drivePeers = new Map(); // Drive로만 연결된 피어 (WAN)
  }

  /**
   * 협업 시작 (수정)
   */
  async start(bframePath, userName) {
    // ... 기존 코드 ...

    // P2P 시작
    await this._startP2P(userName);

    // 기존 Drive 동기화도 유지 (폴백용)
    this._startDriveSync();
  }

  /**
   * P2P 시작
   */
  async _startP2P(userName) {
    try {
      // 파일 해시 생성 (같은 파일 식별용)
      const fileHash = await this._getFileHash(this.bframePath);

      // mDNS 시작
      await lanDiscovery.start(this.sessionId, userName, fileHash);

      // P2P Sync 시작
      await p2pSync.start(this.sessionId, userName);

      // 이벤트 연결
      this._setupP2PEvents();

      this.p2pEnabled = true;
      log.info('P2P 협업 시작됨');

    } catch (error) {
      log.warn('P2P 시작 실패, Drive 모드로 동작', { error: error.message });
      this.p2pEnabled = false;
    }
  }

  /**
   * P2P 이벤트 설정
   */
  _setupP2PEvents() {
    // 피어 발견 시 연결 시도
    lanDiscovery.addEventListener('peer:found', async (e) => {
      const peer = e.detail;
      await p2pSync.connectToPeer(peer);
    });

    // 피어 연결됨
    p2pSync.addEventListener('peer:connected', (e) => {
      const { peer } = e.detail;
      this.p2pPeers.set(peer.id, peer);
      this._updateCollaboratorsList();
      this._emit('p2pPeerConnected', { peer });
    });

    // 피어 연결 해제
    p2pSync.addEventListener('peer:disconnected', (e) => {
      const { peer } = e.detail;
      this.p2pPeers.delete(peer.id);
      this._updateCollaboratorsList();
      this._emit('p2pPeerDisconnected', { peer });
    });

    // 메시지 핸들러 등록
    this._setupMessageHandlers();
  }

  /**
   * P2P 메시지 핸들러
   */
  _setupMessageHandlers() {
    // 댓글 추가
    p2pSync.onMessage(MessageTypes.COMMENT_ADD, (peerId, message) => {
      const marker = message.data;
      // 로컬에 추가 (중복 체크)
      if (!commentManager.getMarker(marker.id)) {
        commentManager.addMarkerFromRemote(marker);
        this._emit('remoteCommentAdded', { marker, from: peerId });
      }
    });

    // 댓글 수정
    p2pSync.onMessage(MessageTypes.COMMENT_UPDATE, (peerId, message) => {
      const { id, changes, updatedAt } = message.data;
      commentManager.updateMarkerFromRemote(id, changes, updatedAt);
      this._emit('remoteCommentUpdated', { id, changes, from: peerId });
    });

    // 댓글 삭제
    p2pSync.onMessage(MessageTypes.COMMENT_DELETE, (peerId, message) => {
      const { id } = message.data;
      commentManager.deleteMarkerFromRemote(id);
      this._emit('remoteCommentDeleted', { id, from: peerId });
    });

    // Presence 업데이트
    p2pSync.onMessage(MessageTypes.PRESENCE_UPDATE, (peerId, message) => {
      const { userName, currentFrame, isPlaying } = message.data;
      this._updatePeerPresence(peerId, { userName, currentFrame, isPlaying });
      this._emit('peerPresenceUpdated', { peerId, ...message.data });
    });
  }

  /**
   * 변경 사항 동기화 (수정)
   */
  async syncChange(changeType, data) {
    // 1. P2P로 즉시 전송
    if (this.p2pEnabled && p2pSync.hasConnectedPeers()) {
      let message;
      switch (changeType) {
        case 'comment:add':
          message = createMessage.commentAdd(data);
          break;
        case 'comment:update':
          message = createMessage.commentUpdate(data.id, data.changes);
          break;
        case 'comment:delete':
          message = createMessage.commentDelete(data.id);
          break;
        case 'comment:resolve':
          message = createMessage.commentResolve(data.id, data.resolved);
          break;
        case 'reply:add':
          message = createMessage.replyAdd(data.markerId, data.reply);
          break;
      }

      if (message) {
        const sentCount = p2pSync.broadcast(message);
        log.debug('P2P 브로드캐스트', { type: changeType, sentCount });
      }
    }

    // 2. Drive에도 저장 (백업 + WAN 사용자용)
    await this.reviewDataManager.save();
  }

  /**
   * Presence 업데이트 (프레임 위치 공유)
   */
  updatePresence(currentFrame, isPlaying) {
    if (this.p2pEnabled && p2pSync.hasConnectedPeers()) {
      const message = createMessage.presenceUpdate(this.userName, currentFrame, isPlaying);
      p2pSync.broadcast(message);
    }
  }

  /**
   * 협업자 목록 (P2P + Drive 통합)
   */
  getCollaborators() {
    const collaborators = [];

    // P2P 연결된 피어
    for (const peer of this.p2pPeers.values()) {
      collaborators.push({
        ...peer,
        connectionType: 'p2p',
        status: 'realtime'
      });
    }

    // Drive로만 연결된 피어 (기존 .collab 기반)
    for (const [id, collab] of this.collaborators) {
      if (!this.p2pPeers.has(id)) {
        collaborators.push({
          ...collab,
          connectionType: 'drive',
          status: 'syncing'
        });
      }
    }

    return collaborators;
  }

  /**
   * P2P 연결 상태
   */
  getP2PStatus() {
    return {
      enabled: this.p2pEnabled,
      connectedPeers: p2pSync.getConnectedPeers().length,
      discoveredPeers: lanDiscovery.getPeers().length
    };
  }

  /**
   * 정리
   */
  async stop() {
    // P2P 정리
    lanDiscovery.stop();
    p2pSync.stop();

    // 기존 정리 코드...
  }
}
```

### comment-manager.js 추가 메서드

```javascript
// comment-manager.js에 추가

/**
 * 원격에서 받은 마커 추가 (P2P)
 */
addMarkerFromRemote(markerData) {
  // 중복 체크
  if (this.getMarker(markerData.id)) {
    return false;
  }

  const layer = this._getOrCreateLayer(markerData.layerId);
  const marker = new CommentMarker(markerData);
  layer.markers.push(marker);

  this._emit('markerAdded', { marker, remote: true });
  return true;
}

/**
 * 원격에서 받은 마커 수정 (P2P)
 */
updateMarkerFromRemote(markerId, changes, remoteUpdatedAt) {
  const marker = this.getMarker(markerId);
  if (!marker) return false;

  // 충돌 해결: 더 최신 것 적용
  if (marker.updatedAt && remoteUpdatedAt) {
    if (new Date(marker.updatedAt) > new Date(remoteUpdatedAt)) {
      log.debug('로컬이 더 최신, 원격 변경 무시', { markerId });
      return false;
    }
  }

  Object.assign(marker, changes);
  marker.updatedAt = remoteUpdatedAt;

  this._emit('markerUpdated', { marker, remote: true });
  return true;
}

/**
 * 원격에서 받은 마커 삭제 (P2P)
 */
deleteMarkerFromRemote(markerId) {
  const marker = this.getMarker(markerId);
  if (!marker) return false;

  marker.deleted = true;
  this._emit('markerDeleted', { markerId, remote: true });
  return true;
}
```

---

## Phase 6: 협업 상태 탭 UI

### 목표

협업 상태를 한눈에 볼 수 있는 패널/탭 UI 구현

### 수정 파일

- `renderer/index.html`
- `renderer/styles/main.css`
- `renderer/scripts/app.js`

### UI 디자인

```
┌─────────────────────────────────────────────────────────┐
│  [김] [이] [박]  3명 작업 중  🟢  ← 클릭하면 펼쳐짐      │
└─────────────────────────────────────────────────────────┘
                    ↓ 클릭
┌─────────────────────────────────────────────────────────┐
│  📡 협업 상태                                    [닫기]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  현재 파일: project_v3.bframe                           │
│  내 이름: 김작가                                         │
│                                                         │
│  ───────────────────────────────────────────────────── │
│                                                         │
│  🟢 실시간 연결 (P2P)                                   │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [이] 이작가                                      │   │
│  │     📍 120프레임 • 방금 전 활동                  │   │
│  ├─────────────────────────────────────────────────┤   │
│  │ [박] 박작가                                      │   │
│  │     📍 340프레임 • 30초 전 활동                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  🟡 Drive 동기화                                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [최] 최작가 (재택)                               │   │
│  │     마지막 동기화: 5초 전                         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ───────────────────────────────────────────────────── │
│                                                         │
│  📊 연결 정보                                           │
│     P2P 연결: 2명                                       │
│     Drive 동기화: 1명                                   │
│     발견된 피어: 3명                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### HTML 추가 (index.html)

```html
<!-- 협업 상태 패널 (기존 collaboratorsIndicator 옆 또는 교체) -->
<div class="collab-status-panel" id="collabStatusPanel" style="display: none;">
  <div class="collab-status-header">
    <h3>📡 협업 상태</h3>
    <button class="collab-status-close" id="collabStatusClose">&times;</button>
  </div>

  <div class="collab-status-content">
    <!-- 현재 파일 정보 -->
    <div class="collab-file-info">
      <div class="collab-file-name" id="collabFileName">-</div>
      <div class="collab-user-name">내 이름: <span id="collabMyName">-</span></div>
    </div>

    <div class="collab-divider"></div>

    <!-- P2P 연결 목록 -->
    <div class="collab-section">
      <div class="collab-section-title">
        <span class="collab-status-dot p2p"></span>
        실시간 연결 (P2P)
      </div>
      <div class="collab-peer-list" id="collabP2PPeers">
        <div class="collab-empty">P2P 연결된 사용자 없음</div>
      </div>
    </div>

    <!-- Drive 동기화 목록 -->
    <div class="collab-section">
      <div class="collab-section-title">
        <span class="collab-status-dot drive"></span>
        Drive 동기화
      </div>
      <div class="collab-peer-list" id="collabDrivePeers">
        <div class="collab-empty">Drive 동기화 사용자 없음</div>
      </div>
    </div>

    <div class="collab-divider"></div>

    <!-- 연결 정보 -->
    <div class="collab-stats">
      <div class="collab-stat">
        <span class="collab-stat-label">P2P 연결:</span>
        <span class="collab-stat-value" id="collabP2PCount">0명</span>
      </div>
      <div class="collab-stat">
        <span class="collab-stat-label">Drive 동기화:</span>
        <span class="collab-stat-value" id="collabDriveCount">0명</span>
      </div>
      <div class="collab-stat">
        <span class="collab-stat-label">발견된 피어:</span>
        <span class="collab-stat-value" id="collabDiscoveredCount">0명</span>
      </div>
    </div>
  </div>
</div>
```

### CSS 추가 (main.css)

```css
/* 협업 상태 패널 */
.collab-status-panel {
  position: fixed;
  top: 50px;
  right: 10px;
  width: 320px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
}

.collab-status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
}

.collab-status-header h3 {
  margin: 0;
  font-size: 14px;
}

.collab-status-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 18px;
}

.collab-status-content {
  padding: 16px;
  max-height: 400px;
  overflow-y: auto;
}

.collab-file-info {
  margin-bottom: 12px;
}

.collab-file-name {
  font-weight: bold;
  margin-bottom: 4px;
}

.collab-user-name {
  font-size: 12px;
  color: var(--text-secondary);
}

.collab-divider {
  height: 1px;
  background: var(--border-color);
  margin: 12px 0;
}

.collab-section {
  margin-bottom: 16px;
}

.collab-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: bold;
  margin-bottom: 8px;
  color: var(--text-secondary);
}

.collab-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.collab-status-dot.p2p {
  background: #2ed573;
}

.collab-status-dot.drive {
  background: #ffa502;
}

.collab-peer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.collab-peer-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--bg-tertiary);
  border-radius: 6px;
}

.collab-peer-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  color: white;
}

.collab-peer-info {
  flex: 1;
}

.collab-peer-name {
  font-weight: bold;
  font-size: 13px;
}

.collab-peer-status {
  font-size: 11px;
  color: var(--text-secondary);
}

.collab-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 8px;
}

.collab-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.collab-stat {
  display: flex;
  justify-content: space-between;
}

.collab-stat-label {
  color: var(--text-secondary);
}
```

### JavaScript 추가 (app.js)

```javascript
// app.js에 추가

// === 협업 상태 패널 ===

const collabStatusPanel = document.getElementById('collabStatusPanel');
const collaboratorsIndicator = document.getElementById('collaboratorsIndicator');

// 협업자 표시 클릭 시 패널 토글
collaboratorsIndicator?.addEventListener('click', () => {
  const isVisible = collabStatusPanel.style.display !== 'none';
  collabStatusPanel.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) {
    updateCollabStatusPanel();
  }
});

// 닫기 버튼
document.getElementById('collabStatusClose')?.addEventListener('click', () => {
  collabStatusPanel.style.display = 'none';
});

/**
 * 협업 상태 패널 업데이트
 */
function updateCollabStatusPanel() {
  const collaborators = collaborationManager.getCollaborators();
  const p2pStatus = collaborationManager.getP2PStatus();

  // 파일 정보
  document.getElementById('collabFileName').textContent =
    reviewDataManager.currentBframePath?.split(/[/\\]/).pop() || '-';
  document.getElementById('collabMyName').textContent =
    userSettings.getUserName();

  // P2P 피어 목록
  const p2pPeers = collaborators.filter(c => c.connectionType === 'p2p');
  const p2pList = document.getElementById('collabP2PPeers');

  if (p2pPeers.length === 0) {
    p2pList.innerHTML = '<div class="collab-empty">P2P 연결된 사용자 없음</div>';
  } else {
    p2pList.innerHTML = p2pPeers.map(peer => `
      <div class="collab-peer-item">
        <div class="collab-peer-avatar" style="background: ${getColorForName(peer.name)}">
          ${peer.name.substring(0, 1)}
        </div>
        <div class="collab-peer-info">
          <div class="collab-peer-name">${escapeHtml(peer.name)}</div>
          <div class="collab-peer-status">
            ${peer.currentFrame ? `📍 ${peer.currentFrame}프레임 • ` : ''}
            ${getRelativeTime(peer.lastActivity || peer.connectedAt)}
          </div>
        </div>
      </div>
    `).join('');
  }

  // Drive 피어 목록
  const drivePeers = collaborators.filter(c => c.connectionType === 'drive');
  const driveList = document.getElementById('collabDrivePeers');

  if (drivePeers.length === 0) {
    driveList.innerHTML = '<div class="collab-empty">Drive 동기화 사용자 없음</div>';
  } else {
    driveList.innerHTML = drivePeers.map(peer => `
      <div class="collab-peer-item">
        <div class="collab-peer-avatar" style="background: ${getColorForName(peer.name)}">
          ${peer.name.substring(0, 1)}
        </div>
        <div class="collab-peer-info">
          <div class="collab-peer-name">${escapeHtml(peer.name)}</div>
          <div class="collab-peer-status">
            마지막 동기화: ${getRelativeTime(peer.lastSeen)}
          </div>
        </div>
      </div>
    `).join('');
  }

  // 통계
  document.getElementById('collabP2PCount').textContent = `${p2pPeers.length}명`;
  document.getElementById('collabDriveCount').textContent = `${drivePeers.length}명`;
  document.getElementById('collabDiscoveredCount').textContent = `${p2pStatus.discoveredPeers}명`;
}

// 상대 시간 포맷
function getRelativeTime(timestamp) {
  if (!timestamp) return '알 수 없음';
  const now = new Date();
  const then = new Date(timestamp);
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 5) return '방금 전';
  if (diffSec < 60) return `${diffSec}초 전`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  return `${Math.floor(diffSec / 3600)}시간 전`;
}

// 이름에 따른 색상 (기존 함수 활용)
function getColorForName(name) {
  return userSettings.getColorForName(name) || '#888';
}

// 협업자 변경 시 패널 업데이트
collaborationManager.addEventListener('collaboratorsChanged', () => {
  if (collabStatusPanel.style.display !== 'none') {
    updateCollabStatusPanel();
  }
});

// P2P 상태 변경 시 패널 업데이트
collaborationManager.addEventListener('p2pPeerConnected', () => {
  updateCollabStatusPanel();
});

collaborationManager.addEventListener('p2pPeerDisconnected', () => {
  updateCollabStatusPanel();
});

// Presence 업데이트 시 (프레임 위치)
collaborationManager.addEventListener('peerPresenceUpdated', () => {
  if (collabStatusPanel.style.display !== 'none') {
    updateCollabStatusPanel();
  }
});
```

---

## Phase 7: 테스트

### 환경별 테스트

| 환경 | 테스트 방법 | 확인 사항 |
|------|------------|----------|
| **개발** | `npm run dev` 2개 인스턴스 | mDNS 피어 발견, P2P 연결 |
| **개발 빌드** | `dist/win-unpacked/` 2개 PC | 패키징 후 P2P 동작 |
| **배포** | G드라이브 exe 여러 PC | 팀 환경에서 P2P + Drive 혼합 |

### 기능 테스트 시나리오

1. **피어 발견**
   - 같은 .bframe 파일 열기 → 자동으로 피어 발견
   - 다른 .bframe 파일 열기 → 피어 목록에 안 뜸

2. **P2P 연결**
   - 피어 발견 후 자동 연결
   - 협업 상태 탭에서 "실시간 연결" 표시

3. **댓글 즉시 동기화**
   - A가 댓글 추가 → B 화면에 즉시 표시 (< 1초)
   - B가 댓글 수정 → A 화면에 즉시 반영
   - resolved 상태 변경 → 즉시 반영

4. **Presence (프레임 위치)**
   - A가 프레임 이동 → B의 협업 상태 탭에 표시
   - 재생 중 → "재생 중" 상태 표시

5. **P2P 연결 해제**
   - A가 앱 종료 → B에서 피어 사라짐
   - 네트워크 끊김 → 자동으로 Drive 폴백

6. **하이브리드 (P2P + Drive)**
   - 사무실 2명 (P2P) + 재택 1명 (Drive)
   - 모두 협업 상태 탭에서 보임
   - 연결 타입 구분 표시

7. **Drive 폴백**
   - P2P 연결 실패 시 기존 방식으로 동작
   - "동기화됨" 표시 정상 동작

8. **방화벽 테스트**
   - Windows 방화벽 팝업 → 허용 후 동작
   - 차단 시 → Drive 폴백

### 엣지케이스

- PC 슬립/잠금 → 깨어날 때 재연결
- 앱 강제 종료 → 상대방에서 타임아웃 후 제거
- 동시 댓글 수정 → updatedAt 비교로 충돌 해결
- 네트워크 불안정 → 재연결 시도 + Drive 폴백

---

## 리스크 및 완화 방안

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| mDNS 차단 (기업 네트워크) | 중간 | Drive 폴백으로 기능 보장 |
| WebRTC 연결 실패 | 중간 | 재연결 로직 + Drive 폴백 |
| Windows 방화벽 | 높음 | 사용자 안내 + 허용 시 정상 동작 |
| 코드 복잡도 증가 | 중간 | 모듈 분리로 관리 |
| 테스트 어려움 | 중간 | 상세 로깅 + 시뮬레이터 |
| 시그널링 구현 | 높음 | .collab 파일 기반 폴백 시그널링 |

### 핵심 원칙: "실패해도 현재와 똑같다"

```
P2P 성공 → 빠름 (< 100ms)
P2P 실패 → 현재와 동일 (3~30초, Drive 동기화)

✓ 더 나빠지는 경우는 없음
```

---

## 의존성 추가

### package.json

```json
{
  "dependencies": {
    "bonjour-service": "^1.2.1",
    "node-machine-id": "^1.1.12"
  }
}
```

**참고**:
- `bonjour-service`는 순수 JavaScript (네이티브 빌드 불필요)
- WebRTC는 Electron/Chromium 내장
- `electron-rebuild` 불필요

---

## 참고: 현재 관련 코드 위치

### 핵심 파일

| 파일 | 역할 | 관련 줄 번호 |
|------|------|-------------|
| `collaboration-manager.js` | 협업 관리 | 전체 (828줄) |
| `review-data-manager.js` | 파일 저장/로드 | 전체 (804줄) |
| `comment-manager.js` | 댓글 CRUD | 전체 (897줄) |
| `user-settings.js` | 사용자 설정 | 전체 |
| `main/ipc-handlers.js` | IPC 핸들러 | 209-292 (file watcher) |
| `preload/preload.js` | IPC 브릿지 | 전체 |

### 기존 협업 UI 위치

| 항목 | 파일 | 줄 번호 |
|------|------|---------|
| 협업자 표시 HTML | `renderer/index.html` | 77-89 |
| 협업자 UI JS | `renderer/scripts/app.js` | 5998-6065 |
| 협업자 스타일 | `renderer/styles/main.css` | (collaborators 검색) |

### 기존 협업 이벤트

```javascript
// collaboration-manager.js 이벤트
'collaboratorsChanged'    // 협업자 목록 변경
'collaborationStarted'    // 협업 시작 (다른 사람 발견)
'collaborationEnded'      // 협업 종료 (혼자 남음)
'syncStarted'             // 동기화 시작
'syncCompleted'           // 동기화 완료
'syncError'               // 동기화 오류
```

---

## 구현 순서 요약

```
Phase 1: IPC 핸들러 (네트워크 정보)
   ↓
Phase 2: LANDiscovery (mDNS 피어 발견)
   ↓
Phase 3: P2PSync (WebRTC 연결)
   ↓
Phase 4: SyncProtocol (메시지 타입)
   ↓
Phase 5: CollaborationManager 통합
   ↓
Phase 6: 협업 상태 탭 UI
   ↓
Phase 7: 테스트
```

---

## 요약: 다음 세션에서 참고할 핵심 사항

### 1. 왜 이 기능이 필요한가?
- 현재 협업이 **불안정**하고 **느림** (3~30초 지연)
- 팀은 주로 **같은 사무실 네트워크**에서 협업
- P2P로 **즉시 동기화** (< 100ms) 가능

### 2. 핵심 설계 결정
- **P2P 우선, Drive 폴백**: 같은 네트워크면 P2P, 아니면 기존 방식
- **"방" 개념**: .bframe 파일 열기 = 방 만들기/입장
- **순수 JS 라이브러리**: bonjour-service (네이티브 빌드 불필요)
- **실패해도 현재와 동일**: P2P 실패 시 Drive로 동작

### 3. 세 가지 환경
- 개발 (`npm run dev`): 2개 인스턴스로 테스트
- 개발 빌드 (`dist/win-unpacked/`): 2개 PC에서 테스트
- 배포 (G드라이브): 팀 환경에서 실사용 테스트

### 4. 구현 순서
```
Phase 1: IPC → Phase 2: LANDiscovery → Phase 3: P2PSync
→ Phase 4: Protocol → Phase 5: Integration → Phase 6: UI → Phase 7: Test
```

### 5. 핵심 파일
- `lan-discovery.js` (신규): mDNS 피어 발견
- `p2p-sync.js` (신규): WebRTC P2P 연결
- `sync-protocol.js` (신규): 메시지 프로토콜
- `collaboration-manager.js` (수정): P2P 통합

### 6. 원하는 최종 결과물
- 댓글 즉시 동기화 (< 100ms)
- 협업 상태 탭 (접속자 목록, 연결 상태, 프레임 위치)
- 사용자 이름 표시
- P2P/Drive 연결 타입 구분

### 7. 주의 사항
- Windows 방화벽 팝업 안내 필요
- 시그널링은 .collab 파일 기반 폴백 구현
- 기존 Drive 동기화 로직 유지 (삭제하지 않음)
