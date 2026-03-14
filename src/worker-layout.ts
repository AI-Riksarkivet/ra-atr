import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { decodeImage } from './lib/preprocessing';
import { parseRTMDetOutput } from './lib/rtmdet';

// Layout detection worker: Riksarkivet RTMDet regions
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
ort.env.wasm.numThreads = hasSharedBuffer ? Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 4)) : 1;

const MODEL_URL = '/models/rtmdet-regions.onnx';
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
        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({ type: 'model_status', payload: { model: p.model, status: 'downloading', progress: p.percent } });
        };
        const bytes = await downloadAndCacheModel(MODEL_URL, 'layout', progress);
        session = await ort.InferenceSession.create(bytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        console.log('[layout] RTMDet loaded, inputs:', session.inputNames, 'outputs:', session.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'layout', status: 'loaded' } });
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'add_image': {
        const { imageId, imageData } = e.data.payload;
        const decoded = await decodeImage(imageData);
        imageStore.set(imageId, decoded);
        break;
      }

      case 'detect_layout': {
        const { imageId } = e.data.payload;
        if (!session) throw new Error('Layout model not loaded');
        const imgData = imageStore.get(imageId);
        if (!imgData) throw new Error(`No image data for ${imageId}`);

        const { width: origW, height: origH } = imgData;

        // Preprocess: letterbox resize to 640x640 (gray padding, same as YOLO)
        const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
        const ctx = canvas.getContext('2d')!;
        const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
        const newW = Math.round(origW * scale);
        const newH = Math.round(origH * scale);
        const padX = Math.round((INPUT_SIZE - newW) / 2);
        const padY = Math.round((INPUT_SIZE - newH) / 2);

        ctx.fillStyle = '#727272';
        ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
        const srcCanvas = new OffscreenCanvas(origW, origH);
        srcCanvas.getContext('2d')!.putImageData(imgData, 0, 0);
        ctx.drawImage(srcCanvas, padX, padY, newW, newH);

        const resized = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
        const pixels = resized.data;
        const chw = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
        for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
          chw[i] = pixels[i * 4] / 255.0;
          chw[INPUT_SIZE * INPUT_SIZE + i] = pixels[i * 4 + 1] / 255.0;
          chw[2 * INPUT_SIZE * INPUT_SIZE + i] = pixels[i * 4 + 2] / 255.0;
        }

        console.time(`[layout] inference`);
        const imageTensor = new ort.Tensor('float32', chw, [1, 3, INPUT_SIZE, INPUT_SIZE]);

        const result = await session.run({ image: imageTensor });
        const clsScores = result['cls_scores'].data as Float32Array;
        const bboxPreds = result['bbox_preds'].data as Float32Array;
        const numAnchors = result['cls_scores'].dims[1];
        const numClasses = result['cls_scores'].dims[2];
        console.timeEnd(`[layout] inference`);

        // Decode with letterbox compensation: pass padded size, then adjust
        const rawRegions = parseRTMDetOutput(
          clsScores, bboxPreds,
          numAnchors, numClasses,
          INPUT_SIZE,
          INPUT_SIZE, INPUT_SIZE, // decode in padded space first
          CONF_THRESHOLD, IOU_THRESHOLD,
          LABELS,
        );

        // Map from padded 640x640 back to original image coords
        const regions = rawRegions.map(r => ({
          ...r,
          x: Math.max(0, (r.x - padX) / scale),
          y: Math.max(0, (r.y - padY) / scale),
          w: r.w / scale,
          h: r.h / scale,
        }));

        console.log(`[layout] ${regions.length} regions detected, image ${origW}x${origH}`);
        for (const r of regions.slice(0, 5)) {
          console.log(`[layout]   ${r.label} ${(r.confidence * 100).toFixed(0)}% [${r.x.toFixed(0)},${r.y.toFixed(0)} ${r.w.toFixed(0)}x${r.h.toFixed(0)}]`);
        }
        self.postMessage({ type: 'layout_result', payload: { imageId, regions } });
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
