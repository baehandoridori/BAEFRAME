const test = require('node:test');
const assert = require('node:assert/strict');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function fixture() {
  const writes = [];
  global.window = {
    appState: { userName: 'test', sessionId: 'playlist-save-ux' },
    electronAPI: {
      async writePlaylist(filePath, data) {
        writes.push({ filePath, data: structuredClone(data) });
      },
      async readPlaylist() {
        return { playlistVersion: '1.0', id: 'B', name: 'B', items: [], settings: {} };
      },
      async pathDirname() { return 'C:/ux/A'; },
      async pathJoin(directory, name) { return `${directory}/${name}`; }
    }
  };
  const { PlaylistManager } = await import('../../renderer/scripts/modules/playlist-manager.js');
  const manager = new PlaylistManager();
  manager.createNew('A');
  manager.currentPlaylist.id = 'A';
  manager.currentPlaylist.items = [{ id: 'item-A', videoPath: 'C:/ux/A/video.mp4' }];
  manager.playlistPath = 'C:/ux/A.bplaylist';
  return { manager, writes, api: window.electronAPI };
}

function holdFirstWrite(api, writes) {
  const gate = deferred();
  api.writePlaylist = async (filePath, data) => {
    writes.push({ filePath, data: structuredClone(data) });
    if (writes.length === 1) await gate.promise;
  };
  return gate;
}

test('late A save cannot replace B path and the next save targets B', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const saving = manager.save();
  await tick();
  const opening = manager.open('C:/ux/B.bplaylist');
  await tick();
  gate.resolve();
  await Promise.all([saving, opening]);
  assert.equal(manager.currentPlaylist.id, 'B');
  assert.equal(manager.playlistPath, 'C:/ux/B.bplaylist');
  manager.setName('B edited');
  await manager.save();
  assert.equal(writes.at(-1).filePath, 'C:/ux/B.bplaylist');
  assert.equal(writes.at(-1).data.id, 'B');
});

test('an old save and createNew autosave cannot claim the new playlist', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const saving = manager.save();
  await tick();
  const next = manager.createNew('New playlist');
  gate.resolve();
  await saving;
  await tick();
  assert.equal(manager.currentPlaylist, next);
  assert.equal(manager.playlistPath, null);
  assert.equal(manager.isModified, true);
  assert.ok(writes.every(write => write.data.id === 'A'));
});

test('edits made during a save remain dirty, including changes outside manager mutators', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const saving = manager.save();
  await tick();
  manager.setName('A edited');
  manager.getCurrentItem = () => manager.currentPlaylist.items[0];
  manager.getCurrentItem().bframePath = 'C:/ux/A/video.bframe';
  manager.isModified = true;
  gate.resolve();
  await saving;
  assert.equal(writes[0].data.name, 'A');
  assert.equal(writes[0].data.items[0].bframePath, undefined);
  assert.equal(manager.isModified, true);
  await manager.save();
  assert.equal(writes.at(-1).data.name, 'A edited');
  assert.equal(writes.at(-1).data.items[0].bframePath, 'C:/ux/A/video.bframe');
  assert.equal(manager.isModified, false);
});

test('first-save directory lookup never substitutes a newly opened playlist', async () => {
  const { manager, writes, api } = await fixture();
  manager.playlistPath = null;
  const gate = deferred();
  api.pathDirname = () => gate.promise;
  const saving = manager.save();
  await tick();
  const opening = manager.open('C:/ux/B.bplaylist');
  await tick();
  gate.resolve('C:/ux/A');
  await Promise.all([saving, opening]);
  assert.equal(writes[0].filePath, 'C:/ux/A/A.bplaylist');
  assert.equal(writes[0].data.id, 'A');
  assert.equal(writes[0].data.name, 'A');
  assert.equal(manager.playlistPath, 'C:/ux/B.bplaylist');
});

test('overlapping saves write captured contents in request order', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const first = manager.save();
  await tick();
  manager.setName('Latest');
  const second = manager.save();
  await tick();
  const writesWhileFirstPending = writes.length;
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(writesWhileFirstPending, 1, 'writes to the same file must not overlap');
  assert.deepEqual(writes.map(write => write.data.name), ['A', 'Latest']);
  assert.equal(manager.currentPlaylist.name, 'Latest');
  assert.equal(manager.isModified, false);
});

test('Save As requests remain ordered and the latest successful destination is retained', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const first = manager.save('C:/ux/first.bplaylist');
  await tick();
  manager.setName('Second');
  const second = manager.save('C:/ux/second.bplaylist');
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map(write => write.filePath), ['C:/ux/first.bplaylist', 'C:/ux/second.bplaylist']);
  assert.equal(manager.playlistPath, 'C:/ux/second.bplaylist');
  assert.equal(manager.isModified, false);
});

test('a failed save preserves path and dirty state and a later retry succeeds', async () => {
  const { manager, api } = await fixture();
  api.writePlaylist = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(manager.save('C:/ux/other.bplaylist'), /disk unavailable/);
  assert.equal(manager.playlistPath, 'C:/ux/A.bplaylist');
  assert.equal(manager.isModified, true);
  await assert.rejects(manager.open('C:/ux/B.bplaylist'), /disk unavailable/);
  assert.equal(manager.currentPlaylist.id, 'A');
  api.writePlaylist = async () => {};
  await manager.save();
  assert.equal(manager.isModified, false);
});

test('open waits for an in-flight first save and preserves the current document if it fails', async () => {
  const { manager, writes, api } = await fixture();
  manager.playlistPath = null;
  const gate = holdFirstWrite(api, writes);
  const saving = manager.save();
  const saveFailure = assert.rejects(saving, /disk unavailable/);
  await tick();
  const opening = manager.open('C:/ux/B.bplaylist');
  const openOutcome = opening.then(value => ({ value }), error => ({ error }));
  await tick();
  gate.reject(new Error('disk unavailable'));
  await saveFailure;
  assert.match((await openOutcome).error?.message || '', /disk unavailable/);
  assert.equal(manager.currentPlaylist.id, 'A');
  assert.equal(manager.playlistPath, null);
  assert.equal(manager.isModified, true);
});

test('open saves edits made to the current playlist while its first save is waiting', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const opening = manager.open('C:/ux/B.bplaylist');
  await tick();
  manager.setName('A edited while opening');
  gate.resolve();
  await opening;
  assert.equal(manager.currentPlaylist.id, 'B');
  assert.equal(writes.at(-1).data.name, 'A edited while opening');
});

test('open saves current playlist edits made while the next playlist is being read', async () => {
  const { manager, writes, api } = await fixture();
  const gate = deferred();
  const originalRead = api.readPlaylist;
  api.readPlaylist = async () => { await gate.promise; return originalRead(); };
  const opening = manager.open('C:/ux/B.bplaylist');
  await tick();
  manager.setName('A edited during read');
  gate.resolve();
  await opening;
  assert.equal(manager.currentPlaylist.id, 'B');
  assert.equal(writes.at(-1).data.name, 'A edited during read');
});

test('a normal save queued after Save As follows the newly saved destination', async () => {
  const { manager, writes, api } = await fixture();
  const gate = holdFirstWrite(api, writes);
  const first = manager.save('C:/ux/new.bplaylist');
  await tick();
  manager.setName('Latest');
  const second = manager.save();
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(writes.map(write => write.filePath), ['C:/ux/new.bplaylist', 'C:/ux/new.bplaylist']);
  assert.equal(writes.at(-1).data.name, 'Latest');
  assert.equal(manager.playlistPath, 'C:/ux/new.bplaylist');
});

test('overlapping first saves keep one file even when the playlist name changes', async () => {
  const { manager, writes, api } = await fixture();
  manager.playlistPath = null;
  const gate = deferred();
  api.pathDirname = () => gate.promise;
  const first = manager.save();
  await tick();
  manager.setName('Renamed');
  const second = manager.save();
  gate.resolve('C:/ux/A');
  await Promise.all([first, second]);
  assert.deepEqual(writes.map(write => write.filePath), ['C:/ux/A/A.bplaylist', 'C:/ux/A/A.bplaylist']);
  assert.equal(writes.at(-1).data.name, 'Renamed');
});

test('reopening the same file refreshes data after edits are saved during the read', async () => {
  const { manager, writes, api } = await fixture();
  let diskData = structuredClone(manager.currentPlaylist);
  api.writePlaylist = async (filePath, data) => {
    diskData = structuredClone(data);
    writes.push({ filePath, data: structuredClone(data) });
  };
  const gate = deferred();
  let reads = 0;
  api.readPlaylist = async () => {
    const captured = structuredClone(diskData);
    if (++reads === 1) await gate.promise;
    return captured;
  };
  const opening = manager.open('C:/ux/A.bplaylist');
  await tick();
  manager.setName('Latest');
  gate.resolve();
  await opening;
  assert.equal(manager.currentPlaylist.name, 'Latest');
  assert.equal(manager.isModified, false);
  assert.equal(diskData.name, 'Latest');
});

for (const boundary of ['read', 'repair']) {
  test(`a save already completed during ${boundary} cannot be replaced by older open data`, async () => {
    const { manager, api } = await fixture();
    manager.isModified = false;
    let diskData = structuredClone(manager.currentPlaylist);
    api.writePlaylist = async (_, data) => { diskData = structuredClone(data); };
    const gate = deferred();
    const entered = deferred();
    let reads = 0;
    api.readPlaylist = async () => {
      const captured = structuredClone(diskData);
      if (++reads === 1 && boundary === 'read') { entered.resolve(); await gate.promise; }
      return captured;
    };
    let repairs = 0;
    manager._repairMissingBframePaths = async () => {
      if (++repairs === 1 && boundary === 'repair') { entered.resolve(); await gate.promise; return 1; }
      return 0;
    };
    const opening = manager.open('C:/ux/A.bplaylist');
    await entered.promise;
    manager.setName('Latest saved during open');
    await manager.save();
    assert.equal(manager.pendingSave, null);
    assert.equal(manager.isModified, false);
    gate.resolve();
    await opening;
    assert.equal(manager.currentPlaylist.name, 'Latest saved during open');
    assert.equal(diskData.name, 'Latest saved during open');
    assert.equal(manager.isModified, false);
  });
}

test('open repair writes and user saves keep their requested order', async () => {
  const { manager, api } = await fixture();
  manager.isModified = false;
  let diskData = structuredClone(manager.currentPlaylist);
  const entered = deferred(), gate = deferred();
  let writes = 0, repairs = 0;
  api.readPlaylist = async () => structuredClone(diskData);
  manager._repairMissingBframePaths = async () => ++repairs === 1 ? 1 : 0;
  api.writePlaylist = async (_, data) => {
    if (++writes === 1) { entered.resolve(); await gate.promise; }
    diskData = structuredClone(data);
  };
  const opening = manager.open('C:/ux/A.bplaylist');
  await entered.promise;
  manager.setName('Latest after repair started');
  const saving = manager.save();
  await tick();
  gate.resolve();
  await Promise.all([opening, saving]);
  assert.equal(diskData.name, 'Latest after repair started');
  assert.equal(manager.currentPlaylist.name, diskData.name);
  assert.equal(manager.isModified, false);
});

test('refreshing an older open after a save preserves the newer open request priority', async () => {
  const { manager, api } = await fixture();
  manager.isModified = false;
  let diskData = structuredClone(manager.currentPlaylist);
  api.writePlaylist = async (_, data) => { diskData = structuredClone(data); };
  manager._repairMissingBframePaths = async () => 0;
  const a = deferred(), b = deferred();
  let aReads = 0;
  api.readPlaylist = async filePath => {
    if (filePath === 'C:/ux/B.bplaylist') {
      await b.promise;
      return { playlistVersion: '1.0', id: 'B', name: 'B', items: [], settings: {} };
    }
    const captured = structuredClone(diskData);
    if (++aReads === 1) await a.promise;
    return captured;
  };
  const openingA = manager.open('C:/ux/A.bplaylist');
  const openingB = manager.open('C:/ux/B.bplaylist');
  await tick();
  manager.setName('Latest A');
  await manager.save();
  a.resolve();
  await openingA;
  b.resolve();
  await openingB;
  assert.equal(manager.currentPlaylist.id, 'B');
  assert.equal(manager.playlistPath, 'C:/ux/B.bplaylist');
});
