# Fabric Drawing Surface v3 Phase 0A 실제 앱 시험 결과

> 시험일: 2026-07-17 KST
>
> 시험 브랜치: `codex/baeframe-fabric-drawing-v3-poc`
>
> 시험판 버전: `1.6.0-beta`
>
> 범위: 저장하지 않는 opt-in Fabric.js 표면과 mpv 공존성 검증

## 1. 결론

**Fabric.js 교체 방향은 계속 시험할 가치가 있다. 그러나 현재 단일 overlay 구조를 그대로 제품에 넣는 것은 No-Go다.**

이번 시험판은 사용자가 겪던 핵심 결함 중 상당수를 실제 패키징 앱에서 극복했다.

| 현행 불편 | Phase 0A 결과 | 판정 |
| --- | --- | --- |
| mpv 연결 성공 알림 | 표시하지 않음 | 해결 |
| B 진입·종료 때 영상 전체 깜빡임 | mpv를 다시 열지 않고 입력 표면만 전환, 녹화 black segment 0 | 해결 |
| B 종료 뒤 영상이 두 개 재생됨 | mpv 재생 주인 1개 유지, HTML5 재생 전환 없음 | 해결 |
| B를 누르면 타임라인·재생 상태가 바뀜 | B 자체는 pause, seek, load를 호출하지 않음 | 해결 |
| V 클릭·이동만 해도 리뷰 저장 실패 | 실제 선택·이동·삭제에서 저장 시도 0, 오류 알림 0 | 해결 |
| 사각 선택과 묶음 이동 | 실제 마우스로 동작 | 해결 |
| 라쏘·한 획 일부 분리 | 아직 구현하지 않음 | 미해결 |
| 재생목록 경계가 끊겨 보임 | 기존 mpv handoff의 134ms 검은 공백 잔존 | 미해결 |
| 드로잉 중 영상 위 확대/축소 버튼 | active overlay가 클릭을 가로막음 | 새로 확인한 차단점 |

따라서 판정은 다음과 같다.

- Fabric/mpv 분리 구조 연구 지속: **Conditional Go**
- 입력 라우팅과 영상 HUD 공존 방식을 비교하는 Phase 0B 실험: **Go**
- drawingsV3 저장을 곧바로 연결하는 Phase 1: **No-Go**
- 기본 엔진 활성화·실사용 배포: **No-Go**

No-Go는 Fabric 자체가 쓸 수 없다는 뜻이 아니다. **현재 영상 전체를 덮는 단일 입력 창의 경계를 먼저 고쳐야 한다**는 뜻이다.

## 2. 시험판 구조

새 엔진은 다음 조건에서만 켜진다.

- 켜기: `--fabric-drawing-pilot` 또는 `BAEFRAME_FABRIC_DRAWING_PILOT=1`
- 즉시 끄기: `--disable-fabric-drawing-pilot`
- 켜기와 끄기를 함께 주면 끄기가 우선
- 플래그가 없으면 기존 경로 유지

핵심 구현 원칙은 다음과 같다.

1. 영상은 처음부터 끝까지 mpv 한 개가 소유한다.
2. B는 영상 파일, 엔진, 재생 위치와 타임라인을 바꾸지 않는다.
3. Fabric canvas와 툴바는 한 번 준비해 B 토글 때 다시 만들지 않는다.
4. pilot에서는 기존 드로잉과 어니언 스킨을 숨겨 두 엔진이 겹치지 않게 한다.
5. Phase 0A 조작은 `.bframe`이나 ReviewDataManager에 저장하지 않는다.
6. 표면 준비 실패, 오래된 응답, overlay crash는 입력을 끄는 방향으로 닫힌다. 준비 실패는 enable 요청에서만 250ms부터 최대 2초까지 재시도하며, 중간 생성된 Canvas·DOM·listener는 전부 rollback한다.

Fabric.js 7.4.0과 perfect-freehand 1.2.3을 사용했다. 소스 runtime은 빌드 전에 자동으로 IIFE bundle로 다시 생성되며, 최종 `app.asar` 안의 핵심 6개 파일이 작업 소스와 SHA-256 단위로 일치하는 것도 확인했다.

## 3. 실제 패키징 앱 시험

### 3.1 실제 OS 마우스 입력

초기 구현은 투명 overlay를 `focusable: false`로 유지했다. 실제 Windows 입력을 붙여 보니 `pointermove`와 `pointerup`은 오지만 `pointerdown`이 오지 않아 마우스로 획을 시작할 수 없었다. renderer 좌표 주입 시험만으로는 발견할 수 없는 실제 앱 결함이었다.

다음과 같이 수정한 뒤 실제 마우스로 다시 시험했다.

- active 준비 완료 뒤에만 overlay를 `focusable: true`와 입력 수신 상태로 전환
- passive는 `ignore mouse → focusable false → 필요할 때만 main focus 복원` 순서
- overlay 포커스 중 B, V, Delete, Space, 방향키를 메인 renderer로 안전하게 전달
- Space와 방향키를 Electron 표준 keyCode로 정규화
- 한글 IME의 Process/Dead/조합 중 입력은 전달하지 않음
- Tab과 Enter는 툴바 접근성을 위해 overlay 안에 유지
- 전달 실패 때 원래 입력을 무조건 막지 않음

수정 뒤 결과:

| 시험 | 실제 결과 | 판정 |
| --- | --- | --- |
| 마우스 Brush | object `0 → 1`, mutation 1 | PASS |
| OS pointer trace | down 1, move 3, up 1 | PASS |
| pointer-to-preview | 최종 빌드 첫 획 평균 1.4ms, 최대 2.1ms | PASS |
| 기본 마우스 pressure | 0.5 | 설계값 확인 |
| 저장 시도·surface 오류 | 0 / 0 | PASS |

물리 Windows Ink 펜은 아직 시험하지 않았으므로 실제 압력 곡선까지 통과했다고 보지는 않는다.

### 3.2 선택·이동·삭제와 단축키

실제 overlay 창이 포커스된 상태에서 Windows 키보드와 마우스로 검증했다.

| 시험 | 실제 결과 | 판정 |
| --- | --- | --- |
| V | Select로 전환 | PASS |
| 사각 선택 | 획 1개 선택, 저장 변경 없음 | PASS |
| 선택 획 이동 | mutation `1 → 2`, 선택 유지 | PASS |
| Delete | object `1 → 0` | PASS |
| Space | Fabric active를 유지한 채 mpv 재생 시작 | PASS |
| B | passive 전환, 툴바 숨김, legacy mirror 숨김 유지 | PASS |
| 리뷰 저장 시도 | 전체 과정 0회 | PASS |
| 저장 실패 알림 | 0회 | PASS |

라쏘와 한 획 일부 분리는 Phase 0A에 포함하지 않았다. Fabric 기본 선택만으로 “획의 일부”가 자동 분리되는 것은 아니며, centerline 교차 판정과 새 stroke 두 개를 만드는 전용 명령이 필요하다.

### 3.3 재생 중 B 반복

| 시험 | 결과 |
| --- | --- |
| 일시정지 중 B 20회, 180ms 간격 | 20/20 정확한 active/passive 교대 |
| 일시정지 중 B 100회, 30ms 간격 | 100/100, error/stale/duplicate 0 |
| 재생 중 B 20회, 180ms 간격 | 20/20 정확한 교대 |
| 재생 중 B 100회, 100ms 간격 | 100/100, error/stale/duplicate 0 |
| warm toggle 내부 처리 p95 | 0.3ms |
| 재생 프레임 | `14 → 719`, 시험 중 영상이 자연 종료 |
| mpv child | 1개 유지 |

별도 연속성 확인에서는 재생 중 B를 끈 뒤 프레임이 `21 → 32 → 63`으로 계속 진행했다. B 자체 때문에 재생이 멈추거나 처음으로 돌아가지 않았다.

25초 녹화 파일은 60fps stream으로 기록됐고 1,473프레임을 담았다. 영상 영역의 완전 검은 구간은 0회였다. 이 자료는 “B 토글 때 검은 화면이 끼는가”에는 PASS 증거지만, 기대한 1,500프레임 중 27프레임을 캡처 도구가 놓쳤으므로 **한 프레임도 빠지지 않는 엄격한 60fps gate는 보류**한다.

### 3.4 줌·리사이즈

메인 renderer의 실제 줌 handler를 호출해 `100% → 125%`로 바꾸면 Fabric transform도 `scale=1.25`로 맞았고, 확대 뒤 실제 마우스 획 좌표도 정상 범위에 생성됐다. 최대화에서는 overlay viewport가 `2302×1295`로 갱신됐고, 툴바는 화면 기준 `x=12, y=12`를 유지했다. 복원 뒤에도 추가 획이 정상 생성됐다.

그러나 최종 빌드에서 같은 확대 버튼을 실제 클릭하면 passive에서는 `100% → 125%`로 동작하고, Fabric active에서는 100%에 머물렀다. 원인은 CSS가 아니라 **입력을 받는 BrowserWindow가 아래 BrowserWindow 클릭을 부분적으로 통과시킬 수 없기 때문**이다. 재생바와 타임라인은 overlay 창 바깥이라 동작했지만, 이 결함 하나로 현재 단일-host 구조는 제품 gate에서 No-Go다.

### 3.5 리뷰 파일 불변

시험 fixture:

- 파일: `fabric-poc-legacy.bframe`
- 크기: 1,337 bytes
- SHA-256: `7130AD0852A85861EB6D5BCE9329262E730CE75CDA1829F505B227A72CBEC001`
- 마지막 수정: `2026-07-17 13:58:04 +09:00`
- 시험 앱 시작: `2026-07-17 14:14:26 +09:00`

실제 그리기, 선택, 이동, Delete, Space, B 반복, 줌과 리사이즈 시험 뒤에도 hash와 mtime이 같았다. 내부 `saveAttemptCount=0`, `surfaceErrorCount=0`, 저장 실패 알림 0이었다.

### 3.6 최종 재빌드 smoke

오류 복구와 자동 반복 키 보강 뒤 새로 만든 최종 빌드에서 다시 확인했다.

- 첫 B에서 enable-only Fabric 준비 성공, active 진입
- 실제 OS 마우스 획: object `0 → 1`, mutation 1, pressure sample 3개
- 실제 V: select 전환
- overlay 포커스의 실제 Space: frame `0 → 58`, Fabric active 유지
- 재생 중 실제 B 종료: frame `548 → 590`, passive 전환과 툴바 숨김, 재생 지속
- packaged overlay에 `autoRepeat=true` B 입력: state와 inputRevision 불변
- 실제 확대 클릭: passive `100% → 125%`, active `100% → 100%`
- 마지막 진단: surface error 0, save attempt 0
- 종료 뒤 격리 시험 프로세스 0

자동 반복 검사는 최종 패키지의 overlay→main keyboard relay 전체를 통과시킨 통합 입력이다. 물리 키를 손으로 길게 누르는 실사용 확인은 Phase 0B 펜·키보드 현장 시험에 함께 남긴다.

## 4. 재생목록 문제

Fabric active 상태에서도 A→B 항목 전환과 재생은 성공했고, 같은 overlay host와 mpv owner가 유지됐다. 하지만 기존 증거 녹화에서 경계에 **134ms 검은 공백**이 한 번 검출됐다.

원인은 Fabric이 아니라 기존 mpv handoff다.

1. 다음 파일을 준비할 때 이전 native mpv host를 먼저 숨긴다.
2. 새 path와 time-pos가 잡히면 host를 다시 보인다.
3. 새 영상의 첫 프레임이 실제 화면에 제시됐는지는 기다리지 않는다.

따라서 새 드로잉 엔진만 교체해도 재생목록 끊김은 해결되지 않는다. 이전 마지막 프레임 유지 또는 새 프레임 presented 신호를 이용한 별도 무간극 패치가 필요하다.

## 5. 자동 회귀와 성능

최종 소스와 최종 bundle 기준 결과:

| 시험 묶음 | 결과 |
| --- | ---: |
| Fabric pilot 집중 검사 | PASS 113/113 |
| 기존 드로잉 회귀 | PASS 103/103 |
| mpv 회귀 | PASS 158/158 |
| 재생목록 회귀 | PASS 156/156 |
| 하이브리드 엔진 회귀 | PASS 3/3 |
| ESLint | 오류 0, 기존 경고 59 |
| diff whitespace 검사 | PASS |
| directory build | PASS |
| source ↔ app.asar 핵심 파일 | 6/6 SHA-256 일치 |

Node 합성 benchmark:

- Fabric Path 500개 생성: 32.4405ms
- Fabric Path 2,000개 생성: 94.0731ms
- 입력 토글 100회: 0.3443ms, 100회 모두 수락

이 benchmark는 빠른 회귀 신호일 뿐이다. 실제 Fabric 화면에서 500/2,000획을 선택·이동할 때의 fps와 응답 시간은 아직 측정하지 않았으므로 제품 성능 gate를 통과한 것으로 계산하지 않는다.

## 6. UI 사용감

| 항목 | 기존/초기 시험 | 현재 Phase 0A |
| --- | --- | --- |
| 도구 노출 | 기존 도구와 새 도구가 겹칠 가능성 | pilot에서는 legacy drawing/onion을 숨기고 active 때만 새 툴바 표시 |
| 현재 도구 | 상태 구분이 약함 | 색, `aria-pressed`, focus와 press 피드백 동기화 |
| 버튼 크기 | 작은 기본 버튼 | 최소 40×40px |
| B 토글 | DOM과 영상 엔진까지 재구성 가능 | warm canvas visibility/input만 전환 |
| 줌/리사이즈 | 툴바까지 확대·이동 가능 | canvas만 transform, 툴바는 화면 좌표에 고정 |
| 실패 상태 | 준비 실패가 조용히 남을 수 있음 | passive 복귀와 실패 알림 |

이 UI 정리는 기능 검증 중에도 모드 상태를 분명히 느끼게 하기 위한 최소 기준이다. 최종 제품 디자인은 Phase 0B의 입력 라우팅과 영상 HUD 공존 방식이 확정된 뒤 다시 다듬는다.

## 7. 빌드와 증거

최종 로컬 시험 빌드:

- 실행 파일: `dist/win-unpacked/BFRAME_alpha_v2.exe`
- 실행 파일 SHA-256: `116A04AAFB21ACDFEB66641752120FACDBEB7EEFB64C8DAD64FA2F880FB3F8B4`
- `app.asar` SHA-256: `30F938533F5969567297AF0840AF7E0ED46D1516C74AC0FF0BB32E74F58B5396`

로컬 증거 파일:

| 파일 | 용도 | SHA-256 |
| --- | --- | --- |
| `fabric-final-build-smoke-20260717.jpg` | 최종 재빌드에서 실제 OS 마우스로 만든 획 | `A0437BBB65060164622428F72D73015B7FE51D15A8BEDFCDF607DC5F9E434D2C` |
| `fabric-final-os-mouse-20260717.png` | 실제 OS 마우스로 만든 획과 active 툴바 | `E8C02CF914CE523A1CB0855FCDCE04FFE4184F2F0DBB438312BC49AC411CB8D6` |
| `fabric-final-b100-60fps-20260717-4.mkv` | 재생 중 B 100회, 60fps stream | `490C0656654B2072EA6F5BEC4E1B0A878A9F279D9726D6099CDC5AE805792710` |
| `fabric-playlist-boundary-active-20260717-3.mkv` | active 상태 재생목록 경계와 134ms 공백 | `B38ABCBCA942E55086C723E39992CD44E0278D1195EFD5AF6C1355AC49C6E8BF` |

증거와 시험 fixture는 저장소에 커밋하지 않는 로컬 검증 자료다. 시험은 별도 worktree에서 수행했고, 기존 배포 앱과 메인 저장소는 수정하지 않았다. 종료 뒤 해당 worktree 시험 프로세스가 0개인 것도 확인했다.

## 8. 다음 단계

### 먼저 할 일: Phase 0B

단순히 실제 영상 `canvasRect`만 덮는 별도 창을 추가해도 확대/축소 HUD가 영상 위에 겹치는 배치에서는 버튼을 계속 가린다. 따라서 다음 두 방식을 실제 비교한다.

1. **우선 실험: active HUD mirror/bridge** — 드로잉 중에는 확대/축소·전체화면 제어를 상단 host에 같은 위치와 상태로 표시하고, 클릭을 메인 renderer의 동일 command handler로 전달한다. 원본과 복제 UI가 서로 다른 로직을 갖지 않게 한다.
2. **대안 측정: native hit-test 또는 분할 host** — 제어 사각형만 통과시키는 방식이지만 Electron 기본 API 제약, 분할 경계를 넘는 획과 다중 DPI 위험이 있어 우선안은 아니다.

별도 warm `DrawingSurfaceHost`는 Fabric과 passive overlay의 수명주기를 분리하는 데는 도움이 되지만, HUD bridge 없이 확대 버튼 문제를 해결한다고 간주하지 않는다. Phase 0B 증거를 보기 전에는 최종 창 구조를 확정하지 않는다.

Phase 0B에서 반드시 통과할 항목:

1. 영상 위 확대/축소, 재생바, 타임라인과 전체화면 버튼 실제 클릭·키보드 접근
2. 실제 Windows Ink 펜의 압력·빠른 필기
3. 100%, 125%, 150%, 200% DPI와 서로 다른 배율의 다중 모니터
4. 실제 Fabric 500/2,000획 선택·이동 fps
5. 60fps 캡처 드롭 없는 B 100회 증거
6. overlay crash, Alt-Tab, IME와 장시간 soak

### 그 뒤의 제품 단계

1. DrawingDocument v3와 undo/redo를 메모리에서 구현
2. 원자적 저장·복구를 붙인 뒤 실제 `.bframe` 저장
3. 자유형 라쏘와 획 일부 분리
4. 재생목록 무간극 패치를 별도 병렬 작업으로 해결
5. 물리 펜·DPI·장시간 시험을 모두 통과한 뒤 기본 활성화 검토

최종 불변조건은 유지한다. **영상은 mpv 하나가 계속 재생하고, B는 드로잉 입력 표면만 켜고 끈다.**
