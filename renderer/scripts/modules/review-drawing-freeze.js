import { Path, StaticCanvas } from 'fabric';
import { normalizeDrawingLayers, isObjectVisible, layerIdForObject } from '../../../shared/drawing-layers.js';

// 댓글 입력 중 가려지는 구형 그림과 네이티브 Fabric 표면을 정지 프레임에 합성한다.
// 원본 V3 기록을 수정하거나 별도의 드로잉/재생 엔진을 만들지 않는다.
export async function composite(baseDataUrl, keyframe, drawingLayers, legacyDataUrl = '') {
  if (!keyframe?.objects?.length && !legacyDataUrl) return baseDataUrl;
  const layers = normalizeDrawingLayers(drawingLayers);
  const ranks = new Map(layers.layers.map((layer, index) => [layer.id, layers.layers.length - index - 1]));
  const records = (keyframe?.objects || []).filter(record => isObjectVisible(layers, record.id))
    .sort((a, b) => (ranks.get(layerIdForObject(layers, a.id)) ?? 0) - (ranks.get(layerIdForObject(layers, b.id)) ?? 0));
  if (!records.length && !legacyDataUrl) return baseDataUrl;

  const background = new Image();
  background.src = baseDataUrl;
  await background.decode();
  const width = background.naturalWidth;
  const height = background.naturalHeight;
  const legacy = legacyDataUrl ? new Image() : null;
  if (legacy) {
    legacy.src = legacyDataUrl;
    await legacy.decode();
  }
  const canvas = records.length ? new StaticCanvas(document.createElement('canvas'), {
    width, height, enableRetinaScaling: false, renderOnAddRemove: false
  }) : null;
  try {
    // 원본 V3 좌표와 네이티브 스크린샷 해상도가 다를 때에도 같은 영상 위치를 유지한다.
    if (canvas) canvas.setViewportTransform([width / keyframe.sourceWidth, 0, 0, height / keyframe.sourceHeight, 0, 0]);
    for (const record of records) {
      // 편집기 MP4 내보내기와 동일한 canonical Path/transform 렌더링 규칙.
      const drawing = new Path(record.renderGeometry?.pathData || record.pathData, {
        fill: record.style.color, fillRule: record.renderGeometry?.fillRule || 'nonzero',
        opacity: record.style.opacity, stroke: null, strokeWidth: 0
      });
      drawing.set(record.transform);
      canvas.add(drawing);
    }
    canvas?.renderAll();
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d');
    context.drawImage(background, 0, 0);
    // 래스터는 영상 원본 크기이며 화면의 zoom/pan 변환은 정지 프레임 전체에 한 번 적용된다.
    if (legacy) context.drawImage(legacy, 0, 0, width, height);
    if (canvas) context.drawImage(canvas.lowerCanvasEl, 0, 0);
    return output.toDataURL('image/png');
  } finally {
    await canvas?.dispose();
  }
}

window.BAEReviewDrawingFreeze = Object.freeze({ composite });
