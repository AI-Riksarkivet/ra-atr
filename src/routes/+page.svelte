<script lang="ts">
  import { goto } from '$app/navigation';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import ModelManager from '$lib/components/ModelManager.svelte';

  // Auto-redirect to viewer once models are ready
  $effect(() => {
    if (appState.htr.modelsReady) goto('/viewer');
  });
</script>

<AppHeader />

<div class="relative flex flex-1 items-center justify-center overflow-hidden">
  <video class="absolute inset-0 w-full h-full object-cover opacity-15 pointer-events-none" src="/flying-papers.mp4" loop muted autoplay playsinline></video>
  <div class="relative w-full max-w-lg space-y-6 p-8">
    {#if !appState.htr.cacheChecked}
      <p class="text-center text-muted-foreground">Checking cached models...</p>
    {:else}
      <ModelManager
        modelProgress={appState.htr.modelProgress}
        onLoadModels={() => appState.htr.loadModels()}
        modelsReady={appState.htr.modelsReady}
        autoLoading={appState.htr.stage === 'loading_models'}
      />
    {/if}
  </div>
</div>
