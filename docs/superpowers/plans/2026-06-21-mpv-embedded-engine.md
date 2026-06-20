# MPV Embedded Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render mpv inside BAEFRAME's viewer area instead of a separate mpv window, while keeping HTML5/FFmpeg as fallback.

**Architecture:** Create a frameless child `BrowserWindow` as the native video host, convert its native window handle to an mpv `--wid`, and launch mpv attached to that handle. The renderer sends `videoWrapper.getBoundingClientRect()` to the main process so the host follows the BAEFRAME viewer bounds.

**Tech Stack:** Electron `BrowserWindow`, mpv `--wid`, mpv JSON IPC, Electron IPC, Node test runner.

## Global Constraints

- Existing HTML5 playback and FFmpeg transcode paths remain available.
- MPV activation remains explicit through the local playback setting or `BAEFRAME_MPV_PILOT=1`.
- Missing or failed embedded mpv host must fall back without blocking file load.
- Audio mode stays on the existing HTML5/audio waveform path.
- The first embedded pass verifies playback inside the BAEFRAME window; overlay stacking limitations are tracked separately.

---

### Task 1: Embedded Host Window

**Files:**
- Create: `main/mpv-embed-host.js`
- Test: `scripts/tests/mpv-embed-host.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `nativeWindowHandleToMpvWid(buffer, platform)`, `normalizeEmbedBounds(bounds)`, `MPVEmbedHost.ensure(bounds)`, `MPVEmbedHost.updateBounds(bounds)`, `MPVEmbedHost.destroy()`
- Consumes: Electron `BrowserWindow`, `getMainWindow()`

- [x] Write failing tests for HWND conversion, content-area-relative bounds, and child window creation.
- [x] Run `node --test scripts/tests/mpv-embed-host.test.js` and confirm failure.
- [x] Implement `main/mpv-embed-host.js`.
- [x] Add the new test file to `npm run test:mpv`.
- [x] Run `npm run test:mpv` and confirm pass.

### Task 2: mpv `--wid` Launch

**Files:**
- Modify: `main/mpv-manager.js`
- Test: `scripts/tests/mpv-manager.test.js`

**Interfaces:**
- Consumes: `options.wid` from `mpvManager.load(filePath, options)`
- Produces: `createMpvLaunchArgs({ ipcPath, wid })` adding `--wid=<id>` and embedded-window flags

- [x] Write failing tests for launch args with `wid`.
- [x] Run `node --test scripts/tests/mpv-manager.test.js` and confirm failure.
- [x] Pass `options.wid` from `load()` into `start()`.
- [x] Restart mpv when the requested embedded `wid` changes.
- [x] Run `npm run test:mpv` and confirm pass.

### Task 3: IPC and Preload Bridge

**Files:**
- Modify: `main/ipc-handlers.js`
- Modify: `preload/preload.js`
- Test: `scripts/tests/mpv-runtime-source.test.js`

**Interfaces:**
- Produces: `window.electronAPI.mpvPrepareEmbed(bounds)`, `mpvUpdateEmbedBounds(bounds)`, `mpvDestroyEmbed()`
- Consumes: `mpvEmbedHost` from `main/mpv-embed-host.js`

- [x] Write failing source tests for the new IPC handlers and preload methods.
- [x] Run `node --test scripts/tests/mpv-runtime-source.test.js` and confirm failure.
- [x] Add the IPC handlers.
- [x] Add preload bridge methods.
- [x] Run `npm run test:mpv` and confirm pass.

### Task 4: Renderer Embedded Engine Path

**Files:**
- Modify: `renderer/scripts/app.js`
- Modify: `renderer/scripts/modules/video-player.js`
- Test: `scripts/tests/mpv-runtime-source.test.js`

**Interfaces:**
- Consumes: `window.electronAPI.mpvPrepareEmbed(bounds)` and `mpvUpdateEmbedBounds(bounds)`
- Produces: `getMpvEmbedBounds()`, `syncMpvEmbedBounds()`, embedded `mpvLoad(filePath, { wid })`

- [x] Write failing source tests for renderer bounds sync and `mpvLoad` with `wid`.
- [x] Run `node --test scripts/tests/mpv-runtime-source.test.js` and confirm failure.
- [x] Add video metadata dimensions to `VideoPlayer.useExternalEngine()`.
- [x] Prepare the mpv embed host before `mpvLoad()`.
- [x] Sync host bounds on wrapper resize/window resize.
- [x] Destroy the embed host when leaving mpv mode.
- [x] Run `npm run test:mpv` and confirm pass.

### Task 5: Runtime Verification

**Files:**
- No production file changes.

**Verification commands:**
- `npm run test:mpv`
- `npm run test:video-pan`
- `npm run test:playlist`
- `npm run build`
- `git diff --check`

- [x] Run tests and build fresh.
- [x] Launch a smoke test using bundled mpv and a sample video.
- [x] Confirm no orphan mpv process remains.
