'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  RUNTIME_PROFILE_MARKER_FILE,
  STABLE_RUNTIME_PROFILE_CHANNEL,
  STABLE_RUNTIME_PROFILE_MARKER,
  TRIAL_RUNTIME_PROFILE_CHANNEL,
  TRIAL_RUNTIME_PROFILE_MARKER
} = require('../main/runtime-profile');

function removeFileIfPresent(filePath, fsModule = fs) {
  try {
    fsModule.rmSync(filePath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function removeTemporaryMarkers(resourcesDir, fsModule = fs) {
  let names = [];
  try {
    names = fsModule.readdirSync(resourcesDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  const prefix = `${RUNTIME_PROFILE_MARKER_FILE}.tmp-`;
  for (const name of names) {
    if (name.startsWith(prefix)) {
      removeFileIfPresent(path.join(resourcesDir, name), fsModule);
    }
  }
}

function reconcileRuntimeProfileMarker({
  resourcesDir,
  env = process.env,
  fsModule = fs,
  pid = process.pid,
  now = Date.now,
  random = Math.random
} = {}) {
  if (typeof resourcesDir !== 'string' || !resourcesDir) {
    throw new TypeError('packaged resources directory is required');
  }

  const markerPath = path.join(resourcesDir, RUNTIME_PROFILE_MARKER_FILE);
  removeFileIfPresent(markerPath, fsModule);
  removeTemporaryMarkers(resourcesDir, fsModule);

  const requestedChannel = String(env?.BAEFRAME_RUNTIME_PROFILE || '').trim();
  let runtimeProfileMarker;
  if (!requestedChannel || requestedChannel === STABLE_RUNTIME_PROFILE_CHANNEL) {
    runtimeProfileMarker = STABLE_RUNTIME_PROFILE_MARKER;
  } else if (requestedChannel === TRIAL_RUNTIME_PROFILE_CHANNEL) {
    runtimeProfileMarker = TRIAL_RUNTIME_PROFILE_MARKER;
  } else {
    throw new RangeError(
      `Unsupported BAEFRAME runtime profile: ${requestedChannel}`
    );
  }

  fsModule.mkdirSync(resourcesDir, { recursive: true });
  const serialized = `${JSON.stringify(runtimeProfileMarker, null, 2)}\n`;
  const randomSuffix = Math.floor(Number(random()) * Number.MAX_SAFE_INTEGER)
    .toString(36)
    .replace(/[^a-z0-9]/gi, '');
  const tempPath = `${markerPath}.tmp-${pid}-${Number(now()).toString(36)}-${randomSuffix}`;

  try {
    fsModule.writeFileSync(tempPath, serialized, {
      encoding: 'utf8',
      flag: 'wx'
    });
    fsModule.renameSync(tempPath, markerPath);
  } catch (error) {
    removeFileIfPresent(tempPath, fsModule);
    throw error;
  }

  return {
    status: 'written',
    markerPath
  };
}

function resolvePackagedResourcesDir(context) {
  const getResourcesDir = context?.packager?.getResourcesDir;
  if (typeof getResourcesDir !== 'function') {
    throw new TypeError('electron-builder packager resources resolver is required');
  }
  return getResourcesDir.call(context.packager, context.appOutDir);
}

async function afterPack(context, { env = process.env } = {}) {
  const resourcesDir = resolvePackagedResourcesDir(context);
  return reconcileRuntimeProfileMarker({ resourcesDir, env });
}

module.exports = {
  afterPack,
  reconcileRuntimeProfileMarker,
  removeTemporaryMarkers,
  resolvePackagedResourcesDir
};
