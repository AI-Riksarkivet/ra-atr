# WASM HTR App Design

Browser-based handwritten text recognition using Rust WASM + ONNX Runtime. Inspired by [htrflow_app](https://github.com/AI-Riksarkivet/htrflow_app), frontend patterns from [mcp-apps-viewer](https://github.com/Borg93/mcp-apps-viewer).

## Architecture

```
Svelte 5 UI ←→ Web Worker ←→ Rust WASM (ort + image crate)
                                 ↕
                          Cache API (models)
```

- Web Worker isolates inference from UI thread
- Message protocol is the only boundary between UI and WASM
- Models cached persistently via Cache API after first download
- Optional MCP ext-app layer via `@modelcontextprotocol/ext-apps`

## Inference Pipeline

1. **YOLO segmentation** — single forward pass on 640x640 input, NMS, returns line bounding boxes
2. **Line cropping** — crop + resize each line to 384x384, normalize
3. **TrOCR autoregressive decoding** — encoder runs once per line, decoder runs per token, streams tokens via `postMessage`
4. **Reading order** — geometric sort by Y then X coordinate

## Models (Swedish historical only)

| Model | Source | Format | Size |
|-------|--------|--------|------|
| YOLO lines | Riksarkivet/yolov9-lines-within-regions-1 | ONNX INT8 | ~30 MB |
| TrOCR encoder | Riksarkivet/trocr-base-handwritten-hist-swe-2 | ONNX INT8 | ~150 MB |
| TrOCR decoder | (same, split) | ONNX INT8 | ~250 MB |
| Tokenizer | (same) | vocab.json + merges.txt | ~1 MB |

Total download: ~430 MB, cached after first load.

## Model Preparation

Separate Python script (not part of the app):

- YOLO: `model.export(format='onnx', imgsz=640)` → INT8 quantization
- TrOCR: split into encoder + decoder ONNX → INT8 quantization
- Tokenizer: export `vocab.json` + `merges.txt`
- Host as static files (HuggingFace Hub / CDN / GitHub Releases)

## Worker Message Protocol

```typescript
// UI → Worker
{ type: 'load_models' }
{ type: 'run_pipeline', payload: { imageData: ArrayBuffer } }

// Worker → UI
{ type: 'model_status', payload: { model: string, status: 'downloading' | 'cached' | 'loaded', progress?: number } }
{ type: 'segmentation', payload: { lines: { x: number, y: number, w: number, h: number, confidence: number }[] } }
{ type: 'token', payload: { lineIndex: number, token: string } }
{ type: 'line_done', payload: { lineIndex: number, text: string, confidence: number } }
{ type: 'pipeline_done' }
{ type: 'error', payload: { message: string } }
```

## Svelte Frontend

Components:
- `App.svelte` — root, optional MCP init, theme
- `UploadPanel.svelte` — drag & drop image upload
- `DocumentViewer.svelte` — canvas with pan/zoom/overlays (CanvasController pattern from mcp-apps-viewer)
- `TranscriptionPanel.svelte` — streaming text, line by line
- `StatusBar.svelte` — model download progress, pipeline stage
- `ModelManager.svelte` — first-run download UI, cache status

State (Svelte 5 runes):
- `pipelineState`: idle | loading_models | segmenting | transcribing | done
- `lines`: detected lines with bounding boxes and transcription
- `currentLine`: index of line being transcribed
- `currentText`: streaming tokens for current line
- `modelsReady`: whether models are cached/loaded

## Streaming UX

- Segmentation phase: bounding boxes appear on canvas with progress bar
- Transcription phase: current line highlighted, text streams token-by-token in panel
- Completed lines dim on canvas, text finalizes
- Feels like watching an AI read the document line by line

## Build

- Vite 6 + `@sveltejs/vite-plugin-svelte` v5
- `vite-plugin-singlefile` for MCP ext-app mode
- `wasm-pack` for Rust → WASM compilation
- Standalone and MCP builds from same source

## Rust WASM Crate

Key dependencies:
- `ort` — ONNX Runtime bindings (WASM target)
- `image` — image preprocessing (resize, normalize, crop)
- `wasm-bindgen` — JS interop
- `serde` / `serde_json` — message serialization

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `ort` WASM support immature | Fall back to `onnxruntime-web` (JS) — worker boundary unchanged |
| 430 MB model download too large | Progressive loading, clear progress UI, persistent cache |
| WASM 4 GB memory limit | INT8 quantization keeps models small, process one line at a time |
| TrOCR decoding slow on CPU | Streaming UX makes wait tolerable, future WebGPU support |
| BPE tokenizer in Rust for WASM | `tokenizers` crate or manual implementation |
