# CLAUDE.md

> BAEFRAME 프로젝트 개발 가이드

---

## 프로젝트 개요

**BAEFRAME**은 애니메이션 스튜디오를 위한 비디오 리뷰 & 피드백 도구입니다.

- **기술 스택**: Electron + mpv + Canvas API
- **데이터**: `.bframe` JSON 파일 (Google Drive 동기화)
- **배포**: Desktop 앱 + Web Viewer (Vercel)

---

## 개발 환경

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm start

# 또는
npm run dev
```

### npm scripts

| 명령어 | 설명 |
|--------|------|
| `npm start` | 앱 실행 (프로덕션) |
| `npm run dev` | 개발 모드 (DevTools 자동 열림) |
| `npm run build` | 빌드 (디렉토리 형식) |
| `npm run build:installer` | 설치자 생성 |
| `npm run lint` | ESLint 검사 |
| `npm run lint:fix` | ESLint 자동 수정 |
| `npm run format` | Prettier 포맷팅 |

---

## Git 컨벤션

### 브랜치 명명

```
feature/댓글-스레드-기능
fix/타임라인-드래그-버그
refactor/그리기-레이어-최적화
```

### 커밋 메시지

**한글**로 작성하며, **무엇을, 왜, 어떻게** 했는지 명료하게 기술합니다.

```
feat: 댓글 스레드 기능 추가

- 댓글 더블클릭 시 스레드 팝업 표시
- 답글 작성/수정/삭제 기능 구현
```

| 타입 | 설명 |
|------|------|
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `refactor` | 코드 리팩토링 |
| `style` | UI/스타일 변경 |
| `docs` | 문서 수정 |
| `chore` | 설정, 빌드 등 기타 |

### Pull Request

PR 제목과 내용은 **한글**로 작성합니다.

---

## 폴더 구조

```
BAEFRAME/
├── main/           # Electron Main Process
├── preload/        # Preload Scripts
├── renderer/       # Desktop UI
│   ├── scripts/
│   │   ├── app.js      # 메인 로직
│   │   └── modules/    # 기능 모듈
│   └── styles/
├── web-viewer/     # 웹 뷰어 (Vercel)
└── mpv/            # mpv 바이너리
```

---

## 주요 파일

| 파일 | 설명 |
|------|------|
| `baeframe-dev-docs.md` | 개발 문서 (아키텍처, 기능 명세) |
| `BAEFRAME-WEB-VIEWER.md` | 웹 뷰어 개발 계획 |
| `TODO.md` | 개발 진행 상황 |

---

## 단축키

| 키 | 기능 |
|-----|------|
| `Space` | 재생/일시정지 |
| `← →` | 1프레임 이동 |
| `D` | 그리기 모드 |
| `C` | 댓글 모드 |
| `F` | 전체화면 |
| `I/O/L` | 구간 반복 |

---

## 환경 변수

현재 `.env` 파일은 사용하지 않습니다.

**Google API (웹 뷰어)**는 `web-viewer/scripts/app.js`에 설정되어 있습니다.

---

## 코드 스타일

ESLint + Prettier 설정 기반 규칙:

- **들여쓰기**: 2스페이스
- **따옴표**: 싱글 쿼트 (`'`)
- **세미콜론**: 필수
- **변수**: `const` 우선, `var` 금지
- **비교**: `===` / `!==` 사용

```bash
# 검사 및 수정
npm run lint:fix && npm run format
```

---

## 디버깅

### 로그 파일

- **위치**: `%APPDATA%\baeframe\logs/`
- **시작 로그**: `%APPDATA%\baeframe\startup-debug.log`

### 개발 모드

```bash
npm run dev          # DevTools 자동 열림
.\run-baeframe-dev.bat  # Windows
```

### 웹 뷰어 로컬 테스트

```bash
cd web-viewer
npx serve .
# 또는
python -m http.server 8080
```

---

## Windows 배포 스크립트

| 스크립트 | 용도 |
|----------|------|
| `run-baeframe.bat` | 실행 (Google Drive 동기화 + npm install 자동) |
| `run-baeframe-dev.bat` | 개발 모드 실행 |
| `install.bat` | 첫 설치 |

---

## 주요 의존성

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `electron` | ^28.0.0 | 프레임워크 |
| `electron-store` | ^8.1.0 | 설정 저장 |
| `electron-builder` | ^24.9.1 | 빌드/패키징 |
| `eslint` | ^8.56.0 | 코드 검사 |
| `prettier` | ^3.2.0 | 코드 포맷팅 |

---

## 알려진 이슈

| 기능 | 상태 | 설명 |
|------|------|------|
| 어니언 스킨 | BLOCKED | 캔버스 오버레이가 비디오 가림 |
| Slack 링크 | 해결됨 | `G:/` → `G/` 변환 → 앱에서 자동 복원 |
| 한글 경로 | 해결됨 | 앱 실행 시 자동 프로토콜 등록 |

---

## 참고

- [GitHub Wiki](https://github.com/baehandoridori/BAEFRAME/wiki)
- [Web Viewer](https://baeframe.vercel.app)

---

## 개발 워크플로우

### 개발 환경

| 항목 | 경로/정보 |
|------|----------|
| 개발자 | baehandoridori |
| 로컬 개발 경로 | 개인 PC의 프로젝트 폴더 |
| 원격 저장소 | `github.com/baehandoridori/BAEFRAME` |
| 메인 브랜치 | `main` |

### 브랜치 전략

```
main (안정 버전)
  └── feature/기능명 (기능 개발)
  └── fix/버그명 (버그 수정)
  └── claude/작업명-세션ID (AI 작업용)
```

- **main**: 팀원에게 배포되는 안정 버전
- **feature/fix**: 수동 개발 브랜치
- **claude/**: Claude Code가 작업하는 브랜치 (PR 후 main 머지)

### 개발 → 배포 흐름

```
1. 브랜치 생성 (feature/fix/claude)
2. 개발 및 테스트
3. PR 생성 → main 머지
4. main에서 빌드: npm run build:installer
5. 생성된 설치 파일을 팀원에게 전달
```

---

## 팀 배포

### 배포 방식

| 항목 | 내용 |
|------|------|
| 배포 대상 | 스튜디오 팀원들 (비개발자) |
| 배포 형태 | Windows 설치 파일 (.exe) |
| 배포 경로 | Google Drive 공유 폴더 또는 직접 전달 |
| 업데이트 | 수동 (새 버전 설치 파일 전달) |

### 왜 이렇게 배포하나?

1. **팀원들이 비개발자**: npm, git 등 개발 도구 사용 불가
2. **오프라인 환경**: 일부 작업 환경에서 인터넷 제한
3. **간편함**: 설치 파일 하나로 바로 사용 가능
4. **Google Drive 연동**: .bframe 파일이 Drive에서 자동 동기화되므로 앱만 설치하면 됨

### 빌드 명령어

```bash
# 설치 파일 생성 (dist/ 폴더에 생성됨)
npm run build:installer

# 빌드만 (설치 파일 없이)
npm run build
```

### 배포 체크리스트

- [ ] main 브랜치 최신 상태 확인
- [ ] `npm run build:installer` 실행
- [ ] `dist/` 폴더에서 설치 파일 확인
- [ ] 버전 번호 확인 (package.json)
- [ ] 팀 공유 폴더에 업로드 또는 직접 전달
- [ ] 팀원에게 업데이트 안내

---

## AI 작업 시 주의사항

### 변경 금지 항목
- `mpv/` 폴더 (바이너리 파일)
- `.bframe` 파일 포맷 (하위 호환성 유지 필요)

### 변경 시 주의 항목
- `main/` 폴더: Electron 메인 프로세스, 보안 관련
- `preload/` 폴더: IPC 통신, 보안 관련
- `web-viewer/`: Vercel 배포에 영향

### 작업 완료 후
1. DEVLOG에 작업 내용 기록
2. 커밋 메시지 한글로 상세 작성
3. PR 생성 또는 main 머지 대기

---

## DEVLOG 개발 문서 작성 가이드

### DEVLOG 폴더 용도

`DEVLOG/` 폴더는 **기능 개발 및 버그 수정의 상세 계획과 진행 상황**을 기록하는 곳입니다.
새로운 기능을 개발하거나 복잡한 수정을 할 때, 반드시 DEVLOG 문서를 먼저 작성하여 계획을 수립합니다.

### 문서 작성 시점

다음 상황에서 DEVLOG 문서를 작성합니다:

- 새로운 기능 개발 시
- 여러 파일에 걸친 복잡한 수정 시
- 여러 Phase로 나뉘는 작업 시
- 리스크나 의존성이 있는 작업 시

### 문서 구조 (필수)

```markdown
# [기능명] 개발 계획

## 요약

| 항목 | 수정 파일 | 이유 | 우선순위 | 상태 |
|------|----------|------|---------|------|
| Phase 1 | file1.js, file2.js | 기본 기능 구현 | 높음 | ✅ 완료 |
| Phase 2 | file3.js | 성능 최적화 | 중간 | 🔄 진행중 |
| Phase 3 | file4.js | 엣지케이스 처리 | 낮음 | ⬜ 대기 |

## 배경 및 목적
- 왜 이 기능이 필요한가?
- 어떤 문제를 해결하는가?

## Phase 1: [단계명]
### 목표
### 수정 파일
### 구현 내용
### 예상 리스크

## Phase 2: [단계명]
...

## 리스크 및 우려 사항
| 리스크 | 심각도 | 완화 방안 |
|--------|--------|----------|

## 테스트 방법
```

### 상태 표기

| 아이콘 | 의미 |
|--------|------|
| ⬜ | 대기 (미착수) |
| 🔄 | 진행중 |
| ✅ | 완료 |
| ❌ | 취소/보류 |

### 파일 명명 규칙

```
DEVLOG/
├── 실시간-협업-동기화-구현-계획.md
├── 버전관리시스템-개발.md
├── 2026-01-13-코드리뷰-검증.md
└── ...
```

- 한글로 작성
- 기능명 또는 날짜-작업명 형식
- 하이픈(-)으로 단어 구분

### 컨텍스트 유지

DEVLOG 문서는 **작업의 컨텍스트를 유지**하는 역할을 합니다:

1. **왜**: 이 기능이 필요한 이유, 해결하려는 문제
2. **어떻게**: 구체적인 구현 방법, 수정할 파일과 함수
3. **리스크**: 예상되는 문제와 완화 방안
4. **진행 상황**: 각 Phase의 완료 여부

세션이 끊기거나 컨텍스트가 초기화되어도, DEVLOG 문서를 읽으면 작업을 이어갈 수 있습니다.

### 작업 흐름

```
1. DEVLOG 문서 작성 (계획 수립)
2. 요약 테이블에서 Phase 1 상태를 🔄로 변경
3. Phase 1 구현
4. 테스트
5. 요약 테이블에서 Phase 1 상태를 ✅로 변경
6. 다음 Phase 진행...
7. 모든 Phase 완료 후 커밋 & 푸시
```
