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

## 참고

- [GitHub Wiki](https://github.com/baehandoridori/BAEFRAME/wiki)
- [Web Viewer](https://baeframe.vercel.app)
