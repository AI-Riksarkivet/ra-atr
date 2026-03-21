# Lejonet HTR

Collaborative handwritten text recognition for historical documents from Sweden's National Archives (Riksarkivet).

Browse archive volumes, load digitized pages, and transcribe with AI — in-browser or on GPU.

**Live demo**: https://huggingface.co/spaces/carpelan/lejonet

## Quick Start

```bash
npm install
make dev       # Start dev server at http://localhost:5173
```

## Features

- **In-browser HTR** — ONNX Runtime Web (WASM) with multi-threaded inference
- **GPU acceleration** — Optional GPU server for faster inference
- **Archive catalog** — Search 3.7M Riksarkivet volumes (requires backend)
- **Export** — ALTO XML, PAGE XML, JSON, plain text
- **i18n** — Swedish and English
- **Model selection** — Full (1.8GB) or Lite mode

## Architecture

```
Lejonet (this repo)          lejonet-inference           lejonet-search
  Svelte 5 frontend    ←→    GPU inference server    ←→   Catalog + transcriptions
  ONNX Runtime WASM          Ray Serve + ONNX GPU        FastAPI + LanceDB
```

| Repo | Purpose |
|------|---------|
| **lejonet** (this) | Svelte frontend, WASM HTR |
| [lejonet-inference](https://github.com/carpelan/lejonet-inference) | GPU inference server (Docker) |
| [lejonet-search](https://github.com/carpelan/lejonet-search) | Search backend + catalog |

## HTR Pipeline

```
Layout Detection (RTMDet) → Line Detection (YOLO) → Transcription (TrOCR)
```

Runs in-browser via WASM or on GPU server. Frontend auto-detects GPU server at localhost:8080.

## Models

| Model | Size | Source |
|-------|------|--------|
| `rtmdet-regions.onnx` | 97 MB | Riksarkivet/rtmdet_regions |
| `yolo-lines.onnx` | 229 MB | Riksarkivet/yolov9-lines-within-regions-1 |
| `encoder.onnx` | 329 MB | Riksarkivet/trocr-base-handwritten-hist-swe-2 |
| `decoder.onnx` | 1.2 GB | Riksarkivet/trocr-base-handwritten-hist-swe-2 |
| `tokenizer.json` | 2 MB | Riksarkivet/trocr-base-handwritten-hist-swe-2 |

Stored on [HuggingFace](https://huggingface.co/carpelan/htr-onnx-models). Auto-downloaded on first use.

## Deploy to HuggingFace Space

```bash
make deploy
```

## Development

```bash
make check   # Format + typecheck
make help    # Show all targets
```

See [CLAUDE.md](CLAUDE.md) for the full development guide.

## License

[Apache 2.0](LICENSE)
