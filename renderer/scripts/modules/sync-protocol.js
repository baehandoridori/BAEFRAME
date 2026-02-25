/**
 * BAEFRAME - Sync Protocol
 * WebSocket 기반 실시간 동기화 메시지 타입 및 헬퍼 정의
 *
 * @version 2.0 - WebSocket 리팩토링
 */

/**
 * 동기화 메시지 타입 정의
 */
export const MessageTypes = {
  // === 연결 관리 ===
  JOIN: 'JOIN',                   // 클라이언트 접속
  WELCOME: 'WELCOME',             // 호스트 → 새 클라이언트 환영 (상태 전달)
  PEER_JOINED: 'PEER_JOINED',     // 새 피어 참가 알림
  PEER_LEFT: 'PEER_LEFT',         // 피어 이탈 알림
  LEAVE: 'LEAVE',                 // 클라이언트 이탈
  HOST_SHUTDOWN: 'HOST_SHUTDOWN', // 호스트 정상 종료

  // === 커서/Presence (축약: 30fps 빈번 전송) ===
  CURSOR_MOVE: 'CM',              // 커서 위치
  PRESENCE_UPDATE: 'PU',          // 프레임 위치 + 재생 상태

  // === 데이터 동기화 ===
  STATE_CHANGE: 'STATE_CHANGE',         // Client → Host: 변경 요청
  STATE_BROADCAST: 'STATE_BROADCAST',   // Host → All: 변경 전파
  FULL_STATE_SYNC: 'FULL_STATE_SYNC',   // Host → Client: 전체 상태 동기화

  // === 편집 잠금 ===
  EDIT_LOCK: 'EDIT_LOCK',               // 편집 잠금 요청
  EDIT_UNLOCK: 'EDIT_UNLOCK',           // 편집 잠금 해제
  EDIT_LOCK_STATE: 'EDIT_LOCK_STATE',   // 잠금 상태 응답

  // === Host Migration ===
  HOST_ELECTION: 'HOST_ELECTION',       // Host 선출 프로토콜
  REDIRECT: 'REDIRECT'                  // 새 Host로 리다이렉트
};

/**
 * 메시지 생성 헬퍼
 */
export const createMessage = {
  join: (sessionId, userName, userColor) => ({
    type: MessageTypes.JOIN,
    sessionId,
    userName,
    userColor
  }),

  welcome: (participants, hostSessionId, fullState = null) => ({
    type: MessageTypes.WELCOME,
    participants,
    hostSessionId,
    fullState
  }),

  peerJoined: (sessionId, name, color) => ({
    type: MessageTypes.PEER_JOINED,
    sessionId,
    name,
    color
  }),

  peerLeft: (sessionId, name) => ({
    type: MessageTypes.PEER_LEFT,
    sessionId,
    name
  }),

  hostShutdown: (sessionId) => ({
    type: MessageTypes.HOST_SHUTDOWN,
    sessionId
  }),

  stateChange: (sessionId, changeType, data) => ({
    type: MessageTypes.STATE_CHANGE,
    changeType,
    data,
    sessionId,
    timestamp: new Date().toISOString()
  }),

  stateBroadcast: (sessionId, changeType, data) => ({
    type: MessageTypes.STATE_BROADCAST,
    changeType,
    data,
    sessionId,
    timestamp: new Date().toISOString()
  }),

  fullStateSync: (comments, drawings, highlights) => ({
    type: MessageTypes.FULL_STATE_SYNC,
    data: {
      comments,
      drawings,
      highlights,
      syncedAt: new Date().toISOString()
    }
  }),

  cursorMove: (sessionId, x, y, name, color) => ({
    t: MessageTypes.CURSOR_MOVE,
    s: sessionId,
    x,
    y,
    n: name,
    c: color
  }),

  presenceUpdate: (sessionId, currentFrame, isPlaying) => ({
    t: MessageTypes.PRESENCE_UPDATE,
    s: sessionId,
    f: currentFrame,
    p: isPlaying
  }),

  editLock: (sessionId, markerId, userName) => ({
    type: MessageTypes.EDIT_LOCK,
    sessionId,
    markerId,
    userName
  }),

  editUnlock: (sessionId, markerId) => ({
    type: MessageTypes.EDIT_UNLOCK,
    sessionId,
    markerId
  }),

  editLockState: (markerId, isLocked, lockedBy) => ({
    type: MessageTypes.EDIT_LOCK_STATE,
    markerId,
    isLocked,
    lockedBy
  }),

  redirect: (newHostIp, newPort) => ({
    type: MessageTypes.REDIRECT,
    hostIp: newHostIp,
    port: newPort
  })
};

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
