# Start Screen Mode Picker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the start screen's immediate WASM model download with a two-card mode picker (GPU Server vs Local WASM).

**Architecture:** New `ModePicker.svelte` component with two cards. The root `+page.svelte` shows ModePicker instead of ModelManager. GPU card uses existing `probeGpuServer` from `gpu-client.ts`. WASM card wraps existing `ModelManager`. Auto-detect logic removed from `worker-state` init.

**Tech Stack:** Svelte 5 (runes), Tailwind CSS, existing `gpu-client.ts` and `ModelManager.svelte`

---

### Task 1: Add i18n strings for the mode picker

**Files:**
- Modify: `frontend/src/lib/i18n.svelte.ts`

**Step 1: Add new translation keys**

After the existing `'models.retry'` line (~line 29), add:

```typescript
'mode.choose': { en: 'Choose inference mode', sv: 'Välj inferensläge' },
'mode.gpu.title': { en: 'GPU Server', sv: 'GPU-server' },
'mode.gpu.desc': {
    en: 'Connect to a remote GPU server for fast inference',
    sv: 'Anslut till en fjärr-GPU-server för snabb inferens',
},
'mode.gpu.placeholder': { en: 'http://192.168.1.10:8080', sv: 'http://192.168.1.10:8080' },
'mode.gpu.connect': { en: 'Connect', sv: 'Anslut' },
'mode.gpu.connecting': { en: 'Connecting...', sv: 'Ansluter...' },
'mode.gpu.connected': { en: 'Connected', sv: 'Ansluten' },
'mode.gpu.error': { en: 'Could not connect. Check the URL and try again.', sv: 'Kunde inte ansluta. Kontrollera URL:en och försök igen.' },
'mode.wasm.title': { en: 'Local (WASM)', sv: 'Lokal (WASM)' },
'mode.wasm.desc': {
    en: 'Download ~1.8 GB of models to run entirely in your browser',
    sv: 'Ladda ner ~1,8 GB modeller för att köra helt i din webbläsare',
},
'mode.wasm.cached': { en: 'Models cached — ready to go', sv: 'Modeller cachade — redo att köra' },
'mode.wasm.continue': { en: 'Continue', sv: 'Fortsätt' },
```

**Step 2: Commit**

```bash
git add frontend/src/lib/i18n.svelte.ts
git commit -m "feat: add i18n strings for inference mode picker"
```

---

### Task 2: Create ModePicker component

**Files:**
- Create: `frontend/src/lib/components/ModePicker.svelte`

**Step 1: Create the component**

```svelte
<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Server, Monitor } from 'lucide-svelte';
	import { gpuServerUrl, probeGpuServer, getGpuName } from '$lib/gpu-client';
	import { t } from '$lib/i18n.svelte';

	interface Props {
		modelsCached: boolean;
		onChooseGpu: () => void;
		onChooseWasm: () => void;
	}

	let { modelsCached, onChooseGpu, onChooseWasm }: Props = $props();

	let gpuUrl = $state(gpuServerUrl.get());
	let gpuStatus = $state<'idle' | 'checking' | 'ok' | 'error'>('idle');
	let gpuName = $state('');

	async function connectGpu() {
		const url = gpuUrl.trim();
		if (!url) return;
		gpuStatus = 'checking';
		const ok = await probeGpuServer(url);
		if (ok) {
			gpuServerUrl.set(url);
			gpuStatus = 'ok';
			gpuName = getGpuName();
			onChooseGpu();
		} else {
			gpuStatus = 'error';
		}
	}
</script>

<div class="space-y-3 text-center mb-6">
	<h1
		class="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
	>
		{t('app.title')}
	</h1>
	<p class="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
		{t('app.description')}
	</p>
</div>

<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
	<!-- GPU card -->
	<div class="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 space-y-4">
		<div class="flex items-center gap-2">
			<div
				class="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
			>
				<Server class="size-4" />
			</div>
			<div>
				<h3 class="text-sm font-semibold">{t('mode.gpu.title')}</h3>
			</div>
		</div>
		<p class="text-xs text-muted-foreground">{t('mode.gpu.desc')}</p>
		<div class="flex gap-1.5">
			<input
				type="text"
				bind:value={gpuUrl}
				placeholder={t('mode.gpu.placeholder')}
				class="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
				onkeydown={(e) => {
					if (e.key === 'Enter') connectGpu();
				}}
			/>
			<Button size="sm" onclick={connectGpu} disabled={gpuStatus === 'checking' || !gpuUrl.trim()}>
				{gpuStatus === 'checking' ? t('mode.gpu.connecting') : t('mode.gpu.connect')}
			</Button>
		</div>
		{#if gpuStatus === 'ok'}
			<p class="text-xs text-green-500">
				{t('mode.gpu.connected')}{gpuName ? ` — ${gpuName}` : ''}
			</p>
		{:else if gpuStatus === 'error'}
			<p class="text-xs text-destructive">{t('mode.gpu.error')}</p>
		{/if}
	</div>

	<!-- WASM card -->
	<div class="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 space-y-4">
		<div class="flex items-center gap-2">
			<div class="size-8 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
				<Monitor class="size-4" />
			</div>
			<div>
				<h3 class="text-sm font-semibold">{t('mode.wasm.title')}</h3>
			</div>
		</div>
		{#if modelsCached}
			<p class="text-xs text-green-500">{t('mode.wasm.cached')}</p>
			<Button class="w-full" onclick={onChooseWasm}>{t('mode.wasm.continue')}</Button>
		{:else}
			<p class="text-xs text-muted-foreground">{t('mode.wasm.desc')}</p>
			<Button class="w-full" variant="outline" onclick={onChooseWasm}>{t('models.download')}</Button>
		{/if}
	</div>
</div>
```

**Step 2: Commit**

```bash
git add frontend/src/lib/components/ModePicker.svelte
git commit -m "feat: add ModePicker component for GPU/WASM selection"
```

---

### Task 3: Wire ModePicker into the start screen

**Files:**
- Modify: `frontend/src/routes/+page.svelte`

**Step 1: Replace +page.svelte content**

The start screen needs three states:
1. Checking cache (brief spinner)
2. Mode picker (default)
3. WASM download (if user picked WASM and models not cached)

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { appState } from '$lib/stores/app-state.svelte';
	import AppHeader from '$lib/components/layout/app-header.svelte';
	import ModelManager from '$lib/components/ModelManager.svelte';
	import ModePicker from '$lib/components/ModePicker.svelte';
	import { isGpuServerEnabled } from '$lib/gpu-client';
	import { areAllModelsCached } from '$lib/model-cache';
	import { getModelUrls } from '$lib/model-config';

	let mode = $state<'pick' | 'wasm'>('pick');
	let modelsCached = $state(false);

	// Check cache on mount
	$effect(() => {
		if (appState.htr.cacheChecked) {
			areAllModelsCached(Object.values(getModelUrls())).then((cached) => {
				modelsCached = cached;
			});
		}
	});

	// Redirect to viewer once models are ready (WASM loaded)
	$effect(() => {
		if (appState.htr.modelsReady) goto('/viewer');
	});

	function handleChooseGpu() {
		// GPU is connected (probeGpuServer succeeded, URL saved to localStorage)
		// Go straight to viewer — no WASM models needed
		goto('/viewer');
	}

	function handleChooseWasm() {
		if (modelsCached) {
			// Models already cached — load them and the effect will redirect
			appState.htr.loadModels();
		} else {
			mode = 'wasm';
		}
	}
</script>

<AppHeader />

<div class="relative flex flex-1 items-center justify-center overflow-hidden">
	<video
		class="absolute inset-0 w-full h-full object-cover opacity-15 pointer-events-none"
		src="/flying-papers.mp4"
		loop
		muted
		autoplay
		playsinline
	></video>
	<div class="relative w-full max-w-2xl px-8">
		{#if !appState.htr.cacheChecked}
			<p class="text-center text-muted-foreground">Checking cached models...</p>
		{:else if mode === 'pick'}
			<ModePicker
				{modelsCached}
				onChooseGpu={handleChooseGpu}
				onChooseWasm={handleChooseWasm}
			/>
		{:else}
			<ModelManager
				modelProgress={appState.htr.modelProgress}
				onLoadModels={() => appState.htr.loadModels()}
				modelsReady={appState.htr.modelsReady}
				autoLoading={appState.htr.stage === 'loading_models'}
				error={appState.htr.error}
				onDismissError={() => (appState.htr.error = null)}
			/>
		{/if}
	</div>
</div>
```

**Step 2: Commit**

```bash
git add frontend/src/routes/+page.svelte
git commit -m "feat: wire ModePicker into start screen"
```

---

### Task 4: Remove auto-detect GPU from worker-state init

**Files:**
- Modify: `frontend/src/lib/worker-state.svelte.ts`

**Step 1: Remove the auto-detect call from `_init()`**

In `_init()` (~line 147-163), remove the call to `this._detectGpuInBackground()` and the entire `_detectGpuInBackground()` method (~line 165-179).

The `_init()` method should become:

```typescript
private async _init() {
    // Always start with WASM — GPU is configured via the start screen
    if (import.meta.env.DEV) console.log('[htr] Starting with WASM inference');
    let cached = false;
    try {
        cached = await areAllModelsCached(Object.values(getModelUrls()));
    } catch (e) {
        console.warn('[htr] Cache check failed, continuing:', e);
    }
    this.cacheChecked = true;
    if (cached) {
        this.loadModels();
    }
}
```

Also remove the `autoDetectGpuServer` import from the imports at top (~line 77).

**Step 2: Commit**

```bash
git add frontend/src/lib/worker-state.svelte.ts
git commit -m "refactor: remove GPU auto-detect from worker init"
```

---

### Task 5: Handle GPU-only mode in the viewer

**Files:**
- Modify: `frontend/src/routes/viewer/+page.svelte` (check that it works when models aren't loaded but GPU is connected)

**Step 1: Check the viewer's dependency on modelsReady**

Read `frontend/src/routes/viewer/+page.svelte` and verify it doesn't block on `modelsReady` when GPU is enabled. The viewer should work if either:
- `modelsReady === true` (WASM models loaded), OR
- `isGpuServerEnabled() === true` (GPU server connected)

If the viewer gates on `modelsReady`, add an OR condition for GPU mode. The exact change depends on what the viewer does — inspect and fix.

**Step 2: Commit**

```bash
git add frontend/src/routes/viewer/+page.svelte
git commit -m "fix: allow viewer to work in GPU-only mode without WASM models"
```

---

### Task 6: Verify and test manually

**Step 1: Run `npm run dev` and test the flow**

1. Clear localStorage and cache (DevTools → Application → Clear site data)
2. Load `http://localhost:5173/` — should see two cards
3. Enter a bad GPU URL, click Connect — should show error
4. Click "Download Models" on WASM card — should show ModelManager and download
5. After download, should redirect to `/viewer`
6. Clear site data again, set a valid GPU URL → should redirect to `/viewer`
7. Reload — GPU URL should be pre-filled but not auto-connected

**Step 2: Run lint and type check**

```bash
cd frontend && npm run lint && npm run check
```

**Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: address lint/type issues from mode picker"
```
