/**
 * FFmpegManager - BAEFRAME 비디오 트랜스코딩 관리
 *
 * 미지원 코덱(MPEG-4 Part 2, PNG MOV 등)을 H.264로 변환
 */

const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createLogger } = require('./logger');

const log = createLogger('FFmpegManager');

// 지원되는 코덱 (변환 불필요)
const SUPPORTED_CODECS = ['h264', 'avc1', 'vp8', 'vp9', 'av1'];

// 캐시 설정
const DEFAULT_CACHE_LIMIT_GB = 10;
const CACHE_FOLDER_NAME = 'transcoded';

class FFmpegManager {
  constructor() {
    this.ffmpegPath = null;
    this.ffprobePath = null;
    this.cacheDir = null;
    this.activeProcesses = new Map();
    this.initialized = false;
    this.cacheLimitBytes = DEFAULT_CACHE_LIMIT_GB * 1024 * 1024 * 1024;
  }

  /**
   * FFmpeg 초기화 - 바이너리 경로 감지
   */
  async initialize() {
    if (this.initialized) return true;

    // 캐시 디렉토리 설정
    this.cacheDir = path.join(app.getPath('userData'), CACHE_FOLDER_NAME);
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }

    // FFmpeg 바이너리 경로 감지
    const ffmpegInfo = await this._detectFFmpeg();
    if (!ffmpegInfo) {
      log.warn('FFmpeg를 찾을 수 없습니다');
      return false;
    }

    this.ffmpegPath = ffmpegInfo.ffmpeg;
    this.ffprobePath = ffmpegInfo.ffprobe;
    this.initialized = true;

    log.info('FFmpeg 초기화 완료', {
      ffmpeg: this.ffmpegPath,
      ffprobe: this.ffprobePath,
      cacheDir: this.cacheDir
    });

    return true;
  }

  /**
   * FFmpeg 바이너리 경로 감지
   */
  async _detectFFmpeg() {
    // 1. 번들된 바이너리 확인 (extraResources)
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
    const bundledPaths = [
      path.join(resourcesPath, 'ffmpeg', 'win32'),
      path.join(resourcesPath, 'ffmpeg'),
      path.join(__dirname, '..', 'ffmpeg', 'win32'),
      path.join(__dirname, '..', 'ffmpeg')
    ];

    for (const dir of bundledPaths) {
      const ffmpegExe = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      const ffprobeExe = path.join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

      if (fs.existsSync(ffmpegExe) && fs.existsSync(ffprobeExe)) {
        log.info('번들된 FFmpeg 발견', { dir });
        return { ffmpeg: ffmpegExe, ffprobe: ffprobeExe };
      }
    }

    // 2. 시스템 PATH에서 찾기
    try {
      const ffmpegPath = await this._findInPath('ffmpeg');
      const ffprobePath = await this._findInPath('ffprobe');

      if (ffmpegPath && ffprobePath) {
        log.info('시스템 FFmpeg 발견', { ffmpeg: ffmpegPath, ffprobe: ffprobePath });
        return { ffmpeg: ffmpegPath, ffprobe: ffprobePath };
      }
    } catch (e) {
      log.debug('시스템 FFmpeg 찾기 실패', { error: e.message });
    }

    return null;
  }

  /**
   * PATH에서 실행 파일 찾기
   */
  _findInPath(executable) {
    return new Promise((resolve) => {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      execFile(cmd, [executable], (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          const paths = stdout.trim().split('\n');
          resolve(paths[0] || null);
        }
      });
    });
  }

  /**
   * 파일 해시 생성 (캐시 키)
   */
  _getFileHash(filePath, stats) {
    const data = `${filePath}|${stats.size}|${stats.mtimeMs}`;
    return crypto.createHash('md5').update(data).digest('hex').slice(0, 16);
  }

  /**
   * 비디오 코덱 정보 조회
   */
  async probeCodec(filePath) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.ffprobePath) {
      throw new Error('FFprobe를 찾을 수 없습니다');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-select_streams', 'v:0',
        filePath
      ];

      execFile(this.ffprobePath, args, { timeout: 30000 }, (error, stdout) => {
        if (error) {
          log.error('ffprobe 실행 실패', { error: error.message, filePath });
          reject(error);
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const videoStream = data.streams?.[0];

          if (!videoStream) {
            reject(new Error('비디오 스트림을 찾을 수 없습니다'));
            return;
          }

          const codecInfo = {
            codecName: videoStream.codec_name?.toLowerCase(),
            codecLongName: videoStream.codec_long_name,
            width: videoStream.width,
            height: videoStream.height,
            duration: parseFloat(videoStream.duration) || 0,
            bitRate: parseInt(videoStream.bit_rate) || 0,
            frameRate: this._parseFrameRate(videoStream.r_frame_rate),
            isSupported: SUPPORTED_CODECS.includes(videoStream.codec_name?.toLowerCase())
          };

          log.info('코덱 정보 조회 완료', { filePath, codec: codecInfo.codecName, isSupported: codecInfo.isSupported });
          resolve(codecInfo);
        } catch (parseError) {
          log.error('ffprobe 출력 파싱 실패', { error: parseError.message });
          reject(parseError);
        }
      });
    });
  }

  /**
   * 프레임 레이트 문자열 파싱
   */
  _parseFrameRate(rateStr) {
    if (!rateStr) return 24;
    const parts = rateStr.split('/');
    if (parts.length === 2) {
      return Math.round(parseInt(parts[0]) / parseInt(parts[1]));
    }
    return parseFloat(rateStr) || 24;
  }

  /**
   * 캐시 유효성 확인
   */
  async checkCache(filePath) {
    if (!fs.existsSync(filePath)) {
      return { valid: false, reason: '원본 파일 없음' };
    }

    const stats = fs.statSync(filePath);
    const fileHash = this._getFileHash(filePath, stats);
    const cacheFolder = path.join(this.cacheDir, fileHash);
    const metaPath = path.join(cacheFolder, 'meta.json');
    const convertedPath = path.join(cacheFolder, 'converted.mp4');

    if (!fs.existsSync(metaPath) || !fs.existsSync(convertedPath)) {
      return { valid: false, reason: '캐시 없음', fileHash };
    }

    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      // 원본 파일이 변경되었는지 확인
      if (meta.originalMtime !== stats.mtimeMs || meta.originalSize !== stats.size) {
        log.info('캐시 무효화: 원본 파일 변경됨', { filePath });
        return { valid: false, reason: '원본 파일 변경됨', fileHash };
      }

      // 캐시된 파일 접근 시간 업데이트 (LRU용)
      fs.utimesSync(convertedPath, new Date(), new Date());

      return {
        valid: true,
        convertedPath,
        fileHash,
        meta
      };
    } catch (e) {
      log.warn('캐시 메타 파싱 실패', { error: e.message });
      return { valid: false, reason: '캐시 메타 오류', fileHash };
    }
  }

  /**
   * 트랜스코딩 실행
   * @param {string} filePath - 입력 파일 경로
   * @param {Function} onProgress - 진행률 콜백 (0-100)
   * @returns {Promise<{success: boolean, outputPath: string}>}
   */
  async transcode(filePath, onProgress = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.ffmpegPath) {
      throw new Error('FFmpeg를 찾을 수 없습니다');
    }

    // 캐시 확인
    const cacheCheck = await this.checkCache(filePath);
    if (cacheCheck.valid) {
      log.info('캐시된 변환 파일 사용', { filePath, convertedPath: cacheCheck.convertedPath });
      return { success: true, outputPath: cacheCheck.convertedPath, fromCache: true };
    }

    // 코덱 정보 조회 (duration 필요)
    const codecInfo = await this.probeCodec(filePath);

    // 캐시 폴더 준비
    const stats = fs.statSync(filePath);
    const fileHash = this._getFileHash(filePath, stats);
    const cacheFolder = path.join(this.cacheDir, fileHash);
    const outputPath = path.join(cacheFolder, 'converted.mp4');
    const tempPath = path.join(cacheFolder, 'converting.mp4');
    const metaPath = path.join(cacheFolder, 'meta.json');

    if (!fs.existsSync(cacheFolder)) {
      fs.mkdirSync(cacheFolder, { recursive: true });
    }

    // 기존 임시 파일 삭제
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    return new Promise((resolve, reject) => {
      const taskId = `transcode_${Date.now()}`;

      const args = [
        '-i', filePath,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',  // HTML5 Video 호환 픽셀 포맷
        '-preset', 'fast',
        '-crf', '18',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-y',
        tempPath
      ];

      log.info('트랜스코딩 시작', {
        filePath,
        taskId,
        codec: codecInfo.codecName,
        ffmpegPath: this.ffmpegPath,
        args: args.join(' ')
      });

      // FFmpeg 바이너리 존재 확인
      if (!fs.existsSync(this.ffmpegPath)) {
        log.error('FFmpeg 바이너리가 존재하지 않음', { ffmpegPath: this.ffmpegPath });
        reject(new Error('FFmpeg를 찾을 수 없습니다'));
        return;
      }

      const ffmpegProcess = spawn(this.ffmpegPath, args);
      this.activeProcesses.set(taskId, { process: ffmpegProcess, filePath });

      let lastProgress = 0;
      const duration = codecInfo.duration || 0;
      let stderrOutput = ''; // stderr 출력 캡처 (오류 분석용)

      // FFmpeg는 stderr로 진행률 출력
      ffmpegProcess.stderr.on('data', (data) => {
        const line = data.toString();

        // 마지막 5000자만 저장 (메모리 절약)
        stderrOutput += line;
        if (stderrOutput.length > 5000) {
          stderrOutput = stderrOutput.slice(-5000);
        }

        // 진행률 파싱: time=00:00:51.23
        const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
        if (timeMatch && duration > 0) {
          const [, h, m, s, ms] = timeMatch;
          const currentTime = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 100;
          const progress = Math.min(99, Math.round((currentTime / duration) * 100));

          if (progress > lastProgress) {
            lastProgress = progress;
            if (onProgress) {
              onProgress(progress);
            }
          }
        }
      });

      ffmpegProcess.on('close', (code, signal) => {
        this.activeProcesses.delete(taskId);

        // 신호로 종료된 경우 (예: 사용자 취소)
        if (signal) {
          log.info('FFmpeg가 신호로 종료됨', { signal });
          reject(new Error(`변환이 취소되었습니다 (신호: ${signal})`));
          return;
        }

        if (code === 0) {
          // 변환 성공 - 파일 이름 변경 및 메타 저장
          try {
            fs.renameSync(tempPath, outputPath);

            const meta = {
              originalPath: filePath,
              originalSize: stats.size,
              originalMtime: stats.mtimeMs,
              originalCodec: codecInfo.codecName,
              convertedAt: new Date().toISOString(),
              settings: { codec: 'libx264', crf: 18, preset: 'fast' }
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

            log.info('트랜스코딩 완료', { filePath, outputPath });

            // 캐시 정리 (비동기)
            this._cleanupCacheIfNeeded().catch(() => {});

            if (onProgress) onProgress(100);
            resolve({ success: true, outputPath, fromCache: false });
          } catch (e) {
            log.error('트랜스코딩 후처리 실패', { error: e.message });
            reject(e);
          }
        } else {
          // 변환 실패
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }

          // 오류 원인 파싱
          let errorReason = '알 수 없는 오류';

          // 비정상적으로 큰 종료 코드는 크래시 의미
          if (code > 255 || code < 0) {
            errorReason = 'FFmpeg가 비정상 종료되었습니다';
          } else if (stderrOutput.includes('No such file or directory')) {
            errorReason = '파일을 찾을 수 없습니다';
          } else if (stderrOutput.includes('Permission denied')) {
            errorReason = '파일 접근 권한이 없습니다';
          } else if (stderrOutput.includes('Invalid data')) {
            errorReason = '손상된 파일입니다';
          } else if (stderrOutput.includes('Decoder') || stderrOutput.includes('codec')) {
            errorReason = '지원하지 않는 코덱입니다';
          } else if (stderrOutput.includes('moov atom not found')) {
            errorReason = '손상된 MP4 파일입니다 (moov atom 없음)';
          } else if (stderrOutput.includes('Error opening')) {
            errorReason = '파일을 열 수 없습니다';
          } else if (code === 1) {
            errorReason = '변환 중 오류가 발생했습니다';
          }

          log.error('트랜스코딩 실패', {
            filePath,
            code,
            errorReason,
            stderr: stderrOutput.slice(-1000) // 로그에 마지막 1000자만
          });

          reject(new Error(`${errorReason} (코드: ${code})`));
        }
      });

      ffmpegProcess.on('error', (error) => {
        this.activeProcesses.delete(taskId);
        let errorMsg = 'FFmpeg 실행 오류';
        if (error.code === 'ENOENT') {
          errorMsg = 'FFmpeg를 찾을 수 없습니다. 프로그램이 설치되어 있는지 확인하세요.';
        } else if (error.code === 'EACCES') {
          errorMsg = 'FFmpeg 실행 권한이 없습니다.';
        }
        log.error('FFmpeg 프로세스 오류', { error: error.message, code: error.code, ffmpegPath: this.ffmpegPath });
        reject(new Error(errorMsg));
      });
    });
  }

  /**
   * 트랜스코딩 취소
   */
  cancelTranscode(taskId) {
    const task = this.activeProcesses.get(taskId);
    if (task) {
      task.process.kill('SIGTERM');
      this.activeProcesses.delete(taskId);
      log.info('트랜스코딩 취소됨', { taskId });
      return true;
    }
    return false;
  }

  /**
   * 모든 트랜스코딩 취소
   */
  cancelAll() {
    for (const [taskId, task] of this.activeProcesses) {
      task.process.kill('SIGTERM');
      log.info('트랜스코딩 취소됨', { taskId });
    }
    this.activeProcesses.clear();
  }

  /**
   * 캐시 용량 제한 설정
   */
  setCacheLimit(limitGB) {
    this.cacheLimitBytes = limitGB * 1024 * 1024 * 1024;
    log.info('캐시 용량 제한 설정', { limitGB, limitBytes: this.cacheLimitBytes });
  }

  /**
   * 캐시 용량 제한 초과 시 정리
   */
  async _cleanupCacheIfNeeded() {
    const cacheSize = await this.getCacheSize();

    if (cacheSize.bytes <= this.cacheLimitBytes) {
      return;
    }

    log.info('캐시 용량 초과, 정리 시작', {
      current: cacheSize.formatted,
      limit: this._formatBytes(this.cacheLimitBytes)
    });

    // 캐시 폴더들을 접근 시간 순으로 정렬
    const folders = fs.readdirSync(this.cacheDir)
      .map(name => {
        const folderPath = path.join(this.cacheDir, name);
        const convertedPath = path.join(folderPath, 'converted.mp4');
        try {
          const stats = fs.statSync(convertedPath);
          return { name, folderPath, atime: stats.atimeMs, size: stats.size };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.atime - b.atime); // 가장 오래된 것 먼저

    let freedBytes = 0;
    const targetFree = cacheSize.bytes - this.cacheLimitBytes + (1024 * 1024 * 500); // 500MB 여유

    for (const folder of folders) {
      if (freedBytes >= targetFree) break;

      try {
        fs.rmSync(folder.folderPath, { recursive: true, force: true });
        freedBytes += folder.size;
        log.info('오래된 캐시 삭제', { folder: folder.name, size: this._formatBytes(folder.size) });
      } catch (e) {
        log.warn('캐시 삭제 실패', { folder: folder.name, error: e.message });
      }
    }

    log.info('캐시 정리 완료', { freedBytes: this._formatBytes(freedBytes) });
  }

  /**
   * 캐시 크기 조회
   */
  async getCacheSize() {
    if (!this.cacheDir || !fs.existsSync(this.cacheDir)) {
      return { bytes: 0, formatted: '0 Bytes', count: 0 };
    }

    let totalSize = 0;
    let count = 0;

    const folders = fs.readdirSync(this.cacheDir);
    for (const folder of folders) {
      const convertedPath = path.join(this.cacheDir, folder, 'converted.mp4');
      try {
        const stats = fs.statSync(convertedPath);
        totalSize += stats.size;
        count++;
      } catch {
        // 무시
      }
    }

    return {
      bytes: totalSize,
      formatted: this._formatBytes(totalSize),
      count,
      limit: this._formatBytes(this.cacheLimitBytes),
      limitBytes: this.cacheLimitBytes
    };
  }

  /**
   * 특정 비디오의 캐시 삭제
   */
  async clearVideoCache(filePath) {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const stats = fs.statSync(filePath);
    const fileHash = this._getFileHash(filePath, stats);
    const cacheFolder = path.join(this.cacheDir, fileHash);

    if (fs.existsSync(cacheFolder)) {
      fs.rmSync(cacheFolder, { recursive: true, force: true });
      log.info('비디오 캐시 삭제됨', { filePath, fileHash });
      return true;
    }

    return false;
  }

  /**
   * 전체 캐시 삭제
   */
  async clearAllCache() {
    if (!this.cacheDir || !fs.existsSync(this.cacheDir)) {
      return { deleted: 0, freedBytes: 0 };
    }

    const folders = fs.readdirSync(this.cacheDir);
    let deleted = 0;
    let freedBytes = 0;

    for (const folder of folders) {
      const folderPath = path.join(this.cacheDir, folder);
      try {
        const convertedPath = path.join(folderPath, 'converted.mp4');
        if (fs.existsSync(convertedPath)) {
          freedBytes += fs.statSync(convertedPath).size;
        }
        fs.rmSync(folderPath, { recursive: true, force: true });
        deleted++;
      } catch (e) {
        log.warn('캐시 폴더 삭제 실패', { folder, error: e.message });
      }
    }

    log.info('전체 캐시 삭제 완료', { deleted, freedBytes: this._formatBytes(freedBytes) });
    return { deleted, freedBytes, formatted: this._formatBytes(freedBytes) };
  }

  /**
   * 바이트 포맷팅
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * FFmpeg 사용 가능 여부
   */
  isAvailable() {
    return this.initialized && !!this.ffmpegPath;
  }
}

// 싱글톤 인스턴스
const ffmpegManager = new FFmpegManager();

module.exports = {
  ffmpegManager,
  FFmpegManager,
  SUPPORTED_CODECS
};
