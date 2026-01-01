# BAEFRAME 웹 뷰어

브라우저에서 BAEFRAME 영상 리뷰 기능을 사용할 수 있는 웹 버전입니다.

## 로컬 테스트 방법

### 1. 간단한 방법 (Python)

```bash
cd web-viewer
python -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속

### 2. Node.js 사용

```bash
cd web-viewer
npx serve .
```

브라우저에서 `http://localhost:3000` 접속

### 3. VS Code Live Server

VS Code에서 `index.html`을 열고 Live Server 확장 사용

## 테스트 방법

1. 웹 브라우저에서 열기
2. 영상 URL에 테스트용 URL 또는 Google Drive 공유 링크 입력
3. .bframe URL에 `sample://test` 입력 (샘플 데이터 사용)
4. "열기" 버튼 클릭

## 개발 모드

`localhost`에서 실행 시 Google API 인증 없이 테스트 가능합니다.
샘플 데이터로 UI와 기능을 확인할 수 있습니다.

## 파일 구조

```
web-viewer/
├── index.html          # 메인 HTML
├── styles/
│   └── main.css        # 스타일 (모바일 친화적)
├── scripts/
│   └── app.js          # 메인 애플리케이션 로직
└── README.md           # 이 문서
```

## 기능

### 구현됨
- [x] 영상 재생/일시정지
- [x] 타임라인 탐색
- [x] 프레임 단위 이동 (←→ 키)
- [x] 댓글 목록 표시
- [x] 댓글 클릭 → 해당 시간 이동
- [x] 댓글 추가/수정/삭제
- [x] 답글 (스레드)
- [x] 그리기 보기
- [x] 간단한 그리기 (펜)
- [x] 모바일 반응형 UI

### 예정
- [ ] Google Drive 연동 (로그인)
- [ ] .bframe 파일 저장
- [ ] 충돌 방지 로직

## 단축키

| 키 | 기능 |
|---|---|
| Space | 재생/일시정지 |
| ← | 1프레임 뒤로 |
| → | 1프레임 앞으로 |
| Shift+← | 10프레임 뒤로 |
| Shift+→ | 10프레임 앞으로 |
| C | 댓글 추가 |
| D | 그리기 모드 |
| Ctrl+S | 저장 |
