const { test } = require('node:test');
const assert = require('node:assert/strict');

test('a delayed first review save belongs to video 1 after video 2 is selected', async () => {
  const fs = require('node:fs'); const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
  const start = source.indexOf("    reviewDataManager.addEventListener('saved', async (e) => {", source.indexOf('// 리뷰 데이터 저장 시 재생목록 진행률 업데이트'));
  const end = source.indexOf('\n    });', start) + '\n    });'.length;
  global.window = { electronAPI: { fileExists: async () => false } };
  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const playlistManager = new PlaylistManager();
  playlistManager.createNew('anonymous regression fixture');
  const items = [1, 2, 3].map(id => ({ id: String(id), videoPath: `C:/fixture/${id}.mp4`, bframePath: '' }));
  playlistManager.currentPlaylist.items = items;
  playlistManager.currentIndex = 1;
  let listener;
  const refreshed = [];
  const context = vm.createContext({
    playlistManager,
    reviewDataManager: { addEventListener: (_type, callback) => { listener = callback; } },
    retireDeletedCommentResolutionFailures() {},
    isSameFilePath: (a, b) => !!a && !!b && a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase(),
    refreshVisiblePlaylistProgress: async () => {},
    refreshPlaylistCommentsForItem: async id => { refreshed.push(id); }
  });
  vm.runInContext(source.slice(start, end), context);
  await listener({ detail: { path: 'C:/fixture/1.bframe', videoPath: 'c:\\fixture\\1.mp4' } });
  assert.equal(items[1].bframePath, '', 'video 2 must never acquire video 1 review');
  assert.equal(items[0].bframePath, 'C:/fixture/1.bframe');
  assert.equal(items[2].bframePath, '');
  assert.deepEqual(refreshed, ['1']);
  const readReview = async path => ({ comments: { layers: [{ markers: path === 'C:/fixture/1.bframe' ? [{ id: 'one', resolved: false }] : [] }] } });
  assert.deepEqual(await Promise.all(items.map(async item => (await playlistManager.getItemProgress(item, { readReview })).total)), [1, 0, 0]);
  // A late event for a video outside the playlist cannot attach to its selection.
  await listener({ detail: { path: 'C:/fixture/other.bframe', videoPath: 'C:/fixture/other.mp4' } });
  assert.equal(items[1].bframePath, '');
  // Legacy path-only events may refresh an existing association, never invent one.
  await listener({ detail: { path: 'C:/fixture/1.bframe' } });
  assert.deepEqual(refreshed, ['1', '1']);
  await listener({ detail: { path: 'C:/fixture/unowned.bframe' } });
  assert.equal(items[1].bframePath, '');
  items[0].bframePath = 'C:/fixture/explicit-review.bframe';
  await listener({ detail: { path: 'C:/fixture/1.bframe', videoPath: items[0].videoPath } });
  assert.equal(items[0].bframePath, 'C:/fixture/explicit-review.bframe', 'preserve an explicit review association');
  const beforeReplacement = refreshed.length;
  context.refreshVisiblePlaylistProgress = async () => { playlistManager.createNew('replacement'); };
  await listener({ detail: { path: 'C:/fixture/1.bframe', videoPath: items[0].videoPath } });
  assert.equal(refreshed.length, beforeReplacement, 'do not refresh old item IDs in a replacement playlist');
});

test('cache deduplicates normalized paths and retains only comment snapshots', async () => {
  const { createPlaylistCommentCache } = await import('../../renderer/scripts/modules/playlist-comment-cache.js');
  let calls = 0;
  const cache = createPlaylistCommentCache({ normalizePath: p => p.toLowerCase(), read: async () => ({ fps: 24, comments: { sequence: ++calls }, drawingsV3: { large: true } }) });
  const [a, b] = await Promise.all([cache.read('A'), cache.read('a')]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.drawingsV3, undefined);
  cache.invalidate('a');
  assert.equal((await cache.read('A')).comments.sequence, 2);
});

test('invalidated in-flight read cannot overwrite a newer snapshot; failures retry', async () => {
  const { createPlaylistCommentCache } = await import('../../renderer/scripts/modules/playlist-comment-cache.js');
  let release;
  let calls = 0;
  const cache = createPlaylistCommentCache({ normalizePath: p => p, read: async () => {
    calls++;
    if (calls === 1) return new Promise(r => { release = r; });
    if (calls === 3) throw new Error('offline');
    return { comments: { revision: calls } };
  } });
  const old = cache.read('a');
  await Promise.resolve();
  cache.invalidate('a');
  assert.equal((await cache.read('a')).comments.revision, 2);
  release({ comments: { revision: 1 } });
  await old;
  assert.equal((await cache.read('a')).comments.revision, 2);
  cache.clear();
  await assert.rejects(cache.read('a'), /offline/);
  assert.equal((await cache.read('a')).comments.revision, 4);
});

test('cache limits retained paths to 200 using least recently used order', async () => {
  const { createPlaylistCommentCache } = await import('../../renderer/scripts/modules/playlist-comment-cache.js');
  let calls = 0;
  const cache = createPlaylistCommentCache({ normalizePath: p => p, read: async () => ({ comments: { revision: ++calls } }) });
  for (let i = 0; i < 201; i++) await cache.read(String(i));
  await cache.read('200');
  assert.equal(calls, 201);
  await cache.read('0');
  assert.equal(calls, 202);
});


test('app cache uses file metadata to avoid rereading unchanged review bodies', async () => {
  const { createPlaylistCommentCache } = await import('../../renderer/scripts/modules/playlist-comment-cache.js');
  const fs = require('node:fs'); const vm = require('node:vm'); const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/app.js'), 'utf8');
  const start = source.indexOf('  const playlistCommentCache = createPlaylistCommentCache(');
  const end = source.indexOf('  const playlistResolutionQueue', start);
  let clock = 1000; let reads = 0; let stats = 0; let modified = 1000;
  const context = vm.createContext({
    createPlaylistCommentCache: options => createPlaylistCommentCache({ ...options, now: () => clock }),
    normalizeComparableFilePath: p => p,
    window: { electronAPI: {
      loadReview: async () => ({ comments: { revision: ++reads } }),
      getFileInfo: async () => { stats++; return { size: 100, mtime: new Date(modified).toISOString() }; }
    } }
  });
  vm.runInContext(source.slice(start, end).replace('const playlistCommentCache', 'globalThis.cache'), context);
  await context.cache.read('A.bframe'); clock = 6000;
  assert.equal(context.cache.isFresh('A.bframe'), true);
  clock = 62000; assert.equal((await context.cache.revalidate('A.bframe')).changed, false);
  assert.equal(reads, 1); assert.equal(stats, 2);
  modified = 2000; clock = 123000;
  assert.equal((await context.cache.revalidate('A.bframe')).changed, true);
  assert.equal(reads, 2);
});
