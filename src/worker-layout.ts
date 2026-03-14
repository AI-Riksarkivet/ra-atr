import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { decodeImage } from './lib/preprocessing';

// Layout detection worker: PP-DocLayout-L
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
ort.env.wasm.numThreads = hasSharedBuffer ? Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 4)) : 1;

const MODEL_URL = '/models/pp-doclayout-l.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.5;

const LABELS = [
  'paragraph_title', 'image', 'text', 'number', 'abstract', 'content',
  'figure_title', 'formula', 'table', 'table_title', 'reference',
  'doc_title', 'footnote', 'header', 'algorithm', 'footer', 'seal',
  'chart_title', 'chart', 'formula_number', 'header_image', 'footer_image',
  'aside_text',
];

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
        console.log('[layout] model loaded, inputs:', session.inputNames, 'outputs:', session.outputNames);
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

        // Preprocess: resize to 640x640 with letterbox, normalize to [0,1]
        const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
        const ctx = canvas.getContext('2d')!;
        const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
        const newW = Math.round(origW * scale);
        const newH = Math.round(origH * scale);
        const padX = Math.round((INPUT_SIZE - newW) / 2);
        const padY = Math.round((INPUT_SIZE - newH) / 2);

        ctx.fillStyle = '#000000';
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
        const imShapeTensor = new ort.Tensor('float32', new Float32Array([origH, origW]), [1, 2]);
        const scaleFactorTensor = new ort.Tensor('float32', new Float32Array([INPUT_SIZE / origH, INPUT_SIZE / origW]), [1, 2]);

        const result = await session.run({
          image: imageTensor,
          im_shape: imShapeTensor,
          scale_factor: scaleFactorTensor,
        });

        const detections = result[session.outputNames[0]].data as Float32Array;
        const numDets = (result[session.outputNames[1]].data as Int32Array)[0];
        console.timeEnd(`[layout] inference`);

        // Parse detections: [class_id, score, x1, y1, x2, y2]
        const regions: { label: string; confidence: number; x: number; y: number; w: number; h: number }[] = [];
        for (let i = 0; i < numDets; i++) {
          const offset = i * 6;
          const classId = detections[offset];
          const score = detections[offset + 1];
          if (score < CONF_THRESHOLD) continue;

          const x1 = detections[offset + 2];
          const y1 = detections[offset + 3];
          const x2 = detections[offset + 4];
          const y2 = detections[offset + 5];

          regions.push({
            label: LABELS[Math.round(classId)] ?? `class_${Math.round(classId)}`,
            confidence: score,
            x: Math.max(0, x1),
            y: Math.max(0, y1),
            w: Math.max(0, x2 - x1),
            h: Math.max(0, y2 - y1),
          });
        }

        // Sort by Y then X (reading order)
        regions.sort((a, b) => a.y - b.y || a.x - b.x);

        console.log(`[layout] ${regions.length} regions detected (from ${numDets} raw, threshold ${CONF_THRESHOLD})`);
        self.postMessage({ type: 'layout_result', payload: { imageId, regions } });
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};
