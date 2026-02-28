/**
 * BAEFRAME - Comment Sync
 * CommentManager ↔ Liveblocks Storage 양방향 동기화
 *
 * 댓글 데이터를 CRDT(LiveList/LiveObject)로 관리하여
 * 충돌 없는 실시간 동시 편집을 지원합니다.
 */

import { createLogger } from '../logger.js';

const log = createLogger('CommentSync');

/**
 * 댓글 동기화 매니저
 *
 * Local → Remote: CommentManager 이벤트 감지 → Storage 업데이트
 * Remote → Local: Storage 구독 → CommentManager 업데이트
 */
export class CommentSync {
  constructor({ liveblocksManager, commentManager }) {
    this._lm = liveblocksManager;
    this._cm = commentManager;

    // 무한 루프 방지 플래그
    this._isRemoteUpdate = false;
    this._isSyncingToStorage = false;

    // 이벤트 핸들러 바인딩
    this._onMarkerAdded = this._onMarkerAdded.bind(this);
    this._onMarkerUpdated = this._onMarkerUpdated.bind(this);
    this._onMarkerDeleted = this._onMarkerDeleted.bind(this);
    this._onReplyAdded = this._onReplyAdded.bind(this);
    this._onReplyDeleted = this._onReplyDeleted.bind(this);
    this._onLayerAdded = this._onLayerAdded.bind(this);
    this._onLayerRemoved = this._onLayerRemoved.bind(this);

    this._unsubscribers = [];
    this._started = false;

    log.info('CommentSync 초기화됨');
  }

  /**
   * 동기화 시작
   * @param {Object} options
   * @param {boolean} options.uploadLocal - true면 로컬 데이터를 Storage에 업로드
   */
  async start(options = {}) {
    if (this._started) return;

    const storage = this._lm.getStorage();
    const room = this._lm.getRoom();
    if (!storage || !room) {
      log.error('동기화 시작 실패: Storage 또는 Room 없음');
      return;
    }

    const commentLayers = storage.get('commentLayers');
    const highlights = storage.get('highlights');

    // Storage가 비어있으면 로컬 데이터 업로드
    if (options.uploadLocal || commentLayers.toArray().length === 0) {
      await this._uploadLocalToStorage(commentLayers, highlights);
    } else {
      // Storage에 데이터가 있으면 로컬로 로드
      this._loadStorageToLocal(commentLayers, highlights);
    }

    // Local → Remote 이벤트 리스너
    this._cm.addEventListener('markerAdded', this._onMarkerAdded);
    this._cm.addEventListener('markerUpdated', this._onMarkerUpdated);
    this._cm.addEventListener('markerDeleted', this._onMarkerDeleted);
    this._cm.addEventListener('replyAdded', this._onReplyAdded);
    this._cm.addEventListener('replyDeleted', this._onReplyDeleted);
    this._cm.addEventListener('layerAdded', this._onLayerAdded);
    this._cm.addEventListener('layerRemoved', this._onLayerRemoved);

    // Remote → Local: Storage 변경 구독
    const unsubStorage = room.subscribe(commentLayers, (updates) => {
      if (this._isSyncingToStorage) return;
      this._onStorageChanged(updates, commentLayers);
    }, { isDeep: true });
    this._unsubscribers.push(unsubStorage);

    if (highlights) {
      const unsubHighlights = room.subscribe(highlights, () => {
        if (this._isSyncingToStorage) return;
        this._onHighlightsChanged(highlights);
      }, { isDeep: true });
      this._unsubscribers.push(unsubHighlights);
    }

    this._started = true;
    log.info('댓글 동기화 시작됨');
  }

  /**
   * 동기화 중지
   */
  stop() {
    // 구독 해제
    this._unsubscribers.forEach(unsub => {
      try { unsub(); } catch (e) { /* 무시 */ }
    });
    this._unsubscribers = [];

    // 이벤트 리스너 제거
    this._cm.removeEventListener('markerAdded', this._onMarkerAdded);
    this._cm.removeEventListener('markerUpdated', this._onMarkerUpdated);
    this._cm.removeEventListener('markerDeleted', this._onMarkerDeleted);
    this._cm.removeEventListener('replyAdded', this._onReplyAdded);
    this._cm.removeEventListener('replyDeleted', this._onReplyDeleted);
    this._cm.removeEventListener('layerAdded', this._onLayerAdded);
    this._cm.removeEventListener('layerRemoved', this._onLayerRemoved);

    this._started = false;
    log.info('댓글 동기화 중지됨');
  }

  // ============================================================================
  // Local → Remote (CommentManager 이벤트 → Liveblocks Storage)
  // ============================================================================

  _onMarkerAdded(e) {
    if (this._isRemoteUpdate) return;
    const { marker, layerId } = e.detail || {};
    if (!marker) return;

    this._syncToStorage(() => {
      const layer = this._findStorageLayer(layerId);
      if (!layer) return;

      const markers = layer.get('markers');
      // 중복 확인
      const existing = this._findMarkerInList(markers, marker.id);
      if (existing !== -1) return;

      markers.push(this._markerToLiveObject(marker));
      log.debug('마커 Storage 추가', { id: marker.id });
    });
  }

  _onMarkerUpdated(e) {
    if (this._isRemoteUpdate) return;
    const { marker, layerId } = e.detail || {};
    if (!marker) return;

    this._syncToStorage(() => {
      const layer = this._findStorageLayer(layerId);
      if (!layer) return;

      const markers = layer.get('markers');
      const idx = this._findMarkerInList(markers, marker.id);
      if (idx === -1) return;

      const liveMarker = markers.get(idx);
      liveMarker.update({
        text: marker.text || marker.content || '',
        resolved: marker.resolved || false,
        updatedAt: new Date().toISOString(),
        x: marker.x,
        y: marker.y,
        startFrame: marker.startFrame ?? marker.frame,
        endFrame: marker.endFrame ?? marker.frame,
        colorKey: marker.colorKey || 'default'
      });
      log.debug('마커 Storage 업데이트', { id: marker.id });
    });
  }

  _onMarkerDeleted(e) {
    if (this._isRemoteUpdate) return;
    const { markerId, layerId } = e.detail || {};
    if (!markerId) return;

    this._syncToStorage(() => {
      const layer = this._findStorageLayer(layerId);
      if (!layer) return;

      const markers = layer.get('markers');
      const idx = this._findMarkerInList(markers, markerId);
      if (idx === -1) return;

      // 소프트 삭제 (CRDT 안전성)
      const liveMarker = markers.get(idx);
      liveMarker.update({
        deleted: true,
        deletedAt: new Date().toISOString()
      });
      log.debug('마커 Storage 소프트 삭제', { id: markerId });
    });
  }

  _onReplyAdded(e) {
    if (this._isRemoteUpdate) return;
    const { markerId, reply, layerId } = e.detail || {};
    if (!markerId || !reply) return;

    this._syncToStorage(() => {
      const liveMarker = this._findStorageMarker(layerId, markerId);
      if (!liveMarker) return;

      const replies = liveMarker.get('replies');
      if (!replies) return;

      const { LiveObject } = this._getLiveTypes();
      replies.push(new LiveObject({
        id: reply.id,
        text: reply.text || reply.content || '',
        author: reply.author || '',
        createdAt: reply.createdAt || new Date().toISOString()
      }));
      log.debug('답글 Storage 추가', { markerId, replyId: reply.id });
    });
  }

  _onReplyDeleted(e) {
    if (this._isRemoteUpdate) return;
    const { markerId, replyId, layerId } = e.detail || {};
    if (!markerId || !replyId) return;

    this._syncToStorage(() => {
      const liveMarker = this._findStorageMarker(layerId, markerId);
      if (!liveMarker) return;

      const replies = liveMarker.get('replies');
      if (!replies) return;

      const replyArr = replies.toArray();
      const idx = replyArr.findIndex(r => r.get('id') === replyId);
      if (idx !== -1) {
        replies.delete(idx);
        log.debug('답글 Storage 삭제', { markerId, replyId });
      }
    });
  }

  _onLayerAdded(e) {
    if (this._isRemoteUpdate) return;
    const { layer } = e.detail || {};
    if (!layer) return;

    this._syncToStorage(() => {
      const storage = this._lm.getStorage();
      const commentLayers = storage.get('commentLayers');

      const { LiveObject, LiveList } = this._getLiveTypes();
      commentLayers.push(new LiveObject({
        id: layer.id,
        name: layer.name || '새 레이어',
        visible: layer.visible !== false,
        markers: new LiveList([])
      }));
      log.debug('레이어 Storage 추가', { id: layer.id });
    });
  }

  _onLayerRemoved(e) {
    if (this._isRemoteUpdate) return;
    const { layerId } = e.detail || {};
    if (!layerId) return;

    this._syncToStorage(() => {
      const storage = this._lm.getStorage();
      const commentLayers = storage.get('commentLayers');
      const layers = commentLayers.toArray();
      const idx = layers.findIndex(l => l.get('id') === layerId);
      if (idx !== -1) {
        commentLayers.delete(idx);
        log.debug('레이어 Storage 삭제', { id: layerId });
      }
    });
  }

  // ============================================================================
  // Remote → Local (Liveblocks Storage → CommentManager)
  // ============================================================================

  /**
   * Storage 변경 감지 → 델타 적용
   * Liveblocks의 updates 배열을 분석하여 변경된 항목만 갱신
   */
  _onStorageChanged(updates, commentLayers) {
    this._isRemoteUpdate = true;
    try {
      // updates가 유효한 배열이면 델타 적용 시도
      if (Array.isArray(updates) && updates.length > 0 && this._applyDelta(updates, commentLayers)) {
        log.debug('델타 적용 성공', { updateCount: updates.length });
        return;
      }

      // 델타 적용 실패 시 전체 재구축 (폴백)
      log.debug('전체 재구축 (폴백)');
      this._loadStorageToLocal(commentLayers);
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  /**
   * 델타(차분) 적용 - 변경된 마커/레이어만 갱신
   * @returns {boolean} 성공 여부 (실패 시 false → 전체 재구축으로 폴백)
   */
  _applyDelta(updates, commentLayers) {
    try {
      for (const update of updates) {
        const node = update.node || update;

        // LiveList 변경 (아이템 추가/삭제)
        if (update.type === 'LiveList') {
          this._handleListUpdate(update, commentLayers);
          continue;
        }

        // LiveObject 변경 (필드 업데이트)
        if (update.type === 'LiveObject' || update.updates) {
          this._handleObjectUpdate(update, commentLayers);
          continue;
        }

        // 알 수 없는 타입 → 폴백
        if (node && typeof node.get === 'function') {
          // Liveblocks 노드로 추정 → 변경 타입 추론
          const nodeId = node.get?.('id');
          if (nodeId) {
            this._handleNodeChange(node, nodeId, commentLayers);
            continue;
          }
        }

        // 처리 불가 → 폴백
        log.debug('델타 처리 불가, 폴백', { updateType: update.type });
        return false;
      }

      return true;
    } catch (e) {
      log.warn('델타 적용 중 오류, 폴백', { error: e.message });
      return false;
    }
  }

  /**
   * LiveList 변경 처리 (마커/레이어 추가/삭제)
   */
  _handleListUpdate(update, commentLayers) {
    // LiveList에 삽입/삭제 발생 시, 구조 변경이므로 전체 동기화
    // 하지만 CommentManager의 applyRemote 메서드로 효율적으로 처리
    this._syncStructureFromStorage(commentLayers);
  }

  /**
   * LiveObject 변경 처리 (마커 필드 업데이트)
   */
  _handleObjectUpdate(update, _commentLayers) {
    const node = update.node;
    const changes = update.updates;

    if (!node || typeof node.get !== 'function') return;

    const nodeId = node.get('id');
    if (!nodeId) return;

    // 마커 업데이트인지 확인
    const marker = this._cm.getMarker(nodeId);
    if (marker && changes) {
      // 변경된 필드만 추출
      const fields = {};
      for (const key of Object.keys(changes)) {
        fields[key] = node.get(key);
      }
      this._cm.applyRemoteMarkerUpdate(nodeId, fields);
      return;
    }

    // 마커가 아닌 경우 (레이어 등) → 구조 동기화
    this._handleNodeChange(node, nodeId, _commentLayers);
  }

  /**
   * 노드 변경 처리 (ID 기반 추론)
   */
  _handleNodeChange(node, nodeId, commentLayers) {
    // 마커인지 확인
    const marker = this._cm.getMarker(nodeId);
    if (marker) {
      // 마커 전체 필드를 Storage에서 읽어서 업데이트
      const obj = node.toObject ? node.toObject() : node;
      const repliesLive = node.get?.('replies');
      const replies = repliesLive?.toArray?.().map(r =>
        r.toObject ? r.toObject() : r
      ) || [];
      this._cm.applyRemoteMarkerUpdate(nodeId, { ...obj, replies });
      return;
    }

    // 마커가 아니면 구조 변경 (레이어 추가/삭제 등)
    this._syncStructureFromStorage(commentLayers);
  }

  /**
   * 구조적 변경 시 효율적 동기화
   * fromJSON 대신, 추가/삭제된 항목만 반영
   */
  _syncStructureFromStorage(commentLayers) {
    if (!commentLayers) return;

    const storageLayers = commentLayers.toArray();
    const localLayerIds = new Set(this._cm.layers.map(l => l.id));
    const storageLayerIds = new Set();

    for (const liveLayer of storageLayers) {
      const layerId = liveLayer.get('id');
      storageLayerIds.add(layerId);

      // 새 레이어 추가
      if (!localLayerIds.has(layerId)) {
        this._cm.applyRemoteLayerAdd({
          id: layerId,
          name: liveLayer.get('name'),
          visible: liveLayer.get('visible')
        });
      }

      // 마커 동기화
      const markersLive = liveLayer.get('markers');
      if (!markersLive) continue;

      const localLayer = this._cm.layers.find(l => l.id === layerId);
      const localMarkerIds = localLayer ? new Set(localLayer.getAllMarkers(true).map(m => m.id)) : new Set();

      const storageMarkers = markersLive.toArray();
      const storageMarkerIds = new Set();

      for (const liveMarker of storageMarkers) {
        const markerId = liveMarker.get('id');
        const isDeleted = liveMarker.get('deleted');
        storageMarkerIds.add(markerId);

        if (isDeleted) {
          // 삭제된 마커
          if (localMarkerIds.has(markerId)) {
            this._cm.applyRemoteMarkerDelete(markerId);
          }
          continue;
        }

        if (!localMarkerIds.has(markerId)) {
          // 새 마커 추가
          const obj = liveMarker.toObject ? liveMarker.toObject() : liveMarker;
          const repliesLive = liveMarker.get('replies');
          const replies = repliesLive?.toArray?.().map(r =>
            r.toObject ? r.toObject() : r
          ) || [];
          this._cm.applyRemoteMarkerAdd({ ...obj, replies }, layerId);
        } else {
          // 기존 마커 업데이트
          const obj = liveMarker.toObject ? liveMarker.toObject() : liveMarker;
          const repliesLive = liveMarker.get('replies');
          const replies = repliesLive?.toArray?.().map(r =>
            r.toObject ? r.toObject() : r
          ) || [];
          this._cm.applyRemoteMarkerUpdate(markerId, { ...obj, replies });
        }
      }

      // 로컬에만 있고 Storage에 없는 마커 삭제
      for (const localId of localMarkerIds) {
        if (!storageMarkerIds.has(localId)) {
          this._cm.applyRemoteMarkerDelete(localId);
        }
      }
    }

    // 로컬에만 있고 Storage에 없는 레이어 삭제
    for (const localId of localLayerIds) {
      if (!storageLayerIds.has(localId)) {
        this._cm.applyRemoteLayerDelete(localId);
      }
    }
  }

  _onHighlightsChanged(highlights) {
    this._isRemoteUpdate = true;
    try {
      if (!this._cm._highlightManager) return;
      const highlightData = highlights.toArray().map(h => {
        const obj = h.toObject ? h.toObject() : h;
        return { ...obj };
      });
      // highlightManager가 fromJSON을 지원하면 사용
      if (this._cm._highlightManager?.fromJSON) {
        this._cm._highlightManager.fromJSON(highlightData);
      }
    } finally {
      this._isRemoteUpdate = false;
    }
  }

  /**
   * Remote 변경 여부 (외부에서 확인 용)
   */
  get isRemoteUpdate() {
    return this._isRemoteUpdate;
  }

  // ============================================================================
  // Data Conversion
  // ============================================================================

  /**
   * 로컬 데이터를 Storage에 업로드
   */
  _uploadLocalToStorage(commentLayers, highlights) {
    const localData = this._cm.toJSON();
    if (!localData?.layers?.length) return;

    this._syncToStorage(() => {
      const { LiveObject, LiveList } = this._getLiveTypes();

      // 기존 Storage 비우기
      while (commentLayers.length > 0) {
        commentLayers.delete(0);
      }

      // 로컬 레이어 업로드
      for (const layer of localData.layers) {
        const markers = new LiveList(
          (layer.markers || [])
            .filter(m => !m.deleted)
            .map(m => this._markerToLiveObject(m))
        );

        commentLayers.push(new LiveObject({
          id: layer.id,
          name: layer.name || '기본 레이어',
          visible: layer.visible !== false,
          markers
        }));
      }

      log.info('로컬 댓글 → Storage 업로드 완료', {
        layers: localData.layers.length,
        markers: localData.layers.reduce((sum, l) => sum + (l.markers?.length || 0), 0)
      });
    });

    // 하이라이트 업로드
    if (highlights && this._cm._highlightManager) {
      this._syncToStorage(() => {
        const { LiveObject } = this._getLiveTypes();
        while (highlights.length > 0) {
          highlights.delete(0);
        }
        const highlightData = this._cm._highlightManager?.toJSON() || [];
        for (const h of highlightData) {
          highlights.push(new LiveObject({ ...h }));
        }
      });
    }
  }

  /**
   * Storage 데이터를 로컬(CommentManager)에 로드
   */
  _loadStorageToLocal(commentLayers, _highlights) {
    if (!commentLayers) return;

    const layers = commentLayers.toArray().map(liveLayer => {
      const layer = liveLayer.toObject ? liveLayer.toObject() : liveLayer;
      const markersLive = liveLayer.get('markers');
      const markers = markersLive ? markersLive.toArray().map(liveMarker => {
        const marker = liveMarker.toObject ? liveMarker.toObject() : liveMarker;
        const repliesLive = liveMarker.get('replies');
        const replies = repliesLive ? repliesLive.toArray().map(r =>
          r.toObject ? r.toObject() : r
        ) : [];
        return { ...marker, replies };
      }) : [];

      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        markers: markers.filter(m => !m.deleted)
      };
    });

    // CommentManager에 반영
    this._cm.fromJSON({ layers });

    log.debug('Storage → 로컬 댓글 로드 완료', {
      layers: layers.length,
      markers: layers.reduce((sum, l) => sum + l.markers.length, 0)
    });
  }

  /**
   * 마커 객체를 LiveObject로 변환
   */
  _markerToLiveObject(marker) {
    const { LiveObject, LiveList } = this._getLiveTypes();

    const replies = new LiveList(
      (marker.replies || []).map(r => new LiveObject({
        id: r.id,
        text: r.text || r.content || '',
        author: r.author || '',
        createdAt: r.createdAt || new Date().toISOString()
      }))
    );

    return new LiveObject({
      id: marker.id,
      x: marker.x ?? 0,
      y: marker.y ?? 0,
      startFrame: marker.startFrame ?? marker.frame ?? 0,
      endFrame: marker.endFrame ?? marker.frame ?? 0,
      text: marker.text || marker.content || '',
      author: marker.author || '',
      authorId: marker.authorId || '',
      createdAt: marker.createdAt || new Date().toISOString(),
      updatedAt: marker.updatedAt || new Date().toISOString(),
      resolved: marker.resolved || false,
      deleted: false,
      colorKey: marker.colorKey || 'default',
      image: marker.image || null,
      replies
    });
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Storage에서 레이어 찾기
   */
  _findStorageLayer(layerId) {
    const storage = this._lm.getStorage();
    if (!storage) return null;

    const commentLayers = storage.get('commentLayers');
    if (!commentLayers) return null;

    const layers = commentLayers.toArray();
    // layerId가 없으면 첫 번째 레이어
    if (!layerId) return layers[0] || null;

    return layers.find(l => l.get('id') === layerId) || null;
  }

  /**
   * Storage에서 마커 찾기
   */
  _findStorageMarker(layerId, markerId) {
    const layer = this._findStorageLayer(layerId);
    if (!layer) return null;

    const markers = layer.get('markers');
    if (!markers) return null;

    const arr = markers.toArray();
    return arr.find(m => m.get('id') === markerId) || null;
  }

  /**
   * LiveList에서 마커 인덱스 찾기
   */
  _findMarkerInList(markersList, markerId) {
    if (!markersList) return -1;
    const arr = markersList.toArray();
    return arr.findIndex(m => m.get('id') === markerId);
  }

  /**
   * Storage 변경을 배치로 감싸기 (무한 루프 방지)
   */
  _syncToStorage(fn) {
    this._isSyncingToStorage = true;
    try {
      this._lm.batch(fn);
    } finally {
      this._isSyncingToStorage = false;
    }
  }

  /**
   * Live 타입 가져오기 (동적 import 방지)
   */
  _getLiveTypes() {
    // liveblocks-client.js에서 export됨
    return {
      LiveObject: globalThis.__LiveObject,
      LiveList: globalThis.__LiveList
    };
  }
}
