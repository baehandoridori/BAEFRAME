import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCutlistCommentRanges,
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

test('extracts cutlist comments inside the source frame range into global timeline positions', () => {
  const ranges = extractCutlistCommentRanges({
    bframeData: {
      fps: 24,
      comments: {
        layers: [
          {
            id: 'layer-a',
            color: '#ffcc00',
            markers: [
              {
                id: 'before-cut',
                startFrame: 30,
                endFrame: 36,
                fps: 24,
                text: '이전 컷'
              },
              {
                id: 'inside-cut',
                startFrame: 50,
                endFrame: 74,
                fps: 24,
                text: '손 위치 확인',
                author: '성철',
                authorId: 'user-a',
                replies: [{ id: 'reply-1', text: '확인' }],
                resolved: false
              },
              {
                id: 'deleted-cut',
                startFrame: 55,
                endFrame: 60,
                deleted: true
              }
            ]
          }
        ]
      }
    },
    segment: {
      cutId: 'cut-a022',
      sourceId: 'source-a',
      label: 'a022',
      fileName: 'a020_a022.mp4',
      fps: 24,
      sourceStartFrame: 42,
      sourceEndFrame: 92,
      globalStartFrame: 120,
      globalStartTime: 5
    }
  });

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].markerId, 'inside-cut');
  assert.equal(ranges[0].cutLabel, 'a022');
  assert.equal(ranges[0].sourceStartFrame, 50);
  assert.equal(ranges[0].startFrame, 128);
  assert.equal(ranges[0].globalStartFrame, 128);
  assert.equal(ranges[0].localStartFrame, 8);
  assert.equal(ranges[0].globalStartTime, 5 + (8 / 24));
  assert.equal(ranges[0].globalStartTimecode, '00:00:05:08');
  assert.equal(ranges[0].author, '성철');
  assert.equal(ranges[0].authorId, 'user-a');
});

test('clips cutlist comments that partly overlap the selected cut', () => {
  const ranges = extractCutlistCommentRanges({
    bframeData: {
      comments: {
        layers: [
          {
            id: 'layer-a',
            markers: [
              {
                id: 'overlap-cut',
                startFrame: 38,
                endFrame: 45,
                fps: 24,
                text: '앞부분 겹침'
              }
            ]
          }
        ]
      }
    },
    segment: {
      cutId: 'cut-a022',
      sourceId: 'source-a',
      label: 'a022',
      fps: 24,
      sourceStartFrame: 42,
      sourceEndFrame: 92,
      globalStartFrame: 120,
      globalStartTime: 5
    }
  });

  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].sourceStartFrame, 42);
  assert.equal(ranges[0].sourceEndFrame, 45);
  assert.equal(ranges[0].startFrame, 120);
  assert.equal(ranges[0].endFrame, 123);
  assert.equal(ranges[0].localStartFrame, 0);
});
