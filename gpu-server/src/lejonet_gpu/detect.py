"""YOLO line detection."""

import numpy as np


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
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


def decode_yolo(
    output: np.ndarray,
    orig_w: int,
    orig_h: int,
    scale: float,
    pad_x: int,
    pad_y: int,
    conf_threshold: float = 0.25,
    iou_threshold: float = 0.45,
) -> list[dict]:
    """Decode YOLO output [1, features, num_detections] to line bboxes.

    Returns list of {x, y, w, h, confidence} in original image coordinates.
    """
    # output shape: [1, 37, 8400] for seg or [1, 5, 8400] for detect
    data = output[0]  # [features, num_det]
    num_features, num_det = data.shape

    # First 4 = cx, cy, w, h; 5th = class score (single class)
    cx = data[0]
    cy = data[1]
    w = data[2]
    h = data[3]
    scores = data[4]

    mask = scores > conf_threshold
    if not mask.any():
        return []

    cx, cy, w, h, scores = cx[mask], cy[mask], w[mask], h[mask], scores[mask]

    # Convert from center to corner format
    x1 = cx - w / 2
    y1 = cy - h / 2
    x2 = cx + w / 2
    y2 = cy + h / 2

    boxes = np.stack([x1, y1, x2, y2], axis=1)
    keep = _nms(boxes, scores, iou_threshold)

    lines = []
    for i in keep:
        # Map from padded 640 space to original image
        ox = (boxes[i, 0] - pad_x) / scale
        oy = (boxes[i, 1] - pad_y) / scale
        ow = (boxes[i, 2] - boxes[i, 0]) / scale
        oh = (boxes[i, 3] - boxes[i, 1]) / scale
        lines.append({
            "x": float(max(0, ox)),
            "y": float(max(0, oy)),
            "w": float(max(0, ow)),
            "h": float(max(0, oh)),
            "confidence": float(scores[i]),
        })

    lines.sort(key=lambda l: (l["y"], l["x"]))
    return lines
