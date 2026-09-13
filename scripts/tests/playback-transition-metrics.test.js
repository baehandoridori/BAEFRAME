const { test } = require('node:test');
const assert = require('node:assert/strict');

test('timing preserves results and exceptions and emits one summary per transition', async () => {
  const { createTransitionMetrics } = await import('../../renderer/scripts/modules/playback-transition-metrics.js');
  let time = 0; const reports = [];
  const metrics = createTransitionMetrics({ now: () => time, emit: v => reports.push(v), id: 7 });
  assert.equal(await metrics.measure('reviewSave', async () => { time += 80; return true; }), true);
  const failure = new Error('test');
  await assert.rejects(metrics.measure('mpvLoad', async () => { time += 12; throw failure; }), error => error === failure);
  metrics.mark('firstPlayStart'); time += 4; metrics.mark('firstPlaySuccess');
  metrics.finish(); metrics.finish();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].stages.reviewSave, 80);
  assert.equal(reports[0].stages.mpvLoad, 12);
  assert.equal(reports[0].stages.total, 96);
  assert.equal(reports[0].id, 7);
  assert.equal(reports[0].marks.firstPlaySuccess - reports[0].marks.firstPlayStart, 4);
});

test('telemetry failures do not change media operation success', async () => {
  const { createTransitionMetrics } = await import('../../renderer/scripts/modules/playback-transition-metrics.js');
  const metrics = createTransitionMetrics({ now: () => 0, emit() { throw new Error('logger offline'); }, id: 8 });
  assert.equal(await metrics.measure('load', () => 42), 42);
  assert.doesNotThrow(() => metrics.finish());
});

test('playlist progress accepts a snapshot reader for items and totals without disk reads', async () => {
  global.window = { logPanel: null, appState: {}, electronAPI: { fileExists: async () => true, loadReview: () => { throw new Error('unexpected disk read'); } } };
  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager.currentPlaylist = { items: [{ id: 'a', videoPath: 'a.mp4', bframePath: 'a.bframe' }, { id: 'b', videoPath: 'b.mp4', bframePath: 'b.bframe' }] };
  const readReview = async () => ({ comments: { layers: [{ markers: [{ resolved: true }, { resolved: false }, { deleted: true }] }] } });
  assert.equal((await manager.getItemProgress('a.bframe', { readReview })).total, 2);
  assert.deepEqual(await manager.getTotalProgress({ readReview }), { total: 4, resolved: 2, percent: 50 });
});


test('native load timing surrounds the media operation, not thumbnail preparation', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
  assert.match(source, /mark\('mpvLoad:start'\);\s+const mpvLoaded = await loadVideoWithMpvPilot[\s\S]*?mark\('mpvLoad:end'\);/);
  const thumbnails = source.slice(source.indexOf('thumbnailVideoPath = await resolveMpvThumbnailVideoPath'));
  assert.doesNotMatch(thumbnails.slice(0, thumbnails.indexOf('shouldGenerateThumbnails =')), /mpvLoad/);
});
