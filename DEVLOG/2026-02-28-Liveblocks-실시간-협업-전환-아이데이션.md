# Liveblocks 기반 실시간 협업 시스템 전환 아이데이션

> 기존 Google Drive 파일 동기화 → Liveblocks WebSocket 기반 실시간 협업으로 전환

---

## 요약

| Phase | 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|-------|------|----------|------|---------|------|
| Phase 1 | 인프라 & SDK | `package.json`, `liveblocks-client.js`(번들), `liveblocks-config.js`(신규), `liveblocks-manager.js`(신규) | SDK 설치, esbuild 번들링, Public Key 인증, Room 관리 | 높음 | ✅ 완료 |
| Phase 2 | 실시간 Presence & 커서 | `liveblocks-manager.js`, `app.js`, `main.css` | 마우스 커서 공유, 온라인 상태 표시 | 높음 | ✅ 완료 |
| Phase 3 | 댓글 CRDT 동기화 | `comment-sync.js`(신규), `review-data-manager.js` | CRDT 기반 충돌 없는 댓글 동기화 | 높음 | ✅ 완료 |
| Phase 4 | 그리기 브로드캐스트 | `drawing-sync.js`(신규) | 실시간 드로잉 동기화 (Broadcast + Storage 이원화) | 중간 | ✅ 완료 |
| Phase 5 | 로컬 저장 통합 | `review-data-manager.js` | 오프라인 백업, liveblocksRoomId 저장, CRDT 머지 비활성화 | 중간 | ✅ 완료 |
| Phase 6 | 기존 시스템 정리 | `collaboration-manager.js`(삭제), `app.js`, `ipc-handlers.js`, `preload.js` | .collab 파일 기반 코드 제거 | 높음 | ✅ 완료 |
| Phase 7 | 스키마 업데이트 | `shared/schema.js` | liveblocksRoomId 필드 추가 | 중간 | ✅ 완료 |
| Phase 8 | 웹 뷰어 통합 | `web-viewer/scripts/` | 데스크톱-웹 동일 Room 실시간 연동 | 낮음 | ⬜ 대기 (향후) |

---

## 배경 및 목적

### 현재 시스템의 한계

BAEFRAME의 협업 시스템은 2026년 1월에 구현되었으며 (→ `2026-01-15-실시간-협업-동기화-구현-계획.md` 참고), Google Drive 파일 동기화에 전적으로 의존합니다:

| 한계 | 설명 |
|------|------|
| **느린 동기화** | Google Drive 반영까지 3~30초 지연 |
| **폴링 방식** | `.collab` 파일을 10초마다 읽기/쓰기 (I/O 비효율) |
| **커서 공유 불가** | 다른 사용자가 어디를 보고 있는지 알 수 없음 |
| **머지 한계** | 타임스탬프 기반 last-write-wins → 동시 편집 시 데이터 손실 가능 |
| **인터넷 의존** | Drive Desktop 앱이 설치되어 있어야 함 |
| **Presence 불안정** | 45초 타임아웃, 세션이 끊기는 느낌 |

### LAN P2P 계획과의 관계

2026년 1월 27일에 **LAN P2P 협업 시스템**이 계획되었으나 (→ `2026-01-27-LAN-P2P-협업-시스템-구현-계획.md`), 구현되지 않았습니다:
- mDNS 피어 발견 + WebRTC P2P → **같은 네트워크에서만 동작**
- 재택 근무나 외부 작업 시 사용 불가
- STUN/TURN 서버 없이는 NAT 환경에서 연결 실패

**Liveblocks 전환은 LAN P2P 계획을 대체합니다:**
- 네트워크 무관 (인터넷만 있으면 어디서든 협업)
- WebSocket 인프라를 Liveblocks가 관리 (서버 운영 불필요)
- CRDT 기반 충돌 해결이 내장

### 해결하려는 문제

1. **실시간 커서 공유**: 같은 파일을 연 사람들의 마우스 위치가 비디오 위에 보임
2. **즉각적인 동기화**: 댓글/그리기 변경이 50ms 이내에 반영 (3~30초 → 0.05초)
3. **견고한 충돌 해결**: CRDT 기반 자동 머지 (타임스탬프 비교 방식 제거)
4. **사용자 인증**: 로그인한 사용자 간 협업
5. **프레임 위치 공유**: 다른 사용자가 현재 보고 있는 프레임 번호 표시

---

## Liveblocks란?

### 개요

[Liveblocks](https://liveblocks.io/)는 SaaS 형태의 실시간 협업 인프라입니다. WebSocket 서버를 직접 운영할 필요 없이, SDK만 통합하면 다음 기능을 즉시 사용할 수 있습니다:

| 기능 | 설명 | BAEFRAME 적용 |
|------|------|-------------|
| **Presence** | 접속자 목록, 커서 위치, 상태 공유 | 실시간 마우스 커서, 재생헤드 위치 |
| **Storage (CRDT)** | LiveObject, LiveList, LiveMap | 댓글/마커/하이라이트 동기화 |
| **Broadcast** | 일회성 메시지 전파 | 그리기 데이터 전송 |
| **Rooms** | 독립적인 협업 공간 | .bframe 파일 1개 = 1 Room |

### SDK

Liveblocks는 **Vanilla JavaScript SDK** (`@liveblocks/client`)를 제공합니다:
- React 의존성 없음 → Electron 렌더러 프로세스에서 바로 사용 가능
- WebSocket 기반 → Chromium 환경(Electron)에서 네이티브 지원
- TypeScript 지원

```javascript
import { createClient } from '@liveblocks/client';

const client = createClient({
  authEndpoint: '/api/liveblocks-auth', // 우리의 경우 IPC 사용
});
```

### 요금제 (2026년 2월 기준)

| 플랜 | 가격 | MAU | 월간 활성 룸 | 저장소 |
|------|------|-----|-------------|--------|
| **Starter** | 무료 | 100명 | 500개 | 1GB |
| **Pro** | $20/월~ | 1,000명 (+$0.02/추가) | 무제한 | 10GB |

**BAEFRAME 팀 (15명, 동시 1~5명) → Starter(무료) 플랜으로 충분**

> **참고**: "First Day Free" 정책 → 첫 방문 당일은 MAU로 카운트되지 않음. 일회성 방문자가 비용을 올리지 않음.

---

## 현재 시스템 vs Liveblocks 비교

### 동기화 성능

| 항목 | 현재 (Google Drive) | Liveblocks |
|------|-------------------|------------|
| 동기화 지연 | 3~30초 | ~50ms |
| Presence 업데이트 | 10초 폴링 | 즉시 (WebSocket) |
| 오프라인 감지 | 45초 타임아웃 | ~2초 |
| 재연결 | 수동/불안정 | 자동 (큐잉된 변경사항 동기화) |

### 충돌 해결

| 항목 | 현재 | Liveblocks |
|------|------|------------|
| 방식 | 타임스탬프 비교 (last-write-wins) | CRDT (자동 머지) |
| 동시 댓글 편집 | 나중 저장이 덮어씀 | 둘 다 유지 (병합) |
| 동시 댓글 추가 | 머지 시도하지만 누락 가능 | 순서 보장 (LiveList) |
| 편집 잠금 | .collab 파일 기반 (10초 지연) | Presence 기반 (즉시) |

### 인프라 복잡도

| 항목 | 현재 | Liveblocks |
|------|------|------------|
| 서버 | 없음 (P2P 파일) | 없음 (SaaS) |
| 코드 복잡도 | CollabManager 828줄 + ReviewDataManager 머지 로직 | ~300줄 래퍼 + 이벤트 리스너 |
| 의존성 | Google Drive Desktop 앱 | 인터넷 + API 키 |
| 테스트 | 재현 어려움 (Drive 지연 의존) | 로컬에서 즉시 테스트 |

---

## 아키텍처 설계

### 현재 데이터 흐름

```
User Action → Manager → ReviewDataManager → 500ms debounce → save()
                                              ↓
                                    _mergeBeforeSave() (협업자 있을 때)
                                              ↓
                                    electronAPI.saveReview() → Disk
                                              ↓
                                    Google Drive → 3~30초 → 상대방 Disk
                                              ↓
                                    file:watch → reloadAndMerge()
```

### Liveblocks 전환 후 데이터 흐름

```
User Action → Manager → Liveblocks Storage (CRDT) → ~50ms → 상대방 화면
                                   ↓
                           30초마다 로컬 .bframe 스냅샷 저장 (오프라인 백업)
```

### 핵심 변경

```
┌──────────────────────────────────────────────────────────┐
│                   Renderer Process                        │
│                                                           │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │ Comment    │  │  Drawing     │  │  Highlight     │   │
│  │ Manager    │  │  Manager     │  │  Manager       │   │
│  └─────┬──────┘  └──────┬───────┘  └───────┬────────┘   │
│        │                │                   │             │
│  ┌─────▼────────────────▼───────────────────▼──────────┐ │
│  │            LiveblocksManager (신규)                   │ │
│  │                                                       │ │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────────────┐    │ │
│  │  │Presence │  │ Storage  │  │   Broadcast      │    │ │
│  │  │(커서,    │  │ (CRDT)   │  │ (그리기 전송)     │    │ │
│  │  │프레임)   │  │          │  │                  │    │ │
│  │  └─────────┘  └──────────┘  └──────────────────┘    │ │
│  │         ↓            ↓              ↓                │ │
│  │     WebSocket 연결 (@liveblocks/client)              │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                          │                                │
│  ┌───────────────────────▼─────────────────────────────┐ │
│  │  ReviewDataManager (수정)                            │ │
│  │  - 30초마다 Storage → 로컬 .bframe 스냅샷           │ │
│  │  - 앱 종료 시 강제 저장                              │ │
│  │  - 오프라인 시 기존 로컬 모드 유지                   │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
├───────────────────────────────────────────────────────────┤
│                   Main Process                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │  IPC Handlers                                      │  │
│  │  + liveblocks:auth (신규) → 토큰 생성              │  │
│  │  - collab:read/write (제거 대상)                   │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
         │
         ▼
   Liveblocks Cloud (WebSocket)
```

### Room 전략

각 `.bframe` 파일 = 1개 Liveblocks Room:

```javascript
// Room ID는 .bframe 파일에 저장 (크로스 머신 호환)
{
  "bframeVersion": "2.0",
  "liveblocksRoomId": "bframe_a1b2c3d4e5f6",  // 첫 접속 시 자동 생성
  "videoFile": "shot_001.mp4",
  ...
}
```

- **첫 사용자**: Room이 없으면 UUID로 생성, `.bframe`에 저장
- **이후 사용자**: `.bframe`에서 `liveblocksRoomId` 읽어서 접속
- **같은 파일 = 같은 Room**: Google Drive로 `.bframe` 파일이 공유되므로, Room ID도 자동 공유

### 인증 흐름

```
┌─────────────┐     IPC      ┌──────────────────┐
│  Renderer   │ ──────────→  │   Main Process   │
│             │              │                  │
│ "Room 접속  │              │ @liveblocks/node │
│  토큰 줘"   │              │ + Secret Key     │
│             │  ←────────── │                  │
│ JWT 토큰    │   토큰 반환   │ authorize()      │
│ 수신        │              │                  │
│             │              │ Secret Key는     │
│ Room 접속   │              │ electron-store   │
│ 시작        │              │ 에 암호화 저장    │
└─────────────┘              └──────────────────┘
```

- Secret Key는 **메인 프로세스에서만** 사용 (보안)
- Renderer에는 JWT 토큰만 전달
- 사용자 정보 (이름, 색상)는 기존 `AuthManager`에서 가져옴

---

## 데이터 모델 매핑

### 댓글 (CRDT Storage)

```javascript
// Liveblocks Storage 구조
const initialStorage = {
  commentLayers: new LiveList([
    new LiveObject({
      id: 'layer-1',
      name: '기본 레이어',
      visible: true,
      markers: new LiveList([
        new LiveObject({
          id: 'uuid',
          x: 0.5,        // 정규화 좌표
          y: 0.3,
          startFrame: 120,
          endFrame: 180,
          author: '김철수',
          createdAt: '2026-02-28T10:00:00Z',
          updatedAt: '2026-02-28T10:05:00Z',
          text: '이 팔 움직임이 어색해요',
          resolved: false,
          deleted: false,
          replies: new LiveList([
            new LiveObject({
              id: 'reply-uuid',
              author: '배한솔',
              text: '수정했습니다!',
              createdAt: '2026-02-28T10:10:00Z'
            })
          ])
        })
      ])
    })
  ]),

  highlights: new LiveList([
    new LiveObject({
      startFrame: 100,
      endFrame: 200,
      color: '#ffdd59'
    })
  ])
};
```

### 그리기 (Broadcast + 로컬)

그리기 데이터는 Base64 캔버스 이미지로 **수백 KB~수 MB** → CRDT Storage에 부적합

```javascript
// 그리기는 브로드캐스트로 전송
room.broadcastEvent({
  type: 'DRAWING_KEYFRAME_UPDATE',
  layerId: 'drawing-1',
  frame: 100,
  canvasData: 'data:image/png;base64,...'  // 최대 1MB
});

// 수신 측
room.subscribe('event', ({ event }) => {
  if (event.type === 'DRAWING_KEYFRAME_UPDATE') {
    drawingManager.applyRemoteKeyframe(event.layerId, event.frame, event.canvasData);
  }
});
```

> **대용량 처리**: 1MB 초과 시 청크 분할 전송 or 축소 전송 후 로컬에서 전체 데이터 로드

### Presence 데이터

```javascript
// 각 사용자의 실시간 상태
room.updatePresence({
  cursor: { x: 0.5, y: 0.3 },  // 비디오 위 마우스 위치 (정규화)
  currentFrame: 150,            // 현재 재생 프레임
  isDrawing: false,             // 그리기 모드 여부
  isCommentMode: false,         // 댓글 모드 여부
  activeComment: null,          // 편집 중인 댓글 ID (잠금 역할)
  userName: '김철수',
  userColor: '#FF6B6B'
});
```

---

## Phase별 상세 계획

### Phase 1: 인프라 & 인증

**목표**: SDK 설치, Liveblocks 인증 엔드포인트, LiveblocksManager 모듈 생성

**신규 파일**:
- `renderer/scripts/modules/liveblocks-manager.js` — Liveblocks 클라이언트 래퍼
- `main/liveblocks-auth.js` — `@liveblocks/node`로 인증 토큰 생성

**수정 파일**:
- `package.json` — `@liveblocks/client`, `@liveblocks/node` 추가
- `main/ipc-handlers.js` — `liveblocks:auth` IPC 핸들러
- `preload/preload.js` — `liveblocksAuth()` 채널 노출
- `shared/schema.js` — `liveblocksRoomId` 필드 추가

**LiveblocksManager 인터페이스** (CollaborationManager 이벤트와 호환):

```javascript
class LiveblocksManager extends EventTarget {
  // 초기화
  async start(bframePath, userName, userColor) { }
  async stop() { }

  // Presence
  updatePresence(data) { }
  getOthers() { }
  hasOtherCollaborators() { }

  // Room
  getRoom() { }
  getStorage() { }

  // 이벤트: collaboratorsChanged, collaborationStarted,
  //         syncCompleted, connectionStatusChanged
}
```

**예상 리스크**:
- Secret Key가 Electron 빌드에 포함되면 보안 문제 → electron-store 암호화 또는 첫 실행 시 설정 입력 방식

---

### Phase 2: 실시간 Presence & 커서

**목표**: 마우스 커서 공유, 접속자 목록, 프레임 위치 표시

**구현 내용**:

1. **커서 오버레이**:
   - 비디오 영역 위에 투명 레이어 추가
   - 다른 사용자의 커서를 컬러 원 + 이름 태그로 표시
   - `mousemove` → `room.updatePresence({ cursor: { x, y } })` (스로틀 50ms)

2. **타임라인 위치 표시**:
   - 타임라인 위에 다른 사용자의 재생헤드를 작은 마커로 표시
   - `timeupdate` → `room.updatePresence({ currentFrame })` (스로틀 100ms)

3. **접속자 목록 UI**:
   - 기존 `updateCollaboratorsUI()` 수정
   - `room.getOthers()` → 즉시 업데이트 (폴링 제거)

**CSS 추가** (`renderer/styles/app.css`):

```css
.remote-cursor {
  position: absolute;
  pointer-events: none;
  z-index: 9999;
  transition: transform 60ms linear;
}
.remote-cursor-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 2px solid white;
}
.remote-cursor-name {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  color: white;
  white-space: nowrap;
}
```

**대체하는 코드**:
- `CollaborationManager._updatePresence()` (10초 폴링 → 즉시)
- `CollaborationManager._cleanupTimeoutCollaborators()` (45초 타임아웃 → 불필요)
- 모든 `_readCollabFile` / `_writeCollabFile` 호출

---

### Phase 3: 댓글 CRDT 동기화

**목표**: 파일 기반 댓글 머지 → CRDT 기반 실시간 동기화

**신규 파일**: `renderer/scripts/modules/comment-sync.js`

**양방향 동기화 로직**:

```
[로컬 → Liveblocks]
CommentManager 이벤트 (markerAdded, replyAdded, markerUpdated...)
  → comment-sync가 수신
  → Liveblocks Storage에 반영 (LiveList/LiveObject 조작)

[Liveblocks → 로컬]
Liveblocks Storage 변경 구독 (room.subscribe)
  → comment-sync가 수신
  → CommentManager에 반영 (addMarker, updateMarker...)
```

**무한 루프 방지**:

```javascript
// comment-sync.js
let isRemoteUpdate = false;

// Liveblocks → Local
function applyRemoteChange(change) {
  isRemoteUpdate = true;
  commentManager.addMarker(change.data);  // 이벤트 발생하지만...
  isRemoteUpdate = false;
}

// Local → Liveblocks
commentManager.addEventListener('markerAdded', (e) => {
  if (isRemoteUpdate) return;  // Remote에서 온 변경이면 무시
  storage.get('commentLayers')... // Liveblocks에 푸시
});
```

**편집 잠금**:
```javascript
// 기존: .collab 파일에 editing 기록 (10초 지연)
// 신규: Presence에 activeComment 기록 (즉시)
room.updatePresence({ activeComment: markerId });

// 다른 클라이언트에서 확인
const isLocked = room.getOthers()
  .some(user => user.presence.activeComment === markerId);
```

**대체하는 코드**:
- `CollaborationManager.mergeComments()`, `mergeLayers()`
- `ReviewDataManager._mergeBeforeSave()`, `reloadAndMerge()`
- `CollaborationManager.startEditing()`, `stopEditing()`

---

### Phase 4: 그리기 브로드캐스트

**목표**: 그리기 데이터를 Broadcast로 동기화

**왜 CRDT를 안 쓰나?**
- 1개 키프레임 = 100KB~5MB (Base64 캔버스)
- CRDT Storage에 넣으면 모든 클라이언트가 전체 히스토리 유지 → 메모리 폭발
- Broadcast는 "지금 이 순간" 데이터만 전달 → 가벼움

**전략**:

```javascript
// 그리기 완료 시 전송
room.broadcastEvent({
  type: 'DRAWING_UPDATE',
  layerId: 'drawing-1',
  frame: 100,
  objects: [...],           // 벡터 데이터 (가벼움)
  canvasData: '...'         // Base64 (무거움, 선택적)
});
```

**대용량 처리**:
- 1MB 이하: 그대로 전송
- 1MB 초과: 청크 분할 (512KB 단위) 또는 벡터 데이터만 전송

**한계**:
- 브로드캐스트는 "현재 접속 중인 사용자"에게만 전달
- 나중에 접속한 사용자는 로컬 `.bframe` 파일에서 그리기 로드
- → Phase 5의 로컬 저장 통합이 필수

---

### Phase 5: 로컬 저장 통합

**목표**: Liveblocks Storage와 로컬 `.bframe` 파일의 하이브리드 운영

**전략**:

```
온라인 모드:
  - Storage가 진실의 근원 (source of truth)
  - 30초마다 Storage → .bframe 스냅샷 저장
  - 앱 종료 시 강제 저장

오프라인 모드:
  - .bframe 파일이 진실의 근원
  - 기존 로컬 저장 로직 유지
  - 재연결 시 .bframe → Storage 동기화
```

**ReviewDataManager 수정**:

```javascript
async save() {
  if (this.liveblocksManager?.isConnected) {
    // 온라인: Storage에서 데이터 수집 → .bframe에 스냅샷
    const data = this._collectDataFromStorage();
    await this._saveToFile(data);
  } else {
    // 오프라인: 기존 로직 유지
    const data = this._collectData();
    await this._saveToFile(data);
  }
}
```

**하이라이트 동기화**:
- CRDT Storage의 `LiveList("highlights")`로 관리
- 댓글과 동일한 패턴

---

### Phase 6: 웹 뷰어 통합

**목표**: 데스크톱 앱과 웹 뷰어가 같은 Room에서 실시간 연동

**공유 URL**:
```
https://baeframe.vercel.app?v=VIDEO_ID&b=BFRAME_ID&room=bframe_a1b2c3d4
```

**인증**:
- 데스크톱: IPC → Main Process → `@liveblocks/node` (Secret Key)
- 웹 뷰어: Vercel Serverless Function → `@liveblocks/node` (환경 변수)

**기대 효과**:
- 팀원이 웹 뷰어에서 댓글을 달면 → 데스크톱 앱에서 즉시 보임
- 데스크톱에서 그리기하면 → 웹 뷰어에서 실시간 관전 가능

---

### Phase 7: 기존 시스템 정리

**제거 대상**:

| 항목 | 파일 | 설명 |
|------|------|------|
| CollaborationManager | `renderer/scripts/modules/collaboration-manager.js` | 전체 제거 (LiveblocksManager로 대체) |
| .collab IPC | `main/ipc-handlers.js` | `collab:read`, `collab:write` 핸들러 제거 |
| .collab 프리로드 | `preload/preload.js` | `readCollabFile`, `writeCollabFile` 제거 |
| 머지 로직 | `review-data-manager.js` | `_mergeBeforeSave()`, `reloadAndMerge()` 제거 |
| 파일 워처 | `main/ipc-handlers.js` | `file:watch-start` — 오프라인 모드에서만 유지 |
| app.js 콜백 | `renderer/scripts/app.js` | `setRemoteDataLoader()` 관련 코드 제거 |

**코드 감소 예상**:
- CollaborationManager 828줄 제거
- ReviewDataManager 머지 관련 ~200줄 제거
- LiveblocksManager ~300줄 추가
- 순감소: **~700줄**

---

## 리스크 및 완화

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| **인터넷 필수** | 높음 | 오프라인 모드 자동 전환 + 로컬 `.bframe` 백업. 연결 상태 UI 명확히 표시 |
| **Liveblocks 서비스 장애** | 중간 | 로컬 모드 자동 전환. 30초 스냅샷으로 데이터 손실 최소화 |
| **그리기 대용량** | 높음 | CRDT 대신 Broadcast 사용. 1MB 초과 시 청크 분할. 오프라인 사용자는 .bframe에서 로드 |
| **댓글 이미지 첨부 (Base64)** | 중간 | Storage에는 참조(URL)만, 실제 데이터는 로컬 파일에 저장 |
| **Free 티어 초과** | 낮음 | 100 MAU / 500 rooms → 15명 팀은 충분. First Day Free 정책 |
| **Secret Key 보안** | 중간 | 메인 프로세스에서만 사용, electron-store 암호화 저장 |
| **동기화 충돌 (온→오프→온)** | 중간 | 재연결 시 타임스탬프 비교 후 최신 데이터 우선 적용 |
| **기존 .bframe 호환성** | 낮음 | `liveblocksRoomId` 필드만 추가 (기존 필드 변경 없음) |

---

## 테스트 방법

### 기능 테스트

| 테스트 항목 | 방법 | 기대 결과 |
|------------|------|----------|
| Presence 연결 | 2대 PC에서 같은 .bframe 열기 | 양쪽에 상대방 아이콘 표시 |
| 커서 공유 | 비디오 위에서 마우스 이동 | 상대방 화면에 커서 점 + 이름 표시 |
| 댓글 동기화 | 한쪽에서 댓글 추가 | 1초 이내 상대방에 마커 표시 |
| 답글 동기화 | 한쪽에서 답글 작성 | 상대방 댓글 팝업에 즉시 추가 |
| 동시 댓글 추가 | 양쪽에서 동시에 댓글 달기 | 두 댓글 모두 유지 (CRDT 자동 머지) |
| 편집 잠금 | 한쪽에서 댓글 편집 시작 | 상대방은 "편집 중" 표시, 편집 불가 |
| 그리기 전송 | 한쪽에서 그리기 완료 | 상대방 캔버스에 반영 |
| 오프라인 전환 | 인터넷 끊기 | 로컬 모드 자동 전환, 정상 작동 |
| 재연결 | 인터넷 복구 | 자동 재연결, 변경사항 동기화 |

### 성능 테스트

- 50개+ 댓글 파일로 동기화 테스트
- 3명+ 동시 접속 시 지연 측정 (< 200ms 목표)
- 그리기 브로드캐스트 지연 측정

---

## 필요 결정 사항

### 구현 전 결정 필요

| 결정 | 선택지 | 추천 |
|------|--------|------|
| **Secret Key 관리** | 환경 변수 / electron-store / 첫 실행 시 입력 | electron-store 암호화 |
| **오프라인 모드 전략** | 완전 자동 전환 / 사용자 선택 / 비활성화 | 자동 전환 |
| **웹 뷰어 포함** | Phase 6 포함 / 별도 프로젝트 / 제외 | 데스크톱 안정화 후 별도 진행 |
| **LAN P2P 계획 폐기** | Liveblocks로 대체 / 두 시스템 병행 | Liveblocks로 대체 (더 간단) |
| **그리기 큰 파일** | 브로드캐스트만 / 외부 스토리지(S3) / 압축 | 브로드캐스트 + 압축 |

---

## 구현 일정 (예상)

| Phase | 작업 | 난이도 |
|-------|------|--------|
| Phase 1 | 인프라 & 인증 | ★★☆ |
| Phase 2 | Presence & 커서 | ★★☆ |
| Phase 3 | 댓글 CRDT | ★★★ |
| Phase 4 | 그리기 브로드캐스트 | ★★☆ |
| Phase 5 | 로컬 저장 통합 | ★★★ |
| Phase 6 | 웹 뷰어 | ★★☆ |
| Phase 7 | 정리 | ★☆☆ |

> Phase 1~3을 먼저 구현하면 핵심 가치(커서 공유 + 실시간 댓글)를 체감할 수 있습니다.
> Phase 4~7은 이후 안정화하면서 점진적으로 진행합니다.

---

## 참고 자료

- [Liveblocks 공식 사이트](https://liveblocks.io/)
- [Liveblocks JavaScript 시작 가이드](https://liveblocks.io/docs/get-started/javascript)
- [Liveblocks Client API](https://liveblocks.io/docs/api-reference/liveblocks-client)
- [Liveblocks 요금제](https://liveblocks.io/pricing)
- [Liveblocks GitHub](https://github.com/liveblocks/liveblocks)
- [Liveblocks Yjs 통합](https://liveblocks.io/blog/introducing-liveblocks-yjs)
- [기존 협업 구현 계획](./2026-01-15-실시간-협업-동기화-구현-계획.md)
- [LAN P2P 협업 계획 (대체 대상)](./2026-01-27-LAN-P2P-협업-시스템-구현-계획.md)
