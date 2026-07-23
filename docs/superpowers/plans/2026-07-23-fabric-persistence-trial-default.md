# Fabric 드로잉 저장 및 시험판 기본 실행 구현 계획

> 설계 원문: `docs/superpowers/specs/2026-07-23-fabric-persistence-trial-default-design.md`

## Task 1: 저장 codec과 renderer persistence store

**Files**

- Create: `renderer/scripts/modules/fabric-drawing-persistence-store.js`
- Create: `scripts/tests/fabric-drawing-persistence-store.test.mjs`
- Modify: `package.json`

**TDD**

1. 빈 문서, 여러 프레임, 모든 record 필드 round-trip 테스트를 먼저 작성하고 실패를 확인한다.
2. add/move/split/delete/clear/undo/redo transition 적용 테스트를 작성한다.
3. stale/gap/duplicate/malformed/oversize/future version 원자 거부 테스트를 작성한다.
4. 최소 codec/store를 구현한다.
5. 새 테스트와 drawing 관련 기존 테스트를 실행한다.

**Commit**

`feat: Fabric 드로잉 저장 문서와 변경 저장소 추가`

## Task 2: ReviewDataManager 저장·복원 및 save race 수정

**Files**

- Modify: `renderer/scripts/modules/review-data-manager.js`
- Modify: `renderer/scripts/app.js`
- Modify: `scripts/tests/review-data-manager-save.test.js`
- Modify: `scripts/tests/bframe-root-envelope.test.js`

**TDD**

1. `drawingsV3` load/collect, legacy drawings 불변 테스트를 먼저 실패시킨다.
2. persistence 변경이 dirty/autosave를 만드는 테스트를 추가한다.
3. 기존 `.bframe`이 없는 영상에서 Fabric 첫 획만으로 파일이 생성되는 테스트를 추가한다.
4. 저장 실패 dirty 유지와 저장 도중 새 변경의 trailing save 테스트를 추가한다.
5. provider snapshot을 `_opaqueRootFields.drawingsV3`에 반영하고 future raw를 보존하는 테스트를 추가한다.
6. provider 연결과 revision-aware save ack를 구현한다.
7. playlist, drawing, 저장 테스트를 실행한다.

**Commit**

`feat: Fabric 드로잉을 리뷰 파일 자동 저장에 연결`

## Task 3: Overlay commit bridge와 hydrate/export

**Files**

- Create: `preload/mpv-overlay-preload.js`
- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Modify: `scripts/build-mpv-fabric-overlay.js` or existing bundle command inputs if needed
- Modify: `main/mpv-overlay-host.js`
- Modify: `main/ipc-handlers.js`
- Modify: `preload/preload.js`
- Modify: `renderer/scripts/modules/fabric-drawing-pilot-controller.js`
- Modify: `scripts/tests/mpv-fabric-overlay-runtime.test.js`
- Modify: `scripts/tests/fabric-drawing-scene-observer.test.js`
- Modify: `scripts/tests/mpv-overlay-host.test.js`
- Modify: `scripts/tests/fabric-drawing-pilot-integration.test.js`

**TDD**

1. 확정 commit별 1회, selection/no-op 0회 observer 테스트를 먼저 실패시킨다.
2. hydrate/export round-trip, history 비복원, hydrate commit/dirty 0회 테스트를 추가한다.
3. sender 위조, payload size, stale generation 테스트를 추가한다.
4. controller가 review load 뒤 hydrate 성공 후에만 enable하는 테스트를 추가한다.
5. 좁은 overlay preload, main 전달, renderer listener, runtime API를 구현한다.
6. delta는 dirty/cache에만 사용하고 매 save 직전 full video snapshot을 pull해 sequence와 함께 확정한다.
7. sequence gap 시 full snapshot resync를 구현한다.
8. snapshot pull 실패 시 dirty 유지와 video/quit 차단 또는 명시 경고를 구현한다.
9. 영상별 `legacyBypass`와 `shouldOwnDrawingShortcut()`를 구현하고 실패 뒤 B가 legacy로 전달되는지 검증한다.
10. Fabric bundle을 재생성하고 관련 테스트를 실행한다.

**Commit**

`feat: mpv Fabric 화면과 저장 계층을 안전하게 연결`

## Task 4: 시험판 패키지 marker와 격리 실행

**Files**

- Create: `main/runtime-profile.js`
- Create: `scripts/electron-builder-after-pack.js`
- Modify: `main/experiment-flags.js`
- Modify: `main/mpv-manager.js`
- Modify: `main/index.js`
- Modify: `main/instance-policy.js`
- Modify: `electron-builder.yml`
- Modify: `package.json`
- Modify: `scripts/tests/experiment-flags.test.js`
- Modify: `scripts/tests/instance-policy.test.js`
- Modify: `scripts/tests/mpv-manager.test.js`
- Modify: `scripts/tests/project-file-associations.test.js`
- Create: `scripts/tests/runtime-profile.test.js`
- Modify: `scripts/tests/mpv-runtime-provision.test.js`

**TDD**

1. marker 없음/손상/unknown schema는 OFF인 테스트를 먼저 실패시킨다.
2. 유효 marker는 mpv+pilot+shadow+persistence ON 테스트를 추가한다.
3. mpv/Fabric kill switch가 marker보다 우선하는 테스트를 추가한다.
4. 시험판에서 userData 격리와 shell registration skip을 검증한다.
5. `build:trial`에만 marker가 생성되고 일반 build에는 없는 테스트를 추가한다.
6. trial build 뒤 같은 출력 폴더의 normal build가 기존 marker를 제거하는 테스트를 추가한다.
7. `prebuild:trial`에서 Fabric bundle이 항상 재생성되는지 검증한다.
8. 전역 환경변수 변경 없이 해석된 mpv/Fabric 상태를 각 manager에 주입하고, 원자적 marker build hook과 main wiring을 구현한다.

**Commit**

`feat: Fabric 시험판을 독립 실행 채널로 구성`

## Task 5: UI 문구, 회귀 검증, 수동 시험 앱

**Files**

- Modify: `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
- Modify: `scripts/tests/fabric-drawing-pilot-source.test.js`
- Modify: `package.json`
- Add evidence under: `.superpowers/sdd/fabric-persistence-evidence/`

**TDD and verification**

1. `저장 안 됨` 문구와 save 금지 canary를 저장 활성 문구/계약으로 교체한다.
2. drawing, V3, Fabric, mpv, playlist 전체 회귀 테스트를 실행한다.
3. 시험판 directory build를 생성하고 marker와 핵심 바이너리를 검사한다.
4. 기존 BAEFRAME PID를 기록한다.
5. 랜덤 isolated profile로 앱만 실행하고 mpv 영상이 열리도록 한다.
6. 마우스/키보드는 조작하지 않고 사용자가 직접 draw/save/reopen을 검증하게 한다.
7. 실행 후 기존 PID와 Windows 파일 연결이 바뀌지 않았는지 확인한다.

**Commit**

`test: Fabric 저장 시험판 회귀 검증을 고정`

## Task 6: 독립 리뷰 및 후속 릴리스 준비

1. 각 Task commit 범위를 독립 리뷰한다.
2. 전체 branch diff를 다시 리뷰한다.
3. critical/important 지적을 수정하고 전체 검증을 재실행한다.
4. 사용자 수동 검증이 끝난 뒤 PR 제목과 본문을 제시한다.
5. 사용자 확인 후 PR 생성, Codex review loop, merge, 새 beta build, 공유 드라이브 배포, 전체 파일 hash 대조를 진행한다.
