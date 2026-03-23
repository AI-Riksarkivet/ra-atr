# WebGPU Inference via onnxruntime-web — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Rust/tract WASM inference path with a pure TypeScript worker using onnxruntime-web + WebGPU, keeping the existing Svelte UI and worker message protocol unchanged.

**Architecture:** A new `src/worker-ortw.ts` worker implements the same message protocol as the existing `src/worker.ts` but uses `onnxruntime-web/webgpu` for inference. The preprocessing (letterbox, normalize), YOLO post-processing (NMS, coord transform), and TrOCR autoregressive decoding are ported from Rust to TypeScript. A runtime flag selects which worker to use. The Rust crate stays untouched.

**Tech Stack:** onnxruntime-web (WebGPU EP with WASM fallback), TypeScript, Svelte 5, Vite 7

**Key API patterns:**
```ts
import * as ort from 'onnxruntime-web/webgpu';
const session = await ort.InferenceSession.create(modelUrl, {
  executionProviders: ['webgpu', 'wasm'],  // fallback chain
});
const feeds = { input_name: new ort.Tensor('float32', data, [1, 3, 640, 640]) };
const results = await session.run(feeds);
const output = results['output_name'];  // ort.Tensor with .data and .dims
```

---

### Task 1: Install onnxruntime-web and configure Vite

**Files:**
- Modify: `/home/m/ra-atr/package.json`
- Modify: `/home/m/ra-atr/vite.config.ts`

**Step 1: Install onnxruntime-web**

Run:
```bash
npm install onnxruntime-web
```

**Step 2: Configure Vite to serve ONNX Runtime WASM files**

onnxruntime-web ships `.wasm` files that must be accessible at runtime. Vite needs to exclude them from bundling in the worker.

Edit `/home/m/ra-atr/vite.config.ts` — add `optimizeDeps` and `assetsInclude` config:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'path';

const isMcp = process.env.VITE_MCP === 'true';

export default defineConfig({
  plugins: [
    svelte(),
    wasm(),
    ...(isMcp ? [viteSingleFile()] : []),
  ],
  worker: {
    plugins: () => [wasm()],
  },
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  server: {
    watch: {
      ignored: ['**/target/**', '**/models/**'],
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
});
```

**Step 3: Copy ort WASM assets to public**

onnxruntime-web needs its `.wasm` files served from a known path. Copy them:

```bash
cp node_modules/onnxruntime-web/dist/*.wasm public/
```

And set the WASM paths in the worker (done in Task 3).

**Step 4: Verify install**

Run:
```bash
npx vite build 2>&1 | tail -5
```

Expected: build succeeds without errors.

**Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts public/*.wasm
git commit -m "add onnxruntime-web dependency and vite config"
```

---

### Task 2: Port image preprocessing to TypeScript

**Files:**
- Create: `/home/m/ra-atr/src/lib/preprocessing.ts`

These are pure-CPU functions that prepare image pixels for YOLO and TrOCR. They replace `crates/htr-wasm/src/preprocessing.rs`.

**Step 1: Write preprocessing module**

```ts
/**
 * Letterbox-resize image to target size for YOLO.
 * Returns [Float32Array in NCHW format, scale, padX, padY].
 */
export function preprocessYolo(
  imageData: ImageData,
  targetSize: number,
): { tensor: Float32Array; scale: number; padX: number; padY: number } {
  const { width: origW, height: origH } = imageData;
  const scale = Math.min(targetSize / origW, targetSize / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = (targetSize - newW) / 2;
  const padY = (targetSize - newH) / 2;

  // Use OffscreenCanvas for resize
  const canvas = new OffscreenCanvas(targetSize, targetSize);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#808080'; // gray padding (YOLO convention)
  ctx.fillRect(0, 0, targetSize, targetSize);

  // Draw resized image onto canvas
  const srcCanvas = new OffscreenCanvas(origW, origH);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(srcCanvas, padX, padY, newW, newH);

  const resized = ctx.getImageData(0, 0, targetSize, targetSize);
  const pixels = resized.data; // RGBA uint8

  // Convert to NCHW float32, normalized to [0, 1]
  const chw = new Float32Array(3 * targetSize * targetSize);
  for (let i = 0; i < targetSize * targetSize; i++) {
    chw[i] = pixels[i * 4] / 255.0;                           // R
    chw[targetSize * targetSize + i] = pixels[i * 4 + 1] / 255.0; // G
    chw[2 * targetSize * targetSize + i] = pixels[i * 4 + 2] / 255.0; // B
  }

  return { tensor: chw, scale, padX, padY };
}

/**
 * Resize and normalize image for TrOCR encoder.
 * Returns Float32Array in NCHW [1, 3, 384, 384] normalized with mean=0.5, std=0.5.
 */
export function preprocessTrOCR(
  imageData: ImageData,
): Float32Array {
  const size = 384;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;

  // Draw source image resized to 384x384
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);
  ctx.drawImage(srcCanvas, 0, 0, size, size);

  const resized = ctx.getImageData(0, 0, size, size);
  const pixels = resized.data;

  // NCHW, normalize: (pixel/255 - 0.5) / 0.5 = pixel/127.5 - 1.0
  const chw = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) {
    chw[i] = pixels[i * 4] / 127.5 - 1.0;
    chw[size * size + i] = pixels[i * 4 + 1] / 127.5 - 1.0;
    chw[2 * size * size + i] = pixels[i * 4 + 2] / 127.5 - 1.0;
  }

  return chw;
}

/**
 * Decode an image ArrayBuffer into ImageData using OffscreenCanvas.
 */
export async function decodeImage(buffer: ArrayBuffer): Promise<ImageData> {
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

/**
 * Crop a region from ImageData.
 */
export function cropImageData(
  imageData: ImageData,
  x: number,
  y: number,
  w: number,
  h: number,
): ImageData {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return ctx.getImageData(x, y, w, h);
}
```

**Step 2: Verify build**

Run:
```bash
npx vite build 2>&1 | tail -5
```

Expected: build succeeds.

**Step 3: Commit**

```bash
git add src/lib/preprocessing.ts
git commit -m "add TypeScript image preprocessing for YOLO and TrOCR"
```

---

### Task 3: Port YOLO post-processing to TypeScript

**Files:**
- Create: `/home/m/ra-atr/src/lib/yolo.ts`

This handles parsing the raw YOLO output tensor, applying confidence threshold, coordinate conversion from padded 640x640 back to original image coords, and NMS. Ported from `crates/htr-wasm/src/yolo.rs`.

**Step 1: Write YOLO module**

```ts
import type { BBox } from './types';

export interface Detection extends BBox {
  classId: number;
}

/**
 * Parse YOLO output tensor and apply NMS.
 *
 * Output shape: [1, 4+C(+32), N] where N=8400 for YOLOv9.
 * For seg models: 4 box + 1 class + 32 mask = 37 features.
 * For det models: 4 box + C classes.
 */
export function parseYoloOutput(
  outputData: Float32Array,
  outputDims: readonly number[],
  origW: number,
  origH: number,
  scale: number,
  padX: number,
  padY: number,
  confThreshold: number,
  iouThreshold: number,
): Detection[] {
  const numFeatures = outputDims[1];
  const numDetections = outputDims[2];

  // Determine number of classes
  const numClasses = numFeatures > 36
    ? numFeatures - 4 - 32  // seg model: subtract box + mask coefficients
    : numFeatures - 4;       // pure det model

  const detections: Detection[] = [];

  for (let j = 0; j < numDetections; j++) {
    const cx = outputData[0 * numDetections + j]; // not needed, use direct indexing
    // Output is [1, features, detections] in row-major
    const idx = (f: number) => f * numDetections + j;

    const cxVal = outputData[idx(0)];
    const cyVal = outputData[idx(1)];
    const w = outputData[idx(2)];
    const h = outputData[idx(3)];

    // Find best class
    let bestClass = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const score = outputData[idx(4 + c)];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }

    if (bestScore < confThreshold) continue;

    // Convert from padded 640x640 to original image coords
    const x = ((cxVal - w / 2) - padX) / scale;
    const y = ((cyVal - h / 2) - padY) / scale;
    const bw = w / scale;
    const bh = h / scale;

    detections.push({
      x: Math.max(0, Math.min(x, origW)),
      y: Math.max(0, Math.min(y, origH)),
      w: Math.min(bw, origW - x),
      h: Math.min(bh, origH - y),
      confidence: bestScore,
      classId: bestClass,
    });
  }

  nms(detections, iouThreshold);
  return detections;
}

function nms(detections: Detection[], iouThreshold: number): void {
  detections.sort((a, b) => b.confidence - a.confidence);
  const keep = new Array(detections.length).fill(true);

  for (let i = 0; i < detections.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < detections.length; j++) {
      if (!keep[j]) continue;
      if (iou(detections[i], detections[j]) > iouThreshold) {
        keep[j] = false;
      }
    }
  }

  let writeIdx = 0;
  for (let i = 0; i < detections.length; i++) {
    if (keep[i]) {
      detections[writeIdx++] = detections[i];
    }
  }
  detections.length = writeIdx;
}

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - intersection;

  return union <= 0 ? 0 : intersection / union;
}
```

**Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src/lib/yolo.ts
git commit -m "add TypeScript YOLO post-processing with NMS"
```

---

### Task 4: Port BPE tokenizer to TypeScript

**Files:**
- Create: `/home/m/ra-atr/src/lib/tokenizer.ts`

Port of `crates/htr-wasm/src/tokenizer.rs`. Parses HuggingFace `tokenizer.json`, handles RoBERTa Ġ→space mapping, provides `decodeToken(id)` and `decode(ids)`.

**Step 1: Write tokenizer module**

```ts
/**
 * Minimal BPE tokenizer for TrOCR decoding.
 * Parses HuggingFace tokenizer.json format.
 */
export class BpeTokenizer {
  private vocab: Map<number, string>;
  readonly eosTokenId: number;
  readonly bosTokenId: number;
  readonly padTokenId: number;

  constructor(tokenizerJson: string) {
    const data = JSON.parse(tokenizerJson);
    this.vocab = new Map();

    // Build id→token map from the vocab object
    const vocabObj: Record<string, number> = data.model?.vocab ?? {};
    for (const [token, id] of Object.entries(vocabObj)) {
      this.vocab.set(id, token);
    }

    // Also include added_tokens
    const addedTokens: Array<{ id: number; content: string }> = data.added_tokens ?? [];
    for (const t of addedTokens) {
      this.vocab.set(t.id, t.content);
    }

    // RoBERTa special token IDs
    this.bosTokenId = 0;
    this.padTokenId = 1;
    this.eosTokenId = 2;
  }

  /** Decode a single token ID to text. Returns null for special tokens. */
  decodeToken(id: number): string | null {
    if (id === this.bosTokenId || id === this.eosTokenId || id === this.padTokenId) {
      return null;
    }
    const token = this.vocab.get(id);
    if (!token) return null;
    // RoBERTa uses Ġ (U+0120) for leading space
    return token.replace(/\u0120/g, ' ');
  }

  /** Decode a sequence of token IDs to text. Skips BOS (first token). */
  decode(ids: number[]): string {
    let result = '';
    for (const id of ids) {
      const text = this.decodeToken(id);
      if (text !== null) result += text;
    }
    return result;
  }
}
```

**Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src/lib/tokenizer.ts
git commit -m "add TypeScript BPE tokenizer for TrOCR decoding"
```

---

### Task 5: Write the onnxruntime-web worker

**Files:**
- Create: `/home/m/ra-atr/src/worker-ortw.ts`

This is the main worker that replaces `src/worker.ts` for the WebGPU path. Same message protocol, but uses `ort.InferenceSession` instead of WASM imports. The key difference: ort-web handles dynamic shapes natively, so the decoder doesn't need rebuilding per token.

**Step 1: Write the worker**

```ts
import * as ort from 'onnxruntime-web/webgpu';
import { downloadAndCacheModel } from './lib/model-cache';
import { preprocessYolo, preprocessTrOCR, decodeImage, cropImageData } from './lib/preprocessing';
import { parseYoloOutput } from './lib/yolo';
import { BpeTokenizer } from './lib/tokenizer';

// Configure ort WASM paths (fallback when no WebGPU)
ort.env.wasm.wasmPaths = '/';

const MODEL_URLS = {
  yolo: '/models/yolo-lines.onnx',
  trOcrEncoder: '/models/encoder.onnx',
  trOcrDecoder: '/models/decoder.onnx',
  tokenizer: '/models/tokenizer.json',
};

let yoloSession: ort.InferenceSession | null = null;
let encoderSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let tokenizer: BpeTokenizer | null = null;
let ready = false;

// Detect WebGPU availability
async function getExecutionProviders(): Promise<string[]> {
  try {
    const gpu = (navigator as any).gpu;
    if (gpu) {
      const adapter = await gpu.requestAdapter();
      if (adapter) return ['webgpu', 'wasm'];
    }
  } catch {}
  return ['wasm'];
}

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        const eps = await getExecutionProviders();
        const backend = eps[0];
        self.postMessage({
          type: 'model_status',
          payload: { model: 'backend', status: backend === 'webgpu' ? 'WebGPU' : 'WASM (no WebGPU)' },
        });

        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({
            type: 'model_status',
            payload: { model: p.model, status: 'downloading', progress: p.percent },
          });
        };

        // Download all models in parallel
        const [yoloBytes, encoderBytes, decoderBytes, tokenizerBytes] = await Promise.all([
          downloadAndCacheModel(MODEL_URLS.yolo, 'yolo', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrEncoder, 'trocr-encoder', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrDecoder, 'trocr-decoder', progress),
          downloadAndCacheModel(MODEL_URLS.tokenizer, 'tokenizer', progress),
        ]);

        // Create sessions (ort-web loads from ArrayBuffer)
        const sessionOpts: ort.InferenceSession.SessionOptions = {
          executionProviders: eps,
        };

        yoloSession = await ort.InferenceSession.create(yoloBytes, sessionOpts);
        self.postMessage({ type: 'model_status', payload: { model: 'yolo', status: 'loaded' } });

        encoderSession = await ort.InferenceSession.create(encoderBytes, sessionOpts);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-encoder', status: 'loaded' } });

        decoderSession = await ort.InferenceSession.create(decoderBytes, sessionOpts);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr-decoder', status: 'loaded' } });

        tokenizer = new BpeTokenizer(new TextDecoder().decode(tokenizerBytes));
        self.postMessage({ type: 'model_status', payload: { model: 'tokenizer', status: 'loaded' } });

        ready = true;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'run_pipeline': {
        if (!ready || !yoloSession || !encoderSession || !decoderSession || !tokenizer) {
          throw new Error('Models not loaded');
        }

        const imageData = await decodeImage(e.data.payload.imageData);
        const { width: origW, height: origH } = imageData;

        // --- YOLO segmentation ---
        const { tensor: yoloInput, scale, padX, padY } = preprocessYolo(imageData, 640);
        const yoloTensor = new ort.Tensor('float32', yoloInput, [1, 3, 640, 640]);

        const yoloInputName = yoloSession.inputNames[0];
        const yoloResult = await yoloSession.run({ [yoloInputName]: yoloTensor });
        const yoloOutputName = yoloSession.outputNames[0];
        const yoloOutput = yoloResult[yoloOutputName];

        let detections = parseYoloOutput(
          yoloOutput.data as Float32Array,
          yoloOutput.dims,
          origW,
          origH,
          scale,
          padX,
          padY,
          0.25,
          0.45,
        );

        // Sort by Y then X (reading order)
        detections.sort((a, b) => a.y - b.y || a.x - b.x);

        self.postMessage({ type: 'segmentation', payload: { lines: detections } });

        // --- TrOCR transcription ---
        for (let i = 0; i < detections.length; i++) {
          const det = detections[i];
          const x = Math.max(0, Math.round(det.x));
          const y = Math.max(0, Math.round(det.y));
          const w = Math.max(1, Math.min(Math.round(det.w), origW - x));
          const h = Math.max(1, Math.min(Math.round(det.h), origH - y));

          const cropped = cropImageData(imageData, x, y, w, h);
          const encoderInput = preprocessTrOCR(cropped);

          // Run encoder
          const pixelValues = new ort.Tensor('float32', encoderInput, [1, 3, 384, 384]);
          const encResult = await encoderSession.run({
            [encoderSession.inputNames[0]]: pixelValues,
          });
          const hiddenStates = encResult[encoderSession.outputNames[0]];

          // Autoregressive decoding
          const decoderStartId = 2; // </s> token
          const maxLength = 256;
          const tokenIds: number[] = [decoderStartId];

          for (let step = 0; step < maxLength; step++) {
            const seqLen = tokenIds.length;
            const inputIds = new ort.Tensor(
              'int64',
              BigInt64Array.from(tokenIds.map(id => BigInt(id))),
              [1, seqLen],
            );
            const attentionMask = new ort.Tensor(
              'int64',
              new BigInt64Array(seqLen).fill(1n),
              [1, seqLen],
            );

            const decResult = await decoderSession.run({
              input_ids: inputIds,
              attention_mask: attentionMask,
              encoder_hidden_states: hiddenStates,
            });

            // Get logits: [1, seqLen, vocabSize]
            const logits = decResult[decoderSession.outputNames[0]];
            const logitsData = logits.data as Float32Array;
            const vocabSize = logits.dims[2];

            // Argmax over last token's logits
            const offset = (seqLen - 1) * vocabSize;
            let bestToken = 0;
            let bestScore = -Infinity;
            for (let v = 0; v < vocabSize; v++) {
              if (logitsData[offset + v] > bestScore) {
                bestScore = logitsData[offset + v];
                bestToken = v;
              }
            }

            if (bestToken === tokenizer.eosTokenId) break;

            const tokenText = tokenizer.decodeToken(bestToken);
            if (tokenText !== null) {
              self.postMessage({
                type: 'token',
                payload: { lineIndex: i, token: tokenText },
              });
            }

            tokenIds.push(bestToken);
          }

          const fullText = tokenizer.decode(tokenIds.slice(1));
          self.postMessage({
            type: 'line_done',
            payload: { lineIndex: i, text: fullText, confidence: det.confidence },
          });
        }

        self.postMessage({ type: 'pipeline_done' });
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
```

**Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -10
```

Expected: builds without errors. The worker should be tree-shaken separately.

**Step 3: Commit**

```bash
git add src/worker-ortw.ts
git commit -m "add onnxruntime-web worker with WebGPU inference"
```

---

### Task 6: Wire up worker selection in worker-state

**Files:**
- Modify: `/home/m/ra-atr/src/lib/worker-state.svelte.ts`

Add a constructor parameter to select the inference backend. The worker message protocol is identical, so only the `new Worker(...)` URL changes.

**Step 1: Update HTRWorkerState**

Change the constructor to accept a `backend` option:

```ts
export class HTRWorkerState {
  // ... existing $state fields ...

  constructor(backend: 'wasm' | 'webgpu' = 'webgpu') {
    const workerUrl = backend === 'webgpu'
      ? new URL('../worker-ortw.ts', import.meta.url)
      : new URL('../worker.ts', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.onmessage = (e) => this.handleMessage(e);
  }

  // ... rest unchanged ...
}
```

**Step 2: Verify build**

```bash
npx vite build 2>&1 | tail -5
```

**Step 3: Commit**

```bash
git add src/lib/worker-state.svelte.ts
git commit -m "add backend selection to HTRWorkerState constructor"
```

---

### Task 7: Add backend selector to the UI

**Files:**
- Modify: `/home/m/ra-atr/src/App.svelte`

Add a simple toggle in the header or ModelManager so users can pick WebGPU vs WASM before loading models. Once models are loaded, the choice is locked.

**Step 1: Add backend state and selector**

In `App.svelte`, add a `backend` state and pass it to `HTRWorkerState`. Show a small selector before models are loaded:

In the `<script>` section, change:
```ts
const htr = new HTRWorkerState();
```
to:
```ts
let backend = $state<'wasm' | 'webgpu'>('webgpu');
let htr = $state(new HTRWorkerState(backend));

function switchBackend(newBackend: 'wasm' | 'webgpu') {
  if (htr.modelsReady) return; // Can't switch after load
  htr.destroy();
  backend = newBackend;
  htr = new HTRWorkerState(backend);
}
```

In the `<header>`, after the `<h1>`, add:
```svelte
{#if !htr.modelsReady}
  <div class="backend-selector">
    <button
      class:active={backend === 'webgpu'}
      onclick={() => switchBackend('webgpu')}
    >WebGPU</button>
    <button
      class:active={backend === 'wasm'}
      onclick={() => switchBackend('wasm')}
    >WASM</button>
  </div>
{:else}
  <span class="badge">{backend === 'webgpu' ? 'WebGPU' : 'WASM'}</span>
{/if}
```

Add styles:
```css
.backend-selector {
  display: flex;
  gap: 2px;
  background: var(--bg-primary);
  border-radius: 6px;
  padding: 2px;
}

.backend-selector button {
  padding: 0.2rem 0.6rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.75rem;
}

.backend-selector button.active {
  background: var(--accent-color, #3b82f6);
  color: white;
}
```

**Step 2: Verify build and test in browser**

```bash
npx vite build 2>&1 | tail -5
```

Open http://localhost:5173 and verify the backend selector appears.

**Step 3: Commit**

```bash
git add src/App.svelte
git commit -m "add WebGPU/WASM backend selector in header"
```

---

### Task 8: Test end-to-end with demo image

**Files:** None — this is a manual verification task.

**Step 1: Start dev server**

```bash
npx vite --host
```

**Step 2: Open in Chrome (WebGPU requires Chrome 113+)**

Navigate to `http://localhost:5173`.

**Step 3: Verify WebGPU path**

1. Ensure "WebGPU" is selected (default)
2. Click "Download Models" — watch progress bars
3. After models load, check console for backend confirmation message
4. Click "Try demo image"
5. Verify: bounding boxes appear (YOLO working)
6. Verify: text streams in per line (TrOCR working)
7. Check browser console for errors

**Step 4: Verify WASM fallback**

1. Refresh, switch to "WASM"
2. Load models (uses existing Rust WASM worker)
3. Run demo image
4. Verify same pipeline works

**Step 5: Note any issues for follow-up**

Common issues to watch for:
- `encoder_hidden_states` input name may differ — check `decoderSession.inputNames` in console
- WebGPU adapter unavailable on some systems — should fall back to WASM EP gracefully
- Large model (1.1GB decoder) may take time to create session — this is expected

---

### Task 9: Commit final state

**Step 1: Verify all changes**

```bash
git status
npx vite build
```

**Step 2: Commit any remaining changes**

```bash
git add -A
git commit -m "WebGPU inference via onnxruntime-web: complete pipeline"
```
