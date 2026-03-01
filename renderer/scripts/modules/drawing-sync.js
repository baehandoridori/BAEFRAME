/**
 * BAEFRAME - Drawing Sync (Broadcast 기반)
 * DrawingManager ↔ Liveblocks Broadcast 양방향 동기화
 *
 * 전략:
 * - 캔버스 데이터 (Base64 PNG): Broadcast
 * - 실시간 스트로크 스트리밍: Broadcast
 * - 레이어 생성/삭제: Broadcast
 * - .bframe 파일 저장은 기존 auto-save가 처리
 */

import { createLogger } from '../logger.js';

const log = createLogger('DrawingSync');

// Broadcast 메시지 사이즈 제한 (1MB)
const MAX_BROADCAST_SIZE = 1024 * 1024;

/**
 * 그리기 동기화 매니저 (Broadcast 기반)
 */
export class DrawingSync {
  constructor({ liveblocksManager, drawingManager }) {
    this._lm = liveblocksManager;
    this._dm = drawingManager;

    this._isRemoteUpdate = false;

    // 실시간 스트로크 스트리밍용
    this._strokeBuffer = [];
    this._strokeFlushTimer = null;
    this._isStroking = false;

    // 이벤트 핸들러 바인딩
    this._onDrawStart = this._onDrawStart.bind(this);
    this._onDrawMove = this._onDrawMove.bind(this);
    this._onDrawEnd = this._onDrawEnd.bind(this);
    this._onLayerCreated = this._onLayerCreated.bind(this);
    this._onLayerDeleted = this._onLayerDeleted.bind(this);
    this._onKeyframeRemoved = this._onKeyframeRemoved.bind(this);
    this._onBroadcast = this._onBroadcast.bind(this);

    this._started = false;

    log.info('DrawingSync 초기화됨 (Broadcast 모드)');
  }

  /**
   * 동기화 시작
   */
  start() {
    if (this._started) return;

    // Local → Remote 이벤트 리스너 (스트로크 스트리밍 포함)
    const drawingCanvas = this._dm.drawingCanvas;
    if (drawingCanvas) {
      drawingCanvas.addEventListener('drawstart', this._onDrawStart);
      drawingCanvas.addEventListener('drawmove', this._onDrawMove);
    }
    this._dm.addEventListener('drawend', this._onDrawEnd);
    this._dm.addEventListener('layerCreated', this._onLayerCreated);
    this._dm.addEventListener('layerDeleted', this._onLayerDeleted);
    this._dm.addEventListener('keyframeRemoved', this._onKeyframeRemoved);

    // Remote → Local: Broadcast 수신
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);

    this._started = true;
    log.info('그리기 동기화 시작됨 (Broadcast 모드)');
  }

  /**
   * 동기화 중지
   */
  stop() {
    const drawingCanvas = this._dm.drawingCanvas;
    if (drawingCanvas) {
      drawingCanvas.removeEventListener('drawstart', this._onDrawStart);
      drawingCanvas.removeEventListener('drawmove', this._onDrawMove);
    }
    this._dm.removeEventListener('drawend', this._onDrawEnd);
    this._dm.removeEventListener('layerCreated', this._onLayerCreated);
    this._dm.removeEventListener('layerDeleted', this._onLayerDeleted);
    this._dm.removeEventListener('keyframeRemoved', this._onKeyframeRemoved);
    this._lm.removeEventListener('broadcastReceived', this._onBroadcast);

    this._started = false;
    log.info('그리기 동기화 중지됨');
  }

  /**
   * Remote 변경 여부
   */
  get isRemoteUpdate() {
    return this._isRemoteUpdate;
  }

  // ============================================================================
  // Local → Remote
  // ============================================================================

  /**
   * 스트로크 시작 → 상대방에게 브러시 설정 전송
   */
  _onDrawStart(e) {
    if (this._isRemoteUpdate) return;
    if (!this._lm.hasOtherCollaborators()) return;

    const { x, y, tool } = e.detail || {};
    const layer = this._dm.getActiveLayer?.() || this._dm.activeLayer;
    if (!layer) return;

    const canvas = this._dm.drawingCanvas;
    this._isStroking = true;
    this._strokeBuffer = [];

    this._lm.broadcastEvent({
      type: 'STROKE_START',
      layerId: layer.id,
      frame: this._dm.currentFrame ?? 0,
      x, y, tool,
      color: canvas?.color || '#ff4757',
      lineWidth: canvas?.lineWidth || 3,
      opacity: canvas?.opacity ?? 1
    });
  }

  /**
   * 스트로크 진행 → 50ms 스로틀로 포인트 묶어서 전송
   */
  _onDrawMove(e) {
    if (this._isRemoteUpdate || !this._isStroking) return;
    if (!this._lm.hasOtherCollaborators()) return;

    const { x, y } = e.detail || {};
    this._strokeBuffer.push({ x, y });

    // 50ms 스로틀: 포인트를 묶어서 한 번에 전송
    if (!this._strokeFlushTimer) {
      this._strokeFlushTimer = setTimeout(() => {
        this._strokeFlushTimer = null;
        if (this._strokeBuffer.length > 0) {
          this._lm.broadcastEvent({
            type: 'STROKE_MOVE',
            points: this._strokeBuffer
          });
          this._strokeBuffer = [];
        }
      }, 50);
    }
  }

  /**
   * 그리기 완료 시 캔버스 데이터 브로드캐스트
   */
  async _onDrawEnd(_e) {
    // 스트로크 종료 전송
    if (this._isStroking && this._lm.hasOtherCollaborators()) {
      // 남은 버퍼 플러시
      if (this._strokeFlushTimer) {
        clearTimeout(this._strokeFlushTimer);
        this._strokeFlushTimer = null;
      }
      if (this._strokeBuffer.length > 0) {
        this._lm.broadcastEvent({
          type: 'STROKE_MOVE',
          points: this._strokeBuffer
        });
        this._strokeBuffer = [];
      }
      this._lm.broadcastEvent({ type: 'STROKE_END' });
    }
    this._isStroking = false;
    if (this._isRemoteUpdate) return;
    if (!this._lm.hasOtherCollaborators()) return;

    const layer = this._dm.getActiveLayer?.() || this._dm.activeLayer;
    if (!layer) return;

    const currentFrame = this._dm.currentFrame ?? 0;
    const keyframe = layer.getKeyframeAtFrame?.(currentFrame);
    if (!keyframe?.canvasData) return;

    let sendData = keyframe.canvasData;
    const dataSize = typeof sendData === 'string' ? sendData.length : 0;

    if (dataSize > MAX_BROADCAST_SIZE) {
      log.warn('캔버스 데이터가 1MB 초과, 품질 낮춰서 전송', {
        size: (dataSize / 1024).toFixed(0) + 'KB'
      });
      const reduced = await this._reduceCanvasData(sendData);
      if (reduced) {
        sendData = reduced;
      }
    }

    this._lm.broadcastEvent({
      type: 'DRAWING_KEYFRAME_UPDATE',
      layerId: layer.id,
      frame: keyframe.frame,
      canvasData: sendData
    });

    log.debug('그리기 브로드캐스트 전송', {
      layerId: layer.id,
      frame: keyframe.frame,
      size: ((typeof sendData === 'string' ? sendData.length : 0) / 1024).toFixed(0) + 'KB'
    });
  }

  _onLayerCreated(e) {
    if (this._isRemoteUpdate) return;

    const { layer } = e.detail || {};
    if (layer) {
      this._lm.broadcastEvent({
        type: 'DRAWING_LAYER_CREATED',
        layer: {
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          color: layer.color,
          opacity: layer.opacity
        }
      });
    }
  }

  _onLayerDeleted(e) {
    if (this._isRemoteUpdate) return;

    const { layer } = e.detail || {};
    const layerId = layer?.id;
    if (layerId) {
      this._lm.broadcastEvent({
        type: 'DRAWING_LAYER_DELETED',
        layerId
      });
    }
  }

  _onKeyframeRemoved(e) {
    if (this._isRemoteUpdate) return;

    const { layer, frame } = e.detail || {};
    const layerId = layer?.id;
    if (layerId && frame !== undefined) {
      this._lm.broadcastEvent({
        type: 'DRAWING_KEYFRAME_REMOVED',
        layerId,
        frame
      });
    }
  }

  // ============================================================================
  // Remote → Local (Broadcast 수신)
  // ============================================================================

  _onBroadcast(e) {
    const event = e.detail?.event || e.detail;
    if (!event?.type) return;

    switch (event.type) {
    case 'DRAWING_KEYFRAME_UPDATE':
      this._applyRemoteKeyframe(event);
      break;
    case 'DRAWING_LAYER_CREATED':
      this._applyRemoteLayerCreated(event);
      break;
    case 'DRAWING_LAYER_DELETED':
      this._applyRemoteLayerDeleted(event);
      break;
    case 'DRAWING_KEYFRAME_REMOVED':
      this._applyRemoteKeyframeRemoved(event);
      break;
    case 'STROKE_START':
      this._onRemoteStrokeStart(event);
      break;
    case 'STROKE_MOVE':
      this._onRemoteStrokeMove(event);
      break;
    case 'STROKE_END':
      this._onRemoteStrokeEnd();
      break;
    }
  }

  async _applyRemoteKeyframe(event) {
    const { layerId, frame, canvasData } = event;
    if (!layerId || frame === undefined || !canvasData) return;

    this._isRemoteUpdate = true;
    try {
      const layers = this._dm.getLayers?.() || this._dm.layers || [];
      let layer = layers.find(l => l.id === layerId);
      if (!layer) {
        // 레이어 생성 Broadcast가 아직 도착하지 않았을 수 있음 — 잠시 대기
        await new Promise(r => setTimeout(r, 200));
        const retryLayers = this._dm.getLayers?.() || this._dm.layers || [];
        layer = retryLayers.find(l => l.id === layerId);
        if (!layer) {
          log.debug('원격 키프레임: 레이어를 찾을 수 없음', { layerId });
          return;
        }
      }

      // 키프레임 찾기 또는 생성
      let keyframe = layer.keyframes?.find(kf => kf.frame === frame);
      if (!keyframe) {
        keyframe = layer.getOrCreateKeyframe?.(frame, true);
      }

      if (keyframe) {
        keyframe.setCanvasData?.(canvasData) || (keyframe.canvasData = canvasData);
        keyframe._cachedImage = null;
        keyframe._cachedSrc = null;
        keyframe.isEmpty = false;

        // 현재 프레임이면 화면 갱신
        const currentFrame = this._dm.currentFrame ?? 0;
        if (frame === currentFrame || (layer.getKeyframeAtFrame?.(currentFrame) === keyframe)) {
          this._dm.renderFrame?.(currentFrame);
        }

        log.debug('원격 키프레임 적용', { layerId, frame });
      }
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  _applyRemoteLayerCreated(event) {
    const { layer: layerData } = event;
    if (!layerData?.id) return;

    this._isRemoteUpdate = true;
    try {
      const layers = this._dm.getLayers?.() || this._dm.layers || [];
      const exists = layers.find(l => l.id === layerData.id);
      if (exists) return;

      // DrawingManager에 레이어 추가
      if (this._dm.createLayer) {
        this._dm.createLayer(layerData);
      }
      log.debug('원격 레이어 생성 적용', { id: layerData.id });
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  _applyRemoteLayerDeleted(event) {
    const { layerId } = event;
    if (!layerId) return;

    this._isRemoteUpdate = true;
    try {
      if (this._dm.deleteLayer) {
        this._dm.deleteLayer(layerId);
      }
      log.debug('원격 레이어 삭제 적용', { layerId });
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  _applyRemoteKeyframeRemoved(event) {
    const { layerId, frame } = event;
    if (!layerId || frame === undefined) return;

    this._isRemoteUpdate = true;
    try {
      const layers = this._dm.getLayers?.() || this._dm.layers || [];
      const layer = layers.find(l => l.id === layerId);
      if (layer?.removeKeyframe) {
        layer.removeKeyframe(frame);
        this._dm.renderFrame?.(this._dm.currentFrame ?? 0);
      }
      log.debug('원격 키프레임 삭제 적용', { layerId, frame });
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  // ============================================================================
  // Remote Stroke Streaming (실시간 스트로크 수신)
  // ============================================================================

  /**
   * 원격 스트로크 시작 → 임시 오버레이 캔버스 생성
   */
  _onRemoteStrokeStart(event) {
    const { layerId, frame, x, y, color, lineWidth, opacity, tool } = event;

    // 현재 프레임이 아니면 무시
    const currentFrame = this._dm.currentFrame ?? 0;
    if (frame !== currentFrame) return;

    // 임시 오버레이 캔버스 생성/재사용
    if (!this._remoteOverlay) {
      this._createRemoteOverlay();
    }
    if (!this._remoteOverlay) return;

    const ctx = this._remoteOverlay.getContext('2d');
    ctx.clearRect(0, 0, this._remoteOverlay.width, this._remoteOverlay.height);

    // 브러시 설정 저장
    this._remoteStroke = {
      layerId, frame, tool,
      color: color || '#ff4757',
      lineWidth: lineWidth || 3,
      opacity: opacity ?? 1,
      lastX: x,
      lastY: y
    };

    this._remoteOverlay.style.display = 'block';
    this._remoteOverlay.style.opacity = String(this._remoteStroke.opacity);
  }

  /**
   * 원격 스트로크 이동 → 임시 캔버스에 선분 그리기
   */
  _onRemoteStrokeMove(event) {
    const { points } = event;
    if (!points?.length || !this._remoteStroke || !this._remoteOverlay) return;

    const ctx = this._remoteOverlay.getContext('2d');
    const stroke = this._remoteStroke;

    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';

    ctx.beginPath();
    ctx.moveTo(stroke.lastX, stroke.lastY);

    for (const pt of points) {
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    // 마지막 포인트 저장
    const lastPt = points[points.length - 1];
    stroke.lastX = lastPt.x;
    stroke.lastY = lastPt.y;
  }

  /**
   * 원격 스트로크 종료 → 오버레이 클리어 (이후 최종 PNG가 옴)
   */
  _onRemoteStrokeEnd() {
    this._remoteStroke = null;
    if (this._remoteOverlay) {
      const ctx = this._remoteOverlay.getContext('2d');
      ctx.clearRect(0, 0, this._remoteOverlay.width, this._remoteOverlay.height);
      this._remoteOverlay.style.display = 'none';
    }
  }

  /**
   * 캔버스 데이터를 낮은 품질로 재인코딩 (1MB 초과 시)
   */
  async _reduceCanvasData(canvasData) {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = canvasData;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const reduced = canvas.toDataURL('image/png');
      log.debug('캔버스 품질 축소 완료', {
        before: (canvasData.length / 1024).toFixed(0) + 'KB',
        after: (reduced.length / 1024).toFixed(0) + 'KB'
      });
      return reduced.length < canvasData.length ? reduced : null;
    } catch (e) {
      log.warn('캔버스 품질 축소 실패', { error: e.message });
      return null;
    }
  }

  /**
   * 원격 스트로크용 오버레이 캔버스 생성
   */
  _createRemoteOverlay() {
    const drawingCanvas = this._dm.drawingCanvas?.canvas || document.getElementById('drawingCanvas');
    if (!drawingCanvas) return;

    const overlay = document.createElement('canvas');
    overlay.id = 'remoteStrokeOverlay';
    overlay.className = 'drawing-overlay remote-stroke-overlay';
    overlay.width = drawingCanvas.width;
    overlay.height = drawingCanvas.height;
    overlay.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      pointer-events: none;
      z-index: 25;
      display: none;
    `;

    drawingCanvas.parentElement?.appendChild(overlay);
    this._remoteOverlay = overlay;

    log.debug('원격 스트로크 오버레이 캔버스 생성');
  }
}
