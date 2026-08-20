/**
 * BAEFRAME - Fabric Drawing Sync (Broadcast 기반)
 * Fabric 드로잉(drawingsV3) 루트 스냅샷 ↔ Liveblocks Broadcast 동기화
 *
 * 배경: Fabric 정식 승격 이후 드로잉은 .bframe의 drawingsV3에만 저장되고
 * 실시간 채널이 없었다. 이 모듈은 저장 완료 시점의 drawingsV3 루트 스냅샷을
 * Broadcast로 전파하고, 수신측은 ReviewDataManager의 디스크 반영 파이프라인
 * (applyExternalDrawingsV3)을 재사용해 오버레이를 재수화한다.
 * 충돌 정책: 수신측에 미저장 로컬 드로잉 변경이 있으면 적용하지 않는다
 * (fail-closed — 기존 fabric-drawing-conflict 정책과 동일).
 */

import { createLogger } from '../logger.js';

const log = createLogger('FabricDrawingSync');

// Broadcast 메시지 사이즈 제한 (drawing-sync.js와 동일 기준)
const ROOT_CHUNK_RAW_SIZE = 384 * 1024;
const ROOT_CHUNK_TIMEOUT_MS = 30000;
const MAX_ROOT_TRANSFER_BYTES = 32 * 1024 * 1024;
const MAX_ROOT_CHUNKS = Math.ceil(MAX_ROOT_TRANSFER_BYTES / ROOT_CHUNK_RAW_SIZE);
// 이 크기 미만이면 청크 없이 인라인 전송 (봉투 오버헤드 포함 Liveblocks 1MB 제한 준수)
const INLINE_ROOT_MAX_BYTES = 700 * 1024;
const ROOT_REQUEST_STABILIZATION_MS = 10000;

// drawingsV3 지문(review-data-manager의 captureDrawingsV3DiskState)은 해시가 아니라
// 'present:' + 전체 canonical JSON 문자열이다 — 와이어에 그대로 실으면 payload가
// 2배가 되어 1MB 한도를 깨뜨린다. 이벤트에는 반드시 이 짧은 해시만 싣는다.
function hashFingerprint(fingerprint) {
  if (typeof fingerprint !== 'string') return null;
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let index = 0; index < fingerprint.length; index++) {
    const code = fingerprint.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x01000197) >>> 0;
  }
  return `${h1.toString(36)}-${h2.toString(36)}-${fingerprint.length.toString(36)}`;
}

function createSyncActorId() {
  try {
    const randomId = globalThis.crypto?.randomUUID?.();
    if (typeof randomId === 'string' && randomId.length > 0) return randomId;
  } catch (_error) {
    // 보안 난수 API가 없는 구형 런타임은 아래 세션 한정 식별자로 폴백한다.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function getRootRevision(rootValue) {
  const revision = Number(rootValue?.revision);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizeSyncVersion(value, fingerprint) {
  const clock = Number(value?.clock);
  const actorId = value?.actorId;
  if (!Number.isSafeInteger(clock) || clock < 0 ||
      typeof actorId !== 'string' || actorId.length > 512) {
    return null;
  }
  return {
    clock,
    actorId,
    fingerprint: typeof fingerprint === 'string' ? fingerprint : ''
  };
}

function compareSyncVersions(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.clock !== right.clock) return left.clock > right.clock ? 1 : -1;
  if (left.actorId !== right.actorId) return left.actorId > right.actorId ? 1 : -1;
  if (left.fingerprint === right.fingerprint) return 0;
  return left.fingerprint > right.fingerprint ? 1 : -1;
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

export class FabricDrawingSync {
  constructor({
    liveblocksManager,
    reviewDataManager,
    now = () => Date.now(),
    actorId = null
  }) {
    this._lm = liveblocksManager;
    this._rdm = reviewDataManager;
    this._now = now;
    this._explicitActorId = typeof actorId === 'string' && actorId.length > 0
      ? actorId
      : null;
    this._actorId = null;
    this._rootClock = 0;
    this._currentRootVersion = null;
    this._pendingExternalRoot = null;
    this._started = false;
    // stop()마다 증가하는 세션 세대 — stop→start 경계를 넘어 살아남은
    // 이전 세션의 적용 큐 항목을 무효화하는 fence다
    this._sessionGeneration = 0;
    this._sessionStartedAt = 0;
    this._lastSentFingerprint = null;
    this._transfer = null;
    this._applyQueue = Promise.resolve();
    this._onSaved = this._onSaved.bind(this);
    this._onBroadcast = this._onBroadcast.bind(this);
    log.info('FabricDrawingSync 초기화됨 (Broadcast 모드)');
  }

  start() {
    if (this._started) return;
    const connectionId = this._lm.getSelf?.()?.connectionId;
    this._actorId = this._explicitActorId ||
      (connectionId !== null && connectionId !== undefined
        ? String(connectionId)
        : createSyncActorId());
    this._rootClock = 0;
    this._currentRootVersion = null;
    this._pendingExternalRoot = null;
    const current = this._ensureCurrentRootVersion();
    this._rdm.addEventListener('saved', this._onSaved);
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);
    this._sessionStartedAt = this._now();
    this._started = true;
    try {
      const requestEvent = { type: 'FABRIC_DRAWING_ROOT_REQUEST' };
      if (current.version) {
        requestEvent.fingerprint = current.fingerprint;
        requestEvent.syncVersion = {
          clock: current.version.clock,
          actorId: current.version.actorId
        };
      }
      this._lm.broadcastEvent(requestEvent);
    } catch (error) {
      log.warn('drawingsV3 seed 요청 실패', { error: error?.message || String(error) });
    }
    log.info('Fabric 드로잉 동기화 시작됨');
  }

  stop() {
    if (!this._started) return;
    this._rdm.removeEventListener('saved', this._onSaved);
    this._lm.removeEventListener('broadcastReceived', this._onBroadcast);
    this._clearTransfer();
    this._lastSentFingerprint = null;
    this._started = false;
    this._sessionStartedAt = 0;
    this._actorId = null;
    this._rootClock = 0;
    this._currentRootVersion = null;
    this._pendingExternalRoot = null;
    // 이 세션에서 큐잉된 적용을 전부 무효화한다 (stop→start 재시작 후 실행 방지).
    // 리스너는 이미 해제되어 정지 중 새 큐잉은 없으므로 stop 시점 증가로 충분하다.
    this._sessionGeneration += 1;
    log.info('Fabric 드로잉 동기화 중지됨');
  }

  /** 늦게 참여한 협업자 seed용 — 지문 중복 검사 없이 현재 상태를 전송한다 */
  broadcastCurrentState() {
    this._broadcastRoot({ force: true });
  }

  _onSaved() {
    const published = this._broadcastRoot({
      force: false,
      localSave: true,
      peerConfirmed: Boolean(this._pendingExternalRoot)
    });
    if (published?.createdVersion) {
      this._discardPendingExternalRootAtOrBelow(
        published.version,
        published.version.fingerprint
      );
    }
  }

  _broadcastRoot({
    force,
    peerConfirmed = false,
    localSave = false,
    causalFloor = null
  }) {
    if (!this._started || (!peerConfirmed && !this._lm.hasOtherCollaborators())) return;
    const snapshot = this._rdm.getDrawingsV3RootSnapshot?.();
    if (!snapshot || typeof snapshot.present !== 'boolean') return;
    // 구버전 디스크 상태(Broadcast 적용 이전)를 재전파하지 않는다
    if (snapshot.stale === true) return;
    const wireFingerprint = hashFingerprint(snapshot.fingerprint);
    if (!force && wireFingerprint === this._lastSentFingerprint) return;
    const preparedVersion = this._prepareOutgoingRootVersion(
      snapshot.value,
      wireFingerprint,
      { localSave, causalFloor }
    );
    const syncVersion = {
      clock: preparedVersion.version.clock,
      actorId: preparedVersion.version.actorId
    };
    try {
      const payloadBytes = snapshot.present
        ? new TextEncoder().encode(JSON.stringify(snapshot.value))
        : new Uint8Array(0);
      if (snapshot.present && payloadBytes.length > MAX_ROOT_TRANSFER_BYTES) {
        log.warn('drawingsV3 스냅샷이 너무 커 브로드캐스트 생략', { bytes: payloadBytes.length });
        return;
      }
      const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      if (!snapshot.present) {
        this._lm.broadcastEvent({
          type: 'FABRIC_DRAWING_ROOT',
          transferId,
          present: false,
          fingerprint: wireFingerprint,
          syncVersion
        });
      } else if (payloadBytes.length < INLINE_ROOT_MAX_BYTES) {
        this._lm.broadcastEvent({
          type: 'FABRIC_DRAWING_ROOT',
          transferId,
          present: true,
          fingerprint: wireFingerprint,
          syncVersion,
          root: snapshot.value
        });
      } else {
        const count = Math.ceil(payloadBytes.length / ROOT_CHUNK_RAW_SIZE);
        if (count > MAX_ROOT_CHUNKS) {
          log.warn('drawingsV3 청크 수 초과로 브로드캐스트 생략', { count });
          return;
        }
        this._lm.broadcastEvent({
          type: 'FABRIC_DRAWING_ROOT',
          transferId,
          present: true,
          fingerprint: wireFingerprint,
          syncVersion,
          chunkCount: count
        });
        for (let index = 0; index < count; index++) {
          const start = index * ROOT_CHUNK_RAW_SIZE;
          this._lm.broadcastEvent({
            type: 'FABRIC_DRAWING_ROOT_CHUNK',
            transferId,
            index,
            count,
            data: bytesToBase64(payloadBytes.subarray(start, start + ROOT_CHUNK_RAW_SIZE))
          });
        }
      }
      this._lastSentFingerprint = wireFingerprint;
      log.info('drawingsV3 브로드캐스트 전송', { transferId, bytes: payloadBytes.length });
      return preparedVersion;
    } catch (error) {
      log.error('drawingsV3 브로드캐스트 실패', { error: error?.message || String(error) });
      return preparedVersion;
    }
  }

  _ensureCurrentRootVersion() {
    const snapshot = this._rdm.getDrawingsV3RootSnapshot?.();
    if (!snapshot || typeof snapshot.present !== 'boolean' ||
        typeof snapshot.fingerprint !== 'string') {
      this._currentRootVersion = null;
      return { snapshot, fingerprint: null, version: null };
    }
    const fingerprint = hashFingerprint(snapshot.fingerprint);
    if (this._currentRootVersion?.fingerprint === fingerprint) {
      return { snapshot, fingerprint, version: this._currentRootVersion };
    }
    const version = {
      clock: Math.max(this._rootClock, getRootRevision(snapshot.value)),
      actorId: '',
      fingerprint: fingerprint || ''
    };
    this._rootClock = Math.max(this._rootClock, version.clock);
    this._currentRootVersion = version;
    return { snapshot, fingerprint, version };
  }

  _prepareOutgoingRootVersion(rootValue, fingerprint, { localSave, causalFloor = null }) {
    const currentMatches = this._currentRootVersion?.fingerprint === fingerprint;
    if (causalFloor) {
      this._rootClock = Math.max(this._rootClock, causalFloor.clock);
    }
    const requiresCausalPromotion = Boolean(
      causalFloor &&
      causalFloor.fingerprint !== fingerprint &&
      compareSyncVersions(this._currentRootVersion, causalFloor) <= 0
    );
    let createdVersion = false;
    if (!currentMatches || this._currentRootVersion.actorId === '' ||
        requiresCausalPromotion) {
      const rootRevision = getRootRevision(rootValue);
      const nextClock = this._rootClock < Number.MAX_SAFE_INTEGER
        ? this._rootClock + 1
        : Number.MAX_SAFE_INTEGER;
      this._currentRootVersion = {
        clock: Math.max(nextClock, rootRevision),
        actorId: this._actorId || '',
        fingerprint: fingerprint || ''
      };
      createdVersion = localSave && !currentMatches;
    }
    this._rootClock = Math.max(this._rootClock, this._currentRootVersion.clock);
    return { version: this._currentRootVersion, createdVersion };
  }

  _normalizeIncomingRootVersion(rootValue, fingerprint, value) {
    return normalizeSyncVersion(value, fingerprint) || {
      clock: getRootRevision(rootValue),
      actorId: '',
      fingerprint: typeof fingerprint === 'string' ? fingerprint : ''
    };
  }

  _markExternalRootSuperseded(rootValue, present = true) {
    try {
      this._rdm.markExternalDrawingsV3Superseded?.(rootValue, { present });
    } catch (error) {
      log.warn('패자 drawingsV3 지문 기록 실패', {
        error: error?.message || String(error)
      });
    }
  }

  _compareIncomingAgainstPending(candidate) {
    const pending = this._pendingExternalRoot;
    if (!pending) return 1;
    const comparison = compareSyncVersions(candidate.version, pending.version);
    if (comparison < 0) {
      this._markExternalRootSuperseded(candidate.rootValue, candidate.present);
      return -1;
    }
    if (comparison > 0) {
      this._markExternalRootSuperseded(pending.rootValue, pending.present);
      this._pendingExternalRoot = null;
    }
    return comparison;
  }

  _discardPendingExternalRootAtOrBelow(winnerVersion, winnerFingerprint) {
    const pending = this._pendingExternalRoot;
    if (!pending) return;
    const comparison = compareSyncVersions(pending.version, winnerVersion);
    if (comparison > 0 ||
        (comparison === 0 && pending.fingerprint !== winnerFingerprint)) {
      return;
    }
    if (comparison < 0) {
      this._markExternalRootSuperseded(pending.rootValue, pending.present);
    }
    this._pendingExternalRoot = null;
  }

  _onBroadcast(e) {
    const event = e.detail?.event || e.detail;
    if (!event?.type) return;

    if (event.type === 'FABRIC_DRAWING_ROOT_REQUEST') {
      const requestVersion = normalizeSyncVersion(
        event.syncVersion,
        event.fingerprint
      );
      if (requestVersion) {
        this._rootClock = Math.max(this._rootClock, requestVersion.clock);
      }
      if (this._now() - this._sessionStartedAt > ROOT_REQUEST_STABILIZATION_MS) {
        this._broadcastRoot({
          force: true,
          peerConfirmed: true,
          causalFloor: requestVersion
        });
      }
      return;
    }

    if (event.type === 'FABRIC_DRAWING_ROOT') {
      if (event.present === false) {
        this._enqueueApply(
          undefined,
          event.fingerprint,
          event.syncVersion,
          false
        );
        return;
      }
      if (event.root !== undefined) {
        this._enqueueApply(event.root, event.fingerprint, event.syncVersion, true);
        return;
      }
      const count = Math.trunc(Number(event.chunkCount));
      if (typeof event.transferId !== 'string' ||
          !Number.isFinite(count) || count < 1 || count > MAX_ROOT_CHUNKS) {
        return;
      }
      const fingerprint = typeof event.fingerprint === 'string'
        ? event.fingerprint
        : null;
      const orderingVersion = this._normalizeIncomingRootVersion(
        undefined,
        fingerprint,
        event.syncVersion
      );
      // 청크 본문이 늦게 도착하더라도 header 수신 자체는 causal observation이다.
      // 그 사이의 로컬 저장은 반드시 이 전송보다 높은 clock을 발급해야 한다.
      this._rootClock = Math.max(this._rootClock, orderingVersion.clock);
      if (this._transfer) {
        const transferComparison = compareSyncVersions(
          orderingVersion,
          this._transfer.orderingVersion
        );
        if (transferComparison < 0 ||
            (transferComparison === 0 &&
             event.transferId === this._transfer.transferId)) {
          return;
        }
      }
      this._clearTransfer();
      this._transfer = {
        transferId: event.transferId,
        fingerprint,
        syncVersion: event.syncVersion,
        orderingVersion,
        chunks: new Array(count),
        received: 0,
        count,
        timer: setTimeout(() => this._clearTransfer(), ROOT_CHUNK_TIMEOUT_MS)
      };
      return;
    }

    if (event.type === 'FABRIC_DRAWING_ROOT_CHUNK') {
      const transfer = this._transfer;
      if (!transfer || transfer.transferId !== event.transferId) return;
      const index = Math.trunc(Number(event.index));
      if (!Number.isFinite(index) || index < 0 || index >= transfer.count ||
          typeof event.data !== 'string' || transfer.chunks[index] !== undefined) {
        return;
      }
      transfer.chunks[index] = event.data;
      transfer.received += 1;
      if (transfer.received < transfer.count) return;

      let rootValue;
      const fingerprint = transfer.fingerprint;
      const syncVersion = transfer.syncVersion;
      try {
        const chunkBytes = transfer.chunks.map(chunk => base64ToBytes(chunk));
        const totalLength = chunkBytes.reduce((sum, bytes) => sum + bytes.length, 0);
        if (totalLength > MAX_ROOT_TRANSFER_BYTES) {
          this._clearTransfer();
          return;
        }
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const bytes of chunkBytes) {
          merged.set(bytes, offset);
          offset += bytes.length;
        }
        rootValue = JSON.parse(new TextDecoder().decode(merged));
      } catch (_error) {
        this._clearTransfer();
        return;
      }
      this._clearTransfer();
      this._enqueueApply(rootValue, fingerprint, syncVersion, true);
    }
  }

  _enqueueApply(rootValue, fingerprint, syncVersionValue, present = true) {
    const syncVersion = this._normalizeIncomingRootVersion(
      rootValue,
      fingerprint,
      syncVersionValue
    );
    // 적용 성공 여부와 무관하게 수신 시점에 Lamport clock을 관측해야,
    // local-dirty로 거절한 뒤의 로컬 저장이 수신 루트보다 새 버전을 발급한다.
    this._rootClock = Math.max(this._rootClock, syncVersion.clock);
    // 수신 시점의 세션 세대·리뷰 파일 경로를 캡처해, 큐 대기 중 세션이 끝나거나
    // (stop→start 재시작 포함) 영상이 전환되면 폐기한다 — 파일 경로만으로는
    // 같은 .bframe 재접속(A→B→A) 시 이전 세션의 잔존 큐를 구분하지 못한다
    const sessionGeneration = this._sessionGeneration;
    const expectedBframePath = this._rdm.currentBframePath || null;
    this._applyQueue = this._applyQueue.then(async () => {
      if (!this._started || sessionGeneration !== this._sessionGeneration) {
        log.debug('원격 drawingsV3 폐기 (협업 세션 종료·재시작)');
        return;
      }
      if ((this._rdm.currentBframePath || null) !== expectedBframePath) {
        log.debug('원격 drawingsV3 폐기 (리뷰 파일 전환됨)');
        return;
      }
      const candidate = { rootValue, present, fingerprint, version: syncVersion };
      if (this._compareIncomingAgainstPending(candidate) < 0) {
        log.debug('원격 drawingsV3 폐기 (더 최신인 대기 루트 존재)');
        return;
      }
      const current = this._ensureCurrentRootVersion();
      const sameRoot = Boolean(
        fingerprint && current.fingerprint && fingerprint === current.fingerprint
      );
      const comparison = compareSyncVersions(syncVersion, current.version);
      if (sameRoot) {
        if (comparison > 0) this._currentRootVersion = syncVersion;
        this._discardPendingExternalRootAtOrBelow(
          this._currentRootVersion,
          fingerprint
        );
        this._lastSentFingerprint = fingerprint;
        return;
      }
      if (comparison <= 0) {
        this._markExternalRootSuperseded(rootValue, present);
        log.debug('원격 drawingsV3 폐기 (결정적 버전 패자)');
        return;
      }
      const applied = await this._rdm.applyExternalDrawingsV3?.(rootValue, { present });
      if (!this._started || sessionGeneration !== this._sessionGeneration ||
          (this._rdm.currentBframePath || null) !== expectedBframePath) {
        return;
      }
      const postApply = this._ensureCurrentRootVersion();
      const finalRootIsIncoming = !fingerprint || fingerprint === postApply.fingerprint;
      const postApplyComparison = compareSyncVersions(syncVersion, postApply.version);
      if (applied && !finalRootIsIncoming) {
        if (this._pendingExternalRoot && compareSyncVersions(
          this._pendingExternalRoot.version,
          syncVersion
        ) === 0) {
          this._pendingExternalRoot = null;
        }
        this._markExternalRootSuperseded(rootValue, present);
        log.debug('원격 drawingsV3 반영 뒤 폐기 (현재 루트 불일치)');
      } else if (applied) {
        // 수신 상태를 그대로 재브로드캐스트하지 않도록 지문을 기록한다
        if (typeof fingerprint === 'string') this._lastSentFingerprint = fingerprint;
        if (postApplyComparison > 0) this._currentRootVersion = syncVersion;
        this._discardPendingExternalRootAtOrBelow(
          this._currentRootVersion,
          fingerprint
        );
        log.info('원격 drawingsV3 반영됨');
      } else if (postApplyComparison <= 0) {
        this._markExternalRootSuperseded(rootValue, present);
        this._discardPendingExternalRootAtOrBelow(
          postApply.version,
          postApply.fingerprint
        );
        log.debug('원격 drawingsV3 반영 뒤 폐기 (await 중 최신 루트 확정)');
      } else {
        this._pendingExternalRoot = candidate;
        log.debug('원격 drawingsV3 반영 생략 (로컬 변경 보호 또는 동일 상태)');
      }
    }).catch(error => {
      log.warn('원격 drawingsV3 반영 실패', { error: error?.message || String(error) });
    });
  }

  _clearTransfer() {
    if (this._transfer?.timer) clearTimeout(this._transfer.timer);
    this._transfer = null;
  }
}
