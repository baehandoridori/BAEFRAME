# 통합 계획 조사 근거

작성일: 2026-09-14. 기준 소스: `04e2a229bb1e85edac2a7c0f11bf9f294b796218`, 2.11.1-beta.

[통합 구현 계획](../2026-09-14-review-playback-input-plan.md)에 연결되는 자료다. 제품 코드 수정, 실제 앱 실행, 태블릿 조작, 빌드, 배포는 수행하지 않았다.

## 자동 테스트

| 로그 | 범위 | pass | fail | cancelled | 종료 코드 |
|---|---|---:|---:|---:|---:|
| [baseline.log](baseline.log) | playlist comment/core/runtime, review save | 245 | 0 | 0 | 0 |
| [input-baseline.log](input-baseline.log) | mention popout, pan, timeline/playhead | 26 | 0 | 0 | 0 |
| 합계 | 서로 다른 8개 테스트 파일 | 271 | 0 | 0 | 0 |

첫 baseline 실행은 새 worktree에 electron 모듈이 없어 1개 실패했다. 누락된 의존성을 확인한 뒤 기존 worktree의 node_modules를 NODE_PATH로 참조해 재실행했다. 위 로그는 재실행 결과다. 설치나 제품 코드 수정으로 우회하지 않았다.

실행 위치는 계획서가 있는 worktree의 루트다. 실제 실행한 명령은 아래와 같다. NODE_PATH는 각 실행 후 원래 값으로 복원했다.

```powershell
$previousNodePath = $env:NODE_PATH
$env:NODE_PATH = 'C:\Users\user\.codex\worktrees\baeframe-ux-first\BAEFRAME\node_modules'
try {
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/playlist-comment-index.test.js scripts/tests/playlist-continuous-core.test.js scripts/tests/playlist-continuous-runtime.test.js scripts/tests/review-data-manager-save.test.js
    # 실제 결과: exit 0, pass 245, fail 0, cancelled 0
    node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/mention-manager-popout.test.js scripts/tests/video-pan-controls.test.js scripts/tests/timeline-frame-ui-source.test.js scripts/tests/playhead-frame-step-source.test.js
    # 실제 결과: exit 0, pass 26, fail 0, cancelled 0
} finally {
    $env:NODE_PATH = $previousNodePath
}
```

이 절대 의존성 경로는 조사 당시 환경이다. 다른 PC/후속 worktree에서 없어졌다면 계획의 T0에 따라 의존성을 설치한다.

## 통제 재현

**이 스크립트들은 현행 오류가 재현되는지 검사한다. exit 0은 제품이 수정됐다는 뜻이 아니다.** 수정 후에는 T1~T9의 정상 동작 회귀 테스트로 대체한다. 기존 오류를 계속 유지하기 위한 CI 검사로 등록하지 않는다.

- [diagnose.cjs](diagnose.cjs): 실제 함수 본문과 playlist extractor를 사용하되 파일/저장 의존성은 통제한다. 실제 사용자 파일에는 쓰지 않는다.
- [diagnose-input.cjs](diagnose-input.cjs): 실제 MentionManager를 JSDOM에서 실행하고 timeline/Fabric 상태 함수 본문을 검사한다. NODE_PATH에 jsdom이 필요하다.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON docs/superpowers/plans/2026-09-14-playlist-review-evidence/diagnose.cjs
# exit 0
node docs/superpowers/plans/2026-09-14-playlist-review-evidence/diagnose-input.cjs
# jsdom을 읽을 수 있는 환경에서 exit 0
```

첫 스크립트 출력:

```json
{"assertions":6,"validFrame32":"00:00:01:08","missingFrame":"00:00:00:00","pendingSaveAfterModeExit":["refresh-current-mode","refresh-whole-playlist","render-continuous-list","steal-focus"],"currentEditorFrame":32,"aggregateFrameFromStaleDisk":0,"diskReads":1,"scope":"Real function bodies with controlled dependencies; no UI or production-file writes"}
```

두 번째 스크립트 출력:

```json
{"frameBoundary":{"requestedCell":58,"actualFrame":57},"releasePosition":{"lastMoveFrame":57,"releaseClientX":585,"lastMoveTimeReused":2.375},"mention":{"afterKoreanWithoutSpace":false,"composingEnterPrevented":true,"composingEnterInsertedMember":true},"fabricActive":{"isDrawMode":true,"legacyReadyAndCommentPassthrough":false},"scope":"Controlled source-body and JSDOM reproduction, not a physical tablet or native mpv test"}
```

## 기존 사용 로그와 리뷰 시간 필드

로컬 `C:\Users\user\AppData\Roaming\baeframe\logs\baeframe-2026-09-13.log`에서 IPC 완료 이벤트를 읽어 종류별 횟수·중앙값·p95·최댓값을 집계했다. 새로 측정한 전환 성능이 아니며 한 번의 클릭과 모든 호출을 연결한 추적 결과도 아니다. 요약 수치는 계획서 §2.2에 있다. 원본 사용 로그는 이 폴더에 복사하지 않았다.

최근 리뷰 6개에서는 댓글의 시간 필드만 읽었다. 삭제되지 않은 10개 중 실제 startFrame=0이 5개였고, 나머지에는32/81/93/123/278이 있었다. 사용자 이름·댓글 본문·이미지·업무 파일을 fixture로 복사하지 않았다. 이 표본으로 사용자가 본 모든 00 표시의 원인을 확정할 수는 없다.

## 미수행 검증

- 실제 앱에서 동일한 사용자 조작 재현, 실물 펜/태블릿, native mpv/Fabric 창 입력.
- 프레임 번호가 표시된 영상으로 실제 디코딩 프레임과 UI 비교.
- 같은 조건의 수정 전/후 전환 성능 비교, 다른 PC와 동시 편집, Slack 발송.
- 제품 코드 수정·번들 생성·패키지 빌드·PR·머지·배포.
