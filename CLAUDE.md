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
| `register-protocol.bat` | `baeframe://` 프로토콜 등록 |

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
| Slack 링크 | 주의 | `G:/` → `G/` 변환 문제 발생 |

---

## 참고

- [GitHub Wiki](https://github.com/baehandoridori/BAEFRAME/wiki)
- [Web Viewer](https://baeframe.vercel.app)
