const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const os = require('node:os');
const { spawn } = require('node:child_process');

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv'];
const AUDIO_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'opus'];

function abortError() {
  const error = new Error('출력을 취소했습니다.');
  error.name = 'AbortError';
  return error;
}

function runProcess(binary, args, { signal, cwd, onStderr, onStdout, collectStdout = true, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    let length = 0;
    let stderr = '';
    let overflow = false;
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      onStdout?.(chunk.toString());
      if (!collectStdout) return;
      length += chunk.length;
      if (length > maxBytes) { overflow = true; child.kill(); return; }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-16000);
      onStderr?.(chunk.toString());
    });
    child.on('error', (error) => {
      signal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(abortError());
      else if (overflow) reject(new Error('외부 도구의 응답 크기가 제한을 초과했습니다.'));
      else if (code !== 0) reject(new Error(`미디어 처리 실패 (${code}): ${stderr.slice(-3000)}`));
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr });
    });
  });
}

async function getRuntimePaths() {
  const { ffmpegManager } = require('./ffmpeg-manager');
  await ffmpegManager.initialize();
  if (!ffmpegManager.ffmpegPath || !ffmpegManager.ffprobePath) throw new Error('FFmpeg 실행 파일을 찾을 수 없습니다.');
  return { ffmpegPath: ffmpegManager.ffmpegPath, ffprobePath: ffmpegManager.ffprobePath };
}

const encoderCache = new Map();
async function encoderArguments(ffmpegPath, signal) {
  if (!encoderCache.has(ffmpegPath)) {
    const { stdout } = await runProcess(ffmpegPath, ['-hide_banner', '-encoders'], { signal });
    if (/\blibx264\b/.test(stdout)) encoderCache.set(ffmpegPath, ['-c:v', 'libx264', '-preset', 'fast', '-crf', '18']);
    else if (/\blibopenh264\b/.test(stdout)) encoderCache.set(ffmpegPath, ['-c:v', 'libopenh264', '-b:v', '8M']);
    else throw new Error('H.264 소프트웨어 인코더를 찾을 수 없습니다.');
  }
  return [...encoderCache.get(ffmpegPath)];
}

async function probeMedia(filePath, { ffprobePath, signal } = {}) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) throw new Error('올바른 미디어 경로가 아닙니다.');
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (![...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS].includes(extension)) throw new Error('지원하지 않는 미디어 확장자입니다.');
  const realPath = await fs.realpath(filePath);
  if (!(await fs.stat(realPath)).isFile()) throw new Error('미디어 파일이 아닙니다.');
  const runtime = ffprobePath ? { ffprobePath } : await getRuntimePaths();
  const { stdout } = await runProcess(runtime.ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', realPath], { signal });
  const info = JSON.parse(stdout);
  const video = info.streams?.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  const audio = info.streams?.find((stream) => stream.codec_type === 'audio');
  const selectedStream = video || audio;
  const tagDuration = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(selectedStream?.tags?.DURATION || '');
  const streamDuration = Number(selectedStream?.duration) || (tagDuration && Number(tagDuration[1]) * 3600 + Number(tagDuration?.[2] || 0) * 60 + Number(tagDuration?.[3] || 0));
  const durationSeconds = Number(streamDuration || info.format?.duration);
  if ((!video && !audio) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) throw new Error('미디어 길이를 확인할 수 없거나 24시간을 초과합니다.');
  const fraction = String(video?.avg_frame_rate || video?.r_frame_rate || '0/1').split('/').map(Number);
  const fps = video ? fraction[0] / (fraction[1] || 1) : 0;
  if (video && (!Number.isFinite(fps) || fps <= 0 || fps > 1000)) throw new Error('영상의 프레임 속도를 확인할 수 없습니다.');
  return {
    source: { id: crypto.randomUUID(), path: realPath, name: path.basename(realPath), durationSeconds, width: Number(video?.width || 0), height: Number(video?.height || 0), fps, hasAudio: !!audio },
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    formatName: info.format?.format_name || ''
  };
}

async function preparePreview(probed, cacheRoot, runtime, signal) {
  const { source, videoCodec, audioCodec } = probed;
  const extension = path.extname(source.path).toLowerCase();
  const compatibleVideo = ['.mp4', '.m4v', '.mov'].includes(extension) && videoCodec === 'h264' && (!audioCodec || audioCodec === 'aac');
  const compatibleWebm = extension === '.webm' && ['vp8', 'vp9', 'av1'].includes(videoCodec) && (!audioCodec || ['opus', 'vorbis'].includes(audioCodec));
  const compatibleAudio = !source.width && ['.mp3', '.wav', '.ogg', '.m4a', '.aac'].includes(extension);
  if (compatibleVideo || compatibleWebm || compatibleAudio) return { ...source, previewPath: source.path };
  await fs.mkdir(cacheRoot, { recursive: true });
  const stat = await fs.stat(source.path);
  const key = crypto.createHash('sha256').update(`${source.path}:${stat.size}:${stat.mtimeMs}:editor-preview-v1`).digest('hex');
  const output = path.join(cacheRoot, key + (source.width ? '.mp4' : '.m4a'));
  try { if ((await fs.stat(output)).size > 0) return { ...source, previewPath: output }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = path.join(cacheRoot, `${key}.${crypto.randomUUID()}.tmp${source.width ? '.mp4' : '.m4a'}`);
  try {
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source.path];
    if (source.width) args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", ...await encoderArguments(runtime.ffmpegPath, signal), '-pix_fmt', 'yuv420p');
    else args.push('-vn', '-map', '0:a:0');
    args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', temp);
    await runProcess(runtime.ffmpegPath, args, { signal });
    if (signal?.aborted) throw abortError();
    await fs.rename(temp, output);
  } finally { await fs.rm(temp, { force: true }); }
  return { ...source, previewPath: output };
}

async function captureFileVersion(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('파일만 저장 대상으로 사용할 수 있습니다.');
      const digest = crypto.createHash('sha256');
      for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk);
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${digest.digest('hex')}`;
    } finally { await handle.close(); }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function normalizedPath(filePath) {
  let resolved;
  try { resolved = await fs.realpath(filePath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    resolved = path.join(await fs.realpath(path.dirname(filePath)), path.basename(filePath));
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function assertSafeDestination(destination, originals, extension) {
  if (typeof destination !== 'string' || !path.isAbsolute(destination) || destination.includes('\0') || path.extname(destination).toLowerCase() !== extension) throw new Error(`저장 파일 확장자는 ${extension} 이어야 합니다.`);
  const canonical = await normalizedPath(destination);
  let destinationStat;
  try {
    if ((await fs.lstat(destination)).isSymbolicLink()) throw new Error('바로가기 경로에는 저장할 수 없습니다.');
    destinationStat = await fs.stat(destination);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const original of originals) {
    if (canonical === await normalizedPath(original)) throw new Error('원본 미디어에는 덮어쓸 수 없습니다.');
    if (destinationStat) {
      const sourceStat = await fs.stat(original);
      if (sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) throw new Error('원본 미디어의 연결 파일에는 덮어쓸 수 없습니다.');
    }
  }
}

const EDITOR_LOCK_BUSY = '다른 편집 작업이 이 파일을 저장 중입니다. 잠시 후 다시 시도하세요.';
const EDITOR_LOCK_UNKNOWN = '저장 잠금 소유자를 확인할 수 없습니다. 다른 이름으로 저장하거나 기존 편집 작업이 종료됐는지 확인해 주세요.';
const EDITOR_LOCK_CHANGED = '저장 잠금 소유자가 변경되어 파일을 덮어쓰지 않았습니다. 다시 시도하거나 다른 이름으로 저장하세요.';

async function acquireEditorProcessGuard(lockPath) {
  // review-file-store.js와 같은 OS 소유 잠금: 프로세스가 죽으면 자동 해제된다.
  // 같은 PC의 stale 확인→삭제→취득과 소유자 해제를 모두 이 안에서 수행한다.
  const hash = crypto.createHash('sha256').update(await normalizedPath(lockPath)).digest('hex');
  const endpoint = process.platform === 'win32' ? { path: `\\\\.\\pipe\\baeframe-editor-${hash}` }
    : process.platform === 'linux' ? { path: `\0baeframe-editor-${hash}` }
      // 파일형 Unix socket은 강제 종료 후 남는다. 그 외 OS에서는 커널 소유
      // loopback 포트를 사용한다. 해시 충돌은 동시 저장을 거절할 뿐 락을 훔치지 않는다.
      : { host: '127.0.0.1', port: 32768 + parseInt(hash.slice(0, 4), 16) % 32768 };
  const server = net.createServer(socket => socket.destroy());
  server.unref();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.once('listening', resolve);
      server.listen({ ...endpoint, exclusive: true });
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(EDITOR_LOCK_BUSY);
    throw error;
  }
  return () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function readEditorLock(lockPath) {
  let handle;
  try {
    const entry = await fs.lstat(lockPath);
    if (!entry.isFile() || entry.isSymbolicLink()) return { owner: null };
    handle = await fs.open(lockPath, 'r');
    const before = await handle.stat();
    if (before.dev !== entry.dev || before.ino !== entry.ino || before.size > 4096) return { owner: null };
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const after = await handle.stat();
    if (bytesRead > 4096 || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return { owner: null };
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    let owner = null;
    try {
      const value = JSON.parse(text);
      if (value?.schemaVersion === 1 && typeof value.hostname === 'string' && value.hostname.length > 0 && value.hostname.length <= 255
        && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647
        && typeof value.token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.token)) owner = value;
    } catch { /* 구버전 PID-only, 쓰기 도중 또는 손상된 락은 소유자를 추정하지 않는다. */ }
    return { dev: before.dev, ino: before.ino, text, owner };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

function sameEditorLock(first, second) {
  return !!first && !!second && first.dev !== undefined && first.dev === second.dev
    && first.ino === second.ino && first.text === second.text;
}

async function acquireEditorFileLock(lockPath) {
  const releaseGuard = await acquireEditorProcessGuard(lockPath);
  const owner = { schemaVersion: 1, hostname: os.hostname().toLowerCase(), pid: process.pid, token: crypto.randomUUID() };
  const contents = JSON.stringify(owner);
  let handle;
  let identity;
  let owned;
  const release = async () => {
    try {
      await handle?.close();
      if (handle) {
        const current = await readEditorLock(lockPath);
        // 메타데이터 쓰기가 실패해도 직접 만든 파일과 데이터만 정리한다.
        const partialOwned = !owned && identity && current?.dev === identity.dev && current?.ino === identity.ino
          && typeof current.text === 'string' && contents.startsWith(current.text);
        if (sameEditorLock(owned, current) || partialOwned) await fs.unlink(lockPath);
      }
    } finally { await releaseGuard(); }
  };
  try {
    try { handle = await fs.open(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stale = await readEditorLock(lockPath);
      if (!stale?.owner) throw new Error(EDITOR_LOCK_UNKNOWN);
      if (stale.owner.hostname !== owner.hostname) throw new Error('다른 컴퓨터의 저장 잠금이 남아 있습니다. 해당 편집 작업을 확인하거나 다른 이름으로 저장하세요.');
      let dead = false;
      try { process.kill(stale.owner.pid, 0); }
      catch (processError) { dead = processError.code === 'ESRCH'; }
      if (!dead) throw new Error(EDITOR_LOCK_BUSY);
      if (!sameEditorLock(stale, await readEditorLock(lockPath))) throw new Error(EDITOR_LOCK_CHANGED);
      // 외부 PC는 이 host의 락을 회수하지 않는다. 같은 host의 모든 회수자는
      // OS guard로 직렬화되어 검사 중 새 소유자를 지우는 ABA 경합을 막는다.
      await fs.unlink(lockPath);
      try { handle = await fs.open(lockPath, 'wx'); }
      catch (createError) { if (createError.code === 'EEXIST') throw new Error(EDITOR_LOCK_BUSY); throw createError; }
    }
    identity = await handle.stat();
    await handle.writeFile(contents);
    await handle.sync();
    owned = { dev: identity.dev, ino: identity.ino, text: contents };
    return {
      async assertOwned() {
        if (!sameEditorLock(owned, await readEditorLock(lockPath))) throw new Error(EDITOR_LOCK_CHANGED);
      },
      release
    };
  } catch (error) {
    await release();
    throw error;
  }
}

async function publishAtomic(destination, prepare, { expectedVersion, signal, originals = [], extension = path.extname(destination).toLowerCase() } = {}) {
  await assertSafeDestination(destination, originals, extension);
  const lockPath = destination + '.baeframe-edit.lock';
  const lock = await acquireEditorFileLock(lockPath);
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    if (signal?.aborted) throw abortError();
    if (expectedVersion !== undefined && await captureFileVersion(destination) !== expectedVersion) throw new Error('파일이 다른 작업에서 변경되었습니다. 다른 이름으로 저장하세요.');
    await prepare(temporary);
    const handle = await fs.open(temporary, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    const writtenVersion = await captureFileVersion(temporary);
    if (signal?.aborted) throw abortError();
    await assertSafeDestination(destination, originals, extension);
    if (expectedVersion !== undefined && await captureFileVersion(destination) !== expectedVersion) throw new Error('저장 중 파일이 다른 작업에서 변경되었습니다.');
    if (signal?.aborted) throw abortError();
    await lock.assertOwned();
    if (signal?.aborted) throw abortError();
    await fs.rename(temporary, destination);
    return writtenVersion;
  } finally {
    try { await fs.rm(temporary, { force: true }); }
    finally { await lock.release(); }
  }
}

async function writeAtomic(destination, contents, options) {
  return publishAtomic(destination, (temp) => fs.writeFile(temp, contents, { flag: 'wx' }), options);
}

function validateOverlays(project, overlays) {
  if (!Array.isArray(overlays) || overlays.length > 10000) throw new Error('그림 출력 목록이 올바르지 않습니다.');
  const clips = new Map(project.clips.map((clip) => [clip.id, clip]));
  const intervals = new Map();
  let totalBytes = 0;
  return overlays.map((overlay) => {
    const clip = clips.get(overlay?.clipId);
    if (!clip || !Number.isSafeInteger(overlay.startFrame) || !Number.isSafeInteger(overlay.endFrame) || overlay.startFrame < 0 || overlay.endFrame <= overlay.startFrame || overlay.endFrame > clip.durationFrames) throw new Error('그림 출력 프레임 범위가 올바르지 않습니다.');
    if (typeof overlay.dataUrl !== 'string' || overlay.dataUrl.length > 24 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(overlay.dataUrl)) throw new Error('그림 출력은 제한된 크기의 PNG여야 합니다.');
    const buffer = Buffer.from(overlay.dataUrl.slice(22), 'base64');
    totalBytes += buffer.length;
    if (totalBytes > 128 * 1024 * 1024) throw new Error('그림 출력 PNG 총 크기를 초과했습니다.');
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString('ascii', 12, 16) !== 'IHDR' || buffer.readUInt32BE(16) !== project.width || buffer.readUInt32BE(20) !== project.height) throw new Error('PNG 그림 크기가 프로젝트와 다릅니다.');
    const list = intervals.get(clip.id) || [];
    if (list.some(([start, end]) => overlay.startFrame < end && overlay.endFrame > start)) throw new Error('PNG 그림 구간이 겹칩니다.');
    list.push([overlay.startFrame, overlay.endFrame]);
    intervals.set(clip.id, list);
    return { clipId: overlay.clipId, startFrame: overlay.startFrame, endFrame: overlay.endFrame, buffer };
  });
}

module.exports = { MAX_PROJECT_BYTES, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, abortError, runProcess, getRuntimePaths, encoderArguments, probeMedia, preparePreview, captureFileVersion, assertSafeDestination, publishAtomic, writeAtomic, validateOverlays };
