# ra-atr — Development Guide

## Quick Start

```bash
make setup    # Install dependencies
make dev      # Start dev server at http://localhost:5173
make quality  # Format + typecheck
make deploy   # Build and deploy to HF Space
```

## Architecture

```
ra-atr/
├── frontend/             # Svelte 5 frontend (WASM HTR inference)
│   ├── src/
│   ├── static/
│   └── public/
├── space/                # HF Space deployment config
├── docs/                 # Documentation (zensical)
├── .dagger/              # CI/CD pipeline (Go)
├── .docker/              # Dockerfiles
└── .github/              # GitHub workflows
```

### Related Repos

| Repo | Purpose |
|------|---------|
| [lejonet-inference](https://github.com/carpelan/lejonet-inference) | GPU inference server (Ray Serve + ONNX Runtime) |
| [lejonet-search](https://github.com/carpelan/lejonet-search) | Search backend (FastAPI + LanceDB) |

### HTR Pipeline

```
Layout Detection (RTMDet) → Line Detection (YOLO) → Transcription (TrOCR)
```

Runs either in-browser (WASM) or on GPU server. Frontend auto-detects GPU server at localhost:8080.

## Coding Guidelines

### Frontend (Svelte 5)
- **Framework**: Svelte 5 with runes ($state, $derived, $effect)
- **Styling**: Tailwind CSS with shadcn-svelte components
- **State**: app-state.svelte.ts (centralized)
- **Workers**: Web Workers for ONNX inference (detect, transcribe, layout)

### Git Conventions
- **Commits**: Conventional Commits (feat, fix, docs, refactor, test, chore)
- **No co-authored-by**: Don't add Claude references to commits

## Key Files

- `frontend/src/lib/stores/app-state.svelte.ts` — Core state management, auto-save, LRU cache
- `frontend/src/lib/worker-state.svelte.ts` — HTR worker orchestration, GPU routing
- `frontend/src/lib/gpu-client.ts` — GPU server client with auto-detection
- `frontend/src/lib/model-config.ts` — Model URL configuration
- `frontend/src/worker-detect.ts` — YOLO line detection worker
- `frontend/src/worker-transcribe.ts` — TrOCR transcription worker
- `frontend/src/worker-layout.ts` — RTMDet layout detection worker
- `frontend/src/lib/components/TranscriptionPanel.svelte` — Right panel (workspace tree)
- `frontend/src/lib/components/CatalogPanel.svelte` — Left panel (archive search)
- `frontend/src/routes/viewer/+page.svelte` — Main workspace page

## Common Tasks

### Add a new ONNX model
1. Upload `.onnx` file to `carpelan/htr-onnx-models` on HuggingFace
2. Add worker in `frontend/src/worker-*.ts`
3. Update `frontend/src/lib/worker-state.svelte.ts` with loading logic
4. Update `frontend/src/lib/model-config.ts` with URL

### Deploy to HuggingFace Space
```bash
make deploy
```

This builds with `VITE_MODEL_BASE` pointing to the HF model repo and uploads to the static Space.
