# Feedback Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a version-dropdown action that imports comments, replies, and attached images from another video version into the currently open version.

**Architecture:** Put copy rules in a small pure module so behavior is tested without Electron. Keep the version dropdown responsible only for rendering the import button and emitting the selected source version. Keep `renderer/scripts/app.js` responsible for reading the source `.bframe`, applying the import to the current `CommentManager`, saving through `ReviewDataManager`, and refreshing the visible UI.

**Tech Stack:** Electron renderer JavaScript modules, existing `.bframe` persistence, Node built-in `node:test`, source-level tests.

---

### Task 1: Add Failing Tests For Feedback Import Core

**Files:**
- Create: `scripts/tests/feedback-import.test.js`
- Create: `renderer/scripts/modules/feedback-import.js`

- [ ] **Step 1: Write the failing behavior tests**

Add tests that import from `renderer/scripts/modules/feedback-import.js` and call:

```js
import {
  cloneFeedbackMarkers,
  countImportableFeedbackMarkers,
  importFeedbackIntoTargetComments
} from '../../renderer/scripts/modules/feedback-import.js';
```

The tests must cover:

```js
test('imports source markers into target comments without removing target markers', () => {});
test('copies replies and attached images while assigning new IDs', () => {});
test('returns zero importable markers for empty or missing comment layers', () => {});
```

- [ ] **Step 2: Run the new test and verify red**

Run:

```bash
node --test scripts/tests/feedback-import.test.js
```

Expected: FAIL because `renderer/scripts/modules/feedback-import.js` does not exist yet.

### Task 2: Implement The Pure Import Module

**Files:**
- Create: `renderer/scripts/modules/feedback-import.js`
- Modify: `scripts/tests/feedback-import.test.js`

- [ ] **Step 1: Implement `countImportableFeedbackMarkers(sourceComments)`**

Count non-deleted markers from `sourceComments.layers`.

- [ ] **Step 2: Implement `cloneFeedbackMarkers(sourceComments, options)`**

Return cloned marker records with:

```js
id: options.createId('marker')
layerId: options.targetLayerId
replies: source replies with options.createId('reply')
```

Copy marker position, frame range, text, author, image fields, color, resolved metadata, and timestamps.

- [ ] **Step 3: Implement `importFeedbackIntoTargetComments(targetComments, sourceComments, options)`**

Return:

```js
{
  comments,
  importedCount,
  importedMarkers
}
```

Append cloned markers to the target layer. Preserve all existing target layers and markers.

- [ ] **Step 4: Run the new unit test and verify green**

Run:

```bash
node --test scripts/tests/feedback-import.test.js
```

Expected: PASS.

### Task 3: Wire The Version Dropdown Import Action

**Files:**
- Modify: `renderer/scripts/modules/version-dropdown.js`
- Modify: `renderer/styles/main.css`
- Modify: `renderer/index.html`

- [ ] **Step 1: Add an import callback API**

Add:

```js
onFeedbackImport(callback) {
  this._onFeedbackImport = callback;
}
```

- [ ] **Step 2: Render the import button for non-current version rows**

Add an icon-only row action with title:

```text
이 버전의 피드백 가져오기
```

The click handler must call `this._onFeedbackImport(versionInfo)` and stop propagation.

- [ ] **Step 3: Add focused CSS**

Add `.version-item-import-feedback` styles next to existing version row action button styles.

### Task 4: Apply Imported Feedback In The App

**Files:**
- Modify: `renderer/scripts/app.js`

- [ ] **Step 1: Import helpers**

Add:

```js
import { countImportableFeedbackMarkers, importFeedbackIntoTargetComments } from './modules/feedback-import.js';
import { getBframePath } from './modules/review-data-manager.js';
```

Use the existing `ReviewDataManager` import if `getBframePath` is already imported from the same module.

- [ ] **Step 2: Add `handleImportFeedbackFromVersion(versionInfo)`**

The handler must:

```js
const sourceBframePath = getBframePath(versionInfo.path);
const sourceData = await window.electronAPI.loadReview(sourceBframePath);
const sourceCount = countImportableFeedbackMarkers(sourceData?.comments);
```

Warn if source count is zero. Confirm before import. Apply the import to `commentManager.toJSON()`, call `commentManager.fromJSON(result.comments)`, save with `reviewDataManager.save()`, then refresh comment list, timeline markers, video markers, and comment ranges.

- [ ] **Step 3: Register the dropdown callback**

After `versionDropdown.setReviewDataManager(reviewDataManager)`, call:

```js
versionDropdown.onFeedbackImport(handleImportFeedbackFromVersion);
```

### Task 5: Add Source Tests For UI Wiring

**Files:**
- Create: `scripts/tests/feedback-import-source.test.js`

- [ ] **Step 1: Assert source wiring**

Check that:

```js
renderer/scripts/modules/version-dropdown.js
```

contains `onFeedbackImport`, `version-item-import-feedback`, and the Korean tooltip.

Check that:

```js
renderer/scripts/app.js
```

imports `feedback-import.js`, defines `handleImportFeedbackFromVersion`, calls `window.electronAPI.loadReview(sourceBframePath)`, calls `reviewDataManager.save()`, and registers `versionDropdown.onFeedbackImport(handleImportFeedbackFromVersion)`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test scripts/tests/feedback-import.test.js scripts/tests/feedback-import-source.test.js
```

Expected: PASS.

### Task 6: Verify, Review, And Release

**Files:**
- All touched files

- [ ] **Step 1: Run focused tests**

```bash
node --test scripts/tests/feedback-import.test.js scripts/tests/feedback-import-source.test.js
```

- [ ] **Step 2: Run related comment and playlist tests**

```bash
npm run test:comment-input
npm run test:playlist-comments
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

- [ ] **Step 4: Self-review the diff**

Review for duplicate import bugs, self-import bugs, accidental drawing/highlight copy, save failures, and UI event propagation mistakes.

- [ ] **Step 5: Re-run focused tests after review fixes**

```bash
node --test scripts/tests/feedback-import.test.js scripts/tests/feedback-import-source.test.js
```

- [ ] **Step 6: Commit, push, prepare PR, run review loop, merge, rebuild, and deploy**

Follow the BAEFRAME release deploy workflow:

```bash
git add docs/superpowers/specs/2026-07-04-feedback-import-design.md docs/superpowers/plans/2026-07-04-feedback-import.md renderer/scripts/modules/feedback-import.js renderer/scripts/modules/version-dropdown.js renderer/scripts/app.js renderer/styles/main.css scripts/tests/feedback-import.test.js scripts/tests/feedback-import-source.test.js
git commit -m "피드백 버전 이식 기능 추가"
git push -u origin codex/baeframe-feedback-import
```

Then create PR, run Codex review loop, merge, build, copy `dist\win-unpacked` to the shared-drive beta folder, and verify hashes.
