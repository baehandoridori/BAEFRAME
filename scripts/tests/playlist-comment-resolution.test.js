const { test } = require('node:test');
const assert = require('node:assert/strict');
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('same marker joins one write, same file serializes, different files progress independently', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p.toLowerCase() });
  const held = deferred();
  const ran = [];
  const intent = { key: 'm1', videoPath: 'A' };
  const first = queue.enqueue(intent, async () => { ran.push('a1'); await held.promise; return true; });
  assert.equal(queue.enqueue(intent, () => { throw new Error('duplicate'); }), first);
  const second = queue.enqueue({ key: 'm2', videoPath: 'a' }, () => ran.push('a2'));
  await queue.enqueue({ key: 'm3', videoPath: 'B' }, () => ran.push('b'));
  assert.deepEqual(ran, ['a1', 'b']);
  assert.equal(queue.hasPending('m1'), true);
  held.resolve(); await Promise.all([first, second]);
  assert.deepEqual(ran, ['a1', 'b', 'a2']);
});

test('path locks are synchronous and owned, failed writes block navigation until explicit retry succeeds', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
  const release1 = queue.lockPaths(['a']); const release2 = queue.lockPaths(['a']);
  release1(); release1();
  await assert.rejects(queue.enqueue({ key: 'm', videoPath: 'a' }, () => true), /저장 후 이동 중/);
  release2();
  await assert.rejects(queue.enqueue({ key: 'm', videoPath: 'a' }, async () => { throw new Error('disk'); }), /disk/);
  await assert.rejects(queue.drainPaths(['a']), /disk/);
  await queue.enqueue({ key: 'other', videoPath: 'a' }, () => true);
  await assert.rejects(queue.drainPaths(['a']), /disk/);
  await queue.enqueue({ key: 'm', videoPath: 'a' }, () => true);
  await queue.drainPaths(['a']);
});

test('drain waits for accepted writes and false is a failure', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
  const held = deferred();
  const pending = queue.enqueue({ key: 'm', videoPath: 'a' }, () => held.promise);
  const release = queue.lockPaths(['a']);
  let drained = false;
  const draining = queue.drainPaths(['a']).then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  held.resolve(true); await pending; await draining; release();
  await assert.rejects(queue.enqueue({ key: 'm', videoPath: 'a' }, () => false), /저장/);
  await assert.rejects(queue.drainPaths(['a']), /저장/);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appSource = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
function appFunction(name) {
  const start = appSource.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, name);
  return appSource.slice(start, appSource.indexOf('\n  }', start) + 4);
}

test('late resolution completion does not rerender, select or scroll another screen', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const { getPlaylistAggregateCommentKey } = await import('../../renderer/scripts/modules/playlist-comment-index.js');
  const held = deferred();
  const range = { itemId: 'a', markerId: 'm', layerId: 'l', resolved: false };
  const manager = { currentPlaylist: { id: 'p' }, getItems: () => [{ id: 'a', videoPath: 'a.mp4' }] };
  const effects = [];
  const context = vm.createContext({ playlistAggregateCommentRanges: [range], getPlaylistAggregateCommentKey,
    getPlaylistManager: () => manager, playlistUIState: { mode: 'continuous' }, playlistCommentModeGeneration: 1,
    playlistResolutionQueue: createPlaylistResolutionQueue({ keyForPath: p => p }), playlistResolutionStates: new Map(),
    normalizeComparableFilePath: p => p, renderPlaylistResolutionState: () => effects.push('row'),
    togglePlaylistAggregateResolvedWithoutNavigation: () => held.promise,
    refreshPlaylistCommentsForItem: () => effects.push('partial'),
    refreshCommentRangesForCurrentMode: () => effects.push('whole'), updatePlaylistUI: () => effects.push('whole'),
    refreshVisiblePlaylistProgress: () => effects.push('progress'), playlistCommentCache: { invalidate() {} },
    renderPlaylistContinuousCommentList: () => effects.push('render'), highlightPlaylistAggregateComment: () => effects.push('focus'),
    showToast() {}, commentFilterState: { status: 'all' }
  });
  vm.runInContext(appFunction('togglePlaylistAggregateResolved'), context);
  const saving = context.togglePlaylistAggregateResolved('a:l:m');
  await Promise.resolve(); await Promise.resolve();
  const prior = effects.length;
  context.playlistUIState.mode = 'normal'; context.playlistCommentModeGeneration++;
  held.resolve({ resolved: true });
  await saving;
  assert.deepEqual(effects.slice(prior), []);
});

test('CAS conflict retries the desired state once while preserving the latest unrelated data', async () => {
  const records = [];
  let reads = 0;
  const range = { itemId: 'a', markerId: 'm', layerId: 'l', resolved: false };
  const manager = { getItems: () => [{ id: 'a', videoPath: 'a.mp4' }], ensureItemBframePath: async () => 'a.bframe' };
  const context = vm.createContext({ getPlaylistManager: () => manager,
    reviewDataManager: { getBframePath: () => 'b.bframe' }, isSameFilePath: (a,b) => a === b,
    userName: 'tester', BFRAME_VERSION: '2.0', getDataVersion: () => '2.0', getUnsupportedBframeMajor: () => null,
    hasExplicitBframeVersion: () => true, ensureReviewDocumentId() {}, isValidReviewDocumentId: () => true,
    liveblocksManager: { checkEditLock: () => ({ locked: false }) },
    window: { electronAPI: {
      loadReviewSnapshot: async () => ({ versionToken: String(++reads), data: { reviewDocumentId: 'valid', untouched: reads,
        drawingsV3: { sentinel: reads }, comments: { layers: [{ id: 'l', markers: [{ id: 'm', resolved: reads === 2 }, { id: 'other', text: 'new' + reads }] }] } } }),
      saveReview: async (path, data) => { records.push(structuredClone(data)); return records.length === 1 ? { success: false, conflict: true } : { success: true }; }
    } }
  });
  for (const name of ['findMarkerRecordInBframeData', 'snapshotMarkerResolution', 'applyMarkerResolutionToggle', 'restoreMarkerResolution', 'togglePlaylistAggregateResolvedWithoutNavigation']) vm.runInContext(appFunction(name), context);
  const result = await context.togglePlaylistAggregateResolvedWithoutNavigation(range, { desiredResolved: true, videoPath: 'a.mp4' });
  assert.equal(result.resolved, true);
  assert.equal(records.length, 2);
  assert.equal(records[1].comments.layers[0].markers[1].text, 'new2');
  assert.deepEqual(records[1].drawingsV3, { sentinel: 2 });
});


test('reply edits on the same marker retain distinct save intents', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const held = deferred(); const edits = []; let saves = 0;
  const context = vm.createContext({
    playlistResolutionQueue: createPlaylistResolutionQueue({ keyForPath: p => p }),
    normalizeComparableFilePath: p => p,
    reviewDataManager: { captureSaveCheckpoint: () => ({ videoPath: 'A' }), _ownsSave: () => true,
      saveThroughCheckpoint: async () => { if (++saves === 1) await held.promise; return true; } },
    commentManager: { getMarker: () => ({ replies: [{ id: 'reply1' }, { id: 'reply2' }] }) }, liveblocksManager: { checkEditLock: () => null }, showToast() {}
  });
  vm.runInContext(appFunction('saveCurrentCommentEdit'), context);
  const first = context.saveCurrentCommentEdit('marker', () => { edits.push('reply1'); return true; }, 'reply1');
  const second = context.saveCurrentCommentEdit('marker', () => { edits.push('reply2'); return true; }, 'reply2');
  await Promise.resolve(); held.resolve(); await Promise.all([first, second]);
  assert.deepEqual(edits, ['reply1', 'reply2']);
  assert.equal(saves, 2);
});


test('rejected permissions before mutation do not trap navigation; actual failed writes still do', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
  await assert.rejects(queue.enqueue({ key: 'locked', videoPath: 'A' }, () => {
    throw Object.assign(new Error('locked'), { blocksNavigation: false });
  }), /locked/);
  await queue.drainPaths(['A']);
  await assert.rejects(queue.enqueue({ key: 'write', videoPath: 'A' }, () => { throw new Error('disk'); }), /disk/);
  await assert.rejects(queue.drainPaths(['A']), /disk/);
});


for (const replyId of ['', 'r']) {
  for (const failure of ['false', 'throw']) {
    test(`failed ${replyId ? 'reply' : 'marker'} edit (${failure}) rolls back only its text before later autosave`, async () => {
      const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
      const marker = { id: 'm', text: 'original', updatedAt: new Date(1), resolved: false,
        replies: [{ id: 'r', text: 'original reply', updatedAt: new Date(1) }, { id: 'other', text: 'other' }] };
      const target = replyId ? marker.replies[0] : marker; const original = target.text;
      const events = []; const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
      const context = vm.createContext({ playlistResolutionQueue: queue, normalizeComparableFilePath: p => p,
        reviewDataManager: { captureSaveCheckpoint: () => ({ videoPath: 'A' }), _ownsSave: () => true,
          saveThroughCheckpoint: async () => { marker.resolved = true; marker.replies[1].text = 'concurrent';
            if (failure === 'throw') throw new Error('disk'); return false; } },
        commentManager: { getMarker: () => marker, _emit: (name, detail) => events.push({ name, detail }) },
        liveblocksManager: { checkEditLock: () => null }, showToast() {} });
      vm.runInContext(appFunction('saveCurrentCommentEdit'), context);
      const result = await context.saveCurrentCommentEdit('m', () => {
        target.text = 'attempted'; target.updatedAt = marker.updatedAt = new Date(2); return true;
      }, replyId);
      assert.equal(result, false); assert.equal(target.text, original);
      assert.equal(marker.resolved, true); assert.equal(marker.replies[1].text, 'concurrent');
      assert.ok(events.some(e => e.name === 'markersChanged'));
      assert.ok(target.updatedAt.getTime() > 2, 'rollback has a fresh collaboration revision');
      // An autosave reading the live model after failure must not commit the failed draft.
      const laterSave = JSON.parse(JSON.stringify(marker));
      assert.equal(replyId ? laterSave.replies[0].text : laterSave.text, original);
      await queue.drainPaths(['A']);
    });
  }
}

test('failed edit does not overwrite a newer remote text or a replaced video owner', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  for (const changedOwner of [false, true]) {
    const marker = { id: 'm', text: 'original', updatedAt: new Date(1) }; let owns = true;
    const context = vm.createContext({ playlistResolutionQueue: createPlaylistResolutionQueue({ keyForPath: p => p }),
      normalizeComparableFilePath: p => p, commentManager: { getMarker: () => marker, _emit() {} },
      liveblocksManager: { checkEditLock: () => null }, showToast() {},
      reviewDataManager: { captureSaveCheckpoint: () => ({ videoPath: 'A' }), _ownsSave: () => owns,
        saveThroughCheckpoint: async () => { marker.text = 'newer'; if (changedOwner) owns = false; return false; } } });
    vm.runInContext(appFunction('saveCurrentCommentEdit'), context);
    assert.equal(await context.saveCurrentCommentEdit('m', () => { marker.text = 'attempted'; return true; }), false);
    assert.equal(marker.text, 'newer');
  }
});

test('abandoned playlist failures release navigation without discarding pending writes or other failures', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
  await assert.rejects(queue.enqueue({ key: 'old', videoPath: 'A', scope: 'playlist' }, () => false));
  await assert.rejects(queue.enqueue({ key: 'edit', videoPath: 'B' }, () => false));
  const held = deferred();
  const pending = queue.enqueue({ key: 'late', videoPath: 'A', scope: 'playlist' }, () => held.promise);
  const rejected = assert.rejects(pending);
  queue.abandonPlaylistFailures();
  let drained = false; const drain = queue.drainPaths(['A']).then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false, 'accepted write must settle first');
  held.resolve(false); await rejected; await drain;
  await queue.drainPaths(['A']); await assert.rejects(queue.drainPaths(['B']));
  await assert.rejects(queue.enqueue({ key: 'new', videoPath: 'A', scope: 'playlist' }, () => false));
  await assert.rejects(queue.drainPaths(['A']), 'new playlist failures remain actionable');
});

test('committed replacement, creation/load and close abandon inaccessible playlist failures', () => {
  const queue = { abandonPlaylistFailures() { calls++; } }; let calls = 0;
  const states = new Map([['old', {}]]);
  const context = vm.createContext({ playlistResolutionQueue: queue, playlistResolutionStates: states });
  vm.runInContext(appFunction('abandonPlaylistResolutionFailures'), context);
  context.abandonPlaylistResolutionFailures(); assert.equal(calls, 1); assert.equal(states.size, 0);
  assert.match(appFunction('commitPlaylistReplacement'), /abandonPlaylistResolutionFailures\(\)/);
  for (const callback of ['onPlaylistLoaded', 'onPlaylistClosed']) {
    const start = appSource.indexOf(`playlistManager.${callback} =`);
    assert.match(appSource.slice(start, appSource.indexOf('\n    };', start)), /abandonPlaylistResolutionFailures\(\)/);
  }
});

for (const editorType of ['textarea', 'contenteditable']) { test(`pending ${editorType} edit freezes its form, rejects duplicate mutation and restores retry on failure`, async () => {
  const { JSDOM } = require('jsdom');
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const dom = new JSDOM(`<div id="form">${editorType === 'textarea' ? '<textarea>draft</textarea>' : '<div contenteditable="true">draft</div>'}<button>Save</button><button>Cancel</button></div>`);
  const form = dom.window.document.querySelector('#form'), editor = form.firstChild, held = deferred();
  const marker = { id: 'm', text: 'original', updatedAt: new Date(0) }; let mutations = 0;
  const context = vm.createContext({ playlistResolutionQueue: createPlaylistResolutionQueue({ keyForPath: p => p }), normalizeComparableFilePath: p => p,
    reviewDataManager: { captureSaveCheckpoint: () => ({ videoPath: 'A' }), _ownsSave: () => true, saveThroughCheckpoint: () => held.promise },
    commentManager: { getMarker: () => marker, _emit() {} }, liveblocksManager: { checkEditLock: () => null }, showToast() {} });
  vm.runInContext(appFunction('lockCommentEditForm') + '\n' + appFunction('saveCurrentCommentEdit'), context);
  const first = context.saveCurrentCommentEdit('m', () => { mutations++; marker.text = 'first'; return true; }, '', form);
  assert.equal(form.getAttribute('aria-busy'), 'true');
  assert.equal(editorType === 'textarea' ? editor.readOnly : editor.contentEditable === 'false', true);
  assert.ok([...form.querySelectorAll('button')].every(button => button.disabled));
  const second = context.saveCurrentCommentEdit('m', () => { mutations++; marker.text = 'second'; return true; }, '', form);
  assert.equal(await second, false, 'a second submission must not borrow the first result');
  held.resolve(false); assert.equal(await first, false); assert.equal(mutations, 1); assert.equal(marker.text, 'original');
  assert.equal(form.hasAttribute('aria-busy'), false); assert.ok([...form.querySelectorAll('button')].every(button => !button.disabled));
  assert.equal(editorType === 'textarea' ? editor.readOnly : editor.getAttribute('contenteditable') === 'false', false);
  dom.window.close();
}); }

test('actual main and reply edit submissions pass their owning forms to the save guard', () => {
  assert.match(appSource, /saveCurrentCommentEdit\(markerId, \(\) => commentManager.updateMarker\(markerId, \{ text: newText \}\), '', editFormEl\)/);
  assert.match(appFunction('startReplyEdit'), /saveCurrentCommentEdit\(markerId, \(\) => commentManager.updateReply\(markerId, replyId, \{ text: newText \}\), replyId, form\)/);
});

test('persisted deletion retires only matching current resolution failures including a late rejection', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
  const intent = (key, videoPath, markerId) => ({ key, videoPath, markerId, scope: 'current-resolution' });
  for (const i of [intent('gone', 'A', 'gone'), intent('keep', 'A', 'keep'), intent('other-file', 'B', 'gone')]) await assert.rejects(queue.enqueue(i, () => false));
  const held = deferred(); const pending = queue.enqueue(intent('late', 'A', 'gone'), () => held.promise); const rejected = assert.rejects(pending);
  const context = vm.createContext({ playlistResolutionQueue: queue, reviewDataManager: { getVideoPath: () => 'A' },
    commentManager: { getMarker: id => id === 'keep' ? { id } : { id, deleted: true } } });
  vm.runInContext(appFunction('retireDeletedCommentResolutionFailures'), context); context.retireDeletedCommentResolutionFailures();
  held.resolve(false); await rejected;
  await queue.enqueue(intent('keep', 'A', 'keep'), () => true); await queue.drainPaths(['A']);
  await assert.rejects(queue.drainPaths(['B']));
  assert.match(appSource, /addEventListener\('saved', async \(e\) => \{\s*retireDeletedCommentResolutionFailures\(\)/);
});

test('repeated current resolution clicks do not borrow a pending opposite intent success', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const held = deferred(), marker = { id: 'm', resolved: false }; let calls = 0; const notices = [];
  const context = vm.createContext({ playlistResolutionQueue: createPlaylistResolutionQueue({ keyForPath: p => p }), normalizeComparableFilePath: p => p,
    commentManager: { getMarker: () => marker, layers: [{ id: 'l', markers: new Map([['m', marker]]) }], _emit() {} },
    reviewDataManager: { getVideoPath: () => 'A', getBframePath: () => 'A.bframe', captureSaveCheckpoint: () => ({ revision: 1 }) },
    liveblocksManager: { checkEditLock: () => null }, userName: 'tester', suppressCommentRangeRefreshOnce: false,
    showToast: text => notices.push(text),
    togglePlaylistAggregateResolvedWithoutNavigation: async (_range, intent) => { calls++; marker.resolved = intent.desiredResolved; await held.promise; return marker; } });
  for (const name of ['snapshotMarkerResolution', 'applyMarkerResolutionToggle', 'toggleCurrentMarkerResolved']) vm.runInContext(appFunction(name), context);
  const first = context.toggleCurrentMarkerResolved('m'); await Promise.resolve(); await Promise.resolve();
  let secondFinished = false; const second = context.toggleCurrentMarkerResolved('m').then(result => { secondFinished = true; return result; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(secondFinished, true, 'the second click must be rejected immediately instead of joining the pending write');
  assert.equal(await second, false); assert.equal(calls, 1); assert.match(notices.at(-1), /저장/);
  held.resolve(true); assert.equal(await first, true); assert.equal(marker.resolved, true);
  assert.equal(await context.toggleCurrentMarkerResolved('m'), true); assert.equal(marker.resolved, false); assert.equal(calls, 2);
});

const CURRENT_TOGGLE_FUNCTIONS = ['snapshotMarkerResolution', 'applyMarkerResolutionToggle', 'toggleCurrentMarkerResolved'];

test('a current-list resolution shows at the click even while an earlier save in the same file is pending', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
  const earlier = deferred();
  // 공유 드라이브에서는 저장 한 번이 수 초 걸린다. 그동안 같은 파일의 다른 작업은 줄을 선다.
  const blocking = queue.enqueue({ key: 'earlier', videoPath: 'A' }, () => earlier.promise);
  const marker = { id: 'm', resolved: false }; const events = []; const runs = [];
  const context = vm.createContext({ playlistResolutionQueue: queue, normalizeComparableFilePath: p => p,
    commentManager: { getMarker: () => marker, layers: [{ id: 'l', markers: new Map([['m', marker]]) }], _emit: name => events.push(name) },
    reviewDataManager: { getVideoPath: () => 'A', getBframePath: () => 'A.bframe', captureSaveCheckpoint: () => ({ revision: 7 }) },
    liveblocksManager: { checkEditLock: () => null }, userName: 'tester', suppressCommentRangeRefreshOnce: false, showToast() {},
    togglePlaylistAggregateResolvedWithoutNavigation: async (range, intent) => { runs.push({ range, intent }); return marker; } });
  for (const name of CURRENT_TOGGLE_FUNCTIONS) vm.runInContext(appFunction(name), context);

  const toggling = context.toggleCurrentMarkerResolved('m');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(marker.resolved, true, 'the click must not wait behind the earlier save');
  assert.equal(marker.resolvedBy, 'tester');
  assert.deepEqual(events, ['markerUpdated', 'markersChanged']);
  assert.equal(runs.length, 0, 'persisting still waits its turn');

  earlier.resolve(true); await blocking;
  assert.equal(await toggling, true);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].intent.desiredResolved, true);
  assert.equal(runs[0].intent.optimistic.marker, marker);
  assert.equal(runs[0].intent.optimistic.checkpoint.revision, 7);
  assert.equal(runs[0].range.resolved, false, 'the range still describes the state before the click');
});

test('a locked or mid-navigation comment is not changed at the click', async () => {
  const { createPlaylistResolutionQueue } = await import('../../renderer/scripts/modules/playlist-comment-resolution.js');
  for (const blocker of ['edit-lock', 'layer-lock', 'navigation']) {
    const queue = createPlaylistResolutionQueue({ keyForPath: p => p });
    const marker = { id: 'm', resolved: false }; const events = [];
    const release = blocker === 'navigation' ? queue.lockPaths(['A']) : () => {};
    const context = vm.createContext({ playlistResolutionQueue: queue, normalizeComparableFilePath: p => p,
      commentManager: { getMarker: () => marker, layers: [{ id: 'l', locked: blocker === 'layer-lock', markers: new Map([['m', marker]]) }], _emit: name => events.push(name) },
      reviewDataManager: { getVideoPath: () => 'A', getBframePath: () => 'A.bframe', captureSaveCheckpoint: () => ({ revision: 1 }) },
      liveblocksManager: { checkEditLock: () => ({ isLocked: blocker === 'edit-lock' }) }, userName: 'tester',
      suppressCommentRangeRefreshOnce: false, showToast() {},
      togglePlaylistAggregateResolvedWithoutNavigation: async () => { throw Object.assign(new Error('blocked'), { blocksNavigation: false }); } });
    for (const name of CURRENT_TOGGLE_FUNCTIONS) vm.runInContext(appFunction(name), context);
    assert.equal(await context.toggleCurrentMarkerResolved('m'), false, blocker);
    assert.equal(marker.resolved, false, blocker);
    assert.deepEqual(events, [], blocker);
    release();
  }
});

function createCurrentFileResolutionContext({ saveResults, marker, events, notices, navigationLocked = false }) {
  const layer = { id: 'l', locked: false, markers: new Map([[marker.id, marker]]) };
  const saves = [];
  const context = vm.createContext({
    getPlaylistManager: () => ({ getItems: () => [], ensureItemBframePath: async item => item.bframePath }),
    reviewDataManager: { getBframePath: () => 'A.bframe', captureSaveCheckpoint: () => ({ revision: 3 }), _ownsSave: () => true,
      saveThroughCheckpoint: async checkpoint => { saves.push(checkpoint); return saveResults.shift() ?? false; } },
    isSameFilePath: (a, b) => a === b, userName: 'tester', suppressCommentRangeRefreshOnce: false,
    commentManager: { getMarker: () => marker, layers: [layer], _emit: name => events.push(name) },
    liveblocksManager: { checkEditLock: () => null }, showToast: (text, type) => notices.push({ text, type }),
    playlistResolutionQueue: { isLocked: () => navigationLocked === true },
    RESOLUTION_SAVE_RETRY_DELAYS_MS: [0, 1, 1], setTimeout
  });
  for (const name of ['snapshotMarkerResolution', 'applyMarkerResolutionToggle', 'restoreMarkerResolution',
    'saveResolutionThroughCheckpoint', 'togglePlaylistAggregateResolvedWithoutNavigation']) vm.runInContext(appFunction(name), context);
  return { context, saves };
}

const CURRENT_FILE_RANGE = { markerId: 'm', layerId: 'l', resolved: false };
const createUnresolvedMarker = () => ({ id: 'm', resolved: false, resolvedBy: null, resolvedAt: null, updatedAt: new Date(1) });

test('a current-list resolution stays on screen when the shared file save keeps being deferred', async () => {
  const marker = createUnresolvedMarker(); const events = []; const notices = [];
  // 여러 사람이 같은 파일을 저장하는 동안에는 저장이 충돌·사용 중으로 거듭 미뤄질 수 있다.
  const { context, saves } = createCurrentFileResolutionContext({ saveResults: [false, false, false], marker, events, notices });
  const result = await context.togglePlaylistAggregateResolvedWithoutNavigation({ ...CURRENT_FILE_RANGE },
    { videoPath: 'A.mp4', bframePath: 'A.bframe', desiredResolved: true, scope: 'current-resolution' });
  assert.equal(result, marker);
  assert.equal(marker.resolved, true, 'the click must not be undone in front of the user');
  assert.equal(marker.resolvedBy, 'tester');
  assert.equal(saves.length, 3, 'the same change is retried before giving up on waiting');
  assert.deepEqual(events, ['markerUpdated', 'markersChanged'], 'no revert is emitted, so none is broadcast');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].type, 'info');
  assert.match(notices[0].text, /자동으로 다시 저장/);
});

test('a deferred save that succeeds on retry needs no notice, and a playlist resolution still reverts on failure', async () => {
  const marker = createUnresolvedMarker(); const notices = [];
  const retried = createCurrentFileResolutionContext({ saveResults: [false, true], marker, events: [], notices });
  await retried.context.togglePlaylistAggregateResolvedWithoutNavigation({ ...CURRENT_FILE_RANGE },
    { videoPath: 'A.mp4', bframePath: 'A.bframe', desiredResolved: true, scope: 'current-resolution' });
  assert.equal(marker.resolved, true); assert.equal(retried.saves.length, 2); assert.deepEqual(notices, []);

  const other = createUnresolvedMarker(); const otherEvents = [];
  const playlist = createCurrentFileResolutionContext({ saveResults: [false, false, false], marker: other, events: otherEvents, notices: [] });
  await assert.rejects(playlist.context.togglePlaylistAggregateResolvedWithoutNavigation({ ...CURRENT_FILE_RANGE },
    { videoPath: 'A.mp4', bframePath: 'A.bframe', desiredResolved: true, scope: 'playlist' }), /해결 상태 저장에 실패/);
  assert.equal(other.resolved, false, 'the playlist row keeps its explicit failed-and-retry state');
  assert.deepEqual(otherEvents, ['markerUpdated', 'markersChanged', 'markerUpdated', 'markersChanged']);
});

test('a resolution save does not keep retrying while a video switch waits for this file', async () => {
  const marker = createUnresolvedMarker(); const notices = [];
  // 영상 전환은 이 파일의 저장이 끝나기를 기다린다. 재시도로 붙잡지 않고 전환 직전 저장에 맡긴다.
  const { context, saves } = createCurrentFileResolutionContext({ saveResults: [false, true], marker, events: [], notices, navigationLocked: true });
  const result = await context.togglePlaylistAggregateResolvedWithoutNavigation({ ...CURRENT_FILE_RANGE },
    { videoPath: 'A.mp4', bframePath: 'A.bframe', desiredResolved: true, scope: 'current-resolution' });
  assert.equal(result, marker);
  assert.equal(saves.length, 1, 'only the first round runs');
  assert.equal(marker.resolved, true);
});

test('a reverted playlist resolution is a new revision, not a return to the old timestamp', () => {
  const context = vm.createContext({ Date, Math });
  vm.runInContext(appFunction('restoreMarkerResolution'), context);
  const before = new Date(1000);
  const marker = { resolved: true, resolvedBy: 'tester', resolvedAt: new Date(5000), updatedAt: new Date(Date.now() + 60000) };
  context.restoreMarkerResolution(marker, { resolved: false, resolvedBy: null, resolvedAt: null, updatedAt: before });
  assert.equal(marker.resolved, false);
  assert.equal(marker.resolvedAt, null);
  // 다른 PC 가 이 되돌림을 "이미 지나온 옛 사본" 으로 보지 않도록 수정 시각은 앞으로만 간다.
  assert.ok(marker.updatedAt.getTime() > Date.now() + 59000);
  assert.notEqual(marker.updatedAt.getTime(), before.getTime());
});

test('an optimistic click is not applied twice, and is re-applied if the model was replaced meanwhile', async () => {
  const marker = { id: 'm', resolved: true, resolvedBy: 'tester', resolvedAt: new Date(5), updatedAt: new Date(5) };
  const events = []; const checkpoint = { revision: 9 };
  const optimisticIntent = () => ({ videoPath: 'A.mp4', bframePath: 'A.bframe', desiredResolved: true,
    scope: 'current-resolution', optimistic: { marker, previous: { resolved: false }, checkpoint } });
  const same = createCurrentFileResolutionContext({ saveResults: [true], marker, events, notices: [] });
  await same.context.togglePlaylistAggregateResolvedWithoutNavigation({ ...CURRENT_FILE_RANGE }, optimisticIntent());
  assert.deepEqual(events, [], 'already shown at the click');
  assert.equal(same.saves[0], checkpoint, 'the save covers the revision captured at the click');

  // 클릭 뒤에 파일 동기화가 모델을 통째로 갈아 끼웠다(같은 id 의 새 객체).
  const replaced = createUnresolvedMarker(); const replacedEvents = [];
  const swapped = createCurrentFileResolutionContext({ saveResults: [true], marker: replaced, events: replacedEvents, notices: [] });
  await swapped.context.togglePlaylistAggregateResolvedWithoutNavigation({ ...CURRENT_FILE_RANGE }, optimisticIntent());
  assert.equal(replaced.resolved, true);
  assert.deepEqual(replacedEvents, ['markerUpdated', 'markersChanged']);
});

test('connected file changes also merge comments, and a failed room join falls back with a notice and a rejoin', () => {
  const throttleStart = appSource.indexOf('const connectedDrawingsV3ReloadThrottle = createLeadingTrailingThrottle({');
  const throttle = appSource.slice(throttleStart, appSource.indexOf('async function syncReviewFileFromDisk', throttleStart));
  assert.ok(throttle.includes('reviewDataManager.reloadCommentsFromDisk?.()'));
  assert.ok(throttle.includes('if (commentsReloaded?.changed === true) void refreshCommentRangesForCurrentMode();'));

  const start = appFunction('startCollaborationForVideoLoad');
  const failure = start.slice(start.indexOf('} catch (error) {'));
  assert.ok(failure.includes('error?.joinFailureReason'));
  assert.ok(failure.includes('scheduleCollaborationRejoin(loadToken, bframePath, reason)'));
  // 다른 접속에 자리를 내준 시도는 실패로 알리지 않고, 방에 들어간 뒤의 실패도 "연결 실패" 가 아니다.
  assert.ok(failure.includes("if (reason === 'superseded') {"));
  assert.ok(failure.includes('if (!liveblocksManager.isConnected &&'));
  assert.ok(start.indexOf('watchFileStart(bframePath)') > start.indexOf('scheduleCollaborationRejoin('),
    'the file watch must start after a failed join too');
  assert.ok(appFunction('describeCollaborationJoinFailure').includes('room-full'));
  assert.ok(appFunction('showCollaborationSyncStatus').includes('retryCollaborationJoin({ manual: true })'));
});
