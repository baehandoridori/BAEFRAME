# mpv + Fabric 드로잉 안정화 채널 승격 설계

작성일: 2026-07-23

## 1. 결정 배경

`fabric-v3-trial` 시험판은 실제 mpv 재생, B 드로잉 모드 전환, V 획 선택과 라쏘 선택,
`drawingsV3` 자동 저장·재실행 복원을 검증하기 위한 격리 채널이었다.

사용자는 시험 앱을 별도로 유지하는 대신, 검증한 동작을 공유 드라이브 정식 배포본의
기본 엔진으로 승격하라고 명시했다. 따라서 기존
`2026-07-23-fabric-persistence-trial-default-design.md`의 저장·복원·경합 방지 계약은
유지하고, “정식 빌드 기본 OFF” 결정만 안정화 채널 기본 ON으로 변경한다.

## 2. 검토한 승격 방식

### A. resolver의 마지막 기본값을 바로 ON으로 변경

- 장점: 코드 변경이 가장 작다.
- 한계: 개발 실행과 테스트 실행도 동시에 바뀌며, 어떤 배포 파일이 안정화 채널인지
  산출물만 보고 구분하기 어렵다.

### B. 정식 배포용 runtime marker 추가 — 채택

- 장점: 정식 패키지 안에 활성 기능이 명시되고, 시험판 격리 설정과 정식 설정을
  분리할 수 있다.
- 장점: 개발 실행은 기존 기본값을 유지하면서 실제 배포본만 새 엔진을 기본으로 쓴다.
- 장점: 배포 후 marker와 `app.asar` 해시를 함께 검사할 수 있다.
- 한계: marker schema와 패키징 hook 테스트가 추가된다.

### C. 바로가기 또는 환경변수로 기능 활성화

- 장점: 소스 변경이 적다.
- 한계: 실행 경로마다 설정이 달라질 수 있고 파일 직접 열기에서 누락될 수 있어
  정식 배포에는 부적합하다.

## 3. 정식 안정화 프로필

일반 `npm run build`가 만드는 패키지는 다음 marker를 포함한다.

```json
{
  "schemaVersion": 1,
  "channel": "fabric-v3-stable",
  "features": {
    "mpvPlaybackPilot": true,
    "fabricDrawingPilot": true,
    "fabricDrawingV3Shadow": true,
    "fabricDrawingPersistence": true
  },
  "isolateUserData": false,
  "skipShellRegistration": false
}
```

동작 우선순위는 다음과 같다.

1. kill switch
2. 명시 CLI 또는 환경변수
3. 유효한 `fabric-v3-stable` 또는 `fabric-v3-trial` marker
4. 개발 실행 기본 OFF

marker의 네 `features` 값은 서로 따로 켜고 끄는 사용자 옵션이 아니라, 승인된
재생·드로잉·shadow·저장 조합 전체가 정확한지 판정하는 하나의 strict profile
계약이다. 일부 필드만 true인 marker는 어떤 기능도 활성화하지 않는다.

시험 marker는 기존처럼 PID별 userData와 파일연결 차단을 유지한다. 안정화 marker는
기존 사용자 설정과 최근 파일을 그대로 사용하고 `.bframe`, `.bplaylist`,
`baeframe://` 연결을 정식 배포본으로 등록한다.

## 4. 드로잉 엔진 노출 정책

- mpv + Fabric이 정식 기본 경로다.
- 기존 HTML/legacy 드로잉 UI는 평상시 노출하지 않는다.
- legacy 코드는 삭제하지 않고, 지원하지 않는 미래 `drawingsV3`, 손상 데이터,
  hydrate 실패 같은 복구 불가능 상황에서만 내부 폴백으로 사용한다.
- mpv 연결 성공 알림은 표시하지 않는다.
- kill switch가 적용된 진단 실행에서는 기존 엔진을 사용할 수 있다.
- 이번 안정화 승격의 선택 기능 범위는 사용자가 시험 앱에서 확인한 획 선택·이동과
  라쏘 부분 선택이다. 라쏘가 가로지른 획은 선택 조각과 남은 조각으로 안전하게
  분리할 수 있고, 선택 조각만 이동·삭제하며 한 번의 Undo/Redo로 원본 상태를
  복구한다. 사각형·원형 영역 선택은 별도 기능 단계로 남기며, 이번 배포의 완료
  조건으로 과장하지 않는다.

이 정책은 사용자가 선택한 새 엔진 UX를 기본으로 유지하면서, 데이터가 깨졌을 때
영상과 댓글까지 사용할 수 없게 되는 상황을 막는다.

### 4.1 mpv 오버레이 키보드 전달

mpv와 Fabric은 별도 native overlay 창에 있으므로 그 창이 포커스를 가진 동안에도
정식 BAEFRAME 단축키가 같은 의미로 동작해야 한다. overlay host는 물리 키의
`type`, `key`, `code`, 네 modifier, `repeat`만 포함한 고정 8필드 메시지를 검증해
main → preload → renderer로 전달한다. renderer는 현재 활성 입력 요소를 대상으로
합성 `KeyboardEvent`를 발생시켜 사용자 설정 단축키와 기존 편집 입력 보호를 그대로
사용한다.

IME 조합, `Dead`, `Process`, 잘못된 필드와 알 수 없는 이벤트는 전달하지 않는다.
입력창·textarea·contenteditable에 포커스가 있으면 전역 단축키가 글 입력을 가로채지
않는다. 이 relay의 목적은 B/V/Space 등 BAEFRAME의 키 처리 경로를 복구하는 것이며,
합성 이벤트만으로 브라우저 자체의 Tab 포커스 이동이나 Enter 기본 클릭까지 재현한다고
보장하지 않는다.

## 5. 저장과 전환 안정성

시험판에서 검증한 다음 계약을 정식 채널에서도 동일하게 사용한다.

- Fabric 확정 동작만 `drawingsV3`에 저장
- 저장 직전 전체 snapshot pull
- 영상별 owner·generation fencing
- 전체 `.bframe` SHA-256 version token 비교
- main process 안 경로별 저장 직렬화
- Windows에서 기존 파일의 대소문자·junction 별칭은 실제 경로 기준으로 같은 복구 거래로 통일
- NTFS에서 실제로 구별되는 Unicode 조합·대소문자 파일명은 별도 복구 거래로 유지
- 같은 Windows PC의 여러 BAEFRAME process를 위한 named-pipe 조정과 공유 recovery slot
- 같은 폴더의 고유 temp에 기록한 뒤 flush·재읽기·JSON/hash 검증
- 교체 전에 prepared recovery sidecar와 검증된 rollback 생성
- Win32 helper가 target 쓰기를 막은 handle에서 SHA-256을 확인한 뒤 `ReplaceFileW` 교체
- 교체 시 밀려난 실제 target backup도 해시 검증해 확인 이후 외부 버전을 복원
- 교체 뒤 전체 파일 재읽기·JSON/hash 검증과 실패 시 rollback
- 중단 temp는 PID·v4 UUID·허용 suffix가 모두 맞는 내부 파일만 정리하고 유사 이름은 보존
- stale write 충돌 시 디스크를 덮지 않고 dirty 유지
- 잠금 시간 초과·Windows 파일 점유는 충돌과 구분해 dirty를 유지하고 자동 저장 재예약
- 구형 댓글·드로잉·하이라이트·합성 레이어·수동 버전은 로드 기준점, 로컬 상태,
  저장 직전 최신 파일을 비교하는 ID 기반 3-way merge로 저장
- 저장 직전 최신 root도 구형 schema라면 같은 migration을 다시 적용하고, manager가
  실제로 받아들인 canonical 형태를 기준점으로 사용
- 로컬에서 삭제하고 다른 process가 건드리지 않은 항목은 삭제를 유지하고, 다른
  process가 새로 추가한 항목은 함께 보존
- 같은 항목을 양쪽에서 동시에 수정하거나 한쪽에서 삭제한 충돌은 결정적인
  conflict-copy ID로 양쪽 데이터를 보존하고, 재시도해도 복사본을 늘리지 않음
- 댓글 marker와 reply는 각각 ID 단위로 병합해 한 marker에 동시에 추가된 답글을
  모두 보존하고, marker 본문 충돌과 답글 병합을 분리
- 원격에서만 바뀐 레이어 순서·삽입 위치는 로컬의 무관한 저장으로 되돌리지 않음
- 배열형 legacy highlight와 `versionInfo`·`liveblocksRoomId`의 명시적 `null` 변경도
  3-way 기준에 포함
- 댓글 marker는 `createdAt`·`updatedAt`·`deletedAt` 시각을 삭제 판정에 사용하고,
  `drawingsV3`는 일반 3-way merge와 분리해 기존 fingerprint 기반 fail-closed 계약 유지
- 특정 review manager가 없는 내부 실행에서도 빈 배열을 사용자 삭제로 오인하지 않고
  마지막 병합 기준 데이터를 보존
- 영상 전환과 종료 전에 Fabric flush 및 최종 저장
- 종료 저장 중 입력 동결, 종료 취소 시 입력·자동저장 복구
- 구형 `drawings`와 알 수 없는 최상위 필드 보존

### 5.1 다중 process 조정과 최종 CAS

named pipe 하나만을 최종 정합성 보장으로 사용하지 않는다. 다음 세 층을 함께 쓴다.

1. process 내부 경로별 queue
2. 정규화 경로 SHA-256 기반 named pipe와 원자 게시되는 `<file>.recovery.json` recovery slot
3. `ReviewFileCasHelper.exe`의 crash-safe Win32 잠금 handle과 target write guard

helper는 target handle에서 기존 SHA-256을 계산하고 `FILE_SHARE_WRITE`를 제외해 직접
쓰기를 막는다. NTFS와 Google DriveFS 모두 `ReplaceFileW`로 교체하면서 그 순간 실제로
밀려난 target을 고유 backup에 남긴다. backup 해시가 사전에 확인한 해시와 다르면 확인과
교체 사이에 들어온 외부 버전이므로 즉시 원상복원하고 conflict를 반환한다. helper가
중단되더라도 다음 read가 backup을 검사해 외부 정상본을 우선 복구한다. helper process가
종료되면 잠금 handle은 OS에 의해 닫힌다.

`proper-lockfile`도 검토했지만 Google Drive에 lease 디렉터리가 동기화되고 stale lease
회수 경쟁이 생길 수 있다. 최종 교체의 정합성은 lease 시간이 아니라 target handle,
expected hash, recovery sidecar로 판정한다.

### 5.2 저장 transaction

1. 대상 또는 부모 폴더의 실제 경로를 확인해 같은 Windows 파일의 대소문자·junction
   별칭만 하나의 파일 정체성으로 통일하고 process 내부 queue에 들어간다. 경로 문자열을
   임의로 소문자화하거나 Unicode 정규화하지 않아 NTFS가 구별하는 파일은 섞지 않는다.
2. named pipe 잠금을 획득한다.
3. 최신 main을 읽어 `expectedVersionToken` 또는 `failIfExists`를 확인한다.
4. 같은 디렉터리의 candidate와 commit temp를 `wx`로 쓰고 `sync()`·재검증한다.
5. recovery sidecar를 고유 temp에 sync·검증한 뒤 부재 CAS로 고정 경로에 원자 게시한다.
6. 기존 main의 exact bytes를 고유 rollback에 `wx`로 기록하고 재검증한다.
7. main token 또는 부재 상태를 다시 확인한다.
8. native helper가 replacement hash와 target handle의 expected hash를 검증한다.
9. `ReplaceFileW`로 교체하고 밀려난 실제 target backup의 해시도 검증한다.
10. 확인 이후 외부 버전이면 그 backup을 복원하고 conflict를 반환한다.
11. main을 다시 읽어 JSON과 목표 SHA-256을 검증한다.
12. main이 사라지거나 malformed가 되면 잘못된 bytes를 별도 보존하고 rollback을 CAS 복원한다.
13. 검증된 성공 또는 복원 뒤에만 CAS backup과 sidecar·temp·rollback을 정리한다.

앱이 어느 단계에서 강제 종료되어도 다음 read가 sidecar의 base/target hash를 비교한다.
main이 target이면 commit을 마무리하고, base면 미완료 candidate를 정리하며, main이
없거나 malformed이면 검증된 rollback을 복원한다. base도 target도 아닌 유효한 제3
버전은 외부 저장의 승자로 보존하고 준비 잔여물만 정리한다. 교체 순간 밀려난 외부
정상본이 CAS backup에 남아 있으면 main보다 우선 복원한다. 2분 이상 된 손상 sidecar는
별도 파일로 보존한 뒤 정상 main을 다시 연다.

### 5.3 보장 범위와 남은 한계

이번 `2.0.0-beta` 안정화 채널이 보장하는 범위:

- 같은 Windows PC에서 실행된 여러 정식 BAEFRAME process
- 저장 process의 강제 종료
- 교체 직전 비협력 외부 수정 감지
- helper 중단 시 밀려난 외부 정상본 보존과 복구
- Windows/Drive provider의 짧은 파일 점유 실패 시 원본 보존
- 교체 직후 main 소실·malformed 감지와 검증된 원본 rollback

보장하지 않는 범위:

- 서로 다른 PC의 Google Drive for desktop가 같은 `.bframe`을 동시에 편집하는 경우
- 서로 다른 PC가 파일 rename/replace까지 수행하는 완전한 분산 CAS
- 동일 파일의 서로 다른 NTFS hardlink 경로를 하나의 저장 대상으로 묶는 경우
- 아직 생성되지 않은 새 리뷰 파일이 준비 단계에서 중단된 뒤 파일명 대소문자까지 바꿔
  다시 여는 경우의 자동 복구
- 디스크·Drive provider 자체가 recovery sidecar와 rollback을 함께 손상시키는 경우
- 이미 손상된 입력에 동일 ID 항목이 여러 개 있으면 canonicalization 과정에서 하나로
  수렴할 수 있는 경우
- 의미는 같지만 JSON 객체의 키 순서만 다른 비정상 외부 작성 데이터가 불필요한
  conflict-copy를 만들 수 있는 경우

Google Drive는 각 PC의 로컬 cache를 거쳐 비동기로 동기화되므로 인접 lock 파일도
강한 분산 lock이 아니다. 서로 다른 PC에서 같은 리뷰 파일을 동시에 편집하지 않는 것을
현재 운영 조건으로 둔다. 다중 PC 동시 편집은 서버 측 lease/CAS 또는 Liveblocks 기반
조정으로 별도 구현한다. 이번 recovery sidecar와 rollback은 process crash와 관측 가능한
중간 상태를 복구한다. 다른 PC의 sidecar도 2분 이상 진행이 없으면 stale로 보고 복구하지만,
두 PC가 동시에 계속 쓰는 상황이나 Google Drive 서비스 자체의 손상까지 보장한다고
표현하지 않는다.

### 5.4 리뷰 데이터 3-way merge

구형 review collection은 schema 전반에 tombstone이 없으므로 단순 합집합으로 병합하면
삭제한 항목이 다시 살아나고, 최신 파일을 그대로 덮으면 다른 process의 추가 항목이
사라진다. 각 영상 load 시 local manager가 실제로 받아들인 review subset을
`_reviewMergeBase`로 복제하고, 저장 직전 다음 세 값을 비교한다.

1. local manager가 받아들인 공통 기준점
2. 현재 local manager 상태
3. version token과 함께 읽은 최신 disk root

기준점에 있던 항목이 local에서 사라졌고 remote가 기준점과 같으면 local 삭제를
적용한다. local이 기준점과 같으면 remote 변경을, remote가 기준점과 같으면 local
변경을 적용한다. 양쪽이 모두 달라진 경우 원본 한쪽과 결정적인 conflict copy를
함께 보존한다. 저장 성공 뒤에는 저장을 시작할 때 수집한 local snapshot을 새 공통
기준점으로 삼는다. 따라서 자동 저장 때 manager 전체를 다시 import하지 않아 화면이
깜빡이지 않으며, 저장 중 새 local 변경이 생겨도 다음 자동 저장에서 이어서 병합된다.
댓글 marker 안의 reply도 같은 규칙으로 따로 병합한다. `reloadAndMerge`는 병합 결과를
manager에 적용하되, 다음 3-way 비교의 공통 기준점은 conflict-copy로 바뀐 manager
표현이 아니라 정확한 최신 remote 원본으로 유지한다.

### 5.5 취소 가능한 영상 전환과 입력 복구

Fabric 입력은 기존 리뷰 저장 여부가 결정되기 전까지 현재 영상에 붙어 있어야 한다.
저장 취소 뒤에는 현재 드로잉 세션을 분리하지 않는다. 저장 결정을 통과한 뒤 실제
미디어 교체 직전에만 `beforeVideoChange`로 입력을 막는다. 전환 순서는 다음과 같다.

1. 입력이 살아 있는 상태에서 최초 Fabric snapshot pull과 기존 리뷰 저장 결정을 마친다.
2. 현재 전환 token이 자체적으로 발행한 새 disable revision의 승인을 기다린다.
3. 입력이 차단된 상태에서 Fabric snapshot을 다시 pull하고 pending save를 기다린 뒤
   마지막 dirty 상태를 저장한다.
4. 현재 load token의 파괴 경계를 확정한다.
5. 파괴 경계 안에서만 파일 감시와 Liveblocks·댓글·드로잉 동기화를 종료하고 이전
   review manager 데이터를 비운다.

이 단계가 진행 중일 때 더 최신 영상 열기가 앞선 요청을 무효화할 수 있다. 아직
파괴적 미디어 교체를 시작하지 않았다면 token으로 소유권을 확인한 뒤 기존 영상
context를 다시 hydrate하고 새로운 Fabric session으로 복구한다. 이미 교체를 시작한
경우에는 이전 영상을 되살리지 않고 fail-closed 정리를 사용한다. 일시적 overlay 입력
거절은 해당 시도만 실패시키며, 다음 B 입력은 새 session으로 한 번 더 시도할 수 있다.
앞선 disable 요청이 아직 처리 중이어도 최신 전환은 `desiredInputEnabled=false`만 믿지
않고 자신의 더 최신 revision을 반드시 승인받는다. 따라서 오래된 거절 응답이 최신
전환을 입력 활성 상태로 통과시키지 못한다.

## 6. 패키징과 배포

- `npm run build`와 `npm run build:installer`는 부모 shell 환경과 관계없이
  `fabric-v3-stable`을 명시해 marker 생성
- `npm run build:trial`은 `fabric-v3-trial`을 명시하고 정식 `dist`와 섞이지 않도록
  git에서 제외된 `dist-trial`에 출력
- prebuild/beforePack에서 추적된 C# 소스로 `ReviewFileCasHelper.exe`를 빌드하고
  `resources/native`에 포함
- Windows beforePack은 `ffmpeg.exe`와 `ffprobe.exe`가 모두 일반 파일이고
  0 byte보다 큰지 확인하며, 하나라도 잘못되면 불완전한 패키지를 만들기 전에 중단
- 패키징 hook은 이전 marker와 임시 marker를 먼저 제거한 뒤 새 marker를 임시 파일에
  쓰고 rename한다.
- merged `main`에서 commit 전용의 빈 release output 폴더에 새로 빌드한
  `win-unpacked`만 공유 드라이브에 배포한다. 기존 `dist/win-unpacked`의 marker나
  잔여 파일은 배포 근거로 사용하지 않는다.
- 최소 검증 대상은 EXE, `resources/app.asar`, runtime marker, native CAS helper,
  mpv, ffmpeg, ffprobe다.
- 가능하면 전체 파일 SHA-256 목록을 비교해 `MismatchCount=0`을 확인한다.

## 7. 릴리스 차단 조건

다음 중 하나라도 발생하면 PR 머지 또는 배포를 진행하지 않는다.

- mpv, Fabric, 라쏘 부분 분리 runtime, drawing, playlist, persistence 테스트 실패
- 일반 빌드에 안정화 marker가 없거나 시험 marker가 남음
- kill switch가 marker보다 우선하지 않음
- 정식 marker가 userData를 격리하거나 파일연결을 차단함
- 신규 P0/P1 독립 리뷰 지적
- 실제 두 Node process 저장 테스트에서 double-success, JSON 손상 또는 temp 잔여 발생
- 폐기 가능한 Google Drive scratch에서 동시 저장 smoke 실패
- merged main 빌드 실패
- 로컬·공유 드라이브 해시 불일치

## 8. 배포 후 사용자 확인

1. 정식 배포본으로 영상 열기
2. 재생 중 B를 여러 번 켜고 끄기
3. 펜·브러시로 그린 뒤 재생과 B 전환 확인
4. V 획 선택·이동, 라쏘로 획 일부 선택·이동·삭제, Undo/Redo 확인
5. 앱 종료 후 같은 영상 재열기
6. 프레임별 그림·스타일·위치 복원 확인
7. 재생목록의 영상 경계에서 끊김과 중복 재생 여부 확인
