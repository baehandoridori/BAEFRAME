/**
 * MPVManager - opt-in mpv pilot playback control.
 *
 * This is intentionally isolated from the existing FFmpeg path. Playback can
 * be enabled by renderer settings or BAEFRAME_MPV_PILOT=1, while availability
 * detection stays independent so the settings UI can report whether mpv exists.
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { createLogger } = require('./logger');

const log = createLogger('MPVManager');
const COMMAND_TIMEOUT_MS = 5000;
const IPC_READY_TIMEOUT_MS = 4000;

function isMpvPilotEnabled(env = process.env) {
  const value = String(env.BAEFRAME_MPV_PILOT || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function createMpvIpcPath({
  platform = process.platform,
  pid = process.pid,
  unique = Date.now().toString(36),
  tempDir = os.tmpdir()
} = {}) {
  const safeUnique = String(unique).replace(/[^a-zA-Z0-9_-]/g, '');
  if (platform === 'win32') {
    return `\\\\.\\pipe\\baeframe-mpv-${pid}-${safeUnique}`;
  }
  return path.posix.join(String(tempDir).replace(/\\/g, '/'), `baeframe-mpv-${pid}-${safeUnique}.sock`);
}

function normalizeMpvWid(wid) {
  if (wid === undefined || wid === null || wid === '') return null;
  const value = String(wid).trim();
  return /^\d+$/.test(value) ? value : null;
}

function normalizePlaybackPathForCompare(value) {
  if (!value) return '';
  const normalized = path.normalize(String(value)).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function createMpvLaunchArgs({ ipcPath, forceWindow = true, wid = null } = {}) {
  if (!ipcPath) {
    throw new Error('mpv IPC path is required');
  }

  const normalizedWid = normalizeMpvWid(wid);
  const args = [
    '--idle=yes',
    '--pause=yes',
    '--keep-open=yes',
    forceWindow ? '--force-window=yes' : '--force-window=no',
    '--no-config',
    '--no-terminal',
    '--msg-level=all=warn',
    '--hwdec=auto',
    `--input-ipc-server=${ipcPath}`
  ];

  if (normalizedWid) {
    args.push(
      `--wid=${normalizedWid}`,
      '--border=no',
      '--keepaspect-window=no',
      '--cursor-autohide=always'
    );
  }

  return args;
}

class MPVManager {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.processPid = options.processPid || process.pid;
    this.env = options.env || process.env;
    this.fs = options.fs || fs;
    this.net = options.net || net;
    this.spawn = options.spawn || spawn;
    this.execFile = options.execFile || execFile;
    this.logger = options.logger || log;
    this.now = options.now || (() => Date.now());
    this.tempDir = options.tempDir || os.tmpdir();

    this.appRoot = options.appRoot || path.join(__dirname, '..');
    this.resourcesPath = options.resourcesPath || process.resourcesPath || '';
    this.executableDir = options.executableDir || path.dirname(process.execPath || this.appRoot);

    this.initialized = false;
    this.mpvPath = null;
    this.ipcPath = null;
    this.process = null;
    this.requestId = 0;
    this.embeddedWid = null;
  }

  isEnabled() {
    return isMpvPilotEnabled(this.env);
  }

  isAvailable() {
    return Boolean(this.mpvPath);
  }

  async initialize() {
    if (this.initialized) {
      return this.isAvailable();
    }

    this.initialized = true;

    this.mpvPath = await this._detectMpv();
    if (!this.mpvPath) {
      if (this.isEnabled()) {
        this.logger.warn('mpv pilot enabled but executable not found');
      } else {
        this.logger.info('mpv executable not found; pilot remains unavailable');
      }
      return false;
    }

    this.logger.info('mpv executable detected', { mpvPath: this.mpvPath });
    return true;
  }

  async load(filePath, options = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('mpv load requires a file path');
    }
    if (!this._pathExists(filePath)) {
      throw new Error(`mpv load file not found: ${filePath}`);
    }

    await this.start({ wid: options.wid });
    await this.sendCommand(['loadfile', filePath, 'replace']);
    await this.waitForPlaybackReady(filePath);

    if (options.pause === false || options.play === true) {
      await this.play();
    } else {
      await this.pause();
    }

    return this.getStatus();
  }

  async play() {
    await this.sendCommand(['set_property', 'pause', false]);
    return { success: true };
  }

  async pause() {
    await this.sendCommand(['set_property', 'pause', true]);
    return { success: true };
  }

  async seek(time) {
    const numericTime = Number(time);
    if (!Number.isFinite(numericTime)) {
      throw new Error('mpv seek requires a finite time');
    }
    await this.sendCommand(['set_property', 'time-pos', Math.max(0, numericTime)]);
    return { success: true };
  }

  async getStatus() {
    await this.start();

    const [timePos, duration, paused, pathValue, width, height, fps] = await Promise.all([
      this.getOptionalProperty('time-pos', 0),
      this.getOptionalProperty('duration', 0),
      this.getOptionalProperty('pause', true),
      this.getOptionalProperty('path', ''),
      this.getOptionalProperty('width', 0),
      this.getOptionalProperty('height', 0),
      this.getOptionalProperty('container-fps', 24)
    ]);

    return {
      success: true,
      time: this._toNumber(timePos, 0),
      duration: this._toNumber(duration, 0),
      paused: Boolean(paused),
      path: pathValue || '',
      width: this._toNumber(width, 0),
      height: this._toNumber(height, 0),
      fps: this._toNumber(fps, 24)
    };
  }

  async getProperty(name) {
    const response = await this.sendCommand(['get_property', name]);
    return response.data;
  }

  async getOptionalProperty(name, fallback = null) {
    try {
      return await this.getProperty(name);
    } catch (error) {
      if (String(error.message || '').includes('property unavailable')) {
        return fallback;
      }
      throw error;
    }
  }

  async waitForPlaybackReady(expectedPath, {
    timeoutMs = 3000,
    intervalMs = 50
  } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastStatus = null;
    const requestedPath = normalizePlaybackPathForCompare(expectedPath);

    while (Date.now() < deadline) {
      const [timePos, duration, paused, pathValue, width, height, fps] = await Promise.all([
        this.getOptionalProperty('time-pos', null),
        this.getOptionalProperty('duration', 0),
        this.getOptionalProperty('pause', true),
        this.getOptionalProperty('path', ''),
        this.getOptionalProperty('width', 0),
        this.getOptionalProperty('height', 0),
        this.getOptionalProperty('container-fps', 24)
      ]);

      lastStatus = {
        success: true,
        time: this._toNumber(timePos, 0),
        duration: this._toNumber(duration, 0),
        paused: Boolean(paused),
        path: pathValue || '',
        width: this._toNumber(width, 0),
        height: this._toNumber(height, 0),
        fps: this._toNumber(fps, 24)
      };

      const loadedPath = normalizePlaybackPathForCompare(pathValue);
      const isRequestedPathLoaded = !requestedPath || loadedPath === requestedPath;
      if (timePos !== null && pathValue && isRequestedPathLoaded) {
        return lastStatus;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    if (lastStatus && !requestedPath) {
      return lastStatus;
    }

    throw new Error('mpv playback did not become ready for requested file');
  }

  async start(options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.isAvailable()) {
      throw new Error('mpv pilot is not available');
    }

    const hasWidOption = Object.prototype.hasOwnProperty.call(options, 'wid');
    const requestedWid = hasWidOption ? normalizeMpvWid(options.wid) : this.embeddedWid;
    if (this.process && !this.process.killed && this.embeddedWid !== requestedWid) {
      await this.stop();
    }

    if (this.process && !this.process.killed) {
      return true;
    }

    this.ipcPath = createMpvIpcPath({
      platform: this.platform,
      pid: this.processPid,
      unique: this.now().toString(36),
      tempDir: this.tempDir
    });

    const args = createMpvLaunchArgs({ ipcPath: this.ipcPath, forceWindow: true, wid: requestedWid });
    this.logger.info('starting mpv pilot process', { mpvPath: this.mpvPath, args });
    this.embeddedWid = requestedWid;

    this.process = this.spawn(this.mpvPath, args, {
      stdio: 'ignore',
      windowsHide: true
    });

    this.process.on?.('exit', (code, signal) => {
      this.logger.info('mpv process exited', { code, signal });
      this.process = null;
    });

    this.process.on?.('error', (error) => {
      this.logger.error('mpv process error', { error: error.message });
    });

    await this._waitForIpcReady();
    return true;
  }

  async stop() {
    const processRef = this.process;
    if (!processRef) {
      return { success: true, stopped: false };
    }

    try {
      await this.sendCommand(['quit']);
    } catch (error) {
      this.logger.debug('mpv quit command failed, killing process', { error: error.message });
    }

    if (processRef && !processRef.killed) {
      processRef.kill();
    }

    this.process = null;
    this.embeddedWid = null;
    return { success: true, stopped: true };
  }

  async sendCommand(command, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (!Array.isArray(command) || command.length === 0) {
      throw new Error('mpv command must be a non-empty array');
    }
    if (!this.ipcPath) {
      throw new Error('mpv IPC path is not ready');
    }

    const requestId = ++this.requestId;
    const payload = JSON.stringify({ command, request_id: requestId }) + '\n';

    return new Promise((resolve, reject) => {
      const socket = this.net.connect(this.ipcPath);
      let buffer = '';
      let settled = false;

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        finish(new Error(`mpv command timed out: ${command[0]}`));
      }, timeoutMs);

      socket.on('connect', () => {
        socket.write(payload);
      });

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }

          if (message.request_id !== undefined && message.request_id !== requestId) {
            continue;
          }

          if (message.error && message.error !== 'success') {
            finish(new Error(`mpv command failed: ${message.error}`));
            return;
          }

          if (message.error === 'success' || message.request_id === requestId) {
            finish(null, message);
            return;
          }
        }
      });

      socket.on('error', (error) => finish(error));
      socket.on('end', () => {
        if (!settled) {
          finish(new Error('mpv IPC connection ended before response'));
        }
      });
    });
  }

  async _waitForIpcReady(timeoutMs = IPC_READY_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        await this._probeIpc();
        return true;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(`mpv IPC did not become ready: ${lastError?.message || 'timeout'}`);
  }

  _probeIpc() {
    return new Promise((resolve, reject) => {
      const socket = this.net.connect(this.ipcPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('probe timeout'));
      }, 500);

      socket.on('connect', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async _detectMpv() {
    const executableName = this.platform === 'win32' ? 'mpv.exe' : 'mpv';
    const searchDirs = this._getBundledSearchDirs();

    for (const dir of searchDirs) {
      const candidate = path.join(dir, executableName);
      if (this._pathExists(candidate)) {
        return candidate;
      }
    }

    return this._findInPath(executableName);
  }

  _getBundledSearchDirs() {
    const dirs = [
      path.join(this.resourcesPath, 'mpv', 'win32'),
      path.join(this.resourcesPath, 'mpv'),
      path.join(this.executableDir, 'resources', 'mpv', 'win32'),
      path.join(this.executableDir, 'resources', 'mpv'),
      path.join(this.executableDir, 'mpv', 'win32'),
      path.join(this.executableDir, 'mpv'),
      path.join(this.appRoot, 'mpv', 'win32'),
      path.join(this.appRoot, 'mpv')
    ];

    return [...new Set(dirs.filter(Boolean).map((dir) => path.normalize(dir)))];
  }

  _findInPath(executableName) {
    return new Promise((resolve) => {
      const command = this.platform === 'win32' ? 'where' : 'which';
      this.execFile(command, [executableName], { windowsHide: true }, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const found = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        resolve(found || null);
      });
    });
  }

  _pathExists(candidate) {
    try {
      this.fs.accessSync(candidate, fs.constants.F_OK);
      return true;
    } catch {
      try {
        return Boolean(this.fs.existsSync?.(candidate));
      } catch {
        return false;
      }
    }
  }

  _toNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
}

const mpvManager = new MPVManager();

module.exports = {
  MPVManager,
  createMpvIpcPath,
  createMpvLaunchArgs,
  isMpvPilotEnabled,
  mpvManager
};
