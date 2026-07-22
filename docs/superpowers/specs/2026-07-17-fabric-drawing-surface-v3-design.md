# BAEFRAME Fabric Drawing Surface v3 정식 교체 설계

- 작성일: 2026-07-17
- 문서 상태: Phase 0A 실제 앱 시험 완료, Phase 0B 입력 라우팅 실험 승인·최종 구조 결정 보류
- 기준 소스: origin/main dc0905676e27add74f5061edeabfe783adf3be06
- 첫 구현 범위: 저장하지 않는 opt-in 실제 앱 시험판
- 최종 목표: mpv를 유지한 채 Fabric.js 기반 드로잉 엔진으로 교체
- 시험 결과: `DEVLOG/2026-07-17-fabric-drawing-phase0-results.md`

## 1. 결정 요약

BAEFRAME의 새 드로잉 엔진은 Fabric.js 7.4.0과 perfect-freehand 1.2.3을 사용한다.

단순히 기존 HTML 캔버스 구현을 Fabric으로 바꾸는 방식은 사용하지 않는다. mpv는 별도 네이티브 자식 창에서 영상을 출력하므로, 메인 renderer 안의 캔버스는 mpv 위에 안정적으로 올라올 수 없다. 새 드로잉 표면은 이미 mpv 위에 상시 존재하는 투명 Electron 자식 창인 MPVOverlayHost 안에 둔다.

최종 구조의 핵심 불변조건은 다음과 같다.

1. 영상 재생의 주인은 항상 하나다.
2. B 키는 영상 엔진, 영상 파일, 재생 위치, 타임라인을 변경하지 않는다.
3. B 키는 드로잉 표면의 입력 수신 여부와 도구 UI만 변경한다.
4. 드로잉 표면은 B 토글 때 생성하거나 파괴하지 않는다.
5. 새 그림의 공식 원본 데이터는 BAEFRAME의 drawingsV3이며 Fabric JSON이 아니다.
6. 기존 drawings v2 데이터는 삭제하지 않지만 새 엔진에서는 표시하지 않는다.
7. 선택만 한 동작은 저장 변경이 아니다.
8. 실제 획·이동·삭제·변형이 확정될 때만 명령 하나를 저장한다.
9. 첫 시험판은 리뷰 파일을 수정하지 않는다.
10. 첫 시험판이 mpv 공존성 및 입력 성능 기준을 통과한 뒤에만 저장 기능을 붙인다.

## 2. 배경과 현재 문제

현재 드로잉 모드 진입 흐름은 renderer/scripts/app.js의 applyDrawModeState()에서 다음 작업을 수행한다.

1. mpv 재생을 일시정지한다.
2. HTML5가 직접 재생할 수 있는 코덱인지 검사한다.
3. 가능한 경우 같은 파일을 HTML5 엔진으로 다시 연다.
4. 드로잉 모드 종료 시 다시 mpv로 파일을 연다.
5. HTML5 전환이 불가능하면 mpv 화면을 이미지로 캡처한 뒤 네이티브 mpv 창을 숨긴다.

이 하이브리드 전환은 다음 증상과 직접 맞닿아 있다.

- B를 누를 때 영상 전체가 깜빡인다.
- 모드 전환 때 영상이 멈춘다.
- HTML5와 mpv의 소유권이 엇갈리면 두 재생 경로가 동시에 살아날 수 있다.
- 모드 진입과 종료 과정에서 프레임, 길이, 타임라인 갱신 이벤트가 다시 발생한다.
- 재생목록 컷 전환과 드로잉 전환이 겹치면 로드 경합이 커진다.

현재 main/mpv-overlay-host.js는 이 구조적 한계를 이미 설명하고 있다. mpv가 네이티브 자식 창에서 렌더링되기 때문에 메인 renderer의 DOM 오버레이가 그 위에 안정적으로 보이지 않아, 별도의 투명하고 클릭이 통과되는 자식 창을 사용한다.

현재 드로잉 엔진 자체도 한 캔버스가 아니다.

- DrawingCanvas: 포인터 입력과 즉시 그리기
- DrawingManager: 레이어, 키프레임, 선택, 스냅샷, 렌더
- DrawingLayer: 저장 모델
- DrawingSync: Liveblocks Broadcast 동기화
- app.js: 전역 Undo/Redo, mpv 이미지 미러, 단축키, 타임라인 결합

따라서 교체 단위는 DrawingCanvas 하나가 아니라 드로잉 표면, 객체 모델, 명령, 저장, 동기화 경계를 포함한 전체 하위 시스템이다.

## 3. 목표

### 3.1 사용자 경험 목표

- 재생 중 B를 눌러도 영상이 계속 같은 mpv 인스턴스에서 재생된다.
- B 진입과 종료에서 검은 프레임, 정지 이미지, 크기 변화, 깜빡임이 없다.
- B는 언제나 드로잉 모드를 직접 켜고 끈다.
- V로 선택하기만 해서는 리뷰 데이터 저장을 시도하지 않는다.
- 선택된 획을 움직이고 포인터를 놓을 때만 한 번 저장한다.
- 사각형 선택, 자유형 라쏘, 획 일부 분리를 단계적으로 지원한다.
- 필압, 부드러운 곡선, 이동, 확대·축소, 회전, 복사·붙여넣기, Undo/Redo를 일관된 객체 단위로 제공한다.
- 드로잉 모드에서도 재생 버튼과 재생목록은 계속 작동한다.
- 영상 전환 때 기존 MPVOverlayHost 창을 다시 만들지 않는다.
- mpv가 연결됐다는 성공 알림은 표시하지 않는다.

### 3.2 안정성 목표

- mpv 활성 중 HTML5 video는 재생하지 않는다.
- 동일 파일을 B 모드 전환 때문에 다시 load하지 않는다.
- 투명 드로잉 창이 고장 나도 mpv 재생은 계속된다.
- 드로잉 저장 실패가 댓글, 하이라이트, 재생 상태를 손상시키지 않는다.
- 구버전 드로잉 데이터를 자동 변환하거나 삭제하지 않는다.
- 시험판 기능을 끄면 현재 main과 동일한 동작으로 돌아간다.

### 3.3 기술 목표

- Fabric을 화면 편집기로만 사용하고 도메인 데이터는 BAEFRAME이 소유한다.
- 영상, 타임라인, 저장, 협업 코드가 Fabric 객체를 직접 참조하지 않는다.
- 모든 저장 가능한 변경은 명시적 DrawingCommand로 표현한다.
- 활성 키프레임만 Fabric 객체로 올리고 나머지는 정적 캐시로 표시한다.
- 포인터 이동마다 PNG Data URL을 만들거나 IPC로 전송하지 않는다.
- 드로잉 표면과 메인 renderer 사이에 검증 가능한 메시지 계약을 둔다.

## 4. 범위

### 4.1 정식 교체 범위

- mpv 위의 상시 투명 드로잉 표면
- Fabric 객체 선택 및 변형
- perfect-freehand 필압 브러시
- BAEFRAME drawingsV3 객체 모델
- 레이어와 프레임 키프레임
- 획·도형·마스크·래스터 객체
- 명령 기반 Undo/Redo
- 사각형 선택과 자유형 라쏘
- 자유선 획의 부분 분리
- 원자적 저장과 복구
- 프레임 재생용 정적 캐시
- 버전이 명시된 협업 프로토콜

### 4.2 첫 시험판 범위

첫 시험판은 실제 BAEFRAME 창에서 다음만 제공한다.

- 명령행 인자 또는 환경변수로만 활성화
- 기존 mpv 투명 overlay 안의 Fabric 드로잉 층
- B 입력 토글
- 브러시와 필압
- 객체 클릭 선택
- 사각형 다중 선택
- 선택 이동
- Delete 삭제
- 현재 세션 Clear
- 화면 크기 및 mpv bounds 동기화
- 프레임, 입력 지연, 메모리 진단 기록

첫 시험판은 다음을 저장하지 않는다.

- .bframe의 drawings
- .bframe의 drawingsV3
- Undo 이력
- 협업 Broadcast
- 사용자 클립보드

MPVOverlayHost 안의 pilot toolbar에 “새 드로잉 시험판 · 저장 안 됨 · 시험 프레임 N”을 정적으로 표시한다. 토스트 알림은 사용하지 않는다.

### 4.3 첫 시험판 제외 범위

- 기존 drawings v2 표시
- 기존 그림 변환
- 라쏘 부분 획 분리
- 도형, 화살표, 픽셀 마스크
- 리뷰 파일 저장
- Liveblocks 동기화
- 새 엔진의 기본 활성화
- 배포본 및 공유 드라이브 배포
- mpv 재생목록 자체의 선로딩 구조 변경
- 댓글 모드의 하이브리드 전환 변경

이 제외 항목들은 시험판 성능과 입력 구조가 통과한 뒤 별도 구현 단계에서 진행한다.

## 5. 라이브러리 결정

### 5.1 채택

- Fabric.js 7.4.0을 정확한 버전으로 고정한다.
- perfect-freehand 1.2.3을 유지한다.
- package.json에는 caret 또는 tilde 없이 정확한 Fabric 버전을 기록한다.
- Fabric은 빌드 전용 devDependency로 두고 브라우저용 엔트리만 esbuild로 번들한다.
- vendor entry는 첫 시험판에 필요한 Canvas, Path와 선택 관련 export만 가져온다.
- 번들 옵션은 platform=browser, format=iife, target=chrome120으로 고정한다.
- 결과물 renderer/scripts/lib/mpv-fabric-overlay.iife.js는 기능 플래그가 켜진 뒤 기존 overlay 문서에 한 번만 주입한다.
- Fabric 설치 및 번들 단계의 Node.js 최소 버전은 20이다.
- Electron 28 renderer에서는 번들된 브라우저 코드만 실행하고 Node API를 사용하지 않는다.

### 5.2 Fabric을 선택한 이유

- 객체 클릭, 영역 선택, 다중 선택이 기본 제공된다.
- 이동, 확대·축소, 회전, skew 컨트롤이 기본 제공된다.
- Path, Rect, Ellipse 등 필요한 편집 객체가 준비되어 있다.
- 객체 캐시와 정적 Canvas 경로를 제공한다.
- MIT 라이선스이며 현재 유지보수가 활발하다.
- BAEFRAME이 직접 구현해야 할 선택·변형 UI의 양이 Konva와 Pixi보다 적다.

### 5.3 후보 비교와 결론

| 후보 | 강점 | BAEFRAME에서 직접 만들어야 하는 핵심 | 결론 |
|---|---|---|---|
| Fabric.js | 객체 선택, 다중 선택, transform control, vector object 편집이 가장 완성돼 있음 | 필압 브러시, 자유형 라쏘, 부분 획 분리, 프레임 모델 | 채택. 편집 UX와 구현량의 균형이 가장 좋음 |
| Konva | scene graph가 단순하고 canvas 성능을 예측하기 쉬움 | 필압, 라쏘, 획 분리, 객체 편집 세부 UX, 공식 데이터 adapter | Fabric이 실제 성능 기준을 통과하지 못할 때 2순위 |
| PixiJS | WebGL 중심 대량 렌더링 성능 여지가 큼 | 선택, transform handle, hit-test 정책, 편집기 동작 대부분 | 재생용 렌더러 후보일 수 있으나 첫 편집 엔진으로는 구현량이 큼 |
| Paper.js | path geometry와 boolean 연산에 강함 | 앱 수준 선택 UI, transform control, 레이어·프레임 편집 UX | 라쏘/분할 geometry 보조 연구 후보, 주 편집 엔진으로는 비채택 |
| Excalidraw·tldraw 계열 | 완성된 화이트보드 UX와 도구가 많음 | 영상 원본 좌표, 프레임 키프레임, mpv 창 통합, BAEFRAME UI와 데이터 모델 분리 | 제품 전체를 화이트보드 구조에 맞추게 되어 통합 범위가 과도함 |

어느 라이브러리를 선택해도 Electron의 투명 자식 창, 포커스, DPI, mpv z-order 문제는 자동으로 해결되지 않는다. 따라서 Phase 0의 첫 판정은 라이브러리 기능보다 “현재 MPVOverlayHost를 실제 입력 표면으로 안전하게 쓸 수 있는가”다.

Fabric의 성능이 부족하더라도 바로 엔진 전체를 폐기하지 않는다. 정적 재생 경로만 PixiJS 또는 bitmap cache로 분리하고, 편집 상태는 Fabric을 유지하는 이중 adapter도 Phase 3 성능 자료를 근거로 검토할 수 있다. 단, Phase 0에서는 두 렌더러를 동시에 넣지 않는다.

### 5.4 기본 기능으로 간주하지 않는 항목

다음은 Fabric 기본 기능으로 간주하지 않고 BAEFRAME 기능으로 구현한다.

- 필압 브러시
- 자유형 라쏘
- 획 일부 분리
- 키프레임과 홀드
- Undo/Redo 정책
- 공식 저장 형식
- 협업 명령
- 프레임 캐시
- 오브젝트 지우개와 비파괴 마스크

### 5.5 대체 조건

Fabric을 다음 조건에서만 Konva로 대체 검토한다.

- 투명 창 입력은 정상인데 2,000개 획 성능 기준을 최적화 후에도 통과하지 못한다.
- Fabric 객체 캐시를 사용해도 포인터 지연 기준을 반복해서 초과한다.
- 메모리 사용이 활성 프레임 한 개 제한에서도 안정화되지 않는다.

투명 자식 창의 포인터, 포커스 또는 DPI 문제가 실패 원인이라면 Konva로 바꾸지 않는다. 그 문제는 라이브러리가 아니라 창 통합 구조 문제이므로 mpv 렌더 통합 방식 자체를 다시 판단한다.

## 6. 프로세스와 창 구조

첫 시험판은 새 네이티브 창을 추가하지 않는다. 현재 mpv 위에서 댓글 마커, 토스트, 합성 레이어, drawing PNG를 표시하는 기존 MPVOverlayHost 한 개에 Fabric delta canvas를 추가한다.

네이티브 쌓임 순서는 유지된다.

1. 기존 MPVOverlayHost
   - passive mirror
   - 신규 Fabric delta canvas
2. 기존 MPVEmbedHost
   - 실제 mpv 영상
3. 메인 BAEFRAME renderer
   - 타임라인, 도구 패널, 사이드바

MPVOverlayHost 내부 DOM z-order는 다음과 같다.

1. onion mirror
2. legacy drawing PNG
3. Fabric delta canvas
4. composition mirror
5. HTML overlay
6. markers, tooltips, remote cursors, toasts
7. Fabric pilot toolbar와 “저장 안 됨 · 시험 프레임 N” badge

첫 시험판 플래그가 켜진 경우 legacy drawing PNG와 onion mirror는 숨기고 Fabric delta만 표시한다. 사용자 요구에 따라 기존 드로잉은 보이지 않아도 된다. 댓글, 합성 레이어, remote cursor와 toast는 기존 경로를 유지한다.

플래그 ON에서는 메인 renderer의 legacy drawing toolbar와 layer panel을 첫 B 진입 전에 숨겨 기존 이벤트 handler가 보이지 않게 한다. pilot toolbar DOM은 Fabric runtime 준비 때 overlay 안에 한 번만 만들고, B 토글에서는 visibility, opacity, pointer-events만 바꾼다. videoWrapper, timeline, controls-bar의 layout과 크기는 바꾸지 않는다.

기존 BrowserWindow 옵션과 data URL 문서는 유지한다. Fabric IIFE bundle을 loadURL 완료 후 한 번만 executeJavaScript로 주입하고 window.__mpvFabricOverlay namespace를 등록한다. Fabric capability 준비 실패는 기존 mirror API 준비 실패로 간주하지 않는다.

창의 초기 상태는 `setIgnoreMouseEvents(true)`와 `focusable: false`다. B 진입 시 Fabric session 준비가 성공한 뒤 `focusable: true`와 입력 수신 상태로 전환하고, B 종료 시 `setIgnoreMouseEvents(true) → focusable: false → 필요할 때만 mainWindow focus 복원` 순서로 되돌린다. B 토글 중 BrowserWindow 생성, loadURL, setBounds, show, hide, moveTop, destroy를 호출하지 않는다.

실제 Windows 시험에서 `focusable: false`인 투명 자식 창은 `pointermove`와 `pointerup`은 관측됐지만 `pointerdown`을 받지 못했다. 따라서 비포커스 입력만으로 Fabric을 조작하는 가정은 폐기한다. active 상태의 overlay가 포커스를 가진 동안 `before-input-event`에서 B, V, Delete, Space, 방향키 등 허용된 전역 단축키를 Electron 표준 keyCode로 정규화해 메인 renderer로 전달한다. IME 조합 중인 Process/Dead 입력은 전달하지 않고, Tab과 Enter는 툴바 접근성을 위해 overlay에 남긴다. 전달 실패 때 원래 입력을 막지 않으며, passive 전환은 overlay가 실제로 포커스되어 있었을 때만 mainWindow를 다시 포커스해 Alt-Tab 포커스 탈취를 막는다.

MPVOverlayHost bounds는 전체 videoWrapper다. 실제 시험에서 active overlay가 영상 내부의 확대/축소 버튼 클릭을 가로막았다. CSS `pointer-events`만으로 다른 BrowserWindow에 부분 클릭 통과가 되지 않으므로, 현재 단일-host Phase 0A는 제품 승격 기준에서 No-Go다. 재생바와 타임라인은 overlay 바깥이어서 동작했고 Space 릴레이도 통과했지만, 앞으로 영상 위 제어가 추가될 때 같은 문제가 반복된다.

따라서 Phase 1 전에 Phase 0B 입력 라우팅 실험을 둔다. 단순히 실제 `canvasRect`만 덮는 별도 `DrawingSurfaceHost`를 추가하는 것만으로는 충분하지 않다. 확대/축소 HUD가 영상 사각형 안에 겹치는 16:9 배치에서는 그 창도 동일한 버튼을 계속 가린다.

Phase 0B의 첫 비교안은 다음과 같다.

1. **active HUD mirror/bridge**: 원래 영상 HUD의 표시 상태와 위치를 상단 drawing host에 미러링하고, 클릭은 메인 renderer의 동일한 zoom/fullscreen command handler로 전달한다. active 동안 원본 HUD는 입력 대상에서 제외하되 시각 상태와 접근성 상태는 단일 모델에서 동기화한다. 현재 구조에서 가장 작은 변화로 연속 획을 보존할 수 있어 우선 실험안으로 삼는다.
2. **native hit-test 또는 분할 host**: 제어 사각형을 네이티브 click-through 영역으로 만들거나 여러 입력 창으로 둘러싼다. Electron 기본 API만으로는 창의 일부만 click-through로 만들 수 없고, 분할 경계를 넘는 획과 다중 DPI 처리가 어려우므로 초기 권장안이 아니다.

별도 warm `DrawingSurfaceHost`는 Fabric 수명주기와 passive MPVOverlayHost를 분리하는 데는 유용하지만 HUD bridge 없이 확대 버튼 문제를 해결한다고 간주하지 않는다. `forward: true`는 현재 커서 깜빡임을 재발시킬 수 있어 사용하지 않는다. 두 안의 실제 마우스·펜·DPI 증거를 비교하기 전에는 최종 창 구조를 잠그지 않는다.

## 7. 컴포넌트 경계

### 7.1 Main process

#### MPVOverlayHost Fabric capability

책임:

- 기존 overlay 창 수명과 passive mirror 의미 보존
- Fabric IIFE를 overlay 문서에 한 번만 주입
- hostGeneration, videoGeneration, inputRevision 검증
- Fabric session 준비 후 입력 통과 모드 전환
- B 종료 또는 오류에서 즉시 click-through 복구
- Fabric의 가벼운 session summary와 metrics를 invoke 응답으로 반환
- Fabric 오류와 기존 overlay API 오류를 분리

공개 인터페이스:

~~~js
ensure(bounds)
updateBounds(bounds)
setDrawingInput(request)
updateDrawingTool(request)
applyDrawingAction(request)
getDrawingDiagnostics(request)
destroy()
~~~

setDrawingInput()은 영상, mpvManager, VideoPlayer, HTMLVideoElement을 참조하지 않는다. hostGeneration은 정확히 일치해야 하고 작은 videoGeneration 또는 inputRevision은 stale이다. 더 큰 videoGeneration은 enabled:false 요청에서만 수락하며, 가장 먼저 setIgnoreMouseEvents(true)를 실행하고 이전 session을 무효화한 뒤 current videoGeneration을 원자적으로 올린다. enabled:true는 이미 수락된 current videoGeneration과 최신 desired inputRevision이 정확히 일치할 때만 가능하다.

신규 IPC handler는 event.sender가 mainWindow.webContents인지 확인한다. overlay renderer에는 별도 preload를 넣지 않고, 첫 시험판의 overlay → main 비동기 IPC도 만들지 않는다. main renderer가 기존 preload의 invoke API를 통해 상태를 push하고 deactivate 응답으로 객체 수, 메모리 추정치, 성능 지표 같은 가벼운 summary만 pull한다.

### 7.2 MPV overlay의 Fabric renderer capability

#### FabricDrawingSurface

첫 시험판 runtime은 renderer/scripts/modules/mpv-fabric-overlay-runtime.js에서 작성하고 renderer/scripts/lib/mpv-fabric-overlay.iife.js로 번들한다. 기존 data URL 문서에 주입된 뒤 다음 namespace 하나만 등록한다.

~~~js
window.__mpvFabricOverlay = {
  version: 1,
  activate(session),
  deactivate(sessionId),
  updateTool(command),
  applyAction(command),
  setViewport(canvasRect),
  getDiagnostics()
}
~~~

책임:

- Fabric Canvas 한 개 유지
- PointerEvent와 pressure 수집
- perfect-freehand 결과를 Fabric Path로 생성
- 선택, 사각 선택, 이동, 삭제
- overlay 창 안에서 클릭 가능한 pilot brush, V, Clear, frame badge UI 유지
- viewport와 원본 영상 좌표 변환
- 프레임별 세션 장면 유지
- 입력 및 렌더 성능 측정

Fabric Canvas는 enableRetinaScaling: false로 생성한다. 논리 캔버스는 영상 원본 해상도를 사용하고 실제 창 크기에는 CSS로 맞춘다. objectCaching은 정적 객체에서만 허용하고 현재 변형 중인 객체와 transient preview에서는 끈다. 500/2,000획 측정에서 메모리 또는 이동 성능이 나빠지면 모든 획의 objectCaching을 끈 결과와 비교한다.

금지:

- 영상 파일 열기
- mpv 제어
- 리뷰 파일 저장
- 타임라인 변경
- 댓글 데이터 변경
- Fabric JSON을 공식 프로젝트 데이터로 직접 저장

#### PressureBrush

입력:

~~~js
{
  pointerId,
  pointerType,
  x,
  y,
  pressure,
  time
}
~~~

규칙:

- pen pressure는 0부터 1 범위로 clamp한다.
- mouse pressure가 0이면 0.5를 사용한다.
- 원본 좌표는 영상 원본 픽셀 좌표로 보존한다.
- perfect-freehand로 렌더용 outline을 만든다.
- 렌더 outline과 원본 point 목록을 분리한다.

#### SessionSceneStore

첫 시험판에서만 사용하는 메모리 저장소다.

- key: stable video identity + frame
- value: Fabric과 무관한 stroke 객체 배열
- 영상 파일 전환 시 활성 session만 바꾸고, 같은 재생목록 항목으로 돌아오면 현재 앱 실행 동안의 시험 획을 복원한다.
- videoGeneration과 sessionId는 늦은 메시지 구분에만 사용하고 저장소 key로 사용하지 않는다.
- 영상 session 캐시는 최근 10개 영상 또는 128MiB 중 먼저 도달한 값까지 LRU로 유지한다.
- B 종료 시에는 폐기하지 않는다.
- 앱 종료 시 폐기한다.
- .bframe 저장 이벤트를 발생시키지 않는다.
- B 종료 시 전체 scene을 직렬화하거나 다른 process로 복사하지 않는다.
- overlay renderer가 실제 crash하면 Phase 0 시험 그림은 유실될 수 있다. 저장 가능한 단계가 아니므로 이를 숨기지 않고 진단에 기록한다.

### 7.3 Main renderer

#### FabricDrawingPilotController

책임:

- 기능 플래그 계산
- B 키와 overlay pilot toolbar 상태 연결
- 기존 mpv overlay bounds와 canvas rect를 Fabric runtime에 전달
- 현재 영상 ID, 프레임, 원본 해상도, 현재 도구 전달
- 드로잉 모드에서 기존 DrawingCanvas 입력 비활성화
- preparing과 active 동안 메인 renderer의 기존 드로잉 toolbar·layer panel을 숨기고 MPVOverlayHost 내부 pilot toolbar만 표시
- preparing과 active 동안 기존 드로잉 mutation 단축키와 UI handler를 pilot router 앞에서 일괄 차단
- 새 엔진 활성 중 기존 drawingDataUrl 미러 생략
- Fabric capability 실패 시 드로잉 모드만 종료

이 controller는 기존 applyDrawModeState()의 mpv pause, HTML5 전환, freeze 캡처 경로를 호출하지 않는다.

기존 코드에서 `isDrawMode || isCommentMode`를 근거로 hybrid 또는 freeze를 시작하는 모든 지점은 다음 중앙 판정으로 모은다.

~~~js
requiresMpvReviewFreeze =
  isCommentMode ||
  (isDrawMode && !fabricDrawingPilotController.isActiveOrPreparing())
~~~

Fabric 시험판이 준비 중이거나 active인 동안에는 resize, time update, play/pause, playlist transition 같은 간접 이벤트도 hybrid 진입이나 freeze 캡처를 시작할 수 없다. Fabric 준비 실패 시 controller가 새 draw mode를 먼저 종료한 뒤 기존 경로로 돌아갈지 사용자 입력을 기다리며, 실패 자체가 자동 HTML5 전환을 유발해서는 안 된다.

## 8. 통신 계약

첫 시험판은 기존 main renderer preload의 invoke API를 사용한다. 요청은 다음 envelope을 사용한다.

~~~js
{
  protocol: "baeframe-drawing-surface",
  version: 1,
  requestId: "uuid",
  hostGeneration: 2,
  videoGeneration: 7,
  inputRevision: 12,
  type: "surface-state",
  payload: {}
}
~~~

토큰 의미는 겹치지 않게 다음으로 고정한다.

- hostGeneration: MPVOverlayHost BrowserWindow를 새로 만들거나 crash 복구로 교체할 때만 main process가 증가시킨다.
- videoGeneration: 새 영상 load가 확정될 때만 FabricDrawingPilotController가 증가시킨다. 같은 영상의 재생·seek·B 토글에서는 바뀌지 않는다.
- inputRevision: B on/off라는 원하는 입력 상태가 바뀔 때마다 증가한다. disable 요청은 준비 중인 enable보다 항상 큰 값이다.
- sessionId: 한 번의 B 활성화 시도마다 새로 만든다. 같은 stableVideoIdentity와 targetFrame의 scene cache를 다시 사용해도 sessionId는 재사용하지 않는다.
- toolRevision: active session 안의 도구 변경 순서를 나타낸다.
- requestId와 actionId: 중복 invoke와 Delete/Clear 재적용을 막는 UUID다.

`generation`, `videoSessionId`, `frame revision`처럼 의미가 겹치는 이름은 첫 시험판 계약에 추가하지 않는다.

필수 IPC:

- mpv:set-overlay-drawing-input
- mpv:update-overlay-drawing-tool
- mpv:apply-overlay-drawing-action
- mpv:get-overlay-drawing-diagnostics

set-overlay-drawing-input request는 hostGeneration, videoGeneration, inputRevision, enabled와 선택적인 session을 가진다. session에는 sessionId, stableVideoIdentity, targetFrame, sourceWidth, sourceHeight, canvasRect, tool을 포함한다. targetFrame은 B 진입 순간 한 번 정하고 Phase 0 session 동안 바꾸지 않는다.

update-overlay-drawing-tool은 current sessionId와 단조 증가하는 toolRevision을 요구한다. apply-overlay-drawing-action은 current sessionId와 고유 actionId를 요구하며 허용 action은 delete-selection과 clear-session뿐이다. main renderer에서 pilot가 active인 동안 키보드 Delete는 이 IPC만 호출하고 DrawingManager, ReviewDataManager, 기존 keyframe 단축키를 호출하지 않는다. MPVOverlayHost 안의 pilot toolbar 클릭은 같은 runtime의 updateTool()과 applyAction()을 직접 호출하고 다른 process로 왕복하지 않는다.

preparing 또는 active에서 허용되는 드로잉 관련 키는 B, V, pilot Delete, pilot Clear뿐이다. 다음 legacy mutation 경로는 이벤트 전파 전에 차단하며 no-op 처리한다.

- 기존 브러시·도형·지우개 도구 전환
- keyframe 생성·삭제·복제
- drawing copy, cut, paste, duplicate
- drawing Undo/Redo
- layer 생성·삭제·복제·순서·잠금·표시 변경
- 기존 전체 지우기와 선택 이동·변형

Space 재생, 타임라인 이동, 댓글 단축키처럼 드로잉 데이터를 바꾸지 않는 기존 기능은 유지한다. pilot toolbar는 기존 drawingManager 이벤트를 재사용하지 않으며 ReviewDataManager에 연결하지 않는다.

활성화 순서:

1. hostGeneration, videoGeneration, inputRevision을 검증하고 최신 inputRevision을 동기적으로 기록
2. Fabric session 준비
3. 비동기 준비 뒤 세 토큰과 enabled desired state를 다시 검증
4. Fabric canvas pointer-events 활성화
5. setIgnoreMouseEvents(false)
6. 성공 응답

비활성화 순서:

1. setIgnoreMouseEvents(true)
2. transient pointer와 transform 취소
3. session summary와 metrics 생성
4. Fabric canvas pointer-events 비활성화
5. 성공 응답

첫 시험판은 overlay → main 비동기 IPC를 만들지 않는다. 획과 선택은 overlay 안에서 처리하고 main은 invoke 응답으로 가벼운 상태만 pull한다. 전체 scene 직렬화는 B warm path에서 금지한다. 정식 저장 단계에서 command-proposed와 interaction-start가 필요해지면 sender 검증이 있는 좁은 overlay preload를 추가한다.

payload 상한:

- 일반 제어 메시지: 64 KiB
- 하나의 완성 획 command: 2 MiB
- 한 획의 최대 원본 포인트: 20,000개
- 한 키프레임 최대 객체: 10,000개

상한을 넘으면 획을 조용히 자르지 않는다. 해당 입력을 취소하고 surface-error에 명확한 원인을 기록한다.

## 9. 드로잉 모드 상태 기계

상태는 다음 여섯 개다.

- disabled
  - 기능 플래그 꺼짐
- passive
  - 창 준비됨, 입력 통과
- preparing
  - B 진입 요청을 받았지만 Fabric session 준비 중, 입력 통과
- active
  - B 모드 켜짐, 입력 수신
- recovering
  - Fabric capability 또는 overlay renderer 복구 중, 입력 통과
- failed
  - 현재 영상 세션에서 새 드로잉 사용 불가

### 9.1 B 진입

1. audio mode면 진입하지 않는다.
2. pilot flag와 mpv 활성 상태를 확인한다.
3. 새 sessionId와 더 큰 inputRevision을 만들고 preparing으로 전환한다.
4. B 진입 순간 current frame을 targetFrame으로 고정한다.
5. 기존 MPVOverlayHost의 Fabric capability가 준비되지 않았으면 IIFE를 한 번 주입한다.
6. targetFrame, viewport, tool state를 보내 setDrawingInput({ enabled: true })를 호출한다.
7. 같은 세 토큰의 성공 응답일 때만 active와 overlay pilot toolbar를 켠다.

preparing 중 B를 다시 누르거나 영상이 바뀌면 더 큰 inputRevision의 disable 요청을 즉시 보낸다. MPVOverlayHost는 disable revision을 동기적으로 기록하고 setIgnoreMouseEvents(true)를 먼저 실행한다. 이전 enable의 비동기 준비가 나중에 끝나더라도 세 토큰과 desired state를 다시 확인해 stale로 끝내며 입력을 켤 수 없다.

금지되는 호출:

- videoPlayer.pause()
- loadVideo()
- loadVideoWithHtml5Fallback()
- enterHybridReviewEngineIfPossible()
- showMpvReviewFreezeFrame()
- mpvManager.load()
- HTMLVideoElement.src 변경
- MPVOverlayHost 생성 또는 파괴
- MPVOverlayHost loadURL(), setBounds(), show(), hide(), moveTop()

### 9.2 B 종료

1. 더 큰 inputRevision으로 desired state를 disabled로 만든다.
2. setDrawingInput({ enabled: false })를 보내 즉시 click-through로 전환한다.
3. 진행 중인 pointer stroke를 취소한다.
4. 선택의 미확정 transform이 있으면 원래 위치로 되돌린다.
5. overlay pilot toolbar와 모드 표시를 끈다.

영상 재생 상태는 그대로 유지한다.

### 9.3 B 키 UX

B는 항상 모드를 직접 토글한다.

- 모드 밖 B: 마지막 도구로 진입
- 모드 안 B: 현재 도구가 무엇이든 즉시 종료

기존처럼 선택 도구에서 B를 누르면 브러시로 돌아가고 한 번 더 눌러야 종료되는 중간 동작은 새 엔진에서 사용하지 않는다.

### 9.4 재생 중 편집

- 드로잉 모드 진입만으로 재생을 멈추지 않는다.
- 드로잉 모드에서 재생 버튼을 누를 수 있다.
- 첫 시험판은 overlay → main 입력 이벤트를 만들지 않으므로 pointerdown도 재생을 멈추지 않는다.
- 첫 시험판의 targetFrame은 B 진입 순간의 frame으로 고정한다. 재생이 계속돼도 session 안의 모든 시험 획은 overlay pilot toolbar에 표시된 이 고정 frame에 속한다.
- 다른 frame에 그리고 싶으면 B를 끄고 원하는 frame에서 다시 켠다. 이 제한은 “저장 안 됨” 표식 옆에 “시험 프레임 N”으로 항상 표시한다.
- 저장 기능을 붙이는 Phase 1부터 좁은 interaction-start 채널을 추가하고, 실제 편집 pointerdown에서만 mpv를 한 번 pause한 뒤 확인된 프레임을 targetFrame으로 고정한다.
- 단순 hover는 재생을 멈추지 않는다.

### 9.5 도구 단축키

- B는 드로잉 모드 자체를 직접 켜고 끈다.
- V는 드로잉 모드 안에서 선택 도구로 바꾼다.
- preparing 중 V는 controller의 desired tool만 바꾸며 active 성공 뒤 가장 최신 도구 한 번만 전송한다.
- V로 객체를 클릭하거나 빈 곳을 클릭해 선택을 해제하는 동작은 command, dirty, review save를 만들지 않는다.
- V 상태에서 빈 공간을 드래그하면 사각형 다중 선택을 수행한다.
- pilot draw mode가 active인 동안 Delete는 항상 preventDefault와 stopPropagation을 먼저 수행하고 apply-overlay-drawing-action(delete-selection)만 호출한다.
- pilot active인데 시험 객체가 선택되지 않았으면 Delete는 no-op이다. 비동기 응답을 기다렸다가 기존 keyframe 삭제로 fallback하지 않는다.
- MPVOverlayHost 안의 pilot Clear 버튼은 local applyAction(clear-session)만 호출하며 기존 DrawingManager를 비우지 않는다.
- preparing 중 Delete와 Clear도 기존 경로 전파를 막고 no-op 처리한다.
- pilot가 passive, failed, disabled이거나 draw mode 밖인 경우에만 기존 Delete 의미를 유지한다.
- 입력창, 댓글 편집기, 설정창, 파일 대화상자에는 B, V, Delete를 적용하지 않는다.

## 10. 타임라인과 재생목록 계약

B 토글 전후 다음 값은 정확히 동일해야 한다.

- videoPlayer.engine
- currentFile
- duration
- totalFrames
- fps
- playlist current index
- continuous timeline duration
- continuous segment mapping
- timeline zoom과 scroll

재생 위치는 재생 상태에 맞춰 다음 계약을 사용한다.

- 일시정지 상태에서는 currentTime과 currentFrame이 동일해야 한다.
- 재생 상태에서는 토글에 걸린 실제 시간만큼 자연스럽게 전진해야 한다.
- 토글 코드가 seek를 호출하거나, 예상 자연 진행량을 뺀 뒤 1 video frame을 넘는 불연속을 만들면 실패다.

B 토글은 drawing tool UI를 제외한 타임라인 DOM을 다시 만들지 않는다.

재생목록에서 파일이 전환될 때:

1. 기존 MPVOverlayHost 창은 유지한다.
2. 더 큰 videoGeneration과 inputRevision을 가진 enabled:false 요청을 보낸다. Host는 새 videoGeneration의 disable만 예외적으로 수락해 가장 먼저 click-through로 전환하고 이전 session을 무효화한다.
3. 이전 videoGeneration과 sessionId의 늦은 invoke 응답을 폐기한다.
4. 새 영상 metadata가 확정되기 전에는 입력을 통과시킨다.
5. draw mode 유지가 아직 원하는 상태라면 새 sessionId와 targetFrame을 만들고 preparing으로 전환한다.
6. metadata와 bounds가 준비되고 같은 세 토큰이 확인되면 active 상태를 복구한다.

이 설계는 드로잉 때문에 발생하는 창 재생성과 엔진 재로드를 제거한다. mpv 자체의 다음 파일 로드 간격은 별도 재생목록 개선 범위로 남는다.

## 11. 최종 drawingsV3 모델

첫 시험판은 이 형식을 파일에 쓰지 않는다. 이후 저장 단계가 승인되면 다음 형식을 공식 원본으로 사용한다.

~~~json
{
  "bframeVersion": "2.0",
  "reviewDocumentId": "reviewdoc-uuid",
  "drawings": {
    "layers": [],
    "activeLayerId": null,
    "totalFrames": 240,
    "fps": 24
  },
  "drawingsV3": {
    "schemaVersion": "3.0.0",
    "documentId": "drawdoc-uuid",
    "engine": "baeframe-drawing",
    "coordinateSpace": {
      "unit": "source-pixel",
      "origin": "top-left",
      "yAxis": "down",
      "pixelRatio": 1,
      "width": 3840,
      "height": 2160
    },
    "timebase": {
      "fpsNumerator": 24,
      "fpsDenominator": 1,
      "totalFrames": 240
    },
    "revision": {
      "id": "revision-uuid",
      "parentId": "previous-revision-uuid",
      "sequence": 42,
      "actorId": "session-uuid",
      "commandId": "command-uuid",
      "commandType": "add-objects",
      "committedAt": "2026-07-17T12:00:00.000Z",
      "contentHash": "sha256:content-hash"
    },
    "layers": [
      {
        "id": "layer-1",
        "name": "드로잉 1",
        "visible": true,
        "locked": false,
        "opacity": 1,
        "keyframes": [
          {
            "id": "keyframe-1",
            "frame": 120,
            "empty": false,
            "revision": 8,
            "objects": []
          }
        ]
      }
    ]
  }
}
~~~

기존 drawings 값은 opaque subtree로 취급해 원문 의미를 보존한다. 새 앱은 v2 drawings를 렌더하지 않는다. 저장할 때 DrawingManager로 다시 export한 값으로 교체해서도 안 된다.

첫 저장 가능 릴리스는 top-level bframeVersion을 2.0으로 유지하고 drawingsV3의 자체 SemVer로 새 형식을 구분한다. 전체 .bframe envelope을 3.0으로 올리는 작업은 기존 앱의 unknown-field 보존이 충분히 배포된 뒤 별도 호환성 프로젝트로 수행한다.

active layer, 선택 객체, hover, 도구, marquee, transform preview, clipboard는 UI 상태이므로 drawingsV3에 저장하지 않는다.

### 11.1 공통 객체

~~~json
{
  "id": "object-uuid",
  "type": "stroke",
  "visible": true,
  "locked": false,
  "opacity": 1,
  "blendMode": "source-over",
  "transform": [1, 0, 0, 1, 0, 0]
}
~~~

transform은 2D affine matrix [a, b, c, d, e, f]다. Fabric의 left, top, scaleX, angle 속성을 공식 저장값으로 사용하지 않는다.

### 11.2 StrokeObject

~~~json
{
  "id": "stroke-uuid",
  "type": "stroke",
  "tool": "brush",
  "points": [
    { "x": 100.25, "y": 220.5, "pressure": 0.42, "time": 0 },
    { "x": 102.5, "y": 222.25, "pressure": 0.51, "time": 8 }
  ],
  "style": {
    "color": "#ff5555",
    "size": 12,
    "thinning": 0.5,
    "smoothing": 0.5,
    "streamline": 0.5,
    "outlineColor": null,
    "outlineWidth": 0
  },
  "transform": [1, 0, 0, 1, 0, 0]
}
~~~

### 11.3 ShapeObject

지원 kind:

- line
- arrow
- rectangle
- ellipse

geometry는 kind별 원본 점을 저장하고 transform은 별도 보존한다.

### 11.4 MaskObject

픽셀 지우개는 기존 객체를 평면화하지 않는다. 대상마다 subtract mask를 만들어 비파괴로 가린다.

~~~json
{
  "id": "mask-uuid",
  "type": "mask",
  "targetId": "stroke-uuid",
  "mode": "subtract",
  "space": "target-local",
  "geometry": {
    "kind": "pressure-stroke",
    "points": [],
    "size": 24,
    "hardness": 1
  },
  "transform": [1, 0, 0, 1, 0, 0]
}
~~~

mask는 같은 keyframe의 일반 객체 하나만 대상으로 삼는다. 대상이 이동·회전·확대되면 target-local mask도 함께 변형된다. 여러 객체를 한 번에 지우면 대상별 mask를 만들되 한 add-mask command로 묶는다. 대상 삭제 시 연결된 mask도 같은 command에서 삭제한다. mask가 다른 mask를 대상으로 삼을 수 없다.

### 11.5 RasterObject

이미지 붙여넣기와 외부 캡처에만 사용한다.

- 파일 내부 data URL 또는 content-addressed asset ID
- 원본 width와 height
- transform
- opacity

SVG와 외부 네트워크 URL은 공식 객체로 허용하지 않는다.

## 12. 레이어와 키프레임

- 각 레이어는 frame 오름차순 keyframe 배열을 가진다.
- keyframe 사이에는 현재 BAEFRAME과 동일한 hold 의미를 사용한다.
- empty keyframe은 이전 hold를 끊는다.
- 활성 프레임 편집은 실제로 표시되는 source keyframe을 대상으로 한다.
- hold frame에서 첫 새 획을 시작하면 현재 frame에 새 keyframe을 만들어 원본을 복사한다.
- 레이어 잠금 상태에서는 pointer 입력과 command commit을 모두 거부한다.
- 레이어 opacity 0은 값 0으로 보존한다.
- 선택 상태, hover, control handle은 파일에 저장하지 않는다.

## 13. 선택과 변형

V 도구는 첫 시험 단계에서 두 가지 명시적 선택 프리셋을 제공한다.

- `획`: 클릭 또는 사각 드래그로 닿은 StrokeObject 전체를 선택하고 이동한다.
- `라쏘`: 자유형 영역에 닿은 StrokeObject의 실제 보이는 부분을 분리해 선택하고 이동한다.
- 두 프리셋은 Alt 같은 보조키에 의존하지 않는다. 현재 프리셋은 B/V 전환 뒤에도 유지하지만 리뷰 데이터에는 저장하지 않는다.

### 13.1 클릭 선택

- Fabric hit testing으로 최상위 객체를 선택한다.
- Shift는 선택 추가 및 제거다.
- 선택만 바뀐 경우 revision과 dirty 상태를 변경하지 않는다.

### 13.2 사각형 선택

- 드래그 사각형과 객체 bounding box가 교차하면 선택한다.
- 완전히 포함된 객체만 선택하는 별도 모드는 두지 않는다.
- locked 객체는 선택 대상에서 제외한다.
- 기본 드래그는 닿은 객체 전체를 선택한다.
- 사각형 부분 분리는 후속 프리셋으로 추가하며 자유형 라쏘와 같은 split command를 사용한다.

### 13.3 자유형 라쏘

라쏘 polygon과 transform이 적용된 실제 렌더 outline이 교차하는지 계산한다. bounding box만으로 최종 hit를 확정하지 않는다.

- `라쏘` 프리셋의 기본 동작은 자유선 획 부분 분리다.
- pressure와 brush size에 따른 실제 반폭까지 hit 판정에 포함한다.
- 화면 약 1.5px 범위에서 입력 polygon을 단순화하고 stroke bounding box로 먼저 거른 뒤 정밀 판정한다.
- 면적이 없는 선형 입력은 취소하며, 과도한 fragment가 예상되면 원본을 유지한 채 작업을 중단한다.
- 라쏘를 놓아 선택만 한 시점에는 원본 획의 lower-canvas 픽셀이 한 픽셀도 달라지지 않아야 한다.
- 선택 직후에는 원본 Fabric path를 비상호작용 시각 bridge로 유지하고, fragment는 투명한 hit/transform 객체로 준비한다.
- 첫 실제 `object:moving`에서만 시각 bridge를 제거하고 fragment를 표시한다. 단순 클릭과 무이동 release는 실체화로 취급하지 않는다.
- 이동 없이 새 라쏘, 도구/선택 프리셋 전환, B 해제, session 변경, pointer cancel 또는 blur가 발생하면 준비된 split을 원본으로 되돌리고 투명 객체를 모두 제거한다.
- 라쏘 pointerup만으로 Fabric scene 전체를 clear/rebuild하지 않는다. 선택 순간의 영상 깜빡임과 객체 정체성 손실을 막기 위해서다.

### 13.4 획 부분 분리

StrokeObject의 원본 points를 선택 polygon 안팎 경계에서 분할한다. 선택 polygon은 자유형 라쏘 또는 사각형일 수 있다.

1. 객체 transform의 역행렬로 선택 polygon을 획의 local 좌표로 옮긴다.
2. pressure에 따른 실제 반폭을 고려해 centerline과 렌더 outline의 교차를 판정한다.
3. 각 선분과 polygon 경계 교차점을 계산한다.
4. 교차점의 x, y, pressure, time을 보간해 원본 point 배열에 삽입한다.
5. inside와 outside 연속 구간을 별도 StrokeObject로 만든다.
6. 2점 미만이거나 화면 길이 1 source pixel 미만인 조각은 폐기한다.
7. 원본 획 제거와 새 조각 추가를 한 split-stroke command로 묶는다.
8. 여러 원본을 동시에 분할할 때 각 원본 위치에 fragment를 삽입해 기존 z-order를 유지한다.
9. fragment 하나라도 생성에 실패하면 전체 command를 취소하고 모든 원본을 유지한다.
10. 실제 분할이 표시될 때 원래 획의 바깥 시작/끝 cap은 유지하고 내부 절단 경계는 flat cap으로 만들어 반투명 fragment의 겹침 이음매를 막는다.

도형과 RasterObject의 부분 선택은 geometry split이 아니라 MaskObject로 처리한다.

## 14. 명령과 Undo/Redo

모든 저장 가능한 변경은 DrawingCommand다.

~~~js
{
  id,
  actorId,
  baseRevision,
  target: { layerId, keyframeId, frame },
  kind,
  operations,
  inverseOperations,
  createdAt
}
~~~

command kind:

- add-objects
- delete-objects
- transform-objects
- split-stroke
- add-mask
- clear-keyframe
- create-keyframe
- delete-keyframe
- update-layer
- reorder-layer

규칙:

- pointerdown과 pointermove는 transient 상태다.
- pointerup에서 실제 데이터 차이가 있을 때만 command를 만든다.
- 클릭 선택은 command가 아니다.
- drag가 시작점과 같은 위치에서 끝나면 command가 아니다.
- 한 번의 드래그는 한 번의 Undo다.
- Undo/Redo는 DrawingEngineAdapter의 공개 API만 호출한다.
- app.js가 manager private 필드를 직접 호출하지 않는다.
- 원격 command는 로컬 Undo stack에 넣지 않는다.

## 15. 저장과 데이터 안전

### 15.1 첫 시험판

- 리뷰 데이터 dirty 이벤트를 발생시키지 않는다.
- ReviewDataManager에 새 drawing manager를 연결하지 않는다.
- 앱 종료 시 session scene은 사라진다.
- 사용자는 active 동안 overlay pilot toolbar의 저장 안 됨 표식을 항상 볼 수 있다.

### 15.2 v3 저장 단계

v3 저장은 다음 순서로 수행한다.

1. 파일 경로별 in-process mutex와 cooperating 신버전 앱이 공유하는 cross-process lock을 획득한다.
2. 최신 disk 파일을 다시 읽어 전체 fingerprint와 drawingsV3 head revision을 확인한다.
3. disk head가 메모리 base revision과 다르면 overwrite하지 않고 conflict로 중단한다.
4. 최신 root 객체를 복사해 comments, highlights, compositionLayers, manualVersions, versionInfo, liveblocksRoomId 및 알 수 없는 최상위 필드를 보존한다.
5. 기존 drawings subtree의 canonical hash가 바뀌지 않았는지 확인한다.
6. opaque-field 보존 codec으로 검증된 drawingsV3와 reviewDocumentId만 갱신한다.
7. 같은 디렉터리에 unique main temp 파일을 쓰고 file handle을 flush한 뒤 다시 읽어 JSON parse, schema, content hash를 검증한다.
8. transactionId, base main fingerprint, target main fingerprint, reviewDocumentId, legacyAnchorHash, target drawingsV3 revision/hash/snapshot을 가진 recovery sidecar를 prepared 상태로 먼저 원자 기록·flush·재검증한다.
9. 현재 main 전체를 transaction 전용 rollback backup에 원자 복사하고 flush한 뒤, 그 hash가 step 2의 base main fingerprint와 정확히 같은지 검증한다.
10. main을 즉시 다시 읽어 fingerprint를 비교한다. step 2 이후 바뀌었으면 temp와 transaction을 폐기하고 최신 파일에서 재시작한다.
11. expected base fingerprint와 target temp를 받는 platform atomic compare-and-replace helper를 호출한다. helper는 짧은 exclusive file transaction 안에서 expected fingerprint를 다시 확인하고 원본을 먼저 삭제하지 않은 채 교체한다.
12. exclusive compare-and-replace를 제공할 수 없거나 다른 process가 파일을 잡고 있으면 write를 시도하지 않고 conflict로 중단한다.
13. 교체된 main 파일을 다시 읽어 target fingerprint, reviewDocumentId, revision, drawingsV3 content hash를 확인한다.
14. step 13이 실패하면 검증된 transaction rollback backup을 main으로 원자 복원하고 base fingerprint가 돌아왔는지 확인한다.
15. rollback 복원도 실패하면 main, temp, sidecar, backup을 삭제하지 않고 치명적 저장 배너를 표시하며 추가 자동 저장을 중단한다.
16. main 검증 성공 뒤 recovery sidecar를 committed 상태로 원자 갱신한다. 이 상태 갱신이 실패해도 prepared sidecar에는 전체 복구 데이터가 이미 있어야 한다.
17. cross-process lock과 mutex를 해제한다.
18. committed main과 recovery가 검증되고 메모리 head가 저장한 revision과 같을 때만 dirty를 해제한다.

rollback backup 경로는 기존 일반 `.bak`과 섞지 않는 `<review>.bframe.rollback.<transactionId>.bak`을 사용한다. startup recovery는 prepared sidecar의 base/target fingerprint와 실제 main을 비교한다. main이 target이면 sidecar를 committed로 마무리하고, main이 base면 미완료 temp만 정리하며, 둘 다 아니면 자동 덮어쓰기 없이 복구 화면을 연다.

첫 v3 저장 전 rollback backup 또는 prepared recovery sidecar 생성·검증에 실패하면 main 파일을 교체하지 않는다.

### 15.3 구버전과 unknown field 보존

현재 dc09056 앱은 ReviewDataManager._collectData()에서 알려진 필드만 다시 구성하므로, 이미 배포된 앱이 파일을 열고 저장하면 drawingsV3를 제거할 수 있다. 새 저장 기능보다 먼저 다음 bridge 동작을 배포해야 한다.

- load 시 원본 root의 알 수 없는 필드를 보관한다.
- save 시 최신 disk root에 알고 있는 필드만 갱신한다.
- drawingsV3를 이해하지 못해도 원문을 통과시킨다.
- review 파일 계보를 식별하는 top-level reviewDocumentId를 known field로 생성·보존한다.
- 지원하지 않는 top-level major version은 자동 하향 변환하지 않는다.

bridge는 V3 writer가 없는 별도 선행 릴리스인 Phase 2A로 먼저 배포한다. unknown-field round-trip과 reviewDocumentId 보존이 확인되기 전에는 Phase 2B의 drawingsV3 write flag를 켜지 않는다.

bridge 이전 구버전에 대한 복구 사본은 다음 경로를 사용한다.

~~~text
<review-name>.bframe.drawings-v3.bak
~~~

recovery sidecar는 reviewDocumentId, drawingsV3 documentId, legacyAnchorHash, video identity, transactionId, base/target main fingerprint, revisionId, drawingsV3 contentHash, savedAt, drawingsV3 snapshot을 가진다.

main에서 drawingsV3만 사라지고 reviewDocumentId가 sidecar와 일치하면 최신 댓글과 v2 데이터를 유지한 채 drawingsV3 자동 복구를 제안할 수 있다. pre-bridge 구버전 저장으로 reviewDocumentId까지 사라졌다면 자동 복구하지 않는다. 같은 base filename의 인접 sidecar이고 `createdAt + videoFile + fps`의 legacyAnchorHash와 가능한 media fingerprint가 일치할 때만 수동 복구 후보로 보여주며 사용자 확인을 요구한다. 식별이 하나라도 모호하면 main을 건드리지 않는다.

drawingsV3의 지원 minor unknown field는 root뿐 아니라 layer, keyframe, object, style, geometry, mask의 각 ID node에서 보존한다. decoder는 원본 node별 opaque field를 별도 보관하고, encoder는 알려진 canonical field만 갱신해 원본 node 위에 합성한다. 알려진 field가 우선하며 삭제된 node의 opaque field는 함께 삭제한다. 새 node에는 임의 unknown field를 만들지 않는다. Fabric JSON으로 전체 subtree를 재생성하지 않는다.

### 15.4 저장 실패 UX

- 첫 실패: 화면 알림 없이 dirty 유지, 250ms 후 재시도
- 두 번째 실패: 1초 후 재시도
- 세 번째 실패: 3초 후 재시도
- 최종 실패: 닫을 수 없는 저장 실패 배너와 수동 재시도 버튼 표시
- 선택 클릭이나 hover에서는 저장 경로가 실행되지 않으므로 실패 알림이 발생할 수 없다.

### 15.5 검증과 방어 한도

저장 직전과 다시 열 때 다음을 검증한다.

- schemaVersion은 SemVer이며 지원하지 않는 major는 read-only로 연다.
- 모든 숫자는 finite이고 source 크기와 timebase 분모는 0보다 커야 한다.
- ID는 문서 안에서 해당 type 범위에 유일해야 한다.
- layer keyframe은 frame 오름차순이며 중복 frame을 허용하지 않는다.
- frame은 0 이상 totalFrames 미만의 정수다.
- opacity는 0부터 1이고 0도 유효한 값이다.
- transform은 길이 6의 affine matrix이고 determinant 절댓값이 1e-8 이하인 singular matrix는 거부한다.
- mask target은 같은 keyframe의 일반 객체여야 한다.
- 알 수 없는 지원 minor 필드와 extensions는 통과 보존한다.
- contentHash는 revision 식별자, writer 정보, 시간 필드를 제외한 canonical key-sorted drawingsV3 content의 SHA-256이다.

운영 방어 한도는 최대 128 layers, layer당 10,000 keyframes, keyframe당 10,000 objects, 한 stroke당 100,000 points, drawingsV3 64MiB다. 한도를 넘은 파일은 데이터를 잘라내지 않고 read-only로 연다. UI 입력의 더 낮은 한도인 한 획 20,000 points와 한 활성 keyframe 10,000 objects는 별도로 적용한다.

## 16. 렌더링과 성능

### 16.1 활성 프레임

- 활성 keyframe 한 개만 Fabric interactive Canvas에 올린다.
- 활성 레이어 이외 객체는 selectable과 evented를 false로 둔다.
- 화면 밖 객체는 hit testing 대상에서 제외한다.
- 브러시 transient outline은 Fabric object를 매 pointermove마다 새로 만들지 않고 한 preview path를 갱신한다.

### 16.2 비활성 프레임과 재생

- 비활성 keyframe은 StaticCanvas 또는 ImageBitmap 캐시로 렌더한다.
- 재생 중에는 Fabric control과 hit testing을 끈다.
- keyframe hold가 바뀔 때만 정적 장면을 교체한다.
- 재생 프레임마다 PNG Data URL을 만들지 않는다.
- 캐시는 LRU로 관리한다.
- 캐시 상한은 12 keyframe 또는 128 MiB 중 먼저 도달한 값이다.

### 16.3 어니언 스킨

- 앞·뒤 keyframe을 정적 bitmap으로 렌더한다.
- onion opacity는 사용자 설정을 따른다.
- onion bitmap은 pointer hit testing에서 제외한다.

### 16.4 좌표

공식 좌표는 영상 원본 픽셀이다.

- viewport CSS 좌표에서 source 좌표로 변환
- letterbox와 pillarbox offset 반영
- zoom과 pan transform 반영
- Windows devicePixelRatio 변화 반영
- 모니터 이동 중 pointer stroke는 취소하고 새 bounds 적용 후 다시 입력 허용

## 17. 오류 처리와 복구

### 17.1 surface 준비 실패

- mpv는 그대로 둔다.
- HTML5로 전환하지 않는다.
- draw mode를 active로 표시하지 않는다.
- 사용자가 B를 눌렀을 때 한 번만 “새 드로잉 화면을 준비하지 못했습니다” 오류를 표시한다.
- 자세한 원인은 로그에 기록한다.
- surface가 준비되지 않은 상태의 disable 요청은 bundle read나 injection을 시작하지 않는다.
- 같은 generation의 동시 enable은 하나의 준비 promise를 공유한다.
- DOM append, Canvas 생성 또는 listener 등록 중 준비가 실패하면 생성된 container, Canvas, observer와 모든 listener를 완전히 rollback한 뒤에만 재시도를 허용한다.
- transient 실패 뒤 enable 재시도는 250ms, 500ms, 1,000ms, 최대 2,000ms의 지수 backoff를 적용한다.
- 준비 성공 또는 새 host generation에서는 failure count와 backoff를 초기화한다.

### 17.2 Fabric runtime 오류와 overlay renderer crash

- setIgnoreMouseEvents(true) 상태로 전환한다.
- Fabric 초기화 또는 API 오류는 기존 passive overlay 실패로 승격하지 않는다.
- Fabric capability만 false로 만들고 mpv와 passive mirror를 유지한다.
- 실제 overlay renderer crash는 기존 MPVOverlayHost 복구 정책을 따르되, 복구된 창은 항상 click-through에서 시작한다.
- 같은 generation의 IIFE 재주입은 준비 실패 backoff가 지난 enable에서만 허용한다.
- Phase 0의 overlay crash에서는 저장되지 않은 시험 그림이 유실됐음을 한 번 알리고 빈 session으로 복구한다. 영상과 리뷰 파일에는 영향이 없어야 한다.
- Phase 1부터 BAEFRAME 객체 모델의 command journal로 scene을 재구성한다.
- 반복 crash면 현재 세션을 failed로 두고 자동 재시도하지 않는다.

### 17.3 오래된 메시지

hostGeneration, videoGeneration, inputRevision, sessionId 중 필요한 값 하나라도 현재 값과 다르면 폐기한다. toolRevision은 같은 session에서 작은 값이면 폐기하고, actionId는 처리 완료 LRU에 있으면 재적용하지 않는다.

### 17.4 pointer 취소

다음 이벤트에서는 transient stroke와 transform을 취소한다.

- pointercancel
- lostpointercapture
- window blur
- surface bounds 변경
- 영상 파일 변경
- B 종료

취소된 입력은 command와 dirty 이벤트를 만들지 않는다.

## 18. 협업

첫 시험판에서는 Liveblocks 연결 중 새 드로잉 시험판을 비활성화한다. 저장되지 않고 동기화되지 않는 그림을 협업자에게 보이는 것처럼 오해하게 만들지 않기 위해서다.

정식 v3 협업은 별도 DRAWING_V3 프로토콜을 사용한다.

- room handshake에 drawingProtocolVersion 포함
- 같은 버전 사용자만 v3 드로잉 편집 허용
- 다른 버전 사용자는 댓글 협업은 유지하되 드로잉은 읽기 전용
- stroke preview는 transient
- pointerup command는 revision과 hash 포함
- 동일 keyframe revision 충돌은 명시적으로 rebase 또는 reject
- 전체 PNG Broadcast를 공식 동기화 원본으로 사용하지 않음
- late join은 document snapshot 후 command stream 적용

## 19. 보안

- overlay renderer에서 Node API를 노출하지 않는다.
- Phase 0에는 overlay preload를 추가하지 않는다. Phase 1 이후 추가할 때도 고정된 drawingSurface API만 노출한다.
- sender webContents ID를 검사한다.
- Fabric bundle은 app.asar 안의 고정 경로에서만 읽고 CDN, 외부 URL, 사용자 파일에서 코드를 불러오지 않는다.
- 배포 빌드 테스트에서 bundle SHA-256과 예상 build manifest를 대조한다.
- SVG, 외부 URL, 임의 script가 포함된 객체 import를 허용하지 않는다.
- command payload의 type, 숫자 범위, 배열 길이를 검증한다.
- NaN, Infinity, 음수 크기, 잘못된 transform을 거부한다.
- 로그에 전체 그림 데이터와 파일 경로를 불필요하게 기록하지 않는다.

Phase 0은 기존 MPVOverlayHost의 data URL 문서와 현재 BrowserWindow 보안 옵션을 넓히지 않고 그대로 사용한다. 기본 기능으로 승격하기 전에는 overlay HTML과 runtime을 패키지 내부의 로컬 문서 또는 전용 app protocol로 옮기고, 현재 합성 레이어의 file URL 요구를 대체한 뒤 webSecurity 활성화와 CSP 적용 가능성을 별도 보안 gate로 검증한다.

## 20. 기능 플래그와 되돌리기

### 20.1 활성화

effective pilot flag 우선순위는 다음과 같다.

1. --disable-fabric-drawing-pilot 또는 BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT=1이면 항상 OFF
2. --fabric-drawing-pilot이면 ON
3. BAEFRAME_FABRIC_DRAWING_PILOT=1이면 ON
4. 나머지는 OFF

플래그는 main process가 시작할 때 한 번만 결정한다. preload에는 결과 boolean만 노출하고 원본 환경변수와 argv는 노출하지 않는다. 첫 시험판은 설정 화면과 localStorage에 이 값을 저장하지 않는다.

기본값은 false다. 배포본에서 자동으로 true가 되지 않는다. 공유 드라이브에는 배포하지 않고 분리 프로필의 로컬 앱으로만 실행한다.

~~~powershell
npm.cmd start -- --fabric-drawing-pilot --multi-instance-profile fabric-pilot-dc09056
~~~

로컬 directory build 시험:

~~~powershell
.\dist\win-unpacked\BFRAME_alpha_v2.exe --fabric-drawing-pilot --multi-instance-profile fabric-pilot-dc09056
~~~

### 20.2 비활성 상태

플래그가 false면:

- 기존 MPVOverlayHost는 현재 main과 동일하게 passive mirror만 제공한다.
- Fabric IIFE를 overlay 문서에 주입하지 않는다.
- 추가 canvas와 pointer listener를 만들지 않는다.
- 기존 드로잉 및 mpv 흐름은 현재 main과 동일하다.

### 20.3 시험판 제거

시험판 제거는 다음 변경만 되돌리면 된다.

- fabric dependency와 bundle script
- MPVOverlayHost Fabric capability
- 신규 overlay drawing IPC와 main renderer preload 노출
- Fabric overlay runtime
- pilot controller
- pilot badge
- pilot tests

첫 시험판은 파일 형식을 바꾸지 않으므로 데이터 rollback이 필요 없다.

## 21. 진단과 측정

사용자에게 성공 토스트를 띄우지 않고 로그와 개발 진단 패널에 다음 값을 기록한다.

- MPVOverlayHost create count와 hostGeneration
- Fabric IIFE injection count
- B interactive on/off count
- B toggle elapsed time
- player engine before/after
- currentFile before/after
- currentFrame before/after
- mpv child PID, mpv loaded file, mpv paused state
- 모든 HTMLMediaElement의 src와 paused 상태
- 계산된 active playback owner count
- duration, totalFrames, fps, playlist index, continuous duration와 segment mapping, timeline zoom과 scroll의 canonical snapshot hash
- timeline DOM marker, drawing keyframe, comment marker 개수
- ReviewDataManager _onDataChanged, saveReview, saveError와 save-error toast 호출 count
- pointer-to-preview latency p50/p95
- command commit latency p50/p95
- 실제 pressure 범위와 light/heavy 중앙 폭 비율
- Fabric object count
- cached keyframe count와 bytes
- renderer working set
- surface crash count
- stale message drop count

mpv 성공 메시지 “mpv 엔진을 BAEFRAME 영상 영역에 연결했습니다.”는 제거한다. 실패 및 폴백 알림은 유지한다.

이 성공 메시지 제거는 pilot 플래그와 무관한 기본 UX 수정이다. pilot를 제거하거나 비활성화해도 성공 메시지는 다시 표시하지 않는다.

## 22. 시험 기준

### 22.1 자동 테스트

#### MPVOverlayHost Fabric capability

- 기본은 setIgnoreMouseEvents(true)
- active에서만 false
- B 100회에서 BrowserWindow 생성 횟수 1
- B 100회 동안 추가 BrowserWindow construct, loadURL, setBounds, show, hide, moveTop, destroy 호출 0
- parent move, resize, fullscreen, minimize, restore 추적
- Fabric IIFE 실패여도 기존 mirror API는 ready
- Fabric 실패가 mpv overlay recovery의 HTML5 fallback을 시작하지 않음
- overlay crash 복구 뒤 기본 상태는 click-through
- 잘못된 sender와 payload 거부
- destroy 후 늦은 load 완료 무시

#### Mode controller

- B 진입에서 pause, loadVideo, HTML5 src 변경 호출 없음
- B 종료에서 mpv load 호출 없음
- B 진입·종료와 간접 play/pause, time, resize 이벤트에서 requiresMpvReviewFreeze가 false
- preparing 중 B 취소와 영상 전환 뒤 늦은 enable 응답이 입력을 다시 켜지 않음
- B는 도구와 무관하게 직접 토글
- 기존 DrawingCanvas input 비활성
- old drawingDataUrl mirror 비활성
- paused timeline state 불변, playing timeline은 seek 없이 자연 진행
- surface 실패가 player state를 바꾸지 않음
- pilot preparing/active의 전체 legacy drawing mutation 단축키와 UI가 DrawingManager·ReviewDataManager를 호출하지 않음
- pilot active의 Delete와 Clear는 선택 유무와 관계없이 기존 DrawingManager·keyframe 경로를 호출하지 않음
- pilot active에서 선택 없는 Delete는 no-op
- 입력창, 댓글 편집기, 설정창에서는 B, V, Delete, Space를 가로채지 않음
- B, Space, playlist 전환의 playback ownership trace에서 active owner count가 항상 0 또는 1이고 재생 중에는 정확히 1
- mpv가 owner일 때 모든 HTMLMediaElement는 paused이고 추가 mpv child PID가 생기지 않음

#### Session scene

- pressure point round-trip
- 선택 click은 dirty false
- 실제 이동은 command 한 개
- 0거리 이동은 command 없음
- Delete는 선택 객체만 삭제
- pointercancel은 객체와 command를 남기지 않음
- stable video identity + targetFrame cache와 videoGeneration 격리
- 같은 actionId의 Delete/Clear 중복 적용 방지

#### No-save integration

- 복사한 실제 `.bframe` fixture의 시작 hash, mtime, size를 기록
- B 진입, V 선택·해제 100회, 이동·Delete·Clear, B 종료, 파일 전환을 수행
- autosave debounce 시간에 500ms를 더해 기다린 뒤 ReviewDataManager _onDataChanged, saveReview, saveError, 저장 오류 toast가 모두 0회
- 종료 뒤 `.bframe` hash, mtime, size가 모두 시작값과 동일
- 하나라도 다르면 Phase 0 No-Go
- B 종료 응답에 전체 scene 또는 Fabric JSON이 포함되지 않음

#### Phase 2 저장 gate

- bridge-only 앱에서 알 수 없는 top-level과 모든 nested V3 opaque field round-trip hash 불변
- V3를 모르는 bridge 앱 저장 뒤 drawingsV3와 reviewDocumentId hash 불변
- pre-bridge 저장으로 둘 다 소실됐을 때 자동 복구 금지와 수동 candidate 판정 확인
- prepared sidecar write, flush, verify, rollback backup, compare-and-replace, main verify, sidecar commit 각 단계에 crash와 오류 주입
- crash 뒤 main은 검증된 base 또는 target 중 하나이고, recovery/rollback 자료가 모두 남아 있음
- 두 app process 동시 저장에서 한쪽만 commit하고 다른 쪽은 conflict·retry하며 non-drawing field 손실 0
- compare-and-replace 직전 외부 수정에서 CAS 실패, 최신 comments·legacy drawings·unknown fields 보존
- main post-verify 실패 시 검증된 rollback backup 복원과 base fingerprint 일치
- rollback도 실패하면 자동 저장 중단, 관련 네 파일 보존, 치명적 배너 표시

#### Regression

- npm run test:drawing
- npm run test:mpv
- npm run test:playlist
- npm run test:hybrid
- npm run lint
- npm run build

### 22.2 실제 앱 입력 시험

환경:

- Windows 10 또는 11
- 100%, 125%, 150%, 200% 화면 배율
- 단일 모니터와 서로 다른 배율의 다중 모니터
- 마우스
- Windows Ink 펜
- 창 모드와 전체화면
- 1080p, 4K 영상
- 24, 30, 60fps

시나리오:

1. 재생 중 B 100회
2. 일시정지 중 B 100회
3. B active 상태에서 재생과 일시정지 반복
4. 재생 중 B 진입 frame의 targetFrame 고정과 재생 연속성 확인
5. V 클릭 선택만 100회
6. 선택 이동, 삭제, 취소
7. 전체화면 진입과 종료 중 그리기
8. 다른 배율 모니터로 창 이동
9. 재생목록 10개 파일 연속 전환
10. Fabric runtime 예외와 overlay renderer 강제 종료 후 복구
11. 500개 획
12. 2,000개 획
13. 30분 연속 사용

플래그 OFF와 ON은 같은 기기와 같은 영상에서 각각 3회 실행하고 중앙값과 p95를 비교한다.

B 깜빡임 검사는 frame 번호와 움직이는 패턴이 매 frame 다른 전용 영상으로 수행한다. B 100회를 60fps 이상 연속 녹화하고, 녹화 frame 분석과 host visibility trace를 함께 사용한다. 검은 frame, 정지 image 삽입, wrapper 크기 변화, 예상 밖 duplicate frame이 0이어야 한다. 정지 화면 한 장은 통과 증거로 인정하지 않는다.

중복 재생 검사는 화면 녹화와 별개로 매 playback state change마다 ownership snapshot을 남긴다. active owner는 mpv와 실제 재생 중인 HTMLMediaElement의 합이며 어느 순간에도 1을 넘을 수 없다. mpv PID는 B 토글 때문에 추가되거나 바뀌면 안 되고, mpv owner 상태에서 HTMLMediaElement는 모두 paused여야 한다. B 연타, Space 연타, playlist 경계가 겹친 trace까지 포함한다.

재생목록 시험은 다음 조합을 pairwise 이상으로 포함한다.

- 일반 재생목록과 연속 타임라인
- autoplay on과 off
- HTML5 가능 코덱과 mpv 전용 코덱이 섞인 10개 항목
- 자동 다음 항목, 수동 다음·이전, 마지막→첫 항목
- B passive, preparing, active 각각의 전환 경계
- 항목을 빠르게 연속 선택한 stale load 경합

각 전환마다 current item, segment mapping hash, playback owner count, host/video/input token, stale response drop, stableVideoIdentity별 시험 scene 격리, ReviewDataManager save count를 기록한다. 성공률 100%, 다른 항목의 시험 획 혼입 0, 저장 시도 0이어야 한다.

B active 상태에서는 키보드뿐 아니라 실제 마우스로 재생 버튼, 재생바, 타임라인, 다음·이전 항목을 조작한다. MPVOverlayHost가 어느 하나라도 가로막으면 현재 단일-host Phase 0은 No-Go다.

2026-07-17 Phase 0A 실제 앱 시험에서는 실제 마우스 Brush, 사각 선택, 선택 이동, Delete와 overlay 포커스 상태의 B/V/Space 단축키 전달이 통과했다. 재생 중 B 100회는 100ms 간격에서 정확히 100회 처리됐고, 60fps 녹화 분석에서 완전 검은 구간은 0회였다. 반면 영상 내부 확대/축소 버튼은 active overlay에 가로막혔다. 실제 Windows Ink 펜, 실제 Fabric 장면의 500/2,000획 선택·이동 fps, 다중 DPI 모니터와 장시간 soak는 아직 통과 증거가 없다. 상세 수치는 결과 문서를 기준으로 한다.

### 22.3 수치 기준

- pilot OFF에서 Fabric bundle read·injection·canvas·pointer listener 생성: 0
- pilot OFF의 시작 시간 중앙값 증가: pilot 없는 기준 build 대비 10ms 이하
- B 토글로 인한 mpv load 호출: 0
- B 토글로 인한 HTML5 load 또는 src 변경: 0
- B 토글로 인한 pause 호출: 0
- B 토글 중 MPVOverlayHost BrowserWindow 재생성: 0
- 중복 재생 인스턴스: 0
- playback ownership snapshot의 active owner count 최대값: 1
- B 토글로 인한 mpv child PID 추가·교체: 0
- mpv owner 중 playing HTMLMediaElement: 0
- 눈에 보이는 검은색 또는 정지 프레임 삽입: 0
- B warm toggle p95: 50ms 이하
- 최초 surface 준비: 500ms 이하
- pointer-to-preview p50: 16.7ms 이하
- pointer-to-preview p95: 33ms 이하
- 500개 획에서 클릭·사각 선택 응답 p95: 50ms 이하
- 2,000개 획에서 클릭·사각 선택 응답 p95: 100ms 이하
- 500개 획 초기 장면 준비: 750ms 이하
- 2,000개 획 초기 장면 준비: 3초 이하
- 실제 펜 pressure 관측 범위: 0.4 이상
- 약한 획과 강한 획의 중앙 폭 비율: 1.8 이상
- 500개 획 이동 중: 55fps 이상
- 2,000개 획 이동 중: 30fps 이상
- 4K 60초 재생의 dropped-frame 비율 증가: pilot off 대비 1%p 이하
- 30분 후 overlay renderer working set: 안정화 시점 대비 100MiB 이내
- 빈 장면에서 B 100회 후 안정화 메모리 증가: 30MiB 이하
- frame 좌표 오차: 1 source pixel 이하
- 예상 자연 진행량을 제외한 B 전후 currentTime 불연속: 1 video frame 이하
- B 전후 timeline invariant snapshot hash 불일치: 0
- pilot 동작 후 `.bframe` hash·mtime·size 변경: 0
- ReviewDataManager dataChanged·save·saveError 및 저장 오류 toast 호출: 0

## 23. Go / No-Go 기준

### Go

다음이 모두 충족되면 drawingsV3 저장 단계로 진행한다.

- active 전용 입력 창에서 마우스와 펜 입력 정상이며 passive 때는 완전 click-through
- overlay 포커스 상태에서도 허용된 전역 단축키와 IME가 안정적으로 공존
- B 전환이 영상 엔진과 타임라인을 변경하지 않음
- 중복 영상과 오디오 없음
- V 선택·해제·이동·삭제·B 종료·playlist 전환 뒤에도 실제 `.bframe`과 저장 호출이 완전히 불변
- 전체화면과 다중 DPI 좌표 정상
- 2,000개 획 최소 성능 기준 통과
- surface crash가 mpv 재생을 중단하지 않음
- 기존 mpv passive overlay 회귀 없음

### No-Go

다음 중 하나라도 발생하면 첫 시험판을 기본 기능으로 승격하지 않는다.

- surface 입력을 받으려면 메인 창 포커스를 지속적으로 빼앗아야 함
- B 단축키를 overlay에서 안정적으로 메인으로 전달할 수 없음
- 드로잉 입력을 켠 동안 재생 조작 UI를 사용할 수 없음. 영상 사각형 전용 창 실험은 현재 Phase 0에 넣지 않고 별도 승인할 Phase 0B로만 다룸
- 영상 위 확대/축소 등 비재생 제어라도 active 입력 창에 가로막혀 사용할 수 없음
- surface 창 z-order가 반복해서 mpv 아래로 내려감
- 동일 좌표가 DPI 변경에서 반복적으로 어긋남
- surface crash가 mpv 또는 메인 창을 함께 종료함
- 최적화 후에도 성능 기준을 반복 실패함
- 기존 passive overlay의 댓글, 토스트, 합성 레이어가 깨짐

## 24. 단계별 전환

### Phase 0: 상호작용 시험판

- opt-in
- session-only
- 브러시, 필압, 선택, 이동, 삭제
- 실제 앱 수치 측정
- 데이터 변경 없음

### Phase 0B: 입력 라우팅과 영상 HUD 공존

- 기존 MPVOverlayHost는 항상 passive/click-through 유지
- warm DrawingSurfaceHost 분리 여부와 active HUD mirror/bridge를 실제 비교
- `canvasRect` 전용 창만으로 영상 위 HUD 차단이 해결된다고 가정하지 않음
- active에서만 focusable/input 수신, passive 전환은 fail-closed
- main 단축키 릴레이, IME, Alt-Tab과 접근성 회귀 시험
- 확대/축소·전체화면 command는 원본과 mirror가 동일한 단일 handler를 사용
- 영상 위 확대/축소, 재생바, 타임라인, 전체화면 제어를 실제 마우스와 키보드로 모두 조작
- 분할 host 또는 native hit-test 대안은 연속 획·DPI·플랫폼 위험까지 함께 측정
- Phase 0 수치 기준 중 펜, 500/2,000획, DPI와 장시간 시험 완료
- 이 단계를 통과하기 전에는 Phase 1 저장 모델을 제품 코드에 연결하지 않음

### Phase 1: BAEFRAME 객체 모델

- DrawingDocument v3 메모리 모델
- DrawingEngineAdapter
- command history
- 레이어와 keyframe
- 단위 테스트

### Phase 2: 안전한 저장

- Phase 2A bridge-only 릴리스: unknown root field와 reviewDocumentId 통과 보존, V3 writer 없음
- Phase 2A round-trip 배포 검증 후에만 Phase 2B write flag 허용
- 기존 drawings opaque 보존과 drawingsV3 nested opaque-field codec
- drawingsV3 validator
- prepared recovery sidecar 선기록, 검증된 full rollback backup, atomic compare-and-replace
- cross-process conflict, reopen, crash recovery, rollback 검증

### Phase 3: 편집 기능 완성

- 도형
- copy/paste
- 자유형 라쏘
- 부분 획 분리
- stroke eraser
- mask eraser
- 정적 재생 캐시와 onion skin

### Phase 4: 협업과 기본 승격

- DRAWING_V3 protocol
- 혼합 버전 read-only
- overlay packaged document, app protocol, CSP와 webSecurity 보안 gate
- 장시간 실사용
- 신규 설치 기본 ON
- 기존 하이브리드 드로잉 전환 제거

댓글 모드 하이브리드 전환은 별도 검토 전까지 유지한다.

## 25. 예상 파일 경계

### 첫 시험판 생성

- main/experiment-flags.js
- renderer/scripts/modules/mpv-fabric-overlay-runtime.js
- renderer/scripts/modules/fabric-drawing-pilot-controller.js
- renderer/scripts/modules/fabric-drawing-pilot-metrics.js
- renderer/scripts/lib/mpv-fabric-overlay.iife.js
- scripts/tests/experiment-flags.test.js
- scripts/tests/mpv-fabric-overlay-runtime.test.js
- scripts/tests/fabric-drawing-pilot-session.test.js
- scripts/tests/fabric-drawing-pilot-shortcuts.test.js
- scripts/tests/fabric-drawing-pilot-benchmark.test.mjs
- scripts/tests/fabric-drawing-pilot-source.test.js

### 첫 시험판 수정

- package.json
- package-lock.json
- main/index.js
- main/ipc-handlers.js
- main/mpv-overlay-host.js
- preload/preload.js
- renderer/scripts/app.js
- scripts/tests/mpv-overlay-host.test.js
- scripts/tests/mpv-runtime-source.test.js

### 후속 정식 교체 생성

- renderer/scripts/modules/drawing-v3/drawing-document.js
- renderer/scripts/modules/drawing-v3/drawing-engine-adapter.js
- renderer/scripts/modules/drawing-v3/drawing-command-history.js
- renderer/scripts/modules/drawing-v3/drawing-v3-codec.js
- renderer/scripts/modules/drawing-v3/drawing-v3-validator.js
- renderer/scripts/modules/drawing-v3/lasso-geometry.js
- renderer/scripts/modules/drawing-v3/stroke-splitter.js
- renderer/scripts/modules/drawing-v3/frame-render-cache.js
- renderer/scripts/modules/drawing-v3/drawing-v3-sync.js

기존 drawing-manager.js와 drawing-canvas.js는 Phase 4까지 삭제하지 않는다. 기능 플래그 OFF와 HTML5 fallback의 안전 경로로 남긴다.

## 26. 설계상 잠근 결정

- 첫 시험판은 기존 MPVOverlayHost 한 개 안에 Fabric delta canvas를 주입한다.
- 첫 시험판은 저장하지 않는다.
- 첫 시험판 플래그는 설정에 저장하지 않으며 kill switch가 enable보다 우선한다.
- B는 항상 직접 토글이다.
- B 토글은 재생을 멈추지 않는다.
- 첫 시험판은 B 진입 순간 targetFrame을 고정하며 편집 pointerdown에서도 재생을 멈추지 않는다.
- 정식 저장 단계에서는 실제 편집 pointerdown만 재생을 멈출 수 있다.
- 기존 drawings v2는 보존하되 표시하지 않는다.
- 첫 저장 릴리스는 bframeVersion 2.0 envelope과 drawingsV3 schemaVersion 3.0.0을 함께 사용한다.
- reviewDocumentId는 drawingsV3 밖의 stable review identity이며 bridge 릴리스부터 보존한다.
- recovery sidecar와 검증된 rollback backup을 main 교체보다 먼저 만든다.
- top-level 3.0 승격은 unknown-field bridge가 충분히 배포된 뒤 별도 프로젝트로 진행한다.
- Fabric JSON은 공식 원본이 아니다.
- 클릭 선택은 dirty가 아니다.
- 첫 시험판에서 협업을 비활성화한다.
- 기존 MPVOverlayHost의 창 수명, bounds, passive mirror API는 유지하고 Fabric capability만 추가한다.
- 실패 시 HTML5 하이브리드로 자동 전환하지 않는다.
- mpv 연결 성공 토스트는 pilot 플래그와 무관하게 제거하고, 실패 및 폴백 알림은 유지한다.

## 27. 공식 참고 자료

- Fabric core concepts: https://fabricjs.com/docs/core-concepts/
- Fabric repository and releases: https://github.com/fabricjs/fabric.js/
- Fabric PencilBrush: https://fabricjs.com/api/classes/pencilbrush/
- perfect-freehand: https://github.com/steveruizok/perfect-freehand
- Konva overview: https://konvajs.org/docs/overview.html
- Konva free drawing: https://konvajs.org/docs/sandbox/Free_Drawing.html
- PixiJS guides: https://pixijs.com/8.x/guides
- Paper.js reference: http://paperjs.org/reference/
- Excalidraw integration: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/integration
- Electron BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window
- Electron webContents: https://www.electronjs.org/docs/latest/api/web-contents

## 28. 문서 승인 후 첫 구현의 종료 조건

문서 승인 후 작성할 첫 구현 계획은 Phase 0만 다룬다.

Phase 0 완료 보고는 다음 증거가 있을 때만 가능하다.

- 실패 테스트를 먼저 실행한 기록
- 새 단위 테스트 전체 통과
- 기존 drawing, mpv, playlist, hybrid 테스트 통과
- lint 통과
- directory build 통과
- 실제 opt-in 앱 실행
- mpv 위 B 100회와 브러시 입력의 60fps 이상 연속 녹화 및 frame 분석 결과
- playback ownership trace, timeline invariant snapshot, 실제 `.bframe` no-save 증거
- 알려진 실패와 성능 측정값 기록

Phase 0은 정식 엔진 교체 완료가 아니라, 동일 구조로 정식 교체를 계속해도 되는지를 판단하는 실제 앱 검증 단계다.
