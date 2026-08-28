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

  // 전역 실행취소 순서 인덱스가 같은 항목을 지울 수 있도록 버린 id를 돌려준다.
  function clearStack(stack) {
    const removedIds = [];
    while (stack.length > 0) {
      removedIds.push(stack[stack.length - 1].id);
      removeAt(stack, stack.length - 1);
    }
    return removedIds;
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

    // redo 폐기는 기록 성공 여부와 무관하게 이미 일어난다. 따라서 실패 반환에도
    // clearedRedoIds를 실어야 전역 인덱스가 없는 항목을 가리킨 채 남지 않는다.
    const clearedRedoIds = clearStack(redoStack);
    const evictedUndoIds = [];
    while (undoStack.length >= maxEntries || historyBytes + estimatedBytes > maxBytes) {
      if (undoStack.length === 0) {
        return {
          recorded: false,
          reason: 'history-capacity-exceeded',
          evictedUndoIds,
          clearedRedoIds
        };
      }
      evictedUndoIds.push(undoStack[0].id);
      removeAt(undoStack, 0);
    }
    undoStack.push({ ...stored, estimatedBytes });
    knownIds.add(stored.id);
    historyBytes += estimatedBytes;
    return {
      recorded: true,
      undoDepth: undoStack.length,
      redoDepth: 0,
      evictedUndoIds,
      clearedRedoIds
    };
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

  // 다른 씬에서 새 편집이 일어나면 이 씬의 redo도 전역적으로 무효가 된다.
  // undo 스택은 건드리지 않고 redo만 비우고, 버린 id를 돌려준다.
  function clearRedo() {
    return clearStack(redoStack);
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

  return { record, undo, redo, clear, clearRedo, getDiagnostics };
}

module.exports = { createDrawingCommandHistory };
