# Fabric 수동 검증판 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용 중인 BAEFRAME 인스턴스를 건드리지 않고 별도 프로필로 실행할 Fabric 시험판에, B 입력과 드로잉 상태·재생 소유권·저장/오류 상태를 사용자가 직접 확인할 수 있는 항상 보이는 진단 HUD를 추가한다.

**Architecture:** 기존 `MPVOverlayHost`의 투명 click-through 창에 읽기 전용 HUD를 추가해 mpv 영상 위에서도 passive/active 상태 모두 보이게 한다. 메인 renderer는 기존 controller와 overlay diagnostics를 읽어 제한된 상태 문자열만 보내고, 새 저장 경로는 만들지 않는다. 별도 실행 플래그는 시험판 시작 시 Windows 프로토콜·프로젝트 파일 연결 등록을 생략한다.

**Tech Stack:** Electron, JavaScript, Node test runner, 기존 Fabric pilot controller와 MPV overlay IPC

## Global Constraints

- 기존 프로세스를 종료·재시작·포커스하지 않는다.
- 새 branch/worktree의 `dist`만 빌드하고 고유 `--multi-instance-profile`을 사용한다.
- HUD는 `pointer-events: none`이며 Fabric 입력이나 영상 HUD를 가로막지 않는다.
- 파일 경로, 댓글, 획 좌표, 세션 ID는 HUD나 로그에 표시하지 않는다.
- Fabric pilot가 꺼진 일반 실행에는 HUD를 표시하지 않는다.
- 테스트판 실행은 `--skip-shell-registration`으로 `baeframe://`, `.bframe`, `.bplaylist` 연결을 바꾸지 않는다.

---

### Task 1: 감사 가능한 B 입력 카운터

**Files:**
- Modify: `renderer/scripts/modules/fabric-drawing-pilot-controller.js`
- Test: `scripts/tests/fabric-drawing-pilot-shortcuts.test.js`

**Interfaces:**
- Consumes: 기존 `routeKeydown(event)`, `toggle()`, `localSnapshot()`
- Produces: `getStatusSnapshot()`과 `bInput.{attempted,accepted,rejected,autoRepeatIgnored}`

- [x] **Step 1: 실패 테스트 작성**

  공개 API에 `getStatusSnapshot`이 있고, 유효한 non-repeat B 한 번은 attempted/accepted를 각각 1 올리며 repeat와 IME 입력은 accepted를 올리지 않는다고 단언한다. 실패 응답은 rejected만 올린다.

- [x] **Step 2: RED 확인**

  Run: `node --test scripts/tests/fabric-drawing-pilot-shortcuts.test.js`

  Expected: `getStatusSnapshot` 부재 또는 `bInput` 부재로 FAIL.

- [x] **Step 3: 최소 구현**

  `localSnapshot()`에 다음 읽기 전용 값을 포함하고, B canonical 경계에서 시도 수를 올린 뒤 `toggle()` 결과로 accepted/rejected를 확정한다.

  ```js
  bInput: {
    attempted: bInputAttempted,
    accepted: bInputAccepted,
    rejected: bInputRejected,
    autoRepeatIgnored: bAutoRepeatIgnored
  }
  ```

  상태가 같아도 카운터가 바뀌면 advisory `onStateChange`를 다시 호출하되 입력 처리 결과에는 영향을 주지 않는다.

- [x] **Step 4: GREEN 확인**

  Run: `node --test scripts/tests/fabric-drawing-pilot-shortcuts.test.js`

  Expected: 전체 PASS.

### Task 2: mpv 위 항상 보이는 수동 검증 HUD

**Files:**
- Modify: `main/mpv-overlay-host.js`
- Modify: `renderer/scripts/app.js`
- Test: `scripts/tests/mpv-overlay-host.test.js`
- Test: `scripts/tests/fabric-drawing-pilot-source.test.js`

**Interfaces:**
- Consumes: controller `getStatusSnapshot()`, `diagnostics()`, `videoPlayer.isPlaying/currentFrame`, 실제 재생 중인 `HTMLMediaElement`
- Produces: overlay partial-state field `fabricPilotStatusText`

- [x] **Step 1: 실패 테스트 작성**

  Overlay HTML에 `#fabricPilotStatusMirror`가 항상 존재하고 `pointer-events:none`인지, 상태는 `textContent`로만 반영되는지, `fabricPilotStatusText`는 512자로 제한되며 undefined partial update는 기존 HUD를 보존하는지 단언한다. App source는 상태·B attempted/accepted·revision·PLAY/PAUSE·frame·owner·save/error를 조합하고 최대 250ms 주기로 갱신해야 한다.

- [x] **Step 2: RED 확인**

  Run: `node --test scripts/tests/mpv-overlay-host.test.js scripts/tests/fabric-drawing-pilot-source.test.js`

  Expected: HUD DOM과 상태 필드가 없어 FAIL.

- [x] **Step 3: 최소 구현**

  `OVERLAY_HTML` 우상단에 두 줄 HUD를 추가한다. Main renderer는 pilot가 켜진 경우에만 다음 형태를 보내고, 상태 전환·play/pause/ended는 즉시, 재생 프레임은 250ms 이하 빈도로 갱신한다.

  ```text
  FABRIC TEST · DRAW ACTIVE · B 3/3 · rev 7/7
  PLAY · F 128 · owner 1 (mpv 1/html 0) · save 0 · err 0
  ```

  Overlay는 문자열이 비면 HUD를 숨기고, 값이 있으면 `textContent`로 표시한다.

  진단 요청은 single-flight로 합쳐 느린 응답이 겹치지 않게 하고, 새 요청이 들어오면 이전 응답을 화면에 반영하지 않은 채 최신 trailing refresh 한 번만 실행한다. `owner`는 실제 재생 중인 mpv와 HTML media 개수의 합으로 계산하고, overlay host generation은 `hostGen`으로 분리한다.

- [x] **Step 4: GREEN 확인**

  Run: `node --test scripts/tests/mpv-overlay-host.test.js scripts/tests/fabric-drawing-pilot-source.test.js`

  Expected: 전체 PASS.

### Task 3: 기존 Windows 연결을 보존하는 시험판 실행

**Files:**
- Modify: `main/index.js`
- Test: `scripts/tests/project-file-associations.test.js`

**Interfaces:**
- Consumes: `process.argv`
- Produces: `--skip-shell-registration`

- [x] **Step 1: 실패 테스트 작성**

  Main startup source가 `--skip-shell-registration`일 때 `app.setAsDefaultProtocolClient()`와 `registerProjectFileAssociations()`를 모두 건너뛰는 하나의 조건을 공유한다고 단언한다.

- [x] **Step 2: RED 확인**

  Run: `node --test scripts/tests/project-file-associations.test.js`

  Expected: skip flag 부재로 FAIL.

- [x] **Step 3: 최소 구현**

  ```js
  const skipShellRegistration = process.argv.includes('--skip-shell-registration');
  ```

  프로토콜 등록 블록과 `app.whenReady()`의 프로젝트 파일 연결 등록을 이 조건으로 감싼다. 나머지 실행·파일 열기 라우팅은 그대로 둔다.

- [x] **Step 4: GREEN 확인**

  Run: `node --test scripts/tests/project-file-associations.test.js scripts/tests/instance-policy.test.js`

  Expected: 전체 PASS.

### Task 4: 회귀 검증, 빌드, 별도 실행

**Files:**
- Build output: `dist/win-unpacked`
- Test media: `.superpowers/sdd/fabric-media/fabric-poc-a.bframe`

**Interfaces:**
- Consumes: 새 worktree 실행 파일과 고유 profile
- Produces: 사용자가 조작할 독립 시험 앱

- [ ] **Step 1: 회귀·빌드 검증**

  Run: `npm run test:drawing`, `npm run test:mpv`, `npm run test:playlist`, `npm run build`

  Expected: 모든 명령 exit 0.

- [ ] **Step 2: 기존 PID 스냅샷 보존**

  실행 전 기존 BAEFRAME main PID와 경로를 저장하고 어떤 프로세스에도 Stop/Kill/Close를 호출하지 않는다.

- [ ] **Step 3: 고유 프로필로 시작**

  새 실행 파일에 `--fabric-drawing-pilot`, `--skip-shell-registration`, `--multi-instance-profile=fabric-manual-<timestamp>`와 테스트 `.bframe`을 각각 별도 인자로 전달한다. 자식 환경에서 `BAEFRAME_MPV_PILOT=1`을 설정한다.

- [ ] **Step 4: 런타임 검증**

  새 main PID의 실행 경로·profile 인자와 자식 `--user-data-dir`을 확인하고, 실행 전 기존 main PID가 모두 살아 있는지 다시 확인한다. 실행 전후 `baeframe://`, `.bframe`, `.bplaylist` 레지스트리 값을 읽기 전용으로 비교한다. 새 인스턴스만 foreground로 둔다.
