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
const KEYFRAME_CHUNK_RAW_SIZE = 384 * 1024;
const KEYFRAME_CHUNK_TIMEOUT_MS = 30000;
const MAX_ACTIVE_KEYFRAME_TRANSFERS = 8;
const MAX_KEYFRAME_TRANSFER_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_KEYFRAME_BUFFERED_BYTES = 64 * 1024 * 1024;
const MAX_KEYFRAME_CHUNK_DATA_BYTES = 600 * 1024;
const MAX_KEYFRAME_CHUNKS = Math.ceil(
  MAX_KEYFRAME_TRANSFER_BYTES / (KEYFRAME_CHUNK_RAW_SIZE * 4 / 3)
);

function serializedByteSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function createSecureActorId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('DrawingSync actor ID 생성에는 Web Crypto가 필요합니다.');
}

function compareOrderVersions(left, right) {
  if (left.clock !== right.clock) return left.clock - right.clock;
  return left.actorId < right.actorId ? -1 : left.actorId > right.actorId ? 1 : 0;
}

/**
 * 그리기 동기화 매니저 (Broadcast 기반)
 */
export class DrawingSync {
  constructor({ liveblocksManager, drawingManager, actorId = null }) {
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
    this._onLayerOrderChanged = this._onLayerOrderChanged.bind(this);
    this._onHistoryRestored = this._onHistoryRestored.bind(this);
    this._onKeyframeRemoved = this._onKeyframeRemoved.bind(this);
    this._onKeyframeUpdated = this._onKeyframeUpdated.bind(this);
    this._onBroadcast = this._onBroadcast.bind(this);

    this._started = false;
    this._explicitActorId = actorId === null || actorId === undefined ? null : String(actorId);
    this._actorId = null;
    this._orderClock = 0;
    this._lastAppliedOrderVersion = { clock: 0, actorId: '' };
    this._pendingRemoteLayerOrder = null;
    this._pendingHistoryRestoreBroadcast = Promise.resolve();
    this._keyframeChunkTransfers = new Map();
    this._keyframeChunkBufferedBytes = 0;

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
    this._dm.addEventListener('layerOrderChanged', this._onLayerOrderChanged);
    this._dm.addEventListener('historyRestored', this._onHistoryRestored);
    this._dm.addEventListener('keyframeRemoved', this._onKeyframeRemoved);
    this._dm.addEventListener('keyframeUpdated', this._onKeyframeUpdated);

    // Remote → Local: Broadcast 수신
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);

    this._started = true;
    this._actorId = this._resolveActorId();
    log.info('그리기 동기화 시작됨 (Broadcast 모드)');
  }

  broadcastCurrentState() {
    if (!this._started || !this._lm.hasOtherCollaborators()) return Promise.resolve();

    const layers = this._dm.getLayers?.() || this._dm.layers || [];
    const task = this._broadcastCurrentState(layers).catch(error => {
      log.error('현재 그리기 상태 브로드캐스트 실패', {
        error: error?.message || String(error)
      });
    });
    this._pendingHistoryRestoreBroadcast = Promise.all([
      this._pendingHistoryRestoreBroadcast,
      task
    ]).then(() => undefined);
    return task;
  }

  async _broadcastCurrentState(layers) {
    try {
      for (const layer of layers) {
        const insertBeforeLayerId = this._dm.getLayerInsertBeforeId?.(layer.id);
        this._lm.broadcastEvent({
          type: 'DRAWING_LAYER_CREATED',
          insertBeforeLayerId: insertBeforeLayerId || undefined,
          layer: {
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            color: layer.color,
            opacity: layer.opacity
          }
        });
      }

      for (const layer of layers) {
        for (const keyframe of layer.keyframes || []) {
          if (!keyframe?.canvasData && keyframe?.isEmpty !== true) continue;
          try {
            await this._broadcastKeyframeUpdate(layer, keyframe);
          } catch (error) {
            log.error('현재 상태 키프레임 브로드캐스트 실패', {
              layerId: layer.id,
              frame: keyframe.frame,
              error: error?.message || String(error)
            });
          }
        }
      }
    } finally {
      this._broadcastLayerOrder();

      log.info('현재 그리기 상태 브로드캐스트 완료', {
        layers: layers.length
      });
    }
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
    this._dm.removeEventListener('layerOrderChanged', this._onLayerOrderChanged);
    this._dm.removeEventListener('historyRestored', this._onHistoryRestored);
    this._dm.removeEventListener('keyframeRemoved', this._onKeyframeRemoved);
    this._dm.removeEventListener('keyframeUpdated', this._onKeyframeUpdated);
    this._lm.removeEventListener('broadcastReceived', this._onBroadcast);
    this._clearKeyframeChunkTransfers();
    this._pendingRemoteLayerOrder = null;

    this._started = false;
    log.info('그리기 동기화 중지됨');
  }

  /**
   * Remote 변경 여부
   */
  get isRemoteUpdate() {
    return this._isRemoteUpdate;
  }

  waitForPendingBroadcasts() {
    return this._pendingHistoryRestoreBroadcast;
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

    const { x, y, tool, eraserMode } = e.detail || {};
    const layer = this._dm.getActiveLayer?.() || this._dm.activeLayer;
    if (!layer) return;
    if (tool === 'eraser' && eraserMode === 'stroke') {
      this._isStroking = false;
      return;
    }

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
    if (!keyframe?.canvasData && keyframe?.isEmpty !== true) return;

    await this._broadcastKeyframeUpdate(layer, keyframe);
  }

  async _onKeyframeUpdated(e) {
    if (this._isRemoteUpdate) return;
    if (!this._lm.hasOtherCollaborators()) return;

    const { layer, frame, keyframe } = e.detail || {};
    if (!layer) return;
    const updatedKeyframe = keyframe || layer.getKeyframeAtFrame?.(frame);
    await this._broadcastKeyframeUpdate(layer, updatedKeyframe);
  }

  async _broadcastKeyframeUpdate(layer, keyframe) {
    if (!layer || !keyframe) return;

    const originalCanvasData = keyframe.canvasData || null;
    if (!originalCanvasData && keyframe.isEmpty !== true) return;

    const createEvent = canvasData => ({
      type: 'DRAWING_KEYFRAME_UPDATE',
      layerId: layer.id,
      frame: keyframe.frame,
      canvasData,
      baseCanvasData: keyframe.baseCanvasData,
      strokeRecords: keyframe.strokeRecords,
      isEmpty: keyframe.isEmpty === true
    });

    const originalEvent = createEvent(originalCanvasData);
    const originalEventSize = serializedByteSize(originalEvent);
    if (originalEventSize < MAX_BROADCAST_SIZE) {
      this._lm.broadcastEvent(originalEvent);
      log.debug('그리기 브로드캐스트 전송', {
        layerId: layer.id,
        frame: keyframe.frame,
        size: (originalEventSize / 1024).toFixed(0) + 'KB'
      });
      return;
    }

    if (typeof originalCanvasData === 'string') {
      log.warn('키프레임 이벤트가 1MB 초과, 품질 낮춰서 전송 시도', {
        size: (originalEventSize / 1024).toFixed(0) + 'KB'
      });
      try {
        const reduced = await this._reduceCanvasData(originalCanvasData);
        if (reduced) {
          const reducedEvent = createEvent(reduced);
          if (serializedByteSize(reducedEvent) < MAX_BROADCAST_SIZE) {
            this._lm.broadcastEvent(reducedEvent);
          }
        }
      } catch (error) {
        log.warn('키프레임 축소 처리 실패', { error: error?.message || String(error) });
      }
    }

    this._broadcastChunkedKeyframeEvent(originalEvent);

    log.debug('그리기 브로드캐스트 전송', {
      layerId: layer.id,
      frame: keyframe.frame,
      size: (originalEventSize / 1024).toFixed(0) + 'KB'
    });
  }

  _broadcastChunkedKeyframeEvent(event) {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(event));
    const count = Math.ceil(payloadBytes.length / KEYFRAME_CHUNK_RAW_SIZE);
    if (count < 1 || count > MAX_KEYFRAME_CHUNKS) {
      throw new Error(`키프레임 청크 수가 허용 범위를 벗어났습니다: ${count}`);
    }

    const transferId = `${this._actorId || this._resolveActorId()}:${createSecureActorId()}`;
    for (let index = 0; index < count; index++) {
      const start = index * KEYFRAME_CHUNK_RAW_SIZE;
      const chunkEvent = {
        type: 'DRAWING_KEYFRAME_CHUNK',
        transferId,
        index,
        count,
        layerId: event.layerId,
        frame: event.frame,
        data: bytesToBase64(payloadBytes.subarray(start, start + KEYFRAME_CHUNK_RAW_SIZE))
      };
      if (serializedByteSize(chunkEvent) >= MAX_BROADCAST_SIZE) {
        throw new Error('키프레임 청크가 브로드캐스트 제한을 초과했습니다.');
      }
      this._lm.broadcastEvent(chunkEvent);
    }
  }

  _onLayerCreated(e) {
    if (this._isRemoteUpdate) return;

    const { layer, insertIndex, insertBeforeLayerId } = e.detail || {};
    if (layer) {
      this._lm.broadcastEvent({
        type: 'DRAWING_LAYER_CREATED',
        insertIndex: Number.isInteger(insertIndex) ? insertIndex : undefined,
        insertBeforeLayerId: insertBeforeLayerId || undefined,
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

  _onLayerOrderChanged() {
    if (this._isRemoteUpdate) return;
    this._broadcastLayerOrder();
  }

  _onHistoryRestored(e) {
    if (this._isRemoteUpdate) return;

    const { delta } = e.detail || {};
    if (!delta) return;
    const layers = this._dm.getLayers?.() || this._dm.layers || [];
    if (delta.type === 'restore') {
      const insertIndex = layers.findIndex(layer => layer.id === delta.layerId);
      const layer = layers[insertIndex];
      if (layer) {
        const task = this._broadcastRestoredLayer(layer, insertIndex)
          .catch(error => {
            log.error('복원 레이어 브로드캐스트 실패', {
              layerId: layer.id,
              error: error?.message || String(error)
            });
          });
        this._pendingHistoryRestoreBroadcast = Promise.all([
          this._pendingHistoryRestoreBroadcast,
          task
        ]).then(() => undefined);
      }
      return;
    } else if (delta.type === 'delete') {
      this._lm.broadcastEvent({ type: 'DRAWING_LAYER_DELETED', layerId: delta.layerId });
    }
    this._broadcastLayerOrder();
  }

  _broadcastLayerOrder() {
    const layers = this._dm.getLayers?.() || this._dm.layers || [];
    const version = this._nextLocalOrderVersion();
    this._lm.broadcastEvent({
      type: 'DRAWING_LAYER_ORDER_CHANGED',
      layerIds: layers.map(layer => layer.id),
      version
    });
  }

  async _broadcastRestoredLayer(layer, insertIndex) {
    const layerData = layer.toJSON?.() || layer;
    const { keyframes = [], ...layerMetadata } = layerData;
    const insertBeforeLayerId = this._dm.getLayerInsertBeforeId?.(layer.id) || undefined;
    this._lm.broadcastEvent({
      type: 'DRAWING_LAYER_RESTORED',
      insertIndex,
      insertBeforeLayerId,
      layer: layerMetadata
    });
    this._lm.broadcastEvent({
      type: 'DRAWING_LAYER_CREATED',
      restore: true,
      insertIndex,
      insertBeforeLayerId,
      layer: layerMetadata
    });
    try {
      for (const keyframe of keyframes) {
        try {
          await this._broadcastKeyframeUpdate(layer, keyframe);
        } catch (error) {
          log.error('복원 키프레임 브로드캐스트 실패', {
            layerId: layer.id,
            frame: keyframe.frame,
            error: error?.message || String(error)
          });
        }
      }
    } finally {
      this._broadcastLayerOrder();
    }
  }

  _resolveActorId() {
    if (this._explicitActorId) return this._explicitActorId;
    const connectionId = this._lm.getSelf?.()?.connectionId;
    return connectionId === null || connectionId === undefined
      ? createSecureActorId()
      : String(connectionId);
  }

  _nextLocalOrderVersion() {
    this._orderClock = Math.max(this._orderClock, this._lastAppliedOrderVersion.clock) + 1;
    const version = { clock: this._orderClock, actorId: this._actorId || this._resolveActorId() };
    this._lastAppliedOrderVersion = version;
    return version;
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
    case 'DRAWING_KEYFRAME_CHUNK':
      this._applyRemoteKeyframeChunk(event);
      break;
    case 'DRAWING_LAYER_CREATED':
      this._applyRemoteLayerCreated(event);
      break;
    case 'DRAWING_LAYER_DELETED':
      this._applyRemoteLayerDeleted(event);
      break;
    case 'DRAWING_LAYER_RESTORED':
      this._applyRemoteLayerRestored(event);
      break;
    case 'DRAWING_LAYER_ORDER_CHANGED':
      this._applyRemoteLayerOrderChanged(event);
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
    const { layerId, frame, canvasData, baseCanvasData, strokeRecords, isEmpty } = event;
    if (!layerId || frame === undefined || (!canvasData && isEmpty !== true)) return;

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
        if (isEmpty === true) {
          keyframe.setCanvasData?.(null) || (keyframe.canvasData = null);
          keyframe.isEmpty = true;
        } else {
          keyframe.setCanvasData?.(canvasData) || (keyframe.canvasData = canvasData);
          keyframe.isEmpty = false;
        }
        keyframe.baseCanvasData = baseCanvasData || null;
        keyframe.strokeRecords = Array.isArray(strokeRecords) ? strokeRecords : [];
        keyframe._cachedImage = null;
        keyframe._cachedSrc = null;

        // 현재 프레임이면 화면 갱신
        const currentFrame = this._dm.currentFrame ?? 0;
        if (frame === currentFrame || (layer.getKeyframeAtFrame?.(currentFrame) === keyframe)) {
          this._dm.renderFrame?.(currentFrame);
        }

        this._notifyRemoteKeyframeApplied(layer, frame, keyframe);
        log.debug('원격 키프레임 적용', { layerId, frame });
      }
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  _applyRemoteKeyframeChunk(event) {
    const { transferId, index, count, layerId, frame, data } = event;
    if (typeof transferId !== 'string' || !transferId || transferId.length > 256
      || !Number.isSafeInteger(index) || !Number.isSafeInteger(count)
      || index < 0 || count < 1 || count > MAX_KEYFRAME_CHUNKS || index >= count
      || typeof layerId !== 'string' || !layerId
      || !Number.isSafeInteger(frame) || typeof data !== 'string'
      || serializedByteSize(event) >= MAX_BROADCAST_SIZE) return;

    const chunkDataBytes = new TextEncoder().encode(data).byteLength;
    if (chunkDataBytes < 1 || chunkDataBytes > MAX_KEYFRAME_CHUNK_DATA_BYTES) return;

    this._pruneExpiredKeyframeChunks();
    let transfer = this._keyframeChunkTransfers.get(transferId);
    if (!transfer) {
      if (this._keyframeChunkTransfers.size >= MAX_ACTIVE_KEYFRAME_TRANSFERS) return;
      const timeoutId = setTimeout(() => {
        this._deleteKeyframeChunkTransfer(transferId);
      }, KEYFRAME_CHUNK_TIMEOUT_MS);
      transfer = {
        count,
        layerId,
        frame,
        chunks: new Array(count),
        received: 0,
        bufferedBytes: 0,
        expiresAt: Date.now() + KEYFRAME_CHUNK_TIMEOUT_MS,
        timeoutId
      };
      this._keyframeChunkTransfers.set(transferId, transfer);
    }

    if (transfer.count !== count || transfer.layerId !== layerId || transfer.frame !== frame) {
      this._deleteKeyframeChunkTransfer(transferId);
      return;
    }
    if (transfer.chunks[index] !== undefined) {
      if (transfer.chunks[index] !== data) this._deleteKeyframeChunkTransfer(transferId);
      return;
    }

    if (transfer.bufferedBytes + chunkDataBytes > MAX_KEYFRAME_TRANSFER_BYTES
      || this._keyframeChunkBufferedBytes + chunkDataBytes > MAX_TOTAL_KEYFRAME_BUFFERED_BYTES) {
      this._deleteKeyframeChunkTransfer(transferId);
      return;
    }

    transfer.chunks[index] = data;
    transfer.received += 1;
    transfer.bufferedBytes += chunkDataBytes;
    this._keyframeChunkBufferedBytes += chunkDataBytes;
    if (transfer.received !== transfer.count) return;

    this._deleteKeyframeChunkTransfer(transferId);
    try {
      const byteChunks = transfer.chunks.map(base64ToBytes);
      const totalLength = byteChunks.reduce((total, chunk) => total + chunk.length, 0);
      const payloadBytes = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of byteChunks) {
        payloadBytes.set(chunk, offset);
        offset += chunk.length;
      }
      const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
      if (payload?.type !== 'DRAWING_KEYFRAME_UPDATE'
        || payload.layerId !== layerId || payload.frame !== frame) return;
      void this._applyRemoteKeyframe(payload).catch(error => {
        log.warn('청크 키프레임 적용 실패', { error: error?.message || String(error) });
      });
    } catch (error) {
      log.warn('키프레임 청크 재조립 실패', { error: error?.message || String(error) });
    }
  }

  _deleteKeyframeChunkTransfer(transferId) {
    const transfer = this._keyframeChunkTransfers.get(transferId);
    if (transfer?.timeoutId) clearTimeout(transfer.timeoutId);
    if (transfer?.bufferedBytes) {
      this._keyframeChunkBufferedBytes = Math.max(
        0,
        this._keyframeChunkBufferedBytes - transfer.bufferedBytes
      );
    }
    this._keyframeChunkTransfers.delete(transferId);
  }

  _pruneExpiredKeyframeChunks(now = Date.now()) {
    for (const [transferId, transfer] of this._keyframeChunkTransfers) {
      if (transfer.expiresAt <= now) this._deleteKeyframeChunkTransfer(transferId);
    }
  }

  _clearKeyframeChunkTransfers() {
    for (const transferId of [...this._keyframeChunkTransfers.keys()]) {
      this._deleteKeyframeChunkTransfer(transferId);
    }
    this._keyframeChunkBufferedBytes = 0;
  }

  _notifyRemoteKeyframeApplied(layer, frame, keyframe) {
    this._dm._emit?.('keyframeUpdated', { layer, frame, keyframe });
    this._dm._emit?.('layersChanged');
  }

  _applyRemoteLayerCreated(event) {
    const { layer: layerData } = event;
    if (!layerData?.id) return;

    this._isRemoteUpdate = true;
    try {
      if (event.restore === true && this._dm.restoreLayer) {
        this._dm.restoreLayer({ ...layerData, keyframes: [] }, {
          insertIndex: Number.isInteger(event.insertIndex) ? event.insertIndex : undefined,
          insertBeforeLayerId: typeof event.insertBeforeLayerId === 'string'
            ? event.insertBeforeLayerId
            : undefined
        });
        return;
      }
      const layers = this._dm.getLayers?.() || this._dm.layers || [];
      const exists = layers.find(l => l.id === layerData.id);
      if (exists) return;
      if (this._dm.isLayerDeleted?.(layerData.id)) return;

      // DrawingManager에 레이어 추가
      if (this._dm.createLayer) {
        this._dm.createLayer({
          ...layerData,
          skipActivate: true,
          ...(typeof event.insertBeforeLayerId === 'string'
            ? { insertBeforeLayerId: event.insertBeforeLayerId }
            : {}),
          ...(Number.isInteger(event.insertIndex) ? { insertIndex: event.insertIndex } : {})
        }, false);
      }
      log.debug('원격 레이어 생성 적용', { id: layerData.id });
    } finally {
      this._isRemoteUpdate = false;
      this._retryPendingRemoteLayerOrder();
    }
  }

  _applyRemoteLayerDeleted(event) {
    const { layerId } = event;
    if (!layerId) return;

    this._isRemoteUpdate = true;
    try {
      if (this._dm.markLayerDeleted) {
        this._dm.markLayerDeleted(layerId, false);
      } else if (this._dm.deleteLayer) {
        this._dm.deleteLayer(layerId, false);
      }
      log.debug('원격 레이어 삭제 적용', { layerId });
    } finally {
      this._isRemoteUpdate = false;
      this._retryPendingRemoteLayerOrder();
    }
  }

  _applyRemoteLayerRestored(event) {
    const { layer: layerData } = event;
    if (!layerData?.id) return;

    this._isRemoteUpdate = true;
    try {
      this._dm.restoreLayer?.(layerData, {
        insertIndex: Number.isInteger(event.insertIndex) ? event.insertIndex : undefined,
        insertBeforeLayerId: typeof event.insertBeforeLayerId === 'string'
          ? event.insertBeforeLayerId
          : undefined
      });
      log.debug('원격 레이어 복원 적용', { id: layerData.id });
    } finally {
      this._isRemoteUpdate = false;
      this._retryPendingRemoteLayerOrder();
    }
  }

  _applyRemoteLayerOrderChanged(event) {
    const version = event.version;
    if (!Array.isArray(event.layerIds)
      || !Number.isSafeInteger(version?.clock)
      || version.clock < 1
      || typeof version.actorId !== 'string'
      || !version.actorId) return;

    this._orderClock = Math.max(this._orderClock, version.clock);
    if (compareOrderVersions(version, this._lastAppliedOrderVersion) <= 0) return;
    if (this._pendingRemoteLayerOrder
      && compareOrderVersions(version, this._pendingRemoteLayerOrder.version) < 0) return;

    this._pendingRemoteLayerOrder = {
      layerIds: [...event.layerIds],
      version: { clock: version.clock, actorId: version.actorId }
    };
    this._retryPendingRemoteLayerOrder();
  }

  _retryPendingRemoteLayerOrder() {
    const event = this._pendingRemoteLayerOrder;
    if (!event) return;
    if (compareOrderVersions(event.version, this._lastAppliedOrderVersion) <= 0) {
      this._pendingRemoteLayerOrder = null;
      return;
    }

    const layers = this._dm.getLayers?.() || this._dm.layers || [];
    const existingLayerIds = new Set(layers.map(layer => layer.id));
    const hasUnavailableLayer = event.layerIds.some(layerId => (
      !existingLayerIds.has(layerId) && !this._dm.isLayerDeleted?.(layerId)
    ));
    if (hasUnavailableLayer) return;

    this._isRemoteUpdate = true;
    try {
      this._dm.applyLayerOrder?.(event.layerIds);
      this._lastAppliedOrderVersion = {
        clock: event.version.clock,
        actorId: event.version.actorId
      };
      this._pendingRemoteLayerOrder = null;
      log.debug('원격 레이어 순서 적용', { count: event.layerIds.length });
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
