# BAEFRAME 댓글·재생 전환·드로잉 입력 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 사용자가 별도로 위임을 요청한 경우에만 subagent-driven-development를 선택한다.

**Goal:** 댓글의 위치와 저장 상태를 믿을 수 있게 만들고, 그리기·화면 이동·타임라인 조작이 서로 방해하지 않게 한다.

**Architecture:** 영상별 댓글 원본과 화면에 표시하는 통합 목록을 분리하고, 비동기 작업은 시작한 영상·댓글·화면의 정체를 보존한다. 재생 위치는 프레임 정수로 확정하고, 입력 소유권은 댓글/드로잉/화면 이동 중 하나만 가진다. 기존 mpv·Fabric·CAS 저장 경계를 유지하면서 필요한 부분만 수정한다.

**Tech Stack:** Electron 28, JavaScript ESM renderer/CommonJS main, Fabric 7.4, mpv, Node `node:test`, JSDOM. 의존성 추가 없음.

**Spec:** 이 문서 §1의 사용자 요구와 결정 사항. 별도 대화 기록을 읽지 않아도 구현할 수 있다.

**기준:** 2026-09-14, `origin/main` **04e2a229bb1e85edac2a7c0f11bf9f294b796218**, **2.11.1-beta**.

**작성 상태:** 조사·재현·계획 작성 완료. 아래 구현 체크박스는 전부 미실행이다. 제품 소스, 업무 `.bframe`, 실행 중 앱, 공유드라이브 배포본은 수정하지 않았다.

## Global Constraints

- Windows PowerShell 기준. 새 브랜치는 `codex/`. 기존 dirty checkout 및 다른 worktree를 보존한다.
- `.bframe` 하위 호환성을 유지한다. `drawingsV3` 레코드에 임의 필드를 추가하거나 레거시 `drawings`에 이중 저장하지 않는다.
- 사용자 설정·멤버 색상·Slack ID·권한·원격 편집 잠금·기존 댓글/그림을 보존한다.
- `main/`·`preload/` 변경에는 입력 검증, 실제 발신 창, 현재 세션 검증을 함께 넣는다.
- 오버레이 런타임을 바꾸면 `npm run bundle:mpv-fabric-overlay`로 생성 번들을 갱신한다. 생성 파일만 수정하지 않는다.
- 기존 영상 전환의 저장 완료 대기, 입력 차단, load token/intent generation, 중복 EOF 방지, 이전 프레임 유지 장치를 제거하지 않는다.
- Slack 실제 발송, PR 생성, 머지, 배포, 사용자 앱 재시작은 이 계획서 작성 요청에 포함되지 않는다. 구현 검증에서는 Slack notifier를 가짜 구현으로 바꾼다.
- 테스트 결과, 빌드 결과, 실제 PC·펜 입력 검증을 구분한다. DOM 테스트 통과를 태블릿 실기 통과로 쓰지 않는다.
- 커밋할 때 해당 task 파일만 명시해 `git add`하고, 한국어로 무엇을 어떻게 왜 바꿨는지 적는다.

---

## 1. 사용자 요구와 확정할 동작

| ID | 요구 | 완료 기준 |
|---|---|---|
| R1 | 이어붙이기 댓글의 `파일명 00:00:00:00` 오류, 중복 시간 문구 정리 | 파일명 옆은 해당 컷 내부의 실제 댓글 위치. 보조 시간은 `전체 HH:MM:SS:FF` 하나. 중복 `컷 HH:MM:SS:FF` 삭제 |
| R2 | 완료 후 곧바로 다음 컷을 선택하면 반영이 늦거나 누락됨 | 클릭 즉시 저장 중 표시, 해당 원본에 저장. 다음 컷이 이전 완료 콜백으로 덮이거나 스크롤되지 않음 |
| R3 | 다음 영상으로 전환할 때 버벅임 | 불필요한 전체 댓글 재읽기·전체 DOM 재생성 제거. 단계별 시간을 재서 전후 비교. 검은 화면 회귀 없음 |
| R4 | 그리다가 댓글 포인트에 걸림 | 드로잉 모드에서는 포인트·답글 배지·툴팁이 입력을 받지 않음. 점은 표시해도 되며 그림은 점 위를 통과 |
| R5 | 댓글 수정·대댓글에서 @태그가 작동하지 않음 | 새 댓글/댓글 수정/답글 작성/답글 수정/스레드 팝업/분리창에서 한글 검색과 선택 동작 |
| R6 | 현재 프레임에 해당하는 오른쪽 댓글 활성화 | 현재 댓글 구간 안의 목록 항목을 지속적으로 강조. 재생·정지·스크럽·키보드 프레임 이동에 대응 |
| R7 | 태블릿 클릭 드래그로 화면 이동 불가 | 화면 이동이 허용된 상태에서 mouse/pen/touch의 주 포인터 드래그로 같은 거리만큼 이동 |
| R8 | Space를 누른 채 화면 이동 불가 | 드로잉 모드에서도 Space+드래그로 임시 화면 이동. 드래그 후 Space를 놓아도 재생되지 않음 |
| R9 | 프레임바 드래그 종료 시 한 프레임 앞에서 정지 | 놓은 위치의 프레임과 실제 재생/드로잉/타임코드 위치 일치. 전체에 +1을 더하는 보정 금지 |

### 1.1 구현 중 재질문 없이 적용할 UX 결정

- R1 표시 예: `c053 00:00:01:08` · `전체 00:03:12:08`. 파일명+로컬 시간은 유지한다. ‘전체만’은 **보조 시간 배지에서 중복 컷 시간을 없앤다**는 뜻으로 적용한다. 재생 컨트롤 전체 시간 UI와 컷 묶음(BEditer/cutlist)은 별도 변경하지 않는다.
- 저장된 댓글 `startFrame: 0`은 실제 첫 프레임일 수 있다. 0을 억지로 다른 시간으로 바꾸지 않는다. 없거나 잘못된 값은 `시간 정보 없음`으로 구별한다.
- R6의 ‘활성화’는 **강조 표시**다. 자동 seek, 자동 완료, 키보드 포커스 이동, 매 프레임 자동 스크롤을 하지 않는다. 여러 구간이 겹치면 모두 강조한다. 사용자가 클릭한 `.selected`와 다른 `.is-current-frame` 클래스를 쓴다.
- 댓글 구간은 현재 `CommentMarker.isVisibleAtFrame`과 동일한 양끝 포함 `[startFrame, endFrame]`. 끝이 없으면 한 프레임짜리 구간. 숨김·작성자·해결 여부·검색 필터로 제외된 댓글은 새로 노출하지 않는다.
- Space 짧게 누르기는 기존 재생/정지. 드로잉 모드에서 Space를 누르고 3 CSS px 이상 움직이면 pan으로 확정한다. pen의 일반 획은 Space가 없을 때 계속 그리기다.
- 가운데 고정 ON이고 확대율 100% 이하이면 기존 화면 고정을 유지한다. 이 상태에서 pan 불가를 오류로 판정하지 않는다. 검증은 150% 또는 가운데 고정 OFF에서 진행한다.
- @ 앞에 공백이 없는 한국어 문장(`확인@배`)과 여는 괄호(`(@배`)도 태그 입력으로 인정한다. 이메일 형태의 ASCII 토큰 뒤 `abc@company.com`은 자동완성을 열지 않는다.
- 저장 실패를 ‘완료’로 표시하지 않는다. 대상 행에 `저장 실패 · 다시 시도`를 남긴다. 영상 전환을 안전하게 끝낼 수 없는 저장 실패는 기존 영상에 머물고 사유를 표시한다.

## 2. 조사 근거와 확실성

### 2.1 실행한 검증

| 검증 | 이번 실행 결과 | 한계 |
|---|---|---|
| playlist comment/core/runtime + review-data-manager-save | **245 pass, 0 fail, 0 cancelled**, exit 0 | 자동 테스트 |
| mention popout + video pan + timeline frame UI + playhead | **26 pass, 0 fail, 0 cancelled**, exit 0 | DOM/소스 검사 포함, 실제 펜 아님 |
| `diagnose.cjs` | exit 0, 6개 단언으로 현행 문제 경로 확인 | 실제 함수 본문 + 통제한 비동기 의존성 |
| `diagnose-input.cjs` | exit 0, 프레임 경계·IME·드로잉 상태 확인 | JSDOM 및 함수 본문, mpv 실제 화면 아님 |

최초 테스트는 새 worktree에 `electron`이 없어 245개 중 1개가 실패했다. 코드 실패로 처리하지 않았다. 기존 `baeframe-ux-first/BAEFRAME/node_modules`를 `NODE_PATH`로 읽게 해 재실행한 결과가 위 수치다. 의존성 설치나 제품 파일 변경은 하지 않았다.

재현 스크립트와 테스트 로그: [증거 폴더](2026-09-14-playlist-review-evidence/README.md).

### 2.2 실제 사용 로그에서 읽은 수치

로컬 `baeframe-2026-09-13.log`에는 버전 2.11.1-beta가 기록되어 있다. 아래는 **그 파일 전체의 IPC 완료 로그 통계**이며, 이번에 새로 수행한 성능 실험이나 하나의 동일한 재현 구간이 아니다.

| IPC | 횟수 | 중앙값 | p95 | 최대 |
|---|---:|---:|---:|---:|
| `mpv:load` | 198 | 85ms | 153ms | 788ms |
| `file:load-review` | 25,167 | 6ms | 43ms | 8,541ms |
| `file:scan-versions` | 196 | 5ms | 20ms | 5,189ms |
| `file:save-review` | 78 | 297.5ms | 803ms | 1,023ms |
| `file:load-review-snapshot` | 262 | 4ms | 28ms | 77ms |

75초 구간(UTC 16:03:00~16:04:15)에서 `file:load-review` 완료 392건도 확인했다. 목록 전체 재읽기와 중복 진행률 갱신을 줄일 근거가 있다. 이 호출들이 전부 사용자의 한 번의 완료 클릭에서 발생했다고 단정하지 않는다.

최근 사용한 리뷰 6개, 삭제되지 않은 댓글 10개의 **시간 필드만** 읽었다. 모두 24fps, 5개는 저장 원본부터 `startFrame=0`, 다른 항목에는 32/81/93/123/278이 있었다. 이름·본문·이미지를 fixture에 복사하지 않았다. 32프레임은 현행 함수에서도 `00:00:01:08`로 변환된다. 따라서 모든 00 표시의 원인을 ‘포맷 함수 오류’로 단정할 수 없다.

### 2.3 확인된 코드 경로

| 항목 | 확인 내용 | 확실성 |
|---|---|---|
| R1 | `updatePlaylistContinuousTimeline()`은 현재 편집 중인 컷도 `loadReview()`로 읽음. 메모리 32프레임/디스크 0프레임 fixture에서 통합 목록이 0을 표시 | 통제 재현 완료 |
| R1 | `Number(marker.startFrame) || 0`으로 누락/오류를 첫 프레임과 구분하지 않음 | 통제 재현 완료. 실제 읽은 10개는 정상 숫자 |
| R2 | 완료 저장 후 화면 모드 확인 없이 `renderPlaylistContinuousCommentList()`와 `highlightPlaylistAggregateComment()` 호출 | 모드 이탈 중 지연 저장 fixture에서 재현 |
| R2 | `save()`는 이미 진행 중인 저장 Promise를 그대로 반환. `_doSave()`는 그 사이 새 편집이 생기면 dirty를 남김 | 코드 확인. `save()===true`가 클릭 시점 편집의 저장 보장은 아님 |
| R3 | 완료 후 전체 타임라인 읽기, `updatePlaylistUI()` 내부 항목 렌더/전체 진행률의 추가 읽기 | 코드와 호출 통계 확인 |
| R3 | mpv 경로의 HTML 사전 로드는 의도적으로 생략. 기존 30초/128MiB Drive 캐시는 이미 존재 | 코드 확인. 캐시 옵션 추가를 해결책으로 중복 제안하지 않음 |
| R4 | Fabric active 상태에서도 `setDrawModeReadyState(false)` 호출, 그 함수가 댓글 passthrough를 false로 되돌림 | 함수 본문 재현 완료 |
| R4 | marker serializer가 `clone.innerHTML`만 보내므로 부모의 `drawing-active` 클래스도 미러로 안 감 | 코드 확인 |
| R5 | 수정/답글에도 `attach`가 존재. 한국어 바로 뒤 @는 거절. IME 조합 Enter도 멤버 선택/취소 이벤트로 소비 | JSDOM 재현 완료. 사용자 화면과 동일한 유발 조건은 미확정 |
| R6 | 시간 변경은 비디오 포인트 등에 전달되지만 댓글 목록에는 프레임별 활성 클래스 갱신 없음 | 코드 확인, 새 기능 |
| R7 | 메인 영상 pan은 `mousedown/mousemove/mouseup`만 사용. Fabric는 별도 창에서 pointer 입력을 소유 | 코드 확인. 실제 태블릿 재현 미수행 |
| R8 | Space pan 분기에 `!isFabricDrawingPilotEngaged()` 조건. Fabric 런타임에는 pan gesture 없음 | 코드 확인 |
| R9 | `Math.floor(0.58 * 100)`이 57. `_finishScrubbing(e)`는 release 위치를 무시하고 `scrubTime` 재사용 | 함수 본문 재현 완료. 실제 디코더의 프레임 확인은 추가 필요 |

## 3. 파일 지도와 작업 순서

현재 파일명은 기준 커밋에서 확인했다. 줄 번호는 탐색용이며 수정 anchor는 함수명이다.

| 작업 | 수정/생성 파일 | 역할 |
|---|---|---|
| T1 | `renderer/scripts/modules/playlist-comment-index.js`, 신규 `playlist-comment-cache.js`, `renderer/scripts/app.js` | 댓글 시간/원본 선택/부분 갱신 |
| T2 | 신규 `playlist-comment-resolution.js`, `review-data-manager.js`, `app.js`, `main.css` | 완료 작업 정체·저장 체크포인트·화면 보호 |
| T3 | `app.js`, `playlist-manager.js`, 신규 `playback-transition-metrics.js`, 필요 시 `version-manager.js` | 반복 읽기 축소·전환 시간 측정 |
| T4 | `app.js`, `main.css`, `main/mpv-overlay-host.js` | 드로잉 중 댓글 입력 차단 |
| T5 | `mention-manager.js`, `app.js`, 신규 `comment-edit-session.js` | 한글 멘션·입력창 수명 |
| T6 | 신규 `comment-playback-highlight.js`, `app.js`, `main.css` | 현재 댓글 강조 |
| T7 | 신규 `video-pan-gesture.js`, `app.js`, `main.css` | 메인 화면 pen/pointer pan |
| T8 | `mpv-fabric-overlay-runtime.js`, `app.js`, 두 preload, `mpv-overlay-host.js`, 신규 `shared/viewport-pan-message.js` | Fabric Space pan·창 사이 전달 |
| T9 | `timeline.js`, `app.js`, 필요 시 `video-player.js` | 최종 포인터 좌표·정수 프레임 seek |

`renderer/scripts/modules/`의 기존 파일은 표에서 경로를 줄여 썼다. 런타임 변경 task는 생성 번들 `renderer/scripts/lib/mpv-fabric-overlay.iife.js`도 포함한다. task마다 아래 명시한 테스트 파일을 추가하거나 확장한다.

권장 실행 순서: **T0 → T1 → T2 → T3 → T4 → T5 → T9 → T6 → T7 → T8 → T10**. T6는 T9의 최종 프레임 입력까지 연결해야 한다. `app.js`를 여러 작업자가 동시에 수정하지 않는다.

## T0. 실행 환경과 실패 재현 기준 확보

- [ ] `AGENTS.md`, `docs/development-guide.md`, `docs/drawing-work-guide.md`, `docs/collaboration.md`, `docs/bframe-schema.md`를 읽는다. 파일 명세 예시의 `frame/content`와 현행 `CommentMarker.toJSON()`의 `startFrame/text`가 다르므로 실제 검증·직렬화 코드 우선.
- [ ] 기준 버전과 현재 변경 확인. 계획 파일이 있는 이 worktree에서 계속하거나 아래와 같이 별도 구현 worktree를 만든다.

```powershell
Set-Location C:\BAEframe\BAEFRAME
git status --short
git fetch origin main
git worktree add .worktrees/review-playback-input -b codex/review-playback-input origin/main
Set-Location .worktrees/review-playback-input
git rev-parse HEAD
Get-Content package.json -TotalCount 8
```

- [ ] 기준 SHA와 다르면 아래 함수명을 `rg -n`으로 찾아 의미를 비교한다. 이미 고쳐진 부분은 테스트로 확인 후 기록하고 중복 적용하지 않는다. 저장/IPC 계약이 달라진 부분을 추측해서 덮어쓰지 말고 해당 task만 근거와 함께 보류한다.
- [ ] 의존성이 없으면 `npm ci --ignore-scripts`로 먼저 설치한다. 테스트에 필요한 모듈만 읽는 단계이며, 번들/저장 helper는 해당 task 검사 전 명시적으로 생성한다.
- [ ] 아래 baseline 실행. 실패 시 missing dependency와 기능 실패를 구분해서 기록한다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/playlist-comment-index.test.js scripts/tests/playlist-continuous-core.test.js scripts/tests/playlist-continuous-runtime.test.js scripts/tests/review-data-manager-save.test.js scripts/tests/mention-manager-popout.test.js scripts/tests/video-pan-controls.test.js scripts/tests/timeline-frame-ui-source.test.js scripts/tests/playhead-frame-step-source.test.js
```

- [ ] `DEVLOG/2026-09-14-review-playback-input.md`를 만들고 기준 SHA, 실행 경로, task 상태, 실제 명령/종료 코드/pass/fail/cancelled를 기록한다.
- [ ] 익명 fixture를 사용한다: A 3초 24fps, B 5초 24fps, C 3초 30fps. A 댓글 24~48, B 댓글 32~64, C 댓글 30~60, 별도의 실제 0프레임 댓글. 사용자 원본에 테스트 쓰기 금지.

## T1. 댓글 시간의 출처와 통합 목록 갱신 수정 — R1

**Modify:** `playlist-comment-index.js:57 extractPlaylistCommentRanges`, `app.js:19898 updatePlaylistContinuousTimeline`, `app.js:13088 renderPlaylistContinuousCommentList`.

**Create:** `renderer/scripts/modules/playlist-comment-cache.js`.

**Test:** 기존 `scripts/tests/playlist-comment-index.test.js`, 신규 `scripts/tests/playlist-comment-cache.test.js`, `scripts/tests/playlist-comment-panel.test.js`.

**Interfaces:**

- `readPlaylistMarkerFrame(value): number|null` — 유한한 0 이상의 정수만 허용. 숫자 문자열은 허용, null/undefined/빈 문자열/NaN/Infinity/음수/소수는 null.
- `createPlaylistCommentCache({read, normalizePath})` → `{read(path), invalidate(path), clear()}`. read 결과와 진행 중 Promise를 재사용한다. invalidate 이후 이전 Promise는 새 캐시 값을 덮지 못한다.
- `refreshPlaylistCommentsForItem(itemId): Promise<void>` — 해당 item만 다시 계산하여 기존 배열의 해당 item 부분을 치환. 순서·재생 길이는 바꾸지 않는다.

- [ ] 아래 테스트부터 추가한다.

```javascript
test('zero and missing frames are different', async () => {
  const { readPlaylistMarkerFrame } = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  assert.equal(readPlaylistMarkerFrame(0), 0);
  assert.equal(readPlaylistMarkerFrame('32'), 32);
  for (const value of [null, undefined, '', 'bad', -1, 1.2, Infinity]) {
    assert.equal(readPlaylistMarkerFrame(value), null);
  }
});
test('cached requests are deduplicated until invalidated', async () => {
  const { createPlaylistCommentCache } = await import('../../renderer/scripts/modules/playlist-comment-cache.js');
  let calls = 0;
  const cache = createPlaylistCommentCache({
    read: async () => ({ sequence: ++calls }), normalizePath: p => p.toLowerCase()
  });
  const [a, b] = await Promise.all([cache.read('A'), cache.read('a')]);
  assert.equal(calls, 1);
  assert.equal(a.sequence, b.sequence);
  cache.invalidate('a');
  assert.equal((await cache.read('A')).sequence, 2);
});
```

- [ ] reader는 다음 규칙으로 구현한다.

```javascript
export function readPlaylistMarkerFrame(value) {
  if (value === null || value === undefined ||
      (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const frame = Number(value);
  return Number.isSafeInteger(frame) && frame >= 0 ? frame : null;
}
```

- [ ] `extractPlaylistCommentRanges`에서 start가 null이면 `timingValid:false`, time/frame/timecode는 null로 유지한 목록 항목을 만든다. 해당 항목은 시간 seek와 타임라인 범위에서 제외하고 목록에 `시간 정보 없음`으로 표시한다. 목록 정렬은 해당 컷의 유효한 시간 항목 다음에 원래 순서로 배치한다. 기존 숫자 정렬/타임라인 전달부에도 `timingValid !== false` 검사를 넣어 null을 0으로 해석하지 않게 한다. end만 잘못되면 start와 같게 한다. 원본 파일에 frame=0을 쓰지 않는다.
- [ ] 유효한 start/end는 현재 segment FPS 우선 계약을 유지한다. 이 계약을 바꾸는 재마이그레이션은 하지 않는다. 24/30/23.976/29.97fps 회귀 fixture를 추가하고 같은 컷의 단독보기와 비교한다.
- [ ] 타임코드는 유효한 숫자 frame/time으로 새로 계산한다. `localStartTimecode || ...` 때문에 낡은 문자열을 우선하지 않게 한다. 숫자 출처가 없는 외부 표시 객체는 검증된 timecode 문자열만 fallback으로 허용한다.
- [ ] `updatePlaylistContinuousTimeline()`에서 각 item의 videoPath와 `reviewDataManager.getVideoPath()`가 같고 `!reviewDataManager.isLoading`이면 **동기적으로 캡처한** `commentManager.toJSON()`을 사용한다. 직렬화 도중 await 금지. 이미 가져온 디스크 리뷰의 다른 필드를 수정하지 않고 `{comments: snapshot, fps: videoPlayer.fps}`를 extractor에 준다. 현재 컷의 댓글을 얻기 위해 `_collectData()`/Fabric 전체 snapshot을 부르지 않는다.
- [ ] 다른 컷은 캐시 read를 사용한다. 실제 loadReview 결과에서 `{comments,fps}`만 추출해 캐시에 보관하며 drawingsV3/이미지/root envelope 전체를 캐시에 붙잡아 두지 않는다. cache key는 정규화한 `.bframe` 경로, entry에는 generation을 둔다. 오류 Promise는 제거해서 다음 read가 재시도할 수 있게 한다. LRU 상한 200개, 현재 playlist 변경 시 clear. 저장에는 이 표시용 캐시를 쓰지 않고 T2의 최신 snapshot/CAS를 사용한다.
- [ ] invalidation: 해당 컷 저장 성공, 현재 댓글 수정/이동/해결/답글/원격 변경, 기존 file-watch 갱신 경로, playlist 항목 경로 변경. 비활성 컷은 자동 재생 전환마다 전부 재검사하지 않는다. 모드가 보이는 동안 5초마다 만료 항목을 한 번의 대기열에 합치고 worker1개로 순차 재검증한다. 이미 대기/실행 중인 경로는 중복 등록하지 않는다. 마지막 성공 읽기가5초 이내면 생략한다. 타이머/대기열은 모드 이탈/목록 교체/종료 때 정리한다. 외부 편집 반영은 파일 알림과 이 백그라운드 확인이 끝난 시점이며 모든 파일의5초 내 반영을 보장하지 않는다.
- [ ] `refreshPlaylistCommentsForItem`은 시작 시 playlist 객체와 모드 generation을 캡처하고 await 후 비교한다. 같은 경로를 참조하는 item이 여러 개면 각각의 segment 오프셋으로 갱신한다.
- [ ] UI는 다음 두 줄 fragment만 사용하고 `.playlist-comment-local-time` 중복을 playlist 렌더러에서 삭제한다. cutlist 렌더러는 그대로 둔다.

```javascript
const localLabel = range.timingValid === false
  ? '시간 정보 없음' : range.localStartTimecode;
const globalLabel = range.timingValid === false
  ? '' : `전체 ${range.globalStartTimecode}`;
// 기존 escape/highlight 함수를 거쳐 삽입한다.
// .comment-timecode = cutLabel + ' ' + localLabel
// .playlist-comment-global-time = globalLabel
```

- [ ] DOM 테스트: 파일명+로컬1개/전체1개, 컷 배지0개, frame0은 정상, invalid는 seek 비활성. 메모리32/디스크0에서 목록·타임라인·클릭 모두32. 필터와 검색에 null이 문자열 `null`로 노출되지 않아야 한다.
- [ ] `node --test scripts/tests/playlist-comment-index.test.js scripts/tests/playlist-comment-cache.test.js scripts/tests/playlist-comment-panel.test.js` 통과 후 커밋: `댓글 시간은 현재 편집값으로 표시하고 중복 컷 시간을 제거`.

## T2. 완료 클릭의 저장 정체와 늦은 화면 갱신 보호 — R2

**Modify:** `app.js:12933 togglePlaylistAggregateResolvedWithoutNavigation`, `app.js:13031 togglePlaylistAggregateResolved`, `app.js:10359 loadVideo`, `review-data-manager.js:1274 save`, `:1596 hasConcurrentChanges` 인근.

**Create:** `renderer/scripts/modules/playlist-comment-resolution.js`.

**Test:** 신규 `scripts/tests/playlist-comment-resolution.test.js`, 기존 `review-data-manager-save.test.js`, `playlist-continuous-runtime.test.js`, `playlist-comment-panel.test.js`.

**Interfaces:**

- `ReviewDataManager.captureSaveCheckpoint()` → `{contextEpoch,videoPath,bframePath,revision}`.
- `ReviewDataManager.saveThroughCheckpoint(checkpoint): Promise<boolean>` — checkpoint의 revision이 실제 저장된 경우만 true.
- `createPlaylistResolutionQueue({keyForPath})` → `enqueue(intent,run)`, `hasPending(key)`, `lockPaths(paths)`, `drainPaths(paths)`.
- intent = `{key,videoPath,itemId,layerId,markerId,desiredResolved,createdAt,playlistId}`. key는 기존 `getPlaylistAggregateCommentKey(range)`와 videoPath를 함께 써서 playlist가 달라도 충돌하지 않게 한다.
- `lockPaths`는 동기적으로 입력 잠금을 걸고 자기 잠금만 푸는 `release()` 함수를 반환한다. `drainPaths`는 실패한 작업이 있으면 reject한다. 실패 기록은 명시적 재시도 성공 또는 해당 작업 취소로만 해제한다.

- [ ] 저장 test에 ‘기존 save의 IPC가 대기 중일 때 완료 편집 발생 → 두 번째 save가 기존 Promise에 합류 → 첫 write에는 새 편집이 없음’ fixture를 추가한다. 현재 `save()` 계약을 깨지 말고 새 checkpoint API의 test를 RED로 만든다.

```javascript
test('checkpoint needs the write containing its revision', async () => {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const manager = new ReviewDataManager({ autoSave: false });
  manager.currentVideoPath = 'C:/test/a.mp4';
  manager.currentBframePath = 'C:/test/a.bframe';
  manager._changeRevision = 2;
  const checkpoint = manager.captureSaveCheckpoint();
  manager._lastPersistedChangeRevision = 1;
  let saves = 0;
  manager.save = async () => {
    saves += 1;
    manager._lastPersistedChangeRevision = saves === 1 ? 1 : 2;
    return true;
  };
  assert.equal(await manager.saveThroughCheckpoint(checkpoint), true);
  assert.equal(saves, 2);
});
```

- [ ] checkpoint API를 구현한다. `_lastPersistedChangeRevision=-1`을 생성자/새 영상 context에서 초기화하고, `_doSave()`가 성공했으며 아직 같은 context를 소유할 때만 `Math.max(old,savedChangeRevision)`으로 갱신한다. **그 write가 캡처한 savedChangeRevision**을 기록한다. 저장 도중 추가된 편집의 revision까지 저장됐다고 처리하지 않는다.

```javascript
captureSaveCheckpoint() {
  return Object.freeze({ ...this._captureSaveOwner(), revision: this._changeRevision });
}
async saveThroughCheckpoint(checkpoint) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!this._ownsSave(checkpoint)) return false;
    if (this._lastPersistedChangeRevision >= checkpoint.revision) return true;
    if (await this.save() !== true || !this._ownsSave(checkpoint)) return false;
  }
  return this._lastPersistedChangeRevision >= checkpoint.revision;
}
```

- [ ] 완료 handler는 **첫 await 전에** range identity, videoPath, desiredResolved=`!range.resolved`, 화면 generation을 캡처하고 queue에 등록한다. 화면에는 즉시 desired state와 `저장 중`을 표시한다. 오래된 DOM button.disabled만 믿지 않고 렌더할 때 queue의 pending 상태를 반영한다.
- [ ] queue는 같은 videoPath 작업을 직렬화한다. 다른 marker의 저장은 순서대로 실행, 같은 marker 중복 클릭은 기존 Promise를 반환한다. 별개 영상의 작업은 서로 막지 않는다. path 해석 전에도 videoPath queue에 등록되어 있어야 한다.
- [ ] 현재 컷: queue의 run 안에서 원본 marker를 다시 찾고 layerId/deleted/편집 가능 상태를 검사한다. 토글 대신 desiredResolved를 명시적으로 설정한다. `markerUpdated/markersChanged`를 한 번씩 내보내고 checkpoint를 잡은 다음 `saveThroughCheckpoint`를 호출한다. 실패 후 이전 상태를 복구할 때도 같은 context+marker+operation인지 비교한다. 다른 화면의 marker를 건드리지 않는다.
- [ ] 비활성 컷: 최신 `loadReviewSnapshot()` → reviewDocumentId/지원 major 검증 → 지정 layer+marker 하나의 resolved 필드만 변경 → 기존 `expectedVersionToken` CAS로 저장. conflict면 최신 snapshot을 다시 읽고 동일한 **desired state**를 한 번 재적용한다. 총 2회가 넘으면 실패 표시. 다른 댓글/그림/metadata 전체를 낡은 snapshot으로 덮어쓰지 않는다.
- [ ] 비활성 작업이 검사 뒤 current 컷이 되는 경쟁은 `loadVideo`의 path 잠금/대기로 차단한다. `loadVideo` 첫 비동기 대기 **전**, outgoing/incoming videoPath를 lock하고 두 경로 pending을 drain한다. 기존 저장·Fabric flush는 그 뒤 유지한다. 모든 return/catch/finally 경로에서 자기 lock을 release한다. 대기 중 클릭은 `저장 후 이동 중` 표시로 거절한다. 오래된 navigation은 현재 토큰을 다시 확인하고 종료한다.
- [ ] 현재 댓글 수정/일반 해결 버튼에서도 동일 원본에 쓰는 작업이 있으면 같은 queue/checkpoint 정책을 사용한다. 드로잉 저장을 우회하지 않는다. queue timeout으로 진행 중인 파일 write가 중단되었다고 간주하지 않는다.
- [ ] 성공 후 T1의 해당 item만 invalidate/refresh한다. 결과 표시는 현재 playlist+mode generation이 같을 때만 갱신한다. 완료 버튼은 focus/scroll/selected를 이동시키지 않는다. `highlightPlaylistAggregateComment(key)`를 완료 경로에서 제거한다.
- [ ] false/throw면 해당 작업에 `저장 실패 · 다시 시도`. 성공 toast는 실제 checkpoint 또는 CAS 성공 후에만. 화면을 떠난 뒤에는 전체 목록을 다시 그리지 않는다.
- [ ] queue 행동 test: 같은 marker 2연타 write1개, 같은 파일 다른 marker 직렬, 다른 파일 병렬, 늦은 A 성공이 B UI를 안 바꿈, 모드 이탈, 저장 중 재생목록 닫기, 활성 컷 전환 잠금, CAS conflict 재시도에서 2번 토글되지 않음, 실패→재시도→재열기.
- [ ] `node --test scripts/tests/playlist-comment-resolution.test.js scripts/tests/review-data-manager-save.test.js scripts/tests/playlist-continuous-runtime.test.js scripts/tests/playlist-comment-panel.test.js` 통과 후 커밋: `완료 변경을 대상 파일에 끝까지 저장하고 이전 화면 콜백을 차단`.

## T3. 전환 비용 계측과 반복 읽기 축소 — R3

**Modify:** `app.js`의 `loadVideo`, `updatePlaylistContinuousTimeline`, `refreshCommentRangesForCurrentMode`, `refreshVisiblePlaylistProgress`, `updatePlaylistUI`, `renderPlaylistItems`, `updatePlaylistProgress`; `playlist-manager.js:679 getItemProgress`, `:723 getTotalProgress`.

**Create:** `renderer/scripts/modules/playback-transition-metrics.js`.

**Test:** 신규 `scripts/tests/playback-transition-metrics.test.js`, 기존 `playlist-continuous-runtime.test.js`, `playlist-save-ux.test.js`.

**Interface:** `createTransitionMetrics({now,emit,id})` → `{measure(name,operation),mark(name),finish()}`. measure는 async operation 결과/예외를 그대로 유지한다. emit은 한 전환당 한 JSON 요약만. 로그에 댓글 본문·개인 이름·전체 경로는 쓰지 않는다.

- [ ] 테스트는 fake clock으로, 측정 자체가 작업 결과/throw를 바꾸지 않는지 확인한다.

```javascript
test('timing preserves results and records each stage', async () => {
  const { createTransitionMetrics } = await import('../../renderer/scripts/modules/playback-transition-metrics.js');
  let time = 0;
  const reports = [];
  const metrics = createTransitionMetrics({ now: () => time, emit: v => reports.push(v), id: 7 });
  assert.equal(await metrics.measure('reviewSave', async () => { time += 80; return true; }), true);
  metrics.finish();
  assert.equal(reports[0].stages.reviewSave, 80);
  assert.equal(reports[0].id, 7);
});
```

- [ ] 측정 위치: `outgoingSave`, `fabricFlush`, `fileInfo`, `mpvLoad`, `versionScan`, `reviewLoad`, `fabricReady`, `firstPlay`, `commentRefresh`, `total`. `firstPlay`는 호출 시작/성공 시간을 구분한다. 실제 최초 표시 프레임은 별도 관찰값이며 `mpvLoad` 완료와 같다고 적지 않는다.
- [ ] T1 캐시/부분 갱신을 `markersChanged`→`refreshVisiblePlaylistProgress`와 완료 후 진행률에 연결한다. 한 번의 변화로 `updatePlaylistUI` 전체 재렌더를 여러 번 예약하지 않는다. 진행률은 같은 댓글 snapshot에서 계산하고 해당 재생목록 행과 총합 텍스트만 갱신한다.
- [ ] 진행률 API를 `getItemProgress(itemOrBframePath,{readReview=defaultReadReview}={})`, `getTotalProgress({readReview=defaultReadReview}={})`로 확장한다. defaultReadReview는 기존 loadReview 동작이다. 통합 화면 호출자는 현재 컷의 메모리 snapshot/T1 캐시를 선택하는 `readPlaylistCommentSnapshot(bframePath)`를 전달한다. getTotalProgress도 같은 reader를 각 항목에 넘긴다. 항목별 `{total,resolved,percent,hasData}` Map으로 총합을 갱신하고 미수집 항목을 근거 없이0으로 확정하지 않는다.
- [ ] 전체 타임라인 재구성은 목록 구조/정렬/길이/모드 변경에만. 완료·본문 편집·재생 위치는 segment metadata 재수집을 하지 않는다. 초기 전체 읽기는 worker 최대2개, 같은 `.bframe`에는 in-flight Promise1개. 재생 중인 파일의 읽기/저장 우선.
- [ ] 테스트: 100개 컷 fixture에서 한 marker 완료 후 무관한 99개 파일 read0회, 변경 컷 최대1회, mpvProbe0회, timeline clear0회. 최초 scan이 끝나기 전 추가 refresh는 같은 generation에서 합류하며 stale 결과가 현재 화면을 덮지 않는다.
- [ ] 같은 익명 3/5초 영상으로 20회 전환을 기록한다. 저장 없는 전환과 완료 직후 전환을 분리하고 local/Drive, warm/cold를 따로 기록한다. 측정만으로 캐시 비우기나 원본 변환을 강제하지 않는다.
- [ ] `versionScan`이 개선 후에도 전환 p95의 20% 이상이면서 50ms 이상이면 다음 구체 경로를 추가한다. 둘 중 하나라도 미만이면 이 하위 변경은 적용하지 않고 측정표에 적는다.
  1. `VersionManager.setCurrentFile(filePath,{deferScan=false}={})` 추가. 현재 파일 identity/기본 버전은 즉시 설정. 다른 컷의 버전 목록은 즉시 비운다.
  2. `scanVersions`는 시작한 `filePath`와 증가하는 `_scanGeneration`을 캡처한다. IPC 결과 후 둘 다 같을 때만 `_versions`, `_baseName`, `_currentVersion`을 적용한다. 기존 `_isScanning`만으로 새 파일 scan을 생략하지 않는다.
  3. 자동 연속 전환(`preserveContinuousSession && playWhenMediaReady`)만 deferScan=true. 리뷰 로드·Fabric 준비·재생 시작 이후 `void scanVersions().catch(log...)`로 실행한다. 수동 버전 전환과 `keepVersionContext` 계약은 유지한다.
  4. 이전 버전 리뷰 버튼은 새 scan 완료 전 해당 컷의 미확정 상태로 표시하고 이전 컷의 목록을 재사용하지 않는다. A scan 느림→B scan 빠름 테스트에서 B만 표시되어야 한다.
- [ ] mpv 프로세스 재사용은 현행 `MPVManager.start()`에 이미 있다. 프로세스2개, 전체 영상 미리 변환, 모든 컷 동시 다운로드, cache-pause 제거, 임의 sleep 감소를 이번 기본 수정에 넣지 않는다. `paused-for-cache/core-idle/time-pos/cache duration` 증거로 저장 대기와 미디어 읽기 대기를 구분한다.
- [ ] 성능 완료 기준: 해당 항목 부분 갱신 조건 충족, UI 클릭의 pending 표시 100ms 이내, warm local 무편집 전환 p95가 baseline보다 악화되지 않음. **0ms 전환/Drive 지연 완전 제거를 보장하지 않는다.**
- [ ] 관련 검사 통과 후 커밋: `전환 구간을 측정하고 댓글 갱신을 변경된 컷으로 제한`.

## T4. 드로잉 중 댓글 포인트를 입력 대상에서 제외 — R4

**Modify:** `app.js:11431 setCommentOverlaysDrawingPassthrough`, `handleFabricDrawingPilotStateChange`, `renderSingleMarker`의 마커 drag/click/hover, `getMpvOverlayState`, `main.css`, `main/mpv-overlay-host.js:1985 normalizeOverlayState` 및 HTML template/apply 함수.

**Test:** 신규 `scripts/tests/drawing-comment-passthrough.test.js`, 기존 `mpv-overlay-host.test.js`, `mpv-runtime-source.test.js`.

**Interface:** 새 overlay 상태 `commentInteractionBlocked:boolean`. 생략은 기존 상태 유지, 명시 false는 해제. 저장 데이터가 아닌 화면 상태다.

- [ ] RED: Fabric active가 `state.isDrawMode=true`인데 passthrough=false가 되는 재현을 행동 test로 옮긴다. legacy/Fabric active/preparing/recovering/failed/off 상태를 모두 검사한다.
- [ ] `setDrawModeReadyState(false)`는 레거시 캔버스를 끄는 목적을 유지한다. 댓글 차단 결정을 그 함수에서 분리하고, 별도 `syncCommentInteractionPolicy()`에서 실제 입력 소유권으로 계산한다.

```javascript
function syncCommentInteractionPolicy() {
  const blocked = state.isDrawMode || isFabricDrawingPilotControllerEngaged();
  setCommentOverlaysDrawingPassthrough(blocked);
  scheduleMpvOverlayStateSync();
}
```

- [ ] 컨트롤러 상태 전환을 모두 반영한 **뒤** 위 함수를 호출한다. preparing/회복 중에도 댓글 입력을 받지 않는다. passive/off/실패 후 실제 드로잉 종료 시 차단을 해제한다. legacy ready 토글 뒤 반대 값으로 재덮지 않게 한다.
- [ ] 메인 CSS에 `.drawing-active` 아래 `.comment-marker`, `.marker-replies-badge`, `.comment-marker-input-wrapper` 및 body drawing mode의 tooltip 자손까지 `pointer-events:none!important`. 일반 댓글 목록 입력창에는 적용하지 않는다. pinned tooltip은 모드 진입 때 닫는다.
- [ ] click/mousedown/hover handler 처음에 같은 차단 조건으로 return하여 CSS 우회/이미 붙어 있는 리스너도 방어한다. 드로잉 진입 전에 진행 중이던 marker drag를 종료하고 document 리스너를 제거한다.
- [ ] `getMpvOverlayState()`에 boolean을 항상 보내고 normalizeOverlayState에서 boolean만 허용한다. HTML `__applyMpvOverlayState`는 명시된 값만 body class로 적용한다. main stylesheet의 부모 클래스가 미러로 전달될 것이라고 가정하지 않는다.

```css
body.comment-interaction-blocked #markerMirror,
body.comment-interaction-blocked #markerMirror *,
body.comment-interaction-blocked #tooltipMirror,
body.comment-interaction-blocked #tooltipMirror * {
  pointer-events: none !important;
}
```

- [ ] 테스트에서 댓글 점/답글 배지 위 pointerdown이 drawing canvas에 전달되고 댓글 위치/선택/답글 팝업이 안 바뀌는지 확인. 드로잉 종료 후 점 클릭/이동 복원. pen/mouse와 레이어 잠금 상태 포함.
- [ ] `node --test scripts/tests/drawing-comment-passthrough.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js` 통과 후 커밋: `드로잉 입력 소유권에 따라 댓글 포인트 클릭을 차단`.

## T5. 수정·답글 멘션과 편집창 수명 안정화 — R5

**Modify:** `mention-manager.js`의 `attach`, `_handleInput`, `_handleKeyDown`, dropdown pointer 선택; `app.js`의 `startReplyEdit`, `renderPlaylistContinuousCommentList`, `updateCommentListImmediate`, `openThreadPopup`.

**Create:** `renderer/scripts/modules/comment-edit-session.js`.

**Test:** 신규 `scripts/tests/mention-manager-editors.test.js`, `scripts/tests/comment-edit-session.test.js`; 기존 `mention-manager-popout.test.js`, `comment-input-focus-source.test.js`.

**Interfaces:**

- `MentionManager.isVisibleFor(element):boolean` — 다른 입력창의 팝업 때문에 현재 입력창 Enter가 막히지 않도록 사용.
- `createCommentEditSession()` → `begin({key,element})`, `isEditing()`, `getElement()`, `deferRefresh(fn)`, `end({flush=true}={})`. 편집 중 refresh는 마지막 것 하나만 저장. 종료 시 한 번 적용. element는 실제 DOM을 보존하며 draft를 다른 marker에 옮기지 않는다.

- [ ] JSDOM test fixture에 textarea와 contenteditable 각 하나를 만들고 기존 `MentionManager`를 실제로 붙인다. `확인@테`는 표시, `abc@te`는 미표시, 공백/@ 단독/괄호/본문 중간 삽입/선택 범위 보존을 테스트한다.
- [ ] 조합 Enter가 멤버 선택과 form submit 어느 쪽에도 소비되지 않는 테스트를 추가한다.

```javascript
const event = new win.KeyboardEvent('keydown', {
  key: 'Enter', code: 'Enter', isComposing: true, bubbles: true, cancelable: true
});
textarea.dispatchEvent(event);
assert.equal(event.defaultPrevented, false);
assert.equal(textarea.value, '확인 @테');
```

- [ ] 각 attached entry에 composing flag를 둔다. compositionstart=true, compositionend=false 후 `_handleInput` 재실행. `_handleKeyDown` 시작에 `e.isComposing || e.keyCode===229 || entry.composing`이면 return. detach 시 composition 리스너도 제거한다. keyCode229를 정의한 별도 test 포함.
- [ ] 앞 문자 경계를 다음으로 바꾼다. 이메일 앞 토큰을 허용하는 단순 ‘항상 true’로 바꾸지 않는다.

```javascript
const previous = atIndex > 0 ? beforeCursor[atIndex - 1] : '';
const asciiEmailPrefix = /[A-Za-z0-9_.+\-]/.test(previous);
if (atIndex > 0 && asciiEmailPrefix) {
  this.hide();
  return;
}
```

- [ ] `__mentionHandled`는 실제 소비한 ArrowUp/Down/Enter/Escape/Tab에만 설정한다. Enter/Tab/Escape 처리 후 같은 element에 뒤늦게 등록된 form handler까지 실행되지 않도록 필요한 경우 stopImmediatePropagation. popup 닫힘 뒤 `isVisible` false만 보고 같은 Enter로 전송되지 않도록 form 쪽도 `e.defaultPrevented || e.__mentionHandled || e.isComposing`를 확인한다.
- [ ] dropdown 선택은 pointerdown 우선으로 pen을 지원한다. mousedown fallback은 실제 PointerEvent 미지원 문서에서만 설치해 중복 삽입을 막는다. textarea.ownerDocument에서 createElement/selection을 사용하고 Event 생성자/타이머는 그 문서의 defaultView를 사용한다. contenteditable은 `isContentEditable` 또는 `contenteditable`의 `true/plaintext-only`를 인정한다.
- [ ] 기존 attach가 이미 있는 코드를 반복 추가하지 않는다. 입력창 scope는 신규 댓글, marker 입력, 인라인 원문 수정, 인라인 답글 작성, 인라인 답글 수정, 통합 목록 답글, 스레드 작성/수정, 분리창으로 옮긴 동일 항목이다.
- [ ] `comment-edit-session`으로 입력 중 해당 목록의 innerHTML 전체 교체를 미룬다. 본문/답글 폼 진입과 focusin에서 begin, 저장/취소 시 end. dropdown으로 포인터가 이동하는 것은 편집 종료가 아니다. remote 데이터 수신·진행률 계산은 계속 가능하지만 편집 DOM을 파괴하지 않는다.
- [ ] navigation 때 dirty draft는 기존 초안 정책을 유지하여 대상별로 보존하거나 기존 확인 절차를 사용한다. 자동 refresh 때문에 다른 댓글에 초안을 복원하지 않는다. 원본 marker가 원격 삭제되면 해당 편집을 종료하고 복사 가능한 초안을 보존하며 경고한다.
- [ ] task T2의 완료·T6의 시간 강조는 전체 재렌더 대신 해당 클래스/텍스트만 갱신하므로 편집창과 공존하게 한다.
- [ ] 테스트 매트릭스: 각 입력면에서 `@테`→후보 선택→이름1번 삽입, 한글 조합 완료 Enter는 전송0회, 다음 Enter는 후보 선택1회, 그 다음 Enter는 해당 폼 정책에 맞게 처리. 분리/재부착 후 같은 동작. refresh/원격 변경 중에도 draft·selection·focus 유지.
- [ ] `node --test scripts/tests/mention-manager-editors.test.js scripts/tests/comment-edit-session.test.js scripts/tests/mention-manager-popout.test.js scripts/tests/comment-input-focus-source.test.js` 통과 후 커밋: `한글 멘션 입력과 편집창 수명을 보호해 수정과 답글 태그를 복구`.

## T6. 현재 프레임에 해당하는 댓글 강조 — R6

**Modify:** `app.js:1700 syncPlaybackPositionUI`, `timeline scrubbing` handler, 각 목록 render 끝; `renderer/styles/main.css`.

**Create:** `renderer/scripts/modules/comment-playback-highlight.js`.

**Test:** 신규 `scripts/tests/comment-playback-highlight.test.js`.

**Interfaces:** `getActiveCommentKeys(ranges,{mode,currentFrame,globalTime,currentItemId}):Set<string>`, `applyCommentPlaybackHighlight(container,keys):void`. 각 range는 `{key,startFrame,endFrame,itemId,globalStartTime,globalEndTime,timingValid}`. 신규 `data-playback-comment-key`는 기존 데이터 identity에서 생성하며 저장하지 않는다.

- [ ] 계산 test부터 작성한다.

```javascript
test('all overlapping ranges are active without changing selection', async () => {
  const { getActiveCommentKeys } = await import('../../renderer/scripts/modules/comment-playback-highlight.js');
  const ranges = [{ key: 'a', startFrame: 24, endFrame: 48 },
    { key: 'b', startFrame: 32, endFrame: 64 }, { key: 'c', timingValid: false }];
  const keys = getActiveCommentKeys(ranges, { mode: 'single', currentFrame: 32 });
  assert.deepEqual([...keys], ['a', 'b']);
});
```

- [ ] 단독보기/동일 컷의 이전 리뷰는 local frame으로 판정한다. playlist continuous는 global time과 item identity를 함께 사용해 앞 컷의 끝 댓글이 다음 컷에서 활성화되지 않게 한다. cutlist는 기존 global interval을 사용하며 원본의 startFrame을 전체 시간과 직접 비교하지 않는다.
- [ ] 정규화할 때 시작/끝 위치를 보존한다. 잘못된 시간·deleted·필터 제외 항목은 대상에서 뺀다. playlist/cutlist/previous-review에 동일 markerId가 있어도 출처를 포함한 다른 key를 사용한다.
- [ ] `syncPlaybackPositionUI`에서 프레임 변경을 처리하는 분기에 강조 갱신을 연결한다. 스크럽 중에는 미리보기 위치를 사용하고 취소하면 실제 재생 위치로 되돌린다. T9의 최종 seek 후에는 확정 frame으로 갱신한다.
- [ ] 선택 색과 함께 구분되는 연한 배경과 안쪽 선을 CSS로 추가한다. 기존 aria-label을 보존하고 `data-current-frame`으로 상태를 노출한다. 여러 항목에 aria-current를 붙이지 않는다.

```css
.comment-item.is-current-frame {
  box-shadow: inset 3px 0 0 var(--accent-primary);
  background-color: var(--bg-tertiary);
}
```

- [ ] DOM을 재생성하지 않고 이전 active keys와 현재 keys의 차이만 classList.toggle한다. 새 DOM은 render 직후 한 번 적용한다. 단독/통합/분리창 모두 실제 `elements.commentsList` 참조를 사용한다.
- [ ] 자동 스크롤은 추가하지 않는다. 500개 댓글 fixture에서 같은 프레임에 한 번 이하로 계산한다. DOM 행 탐색용 key→element Map은 목록/필터/모드가 바뀔 때만 만든다. 매 재생 tick에 전체 querySelector/innerHTML 교체를 하지 않는다.
- [ ] 테스트: 시작/끝/전후1frame, 겹침, 해결됨, 검색, 다른 컷의 동일 markerId, 분리창, 편집 중 focus/selection/scrollTop 유지. DOM innerHTML setter를 감시해 재생 위치 갱신에서는 호출이 0회인지 확인한다.
- [ ] `node --test scripts/tests/comment-playback-highlight.test.js scripts/tests/comment-panel-popout.test.js` 통과 후 커밋: `현재 재생 구간의 댓글을 입력과 스크롤을 방해하지 않고 강조`.

## T7. 메인 화면의 태블릿 드래그 이동 — R7

**Modify:** `app.js:6245`의 video pan mouse listeners, `main.css` 영상 pan surface.

**Create:** `renderer/scripts/modules/video-pan-gesture.js`.

**Test:** 신규 `scripts/tests/video-pan-gesture.test.js`, 기존 `video-pan-controls.test.js`.

**Interfaces:** `createVideoPanGesture({canStart,getTransform,onChange,onFinish})` → `{pointerDown(e),pointerMove(e),pointerUp(e),cancel()}`. transform=`{scale,panX,panY}`, onChange는 absolute `{panX,panY}`. scale은 양수이며 client 좌표는 CSS px다.

- [ ] 다음 이동량 테스트를 mouse/pen/touch 각각 실행한다.

```javascript
for (const pointerType of ['mouse', 'pen', 'touch']) {
  test(`pan uses CSS pixels for ${pointerType}`, async () => {
    const { createVideoPanGesture } = await import('../../renderer/scripts/modules/video-pan-gesture.js');
    const updates = [];
    const gesture = createVideoPanGesture({ canStart: () => true,
      getTransform: () => ({ scale: 2, panX: 5, panY: 7 }),
      onChange: value => updates.push(value), onFinish: () => {} });
    const base = { pointerId: 3, pointerType, isPrimary: true, button: 0,
      target: {}, preventDefault() {}, stopPropagation() {} };
    gesture.pointerDown({ ...base, clientX: 10, clientY: 20 });
    gesture.pointerMove({ ...base, buttons: 1, clientX: 50, clientY: 40 });
    assert.deepEqual(updates.at(-1), { panX: 25, panY: 17 });
    gesture.pointerUp({ ...base, clientX: 50, clientY: 40 });
  });
}
```

- [ ] transform을 pointerdown 시점에 캡처한다. 이동량은 `initialPan + (currentClient-startClient)/initialScale`로 계산한다. devicePixelRatio를 곱하지 않는다. 놓은 좌표에서도 마지막으로 한 번 갱신한다.
- [ ] primary, button0, 편집 입력/버튼/슬라이더/툴바 밖, canPanVideo=true 조건에서만 시작한다. `setPointerCapture(pointerId)`는 try/catch로 보호하고 다른 pointerId의 move/up은 무시한다.
- [ ] `pointercancel`, `lostpointercapture`, window blur, 영상/모드 변경, dispose에서 반드시 종료한다. pointerup이 capture를 풀어서 생긴 lostcapture가 두 번 확정하지 않게 한다. pen hover(buttons0)로 새 pan을 시작하지 않는다.
- [ ] 기존 mousedown/mousemove/mouseup의 pan 부분을 교체해 PointerEvent와 호환 mouse 이벤트가 중복 이동시키지 않게 한다. 기존 가운데 버튼 스크럽은 별도 분기로 유지하고 중복 처리하지 않는다.
- [ ] CSS `touch-action:none`은 pan/drawing canvas에만 적용한다. 댓글 입력이나 페이지 전체 스크롤에 적용하지 않는다.
- [ ] 이동 중 최신 값을 rAF 한 번으로 합쳐 `applyVideoZoom()`에 반영한다. end에서는 미반영 값을 즉시 반영한다. 화면 이동만으로 drawing document/save/undo를 변경하지 않는다.
- [ ] `node --test scripts/tests/video-pan-gesture.test.js scripts/tests/video-pan-controls.test.js`. 기존 정규식 테스트에서 mouse-only 코드를 강제하는 부분만 pointer 계약에 맞추고 행동 테스트로 보완한다. 통과 후 커밋: `화면 이동을 포인터 입력으로 통일해 펜 드래그를 지원`.

## T8. Fabric 오버레이의 Space 임시 화면 이동 — R8, R7의 새 엔진 경로

**Modify:** `app.js:14749 handleKeydown`, `handleKeyup`, overlay keyboard callback; `mpv-fabric-overlay-runtime.js`의 `onPointerDown/Move/Up/Cancel`, 기존 pointerdown 보류/재생 경로; `preload/mpv-overlay-preload.js`, `preload/preload.js`, `main/mpv-overlay-host.js`.

**Create:** `shared/viewport-pan-message.js`, `scripts/tests/viewport-pan-message.test.js`, `scripts/tests/mpv-viewport-pan.test.js`.

**공개 전달 계약:**

```javascript
// 새 전용 IPC: mpv-overlay:viewport-pan
// overlay → main renderer. start는 입력 소유권 확인 요청이다.
// start/move/end/cancel 모두 아래 key만 허용한다.
{
  phase: 'start',
  gestureId: 'pan-unique-id',
  sequence: 0,
  pointerId: 3,
  clientX: 120,
  clientY: 80,
  hostGeneration: 1,
  videoGeneration: 2,
  persistenceSessionId: 'current-session',
  stableVideoIdentity: 'current-video'
}
```

**Interfaces:** `normalizeViewportPanMessage(value):object|null`, `normalizeViewportPanCommand(value):object|null`. 오버레이 preload는 `mpvOverlayViewportPan.send(value):boolean`과 `onCommand(callback):unsubscribe`; 메인 preload는 `onMpvOverlayViewportPan(callback):unsubscribe`와 `sendMpvOverlayViewportPanCommand(value):boolean`을 노출한다. CJS shared validator는 main/preload가 require하고 renderer는 번들이 지원하는 import로 같은 규칙을 사용한다.

**응답 계약:** 역방향 전용 채널 `mpv-overlay:viewport-pan-command`. 공통 필드는 `{type,gestureId,sequence,pointerId,hostGeneration,videoGeneration,persistenceSessionId,stableVideoIdentity}`. type은 `decision|flush|ack|cancel`. decision에만 `{disposition:'pan'|'draw'|'blocked',transform:{scale,panX,panY}}`를 추가하고, ack에만 `{transform:{scale,panX,panY}}`를 추가한다. flush/cancel에는 추가 필드가 없다. transform은 유한한 숫자, scale은 양수이며 기존 zoom 허용 범위를 따른다.

- [ ] validator RED: 알려지지 않은 key/phase/type, NaN/Infinity, 음수 pointerId/generation/sequence, 잘못된 session, 배열/특이 prototype을 거절한다. gestureId 길이1~256, session/identity 길이1~32768은 기존 `readFence`와 동일하게 한다. 좌표 절댓값≤1,000,000, 정수 필드는 nonnegative safe integer. start sequence는0, 후속은 증가해야 한다.
- [ ] native host는 정방향의 실제 sender가 현재 overlay webContents인지, 역방향은 현재 main webContents인지 검증한다. 양방향 모두 host/video/session/**stableVideoIdentity**가 현재 값과 같을 때만 전달한다. 전달 함수에 임의 채널 인자를 받지 않는다.
- [ ] **키보드 소유자는 계속 메인 renderer 하나다.** 기존 host `before-input-event`→메인 keyboard relay와 preventDefault를 유지한다. 런타임 `onOverlayKeyDown`에서 Space 재생 토글을 추가하지 않는다. `handleKeydown`의 Fabric 제외 조건을 제거하고 Space를 누른 동안 main의 `isSpaceHeld`, key cycle, consumed를 관리한다. 반복 down은 무시한다.
- [ ] 단축키 UX를 확정한다: 드로잉 중 Space는 임시 pan modifier다. Space tap의 재생/정지는 현재 사용자 `playPause` 또는 `playPauseAlt` 설정이 해당 Space 입력과 일치할 때만 수행한다. 재생 키가 다른 키로 바뀌었으면 Space tap은 아무 일도 하지 않고 재지정한 키는 기존대로 재생한다. 새 설정 action이나 중복 단축키를 만들지 않는다. 입력창/IME/단축키 캡처/스레드 팝업 차단은 기존 정책을 유지한다.
- [ ] 런타임의 primary pointerdown에서 active stroke/lasso/select/erase/shape가 없으면 **드로잉 프레임 확정 전에** start를 전송한다. 이때 pointer capture하고 down/move/up을 기존 pointerdown 보류 방식과 같은 버퍼에 보관한다. Space 상태를 늦게 도착한 미러 값만 보고 결정하지 않는다. 메인은 start 수신 시 실제 `isSpaceHeld`와 `canPanVideo()`를 동기적으로 판정한다: Space+pan 가능→pan, Space+고정 상태→blocked, Space 아님→draw.
- [ ] decision=pan이면 메인은 원래 transform과 시작 좌표를 보존하고 런타임은 T7의 같은 이동 수식을 사용한다. decision=draw이면 보관한 down을 기존 `requestPointerdownFrame` 경로에 한 번 전달하고 나머지 이벤트도 기존 순서로 재생한다. 재생 플래그로 start 확인을 다시 요청하는 재귀를 막는다. blocked/cancel/응답 실패는 입력을 폐기하고 capture를 정리한다. 검증 없이 그리기로 fallback하지 않는다.
- [ ] 이 소유권 확인은 실제 드로잉의 숨김/잠금 레이어 검사보다 앞에 둔다. 잠긴 레이어 위에서도 화면 이동은 가능하지만 draw 판정 이후 기존 편집 잠금 검사는 그대로 수행한다. 기존 Alt 크기 조절과 Space가 함께 눌리면 Space pan을 우선한다.
- [ ] pan 확정 뒤에는 Fabric draw/select/erase에 해당 pointerdown을 전달하지 않는다. move는 런타임 viewport에 즉시 반영하고 main에 rAF 최대1회 전송한다. main도 같은 시작 좌표/scale로 계산해 `applyVideoZoom()`하고 ack를 반환한다. ack와 일반 mirror state에 `{gestureId,sequence}`를 붙여 더 오래된 결과가 진행 중인 viewport를 되돌리지 못하게 한다. 줌 값에 DPI를 곱하지 않는다.
- [ ] Space keyup 시 pan 요청/gesture가 진행 중이면 메인은 flush를 보내 최종 좌표의 end를 받은 뒤 tap 여부를 확정한다. 런타임은 보류 중인 마지막 move도 end보다 먼저 반영한다. 이동 거리 최대값이3 CSS px 이상이면 consumed=true를 유지한다. 되돌아온 최종 거리가0이어도 이미 소비한 Space가 재생되지 않는다. 응답 유실/세션 변경/timeout은 cancel 처리하며 재생하지 않는다.
- [ ] pointerup으로 pan이 먼저 끝나도 같은 key cycle의 consumed를 Space keyup까지 보존한다. 포인터 없이 Space만 눌렀다 놓으면 메인의 `handleUserPlayPauseToggle()`만 한 번 실행한다. runtime/host에 별도 tap action을 만들지 않는다. stroke 도중 Space는 그 stroke를 pan으로 바꾸지 않으며 다음 pointerdown부터 적용하고, 기존 획 처리 중 들어온 Space의 keyup은 재생하지 않는다.
- [ ] cancel/lostcapture/앱 바깥 blur/videoChange/disable은 gesture와 key cycle을 정리한다. 메인→동일 세션의 native overlay로 포커스가 이동한 경우만 modifier를 보존한다. 실제 활성 창을 host가 확인한 handoff일 때만 예외를 허용하고, 앱 외부로 나갔다 들어오면 이전 Space 상태를 복구하지 않는다.
- [ ] 런타임 tests: Space+pen/mouse, keydown 직후 같은 tick의 pointerdown, up이 decision보다 먼저 도착, 늦은 ack, keyup flush, pointercancel, 앱 외부 blur와 내부 포커스 이동, 키 유실, stale IPC, 중복 move/up, draw/erase/select 진행 중, center lock, 잠긴 레이어, 댓글 포인트, 재지정 키, Space 반복. pan에서 획/undo 증가는0이며 zoom/pan만 변해야 한다. 일반 그리기에서는 기존 pointerdown 프레임 확정과 입력 지연이 악화되지 않는지 별도 측정한다.
- [ ] `npm run bundle:mpv-fabric-overlay` 후 `node --test scripts/tests/viewport-pan-message.test.js scripts/tests/mpv-viewport-pan.test.js scripts/tests/mpv-overlay-preload.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-overlay-keyboard-relay.test.js scripts/tests/mpv-fabric-overlay-runtime.test.js scripts/tests/video-pan-controls.test.js`.
- [ ] 커밋: `Space 임시 이동을 Fabric 오버레이까지 연결하고 펜 입력 충돌을 방지`.

## T9. 프레임바의 최종 좌표와 정확한 프레임 이동 — R9

**Modify:** `timeline.js:511 _getTimelineTimeFromCellPercent`, `_seekFromClick`, `_scrubFromClick`, `_finishScrubbing`; `app.js:1989 timeline seek`, `seekContinuousTimeline`, `seekCutlistTimeline`.

**Test:** 신규 `scripts/tests/timeline-scrub-frame.test.js`, 기존 `timeline-frame-ui-source.test.js`, `playhead-frame-step-source.test.js`, `playlist-continuous-runtime.test.js`.

**Interfaces:** timeline seek detail=`{time,displayFrame,localFrame,itemId?,cutId?,frameExact:true}`. 기존 time 소비 코드와 호환성을 유지한다. time만 있는 외부 seek를 모두 frameExact로 처리하지 않는다.

- [ ] 실제 `Timeline` 메서드를 호출하는 셀 경계 테스트를 먼저 추가한다. 테스트 파일 상단에 `import assert from 'node:assert/strict'; import test from 'node:test'; import { Timeline } from '../../renderer/scripts/modules/timeline.js';`를 둔다. 기존 테스트 로더가 CJS라면 같은 세 import를 dynamic import로 읽는다.

```javascript
test('timeline cell 58 seeks frame 58 and its left neighbour stays 57', () => {
  const context = {
    fps: 24,
    _getTimelineDuration: () => 100 / 24,
    _getDisplayTotalFrames: () => 100,
    _getSegmentTimeFromDisplayFrame: () => null
  };
  const convert = Timeline.prototype._getTimelineTimeFromCellPercent;
  assert.equal(convert.call(context, 0.58), 58 / 24);
  assert.equal(convert.call(context, 0.5799), 57 / 24);
});
```

- [ ] `_getTimelineTimeFromCellPercent`에서 `raw=percent*totalFrames`, `tolerance=8*Number.EPSILON*Math.max(1,Math.abs(raw))`, `frame=Math.floor(raw+tolerance)`로 계산한 후 기존 범위 제한을 적용한다. round/+1 보정은 금지한다. scroll/DPR 오차를 큰 epsilon으로 숨기지 않는다.
- [ ] `_finishScrubbing(e)`는 정상 pointerup이면 **현재** tracksContainer rect와 e.clientX로 최종 셀을 재계산한다. 자동 스크롤 후 새 rect를 사용한다. 마지막 move가57, release가58이면58을 내보내는 실제 메서드/DOM 테스트를 추가한다. cancel/lostcapture는 드래그 시작 위치로 되돌린다.
- [ ] playhead pointerdown에 시작 frame/client position을 보관하고 같은 pointerId만 추적하며 setPointerCapture한다. move 없는 pointerup은 클릭 위치 규칙을 따른다. ruler 클릭 뒤 호환 click 때문에 seek가 두 번 실행되지 않게 한다.
- [ ] 해당 셀에서 displayFrame과 segment/localFrame을 한 번 계산해 time과 같이 전달한다. 혼합 FPS playlist는 `_getSegmentTimeFromDisplayFrame`과 같은 segment 프레임 수를 사용한다. 전체 frame을 global time×현재 영상 fps로 계산하지 않는다.
- [ ] 단독 영상의 frameExact seek는 `videoPlayer.seekToFrame(localFrame)`으로 보낸다. 기존 내부의 작은 시간 offset/목표 frame 유지 장치를 사용하고 일반 `seek(time)`를 전부 바꾸지 않는다.
- [ ] continuous/cutlist는 해당 item의 load가 확정된 뒤 그 item의 localFrame을 seekToFrame에 넘긴다. 이전 영상 fps로 미리 반올림하지 않는다. target item/load intent가 바뀌었으면 중단한다. broadcast는 정규화된 global time을 전송하고 수신 측 기존 매핑과 일치시킨다.
- [ ] `video-player.js`는 실제 status 응답으로 목표 frame을 잃는 재현이 있을 때만 추가 수정한다. 기존 `_pausedSeekHoldFrame`, `_seekTargetFrame`, `_invalidateExternalStatus`를 보존한다. 표시 번호만 N이고 실제 영상이 N-1인 상태를 통과로 처리하지 않는다.
- [ ] 테스트 범위: 0/마지막/N, 양방향 드래그, 셀 경계/중앙/경계 직전, scroll, 타임라인200% 확대, DPR1/1.25/1.5/2, 23.976/24/29.97/30/60fps, 혼합 playlist 경계, 같은 원본을 쓰는 cutlist 경계. 실기는 프레임 번호가 영상에 표시된 테스트 파일로 확인한다.
- [ ] `node --test scripts/tests/timeline-scrub-frame.test.js scripts/tests/timeline-frame-ui-source.test.js scripts/tests/playhead-frame-step-source.test.js scripts/tests/playlist-continuous-runtime.test.js` 통과 후 커밋: `프레임바를 놓은 좌표를 정수 프레임으로 확정해 한 프레임 오차를 수정`.

## T10. 통합 검증·인수인계

- [ ] package.json에 신규 test 파일이 실제 실행되도록 관련 test script에 명시적으로 추가한다. 테스트 파일만 만들고 기존 CI 명령에서 빠뜨리지 않는다.
- [ ] 새로운 행동 tests와 다음 관련 suite를 실행한다. 같은 성공 검사를 새 변경 없이 반복하지 않는다.

```powershell
npm run test:playlist
npm run test:mpv
npm run test:frame-grid
npm run test:comment-input
npm run test:comment-popout
npm run test:ux
npm run test:fabric-drawing-persistence
npm run test:fabric-drawing-pilot
```

- [ ] runtime을 바꿨으면 번들 소스와 생성 결과를 함께 리뷰. DOM 마커 표시만 고친 task와 IPC/pointer packet 변경 task의 diff를 분리해 검토한다.
- [ ] 실제 앱 검증용 별도 userData/익명 fixture로 실행한다. 현재 사용자 앱 종료/재시작 금지. native 펜 테스트가 불가능하면 해당 칸을 ‘미수행’으로 남긴다.

| 시나리오 | 성공 판정 |
|---|---|
| 3개 컷의 통합 댓글 선택 | 각 컷 로컬 frame과 전체 위치 일치, 중복 컷 배지 없음 |
| frame0 댓글과 잘못된 시간 댓글 | 첫 프레임 정상 표시, 잘못된 값은 시간 정보 없음 |
| 댓글 이동 후 저장 대기 중 전체 목록 보기 | 새 메모리 위치 유지, 디스크 이전 값으로 후퇴하지 않음 |
| 완료→50ms 내 다음 컷 클릭→다시 돌아오기 | 정확한 원본에 완료 저장. 늦은 focus/목록 덮어쓰기 없음 |
| 저장 실패/충돌/다른 PC 편집 | 거짓 성공 없음, 실패 표시/재시도, 다른 댓글/그림 보존 |
| 댓글 점/답글 배지 위로 그림 그리기 | 끊김/포인트 이동/팝업 없음. 끄면 댓글 입력 복원 |
| 모든 편집면에서 한국어 @태그 | 검색·키보드/펜 선택, 조합 Enter 오전송 없음 |
| 답글 작성 중 재생·완료·원격 갱신 | 입력 DOM/초안/포커스 유지 |
| 재생/정지/스크럽/키보드 프레임 | 해당 댓글만 강조, 자동 스크롤/seek 없음 |
| mouse와 실물 태블릿의 pan | 같은 CSS 이동량, 캔버스 밖 release 정상 종료 |
| Space tap/hold+drag/repeat/blur | tap만 재생, drag는 화면 이동만, sticky 상태 없음 |
| 드래그 종료 frame N | 영상 burned-in N, UI N, 새 드로잉 저장 frame N |
| 3초 컷 반복 + EOF 중복 + pause/resume | 건너뜀/정지/검은 화면 회귀 없음 |

- [ ] .bframe 저장 전후 JSON 비교: 댓글 의도한 필드 외, drawingsV3/root envelope/version/manualVersions/레이어/다른 댓글 보존. 재열기·동시 편집 포함.
- [ ] DEVLOG에 R1~R9 각각 구현됨/자동검증/실기검증/미확인으로 분리해서 기록한다. 성능은 raw timing JSON과 local/Drive 조건, 횟수, median/p95를 함께 남긴다.
- [ ] 기능표 `docs/drawing-keyframe-features.md`의 입력 관련 최신 상태만 갱신. 과거 수치를 이번 실행 통과 수치로 복사하지 않는다.
- [ ] 사용자 보고는 쉬운 한국어로 바뀐 동작, 실제 검사 결과, 태블릿 등 남은 실기를 명시한다. 구현 요청만 받은 실행자는 PR/배포 권한을 추정하지 않는다.

## 4. 다음 구현 모델에게 그대로 전달할 프롬프트

```text
BAEFRAME의 docs/superpowers/plans/2026-09-14-review-playback-input-plan.md를 읽고 구현해줘.
이 문서 §1이 요구사항, §2는 조사 당시의 증거, T0~T10은 구현 순서다.
T0 → T1 → T2 → T3 → T4 → T5 → T9 → T6 → T7 → T8 → T10 순서로 진행해.
기존 dirty 작업과 실행 중 앱/개인 데이터는 보존하고 origin/main 기반 별도 worktree를 사용해.
원인 재현 test를 먼저 만들고 제품 코드를 고친 뒤 task별 관련 검사와 한국어 커밋을 남겨.
R1의 실제 0프레임을 오류로 바꾸지 말고 R3의 Drive 지연을 완전 제거했다고 단정하지 마.
새 엔진의 실제 오버레이/포인터 경로까지 고치고 생성 번들을 포함해.
명시한 UX 결정은 다시 묻지 말고 적용해. 실제 사용자 파일에 검증용 댓글/그림을 쓰지 마.
테스트/빌드/실물 태블릿 검증을 구분해서 보고하고, PR/머지/배포/Slack 게시를 임의로 실행하지 마.
```
