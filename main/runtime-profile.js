'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_RUNTIME_PROFILE_BYTES = 4096;
const RUNTIME_PROFILE_MARKER_FILE = 'baeframe-runtime-profile.json';
const STABLE_RUNTIME_PROFILE_CHANNEL = 'fabric-v3-stable';
const TRIAL_RUNTIME_PROFILE_CHANNEL = 'fabric-v3-trial';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

const TRIAL_RUNTIME_PROFILE_MARKER = deepFreeze({
  schemaVersion: 1,
  channel: TRIAL_RUNTIME_PROFILE_CHANNEL,
  features: {
    mpvPlaybackPilot: true,
    fabricDrawingPilot: true,
    fabricDrawingV3Shadow: true,
    fabricDrawingPersistence: true
  },
  isolateUserData: true,
  skipShellRegistration: true
});

const STABLE_RUNTIME_PROFILE_MARKER = deepFreeze({
  schemaVersion: 1,
  channel: STABLE_RUNTIME_PROFILE_CHANNEL,
  features: {
    mpvPlaybackPilot: true,
    fabricDrawingPilot: true,
    fabricDrawingV3Shadow: true,
    fabricDrawingPersistence: true
  },
  isolateUserData: false,
  skipShellRegistration: false
});

const DEFAULT_RUNTIME_PROFILE = deepFreeze({
  active: false,
  source: 'default',
  schemaVersion: null,
  channel: null,
  features: {
    mpvPlaybackPilot: false,
    fabricDrawingPilot: false,
    fabricDrawingV3Shadow: false,
    fabricDrawingPersistence: false
  },
  isolateUserData: false,
  skipShellRegistration: false
});

const TRIAL_RUNTIME_PROFILE = deepFreeze({
  active: true,
  source: 'marker',
  ...TRIAL_RUNTIME_PROFILE_MARKER
});

const STABLE_RUNTIME_PROFILE = deepFreeze({
  active: true,
  source: 'marker',
  ...STABLE_RUNTIME_PROFILE_MARKER
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const normalizedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === normalizedExpectedKeys.length &&
    actualKeys.every((key, index) => key === normalizedExpectedKeys[index]);
}

function isExactMarkerForChannel(value, {
  channel,
  isolateUserData,
  skipShellRegistration
}) {
  if (!hasExactKeys(value, [
    'schemaVersion',
    'channel',
    'features',
    'isolateUserData',
    'skipShellRegistration'
  ])) {
    return false;
  }
  if (value.schemaVersion !== 1 ||
      value.channel !== channel ||
      value.isolateUserData !== isolateUserData ||
      value.skipShellRegistration !== skipShellRegistration) {
    return false;
  }
  if (!hasExactKeys(value.features, [
    'mpvPlaybackPilot',
    'fabricDrawingPilot',
    'fabricDrawingV3Shadow',
    'fabricDrawingPersistence'
  ])) {
    return false;
  }
  return Object.values(value.features).every(feature => feature === true);
}

function isExactTrialMarker(value) {
  return isExactMarkerForChannel(value, {
    channel: TRIAL_RUNTIME_PROFILE_CHANNEL,
    isolateUserData: true,
    skipShellRegistration: true
  });
}

function isExactStableMarker(value) {
  return isExactMarkerForChannel(value, {
    channel: STABLE_RUNTIME_PROFILE_CHANNEL,
    isolateUserData: false,
    skipShellRegistration: false
  });
}

function loadRuntimeProfile({
  isPackaged = false,
  resourcesPath = '',
  fsModule = fs
} = {}) {
  if (isPackaged !== true || typeof resourcesPath !== 'string' || !resourcesPath) {
    return DEFAULT_RUNTIME_PROFILE;
  }

  const markerPath = path.join(resourcesPath, RUNTIME_PROFILE_MARKER_FILE);
  try {
    const stats = fsModule.statSync(markerPath);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_RUNTIME_PROFILE_BYTES) {
      return DEFAULT_RUNTIME_PROFILE;
    }

    const raw = fsModule.readFileSync(markerPath);
    if (!Buffer.isBuffer(raw) ||
        raw.length <= 0 ||
        raw.length > MAX_RUNTIME_PROFILE_BYTES) {
      return DEFAULT_RUNTIME_PROFILE;
    }

    const parsed = JSON.parse(raw.toString('utf8'));
    if (isExactTrialMarker(parsed)) {
      return TRIAL_RUNTIME_PROFILE;
    }
    if (isExactStableMarker(parsed)) {
      return STABLE_RUNTIME_PROFILE;
    }
    return DEFAULT_RUNTIME_PROFILE;
  } catch (_error) {
    return DEFAULT_RUNTIME_PROFILE;
  }
}

module.exports = {
  DEFAULT_RUNTIME_PROFILE,
  MAX_RUNTIME_PROFILE_BYTES,
  RUNTIME_PROFILE_MARKER_FILE,
  STABLE_RUNTIME_PROFILE,
  STABLE_RUNTIME_PROFILE_CHANNEL,
  STABLE_RUNTIME_PROFILE_MARKER,
  TRIAL_RUNTIME_PROFILE,
  TRIAL_RUNTIME_PROFILE_CHANNEL,
  TRIAL_RUNTIME_PROFILE_MARKER,
  isExactStableMarker,
  isExactTrialMarker,
  loadRuntimeProfile
};
