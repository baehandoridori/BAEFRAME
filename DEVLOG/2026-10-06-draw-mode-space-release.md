# 그리기 모드에서 Space 재생이 안 되던 문제 (2026-10-06)

브랜치 `claude/draw-mode-space-playback`, 기준 `5e10a41`(v2.13.0-beta). 2.13.1-beta 로 올린다(버그 수정). 머지·빌드·배포 근거는 `output/releases/2026-10-06-v2.13.1-beta/` 에 남긴다.

## 신고

2.13.0-beta 배포 직후 사용자 신고: "B를 눌러서 들어간 드로잉 모드에서 재생은 여전히 안되고 있어." 이번 팔레트 작업으로 생긴 문제가 아니라 그 전부터 있던 문제다.

## 재현

배포한 것과 해시가 같은 빌드(`dist/win-unpacked`, 머지 `5e10a41`)를 격리 프로필(`--multi-instance-user-data`)과 12초짜리 시험 영상으로 띄우고, DevTools 프로토콜로 키·마우스를 넣어 확인했다. 운영 배포본과 사용자 설정은 건드리지 않았다(사용자 설정은 복사본만 사용).

| 상황 | 결과 |
|---|---|
| 일반 모드에서 Space | 재생·정지 정상 |
| B 직후(키가 메인 창으로 감) Space | 재생·정지 정상 |
| 획을 하나 그은 뒤(키가 오버레이 창으로 감) Space | **재생되지 않음.** 메인 창에는 `keydown` 만 오고 `keyup` 이 오지 않음 |
| 그 뒤 다시 획 긋기 | **그려지지 않음**(오브젝트 수 그대로). 영상 영역에 `space-pan` 표시가 남아 있음 |
| Space 를 몇 번 더 눌러도 | 계속 `keydown` 만 오고 상태가 풀리지 않음 |

처음 한 번은 재현 도구 쪽 잘못으로 결과가 섞였다. DevTools 의 `keyDown`(글자 포함) 입력은 실제 키보드의 `RawKeyDown` 과 종류가 달라 Electron 의 `before-input-event` 가 아예 발생하지 않는다. `rawKeyDown` + `char` + `keyUp` 으로 바꾼 뒤의 결과가 위 표다.

## 원인

`main/mpv-overlay-host.js` 는 그리기 중 오버레이 창에 들어온 키를 `before-input-event` 에서 메인 창으로 넘기고 `event.preventDefault()` 로 삼킨다. Chromium 은 브라우저 쪽이 삼킨 누름(`RawKeyDown`) 뒤에 오는 `Char`·`KeyUp` 을 다음 누름이 올 때까지 버린다(`RenderWidgetHostImpl` 의 `suppress_events_until_keydown_`). 그래서 그 키의 뗌은 `before-input-event` 에도, 오버레이 문서에도 오지 않는다.

대부분의 단축키는 누름만으로 동작해 문제가 없었다. Space 만 다르다. v2.12.0-beta(2026-09-14, T8)부터 그리기 중 Space 는 "탭이면 재생, 누른 채 끌면 화면 이동"이고, 메인 창은 **뗌**에서 이를 끝낸다(`handleKeyup` → `viewportPanOwner.keyUp()`). 뗌이 오지 않으면

- 재생이 시작되지 않고,
- `state.isSpaceHeld` 가 켜진 채 남아 다음 누름도 무시되며,
- 그 뒤의 포인터 누름은 "Space 를 누른 채 끄는 중"으로 판정돼 100% 배율에서는 `blocked` 로 버려진다(획이 안 그려짐).

오버레이 창이 포커스를 잃어야(`onMpvOverlayInputBlur` → `resetViewportPanCycle`) 풀렸다.

당시 기록(`DEVLOG/2026-09-14-review-playback-input.md`)에도 "sendInputEvent keyUp 은 테스트 자동화에서 전달되지 않았다"고 남아 있다. 자동화의 한계로 보고 "실제 OS keyup 미확인"으로 넘겼는데, 실제 키보드에서도 똑같이 일어나는 Chromium 동작이었다. 단위 테스트는 가짜 `keyUp` 을 손으로 넣기 때문에 통과했다.

## 가설 확인

호스트에서 Space 누름만 `preventDefault()` 하지 않도록 한 줄을 바꿔 같은 재현을 돌렸다. 메인 창에 `keydown`·`keyup` 이 모두 왔고, Space 로 재생·정지가 됐으며, 그 뒤 획도 그려졌다. 대신 Space 누름이 오버레이 문서에 도달했다(`keydown:Space:real`).

## 수정

- `main/mpv-overlay-host.js`
  - `forwardedSpaceKeyDownKeepsRelease`: Alt·Meta 가 없는 Space 누름은 넘기기만 하고 삼키지 않는다. 뗌은 지금처럼 넘기고 삼킨다.
  - `pairedReleaseForSwallowedSpace`: Alt·Meta+Space 는 OS 동작(창 시스템 메뉴 등)으로 넘어가지 않게 계속 삼킨다. 그 뗌은 오지 않으므로 호스트가 짝이 되는 뗌을 곧바로 만들어 보낸다. 자동 반복 누름에는 만들지 않는다.
- `renderer/scripts/modules/mpv-fabric-overlay-runtime.js`
  - 문서까지 내려온 Space 누름의 기본 동작을 막는다. 방금 누른 팔레트 버튼에 포커스가 남아 있으면 Space 가 그 버튼을 누르기 때문이다.
  - 조건: 키를 넘기는 호스트 안(`hostRelaysKeys`)이고, 그리기 입력이 켜져 있고, 색상 코드 입력 중이 아닐 때. 편집창(BEditer)에는 그런 호스트가 없어 영향이 없다.
- 생성 번들 `mpv-fabric-overlay.iife.js`, `editor-drawing.iife.js` 갱신.
- 메인 창 렌더러(`app.js`)와 `shared/viewport-pan-controller.js` 는 바꾸지 않았다. 판정 로직은 원래 맞았고, 뗌이 도착하지 않았을 뿐이다.

다른 키의 뗌은 여전히 오지 않는다. 메인 창은 Space 외의 뗌을 쓰지 않고(`handleKeyup` 은 Space 만 본다), 오버레이의 Ctrl·Alt 상태는 포인터 이벤트로 다시 맞춘다(`syncOverlayModifierStateFromPointer`).

## 코덱스 리뷰

### 1차 (대상 `3dce037`) — P2 1건

- 지적(`main/mpv-overlay-host.js`): Space 를 누른 채 다른 키를 누르면 그 키의 누름은 여전히 삼켜진다. Chromium 은 삼킨 키의 뗌만이 아니라 다음 누름이 올 때까지 **모든** 뗌을 버리므로, Space 의 실제 뗌이 다시 사라져 같은 증상이 난다.
- 확인: 실제 Chromium 테스트에 "Space 누름 → A 누름 → A 뗌 → Space 뗌"을 추가해 재현했다. 넘어온 것은 `keyDown:Space`, `keyDown:KeyA` 뿐이었다.
- 수정: 호스트가 뗌을 아직 못 넘긴 Space 를 기억한다(`overlaySpaceReleasePending`). 다른 키의 누름을 삼키는 모든 길(일반 릴레이, 실행 취소 키, 그 자동 반복, Alt·Meta+Space) 직전에 Space 의 뗌을 먼저 넘기고(`_flushPendingOverlaySpaceRelease`), 색상 코드 입력이 시작될 때도 넘긴다. 실제 뗌이 오면 기억을 지운다. 그리기 입력이 꺼지거나 오버레이 창이 포커스를 잃으면 메인 창이 스스로 상태를 풀므로 기억만 지운다.
- 결과적으로 Space 를 누른 채 다른 키를 누르면 그 순간 Space 누름이 끝난 것으로 처리된다(끌지 않았으면 재생 전환, 끄는 중이면 화면 이동 종료). 메인 창에 포커스가 있을 때는 Space 를 뗄 때 같은 일이 일어나므로 결과는 같고 시점만 이르다.
- 실제 앱 확인: Space 를 누른 채 Delete 를 누르고 둘 다 뗀 뒤 상태가 풀려 있고 이후 획이 그려진다.

## 테스트

- 새 `scripts/tests/mpv-overlay-space-release.test.js`: 숨김 Electron 에서 실제 `MPVOverlayHost` 와 실제 런타임 번들로 Space 를 눌렀다 뗀다. 메인 창으로 `keyDown`·`keyUp` 이 모두 넘어오는지, 오버레이 문서에서 기본 동작이 막혔는지, 포커스된 팔레트 버튼이 눌리지 않는지, 다른 키는 그대로 삼켜지는지 본다. `test:mpv` 에 등록.
  - 수정 전 코드에서 실패 확인: `['keyDown:Space']` 만 옴.
  - 런타임 쪽 방어만 끈 상태에서도 실패 확인: `keydown:Space:default`.
- `mpv-overlay-host.test.js`: Space 누름을 삼킨다고 단정하던 두 곳을 새 동작으로 고치고, 누름·자동 반복·뗌·Ctrl/Shift/Alt/Meta 조합·다른 키를 한 테스트로 추가.
- `mpv-fabric-overlay-runtime.test.js`: 호스트 안/색상 코드 입력 중/그리기 입력 꺼짐/편집창 각각에서 기본 동작을 막는지.

## 검증 결과

자동 테스트 (코덱스 1차 반영 후 다시 실행)

| 명령 | 결과 |
|---|---|
| `npm run test:mpv` | 477 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:fabric-drawing-pilot` | 648 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:drawing` | 366 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:editor` (`BAEFRAME_TEST_FFMPEG` 지정) | 147 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:release-paths` | 24 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:fabric-drawing-persistence` | 첫 실행 167 pass / 0 fail, exit 0. 이후 실행 164 pass / **3 fail**, exit 1 (아래 설명) |

lint(변경 파일, `--no-ignore`) 오류 0. `git diff --check` 통과.

전체 147개 테스트 파일 일괄 실행(`3dce037`): 2,771개 중 2,759 pass / 12 fail / 0 cancelled.

- 7건은 변경 전부터 실패하던 항목이다(`hybrid-review-engine-source` 4, `playback-buffering-runtime` 1, `drawing-v3-engine-adapter-benchmark` 2).
- 5건은 이 PC 의 상태에 따라 실패하는 저장 복구 테스트다(`review-file-store-recovery` 3, `review-read-ux` 2, `ERR_REVIEW_LOCK_TIMEOUT`). 테스트가 "없는 프로세스"로 가정한 고정 번호 12345 는 Windows 에서 12344 를 가리키는데, 그 번호의 프로세스가 실행 중이면 소유자가 살아 있다고 보고 시간 초과된다. 같은 시각에 수정 전 `5e10a41` 체크아웃에서도 똑같이 실패했다. 이번 변경과 무관하며 여기서 고치지 않았다.

실제 앱(수정본을 소스로 실행, 격리 프로필, DevTools 프로토콜 입력)

| 상황 | 결과 |
|---|---|
| 획을 그은 뒤 Space | 재생 시작(프레임 진행, mpv 정지 해제). 메인 창에 `keydown`·`keyup` 모두 도착 |
| 그 뒤 획 긋기 | 그려짐 |
| 다시 Space | 정지 |
| Space 를 누른 채 끌고 뗌(100% 배율) | 누르는 동안 `space-pan`, 획은 생기지 않음. 떼면 표시가 풀리고 재생은 바뀌지 않음. 그 뒤 획이 그려짐 |
| 메인 창에 포커스가 있을 때 Space | 전과 같이 재생·정지 |

## 미확인

- 실물 키보드로 직접 누르는 확인. DevTools 프로토콜의 키 입력은 실제 키보드와 같은 Chromium 경로(`ForwardKeyboardEvent`)를 타지만, OS 포커스 전환까지 포함한 실기는 아니다.
- 확대한 상태에서 Space 를 누른 채 끌어 실제로 화면이 이동하는지(이번에는 100% 배율의 `blocked` 경로만 확인).
- Alt+Space 를 뺐을 때 창 시스템 메뉴가 뜨는지는 확인할 방법이 없어, 그 조합은 기존대로 삼키는 쪽을 택했다.
- 실물 펜 태블릿, 한글 입력기 상태별 Space, 다른 PC.
