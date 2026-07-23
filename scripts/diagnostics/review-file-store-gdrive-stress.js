'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const reviewFileStorePath = path.join(repoRoot, 'main', 'review-file-store.js');
const rounds = 100;
const workerTimeoutMs = 15_000;
const scratchPrefix = '.baeframe-review-store-stress-';
const scratchParent = path.join(
  'G:\\',
  '공유 드라이브',
  'JBBJ 자료실',
  '한솔이의 두근두근 실험실',
  'BAEFRAME'
);
const deploymentPath = path.join(scratchParent, '테스트버전 빌드');
const storeOptions = Object.freeze({
  lockAcquireTimeoutMs: 10_000,
  lockRetryMinMs: 5,
  lockRetryMaxMs: 25,
  renameRetryDelaysMs: [0, 25, 50, 100, 200, 400, 800]
});

function serializeReview(data) {
  return JSON.stringify(data, null, 2);
}

function createVersionToken(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isStaleConflict(result) {
  return result?.success === false &&
    result?.conflict === true &&
    result?.reason === 'stale-version-token';
}

async function runWorker() {
  const { createReviewFileStore } = require(reviewFileStorePath);
  const store = createReviewFileStore(storeOptions);
  let busy = false;

  process.on('message', async message => {
    if (message?.type === 'stop') {
      process.exit(0);
      return;
    }
    if (message?.type !== 'run') return;
    if (busy) {
      process.send?.({
        type: 'error',
        round: message.round,
        error: { message: 'worker received an overlapping run' }
      });
      return;
    }

    busy = true;
    try {
      const result = await store.saveReviewFile(
        message.filePath,
        message.data,
        { expectedVersionToken: message.expectedVersionToken }
      );
      process.send?.({ type: 'result', round: message.round, result });
    } catch (error) {
      process.send?.({
        type: 'error',
        round: message.round,
        error: {
          message: error?.message || String(error),
          code: error?.code || null,
          stack: error?.stack || null
        }
      });
    } finally {
      busy = false;
    }
  });

  process.send?.({ type: 'ready' });
}

function createWorker(label) {
  const child = fork(__filename, ['--worker'], {
    cwd: repoRoot,
    env: { ...process.env },
    silent: true,
    windowsHide: true
  });
  const messages = [];
  const waiters = [];
  let stdout = '';
  let stderr = '';
  let exit = null;

  child.stdout?.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });

  function diagnostics() {
    return [
      `${label} exit=${JSON.stringify(exit)}`,
      stdout ? `stdout:\n${stdout}` : '',
      stderr ? `stderr:\n${stderr}` : ''
    ].filter(Boolean).join('\n');
  }

  function rejectAll(error) {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  child.on('message', message => {
    const index = waiters.findIndex(waiter => waiter.predicate(message));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    messages.push(message);
  });
  child.on('error', rejectAll);
  child.on('exit', (code, signal) => {
    exit = { code, signal };
    rejectAll(new Error(`${label} exited unexpectedly\n${diagnostics()}`));
  });

  function waitFor(predicate, description, timeoutMs = workerTimeoutMs) {
    const index = messages.findIndex(predicate);
    if (index >= 0) {
      const [message] = messages.splice(index, 1);
      return Promise.resolve(message);
    }
    if (exit) {
      return Promise.reject(new Error(
        `${label} already exited while waiting for ${description}\n${diagnostics()}`
      ));
    }

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error(
          `${label} timed out waiting for ${description}\n${diagnostics()}`
        ));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  return {
    child,
    async ready() {
      await waitFor(message => message?.type === 'ready', 'ready');
    },
    run(round, config) {
      child.send({ type: 'run', round, ...config });
    },
    async result(round) {
      const message = await waitFor(
        candidate =>
          candidate?.round === round &&
          (candidate?.type === 'result' || candidate?.type === 'error'),
        `round ${round} result`
      );
      if (message.type === 'error') {
        const error = new Error(
          `${label} round ${round} failed: ${message.error?.message}\n${diagnostics()}`
        );
        error.code = message.error?.code || null;
        error.workerStack = message.error?.stack || null;
        throw error;
      }
      return message.result;
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.send({ type: 'stop' });
      await Promise.race([
        stopped,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error(`${label} stop timed out\n${diagnostics()}`)),
            2_000
          );
        })
      ]).catch(async error => {
        child.kill();
        throw error;
      });
    }
  };
}

function createScratchPath() {
  const suffix = [
    new Date().toISOString().replace(/[:.]/g, '-'),
    process.pid,
    crypto.randomUUID()
  ].join('-');
  return path.join(scratchParent, `${scratchPrefix}${suffix}`);
}

function assertSafeScratchPath(scratchPath) {
  const resolved = path.resolve(scratchPath);
  const parsed = path.parse(resolved);
  assert.equal(parsed.root.toLowerCase(), 'g:\\');
  assert.equal(path.dirname(resolved).toLowerCase(), scratchParent.toLowerCase());
  assert.notEqual(resolved.toLowerCase(), deploymentPath.toLowerCase());
  assert.ok(
    path.basename(resolved).startsWith(scratchPrefix),
    `unsafe scratch path: ${scratchPath}`
  );
}

async function runStress() {
  assert.equal(process.platform, 'win32', 'this diagnostic is Windows-only');
  const scratchPath = createScratchPath();
  assertSafeScratchPath(scratchPath);
  const filePath = path.join(scratchPath, 'stress-review.bframe');
  const startedAt = Date.now();
  const summary = {
    rounds,
    doubleSuccess: 0,
    exactlyOneSuccessOneStale: 0,
    malformedJson: 0,
    finalWinnerMatched: 0,
    tempResiduals: 0,
    unexpectedOutcomes: []
  };
  const workers = [createWorker('worker-a'), createWorker('worker-b')];
  let scratchRemoved = false;

  try {
    await fsp.mkdir(scratchPath, { recursive: false });
    await Promise.all(workers.map(worker => worker.ready()));

    for (let round = 1; round <= rounds; round += 1) {
      const base = {
        reviewDocumentId: 'gdrive-two-process-stress',
        round,
        winner: 'base',
        payload: `base-${round}`
      };
      const candidates = [
        {
          reviewDocumentId: base.reviewDocumentId,
          round,
          winner: 'worker-a',
          payload: `a-${round}-${'a'.repeat(32 * 1024)}`
        },
        {
          reviewDocumentId: base.reviewDocumentId,
          round,
          winner: 'worker-b',
          payload: `b-${round}-${'b'.repeat(32 * 1024)}`
        }
      ];
      const baseContent = serializeReview(base);
      await fsp.writeFile(filePath, baseContent, 'utf8');
      const expectedVersionToken = createVersionToken(baseContent);

      workers[0].run(round, {
        filePath,
        data: candidates[0],
        expectedVersionToken
      });
      workers[1].run(round, {
        filePath,
        data: candidates[1],
        expectedVersionToken
      });

      const results = await Promise.all(workers.map(worker => worker.result(round)));
      const successIndexes = results
        .map((result, index) => result?.success === true ? index : -1)
        .filter(index => index >= 0);
      const staleCount = results.filter(isStaleConflict).length;

      if (successIndexes.length === 2) summary.doubleSuccess += 1;
      if (successIndexes.length === 1 && staleCount === 1) {
        summary.exactlyOneSuccessOneStale += 1;
      } else {
        summary.unexpectedOutcomes.push({ round, results });
      }

      let finalData = null;
      try {
        finalData = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      } catch (error) {
        summary.malformedJson += 1;
        summary.unexpectedOutcomes.push({
          round,
          parseError: error?.message || String(error)
        });
      }

      if (
        successIndexes.length === 1 &&
        finalData &&
        JSON.stringify(finalData) === JSON.stringify(candidates[successIndexes[0]])
      ) {
        summary.finalWinnerMatched += 1;
      } else if (finalData) {
        summary.unexpectedOutcomes.push({
          round,
          winnerMismatch: {
            successIndexes,
            finalWinner: finalData.winner
          }
        });
      }

      const residualNames = (await fsp.readdir(scratchPath))
        .filter(name => name !== path.basename(filePath));
      if (residualNames.length > 0) {
        summary.tempResiduals += residualNames.length;
        summary.unexpectedOutcomes.push({ round, residualNames });
      }

      if (round % 10 === 0) {
        process.stdout.write(`completed ${round}/${rounds}\n`);
      }
    }
  } finally {
    await Promise.allSettled(workers.map(worker => worker.stop()));
    assertSafeScratchPath(scratchPath);
    await fsp.rm(scratchPath, { recursive: true, force: true });
    scratchRemoved = !(await fsp.stat(scratchPath).then(
      () => true,
      error => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
    ));
  }

  const elapsedMs = Date.now() - startedAt;
  const passed =
    summary.doubleSuccess === 0 &&
    summary.exactlyOneSuccessOneStale === rounds &&
    summary.malformedJson === 0 &&
    summary.finalWinnerMatched === rounds &&
    summary.tempResiduals === 0 &&
    summary.unexpectedOutcomes.length === 0 &&
    scratchRemoved;

  const report = {
    passed,
    elapsedMs,
    scratchRemoved,
    ...summary
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

if (process.argv.includes('--worker')) {
  runWorker().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
} else {
  runStress().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
