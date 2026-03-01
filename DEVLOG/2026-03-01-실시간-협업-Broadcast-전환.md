# 실시간 협업 동기화: Storage → Broadcast 전환

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | comment-sync.js | Storage → Broadcast 전환 | 높음 | ✅ 완료 |
| Phase 2 | drawing-sync.js | Storage 코드 제거 | 높음 | ✅ 완료 |
| Phase 3 | app.js | 파일 감시 복원, start() 호출 수정 | 높음 | ✅ 완료 |
| Phase 4 | liveblocks-manager.js | 진단 로그 추가 | 중간 | ✅ 완료 |

## 배경 및 목적

### 문제
Liveblocks Storage(CRDT) 기반 동기화가 **처음부터 작동하지 않았음**.
- Presence(커서, 사용자 목록)는 정상 작동
- Storage 구독 콜백이 한 번도 실행되지 않음
- 지금까지 체감된 "동기화"는 전부 Google Drive 파일 감시 기반 (`reloadAndMerge`, ~10초 지연)
- 파일 감시를 비활성화하자 아예 동기화가 안 됨

### 해결 방안
고장난 Storage(CRDT)를 고치는 대신, **이미 작동하는 Broadcast 채널**로 전환.
- Broadcast는 Presence와 동일한 WebSocket 경로 사용 → 신뢰성 높음
- drawing-sync.js가 이미 Broadcast 방식이었으므로, comment-sync.js도 같은 패턴 적용

### 구조 변경

**이전**: CommentManager → CommentSync → Liveblocks Storage (CRDT) → ❌ 실패
**이후**: CommentManager → CommentSync → Liveblocks Broadcast → 상대방 즉시 수신 (~100ms)

.bframe 파일 저장은 기존 auto-save (500ms)가 그대로 담당.
파일 감시(Google Drive)는 Broadcast 놓친 변경을 잡는 **폴백 안전망**으로 유지.

## Phase 1: comment-sync.js 재작성

### 목표
Storage 기반 코드를 전부 제거하고 Broadcast 기반으로 교체

### 제거된 코드
- `_syncToStorage()`, `_findStorageLayer()`, `_findStorageMarker()`, `_findMarkerInList()`
- `_markerToLiveObject()`, `_getLiveTypes()`
- `_uploadLocalToStorage()`, `_loadStorageToLocal()`
- `_applyDelta()`, `_handleListUpdate()`, `_handleObjectUpdate()`, `_handleNodeChange()`
- `_syncStructureFromStorage()`, `_onStorageChanged()`, `_onHighlightsChanged()`
- Storage 구독 (`room.subscribe(commentLayers, ...)`)

### 추가된 코드
- `_onBroadcast()` — Broadcast 수신 후 `COMMENT_*` 타입별 분기 처리
- `_serializeMarker()` — 마커 JSON 직렬화
- 각 이벤트 핸들러가 `broadcastEvent()` 호출

### 재사용
- `CommentManager.applyRemoteMarkerAdd/Update/Delete()` 등 7개 메서드 (이전 세션에서 추가)

## Phase 2: drawing-sync.js 정리

### 제거
- `_uploadMetaToStorage()`, `_updateLayerMeta()`, `_onMetaChanged()`
- `_getLiveTypes()`, `_isSyncingToStorage`
- Storage 구독 (`room.subscribe(drawingMeta, ...)`)
- `_onLayersChanged`, `_onKeyframeAdded` 이벤트 리스너 (Storage 업로드만 했음)

### 유지
- 모든 Broadcast 기반 코드 (STROKE_START/MOVE/END, DRAWING_KEYFRAME_UPDATE 등)
- 원격 스트로크 오버레이 캔버스

## Phase 3: app.js 수정

- `commentSync.start({ uploadLocal: storageEmpty })` → `commentSync.start()` (인자 불필요)
- `liveblocksManager.isConnected` early return 제거 → 파일 감시 항상 활성화

## Phase 4: liveblocks-manager.js 로그

- `broadcastEvent()`: 전송 시 타입 로그
- `subscribe('event', ...)`: 수신 시 타입 로그

## 리스크 및 우려 사항

| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|
| Broadcast도 작동 안 할 수 있음 | 중간 | 진단 로그로 확인, 파일 감시가 폴백 |
| 늦게 접속한 사용자가 이전 Broadcast 못 받음 | 낮음 | .bframe에서 로드 (기존과 동일) |
| 네트워크 끊김 시 Broadcast 유실 | 낮음 | 파일 감시가 10초 후 반영 |

## 테스트 방법

1. 두 인스턴스에서 같은 .bframe 열기
2. 콘솔에서 `Broadcast 전송` / `Broadcast 수신` 로그 확인
3. 한쪽에서 댓글 추가 → 상대방에서 ~1초 이내 표시 확인
4. 한쪽에서 그리기 → 상대방에서 실시간으로 선이 보이는지 확인
5. `npm run lint` 통과 확인 (0 errors, 기존 warnings만 존재)
