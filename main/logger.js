/**
 * baeframe 메인 프로세스 로거
 * 콘솔 및 파일 로깅 지원
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class MainLogger {
  constructor(module, options = {}) {
    this.module = module;
    this.level = options.level ?? LOG_LEVELS.DEBUG;
    this.enableConsole = options.console ?? true;
    this.enableFile = options.file ?? true;
    this.logDir = options.logDir ?? path.join(process.cwd(), 'logs');
    this.logFile = null;

    this._ensureLogDir();
  }

  _ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _getLogFilePath() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `baeframe-${date}.log`);
  }

  _format(level, message, data) {
    const timestamp = new Date().toISOString();
    const levelName = Object.keys(LOG_LEVELS).find(k => LOG_LEVELS[k] === level);
    return {
      timestamp,
      level: levelName,
      module: this.module,
      message,
      data
    };
  }

  _getConsoleColor(level) {
    switch (level) {
      case LOG_LEVELS.DEBUG: return '\x1b[90m'; // Gray
      case LOG_LEVELS.INFO: return '\x1b[36m';  // Cyan
      case LOG_LEVELS.WARN: return '\x1b[33m';  // Yellow
      case LOG_LEVELS.ERROR: return '\x1b[31m'; // Red
      default: return '\x1b[0m';
    }
  }

  _output(level, message, data) {
    if (level < this.level) return;

    const log = this._format(level, message, data);
    const reset = '\x1b[0m';
    const color = this._getConsoleColor(level);
    const timeStr = log.timestamp.slice(11, 23);

    // 콘솔 출력
    if (this.enableConsole) {
      const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : '';
      console.log(
        `\x1b[90m[${timeStr}]${reset} ${color}[${log.level}]${reset} [${this.module}] ${message}${dataStr}`
      );
    }

    // 파일 출력
    if (this.enableFile) {
      const logLine = JSON.stringify(log) + '\n';
      fs.appendFileSync(this._getLogFilePath(), logLine, 'utf-8');
    }
  }

  debug(message, data) { this._output(LOG_LEVELS.DEBUG, message, data); }
  info(message, data) { this._output(LOG_LEVELS.INFO, message, data); }
  warn(message, data) { this._output(LOG_LEVELS.WARN, message, data); }
  error(message, data) { this._output(LOG_LEVELS.ERROR, message, data); }

  /**
   * 함수 실행 추적
   * @param {string} fnName - 함수 이름
   * @returns {{ end: Function, error: Function }}
   */
  trace(fnName) {
    this.debug(`→ ${fnName}() 호출`);
    const startTime = Date.now();

    return {
      end: (result) => {
        const duration = Date.now() - startTime;
        this.debug(`← ${fnName}() 완료 (${duration}ms)`, result);
      },
      error: (err) => {
        const duration = Date.now() - startTime;
        this.error(`✖ ${fnName}() 실패 (${duration}ms)`, {
          message: err?.message,
          stack: err?.stack
        });
      }
    };
  }

  /**
   * 로그 레벨 설정
   * @param {'DEBUG' | 'INFO' | 'WARN' | 'ERROR'} levelName
   */
  setLevel(levelName) {
    if (LOG_LEVELS[levelName] !== undefined) {
      this.level = LOG_LEVELS[levelName];
    }
  }
}

/**
 * 모듈별 로거 생성
 * @param {string} module - 모듈 이름
 * @param {Object} options - 옵션
 * @returns {MainLogger}
 */
function createLogger(module, options = {}) {
  return new MainLogger(module, options);
}

module.exports = { createLogger, LOG_LEVELS };
