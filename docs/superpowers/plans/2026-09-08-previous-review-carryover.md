# 이전 리뷰 확인 구현 계획

> **현재 구현 상태:** 옵션·타임라인 목업을 사용자가 승인해 실제 앱에 통합했다. [최신 구현과 검증](../../../DEVLOG/2026-09-08-이전-리뷰-타임라인-통합.md)을 기준으로 한다. 아래 ‘아직 통합하지 않았다’는 문장은 목업 단계의 과거 상태이며 현재 상태가 아니다.

> **최신 사용자 변경 요청 (2026-09-08 추가 시연 피드백):** 합쳐 보기 전용 방침을 철회하고 분리/합쳐/팝업 보기 선택을 복원한다. 버전과 보기 옵션은 작은 팝업으로 옮기는 구성을 검토한다. 타임라인에는 이전 버전의 출처와 해결 여부가 구분되는 표시가 필요하다. 원본의 미해결/해결 상태 계승과 버전만 표시하는 배지는 유지하며 별도 검수 상태는 도입하지 않는다. 조작 가능한 [옵션·타임라인 목업](../../../DEVLOG/2026-09-08-이전-리뷰-옵션-타임라인-목업.md)을 추가했으며 실제 앱 통합은 아직 하지 않았다.

> **직전 구현 기준 (2026-09-08 시연 후):** 아래 최초 계획의 분리/팝업 보기와 별도 검수 상태는 취소했다. 합쳐 보기만 제공하며 배지는 `v3`처럼 버전만 표시한다. 이어받을 때 원래 미해결·해결을 유지하고, 이후 같은 두 상태로 변경한다. 별도 확인 목록 대신 현재 댓글과 시간순으로 한 번씩 표시한다. 리뷰 본문 클릭도 현재 영상의 대응 시간으로 이동한다. 이전 리뷰가 있을 때만 표시되는 진입 토글은 유지한다. `.bframe`의 기존 필드 값은 호환성을 위해 유지한다.

사용자는 2026-09-08 목업을 승인하고 실제 구현을 요청했다. 기준 문서는 `DEVLOG/2026-09-08-이전-버전-리뷰-목업.md`이며 이 요청으로 목업 전용 범위를 실제 앱 구현으로 확장한다.

## 목표와 경계

여러 이전 버전의 원문을 읽고, 선택한 지적을 현재 영상에서 검수한다. 원본 댓글과 해결 상태는 수정하지 않는다. 현재 댓글로 복제하지 않는다. 분리/합쳐/팝업 보기, 버전 다중 선택, 원본 미해결 필터, 답글/이미지, 명시적 일괄/개별 이어받기, 검수 상태, 취소를 제공한다. 참고 버전 선택 해제 후에도 이어받은 목록은 유지한다. 과거 드로잉을 현재 드로잉에 합치지 않는다. PR/배포/Slack 발송은 범위 밖이다.

## Task 1: 저장 모델과 리뷰 저장 연결

담당 파일: 새 `shared/review-carryover.js`, 새 `renderer/scripts/modules/review-carryover-manager.js`, `shared/bframe-root-envelope.js`, `shared/schema.js`, `shared/validators.js`, `renderer/scripts/modules/review-data-manager.js`, 관련 저장 테스트, `docs/bframe-schema.md`.

필드 이름은 `reviewCarryoverV1`, 값은 `{version:1,items:[...]}`. 기존 루트 포맷은 유지한다. 삭제는 tombstone으로 보존하며 원본/현재 댓글 컬렉션은 변경하지 않는다. 항목 ID는 Windows 경로 정규화(대소문자/슬래시)한 원본 영상 경로와 원본 댓글 ID의 조합이다. reviewDocumentId는 출처 정보로 기록하되, 복제된 파일이 같은 문서 ID를 가질 수 있으므로 버전 경로를 생략하지 않는다.

공유 모듈 API:

- `createPreviousReviewSources(reviewData, versionInfo)` → snapshot 배열. `versionInfo`는 `{path,displayLabel?,version?,fileName?}`. 삭제된 마커/답글 제외. v1 레거시 comments 정규화 지원.
- snapshot 필드: `{key,sourcePath,sourceLabel,sourceDocumentId,commentId,author,text,startFrame,fps,resolved,images,replies}`. images는 안전한 이미지 URL 문자열 배열; replies는 `{id,author,text,images}` 배열. 누락 FPS는 리뷰 루트 FPS 다음 24 사용. marker frame도 지원. 안전한 raster data URI 외 첨부는 기존 앱이 지원하는 안전 범위로 한정한다.
- `mergeReviewCarryover(base,local,remote)` → root value. 변경되지 않은 쪽이 변경된 쪽을 덮지 않고, 다른 항목의 병행 변경을 보존하며, 충돌시 결정적 결과. 취소 후 낡은 파일이 항목을 복원하지 않아야 한다.

매니저 API: `new ReviewCarryoverManager()`, `getItems()`(삭제 제외), `hasSource(key)`, `carry(source,actor='')`, `setStatus(id,status,actor='')`, `remove(id,actor='')`, `toJSON()`, `fromJSON(value)`, `reset()`. 항목 `{id,source,status,updatedAt,updatedBy,deleted,...conflictMetadata}`. `pending/verified/needs-fix` 외 상태 거부. 변경 이벤트 이름 `changed`, 로드/초기화 이벤트 이름 `loaded`. fromJSON/reset은 사용자 변경으로 저장하지 않는다. 반환값은 복제하여 외부 변이 방지. 중복 carry는 기존 검수 상태 보존, 취소 후 다시 carry는 pending.

ReviewDataManager 옵션 `reviewCarryoverManager` 추가. connect/disconnect, merge base(수락한 상태 포함), 수집, save 중 변경 보존, load, external merge, 새 영상 초기화, substantive content에 연결한다. 매니저 없는 구버전 호출자는 새 필드를 손실 없이 보존한다. 미지원/손상 payload를 조용히 빈 목록으로 저장하지 않는다. 현재 저장 CAS와 파일 감시 협업 경로를 사용한다.

검증은 RED 테스트부터 작성: 원본 불변, 삭제 제외/레거시/FPS, 중복/취소/재추가, 상태 검증, roundtrip, 병행 항목 변경, 삭제 충돌, 원본 없는 재로드, 첫 이어받기로 새 파일 생성, 저장 중 추가 변경과 영상 전환 경계. 기존 root/save 테스트도 통과해야 한다.

## Task 2: 실제 댓글 패널 UI와 앱 연결

담당 파일: 새 `renderer/scripts/modules/previous-review-panel.js`, 새 `renderer/styles/previous-review.css`, `renderer/scripts/app.js`, `renderer/index.html`, `renderer/comment-panel.html`, UI 테스트와 필요시 기존 팝업 모듈.

독립 UI 모듈이 현재 버전 문맥과 읽기 API를 주입받아 소스 선택 및 참조 표시를 담당한다. 데이터 저장은 Task 1 매니저만 호출한다. 현재 영상/요청 세대를 확인해 선택 취소·파일 전환 후 늦은 읽기 응답을 무시한다. 읽기 실패/빈 목록/로딩/다시 읽기를 표시한다. 원문은 textContent로 렌더링하며 안전한 첨부만 표시한다.

현재 댓글 영역 위에 이번 버전 확인 목록을 두고, 각 항목에 원본 버전/작성자/원본 상태/시간, 검수 상태 선택과 취소를 표시한다. 별도 상태 기준을 명시한다. 분리 보기 기본값, 합쳐 보기는 현재 댓글 DOM과 초 단위로 정렬하되 원본 코멘트 이벤트와 ID를 섞지 않는다. 팝업은 실제 mpv 영상 위에서도 읽고 조작할 수 있는 기존 보호 창 경로 활용 여부를 검증하고 필요한 조정을 기록한다. 현재 댓글 별도 창 기능과 충돌하지 않아야 한다.

시간 버튼은 목적지를 현재 버전으로 명시하고 원본 FPS를 초로 변환하여 현재 FPS에 맞춘다. 영상 길이 밖/알 수 없는 시간은 비활성화하고 이유를 쓴다. 동일 시간은 동일 장면이 아닐 수 있음을 표시한다. 필터/모드/선택은 검수 큐를 삭제하지 않는다. playlist/cutlist 전체 댓글에서는 현재 단일 영상의 이전 리뷰임을 명시하거나 안전하게 숨긴다.

검증은 jsdom에서 실제 모듈 동작을 실행: 다중 선택, 3가지 모드, source immutable, pending 기본값, filter 독립, original resolved carry, dedup, cancel, late response fence, bounds/FPS, XSS, detach/redock. 브라우저에서 실제 모듈과 스타일을 연결한 테스트 페이지로 주요 흐름과 레이아웃 확인.

## Task 3: 통합 검증과 기록

최신 main 53062c8, 2.10.0-beta에서 시작한다. 베이스라인 root/save/version/popout 테스트: 111 pass, 0 fail, 0 cancelled, 종료 코드 0. 기존 팀원 전혜림 / U07NBHXV2UW 변경을 보존한다.

저장/버전/댓글 팝업 관련 회귀, 변경 파일 문법/린트, diff 공백 검사를 실행한다. 파일 저장 및 동시 수정 테스트와 브라우저 UI 검증을 구분한다. 구현 사양 및 품질 리뷰를 거쳐 문제를 수정한다. DEVLOG에 근거를 기록하고 실제 Electron/mpv 검증 여부를 명시한다. main 작업 폴더는 보존하고 기능 worktree에서 결과를 제공한다.
