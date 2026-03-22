/** Lightweight i18n for Lejonet — Swedish + English */

export type Locale = 'en' | 'sv';

const translations: Record<string, Record<Locale, string>> = {
	// Loading screen
	'app.title': { en: 'Lejonet HTR', sv: 'Lejonet HTR' },
	'app.description': {
		en: 'Transcribe handwritten Swedish historical documents directly in your browser. All inference runs locally — no data leaves your device.',
		sv: 'Transkribera handskrivna svenska historiska dokument direkt i din webbläsare. All inferens körs lokalt — ingen data lämnar din enhet.',
	},
	'models.pipeline': { en: 'HTR Pipeline', sv: 'HTR-pipeline' },
	'models.ready': { en: 'Models Ready', sv: 'Modeller redo' },
	'models.downloading': { en: 'Downloading', sv: 'Laddar ner' },
	'models.download': { en: 'Download Models', sv: 'Ladda ner modeller' },
	'models.cached': {
		en: 'Cached after first download — loads instantly next time',
		sv: 'Cachad efter första nedladdningen — laddas direkt nästa gång',
	},
	'models.loading': {
		en: 'Loading cached models...',
		sv: 'Laddar cachade modeller...',
	},
	'models.info': {
		en: 'HTR models run entirely in your browser using ONNX Runtime. Total download: ~1.8 GB (cached after first load).',
		sv: 'HTR-modeller körs helt i din webbläsare med ONNX Runtime. Total nedladdning: ~1,8 GB (cachas efter första laddningen).',
	},
	'models.failed': { en: 'Download failed', sv: 'Nedladdning misslyckades' },
	'models.retry': { en: 'Retry', sv: 'Försök igen' },

	// Model names
	'model.layout': { en: 'Layout Detection', sv: 'Layoutdetektering' },
	'model.layout.desc': { en: 'RTMDet regions', sv: 'RTMDet-regioner' },
	'model.yolo': { en: 'Line Detection', sv: 'Raddetektering' },
	'model.yolo.desc': { en: 'YOLO segments', sv: 'YOLO-segment' },
	'model.encoder': { en: 'Text Encoder', sv: 'Textkodare' },
	'model.encoder.desc': { en: 'TrOCR vision', sv: 'TrOCR-vision' },
	'model.decoder': { en: 'Text Decoder', sv: 'Textavkodare' },
	'model.decoder.desc': { en: 'TrOCR language', sv: 'TrOCR-språk' },
	'model.tokenizer': { en: 'Tokenizer', sv: 'Tokeniserare' },
	'model.tokenizer.desc': { en: 'BPE vocab', sv: 'BPE-vokabulär' },

	// Upload panel
	'upload.drop': {
		en: 'Drop images here or click to upload',
		sv: 'Släpp bilder här eller klicka för att ladda upp',
	},
	'upload.hint1': {
		en: 'Upload scanned pages of handwritten documents.',
		sv: 'Ladda upp skannade sidor av handskrivna dokument.',
	},
	'upload.hint2': {
		en: 'Then press',
		sv: 'Tryck sedan på',
	},
	'upload.hint3': {
		en: 'to transcribe.',
		sv: 'för att transkribera.',
	},
	'upload.demo': { en: 'Try demo image', sv: 'Testa demobild' },
	'upload.loading': { en: 'Loading...', sv: 'Laddar...' },

	// Toolbar
	'toolbar.home': { en: 'Home', sv: 'Hem' },
	'toolbar.catalog': { en: 'Toggle catalog', sv: 'Visa/dölj katalog' },
	'toolbar.search': { en: 'Search catalog...', sv: 'Sök i katalog...' },
	'toolbar.transcriptions': {
		en: 'Toggle transcriptions',
		sv: 'Visa/dölj transkriptioner',
	},
	'toolbar.boxes': { en: 'Show line boxes', sv: 'Visa radbegränsningar' },
	'toolbar.hideBoxes': { en: 'Hide line boxes', sv: 'Dölj radbegränsningar' },
	'toolbar.textOverlay': {
		en: 'Show transcriptions on image',
		sv: 'Visa transkriptioner på bilden',
	},
	'toolbar.hideTextOverlay': {
		en: 'Hide text overlay',
		sv: 'Dölj textöverlägg',
	},
	'toolbar.selectMode': {
		en: 'Draw region to transcribe',
		sv: 'Rita region att transkribera',
	},
	'toolbar.panMode': {
		en: 'Switch to pan mode',
		sv: 'Byt till panoreringsläge',
	},
	'toolbar.transcribe': { en: 'Transcribe page', sv: 'Transkribera sida' },
	'toolbar.retranscribe': {
		en: 'Re-transcribe page',
		sv: 'Transkribera sida igen',
	},
	'toolbar.filters': { en: 'Image adjustments', sv: 'Bildjusteringar' },
	'toolbar.metadata': { en: 'Page metadata', sv: 'Sidmetadata' },
	'toolbar.fullscreen': { en: 'Fullscreen', sv: 'Helskärm' },
	'toolbar.print': { en: 'Print', sv: 'Skriv ut' },

	// Pending region
	'region.analyzing': { en: 'Analyzing...', sv: 'Analyserar...' },

	// Export
	'export.title': {
		en: 'Export transcriptions',
		sv: 'Exportera transkriptioner',
	},
	'export.plainText': { en: 'Plain text', sv: 'Ren text' },

	// GPU settings
	'gpu.title': { en: 'GPU Inference Server', sv: 'GPU-inferensserver' },
	'gpu.connect': { en: 'Connect', sv: 'Anslut' },
	'gpu.connectGpu': {
		en: 'Connect to GPU server',
		sv: 'Anslut till GPU-server',
	},
	'gpu.connected': { en: 'Connected', sv: 'Ansluten' },
	'gpu.failed': { en: 'Failed to connect', sv: 'Kunde inte ansluta' },
	'gpu.disconnect': {
		en: 'Disconnect (use WASM)',
		sv: 'Koppla från (använd WASM)',
	},
	'gpu.local': {
		en: 'Using local WASM inference',
		sv: 'Använder lokal WASM-inferens',
	},

	// Transcription panel
	'transcription.pressPlay': { en: 'Press', sv: 'Tryck' },
	'transcription.toTranscribe': {
		en: 'to transcribe this page',
		sv: 'för att transkribera denna sida',
	},
	'transcription.filter': {
		en: 'Filter transcriptions...',
		sv: 'Filtrera transkriptioner...',
	},
	'transcription.ready': { en: 'Ready', sv: 'Klar' },
	'transcription.noRegions': {
		en: 'No regions detected',
		sv: 'Inga regioner hittades',
	},

	// Theme
	'theme.toggle': { en: 'Toggle theme', sv: 'Byt tema' },
};

// Persisted locale state
const STORAGE_KEY = 'lejonet-locale';

function getInitialLocale(): Locale {
	if (typeof localStorage !== 'undefined') {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'sv' || stored === 'en') return stored;
	}
	// Auto-detect from browser
	if (typeof navigator !== 'undefined') {
		const lang = navigator.language.toLowerCase();
		if (lang.startsWith('sv')) return 'sv';
	}
	return 'en';
}

let currentLocale = $state<Locale>(getInitialLocale());

export function getLocale(): Locale {
	return currentLocale;
}

export function setLocale(locale: Locale) {
	currentLocale = locale;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, locale);
	}
}

export function t(key: string): string {
	const entry = translations[key];
	if (!entry) return key;
	return entry[currentLocale] ?? entry['en'] ?? key;
}

export function locale(): Locale {
	return currentLocale;
}
