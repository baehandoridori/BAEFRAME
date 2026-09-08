const test = require('node:test');
const assert = require('node:assert/strict');

const shared = () => import('../../shared/review-carryover.js');
const managerClass = async () => (await import('../../renderer/scripts/modules/review-carryover-manager.js')).ReviewCarryoverManager;
const png = 'data:image/png;base64,aGVsbG8=';
async function source(id = 'c1', path = 'C:/shots/V01.mp4') {
  return (await shared()).createPreviousReviewSources({ fps: 30, comments: [{ id, text: '원문', frame: 60 }] }, { path })[0];
}

test('carry preserves source resolution and the public resolution toggle survives save and reload', async () => {
  const Manager = await managerClass(); const m = new Manager();
  const original = { ...await source(), resolved: true };
  const item = m.carry(original);
  assert.equal(item.status, 'verified');
  m.setResolved(item.id, false);
  assert.equal(m.getItems()[0].status, 'pending');
  m.setResolved(item.id, true); m.fromJSON(m.toJSON());
  assert.equal(m.getItems()[0].status, 'verified');
  assert.equal(original.resolved, true);
  assert.throws(() => m.setResolved(item.id, 'false'));
  m.remove(item.id); m.carry(original);
  assert.equal(m.getItems()[0].status, 'verified');
});

test('snapshots normalize paths, legacy comments, marker FPS and safe images without mutating originals', async () => {
  const { createPreviousReviewSources } = await shared();
  const root = { reviewDocumentId: 'same-document', fps: 30, comments: { layers: [{ markers: [
    { id: 'c1', frame: 60, text: '원문', image: png, images: ['javascript:alert(1)', 'data:image/svg+xml;base64,AAAA'], replies: [{ id: 'r1', text: '답글', image: png }, { id: 'r2', deleted: true }] },
    { id: 'deleted', deleted: true }, { id: 'own-fps', startFrame: 48, fps: 24 }
  ] }] } };
  const original = structuredClone(root);
  const items = createPreviousReviewSources(root, { path: 'C:\\SHOTS\\V01.mp4', displayLabel: 'V01' });
  assert.equal(items.length, 2);
  assert.equal(items[0].fps, 30);
  assert.equal(items[0].startFrame, 60);
  assert.deepEqual(items[0].images, [png]);
  assert.deepEqual(items[0].replies, [{ id: 'r1', author: '', text: '답글', images: [png] }]);
  assert.equal(items[1].fps, 24);
  assert.equal(items[0].key, (await source()).key);
  assert.notEqual(items[0].key, (await source('c1', 'C:/shots/V02.mp4')).key);
  items[0].text = '변이'; items[0].replies[0].text = '변이';
  assert.deepEqual(root, original);
  assert.equal(createPreviousReviewSources({ comments: [{ id: 'x' }] }, { path: 'C:/a.mp4' })[0].fps, 24);
  const legacy = createPreviousReviewSources({ comments: [{ id: 'legacy', content: '레거시 원문', replies: [{ content: '레거시 답글' }] }] }, { path: 'C:/a.mp4' })[0];
  assert.equal(legacy.text, '레거시 원문'); assert.equal(legacy.replies[0].text, '레거시 답글');
});

test('normalization and roundtrip retain long text and arbitrary numbers of source items', async () => {
  const { createPreviousReviewSources } = await shared(); const Manager = await managerClass();
  const original = '긴 원문'.repeat(20000);
  const sources = createPreviousReviewSources({ comments: Array.from({ length: 1005 }, (_, n) => ({ id: `item-${n}`, text: original })) }, { path: 'C:/a.mp4' });
  assert.equal(sources.length, 1005); assert.equal(sources[1004].text, original);
  const m = new Manager(); m.carry(sources[1004]); const value = m.toJSON();
  value.items[0].source.extension = { preserve: true }; value.extra = ['keep'];
  m.fromJSON(value); m.setStatus(value.items[0].id, 'verified');
  assert.equal(m.getItems()[0].source.text, original);
  assert.deepEqual(m.toJSON().extra, ['keep']);
  assert.deepEqual(m.getItems()[0].source.extension, { preserve: true });
});

test('manager preserves snapshots, deduplicates, validates status and carries again after cancellation', async () => {
  const Manager = await managerClass();
  const m = new Manager(); let changed = 0; let loaded = 0;
  m.addEventListener('changed', () => changed++); m.addEventListener('loaded', () => loaded++);
  const s = await source(); const item = m.carry(s, '한솔');
  assert.equal(item.status, 'pending'); assert.equal(m.hasSource(s.key), true);
  s.text = 'changed'; item.source.text = 'changed';
  m.setStatus(item.id, 'verified'); m.carry(await source());
  assert.equal(m.getItems()[0].status, 'verified');
  assert.equal(m.getItems()[0].source.text, '원문');
  assert.throws(() => m.setStatus(item.id, 'wrong'));
  m.remove(item.id); assert.equal(m.getItems().length, 0);
  assert.equal(m.toJSON().items[0].deleted, true);
  m.carry(await source()); assert.equal(m.getItems()[0].status, 'pending');
  const roundtrip = m.toJSON(); roundtrip.items[0].status = 'verified';
  assert.equal(m.getItems()[0].status, 'pending');
  const count = changed; m.fromJSON(m.toJSON()); m.reset();
  assert.equal(changed, count); assert.equal(loaded, 2);
});

test('three-way merge preserves separate changes, is symmetric in conflicts, and does not resurrect cancelled items', async () => {
  const { mergeReviewCarryover } = await shared(); const Manager = await managerClass();
  const a = new Manager(); a.carry(await source()); a.carry(await source('c2'));
  const base = a.toJSON(); const b = new Manager(); b.fromJSON(base);
  a.setStatus(base.items[0].id, 'verified'); b.setStatus(base.items[1].id, 'needs-fix');
  const merged = mergeReviewCarryover(base, a.toJSON(), b.toJSON());
  assert.deepEqual(merged.items.map(i => i.status), ['verified', 'needs-fix']);
  a.remove(base.items[0].id); b.setStatus(base.items[0].id, 'needs-fix');
  const deleted = mergeReviewCarryover(base, a.toJSON(), b.toJSON());
  assert.deepEqual(deleted, mergeReviewCarryover(base, b.toJSON(), a.toJSON()));
  assert.equal(deleted.items[0].deleted, true);
  assert.equal(mergeReviewCarryover(deleted, deleted, base).items[0].deleted, true);
  a.fromJSON(deleted); a.carry(await source());
  assert.equal(mergeReviewCarryover(deleted, a.toJSON(), deleted).items[0].deleted, false);
});

test('unsupported and malformed payloads roundtrip intact and block editing', async () => {
  const Manager = await managerClass();
  const { mergeReviewCarryover } = await shared();
  for (const payload of [{ version: 2, items: [{ mystery: 1 }] }, { version: 1, items: [null] }, null]) {
    const m = new Manager(); m.fromJSON(payload);
    assert.deepEqual(m.toJSON(), payload); assert.equal(m.isEditable, false);
    assert.throws(() => m.carry({})); assert.deepEqual(m.getItems(), []);
    assert.deepEqual(mergeReviewCarryover(payload, payload, undefined), payload);
    assert.deepEqual(mergeReviewCarryover(payload, undefined, payload), payload);
  }
});

test('root envelope migration and validation preserve incompatible optional data', async () => {
  const { migrateToV2 } = await import('../../shared/schema.js');
  const { validateReviewData } = await import('../../shared/validators.js');
  const payload = { version: 8, custom: ['keep'] };
  const migrated = migrateToV2({ version: '1.0', videoPath: 'C:/a.mp4', reviewCarryoverV1: payload });
  assert.deepEqual(migrated.reviewCarryoverV1, payload);
  assert.ok(validateReviewData(migrated).warnings.some(w => w.includes('reviewCarryoverV1')));
});
