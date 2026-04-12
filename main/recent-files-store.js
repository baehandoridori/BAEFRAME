/**
 * baeframe - Recent Files Store
 *
 * 최근 연 미디어 파일의 메타데이터 저장소.
 * electron-store를 주입받아 테스트에서는 mock으로 대체 가능하게 한다.
 *
 * 스키마:
 *   items:  RecentItem[]
 *   pinned: string[]  (id 배열, 최대 5)
 *
 * 정렬: 고정 순서 → openedAt 내림차순
 * 용량: 비고정 최대 10개 (초과 시 가장 오래된 비고정 제거)
 */

const crypto = require('crypto');

const MAX_UNPINNED = 10;
const MAX_PINNED = 5;

/**
 * 경로를 정규화해 id 안정성을 확보한다.
 * - Windows 역슬래시를 슬래시로 통일
 * - 소문자화 (Windows는 대소문자 구분 안 함)
 * - 끝 슬래시 제거
 */
function normalizePath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function hashPath(p) {
  return crypto.createHash('sha1').update(normalizePath(p)).digest('hex');
}

class RecentFilesStore {
  /**
   * @param {object} options
   * @param {object} options.store - electron-store 인터페이스 (get/set/clear)
   * @param {() => number} [options.now] - 현재 시각 공급자 (테스트 주입용)
   */
  constructor({ store, now = () => Date.now() }) {
    if (!store) throw new Error('store is required');
    this._store = store;
    this._now = now;
  }

  // ---- 내부 상태 접근 ----

  _readItems() {
    const items = this._store.get('items', []);
    return Array.isArray(items) ? items : [];
  }

  _readPinned() {
    const pinned = this._store.get('pinned', []);
    return Array.isArray(pinned) ? pinned : [];
  }

  _writeItems(items) {
    this._store.set('items', items);
  }

  _writePinned(pinned) {
    this._store.set('pinned', pinned);
  }

  // ---- 공개 API ----

  /**
   * 정렬된 전체 목록을 반환. 각 항목에 _pinned 플래그가 부여된다.
   */
  list() {
    const items = this._readItems();
    const pinned = this._readPinned();
    const pinnedSet = new Set(pinned);

    // 고정 섹션: pinned 배열 순서 (사용자가 고정한 순서 유지)
    const pinnedItems = pinned
      .map(id => items.find(i => i.id === id))
      .filter(Boolean)
      .map(i => ({ ...i, _pinned: true }));

    // 일반 섹션: 비고정 항목, openedAt 내림차순
    const regular = items
      .filter(i => !pinnedSet.has(i.id))
      .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
      .map(i => ({ ...i, _pinned: false }));

    return [...pinnedItems, ...regular];
  }

  /**
   * 경로를 기준으로 id를 계산해 반환한다 (외부에서도 재사용).
   */
  computeId(path) {
    return hashPath(path);
  }

  /**
   * 단일 항목 조회. 없으면 null.
   */
  getById(id) {
    const item = this._readItems().find(i => i.id === id);
    return item ? { ...item } : null;
  }

  /**
   * 항목을 삽입하거나 갱신한다.
   * 같은 id가 있으면 openedAt 갱신 + openCount++.
   * size가 달라졌으면 thumbPath 무효화.
   * 비고정 항목이 MAX_UNPINNED를 초과하면 가장 오래된 비고정 제거.
   *
   * @param {object} input - { path, name, dir, ext, size, duration }
   * @returns {{id: string, item: object}}
   */
  upsert(input) {
    if (!input || !input.path) throw new Error('path is required');

    const id = hashPath(input.path);
    const items = this._readItems();
    const now = this._now();

    const existingIdx = items.findIndex(i => i.id === id);

    if (existingIdx >= 0) {
      const existing = items[existingIdx];
      const sizeChanged = input.size != null && existing.size !== input.size;

      items[existingIdx] = {
        ...existing,
        path: input.path,
        name: input.name,
        dir: input.dir,
        ext: input.ext,
        size: input.size != null ? input.size : existing.size,
        duration: input.duration != null ? input.duration : existing.duration,
        thumbPath: sizeChanged ? null : existing.thumbPath,
        openedAt: now,
        openCount: (existing.openCount || 0) + 1
      };
    } else {
      items.push({
        id,
        path: input.path,
        name: input.name,
        dir: input.dir,
        ext: input.ext,
        size: input.size || 0,
        duration: input.duration || 0,
        thumbPath: null,
        openedAt: now,
        openCount: 1
      });
    }

    // 용량 트림
    const pinnedSet = new Set(this._readPinned());
    const unpinned = items.filter(i => !pinnedSet.has(i.id));

    let removedIds = [];
    if (unpinned.length > MAX_UNPINNED) {
      removedIds = unpinned
        .sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0))
        .slice(0, unpinned.length - MAX_UNPINNED)
        .map(i => i.id);
      const removeSet = new Set(removedIds);
      const trimmed = items.filter(i => !removeSet.has(i.id));
      this._writeItems(trimmed);
    } else {
      this._writeItems(items);
    }

    const savedItem = this._readItems().find(i => i.id === id);
    return { id, item: savedItem, removedIds };
  }

  /**
   * 썸네일 경로만 갱신한다. openedAt/openCount는 건드리지 않는다.
   */
  updateThumbPath(id, thumbPath) {
    const items = this._readItems();
    const idx = items.findIndex(i => i.id === id);
    if (idx < 0) return false;
    items[idx] = { ...items[idx], thumbPath };
    this._writeItems(items);
    return true;
  }

  /**
   * 단일 항목 제거. 고정 배열에서도 함께 제거한다.
   */
  remove(id) {
    const items = this._readItems().filter(i => i.id !== id);
    this._writeItems(items);

    const pinned = this._readPinned().filter(pid => pid !== id);
    this._writePinned(pinned);
  }

  /**
   * 전체 비우기.
   */
  clear() {
    this._writeItems([]);
    this._writePinned([]);
  }

  /**
   * 고정 토글. 5개 초과 시도는 예외를 던진다.
   * @returns {{pinned: boolean}}
   */
  togglePin(id) {
    const item = this.getById(id);
    if (!item) throw new Error(`항목을 찾을 수 없음: ${id}`);

    const pinned = this._readPinned();
    const idx = pinned.indexOf(id);

    if (idx >= 0) {
      pinned.splice(idx, 1);
      this._writePinned(pinned);
      return { pinned: false };
    }

    if (pinned.length >= MAX_PINNED) {
      throw new Error(`고정은 최대 ${MAX_PINNED}개까지 가능합니다`);
    }

    pinned.push(id);
    this._writePinned(pinned);
    return { pinned: true };
  }

  /**
   * 존재하지 않는 경로의 항목을 일괄 제거.
   * @param {(path: string) => boolean} existsFn
   * @returns {{removedIds: string[]}}
   */
  pruneMissing(existsFn) {
    const items = this._readItems();
    const removedIds = [];
    const keeping = [];

    for (const item of items) {
      if (existsFn(item.path)) {
        keeping.push(item);
      } else {
        removedIds.push(item.id);
      }
    }

    this._writeItems(keeping);

    if (removedIds.length > 0) {
      const removedSet = new Set(removedIds);
      const pinned = this._readPinned().filter(id => !removedSet.has(id));
      this._writePinned(pinned);
    }

    return { removedIds };
  }
}

module.exports = { RecentFilesStore, normalizePath, hashPath };
