import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCutlistCommentLabel,
  formatCutlistCommentPanelLine,
  formatCutlistTimecode
} from '../../renderer/scripts/modules/cutlist-comment-index.js';

test('formats cutlist timecode with frame precision', () => {
  assert.equal(formatCutlistTimecode(0, 24), '00:00:00:00');
  assert.equal(formatCutlistTimecode(1.5, 24), '00:00:01:12');
  assert.equal(formatCutlistTimecode(3661 + (7 / 24), 24), '01:01:01:07');
});

test('formats cutlist comment labels with cut, local, and global time', () => {
  assert.equal(
    formatCutlistCommentLabel({
      cutLabel: 'a020',
      localStartTime: 0.5,
      globalStartTime: 12.25,
      fps: 24
    }),
    'a020 00:00:00:12 / 전체 00:00:12:06'
  );
});

test('formats cutlist comment panel line with text fallback', () => {
  assert.equal(
    formatCutlistCommentPanelLine({
      cutLabel: 'a021',
      localStartTime: 2,
      globalStartTime: 32,
      fps: 24,
      text: '손 위치 확인'
    }),
    'a021 00:00:02:00 / 전체 00:00:32:00 - 손 위치 확인'
  );

  assert.equal(
    formatCutlistCommentPanelLine({
      cutLabel: 'a022',
      localStartTime: 0,
      globalStartTime: 40,
      fps: 24
    }),
    'a022 00:00:00:00 / 전체 00:00:40:00 - 댓글'
  );
});
