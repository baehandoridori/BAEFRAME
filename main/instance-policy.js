const path = require('path');
const os = require('os');
const { isLaunchArgument } = require('./launch-routing');

function isTruthy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getSwitchValue(argv = [], switchName) {
  const prefix = `${switchName}=`;
  const exactIndex = argv.findIndex(arg => arg === switchName);
  if (exactIndex >= 0 && exactIndex + 1 < argv.length) {
    const next = argv[exactIndex + 1];
    if (next && !String(next).startsWith('--')) return String(next);
  }

  const matched = argv.find(arg => String(arg).startsWith(prefix));
  return matched ? String(matched).slice(prefix.length) : null;
}

function hasSwitch(argv = [], switchName) {
  return argv.some(arg => arg === switchName || String(arg).startsWith(`${switchName}=`));
}

function hasFileLaunchArgument(argv = []) {
  return argv.some(arg => isLaunchArgument(arg));
}

function sanitizeProfileName(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9가-힣_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'default';
}

function shouldAllowMultipleInstances({ isDev = false, argv = process.argv, env = process.env } = {}) {
  return Boolean(
    isDev ||
    hasFileLaunchArgument(argv) ||
    hasSwitch(argv, '--multi-instance') ||
    hasSwitch(argv, '--multi-instance-isolated') ||
    hasSwitch(argv, '--multi-instance-profile') ||
    hasSwitch(argv, '--multi-instance-user-data') ||
    isTruthy(env.BAEFRAME_MULTI_INSTANCE) ||
    Boolean(env.BAEFRAME_MULTI_INSTANCE_USER_DATA) ||
    Boolean(env.BAEFRAME_MULTI_INSTANCE_PROFILE) ||
    isTruthy(env.BAEFRAME_MULTI_INSTANCE_ISOLATED)
  );
}

function resolveMultiInstanceUserDataPath({
  allowMultipleInstances = false,
  isDev = false,
  argv = process.argv,
  env = process.env,
  appDataDir = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  pid = process.pid
} = {}) {
  if (!allowMultipleInstances || isDev) return null;

  const explicitDir = getSwitchValue(argv, '--multi-instance-user-data') ||
    env.BAEFRAME_MULTI_INSTANCE_USER_DATA;
  if (explicitDir) return path.resolve(String(explicitDir));

  const profileName = getSwitchValue(argv, '--multi-instance-profile') ||
    env.BAEFRAME_MULTI_INSTANCE_PROFILE;
  const shouldIsolate = Boolean(
    profileName ||
    hasSwitch(argv, '--multi-instance-isolated') ||
    isTruthy(env.BAEFRAME_MULTI_INSTANCE_ISOLATED)
  );
  if (!shouldIsolate) return null;

  const safeProfileName = sanitizeProfileName(profileName || `pid-${pid}`);
  return path.join(appDataDir, 'baeframe', 'multi-instance', safeProfileName);
}

module.exports = {
  getSwitchValue,
  hasFileLaunchArgument,
  hasSwitch,
  isTruthy,
  resolveMultiInstanceUserDataPath,
  sanitizeProfileName,
  shouldAllowMultipleInstances
};
