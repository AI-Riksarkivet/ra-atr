"""GPU inference server for Lejonet HTR."""

import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .detect import decode_yolo
from .layout import decode_rtmdet
from .models import TOKENIZER_FILE, ModelStore
from .preprocessing import (
    crop_region,
    preprocess_rtmdet,
    preprocess_trocr,
    preprocess_yolo,
)
from .transcribe import Tokenizer, transcribe_line

store = ModelStore()
tokenizer: Tokenizer | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global tokenizer
    from .models import download_models

    # Download models if missing
    download_models(store.models_dir)

    # Pre-load tokenizer
    tok_path = store.models_dir / TOKENIZER_FILE
    if tok_path.exists():
        tokenizer = Tokenizer(tok_path)
        print(f"Tokenizer loaded from {tok_path}")
    print(f"Models dir: {store.models_dir}")
    print(f"Available: {store.available_models()}")
    print(f"Providers: {store.providers()}")
    yield


app = FastAPI(title="Lejonet GPU Inference", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_image(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _gpu_info() -> dict:
    """Get GPU device info if available."""
    import subprocess

    # Try rocm-smi
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
    # Try nvidia-smi
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return {"name": result.stdout.strip(), "runtime": "CUDA"}
    except Exception:
        pass
    # Try reading from sysfs (works without tools)
    try:
        from pathlib import Path

        for card in sorted(Path("/sys/class/drm").glob("card*/device")):
            vendor = (card / "vendor").read_text().strip()
            if vendor == "0x1002":  # AMD
                name = (card / "product_name").read_text().strip() if (card / "product_name").exists() else "AMD GPU"
                return {"name": name, "runtime": "ROCm"}
            elif vendor == "0x10de":  # NVIDIA
                name = (card / "product_name").read_text().strip() if (card / "product_name").exists() else "NVIDIA GPU"
                return {"name": name, "runtime": "CUDA"}
    except Exception:
        pass
    # Identify from providers
    providers = store.providers()
    if "ROCMExecutionProvider" in providers:
        return {"name": "AMD GPU", "runtime": "ROCm"}
    if "CUDAExecutionProvider" in providers:
        return {"name": "NVIDIA GPU", "runtime": "CUDA"}
    return {"name": "Unknown", "runtime": "Unknown"}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models": store.available_models(),
        "providers": store.providers(),
        "gpu": _gpu_info(),
    }


@app.get("/status")
def status():
    return {
        "deployments": {"inference": {"status": "HEALTHY"}},
        "gpu": _gpu_info(),
        "cluster": {"cpu_available": 0, "gpu_available": 1, "memory_gb": 0},
    }


@app.post("/detect-layout")
async def detect_layout(image: UploadFile = File(...)):
    """Detect layout regions in an image using RTMDet."""
    img = _read_image(await image.read())
    tensor, scale = preprocess_rtmdet(img)

    session = store.layout
    result = session.run(None, {"image": tensor})
    cls_scores = result[0][0]  # [8400, num_classes]
    bbox_preds = result[1][0]  # [8400, 4]

    regions = decode_rtmdet(cls_scores, bbox_preds, 640, scale)
    return {"regions": regions, "image_size": [img.width, img.height]}


@app.post("/detect-lines")
async def detect_lines(
    image: UploadFile = File(...),
    x: float = Form(0),
    y: float = Form(0),
    w: float = Form(0),
    h: float = Form(0),
):
    """Detect text lines in a region using YOLO."""
    img = _read_image(await image.read())

    # Crop to region if specified
    if w > 0 and h > 0:
        img = crop_region(img, x, y, w, h)
        offset_x, offset_y = x, y
    else:
        offset_x, offset_y = 0, 0

    tensor, scale, pad_x, pad_y = preprocess_yolo(img)

    session = store.yolo
    result = session.run(None, {session.get_inputs()[0].name: tensor})
    output = result[0]

    lines = decode_yolo(output, img.width, img.height, scale, pad_x, pad_y)

    # Offset back to full image coordinates
    for line in lines:
        line["x"] += offset_x
        line["y"] += offset_y

    return {"lines": lines}


@app.post("/transcribe")
async def transcribe(
    image: UploadFile = File(...),
    x: float = Form(...),
    y: float = Form(...),
    w: float = Form(...),
    h: float = Form(...),
):
    """Transcribe a single text line using TrOCR."""
    if tokenizer is None:
        raise HTTPException(503, "Tokenizer not loaded")

    img = _read_image(await image.read())
    line_img = crop_region(img, x, y, w, h)
    tensor = preprocess_trocr(line_img)

    text, confidence = transcribe_line(
        store.encoder,
        store.decoder,
        tokenizer,
        tensor,
    )
    return {"text": text, "confidence": confidence}


@app.post("/process-page")
async def process_page(image: UploadFile = File(...)):
    """Full pipeline: layout → lines → transcription for a page image."""
    if tokenizer is None:
        raise HTTPException(503, "Tokenizer not loaded")

    img = _read_image(await image.read())

    # 1. Layout detection
    layout_tensor, layout_scale = preprocess_rtmdet(img)
    layout_result = store.layout.run(None, {"image": layout_tensor})
    regions = decode_rtmdet(
        layout_result[0][0],
        layout_result[1][0],
        640,
        layout_scale,
    )

    # 2. Line detection per region
    all_groups = []
    for region in regions:
        region_img = crop_region(img, region["x"], region["y"], region["w"], region["h"])
        yolo_tensor, scale, pad_x, pad_y = preprocess_yolo(region_img)
        yolo_result = store.yolo.run(
            None,
            {store.yolo.get_inputs()[0].name: yolo_tensor},
        )
        lines = decode_yolo(yolo_result[0], region_img.width, region_img.height, scale, pad_x, pad_y)

        # 3. Transcribe each line
        transcribed_lines = []
        for line in lines:
            abs_x = region["x"] + line["x"]
            abs_y = region["y"] + line["y"]
            line_img = crop_region(img, abs_x, abs_y, line["w"], line["h"])
            trocr_tensor = preprocess_trocr(line_img)
            text, confidence = transcribe_line(
                store.encoder,
                store.decoder,
                tokenizer,
                trocr_tensor,
            )
            transcribed_lines.append(
                {
                    "bbox": {"x": abs_x, "y": abs_y, "w": line["w"], "h": line["h"]},
                    "text": text,
                    "confidence": confidence,
                }
            )

        all_groups.append(
            {
                "region": region,
                "lines": transcribed_lines,
            }
        )

    return {
        "groups": all_groups,
        "image_size": [img.width, img.height],
    }
