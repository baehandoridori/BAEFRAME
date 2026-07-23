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

이 정책은 사용자가 선택한 새 엔진 UX를 기본으로 유지하면서, 데이터가 깨졌을 때
영상과 댓글까지 사용할 수 없게 되는 상황을 막는다.

## 5. 저장과 전환 안정성

시험판에서 검증한 다음 계약을 정식 채널에서도 동일하게 사용한다.

- Fabric 확정 동작만 `drawingsV3`에 저장
- 저장 직전 전체 snapshot pull
- 영상별 owner·generation fencing
- 전체 `.bframe` SHA-256 version token 비교
- main process 안 경로별 저장 직렬화
- stale write 충돌 시 디스크를 덮지 않고 dirty 유지
- 영상 전환과 종료 전에 Fabric flush 및 최종 저장
- 종료 저장 중 입력 동결, 종료 취소 시 입력·자동저장 복구
- 구형 `drawings`와 알 수 없는 최상위 필드 보존

## 6. 패키징과 배포

- `npm run build`: `fabric-v3-stable` marker 생성
- `npm run build:trial`: `fabric-v3-trial` marker 생성
- 패키징 hook은 이전 marker와 임시 marker를 먼저 제거한 뒤 새 marker를 임시 파일에
  쓰고 rename한다.
- merged `main`에서 새로 빌드한 `dist/win-unpacked`만 공유 드라이브에 배포한다.
- 최소 검증 대상은 EXE, `resources/app.asar`, runtime marker, mpv, ffmpeg, ffprobe다.
- 가능하면 전체 파일 SHA-256 목록을 비교해 `MismatchCount=0`을 확인한다.

## 7. 릴리스 차단 조건

다음 중 하나라도 발생하면 PR 머지 또는 배포를 진행하지 않는다.

- mpv, Fabric, drawing, playlist, persistence 테스트 실패
- 일반 빌드에 안정화 marker가 없거나 시험 marker가 남음
- kill switch가 marker보다 우선하지 않음
- 정식 marker가 userData를 격리하거나 파일연결을 차단함
- 신규 P0/P1 독립 리뷰 지적
- merged main 빌드 실패
- 로컬·공유 드라이브 해시 불일치

## 8. 배포 후 사용자 확인

1. 정식 배포본으로 영상 열기
2. 재생 중 B를 여러 번 켜고 끄기
3. 펜·브러시로 그린 뒤 재생과 B 전환 확인
4. V 획 선택, 라쏘·사각·원형 선택과 이동 확인
5. 앱 종료 후 같은 영상 재열기
6. 프레임별 그림·스타일·위치 복원 확인
7. 재생목록의 영상 경계에서 끊김과 중복 재생 여부 확인
