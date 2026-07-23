function isEnabledEnvValue(value) {
  return String(value || '').trim() === '1';
}

function resolveFabricDrawingPilot({ argv = process.argv, env = process.env } = {}) {
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
  return Object.freeze({ enabled: false, source: 'default' });
}

function resolveFabricDrawingV3Shadow({
  argv = process.argv,
  env = process.env,
  fabricDrawingPilot
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
  return Object.freeze({ enabled: false, source: 'default' });
}

module.exports = { resolveFabricDrawingPilot, resolveFabricDrawingV3Shadow };
