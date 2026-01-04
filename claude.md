# BAEFRAME 프로젝트 가이드

## 프로젝트 개요

BAEFRAME은 영상 리뷰/피드백 도구입니다.
- **데스크톱 앱**: Electron 기반
- **웹/모바일 뷰어**: 순수 HTML/CSS/JS + Google Drive API

---

## 커밋 & PR 규칙

### 커밋 메시지
- 모든 커밋 메시지는 **한글**로 작성
- 형식: `타입: 내용`
- 타입:
  - `기능추가` - 새로운 기능
  - `버그수정` - 버그 픽스
  - `리팩토링` - 코드 개선 (기능 변화 없음)
  - `문서수정` - 문서 변경
  - `스타일` - UI/CSS 변경
  - `기타` - 그 외

```
예시:
기능추가: 전체화면 모드 구현
버그수정: 댓글 저장 시 빈 텍스트 방지
리팩토링: 댓글 매니저 클래스 분리
```

### PR (Pull Request)
- PR 제목: 한글로, 변경사항 요약
- PR 본문에 포함할 내용:
  - 작업한 항목 목록
  - 변경된 파일과 이유
  - 테스트 방법 (있다면)

---

## 환경 변수

### 필수 환경 변수
현재 별도의 `.env` 파일은 사용하지 않습니다.

### Google API (웹 뷰어)
`web-viewer/scripts/app.js`에 하드코딩되어 있음:
- `CLIENT_ID`: Google OAuth 클라이언트 ID
- `API_KEY`: Google API 키

> ⚠️ 프로덕션 배포 시 환경 변수로 분리 권장

### 개발 모드
```javascript
process.env.NODE_ENV === 'development'
```

---

## 주요 파일 구조

```
BAEFRAME/
├── main/                    # Electron 메인 프로세스
│   ├── main.js
│   ├── window.js
│   └── ipc-handlers.js
├── renderer/                # 데스크톱 앱 UI
│   ├── index.html
│   ├── scripts/
│   │   ├── app.js          # 메인 앱 로직
│   │   └── modules/        # 모듈들
│   └── styles/
│       └── main.css
├── web-viewer/              # 웹/모바일 뷰어
│   ├── index.html
│   ├── scripts/
│   │   └── app.js
│   └── styles/
│       └── main.css
└── preload/
    └── preload.js
```

---

## 개발 명령어

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 빌드
npm run build
```

---

## 주요 단축키 (데스크톱 앱)

| 단축키 | 기능 |
|--------|------|
| `Space` | 재생/일시정지 |
| `C` | 댓글 모드 토글 |
| `F` | 전체화면 토글 |
| `ESC` | 전체화면 해제 |
| `←/→` | 프레임 이동 |
| `I` | In 포인트 설정 |
| `O` | Out 포인트 설정 |
| `L` | 구간 반복 토글 |

---

## TODO (향후 작업)

- [ ] 자동 저장 상태 표시
- [ ] 네트워크 연결 상태 표시
- [ ] @멘션 기능
- [ ] 단축키 안내 오버레이
- [ ] 단축키 사용자 설정화
- [ ] 폰트 크기 조절
- [ ] 최근 파일 목록
- [ ] Ctrl+Z/Y Undo/Redo
