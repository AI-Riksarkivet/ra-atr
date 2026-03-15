"""Entry point for the GPU inference server with Ray Serve."""

import io
import subprocess
from pathlib import Path
from typing import List

import ray
from ray import serve
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .models import ModelStore, TOKENIZER_FILE
from .preprocessing import preprocess_rtmdet, preprocess_yolo, preprocess_trocr, crop_region
from .layout import decode_rtmdet
from .detect import decode_yolo
from .transcribe import Tokenizer, transcribe_line


# --- Ray Serve Deployments ---


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.25})
class LayoutDetector:
    def __init__(self):
        self.store = ModelStore()
        self.session = self.store.layout
        print(f"[LayoutDetector] Loaded with {self.store.providers()}")

    def detect(self, img: Image.Image) -> list[dict]:
        tensor, scale = preprocess_rtmdet(img)
        result = self.session.run(None, {"image": tensor})
        return decode_rtmdet(result[0][0], result[1][0], 640, scale)


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.25})
class LineDetector:
    def __init__(self):
        self.store = ModelStore()
        self.session = self.store.yolo
        print(f"[LineDetector] Loaded with {self.store.providers()}")

    def detect(self, img: Image.Image, region: dict | None = None) -> list[dict]:
        if region and region.get("w", 0) > 0:
            cropped = crop_region(img, region["x"], region["y"], region["w"], region["h"])
            ox, oy = region["x"], region["y"]
        else:
            cropped = img
            ox, oy = 0, 0
        tensor, scale, px, py = preprocess_yolo(cropped)
        result = self.session.run(None, {self.session.get_inputs()[0].name: tensor})
        lines = decode_yolo(result[0], cropped.width, cropped.height, scale, px, py)
        for l in lines:
            l["x"] += ox
            l["y"] += oy
        return lines


@serve.deployment(num_replicas=1, ray_actor_options={"num_gpus": 0.5})
class TranscriberDeployment:
    def __init__(self):
        self.store = ModelStore()
        self.encoder = self.store.encoder
        self.decoder = self.store.decoder
        tok_path = self.store.models_dir / TOKENIZER_FILE
        self.tokenizer = Tokenizer(tok_path)
        print(f"[Transcriber] Loaded with {self.store.providers()}")

    def transcribe_one(self, img: Image.Image, bbox: dict) -> dict:
        line_img = crop_region(img, bbox["x"], bbox["y"], bbox["w"], bbox["h"])
        tensor = preprocess_trocr(line_img)
        text, confidence = transcribe_line(self.encoder, self.decoder, self.tokenizer, tensor)
        return {"text": text, "confidence": confidence}

    @serve.batch(max_batch_size=8, batch_wait_timeout_s=0.05)
    async def transcribe_batch(self, requests: List[tuple[Image.Image, dict]]) -> List[dict]:
        results = []
        for img, bbox in requests:
            results.append(self.transcribe_one(img, bbox))
        return results


# --- FastAPI Ingress ---


def _gpu_info() -> dict:
    for cmd in [["rocm-smi", "--showproductname", "--csv"], ["rocm-smi", "--showallinfo", "--csv"]]:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                lines = [l for l in r.stdout.strip().split("\n") if l and not l.startswith("device")]
                if lines:
                    return {"name": lines[0].split(",")[-1].strip(), "runtime": "ROCm"}
        except Exception:
            pass
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip():
            return {"name": r.stdout.strip(), "runtime": "CUDA"}
    except Exception:
        pass
    try:
        for card in sorted(Path("/sys/class/drm").glob("card*/device")):
            v = (card / "vendor").read_text().strip()
            if v == "0x1002":
                return {"name": "AMD GPU", "runtime": "ROCm"}
            if v == "0x10de":
                return {"name": "NVIDIA GPU", "runtime": "CUDA"}
    except Exception:
        pass
    return {"name": "Unknown", "runtime": "Unknown"}


app = FastAPI(title="Lejonet GPU Inference (Ray Serve)")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _read_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


@serve.deployment(ray_actor_options={"num_cpus": 1})
@serve.ingress(app)
class APIIngress:
    def __init__(self, layout, line_det, transcriber):
        self.layout = layout
        self.line_det = line_det
        self.transcriber = transcriber

    @app.get("/health")
    def health(self):
        store = ModelStore()
        return {
            "status": "ok",
            "models": store.available_models(),
            "providers": store.providers(),
            "gpu": _gpu_info(),
            "ray": True,
        }

    @app.post("/detect-layout")
    async def detect_layout(self, image: UploadFile = File(...)):
        img = _read_image(await image.read())
        regions = await self.layout.detect.remote(img)
        return {"regions": regions, "image_size": [img.width, img.height]}

    @app.post("/detect-lines")
    async def detect_lines(self, image: UploadFile = File(...), x: float = Form(0), y: float = Form(0), w: float = Form(0), h: float = Form(0)):
        img = _read_image(await image.read())
        region = {"x": x, "y": y, "w": w, "h": h} if w > 0 and h > 0 else None
        lines = await self.line_det.detect.remote(img, region)
        return {"lines": lines}

    @app.post("/transcribe")
    async def transcribe(self, image: UploadFile = File(...), x: float = Form(...), y: float = Form(...), w: float = Form(...), h: float = Form(...)):
        img = _read_image(await image.read())
        result = await self.transcriber.transcribe_one.remote(img, {"x": x, "y": y, "w": w, "h": h})
        return result

    @app.post("/process-page")
    async def process_page(self, image: UploadFile = File(...)):
        img = _read_image(await image.read())

        regions = await self.layout.detect.remote(img)

        all_groups = []
        for region in regions:
            lines = await self.line_det.detect.remote(img, region)

            # Send all lines for transcription — Ray batching kicks in
            futures = []
            for line in lines:
                bbox = {"x": line["x"], "y": line["y"], "w": line["w"], "h": line["h"]}
                futures.append((line, self.transcriber.transcribe_batch.remote(img, bbox)))

            transcribed = []
            for line, fut in futures:
                result = await fut
                transcribed.append({
                    "bbox": {"x": line["x"], "y": line["y"], "w": line["w"], "h": line["h"]},
                    "text": result["text"],
                    "confidence": result["confidence"],
                })

            all_groups.append({"region": region, "lines": transcribed})

        return {"groups": all_groups, "image_size": [img.width, img.height]}


# --- Start ---


def start():
    # Skip runtime env packaging — all deps already installed in container
    ray.init(
        ignore_reinit_error=True,
        runtime_env={"working_dir": None},
    )

    serve.start(http_options={"host": "0.0.0.0", "port": 8080})

    layout = LayoutDetector.bind()
    line_det = LineDetector.bind()
    transcriber = TranscriberDeployment.bind()
    ingress = APIIngress.bind(layout, line_det, transcriber)

    serve.run(ingress)

    print("Ray Serve running:")
    print("  API: http://0.0.0.0:8080")
    print("  Dashboard: http://localhost:8265")
    print("  Deployments: LayoutDetector(0.25GPU), LineDetector(0.25GPU), Transcriber(0.5GPU, batch=8)")


if __name__ == "__main__":
    start()
    import time
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        serve.shutdown()
        ray.shutdown()
