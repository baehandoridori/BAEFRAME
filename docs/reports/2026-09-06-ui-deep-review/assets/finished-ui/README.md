# BAEFRAME · BEditer 완성 화면 시안

2026-09-06, UI 보고서 보강판 2의 원본 제작 자료. 실제 제품 UI가 아닌 미구현 제안이다.

## 구성

- 01-baeframe-review: 기본 앱의 영상 목록, 원본 리뷰, 구간 댓글과 작성창.
- 02-baeframe-drawing: 같은 영상 영역을 유지한 드로잉 리뷰, 선택 획과 속성.
- 03-bediter-edit: 미디어, 결과 미리보기, 선택 컷과 영상·그림·소리 시간축.
- 04-bediter-portrait: 세로 결과 미리보기와 컷 소유 드로잉의 선택·노출.

각 HTML은 1600×1000 기준이며 PNG는 2배 해상도 3200×2000으로 렌더한다. `review.cjs` / `editor.cjs`가 화면별 내용을, `shared.css`와 `render.cjs`가 공통 스타일과 셸을 구성한다. 한국어 글자·시간·속성 값은 HTML/CSS로 작성했다. 모든 버튼은 시안용이며 클릭 기능이나 앱 성능을 검증하는 프로토타입이 아니다.

## 제작과 검증

보고서 루트에서 `node assets/finished-ui/render.cjs` 실행. 이 환경의 Chrome 및 번들 Playwright 경로를 사용하는 재현 스크립트다. 글꼴/이미지 로딩 후 2회 animation frame과 짧은 paint 안정화를 거쳐 네 PNG를 작성한다. `render-checks.json`에 화면 크기·이미지 로딩·주요 영역 넘침 검사 결과를 남긴다.

최종 PNG 네 장을 직접 시각 확인했다. 기본 리뷰와 드로잉 리뷰는 40px 작업 줄을 동일하게 확보했다. BEditer의 영상 58px / 그림 32px / 소리 32px 행과 152px 레이블 열을 확인했다. 정지 이미지의 검토이며 실제 제품의 드래그·키보드·Windows DPI·성능 검증은 아니다.

게시본에는 네 PNG만 포함한다. 제작 HTML/CSS/CJS, 샘플 원본 영상 그림, 검사 자료는 로컬 보고서 원본에 보존한다. 사용자·파일·댓글 이름은 가상 예시이고 제3자에게 댓글을 발송하지 않았다.

## 예시 장면 출처

`animation-shot.png`는 built-in imagegen으로 이 보고서를 위해 새로 생성한 원본 애니메이션 장면이다. 1672×941 PNG. 다른 회사 앱의 스크린샷이나 기존 애니메이션 작품이 아니다. 보고서의 공식 타사 UI 이미지는 별도 evidence/references에 보존하며 이 생성 이미지와 구별한다.

생성 프롬프트:

> Use case: illustration-story. Create one finished 2D animated film frame to use as sample video content inside a Korean animation review and video editing UI concept. This is ONLY the film artwork, no interface, no words, no logos, no watermark. Wide cinematic 16:9 composition, preferably 1920x1080 or larger. A young adult female courier in a muted burnt-orange windbreaker and dark indigo trousers pauses on a pale concrete coastal train platform, body in a clear three-quarter walking pose, one hand lifted naturally near shoulder height, expressive readable face. Small crossbody satchel, short dark hair. The character occupies the central 35% of the scene and remains entirely readable if the artwork is shown in a central portrait crop. Background: teal-blue sea, distant island silhouettes, softly lit station columns, subtle warm afternoon light. Polished contemporary hand-painted animation feature look, refined clean drawing, believable anatomy and hands, cel-shaded character with atmospheric painterly background, appealing art direction and harmonious restrained colors. Professional production frame, not children's doodle, no exaggerated wide-angle distortion. Clear silhouette and spare environment so a reviewer can inspect pose and hand motion. This is original fictional sample artwork, not any existing film or franchise.

생성 이미지는 16:9에 근접한 샘플 그림이며 실제 1920×1080 영상 파일을 생성한 것은 아니다. UI의 1920×1080·1080×1920·24fps는 가상 프로젝트의 출력 설정 예시다. 시간축 썸네일은 같은 샘플 장면을 재사용했으며 실제 영상에서 추출한 연속 프레임으로 주장하지 않는다.
