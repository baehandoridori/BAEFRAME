# CLAUDE.md

> BAEFRAME: 애니메이션 스튜디오를 위한 영상 리뷰·피드백 도구.

## 공통 작업 규칙

작업 전에 아래 공통 지침을 읽고 따른다. Codex와 Claude Code의 작업 기준을 한곳에서 관리한다.

@AGENTS.md

## 작업별 안내

| 작업 | 참고 문서 |
|---|---|
| 실행·구조·테스트·DEVLOG 작성 | [개발 가이드](docs/development-guide.md) |
| 드로잉·키프레임·레이어 | [드로잉 작업 규칙](docs/drawing-work-guide.md), [현재 기능표](docs/drawing-keyframe-features.md) |
| PR·리뷰·머지·빌드·배포 | [릴리스 가이드](docs/release-guide.md) |
| 시스템 구조 | [아키텍처](docs/architecture.md), [모듈](docs/modules.md) |
| 저장·협업 | [파일 명세](docs/bframe-schema.md), [협업](docs/collaboration.md) |
| 웹 뷰어·Windows 연동 | [웹 뷰어](docs/web-viewer.md), [Windows 통합](docs/integration.md) |

## 빠른 시작

저장소 루트에서 `npm install` 후 `npm run dev`로 실행한다. 의존성 설치도 번들을 생성하므로 diff를 확인한다. Windows에서 npm 실행 정책 문제가 있으면 `npm.cmd`를 사용한다.

- 소스 실행: `npm start` 또는 `npm run dev`
- 배포용 폴더 빌드: `npm run build`
- 격리 trial 빌드: `npm run build:trial`
- 드로잉 테스트 시작점: `npm run test:drawing`, `npm run test:fabric-drawing-pilot`
- 저장 변경: `npm run test:fabric-drawing-persistence`
- mpv·입력 변경: `npm run test:mpv`

소스 실행과 배포본의 실행 프로필은 다를 수 있다. 세부 명령·테스트 선택·환경 확인은 개발 가이드를 따른다. 버전과 의존성은 package.json에서 확인한다.

## Claude Code에서 적용

- 개인 스킬보다 사용자가 지정한 범위와 이 저장소의 공통 규칙을 우선한다.
- 배포·리뷰 스킬은 위 릴리스 가이드에 연결한다. 다른 저장소 전용 명령을 그대로 적용하지 않는다.
- UI 스킬은 기존 Electron 화면·CSS·단축키·오버레이 입력을 우선한다. 작은 수정 때문에 새 디자인 체계를 만들지 않는다.
- 과거 DEVLOG는 당시 기록이다. 현재 기능의 완료 여부는 현재 기능표와 코드를 확인한다.
