# BAEFRAME playback/mpv UX audit

Audit date 2026-09-06. Source checkout main, package 2.9.0-beta, commit d72f6b7a87af9e5805eb03a0e0a6017bba999f32. Initial/final git status clean. No product files changed.

## Verification
- npm.cmd run test:playlist: exit 0, pass 330, fail 0, cancelled 0, skipped 0, 5153.6166 ms. Log: baeframe-ux-20260906-playback-playlist.log in TEMP.
- npm.cmd run test:mpv: exit 0, pass 353, fail 0, cancelled 0, skipped 0, 25730.1708 ms. Log: baeframe-ux-20260906-playback-mpv.log in TEMP.
- node TEMP/baeframe-ux-20260906-playback-probes.cjs: exit 0. Two current-source function-level reproductions below. Dependencies were mocked. This is not a Windows/mpv GUI or actual-media reproduction.
- test:playlist mixes source assertions, actual core module behavior, extracted production-function harnesses, fake media/events/timers, and an isolated filesystem probe child process. Its continuous runtime suite includes three loops of eight short items, duplicate EOF, Space, stale intent, hard deadline, and rejection cases (scripts/tests/playlist-continuous-runtime.test.js:2654,2677,2923,2944,3046).
- test:mpv mixes source assertions, managers with mocked processes/IPC, fake Electron windows, lifecycle/visibility policy behavior, and renderer clock tests. It does not prove native window composition, actual codec frame timing, mouse/pen input, or audible seamless transition. mpv-manager.test.js:18-47 and mpv-embed-host.test.js:38-77 expose mocks. mpv-recovery-source.test.js has both regex/source tests and function-level behavior tests.

## Findings, ordered

### P1 / function-level reproduction: late hybrid review entry can override a newer file/mode
User impact: opening comment mode then promptly selecting another video or leaving comment mode can still initiate an engine swap after that newer action; interruption, unnecessary reload, and wrong review context are plausible. No real-app data-loss claim.
Evidence: app.js:8564-8580 checks busy/settings/mpv before awaiting codec probe, then reads mutable state.currentFile after await with no source identity or current-mode guard. loadVideo creates fresh intent/load tokens at app.js:10253-10274 even for engineSwap, so late swap can supersede the active ordinary file load. The engineSwap path deliberately skips review save/reset/load at 10404-10406 and 10846-10859, making its same-file assumption important. Comment caller checks mode only after swap completion (2538-2547).
Reproduction: extracted current enterHybridReviewEngineIfPossible; start probe for A.mp4; before resolution set currentFile=B.mov and comment mode=false; resolve A as supported. Observed loadVideoWithHtml5Fallback(B.mov,{engineSwap:true,initialFrame:42,playWhenMediaReady:false}). Probe log recorded A inspected, B loaded, mode false.
Improve: capture file, mode generation, and load generation before await; acquire swap ownership before probing; validate after each await and immediately before load; pass the owner continuation into swap. Same-file engine swap must verify current review/media identity.
Acceptance: A slow probe, A->B selection, comment off/on, and duplicate entry never produce a stale engine reload, cancel B loading, enable stale comment input, or retain A review data under B.

### P1 / function-level reproduction: pausing during last watchdog retry reports the video as broken/skipped
User impact: a user-initiated stop can label a healthy review clip '건너뜀' and show '영상을 재생할 수 없어 다음 영상으로 넘어갑니다.' This makes review completion ambiguous and can exclude the item from subsequent automatic navigation until reset.
Evidence: app.js:20191-20198 awaits last 3000 ms advancement check, but unlike first check (20171-20173) does not validate session afterward before ERROR/skip/toast. waitForContinuousPlaybackAdvance returns false when session is inactive (20129-20134). findNextPlayableIndex excludes ERROR/SKIPPED (playlist-continuous-core.js:57-74). Explicit item selection clears error/skip (app.js:21207-21211); restarting a session quick-check also rechecks statuses, so not a permanent inaccessible file.
Reproduction: extracted actual watchdog; first advancement=false, retry play=true, stop session while second advancement resolves false. Observed ERROR mutation, skipped batch insertion, and failure toast despite active=false. TEMP probe log.
Improve: session/item/load identity check after final await and before any status mutation or toast; distinguish cancelled from failed.
Acceptance: Space pause, new playlist/file selection, and mode exit during all retry stages do not mark ERROR/SKIPPED or emit playback-failure notices; actual stationary media still follows failure policy.

### P1 / code-confirmed UX regression: default mpv playback removes multiple visual navigation aids
User impact: locating scenes and recognizing which image a comment refers to relies more on timecodes/text. Timeline hover preview, scrub preview, and generated comment frame thumbnails are absent on mpv direct playback.
Evidence: app.js:10219-10224 resolveMpvThumbnailVideoPath always returns null; 10822-10835 skips generation and clears generator. thumbnail-generator.js:501-522 clear resets readiness. timeline.js:3407, app.js:11247, and app.js:13494 all gate respective previews on ready. Playlist card thumbnails and user-attached comment images are separate and are not claimed missing. Hybrid swap uses engineSwap and skips thumbnail regeneration, so simply entering comment mode does not refill them.
Improve: background frame cache independent of playback engine, low-priority sampling and exact comment frame captures; expose thumbnail preparation without blocking playback.
Acceptance: same source gets timeline hover/scrub preview and exact-frame comment thumbnail under mpv and HTML5; cache generation cannot seek or pause the playing mpv instance; fast switching never displays old-file previews.

### P2 / confirmed policy, usability recommendation: slow preparation and actual failure collapse to 'skipped'
User impact: reviews may skip a clip merely because preparation takes more than 5 seconds, with little distinction between waiting for a drive, codec preparation, missing source, and decode failure. Reviewers need to know what was not reviewed.
Evidence: app.js:19912-19924 races preparation against 5000 ms then unconditionally SKIPPED/'건너뜀'; 19808-19812 prevents a late prepare completing once skipped; 19863/19867 store generic error label. core.js:84-88 skipped toast contains only file/count. Actual direct mpv prep is lighter, so strongest reproduction applies to fallback/transcode or delayed IPC/network state, not all clips.
Improve: separate preparing, unavailable, cancelled, retryable failure, intentionally skipped states. Offer 'wait/retry/skip' from persistent transition status and an end-of-review list of unreviewed clips, with reason retained.
Acceptance: injected 6-second preparation does not silently count as review completion; file/timeout/codec failures remain distinguishable; retry action does not require finding and clicking the same item again.

### P2 / code-supported risk: timeline preparation can omit an unknown-duration source without making it obvious
User impact: a list can contain a real video whose duration probe failed, while the concatenated timeline allocates it zero width and omits its temporal footprint. Review comments for that source are hard to locate and perceived total duration can be wrong.
Evidence: app.js:19646-19669 mpv metadata failure logs and does not try FFmpeg fallback when mpv path selected; 19696-19703 emits duration 0. playlist-continuous-core.js:18-33 converts invalid/unknown duration to 0 and builds zero-length segment. updatePlaylistContinuousTimeline app.js:19715 onward serially gathers metadata before rendering segments and then loads reviews; final UI summary reports ready-item counts, not failed duration probes.
Improve: show unknown-duration/missing-metadata items explicitly, retain an error badge and retry, use bounded alternate metadata discovery independent of decoder. Do not present total duration as complete until all items resolved or excluded by user.
Acceptance: force one probe failure in A/B/C list; B stays visibly represented with '길이 확인 필요', totals show uncertainty, retry restores segment/comment placement; no misleading complete timeline.

### P2 / policy + integration verification needed: recovery restores the frame but ends continuous playback
User impact: mpv hang recovery reloads current video paused. The user should understand whether the playlist session stopped and how to resume; warnings describe technical engine changes rather than review-session outcome.
Evidence: video-player.js:1026-1041 escalates 3 consecutive polling failures; app.js:1904-1944 recovers unexpected stop, first with mpv then fallback, sets playWhenMediaReady:false; default loadVideo at 10257-10263 stops continuous session. COMMAND_TIMEOUT_MS=5000 and status pending serialization mean a fully unresponsive IPC can require about 15 seconds plus stop timeout before recovery; this is derived upper-path behavior, not measured latency. One overlay-host rebuild with ownership guards exists at app.js:8699-8769, and fallback preserves frame/play intent at 8619-8638, so host recovery and process recovery differ.
Improve: persistent, plain-language state ('현재 영상 복구 중' -> '복구됨 · 재생을 계속하려면 Space'), safe retry/resume controls, and consistent playlist intent policy. Keep frame identity and unsaved review protection central.
Acceptance: simulated IPC hang/stop restores exact paused frame and attached review context; user sees session state immediately, no accidental repeated retries, one Space resumes intended item/order, no auto-skip due to recovery.

## Existing protections to credit
- Single transition flight, intent/session/load tokens, and pendingAdvance coalesce duplicate EOF (app.js:19493-19537).
- 20-second transition deadline terminates stalled loading and explicitly tells users Space resumes (app.js:19997-20014).
- End-near checks and accepted polling time, rather than interpolated visual clock, protect short media and watchdog progress (app.js:20016-20055).
- One-Space stalled-session resume and double-trigger guard (app.js:19291-19318).
- Global drawing persistence failure stops the session once rather than marking every clip faulty (app.js:19958-19974).
- Native mpv holds prior final frame with --keep-open=yes/loadfile replace (main/mpv-manager.js:98,216; app.js:10351-10355).
- Native surface registry distinguishes blocking interactions/mirrors, overlap is geometrically checked, and stale host recovery owners are guarded (mpv-surface-policy.js:12-74,182-204; app.js:8700+). This architecture is necessary because DOM z-index alone cannot cover an HWND. Actual click/focus/DPI/multi-monitor/fullscreen transitions still require native GUI validation.

## Native test matrix proposed (not executed by this subagent)
A/B/C local plus delayed share-drive clips; 0.2 s/3 s/long clips; repeated EOF; Space at media end and in 1.5/3 s retries; click B then C during save/metadata load; comment mode then other video during codec probe; current file contains comments/drawings; incompatible codec fallback; forced mpv exit/hang; fullscreen/DPI/dual-monitor; popup over video; verify picture/timecode/playlist highlight/comment/drawing identity stay coherent.

## Memory used only to locate earlier stabilization boundaries
MEMORY.md:133-139 (current code reverified); corresponding rollout id 01a02fb4-af65-7cf2-812f-487595dc4223. Past test counts/deployment status were not reused.
