import type { WorkerOutMessage, PipelineStage, BBox } from "./types";
import { areAllModelsCached } from "./model-cache";
import {
  isGpuServerEnabled,
  gpuDetectLayout,
  gpuDetectLines,
  gpuTranscribe,
  autoDetectGpuServer,
  gpuServerUrl,
} from "./gpu-client";
import { getModelUrls, getModelFetchHeaders } from "./model-config";

export class HTRWorkerState {
  stage = $state<PipelineStage>("idle");
  modelsReady = $state<boolean>(false);
  error = $state<string | null>(null);
  modelProgress = $state<Record<string, number>>({});
  cacheChecked = $state<boolean>(false);
  imageReady = $state<boolean>(false);
  poolSize = $state(1);

  /** Volume-level progress for batch transcription */
  batchProgress = $state<{ current: number; total: number } | null>(null);

  /** All regions currently being transcribed */
  pendingRegions = $state<Set<string>>(new Set());
  /** Image IDs with active transcription */
  pendingImageIds = $state<Set<string>>(new Set());
  /** Number of lines currently being transcribed across all workers */
  pendingLines = $state(0);

  private detectWorker!: Worker;
  private layoutWorker: Worker | null = null;
  private transcribeWorkers: Worker[] = [];
  private nextWorker = 0;
  private regionCounter = 0;

  private detectReady = false;
  private transcribeReadyCount = 0;
  private layoutReady = $state(false);
  running = $state(false);
  private _abortController: AbortController | null = null;

  // Callbacks for multi-image routing
  /** Returns array of assigned line IDs (one per bbox) */
  onRegionDetected:
    | ((
        imageId: string,
        regionId: string,
        startIndex: number,
        lines: BBox[],
      ) => number[])
    | null = null;
  onRegionComplete: ((imageId: string, regionId: string) => void) | null = null;
  onLineComplete:
    | ((
        imageId: string,
        lineIndex: number,
        text: string,
        confidence: number,
      ) => void)
    | null = null;
  onToken:
    | ((imageId: string, lineIndex: number, token: string) => void)
    | null = null;
  onLayoutDetected:
    | ((
        imageId: string,
        regions: {
          label: string;
          confidence: number;
          x: number;
          y: number;
          w: number;
          h: number;
        }[],
      ) => void)
    | null = null;

  private regionPending = new Map<
    string,
    { imageId: string; total: number; done: number }
  >();
  /** Stored image buffers for re-sending to new workers */
  storedImages = new Map<string, ArrayBuffer>();

  constructor() {
    this.createDetectWorker();

    this._init();
  }

  private async _init() {
    // Always start with WASM — GPU is an optional upgrade
    if (import.meta.env.DEV) console.log("[htr] Starting with WASM inference");
    let cached = false;
    try {
      cached = await areAllModelsCached(Object.values(getModelUrls()));
    } catch (e) {
      console.warn("[htr] Cache check failed, continuing:", e);
    }
    this.cacheChecked = true;
    if (cached) {
      this.loadModels();
    }

    // Try to detect GPU server in the background (non-blocking)
    this._detectGpuInBackground();
  }

  private async _detectGpuInBackground() {
    // Check if already configured via localStorage
    if (isGpuServerEnabled()) {
      if (import.meta.env.DEV)
        console.log(
          `[htr] GPU server already configured: ${gpuServerUrl.get()}`,
        );
      return;
    }

    // Try auto-detect once (non-blocking, no retries)
    const url = await autoDetectGpuServer();
    if (url) {
      gpuServerUrl.set(url);
      if (import.meta.env.DEV)
        console.log(`[htr] GPU server auto-detected at ${url}`);
    }
  }

  private createDetectWorker() {
    this.detectWorker = new Worker(
      new URL("../worker-detect.ts", import.meta.url),
      { type: "module" },
    );
    this.detectWorker.onmessage = (e: MessageEvent) =>
      this.handleDetectMessage(e.data);
  }

  private createTranscribeWorkers(count: number) {
    // Terminate existing
    for (const w of this.transcribeWorkers) w.terminate();
    this.transcribeWorkers = [];
    this.transcribeReadyCount = 0;

    for (let i = 0; i < count; i++) {
      const worker = new Worker(
        new URL("../worker-transcribe.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e: MessageEvent) =>
        this.handleTranscribeMessage(e.data);
      // Send worker config (id/pool) — used to be URL params but that broke Vite's worker detection
      worker.postMessage({
        type: "config",
        payload: { id: String(i), pool: String(count) },
      });
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
      const headers = getModelFetchHeaders();
      for (const w of this.transcribeWorkers) {
        w.postMessage({
          type: "load_models",
          payload: {
            modelUrls: {
              encoder: getModelUrls().encoder,
              decoder: getModelUrls().decoder,
              tokenizer: getModelUrls().tokenizer,
            },
            headers,
          },
        });
      }
    }
  }

  private handleDetectMessage(msg: any) {
    switch (msg.type) {
      case "ready":
        this.detectReady = true;
        this.checkAllReady();
        break;
      case "model_status":
        this.stage = "loading_models";
        if (msg.payload.progress !== undefined) {
          this.modelProgress[msg.payload.model] = msg.payload.progress;
        }
        break;
      case "image_ready":
        this.imageReady = true;
        break;
      case "error":
        this.error = msg.payload.message;
        break;
      case "region_lines": {
        const { imageId, regionId, startIndex, lines } = msg.payload;
        this.pendingRegions = new Set([...this.pendingRegions, regionId]);
        this.pendingImageIds = new Set([...this.pendingImageIds, imageId]);
        if (this.stage === "done" || this.stage === "idle") {
          this.stage = "transcribing";
        }

        this.regionPending.set(regionId, {
          imageId,
          total: lines.length,
          done: 0,
        });
        const assignedIds =
          this.onRegionDetected?.(imageId, regionId, startIndex, lines) ?? [];

        // Distribute lines round-robin using assigned line IDs
        const poolSz = this.transcribeWorkers.length;
        for (let i = 0; i < lines.length; i++) {
          const det = lines[i];
          const lineIndex = assignedIds[i] ?? startIndex + i;
          const worker = this.transcribeWorkers[this.nextWorker % poolSz];
          this.nextWorker++;
          this.pendingLines++;
          worker.postMessage({
            type: "transcribe_line",
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
      case "ready":
        this.transcribeReadyCount++;
        this.checkAllReady();
        break;
      case "model_status":
        this.stage = "loading_models";
        if (msg.payload.progress !== undefined) {
          this.modelProgress[msg.payload.model] = msg.payload.progress;
        }
        break;
      case "error":
        this.error = msg.payload.message;
        break;
      case "token": {
        const { imageId, lineIndex, token } = msg.payload;
        this.onToken?.(imageId, lineIndex, token);
        break;
      }
      case "line_done": {
        const { imageId, regionId, lineIndex, text, confidence } = msg.payload;
        this.pendingLines = Math.max(0, this.pendingLines - 1);
        this.onLineComplete?.(imageId, lineIndex, text, confidence);

        const pending = this.regionPending.get(regionId);
        if (pending) {
          pending.done++;
          if (pending.done >= pending.total) {
            this.regionPending.delete(regionId);
            // Remove from active sets
            const nextRegions = new Set(this.pendingRegions);
            nextRegions.delete(regionId);
            this.pendingRegions = nextRegions;
            // Check if this image still has active regions
            const imageStillActive = [...this.regionPending.values()].some(
              (r) => r.imageId === imageId,
            );
            if (!imageStillActive) {
              const nextImages = new Set(this.pendingImageIds);
              nextImages.delete(imageId);
              this.pendingImageIds = nextImages;
            }
            this.onRegionComplete?.(imageId, regionId);
          }
        }

        if (this.pendingLines === 0 && this.regionPending.size === 0) {
          this.stage = "done";
          this.pendingRegions = new Set();
          this.pendingImageIds = new Set();
        }
        break;
      }
    }
  }

  private checkAllReady() {
    if (
      this.detectReady &&
      this.layoutReady &&
      this.transcribeReadyCount >= this.poolSize
    ) {
      this.modelsReady = true;
      this.stage = "idle";
    }
  }

  loadModels() {
    this.stage = "loading_models";

    // Create transcribe workers if not yet created
    if (this.transcribeWorkers.length === 0) {
      this.createTranscribeWorkers(this.poolSize);
    }

    // Create layout worker eagerly
    if (!this.layoutWorker) {
      this.layoutWorker = new Worker(
        new URL("../worker-layout.ts", import.meta.url),
        { type: "module" },
      );
      this.layoutWorker.onmessage = (e: MessageEvent) =>
        this.handleLayoutMessage(e.data);
    }

    const headers = getModelFetchHeaders();
    this.detectWorker.postMessage({
      type: "load_models",
      payload: { modelUrl: getModelUrls().yolo, headers },
    });
    this.layoutWorker.postMessage({
      type: "load_model",
      payload: { modelUrl: getModelUrls().layout, headers },
    });
    for (const w of this.transcribeWorkers) {
      w.postMessage({
        type: "load_models",
        payload: {
          modelUrls: {
            encoder: getModelUrls().encoder,
            decoder: getModelUrls().decoder,
            tokenizer: getModelUrls().tokenizer,
          },
          headers,
        },
      });
    }
  }

  addImage(imageId: string, imageData: ArrayBuffer) {
    // Keep a copy for GPU client and re-sending to new workers
    this.storedImages.set(imageId, imageData.slice(0));

    // Only send to workers if they're initialized (not in GPU-only mode)
    if (this.detectReady) {
      this.detectWorker.postMessage({
        type: "add_image",
        payload: { imageId, imageData: imageData.slice(0) },
      });
    }
    for (const w of this.transcribeWorkers) {
      w.postMessage({
        type: "add_image",
        payload: { imageId, imageData: imageData.slice(0) },
      });
    }
  }

  transcribeRegion(
    imageId: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): string {
    this.regionCounter++;
    const regionId = `region-${this.regionCounter}`;

    if (isGpuServerEnabled()) {
      this._gpuDetectAndTranscribe(imageId, regionId, x, y, w, h);
      return regionId;
    }

    this.detectWorker.postMessage({
      type: "redetect_region",
      payload: { imageId, regionId, x, y, w, h },
    });
    return regionId;
  }

  private async _gpuDetectAndTranscribe(
    imageId: string,
    regionId: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const imageData = this.storedImages.get(imageId);
    if (!imageData) return;

    try {
      this.pendingRegions = new Set([...this.pendingRegions, regionId]);
      this.pendingImageIds = new Set([...this.pendingImageIds, imageId]);
      if (this.stage === "done" || this.stage === "idle") {
        this.stage = "transcribing";
      }

      // Detect lines via GPU (image already uploaded, uses cached ID)
      const { lines } = await gpuDetectLines(
        imageData,
        { x, y, w, h },
        imageId,
      );
      const startIndex = this._getNextLineIndex(imageId, lines.length);
      const bboxes: BBox[] = lines.map((l) => ({
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
        confidence: l.confidence,
      }));
      const assignedIds =
        this.onRegionDetected?.(imageId, regionId, startIndex, bboxes) ?? [];

      // Transcribe all lines in parallel — keeps GPU saturated via Ray batching
      if (this._abortController?.signal.aborted) return;
      this.pendingLines += lines.length;
      const transcribePromises = lines.map((line, i) => {
        const lineId = assignedIds[i] ?? startIndex + i;
        return gpuTranscribe(
          imageData,
          { x: line.x, y: line.y, w: line.w, h: line.h },
          imageId,
        )
          .then(({ text, confidence }) => {
            this.pendingLines = Math.max(0, this.pendingLines - 1);
            this.onLineComplete?.(imageId, lineId, text, confidence);
          })
          .catch(() => {
            this.pendingLines = Math.max(0, this.pendingLines - 1);
            this.onLineComplete?.(imageId, lineId, "[error]", 0);
          });
      });
      await Promise.all(transcribePromises);

      // Region done
      const nextRegions = new Set(this.pendingRegions);
      nextRegions.delete(regionId);
      this.pendingRegions = nextRegions;
      // Check if image still has active regions
      const imageStillActive = [...this.pendingRegions].some((rid) => {
        // Check regionPending for WASM regions
        const pending = this.regionPending.get(rid);
        return pending?.imageId === imageId;
      });
      if (!imageStillActive) {
        const nextImages = new Set(this.pendingImageIds);
        nextImages.delete(imageId);
        this.pendingImageIds = nextImages;
      }
      this.onRegionComplete?.(imageId, regionId);

      if (this.pendingLines === 0 && this.pendingRegions.size === 0) {
        this.stage = "done";
        this.pendingImageIds = new Set();
      }
    } catch (err: any) {
      this.error = err.message ?? String(err);
      const nextRegions = new Set(this.pendingRegions);
      nextRegions.delete(regionId);
      this.pendingRegions = nextRegions;
      if (this.pendingRegions.size === 0) {
        this.stage = "done";
        this.pendingImageIds = new Set();
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
  async runMultiple(imageIds: string[]) {
    for (const id of imageIds) {
      await this.run(id);
    }
  }

  /** Run full pipeline on an image (layout → lines → transcription) */
  async run(imageId: string) {
    if (this.running) return;
    this.running = true;

    if (isGpuServerEnabled()) {
      try {
        const imageData = this.storedImages.get(imageId);
        if (!imageData) {
          this.running = false;
          return;
        }

        // Create abort controller for this pipeline run
        this._abortController = new AbortController();

        // Step 1: Layout detection (one upload)
        const { regions } = await gpuDetectLayout(imageData, imageId);
        this.running = false;
        if (this._abortController?.signal.aborted) return;
        this.onLayoutDetected?.(imageId, regions);

        // Steps 2+3 happen via transcribeRegion which is called by onLayoutDetected
      } catch (err: any) {
        if (err?.name === "AbortError") return; // stopped by user
        this.running = false;
        this.error = err.message ?? String(err);
      }
      return;
    }

    // WASM path
    if (!this.layoutWorker || !this.layoutReady) {
      this.running = false;
      return;
    }

    const imageData = this.storedImages.get(imageId);
    if (imageData) {
      this.layoutWorker.postMessage({
        type: "add_image",
        payload: { imageId, imageData: imageData.slice(0) },
      });
      await new Promise<void>((resolve) => {
        const origHandler = this.layoutWorker!.onmessage;
        this.layoutWorker!.onmessage = (e: MessageEvent) => {
          if (
            e.data.type === "image_ready" &&
            e.data.payload?.imageId === imageId
          ) {
            this.layoutWorker!.onmessage = origHandler;
            resolve();
          } else {
            this.handleLayoutMessage(e.data);
          }
        };
      });
    }

    this.layoutWorker.postMessage({
      type: "detect_layout",
      payload: { imageId },
    });
  }

  private handleLayoutMessage(msg: any) {
    switch (msg.type) {
      case "ready":
        this.layoutReady = true;
        this.checkAllReady();
        break;
      case "model_status":
        this.stage = "loading_models";
        if (msg.payload.progress !== undefined) {
          this.modelProgress["layout"] = msg.payload.progress;
        }
        break;
      case "layout_result": {
        const { imageId, regions } = msg.payload;
        // Call onLayoutDetected first (triggers transcribeRegion → sets pendingRegions)
        // then set running=false. The viewer's isRunning also checks pendingRegions/stage.
        this.onLayoutDetected?.(imageId, regions);
        this.running = false;
        break;
      }
      case "error":
        this.running = false;
        this.error = msg.payload.message;
        break;
    }
  }

  cancelRegion(regionId: string) {
    this.detectWorker.postMessage({
      type: "cancel_region",
      payload: { regionId },
    });
    for (const w of this.transcribeWorkers) {
      w.postMessage({ type: "cancel_region", payload: { regionId } });
    }
    this.regionPending.delete(regionId);
  }

  /** Stop all in-flight GPU requests and cancel WASM regions */
  stopAll() {
    // Abort GPU requests
    this._abortController?.abort();
    this._abortController = null;

    // Cancel WASM regions
    for (const regionId of this.pendingRegions) {
      this.cancelRegion(regionId);
    }

    this.running = false;
    this.stage = "idle";
    this.pendingRegions = new Set();
    this.pendingImageIds = new Set();
    this.pendingLines = 0;
    this.regionPending.clear();
    this.batchProgress = null;
  }

  reset() {
    this.stopAll();
    this.imageReady = false;
    this.error = null;
  }

  destroy() {
    this.detectWorker.terminate();
    this.layoutWorker?.terminate();
    for (const w of this.transcribeWorkers) w.terminate();
  }
}
