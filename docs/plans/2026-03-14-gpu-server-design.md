# GPU Inference Server — Design

**Goal:** A Docker-packaged FastAPI server that runs ONNX models on GPU. Users pull the image, run it with GPU passthrough, and point the ra-atr app at it.

## Endpoints

- `POST /detect-layout` — image → layout regions (RTMDet)
- `POST /detect-lines` — image + region bbox → line bboxes (YOLO)
- `POST /transcribe` — image + line bbox → text + confidence (TrOCR)
- `GET /health` — status + available models + GPU info

## Stack

- FastAPI + uvicorn
- ONNX Runtime GPU (`onnxruntime-gpu` for NVIDIA, `onnxruntime-rocm` for AMD)
- Ray Serve for scaling across workers/GPUs
- uv for project management
- Docker with GPU passthrough

## Docker Images

- `lejonet-gpu:nvidia` — CUDA base image
- `lejonet-gpu:rocm` — ROCm base image

Run with:
```bash
# NVIDIA
docker run --gpus all -p 8080:8080 lejonet-gpu:nvidia

# AMD ROCm
docker run --device /dev/kfd --device /dev/dri -p 8080:8080 lejonet-gpu:rocm

# Podman
podman run --device nvidia.com/gpu=all -p 8080:8080 lejonet-gpu:nvidia
```

## Models

Downloaded on first run from HuggingFace or mounted via volume at `/models`:
- `rtmdet-regions.onnx` (97MB) — layout detection
- `yolo-lines.onnx` (229MB) — line detection
- `encoder.onnx` (329MB) — TrOCR encoder
- `decoder.onnx` (1.2GB) — TrOCR decoder
- `tokenizer.json` (2MB) — BPE tokenizer

## Project Structure

```
gpu-server/
├── pyproject.toml       # uv project
├── Dockerfile.nvidia
├── Dockerfile.rocm
├── src/
│   └── lejonet_gpu/
│       ├── __init__.py
│       ├── app.py       # FastAPI app
│       ├── models.py    # ONNX session management
│       ├── layout.py    # RTMDet inference
│       ├── detect.py    # YOLO line detection
│       ├── transcribe.py # TrOCR inference
│       └── preprocessing.py
└── tests/
```

## Frontend Integration

- Settings UI in app header or home screen: enter GPU server URL
- If URL is set, fetch requests go to GPU server instead of WASM workers
- Fallback to WASM if server is unreachable
- Store URL in localStorage
