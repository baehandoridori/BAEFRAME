/**
 * baeframe - Recent Files View
 *
 * DOM 렌더링 전담. 비즈니스 로직은 매니저에 위임한다.
 * 이벤트 위임으로 카드 클릭/핀/제거 처리.
 */

import { createLogger } from '../logger.js';

const log = createLogger('RecentFilesView');

// ---- SVG 아이콘 (stroke 스타일) ----

const SVG = {
  clock: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  bookmark: (filled) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  film: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`,
  music: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`
};

const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'];

function isAudioExt(ext) {
  return AUDIO_EXTS.includes(String(ext || '').toLowerCase());
}

// ---- 상대 시각 포맷 ----

function formatRelativeTime(ts) {
  if (!ts) return '';
  const diffMs = Date.now() - ts;
  const min = Math.floor(diffMs / 60000);
  const hour = Math.floor(diffMs / 3600000);
  const day = Math.floor(diffMs / 86400000);

  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  if (hour < 24) return `${hour}시간 전`;
  if (day === 1) return '어제';
  if (day < 7) return `${day}일 전`;
  if (day < 14) return '지난주';
  if (day < 30) return `${Math.floor(day / 7)}주 전`;
  if (day < 365) return `${Math.floor(day / 30)}개월 전`;
  return '오래 전';
}

function formatDuration(sec) {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---- 안전한 HTML 이스케이프 ----

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- 카드 HTML 생성 ----

function renderCard(item, { compact = false, missing = false } = {}) {
  const audio = isAudioExt(item.ext);
  const fallbackIcon = audio ? SVG.music : SVG.film;
  const missingClass = missing ? ' recent-card-missing' : '';
  const pinnedBadge = item._pinned
    ? `<div class="recent-card-pin-badge" title="고정됨">${SVG.bookmark(true)}</div>`
    : '';
  const missingOverlay = missing
    ? `<div class="recent-card-missing-overlay">${SVG.alert}</div>`
    : '';

  const thumbContent = item.thumbPath
    ? `<img class="recent-card-thumb-img" data-thumb-id="${escapeHtml(item.id)}" alt="">`
    : `<div class="recent-card-thumb-fallback">${fallbackIcon}</div>`;

  const duration = formatDuration(item.duration);
  const meta = duration
    ? `${escapeHtml(item.dir)} · ${duration}`
    : escapeHtml(item.dir);

  return `
    <div class="recent-card${missingClass}" data-id="${escapeHtml(item.id)}" data-path="${escapeHtml(item.path)}" data-pinned="${item._pinned ? 'true' : 'false'}" role="listitem" tabindex="0">
      <div class="recent-card-thumb">
        ${thumbContent}
        ${pinnedBadge}
        ${missingOverlay}
      </div>
      <div class="recent-card-body">
        <div class="recent-card-name">${escapeHtml(item.name)}</div>
        <div class="recent-card-meta">${meta}</div>
      </div>
      <div class="recent-card-time">${formatRelativeTime(item.openedAt)}</div>
      <div class="recent-card-actions">
        <button class="recent-card-action recent-action-pin" data-action="pin" title="${item._pinned ? '고정 해제' : '고정'}">${SVG.bookmark(item._pinned)}</button>
        <button class="recent-card-action recent-action-remove" data-action="remove" title="목록에서 제거">${SVG.x}</button>
      </div>
    </div>
  `;
}

// ---- 빈 상태 렌더링 (드롭존 내부) ----

export function renderEmptyState(container, items, { onLoadMore } = {}) {
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = '';

  // 인라인 모드: 가로 나란히 카드만 표시
  const isInline = container.classList.contains('recent-inline');

  const pinned = items.filter(i => i._pinned);
  const regular = items.filter(i => !i._pinned);
  const VIEWPORT = isInline ? 6 : 8;
  const visibleRegular = regular.slice(0, Math.max(0, VIEWPORT - pinned.length));
  const allVisible = [...pinned, ...visibleRegular];

  if (isInline) {
    // 인라인: 플랫 카드 리스트 (고정 먼저, 이어서 최근)
    container.innerHTML = `
      <div class="recent-cards" role="list">
        ${allVisible.map(i => renderCard(i)).join('')}
      </div>
    `;
    _loadThumbnails(container);
    return;
  }

  // 기존 세로 레이아웃 (드롭다운 폴백용)
  const hasMore = regular.length > visibleRegular.length;

  const pinnedSection = pinned.length > 0 ? `
    <div class="recent-section-label">${SVG.bookmark(true)} 고정</div>
    <div class="recent-cards" role="list">
      ${pinned.map(i => renderCard(i)).join('')}
    </div>
  ` : '';

  const regularSection = `
    <div class="recent-section-label">최근</div>
    <div class="recent-cards" role="list">
      ${visibleRegular.map(i => renderCard(i)).join('')}
    </div>
    ${hasMore ? `<button class="recent-load-more">더 보기 ${SVG.chevron}</button>` : ''}
  `;

  container.innerHTML = `
    <div class="recent-empty-header">${SVG.clock} 최근 파일</div>
    ${pinnedSection}
    ${regularSection}
    <div class="recent-empty-footer">
      <button class="recent-clear-all">모두 지우기</button>
    </div>
  `;

  _loadThumbnails(container);
}

// ---- 드롭다운 패널 렌더링 ----

export function renderDropdown(container, items) {
  if (!container) return;

  const pinned = items.filter(i => i._pinned);
  const regular = items.filter(i => !i._pinned);

  const pinnedSection = pinned.length > 0 ? `
    <div class="recent-dropdown-section">
      <div class="recent-dropdown-section-label">${SVG.bookmark(true)} 고정</div>
      <div class="recent-cards" role="list">
        ${pinned.map(i => renderCard(i, { compact: true })).join('')}
      </div>
    </div>
    <div class="recent-dropdown-divider"></div>
  ` : '';

  const regularSection = regular.length > 0 ? `
    <div class="recent-dropdown-section">
      <div class="recent-cards" role="list">
        ${regular.map(i => renderCard(i, { compact: true })).join('')}
      </div>
    </div>
  ` : '<div class="recent-dropdown-empty">최근 항목이 없습니다</div>';

  container.innerHTML = `
    <div class="recent-dropdown-header">${SVG.clock} 최근 파일</div>
    ${pinnedSection}
    ${regularSection}
    <div class="recent-dropdown-divider"></div>
    <button class="recent-dropdown-action" data-action="open-other">${SVG.folder} 다른 파일 열기…</button>
  `;

  _loadThumbnails(container);
}

// ---- 썸네일 로드 ----

async function _loadThumbnails(root) {
  const imgs = root.querySelectorAll('img.recent-card-thumb-img[data-thumb-id]');
  for (const img of imgs) {
    const id = img.getAttribute('data-thumb-id');
    try {
      const url = await window.electronAPI.recentGetThumbUrl(id);
      if (url) {
        img.src = url;
      } else {
        const parent = img.parentElement;
        if (parent) {
          parent.innerHTML = `<div class="recent-card-thumb-fallback">${SVG.film}</div>`;
        }
      }
    } catch (e) {
      log.debug('썸네일 URL 조회 실패', { id });
    }
  }
}

// ---- 이벤트 위임 바인딩 ----

export function bindEvents(container, handlers = {}) {
  if (!container) return;

  container.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-action');
      const card = actionBtn.closest('.recent-card');

      if (action === 'pin' && card) {
        handlers.onPin?.(card.getAttribute('data-id'));
        return;
      }
      if (action === 'remove' && card) {
        handlers.onRemove?.(card.getAttribute('data-id'));
        return;
      }
      if (action === 'open-other') {
        handlers.onOpenOther?.();
        return;
      }
    }

    if (e.target.closest('.recent-clear-all')) {
      handlers.onClearAll?.();
      return;
    }

    if (e.target.closest('.recent-load-more')) {
      handlers.onLoadMore?.();
      return;
    }

    const card = e.target.closest('.recent-card');
    if (card) {
      const missing = card.classList.contains('recent-card-missing');
      handlers.onOpen?.({
        id: card.getAttribute('data-id'),
        path: card.getAttribute('data-path'),
        missing
      });
    }
  });

  container.addEventListener('keydown', (e) => {
    const card = e.target.closest('.recent-card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const missing = card.classList.contains('recent-card-missing');
      handlers.onOpen?.({
        id: card.getAttribute('data-id'),
        path: card.getAttribute('data-path'),
        missing
      });
    } else if (e.key === 'Delete') {
      e.preventDefault();
      handlers.onRemove?.(card.getAttribute('data-id'));
    } else if (e.key === 'P' && e.shiftKey) {
      e.preventDefault();
      handlers.onPin?.(card.getAttribute('data-id'));
    }
  });
}
