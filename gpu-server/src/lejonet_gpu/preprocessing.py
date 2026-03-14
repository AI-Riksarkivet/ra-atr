"""Image preprocessing for inference."""

import numpy as np
from PIL import Image


def preprocess_rtmdet(image: Image.Image, input_size: int = 640) -> tuple[np.ndarray, float]:
    """Resize with keep_ratio + pad bottom-right (MMDet convention).
    Returns (tensor [1,3,H,W], scale).
    """
    orig_w, orig_h = image.size
    scale = min(input_size / orig_w, input_size / orig_h)
    new_w, new_h = round(orig_w * scale), round(orig_h * scale)

    resized = image.resize((new_w, new_h), Image.BILINEAR)
    padded = Image.new("RGB", (input_size, input_size), (114, 114, 114))
    padded.paste(resized, (0, 0))

    arr = np.array(padded, dtype=np.float32) / 255.0
    tensor = arr.transpose(2, 0, 1)[np.newaxis]  # [1, 3, H, W]
    return tensor, scale


def preprocess_yolo(image: Image.Image, input_size: int = 640) -> tuple[np.ndarray, float, int, int]:
    """Letterbox resize for YOLO (centered, gray padding).
    Returns (tensor [1,3,H,W], scale, padX, padY).
    """
    orig_w, orig_h = image.size
    scale = min(input_size / orig_w, input_size / orig_h)
    new_w, new_h = round(orig_w * scale), round(orig_h * scale)
    pad_x = (input_size - new_w) // 2
    pad_y = (input_size - new_h) // 2

    padded = Image.new("RGB", (input_size, input_size), (128, 128, 128))
    resized = image.resize((new_w, new_h), Image.BILINEAR)
    padded.paste(resized, (pad_x, pad_y))

    arr = np.array(padded, dtype=np.float32) / 255.0
    tensor = arr.transpose(2, 0, 1)[np.newaxis]
    return tensor, scale, pad_x, pad_y


def preprocess_trocr(image: Image.Image, size: int = 384) -> np.ndarray:
    """Resize and normalize for TrOCR encoder.
    Returns tensor [1, 3, 384, 384].
    """
    resized = image.resize((size, size), Image.BILINEAR)
    arr = np.array(resized, dtype=np.float32) / 127.5 - 1.0
    return arr.transpose(2, 0, 1)[np.newaxis]


def crop_region(image: Image.Image, x: float, y: float, w: float, h: float) -> Image.Image:
    """Crop a region from the image."""
    x1 = max(0, int(x))
    y1 = max(0, int(y))
    x2 = min(image.width, int(x + w))
    y2 = min(image.height, int(y + h))
    return image.crop((x1, y1, x2, y2))
