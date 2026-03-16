export type WorkerInMessage =
  | { type: 'load_models' }
  | { type: 'set_image'; payload: { imageData: ArrayBuffer } }
  | { type: 'add_image'; payload: { imageId: string; imageData: ArrayBuffer } }
  | { type: 'run_pipeline'; payload: { imageData: ArrayBuffer } }
  | { type: 'prioritize'; payload: { order: number[] } }
  | { type: 'redetect_region'; payload: { imageId: string; regionId: string; x: number; y: number; w: number; h: number } }
  | { type: 'cancel_region'; payload: { regionId: string } };

export type WorkerOutMessage =
  | { type: 'model_status'; payload: { model: string; status: 'downloading' | 'cached' | 'loaded'; progress?: number } }
  | { type: 'segmentation'; payload: { lines: BBox[] } }
  | { type: 'token'; payload: { lineIndex: number; token: string } }
  | { type: 'beam_update'; payload: { lineIndex: number; text: string } }
  | { type: 'line_done'; payload: { lineIndex: number; text: string; confidence: number } }
  | { type: 'pipeline_done' }
  | { type: 'error'; payload: { message: string } }
  | { type: 'ready' }
  | { type: 'image_ready' }
  | { type: 'region_lines'; payload: { imageId: string; regionId: string; startIndex: number; lines: BBox[] } }
  | { type: 'region_done'; payload: { imageId: string; regionId: string } };

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
  id: number;
  bbox: BBox;
  text: string;
  confidence: number;
  complete: boolean;
}

export interface LineGroup {
  id: string;
  name: string;
  lineIds: number[];
  collapsed: boolean;
  /** Links to in-flight region detection for cancellation */
  regionId?: string;
  /** Region bounds in image coordinates (persists until group deleted) */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface ImageDocument {
  id: string;
  name: string;
  imageUrl: string;
  /** Kept for re-sending to worker if needed */
  imageData: ArrayBuffer;
  lines: Line[];
  lineCounter: number;
  groups: LineGroup[];
  groupCounter: number;
  /** Riksarkivet metadata for lazy loading */
  manifestId?: string;
  pageNumber?: number;
  /** True if image has not been fetched yet */
  placeholder?: boolean;
}
