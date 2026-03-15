# Architecture Overview

## Services

| Service | Technology | Port | Purpose |
|---------|-----------|------|---------|
| Frontend | Svelte 5 + ONNX Runtime Web | 5173 | UI + in-browser inference |
| Backend | FastAPI + LanceDB | 8000 | Catalog search, transcription storage |
| GPU Server | FastAPI + Ray Serve + ONNX Runtime | 8080 | GPU inference (optional) |
| Prometheus | prom/prometheus | 9090 | Metrics collection |
| Grafana | grafana/grafana | 3000 | Dashboards |

## HTR Pipeline

```
1. Layout Detection (RTMDet, 97MB)
   Input: page image → Output: text region bounding boxes

2. Line Detection (YOLO, 229MB)
   Input: region crop → Output: line bounding boxes

3. Transcription (TrOCR, 1.5GB)
   Input: line crop → Output: text + confidence
```

## Inference Modes

### WASM (Default)
All models run in-browser via ONNX Runtime Web workers:
- `worker-layout.ts` — RTMDet regions
- `worker-detect.ts` — YOLO lines
- `worker-transcribe.ts` — TrOCR encoder/decoder (pool of 1-8 workers)

### GPU Server (Optional)
When a GPU server URL is configured (auto-detected at localhost:8080):
- Frontend sends image data to GPU server via fetch
- Ray Serve handles batching (up to 8 lines per GPU call)
- Three deployments share GPU: Layout (0.25), Lines (0.25), Transcription (0.5)

## Data Storage

### LanceDB Tables
- `archive_catalog` — 3.7M Riksarkivet volume records with FTS index
- `transcriptions` — User transcriptions with per-user isolation

### Image Cache
- LRU cache (max 10 images) prevents memory issues with large volumes
- Images loaded lazily on page navigation
- Evicted images revert to placeholder state
