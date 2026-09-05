(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAEEditorPreview = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function clipStart(project, index) {
    return project.clips.slice(0, index).reduce((sum, clip) => sum + clip.durationFrames, 0);
  }

  function presentedFrame(project, clipIndex, mediaTime) {
    const clip = project.clips[clipIndex];
    const local = Math.max(0, Math.floor((mediaTime - clip.sourceStartSeconds) * project.fps + 1e-6));
    return clipStart(project, clipIndex) + local;
  }

  function frameTimecode(frame, fps) {
    const seconds = Math.floor(frame / fps);
    const subframe = frame - Math.ceil(seconds * fps - 1e-8);
    return [Math.floor(seconds / 60), seconds % 60, subframe]
      .map(value => String(value).padStart(2, '0')).join(':');
  }

  function layerKeyframes(keys, layerId, layers = {}) {
    const assignments = layers.assignments || {};
    return keys.map(key => {
      const objects = (key.objects || []).filter(object => {
        const owner = Object.hasOwn(assignments, object.id) ? assignments[object.id] : layers.baseLayerId;
        return owner === layerId;
      });
      return { ...key, objects, isEmpty: objects.length === 0 };
    });
  }

  /** Video owns its displayed time; only a frozen image needs an elapsed-time clock. */
  function createPreviewTransport(options) {
    const { core, video, getProject, getFrame, onFrame } = options;
    const now = options.now || (() => performance.now());
    const requestFrame = options.requestFrame || (callback => requestAnimationFrame(callback));
    const cancelFrame = options.cancelFrame || (id => cancelAnimationFrame(id));
    const onPlaying = options.onPlaying || (() => {});
    const onError = options.onError || (() => {});
    const onTime = options.onTime || (() => {});
    let running = false;
    let generation = 0;
    let clipGeneration = 0;
    let animation = null;
    let decoded = null;
    let active = null;
    let holdAnchor = 0;
    let draining = false;
    let pendingFrame = null;

    function cancelCallbacks() {
      if (animation !== null) cancelFrame(animation);
      if (decoded !== null) video.cancelVideoFrameCallback?.(decoded);
      animation = null;
      decoded = null;
    }

    function pause() {
      generation++;
      running = false;
      pendingFrame = null;
      cancelCallbacks();
      video.pause();
      onPlaying(false);
    }

    function failed(error, token) {
      if (token !== generation) return;
      pause();
      onError(error);
    }

    function valid(token, clipToken) {
      return running && token === generation && clipToken === clipGeneration;
    }

    function requestDecoded(token, clipToken) {
      if (!video.requestVideoFrameCallback || !valid(token, clipToken)) return;
      decoded = video.requestVideoFrameCallback((_time, metadata) => {
        decoded = null;
        if (!valid(token, clipToken)) return;
        requestDecoded(token, clipToken);
        queueFrame(presentedFrame(getProject(), active.clipIndex, metadata.mediaTime), token, clipToken);
      });
    }

    function scheduleAnimation(token, clipToken) {
      if (!valid(token, clipToken)) return;
      animation = requestFrame(timestamp => {
        animation = null;
        if (!valid(token, clipToken)) return;
        const project = getProject();
        const start = clipStart(project, active.clipIndex);
        const end = start + active.clip.durationFrames;
        if (active.clip.kind === 'freeze') {
          const local = Math.max(0, Math.floor((timestamp - holdAnchor) * project.fps / 1000 + 1e-6));
          onTime((start + local) / project.fps);
          queueFrame(start + local, token, clipToken);
        } else {
          onTime(start / project.fps + Math.max(0, video.currentTime - active.clip.sourceStartSeconds));
          if (video.ended || video.currentTime >= active.clip.sourceStartSeconds + active.clip.durationFrames / project.fps - 1e-6) {
            queueFrame(end, token, clipToken);
          } else if (!video.requestVideoFrameCallback) {
            queueFrame(presentedFrame(project, active.clipIndex, video.currentTime), token, clipToken);
          }
        }
        scheduleAnimation(token, clipToken);
      });
    }

    async function startActive(token) {
      active = core.resolveFrame(getProject(), getFrame());
      if (!active || token !== generation || !running) return;
      const clipToken = ++clipGeneration;
      pendingFrame = null;
      if (active.clip.kind === 'freeze') {
        video.pause();
        holdAnchor = now() - active.localFrame / getProject().fps * 1000;
      } else {
        requestDecoded(token, clipToken);
        await video.play();
      }
      if (valid(token, clipToken)) scheduleAnimation(token, clipToken);
    }

    async function transition(token, clipToken) {
      cancelCallbacks();
      video.pause();
      const project = getProject();
      const nextFrame = clipStart(project, active.clipIndex) + active.clip.durationFrames;
      const total = core.durationFrames(project);
      if (nextFrame >= total) {
        pause();
        await onFrame(total - 1, { prepare: true });
        return;
      }
      await onFrame(nextFrame, { prepare: true });
      if (valid(token, clipToken)) await startActive(token);
    }

    function queueFrame(frame, token, clipToken) {
      if (!valid(token, clipToken)) return;
      pendingFrame = Math.max(pendingFrame ?? frame, frame);
      if (draining) return;
      draining = true;
      void (async () => {
        while (pendingFrame !== null && valid(token, clipToken)) {
          const next = pendingFrame;
          pendingFrame = null;
          const end = clipStart(getProject(), active.clipIndex) + active.clip.durationFrames;
          if (next >= end) {
            await transition(token, clipToken);
            break;
          }
          // Decoder preroll and coalesced callbacks cannot move the output backwards.
          if (next > getFrame()) await onFrame(next, { prepare: false });
        }
      })().catch(error => failed(error, token)).finally(() => { draining = false; });
    }

    return {
      get playing() { return running; },
      async play() {
        if (running || !core.resolveFrame(getProject(), getFrame())) return;
        running = true;
        const token = ++generation;
        onPlaying(true);
        try { await startActive(token); } catch (error) { failed(error, token); }
      },
      pause,
      dispose: pause
    };
  }

  return { createPreviewTransport, presentedFrame, layerKeyframes, frameTimecode };
});
