'use strict';

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function defaultEstimateEntryBytes(entry) {
  return Math.max(1, JSON.stringify(entry).length * 2);
}

function createDrawingCommandHistory(options = {}) {
  const maxEntries = positiveInteger(options.maxEntries, 32);
  const maxBytes = positiveInteger(options.maxBytes, 16 * 1024 * 1024);
  const estimateEntryBytes = options.estimateEntryBytes || defaultEstimateEntryBytes;
  const undoStack = [];
  const redoStack = [];
  const knownIds = new Set();
  let historyBytes = 0;

  function removeAt(stack, index) {
    const [entry] = stack.splice(index, 1);
    if (!entry) return;
    historyBytes = Math.max(0, historyBytes - entry.estimatedBytes);
    knownIds.delete(entry.id);
  }

  function clearStack(stack) {
    while (stack.length > 0) removeAt(stack, stack.length - 1);
  }

  function record(command) {
    if (!command || typeof command.id !== 'string' || !command.id ||
        typeof command.kind !== 'string' || !command.kind ||
        command.undoState === undefined || command.redoState === undefined) {
      return { recorded: false, reason: 'invalid-command' };
    }
    if (knownIds.has(command.id)) return { recorded: false, reason: 'duplicate-command' };
    const stored = clonePlain(command);
    const estimatedBytes = Math.max(1, Math.trunc(Number(estimateEntryBytes(stored)) || 1));
    if (estimatedBytes > maxBytes) return { recorded: false, reason: 'history-capacity-exceeded' };

    clearStack(redoStack);
    while (undoStack.length >= maxEntries || historyBytes + estimatedBytes > maxBytes) {
      if (undoStack.length === 0) return { recorded: false, reason: 'history-capacity-exceeded' };
      removeAt(undoStack, 0);
    }
    undoStack.push({ ...stored, estimatedBytes });
    knownIds.add(stored.id);
    historyBytes += estimatedBytes;
    return { recorded: true, undoDepth: undoStack.length, redoDepth: 0 };
  }

  function moveTop(from, to, stateKey, applyState, direction) {
    const entry = from.at(-1);
    if (!entry) return { applied: false, reason: 'history-empty' };
    try {
      const result = applyState(clonePlain(entry[stateKey]), direction, clonePlain(entry));
      if (result?.applied !== true) {
        return { applied: false, reason: result?.reason || 'history-apply-failed' };
      }
    } catch (error) {
      return { applied: false, reason: error?.message || 'history-apply-failed' };
    }
    from.pop();
    to.push(entry);
    return {
      applied: true,
      commandId: entry.id,
      kind: entry.kind,
      undoDepth: undoStack.length,
      redoDepth: redoStack.length
    };
  }

  function undo(applyState) {
    return moveTop(undoStack, redoStack, 'undoState', applyState, 'undo');
  }

  function redo(applyState) {
    return moveTop(redoStack, undoStack, 'redoState', applyState, 'redo');
  }

  function clear() {
    clearStack(undoStack);
    clearStack(redoStack);
  }

  function getDiagnostics() {
    const undoBytes = undoStack.reduce((total, entry) => total + entry.estimatedBytes, 0);
    const redoBytes = redoStack.reduce((total, entry) => total + entry.estimatedBytes, 0);
    return {
      undoDepth: undoStack.length,
      redoDepth: redoStack.length,
      undoBytes,
      redoBytes,
      historyBytes,
      maxEntries,
      maxBytes
    };
  }

  return { record, undo, redo, clear, getDiagnostics };
}

module.exports = { createDrawingCommandHistory };
