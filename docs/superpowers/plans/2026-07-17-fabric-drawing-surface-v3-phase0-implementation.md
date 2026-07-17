# Fabric Drawing Surface v3 Phase 0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fabric.js 7.4.0 기반의 저장하지 않는 mpv 드로잉 시험판을 BAEFRAME에 opt-in으로 연결하고, 현재 B 토글의 깜빡임·재생 소유권 중복·클릭 선택 시 저장 실패를 구조적으로 피할 수 있는지 실제 앱과 수치로 판정한다.

**Architecture:** 기존 `MPVOverlayHost`의 수명과 passive mirror API는 유지한다. Fabric IIFE를 overlay 문서에 capability로 한 번 주입하고, main renderer의 작은 pilot controller가 세대 토큰을 포함한 IPC만 보낸다. B는 영상 엔진·창·재생 상태를 건드리지 않고 overlay의 mouse input만 전환한다. Phase 0 획은 overlay 메모리에만 존재하며 `.bframe`, `DrawingManager`, `ReviewDataManager`, 협업 경로에는 절대 들어가지 않는다.

**Tech Stack:** Electron 28, Fabric.js 7.4.0, perfect-freehand 1.2.3, esbuild IIFE, Node.js built-in test runner.

**Source of truth:** `docs/superpowers/specs/2026-07-17-fabric-drawing-surface-v3-design.md`

---

### Task 1: Opt-in 플래그와 재현 가능한 Fabric bundle

**Files:**
- Create: `main/experiment-flags.js`
- Create: `scripts/tests/experiment-flags.test.js`
- Modify: `main/index.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Step 1: 플래그 우선순위의 실패 테스트 작성**

`scripts/tests/experiment-flags.test.js`에서 아래 계약을 표 기반으로 검증한다.

```js
const cases = [
  [{ argv: [], env: {} }, false],
  [{ argv: ['--fabric-drawing-pilot'], env: {} }, true],
  [{ argv: [], env: { BAEFRAME_FABRIC_DRAWING_PILOT: '1' } }, true],
  [{ argv: ['--fabric-drawing-pilot'], env: { BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: '1' } }, false],
  [{ argv: [], env: { BAEFRAME_FABRIC_DRAWING_PILOT: '1', BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT: 'true' } }, false]
];
```

또한 결과가 설정 파일에 기록되지 않고, 반환 객체가 `{ enabled, source }` 형태이며 disable이 항상 우선하는지 검증한다.

**Step 2: RED 확인**

Run: `node --test scripts/tests/experiment-flags.test.js`

Expected: `Cannot find module '../../main/experiment-flags'` 또는 구현되지 않은 함수 assertion failure.

**Step 3: 최소 플래그 resolver 구현**

`main/experiment-flags.js`는 부작용 없는 다음 API만 export한다.

```js
function resolveFabricDrawingPilot({ argv = process.argv, env = process.env } = {}) {
  const disabled = argv.includes('--disable-fabric-drawing-pilot') || isTruthy(env.BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT);
  if (disabled) return Object.freeze({ enabled: false, source: 'kill-switch' });
  if (argv.includes('--fabric-drawing-pilot')) return Object.freeze({ enabled: true, source: 'cli' });
  if (isTruthy(env.BAEFRAME_FABRIC_DRAWING_PILOT)) return Object.freeze({ enabled: true, source: 'env' });
  return Object.freeze({ enabled: false, source: 'default' });
}
```

`main/index.js` startup에서 한 번 계산하고 IPC handler 등록에 frozen result를 주입한다. `electron-store`에는 쓰지 않는다.

**Step 4: 의존성 버전 고정**

- `fabric`을 exact `7.4.0` devDependency로 추가한다.
- 기존 `perfect-freehand`는 exact `1.2.3`으로 고정한다.
- runtime source와 bundle script/output은 Task 2에서 한 번에 추가해 중간 commit의 `postinstall`을 깨뜨리지 않는다.

**Step 5: GREEN과 재현성 확인**

Run:

```powershell
node --test scripts/tests/experiment-flags.test.js
npm install --ignore-scripts
```

Expected: 플래그 테스트 통과, exact dependency lock 설치 성공.

**Step 6: 커밋**

```powershell
git add main/experiment-flags.js main/index.js package.json package-lock.json scripts/tests/experiment-flags.test.js
git commit -m "Fabric 드로잉 시험 플래그와 번들 기반 추가"
```

---

### Task 2: 저장 없는 session scene과 Fabric overlay runtime

**Files:**
- Create: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Create: `renderer/scripts/modules/fabric-drawing-pilot-metrics.js`
- Create: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Create: `scripts/tests/fabric-drawing-pilot-session.test.js`
- Create: `scripts/tests/fabric-drawing-pilot-benchmark.test.mjs`
- Modify: `package.json`
- Generate: `renderer/scripts/lib/mpv-fabric-overlay.iife.js`
- Modify: `package-lock.json`

**Step 1: session/token/action의 실패 테스트 작성**

Node에서 runtime의 pure exports를 불러 다음을 먼저 검증한다.

- `stableVideoIdentity + targetFrame`별 scene 분리
- `videoGeneration` 변경 시 이전 session 활성화 거부
- `inputRevision`, `toolRevision` 역행 거부
- 동일 `actionId`의 Delete/Clear 정확히 한 번 적용
- 클릭/사각형 선택만으로 object count와 mutation count가 증가하지 않음
- `enabled:false`가 session보다 먼저 input을 비활성화
- pressure가 없는 입력은 `0.5`, 0~1 범위를 벗어나면 clamp

**Step 2: RED 확인**

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/fabric-drawing-pilot-session.test.js
```

Expected: 새 module 미존재 또는 runtime API assertion failure.

**Step 3: pure session core 구현**

`mpv-fabric-overlay-runtime.js` 안에서 browser 초기화와 분리 가능한 core를 제공한다.

```js
module.exports = {
  createFabricOverlayRuntime,
  createSessionSceneStore,
  normalizePressure,
  createStrokePathData,
  createActionDeduper,
  shouldAcceptInputRequest
};
```

`createSessionSceneStore()`는 저장 I/O 없이 Map을 사용하며, scene key는 JSON 문자열이 아닌 `stableVideoIdentity + '\u0000' + targetFrame`으로 만든다. object mutation은 stroke 추가, selection transform, delete, clear일 때만 metric을 올린다. selection change는 dirty/mutation으로 세지 않는다.

**Step 4: FabricDrawingSurface 구현**

브라우저 runtime은 `window.__mpvFabricOverlay`에 다음 고정 API를 등록한다.

```js
window.__mpvFabricOverlay = {
  prepare,
  setDrawingInput,
  updateDrawingTool,
  applyDrawingAction,
  getDiagnostics,
  destroy
};
```

- `prepare(root)`는 delta canvas와 overlay 내부 toolbar(Brush, V, Delete, Clear, session/frame badge)를 만든다.
- `new fabric.Canvas(canvas, { selection: true, preserveObjectStacking: true })` 한 개만 유지한다.
- Brush pointer samples를 `perfect-freehand.getStroke()`에 넘겨 `fabric.Path`로 확정한다.
- Brush mode는 object 선택을 끄고, V mode는 `isDrawingMode=false`, object `selectable=true`, Fabric drag-selection을 켠다.
- Delete/Clear는 action deduper를 통과한다.
- `pointercancel`, `lostpointercapture`, blur는 진행 중 획만 취소하고 기존 scene은 보존한다.
- 좌표는 `canvasRect`, `sourceWidth`, `sourceHeight`, devicePixelRatio를 사용하되 scene에는 source 좌표를 저장한다.
- overlay toolbar 외의 root는 mode active일 때만 pointer를 받는다.

**Step 5: 정량 metric과 benchmark 구현**

`fabric-drawing-pilot-metrics.js`는 B toggle latency, pointer sample count, long task, object count, duplicate action, save attempt를 누적한다. benchmark는 500/2000개의 `fabric.Path` 생성과 100회의 input toggle을 재고 JSON 한 줄로 출력한다. wall-clock 수치는 환경 정보와 함께 결과 문서에 기록한다.

**Step 6: GREEN 확인 및 bundle 생성**

먼저 `package.json`에 다음 script를 추가하고 `postinstall` 마지막에 연결한다.

```json
"bundle:mpv-fabric-overlay": "esbuild renderer/scripts/modules/mpv-fabric-overlay-runtime.js --bundle --platform=browser --format=iife --target=chrome120 --outfile=renderer/scripts/lib/mpv-fabric-overlay.iife.js --legal-comments=eof"
```

Run:

```powershell
node --test scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/fabric-drawing-pilot-session.test.js
node --test scripts/tests/fabric-drawing-pilot-benchmark.test.mjs
npm run bundle:mpv-fabric-overlay
git diff --exit-code -- renderer/scripts/lib/mpv-fabric-overlay.iife.js
```

Expected: 기능 테스트 통과, benchmark process exit 0, IIFE 안에 Fabric과 perfect-freehand가 self-contained로 포함됨.

**Step 7: 커밋**

```powershell
git add renderer/scripts/modules/mpv-fabric-overlay-runtime.js renderer/scripts/modules/fabric-drawing-pilot-metrics.js renderer/scripts/lib/mpv-fabric-overlay.iife.js scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs package.json package-lock.json
git commit -m "Fabric 오버레이 런타임과 세션 장면 구현"
```

---

### Task 3: MPVOverlayHost capability, IPC, preload 연결

**Files:**
- Modify: `main/mpv-overlay-host.js`
- Modify: `main/ipc-handlers.js`
- Modify: `preload/preload.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `scripts/tests/mpv-runtime-source.test.js`

**Step 1: host 계약의 실패 테스트 작성**

기존 fake BrowserWindow/webContents test harness를 확장해 다음을 검증한다.

- overlay BrowserWindow는 여전히 `focusable:false`, sandbox/contextIsolation on, nodeIntegration off
- passive `ensure()`는 Fabric 주입 실패로 실패하지 않음
- Fabric bundle은 각 `hostGeneration`마다 정확히 한 번만 주입
- `setDrawingInput(false)`는 가장 먼저 `setIgnoreMouseEvents(true)` 호출
- active 성공 시에만 `setIgnoreMouseEvents(false)` 호출
- stale host/video/input/tool token 거부
- 큰 videoGeneration은 disable 요청에서만 수락
- duplicate actionId는 no-op 성공
- `destroy()`가 click-through를 복구하고 generation state를 폐기

IPC source test에는 enable 상태 조회와 drawing input/tool/action/diagnostics 채널, preload bridge 이름을 고정한다.

**Step 2: RED 확인**

Run:

```powershell
node --test scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js
```

Expected: 새 host method와 bridge assertion failure.

**Step 3: capability 주입과 세대 관리 구현**

`MPVOverlayHost`에 아래 public method를 추가한다.

```js
getDrawingCapability()
setDrawingInput(request)
updateDrawingTool(request)
applyDrawingAction(request)
getDrawingDiagnostics()
```

생성자에는 bundle 경로와 file reader를 주입 가능하게 두어 테스트가 실제 파일 시스템에 의존하지 않게 한다. `_ensureWindow()`가 새 BrowserWindow를 만들 때만 `hostGeneration += 1`한다. content load 완료 뒤 bundle source를 execute하고 `window.__mpvFabricOverlay.prepare(document.getElementById('root'))`를 호출한다. passive mirror readiness와 Fabric readiness는 분리한다.

요청 검증 순서는 설계 문서 8장의 계약을 그대로 따른다. 모든 executeJavaScript payload는 JSON 직렬화한 값만 삽입하고 코드 문자열을 renderer 입력으로 만들지 않는다.

**Step 4: IPC와 preload 구현**

아래 채널을 추가한다.

```text
fabric-drawing:get-pilot-state
mpv:set-overlay-drawing-input
mpv:update-overlay-drawing-tool
mpv:apply-overlay-drawing-action
mpv:get-overlay-drawing-diagnostics
```

각 handler는 현재 main window의 `webContents` sender만 허용한다. preload에는 `getFabricDrawingPilotState`, `mpvSetOverlayDrawingInput`, `mpvUpdateOverlayDrawingTool`, `mpvApplyOverlayDrawingAction`, `mpvGetOverlayDrawingDiagnostics`만 노출한다.

**Step 5: GREEN 및 mpv 회귀 확인**

Run:

```powershell
node --test scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js
npm run test:mpv
```

Expected: 새 계약 및 기존 mpv suite 모두 통과.

**Step 6: 커밋**

```powershell
git add main/mpv-overlay-host.js main/ipc-handlers.js preload/preload.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js
git commit -m "mpv 오버레이에 Fabric 입력 통신 연결"
```

---

### Task 4: B/V/Delete UX와 legacy 저장 경로 완전 우회

**Files:**
- Create: `renderer/scripts/modules/fabric-drawing-pilot-controller.js`
- Create: `scripts/tests/fabric-drawing-pilot-shortcuts.test.js`
- Create: `scripts/tests/fabric-drawing-pilot-source.test.js`
- Modify: `renderer/index.html`
- Modify: `renderer/scripts/app.js`
- Modify: `scripts/tests/mpv-runtime-source.test.js`
- Modify: `scripts/tests/hybrid-review-engine-source.test.js`

**Step 1: controller와 app integration 실패 테스트 작성**

controller unit test에서 다음 사용자 흐름을 검증한다.

- pilot OFF/HTML5에서는 모든 key가 legacy로 통과
- mpv + pilot ON에서 B는 `preventDefault/stopImmediatePropagation` 후 direct input toggle 한 번만 호출
- 연속 100회 B 입력에서 session enable/disable이 정확히 50/50이고 load/play/pause 호출 0
- V는 active session의 tool revision만 올림
- Delete는 overlay action만 호출하고 기존 drawing delete/save 호출 0
- input/textarea/contenteditable/modifier key에서는 단축키 무시
- stale enable 응답이 늦게 와도 최신 disabled 상태가 승리
- video generation 변경은 먼저 disable하고 새 generation에서만 재활성화

source test는 pilot active/preparing 동안 기존 `applyDrawModeState`, hybrid swap, freeze capture, DrawingManager mutation, review save, legacy toolbar 클릭이 호출되지 않는 경로를 고정한다.

**Step 2: RED 확인**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-source.test.js
```

Expected: controller 미존재 또는 source contract failure.

**Step 3: controller 구현**

controller public API는 작게 유지한다.

```js
createFabricDrawingPilotController({ electronAPI, getContext, onStateChange, uuid })
// -> initialize(), handleKeydown(event), beforeVideoChange(), afterVideoReady(context), disable(), diagnostics()
```

상태는 `disabled | preparing | active | failed`이며 `videoGeneration`, `inputRevision`, `sessionId`, `toolRevision`을 controller가 소유한다. B 진입 때 `targetFrame`을 한 번 복사하고 이후 playback time을 읽지 않는다. enable 실패 시 legacy draw mode로 자동 전환하지 않고 click-through disable을 재확인한 뒤 failed badge만 남긴다.

**Step 4: app.js 우회 경계 연결**

- startup에서 pilot state를 한 번 읽고 controller를 만든다.
- mpv overlay 준비 완료 이후 capability generation을 controller에 전달한다.
- 가장 앞선 capture keydown listener에서 pilot가 처리한 B/V/Delete를 소비한다.
- pilot active/preparing이면 기존 drawing toolbar와 mirror state를 숨긴다.
- B path에서 `videoPlayer.pause()`, `loadVideo()`, hybrid enter/exit, freeze show/release, BrowserWindow bounds/show/hide를 호출하지 않는다.
- 영상/재생목록 generation이 바뀌면 controller `beforeVideoChange()`를 먼저 호출하고, 준비 성공 후 새 context를 보낸다.
- `saveReviewData()`와 auto-save source에는 pilot scene 참조가 생기지 않는다.
- mpv 성공 토스트 두 문구 호출을 제거하되 실패/폴백 toast는 유지한다.

`renderer/index.html`에는 controller script만 기존 app.js 앞에 추가한다. Pilot toolbar는 overlay runtime 안에 있으므로 main renderer DOM에는 새 toolbar를 만들지 않는다.

**Step 5: GREEN과 핵심 회귀 확인**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/hybrid-review-engine-source.test.js
npm run test:drawing
npm run test:playlist
npm run test:hybrid
```

Expected: 새 pilot tests와 기존 drawing/playlist/hybrid suites 모두 통과.

**Step 6: 커밋**

```powershell
git add renderer/scripts/modules/fabric-drawing-pilot-controller.js renderer/index.html renderer/scripts/app.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/hybrid-review-engine-source.test.js
git commit -m "Fabric 파일럿 단축키와 저장 우회 UX 연결"
```

---

### Task 5: no-save, ownership, timeline, 성능 증거 자동화

**Files:**
- Create: `scripts/tests/fabric-drawing-pilot-integration.test.js`
- Create: `scripts/run-fabric-drawing-pilot-diagnostics.js`
- Create: `DEVLOG/2026-07-17-fabric-drawing-phase0-results.md`
- Modify: `package.json`

**Step 1: 통합 불변식 실패 테스트 작성**

mock electronAPI와 temp `.bframe`을 이용해 아래를 검증한다.

- B/V/선택/이동/Delete/Clear 동안 `saveReview`, `ReviewDataManager.save`, `.bframe` mtime/hash 변경 0
- B 100회 동안 `mpvLoad`, `mpvPlay`, `mpvPause`, `mpvDestroyEmbed`, `mpvDestroyOverlay` 0
- playback owner와 video element instance count가 전후 동일
- timeline duration/current frame/playlist continuous offset가 전후 동일
- videoGeneration N 응답이 N+1 session을 활성화하지 못함

**Step 2: RED 확인**

Run: `node --test scripts/tests/fabric-drawing-pilot-integration.test.js`

Expected: diagnostics runner 또는 필요한 관측 API assertion failure.

**Step 3: 진단 runner와 test hook 구현**

`scripts/run-fabric-drawing-pilot-diagnostics.js`는 앱의 overlay diagnostics JSON을 읽어 다음 필드만 출력/비교한다.

```json
{
  "hostCreateCount": 1,
  "hostGeneration": 1,
  "videoGeneration": 1,
  "inputRevision": 100,
  "sessionId": null,
  "toggleCount": 100,
  "playbackCommandDelta": 0,
  "saveAttemptDelta": 0,
  "timelineMutationDelta": 0,
  "duplicateActionCount": 0
}
```

실제 값은 런타임에서 오며 위 숫자를 하드코딩하지 않는다. exit code는 불변식 위반 시 1이다.

**Step 4: GREEN과 benchmark 기록**

Run:

```powershell
node --test scripts/tests/fabric-drawing-pilot-integration.test.js
node --test scripts/tests/fabric-drawing-pilot-benchmark.test.mjs
```

측정 결과와 PC/Node/Electron 환경을 results 문서의 자동 시험 표에 기록한다.

**Step 5: 커밋**

```powershell
git add scripts/tests/fabric-drawing-pilot-integration.test.js scripts/run-fabric-drawing-pilot-diagnostics.js DEVLOG/2026-07-17-fabric-drawing-phase0-results.md package.json
git commit -m "Fabric 시험판 안정성 진단과 성능 기준 추가"
```

---

### Task 6: 실제 앱 Go/No-Go 시험과 build 검증

**Files:**
- Modify: `DEVLOG/2026-07-17-fabric-drawing-phase0-results.md`

**Step 1: 정적 품질과 전체 지정 회귀 실행**

Run:

```powershell
npm run bundle:mpv-fabric-overlay
node --test scripts/tests/experiment-flags.test.js scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/fabric-drawing-pilot-session.test.js scripts/tests/fabric-drawing-pilot-shortcuts.test.js scripts/tests/fabric-drawing-pilot-source.test.js scripts/tests/fabric-drawing-pilot-integration.test.js scripts/tests/fabric-drawing-pilot-benchmark.test.mjs
npm run test:drawing
npm run test:mpv
npm run test:playlist
npm run test:hybrid
npm run lint
```

Expected: 모두 exit 0. lint에 baseline 문제가 있으면 수정 전/후 동일 파일인지 구분하고 새 파일/수정 라인의 lint 오류는 0이어야 한다.

**Step 2: directory build**

Run: `npm run build`

Expected: `dist/win-unpacked/BAEFRAME.exe` 생성, Fabric IIFE와 mpv/ffmpeg 리소스 포함.

**Step 3: opt-in 실앱 실행과 영상 확인**

Run:

```powershell
$env:BAEFRAME_MPV_PILOT='1'
$env:BAEFRAME_FABRIC_DRAWING_PILOT='1'
npm start -- --multi-instance-profile=fabric-drawing-v3-poc
```

실제 mpv 영상에서 아래 순서로 조작하고 화면 녹화/진단 snapshot을 보존한다.

1. 재생 중 B 100회: pause/load/window recreation, 검은 프레임, 영상 중복, timeline jump가 없어야 함.
2. Brush: 마우스 20획과 가능한 경우 실제 펜 pressure 입력.
3. V 클릭 선택·drag, 빈 영역 사각 선택·ActiveSelection 이동, Delete, Clear.
4. active 상태에서 play/pause, seek bar, timeline, 다음/이전 playlist 항목을 실제 마우스로 조작.
5. playlist 10개 transition 동안 host create count와 playback owner count가 증가하지 않는지 확인.
6. 종료 전후 `.bframe` SHA-256/mtime과 save-attempt counter 비교.
7. kill switch로 재실행해 기존 UI/동작만 남는지 확인.

**Step 4: 녹화 frame 분석**

녹화가 가능하면 ffprobe로 실제 fps/dropped frame을 읽고, 60fps source에서 B 전후 연속 duplicate/black frame 구간을 분석한다. 환경상 60fps 녹화나 펜 장치가 없으면 해당 항목을 `미검증`으로 명시하며 추정으로 통과시키지 않는다.

**Step 5: 결과 문서에 정직한 판정 기록**

`DEVLOG/2026-07-17-fabric-drawing-phase0-results.md`에 각 항목을 `PASS | FAIL | 미검증`으로 기록한다. 단일 overlay host가 active일 때 재생 버튼/seek/timeline/playlist 조작 중 하나라도 막히거나 playback owner/save attempt가 늘면 Phase 0은 No-Go다. 자동 테스트 통과만으로 Go를 선언하지 않는다.

**Step 6: 커밋**

```powershell
git add DEVLOG/2026-07-17-fabric-drawing-phase0-results.md
git commit -m "Fabric 드로잉 시험판 실앱 검증 결과 기록"
```

---

### Task 7: 독립 리뷰와 최종 증거 재실행

**Files:**
- Modify only if review finds an issue: files named in Tasks 1-6
- Modify: `DEVLOG/2026-07-17-fabric-drawing-phase0-results.md`

**Step 1: 전체 branch diff 독립 리뷰**

설계 문서의 Phase 0 경계, 보안, stale token, no-save, playback ownership, one-host No-Go 기준을 기준으로 review한다. 발견 사항은 심각도와 file/line을 포함한다.

**Step 2: 지적을 TDD로 수정**

각 유효 지적은 재현 실패 테스트를 먼저 추가하고 RED를 확인한 뒤 최소 수정, 관련 suite GREEN 순으로 처리한다.

**Step 3: fresh 최종 검증**

Task 6 Step 1/2 명령을 새 프로세스에서 다시 실행하고, 최종 commit/hash, pass/fail count, build artifact path/hash를 results 문서에 기록한다.

**Step 4: 최종 커밋**

```powershell
git add DEVLOG/2026-07-17-fabric-drawing-phase0-results.md
git commit -m "Fabric 드로잉 시험판 최종 검증 보강"
```

Phase 0 완료 보고는 실제 앱 항목 가운데 미검증을 숨기지 않고, `정식 교체 계속 진행`, `Phase 0B 별도 surface 필요`, `현 구조 No-Go` 중 하나로 결론낸다.
