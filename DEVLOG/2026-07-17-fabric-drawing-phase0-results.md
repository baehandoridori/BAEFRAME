# Fabric Drawing Surface v3 Phase 0 시험 결과

> 기록 시각: 2026-07-17 12:36:05 KST (2026-07-17T03:36:05.138Z)
>
> 현재 범위: Task 5 자동 통합 시험과 합성 benchmark. 실제 앱 시험은 아직 수행하지 않았다.

## 현재 판정

**Go/No-Go 판정 보류.** 자동 시험은 통과했지만, 실제 mpv 영상·재생 조작·플레이리스트 전환·펜 입력·화면 녹화·kill switch 시험이 남아 있다. 자동 시험 통과만으로 Phase 0 Go를 선언하지 않는다.

> 자동 시험의 no-save/playback/timeline 값은 controller와 overlay runtime의 **합성 경계 canary**다. 임시 `.bframe`이나 장부 객체가 `app.js`에 연결된 실제 앱 계측값은 아니므로, 앱 수준 불변식을 증명한다고 해석하지 않는다. 실제 앱의 파일 hash와 재생 UX는 아래 Task 6에서 별도로 판정한다.

## 자동 시험 환경

| 항목                      | 측정값                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 자동 시험 시점의 Git HEAD | `b4436ce1fc52916652b3d8b240ece2b7dad0a737`                                                                                                                             |
| 운영체제                  | Windows `10.0.26200`, `win32 x64`                                                                                                                                      |
| CPU                       | AMD Ryzen 9 7950X 16-Core Processor, 논리 CPU 32개                                                                                                                     |
| 메모리                    | 127.09 GiB                                                                                                                                                             |
| Node.js                   | `v22.18.0`                                                                                                                                                             |
| npm                       | `10.9.3`                                                                                                                                                               |
| Electron                  | 설치본 `28.3.3` (`package.json`: `^28.0.0`)                                                                                                                            |
| Fabric.js                 | `7.4.0`                                                                                                                                                                |
| 시험 도구                 | Node.js built-in test runner, 실제 `MPVOverlayHost` + fake `BrowserWindow`, 실제 Fabric pilot controller/runtime 모듈 + fake Fabric Canvas/Path/DOM 방식                         |

## Task 5 합성 경계·수명 자동 시험

명령: `node --test scripts/tests/fabric-drawing-pilot-integration.test.js`

결과: **PASS — 6/6, 실패 0**

| 자동 검증 항목           | 결과 | 증거 범위                                                                                                                                                                                     |
| ------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 임시 `.bframe` canary    | PASS | 합성 harness가 조작 전후 SHA-256·파일 크기·mtime를 바꾸지 않음. 실제 앱 저장 경로 증거는 아님                                                                                                |
| controller 저장 경계     | PASS | controller가 주입된 `saveReview`/`ReviewDataManager.save` 상당 금지 함수를 호출하지 않음. `app.js` 간접 호출 증거는 아님                                                                      |
| controller 재생 경계     | PASS | controller가 주입된 `mpvLoad`, `mpvPlay`, `mpvPause`, `mpvDestroyEmbed`, `mpvDestroyOverlay` 금지 함수를 호출하지 않음. 실제 앱 장부는 아님                                                  |
| controller 입력          | PASS | passive 준비 뒤 순차 B toggle 100회, input revision 100 증가, 종료 session `null`                                                                                                             |
| runtime 조작             | PASS | 실제 runtime에서 pen stroke, V 선택, 이동, controller Delete, local Clear 실행                                                                                                                |
| playback/timeline canary | PASS | 합성 harness의 owner, media instance, duration, current frame, playlist continuous offset 동일. 실제 앱 경로는 Task 6에서 확인                                                               |
| overlay host 수명        | PASS | 실제 `MPVOverlayHost`에 fake `BrowserWindow`를 주입. baseline 뒤 input off/on 100회 동안 construct/loadURL/setBounds/show/hide/moveTop/destroy 증가 0, host generation과 window identity 동일 |
| stale generation 순서    | PASS | generation N의 disable 응답을 실제 Promise로 지연한 뒤 N+1 ready/active 완료. 늦은 N 응답은 N+1 session을 재활성화하거나 교체하지 못함                                                        |
| 진단 validator           | PASS | 필드 변조뿐 아니라 host 수명 불일치, video generation 0, 음수 timeline, N→N+1이 아닌 stale jump도 위반으로 거부                                                                               |
| 진단 CLI                 | PASS | raw `{before,after,staleProbe}` JSON을 stdin으로 읽고 제한된 summary만 출력. 위반·malformed JSON은 exit 1                                                                                     |

참고: controller 파일을 Node가 ESM으로 자동 재해석한다는 기존 `MODULE_TYPELESS_PACKAGE_JSON` 경고가 출력된다. 시험 실패는 아니며, 이 Task에서는 package module 형식을 바꾸지 않았다.

## 합성 benchmark

명령: `node --test scripts/tests/fabric-drawing-pilot-benchmark.test.mjs`

결과: **PASS — 1/1, 실패 0**

| 측정               |                    개수 | wall-clock |
| ------------------ | ----------------------: | ---------: |
| `fabric.Path` 생성 |                     500 | 30.3736 ms |
| `fabric.Path` 생성 |                   2,000 | 98.6178 ms |
| input toggle 판정  | 100회 중 100회 accepted |  0.3042 ms |

이 수치는 위 PC에서 Node 프로세스로 실행한 합성 benchmark다. 실제 Electron 렌더링 fps, dropped frame, GPU 합성 비용을 대신하지 않는다.

## 자동 회귀와 정적 검사

| 명령 범위                                                             |                         결과 |
| --------------------------------------------------------------------- | ---------------------------: |
| flag/runtime/session/shortcuts/source/integration/benchmark 집중 회귀 |                   PASS 62/62 |
| `npm run test:drawing`                                                |                 PASS 103/103 |
| `npm run test:mpv`                                                    |                 PASS 150/150 |
| `npm run test:playlist`                                               |                 PASS 156/156 |
| `npm run test:hybrid`                                                 |                     PASS 3/3 |
| `npm run lint`                                                        | exit 0, 오류 0, 기존 경고 59 |
| 신규 integration/diagnostics 파일만 ESLint                            |       exit 0, 오류 0, 경고 0 |

전체 lint 경고 59개는 이번 Task 5 신규 파일에서 나온 것이 아니다. 이 작업은 해당 기존 경고를 범위 밖 코드에서 수정하지 않았다.

## 실제 앱 시험 대기 항목

| 실제 앱 항목                                | 상태   | 필요한 증거                                                              |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| 실제 mpv 영상에서 재생 중 B 100회           | 미검증 | pause/load/window recreation, 검은 프레임, 영상 중복, timeline jump 여부 |
| 실제 영상 위 Brush 20획                     | 미검증 | 화면 녹화와 조작 결과                                                    |
| 실제 펜 pressure                            | 미검증 | 펜 장치 입력과 pressure 범위                                             |
| V 선택·사각 선택·이동·Delete·Clear          | 미검증 | 실제 overlay UI 조작                                                     |
| active 중 play/pause/seek/timeline/playlist | 미검증 | 각 조작이 막히지 않는지 확인                                             |
| playlist 10개 transition                    | 미검증 | host create count와 playback owner count 유지                            |
| 실제 프로젝트 `.bframe` no-save             | 미검증 | 앱 실행 전후 SHA-256/크기/mtime와 save-attempt counter                   |
| 60 fps 녹화 frame 분석                      | 미검증 | ffprobe fps/dropped frame 및 duplicate/black frame 구간                  |
| kill switch 재실행                          | 미검증 | 기존 UI와 기존 동작만 남는지 확인                                        |
| directory build와 패키지 리소스             | 미검증 | `BAEFRAME.exe`, Fabric IIFE, mpv/ffmpeg 포함 여부                        |

## 다음 판정 조건

Task 6 실제 앱 시험을 마친 뒤 각 항목을 `PASS | FAIL | 미검증`으로 갱신한다. 단일 overlay host가 active일 때 재생 버튼·seek·timeline·playlist 중 하나라도 막히거나 playback owner/save attempt가 늘면 Phase 0은 No-Go다.
