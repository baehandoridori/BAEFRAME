# mpv + Fabric 드로잉 안정화 채널 승격 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검증한 mpv + Fabric 드로잉과 `drawingsV3` 저장을 정식 BAEFRAME 배포본의 기본 엔진으로 승격한다.

**Architecture:** 정식 패키지에는 `fabric-v3-stable` runtime marker를 넣고 시험 패키지는 기존 `fabric-v3-trial` marker를 유지한다. 기능 resolver는 kill switch를 최우선으로 처리한 뒤 두 marker를 검증해 기능을 켜며, 정식 marker는 기존 userData와 Windows 파일연결을 그대로 사용한다.

**Tech Stack:** Electron, Node.js, electron-builder afterPack hook, node:test, Fabric.js, mpv JSON IPC

## Global Constraints

- 기존 `drawings`와 알 수 없는 `.bframe` 최상위 필드는 byte-equivalent 의미로 보존한다.
- 정식 채널은 `isolateUserData=false`, `skipShellRegistration=false`다.
- 시험 채널은 `isolateUserData=true`, `skipShellRegistration=true`를 유지한다.
- kill switch는 모든 runtime marker보다 우선한다.
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

- [ ] **Step 1: 정식 marker 테스트를 먼저 작성한다**

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

- [ ] **Step 2: 테스트가 기존 `absent` 동작 때문에 실패하는지 확인한다**

Run: `node --test scripts/tests/runtime-profile.test.js scripts/tests/experiment-flags.test.js`

Expected: normal build marker assertion FAIL

- [ ] **Step 3: 안정화 marker와 strict profile 검증을 구현한다**

`main/runtime-profile.js`에 stable channel과 marker를 추가하고, 두 marker 모두 exact-key,
size-limit, deeply-frozen 계약을 통과해야 활성화되게 한다.

- [ ] **Step 4: 일반 build는 stable, trial build는 trial marker를 원자적으로 쓰게 한다**

`scripts/electron-builder-after-pack.js`에서 환경값이 `fabric-v3-trial`이면 trial marker,
그 외에는 stable marker를 선택한다. 기존 marker와 임시 marker 제거 후 `wx` temp write와
rename 순서는 유지한다.

- [ ] **Step 5: focused 테스트를 통과시킨다**

Run: `node --test scripts/tests/runtime-profile.test.js scripts/tests/experiment-flags.test.js`

Expected: PASS, 0 fail

- [ ] **Step 6: 커밋한다**

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

- [ ] **Step 1: stable profile 실행 정책 테스트를 추가한다**

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

- [ ] **Step 2: 정식 marker가 shell registration을 건너뛰지 않는 source test를 추가한다**

Run: `node --test scripts/tests/instance-policy.test.js scripts/tests/project-file-associations.test.js`

Expected: 새 stable assertions가 구현 전 FAIL

- [ ] **Step 3: runtime profile 조건을 trial-only로 유지해 stable 실행 정책을 구현한다**

`main/instance-policy.js`와 `main/index.js`는 `fabric-v3-trial`만 격리 대상으로 취급한다.
stable profile은 기존 단일 인스턴스와 shell registration 경로를 사용한다.

- [ ] **Step 4: semantic release version을 반영한다**

기본 재생·드로잉 엔진 교체이므로 package version을 `2.0.0-beta`로 올리고 lockfile의 root
version을 동일하게 맞춘다.

- [ ] **Step 5: focused 테스트를 통과시킨다**

Run: `node --test scripts/tests/instance-policy.test.js scripts/tests/project-file-associations.test.js scripts/tests/mpv-runtime-provision.test.js`

Expected: PASS, 0 fail

- [ ] **Step 6: 커밋한다**

```text
chore: 안정화 배포 버전을 2.0.0 beta로 갱신
```

### Task 3: 릴리스 검증과 배포

**Files:**
- Verify: all changed runtime, renderer, preload, and test files
- Build: `dist/win-unpacked`
- Deploy: `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\BAEFRAME\테스트버전 빌드`

**Interfaces:**
- Consumes: merged `main`
- Produces: hash-identical stable deployed artifact

- [ ] **Step 1: 기능별 회귀 테스트를 실행한다**

```text
npm run test:fabric-drawing-pilot
npm run test:fabric-drawing-persistence
npm run test:mpv
npm run test:drawing
npm run test:drawing-v3-adapter
npm run test:drawing-v3-store-observer
npm run test:playlist
npm run lint
```

Expected: 모든 test command 0 fail, lint 0 errors

- [ ] **Step 2: 독립 리뷰에서 P0/P1이 없는지 확인한다**

전체 `origin/main...HEAD` diff와 저장·전환·종료 경계를 별도 reviewer가 검사한다.

- [ ] **Step 3: PR을 만들고 Codex 리뷰 명시 완료 신호를 받을 때까지 반복한다**

issue comments, line comments, reviews, trigger reactions를 모두 확인한다. P1/P2를
수정하고 재검증·재트리거한다.

- [ ] **Step 4: merge된 main에서 정식 directory build를 생성한다**

Run: `npm run build`

Expected: `resources/baeframe-runtime-profile.json`의 channel이 `fabric-v3-stable`

- [ ] **Step 5: 정확히 배포 경로를 점유한 프로세스만 사용자가 닫은 뒤 복사한다**

현재 작업 중인 다른 BAEFRAME 인스턴스는 종료하거나 변경하지 않는다.

- [ ] **Step 6: 전체 파일 해시를 대조한다**

로컬과 공유 드라이브의 상대 경로·크기·SHA-256을 비교한다.

Expected: `MismatchCount=0`

- [ ] **Step 7: 배포본을 열고 실제 경로와 엔진을 확인한다**

실행 파일, `app.asar`, marker, mpv child process가 모두 공유 드라이브 배포 경로를
가리키는지 확인한다. 마우스와 키보드는 사용자가 직접 조작한다.

