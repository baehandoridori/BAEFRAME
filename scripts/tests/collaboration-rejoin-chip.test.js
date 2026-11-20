const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

// 실시간 방에 들어가지 못한 사람에게 "다시 연결" 이 실제로 보이고 눌리는지 본다.
//
// v2.16.3-beta 는 그 입구(#syncStatus)를 협업자 표시(#collaboratorsIndicator) 안에 뒀다.
// 협업자 표시는 연결된 사람에게만 보이므로 정작 접속에 실패한 사람은 누를 수 없었다.
// 그때의 점검은 element.click() 으로 숨겨진 요소를 눌러 통과했다. 여기서는 실제 index.html 의
// 상단과 main.css 의 규칙을 올려 두고, 누르기 전에 자신과 조상이 화면에 보이는지 먼저 확인한다.

const root = path.join(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'renderer/scripts/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8');
const mainCss = fs.readFileSync(path.join(root, 'renderer/styles/main.css'), 'utf8');

const headerHtml = indexHtml.slice(
  indexHtml.indexOf('<header class="header">'),
  indexHtml.indexOf('</header>') + '</header>'.length
);
const chipCss = (mainCss.match(/^\.collab-status-chip[^{]*\{[^}]*\}/gm) || []).join('\n');

const REJOIN_FUNCTIONS = [
  'describeCollaborationJoinFailure',
  'renderCollaborationStatusChip',
  'clearCollaborationRejoin',
  'scheduleCollaborationRejoin',
  'retryCollaborationJoin',
  'requestManualCollaborationRejoin',
  'showCollaborationSyncStatus'
];

function appFunction(name) {
  const start = appSource.search(new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`));
  assert.ok(start >= 0, `app.js 에 ${name}() 이 있어야 한다`);
  return appSource.slice(start, appSource.indexOf('\n  }', start) + 4);
}

function appConstant(name) {
  const match = appSource.match(new RegExp(`^  const ${name} = ([\\s\\S]*?);\\n`, 'm'));
  assert.ok(match, `app.js 에 상수 ${name} 이 있어야 한다`);
  return vm.runInNewContext(`(${match[1]})`);
}

function chipClickWiring() {
  const match = appSource.match(/^ {2}elements\.collaborationStatusChip\?\.addEventListener\('click', [^\n]+\);$/m);
  assert.ok(match, '상단 표시의 클릭이 재접속에 연결돼 있어야 한다');
  return match[0];
}

function isShown(element) {
  const view = element.ownerDocument.defaultView;
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

// 사용자가 누르는 것을 흉내 낸다. 보이지 않는 것은 누를 수 없다.
function userClick(element) {
  assert.equal(isShown(element), true, '사용자는 화면에 보이는 것만 누를 수 있다');
  const { MouseEvent } = element.ownerDocument.defaultView;
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const flush = async () => {
  for (let index = 0; index < 5; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

function createHarness({ currentPath = 'A.bframe', latestToken = 1 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${chipCss}</style></head><body>${headerHtml}</body></html>`
  );
  const { document } = dom.window;
  const chip = document.getElementById('collabStatusChip');
  const label = document.getElementById('collabStatusChipLabel');
  assert.ok(chip && label, 'index.html 의 상단에 #collabStatusChip 과 #collabStatusChipLabel 이 있어야 한다');

  const state = { now: 1700000000000, currentPath, joinResult: 'room-full', joinGate: null };
  const toasts = [];
  const timers = [];
  const joins = [];
  const context = vm.createContext({
    Date: { now: () => state.now },
    elements: { collaborationStatusChip: chip, collaborationStatusChipLabel: label },
    COLLABORATION_REJOIN_DELAYS_MS: appConstant('COLLABORATION_REJOIN_DELAYS_MS'),
    COLLABORATION_REJOIN_BUSY_RECHECK_MS: appConstant('COLLABORATION_REJOIN_BUSY_RECHECK_MS'),
    COLLABORATION_MANUAL_REJOIN_COOLDOWN_MS: appConstant('COLLABORATION_MANUAL_REJOIN_COOLDOWN_MS'),
    COLLABORATION_STATUS_CHIP_LABELS: appConstant('COLLABORATION_STATUS_CHIP_LABELS'),
    collaborationRejoin: null,
    lastManualCollaborationRejoinAt: 0,
    latestVideoLoadToken: latestToken,
    activeVideoLoadToken: null,
    liveblocksManager: { isConnected: false, hasOtherCollaborators: () => false },
    isSameFilePath: (left, right) => left === right,
    isCurrentReviewPath: bframePath => bframePath === state.currentPath,
    showToast: (text, type = 'info', _duration = null, force = false) => {
      toasts.push({ text, type, force: force === true });
    },
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay, cleared: false });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    reviewDataManager: { reloadCommentsFromDisk: async () => ({ changed: false }) },
    refreshCommentRangesForCurrentMode: () => {},
    // 실제 startCollaborationForVideoLoad 의 결과만 흉내 낸다: 들어가면 연결됨, 못 들어가면
    // 사유와 함께 재접속을 다시 예약한다.
    startCollaborationForVideoLoad: async (loadToken, bframePath, options) => {
      joins.push({ loadToken, bframePath, isRejoin: options?.isRejoin === true });
      if (state.joinGate) await state.joinGate.promise;
      if (state.joinResult === 'connected') {
        context.liveblocksManager.isConnected = true;
      } else {
        context.scheduleCollaborationRejoin(loadToken, bframePath, state.joinResult);
      }
      return true;
    }
  });
  for (const name of REJOIN_FUNCTIONS) vm.runInContext(appFunction(name), context);
  vm.runInContext(chipClickWiring(), context);

  return {
    document,
    chip,
    label,
    context,
    state,
    toasts,
    timers,
    joins,
    indicator: document.getElementById('collaboratorsIndicator'),
    syncStatus: document.getElementById('syncStatus'),
    pendingTimers: () => timers.filter(timer => !timer.cleared)
  };
}

test('the reconnect chip sits outside the collaborators indicator, which only connected users see', () => {
  const h = createHarness();
  assert.ok(h.indicator && h.syncStatus);
  // 협업자 표시는 연결되기 전까지 숨겨져 있고, 옛 입구(#syncStatus)는 그 안에 있다.
  assert.equal(isShown(h.indicator), false);
  assert.equal(h.indicator.contains(h.syncStatus), true);
  assert.equal(isShown(h.syncStatus), false);
  // 새 입구는 그 밖에 있어야 협업자 표시가 숨겨져도 함께 숨지 않는다.
  assert.equal(h.indicator.contains(h.chip), false);
  assert.equal(h.chip.closest('.header-right') !== null, true);
  // 접속에 실패한 적이 없으면 보이지 않는다.
  assert.equal(isShown(h.chip), false);
});

test('a failed room join shows a reconnect chip the user can actually see and press', () => {
  const h = createHarness();
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');

  assert.equal(isShown(h.chip), true, '접속에 실패하면 상단에 표시가 보인다');
  assert.equal(h.chip.classList.contains('is-clickable'), true);
  assert.match(h.label.textContent, /인원 가득/);
  assert.match(h.label.textContent, /다시 연결/);
  assert.match(h.chip.title, /10명/);
  assert.match(h.chip.title, /다시 연결/);
  // 협업자 표시와 그 안의 옛 입구는 여전히 숨겨져 있다. 사용자가 누를 수 있는 것은 새 표시뿐이다.
  assert.equal(isShown(h.syncStatus), false);
});

test('the chip names why the join failed', () => {
  const expected = {
    'room-full': /인원 가득/,
    'service-suspended': /사용 한도/,
    timeout: /연결 안 됨/,
    'connection-error': /연결 안 됨/
  };
  for (const [reason, pattern] of Object.entries(expected)) {
    const h = createHarness();
    h.context.scheduleCollaborationRejoin(1, 'A.bframe', reason);
    assert.match(h.label.textContent, pattern, reason);
    assert.match(h.label.textContent, /다시 연결/, reason);
  }
});

test('the chip goes away when the rejoin record is cleared or the room is joined', () => {
  const cleared = createHarness();
  cleared.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  cleared.context.clearCollaborationRejoin();
  assert.equal(isShown(cleared.chip), false);

  const joined = createHarness();
  joined.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  joined.context.liveblocksManager.isConnected = true;
  joined.context.renderCollaborationStatusChip();
  assert.equal(isShown(joined.chip), false, '연결돼 있으면 재접속 표시는 보이지 않는다');
});

test('pressing the chip tries once, shows progress, and returns to "reconnect" while the room is still full', async () => {
  const h = createHarness();
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  h.toasts.length = 0;
  h.state.joinGate = deferred();

  userClick(h.chip);
  await flush();
  assert.equal(h.joins.length, 1);
  assert.equal(h.joins[0].bframePath, 'A.bframe');
  assert.equal(h.joins[0].isRejoin, true);
  assert.match(h.label.textContent, /연결 중/, '시도하는 동안에는 진행 중임을 보인다');
  assert.equal(h.chip.classList.contains('is-clickable'), false);
  assert.equal(isShown(h.chip), true);

  // 시도하는 중에 또 눌러도 접속을 하나 더 열지 않는다.
  h.chip.dispatchEvent(new h.document.defaultView.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.equal(h.joins.length, 1);

  h.state.joinGate.resolve();
  await flush();
  assert.match(h.label.textContent, /다시 연결/);
  assert.equal(h.chip.classList.contains('is-clickable'), true);
  assert.equal(isShown(h.chip), true);
  assert.equal(h.toasts.some(toast => toast.type === 'warning' && /10명/.test(toast.text)), true,
    '직접 눌렀는데 여전히 못 들어가면 사유를 다시 알린다');
});

test('a successful manual rejoin hides the chip', async () => {
  const h = createHarness();
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  h.state.joinResult = 'connected';

  userClick(h.chip);
  await flush();
  assert.equal(h.joins.length, 1);
  assert.equal(h.context.collaborationRejoin, null);
  assert.equal(isShown(h.chip), false);
  assert.equal(h.toasts.some(toast => toast.type === 'success' && /연결되었습니다/.test(toast.text)), true);
});

test('pressing again right away does not open another connection', async () => {
  const h = createHarness();
  const cooldown = h.context.COLLABORATION_MANUAL_REJOIN_COOLDOWN_MS;
  assert.ok(cooldown >= 10000, '거절된 접속도 사용량으로 잡힐 수 있어 연달아 누르는 것을 막는다');
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');

  userClick(h.chip);
  await flush();
  assert.equal(h.joins.length, 1);

  h.toasts.length = 0;
  h.state.now += cooldown - 1;
  userClick(h.chip);
  await flush();
  assert.equal(h.joins.length, 1, '간격 안에는 다시 접속하지 않는다');
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].force, true, '눌렀는데 아무 반응이 없으면 안 된다(알림을 꺼 둔 사람에게도 보인다)');
  assert.match(h.toasts[0].text, /잠시 뒤/);

  h.state.now += 1;
  userClick(h.chip);
  await flush();
  assert.equal(h.joins.length, 2, '간격이 지나면 다시 시도한다');
});

test('the chip stays pressable after the automatic attempts run out', async () => {
  const h = createHarness();
  const attempts = h.context.COLLABORATION_REJOIN_DELAYS_MS.length;
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  h.context.collaborationRejoin.attempt = attempts;
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  assert.equal(h.pendingTimers().length, 0, '정해진 횟수 뒤에는 저절로 다시 시도하지 않는다');
  assert.equal(isShown(h.chip), true);
  assert.equal(h.chip.classList.contains('is-clickable'), true);

  userClick(h.chip);
  await flush();
  assert.equal(h.joins.length, 1, '그 뒤에도 직접 눌러 다시 연결해 볼 수 있다');
  assert.equal(isShown(h.chip), true);
});

test('a cancelled video switch or an engine swap keeps the rejoin alive (same file, new load token)', async () => {
  const h = createHarness({ latestToken: 3 });
  h.context.scheduleCollaborationRejoin(3, 'A.bframe', 'room-full');
  h.toasts.length = 0;
  // 영상 전환을 취소했거나 같은 파일의 재생 엔진만 바뀌었다: 토큰만 올라가고 파일은 그대로다.
  h.context.latestVideoLoadToken = 7;

  await h.context.retryCollaborationJoin();
  await flush();
  assert.equal(h.joins.length, 1, '같은 파일이면 재접속을 버리지 않는다');
  assert.equal(h.joins[0].loadToken, 7, '지금의 로드 토큰으로 이어서 시도한다');
  assert.notEqual(h.context.collaborationRejoin, null);
  assert.equal(isShown(h.chip), true);
  assert.equal(h.toasts.length, 0, '저절로 한 시도가 같은 사유로 실패하면 다시 알리지 않는다');
});

test('a rejoin record that belongs to another file is dropped without joining', async () => {
  const h = createHarness();
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  h.state.currentPath = 'B.bframe';

  await h.context.retryCollaborationJoin();
  await flush();
  assert.equal(h.joins.length, 0);
  assert.equal(h.context.collaborationRejoin, null);
  assert.equal(isShown(h.chip), false);
});

test('a rejoin does not start while a video is being opened; it is checked again shortly', async () => {
  const h = createHarness();
  h.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  const record = h.context.collaborationRejoin;
  h.context.latestVideoLoadToken = 2;
  h.context.activeVideoLoadToken = 2;

  await h.context.retryCollaborationJoin();
  await flush();
  assert.equal(h.joins.length, 0, '영상을 여는 중에는 접속을 시작하지 않는다');
  assert.equal(h.context.collaborationRejoin, record, '기록은 그대로 둔다');
  assert.equal(record.attempt, 0, '시도하지 않은 차례는 횟수로 세지 않는다');
  const recheck = h.pendingTimers();
  assert.equal(recheck.length, 1);
  assert.equal(recheck[0].delay, h.context.COLLABORATION_REJOIN_BUSY_RECHECK_MS);

  // 열기가 취소됐다(파일은 그대로). 다시 볼 때 이어서 시도한다.
  h.context.activeVideoLoadToken = null;
  recheck[0].callback();
  await flush();
  assert.equal(h.joins.length, 1);
  assert.equal(h.joins[0].loadToken, 2);
});

test('the sync icon of a connected user still reports status, and falls back to the same rejoin when not connected', async () => {
  const connected = createHarness();
  connected.context.liveblocksManager.isConnected = true;
  connected.context.showCollaborationSyncStatus();
  await flush();
  assert.equal(connected.joins.length, 0);
  assert.equal(connected.toasts.some(toast => /다른 협업자가 없습니다/.test(toast.text)), true);

  const failed = createHarness();
  failed.context.scheduleCollaborationRejoin(1, 'A.bframe', 'room-full');
  failed.context.showCollaborationSyncStatus();
  await flush();
  assert.equal(failed.joins.length, 1);
});

test('switching to another file clears the rejoin record together with the rest of the collaboration UI', () => {
  const start = appSource.indexOf('// ====== 이전 파일 감시 및 협업 세션 정리');
  assert.ok(start >= 0);
  const cleanup = appSource.slice(start, appSource.indexOf('// ====== 이전 데이터 초기화', start));
  assert.ok(cleanup.includes('updateCollaboratorsUI([]);'));
  assert.ok(cleanup.includes('clearCollaborationRejoin();'),
    '지난 파일의 재접속 표시가 새 파일 위에 남으면 안 된다');
});
