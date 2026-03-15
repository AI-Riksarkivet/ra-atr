# Lejonet HTR

Collaborative handwritten text recognition app for historical documents from Sweden's National Archives (Riksarkivet).

## Features

- **In-browser HTR** — WASM-powered ONNX Runtime for layout detection, line detection, and transcription
- **GPU acceleration** — Optional Docker-based GPU server with Ray Serve batching
- **Archive catalog** — Search 3.7M volumes from Riksarkivet's metadata
- **Auto-save** — Transcriptions saved to LanceDB with per-user isolation
- **Multi-model pipeline** — RTMDet (layout) → YOLO (lines) → TrOCR (transcription)

## Quick Start

```bash
# Install
make install

# Start backend + frontend
make serve

# Open http://localhost:5173
```

## Architecture

```
Frontend (Svelte 5) ←→ Backend (FastAPI + LanceDB) ←→ GPU Server (Ray Serve)
       ↕                        ↕
  WASM workers          Archive catalog (3.7M volumes)
  OR GPU server         Transcription storage
```

See [Architecture](architecture/overview.md) for details.
