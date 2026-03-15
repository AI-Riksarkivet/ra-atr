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

## GPU Server (Optional)

```bash
# AMD ROCm
make build-gpu && make serve-gpu

# NVIDIA
make build-gpu-nvidia
docker run --gpus all -v ./public/models:/models -p 8080:8080 lejonet-gpu:nvidia
```

The frontend auto-detects the GPU server at `localhost:8080`.

## Monitoring

```bash
make compose-up   # Start Prometheus + Grafana
```

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

## License

[Apache 2.0](LICENSE)
