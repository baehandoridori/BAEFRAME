# 추가 조사: 종료·파일 전환·저장 경계

2026-09-06 · 현재 main `d72f6b7a87af9e5805eb03a0e0a6017bba999f32` · `2.9.0-beta`

기존 보고서 15개와 다른 신규 발견 두 건이다. 제품 코드·사용자 파일은 수정하지 않았고, 앱 조작·실제 디스크 쓰기·외부 전송을 하지 않았다. 아래 두 건의 확인 수준은 **현행 소스 + 독립 함수 실행**이다. 실제 UI 재현이나 실제 저장 파일 손상 확인으로 읽으면 안 된다.

## A. 기본 창 닫기는 종료 전 저장 확인을 거치지 않는다

**P1 · 실제 구현 결함 · 높은 코드 확신, 네이티브 조작 미실시**

**사용자 영향:** 제목 표시줄의 X 등으로 창을 닫을 때, 아직 자동 저장을 기다리는 마지막 댓글·그림이나 저장 실패 후 메모리에 남은 변경을 최종 저장하거나 취소할 기회가 없다. 이미 저장된 내용을 지우는 문제라는 뜻은 아니다. 자동 저장이 끝나기 전 또는 실패 상태에서 닫아야 실제 미저장 내용의 유실 위험이 생긴다.

**현재 경로:**

- `main/window.js:135–149`는 `frame: true`인 기본 네이티브 창을 생성한다.
- `main/window.js:298–300`의 `closeWindow()`도 `mainWindow.close()`만 호출한다. `main/ipc-handlers.js:1023–1025`와 `preload/preload.js:242`의 창 닫기 API가 이 경로로 이어진다.
- 창이 닫힌 뒤 `main/window.js:214–216`의 `closed` 핸들러가 `mainWindow = null`로 만든다. 이 파일에는 닫기 직전에 저장을 기다리는 `close` 핸들러가 없다.
- `renderer/scripts/app.js:1492–1499`의 `beforeunload`는 감시·협업 잠금 정리만 한다. 저장 요청, dirty 검사, `event.returnValue`/종료 차단이 없다.
- `main/index.js:551–561`은 모든 창이 닫힌 뒤 `app.quit()`를 부른다. 저장 요청은 이후 `before-quit`의 `603–606`에서 살아 있는 메인 창이 있을 때만 보낸다. 이미 창이 없으면 `614–617`에서 `forceQuit`로 진행한다.
- 실제 최종 드로잉 회수·진행 중 저장 대기·저장 실패 선택은 `renderer/scripts/app.js:15421–15513`에 있지만, 그 핸들러를 부르는 `app:request-save-before-quit`가 이 창 닫기 경로에서는 전달되지 않는다.
- 등록된 변경의 일반 자동 저장 지연은 `renderer/scripts/modules/review-data-manager.js:901`의 500ms이며, `3138–3147`에서 타이머가 저장한다. 창 닫기의 최종 저장을 대신하는 보장이 아니다.

**이벤트 순서 근거:** 설치된 Electron 자체 API 주석 `node_modules/electron/electron.d.ts:2724–2729`는 `BrowserWindow.close()`와 사용자가 닫기 버튼을 누르는 동작이 같다고 설명한다. `2127–2149`는 close→DOM beforeunload/unload→closed 단계와 취소 지점을, `1030–1037`은 `window-all-closed`가 모든 창이 닫힌 뒤임을, `1469–1475`는 명시적인 `app.quit()`가 먼저 before-quit를 발생시킴을 설명한다. 루트 조사자가 [Electron app 공식 문서](https://www.electronjs.org/docs/latest/api/app)로도 이 순서 차이를 확인했다.

**실행 결과:** 원본 `closed`, `closeWindow`, renderer `beforeunload`, main 종료 핸들러를 문자열 그대로 VM에서 실행했다. 외부 Electron 객체가 문서화된 순서로 이벤트를 전달하는 모형에서는 최종 `mainWindow=null`, 저장 요청 0회, 종료 허용으로 끝났다. 반대로 메인 창이 살아 있을 때 명시적인 `app.quit()`를 호출하면 저장 요청 1회가 전달되고 종료가 차단된다. 취소 응답 후 창과 상태가 유지되고, 확인 응답 후에는 mpv 정리를 거쳐 종료되는 정상 경로도 실행했다.

**추가 보호 틈:** 같은 원본 핸들러에 첫 저장 요청이 아직 응답하지 않은 상태로 `app.quit()`를 다시 전달하면 `isQuitting=true` 때문에 두 번째 요청에는 `preventDefault()`가 호출되지 않는다(`main/index.js:588–619`). 이 결과는 함수 수준이며, 별도 사용자 동작의 빈도나 네이티브 재현을 주장하지 않는다. 같은 종료 승인 상태 관리에서 함께 확인할 사항으로만 기록한다.

**반대 사례·한계:** 이미 자동 저장이 완료된 파일은 이 경로만으로 데이터가 잃어버려졌다고 말할 수 없다. `app.quit()`를 먼저 호출한 정상 종료에는 저장 확인이 있다. .bframe 복구·CAS 저장 보호가 없는 것도 아니다. 이번 검사는 운영 앱을 닫거나 재열지 않았고, 실제 유실량·빈도를 측정하지 않았다. 테스트가 Electron 이벤트 순서 자체를 발견한 것이 아니라, 로컬 API 계약의 순서를 전달했을 때 현재 핸들러가 저장을 요청하는지 확인한 것이다.

**개선 방향:** 창이 실제로 파괴되기 전 닫기 요청을 기존 저장 승인 절차로 연결하고, 저장/명시적 포기 응답 전에는 추가 닫기·종료 요청도 보류한다. 종료 취소 시 편집과 자동 저장·협업을 복구한다.

**수용 기준:** X와 Alt+F4로 마지막 변경 직후 닫기, 저장 실패 중 닫기, 저장 지연 중 반복 닫기를 각각 검사한다. 저장 또는 사용자의 명시적 포기 전에는 창이 사라지지 않아야 하고, 취소하면 같은 내용으로 계속 작업할 수 있어야 한다. 다음 구현에서 실제 앱 종료·재열기 검증이 필요하다.

## B. 이전 재생목록의 늦은 저장 완료가 새 목록의 저장 경로를 바꾼다

**P1 · 실제 구현 결함 · 실제 클래스의 경합 재현, 실제 디스크 쓰기 미실시**

**사용자 영향:** A 재생목록의 저장이 아직 끝나지 않았을 때 B 재생목록을 열고 작업하면, 뒤늦은 A 저장 완료가 현재 B의 저장 경로를 A로 바꾸고 미저장 표시도 지울 수 있다. 다음 B 변경의 자동 저장이 A 파일을 대상으로 요청되어 기존 목록을 덮어쓸 위험이 있다. 영상 파일 자체나 .bframe 댓글 파일을 덮어썼다는 주장은 아니다.

**현재 경로:**

- `renderer/scripts/app.js:21160–21186`은 목록 수정 후 2초 타이머로 `playlistManager.save()`를 부른다. 실행 중 저장에 대한 공유 Promise/열기 대기 장치는 여기 없다.
- `renderer/scripts/modules/playlist-manager.js:303–329`의 `save()`는 로컬 `targetPath`를 정한 뒤 `await writePlaylist(...)`한다. 완료 후 현재 목록/열기 토큰/변경 revision이 같은지 검사하지 않고 `this.playlistPath = targetPath; this.isModified = false`를 실행한다.
- 사용자가 다른 목록을 열면 `renderer/scripts/app.js:1077–1098`이 `playlistManager.open()`을 부른다. `playlist-manager.js:201–210`은 이전 목록을 별도로 저장하고, `257–262`에서 새 목록·새 경로를 적용한다. 앞서 시작한 `save()`의 완료를 기다리거나 무효화하지 않는다.
- `open()` 자신의 저장은 `208–210`에 객체·경로 동일성 검사가 있고, 열기는 `196–198,207,214,231,274–282`의 토큰 보호가 있다. 이 보호가 별도로 진행 중인 `save()`의 `328–329`에는 적용되지 않는 것이 차이다.
- `renderer/scripts/app.js:1009–1011,1035–1043`의 배경 작업 무효화는 재생/전환 토큰만 바꾸며 저장 소유권을 바꾸지 않는다. `21148–21158`의 목록 로드 콜백 역시 늦은 저장을 취소하지 않는다.
- `preload/preload.js:433–435`는 독립 IPC 호출이다. `main/ipc-handlers.js:2614–2622`는 받은 경로에 JSON을 `writeFile`한다. .bframe의 CAS 보호 경로와 별개다.

**실행 결과:** 현재 `PlaylistManager` 모듈 전체를 원본 파일에서 직접 import했다. A의 첫 `save()`에 대한 쓰기 응답만 보류하고, 실제 `open(B)`의 두 번째 A 쓰기와 B 읽기를 완료했다. 그 시점까지는 B 목록/B 경로로 정상이다. B 이름을 수정한 뒤 첫 A 저장 응답을 풀면 다음 상태가 됐다.

```json
{"id":"B","name":"B-new","path":"C:/audit/A.bplaylist","isModified":false}
```

이후 실제 `setName()`과 `save()`를 호출한 쓰기 요청은 `target=C:/audit/A.bplaylist`, `data.id=B`였다. IPC 경계에서 저장할 데이터를 즉시 `structuredClone`해 실제 invoke의 인자 복사와 같은 분리 조건을 유지했다. 외부 요청과 파일 쓰기는 없었다.

**반대 사례·한계:** A 저장을 완료한 뒤 B를 순차적으로 열면 B 경로가 유지된다. `save()`의 쓰기가 reject되면 원래 경로와 dirty 상태가 유지된다. `open(B)` 전 A 저장이 reject되면 A가 유지되고 B로 넘어가지 않는다. 이 세 정상/실패 보호를 실행했다. 문제 조건은 오래 걸린 이전 저장의 완료가 새 목록 적용보다 늦는 경우다. 비동기 IPC 완료 순서를 통제한 재현이며, 실제 저장장치에서의 발생 빈도와 실제 파일 손상을 측정하지 않았다. 모듈의 저장·열기·수정 함수는 교체하지 않았다. 생략한 앱 UI 콜백은 표시·사전 준비용이며 소스상 저장 소유권 보호가 아니다.

**개선 방향:** 저장 시작 시 대상 목록·경로·열기 토큰·변경 revision을 함께 고정한다. 완료 시 동일 대상의 동일 revision에만 저장 완료를 적용하고, 다른 목록을 여는 동안 이전 저장을 안전하게 완료하거나 분리한다. 오래된 성공 응답이 새 목록의 경로·dirty 상태를 바꾸지 않게 한다.

**수용 기준:** A 저장을 지연시킨 상태에서 B를 열고 이름·순서를 바꾼 뒤 A 응답을 완료해도, 현재 경로는 B이고 B의 미저장 표시가 유지되어야 한다. 다음 자동 저장은 B 경로만 대상으로 한다. 순차 저장, 실제 저장 실패, 빠른 반복 목록 열기도 계속 보호해야 한다.

## 범위·검증 기록

- 기존 I05의 댓글 위치 지정 취소, I06의 비동기 재생 엔진 전환과 다른 경로다. 신규 두 건은 창 종료 승인과 `.bplaylist` 저장 소유권 문제다.
- 일반 영상 전환에는 `renderer/scripts/app.js:10411–10423,10426–10474`의 저장 실패 확인·Fabric 입력 차단·최종 저장 보호가 있다. `ReviewDataManager.setVideoFile()`의 단독 미검사 저장만 보고 현행 사용자 전환을 결함으로 올리지 않았다. 현재 앱 호출은 그 보호 뒤 `skipSave`를 사용한다(`10846–10855`).
- 별도의 `.bframe` 다른 이름으로 저장 UI는 이번 범위에서 확인하지 못했다. 기능 부재를 신규 결함으로 올리지 않았다. 재생목록 이름 변경은 `setName()`과 자동 저장 경로를 대조했다. 파일 삭제/이름 변경에 대한 추가 추측은 최종 두 건에 포함하지 않았다.
- 하네스 최초 실행은 추출 끝점의 주석 문구를 잘못 지정해 **하네스 오류**로 exit 1 / pass 0 / fail 1 / cancelled 0이었다. 제품 함수를 바꾸지 않고 다음 주석의 시작으로 추출 끝점을 바로잡았다. 이후 최종 실행은 **exit 0 / pass 8 / fail 0 / cancelled 0 / skipped 0**, 약 100ms였다. 통과는 결함 조건과 반대 사례가 예상대로 관찰됐다는 뜻이며 제품 수정 통과가 아니다.
- TEMP 원본 위치: `%TEMP%\baeframe-ux-20260906-additional-save-close\probe.mjs`, `probe-result.log`, `probe-initial-harness-error.log`. 아래에는 재실행 가능한 최종 하네스와 최종 로그를 그대로 보존한다. 실행: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test <probe.mjs 경로>`.
- 제품 파일 변경 없음. 이 추가 조사에서 영구 기록한 파일은 본 문서 하나다.

## 부록: 최종 하네스와 실행 결과

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root = 'C:/BAEframe/BAEFRAME';
const sources = Object.fromEntries(['main/index.js', 'main/window.js', 'renderer/scripts/app.js', 'renderer/scripts/modules/playlist-manager.js'].map(p => [p, fs.readFileSync(path.join(root,p),'utf8')]));
const between = (source,start,end) => {
  const a=source.indexOf(start); assert.ok(a>=0,start);
  const b=source.indexOf(end,a+start.length); assert.ok(b>a,end);
  return source.slice(a,b);
};
const snippets = {
  appQuit: between(sources['main/index.js'], "  app.on('window-all-closed'", '  // 앱 종료 완료'),
  closed: between(sources['main/window.js'], "  mainWindow.on('closed'", '  // 렌더러 에러 처리'),
  closeWindow: between(sources['main/window.js'], 'function closeWindow() {', '\n/**'),
  beforeUnload: between(sources['renderer/scripts/app.js'], "  window.addEventListener('beforeunload'", '  // ====== 최근 파일 매니저 초기화')
};
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
console.log('SOURCE_HASHES', JSON.stringify(Object.fromEntries(Object.entries(sources).map(([p,s])=>[p,hash(s)]))));
console.log('EXTRACTED_HASHES', JSON.stringify(Object.fromEntries(Object.entries(snippets).map(([p,s])=>[p,hash(s)]))));

function quitHarness() {
  const events={}, ipc={}, windowEvents={}, rendererEvents={}, timeouts=new Map();
  const observation={messages:[], quitDecisions:[], cleanups:0, cancelledTimer:0};
  let ctx;
  const nativeWindow={
    isDestroyed:()=>false,
    webContents:{send:(channel)=>observation.messages.push(channel)},
    on:(name,handler)=>{windowEvents[name]=handler;},
    close:()=>{
      const e={}; rendererEvents.beforeunload(e);
      observation.beforeUnloadReturnValue=e.returnValue;
      windowEvents.closed();
      events['window-all-closed']();
    }
  };
  const app={on:(name,handler)=>{events[name]=handler;},quit:()=>{
    let prevented=false;
    events['before-quit']({preventDefault:()=>{prevented=true;}});
    observation.quitDecisions.push({prevented,saveRequests:observation.messages.length});
  }};
  ctx=vm.createContext({
    app,ipcMain:{handle:(name,handler)=>{ipc[name]=handler;}},
    mainWindow:nativeWindow,getMainWindow:()=>ctx.mainWindow,
    process:{platform:'win32'},log:{info(){},warn(){}},
    cleanupMpvPilotBeforeQuit:async()=>{observation.cleanups++;},
    setTimeout:(handler,ms)=>{const key={ms};timeouts.set(key,handler);return key;},
    clearTimeout:(key)=>{if(timeouts.delete(key))observation.cancelledTimer++;},
    window:{addEventListener:(name,handler)=>{rendererEvents[name]=handler;},electronAPI:{watchFileStopAll(){}}},
    stopDeferredReviewFileDiscovery:async()=>{},liveblocksManager:{releaseAllEditingLocks(){}}
  });
  vm.runInContext('let isQuitting=false;let forceQuit=false;let shutdownCleanupStarted=false;let isAppShuttingDown=false;'+snippets.closed+snippets.closeWindow+snippets.beforeUnload+snippets.appQuit,ctx);
  return {ctx,events,ipc,timeouts,observation,app,nativeWindow};
}
const microtasks=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('native close path reaches quit only after main window reference is removed; no save request',async()=>{
  const h=quitHarness(); vm.runInContext('closeWindow()',h.ctx); await microtasks();
  assert.equal(h.ctx.mainWindow,null);
  assert.deepEqual(h.observation.messages,[]);
  assert.equal(h.observation.beforeUnloadReturnValue,undefined);
  assert.ok(h.observation.quitDecisions.some(e=>!e.prevented));
  console.log('NATIVE_CLOSE_MODEL',JSON.stringify(h.observation));
});
test('counterexample: explicit app.quit with live window requests save and cancellation preserves window',()=>{
  const h=quitHarness(); h.app.quit();
  assert.deepEqual(h.observation.messages,['app:request-save-before-quit']);
  assert.equal(h.observation.quitDecisions[0].prevented,true);
  h.ipc['app:quit-cancelled']();
  assert.equal(vm.runInContext('isQuitting',h.ctx),false);
  assert.equal(h.timeouts.size,0); assert.equal(h.ctx.mainWindow,h.nativeWindow);
});
test('counterexample: confirmed explicit quit runs mpv cleanup then permits quit',async()=>{
  const h=quitHarness(); h.app.quit(); h.ipc['app:quit-confirmed'](); await microtasks();
  assert.equal(h.observation.cleanups,1); assert.equal(h.timeouts.size,0);
  assert.ok(h.observation.quitDecisions.some(e=>!e.prevented));
});
test('second explicit app.quit while first save request is unresolved is not prevented',()=>{
  const h=quitHarness(); h.app.quit(); h.app.quit();
  assert.deepEqual(h.observation.quitDecisions.map(e=>e.prevented),[true,false]);
  assert.equal(h.observation.messages.length,1);
  console.log('DUPLICATE_QUIT',JSON.stringify(h.observation));
});

globalThis.window={electronAPI:{}};
const {PlaylistManager}=await import(pathToFileURL(path.join(root,'renderer/scripts/modules/playlist-manager.js')).href);
const fixture=id=>({playlistVersion:'1.0',id,name:id,items:[{id:id+'-item',videoPath:'C:/audit/'+id+'.mp4',bframePath:'C:/audit/'+id+'.bframe',fileName:id+'.mp4',order:0,thumbnailPath:'data:image/jpeg;base64,AA=='}],settings:{}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const setupManager=()=>{const m=new PlaylistManager();m.currentPlaylist=fixture('A');m.playlistPath='C:/audit/A.bplaylist';m.isModified=true;return m;};

test('pending save of A completes after real open(B); B acquires A path and next write targets A',async()=>{
  const m=setupManager(), gate=deferred(), writes=[];
  window.electronAPI={
    writePlaylist:async(target,data)=>{writes.push({target,data:structuredClone(data)});if(writes.length===1)await gate.promise;return {success:true};},
    readPlaylist:async()=>fixture('B')
  };
  const firstSave=m.save();
  await m.open('C:/audit/B.bplaylist');
  assert.equal(m.currentPlaylist.id,'B');assert.equal(m.playlistPath,'C:/audit/B.bplaylist');
  m.setName('B-new');assert.equal(m.isModified,true);
  gate.resolve();await firstSave;
  assert.equal(m.currentPlaylist.id,'B');assert.equal(m.playlistPath,'C:/audit/A.bplaylist');assert.equal(m.isModified,false);
  const corruptState={id:m.currentPlaylist.id,name:m.currentPlaylist.name,path:m.playlistPath,isModified:m.isModified};
  m.setName('B-next-edit');await m.save();
  assert.equal(writes.at(-1).target,'C:/audit/A.bplaylist');assert.equal(writes.at(-1).data.id,'B');
  console.log('PLAYLIST_SAVE_RACE',JSON.stringify({corruptState,writes:writes.map(w=>({target:w.target,id:w.data.id,name:w.data.name}))}));
});
test('counterexample: serial save then open(B) retains B path',async()=>{
  const m=setupManager();window.electronAPI={writePlaylist:async()=>({success:true}),readPlaylist:async()=>fixture('B')};
  await m.save();await m.open('C:/audit/B.bplaylist');
  assert.equal(m.currentPlaylist.id,'B');assert.equal(m.playlistPath,'C:/audit/B.bplaylist');
});
test('counterexample: write rejection retains current path and dirty state',async()=>{
  const m=setupManager();window.electronAPI={writePlaylist:async()=>{throw new Error('write-boundary-failed');}};
  await assert.rejects(()=>m.save(),/write-boundary-failed/);
  assert.equal(m.playlistPath,'C:/audit/A.bplaylist');assert.equal(m.isModified,true);
});
test('counterexample: open(B) write rejection does not discard A',async()=>{
  const m=setupManager();window.electronAPI={writePlaylist:async()=>{throw new Error('open-boundary-failed');}};
  await assert.rejects(()=>m.open('C:/audit/B.bplaylist'),/open-boundary-failed/);
  assert.equal(m.currentPlaylist.id,'A');assert.equal(m.playlistPath,'C:/audit/A.bplaylist');assert.equal(m.isModified,true);
});

```

```text
TAP version 13
# SOURCE_HASHES {"main/index.js":"7897f9c6437d0c5e6820a308cb86e57760d66b4dbcc38c5e46c79c850bc4f881","main/window.js":"ef82ec21914bd9876148a57317e8583aacd5eb5f1de804fee1a39b055409d06e","renderer/scripts/app.js":"92d85f0d1c1025c49b840405823c0c697d8c1f82180d2c53c1ad41c49bc0f631","renderer/scripts/modules/playlist-manager.js":"e852b28294962b8a53e58121b9d543548eca03b6df2bc2c1bde232e7a334d578"}
# EXTRACTED_HASHES {"appQuit":"4283f986b1e8cd7004835dfc4e7b90327a9b8cbb229984f2bb9843a0f9b8b587","closed":"c6c24a216a7892d9defa320bcec3e3a3125aa775343c641ec496de0cd3e6a676","closeWindow":"fe6fa62c5ca766fe5aff2f7087f3e3376c9cd40f9e2c05c6b04a8db27e304e1b","beforeUnload":"89e90257ff0ac883b6d1ecab79546afa0a74d7ca1a5cc2e578d66732cc87e88c"}
# NATIVE_CLOSE_MODEL {"messages":[],"quitDecisions":[{"prevented":true,"saveRequests":0},{"prevented":true,"saveRequests":0},{"prevented":false,"saveRequests":0}],"cleanups":1,"cancelledTimer":0}
# DUPLICATE_QUIT {"messages":["app:request-save-before-quit"],"quitDecisions":[{"prevented":true,"saveRequests":1},{"prevented":false,"saveRequests":1}],"cleanups":0,"cancelledTimer":0}
# [18:28:36.386] [PlaylistManager] PlaylistManager 초기화
# [18:28:36.387] [PlaylistManager] 재생목록 저장 { path: 'C:/audit/A.bplaylist' }
# [18:28:36.388] [PlaylistManager] 재생목록 열기 { filePath: 'C:/audit/B.bplaylist' }
# [18:28:36.389] [PlaylistManager] 재생목록 로드 완료 {
#   name: 'B',
#   itemCount: 1,
#   repairedBframeCount: 0,
#   thumbnailsDeferred: true
# }
# [18:28:36.389] [PlaylistManager] 재생목록 저장 완료
# [18:28:36.389] [PlaylistManager] 재생목록 저장 { path: 'C:/audit/A.bplaylist' }
# [18:28:36.389] [PlaylistManager] 재생목록 저장 완료
# PLAYLIST_SAVE_RACE {"corruptState":{"id":"B","name":"B-new","path":"C:/audit/A.bplaylist","isModified":false},"writes":[{"target":"C:/audit/A.bplaylist","id":"A","name":"A"},{"target":"C:/audit/A.bplaylist","id":"A","name":"A"},{"target":"C:/audit/A.bplaylist","id":"B","name":"B-next-edit"}]}
# [18:28:36.389] [PlaylistManager] PlaylistManager 초기화
# [18:28:36.390] [PlaylistManager] 재생목록 저장 { path: 'C:/audit/A.bplaylist' }
# [18:28:36.390] [PlaylistManager] 재생목록 저장 완료
# [18:28:36.390] [PlaylistManager] 재생목록 열기 { filePath: 'C:/audit/B.bplaylist' }
# [18:28:36.390] [PlaylistManager] 재생목록 로드 완료 {
#   name: 'B',
#   itemCount: 1,
#   repairedBframeCount: 0,
#   thumbnailsDeferred: true
# }
# [18:28:36.390] [PlaylistManager] PlaylistManager 초기화
# [18:28:36.391] [PlaylistManager] 재생목록 저장 { path: 'C:/audit/A.bplaylist' }
# [18:28:36.391] [PlaylistManager] PlaylistManager 초기화
# [18:28:36.391] [PlaylistManager] 재생목록 열기 { filePath: 'C:/audit/B.bplaylist' }
# [18:28:36.392] [PlaylistManager] 재생목록 열기 실패 { filePath: 'C:/audit/B.bplaylist', error: 'open-boundary-failed' }
# Subtest: native close path reaches quit only after main window reference is removed; no save request
ok 1 - native close path reaches quit only after main window reference is removed; no save request
  ---
  duration_ms: 8.249
  type: 'test'
  ...
# Subtest: counterexample: explicit app.quit with live window requests save and cancellation preserves window
ok 2 - counterexample: explicit app.quit with live window requests save and cancellation preserves window
  ---
  duration_ms: 1.0685
  type: 'test'
  ...
# Subtest: counterexample: confirmed explicit quit runs mpv cleanup then permits quit
ok 3 - counterexample: confirmed explicit quit runs mpv cleanup then permits quit
  ---
  duration_ms: 0.8317
  type: 'test'
  ...
# Subtest: second explicit app.quit while first save request is unresolved is not prevented
ok 4 - second explicit app.quit while first save request is unresolved is not prevented
  ---
  duration_ms: 0.8027
  type: 'test'
  ...
# Subtest: pending save of A completes after real open(B); B acquires A path and next write targets A
ok 5 - pending save of A completes after real open(B); B acquires A path and next write targets A
  ---
  duration_ms: 3.8429
  type: 'test'
  ...
# Subtest: counterexample: serial save then open(B) retains B path
ok 6 - counterexample: serial save then open(B) retains B path
  ---
  duration_ms: 0.8678
  type: 'test'
  ...
# Subtest: counterexample: write rejection retains current path and dirty state
ok 7 - counterexample: write rejection retains current path and dirty state
  ---
  duration_ms: 0.9117
  type: 'test'
  ...
# Subtest: counterexample: open(B) write rejection does not discard A
ok 8 - counterexample: open(B) write rejection does not discard A
  ---
  duration_ms: 0.6267
  type: 'test'
  ...
1..8
# tests 8
# suites 0
# pass 8
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 99.9417

```
