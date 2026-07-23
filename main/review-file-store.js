/**
 * Transactional .bframe storage.
 *
 * Cooperating BAEFRAME processes are serialized with a machine-local named
 * pipe. The final compare-and-replace is delegated to a tiny Win32 helper
 * which guards the target handle, compares its SHA-256, and replaces it in one
 * filesystem operation. A synced recovery sidecar and rollback copy make an
 * interrupted commit recoverable on the next read.
 */

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ABSENT_VERSION_TOKEN = '__ABSENT__';
const DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_RETRY_MIN_MS = 50;
const DEFAULT_LOCK_RETRY_MAX_MS = 250;
const DEFAULT_RENAME_RETRY_DELAYS_MS = Object.freeze([
  0,
  50,
  100,
  200,
  400,
  800
]);
const DEFAULT_POST_VERIFY_DELAYS_MS = Object.freeze([
  0,
  25,
  50,
  100,
  200,
  400
]);
const DEFAULT_RECOVERY_OWNER_STALE_MS = 2 * 60 * 1000;
const TRANSIENT_COMMIT_ERROR_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EPERM'
]);
const TRANSIENT_READ_ERROR_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EPERM',
  'ENOENT'
]);
const RECOVERY_SCHEMA_VERSION = 1;
const MAX_AUTO_RECOVERY_JSON_BYTES = 64 * 1024 * 1024;
const GENERATED_TEMP_REMAINDER_PATTERN =
  /^([1-9]\d*)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(\.(?:commit|prepare|restore))?$/;

function createReviewVersionToken(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isReviewVersionToken(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function normalizeReviewPath(filePath, platform = process.platform) {
  let resolved = path.resolve(filePath);
  if (platform === 'win32') {
    resolved = resolved
      .replace(/^\\\\\?\\UNC\\/i, '\\\\')
      .replace(/^\\\\\?\\/i, '');
    return resolved;
  }
  return resolved;
}

function createMachineToken(hostname = os.hostname()) {
  return crypto.createHash('sha256').update(hostname).digest('hex').slice(0, 12);
}

function artifactStem(filePath, platform = process.platform) {
  const fileName = path.basename(filePath);
  if (fileName.length <= 120) return fileName;
  const token = crypto
    .createHash('sha256')
    .update(normalizeReviewPath(filePath, platform))
    .digest('hex')
    .slice(0, 24);
  return `.baeframe-${token}`;
}

function recoverySidecarPath(filePath, platform = process.platform) {
  return path.join(
    path.dirname(filePath),
    `${artifactStem(filePath, platform)}.recovery.json`
  );
}

function createLockEndpoint(filePath, platform = process.platform) {
  const lockHash = crypto
    .createHash('sha256')
    .update(normalizeReviewPath(filePath, platform))
    .digest('hex');

  if (platform === 'win32') {
    return `\\\\.\\pipe\\baeframe-review-${lockHash}`;
  }
  if (platform === 'linux') {
    return `\0baeframe-review-${lockHash}`;
  }
  return path.join(os.tmpdir(), `baeframe-review-${lockHash}.sock`);
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minimum, maximum) {
  if (maximum <= minimum) return minimum;
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

function isMissingFileError(error) {
  return error?.code === 'ENOENT';
}

async function pathExists(fsPromises, filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

async function readTextOrNull(fsPromises, filePath) {
  try {
    return await fsPromises.readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function removeStaleUnixSocket(fsPromises, endpoint) {
  try {
    await fsPromises.unlink(endpoint);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function canConnectToEndpoint(endpoint) {
  return new Promise(resolve => {
    const socket = net.createConnection(endpoint);
    let settled = false;
    const finish = isLive => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(isLive);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

async function listenForReviewLock(endpoint, platform, fsPromises) {
  const server = net.createServer(socket => socket.destroy());
  server.unref();

  try {
    await new Promise((resolve, reject) => {
      const onError = error => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ path: endpoint, exclusive: true });
    });
    return server;
  } catch (error) {
    if (platform === 'darwin' && error?.code === 'EADDRINUSE') {
      const live = await canConnectToEndpoint(endpoint);
      if (!live) {
        await removeStaleUnixSocket(fsPromises, endpoint);
        const retryError = new Error('Stale review lock socket removed');
        retryError.code = 'EADDRINUSE';
        retryError.retryImmediately = true;
        throw retryError;
      }
    }
    throw error;
  }
}

function parseJsonLines(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      records.push(JSON.parse(line));
    } catch {
      // A malformed diagnostic line never changes the helper exit contract.
    }
  }
  return records;
}

function resolveDefaultCasHelperPath(fsModule = fs) {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(
      process.resourcesPath,
      'native',
      'ReviewFileCasHelper.exe'
    ));
  }
  candidates.push(path.resolve(
    __dirname,
    '..',
    'native',
    'review-file-cas-helper',
    'bin',
    'ReviewFileCasHelper.exe'
  ));
  return candidates.find(candidate => fsModule.existsSync(candidate)) ||
    candidates[candidates.length - 1];
}

function runCasHelper({
  helperPath,
  targetPath,
  replacementPath,
  expectedVersionToken,
  replacementVersionToken,
  transactionId,
  timeoutMs,
  execFileImpl = execFile
}) {
  return new Promise(resolve => {
    const args = [
      targetPath,
      replacementPath,
      expectedVersionToken,
      replacementVersionToken,
      String(timeoutMs)
    ];
    if (transactionId) {
      args.push('0', '0', transactionId);
    }
    execFileImpl(helperPath, args, {
      encoding: 'utf8',
      timeout: Math.max(timeoutMs + 5000, 10000),
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }, (error, stdout, stderr) => {
      const records = [
        ...parseJsonLines(stdout),
        ...parseJsonLines(stderr)
      ];
      const record = records[records.length - 1] || null;
      const numericExitCode = error === null
        ? 0
        : Number.isInteger(error?.code)
          ? error.code
          : null;

      if (numericExitCode === 0) {
        resolve({
          status: 'committed',
          record,
          records
        });
        return;
      }
      if (numericExitCode === 3) {
        resolve({
          status: 'conflict',
          record,
          records
        });
        return;
      }
      if (error?.killed === true) {
        resolve({
          status: 'indeterminate',
          record,
          records
        });
        return;
      }
      if (numericExitCode === 4) {
        resolve({
          status: 'busy',
          record,
          records
        });
        return;
      }
      if (numericExitCode === 5) {
        resolve({
          status: 'unsupported',
          record,
          records
        });
        return;
      }
      if (numericExitCode === 6) {
        resolve({
          status: 'replacement-mismatch',
          record,
          records
        });
        return;
      }
      if (numericExitCode === 7) {
        resolve({
          status: 'indeterminate',
          record,
          records
        });
        return;
      }
      resolve({
        status: 'error',
        error,
        record,
        records
      });
    });
  });
}

function createRecoveryRequiredError(message, details = {}) {
  const error = new Error(message);
  error.code = 'ERR_REVIEW_RECOVERY_REQUIRED';
  error.details = details;
  return error;
}

function createReviewFileStore(configuration = {}) {
  const fsPromises = configuration.fsPromises || fs.promises;
  const fsModule = configuration.fsModule || fs;
  const platform = configuration.platform || process.platform;
  const lockAcquireTimeoutMs = Number.isFinite(configuration.lockAcquireTimeoutMs)
    ? Math.max(0, configuration.lockAcquireTimeoutMs)
    : DEFAULT_LOCK_ACQUIRE_TIMEOUT_MS;
  const lockRetryMinMs = Number.isFinite(configuration.lockRetryMinMs)
    ? Math.max(1, configuration.lockRetryMinMs)
    : DEFAULT_LOCK_RETRY_MIN_MS;
  const lockRetryMaxMs = Number.isFinite(configuration.lockRetryMaxMs)
    ? Math.max(lockRetryMinMs, configuration.lockRetryMaxMs)
    : DEFAULT_LOCK_RETRY_MAX_MS;
  const renameRetryDelaysMs = Array.isArray(configuration.renameRetryDelaysMs)
    ? [...configuration.renameRetryDelaysMs]
    : [...DEFAULT_RENAME_RETRY_DELAYS_MS];
  const postVerifyDelaysMs = Array.isArray(configuration.postVerifyDelaysMs)
    ? [...configuration.postVerifyDelaysMs]
    : [...DEFAULT_POST_VERIFY_DELAYS_MS];
  const recoveryOwnerStaleMs =
    Number.isFinite(configuration.recoveryOwnerStaleMs)
      ? Math.max(0, configuration.recoveryOwnerStaleMs)
      : DEFAULT_RECOVERY_OWNER_STALE_MS;
  const now = typeof configuration.now === 'function'
    ? configuration.now
    : Date.now;
  const hooks = configuration.hooks || {};
  const machineToken = configuration.machineToken || createMachineToken();
  const casHelperPath = configuration.casHelperPath ||
    resolveDefaultCasHelperPath(fsModule);
  const atomicCompareAndReplace = configuration.atomicCompareAndReplace ||
    (parameters => runCasHelper({
      helperPath: casHelperPath,
      timeoutMs: lockAcquireTimeoutMs,
      execFileImpl: configuration.execFile || execFile,
      ...parameters
    }));
  const isProcessAlive = configuration.isProcessAlive || (pid => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error?.code !== 'ESRCH';
    }
  });
  const writeQueues = new Map();

  async function resolveCanonicalReviewPath(filePath) {
    const resolvedPath = path.resolve(filePath);
    try {
      return await fsPromises.realpath(resolvedPath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      try {
        const canonicalDirectory = await fsPromises.realpath(
          path.dirname(resolvedPath)
        );
        return path.join(
          canonicalDirectory,
          path.basename(resolvedPath)
        );
      } catch (directoryError) {
        if (!isMissingFileError(directoryError)) throw directoryError;
        return resolvedPath;
      }
    }
  }

  function queueKey(filePath) {
    return normalizeReviewPath(filePath, platform);
  }

  function enqueueWrite(filePath, operation) {
    const key = queueKey(filePath);
    const previous = writeQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    let tracked = null;
    tracked = current.finally(() => {
      if (writeQueues.get(key) === tracked) {
        writeQueues.delete(key);
      }
    });
    writeQueues.set(key, tracked);
    return tracked;
  }

  async function waitForPendingWrite(filePath) {
    const pending = writeQueues.get(queueKey(filePath));
    if (pending) await pending.catch(() => {});
  }

  async function acquireLock(filePath) {
    const endpoint = createLockEndpoint(filePath, platform);
    const startedAt = Date.now();

    while (true) {
      try {
        const server = await listenForReviewLock(
          endpoint,
          platform,
          fsPromises
        );
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          try {
            await closeServer(server);
          } finally {
            if (platform === 'darwin') {
              await removeStaleUnixSocket(fsPromises, endpoint);
            }
          }
        };
      } catch (error) {
        if (error?.code !== 'EADDRINUSE') throw error;
        const elapsed = Date.now() - startedAt;
        if (elapsed >= lockAcquireTimeoutMs) return null;
        if (!error.retryImmediately) {
          const waitMs = Math.min(
            randomDelay(lockRetryMinMs, lockRetryMaxMs),
            Math.max(0, lockAcquireTimeoutMs - elapsed)
          );
          await delay(waitMs);
        }
      }
    }
  }

  function genericTempPrefix(filePath) {
    const stem = artifactStem(filePath, platform);
    const hiddenStem = stem.startsWith('.') ? stem : `.${stem}`;
    return `${hiddenStem}.baeframe-tmp-`;
  }

  function tempPrefix(filePath) {
    return `${genericTempPrefix(filePath)}${machineToken}-`;
  }

  function createTempPath(filePath, suffix = '') {
    const randomToken = crypto.randomUUID();
    return path.join(
      path.dirname(filePath),
      `${tempPrefix(filePath)}${process.pid}-${randomToken}${suffix}`
    );
  }

  function createTransactionPaths(filePath, transactionId = crypto.randomUUID()) {
    const targetTempPath = createTempPath(filePath);
    return {
      transactionId,
      sidecarPath: recoverySidecarPath(filePath, platform),
      targetTempPath,
      commitTempPath: `${targetTempPath}.commit`,
      rollbackPath: path.join(
        path.dirname(filePath),
        `${artifactStem(filePath, platform)}.rollback.${transactionId}.bak`
      ),
      corruptedPath: path.join(
        path.dirname(filePath),
        `${artifactStem(filePath, platform)}.corrupted.${transactionId}`
      )
    };
  }

  async function unlinkIfPresent(filePath) {
    try {
      await fsPromises.unlink(filePath);
      return true;
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  async function readUtf8WithRetry(filePath) {
    let lastError = null;
    for (const waitMs of DEFAULT_POST_VERIFY_DELAYS_MS) {
      await delay(waitMs);
      try {
        return await fsPromises.readFile(filePath, 'utf8');
      } catch (error) {
        lastError = error;
        if (!TRANSIENT_READ_ERROR_CODES.has(error?.code)) throw error;
      }
    }
    throw lastError;
  }

  async function readTextOrNullWithRetry(filePath) {
    let lastError = null;
    for (const waitMs of DEFAULT_POST_VERIFY_DELAYS_MS) {
      await delay(waitMs);
      try {
        return await fsPromises.readFile(filePath, 'utf8');
      } catch (error) {
        lastError = error;
        if (!TRANSIENT_READ_ERROR_CODES.has(error?.code)) throw error;
      }
    }
    if (isMissingFileError(lastError)) return null;
    throw lastError;
  }

  async function cleanupPathsBestEffort(paths) {
    for (const filePath of paths.filter(Boolean)) {
      try {
        await unlinkIfPresent(filePath);
      } catch {
        // Verified main/rollback data takes priority over residue cleanup.
      }
    }
  }

  function normalizeArtifactName(artifactName) {
    return artifactName;
  }

  function artifactNamesEqual(left, right) {
    return typeof left === 'string' &&
      typeof right === 'string' &&
      normalizeArtifactName(left) === normalizeArtifactName(right);
  }

  function artifactNameStartsWith(artifactName, prefix) {
    return typeof artifactName === 'string' &&
      typeof prefix === 'string' &&
      normalizeArtifactName(artifactName).startsWith(
        normalizeArtifactName(prefix)
      );
  }

  async function cleanupOrphanTemps(filePath) {
    const directory = path.dirname(filePath);
    const tempFamilies = [
      {
        prefix: tempPrefix(filePath),
        suffixes: new Set(['', '.commit', '.restore'])
      },
      {
        prefix: tempPrefix(recoverySidecarPath(filePath, platform)),
        suffixes: new Set(['.prepare'])
      }
    ];
    let entries;
    try {
      entries = await fsPromises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) return;
      throw error;
    }

    await Promise.all(entries
      .filter(entry => {
        if (!entry.isFile()) return false;
        const family = tempFamilies.find(candidate =>
          artifactNameStartsWith(entry.name, candidate.prefix)
        );
        if (!family) return false;
        const remainder = entry.name.slice(family.prefix.length);
        const match = GENERATED_TEMP_REMAINDER_PATTERN.exec(remainder);
        if (!match || !family.suffixes.has(match[2] || '')) return false;
        const ownerPid = Number(match[1]);
        if (!Number.isSafeInteger(ownerPid)) return false;
        return ownerPid === process.pid || !isProcessAlive(ownerPid);
      })
      .map(async entry => {
        try {
          await fsPromises.unlink(path.join(directory, entry.name));
        } catch {
          // A locked orphan will be retried on the next save.
        }
      }));
  }

  async function readCasBackupStates(filePath, transactionId) {
    if (typeof transactionId !== 'string' ||
        !/^[0-9a-f-]{16,64}$/i.test(transactionId)) {
      return [];
    }
    const directory = path.dirname(filePath);
    const prefix = `.baeframe-cas.backup-${transactionId}-`;
    let entries;
    try {
      entries = await fsPromises.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
    const states = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
      const backupPath = path.join(directory, entry.name);
      let stats;
      try {
        stats = await fsPromises.stat(backupPath);
      } catch (error) {
        if (isMissingFileError(error)) continue;
        throw error;
      }
      let versionToken;
      try {
        versionToken = await new Promise((resolve, reject) => {
          const hash = crypto.createHash('sha256');
          const stream = fsModule.createReadStream(backupPath);
          stream.on('data', chunk => hash.update(chunk));
          stream.once('error', reject);
          stream.once('end', () => resolve(hash.digest('hex')));
        });
      } catch (error) {
        if (isMissingFileError(error)) continue;
        throw error;
      }
      let content = null;
      let data = null;
      let jsonValid = false;
      if (stats.size <= MAX_AUTO_RECOVERY_JSON_BYTES) {
        try {
          content = await readUtf8WithRetry(backupPath);
          data = JSON.parse(content);
          jsonValid = true;
        } catch (error) {
          if (isMissingFileError(error)) continue;
          jsonValid = false;
        }
      }
      states.push({
        path: backupPath,
        content,
        data,
        jsonValid,
        size: stats.size,
        versionToken
      });
    }
    return states;
  }

  async function cleanupCasBackups(
    filePath,
    safeVersionTokens = [],
    transactionId
  ) {
    const safeTokens = new Set(safeVersionTokens.filter(Boolean));
    const states = await readCasBackupStates(filePath, transactionId);
    await Promise.all(states
      .filter(state => safeTokens.has(state.versionToken))
      .map(state => unlinkIfPresent(state.path).catch(() => false)));
  }

  async function writeSyncedVerifiedArtifact(
    filePath,
    content,
    { jsonRequired = false } = {}
  ) {
    let fileHandle = null;
    try {
      fileHandle = await fsPromises.open(filePath, 'wx', 0o600);
      await fileHandle.writeFile(content, 'utf8');
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = null;

      const verifiedContent = await readUtf8WithRetry(filePath);
      if (jsonRequired) JSON.parse(verifiedContent);
      const expectedToken = createReviewVersionToken(content);
      if (createReviewVersionToken(verifiedContent) !== expectedToken) {
        const error = new Error('Review artifact verification failed');
        error.code = 'ERR_REVIEW_ARTIFACT_VERIFY';
        throw error;
      }
      return expectedToken;
    } catch (error) {
      if (fileHandle) {
        try {
          await fileHandle.close();
        } catch {
          // Preserve the original write or verification error.
        }
      }
      throw error;
    }
  }

  function assertSafeArtifactName(filePath, artifactName, prefix) {
    if (typeof artifactName !== 'string' ||
        path.basename(artifactName) !== artifactName ||
        !artifactNameStartsWith(artifactName, prefix)) {
      throw createRecoveryRequiredError(
        'Review recovery artifact path is invalid',
        { filePath, artifactName }
      );
    }
    return path.join(path.dirname(filePath), artifactName);
  }

  function pathsFromSidecar(filePath, sidecar) {
    const transactionId = sidecar?.transactionId;
    if (typeof transactionId !== 'string' ||
        !/^[0-9a-f-]{16,64}$/i.test(transactionId)) {
      throw createRecoveryRequiredError(
        'Review recovery transaction id is invalid',
        { filePath }
      );
    }
    if (sidecar.fileName &&
        !artifactNamesEqual(sidecar.fileName, path.basename(filePath))) {
      throw createRecoveryRequiredError(
        'Review recovery sidecar targets a different file',
        { filePath }
      );
    }
    const targetTempPath = assertSafeArtifactName(
      filePath,
      sidecar?.artifacts?.targetTempName,
      genericTempPrefix(filePath)
    );
    let commitTempPath = null;
    if (sidecar?.artifacts?.commitTempName) {
      commitTempPath = assertSafeArtifactName(
        filePath,
        sidecar.artifacts.commitTempName,
        genericTempPrefix(filePath)
      );
    }
    const rollbackName =
      `${artifactStem(filePath, platform)}.rollback.${transactionId}.bak`;
    if (!artifactNamesEqual(
      sidecar?.artifacts?.rollbackName,
      rollbackName
    )) {
      throw createRecoveryRequiredError(
        'Review rollback artifact path is invalid',
        { filePath }
      );
    }
    return {
      transactionId,
      sidecarPath: recoverySidecarPath(filePath, platform),
      targetTempPath,
      commitTempPath,
      rollbackPath: path.join(path.dirname(filePath), rollbackName),
      corruptedPath: path.join(
        path.dirname(filePath),
        `${artifactStem(filePath, platform)}.corrupted.${transactionId}`
      )
    };
  }

  async function readRecoverySidecar(filePath) {
    const sidecarPath = recoverySidecarPath(filePath, platform);
    const content = await readTextOrNull(fsPromises, sidecarPath);
    if (content === null) return null;
    let sidecarStats = null;
    try {
      sidecarStats = await fsPromises.stat(sidecarPath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    let sidecar;
    try {
      sidecar = JSON.parse(content);
    } catch (error) {
      const recoveryError = createRecoveryRequiredError(
        'Review recovery sidecar is malformed',
        { filePath, cause: error.message }
      );
      const ageMs = sidecarStats
        ? Math.max(0, now() - sidecarStats.mtimeMs)
        : 0;
      if (ageMs >= recoveryOwnerStaleMs) {
        recoveryError.code = 'ERR_REVIEW_STALE_MALFORMED_SIDECAR';
        recoveryError.details.ageMs = ageMs;
      }
      throw recoveryError;
    }
    const sidecarAgeMs = sidecarStats
      ? Math.max(0, now() - sidecarStats.mtimeMs)
      : 0;
    if (sidecar?.schemaVersion !== RECOVERY_SCHEMA_VERSION ||
        sidecar?.state !== 'prepared' ||
        !sidecar?.base ||
        !isReviewVersionToken(sidecar?.target?.versionToken)) {
      const recoveryError = createRecoveryRequiredError(
        'Review recovery sidecar is unsupported',
        { filePath }
      );
      if (sidecarAgeMs >= recoveryOwnerStaleMs) {
        recoveryError.code = 'ERR_REVIEW_STALE_MALFORMED_SIDECAR';
        recoveryError.details.ageMs = sidecarAgeMs;
      }
      throw recoveryError;
    }
    const preparedAtMs = Date.parse(sidecar.preparedAt);
    const preparedAgeMs = Number.isFinite(preparedAtMs)
      ? Math.max(0, now() - preparedAtMs)
      : sidecarAgeMs;
    const ownerIsStale =
      sidecarAgeMs >= recoveryOwnerStaleMs &&
      preparedAgeMs >= recoveryOwnerStaleMs;
    if (sidecar.ownerMachineToken !== machineToken && !ownerIsStale) {
      const error = new Error(
        'Review transaction on another computer is still active'
      );
      error.code = 'ERR_REVIEW_TRANSACTION_ACTIVE';
      error.ownerMachineToken = sidecar.ownerMachineToken;
      error.foreignOwner = true;
      throw error;
    }
    if (sidecar.ownerMachineToken === machineToken &&
        sidecar.ownerPid !== process.pid &&
        isProcessAlive(sidecar.ownerPid)) {
      const error = new Error('Review transaction is still active');
      error.code = 'ERR_REVIEW_TRANSACTION_ACTIVE';
      error.ownerPid = sidecar.ownerPid;
      throw error;
    }
    return sidecar;
  }

  async function readVerifiedArtifact(
    filePath,
    expectedVersionToken,
    { jsonRequired = false } = {}
  ) {
    const content = await readTextOrNull(fsPromises, filePath);
    if (content === null) return null;
    if (createReviewVersionToken(content) !== expectedVersionToken) {
      throw createRecoveryRequiredError(
        'Review recovery artifact hash does not match',
        { filePath }
      );
    }
    if (jsonRequired) {
      try {
        JSON.parse(content);
      } catch (error) {
        throw createRecoveryRequiredError(
          'Review recovery artifact JSON is malformed',
          { filePath, cause: error.message }
        );
      }
    }
    return content;
  }

  async function writeRecoverySidecar(filePath, manifest) {
    const sidecarPath = recoverySidecarPath(filePath, platform);
    const sidecarTempPath = createTempPath(sidecarPath, '.prepare');
    const serialized = JSON.stringify(manifest, null, 2);
    const sidecarVersionToken = createReviewVersionToken(serialized);
    try {
      await writeSyncedVerifiedArtifact(
        sidecarTempPath,
        serialized,
        { jsonRequired: true }
      );
      await hooks.afterRecoverySidecarTempSynced?.({
        filePath,
        sidecarPath,
        sidecarTempPath
      });
      const publishResult = await atomicCompareAndReplace({
        targetPath: sidecarPath,
        replacementPath: sidecarTempPath,
        expectedVersionToken: ABSENT_VERSION_TOKEN,
        replacementVersionToken: sidecarVersionToken,
        transactionId: manifest.transactionId
      });
      if (publishResult?.status === 'committed') return;
      if (publishResult?.status === 'conflict') {
        const error = new Error('Review recovery sidecar already exists');
        error.code = 'EEXIST';
        throw error;
      }
      if (publishResult?.status === 'busy') {
        const error = new Error('Review recovery sidecar is busy');
        error.code = 'EBUSY';
        throw error;
      }
      if (publishResult?.status === 'indeterminate') {
        const publishedContent = await readTextOrNullWithRetry(sidecarPath);
        if (publishedContent !== null &&
            createReviewVersionToken(publishedContent) ===
              sidecarVersionToken) {
          JSON.parse(publishedContent);
          return;
        }
        if (publishedContent === null) {
          const error = new Error(
            'Review recovery sidecar publication is retryable'
          );
          error.code = 'EBUSY';
          throw error;
        }
        const error = new Error('Another review recovery sidecar won');
        error.code = 'EEXIST';
        throw error;
      }
      throw createRecoveryRequiredError(
        'Review recovery sidecar could not be published atomically',
        { filePath, publishResult }
      );
    } finally {
      await cleanupPathsBestEffort([sidecarTempPath]);
    }
  }

  async function waitForRecoverySlot(filePath, manifest) {
    const startedAt = Date.now();
    while (true) {
      try {
        await writeRecoverySidecar(filePath, manifest);
        return true;
      } catch (error) {
        const contentionCode = error?.code === 'EEXIST' ||
          TRANSIENT_COMMIT_ERROR_CODES.has(error?.code);
        if (!contentionCode) throw error;
      }

      const sidecarPath = recoverySidecarPath(filePath, platform);
      let existingContent;
      try {
        existingContent = await readTextOrNull(fsPromises, sidecarPath);
      } catch (error) {
        if (!TRANSIENT_COMMIT_ERROR_CODES.has(error?.code)) throw error;
        existingContent = undefined;
      }
      if (existingContent === null) continue;
      let existing = null;
      try {
        existing = JSON.parse(existingContent);
      } catch {
        // The owner may still be flushing the sidecar. Wait before judging it.
      }

      if (existing?.ownerMachineToken === machineToken &&
          existing?.ownerPid === process.pid &&
          existing?.transactionId === manifest.transactionId) {
        return true;
      }

      const sameMachine = existing?.ownerMachineToken === machineToken;
      const ownerAlive = sameMachine && isProcessAlive(existing?.ownerPid);
      if (sameMachine && !ownerAlive) {
        try {
          await recoverPreparedTransactionUnderLock(filePath);
        } catch (error) {
          if (error?.code !== 'ERR_REVIEW_RECOVERY_REQUIRED') throw error;
        }
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= lockAcquireTimeoutMs) return false;
      await delay(Math.min(50, lockAcquireTimeoutMs - elapsed));
    }
  }

  async function verifyMainState(filePath, targetVersionToken) {
    const delays = postVerifyDelaysMs.length > 0
      ? postVerifyDelaysMs
      : [0];
    let lastError = null;

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      await delay(Math.max(0, Number(delays[attempt]) || 0));
      try {
        const content = await readTextOrNull(fsPromises, filePath);
        if (content === null) {
          lastError = null;
          continue;
        }
        const versionToken = createReviewVersionToken(content);
        let data;
        try {
          data = JSON.parse(content);
        } catch (error) {
          return {
            state: 'malformed',
            content,
            versionToken,
            error
          };
        }
        return {
          state: versionToken === targetVersionToken ? 'target' : 'third',
          content,
          versionToken,
          data
        };
      } catch (error) {
        lastError = error;
        if (!TRANSIENT_READ_ERROR_CODES.has(error?.code)) throw error;
      }
    }

    if (lastError && lastError.code !== 'ENOENT') {
      return { state: 'unreadable', error: lastError };
    }
    return { state: 'missing', content: null, versionToken: null };
  }

  async function commitWithRetry({
    filePath,
    replacementPath,
    expectedVersionToken,
    replacementVersionToken,
    failIfExists,
    transactionId
  }) {
    const delays = renameRetryDelaysMs.length > 0
      ? renameRetryDelaysMs
      : [0];

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      await delay(Math.max(0, Number(delays[attempt]) || 0));
      try {
        await hooks.onRenameAttempt?.({
          attempt,
          filePath,
          tempPath: replacementPath
        });
      } catch (error) {
        if (!TRANSIENT_COMMIT_ERROR_CODES.has(error?.code)) throw error;
        if (attempt === delays.length - 1) {
          return {
            success: false,
            retryable: true,
            reason: 'target-busy'
          };
        }
        const currentContent = await readTextOrNull(fsPromises, filePath);
        const currentVersionToken = currentContent === null
          ? ABSENT_VERSION_TOKEN
          : createReviewVersionToken(currentContent);
        if (currentVersionToken !== expectedVersionToken) {
          return failIfExists
            ? { success: false, exists: true }
            : {
              success: false,
              conflict: true,
              reason: 'stale-version-token'
            };
        }
        continue;
      }

      const casResult = await atomicCompareAndReplace({
        targetPath: filePath,
        replacementPath,
        expectedVersionToken,
        replacementVersionToken,
        transactionId
      });
      if (casResult?.status === 'committed') {
        return { success: true, casResult };
      }
      if (casResult?.status === 'conflict') {
        return failIfExists
          ? { success: false, exists: true }
          : {
            success: false,
            conflict: true,
            reason: 'stale-version-token'
          };
      }
      if (casResult?.status === 'busy') {
        if (attempt === delays.length - 1) {
          return {
            success: false,
            retryable: true,
            reason: 'target-busy'
          };
        }
        continue;
      }
      if (casResult?.status === 'indeterminate') {
        return {
          success: false,
          indeterminate: true,
          reason: 'post-write-indeterminate',
          casResult
        };
      }
      if (casResult?.status === 'unsupported') {
        return {
          success: false,
          fatal: true,
          reason: 'atomic-replace-unsupported',
          casResult
        };
      }
      if (casResult?.status === 'replacement-mismatch') {
        return {
          success: false,
          fatal: true,
          reason: 'replacement-mismatch',
          casResult
        };
      }
      return {
        success: false,
        fatal: true,
        reason: 'atomic-replace-failed',
        casResult
      };
    }

    return {
      success: false,
      retryable: true,
      reason: 'target-busy'
    };
  }

  async function createCorruptedCopy(paths, content) {
    if (content === null || content === undefined) return null;
    if (await pathExists(fsPromises, paths.corruptedPath)) {
      const existing = await fsPromises.readFile(paths.corruptedPath, 'utf8');
      if (existing !== content) {
        throw createRecoveryRequiredError(
          'Existing corrupted review copy differs',
          { filePath: paths.corruptedPath }
        );
      }
      return paths.corruptedPath;
    }
    await writeSyncedVerifiedArtifact(paths.corruptedPath, content);
    return paths.corruptedPath;
  }

  async function restoreRollbackUnderLock({
    filePath,
    sidecar,
    paths,
    currentState
  }) {
    if (sidecar.base?.exists !== true ||
        !isReviewVersionToken(sidecar.base?.versionToken)) {
      return {
        success: false,
        fatal: true,
        reason: 'rollback-failed'
      };
    }

    let rollbackContent;
    try {
      rollbackContent = await readVerifiedArtifact(
        paths.rollbackPath,
        sidecar.base.versionToken,
        { jsonRequired: sidecar.base.jsonValid === true }
      );
    } catch {
      return {
        success: false,
        fatal: true,
        reason: 'rollback-failed'
      };
    }
    if (rollbackContent === null) {
      return {
        success: false,
        fatal: true,
        reason: 'rollback-failed'
      };
    }

    let corruptedPath = null;
    try {
      if (currentState?.content !== null &&
          currentState?.content !== undefined) {
        corruptedPath = await createCorruptedCopy(paths, currentState.content);
      }
      await hooks.beforeRollbackRestore?.({
        filePath,
        rollbackPath: paths.rollbackPath,
        corruptedPath
      });
      const restoreTempPath = createTempPath(filePath, '.restore');
      try {
        await writeSyncedVerifiedArtifact(
          restoreTempPath,
          rollbackContent,
          { jsonRequired: sidecar.base.jsonValid === true }
        );
        const expectedVersionToken = currentState?.content === null ||
          currentState?.content === undefined
          ? ABSENT_VERSION_TOKEN
          : createReviewVersionToken(currentState.content);
        const restoreResult = await atomicCompareAndReplace({
          targetPath: filePath,
          replacementPath: restoreTempPath,
          expectedVersionToken,
          replacementVersionToken: sidecar.base.versionToken,
          transactionId: sidecar.transactionId
        });
        if (restoreResult?.status !== 'committed') {
          return {
            success: false,
            fatal: true,
            reason: 'rollback-failed',
            casResult: restoreResult
          };
        }
      } finally {
        await cleanupPathsBestEffort([restoreTempPath]);
      }

      const restoredState = await verifyMainState(
        filePath,
        sidecar.base.versionToken
      );
      if (restoredState.state !== 'target') {
        return {
          success: false,
          fatal: true,
          reason: 'rollback-failed'
        };
      }
      await hooks.afterRollbackRestore?.({
        filePath,
        corruptedPath
      });
      return {
        success: false,
        recovered: true,
        reason: 'post-write-rolled-back',
        corruptedPath
      };
    } catch {
      return {
        success: false,
        fatal: true,
        reason: 'rollback-failed',
        corruptedPath
      };
    }
  }

  async function cleanupTransaction(paths) {
    await cleanupPathsBestEffort([
      paths.targetTempPath,
      paths.commitTempPath,
      paths.rollbackPath,
      paths.sidecarPath
    ]);
  }

  async function preserveMalformedRollback(sidecar, paths) {
    if (sidecar.operation !== 'malformed-backup-recovery') return null;
    const rollbackContent = await readVerifiedArtifact(
      paths.rollbackPath,
      sidecar.base.versionToken
    );
    if (rollbackContent === null) {
      throw createRecoveryRequiredError(
        'Malformed review rollback is missing',
        { filePath: paths.rollbackPath }
      );
    }
    return createCorruptedCopy(paths, rollbackContent);
  }

  async function restoreDisplacedExternalBackupUnderLock({
    filePath,
    currentVersionToken,
    backupState,
    transactionId
  }) {
    const restoreResult = await atomicCompareAndReplace({
      targetPath: filePath,
      replacementPath: backupState.path,
      expectedVersionToken: currentVersionToken,
      replacementVersionToken: backupState.versionToken,
      transactionId
    });
    if (restoreResult?.status !== 'committed') {
      throw createRecoveryRequiredError(
        'A displaced external review version could not be restored',
        { filePath, restoreResult }
      );
    }
    const restoredState = await verifyMainState(
      filePath,
      backupState.versionToken
    );
    if (restoredState.state !== 'target') {
      throw createRecoveryRequiredError(
        'A displaced external review version failed verification',
        { filePath, restoredState: restoredState.state }
      );
    }
    return {
      data: restoredState.data,
      versionToken: backupState.versionToken
    };
  }

  async function restoreUnexpectedCasBackupUnderLock({
    filePath,
    currentVersionToken,
    knownVersionTokens,
    transactionId
  }) {
    const unexpectedBackups = (await readCasBackupStates(
      filePath,
      transactionId
    ))
      .filter(state => !knownVersionTokens.includes(state.versionToken));
    if (unexpectedBackups.length === 0) return null;

    const uniqueUnexpectedTokens = new Set(
      unexpectedBackups.map(state => state.versionToken)
    );
    const externalBackup = unexpectedBackups.find(state => state.jsonValid);
    if (uniqueUnexpectedTokens.size !== 1 || !externalBackup) {
      throw createRecoveryRequiredError(
        'Multiple displaced review versions require manual recovery',
        { filePath }
      );
    }
    return restoreDisplacedExternalBackupUnderLock({
      filePath,
      currentVersionToken,
      backupState: externalBackup,
      transactionId
    });
  }

  async function quarantineStaleMalformedSidecar(filePath, originalError) {
    const sidecarPath = recoverySidecarPath(filePath, platform);
    const [sidecarContent, currentContent] = await Promise.all([
      readTextOrNullWithRetry(sidecarPath),
      readTextOrNullWithRetry(filePath)
    ]);
    if (sidecarContent === null || currentContent === null) {
      throw originalError;
    }
    let currentData;
    try {
      currentData = JSON.parse(currentContent);
    } catch {
      throw originalError;
    }

    const quarantinePath =
      `${sidecarPath}.corrupted-${machineToken}-${process.pid}-` +
      crypto.randomUUID();
    const sidecarVersionToken = createReviewVersionToken(sidecarContent);
    const quarantineResult = await atomicCompareAndReplace({
      targetPath: quarantinePath,
      replacementPath: sidecarPath,
      expectedVersionToken: ABSENT_VERSION_TOKEN,
      replacementVersionToken: sidecarVersionToken
    });
    if (quarantineResult?.status !== 'committed') {
      throw createRecoveryRequiredError(
        'Stale malformed recovery sidecar could not be quarantined',
        { filePath, quarantineResult }
      );
    }
    return {
      action: 'quarantined-stale-sidecar',
      quarantinePath,
      data: currentData,
      versionToken: createReviewVersionToken(currentContent)
    };
  }

  async function recoverPreparedTransactionUnderLock(filePath) {
    let sidecar;
    try {
      sidecar = await readRecoverySidecar(filePath);
    } catch (error) {
      if (error?.code !== 'ERR_REVIEW_STALE_MALFORMED_SIDECAR') {
        throw error;
      }
      return quarantineStaleMalformedSidecar(filePath, error);
    }
    if (!sidecar) return null;
    const paths = pathsFromSidecar(filePath, sidecar);

    const targetTempContent = await readTextOrNull(
      fsPromises,
      paths.targetTempPath
    );
    if (targetTempContent !== null &&
        createReviewVersionToken(targetTempContent) !==
          sidecar.target.versionToken) {
      throw createRecoveryRequiredError(
        'Prepared review candidate is damaged',
        { filePath: paths.targetTempPath }
      );
    }

    const currentContent = await readTextOrNullWithRetry(filePath);
    const currentVersionToken = currentContent === null
      ? null
      : createReviewVersionToken(currentContent);
    let currentData = null;
    let currentJsonValid = false;
    if (currentContent !== null) {
      try {
        currentData = JSON.parse(currentContent);
        currentJsonValid = true;
      } catch {
        currentJsonValid = false;
      }
    }

    if (currentVersionToken === sidecar.target.versionToken &&
        currentJsonValid) {
      const knownTokens = [
        sidecar.base.versionToken,
        sidecar.target.versionToken
      ].filter(Boolean);
      const restoredExternal = await restoreUnexpectedCasBackupUnderLock({
        filePath,
        currentVersionToken,
        knownVersionTokens: knownTokens,
        transactionId: paths.transactionId
      });
      if (restoredExternal) {
        await cleanupCasBackups(filePath, [
          ...knownTokens,
          restoredExternal.versionToken
        ], paths.transactionId);
        await cleanupTransaction(paths);
        return {
          action: 'superseded-by-external',
          data: restoredExternal.data,
          versionToken: restoredExternal.versionToken
        };
      }
      const corruptedPath = await preserveMalformedRollback(sidecar, paths);
      await hooks.beforeRecoveryCommit?.({ filePath, sidecar });
      await cleanupCasBackups(
        filePath,
        knownTokens,
        paths.transactionId
      );
      await cleanupTransaction(paths);
      return {
        action: sidecar.operation === 'malformed-backup-recovery'
          ? 'restored-backup'
          : 'completed-commit',
        corruptedPath,
        data: currentData,
        versionToken: currentVersionToken
      };
    }

    if ((sidecar.base.exists === true &&
          currentVersionToken === sidecar.base.versionToken &&
          (sidecar.base.jsonValid !== true || currentJsonValid)) ||
        (sidecar.base.exists !== true && currentContent === null)) {
      await cleanupCasBackups(filePath, [
        sidecar.base.versionToken,
        sidecar.target.versionToken
      ], paths.transactionId);
      await cleanupTransaction(paths);
      return {
        action: 'discarded-uncommitted',
        data: currentData,
        versionToken: currentVersionToken
      };
    }

    if (sidecar.base.exists === true &&
        (currentContent === null || !currentJsonValid)) {
      await readVerifiedArtifact(
        paths.rollbackPath,
        sidecar.base.versionToken,
        { jsonRequired: sidecar.base.jsonValid === true }
      );
      const currentState = {
        state: currentContent === null ? 'missing' : 'malformed',
        content: currentContent,
        versionToken: currentVersionToken
      };
      const restored = await restoreRollbackUnderLock({
        filePath,
        sidecar,
        paths,
        currentState
      });
      if (restored.recovered !== true) {
        throw createRecoveryRequiredError(
          'Prepared review transaction could not be rolled back',
          { filePath, result: restored }
        );
      }
      await cleanupCasBackups(filePath, [
        sidecar.base.versionToken,
        sidecar.target.versionToken,
        currentVersionToken
      ], paths.transactionId);
      await cleanupTransaction(paths);
      const restoredContent = await fsPromises.readFile(filePath, 'utf8');
      return {
        action: 'restored-rollback',
        corruptedPath: restored.corruptedPath,
        data: JSON.parse(restoredContent),
        versionToken: createReviewVersionToken(restoredContent)
      };
    }

    if (currentJsonValid) {
      const knownTokens = [
        sidecar.base.versionToken,
        sidecar.target.versionToken,
        currentVersionToken
      ].filter(Boolean);
      const unexpectedBackups = (await readCasBackupStates(
        filePath,
        paths.transactionId
      ))
        .filter(state => !knownTokens.includes(state.versionToken));
      if (unexpectedBackups.length > 0) {
        throw createRecoveryRequiredError(
          'Conflicting external review backups require manual recovery',
          { filePath }
        );
      }
      await cleanupCasBackups(
        filePath,
        knownTokens,
        paths.transactionId
      );
      await cleanupTransaction(paths);
      return {
        action: 'superseded-by-external',
        data: currentData,
        versionToken: currentVersionToken
      };
    }

    throw createRecoveryRequiredError(
      'A different valid review version exists beside recovery data',
      {
        filePath,
        currentVersionToken,
        baseVersionToken: sidecar.base.versionToken,
        targetVersionToken: sidecar.target.versionToken
      }
    );
  }

  async function waitForRecoverableTransactionUnderLock(filePath) {
    const startedAt = Date.now();
    while (true) {
      try {
        return {
          timedOut: false,
          recovery: await recoverPreparedTransactionUnderLock(filePath)
        };
      } catch (error) {
        if (error?.code !== 'ERR_REVIEW_TRANSACTION_ACTIVE') throw error;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= lockAcquireTimeoutMs) {
        return {
          timedOut: true,
          recovery: null
        };
      }
      await delay(Math.min(50, lockAcquireTimeoutMs - elapsed));
    }
  }

  async function commitSerializedUnderLock({
    filePath,
    serialized,
    data,
    baseContent,
    baseJsonValid,
    failIfExists,
    operation
  }) {
    const versionToken = createReviewVersionToken(serialized);
    const baseVersionToken = baseContent === null
      ? null
      : createReviewVersionToken(baseContent);
    const paths = createTransactionPaths(filePath);
    let prepared = false;

    try {
      await writeSyncedVerifiedArtifact(
        paths.targetTempPath,
        serialized,
        { jsonRequired: true }
      );
      await hooks.afterTempSynced?.({
        filePath,
        tempPath: paths.targetTempPath
      });
      await writeSyncedVerifiedArtifact(
        paths.commitTempPath,
        serialized,
        { jsonRequired: true }
      );

      const manifest = {
        schemaVersion: RECOVERY_SCHEMA_VERSION,
        state: 'prepared',
        operation,
        transactionId: paths.transactionId,
        ownerMachineToken: machineToken,
        ownerPid: process.pid,
        preparedAt: new Date().toISOString(),
        fileName: path.basename(filePath),
        base: {
          exists: baseContent !== null,
          versionToken: baseVersionToken,
          jsonValid: baseJsonValid === true
        },
        target: {
          versionToken,
          reviewDocumentId: typeof data?.reviewDocumentId === 'string'
            ? data.reviewDocumentId
            : null
        },
        artifacts: {
          targetTempName: path.basename(paths.targetTempPath),
          commitTempName: path.basename(paths.commitTempPath),
          rollbackName: path.basename(paths.rollbackPath)
        }
      };
      const acquiredRecoverySlot = await waitForRecoverySlot(
        filePath,
        manifest
      );
      if (!acquiredRecoverySlot) {
        await cleanupPathsBestEffort([
          paths.targetTempPath,
          paths.commitTempPath
        ]);
        return {
          success: false,
          retryable: true,
          reason: 'lock-timeout'
        };
      }
      prepared = true;
      await hooks.afterRecoveryPrepared?.({
        filePath,
        sidecarPath: paths.sidecarPath
      });

      if (baseContent !== null) {
        await writeSyncedVerifiedArtifact(
          paths.rollbackPath,
          baseContent,
          { jsonRequired: baseJsonValid === true }
        );
      }
      await hooks.afterRollbackPrepared?.({
        filePath,
        rollbackPath: baseContent === null ? null : paths.rollbackPath
      });

      const currentBeforeCommit = await readTextOrNull(fsPromises, filePath);
      const currentBeforeCommitToken = currentBeforeCommit === null
        ? null
        : createReviewVersionToken(currentBeforeCommit);
      if (currentBeforeCommitToken !== baseVersionToken) {
        await cleanupTransaction(paths);
        return failIfExists
          ? { success: false, exists: true }
          : {
            success: false,
            conflict: true,
            reason: 'stale-version-token'
          };
      }
      await hooks.beforeCommitRecheck?.({
        filePath,
        tempPath: paths.commitTempPath
      });

      const commitResult = await commitWithRetry({
        filePath,
        replacementPath: paths.commitTempPath,
        expectedVersionToken: baseContent === null
          ? ABSENT_VERSION_TOKEN
          : baseVersionToken,
        replacementVersionToken: versionToken,
        failIfExists,
        transactionId: paths.transactionId
      });

      if (commitResult.success !== true &&
          commitResult.indeterminate !== true) {
        if (commitResult.fatal !== true ||
            commitResult.reason === 'replacement-mismatch' ||
            commitResult.reason === 'atomic-replace-unsupported') {
          await cleanupCasBackups(filePath, [
            baseVersionToken,
            versionToken
          ], paths.transactionId);
          await cleanupTransaction(paths);
        }
        return commitResult;
      }

      await hooks.afterReplace?.({ filePath });
      const persistedState = await verifyMainState(filePath, versionToken);
      if (persistedState.state === 'target') {
        const knownTokens = [
          baseVersionToken,
          versionToken
        ].filter(Boolean);
        const restoredExternal = await restoreUnexpectedCasBackupUnderLock({
          filePath,
          currentVersionToken: versionToken,
          knownVersionTokens: knownTokens,
          transactionId: paths.transactionId
        });
        if (restoredExternal) {
          await cleanupCasBackups(filePath, [
            ...knownTokens,
            restoredExternal.versionToken
          ], paths.transactionId);
          await cleanupTransaction(paths);
          return {
            success: false,
            conflict: true,
            reason: 'superseded-by-external',
            versionToken: restoredExternal.versionToken
          };
        }
        const corruptedPath = await preserveMalformedRollback(
          manifest,
          paths
        );
        await hooks.beforeRecoveryCommit?.({
          filePath,
          sidecar: manifest
        });
        await cleanupCasBackups(filePath, [
          baseVersionToken,
          versionToken
        ], paths.transactionId);
        await cleanupTransaction(paths);
        return {
          success: true,
          versionToken,
          recovery: operation === 'malformed-backup-recovery'
            ? {
              action: 'restored-backup',
              corruptedPath
            }
            : undefined
        };
      }

      if (persistedState.state === 'missing' ||
          persistedState.state === 'malformed') {
        const rollbackResult = await restoreRollbackUnderLock({
          filePath,
          sidecar: manifest,
          paths,
          currentState: persistedState
        });
        if (rollbackResult.recovered === true) {
          await cleanupCasBackups(filePath, [
            baseVersionToken,
            versionToken
          ], paths.transactionId);
          await cleanupTransaction(paths);
        }
        return rollbackResult;
      }

      if (persistedState.state === 'third') {
        const safeTokens = [
          baseVersionToken,
          versionToken,
          persistedState.versionToken
        ].filter(Boolean);
        const unexpectedBackups = (await readCasBackupStates(
          filePath,
          paths.transactionId
        ))
          .filter(state => !safeTokens.includes(state.versionToken));
        if (unexpectedBackups.length > 0) {
          return {
            success: false,
            fatal: true,
            reason: 'recovery-required'
          };
        }
        await cleanupCasBackups(
          filePath,
          safeTokens,
          paths.transactionId
        );
        await cleanupTransaction(paths);
        return {
          success: false,
          conflict: true,
          reason: 'superseded-by-external',
          versionToken: persistedState.versionToken
        };
      }

      return {
        success: false,
        fatal: true,
        reason: 'recovery-required'
      };
    } catch (error) {
      if (!prepared) {
        await cleanupPathsBestEffort([
          paths.targetTempPath,
          paths.commitTempPath,
          paths.rollbackPath
        ]);
      }
      throw error;
    }
  }

  function currentStateResult(
    currentContent,
    candidateVersionToken,
    expectedVersionToken,
    failIfExists,
    requiresVersionToken
  ) {
    const currentVersionToken = currentContent === null
      ? null
      : createReviewVersionToken(currentContent);
    if (failIfExists) {
      if (currentContent !== null) {
        return { success: false, exists: true };
      }
      return null;
    }

    if (currentVersionToken === candidateVersionToken) {
      return { success: true, versionToken: candidateVersionToken };
    }

    if (requiresVersionToken) {
      if (!isReviewVersionToken(expectedVersionToken) ||
          currentVersionToken !== expectedVersionToken) {
        return {
          success: false,
          conflict: true,
          reason: 'stale-version-token'
        };
      }
    } else if (expectedVersionToken !== undefined &&
        currentVersionToken !== expectedVersionToken) {
      return {
        success: false,
        conflict: true,
        reason: 'stale-version-token'
      };
    }
    return null;
  }

  async function saveWithoutQueue(filePath, data, options = {}) {
    const expectedVersionToken = options?.expectedVersionToken;
    const failIfExists = options?.failIfExists === true;
    const requiresVersionToken =
      path.extname(filePath).toLowerCase() === '.bframe' &&
      !failIfExists;
    const serialized = JSON.stringify(data, null, 2);
    if (typeof serialized !== 'string') {
      const error = new TypeError('Review data must serialize to JSON');
      error.code = 'ERR_REVIEW_SERIALIZE';
      throw error;
    }
    JSON.parse(serialized);
    const versionToken = createReviewVersionToken(serialized);
    const release = await acquireLock(filePath);
    if (!release) {
      return {
        success: false,
        retryable: true,
        reason: 'lock-timeout'
      };
    }

    try {
      await hooks.afterLockAcquired?.({ filePath });
      const pendingRecovery = await waitForRecoverableTransactionUnderLock(
        filePath
      );
      if (pendingRecovery.timedOut) {
        return {
          success: false,
          retryable: true,
          reason: 'lock-timeout'
        };
      }
      await cleanupOrphanTemps(filePath);

      const currentContent = await readTextOrNull(fsPromises, filePath);
      if (currentContent !== null) JSON.parse(currentContent);
      const initialStateResult = currentStateResult(
        currentContent,
        versionToken,
        expectedVersionToken,
        failIfExists,
        requiresVersionToken
      );
      if (initialStateResult) return initialStateResult;

      return await commitSerializedUnderLock({
        filePath,
        serialized,
        data,
        baseContent: currentContent,
        baseJsonValid: true,
        failIfExists,
        operation: 'save'
      });
    } finally {
      try {
        await release();
      } catch {
        // A verified commit remains valid even if releasing its OS lock reports.
      }
    }
  }

  async function saveReviewFile(requestedFilePath, data, options = {}) {
    const filePath = await resolveCanonicalReviewPath(requestedFilePath);
    return enqueueWrite(
      filePath,
      () => saveWithoutQueue(filePath, data, options)
    );
  }

  async function recoverMalformedFromBackupUnderLock(
    filePath,
    malformedContent,
    syntaxError
  ) {
    const currentContent = await readTextOrNull(fsPromises, filePath);
    if (currentContent === null) return null;
    try {
      const currentData = JSON.parse(currentContent);
      return {
        data: currentData,
        versionToken: createReviewVersionToken(currentContent),
        recovery: null
      };
    } catch {
      // It is still malformed under the lock; only now consult the backup.
    }

    const backupPath = `${filePath}.bak`;
    const backupContent = await readTextOrNull(fsPromises, backupPath);
    if (backupContent === null) throw syntaxError;
    let backupData;
    try {
      backupData = JSON.parse(backupContent);
    } catch {
      throw syntaxError;
    }

    const result = await commitSerializedUnderLock({
      filePath,
      serialized: JSON.stringify(backupData, null, 2),
      data: backupData,
      baseContent: currentContent,
      baseJsonValid: false,
      failIfExists: false,
      operation: 'malformed-backup-recovery'
    });
    if (result?.success !== true) {
      throw createRecoveryRequiredError(
        'Malformed review backup recovery did not complete',
        { filePath, result }
      );
    }
    const restoredContent = await fsPromises.readFile(filePath, 'utf8');
    return {
      data: JSON.parse(restoredContent),
      versionToken: createReviewVersionToken(restoredContent),
      recovery: result.recovery
    };
  }

  async function readReviewSnapshot(requestedFilePath) {
    const filePath = await resolveCanonicalReviewPath(requestedFilePath);
    await waitForPendingWrite(filePath);
    let recovery = null;

    const sidecarPath = recoverySidecarPath(filePath, platform);
    if (await pathExists(fsPromises, sidecarPath)) {
      const startedAt = Date.now();
      while (await pathExists(fsPromises, sidecarPath)) {
        const release = await acquireLock(filePath);
        if (!release) {
          const error = new Error('Review recovery lock timed out');
          error.code = 'ERR_REVIEW_LOCK_TIMEOUT';
          throw error;
        }
        let active = false;
        try {
          recovery = await recoverPreparedTransactionUnderLock(filePath);
        } catch (error) {
          if (error?.code !== 'ERR_REVIEW_TRANSACTION_ACTIVE') throw error;
          active = true;
        } finally {
          await release().catch(() => {});
        }
        if (!active) break;
        if (Date.now() - startedAt >= lockAcquireTimeoutMs) {
          const error = new Error('Review transaction wait timed out');
          error.code = 'ERR_REVIEW_LOCK_TIMEOUT';
          throw error;
        }
        await delay(50);
      }
    }

    const content = await readTextOrNullWithRetry(filePath);
    if (content === null) {
      return {
        data: null,
        versionToken: null,
        recovery
      };
    }
    try {
      return {
        data: JSON.parse(content),
        versionToken: createReviewVersionToken(content),
        recovery
      };
    } catch (syntaxError) {
      const release = await acquireLock(filePath);
      if (!release) throw syntaxError;
      try {
        const recovered = await recoverPreparedTransactionUnderLock(filePath);
        if (recovered) {
          const recoveredContent = await readTextOrNullWithRetry(filePath);
          if (recoveredContent === null) {
            return {
              data: null,
              versionToken: null,
              recovery: recovered
            };
          }
          try {
            return {
              data: JSON.parse(recoveredContent),
              versionToken: createReviewVersionToken(recoveredContent),
              recovery: recovered
            };
          } catch {
            // Fall through to the validated .bak recovery below.
          }
        }
        return await recoverMalformedFromBackupUnderLock(
          filePath,
          content,
          syntaxError
        );
      } finally {
        await release().catch(() => {});
      }
    }
  }

  return {
    readReviewSnapshot,
    saveReviewFile
  };
}

const defaultStore = createReviewFileStore();

module.exports = {
  ABSENT_VERSION_TOKEN,
  createReviewFileStore,
  createReviewVersionToken,
  isReviewVersionToken,
  readReviewSnapshot: defaultStore.readReviewSnapshot,
  saveReviewFile: defaultStore.saveReviewFile
};
