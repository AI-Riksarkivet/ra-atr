export const MODEL_BASE = import.meta.env.VITE_MODEL_BASE || '/models';
export const DEFAULT_GPU_SERVER = import.meta.env.VITE_GPU_SERVER || '';

export function getModelUrl(path: string): string {
	return `${MODEL_BASE}/${path}`;
}

export function isHuggingFaceUrl(): boolean {
	return MODEL_BASE.startsWith('https://huggingface.co');
}

export function getModelUrls() {
	return {
		yolo: getModelUrl('yolo-lines.onnx'),
		encoder: getModelUrl('encoder.onnx'),
		decoder: getModelUrl('decoder.onnx'),
		tokenizer: getModelUrl('tokenizer.json'),
		layout: getModelUrl('rtmdet-regions.onnx'),
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
