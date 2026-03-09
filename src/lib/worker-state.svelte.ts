import type { WorkerOutMessage, PipelineStage, Line, BBox } from './types';
import { areAllModelsCached } from './model-cache';

const MODEL_URLS = [
  '/models/yolo-lines.onnx',
  '/models/encoder.onnx',
  '/models/decoder.onnx',
  '/models/tokenizer.json',
];

export class HTRWorkerState {
  stage = $state<PipelineStage>('idle');
  modelsReady = $state<boolean>(false);
  error = $state<string | null>(null);
  modelProgress = $state<Record<string, number>>({});
  cacheChecked = $state<boolean>(false);
  imageReady = $state<boolean>(false);

  /** Currently processing: { imageId, regionId } or null */
  currentWork = $state<{ imageId: string; regionId: string } | null>(null);

  private worker!: Worker;
  private runId = 0;
  private regionCounter = 0;

  // Callbacks for multi-image routing
  onRegionDetected: ((imageId: string, regionId: string, startIndex: number, lines: BBox[]) => void) | null = null;
  onRegionDone: ((imageId: string, regionId: string) => void) | null = null;
  onLineDone: ((imageId: string, lineIndex: number, text: string, confidence: number) => void) | null = null;
  onToken: ((imageId: string, lineIndex: number, token: string) => void) | null = null;

  constructor() {
    this.createWorker();

    areAllModelsCached(MODEL_URLS).then((cached) => {
      this.cacheChecked = true;
      if (cached) {
        this.loadModels();
      }
    });
  }

  private createWorker() {
    this.worker = new Worker(new URL('../worker-ortw.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      this.handleMessage(e.data);
    };
  }

  // Track which imageId is associated with each regionId
  private regionToImage = new Map<string, string>();

  private handleMessage(msg: WorkerOutMessage) {
    const expectedRun = this.runId;

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
      case 'image_ready':
        this.imageReady = true;
        break;
      case 'error':
        this.error = msg.payload.message;
        break;

      // Legacy pipeline messages (single-image flow)
      case 'segmentation':
        if (expectedRun !== this.runId) break;
        this.stage = 'transcribing';
        break;
      case 'token': {
        if (expectedRun !== this.runId) break;
        // Try to route via regionToImage for multi-image, fallback to legacy
        const tokenImageId = this.currentWork?.imageId;
        if (tokenImageId) {
          this.onToken?.(tokenImageId, msg.payload.lineIndex, msg.payload.token);
        }
        break;
      }
      case 'beam_update':
        if (expectedRun !== this.runId) break;
        break;
      case 'line_done': {
        if (expectedRun !== this.runId) break;
        const doneImageId = this.currentWork?.imageId;
        if (doneImageId) {
          this.onLineDone?.(doneImageId, msg.payload.lineIndex, msg.payload.text, msg.payload.confidence);
        }
        break;
      }
      case 'pipeline_done':
        if (expectedRun !== this.runId) break;
        this.stage = 'done';
        this.currentWork = null;
        break;

      // Region messages (multi-image)
      case 'region_lines': {
        const { imageId, regionId, startIndex, lines } = msg.payload;
        this.currentWork = { imageId, regionId };
        if (this.stage === 'done' || this.stage === 'idle') {
          this.stage = 'transcribing';
        }
        this.onRegionDetected?.(imageId, regionId, startIndex, lines);
        break;
      }
      case 'region_done': {
        const { imageId, regionId } = msg.payload;
        this.onRegionDone?.(imageId, regionId);
        this.currentWork = null;
        // Stage will be updated by app state based on remaining work
        break;
      }
    }
  }

  loadModels() {
    this.stage = 'loading_models';
    this.worker.postMessage({ type: 'load_models' });
  }

  addImage(imageId: string, imageData: ArrayBuffer) {
    this.worker.postMessage(
      { type: 'add_image', payload: { imageId, imageData } },
      [imageData]
    );
  }

  setImage(imageData: ArrayBuffer) {
    this.runId++;
    this.imageReady = false;
    this.stage = 'idle';
    this.error = null;
    this.worker.postMessage(
      { type: 'set_image', payload: { imageData } },
      [imageData]
    );
  }

  runPipeline(imageData: ArrayBuffer) {
    this.runId++;
    this.stage = 'segmenting';
    this.error = null;
    this.worker.postMessage(
      { type: 'run_pipeline', payload: { imageData } },
      [imageData]
    );
  }

  prioritizeLines(order: number[]) {
    this.worker.postMessage({ type: 'prioritize', payload: { order } });
  }

  redetectRegion(imageId: string, x: number, y: number, w: number, h: number): string {
    this.regionCounter++;
    const regionId = `region-${this.regionCounter}`;
    this.regionToImage.set(regionId, imageId);
    this.worker.postMessage({ type: 'redetect_region', payload: { imageId, regionId, x, y, w, h } });
    return regionId;
  }

  cancelRegion(regionId: string) {
    this.worker.postMessage({ type: 'cancel_region', payload: { regionId } });
    this.regionToImage.delete(regionId);
  }

  reset() {
    this.runId++;
    this.stage = 'idle';
    this.imageReady = false;
    this.error = null;
    this.currentWork = null;
  }

  destroy() {
    this.worker.terminate();
  }
}
