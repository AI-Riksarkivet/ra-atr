import type { BBox, Point } from "./types";

export interface Detection extends BBox {
  classId: number;
}

const NUM_MASK_COEFFS = 32;

/**
 * Parse YOLO segmentation output and extract polygon contours.
 *
 * output0 shape: [1, 37, 8400] — 4 box + 1 class + 32 mask coefficients
 * output1 shape: [1, 32, 160, 160] — prototype masks
 */
export function parseYoloOutput(
  outputData: Float32Array,
  outputDims: readonly number[],
  protoData: Float32Array | null,
  protoDims: readonly number[] | null,
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
  const isSeg = numFeatures > 36 && protoData !== null;

  // Determine number of classes
  const numClasses = isSeg
    ? numFeatures - 4 - NUM_MASK_COEFFS
    : numFeatures - 4;

  interface RawDetection extends Detection {
    maskCoeffs?: Float32Array;
    // Box in padded 640x640 space (for mask cropping)
    padX1: number;
    padY1: number;
    padX2: number;
    padY2: number;
  }

  const detections: RawDetection[] = [];

  for (let j = 0; j < numDetections; j++) {
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

    // Box in padded 640x640 coords
    const padX1 = cxVal - w / 2;
    const padY1 = cyVal - h / 2;
    const padX2 = cxVal + w / 2;
    const padY2 = cyVal + h / 2;

    // Convert from padded 640x640 to original image coords
    const x = (padX1 - padX) / scale;
    const y = (padY1 - padY) / scale;
    const bw = w / scale;
    const bh = h / scale;

    const det: RawDetection = {
      x: Math.max(0, Math.min(x, origW)),
      y: Math.max(0, Math.min(y, origH)),
      w: Math.min(bw, origW - x),
      h: Math.min(bh, origH - y),
      confidence: bestScore,
      classId: bestClass,
      padX1,
      padY1,
      padX2,
      padY2,
    };

    // Extract mask coefficients
    if (isSeg) {
      const coeffs = new Float32Array(NUM_MASK_COEFFS);
      for (let m = 0; m < NUM_MASK_COEFFS; m++) {
        coeffs[m] = outputData[idx(4 + numClasses + m)];
      }
      det.maskCoeffs = coeffs;
    }

    detections.push(det);
  }

  nms(detections, iouThreshold);

  // Generate polygons from masks
  if (isSeg && protoData && protoDims) {
    for (const det of detections) {
      if (!det.maskCoeffs) continue;
      det.polygon = extractPolygon(
        det.maskCoeffs,
        protoData,
        protoDims,
        det.padX1,
        det.padY1,
        det.padX2,
        det.padY2,
        origW,
        origH,
        scale,
        padX,
        padY,
      );
    }
  }

  // Clean up internal fields
  return detections.map(
    ({ maskCoeffs, padX1, padY1, padX2, padY2, ...rest }) => rest,
  );
}

/**
 * Multiply mask coefficients with prototype masks, crop to bbox,
 * threshold, and extract contour polygon in original image coordinates.
 */
function extractPolygon(
  coeffs: Float32Array,
  protoData: Float32Array,
  protoDims: readonly number[],
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
  origW: number,
  origH: number,
  scale: number,
  padX: number,
  padY: number,
): Point[] {
  const protoH = protoDims[2]; // 160
  const protoW = protoDims[3]; // 160

  // Scale factor from 640 input to 160 proto mask
  const maskScale = protoW / 640;

  // Bbox in mask coordinates
  const mx1 = Math.max(0, Math.floor(bx1 * maskScale));
  const my1 = Math.max(0, Math.floor(by1 * maskScale));
  const mx2 = Math.min(protoW - 1, Math.ceil(bx2 * maskScale));
  const my2 = Math.min(protoH - 1, Math.ceil(by2 * maskScale));
  const mw = mx2 - mx1 + 1;
  const mh = my2 - my1 + 1;

  if (mw <= 0 || mh <= 0) return [];

  // Compute mask: sigmoid(sum(coeffs[k] * proto[k, y, x]))
  const mask = new Float32Array(mh * mw);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      let sum = 0;
      for (let k = 0; k < NUM_MASK_COEFFS; k++) {
        // proto layout: [1, 32, 160, 160]
        const protoIdx = k * protoH * protoW + (my1 + y) * protoW + (mx1 + x);
        sum += coeffs[k] * protoData[protoIdx];
      }
      // sigmoid
      mask[y * mw + x] = 1 / (1 + Math.exp(-sum));
    }
  }

  // Extract polygon by scanning rows for left/right mask boundaries
  const threshold = 0.5;
  const leftEdge: Point[] = [];
  const rightEdge: Point[] = [];

  for (let y = 0; y < mh; y++) {
    let minX = -1,
      maxX = -1;
    for (let x = 0; x < mw; x++) {
      if (mask[y * mw + x] >= threshold) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    if (minX !== -1) {
      leftEdge.push({ x: minX, y });
      rightEdge.push({ x: maxX + 1, y });
    }
  }

  if (leftEdge.length < 2) return [];

  // Form closed polygon: left edge top→bottom, then right edge bottom→top
  const contour = [...leftEdge, ...rightEdge.reverse()];

  // Convert contour from cropped-mask coords back to original image coords
  const polygon: Point[] = contour.map((p) => ({
    x: ((p.x + mx1) / maskScale - padX) / scale,
    y: ((p.y + my1) / maskScale - padY) / scale,
  }));

  // Clip to image bounds
  for (const p of polygon) {
    p.x = Math.max(0, Math.min(origW, p.x));
    p.y = Math.max(0, Math.min(origH, p.y));
  }

  // Simplify polygon (Douglas-Peucker) to reduce point count
  return simplifyPolygon(polygon, 2.0);
}

/**
 * Douglas-Peucker polygon simplification.
 */
function simplifyPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length <= 3) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToLineDist(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPolygon(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPolygon(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

function pointToLineDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
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
