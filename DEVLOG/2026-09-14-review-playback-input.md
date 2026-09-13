# 댓글·재생 전환·드로잉 입력 구현

## 범위와 환경

- 요구사항: [구현 계획](../docs/superpowers/plans/2026-09-14-review-playback-input-plan.md) §1. 순서 T0 → T1 → T2 → T3 → T4 → T5 → T9 → T6 → T7 → T8 → T10.
- 기준 origin/main: `04e2a229bb1e85edac2a7c0f11bf9f294b796218`, 2.11.1-beta.
- 구현 폴더: `C:\BAEframe\BAEFRAME\.worktrees\review-playback-input`, 브랜치 `codex/review-playback-input`.
- 기존 main의 team-members.js 및 미추적 DEVLOG/docs, 다른 worktree, 실행 앱 및 사용자 데이터 보존.
- 계획은 timeline-comment-transition-plan worktree에서 복사. 과거 조사 로그는 이번 실행 결과와 구분한다.
- 사용자 요청으로 PR/머지/배포 승인됨. Slack 발송 및 사용자 앱 재시작은 범위 밖.
- 자동 테스트는 익명 A(3초/24fps), B(5초/24fps), C(3초/30fps) 및 0프레임/오류 시간 fixture만 사용. 실물 태블릿과 실제 앱 검증은 별도 기록한다.

## T0

- 저장소 작업/개발/드로잉/협업/파일/릴리스 가이드 확인. 실제 직렬화와 CAS 계약 우선.
- `npm ci --ignore-scripts`: exit 0. baseline 최초 270 pass/1 fail/0 cancelled, exit 1. Electron 설치 스크립트 미실행이 원인, 제품 실패 아님.
- `node node_modules/electron/install.js`: exit 0. 새 worktree의 Electron만 준비.
- 기준 검사: 계획 T0의 8개 파일에 `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test` 적용. 로그 `.local/review-playback-input/T0-baseline-ready.log`.

## 진행

T0 검증 완료 후 T1 시작. T1~T10 미완료. 빌드/실제 앱/태블릿/PR/머지/배포 아직 미수행.
- T0 최종 결과: 271 pass / 0 fail / 0 cancelled, exit 0.
