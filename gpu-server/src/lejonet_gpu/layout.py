"""RTMDet layout detection."""

import numpy as np

LABELS = ["text_region"]
STRIDES = [8, 16, 32]


def _generate_anchors(input_size: int) -> np.ndarray:
    """Generate anchor grid centers. offset=0 (MMDet convention)."""
    anchors = []
    for stride in STRIDES:
        grid_size = input_size // stride
        for y in range(grid_size):
            for x in range(grid_size):
                anchors.append([x * stride, y * stride])
    return np.array(anchors, dtype=np.float32)


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
    """Non-maximum suppression."""
    order = scores.argsort()[::-1]
    keep = []
    while len(order) > 0:
        i = order[0]
        keep.append(i)
        if len(order) == 1:
            break
        rest = order[1:]
        x1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        y1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        x2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        y2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        iou = inter / (area_i + area_r - inter + 1e-6)
        order = rest[iou < iou_threshold]
    return keep


def decode_rtmdet(
    cls_scores: np.ndarray,
    bbox_preds: np.ndarray,
    input_size: int,
    resize_scale: float,
    conf_threshold: float = 0.3,
    iou_threshold: float = 0.45,
) -> list[dict]:
    """Decode RTMDet output to layout regions in original image coordinates."""
    anchors = _generate_anchors(input_size)
    inv_scale = 1.0 / resize_scale

    # Sigmoid on class 0
    scores = 1.0 / (1.0 + np.exp(-cls_scores[:, 0]))
    mask = scores > conf_threshold
    if not mask.any():
        return []

    scores = scores[mask]
    bbox = bbox_preds[mask]
    anc = anchors[mask]

    # Decode: anchor_center ± distance, then scale to original
    x1 = (anc[:, 0] - bbox[:, 0]) * inv_scale
    y1 = (anc[:, 1] - bbox[:, 1]) * inv_scale
    x2 = (anc[:, 0] + bbox[:, 2]) * inv_scale
    y2 = (anc[:, 1] + bbox[:, 3]) * inv_scale

    boxes = np.stack([x1, y1, x2, y2], axis=1)
    keep = _nms(boxes, scores, iou_threshold)

    regions = []
    for i in keep:
        regions.append(
            {
                "label": LABELS[0],
                "confidence": float(scores[i]),
                "x": float(max(0, boxes[i, 0])),
                "y": float(max(0, boxes[i, 1])),
                "w": float(max(0, boxes[i, 2] - boxes[i, 0])),
                "h": float(max(0, boxes[i, 3] - boxes[i, 1])),
            }
        )

    regions.sort(key=lambda r: (r["y"], r["x"]))
    return regions
