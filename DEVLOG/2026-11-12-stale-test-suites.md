# 원래부터 실패하던 자동 검사 20건 — 원인과 수정

브랜치 `claude/preexisting-test-failures`(기준 `c77ea55`, v2.16.2-beta 배포본). **제품 코드는 바꾸지 않았다.** 검사 파일 셋과 문서만 바꿨으므로 버전을 올리지 않고 배포도 하지 않는다.

## 요청

2026-11-12 에 v2.16.2-beta 를 배포하면서 평소 돌리지 않던 묶음까지 돌렸더니 세 묶음에서 20건이 실패했다. 같은 20건이 그날의 변경 전 커밋(`a08047a`)의 깨끗한 사본에서도 똑같이 실패해 그 전부터 있던 것임을 확인했고, 따로 조사하자는 제안을 사용자가 수락했다. 범위는 **각각이 "검사가 낡은 것"인지 "코드가 실제로 깨진 것"인지 가려내고 고치는 것**이다. 검사를 지우거나 느슨하게 만들어 통과시키지 않는다.

## 결론

20건 모두 **검사가 코드의 변경을 따라가지 못한 것**이다. 제품의 결함은 나오지 않았다.

| 묶음 | 실패 | 원인 | 낡은 때 |
|---|---|---|---|
| `test:playlist` | 15 | 영상이 끝났을 때의 처리(`'ended'` 처리기)가 새로 부르는 `syncFabricOnionSkinPlayback` 을 검사가 모름 | `9bf528d` (2026-11-11, v2.14.0-beta 의 어니언 스킨) |
| `test:playback-buffering` | 1 | `getMpvOverlayState` 가 mpv 재생에서 늘 부르게 된 `getCompositedDrawingOverlayDataUrl` 을 검사가 모름 | `6f4c151` (2026-09-22, v2.12.7-beta) |
| `test:hybrid` | 4 | 제거한 하이브리드 엔진의 함수와 주석이 **있기를** 단언 | `6f4c151` (그 코드를 지운 커밋) |

15건은 v2.14.0-beta 에서 어니언 스킨을 넣으면서 이 검사 묶음을 돌리지 않아 생긴 것이다. 나머지 5건은 9월부터 있었다.

## 어떻게 가렸나

고치기 전 상태를 먼저 다시 기록했다(`test:playlist` 377건 중 15건, `test:playback-buffering` 94건 중 1건, `test:hybrid` 5건 중 4건 실패).

### test:playlist 15건

- 15건의 오류가 모두 같다: `syncFabricOnionSkinPlayback is not defined`.
- 이 검사들은 `renderer/scripts/app.js` 에서 `loadVideo`·`'ended'` 처리기 등의 **소스를 뽑아** 가짜 의존 대상(`dependencies`) 안에서 실행한다(`createActualLoadRaceHarness`). 처리기가 부르는 이름이 그 목록에 없으면 실행하다가 멈춘다.
- `git log -S"syncFabricOnionSkinPlayback"` — 그 호출은 `9bf528d` 에서 들어왔다. 같은 커밋이 `drawing-comment-passthrough.test.js` 의 목록에는 그 이름을 넣었다. 그 파일이 든 `test:mpv` 는 돌렸고 `test:playlist` 는 돌리지 않았기 때문이다.
- 가설("빠진 이름 하나가 전부다")을 한 줄로 확인했다. 시나리오 하네스의 목록에 그 이름을 넣자 15건 중 14건이 통과했다. 남은 1건은 자기만의 목록을 쓰는 검사였고 같은 이름을 넣자 통과했다. 그 뒤에 드러난 다른 실패는 없다.
- 실제 앱에서는 처리기와 그 함수가 같은 범위에 있으므로 문제가 없다. v2.14.0-beta 이후의 실제 앱 점검(어니언 스킨 항목 포함)도 통과해 왔다.

### test:playback-buffering 1건

- 오류: `getCompositedDrawingOverlayDataUrl is not defined` (`getMpvOverlayState` 를 뽑아 실행하는 검사).
- `6f4c151` 이전에는 `drawingDataUrl: suppressLegacyDrawing ? '' : getCompositedDrawingOverlayDataUrl()` 였고, 검사는 `suppressLegacyDrawing` 을 참으로 두어 그 함수를 부르지 않았다. `6f4c151` 이 이것을 `overlayOnly ? '' : …` 로 바꿨다(mpv 재생이면 늘 부른다).
- 의도한 변경이다. [그날의 기록](2026-09-22-current-drawing-only.md)에 "native 재생과 C 정지 화면에서도 기존 PNG 를 현재 그림 아래에 읽기 전용으로 합성해 표시를 유지한다"고 적혀 있고, 같은 커밋이 새 동작을 `current-drawing-html5.test.js`("native current drawings retain one legacy raster mirror…")로 검사한다. 이 묶음의 검사만 갱신에서 빠졌다.

### test:hybrid 4건

- 하이브리드 리뷰 엔진(댓글·그리기 모드에 들어갈 때 같은 파일을 HTML5 로 다시 열던 전환)은 `1caf344`(2026-09-22 16:06)에서 꺼졌고 `6f4c151`(같은 날 22:16)에서 구형 작성 도구와 함께 지워졌다.
- 이 묶음은 그 함수들(`enterHybridReviewEngineIfPossible`, `exitHybridReviewEngineIfNeeded`, `isHtml5DirectPlayableForReview`, `prepareMpvDrawMode` 등)이 **있기를** 단언한다. 한편 `6f4c151` 이 함께 넣은 다른 검사들은 그것들이 **없기를** 단언한다(`fabric-drawing-pilot-source.test.js` 의 `doesNotMatch(appSource, /…|prepareMpvDrawMode|enterHybridReviewEngineIfPossible/)`, `current-drawing-palette.test.js` 의 "removed authoring functions…", `review-ux.test.js`, `mpv-recovery-source.test.js`). 둘은 동시에 통과할 수 없다. 낡은 쪽은 이 묶음이다.
- 남은 것: `loadVideo` 의 `engineSwap`, `loadVideoWithHtml5Fallback` 의 `skipReviewTransition` 선택 사항(기본값 꺼짐, 넘기는 호출 없음)과 `user-settings.js` 의 꺼짐으로 고정된 설정.

## 수정

검사를 지금의 설계에 맞췄다. 원래 지키려던 것은 그대로 지키게 했다.

- `scripts/tests/playlist-continuous-runtime.test.js`: 두 의존 목록에 `syncFabricOnionSkinPlayback` 을 넣되 **부른 횟수를 세게** 했다. 검사 둘에 단언을 더했다 — 다음 항목으로 넘어가는 것을 막는 동안에도(영상을 바꾸는 중의 옛 영상 끝) 재생이 끝났다는 화면 갱신은 한다.
- `scripts/tests/playback-buffering-runtime.test.js`: 재생 방식을 `mpv` 로 밝히고 빠진 의존 대상을 넣었다. 단언은 그대로다.
- `scripts/tests/hybrid-review-engine-source.test.js`: 4건을 다시 썼다. 소스 글자를 찾던 것을 가능한 곳은 실제 함수를 뽑아 실행하는 검사로 바꿨다.

| 예전 검사 | 지키려던 것 | 지금의 검사 |
|---|---|---|
| 하이브리드 호환 코드는 남아도 새 코멘트 진입은 파일을 다시 열지 않는다 | 모드에 들어간다고 파일을 다른 엔진으로 다시 열지 않는다 | 제거한 함수 다섯이 없다. `engineSwap`·`skipReviewTransition` 을 넘기는 호출이 없고 선언의 기본값이 꺼짐이다(구문 트리로 확인) |
| 하이브리드 전환의 3중 안전장치가 배선되어 있다 | 폐기된 설정으로는 전환이 켜지지 않는다 | 저장된 값이 켜짐이어도 읽으면 꺼짐, 켜려 해도 꺼짐(실제 메서드를 실행). 앱이 그 설정을 읽지 않고 설정 화면에 스위치가 없다 |
| 모드 종료 시 mpv 복귀 정리가 배선되어 있다 | 모드를 나올 때의 정리, 영상을 바꿀 때의 경합 방지 | 코멘트 처리기를 실행: 나올 때 표시를 끄고 정지 화면만 푼다. 영상을 바꾸는 중에는 풀지 않는다. 어느 경우에도 파일을 다시 열지 않는다 |
| 레거시 드로잉 준비는 진입 즉시 준비중 표시를 켠다 | 준비가 끝나기 전에 준비중 표시가 보인다 | 컨트롤러 상태 처리기를 실행: `preparing` 에서 표시·`aria-busy` 켜짐, `active` 에서 꺼짐, 복구 뒤 다시 켜기로 예약된 동안 켜짐. 코멘트 진입도 준비를 시작하기 전에 표시를 켠다 |

"B 토글은 복구·소스 갱신 중에 침묵 폐기되지 않고 예약된다"는 통과하던 검사라 그대로 뒀다.

## 검증

세 묶음(이 작업 폴더, 2026-11-12):

| 묶음 | 고치기 전 | 고친 뒤 |
|---|---|---|
| `test:playlist` | exit 1 · 362 pass / 15 fail / 0 cancelled | exit 0 · 377 pass / 0 fail / 0 cancelled |
| `test:playback-buffering` | exit 1 · 93 pass / 1 fail / 0 cancelled | exit 0 · 94 pass / 0 fail / 0 cancelled |
| `test:hybrid` | exit 1 · 1 pass / 4 fail / 0 cancelled | exit 0 · 5 pass / 0 fail / 0 cancelled |

전체: package.json 의 `test:*` 31개 묶음을 모두 실행했다. **31개 모두 exit 0, 실패 0, 취소 0.** `test:editor` 는 `BAEFRAME_TEST_FFMPEG` 를 지정했다.

| 묶음 | pass | 묶음 | pass | 묶음 | pass |
|---|---|---|---|---|---|
| test:fabric-drawing-pilot | 738 | test:cutlist | 82 | test:collaboration | 8 |
| test:fabric-drawing-persistence | 167 | test:drawing | 377 | test:comment-input | 78 |
| test:recent | 18 | test:drawing-v3-hardening | 174 | test:comment-popout | 64 |
| test:frame-grid | 74 | test:drawing-v3-adapter | 35 | test:toast-stack | 9 |
| test:cluster | 43 | test:drawing-v3-store-observer | 19 | test:version | 11 |
| test:composition | 60 | test:video-pan | 21 | test:previous-review | 57 |
| test:playlist-ordering | 17 | test:mpv | 498 | test:file-drop | 4 |
| test:playlist-continuous | 13 | test:playback-buffering | 94 | test:hybrid | 5 |
| test:playlist-comments | 16 | test:fps | 7 | test:editor | 150 |
| test:playlist | 377 | test:audio-waveform | 2 | test:ux | 84 |
| | | | | test:release-paths | 24 |

여러 묶음에 함께 든 검사 파일이 있어 합계(3,326)는 실행 횟수다.

- **되돌려 보기**: 고친 검사가 지키는 동작을 제품 코드에서 하나씩 망가뜨려 22가지를 시험했다. 22가지 모두 해당 검사가 실패했고(`mutations=22 notCaught=0`), 원본을 되돌린 뒤 세 파일이 다시 통과했다. 예: 제거한 전환 함수를 되살림, `engineSwap: true` 를 넘김(줄여 쓴 속성 포함), 설정 읽기가 저장값을 돌려줌, 코멘트 진입이 표시를 켜지 않음·준비 뒤에 켬·파일을 다시 엶, 나올 때 정지 화면을 풀지 않음, 드로잉 준비중 표시가 켜지지 않음·남음, `'ended'` 처리기가 어니언 스킨에 알리지 않음, 버퍼 대기 중에도 합성 레이어가 재생 중으로 실림.
- 제품 코드(`renderer/`, `main/`, `preload/`)는 바뀌지 않았다. 되돌려 보기 스크립트는 파일을 잠깐 바꿨다가 원본과 바이트가 같은지 확인하고 되돌린다.
- 앱 실행·실제 조작 확인은 하지 않았다(바뀐 것이 검사와 문서뿐이다).

## 왜 여러 주 동안 드러나지 않았나

- `test:*` 묶음이 31개이고 한 번에 돌리는 명령이 없다. 릴리스 검증은 고친 영역의 묶음(대개 10개)만 돌렸다.
- [테스트 선택표](../docs/development-guide.md)에 `test:playback-buffering` 과 `test:hybrid` 가 없었고, 재생 이벤트 처리기를 고칠 때 `test:playlist` 를 돌려야 한다는 것도 드러나 있지 않았다.
- 이번에 선택표에 두 줄을 더하고, "app.js 를 고쳤으면 고친 함수 이름을 `scripts/tests/` 에서 찾아 그 묶음도 돌린다"는 문단을 넣었다.

## 남긴 것

- `loadVideo` 안의 `engineSwap` 분기와 `skipReviewTransition` 은 이제 쓰이지 않는 선택 사항이다. 지우지 않았다(제품 코드 변경은 이번 범위가 아니다). 새 검사는 선언이 사라져도 통과한다.
- `playlist-continuous-runtime.test.js` 의 하네스에는 app.js 에 더 없는 이름이 몇 개 남아 있다(`hybridReviewResumeMpvFile`, `mpvDrawPlaybackTransitionToken`, `restoreMpvDrawFreezeAfterPlayback`). 검사 동작과 무관해 그대로 뒀다.
- 배포 전에 31개 묶음을 모두 돌리는 것을 절차로 삼을지는 사용자에게 제안한다.
