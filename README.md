# Lejonet HTR

[![CI](https://github.com/carpelan/lejonet/actions/workflows/ci.yml/badge.svg)](https://github.com/carpelan/lejonet/actions/workflows/ci.yml)
[![Docs](https://github.com/carpelan/lejonet/actions/workflows/docs.yml/badge.svg)](https://github.com/carpelan/lejonet/actions/workflows/docs.yml)
[![CodeQL](https://github.com/carpelan/lejonet/actions/workflows/codeql.yml/badge.svg)](https://github.com/carpelan/lejonet/actions/workflows/codeql.yml)
[![Scorecard](https://github.com/carpelan/lejonet/actions/workflows/scorecard.yml/badge.svg)](https://github.com/carpelan/lejonet/actions/workflows/scorecard.yml)

Collaborative handwritten text recognition for historical documents from Sweden's National Archives (Riksarkivet).

**Live demo**: https://huggingface.co/spaces/carpelan/lejonet

| Layer | Technology |
|-------|------------|
| Frontend | Svelte 5, Tailwind CSS 4, ONNX Runtime Web |
| Inference | Ray Serve, ONNX Runtime GPU ([lejonet-inference](https://github.com/carpelan/lejonet-inference)) |
| Search | FastAPI, LanceDB ([lejonet-search](https://github.com/carpelan/lejonet-search)) |
| Docs | Zensical |
| CI/CD | Dagger, Docker, GitHub Actions |

## Quick Start

```bash
make setup   # Install dependencies
make dev     # Start frontend dev server at http://localhost:5173
```

## Full Stack

```bash
# 1. Frontend (this repo)
make dev

# 2. Search backend (separate repo)
cd ../lejonet-search && make dev

# 3. GPU inference (separate repo, requires GPU)
cd ../lejonet-inference && make dev
```

The frontend auto-detects the search backend at localhost:8000 and GPU server at localhost:8080.

## Documentation

- [Docs site](https://carpelan.github.io/lejonet/) — architecture, configuration, getting started

## Features

- **In-browser HTR** — ONNX Runtime Web (WASM) with multi-threaded inference
- **GPU acceleration** — Optional GPU server for faster inference
- **Archive catalog** — Search 3.7M Riksarkivet volumes (requires search backend)
- **Export** — ALTO XML, PAGE XML, JSON, plain text
- **i18n** — Swedish and English

## HTR Pipeline

```
Layout Detection (RTMDet) → Line Detection (YOLO) → Transcription (TrOCR)
```

## Requirements

- [Node.js](https://nodejs.org/) 22+ — frontend runtime

## License

[Apache 2.0](LICENSE)
