# Lejonet HTR — Development Guide

## Quick Start

```bash
# Install dependencies
make install

# Start backend + frontend
make serve

# Start GPU server (Docker, requires AMD/NVIDIA GPU)
make build-gpu
make serve-gpu

# Start monitoring (Prometheus + Grafana)
make compose-up

# Run quality checks
make check

# Run tests
make test
```

## Architecture

```
lejonet/
├── src/                  # Svelte 5 frontend (WASM HTR inference)
├── backend/              # FastAPI + LanceDB (catalog search, transcriptions)
├── gpu-server/           # FastAPI + Ray Serve + ONNX Runtime GPU (inference)
├── monitoring/           # Prometheus + Grafana configs
├── docs/plans/           # Design documents
└── public/models/        # ONNX model files (not tracked in git)
```

### Services

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | Svelte dev server |
| Backend | 8000 | Catalog search, transcription API, /metrics |
| GPU Server | 8080 | GPU inference (layout, lines, transcription) |
| Ray Dashboard | 8265 | Ray Serve monitoring |
| Prometheus | 9090 | Metrics collection |
| Grafana | 3000 | Dashboards |

### HTR Pipeline

```
Layout Detection (RTMDet) → Line Detection (YOLO) → Transcription (TrOCR)
```

Runs either in-browser (WASM) or on GPU server. Frontend auto-detects GPU server at localhost:8080.

## Coding Guidelines

### Python (backend, gpu-server)
- **Formatter**: ruff (line length 160)
- **Type hints**: Use throughout, add `py.typed` marker
- **Docstrings**: Google style
- **No pandas**: Use pyarrow compute for data operations
- **Testing**: pytest, mock at domain boundaries

### Frontend (Svelte 5)
- **Framework**: Svelte 5 with runes ($state, $derived, $effect)
- **Styling**: Tailwind CSS with shadcn-svelte components
- **State**: app-state.svelte.ts (centralized)
- **Workers**: Web Workers for ONNX inference (detect, transcribe, layout)

### Git Conventions
- **Commits**: Conventional Commits (feat, fix, docs, refactor, test, chore)
- **No co-authored-by**: Don't add Claude references to commits

## Key Files

### Frontend
- `src/lib/stores/app-state.svelte.ts` — Core state management, auto-save, LRU cache
- `src/lib/worker-state.svelte.ts` — HTR worker orchestration, GPU routing
- `src/lib/gpu-client.ts` — GPU server client with auto-detection
- `src/worker-detect.ts` — YOLO line detection worker
- `src/worker-transcribe.ts` — TrOCR transcription worker
- `src/worker-layout.ts` — RTMDet layout detection worker
- `src/lib/components/TranscriptionPanel.svelte` — Right panel (workspace tree)
- `src/lib/components/CatalogPanel.svelte` — Left panel (archive search)
- `src/routes/viewer/+page.svelte` — Main workspace page

### Backend
- `backend/app.py` — FastAPI app (catalog search, transcriptions, debug endpoints)
- `backend/ingest_catalog.py` — XML parser + LanceDB ingestion for 3.7M Riksarkivet volumes
- `backend/test_app.py` — API tests

### GPU Server
- `gpu-server/src/lejonet_gpu/app.py` — Simple FastAPI inference endpoints
- `gpu-server/src/lejonet_gpu/main.py` — Ray Serve entry point with batching
- `gpu-server/src/lejonet_gpu/serve.py` — Ray Serve deployments
- `gpu-server/src/lejonet_gpu/models.py` — ONNX session management (GPU-only)

### Models (public/models/)
- `rtmdet-regions.onnx` (97MB) — Layout detection, Riksarkivet/rtmdet_regions
- `yolo-lines.onnx` (229MB) — Line detection, Riksarkivet/yolov9-lines-within-regions-1
- `encoder.onnx` (329MB) — TrOCR encoder
- `decoder.onnx` (1.2GB) — TrOCR decoder
- `tokenizer.json` (2MB) — BPE tokenizer

## Common Tasks

### Add a new API endpoint
1. Add route in `backend/app.py`
2. Add test in `backend/test_app.py`
3. Add proxy route in `vite.config.ts` if needed

### Add a new ONNX model
1. Place `.onnx` file in `public/models/`
2. Add worker in `src/worker-*.ts`
3. Update `src/lib/worker-state.svelte.ts` with loading logic
4. Add GPU endpoint in `gpu-server/src/lejonet_gpu/`

### Ingest archive metadata
```bash
cd backend && .venv/bin/python ingest_catalog.py /path/to/Riksarkivet-2022-12-16 --no-embed
```

### Run GPU server locally (Docker)
```bash
# AMD ROCm
make build-gpu && make serve-gpu

# NVIDIA
make build-gpu-nvidia
docker run --gpus all -v ./public/models:/models -p 8080:8080 lejonet-gpu:nvidia
```
