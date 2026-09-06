const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '../../renderer/scripts/modules/image-utils.js'), 'utf8')
  .replace(/^import .*;\r?\n/m, '')
  .replace(/export default \{[\s\S]*?\};\s*$/, '')
  .replace(/\bexport /g, '');

function setup(t, options = {}) {
  const main = new JSDOM('<html><body></body></html>', { url: 'file:///renderer/index.html' });
  const child = new JSDOM('<html><body></body></html>', { url: 'file:///renderer/comment-panel.html' });
  t.after(() => { main.window.close(); child.window.close(); });
  const objects = new Map();
  const created = [];
  const revoked = [];
  const blobSize = Object.getOwnPropertyDescriptor(main.window.Blob.prototype, 'size').get;
  const url = {
    createObjectURL(blob) {
      blobSize.call(blob); // 플랫폼 API처럼 실제 Blob/File 브랜드만 허용한다.
      const value = `blob:test/${created.length + 1}`;
      objects.set(value, blob);
      created.push(value);
      return value;
    },
    revokeObjectURL(value) { revoked.push(value); }
  };
  class ImageDouble {
    constructor() { this.width = 4; this.height = 2; }
    set src(value) {
      this.value = value;
      queueMicrotask(() => {
        const blob = objects.get(value);
        if (options.decodeFailure || (blob && !blob.type.startsWith('image/'))) this.onerror?.();
        else this.onload?.();
      });
    }
    get src() { return this.value; }
  }
  const realCreate = main.window.document.createElement.bind(main.window.document);
  main.window.document.createElement = (name) => {
    const element = realCreate(name);
    if (name === 'canvas') {
      element.getContext = () => ({ drawImage() { if (options.canvasFailure) throw new Error('canvas failed'); } });
      element.toDataURL = format => `data:${format};base64,aW1hZ2U=`;
    }
    return element;
  };
  const context = vm.createContext({
    Blob: main.window.Blob, File: main.window.File, Image: ImageDouble, URL: url,
    document: main.window.document,
    createLogger: () => ({ debug() {}, info() {}, error() {} })
  });
  vm.runInContext(`${source}\nglobalThis.api = { compressImage, getImageFromClipboard, getImageFromDrop, selectImageFile };`, context);
  return { main: main.window, child: child.window, api: context.api, created, revoked };
}

test('다른 창의 File은 instanceof가 달라도 이미지로 압축하고 URL을 해제한다', async t => {
  const h = setup(t);
  const file = new h.child.File(['PNG'], 'child.png', { type: 'image/png' });
  assert.equal(file instanceof h.main.File, false);
  assert.equal(file instanceof h.main.Blob, false);
  const result = await h.api.compressImage(file, { format: 'image/png' });
  assert.equal(result.width, 4);
  assert.equal(result.height, 2);
  assert.ok(result.base64.startsWith('data:image/png;'));
  assert.deepEqual(h.revoked, h.created);
  assert.equal(h.created.length, 1);
});

test('자식 창에서 생성한 Blob과 부모 File, Blob, data URL도 기존 압축 옵션을 유지한다', async t => {
  const h = setup(t);
  const values = [
    new h.child.Blob(['PNG'], { type: 'image/png' }),
    new h.main.File(['PNG'], 'main.png', { type: 'image/png' }),
    new h.main.Blob(['PNG'], { type: 'image/png' }),
    'data:image/png;base64,aW1hZ2U='
  ];
  for (const value of values) {
    const result = await h.api.compressImage(value, { maxWidth: 2, maxHeight: 2, quality: 0.7 });
    assert.equal(result.width, 2);
    assert.equal(result.height, 1);
    assert.equal(result.quality, 0.7);
  }
  assert.equal(h.created.length, 3);
  assert.deepEqual(h.revoked, h.created);
});

test('자식 창의 붙여넣기와 드롭 파일이 이미지 압축으로 전달된다', async t => {
  const h = setup(t);
  const file = new h.child.File(['PNG'], 'paste.png', { type: 'image/png' });
  const paste = new h.child.Event('paste');
  Object.defineProperty(paste, 'clipboardData', { value: { items: [{ type: 'image/png', getAsFile: () => file }] } });
  const pasted = await h.api.getImageFromClipboard(paste, { format: 'image/png' });
  assert.ok(pasted.base64.startsWith('data:image/png;'));
  const drop = new h.child.Event('drop');
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
  const dropped = await h.api.getImageFromDrop(drop);
  assert.ok(dropped.base64.startsWith('data:image/jpeg;'));
  assert.equal(h.created.length, 2);
  assert.deepEqual(h.revoked, h.created);
});

test('일반 객체와 Blob처럼 꾸민 객체, null을 이미지로 받아들이지 않는다', async t => {
  const h = setup(t);
  for (const value of [{}, { size: 3, type: 'image/png', arrayBuffer() {} }, { [Symbol.toStringTag]: 'Blob' }, null, 12]) {
    await assert.rejects(h.api.compressImage(value), /지원하지 않는 이미지 소스/);
  }
  assert.equal(h.created.length, 0);
});

test('이미지가 아닌 실제 File은 디코딩에서 거부하고 생성 URL을 해제한다', async t => {
  const h = setup(t);
  const file = new h.child.File(['text'], 'note.txt', { type: 'text/plain' });
  await assert.rejects(h.api.compressImage(file), /이미지 로드 실패/);
  assert.deepEqual(h.revoked, h.created);
  assert.equal(h.created.length, 1);
  assert.equal(await h.api.getImageFromDrop({ dataTransfer: { files: [file] } }), null);
  assert.equal(await h.api.getImageFromClipboard({ clipboardData: { items: [{ type: 'text/plain', getAsFile: () => file }] } }), null);
});

for (const failure of ['decodeFailure', 'canvasFailure']) {
  test(`이미지 ${failure}에서도 생성한 URL을 남기지 않는다`, async t => {
    const h = setup(t, { [failure]: true });
    const file = new h.main.File(['PNG'], 'main.png', { type: 'image/png' });
    await assert.rejects(h.api.compressImage(file), /이미지 로드 실패|canvas failed/);
    assert.equal(h.created.length, 1);
    assert.deepEqual(h.revoked, h.created);
  });
}

test('파일 선택기는 지정한 자식 document에서 열고 자식 File을 처리한다', async t => {
  const h = setup(t);
  let selectedInput;
  h.child.HTMLInputElement.prototype.click = function () {
    selectedInput = this;
    Object.defineProperty(this, 'files', { value: [new h.child.File(['PNG'], 'picked.png', { type: 'image/png' })] });
    this.dispatchEvent(new h.child.Event('change'));
  };
  const pending = h.api.selectImageFile(h.child.document);
  assert.ok(selectedInput, '파일 선택 input은 자식 document에 생성되어야 합니다.');
  assert.equal(selectedInput.ownerDocument, h.child.document);
  assert.equal(selectedInput.accept, 'image/*');
  assert.ok((await pending).base64.startsWith('data:image/jpeg;'));
});

test('document를 지정하지 않은 파일 선택은 부모 document와 기존 결과를 유지한다', async t => {
  const h = setup(t);
  let selectedInput;
  h.main.HTMLInputElement.prototype.click = function () {
    selectedInput = this;
    Object.defineProperty(this, 'files', { value: [] });
    this.dispatchEvent(new h.main.Event('change'));
  };
  assert.equal(await h.api.selectImageFile(), null);
  assert.equal(selectedInput.ownerDocument, h.main.document);
});

test('자식 창의 파일 선택 취소는 null로 완료된다', async t => {
  const h = setup(t);
  let selectedInput;
  h.child.HTMLInputElement.prototype.click = function () {
    selectedInput = this;
    this.dispatchEvent(new h.child.Event('cancel'));
  };
  const pending = h.api.selectImageFile(h.child.document);
  assert.ok(selectedInput, '취소 이벤트도 자식 창 input에서 받아야 합니다.');
  assert.equal(await pending, null);
});
