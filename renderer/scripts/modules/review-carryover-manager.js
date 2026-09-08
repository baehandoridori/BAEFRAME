import {
  cloneReviewCarryover, isSupportedReviewCarryover, isValidReviewSource,
  mergeReviewCarryover, REVIEW_CARRYOVER_STATUSES
} from '../../../shared/review-carryover.js';

export class ReviewCarryoverManager extends EventTarget {
  constructor() {
    super();
    this._value = { version: 1, items: [] };
  }

  get isEditable() { return isSupportedReviewCarryover(this._value); }
  getItems() { return this.isEditable ? cloneReviewCarryover(this._value.items.filter(item => !item.deleted)) : []; }
  hasSource(key) { return this.isEditable && this._value.items.some(item => item.id === key && !item.deleted); }
  toJSON() { return cloneReviewCarryover(this._value); }
  fromJSON(value) {
    this._value = value === undefined ? { version: 1, items: [] } :
      isSupportedReviewCarryover(value) ? mergeReviewCarryover(undefined, value, value) : cloneReviewCarryover(value);
    this.dispatchEvent(new Event('loaded'));
  }
  reset() { this.fromJSON(undefined); }

  _assertEditable() {
    if (!this.isEditable) throw new Error('지원하지 않거나 손상된 이전 리뷰 확인 데이터입니다. 원본을 보존하기 위해 수정할 수 없습니다.');
  }

  _update(item, actor) {
    // Keep revisions ordered even during several clicks within one millisecond.
    const previous = Date.parse(item.updatedAt) || 0;
    item.updatedAt = new Date(Math.max(Date.now(), previous + 1)).toISOString();
    item.updatedBy = typeof actor === 'string' ? actor : '';
    this.dispatchEvent(new CustomEvent('changed', { detail: { id: item.id } }));
    return cloneReviewCarryover(item);
  }

  carry(source, actor = '') {
    this._assertEditable();
    if (!isValidReviewSource(source)) throw new TypeError('이전 리뷰 원문 정보가 유효하지 않습니다.');
    const existing = this._value.items.find(item => item.id === source.key);
    if (existing && !existing.deleted) return cloneReviewCarryover(existing);
    if (existing) {
      existing.generation = (existing.generation || 0) + 1;
      existing.deleted = false; existing.status = source.resolved ? 'verified' : 'pending';
      existing.source = cloneReviewCarryover(source);
      return this._update(existing, actor);
    }
    const item = { id: source.key, source: cloneReviewCarryover(source), status: source.resolved ? 'verified' : 'pending', deleted: false, generation: 0 };
    this._value.items.push(item);
    return this._update(item, actor);
  }

  // Keep the existing on-disk status values readable; the UI only offers resolved/unresolved.
  setResolved(id, resolved, actor = '') {
    if (typeof resolved !== 'boolean') throw new TypeError('해결 상태는 참 또는 거짓이어야 합니다.');
    return this.setStatus(id, resolved ? 'verified' : 'pending', actor);
  }

  setStatus(id, status, actor = '') {
    this._assertEditable();
    if (!REVIEW_CARRYOVER_STATUSES.includes(status)) throw new TypeError('유효하지 않은 검수 상태입니다.');
    const item = this._value.items.find(value => value.id === id && !value.deleted);
    if (!item) return false;
    if (item.status === status) return cloneReviewCarryover(item);
    item.status = status;
    return this._update(item, actor);
  }

  remove(id, actor = '') {
    this._assertEditable();
    const item = this._value.items.find(value => value.id === id && !value.deleted);
    if (!item) return false;
    item.deleted = true;
    return this._update(item, actor);
  }
}

export default ReviewCarryoverManager;
