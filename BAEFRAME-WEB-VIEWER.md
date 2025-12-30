# BAEFRAME 웹 뷰어 개발 계획

> **목적:** BAEFRAME의 웹 기반 뷰어를 개발하여 앱 설치 없이 브라우저/모바일에서 영상 리뷰 가능하게 함

---

## 1. 배경 및 동기

### 현재 상황
- BAEFRAME은 Electron 기반 데스크톱 앱
- 팀원들이 리뷰하려면 앱 설치 필요
- 모바일에서 확인 불가
- Slack에서 영상 공유 후 별도로 앱을 열어야 함

### 요구사항
- 앱 설치 없이 브라우저에서 리뷰 확인
- 모바일 지원
- Slack 공유 링크 → 바로 웹에서 열기
- 기존 .bframe 파일 호환

### 제약사항
- 별도 서버/DB 구축 최소화
- 기존 Google Drive 워크플로우 유지
- 팀 내부 사용 (인증 불필요 또는 Google 로그인만)

---

## 2. 아키텍처

### 현재 구조
```
┌─────────────────────────────────────────────────────────┐
│                    현재 워크플로우                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Google Drive          BAEFRAME Desktop                 │
│  ┌──────────┐         ┌──────────────────┐              │
│  │ 영상.mp4  │────────▶│ 로컬 다운로드     │              │
│  │ 영상.bframe│        │ 재생 + 편집       │              │
│  └──────────┘         └──────────────────┘              │
│                                                         │
│  문제: 앱 설치 필수, 모바일 불가                          │
└─────────────────────────────────────────────────────────┘
```

### 목표 구조
```
┌─────────────────────────────────────────────────────────┐
│                    목표 워크플로우                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Google Drive                                           │
│  ┌──────────┐                                           │
│  │ 영상.mp4  │─────┬────────────────────────────────┐   │
│  │ 영상.bframe│    │                                │   │
│  └──────────┘     │                                │   │
│                   ▼                                ▼   │
│         ┌──────────────────┐         ┌──────────────┐  │
│         │ BAEFRAME Desktop │         │ BAEFRAME Web │  │
│         │ (편집용 - 풀기능) │         │ (리뷰용)      │  │
│         └──────────────────┘         └──────────────┘  │
│                                       - 브라우저 OK    │
│                                       - 모바일 OK      │
│                                       - 설치 불필요    │
└─────────────────────────────────────────────────────────┘
```

### 데이터 흐름
```
┌─ 서버리스 아키텍처 ──────────────────────────────────────┐
│                                                         │
│  "서버" = Google Drive (이미 사용 중)                    │
│                                                         │
│  ┌──────────────┐                                       │
│  │ Google Drive │◀──────────────────────────────┐      │
│  │              │                               │      │
│  │  영상.mp4    │──┬──▶ Desktop: 읽기/쓰기      │      │
│  │  영상.bframe │  │                            │      │
│  │              │  └──▶ Web: 읽기 (+ 쓰기*)     │      │
│  └──────────────┘                               │      │
│         ▲                                       │      │
│         │                                       │      │
│         └───────────────────────────────────────┘      │
│                    동일한 파일 = 자동 동기화             │
│                                                         │
│  * 쓰기는 2단계에서 Google Drive API로 구현              │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 기능 범위

### 데스크톱 vs 웹 기능 비교

| 기능 | Desktop (편집) | Web 1단계 (읽기) | Web 2단계 (쓰기) |
|------|---------------|-----------------|-----------------|
| 영상 재생 | ✅ | ✅ | ✅ |
| 재생 속도 조절 | ✅ | ✅ | ✅ |
| 타임라인 탐색 | ✅ | ✅ | ✅ |
| 댓글 보기 | ✅ | ✅ | ✅ |
| 댓글 작성 | ✅ | ❌ | ✅ |
| 댓글 수정/삭제 | ✅ | ❌ | ✅ |
| 그리기 레이어 보기 | ✅ | ✅ | ✅ |
| 그리기 편집 | ✅ | ❌ | ❌ (3단계) |
| 키프레임 보기 | ✅ | ✅ | ✅ |
| 키프레임 편집 | ✅ | ❌ | ❌ (3단계) |
| 로컬 파일 열기 | ✅ | ❌ | ❌ |
| Google Drive 연동 | ❌ | ✅ (읽기) | ✅ (읽기/쓰기) |
| 모바일 지원 | ❌ | ✅ | ✅ |
| 오프라인 지원 | ✅ | ❌ | ❌ |

---

## 4. 개발 단계

### 1단계: 웹 뷰어 (읽기 전용) - 우선순위 높음
**목표:** 브라우저에서 영상 + .bframe 파일 확인

**기능:**
- [ ] HTML5 비디오 플레이어
- [ ] .bframe 파일 파싱 및 표시
- [ ] 댓글 목록 표시 (타임라인 마커 포함)
- [ ] 그리기 레이어 표시 (Canvas)
- [ ] 키프레임 애니메이션 재현
- [ ] 반응형 UI (모바일 대응)

**기술 스택:**
```
프론트엔드:
├── HTML5 / CSS3 / Vanilla JS (또는 간단한 프레임워크)
├── 기존 renderer/ 코드 재사용 가능
├── Canvas API (그리기 레이어)
└── Video.js 또는 기본 HTML5 <video>

호스팅 (정적 사이트, 무료):
├── Vercel (추천)
├── Netlify
├── GitHub Pages
└── Firebase Hosting
```

**URL 구조:**
```
https://baeframe.vercel.app/view?
  video=https://drive.google.com/uc?id=VIDEO_FILE_ID
  bframe=https://drive.google.com/uc?id=BFRAME_FILE_ID
```

**예상 기간:** 1-2주

---

### 2단계: Google Drive 연동 (댓글 쓰기)
**목표:** 웹에서 댓글 추가 → Google Drive에 저장

**기능:**
- [ ] Google Sign-in 연동
- [ ] Google Drive API로 .bframe 읽기
- [ ] 댓글 추가 후 .bframe 저장
- [ ] 충돌 방지 (저장 전 최신 버전 병합)

**기술 요구사항:**
```javascript
// Google Drive API 사용 예시
async function loadBframe(fileId) {
  const response = await gapi.client.drive.files.get({
    fileId: fileId,
    alt: 'media'
  });
  return JSON.parse(response.body);
}

async function saveBframe(fileId, data) {
  // 저장 전 최신 버전 가져오기 (충돌 방지)
  const latest = await loadBframe(fileId);

  // 새 댓글만 병합 (기존 댓글 유지)
  const merged = mergeComments(latest, data);

  await gapi.client.request({
    path: `/upload/drive/v3/files/${fileId}`,
    method: 'PATCH',
    params: { uploadType: 'media' },
    body: JSON.stringify(merged)
  });
}

function mergeComments(server, local) {
  // ID 기반 병합 - 새 댓글 추가, 기존 댓글 유지
  const serverIds = new Set(server.comments.map(c => c.id));
  const newComments = local.comments.filter(c => !serverIds.has(c.id));

  return {
    ...server,
    comments: [...server.comments, ...newComments]
  };
}
```

**필요한 설정:**
1. Google Cloud Console에서 프로젝트 생성
2. Google Drive API 활성화
3. OAuth 2.0 클라이언트 ID 생성
4. 승인된 도메인 추가 (baeframe.vercel.app 등)

**예상 기간:** 1주

---

### 3단계: 고급 기능 (선택적)
**목표:** 웹에서도 간단한 편집 가능

**기능:**
- [ ] 간단한 그리기 도구 (펜, 화살표)
- [ ] 키프레임 추가
- [ ] 실시간 협업 (WebSocket - 서버 필요)

**예상 기간:** 2-3주 (서버 필요 시 추가 시간)

---

## 5. 공유 워크플로우

### Slack 연동 시나리오

```
1. 편집자가 Google Drive에 영상 업로드
   └── project_v2.mp4
   └── project_v2.bframe

2. 공유 링크 생성 (데스크톱 앱 또는 웹에서)
   https://baeframe.vercel.app/view?video=...&bframe=...

3. Slack에 링크 공유
   ┌────────────────────────────────────────┐
   │ 🎬 project_v2 리뷰 요청                 │
   │                                        │
   │ https://baeframe.vercel.app/view?...   │
   │                                        │
   │ → 클릭하면 브라우저에서 바로 열림        │
   │ → 모바일에서도 확인 가능                │
   └────────────────────────────────────────┘

4. 팀원이 웹에서 리뷰
   - 영상 재생
   - 댓글 확인
   - (2단계 이후) 댓글 추가

5. 상세 편집이 필요하면 데스크톱 앱에서
```

### 링크 생성 방법

**옵션 A: 수동 생성**
```
Google Drive에서 파일 ID 복사 후 URL 조합
```

**옵션 B: 데스크톱 앱에서 생성 (권장)**
```
BAEFRAME 데스크톱 → "웹 링크 복사" 버튼
→ 클립보드에 https://baeframe.vercel.app/view?... 복사됨
```

**옵션 C: Slack Bot (고급)**
```
/baeframe share project_v2.mp4
→ Bot이 자동으로 링크 생성 및 공유
```

---

## 6. 기술적 고려사항

### Google Drive 영상 스트리밍

```
문제: Google Drive 직접 링크가 CORS 제한될 수 있음

해결책 1: Google Drive 공유 설정
- "링크가 있는 모든 사용자" 권한 필요
- URL 형식: https://drive.google.com/uc?id=FILE_ID

해결책 2: Google Drive API 사용
- OAuth 인증 후 API로 스트리밍
- CORS 문제 없음, 하지만 로그인 필요

해결책 3: 프록시 서버 (비추천)
- 별도 서버 필요
- 비용 발생
```

### .bframe 파일 접근

```javascript
// 공개 링크로 접근 (1단계)
async function loadBframeFromUrl(url) {
  const response = await fetch(url);
  return await response.json();
}

// Google Drive API로 접근 (2단계)
async function loadBframeFromDrive(fileId) {
  // Google 로그인 필요
  const response = await gapi.client.drive.files.get({
    fileId: fileId,
    alt: 'media'
  });
  return JSON.parse(response.body);
}
```

### 동시 편집 충돌 방지

```
전략: Last-Write-Wins + Comment Merge

1. 저장 전 항상 최신 버전 fetch
2. 댓글은 ID 기반으로 병합 (추가만, 덮어쓰기 안 함)
3. 그리기 레이어는 웹에서 편집 불가 (충돌 원천 차단)

┌─────────────────────────────────────────┐
│  User A                    User B       │
│    │                         │          │
│    │  댓글 "수정 필요"        │          │
│    ├────────▶ Drive          │          │
│    │                         │          │
│    │          댓글 "OK" ◀────┤          │
│    │                         │          │
│    │  병합된 결과:            │          │
│    │  - "수정 필요"           │          │
│    │  - "OK"                 │          │
└─────────────────────────────────────────┘
```

---

## 7. 코드 재사용 계획

### 재사용 가능한 기존 코드

```
renderer/scripts/
├── modules/
│   ├── bframe-file.js      ✅ 거의 그대로 사용 (파일 파싱)
│   ├── comment-manager.js  ✅ 댓글 로직 재사용
│   ├── drawing-layer.js    ✅ Canvas 렌더링 재사용
│   └── timeline.js         ⚠️ 일부 수정 필요 (Electron 의존성 제거)
│
├── app.js                  ⚠️ 웹용으로 리팩토링 필요
└── ...

renderer/styles/
└── main.css               ✅ 대부분 재사용 가능
```

### 수정 필요한 부분

```javascript
// Electron 의존성 제거 예시

// Before (Electron)
const { ipcRenderer } = require('electron');
ipcRenderer.invoke('open-file', path);

// After (Web)
async function openFile(url) {
  const response = await fetch(url);
  return await response.json();
}
```

---

## 8. 배포 계획

### Vercel 배포 (권장)

```bash
# 프로젝트 구조
baeframe-web/
├── index.html
├── styles/
│   └── main.css
├── scripts/
│   ├── app.js
│   └── modules/
└── vercel.json

# 배포
npm i -g vercel
vercel --prod
```

### 도메인 옵션

```
무료: baeframe.vercel.app
커스텀: baeframe.yourdomain.com (도메인 비용만)
```

---

## 9. 체크리스트

### 1단계 시작 전 확인사항

- [ ] Google Drive 파일 공유 설정 확인 ("링크가 있는 모든 사용자")
- [ ] 기존 renderer 코드 중 재사용 가능 부분 분리
- [ ] Vercel 계정 생성

### 1단계 완료 기준

- [ ] URL로 영상 + .bframe 열기 가능
- [ ] 댓글 목록 표시
- [ ] 그리기 레이어 표시
- [ ] 모바일에서 정상 작동
- [ ] Slack에서 링크 공유 → 브라우저에서 열림

### 2단계 완료 기준

- [ ] Google 로그인 작동
- [ ] 웹에서 댓글 추가 가능
- [ ] 추가된 댓글이 .bframe 파일에 저장됨
- [ ] 데스크톱에서 저장된 댓글 확인 가능

---

## 10. 관련 문서

- [TODO.md](./TODO.md) - 전체 개발 TODO
- [baeframe-dev-docs.md](./baeframe-dev-docs.md) - 개발 문서
- [Slack Video Block 문서](https://docs.slack.dev/reference/block-kit/blocks/video-block/)
- [Google Drive API 문서](https://developers.google.com/drive/api/v3/reference)

---

*최초 작성: 2024-12-30*
*목적: 웹 뷰어 개발 계획 및 컨텍스트 인수인계*
