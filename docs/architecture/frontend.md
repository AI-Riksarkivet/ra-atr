# Frontend Architecture

## Overview

The frontend is a Svelte 5 SPA using ONNX Runtime Web for in-browser handwritten text recognition.

## Technology Stack

| Technology | Purpose |
|-----------|---------|
| Svelte 5 | UI framework (runes: `$state`, `$derived`, `$effect`) |
| Tailwind CSS | Styling |
| shadcn-svelte | UI components |
| ONNX Runtime Web | In-browser ML inference (WASM backend) |
| Web Workers | Background inference threads |

## Key Modules

### State Management
- `frontend/src/lib/stores/app-state.svelte.ts` — Centralized app state with auto-save and LRU cache
- `frontend/src/lib/worker-state.svelte.ts` — HTR worker orchestration and GPU routing

### Workers
- `frontend/src/worker-layout.ts` — RTMDet layout detection
- `frontend/src/worker-detect.ts` — YOLO line detection
- `frontend/src/worker-transcribe.ts` — TrOCR transcription (pooled, 1-8 workers)

### Components
- `frontend/src/lib/components/TranscriptionPanel.svelte` — Right panel (workspace tree)
- `frontend/src/lib/components/CatalogPanel.svelte` — Left panel (archive search)
- `frontend/src/routes/viewer/+page.svelte` — Main workspace page

## Inference Pipeline

```
Image → Layout Detection (RTMDet) → Line Detection (YOLO) → Transcription (TrOCR) → Text
```

Runs either in-browser (WASM workers) or on a remote GPU server, auto-detected at `localhost:8080`.
