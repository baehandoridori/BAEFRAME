const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../shared/edit-project');
const { createEditorController } = require('../../renderer/scripts/editor/controller');

const source = {
  id: 's1',
  path: 'C:/media/a.mp4',
  name: 'A',
  durationSeconds: 10,
  width: 1920,
  height: 1080,
  fps: 24,
  hasAudio: true
};
function setup(apiOverrides = {}) {
  const api = {
    setDirty() {},
    confirmDiscard: async () => true,
    pickMedia: async () => ({ sources: [source] }),
    saveProject: async () => ({ path: 'C:/out/test.bedit' }),
    openProject: async () => ({ cancelled: true }),
    ...apiOverrides
  };
  const drawing = {
    loadClip: async () => {},
    seek: async () => {},
    setEnabled: async () => {},
    snapshot: async () => ({ drawingsV3: null, drawingLayersV1: null }),
    exportOverlays: async () => []
  };
  const controller = createEditorController({ core, api, drawing });
  return { controller, api, drawing };
}
test('split and undo preserve the original source and restore the complete timeline', async () => {
  const { controller: c } = setup();
  await c.importMedia();
  await c.seek(24);
  await c.edit('splitClip', c.state.selectedId, 24);
  assert.deepEqual(
    c.state.project.clips.map((x) => x.durationFrames),
    [24, 216]
  );
  assert.equal(c.state.project.sources[0].path, 'C:/media/a.mp4');
  await c.undo();
  assert.equal(c.state.project.clips.length, 1);
  assert.equal(c.state.project.clips[0].durationFrames, 240);
  await c.redo();
  assert.equal(c.state.project.clips.length, 2);
});
test('a cancelled project picker preserves unsaved edits', async () => {
  const { controller: c } = setup();
  await c.importMedia();
  const before = JSON.stringify(c.state.project);
  await c.open();
  assert.equal(JSON.stringify(c.state.project), before);
  assert.equal(c.state.dirty, true);
});
test('cancelled save never marks the project saved', async () => {
  const { controller: c } = setup({ saveProject: async () => ({ cancelled: true }) });
  await c.importMedia();
  await c.save();
  assert.equal(c.state.dirty, true);
  assert.equal(c.state.path, null);
});
test('save captures the correct project and clears dirty only after successful persistence', async () => {
  let release, received;
  const saving = new Promise((r) => (release = r));
  const { controller: c } = setup({
    saveProject: async (p) => {
      received = p;
      return saving;
    }
  });
  await c.importMedia();
  const pending = c.save();
  await new Promise((r) => setImmediate(r));
  assert.equal(c.state.dirty, true);
  assert.equal(received.sources[0].path, 'C:/media/a.mp4');
  release({ path: 'C:/out/actual.bedit' });
  await pending;
  assert.equal(c.state.dirty, false);
  assert.equal(c.state.path, 'C:/out/actual.bedit');
});
test('seeks at a clip boundary select the new clip and use its independent drawing offset', async () => {
  const { controller: c, drawing } = setup();
  const frames = [];
  drawing.seek = async (f) => frames.push(f);
  await c.importMedia();
  await c.edit('splitClip', c.state.selectedId, 24);
  await c.seek(24);
  assert.equal(c.state.selectedId, c.state.project.clips[1].id);
  assert.equal(frames.at(-1), 0);
});
test('an out-of-date drawing event cannot modify a different active clip', async () => {
  const { controller: c } = setup();
  await c.importMedia();
  const before = JSON.stringify(c.state.project);
  c.recordDrawing({
    clipId: 'not-the-active-clip',
    drawingsV3: { bad: true },
    drawingLayersV1: null
  });
  assert.equal(JSON.stringify(c.state.project), before);
});

test('loading an empty canonical V3 document does not turn scrubbing into edits or block undo', async () => {
  const { createFabricDrawingPersistenceStore } =
    await import('../../renderer/scripts/modules/fabric-drawing-persistence-store.js');
  const { controller: c, drawing } = setup();
  let store;
  drawing.loadClip = async (clip, project) => {
    store = clip ? createFabricDrawingPersistenceStore() : null;
    if (store)
    {store.importRootValue(clip.drawingsV3, {
      fps: project.fps,
      totalFrames: clip.durationFrames
    });}
  };
  drawing.snapshot = async () => ({
    drawingsV3: store?.exportRootValue() ?? null,
    drawingLayersV1: null
  });
  await c.importMedia();
  const revision = c.state.revision;
  await c.seek(24);
  await c.seek(48);
  assert.equal(c.state.revision, revision, 'only an explicit edit should enter history');
  await c.undo();
  assert.equal(c.state.project.clips.length, 0);
  assert.equal(c.state.canRedo, true);
});

test('moving a cut keeps its selection and local frame for the next move', async () => {
  const { controller: c, api } = setup();
  await c.importMedia();
  api.pickMedia = async () => ({
    sources: [
      { ...source, id: 's2', name: 'B' },
      { ...source, id: 's3', name: 'C' }
    ]
  });
  await c.importMedia();
  const id = c.state.project.clips[0].id;
  await c.seek(12);
  await c.edit('moveClip', id, 1);
  assert.equal(c.state.selectedId, id);
  assert.equal(c.state.frame, 252);
  await c.edit('moveClip', c.state.selectedId, 2);
  assert.equal(c.state.project.clips[2].id, id);
  assert.equal(c.state.frame, 492);
});

test('playhead updates do not repeatedly revoke a pending close approval', async () => {
  const messages = [];
  const { controller: c } = setup({ setDirty: (value) => messages.push(value) });
  await c.importMedia();
  const count = messages.length;
  await c.seek(12);
  await c.seek(13);
  assert.equal(messages.length, count);
  await c.edit('splitClip', c.state.selectedId, 12);
  assert.equal(messages.at(-1), true);
  assert.equal(messages.length, count + 1, 'a new edit must invalidate an old discard approval');
});

test('read-only playback does not copy drawing documents on every frame but still flushes manual seeks and boundaries', async () => {
  const { controller: c, drawing } = setup();
  await c.importMedia();
  await c.edit('splitClip', c.state.selectedId, 24);
  let snapshots = 0;
  const snapshot = drawing.snapshot;
  drawing.snapshot = async () => {
    snapshots += 1;
    return snapshot();
  };
  for (let frame = 1; frame < 24; frame += 1) {
    await c.seek(frame, { playback: true });
  }
  assert.equal(snapshots, 0, 'unchanged drawings must not be cloned each playback frame');
  await c.seek(24, { playback: true });
  assert.equal(snapshots, 2, 'clip switch flushes the outgoing scene and captures the new baseline');
  await c.seek(25);
  assert.equal(snapshots, 3, 'manual seek still preserves pending brush changes');
});
