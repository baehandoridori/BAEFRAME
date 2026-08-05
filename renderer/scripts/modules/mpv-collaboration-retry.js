function sameFence(value, owner, epoch) {
  return Boolean(value && value.owner === owner && value.epoch === epoch);
}

function validFence(owner, epoch) {
  return Boolean(owner && Number.isSafeInteger(epoch) && epoch >= 0);
}

function validRevision(revision) {
  return Number.isSafeInteger(revision) && revision >= 0;
}

export function createMpvCollaborationRetryController(options = {}) {
  const baseDelayMs = Number.isFinite(options.baseDelayMs) && options.baseDelayMs > 0
    ? options.baseDelayMs
    : 250;
  const maxDelayMs = Number.isFinite(options.maxDelayMs) && options.maxDelayMs >= baseDelayMs
    ? options.maxDelayMs
    : 4000;
  const isCurrentFence = typeof options.isCurrentFence === 'function'
    ? options.isCurrentFence
    : () => true;
  const shouldRun = typeof options.shouldRun === 'function'
    ? options.shouldRun
    : () => true;
  const run = typeof options.run === 'function' ? options.run : () => false;
  const setTimer = typeof options.setTimer === 'function' ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === 'function' ? options.clearTimer : clearTimeout;
  const onSchedule = typeof options.onSchedule === 'function' ? options.onSchedule : () => {};

  let pending = null;
  let lastSuccess = null;

  function clearPending() {
    if (!pending) return false;
    if (pending.timer !== null) {
      clearTimer(pending.timer);
    }
    pending = null;
    return true;
  }

  function cancel(owner, epoch) {
    let changed = false;
    if (sameFence(pending, owner, epoch)) {
      changed = clearPending() || changed;
    }
    if (sameFence(lastSuccess, owner, epoch)) {
      lastSuccess = null;
      changed = true;
    }
    return changed;
  }

  function cancelOwner(owner) {
    if (!owner) return false;
    let changed = false;
    if (pending?.owner === owner) {
      changed = clearPending() || changed;
    }
    if (lastSuccess?.owner === owner) {
      lastSuccess = null;
      changed = true;
    }
    return changed;
  }

  function schedulePending(error) {
    if (!pending || pending.timer !== null) return Boolean(pending);
    const scheduledOwner = pending.owner;
    const scheduledEpoch = pending.epoch;
    const delayMs = Math.min(
      baseDelayMs * (2 ** Math.min(pending.attempt, 30)),
      maxDelayMs
    );
    pending.attempt += 1;
    try {
      onSchedule({
        owner: scheduledOwner,
        epoch: scheduledEpoch,
        failedRevision: pending.failedRevision,
        attempt: pending.attempt,
        delayMs,
        error
      });
    } catch (_error) {
      // Diagnostics must never alter retry behavior.
    }

    pending.timer = setTimer(() => {
      if (!sameFence(pending, scheduledOwner, scheduledEpoch)) return;
      pending.timer = null;
      if (!shouldRun() || !isCurrentFence(scheduledOwner, scheduledEpoch)) {
        cancel(scheduledOwner, scheduledEpoch);
        return;
      }

      let started = false;
      try {
        started = run(scheduledOwner, scheduledEpoch) !== false;
      } catch (runError) {
        defer(scheduledOwner, scheduledEpoch, runError);
        return;
      }
      if (!started) {
        defer(scheduledOwner, scheduledEpoch, 'retry did not start');
      }
    }, delayMs);
    return true;
  }

  function recordFailure(owner, epoch, failedRevision, error) {
    if (!validFence(owner, epoch) || !validRevision(failedRevision) ||
        !shouldRun() || !isCurrentFence(owner, epoch)) {
      return false;
    }
    if (sameFence(lastSuccess, owner, epoch) &&
        failedRevision <= lastSuccess.revision) {
      return false;
    }
    if (pending && !sameFence(pending, owner, epoch)) {
      clearPending();
    }
    if (!pending) {
      pending = {
        owner,
        epoch,
        failedRevision,
        attempt: 0,
        timer: null
      };
    } else {
      pending.failedRevision = Math.max(pending.failedRevision, failedRevision);
    }
    return schedulePending(error);
  }

  function recordSuccess(owner, epoch, successfulRevision) {
    if (!validFence(owner, epoch) || !validRevision(successfulRevision) ||
        !isCurrentFence(owner, epoch)) {
      return false;
    }
    if (!sameFence(lastSuccess, owner, epoch)) {
      lastSuccess = { owner, epoch, revision: successfulRevision };
    } else {
      lastSuccess.revision = Math.max(lastSuccess.revision, successfulRevision);
    }
    if (!sameFence(pending, owner, epoch)) return true;
    if (successfulRevision < pending.failedRevision) return false;
    clearPending();
    return true;
  }

  function defer(owner, epoch, error) {
    if (!sameFence(pending, owner, epoch)) return false;
    if (!shouldRun() || !isCurrentFence(owner, epoch)) {
      cancel(owner, epoch);
      return false;
    }
    return schedulePending(error);
  }

  function isPending(owner, epoch) {
    return sameFence(pending, owner, epoch);
  }

  function getState() {
    return {
      pending: pending
        ? {
          owner: pending.owner,
          epoch: pending.epoch,
          failedRevision: pending.failedRevision,
          attempt: pending.attempt,
          hasTimer: pending.timer !== null
        }
        : null,
      lastSuccess: lastSuccess ? { ...lastSuccess } : null
    };
  }

  function dispose() {
    const hadPending = clearPending();
    const hadLastSuccess = Boolean(lastSuccess);
    lastSuccess = null;
    return hadPending || hadLastSuccess;
  }

  return Object.freeze({
    recordFailure,
    recordSuccess,
    defer,
    isPending,
    cancel,
    cancelOwner,
    dispose,
    getState
  });
}
