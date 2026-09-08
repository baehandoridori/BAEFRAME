import { ReviewCarryoverManager } from '/renderer/scripts/modules/review-carryover-manager.js';
import { createPreviousReviewSources } from '/shared/review-carryover.js';

const $ = id => document.getElementById(id);
const colors = { v4: '#ffd400', v3: '#90baff', v2: '#c5a5ef', v1: '#96c5bd' };
const manager = new ReviewCarryoverManager();
const data = {
  v3: [{ id: 'eye', text: '눈 깜빡임을 고개 드는 타이밍에 맞춰 조금 앞당겨 주세요.', author: '전혜림', startFrame: 90, resolved: false }, { id: 'hand', text: '오른손이 문 안으로 들어가는 부분을 확인해 주세요.', author: '시연 감독', startFrame: 156, resolved: false }, { id: 'tone', text: '배경 톤을 한 단계 낮춰 주세요.', author: '배한솔', startFrame: 225, resolved: true }, { id: 'end', text: '엔딩 표정이 너무 빨리 바뀝니다.', author: '전혜림', startFrame: 480, resolved: false }],
  v2: [{ id: 'face', text: '고개가 돌아가는 방향을 조금 더 분명하게 해주세요.', author: '전혜림', startFrame: 45, resolved: true }, { id: 'hand', text: '손 동작 시작을 조금 늦춰주세요.', author: '시연 감독', startFrame: 156, resolved: false }, { id: 'shadow', text: '발 아래 그림자 밝기를 낮춰주세요.', author: '배한솔', startFrame: 258, resolved: true }],
  v1: [{ id: 'start', text: '시작 포즈를 더 자연스럽게 바꿔주세요.', author: '시연 감독', startFrame: 30, resolved: true }, { id: 'end', text: '마지막 표정에 여유가 있으면 좋겠습니다.', author: '전혜림', startFrame: 300, resolved: false }]
};
const sources = Object.fromEntries(Object.entries(data).map(([version, markers]) => [version,
  createPreviousReviewSources({ fps: 30, comments: { layers: [{ markers }] } }, { path: `C:/options-demo/shot_${version}.mp4`, displayLabel: version })]));
const current = [{ key: 'now-eye', version: 'v4', time: 3, author: '시연 작업자', text: '눈 깜빡임과 손 위치를 수정했습니다. 이전 의견과 비교해 주세요.', resolved: false }, { key: 'now-last', version: 'v4', time: 9, author: '전혜림', text: '마지막 표정은 지금 버전이 좋습니다.', resolved: true }];
let selected = new Set(['v3']), enabled = true, mode = 'split', filter = 'all', showTimeline = true, position = 0, activeKey = null, playing = false, lastTick = 0;
const element = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const button = (text, action, cls = '') => { const node = element('button', cls, text); node.type = 'button'; node.onclick = event => { event.stopPropagation(); action(); }; return node; };
const timecode = time => { const frames = Math.round(time * 24); return `00:${String(Math.floor(frames / 1440)).padStart(2, '0')}:${String(Math.floor(frames / 24) % 60).padStart(2, '0')}:${String(frames % 24).padStart(2, '0')}`; };
const say = message => { $('notice').textContent = message; };
function entries() {
  if (!enabled) return [];
  const merged = new Map([...selected].flatMap(version => sources[version]).map(source => [source.key, { source, item: null }]));
  for (const item of manager.getItems()) merged.set(item.id, { source: item.source, item });
  return [...merged.values()].map(({ source, item }) => ({ key: source.key, version: source.sourceLabel, time: source.startFrame / source.fps, author: source.author, text: source.text, resolved: item ? item.status === 'verified' : source.resolved, source, item })).sort((a, b) => a.time - b.time);
}
const matches = row => filter === 'all' || (filter === 'resolved' ? row.resolved : !row.resolved);
function seek(row) {
  if (row.time >= 12) { say(`${row.version} ${timecode(row.time)} · 현재 영상 길이(12초) 밖에 있어 이동할 수 없습니다.`); return; }
  position = row.time; activeKey = row.key; render();
  $('sceneNote').textContent = `${row.version} · ${timecode(position)} · ${row.text}`;
  const card = [...document.querySelectorAll('[data-review-key]')].find(node => node.dataset.reviewKey === row.key);
  card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  say(`${row.version} 리뷰 → 현재 v4의 ${timecode(position)}로 이동`);
}
function makeCard(row) {
  const card = element('article', `review-card ${row.source ? 'history-card' : ''} ${row.resolved ? 'resolved' : ''} ${activeKey === row.key ? 'selected' : ''}`);
  card.dataset.reviewKey = row.key; card.tabIndex = 0; card.style.setProperty('--review-color', colors[row.version]);
  card.onclick = () => seek(row);
  card.onkeydown = event => { if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); seek(row); } };
  const meta = element('div', 'card-meta'); meta.append(element('span', 'badge', row.version), element('span', 'tc', timecode(row.time)), element('span', '', row.author), element('span', `state ${row.resolved ? 'resolved' : ''}`, row.resolved ? '✓ 해결' : '○ 미해결'));
  card.append(meta, element('p', '', row.text));
  if (row.source) {
    const actions = element('div', 'card-actions');
    actions.append(element('span', '', row.item ? '이어받음' : row.time >= 12 ? '현재 영상 범위 밖' : '원본 리뷰'));
    actions.append(row.item ? button(row.resolved ? '미해결로 변경' : '해결로 변경', () => manager.setResolved(row.key, !row.resolved, '시연 사용자'), 'quiet') : button('이어받기', () => { manager.carry(row.source, '시연 사용자'); say(`${row.version} 리뷰를 ${row.resolved ? '해결' : '미해결'} 상태로 이어받았습니다.`); }));
    card.append(actions);
  }
  return card;
}
function section(parent, title, rows, divider = false) {
  const heading = element('div', `section-title ${divider ? 'divider' : ''}`); heading.append(element('span', '', title), element('span', '', `${rows.length}개`)); parent.append(heading);
  rows.forEach(row => parent.append(makeCard(row)));
  if (!rows.length) parent.append(element('p', 'empty', '표시할 리뷰가 없습니다.'));
}
function renderCards(old) {
  $('mainCards').replaceChildren(); $('floatCards').replaceChildren();
  const now = current.filter(matches), visible = old.filter(matches);
  $('floating').hidden = !enabled || mode !== 'popup';
  if (!enabled) section($('mainCards'), '현재 댓글', now);
  else if (mode === 'merged') [...now, ...visible].sort((a, b) => a.time - b.time).forEach(row => $('mainCards').append(makeCard(row)));
  else { section($('mainCards'), '현재 댓글', now); if (mode === 'split') section($('mainCards'), '이전 리뷰', visible, true); else { section($('floatCards'), '이전 리뷰', visible); $('mainCards').append(element('p', 'empty', '이전 리뷰는 팝업에 표시 중입니다.')); } }
  $('floatVersion').textContent = [...new Set(old.map(row => row.version))].sort().reverse().join(' · ');
}
function renderTimeline(old) {
  $('tracks').replaceChildren();
  const versions = ['v4', ...(enabled && showTimeline ? [...new Set(old.map(row => row.version))].sort().reverse() : [])];
  for (const version of versions) {
    const track = element('div', `track ${version === 'v4' ? 'current' : 'history'}`); track.dataset.version = version; track.style.setProperty('--lane-color', colors[version]);
    track.append(element('div', 'lane-label', version === 'v4' ? '댓글 · v4' : `↳ ${version}`));
    const lane = element('div', 'lane');
    const rows = (version === 'v4' ? current : old.filter(row => row.version === version)).filter(matches);
    for (const row of rows.filter(row => row.time < 12)) {
      const marker = button('', () => seek(row), `timeline-marker ${row.resolved ? 'resolved' : ''} ${activeKey === row.key ? 'selected' : ''}`);
      marker.style.left = `${row.time / 12 * 100}%`; marker.dataset.markerKey = row.key;
      marker.setAttribute('aria-label', `${version} ${timecode(row.time)} ${row.resolved ? '해결' : '미해결'} ${row.text}`);
      marker.append(element('span', 'pin', row.resolved ? '✓' : ''));
      marker.append(element('span', 'tip', `${version} · ${timecode(row.time)} · ${row.resolved ? '해결' : '미해결'}\n${row.text}`));
      lane.append(marker);
    }
    const outside = rows.filter(row => row.time >= 12);
    if (outside.length) lane.append(button(`범위 밖 ${outside.length}`, () => seek(outside[0]), 'outside'));
    const cursor = element('span', 'cursor'); cursor.style.left = `${position / 12 * 100}%`; lane.append(cursor); track.append(lane); $('tracks').append(track);
  }
}
function render() {
  const old = entries(); renderCards(old); renderTimeline(old);
  $('reviewToggle').setAttribute('aria-pressed', String(enabled));
  $('brief').textContent = enabled ? `${[...new Set(old.map(row => row.version))].sort().reverse().join('·') || '선택 없음'} · ${old.length}개` : '꺼짐';
  const all = [...current, ...old]; $('count').textContent = `${all.filter(row => !row.resolved).length} 미해결 / ${all.length}개`;
  document.querySelectorAll('[data-filter]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.filter === filter)));
  document.querySelectorAll('[data-mode]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.mode === mode)));
  document.querySelectorAll('input[data-version]').forEach(node => { node.checked = selected.has(node.dataset.version); });
  const remaining = [...selected].flatMap(version => sources[version]).filter(source => !manager.hasSource(source.key));
  $('carryAll').textContent = `선택한 리뷰 ${remaining.length}개 이어받기`; $('carryAll').disabled = !remaining.length;
  $('carrySummary').textContent = `미해결 ${remaining.filter(source => !source.resolved).length}개 · 해결 ${remaining.filter(source => source.resolved).length}개 그대로 유지`;
  renderPosition();
}
function renderPosition() { $('timecode').textContent = timecode(position); $('frame').textContent = `24fps · ${Math.round(position * 24)}f`; document.querySelectorAll('.cursor').forEach(node => { node.style.left = `${position / 12 * 100}%`; }); $('eyes').style.opacity = position > 2.85 && position < 3.25 ? '.15' : '1'; }
function setOptions(open) { $('options').hidden = !open; $('optionsButton').setAttribute('aria-expanded', String(open)); if (open) { const rect = $('optionsButton').getBoundingClientRect(); $('options').style.top = `${Math.min(rect.bottom + 7, Math.max(12, window.innerHeight - 430))}px`; $('closeOptions').focus(); } else $('optionsButton').focus(); }
for (const version of ['v3', 'v2', 'v1']) { const label = element('label', 'version-choice'); const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.version = version; input.onchange = () => { if (input.checked) selected.add(version); else selected.delete(version); render(); }; label.append(input, element('span', '', version), element('small', '', `${sources[version].length}개 · 해결 ${sources[version].filter(source => source.resolved).length}`)); $('versionChoices').append(label); }
$('reviewToggle').onclick = () => { enabled = !enabled; if (!enabled) setOptions(false); render(); };
$('optionsButton').onclick = () => setOptions($('options').hidden); $('closeOptions').onclick = () => setOptions(false);
$('timelineVisible').onchange = event => { showTimeline = event.target.checked; render(); };
document.querySelectorAll('[data-mode]').forEach(node => { node.onclick = () => { mode = node.dataset.mode; render(); setOptions(false); }; });
document.querySelectorAll('[data-filter]').forEach(node => { node.onclick = () => { filter = node.dataset.filter; render(); }; });
$('carryAll').onclick = () => { const remaining = [...selected].flatMap(version => sources[version]).filter(source => !manager.hasSource(source.key)); for (const source of remaining) manager.carry(source, '시연 사용자'); say(`미해결 ${remaining.filter(source => !source.resolved).length}개 · 해결 ${remaining.filter(source => source.resolved).length}개를 그대로 이어받았습니다.`); setOptions(false); };
$('dock').onclick = () => { mode = 'split'; render(); };
$('reset').onclick = () => { selected = new Set(['v3']); enabled = true; showTimeline = true; mode = 'split'; filter = 'all'; position = 0; activeKey = null; playing = false; $('play').textContent = '▶'; $('timelineVisible').checked = true; $('sceneNote').textContent = '타임라인의 v3 표시를 눌러보세요.'; $('floating').removeAttribute('style'); manager.reset(); render(); say('시연 데이터를 초기화했습니다.'); };
manager.addEventListener('changed', render); manager.addEventListener('loaded', render);
document.addEventListener('pointerdown', event => { if (!$('options').hidden && !$('options').contains(event.target) && !$('optionsButton').contains(event.target)) setOptions(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('options').hidden) setOptions(false); else if (mode === 'popup') { mode = 'split'; render(); } } });
$('floatHandle').onpointerdown = event => { if (event.target.closest('button')) return; const rect = $('floating').getBoundingClientRect(); const dx = event.clientX - rect.left, dy = event.clientY - rect.top; $('floatHandle').setPointerCapture(event.pointerId); $('floatHandle').onpointermove = move => { $('floating').style.left = `${Math.max(0, Math.min(window.innerWidth - $('floating').offsetWidth, move.clientX - dx))}px`; $('floating').style.top = `${Math.max(0, Math.min(window.innerHeight - 60, move.clientY - dy))}px`; }; $('floatHandle').onpointerup = () => { $('floatHandle').onpointermove = null; }; };
$('play').onclick = () => { playing = !playing; lastTick = 0; $('play').textContent = playing ? 'Ⅱ' : '▶'; if (playing) requestAnimationFrame(tick); };
function tick(now) { if (!playing) return; if (lastTick) position = (position + (now - lastTick) / 1000) % 12; lastTick = now; renderPosition(); requestAnimationFrame(tick); }
render();
