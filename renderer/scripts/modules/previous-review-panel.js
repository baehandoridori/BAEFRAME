import { createPreviousReviewSources, isSafeReviewImage } from '../../../shared/review-carryover.js';
import { createCommentPanelPopout } from './comment-panel-popout.js';
import { previousReviewColor } from './previous-review-timeline.js';

const pathKey = value => String(value || '').replace(/\\/g, '/').toLowerCase();
const versionLabel = info => info.displayLabel || (info.version ? `v${info.version}` : info.fileName) || '이전 버전';
const isResolved = item => item.status === 'verified';
const secondsOf = source => source.startFrame === null || source.startFrame === undefined ? NaN : Number(source.startFrame) / Number(source.fps);
const compareSources = (a, b) => {
  const first = Number.isFinite(secondsOf(a)) ? secondsOf(a) : Infinity;
  const second = Number.isFinite(secondsOf(b)) ? secondsOf(b) : Infinity;
  return first - second || a.key.localeCompare(b.key);
};
const readableTime = seconds => {
  if (!Number.isFinite(seconds) || seconds < 0) return '시간 정보 없음';
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};

/** Historical references keep one state across the list, popout and timeline. */
export function createPreviousReviewPanel({
  mount, list, manager, getContext, getVersions, loadReview, seek, toggleButton = null,
  notify = () => {}, getActor = () => '', onOpenChange = () => {}, windowRef = window,
  matchesReview = () => true, onSummaryChange = () => {}, onTimelineChange = () => {}, onSelect = () => {}
}) {
  const document = windowRef.document;
  let contextPath = pathKey(getContext().path);
  let opened = false;
  let suspended = false;
  let disposed = false;
  let generation = 0;
  let menuOpen = false;
  let batching = false;
  let availabilityKey = '';
  let availabilityGeneration = 0;
  let hasPreviousReviews = false;
  let mode = 'split';
  let timelineVisible = true;
  let activeKey = null;
  let optionsDocument = null;
  const availableSources = new Map();
  const selected = new Map();
  const expandedReplies = new Set();

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, className = '') => {
    const node = el('button', `pr-button ${className}`, text);
    node.type = 'button';
    if (action) node.dataset.prAction = action;
    return node;
  };
  const root = el('section', 'previous-review-controls');
  root.setAttribute('aria-label', '이전 리뷰 확인');
  const toolbar = el('div', 'pr-toolbar');
  toolbar.dataset.prToolbar = '';
  toolbar.dataset.prOptions = '';
  toolbar.setAttribute('role', 'dialog');
  toolbar.setAttribute('aria-label', '이전 리뷰 옵션');
  const heading = el('div', 'pr-heading');
  heading.append(el('strong', '', '이전 리뷰 옵션'), button('닫기', 'close-options', 'pr-quiet'));
  const compact = el('div', 'pr-compact-bar');
  const brief = el('span', 'pr-brief');
  const versionsButton = button('옵션', 'versions', 'pr-options-button');
  versionsButton.setAttribute('aria-expanded', 'false');
  if (toggleButton) compact.append(toggleButton);
  else compact.append(el('span', 'pr-compact-label', '이전 리뷰'));
  compact.append(brief, versionsButton);
  const controls = el('div', 'pr-actions');
  const refreshButton = button('다시 읽기', 'refresh', 'pr-quiet');
  controls.append(refreshButton);
  const versionMenu = el('div', 'pr-version-menu');
  const modes = el('div', 'pr-view-modes');
  modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '리뷰 보기 방식');
  for (const [value, label] of [['split', '분리 보기'], ['merged', '합쳐 보기'], ['popup', '팝업 보기']]) {
    const choice = button(label); choice.dataset.prMode = value; modes.append(choice);
  }
  const timelineLabel = el('label', 'pr-timeline-option');
  const timelineInput = el('input'); timelineInput.type = 'checkbox'; timelineInput.checked = true;
  timelineInput.dataset.prTimeline = ''; timelineLabel.append(timelineInput, '타임라인에 이전 리뷰 표시');
  const carryButton = button('리뷰 이어받기', 'carry-all', 'pr-primary');
  controls.append(carryButton);
  const feedback = el('p', 'pr-feedback');
  feedback.setAttribute('role', 'status');
  toolbar.append(heading, el('p', 'pr-field-label', '가져올 버전'), versionMenu,
    el('p', 'pr-field-label', '리뷰 보기'), modes, timelineLabel,
    el('p', 'pr-hint', '원본의 미해결·해결 상태를 그대로 이어받습니다.'), controls, feedback);
  root.append(toolbar);
  mount.append(compact, root);
  const popupPanel = el('section', 'pr-history-popout');
  popupPanel.hidden = true;
  const popupHeading = el('div', 'pr-heading');
  popupHeading.append(el('strong', '', '이전 리뷰'), button('패널로 돌아가기', 'dock', 'pr-quiet'));
  const popupList = el('div', 'pr-popup-list');
  popupPanel.append(popupHeading, popupList); document.body.append(popupPanel);
  const popout = createCommentPanelPopout({ panel: popupPanel, windowRef,
    frameName: 'baeframe-previous-reviews', title: 'BAEFRAME 이전 리뷰', bodyClass: null,
    onChange: detached => {
      if (!detached && mode === 'popup') { mode = 'split'; render(); }
    },
    onError: error => { mode = 'split'; report(error.message); render(); }
  });

  const enabled = () => !suspended && !!getContext().path && getContext().enabled !== false;
  const editable = () => enabled() && manager.isEditable !== false;
  const allSources = () => [...selected.values()].flatMap(entry => entry.comments || []);
  const hasReviewContent = () => hasPreviousReviews || allSources().length > 0 || manager.getItems().length > 0;
  const otherVersions = () => getVersions().filter(info => info?.path && pathKey(info.path) !== contextPath);
  const reviewEntries = () => {
    const entries = new Map(allSources().map(source => [source.key, { source, item: null, resolved: source.resolved }]));
    for (const item of manager.getItems()) entries.set(item.id, { source: item.source, item, resolved: isResolved(item) });
    return [...entries.values()].sort((a, b) => compareSources(a.source, b.source));
  };
  const matches = entry => {
    const filter = getContext().filter;
    return (filter !== 'resolved' || entry.resolved) && (filter !== 'unresolved' || !entry.resolved)
      && matchesReview(entry.source, entry.resolved);
  };
  const sourceFor = key => manager.getItems().find(item => item.id === key)?.source
    || allSources().find(source => source.key === key);
  const report = message => { feedback.textContent = message; notify(message); };
  const mutate = callback => {
    if (!editable() || pathKey(getContext().path) !== contextPath) return;
    try { callback(); } catch (error) { report(error.message || '이어받은 리뷰를 변경하지 못했습니다.'); }
  };

  // A video sibling alone does not mean there is a review. Probe saved comments
  // once per version set; ordinary comment rerenders must not reread every file.
  async function refreshAvailability({ force = false } = {}) {
    if (!toggleButton || disposed || !enabled()) return;
    const versions = otherVersions();
    const key = JSON.stringify([contextPath, ...versions.map(info => pathKey(info.path)).sort()]);
    if (!force && key === availabilityKey) return;
    availabilityKey = key;
    availableSources.clear();
    const request = ++availabilityGeneration;
    const owner = contextPath;
    const isCurrent = () => !disposed && request === availabilityGeneration
      && contextPath === owner && pathKey(getContext().path) === owner;
    let found = false;
    await Promise.all(versions.map(async info => {
      try {
        const data = await loadReview(info.path.replace(/\.[^./\\]+$/, '.bframe'));
        if (!isCurrent()) return;
        const comments = createPreviousReviewSources(data, info);
        availableSources.set(pathKey(info.path), comments);
        if (!comments.length) return;
        found = true;
        if (!hasPreviousReviews) { hasPreviousReviews = true; render(); }
      } catch { /* Missing or unreadable files do not establish review availability. */ }
    }));
    if (!isCurrent()) return;
    hasPreviousReviews = found;
    if (!hasReviewContent()) opened = false;
    render();
  }

  function renderVersions() {
    versionMenu.replaceChildren();
    const versions = otherVersions();
    if (!versions.length) versionMenu.append(el('p', 'pr-empty', '같은 영상의 다른 버전이 없습니다. 상단 버전 메뉴에서 파일을 추가할 수 있습니다.'));
    for (const info of versions) {
      const key = pathKey(info.path);
      const entry = selected.get(key);
      const label = el('label', 'pr-version-option');
      const input = el('input'); input.type = 'checkbox'; input.dataset.prVersion = key;
      input.checked = !!entry;
      const description = el('span');
      description.append(el('strong', '', versionLabel(info)), el('small', '', info.fileName || info.path.split(/[\\/]/).pop()));
      const comments = entry?.comments || availableSources.get(key);
      const count = entry?.state === 'loading' ? '읽는 중…' : entry?.state === 'error' ? '읽기 실패' : comments ? `${comments.length}개 · 해결 ${comments.filter(source => source.resolved).length}` : '';
      label.title = info.path;
      label.append(input, description, el('span', 'pr-version-count', count));
      versionMenu.append(label);
    }
    versionMenu.append(button('선택 모두 해제', 'clear-versions', 'pr-quiet'));
  }

  async function readSource(info) {
    const key = pathKey(info.path);
    const owner = contextPath;
    const request = ++generation;
    const entry = { info, state: 'loading', comments: [], request };
    selected.set(key, entry);
    render();
    try {
      const data = await loadReview(info.path.replace(/\.[^./\\]+$/, '.bframe'));
      if (disposed || selected.get(key) !== entry || contextPath !== owner || pathKey(getContext().path) !== owner) return;
      if (data !== null && data !== undefined && (typeof data !== 'object' || Array.isArray(data) ||
          (data.comments !== null && data.comments !== undefined && !Array.isArray(data.comments) && !Array.isArray(data.comments.layers)))) {
        throw new Error('이전 리뷰의 댓글 형식을 읽을 수 없습니다.');
      }
      entry.comments = createPreviousReviewSources(data, info);
      entry.state = 'ready';
    } catch {
      if (disposed || selected.get(key) !== entry || contextPath !== owner || pathKey(getContext().path) !== owner) return;
      entry.state = 'error';
    }
    render();
  }

  function addImages(parent, images) {
    if (!Array.isArray(images)) return;
    const group = el('div', 'pr-images');
    for (const url of images) {
      // Never initiate network/file requests from untrusted review attachments.
      if (!isSafeReviewImage(url)) continue;
      const details = el('details', 'pr-image');
      details.append(el('summary', '', '첨부 이미지 보기'));
      const image = el('img'); image.src = url; image.alt = '이전 리뷰 첨부 이미지'; image.loading = 'lazy';
      details.append(image); group.append(details);
    }
    if (group.childElementCount) parent.append(group);
  }

  function makeSourceContent(source, queueItem = null) {
    const row = el('article', queueItem ? 'pr-review pr-carried' : 'pr-review pr-source');
    if (queueItem) row.dataset.prItem = queueItem.id;
    else row.dataset.prSource = source.key;
    row.style.setProperty('--pr-blue', previousReviewColor(source.sourceLabel));
    row.classList.toggle('pr-selected', source.key === activeKey);
    const meta = el('div', 'pr-source-meta');
    meta.append(el('span', 'pr-origin', source.sourceLabel), el('span', 'pr-author', source.author || '작성자 없음'));
    const time = button(readableTime(secondsOf(source)), null, 'pr-time');
    time.dataset.prSeek = source.key;
    const context = getContext();
    const valid = enabled() && Number.isFinite(secondsOf(source)) && secondsOf(source) >= 0
      && Number(context.duration) > 0 && secondsOf(source) < Number(context.duration);
    time.disabled = !valid;
    time.title = valid ? `현재 ${context.label || '영상'}의 같은 시간으로 이동` : '현재 영상 길이 밖이거나 시간 정보를 확인할 수 없습니다';
    time.setAttribute('aria-label', `현재 ${context.label || '영상'}의 ${readableTime(secondsOf(source))}로 이동`);
    meta.append(time);
    const resolved = queueItem ? isResolved(queueItem) : source.resolved;
    row.dataset.resolved = String(resolved);
    row.classList.toggle('resolved', resolved);
    row.tabIndex = 0;
    row.setAttribute('aria-disabled', String(!valid));
    row.setAttribute('aria-label', source.sourceLabel + ' ' + readableTime(secondsOf(source)) + ' ' + (source.text || '리뷰'));
    row.title = valid ? time.title : '현재 영상 길이 밖이거나 시간 정보를 확인할 수 없습니다';
    const state = queueItem ? button(resolved ? '✓ 해결' : '○ 미해결', null, 'pr-resolve')
      : el('span', 'pr-resolution', resolved ? '✓ 해결' : '○ 미해결');
    if (queueItem) {
      state.dataset.prResolve = queueItem.id;
      state.disabled = !editable();
      state.title = resolved ? '미해결로 변경' : '해결로 변경';
      state.setAttribute('aria-pressed', String(resolved));
    }
    meta.append(state);
    row.append(meta, el('p', 'pr-text', source.text || '(내용 없음)'));
    addImages(row, source.images);
    if (source.replies?.length) {
      const details = el('details', 'pr-replies');
      const expansionKey = source.key;
      details.open = expandedReplies.has(expansionKey);
      details.addEventListener('toggle', () => {
        if (details.open) expandedReplies.add(expansionKey); else expandedReplies.delete(expansionKey);
      });
      details.append(el('summary', '', `답글 ${source.replies.length}개`));
      for (const reply of source.replies) {
        const content = el('div', 'pr-reply');
        content.append(el('strong', '', reply.author || '작성자 없음'), el('p', 'pr-text', reply.text || ''));
        addImages(content, reply.images);
        details.append(content);
      }
      row.append(details);
    }
    const actions = el('div', 'pr-item-actions');
    if (queueItem) {
      actions.append(el('span', 'pr-carried-label', '이어받음'));
      const remove = button('이어받기 취소', null, 'pr-quiet');
      remove.dataset.prRemove = queueItem.id; remove.disabled = !editable();
      actions.append(remove);
    } else {
      const carry = button('이어받기', null, 'pr-carry');
      carry.dataset.prCarry = source.key; carry.disabled = !editable();
      actions.append(carry);
    }
    row.append(actions);
    return row;
  }

  function decorateList() {
    for (const node of list.querySelectorAll('[data-pr-source], [data-pr-item], [data-pr-list-section], .pr-current-badge')) node.remove();
    const show = opened && enabled();
    list.classList.toggle('pr-merged-list', show && mode === 'merged');
    const entries = show ? reviewEntries() : [];
    const visibleEntries = entries.filter(matches);
    const empty = list.querySelector('.comment-empty');
    if (empty) empty.hidden = visibleEntries.length > 0 && mode !== 'popup';
    onSummaryChange({ total: entries.length, resolved: entries.filter(entry => entry.resolved).length, visible: visibleEntries.length });
    onTimelineChange(show && timelineVisible ? visibleEntries : []);
    const popupScroll = popupList.scrollTop;
    popupList.replaceChildren();
    popupPanel.hidden = !show || mode !== 'popup';
    if (!show) { popout.dock(); return; }
    const currentFps = Number(getContext().fps) > 0 ? Number(getContext().fps) : 24;
    const native = [...list.querySelectorAll(':scope > .comment-item')];
    for (const item of native) item.querySelector('.comment-header, .comment-item-header')?.prepend(el('span', 'pr-current-badge', getContext().label || '현재'));
    let destination = list;
    if (mode === 'popup') destination = popupList;
    else if (mode === 'split') {
      const section = el('section', 'pr-separated-list'); section.dataset.prListSection = '';
      section.append(el('p', 'pr-section-heading', `이전 리뷰 · ${visibleEntries.length}개`));
      list.append(section); destination = section;
    }
    for (const { source, item } of visibleEntries) {
      const before = mode === 'merged' ? native.find(node => Number(node.dataset.startFrame) / currentFps > secondsOf(source)) : null;
      destination.insertBefore(makeSourceContent(source, item), before || null);
    }
    const notice = el('section', 'pr-merged-notice'); notice.dataset.prListSection = '';
    for (const entry of selected.values()) {
      if (entry.state !== 'ready') notice.append(el('p', entry.state === 'error' ? 'pr-error' : 'pr-hint', versionLabel(entry.info) + (entry.state === 'error' ? ' 리뷰를 읽을 수 없습니다. 다시 읽기를 눌러주세요.' : ' 읽는 중…')));
    }
    if (!entries.length) notice.append(el('p', 'pr-empty', '버전을 선택해 리뷰를 가져오세요.'));
    if (notice.childElementCount) destination.append(notice);
    popupList.scrollTop = popupScroll;
  }

  function positionOptions() {
    if (toolbar.hidden) return;
    const view = mount.ownerDocument.defaultView || windowRef;
    const rect = versionsButton.getBoundingClientRect();
    toolbar.style.maxHeight = `${Math.max(160, view.innerHeight - 24)}px`;
    toolbar.style.width = `${Math.min(320, view.innerWidth - 24)}px`;
    toolbar.style.left = `${Math.max(12, Math.min(rect.right - toolbar.offsetWidth, view.innerWidth - toolbar.offsetWidth - 12))}px`;
    toolbar.style.top = `${Math.max(12, Math.min(rect.bottom + 6, view.innerHeight - toolbar.offsetHeight - 12))}px`;
  }

  function closeOptions() {
    menuOpen = false; toolbar.hidden = true; versionsButton.setAttribute('aria-expanded', 'false');
    optionsDocument?.removeEventListener('pointerdown', outsideOptions);
    optionsDocument?.removeEventListener('keydown', optionsKeyDown);
    optionsDocument?.defaultView?.removeEventListener('resize', positionOptions);
    optionsDocument = null;
    root.append(toolbar);
  }
  function outsideOptions(event) {
    if (!toolbar.contains(event.target) && !versionsButton.contains(event.target)) closeOptions();
  }
  function optionsKeyDown(event) {
    if (event.key === 'Escape') { event.stopPropagation(); closeOptions(); versionsButton.focus(); }
  }
  function toggleOptions() {
    if (menuOpen) { closeOptions(); return; }
    // The comment panel's backdrop-filter establishes a containing block for
    // fixed elements. Portal to its owner document so viewport coordinates work.
    mount.ownerDocument.body.append(toolbar);
    menuOpen = true; render();
    optionsDocument = mount.ownerDocument;
    optionsDocument.addEventListener('pointerdown', outsideOptions);
    optionsDocument.addEventListener('keydown', optionsKeyDown);
    optionsDocument.defaultView?.addEventListener('resize', positionOptions);
  }
  async function setMode(value) {
    if (!['split', 'merged', 'popup'].includes(value)) return;
    closeOptions(); mode = value;
    if (value !== 'popup') popout.dock();
    render();
    if (value === 'popup') {
      const detached = await popout.detach();
      if (!detached && mode === 'popup') { mode = 'split'; render(); }
    }
  }

  function render() {
    if (disposed || batching) return;
    const visible = enabled() && (!toggleButton || hasReviewContent());
    if (toggleButton) {
      toggleButton.hidden = !visible;
      toggleButton.classList.toggle('active', opened && visible);
      toggleButton.setAttribute('aria-expanded', String(opened && visible));
      toggleButton.setAttribute('aria-pressed', String(opened && visible));
      const indicator = toggleButton.querySelector('[data-pr-toggle-state]');
      if (indicator) indicator.textContent = opened && visible ? '켜짐' : '꺼짐';
    }
    onOpenChange(opened && visible);
    if (!opened || !enabled()) closeOptions();
    toolbar.hidden = !menuOpen || !opened || !enabled();
    root.hidden = !visible || !opened;
    compact.hidden = !visible;
    mount.classList.toggle('pr-active', visible);
    const active = popupPanel.ownerDocument.activeElement?.dataset.prResolve ? popupPanel.ownerDocument.activeElement : mount.ownerDocument.activeElement;
    const focusedResolution = active?.dataset.prResolve;
    renderVersions();
    versionsButton.setAttribute('aria-expanded', String(menuOpen));
    versionsButton.disabled = !opened;
    const versions = [...new Set(reviewEntries().map(entry => entry.source.sourceLabel))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    brief.textContent = opened ? `${versions.join('·') || '버전 선택'} · ${reviewEntries().length}개` : '';
    brief.title = brief.textContent;
    for (const choice of modes.children) choice.setAttribute('aria-pressed', String(choice.dataset.prMode === mode));
    timelineInput.checked = timelineVisible;
    refreshButton.disabled = !selected.size;
    const remaining = allSources().filter(source => !manager.hasSource(source.key)).length;
    carryButton.textContent = `리뷰 ${remaining}개 이어받기`;
    carryButton.disabled = !remaining || !editable();
    if (manager.isEditable === false) feedback.textContent = '이어받은 리뷰의 저장 형식을 읽을 수 없어 편집할 수 없습니다.';
    decorateList();
    positionOptions();
    if (focusedResolution) [...list.querySelectorAll('[data-pr-resolve]'), ...popupList.querySelectorAll('[data-pr-resolve]')].find(node => node.dataset.prResolve === focusedResolution)?.focus({ preventScroll: true });
  }

  function seekSource(key) {
    const source = sourceFor(key);
    const context = getContext();
    if (!source || !opened || !enabled() || pathKey(context.path) !== contextPath || !(secondsOf(source) >= 0 && secondsOf(source) < Number(context.duration))) return;
    const fps = Number(context.fps) > 0 ? Number(context.fps) : 24;
    seek(Math.min(Math.round(secondsOf(source) * fps), Math.max(0, Math.ceil(context.duration * fps) - 1)));
    activeKey = key; onSelect(key);
    for (const row of [...list.querySelectorAll('.pr-review'), ...popupList.querySelectorAll('.pr-review')]) {
      const active = (row.dataset.prItem || row.dataset.prSource) === key;
      row.classList.toggle('pr-selected', active);
      if (active) row.scrollIntoView?.({ block: 'nearest' });
    }
    if (mode === 'popup') popout.focus();
  }

  function handleClick(event) {
    if (disposed) return;
    const target = event.target.closest?.('button');
    if (!target) {
      if (event.target.closest?.('a, input, select, textarea, summary, details, img, [contenteditable]')) return;
      const row = event.target.closest?.('[data-pr-item], [data-pr-source]');
      if (row) { event.stopPropagation(); seekSource(row.dataset.prItem || row.dataset.prSource); }
      return;
    }
    if (!(target.dataset.prAction || target.dataset.prMode || target.dataset.prCarry || target.dataset.prRemove || target.dataset.prSeek || target.dataset.prResolve)) return;
    event.stopPropagation();
    if (target.disabled || !opened || !enabled()) return;
    if (target.dataset.prMode) { void setMode(target.dataset.prMode); return; }
    if (target.dataset.prSeek) { seekSource(target.dataset.prSeek); return; }
    if (target.dataset.prResolve) {
      mutate(() => {
        const item = manager.getItems().find(item => item.id === target.dataset.prResolve);
        if (item) manager.setResolved(item.id, !isResolved(item), getActor());
      });
      return;
    }
    if (target.dataset.prCarry) {
      const source = sourceFor(target.dataset.prCarry);
      if (source) mutate(() => manager.carry(source, getActor()));
      return;
    }
    if (target.dataset.prRemove) { mutate(() => manager.remove(target.dataset.prRemove, getActor())); return; }
    switch (target.dataset.prAction) {
    case 'versions': toggleOptions(); break;
    case 'close-options': closeOptions(); versionsButton.focus(); break;
    case 'dock': void setMode('split'); break;
    case 'clear-versions': selected.clear(); feedback.textContent = ''; render(); break;
    case 'refresh': for (const entry of [...selected.values()]) void readSource(entry.info); break;
    case 'carry-all': mutate(() => {
      const sources = allSources().filter(source => !manager.hasSource(source.key));
      batching = true;
      try { for (const source of sources) manager.carry(source, getActor()); }
      finally { batching = false; render(); }
      feedback.textContent = `미해결 ${sources.filter(source => !source.resolved).length}개 · 해결 ${sources.filter(source => source.resolved).length}개를 이어받았습니다.`;
    }); break;
    case 'close': setOpen(false); break;
    default: break;
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.matches('[data-pr-timeline]')) { timelineVisible = target.checked; render(); return; }
    if (target.matches('[data-pr-version]')) {
      const key = target.dataset.prVersion;
      if (!target.checked) { selected.delete(key); render(); }
      else {
        const info = getVersions().find(info => pathKey(info.path) === key);
        if (info && key !== contextPath) void readSource(info);
      }
    }
  }

  function setOpen(value) {
    if (value === true && toggleButton && (!enabled() || !hasReviewContent())) return;
    opened = value === true;
    if (!opened) closeOptions();
    if (opened && !selected.size) {
      const latest = otherVersions().filter(info => availableSources.get(pathKey(info.path))?.length)
        .sort((a, b) => versionLabel(b).localeCompare(versionLabel(a), undefined, { numeric: true }))[0];
      if (latest) selected.set(pathKey(latest.path), { info: latest, state: 'ready', comments: availableSources.get(pathKey(latest.path)) });
    }
    render();
  }

  function refreshContext() {
    const nextPath = pathKey(getContext().path);
    if (nextPath !== contextPath) {
      selected.clear(); expandedReplies.clear(); availableSources.clear(); closeOptions(); activeKey = null;
      opened = false; hasPreviousReviews = false; availabilityKey = ''; availabilityGeneration++;
      feedback.textContent = ''; contextPath = nextPath;
    }
    suspended = false;
    render();
    void refreshAvailability();
  }

  const onManagerChange = () => render();
  const onKeyDown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!event.target.matches?.('[data-pr-item], [data-pr-source]')) return;
    event.preventDefault(); event.stopPropagation();
    seekSource(event.target.dataset.prItem || event.target.dataset.prSource);
  };
  list.addEventListener('keydown', onKeyDown);
  popupList.addEventListener('keydown', onKeyDown);
  const onToggleClick = event => { event.stopPropagation(); setOpen(!opened); };
  const onFocus = () => { void refreshAvailability({ force: true }); };
  toggleButton?.addEventListener('click', onToggleClick);
  if (toggleButton) windowRef.addEventListener('focus', onFocus);
  for (const node of [toolbar, compact, list, popupPanel]) {
    node.addEventListener('click', handleClick);
    node.addEventListener('change', handleChange);
  }
  manager.addEventListener('changed', onManagerChange);
  manager.addEventListener('loaded', onManagerChange);
  render();
  void refreshAvailability();
  return {
    setOpen, isOpen: () => opened, refreshContext, refreshAvailability, decorateList, seekSource,
    suspend() {
      availabilityGeneration++; availabilityKey = ''; hasPreviousReviews = false;
      suspended = true; selected.clear(); availableSources.clear(); render();
    },
    dispose() {
      closeOptions(); mode = 'split'; popout.dispose();
      disposed = true; selected.clear(); onTimelineChange([]);
      list.removeEventListener('keydown', onKeyDown);
      popupList.removeEventListener('keydown', onKeyDown);
      toggleButton?.removeEventListener('click', onToggleClick);
      windowRef.removeEventListener('focus', onFocus);
      manager.removeEventListener('changed', onManagerChange);
      manager.removeEventListener('loaded', onManagerChange);
      for (const node of [toolbar, compact, list, popupPanel]) {
        node.removeEventListener('click', handleClick);
        node.removeEventListener('change', handleChange);
      }
      for (const node of list.querySelectorAll('[data-pr-source], [data-pr-item], [data-pr-list-section], .pr-current-badge')) node.remove();
      root.remove(); compact.remove(); popupPanel.remove();
    }
  };
}
