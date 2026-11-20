const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

// 실시간 방에 들어가지 못한 사람에게 "다시 연결" 이 보이고 눌리는지, 그리고 그 뒤의 재접속이
// 엉뚱한 때에 접속을 열지 않는지 본다.
//
// v2.16.3-beta 는 그 입구(#syncStatus)를 협업자 표시(#collaboratorsIndicator) 안에 뒀다.
// 협업자 표시는 연결된 사람에게만 보이므로 정작 접속에 실패한 사람은 누를 수 없었다.
// 그때의 점검은 element.click() 으로 숨겨진 요소를 눌러 통과했다.
//
// 여기서 확인하는 것과 못 하는 것:
// - 실제 index.html 과 그것이 올리는 스타일시트로, 표시 자신과 조상이 숨겨져 있지 않은지 본다
//   (display·visibility·opacity·hidden·pointer-events). 누르기 전에는 늘 이것을 먼저 확인한다.
// - jsdom 은 배치를 계산하지 않고, 창 폭 조건이 붙은 @media·@supports·@layer 안의 규칙도 반영하지
//   않는다. 창이 좁아 잘리는지, 다른 요소에 덮이는지, 실제 마우스로 눌리는지는 실제 앱 점검이 본다
//   (app-smoke-rejoin-chip.cjs. 저장소 밖 output/audits/2026-11-20-collab-rejoin-chip/app-smoke/ 에 둔다).
// - 접속은 실제 startCollaborationForVideoLoad 를 가짜 LiveblocksManager 와 함께 돌린다. 접속을
//   몇 번 열었는지는 그 가짜의 start() 호출 수로 센다.

const root = path.join(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const appSource = read('renderer/scripts/app.js');
const indexHtml = read('renderer/index.html');
const mainCss = read('renderer/styles/main.css');

const headerHtml = indexHtml.slice(
  indexHtml.indexOf('<header class="header">'),
  indexHtml.indexOf('</header>') + '</header>'.length
);
const chipCss = (mainCss.match(/^(?:\.light-mode )?\.collab-status-chip[^{]*\{[^}]*\}/gm) || []).join('\n');

// index.html 이 올리는 스타일시트 전부(외부 주소는 빼고, @import 는 따라가 넣는다).
function localStyles() {
  const hrefs = [...indexHtml.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]
    .map(tag => (tag[0].match(/href="([^"]+)"/) || [])[1])
    .filter(href => href && !/^(https?:)?\/\//.test(href));
  assert.ok(hrefs.some(href => href.endsWith('main.css')), 'index.html 이 main.css 를 올려야 한다');
  const seen = new Set();
  const load = (file) => {
    if (seen.has(file)) return '';
    seen.add(file);
    return fs.readFileSync(file, 'utf8').replace(
      /@import\s+(?:url\()?['"]?([^'")\s;]+)['"]?\)?[^;]*;/g,
      (_whole, target) => (/^(https?:)?\/\//.test(target) ? '' : load(path.resolve(path.dirname(file), target)))
    );
  };
  return hrefs.map(href => load(path.join(root, 'renderer', href))).join('\n');
}

const REJOIN_FUNCTIONS = [
  'isStaleVideoLoadToken',
  'isCurrentReviewPath',
  'stopStaleCollaborationRoom',
  'describeCollaborationJoinFailure',
  'renderCollaborationStatusChip',
  'clearCollaborationRejoin',
  'armCollaborationRejoinTimer',
  'scheduleCollaborationRejoin',
  'retryCollaborationJoin',
  'requestManualCollaborationRejoin',
  'showCollaborationSyncStatus',
  'startCollaborationForVideoLoad'
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

// 자신과 조상 가운데 하나라도 숨겨져 있으면 사용자에게 보이지 않는다.
function hiddenBy(element) {
  const view = element.ownerDocument.defaultView;
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    const name = node.id ? `#${node.id}` : node.tagName.toLowerCase();
    if (node.hidden) return `${name} [hidden]`;
    if (style.display === 'none') return `${name} display:none`;
    if (style.visibility === 'hidden') return `${name} visibility:hidden`;
    if (style.opacity === '0') return `${name} opacity:0`;
    if (style.pointerEvents === 'none') return `${name} pointer-events:none`;
  }
  return null;
}
const isShown = element => hiddenBy(element) === null;

// 사용자가 누르는 것을 흉내 낸다. 보이지 않는 것은 누를 수 없다.
function userClick(element) {
  assert.equal(hiddenBy(element), null, '사용자는 화면에 보이는 것만 누를 수 있다');
  const { MouseEvent } = element.ownerDocument.defaultView;
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const flush = async () => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
};

// fullPage: 실제 index.html 전체와 스타일시트 전부를 올린다(보이는지 따질 때). 아니면 상단과 표시의
// 규칙만 올린다(동작을 따질 때. getComputedStyle 이 규칙 전부를 훑어 느리기 때문).
function createHarness({ fullPage = false } = {}) {
  const virtualConsole = new VirtualConsole();
  const dom = fullPage
    ? new JSDOM(indexHtml.replace('</head>', () => `<style>${localStyles()}</style></head>`), { virtualConsole })
    : new JSDOM(`<!doctype html><html><head><style>${chipCss}</style></head><body>${headerHtml}</body></html>`,
      { virtualConsole });
  const { document } = dom.window;
  const chip = document.getElementById('collabStatusChip');
  const label = document.getElementById('collabStatusChipLabel');
  assert.ok(chip && label, 'index.html 의 상단에 #collabStatusChip 과 #collabStatusChipLabel 이 있어야 한다');

  // joinResult: 'connected' 또는 접속 실패 사유. joinGate: 접속을 기다리게 붙잡아 둘 때.
  // loadGate: 접속에 앞서 리뷰 파일을 읽는 것을 붙잡아 둘 때.
  const state = { now: 5000000, joinResult: 'room-full', joinGate: null, loadGate: null };
  const toasts = [];
  const timers = [];
  const starts = [];
  const counts = { enters: 0, stops: 0, reloads: 0, watches: 0 };
  const manager = {
    isConnected: false,
    roomId: null,
    hasOtherCollaborators: () => false,
    // 접속 한 번 = 서비스 사용량 한 번.
    start: async (_bframePath, _userName, _userColor, existingRoomId) => {
      counts.enters += 1;
      if (state.joinGate) await state.joinGate.promise;
      if (state.joinResult === 'connected') {
        manager.isConnected = true;
        manager.roomId = existingRoomId;
        return { roomId: existingRoomId, isNewRoom: false };
      }
      const error = new Error(`접속 실패: ${state.joinResult}`);
      error.joinFailureReason = state.joinResult;
      throw error;
    },
    stop: async () => {
      counts.stops += 1;
      manager.isConnected = false;
      manager.roomId = null;
    }
  };
  const sync = { start: async () => {}, stop() {}, broadcastCurrentState() {} };
  const context = vm.createContext({
    performance: { now: () => state.now },
    elements: { collaborationStatusChip: chip, collaborationStatusChipLabel: label },
    COLLABORATION_REJOIN_DELAYS_MS: appConstant('COLLABORATION_REJOIN_DELAYS_MS'),
    COLLABORATION_REJOIN_BUSY_RECHECK_MS: appConstant('COLLABORATION_REJOIN_BUSY_RECHECK_MS'),
    COLLABORATION_MANUAL_REJOIN_COOLDOWN_MS: appConstant('COLLABORATION_MANUAL_REJOIN_COOLDOWN_MS'),
    COLLABORATION_STATUS_CHIP_LABELS: appConstant('COLLABORATION_STATUS_CHIP_LABELS'),
    collaborationRejoin: null,
    lastCollaborationJoinAttemptAt: Number.NEGATIVE_INFINITY,
    latestVideoLoadToken: 1,
    videoLoadInFlightToken: null,
    _previousOthersCount: 0,
    _collaborationSessionStartedAt: 0,
    liveblocksManager: manager,
    commentSync: sync,
    drawingSync: sync,
    fabricDrawingSync: sync,
    playbackSync: sync,
    userSettings: { getUserName: () => 'tester', getColorForName: () => '#4a9eff' },
    log: { info() {}, warn() {}, debug() {}, error() {} },
    reviewDataManager: {
      currentBframePath: 'A.bframe',
      setLiveblocksRoomId() {},
      save: async () => true,
      reloadCommentsFromDisk: async () => { counts.reloads += 1; return { changed: false }; }
    },
    window: {
      electronAPI: {
        loadReview: async () => {
          if (state.loadGate) await state.loadGate.promise;
          return { liveblocksRoomId: 'room-A' };
        },
        watchFileStart: async () => { counts.watches += 1; return { success: true }; }
      }
    },
    isSameFilePath: (left, right) => left === right,
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
    refreshCommentRangesForCurrentMode: () => {}
  });
  for (const name of REJOIN_FUNCTIONS) vm.runInContext(appFunction(name), context);
  vm.runInContext(chipClickWiring(), context);

  // 어떤 로드 토큰과 경로로 접속을 시작하려 했는지 적어 둔다(실제 함수는 그대로 부른다).
  const startCollaboration = context.startCollaborationForVideoLoad;
  context.startCollaborationForVideoLoad = (loadToken, bframePath, options) => {
    starts.push({ loadToken, bframePath, isRejoin: options?.isRejoin === true });
    return startCollaboration(loadToken, bframePath, options);
  };

  const pendingTimers = () => timers.filter(timer => !timer.cleared);
  return {
    document,
    chip,
    label,
    context,
    state,
    toasts,
    timers,
    starts,
    counts,
    manager,
    indicator: document.getElementById('collaboratorsIndicator'),
    syncStatus: document.getElementById('syncStatus'),
    pendingTimers,
    cooldown: context.COLLABORATION_MANUAL_REJOIN_COOLDOWN_MS,
    // 파일을 열었는데 실시간 방에 들어가지 못했다(앱이 실제로 밟는 길).
    async openFileAndFailToJoin(reason = 'room-full') {
      state.joinResult = reason;
      await context.startCollaborationForVideoLoad(context.latestVideoLoadToken, 'A.bframe');
      await flush();
    },
    // 예약된 재접속 차례가 왔다.
    async fireTimer(timer = pendingTimers()[0]) {
      assert.ok(timer, '예약된 재접속이 있어야 한다');
      timer.cleared = true;
      timer.callback();
      await flush();
    },
    warnings: () => toasts.filter(toast => toast.type === 'warning'),
    notices: pattern => toasts.filter(toast => pattern.test(toast.text))
  };
}

test('the reconnect chip is visible in the real page when a join fails, unlike the old entry point', async () => {
  const h = createHarness({ fullPage: true });
  assert.ok(h.indicator && h.syncStatus);
  // 협업자 표시는 연결되기 전까지 숨겨져 있고, 옛 입구(#syncStatus)는 그 안에 있다.
  assert.equal(isShown(h.indicator), false);
  assert.equal(h.indicator.contains(h.syncStatus), true);
  // 새 입구는 그 밖, 상단 오른쪽에 있다.
  assert.equal(h.indicator.contains(h.chip), false);
  assert.notEqual(h.chip.closest('.header-right'), null);
  // 접속에 실패한 적이 없으면 보이지 않는다.
  assert.equal(isShown(h.chip), false);

  await h.openFileAndFailToJoin('room-full');
  assert.equal(hiddenBy(h.chip), null, '접속에 실패하면 실제 페이지에서 표시가 보인다');
  assert.equal(isShown(h.syncStatus), false, '옛 입구는 여전히 보이지 않는다');

  // 알려 둔 한계: 앱 전체화면은 상단을 통째로 숨긴다. 그동안에는 표시도 보이지 않는다.
  h.document.body.classList.add('app-fullscreen');
  assert.match(hiddenBy(h.chip) || '', /display:none/);
  h.document.body.classList.remove('app-fullscreen');
  assert.equal(hiddenBy(h.chip), null);
});

test('a failed room join shows a chip that names the reason and says what pressing it does', async () => {
  const expected = {
    'room-full': /인원 가득/,
    'service-suspended': /서비스 한도/,
    timeout: /연결 안 됨/,
    'connection-error': /연결 안 됨/
  };
  for (const [reason, pattern] of Object.entries(expected)) {
    const h = createHarness();
    await h.openFileAndFailToJoin(reason);
    assert.equal(isShown(h.chip), true, reason);
    assert.equal(h.chip.classList.contains('is-clickable'), true, reason);
    assert.match(h.label.textContent, pattern, reason);
    assert.match(h.label.textContent, /다시 연결/, reason);
    assert.match(h.chip.title, /누르면 다시 연결/, reason);
    assert.equal(isShown(h.syncStatus), false, '협업자 표시 안의 옛 입구는 이 사람에게 보이지 않는다');
  }
  const full = createHarness();
  await full.openFileAndFailToJoin('room-full');
  assert.match(full.chip.title, /10명/, '툴팁은 사유를 풀어 말한다');
});

test('the chip goes away when the rejoin record is cleared or the room is joined', async () => {
  const cleared = createHarness();
  await cleared.openFileAndFailToJoin();
  cleared.context.clearCollaborationRejoin();
  assert.equal(isShown(cleared.chip), false);

  const joined = createHarness();
  await joined.openFileAndFailToJoin();
  joined.manager.isConnected = true;
  joined.context.renderCollaborationStatusChip();
  assert.equal(isShown(joined.chip), false, '연결돼 있으면 재접속 표시는 보이지 않는다');
});

test('pressing the chip tries once, shows progress, and reports the result even with toasts turned off', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin('room-full');
  assert.equal(h.counts.enters, 1);
  h.state.now += h.cooldown;
  h.toasts.length = 0;
  h.state.joinGate = deferred();

  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 2, '누르면 접속을 한 번 연다');
  assert.equal(h.starts.at(-1).bframePath, 'A.bframe');
  assert.equal(h.starts.at(-1).isRejoin, true);
  assert.match(h.label.textContent, /연결 중/, '시도하는 동안에는 진행 중임을 보인다');
  assert.equal(h.chip.classList.contains('is-clickable'), false);
  assert.equal(isShown(h.chip), true);

  // 시도하는 중에 또 눌러도 접속을 하나 더 열지 않고, 엉뚱한 안내도 띄우지 않는다.
  const noticesBefore = h.toasts.length;
  h.chip.dispatchEvent(new h.document.defaultView.MouseEvent('click', { bubbles: true }));
  await flush();
  assert.equal(h.counts.enters, 2);
  assert.equal(h.toasts.length, noticesBefore);

  h.state.joinGate.resolve();
  await flush();
  assert.match(h.label.textContent, /다시 연결/);
  assert.equal(h.chip.classList.contains('is-clickable'), true);
  assert.equal(isShown(h.chip), true);
  const failures = h.warnings();
  assert.equal(failures.length, 1, '직접 눌렀는데 여전히 못 들어가면 사유를 한 번 알린다');
  assert.match(failures[0].text, /10명/);
  assert.equal(failures[0].force, true, '알림을 꺼 둔 사람도 누른 결과는 본다');
});

test('a successful manual rejoin hides the chip and catches up from the file', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin();
  h.state.now += h.cooldown;
  h.state.joinResult = 'connected';

  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 2);
  assert.equal(h.context.collaborationRejoin, null);
  assert.equal(isShown(h.chip), false);
  assert.equal(h.notices(/연결되었습니다/).length, 1);
  assert.equal(h.counts.reloads, 1, '방 밖에 있는 동안의 변경을 파일에서 한 번 맞춘다');
  assert.equal(h.pendingTimers().length, 0);
});

test('a join that just failed cannot be reopened by pressing right away, whoever started it', async () => {
  const h = createHarness();
  assert.ok(h.cooldown >= 10000, '거절된 접속도 사용량으로 잡힐 수 있어 연달아 여는 것을 막는다');

  // 파일을 연 직후의 접속이 방금 실패했다.
  await h.openFileAndFailToJoin();
  h.toasts.length = 0;
  h.state.now += h.cooldown - 1;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 1, '간격 안에는 다시 접속하지 않는다');
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0].text, /잠시 뒤/);
  assert.equal(h.toasts[0].force, true, '눌렀는데 아무 반응이 없으면 안 된다(알림을 꺼 둔 사람에게도 보인다)');
  assert.match(h.label.textContent, /다시 연결/);

  h.state.now += 1;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 2, '간격이 지나면 다시 시도한다');

  // 직접 누른 시도가 방금 실패했다.
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 2);

  // 저절로 한 시도가 방금 실패했다.
  h.state.now += h.cooldown * 10;
  await h.fireTimer();
  assert.equal(h.counts.enters, 3);
  h.state.now += 1000;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 3, '저절로 한 시도가 방금 실패했어도 바로 다시 열지 않는다');
});

test('the chip stays pressable after the automatic attempts run out', async () => {
  const h = createHarness();
  const attempts = h.context.COLLABORATION_REJOIN_DELAYS_MS.length;
  await h.openFileAndFailToJoin();
  for (let attempt = 0; attempt < attempts; attempt += 1) await h.fireTimer();
  assert.equal(h.counts.enters, 1 + attempts);
  assert.equal(h.pendingTimers().length, 0, '정해진 횟수 뒤에는 저절로 다시 시도하지 않는다');
  assert.equal(isShown(h.chip), true);
  assert.equal(h.chip.classList.contains('is-clickable'), true);

  h.state.now += h.cooldown;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 2 + attempts, '그 뒤에도 직접 눌러 다시 연결해 볼 수 있다');
  assert.equal(isShown(h.chip), true);
});

test('a cancelled video switch or an engine swap keeps the rejoin alive (same file, new load token)', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin();
  h.toasts.length = 0;
  // 영상 전환을 취소했거나 같은 파일의 재생 엔진만 바뀌었다: 로드는 끝났고 토큰만 올라가 있다.
  h.context.latestVideoLoadToken = 7;

  await h.fireTimer();
  assert.equal(h.counts.enters, 2, '같은 파일이면 재접속을 버리지 않는다');
  assert.equal(h.starts.at(-1).loadToken, 7, '지금의 로드 토큰으로 이어서 시도한다');
  assert.notEqual(h.context.collaborationRejoin, null);
  assert.equal(h.pendingTimers().length, 1, '다음 차례도 잡혀 있다');
  assert.equal(isShown(h.chip), true);
  assert.equal(h.toasts.length, 0, '저절로 한 시도가 같은 사유로 실패하면 다시 알리지 않는다');
});

test('a rejoin record that belongs to another file is dropped without joining', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin();
  h.context.reviewDataManager.currentBframePath = 'B.bframe';

  await h.fireTimer();
  assert.equal(h.counts.enters, 1);
  assert.equal(h.starts.length, 1, '지난 파일의 기록으로는 접속 절차를 시작조차 하지 않는다');
  assert.equal(h.context.collaborationRejoin, null);
  assert.equal(isShown(h.chip), false);
});

test('nothing joins while a video is being opened, from the moment its load token is taken', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin();
  const record = h.context.collaborationRejoin;
  // loadVideo 가 토큰을 올린 직후다. 저장과 그리기 정리를 기다리는 중이라 파일은 아직 그대로다.
  h.context.latestVideoLoadToken = 2;
  h.context.videoLoadInFlightToken = 2;

  await h.fireTimer();
  assert.equal(h.counts.enters, 1, '영상을 여는 중에는 접속을 시작하지 않는다');
  assert.equal(h.context.collaborationRejoin, record, '기록은 그대로 둔다');
  assert.equal(record.attempt, 0, '시도하지 않은 차례는 횟수로 세지 않는다');
  const recheck = h.pendingTimers();
  assert.equal(recheck.length, 1);
  assert.equal(recheck[0].delay, h.context.COLLABORATION_REJOIN_BUSY_RECHECK_MS);

  // 그동안 직접 눌러도 접속하지 않고 이유를 알린다. 간격을 쓰지도 않는다.
  h.state.now += h.cooldown;
  h.toasts.length = 0;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 1);
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0].text, /영상을 여는 중/);
  assert.equal(h.toasts[0].force, true);
  assert.equal(h.pendingTimers().length, 1, '다시 볼 차례는 하나뿐이다');

  // 열기가 취소됐다(파일은 그대로). 바로 눌러도 되고, 다시 볼 차례에도 이어서 시도한다.
  h.context.videoLoadInFlightToken = null;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 2);
  assert.equal(h.starts.at(-1).loadToken, 2);
});

test('an attempt that ends without a result is not reported as a failure and keeps its next turn', async () => {
  // (가) 기다리는 사이 다른 접속이 자리를 가져갔다.
  const superseded = createHarness();
  await superseded.openFileAndFailToJoin();
  superseded.state.now += superseded.cooldown;
  superseded.toasts.length = 0;
  superseded.state.joinResult = 'superseded';
  userClick(superseded.chip);
  await flush();
  assert.equal(superseded.counts.enters, 2);
  assert.notEqual(superseded.context.collaborationRejoin, null);
  assert.equal(superseded.pendingTimers().length, 1, '다음 차례를 다시 잡는다');
  assert.match(superseded.label.textContent, /다시 연결/, '"연결 중" 에 멈춰 있으면 안 된다');
  assert.equal(superseded.chip.classList.contains('is-clickable'), true);
  assert.equal(superseded.warnings().length, 0, '실패가 확인된 것이 아니면 실패라고 알리지 않는다');

  // (나) 접속을 기다리는 중에 영상 전환이 시작됐다 취소됐다. 방에는 들어갔지만 앱이 낡은 시도로
  //      보고 끊는다. 재접속이 조용히 멈추면 안 된다.
  for (const outcome of ['connected', 'room-full']) {
    const h = createHarness();
    await h.openFileAndFailToJoin();
    h.state.now += h.cooldown * 2;
    h.state.joinGate = deferred();
    h.state.joinResult = outcome;
    const firing = h.fireTimer();
    await flush();
    assert.equal(h.counts.enters, 2, outcome);
    h.context.latestVideoLoadToken += 1;
    h.state.joinGate.resolve();
    await firing;
    await flush();
    assert.equal(h.manager.isConnected, false, outcome);
    assert.notEqual(h.context.collaborationRejoin, null, outcome);
    assert.equal(h.pendingTimers().length, 1, `${outcome}: 다음 차례가 잡혀 있어야 한다`);
    assert.match(h.label.textContent, /다시 연결/, outcome);
    assert.equal(isShown(h.chip), true, outcome);

    // 결과가 없었어도 접속은 방금 열었다. 바로 누른다고 또 열지 않는다.
    h.toasts.length = 0;
    h.state.now += 1000;
    userClick(h.chip);
    await flush();
    assert.equal(h.counts.enters, 2, `${outcome}: 방금 연 접속은 결과가 없었어도 바로 다시 열지 않는다`);
    assert.equal(h.notices(/잠시 뒤/).length, 1, outcome);
  }
});

test('a rejoin whose record is cleared while it is still reading the file opens no connection', async () => {
  // 재접속이 리뷰 파일을 읽는 사이(공유 드라이브에서는 몇 초) 협업 세션을 끊는 일이 시작됐다.
  // 예: 앱을 끄며 저장하기 시작했다. 파일도 로드 토큰도 그대로라, 기록이 지워진 것을 보지 않으면
  // 끄는 도중에 접속을 새로 열고 "연결되었습니다" 까지 알린다.
  const h = createHarness();
  await h.openFileAndFailToJoin();
  h.state.now += h.cooldown * 2;
  h.toasts.length = 0;
  h.state.loadGate = deferred();
  h.state.joinResult = 'connected';
  const firing = h.fireTimer();
  await flush();
  assert.equal(h.counts.enters, 1, '아직 파일을 읽는 중이다');

  h.context.clearCollaborationRejoin();
  await h.manager.stop();
  h.state.loadGate.resolve();
  await firing;
  await flush();
  assert.equal(h.counts.enters, 1, '기록이 지워진 재접속은 접속을 열지 않는다');
  assert.equal(h.manager.isConnected, false);
  assert.equal(h.toasts.length, 0);
  assert.equal(h.context.collaborationRejoin, null);
  assert.equal(h.pendingTimers().length, 0);
  assert.equal(isShown(h.chip), false);
});

test('a manual attempt that gave way to a newer join does not repeat that join\'s failure notice', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin('room-full');
  h.state.now += h.cooldown;
  const reading = deferred();
  h.state.loadGate = reading;
  userClick(h.chip);
  await flush();
  assert.equal(h.counts.enters, 1, '직접 누른 재접속은 아직 파일을 읽는 중이다');
  h.toasts.length = 0;

  // 그 사이 새로 여는 접속(예: 첫 저장의 접속)이 이 예약을 대신했고, 같은 사유로 실패했다.
  h.state.loadGate = null;
  await h.context.startCollaborationForVideoLoad(h.context.latestVideoLoadToken, 'A.bframe');
  await flush();
  assert.equal(h.counts.enters, 2);
  assert.equal(h.warnings().length, 1, '새 접속이 제 실패를 한 번 알린다');

  reading.resolve();
  await flush();
  assert.equal(h.counts.enters, 2, '자리를 내준 재접속은 접속을 하나 더 열지 않는다');
  assert.equal(h.warnings().length, 1, '같은 실패를 한 번 더 알리지 않는다');
  assert.match(h.label.textContent, /다시 연결/);
  assert.equal(h.chip.classList.contains('is-clickable'), true);
  assert.equal(h.pendingTimers().length, 1);
});

test('a manual attempt never announces the same failure twice', async () => {
  const h = createHarness();
  await h.openFileAndFailToJoin('room-full');
  h.state.now += h.cooldown;
  h.toasts.length = 0;
  h.state.joinResult = 'service-suspended';

  userClick(h.chip);
  await flush();
  const warnings = h.warnings();
  assert.equal(warnings.length, 1, '사유가 바뀌면 그 사유를 한 번만 알린다');
  assert.match(warnings[0].text, /사용 한도/);
  assert.match(h.label.textContent, /서비스 한도/);
});

test('switching files during an attempt says nothing about the old file on the new one', async () => {
  for (const outcome of ['room-full', 'connected']) {
    const h = createHarness();
    await h.openFileAndFailToJoin();
    h.state.now += h.cooldown;
    h.state.joinGate = deferred();
    h.state.joinResult = outcome;
    userClick(h.chip);
    await flush();
    assert.equal(h.counts.enters, 2, outcome);
    h.toasts.length = 0;

    // 다른 파일을 열었다: loadVideo 가 토큰을 올리고, 방을 떠나고, 지난 파일의 기록을 치운다.
    h.context.latestVideoLoadToken += 1;
    h.context.videoLoadInFlightToken = h.context.latestVideoLoadToken;
    await h.manager.stop();
    h.context.clearCollaborationRejoin();
    h.context.reviewDataManager.currentBframePath = 'B.bframe';
    // 새 파일의 방에는 이미 들어가 있다고 하자.
    h.manager.isConnected = true;
    h.manager.roomId = 'room-B';

    h.state.joinGate.resolve();
    await flush();
    assert.equal(h.warnings().length, 0, `${outcome}: 지난 파일의 실패를 새 파일 위에 알리지 않는다`);
    assert.equal(h.notices(/연결되었습니다/).length, 0, `${outcome}: 지난 파일의 재접속이 새 파일의 연결을 제 것처럼 알리지 않는다`);
    assert.equal(h.counts.reloads, 0, outcome);
    assert.equal(h.context.collaborationRejoin, null, outcome);
    assert.equal(isShown(h.chip), false, outcome);
  }
});

test('the sync icon of a connected user still reports status, and falls back to the same rejoin when not connected', async () => {
  const connected = createHarness();
  connected.manager.isConnected = true;
  connected.context.showCollaborationSyncStatus();
  await flush();
  assert.equal(connected.counts.enters, 0);
  assert.equal(connected.notices(/다른 협업자가 없습니다/).length, 1);

  const failed = createHarness();
  await failed.openFileAndFailToJoin();
  failed.state.now += failed.cooldown;
  failed.context.showCollaborationSyncStatus();
  await flush();
  assert.equal(failed.counts.enters, 2);
});

test('the rejoin record is cleared wherever the collaboration session is torn down', () => {
  // 다른 파일을 열 때.
  const switchStart = appSource.indexOf('// ====== 이전 파일 감시 및 협업 세션 정리');
  assert.ok(switchStart >= 0);
  const cleanup = appSource.slice(switchStart, appSource.indexOf('// ====== 이전 데이터 초기화', switchStart));
  assert.ok(cleanup.includes('updateCollaboratorsUI([]);'));
  assert.ok(cleanup.includes('clearCollaborationRejoin();'),
    '지난 파일의 재접속 표시가 새 파일 위에 남으면 안 된다');

  // 앱을 끄며 저장하는 동안. 저장이 느린 사이 재접속 차례가 와서 접속을 새로 열면 안 된다.
  const quitStart = appSource.indexOf('attempt.collaborationStopped = true;');
  assert.ok(quitStart >= 0);
  const quit = appSource.slice(quitStart, appSource.indexOf('await liveblocksManager.stop();', quitStart));
  assert.ok(quit.includes('clearCollaborationRejoin();'));
});

// 표시의 글자가 바탕에서 읽히는지(작은 글씨의 권장 대비 4.5:1). 밝은 테마의 경고색(--warning)은
// 어두운 테마의 값(밝은 노랑)을 그대로 물려받아, 밝은 바탕에서는 거의 보이지 않는다.
test('the chip text is readable on its background in both themes', () => {
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = mainCss.match(new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm'));
    assert.ok(match, `main.css 에 ${selector} 규칙이 있어야 한다`);
    return match[1];
  };
  const declared = (body, property) => {
    const match = body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`));
    return match ? match[1].trim() : null;
  };
  const variables = (body) => Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  const dark = variables(block(':root'));
  const light = { ...dark, ...variables(block(':root.light-mode')) };
  const resolve = (value, theme) => {
    const reference = /^var\((--[\w-]+)\)$/.exec(value || '');
    const resolved = reference ? theme[reference[1]] : value;
    assert.match(resolved || '', /^#[0-9a-f]{6}$/i, `색을 알 수 없다: ${value}`);
    return resolved;
  };
  const luminance = (hex) => {
    const [red, green, blue] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrast = (first, second) => {
    const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (high + 0.05) / (low + 0.05);
  };

  const base = block('.collab-status-chip');
  const hover = block('.collab-status-chip.is-clickable:hover');
  const joining = block('.collab-status-chip.is-joining');
  const lightOverride = block('.light-mode .collab-status-chip:not(.is-joining)');
  const cases = [
    ['어두운 테마', resolve(declared(base, 'color'), dark), dark],
    ['어두운 테마 · 연결 중', resolve(declared(joining, 'color'), dark), dark],
    ['밝은 테마', resolve(declared(lightOverride, 'color') || declared(base, 'color'), light), light],
    ['밝은 테마 · 연결 중', resolve(declared(joining, 'color'), light), light]
  ];
  for (const [name, color, theme] of cases) {
    for (const background of [declared(base, 'background'), declared(hover, 'background')]) {
      const ratio = contrast(color, resolve(background, theme));
      assert.ok(ratio >= 4.5, `${name}: 글자 ${color} 와 바탕 ${resolve(background, theme)} 의 대비가 ${ratio.toFixed(2)}:1 이다`);
    }
  }
});
