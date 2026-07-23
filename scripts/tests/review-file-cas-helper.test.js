'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const helperPath = path.resolve(
  __dirname,
  '../../native/review-file-cas-helper/bin/ReviewFileCasHelper.exe'
);
const WINDOWS_ONLY = process.platform !== 'win32'
  ? 'ReviewFileCasHelper is Windows-only'
  : false;
const TEST_TIMEOUT_MS = 15_000;

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function createFixture(t) {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'baeframe-review-cas-helper-')
  );
  const targetPath = path.join(directory, 'review.bframe');
  const baseContent = `${JSON.stringify({
    reviewDocumentId: 'native-helper-contract',
    revision: 1,
    source: 'base'
  })}\n`;
  await fsp.writeFile(targetPath, baseContent, 'utf8');
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  await fsp.access(helperPath, fs.constants.X_OK);
  return { baseContent, directory, targetPath };
}

function startHelper(args) {
  const child = spawn(helperPath, args, {
    windowsHide: true
  });
  const events = new EventEmitter();
  const records = [];
  let stdout = '';
  let stderr = '';
  let exited = false;

  function consumeLine(line, stream) {
    const record = parseJsonLine(line.trim());
    if (!record) return;
    const observed = { ...record, stream };
    records.push(observed);
    events.emit('record', observed);
  }

  function consumeStream(stream, streamName, append) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      append(chunk);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) consumeLine(line, streamName);
    });
    stream.on('end', () => {
      if (pending.trim()) consumeLine(pending, streamName);
    });
  }

  consumeStream(child.stdout, 'stdout', chunk => {
    stdout += chunk;
  });
  consumeStream(child.stderr, 'stderr', chunk => {
    stderr += chunk;
  });

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(
        `ReviewFileCasHelper timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`
      ));
    }, TEST_TIMEOUT_MS - 1000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      exited = true;
      resolve({ code, records, signal, stderr, stdout });
    });
  });

  function waitForRecord(predicate, timeoutMs = 3000) {
    const existing = records.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        events.removeListener('record', onRecord);
        reject(new Error(
          `Timed out waiting for helper status\nstdout:\n${stdout}\nstderr:\n${stderr}`
        ));
      }, timeoutMs);
      const onRecord = record => {
        if (!predicate(record)) return;
        clearTimeout(timer);
        events.removeListener('record', onRecord);
        resolve(record);
      };
      events.on('record', onRecord);
    });
  }

  return {
    child,
    isRunning: () => !exited,
    result,
    waitForRecord
  };
}

test('an external atomic rename after the guarded hash is preserved as a conflict', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const { baseContent, directory, targetPath } = await createFixture(t);
  const replacementPath = path.join(directory, 'candidate.tmp');
  const movedBasePath = path.join(directory, 'external-previous.bframe');
  const externalReplacementPath = path.join(
    directory,
    'external-candidate.tmp'
  );
  const candidateContent = `${JSON.stringify({
    reviewDocumentId: 'native-helper-contract',
    revision: 2,
    source: 'candidate'
  })}\n`;
  const externalContent = `${JSON.stringify({
    reviewDocumentId: 'native-helper-contract',
    revision: 3,
    source: 'external'
  })}\n`;
  await Promise.all([
    fsp.writeFile(replacementPath, candidateContent, 'utf8'),
    fsp.writeFile(externalReplacementPath, externalContent, 'utf8')
  ]);

  const helper = startHelper([
    targetPath,
    replacementPath,
    sha256(baseContent),
    sha256(candidateContent),
    '5000',
    '1500',
    '0'
  ]);
  t.after(() => {
    if (helper.isRunning()) helper.child.kill();
  });
  await helper.waitForRecord(record => record.status === 'guarded');

  await fsp.rename(targetPath, movedBasePath);
  await fsp.rename(externalReplacementPath, targetPath);
  const result = await helper.result;

  assert.equal(result.code, 3, result.stdout || result.stderr);
  assert.ok(
    result.records.some(record => record.status === 'conflict'),
    result.stdout || result.stderr
  );
  assert.equal(await fsp.readFile(targetPath, 'utf8'), externalContent);
});

test('an existing direct writer maps the sharing violation to busy', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const { baseContent, directory, targetPath } = await createFixture(t);
  const replacementPath = path.join(directory, 'candidate.tmp');
  const candidateContent = `${JSON.stringify({
    reviewDocumentId: 'native-helper-contract',
    revision: 2,
    source: 'candidate'
  })}\n`;
  await fsp.writeFile(replacementPath, candidateContent, 'utf8');
  const writer = await fsp.open(targetPath, 'r+');

  try {
    const helper = startHelper([
      targetPath,
      replacementPath,
      sha256(baseContent),
      sha256(candidateContent),
      '250'
    ]);
    t.after(() => {
      if (helper.isRunning()) helper.child.kill();
    });
    const result = await helper.result;

    assert.equal(result.code, 4, result.stdout || result.stderr);
    assert.ok(
      result.records.some(record => record.status === 'busy'),
      result.stdout || result.stderr
    );
    assert.equal(await fsp.readFile(targetPath, 'utf8'), baseContent);
  } finally {
    await writer.close();
  }
});

test('a concurrent helper lock owner maps to busy without changing the target', {
  skip: WINDOWS_ONLY,
  timeout: TEST_TIMEOUT_MS
}, async t => {
  const { baseContent, directory, targetPath } = await createFixture(t);
  const firstReplacementPath = path.join(directory, 'candidate-first.tmp');
  const secondReplacementPath = path.join(directory, 'candidate-second.tmp');
  const firstContent = `${JSON.stringify({
    reviewDocumentId: 'native-helper-contract',
    revision: 2,
    source: 'first'
  })}\n`;
  const secondContent = `${JSON.stringify({
    reviewDocumentId: 'native-helper-contract',
    revision: 3,
    source: 'second'
  })}\n`;
  await Promise.all([
    fsp.writeFile(firstReplacementPath, firstContent, 'utf8'),
    fsp.writeFile(secondReplacementPath, secondContent, 'utf8')
  ]);

  const lockOwner = startHelper([
    targetPath,
    firstReplacementPath,
    sha256(baseContent),
    sha256(firstContent),
    '5000',
    '5000',
    '0'
  ]);
  t.after(() => {
    if (lockOwner.isRunning()) lockOwner.child.kill();
  });
  await lockOwner.waitForRecord(record => record.status === 'guarded');

  const contender = startHelper([
    targetPath,
    secondReplacementPath,
    sha256(baseContent),
    sha256(secondContent),
    '100'
  ]);
  t.after(() => {
    if (contender.isRunning()) contender.child.kill();
  });
  const contenderResult = await contender.result;

  assert.equal(
    contenderResult.code,
    4,
    contenderResult.stdout || contenderResult.stderr
  );
  assert.ok(
    contenderResult.records.some(record => record.status === 'busy'),
    contenderResult.stdout || contenderResult.stderr
  );
  assert.equal(await fsp.readFile(targetPath, 'utf8'), baseContent);

  lockOwner.child.kill();
  await lockOwner.result;
});
