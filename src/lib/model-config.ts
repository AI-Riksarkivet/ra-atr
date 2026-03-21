export const MODEL_BASE = import.meta.env.VITE_MODEL_BASE || '/models';
export const DEFAULT_GPU_SERVER = import.meta.env.VITE_GPU_SERVER || '';

const QUANTIZATION_KEY = 'lejonet-model-quantization';

export type ModelQuantization = 'fp32' | 'int8';

export function getQuantization(): ModelQuantization {
  if (typeof localStorage === 'undefined') return 'fp32';
  return (localStorage.getItem(QUANTIZATION_KEY) as ModelQuantization) || 'fp32';
}

export function setQuantization(q: ModelQuantization) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(QUANTIZATION_KEY, q);
}

export function getModelUrl(path: string): string {
  return `${MODEL_BASE}/${path}`;
}

export function isHuggingFaceUrl(): boolean {
  return MODEL_BASE.startsWith('https://huggingface.co');
}

function modelFile(base: string): string {
  if (getQuantization() === 'int8') return base.replace('.onnx', '-int8.onnx');
  return base;
}

export function getModelUrls() {
  return {
    yolo: getModelUrl(modelFile('yolo-lines.onnx')),
    encoder: getModelUrl(modelFile('encoder.onnx')),
    decoder: getModelUrl(modelFile('decoder.onnx')),
    tokenizer: getModelUrl('tokenizer.json'),
    layout: getModelUrl(modelFile('rtmdet-regions.onnx')),
  };
}


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
