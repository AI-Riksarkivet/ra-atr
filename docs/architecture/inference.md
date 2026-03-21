# Inference Server

The GPU inference server runs as a separate service for accelerated HTR processing.

## Repository

**[lejonet-inference](https://github.com/carpelan/lejonet-inference)** — Ray Serve + ONNX Runtime GPU server

## Overview

| Component | Technology |
|-----------|-----------|
| Framework | Ray Serve |
| Runtime | ONNX Runtime (CUDA / ROCm) |
| API | FastAPI |
| Port | 8080 |

## Deployments

The server runs three Ray Serve deployments sharing a single GPU:

| Deployment | GPU Share | Model | Purpose |
|-----------|-----------|-------|---------|
| Layout | 0.25 | RTMDet | Text region detection |
| Lines | 0.25 | YOLO | Line segmentation |
| Transcription | 0.50 | TrOCR | Text recognition |

## Integration

The frontend auto-detects the GPU server at `localhost:8080` and routes inference requests there when available. When unavailable, inference falls back to in-browser WASM workers.
