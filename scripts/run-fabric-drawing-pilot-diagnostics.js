'use strict';

const fs = require('node:fs');

const COUNTER_FIELDS = [
  'toggleCount',
  'saveReview',
  'reviewDataManagerSave',
  'mpvLoad',
  'mpvPlay',
  'mpvPause',
  'mpvDestroyEmbed',
  'mpvDestroyOverlay',
  'timelineMutation',
  'duplicateAction'
];
const PLAYBACK_COUNTER_FIELDS = [
  'mpvLoad',
  'mpvPlay',
  'mpvPause',
  'mpvDestroyEmbed',
  'mpvDestroyOverlay'
];
const HOST_LIFECYCLE_FIELDS = [
  'construct',
  'loadURL',
  'setBounds',
  'show',
  'hide',
  'moveTop',
  'destroy'
];
const TIMELINE_FIELDS = ['duration', 'currentFrame', 'playlistContinuousOffset'];

function emptyReport() {
  return {
    hostCreateCount: null,
    hostGeneration: null,
    videoGeneration: null,
    inputRevision: null,
    sessionId: null,
    toggleCount: null,
    playbackCommandDelta: null,
    saveAttemptDelta: null,
    timelineMutationDelta: null,
    duplicateActionCount: null,
    violations: []
  };
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIdentity(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function addMalformed(violations, field) {
  violations.push(`missing or malformed field: ${field}`);
}

function validateFileSnapshot(snapshot, prefix, violations) {
  if (!isObject(snapshot)) {
    addMalformed(violations, prefix);
    return;
  }
  if (typeof snapshot.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(snapshot.sha256)) {
    addMalformed(violations, `${prefix}.sha256`);
  }
  if (!isNonNegativeInteger(snapshot.size)) {
    addMalformed(violations, `${prefix}.size`);
  }
  if (!isFiniteNumber(snapshot.mtimeMs) || snapshot.mtimeMs < 0) {
    addMalformed(violations, `${prefix}.mtimeMs`);
  }
}

function validateControllerSnapshot(snapshot, prefix, violations) {
  if (!isObject(snapshot)) {
    addMalformed(violations, prefix);
    return;
  }
  if (!isPositiveInteger(snapshot.videoGeneration)) {
    addMalformed(violations, `${prefix}.videoGeneration`);
  }
  if (!isNonNegativeInteger(snapshot.inputRevision)) {
    addMalformed(violations, `${prefix}.inputRevision`);
  }
  if (snapshot.sessionId !== null && !isIdentity(snapshot.sessionId)) {
    addMalformed(violations, `${prefix}.sessionId`);
  }
}

function validateCounters(snapshot, prefix, violations) {
  if (!isObject(snapshot)) {
    addMalformed(violations, prefix);
    return;
  }
  for (const field of COUNTER_FIELDS) {
    if (!isNonNegativeInteger(snapshot[field])) {
      addMalformed(violations, `${prefix}.${field}`);
    }
  }
}

function validateHostSnapshot(snapshot, prefix, violations) {
  if (!isObject(snapshot)) {
    addMalformed(violations, prefix);
    return;
  }
  for (const field of HOST_LIFECYCLE_FIELDS) {
    if (!isNonNegativeInteger(snapshot[field])) {
      addMalformed(violations, `${prefix}.${field}`);
    }
  }
  if (!isPositiveInteger(snapshot.generation)) {
    addMalformed(violations, `${prefix}.generation`);
  }
  if (!isIdentity(snapshot.windowIdentity)) {
    addMalformed(violations, `${prefix}.windowIdentity`);
  }
  if (snapshot.construct !== 1 ||
      snapshot.loadURL !== 1 ||
      snapshot.destroy !== 0 ||
      snapshot.generation !== 1) {
    violations.push(`${prefix} must describe exactly one fresh live overlay host`);
  }
}

function validateTimelineSnapshot(snapshot, prefix, violations) {
  if (!isObject(snapshot)) {
    addMalformed(violations, prefix);
    return;
  }
  for (const field of TIMELINE_FIELDS) {
    if (!isFiniteNumber(snapshot[field]) || snapshot[field] < 0) {
      addMalformed(violations, `${prefix}.${field}`);
    }
  }
}

function validateEvidenceSnapshot(snapshot, prefix, violations) {
  if (!isObject(snapshot)) {
    addMalformed(violations, prefix);
    return;
  }
  validateFileSnapshot(snapshot.file, `${prefix}.file`, violations);
  validateControllerSnapshot(snapshot.controller, `${prefix}.controller`, violations);
  validateCounters(snapshot.counters, `${prefix}.counters`, violations);
  validateHostSnapshot(snapshot.host, `${prefix}.host`, violations);
  validateTimelineSnapshot(snapshot.timeline, `${prefix}.timeline`, violations);
  if (!isIdentity(snapshot.playbackOwner)) {
    addMalformed(violations, `${prefix}.playbackOwner`);
  }
  if (!isIdentity(snapshot.mediaInstanceIdentity)) {
    addMalformed(violations, `${prefix}.mediaInstanceIdentity`);
  }
}

function validateStaleProbe(probe, violations) {
  if (!isObject(probe)) {
    addMalformed(violations, 'staleProbe');
    return;
  }
  for (const field of ['olderGeneration', 'newerGeneration', 'activeGeneration']) {
    if (!isPositiveInteger(probe[field])) {
      addMalformed(violations, `staleProbe.${field}`);
    }
  }
  if (typeof probe.lateAccepted !== 'boolean') {
    addMalformed(violations, 'staleProbe.lateAccepted');
  }
  for (const field of ['activeSessionId', 'expectedSessionId']) {
    if (!isIdentity(probe[field])) {
      addMalformed(violations, `staleProbe.${field}`);
    }
  }
}

function counterDelta(before, after, field) {
  return after.counters[field] - before.counters[field];
}

function validateDiagnostics(raw) {
  const report = emptyReport();
  const { violations } = report;
  if (!isObject(raw)) {
    addMalformed(violations, 'root');
    return report;
  }

  validateEvidenceSnapshot(raw.before, 'before', violations);
  validateEvidenceSnapshot(raw.after, 'after', violations);
  validateStaleProbe(raw.staleProbe, violations);
  if (violations.length > 0) return report;

  const { before, after, staleProbe } = raw;
  const playbackCommandDelta = PLAYBACK_COUNTER_FIELDS.reduce(
    (total, field) => total + counterDelta(before, after, field),
    0
  );
  const saveAttemptDelta =
    counterDelta(before, after, 'saveReview') +
    counterDelta(before, after, 'reviewDataManagerSave');
  const timelineMutationDelta = counterDelta(before, after, 'timelineMutation');
  const toggleCount = counterDelta(before, after, 'toggleCount');
  const duplicateActionCount = counterDelta(before, after, 'duplicateAction');

  report.hostCreateCount = after.host.construct;
  report.hostGeneration = after.host.generation;
  report.videoGeneration = after.controller.videoGeneration;
  report.inputRevision = after.controller.inputRevision;
  report.sessionId = after.controller.sessionId;
  report.toggleCount = toggleCount;
  report.playbackCommandDelta = playbackCommandDelta;
  report.saveAttemptDelta = saveAttemptDelta;
  report.timelineMutationDelta = timelineMutationDelta;
  report.duplicateActionCount = duplicateActionCount;

  for (const field of COUNTER_FIELDS) {
    if (counterDelta(before, after, field) < 0) {
      violations.push(`counter regressed: ${field}`);
    }
  }
  if (toggleCount !== 100) {
    violations.push(`toggle count must be exactly 100; received ${toggleCount}`);
  }
  if (after.controller.inputRevision - before.controller.inputRevision !== 100) {
    violations.push('input revision must advance exactly once per toggle');
  }
  if (after.controller.videoGeneration !== before.controller.videoGeneration) {
    violations.push('video generation changed during the 100-toggle probe');
  }
  if (after.controller.sessionId !== null) {
    violations.push('session must be null after the even toggle sequence');
  }
  if (playbackCommandDelta !== 0) {
    violations.push(`playback command delta must be 0; received ${playbackCommandDelta}`);
  }
  if (saveAttemptDelta !== 0) {
    violations.push(`save attempt delta must be 0; received ${saveAttemptDelta}`);
  }
  if (timelineMutationDelta !== 0) {
    violations.push(`timeline mutation delta must be 0; received ${timelineMutationDelta}`);
  }
  if (duplicateActionCount !== 0) {
    violations.push(`duplicate action count must be 0; received ${duplicateActionCount}`);
  }

  if (before.file.sha256 !== after.file.sha256) {
    violations.push('file SHA-256 changed (primary no-save invariant)');
  }
  if (before.file.size !== after.file.size) {
    violations.push('file size changed (primary no-save invariant)');
  }
  if (before.file.mtimeMs !== after.file.mtimeMs) {
    violations.push('file mtime changed (additional no-save invariant)');
  }

  for (const field of HOST_LIFECYCLE_FIELDS) {
    const delta = after.host[field] - before.host[field];
    if (delta !== 0) {
      violations.push(`host lifecycle changed: ${field} delta ${delta}`);
    }
  }
  if (after.host.construct < 1) {
    violations.push('host was not constructed before the lifecycle baseline');
  }
  if (before.host.generation !== after.host.generation) {
    violations.push('host generation changed during input toggles');
  }
  if (before.host.windowIdentity !== after.host.windowIdentity) {
    violations.push('host window identity changed during input toggles');
  }

  if (before.playbackOwner !== after.playbackOwner) {
    violations.push('playback owner changed');
  }
  if (before.mediaInstanceIdentity !== after.mediaInstanceIdentity) {
    violations.push('media instance identity changed');
  }
  for (const field of TIMELINE_FIELDS) {
    if (before.timeline[field] !== after.timeline[field]) {
      violations.push(`timeline canary changed: ${field}`);
    }
  }

  const staleOrderingValid =
    staleProbe.newerGeneration === staleProbe.olderGeneration + 1 &&
    staleProbe.lateAccepted === false &&
    staleProbe.activeGeneration === staleProbe.newerGeneration &&
    staleProbe.activeSessionId === staleProbe.expectedSessionId;
  if (!staleOrderingValid) {
    violations.push('stale generation response reactivated or replaced the newer session');
  }

  return report;
}

async function readAll(stream) {
  let input = '';
  for await (const chunk of stream) input += chunk;
  return input;
}

async function runCli(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const stdin = options.stdin || process.stdin;
  const stdout = options.stdout || process.stdout;
  let report;

  try {
    const input =
      argv[0] && argv[0] !== '-'
        ? await fs.promises.readFile(argv[0], 'utf8')
        : await readAll(stdin);
    if (!input.trim()) throw new SyntaxError('empty input');
    report = validateDiagnostics(JSON.parse(input));
  } catch (error) {
    report = emptyReport();
    report.violations.push(`malformed diagnostics JSON input: ${error.message}`);
  }

  stdout.write(`${JSON.stringify(report)}\n`);
  return report.violations.length === 0 ? 0 : 1;
}

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  runCli,
  validateDiagnostics
};
