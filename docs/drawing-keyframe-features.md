# 드로잉 키프레임 기능 — 단축키·표시·데이터 출처 대조표

> **이 문서의 목적**: mpv(fabric 파일럿) 전환 이후 "예전엔 되던 키프레임 기능이 안 된다"는 문제를 다룰 때, 매번 코드를 다시 뒤지지 않고 **어떤 기능이 어떤 데이터를 보고 왜 안 되는지**를 한 곳에서 확인하기 위한 대조표다.
>
> **작성 기준**: 2026-08-27, v2.4.2-beta (`main`). 상태 열은 실제 코드 확인 결과이며 추정이 아니다.
>
> **핵심 전제 하나**: 드로잉 스택이 두 벌이다(→ `architecture.md` §11). 레거시는 `drawingManager.layers`(루트 `drawings`), 파일럿은 `drawingsV3`다. **mpv 재생 중에는 파일럿이 소유**하고 레거시는 html5 폴백에서만 산다. 아래 문제는 대부분 "기능이 레거시 데이터를 보는데 화면에는 파일럿 데이터가 떠 있다"에서 나온다.

---

## 1. 왜 안 되는가 — 실패 유형은 딱 두 가지다

| 유형 | 증상 | 원인 |
|------|------|------|
| **A. 방화벽 차단** | 키를 눌러도 아무 반응 없음 | `shouldBlockFabricDrawingLegacyShortcut()`(`app.js`)이 파일럿 engaged 상태에서 `FABRIC_DRAWING_LEGACY_SHORTCUTS` 전체를 `preventDefault` + `stopImmediatePropagation` 한다. 레거시 데이터를 잘못 건드리는 것을 막는 의도적 차단이다. |
| **B. 빈 데이터 조회** | 키는 통과하는데 조용히 아무 일도 안 일어남 | 핸들러가 `drawingManager`(레거시)에 물어보는데 mpv 모드에선 거기가 비어 있어 `null`이 돌아온다. 차단이 아니라 **출처가 틀린** 것이다. |

두 유형 모두 `1615fba` "feat: Fabric 드로잉 파일럿 앱 연결"에서 생겼다. 즉 **파일럿을 붙이면서 키프레임 편집을 이식하지 않은 미구현 영역**이지, 이후 라운드의 회귀가 아니다.

---

## 2. 단축키 대조표

액션 id는 `renderer/scripts/modules/user-settings.js`의 기본값이며 사용자가 재지정할 수 있다. **판정은 항상 액션 id로 하고 키 문자열로 하지 말 것.**

### 2.1 키프레임 조작

| 액션 id | 기본 키 | 라벨 | 보는 데이터 | mpv 모드 상태 |
|---|---|---|---|---|
| `keyframeAddWithCopy` | `F6` | 키프레임 추가 (복사) | 레거시 | **A. 차단** |
| `keyframeAddBlank` | `F7` | 빈 키프레임 추가 | 레거시 | **A. 차단** |
| `keyframeAddBlank2` | `2` | 빈 키프레임 삽입 | 레거시 | **A. 차단** |
| `keyframeDelete` | `Delete` | 키프레임 삭제 | 레거시 | **A. 차단** (+ `deleteSelectedOrCurrentKeyframes`가 투영 존재 시 조기 반환) |
| `keyframeConvertToFrame` | `Shift+2` | 키프레임 → 일반 프레임 | 레거시 | **A. 차단** |
| `keyframeConvertToKeyframe` | `Shift+3` | 프레임 → 키프레임 | 레거시 | **A. 차단** |
| `prevKeyframe` | `A` | 이전 키프레임 | **소유자에 따라 분기** | ✅ 동작 (v2.4.3-beta) |
| `nextKeyframe` | `D` | 다음 키프레임 | **소유자에 따라 분기** | ✅ 동작 (v2.4.3-beta) |

### 2.2 프레임 조작

| 액션 id | 기본 키 | 라벨 | mpv 모드 상태 |
|---|---|---|---|
| `insertFrame` | `3` | 프레임 삽입 (홀드) | **A. 차단** |
| `deleteFrame` | `4` | 프레임 삭제 | **A. 차단** |
| `frameCopy` | `Ctrl+Alt+C` | 프레임 복사 | **A. 차단** |
| `framePaste` | `Ctrl+Alt+V` | 프레임 붙여넣기 | **A. 차단** |

### 2.3 드로잉 레이어 조작 — 파일럿에는 레이어 개념 자체가 없다

| 액션 id | 기본 키 | 라벨 | mpv 모드 상태 |
|---|---|---|---|
| `drawingLayerAdd` | `Shift+F1` | 드로잉 레이어 추가 | **A. 차단** |
| `drawingLayerDelete` | ``Shift+` `` | 드로잉 레이어 삭제 | **A. 차단** |
| `drawingLayerVisibilityToggle` | `` ` `` | 활성 레이어 표시 토글 | **A. 차단** |
| `drawingLayerLockToggle` | `Ctrl+2` | 활성 레이어 잠금 토글 | **A. 차단** |
| `drawingLayerSelectUp` / `Down` | `Shift+X` / `Shift+C` | 위/아래 레이어 선택 | **A. 차단** |
| `drawingLayerMoveUp` / `Down` | `Ctrl+Shift+X` / `Ctrl+Shift+C` | 레이어 위/아래 이동 | **A. 차단** |

> 파일럿은 **단일 씬 모델**이다. `drawingsV3`에는 레이어가 없고 키프레임마다 오브젝트 목록만 있다. 레이어 기능을 파일럿에 이식하려면 저장 스키마 확장이 필요하므로 **단순 배선으로는 불가능하다.**

### 2.4 파일럿이 자체 경로로 처리하는 것 (차단 목록에 있지만 예외)

| 액션 id | 기본 키 | 처리 |
|---|---|---|
| `drawMode` | `B` | 방화벽에서 **예외 통과**(engaged 여부 무관). `toggleDrawMode()` → 파일럿 `toggle()` |
| `undo` / `redo` | `Ctrl+Z` / `Ctrl+Y` | 오버레이 포커스면 호스트가 가로채 메인으로 릴레이 → 파일럿 `applyDrawingAction`. 히스토리는 **키프레임(씬)별로 분리** |
| `onionSkinToggle` | `1` | 차단. 파일럿 미구현 |
| `brushSizeDown` / `Up` | `[` / `]` | 차단. 파일럿은 팔레트 슬라이더 + `Alt`+드래그로 조절 |
| `drawingToolSelect` | `V` | 차단. 파일럿은 팔레트 선택 버튼으로 |

---

## 3. 타임라인 표시 대조

### 3.1 레거시 레이어 행 vs 파일럿 투영 행

파일럿 소유 중에는 `getFabricPilotTimelineLayers()`(`app.js`)가 합성 레이어를 만들어 넘긴다. `timeline.js`는 이 객체를 레거시 레이어와 **같은 렌더러**로 그리므로, 공급하지 않은 속성만큼 기능이 빠진다.

| 항목 | 레거시 레이어 | 파일럿 투영 행 |
|---|---|---|
| 행 id | `layer-*` | `fabric-pilot-drawing-layer` |
| 이름 / 색 | 사용자 지정 | `드로잉` / `#4f8ef7`(파랑) |
| 키프레임 마커 | ● 채움 / ○ 빈 키프레임 | **동일하게 렌더됨** (`keyframe.isEmpty` 기준) |
| 홀드 구간 | `getKeyframeRanges()` | **동일** (다음 키프레임 직전까지) |
| 마커 클릭 선택 | 가능 | **가능** (시각 확인용) |
| 마커 드래그 이동 | 가능 | **불가** — `locked: true` + `_isKeyframeLayerMovable` |
| `Delete` 삭제 | 가능 | **불가** — `deleteSelectedOrCurrentKeyframes`가 투영 존재 시 `return false` |
| 눈 / 자물쇠 버튼 | 표시 | **CSS로 숨김** |
| 우클릭 레이어 설정 | 가능 | **핸들러 미등록** |

### 3.2 레거시 `drawings` 데이터의 읽기 전용 투영

과거 레거시로 그린 `drawings`가 있는 `.bframe`을 mpv로 열면, 그 레이어들도 **원래 색·이름 그대로 읽기 전용 행**으로 함께 표시된다(`pilotProjected: true`). 데이터는 보존되며 자동 변환하지 않는다. CSS 마스크에서 `[data-pilot-projected="true"]`로 제외된다.

### 3.3 관련 CSS·선택자

| 대상 | 위치 |
|---|---|
| 마커 | `.keyframe-marker`, `.keyframe-marker-dot`, `.empty` 수식자 |
| 행 | `.drawing-layer-header`, `.drawing-track-row`, `data-layer-id`, `data-pilot-projected` |
| 파일럿 마스크 | `main.css` `body.fabric-drawing-pilot-enabled.mpv-pilot-mode …` |

---

## 4. 이식할 때 지켜야 할 것

1. **액션 id로 판정한다.** 사용자가 키를 재지정하므로 `event.code` 하드코딩 금지. `userSettings.matchShortcut(actionId, event)`를 쓴다.
2. **방화벽 예외는 `matchedAction` 비교로, chord·`KeyE` 차단보다 앞에서** 판정한다(`drawMode` 선례). 뒤에 두면 사용자가 그 액션을 `E`나 Ctrl 조합으로 재지정했을 때 먹히지 않는다.
3. **파일럿 투영 행은 읽기 전용이 기본이다.** 편집을 열려면 `getFabricPilotTimelineLayers()`가 주는 플래그(`locked`, `timelineKeyframesMovable`, `pilotProjected`)와 `deleteSelectedOrCurrentKeyframes`의 조기 반환을 **함께** 풀어야 한다. 한쪽만 풀면 UI는 열리는데 동작이 없다.
4. **저장 스키마는 건드리지 않는 이식부터 한다.** 순서 권장: 조회·이동(A/D) → 삭제 → 추가 → 변환 → (스키마 확장이 필요한) 레이어. 앞의 셋은 `drawingsV3` 기존 구조로 가능하고, 레이어는 포맷 확장이라 별도 라운드다.
5. **`.bframe` 하위 호환 불가침.** `drawingsV3` 레코드는 exact-keys 검증을 3계층(스토어·런타임·호스트)이 각각 수행한다. 필드를 늘리면 구버전 앱이 거부한다.
6. **키프레임 히스토리는 씬(키프레임)별로 분리되어 있다.** `undo/redo`는 활성 씬만 되돌린다. 키프레임이 없는 프레임에서 그리기 시작하면 직전 키프레임 내용을 복사한 **임시(provisional) 씬**이 만들어지고, 첫 변경에서 정식 키프레임이 된다.

---

## 5. 진행 상황

| 항목 | 상태 |
|---|---|
| `prevKeyframe` / `nextKeyframe` (A/D) | ✅ 완료 (v2.4.3-beta) — `getAdjacentDrawingKeyframeFrame()`이 소유자에 맞는 출처를 고른다. 파일럿 소유 중엔 투영 행 전부의 키프레임 합집합, html5 폴백은 기존 `drawingManager` |
| `keyframeDelete` (Delete) | ⬜ 대기 |
| `keyframeAddWithCopy` / `keyframeAddBlank` (F6/F7) | ⬜ 대기 |
| 키프레임↔프레임 변환 (Shift+2/3) | ⬜ 대기 |
| 프레임 삽입·삭제·복사·붙여넣기 (3/4/Ctrl+Alt+C/V) | ⬜ 대기 |
| 드로잉 레이어 전체 | ❌ 보류 — `drawingsV3` 스키마 확장 필요 |
| 어니언 스킨 | ❌ 보류 — 파일럿 미구현 |
| **Ctrl+Z 전역 실행취소** | ⬜ 별도 라운드 필요 — §6 참조 |

---

## 6. Ctrl+Z를 애니메이트처럼 — 요구사항과 현재 구조의 간극

**사용자 요구 (2026-08-27 확정)**: "애니메이트의 Ctrl+Z처럼 **사용자의 동작을 순서대로** 실행취소해야 한다. 프레임 이동 같은 건 실행취소 대상이 아니다."

### 6.1 현재 동작 (실측 확인됨)

- 히스토리는 **키프레임(씬)별로 분리**되어 있다. `scene.history` + `scene.historyEntries = { undo: [], redo: [] }`.
- `undo()` → `moveHistory()` → `activeScene()` = `scenes.get(activeSession.sceneKey)`. **활성 씬 하나만** 되돌린다.
- 결과: 재생헤드가 키프레임에 정확히 있지 않으면 되돌릴 대상 씬이 없어 **아무 반응이 없다.**
- **데이터 손실은 없음** — 사용자 확인 완료(프레임 A에 획 → B에 획 → B에서 Ctrl+Z → A의 획은 그대로 남아 있음).

### 6.2 목표 동작

세션 동안 사용자가 한 **편집 동작**(획 추가·삭제·이동·변형 등)을 **시각 순서 하나의 스택**으로 쌓고, Ctrl+Z가 재생헤드 위치와 무관하게 **가장 최근 동작부터** 되돌린다. **프레임 이동·재생·도구 전환은 스택에 넣지 않는다.**

### 6.3 미확정 설계 결정 (착수 전 사용자 확인 필요)

**되돌린 동작이 다른 키프레임에 있으면 재생헤드를 그리로 옮길 것인가?** 옮기지 않으면 사용자는 화면에서 아무 변화도 못 본다(다른 프레임이 바뀌었으므로). 애니메이트는 옮긴다. 옮긴다면 런타임(오버레이) → 컨트롤러 → app의 `seekToFrame`까지 배선이 필요하다.

### 6.4 규모 — 작은 조각이 아니다

| 근거 | 수치 |
|---|---|
| 런타임에서 씬별 히스토리를 만지는 지점 | 15곳 |
| `undoDepth`를 단언하는 테스트 | 5개 파일 116건 (`mpv-fabric-overlay-runtime.test.js`만 94건) |
| 예산 회계 | `maxHistoryBytes`·`estimateSceneBytes`가 **씬 단위**라 전역 전환 시 재설계 필요 |
| 계층 | 전역 순서 인덱스(런타임) + 재생헤드 이동 시 컨트롤러·app 배선 |

`drawingsV3` 스키마는 건드리지 않는다(히스토리는 런타임 전용, 디스크에 저장되지 않음) — 그 점은 다행이나, **진단 필드(`undoDepth`) 의미가 바뀌면서 테스트가 대량으로 흔들린다.**

**결론**: 단축키 배선 같은 조각과 성격이 다르다. 계획서를 쓰고 별도 라운드로 진행할 것.
