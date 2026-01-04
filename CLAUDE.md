# CLAUDE.md

> BAEFRAME 프로젝트 개발 가이드

---

## 프로젝트 개요

**BAEFRAME**은 애니메이션 스튜디오를 위한 비디오 리뷰 & 피드백 도구입니다.

- **기술 스택**: Electron + mpv + Canvas API
- **데이터**: `.bframe` JSON 파일 (Google Drive 동기화)
- **배포**: Desktop 앱 + Web Viewer (Vercel)

---

## Git 컨벤션

### 브랜치 명명

브랜치 이름은 **한글**로 작성합니다.

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
- Slack 스타일 UI 적용
```

**커밋 타입:**

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

```markdown
## 제목
feat: 구간 반복 재생 기능 추가

## 설명
### 무엇을
- I/O/L 키로 구간 반복 재생 기능 구현

### 왜
- 특정 구간을 반복 확인해야 하는 리뷰 상황이 많음
- 프레임 단위 검토 시 반복 재생 필요

### 어떻게
- I 키: 시작점(In point) 설정
- O 키: 종료점(Out point) 설정
- L 키: 구간 반복 토글
- 타임라인에 구간 시각적 표시
```

### 머지

머지 시에도 **한글**로 명확하게 작성합니다.

---

## 폴더 구조

```
BAEFRAME/
├── main/           # Electron Main Process
├── preload/        # Preload Scripts
├── renderer/       # UI (HTML/CSS/JS)
│   ├── scripts/
│   │   ├── modules/    # 기능 모듈
│   │   ├── services/   # 데이터 로직
│   │   └── utils/      # 유틸리티
│   └── styles/
├── web-viewer/     # 웹 뷰어
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
| `I/O/L` | 구간 반복 |

---

## 참고

- [GitHub Wiki](https://github.com/baehandoridori/BAEFRAME/wiki)
- [Web Viewer](https://baeframe.vercel.app)
