const path = require('node:path');

const reviewFileStorePath = path.resolve(
  __dirname,
  '../../../main/review-file-store.js'
);

const pendingPhaseReleases = new Map();
const earlyPhaseReleases = new Set();
let running = false;

function send(message, callback) {
  if (typeof process.send !== 'function') {
    callback?.();
    return;
  }
  process.send(message, callback);
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    code: error?.code || null,
    stack: error?.stack || null
  };
}

function waitForPhaseRelease(phase) {
  if (earlyPhaseReleases.delete(phase)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    pendingPhaseReleases.set(phase, resolve);
  });
}

function releasePhase(phase) {
  const resolve = pendingPhaseReleases.get(phase);
  if (resolve) {
    pendingPhaseReleases.delete(phase);
    resolve();
    return;
  }
  earlyPhaseReleases.add(phase);
}

function shouldHoldPhase(config, phase) {
  return Array.isArray(config.holdPhases) &&
    config.holdPhases.includes(phase);
}

function createPhaseHook(config, phase) {
  return async (details = {}) => {
    send({
      type: 'phase',
      phase,
      attempt: Number.isInteger(details?.attempt) ? details.attempt : null
    });

    if (shouldHoldPhase(config, phase)) {
      await waitForPhaseRelease(phase);
    }
  };
}

function createRenameAttemptHook(config) {
  let invocation = 0;
  return async (details = {}) => {
    invocation += 1;
    send({
      type: 'phase',
      phase: 'onRenameAttempt',
      attempt: Number.isInteger(details?.attempt)
        ? details.attempt
        : invocation
    });

    const errorCode = Array.isArray(config.renameFailureCodes)
      ? config.renameFailureCodes[invocation - 1]
      : null;
    if (errorCode) {
      const error = new Error(`injected rename failure: ${errorCode}`);
      error.code = errorCode;
      throw error;
    }

    if (shouldHoldPhase(config, 'onRenameAttempt')) {
      await waitForPhaseRelease('onRenameAttempt');
    }
  };
}

async function runOperation(config) {
  const { createReviewFileStore } = require(reviewFileStorePath);
  const hooks = {
    afterLockAcquired: createPhaseHook(config, 'afterLockAcquired'),
    afterTempSynced: createPhaseHook(config, 'afterTempSynced'),
    beforeCommitRecheck: createPhaseHook(config, 'beforeCommitRecheck'),
    afterReplace: createPhaseHook(config, 'afterReplace'),
    onRenameAttempt: createRenameAttemptHook(config)
  };
  const store = createReviewFileStore({
    ...(config.storeOptions || {}),
    hooks
  });

  send({ type: 'phase', phase: 'saveStarted', attempt: null });
  if (config.operation === 'read') {
    return store.readReviewSnapshot(config.filePath);
  }
  return store.saveReviewFile(
    config.filePath,
    config.data,
    config.saveOptions || {}
  );
}

async function handleRun(config) {
  if (running) {
    throw new Error('review file save worker accepts only one run command');
  }
  running = true;

  try {
    const result = await runOperation(config);
    send({ type: 'result', result }, () => process.exit(0));
  } catch (error) {
    send({ type: 'error', error: serializeError(error) }, () => process.exit(1));
  }
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'release') {
    releasePhase(message.phase);
    return;
  }
  if (message.type === 'run') {
    handleRun(message.config || {}).catch((error) => {
      send({ type: 'error', error: serializeError(error) }, () => process.exit(1));
    });
  }
});

send({ type: 'ready' });
