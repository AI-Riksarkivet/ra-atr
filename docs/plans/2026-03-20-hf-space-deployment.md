# Hugging Face Spaces Deployment

## Overview

The Svelte frontend is deployed as a **static** Hugging Face Space. This is required because Docker Spaces strip custom headers via the HF proxy, preventing `crossOriginIsolated` (needed for `SharedArrayBuffer` / multi-threaded WASM).

## Space Configuration

The `space/README.md` must contain:

```yaml
---
title: Lejonet HTR
emoji: 🦁
colorFrom: yellow
colorTo: red
sdk: static
custom_headers:
  cross-origin-embedder-policy: credentialless
  cross-origin-opener-policy: same-origin
  cross-origin-resource-policy: cross-origin
---
```

### Why these headers?

- **COEP `credentialless`** (not `require-corp`) — so cross-origin resources (like HF model downloads) still work without explicit CORP headers.
- **COOP `same-origin`** + COEP together enable `crossOriginIsolated`, which unlocks `SharedArrayBuffer` for multi-threaded ONNX Runtime WASM.

## Deployment Steps

```bash
# 1. Build the frontend
npm run build

# 2. Copy build output into space/
cp -r build/* space/build/

# 3. Push to HF Space
#    Option A: git subtree
git subtree push --prefix space hf main

#    Option B: huggingface-cli
cd space && huggingface-cli upload YOUR_USERNAME/lejonet-htr .
```

## Key Implementation Details

### WASM files served from jsDelivr CDN

HF's LFS redirects WASM files to a CDN without proper CORS headers. In production, `ort.env.wasm.wasmPaths` is set to:

```
https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/
```

### SvelteKit routing fix

Static hosting doesn't support SPA routing natively. Two fixes are in place:

1. **Inline redirect script** in `app.html` handles `/index.html` → `/`
2. **`prerender = true`** is set for the `/viewer` route so SvelteKit generates `viewer/index.html`

## Why not Docker?

Docker Spaces use an HF reverse proxy that strips custom response headers. This makes it impossible to set COEP/COOP headers, which means `crossOriginIsolated` is always `false` and `SharedArrayBuffer` is unavailable — breaking multi-threaded WASM inference.
