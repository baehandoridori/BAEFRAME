const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootDir = path.resolve(__dirname, '../..');
const read = relativePath =>
  fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');
const {
  FABRIC_ONION_SKIN_MAX_SHEETS,
  FABRIC_ONION_SKIN_MIN_OPACITY_PERCENT,
  FABRIC_ONION_SKIN_MAX_OPACITY_PERCENT,
  FABRIC_ONION_SKIN_DEFAULT_PREFS,
  normalizeFabricOnionSkinPrefs
} = require(path.join(rootDir, 'shared/fabric-onion-skin-prefs.js'));
const {
  createFabricOverlayRuntime
} = require(path.join(rootDir, 'renderer/scripts/modules/mpv-fabric-overlay-runtime.js'));

const userSettingsSource = read('renderer/scripts/modules/user-settings.js');
const appSource = read('renderer/scripts/app.js');
const ipcHandlersSource = read('main/ipc-handlers.js');
const overlayPreloadSource = read('preload/mpv-overlay-preload.js');
const mainPreloadSource = read('preload/preload.js');
const packageJson = JSON.parse(read('package.json'));

const validPrefs = () => ({ enabled: true, before: 3, after: 0, opacityPercent: 45 });

// 설정 값을 다루는 부분만 본다. DOM 을 만들지 않아도 값 적용과 조회는 동작한다.
function createOnionRuntime(options = {}) {
  return createFabricOverlayRuntime({
    fabric: { Canvas: class {}, Path: class {} },
    document: { createElement: () => ({}) },
    ...options
  });
}

// user-settings.js 는 브라우저 ES 모듈이다. import 를 걷어 내고 같은 소스를 그대로 돌린다.
function loadUserSettings({ stored = null } = {}) {
  const saved = [];
  const storage = new Map(stored ? [['baeframe_user_settings', JSON.stringify(stored)]] : []);
  const source = userSettingsSource
    .replace(/^import [^\n]+\n/gm, '')
    .replace(/^export default [^\n]+\n/m, '')
    .replace(/^export /gm, '');
  const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
  const { UserSettings } = new Function(
    'createLogger',
    'getAuthManager',
    'normalizeEraserMode',
    'localStorage',
    'window',
    'document',
    `${source}\nreturn { UserSettings };`
  )(
    () => noopLogger,
    () => ({}),
    mode => (mode === 'stroke' ? 'stroke' : 'pixel'),
    {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => {
        storage.set(key, value);
        saved.push(JSON.parse(value));
      }
    },
    {},
    { readyState: 'complete', addEventListener() {} }
  );
  return { settings: new UserSettings(), saved };
}

test('onion skin settings cross process boundaries only in one exact normalized form', () => {
  const prefs = validPrefs();
  const normalized = normalizeFabricOnionSkinPrefs(prefs);
  assert.deepEqual(normalized, prefs);
  // 검증을 통과한 값은 새 객체다. 호출자가 나중에 고쳐도 건너간 값은 바뀌지 않는다.
  assert.notEqual(normalized, prefs);
  assert.deepEqual(
    normalizeFabricOnionSkinPrefs({ ...FABRIC_ONION_SKIN_DEFAULT_PREFS }),
    { enabled: false, before: 2, after: 1, opacityPercent: 30 }
  );

  const throwing = {};
  Object.defineProperty(throwing, 'enabled', {
    enumerable: true,
    get() {
      throw new Error('accessor');
    }
  });
  for (const [label, malformed] of [
    ['null', null],
    ['배열', []],
    ['문자열', 'on'],
    ['빠진 키', { enabled: true, before: 2, after: 1 }],
    ['남는 키', { ...prefs, playing: true }],
    ['클래스 인스턴스', Object.assign(new (class Prefs {})(), prefs)],
    ['프로토타입 없는 객체', Object.assign(Object.create(null), prefs)],
    ['던지는 접근자', Object.assign(throwing, { before: 2, after: 1, opacityPercent: 30 })],
    ['숫자 켜짐', { ...prefs, enabled: 1 }],
    ['음수 장수', { ...prefs, before: -1 }],
    ['너무 많은 장수', { ...prefs, after: FABRIC_ONION_SKIN_MAX_SHEETS + 1 }],
    ['소수 장수', { ...prefs, before: 1.5 }],
    ['문자열 장수', { ...prefs, after: '1' }],
    ['낮은 진하기', { ...prefs, opacityPercent: FABRIC_ONION_SKIN_MIN_OPACITY_PERCENT - 1 }],
    ['높은 진하기', { ...prefs, opacityPercent: FABRIC_ONION_SKIN_MAX_OPACITY_PERCENT + 1 }],
    ['0~1 진하기', { ...prefs, opacityPercent: 0.3 }]
  ]) {
    assert.equal(normalizeFabricOnionSkinPrefs(malformed), null, label);
  }
});

test('whatever the onion skin runtime reports is accepted by the boundary validator', () => {
  const runtime = createOnionRuntime();
  const pick = state => ({
    enabled: state.enabled,
    before: state.before,
    after: state.after,
    opacityPercent: state.opacityPercent
  });
  // 처음 상태는 공유 모듈의 기본값이다.
  assert.deepEqual(pick(runtime.getOnionSkinState()), { ...FABRIC_ONION_SKIN_DEFAULT_PREFS });
  assert.deepEqual(
    normalizeFabricOnionSkinPrefs(pick(runtime.getOnionSkinState())),
    pick(runtime.getOnionSkinState())
  );

  const applied = runtime.applyOnionSkinPrefs(validPrefs());
  assert.deepEqual(applied, { accepted: true, ...validPrefs() });
  assert.deepEqual(pick(runtime.getOnionSkinState()), validPrefs());

  // 한도를 벗어난 값은 잘라 넣고, 그 결과도 검증기를 통과한다.
  const clamped = createOnionRuntime().applyOnionSkinPrefs({
    enabled: true, before: 99, after: -4, opacityPercent: 500
  });
  assert.equal(clamped.accepted, true);
  assert.equal(clamped.before, FABRIC_ONION_SKIN_MAX_SHEETS);
  assert.equal(clamped.after, 0);
  assert.equal(clamped.opacityPercent, FABRIC_ONION_SKIN_MAX_OPACITY_PERCENT);
  const { accepted: _accepted, ...clampedPrefs } = clamped;
  assert.deepEqual(normalizeFabricOnionSkinPrefs(clampedPrefs), clampedPrefs);
});

test('restoring saved onion skin settings is not reported back as a change', () => {
  const notified = [];
  const runtime = createOnionRuntime({
    onionSkinPrefsBridge: { notify: prefs => { notified.push(prefs); return true; } }
  });
  assert.equal(runtime.applyOnionSkinPrefs(validPrefs()).accepted, true);
  // 받은 값은 저장 쪽이 이미 알고 있다. 되받아 알리면 저장이 헛돈다.
  assert.deepEqual(notified, []);
  // 같은 값을 다시 받아도(오버레이가 받을 수 있는 상태가 될 때마다 심는다) 그대로다.
  assert.equal(runtime.applyOnionSkinPrefs(validPrefs()).accepted, true);
  assert.deepEqual(notified, []);
});

test('user settings keep the onion skin settings in the shape the overlay accepts', () => {
  const { settings, saved } = loadUserSettings();
  assert.deepEqual(settings.getFabricOnionSkinPrefs(), { ...FABRIC_ONION_SKIN_DEFAULT_PREFS });
  assert.equal(settings.hasCustomFabricOnionSkinPrefs(), false, '기본값 그대로면 심을 것이 없다');

  const prefs = validPrefs();
  settings.setFabricOnionSkinPrefs(prefs);
  assert.deepEqual(settings.getFabricOnionSkinPrefs(), prefs);
  assert.equal(settings.hasCustomFabricOnionSkinPrefs(), true);
  assert.deepEqual(saved.at(-1).drawingOnionSkin, prefs, '설정 파일에 적는다');
  assert.deepEqual(normalizeFabricOnionSkinPrefs(settings.getFabricOnionSkinPrefs()), prefs);

  // 손으로 고친 값·일부만 남은 값이 들어 있어도 꺼내 줄 때는 오버레이가 받는 형식이다.
  for (const drawingOnionSkin of [
    {},
    null,
    { enabled: 'yes' },
    { enabled: true, before: 99, after: -3, opacityPercent: 1000 },
    { enabled: true, before: '3', after: 1.9, opacityPercent: 'abc' },
    { before: null, after: undefined, opacityPercent: NaN }
  ]) {
    const loaded = loadUserSettings({ stored: { drawingOnionSkin } }).settings.getFabricOnionSkinPrefs();
    assert.deepEqual(
      normalizeFabricOnionSkinPrefs(loaded),
      loaded,
      JSON.stringify(drawingOnionSkin)
    );
  }
  const extreme = loadUserSettings({
    stored: { drawingOnionSkin: { enabled: true, before: 99, after: -3, opacityPercent: 1 } }
  }).settings.getFabricOnionSkinPrefs();
  assert.deepEqual(extreme, {
    enabled: true,
    before: FABRIC_ONION_SKIN_MAX_SHEETS,
    after: 0,
    opacityPercent: FABRIC_ONION_SKIN_MIN_OPACITY_PERCENT
  });
  // 이 설정이 없던 예전 설정 파일을 읽어도 기본값이 나온다.
  const legacy = loadUserSettings({ stored: { userName: '예전 사용자' } }).settings;
  assert.deepEqual(legacy.getFabricOnionSkinPrefs(), { ...FABRIC_ONION_SKIN_DEFAULT_PREFS });
  assert.equal(legacy.hasCustomFabricOnionSkinPrefs(), false);
});

test('the main window stores overlay onion skin changes and replays them when the overlay is ready', () => {
  // 오버레이에서 온 값은 모아서 사용자 설정에 적는다.
  assert.match(
    appSource,
    /const fabricOnionSkinPrefsSaver = createFabricPalettePrefsSaver\(\{\n\s+save: prefs => userSettings\.setFabricOnionSkinPrefs\(prefs\)\n\s+\}\);/
  );
  assert.match(
    appSource,
    /window\.electronAPI\?\.onFabricDrawingOnionSkinPrefs\?\.\(prefs => \{\n\s+fabricOnionSkinPrefsSaver\.push\(prefs\);\n\s+\}\);/
  );
  // 메인 창이 닫힐 때 아직 적지 못한 값을 적는다.
  assert.match(
    appSource,
    /window\.addEventListener\('beforeunload', \(\) => \{\n\s+fabricOnionSkinPrefsSaver\.flush\(\);\n\s+\}\);/
  );
  // 어니언 스킨은 그리기 패널을 닫아 둔 채로도 쓴다 — 보기·그리기 어느 쪽이든 오버레이가
  // 받을 수 있는 상태가 되면 심는다(오버레이 창이 새로 만들어졌을 수 있다).
  assert.match(
    appSource,
    /if \(nextState === 'active' \|\| nextState === 'passive'\) \{\n\s+pushFabricPilotOnionSkinPrefs\(\);\n\s+syncFabricOnionSkinPlayback\(\);\n\s+\}/
  );
  // 심는 일은 따로 시험하는 모듈이 맡는다(아래). 여기서는 그 모듈에 맞는 것을 이었는지 본다.
  assert.match(
    appSource,
    /const fabricOnionSkinPrefsPusher = createFabricOnionSkinPrefsPusher\(\{\n\s+apply: prefs => window\.electronAPI\.mpvApplyOverlayOnionSkinPrefs\(prefs\),\n\s+flush: \(\) => fabricOnionSkinPrefsSaver\.flush\(\),\n\s+getPrefs: \(\) => userSettings\.getFabricOnionSkinPrefs\(\),\n\s+hasCustomPrefs: \(\) => userSettings\.hasCustomFabricOnionSkinPrefs\(\)\n\s+\}\);/
  );
  assert.match(
    appSource,
    /function pushFabricPilotOnionSkinPrefs\(\) \{\n\s+if \(typeof window\.electronAPI\?\.mpvApplyOverlayOnionSkinPrefs !== 'function'\) return;\n\s+fabricOnionSkinPrefsPusher\.push\(\);\n\s+\}/
  );
});

async function loadPrefsPusher() {
  return import(
    pathToFileURL(path.join(rootDir, 'renderer/scripts/modules/fabric-onion-skin-prefs-pusher.js')).href
  );
}

// 심는 쪽의 사정을 흉내 낸다: 보존된 값, 아직 적지 못한 값, 오버레이의 답, 타이머.
function createPusherHarness(overrides = {}) {
  const state = {
    stored: validPrefs(),
    pendingSave: null,
    answers: [],
    applied: [],
    order: [],
    timers: []
  };
  const isDefault = prefs => Object.keys(FABRIC_ONION_SKIN_DEFAULT_PREFS)
    .every(key => prefs[key] === FABRIC_ONION_SKIN_DEFAULT_PREFS[key]);
  const options = {
    apply: async prefs => {
      state.order.push('apply');
      state.applied.push({ ...prefs });
      const answer = state.answers.length > 0 ? state.answers.shift() : { success: true, accepted: true };
      if (answer instanceof Error) throw answer;
      return answer;
    },
    flush: () => {
      state.order.push('flush');
      if (state.pendingSave) {
        state.stored = state.pendingSave;
        state.pendingSave = null;
      }
    },
    getPrefs: () => ({ ...state.stored }),
    hasCustomPrefs: () => !isDefault(state.stored),
    setTimer: (callback, delay) => { state.timers.push({ callback, delay }); },
    ...overrides
  };
  const flushMicrotasks = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };
  const runNextTimer = async () => {
    const timer = state.timers.shift();
    assert.ok(timer, '기다리는 재시도가 있어야 한다');
    timer.callback();
    await flushMicrotasks();
    return timer.delay;
  };
  return { state, options, flushMicrotasks, runNextTimer };
}

test('saved onion skin settings are planted once the unsaved change is written, and only if not default', async () => {
  const { createFabricOnionSkinPrefsPusher } = await loadPrefsPusher();
  const harness = createPusherHarness();
  const pusher = createFabricOnionSkinPrefsPusher(harness.options);

  // 아직 적지 못한 변경이 있으면 먼저 적고, 그 값을 보낸다.
  harness.state.pendingSave = { enabled: true, before: 5, after: 2, opacityPercent: 70 };
  pusher.push();
  await harness.flushMicrotasks();
  assert.deepEqual(harness.state.order, ['flush', 'apply']);
  assert.deepEqual(harness.state.applied, [{ enabled: true, before: 5, after: 2, opacityPercent: 70 }]);
  assert.deepEqual(harness.state.timers, [], '오버레이가 받았으면 다시 보내지 않는다');

  // 사용자가 그 오버레이에서 이미 값을 바꿔 거절한 것도 "답"이다. 다시 보내지 않는다.
  harness.state.answers.push({ success: true, accepted: false, reason: 'local-changes' });
  pusher.push();
  await harness.flushMicrotasks();
  assert.equal(harness.state.applied.length, 2);
  assert.deepEqual(harness.state.timers, []);

  // 기본값 그대로면 새 오버레이와 같다. 보낼 것이 없다.
  harness.state.stored = { ...FABRIC_ONION_SKIN_DEFAULT_PREFS };
  pusher.push();
  await harness.flushMicrotasks();
  assert.equal(harness.state.applied.length, 2);
  assert.deepEqual(harness.state.timers, []);
});

test('a planting that never reached the overlay is retried a few times and then given up', async () => {
  const { createFabricOnionSkinPrefsPusher, FABRIC_ONION_SKIN_PREFS_RETRY_DELAYS_MS } =
    await loadPrefsPusher();
  assert.deepEqual([...FABRIC_ONION_SKIN_PREFS_RETRY_DELAYS_MS], [500, 1500, 4000]);

  // 오버레이가 아직 준비되지 않았다(낡은 요청으로 버려졌다) → 전송 실패 → 그다음에 닿는다.
  const harness = createPusherHarness();
  const pusher = createFabricOnionSkinPrefsPusher(harness.options);
  harness.state.answers.push(
    { success: false, accepted: false, error: 'stale onion skin prefs' },
    new Error('channel closed'),
    { success: true, accepted: true }
  );
  pusher.push();
  await harness.flushMicrotasks();
  assert.equal(harness.state.applied.length, 1);
  assert.equal(await harness.runNextTimer(), 500);
  assert.equal(harness.state.applied.length, 2);
  assert.equal(await harness.runNextTimer(), 1500);
  assert.equal(harness.state.applied.length, 3);
  assert.deepEqual(harness.state.timers, [], '닿았으면 그만둔다');

  // 끝내 닿지 못하면 정해 둔 횟수에서 멈춘다(처음 한 번 + 재시도 세 번).
  const failing = createPusherHarness();
  const failingPusher = createFabricOnionSkinPrefsPusher(failing.options);
  for (let index = 0; index < 10; index += 1) failing.state.answers.push({ success: false });
  failingPusher.push();
  await failing.flushMicrotasks();
  assert.deepEqual(
    [await failing.runNextTimer(), await failing.runNextTimer(), await failing.runNextTimer()],
    [500, 1500, 4000]
  );
  assert.equal(failing.state.applied.length, 4);
  assert.deepEqual(failing.state.timers, []);
});

test('a retry sends what is stored by then, and a newer planting replaces an older retry', async () => {
  const { createFabricOnionSkinPrefsPusher } = await loadPrefsPusher();

  // 재시도를 기다리는 사이에 사용자가 값을 바꿨다. 그때 보존된 값을 보낸다.
  const harness = createPusherHarness();
  const pusher = createFabricOnionSkinPrefsPusher(harness.options);
  harness.state.answers.push({ success: false }, { success: true, accepted: false, reason: 'local-changes' });
  pusher.push();
  await harness.flushMicrotasks();
  harness.state.pendingSave = { enabled: false, before: 1, after: 1, opacityPercent: 50 };
  await harness.runNextTimer();
  assert.deepEqual(harness.state.applied.at(-1), { enabled: false, before: 1, after: 1, opacityPercent: 50 });

  // 그 사이 기본값으로 돌아갔으면 보낼 것이 없다.
  const reverted = createPusherHarness();
  const revertedPusher = createFabricOnionSkinPrefsPusher(reverted.options);
  reverted.state.answers.push({ success: false });
  revertedPusher.push();
  await reverted.flushMicrotasks();
  reverted.state.pendingSave = { ...FABRIC_ONION_SKIN_DEFAULT_PREFS };
  await reverted.runNextTimer();
  assert.equal(reverted.state.applied.length, 1);
  assert.deepEqual(reverted.state.timers, []);

  // 오버레이가 받을 수 있는 상태가 다시 됐다(새로 push). 앞선 재시도는 그만둔다.
  const replaced = createPusherHarness();
  const replacedPusher = createFabricOnionSkinPrefsPusher(replaced.options);
  replaced.state.answers.push({ success: false }, { success: true, accepted: true });
  replacedPusher.push();
  await replaced.flushMicrotasks();
  assert.equal(replaced.state.timers.length, 1);
  replacedPusher.push();
  await replaced.flushMicrotasks();
  assert.equal(replaced.state.applied.length, 2);
  await replaced.runNextTimer();
  assert.equal(replaced.state.applied.length, 2, '낡은 재시도는 보내지 않는다');
  assert.deepEqual(replaced.state.timers, []);

  // 적는 쪽이 던져도 호출자를 죽이지 않는다.
  const throwing = createPusherHarness({ flush: () => { throw new Error('disk full'); } });
  const throwingPusher = createFabricOnionSkinPrefsPusher(throwing.options);
  assert.doesNotThrow(() => throwingPusher.push());
  await throwing.flushMicrotasks();
  assert.equal(throwing.state.applied.length, 0);

  assert.throws(() => createFabricOnionSkinPrefsPusher({}), /apply, getPrefs and hasCustomPrefs/);
});

test('main process onion skin channels check the sender and validate before forwarding', () => {
  const prefsHandler = ipcHandlersSource.match(
    /ipcMain\.on\('mpv-overlay:onion-skin-prefs', \(event, value\) => \{[\s\S]*?\n  \}\);/
  );
  assert.ok(prefsHandler, '어니언 스킨 설정 채널 처리기가 있어야 한다');
  // 오버레이 창이 보낸 것만, 검증을 거친 값만 메인 렌더러로 넘긴다.
  assert.match(prefsHandler[0], /!mpvOverlayHost\.isCurrentOverlaySender\(event\)/);
  assert.match(prefsHandler[0], /const normalized = normalizeFabricOnionSkinPrefs\(value\);\n\s+if \(!normalized\) return;/);
  assert.match(prefsHandler[0], /mainWebContents\.send\('fabric-drawing:onion-skin-prefs', normalized\);/);
  assert.doesNotMatch(prefsHandler[0], /send\('fabric-drawing:onion-skin-prefs', value\)/);

  // 저장값을 오버레이에 심는 요청은 메인 렌더러만 할 수 있다(invokeFabricDrawingHost 가 확인한다).
  assert.match(
    ipcHandlersSource,
    /ipcMain\.handle\('mpv:apply-overlay-onion-skin-prefs', \(event, prefs\) =>\n\s+invokeFabricDrawingHost\(event, \(\) => mpvOverlayHost\.applyDrawingOnionSkinPrefs\(prefs\)\)\);/
  );
});

test('both preloads validate onion skin settings before they cross', () => {
  // 오버레이 → 메인 프로세스
  assert.match(
    overlayPreloadSource,
    /contextBridge\.exposeInMainWorld\('mpvOverlayOnionSkinPrefs', Object\.freeze\(\{\n\s+notify\(value\) \{\n\s+const prefs = normalizeFabricOnionSkinPrefs\(value\);\n\s+if \(!prefs\) return false;\n\s+try \{\n\s+ipcRenderer\.send\(ONION_SKIN_PREFS_CHANNEL, prefs\);/
  );
  assert.match(overlayPreloadSource, /const ONION_SKIN_PREFS_CHANNEL = 'mpv-overlay:onion-skin-prefs';/);
  // 메인 프로세스 → 메인 렌더러, 메인 렌더러 → 메인 프로세스
  assert.match(
    mainPreloadSource,
    /onFabricDrawingOnionSkinPrefs: \(callback\) => \{[\s\S]{0,260}?const prefs = normalizeFabricOnionSkinPrefs\(value\);\n\s+if \(prefs\) callback\(prefs\);/
  );
  assert.match(
    mainPreloadSource,
    /mpvApplyOverlayOnionSkinPrefs: \(value\) => \{\n\s+const prefs = normalizeFabricOnionSkinPrefs\(value\);\n\s+if \(!prefs\) return Promise\.resolve\(\{ success: false, accepted: false, error: 'invalid onion skin prefs' \}\);\n\s+return ipcRenderer\.invoke\('mpv:apply-overlay-onion-skin-prefs', prefs\);/
  );
});

test('drawing test script includes the onion skin settings coverage', () => {
  assert.match(packageJson.scripts['test:drawing'], /fabric-onion-skin-prefs\.test\.js/);
});
