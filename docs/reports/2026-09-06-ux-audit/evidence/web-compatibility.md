# 공개 웹 공유의 드로잉 호환성 근거

확인 시각: 2026-09-06 02:48:47 KST (`2026-09-05T17:48:47.542Z`).

## 결론

현재 공개 배포에는 실제 웹 뷰어가 있다. 그러나 웹 렌더 함수는 구형 `drawings` 배열만 읽으며, 데스크톱 앱에서 실제 저장한 유효한 `drawingsV3` 문서의 그림을 표시하지 않는다. 모바일은 공유 진입 페이지에서 웹 뷰어로 이동하므로 핵심 리뷰 공유 경로의 호환성 공백이다.

확인된 문제는 **그림 표시 누락**이다. 저장 보호 모듈은 알 수 없는 최상위 필드를 보존하며, 실제 네이티브 fixture의 `drawingsV3`도 그대로 유지했다. 이 결과를 데이터 삭제 문제로 표현하면 안 된다.

## 조사 범위와 네트워크 사용

- 공개 고정 URL 네 곳만 HTTP GET으로 읽었다. 쿼리 파라미터, 요청 본문, 인증 토큰을 보내지 않았다.
- 사용자의 실제 공유 링크, Google Drive 문서, 계정 또는 개인 자료를 열거나 외부로 보내지 않았다.
- 앱에서 만든 합성 UX 점검 문서 [native-drawing-sample.bframe](native-drawing-sample.bframe)를 로컬에서만 사용했다. fixture는 수정하지 않았다.
- Google 로그인용 제삼자 스크립트를 제외한 뷰어의 자체 모듈은 `app.js`와 여기서 가져오는 `bframe-write-guard.js`다. 둘 다 실제 배포본을 읽었다.
- 웹 검색 도구의 URL 열기는 실패했으나 PowerShell 및 Node의 직접 공개 HTTP GET은 성공했다. 원격 접근 자체가 막힌 상태가 아니다.

## 배포본 식별

| 공개 URL | HTTP | 응답 bytes | SHA-256 |
|---|---:|---:|---|
| [open.html](https://baeframe.vercel.app/open.html) | 200 | 9,660 | `0b78830654fc894814176263a966f3f113adefbf5928f7e4f02ff4f8538a3cad` |
| [index.html](https://baeframe.vercel.app/index.html) | 200 | 12,046 | `ae78d1ff181eeaddfb6dd4d7bfe6446fefd4c4e4c683d6052bfe71cf1e519948` |
| [scripts/app.js](https://baeframe.vercel.app/scripts/app.js) | 200 | 91,544 | `57b9bbbd6f7ba05642fa53ed8feaa8fcfef25408306b60c43c51f9cfd7892113` |
| [scripts/bframe-write-guard.js](https://baeframe.vercel.app/scripts/bframe-write-guard.js) | 200 | 10,941 | `0b9063cf0f09e42c56433054c31a01469c9ff69f6ed41067cb36ead33339772c` |

이 해시는 확인 시점의 배포본을 식별한다. URL의 이후 배포 상태까지 보장하지 않는다.

## 앱 실행 안내만 제공하는 사이트인가?

아니다. `open.html`은 다음 흐름을 구현한다.

1. `video`와 `bframe` URL 파라미터를 읽는다.
2. 모바일에서는 같은 사이트의 `index.html?video=...&bframe=...`로 이동한다.
3. 데스크톱에서는 `baeframe://open?video=...&bframe=...`를 시도하고, 앱 실행으로 판단되지 않으면 웹으로 폴백한다.

`index.html`에는 `<video id="videoPlayer">`, `<canvas id="drawingCanvas">`, 코멘트·그리기·저장 UI가 있고 `scripts/app.js`를 모듈로 불러온다. 따라서 웹 표시 호환성이 실제 공유 결과에 영향을 주는 구조다. 이 흐름은 배포 HTML/스크립트로 확인했으며 앱 설치 여부에 따른 브라우저 전환을 실제 조작한 것은 아니다.

## 드로잉 표시 함수의 결정적 근거

배포 `app.js` 2017~2047줄의 `renderDrawingForCurrentFrame()`에서 다음 순서가 확인된다.

```js
const drawings = state.bframeData?.drawings;
state.drawingContext.clearRect(0, 0, elements.drawingCanvas.width, elements.drawingCanvas.height);
if (!Array.isArray(drawings)) return;
const frameDrawing = drawings.find(d => d.frame === frame);
```

이후 해당 프레임의 `strokes.points`를 캔버스 선으로 그린다. 웹에서 새 그림을 작성하는 1973~1987줄도 구형 `drawings` 배열에 기록한다. `app.js`와 유일한 자체 모듈 의존성 `bframe-write-guard.js` 모두 `drawingsV3` 문자열이 **0회** 등장하며 V3를 웹 렌더 형식으로 변환하는 경로가 없다.

함수 추출 SHA-256: `9e99b0fb0c807c603fc688c306ec3e3cdcb4fc900e7722c7f4a96d8c24a7e4ec`.

## 실제 앱 저장 문서로 로컬 재검증

재현 스크립트: [web-compatibility-probe.cjs](web-compatibility-probe.cjs)

전체 결과: [web-compatibility-result.json](web-compatibility-result.json)

저장 문서: [native-drawing-sample.bframe](native-drawing-sample.bframe)

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON docs/reports/2026-09-06-ux-audit/evidence/web-compatibility-probe.cjs
```

명령 종료 코드 **0**. 검증식 **14개 통과 / 실패 0 / 취소 0**. Node test runner 테스트 개수와 혼동하지 않는다.

| 검증 | 결과 |
|---|---|
| fixture SHA-256 | `3245882d62e99b0cdfdffed1d6003501f301eabe241f0d47bcc405f180e20802` |
| 현재 데스크톱 `createFabricDrawingPersistenceStore().importRootValue()` 판정 | `accepted: true`, `compatible: true`, 상태 `ready` |
| 네이티브 드로잉 내용 | 24fps, 33프레임에 키프레임 1개·그림 객체 1개 |
| 같은 fixture의 구형 `drawings` 속성 | 배열이 아닌 레이어 객체이며, V3 그림이 이 속성에 이중 기록돼 있지 않음 |
| 배포 웹 함수에 fixture 전체와 33프레임 입력 | 계산 프레임 33, `clearRect` 1회, `stroke` 0회, `fill` 0회 |
| 같은 배포 함수에 구형 배열 형식의 양성 대조군 입력 | `stroke` 1회 |
| 검증 전후 fixture 파일 해시 | 일치 |

유효성 판정에는 현재 [fabric-drawing-persistence-store.js](../../../../renderer/scripts/modules/fabric-drawing-persistence-store.js)를 사용했다. 해당 모듈 SHA-256은 `7e35d7207ea5fffdb7fdf0bacfd92d8766348541190f2bf99367c2d83d50a21f`다.

양성 대조군은 렌더 함수가 실행되지 않아 0회가 나온 경우를 배제한다. 실제 앱에서 만든 문서는 데스크톱에서 유효한 그림으로 수용되지만, 웹 함수는 그 문서에서 그릴 내용을 찾지 못한다.

## 저장 보호 결과

배포 guard의 알려진 최상위 필드 목록에는 `drawings`가 있지만 `drawingsV3`는 없다. 68~85줄의 `extractOpaqueBframeRoot()`와 `mergeBframeRoot()`는 알려지지 않은 최상위 필드를 별도로 유지한다. 311~315줄의 Drive 저장 준비 과정은 최신 원본의 그러한 필드와 현재 웹 문서의 알려진 필드를 합친다.

네이티브 fixture를 최신 원본으로 두고, 로컬 복제에서 `drawingsV3`를 제외한 뒤 `prepareDriveBframeForWrite()`와 `serializeBframeForWrite()`를 **로컬 메모리에서만** 실행했다. 결과의 V3 내용 해시는 원본과 같았다.

```text
원본 V3 내용 SHA-256: fbd6cc266bb88000f50a97fc8a9da47b427598a45a2102e143ebda8d59221ece
보존 V3 내용 SHA-256: fbd6cc266bb88000f50a97fc8a9da47b427598a45a2102e143ebda8d59221ece
```

이 결과는 해당 문서·버전·ID 조건에서의 저장 준비 및 직렬화를 검증한다. 실제 Drive 동시 저장, 권한 오류, 네트워크 중단 등 외부 저장 전체를 검증한 결과는 아니다.

## 보고서에 반영할 사용자 영향과 후속 조치

- 사용자 영향: 데스크톱에서 그림으로 남긴 피드백을 웹·모바일 수신자가 놓칠 수 있다. 영상과 코멘트가 열려도 전체 리뷰가 전달됐다고 판단하면 안 된다.
- 우선 조치: 웹에서 현재 V3 문서를 읽고 표시하는 경로를 구현하고, 완료 전에는 이 형식의 그림이 표시되지 않는다는 안내를 제공한다.
- 수용 기준: 동일 `.bframe`의 프레임·좌표·그림 내용이 데스크톱과 웹에서 일치해야 한다. 실제 공유 링크로 수신자가 열어 확인하는 검증까지 별도로 수행한다.
- 미수행: 인증된 공유 파일 E2E, 모바일 브라우저 픽셀 렌더링, 실제 Google Drive 저장. 이번 검증의 캔버스는 호출 횟수를 기록하는 모형이다.
