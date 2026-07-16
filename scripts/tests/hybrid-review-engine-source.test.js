const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '../..');
const normalizeNewlines = (value) => value.replace(/\r\n/g, '\n');
const appSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/app.js'), 'utf8'));
const userSettingsSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/scripts/modules/user-settings.js'), 'utf8'));
const indexSource = normalizeNewlines(fs.readFileSync(path.join(rootDir, 'renderer/index.html'), 'utf8'));

test('드로잉/댓글 모드 하이브리드 엔진 전환이 배선되어 있다 (작업 4)', () => {
  assert.match(appSource, /engineSwap = false,/);
  assert.match(appSource, /async function enterHybridReviewEngineIfPossible\(\)/);
  assert.match(appSource, /async function exitHybridReviewEngineIfNeeded\(\)/);
  assert.match(appSource, /enterHybridReviewEngineIfPossible\(\)\.then\(\(swapped\) => \{/);
  assert.match(appSource, /if \(!engineSwap\) \{/);
  assert.match(appSource, /skipReviewTransition = false \} = \{\}/);
  assert.match(userSettingsSource, /hybridReviewEngine: true,/);
});

test('하이브리드 전환의 3중 안전장치가 배선되어 있다 (작업 4)', () => {
  // 코덱 게이트: HTML5 직재생 가능 코덱만 전환
  assert.match(appSource, /async function isHtml5DirectPlayableForReview\(filePath\)/);
  assert.match(appSource, /codecInfo\?\.isSupported === true/);
  // 설정 토글: 기본 켬, 끄면 기존 freeze
  assert.match(appSource, /if \(!userSettings\.getHybridReviewEngine\(\)\) return false;/);
  assert.match(userSettingsSource, /getHybridReviewEngine\(\) \{[\s\S]*hybridReviewEngine !== false;/);
  // 실패 폴백: 스왑 실패 시 기존 freeze 준비
  assert.match(appSource, /void prepareMpvDrawMode\(preparationToken\);/);
  assert.match(appSource, /void prepareMpvCommentMode\(preparationToken\);/);
  // engineSwap의 경량 전환: 리뷰 전이 스킵
  assert.match(appSource, /\}, \{ skipReviewTransition: true \}\);/);
  // 설정 UI 토글 존재
  assert.match(indexSource, /id="appSettingsHybridReviewEngine"/);
});

test('모드 종료 시 mpv 복귀 정리가 배선되어 있다 (작업 4)', () => {
  assert.match(appSource, /void exitHybridReviewEngineIfNeeded\(\);/);
  // 다른 파일 로드 시작 시 복귀 대상 정리(경합 방지)
  assert.match(appSource, /hybridReviewResumeMpvFile = null;/);
});
