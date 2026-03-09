import type { WorkerOutMessage, PipelineStage, Line } from './types';
import { areAllModelsCached } from './model-cache';

const MODEL_URLS = [
  '/models/yolo-lines.onnx',
  '/models/encoder.onnx',
  '/models/decoder.onnx',
  '/models/tokenizer.json',
];

export class HTRWorkerState {
  stage = $state<PipelineStage>('idle');
  lines = $state<Line[]>([]);
  currentLine = $state<number>(-1);
  currentText = $state<string>('');
  modelsReady = $state<boolean>(false);
  error = $state<string | null>(null);
  modelProgress = $state<Record<string, number>>({});
  /** True once we've checked the cache; false while checking */
  cacheChecked = $state<boolean>(false);

  private worker!: Worker;
  private runId = 0;

  constructor() {
    this.createWorker();

    // Auto-load if all models are already cached
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

  private handleMessage(msg: WorkerOutMessage) {
    const expectedRun = this.runId;

    switch (msg.type) {
      // Model messages are always valid
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
      case 'error':
        this.error = msg.payload.message;
        break;

      // Pipeline messages — ignore if from a stale run
      case 'segmentation':
        if (expectedRun !== this.runId) break;
        this.stage = 'transcribing';
        this.lines = msg.payload.lines.map((bbox) => ({
          bbox,
          text: '',
          confidence: 0,
          complete: false,
        }));
        break;
      case 'token':
        if (expectedRun !== this.runId) break;
        this.currentLine = msg.payload.lineIndex;
        this.currentText += msg.payload.token;
        if (this.lines[msg.payload.lineIndex]) {
          this.lines[msg.payload.lineIndex].text = this.currentText;
        }
        break;
      case 'beam_update':
        if (expectedRun !== this.runId) break;
        this.currentLine = msg.payload.lineIndex;
        this.currentText = msg.payload.text;
        if (this.lines[msg.payload.lineIndex]) {
          this.lines[msg.payload.lineIndex].text = msg.payload.text;
        }
        break;
      case 'line_done':
        if (expectedRun !== this.runId) break;
        if (this.lines[msg.payload.lineIndex]) {
          this.lines[msg.payload.lineIndex].text = msg.payload.text;
          this.lines[msg.payload.lineIndex].confidence = msg.payload.confidence;
          this.lines[msg.payload.lineIndex].complete = true;
        }
        this.currentText = '';
        break;
      case 'pipeline_done':
        if (expectedRun !== this.runId) break;
        this.stage = 'done';
        this.currentLine = -1;
        break;
    }
  }

  loadModels() {
    this.stage = 'loading_models';
    this.worker.postMessage({ type: 'load_models' });
  }

  runPipeline(imageData: ArrayBuffer) {
    this.runId++;
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

  prioritizeLines(order: number[]) {
    this.worker.postMessage({ type: 'prioritize', payload: { order } });
  }

  reset() {
    this.runId++;
    this.stage = 'idle';
    this.lines = [];
    this.currentLine = -1;
    this.currentText = '';
    this.error = null;
  }

  destroy() {
    this.worker.terminate();
  }
}
