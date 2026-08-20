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
  constructor({ liveblocksManager, reviewDataManager, now = () => Date.now() }) {
    this._lm = liveblocksManager;
    this._rdm = reviewDataManager;
    this._now = now;
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
    this._rdm.addEventListener('saved', this._onSaved);
    this._lm.addEventListener('broadcastReceived', this._onBroadcast);
    this._sessionStartedAt = this._now();
    this._started = true;
    try {
      this._lm.broadcastEvent({ type: 'FABRIC_DRAWING_ROOT_REQUEST' });
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
    this._broadcastRoot({ force: false });
  }

  _broadcastRoot({ force, peerConfirmed = false }) {
    if (!this._started || (!peerConfirmed && !this._lm.hasOtherCollaborators())) return;
    const snapshot = this._rdm.getDrawingsV3RootSnapshot?.();
    if (!snapshot?.present) return;
    // 구버전 디스크 상태(Broadcast 적용 이전)를 재전파하지 않는다
    if (snapshot.stale === true) return;
    const wireFingerprint = hashFingerprint(snapshot.fingerprint);
    if (!force && wireFingerprint === this._lastSentFingerprint) return;
    try {
      const payloadBytes = new TextEncoder().encode(JSON.stringify(snapshot.value));
      if (payloadBytes.length > MAX_ROOT_TRANSFER_BYTES) {
        log.warn('drawingsV3 스냅샷이 너무 커 브로드캐스트 생략', { bytes: payloadBytes.length });
        return;
      }
      const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      if (payloadBytes.length < INLINE_ROOT_MAX_BYTES) {
        this._lm.broadcastEvent({
          type: 'FABRIC_DRAWING_ROOT',
          transferId,
          fingerprint: wireFingerprint,
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
          fingerprint: wireFingerprint,
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
    } catch (error) {
      log.error('drawingsV3 브로드캐스트 실패', { error: error?.message || String(error) });
    }
  }

  _onBroadcast(e) {
    const event = e.detail?.event || e.detail;
    if (!event?.type) return;

    if (event.type === 'FABRIC_DRAWING_ROOT_REQUEST') {
      if (this._now() - this._sessionStartedAt > ROOT_REQUEST_STABILIZATION_MS) {
        this._broadcastRoot({ force: true, peerConfirmed: true });
      }
      return;
    }

    if (event.type === 'FABRIC_DRAWING_ROOT') {
      if (event.root !== undefined) {
        this._enqueueApply(event.root, event.fingerprint);
        return;
      }
      const count = Math.trunc(Number(event.chunkCount));
      if (typeof event.transferId !== 'string' ||
          !Number.isFinite(count) || count < 1 || count > MAX_ROOT_CHUNKS) {
        return;
      }
      this._clearTransfer();
      this._transfer = {
        transferId: event.transferId,
        fingerprint: typeof event.fingerprint === 'string' ? event.fingerprint : null,
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
      this._enqueueApply(rootValue, fingerprint);
    }
  }

  _enqueueApply(rootValue, fingerprint) {
    // 자기 전송분 에코 방지 (Liveblocks Broadcast는 자기에게 안 오지만 방어)
    if (fingerprint && fingerprint === this._lastSentFingerprint) return;
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
      const applied = await this._rdm.applyExternalDrawingsV3?.(rootValue);
      if (applied) {
        // 수신 상태를 그대로 재브로드캐스트하지 않도록 지문을 기록한다
        if (typeof fingerprint === 'string') this._lastSentFingerprint = fingerprint;
        log.info('원격 drawingsV3 반영됨');
      } else {
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
