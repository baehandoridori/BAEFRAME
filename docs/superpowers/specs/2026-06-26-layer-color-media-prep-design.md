# Layer Color And Media Preparation Design

## Goal

합성 레이어마다 식별 색상과 선택 색상을 따로 지정할 수 있게 하고, 영상 레이어가 Chromium에서 바로 재생되지 않는 경우 overlay용 표시 파일을 준비한다.

## Approved Scope

- 새 레이어는 자동으로 다른 `color`와 `selectedColor`를 받는다.
- 레이어 행에서 두 색상을 직접 바꿀 수 있다.
- 레이어 색상은 패널 행, 타임라인 바, 기본 프리뷰 테두리에 적용한다.
- 선택 색상은 선택된 프리뷰 아웃라인과 변형 핸들에 적용한다.
- 원본 `filePath`는 유지하고, 변환 또는 캐시로 준비된 파일은 런타임 `displayFilePath`로만 사용한다.
- 영상 레이어는 `ready`, `converting`, `error` 상태를 패널에 표시한다.
- MPV 모드에서도 overlay window는 준비된 `displayFilePath`를 받는다.

## Out of Scope

- 최종 합성 영상 export
- 여러 MPV 인스턴스로 레이어 영상을 각각 렌더링하는 구조
- 알파 채널 전용 변환 프로파일 완성
- 변환 진행률을 레이어별 퍼센트로 세밀하게 표시

## Architecture

`CompositionLayerManager`가 색상 저장값과 runtime media 상태를 가진다. 저장 데이터에는 `color`, `selectedColor`만 남기고 `displayFilePath`, `mediaStatus`, `mediaMessage`는 저장하지 않는다.

앱 레벨에서는 `prepareCompositionLayerMedia(filePath)` 콜백을 매니저에 주입한다. 이 콜백은 기존 FFmpeg IPC를 이용해 코덱 지원 여부와 변환 캐시를 확인하고, 필요하면 변환을 실행해 표시용 경로를 반환한다.

## MPV Policy

MPV는 메인 영상을 직접 재생한다. 합성 레이어 영상은 현재처럼 MPV overlay host의 Chromium document에서 재생되므로, Chromium 재생 가능 상태로 준비해야 한다. 이 분리는 MPV를 공식 엔진으로 바꿔도 유지한다.

## Testing

- 색상 자동 배정, 색상 정규화, 저장/검증 테스트를 추가한다.
- 변환 중/실패 레이어가 visible output에서 제외되는지 테스트한다.
- `prepareLayerMedia()`가 원본 경로와 표시 경로를 분리하는지 테스트한다.
- runtime source 테스트로 UI 액션, CSS 변수, MPV overlay 전달 경로가 연결되어 있는지 확인한다.
