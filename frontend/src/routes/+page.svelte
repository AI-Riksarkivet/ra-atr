<script lang="ts">
	import { goto } from '$app/navigation';
	import { appState } from '$lib/stores/app-state.svelte';
	import AppHeader from '$lib/components/layout/app-header.svelte';
	import ModelManager from '$lib/components/ModelManager.svelte';
	import ModePicker from '$lib/components/ModePicker.svelte';
	import { gpuServerUrl } from '$lib/gpu-client';
	import { setSelectedModelId, MODEL_PROFILES, type ModelProfileId } from '$lib/model-config';
	import { t, locale } from '$lib/i18n.svelte';

	let mode = $state<'model' | 'pick' | 'wasm'>('model');
	function handleModelSelected(id: ModelProfileId) {
		setSelectedModelId(id);
		mode = 'pick';
	}

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
		{#if mode === 'model'}
			<div class="space-y-3 text-center mb-6">
				<h1
					class="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
				>
					{t('app.title')}
				</h1>
				<p class="text-sm text-muted-foreground">{t('model.choose')}</p>
			</div>
			<div class="flex flex-col gap-3 w-full max-w-md mx-auto">
				{#each Object.values(MODEL_PROFILES) as profile (profile.id)}
					<button
						class="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 text-left hover:border-primary/50 transition-colors"
						onclick={() => handleModelSelected(profile.id)}
					>
						<h3 class="text-sm font-semibold">{profile.name[locale()]}</h3>
						<p class="text-xs text-muted-foreground mt-1">{profile.description[locale()]}</p>
						<p class="text-[0.65rem] text-muted-foreground/60 font-mono mt-2">
							{profile.totalSize}
						</p>
					</button>
				{/each}
			</div>
		{:else if mode === 'pick'}
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
