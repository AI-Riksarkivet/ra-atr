# Dual-Model Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users choose between "Swedish Lion" (default) and "Tridis (Medieval)" TrOCR models on the start screen, with per-model browser caching and auto-detected KV cache architecture.

**Architecture:** Model profiles defined in `model-config.ts` drive URL generation and cache namespacing. The start screen gets a model picker before the mode picker. The transcribe worker auto-detects decoder architecture from ONNX session inputs instead of hardcoded constants.

**Tech Stack:** Svelte 5, TypeScript, ONNX Runtime Web, localStorage, Cache API

---

### Task 1: Add model profiles to model-config.ts

**Files:**
- Modify: `frontend/src/lib/model-config.ts` (full file, 42 lines)

**Step 1: Add the model profiles and selection logic**

Replace the entire `model-config.ts` with:

```ts
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
			en: '17th–19th century Swedish handwriting',
			sv: 'Svensk handskrift 1600–1800-tal',
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

const STORAGE_KEY = 'ra-atr-model';
const DEFAULT_PROFILE: ModelProfileId = 'swedish-lion';

export function getSelectedModelId(): ModelProfileId {
	if (typeof localStorage !== 'undefined') {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored && stored in MODEL_PROFILES) return stored as ModelProfileId;
	}
	return DEFAULT_PROFILE;
}

export function setSelectedModelId(id: ModelProfileId) {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(STORAGE_KEY, id);
	}
}

export function getSelectedProfile(): ModelProfile {
	return MODEL_PROFILES[getSelectedModelId()];
}

/** Cache name for the selected model profile */
export function getCacheName(): string {
	return `htr-models-${getSelectedModelId()}`;
}

export const DEFAULT_GPU_SERVER = import.meta.env.VITE_GPU_SERVER || '';

function getModelBase(): string {
	// VITE_MODEL_BASE overrides profile URLs (for local dev)
	const envBase = import.meta.env.VITE_MODEL_BASE;
	if (envBase) return envBase;
	return getSelectedProfile().baseUrl;
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
```

**Step 2: Verify no type errors**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | head -30`

**Step 3: Commit**

```bash
git add frontend/src/lib/model-config.ts
git commit -m "Add model profiles for Swedish Lion and Tridis"
```

---

### Task 2: Namespace the model cache per profile

**Files:**
- Modify: `frontend/src/lib/model-cache.ts:1` (change CACHE_NAME usage)
- Modify: `frontend/src/lib/model-cache.ts:28-29,81-82,91-92,97-98,103-104` (all `caches.open` calls)

**Step 1: Replace hardcoded CACHE_NAME with dynamic function**

In `model-cache.ts`, replace line 1:
```ts
const CACHE_NAME = 'htr-models-v3';
```
with:
```ts
import { getCacheName } from './model-config';
```

Then replace every `CACHE_NAME` reference with `getCacheName()`:
- Line 29: `caches.open(CACHE_NAME)` → `caches.open(getCacheName())`
- Line 82: `caches.open(CACHE_NAME)` → `caches.open(getCacheName())`
- Line 92: `caches.open(CACHE_NAME)` → `caches.open(getCacheName())`
- Line 98: `caches.open(CACHE_NAME)` → `caches.open(getCacheName())`
- Line 104: `caches.delete(CACHE_NAME)` → `caches.delete(getCacheName())`

**Step 2: Verify no type errors**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | head -30`

**Step 3: Commit**

```bash
git add frontend/src/lib/model-cache.ts
git commit -m "Namespace model cache per profile"
```

---

### Task 3: Auto-detect KV cache architecture in worker-transcribe.ts

**Files:**
- Modify: `frontend/src/worker-transcribe.ts:34-36` (remove hardcoded constants)
- Modify: `frontend/src/worker-transcribe.ts:95` (add detection after session creation)
- Modify: `frontend/src/worker-transcribe.ts:200-208` (use detected values for KV init)
- Modify: `frontend/src/worker-transcribe.ts:227-236` (use detected values for KV read/write)

**Step 1: Replace hardcoded constants with mutable variables**

Remove lines 34-36:
```ts
const NUM_LAYERS = 12;
const NUM_HEADS = 16;
const HEAD_DIM = 64;
```

Replace with:
```ts
let numLayers = 0;
let numHeads = 0;
let headDim = 0;
```

**Step 2: Add detection logic after decoder session creation**

After line 95 (`useKVCache = decoderSession.inputNames.some(...)`), add:
```ts
if (useKVCache) {
	// Detect architecture from input shapes
	const pastKeyNames = decoderSession.inputNames.filter((n) => n.endsWith('.key'));
	numLayers = pastKeyNames.length;
	// Shape of past.0.key is [1, NUM_HEADS, 0, HEAD_DIM]
	const shape = decoderSession.inputNames.includes('past.0.key')
		? (decoderSession as any)._model?.graph?.input?.find?.((i: any) => i.name === 'past.0.key')
		: null;
	// Fallback: try creating a test run or use the first past tensor's expected shape
	// ONNX Runtime Web doesn't expose input shapes directly, so we parse from inputNames
	// and rely on the model metadata or use sensible defaults that work for both models
}
```

Wait — ONNX Runtime Web doesn't expose input tensor shapes via the session API. We need a different approach.

**Better approach:** After the first decoder run (step 0), read the `present.0.key` output tensor shape to get `[1, NUM_HEADS, seq_len, HEAD_DIM]`. For initialization, start with zero-sized tensors using a safe fallback, then detect dims from the first output.

Replace the KV cache initialization block (lines 200-208) with:
```ts
let pastKV: ort.Tensor[] | null = null;
if (useKVCache) {
	// Count layers from input names
	numLayers = decoderSession.inputNames.filter((n) => n.endsWith('.key')).length;
	// Initialize with zero-length — dims will be detected from first output
	pastKV = [];
	for (let i = 0; i < numLayers; i++) {
		// Use [1, 1, 0, 1] as placeholder shape — actual dims come from present.0.key after step 0
		pastKV.push(new ort.Tensor('float32', new Float32Array(0), [1, 1, 0, 1]));
		pastKV.push(new ort.Tensor('float32', new Float32Array(0), [1, 1, 0, 1]));
	}
}
```

Then after the first decoder run in the KV cache path (after `decResult = await decoderSession.run(decFeeds);` on line 231), detect dims from output:
```ts
// Update KV cache from outputs
for (let i = 0; i < numLayers; i++) {
	pastKV[i * 2] = decResult[`present.${i}.key`];
	pastKV[i * 2 + 1] = decResult[`present.${i}.value`];
}
// Detect dims from first output (once)
if (step === 0 && numHeads === 0) {
	const shape = decResult['present.0.key'].dims;
	numHeads = shape[1];
	headDim = shape[3];
	console.log(`[transcribe-${workerId}] detected: layers=${numLayers}, heads=${numHeads}, headDim=${headDim}`);
}
```

**Step 3: Update all references from `NUM_LAYERS`/`NUM_HEADS`/`HEAD_DIM` to `numLayers`/`numHeads`/`headDim`**

The only remaining references are in the KV cache init block (already handled above) and the KV cache update loop (already handled above).

**Step 4: Verify no type errors**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | head -30`

**Step 5: Commit**

```bash
git add frontend/src/worker-transcribe.ts
git commit -m "Auto-detect KV cache architecture from ONNX session"
```

---

### Task 4: Add model picker to start screen

**Files:**
- Modify: `frontend/src/routes/+page.svelte` (add model picker step)
- Modify: `frontend/src/lib/components/ModePicker.svelte` (show selected model info)
- Modify: `frontend/src/lib/components/ModelManager.svelte` (dynamic model sizes from profile)

**Step 1: Update +page.svelte to add model-pick step**

Replace the `mode` state and add model selection:

```ts
import { getSelectedModelId, setSelectedModelId, getSelectedProfile, MODEL_PROFILES, type ModelProfileId } from '$lib/model-config';

let mode = $state<'model' | 'pick' | 'wasm'>('model');
let selectedModel = $state<ModelProfileId>(getSelectedModelId());

function handleModelSelected(id: ModelProfileId) {
	selectedModel = id;
	setSelectedModelId(id);
	mode = 'pick';
}
```

Update the template to show a model picker when `mode === 'model'`:

```svelte
{#if mode === 'model'}
	<!-- Model picker cards: Swedish Lion / Tridis -->
	<div class="space-y-3 text-center mb-6">
		<h1 class="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
			{t('app.title')}
		</h1>
		<p class="text-sm text-muted-foreground">{t('model.choose')}</p>
	</div>
	<div class="flex flex-col gap-3 w-full max-w-md mx-auto">
		{#each Object.values(MODEL_PROFILES) as profile}
			<button
				class="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 text-left hover:border-primary/50 transition-colors {selectedModel === profile.id ? 'border-primary' : ''}"
				onclick={() => handleModelSelected(profile.id)}
			>
				<h3 class="text-sm font-semibold">{profile.name[locale()]}</h3>
				<p class="text-xs text-muted-foreground mt-1">{profile.description[locale()]}</p>
				<p class="text-[0.65rem] text-muted-foreground/60 font-mono mt-2">{profile.totalSize}</p>
			</button>
		{/each}
	</div>
{:else if mode === 'pick'}
	<ModePicker onChooseGpu={handleChooseGpu} onChooseWasm={handleChooseWasm} />
{:else}
	<ModelManager ... />
{/if}
```

**Step 2: Update ModelManager to use dynamic sizes from profile**

In `ModelManager.svelte`, import `getSelectedProfile` and replace the hardcoded `models` array sizes:

```ts
import { getSelectedProfile } from '$lib/model-config';

const profile = $derived(getSelectedProfile());

const models = $derived([
	{ key: 'layout', labelKey: 'model.layout', descKey: 'model.layout.desc', size: profile.modelSizes.layout, icon: Scan },
	{ key: 'yolo', labelKey: 'model.yolo', descKey: 'model.yolo.desc', size: profile.modelSizes.yolo, icon: SplitSquareHorizontal },
	{ key: 'trocr-encoder', labelKey: 'model.encoder', descKey: 'model.encoder.desc', size: profile.modelSizes.encoder, icon: FileKey },
	{ key: 'trocr-decoder', labelKey: 'model.decoder', descKey: 'model.decoder.desc', size: profile.modelSizes.decoder, icon: PenLine },
	{ key: 'tokenizer', labelKey: 'model.tokenizer', descKey: 'model.tokenizer.desc', size: profile.modelSizes.tokenizer, icon: Type },
]);

const totalSize = $derived(profile.totalSize);
```

**Step 3: Add i18n key for model chooser**

In `i18n.svelte.ts`, add:
```ts
'model.choose': { en: 'Choose transcription model', sv: 'Välj transkriptionsmodell' },
```

**Step 4: Verify no type errors and test visually**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | head -30`

**Step 5: Commit**

```bash
git add frontend/src/routes/+page.svelte frontend/src/lib/components/ModePicker.svelte frontend/src/lib/components/ModelManager.svelte frontend/src/lib/i18n.svelte.ts
git commit -m "Add model picker to start screen"
```

---

### Task 5: Pass selected model cache name to workers

**Files:**
- Modify: `frontend/src/lib/worker-state.svelte.ts:72,357-378` (pass cacheName in load_models)
- Modify: `frontend/src/worker-transcribe.ts:63-81` (receive and use cacheName)
- Modify: `frontend/src/worker-detect.ts` (receive and use cacheName)
- Modify: `frontend/src/worker-layout.ts` (receive and use cacheName)

Workers run in a separate scope and can't import from `model-config.ts` reactively (the `localStorage` call in `getCacheName()` works because workers have access to `localStorage`). However, to be explicit and avoid any issues, we should pass `cacheName` in the `load_models` message.

**Step 1: Update worker-state.svelte.ts to pass cacheName**

In the `loadModels()` method (line 341-378), add `cacheName` to each `load_models` payload:

```ts
import { getModelUrls, getModelFetchHeaders, getCacheName } from './model-config';

// In loadModels():
const cacheName = getCacheName();

this.detectWorker.postMessage({
	type: 'load_models',
	payload: { modelUrl: getModelUrls().yolo, headers, cacheName },
});
this.layoutWorker.postMessage({
	type: 'load_model',
	payload: { modelUrl: getModelUrls().layout, headers, cacheName },
});
for (const w of this.transcribeWorkers) {
	w.postMessage({
		type: 'load_models',
		payload: {
			modelUrls: { encoder: getModelUrls().encoder, decoder: getModelUrls().decoder, tokenizer: getModelUrls().tokenizer },
			headers,
			cacheName,
		},
	});
}
```

Also update `setPoolSize()` similarly (line 182-196).

**Step 2: Update worker-transcribe.ts to use cacheName**

In the `load_models` handler, receive `cacheName` and pass it to `downloadAndCacheModel`:

```ts
const cacheName: string = e.data.payload?.cacheName ?? 'htr-models';
```

**Step 3: Update model-cache.ts to accept optional cacheName parameter**

Add `cacheName` parameter to `downloadAndCacheModel` and other functions:

```ts
export async function downloadAndCacheModel(
	url: string,
	modelName: string,
	onProgress: (p: DownloadProgress) => void,
	headers?: Record<string, string>,
	cacheName?: string,
): Promise<ArrayBuffer> {
	const name = cacheName ?? getCacheName();
	// use `name` instead of `getCacheName()` in this function
}
```

Actually, simpler approach: since `getCacheName()` reads from `localStorage` which is available in workers too, and we set `localStorage` before creating workers, just keep using `getCacheName()` everywhere. No need to pass cacheName explicitly.

**Revised Step 1-3:** Verify that `getCacheName()` works in worker context. Workers have access to `localStorage`. Since `setSelectedModelId()` is called on the main thread before `loadModels()`, the worker's `getCacheName()` will read the correct value. No changes needed to worker protocol — Task 2's changes are sufficient.

**Step 4: Verify**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | head -30`

**Step 5: Commit (if any changes were needed)**

```bash
git add frontend/src/lib/worker-state.svelte.ts
git commit -m "Ensure selected model propagates to worker cache"
```

---

### Task 6: Update mode.wasm.con.download size to be dynamic

**Files:**
- Modify: `frontend/src/lib/components/ModePicker.svelte:76-79`

**Step 1: Show model-specific download size**

Import `getSelectedProfile` and `locale` in `ModePicker.svelte`:

```ts
import { getSelectedProfile } from '$lib/model-config';
import { locale } from '$lib/i18n.svelte';

const profile = $derived(getSelectedProfile());
```

Replace the hardcoded download size line (line 79):
```svelte
<span>{t('mode.wasm.con.download')}</span>
```
with a dynamic version showing profile's `totalSize`. Either update the i18n string to accept a parameter, or just interpolate directly:
```svelte
<span>{t('mode.wasm.con.download.prefix')} {profile.totalSize} {t('mode.wasm.con.download.suffix')}</span>
```

Or simpler — just replace the hardcoded `~1.8 GB` references in `i18n.svelte.ts` at the `mode.wasm.con.download` and `mode.wasm.desc` keys to be template-friendly, or use `profile.totalSize` inline.

**Step 2: Commit**

```bash
git add frontend/src/lib/components/ModePicker.svelte frontend/src/lib/i18n.svelte.ts
git commit -m "Show model-specific download size in mode picker"
```

---

### Task 7: End-to-end verification

**Step 1: Type check**

Run: `cd frontend && npx svelte-check --tsconfig ./tsconfig.json`

**Step 2: Build check**

Run: `cd frontend && npm run build`

**Step 3: Manual test**

Run: `cd frontend && npm run dev`
- Open http://localhost:5173
- Verify model picker shows two cards: "Swedish Lion" and "Tridis (Medieval)"
- Click Swedish Lion → mode picker appears with correct download size
- Click "Run in browser" → ModelManager shows correct sizes for Swedish Lion
- Go back, pick Tridis → verify sizes update

**Step 4: Commit any fixes**

```bash
git commit -m "Fix issues found during verification"
```
