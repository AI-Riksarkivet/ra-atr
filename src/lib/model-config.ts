export const MODEL_BASE = import.meta.env.VITE_MODEL_BASE || '/models';
export const DEFAULT_GPU_SERVER = import.meta.env.VITE_GPU_SERVER || '';
const USE_INT8 = import.meta.env.VITE_MODEL_QUANTIZED === 'true';
const USE_FP16 = import.meta.env.VITE_MODEL_FP16 === 'true';

export function getModelUrl(path: string): string {
  return `${MODEL_BASE}/${path}`;
}

export function isHuggingFaceUrl(): boolean {
  return MODEL_BASE.startsWith('https://huggingface.co');
}

function modelFile(base: string): string {
  if (USE_INT8) return base.replace('.onnx', '-int8.onnx');
  if (USE_FP16) return base.replace('.onnx', '-fp16.onnx');
  return base;
}

export const MODEL_URLS = {
  yolo: getModelUrl(modelFile('yolo-lines.onnx')),
  encoder: getModelUrl(modelFile('encoder.onnx')),
  decoder: getModelUrl(modelFile('decoder.onnx')),
  tokenizer: getModelUrl('tokenizer.json'),
  layout: getModelUrl(modelFile('rtmdet-regions.onnx')),
};

export const ALL_MODEL_URLS = Object.values(MODEL_URLS);

/** Get HF token from sessionStorage, if set */
export function getHfToken(): string | null {
  try {
    return sessionStorage.getItem('hf_token');
  } catch {
    return null;
  }
}

/** Build fetch headers for model downloads (adds Bearer token for HF) */
export function getModelFetchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (isHuggingFaceUrl()) {
    const token = getHfToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  return headers;
}
