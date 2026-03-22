/**
 * Decode RTMDet output: cls_scores [1, 8400, C] + bbox_preds [1, 8400, 4]
 * bbox_preds are distances (left, top, right, bottom) from anchor centers.
 * Strides: 80x80 grid (stride 8), 40x40 grid (stride 16), 20x20 grid (stride 32).
 */

export interface LayoutRegion {
	label: string;
	confidence: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

function generateAnchors(inputSize: number): { cx: number; cy: number; stride: number }[] {
	const strides = [8, 16, 32];
	const anchors: { cx: number; cy: number; stride: number }[] = [];
	for (const stride of strides) {
		const gridSize = inputSize / stride;
		for (let y = 0; y < gridSize; y++) {
			for (let x = 0; x < gridSize; x++) {
				anchors.push({
					cx: x * stride,
					cy: y * stride,
					stride,
				});
			}
		}
	}
	return anchors;
}

function nms(
	boxes: {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		score: number;
		idx: number;
	}[],
	iouThreshold: number,
): number[] {
	const sorted = [...boxes].sort((a, b) => b.score - a.score);
	const keep: number[] = [];

	for (const box of sorted) {
		let dominated = false;
		for (const keptIdx of keep) {
			const kept = boxes.find((b) => b.idx === keptIdx)!;
			const x1 = Math.max(box.x1, kept.x1);
			const y1 = Math.max(box.y1, kept.y1);
			const x2 = Math.min(box.x2, kept.x2);
			const y2 = Math.min(box.y2, kept.y2);
			const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
			const areaA = (box.x2 - box.x1) * (box.y2 - box.y1);
			const areaB = (kept.x2 - kept.x1) * (kept.y2 - kept.y1);
			const iou = inter / (areaA + areaB - inter);
			if (iou > iouThreshold) {
				dominated = true;
				break;
			}
		}
		if (!dominated) keep.push(box.idx);
	}
	return keep;
}

export function parseRTMDetOutput(
	clsScores: Float32Array, // [1, 8400, numClasses]
	bboxPreds: Float32Array, // [1, 8400, 4]
	numAnchors: number,
	numClasses: number,
	inputSize: number,
	resizeScale: number, // scale used to resize original → inputSize
	confThreshold: number,
	iouThreshold: number,
	labels: string[],
): LayoutRegion[] {
	const anchors = generateAnchors(inputSize);
	const invScale = 1 / resizeScale; // map from resized space back to original

	// Class 0 = TextRegion (the only trained class)
	const classIdx = 0;

	const candidates: {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		score: number;
		idx: number;
	}[] = [];

	for (let i = 0; i < numAnchors; i++) {
		const score = sigmoid(clsScores[i * numClasses + classIdx]);
		if (score < confThreshold) continue;

		const anchor = anchors[i];
		const left = bboxPreds[i * 4];
		const top = bboxPreds[i * 4 + 1];
		const right = bboxPreds[i * 4 + 2];
		const bottom = bboxPreds[i * 4 + 3];

		const x1 = (anchor.cx - left) * invScale;
		const y1 = (anchor.cy - top) * invScale;
		const x2 = (anchor.cx + right) * invScale;
		const y2 = (anchor.cy + bottom) * invScale;

		candidates.push({ x1, y1, x2, y2, score, idx: candidates.length });
	}

	const keepIndices = nms(candidates, iouThreshold);

	return keepIndices
		.map((idx) => {
			const det = candidates[idx];
			return {
				label: labels[classIdx] ?? 'text_region',
				confidence: det.score,
				x: Math.max(0, det.x1),
				y: Math.max(0, det.y1),
				w: Math.max(0, det.x2 - det.x1),
				h: Math.max(0, det.y2 - det.y1),
			};
		})
		.sort((a, b) => a.y - b.y || a.x - b.x);
}
