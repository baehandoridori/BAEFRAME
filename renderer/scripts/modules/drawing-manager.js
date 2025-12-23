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
    if (!layer) return;

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

    log.debug('프레임 데이터 저장됨', {
      layerId: layer.id,
      frame: this.currentFrame
    });
  }

  /**
   * 새 레이어 생성
   */
  createLayer(options = {}) {
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

  /**
   * 빈 키프레임 추가 (F7)
   */
  addBlankKeyframe() {
    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return;

    layer.addBlankKeyframe(this.currentFrame);
    this.drawingCanvas.clear();

    this._emit('keyframeAdded', { layer, frame: this.currentFrame, blank: true });
    this._emit('layersChanged');
  }

  /**
   * 키프레임 복제 추가 (F6)
   */
  addKeyframeWithContent() {
    const layer = this.getActiveLayer();
    if (!layer || layer.locked) return;

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

    layer.removeKeyframe(this.currentFrame);
    this.renderFrame(this.currentFrame);

    this._emit('keyframeRemoved', { layer, frame: this.currentFrame });
    this._emit('layersChanged');
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
    log.debug('캔버스 크기 설정됨', { width, height });
  }

  /**
   * 현재 프레임 설정 및 렌더링
   */
  setCurrentFrame(frame) {
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
  renderFrame(frame) {
    // 캔버스 초기화
    this.drawingCanvas.clear();

    // 아래 레이어부터 위로 합성
    for (const layer of this.layers) {
      if (!layer.visible) continue;

      const keyframe = layer.getKeyframeAtFrame(frame);
      if (!keyframe || keyframe.isEmpty) continue;

      // 키프레임의 이미지 데이터 그리기
      if (keyframe.canvasData) {
        const img = new Image();
        img.onload = () => {
          this.drawingCanvas.ctx.globalAlpha = layer.opacity;
          this.drawingCanvas.ctx.drawImage(img, 0, 0);
          this.drawingCanvas.ctx.globalAlpha = 1;
        };
        img.src = keyframe.canvasData;
      }
    }

    this._emit('frameRendered', { frame });
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
    log.info('DrawingManager 정리됨');
  }
}

export { DrawingTool };
export default DrawingManager;
