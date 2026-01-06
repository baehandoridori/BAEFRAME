/**
 * baeframe - Drawing Manager Module
 * 그리기 레이어, 캔버스, 타임라인 통합 관리
 */

import { createLogger } from '../logger.js';
import { DrawingLayer, Keyframe } from './drawing-layer.js';
import { DrawingCanvas, DrawingTool } from './drawing-canvas.js';

const log = createLogger('DrawingManager');

/**
 * 드로잉 매니저 클래스
 */
export class DrawingManager extends EventTarget {
  constructor(options = {}) {
    super();

    // 캔버스 요소
    this.canvas = options.canvas;
    this.drawingCanvas = new DrawingCanvas(this.canvas);

    // 어니언 스킨 전용 캔버스 (별도 레이어)
    this.onionSkinCanvasElement = options.onionSkinCanvas;
    this.onionSkinCtx = this.onionSkinCanvasElement?.getContext('2d');

    // 레이어 관리
    this.layers = [];
    this.activeLayerId = null;

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

    // 렌더링 상태 관리
    this._renderingId = 0;  // 렌더링 취소용 ID

    // Undo/Redo 히스토리
    this.history = [];
    this.historyIndex = -1;
    this.maxHistorySize = 50;  // 최대 히스토리 개수
    this._isUndoingOrRedoing = false;  // undo/redo 중인지 여부

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

    // 그리기 완료 시
    this.drawingCanvas.addEventListener('drawend', (e) => {
      this._onDrawEnd(e.detail);
    });
  }

  /**
   * 그리기 시작 처리
   */
  _onDrawStart(detail) {
    // 레이어가 없으면 새 레이어 생성
    if (this.layers.length === 0 || !this.activeLayerId) {
      this.createLayer();
    }

    const layer = this.getActiveLayer();
    if (!layer) return;

    // Undo를 위해 현재 상태 저장 (그리기 시작 전)
    if (!this._isUndoingOrRedoing) {
      this._saveToHistory();
    }

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

    this._emit('drawstart', { layer, frame: this.currentFrame });
  }

  /**
   * 그리기 완료 처리
   */
  _onDrawEnd(detail) {
    // 현재 키프레임에 캔버스 데이터 저장
    this._saveCurrentFrameData();

    this._emit('drawend', { frame: this.currentFrame });
    this._emit('layersChanged');
  }

  /**
   * 현재 프레임의 캔버스 데이터 저장
   */
  _saveCurrentFrameData() {
    const layer = this.getActiveLayer();
    if (!layer) {
      log.warn('저장 실패: 활성 레이어 없음');
      return;
    }

    // 현재 프레임에 해당하는 키프레임 찾기
    let keyframe = layer.getKeyframeAtFrame(this.currentFrame);

    // 키프레임이 없거나 정확히 현재 프레임이 아닌 경우
    // → 현재 프레임에 새 키프레임 생성 (덧그린 내용을 새 키프레임으로)
    if (!keyframe || keyframe.frame !== this.currentFrame) {
      keyframe = layer.getOrCreateKeyframe(this.currentFrame, true);
    }

    // 캔버스 데이터 저장
    const imageData = this.drawingCanvas.toDataURL();
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
  }

  /**
   * 새 레이어 생성
   */
  createLayer(options = {}, saveHistory = true) {
    // Undo를 위해 현재 상태 저장
    if (saveHistory && this.layers.length > 0) {
      this._saveToHistory();
    }

    const layer = new DrawingLayer(options);
    this.layers.push(layer);
    this.activeLayerId = layer.id;

    this._emit('layerCreated', { layer });
    this._emit('layersChanged');

    log.info('새 레이어 생성됨', { id: layer.id, name: layer.name });
    return layer;
  }

  /**
   * 레이어 삭제
   */
  deleteLayer(layerId) {
    const index = this.layers.findIndex(l => l.id === layerId);
    if (index === -1) return false;

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
      this.activeLayerId = layerId;
      this._emit('activeLayerChanged', { layer });
      log.debug('활성 레이어 변경', { id: layerId });
    }
  }

  /**
   * 레이어 가시성 토글
   */
  toggleLayerVisibility(layerId) {
    const layer = this.layers.find(l => l.id === layerId);
    if (layer) {
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
      layer.locked = !layer.locked;
      this._emit('layersChanged');
    }
  }

  // ====== Undo/Redo ======

  /**
   * 현재 상태를 히스토리에 저장
   */
  _saveToHistory() {
    // 현재 위치 이후의 히스토리 제거 (새 변경 시 redo 히스토리 삭제)
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // 현재 상태 스냅샷 생성
    const snapshot = {
      layers: this.layers.map(l => l.toJSON()),
      activeLayerId: this.activeLayerId,
      currentFrame: this.currentFrame
    };

    this.history.push(snapshot);

    // 최대 개수 초과 시 오래된 것 제거
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    } else {
      this.historyIndex = this.history.length - 1;
    }

    log.debug('히스토리 저장', { index: this.historyIndex, total: this.history.length });
  }

  /**
   * 실행 취소 (Undo)
   */
  undo() {
    if (this.historyIndex < 0) {
      log.debug('Undo 불가: 히스토리 없음');
      return false;
    }

    this._isUndoingOrRedoing = true;

    const snapshot = this.history[this.historyIndex];
    this._restoreSnapshot(snapshot);
    this.historyIndex--;

    this._isUndoingOrRedoing = false;

    log.info('Undo 실행', { index: this.historyIndex });
    this._emit('undo');
    return true;
  }

  /**
   * 다시 실행 (Redo)
   */
  redo() {
    if (this.historyIndex >= this.history.length - 1) {
      log.debug('Redo 불가: 앞으로 갈 히스토리 없음');
      return false;
    }

    this._isUndoingOrRedoing = true;

    this.historyIndex++;
    const snapshot = this.history[this.historyIndex + 1] || this.history[this.historyIndex];
    this._restoreSnapshot(snapshot);

    this._isUndoingOrRedoing = false;

    log.info('Redo 실행', { index: this.historyIndex });
    this._emit('redo');
    return true;
  }

  /**
   * 스냅샷에서 상태 복원
   */
  _restoreSnapshot(snapshot) {
    if (!snapshot) return;

    // 레이어 복원
    this.layers = snapshot.layers.map(l => DrawingLayer.fromJSON(l));
    this.activeLayerId = snapshot.activeLayerId;

    // UI 업데이트
    this._emit('layersChanged');
    this.renderFrame(this.currentFrame);
  }

  /**
   * Undo 가능 여부
   */
  canUndo() {
    return this.historyIndex >= 0;
  }

  /**
   * Redo 가능 여부
   */
  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  /**
   * 히스토리 초기화
   */
  clearHistory() {
    this.history = [];
    this.historyIndex = -1;
    log.debug('히스토리 초기화됨');
  }

  /**
   * 빈 키프레임 추가 (F7)
   */
  addBlankKeyframe() {
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
    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return;

    // 첫 번째 키프레임은 삭제 불가
    if (layer.keyframes.length <= 1 && layer.isKeyframe(this.currentFrame)) {
      log.warn('마지막 키프레임은 삭제할 수 없습니다.');
      return;
    }

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.removeKeyframe(this.currentFrame);
    this.renderFrame(this.currentFrame);

    this._emit('keyframeRemoved', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
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
    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return false;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    layer.deleteFrame(this.currentFrame);
    this.renderFrame(this.currentFrame);

    this._emit('frameDeleted', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
    return true;
  }

  /**
   * 키프레임 이동 (드래그로 이동)
   * @param {Array} keyframesToMove - [ { layerId, fromFrame, toFrame } ]
   */
  moveKeyframes(keyframesToMove) {
    if (!keyframesToMove || keyframesToMove.length === 0) return false;

    // Undo를 위해 현재 상태 저장
    this._saveToHistory();

    let moved = false;

    // 충돌 방지를 위해 뒤에서부터 처리 (프레임이 높은 것부터)
    const sorted = [...keyframesToMove].sort((a, b) => b.fromFrame - a.fromFrame);

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
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.drawingCanvas.syncSize(width, height);

    // 어니언 스킨 캔버스 크기도 동기화
    if (this.onionSkinCanvasElement) {
      this.onionSkinCanvasElement.width = width;
      this.onionSkinCanvasElement.height = height;
    }

    log.debug('캔버스 크기 설정됨', { width, height });
  }

  /**
   * 현재 프레임 설정 및 렌더링
   */
  setCurrentFrame(frame) {
    // 같은 프레임이면 무시 (불필요한 렌더링 방지)
    if (frame === this.currentFrame) return;

    // 이전 프레임에서 그리기 중이었으면 저장
    if (this.drawingCanvas.isDrawing) {
      this._saveCurrentFrameData();
    }

    this.currentFrame = frame;
    this.renderFrame(frame);
  }

  /**
   * 특정 프레임 렌더링 (모든 보이는 레이어 합성)
   */
  async renderFrame(frame) {
    // 그리기 중이면 렌더링 스킵 (사용자가 그리는 중에 캔버스 지우기 방지)
    if (this.drawingCanvas.isDrawing) {
      log.debug('그리기 중이므로 렌더링 스킵', { frame });
      return;
    }

    // 렌더링 ID 증가 (이전 렌더링 취소용)
    const currentRenderingId = ++this._renderingId;

    // 캔버스 초기화 (그리기 캔버스 + 어니언 스킨 캔버스)
    this.drawingCanvas.clear();
    this._clearOnionSkinCanvas();

    // 재생 중이면 빠른 동기 렌더링
    if (this.isPlaying) {
      this._renderFrameSync(frame);
      this._preloadFrames(frame);
      return;
    }

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

    for (const layer of this.layers) {
      if (!layer.visible) continue;

      const keyframe = layer.getKeyframeAtFrame(frame);

      if (!keyframe || keyframe.isEmpty || !keyframe.canvasData) continue;

      // 이미지 캐시 확인 또는 새로 로드
      const img = await this._loadImage(keyframe.canvasData, keyframe);
      if (img) {
        imagesToRender.push({ img, layer });
      }

      // 렌더링 취소 체크
      if (this._renderingId !== currentRenderingId) {
        log.debug('이미지 로드 중 렌더링 취소', { frame, currentRenderingId });
        return;
      }
    }

    // 최종 렌더링 취소 체크
    if (this._renderingId !== currentRenderingId || this.currentFrame !== frame) {
      log.debug('최종 렌더링 취소', { frame, currentFrame: this.currentFrame });
      return;
    }

    // 모든 이미지를 순서대로 그리기
    for (const { img, layer } of imagesToRender) {
      this.drawingCanvas.ctx.globalAlpha = layer.opacity;
      this.drawingCanvas.ctx.drawImage(img, 0, 0);
      this.drawingCanvas.ctx.globalAlpha = 1;
    }

    log.debug('renderFrame 완료', { frame, renderedCount: imagesToRender.length });
    this._emit('frameRendered', { frame });
  }

  /**
   * 동기적 프레임 렌더링 (재생 중 성능 최적화)
   * 캐시된 이미지만 사용, 없으면 스킵
   */
  _renderFrameSync(frame) {
    for (const layer of this.layers) {
      if (!layer.visible) continue;

      const keyframe = layer.getKeyframeAtFrame(frame);
      if (!keyframe || keyframe.isEmpty || !keyframe.canvasData) continue;

      // 캐시된 이미지만 사용 (없으면 스킵)
      if (keyframe._cachedImage && keyframe._cachedSrc === keyframe.canvasData) {
        this.drawingCanvas.ctx.globalAlpha = layer.opacity;
        this.drawingCanvas.ctx.drawImage(keyframe._cachedImage, 0, 0);
        this.drawingCanvas.ctx.globalAlpha = 1;
      }
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
    this.layers = [];
    this.activeLayerId = null;
    this.drawingCanvas.clear();

    this._emit('layersChanged');
    log.info('모든 레이어 초기화됨');
  }

  /**
   * 새 파일 로드 시 초기화 (기본 레이어 생성 포함)
   */
  reset() {
    this.layers = [];
    this.activeLayerId = null;
    this.drawingCanvas.clear();
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
    if (isPlaying) {
      // 재생 시작 시 주변 프레임 프리로드
      this._preloadFrames(this.currentFrame);
    }
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
