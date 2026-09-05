# Additional recent-file thumbnail finding

Source: main 2.9.0-beta, d72f6b7a87af9e5805eb03a0e0a6017bba999f32, 2026-09-06. Root agent observed RecentThumbCapture spawn ffmpeg ENOENT during native test.

## Two independent causes
1. `main/recent-thumb-capture.js:42-51` checks existing ffmpegManager.isAvailable() synchronously without initializing it, then returns bare `ffmpeg`. `main/ffmpeg-manager.js:37-43` starts uninitialized with null paths; `isAvailable` at 1249-1250 requires initialization. `main/ipc-handlers.js:2890-2899` recent capture does not initialize the manager either. Default mpv load skips FFmpeg availability path at `renderer/scripts/app.js:10364`. Therefore a bundled binary can exist while this feature wrongly depends on PATH. Inference about root ENOENT cause is strongly supported by these paths; this subagent did not inspect root process memory.
2. Even when binary is explicitly resolved, `main/recent-thumb-capture.js:68-79` names output `<id>.jpg.tmp` and supplies no `-f image2`/equivalent output format. FFmpeg cannot infer a JPEG container from `.tmp`. Reproduced with the current bundled `ffmpeg/win32/ffmpeg.exe` and root's generated A H264 fixture; exact capture args failed exit -22 and output absent. Adding only `-f image2` in the control run produced output, exit 0. This is actual FFmpeg execution, not a mock.

## User impact and recommendation
P2 confirmed thumbnail failure: recent video cards may remain blank despite a usable bundled FFmpeg, making file recognition harder. Resolve the bundled binary through initialized/shared locator; retain an image-recognizable temp suffix or specify output format; preserve atomic rename. Add a real one-frame capture check that verifies a JPEG exists and can decode, not just source text presence.
Acceptance: in a fresh profile with no system ffmpeg on PATH, open A and see generated recent thumbnail; same works after unrelated FFmpeg initialization; temp capture writes valid JPEG and rename succeeds; failed source still falls back without blocking app.

Evidence logs: playback-recent-thumb.log (exact existing args, failure); playback-recent-thumb-control.log (format-specified control, success). Probe images stayed in TEMP. No product code changed.
