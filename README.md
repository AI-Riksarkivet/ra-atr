# ra-atr

[![CI](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/ci.yml/badge.svg)](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/ci.yml)
[![Docs](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/docs.yml/badge.svg)](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/docs.yml)
[![CodeQL](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/codeql.yml/badge.svg)](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/codeql.yml)
[![Scorecard](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/scorecard.yml/badge.svg)](https://github.com/AI-Riksarkivet/ra-atr/actions/workflows/scorecard.yml)

Collaborative handwritten text recognition for historical documents from Sweden's National Archives (Riksarkivet).

**Live demo**: https://huggingface.co/spaces/carpelan/lejonet

| Layer | Technology |
|-------|------------|
| Frontend | Svelte 5, Tailwind CSS 4, ONNX Runtime Web |
| Docs | Zensical |
| CI/CD | Dagger, Docker, GitHub Actions |

## Quick Start

```bash
make setup   # Install dependencies
make dev     # Start frontend dev server at http://localhost:5173
```

## Documentation

- [Docs site](https://AI-Riksarkivet.github.io/ra-atr/) — architecture, configuration, getting started

## Features

- **In-browser HTR** — ONNX Runtime Web (WASM) with multi-threaded inference
- **GPU acceleration** — Optional GPU server for faster inference
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
