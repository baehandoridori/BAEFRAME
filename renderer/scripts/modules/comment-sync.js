/**
 * BAEFRAME - Comment Sync (Broadcast 기반)
 * CommentManager ↔ Liveblocks Broadcast 양방향 동기화
 *
 * 전략:
 * - Local → Remote: CommentManager 이벤트 → Broadcast 전송
 * - Remote → Local: Broadcast 수신 → CommentManager 업데이트
 * - .bframe 파일 저장은 기존 auto-save가 처리 (500ms debounce)
 * - 파일 감시(Google Drive)는 폴백 안전망으로 유지
 */

import { createLogger } from '../logger.js';

const log = createLogger('CommentSync');

/**
 * 댓글 동기화 매니저 (Broadcast 기반)
 */
export class CommentSync {
  constructor({ liveblocksManager, commentManager }) {
    this._lm = liveblocksManager;
    this._cm = commentManager;

    // 무한 루프 방지 플래그
    this._isRemoteUpdate = false;

    // 이벤트 핸들러 바인딩
    this._onMarkerAdded = this._onMarkerAdded.bind(this);
    this._onMarkerUpdated = this._onMarkerUpdated.bind(this);
    this._onMarkerDeleted = this._onMarkerDeleted.bind(this);
    this._onReplyAdded = this._onReplyAdded.bind(this);
    this._onReplyDeleted = this._onReplyDeleted.bind(this);
    this._onReplyUpdated = this._onReplyUpdated.bind(this);
    this._onLayerAdded = this._onLayerAdded.bind(this);
    this._onLayerRemoved = this._onLayerRemoved.bind(this);
    this._onBroadcast = this._onBroadcast.bind(this);

    this._started = false;

    log.info('CommentSync 초기화됨 (Broadcast 모드)');
  }

  /**
   * 동기화 시작
   */
  async start() {
    if (this._started) return;

    // Local → Remote 이벤트 리스너
    this._cm.addEventListener('markerAdded', this._onMarkerAdded);
    this._cm.addEventListener('markerUpdated', this._onMarkerUpdated);
    this._cm.addEventListener('markerDeleted', this._onMarkerDeleted);
    this._cm.addEventListener('replyAdded', this._onReplyAdded);
    this._cm.addEventListener('replyDeleted', this._onReplyDeleted);
    this._cm.addEventListener('replyUpdated', this._onReplyUpdated);
    this._cm.addEventListener('layerAdded', this._onLayerAdded);
    this._cm.addEventListener('layerRemoved', this._onLayerRemoved);

    // Remote → Local: Broadcast 수신
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);

    this._started = true;
    log.info('댓글 동기화 시작됨 (Broadcast 모드)');
  }

  /**
   * 동기화 중지
   */
  stop() {
    // 이벤트 리스너 제거
    this._cm.removeEventListener('markerAdded', this._onMarkerAdded);
    this._cm.removeEventListener('markerUpdated', this._onMarkerUpdated);
    this._cm.removeEventListener('markerDeleted', this._onMarkerDeleted);
    this._cm.removeEventListener('replyAdded', this._onReplyAdded);
    this._cm.removeEventListener('replyDeleted', this._onReplyDeleted);
    this._cm.removeEventListener('replyUpdated', this._onReplyUpdated);
    this._cm.removeEventListener('layerAdded', this._onLayerAdded);
    this._cm.removeEventListener('layerRemoved', this._onLayerRemoved);
    this._lm.removeEventListener('broadcastReceived', this._onBroadcast);

    this._started = false;
    log.info('댓글 동기화 중지됨');
  }

  /**
   * Remote 변경 여부 (외부에서 확인 용)
   */
  get isRemoteUpdate() {
    return this._isRemoteUpdate;
  }

  // ============================================================================
  // Local → Remote (CommentManager 이벤트 → Broadcast 전송)
  // ============================================================================

  _onMarkerAdded(e) {
    if (this._isRemoteUpdate) return;
    const { marker, layerId } = e.detail || {};
    if (!marker) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_MARKER_ADDED',
      marker: this._serializeMarker(marker),
      layerId
    });
  }

  _onMarkerUpdated(e) {
    if (this._isRemoteUpdate) return;
    const { marker } = e.detail || {};
    if (!marker) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_MARKER_UPDATED',
      markerId: marker.id,
      fields: {
        text: marker.text || marker.content || '',
        resolved: marker.resolved || false,
        x: marker.x,
        y: marker.y,
        startFrame: marker.startFrame ?? marker.frame,
        endFrame: marker.endFrame ?? marker.frame,
        colorKey: marker.colorKey || 'default',
        updatedAt: new Date().toISOString()
      }
    });
  }

  _onMarkerDeleted(e) {
    if (this._isRemoteUpdate) return;
    const { markerId } = e.detail || {};
    if (!markerId) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_MARKER_DELETED',
      markerId
    });
  }

  _onReplyAdded(e) {
    if (this._isRemoteUpdate) return;
    const { markerId, reply } = e.detail || {};
    if (!markerId || !reply) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_REPLY_ADDED',
      markerId,
      reply: {
        id: reply.id,
        text: reply.text || reply.content || '',
        author: reply.author || '',
        createdAt: this._toISOString(reply.createdAt) || new Date().toISOString(),
        image: reply.image || null,
        imageWidth: reply.imageWidth || null,
        imageHeight: reply.imageHeight || null
      }
    });
  }

  _onReplyUpdated(e) {
    if (this._isRemoteUpdate) return;
    const { markerId, replyId, updates } = e.detail || {};
    if (!markerId || !replyId) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_REPLY_UPDATED',
      markerId,
      replyId,
      updates: { text: updates?.text }
    });
  }

  _onReplyDeleted(e) {
    if (this._isRemoteUpdate) return;
    const { markerId, replyId } = e.detail || {};
    if (!markerId || !replyId) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_REPLY_DELETED',
      markerId,
      replyId
    });
  }

  _onLayerAdded(e) {
    if (this._isRemoteUpdate) return;
    const { layer } = e.detail || {};
    if (!layer) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_LAYER_ADDED',
      layer: {
        id: layer.id,
        name: layer.name || '새 레이어',
        visible: layer.visible !== false
      }
    });
  }

  _onLayerRemoved(e) {
    if (this._isRemoteUpdate) return;
    const { layerId } = e.detail || {};
    if (!layerId) return;

    this._lm.broadcastEvent({
      type: 'COMMENT_LAYER_DELETED',
      layerId
    });
  }

  // ============================================================================
  // Remote → Local (Broadcast 수신 → CommentManager 업데이트)
  // ============================================================================

  _onBroadcast(e) {
    const event = e.detail?.event || e.detail;
    if (!event?.type) return;

    // 댓글 관련 Broadcast만 처리
    if (!event.type.startsWith('COMMENT_')) return;

    this._isRemoteUpdate = true;
    try {
      switch (event.type) {
      case 'COMMENT_MARKER_ADDED':
        this._applyRemoteMarkerAdd(event);
        break;
      case 'COMMENT_MARKER_UPDATED':
        this._applyRemoteMarkerUpdate(event);
        break;
      case 'COMMENT_MARKER_DELETED':
        this._applyRemoteMarkerDelete(event);
        break;
      case 'COMMENT_REPLY_ADDED':
        this._applyRemoteReplyAdd(event);
        break;
      case 'COMMENT_REPLY_UPDATED':
        this._applyRemoteReplyUpdate(event);
        break;
      case 'COMMENT_REPLY_DELETED':
        this._applyRemoteReplyDelete(event);
        break;
      case 'COMMENT_LAYER_ADDED':
        this._applyRemoteLayerAdd(event);
        break;
      case 'COMMENT_LAYER_DELETED':
        this._applyRemoteLayerDelete(event);
        break;
      }
    } catch (error) {
      log.error('Broadcast 처리 중 오류', { type: event.type, error: error.message });
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  _applyRemoteMarkerAdd(event) {
    const { marker, layerId } = event;
    if (!marker) return;

    // 중복 확인
    const existing = this._cm.getMarker(marker.id);
    if (existing) return;

    this._cm.applyRemoteMarkerAdd(marker, layerId);
    log.debug('원격 마커 추가 적용', { id: marker.id });
  }

  _applyRemoteMarkerUpdate(event) {
    const { markerId, fields } = event;
    if (!markerId || !fields) return;

    this._cm.applyRemoteMarkerUpdate(markerId, fields);
    log.debug('원격 마커 업데이트 적용', { id: markerId });
  }

  _applyRemoteMarkerDelete(event) {
    const { markerId } = event;
    if (!markerId) return;

    this._cm.applyRemoteMarkerDelete(markerId);
    log.debug('원격 마커 삭제 적용', { id: markerId });
  }

  _applyRemoteReplyAdd(event) {
    const { markerId, reply } = event;
    if (!markerId || !reply) return;

    this._cm.applyRemoteReplyAdd(markerId, reply);
    log.debug('원격 답글 추가 적용', { markerId, replyId: reply.id });
  }

  _applyRemoteReplyUpdate(event) {
    const { markerId, replyId, updates } = event;
    if (!markerId || !replyId || !updates) return;

    const marker = this._cm.getMarker(markerId);
    if (!marker) return;

    const reply = marker.replies?.find(r => r.id === replyId);
    if (!reply) return;

    if (updates.text !== undefined) {
      reply.text = updates.text;
    }
    marker.updatedAt = new Date().toISOString();

    this._cm._emit('markerUpdated', { marker });
    this._cm._emit('markersChanged');
    log.debug('원격 답글 수정 적용', { markerId, replyId });
  }

  _applyRemoteReplyDelete(event) {
    const { markerId, replyId } = event;
    if (!markerId || !replyId) return;

    this._cm.applyRemoteReplyDelete(markerId, replyId);
    log.debug('원격 답글 삭제 적용', { markerId, replyId });
  }

  _applyRemoteLayerAdd(event) {
    const { layer } = event;
    if (!layer) return;

    this._cm.applyRemoteLayerAdd(layer);
    log.debug('원격 레이어 추가 적용', { id: layer.id });
  }

  _applyRemoteLayerDelete(event) {
    const { layerId } = event;
    if (!layerId) return;

    this._cm.applyRemoteLayerDelete(layerId);
    log.debug('원격 레이어 삭제 적용', { id: layerId });
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * 마커 객체를 직렬화 (Broadcast 전송용)
   */
  _serializeMarker(marker) {
    const replies = (marker.replies || []).map(r => ({
      id: r.id,
      text: r.text || r.content || '',
      author: r.author || '',
      createdAt: this._toISOString(r.createdAt) || new Date().toISOString(),
      image: r.image || null,
      imageWidth: r.imageWidth || null,
      imageHeight: r.imageHeight || null
    }));

    return {
      id: marker.id,
      x: marker.x ?? 0,
      y: marker.y ?? 0,
      startFrame: marker.startFrame ?? marker.frame ?? 0,
      endFrame: marker.endFrame ?? marker.frame ?? 0,
      text: marker.text || marker.content || '',
      author: marker.author || '',
      authorId: marker.authorId || '',
      createdAt: this._toISOString(marker.createdAt) || new Date().toISOString(),
      updatedAt: this._toISOString(marker.updatedAt) || new Date().toISOString(),
      resolved: marker.resolved || false,
      colorKey: marker.colorKey || 'default',
      image: marker.image || null,
      replies
    };
  }

  /**
   * Date 객체/문자열을 ISO 문자열로 변환
   */
  _toISOString(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
  }
}
