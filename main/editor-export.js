const fs = require('node:fs/promises');
const path = require('node:path');
const { validateProject, durationFrames, resolveFrame } = require('../shared/edit-project');
const { runProcess, encoderArguments, validateOverlays, assertSafeDestination, publishAtomic, abortError } = require('./editor-media');

const decimal = (value) => Number(value).toFixed(9);

function buildSegments(project, overlays) {
  validateProject(project);
  const segments = [];
  let outputStart = 0;
  for (const clip of project.clips) {
    const clipOverlays = overlays.filter((overlay) => overlay.clipId === clip.id);
    const boundaries = [...new Set([0, clip.durationFrames, ...clipOverlays.flatMap((overlay) => [overlay.startFrame, overlay.endFrame])])].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const startFrame = boundaries[i];
      const endFrame = boundaries[i + 1];
      const resolved = resolveFrame(project, outputStart + startFrame);
      segments.push({ ...resolved, startFrame, endFrame, frameCount: endFrame - startFrame, overlay: clipOverlays.find((overlay) => overlay.startFrame <= startFrame && overlay.endFrame >= endFrame) || null });
    }
    outputStart += clip.durationFrames;
  }
  return segments;
}

function fitFilter(project, clip) {
  const target = `${project.width}:${project.height}`;
  return clip.fit === 'cover'
    ? `scale=${target}:force_original_aspect_ratio=increase,crop=${target},setsar=1`
    : `scale=${target}:force_original_aspect_ratio=decrease,pad=${target}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
}

async function removeOwnJob(jobDir, parentPath) {
  const real = await fs.realpath(jobDir);
  const parent = await fs.realpath(parentPath);
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalize(path.dirname(real)) !== normalize(parent) || !path.basename(real).startsWith('.baeframe-export-') || (await fs.lstat(jobDir)).isSymbolicLink()) throw new Error('출력 임시 폴더의 경로가 바뀌어 자동 정리를 중단했습니다.');
  await fs.rm(real, { recursive: true, force: true });
}

async function exportProject({ project, overlays = [], outputPath, expectedVersion, ffmpegPath, ffprobePath, signal, onProgress = () => {} }) {
  validateProject(project);
  const totalFrames = durationFrames(project);
  if (!totalFrames) throw new Error('출력할 컷이 없습니다.');
  const pngOverlays = validateOverlays(project, overlays);
  const segments = buildSegments(project, pngOverlays);
  const originals = project.sources.map((source) => source.path);
  await assertSafeDestination(outputPath, originals, '.mp4');
  if (signal?.aborted) return { cancelled: true };
  const outputParent = path.dirname(outputPath);
  const jobDir = await fs.mkdtemp(path.join(outputParent, '.baeframe-export-'));
  const progress = (phase, value, message) => onProgress({ phase, progress: value, message });
  try {
    progress('prepare', 0, '영상 출력을 준비하고 있어요.');
    if (signal?.aborted) throw abortError();
    const encoder = await encoderArguments(ffmpegPath, signal);
    const overlayPaths = new Map();
    for (let i = 0; i < pngOverlays.length; i++) {
      const filename = path.join(jobDir, `overlay-${i}.png`);
      await fs.writeFile(filename, pngOverlays[i].buffer, { flag: 'wx' });
      overlayPaths.set(pngOverlays[i], filename);
    }
    const holds = new Map();
    const segmentNames = [];
    let completedFrames = 0;
    for (let index = 0; index < segments.length; index++) {
      if (signal?.aborted) throw abortError();
      const segment = segments[index];
      const seconds = segment.frameCount / project.fps;
      const name = `segment-${String(index).padStart(5, '0')}.mov`;
      const output = path.join(jobDir, name);
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-progress', 'pipe:1', '-stats_period', '0.5'];
      const hold = segment.clip.kind === 'freeze';
      if (hold) {
        if (!holds.has(segment.clip.id)) {
          const still = path.join(jobDir, `hold-${holds.size}.png`);
          await runProcess(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', segment.source.path, '-map', '0:v:0', '-vf', `setpts=PTS-STARTPTS-${decimal(segment.sourceTime)}/TB,fps=${project.fps}:round=up:start_time=0`, '-frames:v', '1', '-update', '1', '-y', still], { signal });
          holds.set(segment.clip.id, still);
        }
        args.push('-loop', '1', '-framerate', String(project.fps), '-i', holds.get(segment.clip.id));
      } else {
        args.push('-i', segment.source.path);
      }
      const useOriginalAudio = !hold && segment.source.hasAudio && segment.clip.volume > 0;
      let nextInput = 1;
      let audioInput = '0:a:0';
      if (!useOriginalAudio) {
        args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        audioInput = `${nextInput++}:a:0`;
      }
      let overlayInput;
      if (segment.overlay) {
        args.push('-loop', '1', '-framerate', String(project.fps), '-i', overlayPaths.get(segment.overlay));
        overlayInput = nextInput++;
      }
      // Resample on the whole clip clock before slicing drawing intervals. Seeking
      // each slice independently rounds mixed-FPS sources to a different frame.
      const sourceOffset = hold ? 0 : segment.clip.sourceStartSeconds;
      const startFrame = hold ? 0 : segment.startFrame;
      const endFrame = hold ? segment.frameCount : segment.endFrame;
      const video = `[0:v:0]setpts=PTS-STARTPTS-${decimal(sourceOffset)}/TB,fps=${project.fps}:round=up:start_time=0,trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS,${fitFilter(project, segment.clip)}[base]`;
      const drawing = overlayInput === undefined ? '[base]format=yuv420p[v]' : `[base][${overlayInput}:v:0]overlay=0:0:shortest=1,format=yuv420p[v]`;
      const audio = `[${audioInput}]aresample=48000,atrim=start=${decimal(useOriginalAudio ? segment.sourceTime : 0)},asetpts=PTS-STARTPTS,volume=${useOriginalAudio ? segment.clip.volume : 0},apad,atrim=duration=${decimal(seconds)}[a]`;
      args.push('-filter_complex', [video, drawing, audio].join(';'), '-map', '[v]', '-map', '[a]', ...encoder, '-pix_fmt', 'yuv420p', '-r', String(project.fps), '-frames:v', String(segment.frameCount), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-t', decimal(seconds), '-video_track_timescale', String(Math.round(project.fps * 1000)), '-y', output);
      let progressBuffer = '';
      await runProcess(ffmpegPath, args, { signal, collectStdout: false, onStdout: (chunk) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split('\n');
        progressBuffer = lines.pop();
        for (const line of lines) {
          const frame = /^frame=(\d+)/.exec(line);
          if (frame) progress('encode', 0.05 + 0.7 * (completedFrames + Math.min(segment.frameCount, Number(frame[1]))) / totalFrames, `${index + 1}/${segments.length} 구간을 만들고 있어요.`);
        }
      } });
      segmentNames.push(name);
      completedFrames += segment.frameCount;
      progress('encode', 0.05 + 0.7 * completedFrames / totalFrames, `${index + 1}/${segments.length} 구간을 만들었어요.`);
    }
    // PCM intermediates preserve every audio sample across cuts; AAC is encoded once at the end.
    const concatPath = path.join(jobDir, 'segments.txt');
    await fs.writeFile(concatPath, segmentNames.map((name) => `file '${name}'`).join('\n') + '\n');
    const finalPath = path.join(jobDir, 'completed.mp4');
    const duration = totalFrames / project.fps;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'concat', '-safe', '1', '-i', concatPath];
    let audioFilter = `[0:a:0]apad,atrim=duration=${decimal(duration)},asetpts=PTS-STARTPTS[a]`;
    if (project.music) {
      const music = project.sources.find((source) => source.id === project.music.sourceId);
      args.push('-i', music.path);
      const delaySamples = Math.round(project.music.offsetFrames / project.fps * 48000);
      audioFilter = `[0:a:0]apad,atrim=duration=${decimal(duration)},asetpts=PTS-STARTPTS[original];[1:a:0]aresample=48000,asetpts=PTS-STARTPTS,volume=${project.music.volume},adelay=${delaySamples}S:all=1,apad,atrim=duration=${decimal(duration)}[music];[original][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:latency=1[a]`;
    }
    args.push('-filter_complex', audioFilter, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', decimal(duration), '-movflags', '+faststart', '-y', finalPath);
    progress('audio', 0.8, '배경음악과 소리를 합치고 있어요.');
    await runProcess(ffmpegPath, args, { signal, cwd: jobDir });
    const { stdout } = await runProcess(ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', finalPath], { signal });
    const streams = JSON.parse(stdout).streams;
    const video = streams.find((stream) => stream.codec_type === 'video');
    if (!video || Number(video.nb_read_frames) !== totalFrames || video.width !== project.width || video.height !== project.height || video.codec_name !== 'h264' || !streams.some((stream) => stream.codec_type === 'audio' && stream.codec_name === 'aac')) throw new Error('완성 영상의 길이 또는 형식 검증에 실패했습니다.');
    progress('publish', 0.95, '완성 영상을 안전하게 저장하고 있어요.');
    await publishAtomic(outputPath, (temporary) => fs.copyFile(finalPath, temporary), { expectedVersion, signal, originals, extension: '.mp4' });
    progress('complete', 1, 'MP4 저장이 끝났어요.');
    return { cancelled: false, path: outputPath };
  } catch (error) {
    if (error.name === 'AbortError' || signal?.aborted) return { cancelled: true };
    throw error;
  } finally { await removeOwnJob(jobDir, outputParent); }
}

module.exports = { buildSegments, exportProject };
