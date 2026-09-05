/* global BAEEditProject, BAEEditorController, BAEEditorDrawing, BAEEditorPreview */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const core = BAEEditProject;
  const api = window.editorAPI;
  const video = $('videoPreview');
  const music = $('musicPreview');
  let controller = null;
  let playing = false;
  let drawingMode = false;
  let expanded = true;
  let exporting = false;
  let transport = null;
  let previewGeneration = 0;
  let lastVideoPath = '';
  let lastMusicPath = '';
  let dragClipId = null;
  let latestSeek = null;
  let seeking = false;
  let operationDepth = 0;
  let lastTimelineKey = '';
  let compositePending = 0;
  let compositeReady = false;
  let musicReady = Promise.resolve();

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
    core, video, getProject: () => controller.state.project, getFrame: () => controller.state.frame,
    async onFrame(frame, { prepare }) {
      const release = beginComposite();
      try {
        if (prepare) music.pause();
        await controller.seek(frame, { playback: true });
        if (prepare) {
          if (await syncPreview()) compositeReady = true;
        } else compositeReady = true;
        if (!playing && operationDepth === 0) await drawing.setEnabled(drawingMode);
      } finally { release(); }
    },
    onTime(seconds) { void syncMusic(seconds, true).catch(error => status(error.message, true)); },
    onPlaying(value) {
      playing = value;
      $('playPause').textContent = value ? '일시정지' : '재생';
      if (!value) music.pause();
      render();
    },
    onError(error) { status(error.message, true); }
  });

  function beginComposite() {
    compositePending++;
    compositeReady = false;
    document.body.classList.add('editor-seeking');
    return () => {
      compositePending--;
      document.body.classList.toggle('editor-seeking', compositePending > 0 || !compositeReady);
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
    const clip = selected();
    if ($('timelineZoom').value === 'clip' && clip) {
      const start = clipStart(clip.id);
      return [start, start + clip.durationFrames];
    }
    return [0, Math.max(1, core.durationFrames(controller.state.project))];
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
    const current = () => generation === previewGeneration && state.project === project && state.frame === frame;
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
        if (Math.abs(music.currentTime - position) > (shouldPlay ? 0.05 : 0.000001)) music.currentTime = position;
        if (shouldPlay && playing) {
          if (music.paused) await music.play();
        }
        else music.pause();
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
  async function operation(action) {
    pause();
    operationDepth += 1;
    const release = beginComposite();
    render();
    try {
      await drawing.setEnabled(false);
      const result = await action();
      if (await syncPreview()) compositeReady = true;
      return result;
    } catch (error) {
      status(error.message, true);
    } finally {
      try {
        await drawing.setEnabled(drawingMode && !exporting && !!selected());
      } catch (error) {
        status(error.message, true);
      }
      operationDepth -= 1;
      release();
      render();
    }
  }
  async function seek(frame) {
    latestSeek = frame;
    if (seeking) return;
    seeking = true;
    try {
      while (latestSeek !== null) {
        const target = latestSeek;
        latestSeek = null;
        await operation(() => controller.seek(target));
      }
    } finally {
      seeking = false;
    }
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
    const [start, end] = bounds();
    const pct = (frame) => ((frame - start) / (end - start)) * 100;
    const ruler = $('ruler');
    ruler.replaceChildren();
    for (let i = 0; i <= 5; i++) {
      const el = document.createElement('span');
      el.className = 'tick';
      el.style.left = `${i * 20}%`;
      el.textContent = timecode(Math.floor(start + ((end - start) * i) / 5));
      ruler.append(el);
    }
    const track = $('clipTrack');
    track.replaceChildren();
    let offset = 0;
    state.project.clips.forEach((clip, index) => {
      const lo = Math.max(offset, start),
        hi = Math.min(offset + clip.durationFrames, end);
      offset += clip.durationFrames;
      if (hi <= lo) return;
      const source = state.project.sources.find((s) => s.id === clip.sourceId);
      const el = button(
        `${index + 1} · ${clip.kind === 'freeze' ? '정지 · ' : ''}${source.name}`,
        () => operation(() => controller.selectClip(clip.id))
      );
      el.className = `video-clip${clip.id === state.selectedId ? ' selected' : ''}${clip.kind === 'freeze' ? ' hold' : ''}`;
      el.title = `${source.name} · ${(clip.durationFrames / state.project.fps).toFixed(2)}초`;
      el.dataset.clipId = clip.id;
      el.style.left = `${pct(lo)}%`;
      el.style.width = `calc(${((hi - lo) / (end - start)) * 100}% - 2px)`;
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        dragClipId = clip.id;
        e.dataTransfer.setData('text/plain', clip.id);
      });
      el.addEventListener('dragover', (e) => e.preventDefault());
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (dragClipId) void operation(() => controller.edit('moveClip', dragClipId, index));
        dragClipId = null;
      });
      track.append(el);
    });
    const rows = $('drawingRows');
    rows.replaceChildren();
    rows.hidden = !expanded;
    const clip = selected();
    if (clip && expanded) {
      const layers = drawing.layers();
      const keyframes = drawing.keyframes();
      const localStart = clipStart(clip.id);
      for (const layer of Array.isArray(layers) ? layers : layers?.layers || []) {
        const row = document.createElement('div');
        row.className = 'track';
        const label = document.createElement('div');
        label.className = `track-label layer-label${layer.active ? ' active' : ''}${layer.visible === false ? ' hidden-layer' : ''}`;
        const eye = button(
          layer.visible === false ? '○' : '●',
          () => operation(() => controller.layerAction('toggleLayer', layer.id)),
          `${layer.name} 표시 전환`
        );
        const name = button(layer.name, () =>
          operation(() => controller.layerAction('setActiveLayer', layer.id))
        );
        name.className = 'layer-name';
        label.append(eye, name);
        const axis = document.createElement('div');
        axis.className = 'axis';
        const layerState = clip.drawingLayersV1 || { baseLayerId: layers[0]?.id, assignments: {} };
        const projected = BAEEditorPreview.layerKeyframes(keyframes, layer.id, layerState);
        projected.forEach((key, i) => {
          const lo = Math.max(start, localStart + key.frame);
          const hi = Math.min(end, localStart + (projected[i + 1]?.frame ?? clip.durationFrames));
          if (hi <= lo) return;
          if (!key.isEmpty) {
            const span = document.createElement('span');
            span.className = 'drawing-span';
            span.style.left = `${pct(lo)}%`;
            span.style.width = `${((hi - lo) / (end - start)) * 100}%`;
            axis.append(span);
          }
          const mark = button(
            key.isEmpty ? '○' : '●',
            () => seek(localStart + key.frame),
            `${key.frame}프레임 ${key.isEmpty ? '빈 ' : ''}키프레임`
          );
          mark.className = 'drawing-key';
          mark.style.left = `${pct(lo)}%`;
          axis.append(mark);
        });
        row.append(label, axis);
        rows.append(row);
      }
    }
    const musicTrack = $('musicTrack');
    musicTrack.replaceChildren();
    if (state.project.music) {
      const source = state.project.sources.find((s) => s.id === state.project.music.sourceId);
      const bar = document.createElement('span');
      bar.className = 'music-bar';
      bar.textContent = source.name;
      musicTrack.append(bar);
    }
    renderPlayheads();
  }
  function renderPlayheads() {
    const [start, end] = bounds();
    document.querySelectorAll('.playhead').forEach((e) => e.remove());
    if (controller.state.frame < start || controller.state.frame >= end) return;
    document.querySelectorAll('.track .axis').forEach((axis) => {
      const mark = document.createElement('span');
      mark.className = 'playhead';
      mark.style.left = `${((controller.state.frame - start) / (end - start)) * 100}%`;
      axis.append(mark);
    });
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
    retainSelectValue($('aspectRatio'), `${project.width}x${project.height}`, `현재 ${project.width} × ${project.height}`);
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
    $('scrub').value = state.frame;
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
    document.querySelectorAll('[data-tool],[data-draw-action]').forEach((b) => {
      b.disabled = locked || !clip;
    });
    const timelineKey = `${state.revision}:${state.selectedId}:${expanded}:${$('timelineZoom').value}`;
    // The controller emits while a new clip is still loading. Rebuild only after
    // it finishes, and keep frame-only playback updates away from V3 cloning.
    if (!state.busy && timelineKey !== lastTimelineKey) {
      lastTimelineKey = timelineKey;
      renderTimeline();
    } else renderPlayheads();
    layoutStage();
  }
  function retainSelectValue(select, value, label) {
    select.querySelectorAll('[data-project-custom]').forEach(option => { if (option.value !== value) option.remove(); });
    if (![...select.options].some(option => option.value === value)) {
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
    const width = Math.min(
      area.clientWidth - 48,
      ((area.clientHeight - 20) * project.width) / project.height
    );
    $('stage').style.width = `${Math.max(1, width)}px`;
    $('stage').style.aspectRatio = `${project.width}/${project.height}`;
  }
  new ResizeObserver(layoutStage).observe(document.querySelector('.stage-area'));
  $('importVideo').onclick = $('emptyImport').onclick = () =>
    operation(() => controller.importMedia());
  $('importMusic').onclick = () => operation(() => controller.importMedia('audio'));
  $('openProject').onclick = () => operation(() => controller.open());
  $('saveProject').onclick = () =>
    operation(async () => {
      const r = await controller.save();
      if (r && !r.cancelled) status(`저장 완료 · ${r.path}`);
    });
  $('saveAsProject').onclick = () =>
    operation(async () => {
      const r = await controller.save(true);
      if (r && !r.cancelled) status(`저장 완료 · ${r.path}`);
    });
  $('playPause').onclick = () => {
    void play().catch((e) => status(e.message, true));
  };
  $('previousFrame').onclick = () => seek(controller.state.frame - 1);
  $('nextFrame').onclick = () => seek(controller.state.frame + 1);
  $('scrub').oninput = (e) => seek(Number(e.target.value));
  $('ruler').onclick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const [start, end] = bounds();
    void seek(
      Math.min(end - 1, Math.round(start + ((e.clientX - rect.left) / rect.width) * (end - start)))
    );
  };
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
  $('timelineZoom').onchange = render;
  $('addLayer').onclick = () => operation(() => controller.layerAction('addLayer'));
  $('drawMode').onclick = () =>
    operation(async () => {
      drawingMode = !drawingMode;
      $('drawMode').setAttribute('aria-pressed', String(drawingMode));
    });
  document.querySelectorAll('[data-tool]').forEach((b) => {
    b.onclick = () =>
      operation(async () => {
        drawingMode = true;
        $('drawMode').setAttribute('aria-pressed', 'true');
        await drawing.setTool(b.dataset.tool);
      });
  });
  document.querySelectorAll('[data-draw-action]').forEach((b) => {
    b.onclick = () => operation(() => controller.drawingAction(b.dataset.drawAction));
  });
  $('projectName').onchange = () => {
    const name = $('projectName').value.trim() || '새 편집';
    return operation(() =>
      controller.update((p) => {
        p.name = name;
        return p;
      })
    );
  };
  $('aspectRatio').onchange = () => {
    const [width, height] = $('aspectRatio').value.split('x').map(Number);
    void operation(() => controller.update((p) => ({ ...p, width, height })));
  };
  $('projectFps').onchange = () => {
    const fps = Number($('projectFps').value);
    void operation(() => controller.update((p) => ({ ...p, fps })));
  };
  $('clipFit').onchange = () => {
    const fit = $('clipFit').value,
      id = selected().id;
    void operation(() =>
      controller.update((p) => {
        p.clips.find((c) => c.id === id).fit = fit;
        return p;
      })
    );
  };
  $('clipVolume').onchange = () => {
    const volume = Number($('clipVolume').value) / 100,
      id = selected().id;
    void operation(() =>
      controller.update((p) => {
        p.clips.find((c) => c.id === id).volume = volume;
        return p;
      })
    );
  };
  $('musicVolume').onchange = () => {
    const volume = Number($('musicVolume').value) / 100;
    void operation(() =>
      controller.update((p) => {
        p.music.volume = volume;
        return p;
      })
    );
  };
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
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select,[contenteditable=true]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      void play();
      return;
    }
    if (controller.state.busy || exporting) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('saveProject').click();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
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
    }
  });
  window.addEventListener('beforeunload', () => {
    pause();
    drawing.dispose();
  });
  render();
})();
