const test = require('node:test');
const assert = require('node:assert/strict');
global.window = { logPanel: null, electronAPI: {} };
const copy = value => value === undefined ? undefined : structuredClone(value);
const root = extra => ({ bframeVersion: '2.0', videoPath: 'C:/current.mp4', videoFile: 'current.mp4', fps: 24,
  comments: { layers: [] }, drawings: { layers: [] }, highlights: [], compositionLayers: [], ...extra });
async function setup(initial = null, withManager = true) {
  const { ReviewDataManager } = await import('../../renderer/scripts/modules/review-data-manager.js');
  const { ReviewCarryoverManager } = await import('../../renderer/scripts/modules/review-carryover-manager.js');
  const { createPreviousReviewSources } = await import('../../shared/review-carryover.js');
  const carryover = new ReviewCarryoverManager(); const writes = []; let disk = copy(initial); let token = 0;
  window.electronAPI = {
    loadReview: async () => copy(disk),
    loadReviewSnapshot: async () => ({ data: copy(disk), versionToken: `t${token}` }),
    saveReview: async (path, data, options) => {
      writes.push({ path, data: copy(data), options }); disk = copy(data); token++;
      return { success: true, versionToken: `t${token}` };
    }
  };
  const manager = new ReviewDataManager({ autoSave: false, reviewCarryoverManager: withManager ? carryover : undefined });
  manager.connect(); await manager.setVideoFile('C:/current.mp4');
  const source = id => createPreviousReviewSources({ comments: [{ id, text: '원문', frame: 12 }] }, { path: 'C:/old.mp4' })[0];
  return { manager, carryover, writes, source, setDisk: value => { disk = copy(value); token++; }, getDisk: () => copy(disk) };
}

test('first carry creates substantive review file and reloads without source access', async () => {
  const { manager, carryover, writes, source } = await setup();
  carryover.carry(source('c1'));
  assert.equal(manager.hasSubstantiveContent(), true); assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(await manager.save(), true);
  assert.equal(writes[0].data.reviewCarryoverV1.items[0].source.text, '원문');
  assert.deepEqual(writes[0].data.comments, { layers: [] });
  carryover.reset(); await manager.load();
  assert.equal(carryover.getItems().length, 1); assert.equal(manager.hasUnsavedChanges(), false);
  manager.disconnect(); carryover.carry(source('c2')); assert.equal(manager.isDirty, false);
});

test('cancelling the only carry before first autosave persists its tombstone and prevents stale resurrection', { timeout: 3000 }, async t => {
  const { manager, carryover, writes, source, getDisk, setDisk } = await setup();
  t.after(() => manager.disconnect());
  manager.autoSaveEnabled = true; manager.autoSaveDelay = 5;
  const saved = new Promise(resolve => manager.addEventListener('saved', resolve, { once: true }));
  const item = carryover.carry(source('cancel-before-save'));
  const stale = carryover.toJSON();
  carryover.remove(item.id);
  assert.deepEqual(carryover.getItems(), []);
  assert.equal(writes.length, 0);
  assert.equal(manager.hasSubstantiveContent(), true);
  assert.equal(manager.hasUnsavedChanges(), true);
  await saved; await manager.save();
  assert.equal(writes[0].options.failIfExists, true);
  assert.equal(getDisk().reviewCarryoverV1.items[0].deleted, true);
  carryover.reset(); await manager.load();
  assert.deepEqual(carryover.getItems(), []);
  assert.equal(carryover.toJSON().items[0].deleted, true);
  setDisk({ ...getDisk(), reviewCarryoverV1: stale });
  manager.setFps(30); assert.equal(await manager.save(), true);
  assert.equal(getDisk().reviewCarryoverV1.items[0].deleted, true);
});

test('save merges remote queue and preserves edits made while write is in flight', async () => {
  const state = await setup(); const { manager, carryover, source, getDisk, setDisk } = state;
  const first = carryover.carry(source('c1')); await manager.save();
  const disk = getDisk(); disk.reviewCarryoverV1.items[0].status = 'verified';
  disk.reviewCarryoverV1.items[0].updatedAt = '2099-01-01T00:00:00.000Z'; setDisk(disk);
  carryover.carry(source('c2'));
  const save = window.electronAPI.saveReview; let release; let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  window.electronAPI.saveReview = async (...args) => { entered(); await new Promise(resolve => { release = resolve; }); return save(...args); };
  const saving = manager.save(); await waiting; carryover.carry(source('c3')); release();
  assert.equal(await saving, true); assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(carryover.getItems().find(item => item.id === first.id).status, 'verified');
  assert.equal(carryover.getItems().length, 3);
  window.electronAPI.saveReview = save; assert.equal(await manager.save(), true);
  assert.equal(getDisk().reviewCarryoverV1.items.length, 3); manager.disconnect();
});

test('external merge accepts its remote baseline and a newer remote status wins next reload', async () => {
  const { manager, carryover, source, getDisk, setDisk } = await setup();
  carryover.carry(source('c1')); await manager.save();
  let disk = getDisk(); disk.reviewCarryoverV1.items[0].status = 'verified'; setDisk(disk);
  assert.equal((await manager.reloadAndMerge({ merge: true })).success, true);
  assert.equal(carryover.getItems()[0].status, 'verified');
  disk = getDisk(); disk.reviewCarryoverV1.items[0].status = 'needs-fix'; setDisk(disk);
  await manager.reloadAndMerge({ merge: true });
  assert.equal(carryover.getItems()[0].status, 'needs-fix'); manager.disconnect();
});

test('old callers and unsupported payloads survive unrelated saves and switching videos resets queue', async () => {
  for (const withManager of [true, false]) {
    const payload = { version: 9, data: { preserve: [1, 2] } };
    const { manager, carryover, writes, setDisk } = await setup(root({ reviewCarryoverV1: payload }), withManager);
    manager.setFps(30); assert.equal(await manager.save(), true);
    assert.deepEqual(writes[0].data.reviewCarryoverV1, payload);
    if (withManager) assert.equal(carryover.isEditable, false);
    setDisk(null); await manager.setVideoFile('C:/new.mp4');
    assert.deepEqual(carryover.getItems(), []); assert.equal(carryover.isEditable, true);
    assert.equal(manager.hasSubstantiveContent(), false); manager.disconnect();
  }
});

test('late old-video load cannot populate new-video carryover', async () => {
  const { manager, carryover, source } = await setup();
  carryover.carry(source('c1')); const oldPayload = carryover.toJSON();
  let release;
  window.electronAPI.loadReview = path => path.includes('old-current') ?
    new Promise(resolve => { release = resolve; }) : Promise.resolve(null);
  const old = manager.setVideoFile('C:/old-current.mp4', { skipSave: true });
  await Promise.resolve();
  await manager.setVideoFile('C:/new-current.mp4', { skipSave: true });
  release(root({ reviewCarryoverV1: oldPayload })); await old;
  assert.equal(manager.currentVideoPath, 'C:/new-current.mp4');
  assert.deepEqual(carryover.getItems(), []); manager.disconnect();
});

test('first carry schedules autosave and successful writes use the latest CAS observation', async () => {
  const { manager, carryover, source, writes } = await setup();
  manager.autoSaveEnabled = true; manager.autoSaveDelay = 5;
  const saved = new Promise(resolve => manager.addEventListener('saved', resolve, { once: true }));
  carryover.carry(source('auto')); await saved;
  await manager.save(); // Wait for save finalization after its notification.
  assert.equal(writes.length, 1); assert.equal(writes[0].options.failIfExists, true);
  const nextSaved = new Promise(resolve => manager.addEventListener('saved', resolve, { once: true }));
  carryover.setStatus(carryover.getItems()[0].id, 'verified'); await nextSaved;
  assert.equal(writes[1].options.expectedVersionToken, 't1');
  assert.equal(writes[1].data.reviewCarryoverV1.items[0].status, 'verified'); manager.disconnect();
});

test('external cancellation persists through a stale file and requires explicit carry to restore', async () => {
  const { manager, carryover, source, getDisk, setDisk } = await setup();
  const item = carryover.carry(source('c1')); await manager.save(); const stale = getDisk();
  const remote = getDisk(); remote.reviewCarryoverV1.items[0].deleted = true;
  setDisk(remote); await manager.reloadAndMerge({ merge: true });
  assert.equal(carryover.getItems().length, 0);
  setDisk(stale); manager.setFps(30); await manager.save();
  assert.equal(getDisk().reviewCarryoverV1.items[0].deleted, true);
  carryover.carry(source('c1')); await manager.save();
  assert.equal(getDisk().reviewCarryoverV1.items[0].deleted, false);
  assert.equal(getDisk().reviewCarryoverV1.items[0].id, item.id); manager.disconnect();
});

test('unknown remote payload blocks concurrent queue overwrite without losing local changes', async () => {
  const { manager, carryover, source, getDisk, setDisk } = await setup();
  const item = carryover.carry(source('c1')); await manager.save();
  const remote = getDisk(); remote.reviewCarryoverV1 = { version: 99, opaque: 'remote' }; setDisk(remote);
  carryover.setStatus(item.id, 'needs-fix');
  assert.equal(await manager.save(), false);
  assert.deepEqual(getDisk().reviewCarryoverV1, remote.reviewCarryoverV1);
  assert.equal(carryover.getItems()[0].status, 'needs-fix');
  assert.equal(manager.hasUnsavedChanges(), true); manager.disconnect();
});

test('queue edits during external reload remain dirty and resume autosave after the read', async () => {
  const { manager, carryover, source, getDisk } = await setup();
  const item = carryover.carry(source('c1')); await manager.save();
  const load = window.electronAPI.loadReviewSnapshot;
  let release;
  window.electronAPI.loadReviewSnapshot = async (...args) => {
    const snapshot = await load(...args);
    await new Promise(resolve => { release = resolve; });
    return snapshot;
  };
  manager.autoSaveEnabled = true; manager.autoSaveDelay = 5;
  const reloading = manager.reloadAndMerge({ merge: true });
  await Promise.resolve();
  assert.equal(manager.isLoading, true);
  carryover.setStatus(item.id, 'verified');
  assert.equal(manager.hasUnsavedChanges(), true);
  assert.equal(getDisk().reviewCarryoverV1.items[0].status, 'pending');
  const saved = new Promise(resolve => manager.addEventListener('saved', resolve, { once: true }));
  release(); await reloading;
  window.electronAPI.loadReviewSnapshot = load;
  assert.equal(carryover.getItems()[0].status, 'verified');
  assert.equal(manager.hasUnsavedChanges(), true);
  await saved; await manager.save();
  assert.equal(getDisk().reviewCarryoverV1.items[0].status, 'verified');
  assert.equal(manager.hasUnsavedChanges(), false);
  manager.disconnect();
});

test('no-manager external reload retains opaque queue when an old writer omits the field', async () => {
  const payload = { version: 99, opaque: 'retain' };
  const { manager, setDisk, getDisk } = await setup(root({ reviewCarryoverV1: payload }), false);
  setDisk(root());
  assert.equal((await manager.reloadAndMerge({ merge: true })).success, true);
  manager.setFps(30); assert.equal(await manager.save(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(getDisk())).reviewCarryoverV1, payload);
  manager.disconnect();
});

test('connected file refresh merges carryover without touching broadcast-owned comments or local edits', async t => {
  const { manager, carryover, source, getDisk, setDisk } = await setup();
  t.after(() => manager.disconnect());
  const item = carryover.carry(source('peer')); await manager.save();
  const baseline = getDisk();
  manager.commentManager = Object.assign(new EventTarget(), { fromJSON: () => assert.fail('Connected refresh must not install disk comments') });
  let loaded = 0; carryover.addEventListener('loaded', () => loaded++);
  carryover.carry(source('local-unsaved'));
  const peer = copy(baseline); peer.reviewCarryoverV1.items[0].status = 'verified';
  peer.reviewCarryoverV1.items[0].updatedAt = '2099-01-01T00:00:00.000Z';
  const peerManager = new carryover.constructor(); peerManager.fromJSON(peer.reviewCarryoverV1);
  peerManager.carry(source('peer-added')); peer.reviewCarryoverV1 = peerManager.toJSON(); setDisk(peer);
  assert.equal(await manager.reloadReviewCarryoverFromDisk(), true);
  assert.equal(carryover.getItems().find(value => value.id === item.id).status, 'verified');
  assert.equal(carryover.getItems().length, 3);
  assert.equal(manager.hasUnsavedChanges(), true);
  peer.reviewCarryoverV1.items.find(value => value.id === item.id).deleted = true; setDisk(peer);
  assert.equal(await manager.reloadReviewCarryoverFromDisk(), true);
  assert.equal(carryover.hasSource(item.id), false);
  setDisk(baseline); await manager.reloadReviewCarryoverFromDisk();
  assert.equal(carryover.hasSource(item.id), false);
  assert.ok(loaded >= 2, 'Shared panel/timeline must receive loaded notifications');
  manager.commentManager = null;
});

test('connected refresh rejects late snapshots after a newer refresh or a video switch', async t => {
  const { manager, carryover, source, getDisk, setDisk } = await setup();
  t.after(() => manager.disconnect());
  carryover.carry(source('peer')); await manager.save();
  const pending = [];
  window.electronAPI.loadReviewSnapshot = () => new Promise(resolve => pending.push(resolve));
  const old = manager.reloadReviewCarryoverFromDisk();
  const fresh = manager.reloadReviewCarryoverFromDisk();
  const next = getDisk(); next.reviewCarryoverV1.items[0].status = 'verified';
  pending[1]({ data: next, versionToken: 'new' }); assert.equal(await fresh, true);
  pending[0]({ data: getDisk(), versionToken: 'old' }); assert.equal(await old, false);
  assert.equal(carryover.getItems()[0].status, 'verified');
  const previousVideo = manager.reloadReviewCarryoverFromDisk();
  setDisk(null); await manager.setVideoFile('C:/different.mp4', { skipSave: true });
  pending[2]({ data: next, versionToken: 'late' });
  assert.equal(await previousVideo, false); assert.deepEqual(carryover.getItems(), []);
});

test('connected refresh preserves clicks during reads and refuses foreign or future documents', async t => {
  const { manager, carryover, source, getDisk, setDisk } = await setup();
  t.after(() => manager.disconnect());
  const item = carryover.carry(source('peer')); await manager.save();
  const originalRead = window.electronAPI.loadReviewSnapshot;
  let release; const snapshot = getDisk();
  window.electronAPI.loadReviewSnapshot = () => new Promise(resolve => { release = resolve; });
  const pending = manager.reloadReviewCarryoverFromDisk();
  carryover.remove(item.id);
  release({ data: snapshot, versionToken: 'same' }); assert.equal(await pending, true);
  assert.equal(carryover.hasSource(item.id), false); assert.equal(manager.hasUnsavedChanges(), true);
  window.electronAPI.loadReviewSnapshot = originalRead;
  for (const changed of [{ reviewDocumentId: 'foreign-document' }, { bframeVersion: '99.0' }]) {
    setDisk({ ...snapshot, ...changed });
    assert.equal(await manager.reloadReviewCarryoverFromDisk(), false);
    assert.equal(carryover.hasSource(item.id), false);
  }
});

test('a save completed during connected refresh fences its older disk snapshot', async t => {
  const { manager, carryover, source, getDisk } = await setup();
  t.after(() => manager.disconnect());
  const item = carryover.carry(source('peer')); await manager.save();
  const originalRead = window.electronAPI.loadReviewSnapshot;
  const stale = getDisk(); let release;
  window.electronAPI.loadReviewSnapshot = () => new Promise(resolve => { release = resolve; });
  const pending = manager.reloadReviewCarryoverFromDisk();
  window.electronAPI.loadReviewSnapshot = originalRead;
  carryover.setResolved(item.id, true); assert.equal(await manager.save(), true);
  release({ data: stale, versionToken: 'stale' });
  assert.equal(await pending, false);
  assert.equal(carryover.getItems()[0].status, 'verified');
  assert.equal(manager.hasUnsavedChanges(), false);
});
