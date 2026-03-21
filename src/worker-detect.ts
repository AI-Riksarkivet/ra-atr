import * as ort from 'onnxruntime-web';
import { downloadAndCacheModel } from './lib/model-cache';
import { preprocessYolo, decodeImage, cropImageData } from './lib/preprocessing';
import { parseYoloOutput } from './lib/yolo';

// Detection worker: YOLO only, lightweight thread usage
const DEV = self.location?.hostname === 'localhost';
const hasSharedBuffer = typeof SharedArrayBuffer !== 'undefined';
const cores = navigator.hardwareConcurrency || 4;
// Budget 2 threads for detect (lightweight, runs infrequently)
ort.env.wasm.numThreads = hasSharedBuffer ? Math.min(2, Math.max(1, Math.floor(cores / 4))) : 1;
// Use CDN for WASM files to avoid HF LFS CORS issues
if (!DEV) ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';
console.log(`[detect] threads: ${ort.env.wasm.numThreads}, SAB: ${hasSharedBuffer}`);

let modelUrl = '/models/yolo-lines.onnx';

let yoloSession: ort.InferenceSession | null = null;
let ready = false;

const imageStore = new Map<string, ImageData>();

type RegionRequest = { imageId: string; regionId: string; x: number; y: number; w: number; h: number };
const regionQueue: RegionRequest[] = [];
let processingRegion = false;
const cancelledRegions = new Set<string>();

// Per-image line count for startIndex computation
const totalLinesSentPerImage = new Map<string, number>();

self.onmessage = async (e: MessageEvent) => {
  try {
    switch (e.data.type) {
      case 'load_models': {
        if (e.data.payload?.modelUrl) modelUrl = e.data.payload.modelUrl;
        const headers: Record<string, string> = e.data.payload?.headers ?? {};
        const progress = (p: { model: string; percent: number }) => {
          self.postMessage({
            type: 'model_status',
            payload: { model: p.model, status: 'downloading', progress: p.percent },
          });
        };

        const yoloBytes = await downloadAndCacheModel(modelUrl, 'yolo', progress, headers);
        yoloSession = await ort.InferenceSession.create(yoloBytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        if (DEV) console.log('[detect] YOLO loaded, inputs:', yoloSession.inputNames, 'outputs:', yoloSession.outputNames);
        self.postMessage({ type: 'model_status', payload: { model: 'yolo', status: 'loaded' } });

        ready = true;
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'add_image': {
        const { imageId, imageData } = e.data.payload;
        const decoded = await decodeImage(imageData);
        imageStore.set(imageId, decoded);
        if (DEV) console.log(`[detect] image added: ${imageId} (${decoded.width}x${decoded.height}), total: ${imageStore.size}`);
        self.postMessage({ type: 'image_ready' });
        break;
      }

      case 'redetect_region': {
        const { imageId, regionId, x, y, w, h } = e.data.payload;
        regionQueue.push({ imageId, regionId, x, y, w, h });
        processNextRegion();
        break;
      }

      case 'cancel_region': {
        const { regionId } = e.data.payload;
        cancelledRegions.add(regionId);
        const idx = regionQueue.findIndex(r => r.regionId === regionId);
        if (idx >= 0) regionQueue.splice(idx, 1);
        if (DEV) console.log(`[detect] cancelled region ${regionId}`);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: err.message ?? String(err) } });
  }
};

async function processNextRegion() {
  if (processingRegion || regionQueue.length === 0) return;
  processingRegion = true;

  const region = regionQueue.shift()!;
  const { imageId, regionId, x: rx, y: ry, w: rw, h: rh } = region;

  if (cancelledRegions.has(regionId)) {
    cancelledRegions.delete(regionId);
    processingRegion = false;
    processNextRegion();
    return;
  }

  try {
    if (!ready || !yoloSession) throw new Error('YOLO model not loaded');

    const imgData = imageStore.get(imageId);
    if (!imgData) throw new Error(`No image data for ${imageId}`);

    const cx = Math.max(0, Math.round(rx));
    const cy = Math.max(0, Math.round(ry));
    const cw = Math.max(1, Math.min(Math.round(rw), imgData.width - cx));
    const ch = Math.max(1, Math.min(Math.round(rh), imgData.height - cy));

    if (DEV) console.time(`[detect ${regionId}] YOLO`);
    const cropped = cropImageData(imgData, cx, cy, cw, ch);
    const { tensor: yoloInput, scale, padX, padY } = preprocessYolo(cropped, 640);
    const yoloTensor = new ort.Tensor('float32', yoloInput, [1, 3, 640, 640]);

    const yoloResult = await yoloSession.run({ [yoloSession.inputNames[0]]: yoloTensor });
    const yoloOutput = yoloResult[yoloSession.outputNames[0]];
    const protoOutput = yoloSession.outputNames.length > 1
      ? yoloResult[yoloSession.outputNames[1]]
      : null;

    let detections = parseYoloOutput(
      yoloOutput.data as Float32Array, yoloOutput.dims,
      protoOutput ? protoOutput.data as Float32Array : null,
      protoOutput ? protoOutput.dims : null,
      cw, ch, scale, padX, padY, 0.25, 0.45,
    );

    // Offset detections back to full image coordinates
    for (const det of detections) {
      det.x += cx;
      det.y += cy;
      if (det.polygon) {
        for (const pt of det.polygon) { pt.x += cx; pt.y += cy; }
      }
    }

    detections.sort((a, b) => a.y - b.y || a.x - b.x);
    if (DEV) console.timeEnd(`[detect ${regionId}] YOLO`);
    if (DEV) console.log(`[detect ${regionId}] ${detections.length} lines found`);

    const prevSent = totalLinesSentPerImage.get(imageId) ?? 0;
    const startIndex = prevSent;
    totalLinesSentPerImage.set(imageId, prevSent + detections.length);

    self.postMessage({
      type: 'region_lines',
      payload: { imageId, regionId, startIndex, lines: detections },
    });
  } catch (err: any) {
    self.postMessage({ type: 'error', payload: { message: (err as Error).message ?? String(err) } });
  }

  cancelledRegions.delete(regionId);
  processingRegion = false;
  processNextRegion();
}
