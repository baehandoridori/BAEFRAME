# 웹 뷰어

앱 설치 없이 브라우저에서 BAEFRAME을 사용하는 방법을 안내합니다.

---

## 목차

- [개요](#개요)
- [접속 방법](#접속-방법)
- [사용법](#사용법)
- [기능](#기능)
- [단축키](#단축키)
- [Google Drive 연동](#google-drive-연동)
- [모바일 사용](#모바일-사용)

---

## 개요

**BAEFRAME 웹 뷰어**는 Desktop 앱 없이도 영상 리뷰가 가능한 웹 버전입니다.

**주소**: [baeframe.vercel.app](https://baeframe.vercel.app)

### Desktop vs Web

| 기능 | Desktop | Web |
|------|:-------:|:---:|
| 영상 재생 | ● | ● |
| 댓글 보기 | ● | ● |
| 댓글 작성 | ● | ● |
| 그리기 보기 | ● | ● |
| 그리기 편집 | ● | ○ (간단) |
| 모바일 지원 | ✕ | ● |
| 오프라인 | ● | ✕ |

---

## 접속 방법

### 방법 1: 직접 접속

1. [baeframe.vercel.app](https://baeframe.vercel.app) 접속
2. 영상 URL 입력
3. .bframe URL 입력 (또는 `sample://test` 로 테스트)
4. "열기" 클릭

### 방법 2: 공유 링크

Desktop 앱에서 "웹 링크 복사" → Slack에서 클릭 → 웹에서 바로 열림

---

## 사용법

### 영상 열기

```
┌─────────────────────────────────────┐
│  BAEFRAME Web Viewer                │
├─────────────────────────────────────┤
│                                     │
│  영상 URL:                          │
│  [drive.google.com/uc?id=...]       │
│                                     │
│  .bframe URL:                       │
│  [drive.google.com/uc?id=...]       │
│                                     │
│            [열기]                   │
└─────────────────────────────────────┘
```

### 테스트

.bframe URL에 `sample://test` 입력 → 샘플 데이터로 UI 확인

---

## 기능

### 구현됨

- **영상 재생**: 재생/일시정지, 타임라인 탐색
- **프레임 이동**: ← → 키로 1프레임씩
- **댓글**: 목록 표시, 클릭 이동, 추가/수정/삭제, 답글
- **그리기**: 보기 + 간단한 펜
- **반응형**: 모바일 UI 지원

### 예정

- Google Drive 로그인 연동
- .bframe 파일 자동 저장
- 충돌 방지 로직

---

## 단축키

| 키 | 기능 |
|:--:|------|
| `Space` | 재생/일시정지 |
| `←` | 1프레임 뒤로 |
| `→` | 1프레임 앞으로 |
| `Shift + ←` | 10프레임 뒤로 |
| `Shift + →` | 10프레임 앞으로 |
| `C` | 댓글 추가 |
| `D` | 그리기 모드 |
| `Ctrl + S` | 저장 |

---

## Google Drive 연동

### 영상 공유 설정

1. Google Drive에서 영상 파일 우클릭
2. "공유" → "링크가 있는 모든 사용자"로 변경
3. 링크 복사

### URL 형식

```
원본: https://drive.google.com/file/d/FILE_ID/view

변환: https://drive.google.com/uc?id=FILE_ID
```

### .bframe 파일도 동일하게

```
영상.mp4     → 공유 설정 → URL 복사
영상.bframe  → 공유 설정 → URL 복사
```

---

## 모바일 사용

웹 뷰어는 모바일 브라우저에서도 정상 작동합니다.

### 지원 환경

- iOS Safari
- Android Chrome
- 태블릿

### 터치 조작

- **탭**: 재생/일시정지
- **스와이프**: 타임라인 이동
- **핀치**: 줌 (타임라인)

---

## 로컬 테스트

개발 시 로컬에서 테스트:

```bash
cd web-viewer
python -m http.server 8080
# 또는
npx serve .
```

`localhost`에서는 Google 로그인 없이 테스트 가능합니다.

---

## 파일 구조

```
web-viewer/
├── index.html          # 메인 HTML
├── styles/
│   └── main.css        # 스타일
└── scripts/
    └── app.js          # 로직
```

---

[Home](Home) · [시작하기](Getting-Started) · [기능 상세](Features) · [아키텍처](Architecture)
