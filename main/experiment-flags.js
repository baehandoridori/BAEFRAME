function isEnabledEnvValue(value) {
  return String(value || '').trim() === '1';
}

function isTruthyEnvValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]);
}

function isActiveTrialRuntimeProfile(runtimeProfile) {
  return hasExactKeys(runtimeProfile, [
    'active',
    'source',
    'schemaVersion',
    'channel',
    'features',
    'isolateUserData',
    'skipShellRegistration'
  ]) &&
    runtimeProfile.active === true &&
    runtimeProfile.source === 'marker' &&
    runtimeProfile.schemaVersion === 1 &&
    runtimeProfile.channel === 'fabric-v3-trial' &&
    runtimeProfile.isolateUserData === true &&
    runtimeProfile.skipShellRegistration === true &&
    hasExactKeys(runtimeProfile.features, [
      'mpvPlaybackPilot',
      'fabricDrawingPilot',
      'fabricDrawingV3Shadow',
      'fabricDrawingPersistence'
    ]) &&
    Object.values(runtimeProfile.features).every(value => value === true);
}

function resolveMpvPlaybackPilot({
  argv = process.argv,
  env = process.env,
  runtimeProfile = null
} = {}) {
  const disabled = argv.includes('--disable-mpv') ||
    argv.includes('--disable-mpv-pilot') ||
    isTruthyEnvValue(env.BAEFRAME_DISABLE_MPV);

  if (disabled) {
    return Object.freeze({ enabled: false, source: 'kill-switch' });
  }
  if (argv.includes('--mpv-pilot')) {
    return Object.freeze({ enabled: true, source: 'cli' });
  }
  if (isTruthyEnvValue(env.BAEFRAME_MPV_PILOT)) {
    return Object.freeze({ enabled: true, source: 'env' });
  }
  if (isActiveTrialRuntimeProfile(runtimeProfile) &&
      runtimeProfile.features.mpvPlaybackPilot === true) {
    return Object.freeze({ enabled: true, source: 'marker' });
  }
  return Object.freeze({ enabled: false, source: 'default' });
}

function resolveFabricDrawingPilot({
  argv = process.argv,
  env = process.env,
  runtimeProfile = null
} = {}) {
  const disabled = argv.includes('--disable-fabric-drawing-pilot') ||
    isEnabledEnvValue(env.BAEFRAME_DISABLE_FABRIC_DRAWING_PILOT);

  if (disabled) {
    return Object.freeze({ enabled: false, source: 'kill-switch' });
  }
  if (argv.includes('--fabric-drawing-pilot')) {
    return Object.freeze({ enabled: true, source: 'cli' });
  }
  if (isEnabledEnvValue(env.BAEFRAME_FABRIC_DRAWING_PILOT)) {
    return Object.freeze({ enabled: true, source: 'env' });
  }
  if (isActiveTrialRuntimeProfile(runtimeProfile) &&
      runtimeProfile.features.fabricDrawingPilot === true) {
    return Object.freeze({ enabled: true, source: 'marker' });
  }
  return Object.freeze({ enabled: false, source: 'default' });
}

function resolveFabricDrawingV3Shadow({
  argv = process.argv,
  env = process.env,
  fabricDrawingPilot,
  runtimeProfile = null
} = {}) {
  const disabled = argv.includes('--disable-fabric-drawing-v3-shadow') ||
    isEnabledEnvValue(env.BAEFRAME_DISABLE_FABRIC_DRAWING_V3_SHADOW);

  if (disabled) {
    return Object.freeze({ enabled: false, source: 'kill-switch' });
  }
  if (!fabricDrawingPilot || fabricDrawingPilot.enabled !== true) {
    return Object.freeze({ enabled: false, source: 'fabric-pilot-disabled' });
  }
  if (argv.includes('--fabric-drawing-v3-shadow')) {
    return Object.freeze({ enabled: true, source: 'cli' });
  }
  if (isEnabledEnvValue(env.BAEFRAME_FABRIC_DRAWING_V3_SHADOW)) {
    return Object.freeze({ enabled: true, source: 'env' });
  }
  if (isActiveTrialRuntimeProfile(runtimeProfile) &&
      runtimeProfile.features.fabricDrawingV3Shadow === true) {
    return Object.freeze({ enabled: true, source: 'marker' });
  }
  return Object.freeze({ enabled: false, source: 'default' });
}

module.exports = {
  resolveFabricDrawingPilot,
  resolveFabricDrawingV3Shadow,
  resolveMpvPlaybackPilot
};
