const SCENE_LABEL_PATTERN = /^(?:a|sc)(\d{3})$/i;

function parseNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getRangeFrameCount(startFrame, endFrame) {
  return Math.max(0, endFrame - startFrame + 1);
}

function getCutRangeFrameCount(cut) {
  const startFrame = Number(cut.startFrame);
  const endFrame = Number(cut.endFrame);
  if (Number.isFinite(startFrame) && Number.isFinite(endFrame)) {
    return getRangeFrameCount(startFrame, endFrame);
  }

  const mohoStartFrame = Number(cut.mohoStartFrame);
  const mohoEndFrame = Number(cut.mohoEndFrame);
  if (Number.isFinite(mohoStartFrame) && Number.isFinite(mohoEndFrame)) {
    return getRangeFrameCount(mohoStartFrame, mohoEndFrame);
  }

  return 0;
}

function compareCutsBySceneNumber(a, b) {
  const sceneDiff = Number(a.sceneNumber) - Number(b.sceneNumber);
  if (sceneDiff !== 0) return sceneDiff;
  return Number(a.startFrame) - Number(b.startFrame);
}

export function parseMohoSceneInfo(infoText = '') {
  const text = String(infoText || '');
  const fpsMatch = text.match(/^FPS:\s*([0-9]+(?:\.[0-9]+)?)/im);
  const projectPathMatch = text.match(/^Project Path:\s*(.+)$/im);
  const fps = fpsMatch ? parseNumber(fpsMatch[1], 24) : 24;
  const projectPath = projectPathMatch ? projectPathMatch[1].trim() : '';
  const lines = text.split(/\r?\n/);
  const entries = [];
  let currentEntry = null;

  for (const line of lines) {
    const labelMatch = line.match(/^\s*(\d+)\.\s*(.+?)\s*$/);
    if (labelMatch) {
      if (currentEntry) entries.push(currentEntry);
      currentEntry = {
        index: parseNumber(labelMatch[1]),
        label: labelMatch[2].trim(),
        mohoStartFrame: null,
        mohoEndFrame: null,
        frameCount: null
      };
      continue;
    }

    if (!currentEntry) continue;

    const rangeMatch = line.match(/^\s*Range:\s*(\d+)\s*-\s*(\d+)/i);
    if (rangeMatch) {
      currentEntry.mohoStartFrame = parseNumber(rangeMatch[1]);
      currentEntry.mohoEndFrame = parseNumber(rangeMatch[2]);
      currentEntry.frameCount = getRangeFrameCount(currentEntry.mohoStartFrame, currentEntry.mohoEndFrame);
      continue;
    }

    const framesMatch = line.match(/^\s*Frames:\s*(\d+)f/i);
    if (framesMatch) {
      currentEntry.frameCount = parseNumber(framesMatch[1]);
    }
  }

  if (currentEntry) entries.push(currentEntry);

  return {
    fps,
    projectPath,
    entries
  };
}

export function mergeDuplicateSceneCuts(cuts = []) {
  const bestCutsByScene = new Map();
  const ignored = [];

  for (const cut of cuts) {
    const sceneNumber = Number(cut.sceneNumber);
    const current = bestCutsByScene.get(sceneNumber);

    if (!current) {
      bestCutsByScene.set(sceneNumber, cut);
      continue;
    }

    const currentFrameCount = getCutRangeFrameCount(current);
    const nextFrameCount = getCutRangeFrameCount(cut);
    if (nextFrameCount > currentFrameCount) {
      ignored.push({ ...current, reason: 'duplicate-shorter-scene' });
      bestCutsByScene.set(sceneNumber, cut);
    } else {
      ignored.push({ ...cut, reason: 'duplicate-shorter-scene' });
    }
  }

  return {
    cuts: Array.from(bestCutsByScene.values()).sort(compareCutsBySceneNumber),
    ignored
  };
}

export function buildCutsFromMohoSceneInfo(infoText = '', options = {}) {
  const parsed = parseMohoSceneInfo(infoText);
  const sourceId = options.sourceId || 'source';
  const rawCuts = [];
  const ignored = [];

  parsed.entries.forEach(entry => {
    const labelMatch = entry.label.match(SCENE_LABEL_PATTERN);
    if (!labelMatch) {
      ignored.push({ ...entry, reason: 'scene-label-not-numbered' });
      return;
    }

    const mohoStartFrame = Number(entry.mohoStartFrame);
    const mohoEndFrame = Number(entry.mohoEndFrame);
    if (!Number.isFinite(mohoStartFrame) || !Number.isFinite(mohoEndFrame)) {
      ignored.push({ ...entry, reason: 'scene-range-missing' });
      return;
    }

    const sceneNumber = parseNumber(labelMatch[1]);
    const startFrame = mohoStartFrame - 1;
    const endFrame = mohoEndFrame - 1;
    rawCuts.push({
      id: `${sourceId}_${sceneNumber}_${startFrame}_${endFrame}`,
      sourceId,
      sceneNumber,
      label: entry.label,
      startFrame,
      endFrame,
      mohoStartFrame,
      mohoEndFrame,
      frameCount: Number.isFinite(Number(entry.frameCount))
        ? Number(entry.frameCount)
        : getRangeFrameCount(mohoStartFrame, mohoEndFrame),
      fps: parsed.fps,
      order: 0,
      ignored: false
    });
  });

  const merged = mergeDuplicateSceneCuts(rawCuts);
  const cuts = merged.cuts.map((cut, order) => ({ ...cut, order }));

  return {
    ...parsed,
    cuts,
    ignored: [...ignored, ...merged.ignored]
  };
}
