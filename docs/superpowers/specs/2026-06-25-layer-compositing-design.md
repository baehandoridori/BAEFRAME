# Layer Compositing Design

## Summary

BAEFRAME will add a first-phase "레이어 합성" feature for quick in-app compositing review. Users can place image or video layers over the current base video, adjust position, size, time range, visibility, order, name, deletion, and opacity, then save and restore that setup in the existing `.bframe` file.

This phase is preview and review-editing only. Final composite video export is intentionally out of scope.

## Goals

- Add image and video overlay layers above the base video preview.
- Keep overlay videos muted in this phase.
- Save and restore composition layers in `.bframe`.
- Support direct manipulation on the video surface: select, move, resize.
- Support a compact layer panel: add, select, rename, enable/disable, delete, reorder, opacity.
- Show composition bars on the timeline with start/end drag and center drag for moving the whole range.
- Show temporal overflow when a layer extends beyond the base video duration without auto-clipping the saved data.
- Keep the first version small enough to test inside the app.

## Non-Goals

- Composite export/rendering.
- Real alpha-channel video interpretation or conversion.
- Overlay video audio, volume, or mixing.
- Transform keyframes.
- Rotation.
- Numeric position/size fields.
- Numeric start/end fields.
- Split/cut editing for layers.
- Lock, duplicate, alignment presets.
- Packaging/copying media into a sibling media folder for sharing.

## User Model

The feature is a temporary editing layer for the person reviewing in BAEFRAME. The `.bframe` stores references to original media file paths, not copied media files. This keeps the current project folder from filling with extra assets. Later, sharing can add a "collect media" or package flow.

## UI

- Header/control area gets a `레이어 합성` button.
- The panel is collapsed by default.
- Opening the panel shows a compact layer list.
- Each layer row includes:
  - editable name, defaulting to filename
  - visibility toggle
  - select state
  - delete button
  - opacity slider
  - drag handle for order
- Layer order is controlled by dragging rows in the panel.
- Clicking an overlay in the video selects the topmost visible layer at that point.
- Lower layers are selected from the panel.
- Resize handles are visible only for the selected layer.
- File add paths:
  - `+` button in the panel
  - drag/drop supported image/video file onto the video while a base video is already open

## Layer Defaults

### Image

- Starts at current playhead time.
- Duration is based on base video duration:
  - 10% of base duration
  - minimum 2 seconds
  - maximum 8 seconds
  - clipped only for default creation if the base video ends sooner

### Video

- Starts at current playhead time.
- Duration defaults to the source overlay video duration when metadata is available.
- If metadata cannot be read quickly, use a small fallback duration and let the user resize the bar.

### Transform

- Default position: centered.
- Default size: approximately half of the preview width.
- Coordinates and size are normalized to the displayed video/canvas area.
- Position and size are static over the whole layer.

## Time Range Behavior

- A layer may store `endTime` beyond the base video duration.
- Preview only appears while the base video is inside the layer range and within the base video duration.
- Timeline should keep the real overrun data and show an overflow badge/extension state, similar to editing tools that indicate media exceeds the current comp range.
- Timeline interaction:
  - drag left edge to change start
  - drag right edge to change end
  - drag center to move the whole layer range

## Data Format

Add optional top-level `.bframe` field:

```json
{
  "compositionLayers": [
    {
      "id": "composition_...",
      "name": "overlay.mov",
      "type": "video",
      "filePath": "C:/Project/overlay.mov",
      "enabled": true,
      "order": 0,
      "startTime": 1.25,
      "endTime": 6.25,
      "opacity": 1,
      "x": 0.25,
      "y": 0.25,
      "width": 0.5,
      "height": 0.5,
      "sourceDuration": 5
    }
  ]
}
```

Missing files are kept in data but marked in the UI as `파일 없음` and hidden in preview even if enabled.

## Technical Direction

BAEFRAME's mpv pilot uses a native child window, so ordinary renderer DOM cannot reliably appear above video. The implementation should reuse the existing mpv transparent overlay host. The renderer owns interaction and state, then mirrors layer preview state to the mpv overlay host.

The normal HTML5 video path can render directly in the renderer overlay. The mpv path should receive a serializable layer state in `mpvUpdateOverlayState`.

## Undo and Redo

This phase adds lightweight one-step undo/redo inside the layer compositing manager only. It covers:

- move
- resize
- time range edit
- enable/disable
- delete restore
- reorder
- opacity
- rename

It does not merge with the existing drawing undo stack in phase 1.

## Tests

- Unit tests for default durations, normalization, ordering, visible-layer filtering, and timeline drag math.
- Schema/validator tests for `compositionLayers`.
- Source tests that check app wiring:
  - manager import and construction
  - `.bframe` save/load inclusion
  - mpv overlay state includes composition layer state
  - UI elements exist
- Existing mpv tests should still pass.

## Later Plan

- Export final composite video.
- Real alpha-channel video handling.
- Overlay audio enable/volume/mixing.
- Media collection/package folder for sharing.
- Transform keyframes.
- Numeric inspector fields.
- Rotation and alignment tools.
- Lock/duplicate controls.
