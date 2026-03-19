import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { decodeImage } from './lib/preprocessing';
import { parseRTMDetOutput } from './lib/rtmdet';

// Layout detection worker: Riksarkivet RTMDet regions
const DEV = self.location?.hostname === 'localhost';
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
const cores = navigator.hardwareConcurrency || 4;
// Budget 2 threads for layout (lightweight, runs once per image)
ort.env.wasm.numThreads = hasSharedBuffer ? Math.min(2, Math.max(1, Math.floor(cores / 4))) : 1;
// Use CDN for WASM files to avoid HF LFS CORS issues
if (!DEV) ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

let modelUrl = '/models/rtmdet-regions.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.3;
const IOU_THRESHOLD = 0.45;
const LABELS = ['text_region'];

let session: ort.InferenceSession | null = null;
const imageStore = new Map<string, ImageData>();

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_model': {
        if (e.data.payload?.modelUrl) modelUrl = e.data.payload.modelUrl;
        const headers: Record<string, string> = e.data.payload?.headers ?? {};
        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({ type: 'model_status', payload: { model: p.model, status: 'downloading', progress: p.percent } });
        };
        const bytes = await downloadAndCacheModel(modelUrl, 'layout', progress, headers);
        session = await ort.InferenceSession.create(bytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        if (DEV) console.log('[layout] RTMDet loaded, inputs:', session.inputNames, 'outputs:', session.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'layout', status: 'loaded' } });
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'add_image': {
        const { imageId, imageData } = e.data.payload;
        const decoded = await decodeImage(imageData);
        imageStore.set(imageId, decoded);
        self.postMessage({ type: 'image_ready', payload: { imageId } });
        break;
      }

      case 'detect_layout': {
        const { imageId } = e.data.payload;
        if (!session) throw new Error('Layout model not loaded');
        const imgData = imageStore.get(imageId);
        if (!imgData) throw new Error(`No image data for ${imageId}`);

        const { width: origW, height: origH } = imgData;

        // Preprocess: resize keeping aspect ratio, pad bottom-right (MMDet convention)
        const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
        const ctx = canvas.getContext('2d')!;
        const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
        const newW = Math.round(origW * scale);
        const newH = Math.round(origH * scale);

        // Pad color 114/255 ≈ 0.447 (MMDet default)
        ctx.fillStyle = 'rgb(114, 114, 114)';
        ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
        const srcCanvas = new OffscreenCanvas(origW, origH);
        srcCanvas.getContext('2d')!.putImageData(imgData, 0, 0);
        // Place image at top-left (0,0), pad is bottom-right
        ctx.drawImage(srcCanvas, 0, 0, newW, newH);

        const resized = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
        const pixels = resized.data;
        const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
        for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
          chw[i] = pixels[i * 4] / 255.0;
          chw[INPUT_SIZE * INPUT_SIZE + i] = pixels[i * 4 + 1] / 255.0;
          chw[2 * INPUT_SIZE * INPUT_SIZE + i] = pixels[i * 4 + 2] / 255.0;
        }

        if (DEV) console.time(`[layout] inference`);
        const imageTensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);

        const result = await session.run({ image: imageTensor });
        const clsScores = result['cls_scores'].data as Float32Array;
        const bboxPreds = result['bbox_preds'].data as Float32Array;
        const numAnchors = result['cls_scores'].dims[1];
        const numClasses = result['cls_scores'].dims[2];
        if (DEV) console.timeEnd(`[layout] inference`);

        // Decode: image at top-left, scale maps padded 640 coords back to original
        const regions = parseRTMDetOutput(
          clsScores, bboxPreds,
          numAnchors, numClasses,
          INPUT_SIZE,
          scale,
          CONF_THRESHOLD, IOU_THRESHOLD,
          LABELS,
        );

        if (DEV) {
          console.log(`[layout] ${regions.length} regions detected, image ${origW}x${origH}`);
          for (const r of regions.slice(0, 5)) {
            console.log(`[layout]   ${r.label} ${(r.confidence * 100).toFixed(0)}% [${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`);
          }
        }
        self.postMessage({ type: 'layout_result', payload: { imageId, regions } });
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
