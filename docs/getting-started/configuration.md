# Configuration

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_MODEL_BASE` | `/models` | Base URL for ONNX model files |
| `VITE_GPU_SERVER` | _(auto-detect)_ | GPU inference server URL |
| `VITE_DISABLE_BACKEND` | `false` | Disable backend features (catalog search) |

## Model Configuration

Models are loaded from the `VITE_MODEL_BASE` URL. For local development, place `.onnx` files in `frontend/public/models/`.

For production (HuggingFace Space), models are loaded from:
```
https://huggingface.co/carpelan/htr-onnx-models/resolve/main
```

### Model Files

| Model | File | Size | Purpose |
|-------|------|------|---------|
| RTMDet | `rtmdet.onnx` | 97 MB | Layout detection |
| YOLO | `yolo.onnx` | 229 MB | Line detection |
| TrOCR | `trocr_encoder.onnx` + `trocr_decoder.onnx` | 1.5 GB | Transcription |

## GPU Server

The frontend auto-detects a GPU server at `localhost:8080`. To use a remote GPU server:

```bash
VITE_GPU_SERVER=https://my-gpu-server.example.com make dev
```

See [lejonet-inference](https://github.com/carpelan/lejonet-inference) for GPU server setup.

## Search Backend

The catalog search feature requires the search backend running at `localhost:8000`.

```bash
VITE_DISABLE_BACKEND=true make dev  # Run without backend
```

See [lejonet-search](https://github.com/carpelan/lejonet-search) for backend setup.
