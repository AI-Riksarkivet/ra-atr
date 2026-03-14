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

## Development

```bash
uv sync
uv run uvicorn lejonet_gpu.app:app --reload --port 8080
```
