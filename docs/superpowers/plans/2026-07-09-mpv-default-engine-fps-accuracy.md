# mpv 기본 엔진 승격 + fps 정합(프레임 정확 표기) 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BAEFRAME의 기본 재생 경로를 FFmpeg 트랜스코드에서 mpv 직접 재생으로 전환하고, 프레임 표기/1프레임 스테핑이 영상의 실제 fps 기준으로 정확해지게 한다.

**Architecture:** 4단계 순차 진행 — (1) fps 소스를 실제 값으로 일원화(ffprobe·mpv container-fps)하고 .bframe 프레임 데이터를 로드 시 재매핑 보정, (2) mpv 크래시/행(hang)/렌더러 리로드에 대한 자동 복구 체계 구축, (3) 그리기 모드에서 mpv 정지 프레임을 스크린샷으로 공급, (4) 설정 기본값을 mpv=on(옵트아웃)으로 반전. FFmpeg 경로는 폴백·썸네일·스플릿 뷰·합성 레이어용으로 **삭제하지 않고 유지**한다.

**Tech Stack:** Electron ^28, mpv (JSON IPC over Windows named pipe), FFmpeg(폴백 유지), `node --test` + `node:assert/strict` (소스 정규식 테스트 관례)

---

## 0. 반드시 먼저 읽을 것 — 이 문서만으로 구현하기 위한 현재 코드 사실

**라인 번호는 2026-07-09 `main` 기준이며 이후 커밋으로 수 라인 어긋날 수 있다. 항상 인용된 코드 텍스트로 검색해 위치를 확정한 뒤 수정할 것.** 프로젝트 루트: `C:\BAEframe\BAEFRAME` (이하 상대 경로).

### 0.1 재생 경로 구조

- **HTML5 경로(현재 기본)**: `loadVideo()`(app.js:6761) → ffprobe 코덱 판정(`ffmpeg:probe-codec`) → 미지원 코덱이면 FFmpeg 트랜스코드 → `videoPlayer.load(actualVideoPath)`로 `<video>` 재생.
- **mpv 경로(현재 옵트인 파일럿)**: `shouldUseMpvPilot()`(app.js:6587)이 true면 `loadVideoWithMpvPilot()`(app.js:6609) → `mpv:load` IPC → `videoPlayer.useExternalEngine()`(video-player.js:256)으로 외부 엔진 등록. mpv는 자식 BrowserWindow의 네이티브 핸들에 `--wid`로 임베드(main/mpv-embed-host.js)되고, 상태는 **120ms 폴링**(`_syncExternalStatus`, video-player.js:889~1022)으로 동기화. main→renderer push 채널은 없음(폴링 단독).
- **mpv 실패 폴백(유지 대상)**: `loadVideoWithMpvPilot` throw 시 app.js:7044~7063에서 `loadVideo(filePath, { ...options, allowMpvPilot: false })` 재귀 → FFmpeg/HTML5 경로. `allowMpvPilot: false`는 코드베이스에서 이 폴백 한 곳에서만 전달됨.

### 0.2 fps 파이프라인 현재 상태 (이번 작업의 핵심 문제)

| 항목                                   | 위치                                                                                                                                                                                               | 현재 동작                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VideoPlayer 생성                       | app.js:776~780                                                                                                                                                                                     | `new VideoPlayer({ ..., fps: 24 })` — **24 고정**                                                                                                                                                                          |
| `videoPlayer.setFps()`                 | video-player.js:705~716                                                                                                                                                                            | 정의만 있고 **호출처 0건**                                                                                                                                                                                                 |
| HTML5 loadedmetadata                   | video-player.js:127~159                                                                                                                                                                            | `totalFrames = Math.floor(duration * this.fps)` — this.fps 잔존값 사용, HTML5 API에는 fps가 없음                                                                                                                           |
| ffprobe fps                            | ffmpeg-manager.js:460, 475~482                                                                                                                                                                     | `frameRate: _parseFrameRate(r_frame_rate)` 반환하나 **loadVideo가 버림**(app.js:6820은 isSupported/codecName만 소비). `_parseFrameRate`는 `Math.round(24000/1001)=24`로 **정수 반올림**                                    |
| mpv fps                                | mpv-manager.js:258, 270                                                                                                                                                                            | `container-fps` 프로퍼티(폴백 24), **소수 그대로**(23.976 가능) 전달                                                                                                                                                       |
| mpv fps 주입                           | app.js:6690→6704, video-player.js:266                                                                                                                                                              | `useExternalEngine({fps})` + 폴링(video-player.js:939~941)이 fps 변화 시 갱신                                                                                                                                              |
| fps 리셋                               | video-player.js:242~254(useHtml5Engine), 862~887(unload)                                                                                                                                           | **리셋 없음** — mpv로 30fps 재생 후 HTML5 로드하면 30이 잔존                                                                                                                                                               |
| fps 전파 허브                          | app.js:1026~1056                                                                                                                                                                                   | `loadedmetadata` 핸들러 1곳: `timeline.setVideoInfo(duration, fps)`(1029) → `drawingManager.setVideoInfo(totalFrames, fps)`(1039) → `commentManager.setFPS(fps)`(1042). **videoPlayer.fps만 정확하면 하위 모듈 자동 전파** |
| 프레임 카운터 UI                       | app.js:7539~7554 `updateTimecodeDisplay()`                                                                                                                                                         | `` `${videoPlayer.fps}fps · Frame ${videoPlayer.currentFrame} / ${videoPlayer.totalFrames}` `` → `#frameIndicator`                                                                                                         |
| 1프레임 스테핑                         | video-player.js:616~636 → 554~614                                                                                                                                                                  | `stepFrames(±1)` → `seekToFrame(frame)`: `time = frame * (1/this.fps) + 0.001`. mpv 분기는 `externalControls.seek(time)` → `mpv:seek` → `set_property time-pos`(mpv-manager.js:202~209). `frame-step` 명령 미사용          |
| 타임코드 포맷터(정수 fps 가정 `% fps`) | video-player.js:731~747 `timeToTimecode` / app.js:7524~7534 `formatTimecode` / app.js:7687~7697 `updateFullscreenTimecode` 내부 / timeline.js:2309~2319 `_formatTimecode`, 3429~3439 `_formatTime` | 소수 fps 입력 시 프레임 자리 계산이 어긋남                                                                                                                                                                                 |

### 0.3 .bframe 저장 단위 (하위 호환 판단 근거)

- **댓글**: `CommentMarker`가 `startFrame`/`endFrame`(절대 프레임 번호) + **`fps`(생성 시점 스냅샷)** 저장(comment-manager.js:87~91, 219~226). 매니저 직렬화에도 `comments.fps` 포함(1153~1166). `fromJSON`(1171~1176)은 `if (json.fps) this.fps = json.fps;`로 저장 fps가 런타임 fps를 덮어씀.
- **드로잉**: `Keyframe.frame`(절대 프레임 번호, drawing-layer.js:15~17) + `drawings.fps`(drawing-manager.js:1353~1364). `importData`(1369~1374)는 `this.fps = data.fps || this.fps;`.
- **하이라이트/합성 레이어**: **초 단위** 저장 → fps 변경 무영향.
- **최상위 `fps` 필드**: review-data-manager.js:988 `fps: this._fps || 24` — `setFps`(1045~1050) 호출처 0건이라 **항상 24로 박제**.
- **웹뷰어**: `state.frameRate = bframeData?.comments?.fps || bframeData?.frameRate || 24`(web-viewer/scripts/app.js:1232~1235) — 최상위 `fps` 필드를 안 읽음(`frameRate`는 스키마에 없는 필드).
- **CLAUDE.md 제약**: .bframe 파일 **포맷** 변경 금지(하위 호환 유지). 이 계획은 필드 추가/삭제 없이 기존 필드의 **값 정확화 + 로드 시 해석 보정**만 수행하므로 포맷 위반이 아니다.

### 0.4 mpv 활성화 경로 (Phase 4 대상)

- 설정 키: `mpvPilotEnabled`(기본 `false`, user-settings.js:198). getter/setter는 user-settings.js:733~ (`getMpvPilotEnabled`/`setMpvPilotEnabled`). 저장은 **localStorage(`baeframe_user_settings`) + `userData/settings/user-settings.json` 이중 저장**(`_save()`, user-settings.js:341) — electron-store 아님. **주의: 기존 설치 PC에는 `mpvPilotEnabled: false`가 이미 명시 저장돼 있으므로, defaults만 바꾸면 기존 사용자에게 적용되지 않는다** (→ Task 13의 마이그레이션 필수 근거).
- 게이트: `shouldUseMpvPilot()`(app.js:6587~6607) = `filePath 존재 && !fileIsAudio && !hasPreparedVideoPath && (로컬설정 OR env BAEFRAME_MPV_PILOT) && mpv:is-available`. 재생목록 경로 4곳에서도 재호출: app.js:14434, 14638, 15013(15033), 15209.
- env: `isMpvPilotEnabled()`(mpv-manager.js:20~23, `1/true/yes/on`). IPC: `mpv:is-enabled`/`mpv:is-available`(ipc-handlers.js:1651~).
- 설정 UI: index.html:1567~ 재생 탭(`data-panel="playback"`), 체크박스 `#appSettingsMpvPilotEnabled`, 상태 문구 `#appSettingsMpvPilotStatus`. change 핸들러 app.js:11823, 모달 초기값 app.js:11549~11552, 상태 함수 `updateMpvPilotSettingsStatus` app.js:11492.

### 0.5 크래시/행 복구 현재 상태 (Phase 2 대상)

- `externalstopped` 핸들러(app.js:1216~1220): CSS 클래스 제거 + `mpvHostLastRequestedVisible = null`뿐. **재로드/토스트/폴백 없음.**
- video-player.js stopped 감지(915~926): `pollingControls.stop()` → `useHtml5Engine()` → `isLoaded=false` → `_emit('externalstopped', { engine: stoppedEngine })`.
- 폴링 실패 처리: 914행 `if (!status?.success) return;` — **조용히 스킵, 연속 실패 워치독 없음**. catch(1017행)도 log.debug만.
- `render-process-gone`(main/window.js:183~186): **로그만**. `did-navigate` 핸들러 없음, main 전체에 `.reload()` 호출 없음.
- mpv-manager exit 핸들러(390~395): 로그 + `this.process = null`만. mpv 사망 감지는 `getStatus()`(mpv-manager.js:234~249)가 죽은 프로세스에 `{ success: true, stopped: true, ... }`를 합성 반환하는 것에 전적으로 의존.
- `showToast(message, type='info', duration=null, force=false)`(app.js:10337) — app.js 내부 함수. `type='error'`는 설정 무관 항상 표시.
- 앱 종료 정리: `cleanupMpvPilotBeforeQuit()`(main/index.js:68~86)이 `mpvManager.stop({commandTimeoutMs:500})` → `mpvOverlayHost.destroy()` → `mpvEmbedHost.destroy()`. `window-all-closed`(macOS 분기)와 `before-quit`(forceQuit 분기)에서 호출.

### 0.6 그리기 모드 ↔ mpv 현재 상태 (Phase 3 대상)

- B키 → `toggleDrawMode()`(app.js:7584) → `applyDrawModeState()`(app.js:7569~7582)가 `.drawing-tools`에 `.visible` 토글 → `MPV_BLOCKING_OVERLAY_SELECTOR`(app.js:5887~5912, `.drawing-tools.visible` 포함 24종)를 감시하는 MutationObserver(app.js:6043~6058) → `syncMpvHostVisibilityWithDom()`(app.js:6021~6041) → `mpv:set-host-visible` → embed+overlay 호스트 창 모두 `hide()`. **정지 프레임 대체 없음 → mpv 모드에서 그리기는 검은 배경 위에 그림.** 재생 정지 호출도 없음(mpv는 숨겨진 채 계속 재생).
- mpv 모드에서 HTML5 `<video>`는 src 제거 + `display:none`(video-player.js:275~278).
- 그리기 캔버스 5장(onionSkin/layersBelow/drawing/layersAbove/selectionOverlay)은 `#videoWrapper` 안 투명 absolute 캔버스(index.html:388~505, main.css:1097~1111). `syncCanvasOverlay()`(app.js:5193~5251)가 `getVideoRenderArea()`(app.js:5147~5188, **mpv 모드 지원**) 기준으로 위치/크기 동기화.
- mpv-manager.js에 screenshot 계열 명령 **없음**(프로젝트 전체 grep 0건). `sendCommand(command, timeoutMs=5000)`(mpv-manager.js:432~505)는 명령마다 named pipe로 JSON 1회 왕복 — `['screenshot-to-file', path, 'video']`를 그대로 얹을 수 있는 구조.
- main의 임시 파일 관례: `app.getPath('userData')` 하위 폴더 생성(예: 썸네일 캐시 `getThumbnailCacheDir`, ipc-handlers.js:1252~1258).

### 0.7 테스트 인프라 관례

- 러너: **Node 내장 `node --test`** + `node:assert/strict`. jsdom/jest 없음. renderer 코드는 **소스 파일을 읽어 정규식 매칭**하는 소스 테스트(`*-source.test.js`)로 검증. main 모듈(mpv-manager 등)은 생성자 DI(spawn/fs/execFile 주입) + 인스턴스 메서드 monkey-patch 단위 테스트.
- `test:mpv` = `node --test scripts/tests/mpv-manager.test.js scripts/tests/mpv-embed-host.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js`(package.json:24). **mpv-runtime-source.test.js:19~24가 이 문자열 전체를 `assert.equal`로 고정** — test:mpv에 파일을 추가하면 이 단언도 반드시 갱신.
- 이번 작업으로 확실히 깨지는 기존 단언(각 Task에서 갱신 지시):
  - `mpv-runtime-source.test.js:159~187` — `mpvPilotEnabled:\s*false`, getter/setter, UI 배선 (Task 13~14)
  - `mpv-runtime-source.test.js:240` — externalstopped 핸들러 본문 (Task 8)
  - `mpv-runtime-source.test.js:416~417` — video-player stopped 블록 (Task 7)
- 앵커 주의: `playhead-frame-step-source.test.js`는 `seekToFrame`/`_syncExternalStatus`/`stepFrames` 블록을 `\n  }\n\n  stepFrames`, `\n  }\n\n  // ====== 영상 어니언 스킨` 같은 **후행 텍스트 앵커**로 추출한다. 이 함수들 "직후"에 새 메서드를 삽입하면 안 되고, 이 계획이 지정한 위치(예: Task 7은 `_stopExternalStatusPolling`과 `_syncExternalStatus` 사이)에 삽입할 것.

### 0.8 참고 문서

- 검수 보고서: `DEVLOG/2026-07-09-mpv-통합-심층검수-보고서.md` (이 계획의 근거가 된 74건 발견)
- 원 설계: `docs/superpowers/specs/2026-06-21-mpv-pilot-design.md` — "Do not delete or weaken the current FFmpeg path" 제약은 이 계획에서도 유지된다(기본값만 반전, 경로는 보존).

---

## 설계 결정 (구현 중 임의 변경 금지)

1. **FFmpeg 경로는 삭제하지 않는다.** mpv 실패 폴백, 오디오 모드, 스플릿 뷰, 합성 레이어, 썸네일, 재생목록 사전변환이 계속 사용한다. 이번 작업은 "기본값 반전"이지 "교체"가 아니다.
2. **fps는 소수를 허용한다.** mpv `container-fps`와 ffprobe `r_frame_rate`(분수 나눗셈 결과)를 소수점 3자리 반올림으로 통일한다. 프레임 계산(`_timeToFrame`, `seekToFrame`)은 소수 fps 그대로 사용하고, **타임코드 문자열 포맷(`% fps`)에서만 `Math.max(1, Math.round(fps))`를 사용**한다(NTSC non-drop 관례).
3. **.bframe 프레임 데이터는 로드 시 재매핑으로 보정한다.** 마커별 `fps` 스냅샷(과거 24 고정)과 현재 실제 fps가 다르면 `frame_new = round(frame_old × fps_new / fps_old)`로 벽시계 시각을 보존한다. 실제 24fps 영상(스튜디오 표준)에서는 no-op이므로 안전하다. 파일 포맷(필드 구성)은 변경하지 않는다.
4. **함수/식별자 이름의 대규모 리네임은 하지 않는다.** `shouldUseMpvPilot`, `loadVideoWithMpvPilot`, `mpv-pilot-mode` CSS 클래스, UI id `appSettingsMpvPilotEnabled` 등 "pilot" 명칭은 소스 테스트 다수가 고정하고 있으므로 유지한다. **예외: 사용자 설정 키만 `mpvPilotEnabled` → `mpvPlaybackEnabled`로 교체**한다(기존 설치의 저장값 false를 무효화하기 위한 의도적 키 교체 — 0.4 참고).
5. **mpv 옵트아웃 정책**: 기존에 파일럿을 명시적으로 껐던 사용자도 기본 on으로 전환된다(파일럿 off는 "의견 없음"에 가깝고, 안정화 후 재시도가 의도). 문제가 있는 PC는 설정 토글 또는 `BAEFRAME_DISABLE_MPV=1`로 옵트아웃한다.
6. **크래시 복구 정책**: 같은 파일에 대한 mpv 자동 재시도는 1회. 재차 중단되면 HTML5/FFmpeg 경로로 로드한다(무한 크래시 루프 방지). 다른 파일을 열면 재시도 카운트가 자연 리셋된다.
7. **스플릿 뷰·오디오 모드·웹뷰어 재생 로직은 이번 스코프 밖.** 스플릿 뷰의 자체 `_fps=24`(split-view-manager.js:34)는 후속 과제로 남긴다(버전 비교는 트랜스코드 경로 유지). 웹뷰어는 fps fallback 체인 1줄 수정만 한다(Task 6).
8. **각 Phase 완료 시점에 항상 배포 가능 상태를 유지한다.** Phase 순서(fps → 복구 → 그리기 → 기본값 반전)는 의존 관계다: fps 정합 없이 기본값을 반전하면 팀 리뷰 데이터 정합성이 깨지고, 복구/그리기 없이 반전하면 비개발자 팀원의 핵심 워크플로우가 깨진다. **순서를 바꾸지 말 것.**

---

## 진행 방법 (모든 Task 공통)

- 작업 브랜치: `claude/mpv-default-fps-20260709` (main에서 분기). 커밋 메시지는 한글, `feat:`/`fix:`/`refactor:` 접두사(CLAUDE.md 컨벤션).
- 각 Task는 "테스트 작성 → 실패 확인 → 구현 → 통과 확인 → 커밋" 순서(TDD). 소스 정규식 테스트는 구현 전에 반드시 실패(FAIL)를 확인해 테스트 자체의 유효성을 검증한다.
- 수정 전 반드시 해당 파일의 인용 코드를 검색해 현재 위치를 확정한다(라인 번호는 참고용).
- 전체 회귀 확인 명령(각 Chunk 끝마다 실행):
  ```bash
  npm run test:mpv && npm run test:video-pan && npm run test:fps && npm run lint
  ```
  (`test:fps`는 Task 1에서 신설. Chunk 1 이전에는 `test:mpv && test:video-pan && lint`만.)

### Task 0: 기준선 확인

- [ ] **Step 1: 브랜치 생성**

```bash
cd C:\BAEframe\BAEFRAME
git checkout main && git pull
git checkout -b claude/mpv-default-fps-20260709
```

- [ ] **Step 2: 기존 테스트 기준선 통과 확인**

```bash
npm run test:mpv && npm run test:video-pan && npm run lint
```

기대: 모두 PASS (test:mpv 60개, test:video-pan 전체). 실패 시 이 계획을 진행하지 말고 원인을 먼저 보고할 것.

---

## Chunk 1: fps 정합 통일

목표: `videoPlayer.fps`가 항상 영상의 실제 fps가 되게 하고, 그 값이 타임라인·댓글·드로잉·타임코드·프레임 카운터에 일관되게 반영되며, 과거 24 고정 시절 데이터가 로드 시 보정되게 한다.

### Task 1: fps 소스 정밀도 통일 + `test:fps` 스위트 신설

**Files:**

- Create: `scripts/tests/fps-accuracy-source.test.js`
- Modify: `main/ffmpeg-manager.js:475-482` (`_parseFrameRate`)
- Modify: `package.json` (scripts에 `test:fps` 추가)

- [ ] **Step 1: 실패하는 소스 테스트 작성**

`scripts/tests/fps-accuracy-source.test.js` 신규 생성 (관례: CJS + `node:test`, mpv-runtime-source.test.js:1~17의 읽기 헬퍼 패턴):

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const readSource = (relPath) =>
  normalizeNewlines(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));

const ffmpegManagerSource = readSource('main/ffmpeg-manager.js');
const videoPlayerSource = readSource('renderer/scripts/modules/video-player.js');
const appSource = readSource('renderer/scripts/app.js');
const timelineSource = readSource('renderer/scripts/modules/timeline.js');
const commentManagerSource = readSource('renderer/scripts/modules/comment-manager.js');
const drawingManagerSource = readSource('renderer/scripts/modules/drawing-manager.js');
const webViewerSource = readSource('web-viewer/scripts/app.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

test('package exposes an fps accuracy test command', () => {
  assert.match(packageJson.scripts['test:fps'], /fps-accuracy-source\.test\.js/);
});

test('ffprobe frame rate keeps fractional fps instead of integer rounding', () => {
  const parseMatch = ffmpegManagerSource.match(/_parseFrameRate\(rateStr\) \{([\s\S]*?)\n  \}/);
  assert.ok(parseMatch, '_parseFrameRate should exist');
  const parseSource = parseMatch[1];
  assert.doesNotMatch(
    parseSource,
    /Math\.round\(parseInt\(parts\[0\]\) \/ parseInt\(parts\[1\]\)\)/
  );
  assert.match(parseSource, /Math\.round\(fps \* 1000\) \/ 1000/);
});
```

- [ ] **Step 2: `package.json` scripts에 추가**

```json
"test:fps": "node --test scripts/tests/fps-accuracy-source.test.js",
```

(`test:mpv` 항목 바로 아래에 추가. `test:mpv` 문자열 자체는 이 Task에서 변경하지 않는다.)

- [ ] **Step 3: 테스트 실패 확인**

```bash
npm run test:fps
```

기대: `ffprobe frame rate ...` 테스트 FAIL (아직 `_parseFrameRate` 미수정), `package exposes ...` PASS.

- [ ] **Step 4: `_parseFrameRate` 수정 (main/ffmpeg-manager.js:475-482)**

현재 코드:

```js
  _parseFrameRate(rateStr) {
    if (!rateStr) return 24;
    const parts = rateStr.split('/');
    if (parts.length === 2) {
      return Math.round(parseInt(parts[0]) / parseInt(parts[1]));
    }
    return parseFloat(rateStr) || 24;
  }
```

다음으로 교체:

```js
  _parseFrameRate(rateStr) {
    if (!rateStr) return 24;
    const parts = rateStr.split('/');
    if (parts.length === 2) {
      const num = parseInt(parts[0], 10);
      const den = parseInt(parts[1], 10);
      if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return 24;
      // 24000/1001 → 23.976: mpv container-fps와 정밀도를 맞추기 위해 소수 유지 (소수점 3자리)
      const fps = num / den;
      return Math.round(fps * 1000) / 1000;
    }
    return parseFloat(rateStr) || 24;
  }
```

**안전 확인(수정 아님)**: 이 반환값의 기존 소비처 2곳은 소수 fps에 안전하다 — (a) `const gopSize = Math.round(codecInfo.frameRate || 24);`(ffmpeg-manager.js:619, 이미 반올림), (b) 재생목록 프로브 `probe.frameRate`(app.js:15066~, `Number.isFinite && > 0` 검사만). 구현 시 두 위치를 열어 여전히 이 형태인지 눈으로 확인할 것.

- [ ] **Step 5: 테스트 통과 확인**

```bash
npm run test:fps && npm run test:mpv
```

기대: 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add scripts/tests/fps-accuracy-source.test.js main/ffmpeg-manager.js package.json
git commit -m "feat: ffprobe fps 소수 정밀도 유지 및 test:fps 스위트 신설"
```

### Task 2: VideoPlayer fps 위생 — unload 리셋 + setFps 강화

**Files:**

- Modify: `renderer/scripts/modules/video-player.js:705-716` (setFps), `:862-887` (unload)
- Modify: `scripts/tests/fps-accuracy-source.test.js` (단언 추가)

- [ ] **Step 1: 실패하는 테스트 추가** (fps-accuracy-source.test.js에)

```js
test('video player resets fps on unload and setFps refreshes metadata', () => {
  const unloadMatch = videoPlayerSource.match(/unload\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(unloadMatch, 'unload should exist');
  assert.match(unloadMatch[1], /this\.fps = 24;/);

  const setFpsMatch = videoPlayerSource.match(/setFps\(fps\) \{([\s\S]*?)\n  \}/);
  assert.ok(setFpsMatch, 'setFps should exist');
  assert.match(setFpsMatch[1], /normalizeFpsValue\(fps\)/);
  assert.match(setFpsMatch[1], /this\._emit\('loadedmetadata'/);

  // mpv/ffprobe 양쪽 fps를 소수점 3자리로 통일하는 정규화 헬퍼 (설계 결정 2)
  assert.match(videoPlayerSource, /function normalizeFpsValue\(value, fallback = null\) \{/);
  assert.match(videoPlayerSource, /Math\.round\(fps \* 1000\) \/ 1000;/);
  assert.match(
    videoPlayerSource,
    /this\.fps = Math\.max\(1, normalizeFpsValue\(config\.fps\) \?\? this\.fps \?\? 24\);/
  );
  assert.match(videoPlayerSource, /const nextFps = normalizeFpsValue\(status\.fps\);/);
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:fps` → 새 테스트 FAIL.

- [ ] **Step 3: 구현**

(a) **fps 정규화 헬퍼(모듈 스코프)** — video-player.js 상단(클래스 정의 앞)에 추가. 설계 결정 2의 "소수점 3자리 반올림 통일"을 mpv 쪽에도 적용하는 단일 지점이다 (ffprobe 쪽은 Task 1에서 동일 반올림 — 두 소스가 같은 파일에 같은 fps 값을 내야 Task 5의 `sourceFps !== nextFps` 엄격 비교가 항등 재매핑을 반복하지 않는다):

```js
function normalizeFpsValue(value, fallback = null) {
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps <= 0) return fallback;
  return Math.round(fps * 1000) / 1000;
}
```

(b) `setFps`(video-player.js:705~716)를 다음으로 교체:

```js
  /**
   * FPS 설정 (로드 전 호출이 원칙. 로드 후 호출 시 메타데이터 재전파)
   * @param {number} fps
   */
  setFps(fps) {
    const nextFps = normalizeFpsValue(fps);
    if (!Number.isFinite(nextFps) || nextFps <= 0) return;
    if (this.fps === nextFps) return;
    this.fps = nextFps;
    if (this.isLoaded) {
      this.totalFrames = Math.floor(this.duration * this.fps);
      this._emit('loadedmetadata', {
        duration: this.duration,
        totalFrames: this.totalFrames,
        fps: this.fps,
        width: this.videoWidth,
        height: this.videoHeight,
        engine: this.engine
      });
    }
    log.info('FPS 변경', { fps: this.fps });
  }
```

참고(무해하지만 알아둘 것): `isLoaded=true` 상태에서 다른 fps로 호출되면 이전 영상의 duration 기준으로 loadedmetadata가 한 번 재발화했다가, 새 영상의 실제 loadedmetadata로 곧 자가 교정된다. loadVideo의 setFps 호출은 로드 직전이므로 이 창이 매우 짧다.

(c) `unload()`(video-player.js:862~887)의 `this.totalFrames = 0;` 바로 다음 줄에 추가:

```js
this.fps = 24;
```

(직전 mpv 세션의 fps가 다음 HTML5 로드로 잔존하는 오염 차단 — 0.2 표의 "fps 리셋 없음" 해결.)

(d) **mpv fps 수용 지점 2곳에 정규화 적용**:

- `useExternalEngine`(256~297)의 `this.fps = Math.max(1, Number(config.fps) || this.fps || 24);`(266행)를 다음으로 교체:

```js
this.fps = Math.max(1, normalizeFpsValue(config.fps) ?? this.fps ?? 24);
```

- `_syncExternalStatus`(905~1022)의 `const nextFps = Number(status.fps);`를 다음으로 교체:

```js
const nextFps = normalizeFpsValue(status.fps);
```

(바로 아래 `if (Number.isFinite(nextFps) && nextFps > 0 && this.fps !== nextFps)` 가드는 null에도 안전하므로 유지.)
주의: 이 두 줄을 기존 소스 정규식 테스트가 고정하고 있을 수 있다 — 수정 후 `npm run test:mpv && npm run test:video-pan`을 돌려 깨지는 단언이 있으면 새 코드에 맞게 갱신할 것.

- [ ] **Step 4: 통과 확인** — `npm run test:fps && npm run test:mpv && npm run test:video-pan` 모두 PASS. (playhead-frame-step-source.test.js의 블록 앵커는 setFps/unload와 무관하므로 영향 없음. 실패 시 0.7 앵커 주의 참조.)

- [ ] **Step 5: 커밋**

```bash
git add renderer/scripts/modules/video-player.js scripts/tests/fps-accuracy-source.test.js
git commit -m "fix: VideoPlayer fps 잔존 오염 차단 (unload 리셋 + setFps 메타데이터 재전파)"
```

### Task 3: loadVideo HTML5 경로에 실제 fps 주입

**Files:**

- Modify: `renderer/scripts/app.js` — `shouldUseMpvPilot` 함수 정의 아래에 헬퍼 신설(app.js:6607 부근), `loadVideo` 내부(app.js:6817~6849, 7064~7099)
- Modify: `scripts/tests/fps-accuracy-source.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
test('html5 load path feeds probed fps into the video player', () => {
  assert.match(appSource, /async function resolveHtml5PlaybackFps\(filePath\)/);
  // 참고: 이 추출 정규식은 기존 mpv-runtime-source.test.js:104와 같은 관례로,
  // 실제로는 loadVideo보다 넓은 범위(다음 함수 포함)를 캡처한다 — 단언 목적에는 충분.
  const loadVideoMatch = appSource.match(
    /async function loadVideo\(filePath, options = \{\}\) \{([\s\S]*?)\n  \}\n\n  \/\//
  );
  assert.ok(loadVideoMatch, 'loadVideo should exist');
  const loadVideoSource = loadVideoMatch[1];
  assert.match(loadVideoSource, /let html5ProbedFps = null;/);
  assert.match(loadVideoSource, /videoPlayer\.setFps\(html5Fps\);/);
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:fps` → FAIL.

- [ ] **Step 3: 헬퍼 함수 추가** — app.js의 `shouldUseMpvPilot` 함수(0.4 참고, `async function shouldUseMpvPilot`로 검색) **정의 바로 아래**에 추가:

```js
/**
 * HTML5 <video> 경로용 실제 fps 조회.
 * 우선순위: ffprobe(frameRate) → mpv 헤드리스 프로브(container-fps) → 24.
 * HTML5 video API는 fps를 제공하지 않으므로 로드 전에 반드시 외부 프로브가 필요하다.
 */
async function resolveHtml5PlaybackFps(filePath) {
  if (!filePath) return 24;
  try {
    if (await window.electronAPI.ffmpegIsAvailable()) {
      const probe = await window.electronAPI.ffmpegProbeCodec(filePath);
      const probedFps = Number(probe?.frameRate);
      if (probe?.success && Number.isFinite(probedFps) && probedFps > 0) {
        return probedFps;
      }
    }
  } catch (error) {
    log.warn('ffprobe fps 조회 실패', { error: error.message });
  }
  try {
    if (window.electronAPI?.mpvIsAvailable && (await window.electronAPI.mpvIsAvailable())) {
      const mpvProbe = await window.electronAPI.mpvProbeMetadata(filePath);
      const mpvFps = Number(mpvProbe?.fps);
      if (mpvProbe?.success && Number.isFinite(mpvFps) && mpvFps > 0) {
        return mpvFps;
      }
    }
  } catch (error) {
    log.warn('mpv 프로브 fps 조회 실패', { error: error.message });
  }
  return 24;
}
```

- [ ] **Step 4: loadVideo 수정 (2곳, 추가 위주 — 기존 라인 재배치 금지)**

(a) `const ffmpegAvailable = !useMpvPilot && ...`(app.js:6817, `!useMpvPilot && !hasPreparedVideoPath && !fileIsAudio && await window.electronAPI.ffmpegIsAvailable()`로 검색) **바로 위**에 선언 추가:

```js
let html5ProbedFps = null;
```

(b) `if (ffmpegAvailable) {` 블록 내부, `const codecInfo = await window.electronAPI.ffmpegProbeCodec(filePath);`와 `if (!canContinueVideoLoad()) return false;` **직후**(즉 codecInfo가 유효한 스코프 안, `if (codecInfo.success && !codecInfo.isSupported)` 분기 **이전**)에 추가:

```js
const probedFrameRate = Number(codecInfo?.frameRate);
if (codecInfo?.success && Number.isFinite(probedFrameRate) && probedFrameRate > 0) {
  html5ProbedFps = probedFrameRate;
}
```

(c) HTML5 `<video>` 분기(app.js:7064~, `elements.videoWrapper?.classList.remove('mpv-pilot-mode');`로 시작하는 else 블록)에서 `await videoPlayer.load(actualVideoPath);` **호출 직전**에 추가:

```js
const html5Fps = html5ProbedFps ?? (fileIsAudio ? 24 : await resolveHtml5PlaybackFps(filePath));
if (!canContinueVideoLoad()) return false;
videoPlayer.setFps(html5Fps);
```

주의: `videoPlayer.load()`의 `loadedmetadata`가 `totalFrames = duration * this.fps`를 계산하므로 setFps는 반드시 load **전**이어야 한다. `filePath`(원본)를 프로브하는 이유: 트랜스코드 산출물은 `-r` 미지정으로 원본 fps를 유지하므로(0.2 표) 어느 쪽을 프로브해도 동일하고, 원본이 캐시 유무와 무관하게 항상 존재한다.

- [ ] **Step 5: 통과 확인** — `npm run test:fps && npm run test:mpv` 모두 PASS. (mpv-runtime-source.test.js:103~115가 loadVideo 블록을 검사하지만 기존 라인을 지우지 않았으므로 통과해야 함. 실패 시 추가 위치가 기존 단언 라인을 갈랐는지 확인.)

- [ ] **Step 6: 수동 확인** — `npm run dev`로 실행, mpv 파일럿 **끈** 상태에서 30fps 영상을 열어 프레임 카운터가 `30fps · Frame ...`으로 표시되는지 확인. 이어서 24fps 영상을 열어 `24fps`로 되돌아오는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add renderer/scripts/app.js scripts/tests/fps-accuracy-source.test.js
git commit -m "feat: HTML5 재생 경로에 ffprobe/mpv 프로브 기반 실제 fps 주입"
```

### Task 4: 타임코드/프레임 표기 소수 fps 대응

**Files:**

- Modify: `renderer/scripts/modules/video-player.js:731-747` (`timeToTimecode`)
- Modify: `renderer/scripts/app.js:7524-7534` (`formatTimecode`), `:7687-7697` (`updateFullscreenTimecode` 내부 로컬 formatTimecode), `:7552-7553` (frameIndicator)
- Modify: `renderer/scripts/modules/timeline.js:2309-2319` (`_formatTimecode`), `:3429-3439` (`_formatTime`)
- Modify: `scripts/tests/fps-accuracy-source.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
test('timecode formatters round fps for frame digits (fractional fps safe)', () => {
  const timecodeMatch = videoPlayerSource.match(/timeToTimecode\(time\) \{([\s\S]*?)\n  \}/);
  assert.ok(timecodeMatch, 'timeToTimecode should exist');
  assert.match(timecodeMatch[1], /Math\.max\(1, Math\.round\(Number\(this\.fps\) \|\| 24\)\)/);

  assert.match(
    appSource,
    /function formatTimecode\(seconds, fps = 24\) \{[\s\S]*?Math\.max\(1, Math\.round\(Number\(fps\) \|\| 24\)\)/
  );
  assert.match(appSource, /function formatFpsLabel\(fps\)/);
  assert.match(appSource, /\$\{formatFpsLabel\(videoPlayer\.fps\)\}fps · Frame/);
  assert.match(
    timelineSource,
    /_formatTimecode\(time\) \{[\s\S]*?Math\.max\(1, Math\.round\(Number\(this\.fps\) \|\| 24\)\)/
  );
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:fps` → FAIL.

- [ ] **Step 3: 구현 — 5개 포맷터 공통 패턴 적용**

각 함수의 첫머리에서 fps를 정수화한 지역 변수로 치환한다. **`% fps`·`Math.floor(x / fps)` 연산에만 정수 fps를 쓰고, 그 외 프레임 계산 로직은 건드리지 않는다.**

(a) video-player.js `timeToTimecode`(731~747) — 함수 본문 시작을 다음 형태로 수정 (기존 `this.fps` 사용을 `rate`로 치환):

```js
  timeToTimecode(time) {
    const rate = Math.max(1, Math.round(Number(this.fps) || 24));
    const totalFrames = Math.round((Number(time) || 0) * rate);
    const frames = totalFrames % rate;
    const totalSeconds = Math.floor(totalFrames / rate);
```

(이하 시/분/초 계산은 기존 코드 유지 — `this.fps` 잔여 사용이 있으면 모두 `rate`로.)

(b) app.js `formatTimecode`(7524~7534) — 동일 패턴:

```js
  function formatTimecode(seconds, fps = 24) {
    const rate = Math.max(1, Math.round(Number(fps) || 24));
```

(본문의 `fps` 사용을 전부 `rate`로 치환.)

(c) app.js `updateFullscreenTimecode`(7687~7697) — 주의: 이곳은 (b)와 형태가 다르다. 로컬 포맷터는 화살표 함수이고 fps는 **외부 클로저** `const fps = videoPlayer.fps || 24;`(7687행)에서 온다. 그 클로저 선언을 다음으로 교체하면 충분하다:

```js
const fps = Math.max(1, Math.round(Number(videoPlayer.fps) || 24));
```

(d) timeline.js 2곳:

- `_formatTimecode`(2309~2319) — (a)와 동일 패턴: 함수 첫머리에 `const rate = Math.max(1, Math.round(Number(this.fps) || 24));`를 두고 본문의 `this.fps`(또는 지역 fps)를 `rate`로 치환.
- `_formatTime`(3429~3439) — 이곳은 `% fps`가 아니라 `const f = Math.floor((seconds % 1) * this.fps);` 형태다. 다음으로 교체:

```js
const rate = Math.max(1, Math.round(Number(this.fps) || 24));
const f = Math.floor((seconds % 1) * rate);
```

(그 외 이 함수의 `this.fps` 사용도 `rate`로 치환.)

(e) app.js frameIndicator(7552~7553) — `updateTimecodeDisplay` 근처에 헬퍼 추가 후 치환:

```js
function formatFpsLabel(fps) {
  const value = Number(fps) || 24;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
```

```js
elements.frameIndicator.textContent = `${formatFpsLabel(videoPlayer.fps)}fps · Frame ${videoPlayer.currentFrame} / ${videoPlayer.totalFrames}`;
```

- [ ] **Step 4: 통과 확인** — `npm run test:fps && npm run test:mpv && npm run test:video-pan && npm run test:frame-grid`. `test:frame-grid`에 timeline 프레임 UI 소스 테스트(timeline-frame-ui-source.test.js)가 있으므로 반드시 포함. 실패하면 timeline.js에서 계산식(`Math.floor((time * fps) + 1e-6)` 등)을 건드렸는지 확인 — 포맷터 2개 외에는 수정 금지.

- [ ] **Step 5: 커밋**

```bash
git add renderer/scripts/modules/video-player.js renderer/scripts/app.js renderer/scripts/modules/timeline.js scripts/tests/fps-accuracy-source.test.js
git commit -m "fix: 타임코드/프레임 표기의 소수 fps 대응 (프레임 자리 정수 반올림)"
```

### Task 5: .bframe 프레임 데이터 로드 시 fps 재매핑 보정

**Files:**

- Modify: `renderer/scripts/modules/comment-manager.js` — `setFPS`(355~358), `fromJSON`(1171~1176), 재매핑 헬퍼 신설
- Modify: `renderer/scripts/modules/drawing-manager.js` — `importData`(1369~1374)
- Modify: `renderer/scripts/app.js:1026-1056` — loadedmetadata 핸들러에 `reviewDataManager.setFps(fps)` 추가
- Modify: `scripts/tests/fps-accuracy-source.test.js`

**배경**: 0.3 참조. 목표 의미론 — "마커/키프레임의 벽시계 시각 보존". `frame_new = round(frame_old × fps_new / fps_old)`. `fps_old`는 마커별 `fps` 스냅샷(없으면 24 — 24 고정 시절 생성 데이터).

- [ ] **Step 1: 구현 전 구조 확인 (필수)**

comment-manager.js의 `toJSON()`(1153~1166)과 `getMarkerRanges()`(957~982)를 열어 **레이어/마커 컬렉션의 실제 필드명**(예: `this.layers`, `layer.markers`)을 확인한다. drawing-manager.js의 `exportData`(1353~1364)와 drawing-layer.js의 키프레임 배열 필드명(예: `layer.keyframes`)도 확인한다. 아래 코드의 순회 부분은 이 확인 결과에 맞춰 조정한다(로직은 그대로).

- [ ] **Step 2: 실패하는 테스트 추가**

```js
test('bframe frame data is remapped when stored fps differs from playback fps', () => {
  assert.match(commentManagerSource, /_remapMarkersToFps\(nextFps\)/);
  const setFpsMatch = commentManagerSource.match(/setFPS\(fps\) \{([\s\S]*?)\n  \}/);
  assert.ok(setFpsMatch, 'setFPS should exist');
  assert.match(setFpsMatch[1], /this\._remapMarkersToFps\(/);
  // 주의: comment-manager.js에는 CommentMarker의 `static fromJSON(json)`(258행 부근)이
  // 매니저 fromJSON(1171행 부근)보다 먼저 나온다. 들여쓰기 앵커 `\n  fromJSON`으로
  // 매니저 쪽만 매칭해야 한다 (`\n  static fromJSON`은 매칭되지 않음).
  const fromJsonMatch = commentManagerSource.match(/\n  fromJSON\(json\) \{([\s\S]*?)\n  \}/);
  assert.ok(fromJsonMatch, 'manager fromJSON should exist');
  assert.doesNotMatch(fromJsonMatch[1], /this\.fps = json\.fps;/);
  assert.match(fromJsonMatch[1], /this\._remapMarkersToFps\(this\.fps\);/);

  assert.match(
    drawingManagerSource,
    /const sourceFps = Number\(data\.fps\) > 0 \? Number\(data\.fps\) : 24;/
  );
  assert.match(appSource, /reviewDataManager\.setFps\(fps\);/);
});
```

주의: `fromJSON`의 실제 시그니처가 `fromJSON(json)`이 아닐 수 있다 — Step 1에서 확인한 실제 시그니처로 정규식을 맞출 것.

- [ ] **Step 3: 실패 확인** — `npm run test:fps` → FAIL.

- [ ] **Step 4: comment-manager.js 구현**

(a) `setFPS`(355~358)를 다음으로 교체:

```js
  setFPS(fps) {
    const nextFps = Number(fps);
    if (!Number.isFinite(nextFps) || nextFps <= 0) return;
    this.fps = nextFps;
    this._remapMarkersToFps(nextFps);
  }
```

(b) setFPS 바로 아래에 헬퍼 신설 (마커 순회는 Step 1에서 확인한 실제 구조 사용):

```js
  /**
   * 저장 시점 fps(marker.fps 스냅샷)와 현재 재생 fps가 다르면
   * 벽시계 시각을 보존하도록 프레임 번호를 재매핑한다.
   * 24fps 고정 시절 데이터(marker.fps 부재 또는 24)는 24를 기준으로 본다.
   */
  _remapMarkersToFps(nextFps) {
    this.layers.forEach((layer) => {
      layer.markers.forEach((marker) => {
        const sourceFps = Number(marker.fps) > 0 ? Number(marker.fps) : 24;
        if (sourceFps !== nextFps) {
          const factor = nextFps / sourceFps;
          marker.startFrame = Math.max(0, Math.round(marker.startFrame * factor));
          marker.endFrame = Math.max(marker.startFrame, Math.round(marker.endFrame * factor));
        }
        marker.fps = nextFps;
      });
    });
  }
```

(c) `fromJSON`(1171~1176)에서 `if (json.fps) { this.fps = json.fps; }` 줄을 **삭제**하고, 레이어/마커 로드가 끝난 지점(함수 끝부분)에 추가:

```js
this._remapMarkersToFps(this.fps);
```

(로드 순서상 `loadedmetadata` → `commentManager.setFPS(실제fps)`가 먼저 실행되고 그 뒤 `reviewDataManager.setVideoFile` → `fromJSON`이 실행되므로(app.js:7180), fromJSON 시점의 `this.fps`는 이미 실제 fps다. mpv 폴링이 이후 fps를 갱신하면 setFPS가 다시 호출되어 재매핑이 일관되게 반복된다 — 재매핑 후 `marker.fps = nextFps`로 갱신되므로 멱등.)

- [ ] **Step 5: drawing-manager.js 구현**

`importData`(1369~1374)에서 `this.fps = data.fps || this.fps;` 줄을 다음 블록으로 교체 (키프레임 순회는 Step 1 확인 구조 사용):

```js
const sourceFps = Number(data.fps) > 0 ? Number(data.fps) : 24;
if (Number(this.fps) > 0 && sourceFps !== this.fps) {
  const factor = this.fps / sourceFps;
  this.layers.forEach((layer) => {
    layer.keyframes.forEach((kf) => {
      kf.frame = Math.max(0, Math.round(kf.frame * factor));
    });
    // 축소 재매핑(factor < 1)으로 프레임 번호가 충돌하면 뒤 키프레임 우선
    layer.keyframes = layer.keyframes.filter(
      (kf, i, arr) => i === arr.length - 1 || arr[i + 1].frame !== kf.frame
    );
  });
}
```

주의: `layer.keyframes`가 frame 오름차순 배열이라는 전제를 Step 1에서 확인할 것. 정렬 보장이 없으면 filter 전에 `layer.keyframes.sort((a, b) => a.frame - b.frame);` 추가.

- [ ] **Step 6: review-data-manager 최상위 fps 배선 (3개 하위 수정)**

(a) app.js loadedmetadata 핸들러(1026~1056)의 `commentManager.setFPS(fps);` 바로 다음 줄에:

```js
reviewDataManager.setFps(fps);
```

(b) **기존 파일 로드 시 덮어쓰기 대응**: 로드 순서상 (a)는 `videoPlayer.load`(app.js:7081) 시점에 실행되고, 그 **뒤** `reviewDataManager.setVideoFile(filePath)`(app.js:7180)의 역직렬화가 `this._fps = data.fps || 24;`(review-data-manager.js:1014)로 레거시 저장값(24)을 다시 덮어쓴다. 따라서 app.js에서 `await reviewDataManager.setVideoFile(...)` 호출 **직후**에도 한 줄 추가:

```js
reviewDataManager.setFps(videoPlayer.fps);
```

(이래야 기존 .bframe도 다음 저장 시 최상위 fps가 실제 값으로 갱신된다.)

(c) **로드만으로 더티 방지**: review-data-manager.js의 `setFps`(1045~1050)가 값 변경 없이도 더티 플래그를 세우는지 확인하고, 동일 값이면 조기 반환하는 가드를 추가한다 (실제 더티 필드명은 파일에서 확인):

```js
  setFps(fps) {
    const nextFps = Number(fps);
    if (!Number.isFinite(nextFps) || nextFps <= 0) return;
    if (this._fps === nextFps) return;
    this._fps = nextFps;
    // 이하 기존 본문(더티 처리 등) 유지
```

- [ ] **Step 7: 통과 확인** — `npm run test:fps && npm run test:mpv && npm run test:cluster` (comment 계열 테스트 포함). 추가로 comment-manager를 다루는 다른 스위트가 있는지 `grep -l "comment-manager" scripts/tests/`로 확인해 실행.

- [ ] **Step 8: 수동 확인** — 24fps 영상의 기존 .bframe을 열어 댓글 마커 위치가 **변하지 않는지**(no-op) 확인. 30fps 영상에서 새 댓글 작성 → 저장 → 다시 열어 같은 위치인지 확인.

- [ ] **Step 9: 커밋**

```bash
git add renderer/scripts/modules/comment-manager.js renderer/scripts/modules/drawing-manager.js renderer/scripts/app.js scripts/tests/fps-accuracy-source.test.js
git commit -m "feat: .bframe 프레임 데이터의 fps 불일치 로드 보정(벽시계 시각 보존 재매핑)"
```

### Task 6: 웹뷰어 fps fallback 체인 수정

**Files:**

- Modify: `web-viewer/scripts/app.js:1232-1235`
- Modify: `scripts/tests/fps-accuracy-source.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
test('web viewer reads top-level bframe fps field', () => {
  assert.match(
    webViewerSource,
    /state\.frameRate = state\.bframeData\?\.comments\?\.fps \|\| state\.bframeData\?\.fps \|\| state\.bframeData\?\.frameRate \|\| 24;/
  );
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:fps` → FAIL.

- [ ] **Step 3: 구현** — web-viewer/scripts/app.js:1235의

```js
state.frameRate = state.bframeData?.comments?.fps || state.bframeData?.frameRate || 24;
```

를 다음으로 교체:

```js
state.frameRate =
  state.bframeData?.comments?.fps || state.bframeData?.fps || state.bframeData?.frameRate || 24;
```

- [ ] **Step 4: 통과 확인** — `npm run test:fps` PASS.

- [ ] **Step 5: 커밋 + 배포 메모**

```bash
git add web-viewer/scripts/app.js scripts/tests/fps-accuracy-source.test.js
git commit -m "fix: 웹뷰어가 .bframe 최상위 fps 필드를 읽도록 fallback 체인 보강"
```

메모: web-viewer/ 변경은 Vercel 재배포가 필요하다(CLAUDE.md "변경 시 주의 항목"). PR 본문에 명시할 것.

### Chunk 1 완료 게이트

- [ ] `npm run test:fps && npm run test:mpv && npm run test:video-pan && npm run test:frame-grid && npm run test:cluster && npm run lint` 전부 PASS
- [ ] 수동: mpv 파일럿 **켠** 상태에서 30fps 영상 재생 → 프레임 카운터 30fps 표기 → 곧바로 24fps 영상을 HTML5 모드(파일럿 끔)로 열어 24fps 표기 확인(잔존 오염 없음)

---

## Chunk 2: mpv 장애 복구 (기본값 전환의 전제 조건)

목표: mpv가 죽거나(크래시) 응답이 없거나(행) 렌더러가 리로드돼도, 비개발자 팀원이 앱 재시작 없이 계속 작업할 수 있게 한다. 현재는 세 경우 모두 검은 화면/유령 창으로 방치된다(0.5).

### Task 7: VideoPlayer 행(hang) 워치독 + externalstopped 상세 정보

**Files:**

- Modify: `renderer/scripts/modules/video-player.js` — 생성자(외부 엔진 필드 초기화 부근), `useExternalEngine`(256~297), `_syncExternalStatus`(905~1022), 신규 메서드 1개
- Modify: `scripts/tests/mpv-runtime-source.test.js` — `:19-24`(test:mpv 문자열 assert.equal)와 `:416`(video-player stopped 블록 단언)만. **주의: 417행(app.js externalstopped 핸들러 단언)은 이 Task가 아니라 Task 8에서 갱신** — app.js는 Task 8에서 수정되므로 여기서 미리 고치면 Task 7 게이트가 깨진다.
- Create: `scripts/tests/mpv-recovery-source.test.js`
- Modify: `package.json`의 `test:mpv` 문자열

- [ ] **Step 1: 신규 테스트 파일 작성** — `scripts/tests/mpv-recovery-source.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const readSource = (relPath) =>
  normalizeNewlines(fs.readFileSync(path.join(rootDir, relPath), 'utf8'));

const videoPlayerSource = readSource('renderer/scripts/modules/video-player.js');
const appSource = readSource('renderer/scripts/app.js');
const windowSource = readSource('main/window.js');

test('external status polling escalates repeated failures to a stop event', () => {
  assert.match(videoPlayerSource, /this\._externalStatusFailureCount = 0;/);
  const watchdogMatch = videoPlayerSource.match(
    /_registerExternalStatusFailure\(pollingControls\) \{([\s\S]*?)\n  \}/
  );
  assert.ok(watchdogMatch, 'watchdog method should exist');
  assert.match(watchdogMatch[1], /this\._externalStatusFailureCount \+= 1;/);
  assert.match(watchdogMatch[1], /reason: 'unresponsive'/);
  assert.match(watchdogMatch[1], /_emit\('externalstopped', detail\);/);
});

test('externalstopped carries recovery context', () => {
  assert.match(
    videoPlayerSource,
    /_emit\('externalstopped', \{[\s\S]*?engine: stoppedEngine,[\s\S]*?filePath:[\s\S]*?lastFrame:[\s\S]*?reason: 'stopped'/
  );
});
```

- [ ] **Step 2: `test:mpv`에 파일 추가 (2곳 동기 수정 — 0.7 참고)**

package.json:

```json
"test:mpv": "node --test scripts/tests/mpv-manager.test.js scripts/tests/mpv-embed-host.test.js scripts/tests/mpv-overlay-host.test.js scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-recovery-source.test.js",
```

mpv-runtime-source.test.js:19~24의 `assert.equal` 두 번째 인자를 **위와 동일한 문자열**로 갱신.

- [ ] **Step 3: 실패 확인** — `npm run test:mpv` → 신규 2개 테스트 FAIL, 나머지 PASS.

- [ ] **Step 4: video-player.js 구현**

(a) 생성자에서 `this._externalStatusTimer`/`this._externalStatusPending`이 초기화되는 부근에 추가:

```js
this._externalStatusFailureCount = 0;
```

그리고 `useExternalEngine(config)`(256~297) 본문 초반(`this._stopExternalStatusPolling();` 다음)에도 같은 줄을 추가한다 — 이전 세션의 실패 카운트가 새 mpv 세션으로 이월돼 조기 승격되는 것을 방지.

(b) **신규 메서드** — 삽입 위치는 `_stopExternalStatusPolling()`(889~903)과 `async _syncExternalStatus()`(905) **사이** (0.7 앵커 주의: `_syncExternalStatus` 뒤에 넣으면 playhead-frame-step-source.test.js의 블록 추출 앵커가 오염된다):

```js
  /**
   * mpv 행(hang)/IPC 오류 워치독.
   * 상태 폴링이 연속 3회 실패하면(각 시도는 최대 5초의 IPC 타임아웃) 엔진이
   * 응답 불능이라 보고 externalstopped로 승격한다. 렌더러(app.js)가 복구를 담당한다.
   */
  _registerExternalStatusFailure(pollingControls) {
    this._externalStatusFailureCount += 1;
    if (this._externalStatusFailureCount < 3) return;
    this._externalStatusFailureCount = 0;
    const stoppedEngine = this.engine;
    const detail = {
      engine: stoppedEngine,
      filePath: this.filePath,
      lastTime: this.currentTime,
      lastFrame: this.currentFrame,
      reason: 'unresponsive'
    };
    log.warn('외부 플레이어 응답 없음, 엔진 정리', detail);
    Promise.resolve(pollingControls?.stop?.()).catch(() => {});
    this.useHtml5Engine();
    this.isLoaded = false;
    this._emit('externalstopped', detail);
  }
```

(c) `_syncExternalStatus`(905~1022) 수정 3곳:

- 914행 `if (!status?.success) return;` 을 다음으로 교체:

```js
if (!status?.success) {
  this._registerExternalStatusFailure(pollingControls);
  return;
}
this._externalStatusFailureCount = 0;
```

- stopped 분기(915~926)의 emit을 상세 정보 포함으로 교체. **`filePath`는 `useHtml5Engine()` 호출 전에 스냅샷**해야 한다(useHtml5Engine은 filePath를 안 건드리지만 방어적으로):

```js
if (status.stopped === true) {
  const stoppedEngine = this.engine;
  const stoppedFilePath = this.filePath;
  const stoppedTime = this.currentTime;
  const stoppedFrame = this.currentFrame;
  try {
    await pollingControls?.stop?.();
  } catch (error) {
    log.warn('중지된 외부 플레이어 정리 실패', { error: error.message });
  }
  this.useHtml5Engine();
  this.isLoaded = false;
  this._emit('externalstopped', {
    engine: stoppedEngine,
    filePath: stoppedFilePath,
    lastTime: stoppedTime,
    lastFrame: stoppedFrame,
    reason: 'stopped'
  });
  return;
}
```

- catch 블록(1017행 부근)을 다음으로 교체:

```js
    } catch (error) {
      log.debug('외부 플레이어 상태 동기화 실패', { error: error.message });
      if (this.engine === pollingEngine && this.externalControls === pollingControls) {
        this._registerExternalStatusFailure(pollingControls);
      }
    } finally {
```

- [ ] **Step 5: 기존 소스 테스트 갱신** — `externalstopped` 관련 기존 단언은 mpv-runtime-source.test.js의 **3곳**(240, 416, 417)이다. 이 Task에서는 **416행(video-player stopped 블록을 고정하는 videoPlayerSource 단언)만** 새 detail 오브젝트 형태에 맞게 갱신한다. **240·417행(app.js 핸들러를 고정하는 appSource 단언)은 Task 8에서 app.js와 함께 갱신** — 여기서 미리 고치면 이 Task의 게이트가 깨진다. 정확한 기존 단언 텍스트는 해당 파일에서 `externalstopped`로 검색해 확인.

참고: 행(hang) 감지의 최악 지연은 IPC 타임아웃 5초 × 연속 3회 ≈ **15초**다(크래시 감지는 stopped 합성 반환으로 ~0.5초). 진짜 행에서는 15초간 무반응처럼 보일 수 있음 — 수동 검증 시 참고.

- [ ] **Step 6: 통과 확인** — `npm run test:mpv && npm run test:video-pan` 전부 PASS. (video-pan의 playhead 테스트가 깨지면 신규 메서드 삽입 위치가 앵커를 침범한 것 — Step 4-(b) 위치 재확인.)

- [ ] **Step 7: 커밋**

```bash
git add renderer/scripts/modules/video-player.js scripts/tests/mpv-recovery-source.test.js scripts/tests/mpv-runtime-source.test.js package.json
git commit -m "feat: mpv 행 감지 워치독 및 externalstopped 복구 컨텍스트 추가"
```

### Task 8: 예기치 못한 mpv 중단 자동 복구 (app.js)

**Files:**

- Modify: `renderer/scripts/app.js:1216-1220` (externalstopped 핸들러)
- Modify: `scripts/tests/mpv-runtime-source.test.js:240, :417` (기존 핸들러 단언 2곳 갱신), `scripts/tests/mpv-recovery-source.test.js`

**복구 정책(설계 결정 6)**: 같은 파일 mpv 재시도 1회 → 재차 중단 시 `allowMpvPilot:false`(FFmpeg/HTML5)로 로드. 항상 토스트로 통보. **의도적 정지(파일 전환·mpv 재기동 중)는 복구를 건너뛴다.**

- [ ] **Step 1: 실패하는 테스트 추가** (mpv-recovery-source.test.js):

```js
test('unexpected mpv stop triggers reload with retry policy', () => {
  const handlerMatch = appSource.match(
    /videoPlayer\.addEventListener\('externalstopped', \(e\) => \{([\s\S]*?)\n  \}\);/
  );
  assert.ok(handlerMatch, 'externalstopped handler should exist');
  const handlerSource = handlerMatch[1];
  assert.match(handlerSource, /if \(isAppShuttingDown\) return;/);
  assert.match(handlerSource, /if \(mpvPilotHostPreparing\) return;/);
  assert.match(handlerSource, /allowMpvPilot: retryMpv/);
  assert.match(handlerSource, /initialFrame: resumeFrame/);
  assert.match(handlerSource, /showToast\(/);
  assert.match(
    appSource,
    /let mpvUnexpectedStopRecovery = \{ filePath: null, attempted: false \};/
  );
  assert.match(appSource, /isAppShuttingDown = true;/);
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:mpv` → 신규 FAIL.

- [ ] **Step 3: 구현 전 확인 (필수)** — app.js에서 다음을 확인:
  1. `mpvPilotHostPreparing` 변수 — 선언 app.js:5882, `loadVideoWithMpvPilot` 진입 직후 6645에서 true, 성공 시 6741·실패/stale 시 `cleanupPendingMpvPilot`의 finally(6639)에서 false. **mpv 로드 구간(호스트 준비→mpvLoad→useExternalEngine→초기 seek) 전체를 성공·실패 양쪽에서 커버함이 확인됐다** — 가드로 그대로 사용.
  2. `isSameFilePath` 헬퍼 존재(app.js:487).
  3. `state.currentFile`이 현재 열린 파일 경로를 담는지(선언 369, 갱신 7103).
  4. **앱 종료 플래그**: 렌더러의 `beforeunload` 핸들러(app.js:868~874 부근)를 찾아, 그 안에서 세울 종료 플래그를 준비한다(아래 Step 4의 `isAppShuttingDown`). 앱 종료 시 main의 `cleanupMpvPilotBeforeQuit`이 mpv를 먼저 죽이면 아직 살아있는 렌더러 폴링이 stopped를 감지해 복구 로드가 시작될 수 있다 — 이 가드가 없으면 종료 도중 mpv가 재기동되는 고아 프로세스 레이스가 생긴다.

- [ ] **Step 4: 구현** — 기존 핸들러(app.js:1216~1220)를 다음으로 교체하고, 핸들러 **바로 위**에 상태 변수를 선언:

```js
// mpv 예기치 못한 중단(크래시/행) 복구 상태 — 같은 파일 mpv 재시도는 1회만
let mpvUnexpectedStopRecovery = { filePath: null, attempted: false };
let isAppShuttingDown = false;

videoPlayer.addEventListener('externalstopped', (e) => {
  elements.videoWrapper?.classList.remove('mpv-pilot-mode');
  document.body.classList.remove('mpv-pilot-mode');
  mpvHostLastRequestedVisible = null;

  // 앱 종료 중 main의 mpv 정리를 크래시로 오인해 재기동하는 레이스 방지
  if (isAppShuttingDown) return;
  // mpv 재기동/파일 전환 중 폴링이 감지한 일시적 stopped는 복구 대상이 아님
  if (mpvPilotHostPreparing) return;

  const detail = e.detail || {};
  const stoppedFilePath = detail.filePath || state.currentFile;
  if (!stoppedFilePath || !isSameFilePath(stoppedFilePath, state.currentFile)) return;

  const retryMpv =
    !mpvUnexpectedStopRecovery.attempted ||
    !isSameFilePath(mpvUnexpectedStopRecovery.filePath, stoppedFilePath);
  mpvUnexpectedStopRecovery = { filePath: stoppedFilePath, attempted: true };

  const resumeFrame = Number.isFinite(Number(detail.lastFrame)) ? Number(detail.lastFrame) : null;
  // force=true: 사용자가 토스트 알림을 꺼 두어도 복구 통보는 항상 표시 (정책)
  showToast(
    retryMpv
      ? 'mpv 재생이 중단되어 영상을 다시 불러옵니다.'
      : 'mpv 재생이 반복 중단되어 기존 변환 방식으로 다시 불러옵니다.',
    'warning',
    null,
    true
  );
  log.warn('mpv 예기치 못한 중단, 자동 복구', { reason: detail.reason, retryMpv, resumeFrame });
  void loadVideo(stoppedFilePath, {
    keepVersionContext: true,
    allowMpvPilot: retryMpv,
    initialFrame: resumeFrame,
    playWhenMediaReady: false
  });
});
```

그리고 Step 3-4에서 찾은 `beforeunload` 핸들러(app.js:868~874 부근) 첫머리에 추가:

```js
isAppShuttingDown = true;
```

(선언 위치가 핸들러보다 뒤라면 선언을 앞으로 옮기거나 `window.addEventListener('beforeunload', ...)` 배선 위치를 확인해 스코프가 닿게 조정할 것.)

주의: `loadVideo` 옵션 중 `keepVersionContext`/`initialFrame`/`playWhenMediaReady`는 기존 시그니처(app.js:6761~6775)에 존재함을 확인했다. `allowMpvPilot: retryMpv`가 두 번째 복구에서 false가 되어 FFmpeg 경로로 간다. `showToast`의 4번째 인자 `force=true`는 app.js:10337 시그니처 확인됨.

- [ ] **Step 5: 기존 단언 갱신** — mpv-runtime-source.test.js의 **240행과 417행 둘 다**(모두 app.js의 externalstopped 핸들러를 고정하는 appSource 단언 — 인자 없는 `\(\) =>` 화살표 함수 형태)를 새 시그니처 `(e) =>`와 본문에 맞게 갱신. Task 8 신규 테스트의 핸들러 추출 정규식도 `(e) =>` 기준임을 재확인.

- [ ] **Step 6: 통과 확인** — `npm run test:mpv` 전부 PASS.

- [ ] **Step 7: 수동 검증 (필수 — 이 Task의 핵심 산출물)**

1. mpv 파일럿을 켜고 영상 재생 중 **작업 관리자에서 mpv.exe 강제 종료** → 최대 ~0.5초 내 토스트("다시 불러옵니다") + 같은 프레임 부근에서 mpv로 재로드되는지 확인.
2. 재로드 직후 다시 mpv.exe 강제 종료 → "기존 변환 방식으로" 토스트 + HTML5/FFmpeg 경로로 재생되는지 확인.
3. 다른 파일을 열고 재생 → 정상 mpv 재생(재시도 카운트 리셋) 확인.
4. 파일을 여러 번 빠르게 전환 → 복구 토스트가 **뜨지 않아야** 함(의도적 정지 가드 동작).
5. mpv 재생 중 앱을 X 버튼으로 종료 → 종료가 지연되거나 유령 오디오/창이 남지 않아야 함(`isAppShuttingDown` 가드 동작).

- [ ] **Step 8: 커밋**

```bash
git add renderer/scripts/app.js scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-recovery-source.test.js
git commit -m "feat: mpv 예기치 못한 중단 자동 복구 (1회 재시도 후 FFmpeg 폴백)"
```

### Task 9: 렌더러 크래시/리로드 시 mpv 정리 (main/window.js)

**Files:**

- Modify: `main/window.js` — 상단 require, `render-process-gone`(183~186), `did-navigate` 신설
- Modify: `scripts/tests/mpv-recovery-source.test.js`

- [ ] **Step 1: 구현 전 확인 (필수)** — `main/index.js` 상단(49~51행 부근)에서 mpv 3종 모듈의 require 형태를 확인(`const { mpvManager } = require('./mpv-manager');` 등 — `cleanupMpvPilotBeforeQuit`(index.js:68~86)이 쓰는 정확한 식별자). window.js에도 동일한 형태로 require한다.

**순환 참조 관련 사실**: `mpv-embed-host.js:32`와 `mpv-overlay-host.js:522`는 `require('./window').getMainWindow()`를 **함수 내부 지연(lazy) require**로 호출한다 — grep에 window.js 참조가 잡히더라도 놀라지 말 것. 최상위(모듈 로드 시점) require 사이클은 없으므로 window.js 상단에 mpv 3종을 require해도 초기화 문제가 없다.

- [ ] **Step 2: 실패하는 테스트 추가** (mpv-recovery-source.test.js):

```js
test('renderer crash and reload clean up mpv processes and hosts', () => {
  assert.match(windowSource, /async function cleanupMpvAfterRendererGone\(reason\)/);
  assert.match(
    windowSource,
    /webContents\.on\('render-process-gone'[\s\S]*?cleanupMpvAfterRendererGone/
  );
  assert.match(windowSource, /webContents\.on\('did-navigate'[\s\S]*?cleanupMpvAfterRendererGone/);
  assert.match(windowSource, /rendererCrashRecoveryCount/);
  assert.match(windowSource, /webContents\.reload\(\)/);
});
```

- [ ] **Step 3: 실패 확인** — `npm run test:mpv` → 신규 FAIL.

- [ ] **Step 4: 구현**

(a) window.js 상단(기존 require 아래)에 Step 1에서 확인한 형태로 require 추가.

(b) 파일 스코프(또는 createMainWindow 위)에 정리 함수 신설 — index.js `cleanupMpvPilotBeforeQuit`과 같은 순서:

```js
async function cleanupMpvAfterRendererGone(reason) {
  log.warn('렌더러 이탈로 mpv 재생 엔진 정리', { reason });
  try {
    await mpvManager.stop({ commandTimeoutMs: 500 });
  } catch (error) {
    log.warn('렌더러 이탈 mpv 종료 실패', { error: error.message });
  }
  try {
    mpvOverlayHost.destroy();
  } catch (error) {
    log.debug('렌더러 이탈 mpv 오버레이 정리 실패', { error: error.message });
  }
  try {
    mpvEmbedHost.destroy();
  } catch (error) {
    log.debug('렌더러 이탈 mpv 임베드 정리 실패', { error: error.message });
  }
}
```

(c) `render-process-gone` 핸들러(window.js:183~186)를 교체하고, createMainWindow 스코프에 카운터 추가:

```js
let rendererCrashRecoveryCount = 0;

mainWindow.webContents.on('render-process-gone', (event, details) => {
  debugLog(`렌더러 프로세스 종료: ${JSON.stringify(details)}`);
  log.error('렌더러 프로세스 종료', details);
  void cleanupMpvAfterRendererGone(`render-process-gone:${details?.reason}`);

  const recoverableReasons = ['crashed', 'oom', 'abnormal-exit', 'launch-failed'];
  if (recoverableReasons.includes(details?.reason) && rendererCrashRecoveryCount < 2) {
    rendererCrashRecoveryCount += 1;
    log.warn('렌더러 자동 복구 시도', { attempt: rendererCrashRecoveryCount });
    mainWindow.webContents.reload();
  }
});
```

('clean-exit'/'killed'는 의도적 종료라 reload하지 않는다. 카운터 상한 2로 크래시 루프 방지.)

(d) 같은 위치에 `did-navigate` 핸들러 신설 (Ctrl+R 리로드 커버):

```js
mainWindow.webContents.on('did-navigate', () => {
  // 리로드/내비게이션 시 렌더러 상태가 초기화되므로 mpv도 함께 정리
  // (최초 로드에도 발생하나 mpv 미기동 상태의 stop()은 { stopped: false } no-op)
  void cleanupMpvAfterRendererGone('did-navigate');
});
```

- [ ] **Step 5: 통과 확인** — `npm run test:mpv` PASS.

- [ ] **Step 6: 수동 검증**

1. mpv 재생 중 DevTools에서 `Ctrl+R`(리로드) → mpv 창/소리가 함께 사라지고 앱이 초기 화면으로 복귀하는지 확인 (기존 결함: 유령 mpv 창+오디오 잔존).
2. mpv 재생 중 DevTools 콘솔에서 `process.crash()` 실행 → mpv 정리 + 자동 reload로 앱이 되살아나는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add main/window.js scripts/tests/mpv-recovery-source.test.js
git commit -m "fix: 렌더러 크래시/리로드 시 mpv 프로세스와 호스트 창 정리 및 자동 복구"
```

### Chunk 2 완료 게이트

- [ ] `npm run test:fps && npm run test:mpv && npm run test:video-pan && npm run lint` 전부 PASS
- [ ] Task 8 Step 7, Task 9 Step 6의 수동 검증 5+2건 전부 확인

---

## Chunk 3: 그리기 모드 mpv 정지 프레임

목표: mpv 모드에서 B키 그리기 진입 시 검은 배경 대신 **현재 프레임 스크린샷**이 캔버스 아래에 깔리게 한다(0.6). 부산물인 `mpv:screenshot` IPC는 후속 썸네일 복구 과제의 기반이 된다.

### Task 10: MPVManager.screenshot 메서드

**Files:**

- Modify: `main/mpv-manager.js` — `createMpvLaunchArgs`(69~101), 신규 메서드(`stop()` 405행 앞에 삽입)
- Modify: `scripts/tests/mpv-manager.test.js` (단위 테스트 추가 — 기존 파일이므로 test:mpv 문자열 무변)

- [ ] **Step 1: 실패하는 단위 테스트 추가** (mpv-manager.test.js 말미, 기존 `createManager` 헬퍼 재사용 — 0.7의 DI + monkey-patch 관례):

```js
test('screenshot sends screenshot-to-file and verifies the output file', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const outputPath = path.normalize('C:\\Temp\\draw-freeze.png');
  const sent = [];
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [bundledPath, outputPath]
  });
  manager.process = { killed: false };
  manager.ipcPath = '\\\\.\\pipe\\test';
  manager.sendCommand = async (command) => {
    sent.push(command);
    return { error: 'success' };
  };

  const result = await manager.screenshot(outputPath);

  assert.equal(result.success, true);
  assert.deepEqual(sent[0], ['screenshot-to-file', outputPath, 'video']);
});

test('screenshot rejects when mpv is not running', async () => {
  const manager = createManager({});
  await assert.rejects(() => manager.screenshot('C:\\Temp\\x.png'), /mpv is not running/);
});

test('launch args pin png screenshot format', () => {
  const args = createMpvLaunchArgs({ ipcPath: '\\\\.\\pipe\\x' });
  assert.ok(args.includes('--screenshot-format=png'));
});
```

- [ ] **Step 2: 실패 확인** — `npm run test:mpv` → 신규 3개 FAIL.

- [ ] **Step 3: 구현**

(a) `createMpvLaunchArgs`(69~101)의 args 배열에서 `--hwdec=auto` 다음 줄에 추가:

```js
    '--screenshot-format=png',
    '--screenshot-png-compression=1',
```

(참고: `screenshot-to-file`의 포맷은 출력 경로 확장자(`.png`)로 결정되므로 `--screenshot-format`은 이 경로에서는 보조적이다 — 후속 스크린샷 기능 대비 명시. `--screenshot-png-compression=1`은 실제 적용되며 저압축·고속.)

(b) `stop()`(405행) **바로 앞**에 신규 메서드:

```js
  /**
   * 현재 프레임을 PNG 파일로 캡처한다 ('video' = OSD/자막 제외 원본 프레임).
   * screenshot-to-file은 파일 쓰기 완료 후 응답하므로 응답 수신 = 파일 존재.
   * 방어적으로 파일 존재를 재확인한다.
   */
  async screenshot(outputPath) {
    if (!outputPath || typeof outputPath !== 'string') {
      throw new Error('mpv screenshot requires an output path');
    }
    if (!this.process || this.process.killed) {
      throw new Error('mpv is not running');
    }
    await this.sendCommand(['screenshot-to-file', outputPath, 'video']);
    if (!this._pathExists(outputPath)) {
      throw new Error('mpv screenshot file was not created');
    }
    return { success: true, path: outputPath };
  }
```

- [ ] **Step 4: 통과 확인** — `npm run test:mpv` PASS.

- [ ] **Step 5: 커밋**

```bash
git add main/mpv-manager.js scripts/tests/mpv-manager.test.js
git commit -m "feat: mpv 현재 프레임 PNG 스크린샷 명령 추가"
```

### Task 11: `mpv:screenshot` IPC + preload 노출

**Files:**

- Modify: `main/ipc-handlers.js` — `mpv:get-status` 핸들러(1837~) 부근에 신설
- Modify: `preload/preload.js:126` 부근 — `mpvGetStatus` 다음 줄
- Modify: `scripts/tests/mpv-recovery-source.test.js` (또는 mpv-runtime-source의 채널 목록 — Step 1 확인에 따름)

- [ ] **Step 1: 구현 전 확인 (필수)** — mpv-runtime-source.test.js에 **mpv IPC 채널/preload 노출 목록을 배열로 순회 검증하는 테스트**(54~78행 부근의 forEach + `new RegExp(escaped)` 패턴)가 있는지 확인. 있으면 그 배열에 `mpv:screenshot`/`mpvScreenshot`을 추가해야 하며(누락 시 해당 테스트가 새 채널을 모름 → 통과는 하지만 회귀 방지가 안 됨), 목록이 "정확히 이 목록이어야 함(assert.equal/deepEqual)" 형태면 반드시 갱신.

- [ ] **Step 2: 실패하는 테스트 추가** (mpv-recovery-source.test.js):

```js
const preloadSource = readSource('preload/preload.js');
const ipcSource = readSource('main/ipc-handlers.js');

test('mpv screenshot ipc channel is wired end to end', () => {
  assert.match(ipcSource, /ipcMain\.handle\('mpv:screenshot'/);
  assert.match(ipcSource, /mpv-frames/);
  assert.match(preloadSource, /mpvScreenshot: \(\) => ipcRenderer\.invoke\('mpv:screenshot'\),/);
});
```

(`readSource` 상수 2줄은 파일 상단 기존 상수들 옆에 추가.)

- [ ] **Step 3: 실패 확인** — `npm run test:mpv` → FAIL.

- [ ] **Step 4: 구현**

(a) ipc-handlers.js — `mpv:get-status` 핸들러 바로 아래에 신설 (파일 상단에 `app`/`fs`/`path`가 이미 require돼 있음을 확인 — 썸네일 캐시 코드(1252~1258)가 동일 모듈 사용):

```js
ipcMain.handle('mpv:screenshot', async () => {
  const trace = log.trace('mpv:screenshot');
  try {
    const screenshotDir = path.join(app.getPath('userData'), 'mpv-frames');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const outputPath = path.join(screenshotDir, `frame-${Date.now()}-${process.pid}.png`);
    await mpvManager.screenshot(outputPath);
    const buffer = await fs.promises.readFile(outputPath);
    await fs.promises.unlink(outputPath).catch(() => {});
    trace.end({ success: true });
    return { success: true, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (error) {
    trace.error(error);
    return { success: false, error: error.message };
  }
});
```

(`log.trace` 사용 형태는 인접한 `mpv:load` 핸들러(0.6 인용)와 동일 관례. 파일을 즉시 삭제하고 data URL로 반환 — 렌더러의 `file://` 접근 제약을 우회하고 잔여 파일을 남기지 않는다.)

(b) preload.js — `mpvGetStatus: ...` 줄 다음에:

```js
  mpvScreenshot: () => ipcRenderer.invoke('mpv:screenshot'),
```

- [ ] **Step 5: 통과 확인** — `npm run test:mpv` PASS (Step 1에서 확인한 채널 목록 테스트 포함).

- [ ] **Step 6: 커밋**

```bash
git add main/ipc-handlers.js preload/preload.js scripts/tests/mpv-recovery-source.test.js scripts/tests/mpv-runtime-source.test.js
git commit -m "feat: mpv:screenshot IPC 채널 신설 (dataUrl 반환)"
```

### Task 12: 그리기 모드 진입 시 정지 프레임 표시

**Files:**

- Modify: `renderer/scripts/app.js` — `applyDrawModeState`(7569~7582), `frameUpdate` 핸들러(1127~1134), 신규 함수 3개(`syncCanvasOverlay` 부근에 배치)
- Modify: `renderer/styles/main.css` — `.mpv-draw-freeze-frame` 규칙 신설
- Modify: `scripts/tests/mpv-recovery-source.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
const mainStyles = readSource('renderer/styles/main.css');

test('draw mode shows a frozen mpv frame under the drawing canvases', () => {
  assert.match(appSource, /async function showMpvDrawFreezeFrame\(\)/);
  assert.match(appSource, /function removeMpvDrawFreezeFrame\(\)/);
  assert.match(appSource, /function scheduleMpvDrawFreezeRefresh\(\)/);
  const applyMatch = appSource.match(/function applyDrawModeState\(enabled\) \{([\s\S]*?)\n  \}/);
  assert.ok(applyMatch, 'applyDrawModeState should exist');
  assert.match(applyMatch[1], /videoPlayer\.pause\(\);/);
  assert.match(applyMatch[1], /showMpvDrawFreezeFrame\(\)/);
  assert.match(applyMatch[1], /removeMpvDrawFreezeFrame\(\)/);
  // 그리기 모드 중 프레임 이동 시 정지 프레임 갱신 배선 (시크 완료 대기 스케줄러 경유)
  assert.match(
    appSource,
    /videoPlayer\.addEventListener\('frameUpdate'[\s\S]*?scheduleMpvDrawFreezeRefresh\(\);/
  );
  assert.match(videoPlayerSource, /isSeeking\(\) \{/);
  assert.match(mainStyles, /\.mpv-draw-freeze-frame \{/);
});
```

(`videoPlayerSource` 상수가 이 파일에 없으면 상단 `readSource` 목록에 추가.)

- [ ] **Step 2: 실패 확인** — `npm run test:mpv` → FAIL.

- [ ] **Step 3: 신규 함수 구현** — app.js의 `syncCanvasOverlay`(5193) 함수 정의 **위쪽**에 추가:

```js
// ====== 그리기 모드 mpv 정지 프레임 ======
// mpv 임베드 창은 그리기 모드에서 숨겨지므로(MPV_BLOCKING_OVERLAY_SELECTOR의
// .drawing-tools.visible), 현재 프레임 스크린샷을 캔버스 아래에 깔아 준다.
let mpvDrawFreezeElement = null;
let mpvDrawFreezeToken = 0;

function isMpvPilotPlaybackActive() {
  return videoPlayer.engine !== 'html5' && document.body.classList.contains('mpv-pilot-mode');
}

function removeMpvDrawFreezeFrame() {
  mpvDrawFreezeToken += 1;
  if (mpvDrawFreezeElement) {
    mpvDrawFreezeElement.remove();
    mpvDrawFreezeElement = null;
  }
}

let mpvDrawFreezeRefreshTimer = null;

/**
 * 정지 프레임 갱신 스케줄러.
 * seekToFrame은 currentFrame을 옵티미스틱하게 즉시 갱신하므로 frameUpdate가
 * mpv의 실제 시크 완료 전에 발생할 수 있다. 시크가 끝날 때까지(videoPlayer.isSeeking())
 * 재스케줄해 stale 프레임 캡처를 막고, 연타 시 마지막 요청만 캡처한다.
 */
function scheduleMpvDrawFreezeRefresh() {
  if (mpvDrawFreezeRefreshTimer) clearTimeout(mpvDrawFreezeRefreshTimer);
  mpvDrawFreezeRefreshTimer = setTimeout(() => {
    mpvDrawFreezeRefreshTimer = null;
    if (!state.isDrawMode || !isMpvPilotPlaybackActive()) return;
    if (videoPlayer.isSeeking()) {
      scheduleMpvDrawFreezeRefresh();
      return;
    }
    void showMpvDrawFreezeFrame();
  }, 160);
}

async function showMpvDrawFreezeFrame() {
  if (!isMpvPilotPlaybackActive() || !window.electronAPI?.mpvScreenshot) return;
  const token = ++mpvDrawFreezeToken;
  try {
    const result = await window.electronAPI.mpvScreenshot();
    if (token !== mpvDrawFreezeToken || !state.isDrawMode) return;
    if (!result?.success || !result.dataUrl) {
      log.warn('mpv 정지 프레임 캡처 실패', { error: result?.error });
      return;
    }
    if (!mpvDrawFreezeElement) {
      mpvDrawFreezeElement = document.createElement('img');
      mpvDrawFreezeElement.className = 'mpv-draw-freeze-frame';
      mpvDrawFreezeElement.alt = '';
      // 드로잉 캔버스들(onionSkinCanvas 포함)보다 DOM 앞 = 아래 레이어
      const anchor = elements.onionSkinCanvas;
      if (anchor && anchor.parentElement === elements.videoWrapper) {
        elements.videoWrapper.insertBefore(mpvDrawFreezeElement, anchor);
      } else if (elements.videoWrapper) {
        elements.videoWrapper.insertBefore(mpvDrawFreezeElement, elements.videoWrapper.firstChild);
      }
    }
    const renderArea = getVideoRenderArea();
    if (renderArea) {
      mpvDrawFreezeElement.style.left = `${renderArea.left}px`;
      mpvDrawFreezeElement.style.top = `${renderArea.top}px`;
      mpvDrawFreezeElement.style.width = `${renderArea.width}px`;
      mpvDrawFreezeElement.style.height = `${renderArea.height}px`;
    }
    mpvDrawFreezeElement.src = result.dataUrl;
    // 줌/팬 상태에서 드로잉 캔버스와 동일 변환을 받도록 동기화 (Step 5-b)
    syncCanvasZoom();
  } catch (error) {
    log.warn('mpv 정지 프레임 캡처 예외', { error: error.message });
  }
}
```

확인: `elements.onionSkinCanvas`가 elements 맵에 등록돼 있는지(`onionSkinCanvas`로 app.js 검색 — app.js:123 부근 등록 확인됨). 없으면 `document.getElementById('onionSkinCanvas')`로 대체.

추가로 video-player.js에 **공개 접근자**를 신설한다 (`setFps` 근처에 삽입 — 소스 테스트 앵커와 무관한 위치):

```js
  /**
   * 수동 시크 진행 여부 (외부에서 시크 완료를 기다릴 때 사용)
   */
  isSeeking() {
    return this._isSeeking === true;
  }
```

- [ ] **Step 4: `applyDrawModeState` 배선** — 기존 함수(7569~7582)를 다음으로 교체:

```js
function applyDrawModeState(enabled) {
  state.isDrawMode = enabled;
  elements.btnDrawMode?.classList.toggle('active', enabled);
  elements.drawingTools?.classList.toggle('visible', enabled);
  elements.drawingCanvas?.classList.toggle('active', enabled);
  elements.videoWrapper?.classList.toggle('drawing-mode', enabled);
  setCommentOverlaysDrawingPassthrough(enabled);
  if (enabled && isMpvPilotPlaybackActive()) {
    // mpv 영상 창이 숨겨지기 전에 일시정지 + 현재 프레임 확보
    videoPlayer.pause();
    void showMpvDrawFreezeFrame();
  }
  if (!enabled) {
    removeMpvDrawFreezeFrame();
    drawingManager.commitActiveSelection();
    state.isSpaceHeld = false;
    state.spacePanUsed = false;
    elements.videoWrapper?.classList.remove('space-pan');
  }
}
```

- [ ] **Step 5: 프레임 이동/줌 변화 시 갱신**

(a) `frameUpdate` 핸들러(app.js:1127~1134)의 `syncPlaybackPositionUI(...)` 호출 다음에 추가:

```js
if (state.isDrawMode && isMpvPilotPlaybackActive()) {
  scheduleMpvDrawFreezeRefresh();
}
```

주의: `seekToFrame`(video-player.js:578)은 `currentFrame`을 옵티미스틱하게 즉시 갱신하므로 `frameUpdate`가 실제 mpv 시크 완료 **전에** 발생할 수 있다. 그래서 직접 캡처하지 않고 `scheduleMpvDrawFreezeRefresh()`(160ms 디바운스 + `videoPlayer.isSeeking()` 동안 재스케줄)를 경유한다.

(b) **줌/팬 정렬**: mpv 모드에서 드로잉 캔버스들은 `syncCanvasZoom()`(app.js:4925~4957)이 CSS `transform: scale()+translate()`를 적용한다. 정지 프레임도 같은 변환을 받아야 스트로크와 어긋나지 않는다. `syncCanvasZoom()` 내부에서 `videoTransitionFreezeCanvas`에 transform을 적용하는 선례(app.js:4952~4955 부근)를 찾아, **같은 방식으로 `mpvDrawFreezeElement`(null 가드 포함)에도 동일 transform을 적용**하는 분기를 추가한다. (`showMpvDrawFreezeFrame` 말미의 `syncCanvasZoom()` 호출이 이 분기를 트리거한다.)

- [ ] **Step 6: CSS 추가** — main.css의 `.drawing-overlay` 규칙(1097~1111) 근처에:

```css
/* 그리기 모드에서 mpv 영상 대신 표시하는 정지 프레임 (드로잉 캔버스 아래 레이어) */
.mpv-draw-freeze-frame {
  position: absolute;
  pointer-events: none;
  object-fit: fill;
  background: #000;
}
```

(z-index 미지정(auto) + DOM 순서 앞 배치로 드로잉 캔버스 아래에 깔린다 — `#compositionLayerOverlay`(z-index:2)보다도 아래. 0.6의 레이어 구조 참조.)

- [ ] **Step 7: 통과 확인** — `npm run test:mpv && npm run test:drawing` PASS. (test:drawing의 drawing-runtime-source가 applyDrawModeState를 고정하고 있으면 갱신 — `applyDrawModeState`로 해당 테스트 파일 검색해 확인.)

- [ ] **Step 8: 수동 검증**

1. mpv 모드 재생 중 B키 → 재생이 멈추고 현재 프레임이 보이는 상태로 그리기 시작 확인 (기존: 검은 배경).
2. 그리기 모드에서 Shift+A/D로 프레임 이동 → 배경 프레임이 따라 갱신되는지 확인. **빠르게 연타 후 멈췄을 때 최종 프레임이 플레이헤드와 일치**하는지 확인(시크 완료 대기 동작).
3. B키로 종료 → 정지 프레임이 사라지고 mpv 창이 재표시되며, 방금 그린 스트로크가 mpv 위 미러에 보이는지 확인.
4. HTML5 모드(파일럿 끔)에서 B키 → 기존과 동일 동작(회귀 없음).
5. 창 리사이즈 후 그리기 재진입 → 정지 프레임 위치/크기가 렌더 영역과 일치.
6. **영상 줌/팬 상태에서 B키 진입** → 정지 프레임과 브러시 스트로크 위치가 일치(줌 100% 아닐 때 어긋나면 Step 5-(b) 미적용). 그리기 모드 중 Space 팬 이동 후에도 일치 확인.

- [ ] **Step 9: 커밋**

```bash
git add renderer/scripts/app.js renderer/styles/main.css scripts/tests/mpv-recovery-source.test.js
git commit -m "feat: mpv 그리기 모드에 스크린샷 기반 정지 프레임 표시"
```

### Chunk 3 완료 게이트

- [ ] `npm run test:fps && npm run test:mpv && npm run test:video-pan && npm run test:drawing && npm run lint` 전부 PASS
- [ ] Task 12 Step 8 수동 검증 6건 전부 확인

---

## Chunk 4: mpv 기본값 승격 + 최종 검증

목표: 신규·기존 설치 모두에서 mpv 직접 재생이 기본이 되게 하고(옵트아웃 가능), FFmpeg 폴백이 온전히 동작함을 증명한 뒤 배포 검증까지 마친다.

### Task 13: 설정 키 교체 — `mpvPilotEnabled` → `mpvPlaybackEnabled` (기본 true)

**Files:**

- Modify: `renderer/scripts/modules/user-settings.js` — defaults(198행 부근), getter/setter(733~), 마이그레이션 신설
- Modify: `scripts/tests/mpv-recovery-source.test.js`

**왜 키 교체인가 (0.4)**: 기존 설치 PC의 localStorage와 `user-settings.json`에는 `mpvPilotEnabled: false`가 **명시 저장**돼 있다. defaults만 true로 바꾸면 저장값이 이겨서 기존 사용자는 계속 FFmpeg 경로를 쓴다. 새 키 + 구 키 삭제로 전원 기본 on을 보장한다(설계 결정 5).

- [ ] **Step 1: 구현 전 확인 (필수)** — user-settings.js에서 `_loadFromStorage()`(294 부근)와 `_loadFromFile()`(323~336 부근)의 병합 방식을 확인한다(저장값이 defaults를 덮어쓰는 지점). 마이그레이션은 **두 로드 경로 모두의 병합 직후**에 실행돼야 한다 — `_loadFromFile`은 비동기이므로 storage 로드 후 한 번, file 로드 병합 후 한 번, 총 2회 호출된다.

- [ ] **Step 2: 실패하는 테스트 추가** (mpv-recovery-source.test.js):

```js
const userSettingsSource = readSource('renderer/scripts/modules/user-settings.js');

test('mpv playback is enabled by default with legacy pilot key migration', () => {
  assert.match(userSettingsSource, /mpvPlaybackEnabled: true,/);
  assert.doesNotMatch(userSettingsSource, /mpvPilotEnabled: false,/);
  assert.match(
    userSettingsSource,
    /getMpvPlaybackEnabled\(\) \{[\s\S]+?return this\.settings\.mpvPlaybackEnabled !== false;/
  );
  assert.match(
    userSettingsSource,
    /setMpvPlaybackEnabled\(enabled\) \{[\s\S]+?this\.settings\.mpvPlaybackEnabled = enabled === true;[\s\S]+?this\._save\(\);/
  );
  const migrateMatch = userSettingsSource.match(/_migrateLegacySettings\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(migrateMatch, 'legacy settings migration should exist');
  assert.match(migrateMatch[1], /delete this\.settings\.mpvPilotEnabled;/);

  // 마이그레이션이 두 로드 경로(동기 storage, 비동기 file)의 "병합 직후"에 배선됐는지 고정.
  // 파일 병합이 나중에 실행되며 구 키(false)를 되살리는 회귀를 막는 핵심 단언이다.
  const loadFromStorageMatch = userSettingsSource.match(/_loadFromStorage\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadFromStorageMatch, '_loadFromStorage should exist');
  assert.match(loadFromStorageMatch[1], /this\._migrateLegacySettings\(\);/);
  const loadFromFileMatch = userSettingsSource.match(/_loadFromFile\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(loadFromFileMatch, '_loadFromFile should exist');
  assert.match(loadFromFileMatch[1], /this\._migrateLegacySettings\(\);/);
});
```

주의: `_loadFromStorage`/`_loadFromFile`의 실제 시그니처(async 여부 등)를 확인해 블록 추출 정규식을 실제 코드에 맞출 것.

- [ ] **Step 3: 실패 확인** — `npm run test:mpv` → FAIL.

- [ ] **Step 4: 구현**

(a) defaults(user-settings.js:195~198 부근)의

```js
      // mpv 직접 재생 파일럿 (이 PC에서만 켜는 개인 로컬 설정)
      mpvPilotEnabled: false,
```

를 다음으로 교체:

```js
      // mpv 직접 재생 — 기본 재생 엔진. 끄면 기존 변환(FFmpeg) 방식으로 재생 (개인 로컬 설정)
      mpvPlaybackEnabled: true,
```

(b) 마이그레이션 메서드 신설 (constructor의 로드 호출부 근처):

```js
  /**
   * 구버전 설정 키 정리.
   * mpvPilotEnabled(파일럿 옵트인)는 mpv 기본 엔진 승격으로 폐기 —
   * 과거 저장값(false 포함)을 무효화하고 전원 기본 on으로 전환한다(옵트아웃은 새 키).
   */
  _migrateLegacySettings() {
    if ('mpvPilotEnabled' in this.settings) {
      delete this.settings.mpvPilotEnabled;
    }
    if (typeof this.settings.mpvPlaybackEnabled !== 'boolean') {
      this.settings.mpvPlaybackEnabled = true;
    }
  }
```

호출 배선: Step 1에서 확인한 두 지점 — `_loadFromStorage()`의 병합 직후와 `_loadFromFile()`의 병합 직후 — 에 `this._migrateLegacySettings();` 추가.

(c) getter/setter(733~) 교체 — `getMpvPilotEnabled`/`setMpvPilotEnabled`를 **삭제**하고:

```js
  getMpvPlaybackEnabled() {
    return this.settings.mpvPlaybackEnabled !== false;
  }

  setMpvPlaybackEnabled(enabled) {
    this.settings.mpvPlaybackEnabled = enabled === true;
    this._save();
    this._emit('mpvPlaybackEnabledChanged', { enabled: this.settings.mpvPlaybackEnabled });
    log.info('mpv 직접 재생 설정 변경됨', { enabled: this.settings.mpvPlaybackEnabled });
  }
```

**Task 13↔14 진행 순서(중요)**: 이 시점에 app.js가 아직 구 getter(`getMpvPilotEnabled`)를 호출하므로 앱은 일시적으로 깨진 상태다. 다음 순서를 따른다:

1. Task 13 구현 (user-settings.js + 테스트) — 커밋하지 않음
2. Task 14 구현 (app.js/index.html/mpv-manager.js + 테스트 갱신)
3. 통합 확인: `npm run test:mpv && npm run test:fps && npm run lint` 전부 PASS
4. Task 13 범위 파일을 먼저 커밋(아래 Step 5) → 이어서 Task 14 커밋(Task 14 Step 6)

- [ ] **Step 5: 커밋** (위 순서 3까지 끝난 뒤):

```bash
git add renderer/scripts/modules/user-settings.js scripts/tests/mpv-recovery-source.test.js
git commit -m "feat: mpv 직접 재생을 기본 설정으로 승격 (mpvPlaybackEnabled, 구 파일럿 키 마이그레이션)"
```

### Task 14: 소비처/설정 UI/env 옵트아웃 갱신

**Files:**

- Modify: `renderer/scripts/app.js` — `shouldUseMpvPilot`(6587~6607), 설정 모달 초기값(11549~11552), change 핸들러(11823~), `updateMpvPilotSettingsStatus`(11492~)
- Modify: `renderer/index.html:1567~` — 문구
- Modify: `main/mpv-manager.js` — env 옵트아웃 함수 신설, `isAvailable()`(136~138)
- Modify: `scripts/tests/mpv-runtime-source.test.js:159-187` (설정 3종 세트 단언 전면 갱신), `scripts/tests/mpv-manager.test.js`, `scripts/tests/mpv-recovery-source.test.js`

- [ ] **Step 1: 잔여 참조 전수 조사 (필수)**

**설정 키 사용처**만 조사한다 (UI id `appSettingsMpvPilotEnabled`와 그 DOM 변수명 `mpvPilotEnabled`는 설계 결정 4에 따라 유지 대상이므로 제외):

```bash
grep -rn "getMpvPilotEnabled\|setMpvPilotEnabled\|settings\.mpvPilotEnabled\|mpvPilotEnabled:" renderer/ scripts/tests/ --include="*.js" --include="*.html"
```

이 결과 목록 전체가 이번 Task의 수정 대상이다(아래에 명시된 곳 + 누락분). 참고 — 현재 예상 히트: user-settings.js(defaults 198, getter/setter 733~741), app.js(6592, 11496, 11550~11551, 11823~11824), mpv-runtime-source.test.js(설정 3종 단언).

- [ ] **Step 2: 실패하는 테스트 추가/갱신**

(a) mpv-recovery-source.test.js:

```js
test('mpv can be disabled per machine via env for troubleshooting', () => {
  const mpvManagerSource = readSource('main/mpv-manager.js');
  assert.match(mpvManagerSource, /function isMpvPlaybackDisabledByEnv\(env = process\.env\)/);
  assert.match(mpvManagerSource, /BAEFRAME_DISABLE_MPV/);
  const availableMatch = mpvManagerSource.match(/isAvailable\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(availableMatch, 'isAvailable should exist');
  assert.match(availableMatch[1], /isMpvPlaybackDisabledByEnv\(this\.env\)/);
});
```

(b) mpv-manager.test.js에 단위 테스트 2개 (동시 설정 시 **DISABLE이 항상 우선** — `isAvailable()`이 최종 게이트이므로):

```js
test('BAEFRAME_DISABLE_MPV forces availability off even when the binary exists', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const manager = createManager({
    env: { BAEFRAME_DISABLE_MPV: '1' },
    existing: [bundledPath]
  });
  await manager.initialize();
  assert.equal(manager.isAvailable(), false);
});

test('BAEFRAME_DISABLE_MPV wins over BAEFRAME_MPV_PILOT when both are set', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1', BAEFRAME_DISABLE_MPV: '1' },
    existing: [bundledPath]
  });
  await manager.initialize();
  assert.equal(manager.isAvailable(), false);
});
```

(c) mpv-runtime-source.test.js:159~187의 `'mpv pilot can be enabled from app playback settings without an env var'` 테스트를 새 이름/내용으로 교체:

```js
test('mpv direct playback defaults on and can be opted out from app settings', () => {
  assert.match(userSettingsSource, /mpvPlaybackEnabled:\s*true/);
  assert.match(
    userSettingsSource,
    /getMpvPlaybackEnabled\(\) \{[\s\S]+return this\.settings\.mpvPlaybackEnabled !== false;/
  );
  assert.match(
    userSettingsSource,
    /setMpvPlaybackEnabled\(enabled\) \{[\s\S]+this\.settings\.mpvPlaybackEnabled = enabled === true;[\s\S]+this\._save\(\);[\s\S]+this\._emit\('mpvPlaybackEnabledChanged'/
  );

  assert.match(indexSource, /data-tab="playback">재생<\/button>/);
  assert.match(
    indexSource,
    /id="appSettingsMpvPilotEnabled"[\s\S]*?<span class="toggle-slider"><\/span>/
  );
  assert.match(indexSource, /mpv 직접 재생/);

  assert.match(
    appSource,
    /const mpvPilotEnabled = document\.getElementById\('appSettingsMpvPilotEnabled'\);/
  );
  assert.match(appSource, /mpvPilotEnabled\.checked = userSettings\.getMpvPlaybackEnabled\(\);/);
  assert.match(appSource, /userSettings\.setMpvPlaybackEnabled\(e\.target\.checked\);/);
  assert.match(appSource, /const locallyEnabled = userSettings\.getMpvPlaybackEnabled\(\);/);
  assert.match(appSource, /if \(!locallyEnabled && !envEnabled\) return false;/);
});
```

- [ ] **Step 3: 실패 확인** — `npm run test:mpv` → 신규/갱신 단언 FAIL.

- [ ] **Step 4: 구현**

(a) app.js `shouldUseMpvPilot`(6587~6607): `const locallyEnabled = userSettings.getMpvPilotEnabled();` → `const locallyEnabled = userSettings.getMpvPlaybackEnabled();` (그 외 로직 무변 — `envEnabled`(BAEFRAME_MPV_PILOT)는 "설정과 무관한 강제 켬" 디버그 용도로 유지).

(b) app.js 설정 모달 초기값(11549~11552): `userSettings.getMpvPilotEnabled()` → `userSettings.getMpvPlaybackEnabled()`.

(c) app.js change 핸들러(11823~): setter 교체 + 토스트 문구 갱신:

```js
document.getElementById('appSettingsMpvPilotEnabled')?.addEventListener('change', (e) => {
  userSettings.setMpvPlaybackEnabled(e.target.checked);
  updateMpvPilotSettingsStatus();
  showToast(
    e.target.checked
      ? 'mpv 직접 재생을 켰습니다. 다음 영상부터 원본을 바로 재생합니다.'
      : 'mpv 직접 재생을 껐습니다. 다음 영상부터 기존 변환 방식으로 재생합니다.',
    'info'
  );
});
```

(d) app.js `updateMpvPilotSettingsStatus`(11492~): `if (!userSettings.getMpvPilotEnabled())` → `if (!userSettings.getMpvPlaybackEnabled())`, off 상태 문구를 `'꺼져 있습니다. 영상은 기존 변환(FFmpeg) 방식으로 재생됩니다.'`로 교체.

(e) index.html(1567~) 문구 갱신 (id는 유지 — 설계 결정 4). 토글 래퍼의 `title="mpv 직접 재생 파일럿"` 속성도 `title="mpv 직접 재생"`으로 함께 갱신:

```html
<label for="appSettingsMpvPilotEnabled">mpv 직접 재생 (기본)</label>
<p class="app-settings-hint">
  원본 영상을 변환 없이 바로 재생합니다. 끄면 기존 변환(FFmpeg) 방식으로 재생합니다.
</p>
```

상태 문구 기본값도 갱신:

```html
<p class="app-settings-hint" id="appSettingsMpvPilotStatus">
  mpv.exe가 없거나 재생에 실패하면 자동으로 기존 변환 방식을 사용합니다.
</p>
```

(f) main/mpv-manager.js — `isMpvPilotEnabled` 함수(20~23) 아래에 신설 + export 목록(610~617)에 추가:

```js
function isMpvPlaybackDisabledByEnv(env = process.env) {
  const value = String(env.BAEFRAME_DISABLE_MPV || '')
    .trim()
    .toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}
```

`isAvailable()`(136~138) 교체:

```js
  isAvailable() {
    if (isMpvPlaybackDisabledByEnv(this.env)) return false;
    return Boolean(this.mpvPath);
  }
```

(효과: 문제가 있는 PC에서 `BAEFRAME_DISABLE_MPV=1` 하나로 mpv 경로 전체가 꺼지고 — shouldUseMpvPilot의 `mpvIsAvailable()` false — 설정 UI 상태 문구도 자동으로 "찾지 못함" 계열로 표시된다.)

- [ ] **Step 5: 잔여 참조 재확인** — Step 1의 grep 재실행 → 남은 히트가 다음 **의도된 잔존**뿐인지 확인: user-settings.js의 `_migrateLegacySettings` 내부(`delete this.settings.mpvPilotEnabled;` 및 `'mpvPilotEnabled' in` 검사), 테스트 파일의 부정 단언(`doesNotMatch`). 그 외 프로덕션 코드 히트는 0건이어야 한다.

- [ ] **Step 6: Task 13+14 통합 확인** — `npm run test:mpv && npm run test:fps && npm run lint` 전부 PASS. 이후 Task 13 커밋 → 이어서:

```bash
git add renderer/scripts/app.js renderer/index.html main/mpv-manager.js scripts/tests/mpv-runtime-source.test.js scripts/tests/mpv-manager.test.js scripts/tests/mpv-recovery-source.test.js
git commit -m "feat: mpv 기본 재생 소비처/설정 UI 전환 및 BAEFRAME_DISABLE_MPV 옵트아웃 추가"
```

- [ ] **Step 7: 수동 검증 (기본값 동작)**

1. `%APPDATA%\baeframe\settings\user-settings.json`을 백업 후 열어 `mpvPilotEnabled: false`가 있는 상태(구버전 사용자 시뮬레이션)로 앱 실행 → 영상 열기 → **mpv로 재생**되는지(메모리 마이그레이션 동작) 확인. 주의: `_migrateLegacySettings()`는 메모리만 정리하고 즉시 저장하지 않으므로, 파일에서 구 키가 사라지는 것은 **다음 `_save()` 시점**이다 — 아무 설정이나 하나 토글해 저장을 트리거한 뒤 파일을 다시 열어 구 키 제거 + `mpvPlaybackEnabled` 존재를 확인할 것.
2. 설정에서 토글 off → 영상 재로드 → FFmpeg/HTML5 경로로 재생 확인(트랜스코드 오버레이 또는 `<video>` 표시). 다시 on → mpv 재생.
3. PowerShell에서 `$env:BAEFRAME_DISABLE_MPV = '1'; npm run dev` → mpv 설정이 켜져 있어도 FFmpeg 경로로 재생 + 설정 화면에 "mpv.exe를 찾지 못했습니다" 계열 문구 확인.

### Task 15: FFmpeg 폴백 경로 보존 증명

**Files:** 수정 없음 (검증 전용)

mpv가 기본이 된 뒤에도 다음 폴백이 살아 있음을 증명한다. 하나라도 실패하면 **기본값 승격 커밋을 되돌리고 원인을 보고**할 것.

- [ ] **Step 1: mpv 바이너리 부재 폴백** — `mpv/win32/mpv.exe`를 임시로 다른 이름으로 변경 후 `npm run dev` → 영상 열기 → 토스트/오버레이와 함께 기존 변환 방식으로 재생되는지 확인(`shouldUseMpvPilot`의 `mpvIsAvailable()` false 경로). 확인 후 원복.
- [ ] **Step 2: mpv 로드 실패 폴백** — 정상 상태에서 mpv가 열 수 없는 손상 파일(0바이트 .mp4 등)을 열어 `allowMpvPilot:false` 재귀 폴백(app.js:7044~7063)이 동작하고 코덱 에러 UI가 뜨는지 확인.
- [ ] **Step 3: 오디오 모드** — 오디오 파일(.wav/.mp3)을 열어 기존 파형 UI로 재생되는지 확인(`fileIsAudio`는 mpv 게이트에서 원천 제외).
- [ ] **Step 4: 스플릿 뷰** — 버전 비교(스플릿 뷰)를 열어 기존처럼 동작하는지 확인(스플릿 뷰는 HTML5×2 + FFmpeg 경로 유지, mpv 호스트는 `.split-view-overlay.open` 셀렉터로 숨김).
- [ ] **Step 5: 재생목록 연속재생** — mpv on 상태로 재생목록 연속 재생이 동작하는지(mpv 항목은 사전변환 스킵 — app.js:14434/15209 경로), off 상태에서 사전변환 경로가 동작하는지 확인.

### Task 16: 최종 통합 검증 + 빌드 + 문서화

- [ ] **Step 1: 전체 테스트**

```bash
npm run test:mpv && npm run test:fps && npm run test:video-pan && npm run test:frame-grid && npm run test:cluster && npm run test:drawing && npm run test:playlist && npm run test:cutlist && npm run lint
```

기대: 전부 PASS.

- [ ] **Step 2: fps 정확성 수동 매트릭스** — 다음 3종 샘플로 각각 확인 (mpv 기본 on):

| 샘플                 | 확인 항목                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 24fps 영상           | 프레임 카운터 `24fps · Frame N / total`, ←/→ 1프레임 이동이 정확히 1프레임씩(프레임 번호 연속 증가), 타임코드 초당 24프레임 롤오버 |
| 30fps 영상           | 카운터 `30fps`, 총 프레임 수 = duration×30, 타임라인 마커·격자 정렬                                                                |
| 23.976fps(NTSC) 영상 | 카운터 `23.976fps`, 타임코드 프레임 자리가 0~23 범위(정수 반올림 동작), 스테핑 정상                                                |

각 샘플에서: 댓글 작성 → 저장 → 재로드 → 같은 프레임에 표시. 24fps 샘플은 **이 작업 이전에 만든 기존 .bframe**으로도 마커 위치 불변 확인(재매핑 no-op 증명).

- [ ] **Step 3: 빌드 검증**

```bash
npm run build
```

→ `dist\win-unpacked\BFRAME_alpha_v2.exe` 실행 → mpv 기본 재생·그리기·크래시 복구(작업 관리자 mpv 강제 종료) 3종 스모크. (빌드 exe는 `process.resourcesPath/mpv/win32`에서 mpv를 탐지 — electron-builder.yml extraResources로 포함됨.)

- [ ] **Step 4: DEVLOG 기록** — `DEVLOG/2026-07-09-mpv-기본엔진-fps정합-구현.md` 작성 (CLAUDE.md의 DEVLOG 구조: 요약 테이블에 Chunk 1~4를 Phase로 기재, 상태 ✅, 리스크/테스트 방법 포함). 이 계획 문서와 검수 보고서(`DEVLOG/2026-07-09-mpv-통합-심층검수-보고서.md`)를 링크.

- [ ] **Step 5: PR 생성** — 제목/본문 한글(CLAUDE.md 컨벤션). 본문에 반드시 포함: (1) 기본값 반전으로 팀원 전원에게 즉시 영향, (2) 옵트아웃 방법 2가지(설정 토글, `BAEFRAME_DISABLE_MPV=1`), (3) web-viewer 변경으로 Vercel 재배포 필요, (4) 테스트 가이드(위 수동 매트릭스 요약).

---

## 알려진 한계와 후속 과제 (이 계획의 스코프 밖 — PR/DEVLOG에 명시)

1. **mpv 모드 썸네일 파이프라인(타임라인 필름스트립·스크럽 프리뷰·댓글 썸네일)은 여전히 비활성** — Task 11의 `mpv:screenshot` IPC가 기반이 되므로 후속 과제로 자연 연결된다.
2. **120ms 폴링 기반 동기화의 프레임 건너뜀** — 재생 중 프레임별 드로잉 표시가 mpv 모드에서 2~3프레임 단위로 갱신된다. 근본 해결은 IPC 지속 연결 + `observe_property` 구조 개편(별도 계획 필요).
3. **스플릿 뷰의 자체 `_fps=24` 고정**(split-view-manager.js:34) — 버전 비교 화면의 프레임 표기는 이번 정합 범위 밖.
4. **번들 mpv가 버전 고정 없는 git master 개발 빌드** — 안정 릴리스로 교체·고정 권장(검수 보고서 P3).
5. **화면 공유/창 단위 캡처에서 mpv 영역이 비어 보임** — 네이티브 자식 창 구조의 한계. 팀 공지 필요.
6. **협업 세션에서 참가자 간 fps 해석 차이** — 전원이 이 버전으로 업데이트하기 전까지, 구버전(24 고정)과 신버전이 같은 방에 있으면 원격 재생헤드/댓글 위치가 어긋날 수 있다. **팀 전원 동시 업데이트를 권장**(PR에 명시).
7. **`BAEFRAME_DISABLE_MPV=1` 상태의 설정 UI 문구** — 바이너리가 존재해도 "mpv.exe를 찾지 못했습니다" 계열로 표시된다(isAvailable() 경유의 의도된 부작용). 트러블슈팅 혼동 여지가 있어 전용 문구 분기는 후속 개선 후보.

## 구현자를 위한 최종 점검 질문

- [ ] FFmpeg 관련 코드를 삭제하지 않았는가? (설계 결정 1 — 이 계획에 FFmpeg 코드 삭제 태스크는 없다)
- [ ] `docs/superpowers/specs/2026-06-21-mpv-pilot-design.md`의 "reversible" 원칙이 유지되는가? (설정 토글 + env로 즉시 원복 가능)
- [ ] 소스 정규식 테스트를 갱신할 때 "구현에 맞춰 테스트를 약화"하지 않았는가? (단언은 항상 의도된 동작을 고정해야 한다)
- [ ] 각 Chunk 완료 게이트를 건너뛰지 않았는가?
