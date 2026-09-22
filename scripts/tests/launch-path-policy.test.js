const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { STABLE_RUNTIME_PROFILE_MARKER, TRIAL_RUNTIME_PROFILE_MARKER } = require('../../main/runtime-profile');

const modulePath = path.resolve(__dirname, '../../main/launch-path-policy.js');
const liveDir = 'G:\\team\\테스트버전 빌드';
const executable = 'BFRAME_alpha_v2.exe';
const liveExe = path.win32.join(liveDir, executable);
const backupExe = path.win32.join(`${liveDir}.__backup_pre-2.12.6-beta_20260922-180000`, executable);

function policy() {
  assert.ok(fs.existsSync(modulePath), 'startup needs a launch policy before registering shell handlers');
  return require(modulePath);
}

function fakeFiles({ version = '2.12.6-beta', name = 'baeframe', profile = STABLE_RUNTIME_PROFILE_MARKER, missing = [] } = {}) {
  const files = new Map([
    [liveExe, Buffer.from('exe')],
    [path.win32.join(liveDir, 'resources', 'app.asar'), Buffer.from('asar')],
    [path.win32.join(liveDir, 'resources', 'app.asar', 'package.json'), Buffer.from(JSON.stringify({ name, version, main: 'main/index.js' }))],
    [path.win32.join(liveDir, 'resources', 'baeframe-runtime-profile.json'), Buffer.from(JSON.stringify(profile))],
    [path.win32.join(liveDir, 'resources', 'mpv', 'win32', 'mpv.exe'), Buffer.from('mpv')]
  ]);
  for (const relative of missing) files.delete(path.win32.join(liveDir, relative));
  return {
    statSync(filePath) {
      const value = files.get(filePath);
      if (!value) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isFile: () => true, size: value.length };
    },
    readFileSync(filePath, encoding) {
      const value = files.get(filePath);
      if (!value) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return encoding ? value.toString(encoding) : value;
    }
  };
}

function resolve(options = {}) {
  return policy().resolveLaunchPathPolicy({
    execPath: backupExe,
    isPackaged: true,
    platform: 'win32',
    currentVersion: '2.12.5-beta',
    argv: [backupExe, 'G:\\cuts\\컷 & one.bframe', 'baeframe://open?file=G%3A%5Cx.mp4'],
    fsModule: fakeFiles(),
    ...options
  });
}

test('backup launch redirects only to its verified live sibling and keeps each argument intact', () => {
  const result = resolve();
  assert.equal(result.action, 'redirect');
  assert.equal(result.execPath, liveExe);
  assert.deepEqual(result.args, ['G:\\cuts\\컷 & one.bframe', 'baeframe://open?file=G%3A%5Cx.mp4']);
});

test('canonical launch continues and ordinary backup words never trigger a redirect', () => {
  for (const execPath of [liveExe, 'C:\\my backup\\BFRAME_alpha_v2.exe', 'C:\\backup-project\\BFRAME_alpha_v2.exe', 'G:\\team\\테스트버전 빌드.__backup_notes\\BFRAME_alpha_v2.exe']) {
    assert.equal(resolve({ execPath }).action, 'continue');
  }
  assert.equal(resolve({ isPackaged: false }).action, 'continue');
});

test('recognized backup retired staging and versioned deployment copies use the live sibling', () => {
  for (const suffix of ['.__backup_20260825-230143', '.__backup_2.0.2-beta_20260805-143147Z', '.__retired_pre-2.12.2-beta_20260914-080751', '.__staging_2.12.1-beta_20260914-073810', '.backup-2.2.0-before-2.2.1-20260825-140208', '.backup-20260909-003925', ' 2.10.0-beta']) {
    assert.equal(resolve({ execPath: path.win32.join(liveDir + suffix, executable) }).execPath, liveExe, suffix);
  }
});

test('missing mismatched malformed and older destinations block without exposing launch arguments', () => {
  for (const fixture of [
    { missing: [executable] },
    { missing: ['resources/app.asar'] },
    { missing: ['resources/mpv/win32/mpv.exe'] },
    { missing: ['resources/baeframe-runtime-profile.json'] },
    { name: 'unrelated-app' },
    { version: 'invalid' },
    { version: '2.12.6-beta..1' },
    { version: '2.12.6-01' },
    { version: '2.12.4-beta' },
    { profile: TRIAL_RUNTIME_PROFILE_MARKER },
    { profile: { ...STABLE_RUNTIME_PROFILE_MARKER, extra: true } }
  ]) {
    const result = resolve({ fsModule: fakeFiles(fixture) });
    assert.equal(result.action, 'block', JSON.stringify(fixture));
    assert.equal(result.args, undefined);
    assert.equal(result.execPath, undefined);
  }
});

test('release version ordering rejects prerelease downgrades and accepts a newer release', () => {
  for (const [currentVersion, candidate, action] of [
    ['2.12.6', '2.12.6-beta', 'block'],
    ['2.12.6-beta.10', '2.12.6-beta.2', 'block'],
    ['2.12.6-beta.2', '2.12.6-beta.10', 'redirect'],
    ['2.12.6-beta', '2.12.6', 'redirect'],
    ['2.12.6-beta', '2.13.0-beta', 'redirect']
  ]) assert.equal(resolve({ currentVersion, fsModule: fakeFiles({ version: candidate }) }).action, action);
});

test('project association entry point rejects verification paths before invoking a registry runner', async () => {
  const { registerProjectFileAssociations } = require('../../main/project-file-associations');
  for (const appPath of [backupExe, 'C:\\repo\\dist\\win-unpacked\\BFRAME_alpha_v2.exe']) {
    const result = await registerProjectFileAssociations({
      appPath, platform: 'win32', isDefaultApp: false, isPackaged: true, argv: [], env: {},
      runner: () => assert.fail('verification runs must not mutate the registry')
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'non-release-launch');
  }
});

test('redirect execution schedules one relaunch with an argument array then exits before startup', () => {
  const calls = [];
  const app = {
    relaunch: value => calls.push(['relaunch', value]),
    exit: code => calls.push(['exit', code])
  };
  assert.equal(policy().applyLaunchPathPolicy(resolve(), { app, reportBlocked: () => assert.fail('not blocked') }), false);
  assert.deepEqual(calls, [['relaunch', { execPath: liveExe, args: ['G:\\cuts\\컷 & one.bframe', 'baeframe://open?file=G%3A%5Cx.mp4'] }], ['exit', 0]]);
});

test('failed relaunch blocks cleanly and never continues startup or retries', () => {
  const reports = [];
  const exits = [];
  const result = policy().applyLaunchPathPolicy(resolve(), {
    app: { relaunch: () => { throw new Error('cannot launch'); }, exit: code => exits.push(code) },
    reportBlocked: message => reports.push(message)
  });
  assert.equal(result, false);
  assert.deepEqual(exits, [1]);
  assert.equal(reports.length, 1);
});

test('development validation trial and backup runs cannot replace shell associations', () => {
  const base = { appPath: liveExe, isPackaged: true, isDefaultApp: false, argv: [], env: {} };
  assert.equal(policy().shouldSkipShellRegistration(base), false);
  for (const extra of [
    { isPackaged: false }, { isDefaultApp: true }, { env: { NODE_ENV: 'development' } },
    { argv: ['--skip-shell-registration'] }, { runtimeProfile: { skipShellRegistration: true } },
    { appPath: backupExe }, { appPath: 'C:\\repo\\dist\\win-unpacked\\BFRAME_alpha_v2.exe' },
    { appPath: 'C:\\repo\\.worktrees\\test\\release\\BFRAME_alpha_v2.exe' }
  ]) assert.equal(policy().shouldSkipShellRegistration({ ...base, ...extra }), true, JSON.stringify(extra));
});

test('main applies launch policy before settings writes and registers protocol after the instance lock', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../main/index.js'), 'utf8');
  const guardAt = source.indexOf('applyLaunchPathPolicy(');
  assert.ok(guardAt > 0);
  assert.ok(guardAt < source.indexOf('fs.mkdirSync('));
  assert.ok(source.indexOf('app.requestSingleInstanceLock(') < source.indexOf('app.setAsDefaultProtocolClient('));
  assert.doesNotMatch(source, /setAsDefaultProtocolClient\('baeframe', process\.execPath/);
});
