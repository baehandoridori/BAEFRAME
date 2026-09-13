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
