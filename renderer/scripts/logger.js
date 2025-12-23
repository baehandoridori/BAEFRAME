/**
 * baeframe 렌더러 프로세스 로거
 * 콘솔, UI 패널, 파일 로깅 지원
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

class Logger {
  constructor(module, options = {}) {
    this.module = module;
    this.level = options.level ?? LOG_LEVELS.DEBUG;
    this.enableConsole = options.console ?? true;
    this.enableFile = options.file ?? false;
    this.enableUI = options.ui ?? true;
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

  _getConsoleStyle(level) {
    switch (level) {
      case LOG_LEVELS.DEBUG: return 'color: #888';
      case LOG_LEVELS.INFO: return 'color: #4a9eff';
      case LOG_LEVELS.WARN: return 'color: #ffd000';
      case LOG_LEVELS.ERROR: return 'color: #ff4757; font-weight: bold';
      default: return 'color: inherit';
    }
  }

  _output(level, message, data) {
    if (level < this.level) return;

    const log = this._format(level, message, data);

    // 콘솔 출력
    if (this.enableConsole) {
      const style = this._getConsoleStyle(level);
      const timeStr = log.timestamp.slice(11, 23);

      if (data !== undefined) {
        console.log(
          `%c[${timeStr}]%c [${log.module}] %c${log.message}`,
          'color: gray',
          style,
          'color: inherit',
          data
        );
      } else {
        console.log(
          `%c[${timeStr}]%c [${log.module}] %c${log.message}`,
          'color: gray',
          style,
          'color: inherit'
        );
      }
    }

    // UI 로그 패널 출력
    if (this.enableUI && window.logPanel) {
      window.logPanel.add(log);
    }

    // 파일 출력 (IPC를 통해 메인 프로세스로)
    if (this.enableFile && window.electronAPI) {
      window.electronAPI.writeLog(log);
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
    const startTime = performance.now();

    return {
      end: (result) => {
        const duration = (performance.now() - startTime).toFixed(2);
        this.debug(`← ${fnName}() 완료 (${duration}ms)`, result);
      },
      error: (err) => {
        const duration = (performance.now() - startTime).toFixed(2);
        this.error(`✖ ${fnName}() 실패 (${duration}ms)`, err);
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
 * @returns {Logger}
 */
export function createLogger(module, options = {}) {
  return new Logger(module, options);
}

// 전역 에러 핸들러 설정
export function setupGlobalErrorHandlers() {
  const globalLog = createLogger('Global');

  window.onerror = (message, source, line, col, error) => {
    globalLog.error('Uncaught Error', {
      message,
      source,
      line,
      col,
      stack: error?.stack
    });
  };

  window.onunhandledrejection = (event) => {
    globalLog.error('Unhandled Promise Rejection', {
      reason: event.reason
    });
  };
}

export { LOG_LEVELS };
export default Logger;
