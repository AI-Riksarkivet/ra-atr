<script lang="ts">
  import { goto } from '$app/navigation';
  import { appState } from '$lib/stores/app-state.svelte';
  import AppHeader from '$lib/components/layout/app-header.svelte';
  import ModelManager from '$lib/components/ModelManager.svelte';
  import UploadPanel from '$lib/components/UploadPanel.svelte';
  import { onMount } from 'svelte';

  onMount(() => {
    return () => { /* cleanup if needed */ };
  });

  function handleUpload(imageData: ArrayBuffer, previewUrl: string) {
    appState.imageUrl = previewUrl;
    appState.selectMode = true;
    appState.htr.setImage(imageData);
    goto('/viewer');
  }
</script>

<AppHeader />

<div class="flex flex-1 items-center justify-center overflow-hidden">
  {#if !appState.htr.modelsReady && !appState.htr.cacheChecked}
    <p class="text-muted-foreground">Checking cached models...</p>
  {:else if !appState.htr.modelsReady}
    <ModelManager
      modelProgress={appState.htr.modelProgress}
      onLoadModels={() => appState.htr.loadModels()}
      modelsReady={appState.htr.modelsReady}
      autoLoading={appState.htr.stage === 'loading_models'}
    />
  {:else}
    <div class="w-full max-w-lg p-8">
      <UploadPanel onUpload={handleUpload} disabled={!appState.htr.modelsReady} />
    </div>
  {/if}
</div>
