<script lang="ts">
	import { goto } from '$app/navigation';
	import { appState } from '$lib/stores/app-state.svelte';
	import AppHeader from '$lib/components/layout/app-header.svelte';
	import ModelManager from '$lib/components/ModelManager.svelte';
	import ModePicker from '$lib/components/ModePicker.svelte';
	import { gpuServerUrl } from '$lib/gpu-client';

	let mode = $state<'pick' | 'wasm'>('pick');

	// Redirect to viewer once models are ready (WASM loaded)
	$effect(() => {
		if (appState.htr.modelsReady) goto('/viewer');
	});

	function handleChooseGpu() {
		goto('/viewer');
	}

	function handleChooseWasm() {
		gpuServerUrl.set('');
		mode = 'wasm';
		appState.htr.loadModels();
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
		{#if mode === 'pick'}
			<ModePicker onChooseGpu={handleChooseGpu} onChooseWasm={handleChooseWasm} />
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
