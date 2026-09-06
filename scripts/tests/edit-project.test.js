'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../../shared/edit-project.js');

function source(overrides = {}) {
  return {
    id: 'source-a', path: 'C:/영상/첫 번째.mp4', name: '첫 번째.mp4',
    durationSeconds: 2, width: 1920, height: 1080, fps: 30, hasAudio: true,
    ...overrides
  };
}

function projectWithClip(overrides = {}) {
  return core.appendSource(core.createProject(), source(overrides));
}

function stroke(id = 'stroke-a') {
  return {
    id, type: 'stroke', pathData: 'M 0 0 L 10 10 Z',
    sourcePoints: [{ x: 0, y: 0, pressure: 0.5, time: 0 }],
    style: { color: '#ff4757', size: 7, opacity: 1 },
    transform: {
      left: 0, top: 0, scaleX: 1, scaleY: 1, angle: 0,
      skewX: 0, skewY: 0, flipX: false, flipY: false
    }
  };
}

function drawings() {
  return {
    storageSchema: 'baeframe-fabric-scenes', storageVersion: '1.0.0',
    engine: 'fabric-7', documentId: 'drawing-document', revision: 4,
    fps: 24, totalFrames: 48,
    keyframes: [
      { id: 'key-a', frame: 0, sourceWidth: 1920, sourceHeight: 1080,
        mutationSequence: 1, objects: [stroke()] },
      { id: 'key-blank', frame: 30, sourceWidth: 1920, sourceHeight: 1080,
        mutationSequence: 2, objects: [] }
    ]
  };
}

function drawnProject() {
  const project = projectWithClip();
  project.clips[0].drawingsV3 = drawings();
  project.clips[0].drawingLayersV1 = {
    version: 1,
    layers: [{ id: 'layer-a', name: '그림 1', color: '#ff4757', visible: true, locked: false }],
    activeLayerId: 'layer-a', baseLayerId: 'layer-a', assignments: { 'stroke-a': 'layer-a' }
  };
  return project;
}

test('new projects are independent valid empty editing documents', () => {
  const first = core.createProject();
  const second = core.createProject();
  assert.equal(core.validateProject(first), true);
  assert.deepEqual(first, {
    type: 'baeframe-edit', schemaVersion: 1, name: '새 편집', fps: 24,
    width: 1920, height: 1080, sources: [], clips: [], music: null
  });
  first.sources.push(source());
  assert.deepEqual(second.sources, []);
  assert.equal(core.durationFrames(second), 0);
  assert.equal(core.resolveFrame(second, 0), null);
});

test('the same module executes in a browser without Node globals', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../shared/edit-project.js'), 'utf8'), context);
  const browser = context.window.BAEEditProject;
  const project = browser.appendSource(browser.createProject(), source());
  assert.equal(browser.durationFrames(project), 48);
  assert.equal(browser.resolveFrame(project, 24).sourceTime, 1);
});

test('mixed source fps never changes the output clock and boundaries select the next clip', () => {
  let project = projectWithClip({ durationSeconds: 1, fps: 30 });
  project = core.appendSource(project, source({ id: 'source-b', fps: 60, durationSeconds: 2 }));
  project = core.trimClip(project, project.clips[1].id, 12, 0);
  assert.equal(core.durationFrames(project), 60);
  assert.equal(core.resolveFrame(project, 23).sourceTime, 23 / 24);
  const boundary = core.resolveFrame(project, 24);
  assert.equal(boundary.clipIndex, 1);
  assert.equal(boundary.source.id, 'source-b');
  assert.equal(boundary.localFrame, 0);
  assert.equal(boundary.drawingFrame, 12);
  assert.equal(boundary.sourceTime, 0.5);
  assert.equal(boundary.outputFrame, 24);
  assert.equal(core.resolveFrame(project, 36).sourceTime, 1);
  assert.equal(core.resolveFrame(project, 60), null);
});

test('fractional source duration uses complete output frames without drifting beyond the media', () => {
  const project = projectWithClip({ durationSeconds: 1001 / 1000, fps: 30000 / 1001 });
  assert.equal(core.durationFrames(project), 24);
  assert.equal(core.resolveFrame(project, 23).sourceTime, 23 / 24);
  assert.throws(() => projectWithClip({ durationSeconds: 0.01 }));
});

test('split keeps held drawings before the cut and makes all resulting snapshots independent', () => {
  const original = drawnProject();
  const firstId = original.clips[0].id;
  const split = core.splitClip(original, firstId, 12);
  assert.deepEqual(split.clips.map(clip => clip.durationFrames), [12, 36]);
  assert.equal(split.clips[0].id, firstId);
  assert.notEqual(split.clips[1].id, firstId);
  assert.equal(split.clips[1].sourceStartSeconds, 0.5);
  assert.equal(split.clips[1].drawingOffsetFrames, 12);
  assert.equal(core.resolveFrame(split, 12).drawingFrame, 12);
  assert.deepEqual(split.clips[1].drawingsV3, original.clips[0].drawingsV3);
  split.clips[1].drawingsV3.keyframes[0].objects[0].style.color = '#000000';
  split.clips[1].drawingLayersV1.layers[0].visible = false;
  split.sources[0].name = 'different';
  assert.equal(split.clips[0].drawingsV3.keyframes[0].objects[0].style.color, '#ff4757');
  assert.equal(original.clips[0].drawingsV3.keyframes[0].objects[0].style.color, '#ff4757');
  assert.equal(original.clips[0].drawingLayersV1.layers[0].visible, true);
  assert.equal(original.sources[0].name, '첫 번째.mp4');
});

test('trim retains hidden drawings outside the visible range and advances both clocks', () => {
  const original = drawnProject();
  const trimmed = core.trimClip(original, original.clips[0].id, 12, 12);
  assert.equal(trimmed.clips[0].durationFrames, 24);
  assert.equal(trimmed.clips[0].sourceStartSeconds, 0.5);
  assert.equal(trimmed.clips[0].drawingOffsetFrames, 12);
  assert.deepEqual(trimmed.clips[0].drawingsV3, original.clips[0].drawingsV3);
  assert.equal(core.resolveFrame(trimmed, 23).drawingFrame, 35);
  assert.equal(core.durationFrames(original), 48);
});

test('moving and removing clips reorder the reel without deleting original source records', () => {
  let original = projectWithClip();
  original = core.appendSource(original, source({ id: 'source-b', durationSeconds: 1 }));
  const moved = core.moveClip(original, original.clips[0].id, 1);
  assert.deepEqual(moved.clips.map(clip => clip.sourceId), ['source-b', 'source-a']);
  assert.deepEqual(original.clips.map(clip => clip.sourceId), ['source-a', 'source-b']);
  const removed = core.removeClip(moved, moved.clips[0].id);
  assert.equal(core.durationFrames(removed), 48);
  assert.equal(removed.sources.length, 2);
});

test('hold insertion freezes the selected source image, holds the current drawing, and extends duration', () => {
  const original = drawnProject();
  const held = core.insertHold(original, original.clips[0].id, 12, 24);
  assert.deepEqual(held.clips.map(clip => clip.durationFrames), [12, 24, 36]);
  assert.equal(core.durationFrames(held), 72);
  const freeze = held.clips[1];
  assert.equal(freeze.kind, 'freeze');
  assert.equal(freeze.volume, 0);
  assert.equal(freeze.drawingOffsetFrames, 0);
  assert.equal(core.resolveFrame(held, 12).sourceTime, 0.5);
  assert.equal(core.resolveFrame(held, 35).sourceTime, 0.5);
  assert.equal(core.resolveFrame(held, 36).sourceTime, 0.5);
  assert.equal(held.clips[2].drawingOffsetFrames, 12);
  assert.equal(freeze.drawingsV3.totalFrames, 24);
  assert.equal(freeze.drawingsV3.keyframes.length, 1);
  assert.equal(freeze.drawingsV3.keyframes[0].frame, 0);
  assert.equal(freeze.drawingsV3.keyframes[0].objects[0].id, 'stroke-a');
  assert.notEqual(freeze.drawingsV3.documentId, original.clips[0].drawingsV3.documentId);
  freeze.drawingsV3.keyframes[0].objects[0].style.size = 15;
  assert.equal(held.clips[2].drawingsV3.keyframes[0].objects[0].style.size, 7);
});

test('replacement consumes the requested range and resumes at its end without changing reel duration', () => {
  const original = drawnProject();
  const result = core.insertHold(original, original.clips[0].id, 12, 24, true);
  assert.deepEqual(result.clips.map(clip => clip.durationFrames), [12, 24, 12]);
  assert.equal(core.durationFrames(result), 48);
  assert.equal(core.resolveFrame(result, 35).sourceTime, 0.5);
  assert.equal(core.resolveFrame(result, 36).sourceTime, 1.5);
  assert.equal(core.resolveFrame(result, 36).drawingFrame, 36);
  assert.throws(() => core.insertHold(original, original.clips[0].id, 40, 12, true));
});

test('holds at the first frame and full-clip replacement never create empty clips', () => {
  const original = projectWithClip();
  const inserted = core.insertHold(original, original.clips[0].id, 0, 24);
  assert.deepEqual(inserted.clips.map(clip => clip.durationFrames), [24, 48]);
  const replaced = core.insertHold(original, original.clips[0].id, 0, 48, true);
  assert.equal(replaced.clips.length, 1);
  assert.equal(replaced.clips[0].kind, 'freeze');
  assert.equal(replaced.clips[0].id, original.clips[0].id);
});

test('holding a blank exposure remains blank rather than resurrecting earlier drawings', () => {
  const original = drawnProject();
  const held = core.insertHold(original, original.clips[0].id, 35, 12);
  assert.deepEqual(held.clips[1].drawingsV3.keyframes[0].objects, []);
});

test('split and trim of a freeze clip keep source time fixed but advance editable drawing time', () => {
  const original = drawnProject();
  let result = core.insertHold(original, original.clips[0].id, 12, 24);
  const freezeId = result.clips[1].id;
  result = core.splitClip(result, freezeId, 12);
  assert.equal(result.clips[2].sourceStartSeconds, 0.5);
  assert.equal(result.clips[2].drawingOffsetFrames, 12);
  result = core.trimClip(result, result.clips[2].id, 3, 2);
  assert.equal(result.clips[2].sourceStartSeconds, 0.5);
  assert.equal(result.clips[2].drawingOffsetFrames, 15);
  assert.equal(result.clips[2].durationFrames, 7);
});

test('history snapshots cannot be changed through present, incoming commits, undo, or redo results', () => {
  const original = drawnProject();
  const history = core.createHistory(original);
  original.name = 'mutated original';
  history.present.clips[0].drawingsV3.keyframes[0].objects.length = 0;
  assert.equal(history.present.name, '새 편집');
  assert.equal(history.present.clips[0].drawingsV3.keyframes[0].objects.length, 1);
  const next = core.trimClip(history.present, history.present.clips[0].id, 12, 0);
  history.commit(next);
  next.name = 'mutated commit';
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  const undone = history.undo();
  assert.equal(core.durationFrames(undone), 48);
  undone.name = 'mutated return';
  assert.equal(history.present.name, '새 편집');
  assert.equal(history.canRedo, true);
  assert.equal(core.durationFrames(history.redo()), 36);
  history.undo();
  const branch = history.present;
  branch.name = 'new branch';
  history.commit(branch);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo().name, 'new branch');
});

test('history bounds old snapshots and does not add a no-op or invalid commit', () => {
  const history = core.createHistory(core.createProject());
  history.commit(history.present);
  assert.equal(history.canUndo, false);
  assert.throws(() => history.commit({ type: 'invalid' }));
  assert.equal(history.canUndo, false);
  for (let i = 1; i <= 150; i++) {
    const next = history.present;
    next.name = `Revision ${i}`;
    history.commit(next);
  }
  let undoCount = 0;
  while (history.canUndo) { history.undo(); undoCount++; }
  assert.ok(undoCount > 0 && undoCount <= 100);
  assert.ok(history.present.name !== '새 편집');
});

test('music sources and browser preview paths survive independent project copies', () => {
  const project = projectWithClip({ previewPath: 'C:/preview/영상 preview.mp4' });
  project.sources.push(source({ id: 'music', path: 'C:/음악/music.wav', width: 0, height: 0, fps: 0 }));
  project.music = { sourceId: 'music', volume: 0.5, offsetFrames: 12 };
  assert.equal(core.validateProject(project), true);
  const next = core.moveClip(project, project.clips[0].id, 0);
  next.music.volume = 0;
  assert.equal(project.music.volume, 0.5);
  assert.equal(next.sources[0].previewPath, 'C:/preview/영상 preview.mp4');
  assert.throws(() => core.appendSource(project, project.sources[1]));
});

const invalidProjects = [
  ['wrong schema', project => { project.schemaVersion = 2; }],
  ['unexpected project field', project => { project.shell = true; }],
  ['negative fps', project => { project.fps = -1; }],
  ['NaN fps', project => { project.fps = NaN; }],
  ['infinite fps', project => { project.fps = Infinity; }],
  ['oversize output', project => { project.width = 999999; }],
  ['odd output dimension', project => { project.width = 1919; }],
  ['negative source duration', project => { project.sources[0].durationSeconds = -1; }],
  ['media exceeds 24 hours', project => { project.sources[0].durationSeconds = 1e9; }],
  ['duplicate source identity', project => { project.sources.push({ ...project.sources[0] }); }],
  ['unknown source identity', project => { project.clips[0].sourceId = 'missing'; }],
  ['duplicate clip identity', project => { project.clips.push({ ...project.clips[0] }); }],
  ['source audio flag is not boolean', project => { project.sources[0].hasAudio = 'true'; }],
  ['zero clip duration', project => { project.clips[0].durationFrames = 0; }],
  ['fractional clip duration', project => { project.clips[0].durationFrames = 1.5; }],
  ['overflow clip duration', project => { project.clips[0].durationFrames = Number.MAX_SAFE_INTEGER + 1; }],
  ['clip exceeds source duration', project => { project.clips[0].sourceStartSeconds = 0.5; }],
  ['negative drawing offset', project => { project.clips[0].drawingOffsetFrames = -1; }],
  ['drawing range overflow', project => { project.clips[0].drawingOffsetFrames = Number.MAX_SAFE_INTEGER; }],
  ['unknown clip kind', project => { project.clips[0].kind = 'command'; }],
  ['invalid fit', project => { project.clips[0].fit = 'stretch'; }],
  ['negative volume', project => { project.clips[0].volume = -0.1; }],
  ['sparse clips', project => { project.clips = new Array(1); }],
  ['missing music source', project => { project.music = { sourceId: 'missing', volume: 1, offsetFrames: 0 }; }],
  ['music delay overflow', project => { project.music = { sourceId: 'source-a', volume: 1, offsetFrames: Number.MAX_SAFE_INTEGER }; }],
  ['NUL file path', project => { project.sources[0].path = 'C:/bad\u0000.mp4'; }],
  ['cyclic payload', project => { project.clips[0].drawingsV3 = project; }],
  ['drawing is not a canonical V3 document', project => { project.clips[0].drawingsV3 = { keyframes: [] }; }],
  ['drawings contain unknown stroke fields', project => {
    project.clips[0].drawingsV3 = drawings();
    project.clips[0].drawingsV3.keyframes[0].objects[0].layerId = 'forbidden';
  }],
  ['nonmonotonic drawing keyframes', project => {
    project.clips[0].drawingsV3 = drawings();
    project.clips[0].drawingsV3.keyframes.reverse();
  }],
  ['nonfinite drawing coordinate', project => {
    project.clips[0].drawingsV3 = drawings();
    project.clips[0].drawingsV3.keyframes[0].objects[0].sourcePoints[0].x = Infinity;
  }],
  ['unknown layer version', project => { project.clips[0].drawingLayersV1 = { version: 99 }; }],
  ['too many clips', project => {
    project.clips = Array.from({ length: 10001 }, (_, i) => ({ ...project.clips[0], id: `clip-${i}` }));
  }]
];

for (const [name, makeInvalid] of invalidProjects) {
  test(`validation rejects ${name}`, () => {
    const project = projectWithClip();
    makeInvalid(project);
    assert.throws(() => core.validateProject(project));
  });
}

test('editing rejects invalid frame positions, edge-consuming trims, and missing clip identities', () => {
  const project = projectWithClip();
  const id = project.clips[0].id;
  for (const frame of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => core.resolveFrame(project, frame));
    assert.throws(() => core.splitClip(project, id, frame));
    assert.throws(() => core.insertHold(project, id, frame, 12));
  }
  for (const frame of [0, 48]) assert.throws(() => core.splitClip(project, id, frame));
  assert.throws(() => core.trimClip(project, id, 24, 24));
  assert.throws(() => core.trimClip(project, id, -1, 0));
  assert.throws(() => core.trimClip(project, id, 0, NaN));
  assert.throws(() => core.insertHold(project, id, 48, 12));
  assert.throws(() => core.insertHold(project, id, 12, 0));
  assert.throws(() => core.insertHold(project, id, 12, 1.5));
  assert.throws(() => core.insertHold(project, id, 12, 12, 'replace'));
  assert.throws(() => core.moveClip(project, id, 1));
  assert.throws(() => core.removeClip(project, 'missing'));
  assert.throws(() => core.splitClip(project, 'missing', 1));
});

test('malformed inputs cannot execute accessor properties during validation or cloning', () => {
  const project = projectWithClip();
  let calls = 0;
  Object.defineProperty(project, 'name', { enumerable: true, get() { calls++; return 'bad'; } });
  assert.throws(() => core.validateProject(project));
  assert.equal(calls, 0);
});

test('custom inherited serialization cannot execute during project creation', () => {
  let calls = 0;
  const prototype = Object.create(null);
  prototype.toJSON = () => { calls++; return {}; };
  const options = Object.create(prototype);
  assert.throws(() => core.createProject(options));
  assert.equal(calls, 0);
});

test('mirrored canonical V3 strokes survive split and hold and load in the existing persistence store', async () => {
  const { createFabricDrawingPersistenceStore } = await import('../../renderer/scripts/modules/fabric-drawing-persistence-store.js');
  const project = drawnProject();
  project.clips[0].drawingsV3.keyframes[0].objects[0].transform.scaleX = -1;
  project.clips[0].drawingsV3.keyframes[0].objects[0].style.color = '#FF4757';
  assert.equal(core.validateProject(project), true);
  const held = core.insertHold(project, project.clips[0].id, 12, 24);
  const freeze = held.clips[1];
  const store = createFabricDrawingPersistenceStore();
  const imported = store.importRootValue(freeze.drawingsV3, {
    documentId: freeze.drawingsV3.documentId, fps: 24, totalFrames: 24
  });
  assert.equal(imported.accepted, true);
  assert.equal(store.resolveSourceFrameAtFrame(23), 0);
  assert.equal(store.exportRootValue().keyframes[0].objects[0].transform.scaleX, -1);
});

test('music offset is an output timeline delay independent of the source audio duration', () => {
  const project = projectWithClip();
  project.music = { sourceId: 'source-a', volume: 0.5, offsetFrames: 1000 };
  assert.equal(core.validateProject(project), true);
  const history = core.createHistory(project);
  assert.equal(history.present.music.offsetFrames, 1000);
});

test('V3 pointer types accepted by core are accepted by the actual persistence store', async () => {
  const { createFabricDrawingPersistenceStore } = await import('../../renderer/scripts/modules/fabric-drawing-persistence-store.js');
  const project = drawnProject();
  project.clips[0].drawingsV3.keyframes[0].objects[0].sourcePoints[0].pointerType = 'unknown';
  const store = createFabricDrawingPersistenceStore();
  assert.equal(store.importRootValue(project.clips[0].drawingsV3, {
    documentId: 'drawing-document', fps: 24, totalFrames: 48
  }).accepted, false);
  assert.throws(() => core.validateProject(project));
});

test('V3 render geometry validation agrees with the existing persistence engine', async () => {
  const { createFabricDrawingPersistenceStore } = await import('../../renderer/scripts/modules/fabric-drawing-persistence-store.js');
  const cases = [
    ['M 0 0 L 10 0 L 0 10 Z', true],
    ['M 0 0 L 10 0 L 0 10', false],
    ['M 0 0 L 10 10 L 0 10 L 10 0 Z', false],
    ['M 0 0 L 10 10 L 0 10 L 10 0 L 5 -5 Z', false],
    ['M 0 0 L 10 0 L 0 10 Z M 0 0 L 10 0 L 0 10 Z', false],
    ['M 0 0 L 1e20 0 L 0 10 Z', false],
    ['not a path', false]
  ];
  for (const [pathData, accepted] of cases) {
    const project = drawnProject();
    project.clips[0].drawingsV3.keyframes[0].objects[0].renderGeometry = {
      version: 1, fillRule: 'evenodd', pathData
    };
    const store = createFabricDrawingPersistenceStore();
    assert.equal(store.importRootValue(project.clips[0].drawingsV3, {
      documentId: 'drawing-document', fps: 24, totalFrames: 48
    }).accepted, accepted, pathData);
    if (accepted) assert.equal(core.validateProject(project), true);
    else assert.throws(() => core.validateProject(project), pathData);
  }
});

test('source re-use accepts equivalent metadata regardless of property insertion order', () => {
  const first = projectWithClip();
  const reordered = Object.fromEntries(Object.entries(first.sources[0]).reverse());
  const second = core.appendSource(first, reordered);
  assert.equal(second.sources.length, 1);
  assert.equal(second.clips.length, 2);
  assert.equal(core.durationFrames(second), 96);
  assert.throws(() => core.appendSource(first, { ...reordered, path: 'C:/different.mp4' }));
});

test('prototype-like object IDs retain their own layer assignments through edits and history', () => {
  const project = drawnProject();
  project.clips[0].drawingsV3.keyframes[0].objects[0].id = '__proto__';
  project.clips[0].drawingLayersV1.assignments = JSON.parse('{"__proto__":"layer-a"}');
  const split = core.splitClip(project, project.clips[0].id, 12);
  const history = core.createHistory(split);
  const assignments = history.present.clips[1].drawingLayersV1.assignments;
  assert.equal(Object.hasOwn(assignments, '__proto__'), true);
  assert.equal(assignments.__proto__, 'layer-a');
  assert.equal(Object.getPrototypeOf(assignments), Object.prototype);
});
