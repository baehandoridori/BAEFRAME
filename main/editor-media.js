const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
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

async function publishAtomic(destination, prepare, { expectedVersion, signal, originals = [], extension = path.extname(destination).toLowerCase() } = {}) {
  await assertSafeDestination(destination, originals, extension);
  const lockPath = destination + '.baeframe-edit.lock';
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('다른 편집 작업이 이 파일을 저장 중입니다. 잠시 후 다시 시도하세요.'); throw error; }
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    await lock.writeFile(String(process.pid));
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
    await fs.rename(temporary, destination);
    return writtenVersion;
  } finally {
    await fs.rm(temporary, { force: true });
    await lock.close();
    await fs.rm(lockPath, { force: true });
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
