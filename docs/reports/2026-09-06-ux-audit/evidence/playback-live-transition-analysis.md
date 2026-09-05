# Native playback transition follow-up

Current source: main / 2.9.0-beta / d72f6b7a87af9e5805eb03a0e0a6017bba999f32. Report date: 2026-09-06. Product code unchanged.

## Conclusion

**P1 UX issue: a healthy local video without a .bframe file repeatedly pays about 0.82 seconds to confirm that absence before the next clip starts playing.** This is part of the observed slow consecutive-playback experience, not an mpv decoder-only delay. Separately, the playlist selection, filename and time/frame labels update at different transition stages, briefly showing different clip identities together.

## What was observed versus measured

Root agent ran actual native mpv with three local H264 clips A/B/C, each 3 seconds at 24 fps, loop and autoplay enabled. `native-playback-autoplay.json` samples DOM labels at roughly 500 ms. Consecutive observed filename-change intervals are 4.144, 4.642, 4.160, 4.684 seconds (mean 4.4075 seconds). These are UI filename-change intervals, not measured first-frame presentation or audible gap duration. Sampling bounds precision by roughly one sampling period; arbitrary native composition/capture delays were not instrumented.

Current-source storage function was also executed directly against actual TEMP files, without mocked filesystem, timers or IPC:

| Read | Existing tiny JSON | Absent .bframe |
|---|---:|---:|
| 1 | 0.990 ms | 828.256 ms |
| 2 | 0.849 ms | 818.909 ms |
| 3 | 1.413 ms | 822.136 ms |

All absent reads returned data:null; present reads returned parsed data. Exit code 0. `playback-live-transition-probe.json` contains results and source observation extraction. This isolates an avoidable file-absence read cost; it does not quantify the entire video transition.

The root native app log independently contains repeated absent reads. Representative same-transition pairs:
- 17:42:17 B: mpv:load 135 ms, then file:load-review 826 ms / exists:false.
- 17:42:25 A: mpv:load 64 ms, then file:load-review 869 ms / exists:false.
- 17:42:30 B: mpv:load 72 ms, then file:load-review 870 ms / exists:false.
- 17:42:34 C: mpv:load 77 ms, then file:load-review 818 ms / exists:false.

At snapshot time 20 fixture review-load traces ranged 818–979 ms, median 863 ms. The 20 mpv-load traces included cold start (maximum 2792 ms), so the overall mpv range should not be presented as warm transition performance; its median was 75 ms. The excerpt is frozen in `playback-live-transition-log-excerpt.txt`.

## Cause 1: normal absence enters the retry schedule for transactional reads

- `main/review-file-store.js:30-37` defines delays `[0,25,50,100,200,400]` ms, totaling **775 ms of scheduled waiting**.
- `main/review-file-store.js:44-49` includes `ENOENT` (file absent) in transient read errors.
- `main/review-file-store.js:559-571` retries every delay before returning null for a file that stays absent. It does not distinguish a new review with no file from a transiently missing file during replacement/recovery.
- `main/review-file-store.js:2085-2125` first awaits pending writes and checks the recovery sidecar; even when no sidecar is found, it subsequently invokes that delayed read path.
- `main/ipc-handlers.js:582-597` awaits readReviewSnapshot before returning null for file:load-review.
- `renderer/scripts/modules/review-data-manager.js:1227-1229` awaits load; `1742-1769` awaits loadReview before deciding this is a new review.
- `renderer/scripts/app.js:10849-10859` awaits setVideoFile, then `10863-10871` waits for drawing readiness, then only at `10874-10876` calls playVideoAfterMediaLoad.
- The new mpv source was explicitly loaded paused (`renderer/scripts/app.js:10144-10152`; `main/mpv-manager.js:221-225`). Thus this review-file wait lies directly before actual play is requested, even though the new media and filename can already be visible.
- Each loop executes this load chain again. `setVideoFile` resets persistence/context observations (`review-data-manager.js:1197-1214`), and the load path does not reuse a known-absent result.

The exact 775 ms timer sum plus real timer scheduling/read overhead explains the isolated approximately 0.82-second reproduction and matches the approximately 0.82–0.98-second native IPC traces. Other costs still contribute to the total observed 4.14–4.68-second UI-label intervals.

## Cause 2: transition identities are published separately

The current ordering intentionally protects against wrongly mapping a new source's zero time to an old timeline segment, but leaves a brief mixed-label window:

1. `app.js:20305` selects the next playlist item before preparation/load. `selectPlaylistItemForContinuous` at `19927-19934` runs `onItemSelected`, whose suppression branch (`21198-21201`) immediately updates selection and position.
2. At `app.js:10144`, useExternalEngine installs the new media. `video-player.js:301-315` synchronously emits new loadedmetadata and timeupdate while `state.currentFile` is still the previous file.
3. `app.js:1658-1660` and `1692-1697` skip timecode/timeline updates when `shouldIgnoreContinuousTimelineUpdateDuringSourceLoad` (`19359-19367`) sees that currentFile differs from the loading item. This guard is useful and must remain conceptually intact.
4. `app.js:10764-10766` then sets currentFile and filename, but does not synchronously publish a matching timecode/frame/selection snapshot. Version scan and review loading follow. The next status/timeupdate (poll cadence at `video-player.js:943-945`; timeupdate emitted at `1186-1189`) normally reconciles the controls.

Actual DOM samples demonstrate the mixed state:
- at 1788630123941: filename A, controls A end 02:23 / Frame 71, playlist position already 2/3.
- at 1788630128600: filename C, controls still whole 05:23 / local 02:23 / Frame 71 (previous B end).
- at 1788630137402: filename B, controls still whole 02:23 / local 02:23 / Frame 71 (previous A end).

This proves temporary UI identity inconsistency in sampled labels. It does not prove which native video frame was presented at those exact instants, nor a corrupted stored comment/frame association.

## Improvement proposal and acceptance criteria

A. Separate normal new-review absence from transaction/recovery uncertainty. Keep delayed verification for an active write/recovery sidecar and transient access errors; permit a fast known-new/no-transaction path and maintain background discovery for a file appearing later. The existing `startDeferredReviewFileDiscovery` (`app.js:7332-7355`) already watches and polls a not-yet-created .bframe after load. Do not globally delete ENOENT retries: `readTextOrNullWithRetry` is also used in sidecar publication/recovery and its safety requirements must remain.

B. Move optional preparation earlier in the next-item preparation stage where possible; keep mandatory review readiness and input ownership coherent. Use explicit transitions (`B 준비 중` -> `B 리뷰 준비됨`) and publish active filename, playlist position, local/global time and frame number together at the media-context boundary. Preserve previous-frame continuity and the stale-source guard. Distinguish the selected next item from the currently displayed/playing item while loading.

Acceptance:
- With A/B/C local 3-second clips and no .bframe, repeated loops no longer incur an intentional 775 ms absence-read wait. Add a meaningful latency regression check for this storage case, with generous environment-aware budget (for example median under 100 ms on the same local test setup), and retain recovery concurrency tests.
- A .bframe created by another instance after an initially absent read is discovered; local edits and latest external data merge safely. Active sidecar/atomic-replace recovery remains correct.
- For source change or loop wrap, no committed UI snapshot combines B/C filename with previous clip's frame/timecode; a pending selection may appear only with an explicit loading state.
- Record separate timestamps for previous ended, next selected, mpv load complete, review data ready, play command acknowledged and first frame presented; use these to measure the remaining real transition delay rather than substituting DOM filename sampling.

## Evidence files
- `native-playback-autoplay.json`: root actual native app DOM sampling.
- `playback-live-transition-probe.cjs` / `.json`: this subagent's actual storage read comparison and observation extraction.
- `playback-live-transition-log-excerpt.txt`: frozen root app IPC result lines.

The current script only writes uniquely named TEMP test fixtures; no production source or review data was changed.
