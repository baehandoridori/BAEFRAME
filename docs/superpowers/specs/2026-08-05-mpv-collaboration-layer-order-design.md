# mpv 협업 UI 레이어 순서 회귀 수정 설계

## 배경

BAEFRAME의 mpv 재생 화면은 Chromium 화면과 분리된 Windows 네이티브 창이다. 따라서 일반 DOM의 `z-index`만 높여서는 Liveblocks 커서, 현재 작업 인원, 재생 동기화 상태를 mpv 위에 안정적으로 표시할 수 없다.

PR #172에서는 이 문제를 해결하면서 `.collaborators-indicator`와 `.playback-sync-panel`을 mpv 차단 표면으로 등록했다. 협업 시작 시 재생 동기화 패널이 자동 표시되면 작은 패널 하나 때문에 mpv 호스트 전체가 숨겨지고, 결과적으로 정상 재생 중인 영상이 검은 화면으로 보이는 회귀가 생겼다.

첫 수정에서는 두 협업 표면을 일반 `HTML_MIRROR`로 복제했다. 이 방식은 영상과 협업 UI를 동시에 보이게 했지만, 전체 브랜치 리뷰에서 다음 세 가지 기능 회귀가 확인됐다.

1. Fabric 그리기가 활성화되면 투명 오버레이 창이 입력을 소유한다. 일반 HTML 복제본을 `pointer-events: none`으로 두면 클릭·호버·드래그가 원본 DOM까지 전달되지 않고, 반대로 입력을 켜면 Fabric에 의도하지 않은 획이 생길 수 있다.
2. `cloneNode()`와 `innerHTML` 기반 복제는 체크박스·라디오의 현재 `checked` 속성과 CSS 의사 요소로 그린 토글 손잡이·상태 점을 정확히 보존하지 못한다.
3. `<canvas>`의 픽셀 버퍼는 DOM 복제로 전달되지 않고 캔버스 그리기는 DOM mutation도 발생시키지 않으므로, 펼쳐진 협업 플렉서스 패널이 비어 보인다.

따라서 일반 HTML 복제를 최종 해법으로 사용하지 않고, 협업 UI만을 위한 전용 상태 미러와 허용 목록 기반 의미 동작 전달 경로로 교체한다.

## 목표 동작

- 협업 여부와 관계없이 mpv 영상은 계속 재생되고 화면에 표시된다.
- Liveblocks 원격 커서, 현재 작업 인원, 동기화 상태는 mpv보다 위의 표시층에서 함께 보인다.
- 협업 UI의 클릭, 호버, 접기, 닫기, 드래그 동작은 Fabric 그리기 활성 여부와 관계없이 기존과 동일하게 유지한다.
- 협업 미러 위의 포인터 제스처는 Fabric 캔버스에 도달하지 않아 의도하지 않은 획을 만들지 않는다.
- 토글·라디오·상태 점과 플렉서스 캔버스를 포함해 원본 협업 UI의 현재 상태가 정확히 보인다.
- 모달처럼 영상 전체를 실제로 대신해야 하는 화면만 mpv 호스트를 일시적으로 숨길 수 있다.
- 접혀 있거나 투명하거나 조상에 의해 잘린 요소는 mpv 차단 표면으로 오판하지 않는다.
- 외부 협업자 이름·색상과 IPC 입력은 HTML 또는 임의 명령으로 해석되지 않는다.

## 검토한 방법

### 1. 협업 UI를 mpv 차단 표면으로 유지

작은 협업 UI가 표시될 때마다 mpv 전체를 숨기는 방식이다. 구현은 단순하지만 영상 재생 화면이 사라지므로 목표 동작에 맞지 않는다.

### 2. 협업 UI 등록만 제거

검은 화면은 즉시 사라지지만, mpv가 협업 UI를 다시 가리므로 원래 문제가 재발한다.

### 3. 일반 HTML 복제와 네이티브 마우스 관통 사용

Fabric이 비활성화된 동안에는 투명 창 전체가 마우스를 아래 창으로 통과시키므로 원본 DOM이 입력을 받을 수 있다. 그러나 Fabric이 활성화되면 투명 창이 그리기 입력을 직접 소유해 이 전제가 깨진다. 또한 폼의 라이브 상태, CSS 의사 요소, 캔버스 픽셀을 복제하지 못한다. 초기 수정으로는 유효했지만 최종 구조로는 채택하지 않는다.

### 4. 전용 협업 상태 미러와 의미 동작 전달

선택한 방식이다. 협업 UI는 신뢰할 수 있는 정적 DOM으로 투명 오버레이 창에 한 번 구성하고, 메인 renderer가 엄격한 상태 객체만 전달한다. Fabric이 입력을 소유하는 동안에는 전용 컨트롤이 이벤트를 캡처해 Fabric 전파를 중단한 뒤, 허용된 의미 동작만 메인 renderer의 기존 핸들러로 전달한다. Fabric이 비활성화되면 네이티브 창의 기존 마우스 관통 동작을 유지해 원본 DOM이 그대로 처리한다.

## 설계

### 1. 표면 분류와 레이어 순서

`renderer/scripts/modules/mpv-surface-policy.js`에 `MPV_SURFACE_MODE.COLLABORATION_MIRROR`를 추가한다.

- `.collaborators-indicator`: `HTML_MIRROR`에서 `COLLABORATION_MIRROR`로 이동
- `.playback-sync-panel`: `HTML_MIRROR`에서 `COLLABORATION_MIRROR`로 이동
- 원격 커서: 현재의 전용 미러 경로 유지
- 다른 비대화형 DOM 표면: 기존 `HTML_MIRROR` 유지
- 모달, 댓글 입력창처럼 화면을 실제로 대신하거나 Chromium 입력이 필요한 표면: 기존 `BLOCK` 유지

`COLLABORATION_MIRROR`는 일반 미러의 mutation·resize·motion 관찰 대상에는 포함하지만 `serializeMpvOverlayHtml()`의 복제 대상에서는 제외한다. 전용 컨테이너 `#collaborationMirror`의 `z-index`는 `46`으로 고정한다. 이는 Fabric 원격 획 `42`, 협업 리플 `44`, 원격 커서 `45`보다 위이며 토스트 `50`보다 아래다.

### 2. 전용 상태 계약

메인 renderer는 다음 모양의 revision 기반 상태만 전송한다.

```js
{
  revision: 12,
  theme: 'dark',
  indicator: {
    visible: true,
    bounds: { left: 18, top: 12, width: 164, height: 34 },
    badge: 'synced',
    users: [
      { name: '배한솔', color: '#FFD000', isMe: true, syncActive: true }
    ]
  },
  plexus: {
    visible: true,
    bounds: { left: 18, top: 50, width: 320, height: 240 },
    showRemoteCursors: true,
    snapshotDataUrl: 'data:image/png;base64,...'
  },
  playback: {
    visible: true,
    bounds: { left: 920, top: 540, width: 280, height: 174 },
    collapsed: false,
    syncEnabled: true,
    leaderMode: 'lead'
  }
}
```

좌표는 mpv 오버레이 루트 기준이다. 모든 사각형은 유한한 수인지 확인하고, 너비·높이는 0 이상, 각 좌표·크기는 절댓값 `32768` 이하로 제한한다. 알 수 없는 키가 하나라도 있으면 전체 상태를 거부한다. `revision`은 0 이상의 안전한 정수이고 이전 값보다 커야 한다.

상태 한 건의 직렬화 크기는 최대 `1 MiB`, 사용자는 최대 `64명`, 이름은 제어 문자와 양방향 제어 문자를 제거한 뒤 최대 `64자`, 색상은 `#RRGGBB`만 허용하고 나머지는 `#FFD000`으로 정규화한다. `badge`는 `idle | syncing | synced | error`, `theme`은 `dark | light`, `leaderMode`는 `lead | follow`만 허용한다.

전용 오버레이 문서는 전달받은 문자열을 `innerHTML`에 넣지 않는다. 미리 만든 정적 요소의 `textContent`, `classList`, `style.backgroundColor`, `aria-checked`만 갱신한다. 토글 손잡이와 라디오 표시점은 실제 자식 요소로 만들고 `syncEnabled`와 `leaderMode`로 상태 클래스를 적용한다. 따라서 속성 복제나 CSS 의사 요소에 의존하지 않는다.

### 3. 플렉서스 캔버스 전달

기존 `_drawUserPlexus()`가 그린 픽셀을 그대로 유지하기 위해 패널이 열려 있을 때 `collabPlexusCanvas.toDataURL('image/png')` 결과를 `snapshotDataUrl`로 전달한다. `data:image/png;base64,` 형식과 최대 `768 KiB`를 검증하며, 생성 실패·초과·닫힌 패널에서는 빈 문자열을 전송해 전용 `<img>`를 지운다.

플렉서스 라이브 갱신은 전용 스케줄러에서 초당 최대 `15회`로 제한한다. 패널이 닫히면 즉시 최종 빈 상태를 한 번 보내고 반복 갱신을 멈춘다. 다른 mpv 오버레이 상태 전체를 캔버스 프레임마다 다시 직렬화하지 않는다.

### 4. 상태 전달 경로

```text
Liveblocks·원본 DOM 상태
  -> buildMpvOverlayCollaborationState()
  -> preload: mpvUpdateOverlayCollaborationState(state)
  -> ipcMain: mpv:update-overlay-collaboration-state
  -> MPVOverlayHost.updateCollaborationState(state)
  -> window.__applyMpvCollaborationState(state)
  -> #collaborationMirror 정적 DOM
```

상태 갱신은 협업자·연결 상태 변경, 플렉서스 열기/닫기, 원격 커서 표시 설정, 동기화 켜기/끄기, 주도/팔로우 변경, 패널 표시/접기/이동, 창 크기·오버레이 위치 변경 때 예약한다. IPC 실패는 기존 오버레이 소유권·세대 확인 뒤 복구 경로를 타지만, 협업 상태 갱신 실패만으로 mpv 호스트를 숨기지는 않는다.

### 5. 의미 동작 전달

Fabric이 활성화된 동안 전용 협업 컨트롤은 capture 단계에서 `preventDefault()`와 `stopImmediatePropagation()`을 호출해 Fabric에 제스처가 전달되지 않게 한다. 이후 다음 허용 동작만 전송한다.

- `collab.indicator-enter`, `collab.indicator-leave`
- `collab.panel-enter`, `collab.panel-leave`
- `collab.sync-status`
- `collab.cursor-toggle`
- `collab.open-sync`
- `sync.toggle`
- `sync.lead`, `sync.follow`
- `sync.collapse`, `sync.close`
- `sync.drag-start`, `sync.drag-move`, `sync.drag-end`, `sync.drag-cancel`

오버레이 renderer는 동작 이름과 제한된 payload만 보낸다. 현재 `hostGeneration`, `videoGeneration`, `inputRevision`, `activeSessionId`, 단조 증가 `sequence`는 `MPVOverlayHost`가 현재 값으로 부착한다. 메인 renderer는 `fabricDrawingPilotController.getStatusSnapshot()`과 비교해 현재 Fabric 입력 세션에 정확히 일치하는 동작만 적용한다. 오래된 세대, 재사용된 sequence, 닫힌 세션의 동작은 버린다.

드래그는 한 `pointerId`만 소유하고 `setPointerCapture()`를 사용한다. 이동은 `requestAnimationFrame`당 한 번으로 합치며, `pointerup` 전에 마지막 좌표를 반드시 반영한다. `pointercancel`, `lostpointercapture`, 창 blur, 호스트·영상·입력 세대 변경 시 `sync.drag-cancel`로 끝낸다.

협업 동작 때문에 `setIgnoreMouseEvents(true/false)`를 동적으로 전환하지 않는다. 전환은 OS 메시지 경계에서 레이스, 분리된 down/up, 포인터 캡처 상실을 만들 수 있기 때문이다. Fabric이 비활성화된 동안에는 현재처럼 창 전체가 마우스 관통 상태이므로 원본 DOM 이벤트가 처리한다.

### 6. 원본 동작의 단일 진입점

`renderer/scripts/app.js`의 익명 이벤트 콜백을 이름 있는 동작 함수로 정리한다. 원본 DOM 리스너와 오버레이 의미 동작 어댑터가 같은 함수를 호출한다.

- 플렉서스 예약 열기·닫기 및 hover timer 관리
- 동기화 상태 안내
- 원격 커서 표시 전환
- 동기화 켜기/끄기
- 주도·팔로우 모드 변경
- 동기화 패널 표시·접기·닫기
- 동기화 패널 제한 좌표 이동

이 구조는 별도의 두 번째 상태 모델을 만들지 않는다. 실제 `PlaybackSync`, `userSettings`, 원본 DOM이 계속 권위 있는 상태이고 전용 오버레이는 그 상태를 투영한다.

### 7. 협업자 표시 보안

기존 `updateCollaboratorsUI()`의 템플릿 `innerHTML` 사용을 제거한다. 아바타는 `document.createElement()`로 만들고 이름·이니셜·title은 `textContent` 또는 DOM 속성으로만 지정한다. 색상은 동일한 `#RRGGBB` 정규화 함수를 거친 값만 `style.backgroundColor`에 넣는다. Liveblocks Presence가 전달한 이름이나 색상이 HTML·CSS 구문으로 실행되는 경로를 남기지 않는다.

### 8. 실제 가시성 판정

기존 완료 수정인 `isMpvSurfaceVisiblyOverlappingHost()`의 조상 체인 판정은 유지한다.

- 조상 중 `display: none`, `visibility: hidden | collapse`, `opacity <= 0`이 있으면 보이지 않는 것으로 처리한다.
- `overflow-x`와 `overflow-y`를 축별로 계산하고 `hidden | clip | auto | scroll` 조상에서 실제 사각형을 자른다.
- 자른 결과의 너비나 높이가 0이면 mpv와 겹치지 않는 것으로 처리한다.
- 혼합 축 클리핑과 0 크기 경계를 회귀 테스트로 고정한다.

### 9. 실패 시 원칙

- 협업 상태 미러 갱신이 실패해도 mpv 영상을 숨기지 않는다.
- 유효하지 않거나 오래된 상태·동작은 적용하지 않고 다음 정상 상태 갱신으로 회복한다.
- 플렉서스 스냅샷만 실패하면 패널의 텍스트·버튼은 유지하고 이미지 영역만 비운다.
- Fabric 입력 세션을 증명하지 못한 오버레이 동작은 원본 상태를 바꾸지 않는다.

## 테스트

- 두 협업 표면이 `BLOCK`과 `HTML_MIRROR`에는 없고 `COLLABORATION_MIRROR`에만 있는지 검증한다.
- 전용 상태의 정확한 키, 크기, revision, enum, 사각형, 사용자 수·이름·색상, PNG data URL 제한을 검증한다.
- 오래된 revision과 알 수 없는 키, 과대 스냅샷, 악성 이름·색상이 거부 또는 안전하게 정규화되는지 검증한다.
- 전용 정적 DOM이 `textContent`와 상태 클래스로 인원, 토글, 주도·팔로우, 상태 점을 갱신하고 일반 HTML 복제에 협업 UI가 포함되지 않는지 검증한다.
- 열린 플렉서스의 PNG가 표시되고, 닫힐 때 지워지며, 라이브 갱신이 초당 15회를 넘지 않는지 검증한다.
- 전용 레이어가 `z-index: 46`으로 원격 커서보다 위, 토스트보다 아래인지 검증한다.
- Fabric 활성 상태에서 각 허용 동작이 기존 이름 있는 핸들러를 한 번만 호출하고 Fabric pointer handler는 호출하지 않는지 검증한다.
- 오래된 host/video/input/session fence, 중복 sequence, 미허용 동작·payload는 거부하는지 검증한다.
- 드래그의 capture, 프레임별 합치기, 최종 좌표 flush, 취소 경계를 검증한다.
- 축별 overflow 혼합과 0 크기 조상·자식이 mpv 차단 표면으로 판정되지 않는지 검증한다.
- `npm run test:mpv`, `npm run test:collaboration`, `npm run test:fabric-drawing-pilot`, `npm run build`를 최종 코드와 버전에서 다시 실행한다.
- Windows 배포본에서 협업 연결 상태로 영상 재생, 커서, 작업 인원, 플렉서스, 동기화 신호·컨트롤과 Fabric 그리기를 함께 확인한다.

## 완료 조건

- 협업 시작 전후 모두 영상이 검게 변하지 않는다.
- mpv 재생 중 원격 커서·작업 인원·동기화 신호·플렉서스가 영상과 동시에 정확히 표시된다.
- Fabric 활성 상태에서도 협업 패널의 hover·클릭·토글·라디오·접기·닫기·드래그가 동작하고 accidental stroke가 없다.
- 기존 댓글·그리기·모달 오버레이 동작에 회귀가 없다.
- 신뢰하지 않는 협업 문자열과 IPC payload가 HTML 또는 임의 동작으로 실행되지 않는다.
- PR 리뷰와 머지 후 `2.0.3-beta`로 merged-main 빌드를 만든다.
- 공유 드라이브 테스트 버전 배포본과 로컬 빌드의 전체 파일 해시 차이가 0이다.
