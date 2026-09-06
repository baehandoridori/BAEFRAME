(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BAEEditorTimeline = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const duration = (clips) => clips.reduce((sum, clip) => sum + clip.durationFrames, 0);
  function fitScale(totalFrames, viewportWidth) {
    return Math.min(64, Math.max(1, viewportWidth) / Math.max(1, totalFrames));
  }
  function scaleLimits(totalFrames, viewportWidth) {
    return {
      min: fitScale(totalFrames, viewportWidth),
      max: Math.min(64, 16000000 / Math.max(1, totalFrames))
    };
  }
  function sliderScale(percent, min, max) {
    return min * Math.pow(max / min, clamp(percent, 0, 100) / 100);
  }
  function scaleSlider(scale, min, max) {
    return max <= min ? 0 : clamp((Math.log(scale / min) / Math.log(max / min)) * 100, 0, 100);
  }
  function zoomAt({ scale, nextScale, scrollLeft, anchorX, viewportWidth, totalFrames }) {
    const limits = scaleLimits(totalFrames, viewportWidth);
    const value = clamp(nextScale, limits.min, limits.max);
    const frame = (scrollLeft + anchorX) / scale;
    return {
      scale: value,
      scrollLeft: clamp(
        frame * value - anchorX,
        0,
        Math.max(0, totalFrames * value - viewportWidth)
      )
    };
  }
  function frameAtClientX(clientX, { left, labelWidth, scrollLeft, pxPerFrame, totalFrames }) {
    return clamp(
      Math.round((clientX - left - labelWidth + scrollLeft) / pxPerFrame),
      0,
      Math.max(0, totalFrames - 1)
    );
  }
  function rulerTicks({ fps, pxPerFrame, scrollLeft, viewportWidth, totalFrames }) {
    const steps = [
      ...new Set([
        1,
        2,
        5,
        10,
        15,
        20,
        ...[1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400].map(
          (seconds) => Math.round(seconds * fps)
        )
      ])
    ]
      .filter((step) => step > 0)
      .sort((a, b) => a - b);
    const majorStep = steps.find((step) => step * pxPerFrame >= 84) || steps.at(-1);
    const candidateMinor =
      majorStep % 5 === 0 ? majorStep / 5 : majorStep % 2 === 0 ? majorStep / 2 : 1;
    const minorStep = candidateMinor * pxPerFrame >= 8 ? candidateMinor : majorStep;
    const first = Math.max(0, Math.floor(scrollLeft / pxPerFrame / minorStep) * minorStep);
    const last = Math.min(
      totalFrames,
      Math.ceil((scrollLeft + viewportWidth) / pxPerFrame / minorStep) * minorStep
    );
    const ticks = [];
    for (let frame = first; frame <= last; frame += minorStep) {
      const major = frame % majorStep === 0;
      const seconds = Math.floor(frame / fps);
      const label =
        majorStep < fps
          ? `${frame}F`
          : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      ticks.push({ frame, px: frame * pxPerFrame, major, label: major ? label : '' });
    }
    return { majorStep, minorStep, ticks };
  }
  function razorTarget(clips, clipId, frame) {
    let start = 0;
    for (const clip of clips) {
      if (clip.id === clipId) {
        const localFrame = Math.round(frame) - start;
        return localFrame > 0 && localFrame < clip.durationFrames
          ? { clipId, localFrame, frame: start + localFrame }
          : null;
      }
      start += clip.durationFrames;
    }
    return null;
  }
  function insertionTarget(clips, clipId, frame) {
    let originalStart = 0;
    let index = 0;
    for (const clip of clips) {
      if (clip.id !== clipId) {
        if (frame < originalStart + clip.durationFrames / 2)
        {return { index, frame: originalStart, beforeId: clip.id };}
        index++;
      }
      originalStart += clip.durationFrames;
    }
    return { index, frame: duration(clips), beforeId: null };
  }
  function holdRanges(keys, durationFrames) {
    return keys
      .map((key, index) => {
        const start = clamp(key.frame, 0, durationFrames);
        const end = clamp(keys[index + 1]?.frame ?? durationFrames, start, durationFrames);
        return {
          start,
          end,
          duration: end - start,
          sourceFrame: key.sourceFrame ?? key.frame,
          empty: !!key.isEmpty,
          held: !!key.held
        };
      })
      .filter((range) => range.duration > 0);
  }
  function shortcutTool(event) {
    if (
      event.editable ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.isComposing ||
      event.repeat
    )
    {return null;}
    return (
      { v: 'select', c: 'razor', b: 'brush', e: 'eraser', h: 'hand' }[
        String(event.key).toLowerCase()
      ] || null
    );
  }
  function createLatestQueue(run, { start = async () => {}, finish = async () => {} } = {}) {
    let latest = null;
    let working = null;
    return {
      get hasPending() {
        return latest !== null;
      },
      request(value) {
        latest = value;
        if (working) return working;
        working = Promise.resolve()
          .then(async () => {
            do {
              try {
                await start();
                while (latest !== null) {
                  const next = latest;
                  latest = null;
                  await run(next, () => latest !== null);
                }
              } catch (error) {
                latest = null;
                throw error;
              } finally {
                await finish();
              }
            } while (latest !== null);
          })
          .finally(() => {
            working = null;
          });
        return working;
      }
    };
  }
  function zoomPreview({ zoom, nextZoom, panX, panY, anchorX, anchorY }) {
    const ratio = nextZoom / zoom;
    return {
      zoom: nextZoom,
      panX: anchorX - (anchorX - panX) * ratio,
      panY: anchorY - (anchorY - panY) * ratio
    };
  }
  function clampPan({ panX, panY, zoom, stageWidth, stageHeight, viewportWidth, viewportHeight }) {
    const limit = (size, view) => (size * zoom + view) / 2 - Math.min(size * zoom, view) / 4;
    return {
      panX: clamp(panX, -limit(stageWidth, viewportWidth), limit(stageWidth, viewportWidth)),
      panY: clamp(panY, -limit(stageHeight, viewportHeight), limit(stageHeight, viewportHeight))
    };
  }
  return {
    fitScale,
    scaleLimits,
    sliderScale,
    scaleSlider,
    zoomAt,
    frameAtClientX,
    rulerTicks,
    razorTarget,
    insertionTarget,
    holdRanges,
    shortcutTool,
    createLatestQueue,
    zoomPreview,
    clampPan
  };
});
