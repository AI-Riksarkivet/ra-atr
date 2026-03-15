# Lejonet GPU Inference Server

GPU-accelerated inference server for Lejonet HTR. Run layout detection, line detection, and transcription on GPU.

## Quick Start

### NVIDIA GPU
```bash
docker build -f Dockerfile.nvidia -t lejonet-gpu:nvidia .
docker run --gpus all -v /path/to/models:/models -p 8080:8080 lejonet-gpu:nvidia
```

### AMD ROCm GPU
```bash
docker build -f Dockerfile.rocm -t lejonet-gpu:rocm .
docker run --device /dev/kfd --device /dev/dri -v /path/to/models:/models -p 8080:8080 lejonet-gpu:rocm
```

### Podman
```bash
podman run --device nvidia.com/gpu=all -v /path/to/models:/models -p 8080:8080 lejonet-gpu:nvidia
```

## Models

Place ONNX model files in the models directory:
- `rtmdet-regions.onnx` — layout detection
- `yolo-lines.onnx` — line detection
- `encoder.onnx` — TrOCR encoder
- `decoder.onnx` — TrOCR decoder
- `tokenizer.json` — BPE tokenizer

## API

- `GET /health` — status, available models, GPU info
- `POST /detect-layout` — image → layout regions
- `POST /detect-lines` — image + region → line bboxes
- `POST /transcribe` — image + line bbox → text
- `POST /process-page` — full pipeline (layout → lines → transcription)

## Architecture

Uses Ray Serve with three GPU deployments:
- **LayoutDetector** (0.25 GPU) — RTMDet region detection
- **LineDetector** (0.25 GPU) — YOLO line detection
- **Transcriber** (0.5 GPU) — TrOCR with dynamic batching (up to 8 lines)

Requests to `/process-page` run the full pipeline with parallel transcription
across lines. Ray Serve handles batching, queuing, and fault tolerance.

Ray Dashboard available at port 8265.

## Development

```bash
uv sync
uv run python -m lejonet_gpu.main
```
