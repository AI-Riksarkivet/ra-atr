# Lejonet HTR — Development Guide

## Quick Start

```bash
npm install
make dev      # Start dev server at http://localhost:5173
make check    # Format + typecheck
make deploy   # Build and deploy to HF Space
```

## Architecture

```
lejonet/
├── src/                  # Svelte 5 frontend (WASM HTR inference)
├── public/               # Static assets
├── space/                # HF Space deployment config
├── docs/plans/           # Design documents
└── scripts/              # Model export scripts
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

- `src/lib/stores/app-state.svelte.ts` — Core state management, auto-save, LRU cache
- `src/lib/worker-state.svelte.ts` — HTR worker orchestration, GPU routing
- `src/lib/gpu-client.ts` — GPU server client with auto-detection
- `src/lib/model-config.ts` — Model URL configuration
- `src/worker-detect.ts` — YOLO line detection worker
- `src/worker-transcribe.ts` — TrOCR transcription worker
- `src/worker-layout.ts` — RTMDet layout detection worker
- `src/lib/components/TranscriptionPanel.svelte` — Right panel (workspace tree)
- `src/lib/components/CatalogPanel.svelte` — Left panel (archive search)
- `src/routes/viewer/+page.svelte` — Main workspace page

## Common Tasks

### Add a new ONNX model
1. Upload `.onnx` file to `carpelan/htr-onnx-models` on HuggingFace
2. Add worker in `src/worker-*.ts`
3. Update `src/lib/worker-state.svelte.ts` with loading logic
4. Update `src/lib/model-config.ts` with URL

### Deploy to HuggingFace Space
```bash
make deploy
```

This builds with `VITE_MODEL_BASE` pointing to the HF model repo and uploads to the static Space.
