# RunPod GPU Deployment

## Prerequisites

- `runpodctl` installed and authenticated (`runpodctl config --apiKey YOUR_KEY`)
- Docker image pushed to a registry (Docker Hub, etc.)

## Build and Push

```bash
# Full HTR inference server (layout + lines + transcription)
cd gpu-server
docker build -f Dockerfile.nvidia -t carpelan/lejonet-gpu:nvidia .
docker push carpelan/lejonet-gpu:nvidia

# Lightweight embedding-only server
docker build -f Dockerfile.embed -t carpelan/lejonet-embed:latest .
docker push carpelan/lejonet-embed:latest
```

## Create a Pod

```bash
runpodctl pod create \
  --name lejonet-gpu \
  --image carpelan/lejonet-gpu:nvidia \
  --gpu-id "NVIDIA GeForce RTX 3090" \
  --container-disk-in-gb 50 \
  --ports "8080/http" \
  --env '{"MODE":"simple"}' \
  --cloud-type COMMUNITY
```

The pod is accessible via proxy URL:

```
https://{pod-id}-8080.proxy.runpod.net/health
```

## Connect Frontend

```bash
GPU_SERVER_URL=https://{pod-id}-8080.proxy.runpod.net make serve
```

Or manually connect via the GPU badge in the header UI.

## Useful Commands

```bash
runpodctl pod list              # list pods
runpodctl pod get <id>          # pod details
runpodctl pod stop <id>         # stop (keeps data, stops billing)
runpodctl pod start <id>        # resume
runpodctl pod remove <id>       # delete permanently
runpodctl gpu list              # available GPUs + pricing
```

## Tips

- Use `--cloud-type COMMUNITY` for cheaper GPUs
- Set `--container-disk-in-gb 50` if your image + models need space
- The `MODE=simple` env var skips Ray Serve and runs plain uvicorn — simpler, fewer dependencies
- Ports format: `"8080/http"` for HTTP proxy access, add `"8265/http"` for Ray dashboard
- The embed-only server (`Dockerfile.embed` / `embed_server.py`) is much lighter than the full GPU server — use it when you only need embeddings

## Server Variants

| Image | Purpose | Size | Models |
|-------|---------|------|--------|
| `lejonet-gpu:nvidia` | Full HTR pipeline | ~2GB+ | RTMDet, YOLO, TrOCR |
| `lejonet-embed:latest` | Embedding only | ~500MB | sentence-transformers |

## GPU Selection

Good options for HTR inference:

| GPU | VRAM | Community $/hr | Notes |
|-----|------|----------------|-------|
| RTX 3090 | 24 GB | ~$0.20 | Good value |
| RTX A4000 | 16 GB | ~$0.25 | Reliable availability |
| RTX A6000 | 48 GB | ~$0.33 | Overkill for inference, good for embedding large batches |
