/**
 * BAEFRAME - Drawing Sync
 * DrawingManager ↔ Liveblocks 양방향 동기화
 *
 * 전략:
 * - 레이어 메타데이터 (이름, 가시성, 키프레임 목록): CRDT Storage
 * - 캔버스 데이터 (Base64 PNG, 50~500KB): Broadcast
 * - 초기 로드: 로컬 .bframe 파일에서
 */

import { createLogger } from '../logger.js';

const log = createLogger('DrawingSync');

// Broadcast 메시지 사이즈 제한 (1MB)
const MAX_BROADCAST_SIZE = 1024 * 1024;

/**
 * 그리기 동기화 매니저
 */
export class DrawingSync {
  constructor({ liveblocksManager, drawingManager }) {
    this._lm = liveblocksManager;
    this._dm = drawingManager;

    this._isRemoteUpdate = false;
    this._isSyncingToStorage = false;

    // 이벤트 핸들러 바인딩
    this._onDrawEnd = this._onDrawEnd.bind(this);
    this._onLayerCreated = this._onLayerCreated.bind(this);
    this._onLayerDeleted = this._onLayerDeleted.bind(this);
    this._onLayersChanged = this._onLayersChanged.bind(this);
    this._onKeyframeAdded = this._onKeyframeAdded.bind(this);
    this._onKeyframeRemoved = this._onKeyframeRemoved.bind(this);
    this._onBroadcast = this._onBroadcast.bind(this);

    this._unsubscribers = [];
    this._started = false;

    log.info('DrawingSync 초기화됨');
  }

  /**
   * 동기화 시작
   */
  start() {
    if (this._started) return;

    const storage = this._lm.getStorage();
    if (!storage) {
      log.error('동기화 시작 실패: Storage 없음');
      return;
    }

    // 로컬 그리기 메타데이터를 Storage에 업로드
    this._uploadMetaToStorage();

    // Local → Remote 이벤트 리스너
    this._dm.addEventListener('drawend', this._onDrawEnd);
    this._dm.addEventListener('layerCreated', this._onLayerCreated);
    this._dm.addEventListener('layerDeleted', this._onLayerDeleted);
    this._dm.addEventListener('layersChanged', this._onLayersChanged);
    this._dm.addEventListener('keyframeAdded', this._onKeyframeAdded);
    this._dm.addEventListener('keyframeRemoved', this._onKeyframeRemoved);

    // Remote → Local: Broadcast 수신
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);

    // Remote → Local: Storage 메타데이터 변경 구독
    const room = this._lm.getRoom();
    const drawingMeta = storage.get('drawingMeta');
    if (drawingMeta && room) {
      const unsubMeta = room.subscribe(drawingMeta, () => {
        if (this._isSyncingToStorage) return;
        this._onMetaChanged(drawingMeta);
      }, { isDeep: true });
      this._unsubscribers.push(unsubMeta);
    }

    this._started = true;
    log.info('그리기 동기화 시작됨');
  }

  /**
   * 동기화 중지
   */
  stop() {
    this._unsubscribers.forEach(unsub => {
      try { unsub(); } catch (e) { /* 무시 */ }
    });
    this._unsubscribers = [];

    this._dm.removeEventListener('drawend', this._onDrawEnd);
    this._dm.removeEventListener('layerCreated', this._onLayerCreated);
    this._dm.removeEventListener('layerDeleted', this._onLayerDeleted);
    this._dm.removeEventListener('layersChanged', this._onLayersChanged);
    this._dm.removeEventListener('keyframeAdded', this._onKeyframeAdded);
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
   * 그리기 완료 시 캔버스 데이터 브로드캐스트
   */
  _onDrawEnd(_e) {
    if (this._isRemoteUpdate) return;
    if (!this._lm.hasOtherCollaborators()) return;

    const layer = this._dm.getActiveLayer?.() || this._dm.activeLayer;
    if (!layer) return;

    const currentFrame = this._dm.currentFrame ?? 0;
    const keyframe = layer.getKeyframeAtFrame?.(currentFrame);
    if (!keyframe?.canvasData) return;

    const canvasData = keyframe.canvasData;
    const dataSize = typeof canvasData === 'string' ? canvasData.length : 0;

    if (dataSize > MAX_BROADCAST_SIZE) {
      log.warn('캔버스 데이터가 1MB 초과, 품질 낮춰서 전송', {
        size: (dataSize / 1024).toFixed(0) + 'KB'
      });
      // TODO: 캔버스를 JPEG로 변환하여 압축
    }

    this._lm.broadcastEvent({
      type: 'DRAWING_KEYFRAME_UPDATE',
      layerId: layer.id,
      frame: keyframe.frame,
      canvasData
    });

    // 메타데이터 업데이트 (키프레임 목록)
    this._updateLayerMeta(layer);

    log.debug('그리기 브로드캐스트 전송', {
      layerId: layer.id,
      frame: keyframe.frame,
      size: (dataSize / 1024).toFixed(0) + 'KB'
    });
  }

  _onLayerCreated(e) {
    if (this._isRemoteUpdate) return;
    this._uploadMetaToStorage();

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
    this._uploadMetaToStorage();

    const { layerId } = e.detail || {};
    if (layerId) {
      this._lm.broadcastEvent({
        type: 'DRAWING_LAYER_DELETED',
        layerId
      });
    }
  }

  _onLayersChanged() {
    if (this._isRemoteUpdate) return;
    this._uploadMetaToStorage();
  }

  _onKeyframeAdded(_e) {
    if (this._isRemoteUpdate) return;
    this._uploadMetaToStorage();
  }

  _onKeyframeRemoved(e) {
    if (this._isRemoteUpdate) return;
    this._uploadMetaToStorage();

    const { layerId, frame } = e.detail || {};
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
    }
  }

  _applyRemoteKeyframe(event) {
    const { layerId, frame, canvasData } = event;
    if (!layerId || frame === undefined || !canvasData) return;

    this._isRemoteUpdate = true;
    try {
      const layers = this._dm.getLayers?.() || this._dm.layers || [];
      const layer = layers.find(l => l.id === layerId);
      if (!layer) {
        log.debug('원격 키프레임: 레이어를 찾을 수 없음', { layerId });
        return;
      }

      // 키프레임 찾기 또는 생성
      let keyframe = layer.keyframes?.find(kf => kf.frame === frame);
      if (!keyframe) {
        keyframe = layer.getOrCreateKeyframe?.(frame, true);
      }

      if (keyframe) {
        keyframe.setCanvasData?.(canvasData) || (keyframe.canvasData = canvasData);
        keyframe.isEmpty = false;

        // 현재 프레임이면 화면 갱신
        const currentFrame = this._dm.currentFrame ?? 0;
        if (frame === currentFrame || (layer.getKeyframeAtFrame?.(currentFrame) === keyframe)) {
          this._dm.renderFrame?.();
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
      if (this._dm.addLayer) {
        this._dm.addLayer(layerData);
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
        this._dm.renderFrame?.();
      }
      log.debug('원격 키프레임 삭제 적용', { layerId, frame });
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  // ============================================================================
  // Storage 메타데이터
  // ============================================================================

  /**
   * Storage의 메타데이터 변경 시 로컬 반영
   */
  _onMetaChanged(drawingMeta) {
    // 메타데이터 변경은 레이어 가시성/잠금 등에만 영향
    this._isRemoteUpdate = true;
    try {
      const metaArr = drawingMeta.toArray();
      const layers = this._dm.getLayers?.() || this._dm.layers || [];

      for (const liveMeta of metaArr) {
        const meta = liveMeta.toObject ? liveMeta.toObject() : liveMeta;
        const layer = layers.find(l => l.id === meta.id);
        if (layer) {
          if (meta.visible !== undefined) layer.visible = meta.visible;
          if (meta.locked !== undefined) layer.locked = meta.locked;
          if (meta.name !== undefined) layer.name = meta.name;
        }
      }
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  /**
   * 로컬 레이어 메타데이터를 Storage에 업로드
   */
  _uploadMetaToStorage() {
    const storage = this._lm.getStorage();
    if (!storage) return;

    const drawingMeta = storage.get('drawingMeta');
    if (!drawingMeta) return;

    const layers = this._dm.getLayers?.() || this._dm.layers || [];

    this._isSyncingToStorage = true;
    try {
      this._lm.batch(() => {
        // 기존 메타 비우기
        while (drawingMeta.length > 0) {
          drawingMeta.delete(0);
        }

        const { LiveObject } = this._getLiveTypes();

        // 현재 레이어 메타 업로드
        for (const layer of layers) {
          const keyframeFrames = (layer.keyframes || []).map(kf => kf.frame);
          drawingMeta.push(new LiveObject({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked || false,
            color: layer.color || '#ff4757',
            opacity: layer.opacity ?? 1,
            keyframeFrames
          }));
        }
      });
    } finally {
      this._isSyncingToStorage = false;
    }
  }

  /**
   * 특정 레이어의 메타데이터만 업데이트
   */
  _updateLayerMeta(layer) {
    const storage = this._lm.getStorage();
    if (!storage) return;

    const drawingMeta = storage.get('drawingMeta');
    if (!drawingMeta) return;

    this._isSyncingToStorage = true;
    try {
      const metaArr = drawingMeta.toArray();
      const idx = metaArr.findIndex(m => m.get('id') === layer.id);

      if (idx !== -1) {
        const liveMeta = metaArr[idx];
        const keyframeFrames = (layer.keyframes || []).map(kf => kf.frame);
        liveMeta.update({ keyframeFrames });
      }
    } finally {
      this._isSyncingToStorage = false;
    }
  }

  /**
   * Live 타입 가져오기
   */
  _getLiveTypes() {
    return {
      LiveObject: globalThis.__LiveObject,
      LiveList: globalThis.__LiveList
    };
  }
}
