(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAEEditorController = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function createEditorController({ core, api, drawing, onChange = () => {} }) {
    let history = core.createHistory(core.createProject());
    const state = {
      project: history.present,
      frame: 0,
      selectedId: null,
      dirty: false,
      busy: false,
      path: null,
      revision: 0,
      message: ''
    };
    let savedRevision = 0;
    let tail = Promise.resolve();
    let drawingClipId = null;
    let drawingBaseline = '';
    let acceptDrawing = false;
    let cancelRequested = false;
    let pending = 0;
    let lastDirtyState = null;
    let lastDirtyRevision = -1;

    function emit() {
      state.dirty = state.revision !== savedRevision;
      state.canUndo = history.canUndo;
      state.canRedo = history.canRedo;
      if (state.dirty !== lastDirtyState || state.revision !== lastDirtyRevision) {
        api.setDirty?.(state.dirty);
        lastDirtyState = state.dirty;
        lastDirtyRevision = state.revision;
      }
      onChange(state);
    }
    function replaceProject(project, { commit = true } = {}) {
      core.validateProject(project);
      if (commit) history.commit(project);
      state.project = history.present;
      state.revision += 1;
      state.frame = Math.max(0, Math.min(state.frame, core.durationFrames(state.project) - 1));
      if (!state.project.clips.some((c) => c.id === state.selectedId)) {
        state.selectedId = core.resolveFrame(state.project, state.frame)?.clip.id ?? null;
      }
      emit();
    }
    function recordDrawing(snapshot) {
      if (!acceptDrawing || !snapshot || snapshot.clipId !== drawingClipId) return;
      const clip = state.project.clips.find((c) => c.id === snapshot.clipId);
      if (!clip) return;
      const fields = {
        drawingsV3: snapshot.drawingsV3 ?? null,
        drawingLayersV1: snapshot.drawingLayersV1 ?? null
      };
      const snapshotKey = JSON.stringify(fields);
      if (snapshotKey === drawingBaseline) return;
      if (
        JSON.stringify([clip.drawingsV3, clip.drawingLayersV1]) ===
        JSON.stringify([fields.drawingsV3, fields.drawingLayersV1])
      ) {
        return;
      }
      const next = clone(state.project);
      Object.assign(
        next.clips.find((c) => c.id === clip.id),
        fields
      );
      replaceProject(next);
      drawingBaseline = snapshotKey;
    }
    async function flushDrawing() {
      if (!drawingClipId) return;
      const id = drawingClipId;
      const snapshot = await drawing.snapshot();
      if (id === drawingClipId && snapshot) recordDrawing({ ...snapshot, clipId: id });
    }
    async function presentDrawing(force = false) {
      const resolved = core.resolveFrame(state.project, state.frame);
      if (!resolved) {
        acceptDrawing = false;
        drawingClipId = null;
        drawingBaseline = '';
        await drawing.setEnabled(false);
        await drawing.loadClip(null, state.project);
        return;
      }
      state.selectedId = resolved.clip.id;
      if (force || drawingClipId !== resolved.clip.id) {
        acceptDrawing = false;
        await drawing.setEnabled(false);
        await drawing.loadClip(resolved.clip, state.project);
        drawingClipId = resolved.clip.id;
        const baseline = await drawing.snapshot();
        drawingBaseline = JSON.stringify({
          drawingsV3: baseline?.drawingsV3 ?? null,
          drawingLayersV1: baseline?.drawingLayersV1 ?? null
        });
        acceptDrawing = true;
      }
      await drawing.seek(resolved.localFrame);
    }
    function run(operation) {
      pending += 1;
      state.busy = true;
      emit();
      const result = tail.then(operation);
      tail = result.catch(() => {});
      return result.finally(() => {
        pending -= 1;
        state.busy = pending > 0;
        emit();
      });
    }
    async function apply(project) {
      replaceProject(project);
      await presentDrawing(true);
    }
    const controller = {
      state,
      recordDrawing,
      seek(frame, { playback = false } = {}) {
        return run(async () => {
          const nextFrame = Math.max(
            0,
            Math.min(Math.floor(frame), core.durationFrames(state.project) - 1)
          );
          const nextClipId = core.resolveFrame(state.project, nextFrame)?.clip.id ?? null;
          // Playback disables painting; only manual seeks and clip switches need a capture.
          if (!playback || nextClipId !== drawingClipId) await flushDrawing();
          state.frame = nextFrame;
          await presentDrawing();
        });
      },
      selectClip(id) {
        let start = 0;
        for (const clip of state.project.clips) {
          if (clip.id === id) return controller.seek(start);
          start += clip.durationFrames;
        }
        return Promise.resolve();
      },
      edit(operation, ...args) {
        return run(async () => {
          await flushDrawing();
          if (
            !['splitClip', 'trimClip', 'moveClip', 'removeClip', 'insertHold'].includes(operation)
          ) {
            throw new Error('지원하지 않는 편집입니다.');
          }
          const resolved = core.resolveFrame(state.project, state.frame);
          const next = core[operation](state.project, ...args);
          if (
            (operation === 'moveClip' || operation === 'trimClip') &&
            resolved?.clip.id === args[0]
          ) {
            const index = next.clips.findIndex((c) => c.id === args[0]);
            if (index >= 0) {
              const start = next.clips
                .slice(0, index)
                .reduce((sum, clip) => sum + clip.durationFrames, 0);
              const local = resolved.localFrame - (operation === 'trimClip' ? args[1] : 0);
              state.frame =
                start + Math.max(0, Math.min(local, next.clips[index].durationFrames - 1));
            }
          }
          await apply(next);
        });
      },
      update(change) {
        return run(async () => {
          await flushDrawing();
          await apply(change(clone(state.project)));
        });
      },
      importMedia(kind = 'video') {
        return run(async () => {
          await flushDrawing();
          const result = await api.pickMedia(kind);
          if (result.cancelled || !result.sources?.length) return;
          let project = clone(state.project);
          if (kind === 'audio') {
            const source = result.sources[0];
            if (!project.sources.some((s) => s.id === source.id)) project.sources.push(source);
            project.music = { sourceId: source.id, volume: 0.5, offsetFrames: 0 };
          } else {
            for (const source of result.sources) project = core.appendSource(project, source);
          }
          await apply(project);
        });
      },
      open() {
        return run(async () => {
          await flushDrawing();
          const result = await api.openProject();
          if (result.cancelled) return;
          core.validateProject(result.project);
          history = core.createHistory(result.project);
          state.project = history.present;
          state.frame = 0;
          state.selectedId = null;
          state.revision += 1;
          savedRevision = state.revision;
          state.path = result.path;
          drawingClipId = null;
          await presentDrawing(true);
        });
      },
      save(saveAs = false) {
        return run(async () => {
          await flushDrawing();
          const revision = state.revision;
          const result = await api.saveProject(clone(state.project), saveAs);
          if (!result.cancelled) {
            state.path = result.path;
            if (state.revision === revision) savedRevision = revision;
          }
          return result;
        });
      },
      undo() {
        return run(async () => {
          await flushDrawing();
          if (!history.canUndo) return;
          history.undo();
          replaceProject(history.present, { commit: false });
          await presentDrawing(true);
        });
      },
      redo() {
        return run(async () => {
          if (!history.canRedo) return;
          history.redo();
          replaceProject(history.present, { commit: false });
          await presentDrawing(true);
        });
      },
      exportVideo() {
        cancelRequested = false;
        return run(async () => {
          await flushDrawing();
          await drawing.setEnabled(false);
          const project = clone(state.project);
          if (!project.clips.length) throw new Error('영상을 먼저 추가해주세요.');
          const overlays = [];
          for (const clip of project.clips) {
            if (cancelRequested) return { cancelled: true };
            overlays.push(
              ...(await drawing.exportOverlays(clip, project, {
                isCancelled: () => cancelRequested
              }))
            );
          }
          if (cancelRequested) return { cancelled: true };
          return api.exportVideo({ project, overlays });
        });
      },
      async cancelExport() {
        cancelRequested = true;
        return api.cancelExport();
      },
      drawingAction(action) {
        return run(async () => {
          await drawing.setEnabled(true);
          await drawing.action(action);
          await flushDrawing();
        });
      },
      layerAction(action, ...args) {
        return run(async () => {
          if (!['addLayer', 'setActiveLayer', 'toggleLayer'].includes(action)) return;
          await drawing[action](...args);
          await flushDrawing();
        });
      }
    };
    emit();
    return controller;
  }
  return { createEditorController };
});
