const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const zlib = require('node:zlib');
const { exportProject } = require('../../main/editor-export');
const { captureFileVersion, probeMedia, preparePreview } = require('../../main/editor-media');
const ffmpegPath = process.env.BAEFRAME_TEST_FFMPEG || path.resolve(__dirname, '../../ffmpeg/win32/ffmpeg.exe');
const ffprobePath = path.join(path.dirname(ffmpegPath), 'ffprobe.exe');

function run(binary, args) {
  const result = spawnSync(binary, args, { shell: false, windowsHide: true, encoding: null, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function clip(id, kind, start, frames) {
  return { id, sourceId: 'source', kind, sourceStartSeconds: start, durationFrames: frames, volume: 1, fit: 'contain', drawingOffsetFrames: 0, drawingsV3: null, drawingLayersV1: null };
}
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baeframe-editor-영상-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, '원본 영상.mkv');
  run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-y', source]);
  const project = { type: 'baeframe-edit', schemaVersion: 1, name: '테스트', fps: 24, width: 96, height: 64, sources: [{ id: 'source', path: source, name: '원본', durationSeconds: 2, width: 96, height: 64, fps: 24, hasAudio: true }], clips: [clip('a', 'video', 0, 12), clip('hold', 'freeze', 0.5, 24), clip('b', 'video', 1, 12)], music: null };
  return { dir, source, project };
}
test('real FFmpeg export has exact frame count, constant silent hold and continuous music', { timeout: 120000 }, async (t) => {
  const { dir, project } = await fixture(t);
  const output = path.join(dir, '완성 영상.mp4');
  const progress = [];
  await exportProject({ project, overlays: [], outputPath: output, expectedVersion: null, ffmpegPath, ffprobePath, onProgress: (value) => progress.push(value.progress) });
  const probe = JSON.parse(run(ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output]));
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  assert.equal(video.codec_name, 'h264');
  assert.equal(Number(video.nb_read_frames), 48);
  assert.equal(video.width, 96);
  assert.equal(video.height, 64);
  const raw = run(ffmpegPath, ['-v', 'error', '-i', output, '-vf', 'select=between(n\\,15\\,30)', '-vsync', '0', '-pix_fmt', 'gray', '-f', 'rawvideo', '-']);
  const pixels = 96 * 64;
  assert.equal(raw.length, pixels * 16);
  for (let i = 1; i < 16; i++) assert.deepEqual(raw.subarray(i * pixels, (i + 1) * pixels), raw.subarray(0, pixels));
  const rms = (file) => {
    const bytes = run(ffmpegPath, ['-v', 'error', '-ss', '0.7', '-i', file, '-t', '0.5', '-vn', '-ac', '1', '-f', 'f32le', '-']);
    let sum = 0;
    for (let i = 0; i < bytes.length; i += 4) sum += bytes.readFloatLE(i) ** 2;
    return Math.sqrt(sum / (bytes.length / 4));
  };
  assert.ok(rms(output) < 0.001, 'hold source audio must be silent');
  project.music = { sourceId: 'source', volume: 0.5, offsetFrames: 0 };
  const musicOutput = path.join(dir, '배경음악 포함.mp4');
  await exportProject({ project, overlays: [], outputPath: musicOutput, expectedVersion: null, ffmpegPath, ffprobePath });
  assert.ok(rms(musicOutput) > 0.02, 'background music must continue during hold');
  assert.equal(progress.at(-1), 1);
});

test('cancelled job never publishes or corrupts an existing output', { timeout: 60000 }, async (t) => {
  const { dir, project } = await fixture(t);
  const output = path.join(dir, '기존 출력.mp4');
  await fs.writeFile(output, 'preserve me');
  const abort = new AbortController();
  const result = await exportProject({ project, overlays: [], outputPath: output, expectedVersion: await captureFileVersion(output), ffmpegPath, ffprobePath, signal: abort.signal, onProgress: () => abort.abort() });
  assert.equal(result.cancelled, true);
  assert.equal(await fs.readFile(output, 'utf8'), 'preserve me');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['기존 출력.mp4', '원본 영상.mkv'].sort());
});

function overlayPng(width, height) {
  const crc = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name, bytes) => {
    const type = Buffer.from(name);
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([type, bytes])));
    return Buffer.concat([length, type, bytes, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      rows[offset] = 255; rows[offset + 3] = 255;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('PNG drawings obey half-open frame intervals and preserve transparency in real output', { timeout: 60000 }, async (t) => {
  const { dir, project } = await fixture(t);
  const output = path.join(dir, '그림 구간.mp4');
  const overlays = [{ clipId: 'hold', startFrame: 6, endFrame: 12, dataUrl: `data:image/png;base64,${overlayPng(96, 64).toString('base64')}` }];
  await exportProject({ project, overlays, outputPath: output, expectedVersion: null, ffmpegPath, ffprobePath });
  const bytes = run(ffmpegPath, ['-v', 'error', '-i', output, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
  assert.equal(bytes.length, 48 * 96 * 64 * 3);
  const pixel = (frame, x = 12, y = 12) => [...bytes.subarray((frame * 96 * 64 + y * 96 + x) * 3, (frame * 96 * 64 + y * 96 + x) * 3 + 3)];
  for (const frame of [18, 23]) {
    const [red, green, blue] = pixel(frame);
    assert.ok(red > 230 && green < 25 && blue < 25, `overlay expected at frame ${frame}: ${pixel(frame)}`);
  }
  assert.deepEqual(pixel(17), pixel(24));
  assert.notDeepEqual(pixel(17), pixel(18));
  // A transparent pixel still displays the original held picture.
  const before = pixel(17, 40, 40);
  const during = pixel(18, 40, 40);
  assert.ok(before.every((channel, index) => Math.abs(channel - during[index]) < 12));
});

test('cancellation stops a running encoder and removes its unique job directory', { timeout: 60000 }, async (t) => {
  const { dir, project } = await fixture(t);
  project.clips = [clip('long-hold', 'freeze', 0.5, 24000)];
  project.width = 1920;
  project.height = 1080;
  const output = path.join(dir, '취소된 출력.mp4');
  const abort = new AbortController();
  let timer;
  const result = await exportProject({ project, overlays: [], outputPath: output, expectedVersion: null, ffmpegPath, ffprobePath, signal: abort.signal, onProgress: ({ phase }) => { if (phase === 'prepare') timer = setTimeout(() => abort.abort(), 100); } });
  clearTimeout(timer);
  assert.equal(result.cancelled, true);
  assert.deepEqual(await fs.readdir(dir), ['원본 영상.mkv']);
});

test('unsupported preview media is probed and converted without changing its original', { timeout: 60000 }, async (t) => {
  const { dir, source } = await fixture(t);
  const originalVersion = await captureFileVersion(source);
  const probed = await probeMedia(source, { ffprobePath });
  assert.equal(probed.videoCodec, 'ffv1');
  assert.equal(probed.source.width, 96);
  assert.equal(probed.source.hasAudio, true);
  const preview = await preparePreview(probed, path.join(dir, 'preview cache'), { ffmpegPath, ffprobePath });
  assert.notEqual(preview.previewPath, source);
  assert.equal(preview.path, source);
  const converted = await probeMedia(preview.previewPath, { ffprobePath });
  assert.equal(converted.videoCodec, 'h264');
  assert.equal(converted.audioCodec, 'aac');
  assert.equal(await captureFileVersion(source), originalVersion);
  assert.equal((await preparePreview(probed, path.join(dir, 'preview cache'), { ffmpegPath, ffprobePath })).previewPath, preview.previewPath);
});

test('mixed FPS output matches preview floor-frame sampling across drawings, trimmed starts and holds', { timeout: 60000 }, async (t) => {
  const { dir, project } = await fixture(t);
  const source = path.join(dir, '30fps 원본.mkv');
  run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', "nullsrc=size=96x64:rate=30:duration=1,geq=lum='20+N*7':cb=128:cr=128", '-c:v', 'ffv1', '-y', source]);
  project.sources[0] = { ...project.sources[0], path: source, fps: 30, durationSeconds: 1, hasAudio: false };
  project.clips = [clip('mixed', 'video', 1 / 24, 12), clip('hold', 'freeze', 1 / 24, 6)];
  const output = path.join(dir, '혼합FPS.mp4');
  const overlays = [{ clipId: 'mixed', startFrame: 1, endFrame: 4, dataUrl: `data:image/png;base64,${overlayPng(96, 64).toString('base64')}` }];
  await exportProject({ project, overlays, outputPath: output, expectedVersion: null, ffmpegPath, ffprobePath });
  const bytes = run(ffmpegPath, ['-v', 'error', '-i', output, '-pix_fmt', 'yuv420p', '-f', 'rawvideo', '-']);
  const frameSize = 96 * 64 * 1.5;
  assert.equal(bytes.length, 18 * frameSize);
  for (let frame = 0; frame < 18; frame++) {
    const sourceFrame = frame < 12 ? Math.floor((frame + 1) * 30 / 24) : 1;
    const actual = bytes[frame * frameSize + 40 * 96 + 40];
    const expected = 20 + sourceFrame * 7;
    assert.ok(Math.abs(actual - expected) <= 2, `output ${frame}: expected source frame ${sourceFrame} luma ${expected}, got ${actual}`);
  }
});

test('video duration follows the video stream when its audio continues longer', async (t) => {
  const { dir } = await fixture(t);
  const source = path.join(dir, '긴 소리.mkv');
  run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-y', source]);
  const probed = await probeMedia(source, { ffprobePath });
  assert.equal(probed.source.durationSeconds, 1);
});
