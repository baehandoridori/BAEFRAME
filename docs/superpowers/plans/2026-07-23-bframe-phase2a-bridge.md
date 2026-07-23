# `.bframe` Phase 2A 호환성 브리지 구현 계획

> 기준 설계: `docs/superpowers/specs/2026-07-17-fabric-drawing-surface-v3-design.md`의 15.3, Phase 2A

## 목표

Fabric 드로잉 저장을 켜기 전에, 현재 앱이 미래 필드를 이해하지 못하더라도 기존 `.bframe`을 열고 저장하는 과정에서 그 필드를 삭제하지 않게 한다.

이 단계에서 지킬 계약은 다음과 같다.

- `drawingsV3`는 읽거나 수정하지 않고 원문 객체를 그대로 통과시킨다.
- 알 수 없는 모든 최상위 필드를 보존한다.
- `reviewDocumentId`는 실제 저장이 필요한 순간 한 번만 생성하고 이후 유지한다.
- ID 생성만으로 dirty 상태가 되거나 새 `.bframe`이 생기지 않는다.
- 현재 앱보다 높은 top-level major version과 명시됐지만 해석할 수 없는 version 값은 자동으로 2.0으로 낮춰 저장하지 않는다. version 필드가 없는 실제 legacy만 허용한다.
- 기존 `drawings`와 Fabric 파일럿의 no-save 동작은 바꾸지 않는다.

## Task 1: 최상위 envelope codec

**파일**

- 새 파일: `shared/bframe-root-envelope.js`
- 수정: `shared/schema.js`
- 수정: `shared/validators.js`
- 수정: `docs/bframe-schema.md`
- 새 테스트: `scripts/tests/bframe-root-envelope.test.js`
- 수정: `package.json`

**먼저 작성할 실패 테스트**

1. `drawingsV3`와 임의 vendor 필드를 추출한 뒤 known root와 합치면 구조와 값이 그대로 유지된다.
2. opaque root에 known 필드 이름이 섞여도 canonical known 값이 우선한다.
3. v1/legacy → v2 마이그레이션 뒤에도 unknown subtree와 기존 `reviewDocumentId`가 유지된다.
4. obsolete `version`, `versions`는 opaque 필드로 다시 살아나지 않는다.
5. `3.0`처럼 지원하지 않는 미래 major는 v2로 마이그레이션하지 않는다.
6. `reviewDocumentId`는 `reviewdoc-<UUID>` 형식으로 한 번 생성되며 기존 값은 교체하지 않는다.
7. 빈 문자열이나 문자열이 아닌 `reviewDocumentId`는 validator error다.

**공개 API**

```js
KNOWN_BFRAME_ROOT_FIELDS
extractOpaqueBframeRoot(root)
mergeBframeRoot(opaqueRoot, knownRoot)
getUnsupportedBframeMajor(version, currentVersion)
createReviewDocumentId(randomUUID)
ensureReviewDocumentId(root, randomUUID)
isValidReviewDocumentId(value)
```

known root에는 `bframeVersion`, `version`, `reviewDocumentId`, 영상/시간/협업/버전 필드, `versions`, `comments`, `drawings`, `highlights`, `compositionLayers`를 포함한다. `drawingsV3`는 의도적으로 포함하지 않는다.

`migrateToV2()`는 opaque root를 먼저 복사하고 canonical v2 필드를 나중에 덮어쓴다. 지원하지 않는 미래 major는 명시적으로 실패시킨다.

## Task 2: ReviewDataManager 왕복 보존

**파일**

- 수정: `renderer/scripts/modules/review-data-manager.js`
- 수정: `scripts/tests/review-data-manager-save.test.js`

**내부 상태**

```js
this._opaqueRootFields = {};
this._reviewDocumentId = null;
this._reviewDocumentIdFactory = options.reviewDocumentIdFactory || createReviewDocumentId;
this._writeBlockedVersion = null;
```

**동작 순서**

1. 영상 변경 시 envelope 상태를 초기화한다.
2. load와 reload/merge에서 최신 root의 opaque 필드와 기존 ID를 캡처한다.
3. 이미 존재하는 파일은 저장 직전에 disk root를 다시 읽는다.
4. 최신 disk snapshot으로 opaque 필드를 교체한다. stale 메모리와 합집합하지 않는다.
5. 최신 disk read가 실패하면 unknown 손실 가능성이 있으므로 저장하지 않는다.
6. `_collectData()`는 opaque root 위에 현재 known 필드를 덮어쓴다.
7. 실제 저장 직전에 ID가 없을 때만 한 번 생성한다.
8. 저장 재시도는 같은 ID를 사용한다.
9. 저장 실패 사이에 realtime reload/merge가 들어와도 아직 disk에 기록되지 않은 로컬 ID를 유지한다.
10. 미래 major 또는 잘못된 기존 ID를 발견하면 `saveReview`를 호출하지 않는다.

**먼저 작성할 실패 테스트**

1. 기존 `drawingsV3`와 vendor 필드가 댓글 저장 후 동일하다.
2. load 뒤 외부에서 추가된 최신 unknown 필드도 저장 직전 refresh로 보존된다.
3. 최신 disk에서 삭제된 unknown 필드는 stale 메모리로 복구하지 않는다.
4. 기존 `reviewDocumentId`는 유지된다.
5. ID 없는 기존 파일은 다음 실제 저장에서 ID를 한 번만 생성한다.
6. 저장 실패와 재시도 사이에도 같은 ID를 사용한다.
7. 새 metadata-only 리뷰에는 ID도 파일도 생성되지 않는다.
8. 첫 저장 충돌 뒤 remote ID와 opaque root를 채택한다.
9. 미래 major 파일은 저장 호출 0회다.

## Task 3: ReviewDataManager 우회 저장 보호

**파일**

- 수정: `renderer/scripts/app.js`
- 수정: `scripts/tests/lazy-bframe-creation-source.test.js`

현재 열지 않은 재생목록 항목의 댓글 해결 상태를 저장하는 경로는 root 전체를 직접 읽고 저장한다. 이 경로도 미래 major를 먼저 차단하고 실제 저장 직전에 `ensureReviewDocumentId()`를 호출한 뒤 ID를 검증한다. 기존 ID는 교체하지 않고 unknown root는 원본 객체를 그대로 쓰므로 유지한다.

백업 파일 복사 경로는 원본 snapshot을 그대로 보존해야 하므로 ID 생성 대상에서 제외한다.

## Task 4: Web Viewer writer 보호

**파일**

- 새 파일: `web-viewer/scripts/bframe-write-guard.js`
- 수정: `web-viewer/scripts/app.js`
- 새 테스트: `scripts/tests/web-viewer-bframe-write-guard.test.js`

정적 배포되는 web-viewer는 desktop `shared/` 모듈을 함께 배포하지 않으므로, 작은 self-contained write guard를 둔다. desktop codec과 같은 버전/ID 규칙을 parity 테스트로 고정한다. 로컬 다운로드는 guarded serializer를 사용한다. Google Drive 저장은 PATCH 직전에 최신 root를 다시 GET하고, 최신 opaque root에 web-viewer의 known 필드만 합성한다. ID가 다르거나 사라졌거나 최신 GET이 실패하면 PATCH하지 않는다. 이로써 페이지를 연 뒤 다른 앱이 추가·삭제한 `drawingsV3`와 unknown 필드를 stale web state가 되살리거나 지우지 않는다.

모바일 자동 저장과 수동 저장은 같은 trailing single-flight coordinator를 사용한다. 동시에 여러 요청이 들어와도 PATCH는 한 번에 하나만 실행하고, 진행 중 들어온 요청은 다음 저장 한 번으로 합친다. PATCH를 기다리는 동안 바뀐 댓글·드로잉 known 필드는 snapshot 전체 대입으로 지우지 않고, 최신 opaque root와 현재 known 필드를 root identity를 유지한 채 다시 합친다.

각 저장 요청은 호출 시점의 fileId, document generation, root, token에 묶는다. GET 뒤 또는 PATCH 뒤 다른 파일로 전환되면 이전 요청은 새 문서 state에 적용하지 않는다. 지연된 `.bframe` load도 같은 generation guard로 이전 문서 응답이 새 문서를 덮지 못하게 한다. 최신 GET에서 확인한 remote reviewDocumentId는 PATCH가 실패해도 이미 disk에 존재한 계보 증거로 유지하며, 새로 생성한 ID만 PATCH 성공 전까지 unpersisted로 둔다.

## Task 5: 회귀 검증과 체크포인트

다음 순서로 검증한다.

```powershell
node --test scripts/tests/bframe-root-envelope.test.js
node --test scripts/tests/review-data-manager-save.test.js
node --test scripts/tests/lazy-bframe-creation-source.test.js
node --test scripts/tests/web-viewer-bframe-write-guard.test.js
npm run test:playlist
npm run test:drawing
npm run test:mpv
npm run test:hybrid
npm run lint
npm run build
git diff --check
```

독립 코드 리뷰에서 Critical/Important 지적이 없을 때만 Phase 2A를 커밋한다.

## 이 단계 뒤에도 남는 한계

- disk refresh와 일반 write 사이의 경쟁 조건은 아직 남는다.
- cross-process lock, fingerprint/CAS, atomic replace, recovery sidecar는 Phase 2B 범위다.
- Web Viewer의 stale load 중단이 상위 화면에 실패 토스트를 남길 수 있는 드문 UX와 video load 자체의 generation guard는 후속 UX 안정화 범위다.
- Fabric scene은 여전히 `.bframe`에 기록되지 않는다.
- Phase 2A 실사용 배포에서 unknown-field round-trip이 확인되기 전에는 `drawingsV3` writer를 켜지 않는다.
