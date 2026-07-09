/**
 * baeframe - Drawing Manager Module
 * 그리기 레이어, 캔버스, 타임라인 통합 관리
 */

import { createLogger } from '../logger.js';
import { DrawingLayer, Keyframe } from './drawing-layer.js';
import { DrawingCanvas, DrawingTool } from './drawing-canvas.js';
import {
  ERASER_MODES,
  createStrokeRecord,
  isRecordableStrokeTool,
  normalizeEraserMode,
  removeIntersectingStrokes
} from './drawing-stroke-records.js';

const log = createLogger('DrawingManager');

export function partitionDrawingLayersForActive(layers = [], activeLayerId) {
  const activeIndex = layers.findIndex(layer => layer.id === activeLayerId);
  if (activeIndex === -1) {
    return {
      below: [...layers],
      active: null,
      above: []
    };
  }

  return {
    below: layers.slice(0, activeIndex),
    active: layers[activeIndex],
    above: layers.slice(activeIndex + 1)
  };
}

/**
 * 드로잉 매니저 클래스
 */
export class DrawingManager extends EventTarget {
  constructor(options = {}) {
    super();

    // 캔버스 요소
    this.canvas = options.canvas;
    this.drawingCanvas = new DrawingCanvas(this.canvas);
    this.drawingCanvas.canDraw = () => {
      const layer = this.getActiveLayer();
      return !layer || (layer.locked !== true && layer.visible !== false);
    };

    // 어니언 스킨 전용 캔버스 (별도 레이어)
    this.onionSkinCanvasElement = options.onionSkinCanvas;
    this.onionSkinCtx = this.onionSkinCanvasElement?.getContext('2d');
    this.layersBelowCanvas = options.layersBelowCanvas;
    this.layersAboveCanvas = options.layersAboveCanvas;
    this.selectionOverlayCanvas = options.selectionOverlayCanvas || null;
    this.drawingCanvas.selectionCanvas = this.selectionOverlayCanvas;
    this.layersBelowCtx = this.layersBelowCanvas?.getContext('2d');
    this.layersAboveCtx = this.layersAboveCanvas?.getContext('2d');

    // 레이어 관리
    this.layers = [];
    this.activeLayerId = null;
    this._frameClipboard = null;

    // 비디오 정보
    this.totalFrames = 0;
    this.fps = 24;
    this.currentFrame = 0;

    // 캔버스 크기
    this.canvasWidth = 0;
    this.canvasHeight = 0;

    // 어니언 스킨 설정
    this.onionSkin = {
      enabled: false,
      before: 2,      // 이전 프레임 수
      after: 1,       // 이후 프레임 수
      opacity: 0.3    // 투명도
    };

    // 재생 성능 관련
    this.preloadedFrames = new Map();  // 프리로드된 이미지 캐시
    this.isPlaying = false;
    this.preloadRange = 10;  // 앞뒤로 프리로드할 프레임 수
    this.maxCacheSize = 100;  // 최대 캐시 프레임 수 (LRU 방식)
    this._preloadInFlight = false;
    this._lastPlaybackPreloadCenterFrame = null;
    this._playbackCanvasCleared = false;

    // 렌더링 상태 관리
    this._renderingId = 0;  // 렌더링 취소용 ID
    this.eraserMode = ERASER_MODES.PIXEL;
    this._activeStrokeBaseData = null;
    this._strokeEraseQueue = Promise.resolve();
    this._strokeEraseUnavailableNotified = false;

    // Undo/Redo — 외부 통합 스택과 연동
    this._onUndoPush = null; // 외부에서 설정하는 콜백: (action) => void
    this._isUndoingOrRedoing = false;

    // 이벤트 연결
    this._setupEvents();

    log.info('DrawingManager 초기화됨');
  }

  /**
   * 이벤트 설정
   */
  _setupEvents() {
    // 그리기 시작 시
    this.drawingCanvas.addEventListener('drawstart', (e) => {
      this._onDrawStart(e.detail);
    });

    // 그리기 진행 시
    this.drawingCanvas.addEventListener('drawmove', (e) => {
      this._onDrawMove(e.detail);
    });

    // 그리기 완료 시
    this.drawingCanvas.addEventListener('drawend', (e) => {
      void this._onDrawEnd(e.detail);
    });

    this.drawingCanvas.addEventListener('drawblocked', (e) => {
      const layer = this.getActiveLayer();
      this._emit('drawblocked', {
        ...e.detail,
        reason: layer?.locked ? 'locked' : 'hidden'
      });
    });

    this.drawingCanvas.addEventListener('selectionliftstart', () => {
      this._saveToHistory();
    });

    this.drawingCanvas.addEventListener('selectioncommitted', () => {
      this._onSelectionCommitted();
    });

    this.drawingCanvas.addEventListener('selectionoverlaychanged', (e) => {
      this._emit('selectionoverlaychanged', {
        ...e.detail,
        frame: this.currentFrame
      });
    });
  }

  /**
   * 그리기 시작 처리
   */
  _onDrawStart(detail) {
    this._strokeEraseUnavailableNotified = false;

    // 레이어가 없으면 새 레이어 생성
    if (this.layers.length === 0 || !this.activeLayerId) {
      this.createLayer();
    }

    const layer = this.getActiveLayer();
    if (!layer || layer.locked || layer.visible === false) return;

    // Undo를 위해 현재 상태 저장 (그리기 시작 전)
    if (!this._isUndoingOrRedoing) {
      this._saveToHistory();
    }

    this._activeStrokeBaseData = this.drawingCanvas.toDataURL();

    if (this._isStrokeEraseDetail(detail)) {
      this._getEditableKeyframeForCurrentFrame({
        editHeldSourceKeyframe: true,
        preserveSourceRecords: true,
        fallbackBaseData: this._activeStrokeBaseData
      });
      const keyframe = layer.getKeyframeAtFrame(this.currentFrame);
      this._notifyStrokeEraseUnavailable(keyframe);
    } else {
      // 현재 프레임에 키프레임이 없으면 생성
      // (기존 키프레임 범위 내에서 그리는 경우는 덧그리기)
      const existingKf = layer.getKeyframeAtFrame(this.currentFrame);

      if (!existingKf) {
        // 첫 키프레임 생성
        layer.getOrCreateKeyframe(this.currentFrame, true);
      } else if (existingKf.frame !== this.currentFrame) {
        // 기존 키프레임의 범위 내에서 그리기 → 덧그리기 (키프레임 생성 안 함)
        // 기존 키프레임의 내용이 이미 캔버스에 표시되어 있음
      }
    }

    this._emit('drawstart', { layer, frame: this.currentFrame });
  }

  /**
   * 그리기 진행 처리
   */
  _onDrawMove(detail) {
    this._emit('drawmove', { frame: this.currentFrame, detail });

    if (!this._isStrokeEraseDetail(detail)) return;

    this._strokeEraseQueue = this._strokeEraseQueue
      .then(() => this._eraseStrokeRecords(detail))
      .catch(error => {
        log.warn('획 지우기 처리 실패', { error: error?.message || String(error) });
      });
  }

  /**
   * 그리기 완료 처리
   */
  async _onDrawEnd(detail) {
    if (this._isStrokeEraseDetail(detail)) {
      this._strokeEraseQueue = this._strokeEraseQueue
        .then(() => this._eraseStrokeRecords(detail))
        .catch(error => {
          log.warn('획 지우기 마무리 실패', { error: error?.message || String(error) });
        });
      await this._strokeEraseQueue;

      this._emit('drawend', { frame: this.currentFrame });
      this._emit('layersChanged');
      this._activeStrokeBaseData = null;
      return;
    }

    // 현재 키프레임에 캔버스 데이터 저장
    const keyframe = this._saveCurrentFrameData({
      editHeldSourceKeyframe: (detail?.effectiveTool || detail?.tool) === DrawingTool.ERASER,
      preserveStrokeRecords: isRecordableStrokeTool(detail?.effectiveTool)
    });
    if (!keyframe) {
      this._emit('drawend', { frame: this.currentFrame });
      this._emit('layersChanged');
      this._activeStrokeBaseData = null;
      return;
    }

    if (isRecordableStrokeTool(detail?.effectiveTool)) {
      this._saveRecordableStroke(detail);
    } else {
      this._freezeStrokeRecords(keyframe);
    }

    this._emit('drawend', { frame: this.currentFrame });
    this._emit('layersChanged');
    this._activeStrokeBaseData = null;
  }

  /**
   * 선택 도구 커밋 결과를 현재 키프레임 비트맵으로 저장
   */
  _onSelectionCommitted() {
    const keyframe = this._saveCurrentFrameData({
      editHeldSourceKeyframe: false,
      preserveStrokeRecords: false
    });
    if (keyframe) {
      this._freezeStrokeRecords(keyframe);
    }
    this._emit('drawend', { frame: this.currentFrame });
    this._emit('layersChanged');
  }

  /**
   * 진행 중인 선택을 커밋한다.
   */
  commitActiveSelection() {
    if (!this.drawingCanvas) return;
    if (this.drawingCanvas.floatingImage) {
      this.drawingCanvas.commitSelection();
    } else if (this.drawingCanvas.selection) {
      this.drawingCanvas.commitSelection();
    }
  }

  /**
   * 현재 프레임의 캔버스 데이터 저장
   */
  _saveCurrentFrameData(options = {}) {
    const layer = this.getActiveLayer();
    if (!layer || layer.locked || layer.visible === false) {
      log.warn('저장 실패: 활성 레이어 없음 또는 그리기 차단 상태');
      if (layer?.locked || layer?.visible === false) {
        this.renderFrame(this.currentFrame);
      }
      return null;
    }

    const keyframe = this._getEditableKeyframeForCurrentFrame({
      editHeldSourceKeyframe: options.editHeldSourceKeyframe === true,
      preserveSourceRecords: options.preserveStrokeRecords === true,
      fallbackBaseData: this._activeStrokeBaseData
    });
    if (!keyframe) return null;

    // 캔버스 데이터 저장
    const imageData = this.drawingCanvas.isEmpty() ? null : this.drawingCanvas.toDataURL();
    keyframe.setCanvasData(imageData);

    // 캐시 무효화 (새 데이터이므로)
    keyframe._cachedImage = null;
    keyframe._cachedSrc = null;

    log.info('프레임 데이터 저장됨', {
      layerId: layer.id,
      frame: this.currentFrame,
      dataLength: imageData?.length || 0,
      keyframesCount: layer.keyframes.length
    });

    return keyframe;
  }

  _isStrokeEraseDetail(detail) {
    const effectiveTool = detail?.effectiveTool || detail?.tool;
    return effectiveTool === DrawingTool.ERASER && detail?.eraserMode === ERASER_MODES.STROKE;
  }

  _cloneStrokeRecords(records = []) {
    return records.map(record => ({
      ...record,
      points: Array.isArray(record.points)
        ? record.points.map(point => ({ ...point }))
        : []
    }));
  }

  _getEditableKeyframeForCurrentFrame(options = {}) {
    const layer = this.getActiveLayer();
    if (!layer) return null;

    const exactKeyframe = layer.keyframes.find(kf => kf.frame === this.currentFrame);
    if (exactKeyframe) return exactKeyframe;

    const sourceKeyframe = layer.getKeyframeAtFrame(this.currentFrame);
    if (sourceKeyframe && options.editHeldSourceKeyframe === true) {
      if (!sourceKeyframe.baseCanvasData && Array.isArray(sourceKeyframe.strokeRecords) && sourceKeyframe.strokeRecords.length > 0) {
        sourceKeyframe.baseCanvasData = sourceKeyframe.canvasData || options.fallbackBaseData || null;
      }
      return sourceKeyframe;
    }

    if (sourceKeyframe && sourceKeyframe.frame !== this.currentFrame) {
      const preserveSourceRecords = options.preserveSourceRecords === true;
      const sourceRecords = preserveSourceRecords
        ? this._cloneStrokeRecords(sourceKeyframe.strokeRecords || [])
        : [];
      const baseCanvasData = preserveSourceRecords
        ? (sourceKeyframe.baseCanvasData || (sourceRecords.length === 0 ? sourceKeyframe.canvasData : null))
        : (options.fallbackBaseData || null);

      const keyframe = new Keyframe(this.currentFrame, sourceKeyframe.canvasData, {
        baseCanvasData,
        strokeRecords: sourceRecords
      });
      keyframe.isEmpty = sourceKeyframe.isEmpty;
      layer.keyframes.push(keyframe);
      layer._sortKeyframes();
      return keyframe;
    }

    const keyframe = layer.getOrCreateKeyframe(this.currentFrame, true);
    if (keyframe && options.fallbackBaseData && !keyframe.baseCanvasData && keyframe.strokeRecords.length === 0) {
      keyframe.baseCanvasData = options.fallbackBaseData;
    }
    return keyframe;
  }

  _saveRecordableStroke(detail) {
    const layer = this.getActiveLayer();
    const keyframe = layer?.keyframes.find(kf => kf.frame === this.currentFrame);
    if (!keyframe || !isRecordableStrokeTool(detail?.effectiveTool)) return;
    const points = Array.isArray(detail.points) ? detail.points : [];
    if (points.length === 0) return;

    if (!keyframe.baseCanvasData && (!keyframe.strokeRecords || keyframe.strokeRecords.length === 0)) {
      keyframe.baseCanvasData = this._activeStrokeBaseData || null;
    }

    keyframe.strokeRecords = this._cloneStrokeRecords(keyframe.strokeRecords || []);
    keyframe.strokeRecords.push(createStrokeRecord({
      tool: detail.effectiveTool,
      points,
      color: detail.color,
      lineWidth: detail.lineWidth,
      opacity: detail.opacity,
      strokeEnabled: detail.strokeEnabled,
      strokeWidth: detail.strokeWidth,
      strokeColor: detail.strokeColor
    }));
  }

  _freezeStrokeRecords(keyframe) {
    if (!keyframe || !Array.isArray(keyframe.strokeRecords) || keyframe.strokeRecords.length === 0) return;

    keyframe.baseCanvasData = keyframe.canvasData || null;
    keyframe.strokeRecords = [];
    keyframe._cachedImage = null;
    keyframe._cachedSrc = null;
    keyframe._cachedBaseImage = null;
    keyframe._cachedBaseSrc = null;
  }

  async _eraseStrokeRecords(detail) {
    const layer = this.getActiveLayer();
    if (!layer || layer.locked || layer.visible === false) return false;

    const keyframe = this._getEditableKeyframeForCurrentFrame({
      editHeldSourceKeyframe: true,
      preserveSourceRecords: true,
      fallbackBaseData: this._activeStrokeBaseData
    });
    if (!keyframe?.strokeRecords?.length) {
      this._notifyStrokeEraseUnavailable(keyframe);
      return false;
    }

    const result = removeIntersectingStrokes(
      keyframe.strokeRecords,
      detail?.points || [],
      detail?.lineWidth || this.drawingCanvas.lineWidth
    );
    if (result.removed.length === 0) return false;

    keyframe.strokeRecords = result.remaining;
    await this._redrawKeyframeFromRecords(keyframe);
    return true;
  }

  async _redrawKeyframeFromRecords(keyframe) {
    if (!keyframe) return;

    const baseImage = keyframe.baseCanvasData
      ? await this._loadBaseCanvasImage(keyframe)
      : null;

    this.drawingCanvas.clear({ silent: true });
    if (baseImage) {
      this.drawingCanvas.ctx.drawImage(baseImage, 0, 0);
    }

    for (const record of keyframe.strokeRecords || []) {
      this.drawingCanvas.drawStrokeRecord(record);
    }

    const imageData = this.drawingCanvas.isEmpty() ? null : this.drawingCanvas.toDataURL();
    keyframe.setCanvasData(imageData);
    keyframe._cachedImage = null;
    keyframe._cachedSrc = null;
  }

  _loadBaseCanvasImage(keyframe) {
    const src = keyframe?.baseCanvasData;
    if (!src) return Promise.resolve(null);
    if (keyframe._cachedBaseImage && keyframe._cachedBaseSrc === src) {
      return Promise.resolve(keyframe._cachedBaseImage);
    }

    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => {
        keyframe._cachedBaseImage = image;
        keyframe._cachedBaseSrc = src;
        resolve(image);
      };
      image.onerror = () => {
        log.warn('획 지우기 기준 이미지 로드 실패');
        resolve(null);
      };
      image.src = src;
    });
  }

  _notifyStrokeEraseUnavailable(keyframe) {
    if (this._strokeEraseUnavailableNotified) return;
    if (!keyframe || keyframe.strokeRecords?.length > 0) return;
    if (!keyframe.canvasData && keyframe.isEmpty !== false) return;

    this._strokeEraseUnavailableNotified = true;
    this._emit('strokeeraserunavailable', {
      frame: keyframe.frame,
      reason: 'bitmap-only'
    });
  }

  /**
   * 새 레이어 생성
   */
  createLayer(options = {}, saveHistory = true) {
    const shouldActivate = options.skipActivate !== true;
    if (shouldActivate) {
      this.commitActiveSelection();
    }

    // Undo를 위해 현재 상태 저장
    if (saveHistory && this.layers.length > 0) {
      this._saveToHistory();
    }

    const layer = new DrawingLayer(options);
    const insertIndex = Number.isInteger(options.insertIndex)
      ? Math.max(0, Math.min(options.insertIndex, this.layers.length))
      : this.layers.length;
    this.layers.splice(insertIndex, 0, layer);
    if (shouldActivate) {
      this.activeLayerId = layer.id;
    }

    this._emit('layerCreated', { layer, insertIndex });
    this._emit('layersChanged');
    this.renderFrame(this.currentFrame);

    log.info('새 레이어 생성됨', { id: layer.id, name: layer.name });
    return layer;
  }

  /**
   * 레이어 삭제
   */
  deleteLayer(layerId) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1) return false;

    this.commitActiveSelection();

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    const layer = this.layers[index];
    this.layers.splice(index, 1);

    // 활성 레이어가 삭제된 경우 다른 레이어 선택
    if (this.activeLayerId === layerId) {
      this.activeLayerId = this.layers.length > 0 ? this.layers[0].id : null;
    }

    this._emit('layerDeleted', { layer });
    this._emit('layersChanged');

    // 현재 프레임 다시 렌더링
    this.renderFrame(this.currentFrame);

    log.info('레이어 삭제됨', { id: layer.id, name: layer.name });
    return true;
  }

  /**
   * 활성 레이어 가져오기
   */
  getActiveLayer() {
    return this.layers.find(l => l.id === this.activeLayerId);
  }

  /**
   * 활성 레이어 설정
   */
  setActiveLayer(layerId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      if (layerId !== this.activeLayerId) {
        this.commitActiveSelection();
      }
      this.activeLayerId = layerId;
      this._emit('activeLayerChanged', { layer });
      this.renderFrame(this.currentFrame);
      log.debug('활성 레이어 변경', { id: layerId });
    }
  }

  selectActiveLayerByOffset(offset) {
    const index = this.layers.findIndex(layer => layer.id === this.activeLayerId);
    if (index === -1) return false;

    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= this.layers.length) return false;

    this.setActiveLayer(this.layers[targetIndex].id);
    return true;
  }

  moveActiveLayerByOffset(offset) {
    const index = this.layers.findIndex(layer => layer.id === this.activeLayerId);
    if (index === -1) return false;

    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= this.layers.length) return false;

    this.commitActiveSelection();
    this._saveToHistory();
    const [layer] = this.layers.splice(index, 1);
    this.layers.splice(targetIndex, 0, layer);
    this.activeLayerId = layer.id;
    this._emit('activeLayerChanged', { layer });
    this._emit('layersChanged');
    this.renderFrame(this.currentFrame);
    return true;
  }

  /**
   * 레이어 가시성 토글
   */
  toggleLayerVisibility(layerId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      this.commitActiveSelection();
      layer.visible = !layer.visible;
      this._emit('layersChanged');
      this.renderFrame(this.currentFrame);
    }
  }

  /**
   * 레이어 잠금 토글
   */
  toggleLayerLock(layerId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
      this.commitActiveSelection();
      layer.locked = !layer.locked;
      this._emit('layersChanged');
    }
  }

  // ====== Undo/Redo ======

  _createSnapshot() {
    return {
      layers: this.layers.map(l => l.toJSON()),
      activeLayerId: this.activeLayerId,
      currentFrame: this.currentFrame
    };
  }

  /**
   * 현재 상태를 히스토리에 저장
   */
  _saveToHistory() {
    if (this._isUndoingOrRedoing) return;

    // 현재 상태 스냅샷 생성
    const snapshotBefore = this._createSnapshot();

    // 외부 통합 undo 스택에 push
    if (this._onUndoPush) {
      this._onUndoPush({
        type: 'DRAWING',
        timestamp: Date.now(),
        undo: async () => {
          this._isUndoingOrRedoing = true;
          this._restoreSnapshot(snapshotBefore);
          this._isUndoingOrRedoing = false;
          this._emit('undo');
        },
        redo: null // DRAWING 타입은 globalRedo에서 _redoSnapshot으로 처리
      });
    }

    log.debug('히스토리 저장 (통합 스택)');
  }

  /**
   * @deprecated 통합 undo 사용
   */
  undo() {
    log.warn('DrawingManager.undo() deprecated — 통합 undo 사용');
    return false;
  }

  /**
   * @deprecated 통합 undo 사용
   */
  redo() {
    log.warn('DrawingManager.redo() deprecated — 통합 undo 사용');
    return false;
  }

  /**
   * 스냅샷에서 상태 복원
   */
  _restoreSnapshot(snapshot) {
    if (!snapshot) return;

    this.drawingCanvas.clearSelection?.();

    // 레이어 복원
    this.layers = snapshot.layers.map(l => DrawingLayer.fromJSON(l));
    this.activeLayerId = snapshot.activeLayerId;

    // UI 업데이트
    this._emit('layersChanged');
    this.renderFrame(this.currentFrame);
  }

  /**
   * Undo 가능 여부 (외부 스택에서 판단)
   */
  canUndo() {
    return false;
  }

  /**
   * Redo 가능 여부 (외부 스택에서 판단)
   */
  canRedo() {
    return false;
  }

  /**
   * 히스토리 초기화 (no-op, 통합 스택에서 관리)
   */
  clearHistory() {
    log.debug('히스토리 초기화 (통합 스택에서 관리)');
  }

  /**
   * 빈 키프레임 추가 (F7)
   */
  addBlankKeyframe() {
    this.commitActiveSelection();

    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.addBlankKeyframe(this.currentFrame);

    // 어니언 스킨 포함하여 다시 렌더링
    this.renderFrame(this.currentFrame);

    this._emit('keyframeAdded', { layer, frame: this.currentFrame, blank: true });
    this._emit('layersChanged');
  }

  /**
   * 키프레임 복제 추가 (F6)
   */
  addKeyframeWithContent() {
    this.commitActiveSelection();

    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.addKeyframeWithContent(this.currentFrame);

    // 캔버스에 복제된 내용 표시
    this.renderFrame(this.currentFrame);

    this._emit('keyframeAdded', { layer, frame: this.currentFrame, blank: false });
    this._emit('layersChanged');
  }

  /**
   * 키프레임 삭제
   */
  removeKeyframe() {
    this.commitActiveSelection();

    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return false;
    if (!layer.isKeyframe(this.currentFrame)) return false;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.removeKeyframe(this.currentFrame);
    this.renderFrame(this.currentFrame);

    this._emit('keyframeRemoved', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
    return true;
  }

  convertKeyframeToFrame() {
    this.commitActiveSelection();

    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return false;
    if (!layer.isKeyframe(this.currentFrame)) return false;

    this._saveToHistory();
    layer.removeKeyframe(this.currentFrame);
    this.renderFrame(this.currentFrame);
    this._emit('keyframeConvertedToFrame', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
    return true;
  }

  convertFrameToKeyframe() {
    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return false;

    this.addKeyframeWithContent();
    this._emit('keyframeConvertedToKeyframe', { layer, frame: this.currentFrame });
    return true;
  }

  /**
   * 선택된 여러 키프레임 삭제
   * @param {Array<{layerId: string, frame: number}>} selectedKeyframes
   * @returns {number} 삭제된 키프레임 수
   */
  removeKeyframes(selectedKeyframes = []) {
    this.commitActiveSelection();

    if (!Array.isArray(selectedKeyframes) || selectedKeyframes.length === 0) return 0;

    const uniqueTargets = [];
    for (const target of selectedKeyframes) {
      if (!target?.layerId || !Number.isFinite(Number(target.frame))) continue;
      const frame = Number(target.frame);
      if (!uniqueTargets.some(item => item.layerId === target.layerId && item.frame === frame)) {
        uniqueTargets.push({ layerId: target.layerId, frame });
      }
    }
    if (uniqueTargets.length === 0) return 0;

    this._saveToHistory();

    let removedCount = 0;
    const targetsByLayer = new Map();
    uniqueTargets.forEach(target => {
      if (!targetsByLayer.has(target.layerId)) {
        targetsByLayer.set(target.layerId, []);
      }
      targetsByLayer.get(target.layerId).push(target.frame);
    });

    for (const [layerId, frames] of targetsByLayer) {
      const layer = this.layers.find(l => l.id === layerId);
      if (!layer || layer.locked) continue;

      const sortedFrames = [...frames].sort((a, b) => b - a);
      for (const frame of sortedFrames) {
        if (layer.removeKeyframe(frame)) {
          removedCount += 1;
          this._emit('keyframeRemoved', { layer, frame });
        }
      }
    }

    if (removedCount > 0) {
      this.renderFrame(this.currentFrame);
      this._emit('layersChanged');
    }

    return removedCount;
  }

  /**
   * 이전 키프레임 프레임 번호 가져오기
   * @returns {number|null}
   */
  getPrevKeyframeFrame() {
    const layer = this.getActiveLayer();
    if (!layer) return null;
    return layer.getPrevKeyframeFrame(this.currentFrame);
  }

  /**
   * 다음 키프레임 프레임 번호 가져오기
   * @returns {number|null}
   */
  getNextKeyframeFrame() {
    const layer = this.getActiveLayer();
    if (!layer) return null;
    return layer.getNextKeyframeFrame(this.currentFrame);
  }

  /**
   * 어니언 스킨 토글
   * @returns {boolean} 새로운 어니언 스킨 상태
   */
  toggleOnionSkin() {
    const enabled = !this.onionSkin.enabled;
    this.setOnionSkin(enabled);
    return enabled;
  }

  /**
   * 프레임 삽입 (홀드 추가) - 현재 프레임 이후의 모든 키프레임을 1프레임씩 뒤로 이동
   */
  insertFrame() {
    this.commitActiveSelection();

    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return false;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.insertFrame(this.currentFrame);
    this.renderFrame(this.currentFrame);

    this._emit('frameInserted', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
    return true;
  }

  /**
   * 프레임 삭제 - 현재 프레임 이후의 모든 키프레임을 1프레임씩 앞으로 이동
   */
  deleteFrame() {
    this.commitActiveSelection();

    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return false;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.deleteFrame(this.currentFrame, this.totalFrames);
    this.renderFrame(this.currentFrame);

    this._emit('frameDeleted', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
    return true;
  }

  /**
   * 프레임 복사 (Ctrl+Alt+C)
   */
  copyFrames(targets = null) {
    this.commitActiveSelection();

    const resolved = [];
    if (Array.isArray(targets) && targets.length > 0) {
      for (const target of targets) {
        const layer = this.layers.find(l => l.id === target.layerId);
        const keyframe = layer?.keyframes.find(kf => kf.frame === Number(target.frame));
        if (layer && keyframe) {
          resolved.push({ layerId: layer.id, frame: keyframe.frame, keyframe: keyframe.clone() });
        }
      }
    } else {
      const layer = this.getActiveLayer();
      const keyframe = layer?.getKeyframeAtFrame(this.currentFrame);
      if (layer && keyframe) {
        resolved.push({ layerId: layer.id, frame: keyframe.frame, keyframe: keyframe.clone() });
      }
    }
    if (resolved.length === 0) return 0;

    const minFrame = Math.min(...resolved.map(item => item.frame));
    this._frameClipboard = {
      items: resolved.map(item => ({
        layerId: item.layerId,
        offset: item.frame - minFrame,
        isEmpty: item.keyframe.isEmpty,
        keyframe: item.keyframe
      }))
    };
    log.info('프레임 복사됨', { count: resolved.length });
    return resolved.length;
  }

  /**
   * 프레임 붙여넣기 (Ctrl+Alt+V)
   */
  pasteFrames(targetFrame = this.currentFrame) {
    const clip = this._frameClipboard;
    if (!clip?.items?.length) return 0;

    this.commitActiveSelection();
    this._saveToHistory();

    let pasted = 0;
    const updatedKeyframes = [];
    for (const item of clip.items) {
      const layer = this.layers.find(l => l.id === item.layerId) || this.getActiveLayer();
      if (!layer || layer.locked) continue;

      const frame = targetFrame + item.offset;
      if (frame < 0 || frame >= this.totalFrames) continue;

      layer.removeKeyframe(frame);
      const keyframe = item.keyframe.clone();
      keyframe.frame = frame;
      keyframe.isEmpty = item.isEmpty;
      layer.keyframes.push(keyframe);
      layer._sortKeyframes();
      updatedKeyframes.push({ layer, frame, keyframe });
      pasted += 1;
    }

    if (pasted > 0) {
      this.renderFrame(this.currentFrame);
      for (const { layer, frame, keyframe } of updatedKeyframes) {
        this._emit('keyframeUpdated', { layer, frame, keyframe });
      }
      this._emit('layersChanged');
      log.info('프레임 붙여넣기됨', { targetFrame, count: pasted });
    }
    return pasted;
  }

  /**
   * 키프레임 이동 (드래그로 이동)
   * @param {Array} keyframesToMove - [ { layerId, fromFrame, toFrame } ]
   */
  moveKeyframes(keyframesToMove) {
    this.commitActiveSelection();

    if (!keyframesToMove || keyframesToMove.length === 0) return false;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    let moved = false;

    // 충돌 방지를 위해 이동 방향에 따라 빈칸을 먼저 만든다.
    const sorted = [...keyframesToMove].sort((a, b) => {
      const layerCompare = String(a.layerId).localeCompare(String(b.layerId));
      if (layerCompare !== 0) return layerCompare;

      const frameDelta = (a.toFrame - a.fromFrame) || (b.toFrame - b.fromFrame);
      if (frameDelta < 0) return a.fromFrame - b.fromFrame;
      if (frameDelta > 0) return b.fromFrame - a.fromFrame;
      return 0;
    });

    for (const { layerId, fromFrame, toFrame } of sorted) {
      const layer = this.layers.find(l => l.id === layerId);
      if (!layer || layer.locked) continue;

      // 프레임 범위 검증
      if (toFrame < 0 || toFrame >= this.totalFrames) continue;

      // 키프레임 찾기
      const keyframe = layer.keyframes.find(kf => kf.frame === fromFrame);
      if (!keyframe) continue;

      // 대상 위치에 이미 키프레임이 있는지 확인
      const existingAtTarget = layer.keyframes.find(kf => kf.frame === toFrame);
      if (existingAtTarget && existingAtTarget !== keyframe) {
        log.warn('대상 위치에 이미 키프레임이 있습니다', { layerId, toFrame });
        continue;
      }

      // 키프레임 프레임 번호 변경
      keyframe.frame = toFrame;
      layer._sortKeyframes();
      moved = true;

      log.debug('키프레임 이동됨', { layerId, fromFrame, toFrame });
    }

    if (moved) {
      this._emit('layersChanged');
      this.renderFrame(this.currentFrame);
    }

    return moved;
  }

  /**
   * 비디오 정보 설정
   */
  setVideoInfo(totalFrames, fps) {
    this.totalFrames = totalFrames;
    this.fps = fps;
    log.debug('비디오 정보 설정됨', { totalFrames, fps });
  }

  /**
   * 캔버스 크기 설정
   */
  setCanvasSize(width, height) {
    const canvasSizeChanged = this.drawingCanvas?.canvas &&
      (this.drawingCanvas.canvas.width !== width || this.drawingCanvas.canvas.height !== height);
    if (canvasSizeChanged && (this.drawingCanvas.floatingImage || this.drawingCanvas.selection)) {
      this.commitActiveSelection();
    }

    this.canvasWidth = width;
    this.canvasHeight = height;
    this.drawingCanvas.syncSize(width, height);
    [this.layersBelowCanvas, this.layersAboveCanvas, this.selectionOverlayCanvas].forEach((canvas) => {
      this._setCanvasElementSize(canvas, width, height);
    });

    // 어니언 스킨 캔버스 크기도 동기화
    this._setCanvasElementSize(this.onionSkinCanvasElement, width, height);

    log.debug('캔버스 크기 설정됨', { width, height });
    this.renderFrame(this.currentFrame);
  }

  _setCanvasElementSize(canvas, width, height) {
    if (!canvas) return false;
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
  }

  /**
   * 현재 프레임 설정 및 렌더링
   */
  setCurrentFrame(frame) {
    // 같은 프레임이면 무시 (불필요한 렌더링 방지)
    if (frame === this.currentFrame) return;
    if (this.drawingCanvas.floatingImage || this.drawingCanvas.selection) {
      this.commitActiveSelection();
    }

    // 이전 프레임에서 그리기 중이었으면 저장
    if (this.drawingCanvas.isDrawing) {
      this._saveCurrentFrameData();
    }

    this.currentFrame = frame;
    this.renderFrame(frame);
  }

  _clearCanvasElement(canvas, ctx) {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  _clearStaticLayerCanvases() {
    this._clearCanvasElement(this.layersBelowCanvas, this.layersBelowCtx);
    this._clearCanvasElement(this.layersAboveCanvas, this.layersAboveCtx);
  }

  _getLayerRenderBuckets() {
    const { below, active, above } = partitionDrawingLayersForActive(this.layers, this.activeLayerId);
    return [
      { layers: below, ctx: this.layersBelowCtx, applyLayerOpacity: true },
      { layers: active ? [active] : [], ctx: this.drawingCanvas.ctx, applyLayerOpacity: false },
      { layers: above, ctx: this.layersAboveCtx, applyLayerOpacity: true }
    ];
  }

  _getActiveLayerDisplayOpacity() {
    const layer = this.getActiveLayer();
    if (!layer || layer.visible === false) return 1;
    const opacity = Number(layer.opacity);
    return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  }

  _syncActiveLayerCanvasOpacity() {
    const opacity = this._getActiveLayerDisplayOpacity();
    if (this.canvas?.style) {
      this.canvas.style.opacity = String(opacity);
    }
    this.drawingCanvas?.setSelectionImageOpacity?.(opacity);
  }

  _drawImageToContext(ctx, img, opacity) {
    if (!ctx || !img) return;
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * 특정 프레임 렌더링 (모든 보이는 레이어 합성)
   */
  async renderFrame(frame) {
    this._syncActiveLayerCanvasOpacity();

    if (this.drawingCanvas.floatingImage) {
      log.debug('플로팅 선택 영역이 있어 렌더링 보류', { frame });
      return;
    }

    // 그리기 중이면 렌더링 스킵 (사용자가 그리는 중에 캔버스 지우기 방지)
    if (this.drawingCanvas.isDrawing) {
      log.debug('그리기 중이므로 렌더링 스킵', { frame });
      return;
    }

    // 렌더링 ID 증가 (이전 렌더링 취소용)
    const currentRenderingId = ++this._renderingId;

    // 재생 중이면 빠른 동기 렌더링 (clear 없이 먼저 그린 뒤 교체)
    if (this.isPlaying) {
      this._renderFrameSync(frame);
      this._schedulePlaybackPreload(frame);
      return;
    }

    // 일시정지 상태에서만 캔버스 초기화
    this._playbackCanvasCleared = false;
    this.drawingCanvas.clear();
    this._clearStaticLayerCanvases();
    this._clearOnionSkinCanvas();

    log.debug('renderFrame 시작', {
      frame,
      layersCount: this.layers.length,
      onionSkin: this.onionSkin.enabled,
      renderingId: currentRenderingId
    });

    // 어니언 스킨 먼저 렌더링 (현재 프레임 아래에 표시)
    if (this.onionSkin.enabled) {
      await this._renderOnionSkin(frame, currentRenderingId);

      // 렌더링 취소 체크
      if (this._renderingId !== currentRenderingId) {
        log.debug('어니언 스킨 후 렌더링 취소', { frame, currentRenderingId });
        return;
      }
    }

    // 렌더링할 이미지들을 먼저 모두 로드
    const imagesToRender = [];

    for (const bucket of this._getLayerRenderBuckets()) {
      for (const layer of bucket.layers) {
        if (!layer.visible) continue;

        const keyframe = layer.getKeyframeAtFrame(frame);

        if (!keyframe || keyframe.isEmpty || !keyframe.canvasData) continue;

        // 이미지 캐시 확인 또는 새로 로드
        const img = await this._loadImage(keyframe.canvasData, keyframe);
        if (img) {
          const opacity = bucket.applyLayerOpacity === false ? 1 : layer.opacity;
          imagesToRender.push({ img, layer, ctx: bucket.ctx, opacity });
        }

        // 렌더링 취소 체크
        if (this._renderingId !== currentRenderingId) {
          log.debug('이미지 로드 중 렌더링 취소', { frame, currentRenderingId });
          return;
        }
      }
    }

    // 최종 렌더링 취소 체크
    if (this._renderingId !== currentRenderingId || this.currentFrame !== frame) {
      log.debug('최종 렌더링 취소', { frame, currentFrame: this.currentFrame });
      return;
    }

    // 모든 이미지를 순서대로 그리기
    for (const { img, opacity, ctx } of imagesToRender) {
      this._drawImageToContext(ctx, img, opacity);
    }

    log.debug('renderFrame 완료', { frame, renderedCount: imagesToRender.length });
    this._emit('frameRendered', { frame });
  }

  /**
   * 동기적 프레임 렌더링 (재생 중 성능 최적화)
   * clear → draw를 원자적으로 수행하여 깜빡임 방지
   * 캐시된 이미지만 사용, 캐시 미스 시 비동기 프리로드 후 다음 기회에 표시
   */
  _renderFrameSync(frame) {
    this._syncActiveLayerCanvasOpacity();

    // 캐시된 이미지를 먼저 수집
    const images = [];
    let hasCacheMiss = false;

    for (const bucket of this._getLayerRenderBuckets()) {
      for (const layer of bucket.layers) {
        if (!layer.visible) continue;

        const keyframe = layer.getKeyframeAtFrame(frame);
        if (!keyframe || keyframe.isEmpty || !keyframe.canvasData) continue;

        if (keyframe._cachedImage && keyframe._cachedSrc === keyframe.canvasData) {
          const opacity = bucket.applyLayerOpacity === false ? 1 : layer.opacity;
          images.push({ img: keyframe._cachedImage, opacity, ctx: bucket.ctx });
        } else {
          hasCacheMiss = true;
        }
      }
    }

    if (images.length === 0 && !hasCacheMiss) {
      if (!this._playbackCanvasCleared) {
        this.drawingCanvas.clear({ silent: true });
        this._clearStaticLayerCanvases();
        this._playbackCanvasCleared = true;
      }
      return;
    }

    // clear + draw를 원자적으로 수행 (깜빡임 방지)
    this.drawingCanvas.clear({ silent: true });
    this._clearStaticLayerCanvases();
    this._playbackCanvasCleared = images.length === 0 && !hasCacheMiss;
    for (const { img, opacity, ctx } of images) {
      this._drawImageToContext(ctx, img, opacity);
    }

    // 캐시 미스가 있으면 백그라운드에서 로드 (다음 프레임에서 사용됨)
    if (hasCacheMiss) {
      this._preloadMissingImages(frame);
    }
  }

  /**
   * 캐시 미스 이미지 백그라운드 로드 (fire-and-forget)
   */
  async _preloadMissingImages(frame) {
    for (const layer of this.layers) {
      if (!layer.visible) continue;

      const keyframe = layer.getKeyframeAtFrame(frame);
      if (!keyframe || keyframe.isEmpty || !keyframe.canvasData) continue;
      if (keyframe._cachedImage && keyframe._cachedSrc === keyframe.canvasData) continue;

      await this._loadImage(keyframe.canvasData, keyframe);
    }
  }

  /**
   * 이미지 로드 (캐싱 지원)
   */
  _loadImage(src, keyframe) {
    return new Promise((resolve) => {
      // 캐시된 이미지가 있으면 사용
      if (keyframe._cachedImage && keyframe._cachedSrc === src) {
        resolve(keyframe._cachedImage);
        return;
      }

      const img = new Image();
      img.onload = () => {
        // 캐시에 저장
        keyframe._cachedImage = img;
        keyframe._cachedSrc = src;
        resolve(img);
      };
      img.onerror = () => {
        log.error('이미지 로드 실패');
        resolve(null);
      };
      img.src = src;
    });
  }

  /**
   * 모든 레이어 데이터 가져오기 (저장용)
   */
  exportData() {
    if (this.drawingCanvas?.floatingImage) {
      this.commitActiveSelection();
    }

    return {
      layers: this.layers.map(l => l.toJSON()),
      activeLayerId: this.activeLayerId,
      totalFrames: this.totalFrames,
      fps: this.fps
    };
  }

  /**
   * 레이어 데이터 불러오기
   */
  importData(data) {
    this.drawingCanvas.clearSelection?.();
    this.layers = data.layers.map(l => DrawingLayer.fromJSON(l));
    this.activeLayerId = data.activeLayerId;
    this.totalFrames = data.totalFrames || this.totalFrames;
    this.fps = data.fps || this.fps;

    // ID 충돌 방지: 로드된 레이어들의 ID를 기반으로 nextId 업데이트
    DrawingLayer.updateNextIdFromLayers(this.layers);

    this._emit('layersChanged');
    this.renderFrame(this.currentFrame);

    log.info('레이어 데이터 불러옴', { layerCount: this.layers.length });
  }

  /**
   * 모든 레이어 초기화
   */
  clearAll() {
    this.drawingCanvas.clearSelection?.();
    this.layers = [];
    this.activeLayerId = null;
    this.drawingCanvas.clear();
    this._clearStaticLayerCanvases();

    this._emit('layersChanged');
    log.info('모든 레이어 초기화됨');
  }

  /**
   * 새 파일 로드 시 초기화 (기본 레이어 생성 포함)
   */
  reset() {
    this.drawingCanvas.clearSelection?.();
    this.layers = [];
    this.activeLayerId = null;
    this.drawingCanvas.clear();
    this._clearStaticLayerCanvases();
    this.clearHistory();

    // ID 충돌 방지: nextId를 1로 리셋
    DrawingLayer.resetNextId();

    // 기본 레이어 생성
    this.createLayer({ name: '레이어 1' }, false);

    this._emit('layersChanged');
    log.info('DrawingManager 초기화됨 (기본 레이어 생성)');
  }

  /**
   * 그리기 도구 설정
   */
  setTool(tool) {
    this.drawingCanvas.setTool(tool);
  }

  /**
   * 지우개 방식 설정
   */
  setEraserMode(mode) {
    this.eraserMode = normalizeEraserMode(mode);
    this.drawingCanvas.setEraserMode(this.eraserMode);
  }

  /**
   * 색상 설정
   */
  setColor(color) {
    this.drawingCanvas.setColor(color);
  }

  /**
   * 선 두께 설정
   */
  setLineWidth(width) {
    this.drawingCanvas.setLineWidth(width);
  }

  /**
   * 투명도 설정
   */
  setOpacity(opacity) {
    this.drawingCanvas.setOpacity(opacity);
  }

  /**
   * 레이어 투명도 설정
   */
  setLayerOpacity(layerId, opacity) {
    const layer = this.layers.find(l => l.id === layerId);
    if (!layer) return;

    layer.opacity = Math.max(0, Math.min(1, opacity));
    this.renderFrame(this.currentFrame);
    // layersChanged를 발행하지 않음 → 전체 레이어 헤더 재렌더링 방지 (슬라이더 버벅임 해결)
    log.debug('레이어 투명도 변경', { layerId, opacity: layer.opacity });
  }

  /**
   * 레이어 이름 변경
   */
  setLayerName(layerId, name) {
    const layer = this.layers.find(l => l.id === layerId);
    if (!layer) return;

    layer.name = name;
    this._emit('layersChanged');
    log.debug('레이어 이름 변경', { layerId, name });
  }

  /**
   * 레이어 색상 변경
   */
  setLayerColor(layerId, color) {
    const layer = this.layers.find(l => l.id === layerId);
    if (!layer) return;

    layer.color = color;
    this._emit('layersChanged');
    log.debug('레이어 색상 변경', { layerId, color });
  }

  /**
   * 외곽선 활성화/비활성화
   */
  setStrokeEnabled(enabled) {
    this.drawingCanvas.setStrokeEnabled(enabled);
  }

  /**
   * 외곽선 두께 설정
   */
  setStrokeWidth(width) {
    this.drawingCanvas.setStrokeWidth(width);
  }

  /**
   * 외곽선 색상 설정
   */
  setStrokeColor(color) {
    this.drawingCanvas.setStrokeColor(color);
  }

  /**
   * 현재 도구 가져오기
   */
  getCurrentTool() {
    return this.drawingCanvas.tool;
  }

  // ====== 어니언 스킨 ======

  /**
   * 어니언 스킨 캔버스 초기화
   */
  _clearOnionSkinCanvas() {
    if (this.onionSkinCtx && this.onionSkinCanvasElement) {
      this.onionSkinCtx.clearRect(
        0, 0,
        this.onionSkinCanvasElement.width,
        this.onionSkinCanvasElement.height
      );
    }
  }

  /**
   * 어니언 스킨 설정
   */
  setOnionSkin(enabled, options = {}) {
    this.onionSkin.enabled = enabled;
    if (options.before !== undefined) this.onionSkin.before = options.before;
    if (options.after !== undefined) this.onionSkin.after = options.after;
    if (options.opacity !== undefined) this.onionSkin.opacity = options.opacity;

    log.info('어니언 스킨 설정', this.onionSkin);

    // 어니언 스킨 끄면 캔버스 초기화
    if (!enabled) {
      this._clearOnionSkinCanvas();
    }

    // 현재 프레임 다시 렌더링
    this.renderFrame(this.currentFrame);
  }

  /**
   * 어니언 스킨 렌더링 (별도 캔버스에 렌더링)
   */
  async _renderOnionSkin(currentFrame, renderingId) {
    if (!this.onionSkin.enabled) return;
    if (!this.onionSkinCtx || !this.onionSkinCanvasElement) {
      log.warn('어니언 스킨 캔버스가 없습니다');
      return;
    }

    // 이전 프레임들 (파란색 틴트) - 가장 먼 것부터
    for (let i = this.onionSkin.before; i >= 1; i--) {
      const frame = currentFrame - i;
      if (frame < 0) continue;

      // 렌더링 취소 체크
      if (this._renderingId !== renderingId) return;

      // 가까울수록 진하게 (i=1이 가장 가까움)
      const opacity = this.onionSkin.opacity * (1 - (i - 1) / Math.max(this.onionSkin.before, 1));
      await this._renderOnionFrame(frame, opacity, 'rgba(100, 149, 237, 0.6)'); // 파란색
    }

    // 이후 프레임들 (녹색 틴트)
    for (let i = 1; i <= this.onionSkin.after; i++) {
      const frame = currentFrame + i;
      if (frame >= this.totalFrames) continue;

      // 렌더링 취소 체크
      if (this._renderingId !== renderingId) return;

      const opacity = this.onionSkin.opacity * (1 - (i - 1) / Math.max(this.onionSkin.after, 1));
      await this._renderOnionFrame(frame, opacity, 'rgba(50, 205, 50, 0.6)'); // 녹색
    }
  }

  /**
   * 어니언 스킨 단일 프레임 렌더링 (어니언 스킨 전용 캔버스에 렌더링)
   * @param {number} frame - 렌더링할 프레임 (현재 프레임이 아닌 어니언 스킨 대상 프레임)
   */
  async _renderOnionFrame(frame, opacity, tintColor) {
    // 어니언 스킨 전용 캔버스 사용
    const ctx = this.onionSkinCtx;
    if (!ctx) return;

    for (const layer of this.layers) {
      if (!layer.visible) continue;

      // 해당 프레임에서 실제로 보이는 키프레임 찾기
      const keyframe = layer.getKeyframeAtFrame(frame);

      // 키프레임이 없거나 데이터가 없으면 스킵
      // 단, 빈 키프레임(isEmpty)인 경우에도 스킵 (빈 키프레임은 의도적으로 비운 것)
      if (!keyframe || !keyframe.canvasData) continue;

      // 빈 키프레임은 어니언 스킨에서도 표시하지 않음
      if (keyframe.isEmpty) continue;

      const img = await this._loadImage(keyframe.canvasData, keyframe);
      if (!img) continue;

      // 임시 캔버스에 이미지 그리기 (틴트 적용)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = this.onionSkinCanvasElement.width;
      tempCanvas.height = this.onionSkinCanvasElement.height;
      const tempCtx = tempCanvas.getContext('2d');

      tempCtx.drawImage(img, 0, 0);

      // 틴트 오버레이
      tempCtx.globalCompositeOperation = 'source-atop';
      tempCtx.fillStyle = tintColor;
      tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      // 어니언 스킨 캔버스에 그리기 (그리기 캔버스와 분리)
      ctx.globalAlpha = opacity;
      ctx.drawImage(tempCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
  }

  // ====== 재생 성능 개선 ======

  /**
   * 재생 상태 설정
   */
  setPlaying(isPlaying) {
    this.isPlaying = isPlaying;
    this._playbackCanvasCleared = false;
    if (isPlaying) {
      // 재생 시작 시 주변 프레임 프리로드
      this._schedulePlaybackPreload(this.currentFrame, { force: true });
    }
  }

  _hasVisibleDrawableContent() {
    return this.layers.some(layer => (
      layer?.visible &&
      Array.isArray(layer.keyframes) &&
      layer.keyframes.some(keyframe => keyframe && !keyframe.isEmpty && keyframe.canvasData)
    ));
  }

  _schedulePlaybackPreload(centerFrame, options = {}) {
    if (!this._hasVisibleDrawableContent()) return;
    if (this._preloadInFlight) return;

    const frame = Number(centerFrame);
    if (!Number.isFinite(frame)) return;

    const minDistance = Math.max(1, Math.floor(this.preloadRange / 2));
    if (
      options.force !== true &&
      Number.isFinite(this._lastPlaybackPreloadCenterFrame) &&
      Math.abs(frame - this._lastPlaybackPreloadCenterFrame) < minDistance
    ) {
      return;
    }

    this._preloadInFlight = true;
    this._lastPlaybackPreloadCenterFrame = frame;
    this._preloadFrames(frame)
      .catch(error => {
        log.warn('재생 중 드로잉 프리로드 실패', { frame, error: error.message });
      })
      .finally(() => {
        this._preloadInFlight = false;
      });
  }

  /**
   * 프레임 프리로드
   */
  async _preloadFrames(centerFrame) {
    const startFrame = Math.max(0, centerFrame - this.preloadRange);
    const endFrame = Math.min(this.totalFrames - 1, centerFrame + this.preloadRange);

    for (let frame = startFrame; frame <= endFrame; frame++) {
      if (this.preloadedFrames.has(frame)) continue;

      // 해당 프레임의 모든 레이어 이미지 프리로드
      for (const layer of this.layers) {
        if (!layer.visible) continue;

        const keyframe = layer.getKeyframeAtFrame(frame);
        if (!keyframe || keyframe.isEmpty || !keyframe.canvasData) continue;

        // 이미지 프리로드 (캐시에 저장됨)
        await this._loadImage(keyframe.canvasData, keyframe);
      }

      this.preloadedFrames.set(frame, true);
    }

    // LRU 방식 캐시 정리: 프리로드 범위 밖의 오래된 캐시 삭제
    this._cleanupCacheOutsideRange(startFrame, endFrame);
  }

  /**
   * 프리로드 범위 밖의 캐시 정리 (LRU)
   * 주의: 키프레임의 이미지 캐시(_cachedImage)는 삭제하지 않음
   * getKeyframeAtFrame()이 여러 프레임에서 같은 키프레임을 공유하므로,
   * 범위 밖 프레임의 캐시를 삭제하면 범위 안 프레임에서도 이미지가 사라질 수 있음
   */
  _cleanupCacheOutsideRange(startFrame, endFrame) {
    // preloadedFrames 맵에서 범위 밖 항목 제거
    const framesToRemove = [];
    for (const frame of this.preloadedFrames.keys()) {
      if (frame < startFrame - this.preloadRange || frame > endFrame + this.preloadRange) {
        framesToRemove.push(frame);
      }
    }

    // 최대 캐시 크기 초과 시 추가 정리
    if (this.preloadedFrames.size > this.maxCacheSize) {
      const excess = this.preloadedFrames.size - this.maxCacheSize;
      const iterator = this.preloadedFrames.keys();
      for (let i = 0; i < excess; i++) {
        const frame = iterator.next().value;
        if (!framesToRemove.includes(frame)) {
          framesToRemove.push(frame);
        }
      }
    }

    // preloadedFrames 맵에서만 제거 (키프레임 이미지 캐시는 유지)
    for (const frame of framesToRemove) {
      this.preloadedFrames.delete(frame);
    }

    // 재생 중 자주 호출되는 정상 LRU 정리라 콘솔/로그 패널에는 남기지 않는다.
  }

  /**
   * 프리로드 캐시 클리어
   */
  clearPreloadCache() {
    this.preloadedFrames.clear();
  }

  /**
   * 커스텀 이벤트 발생
   */
  _emit(eventName, detail = {}) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  /**
   * 정리
   */
  destroy() {
    this.drawingCanvas.destroy();
    this.layers = [];
    this.preloadedFrames.clear();
    log.info('DrawingManager 정리됨');
  }
}

export { DrawingTool };
export default DrawingManager;
