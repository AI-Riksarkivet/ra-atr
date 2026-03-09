export type WorkerInMessage =
  | { type: 'load_models' }
  | { type: 'run_pipeline'; payload: { imageData: ArrayBuffer } }
  | { type: 'prioritize'; payload: { order: number[] } };

export type WorkerOutMessage =
  | { type: 'model_status'; payload: { model: string; status: 'downloading' | 'cached' | 'loaded'; progress?: number } }
  | { type: 'segmentation'; payload: { lines: BBox[] } }
  | { type: 'token'; payload: { lineIndex: number; token: string } }
  | { type: 'beam_update'; payload: { lineIndex: number; text: string } }
  | { type: 'line_done'; payload: { lineIndex: number; text: string; confidence: number } }
  | { type: 'pipeline_done' }
  | { type: 'error'; payload: { message: string } }
  | { type: 'ready' };

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
  polygon?: Point[];
}

export type PipelineStage = 'idle' | 'loading_models' | 'segmenting' | 'transcribing' | 'done';

export interface Line {
  bbox: BBox;
  text: string;
  confidence: number;
  complete: boolean;
}

export interface LineGroup {
  id: string;
  name: string;
  lineIndices: number[];
  collapsed: boolean;
}
