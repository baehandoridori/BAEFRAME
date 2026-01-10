# 기술적 안정성 및 보안 개선 작업

> 작성일: 2026-01-09
> 브랜치: `claude/fix-data-loss-security-E567p`

---

## 배경

GPT 기반 코드 리뷰에서 발견된 이슈들을 Claude가 검증 후 수정 진행.

## 발견된 이슈 및 검증 결과

| # | 이슈 | 심각도 | 검증 결과 |
|---|------|--------|----------|
| 1 | 파일 전환 시 데이터 유실 | ❌ 심각 | 확인됨 - 저장 순서 버그 |
| 2 | 작성자 문자열 HTML 주입 (XSS) | ❌ 보안 위험 | 확인됨 - escapeHtml 미적용 |
| 3 | 미사용 파일 4개 존재 | ⚠️ 중간 | 확인됨 - 데드 코드 |
| 4 | 썸네일 이벤트 리스너 누적 | ⚠️ 중간 | 부분 확인 - 중단 시 누수 |
| 5 | autoSaveDelay 성능 | ⚠️ 낮음 | 개선 가능 |

---

## Phase 1: 긴급 수정 (1~3번)

### 1.1 데이터 유실 버그 수정

**문제:**
- `loadVideo()`에서 매니저들을 `clear()` 한 뒤 `reviewDataManager.setVideoFile()` 호출
- `setVideoFile()` 내부에서 `isDirty` 시 `save()` 호출
- 이미 clear된 상태에서 저장 → 빈 데이터가 .bframe에 기록됨

**수정 위치:**
- `renderer/scripts/app.js` - `loadVideo()` 함수 (line 2030~)
- `renderer/scripts/modules/review-data-manager.js` - `setVideoFile()` (line 126~)

**수정 내용:**
```javascript
// app.js - loadVideo() 시작부에서 저장을 먼저 수행
async function loadVideo(filePath) {
  // 1. 이전 데이터 저장 (clear 전에!)
  if (reviewDataManager.hasUnsavedChanges()) {
    const saved = await reviewDataManager.save();
    if (!saved) {
      const proceed = await showConfirmModal('저장 실패', '저장에 실패했습니다. 그대로 전환할까요?');
      if (!proceed) {
        return; // 전환 취소
      }
    }
  }

  // 2. 자동 저장 일시 중지
  reviewDataManager.pauseAutoSave();

  // 3. 이제 clear 수행
  commentManager.clear();
  // ...

  // 4. setVideoFile에 skipSave 옵션 전달
  const hasExistingData = await reviewDataManager.setVideoFile(filePath, { skipSave: true });
}
```

```javascript
// review-data-manager.js - skipSave 옵션 추가
async setVideoFile(videoPath, options = {}) {
  this._cancelAutoSave();
  this.isLoading = true;

  // skipSave가 true면 저장 건너뛰기 (외부에서 이미 저장함)
  if (!options.skipSave && this.isDirty && this.currentBframePath) {
    await this.save();
  }
  // ...
}
```

**검증 방법:**
- [ ] A.mp4에 댓글 추가
- [ ] B.mp4로 전환
- [ ] A.bframe 확인 → 댓글이 보존되어야 함

---

### 1.2 HTML 주입 (XSS) 취약점 수정

**문제:**
- `marker.author`, `reply.author`가 `escapeHtml()` 없이 innerHTML에 삽입
- 악의적인 .bframe 파일 공유 시 스크립트 실행 가능

**수정 위치:**
- `renderer/scripts/app.js` line 2548 (툴팁)
- `renderer/scripts/app.js` line 2795 (답글 작성자)
- `renderer/scripts/app.js` line 2842 (댓글 작성자)

**수정 내용:**
```javascript
// Before
<span class="tooltip-author ${authorClass}">${marker.author}</span>

// After
<span class="tooltip-author ${authorClass}">${escapeHtml(marker.author)}</span>
```

**검증 방법:**
- [ ] 작성자 이름에 `<img onerror=alert(1)>` 입력
- [ ] 댓글 목록/툴팁에서 스크립트 실행 안 됨 확인

---

### 1.3 미사용 파일 삭제

**대상 파일:**
- `shared/validators.js` - 스키마가 실제 포맷과 불일치, import 없음
- `shared/constants.js` - import 없음
- `shared/ipc-channels.js` - import 없음
- `renderer/scripts/icons.js` - import 없음

**작업:**
```bash
git rm shared/validators.js
git rm shared/constants.js
git rm shared/ipc-channels.js
git rm renderer/scripts/icons.js
```

---

## Phase 2: 개선 작업 (4~5번)

### 2.1 썸네일 리스너 누적 수정

**문제:**
- 싱글톤 `thumbnailGenerator`에 파일 전환마다 리스너 추가
- `clear()` 시 리스너 제거 안 함
- 생성 중단 시 `complete` 미호출로 `onProgress` 누적

**수정 위치:**
- `renderer/scripts/app.js` - `generateThumbnails()` (line 2118~)

**수정 내용:**
```javascript
// 이전 리스너 참조 저장용 (모듈 스코프)
let thumbnailListeners = {
  progress: null,
  quickReady: null,
  complete: null
};

function generateThumbnails(filePath) {
  const thumbnailGenerator = getThumbnailGenerator({...});

  // 이전 리스너 제거
  if (thumbnailListeners.progress) {
    thumbnailGenerator.removeEventListener('progress', thumbnailListeners.progress);
  }
  if (thumbnailListeners.quickReady) {
    thumbnailGenerator.removeEventListener('quickReady', thumbnailListeners.quickReady);
  }
  if (thumbnailListeners.complete) {
    thumbnailGenerator.removeEventListener('complete', thumbnailListeners.complete);
  }

  // 새 리스너 정의 및 등록
  thumbnailListeners.progress = (e) => { ... };
  thumbnailListeners.quickReady = () => { ... };
  thumbnailListeners.complete = () => { ... };

  thumbnailGenerator.addEventListener('progress', thumbnailListeners.progress);
  // ...
}
```

---

### 2.2 autoSaveDelay 성능 최적화

**현재:** 300ms (추정)
**변경:** 500ms

**수정 위치:**
- `renderer/scripts/modules/review-data-manager.js` 생성자

**수정 내용:**
```javascript
constructor(options = {}) {
  // ...
  this.autoSaveDelay = options.autoSaveDelay || 500; // 300 → 500
}
```

---

## 체크리스트

### Phase 1
- [x] 데이터 유실 버그 수정 ✅
- [x] XSS 취약점 수정 ✅
- [x] 미사용 파일 삭제 ✅
- [ ] 테스트 및 검증
- [x] 커밋 ✅

### Phase 2
- [x] 썸네일 리스너 수정 ✅
- [x] autoSaveDelay 조정 (100ms → 500ms) ✅
- [ ] 테스트 및 검증
- [x] 커밋 ✅

---

## 수정 요약 (2026-01-09)

### 변경된 파일
- `renderer/scripts/app.js` - loadVideo 저장 순서 수정, XSS 수정, 썸네일 리스너 정리
- `renderer/scripts/modules/review-data-manager.js` - skipSave 옵션 추가, autoSaveDelay 조정

### 삭제된 파일
- `shared/validators.js`
- `shared/constants.js`
- `shared/ipc-channels.js`
- `renderer/scripts/icons.js`

---

## 참고

- 원본 이슈 분석: GPT 코드 리뷰
- 검증: Claude (2026-01-09)
- file:// URL 문제, 스키마 검증, DOM 최적화는 보류 (실제 문제 발생 시 대응)
