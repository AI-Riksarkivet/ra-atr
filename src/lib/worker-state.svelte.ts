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

  constructor(backend: 'wasm' | 'webgpu' = 'webgpu') {
    const workerUrl = backend === 'webgpu'
      ? new URL('../worker-ortw.ts', import.meta.url)
      : new URL('../worker.ts', import.meta.url);
    this.worker = new Worker(workerUrl, { type: 'module' });

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
