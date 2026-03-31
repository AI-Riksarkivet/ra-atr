# Dual-Model Support: Swedish Lion + Tridis

**Date:** 2026-03-31
**Status:** Approved

## Problem

The app currently supports a single hardcoded TrOCR model (Swedish Lion via `carpelan/htr-onnx-models`). We want to also support Tridis (`carpelan/tridis`), a medieval-era TrOCR model with a different architecture (larger encoder, different vocab). Users should be able to choose which model to use.

## Design

### Model Profiles

Define model profiles in `model-config.ts` as a map:

```ts
type ModelProfile = {
  id: string;
  name: string;          // "Swedish Lion", "Tridis (Medieval)"
  description: string;
  baseUrl: string;       // HuggingFace resolve URL
};
```

Each profile shares the same file names (`encoder.onnx`, `decoder.onnx`, `tokenizer.json`, `yolo-lines.onnx`, `rtmdet-regions.onnx`) but from different HF repos.

Default model base (`/models` or `VITE_MODEL_BASE`) continues to work for local/dev — profiles only change the base URL.

### Start Screen Model Picker

Add a model selection step on the start screen, before the existing GPU/WASM mode picker. User picks "Swedish Lion" or "Tridis (Medieval)", then proceeds to mode selection and model download.

### Persistence

Model choice stored in `localStorage` with key `ra-atr-model`. Read on app start to pre-select. Changing model requires returning to the start screen.

### Cache Namespacing

Browser cache keys namespaced per model profile:
- `htr-models-swedish-lion`
- `htr-models-tridis`

This allows both models to coexist in browser cache without conflicts.

### Auto-Detect KV Cache Architecture

Remove hardcoded `NUM_LAYERS`, `NUM_HEADS`, `HEAD_DIM` from `worker-transcribe.ts`. Instead, detect at ONNX session load time:

- Count `past.*.key` input names to get `NUM_LAYERS`
- Read shape of `past.0.key` to get `[1, NUM_HEADS, 0, HEAD_DIM]`

This makes the decoder work with any TrOCR-family model without code changes.

### Worker Protocol

No changes needed. `load_models` already accepts `modelUrls` from the main thread. The main thread passes different URLs based on the selected profile.

### Unchanged

- Image preprocessing (same 384x384 TrOCR input)
- BpeTokenizer class (same HF tokenizer.json format)
- Greedy decoding with ngram blocking
- Export formats
- Worker pool management

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/lib/model-config.ts` | Add model profiles, selected model state, profile-aware `getModelUrls()` |
| `frontend/src/lib/model-cache.ts` | Accept cache name parameter for namespacing |
| `frontend/src/worker-transcribe.ts` | Auto-detect KV cache dims, remove hardcoded constants |
| `frontend/src/lib/worker-state.svelte.ts` | Pass selected model's URLs to workers |
| `frontend/src/routes/+page.svelte` | Add model picker before mode picker |
| `frontend/src/lib/stores/app-state.svelte.ts` | Track selected model in app state |
