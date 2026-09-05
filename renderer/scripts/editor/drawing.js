import * as browserFabric from 'fabric';
import runtimeModule from '../modules/mpv-fabric-overlay-runtime.js';
import { createFabricDrawingPersistenceStore } from '../modules/fabric-drawing-persistence-store.js';
import { createDefaultDrawingLayers, normalizeDrawingLayers, serializeDrawingLayers,
  addLayer as addDrawingLayer, assignObject, toggleLayerVisibility, findLayer,
  isObjectVisible, isObjectEditable, layerIdForObject } from '../../../shared/drawing-layers.js';

const clone = value => structuredClone(value);
let idSequence = 0;
const uid = () => globalThis.crypto?.randomUUID?.() ||
  `editor-drawing-${Date.now()}-${++idSequence}-${Math.random().toString(36).slice(2)}`;
const required = (result, key = 'accepted') => {
  if (!result?.[key]) throw new Error(result?.reason || '드로잉 작업을 완료하지 못했습니다.');
  return result;
};
const frameNumber = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('올바른 프레임 번호가 필요합니다.');
  return value;
};
function projectGeometry(project) {
  const { width, height, fps } = project || {};
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) ||
      !Number.isFinite(fps) || fps <= 0 || fps > 1000) throw new Error('올바른 출력 크기와 FPS가 필요합니다.');
  return { width, height, fps };
}
function clipDocument(clip, project) {
  const geometry = projectGeometry(project);
  if (!clip || typeof clip.id !== 'string' || !clip.id || !Number.isSafeInteger(clip.durationFrames) || clip.durationFrames <= 0) {
    throw new Error('드로잉을 연결할 컷이 필요합니다.');
  }
  const offset = frameNumber(clip.drawingOffsetFrames ?? 0);
  const end = frameNumber(offset + clip.durationFrames);
  const store = createFabricDrawingPersistenceStore();
  const envelope = { fps: geometry.fps, totalFrames: end };
  required(store.importRootValue(clip.drawingsV3 ?? null, envelope));
  const value = store.exportRootValue();
  if (value.fps !== geometry.fps) throw new Error('그림과 프로젝트의 FPS가 다릅니다.');
  value.totalFrames = Math.max(value.totalFrames, end);
  // 제작용 그림 좌표는 출력 캔버스 좌표다. 화면 비율 변경도 기존 문서의 사본에만 적용한다.
  for (const keyframe of value.keyframes) {
    const sx = geometry.width / keyframe.sourceWidth;
    const sy = geometry.height / keyframe.sourceHeight;
    if (sx !== 1 || sy !== 1) {
      for (const record of keyframe.objects) {
        record.transform.left *= sx; record.transform.top *= sy;
        record.transform.scaleX *= sx; record.transform.scaleY *= sy;
      }
      keyframe.sourceWidth = geometry.width;
      keyframe.sourceHeight = geometry.height;
    }
  }
  required(store.importRootValue(value, envelope));
  return { store, geometry, offset, duration: clip.durationFrames };
}
const recordsOf = value => (value?.keyframes || []).flatMap(frame => frame.objects);
const recordSignature = record => JSON.stringify({ ...record, id: '' });

/** Existing Fabric input and V3 persistence, scoped to one editor-owned clip at a time. */
export function createEditorDrawing(options = {}) {
  const container = options.container;
  const documentRef = container?.ownerDocument;
  if (!container || !documentRef) throw new Error('드로잉 미리보기 영역이 필요합니다.');
  const windowRef = options.window || documentRef.defaultView;
  const clipContainer = options.clipContainer || container.closest?.('#stageViewport, .stage-area');
  const fabric = options.fabric || browserFabric;
  const { createFabricOverlayRuntime } = runtimeModule;
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const root = documentRef.createElement('div');
  root.className = 'editor-drawing-overlay';
  // Runtime uses client coordinates for both input and CSS. A viewport-level root avoids a nested offset.
  Object.assign(root.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '30' });
  documentRef.body.appendChild(root);
  let owner = null;
  let generation = 0;
  let inputRevision = 0;
  let frameRevision = 0;
  let presentationRevision = 0;
  let viewportRevision = 0;
  let toolRevision = 0;
  let enabled = true;
  let inputActive = false;
  let disposed = false;
  let queue = Promise.resolve();
  let transactionDepth = 0;
  let transactionChanged = false;
  let persistenceError = null;
  let tool = 'brush';

  function enqueue(operation) {
    const next = queue.then(() => {
      if (disposed) throw new Error('드로잉 편집기가 닫혔습니다.');
      if (persistenceError) throw persistenceError;
      return operation();
    });
    queue = next.catch(() => {});
    return next;
  }
  function snapshotFor(target) {
    return { drawingsV3: target.store.exportRootValue(),
      drawingLayersV1: serializeDrawingLayers(target.layerState) ?? null };
  }
  function notify(target = owner) {
    if (!target) return;
    if (transactionDepth) { transactionChanged = true; return; }
    const payload = { clipId: target.clipId, ...snapshotFor(target) };
    const signature = JSON.stringify(payload);
    if (signature === target.lastEmitted) return;
    target.lastEmitted = signature;
    // Capture a canonical snapshot before yielding; a later clip switch cannot retarget this change.
    queueMicrotask(() => { if (!disposed) onChange(payload); });
  }
  function reconcileAssignments(target, before) {
    const previous = new Map(recordsOf(before).map(record => [record.id, record]));
    const layerByShape = new Map();
    for (const record of previous.values()) {
      layerByShape.set(recordSignature(record), layerIdForObject(target.layerState, record.id));
    }
    for (const record of recordsOf(target.store.exportRootValue())) {
      if (previous.has(record.id) || Object.hasOwn(target.layerState.assignments, record.id)) continue;
      target.layerState = assignObject(target.layerState, record.id,
        layerByShape.get(recordSignature(record)) || target.layerState.activeLayerId);
    }
  }
  function synchronize(target = owner, mode = 'resync') {
    if (!target) return;
    const before = target.store.exportRootValue();
    const exported = required(runtime.exportDrawingVideo(target.envelope));
    const result = required(target.store.replaceFromOverlay(exported.snapshot, { mode }));
    reconcileAssignments(target, before);
    if (mode === 'resync' && result.changed) notify(target);
  }
  const runtime = createFabricOverlayRuntime({ window: windowRef, document: documentRef, fabric,
    persistenceCommitObserver(event) {
      const target = owner;
      if (!target || event.stableVideoIdentity !== target.envelope.stableVideoIdentity ||
          event.persistenceSessionId !== target.envelope.persistenceSessionId) return;
      try {
        const before = target.store.exportRootValue();
        const result = target.store.applyTransition(event);
        if (!result.applied) {
          if (result.needsResync) synchronize(target);
          else throw new Error(result.reason || '그림 저장에 실패했습니다.');
        }
        reconcileAssignments(target, before);
        notify(target);
        queueMicrotask(() => { if (!disposed && owner === target) updateLayerView(); });
      } catch (error) { persistenceError = error; }
    }
  });
  required(runtime.prepare(root), 'prepared');
  const paletteDock = documentRef.createElement('div');
  paletteDock.className = 'editor-drawing-dock';
  paletteDock.setAttribute('role', 'group');
  paletteDock.setAttribute('aria-label', '브러시 옵션');
  paletteDock.hidden = true;
  const palette = root.querySelector('.mpv-fabric-pilot-toolbar');
  palette.classList.add('editor-drawing-palette');
  palette.style.setProperty('position', 'static', 'important');
  paletteDock.appendChild(palette);
  const paletteContainer = options.paletteContainer || documentRef.querySelector('.drawing-tools');
  if (paletteContainer) paletteContainer.appendChild(paletteDock);
  else container.insertAdjacentElement('afterend', paletteDock);

  function positionPalettePanel() {
    const button = palette.querySelector('[data-fabric-pilot-action="brush-settings"]');
    const anchor = button?.getBoundingClientRect();
    if (!anchor || paletteDock.hidden) return;
    const width = Math.min(280, Math.max(200, windowRef.innerWidth - 24));
    const headerBottom = documentRef.querySelector('.editor-header')?.getBoundingClientRect().bottom || 0;
    palette.style.setProperty('--editor-palette-left', `${Math.max(12, Math.min(anchor.left, windowRef.innerWidth - width - 12))}px`);
    palette.style.setProperty('--editor-palette-bottom', `${Math.max(12, windowRef.innerHeight - anchor.top + 8)}px`);
    palette.style.setProperty('--editor-palette-width', `${width}px`);
    palette.style.setProperty('--editor-palette-height', `${Math.max(96, anchor.top - headerBottom - 24)}px`);
  }

  function rect() {
    const area = container.getBoundingClientRect();
    const geometry = owner?.geometry;
    if (!geometry || area.width <= 0 || area.height <= 0) return null;
    const scale = Math.min(area.width / geometry.width, area.height / geometry.height);
    const width = geometry.width * scale, height = geometry.height * scale;
    return { left: area.left + (area.width - width) / 2,
      top: area.top + (area.height - height) / 2, width, height };
  }
  function disableInput() {
    if (!owner) return;
    required(runtime.setDrawingInput({ hostGeneration: 1, videoGeneration: generation,
      inputRevision: ++inputRevision, enabled: false }));
    inputActive = false;
    paletteDock.hidden = true;
  }
  function targetFrame() { return owner.offset + owner.localFrame; }
  function updateLayerView() {
    if (!owner) return;
    const state = owner.layerState;
    const revision = owner.store.getRevision();
    // Pan/zoom and playback change presentation only. Keep the document-wide ID
    // list until a committed drawing edit, and layer masks until layer state changes.
    let cache = owner.layerViewCache;
    if (!cache || cache.revision !== revision) {
      cache = owner.layerViewCache = { revision,
        ids: [...new Set(recordsOf(owner.store.exportRootValue()).map(record => record.id))] };
    }
    if (cache.state !== state) {
      const ids = cache.ids;
      const rank = new Map(state.layers.map((layer, index) => [layer.id, state.layers.length - 1 - index]));
      const active = findLayer(state, state.activeLayerId);
      cache.state = state;
      cache.view = {
        hiddenObjectIds: ids.filter(id => !isObjectVisible(state, id)),
        lockedObjectIds: ids.filter(id => !isObjectEditable(state, id)),
        activeLayerDrawable: active?.visible !== false && active?.locked !== true,
        objectRanks: ids.map(id => [id, rank.get(layerIdForObject(state, id)) ?? 0]),
        defaultRank: rank.get(state.baseLayerId) ?? 0,
        activeLayerRank: rank.get(state.activeLayerId) ?? 0
      };
    }
    runtime.updateDrawingLayerView({ ...(inputActive ? { sessionId: owner.sessionId } :
      { stableVideoIdentity: owner.envelope.stableVideoIdentity }),
    ...cache.view, layerHistoryBusy: transactionDepth > 0 });
  }
  function showFrame() {
    if (!owner) return;
    const clipRect = clipContainer?.getBoundingClientRect();
    root.style.clipPath = clipRect
      ? `inset(${Math.max(0, clipRect.top)}px ${Math.max(0, windowRef.innerWidth - clipRect.left - clipRect.width)}px ${Math.max(0, windowRef.innerHeight - clipRect.top - clipRect.height)}px ${Math.max(0, clipRect.left)}px)`
      : '';
    const canvasRect = rect();
    if (!canvasRect) { if (inputActive) disableInput(); root.style.display = 'none'; paletteDock.hidden = true; return; }
    root.style.display = '';
    paletteDock.hidden = !enabled;
    if (enabled) {
      if (!inputActive) {
        owner.sessionId = uid(); frameRevision = 0; toolRevision = 0;
        required(runtime.setDrawingInput({ hostGeneration: 1, videoGeneration: generation,
          inputRevision: ++inputRevision, enabled: true, session: {
            sessionId: owner.sessionId, stableVideoIdentity: owner.envelope.stableVideoIdentity,
            targetFrame: targetFrame(), sourceFrame: owner.store.resolveSourceFrameAtFrame(targetFrame()),
            sourceWidth: owner.geometry.width, sourceHeight: owner.geometry.height,
            canvasRect, viewportRevision: ++viewportRevision,
            viewportTransform: { scale: 1, panX: 0, panY: 0 }, tool } }));
        inputActive = true;
      } else {
        required(runtime.updateViewport({ revision: ++viewportRevision, canvasRect, scale: 1, panX: 0, panY: 0 }));
        required(runtime.updateDrawingFrame({ hostGeneration: 1, videoGeneration: generation,
          inputRevision, sessionId: owner.sessionId, frameRevision: ++frameRevision,
          targetFrame: targetFrame() }));
      }
    } else {
      if (inputActive) disableInput();
      required(runtime.presentDrawingFrame({ hostGeneration: 1, videoGeneration: generation,
        presentationRevision: ++presentationRevision, stableVideoIdentity: owner.envelope.stableVideoIdentity,
        storeRevision: owner.store.getRevision(), targetFrame: targetFrame(),
        sourceFrame: owner.store.resolveSourceFrameAtFrame(targetFrame()),
        sourceWidth: owner.geometry.width, sourceHeight: owner.geometry.height, canvasRect,
        viewportRevision: ++viewportRevision, viewportTransform: { scale: 1, panX: 0, panY: 0 } }));
    }
    updateLayerView();
    positionPalettePanel();
  }
  function refreshGeometry() {
    try { refreshViewport(); } catch (error) { persistenceError = error; }
  }
  function refreshViewport() {
    if (disposed || !owner) return false;
    if (persistenceError) throw persistenceError;
    showFrame();
    return true;
  }
  const resizeObserver = typeof windowRef.ResizeObserver === 'function' ? new windowRef.ResizeObserver(refreshGeometry) : null;
  resizeObserver?.observe(container);
  if (clipContainer) resizeObserver?.observe(clipContainer);
  resizeObserver?.observe(paletteDock);
  windowRef.addEventListener('resize', refreshGeometry);
  windowRef.addEventListener('scroll', refreshGeometry, true);

  async function loadClip(clip, project) {
    const requested = clone(clip); const requestedProject = clone(project);
    return enqueue(() => {
      // Validate before touching the current session; a rejected import must leave it usable.
      const prepared = requested === null ? null : clipDocument(requested, requestedProject);
      if (owner) { synchronize(); disableInput(); }
      generation += 1;
      // Announce the new generation with input disabled before hydrating or enabling it.
      required(runtime.setDrawingInput({ hostGeneration: 1, videoGeneration: generation,
        inputRevision: ++inputRevision, enabled: false }));
      if (requested === null) {
        owner = null;
        root.style.display = 'none';
        paletteDock.hidden = true;
        return { drawingsV3: null, drawingLayersV1: null };
      }
      const envelope = { hostGeneration: 1, videoGeneration: generation,
        persistenceSessionId: uid(), stableVideoIdentity: `editor:${requested.id}:${generation}`,
        fps: prepared.geometry.fps, totalFrames: prepared.store.exportRootValue().totalFrames };
      required(prepared.store.importRootValue(prepared.store.exportRootValue(), envelope));
      owner = { ...prepared, clipId: requested.id, envelope, localFrame: 0, sessionId: uid(),
        layerState: normalizeDrawingLayers(requested.drawingLayersV1 || createDefaultDrawingLayers()), lastEmitted: '' };
      required(runtime.hydrateDrawingVideo({ ...envelope, keyframes: owner.store.getHydrationDocument().keyframes }));
      synchronize(owner, 'hydrate');
      owner.lastEmitted = JSON.stringify({ clipId: owner.clipId, ...snapshotFor(owner) });
      showFrame();
      return snapshotFor(owner);
    });
  }
  function seek(frame) { return enqueue(() => {
    if (!owner) return;
    frameNumber(frame);
    if (frame >= owner.duration) throw new Error('컷 범위를 벗어난 프레임입니다.');
    owner.localFrame = frame; showFrame();
  }); }
  function setEnabled(value) { return enqueue(() => { enabled = !!value; showFrame(); }); }
  function setTool(nextTool, settings = {}) { return enqueue(() => {
    if (!owner) return;
    if (!['brush', 'pen', 'eraser', 'line', 'rect', 'circle', 'arrow', 'select'].includes(nextTool)) throw new Error('지원하지 않는 그리기 도구입니다.');
    tool = nextTool;
    if (inputActive) {required(runtime.updateDrawingTool({ sessionId: owner.sessionId,
      toolRevision: ++toolRevision, tool }));}
    if (settings.size !== undefined && inputActive) required(runtime.updateDrawingBrush({ size: settings.size }));
  }); }
  function action(name) { return enqueue(() => {
    if (!owner || !inputActive) throw new Error('드로잉을 켠 뒤 편집할 수 있습니다.');
    const names = { keyframe: 'frame-to-keyframe', hold: 'frame-insert', removeFrame: 'frame-remove',
      clear: 'clear-session', delete: 'delete-selection', undo: 'undo', redo: 'redo' };
    const run = actionName => runtime.applyDrawingAction({ sessionId: owner.sessionId,
      actionId: uid(), action: actionName, targetFrame: targetFrame() });
    transactionDepth += 1; transactionChanged = false;
    try {
      let result;
      if (name === 'blank') {
        result = run('frame-to-keyframe');
        if (!result.applied && result.reason !== 'already-keyframe') required(result, 'applied');
        // Blank applies to the whole exposure, including hidden layers, while preserving other frames.
        runtime.updateDrawingLayerView({ sessionId: owner.sessionId, hiddenObjectIds: [], lockedObjectIds: [], activeLayerDrawable: true });
        const cleared = run('clear-session');
        if (!cleared.applied && !['no-change', 'nothing-to-clear', 'empty-scene'].includes(cleared.reason)) {
          // An already empty frame is a successful blank operation.
          if (owner.store.resolveKeyframeAtFrame(targetFrame())?.objects.length) required(cleared, 'applied');
        }
      } else {
        const actionName = names[name];
        if (!actionName) throw new Error('지원하지 않는 드로잉 작업입니다.');
        result = run(actionName);
        if (!result.applied && !['already-keyframe', 'nothing-to-undo', 'nothing-to-redo'].includes(result.reason)) required(result, 'applied');
      }
      synchronize();
      transactionChanged = true;
    } finally {
      transactionDepth -= 1;
      updateLayerView();
      if (transactionChanged) notify();
    }
    showFrame();
    return snapshotFor(owner);
  }); }
  function keyframes() {
    if (!owner) return [];
    const value = owner.store.exportRootValue();
    const held = owner.store.resolveKeyframeAtFrame(owner.offset);
    const frames = value.keyframes.filter(frame => frame.frame >= owner.offset && frame.frame < owner.offset + owner.duration);
    if (held && held.frame < owner.offset) frames.unshift(held);
    return frames.map(frame => ({ frame: Math.max(0, frame.frame - owner.offset), sourceFrame: frame.frame,
      isEmpty: frame.objects.length === 0, held: frame.frame < owner.offset, objects: clone(frame.objects) }));
  }
  function layers() { return owner ? owner.layerState.layers.map(layer => ({ ...layer,
    active: layer.id === owner.layerState.activeLayerId })) : []; }
  function addLayer(name) { return enqueue(() => {
    if (!owner) return;
    const result = addDrawingLayer(owner.layerState, typeof name === 'string' ? { name } : name || {});
    if (!result.added) throw new Error(result.reason);
    if (inputActive) disableInput();
    owner.layerState = result.state; showFrame(); notify(); return layers();
  }); }
  function setActiveLayer(id) { return enqueue(() => {
    if (!owner || !findLayer(owner.layerState, id)) throw new Error('레이어를 찾을 수 없습니다.');
    if (owner.layerState.activeLayerId === id) return layers();
    if (inputActive) disableInput();
    owner.layerState = normalizeDrawingLayers({ ...owner.layerState, activeLayerId: id });
    showFrame(); notify(); return layers();
  }); }
  function toggleLayer(id) { return enqueue(() => {
    if (!owner || !findLayer(owner.layerState, id)) throw new Error('레이어를 찾을 수 없습니다.');
    owner.layerState = toggleLayerVisibility(owner.layerState, id); updateLayerView(); notify(); return layers();
  }); }
  async function exportOverlays(clip, project, exportOptions = {}) {
    const { store, geometry, offset, duration } = clipDocument(clone(clip), project);
    const state = normalizeDrawingLayers(clip.drawingLayersV1);
    const ranks = new Map(state.layers.map((layer, index) => [layer.id, state.layers.length - index - 1]));
    const boundaries = [0, ...store.exportRootValue().keyframes.map(frame => frame.frame - offset)
      .filter(frame => frame > 0 && frame < duration), duration];
    const output = [];
    const canvas = new fabric.StaticCanvas(documentRef.createElement('canvas'), {
      width: geometry.width, height: geometry.height, enableRetinaScaling: false, renderOnAddRemove: false });
    try {
      for (let index = 0; index < boundaries.length - 1; index += 1) {
        // Let the editor process cancel/close while preparing a large drawing sequence.
        await new Promise(resolve => windowRef.setTimeout(resolve, 0));
        if (disposed || exportOptions.isCancelled?.() === true) return [];
        const startFrame = boundaries[index], endFrame = boundaries[index + 1];
        const records = (store.resolveKeyframeAtFrame(offset + startFrame)?.objects || [])
          .filter(record => isObjectVisible(state, record.id))
          .sort((a, b) => (ranks.get(layerIdForObject(state, a.id)) ?? 0) - (ranks.get(layerIdForObject(state, b.id)) ?? 0));
        if (records.length === 0) continue;
        canvas.clear();
        for (const record of records) {
          const path = new fabric.Path(record.renderGeometry?.pathData || record.pathData, {
            fill: record.style.color, fillRule: record.renderGeometry?.fillRule || 'nonzero',
            opacity: record.style.opacity, stroke: null, strokeWidth: 0 });
          path.set(record.transform); canvas.add(path);
        }
        canvas.renderAll();
        output.push({ clipId: clip.id, startFrame, endFrame,
          dataUrl: canvas.toDataURL({ format: 'png', multiplier: 1, enableRetinaScaling: false }) });
      }
    } finally { await canvas.dispose(); }
    return output;
  }
  async function dispose() {
    await queue;
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    windowRef.removeEventListener('resize', refreshGeometry);
    windowRef.removeEventListener('scroll', refreshGeometry, true);
    runtime.destroy(); paletteDock.remove(); root.remove(); owner = null;
  }
  return { loadClip, seek, setTool, setEnabled, refreshViewport, action, snapshot() {
    if (persistenceError) throw persistenceError;
    return owner ? snapshotFor(owner) : { drawingsV3: null, drawingLayersV1: null };
  }, keyframes, layers, addLayer, setActiveLayer, toggleLayer, exportOverlays, dispose };
}
