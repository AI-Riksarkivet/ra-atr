# Lejonet HTR

Collaborative handwritten text recognition app for historical documents. Browse the Riksarkivet archive catalog, load digitized volumes, and transcribe with AI.

## Quick Start

### 1. Start the backend (catalog search + transcriptions)

```bash
cd backend
uv sync
.venv/bin/uvicorn app:app --reload --port 8000
```

### 2. Start the frontend

```bash
npm install
npm run dev
```

Open http://localhost:5173

### 3. (Optional) Start the GPU inference server

For faster transcription using your GPU:

```bash
cd gpu-server

# AMD GPU (ROCm)
docker build -f Dockerfile.rocm -t lejonet-gpu:rocm .
docker run --device /dev/kfd --device /dev/dri --group-add video \
  -v $(pwd)/../public/models:/models -p 8080:8080 lejonet-gpu:rocm

# NVIDIA GPU
docker build -f Dockerfile.nvidia -t lejonet-gpu:nvidia .
docker run --gpus all \
  -v $(pwd)/../public/models:/models -p 8080:8080 lejonet-gpu:nvidia
```

The frontend auto-detects the GPU server at `localhost:8080`. You'll see "GPU" badge in the header instead of "WASM".

## Architecture

```
frontend (Svelte 5)  ←→  backend (FastAPI + LanceDB)
       ↕                        ↕
  WASM workers          archive catalog (3.7M volumes)
  OR GPU server         transcription storage
```

- **Frontend:** Svelte 5 + ONNX Runtime Web (WASM) for in-browser inference
- **Backend:** FastAPI + LanceDB for catalog search and transcription storage
- **GPU Server:** FastAPI + ONNX Runtime GPU (CUDA/ROCm) in Docker

## Services

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | Svelte dev server |
| Backend | 8000 | Catalog search, transcription API |
| GPU Server | 8080 | GPU inference (optional) |

## Models

All models are ONNX format, stored in `public/models/`:

| Model | Size | Purpose |
|-------|------|---------|
| `rtmdet-regions.onnx` | 97 MB | Layout detection (text regions) |
| `yolo-lines.onnx` | 229 MB | Line detection within regions |
| `encoder.onnx` | 329 MB | TrOCR encoder |
| `decoder.onnx` | 1.2 GB | TrOCR decoder |
| `tokenizer.json` | 2 MB | BPE tokenizer |
