'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createDrawingCommandHistory
} = require('../../renderer/scripts/modules/drawing-v3/drawing-command-history.js');

function command(id, undoValue, redoValue) {
  return {
    id,
    kind: 'add-objects',
    undoState: { value: undoValue },
    redoState: { value: redoValue }
  };
}

test('record undo and redo preserve command order', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  const applied = [];
  assert.equal(history.record({
    id: 'add-1', kind: 'add-objects',
    undoState: { value: 0 }, redoState: { value: 1 }
  }).recorded, true);
  assert.equal(history.undo(state => (applied.push(state.value), { applied: true })).applied, true);
  assert.equal(history.getDiagnostics().redoDepth, 1);
  assert.equal(history.redo(state => (applied.push(state.value), { applied: true })).applied, true);
  assert.deepEqual(applied, [0, 1]);
});

test('new record clears redo but keeps older undo entries', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  const applied = [];

  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  history.undo(() => ({ applied: true }));

  assert.equal(history.record(command('add-3', 1, 3)).recorded, true);
  const diagnostics = history.getDiagnostics();
  assert.equal(diagnostics.undoDepth, 2);
  assert.equal(diagnostics.redoDepth, 0);
  assert.equal(diagnostics.undoBytes, diagnostics.historyBytes);
  assert.equal(diagnostics.redoBytes, 0);
  history.undo(state => (applied.push(state.value), { applied: true }));
  history.undo(state => (applied.push(state.value), { applied: true }));
  assert.deepEqual(applied, [1, 0]);
  assert.equal(history.redo(() => ({ applied: true })).applied, true);
});

test('failed apply leaves the entry on its original stack', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  history.record(command('add-1', 0, 1));

  assert.deepEqual(history.undo(() => ({ applied: false, reason: 'scene-locked' })), {
    applied: false,
    reason: 'scene-locked'
  });
  assert.equal(history.getDiagnostics().undoDepth, 1);
  assert.equal(history.getDiagnostics().redoDepth, 0);

  history.undo(() => ({ applied: true }));
  assert.deepEqual(history.redo(() => ({ applied: false, reason: 'scene-locked' })), {
    applied: false,
    reason: 'scene-locked'
  });
  assert.equal(history.getDiagnostics().undoDepth, 0);
  assert.equal(history.getDiagnostics().redoDepth, 1);
});

test('throwing apply leaves the entry on its original stack', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });
  history.record(command('add-1', 0, 1));

  assert.deepEqual(history.undo(() => {
    throw new Error('apply exploded');
  }), {
    applied: false,
    reason: 'apply exploded'
  });
  assert.equal(history.getDiagnostics().undoDepth, 1);
  assert.equal(history.getDiagnostics().redoDepth, 0);
});

test('oldest undo entries are evicted at maxEntries', () => {
  const history = createDrawingCommandHistory({
    maxEntries: 2,
    maxBytes: 4096,
    estimateEntryBytes: () => 1
  });
  const applied = [];

  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  history.record(command('add-3', 2, 3));

  history.undo(state => (applied.push(state.value), { applied: true }));
  history.undo(state => (applied.push(state.value), { applied: true }));
  assert.deepEqual(applied, [2, 1]);
  assert.deepEqual(history.undo(() => ({ applied: true })), {
    applied: false,
    reason: 'history-empty'
  });
});

test('undo and redo bytes are both included in historyBytes', () => {
  const sizes = new Map([['add-1', 10], ['add-2', 20]]);
  const history = createDrawingCommandHistory({
    maxEntries: 3,
    maxBytes: 4096,
    estimateEntryBytes: entry => sizes.get(entry.id)
  });

  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  assert.deepEqual(history.getDiagnostics(), {
    undoDepth: 2,
    redoDepth: 0,
    undoBytes: 30,
    redoBytes: 0,
    historyBytes: 30,
    maxEntries: 3,
    maxBytes: 4096
  });

  history.undo(() => ({ applied: true }));
  assert.deepEqual(history.getDiagnostics(), {
    undoDepth: 1,
    redoDepth: 1,
    undoBytes: 10,
    redoBytes: 20,
    historyBytes: 30,
    maxEntries: 3,
    maxBytes: 4096
  });
});

test('one command larger than maxBytes is rejected without changing stacks', () => {
  const history = createDrawingCommandHistory({
    maxEntries: 3,
    maxBytes: 10,
    estimateEntryBytes: entry => entry.id === 'oversized' ? 11 : 4
  });

  history.record(command('add-1', 0, 1));
  history.undo(() => ({ applied: true }));
  const before = history.getDiagnostics();

  assert.deepEqual(history.record(command('oversized', 1, 2)), {
    recorded: false,
    reason: 'history-capacity-exceeded'
  });
  assert.deepEqual(history.getDiagnostics(), before);
});

test('invalid and duplicate command ids are rejected', () => {
  const history = createDrawingCommandHistory({ maxEntries: 3, maxBytes: 4096 });

  for (const id of [undefined, '', 42]) {
    assert.deepEqual(history.record(command(id, 0, 1)), {
      recorded: false,
      reason: 'invalid-command'
    });
  }

  assert.equal(history.record(command('add-1', 0, 1)).recorded, true);
  assert.deepEqual(history.record(command('add-1', 1, 2)), {
    recorded: false,
    reason: 'duplicate-command'
  });
  assert.equal(history.getDiagnostics().undoDepth, 1);
});

test('clear removes both stacks and bytes', () => {
  const history = createDrawingCommandHistory({
    maxEntries: 3,
    maxBytes: 4096,
    estimateEntryBytes: () => 10
  });
  history.record(command('add-1', 0, 1));
  history.record(command('add-2', 1, 2));
  history.undo(() => ({ applied: true }));

  history.clear();

  assert.deepEqual(history.getDiagnostics(), {
    undoDepth: 0,
    redoDepth: 0,
    undoBytes: 0,
    redoBytes: 0,
    historyBytes: 0,
    maxEntries: 3,
    maxBytes: 4096
  });
});

test('record는 용량 초과로 축출한 undo id를 보고한다', () => {
  const history = createDrawingCommandHistory({ maxEntries: 2, maxBytes: 65536 });
  assert.deepEqual(history.record(command('evict-1', 0, 1)).evictedUndoIds, []);
  assert.deepEqual(history.record(command('evict-2', 1, 2)).evictedUndoIds, []);
  // 세 번째부터 가장 오래된 항목이 밀린다 — 전역 순서 인덱스가 같은 id를 지울 수 있어야 한다.
  assert.deepEqual(history.record(command('evict-3', 2, 3)).evictedUndoIds, ['evict-1']);
  assert.equal(history.getDiagnostics().undoDepth, 2);
});

test('record는 성공·실패 양쪽에서 폐기한 redo id를 보고한다', () => {
  const history = createDrawingCommandHistory({ maxEntries: 2, maxBytes: 65536 });
  assert.equal(history.record(command('redo-src-1', 0, 1)).recorded, true);
  assert.equal(history.undo(() => ({ applied: true })).applied, true);
  assert.equal(history.getDiagnostics().redoDepth, 1);

  // 성공 경로 — 새 커맨드가 redo를 폐기하고 그 id를 돌려준다.
  const success = history.record(command('redo-killer', 1, 2));
  assert.equal(success.recorded, true);
  assert.deepEqual(success.clearedRedoIds, ['redo-src-1']);

  // 커맨드 하나가 통째로 용량을 넘는 경우는 clearStack 이전에 조기 반환한다.
  // 즉 아무것도 폐기하지 않았으므로 redo가 살아 있어야 하고, 전역 인덱스도 그대로여야 한다.
  const tiny = createDrawingCommandHistory({ maxEntries: 4, maxBytes: 400 });
  assert.equal(tiny.record(command('tiny-1', 0, 1)).recorded, true);
  assert.equal(tiny.undo(() => ({ applied: true })).applied, true);
  assert.equal(tiny.getDiagnostics().redoDepth, 1);
  const oversized = tiny.record(command('tiny-oversized', 'x'.repeat(4000), 2));
  assert.equal(oversized.recorded, false);
  assert.equal(oversized.reason, 'history-capacity-exceeded');
  assert.equal(tiny.getDiagnostics().redoDepth, 1, '조기 반환은 redo를 폐기하지 않는다');
});

test('clearRedo는 redo 스택만 비우고 버린 id를 돌려준다', () => {
  const history = createDrawingCommandHistory({ maxEntries: 4, maxBytes: 65536 });
  assert.equal(history.record(command('keep-1', 0, 1)).recorded, true);
  assert.equal(history.record(command('keep-2', 1, 2)).recorded, true);
  assert.equal(history.undo(() => ({ applied: true })).applied, true);
  assert.equal(history.getDiagnostics().undoDepth, 1);
  assert.equal(history.getDiagnostics().redoDepth, 1);

  assert.deepEqual(history.clearRedo(), ['keep-2']);
  assert.equal(history.getDiagnostics().undoDepth, 1, 'undo 스택은 건드리지 않는다');
  assert.equal(history.getDiagnostics().redoDepth, 0);
  assert.deepEqual(history.clearRedo(), [], '이미 비었으면 빈 배열이다');
});
