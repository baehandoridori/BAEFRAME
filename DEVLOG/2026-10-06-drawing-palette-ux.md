# 드로잉 팔레트 화면 정리 — 아이콘 편집 줄, 자유 색상, Ctrl 지우개 표시

브랜치 `claude/drawing-tool-ui-ux-2431ed`. 2.12.7-beta 에서 2.13.0-beta 로 올린다(새 기능). 머지·빌드·배포 근거는 `output/releases/2026-10-06-v2.13.0-beta/` 에 남긴다.

## 요청

리뷰 화면의 드로잉 팔레트를 다듬는다.

1. 실행 취소·다시 실행 같은 글자 버튼을 아이콘으로 바꿔 깔끔하게.
2. 색 선택의 제약을 푼다(고정 8색, 설정 버튼을 눌러야 보임).
3. 브러시에서 Ctrl 을 누르고 있으면 획 지우기로 바뀌는데, 그때 화면에 아무 표시가 없다.

시안을 먼저 보여 주고 세 가지를 확인받았다: 색은 "자유 색상 + 내 색(앱을 껐다 켜도 남게)", Ctrl 표시는 "커서 + 팔레트", 배치는 "시안대로".

## 확인한 것

- 8색 제한은 화면 쪽(`setBrushColor` 의 `BRUSH_COLORS.includes`)에만 있었다. 저장 쪽 검증기 셋(런타임·호스트·지속화 스토어)은 처음부터 `#rrggbb` 를 받는다. 그래서 `drawingsV3` 를 건드리지 않고 풀 수 있다.
- Ctrl 임시 지우개는 `beginPointerDown` 이 누르는 순간에만 판정한다. 누르기 전에는 상태가 어디에도 없었다.
- 오버레이 문서는 data: URL 오리진이라 자기 저장소를 못 쓴다. 팔레트 위치도 실제로는 창 메모리에만 남는다. 값을 보존하려면 메인 창의 사용자 설정까지 통로가 필요하다. `user-settings.js` 의 `brushSettings` 는 구형 팔레트를 지운 뒤 쓰는 곳이 없다.
- 그리기 중에는 호스트의 `before-input-event` 가 모든 키를 메인 창으로 넘기고 `preventDefault()` 한다. 그대로면 색상 코드 입력칸에 한 글자도 들어가지 않는다.
- 편집창(BEditer)이 같은 런타임을 쓴다. 가로 한 줄 도크라 색·굵기를 늘 펼쳐 둘 자리가 없다.

## 구현

### 팔레트 배치 (`mpv-fabric-overlay-runtime.js`, `mpv-fabric-toolbar.js`, `main/mpv-overlay-host.js` CSS)

- 런타임 옵션 `paletteLayout`. 기본은 세로 팔레트(색·굵기 항상 펼침, 편집 줄 아이콘), `'dock'` 은 편집창용(여닫는 버튼 + 패널, 글자 버튼). `renderer/scripts/editor/drawing.js` 가 `'dock'` 을 넘긴다.
- 셸: 라벨 없이 래퍼만 두는 섹션(`wrap: true`), 라벨 오른쪽 표시(`labelAccessory`), 폭이 다른 격자(`gridTemplateColumns`).
- 도구 줄과 편집 줄의 라벨을 없앴다. 그 두 줄은 더 이상 따로 접을 수 없다(팔레트 전체 접기는 그대로). 색 섹션은 라벨 "색" 으로 접는다.
- 상시 요약 줄과 "최근 색" 을 없앴다. 색·굵기가 늘 보이고 기본 8색이 한 줄이라 둘 다 같은 정보를 두 번 보여 주게 된다.
- 패널 순서는 색 → 내 색 → 색 고르기 판 → 크기 → 불투명도 → 외곽선. 외곽선은 켜면 줄이 늘어나므로 맨 아래에 둔다(예전에는 색 바로 아래였다).
- 고른 색의 고리를 런타임 인라인 스타일에서 CSS(`aria-pressed`)로 옮겼다. 팔레트 밝기마다 색이 달라야 한다.

### 자유 색상과 내 색

- `normalizeHexColor`·`hexToHsv`·`hsvToHex`. 색 고르기 판은 가로 채도·세로 명도, 아래 막대가 색조. 판에서 고른 색은 판의 위치(`pickerHsv`)가 원본이다 — 색에서 역산하면 무채색에서 색조가 0 으로 돌아가 손잡이가 튄다.
- 색상 코드는 다 쳤을 때 바로 적용하고, 쓸 수 없는 글자·자릿수 초과만 그 자리에서 알린다. 덜 친 채 떠나면 조용히 지금 색으로 돌아간다.
- 내 색은 일곱 칸, 최신이 앞, 기본 8색은 담지 않는다. 우클릭으로 뺀다.
- 외곽선 색은 기본 8색 그대로 두었다(범위 밖).

### 값 보존 (`shared/fabric-palette-prefs.js` 신규)

- 오버레이 → 메인: 런타임이 400ms 디바운스로 `mpvOverlayPalettePrefs.notify` → `mpv-overlay:palette-prefs`(발신자 확인 + 검증) → `fabric-drawing:palette-prefs` → `userSettings.setFabricPalettePrefs`.
- 메인 → 오버레이: 그리기가 켜질 때(`handleFabricDrawingPilotStateChange('active')`) `mpv:apply-overlay-drawing-palette-prefs` → `MPVOverlayHost.applyDrawingPalettePrefs` → 런타임 `applyPalettePrefs`.
- 원본은 오버레이다. 사용자가 이 런타임에서 값을 한 번이라도 바꿨으면(`palettePrefsTouched`) 저장값을 거절한다. 저장값을 받는 것은 변경이 아니므로 되받아 알리지 않는다.
- 한도와 검증은 공유 모듈 하나. 런타임은 한도를 그 모듈에서 받고, ES 모듈인 `user-settings.js` 만 리터럴을 따로 두며 테스트가 값이 같음을 강제한다.

### 색상 코드 키 입력

- 입력칸 focus/blur → `mpvOverlayTextEntry.set` → `mpv-overlay:text-entry` → `MPVOverlayHost.setTextEntryActive`. 켜져 있는 동안 `before-input-event` 가 가로채지 않는다.
- 켠 채 남으면 그리기 단축키가 전부 죽는다. 푸는 길을 겹쳐 두었다: 입력칸 blur, Enter·Esc, 캔버스 pointerdown(런타임이 직접 끝낸다), 팔레트 숨김, 오버레이 창 blur, 그리기 끄기, 호스트 창 재생성·닫힘. 그리기가 꺼져 있을 때는 켜지지도 않는다.

### Ctrl 임시 지우개 표시

- `tempEraseArmed` 는 표시 전용이다. 판정은 `beginPointerDown` 이 그대로 하고, 표시는 같은 `isCtrlActive` 를 쓴다.
- 갱신 지점: 캔버스 pointermove(마우스는 이벤트가 실어 온 Ctrl 만 믿는다), 오버레이 keydown/keyup, 창 blur, 도구 변경, 지우기 제스처 시작·끝·취소, 입력 끄기.
- 진행 중인 Ctrl 지우기는 Ctrl 을 먼저 떼도 포인터를 놓을 때까지 지우개로 보인다(`strokeEraseGesture.temporary`). 그리는 중에 Ctrl 을 눌러도 그 획은 브러시이고 표시도 바뀌지 않는다.
- 지우개 도구도 같은 고리 커서를 쓴다. 고리는 실제 지우기 반경(3 CSS px)보다 크게 그리고 정확한 지점은 가운데 점으로 짚는다.

## 저장 형식

`drawingsV3` 레코드와 `.bframe` 은 바뀌지 않았다. 새로 생긴 저장값은 사용자 설정의 `drawingPalette`(색·굵기·불투명도·내 색) 하나다(이 PC 전용). 구형 도구의 `brushSettings` 는 읽지도 쓰지도 않는다 — 처음에는 그 키를 다시 쓰려 했으나, 몇 달 전에 쓰던 굵기와 색이 새 팔레트의 첫 화면이 되면 고장처럼 보인다는 리뷰 지적으로 키를 나눴다.

## 독립 리뷰와 반영

다른 담당(코드 리뷰 에이전트)이 작업 트리를 읽기 전용으로 검토했다. 보안·프로세스 경계, 그리기 입력, `drawingsV3`·`.bframe`, 색 변환(240만 색 표본 왕복 불일치 0), 편집창 도크에서는 결함을 찾지 못했다. 아래는 지적받아 고친 것이다.

| 지적 | 반영 |
|---|---|
| 입력칸이 문서의 포커스를 쥔 채 남으면 창이 포커스를 되찾을 때 글자 입력 상태가 저절로 다시 켜진다 | `endTextEntry` 가 상태와 무관하게 포커스를 놓게 하고, 창 blur 에서도 부른다 |
| 활성 레이어가 잠겼거나 Alt 가 함께 눌렸을 때는 지워지지 않는데 지우개로 보인다 | `resolveTempEraseArmed` 에 `activeLayerDrawable` 과 Alt 를 넣고, 레이어 상태가 바뀔 때·Alt 키에서 다시 맞춘다 |
| 메인 창에 포커스가 있을 때 포인터가 캔버스를 떠난 뒤 Ctrl 을 떼면 팔레트가 지우개로 남는다 | 캔버스 `pointerleave` 에서 오버레이가 직접 본 키 상태로 다시 맞춘다 |
| 입력칸에 포커스를 둔 채 색 고르기 판을 끌면 입력칸에 옛 코드가 남는다 | 판을 누를 때 글자 입력을 끝낸다 |
| 화면을 걷기 직전 400ms 안의 변경은 보존되지 않는다 | 걷을 때 기다리던 알림을 버리지 않고 보낸다 |
| 내 색이 가득 찼을 때 담으면 가장 오래된 색이 말없이 빠진다 | 의도한 동작이다. 담기 버튼의 설명(title)에 미리 적는다 |
| 구형 `brushSettings` 를 다시 쓰면 구형 도구의 마지막 값으로 시작한다 | 전용 키 `drawingPalette` 로 나눴다 |

`panel.dataset.presentation` 은 CSS 가 읽지 않는다는 지적이 있었다. 배치 꼴을 DOM 에서 확인하는 표식으로 테스트가 쓰므로 남겼다.

## 검증 결과 (2026-10-06, 리뷰 반영 후)

자동 테스트 — 묶음별 종료 코드와 수치:

| 묶음 | 결과 |
|---|---|
| `npm run test:fabric-drawing-pilot` | 648 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:mpv` (실제 숨김 Electron 배치 검사 포함) | 475 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:drawing` (신규 `fabric-palette-prefs.test.js` 포함) | 365 pass / 0 fail / 0 cancelled, exit 0 |
| `npm run test:editor` | 147 pass / 0 fail / 0 cancelled, exit 0 — `BAEFRAME_TEST_FFMPEG` 로 메인 체크아웃의 ffmpeg 를 지정 |
| `npm run test:fabric-drawing-persistence` | 167 pass / 0 fail / 0 cancelled, exit 0 |

전체 146개 테스트 파일을 한 번에 돌린 결과(리뷰 반영 전 시점): 2,765건 중 2,750 pass / 15 fail. 실패 15건은 이번 변경과 무관하다.

- 8건: 이 worktree 에 `ffmpeg.exe` 가 없어 "real FFmpeg" 편집창 검사가 실패. 경로를 지정하면 위 표처럼 모두 통과한다.
- 7건: 변경 전(`96206df`)을 별도 worktree 로 꺼내 같은 파일을 돌려도 똑같이 실패한다 — `hybrid-review-engine-source` 4건, `playback-buffering-runtime` 1건, `drawing-v3-engine-adapter-benchmark` 2건. 이번 작업에서 고치지 않았다.

그 밖:

- 번들: `npm run bundle:mpv-fabric-overlay`, `npm run bundle:editor-drawing` 으로 다시 만들어 함께 반영했다.
- lint(`eslint --no-ignore`, 변경 파일): 오류 0. 경고는 모두 기존 unused 경고다.
- `git diff --check`: exit 0.

숨김 Electron 창에서 실제 호스트·실제 번들로 확인한 것(스크립트는 세션 임시 폴더에 두었고 저장소에는 넣지 않았다):

- 팔레트가 212px·190px 두 폭에서 넘치지 않고, 기본 8색과 편집 줄이 각각 한 줄이다. 기본·색 고르기·Ctrl·외곽선·지우개·선택·도형·밝은 테마를 캡처로 봤다.
- Chromium 이 데이터 URL 고리 커서를 받아들인다(계산된 `cursor` 값으로 확인).
- 색상 코드 입력: 입력칸에 포커스가 없을 때는 키가 메인 창으로 넘어가고, 포커스가 있는 동안에는 0건 넘어가며 글자가 들어간다. Enter 뒤에는 다시 넘어간다.
- 값 보존: 저장값 심기 → 화면 반영, 변경 → 검증기를 통과하는 형식으로 알림, 사용자가 바꾼 뒤 늦게 온 저장값은 `local-changes` 로 거절.
- 편집창 도크: 실제 `editor.css`·`editor-drawing.css`·번들로 도크와 색·굵기 팝업을 띄워 캡처로 봤다.

## 미확인

- 실제 앱에서 영상 위에 팔레트를 띄워 손으로 조작하는 실기는 하지 않았다. 숨김 Electron 창에서 실제 호스트와 번들로 확인한 범위까지다.
- 실물 펜 태블릿: 펜 호버가 Ctrl 을 싣지 않는 환경에서는 오버레이가 키를 받는 동안에만 표시가 켜진다(기존 판정과 같은 조건). 메인 창에 포커스가 있을 때 Ctrl 만 누르고 펜을 움직이지 않으면 표시가 늦을 수 있다.
- 밝은 테마, 125%·150% 배율, 다른 PC.
