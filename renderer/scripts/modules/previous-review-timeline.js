const palette = ['#90baff', '#c5a5ef', '#96c5bd'];
export function previousReviewColor(label) {
  const version = Number(String(label).match(/\d+/)?.[0]) || 3;
  return palette[((3 - version) % palette.length + palette.length) % palette.length];
}

/** Read-only source lanes live beside the current comment track, never inside it. */
export function createPreviousReviewTimeline({ trackAnchor, headerAnchor, getContext, onSelect, onLayoutChange = () => {}, windowRef = window }) {
  const document = windowRef.document;
  const nodes = [];
  let entries = [], selectedKey = null, lastWidth = 0, disposed = false;
  const seconds = source => source.startFrame === null || source.startFrame === undefined ? NaN : Number(source.startFrame) / Number(source.fps);
  const el = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function select(key) {
    selectedKey = key;
    for (const row of nodes) {
      for (const marker of row.querySelectorAll('[data-pr-marker]')) {
        marker.classList.toggle('pr-selected', marker.dataset.prMarker === key);
        marker.setAttribute('aria-pressed', String(marker.dataset.prMarker === key));
      }
    }
  }
  function render(nextEntries = entries) {
    if (disposed) return;
    entries = nextEntries;
    for (const node of nodes.splice(0)) node.remove();
    if (!trackAnchor?.parentNode || !headerAnchor?.parentNode) return;
    const duration = Number(getContext().duration);
    if (!(duration > 0)) { onLayoutChange(); return; }
    const groups = new Map();
    for (const entry of entries) {
      const key = String(entry.source.sourcePath).replace(/\\/g, '/').toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const width = trackAnchor.parentNode.getBoundingClientRect().width || 1000;
    let trackBefore = trackAnchor, headerBefore = headerAnchor;
    for (const group of [...groups.values()].sort((a, b) => b[0].source.sourceLabel.localeCompare(a[0].source.sourceLabel, undefined, { numeric: true }))) {
      const source = group[0].source;
      const row = el('div', 'pr-timeline-row');
      const header = el('div', 'pr-timeline-header');
      row.dataset.prVersionPath = source.sourcePath;
      header.title = `${source.sourceLabel} · ${source.sourcePath}`;
      header.append(el('span', 'pr-timeline-label', `↳ ${source.sourceLabel}`));
      for (const node of [row, header]) node.style.setProperty('--pr-blue', previousReviewColor(source.sourceLabel));
      let outside = 0, unknown = 0;
      const ends = [];
      for (const entry of group.slice().sort((a, b) => seconds(a.source) - seconds(b.source))) {
        const time = seconds(entry.source);
        if (!Number.isFinite(time) || time < 0) { unknown++; continue; }
        if (time >= duration) { outside++; continue; }
        const position = time / duration * width;
        let lane = ends.findIndex(end => end + 40 <= position);
        if (lane < 0) lane = ends.length;
        ends[lane] = position;
        const marker = el('button', `pr-timeline-marker${entry.resolved ? ' resolved' : ''}`);
        marker.type = 'button'; marker.dataset.prMarker = entry.source.key;
        marker.style.left = `${time / duration * 100}%`; marker.style.top = `${lane * 32}px`;
        const label = `${source.sourceLabel} · ${Math.floor(time / 60).toString().padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')} · ${entry.resolved ? '해결' : '미해결'} · ${entry.source.text || '리뷰'}`;
        marker.title = label; marker.setAttribute('aria-label', label);
        marker.append(el('span', 'pr-timeline-pin', entry.resolved ? '✓' : ''));
        marker.addEventListener('click', event => { event.stopPropagation(); select(entry.source.key); onSelect(entry.source.key); });
        row.append(marker);
      }
      if (outside || unknown) {
        const note = el('span', 'pr-timeline-outside', [outside && `범위 밖 ${outside}`, unknown && `시간 없음 ${unknown}`].filter(Boolean).join(' · '));
        note.title = '타임라인에 배치할 수 없는 리뷰입니다. 댓글 목록에서 원문을 확인하세요.';
        header.append(note);
      }
      const height = Math.max(outside || unknown ? 44 : 32, ends.length * 32);
      for (const node of [row, header]) node.style.height = `${height}px`;
      row.addEventListener('pointerdown', event => event.stopPropagation());
      row.addEventListener('dblclick', event => event.stopPropagation());
      trackBefore.after(row); headerBefore.after(header);
      trackBefore = row; headerBefore = header; nodes.push(row, header);
    }
    select(selectedKey); onLayoutChange();
  }
  const observer = windowRef.ResizeObserver && trackAnchor?.parentNode ? new windowRef.ResizeObserver(records => {
    const width = records[0]?.contentRect.width;
    if (width && width !== lastWidth) { lastWidth = width; render(); }
  }) : null;
  observer?.observe(trackAnchor.parentNode);
  return { render, select, dispose() { render([]); disposed = true; observer?.disconnect(); } };
}
