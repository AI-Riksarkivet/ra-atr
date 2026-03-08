import type { BBox } from './types';

export interface Detection extends BBox {
  classId: number;
}

/**
 * Parse YOLO output tensor and apply NMS.
 *
 * Output shape: [1, 4+C(+32), N] where N=8400 for YOLOv9.
 * For seg models: 4 box + 1 class + 32 mask = 37 features.
 * For det models: 4 box + C classes.
 */
export function parseYoloOutput(
  outputData: Float32Array,
  outputDims: readonly number[],
  origW: number,
  origH: number,
  scale: number,
  padX: number,
  padY: number,
  confThreshold: number,
  iouThreshold: number,
): Detection[] {
  const numFeatures = outputDims[1];
  const numDetections = outputDims[2];

  // Determine number of classes
  const numClasses = numFeatures > 36
    ? numFeatures - 4 - 32  // seg model: subtract box + mask coefficients
    : numFeatures - 4;       // pure det model

  const detections: Detection[] = [];

  for (let j = 0; j < numDetections; j++) {
    // Output is [1, features, detections] in row-major
    const idx = (f: number) => f * numDetections + j;

    const cxVal = outputData[idx(0)];
    const cyVal = outputData[idx(1)];
    const w = outputData[idx(2)];
    const h = outputData[idx(3)];

    // Find best class
    let bestClass = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const score = outputData[idx(4 + c)];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }

    if (bestScore < confThreshold) continue;

    // Convert from padded 640x640 to original image coords
    const x = ((cxVal - w / 2) - padX) / scale;
    const y = ((cyVal - h / 2) - padY) / scale;
    const bw = w / scale;
    const bh = h / scale;

    detections.push({
      x: Math.max(0, Math.min(x, origW)),
      y: Math.max(0, Math.min(y, origH)),
      w: Math.min(bw, origW - x),
      h: Math.min(bh, origH - y),
      confidence: bestScore,
      classId: bestClass,
    });
  }

  nms(detections, iouThreshold);
  return detections;
}

function nms(detections: Detection[], iouThreshold: number): void {
  detections.sort((a, b) => b.confidence - a.confidence);
  const keep = new Array(detections.length).fill(true);

  for (let i = 0; i < detections.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < detections.length; j++) {
      if (!keep[j]) continue;
      if (iou(detections[i], detections[j]) > iouThreshold) {
        keep[j] = false;
      }
    }
  }

  let writeIdx = 0;
  for (let i = 0; i < detections.length; i++) {
    if (keep[i]) {
      detections[writeIdx++] = detections[i];
    }
  }
  detections.length = writeIdx;
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - intersection;

  return union <= 0 ? 0 : intersection / union;
}
