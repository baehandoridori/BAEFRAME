/* global BAEEditProject, BAEEditorController, BAEEditorDrawing, BAEEditorPreview, BAEEditorTimeline */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const core = BAEEditProject;
  const timeline = BAEEditorTimeline;
  const api = window.editorAPI;
  const video = $('videoPreview');
  const music = $('musicPreview');
  let controller = null;
  let playing = false;
  let drawingMode = true;
  let expanded = true;
  let exporting = false;
  let transport = null;
  let previewGeneration = 0;
  let lastVideoPath = '';
  let lastMusicPath = '';
  let seeking = false;
  let scrubFrame = null;
  let operationDepth = 0;
  let lastTimelineKey = '';
  let compositePending = 0;
  let compositeReady = false;
  let musicReady = Promise.resolve();
  let activeTool = 'select';
  let composing = false;
  let savePending = false;
  let timelineScale = null;
  let timelineMode = 'fit';
  let timelineRevision = 0;
  let clipDrag = null;
  let clipDragAnimation = null;
  let stagePan = null;
  let timelinePan = null;
  let stageView = { zoom: 1, panX: 0, panY: 0 };
  let stageBase = { width: 1, height: 1 };
  let stageZoomMode = 'fit';
  let stageGeometryKey = '';

  function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
  }
  if (!api || !window.BAEEditorDrawing || !window.BAEEditorPreview) {
    status('편집 화면을 준비하지 못했습니다. BAEFRAME에서 다시 열어주세요.', true);
    document.querySelectorAll('button,input,select').forEach((e) => {
      e.disabled = true;
    });
    return;
  }
  const drawing = BAEEditorDrawing.createEditorDrawing({
    container: $('drawingContainer'),
    onChange: (snapshot) => controller?.recordDrawing(snapshot)
  });
  controller = BAEEditorController.createEditorController({ core, api, drawing, onChange: render });
  transport = BAEEditorPreview.createPreviewTransport({
    core,
    video,
    getProject: () => controller.state.project,
    getFrame: () => controller.state.frame,
    async onFrame(frame, { prepare }) {
      const release = beginComposite(prepare);
      try {
        if (prepare) music.pause();
        await controller.seek(frame, { playback: true });
        if (prepare) {
          if (await syncPreview()) compositeReady = true;
        } else compositeReady = true;
        if (!playing && operationDepth === 0) await drawing.setEnabled(drawingMode);
      } finally {
        release();
      }
    },
    onTime(seconds) {
      void syncMusic(seconds, true).catch((error) => status(error.message, true));
    },
    onPlaying(value) {
      playing = value;
      $('playPause').textContent = value ? '일시정지' : '재생';
      if (!value) music.pause();
      render();
    },
    onError(error) {
      status(error.message, true);
    }
  });

  function captureComposite() {
    const still = $('previewStill');
    if (!still || !compositeReady || video.readyState < 2 || !$('stage').clientWidth) return;
    const project = controller.state.project;
    still.width = Math.min(1280, project.width);
    still.height = Math.round((still.width * project.height) / project.width);
    const context = still.getContext('2d');
    context.fillStyle = '#000';
    context.fillRect(0, 0, still.width, still.height);
    const factor =
      video.style.objectFit === 'cover'
        ? Math.max(still.width / video.videoWidth, still.height / video.videoHeight)
        : Math.min(still.width / video.videoWidth, still.height / video.videoHeight);
    const width = video.videoWidth * factor,
      height = video.videoHeight * factor;
    context.drawImage(video, (still.width - width) / 2, (still.height - height) / 2, width, height);
    const canvas = document.querySelector('.editor-drawing-overlay canvas.lower-canvas');
    if (canvas && canvas.width && canvas.height) {
      const stageRect = $('stage').getBoundingClientRect();
      const rect = canvas.getBoundingClientRect();
      context.drawImage(
        canvas,
        ((rect.left - stageRect.left) / stageRect.width) * still.width,
        ((rect.top - stageRect.top) / stageRect.height) * still.height,
        (rect.width / stageRect.width) * still.width,
        (rect.height / stageRect.height) * still.height
      );
    }
    still.dataset.ready = 'true';
  }
  function beginComposite(retain = false) {
    if (retain && compositePending === 0) captureComposite();
    compositePending++;
    compositeReady = false;
    document.body.classList.add('editor-seeking');
    return () => {
      compositePending--;
      document.body.classList.toggle('editor-seeking', compositePending > 0 || !compositeReady);
      if (compositePending === 0 && compositeReady && $('previewStill'))
      {$('previewStill').dataset.ready = 'false';}
    };
  }

  function timecode(frame) {
    return BAEEditorPreview.frameTimecode(frame, controller.state.project.fps);
  }
  function clipStart(id) {
    let start = 0;
    for (const clip of controller.state.project.clips) {
      if (clip.id === id) return start;
      start += clip.durationFrames;
    }
    return 0;
  }
  function selected() {
    return controller.state.project.clips.find((c) => c.id === controller.state.selectedId);
  }
  function bounds() {
    return [0, Math.max(1, core.durationFrames(controller.state.project))];
  }
  function timelineGeometry() {
    const scroll = $('timelineScroll');
    const labelWidth =
      parseFloat(getComputedStyle(scroll).getPropertyValue('--track-label-width')) || 164;
    const viewportWidth = Math.max(1, scroll.clientWidth - labelWidth);
    const totalFrames = bounds()[1];
    const limits = timeline.scaleLimits(totalFrames, viewportWidth);
    if (timelineScale === null || timelineMode === 'fit') timelineScale = limits.min;
    timelineScale = Math.max(limits.min, Math.min(limits.max, timelineScale));
    return {
      left: scroll.getBoundingClientRect().left,
      labelWidth,
      viewportWidth,
      totalFrames,
      scrollLeft: scroll.scrollLeft,
      pxPerFrame: timelineScale,
      limits
    };
  }
  function frameAtPointer(clientX) {
    return timeline.frameAtClientX(clientX, timelineGeometry());
  }
  function fileUrl(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return encodeURI((normalized.startsWith('//') ? 'file:' : 'file:///') + normalized).replace(
      /[?#]/g,
      encodeURIComponent
    );
  }
  function waitMedia(element, event) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('영상 응답이 늦어 미리보기를 멈췄습니다.')),
        15000
      );
      const success = () => finish();
      const error = () => finish(new Error('이 미디어를 미리보기로 열 수 없습니다.'));
      function finish(reason) {
        clearTimeout(timer);
        element.removeEventListener(event, success);
        element.removeEventListener('error', error);
        reason ? reject(reason) : resolve();
      }
      element.addEventListener(event, success, { once: true });
      element.addEventListener('error', error, { once: true });
    });
  }
  async function syncPreview() {
    const generation = ++previewGeneration;
    const state = controller.state;
    const project = state.project;
    const frame = state.frame;
    const current = () =>
      generation === previewGeneration && state.project === project && state.frame === frame;
    const resolved = core.resolveFrame(state.project, state.frame);
    if (!resolved) {
      video.pause();
      music.pause();
      return true;
    }
    video.pause();
    const path = resolved.source.previewPath || resolved.source.path;
    if (path !== lastVideoPath) {
      const ready = waitMedia(video, 'loadedmetadata');
      video.src = fileUrl(path);
      video.load();
      await ready;
      if (!current()) return false;
      lastVideoPath = path;
    }
    if (!current()) return false;
    video.style.objectFit = resolved.clip.fit;
    const sourceTime = Math.min(resolved.sourceTime, Math.max(0, video.duration - 0.00001));
    if (video.seeking || Math.abs(video.currentTime - sourceTime) > 0.000001) {
      const ready = waitMedia(video, 'seeked');
      video.currentTime = sourceTime;
      await ready;
    }
    if (video.readyState < 2) await waitMedia(video, 'loadeddata');
    if (!current()) return false;
    video.volume = resolved.clip.kind === 'freeze' ? 0 : Math.min(1, resolved.clip.volume);
    video.muted = resolved.clip.kind === 'freeze' || resolved.clip.volume === 0;
    await syncMusic(frame / project.fps, false);
    return current();
  }
  async function syncMusic(outputSeconds, shouldPlay) {
    const project = controller.state.project;
    const track = project.music;
    if (track) {
      const source = project.sources.find((s) => s.id === track.sourceId);
      const musicPath = source.previewPath || source.path;
      if (musicPath !== lastMusicPath) {
        music.pause();
        musicReady = waitMedia(music, 'loadedmetadata');
        music.src = fileUrl(musicPath);
        music.load();
        lastMusicPath = musicPath;
      }
      await musicReady;
      if (project !== controller.state.project || project.music !== track) return;
      const position = outputSeconds - track.offsetFrames / project.fps;
      music.volume = Math.min(1, track.volume);
      if (position >= 0 && position < source.durationSeconds) {
        if (Math.abs(music.currentTime - position) > (shouldPlay ? 0.05 : 0.000001))
        {music.currentTime = position;}
        if (shouldPlay && playing) {
          if (music.paused) await music.play();
        } else music.pause();
      } else music.pause();
    } else music.pause();
  }
  function pause() {
    transport?.pause();
    playing = false;
    previewGeneration++;
    video.pause();
    music.pause();
    $('playPause').textContent = '재생';
  }
  async function operation(action, { sync = true } = {}) {
    pause();
    operationDepth += 1;
    const previousCompositeReady = compositeReady;
    const release = beginComposite(true);
    let actionCompleted = false;
    render();
    try {
      await drawing.setEnabled(false);
      const result = await action();
      actionCompleted = true;
      if (sync ? await syncPreview() : previousCompositeReady) compositeReady = true;
      return result;
    } catch (error) {
      if (!actionCompleted) {
        try {
          // A rejected picker/validation leaves the current project in place.
          // Re-present its drawing and video before releasing the retained still.
          await controller.seek(controller.state.frame, { playback: true });
          if (await syncPreview()) compositeReady = true;
        } catch (_) {
          // Keep the retained composite when the current media also cannot load.
        }
      }
      status(error.message, true);
    } finally {
      try {
        if (drawingMode && selected()) await drawing.setTool(activeTool);
        await drawing.setEnabled(drawingMode && compositeReady && !exporting && !!selected());
      } catch (error) {
        status(error.message, true);
      }
      operationDepth -= 1;
      release();
      render();
    }
  }
  let finishSeekComposite = null;
  const seekQueue = timeline.createLatestQueue(
    async (frame, hasNewer) => {
      await controller.seek(frame);
      if (!hasNewer() && (await syncPreview())) compositeReady = !hasNewer();
    },
    {
      async start() {
        pause();
        seeking = true;
        operationDepth++;
        finishSeekComposite = beginComposite(true);
        render();
        await drawing.setEnabled(false);
      },
      async finish() {
        if (!seekQueue.hasPending) {
          seeking = false;
          scrubFrame = null;
        }
        try {
          await drawing.setEnabled(!seeking && drawingMode && compositeReady && !exporting && !!selected());
        } finally {
          operationDepth--;
          finishSeekComposite?.();
          finishSeekComposite = null;
          render();
        }
      }
    }
  );
  function seek(frame) {
    if (exporting || !selected()) return Promise.resolve();
    scrubFrame = Math.max(0, Math.min(Math.round(frame), bounds()[1] - 1));
    renderPlayheads();
    return seekQueue.request(scrubFrame).catch((error) => status(error.message, true));
  }
  async function play() {
    if (playing) {
      pause();
      await operation(async () => {});
      return;
    }
    if (!selected() || controller.state.busy || exporting || operationDepth > 0) return;
    const total = core.durationFrames(controller.state.project);
    if (controller.state.frame >= total - 1) await seek(0);
    await drawing.setEnabled(false);
    await transport.play();
  }
  function button(text, action, label) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('click', action);
    return el;
  }
  function renderTimeline() {
    const state = controller.state;
    const view = timelineGeometry();
    const px = (frame) => frame * view.pxPerFrame;
    $('timelineContent').style.width =
      `${view.labelWidth + Math.max(view.viewportWidth, px(view.totalFrames))}px`;
    const track = $('clipTrack');
    track.replaceChildren();
    let offset = 0;
    for (const [index, clip] of state.project.clips.entries()) {
      const source = state.project.sources.find((item) => item.id === clip.sourceId);
      const el = button('', (event) => {
        if (event.detail === 0 && !clipDrag) void operation(() => controller.selectClip(clip.id));
      });
      el.className = `video-clip${clip.id === state.selectedId ? ' selected' : ''}${clip.kind === 'freeze' ? ' hold' : ''}`;
      const name = document.createElement('span');
      name.className = 'clip-name';
      name.textContent = `${index + 1} · ${clip.kind === 'freeze' ? '정지 · ' : ''}${source.name}`;
      const length = document.createElement('span');
      length.className = 'clip-duration';
      length.textContent = `${clip.durationFrames}F · ${(clip.durationFrames / state.project.fps).toFixed(2)}초`;
      el.append(name, length);
      el.title = `${name.textContent} · ${length.textContent}`;
      el.dataset.clipId = clip.id;
      el.dataset.startFrame = offset;
      el.style.left = `${px(offset)}px`;
      el.style.width = `${Math.max(1, px(clip.durationFrames) - 2)}px`;
      track.append(el);
      offset += clip.durationFrames;
    }
    const rows = $('drawingRows');
    rows.replaceChildren();
    rows.hidden = !expanded;
    const clip = selected();
    if (clip && expanded) {
      const layers = drawing.layers();
      const keyframes = drawing.keyframes();
      const localStart = clipStart(clip.id);
      const layerState = clip.drawingLayersV1 || { baseLayerId: layers[0]?.id, assignments: {} };
      for (const layer of Array.isArray(layers) ? layers : layers?.layers || []) {
        const row = document.createElement('div');
        row.className = 'track drawing-track';
        row.dataset.layerId = layer.id;
        const label = document.createElement('div');
        label.className = `track-label layer-label${layer.active ? ' active' : ''}${layer.visible === false ? ' hidden-layer' : ''}`;
        const eye = button(
          layer.visible === false ? '○' : '●',
          () => operation(() => controller.layerAction('toggleLayer', layer.id)),
          `${layer.name} 표시 전환`
        );
        eye.className = 'layer-visibility';
        const name = button(layer.name, () =>
          operation(() => controller.layerAction('setActiveLayer', layer.id))
        );
        name.className = 'layer-name';
        label.append(eye, name);
        const axis = document.createElement('div');
        axis.className = 'axis';
        const projected = BAEEditorPreview.layerKeyframes(keyframes, layer.id, layerState);
        for (const range of timeline.holdRanges(projected, clip.durationFrames)) {
          const start = localStart + range.start;
          const end = localStart + range.end;
          if (!range.empty) {
            const span = document.createElement('span');
            span.className = `drawing-span${range.held ? ' inherited' : ''}`;
            span.style.left = `${px(start)}px`;
            span.style.width = `${px(end - start)}px`;
            span.dataset.startFrame = start;
            span.dataset.endFrame = end;
            span.title = `${start}–${end - 1}F · ${range.duration}프레임 유지`;
            if (px(end - start) > 76) span.textContent = `${range.duration}F 유지`;
            axis.append(span);
          }
          const mark = button(
            range.empty ? '○' : '●',
            () => seek(start),
            `${start}프레임 ${range.empty ? '빈 ' : ''}키프레임${range.held ? ' · 이전 그림 유지' : ''}`
          );
          mark.className = `drawing-key${range.empty ? ' empty' : ''}${range.held ? ' held' : ''}`;
          mark.dataset.frame = start;
          mark.style.left = `${px(start)}px`;
          mark.title = range.held
            ? `${range.sourceFrame}F의 그림을 이어서 유지`
            : `${start}F · ${range.empty ? '빈 그림' : `${range.duration}F 유지`}`;
          axis.append(mark);
        }
        row.append(label, axis);
        rows.append(row);
      }
    }
    const musicTrack = $('musicTrack');
    musicTrack.replaceChildren();
    if (state.project.music) {
      const source = state.project.sources.find((item) => item.id === state.project.music.sourceId);
      const start = state.project.music.offsetFrames;
      const end = Math.min(
        view.totalFrames,
        start + Math.ceil(source.durationSeconds * state.project.fps)
      );
      if (end > start) {
        const bar = document.createElement('span');
        bar.className = 'music-bar';
        bar.textContent = source.name;
        bar.style.left = `${px(start)}px`;
        bar.style.width = `${px(end - start)}px`;
        musicTrack.append(bar);
      }
    }
    renderOverview();
    renderTimelineViewport();
  }
  function renderOverview() {
    const total = bounds()[1];
    const track = $('timelineOverviewClips');
    track.replaceChildren();
    let start = 0;
    for (const clip of controller.state.project.clips) {
      const mark = document.createElement('span');
      mark.className = `overview-clip${clip.kind === 'freeze' ? ' hold' : ''}${clip.id === controller.state.selectedId ? ' selected' : ''}`;
      mark.style.left = `${(start / total) * 100}%`;
      mark.style.width = `${(clip.durationFrames / total) * 100}%`;
      track.append(mark);
      start += clip.durationFrames;
    }
  }
  function renderTimelineViewport() {
    const view = timelineGeometry();
    const ruler = $('ruler');
    ruler.replaceChildren();
    const grid = timeline.rulerTicks({ fps: controller.state.project.fps, ...view });
    $('timelineContent').style.setProperty(
      '--ruler-step-px',
      `${grid.majorStep * view.pxPerFrame}px`
    );
    for (const tick of grid.ticks) {
      const el = document.createElement('span');
      el.className = `tick ${tick.major ? 'major' : 'minor'}`;
      el.style.left = `${tick.px}px`;
      el.textContent = tick.label;
      el.dataset.frame = tick.frame;
      ruler.append(el);
    }
    const width = Math.max(view.viewportWidth, view.totalFrames * view.pxPerFrame);
    $('timelineViewport').style.left = `${(view.scrollLeft / width) * 100}%`;
    $('timelineViewport').style.width = `${Math.min(100, (view.viewportWidth / width) * 100)}%`;
    $('timelineViewport').setAttribute(
      'aria-valuenow',
      String(Math.round(view.scrollLeft / view.pxPerFrame))
    );
    $('timelineViewport').setAttribute(
      'aria-valuemax',
      String(Math.max(0, view.totalFrames - Math.floor(view.viewportWidth / view.pxPerFrame)))
    );
    $('timelineZoomRange').value = timeline.scaleSlider(
      view.pxPerFrame,
      view.limits.min,
      view.limits.max
    );
    const fps = controller.state.project.fps;
    const tickLabel =
      grid.majorStep < fps
        ? `${grid.majorStep}F`
        : `${Number((grid.majorStep / fps).toFixed(2))}초`;
    $('timelineScale').textContent =
      `눈금 ${tickLabel} · 표시 ${(Math.min(view.totalFrames, view.viewportWidth / view.pxPerFrame) / fps).toFixed(1)}초`;
    $('timelineZoomOut').disabled = view.pxPerFrame <= view.limits.min + 1e-9;
    $('timelineZoomIn').disabled = view.pxPerFrame >= view.limits.max - 1e-9;
    renderPlayheads();
  }
  function renderPlayheads() {
    if (!controller || !$('timelineScroll')) return;
    const view = timelineGeometry();
    const frame = scrubFrame ?? controller.state.frame;
    const x = frame * view.pxPerFrame;
    if (playing && (x < view.scrollLeft || x > view.scrollLeft + view.viewportWidth - 16)) {
      $('timelineScroll').scrollLeft = Math.max(0, x - view.viewportWidth * 0.25);
    }
    document.querySelectorAll('#timelineContent .track .axis').forEach((axis) => {
      let mark = axis.querySelector('.playhead');
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'playhead';
        axis.append(mark);
      }
      mark.style.left = `${x}px`;
      mark.dataset.frame = frame;
    });
    document
      .querySelectorAll('.drawing-key')
      .forEach((key) => key.classList.toggle('active', Number(key.dataset.frame) === frame));
    $('scrub').value = frame;
  }
  function zoomTimeline(nextScale, anchorX) {
    const view = timelineGeometry();
    const result = timeline.zoomAt({
      scale: view.pxPerFrame,
      nextScale,
      scrollLeft: view.scrollLeft,
      anchorX: anchorX ?? view.viewportWidth / 2,
      viewportWidth: view.viewportWidth,
      totalFrames: view.totalFrames
    });
    timelineMode = 'manual';
    timelineScale = result.scale;
    timelineRevision++;
    renderTimeline();
    $('timelineScroll').scrollLeft = result.scrollLeft;
    renderTimelineViewport();
  }
  function fitTimeline(mode = 'all') {
    const view = timelineGeometry();
    const clip = selected();
    if (mode === 'clip' && clip) {
      timelineMode = 'manual';
      timelineScale = Math.min(view.limits.max, view.viewportWidth / clip.durationFrames);
    } else {
      timelineMode = 'fit';
      timelineScale = view.limits.min;
    }
    timelineRevision++;
    renderTimeline();
    $('timelineScroll').scrollLeft =
      mode === 'clip' && clip ? clipStart(clip.id) * timelineScale : 0;
    renderTimelineViewport();
  }
  function render() {
    if (!controller) return;
    const state = controller.state,
      project = state.project,
      clip = selected();
    const source = project.sources.find((s) => s.id === clip?.sourceId);
    const locked = state.busy || exporting || operationDepth > 0;
    $('projectTitle').textContent = `${project.name}${state.dirty ? ' · 저장 안 됨' : ''}`;
    document.title = `${state.dirty ? '● ' : ''}${project.name} · BAEFRAME 영상 편집`;
    $('outputInfo').textContent = `${project.width} × ${project.height} · ${project.fps}fps`;
    $('emptyState').hidden = !!project.clips.length;
    $('timeDisplay').textContent =
      `${timecode(state.frame)} / ${timecode(core.durationFrames(project))}`;
    const resolved = core.resolveFrame(project, state.frame);
    $('sourceTime').textContent = resolved
      ? `원본 ${resolved.sourceTime.toFixed(2)}초${clip?.kind === 'freeze' ? ' · 정지' : ''}`
      : '원본 —';
    $('selectedClipName').textContent = source?.name || '없음';
    $('drawingClipLabel').textContent = clip
      ? '선택한 컷의 드로잉 · 영상에 포함'
      : '드로잉 · 영상에 포함';
    if (document.activeElement !== $('projectName')) $('projectName').value = project.name;
    retainSelectValue(
      $('aspectRatio'),
      `${project.width}x${project.height}`,
      `현재 ${project.width} × ${project.height}`
    );
    retainSelectValue($('projectFps'), String(project.fps), `현재 ${project.fps}fps`);
    const hasDrawings = project.clips.some((c) =>
      c.drawingsV3?.keyframes?.some((k) => k.objects?.length)
    );
    $('aspectRatio').disabled = locked || hasDrawings;
    $('aspectRatio').title = hasDrawings ? '화면 비율은 그림을 추가하기 전에 선택해주세요.' : '';
    $('projectFps').disabled = locked || !!project.clips.length;
    const [start, end] = bounds();
    $('scrub').min = start;
    $('scrub').max = Math.max(start, end - 1);
    $('scrub').value = scrubFrame ?? state.frame;
    $('scrub').disabled = exporting || !clip;
    $('clipFit').value = clip?.fit || 'contain';
    $('clipVolume').value = Math.round((clip?.volume ?? 1) * 100);
    $('clipVolumeValue').textContent = `${Math.round((clip?.volume ?? 1) * 100)}%`;
    $('musicVolume').value = Math.round((project.music?.volume ?? 0.5) * 100);
    $('musicName').textContent =
      project.sources.find((s) => s.id === project.music?.sourceId)?.name || '추가된 음악 없음';
    [
      'importVideo',
      'emptyImport',
      'importMusic',
      'openProject',
      'saveProject',
      'saveAsProject',
      'projectName',
      'timelineZoom'
    ].forEach((id) => {
      $(id).disabled = locked;
    });
    [
      'splitClip',
      'deleteClip',
      'moveLeft',
      'moveRight',
      'applyTrim',
      'insertHold',
      'clipFit',
      'drawMode',
      'addLayer',
      'previousFrame',
      'nextFrame'
    ].forEach((id) => {
      $(id).disabled = locked || !clip;
    });
    $('playPause').disabled = exporting || !clip;
    $('exportVideo').disabled = locked || !clip;
    $('clipVolume').disabled = locked || !clip || clip.kind === 'freeze';
    $('musicVolume').disabled = locked || !project.music;
    $('removeMusic').disabled = locked || !project.music;
    $('undo').disabled = locked || !state.canUndo;
    $('redo').disabled = locked || !state.canRedo;
    document
      .querySelectorAll('button[data-tool],button[data-editor-tool],button[data-draw-action]')
      .forEach((b) => {
        b.disabled = locked || !clip;
      });
    renderToolState();
    const timelineKey = `${state.revision}:${state.selectedId}:${expanded}:${timelineRevision}`;
    // The controller emits while a new clip is still loading. Rebuild only after
    // it finishes, and keep frame-only playback updates away from V3 cloning.
    if (!state.busy && timelineKey !== lastTimelineKey) {
      lastTimelineKey = timelineKey;
      renderTimeline();
    } else renderPlayheads();
    layoutStage();
  }
  function retainSelectValue(select, value, label) {
    select.querySelectorAll('[data-project-custom]').forEach((option) => {
      if (option.value !== value) option.remove();
    });
    if (![...select.options].some((option) => option.value === value)) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.dataset.projectCustom = 'true';
      select.append(option);
    }
    select.value = value;
  }
  function layoutStage() {
    const area = document.querySelector('.stage-area');
    const project = controller.state.project;
    const style = getComputedStyle(area);
    const contentWidth = Math.max(
      1,
      area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    );
    const contentHeight = Math.max(
      1,
      area.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    );
    const width = Math.min(contentWidth, (contentHeight * project.width) / project.height);
    stageBase = {
      width: Math.max(1, width),
      height: (Math.max(1, width) * project.height) / project.width
    };
    $('stage').style.width = `${stageBase.width}px`;
    $('stage').style.aspectRatio = `${project.width}/${project.height}`;
    stageView.zoom =
      stageZoomMode === 'fit'
        ? 1
        : ((Number(stageZoomMode) / 100) * project.width) / stageBase.width;
    applyStageTransform();
  }
  function applyStageTransform() {
    const area = $('stageViewport');
    stageView = {
      ...stageView,
      ...timeline.clampPan({
        ...stageView,
        stageWidth: stageBase.width,
        stageHeight: stageBase.height,
        viewportWidth: area.clientWidth,
        viewportHeight: area.clientHeight
      })
    };
    const key = `${stageBase.width}:${stageView.zoom}:${stageView.panX}:${stageView.panY}`;
    if (key === stageGeometryKey) return;
    stageGeometryKey = key;
    $('stage').style.transformOrigin = 'center center';
    $('stage').style.transform =
      `translate(${stageView.panX}px, ${stageView.panY}px) scale(${stageView.zoom})`;
    document.body.dataset.previewZoom = stageZoomMode;
    drawing.refreshViewport?.();
  }
  function setPreviewZoom(value, clientX, clientY) {
    const area = $('stageViewport').getBoundingClientRect();
    const nextZoom =
      value === 'fit'
        ? 1
        : ((Number(value) / 100) * controller.state.project.width) / stageBase.width;
    if (!Number.isFinite(nextZoom) || nextZoom <= 0) return;
    stageView = timeline.zoomPreview({
      ...stageView,
      nextZoom,
      anchorX: clientX === undefined ? 0 : clientX - area.left - area.width / 2,
      anchorY: clientY === undefined ? 0 : clientY - area.top - area.height / 2
    });
    stageZoomMode = String(value);
    if (value === 'fit') {
      stageView.panX = 0;
      stageView.panY = 0;
    }
    retainSelectValue($('previewZoom'), stageZoomMode, `${Math.round(Number(value))}%`);
    applyStageTransform();
  }
  function renderToolState() {
    document.body.dataset.editorTool = activeTool;
    document.body.dataset.drawingMode = drawingMode ? 'true' : 'false';
    const names = {
      select: '선택',
      razor: '자르기',
      hand: '화면 이동',
      brush: '브러시',
      eraser: '지우개',
      line: '직선',
      rect: '사각형',
      arrow: '화살표'
    };
    if ($('activeToolName')) $('activeToolName').textContent = names[activeTool] || activeTool;
    document.querySelectorAll('button[data-tool],button[data-editor-tool]').forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String((button.dataset.editorTool || button.dataset.tool) === activeTool)
      );
    });
    $('drawMode').setAttribute('aria-pressed', String(drawingMode));
  }
  function setEditorTool(tool) {
    if (!selected() || operationDepth || controller.state.busy || exporting)
    {return Promise.resolve();}
    return operation(
      async () => {
        activeTool = tool;
        drawingMode = !['hand', 'razor'].includes(tool);
        if (drawingMode) await drawing.setTool(tool);
        renderToolState();
      },
      { sync: false }
    );
  }
  function clearClipDrag() {
    if (clipDragAnimation !== null) cancelAnimationFrame(clipDragAnimation);
    clipDragAnimation = null;
    document
      .querySelectorAll('.clip-insertion-ghost,.clip-drag-preview')
      .forEach((element) => element.remove());
    document
      .querySelectorAll('.video-clip.is-dragging')
      .forEach((element) => element.classList.remove('is-dragging'));
    document.body.classList.remove('editor-dragging-clip');
  }
  function paintClipDrag() {
    if (!clipDrag?.dragging) return;
    const view = timelineGeometry();
    const contentX = clipDrag.clientX - view.left - view.labelWidth + view.scrollLeft;
    const frame = Math.max(0, contentX / view.pxPerFrame);
    clipDrag.target = timeline.insertionTarget(controller.state.project.clips, clipDrag.id, frame);
    let ghost = $('clipTrack').querySelector('.clip-insertion-ghost');
    if (!ghost) {
      ghost = document.createElement('span');
      ghost.className = 'clip-insertion-ghost';
      $('clipTrack').append(ghost);
    }
    ghost.style.left = `${clipDrag.target.frame * view.pxPerFrame}px`;
    ghost.dataset.index = clipDrag.target.index;
    ghost.setAttribute('aria-label', `${clipDrag.target.index + 1}번째 위치로 이동`);
    let preview = $('clipTrack').querySelector('.clip-drag-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.className = 'clip-drag-preview';
      preview.textContent = clipDrag.name;
      preview.style.width = `${clipDrag.duration * view.pxPerFrame}px`;
      $('clipTrack').append(preview);
    }
    preview.style.left = `${contentX - clipDrag.grabOffset}px`;
  }
  function scrollClipDrag() {
    if (!clipDrag?.dragging) return;
    const view = timelineGeometry();
    const relative = clipDrag.clientX - view.left - view.labelWidth;
    const speed =
      relative < 36
        ? -Math.min(24, (36 - relative) * 0.4)
        : relative > view.viewportWidth - 36
          ? Math.min(24, (relative - view.viewportWidth + 36) * 0.4)
          : 0;
    if (speed) $('timelineScroll').scrollLeft += speed;
    paintClipDrag();
    clipDragAnimation = requestAnimationFrame(scrollClipDrag);
  }
  $('clipTrack').addEventListener('pointerdown', (event) => {
    const clipElement = event.target.closest('.video-clip');
    if (event.button !== 0 || !clipElement || operationDepth || controller.state.busy || exporting)
    {return;}
    event.preventDefault();
    const id = clipElement.dataset.clipId;
    const clip = controller.state.project.clips.find((item) => item.id === id);
    const frame = frameAtPointer(event.clientX);
    if (activeTool === 'razor') {
      const target = timeline.razorTarget(controller.state.project.clips, id, frame);
      if (!target) {
        status('컷 안쪽 프레임을 클릭하면 나눌 수 있습니다.');
        return;
      }
      void operation(async () => {
        await controller.seek(target.frame);
        await controller.edit('splitClip', target.clipId, target.localFrame);
      });
      return;
    }
    if (activeTool === 'hand') return;
    pause();
    const view = timelineGeometry();
    clipDrag = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      frame,
      dragging: false,
      name: clipElement.textContent,
      duration: clip.durationFrames,
      grabOffset:
        event.clientX -
        view.left -
        view.labelWidth +
        view.scrollLeft -
        clipStart(id) * view.pxPerFrame
    };
    $('clipTrack').setPointerCapture(event.pointerId);
  });
  $('clipTrack').addEventListener('pointermove', (event) => {
    if (!clipDrag || event.pointerId !== clipDrag.pointerId) return;
    clipDrag.clientX = event.clientX;
    if (
      !clipDrag.dragging &&
      Math.hypot(event.clientX - clipDrag.startX, event.clientY - clipDrag.startY) >= 5
    ) {
      clipDrag.dragging = true;
      document.body.classList.add('editor-dragging-clip');
      [...$('clipTrack').querySelectorAll('[data-clip-id]')]
        .find((element) => element.dataset.clipId === clipDrag.id)
        ?.classList.add('is-dragging');
      scrollClipDrag();
    }
    paintClipDrag();
  });
  function finishClipDrag(event, cancelled = false) {
    if (!clipDrag || event.pointerId !== clipDrag.pointerId) return;
    const drag = clipDrag;
    clipDrag = null;
    if ($('clipTrack').hasPointerCapture(event.pointerId))
    {$('clipTrack').releasePointerCapture(event.pointerId);}
    clearClipDrag();
    if (cancelled) return;
    if (drag.dragging && drag.target) {
      const current = controller.state.project.clips.findIndex((clip) => clip.id === drag.id);
      if (drag.target.index !== current) {
        void operation(async () => {
          if (controller.state.selectedId !== drag.id) await controller.selectClip(drag.id);
          await controller.edit('moveClip', drag.id, drag.target.index);
        });
      }
    } else void seek(drag.frame);
  }
  $('clipTrack').addEventListener('pointerup', (event) => finishClipDrag(event));
  $('clipTrack').addEventListener('pointercancel', (event) => finishClipDrag(event, true));
  $('clipTrack').addEventListener('lostpointercapture', (event) => finishClipDrag(event, true));
  $('clipTrack').addEventListener('dragstart', (event) => event.preventDefault());
  let rulerPointer = null;
  $('ruler').addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || exporting || !selected()) return;
    event.preventDefault();
    rulerPointer = event.pointerId;
    $('ruler').setPointerCapture(event.pointerId);
    void seek(frameAtPointer(event.clientX));
  });
  $('ruler').addEventListener('pointermove', (event) => {
    if (rulerPointer === event.pointerId) void seek(frameAtPointer(event.clientX));
  });
  $('ruler').addEventListener('pointerup', (event) => {
    if (rulerPointer !== event.pointerId) return;
    rulerPointer = null;
    void seek(frameAtPointer(event.clientX));
    if ($('ruler').hasPointerCapture(event.pointerId))
    {$('ruler').releasePointerCapture(event.pointerId);}
  });
  $('ruler').addEventListener('pointercancel', () => {
    rulerPointer = null;
  });
  $('timelineScroll').addEventListener(
    'pointerdown',
    (event) => {
      if ((activeTool !== 'hand' || event.button !== 0) && event.button !== 1) return;
      if (exporting || operationDepth) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pause();
      timelinePan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: $('timelineScroll').scrollLeft,
        top: $('timelineScroll').scrollTop
      };
      $('timelineScroll').setPointerCapture(event.pointerId);
      document.body.classList.add('editor-panning');
    },
    true
  );
  $('timelineScroll').addEventListener(
    'pointermove',
    (event) => {
      if (!timelinePan || timelinePan.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      $('timelineScroll').scrollLeft = timelinePan.left + timelinePan.x - event.clientX;
      $('timelineScroll').scrollTop = timelinePan.top + timelinePan.y - event.clientY;
    },
    true
  );
  function endTimelinePan(event) {
    if (!timelinePan || timelinePan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    timelinePan = null;
    document.body.classList.remove('editor-panning');
    if ($('timelineScroll').hasPointerCapture(event.pointerId))
    {$('timelineScroll').releasePointerCapture(event.pointerId);}
  }
  $('timelineScroll').addEventListener('pointerup', endTimelinePan, true);
  $('timelineScroll').addEventListener('pointercancel', endTimelinePan, true);
  $('timelineScroll').addEventListener('lostpointercapture', endTimelinePan, true);
  $('timelineScroll').addEventListener('scroll', renderTimelineViewport, { passive: true });
  $('timelineScroll').addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const view = timelineGeometry();
        zoomTimeline(
          view.pxPerFrame * Math.exp(-event.deltaY * 0.003),
          Math.max(0, event.clientX - view.left - view.labelWidth)
        );
      } else if (event.shiftKey) {
        event.preventDefault();
        $('timelineScroll').scrollLeft += event.deltaX || event.deltaY;
      }
    },
    { passive: false }
  );
  $('timelineZoomIn').onclick = () => zoomTimeline(timelineGeometry().pxPerFrame * 1.5);
  $('timelineZoomOut').onclick = () => zoomTimeline(timelineGeometry().pxPerFrame / 1.5);
  $('timelineZoomRange').oninput = (event) => {
    const view = timelineGeometry();
    zoomTimeline(
      timeline.sliderScale(Number(event.target.value), view.limits.min, view.limits.max)
    );
  };
  $('timelineFit').onclick = () => fitTimeline();
  let overviewDrag = null;
  $('timelineOverview').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const view = timelineGeometry();
    const rect = $('timelineOverview').getBoundingClientRect();
    const totalWidth = Math.max(view.viewportWidth, view.totalFrames * view.pxPerFrame);
    const x = ((event.clientX - rect.left) / rect.width) * totalWidth;
    const inside = event.target.closest('#timelineViewport');
    overviewDrag = {
      pointerId: event.pointerId,
      grabOffset: inside ? x - view.scrollLeft : view.viewportWidth / 2
    };
    $('timelineOverview').setPointerCapture(event.pointerId);
    $('timelineScroll').scrollLeft = x - overviewDrag.grabOffset;
  });
  $('timelineOverview').addEventListener('pointermove', (event) => {
    if (!overviewDrag || event.pointerId !== overviewDrag.pointerId) return;
    const view = timelineGeometry();
    const rect = $('timelineOverview').getBoundingClientRect();
    const totalWidth = Math.max(view.viewportWidth, view.totalFrames * view.pxPerFrame);
    $('timelineScroll').scrollLeft =
      ((event.clientX - rect.left) / rect.width) * totalWidth - overviewDrag.grabOffset;
  });
  const endOverview = (event) => {
    if (overviewDrag?.pointerId !== event.pointerId) return;
    overviewDrag = null;
    if ($('timelineOverview').hasPointerCapture(event.pointerId))
    {$('timelineOverview').releasePointerCapture(event.pointerId);}
  };
  $('timelineOverview').addEventListener('pointerup', endOverview);
  $('timelineOverview').addEventListener('pointercancel', endOverview);
  $('timelineViewport').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const view = timelineGeometry();
    $('timelineScroll').scrollLeft =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? view.totalFrames * view.pxPerFrame
          : view.scrollLeft + (event.key === 'ArrowRight' ? 1 : -1) * view.viewportWidth * 0.25;
  });
  $('timelineViewport').tabIndex = 0;
  $('timelineViewport').setAttribute('role', 'scrollbar');
  $('timelineViewport').setAttribute('aria-orientation', 'horizontal');
  $('timelineViewport').setAttribute('aria-label', '타임라인 표시 범위');
  $('timelineViewport').setAttribute('aria-valuemin', '0');
  function insideStage(event) {
    const rect = $('stageViewport').getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      if ((!['hand'].includes(activeTool) || event.button !== 0) && event.button !== 1) return;
      if (!insideStage(event) || !selected() || exporting || operationDepth) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pause();
      stagePan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        panX: stageView.panX,
        panY: stageView.panY
      };
      document.body.classList.add('editor-panning');
      document.documentElement.setPointerCapture(event.pointerId);
      void drawing.setEnabled(false);
    },
    true
  );
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!stagePan || stagePan.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stageView.panX = stagePan.panX + event.clientX - stagePan.x;
      stageView.panY = stagePan.panY + event.clientY - stagePan.y;
      applyStageTransform();
    },
    true
  );
  function endStagePan(event) {
    if (!stagePan || stagePan.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    stagePan = null;
    document.body.classList.remove('editor-panning');
    if (document.documentElement.hasPointerCapture(event.pointerId))
    {document.documentElement.releasePointerCapture(event.pointerId);}
    void drawing.setEnabled(drawingMode && !playing && !exporting);
  }
  document.addEventListener('pointerup', endStagePan, true);
  document.addEventListener('pointercancel', endStagePan, true);
  document.addEventListener('lostpointercapture', endStagePan, true);
  document.addEventListener(
    'wheel',
    (event) => {
      if (!insideStage(event) || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = ((stageBase.width * stageView.zoom) / controller.state.project.width) * 100;
      const next = Math.round(
        Math.max(10, Math.min(400, current * Math.exp(-event.deltaY * 0.002)))
      );
      setPreviewZoom(String(next), event.clientX, event.clientY);
    },
    { capture: true, passive: false }
  );
  $('previewZoom').onchange = (event) => setPreviewZoom(event.target.value);
  $('resetPreview').onclick = () => setPreviewZoom('fit');
  new ResizeObserver(layoutStage).observe(document.querySelector('.stage-area'));
  new ResizeObserver(() => {
    if (!controller) return;
    timelineRevision++;
    renderTimeline();
  }).observe($('timelineScroll'));
  $('importVideo').onclick = $('emptyImport').onclick = () =>
    operation(() => controller.importMedia());
  $('importMusic').onclick = () => operation(() => controller.importMedia('audio'));
  $('openProject').onclick = () => operation(() => controller.open());
  function saveProject(saveAs = false) {
    if (savePending || exporting || composing) return Promise.resolve();
    // Capture the live input before operation's render can restore model values.
    const change = projectFieldChange(document.activeElement);
    savePending = true;
    return operation(async () => {
      if (change) await controller.update(change);
      const r = await controller.save(saveAs);
      if (r && !r.cancelled) status(`저장 완료 · ${r.path}`);
    }).finally(() => { savePending = false; });
  }
  $('saveProject').onclick = () => saveProject();
  $('saveAsProject').onclick = () => saveProject(true);
  $('playPause').onclick = () => {
    void play().catch((e) => status(e.message, true));
  };
  $('previousFrame').onclick = () => seek(controller.state.frame - 1);
  $('nextFrame').onclick = () => seek(controller.state.frame + 1);
  $('scrub').oninput = (e) => seek(Number(e.target.value));
  $('splitClip').onclick = () =>
    operation(() =>
      controller.edit('splitClip', selected().id, controller.state.frame - clipStart(selected().id))
    );
  $('deleteClip').onclick = () => operation(() => controller.edit('removeClip', selected().id));
  $('moveLeft').onclick = () =>
    operation(() =>
      controller.edit(
        'moveClip',
        selected().id,
        Math.max(0, controller.state.project.clips.findIndex((c) => c.id === selected().id) - 1)
      )
    );
  $('moveRight').onclick = () =>
    operation(() =>
      controller.edit(
        'moveClip',
        selected().id,
        Math.min(
          controller.state.project.clips.length - 1,
          controller.state.project.clips.findIndex((c) => c.id === selected().id) + 1
        )
      )
    );
  $('applyTrim').onclick = () =>
    operation(async () => {
      await controller.edit(
        'trimClip',
        selected().id,
        Math.round(Number($('trimStart').value) * controller.state.project.fps),
        Math.round(Number($('trimEnd').value) * controller.state.project.fps)
      );
      $('trimStart').value = 0;
      $('trimEnd').value = 0;
    });
  $('insertHold').onclick = () =>
    operation(() =>
      controller.edit(
        'insertHold',
        selected().id,
        controller.state.frame - clipStart(selected().id),
        Math.max(1, Math.round(Number($('holdSeconds').value) * controller.state.project.fps)),
        $('holdType').value === 'replace'
      )
    );
  $('undo').onclick = () => operation(() => controller.undo());
  $('redo').onclick = () => operation(() => controller.redo());
  $('expandLayers').onclick = () => {
    expanded = !expanded;
    $('expandLayers').textContent = expanded ? '드로잉 접기' : '드로잉 펼치기';
    $('expandLayers').setAttribute('aria-expanded', String(expanded));
    render();
  };
  $('timelineZoom').onchange = (event) => fitTimeline(event.target.value);
  $('addLayer').onclick = () => operation(() => controller.layerAction('addLayer'));
  $('drawMode').onclick = () =>
    operation(
      async () => {
        drawingMode = !drawingMode;
        if (drawingMode) {
          if (['hand', 'razor'].includes(activeTool)) activeTool = 'brush';
          await drawing.setTool(activeTool);
        }
        renderToolState();
      },
      { sync: false }
    );
  document.querySelectorAll('button[data-tool],button[data-editor-tool]').forEach((b) => {
    b.onclick = () => setEditorTool(b.dataset.editorTool || b.dataset.tool);
  });
  document.querySelectorAll('[data-draw-action]').forEach((b) => {
    b.onclick = () => operation(() => controller.drawingAction(b.dataset.drawAction));
  });
  function projectFieldChange(element) {
    const project = controller.state.project;
    if (element?.id === 'projectName') {
      const name = element.value.trim() || '새 편집';
      return name === project.name ? null : p => ({ ...p, name });
    }
    if (element?.id === 'aspectRatio') {
      const [width, height] = element.value.split('x').map(Number);
      return width === project.width && height === project.height ? null : p => ({ ...p, width, height });
    }
    if (element?.id === 'projectFps') {
      const fps = Number(element.value);
      return fps === project.fps ? null : p => ({ ...p, fps });
    }
    if (['clipFit', 'clipVolume'].includes(element?.id) && selected()) {
      const clip = selected();
      const field = element.id === 'clipFit' ? 'fit' : 'volume';
      const value = field === 'fit' ? element.value : Number(element.value) / 100;
      return value === clip[field] ? null : p => {
        p.clips.find(c => c.id === clip.id)[field] = value;
        return p;
      };
    }
    if (element?.id === 'musicVolume' && project.music) {
      const volume = Number(element.value) / 100;
      return volume === project.music.volume ? null : p => ({ ...p, music: { ...p.music, volume } });
    }
    // Trim/hold fields are drafts for their explicit action buttons, not edits.
    return null;
  }
  for (const id of ['projectName', 'aspectRatio', 'projectFps', 'clipFit', 'clipVolume', 'musicVolume']) {
    $(id).onchange = () => {
      const change = projectFieldChange($(id));
      return change ? operation(() => controller.update(change)) : Promise.resolve();
    };
  }
  $('removeMusic').onclick = () =>
    operation(() => controller.update((p) => ({ ...p, music: null })));
  $('exportVideo').onclick = () =>
    operation(async () => {
      exporting = true;
      $('exportProgress').hidden = false;
      $('progress').value = 0;
      render();
      try {
        const result = await controller.exportVideo();
        status(result?.cancelled ? '출력을 취소했습니다.' : `MP4 저장 완료 · ${result.path}`);
      } finally {
        exporting = false;
        $('exportProgress').hidden = true;
      }
    });
  $('cancelExport').onclick = () => {
    void controller.cancelExport().catch((e) => status(e.message, true));
  };
  api.onExportProgress((progress) => {
    $('progress').value = progress.progress || 0;
    status(progress.message || '영상 출력 중…');
  });
  document.addEventListener('compositionstart', () => { composing = true; });
  document.addEventListener('compositionend', () => { composing = false; });
  document.addEventListener('keydown', (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!controller.state.busy && !exporting && !operationDepth) void saveProject();
      return;
    }
    if (e.target.closest('input,textarea,select,[contenteditable=true]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      void play();
      return;
    }
    if (controller.state.busy || exporting) return;
    const tool = timeline.shortcutTool(e);
    if (tool) {
      e.preventDefault();
      void setEditorTool(tool);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      (e.shiftKey ? $('redo') : $('undo')).click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      $('redo').click();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      void seek(controller.state.frame - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      void seek(controller.state.frame + 1);
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && ['+', '=', '-'].includes(e.key)) {
      e.preventDefault();
      zoomTimeline(timelineGeometry().pxPerFrame * (e.key === '-' ? 1 / 1.5 : 1.5));
    } else if (e.key === 'Escape' && clipDrag) {
      const pointerId = clipDrag.pointerId;
      finishClipDrag({ pointerId }, true);
    }
  });
  window.addEventListener('beforeunload', () => {
    clipDrag = null;
    clearClipDrag();
    pause();
    drawing.dispose();
  });
  render();
})();
