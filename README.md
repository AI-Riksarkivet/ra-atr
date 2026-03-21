# Lejonet HTR

Collaborative handwritten text recognition for historical documents from Sweden's National Archives (Riksarkivet).

Browse 3.7M archive volumes, load digitized pages, and transcribe with AI — in-browser or on GPU.

## Quick Start

```bash
make install   # Install dependencies
make serve     # Start backend + frontend
```

Open http://localhost:5173

## Features

- **In-browser HTR** — ONNX Runtime Web (WASM) for layout detection, line detection, and transcription
- **GPU acceleration** — Optional Docker GPU server with Ray Serve batching (NVIDIA/AMD ROCm)
- **Archive catalog** — Search 3.7M Riksarkivet volumes with full-text search
- **Auto-save** — Transcriptions saved to LanceDB with per-user isolation
- **Multi-model pipeline** — RTMDet → YOLO → TrOCR

## Architecture

```
Frontend (Svelte 5)  ←→  Backend (FastAPI + LanceDB)
       ↕                        ↕
  WASM workers          Archive catalog (3.7M volumes)
  OR GPU server         Transcription storage
```

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | Svelte 5 app |
| Backend | 8000 | Catalog search, transcription API |
| GPU Server | 8080 | GPU inference (optional) |
| Ray Dashboard | 8265 | Ray Serve monitoring |
| Prometheus | 9090 | Metrics collection |
| Grafana | 3000 | Dashboards |

## GPU Server

The GPU server runs the HTR pipeline on a dedicated GPU — significantly faster than in-browser WASM. Models are auto-downloaded from HuggingFace on first startup.

### Local GPU (AMD ROCm)

```bash
make build-gpu
make serve-gpu
```

### Local GPU (NVIDIA)

```bash
make build-gpu-nvidia
docker run --gpus all --shm-size=4g \
  -p 8080:8080 -p 8265:8265 \
  carpelan/lejonet-gpu:nvidia
```

### Cloud GPU (RunPod)

For cloud GPU acceleration without a local GPU:

**1. Install CLI and authenticate:**
```bash
brew install runpod/runpodctl/runpodctl
runpodctl config --apiKey YOUR_RUNPOD_API_KEY
```

**2. Create a GPU pod:**
```bash
runpodctl pod create \
  --name "htr-gpu" \
  --gpu-id "NVIDIA RTX A4000" \
  --image "carpelan/lejonet-gpu:nvidia" \
  --container-disk-in-gb 20 \
  --ports "8080/http" \
  --cloud-type "COMMUNITY" \
  --env '{"HF_TOKEN":"your_hf_token_here"}'
```

Models download automatically from HuggingFace on first boot (~60s).

**3. Connect the frontend:**
```bash
GPU_SERVER_URL=https://<POD_ID>-8080.proxy.runpod.net make serve-frontend
```

Or start the full stack:
```bash
GPU_SERVER_URL=https://<POD_ID>-8080.proxy.runpod.net make serve
```

The header badge will show "GPU (NVIDIA RTX A4000)".

**4. Manage the pod:**
```bash
runpodctl pod list              # List pods
runpodctl pod stop <POD_ID>     # Pause (stop billing)
runpodctl pod start <POD_ID>    # Resume
runpodctl pod delete <POD_ID>   # Destroy
```

**Available GPUs:**

| GPU | VRAM | Price/hr | Speed (warm) |
|-----|------|----------|-------------|
| RTX A4000 | 16 GB | $0.17 | ~0.7s/line |
| RTX 4090 | 24 GB | $0.39 | ~0.3s/line |
| A100 | 80 GB | $1.29 | ~0.1s/line |

### Pre-built Docker Images

```bash
docker pull carpelan/lejonet-gpu:nvidia   # NVIDIA (CUDA + cuDNN)
docker pull carpelan/lejonet-gpu:rocm     # AMD (ROCm)
```

### Frontend Auto-Detection

The frontend automatically detects a GPU server at `localhost:8080` (local) or via the `/gpu` proxy (remote). You can also manually enter a URL in the Server settings (click the Server icon in the header).

## Monitoring

```bash
make compose-up   # Start Prometheus + Grafana
```

- **Prometheus**: http://localhost:9090 — scrapes Ray Serve + backend metrics
- **Grafana**: http://localhost:3000 — pre-loaded Ray dashboards
- **Ray Dashboard**: http://localhost:8265 — deployment status, logs

## Catalog Ingestion

To index the Riksarkivet metadata (3.7M volumes):

```bash
cd backend
uv run python -m lejonet_backend.ingest_catalog /path/to/Riksarkivet-2022-12-16 --no-embed
```

## Deploy to HuggingFace Space

The frontend is deployed as a static HuggingFace Space with custom COEP headers for multi-threaded WASM.

```bash
# Option 1: One command
make deploy

# Option 2: Manual steps
VITE_MODEL_BASE=https://huggingface.co/carpelan/htr-onnx-models/resolve/main npm run build
rm -rf space/_app space/viewer space/*.html space/*.jpg space/*.svg space/*.mp4
mkdir -p space/viewer
rsync -a --exclude='models' build/ space/
cp space/viewer.html space/viewer/index.html
cp space/index.html space/200.html   # SPA fallback for HF static Spaces
cp space/index.html space/404.html

# 3. Upload
cd space && python3 -c "
from huggingface_hub import HfApi
HfApi().upload_folder(folder_path='.', repo_id='carpelan/lejonet', repo_type='space', delete_patterns=['build/*'])
"
```

Live at: https://huggingface.co/spaces/carpelan/lejonet

## Development

```bash
make check   # Format + lint + typecheck
make test    # Run tests
make help    # Show all targets
```

See [CLAUDE.md](CLAUDE.md) for the full development guide.

## Models

| Model | Size | Source |
|-------|------|--------|
| `rtmdet-regions.onnx` | 97 MB | Riksarkivet/rtmdet_regions |
| `yolo-lines.onnx` | 229 MB | Riksarkivet/yolov9-lines-within-regions-1 |
| `encoder.onnx` | 329 MB | Riksarkivet/trocr-base-handwritten-hist-swe-2 |
| `decoder.onnx` | 1.2 GB | Riksarkivet/trocr-base-handwritten-hist-swe-2 |
| `tokenizer.json` | 2 MB | Riksarkivet/trocr-base-handwritten-hist-swe-2 |

Models are stored on [HuggingFace](https://huggingface.co/carpelan/htr-onnx-models) and auto-downloaded by the GPU server on first startup.

## License

[Apache 2.0](LICENSE)
