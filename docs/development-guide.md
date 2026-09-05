# 개발 환경과 검증

공통 작업 규칙은 [AGENTS.md](../AGENTS.md)를 따른다. 명령과 의존성의 기준은 [package.json](../package.json)이다.

## 실행

저장소 루트에서 실행한다. Windows PowerShell에서 npm 실행 정책 문제가 있으면 `npm.cmd`를 사용한다.

| 명령 | 용도 |
|---|---|
| `npm install` | 의존성 설치. postinstall에서 번들과 저장 보조 실행 파일도 생성하므로 이후 diff 확인 |
| `npm start` | 소스 체크아웃에서 Electron 실행 |
| `npm run dev` | 개발 모드 실행 |
| `npm run build` | stable 프로필로 `dist/win-unpacked` 생성 |
| `npm run build:trial` | 격리된 trial 프로필로 `dist-trial`에 생성 |
| `npm run build:installer` | 설치 파일이 요청된 경우 사용 |
| `npm run bundle:mpv-fabric-overlay` | 오버레이 원본을 브라우저용 번들로 생성 |

소스 실행과 배포 실행은 동일한 조건이 아니다. `main/runtime-profile.js`는 패키징된 앱의 `resources/baeframe-runtime-profile.json`을 읽는다. 실험 플래그의 실제 판정은 `main/experiment-flags.js`를 확인한다. 문제 재현 시 실행 경로·프로필·활성 엔진을 기록한다.

개발 빌드는 해당 체크아웃의 `dist/win-unpacked/BFRAME_alpha_v2.exe`다. 배포 경로는 [릴리스 가이드](release-guide.md)에만 관리한다. 로그는 일반 프로필에서 `%APPDATA%/baeframe/logs/`와 `startup-debug.log`를 확인하되, 격리 프로필은 실제 userData 경로를 확인한다.

## 코드 구조

| 위치 | 역할 |
|---|---|
| `main/index.js`, `main/` | Electron 시작·창·mpv·파일 입출력 |
| `preload/` | 화면과 메인 프로세스 사이의 제한된 IPC 인터페이스 |
| `renderer/scripts/app.js` | 앱 상태·기능 연결·단축키 라우팅 |
| `renderer/scripts/modules/` | 재생·드로잉·타임라인·협업 모듈 |
| `renderer/scripts/modules/mpv-fabric-overlay-runtime.js` | 별도 오버레이 창의 Fabric 입력·표시 |
| `renderer/scripts/lib/mpv-fabric-overlay.iife.js` | 위 원본에서 생성한 번들 |
| `scripts/tests/` | Node 테스트. 명령별 파일 목록은 package.json 참조 |
| `scripts/electron-builder-before-pack.js` | 필수 런타임 검증·mpv 준비·저장 보조 도구 준비 |
| `scripts/electron-builder-after-pack.js` | 패키지 실행 프로필 기록 |
| `web-viewer/` | 별도 웹 뷰어. 변경 시 [웹 가이드](web-viewer.md) 참조 |

상세 설명: [구조](architecture.md), [모듈](modules.md), [Windows 통합](integration.md). 문서와 코드가 다르면 현재 구현을 확인하고 해당 문서도 갱신한다.

## 영역별 테스트 선택

아래는 시작점이다. 여러 영역을 건드렸으면 관련 행을 함께 적용한다.

| 변경 영역 | npm run 뒤에 붙일 명령 |
|---|---|
| 드로잉 데이터·레이어·실행취소 | `test:drawing`, `test:fabric-drawing-pilot` |
| 저장·동시 저장·파일 복구 | `test:fabric-drawing-persistence` |
| mpv·오버레이 호스트·키 입력·실행 프로필 | `test:mpv` |
| 재생목록·연속 재생·영상 전환 | `test:playlist` |
| 타임라인·키프레임 표시 | `test:frame-grid`, 드로잉 변경이면 위 드로잉 테스트 추가 |
| 합성 레이어 | `test:composition` |
| 댓글·협업 | `test:comment-input`, `test:cluster`, `test:collaboration` 중 관련 항목 |
| Drawing V3 문서·어댑터·관찰자 | `test:drawing-v3-hardening`, `test:drawing-v3-adapter`, `test:drawing-v3-store-observer` 중 관련 항목 |

전체 회귀 검증이 필요하면 package.json의 현재 `test:*` 목록을 기준으로 실행한다. 테스트 수를 고정하지 않는다. 성능 변경은 관련 `benchmark:*`도 검토한다.

UI 버그는 자동 검증과 별도로 실제 입력 영역·포커스·단축키·영상 가림을 확인한다. 연속 재생은 짧은 영상, 중복 종료 이벤트, 일시정지 후 재개를 포함한다. 저장 변경은 재열기와 동시 편집을 확인한다. 실기 검증이 불가능하면 완료 보고에 남긴다.

## 스타일과 작업 기록

기존 ESLint·Prettier 설정을 따른다(2칸 들여쓰기, 싱글 쿼트, 세미콜론, const 우선). `npm run lint:fix`와 `npm run format`은 전체 저장소를 변경하므로 기본 작업 흐름으로 실행하지 않는다. 필요한 경우 수정 파일을 명시해 검사·포맷한다.

새 기능·복잡한 수정은 `DEVLOG/날짜-작업명.md`에 목적, 변경 파일, 단계별 상태, 위험, 검증 방법을 먼저 정리한다. 완료 후 실제 구현·테스트 결과·미해결 항목을 추가한다. 과거 기록을 새 현재 상태로 덮어쓰지 않는다. 단순 문서 수정은 간단한 변경 기록으로 충분하다.
