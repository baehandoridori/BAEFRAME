# Task 3 수행 보고서: 기존 Windows 연결을 보존하는 시험판 실행

## 결과

- `--skip-shell-registration` 실행 인자를 한 번만 계산하는 `skipShellRegistration` 조건을 추가했다.
- 이 조건이 켜지면 `baeframe://` 프로토콜 등록과 `.bframe` / `.bplaylist` 프로젝트 파일 연결 등록을 모두 건너뛴다.
- 플래그가 없는 일반 실행은 기존 등록 동작을 그대로 유지한다.
- launch argument routing과 single/multi-instance 정책 코드는 수정하지 않았다.
- 실행 중인 BAEFRAME 프로세스는 실행, 종료, 포커스 전환하지 않았다.

## 수정 범위

- 제품 코드: `main/index.js`
- 테스트: `scripts/tests/project-file-associations.test.js`
- 수행 기록: `.superpowers/sdd/task-3-report.md`
- 미추적 plan 문서는 읽거나 수정하거나 스테이징하지 않았다.

## TDD 증거

### RED

명령:

```text
node --test scripts/tests/project-file-associations.test.js
```

결과:

- 종료 코드 1
- 7개 중 기존 6개 통과, 신규 계약 테스트 1개 실패
- 예상한 실패 원인: `main/index.js`에 `skipShellRegistration` 선언과 공유 가드가 아직 없었다.
- 이 RED 실행 시점에는 제품 코드를 수정하지 않았다.

### GREEN

명령:

```text
node --test scripts/tests/project-file-associations.test.js scripts/tests/instance-policy.test.js
```

결과:

- 종료 코드 0
- 15개 중 15개 통과, 실패 0
- 새 source 계약은 두 `app.setAsDefaultProtocolClient()` 호출과 `registerProjectFileAssociations()` 호출이 같은 `!skipShellRegistration` 조건을 사용하는지 확인한다.
- 기존 instance-policy 테스트 파일은 수정하지 않았고 전체 8개 계약이 그대로 통과했다.

## 관련 회귀 검증

명령:

```text
npm.cmd run test:mpv
```

- 종료 코드 0
- mpv 및 `main/index.js` source 계약 161개 중 161개 통과

명령:

```text
npm.cmd run test:playlist
```

- 종료 코드 0
- 프로젝트 파일 연결, launch routing, instance policy를 포함한 157개 중 157개 통과

명령:

```text
node --check main/index.js
node --check scripts/tests/project-file-associations.test.js
git diff --check
```

- 모두 종료 코드 0
- JavaScript 구문 오류와 공백 오류 없음

## Self-review

- 플래그 판정은 brief에 지정된 `process.argv.includes('--skip-shell-registration')` 그대로이며 exact argument일 때만 켜진다.
- 프로토콜 가드는 개발 실행용 등록과 packaged 실행용 등록을 모두 감싸므로 어느 분기에서도 기존 `baeframe://` 연결을 덮어쓰지 않는다.
- 프로젝트 파일 가드는 `app.whenReady()` 안의 registry repair 호출 자체를 막으므로 `.bframe`과 `.bplaylist` 연결을 건드리지 않는다.
- 두 등록 경로만 조건으로 감쌌고, startup 파일/프로토콜 인자 탐색과 두 번째 인스턴스 라우팅 순서는 그대로다.
- `shouldAllowMultipleInstances`, `resolveMultiInstanceUserDataPath`, `requestSingleInstanceLock` 호출은 수정하지 않았다.
- `main/project-file-associations.js`, package 설정, installer, renderer 코드는 건드리지 않았다.
- 별도 시험판 실행이나 실제 registry 변경은 Task 3 범위에서 수행하지 않았다.

## 비차단 참고

- mpv/playlist 회귀 테스트에는 기존 `[MODULE_TYPELESS_PACKAGE_JSON]` 경고가 출력됐지만 실패는 없었다. 이번 변경과 무관한 기존 package 설정 경고라 허용 파일 범위 밖의 `package.json`은 수정하지 않았다.
