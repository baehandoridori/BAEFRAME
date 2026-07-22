const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function importShared(relativePath) {
  return import(pathToFileURL(path.join(__dirname, '../..', relativePath)).href);
}

function createValidReviewData(overrides = {}) {
  return {
    bframeVersion: '2.0',
    videoFile: 'shot.mp4',
    videoPath: 'C:/shots/shot.mp4',
    fps: 24,
    comments: { layers: [] },
    drawings: { layers: [] },
    highlights: [],
    ...overrides
  };
}

test('opaque root fields round-trip without interpreting drawingsV3 or vendor data', async () => {
  const {
    KNOWN_BFRAME_ROOT_FIELDS,
    extractOpaqueBframeRoot,
    mergeBframeRoot
  } = await importShared('shared/bframe-root-envelope.js');
  const drawingsV3 = {
    schemaVersion: '3.0.0',
    documentId: 'drawingdoc-1',
    layers: [{ id: 'layer-1', vendorNode: { values: [1, 2, 3] } }]
  };
  const vendorReviewState = {
    provider: 'example',
    nested: { enabled: true, labels: ['a', 'b'] }
  };
  const source = createValidReviewData({ drawingsV3, vendorReviewState });

  const opaque = extractOpaqueBframeRoot(source);
  const merged = mergeBframeRoot(opaque, {
    ...source,
    modifiedAt: '2026-07-23T00:00:00.000Z'
  });

  assert.equal(KNOWN_BFRAME_ROOT_FIELDS.includes('drawingsV3'), false);
  assert.deepEqual(opaque, { drawingsV3, vendorReviewState });
  assert.deepEqual(merged.drawingsV3, drawingsV3);
  assert.deepEqual(merged.vendorReviewState, vendorReviewState);
  assert.equal(merged.modifiedAt, '2026-07-23T00:00:00.000Z');
});

test('canonical known root fields win and obsolete legacy fields are not resurrected', async () => {
  const { mergeBframeRoot } = await importShared('shared/bframe-root-envelope.js');
  const merged = mergeBframeRoot(
    {
      bframeVersion: '9.0',
      version: '1.0',
      versions: [{ version: 1 }],
      videoFile: 'stale.mp4',
      vendorField: { keep: true }
    },
    {
      bframeVersion: '2.0',
      videoFile: 'canonical.mp4'
    }
  );

  assert.equal(merged.bframeVersion, '2.0');
  assert.equal(merged.videoFile, 'canonical.mp4');
  assert.equal(Object.hasOwn(merged, 'version'), false);
  assert.equal(Object.hasOwn(merged, 'versions'), false);
  assert.deepEqual(merged.vendorField, { keep: true });
});

test('legacy migration preserves unknown subtrees and an existing reviewDocumentId', async () => {
  const { migrateToV2 } = await importShared('shared/schema.js');
  const drawingsV3 = {
    schemaVersion: '3.0.0',
    layers: [{ id: 'layer-1', opaqueNested: { untouched: true } }]
  };
  const source = {
    version: '1.0',
    reviewDocumentId: 'reviewdoc-123e4567-e89b-12d3-a456-426614174000',
    videoPath: 'C:/shots/legacy.mp4',
    versions: [{ version: 7, filename: 'legacy_v7.mp4' }],
    comments: [],
    drawingsV3,
    vendorField: { nested: ['unchanged'] }
  };

  const migrated = migrateToV2(source);

  assert.equal(migrated.bframeVersion, '2.0');
  assert.equal(migrated.reviewDocumentId, source.reviewDocumentId);
  assert.deepEqual(migrated.drawingsV3, drawingsV3);
  assert.deepEqual(migrated.vendorField, source.vendorField);
  assert.equal(Object.hasOwn(migrated, 'version'), false);
  assert.equal(Object.hasOwn(migrated, 'versions'), false);
  assert.deepEqual(migrated.manualVersions, [
    {
      version: 7,
      fileName: 'legacy_v7.mp4',
      filePath: '',
      addedAt: migrated.manualVersions[0].addedAt
    }
  ]);
});

test('future top-level major versions are detected and refused by v2 migration', async () => {
  const { getUnsupportedBframeMajor } = await importShared('shared/bframe-root-envelope.js');
  const {
    getDataVersion,
    hasExplicitBframeVersion,
    migrateToV2
  } = await importShared('shared/schema.js');

  assert.equal(getUnsupportedBframeMajor('3.0', '2.0'), 3);
  assert.equal(getUnsupportedBframeMajor('2.9', '2.0'), null);
  assert.equal(getUnsupportedBframeMajor('1.0', '2.0'), null);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor('legacy', '2.0')), true);
  assert.equal(getUnsupportedBframeMajor('legacy', '2.0', true), null);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor('v3.0', '2.0')), true);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor({ major: 3 }, '2.0')), true);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor(null, '2.0')), true);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor(0, '2.0')), true);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor('2.', '2.0')), true);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor('2.future', '2.0')), true);
  assert.equal(Number.isNaN(getUnsupportedBframeMajor('2...', '2.0')), true);
  assert.equal(getDataVersion({ bframeVersion: '' }), '');
  assert.deepEqual(getDataVersion({ bframeVersion: { major: 3 } }), { major: 3 });
  assert.equal(hasExplicitBframeVersion({}), false);
  assert.equal(hasExplicitBframeVersion({ bframeVersion: 'legacy' }), true);
  assert.throws(
    () => migrateToV2({ bframeVersion: '3.0', videoPath: 'C:/shots/future.mp4' }),
    /지원하지 않는.*3\.0/
  );
  assert.throws(
    () => migrateToV2({ bframeVersion: 'v3.0', videoPath: 'C:/shots/future.mp4' }),
    /지원하지 않는.*v3\.0/
  );
  assert.throws(
    () => migrateToV2({ bframeVersion: { major: 3 }, videoPath: 'C:/shots/future.mp4' }),
    /지원하지 않는.*\[object Object\]/
  );
  assert.throws(
    () => migrateToV2({ bframeVersion: 'legacy', videoPath: 'C:/shots/future.mp4' }),
    /지원하지 않는.*legacy/
  );
  assert.equal(migrateToV2({ videoPath: 'C:/shots/actual-legacy.mp4' }).bframeVersion, '2.0');
});

test('reviewDocumentId is generated once in reviewdoc-UUID form and never replaces an existing value', async () => {
  const {
    createReviewDocumentId,
    ensureReviewDocumentId,
    isValidReviewDocumentId
  } = await importShared('shared/bframe-root-envelope.js');
  const uuid = '123e4567-e89b-12d3-a456-426614174000';
  let calls = 0;
  const randomUUID = () => {
    calls += 1;
    return uuid;
  };

  assert.equal(isValidReviewDocumentId(`reviewdoc-${uuid}`), true);
  assert.equal(isValidReviewDocumentId('reviewdoc-not-a-uuid'), false);
  assert.equal(isValidReviewDocumentId(''), false);
  assert.equal(isValidReviewDocumentId(123), false);
  assert.equal(isValidReviewDocumentId(null), false);
  assert.equal(createReviewDocumentId(randomUUID), `reviewdoc-${uuid}`);
  const root = { bframeVersion: '2.0', vendorField: { keep: true } };
  const ensured = ensureReviewDocumentId(root, randomUUID);
  const ensuredAgain = ensureReviewDocumentId(ensured, randomUUID);

  assert.strictEqual(ensured, root);
  assert.strictEqual(ensuredAgain, root);
  assert.equal(root.reviewDocumentId, `reviewdoc-${uuid}`);
  assert.equal(calls, 2);

  const invalidExisting = { reviewDocumentId: '' };
  ensureReviewDocumentId(invalidExisting, randomUUID);
  assert.equal(invalidExisting.reviewDocumentId, '');
  assert.equal(calls, 2);
});

test('review validator rejects malformed reviewDocumentId values', async () => {
  const { validateReviewData } = await importShared('shared/validators.js');
  const invalidValues = ['', 123, null, 'reviewdoc-not-a-uuid'];

  for (const reviewDocumentId of invalidValues) {
    const result = validateReviewData(createValidReviewData({ reviewDocumentId }));
    assert.equal(result.valid, false, `expected ${String(reviewDocumentId)} to be invalid`);
    assert.match(result.errors.join('\n'), /reviewDocumentId/);
  }
});

test('review validator accepts a valid optional reviewDocumentId', async () => {
  const { validateReviewData } = await importShared('shared/validators.js');
  const result = validateReviewData(createValidReviewData({
    reviewDocumentId: 'reviewdoc-123e4567-e89b-12d3-a456-426614174000'
  }));

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});
