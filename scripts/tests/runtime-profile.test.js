'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_RUNTIME_PROFILE,
  MAX_RUNTIME_PROFILE_BYTES,
  RUNTIME_PROFILE_MARKER_FILE,
  STABLE_RUNTIME_PROFILE_MARKER,
  TRIAL_RUNTIME_PROFILE_MARKER,
  loadRuntimeProfile
} = require('../../main/runtime-profile');
const {
  afterPack,
  reconcileRuntimeProfileMarker
} = require('../../scripts/electron-builder-after-pack');

function createResourcesSandbox(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baeframe-runtime-profile-'));
  const resourcesDir = path.join(rootDir, 'resources');
  fs.mkdirSync(resourcesDir, { recursive: true });
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return { rootDir, resourcesDir };
}

function markerPath(resourcesDir) {
  return path.join(resourcesDir, RUNTIME_PROFILE_MARKER_FILE);
}

function writeMarker(resourcesDir, value) {
  const serialized = typeof value === 'string'
    ? value
    : `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(markerPath(resourcesDir), serialized, 'utf8');
}

function assertDefaultOff(profile) {
  assert.deepEqual(profile, DEFAULT_RUNTIME_PROFILE);
  assert.equal(profile.active, false);
  assert.equal(profile.features.mpvPlaybackPilot, false);
  assert.equal(profile.features.fabricDrawingPilot, false);
  assert.equal(profile.features.fabricDrawingV3Shadow, false);
  assert.equal(profile.features.fabricDrawingPersistence, false);
  assert.equal(profile.isolateUserData, false);
  assert.equal(profile.skipShellRegistration, false);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.features), true);
}

const EXPECTED_STABLE_RUNTIME_PROFILE_MARKER = Object.freeze({
  schemaVersion: 1,
  channel: 'fabric-v3-stable',
  features: Object.freeze({
    mpvPlaybackPilot: true,
    fabricDrawingPilot: true,
    fabricDrawingV3Shadow: true,
    fabricDrawingPersistence: true
  }),
  isolateUserData: false,
  skipShellRegistration: false
});

test('runtime profile stays off when unpackaged, missing, malformed, or oversized', (t) => {
  const { resourcesDir } = createResourcesSandbox(t);

  writeMarker(resourcesDir, TRIAL_RUNTIME_PROFILE_MARKER);
  assertDefaultOff(loadRuntimeProfile({ isPackaged: false, resourcesPath: resourcesDir }));

  fs.rmSync(markerPath(resourcesDir), { force: true });
  assertDefaultOff(loadRuntimeProfile({ isPackaged: true, resourcesPath: resourcesDir }));

  writeMarker(resourcesDir, '{"schemaVersion":');
  assertDefaultOff(loadRuntimeProfile({ isPackaged: true, resourcesPath: resourcesDir }));

  writeMarker(resourcesDir, 'x'.repeat(MAX_RUNTIME_PROFILE_BYTES + 1));
  assertDefaultOff(loadRuntimeProfile({ isPackaged: true, resourcesPath: resourcesDir }));
});

test('runtime profile rejects unknown or inexact marker contracts atomically', (t) => {
  const { resourcesDir } = createResourcesSandbox(t);
  const invalidMarkers = [
    { ...TRIAL_RUNTIME_PROFILE_MARKER, schemaVersion: 2 },
    { ...TRIAL_RUNTIME_PROFILE_MARKER, channel: 'future-trial' },
    { ...TRIAL_RUNTIME_PROFILE_MARKER, extra: true },
    {
      ...TRIAL_RUNTIME_PROFILE_MARKER,
      features: {
        ...TRIAL_RUNTIME_PROFILE_MARKER.features,
        fabricDrawingPersistence: false
      }
    },
    {
      ...TRIAL_RUNTIME_PROFILE_MARKER,
      features: {
        ...TRIAL_RUNTIME_PROFILE_MARKER.features,
        unknownFeature: true
      }
    },
    { ...TRIAL_RUNTIME_PROFILE_MARKER, isolateUserData: false },
    { ...TRIAL_RUNTIME_PROFILE_MARKER, skipShellRegistration: false },
    { ...EXPECTED_STABLE_RUNTIME_PROFILE_MARKER, isolateUserData: true },
    { ...EXPECTED_STABLE_RUNTIME_PROFILE_MARKER, skipShellRegistration: true },
    {
      ...EXPECTED_STABLE_RUNTIME_PROFILE_MARKER,
      channel: 'fabric-v3-trial'
    }
  ];

  for (const invalidMarker of invalidMarkers) {
    writeMarker(resourcesDir, invalidMarker);
    assertDefaultOff(loadRuntimeProfile({ isPackaged: true, resourcesPath: resourcesDir }));
  }
});

test('valid packaged trial marker enables the complete deeply frozen profile', (t) => {
  const { resourcesDir } = createResourcesSandbox(t);
  writeMarker(resourcesDir, TRIAL_RUNTIME_PROFILE_MARKER);

  const profile = loadRuntimeProfile({
    isPackaged: true,
    resourcesPath: resourcesDir
  });

  assert.equal(profile.active, true);
  assert.equal(profile.source, 'marker');
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.channel, 'fabric-v3-trial');
  assert.deepEqual(profile.features, TRIAL_RUNTIME_PROFILE_MARKER.features);
  assert.equal(profile.isolateUserData, true);
  assert.equal(profile.skipShellRegistration, true);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.features), true);

  const markerBytes = Buffer.byteLength(
    `${JSON.stringify(TRIAL_RUNTIME_PROFILE_MARKER, null, 2)}\n`,
    'utf8'
  );
  assert.ok(markerBytes > 0 && markerBytes <= MAX_RUNTIME_PROFILE_BYTES);
  assert.equal(Object.isFrozen(TRIAL_RUNTIME_PROFILE_MARKER), true);
  assert.equal(Object.isFrozen(TRIAL_RUNTIME_PROFILE_MARKER.features), true);
});

test('valid packaged stable marker enables the complete non-isolated profile', (t) => {
  const { resourcesDir } = createResourcesSandbox(t);
  writeMarker(resourcesDir, EXPECTED_STABLE_RUNTIME_PROFILE_MARKER);

  const profile = loadRuntimeProfile({
    isPackaged: true,
    resourcesPath: resourcesDir
  });

  assert.deepEqual(STABLE_RUNTIME_PROFILE_MARKER, EXPECTED_STABLE_RUNTIME_PROFILE_MARKER);
  assert.equal(profile.active, true);
  assert.equal(profile.source, 'marker');
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.channel, 'fabric-v3-stable');
  assert.deepEqual(profile.features, EXPECTED_STABLE_RUNTIME_PROFILE_MARKER.features);
  assert.equal(profile.isolateUserData, false);
  assert.equal(profile.skipShellRegistration, false);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.features), true);
  assert.equal(Object.isFrozen(STABLE_RUNTIME_PROFILE_MARKER), true);
  assert.equal(Object.isFrozen(STABLE_RUNTIME_PROFILE_MARKER.features), true);
});

test('afterPack writes stable markers for normal builds and trial markers for trial builds', async (t) => {
  const { rootDir, resourcesDir } = createResourcesSandbox(t);
  const context = {
    appOutDir: rootDir,
    packager: {
      getResourcesDir: () => resourcesDir
    }
  };

  writeMarker(resourcesDir, { stale: true });
  const normalResult = await afterPack(context, { env: {} });
  assert.equal(normalResult.status, 'written');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(markerPath(resourcesDir), 'utf8')),
    EXPECTED_STABLE_RUNTIME_PROFILE_MARKER
  );

  const trialResult = await afterPack(context, {
    env: { BAEFRAME_RUNTIME_PROFILE: 'fabric-v3-trial' }
  });
  assert.equal(trialResult.status, 'written');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(markerPath(resourcesDir), 'utf8')),
    TRIAL_RUNTIME_PROFILE_MARKER
  );
  assert.deepEqual(
    fs.readdirSync(resourcesDir).filter(name => name.includes('.tmp-')),
    []
  );

  const cleanupResult = reconcileRuntimeProfileMarker({
    resourcesDir,
    env: {}
  });
  assert.equal(cleanupResult.status, 'written');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(markerPath(resourcesDir), 'utf8')),
    EXPECTED_STABLE_RUNTIME_PROFILE_MARKER
  );

  await assert.rejects(
    afterPack(context, {
      env: { BAEFRAME_RUNTIME_PROFILE: 'future-profile' }
    }),
    /unsupported BAEFRAME runtime profile/i
  );
  assert.equal(fs.existsSync(markerPath(resourcesDir)), false);
});

test('release build scripts pin stable while trial build scripts pin trial regardless of parent env', () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const builderConfig = fs.readFileSync(path.join(rootDir, 'electron-builder.yml'), 'utf8');

  assert.equal(
    packageJson.scripts.build,
    'cross-env BAEFRAME_RUNTIME_PROFILE=fabric-v3-stable electron-builder --dir'
  );
  assert.equal(
    packageJson.scripts['build:installer'],
    'cross-env BAEFRAME_RUNTIME_PROFILE=fabric-v3-stable electron-builder'
  );
  assert.equal(
    packageJson.scripts['prebuild:trial'],
    'npm run bundle:mpv-fabric-overlay && npm run build:review-file-cas-helper'
  );
  assert.equal(
    packageJson.scripts['build:trial'],
    'cross-env BAEFRAME_RUNTIME_PROFILE=fabric-v3-trial electron-builder --dir --config.directories.output=dist-trial'
  );
  assert.match(
    builderConfig,
    /^afterPack:\s*\.\/scripts\/electron-builder-after-pack\.js$/m
  );
  assert.match(packageJson.scripts['test:mpv'], /runtime-profile\.test\.js/);
});

test('stable engine promotion uses the 2.0.0 beta release version consistently', () => {
  const rootDir = path.resolve(__dirname, '..', '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));

  assert.equal(packageJson.version, '2.0.0-beta');
  assert.equal(packageLock.version, '2.0.0-beta');
  assert.equal(packageLock.packages[''].version, '2.0.0-beta');
});
