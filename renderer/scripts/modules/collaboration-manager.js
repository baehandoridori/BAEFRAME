/**
 * BAEFRAME - Collaboration Manager
 * 실시간 협업 및 동기화 관리
 *
 * 기능:
 * - 협업자 presence 추적 (누가 파일을 열고 있는지)
 * - 협업자 감지 시 자동 동기화
 * - 댓글 머지 (충돌 해결)
 *
 * @version 1.0
 */

import { createLogger } from '../logger.js';

const log = createLogger('CollaborationManager');

// 상수 정의
const PRESENCE_UPDATE_INTERVAL = 5000;    // 5초마다 presence 업데이트
const PRESENCE_TIMEOUT = 15000;           // 15초 동안 업데이트 없으면 오프라인으로 간주
const COLLAB_FILE_EXTENSION = '.collab';  // presence 파일 확장자
const EDITING_TIMEOUT = 60000;            // 편집 잠금 60초 후 자동 해제

// 동기화 간격 설정 (동적 조정)
const SYNC_INTERVAL_SOLO = 10000;         // 혼자일 때: 10초 (동기화 안 함, 값만 유지)
const SYNC_INTERVAL_COLLAB = 5000;        // 협업자 있을 때: 5초
const SYNC_INTERVAL_ACTIVE = 3000;        // 활발한 편집 시: 3초
const ACTIVITY_WINDOW = 60000;            // 활동량 측정 윈도우: 1분
const ACTIVITY_THRESHOLD = 5;             // 활발 판단 기준: 1분 내 5회 이상

/**
 * 협업 관리자
 */
export class CollaborationManager extends EventTarget {
  constructor(options = {}) {
    super();

    // 설정
    this.syncInterval = options.syncInterval || SYNC_INTERVAL_COLLAB;
    this.presenceUpdateInterval = options.presenceUpdateInterval || PRESENCE_UPDATE_INTERVAL;
    this.presenceTimeout = options.presenceTimeout || PRESENCE_TIMEOUT;

    // 상태
    this.bframePath = null;
    this.collabPath = null;
    this.sessionId = this._generateSessionId();
    this.userName = null;
    this.userColor = this._generateUserColor();

    // 협업자 목록
    this.collaborators = new Map(); // sessionId -> { name, color, lastSeen }

    // 타이머
    this._presenceTimer = null;
    this._syncTimer = null;
    this._isActive = false;

    // 콜백
    this._onRemoteDataLoaded = null;  // 원격 데이터 로드 콜백

    // 활동량 추적 (동기화 간격 동적 조정용)
    this._activityTimestamps = [];

    log.info('CollaborationManager 초기화됨', { sessionId: this.sessionId });
  }

  /**
   * 협업 세션 시작
   * @param {string} bframePath - .bframe 파일 경로
   * @param {string} userName - 사용자 이름
   */
  async start(bframePath, userName) {
    if (this._isActive) {
      await this.stop();
    }

    this.bframePath = bframePath;
    this.collabPath = bframePath + COLLAB_FILE_EXTENSION;
    this.userName = userName;
    this._isActive = true;

    log.info('협업 세션 시작', {
      bframePath,
      collabPath: this.collabPath,
      userName
    });

    // 즉시 presence 업데이트
    await this._updatePresence();

    // 주기적 presence 업데이트 시작
    this._presenceTimer = setInterval(() => {
      this._updatePresence().catch(err => {
        log.warn('Presence 업데이트 실패', { error: err.message });
      });
    }, this.presenceUpdateInterval);

    this._emit('sessionStarted', {
      sessionId: this.sessionId,
      userName: this.userName,
      userColor: this.userColor
    });
  }

  /**
   * 협업 세션 종료
   */
  async stop() {
    if (!this._isActive) return;

    // 편집 잠금 먼저 해제 (_isActive가 true일 때 해야 함)
    await this.releaseAllEditingLocks();

    this._isActive = false;

    // 타이머 정리
    if (this._presenceTimer) {
      clearInterval(this._presenceTimer);
      this._presenceTimer = null;
    }
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }

    // 자신의 presence 제거
    await this._removePresence();

    this.collaborators.clear();

    log.info('협업 세션 종료됨');

    this._emit('sessionStopped', {
      sessionId: this.sessionId
    });
  }

  /**
   * 원격 데이터 로드 콜백 설정
   * @param {Function} callback - 원격 데이터를 로드하는 함수
   */
  setRemoteDataLoader(callback) {
    this._onRemoteDataLoaded = callback;
  }

  /**
   * 현재 협업자 목록 반환
   * @returns {Array<{sessionId: string, name: string, color: string, isMe: boolean}>}
   */
  getCollaborators() {
    const result = [];

    for (const [sessionId, info] of this.collaborators) {
      result.push({
        sessionId,
        name: info.name,
        color: info.color,
        isMe: sessionId === this.sessionId
      });
    }

    return result;
  }

  /**
   * 다른 협업자가 있는지 확인
   * @returns {boolean}
   */
  hasOtherCollaborators() {
    return this.collaborators.size > 1 ||
           (this.collaborators.size === 1 && !this.collaborators.has(this.sessionId));
  }

  /**
   * 수동 동기화 트리거
   */
  async syncNow() {
    if (!this._isActive || !this.bframePath) return;

    log.info('수동 동기화 시작');
    await this._performSync();
  }

  /**
   * 활동 기록 (데이터 변경 시 외부에서 호출)
   * 동기화 간격 동적 조정에 사용
   */
  recordActivity() {
    const now = Date.now();
    this._activityTimestamps.push(now);

    // 오래된 기록 정리 (ACTIVITY_WINDOW 밖의 기록 제거)
    this._activityTimestamps = this._activityTimestamps.filter(
      t => now - t < ACTIVITY_WINDOW
    );

    // 협업자 있으면 간격 재조정
    if (this.hasOtherCollaborators()) {
      this._adjustSyncInterval();
    }
  }

  /**
   * 최근 활동 횟수 반환
   */
  get recentActivityCount() {
    const now = Date.now();
    return this._activityTimestamps.filter(t => now - t < ACTIVITY_WINDOW).length;
  }

  /**
   * 동기화 간격 동적 조정
   */
  _adjustSyncInterval() {
    let newInterval;

    if (!this.hasOtherCollaborators()) {
      newInterval = SYNC_INTERVAL_SOLO;
    } else if (this.recentActivityCount >= ACTIVITY_THRESHOLD) {
      newInterval = SYNC_INTERVAL_ACTIVE;
    } else {
      newInterval = SYNC_INTERVAL_COLLAB;
    }

    // 간격이 변경되었으면 타이머 재시작
    if (newInterval !== this.syncInterval) {
      log.info('동기화 간격 조정', {
        from: this.syncInterval,
        to: newInterval,
        activityCount: this.recentActivityCount
      });
      this.syncInterval = newInterval;
      this._restartSyncTimer();
    }
  }

  /**
   * 동기화 타이머 재시작
   */
  _restartSyncTimer() {
    this._stopSyncTimer();
    if (this.hasOtherCollaborators()) {
      this._startSyncTimer();
    }
  }

  // ============================================================================
  // 댓글 편집 잠금 메서드
  // ============================================================================

  /**
   * 댓글 편집 시작 (잠금 획득 시도)
   * @param {string} markerId - 편집할 마커 ID
   * @returns {Promise<{success: boolean, lockedBy?: string}>}
   */
  async startEditing(markerId) {
    // 협업 중이 아니면 바로 성공
    if (!this._isActive || !this.collabPath || !this.hasOtherCollaborators()) {
      return { success: true };
    }

    try {
      const collabData = await this._readCollabFile() || {
        version: '1.1',
        presence: {},
        editingState: {}
      };

      // 기존 편집 상태 확인
      const existing = collabData.editingState?.[markerId];
      if (existing && existing.sessionId !== this.sessionId) {
        // 타임아웃 체크
        const elapsed = Date.now() - new Date(existing.startedAt).getTime();
        if (elapsed < EDITING_TIMEOUT) {
          log.info('편집 잠금 실패: 다른 사용자가 편집 중', {
            markerId,
            lockedBy: existing.userName
          });
          return { success: false, lockedBy: existing.userName };
        }
        // 타임아웃됨 - 잠금 해제하고 새로 획득
      }

      // 편집 상태 설정
      if (!collabData.editingState) {
        collabData.editingState = {};
      }

      collabData.editingState[markerId] = {
        sessionId: this.sessionId,
        userName: this.userName,
        startedAt: new Date().toISOString()
      };

      await this._writeCollabFile(collabData);

      log.info('편집 잠금 획득', { markerId });
      return { success: true };

    } catch (error) {
      log.warn('편집 잠금 설정 실패', { error: error.message });
      // 실패 시에도 편집 허용 (fail-open)
      return { success: true };
    }
  }

  /**
   * 댓글 편집 종료 (잠금 해제)
   * @param {string} markerId - 편집 완료한 마커 ID
   */
  async stopEditing(markerId) {
    if (!this._isActive || !this.collabPath) return;

    try {
      const collabData = await this._readCollabFile();

      if (collabData?.editingState?.[markerId]?.sessionId === this.sessionId) {
        delete collabData.editingState[markerId];
        await this._writeCollabFile(collabData);
        log.info('편집 잠금 해제', { markerId });
      }
    } catch (error) {
      log.warn('편집 잠금 해제 실패', { error: error.message });
    }
  }

  /**
   * 다른 사람이 편집 중인지 확인
   * @param {string} markerId
   * @returns {Promise<{isLocked: boolean, lockedBy?: string}>}
   */
  async isBeingEdited(markerId) {
    // 협업 중이 아니면 잠금 없음
    if (!this._isActive || !this.collabPath || !this.hasOtherCollaborators()) {
      return { isLocked: false };
    }

    try {
      const collabData = await this._readCollabFile();
      const existing = collabData?.editingState?.[markerId];

      if (!existing || existing.sessionId === this.sessionId) {
        return { isLocked: false };
      }

      // 타임아웃 체크
      const elapsed = Date.now() - new Date(existing.startedAt).getTime();
      if (elapsed >= EDITING_TIMEOUT) {
        return { isLocked: false };
      }

      return { isLocked: true, lockedBy: existing.userName };

    } catch {
      return { isLocked: false };
    }
  }

  /**
   * 앱 종료 시 모든 편집 잠금 해제
   */
  async releaseAllEditingLocks() {
    if (!this._isActive || !this.collabPath) return;

    try {
      const collabData = await this._readCollabFile();

      if (collabData?.editingState) {
        // 내 세션의 모든 편집 잠금 해제
        let changed = false;
        for (const [markerId, info] of Object.entries(collabData.editingState)) {
          if (info.sessionId === this.sessionId) {
            delete collabData.editingState[markerId];
            changed = true;
          }
        }

        if (changed) {
          await this._writeCollabFile(collabData);
          log.info('모든 편집 잠금 해제됨');
        }
      }
    } catch (error) {
      log.warn('편집 잠금 일괄 해제 실패', { error: error.message });
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Presence 업데이트 (내 상태를 collab 파일에 기록)
   */
  async _updatePresence() {
    if (!this._isActive || !this.collabPath) return;

    try {
      // 현재 collab 데이터 읽기
      let collabData = await this._readCollabFile();

      if (!collabData) {
        collabData = {
          version: '1.0',
          presence: {}
        };
      }

      // 내 presence 업데이트
      collabData.presence[this.sessionId] = {
        name: this.userName,
        color: this.userColor,
        lastSeen: new Date().toISOString(),
        startedAt: collabData.presence[this.sessionId]?.startedAt || new Date().toISOString()
      };

      // 오래된 presence 정리 (타임아웃된 사용자 제거)
      const now = Date.now();
      const activePresence = {};

      for (const [sessionId, info] of Object.entries(collabData.presence)) {
        const lastSeen = new Date(info.lastSeen).getTime();
        if (now - lastSeen < this.presenceTimeout) {
          activePresence[sessionId] = info;
        }
      }

      collabData.presence = activePresence;

      // collab 파일 저장
      await this._writeCollabFile(collabData);

      // 협업자 목록 업데이트
      this._updateCollaboratorsList(activePresence);

    } catch (error) {
      log.warn('Presence 업데이트 실패', { error: error.message });
    }
  }

  /**
   * 자신의 Presence 제거
   */
  async _removePresence() {
    if (!this.collabPath) return;

    try {
      const collabData = await this._readCollabFile();

      if (collabData?.presence) {
        delete collabData.presence[this.sessionId];
        await this._writeCollabFile(collabData);
      }
    } catch (error) {
      log.warn('Presence 제거 실패', { error: error.message });
    }
  }

  /**
   * 협업자 목록 업데이트 및 이벤트 발생
   */
  _updateCollaboratorsList(presenceData) {
    const previousCount = this.collaborators.size;
    const hadOthers = this.hasOtherCollaborators();

    this.collaborators.clear();

    for (const [sessionId, info] of Object.entries(presenceData)) {
      this.collaborators.set(sessionId, {
        name: info.name,
        color: info.color,
        lastSeen: info.lastSeen,
        startedAt: info.startedAt
      });
    }

    const hasOthersNow = this.hasOtherCollaborators();

    // 협업자 목록이 변경되었으면 이벤트 발생
    if (previousCount !== this.collaborators.size) {
      this._emit('collaboratorsChanged', {
        collaborators: this.getCollaborators(),
        count: this.collaborators.size
      });
    }

    // 다른 협업자가 생겼으면 동기화 시작
    if (!hadOthers && hasOthersNow) {
      log.info('다른 협업자 감지됨, 자동 동기화 시작');
      this._startSyncTimer();
      this._emit('collaborationStarted', {
        collaborators: this.getCollaborators()
      });
    }

    // 혼자 남았으면 동기화 중지
    if (hadOthers && !hasOthersNow) {
      log.info('혼자 남음, 자동 동기화 중지');
      this._stopSyncTimer();
      this._emit('collaborationEnded', {});
    }
  }

  /**
   * 동기화 타이머 시작
   */
  _startSyncTimer() {
    if (this._syncTimer) return;

    this._syncTimer = setInterval(() => {
      this._performSync().catch(err => {
        log.warn('자동 동기화 실패', { error: err.message });
      });
    }, this.syncInterval);

    // 즉시 한 번 동기화
    this._performSync().catch(() => {});
  }

  /**
   * 동기화 타이머 중지
   */
  _stopSyncTimer() {
    if (this._syncTimer) {
      clearInterval(this._syncTimer);
      this._syncTimer = null;
    }
  }

  /**
   * 동기화 수행
   */
  async _performSync() {
    if (!this._isActive || !this.bframePath) return;

    try {
      // 원격 파일의 수정 시간 확인
      const remoteStats = await window.electronAPI.getFileStats(this.bframePath);

      if (!remoteStats) {
        return; // 파일이 없음
      }

      // 원격 데이터 로드 콜백 호출
      if (this._onRemoteDataLoaded) {
        this._emit('syncStarted', {});
        await this._onRemoteDataLoaded();
        this._emit('syncCompleted', {
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      log.warn('동기화 실패', { error: error.message });
      this._emit('syncError', { error: error.message });
    }
  }

  /**
   * Collab 파일 읽기
   */
  async _readCollabFile() {
    try {
      const data = await window.electronAPI.readCollabFile(this.collabPath);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Collab 파일 쓰기
   */
  async _writeCollabFile(data) {
    await window.electronAPI.writeCollabFile(this.collabPath, data);
  }

  /**
   * 세션 ID 생성
   */
  _generateSessionId() {
    return 'session_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 사용자 색상 생성 (구분용)
   */
  _generateUserColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  /**
   * 이벤트 발생
   */
  _emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

// ============================================================================
// 댓글 머지 유틸리티
// ============================================================================

/**
 * 두 댓글 목록을 머지
 * @param {Array} localComments - 로컬 댓글 목록
 * @param {Array} remoteComments - 원격 댓글 목록
 * @returns {Object} { merged: Array, conflicts: Array, added: number, updated: number }
 */
export function mergeComments(localComments, remoteComments) {
  const localMap = new Map(localComments.map(c => [c.id, c]));
  const remoteMap = new Map(remoteComments.map(c => [c.id, c]));

  const merged = [];
  const conflicts = [];
  let added = 0;
  let updated = 0;
  let deleted = 0;

  // 모든 ID 수집
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!local && remote) {
      // 원격에만 있음 → 추가 (삭제된 마커도 포함)
      merged.push(remote);
      if (!remote.deleted) {
        added++;
      }
    } else if (local && !remote) {
      // 로컬에만 있음 → 유지
      merged.push(local);
    } else if (local && remote) {
      // 둘 다 있음 → updatedAt 비교로 최신 버전 선택
      const localTime = new Date(local.updatedAt || local.createdAt).getTime();
      const remoteTime = new Date(remote.updatedAt || remote.createdAt).getTime();

      if (localTime === remoteTime) {
        // 동일 → 로컬 유지
        merged.push(local);
      } else if (remoteTime > localTime) {
        // 원격이 더 최신 → 원격 사용
        merged.push(remote);
        // 삭제 상태 변경 추적
        if (remote.deleted && !local.deleted) {
          deleted++;
        } else if (!remote.deleted) {
          updated++;
        }
      } else {
        // 로컬이 더 최신 → 로컬 유지
        merged.push(local);
      }
    }
  }

  return { merged, conflicts, added, updated, deleted };
}

/**
 * 두 레이어 목록을 머지
 */
export function mergeLayers(localLayers, remoteLayers) {
  const localMap = new Map(localLayers.map(l => [l.id, l]));
  const remoteMap = new Map(remoteLayers.map(l => [l.id, l]));

  const merged = [];
  let totalAdded = 0;
  let totalUpdated = 0;

  // 모든 레이어 ID 수집
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  for (const id of allIds) {
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!local && remote) {
      // 원격에만 있는 레이어 → 추가
      merged.push(remote);
      totalAdded += remote.markers?.length || 0;
    } else if (local && !remote) {
      // 로컬에만 있는 레이어 → 유지
      merged.push(local);
    } else if (local && remote) {
      // 둘 다 있음 → 마커 머지
      const { merged: mergedMarkers, added, updated } = mergeComments(
        local.markers || [],
        remote.markers || []
      );

      merged.push({
        ...local,
        markers: mergedMarkers
      });

      totalAdded += added;
      totalUpdated += updated;
    }
  }

  return { merged, added: totalAdded, updated: totalUpdated };
}

export default CollaborationManager;
