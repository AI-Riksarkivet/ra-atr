# GPU Embedding Plan — ROCm + AMD GPU

**Goal:** Re-run archive catalog ingestion with vector embeddings using AMD GPU acceleration. Current CPU rate is ~180 rows/sec (12h for 7.6M rows). GPU should bring this to ~5K-10K rows/sec (~15-30 min).

## Prerequisites

### 1. Install ROCm

Check AMD GPU model first:
```bash
lspci | grep -i amd | grep -i vga
```

Install ROCm (Ubuntu):
```bash
# Follow https://rocm.docs.amd.com/en/latest/deploy/linux/installer/install.html
sudo apt install rocm-hip-runtime rocm-dev
# Verify:
rocminfo
```

### 2. Install PyTorch with ROCm

```bash
cd backend
# Remove CPU-only torch
.venv/bin/pip uninstall torch torchvision -y
# Install ROCm version (check latest at https://pytorch.org/get-started/locally/)
.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/rocm6.3
# Verify:
.venv/bin/python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

### 3. Run Embedding Ingestion

```bash
cd backend && .venv/bin/python ingest_catalog.py \
  /home/m/Downloads/Riksarkivet-2022-12-16 \
  --db-path /tmp/lancedb \
  --batch-size 50000
```

This will overwrite the existing FTS-only table with one that has both FTS and vector columns.

### 4. Rebuild FTS Index

The ingestion script rebuilds FTS automatically at the end.

## Optimizing Embedding Speed

If still slow, modify `embed_batch` in `ingest_catalog.py` to use larger encode batch sizes:

```python
def embed_batch(embedder, texts: list[str]) -> list[list[float]]:
    prefixed = [f"passage: {t}" for t in texts]
    vecs = embedder.encode(prefixed, normalize_embeddings=True, batch_size=256)
    return [v.tolist() for v in vecs]
```

The `batch_size` in `encode()` controls how many texts are sent to GPU at once. Default is 32. With 8GB+ VRAM, 256 should work for e5-small (118M params).

## Expected Timing

| Setup | Rate | Total Time |
|---|---|---|
| CPU only | ~180 rows/sec | ~12 hours |
| ROCm GPU (batch_size=32) | ~3K rows/sec | ~40 min |
| ROCm GPU (batch_size=256) | ~8K rows/sec | ~16 min |

## After Embedding

Vector search will work via `GET /catalog/search?q=...&mode=vector` or `mode=hybrid`. The vector search enables semantic queries like "court records from southern Sweden" that FTS can't handle.
