function getValidFps(value) {
  const fps = Number(value);
  return Number.isFinite(fps) && fps > 0 ? fps : 24;
}

function getFrameNumber(value, fallback = 0) {
  const frame = Number(value);
  return Number.isFinite(frame) ? frame : fallback;
}

function getSceneNumber(value) {
  const sceneNumber = Number(value);
  return Number.isFinite(sceneNumber) ? sceneNumber : Number.POSITIVE_INFINITY;
}

function compareCuts(a, b) {
  const sceneDiff = getSceneNumber(a?.sceneNumber) - getSceneNumber(b?.sceneNumber);
  if (sceneDiff !== 0) return sceneDiff;

  const labelDiff = String(a?.label || '').localeCompare(String(b?.label || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
  if (labelDiff !== 0) return labelDiff;

  return String(a?.id || '').localeCompare(String(b?.id || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function buildMissingLabel(previousCut, sceneNumber) {
  const label = String(previousCut?.label || '');
  const match = label.match(/^([a-zA-Z]+)\s*(\d+)/);
  const prefix = match?.[1] || 'a';
  const width = match?.[2]?.length || 3;
  return `${prefix}${String(sceneNumber).padStart(width, '0')} 없음`;
}

export function getCutFrameCount(cut) {
  const startFrame = Number(cut?.startFrame);
  const endFrame = Number(cut?.endFrame);
  if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) return 0;
  return Math.max(0, endFrame - startFrame + 1);
}

export function sortCutsBySceneNumber(cuts = []) {
  return [...(cuts || [])].sort(compareCuts);
}

export function applyManualCutOrder(cuts = [], manualOrder = []) {
  const cutsById = new Map((cuts || []).map(cut => [cut.id, cut]));
  const usedIds = new Set();
  const ordered = [];

  for (const id of manualOrder || []) {
    if (!cutsById.has(id) || usedIds.has(id)) continue;
    ordered.push(cutsById.get(id));
    usedIds.add(id);
  }

  const remaining = (cuts || []).filter(cut => !usedIds.has(cut.id));
  return [...ordered, ...sortCutsBySceneNumber(remaining)];
}

export function buildMissingSceneRows(cuts = [], options = {}) {
  const orderedCuts = cuts || [];
  if (options.showMissingScenes !== true) return [...orderedCuts];

  const rows = [];
  for (let index = 0; index < orderedCuts.length; index++) {
    const cut = orderedCuts[index];
    const previousCut = orderedCuts[index - 1];
    const previousScene = getSceneNumber(previousCut?.sceneNumber);
    const currentScene = getSceneNumber(cut?.sceneNumber);

    if (index > 0 && Number.isFinite(previousScene) && Number.isFinite(currentScene)) {
      for (let sceneNumber = previousScene + 1; sceneNumber < currentScene; sceneNumber++) {
        rows.push({
          id: `missing_${sceneNumber}`,
          sceneNumber,
          label: buildMissingLabel(previousCut, sceneNumber),
          missing: true
        });
      }
    }

    rows.push(cut);
  }

  return rows;
}

export function buildCutlistTimeline(cuts = []) {
  const segments = [];
  let frameCursor = 0;
  let timeCursor = 0;

  for (const [index, cut] of (cuts || []).entries()) {
    const frameCount = getCutFrameCount(cut);
    const fps = getValidFps(cut?.fps);
    const duration = frameCount / fps;
    const globalStartFrame = frameCursor;
    const globalEndFrame = frameCount > 0 ? frameCursor + frameCount - 1 : frameCursor - 1;
    const globalStartTime = timeCursor;
    const globalEndTime = timeCursor + duration;

    segments.push({
      cutId: cut.id,
      sourceId: cut.sourceId,
      index,
      cut,
      label: cut.label,
      sceneNumber: cut.sceneNumber,
      fps,
      frameCount,
      duration,
      globalStartFrame,
      globalEndFrame,
      globalStartTime,
      globalEndTime,
      sourceStartFrame: getFrameNumber(cut.startFrame),
      sourceEndFrame: getFrameNumber(cut.endFrame)
    });

    frameCursor += frameCount;
    timeCursor += duration;
  }

  return {
    segments,
    totalFrames: frameCursor,
    totalDuration: timeCursor
  };
}

export function mapGlobalTimeToCut(segments = [], globalTime = 0) {
  if (!segments || segments.length === 0) return null;

  const time = Math.max(0, Number(globalTime) || 0);
  const segment = segments.find(item => time >= item.globalStartTime && time < item.globalEndTime)
    || segments[segments.length - 1];
  const frameCount = Math.max(0, Number(segment.frameCount) || 0);
  const fps = getValidFps(segment.fps);
  const rawLocalFrame = Math.floor(Math.max(0, time - segment.globalStartTime) * fps);
  const maxLocalFrame = Math.max(0, frameCount - 1);
  const localFrame = Math.min(rawLocalFrame, maxLocalFrame);
  const sourceFrame = Math.min(
    getFrameNumber(segment.sourceStartFrame) + localFrame,
    getFrameNumber(segment.sourceEndFrame, getFrameNumber(segment.sourceStartFrame) + localFrame)
  );

  return {
    segment,
    localFrame,
    sourceFrame,
    localTime: localFrame / fps,
    sourceTime: sourceFrame / fps
  };
}

export function mapCutFrameToSourceTime(cut, localFrame = 0) {
  const fps = getValidFps(cut?.fps);
  return (getFrameNumber(cut?.startFrame) + getFrameNumber(localFrame)) / fps;
}

export function findCurrentCut(cuts = [], position = {}) {
  const sourceId = position.sourceId;
  const frame = Number(position.frame);
  if (!sourceId || !Number.isFinite(frame)) return null;

  return (cuts || []).find(cut => (
    cut.sourceId === sourceId
    && frame >= Number(cut.startFrame)
    && frame <= Number(cut.endFrame)
  )) || null;
}
