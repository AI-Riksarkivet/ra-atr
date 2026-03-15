"""GPU inference server for Lejonet HTR — Ray Serve + FastAPI."""

import io
import subprocess
from pathlib import Path

import ray
from ray import serve
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .models import ModelStore, TOKENIZER_FILE
from .serve import LayoutDetector, LineDetector, Transcriber

app = FastAPI(title="Lejonet GPU Inference")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _gpu_info() -> dict:
    """Get GPU device info."""
    for cmd in [
        ["rocm-smi", "--showproductname", "--csv"],
        ["rocm-smi", "--showallinfo", "--csv"],
    ]:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                lines = [l for l in result.stdout.strip().split("\n") if l and not l.startswith("device")]
                if lines:
                    return {"name": lines[0].split(",")[-1].strip(), "runtime": "ROCm"}
        except Exception:
            pass
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return {"name": result.stdout.strip(), "runtime": "CUDA"}
    except Exception:
        pass
    try:
        for card in sorted(Path("/sys/class/drm").glob("card*/device")):
            vendor = (card / "vendor").read_text().strip()
            if vendor == "0x1002":
                name = (card / "product_name").read_text().strip() if (card / "product_name").exists() else "AMD GPU"
                return {"name": name, "runtime": "ROCm"}
            elif vendor == "0x10de":
                name = (card / "product_name").read_text().strip() if (card / "product_name").exists() else "NVIDIA GPU"
                return {"name": name, "runtime": "CUDA"}
    except Exception:
        pass
    store = ModelStore()
    providers = store.providers()
    if "ROCMExecutionProvider" in providers:
        return {"name": "AMD GPU", "runtime": "ROCm"}
    if "CUDAExecutionProvider" in providers:
        return {"name": "NVIDIA GPU", "runtime": "CUDA"}
    return {"name": "Unknown", "runtime": "Unknown"}


@app.get("/health")
def health():
    store = ModelStore()
    return {
        "status": "ok",
        "models": store.available_models(),
        "providers": store.providers(),
        "gpu": _gpu_info(),
        "ray": {"running": ray.is_initialized()},
    }


@app.post("/detect-layout")
async def detect_layout(image: UploadFile = File(...)):
    img = _read_image(await image.read())
    detector = serve.get_deployment_handle("LayoutDetector")
    regions = await detector.detect.remote(img)
    return {"regions": regions, "image_size": [img.width, img.height]}


@app.post("/detect-lines")
async def detect_lines(
    image: UploadFile = File(...),
    x: float = Form(0),
    y: float = Form(0),
    w: float = Form(0),
    h: float = Form(0),
):
    img = _read_image(await image.read())
    region = {"x": x, "y": y, "w": w, "h": h} if w > 0 and h > 0 else None
    detector = serve.get_deployment_handle("LineDetector")
    lines = await detector.detect.remote(img, region)
    return {"lines": lines}


@app.post("/transcribe")
async def transcribe(
    image: UploadFile = File(...),
    x: float = Form(...),
    y: float = Form(...),
    w: float = Form(...),
    h: float = Form(...),
):
    img = _read_image(await image.read())
    transcriber = serve.get_deployment_handle("Transcriber")
    result = await transcriber.transcribe.remote(img, {"x": x, "y": y, "w": w, "h": h})
    return result


@app.post("/process-page")
async def process_page(image: UploadFile = File(...)):
    """Full pipeline: layout → lines → transcription."""
    img = _read_image(await image.read())

    layout = serve.get_deployment_handle("LayoutDetector")
    line_det = serve.get_deployment_handle("LineDetector")
    transcriber = serve.get_deployment_handle("Transcriber")

    # 1. Layout detection
    regions = await layout.detect.remote(img)

    # 2. Line detection per region (parallel)
    line_futures = []
    for region in regions:
        line_futures.append((region, line_det.detect.remote(img, region)))

    # 3. Transcribe lines (parallel within each region)
    all_groups = []
    for region, lines_future in line_futures:
        lines = await lines_future

        # Send all lines for transcription in parallel (batching kicks in)
        transcribe_futures = []
        for line in lines:
            bbox = {"x": line["x"], "y": line["y"], "w": line["w"], "h": line["h"]}
            transcribe_futures.append((line, transcriber.transcribe.remote(img, bbox)))

        transcribed_lines = []
        for line, fut in transcribe_futures:
            result = await fut
            transcribed_lines.append({
                "bbox": {"x": line["x"], "y": line["y"], "w": line["w"], "h": line["h"]},
                "text": result["text"],
                "confidence": result["confidence"],
            })

        all_groups.append({
            "region": region,
            "lines": transcribed_lines,
        })

    return {
        "groups": all_groups,
        "image_size": [img.width, img.height],
    }
