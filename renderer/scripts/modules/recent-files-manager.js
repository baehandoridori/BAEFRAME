/**
 * baeframe - Recent Files Manager
 *
 * IPC 래핑 + 이벤트 발행. DOM 조작은 하지 않는다.
 * 뷰(recent-files-view)가 이 매니저의 'updated' 이벤트를 구독해 재렌더링한다.
 */

import { createLogger } from '../logger.js';

const log = createLogger('RecentFilesManager');

export class RecentFilesManager extends EventTarget {
  constructor() {
    super();
    this._items = [];
    this._thumbCaptureQueue = new Set(); // 동시 캡처 제어용
    this._maxConcurrentCaptures = 2;
    this._activeCaptures = 0;
    this._pendingCaptures = [];
  }

  getCached() {
    return this._items;
  }

  async refresh() {
    try {
      this._items = await window.electronAPI.recentList();
      this._emitUpdated();
      return this._items;
    } catch (err) {
      log.warn('recent list 조회 실패', { error: err.message });
      this._items = [];
      this._emitUpdated();
      return [];
    }
  }

  async add(input) {
    if (!input || !input.path) return;

    try {
      const { id, item } = await window.electronAPI.recentAdd(input);
      await this.refresh();

      if (!item || !item.thumbPath) {
        this._enqueueThumbCapture({ videoPath: input.path, id, durationSec: input.duration });
      }
    } catch (err) {
      log.warn('recent add 실패', { error: err.message });
    }
  }

  async remove(id) {
    try {
      await window.electronAPI.recentRemove(id);
      await this.refresh();
    } catch (err) {
      log.warn('recent remove 실패', { error: err.message });
    }
  }

  async clear() {
    try {
      await window.electronAPI.recentClear();
      await this.refresh();
    } catch (err) {
      log.warn('recent clear 실패', { error: err.message });
    }
  }

  async togglePin(id) {
    try {
      const result = await window.electronAPI.recentTogglePin(id);
      await this.refresh();
      return result;
    } catch (err) {
      throw err;
    }
  }

  async openInFolder(filePath) {
    try {
      return await window.electronAPI.recentOpenInFolder(filePath);
    } catch (err) {
      log.warn('openInFolder 실패', { error: err.message });
      return { success: false };
    }
  }

  async getThumbUrl(id) {
    try {
      return await window.electronAPI.recentGetThumbUrl(id);
    } catch (err) {
      return null;
    }
  }

  // ---- 내부: 썸네일 캡처 동시성 제어 ----

  _enqueueThumbCapture(task) {
    if (this._thumbCaptureQueue.has(task.id)) return;
    this._thumbCaptureQueue.add(task.id);
    this._pendingCaptures.push(task);
    this._drainCaptureQueue();
  }

  _drainCaptureQueue() {
    while (this._activeCaptures < this._maxConcurrentCaptures && this._pendingCaptures.length > 0) {
      const task = this._pendingCaptures.shift();
      this._activeCaptures++;
      this._runCapture(task).finally(() => {
        this._activeCaptures--;
        this._thumbCaptureQueue.delete(task.id);
        this._drainCaptureQueue();
      });
    }
  }

  async _runCapture(task) {
    try {
      const result = await window.electronAPI.recentCaptureThumb(
        task.videoPath, task.id, task.durationSec || 0
      );
      if (result && result.thumbPath) {
        log.debug('썸네일 캡처 완료', { id: task.id });
        await this.refresh();
      }
    } catch (err) {
      log.warn('썸네일 캡처 예외', { error: err.message });
    }
  }

  _emitUpdated() {
    this.dispatchEvent(new CustomEvent('updated', { detail: { items: this._items } }));
  }
}

// 싱글턴 인스턴스
let instance = null;

export function getRecentFilesManager() {
  if (!instance) {
    instance = new RecentFilesManager();
  }
  return instance;
}
