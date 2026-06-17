const { test } = require('node:test');
const assert = require('node:assert/strict');

let mod;

test('모듈 로드', async () => {
  mod = await import('../../renderer/scripts/modules/playlist-ordering.js');
});

test('파일명 자연 정렬: 1, 2, 10 순서를 유지한다', () => {
  const items = [
    { id: '10', fileName: 'shot10.mp4', order: 0, addedAt: '2026-05-08T00:00:00.000Z' },
    { id: '2', fileName: 'shot2.mp4', order: 1, addedAt: '2026-05-08T00:00:01.000Z' },
    { id: '1', fileName: 'shot1.mp4', order: 2, addedAt: '2026-05-08T00:00:02.000Z' }
  ];

  const sorted = mod.sortPlaylistItems(items, mod.PLAYLIST_SORT_MODES.FILE_NAME);

  assert.deepEqual(sorted.map(item => item.fileName), ['shot1.mp4', 'shot2.mp4', 'shot10.mp4']);
  assert.deepEqual(items.map(item => item.fileName), ['shot10.mp4', 'shot2.mp4', 'shot1.mp4']);
});

test('추가한 순서 정렬: addedAt 기준으로 안정 정렬한다', () => {
  const items = [
    { id: 'b', fileName: 'b.mp4', order: 2, addedAt: '2026-05-08T00:00:02.000Z' },
    { id: 'a', fileName: 'a.mp4', order: 1, addedAt: '2026-05-08T00:00:01.000Z' },
    { id: 'c', fileName: 'c.mp4', order: 3, addedAt: '2026-05-08T00:00:03.000Z' }
  ];

  const sorted = mod.sortPlaylistItems(items, mod.PLAYLIST_SORT_MODES.ADDED_AT);

  assert.deepEqual(sorted.map(item => item.id), ['a', 'b', 'c']);
});

test('추가한 순서 정렬: addedAt이 같으면 입력 순서를 유지한다', () => {
  const items = [
    { id: 'first', fileName: 'z.mp4', order: 0, addedAt: '2026-05-08T00:00:01.000Z' },
    { id: 'second', fileName: 'a.mp4', order: 1, addedAt: '2026-05-08T00:00:01.000Z' },
    { id: 'third', fileName: 'm.mp4', order: 2, addedAt: '2026-05-08T00:00:01.000Z' }
  ];

  const sorted = mod.sortPlaylistItems(items, mod.PLAYLIST_SORT_MODES.ADDED_AT);

  assert.deepEqual(sorted.map(item => item.id), ['first', 'second', 'third']);
});

test('수동 순서가 있으면 새 항목만 파일명순으로 뒤에 붙인다', () => {
  const existing = [
    { id: 'manual-2', fileName: 'shot2.mp4', order: 0 },
    { id: 'manual-1', fileName: 'shot1.mp4', order: 1 }
  ];
  const incoming = [
    { id: 'new-10', fileName: 'shot10.mp4', order: 0 },
    { id: 'new-3', fileName: 'shot3.mp4', order: 0 }
  ];

  const merged = mod.appendSortedNewItems(existing, incoming);

  assert.deepEqual(merged.map(item => item.id), ['manual-2', 'manual-1', 'new-3', 'new-10']);
  assert.deepEqual(merged.map(item => item.order), [0, 1, 2, 3]);
});

test('기존 재생목록 설정은 파일 저장용 설정만 보정한다', () => {
  const playlist = {
    settings: {
      autoPlay: true,
      floatingMode: false
    }
  };

  const settings = mod.normalizePlaylistSettings(playlist);

  assert.equal(Object.hasOwn(settings, 'autoPlay'), false);
  assert.equal(settings.floatingMode, false);
  assert.equal(settings.continuous.loop, false);
  assert.equal(settings.continuous.sortMode, mod.PLAYLIST_SORT_MODES.FILE_NAME);
  assert.equal(settings.continuous.manualOrder, false);
});

test('PlaylistManager.addItems는 기본 파일명순으로 새 항목을 추가한다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('정렬 테스트');

  await manager.addItems([
    'C:\\video\\shot10.mp4',
    'C:\\video\\shot2.mp4',
    'C:\\video\\shot1.mp4'
  ]);

  assert.deepEqual(manager.getItems().map(item => item.fileName), [
    'shot1.mp4',
    'shot2.mp4',
    'shot10.mp4'
  ]);
});

test('PlaylistManager는 수동 순서 뒤에 새 항목만 정렬해서 붙인다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('수동 정렬 테스트');

  await manager.addItems([
    'C:\\video\\shot1.mp4',
    'C:\\video\\shot2.mp4'
  ]);
  manager.reorderItem(1, 0);
  await manager.addItems([
    'C:\\video\\shot10.mp4',
    'C:\\video\\shot3.mp4'
  ]);

  assert.deepEqual(manager.getItems().map(item => item.fileName), [
    'shot2.mp4',
    'shot1.mp4',
    'shot3.mp4',
    'shot10.mp4'
  ]);
  assert.equal(manager.getContinuousSettings().manualOrder, true);
});

test('PlaylistManager.addItems는 정렬 후에도 선택된 항목을 유지한다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('선택 유지 테스트');

  await manager.addItems(['C:\\video\\shot2.mp4']);
  const selectedId = manager.getCurrentItem().id;

  await manager.addItems(['C:\\video\\shot1.mp4']);

  assert.equal(manager.getCurrentItem().id, selectedId);
  assert.equal(manager.getCurrentItem().fileName, 'shot2.mp4');
  assert.equal(manager.currentIndex, 1);
});

test('PlaylistManager.setSortMode는 정렬 후에도 선택된 항목을 유지한다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('정렬 기준 변경 선택 유지 테스트');

  await manager.addItems([
    'C:\\video\\shot1.mp4',
    'C:\\video\\shot2.mp4'
  ]);
  manager.selectItem(1);
  const selectedId = manager.getCurrentItem().id;
  manager.getItems()[0].addedAt = '2026-05-08T00:00:02.000Z';
  manager.getItems()[1].addedAt = '2026-05-08T00:00:01.000Z';

  manager.setSortMode(mod.PLAYLIST_SORT_MODES.ADDED_AT);

  assert.equal(manager.getCurrentItem().id, selectedId);
  assert.equal(manager.getCurrentItem().fileName, 'shot2.mp4');
  assert.equal(manager.currentIndex, 0);
});

test('PlaylistManager.addItems는 같은 호출 안의 중복 경로를 제외한다', async () => {
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: { fileExists: async () => false }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager._tryGenerateThumbnail = async () => '';
  manager.createNew('중복 추가 테스트');

  const addedItems = await manager.addItems([
    'C:\\video\\shot1.mp4',
    'C:\\video\\shot1.mp4'
  ]);

  assert.equal(addedItems.length, 1);
  assert.deepEqual(manager.getItems().map(item => item.fileName), ['shot1.mp4']);
});

test('PlaylistManager.open은 비어 있는 bframePath를 영상 옆 .bframe으로 복구해 저장한다', async () => {
  const savedPlaylists = [];
  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: {
      readPlaylist: async () => ({
        playlistVersion: '1.0',
        id: 'playlist-old',
        name: '오래된 재생목록',
        items: [
          {
            id: 'item-1',
            videoPath: 'C:\\video\\shot1.mp4',
            bframePath: '',
            fileName: 'shot1.mp4',
            thumbnailPath: 'data:image/png;base64,stub',
            order: 0,
            addedAt: '2026-06-06T00:00:00.000Z'
          }
        ],
        settings: {
          floatingMode: false,
          continuous: {
            loop: false,
            sortMode: 'fileName',
            manualOrder: false
          }
        }
      }),
      fileExists: async filePath => filePath === 'C:\\video\\shot1.bframe',
      writePlaylist: async (targetPath, playlist) => {
        savedPlaylists.push({ targetPath, playlist: JSON.parse(JSON.stringify(playlist)) });
      }
    }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();

  await manager.open('C:\\video\\old.bplaylist');

  assert.equal(manager.getItems()[0].bframePath, 'C:\\video\\shot1.bframe');
  assert.equal(savedPlaylists.length, 1);
  assert.equal(savedPlaylists[0].targetPath, 'C:\\video\\old.bplaylist');
  assert.equal(savedPlaylists[0].playlist.items[0].bframePath, 'C:\\video\\shot1.bframe');
  assert.equal(manager.isModified, false);
});

test('PlaylistManager.open은 로드 콜백에 오래된 열기 작업을 구분하는 context를 넘긴다', async () => {
  const makePlaylist = (name, videoPath) => ({
    playlistVersion: '1.0',
    id: `playlist-${name}`,
    name,
    createdAt: '2026-06-17T00:00:00.000Z',
    modifiedAt: '2026-06-17T00:00:00.000Z',
    createdBy: 'tester',
    createdById: 'session-1',
    items: [
      {
        id: `item-${name}`,
        videoPath,
        bframePath: '',
        fileName: `${name}.mp4`,
        thumbnailPath: 'data:image/png;base64,stub',
        order: 0,
        addedAt: '2026-06-17T00:00:00.000Z',
        modifiedAtMs: 0
      }
    ],
    settings: {
      floatingMode: false,
      continuous: {
        loop: false,
        sortMode: 'fileName',
        manualOrder: false
      }
    }
  });

  global.window = {
    appState: { userName: 'tester', sessionId: 'session-1' },
    electronAPI: {
      readPlaylist: async filePath => (
        filePath.endsWith('B.bplaylist')
          ? makePlaylist('B', 'C:\\video\\B.mp4')
          : makePlaylist('A', 'C:\\video\\A.mp4')
      ),
      fileExists: async () => false,
      writePlaylist: async () => {}
    }
  };

  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  const callbackChecks = [];

  manager.onPlaylistLoaded = async (playlist, loadContext) => {
    const check = {
      name: playlist.name,
      initiallyCurrent: loadContext.shouldContinue()
    };
    callbackChecks.push(check);
    if (playlist.name === 'A') {
      await new Promise(resolve => setTimeout(resolve, 30));
      check.afterSuperseded = loadContext.shouldContinue();
    }
  };

  const openA = manager.open('C:\\video\\A.bplaylist');
  setTimeout(() => {
    void manager.open('C:\\video\\B.bplaylist');
  }, 0);

  const aResult = await openA;
  await new Promise(resolve => setTimeout(resolve, 80));

  assert.equal(aResult, null);
  assert.deepEqual(callbackChecks, [
    { name: 'A', initiallyCurrent: true, afterSuperseded: false },
    { name: 'B', initiallyCurrent: true }
  ]);
  assert.equal(manager.currentPlaylist.name, 'B');
});
