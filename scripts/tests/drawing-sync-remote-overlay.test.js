const { test } = require('node:test');
const assert = require('node:assert/strict');

class TestCustomEvent extends Event {
  constructor(type, options = {}) {
    super(type);
    this.detail = options.detail;
  }
}

class FakeCanvasContext {
  constructor() {
    this.clearCount = 0;
    this.points = [];
  }

  clearRect() {
    this.clearCount += 1;
  }

  beginPath() {}

  moveTo(x, y) {
    this.points.push(['moveTo', x, y]);
  }

  lineTo(x, y) {
    this.points.push(['lineTo', x, y]);
  }

  stroke() {}
}

class FakeCanvas extends EventTarget {
  constructor() {
    super();
    this.width = 1920;
    this.height = 1080;
    this.style = {};
    this.context = new FakeCanvasContext();
    this.parentElement = {
      appendChild: element => {
        this.appendedOverlay = element;
      }
    };
  }

  getContext() {
    return this.context;
  }
}

class FakeDrawingCanvas extends EventTarget {
  constructor(canvas) {
    super();
    this.canvas = canvas;
  }
}

class FakeDrawingManager extends EventTarget {
  constructor(canvas) {
    super();
    this.currentFrame = 12;
    this.drawingCanvas = new FakeDrawingCanvas(canvas);
  }
}

class FakeLiveblocksManager extends EventTarget {
  getSelf() {
    return { connectionId: 'remote-overlay-test' };
  }

  receive(event) {
    this.dispatchEvent(new TestCustomEvent('broadcastReceived', { detail: { event } }));
  }
}

global.CustomEvent = global.CustomEvent || TestCustomEvent;
global.window = global.window || new EventTarget();
global.window.logPanel = null;
global.window.electronAPI = null;
global.document = global.document || new EventTarget();
global.document.getElementById = () => null;
global.document.createElement = tagName => {
  assert.equal(tagName, 'canvas');
  return new FakeCanvas();
};

async function createFixture(onRemoteStrokeOverlayChange) {
  const { DrawingSync } = await import('../../renderer/scripts/modules/drawing-sync.js');
  const sourceCanvas = new FakeCanvas();
  const drawingManager = new FakeDrawingManager(sourceCanvas);
  const liveblocksManager = new FakeLiveblocksManager();
  const sync = new DrawingSync({
    liveblocksManager,
    drawingManager,
    onRemoteStrokeOverlayChange
  });
  sync.start();
  return { sync, sourceCanvas, drawingManager, liveblocksManager };
}

test('remote stroke broadcasts notify start, move, and end after each overlay mutation', async () => {
  const changes = [];
  const fixture = await createFixture(change => {
    changes.push({
      phase: change.phase,
      overlay: change.overlay,
      display: change.overlay?.style.display,
      clearCount: change.overlay?.context.clearCount,
      points: [...(change.overlay?.context.points || [])]
    });
  });

  fixture.liveblocksManager.receive({
    type: 'STROKE_START',
    layerId: 'layer-1',
    frame: 12,
    x: 10,
    y: 20,
    color: '#ff0000',
    lineWidth: 6,
    opacity: 0.75,
    tool: 'pen'
  });
  fixture.liveblocksManager.receive({
    type: 'STROKE_MOVE',
    points: [{ x: 30, y: 40 }, { x: 50, y: 60 }]
  });
  fixture.liveblocksManager.receive({ type: 'STROKE_END' });

  assert.deepEqual(changes.map(change => change.phase), ['start', 'move', 'end']);
  assert.equal(changes[0].display, 'block');
  assert.deepEqual(changes[1].points, [
    ['moveTo', 10, 20],
    ['lineTo', 30, 40],
    ['lineTo', 50, 60]
  ]);
  assert.equal(changes[2].display, 'none');
  assert.equal(changes[2].clearCount, 2);
  assert.equal(changes[0].overlay, changes[2].overlay);

  fixture.sync.stop();
});

test('remote stroke change callback errors never interrupt broadcast processing', async () => {
  let callbackCalls = 0;
  const fixture = await createFixture(() => {
    callbackCalls += 1;
    throw new Error('consumer failed');
  });

  assert.doesNotThrow(() => {
    fixture.liveblocksManager.receive({
      type: 'STROKE_START',
      layerId: 'layer-1',
      frame: 12,
      x: 1,
      y: 2,
      tool: 'pen'
    });
    fixture.liveblocksManager.receive({
      type: 'STROKE_MOVE',
      points: [{ x: 3, y: 4 }]
    });
    fixture.liveblocksManager.receive({ type: 'STROKE_END' });
  });

  assert.equal(fixture.sourceCanvas.appendedOverlay.style.display, 'none');
  assert.equal(callbackCalls, 3);
  fixture.sync.stop();
});

test('stop clears the remote overlay and emits a clear notification', async () => {
  const changes = [];
  const fixture = await createFixture(change => {
    changes.push({
      phase: change.phase,
      overlay: change.overlay,
      display: change.overlay?.style.display,
      clearCount: change.overlay?.context.clearCount
    });
  });

  fixture.liveblocksManager.receive({
    type: 'STROKE_START',
    layerId: 'layer-1',
    frame: 12,
    x: 10,
    y: 20,
    tool: 'pen'
  });
  fixture.sync.stop();

  assert.deepEqual(changes.map(change => change.phase), ['start', 'clear']);
  assert.equal(changes[1].display, 'none');
  assert.equal(changes[1].clearCount, 2);

  fixture.liveblocksManager.receive({
    type: 'STROKE_MOVE',
    points: [{ x: 30, y: 40 }]
  });
  assert.equal(changes.length, 2);
});
