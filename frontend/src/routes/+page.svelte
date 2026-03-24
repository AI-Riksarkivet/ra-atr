<script lang="ts">
	import { goto } from '$app/navigation';
	import { appState } from '$lib/stores/app-state.svelte';
	import AppHeader from '$lib/components/layout/app-header.svelte';
	import ModelManager from '$lib/components/ModelManager.svelte';
	import ModePicker from '$lib/components/ModePicker.svelte';
	import { areAllModelsCached } from '$lib/model-cache';
	import { getModelUrls } from '$lib/model-config';
	import { gpuServerUrl } from '$lib/gpu-client';

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
		// Clear any previously saved GPU URL so the header shows WASM mode
		gpuServerUrl.set('');
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
			<ModePicker {modelsCached} onChooseGpu={handleChooseGpu} onChooseWasm={handleChooseWasm} />
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
