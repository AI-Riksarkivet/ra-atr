"""Ray Serve deployments for GPU inference pipeline."""

from PIL import Image
from ray import serve

from .detect import decode_yolo
from .layout import decode_rtmdet
from .models import TOKENIZER_FILE, ModelStore, _resolve_model
from .preprocessing import (
    crop_region,
    preprocess_rtmdet,
    preprocess_trocr,
    preprocess_yolo,
)
from .transcribe import Tokenizer, transcribe_line


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.25})
class LayoutDetector:
    def __init__(self):
        self.store = ModelStore()
        self.session = self.store.layout
        print(f"[LayoutDetector] Loaded with providers: {self.store.providers()}")

    async def detect(self, img: Image.Image) -> list[dict]:
        tensor, scale = preprocess_rtmdet(img)
        result = self.session.run(None, {"image": tensor})
        return decode_rtmdet(result[0][0], result[1][0], 640, scale)


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.25})
class LineDetector:
    def __init__(self):
        self.store = ModelStore()
        self.session = self.store.yolo
        print(f"[LineDetector] Loaded with providers: {self.store.providers()}")

    async def detect(self, img: Image.Image, region: dict | None = None) -> list[dict]:
        if region and region.get("w", 0) > 0:
            cropped = crop_region(img, region["x"], region["y"], region["w"], region["h"])
            offset_x, offset_y = region["x"], region["y"]
        else:
            cropped = img
            offset_x, offset_y = 0, 0

        tensor, scale, pad_x, pad_y = preprocess_yolo(cropped)
        result = self.session.run(None, {self.session.get_inputs()[0].name: tensor})
        lines = decode_yolo(result[0], cropped.width, cropped.height, scale, pad_x, pad_y)

        for line in lines:
            line["x"] += offset_x
            line["y"] += offset_y
        return lines


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.5})
class Transcriber:
    def __init__(self):
        self.store = ModelStore()
        self.encoder = self.store.encoder
        self.decoder = self.store.decoder
        tok_path = _resolve_model(TOKENIZER_FILE, self.store.models_dir)
        self.tokenizer = Tokenizer(tok_path)
        print(f"[Transcriber] Loaded with providers: {self.store.providers()}")

    async def transcribe(self, img: Image.Image, bbox: dict) -> dict:
        line_img = crop_region(img, bbox["x"], bbox["y"], bbox["w"], bbox["h"])
        tensor = preprocess_trocr(line_img)
        text, confidence = transcribe_line(
            self.encoder,
            self.decoder,
            self.tokenizer,
            tensor,
        )
        return {"text": text, "confidence": confidence}

    @serve.batch(max_batch_size=8, batch_wait_timeout_s=0.05)
    async def transcribe_batch(self, requests: list[tuple]) -> list[dict]:
        """Batch transcribe multiple lines. Each request is (img, bbox)."""
        results = []
        for img, bbox in requests:
            line_img = crop_region(img, bbox["x"], bbox["y"], bbox["w"], bbox["h"])
            tensor = preprocess_trocr(line_img)
            text, confidence = transcribe_line(
                self.encoder,
                self.decoder,
                self.tokenizer,
                tensor,
            )
            results.append({"text": text, "confidence": confidence})
        return results
