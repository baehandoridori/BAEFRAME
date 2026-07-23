# mpv + Fabric 드로잉 안정화 채널 승격 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증한 mpv + Fabric 드로잉과 `drawingsV3` 저장을 정식 BAEFRAME 배포본의 기본 엔진으로 승격한다.

**Architecture:** 정식 패키지에는 `fabric-v3-stable` runtime marker를 넣고 시험 패키지는 기존 `fabric-v3-trial` marker를 유지한다. 기능 resolver는 kill switch를 최우선으로 처리한 뒤 두 marker를 검증해 기능을 켠다. 정식 marker는 기존 userData와 Windows 파일연결을 사용한다. `.bframe` 저장은 process 내부 queue, 원자 recovery slot, same-directory candidate/rollback, Win32 SHA-256 CAS와 교체 backup 검증, post-verify/rollback으로 처리한다.

**Tech Stack:** Electron, Node.js, electron-builder hooks, node:test, Fabric.js, mpv JSON IPC, .NET Framework Win32 P/Invoke helper

## Global Constraints

- 기존 `drawings`와 알 수 없는 `.bframe` 최상위 필드는 byte-equivalent 의미로 보존한다.
- 정식 채널은 `isolateUserData=false`, `skipShellRegistration=false`다.
- 시험 채널은 `isolateUserData=true`, `skipShellRegistration=true`를 유지한다.
- kill switch는 모든 runtime marker보다 우선한다.
- 같은 PC의 여러 BAEFRAME process는 한 `.bframe` 저장을 동시에 commit할 수 없다.
- 잠금 시간 초과와 일시적 파일 점유는 version conflict로 승격하지 않는다.
- 다른 PC의 Google Drive 동시 편집은 이번 beta 보장 범위가 아니다.
- 현재 main checkout의 미추적 문서는 수정하거나 커밋하지 않는다.

---

### Task 1: 안정화 runtime profile 계약

**Files:**
- Modify: `main/runtime-profile.js`
- Modify: `main/experiment-flags.js`
- Modify: `scripts/electron-builder-after-pack.js`
- Modify: `scripts/tests/runtime-profile.test.js`
- Modify: `scripts/tests/experiment-flags.test.js`

**Interfaces:**
- Consumes: `loadRuntimeProfile({ isPackaged, resourcesPath, fsModule })`
- Produces: `STABLE_RUNTIME_PROFILE_MARKER`, `fabric-v3-stable` profile resolution

- [x] **Step 1: 정식 marker 테스트를 먼저 작성한다**

```js
test('normal packaged build writes the stable Fabric profile', async (t) => {
  const resourcesDir = t.mock.fn();
  const result = reconcileRuntimeProfileMarker({
    resourcesDir: tempResources,
    env: {}
  });
  assert.equal(result.status, 'written');
  assert.equal(
    JSON.parse(fs.readFileSync(result.markerPath, 'utf8')).channel,
    'fabric-v3-stable'
  );
});
```

- [x] **Step 2: 테스트가 기존 `absent` 동작 때문에 실패하는지 확인한다**

Run: `node --test scripts/tests/runtime-profile.test.js scripts/tests/experiment-flags.test.js`

Expected: normal build marker assertion FAIL

- [x] **Step 3: 안정화 marker와 strict profile 검증을 구현한다**

`main/runtime-profile.js`에 stable channel과 marker를 추가하고, 두 marker 모두 exact-key,
size-limit, deeply-frozen 계약을 통과해야 활성화되게 한다.

- [x] **Step 4: 일반 build는 stable, trial build는 trial marker를 원자적으로 쓰게 한다**

`scripts/electron-builder-after-pack.js`에서 환경값이 `fabric-v3-trial`이면 trial marker,
그 외에는 stable marker를 선택한다. 기존 marker와 임시 marker 제거 후 `wx` temp write와
rename 순서는 유지한다.

- [x] **Step 5: focused 테스트를 통과시킨다**

Run: `node --test scripts/tests/runtime-profile.test.js scripts/tests/experiment-flags.test.js`

Expected: PASS, 0 fail

- [x] **Step 6: 커밋한다**

```text
feat: mpv와 Fabric을 정식 안정화 채널로 승격
```

### Task 2: 정식 실행 정책과 회귀 고정

**Files:**
- Modify: `scripts/tests/instance-policy.test.js`
- Modify: `scripts/tests/project-file-associations.test.js`
- Modify: `scripts/tests/mpv-runtime-provision.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: stable runtime profile from Task 1
- Produces: normal userData, shell registration, release version metadata

- [x] **Step 1: stable profile 실행 정책 테스트를 추가한다**

```js
test('stable Fabric profile uses normal single-instance user data', () => {
  assert.equal(shouldAllowMultipleInstances({
    runtimeProfile: stableRuntimeProfile()
  }), false);
  assert.equal(resolveMultiInstanceUserDataPath({
    runtimeProfile: stableRuntimeProfile()
  }), null);
});
```

- [x] **Step 2: 정식 marker가 shell registration을 건너뛰지 않는 source test를 추가한다**

Run: `node --test scripts/tests/instance-policy.test.js scripts/tests/project-file-associations.test.js`

Expected: 새 stable assertions가 구현 전 FAIL

- [x] **Step 3: runtime profile 조건을 trial-only로 유지해 stable 실행 정책을 구현한다**

`main/instance-policy.js`와 `main/index.js`는 `fabric-v3-trial`만 격리 대상으로 취급한다.
stable profile은 기존 단일 인스턴스와 shell registration 경로를 사용한다.

- [x] **Step 4: semantic release version을 반영한다**

기본 재생·드로잉 엔진 교체이므로 package version을 `2.0.0-beta`로 올리고 lockfile의 root
version을 동일하게 맞춘다.

- [x] **Step 5: 정식·시험 빌드 명령을 외부 환경과 출력 경로에서 분리한다**

일반 build와 installer는 `BAEFRAME_RUNTIME_PROFILE=fabric-v3-stable`을 명시한다.
trial build는 `fabric-v3-trial`을 명시하고 `dist-trial`에 출력해 오래된 시험 marker가
정식 `dist`에 남는 경로를 차단한다.

- [x] **Step 6: focused 테스트를 통과시킨다**

Run: `node --test scripts/tests/instance-policy.test.js scripts/tests/project-file-associations.test.js scripts/tests/mpv-runtime-provision.test.js`

Expected: PASS, 0 fail

- [x] **Step 7: 커밋한다**

```text
chore: 안정화 배포 버전을 2.0.0 beta로 갱신
```

### Task 3: 여러 앱 process의 안전 저장

**Files:**
- Add: `main/review-file-store.js`
- Modify: `main/ipc-handlers.js`
- Modify: `renderer/scripts/modules/review-data-manager.js`
- Modify: `main/mpv-overlay-host.js`
- Modify: `preload/preload.js`
- Add: `renderer/scripts/modules/mpv-overlay-keyboard-relay.js`
- Add: `scripts/tests/review-file-store-contract.test.js`
- Add: `scripts/tests/review-file-store-cross-process.test.js`
- Add: `scripts/tests/fixtures/review-file-save-worker.js`
- Add: `scripts/diagnostics/review-file-store-gdrive-stress.js`
- Add: `scripts/tests/review-file-store-recovery.test.js`
- Add: `native/review-file-cas-helper/ReviewFileCasHelper.cs`
- Add: `scripts/build-review-file-cas-helper.js`
- Modify: `electron-builder.yml`
- Modify: `scripts/electron-builder-before-pack.js`
- Modify: `scripts/tests/review-save-version-token-source.test.js`
- Modify: `scripts/tests/lazy-bframe-creation-source.test.js`
- Modify: `scripts/tests/review-data-manager-save.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Add: `scripts/tests/mpv-overlay-keyboard-relay.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `expectedVersionToken`, `failIfExists`
- Produces: success, stale conflict, exists, retryable lock/target busy

- [x] **Step 1: 실제 두 Node process에서 기존 double-success를 재현한다**

Expected before fix: 같은 token으로 두 process 모두 `success: true`, 마지막 데이터만 남음

- [x] **Step 2: 저장 모듈 계약 테스트를 먼저 추가해 RED를 확인한다**

Run: `node --test --test-concurrency=1 scripts/tests/review-file-store-contract.test.js`

Expected before implementation: `MODULE_NOT_FOUND: main/review-file-store.js`

- [x] **Step 3: recovery journal과 Win32 handle CAS 저장을 구현한다**

대상 또는 부모 폴더의 실제 경로를 확인해 같은 파일의 대소문자·junction 별칭만 하나의
파일 정체성으로 통일하고 process 조정 key를 만든다. 경로를 소문자화하거나 Unicode
정규화하지 않아 NTFS가 실제로 구별하는 이름은 별도 거래로 유지한다. 그 뒤
candidate·sidecar·rollback을 flush·재검증한다.
sidecar는 고유 temp에서 완성한 뒤 원자 게시한다. native helper가
target 쓰기를 막은 handle에서 expected SHA-256을 확인하고 `ReplaceFileW`로 교체한다.
교체 시 밀려난 실제 target backup의 해시까지 확인해, 확인 이후 들어온 외부 버전은
복원하고 conflict로 끝낸다. 성공은 post-read hash가 일치할 때만 반환한다.
중단된 임시파일 정리는 PID·v4 UUID·허용 suffix 전체 형식이 일치하고 소유 process가
끝난 파일에만 적용해, 접두사가 비슷한 정상 이웃 파일은 보존한다.

- [x] **Step 4: 일시적 잠금 실패를 일반 저장 오류와 분리한다**

`lock-timeout`과 `target-busy`는 dirty를 유지하고 자동 저장을 다시 예약한다.
`saveError` 이벤트는 발생시키지 않는다.

- [x] **Step 5: 일반 review collection을 기준점 기반 3-way merge로 저장한다**

로드 시 받은 review subset을 공통 기준점으로 보관한다. 댓글 layer/marker, 구형 drawing
layer, highlight, composition layer, manual version을 ID 기반으로 local·latest root와
비교해 로컬 삭제와 외부 추가를 모두 유지한다. 양쪽 변경 충돌은 결정적 conflict copy로
보존하고 재시도 시 중복을 만들지 않는다. `drawingsV3`의 기존 fail-closed 경계는 별도로
유지한다. 저장 직전 legacy root를 다시 migration하고 manager가 실제로 수용한 canonical
subset을 기준으로 삼는다. marker 안의 reply, 배열형 highlight, 원격 레이어 순서,
`versionInfo`·`liveblocksRoomId` scalar도 같은 3-way 계약에 포함한다.

- [x] **Step 5a: 영상 전환 취소와 supersede 경합을 복구한다**

이전 리뷰의 저장 결정을 마친 뒤에만 Fabric 입력을 차단한다. 파괴적 미디어 교체 전
전환이 취소되거나 더 최신 load에 밀리면 token-fenced rollback으로 기존 영상 context를
다시 hydrate하고 fresh session을 연다. 각 전환은 앞선 in-flight 상태를 신뢰하지 않고
자신의 새 disable revision을 승인받는다. 입력 fence 뒤 마지막 snapshot pull·pending save·
dirty save를 마친 다음 파괴 경계를 확정하고, 파일 감시와 협업 teardown은 그 경계 안에서
수행한다. 파괴적 교체 뒤에는 기존 fail-closed 정리를 쓴다.

- [x] **Step 5b: 사용자 단축키와 일시적 입력 실패를 복구한다**

Fabric controller가 `drawMode`와 `drawingToolSelect`의 사용자 설정 matcher를 사용한다.
일시적 enable 거절 뒤의 다음 B는 새로운 session으로 재시도하며, IME·편집 입력·반복
키 보호는 유지한다.

- [x] **Step 5c: mpv overlay의 물리 키를 정식 renderer 단축키로 전달한다**

overlay host와 preload가 `type`·`key`·`code`·modifier·`repeat`의 고정 8필드만
검증해 전달한다. renderer는 활성 입력 요소에 합성 키 이벤트를 보내 사용자 설정
단축키를 그대로 사용하고, IME·Dead·Process·malformed 입력은 차단한다. 이 경로는
BAEFRAME 단축키 전달용이며 브라우저 자체 Tab 포커스 이동·Enter 기본 클릭까지
모사하지 않는다.

- [x] **Step 6: Windows 변환 도구 누락을 패키징 전에 차단한다**

beforePack에서 `ffmpeg.exe`, `ffprobe.exe`의 존재·일반 파일·0 byte 초과를 검증한다.

- [x] **Step 7: process·crash·rename 테스트를 통과시킨다**

Run:

```text
node --test --test-concurrency=1 scripts/tests/review-file-store-contract.test.js scripts/tests/review-file-store-cross-process.test.js
```

Expected: native helper/contract/cross-process/recovery 전부 pass, 0 fail

- [x] **Step 8: 폐기 가능한 Google Drive scratch에서 반복 검증한다**

Result: 수정 전후 Google DriveFS stress를 각각 100회 실행했다. 최종 helper 기준
double-success 0, 1 success + 1 stale 100/100, malformed JSON 0, 최종 승자 일치
100/100, temp 잔여 0. NTFS old/new 연속 read도 30회 반복에서 실패 0.

- [x] **Step 9: 커밋한다**

```text
fix: 여러 배프레임의 리뷰 저장 충돌과 파일 손상을 차단
```

### Task 4: 릴리스 검증과 배포

**Files:**
- Verify: all changed runtime, renderer, preload, and test files
- Build: merged commit 전용의 새 `dist-stable-release-<commit>/win-unpacked`
- Deploy: `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\BAEFRAME\테스트버전 빌드`

**Interfaces:**
- Consumes: merged `main`
- Produces: hash-identical stable deployed artifact

- [x] **Step 1: 기능별 회귀 테스트를 실행한다**

```text
npm run test:fabric-drawing-pilot
npm run test:fabric-drawing-persistence
npm run test:mpv
npm run test:comment-input
npm run test:drawing
npm run test:drawing-v3-adapter
npm run test:drawing-v3-store-observer
npm run test:playlist
npm run lint
```

`test:fabric-drawing-pilot`에는 `mpv-fabric-overlay-runtime.test.js`를 포함해 획 선택,
라쏘 부분 분리·이동·삭제와 Undo/Redo 전용 회귀를 항상 실행한다.

Expected: 모든 test command 0 fail, lint 0 errors

- [x] **Step 2: 독립 리뷰에서 P0/P1이 없는지 확인한다**

전체 `origin/main...HEAD` diff와 저장·전환·종료 경계를 별도 reviewer가 검사한다.

- [ ] **Step 3: PR을 만들고 Codex 리뷰 명시 완료 신호를 받을 때까지 반복한다**

issue comments, line comments, reviews, trigger reactions를 모두 확인한다. P1/P2를
수정하고 재검증·재트리거한다.

- [ ] **Step 4: merge된 main에서 commit 전용의 새 정식 directory build를 생성한다**

Run: `npm run build -- --config.directories.output=dist-stable-release-<commit>`

기존 `dist/win-unpacked`은 과거 시험 marker나 잔여 파일이 있을 수 있으므로 배포
근거로 사용하지 않는다.

Expected: 새 output의 `resources/baeframe-runtime-profile.json` channel이
`fabric-v3-stable`

- [ ] **Step 5: 정확히 배포 경로를 점유한 프로세스만 사용자가 닫은 뒤 복사한다**

현재 작업 중인 다른 BAEFRAME 인스턴스는 종료하거나 변경하지 않는다.

- [ ] **Step 6: 전체 파일 해시를 대조한다**

로컬과 공유 드라이브의 상대 경로·크기·SHA-256을 비교한다.

Expected: `MismatchCount=0`

- [ ] **Step 7: 배포본을 열고 실제 경로와 엔진을 확인한다**

실행 파일, `app.asar`, marker, mpv child process가 모두 공유 드라이브 배포 경로를
가리키는지 확인한다. 마우스와 키보드는 사용자가 직접 조작한다.
