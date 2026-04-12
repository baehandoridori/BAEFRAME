/**
 * baeframe - Recent Files Thumbnail Capture
 *
 * ffmpeg로 비디오 대표 프레임 1장을 JPEG으로 추출한다.
 * 실패 시 예외를 던지지 않고 null을 반환해 상위 로직이 차단되지 않도록 한다.
 */

const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { createLogger } = require('./logger');

const log = createLogger('RecentThumbCapture');

const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 180;
const JPEG_QUALITY = 4; // ffmpeg -q:v 2(best)~31(worst), 4 ≈ 품질 0.75

/**
 * 썸네일 저장 폴더를 보장한다.
 * @param {string} userDataPath - app.getPath('userData')
 */
async function ensureThumbDir(userDataPath) {
  const dir = path.join(userDataPath, 'recent-thumbs');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function getThumbPath(userDataPath, id) {
  if (!/^[0-9a-f]{40}$/.test(id)) {
    throw new Error('Invalid thumbnail id');
  }
  return path.join(userDataPath, 'recent-thumbs', `${id}.jpg`);
}

/**
 * ffmpeg 실행 파일 경로 반환.
 * 기존 ffmpeg-manager가 있으면 해당 경로 사용, 없으면 PATH의 ffmpeg.
 */
function resolveFfmpegPath() {
  try {
    const { ffmpegManager } = require('./ffmpeg-manager');
    if (ffmpegManager.isAvailable() && ffmpegManager.ffmpegPath) {
      return ffmpegManager.ffmpegPath;
    }
  } catch (e) {
    // ffmpeg-manager가 없거나 실패
  }
  return 'ffmpeg'; // PATH 의존 폴백
}

/**
 * 비디오의 지정 시각에서 단일 프레임을 JPEG으로 캡처한다.
 *
 * @param {object} options
 * @param {string} options.videoPath - 입력 비디오 절대 경로
 * @param {string} options.outputPath - 출력 JPEG 절대 경로
 * @param {number} options.atSeconds - 캡처 시각(초)
 * @param {number} [options.timeoutMs=10000] - 타임아웃
 * @returns {Promise<string|null>} 성공 시 outputPath, 실패 시 null
 */
async function captureFrame({ videoPath, outputPath, atSeconds, timeoutMs = 10000 }) {
  const ffmpegPath = resolveFfmpegPath();

  // 임시 파일에 쓰고 성공 시 원자적 rename
  const tmpPath = `${outputPath}.tmp`;

  const args = [
    '-y',
    '-ss', String(atSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=increase,crop=${THUMB_WIDTH}:${THUMB_HEIGHT}`,
    '-q:v', String(JPEG_QUALITY),
    tmpPath
  ];

  log.debug('ffmpeg 캡처 시작', { videoPath, atSeconds });

  return new Promise((resolve) => {
    let settled = false;
    const proc = spawn(ffmpegPath, args, { windowsHide: true });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        log.warn('ffmpeg 캡처 타임아웃', { videoPath });
        try { proc.kill('SIGKILL'); } catch (e) {}
        resolve(null);
      }
    }, timeoutMs);

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log.warn('ffmpeg spawn 실패', { error: err.message });
      resolve(null);
    });

    proc.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        log.warn('ffmpeg 캡처 실패', { code, stderr: stderr.slice(0, 200) });
        try { await fs.unlink(tmpPath); } catch (e) {}
        resolve(null);
        return;
      }

      try {
        await fs.rename(tmpPath, outputPath);
        log.info('썸네일 캡처 성공', { outputPath });
        resolve(outputPath);
      } catch (err) {
        log.warn('썸네일 rename 실패', { error: err.message });
        resolve(null);
      }
    });
  });
}

/**
 * 썸네일 파일 삭제. 실패해도 예외 안 던짐.
 */
async function deleteThumb(userDataPath, id) {
  try {
    await fs.unlink(getThumbPath(userDataPath, id));
  } catch (e) {
    // 없어도 OK
  }
}

module.exports = {
  ensureThumbDir,
  getThumbPath,
  captureFrame,
  deleteThumb,
  THUMB_WIDTH,
  THUMB_HEIGHT
};
