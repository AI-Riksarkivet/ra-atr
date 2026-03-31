// ---------------------------------------------------------------------------
// Model profiles & configuration
// ---------------------------------------------------------------------------

export type ModelProfileId = 'swedish-lion' | 'tridis';

export interface ModelProfile {
	id: ModelProfileId;
	name: { en: string; sv: string };
	description: { en: string; sv: string };
	baseUrl: string;
	totalSize: string;
	modelSizes: {
		layout: string;
		yolo: string;
		encoder: string;
		decoder: string;
		tokenizer: string;
	};
}

export const MODEL_PROFILES: Record<ModelProfileId, ModelProfile> = {
	'swedish-lion': {
		id: 'swedish-lion',
		name: { en: 'Swedish Lion', sv: 'Svenska Lejonet' },
		description: {
			en: '17th\u201319th century Swedish handwriting',
			sv: 'Svensk handskrift 1600\u20131800-tal',
		},
		baseUrl: 'https://huggingface.co/carpelan/htr-onnx-models/resolve/main',
		totalSize: '~1.8 GB',
		modelSizes: {
			layout: '97 MB',
			yolo: '229 MB',
			encoder: '329 MB',
			decoder: '1.2 GB',
			tokenizer: '2 MB',
		},
	},
	tridis: {
		id: 'tridis',
		name: { en: 'Tridis (Medieval)', sv: 'Tridis (Medeltida)' },
		description: {
			en: 'Medieval Latin and Scandinavian manuscripts',
			sv: 'Medeltida latinska och skandinaviska handskrifter',
		},
		baseUrl: 'https://huggingface.co/carpelan/tridis/resolve/main',
		totalSize: '~2.6 GB',
		modelSizes: {
			layout: '102 MB',
			yolo: '239 MB',
			encoder: '1.2 GB',
			decoder: '1.1 GB',
			tokenizer: '1 MB',
		},
	},
};

export const DEFAULT_MODEL_ID: ModelProfileId = 'swedish-lion';

// ---------------------------------------------------------------------------
// localStorage persistence (key: ra-atr-model)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ra-atr-model';

export function getSelectedModelId(): ModelProfileId {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored && stored in MODEL_PROFILES) {
			return stored as ModelProfileId;
		}
	} catch {
		// localStorage unavailable (e.g. in workers)
	}
	return DEFAULT_MODEL_ID;
}

export function setSelectedModelId(id: ModelProfileId): void {
	try {
		localStorage.setItem(STORAGE_KEY, id);
	} catch {
		// localStorage unavailable
	}
}

export function getSelectedProfile(): ModelProfile {
	return MODEL_PROFILES[getSelectedModelId()];
}

export function getCacheName(): string {
	return `htr-models-${getSelectedModelId()}`;
}

// ---------------------------------------------------------------------------
// Existing exports (kept for backward compatibility)
// ---------------------------------------------------------------------------

export const DEFAULT_GPU_SERVER = import.meta.env.VITE_GPU_SERVER || '';

function getModelBase(): string {
	return import.meta.env.VITE_MODEL_BASE || getSelectedProfile().baseUrl;
}

function getModelUrl(path: string): string {
	return `${getModelBase()}/${path}`;
}

export function isHuggingFaceUrl(): boolean {
	return getModelBase().startsWith('https://huggingface.co');
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
