const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

test('historical lanes preserve source identity, status and time without touching current comment rows', async t => {
  const file = path.join(__dirname, '../../renderer/scripts/modules/previous-review-timeline.js');
  assert.ok(fs.existsSync(file), '실제 타임라인에 이전 리뷰를 렌더링하는 모듈이 필요하다');
  const { createPreviousReviewTimeline } = await import(pathToFileURL(file).href);
  const dom = new JSDOM('<body><div id="headers"><div id="currentHeader">댓글</div><div id="videoHeader">Video</div></div><div id="tracks"><div id="current"><b>현재 댓글</b></div><div id="video">영상</div></div></body>');
  const document = dom.window.document;
  const selected = [];
  const context = { fps: 24, duration: 12 };
  const lane = createPreviousReviewTimeline({ trackAnchor: document.getElementById('current'), headerAnchor: document.getElementById('currentHeader'), getContext: () => context, onSelect: key => selected.push(key), windowRef: dom.window });
  t.after(() => { lane.dispose(); dom.window.close(); });
  const source = (key, label, frame) => ({ key, sourcePath: `C:/shot_${label}.mp4`, sourceLabel: label, fps: 30, startFrame: frame, text: key });
  const entries = [
    { source: source('a', 'v3', 90), resolved: false },
    { source: source('b', 'v3', 90), resolved: true },
    { source: source('c', 'v2', 90), resolved: false },
    { source: source('outside', 'v3', 480), resolved: false },
    { source: source('unknown', 'v3', null), resolved: false }
  ];
  lane.render(entries);
  assert.equal(document.querySelectorAll('.pr-timeline-row').length, 2);
  assert.equal(document.querySelectorAll('.pr-timeline-header').length, 2);
  assert.equal(document.querySelectorAll('[data-pr-marker]').length, 3);
  const markers = [...document.querySelectorAll('[data-pr-marker]')];
  assert.equal(markers[0].dataset.prMarker, 'a');
  assert.equal(markers[0].style.left, '25%');
  assert.notEqual(markers[0].style.top, markers[1].style.top, 'overlapping reviews remain separately clickable');
  assert.equal(markers[1].classList.contains('resolved'), true);
  assert.match(document.querySelector('.pr-timeline-outside').textContent, /범위 밖 1/);
  assert.match(document.querySelector('.pr-timeline-outside').textContent, /시간 없음 1/);
  markers[1].click(); assert.deepEqual(selected, ['b']);
  assert.equal(document.getElementById('current').innerHTML, '<b>현재 댓글</b>');
  document.getElementById('current').replaceChildren();
  assert.equal(document.querySelectorAll('[data-pr-marker]').length, 3, 'native comment rerender cannot erase history');
  lane.render([]);
  assert.equal(document.querySelectorAll('.pr-timeline-row, .pr-timeline-header').length, 0);
  assert.ok(document.getElementById('video'));
});
