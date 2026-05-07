# Playlist Continuous Mode Handoff

Date: 2026-05-08
Branch: `codex/playlist-continuous-mode-design`
Latest implementation commit: `66e8af9`

## User Goal

Upgrade BAEFRAME playlist UX:

- keep playlist ordering stable
- add `이어보기` mode so playlist videos can play as one continuous flow
- skip missing/unplayable items with toast notifications
- prepare videos needing conversion in the background
- show unified playlist timeline/comment context in `이어보기`
- fix stacked toast behavior
- keep the existing visual tone

## Implemented

- Playlist ordering helpers and persisted continuous settings:
  - natural filename sorting (`shot1`, `shot2`, `shot10`)
  - added-date and modified-date sorting
  - manual drag order wins, with new items appended behind manual order
  - current selected item is preserved after sort/add/reorder

- Playlist UI:
  - `리뷰` / `이어보기` tabs
  - sort selector
  - loop toggle
  - preparation summary and item status text

- Continuous playback runtime:
  - starts from selected item, or first item if none is selected
  - quick file existence preflight
  - background preparation/transcode via existing FFmpeg APIs
  - waits up to 5 seconds when the next item is not ready
  - skips missing/error/unready videos
  - grouped skipped-video toast
  - completion toast
  - loop mode, including one-playable-item replay
  - async session guards so old waits/prep cannot resume after stop/restart
  - load failure is treated as skip instead of replaying the previous video

- Unified continuous timeline:
  - segment boundaries for playlist videos
  - unloaded video duration/fps collection through `ffmpegProbeCodec`
  - aggregate read-only comment bars from all playlist videos
  - author and resolved/unresolved filters update aggregate bars
  - aggregate comment click loads source video, seeks, pauses, and highlights the existing comment
  - stale async timeline render guard

- Toast stack:
  - newest toast remains on top
  - dismissed toasts do not jump forward while disappearing
  - hover pauses auto-dismiss timers
  - hover expansion is scroll-contained
  - loading-toast updates respect hover pause

## Verification Completed

- `npm run test:playlist`
  - PASS: 47/47
  - note: Node prints existing `MODULE_TYPELESS_PACKAGE_JSON` warnings for ES module test imports.

- `npm run test:toast-stack`
  - PASS: 8/8

- `npm run test:cluster`
  - PASS: 29/29

- `git diff --check`
  - PASS

- Touched-file lint check:
  - `npx eslint --rule "linebreak-style: off" --quiet ...`
  - PASS: no errors in touched JS/test files.

- Full `npm run lint`
  - FAILS because the repo currently has many existing CRLF `linebreak-style` errors.
  - This is not isolated to the playlist/toast change.

- `npm run dev` smoke test
  - Electron app started in development mode.
  - Logs showed app ready and main window displayed.
  - No startup crash was observed.

## Manual QA Still Needed

This workspace did not include a prepared set of local videos and `.bframe` files, so full hands-on media QA still needs to be done.

Use a small fixture set:

- `shot1.mp4`
- `shot2.mp4`
- `shot10.mp4`
- optional `shot3.mp4`, `shot11.mp4`
- one intentionally missing playlist item
- one unsupported-codec file that requires conversion, if available
- at least two `.bframe` files with comments from different authors and resolved/unresolved states

Checklist:

- files appear as `shot1`, `shot2`, `shot10`
- dragging `shot2` above `shot1` marks manual order
- after manual order, adding `shot3` and `shot11` appends them as `shot3`, `shot11`
- filename, added-date, and modified-date sorting only apply when selected
- sorting during `이어보기` does not reload the current video
- `이어보기` starts from the selected item
- already-loaded selected item starts from current player position
- missing later item is marked and skipped
- multiple skipped items produce one grouped toast
- last item stops with `재생목록 재생 완료`
- loop toggle loops from last playable item to first playable item
- conversion-needed item shows `준비 중`, waits up to 5 seconds on turn, then plays or skips
- `이어보기` tab shows segment boundaries
- segment hover title shows filename/time
- aggregate comment bars from multiple videos appear
- comment filters affect aggregate bars
- clicking an aggregate comment from another video loads it, seeks, pauses, and highlights the comment
- existing comment drag/resize editing still works in `리뷰` mode
- 6 rapid toasts stack without jumping or overflowing
- hovering toast area pauses auto-dismiss
- expanded toast stack scrolls inside the window

## Known Follow-Ups

- Clip trimming in continuous mode is intentionally out of scope for this version.
- Direct editing of aggregate comments on the unified timeline is intentionally out of scope.
- Temporary include/exclude playlist items is intentionally out of scope.
- Runtime integration tests are partly structural because the renderer is not currently easy to drive headlessly.
- The repo-wide CRLF lint issue should be fixed separately from this feature branch.
