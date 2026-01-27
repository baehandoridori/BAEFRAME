/**
 * BAEFRAME - Sync Protocol
 * P2P 동기화 메시지 타입 및 헬퍼 정의
 *
 * @version 1.0
 */

/**
 * 동기화 메시지 타입 정의
 */
export const MessageTypes = {
  // === 연결 관련 ===
  HANDSHAKE: 'handshake',         // 초기 연결 시 정보 교환
  HEARTBEAT: 'heartbeat',         // 연결 유지 확인

  // === 댓글 관련 ===
  COMMENT_ADD: 'comment:add',           // 댓글 추가
  COMMENT_UPDATE: 'comment:update',     // 댓글 수정
  COMMENT_DELETE: 'comment:delete',     // 댓글 삭제
  COMMENT_RESOLVE: 'comment:resolve',   // resolved 상태 변경
  REPLY_ADD: 'reply:add',               // 답글 추가
  REPLY_UPDATE: 'reply:update',         // 답글 수정
  REPLY_DELETE: 'reply:delete',         // 답글 삭제

  // === 드로잉 관련 ===
  DRAWING_ADD: 'drawing:add',           // 드로잉 추가
  DRAWING_UPDATE: 'drawing:update',     // 드로잉 수정
  DRAWING_DELETE: 'drawing:delete',     // 드로잉 삭제
  DRAWING_CLEAR: 'drawing:clear',       // 드로잉 전체 삭제

  // === Presence 관련 ===
  PRESENCE_UPDATE: 'presence:update',   // 상태 업데이트 (프레임 위치 등)
  PRESENCE_CURSOR: 'presence:cursor',   // 커서 위치 (선택)

  // === 동기화 관련 ===
  SYNC_REQUEST: 'sync:request',         // 전체 동기화 요청
  SYNC_RESPONSE: 'sync:response'        // 전체 동기화 응답
};

/**
 * 메시지 생성 헬퍼
 */
export const createMessage = {
  /**
   * 초기 핸드셰이크
   */
  handshake: (fileHash, userName, commentCount, drawingCount) => ({
    type: MessageTypes.HANDSHAKE,
    data: {
      fileHash,
      userName,
      commentCount,
      drawingCount,
      version: '1.0'
    }
  }),

  /**
   * Heartbeat
   */
  heartbeat: (userName, currentFrame, isPlaying) => ({
    type: MessageTypes.HEARTBEAT,
    data: {
      userName,
      currentFrame,
      isPlaying
    }
  }),

  /**
   * 댓글 추가
   */
  commentAdd: (marker) => ({
    type: MessageTypes.COMMENT_ADD,
    data: {
      id: marker.id,
      layerId: marker.layerId,
      frame: marker.frame,
      x: marker.x,
      y: marker.y,
      text: marker.text,
      author: marker.author,
      createdAt: marker.createdAt,
      colorKey: marker.colorKey,
      resolved: marker.resolved || false
    }
  }),

  /**
   * 댓글 수정
   */
  commentUpdate: (markerId, changes) => ({
    type: MessageTypes.COMMENT_UPDATE,
    data: {
      id: markerId,
      changes,
      updatedAt: new Date().toISOString()
    }
  }),

  /**
   * 댓글 삭제
   */
  commentDelete: (markerId) => ({
    type: MessageTypes.COMMENT_DELETE,
    data: {
      id: markerId,
      deletedAt: new Date().toISOString()
    }
  }),

  /**
   * resolved 상태 변경
   */
  commentResolve: (markerId, resolved) => ({
    type: MessageTypes.COMMENT_RESOLVE,
    data: {
      id: markerId,
      resolved,
      updatedAt: new Date().toISOString()
    }
  }),

  /**
   * 답글 추가
   */
  replyAdd: (markerId, reply) => ({
    type: MessageTypes.REPLY_ADD,
    data: {
      markerId,
      reply: {
        id: reply.id,
        text: reply.text,
        author: reply.author,
        createdAt: reply.createdAt
      }
    }
  }),

  /**
   * 답글 수정
   */
  replyUpdate: (markerId, replyId, text) => ({
    type: MessageTypes.REPLY_UPDATE,
    data: {
      markerId,
      replyId,
      text,
      updatedAt: new Date().toISOString()
    }
  }),

  /**
   * 답글 삭제
   */
  replyDelete: (markerId, replyId) => ({
    type: MessageTypes.REPLY_DELETE,
    data: {
      markerId,
      replyId,
      deletedAt: new Date().toISOString()
    }
  }),

  /**
   * 드로잉 추가
   */
  drawingAdd: (drawing) => ({
    type: MessageTypes.DRAWING_ADD,
    data: {
      id: drawing.id,
      frame: drawing.frame,
      layerId: drawing.layerId,
      tool: drawing.tool,
      points: drawing.points,
      color: drawing.color,
      width: drawing.width,
      author: drawing.author,
      createdAt: drawing.createdAt
    }
  }),

  /**
   * 드로잉 수정
   */
  drawingUpdate: (drawingId, changes) => ({
    type: MessageTypes.DRAWING_UPDATE,
    data: {
      id: drawingId,
      changes,
      updatedAt: new Date().toISOString()
    }
  }),

  /**
   * 드로잉 삭제
   */
  drawingDelete: (drawingId) => ({
    type: MessageTypes.DRAWING_DELETE,
    data: {
      id: drawingId,
      deletedAt: new Date().toISOString()
    }
  }),

  /**
   * 드로잉 전체 삭제
   */
  drawingClear: (frame, layerId) => ({
    type: MessageTypes.DRAWING_CLEAR,
    data: {
      frame,
      layerId,
      deletedAt: new Date().toISOString()
    }
  }),

  /**
   * Presence 업데이트
   */
  presenceUpdate: (userName, currentFrame, isPlaying) => ({
    type: MessageTypes.PRESENCE_UPDATE,
    data: {
      userName,
      currentFrame,
      isPlaying,
      updatedAt: new Date().toISOString()
    }
  }),

  /**
   * 커서 위치 (선택)
   */
  presenceCursor: (userName, x, y, frame) => ({
    type: MessageTypes.PRESENCE_CURSOR,
    data: {
      userName,
      cursor: { x, y },
      frame
    }
  }),

  /**
   * 전체 동기화 요청
   */
  syncRequest: () => ({
    type: MessageTypes.SYNC_REQUEST,
    data: {}
  }),

  /**
   * 전체 동기화 응답
   */
  syncResponse: (comments, drawings, layerInfo) => ({
    type: MessageTypes.SYNC_RESPONSE,
    data: {
      comments,
      drawings,
      layerInfo,
      syncedAt: new Date().toISOString()
    }
  })
};

/**
 * 메시지 검증
 * @param {Object} message - 검증할 메시지
 * @returns {Object} { valid: boolean, error?: string }
 */
export function validateMessage(message) {
  if (!message || typeof message !== 'object') {
    return { valid: false, error: 'Message is not an object' };
  }

  if (!message.type) {
    return { valid: false, error: 'Missing type' };
  }

  if (!Object.values(MessageTypes).includes(message.type)) {
    return { valid: false, error: `Unknown type: ${message.type}` };
  }

  if (message.data === undefined) {
    return { valid: false, error: 'Missing data' };
  }

  return { valid: true };
}

/**
 * 타임스탬프 비교 (최신 것 판별)
 * @param {string} ts1 - 첫 번째 타임스탬프
 * @param {string} ts2 - 두 번째 타임스탬프
 * @returns {number} ts1이 최신이면 1, ts2가 최신이면 -1, 같으면 0
 */
export function compareTimestamps(ts1, ts2) {
  if (!ts1 && !ts2) return 0;
  if (!ts1) return -1;
  if (!ts2) return 1;

  const d1 = new Date(ts1).getTime();
  const d2 = new Date(ts2).getTime();

  if (d1 > d2) return 1;
  if (d1 < d2) return -1;
  return 0;
}

/**
 * 메시지 타입이 댓글 관련인지 확인
 * @param {string} type - 메시지 타입
 * @returns {boolean}
 */
export function isCommentMessage(type) {
  return [
    MessageTypes.COMMENT_ADD,
    MessageTypes.COMMENT_UPDATE,
    MessageTypes.COMMENT_DELETE,
    MessageTypes.COMMENT_RESOLVE,
    MessageTypes.REPLY_ADD,
    MessageTypes.REPLY_UPDATE,
    MessageTypes.REPLY_DELETE
  ].includes(type);
}

/**
 * 메시지 타입이 드로잉 관련인지 확인
 * @param {string} type - 메시지 타입
 * @returns {boolean}
 */
export function isDrawingMessage(type) {
  return [
    MessageTypes.DRAWING_ADD,
    MessageTypes.DRAWING_UPDATE,
    MessageTypes.DRAWING_DELETE,
    MessageTypes.DRAWING_CLEAR
  ].includes(type);
}

/**
 * 메시지 타입이 Presence 관련인지 확인
 * @param {string} type - 메시지 타입
 * @returns {boolean}
 */
export function isPresenceMessage(type) {
  return [
    MessageTypes.PRESENCE_UPDATE,
    MessageTypes.PRESENCE_CURSOR,
    MessageTypes.HEARTBEAT
  ].includes(type);
}
