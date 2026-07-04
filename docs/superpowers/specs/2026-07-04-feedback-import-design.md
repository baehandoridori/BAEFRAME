# Feedback Import Design

## Summary

BAEFRAME will let a user open one version, usually the newer video, and import comment feedback from another version in the same version list. The import copies comments, replies, and attached images from the source version into the currently open version.

The current version's existing comments are kept. Imported comments become new comments with new IDs so the source version and target version stay independent.

## Goals

- Import feedback from another detected or manually added video version.
- Copy comment markers, text, time ranges, positions, authors, colors, resolved state, replies, and attached images.
- Preserve existing comments in the currently open version.
- Save the imported comments into the current version's `.bframe`.
- Refresh the comment sidebar, video markers, and timeline comment ranges immediately after import.
- Keep the flow inside the existing version dropdown.

## Non-Goals

- Do not copy drawings.
- Do not copy highlights.
- Do not copy composition layers.
- Do not overwrite or delete existing target comments.
- Do not auto-import feedback during version switching.
- Do not create a new project-level feedback database.

## User Flow

1. User opens `v2`.
2. User opens the version dropdown.
3. User clicks the feedback import action on `v1`.
4. BAEFRAME confirms the number of comments that will be added.
5. BAEFRAME copies the feedback into `v2`, saves `v2.bframe`, and refreshes the UI.

The current version item does not show an import action because importing from itself would be confusing and useless.

## Data Behavior

Feedback is read from the source version's `.bframe` file. Source and target `.bframe` paths are derived with the same `getBframePath(videoPath)` logic already used by `ReviewDataManager`.

The import only reads `comments.layers[].markers[]`. Each copied marker receives:

- a new marker ID
- the target layer ID
- copied marker fields such as frame range, position, text, author, color, resolved state, timestamps, and image data
- copied replies with new reply IDs

Target comments remain unchanged. Imported comments are added to the active target comment layer. If no active layer exists, the default comment layer is used.

## Error Handling

- If no current video is open, show a warning.
- If the selected version has no file path, show a warning.
- If the source `.bframe` does not exist or has no comments, show a warning.
- If the user cancels the confirmation dialog, do nothing.
- If saving the target `.bframe` fails, keep the imported data in memory but show an error so the user knows save failed.

## UI

Each non-current version row in the version dropdown gets a small import button with tooltip text:

`이 버전의 피드백 가져오기`

The button is icon-only and sits next to the existing edit/delete controls. It stops row-click propagation so clicking it does not switch versions.

After a successful import, a toast reports the number of copied comments.

## Tests

- Unit tests cover cloning comments into target comments.
- Unit tests verify replies and attached images are preserved.
- Unit tests verify target comments are not removed.
- Unit tests verify copied marker and reply IDs are new.
- Source tests verify the version dropdown has an import action callback and the app wires it to source `.bframe` loading, target save, and UI refresh.
