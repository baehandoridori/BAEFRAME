# 타임라인 프레임 바 — 펜으로 끌기

브랜치 `claude/timeline-pen-scrub`(기준 `a08047a`, v2.16.1-beta 까지 머지된 main. 배포본은 v2.16.0-beta). 2.16.2-beta 로 올린다. 이번 배포에는 아직 배포하지 않은 v2.16.1-beta 의 수정([기록](2026-11-12-codex-retro-review-passive-undo-order.md))이 함께 나간다.

## 요청

2026-11-11 15:08 의 슬랙 피드백 "+ 추가 사항: 현재 펜 입력으로는 저 프레임 바 드래그가 안되는 문제도 있습니다"(프레임 바 손잡이에 동그라미를 친 화면 갈무리). 같은 날 15:02 의 네 항목(v2.14.0-beta 에서 처리) 바로 뒤에 온 메시지인데 그때 놓쳤다. 2026-11-12 에 사용자가 다시 전하며 함께 고쳐 배포하라고 했다. 조건이 하나 있었다: **PC 를 쓰는 중이니 앱을 화면에 띄우지 말 것.**

## 조사

### 코드

- 프레임 바 손잡이와 눈금자의 끌기는 2026-07-09(v1.4.0, 피드백 17·19-1 "펜 입력")에 pointer 이벤트로 바뀌었고 `#timelineTracks, #timelineRuler, #playheadHandle { touch-action: none; }` 도 그때 들어갔다. 그때의 규칙은 느슨했다: 누르면 끌기 시작, 끄는 동안 **어느 포인터의** `pointermove` 든 자리로 삼고, `pointerup`·`pointercancel` 이 오면 마지막 자리로 확정.
- 2026-09-14(v2.11, `2ec0d54` "프레임바를 놓은 좌표를 정수 프레임으로 확정…")에 엄격해졌다: 주 포인터만 시작(`isPrimary`), 누른 `pointerId` 의 이벤트만 받기, `setPointerCapture`, 그리고 `lostpointercapture`·`blur`·`pointercancel` 이면 끌기를 끝내고 **시작한 자리로 되돌리기**. 그 계획서(`docs/superpowers/plans/2026-09-14-review-playback-input-plan.md`)는 "native 펜 테스트가 불가능하면 '미수행'으로 남긴다"고 적었고, 실제 펜으로는 검증되지 않았다.
- 같은 사용자가 9월에 "프레임바 드래그 종료 시 한 프레임 앞에서 정지"(R9)를 보고했다 — 그때는 프레임 바를 끌고 있었다. 11월의 보고는 "**현재** 펜 입력으로는 … 안되는"이다.

### Chromium 120(Electron 28.3.3)의 펜 처리 — 소스로 확인한 것

- `ui/views/win/pen_event_processor.cc`: 펜이 **닿지 않은 동안(호버)** 은 마우스 이벤트로, **닿아 있는 동안** 은 터치 이벤트로 만든다(옆 버튼을 누른 채 닿으면 마우스 경로). 두 경로의 포인터 id 는 같은 값을 쓴다.
- `pointer_event_manager.cc` `SendTouchPointerEvent`: 터치 경로의 `pointerdown` 은 종류를 가리지 않고(펜 포함) 누른 요소에 암묵적으로 묶인다.
- 같은 파일 `SendMousePointerEvent`(974행): 마우스 경로로 온 `pointermove` 에 눌린 버튼이 없으면 그 포인터의 묶음을 그 자리에서 푼다("This is for when the mouse is released outside of the page").

### 재현 시도 — 주입할 수 있는 입력으로는 재현되지 않았다

화면에 띄우지 않고 실제 엔진으로 보는 방법 둘을 만들었다.

1. **보이지 않는 창**: 저장소의 Electron(28.3.3, Chromium 120.0.6099.291)으로 `show: false` + offscreen 창을 만들고 실제 `timeline.js` 와 `main.css` 를 올린 뒤 DevTools 프로토콜로 입력을 넣는다.
2. **보이지 않는 데스크톱**: `CreateDesktop` 으로 만든 별도 데스크톱에서 프로세스를 시작하면(`STARTUPINFO.lpDesktop`) 그 프로세스와 자식이 만드는 창은 사용자가 보는 화면에 나타나지 않는다. 데스크톱을 전환하지 않는다. 여기서 패키지된 앱 전체를 Playwright 로 띄워 기존 점검 스크립트를 그대로 돌릴 수 있었다(16항목 통과로 확인).

넣어 본 입력과 결과(수정 전 코드):

| 입력 | 결과 |
|---|---|
| 마우스 | 끌린다 |
| 펜 — 마우스 경로(`Input.dispatchMouseEvent`, `pointerType: 'pen'`) | 끌린다 |
| 터치 경로(`Input.dispatchTouchEvent`) — 펜이 닿아 있을 때 쓰는 경로 | 끌린다. 타임라인을 300~400% 로 키워 가로 스크롤이 생긴 상태에서도, 눈금 글자 위를 눌러도 끌린다(`touch-action: none` 이 가로 밀기를 막는다) |
| 실제 앱(패널 닫힘·그리기 모드) | 위 셋 모두 끌린다 |

실물 펜의 경로(Windows 의 `WM_POINTER` 펜 메시지 → 호버는 마우스 경로, 접촉은 터치 경로, 같은 포인터 id)는 만들어 넣을 수 없었다. DevTools 프로토콜의 터치는 `pointerType` 이 `touch` 뿐이고, Windows 의 펜 주입(`InjectSyntheticPointerInput`)은 사용자가 쓰고 있는 화면으로 들어간다.

곁가지로 본 것: 손가락 터치는 Blink 의 대상 보정(터치 영역 20dip 안의 "누를 수 있는" 요소로 옮김) 때문에 눈금자 아래쪽 10px 을 누르면 그 아래의 트랙 행이 눌린다. 펜에는 이 보정이 없다. 이번에 손대지 않았다.

### 판단

원인을 확정하지 못했다. 다만 범위는 좁혀졌다.

- 주입한 입력으로는 다 되므로, 실물 펜만의 것 — 한 자루의 펜이 두 입력 경로를 오가는 것 — 이 9월의 엄격한 규칙 가운데 하나에 걸린다고 본다. 7월의 느슨한 규칙에서는 그런 것이 문제 되지 않았다.
- 기전의 후보 하나는 실제 엔진으로 확인했다: 끄는 도중에 **버튼 없는 펜 이동**이 하나 오면 Blink 가 묶음을 풀고(`lostpointercapture`), 수정 전 코드는 그 순간 끌기를 취소하고 시작한 자리로 되돌린다. 실물 펜이 닿아 있는 동안 그런 이동을 보내는지는 확인하지 못했다. 그리기 오버레이도 묶음이 풀리면 획을 취소하는데 그런 보고는 없으므로, 흔한 일은 아닐 것이다.
- 그래서 한 가지 기전에 맞추지 않고, **펜에 한해 9월의 규칙들을 모두 풀어** 7월의 동작으로 되돌렸다. 어느 규칙이 실제로 걸렸는지는 진단 기록으로 남긴다.

## 수정 (`renderer/scripts/modules/timeline.js`)

마우스와 손가락은 그대로 엄격하다. 펜으로 시작한 끌기(`_isPenScrub`)만 다르다.

| 규칙 | 마우스·손가락 | 펜 |
|---|---|---|
| 시작 | 주 포인터만 | 주 포인터가 아니어도 |
| 이동·뗌 | 누른 `pointerId` 만 | 펜이 보낸 것이면 `pointerId` 가 달라도(`_isScrubPointer`) |
| 닿지 않은 채 보낸 이동(버튼도 필압도 없음) | (해당 없음) | 끌기로 치지 않는다. 그 자리로 옮기지도 끝내지도 않는다 |
| `lostpointercapture`·`blur` | 끝내고 시작한 자리로 | 무시한다. 닿아 있는 동안의 이동과 뗌은 문서의 리스너로 계속 온다 |
| `pointercancel` | 끝내고 시작한 자리로 | 끝내고 마지막으로 끈 자리에 둔다 |

그 밖에:

- **뗌을 받지 못한 끌기**: 끄는 도중에 새 누름이 오면 앞선 끌기를 마지막으로 끈 자리에서 끝내고 새로 시작한다(끄는 손가락이 있는 동안의 다른 손가락은 지금처럼 무시). 전에는 `isDraggingPlayhead` 가 켜진 채 남아 다음 창 포커스 변화까지 프레임 바를 끌 수 없었다. 펜의 `blur`·묶음 풀림을 무시하게 되면서 필요해졌다.
- 눈금자: 시작하지 못한 누름(두 번째 손가락 등)이 자리를 옮기지 않게 했다(`_beginScrubbing` 이 시작 여부를 돌려준다).
- 펜도 포인터를 묶는다. 마우스 경로로 들어오는 펜은 창 밖으로 나갔을 때 묶음이 있어야 따라온다.
- **진단 기록**(`_notePenScrubTolerance`): 펜에서 엄격한 규칙이었다면 끊겼을 입력을 받아들이면 종류마다 한 번 WARN 으로 남긴다. 렌더러의 WARN 은 `%APPDATA%\baeframe\logs\baeframe-<날짜>.log` 에 적힌다. 종류는 `lostpointercapture`·`blur`·`pointercancel`·`hover-move`·`pointer-id`·`not-primary`·`superseded`.

9월 계획서의 "cancel/lostcapture 는 드래그 시작 위치로 되돌린다"는 마우스·손가락에는 그대로 지켰다. 펜에서 바꾼 이유는 위 "판단"이다.

## 검증

자동 검사(2026-11-12, 이 작업 폴더, 종료 코드 0):

| 묶음 | 결과 |
|---|---|
| test:frame-grid (`timeline-scrub-frame.test.js` 포함) | 74 pass / 0 fail / 0 cancelled |
| test:fabric-drawing-pilot | 738 pass / 0 fail / 0 cancelled |
| test:mpv | 498 pass / 0 fail / 0 cancelled |
| test:drawing | 377 pass / 0 fail / 0 cancelled |
| test:drawing-v3-adapter · store-observer · hardening | 35 · 19 · 174 pass |
| test:editor (BAEFRAME_TEST_FFMPEG 지정) | 150 pass / 0 fail / 0 cancelled |
| test:fabric-drawing-persistence | 167 pass / 0 fail / 0 cancelled |
| test:ux | 84 pass / 0 fail / 0 cancelled |
| test:video-pan · cluster · composition · cutlist · fps · previous-review | 21 · 43 · 60 · 82 · 7 · 57 pass |
| test:audio-waveform · collaboration · comment-input · comment-popout · recent · toast-stack · version · file-drop · release-paths | 2 · 8 · 78 · 64 · 18 · 9 · 11 · 4 · 24 pass |

**기존 실패 3묶음**: `test:playlist`(377 중 15 fail), `test:playback-buffering`(94 중 1 fail), `test:hybrid`(5 중 4 fail). 수정 전 main(`a08047a`)의 깨끗한 사본에서 같은 세 묶음을 돌려 실패 항목이 하나도 다르지 않음을 확인했다. 이번 변경과 무관하고, 손대지 않았다.

새 검사 6건(`scripts/tests/timeline-scrub-frame.test.js`. 실제 리스너를 가짜 대상에 걸어 이벤트 순서대로 부른다). 펜 5건은 수정 전 코드에서 실패하는 것을 먼저 확인했고, 마우스 1건은 기존 동작을 고정한다.

- 마우스는 엄격한 그대로: 묶음 풀림·포커스 잃음·취소에 시작한 자리로, 다른 포인터는 받지 않음
- 펜: 묶음이 풀려도 이어지고 펜을 뗀 자리로 확정
- 펜: 호버 이동과 창의 포커스 잃음을 무시(버튼이 없어도 필압이 있으면 끌기)
- 펜: `pointerId` 가 바뀌어도, 주 포인터가 아니어도 받음(손가락은 지금처럼)
- 펜: 취소되면 마지막으로 끈 자리(끌지 않았으면 제자리)
- 끄는 도중의 새 누름이 앞선 끌기를 끝내고 새로 시작(두 번째 손가락은 예외)

규칙을 하나씩 수정 전으로 되돌리거나 꺼 보면 해당 검사가 실패한다(13가지 모두 잡힌다).

실제 엔진(보이지 않는 창, 수정 전·후의 `timeline.js` 를 같은 입력으로):

| 입력 | 수정 전 | 수정 후 |
|---|---|---|
| 마우스 · 펜(마우스 경로) · 터치 끌기 | 놓은 프레임으로 확정 | 같음 |
| 펜으로 끄는 중 묶음이 풀림 | 시작한 프레임으로 되돌아감 | 놓은 프레임으로 확정 |
| 펜으로 끄는 중 버튼 없는 이동이 끼어듦(Blink 가 묶음을 푼다) | 시작한 프레임으로 되돌아감 | 놓은 프레임으로 확정 |
| 마우스로 끄는 중 같은 두 상황 | 시작한 프레임으로 되돌아감 | 같음 |

실제 앱(보이지 않는 데스크톱, 패키지된 실행 파일, 격리 프로필, 640×360 24fps 시험 영상):

- 이 작업 폴더의 후보 빌드(2.16.2-beta): 프레임 바 점검 8항목 + 지난 세 릴리스의 34항목 통과, 페이지 오류 0건.
- **배포된 v2.16.0-beta(수정 전)에 같은 프레임 바 점검**: 보통의 끌기 셋은 통과하고 "펜으로 끄는 중 묶음이 풀려도 놓은 자리로 확정"에서 실패한다(프레임이 되돌아간다). 수정 전·후의 차이가 실제 앱에서도 같다.

미확인:

- **실물 펜.** 이 수정이 보고된 문제를 고치는지는 실제 펜으로 눌러 봐야 안다. 여전히 안 되면 (1) 아예 안 움직이는지, 조금 따라오다 돌아가는지, (2) 눈금자를 펜으로 찍으면 이동하는지, (3) 그 PC 의 로그 파일에 "펜으로 프레임 바를 끄는 중" 줄이 있는지가 다음 단서다.
- 사람이 직접 조작하는 확인.

## 남은 일

- 같은 모양이 다른 곳에도 있다. 화면 이동(`video-pan-gesture.js`)은 버튼 없는 이동이 오거나 묶음이 풀리면 이동을 취소하고, 편집창(`editor.js`)의 클립·눈금자·화면 이동도 묶음이 풀리면 취소한다. 펜에서 같은 문제가 날 수 있다. 보고된 것은 프레임 바뿐이라 이번에 손대지 않았다.
- 마우스 이벤트만 받는 끌기(댓글 구간 손잡이, 전체화면 탐색 막대, 분할 보기 탐색 막대 등)는 펜으로 끌 수 없다.
- 손가락 터치로 눈금자 아래쪽 10px 을 누르면 트랙 행이 눌린다(Blink 의 대상 보정).
- 진단 기록은 원인이 확인되면 지운다.
- 기존 실패 20건(`test:playlist`·`test:playback-buffering`·`test:hybrid`).

## 릴리스

PR 은 이 브랜치에서 `main` 으로 연다. PR 번호, 코덱스 리뷰 경과, 머지 뒤의 값(merge SHA·빌드 경로·배포 경로·전체 해시 대조)은 원본 체크아웃의 `output/releases/` 감사 기록에 남긴다. 조사에 쓴 하네스와 보이지 않는 데스크톱 실행 스크립트도 그 폴더에 둔다.
