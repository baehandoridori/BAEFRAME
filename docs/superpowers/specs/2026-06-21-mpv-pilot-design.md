# MPV Pilot Design

## Goal

BAEFRAME can try direct mpv playback without removing the current HTML5 video and FFmpeg fallback path.

## User-Facing Behavior

- Normal app launches behave exactly as before.
- MPV pilot mode only activates when the local app setting is enabled or `BAEFRAME_MPV_PILOT=1` is set, and an `mpv` executable is available.
- If mpv is missing or the pilot fails, the app keeps the existing HTML5 and FFmpeg path.
- The first pilot renders through a separate mpv player window controlled by BAEFRAME. Full in-view embedding is a later phase.
- The app settings screen exposes the pilot as a local playback option so users do not need PowerShell environment variables for normal testing.

## Architecture

- Add `main/mpv-manager.js` as the only module that knows how to find, start, command, and stop mpv.
- Expose a small `mpv:*` IPC API through `main/ipc-handlers.js` and `preload/preload.js`.
- Extend `VideoPlayer` with an external-engine mode so existing playback controls can delegate to mpv while keeping BAEFRAME's current time, frame, and event flow.
- In `loadVideo()`, check MPV pilot eligibility before FFmpeg transcode. When eligible, skip transcode and load the original media through mpv.
- Keep mpv availability detection independent from activation so the settings UI can report whether a bundled or system mpv exists.

## Constraints

- Do not make mpv mandatory.
- Do not delete or weaken the current FFmpeg path.
- Do not affect audio mode or split view.
- Keep all new runtime behavior behind an explicit local setting or `BAEFRAME_MPV_PILOT=1`.
- Keep this as a reversible pilot, not a full player rewrite.

## Verification

- Unit test mpv path detection and launch arguments.
- Source-level test the renderer opt-in path, app settings toggle, IPC registration, preload exposure, and external-engine support.
- Run existing playlist/video-adjacent tests to ensure the fallback path remains intact.
- Verify local packaging includes `mpv/win32/mpv.exe` when the ignored mpv binary folder is present.
