# WASM HTR App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a browser-based HTR app that runs YOLO segmentation + TrOCR recognition entirely in WASM, with streaming token output.

**Architecture:** Rust WASM crate (`ort` + `ort-tract` backend) compiled via `wasm-pack`, loaded in a Web Worker. Svelte 5 frontend with reactive streaming state. Models cached via Cache API.

**Tech Stack:** Rust, wasm-pack, ort + ort-tract, Svelte 5, Vite 6, TypeScript

**Reference repos:**
- Pipeline: https://github.com/AI-Riksarkivet/htrflow_app
- UI patterns: https://github.com/Borg93/mcp-apps-viewer

---

## Task 1: Scaffold Rust WASM Crate

**Files:**
- Create: `crates/htr-wasm/Cargo.toml`
- Create: `crates/htr-wasm/src/lib.rs`
- Create: `crates/htr-wasm/src/utils.rs`

**Step 1: Initialize the Rust crate**

```bash
mkdir -p crates/htr-wasm
```

**Step 2: Create Cargo.toml**

```toml
[package]
name = "htr-wasm"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
js-sys = "0.3"
web-sys = { version = "0.3", features = ["console"] }

ort = { version = "=2.0.0-rc.12", default-features = false, features = ["std", "ndarray", "alternative-backend"] }
ort-tract = "0.3"
ndarray = "0.16"
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }

[profile.release]
opt-level = "s"
lto = true
```

**Step 3: Create lib.rs with basic init**

```rust
use wasm_bindgen::prelude::*;

mod utils;

#[wasm_bindgen(start)]
pub fn init() {
    utils::set_panic_hook();
    ort::set_api(ort_tract::api());
}

#[wasm_bindgen]
pub fn greet() -> String {
    "htr-wasm initialized".to_string()
}
```

**Step 4: Create utils.rs**

```rust
pub fn set_panic_hook() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}
```

**Step 5: Build with wasm-pack**

```bash
cd crates/htr-wasm && wasm-pack build --target web --release
```

Expected: builds successfully, produces `pkg/` directory with `.wasm` + JS glue.

**Step 6: Commit**

```bash
git add crates/htr-wasm/
git commit -m "scaffold rust wasm crate with ort-tract backend"
```

---

## Task 2: Scaffold Svelte 5 Frontend

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `svelte.config.js`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `src/App.svelte`
- Create: `src/app.css`

**Step 1: Initialize the Svelte project**

```bash
npm create vite@latest . -- --template svelte-ts
```

If the repo is non-empty, create in a temp dir and move files. Do NOT overwrite `docs/` or `crates/`.

**Step 2: Install WASM and singlefile plugins**

```bash
npm install -D vite-plugin-wasm vite-plugin-top-level-await vite-plugin-singlefile
```

**Step 3: Configure vite.config.ts**

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [svelte(), wasm(), topLevelAwait()],
  worker: {
    plugins: () => [wasm(), topLevelAwait()],
  },
});
```

**Step 4: Configure svelte.config.js**

```js
export default {
  compilerOptions: {
    runes: true,
  },
};
```

**Step 5: Create minimal App.svelte**

```svelte
<script lang="ts">
  let status = $state('initializing...');
</script>

<main>
  <h1>Lejonet HTR</h1>
  <p>{status}</p>
</main>
```

**Step 6: Verify dev server works**

```bash
npm run dev
```

Expected: app loads at localhost:5173 showing "Lejonet HTR".

**Step 7: Commit**

```bash
git add package.json vite.config.ts svelte.config.js tsconfig.json index.html src/ .gitignore
git commit -m "scaffold svelte 5 frontend with vite and wasm plugins"
```

---

## Task 3: Connect WASM to Svelte (Web Worker)

**Files:**
- Create: `src/worker.ts`
- Create: `src/lib/worker-state.svelte.ts`
- Create: `src/lib/types.ts`
- Modify: `src/App.svelte`

**Step 1: Define message types**

Create `src/lib/types.ts`:

```ts
export type WorkerInMessage =
  | { type: 'load_models' }
  | { type: 'run_pipeline'; payload: { imageData: ArrayBuffer } };

export type WorkerOutMessage =
  | { type: 'model_status'; payload: { model: string; status: 'downloading' | 'cached' | 'loaded'; progress?: number } }
  | { type: 'segmentation'; payload: { lines: BBox[] } }
  | { type: 'token'; payload: { lineIndex: number; token: string } }
  | { type: 'line_done'; payload: { lineIndex: number; text: string; confidence: number } }
  | { type: 'pipeline_done' }
  | { type: 'error'; payload: { message: string } }
  | { type: 'ready' };

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export type PipelineStage = 'idle' | 'loading_models' | 'segmenting' | 'transcribing' | 'done';

export interface Line {
  bbox: BBox;
  text: string;
  confidence: number;
  complete: boolean;
}
```

**Step 2: Create worker**

Create `src/worker.ts`:

```ts
import init, { greet } from '../crates/htr-wasm/pkg/htr_wasm.js';

self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'load_models') {
    await init();
    const msg = greet();
    self.postMessage({ type: 'ready' });
  }
};
```

**Step 3: Create reactive worker state**

Create `src/lib/worker-state.svelte.ts`:

```ts
import type { WorkerOutMessage, PipelineStage, Line } from './types';

export class HTRWorkerState {
  stage = $state<PipelineStage>('idle');
  lines = $state<Line[]>([]);
  currentLine = $state<number>(-1);
  currentText = $state<string>('');
  modelsReady = $state<boolean>(false);
  error = $state<string | null>(null);
  modelProgress = $state<Record<string, number>>({});

  private worker: Worker;

  constructor() {
    this.worker = new Worker(
      new URL('../worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      this.handleMessage(e.data);
    };
  }

  private handleMessage(msg: WorkerOutMessage) {
    switch (msg.type) {
      case 'ready':
        this.modelsReady = true;
        this.stage = 'idle';
        break;
      case 'model_status':
        this.stage = 'loading_models';
        if (msg.payload.progress !== undefined) {
          this.modelProgress[msg.payload.model] = msg.payload.progress;
        }
        break;
      case 'segmentation':
        this.stage = 'transcribing';
        this.lines = msg.payload.lines.map((bbox) => ({
          bbox,
          text: '',
          confidence: 0,
          complete: false,
        }));
        break;
      case 'token':
        this.currentLine = msg.payload.lineIndex;
        this.currentText += msg.payload.token;
        if (this.lines[msg.payload.lineIndex]) {
          this.lines[msg.payload.lineIndex].text = this.currentText;
        }
        break;
      case 'line_done':
        if (this.lines[msg.payload.lineIndex]) {
          this.lines[msg.payload.lineIndex].text = msg.payload.text;
          this.lines[msg.payload.lineIndex].confidence = msg.payload.confidence;
          this.lines[msg.payload.lineIndex].complete = true;
        }
        this.currentText = '';
        break;
      case 'pipeline_done':
        this.stage = 'done';
        this.currentLine = -1;
        break;
      case 'error':
        this.error = msg.payload.message;
        break;
    }
  }

  loadModels() {
    this.stage = 'loading_models';
    this.worker.postMessage({ type: 'load_models' });
  }

  runPipeline(imageData: ArrayBuffer) {
    this.stage = 'segmenting';
    this.lines = [];
    this.currentLine = -1;
    this.currentText = '';
    this.error = null;
    this.worker.postMessage(
      { type: 'run_pipeline', payload: { imageData } },
      [imageData]
    );
  }

  destroy() {
    this.worker.terminate();
  }
}
```

**Step 4: Wire up in App.svelte**

```svelte
<script lang="ts">
  import { HTRWorkerState } from './lib/worker-state.svelte';
  import { onMount } from 'svelte';

  const htr = new HTRWorkerState();

  onMount(() => {
    htr.loadModels();
    return () => htr.destroy();
  });
</script>

<main>
  <h1>Lejonet HTR</h1>
  <p>Stage: {htr.stage}</p>
  <p>Models ready: {htr.modelsReady}</p>
  {#if htr.error}
    <p style="color: red">{htr.error}</p>
  {/if}
</main>
```

**Step 5: Verify WASM loads in browser**

```bash
npm run dev
```

Expected: page shows "Stage: idle", "Models ready: true" after WASM initializes.

**Step 6: Commit**

```bash
git add src/worker.ts src/lib/ src/App.svelte
git commit -m "connect wasm to svelte via web worker with reactive state"
```

---

## Task 4: Model Caching System

**Files:**
- Create: `src/lib/model-cache.ts`
- Modify: `src/worker.ts`

**Step 1: Create model cache module**

Create `src/lib/model-cache.ts`:

```ts
const CACHE_NAME = 'htr-models-v1';

export interface DownloadProgress {
  model: string;
  loaded: number;
  total: number;
  percent: number;
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}

export async function getStorageEstimate(): Promise<{ used: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return { used: est.usage ?? 0, quota: est.quota ?? 0 };
  }
  return { used: 0, quota: 0 };
}

export async function getCachedModel(url: string): Promise<ArrayBuffer | null> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(url);
  if (response) {
    return response.arrayBuffer();
  }
  return null;
}

export async function downloadAndCacheModel(
  url: string,
  modelName: string,
  onProgress: (p: DownloadProgress) => void
): Promise<ArrayBuffer> {
  const cached = await getCachedModel(url);
  if (cached) {
    onProgress({ model: modelName, loaded: cached.byteLength, total: cached.byteLength, percent: 100 });
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${modelName}: ${response.status}`);
  }

  const contentLength = Number(response.headers.get('Content-Length') ?? 0);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({
      model: modelName,
      loaded,
      total: contentLength,
      percent: contentLength > 0 ? Math.round((loaded / contentLength) * 100) : 0,
    });
  }

  const blob = new Blob(chunks);
  const cache = await caches.open(CACHE_NAME);
  await cache.put(url, new Response(blob.slice(0)));

  return blob.arrayBuffer();
}

export async function isModelCached(url: string): Promise<boolean> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(url);
  return response !== null;
}

export async function clearModelCache(): Promise<void> {
  await caches.delete(CACHE_NAME);
}
```

**Step 2: Integrate into worker**

Update `src/worker.ts` to use model cache for downloading. The worker posts `model_status` messages as models download.

**Step 3: Verify caching works**

Open DevTools → Application → Cache Storage. After first load, models should appear in `htr-models-v1`. Second load should be instant.

**Step 4: Commit**

```bash
git add src/lib/model-cache.ts src/worker.ts
git commit -m "add model caching with download progress via cache api"
```

---

## Task 5: YOLO Segmentation in Rust WASM

**Files:**
- Create: `crates/htr-wasm/src/yolo.rs`
- Create: `crates/htr-wasm/src/preprocessing.rs`
- Modify: `crates/htr-wasm/src/lib.rs`

**Step 1: Create preprocessing module**

Create `crates/htr-wasm/src/preprocessing.rs`:

```rust
use image::{DynamicImage, GenericImageView, imageops::FilterType};
use ndarray::Array4;

/// Resize image to target_size, pad to square with letterboxing.
/// Returns (preprocessed tensor, scale_x, scale_y, pad_x, pad_y).
pub fn preprocess_yolo(
    img: &DynamicImage,
    target_size: u32,
) -> (Array4<f32>, f32, f32, f32, f32) {
    let (orig_w, orig_h) = img.dimensions();
    let scale = (target_size as f32 / orig_w as f32).min(target_size as f32 / orig_h as f32);
    let new_w = (orig_w as f32 * scale) as u32;
    let new_h = (orig_h as f32 * scale) as u32;

    let resized = img.resize_exact(new_w, new_h, FilterType::Lanczos3);
    let mut padded = DynamicImage::new_rgb8(target_size, target_size);
    let pad_x = (target_size - new_w) / 2;
    let pad_y = (target_size - new_h) / 2;

    image::imageops::overlay(&mut padded, &resized, pad_x as i64, pad_y as i64);

    let mut tensor = Array4::<f32>::zeros((1, 3, target_size as usize, target_size as usize));
    for y in 0..target_size {
        for x in 0..target_size {
            let pixel = padded.get_pixel(x, y);
            tensor[[0, 0, y as usize, x as usize]] = pixel[0] as f32 / 255.0;
            tensor[[0, 1, y as usize, x as usize]] = pixel[1] as f32 / 255.0;
            tensor[[0, 2, y as usize, x as usize]] = pixel[2] as f32 / 255.0;
        }
    }

    (tensor, scale, scale, pad_x as f32, pad_y as f32)
}

/// Resize and normalize a cropped line image for TrOCR.
/// Returns tensor of shape [1, 3, 384, 384].
pub fn preprocess_trocr(img: &DynamicImage) -> Array4<f32> {
    let resized = img.resize_exact(384, 384, FilterType::Lanczos3);
    let mean = [0.5, 0.5, 0.5];
    let std = [0.5, 0.5, 0.5];

    let mut tensor = Array4::<f32>::zeros((1, 3, 384, 384));
    for y in 0..384u32 {
        for x in 0..384u32 {
            let pixel = resized.get_pixel(x, y);
            tensor[[0, 0, y as usize, x as usize]] = (pixel[0] as f32 / 255.0 - mean[0]) / std[0];
            tensor[[0, 1, y as usize, x as usize]] = (pixel[1] as f32 / 255.0 - mean[1]) / std[1];
            tensor[[0, 2, y as usize, x as usize]] = (pixel[2] as f32 / 255.0 - mean[2]) / std[2];
        }
    }

    tensor
}
```

**Step 2: Create YOLO module**

Create `crates/htr-wasm/src/yolo.rs`:

```rust
use ndarray::{Array2, ArrayView2, Axis};
use ort::session::Session;
use serde::Serialize;

use crate::preprocessing::preprocess_yolo;

#[derive(Serialize, Clone, Debug)]
pub struct Detection {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub confidence: f32,
    pub class_id: usize,
}

pub struct YoloModel {
    session: Session,
}

impl YoloModel {
    pub fn new(model_bytes: &[u8]) -> Result<Self, ort::Error> {
        let session = Session::builder()?
            .with_model_from_memory(model_bytes)?;
        Ok(Self { session })
    }

    pub fn detect(
        &self,
        img: &image::DynamicImage,
        conf_threshold: f32,
        iou_threshold: f32,
    ) -> Result<Vec<Detection>, ort::Error> {
        let (tensor, scale, _, pad_x, pad_y) = preprocess_yolo(img, 640);

        let input = ort::value::Value::from_array(tensor.view())?;
        let outputs = self.session.run(ort::inputs![input]?)?;
        let output = outputs[0].try_extract_tensor::<f32>()?;

        // Output shape: [1, 4+num_classes, num_detections]
        let output = output.to_owned();
        let shape = output.shape();
        let num_features = shape[1];
        let num_detections = shape[2];
        let num_classes = num_features - 4;

        // Reshape to [num_features, num_detections] then transpose
        let flat = output.into_shape_with_order((num_features, num_detections))
            .expect("reshape failed");
        let transposed = flat.t(); // [num_detections, num_features]

        let mut detections = Vec::new();
        let (orig_w, orig_h) = img.dimensions();

        for row in transposed.rows() {
            let cx = row[0];
            let cy = row[1];
            let w = row[2];
            let h = row[3];

            // Find best class
            let (class_id, &max_score) = row.iter()
                .skip(4)
                .enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                .unwrap();

            if max_score < conf_threshold {
                continue;
            }

            // Convert from padded 640x640 coords to original image coords
            let x = ((cx - w / 2.0) - pad_x) / scale;
            let y = ((cy - h / 2.0) - pad_y) / scale;
            let bw = w / scale;
            let bh = h / scale;

            detections.push(Detection {
                x: x.max(0.0).min(orig_w as f32),
                y: y.max(0.0).min(orig_h as f32),
                w: bw.min(orig_w as f32 - x),
                h: bh.min(orig_h as f32 - y),
                confidence: max_score,
                class_id,
            });
        }

        // NMS
        nms(&mut detections, iou_threshold);

        Ok(detections)
    }
}

fn nms(detections: &mut Vec<Detection>, iou_threshold: f32) {
    detections.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());
    let mut keep = vec![true; detections.len()];

    for i in 0..detections.len() {
        if !keep[i] { continue; }
        for j in (i + 1)..detections.len() {
            if !keep[j] { continue; }
            if iou(&detections[i], &detections[j]) > iou_threshold {
                keep[j] = false;
            }
        }
    }

    let mut idx = 0;
    detections.retain(|_| { let k = keep[idx]; idx += 1; k });
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    let x2 = (a.x + a.w).min(b.x + b.w);
    let y2 = (a.y + a.h).min(b.y + b.h);

    let intersection = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let area_a = a.w * a.h;
    let area_b = b.w * b.h;
    let union = area_a + area_b - intersection;

    if union <= 0.0 { 0.0 } else { intersection / union }
}
```

**Step 3: Expose via wasm_bindgen**

Update `crates/htr-wasm/src/lib.rs` to add:

```rust
mod yolo;
mod preprocessing;

use wasm_bindgen::prelude::*;
use js_sys::Uint8Array;

static mut YOLO_MODEL: Option<yolo::YoloModel> = None;

#[wasm_bindgen]
pub fn load_yolo(model_bytes: &[u8]) -> Result<(), JsError> {
    let model = yolo::YoloModel::new(model_bytes)
        .map_err(|e| JsError::new(&e.to_string()))?;
    unsafe { YOLO_MODEL = Some(model); }
    Ok(())
}

#[wasm_bindgen]
pub fn run_yolo(image_bytes: &[u8]) -> Result<String, JsError> {
    let img = image::load_from_memory(image_bytes)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let model = unsafe { YOLO_MODEL.as_ref() }
        .ok_or_else(|| JsError::new("YOLO model not loaded"))?;
    let detections = model.detect(&img, 0.25, 0.45)
        .map_err(|e| JsError::new(&e.to_string()))?;
    serde_json::to_string(&detections)
        .map_err(|e| JsError::new(&e.to_string()))
}
```

**Step 4: Build and test**

```bash
cd crates/htr-wasm && wasm-pack build --target web --release
```

Expected: compiles. Functional test deferred to integration with frontend + actual ONNX model.

**Step 5: Commit**

```bash
git add crates/htr-wasm/src/
git commit -m "add yolo segmentation with nms in rust wasm"
```

---

## Task 6: TrOCR Inference in Rust WASM

**Files:**
- Create: `crates/htr-wasm/src/trocr.rs`
- Create: `crates/htr-wasm/src/tokenizer.rs`
- Modify: `crates/htr-wasm/src/lib.rs`

**Step 1: Create minimal BPE tokenizer**

Create `crates/htr-wasm/src/tokenizer.rs`:

```rust
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize)]
pub struct TokenizerConfig {
    pub model: TokenizerModel,
}

#[derive(Deserialize)]
pub struct TokenizerModel {
    pub vocab: HashMap<String, u32>,
    pub merges: Vec<String>,
}

pub struct BpeTokenizer {
    id_to_token: HashMap<u32, String>,
    pub eos_token_id: u32,
    pub bos_token_id: u32,
    pub pad_token_id: u32,
}

impl BpeTokenizer {
    pub fn from_json(tokenizer_json: &str) -> Result<Self, serde_json::Error> {
        let config: TokenizerConfig = serde_json::from_str(tokenizer_json)?;
        let id_to_token: HashMap<u32, String> = config
            .model
            .vocab
            .iter()
            .map(|(k, v)| (*v, k.clone()))
            .collect();

        // TrOCR uses RobertaTokenizer: bos=0, eos=2, pad=1
        Ok(Self {
            id_to_token,
            bos_token_id: 0,
            eos_token_id: 2,
            pad_token_id: 1,
        })
    }

    pub fn decode(&self, token_ids: &[u32]) -> String {
        let tokens: Vec<String> = token_ids
            .iter()
            .filter(|&&id| id != self.bos_token_id && id != self.eos_token_id && id != self.pad_token_id)
            .filter_map(|id| self.id_to_token.get(id).cloned())
            .collect();

        // RoBERTa BPE uses Ġ for space prefix
        tokens
            .join("")
            .replace("Ġ", " ")
            .trim()
            .to_string()
    }

    pub fn decode_token(&self, token_id: u32) -> Option<String> {
        self.id_to_token.get(&token_id).map(|t| t.replace("Ġ", " "))
    }
}
```

**Step 2: Create TrOCR module**

Create `crates/htr-wasm/src/trocr.rs`:

```rust
use ndarray::{Array2, Array3, ArrayView3, Axis, s};
use ort::session::Session;
use crate::preprocessing::preprocess_trocr;
use crate::tokenizer::BpeTokenizer;

pub struct TrOCRModel {
    encoder: Session,
    decoder: Session,
    pub tokenizer: BpeTokenizer,
}

/// Callback invoked after each token is decoded.
pub type TokenCallback = Box<dyn Fn(u32, &str)>;

impl TrOCRModel {
    pub fn new(
        encoder_bytes: &[u8],
        decoder_bytes: &[u8],
        tokenizer_json: &str,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let encoder = Session::builder()?
            .with_model_from_memory(encoder_bytes)?;
        let decoder = Session::builder()?
            .with_model_from_memory(decoder_bytes)?;
        let tokenizer = BpeTokenizer::from_json(tokenizer_json)?;

        Ok(Self { encoder, decoder, tokenizer })
    }

    pub fn transcribe_line(
        &self,
        img: &image::DynamicImage,
        max_length: usize,
        on_token: &dyn Fn(u32, &str),
    ) -> Result<String, Box<dyn std::error::Error>> {
        // Encode
        let pixel_values = preprocess_trocr(img);
        let input = ort::value::Value::from_array(pixel_values.view())?;
        let encoder_output = self.encoder.run(ort::inputs![input]?)?;
        let hidden_states = encoder_output[0].try_extract_tensor::<f32>()?;
        let hidden_states = hidden_states.to_owned();

        // Decode autoregressively
        let decoder_start_id = 2u32; // TrOCR decoder_start_token_id
        let mut token_ids: Vec<u32> = vec![decoder_start_id];

        for _ in 0..max_length {
            let seq_len = token_ids.len();
            let input_ids = ndarray::Array2::from_shape_vec(
                (1, seq_len),
                token_ids.iter().map(|&id| id as i64).collect(),
            )?;
            let attention_mask = ndarray::Array2::<i64>::ones((1, seq_len));

            let encoder_hs = ort::value::Value::from_array(hidden_states.view())?;
            let ids = ort::value::Value::from_array(input_ids.view())?;
            let mask = ort::value::Value::from_array(attention_mask.view())?;

            let decoder_output = self.decoder.run(ort::inputs![ids, mask, encoder_hs]?)?;
            let logits = decoder_output[0].try_extract_tensor::<f32>()?;

            // Get last token logits, argmax
            let logits_view = logits.to_owned();
            let last_logits = logits_view.slice(s![0, seq_len - 1, ..]);
            let next_token = last_logits
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                .map(|(idx, _)| idx as u32)
                .unwrap();

            if next_token == self.tokenizer.eos_token_id {
                break;
            }

            // Stream the token
            if let Some(text) = self.tokenizer.decode_token(next_token) {
                on_token(next_token, &text);
            }

            token_ids.push(next_token);
        }

        // Return full decoded text (skip decoder_start_token)
        Ok(self.tokenizer.decode(&token_ids[1..]))
    }
}
```

**Step 3: Expose via wasm_bindgen**

Add to `crates/htr-wasm/src/lib.rs`:

```rust
mod trocr;
mod tokenizer;

static mut TROCR_MODEL: Option<trocr::TrOCRModel> = None;

#[wasm_bindgen]
pub fn load_trocr(
    encoder_bytes: &[u8],
    decoder_bytes: &[u8],
    tokenizer_json: &str,
) -> Result<(), JsError> {
    let model = trocr::TrOCRModel::new(encoder_bytes, decoder_bytes, tokenizer_json)
        .map_err(|e| JsError::new(&e.to_string()))?;
    unsafe { TROCR_MODEL = Some(model); }
    Ok(())
}
```

Note: The streaming callback from Rust→JS requires `wasm_bindgen` closures. The `on_token` callback will post messages to the main thread. This will be wired up in Task 7.

**Step 4: Build**

```bash
cd crates/htr-wasm && wasm-pack build --target web --release
```

**Step 5: Commit**

```bash
git add crates/htr-wasm/src/
git commit -m "add trocr autoregressive decoder with bpe tokenizer"
```

---

## Task 7: Full Pipeline with Streaming Callbacks

**Files:**
- Create: `crates/htr-wasm/src/pipeline.rs`
- Modify: `crates/htr-wasm/src/lib.rs`
- Modify: `src/worker.ts`

**Step 1: Create pipeline module**

Create `crates/htr-wasm/src/pipeline.rs` that orchestrates:
1. Run YOLO on full image → get line detections
2. Sort detections by Y then X (reading order)
3. For each detection, crop the line from the original image
4. Run TrOCR on cropped line with token callback
5. After each line completes, call the line_done callback

The pipeline exposes a `run_pipeline` function that accepts JS closures for:
- `on_segmentation(json: String)` — called after YOLO with all bounding boxes
- `on_token(line_index: u32, token: String)` — called per decoded token
- `on_line_done(line_index: u32, text: String, confidence: f32)` — called when line finishes
- `on_done()` — called when pipeline completes

**Step 2: Wire up worker.ts**

Update `src/worker.ts` to:
- Import WASM functions
- On `load_models`: download models via Cache API, call `load_yolo()` and `load_trocr()`
- On `run_pipeline`: call the WASM pipeline function, passing closures that do `self.postMessage()`

```ts
import init, { load_yolo, load_trocr, run_pipeline } from '../crates/htr-wasm/pkg/htr_wasm.js';
import { downloadAndCacheModel } from './lib/model-cache';

const MODEL_URLS = {
  yolo: 'https://huggingface.co/Riksarkivet/yolov9-lines-within-regions-1/resolve/main/yolo-lines-int8.onnx',
  trOcrEncoder: 'https://huggingface.co/Riksarkivet/trocr-base-handwritten-hist-swe-2/resolve/main/encoder-int8.onnx',
  trOcrDecoder: 'https://huggingface.co/Riksarkivet/trocr-base-handwritten-hist-swe-2/resolve/main/decoder-int8.onnx',
  tokenizer: 'https://huggingface.co/Riksarkivet/trocr-base-handwritten-hist-swe-2/resolve/main/tokenizer.json',
};

let wasmReady = false;

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        await init();

        const progress = (p: any) => {
          self.postMessage({ type: 'model_status', payload: { model: p.model, status: 'downloading', progress: p.percent } });
        };

        const [yoloBytes, encoderBytes, decoderBytes, tokenizerBytes] = await Promise.all([
          downloadAndCacheModel(MODEL_URLS.yolo, 'yolo', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrEncoder, 'trocr-encoder', progress),
          downloadAndCacheModel(MODEL_URLS.trOcrDecoder, 'trocr-decoder', progress),
          downloadAndCacheModel(MODEL_URLS.tokenizer, 'tokenizer', progress),
        ]);

        load_yolo(new Uint8Array(yoloBytes));
        self.postMessage({ type: 'model_status', payload: { model: 'yolo', status: 'loaded' } });

        const tokenizerJson = new TextDecoder().decode(tokenizerBytes);
        load_trocr(new Uint8Array(encoderBytes), new Uint8Array(decoderBytes), tokenizerJson);
        self.postMessage({ type: 'model_status', payload: { model: 'trocr', status: 'loaded' } });

        wasmReady = true;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'run_pipeline': {
        if (!wasmReady) throw new Error('Models not loaded');

        const imageBytes = new Uint8Array(e.data.payload.imageData);
        run_pipeline(
          imageBytes,
          (json: string) => self.postMessage({ type: 'segmentation', payload: { lines: JSON.parse(json) } }),
          (lineIdx: number, token: string) => self.postMessage({ type: 'token', payload: { lineIndex: lineIdx, token } }),
          (lineIdx: number, text: string, confidence: number) => self.postMessage({ type: 'line_done', payload: { lineIndex: lineIdx, text, confidence } }),
          () => self.postMessage({ type: 'pipeline_done' }),
        );
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
```

**Step 3: Build and verify end-to-end**

```bash
cd crates/htr-wasm && wasm-pack build --target web --release
cd ../.. && npm run dev
```

Test with a sample handwritten document image. Verify:
- Models download with progress
- YOLO detects lines (boxes appear)
- TrOCR streams tokens per line
- Full text appears at end

**Step 4: Commit**

```bash
git add crates/htr-wasm/src/pipeline.rs crates/htr-wasm/src/lib.rs src/worker.ts
git commit -m "wire up full pipeline with streaming token callbacks"
```

---

## Task 8: Upload Panel Component

**Files:**
- Create: `src/lib/components/UploadPanel.svelte`
- Modify: `src/App.svelte`

**Step 1: Create UploadPanel**

```svelte
<script lang="ts">
  interface Props {
    onUpload: (imageData: ArrayBuffer, previewUrl: string) => void;
    disabled: boolean;
  }

  let { onUpload, disabled }: Props = $props();
  let dragOver = $state(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    const previewUrl = URL.createObjectURL(file);
    file.arrayBuffer().then((buf) => onUpload(buf, previewUrl));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    handleFiles(e.dataTransfer?.files ?? null);
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }
</script>

<div
  class="upload-panel"
  class:drag-over={dragOver}
  class:disabled
  ondrop={onDrop}
  ondragover={onDragOver}
  ondragleave={() => (dragOver = false)}
  role="button"
  tabindex="0"
>
  <input
    type="file"
    accept="image/*"
    onchange={(e) => handleFiles(e.currentTarget.files)}
    {disabled}
    id="file-input"
  />
  <label for="file-input">
    <p>Drop an image here or click to upload</p>
  </label>
</div>
```

**Step 2: Integrate into App.svelte**

Wire the upload to `htr.runPipeline(imageData)`.

**Step 3: Commit**

```bash
git add src/lib/components/UploadPanel.svelte src/App.svelte
git commit -m "add drag and drop upload panel"
```

---

## Task 9: Document Viewer with Canvas Overlays

**Files:**
- Create: `src/lib/canvas.ts` (adapted from mcp-apps-viewer's CanvasController)
- Create: `src/lib/components/DocumentViewer.svelte`
- Modify: `src/App.svelte`

**Step 1: Create CanvasController**

Adapt the pan/zoom/inertia controller from mcp-apps-viewer. Key features:
- Pointer drag for panning
- Mouse wheel for zoom (centered on cursor)
- Device pixel ratio awareness
- `onAfterDraw` callback for overlay rendering
- `requestAnimationFrame` scheduling

**Step 2: Create DocumentViewer component**

```svelte
<script lang="ts">
  import type { Line } from '$lib/types';
  import { CanvasController } from '$lib/canvas';
  import { onMount } from 'svelte';

  interface Props {
    imageUrl: string | null;
    lines: Line[];
    currentLine: number;
  }

  let { imageUrl, lines, currentLine }: Props = $props();
  let canvasEl: HTMLCanvasElement;
  let controller: CanvasController;
  let img: HTMLImageElement | null = null;

  onMount(() => {
    controller = new CanvasController(canvasEl, {
      onAfterDraw: (ctx, transform) => {
        if (!img) return;
        // Draw bounding boxes
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const isCurrent = i === currentLine;
          ctx.strokeStyle = isCurrent ? '#ff6b00' : line.complete ? '#22c55e' : '#3b82f6';
          ctx.lineWidth = (isCurrent ? 3 : 1.5) / transform.scale;
          ctx.fillStyle = isCurrent ? 'rgba(255, 107, 0, 0.1)' : 'transparent';
          ctx.beginPath();
          ctx.rect(line.bbox.x, line.bbox.y, line.bbox.w, line.bbox.h);
          ctx.fill();
          ctx.stroke();
        }
      },
    });

    return () => controller.destroy();
  });

  $effect(() => {
    if (imageUrl) {
      img = new Image();
      img.onload = () => controller.setImage(img!);
      img.src = imageUrl;
    }
  });

  $effect(() => {
    // Trigger re-render when lines or currentLine changes
    lines; currentLine;
    controller?.render();
  });
</script>

<canvas bind:this={canvasEl} class="document-canvas"></canvas>
```

**Step 3: Commit**

```bash
git add src/lib/canvas.ts src/lib/components/DocumentViewer.svelte src/App.svelte
git commit -m "add document viewer with pan/zoom and line overlays"
```

---

## Task 10: Transcription Panel with Streaming Text

**Files:**
- Create: `src/lib/components/TranscriptionPanel.svelte`
- Modify: `src/App.svelte`

**Step 1: Create TranscriptionPanel**

```svelte
<script lang="ts">
  import type { Line } from '$lib/types';

  interface Props {
    lines: Line[];
    currentLine: number;
    currentText: string;
  }

  let { lines, currentLine, currentText }: Props = $props();
  let panelEl: HTMLDivElement;

  // Auto-scroll to current line
  $effect(() => {
    if (currentLine >= 0 && panelEl) {
      const el = panelEl.querySelector(`[data-line="${currentLine}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
</script>

<div class="transcription-panel" bind:this={panelEl}>
  {#each lines as line, i}
    <div
      class="line"
      class:current={i === currentLine}
      class:complete={line.complete}
      data-line={i}
    >
      <span class="line-number">{i + 1}</span>
      <span class="line-text">
        {line.text}{#if i === currentLine && !line.complete}<span class="cursor">|</span>{/if}
      </span>
      {#if line.complete}
        <span class="confidence" title="Confidence">{(line.confidence * 100).toFixed(0)}%</span>
      {/if}
    </div>
  {/each}

  {#if lines.length === 0}
    <p class="placeholder">Transcription will appear here...</p>
  {/if}
</div>
```

**Step 2: Add blinking cursor CSS animation**

```css
.cursor {
  animation: blink 0.7s step-end infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}
```

**Step 3: Commit**

```bash
git add src/lib/components/TranscriptionPanel.svelte src/App.svelte
git commit -m "add streaming transcription panel with auto-scroll"
```

---

## Task 11: Status Bar and Model Manager

**Files:**
- Create: `src/lib/components/StatusBar.svelte`
- Create: `src/lib/components/ModelManager.svelte`
- Modify: `src/App.svelte`

**Step 1: Create StatusBar**

Shows current pipeline stage, line progress (e.g., "Transcribing line 3/15"), elapsed time.

**Step 2: Create ModelManager**

First-run experience:
- Shows total download size (~430 MB)
- Per-model download progress bars
- "Download Models" button
- After download, shows "Models cached" with option to clear cache

**Step 3: Wire into App.svelte**

Show ModelManager when `!htr.modelsReady`, show StatusBar during pipeline execution.

**Step 4: Commit**

```bash
git add src/lib/components/StatusBar.svelte src/lib/components/ModelManager.svelte src/App.svelte
git commit -m "add status bar and model manager components"
```

---

## Task 12: App Layout and Styling

**Files:**
- Modify: `src/App.svelte`
- Modify: `src/app.css`

**Step 1: Create responsive layout**

Two-panel layout:
- Left: DocumentViewer (with UploadPanel overlay when no image)
- Right: TranscriptionPanel
- Top: StatusBar
- Resizable divider between panels (reuse resize pattern from mcp-apps-viewer)

**Step 2: Style with CSS**

Dark/light theme support. Clean, minimal design. Responsive for different screen sizes.

**Step 3: Commit**

```bash
git add src/App.svelte src/app.css
git commit -m "add responsive two-panel layout with theming"
```

---

## Task 13: Optional MCP Integration

**Files:**
- Create: `src/lib/mcp.ts`
- Modify: `src/App.svelte`
- Modify: `vite.config.ts` (add singlefile build mode)

**Step 1: Install MCP ext-apps**

```bash
npm install @modelcontextprotocol/ext-apps
```

**Step 2: Create MCP integration layer**

Create `src/lib/mcp.ts` that conditionally initializes MCP:

```ts
import { App } from '@modelcontextprotocol/ext-apps';

export function initMCP(): App | null {
  try {
    const app = new App();
    // Set up tool input handler, model context updates
    return app;
  } catch {
    // Not running inside MCP host
    return null;
  }
}
```

**Step 3: Add singlefile build script**

Add to `package.json`:
```json
{
  "scripts": {
    "build:mcp": "vite build --mode mcp"
  }
}
```

Update `vite.config.ts` to conditionally include `vite-plugin-singlefile` in MCP mode.

**Step 4: Commit**

```bash
git add src/lib/mcp.ts src/App.svelte vite.config.ts package.json
git commit -m "add optional mcp ext-app integration"
```

---

## Task 14: Model Export Python Script

**Files:**
- Create: `scripts/export_models.py`
- Create: `scripts/requirements.txt`

**Step 1: Create export script**

```python
"""Export and quantize YOLO + TrOCR models to ONNX for WASM inference."""

from pathlib import Path
from ultralytics import YOLO
from optimum.onnxruntime import ORTModelForVision2Seq
from onnxruntime.quantization import quantize_dynamic, QuantType
from transformers import TrOCRProcessor

OUTPUT_DIR = Path("models")

def export_yolo():
    model = YOLO("Riksarkivet/yolov9-lines-within-regions-1")
    model.export(format="onnx", imgsz=640)
    # Quantize
    quantize_dynamic(
        "yolov9-lines-within-regions-1.onnx",
        OUTPUT_DIR / "yolo-lines-int8.onnx",
        weight_type=QuantType.QInt8,
    )

def export_trocr():
    model_id = "Riksarkivet/trocr-base-handwritten-hist-swe-2"
    model = ORTModelForVision2Seq.from_pretrained(model_id, export=True)
    model.save_pretrained(OUTPUT_DIR / "trocr")
    # Quantize encoder and decoder separately
    for name in ["encoder_model.onnx", "decoder_model.onnx"]:
        quantize_dynamic(
            str(OUTPUT_DIR / "trocr" / name),
            str(OUTPUT_DIR / f"trocr-{name.replace('_model.onnx', '')}-int8.onnx"),
            weight_type=QuantType.QInt8,
        )
    # Export tokenizer
    processor = TrOCRProcessor.from_pretrained(model_id)
    processor.tokenizer.save_pretrained(OUTPUT_DIR / "tokenizer")

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(exist_ok=True)
    print("Exporting YOLO...")
    export_yolo()
    print("Exporting TrOCR...")
    export_trocr()
    print("Done! Models saved to", OUTPUT_DIR)
```

**Step 2: Create requirements.txt**

```
ultralytics>=8.3
optimum[onnxruntime]>=1.20
transformers>=4.47
onnxruntime>=1.19
```

**Step 3: Commit**

```bash
git add scripts/
git commit -m "add model export and quantization script"
```

---

## Task 15: Integration Testing and Polish

**Files:**
- Modify: various files as needed

**Step 1: End-to-end test**

1. Run `python scripts/export_models.py` to produce ONNX models
2. Host models locally (e.g., `python -m http.server` in models dir)
3. Update `MODEL_URLS` in worker to point to local server
4. Run `npm run dev`, upload a sample handwritten document
5. Verify: models download → YOLO segments → TrOCR streams → text appears

**Step 2: Fix any issues found**

Address runtime errors, tensor shape mismatches, performance issues.

**Step 3: Add README**

Basic usage instructions: how to export models, how to build, how to run.

**Step 4: Final commit**

```bash
git add .
git commit -m "integration testing and polish"
```
