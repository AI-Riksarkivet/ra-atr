import type { WorkerOutMessage, PipelineStage, BBox } from './types';
import { areAllModelsCached } from './model-cache';
import { isGpuServerEnabled, gpuDetectLayout, gpuDetectLines, gpuTranscribe, autoDetectGpuServer, gpuServerUrl } from './gpu-client';

const MODEL_URLS = [
  '/models/yolo-lines.onnx',
  '/models/encoder.onnx',
  '/models/decoder.onnx',
  '/models/tokenizer.json',
  '/models/rtmdet-regions.onnx',
];

export class HTRWorkerState {
  stage = $state<PipelineStage>('idle');
  modelsReady = $state<boolean>(false);
  error = $state<string | null>(null);
  modelProgress = $state<Record<string, number>>({});
  cacheChecked = $state<boolean>(false);
  imageReady = $state<boolean>(false);
  poolSize = $state(1);

  /** All regions currently being transcribed */
  activeRegions = $state<Set<string>>(new Set());
  /** Image IDs with active transcription */
  activeImageIds = $state<Set<string>>(new Set());
  /** Number of lines currently being transcribed across all workers */
  activeTranscriptions = $state(0);

  private detectWorker!: Worker;
  private layoutWorker: Worker | null = null;
  private transcribeWorkers: Worker[] = [];
  private nextWorker = 0;
  private regionCounter = 0;

  private detectReady = false;
  private transcribeReadyCount = 0;
  layoutReady = $state(false);
  layoutRunning = $state(false);

  // Callbacks for multi-image routing
  onRegionDetected: ((imageId: string, regionId: string, startIndex: number, lines: BBox[]) => void) | null = null;
  onRegionDone: ((imageId: string, regionId: string) => void) | null = null;
  onLineDone: ((imageId: string, lineIndex: number, text: string, confidence: number) => void) | null = null;
  onToken: ((imageId: string, lineIndex: number, token: string) => void) | null = null;
  onLayoutDetected: ((imageId: string, regions: { label: string; confidence: number; x: number; y: number; w: number; h: number }[]) => void) | null = null;

  private regionPending = new Map<string, { imageId: string; total: number; done: number }>();
  /** Stored image buffers for re-sending to new workers */
  private storedImages = new Map<string, ArrayBuffer>();

  constructor() {
    this.createDetectWorker();

    // Try GPU server first, fall back to WASM
    this._init();
  }

  private async _init() {
    // Auto-detect GPU server if not already configured
    if (!isGpuServerEnabled()) {
      // Retry a few times — GPU server may still be booting
      for (let attempt = 0; attempt < 5; attempt++) {
        const url = await autoDetectGpuServer();
        if (url) {
          gpuServerUrl.set(url);
          console.log(`[htr] Auto-detected GPU server at ${url}`);
          break;
        }
        if (attempt < 4) {
          console.log(`[htr] GPU server not ready, retrying in 3s... (${attempt + 1}/5)`);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    if (isGpuServerEnabled()) {
      // GPU server available — skip WASM model loading
      console.log(`[htr] Using GPU server: ${gpuServerUrl.get()}`);
      this.cacheChecked = true;
      this.modelsReady = true;
      this.layoutReady = true;
      this.stage = 'idle';
      return;
    }

    // Fall back to WASM
    console.log('[htr] No GPU server found, using WASM');
    const cached = await areAllModelsCached(MODEL_URLS);
    this.cacheChecked = true;
    if (cached) {
      this.loadModels();
    }
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
        this.activeRegions = new Set([...this.activeRegions, regionId]);
        this.activeImageIds = new Set([...this.activeImageIds, imageId]);
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
        const { imageId, regionId, lineIndex, text, confidence } = msg.payload;
        this.activeTranscriptions = Math.max(0, this.activeTranscriptions - 1);
        this.onLineDone?.(imageId, lineIndex, text, confidence);

        const pending = this.regionPending.get(regionId);
        if (pending) {
          pending.done++;
          if (pending.done >= pending.total) {
            this.regionPending.delete(regionId);
            // Remove from active sets
            const nextRegions = new Set(this.activeRegions);
            nextRegions.delete(regionId);
            this.activeRegions = nextRegions;
            // Check if this image still has active regions
            const imageStillActive = [...this.regionPending.values()].some(r => r.imageId === imageId);
            if (!imageStillActive) {
              const nextImages = new Set(this.activeImageIds);
              nextImages.delete(imageId);
              this.activeImageIds = nextImages;
            }
            this.onRegionDone?.(imageId, regionId);
          }
        }

        if (this.activeTranscriptions === 0 && this.regionPending.size === 0) {
          this.stage = 'done';
          this.activeRegions = new Set();
          this.activeImageIds = new Set();
        }
        break;
      }
    }
  }

  private checkAllReady() {
    if (this.detectReady && this.layoutReady && this.transcribeReadyCount >= this.poolSize) {
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

    // Create layout worker eagerly
    if (!this.layoutWorker) {
      this.layoutWorker = new Worker(
        new URL('../worker-layout.ts', import.meta.url),
        { type: 'module' },
      );
      this.layoutWorker.onmessage = (e: MessageEvent) => this.handleLayoutMessage(e.data);
    }

    this.detectWorker.postMessage({ type: 'load_models' });
    this.layoutWorker.postMessage({ type: 'load_model' });
    for (const w of this.transcribeWorkers) {
      w.postMessage({ type: 'load_models' });
    }
  }

  addImage(imageId: string, imageData: ArrayBuffer) {
    // Keep a copy for GPU client and re-sending to new workers
    this.storedImages.set(imageId, imageData.slice(0));

    // Only send to workers if they're initialized (not in GPU-only mode)
    if (this.detectReady) {
      this.detectWorker.postMessage(
        { type: 'add_image', payload: { imageId, imageData: imageData.slice(0) } },
      );
    }
    for (const w of this.transcribeWorkers) {
      w.postMessage(
        { type: 'add_image', payload: { imageId, imageData: imageData.slice(0) } },
      );
    }
  }

  redetectRegion(imageId: string, x: number, y: number, w: number, h: number): string {
    this.regionCounter++;
    const regionId = `region-${this.regionCounter}`;

    if (isGpuServerEnabled()) {
      this._gpuDetectAndTranscribe(imageId, regionId, x, y, w, h);
      return regionId;
    }

    this.detectWorker.postMessage({
      type: 'redetect_region',
      payload: { imageId, regionId, x, y, w, h },
    });
    return regionId;
  }

  private async _gpuDetectAndTranscribe(
    imageId: string, regionId: string,
    x: number, y: number, w: number, h: number,
  ) {
    const imageData = this.storedImages.get(imageId);
    if (!imageData) return;

    try {
      this.activeRegions = new Set([...this.activeRegions, regionId]);
      this.activeImageIds = new Set([...this.activeImageIds, imageId]);
      if (this.stage === 'done' || this.stage === 'idle') {
        this.stage = 'transcribing';
      }

      // Detect lines via GPU
      const { lines } = await gpuDetectLines(imageData, { x, y, w, h });
      const startIndex = this._getNextLineIndex(imageId, lines.length);
      const bboxes: BBox[] = lines.map(l => ({ x: l.x, y: l.y, w: l.w, h: l.h, confidence: l.confidence }));
      this.onRegionDetected?.(imageId, regionId, startIndex, bboxes);

      // Transcribe each line via GPU
      this.activeTranscriptions += lines.length;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          const { text, confidence } = await gpuTranscribe(imageData, {
            x: line.x, y: line.y, w: line.w, h: line.h,
          });
          this.activeTranscriptions = Math.max(0, this.activeTranscriptions - 1);
          this.onLineDone?.(imageId, startIndex + i, text, confidence);
        } catch (err) {
          this.activeTranscriptions = Math.max(0, this.activeTranscriptions - 1);
          this.onLineDone?.(imageId, startIndex + i, `[error]`, 0);
        }
      }

      // Region done
      const nextRegions = new Set(this.activeRegions);
      nextRegions.delete(regionId);
      this.activeRegions = nextRegions;
      // Check if image still has active regions
      const imageStillActive = [...this.activeRegions].some(rid => {
        // Check regionPending for WASM regions
        const pending = this.regionPending.get(rid);
        return pending?.imageId === imageId;
      });
      if (!imageStillActive) {
        const nextImages = new Set(this.activeImageIds);
        nextImages.delete(imageId);
        this.activeImageIds = nextImages;
      }
      this.onRegionDone?.(imageId, regionId);

      if (this.activeTranscriptions === 0 && this.activeRegions.size === 0) {
        this.stage = 'done';
        this.activeImageIds = new Set();
      }
    } catch (err: any) {
      this.error = err.message ?? String(err);
      const nextRegions = new Set(this.activeRegions);
      nextRegions.delete(regionId);
      this.activeRegions = nextRegions;
      if (this.activeRegions.size === 0) {
        this.stage = 'done';
        this.activeImageIds = new Set();
      }
    }
  }

  private _gpuLineCounters = new Map<string, number>();
  private _getNextLineIndex(imageId: string, count: number): number {
    const prev = this._gpuLineCounters.get(imageId) ?? 0;
    this._gpuLineCounters.set(imageId, prev + count);
    return prev;
  }

  /** Run layout detection on multiple images sequentially */
  async detectLayoutMultiple(imageIds: string[]) {
    for (const id of imageIds) {
      await this.detectLayout(id);
    }
  }

  /** Run layout detection on an image */
  async detectLayout(imageId: string) {
    if (this.layoutRunning) return;
    this.layoutRunning = true;

    if (isGpuServerEnabled()) {
      try {
        const imageData = this.storedImages.get(imageId);
        if (!imageData) { this.layoutRunning = false; return; }
        const { regions } = await gpuDetectLayout(imageData);
        this.layoutRunning = false;
        this.onLayoutDetected?.(imageId, regions);
      } catch (err: any) {
        this.layoutRunning = false;
        this.error = err.message ?? String(err);
      }
      return;
    }

    // WASM path
    if (!this.layoutWorker || !this.layoutReady) { this.layoutRunning = false; return; }

    const imageData = this.storedImages.get(imageId);
    if (imageData) {
      this.layoutWorker.postMessage(
        { type: 'add_image', payload: { imageId, imageData: imageData.slice(0) } },
      );
      await new Promise<void>((resolve) => {
        const origHandler = this.layoutWorker!.onmessage;
        this.layoutWorker!.onmessage = (e: MessageEvent) => {
          if (e.data.type === 'image_ready' && e.data.payload?.imageId === imageId) {
            this.layoutWorker!.onmessage = origHandler;
            resolve();
          } else {
            this.handleLayoutMessage(e.data);
          }
        };
      });
    }

    this.layoutWorker.postMessage({ type: 'detect_layout', payload: { imageId } });
  }

  private handleLayoutMessage(msg: any) {
    switch (msg.type) {
      case 'ready':
        this.layoutReady = true;
        this.checkAllReady();
        break;
      case 'model_status':
        this.stage = 'loading_models';
        if (msg.payload.progress !== undefined) {
          this.modelProgress['layout'] = msg.payload.progress;
        }
        break;
      case 'layout_result': {
        const { imageId, regions } = msg.payload;
        this.layoutRunning = false;
        this.onLayoutDetected?.(imageId, regions);
        break;
      }
      case 'error':
        this.layoutRunning = false;
        this.error = msg.payload.message;
        break;
    }
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
    this.activeRegions = new Set();
    this.activeImageIds = new Set();
    this.activeTranscriptions = 0;
    this.regionPending.clear();
  }

  destroy() {
    this.detectWorker.terminate();
    this.layoutWorker?.terminate();
    for (const w of this.transcribeWorkers) w.terminate();
  }
}
