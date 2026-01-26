/**
 * FFmpegManager - BAEFRAME 비디오 트랜스코딩 관리
 *
 * 미지원 코덱(MPEG-4 Part 2, PNG MOV 등)을 H.264로 변환
 */

const { app } = require('electron');
const { spawn, execFile, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createLogger } = require('./logger');

const log = createLogger('FFmpegManager');

// 지원되는 코덱 (변환 불필요)
const SUPPORTED_CODECS = ['h264', 'avc1', 'vp8', 'vp9', 'av1'];

// H.264 인코더 우선순위 (앞에 있을수록 우선)
const H264_ENCODERS = [
  { name: 'libx264', args: ['-preset', 'fast', '-crf', '18'] },  // 소프트웨어 (가장 호환성 좋음)
  { name: 'h264_nvenc', args: ['-preset', 'fast', '-cq', '18'] }, // NVIDIA GPU
  { name: 'h264_amf', args: ['-quality', 'balanced', '-rc', 'cqp', '-qp', '18'] }, // AMD GPU
  { name: 'h264_qsv', args: ['-preset', 'fast', '-global_quality', '18'] }, // Intel Quick Sync
  { name: 'h264_mf', args: ['-q:v', '80'] } // Windows Media Foundation (항상 사용 가능)
];

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
    this.availableEncoder = null; // 감지된 사용 가능한 인코더
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
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';

    // 1. 번들된 바이너리 확인 (extraResources)
    // 여러 가지 경로를 시도하여 다양한 실행 환경에서 작동하도록 함
    const bundledPaths = [];

    // process.resourcesPath (패키징된 앱에서 설정됨)
    if (process.resourcesPath) {
      bundledPaths.push(
        path.join(process.resourcesPath, 'ffmpeg', 'win32'),
        path.join(process.resourcesPath, 'ffmpeg')
      );
    }

    // app.getPath('exe') 기반 경로 (앱 실행 파일 위치 기준)
    // 공유 드라이브나 네트워크 경로에서 더 안정적
    try {
      const exePath = app.getPath('exe');
      const exeDir = path.dirname(exePath);
      bundledPaths.push(
        path.join(exeDir, 'resources', 'ffmpeg', 'win32'),
        path.join(exeDir, 'resources', 'ffmpeg'),
        path.join(exeDir, 'ffmpeg', 'win32'),
        path.join(exeDir, 'ffmpeg')
      );
    } catch (e) {
      log.debug('app.getPath("exe") 실패', { error: e.message });
    }

    // 개발 환경 fallback
    bundledPaths.push(
      path.join(__dirname, '..', 'ffmpeg', 'win32'),
      path.join(__dirname, '..', 'ffmpeg')
    );

    log.info('FFmpeg 경로 탐색 시작', {
      resourcesPath: process.resourcesPath,
      searchPaths: bundledPaths
    });

    for (const dir of bundledPaths) {
      const ffmpegExe = path.join(dir, exeName);
      const ffprobeExe = path.join(dir, probeName);

      try {
        // fs.accessSync로 파일 접근 가능 여부 확인 (더 안정적)
        // R_OK: 읽기 가능, X_OK: 실행 가능 (Windows에서는 R_OK만으로 충분)
        let ffmpegAccessible = false;
        let ffprobeAccessible = false;

        try {
          fs.accessSync(ffmpegExe, fs.constants.R_OK);
          ffmpegAccessible = true;
        } catch (accessErr) {
          log.debug('ffmpeg 접근 불가', { path: ffmpegExe, error: accessErr.code || accessErr.message });
        }

        try {
          fs.accessSync(ffprobeExe, fs.constants.R_OK);
          ffprobeAccessible = true;
        } catch (accessErr) {
          log.debug('ffprobe 접근 불가', { path: ffprobeExe, error: accessErr.code || accessErr.message });
        }

        log.debug('경로 확인', { dir, ffmpegAccessible, ffprobeAccessible });

        if (ffmpegAccessible && ffprobeAccessible) {
          // 추가 검증: 파일 크기 확인 (빈 파일이나 placeholder 감지)
          const ffmpegStats = fs.statSync(ffmpegExe);
          const ffprobeStats = fs.statSync(ffprobeExe);

          if (ffmpegStats.size < 1000000 || ffprobeStats.size < 1000000) {
            log.warn('FFmpeg 파일이 너무 작음 (placeholder 가능성)', {
              ffmpegSize: ffmpegStats.size,
              ffprobeSize: ffprobeStats.size
            });
            continue; // 다음 경로 시도
          }

          log.info('번들된 FFmpeg 발견', { dir, ffmpeg: ffmpegExe, ffprobe: ffprobeExe });
          return { ffmpeg: ffmpegExe, ffprobe: ffprobeExe };
        }
      } catch (e) {
        log.debug('경로 확인 실패', { dir, error: e.message });
      }
    }

    log.warn('번들된 FFmpeg를 찾을 수 없음, 시스템 PATH에서 검색');

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

    log.error('FFmpeg를 찾을 수 없습니다', {
      hint: 'ffmpeg/win32/ 폴더에 ffmpeg.exe와 ffprobe.exe를 넣거나, 시스템 PATH에 FFmpeg를 설치하세요.',
      searchedPaths: bundledPaths
    });

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
   * 사용 가능한 H.264 인코더 감지
   */
  async _detectAvailableEncoder() {
    if (this.availableEncoder) {
      return this.availableEncoder;
    }

    if (!this.ffmpegPath) {
      return null;
    }

    log.info('H.264 인코더 감지 시작');

    // 먼저 사용 가능한 H.264 인코더 목록 로깅
    try {
      const allEncoders = await this._listH264Encoders();
      log.info('FFmpeg에서 발견된 H.264 인코더', { encoders: allEncoders });
    } catch (e) {
      log.warn('인코더 목록 조회 실패', { error: e.message });
    }

    for (const encoder of H264_ENCODERS) {
      try {
        const isAvailable = await this._checkEncoderAvailable(encoder.name);
        if (isAvailable) {
          this.availableEncoder = encoder;
          log.info('사용 가능한 인코더 발견', { encoder: encoder.name });
          return encoder;
        }
      } catch (e) {
        log.debug('인코더 확인 실패', { encoder: encoder.name, error: e.message });
      }
    }

    // 모든 감지 실패 시, libx264를 기본값으로 시도 (대부분의 FFmpeg 빌드에 포함)
    log.warn('인코더 감지 실패, libx264를 기본값으로 시도합니다');
    const fallbackEncoder = H264_ENCODERS[0]; // libx264
    this.availableEncoder = fallbackEncoder;
    return fallbackEncoder;
  }

  /**
   * FFmpeg에서 사용 가능한 H.264 인코더 목록 조회
   */
  _listH264Encoders() {
    return new Promise((resolve, reject) => {
      execFile(this.ffmpegPath, ['-encoders'], { timeout: 10000, windowsHide: true }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        // h264 관련 인코더만 필터링
        const lines = stdout.split('\n');
        const h264Encoders = lines
          .filter(line => /h264|x264|264/i.test(line) && line.trim().startsWith('V'))
          .map(line => {
            const match = line.match(/V[.\w]+\s+(\S+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean);

        resolve(h264Encoders);
      });
    });
  }

  /**
   * 특정 인코더 사용 가능 여부 확인
   */
  _checkEncoderAvailable(encoderName) {
    return new Promise((resolve) => {
      // ffmpeg -encoders 출력에서 인코더 확인
      const args = ['-encoders'];

      execFile(this.ffmpegPath, args, { timeout: 10000, windowsHide: true }, (error, stdout) => {
        if (error) {
          log.debug('인코더 목록 조회 실패', { error: error.message });
          resolve(false);
          return;
        }

        // 인코더 이름이 출력에 있는지 확인
        // 형식: " V..... libx264" 또는 " V....D h264_mf"
        const encoderPattern = new RegExp(`\\s${encoderName}\\s`, 'i');
        const isAvailable = encoderPattern.test(stdout);

        log.debug('인코더 확인', { encoderName, isAvailable });
        resolve(isAvailable);
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
      // 경로에 특수문자(한글, 공백 등)가 있는지 확인
      const hasSpecialChars = /[^\x00-\x7F]|[ ]/.test(filePath) ||
                              /[^\x00-\x7F]|[ ]/.test(this.ffprobePath);

      const execOptions = { timeout: 30000, windowsHide: true };

      // Windows에서 특수문자 경로는 exec로 전체 명령 문자열 실행
      // (execFile + shell:true는 실행파일 경로에 공백이 있으면 실패)
      if (process.platform === 'win32' && hasSpecialChars) {
        const command = `"${this.ffprobePath}" -v quiet -print_format json -show_streams -select_streams v:0 "${filePath}"`;
        log.debug('exec 명령 실행', { command });

        exec(command, execOptions, (error, stdout) => {
          if (error) {
            log.error('ffprobe 실행 실패 (exec)', { error: error.message, filePath });
            reject(error);
            return;
          }
          this._parseProbeOutput(stdout, filePath, resolve, reject);
        });
        return;
      }

      // 일반 경로: execFile 사용
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-select_streams', 'v:0',
        filePath
      ];

      execFile(this.ffprobePath, args, execOptions, (error, stdout) => {
        if (error) {
          log.error('ffprobe 실행 실패', { error: error.message, filePath });
          reject(error);
          return;
        }
        this._parseProbeOutput(stdout, filePath, resolve, reject);
      });
    });
  }

  /**
   * ffprobe 출력 파싱
   */
  _parseProbeOutput(stdout, filePath, resolve, reject) {
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
   * @param {Object} _options - 내부 옵션 (재시도용)
   * @returns {Promise<{success: boolean, outputPath: string}>}
   */
  async transcode(filePath, onProgress = null, _options = {}) {
    const { forceEncoder = null, isRetry = false } = _options;
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

    // 사용 가능한 인코더 감지 (forceEncoder가 있으면 강제 사용)
    let encoder;
    if (forceEncoder) {
      encoder = forceEncoder;
      log.info('강제 인코더 사용', { encoder: encoder.name, reason: 'fallback' });
    } else {
      encoder = await this._detectAvailableEncoder();
      if (!encoder) {
        throw new Error('사용 가능한 H.264 인코더가 없습니다. FFmpeg 빌드를 확인하세요.');
      }
    }

    return new Promise((resolve, reject) => {
      const taskId = `transcode_${Date.now()}`;

      // 인코더에 따른 args 구성
      // 색 공간 변환 필터: 비표준 색공간 → BT.709 표준으로 변환
      const colorFilter = 'colorspace=all=bt709:iall=bt601-6-625:fast=1';

      const args = [
        '-i', filePath,
        '-vf', colorFilter,     // 색 공간 변환 필터
        '-c:v', encoder.name,
        '-pix_fmt', 'yuv420p',  // HTML5 Video 호환 픽셀 포맷
        // 출력 색 공간 메타데이터 설정
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-color_range', 'tv',   // 제한 범위 (16-235)
        ...encoder.args,        // 인코더별 옵션
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
        encoder: encoder.name,
        ffmpegPath: this.ffmpegPath,
        args: args.join(' ')
      });

      // FFmpeg 바이너리 존재 확인
      if (!fs.existsSync(this.ffmpegPath)) {
        log.error('FFmpeg 바이너리가 존재하지 않음', { ffmpegPath: this.ffmpegPath });
        reject(new Error('FFmpeg를 찾을 수 없습니다'));
        return;
      }

      // 입력 파일 접근 가능 여부 확인
      try {
        fs.accessSync(filePath, fs.constants.R_OK);
      } catch (accessError) {
        log.error('입력 파일에 접근할 수 없음', {
          filePath,
          error: accessError.message,
          hint: 'Google Drive 파일이 다운로드되지 않았거나 접근 권한이 없을 수 있습니다'
        });
        reject(new Error('파일에 접근할 수 없습니다. Google Drive 파일인 경우 다운로드가 완료되었는지 확인하세요.'));
        return;
      }

      // 네트워크 경로 감지 및 경고
      const isNetworkPath = filePath.startsWith('\\\\') ||
                           (filePath.length > 2 && filePath[1] === ':' && filePath.includes('공유 드라이브'));
      if (isNetworkPath) {
        log.warn('네트워크 경로 감지됨 - 트랜스코딩이 느리거나 실패할 수 있습니다', { filePath });
      }

      // Windows에서 spawn 옵션 설정
      const spawnOptions = {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true // 콘솔 창 숨기기
      };

      // 경로에 특수문자(한글, 공백 등)가 있으면 shell 모드 사용
      const hasSpecialChars = /[^\x00-\x7F]|[ ]/.test(filePath) ||
                              /[^\x00-\x7F]|[ ]/.test(this.ffmpegPath) ||
                              /[^\x00-\x7F]|[ ]/.test(tempPath);

      let ffmpegProcess;
      if (process.platform === 'win32' && hasSpecialChars) {
        // shell 모드에서는 실행 파일과 모든 경로를 따옴표로 감싸야 함
        spawnOptions.shell = true;
        args[1] = `"${filePath}"`;  // -i 다음의 입력 파일
        args[args.length - 1] = `"${tempPath}"`; // 출력 파일

        // 실행 파일 경로도 따옴표로 감싸서 전달
        const quotedFfmpeg = `"${this.ffmpegPath}"`;
        log.info('특수문자 경로 감지, shell 모드 사용', { ffmpegPath: quotedFfmpeg, filePath });
        ffmpegProcess = spawn(quotedFfmpeg, args, spawnOptions);
      } else {
        ffmpegProcess = spawn(this.ffmpegPath, args, spawnOptions);
      }
      this.activeProcesses.set(taskId, { process: ffmpegProcess, filePath });

      let lastProgress = 0;
      const duration = codecInfo.duration || 0;
      let stderrOutput = ''; // stderr 출력 캡처 (오류 분석용)
      let receivedAnyOutput = false;

      // FFmpeg 시작 타임아웃 (10초 내에 아무 출력도 없으면 문제)
      const startupTimeout = setTimeout(() => {
        if (!receivedAnyOutput) {
          log.error('FFmpeg 시작 타임아웃 - 응답 없음', {
            ffmpegPath: this.ffmpegPath,
            filePath,
            hint: 'FFmpeg가 시작되지 않았습니다. 네트워크 드라이브나 파일 접근 문제일 수 있습니다.'
          });
          ffmpegProcess.kill('SIGKILL');
          reject(new Error('FFmpeg가 응답하지 않습니다. 파일이 Google Drive에 있다면 먼저 로컬에 다운로드해 주세요.'));
        }
      }, 10000);

      // FFmpeg는 stderr로 진행률 출력
      ffmpegProcess.stderr.on('data', (data) => {
        const line = data.toString();
        receivedAnyOutput = true;

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
        clearTimeout(startupTimeout);
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
              settings: { encoder: encoder.name, args: encoder.args }
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

          // 하드웨어 인코더 실패 감지 (GPU 없음, 드라이버 문제 등)
          const isHardwareEncoderError =
            stderrOutput.includes('Error while opening encoder') ||
            stderrOutput.includes('Function not implemented') ||
            stderrOutput.includes('Cannot load') ||
            stderrOutput.includes('Driver does not support') ||
            stderrOutput.includes('No capable devices found');

          const isHardwareEncoder = encoder.name !== 'libx264';

          // 하드웨어 인코더 실패 시 libx264로 자동 재시도
          if (isHardwareEncoderError && isHardwareEncoder && !isRetry) {
            log.warn('하드웨어 인코더 실패, libx264로 재시도합니다', {
              failedEncoder: encoder.name,
              stderr: stderrOutput.slice(-500)
            });

            // libx264 인코더 가져오기
            const softwareEncoder = H264_ENCODERS.find(e => e.name === 'libx264') || H264_ENCODERS[0];

            // 캐시된 인코더 정보를 libx264로 업데이트 (이후 트랜스코딩에도 적용)
            this.availableEncoder = softwareEncoder;

            // libx264로 재시도
            this.transcode(filePath, onProgress, { forceEncoder: softwareEncoder, isRetry: true })
              .then(resolve)
              .catch(reject);
            return;
          }

          // 오류 원인 파싱
          let errorReason = '알 수 없는 오류';

          // 인코더 관련 오류 (가장 먼저 체크)
          if (stderrOutput.includes('Unknown encoder') || stderrOutput.includes('Encoder not found')) {
            errorReason = 'FFmpeg에 필요한 인코더가 없습니다. 앱을 재시작해 주세요.';
            // 캐시된 인코더 정보 초기화 (다음에 다시 감지)
            this.availableEncoder = null;
          // 비정상적으로 큰 종료 코드는 크래시 의미 (Windows 에러 코드 또는 메모리 접근 오류)
          } else if (code > 255 || code < 0) {
            if (!receivedAnyOutput) {
              errorReason = 'FFmpeg가 시작되지 못했습니다. 파일 경로나 네트워크 드라이브 문제일 수 있습니다.';
            } else {
              errorReason = 'FFmpeg가 비정상 종료되었습니다';
            }
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
            encoder: encoder.name,
            stderr: stderrOutput.slice(-1000) // 로그에 마지막 1000자만
          });

          reject(new Error(`${errorReason} (코드: ${code})`));
        }
      });

      ffmpegProcess.on('error', (error) => {
        clearTimeout(startupTimeout);
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
   * 트랜스코딩 취소 (스트림 정리 + 타임아웃 후 SIGKILL)
   */
  cancelTranscode(taskId) {
    const task = this.activeProcesses.get(taskId);
    if (task) {
      this._killProcess(task.process, taskId);
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
      this._killProcess(task.process, taskId);
      log.info('트랜스코딩 취소됨', { taskId });
    }
    this.activeProcesses.clear();
  }

  /**
   * 프로세스 강제 종료 (스트림 정리 포함)
   */
  _killProcess(process, taskId) {
    try {
      // 스트림 정리
      if (process.stdin && !process.stdin.destroyed) {
        process.stdin.destroy();
      }
      if (process.stdout && !process.stdout.destroyed) {
        process.stdout.destroy();
      }
      if (process.stderr && !process.stderr.destroyed) {
        process.stderr.destroy();
      }

      // SIGTERM으로 graceful 종료 시도
      process.kill('SIGTERM');

      // 5초 후에도 종료되지 않으면 SIGKILL로 강제 종료
      setTimeout(() => {
        try {
          if (!process.killed) {
            log.warn('프로세스가 SIGTERM에 응답하지 않음, SIGKILL 전송', { taskId });
            process.kill('SIGKILL');
          }
        } catch (e) {
          // 이미 종료된 경우 무시
        }
      }, 5000);
    } catch (e) {
      log.warn('프로세스 종료 중 오류', { taskId, error: e.message });
    }
  }

  /**
   * 캐시 용량 제한 설정
   */
  setCacheLimit(limitGB) {
    this.cacheLimitBytes = limitGB * 1024 * 1024 * 1024;
    log.info('캐시 용량 제한 설정', { limitGB, limitBytes: this.cacheLimitBytes });
  }

  /**
   * 캐시 용량 제한 초과 시 정리 (비동기)
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

    // 캐시 폴더들을 접근 시간 순으로 정렬 (비동기)
    let folderNames;
    try {
      folderNames = await fs.promises.readdir(this.cacheDir);
    } catch {
      return;
    }

    const folders = [];
    for (const name of folderNames) {
      const folderPath = path.join(this.cacheDir, name);
      const convertedPath = path.join(folderPath, 'converted.mp4');
      try {
        const stats = await fs.promises.stat(convertedPath);
        folders.push({ name, folderPath, atime: stats.atimeMs, size: stats.size });
      } catch {
        // 무시
      }
    }

    folders.sort((a, b) => a.atime - b.atime); // 가장 오래된 것 먼저

    let freedBytes = 0;
    const targetFree = cacheSize.bytes - this.cacheLimitBytes + (1024 * 1024 * 500); // 500MB 여유

    for (const folder of folders) {
      if (freedBytes >= targetFree) break;

      try {
        await fs.promises.rm(folder.folderPath, { recursive: true, force: true });
        freedBytes += folder.size;
        log.info('오래된 캐시 삭제', { folder: folder.name, size: this._formatBytes(folder.size) });
      } catch (e) {
        log.warn('캐시 삭제 실패', { folder: folder.name, error: e.message });
      }
    }

    log.info('캐시 정리 완료', { freedBytes: this._formatBytes(freedBytes) });
  }

  /**
   * 캐시 크기 조회 (비동기)
   */
  async getCacheSize() {
    if (!this.cacheDir) {
      return { bytes: 0, formatted: '0 Bytes', count: 0 };
    }

    try {
      await fs.promises.access(this.cacheDir);
    } catch {
      return { bytes: 0, formatted: '0 Bytes', count: 0 };
    }

    let totalSize = 0;
    let count = 0;

    try {
      const folders = await fs.promises.readdir(this.cacheDir);
      for (const folder of folders) {
        const convertedPath = path.join(this.cacheDir, folder, 'converted.mp4');
        try {
          const stats = await fs.promises.stat(convertedPath);
          totalSize += stats.size;
          count++;
        } catch {
          // 무시
        }
      }
    } catch {
      // 무시
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
   * 특정 비디오의 캐시 삭제 (비동기)
   */
  async clearVideoCache(filePath) {
    try {
      await fs.promises.access(filePath);
    } catch {
      return false;
    }

    const stats = await fs.promises.stat(filePath);
    const fileHash = this._getFileHash(filePath, stats);
    const cacheFolder = path.join(this.cacheDir, fileHash);

    try {
      await fs.promises.access(cacheFolder);
      await fs.promises.rm(cacheFolder, { recursive: true, force: true });
      log.info('비디오 캐시 삭제됨', { filePath, fileHash });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 전체 캐시 삭제 (비동기)
   */
  async clearAllCache() {
    if (!this.cacheDir) {
      return { deleted: 0, freedBytes: 0 };
    }

    try {
      await fs.promises.access(this.cacheDir);
    } catch {
      return { deleted: 0, freedBytes: 0 };
    }

    let folders;
    try {
      folders = await fs.promises.readdir(this.cacheDir);
    } catch {
      return { deleted: 0, freedBytes: 0 };
    }

    let deleted = 0;
    let freedBytes = 0;

    for (const folder of folders) {
      const folderPath = path.join(this.cacheDir, folder);
      try {
        const convertedPath = path.join(folderPath, 'converted.mp4');
        try {
          const stats = await fs.promises.stat(convertedPath);
          freedBytes += stats.size;
        } catch {
          // 무시
        }
        await fs.promises.rm(folderPath, { recursive: true, force: true });
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
