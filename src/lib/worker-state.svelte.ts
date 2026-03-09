import type { WorkerOutMessage, PipelineStage, BBox } from './types';
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
  poolSize = $state(2);

  /** Currently processing: { imageId, regionId } or null */
  currentWork = $state<{ imageId: string; regionId: string } | null>(null);
  /** Number of lines currently being transcribed across all workers */
  activeTranscriptions = $state(0);

  private detectWorker!: Worker;
  private transcribeWorkers: Worker[] = [];
  private nextWorker = 0;
  private regionCounter = 0;

  private detectReady = false;
  private transcribeReadyCount = 0;

  // Callbacks for multi-image routing
  onRegionDetected: ((imageId: string, regionId: string, startIndex: number, lines: BBox[]) => void) | null = null;
  onRegionDone: ((imageId: string, regionId: string) => void) | null = null;
  onLineDone: ((imageId: string, lineIndex: number, text: string, confidence: number) => void) | null = null;
  onToken: ((imageId: string, lineIndex: number, token: string) => void) | null = null;

  private regionPending = new Map<string, { imageId: string; total: number; done: number }>();
  /** Stored image buffers for re-sending to new workers */
  private storedImages = new Map<string, ArrayBuffer>();

  constructor() {
    this.createDetectWorker();

    areAllModelsCached(MODEL_URLS).then((cached) => {
      this.cacheChecked = true;
      if (cached) {
        this.loadModels();
      }
    });
  }

  private createDetectWorker() {
    this.detectWorker = new Worker(
      new URL('../worker-detect.ts', import.meta.url),
      { type: 'module' }
    );
    this.detectWorker.onmessage = (e: MessageEvent) => this.handleDetectMessage(e.data);
  }

  private createTranscribeWorkers(count: number) {
    // Terminate existing
    for (const w of this.transcribeWorkers) w.terminate();
    this.transcribeWorkers = [];
    this.transcribeReadyCount = 0;

    for (let i = 0; i < count; i++) {
      const url = new URL('../worker-transcribe.ts', import.meta.url);
      url.searchParams.set('id', String(i));
      url.searchParams.set('pool', String(count));
      const worker = new Worker(url, { type: 'module' });
      worker.onmessage = (e: MessageEvent) => this.handleTranscribeMessage(e.data);
      this.transcribeWorkers.push(worker);
    }
  }

  /** Change pool size. Only allowed before workers have been used (no images added). */
  setPoolSize(n: number) {
    n = Math.max(1, Math.min(8, n));
    if (n === this.poolSize) return;
    // Don't allow resize after images have been sent to workers
    if (this.storedImages.size > 0) return;
    this.poolSize = n;
    // Recreate workers with new pool size
    this.createTranscribeWorkers(n);
    if (this.detectReady) {
      this.modelsReady = false;
      for (const w of this.transcribeWorkers) {
        w.postMessage({ type: 'load_models' });
      }
    }
  }

  private handleDetectMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        this.detectReady = true;
        this.checkAllReady();
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
      case 'region_lines': {
        const { imageId, regionId, startIndex, lines } = msg.payload;
        this.currentWork = { imageId, regionId };
        if (this.stage === 'done' || this.stage === 'idle') {
          this.stage = 'transcribing';
        }

        this.regionPending.set(regionId, { imageId, total: lines.length, done: 0 });
        this.onRegionDetected?.(imageId, regionId, startIndex, lines);

        // Distribute lines round-robin
        const poolSz = this.transcribeWorkers.length;
        for (let i = 0; i < lines.length; i++) {
          const det = lines[i];
          const lineIndex = startIndex + i;
          const worker = this.transcribeWorkers[this.nextWorker % poolSz];
          this.nextWorker++;
          this.activeTranscriptions++;
          worker.postMessage({
            type: 'transcribe_line',
            payload: {
              imageId,
              regionId,
              lineIndex,
              bbox: { x: det.x, y: det.y, w: det.w, h: det.h },
              confidence: det.confidence,
            },
          });
        }
        break;
      }
    }
  }

  private handleTranscribeMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        this.transcribeReadyCount++;
        this.checkAllReady();
        break;
      case 'model_status':
        this.stage = 'loading_models';
        if (msg.payload.progress !== undefined) {
          this.modelProgress[msg.payload.model] = msg.payload.progress;
        }
        break;
      case 'error':
        this.error = msg.payload.message;
        break;
      case 'token': {
        const { imageId, lineIndex, token } = msg.payload;
        this.onToken?.(imageId, lineIndex, token);
        break;
      }
      case 'line_done': {
        const { imageId, lineIndex, text, confidence } = msg.payload;
        this.activeTranscriptions = Math.max(0, this.activeTranscriptions - 1);
        this.onLineDone?.(imageId, lineIndex, text, confidence);

        for (const [regionId, info] of this.regionPending) {
          if (info.imageId === imageId) {
            info.done++;
            if (info.done >= info.total) {
              this.regionPending.delete(regionId);
              this.onRegionDone?.(imageId, regionId);
            }
            break;
          }
        }

        if (this.activeTranscriptions === 0 && this.regionPending.size === 0) {
          this.stage = 'done';
          this.currentWork = null;
        }
        break;
      }
    }
  }

  private checkAllReady() {
    if (this.detectReady && this.transcribeReadyCount >= this.poolSize) {
      this.modelsReady = true;
      this.stage = 'idle';
    }
  }

  loadModels() {
    this.stage = 'loading_models';

    // Create transcribe workers if not yet created
    if (this.transcribeWorkers.length === 0) {
      this.createTranscribeWorkers(this.poolSize);
    }

    this.detectWorker.postMessage({ type: 'load_models' });
    for (const w of this.transcribeWorkers) {
      w.postMessage({ type: 'load_models' });
    }
  }

  addImage(imageId: string, imageData: ArrayBuffer) {
    // Keep a copy for re-sending to new workers on pool resize
    this.storedImages.set(imageId, imageData.slice(0));
    this.detectWorker.postMessage(
      { type: 'add_image', payload: { imageId, imageData: imageData.slice(0) } },
    );
    for (const w of this.transcribeWorkers) {
      w.postMessage(
        { type: 'add_image', payload: { imageId, imageData: imageData.slice(0) } },
      );
    }
  }

  redetectRegion(imageId: string, x: number, y: number, w: number, h: number): string {
    this.regionCounter++;
    const regionId = `region-${this.regionCounter}`;
    this.detectWorker.postMessage({
      type: 'redetect_region',
      payload: { imageId, regionId, x, y, w, h },
    });
    return regionId;
  }

  cancelRegion(regionId: string) {
    this.detectWorker.postMessage({ type: 'cancel_region', payload: { regionId } });
    for (const w of this.transcribeWorkers) {
      w.postMessage({ type: 'cancel_region', payload: { regionId } });
    }
    this.regionPending.delete(regionId);
  }

  reset() {
    this.stage = 'idle';
    this.imageReady = false;
    this.error = null;
    this.currentWork = null;
    this.activeTranscriptions = 0;
    this.regionPending.clear();
  }

  destroy() {
    this.detectWorker.terminate();
    for (const w of this.transcribeWorkers) w.terminate();
  }
}
