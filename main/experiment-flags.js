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

module.exports = { resolveFabricDrawingPilot };
