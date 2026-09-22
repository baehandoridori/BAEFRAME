'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadRuntimeProfile } = require('./runtime-profile');

const LIVE_DIRECTORY_NAME = '테스트버전 빌드';
const EXECUTABLE_NAME = 'BFRAME_alpha_v2.exe';
const DEPLOYMENT_COPY_SUFFIX = /^(?:\.__(?:backup|retired|staging)_[a-z0-9._-]*\d{8}[-_]\d{6}z?|\.backup-[a-z0-9._-]*\d{8}[-_]\d{6}z?| \d+\.\d+\.\d+-beta)$/i;

function canonicalExecutableForCopy(execPath) {
  if (typeof execPath !== 'string' || !path.win32.isAbsolute(execPath)) return null;
  if (path.win32.basename(execPath).toLowerCase() !== EXECUTABLE_NAME.toLowerCase()) return null;
  const directory = path.win32.dirname(execPath);
  const name = path.win32.basename(directory);
  if (!name.startsWith(LIVE_DIRECTORY_NAME) ||
      !DEPLOYMENT_COPY_SUFFIX.test(name.slice(LIVE_DIRECTORY_NAME.length))) return null;
  return path.win32.join(path.win32.dirname(directory), LIVE_DIRECTORY_NAME, EXECUTABLE_NAME);
}

function parseVersion(value) {
  const match = typeof value === 'string' && value.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  if (!core.every(Number.isSafeInteger)) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(part => !part || (/^\d+$/.test(part) && !/^(0|[1-9]\d*)$/.test(part)))) return null;
  return { core, prerelease };
}

function isVersionAtLeast(candidate, current) {
  const next = parseVersion(candidate);
  const previous = parseVersion(current);
  if (!next || !previous) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next.core[index] !== previous.core[index]) return next.core[index] > previous.core[index];
  }
  if (!next.prerelease.length) return true;
  if (!previous.prerelease.length) return false;
  for (let index = 0; index < Math.max(next.prerelease.length, previous.prerelease.length); index += 1) {
    const a = next.prerelease[index];
    const b = previous.prerelease[index];
    if (a === b) continue;
    if (a === undefined) return false;
    if (b === undefined) return true;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric !== bNumeric) return !aNumeric;
    return aNumeric ? BigInt(a) > BigInt(b) : a > b;
  }
  return true;
}

function verifyCanonicalExecutable(execPath, currentVersion, fsModule) {
  const resourcesPath = path.win32.join(path.win32.dirname(execPath), 'resources');
  try {
    for (const filePath of [execPath, path.win32.join(resourcesPath, 'app.asar'), path.win32.join(resourcesPath, 'mpv', 'win32', 'mpv.exe')]) {
      const stat = fsModule.statSync(filePath);
      if (!stat.isFile() || stat.size <= 0) return false;
    }
    // Electron's fs reads packaged JSON inside app.asar without executing its code.
    const packagePath = path.win32.join(resourcesPath, 'app.asar', 'package.json');
    const packageData = JSON.parse(fsModule.readFileSync(packagePath, 'utf8'));
    if (packageData.name !== 'baeframe' || packageData.main !== 'main/index.js' ||
        !isVersionAtLeast(packageData.version, currentVersion)) return false;
    const profile = loadRuntimeProfile({ isPackaged: true, resourcesPath, fsModule });
    return profile.active === true && profile.source === 'marker' && profile.channel === 'fabric-v3-stable';
  } catch {
    return false;
  }
}

function resolveLaunchPathPolicy({
  execPath = process.execPath,
  argv = process.argv,
  isPackaged = false,
  platform = process.platform,
  currentVersion = '',
  fsModule = fs
} = {}) {
  if (!isPackaged || platform !== 'win32') return { action: 'continue' };
  const canonical = canonicalExecutableForCopy(execPath);
  if (!canonical) return { action: 'continue' };
  if (!verifyCanonicalExecutable(canonical, currentVersion, fsModule)) {
    return { action: 'block', reason: 'canonical-unavailable' };
  }
  return { action: 'redirect', execPath: canonical, args: argv.slice(1) };
}

function applyLaunchPathPolicy(policy, { app, reportBlocked } = {}) {
  if (policy.action === 'continue') return true;
  if (policy.action === 'redirect') {
    try {
      app.relaunch({ execPath: policy.execPath, args: policy.args });
      app.exit(0);
      return false;
    } catch { /* Keep the backup closed if relaunch cannot be scheduled. */ }
  }
  try {
    reportBlocked?.('이 폴더는 배포 백업 또는 검증용 복사본입니다. 정상 배포 폴더의 최신 앱을 확인할 수 없어 실행을 중단했습니다. "테스트버전 빌드" 폴더에서 앱을 실행해 주세요.');
  } finally {
    app.exit(1);
  }
  return false;
}

function shouldSkipShellRegistration({
  appPath = process.execPath,
  isPackaged = true,
  isDefaultApp = process.defaultApp,
  runtimeProfile = null,
  argv = process.argv,
  env = process.env
} = {}) {
  if (!isPackaged || isDefaultApp || env.NODE_ENV === 'development' ||
      runtimeProfile?.skipShellRegistration === true ||
      argv.includes('--skip-shell-registration')) return true;
  if (canonicalExecutableForCopy(appPath)) return true;
  const segments = String(appPath).split(/[\\/]/).map(segment => segment.toLowerCase());
  return segments.includes('.worktrees') ||
    segments.includes('win-unpacked') ||
    segments.some((segment, index) => segment === '.codex' && segments[index + 1] === 'worktrees');
}

module.exports = {
  applyLaunchPathPolicy,
  canonicalExecutableForCopy,
  resolveLaunchPathPolicy,
  shouldSkipShellRegistration
};
