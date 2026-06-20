const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  MPVManager,
  createMpvLaunchArgs,
  createMpvIpcPath,
  isMpvPilotEnabled
} = require('../../main/mpv-manager');

function createManager(options = {}) {
  const existing = new Set(options.existing || []);
  return new MPVManager({
    platform: options.platform || 'win32',
    processPid: 4242,
    env: options.env || {},
    appRoot: options.appRoot || 'C:\\repo',
    resourcesPath: options.resourcesPath || 'C:\\repo\\resources',
    executableDir: options.executableDir || 'C:\\Program Files\\BAEFRAME',
    tempDir: options.tempDir || 'C:\\Temp',
    fs: {
      existsSync: (candidate) => existing.has(path.normalize(candidate)),
      accessSync: (candidate) => {
        if (!existing.has(path.normalize(candidate))) {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        }
      }
    },
    execFile: (_cmd, _args, _opts, callback) => callback(new Error('not in path'), ''),
    spawn: () => {
      throw new Error('spawn should not be called by this test');
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {}
    }
  });
}

test('mpv pilot is disabled unless BAEFRAME_MPV_PILOT is enabled', () => {
  assert.equal(isMpvPilotEnabled({}), false);
  assert.equal(isMpvPilotEnabled({ BAEFRAME_MPV_PILOT: '0' }), false);
  assert.equal(isMpvPilotEnabled({ BAEFRAME_MPV_PILOT: '1' }), true);
  assert.equal(isMpvPilotEnabled({ BAEFRAME_MPV_PILOT: 'true' }), true);
});

test('detects bundled Windows mpv before system PATH', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [bundledPath]
  });

  const detected = await manager.initialize();

  assert.equal(detected, true);
  assert.equal(manager.isAvailable(), true);
  assert.equal(path.normalize(manager.mpvPath), bundledPath);
});

test('detects mpv availability even when pilot env is not enabled', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const manager = createManager({
    existing: [bundledPath]
  });

  const detected = await manager.initialize();

  assert.equal(detected, true);
  assert.equal(manager.isEnabled(), false);
  assert.equal(manager.isAvailable(), true);
  assert.equal(path.normalize(manager.mpvPath), bundledPath);
});

test('creates stable platform-specific IPC paths', () => {
  assert.match(createMpvIpcPath({ platform: 'win32', pid: 77, unique: 'abc' }), /^\\\\\.\\pipe\\baeframe-mpv-77-abc$/);
  assert.match(createMpvIpcPath({ platform: 'linux', pid: 77, unique: 'abc', tempDir: '/tmp' }), /^\/tmp\/baeframe-mpv-77-abc\.sock$/);
});

test('launch args enable JSON IPC without user config', () => {
  const args = createMpvLaunchArgs({
    ipcPath: '\\\\.\\pipe\\baeframe-mpv-1-test',
    forceWindow: true
  });

  assert.ok(args.includes('--idle=yes'));
  assert.ok(args.includes('--no-config'));
  assert.ok(args.includes('--force-window=yes'));
  assert.ok(args.includes('--hwdec=auto'));
  assert.ok(args.includes('--input-ipc-server=\\\\.\\pipe\\baeframe-mpv-1-test'));
});

test('launch args can attach mpv to an embedded window id', () => {
  const args = createMpvLaunchArgs({
    ipcPath: '\\\\.\\pipe\\baeframe-mpv-embedded',
    forceWindow: true,
    wid: '4608'
  });

  assert.ok(args.includes('--wid=4608'));
  assert.ok(args.includes('--border=no'));
  assert.ok(args.includes('--keepaspect-window=no'));
  assert.ok(args.includes('--cursor-autohide=always'));
});

test('start restarts mpv when the embedded window id changes', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const spawned = [];
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [bundledPath]
  });
  manager.spawn = (_cmd, args) => {
    const processRef = {
      killed: false,
      on() {},
      kill() {
        this.killed = true;
      }
    };
    spawned.push({ args, processRef });
    return processRef;
  };
  manager._waitForIpcReady = async () => true;
  manager.sendCommand = async () => ({ error: 'success' });

  await manager.start({ wid: '100' });
  await manager.start({ wid: '100' });
  await manager.start({ wid: '200' });

  assert.equal(spawned.length, 2);
  assert.ok(spawned[0].args.includes('--wid=100'));
  assert.ok(spawned[1].args.includes('--wid=200'));
  assert.equal(spawned[0].processRef.killed, true);
});

test('status polling keeps the active embedded window id', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const spawned = [];
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [bundledPath]
  });
  manager.spawn = (_cmd, args) => {
    const processRef = {
      killed: false,
      on() {},
      kill() {
        this.killed = true;
      }
    };
    spawned.push({ args, processRef });
    return processRef;
  };
  manager._waitForIpcReady = async () => true;
  manager.getOptionalProperty = async (name, fallback) => {
    const values = {
      'time-pos': 0,
      duration: 1,
      pause: true,
      path: 'C:\\video\\sample.mp4',
      width: 1920,
      height: 1080,
      'container-fps': 24
    };
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
  };

  await manager.start({ wid: '100' });
  const status = await manager.getStatus();

  assert.equal(status.success, true);
  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.includes('--wid=100'));
  assert.equal(spawned[0].processRef.killed, false);
});

test('loading a new file into the same embedded window replaces media without restarting mpv', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  const firstVideo = path.normalize('C:\\video\\first.mov');
  const secondVideo = path.normalize('C:\\video\\second.mp4');
  const spawned = [];
  const commands = [];
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [bundledPath, firstVideo, secondVideo]
  });

  manager.spawn = (_cmd, args) => {
    const processRef = {
      killed: false,
      on() {},
      kill() {
        this.killed = true;
      }
    };
    spawned.push({ args, processRef });
    return processRef;
  };
  manager._waitForIpcReady = async () => true;
  manager.sendCommand = async (command) => {
    commands.push(command);
    return { error: 'success' };
  };
  manager.waitForPlaybackReady = async (expectedPath) => ({
    success: true,
    time: 0,
    duration: 1,
    paused: true,
    path: expectedPath,
    width: 1920,
    height: 1080,
    fps: 24
  });
  manager.getStatus = async () => ({
    success: true,
    time: 0,
    duration: 1,
    paused: true,
    path: secondVideo,
    width: 1920,
    height: 1080,
    fps: 24
  });

  await manager.load(firstVideo, { pause: true, wid: '100' });
  await manager.load(secondVideo, { pause: true, wid: '100' });

  assert.equal(spawned.length, 1);
  assert.ok(spawned[0].args.includes('--wid=100'));
  assert.deepEqual(
    commands.filter((command) => command[0] === 'loadfile'),
    [
      ['loadfile', firstVideo, 'replace'],
      ['loadfile', secondVideo, 'replace']
    ]
  );
});

test('start hides the mpv console window while keeping IPC detached from stdio', async () => {
  const bundledPath = path.normalize('C:\\repo\\mpv\\win32\\mpv.exe');
  let spawnOptions = null;
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [bundledPath]
  });
  manager.spawn = (_cmd, _args, options) => {
    spawnOptions = options;
    return {
      killed: false,
      on() {},
      kill() {
        this.killed = true;
      }
    };
  };
  manager._waitForIpcReady = async () => true;

  await manager.start({ wid: '100' });

  assert.equal(spawnOptions.stdio, 'ignore');
  assert.equal(spawnOptions.windowsHide, true);
});

test('status uses fallbacks when optional mpv properties are unavailable', async () => {
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [path.normalize('C:\\repo\\mpv\\win32\\mpv.exe')]
  });

  manager.initialized = true;
  manager.mpvPath = 'C:\\repo\\mpv\\win32\\mpv.exe';
  manager.start = async () => true;
  manager.getProperty = async (name) => {
    const values = {
      'time-pos': 0.25,
      duration: 1,
      pause: true,
      path: 'C:\\video\\sample.mp4'
    };
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      return values[name];
    }
    throw new Error('mpv command failed: property unavailable');
  };

  const status = await manager.getStatus();

  assert.equal(status.success, true);
  assert.equal(status.time, 0.25);
  assert.equal(status.duration, 1);
  assert.equal(status.paused, true);
  assert.equal(status.width, 0);
  assert.equal(status.height, 0);
  assert.equal(status.fps, 24);
});

test('waits for playback properties before treating mpv load as ready', async () => {
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [path.normalize('C:\\repo\\mpv\\win32\\mpv.exe')]
  });
  let timeChecks = 0;

  manager.getOptionalProperty = async (name, fallback) => {
    if (name === 'path') return 'C:\\video\\sample.mp4';
    if (name === 'duration') return 1;
    if (name === 'pause') return true;
    if (name === 'time-pos') {
      timeChecks += 1;
      return timeChecks < 3 ? fallback : 0;
    }
    return fallback;
  };

  const status = await manager.waitForPlaybackReady('C:\\video\\sample.mp4', {
    timeoutMs: 1000,
    intervalMs: 1
  });

  assert.equal(status.success, true);
  assert.equal(status.duration, 1);
  assert.equal(status.time, 0);
  assert.equal(timeChecks, 3);
});

test('waits for the requested file path before treating mpv load as ready', async () => {
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [path.normalize('C:\\repo\\mpv\\win32\\mpv.exe')]
  });
  let pathChecks = 0;

  manager.getOptionalProperty = async (name, fallback) => {
    if (name === 'duration') return 1;
    if (name === 'pause') return true;
    if (name === 'time-pos') return 0;
    if (name === 'path') {
      pathChecks += 1;
      return pathChecks < 3
        ? 'C:\\video\\previous.mov'
        : 'C:\\video\\requested.mov';
    }
    return fallback;
  };

  const status = await manager.waitForPlaybackReady('C:\\video\\requested.mov', {
    timeoutMs: 1000,
    intervalMs: 1
  });

  assert.equal(status.success, true);
  assert.equal(status.path, 'C:\\video\\requested.mov');
  assert.equal(pathChecks, 3);
});

test('fails playback readiness when the requested file path never becomes active', async () => {
  const manager = createManager({
    env: { BAEFRAME_MPV_PILOT: '1' },
    existing: [path.normalize('C:\\repo\\mpv\\win32\\mpv.exe')]
  });

  manager.getOptionalProperty = async (name, fallback) => {
    if (name === 'duration') return 1;
    if (name === 'pause') return true;
    if (name === 'time-pos') return 0;
    if (name === 'path') return 'C:\\video\\previous.mov';
    return fallback;
  };

  await assert.rejects(
    () => manager.waitForPlaybackReady('C:\\video\\requested.mov', {
      timeoutMs: 10,
      intervalMs: 1
    }),
    /requested file/
  );
});
