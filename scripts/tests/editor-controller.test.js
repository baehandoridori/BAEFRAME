const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
function setup(apiOverrides = {}, createController = createEditorController) {
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
  const controller = createController({ core, api, drawing });
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

test('undo and redo clear the native dirty indicator whenever the saved project is restored', async () => {
  const messages = [];
  const { controller: c } = setup({ setDirty: value => messages.push(value) });
  await c.importMedia();
  await c.save();
  const saved = structuredClone(c.state.project);
  await c.update(project => ({ ...project, name: '수정된 편집' }));
  assert.equal(c.state.dirty, true);
  await c.undo();
  assert.deepEqual(c.state.project, saved);
  assert.equal(c.state.dirty, false);
  assert.equal(messages.at(-1), false);
  await c.redo();
  assert.equal(c.state.dirty, true);
  await c.save();
  await c.undo();
  assert.equal(c.state.dirty, true);
  await c.redo();
  assert.equal(c.state.dirty, false);
  assert.equal(messages.at(-1), false);
});

test('new and opened documents keep their own clean baseline after edit and undo', async () => {
  const { controller: c, api } = setup();
  assert.equal(c.state.dirty, false);
  await c.importMedia();
  await c.undo();
  assert.equal(c.state.project.clips.length, 0);
  assert.equal(c.state.dirty, false);
  const opened = core.appendSource(core.createProject({ name: '불러온 편집' }), source);
  api.openProject = async () => ({ project: opened, path: 'C:/out/opened.bedit' });
  await c.open();
  assert.equal(c.state.dirty, false);
  await c.edit('splitClip', c.state.selectedId, 12);
  await c.undo();
  assert.deepEqual(c.state.project, opened);
  assert.equal(c.state.dirty, false);
  assert.equal(c.state.path, 'C:/out/opened.bedit');
});

test('failed persistence retains the previous saved baseline and unsaved state', async () => {
  const { controller: c, api } = setup();
  await c.importMedia();
  await c.save();
  await c.update(project => ({ ...project, name: '아직 저장되지 않은 편집' }));
  api.saveProject = async () => { throw new Error('write failed'); };
  await assert.rejects(c.save(), /write failed/);
  assert.equal(c.state.dirty, true);
  await c.undo();
  assert.equal(c.state.dirty, false);
});

test('drawing edits during an asynchronous save remain dirty and undo returns to the snapshot actually saved', async () => {
  let release, received;
  const pendingWrite = new Promise(resolve => { release = resolve; });
  const { controller: c, drawing } = setup({ saveProject: async project => { received = project; return pendingWrite; } });
  let drawingValue = { drawingsV3: null, drawingLayersV1: null };
  drawing.loadClip = async clip => {
    drawingValue = structuredClone({ drawingsV3: clip?.drawingsV3 ?? null, drawingLayersV1: clip?.drawingLayersV1 ?? null });
  };
  drawing.snapshot = async () => structuredClone(drawingValue);
  await c.importMedia();
  const pending = c.save();
  await new Promise(resolve => setImmediate(resolve));
  drawingValue = {
    drawingsV3: {
      storageSchema: 'baeframe-fabric-scenes', storageVersion: '1.0.0',
      engine: 'fabric-7', documentId: 'controller-drawing', revision: 1, fps: 24, totalFrames: 240,
      keyframes: [{ id: 'frame-0', frame: 0, sourceWidth: 1920, sourceHeight: 1080, mutationSequence: 1,
        objects: [{ id: 'stroke-a', type: 'stroke', pathData: 'M 0 0 L 10 10 Z',
          sourcePoints: [{ x: 0, y: 0, pressure: 0.5, time: 0 }],
          style: { color: '#4a9eff', size: 7, opacity: 1 },
          transform: { left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false } }] }]
    },
    drawingLayersV1: null
  };
  c.recordDrawing({ ...drawingValue, clipId: c.state.selectedId });
  release({ path: 'C:/out/old-snapshot.bedit' });
  await pending;
  assert.equal(received.clips[0].drawingsV3, null);
  assert.equal(c.state.project.clips[0].drawingsV3.keyframes[0].objects.length, 1);
  assert.equal(c.state.dirty, true, 'the stroke added during saving was not persisted');
  await c.undo();
  assert.deepEqual(c.state.project, received);
  assert.equal(c.state.dirty, false, 'the successful save establishes its captured document as the baseline');
  await c.redo();
  assert.equal(c.state.dirty, true);
  await c.save();
  await c.undo();
  assert.equal(c.state.dirty, true);
  await c.redo();
  assert.equal(c.state.dirty, false, 'redo to the saved drawing contents is clean too');
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
  let projectSerializations = 0;
  const context = vm.createContext({ module: { exports: {} }, JSON: {
    parse: JSON.parse,
    stringify(value) {
      if (value?.type === 'baeframe-edit') projectSerializations += 1;
      return JSON.stringify(value);
    }
  } });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../renderer/scripts/editor/controller.js'), 'utf8'), context);
  const { controller: c, drawing } = setup({}, context.module.exports.createEditorController);
  await c.importMedia();
  await c.edit('splitClip', c.state.selectedId, 24);
  let snapshots = 0;
  const snapshot = drawing.snapshot;
  drawing.snapshot = async () => {
    snapshots += 1;
    return snapshot();
  };
  projectSerializations = 0;
  for (let frame = 1; frame < 24; frame += 1) {
    await c.seek(frame, { playback: true });
  }
  assert.equal(snapshots, 0, 'unchanged drawings must not be cloned each playback frame');
  assert.equal(projectSerializations, 0, 'dirty checks must not serialize the project drawing payload during playback');
  await c.seek(24, { playback: true });
  assert.equal(snapshots, 2, 'clip switch flushes the outgoing scene and captures the new baseline');
  await c.seek(25);
  assert.equal(snapshots, 3, 'manual seek still preserves pending brush changes');
});
