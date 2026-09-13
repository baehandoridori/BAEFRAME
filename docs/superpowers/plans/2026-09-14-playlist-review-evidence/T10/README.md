# T10 실제 격리 앱 검증 (2026-09-14)

baseline은 04e2a229, after는 T10 통합 작업 코드다. 같은 PC, Electron28/mpv/Fabric 옵션, 3개 익명 영상과 별도 userData, 동일한 협업 실패 stub을 사용했다. 두 앱의 측정은 순서대로 실행했다. 표시값은 loadVideo 호출부터 반환까지이며 최초 디코딩 픽셀 시간과 다르다. 단위 ms, p95는 nearest-rank다.

각 저장 위치에서 초기3회는 first-touch로 따로 남기고, 이후20회가 warm이다. OS/Drive 캐시를 강제로 지우지 않았다. 따라서 cold 다운로드를 측정했다고 주장하지 않는다. baseline과 after의 원본 JSON은 이 폴더에 있다. Drive 자료는 새로 만든 검증용 폴더에만 썼다.

| 조건 | 위치 | 횟수 | median ms | p95 ms |
|---|---|---:|---:|---:|
| before | local | 20 | 1291.0 | 1399.7 |
| before | Drive | 20 | 1337.0 | 1465.8 |
| after (T10) | local | 20 | 893.0 | 980.2 |
| after (T10) | Drive | 20 | 960.0 | 1005.4 |
| after (리뷰2 수정) | local | 20 | 771.6 | 1101.1 |
| after (리뷰2 수정) | Drive | 20 | 774.8 | 924.3 |
| 완료 직후 | local | 20 | 1366.4 | 1450.8 |
| 완료 직후 | Drive | 20 | 2104.1 | 2267.8 |

완료 직후40회는 완료 intent→다음 컷 요청→저장/로드 반환의 총 시간이다. 모든 saved/loaded=true, 다음 컷 요청은1ms 이내였다. 무편집 전환과 직접 비교하지 않는다. raw pendingText는 타임라인 라벨을 선택한 초기 측정 필드이므로 pending 검증에 쓰지 않는다. 별도 실제 목록 검사에서0.4ms에 aria-busy=true, `미해결 · 저장 중`을 확인했다.

단계별 JSON의 초기 기록에는 native mpvLoad 계측이 누락된 시행착오도 들어 있다. native 호출 직전/직후 계측을 보완한 후 반복 전환46회의 versionScan p95는44.9ms로, 계획의50ms 기준보다 낮아 조건부 지연 로드를 적용하지 않았다. firstPlay는 재생 호출 성공이며 최초 표시 시간 측정이 아니다.

실제 native 마우스 pan은150%에서120/40 CSS px 이동→80/26.6667 pan, mutation/undo 증가0. `native-frame58.png`는 mpv가 캡처한 burned-in A58이며 UI도58, 새 그림의 저장 keyframe도58이었다. `native-save-parity.json`은 실제 제품 checkpoint 저장 전후 그림/수동 버전/root key 집합 보존 결과다.

실제 댓글 수정창에서 `확인@배` 후보 표시/선택을 확인했고, 프레임 이동과 목록 갱신 동안 초안/포커스/DOM 연결이 유지됐다. 실물 태블릿, OS 창 사이 Space keyup/focus, 실제 IME 장치, 다른 PC 동시 편집/동기화는 미확인이다. 네트워크 차단 때문에 협업 시작만 테스트 페이지에서 실패 stub으로 바꾸었으며 이 파일들은 원격 협업 검증 결과가 아니다.

최초 `native-save-parity.json`의 otherCommentsUnchanged=false는 수정 전 fromJSON이 다른 댓글의 endFrame0을 기본 길이로 바꾼 재현이다. 이 문제를 고친 제품 커밋b70e441의 실제 checkpoint 저장을 다시 실행한 `native-save-parity-final.json`은 그림/root 필드/다른 댓글 모두 동일하다. 초기 재현 파일은 과거 증거로 보존한다.

리뷰2 수정 후 동일 조건으로 다시 측정한 46회는 `after-review2-timing.json`이다. 이전 측정도 보존한다. background 재검사는 freshness60초와 5초 tick을 분리하고 tick당 최대4경로를 metadata로 확인하며 변경된 파일만 읽는다. 무변경 snapshot은 목록/타임라인을 다시 렌더하지 않는다. 위 소규모 반복 측정은 모든 Drive 지연 제거를 뜻하지 않는다.

`review1-native-rejected-seek.json`은 실제 checkpoint 실패로 다음 컷 이동이 거절됐을 때 원래 A/frame32 댓글 강조와 재시도 상태를 확인한 결과다. `review2-native-cancel.json`은 실제 native overlay→host→main IPC에서 미전송 move 직후 cancel해도 메인/overlay pan 좌표가 같고 mutation/undo가0임을 확인한 결과다. 합성 pointercancel을 포함하므로 실물 펜의 취소 검증과 구분한다.

`review4-native-edit-failure.json`은 별도 실제 앱에서 댓글 수정 checkpoint를 실패시키고, 본문 복원 뒤 정상 저장한 결과다. 메모리와 다시 읽은 익명 A.bframe 모두 원래 본문이며 실패한 초안이 저장되지 않았다. 자동 검사는 본문/답글, false/예외, 다른 필드의 동시 변경, 더 최신 원격 본문/영상 교체, 입력칸 handoff와 답글 취소 뒤 보류 갱신을 포함한다.
